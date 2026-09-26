/**
 * An api.video that answers, for testing against one that exists.
 *
 * `app/src/video-apivideo.js` was written where there is no egress to `ws.api.video` (TLS
 * reset, like every other host this repository talks to). This implements the documented
 * surface and nothing else:
 *
 *   POST   /auth/api-key                → a Bearer token, or 401 (the credential check)
 *   POST   /videos                      create a container → videoId + assets
 *   POST   /videos/{id}/source          the bytes, multipart `file`
 *   GET    /videos/{id}                 the record: status, assets.hls, assets.mp4
 *   DELETE /videos/{id}                 a real delete
 *   POST   /live-streams                mint a stream → liveStreamId, streamKey, assets.hls
 *   GET    /live-streams/{id}           the record; `broadcasting` says live-now
 *   PATCH  /live-streams/{id}           rename / record / restream
 *   DELETE /live-streams/{id}           remove the container
 *   GET    /videos/{id}/hls/manifest.m3u8, /videos/{id}/mp4/source.mp4   the CDN, served here
 *   GET    /live/{id}.m3u8              a live playlist that HLS.js can actually load
 *
 * Four behaviours are here because the REAL ones are what the client has to survive:
 *
 *   * **Basic auth with the key as the USERNAME and a trailing colon.** Sending the key as
 *     a password, or as a bearer, is refused here exactly as the real host refuses it —
 *     otherwise the one mistake this module's shape invites would pass every test.
 *   * **A video is not playable the moment it lands.** The container goes
 *     `uploaded → processing → playable`, and `assets.hls` only appears at the end, which
 *     is why `playback()` reads the record rather than inventing a url.
 *   * **`mp4` exists only when the container was created with `mp4Support: true`.** The
 *     real host cannot add it later, and a stub that always served it would hide exactly
 *     the mistake decision 2 in §11.2 exists to prevent.
 *   * **`--no-cors`** drops `Access-Control-Allow-Origin` from the playlist and segment
 *     responses, which is the §10.4 wall: hls.js fetches with XHR, a redirected/cross-origin
 *     XHR is judged at its final url, and a CDN that sends no header gives a player that
 *     loads nothing with no error event. It exists so `APIVIDEO_PLAYBACK=mp4` can be
 *     exercised rather than assumed.
 *
 *   node ci/stub-apivideo.mjs [port] [--sandbox] [--no-cors] [--slow]
 *   VIDEO_DRIVER=apivideo APIVIDEO_API_KEY=stub-key APIVIDEO_BASE=http://127.0.0.1:4005 \
 *     VIDEO_MEDIA_ORIGINS=http://127.0.0.1:4005 npm test --prefix app
 *
 * `--slow` makes the container take two reads to become `playable`, so a caller that
 * treats "created" as "ready" fails here rather than in front of a seller.
 */
import http from 'node:http';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.argv[2]) || 4005;
const SANDBOX = process.argv.includes('--sandbox') || Boolean(process.env.STUB_APIVIDEO_SANDBOX);
const NO_CORS = process.argv.includes('--no-cors') || Boolean(process.env.STUB_APIVIDEO_NO_CORS);
const SLOW = process.argv.includes('--slow');
const KEY = process.env.STUB_APIVIDEO_KEY || 'stub-key';

const videos = new Map();       // videoId → { bytes, mime, reads, mp4Support, title }
const streams = new Map();      // liveStreamId → { name, streamKey, broadcasting, record }

const SEED = fileURLToPath(new URL('../app/seed-assets/', import.meta.url));
const readIf = (name) => { try { return readFileSync(SEED + name); } catch { return null; } };
const MP4 = readIf('store-walkthrough.mp4');
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

const videoJson = (id, record) => {
  // No bytes, no assets: a container that was created and never filled has nothing to play,
  // and the real host answers exactly the same way (which is why `playback()` reads the
  // record instead of building a url out of an id).
  const playable = Boolean(record.bytes) && (!SLOW || record.reads >= 2);
  const assets = { player: `http://127.0.0.1:${PORT}/vod/${id}`, iframe: '', thumbnail: `http://127.0.0.1:${PORT}/vod/${id}/thumbnail.jpg` };
  if (playable) {
    assets.hls = `http://127.0.0.1:${PORT}/vod/${id}/hls/manifest.m3u8`;
    if (record.mp4Support) assets.mp4 = `http://127.0.0.1:${PORT}/vod/${id}/mp4/source.mp4`;
  }
  return {
    videoId: id,
    title: record.title,
    public: true,
    mp4Support: Boolean(record.mp4Support),
    status: playable ? 'playable' : (record.bytes ? 'processing' : 'uploaded'),
    assets,
  };
};

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

  // ── videos ────────────────────────────────────────────────────────────────
  if (path === '/videos' && req.method === 'POST') {
    const payload = (() => { try { return JSON.parse(body.toString('utf8')); } catch { return {}; } })();
    const id = `vi${crypto.randomBytes(9).toString('hex')}`;
    videos.set(id, {
      title: String(payload.title || '').slice(0, 60),
      mp4Support: Boolean(payload.mp4Support),
      public: payload.public !== false,
      reads: 0,
      bytes: null,
      mime: null,
    });
    if (payload.public === false) {
      // The trap this stub exists to catch: a private container's assets go behind a token.
      return json(201, { ...videoJson(id, videos.get(id)), assets: { iframe: '', player: `http://127.0.0.1:${PORT}/vod/${id}?token=one-shot` } });
    }
    return json(201, videoJson(id, videos.get(id)));
  }

  const sourcePost = /^\/videos\/([^/]+)\/source$/.exec(path);
  if (sourcePost && req.method === 'POST') {
    const record = videos.get(sourcePost[1]);
    if (!record) return json(404, { title: 'video not found', status: 404 });
    const part = filePart(body, req.headers['content-type']);
    if (!part || !part.bytes.length) return json(400, { title: 'The file was not sent', status: 400 });
    if (part.bytes.length > 200 * 1024 * 1024) return json(413, { title: 'Use progressive upload for this file', status: 413 });
    record.bytes = part.bytes;
    record.mime = part.type || 'video/mp4';
    return json(201, videoJson(sourcePost[1], record));
  }

  /*
   * The workspace listing, which is what the doctor's credential check reads: its
   * `pagination.itemsTotal` says how many videos the account holds, and every real response
   * carries the rate-limit headers that say what plan the key is on.
   */
  if (path === '/videos' && req.method === 'GET') {
    return json(200, {
      data: [...videos.entries()].slice(0, Number(url.searchParams.get('pageSize') || 25)).map(([id, r]) => videoJson(id, r)),
      pagination: { itemsTotal: videos.size, pagesTotal: 1, pageSize: Number(url.searchParams.get('pageSize') || 25), currentPage: 1, currentPageItems: videos.size },
    });
  }

  const videoOne = /^\/videos\/([^/]+)$/.exec(path);
  if (videoOne) {
    const record = videos.get(videoOne[1]);
    if (!record) return json(404, { title: 'video not found', status: 404 });
    if (req.method === 'GET') {
      record.reads += 1;
      return json(200, videoJson(videoOne[1], record));
    }
    if (req.method === 'DELETE') {
      videos.delete(videoOne[1]);
      return res.writeHead(204).end();
    }
  }

  // ── the "CDN" ─────────────────────────────────────────────────────────────
  const manifest = /^\/vod\/([^/]+)\/hls\/manifest\.m3u8$/.exec(path);
  if (manifest && req.method === 'GET') {
    const record = videos.get(manifest[1]);
    if (!record || !record.bytes) return json(404, { title: 'manifest not found', status: 404 });
    const playlist = [
      '#EXTM3U', '#EXT-X-VERSION:3', '#EXT-X-TARGETDURATION:5', '#EXT-X-MEDIA-SEQUENCE:0',
      '#EXTINF:5.0,', '/vod/seg0.ts',
      '#EXT-X-ENDLIST', '',
    ].join('\n');
    return asset(200, Buffer.from(playlist, 'utf8'), 'application/vnd.apple.mpegurl');
  }
  const mp4 = /^\/vod\/([^/]+)\/mp4\/source\.mp4$/.exec(path);
  if (mp4 && req.method === 'GET') {
    const record = videos.get(mp4[1]);
    if (!record || !record.bytes) return json(404, { title: 'no mp4', status: 404 });
    return asset(200, MP4 || record.bytes, 'video/mp4');
  }
  if (path === '/vod/seg0.ts' && req.method === 'GET') {
    if (!TS) return json(404, { title: 'no segment in the stub', status: 404 });
    return asset(200, TS, 'video/mp2t');
  }
  const thumb = /^\/vod\/([^/]+)\/thumbnail\.jpg$/.exec(path);
  if (thumb && req.method === 'GET') {
    return asset(200, Buffer.from([0xff, 0xd8, 0xff, 0xd9]), 'image/jpeg');
  }

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
    + `${SANDBOX ? ' (SANDBOX limits: 30s, watermark, 24h)' : ''}`
    + `${NO_CORS ? ' (no CORS headers — the §10.4 wall)' : ''}`
    + `${SLOW ? ' (containers take two reads to become playable)' : ''}`);
  console.log('  VIDEO_DRIVER=apivideo APIVIDEO_API_KEY=stub-key APIVIDEO_BASE=http://127.0.0.1:%d \\', PORT);
  console.log('    VIDEO_MEDIA_ORIGINS=http://127.0.0.1:%d npm test --prefix app', PORT);
  console.log('  LIVE_DRIVER=apivideo  — mint streams with POST /live-streams; push to NOTHING,');
  console.log('  this stub has no RTMP ingest: fetch the playlist to mark the stream broadcasting.');
});
