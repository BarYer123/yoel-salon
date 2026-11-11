const OWNER  = 'BarYer123';
const REPO   = 'yoel-salon';
const BRANCH = 'data';   // gallery.json + uploaded images live here — never triggers Vercel deploy

async function gh(method, path, body, token) {
  const r = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/${path}`, {
    method,
    headers: {
      Authorization: `token ${token}`,
      Accept: 'application/vnd.github.v3+json',
      'Content-Type': 'application/json'
    },
    body: body ? JSON.stringify(body) : undefined
  });
  return r.json();
}

async function getGallery(token) {
  const file = await gh('GET', `contents/gallery.json?ref=${BRANCH}`, null, token);
  if (!file.content) throw new Error('Cannot read gallery.json: ' + (file.message || ''));
  return {
    images: JSON.parse(Buffer.from(file.content.replace(/\s/g, ''), 'base64').toString('utf-8')).images,
    sha: file.sha
  };
}

async function saveGallery(images, sha, token) {
  const content = Buffer.from(JSON.stringify({ images }, null, 2)).toString('base64');
  return gh('PUT', 'contents/gallery.json', {
    message: 'Update gallery',
    content,
    sha,
    branch: BRANCH
  }, token);
}

function validItem(src) {
  if (typeof src !== 'string' || src.length > 400) return false;
  return /^images\/[\w.-]+\.(?:jpe?g|png|webp)$/i.test(src) ||
    /^https:\/\/raw\.githubusercontent\.com\/BarYer123\/yoel-salon\/data\/(?:images\/[\w.-]+\.(?:jpe?g|png|webp)|videos\/[\w.-]+\.mp4)$/i.test(src);
}

function mediaExtension(bytes, kind) {
  if (kind === 'video') return bytes.length <= 20 * 1024 * 1024 && bytes.subarray(4, 8).toString() === 'ftyp' ? 'mp4' : null;
  if (bytes.length > 10 * 1024 * 1024) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'jpg';
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'png';
  if (bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP') return 'webp';
  return null;
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { password, action, images, rawUrl, imagePath, chunk, shas, kind, expectedSha } = req.body || {};

  if (!password || password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const token = process.env.GITHUB_TOKEN;
  if (!token) return res.status(500).json({ error: 'GITHUB_TOKEN not set' });

  try {
    if (action === 'verify') {
      const gallery = await getGallery(token);
      return res.json({
        success: true,
        images: gallery.images,
        sha: gallery.sha
      });
    }

    if (action === 'add-url') {
      if (!validItem(rawUrl)) return res.status(400).json({ error: 'Invalid media URL' });
      const { images: current, sha } = await getGallery(token);
      const newImages = [rawUrl, ...current];
      const r = await saveGallery(newImages, sha, token);
      if (!r.commit) return res.status(500).json({ error: r.message || 'Save failed' });
      return res.json({ success: true, images: newImages });
    }

    if (action === 'reorder') {
      if (!Array.isArray(images) || images.length > 200 || !images.every(validItem)) return res.status(400).json({ error: 'Invalid gallery items' });
      const { sha } = await getGallery(token);
      if (expectedSha !== sha) return res.status(409).json({ error: 'הגלריה השתנתה בחלון אחר. יש לרענן את העמוד לפני שמירה.' });
      const r = await saveGallery(images, sha, token);
      if (!r.commit) return res.status(500).json({ error: r.message || 'Save failed' });
      return res.json({ success: true, images, sha: r.content.sha });
    }

    if (action === 'delete') {
      if (!validItem(imagePath)) return res.status(400).json({ error: 'Invalid media URL' });
      const { images: current, sha } = await getGallery(token);
      const newImages = current.filter(i => i !== imagePath);
      const r = await saveGallery(newImages, sha, token);
      if (!r.commit) return res.status(500).json({ error: r.message || 'Save failed' });
      return res.json({ success: true, images: newImages });
    }

    if (action === 'upload-chunk') {
      if (typeof chunk !== 'string' || chunk.length > 3_000_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(chunk)) {
        return res.status(400).json({ error: 'Invalid upload chunk' });
      }
      const r = await gh('POST', 'git/blobs', { content: chunk, encoding: 'base64' }, token);
      if (!r.sha) return res.status(502).json({ error: r.message || 'Chunk upload failed' });
      return res.json({ success: true, sha: r.sha });
    }

    if (action === 'upload-complete') {
      if (!['image', 'video'].includes(kind) || !Array.isArray(shas) || shas.length < 1 || shas.length > 12 ||
          !shas.every(sha => typeof sha === 'string' && /^[a-f0-9]{40}$/.test(sha))) {
        return res.status(400).json({ error: 'Invalid upload' });
      }
      const parts = [];
      for (const sha of shas) {
        const blob = await gh('GET', `git/blobs/${sha}`, null, token);
        if (blob.encoding !== 'base64' || !blob.content) return res.status(400).json({ error: 'Invalid upload chunk' });
        parts.push(Buffer.from(blob.content.replace(/\s/g, ''), 'base64'));
      }
      const bytes = Buffer.concat(parts);
      const extension = mediaExtension(bytes, kind);
      if (!extension) return res.status(400).json({ error: 'Invalid media file or size' });
      const filename = `gallery_${Date.now()}_${require('crypto').randomBytes(6).toString('hex')}.${extension}`;
      const filePath = `${kind === 'video' ? 'videos' : 'images'}/${filename}`;
      const r = await gh('PUT', `contents/${filePath}`, {
        message: `Upload ${filename}`, content: bytes.toString('base64'), branch: BRANCH
      }, token);
      if (!r.commit) return res.status(502).json({ error: r.message || 'Upload failed' });
      return res.json({ success: true, rawUrl: `https://raw.githubusercontent.com/${OWNER}/${REPO}/${BRANCH}/${filePath}` });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};

module.exports.config = {
  api: { bodyParser: { sizeLimit: '4mb' } }
};
