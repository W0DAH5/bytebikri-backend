/**
 * A Telegra.ph that answers, for testing against one that exists.
 *
 * The real endpoint is undocumented (`app/src/video-telegraph.js` explains why that
 * matters), so this implements what its users have established it does:
 *
 *   POST /upload        multipart, field `file`
 *     → [{"src":"/file/<hash>.<ext>"}]     when it likes the file
 *     → {"error":"FILE_TYPE_INVALID"}      when it does not
 *   GET  /file/{name}   the bytes, byte ranges included
 *
 * Three behaviours worth knowing when reading a failure:
 *
 *   * **There is no delete.** Nothing on this stub will remove a file, because nothing on
 *     the real host will either — so a test that asserts `remove()` refuses is asserting
 *     the truth rather than the stub's mood.
 *   * **`--off` makes `/upload` answer 404**, which is the failure mode that matters most
 *     for an undocumented endpoint: it may simply stop existing. The doctor says so in
 *     those words, and this switch is how that path is exercised.
 *   * **The size and type are checked the way the host checks them** — 5 MB and jpg/png/
 *     gif — AFTER the bytes arrive, which is precisely why the client checks both before
 *     sending anything.
 *
 *   node ci/stub-telegraph.mjs [port] [--off]
 *   IMAGE_DRIVER=telegraph TELEGRAPH_UPLOAD_BASE=http://127.0.0.1:4004/upload \
 *     TELEGRAPH_FILE_BASE=http://127.0.0.1:4004 npm test --prefix app
 *
 * A walk needs the media origin as well, because CSP judges a redirect's destination:
 *   VIDEO_MEDIA_ORIGINS=http://127.0.0.1:4004 node scripts/boot.mjs
 */
import http from 'node:http';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.argv[2]) || 4004;
const OFF = process.argv.includes('--off') || Boolean(process.env.STUB_TELEGRAPH_OFF);
const CAP = 5 * 1024 * 1024;
const files = new Map();

const SEED = fileURLToPath(new URL('../app/seed-assets/', import.meta.url));
const readIf = (name) => { try { return readFileSync(SEED + name); } catch { return null; } };
/** A generated png for the one path that has no stored bytes — see the pixeldrain stub. */
const PNG = (() => {
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

/** Enough multipart for one file field: the name, the type, and the bytes. */
function filePart(buffer, contentType) {
  const boundary = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || '');
  if (!boundary) return null;
  const mark = Buffer.from(`--${(boundary[1] || boundary[2]).trim()}`);
  let at = buffer.indexOf(mark);
  while (at !== -1) {
    const next = buffer.indexOf(mark, at + mark.length);
    const part = buffer.subarray(at + mark.length, next === -1 ? buffer.length : next);
    const split = part.indexOf('\r\n\r\n');
    if (split !== -1) {
      const head = part.subarray(0, split).toString('utf8');
      if (/name="file"/.test(head)) {
        return {
          type: /content-type:\s*([^\r\n;]+)/i.exec(head)?.[1]?.trim().toLowerCase() || '',
          filename: /filename="([^"]*)"/.exec(head)?.[1] || '',
          bytes: part.subarray(split + 4, part.length - 2),
        };
      }
    }
    at = next;
  }
  return null;
}

const EXT = { 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/gif': 'gif' };

const server = http.createServer(async (req, res) => {
  const body = await readBody(req);
  const url = new URL(req.url, 'http://127.0.0.1');
  const json = (code, payload) => {
    res.writeHead(code, { 'content-type': 'application/json' });
    res.end(JSON.stringify(payload));
  };

  if (url.pathname === '/upload' && req.method === 'POST') {
    // The discontinued-endpoint case, which is the one an undocumented API invites.
    if (OFF) return json(404, { error: 'NOT_FOUND' });
    const part = filePart(body, req.headers['content-type']);
    if (!part) return json(400, { error: 'FILE_MISSING' });
    if (part.bytes.length > CAP) return json(400, { error: 'FILE_TOO_BIG' });
    const ext = EXT[part.type];
    if (!ext) return json(400, { error: 'FILE_TYPE_INVALID' });
    // Telegraph names the file after a hash of its bytes; stable, so tests do not churn.
    const name = `${crypto.createHash('sha256').update(part.bytes).digest('hex').slice(0, 24)}.${ext}`;
    files.set(name, { bytes: part.bytes, type: part.type });
    return json(200, [{ src: `/file/${name}` }]);
  }

  const one = /^\/file\/([A-Za-z0-9][A-Za-z0-9._-]*)$/.exec(url.pathname);
  if (one && req.method === 'GET') {
    const record = files.get(one[1]);
    if (!record) return json(404, { error: 'FILE_NOT_FOUND' });
    const buf = record.bytes?.length ? record.bytes : PNG;
    if (!buf) return json(500, { error: 'STUB_HAS_NO_MEDIA' });
    const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || ''));
    const headers = { 'content-type': record.type, 'accept-ranges': 'bytes', 'cache-control': 'no-store' };
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

  // Deliberately absent, and worth being explicit about: there is no delete path here
  // because there is none on the real host.
  return json(404, { error: 'NOT_FOUND' });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`stub Telegra.ph on http://127.0.0.1:${PORT}${OFF ? ' (UPLOAD DISABLED — the discontinued case)' : ''}`);
  console.log('  IMAGE_DRIVER=telegraph TELEGRAPH_UPLOAD_BASE=http://127.0.0.1:%d/upload \\', PORT);
  console.log('    TELEGRAPH_FILE_BASE=http://127.0.0.1:%d npm test --prefix app', PORT);
});
