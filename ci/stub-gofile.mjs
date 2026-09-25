/**
 * GoFile, answering, for testing against a host that exists.
 *
 * A mock of the PROVIDER, not of our client: `app/test/video.test.js` brings its own
 * in-process stub because it asserts on the requests it sent, while this one exists for
 * every other test file whose author never expected a video upload to need a network.
 *
 * Faithful to the documented surface, including the parts that are inconvenient:
 *
 *   * **HTTP 200 with an error status.** `{status: 'error-notPremium'}` under a 200 is
 *     the behaviour the reference warns about in as many words, so the stub can be asked
 *     to produce it (`--tier=free`) and a client that trusts the HTTP code will fail here.
 *   * **`/accounts/getid`** returns the tier; `--tier=premium` (the default) is what makes
 *     the upload path usable at all, since a free account cannot produce a playable link.
 *   * **Uploads live at their own hostname** (`upload.gofile.io` in production). Here the
 *     same server answers both, because a stub that needed two ports would make the tests
 *     that use it harder to read than the thing they test.
 *   * **Direct links are a separate call** and are what a player needs; the media url they
 *     return actually serves the demo fixtures, `Range` included, so a walk can prove the
 *     picture advances instead of only proving a redirect exists.
 *
 *   node ci/stub-gofile.mjs [port] [--tier=free|premium]
 *   VIDEO_DRIVER=gofile GOFILE_API_BASE=http://127.0.0.1:4001 \
 *     GOFILE_UPLOAD_BASE=http://127.0.0.1:4001 GOFILE_TOKEN=stub-token \
 *     npm test --prefix app
 *
 * The walk needs one more variable, because a MEDIA origin is not an API origin: the
 * direct link this host hands back is `https://store.gofile.io/…` in production (covered
 * by the CSP's `https:` allowance for media) but plain `http` here, and CSP judges a
 * redirect's destination. Without it the player never makes the request at all — see
 * `ci/eyes/video-host-walk.mjs` and `VIDEO_STORAGE.md` §10.4.
 *
 *   VIDEO_MEDIA_ORIGINS=http://127.0.0.1:4001 node scripts/boot.mjs
 */
import http from 'node:http';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.argv[2]) || 4001;
const TIER = (/--tier=([a-z]+)/.exec(process.argv.join(' '))?.[1]) || process.env.STUB_GOFILE_TIER || 'premium';
const files = new Map();

const SEED = fileURLToPath(new URL('../app/seed-assets/', import.meta.url));
const readIf = (name) => { try { return readFileSync(SEED + name); } catch { return null; } };
const MEDIA = readIf('store-walkthrough.mp4');

const readBody = (req) => new Promise((resolve) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => resolve(Buffer.concat(chunks)));
});

/**
 * Bytes, with the one header a media element cares about.
 *
 * A `<video>` asks for a RANGE and decides from the answer whether it can seek, so a stub
 * that always answers 200 with the whole file would make `video:check`'s range probe —
 * and any walk that tries to scrub — report a real host's behaviour wrongly. The stub
 * serves ranges because a storage server does; whether the REAL one does is what the
 * probe on a machine with egress is for.
 */
const serveBytes = (req, res, type, buf) => {
  if (!buf) {
    res.writeHead(404, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ status: 'error-notFound' }));
  }
  const headers = { 'content-type': type, 'accept-ranges': 'bytes', 'cache-control': 'no-store' };
  const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || ''));
  if (!range) {
    res.writeHead(200, { ...headers, 'content-length': buf.length });
    return res.end(buf);
  }
  const start = range[1] ? Number(range[1]) : 0;
  const end = range[2] ? Math.min(Number(range[2]), buf.length - 1) : buf.length - 1;
  if (start > end || start >= buf.length) {
    res.writeHead(416, { ...headers, 'content-range': `bytes */${buf.length}` });
    return res.end();
  }
  res.writeHead(206, {
    ...headers,
    'content-range': `bytes ${start}-${end}/${buf.length}`,
    'content-length': end - start + 1,
  });
  res.end(buf.subarray(start, end + 1));
};

const server = http.createServer(async (req, res) => {
  const body = await readBody(req);
  const url = new URL(req.url, 'http://127.0.0.1');
  const json = (code, payload) => {
    res.writeHead(code, { 'content-type': 'application/json' });
    res.end(JSON.stringify(payload));
  };

  // The media itself: no token, because a `<video>` cannot send one. In production this is
  // a signed url on the storage servers.
  const direct = /^\/download\/direct\/([A-Za-z0-9-]+)\/(.+)$/.exec(decodeURIComponent(url.pathname));
  if (direct && req.method === 'GET') {
    return serveBytes(req, res, files.get(direct[1])?.mimetype || 'video/mp4', MEDIA);
  }

  // `status`, not HTTP, is the truth for this API — an unauthenticated request gets 401
  // because the reference says so, and a valid token on a free account gets 200 with an
  // error status, which is the trap this stub can be asked to reproduce.
  if (!String(req.headers.authorization || '').startsWith('Bearer ')) {
    return json(401, { status: 'error-token' });
  }

  if (url.pathname === '/accounts/getid' && req.method === 'GET') {
    return json(200, { status: 'ok', data: { id: 'stub-account', email: 'stub@example.test', tier: TIER } });
  }

  if (url.pathname === '/uploadfile' && req.method === 'POST') {
    if (TIER !== 'premium') {
      // The documented shape of a refusal on the free tier. HTTP 200 on purpose.
      return json(200, { status: 'error-notPremium' });
    }
    const id = crypto.createHash('sha256').update(body).digest('hex').slice(0, 32).replace(/(.{8})(?=.)/g, '$1-');
    files.set(id, { id, mimetype: 'video/mp4', name: 'stub.mp4' });
    return json(200, {
      status: 'ok',
      data: {
        id,
        type: 'file',
        name: 'stub.mp4',
        parentFolder: 'stub-folder',
        parentFolderCode: 'stubCode1',
        downloadPage: `http://127.0.0.1:${PORT}/d/stubCode1`,
        code: 'stubCode1',
        size: body.length,
        mimetype: 'video/mp4',
        createTime: Math.floor(Date.now() / 1000),
        servers: ['store-1'],
      },
    });
  }

  const links = /^\/contents\/([A-Za-z0-9-]+)\/directlinks$/.exec(url.pathname);
  if (links && req.method === 'POST') {
    if (TIER !== 'premium') return json(200, { status: 'error-notPremium' });
    const id = links[1];
    if (!files.has(id)) return json(404, { status: 'error-notFound' });
    return json(200, {
      status: 'ok',
      data: {
        id: 'stub-direct-link',
        directLink: `http://127.0.0.1:${PORT}/download/direct/${id}/stub.mp4`,
        expireTime: 4102444800,
        sourceIpsAllowed: [],
      },
    });
  }

  const one = /^\/contents\/([A-Za-z0-9-]+)$/.exec(url.pathname);
  if (one && req.method === 'GET') {
    if (TIER !== 'premium') return json(200, { status: 'error-notPremium' });
    const found = files.get(one[1]);
    if (!found) return json(404, { status: 'error-notFound' });
    return json(200, { status: 'ok', data: found });
  }

  if (url.pathname === '/contents' && req.method === 'DELETE') {
    for (const id of JSON.parse(String(body || '{}')).contentsId || []) files.delete(id);
    return json(200, { status: 'ok', data: {} });
  }

  return json(404, { status: 'error-notFound' });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`stub GoFile on http://127.0.0.1:${PORT} (tier: ${TIER})`);
  console.log('  VIDEO_DRIVER=gofile GOFILE_API_BASE=http://127.0.0.1:%d \\', PORT);
  console.log("    GOFILE_UPLOAD_BASE=http://127.0.0.1:%d GOFILE_TOKEN='stub-token' npm test --prefix app", PORT);
});
