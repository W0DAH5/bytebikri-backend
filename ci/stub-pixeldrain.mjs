/**
 * A Pixeldrain that answers, for testing against one that exists.
 *
 * `app/src/video-pixeldrain.js` was written in an environment with no egress to
 * pixeldrain.com (TLS reset before the handshake; `api.github.com` answers, so it is an
 * allowlist rather than a broken network). This stands in for it, implementing the
 * documented surface and nothing else:
 *
 *   PUT    /api/file/{filename}      raw body — the API recommends this over the form
 *   GET    /api/file/{id}/info       the file's record
 *   GET    /api/file/{id}            the bytes, byte ranges included
 *   DELETE /api/file/{id}            a real delete, 404 once it is gone
 *   GET    /api/user                 who the key belongs to
 *
 * Three behaviours worth knowing when reading a failure:
 *
 *   * **The credential is HTTP Basic with the key in the PASSWORD field.** A client that
 *     sends a bearer, or puts the key in the username, is refused here exactly as the
 *     real host refuses it — otherwise the one mistake this module's shape invites would
 *     pass every test.
 *   * **`hotlink` mode** (`--hotlink`) answers 403 `hotlink_detected` for a media fetch
 *     that carries a `Referer` from another origin, which is what the real host does to
 *     pages that embed its urls. It exists so the doctor's and the walk's handling of
 *     that refusal can be exercised without a paid account.
 *   * **`--cap=bytes`** refuses an upload that is too large, so the local size refusal and
 *     the host's own can be told apart.
 *
 *   node ci/stub-pixeldrain.mjs [port] [--hotlink] [--cap=bytes]
 *   VIDEO_DRIVER=filemoon FILE_DRIVER=pixeldrain PIXELDRAIN_API_BASE=http://127.0.0.1:4003/api \
 *     PIXELDRAIN_API_KEY=stub-key npm test --prefix app
 *
 * A walk needs the media origin as well, because CSP judges a redirect's destination:
 *   VIDEO_MEDIA_ORIGINS=http://127.0.0.1:4003 node scripts/boot.mjs
 */
import http from 'node:http';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.argv[2]) || 4003;
const HOTLINK = process.argv.includes('--hotlink') || Boolean(process.env.STUB_PIXELDRAIN_HOTLINK);
const CAP = Number(/--cap=(\d+)/.exec(process.argv.join(' '))?.[1] || 0) || null;
const KEY = process.env.STUB_PIXELDRAIN_KEY || 'stub-key';
const files = new Map();

const SEED = fileURLToPath(new URL('../app/seed-assets/', import.meta.url));
const readIf = (name) => { try { return readFileSync(SEED + name); } catch { return null; } };
/*
 * Real bytes where the repository has them, and a generated png where it does not: this
 * stub has to serve something a browser will render for an image upload, and
 * `app/seed-assets/` holds videos and an audio tone but no picture. Making the picture is
 * cheaper than committing one nothing else uses.
 */
const MEDIA = { mp4: readIf('store-walkthrough.mp4'), wav: readIf('bell-tone.wav'), png: null };
MEDIA.png = (() => {
  const zlib = createRequire(import.meta.url)('node:zlib');
  const row = Buffer.alloc(1 + 96 * 3);
  for (let x = 0; x < 96; x += 1) { row[1 + x * 3] = 40 + Math.round((200 * x) / 96); row[2 + x * 3] = 30; row[3 + x * 3] = 200; }
  const rows = Buffer.concat(Array.from({ length: 54 }, () => row));
  const chunk = (tag, data) => {
    const body = Buffer.concat([Buffer.from(tag, 'latin1'), data]);
    const length = Buffer.alloc(4); length.writeUInt32BE(data.length, 0);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(body) >>> 0, 0);
    return Buffer.concat([length, body, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(96, 0); ihdr.writeUInt32BE(54, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(rows, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
})();

const readBody = (req) => new Promise((resolve) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => resolve(Buffer.concat(chunks)));
});

/** Basic auth, with the key in the password field — the only shape this host accepts. */
function authenticated(req) {
  const header = String(req.headers.authorization || '');
  if (!header.startsWith('Basic ')) return false;
  const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
  const password = decoded.slice(decoded.indexOf(':') + 1);
  return password === KEY;
}

const bytesFor = (record) => {
  if (record.bytes) return record.bytes;
  const type = record.mime_type || '';
  if (type.startsWith('video/')) return MEDIA.mp4;
  if (type.startsWith('image/')) return MEDIA.png;
  if (type.startsWith('audio/')) return MEDIA.wav;
  return MEDIA.mp4;
};

const server = http.createServer(async (req, res) => {
  const body = await readBody(req);
  const url = new URL(req.url, 'http://127.0.0.1');
  const json = (code, payload) => {
    res.writeHead(code, { 'content-type': 'application/json' });
    res.end(JSON.stringify(payload));
  };

  const api = /^\/api\/(.+)$/.exec(url.pathname);
  const path = api ? `/${api[1]}` : null;

  // ── the credential ────────────────────────────────────────────────────────
  // Uploading, deleting and the account check all require the key. Reading does not:
  // a viewer's browser fetching a file carries no credentials, which is the whole point
  // of a direct url.
  const needsAuth = /^\/file\/[^/]+$/.test(path || '') && req.method === 'DELETE'
    || path === '/file' || (path || '').startsWith('/file/') && req.method === 'PUT'
    || path === '/user';
  if (needsAuth && !authenticated(req)) {
    return json(401, { success: false, value: 'unauthorized', message: 'invalid API key' });
  }

  if (path === '/user' && req.method === 'GET') {
    return json(200, { success: true, id: 'stub-user', username: 'stub', email: 'stub@example.test', subscription: { id: 'free', name: 'Free' } });
  }

  // ── upload: raw body, name in the path ────────────────────────────────────
  const put = /^\/file\/(.+)$/.exec(path || '');
  if (put && req.method === 'PUT') {
    const name = decodeURIComponent(put[1]);
    if (CAP && body.length > CAP) {
      return json(413, { success: false, value: 'file_too_large', message: `maximum size is ${CAP} bytes` });
    }
    if (!body.length) return json(400, { success: false, value: 'no_file', message: 'The file does not exist or is empty' });
    // Stable id from the bytes, so the same fixture uploaded twice keeps its key and a
    // test's output does not churn.
    const id = crypto.createHash('sha256').update(body).digest('hex').slice(0, 12);
    files.set(id, {
      id, name, size: body.length, bytes: body,
      mime_type: String(req.headers['content-type'] || 'application/octet-stream'),
      views: 0, downloads: 0, date_upload: new Date().toISOString(),
    });
    return json(201, { success: true, id, name, size: body.length });
  }

  const info = /^\/file\/([^/]+)\/info$/.exec(path || '');
  if (info && req.method === 'GET') {
    const record = files.get(info[1]);
    if (!record) return json(404, { success: false, value: 'not_found', message: 'The file does not exist' });
    const { bytes, ...visible } = record;
    return json(200, { success: true, ...visible, thumbnail_href: `/file/${record.id}/thumbnail`, availability: '', can_download: true });
  }

  const one = /^\/file\/([^/]+)$/.exec(path || '');
  if (one && req.method === 'DELETE') {
    if (!files.has(one[1])) return json(404, { success: false, value: 'not_found', message: 'The file does not exist' });
    files.delete(one[1]);
    return json(200, { success: true });
  }
  if (one && req.method === 'GET') {
    const record = files.get(one[1]);
    if (!record) return json(404, { success: false, value: 'not_found', message: 'The file does not exist' });
    /*
     * The hotlink rule, which is the reason this host is classified `premium` for our
     * use: a fetch that carries somebody else's page as its referrer is refused unless
     * the account pays. Real browsers send one; that is exactly the traffic this product
     * creates with its 302.
     */
    const referer = String(req.headers.referer || '');
    if (HOTLINK && referer && !referer.startsWith(`http://127.0.0.1:${PORT}`)) {
      return json(403, { success: false, value: 'hotlink_detected', message: 'Hotlinking was detected, hotlinking is only allowed with a premium subscription' });
    }
    const buf = bytesFor(record);
    if (!buf) return json(500, { success: false, value: 'internal', message: 'the stub has no media — is app/seed-assets present?' });
    record.views += 1;
    // Ranges, because "our player, their delivery" is a claim about seeking too.
    const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || ''));
    const headers = { 'content-type': record.mime_type, 'accept-ranges': 'bytes', 'cache-control': 'no-store' };
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
    return res.end(buf.subarray(start, end + 1));
  }

  return json(404, { success: false, value: 'not_found', message: 'no such endpoint' });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`stub Pixeldrain on http://127.0.0.1:${PORT}${HOTLINK ? ' (hotlink refusals on)' : ''}${CAP ? ` (cap ${CAP} bytes)` : ''}`);
  // The base INCLUDES `/api`, because the real one does (https://pixeldrain.com/api) —
  // a stub whose base differed from production's would hide exactly the class of bug it
  // exists to catch.
  console.log('  VIDEO_DRIVER=filemoon FILE_DRIVER=pixeldrain PIXELDRAIN_API_BASE=http://127.0.0.1:%d/api \\', PORT);
  console.log("    PIXELDRAIN_API_KEY='stub-key' npm test --prefix app");
});
