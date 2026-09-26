/**
 * An api.video that answers, for testing against one that exists.
 *
 * `app/src/video-apivideo.js` was written where there is no egress to `ws.api.video` (TLS
 * reset, like every other host this repository talks to). This implements the documented
 * surface **that this product calls**, and nothing else — which is less than the whole API
 * on purpose:
 *
 *   POST   /auth/api-key                → a Bearer token, or 401 (the credential check)
 *   GET    /videos                      the workspace listing: how many items the account
 *                                       holds, with the rate-limit headers the doctor reads
 *   POST   /live-streams                mint a stream → liveStreamId, streamKey, assets.hls
 *   GET    /live-streams/{id}           the record; `broadcasting` says live-now
 *   PATCH  /live-streams/{id}           rename / record / restream
 *   DELETE /live-streams/{id}           remove the container
 *   GET    /live/{id}.m3u8              a live playlist, with segment urls
 *   GET    /live/seg0.ts                a segment, so the playlist is not a list of 404s
 *
 * THERE ARE NO UPLOAD ROUTES, AND THAT IS THE POINT. api.video is the LIVE host in this
 * product: `capabilities.kinds` is empty, no kind of file is routed to it, and nothing in
 * the app would ever call `POST /videos`. A double that kept modelling the upload half
 * would let a removed capability go on looking alive — and would let the suite pass while
 * the product's actual use of the host went untested.
 *
 * Three behaviours are here because the REAL ones are what the client has to survive:
 *
 *   * **Basic auth with the key as the USERNAME and a trailing colon.** Sending the key as a
 *     password, or as a bearer, is refused here exactly as the real host refuses it —
 *     otherwise the one mistake this module's shape invites would pass every test.
 *   * **A stream is not broadcasting until somebody pushes.** `broadcasting` starts false
 *     and flips when the playlist is fetched, which is the closest this stub can honestly
 *     come to an RTMP ingest it does not have. The doctor reports the state it is given
 *     rather than assuming it.
 *   * **`--no-cors`** drops `Access-Control-Allow-Origin` from the playlist and segment
 *     responses, which is the §10.4 wall: hls.js fetches the playlist with XHR under
 *     `connect-src`, and a CDN that sends no header gives a player that loads nothing with
 *     no error event at all. For a LIVE stream there is no mp4 to fall back to, so this is
 *     the difference between a working stream and a black rectangle.
 *
 *   node ci/stub-apivideo.mjs [port] [--sandbox] [--no-cors]
 *   LIVE_DRIVER=apivideo APIVIDEO_API_KEY=stub-key APIVIDEO_BASE=http://127.0.0.1:4005 \
 *     VIDEO_MEDIA_ORIGINS=http://127.0.0.1:4005 npm run video:check --prefix app -- --probe-live
 *
 * `--sandbox` answers with the sandbox's numbers in the rate-limit headers and the
 * environment report, so the banner's warning and the doctor's refusal can be exercised
 * without a sandbox key.
 */
import http from 'node:http';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.argv[2]) || 4005;
const SANDBOX = process.argv.includes('--sandbox') || Boolean(process.env.STUB_APIVIDEO_SANDBOX);
const NO_CORS = process.argv.includes('--no-cors') || Boolean(process.env.STUB_APIVIDEO_NO_CORS);
const KEY = process.env.STUB_APIVIDEO_KEY || 'stub-key';

const streams = new Map();      // liveStreamId → { name, streamKey, broadcasting, record }

const SEED = fileURLToPath(new URL('../app/seed-assets/', import.meta.url));
const readIf = (name) => { try { return readFileSync(SEED + name); } catch { return null; } };
const TS = readIf('live-demo/seg0.ts');

const readBody = (req) => new Promise((resolve) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => resolve(Buffer.concat(chunks)));
});

/** The multipart `file` part, so the upload test can assert the bytes arrived. */
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
        return { bytes: part.subarray(split + 4, part.length - 2), type: /content-type:\s*([^\r\n;]+)/i.exec(head)?.[1]?.trim() };
      }
    }
    at = next;
  }
  return null;
}

const b64 = (value) => Buffer.from(String(value), 'utf8').toString('base64');

/** Basic auth, key as USERNAME with a trailing colon — the real scheme, enforced. */
function authenticated(req) {
  const header = String(req.headers.authorization || '');
  if (header.startsWith('Basic ')) {
    const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
    const [user, ...rest] = decoded.split(':');
    // The colon must be there: `key` without it is a different credential on the real host.
    return user === KEY && rest.join(':').length === 0 && decoded.endsWith(':');
  }
  if (header.startsWith('Bearer ')) {
    // Only tokens this stub minted are accepted, which is what makes the auth endpoint a check.
    return header.slice(7) === b64(`${KEY}:`);
  }
  return false;
}

/*
 * THE WORKSPACE IS EMPTY, AND THAT IS THE STUB TELLING THE TRUTH.
 *
 * The real host's listing says how much content an account holds. This product stores
 * nothing on it — `capabilities.kinds` is empty — so the honest answer from a stub that
 * models OUR use of the account is zero, and the doctor's account check still gets what it
 * came for: a 200 with rate-limit headers, which is what proves the key works.
 */
const EMPTY_WORKSPACE = { data: [], pagination: { itemsTotal: 0, pagesTotal: 0, pageSize: 25, currentPage: 1, currentPageItems: 0 } };

const server = http.createServer(async (req, res) => {
  const body = await readBody(req);
  const url = new URL(req.url, 'http://127.0.0.1');
  const path = url.pathname;
  const json = (code, payload, extra = {}) => {
    res.writeHead(code, {
      'content-type': 'application/json',
      // Every real response carries these; the client reads them for the plan.
      'x-ratelimit-limit': SANDBOX ? '40' : '100',
      'x-ratelimit-remaining': '39',
      'x-ratelimit-retry-after': '0',
      // Cross-origin only matters for the media routes, but the API is fetched from tests
      // too, and a browser following a redirect judges the final response.
      ...(NO_CORS ? {} : { 'access-control-allow-origin': '*' }),
      ...extra,
    });
    res.end(JSON.stringify(payload));
  };
  const asset = (code, buf, type) => {
    /*
     * Ranges, because a MEDIA FILE is what a viewer scrubs. A playlist is served whole (it is
     * a few hundred bytes of text and Range on it means nothing); the mp4 and the segments
     * honour `bytes=N-M`, which is what the doctor probes when it wants to know whether
     * seeking works.
     */
    const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || ''));
    const headers = {
      'content-type': type,
      'accept-ranges': 'bytes',
      ...(NO_CORS ? {} : { 'access-control-allow-origin': '*' }),
    };
    if (!range || /mpegurl/.test(type)) {
      res.writeHead(code, { ...headers, 'content-length': buf.length });
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
  };

  // ── the credential ────────────────────────────────────────────────────────
  if (path === '/auth/api-key' && req.method === 'POST') {
    const sent = (() => { try { return JSON.parse(body.toString('utf8')).apiKey; } catch { return null; } })();
    if (sent !== KEY) return json(401, { type: 'about:blank', title: 'This API key is not valid', status: 401 });
    return json(200, { token_type: 'Bearer', access_token: b64(`${KEY}:`), refresh_token: 'stub-refresh', expires_in: 3600 });
  }
  const needsAuth = /^\/videos(\/|$)/.test(path) || /^\/live-streams(\/|$)/.test(path);
  // Reading a PUBLIC video's assets does not need a key — that is what `public: true` means,
  // and it is why this product can hand a viewer a 302 to the CDN.
  const isPublicAsset = req.method === 'GET' && (/^\/vod\//.test(path) || /^\/live\//.test(path));
  if (needsAuth && !isPublicAsset && !authenticated(req)) {
    return json(401, { type: 'about:blank', title: 'Unauthorized', status: 401 });
  }

  /*
   * The workspace listing, which is what the doctor's credential check reads: its
   * `pagination.itemsTotal` says how many videos the account holds, and every real response
   * carries the rate-limit headers that say what plan the key is on.
   */
  if (path === '/videos' && req.method === 'GET') return json(200, EMPTY_WORKSPACE);

  /*
   * NO UPLOAD ROUTES ABOVE, AND NO VOD CDN BELOW. This host is a LIVE provider in this
   * product — `capabilities.kinds` is empty, so no kind of file can be routed to it and
   * nothing here would ever be called. A double that keeps modelling a capability the
   * product removed is how a dead path goes on looking alive in the test suite; what is
   * left is exactly what we call: the credential check, the workspace listing, and the
   * live half, where the stub's own numbers match their published live limits.
   */

  // ── live streams ──────────────────────────────────────────────────────────
  if (path === '/live-streams' && req.method === 'POST') {
    const payload = (() => { try { return JSON.parse(body.toString('utf8')); } catch { return {}; } })();
    const id = `li${crypto.randomBytes(9).toString('hex')}`;
    streams.set(id, {
      name: String(payload.name || 'live').slice(0, 60),
      streamKey: crypto.randomUUID(),
      broadcasting: false,
      record: Boolean(payload.record),
      public: payload.public !== false,
    });
    return json(201, liveJson(id));
  }
  const liveOne = /^\/live-streams\/([^/]+)$/.exec(path);
  if (liveOne) {
    const record = streams.get(liveOne[1]);
    if (!record) return json(404, { title: 'live stream not found', status: 404 });
    if (req.method === 'GET') {
      /*
       * `broadcasting` flips the moment the playlist is first fetched, which is how the stub
       * models a real encoder connecting: one request for the playlist is the only signal
       * there is that somebody pushed a stream.
       */
      return json(200, liveJson(liveOne[1]));
    }
    if (req.method === 'PATCH') {
      const payload = (() => { try { return JSON.parse(body.toString('utf8')); } catch { return {}; } })();
      if (payload.name) record.name = String(payload.name).slice(0, 60);
      if (payload.record !== undefined) record.record = Boolean(payload.record);
      return json(200, liveJson(liveOne[1]));
    }
    if (req.method === 'DELETE') {
      streams.delete(liveOne[1]);
      return res.writeHead(204).end();
    }
  }
  const livePlaylist = /^\/live\/([^/]+)\.m3u8$/.exec(path);
  if (livePlaylist && req.method === 'GET') {
    const record = streams.get(livePlaylist[1]);
    if (!record) return json(404, { title: 'live stream not found', status: 404 });
    record.broadcasting = true;
    const playlist = [
      '#EXTM3U', '#EXT-X-VERSION:3', '#EXT-X-TARGETDURATION:5', '#EXT-X-MEDIA-SEQUENCE:0',
      '#EXTINF:5.0,', '/live/seg0.ts',
      '', // live playlist: no ENDLIST — that is what makes it live rather than VOD
    ].join('\n');
    return asset(200, Buffer.from(playlist, 'utf8'), 'application/vnd.apple.mpegurl');
  }
  if (path === '/live/seg0.ts' && req.method === 'GET') {
    if (!TS) return json(404, { title: 'no segment in the stub', status: 404 });
    return asset(200, TS, 'video/mp2t');
  }

  return json(404, { title: 'no such endpoint', status: 404 });

  function liveJson(id) {
    const record = streams.get(id);
    return {
      liveStreamId: id,
      name: record.name,
      public: record.public,
      record: record.record,
      broadcasting: record.broadcasting,
      streamKey: record.streamKey,
      assets: {
        iframe: '',
        player: `http://127.0.0.1:${PORT}/live/${id}`,
        hls: record.public ? `http://127.0.0.1:${PORT}/live/${id}.m3u8` : `http://127.0.0.1:${PORT}/private/${record.streamKey}/${id}.m3u8`,
        thumbnail: `http://127.0.0.1:${PORT}/live/${id}/thumbnail.jpg`,
      },
    };
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`stub api.video on http://127.0.0.1:${PORT}`
    + `${SANDBOX ? ' (SANDBOX: video 30s, live STOPPED at 30min, watermark, 24h)' : ''}`
    + `${NO_CORS ? ' (no CORS headers — the §10.4 wall)' : ''}`);
  console.log('  this host is LIVE ONLY here: it has no upload routes, because nothing uploads to it');
  console.log('  LIVE_DRIVER=apivideo APIVIDEO_API_KEY=stub-key APIVIDEO_BASE=http://127.0.0.1:%d \\', PORT);
  console.log('    VIDEO_MEDIA_ORIGINS=http://127.0.0.1:%d npm run video:check --prefix app -- --probe-live', PORT);
  console.log('  LIVE_DRIVER=apivideo  — mint streams with POST /live-streams; push to NOTHING,');
  console.log('  this stub has no RTMP ingest: fetch the playlist to mark the stream broadcasting.');
});
