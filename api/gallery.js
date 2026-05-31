export const config = {
  api: { bodyParser: { sizeLimit: '8mb' } }
};

const OWNER = 'BarYer123';
const REPO  = 'yoel-salon';

async function githubGet(path, token) {
  const res = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/contents/${path}`, {
    headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github.v3+json' }
  });
  return res.json();
}

async function githubPut(path, content, sha, message, token) {
  const body = { message, content: Buffer.from(content).toString('base64'), sha };
  if (!sha) delete body.sha;
  const res = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/contents/${path}`, {
    method: 'PUT',
    headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github.v3+json', 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return res.json();
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { password, action, images, imageData, imageName } = req.body || {};

  if (!password || password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const token = process.env.GITHUB_TOKEN;
  if (!token) return res.status(500).json({ error: 'Server not configured' });

  try {
    if (action === 'upload') {
      // Upload image file to GitHub
      const ext = imageName.split('.').pop().toLowerCase();
      const safeName = `gallery_${Date.now()}.${ext}`;
      const path = `images/${safeName}`;
      const base64 = imageData.replace(/^data:image\/\w+;base64,/, '');

      await githubPut(path, Buffer.from(base64, 'base64'), null, `Upload ${safeName}`, token);

      // Update gallery.json
      const gjFile = await githubGet('gallery.json', token);
      const current = JSON.parse(Buffer.from(gjFile.content, 'base64').toString('utf-8'));
      current.images = [path, ...current.images];
      await githubPut('gallery.json', JSON.stringify(current, null, 2), gjFile.sha, `Add ${safeName} to gallery`, token);

      return res.json({ success: true, path, images: current.images });
    }

    if (action === 'reorder') {
      const gjFile = await githubGet('gallery.json', token);
      await githubPut('gallery.json', JSON.stringify({ images }, null, 2), gjFile.sha, 'Reorder gallery', token);
      return res.json({ success: true });
    }

    if (action === 'delete') {
      const { imagePath } = req.body;
      const gjFile = await githubGet('gallery.json', token);
      const current = JSON.parse(Buffer.from(gjFile.content, 'base64').toString('utf-8'));
      current.images = current.images.filter(i => i !== imagePath);
      await githubPut('gallery.json', JSON.stringify(current, null, 2), gjFile.sha, `Remove ${imagePath} from gallery`, token);
      return res.json({ success: true, images: current.images });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
