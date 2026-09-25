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
// Three providers share one seam, and the facts that make them different are the ones
// worth asserting: Catbox answers in plain text and has no id beyond the file's name;
// GoFile wraps its answers in a `status` field that beats the HTTP code, and a free
// account cannot produce a playable link at all. Each gets its own in-process stub,
// because what these tests ask is "what did the client actually send".

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
  assert.deepEqual(video.HOSTS, ['filemoon', 'gofile', 'catbox']);
  assert.equal(video.videoDriver({ VIDEO_DRIVER: 'FILEMOON ' }), 'filemoon');
  assert.equal(video.videoDriver({ VIDEO_DRIVER: 'nope' }), 'local',
    'a typo in an env file must leave every byte on disk, not pick another host');
  assert.equal(video.videoDriver({}), 'local');
});

test('a key names the host that holds the bytes, and cannot be talked into naming another', () => {
  const uuid = 'd4c5e6f7-a8b9-4c0d-9e1f-2a3b4c5d6e7f';
  assert.equal(video.remoteKey('abc123.mp4', 'catbox'), 'catbox/abc123.mp4');
  assert.equal(video.remoteKey(uuid, 'gofile'), `gofile/${uuid}`);
  assert.equal(video.remoteKey('AbC_-9', 'filemoon'), 'filemoon/AbC_-9');

  assert.equal(video.remoteProvider('catbox/abc123.mp4'), 'catbox');
  assert.equal(video.remoteId('gofile/' + uuid), uuid);
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

const seenGofile = [];
let gofileTier = 'premium';
const gofileStub = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = Buffer.concat(chunks);
  const url = new URL(req.url, 'http://127.0.0.1');
  seenGofile.push({ path: url.pathname, auth: req.headers.authorization, bytes: body.length, tier: gofileTier });
  const json = (payload) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(payload)); };
  if (url.pathname === '/accounts/getid') return json({ status: 'ok', data: { id: 'stub-account', tier: gofileTier } });
  if (gofileTier !== 'premium' && url.pathname !== '/accounts/getid') {
    // The documented trap: HTTP 200 carrying an error status.
    return json({ status: 'error-notPremium' });
  }
  if (url.pathname === '/uploadfile') {
    return json({ status: 'ok', data: { id: 'aaaa-bbbb-cccc-dddd', name: 'clip.mp4', downloadPage: 'https://gofile.io/d/stubCode' } });
  }
  if (url.pathname.endsWith('/directlinks')) {
    return json({ status: 'ok', data: { id: 'link1', directLink: 'https://store.gofile.io/download/direct/link1/clip.mp4' } });
  }
  if (url.pathname === '/contents' && req.method === 'DELETE') return json({ status: 'ok', data: {} });
  return json({ status: 'error-notFound' });
});
let gofileBase = '';
before(async () => {
  await new Promise((resolve) => gofileStub.listen(0, '127.0.0.1', resolve));
  gofileBase = `http://127.0.0.1:${gofileStub.address().port}`;
});
after(async () => { await new Promise((resolve) => gofileStub.close(resolve)); });

const gofileEnv = (extra = {}) => ({
  ...process.env,
  VIDEO_DRIVER: 'gofile',
  GOFILE_TOKEN: 'stub-token',
  GOFILE_API_BASE: gofileBase,
  GOFILE_UPLOAD_BASE: gofileBase,
  ...extra,
});

test('GoFile: premium account — upload goes to the upload host, playback to the api host', async () => {
  gofileTier = 'premium';
  video.forgetAccount();
  const before = seenGofile.length;
  const out = await video.upload(Buffer.from('pretend video'), 'clip.mp4', { mimeType: 'video/mp4', env: gofileEnv() });
  assert.equal(out.key, 'gofile/aaaa-bbbb-cccc-dddd');
  const found = await video.playback(out.id, { provider: 'gofile', env: gofileEnv() });
  assert.equal(found.kind, 'file');
  assert.match(found.url, /\/direct\/link1\/clip\.mp4$/);
  const paths = seenGofile.slice(before).map((c) => c.path);
  assert.deepEqual(paths, ['/accounts/getid', '/uploadfile', '/contents/aaaa-bbbb-cccc-dddd/directlinks'],
    'the tier is checked first, then the bytes travel to the upload host, then a direct link is minted');
  assert.ok(seenGofile.slice(before).every((c) => c.auth === 'Bearer stub-token'), 'every call carries the bearer');
});

test('GoFile: a 200 carrying an error status is an ERROR, because `status` is the truth', async () => {
  gofileTier = 'free';
  video.forgetAccount();
  await assert.rejects(
    video.playback('aaaa-bbbb-cccc-dddd', { provider: 'gofile', env: gofileEnv() }),
    (e) => e.name === 'VideoApiError' && /error-notPremium/.test(e.message),
    'a client that trusted the HTTP code would read this as success',
  );
});

test('GoFile: a free account is refused BEFORE the bytes are sent, and told why', async () => {
  gofileTier = 'free';
  video.forgetAccount();
  const before = seenGofile.length;
  await assert.rejects(
    video.upload(Buffer.alloc(4096), 'clip.mp4', { mimeType: 'video/mp4', env: gofileEnv() }),
    (e) => e.name === 'VideoApiError'
      && /free tier cannot produce a playable link/.test(e.message)
      && /premium/i.test(e.message),
  );
  const calls = seenGofile.slice(before);
  assert.deepEqual(calls.map((c) => c.path), ['/accounts/getid'],
    'the tier is the only thing that should have been asked — no upload, because a file it cannot play is worse than a refusal');
  gofileTier = 'premium';
  video.forgetAccount();
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
