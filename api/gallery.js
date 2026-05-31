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

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { password, action, images, rawUrl, imagePath } = req.body || {};

  if (!password || password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const token = process.env.GITHUB_TOKEN;
  if (!token) return res.status(500).json({ error: 'GITHUB_TOKEN not set' });

  try {
    if (action === 'verify') {
      return res.json({
        success: true,
        token,
        owner: OWNER,
        repo: REPO,
        uploadBranch: BRANCH,   // images go to data branch — main stays clean
        dataBranch: BRANCH
      });
    }

    if (action === 'add-url') {
      if (!rawUrl) return res.status(400).json({ error: 'Missing rawUrl' });
      const { images: current, sha } = await getGallery(token);
      const newImages = [rawUrl, ...current];
      const r = await saveGallery(newImages, sha, token);
      if (!r.commit) return res.status(500).json({ error: r.message || 'Save failed' });
      return res.json({ success: true, images: newImages });
    }

    if (action === 'reorder') {
      if (!Array.isArray(images)) return res.status(400).json({ error: 'Missing images' });
      const { sha } = await getGallery(token);
      const r = await saveGallery(images, sha, token);
      if (!r.commit) return res.status(500).json({ error: r.message || 'Save failed' });
      return res.json({ success: true, images });
    }

    if (action === 'delete') {
      if (!imagePath) return res.status(400).json({ error: 'Missing imagePath' });
      const { images: current, sha } = await getGallery(token);
      const newImages = current.filter(i => i !== imagePath);
      const r = await saveGallery(newImages, sha, token);
      if (!r.commit) return res.status(500).json({ error: r.message || 'Save failed' });
      return res.json({ success: true, images: newImages });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};

module.exports.config = {
  api: { bodyParser: { sizeLimit: '1mb' } }
};
