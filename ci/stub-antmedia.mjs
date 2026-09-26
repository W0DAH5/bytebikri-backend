/**
 * An Ant Media Server that answers, for testing against one that exists.
 *
 * `app/src/video-antmedia.js` was written where there is no server to talk to — the machine
 * that will run it is the user's, and this sandbox cannot reach anything. So this implements
 * the documented application REST API and nothing else:
 *
 *   POST   /{app}/rest/v2/broadcasts/create          → a Broadcast object with `streamId`
 *   GET    /{app}/rest/v2/broadcasts/list/0/200      → the broadcasts the server knows
 *   GET    /{app}/rest/v2/broadcasts/{id}            → the record: status, viewer counts
 *   PUT    /{app}/rest/v2/broadcasts/{id}            → rename / reconfigure
 *   DELETE /{app}/rest/v2/broadcasts/{id}            → delete; 404 for an unknown id
 *   GET    /{app}/streams/{id}.m3u8                  → the HLS playlist
 *   GET    /{app}/streams/seg0.ts                    → a segment, so the playlist is playable
 *
 * Four behaviours are here because the REAL ones are what the client has to survive:
 *
 *   * **`--jwt=secret` enforces the JWT REST filter**, verifying the HS256 signature with
 *     that secret and refusing anything else with a 401 — the same refusal a real server
 *     gives when the secret does not match. Without the flag the server behaves like a
 *     fresh install: the IP filter is what authorises us, and no header is needed.
 *     The filter guards the **REST API**, which is what `jwtControlEnabled` does: playback
 *     stays open, because play-token control is a different (Enterprise) switch.
 *   * **`--jwt-streams` adds that Enterprise switch** — `jwtStreamControlEnabled` — so the
 *     playlist itself wants a play token. It exists to prove the doctor reports a playlist
 *     nobody can read as a failure instead of reading the `allow-origin` header and calling
 *     it CORS. Community Edition cannot issue play tokens, so this mode is a warning sign
 *     on a self-hosted box, not a configuration to copy.
 *   * **A stream is not `broadcasting` until something publishes to it.** This stub has no
 *     RTMP ingest, so — as the other live stub did before it was removed — fetching the
 *     stream live, which is the closest an HTTP double can honestly come.
 *   * **`--wrong-app` 404s everything**, which is what a real server does when the
 *     configured application name is not one it has. That is the difference the doctor's
 *     404 message is written for, and it should be exercisable rather than trusted.
 *   * **`--no-cors`** drops `Access-Control-Allow-Origin`, which is the §10.4 wall: hls.js
 *     fetches a playlist with XHR under `connect-src`, and a server that sends no header
 *     gives a black rectangle with no error event at all.
 *
 *   node ci/stub-antmedia.mjs [port] [--jwt=secret] [--jwt-streams] [--no-cors] [--wrong-app]
 *   LIVE_DRIVER=antmedia ANT_MEDIA_BASE=http://127.0.0.1:5090 \
 *     VIDEO_MEDIA_ORIGINS=http://127.0.0.1:5090 npm run video:check --prefix app -- --probe-live
 */
import http from 'node:http';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.argv[2]) || 5090;
const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) || null;
const JWT_SECRET = arg('jwt');
const JWT_STREAMS = process.argv.includes('--jwt-streams');
const NO_CORS = process.argv.includes('--no-cors');
const WRONG_APP = process.argv.includes('--wrong-app');
const APP = 'LiveApp';

const SEED = fileURLToPath(new URL('../app/seed-assets/', import.meta.url));
const TS = (() => { try { return readFileSync(SEED + 'live-demo/seg0.ts'); } catch { return null; } })();

/** streamId → { name, status, mp4Enabled, viewers, createdAt } */
const broadcasts = new Map();

const readBody = (req) => new Promise((resolve) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
});

/** Does this request carry a JWT signed with the secret the filter is configured with? */
function jwtOk(req) {
  if (!JWT_SECRET) return true;                       // the filter is off: the IP filter decides
  const header = String(req.headers.authorization || '');
  if (!header.startsWith('Bearer ')) return false;
  const [h, p, sig] = header.slice(7).split('.');
  if (!h || !p || !sig) return false;
  const expected = crypto.createHmac('sha256', JWT_SECRET).update(`${h}.${p}`).digest('base64url');
  // Constant-time compare: a signature check that leaks timing is not a signature check.
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const server = http.createServer(async (req, res) => {
  const body = await readBody(req);
  const url = new URL(req.url, 'http://127.0.0.1');
  const path = url.pathname;

  const cors = NO_CORS ? {} : { 'access-control-allow-origin': '*' };
  const json = (code, payload) => {
    res.writeHead(code, { 'content-type': 'application/json', ...cors });
    res.end(JSON.stringify(payload));
  };
  /** An asset: a playlist is served whole, a segment honours Range, like the real server. */
  const asset = (code, buf, type) => {
    const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || ''));
    const headers = { 'content-type': type, 'accept-ranges': 'bytes', ...cors };
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

  if (WRONG_APP) return json(404, { message: `no application named ${path.split('/')[1] || '(none)'}` });
  if (!path.startsWith(`/${APP}/`)) return json(404, { message: 'not found' });
  const rest = path.slice(`/${APP}/rest/v2`.length);
  const streamPath = path.slice(`/${APP}/`.length);
  const isRest = path.startsWith(`/${APP}/rest/v2`);
  // Two switches on the real server: `jwtControlEnabled` guards the REST API, and
  // `jwtStreamControlEnabled` (Enterprise) guards the streams. They are separate because a
  // self-hosted Community install can turn the first on and has no way to issue the second.
  const guarded = isRest ? Boolean(JWT_SECRET) : (JWT_STREAMS && Boolean(JWT_SECRET));
  if (guarded && !jwtOk(req)) {
    return json(401, { message: 'JWT token is not valid' });
  }

  // ── the application REST API ────────────────────────────────────────────────
  if (rest === '/broadcasts/create' && req.method === 'POST') {
    const payload = (() => { try { return JSON.parse(body || '{}'); } catch { return {}; } })();
    const streamId = String(payload.streamId || '').trim();
    if (!streamId) return json(400, { message: 'streamId is required by this stub (the client mints it)' });
    if (broadcasts.has(streamId)) return json(400, { message: 'stream with the same streamId already exists' });
    broadcasts.set(streamId, {
      name: payload.name || null,
      status: 'created',
      mp4Enabled: Boolean(payload.mp4Enabled),
      viewers: { hls: 0, webRTC: 0, rtmp: 0 },
      createdAt: Date.now(),
    });
    return json(200, record(streamId));
  }

  if (rest.startsWith('/broadcasts/list/') && req.method === 'GET') {
    return json(200, [...broadcasts.keys()].map(record));
  }

  const one = /^\/broadcasts\/([^/]+)$/.exec(rest);
  if (one) {
    const id = decodeURIComponent(one[1]);
    if (!broadcasts.has(id)) return json(404, { message: `No stream found with id: ${id}` });
    if (req.method === 'GET') return json(200, record(id));
    if (req.method === 'PUT') {
      const patch = (() => { try { return JSON.parse(body || '{}'); } catch { return {}; } })();
      const current = broadcasts.get(id);
      Object.assign(current, patch.name ? { name: patch.name } : {});
      return json(200, { success: true, message: 'broadcast is updated' });
    }
    if (req.method === 'DELETE') {
      broadcasts.delete(id);
      return json(200, { success: true, message: 'broadcast is deleted' });
    }
  }

  // ── the HLS side ────────────────────────────────────────────────────────────
  const playlist = /^streams\/([^/]+)\.m3u8$/.exec(streamPath);
  if (playlist && req.method === 'GET') {
    const id = decodeURIComponent(playlist[1]);
    const recordOf = broadcasts.get(id);
    if (!recordOf) return json(404, { message: `No stream found with id: ${id}` });
    // Fetching the playlist IS the publish, as close as an HTTP double can come to RTMP.
    recordOf.status = 'broadcasting';
    recordOf.viewers.hls += 1;
    const text = [
      '#EXTM3U', '#EXT-X-VERSION:3', '#EXT-X-TARGETDURATION:4', '#EXT-X-MEDIA-SEQUENCE:0',
      '#EXTINF:4.0,', `/${APP}/streams/seg0.ts`,
      '#EXT-X-ENDLIST', '',
    ].join('\n');
    return asset(200, Buffer.from(text, 'utf8'), 'application/vnd.apple.mpegurl');
  }
  if (streamPath === 'streams/seg0.ts' && req.method === 'GET') {
    if (!TS) return json(404, { message: 'no segment in the stub' });
    return asset(200, TS, 'video/mp2t');
  }

  return json(404, { message: 'not found' });

  /** The Broadcast object, in the shape and with the field names the real server uses. */
  function record(id) {
    const r = broadcasts.get(id);
    return {
      streamId: id,
      status: r.status,
      type: 'liveStream',
      name: r.name,
      publish: true,
      publicStream: true,
      mp4Enabled: r.mp4Enabled ? 1 : 0,
      date: r.createdAt,
      rtmpURL: `rtmp://127.0.0.1:1935/${APP}/${id}`,
      hlsViewerCount: r.viewers.hls,
      webRTCViewerCount: r.viewers.webRTC,
      rtmpViewerCount: r.viewers.rtmp,
      bitrate: r.status === 'broadcasting' ? 1200 : 0,
      duration: r.status === 'broadcasting' ? Math.round((Date.now() - r.createdAt) / 1000) : 0,
    };
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`stub Ant Media Server on http://127.0.0.1:${PORT}/${APP}`
    + `${JWT_SECRET ? ' (JWT REST filter ON — HS256 signature verified)' : ' (no auth: the IP filter authorises)'}`
    + `${JWT_STREAMS ? ' [stream control ON — the playlist wants a play token]' : ''}`
    + `${NO_CORS ? ' (no CORS headers — the §10.4 wall)' : ''}`
    + `${WRONG_APP ? ' (every path 404s: the wrong-application-name case)' : ''}`);
  console.log('  this host is LIVE ONLY here: RTMP in, HLS out, and nothing is stored by the product');
  console.log('  LIVE_DRIVER=antmedia ANT_MEDIA_BASE=http://127.0.0.1:%d \\', PORT);
  console.log('    VIDEO_MEDIA_ORIGINS=http://127.0.0.1:%d npm run video:check --prefix app -- --probe-live', PORT);
  if (JWT_SECRET) console.log('  add ANT_MEDIA_REST_SECRET=%s to sign our own HS256 token', JWT_SECRET);
});
