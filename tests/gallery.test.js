const test = require('node:test');
const assert = require('node:assert/strict');
const handler = require('../api/gallery');

process.env.ADMIN_PASSWORD = 'test-password';
process.env.GITHUB_TOKEN = 'secret-token';

async function call(body) {
  const response = { code: 200, setHeader() {}, status(code) { this.code = code; return this; }, json(value) { this.body = value; return this; }, end() { return this; } };
  await handler({ method: 'POST', body: { password: 'test-password', ...body } }, response);
  return response;
}

test('login does not expose GitHub token', async () => {
  global.fetch = async () => ({ json: async () => ({ content: Buffer.from(JSON.stringify({ images: ['images/1.png'] })).toString('base64'), sha: 'c'.repeat(40) }) });
  const response = await call({ action: 'verify' });
  assert.equal(response.code, 200);
  assert.equal(response.body.success, true);
  assert.equal(response.body.token, undefined);
  assert.deepEqual(response.body.images, ['images/1.png']);
});

test('invalid gallery item is rejected before reaching GitHub', async () => {
  const response = await call({ action: 'reorder', images: ['https://evil.example/x.png'] });
  assert.equal(response.code, 400);
});

test('stale gallery save is rejected instead of overwriting newer changes', async () => {
  global.fetch = async () => ({ json: async () => ({ content: Buffer.from('{"images":["images/1.png"]}').toString('base64'), sha: 'c'.repeat(40) }) });
  const response = await call({ action: 'reorder', images: ['images/1.png'], expectedSha: 'd'.repeat(40) });
  assert.equal(response.code, 409);
});

test('chunked MP4 upload keeps the token on the server', async () => {
  const video = Buffer.from('0000ftyp0000');
  video.writeUInt32BE(video.length, 0);
  const calls = [];
  global.fetch = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/git/blobs') && options.method === 'POST') return { json: async () => ({ sha: 'a'.repeat(40) }) };
    if (url.endsWith('/git/blobs/' + 'a'.repeat(40))) return { json: async () => ({ encoding: 'base64', content: video.toString('base64') }) };
    if (url.includes('/contents/videos/')) return { json: async () => ({ commit: { sha: 'b'.repeat(40) } }) };
    throw new Error('Unexpected request: ' + url);
  };
  const part = await call({ action: 'upload-chunk', chunk: video.toString('base64') });
  assert.equal(part.body.sha, 'a'.repeat(40));
  const done = await call({ action: 'upload-complete', kind: 'video', shas: [part.body.sha] });
  assert.equal(done.body.success, true);
  assert.match(done.body.rawUrl, /\/data\/videos\/gallery_.*\.mp4$/);
  assert.ok(calls.every(({ options }) => options.headers.Authorization === 'token secret-token'));
  assert.ok(!JSON.stringify(done.body).includes('secret-token'));
});
