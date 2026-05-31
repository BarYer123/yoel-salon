const OWNER = 'BarYer123';
const REPO  = 'yoel-salon';
const RAW   = `https://raw.githubusercontent.com/${OWNER}/${REPO}/main`;

async function ghGet(path, token) {
  const r = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/contents/${path}`, {
    headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github.v3+json' }
  });
  return r.json();
}

async function ghPut(path, base64content, sha, message, token) {
  const body = { message, content: base64content };
  if (sha) body.sha = sha;
  const r = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/contents/${path}`, {
    method: 'PUT',
    headers: {
      Authorization: `token ${token}`,
      Accept: 'application/vnd.github.v3+json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  return r.json();
}

async function getGallery(token) {
  const file = await ghGet('gallery.json', token);
  return {
    data: JSON.parse(Buffer.from(file.content, 'base64').toString('utf-8')),
    sha: file.sha
  };
}

async function saveGallery(images, sha, token) {
  const content = Buffer.from(JSON.stringify({ images }, null, 2)).toString('base64');
  return ghPut('gallery.json', content, sha, 'Update gallery', token);
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { password, action, images, imageData, imageName, imagePath } = req.body || {};

  if (!password || password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const token = process.env.GITHUB_TOKEN;
  if (!token) return res.status(500).json({ error: 'GITHUB_TOKEN not set' });

  try {
    if (action === 'upload') {
      const ext = (imageName || 'img.jpg').split('.').pop().toLowerCase() || 'jpg';
      const filename = `gallery_${Date.now()}.${ext}`;
      const filePath = `images/${filename}`;
      const rawBase64 = imageData.replace(/^data:image\/[^;]+;base64,/, '');

      const uploadResult = await ghPut(filePath, rawBase64, null, `Upload ${filename}`, token);
      if (!uploadResult.content) {
        return res.status(500).json({ error: uploadResult.message || 'Upload failed' });
      }

      // Use raw.githubusercontent URL — available immediately, no deploy needed
      const rawUrl = `${RAW}/${filePath}`;

      const { data, sha } = await getGallery(token);
      data.images = [rawUrl, ...data.images];
      await saveGallery(data.images, sha, token);

      return res.json({ success: true, path: rawUrl, images: data.images });
    }

    if (action === 'reorder') {
      const { sha } = await getGallery(token);
      await saveGallery(images, sha, token);
      return res.json({ success: true });
    }

    if (action === 'delete') {
      const { data, sha } = await getGallery(token);
      data.images = data.images.filter(i => i !== imagePath);
      await saveGallery(data.images, sha, token);
      return res.json({ success: true, images: data.images });
    }

    return res.status(400).json({ error: 'Unknown action: ' + action });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};

module.exports.config = {
  api: { bodyParser: { sizeLimit: '8mb' } }
};
