/**
 * A video host that answers, for testing against one that exists.
 *
 * `VIDEO_STORAGE.md` §9 wants the suite green with `VIDEO_DRIVER=filemoon` as well as
 * without it, and it cannot be green against the real host: the provider is a paid
 * service, the tests would put bytes on somebody's account every run, and the sandbox
 * this was written in cannot reach it at all. This stands in — it implements exactly
 * the documented surface, answers fast, and remembers nothing.
 *
 * It is NOT a mock of the product's client: it is a mock of the PROVIDER. The tests in
 * `app/test/video.test.js` bring their own stub, because they assert on the requests
 * they sent; this one exists for every OTHER test file, whose authors never expected a
 * video upload to need a network at all.
 *
 *   node ci/stub-filemoon.mjs [port]      # 3999 by default
 *   VIDEO_DRIVER=filemoon FILEMOON_API_BASE=http://127.0.0.1:3999 \
 *     FILEMOON_TOKEN='147|stub-token-abcdefghijklmnop' npm test
 *
 * Two behaviours worth knowing when reading a failure:
 *
 *   * `/files/upload` answers with an id derived from the bytes, so the same fixture
 *     uploaded twice gets the same key. That keeps a test's output stable, which is the
 *     only reason it is not random.
 *   * `playback_url` is a progressive url and there is no `hls_url`, so the client
 *     classifies it as a file — the simple path, which is what a test environment
 *     should exercise by default. Putting `--hls` on the command line hands back an
 *     `hls_url` instead, for the playlist path.
 *   * the media urls it hands out actually SERVE media, out of the demo fixtures in
 *     `app/seed-assets/`. That is what makes `ci/eyes/video-host-walk.mjs` able to
 *     prove the thing that matters most — that a hosted file plays in our player
 *     through the redirect — without the real host being reachable. The progressive
 *     url is `store-walkthrough.mp4` (5 s) and the playlist is a VOD playlist over
 *     the three `live-demo` segments, cut together here rather than in the fixtures
 *     so that it ends: a file has a duration, and a viewer who seeks in it should
 *     land somewhere.
 */
import http from 'node:http';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SEED = fileURLToPath(new URL('../app/seed-assets/', import.meta.url));
const readIf = (name) => {
  try { return readFileSync(SEED + name); } catch { return null; }
};
const MEDIA = {
  mp4: readIf('store-walkthrough.mp4'),
  segments: [readIf('live-demo/seg0.ts'), readIf('live-demo/seg1.ts'), readIf('live-demo/seg2.ts')],
};
const SEG_SECONDS = 1.666667;
const playlistFor = () => Buffer.from([
  '#EXTM3U',
  '#EXT-X-VERSION:3',
  `#EXT-X-TARGETDURATION:${Math.ceil(SEG_SECONDS)}`,
  '#EXT-X-MEDIA-SEQUENCE:0',
  '#EXT-X-PLAYLIST-TYPE:VOD',
  ...MEDIA.segments.flatMap((_segment, i) => [`#EXTINF:${SEG_SECONDS},`, `seg${i}.ts`]),
  '#EXT-X-ENDLIST',
  '',
].join('\n'));

/**
 * Bytes, with the one header a media element cares about.
 *
 * A `<video>` asks for a RANGE and decides from the answer whether it can seek. A stub
 * that always answers 200 with the whole file plays, but reports a stream the viewer
 * cannot scrub — which would make the walk's own seeking claim false in a way no other
 * test could see.
 */
const serveBytes = (req, res, type, buf) => {
  if (!buf) return jsonCode(res, 404, { message: 'the stub has no such media — is app/seed-assets present?' });
  const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || ''));
  const headers = { 'content-type': type, 'accept-ranges': 'bytes', 'cache-control': 'no-store' };
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

const PORT = Number(process.argv[2]) || 3999;
const WANT_HLS = process.argv.includes('--hls') || Boolean(process.env.STUB_HLS);
const files = new Map();

const readBody = (req) => new Promise((resolve) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => resolve(Buffer.concat(chunks)));
});

const server = http.createServer(async (req, res) => {
  const body = await readBody(req);
  const url = new URL(req.url, 'http://127.0.0.1');
  const json = (code, payload) => {
    res.writeHead(code, { 'content-type': 'application/json' });
    res.end(JSON.stringify(payload));
  };
  const jsonCode = (res2, code, payload) => {
    res2.writeHead(code, { 'content-type': 'application/json' });
    res2.end(JSON.stringify(payload));
  };

  // ── the media itself ───────────────────────────────────────────────────────
  //
  // No bearer token here, and that is not an oversight: the token authenticates the
  // API, and a browser fetching a video does not send one. The real host answers these
  // urls from a CDN with its own signature in the path — the same division of labour,
  // which is exactly why the product can hand a viewer a redirect and still keep them
  // in its own player.
  const media = /^\/media\/([A-Za-z0-9_-]+)(\.mp4|\/index\.m3u8|\/seg(\d+)\.ts)$/.exec(url.pathname);
  if (media && req.method === 'GET') {
    const [, , what, seg] = media;
    if (what === '.mp4') return serveBytes(req, res, 'video/mp4', MEDIA.mp4);
    if (what === '/index.m3u8') return serveBytes(req, res, 'application/vnd.apple.mpegurl', playlistFor());
    return serveBytes(req, res, 'video/mp2t', MEDIA.segments[Number(seg)] || null);
  }

  // A bearer token is required, exactly as the real host requires one. A stub that
  // accepts anything would let a client that forgets the header pass its tests.
  if (!String(req.headers.authorization || '').startsWith('Bearer ')) {
    return json(401, { message: 'unauthenticated' });
  }

  if (url.pathname === '/account' && req.method === 'GET') {
    return json(200, { data: { id: 147, email: 'stub@example.test', storage_used: '0 B' } });
  }

  if (url.pathname === '/files/upload' && req.method === 'POST') {
    // The multipart body is not parsed: what a fixture uploads is its own business,
    // and the id only has to be stable for the same bytes.
    const id = crypto.createHash('sha256').update(body).digest('hex').slice(0, 12);
    files.set(id, { id, title: 'stub-upload.mp4', status: 'ready', size: body.length, duration: 240 });
    return json(200, { data: { id } });
  }

  if (url.pathname === '/files' && req.method === 'GET') {
    return json(200, { data: { files: [...files.values()] } });
  }

  const one = /^\/files\/([A-Za-z0-9_-]+)$/.exec(url.pathname);
  if (one && req.method === 'GET') {
    const record = files.get(one[1]) ?? { id: one[1], title: 'stub-file.mp4', status: 'ready', size: 1024, duration: 240 };
    const playable = WANT_HLS
      ? { hls_url: `http://127.0.0.1:${PORT}/media/${one[1]}/index.m3u8` }
      : { playback_url: `http://127.0.0.1:${PORT}/media/${one[1]}.mp4` };
    return json(200, { data: { ...record, ...playable } });
  }
  if (one && req.method === 'DELETE') {
    files.delete(one[1]);
    return json(200, { ok: true });
  }
  if (one && req.method === 'PATCH') return json(200, { data: { id: one[1] } });

  const status = /^\/files\/([A-Za-z0-9_-]+)\/status$/.exec(url.pathname);
  if (status && req.method === 'GET') return json(200, { data: { id: status[1], status: 'ready' } });

  if (url.pathname === '/remote-uploads' && req.method === 'POST') {
    return json(200, { data: { id: 'stub-remote', state: 'queued' } });
  }

  return json(404, { message: 'no such endpoint' });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`stub video host on http://127.0.0.1:${PORT}${WANT_HLS ? ' (serving HLS urls)' : ''}`);
  console.log('  VIDEO_DRIVER=filemoon FILEMOON_API_BASE=http://127.0.0.1:%d \\', PORT);
  console.log("    FILEMOON_TOKEN='147|stub-token-abcdefghijklmnop' npm test --prefix app");
});
