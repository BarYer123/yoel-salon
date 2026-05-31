const OWNER = 'BarYer123';
const REPO  = 'yoel-salon';

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

async function updateGalleryJson(newImages, token) {
  const file = await ghGet('gallery.json', token);
  const sha = file.sha;
  const content = Buffer.from(JSON.stringify({ images: newImages }, null, 2)).toString('base64');
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
      const imgPath = `images/${filename}`;

      // imageData is "data:image/jpeg;base64,XXXXX" — extract raw base64
      const rawBase64 = imageData.replace(/^data:image\/[^;]+;base64,/, '');

      const uploadResult = await ghPut(imgPath, rawBase64, null, `Upload ${filename}`, token);
      if (!uploadResult.content) {
        return res.status(500).json({ error: uploadResult.message || 'Upload failed' });
      }

      const galleryFile = await ghGet('gallery.json', token);
      const current = JSON.parse(Buffer.from(galleryFile.content, 'base64').toString('utf-8'));
      current.images = [imgPath, ...current.images];

      const gjContent = Buffer.from(JSON.stringify(current, null, 2)).toString('base64');
      await ghPut('gallery.json', gjContent, galleryFile.sha, `Add ${filename} to gallery`, token);

      return res.json({ success: true, path: imgPath, images: current.images });
    }

    if (action === 'reorder') {
      await updateGalleryJson(images, token);
      return res.json({ success: true });
    }

    if (action === 'delete') {
      const galleryFile = await ghGet('gallery.json', token);
      const current = JSON.parse(Buffer.from(galleryFile.content, 'base64').toString('utf-8'));
      current.images = current.images.filter(i => i !== imagePath);
      const gjContent = Buffer.from(JSON.stringify(current, null, 2)).toString('base64');
      await ghPut('gallery.json', gjContent, galleryFile.sha, `Remove ${imagePath}`, token);
      return res.json({ success: true, images: current.images });
    }

    return res.status(400).json({ error: 'Unknown action: ' + action });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};

module.exports.config = {
  api: { bodyParser: { sizeLimit: '8mb' } }
};
