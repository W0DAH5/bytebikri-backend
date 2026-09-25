/**
 * Catbox, answering, for testing against a host that exists.
 *
 * The smallest stub of the three, because Catbox is the smallest API of the three: one
 * endpoint, a `reqtype` field, and a **plain-text** answer that is either a url or an
 * explanation. A client that expects JSON dies here, which is the point — that difference
 * is exactly what `src/video-catbox.js` exists to handle.
 *
 * It also serves the demo media it hands urls for, and honours `Range`, so a walk can
 * prove a video actually plays through this host rather than only that a redirect was
 * issued. Catbox's real support for range requests is unverified from here; the doctor
 * (`npm run video:check -- --driver=catbox`) probes it on a machine that can reach them.
 *
 *   node ci/stub-catbox.mjs [port] [--cap=bytes]
 *   VIDEO_DRIVER=catbox CATBOX_API_BASE=http://127.0.0.1:4002 \
 *     CATBOX_USERHASH=stub-userhash npm test --prefix app
 *
 * An instance that has to PLAY from this stub needs `CATBOX_FILE_BASE` as well, and it
 * is easy to leave out: the api host and the file host are different on the real
 * service, so the client rebuilds the url from the file base rather than reusing the
 * upload's answer. Leave it unset and playback quietly points at
 * `https://files.catbox.moe/…` — the real CDN, which this sandbox cannot reach — and the
 * walk fails with `MediaError code 4` and no network request to show for it.
 *
 *   CATBOX_FILE_BASE=http://127.0.0.1:4002 node scripts/boot.mjs
 */
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.argv[2]) || 4002;
const CAP = Number((/--cap=(\d+)/.exec(process.argv.join(' '))?.[1]) || process.env.STUB_CATBOX_CAP || 200 * 1024 * 1024);
const files = new Map();

const SEED = fileURLToPath(new URL('../app/seed-assets/', import.meta.url));
const MEDIA = (() => { try { return readFileSync(SEED + 'store-walkthrough.mp4'); } catch { return null; } })();

const readBody = (req) => new Promise((resolve) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => resolve(Buffer.concat(chunks)));
});

/** A minimal multipart reader: enough for `reqtype`, `userhash` and the file. */
function fieldsOf(buffer, contentType) {
  const boundary = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || '');
  if (!boundary) return {};
  const mark = Buffer.from(`--${(boundary[1] || boundary[2]).trim()}`);
  const out = {};
  let at = buffer.indexOf(mark);
  while (at !== -1) {
    const next = buffer.indexOf(mark, at + mark.length);
    const part = buffer.subarray(at + mark.length, next === -1 ? buffer.length : next);
    const split = part.indexOf('\r\n\r\n');
    if (split !== -1) {
      const head = part.subarray(0, split).toString('utf8');
      const name = /name="([^"]+)"/.exec(head)?.[1];
      const value = part.subarray(split + 4, part.length - 2);
      if (name) out[name] = /filename="/.test(head) ? { bytes: value.length } : value.toString('utf8');
    }
    at = next;
  }
  return out;
}

const server = http.createServer(async (req, res) => {
  const raw = await readBody(req);
  const url = new URL(req.url, 'http://127.0.0.1');

  // The files themselves: `https://files.catbox.moe/<name>` in production, plain text,
  // no token, and ranged so a viewer can scrub.
  const media = /^\/([A-Za-z0-9._-]+)$/.exec(url.pathname);
  if (media && req.method === 'GET') {
    const name = media[1];
    const found = files.get(name);
    if (!found) { res.writeHead(404); return res.end('File not found'); }
    const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || ''));
    if (!range) {
      res.writeHead(200, { 'content-type': 'video/mp4', 'accept-ranges': 'bytes', 'content-length': MEDIA.length });
      return res.end(MEDIA);
    }
    const start = range[1] ? Number(range[1]) : 0;
    const end = range[2] ? Math.min(Number(range[2]), MEDIA.length - 1) : MEDIA.length - 1;
    if (start > end || start >= MEDIA.length) {
      res.writeHead(416, { 'content-range': `bytes */${MEDIA.length}` });
      return res.end();
    }
    res.writeHead(206, {
      'content-type': 'video/mp4',
      'accept-ranges': 'bytes',
      'content-range': `bytes ${start}-${end}/${MEDIA.length}`,
      'content-length': end - start + 1,
    });
    return res.end(MEDIA.subarray(start, end + 1));
  }

  if (url.pathname !== '/user/api.php' || req.method !== 'POST') {
    res.writeHead(404);
    return res.end('404');
  }

  const fields = fieldsOf(raw, req.headers['content-type']);
  if (!fields.userhash) {
    // The real host accepts anonymous uploads; with no userhash, though, nobody can delete
    // them again, so a client that forgets the field fails loudly here rather than
    // silently filing a store's video under nothing.
    res.writeHead(200, { 'content-type': 'text/plain' });
    return res.end('Anonymous uploads are disabled on this stub: no userhash');
  }

  if (fields.reqtype === 'fileupload') {
    const size = fields.fileToUpload?.bytes ?? 0;
    if (size > CAP) {
      res.writeHead(200, { 'content-type': 'text/plain' });
      return res.end(`File too large, max ${Math.round(CAP / 1024 / 1024)}MB`);
    }
    const name = `${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-3)}.mp4`;
    files.set(name, { name, size });
    res.writeHead(200, { 'content-type': 'text/plain' });
    return res.end(`http://127.0.0.1:${PORT}/${name}`);
  }

  if (fields.reqtype === 'deletefiles') {
    const names = String(fields.files || '').trim().split(/\s+/).filter(Boolean);
    for (const name of names) files.delete(name.replace(/^https?:\/\/[^/]+\//, ''));
    res.writeHead(200, { 'content-type': 'text/plain' });
    return res.end('success');
  }

  res.writeHead(200, { 'content-type': 'text/plain' });
  res.end('Invalid reqtype');
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`stub Catbox on http://127.0.0.1:${PORT} (cap ${Math.round(CAP / 1024 / 1024)} MB)`);
  console.log('  VIDEO_DRIVER=catbox CATBOX_API_BASE=http://127.0.0.1:%d \\', PORT);
  console.log("    CATBOX_USERHASH='stub-userhash' npm test --prefix app");
});
