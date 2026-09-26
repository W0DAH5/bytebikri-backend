/**
 * The video host: the router's whitelist, and the client's contract.
 *
 * `VIDEO_STORAGE.md` is the reasoning; this file is the evidence. Two halves, and
 * they exist for two different reasons:
 *
 *   1. **THE WHITELIST.** Moving bytes to a third party is the first thing this
 *      product does that can publish something it promised not to. `storage` is a
 *      router now, and the refusals matter more than the routing: an identity
 *      document must never leave, images must never leave, and nothing leaves when no
 *      driver is configured. Those assertions run against the real `storage` adapter
 *      with the driver switched ON, and the strongest of them counts the requests the
 *      stub received — zero is the assertion, not "the key looks local".
 *
 *   2. **THE CONTRACT, AGAINST A STUB.** The environment this was written in refuses
 *      egress to the provider, so `src/video.js` has never spoken to the real API.
 *      What CAN be proven here is that the client uses the documented surface
 *      correctly — bearer header, multipart field names, status mapping, delete on
 *      404 — and that a wrong guess about a response body fails LEGIBLY. The stub
 *      implements the documented endpoints and nothing else, so a client invented
 *      against different ones would fail this file too.
 *
 * What this file cannot prove is that the provider agrees. That is
 * `npm run video:check`, which must run where the network reaches it, and the doctor
 * prints the response keys so a mismatch is a one-line fix.
 */
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:55432/bytebikri_test';

// ── the stub ────────────────────────────────────────────────────────────────
//
// It speaks the documented surface and records what it was asked, because the
// whitelist's most important assertion is about requests that never arrived.
const seen = [];
let state = {};

const STUB_FILES = {
  abc123: {
    id: 'abc123',
    title: 'store-walkthrough.mp4',
    status: 'ready',
    size: 4096,
    duration: 5,
    playback_url: 'http://stub.invalid/media/abc123.mp4',
  },
  hls456: {
    id: 'hls456',
    title: 'hosted-hls.mp4',
    status: 'ready',
    size: 8192,
    duration: 240,
    hls_url: 'http://stub.invalid/media/hls456/index.m3u8',
  },
  slow789: {
    id: 'slow789',
    title: 'still-processing.mp4',
    status: 'processing',
  },
};

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

const server = http.createServer(async (req, res) => {
  const body = await readBody(req);
  const url = new URL(req.url, 'http://127.0.0.1');
  seen.push({
    method: req.method,
    path: url.pathname,
    auth: req.headers.authorization || null,
    contentType: req.headers['content-type'] || null,
    body: body.toString('utf8'),
    bytes: body.length,
  });

  const json = (code, payload) => {
    res.writeHead(code, { 'content-type': 'application/json' });
    res.end(JSON.stringify(payload));
  };

  if (url.pathname === '/account' && req.method === 'GET') {
    return json(200, { data: { id: 147, email: 'store@example.test', storage_used: '1.2 GB' } });
  }
  if (url.pathname === '/files/upload' && req.method === 'POST') {
    if (!req.headers.authorization?.startsWith('Bearer ')) return json(401, { message: 'unauthenticated' });
    const m = /name="id"/.test(body.toString('utf8'));
    return json(200, { data: { id: 'abc123', ...(m ? { echoed: true } : {}) } });
  }
  if (url.pathname === '/files' && req.method === 'GET') {
    return json(200, { data: { files: Object.values(STUB_FILES).map((f) => ({ id: f.id, status: f.status })) } });
  }
  const one = /^\/files\/([a-z0-9]+)$/i.exec(url.pathname);
  if (one && req.method === 'GET') {
    const record = STUB_FILES[one[1]] ?? state.extra?.[one[1]];
    if (!record) return json(404, { message: 'no such file' });
    return json(200, { data: record });
  }
  if (one && req.method === 'DELETE') {
    if (state.deleteFails) return json(500, { message: 'the storage backend is having a moment' });
    if (!STUB_FILES[one[1]]) return json(404, { message: 'no such file' });
    return json(200, { ok: true });
  }
  if (one && req.method === 'PATCH') return json(200, { data: { id: one[1], ...(JSON.parse(body.toString('utf8') || '{}')) } });
  if (/^\/files\/[a-z0-9]+\/status$/i.test(url.pathname) && req.method === 'GET') {
    const id = url.pathname.split('/')[2];
    return json(200, { data: { id, status: STUB_FILES[id]?.status ?? 'unknown' } });
  }
  if (url.pathname === '/remote-uploads' && req.method === 'POST') {
    return json(200, { data: { id: 'remote1', urls: JSON.parse(body.toString('utf8') || '{}').urls } });
  }
  return json(404, { message: 'no such endpoint' });
});

let base = '';
before(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  process.env.FILEMOON_API_BASE = base;
  process.env.FILEMOON_TOKEN = '147|stub-token-abcdefghijklmnop';
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  const { close } = await import('../src/db.js');
  await close();
});

const video = await import('../src/video.js');
const { storage } = await import('../src/store.js');

const withDriver = (fn, { driver = 'filemoon' } = {}) => {
  const before = { ...process.env };
  process.env.FILEMOON_API_BASE = base;
  process.env.FILEMOON_TOKEN = '147|stub-token-abcdefghijklmnop';
  if (driver) process.env.VIDEO_DRIVER = driver; else delete process.env.VIDEO_DRIVER;
  const restore = () => {
    for (const key of ['VIDEO_DRIVER', 'FILEMOON_TOKEN', 'FILEMOON_API_BASE']) {
      if (before[key] === undefined) delete process.env[key]; else process.env[key] = before[key];
    }
  };
  return Promise.resolve(fn()).finally(restore);
};

// ── 1. the router ───────────────────────────────────────────────────────────

test('only video in the private namespace is allowed to leave', async () => {
  await withDriver(() => {
    // The one that may leave.
    assert.equal(storage.routesToHost({ namespace: 'private', mimeType: 'video/mp4' }), true);
    assert.equal(storage.routesToHost({ namespace: 'private', mimeType: 'application/octet-stream', filename: 'clip.MP4' }), true,
      'a browser that sends octet-stream for an mp4 must not change where the bytes go');
    // The three that may not, each for its own reason.
    assert.equal(storage.routesToHost({ namespace: 'kyc', mimeType: 'video/mp4' }), false,
      'an identity document must never reach a video host, whatever it claims to be');
    assert.equal(storage.routesToHost({ namespace: 'kyc', mimeType: 'image/jpeg' }), false);
    assert.equal(storage.routesToHost({ namespace: 'public', mimeType: 'image/png' }), false,
      'covers are served by us, with no token — that is the point of a cover');
    assert.equal(storage.routesToHost({ namespace: 'private', mimeType: 'image/jpeg' }), false);
    // Audio is playable by the same predicate and stays local on purpose
    // (VIDEO_STORAGE.md §2, refusal 3) — a decision, so it is asserted.
    assert.equal(storage.routesToHost({ namespace: 'private', mimeType: 'audio/mpeg' }), false);
    // A reader's archive is offset-addressed by our own reader and never hosted.
    assert.equal(storage.routesToHost({ namespace: 'private', mimeType: 'application/vnd.comicbook+zip', filename: 'x.cbz' }), false);
  });
});

test('with the driver off, nothing changes at all', async () => {
  await withDriver(async () => {
    assert.equal(video.videoHostEnabled(), false);
    assert.equal(storage.routesToHost({ namespace: 'private', mimeType: 'video/mp4' }), false,
      'a fresh clone with no configuration must keep every byte on disk');
  }, { driver: null });
});

test('a video upload really goes to the host — and an identity document really does not', async () => {
  const before = seen.length;
  await withDriver(async () => {
    const key = await storage.put(Buffer.from('not really a video'), 'clip.mp4', { mimeType: 'video/mp4' });
    assert.match(key, /^filemoon\//, `the key must name the host: ${key}`);

    // The document. Same adapter, same call site shape — the router is the only thing
    // standing between a passport and a stranger's CDN, so the assertion is about the
    // requests the stub received, not about the key that came back.
    const docKey = await storage.put(Buffer.from('a scan of a citizenship certificate'), 'document.jpg', { namespace: 'kyc', mimeType: 'image/jpeg' });
    assert.match(docKey, /^kyc\//);
    assert.equal(docKey.includes('filemoon'), false);
  });

  const calls = seen.slice(before);
  const uploads = calls.filter((c) => c.path === '/files/upload');
  assert.equal(uploads.length, 1, `the host received ${uploads.length} uploads, not 1`);
  assert.ok(uploads[0].auth?.startsWith('Bearer 147|'), 'the token travels as a bearer');
  assert.match(uploads[0].contentType, /^multipart\/form-data; boundary=/);
  assert.match(uploads[0].body, /name="file"/);
  assert.match(uploads[0].body, /filename="clip.mp4"/);
  assert.match(uploads[0].body, /name="visibility"/);
  assert.equal(uploads[0].body.includes('citizenship certificate'), false,
    'the identity document reached the host — this is the one assertion in the file that must never be allowlisted away');
});

test('the adapter never reads a hosted file from this disk', async () => {
  assert.equal(storage.isRemote('filemoon/abc123'), true);
  assert.equal(storage.isRemote('private/2f4c1e3a-0000-4000-8000-000000000000.mp4'), false);
  assert.equal(storage.remoteId('filemoon/abc123'), 'abc123');
  assert.equal(storage.remoteId('private/whatever.mp4'), null);

  await assert.rejects(() => storage.get('filemoon/abc123'), (err) => {
    assert.equal(err.code, 'EREMOTE', 'a caller must be able to branch without matching a sentence');
    return true;
  });
  // `exists` answers without a request: holding the id IS the knowledge. Spending a
  // call to learn it would put the host in the path of a page render.
  const before = seen.length;
  assert.equal(await storage.exists('filemoon/abc123'), true);
  assert.equal(seen.length, before, 'exists() asked the host a question it already knew');
});

// ── 2. the client, against the stub ─────────────────────────────────────────

test('the client uses the documented surface', async () => {
  await withDriver(async () => {
    const account = await video.account();
    assert.equal(video.pick(account, ['email']), 'store@example.test');

    const uploaded = await video.upload(Buffer.from('bytes'), 'clip.mp4', { mimeType: 'video/mp4' });
    assert.equal(uploaded.id, 'abc123');
    assert.equal(uploaded.key, 'filemoon/abc123');

    const record = await video.file('abc123');
    assert.equal(record.title, 'store-walkthrough.mp4');
    assert.equal(record.status, 'ready');
    assert.equal(record.sizeBytes, 4096);
    assert.equal(record.durationSec, 5);

    // `status`/`updateFile` are FILMOON's surface rather than the shared interface —
    // Catbox has neither — so the registry keeps them under the provider's name instead
    // of pretending every host has them (`src/video.js`).
    const status = await video.filemoon.status('abc123');
    assert.equal(video.pick(status, ['status']), 'ready');

    const patched = await video.filemoon.updateFile('abc123', { title: 'renamed' });
    assert.equal(video.pick(patched, ['title']), 'renamed');
  });
});

test('a playback url is classified by what it is, not by the field it arrived in', async () => {
  await withDriver(async () => {
    const plain = await video.playback('abc123');
    assert.equal(plain.kind, 'file');
    assert.match(plain.url, /\.mp4$/);

    // The same client, a file the host serves as a playlist: `hls_url` here, but the
    // classification reads the extension — a provider that renames the field, or
    // starts returning a playlist in `url`, cannot hand a `.m3u8` to a `<video>`.
    const hls = await video.playback('hls456');
    assert.equal(hls.kind, 'hls');
    assert.equal(video.classifyUrl('https://x.test/a/index.m3u8?token=1'), 'hls');
    assert.equal(video.classifyUrl('https://x.test/a/index.mp4'), 'file');
    assert.equal(video.classifyUrl(''), null);
  });
});

test('an unplayable record fails in a sentence that names what came back', async () => {
  await withDriver(async () => {
    // `slow789` is still processing: no url of any kind in its body.
    await assert.rejects(() => video.playback('slow789'), (err) => {
      assert.equal(err.name, 'VideoApiError');
      assert.match(err.message, /no playback url/);
      // The whole answer to "the shape was never confirmed": the keys are in the
      // message, so the fix is one line rather than a debugging session.
      assert.match(err.message, /id, title, status/);
      return true;
    });
  });
});

test('the provider’s own words reach the caller, and a 404 delete is a success', async () => {
  await withDriver(async () => {
    state.deleteFails = true;
    await assert.rejects(() => video.remove('abc123'), (err) => {
      assert.equal(err.status, 500);
      assert.match(err.message, /having a moment/);
      return true;
    });
    // A failure must NOT be reported as a deletion: the local adapter's `false` means
    // "there was nothing to delete", and pretending those are the same thing is how a
    // promise about deletion stops being one.
    await assert.rejects(() => storage.remove('filemoon/abc123'));
    state.deleteFails = false;

    assert.equal(await video.remove('abc123'), true);
    assert.equal(await storage.remove('filemoon/abc123'), true);
    // A missing file is a success on both sides of the adapapter: the caller asked for
    // it to not be there.
    assert.equal(await video.remove('nosuchfile'), true);
  });
});

test('the host being unreachable is a sentence, not a crash', async () => {
  const before = { ...process.env };
  process.env.VIDEO_DRIVER = 'filemoon';
  process.env.FILEMOON_API_BASE = 'http://127.0.0.1:1'; // nothing listens here
  process.env.FILEMOON_TOKEN = '147|stub-token-abcdefghijklmnop';
  try {
    await assert.rejects(() => video.account(), (err) => {
      assert.equal(err.name, 'VideoApiError');
      assert.match(err.message, /cannot reach the video host/);
      return true;
    });
  } finally {
    process.env.FILEMOON_API_BASE = before.FILEMOON_API_BASE;
    process.env.FILEMOON_TOKEN = before.FILEMOON_TOKEN;
    if (before.VIDEO_DRIVER === undefined) delete process.env.VIDEO_DRIVER;
    else process.env.VIDEO_DRIVER = before.VIDEO_DRIVER;
  }
});

test('a token that is not there is refused before any request is made', async () => {
  const before = process.env.FILEMOON_TOKEN;
  const beforeDriver = process.env.VIDEO_DRIVER;
  process.env.VIDEO_DRIVER = 'filemoon';
  delete process.env.FILEMOON_TOKEN;
  const count = seen.length;
  try {
    await assert.rejects(() => video.account(), /not configured/);
    assert.equal(seen.length, count, 'a request went out without a token');
  } finally {
    process.env.FILEMOON_TOKEN = before;
    if (beforeDriver === undefined) delete process.env.VIDEO_DRIVER; else process.env.VIDEO_DRIVER = beforeDriver;
  }
});

// ── 3. more than one host ───────────────────────────────────────────────────
//
// Four providers share one seam, and the facts that make them different are the ones worth
// asserting: Catbox answers in plain text and has no id beyond the file's name; Pixeldrain
// authenticates with Basic auth whose PASSWORD is the key, and refuses hotlinks on a free
// plan; Telegra.ph answers an ARRAY on success and an object on failure, is undocumented,
// and cannot delete anything. Each gets its own in-process stub, because what these tests
// ask is "what did the client actually send". (GoFile was here and is gone: a free account
// could not produce a playable link, which is a fact about the ACCOUNT rather than a bug
// in the client, and no amount of correct code fixes it.)

const seenCatbox = [];
const catboxStub = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = Buffer.concat(chunks);
  const fields = {};
  const boundary = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(req.headers['content-type'] || '');
  if (boundary) {
    const mark = Buffer.from(`--${(boundary[1] || boundary[2]).trim()}`);
    let at = body.indexOf(mark);
    while (at !== -1) {
      const next = body.indexOf(mark, at + mark.length);
      const part = body.subarray(at + mark.length, next === -1 ? body.length : next);
      const split = part.indexOf('\r\n\r\n');
      if (split !== -1) {
        const head = part.subarray(0, split).toString('utf8');
        const name = /name="([^"]+)"/.exec(head)?.[1];
        if (name) {
          fields[name] = /filename="/.test(head)
            ? { bytes: part.subarray(split + 4, part.length - 2).length }
            : part.subarray(split + 4, part.length - 2).toString('utf8');
        }
      }
      at = next;
    }
  }
  seenCatbox.push({ path: req.url, fields });
  res.writeHead(200, { 'content-type': 'text/plain' });
  if (fields.reqtype === 'fileupload') {
    res.end(`https://files.catbox.moe/${catboxStub.nextName || 'stub99.mp4'}`);
  } else {
    res.end('success');
  }
});
let catboxBase = '';
before(async () => {
  await new Promise((resolve) => catboxStub.listen(0, '127.0.0.1', resolve));
  catboxBase = `http://127.0.0.1:${catboxStub.address().port}`;
  process.env.CATBOX_API_BASE = catboxBase;
  process.env.CATBOX_USERHASH = 'stub-userhash';
});
after(async () => { await new Promise((resolve) => catboxStub.close(resolve)); });

test('the registry knows its hosts, and a misspelled driver is local rather than something else', () => {
  assert.deepEqual(video.HOSTS, ['filemoon', 'apivideo', 'pixeldrain', 'telegraph', 'catbox']);
  assert.equal(video.videoDriver({ VIDEO_DRIVER: 'FILEMOON ' }), 'filemoon');
  assert.equal(video.videoDriver({ VIDEO_DRIVER: 'nope' }), 'local',
    'a typo in an env file must leave every byte on disk, not pick another host');
  assert.equal(video.videoDriver({}), 'local');
});

test('a key names the host that holds the bytes, and cannot be talked into naming another', () => {
  const uuid = 'd4c5e6f7-a8b9-4c0d-9e1f-2a3b4c5d6e7f';
  assert.equal(video.remoteKey('abc123.mp4', 'catbox'), 'catbox/abc123.mp4');
  assert.equal(video.remoteKey(uuid, 'pixeldrain'), `pixeldrain/${uuid}`);
  assert.equal(video.remoteKey('AbC_-9', 'filemoon'), 'filemoon/AbC_-9');

  assert.equal(video.remoteProvider('catbox/abc123.mp4'), 'catbox');
  assert.equal(video.remoteId('pixeldrain/' + uuid), uuid);
  assert.equal(video.remoteProvider('private/aaaa-bbbb.mp4'), null, 'a local key is not a remote one');
  assert.equal(video.remoteProvider('catbox/../../etc/passwd'), null, 'an id with a path in it is not a key');
  assert.equal(video.remoteProvider('kyc/x.mp4'), null);
  assert.throws(() => video.remoteKey('../../etc/passwd', 'catbox'), /not usable as a key/);
  assert.throws(() => video.remoteKey('abc', 'nosuchhost'), /unknown video host/);
});

test('Catbox: the upload is the documented multipart, and the answer is a url, not JSON', async () => {
  const before = seenCatbox.length;
  const out = await withDriver(
    () => video.upload(Buffer.from('pretend video'), 'clip.mp4', { mimeType: 'video/mp4', env: { ...process.env, CATBOX_API_BASE: catboxBase, CATBOX_USERHASH: 'stub-userhash', VIDEO_DRIVER: 'catbox' } }),
    { driver: 'catbox' },
  );
  assert.equal(out.id, 'stub99.mp4');
  assert.equal(out.key, 'catbox/stub99.mp4');
  const [call] = seenCatbox.slice(before);
  assert.equal(call.path, '/user/api.php');
  assert.equal(call.fields.reqtype, 'fileupload');
  assert.equal(call.fields.userhash, 'stub-userhash');
  assert.equal(call.fields.fileToUpload.bytes, Buffer.from('pretend video').length, 'the bytes must actually be sent');
});

test('Catbox: a refusal is a sentence, and it is carried through as one', async () => {
  // A host that says no in words: no JSON, no status code to branch on, just a sentence.
  let asked = 0;
  const refusing = http.createServer((_req, res) => {
    asked += 1;
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('File too large');
  });
  await new Promise((resolve) => refusing.listen(0, '127.0.0.1', resolve));
  try {
    await assert.rejects(
      video.upload(Buffer.from('x'), 'clip.mp4', {
        env: { ...process.env, VIDEO_DRIVER: 'catbox', CATBOX_API_BASE: `http://127.0.0.1:${refusing.address().port}`, CATBOX_USERHASH: 'u' },
      }),
      (e) => e.name === 'VideoApiError' && /refused the upload: File too large/.test(e.message),
      'the host\'s own words are the only explanation there is, so they must survive',
    );
    assert.equal(asked, 1, 'the request was made — this is a refusal, not a silent no-op');
  } finally {
    await new Promise((resolve) => refusing.close(resolve));
  }
});

test('Catbox: a file over the cap is refused locally, with no request at all', async () => {
  const before = seenCatbox.length;
  const big = Buffer.alloc(200 * 1024 * 1024 + 1);
  await assert.rejects(
    video.upload(big, 'huge.mp4', { provider: 'catbox', env: { ...process.env, CATBOX_API_BASE: catboxBase, CATBOX_USERHASH: 'stub-userhash' } }),
    (e) => e.name === 'VideoApiError' && /refused before sending/.test(e.message),
  );
  assert.equal(seenCatbox.length, before, 'the cap must be refused before the bytes cross the wire');
});

test('Catbox: playback is a url made from the name — it costs no host call', async () => {
  const before = seenCatbox.length;
  const found = await video.playback('stub99.mp4', { provider: 'catbox', env: { ...process.env, CATBOX_FILE_BASE: 'https://files.catbox.moe' } });
  assert.deepEqual(found, { kind: 'file', url: 'https://files.catbox.moe/stub99.mp4', id: 'stub99.mp4', provider: 'catbox' });
  assert.equal(seenCatbox.length, before, 'a name is the whole answer; asking the host would spend a request to learn nothing');
});

// ── Pixeldrain: raw-body PUT, Basic auth with the key as the PASSWORD ───────
//
// The three things a naive client gets wrong, and the reason each is asserted rather than
// assumed: the credential goes in the PASSWORD field of Basic auth (a bearer token
// authenticates as nobody); the body is the file ITSELF, not a multipart form (the docs
// recommend PUT because the form "can cause performance issues"); and a delete that
// answers 404 means the file is already gone, which is the outcome the caller wanted.

const seenPixel = [];
const pixelStub = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = Buffer.concat(chunks);
  const url = new URL(req.url, 'http://127.0.0.1');
  seenPixel.push({
    method: req.method, path: url.pathname, bytes: body.length,
    auth: req.headers.authorization, contentType: req.headers['content-type'], referer: req.headers.referer,
  });
  const json = (code, payload) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(payload)); };
  // Basic auth, key in the password field. The stub refuses anything else, so a client that
  // sends a bearer cannot pass these tests by accident.
  const decoded = String(req.headers.authorization || '').startsWith('Basic ')
    ? Buffer.from(String(req.headers.authorization).slice(6), 'base64').toString('utf8') : '';
  const authed = decoded.slice(decoded.indexOf(':') + 1) === 'stub-key';
  if (url.pathname === '/api/user') {
    if (!authed) return json(401, { success: false, value: 'unauthorized' });
    return json(200, { success: true, id: 'stub', email: 'stub@example.test', subscription: { id: 'free', name: 'Free' } });
  }
  if (req.method === 'PUT' && url.pathname.startsWith('/api/file/')) {
    if (!authed) return json(401, { success: false, value: 'unauthorized' });
    return json(201, { success: true, id: 'pixel1', name: decodeURIComponent(url.pathname.split('/').pop()), size: body.length });
  }
  if (req.method === 'DELETE' && url.pathname === '/api/file/gone') return json(404, { success: false, value: 'not_found' });
  if (req.method === 'DELETE' && url.pathname.startsWith('/api/file/')) {
    if (!authed) return json(401, { success: false, value: 'unauthorized' });
    return json(200, { success: true });
  }
  if (url.pathname === '/api/file/pixel1/info') {
    return json(200, { success: true, id: 'pixel1', name: 'clip.mp4', size: 12, mime_type: 'video/mp4', can_download: true });
  }
  return json(404, { success: false, value: 'not_found' });
});
let pixelBase = '';
before(async () => {
  await new Promise((resolve) => pixelStub.listen(0, '127.0.0.1', resolve));
  pixelBase = `http://127.0.0.1:${pixelStub.address().port}/api`;
});
after(async () => { await new Promise((resolve) => pixelStub.close(resolve)); });

const pixelEnv = (extra = {}) => ({
  ...process.env, VIDEO_DRIVER: 'filemoon', FILE_DRIVER: 'pixeldrain',
  PIXELDRAIN_API_KEY: 'stub-key', PIXELDRAIN_API_BASE: pixelBase, ...extra,
});

test('Pixeldrain: the bytes ARE the request body, and the key travels as a Basic password', async () => {
  const before = seenPixel.length;
  const payload = Buffer.from('pretend video');
  const out = await video.upload(payload, 'clip.mp4', {
    mimeType: 'video/mp4', provider: 'pixeldrain', env: pixelEnv(),
  });
  assert.equal(out.key, 'pixeldrain/pixel1');
  const call = seenPixel.slice(before).find((c) => c.method === 'PUT');
  assert.equal(call.path, '/api/file/clip.mp4', 'the filename is part of the path, not a form field');
  assert.equal(call.bytes, payload.length,
    'the raw body is the file itself — no multipart wrapper, no boundary, no second copy in memory');
  assert.equal(call.contentType, 'video/mp4');
  assert.equal(call.auth, `Basic ${Buffer.from(':stub-key').toString('base64')}`,
    'Basic auth with an EMPTY username: the key is the password. A bearer token here authenticates as nobody');
});

test('Pixeldrain: playback is a url on the api host, and costs no call', async () => {
  const before = seenPixel.length;
  const found = await video.playback('pixel1', { provider: 'pixeldrain', env: pixelEnv() });
  assert.equal(found.kind, 'file', 'a general host serves progressive bytes — there is no playlist to resolve');
  assert.equal(found.url, `${pixelBase}/file/pixel1`);
  assert.equal(seenPixel.length, before, 'the url is arithmetic on an id we already hold');
});

test('Pixeldrain: the account tier is a NAME, not an object, because the doctor matches on it', async () => {
  video.forgetAccount();
  const who = await video.account({ provider: 'pixeldrain', env: pixelEnv() });
  assert.equal(who.tier, 'Free', 'the answer is {subscription: {id, name}} — a client that passes it through prints [object Object]');
  assert.equal(who.email, 'stub@example.test');
  assert.equal(video.providers.pixeldrain.capabilities.policy.commercial, 'premium');
});

test('Pixeldrain: a delete that 404s is a success, because gone is gone', async () => {
  assert.equal(await video.remove('gone', { provider: 'pixeldrain', env: pixelEnv() }), true);
  assert.equal(await video.remove('pixel1', { provider: 'pixeldrain', env: pixelEnv() }), true);
});

test('Pixeldrain: a limit refusal keeps the host\'s own words — including the hotlink one', async () => {
  /*
   * The free-tier reality this whole round turns on: `hotlink_detected` is the refusal a
   * store's own page would meet, and the sentence that explains it mentions the plan. It has
   * to survive to whoever reads the log, because "the file host answered 403" is not
   * something an operator can act on.
   */
  const refusing = http.createServer((req, res) => {
    res.writeHead(403, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ success: false, value: 'hotlink_detected', message: 'Hotlinking was detected, hotlinking is only allowed with a premium subscription' }));
  });
  await new Promise((resolve) => refusing.listen(0, '127.0.0.1', resolve));
  const env = pixelEnv({ PIXELDRAIN_API_BASE: `http://127.0.0.1:${refusing.address().port}/api` });
  try {
    await assert.rejects(
      video.providers.pixeldrain.file('pixel1', { env }),
      (e) => e.name === 'VideoApiError' && /hotlink_detected/.test(e.message) && /premium subscription/.test(e.message),
      'the host\'s explanation is the only one that mentions the plan',
    );
    // And playback deliberately does NOT call the host, so a refusal cannot be met here:
    // the url is built from an id we already hold. Whether the host will SERVE that url to a
    // viewer's browser is a question about the account, which the doctor asks out loud.
    const found = await video.playback('pixel1', { provider: 'pixeldrain', env });
    assert.equal(found.url, `http://127.0.0.1:${refusing.address().port}/api/file/pixel1`);
  } finally {
    await new Promise((resolve) => refusing.close(resolve));
  }
});

// ── Telegra.ph: an ARRAY on success, an object on failure, and no delete ────
//
// This host is undocumented, so every behaviour below is asserted against what its users
// have established it does — and the two that matter most are the ones a client can get
// wrong silently: the answer's SHAPE decides success, and there is no way to take a file
// back.

const seenTele = [];
const teleStub = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = Buffer.concat(chunks);
  const url = new URL(req.url, 'http://127.0.0.1');
  seenTele.push({ path: url.pathname, bytes: body.length, contentType: req.headers['content-type'] });
  const json = (code, payload) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(payload)); };
  if (url.pathname === '/upload' && req.method === 'POST') {
    // Envelope: an array when it works, an object when it does not. The type it dislikes is
    // reported the way the host reports it.
    assert.ok(/multipart\/form-data/.test(req.headers['content-type'] || ''), 'the upload must be multipart');
    if (/video\//.test(body.toString('latin1').slice(0, 4000))) return json(200, { error: 'FILE_TYPE_INVALID' });
    return json(200, [{ src: '/file/5a1b2c3d4e5f60718293a4b5c6d7.png' }]);
  }
  return json(404, { error: 'NOT_FOUND' });
});
let teleBase = '';
before(async () => {
  await new Promise((resolve) => teleStub.listen(0, '127.0.0.1', resolve));
  teleBase = `http://127.0.0.1:${teleStub.address().port}`;
});
after(async () => { await new Promise((resolve) => teleStub.close(resolve)); });

const teleEnv = (extra = {}) => ({
  ...process.env, VIDEO_DRIVER: 'filemoon', IMAGE_DRIVER: 'telegraph',
  TELEGRAPH_UPLOAD_BASE: `${teleBase}/upload`, TELEGRAPH_FILE_BASE: teleBase, ...extra,
});

test('Telegra.ph: an image goes up, and the answer is an ARRAY of paths', async () => {
  const before = seenTele.length;
  const out = await video.upload(Buffer.from('pretend png'), 'photo.png', { mimeType: 'image/png', provider: 'telegraph', env: teleEnv() });
  assert.equal(out.id, '5a1b2c3d4e5f60718293a4b5c6d7.png', 'the id is the last segment of the returned path');
  assert.equal(out.key, 'telegraph/5a1b2c3d4e5f60718293a4b5c6d7.png');
  const call = seenTele.slice(before)[0];
  assert.equal(call.path, '/upload', 'the upload host is telegra.ph — NOT api.telegra.ph, which refuses this endpoint');
  assert.equal(call.contentType.split(';')[0], 'multipart/form-data');
});

test('Telegra.ph: an OBJECT under HTTP 200 is a refusal, not a file with no url', async () => {
  /*
   * The failure envelope is a sibling shape of the success one — an array when it works, an
   * object when it does not — and a client that reads `json[0]` on both gets `undefined` and
   * reports "accepted the upload but named no usable file". That sentence sends whoever
   * debugs it into the client, when the host had already said exactly what was wrong.
   */
  const refusing = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'FILE_TOO_BIG' }));
  });
  await new Promise((resolve) => refusing.listen(0, '127.0.0.1', resolve));
  try {
    await assert.rejects(
      video.providers.telegraph.upload(Buffer.from('pretend png'), 'photo.png', {
        mimeType: 'image/png', env: teleEnv({ TELEGRAPH_UPLOAD_BASE: `http://127.0.0.1:${refusing.address().port}/upload` }),
      }),
      (e) => e.name === 'VideoApiError' && /refused the upload: FILE_TOO_BIG/.test(e.message),
      'a 200 carrying an error object is a refusal — the host\'s own word, not a shrug',
    );
  } finally {
    await new Promise((resolve) => refusing.close(resolve));
  }
});

test('Telegra.ph: a non-image is refused locally, because this host is not the video path', async () => {
  const before = seenTele.length;
  await assert.rejects(
    video.upload(Buffer.from('pretend video'), 'clip.mp4', { mimeType: 'video/mp4', provider: 'telegraph', env: teleEnv() }),
    (e) => e.name === 'VideoApiError' && /image host takes jpg, png and gif/.test(e.message),
    'the endpoint happens to accept mp4 too, and we still refuse it: a video with no delete is worse than a video with one',
  );
  assert.equal(seenTele.length, before, 'no request — the kind is known before the bytes move');
});

test('Telegra.ph: over 5 MB is refused BEFORE the bytes move', async () => {
  const before = seenTele.length;
  await assert.rejects(
    video.upload(Buffer.alloc(5 * 1024 * 1024 + 1), 'big.png', { mimeType: 'image/png', provider: 'telegraph', env: teleEnv() }),
    (e) => e.name === 'VideoApiError' && /refused before sending/.test(e.message),
    'a 5 MB cap discovered after a mobile upload is somebody\'s data allowance spent to learn what the client knew',
  );
  assert.equal(seenTele.length, before, 'no request at all');
});

test('Telegra.ph: playback is a url from the name, and there is NO delete to call', async () => {
  const before = seenTele.length;
  const found = await video.playback('5a1b2c3d4e5f60718293a4b5c6d7.png', { provider: 'telegraph', env: teleEnv() });
  assert.equal(found.url, `${teleBase}/file/5a1b2c3d4e5f60718293a4b5c6d7.png`);
  assert.equal(seenTele.length, before);

  /*
   * THE HONESTY TEST.
   *
   * Returning `true` here would be the easy lie: the local file row would be deleted and the
   * product would report a clean removal while the image stayed readable at a public url
   * forever. Throwing is what makes the delete route say "unconfirmed", which is true, and
   * it is why this host may only hold things a store need not take back.
   */
  await assert.rejects(
    video.remove(found.id, { provider: 'telegraph', env: teleEnv() }),
    (e) => e.name === 'VideoApiError' && /no delete endpoint/.test(e.message) && /unconfirmed/.test(e.message),
  );
  assert.equal(video.providers.telegraph.capabilities.deletable, false);
});

// ── api.video: two calls to store a video, and the ONLY live ingest here ────
//
// Four things are asserted rather than trusted, because each is a decision recorded in
// VIDEO_STORAGE.md §11 and each would be invisible in a passing test that ignored it:
//
//   * the credential goes in the USERNAME field of Basic auth with a trailing colon (the
//     opposite of Pixeldrain next door, and a key sent as a password authenticates as
//     nobody);
//   * containers are created `public: true` — a private container's delivery is a
//     single-use token, and HLS fetches a manifest plus every segment, so a private
//     container is a player that breaks on the second request;
//   * `mp4Support: true` is asked for at CREATION, because it cannot be added later and it
//     is the fallback that does not depend on a CDN's CORS policy;
//   * the live half mints a stream and hands back an HLS playlist our own player plays —
//     and the streamKey is a credential the client is given, never one it stores.

const seenApi = [];
const apiStub = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = Buffer.concat(chunks);
  const url = new URL(req.url, 'http://127.0.0.1');
  seenApi.push({
    method: req.method, path: url.pathname, auth: req.headers.authorization,
    body: body.toString('utf8').slice(0, 400), bytes: body.length,
  });
  const json = (code, payload) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(payload)); };
  // The real scheme: key as USERNAME, trailing colon, empty password.
  const decoded = String(req.headers.authorization || '').startsWith('Basic ')
    ? Buffer.from(String(req.headers.authorization).slice(6), 'base64').toString('utf8') : '';
  const authed = decoded === 'stub-key:';
  const publicAsset = req.method === 'GET' && /^\/(vod|live)\//.test(url.pathname);

  if (url.pathname === '/auth/api-key' && req.method === 'POST') {
    return json(200, { token_type: 'Bearer', access_token: 'tok', expires_in: 3600 });
  }
  if (!authed && !publicAsset) return json(401, { type: 'about:blank', title: 'Unauthorized', status: 401 });

  if (url.pathname === '/videos' && req.method === 'POST') {
    return json(201, { videoId: 'viSTUB0000000000000001', assets: { player: 'p', iframe: '', thumbnail: 't' }, status: 'uploaded' });
  }
  if (url.pathname === '/videos/viSTUB0000000000000001/source' && req.method === 'POST') {
    return json(201, {
      videoId: 'viSTUB0000000000000001', status: 'processing',
      assets: { player: 'p', iframe: '', thumbnail: 't' },
    });
  }
  if (url.pathname === '/videos/viSTUB0000000000000001') {
    return json(200, {
      videoId: 'viSTUB0000000000000001', status: 'playable', title: 'stub', duration: 5, public: true, mp4Support: true,
      assets: {
        player: 'p', iframe: '', thumbnail: 't',
        hls: 'https://cdn.api.video/vod/viSTUB0000000000000001/hls/manifest.m3u8',
        mp4: 'https://cdn.api.video/vod/viSTUB0000000000000001/mp4/source.mp4',
      },
    });
  }
  if (url.pathname === '/videos/notready') {
    return json(200, { videoId: 'notready', status: 'processing', assets: { player: 'p', iframe: '', thumbnail: 't' } });
  }
  if (url.pathname === '/videos/viGONE') return json(404, { title: 'video not found', status: 404 });
  if (url.pathname === '/videos/viSTUB0000000000000001' && req.method === 'DELETE') return res.writeHead(204).end();

  if (url.pathname === '/live-streams' && req.method === 'POST') {
    return json(201, {
      liveStreamId: 'liSTUB0000000000000001',
      streamKey: 'cc1b4df0-d1c5-4064-a8f9-9f0368385135',
      name: 'stub live', public: true, broadcasting: false, record: false,
      assets: { iframe: '', player: 'p', hls: 'https://live.api.video/liSTUB0000000000000001.m3u8', thumbnail: 't' },
    });
  }
  if (url.pathname === '/live-streams/liSTUB0000000000000001' && req.method === 'GET') {
    return json(200, {
      liveStreamId: 'liSTUB0000000000000001', streamKey: 'cc1b4df0-d1c5-4064-a8f9-9f0368385135',
      name: 'stub live', broadcasting: true, record: true,
      assets: { hls: 'https://live.api.video/liSTUB0000000000000001.m3u8' },
    });
  }
  if (url.pathname === '/live-streams/liSTUB0000000000000001' && req.method === 'PATCH') {
    return json(200, { liveStreamId: 'liSTUB0000000000000001', name: 'renamed', broadcasting: false });
  }
  if (url.pathname === '/live-streams/liSTUB0000000000000001' && req.method === 'DELETE') return res.writeHead(204).end();
  if (url.pathname === '/live-streams/liGONE' && req.method === 'DELETE') return json(404, { title: 'not found', status: 404 });
  if (url.pathname === '/videos' && req.method === 'GET') {
    return json(200, { data: [], pagination: { itemsTotal: 7, pagesTotal: 1, pageSize: 1, currentPage: 1 } });
  }
  return json(404, { title: 'no such endpoint', status: 404 });
});
let apiBase = '';
before(async () => {
  await new Promise((resolve) => apiStub.listen(0, '127.0.0.1', resolve));
  apiBase = `http://127.0.0.1:${apiStub.address().port}`;
});
after(async () => { await new Promise((resolve) => apiStub.close(resolve)); });

const apiEnv = (extra = {}) => ({
  ...process.env, VIDEO_DRIVER: 'apivideo', APIVIDEO_API_KEY: 'stub-key', APIVIDEO_BASE: apiBase, ...extra,
});

test('api.video: the credential is Basic with the key as the USERNAME and a trailing colon', async () => {
  const before = seenApi.length;
  await video.providers.apivideo.account({ env: apiEnv() });
  const calls = seenApi.slice(before);
  const expected = `Basic ${Buffer.from('stub-key:').toString('base64')}`;
  assert.ok(calls.length >= 2, 'the credential check asks the auth endpoint');
  for (const c of calls) {
    assert.equal(c.auth, expected,
      'the key belongs in the USERNAME field with a trailing colon — sent as a password it authenticates as nobody');
  }
  assert.ok(calls.some((c) => c.path === '/auth/api-key'), 'POST /auth/api-key is the one call whose purpose is "is this key valid"');
});

test('api.video: a container is created PUBLIC and with mp4Support, then filled', async () => {
  const before = seenApi.length;
  const out = await video.upload(Buffer.from('pretend video'), 'clip.mp4', { mimeType: 'video/mp4', provider: 'apivideo', env: apiEnv() });
  assert.equal(out.key, 'apivideo/viSTUB0000000000000001');
  const calls = seenApi.slice(before);
  assert.deepEqual(calls.map((c) => `${c.method} ${c.path}`), ['POST /videos', 'POST /videos/viSTUB0000000000000001/source'],
    'two calls: the shell, then the bytes into it');
  const create = JSON.parse(calls[0].body);
  assert.equal(create.public, true,
    'public on purpose: a private container is delivered with a SINGLE-USE token, and HLS fetches a manifest plus every segment');
  assert.equal(create.mp4Support, true,
    'asked for at creation because it cannot be added later, and it is the fallback that does not depend on CORS');
  assert.ok(calls[1].bytes > 0, 'the second call actually carried the file');
});

test('api.video: playback reads the record — HLS by default, mp4 by configuration', async () => {
  const hls = await video.playback('viSTUB0000000000000001', { provider: 'apivideo', env: apiEnv() });
  assert.equal(hls.kind, 'hls', 'an .m3u8 is HLS, and our player attaches hls.js on that word alone');
  assert.match(hls.url, /hls\/manifest\.m3u8$/);

  const mp4 = await video.playback('viSTUB0000000000000001', { provider: 'apivideo', env: apiEnv({ APIVIDEO_PLAYBACK: 'mp4' }) });
  assert.equal(mp4.kind, 'file', 'the progressive asset is the fallback for a CDN whose playlist is not CORS-readable');
  assert.match(mp4.url, /mp4\/source\.mp4$/);
});

test('api.video: a container that is still encoding fails with the STATUS in the sentence', async () => {
  await assert.rejects(
    video.playback('notready', { provider: 'apivideo', env: apiEnv() }),
    (e) => e.name === 'VideoApiError' && /processing/.test(e.message) && /no playable asset/.test(e.message),
    'a seller staring at a spinner needs to know it is the host still encoding, not us being broken',
  );
});

test('api.video: a delete that 404s is a success, because gone is gone', async () => {
  assert.equal(await video.remove('viSTUB0000000000000001', { provider: 'apivideo', env: apiEnv() }), true);
  assert.equal(await video.remove('viGONE', { provider: 'apivideo', env: apiEnv() }), true);
});

test('api.video: the sandbox is detected from the base, because its limits are product limits', async () => {
  const provider = video.providers.apivideo;
  assert.equal(provider.isSandbox({ APIVIDEO_BASE: 'https://sandbox.api.video' }), true);
  assert.equal(provider.isSandbox({ APIVIDEO_BASE: 'https://ws.api.video' }), false);
  assert.equal(provider.isSandbox({}), false, 'production is the default base');
  const caps = provider.capabilities.sandbox;
  assert.equal(caps.maxSeconds, 30);
  assert.equal(caps.deletesAfterHours, 24);
  assert.equal(caps.watermark, true, 'the sandbox watermark cannot be removed, so it cannot be sold from');
});

test('api.video: a file needing a chunked upload is kept on our disk instead of failing', () => {
  // `acceptsFile` answers for the FILE, so the router can move on to another host rather
  // than sending bytes the client cannot deliver in one request.
  const verdict = video.providers.apivideo.acceptsFile({ mimeType: 'video/mp4', filename: 'huge.mp4', size: 210 * 1024 * 1024 });
  assert.equal(verdict.ok, false);
  assert.match(verdict.why, /progressive|chunked/, 'the reason names the upload path that would be needed');
  assert.equal(video.providers.apivideo.acceptsFile({ mimeType: 'video/mp4', filename: 'clip.mp4', size: 1024 }).ok, true);
});

// ── the live half ───────────────────────────────────────────────────────────

test('api.video live: minting a stream hands back an id, a key and a playlist we can play', async () => {
  const before = seenApi.length;
  const live = await video.providers.apivideo.createLiveStream({ liveName: 'stub live', env: apiEnv() });
  assert.equal(live.id, 'liSTUB0000000000000001');
  assert.equal(live.streamKey, 'cc1b4df0-d1c5-4064-a8f9-9f0368385135');
  assert.match(live.hls, /^https:\/\/live\.api\.video\/liSTUB0000000000000001\.m3u8$/,
    'what comes back is an HLS playlist — the exact shape the live panel already stores in external_url');
  const create = JSON.parse(seenApi.slice(before).find((c) => c.path === '/live-streams').body);
  assert.equal(create.public, true,
    'public for the same reason the videos are: a private live url carries a per-viewer token in its PATH');
  assert.equal(create.record, false, 'live-to-VOD is an hour of hosting, so it is asked for rather than assumed');
});

test('api.video live: the ingest addresses are what a seller types into OBS or ffmpeg', () => {
  const ingest = video.providers.apivideo.ingestFor({ APIVIDEO_STREAM_KEY: 'KEY-123' });
  assert.equal(ingest.rtmp, 'rtmp://broadcast.api.video/s');
  assert.equal(ingest.rtmps, 'rtmps://broadcast.api.video:1936/s');
  assert.equal(ingest.srt, 'srt://broadcast.api.video:6200?streamid=KEY-123',
    'the key rides in the URL for SRT, which is why it is never stored and never logged');
});

test('api.video live: the state comes from the host — including whether it is live right now', async () => {
  const state = await video.providers.apivideo.liveStream('liSTUB0000000000000001', { env: apiEnv() });
  assert.equal(state.broadcasting, true, '`broadcasting` is the only honest "live now" there is');
  assert.equal(state.hls, 'https://live.api.video/liSTUB0000000000000001.m3u8');
  const patched = await video.providers.apivideo.updateLiveStream('liSTUB0000000000000001', { name: 'renamed' }, { env: apiEnv() });
  assert.equal(patched.name, 'renamed');
  assert.equal(await video.providers.apivideo.removeLiveStream('liSTUB0000000000000001', { env: apiEnv() }), true);
  assert.equal(await video.providers.apivideo.removeLiveStream('liGONE', { env: apiEnv() }), true, 'a live stream already gone is the outcome we wanted');
});

test('the live driver is its own choice, and a host without a live half cannot pretend', () => {
  const env = { VIDEO_DRIVER: 'filemoon', FILEMOON_TOKEN: 'k', APIVIDEO_API_KEY: 'k' };
  assert.equal(video.liveDriver({ ...env, LIVE_DRIVER: 'apivideo' }), 'apivideo');
  assert.equal(video.liveDriver({ ...env, LIVE_DRIVER: 'filemoon' }), 'local',
    'Filemoon has no live capability, so naming it as the live driver must not stick');
  assert.equal(video.liveDriver(env), 'local', 'unset means today\'s behaviour: a seller pastes their own playlist');
  assert.equal(video.liveIngestEnabled({ ...env, LIVE_DRIVER: 'apivideo' }), true);
  assert.equal(video.liveIngestEnabled({ ...env, LIVE_DRIVER: 'apivideo', APIVIDEO_API_KEY: undefined }), false,
    'a driver whose credential is missing is not configured');
});

test('the CSP names the live host even when files go somewhere else', () => {
  /*
   * The shape a real deployment is most likely to have — files on one host, live on another
   * — and the bug that shape hid: building the media origins from the KIND routing alone
   * leaves a live playlist's origin unnamed, and hls.js is then refused by `connect-src`
   * with no error event at all. A black rectangle in a browser doing what the policy said.
   */
  const env = { VIDEO_DRIVER: 'filemoon', FILEMOON_TOKEN: 'k', LIVE_DRIVER: 'apivideo', APIVIDEO_API_KEY: 'k' };
  const origins = video.mediaOrigins(env);
  assert.ok(origins.includes('https://live.api.video'), 'the live origin must be allowed');
  assert.ok(origins.includes('https://cdn.api.video'), 'and the VOD asset origin beside it');
});

test('a delete goes to the host that holds the bytes, not to the configured one', async () => {
  await withDriver(async () => {
    const filemoonBefore = seen.length;
    const catboxBefore = seenCatbox.length;
    // The driver is catbox; the key says filemoon. The bytes are at Filemoon, so that is
    // where the delete has to go — otherwise switching providers would silently orphan
    // every file the previous host still holds.
    await storage.remove('filemoon/abc123');
    assert.equal(seen.slice(filemoonBefore).filter((c) => c.method === 'DELETE').length, 1,
      'the delete must reach the host named by the KEY');
    assert.equal(seenCatbox.length, catboxBefore, 'the configured driver must not be told about a file it never held');
  }, { driver: 'catbox' });
});

test('the router is provider-agnostic: a catbox key is remote, and asking for its bytes is named', async () => {
  await withDriver(async () => {
    assert.equal(storage.isRemote('catbox/stub99.mp4'), true);
    assert.equal(storage.routesToHost({ namespace: 'private', mimeType: 'video/mp4' }), true);
    await assert.rejects(storage.get('catbox/stub99.mp4'), (e) => e.code === 'EREMOTE');
    assert.equal(storage.isRemote('kyc/aaaa-bbbb.mp4'), false, 'the whitelist does not depend on which host is configured');
  }, { driver: 'catbox' });
});

// ── the client's type, and the door that used to drop it ────────────────────
//
// `POST /api/assets` is the JSON upload path a mobile client uses; the dashboard's
// publish form is the other door to the same bytes. The form always handed the router
// the mime type, the JSON route did not — and because the router falls back to the
// filename, the difference is invisible for a client that names its file `clip.mp4`.
// It only shows for the case `mediaKind`'s own comment calls the one that actually
// happens: a phone sending a correct `video/mp4` under a name with no extension.

test('the filename is a fallback, not a substitute for the type the client sent', async () => {
  await withDriver(async () => {
    // No type, no extension: nothing on earth can call this a video, and the safe
    // answer — our disk — is the right one.
    const anonymous = await storage.put(Buffer.from('bytes'), 'upload', {});
    assert.doesNotMatch(anonymous, /^filemoon\//, `a guess is not a routing decision: ${anonymous}`);

    // The SAME bytes with the type the client actually sent. This is the assertion the
    // old `/api/assets` failed, and it is deliberately about the key rather than about
    // a mock: the key is the promise about where the bytes are.
    const typed = await storage.put(Buffer.from('bytes'), 'upload', { mimeType: 'video/mp4' });
    assert.match(typed, /^filemoon\//, `the type the client sent must decide: ${typed}`);

    // And the lie browsers tell, which worked even before the fix — kept here so the
    // two cases are read together and neither is mistaken for the other.
    const lying = await storage.put(Buffer.from('bytes'), 'clip.MP4', { mimeType: 'application/octet-stream' });
    assert.match(lying, /^filemoon\//, `an extension is a fallback for a bad type: ${lying}`);
  });
});

test('every door that stores a seller\'s bytes hands the router the type', async () => {
  /*
   * A source guard, in the style `reports.test.js` uses for rules that live in
   * `server.js` and nowhere else. The bug this exists to prevent was not a wrong
   * decision anywhere — it was one call site dropping an argument it already had, in a
   * route no screen or walk exercises any more (`/api/assets` is the mobile contract;
   * the Android upload screen is gone). The next edit to add a third door gets told
   * here instead of by a seller whose video quietly stayed on our disk.
   */
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../server.js', import.meta.url), 'utf8');

  const handler = src.slice(src.indexOf("APP.post('/api/assets'"), src.indexOf('// Ops'));
  assert.ok(handler.length > 200, 'the /api/assets handler was not found — this guard needs updating');
  assert.match(
    handler,
    /storage\.put\(req\.file\.buffer,\s*req\.file\.originalname,\s*\{\s*mimeType:\s*req\.file\.mimetype\s*\}\)/,
    'the JSON upload route must pass the file\'s mime type to the router (VIDEO_STORAGE.md §2)',
  );
  assert.equal(
    /storage\.put\(\s*[^)]*\)/.test(handler), true,
    'the guard expects a storage.put in this handler — has the route been rewritten?',
  );
});

// ── what each host is FOR (§10.5) ───────────────────────────────────────────
//
// The correction this round makes: three providers are not three ways of doing one job.
// These assertions are the researched facts, in code, so that a future edit cannot drift
// back to "a video host is a video host".

test('a host is asked whether it takes this KIND of media, and only one of them is video-only', () => {
  const kindsOf = (host) => video.providers[host].capabilities.kinds;
  assert.deepEqual(kindsOf('filemoon'), ['video'],
    'Filemoon is a video host: its non-video uploads are download-only, which is a downgrade for us, not a feature');
  assert.ok(kindsOf('pixeldrain').includes('audio') && kindsOf('pixeldrain').includes('file'),
    'Pixeldrain is the generalist now — any file kind, direct urls, a real delete');
  assert.ok(kindsOf('catbox').includes('image'), 'Catbox takes images, which is what most of the web uses it for');
  assert.deepEqual(kindsOf('telegraph'), ['image'], 'the image host is an image host, and that is a limit worth writing down');

  /*
   * THE VOCABULARY IS `mediaKind`'S, AND THIS IS THE TEST THAT KEEPS IT THAT WAY.
   *
   * `kinds` is matched against the value `mediaKind()` returns — video, audio, image, or
   * `file` for everything else. The first draft of the Pixeldrain module declared
   * `['video','audio','image','archive','document']`, which reads perfectly and could never
   * match: `mediaKind` has no word `archive`, so every store archive, pdf and epub would
   * have stayed on our disk while the registry looked configured. A declaration that can
   * never be consulted is worse than a missing one, because it looks like the work is done.
   */
  const ROUTER_WORDS = ['video', 'audio', 'image', 'file'];
  for (const host of video.HOSTS) {
    for (const kind of kindsOf(host)) {
      assert.ok(ROUTER_WORDS.includes(kind),
        `${host} declares the kind "${kind}", which mediaKind() can never return — it can only ever be ${ROUTER_WORDS.join(', ')}`);
    }
  }

  // The predicate the router consults.
  assert.equal(video.hostAccepts('video', 'filemoon'), true);
  assert.equal(video.hostAccepts('audio', 'filemoon'), false, 'audio must never be sent to a video-only host');
  assert.equal(video.hostAccepts('audio', 'catbox'), true, 'Catbox declares audio; whether we MAY use it is the policy question below');
  assert.equal(video.hostAccepts('video', 'telegraph'), false, 'a host with no delete must never be handed a video');
  assert.equal(video.hostAccepts('video', 'local'), false, 'no host means no host');
});

test('each KIND of media can be routed to its own host — and an unconfigured kind stays home', () => {
  /*
   * The routing table, as behaviour rather than as a paragraph.
   *
   * With four hosts and three variables, "which host is configured" stopped having one
   * answer. This is the shape the whole round is about: a video and a photo from the same
   * seller can leave by different doors, and a kind nobody configured stays on our disk.
   */
  const env = {
    VIDEO_DRIVER: 'filemoon', IMAGE_DRIVER: 'telegraph', FILE_DRIVER: 'pixeldrain',
    FILEMOON_TOKEN: 'k', PIXELDRAIN_API_KEY: 'k',
  };
  assert.equal(video.driverForKind('video', env), 'filemoon');
  assert.equal(video.driverForKind('image', env), 'telegraph');
  assert.equal(video.driverForKind('audio', env), 'pixeldrain', 'audio falls through to the general host');
  assert.equal(video.driverForKind('file', env), 'pixeldrain', 'and so does an archive or a pdf');

  // A general host answers for the kinds it accepts, without needing a variable each.
  const generalOnly = { FILE_DRIVER: 'pixeldrain', PIXELDRAIN_API_KEY: 'k' };
  assert.equal(video.driverForKind('image', generalOnly), 'pixeldrain');
  assert.equal(video.driverForKind('video', generalOnly), 'pixeldrain');

  // A specific driver that does not accept the kind falls THROUGH rather than hijacking it.
  const wrongWayRound = { VIDEO_DRIVER: 'telegraph', FILE_DRIVER: 'pixeldrain', PIXELDRAIN_API_KEY: 'k' };
  assert.equal(video.driverForKind('video', wrongWayRound), 'pixeldrain',
    'a video must not be handed to a host that cannot delete it just because the variable says video');

  // No credentials, no hosts — the state a fresh clone and the demo are in.
  assert.equal(video.driverForKind('video', { VIDEO_DRIVER: 'filemoon' }), 'local',
    'a driver whose credential is missing is not configured, and a misconfigured host must not be used');
  assert.equal(video.driverForKind('image', {}), 'local');
  assert.equal(video.hostsEnabled({}), false);
  // In ROUTED_KINDS order, so the boot line reads video → audio → image → file and two runs
  // of the same deployment never differ in what they print.
  assert.deepEqual(video.activeHosts(env), [
    { host: 'filemoon', kinds: ['video'] },
    { host: 'pixeldrain', kinds: ['audio', 'file'] },
    { host: 'telegraph', kinds: ['image'] },
  ], 'the boot line names every kind that leaves, in the order an operator reads them');
});

test('a file a host would refuse is kept on our disk, and the seller never sees a failure', () => {
  /*
   * Found by booting, not by reading.
   *
   * With `IMAGE_DRIVER=telegraph` set, the demo seeder's own jpg made the whole seed throw:
   * the host refuses anything outside jpg/png/gif under 5 MB, and rather than keeping the
   * image it could not take, the first version of this routing failed the upload. A host's
   * cap must not become the PRODUCT's cap — our own disk serves every image perfectly well —
   * so the router asks about the FILE, and falls through to local storage when the answer is
   * no.
   */
  const env = {
    VIDEO_DRIVER: 'filemoon', FILEMOON_TOKEN: 'k',
    IMAGE_DRIVER: 'telegraph',
    FILE_DRIVER: 'pixeldrain', PIXELDRAIN_API_KEY: 'k',
  };
  const file = (extra) => ({ mimeType: 'image/png', filename: 'photo.png', size: 1024, ...extra });

  assert.equal(video.driverForKind('image', env, file()), 'telegraph', 'a small png is exactly what it is for');

  assert.equal(video.driverForKind('image', env, file({ size: 6 * 1024 * 1024 })), 'pixeldrain',
    'a 6 MB photo is over the image host\'s cap — the general host takes it instead');
  assert.equal(video.driverForKind('image', { ...env, FILE_DRIVER: '' }, file({ size: 6 * 1024 * 1024 })), 'local',
    'and with no general host configured it stays here, rather than failing the upload');

  assert.equal(video.driverForKind('image', env, file({ mimeType: 'image/svg+xml', filename: 'logo.svg' })), 'pixeldrain',
    'an svg is a picture everywhere except at an image host that takes jpg/png/gif');
  assert.equal(video.driverForKind('image', env, file({ mimeType: '', filename: 'cover.jpg' })), 'telegraph',
    'a file whose type was never declared is judged by its name — which is how the seeder calls it');

  // The sentence a person can act on, rather than a silent stay-at-home.
  const why = video.whyLocal('image', { ...env, FILE_DRIVER: '' }, file({ mimeType: 'image/svg+xml', filename: 'logo.svg' }));
  assert.match(why, /telegraph/, 'the reason names the host that said no');
  assert.match(why, /jpg, png or gif/);
  assert.equal(video.whyLocal('image', {}, file()), null, 'with nothing configured there is nothing to explain');
});

test('the router keeps a kind no configured host takes on our disk', async () => {
  // Not a hypothetical: this is the guard that stops a future "let audio go to the host"
  // edit from silently sending it to a host that would serve it as a download. The driver
  // here is Filemoon (video-only) with no general host configured, which is the default
  // deployment — so audio and images must stay.
  await withDriver(async () => {
    assert.equal(storage.routesToHost({ namespace: 'private', mimeType: 'audio/mpeg' }), false);
    assert.equal(storage.routesToHost({ namespace: 'private', mimeType: 'image/png' }), false);
    assert.equal(storage.routesToHost({ namespace: 'private', mimeType: 'video/mp4' }), true,
      'the one kind Filemoon is for still goes');
    assert.equal(storage.routesToHost({ namespace: 'kyc', mimeType: 'video/mp4' }), false,
      'identity documents never leave, whatever the routing table says');
    assert.equal(storage.routesToHost({ namespace: 'public', mimeType: 'video/mp4' }), false);
  });
});

test('the policy each host is used under is data, not a footnote', () => {
  // Catbox is the finding that matters: capable, and prohibited for exactly our use. Its
  // operator's own blog names "social spaces or other user generated content sites that
  // are using Catbox for file uploads" and says datacenter uploads will be filtered or
  // purged. A store platform is that description, so this flag has to exist and has to
  // say so — the doctor prints it and §10.5 records it.
  const catbox = video.providers.catbox.capabilities;
  assert.equal(catbox.policy.commercial, 'prohibited');
  assert.match(catbox.policy.note, /purged|CDN/i);
  assert.ok(catbox.blockedExtensions.includes('exe'), 'its own refusals are part of the picture');

  assert.equal(video.providers.filemoon.capabilities.policy.commercial, 'allowed');

  /*
   * The two new hosts, and the one flag between them that changes what the PRODUCT may do.
   *
   * Pixeldrain is `premium` for our use because hotlinking is its paid feature — a 302 from
   * a store's page to its url is precisely a hotlink, and its own error list says so. That
   * is a warning to give an operator, not a reason to refuse the upload: the bytes land,
   * the url works, and whether it will serve them to a viewer's browser is a fact about the
   * account.
   *
   * Telegra.ph's `deletable: false` is the load-bearing one. A store can remove a file from
   * its page; if the bytes are at a host with no delete, the product cannot honour that, so
   * the flag exists, `remove()` refuses in words, and the delete route reports it as
   * unconfirmed rather than claiming a clean removal.
   */
  assert.equal(video.providers.pixeldrain.capabilities.policy.commercial, 'premium');
  assert.match(video.providers.pixeldrain.capabilities.policy.note, /hotlink/i);
  assert.equal(video.providers.telegraph.capabilities.deletable, false);
  assert.equal(video.providers.telegraph.capabilities.maxBytes, 5 * 1024 * 1024);
  assert.equal(video.providers.telegraph.capabilities.policy.commercial, 'unknown');
  assert.match(video.providers.telegraph.capabilities.policy.note, /UNDOCUMENTED/);

  const verdict = video.hostSuitability('catbox');
  assert.equal(verdict.commercial, 'prohibited');
  assert.equal(video.hostSuitability('local').commercial, 'local');
});
