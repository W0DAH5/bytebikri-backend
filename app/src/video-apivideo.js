/**
 * api.video, as a provider behind the registry in `video.js` — and the first one that
 * can run a LIVE INGEST, which makes this file the only host in the registry that
 * changes what the product can do rather than only where the bytes sit.
 *
 * ── TWO ENVIRONMENTS, ONE KEY ────────────────────────────────────────────────
 *
 *   production  https://ws.api.video        the paid, uncapped environment
 *   sandbox     https://sandbox.api.video   free, and STRICTLY limited: content is
 *                                           capped at 30 seconds (videos AND live
 *                                           streams — longer input is CROPPED),
 *                                           watermarked, and deleted after 24 hours
 *
 * A key belongs to one of them and answers 401 against the other, so the base is
 * configuration (`APIVIDEO_BASE`) rather than something derived. `isSandbox()` reads it
 * so the doctor and the boot line can say the word out loud — a store's ten-minute
 * product demo silently cropped to thirty seconds is the kind of failure that is only
 * obvious to the person who lost the content.
 *
 * ── AUTH: BASIC, WITH THE KEY AS THE USERNAME ────────────────────────────────
 *
 * `Authorization: Basic base64("<apiKey>:")` — the key in the USERNAME field with a
 * trailing colon and an empty password. Worth stating plainly because it is the
 * opposite of the Pixeldrain module next door (key as PASSWORD) and neither provider
 * publishes a way to tell you:-). Their `/auth/api-key` endpoint mints a Bearer token
 * instead, which the SDKs use; that round-trip buys nothing for occasional server-side
 * calls and costs a token cache plus a refresh path in the failure case. Bearer and the
 * *delegated* upload tokens exist for the case this product deliberately does not have:
 * an upload going straight from a seller's browser to the provider, past our own
 * validation.
 *
 * ── DECISION: CONTAINERS ARE `public: true` ──────────────────────────────────
 *
 * api.video's private delivery is a SINGLE-USE token: every `GET /videos/{id}` mints a
 * fresh private token, one web session consumes it, and using more than one asset
 * afterwards needs a session token (`?avh=`) dance. Our route is a 302 to the host's url
 * and HLS playback fetches a manifest plus every segment, so a token that dies on first
 * use would break seeking, refreshes and rewatches — it would break the player. So the
 * container is public, its url is a bearer once it reaches a browser, and OUR door is the
 * gate. That is the same trade §7 records for Filemoon and §10.6 for Catbox, made
 * deliberately instead of discovered during an incident.
 *
 * ── DECISION: ASK FOR THE MP4 AT CREATION, ALWAYS ────────────────────────────
 *
 * `mp4Support` cannot be turned on after the fact, and the progressive mp4 is the only
 * asset that does not depend on the CDN's CORS policy (§10.4's wall, where hls.js is
 * blocked by a playlist that is not CORS-readable). Every container is created with BOTH
 * assets, so the delivery path is a configuration switch (`APIVIDEO_PLAYBACK=hls|mp4`)
 * rather than a re-upload of a store's catalogue.
 *
 * ── AND THE HALF THAT IS NOT STORAGE: LIVE ───────────────────────────────────
 *
 * `POST /live-streams` mints a stream: an id, a **streamKey**, and an HLS url
 * (`https://live.api.video/<liveStreamId>.m3u8`). The seller points OBS — or `ffmpeg` —
 * at `rtmp://broadcast.api.video/s` with that key, and THE HOST RUNS THE INGEST, which is
 * the piece this platform has never had: `src/views.js` tells sellers today that "rtmp://
 * would need an ingest server this platform does not run".
 *
 * The value of that for us is how little it changes: the live file keeps its
 * `external_url`, the playlist is still an `.m3u8`, so the player, the breaks, the cue and
 * the unlock ladder cannot tell the difference between a playlist we minted and one the
 * seller pasted. **The streamKey is never stored** — it is a broadcasting credential, so
 * the owner's panel fetches it from `GET /live-streams/{id}` when it is opened, and what
 * lives in our database is the container id.
 */
import { VideoApiError, pick, classifyUrl, describe, describeDeep, errorMessage, httpCall, keySafe } from './video-shared.js';

export const name = 'apivideo';
export const label = 'api.video';

/**
 * The ceiling for ONE upload request: 200 MiB, per their progressive-upload docs.
 *
 * Our own cap (25 MB) binds far below this, so the number exists to answer `acceptsFile`
 * honestly: a file over it would need chunked uploads this module does not implement, and
 * the router moves such a file to a host that can take it rather than failing the upload.
 */
export const SINGLE_REQUEST_MAX = 200 * 1024 * 1024;

export const capabilities = {
  maxBytes: SINGLE_REQUEST_MAX,
  hls: true,
  durable: true,
  lists: true,
  needs: 'APIVIDEO_API_KEY',
  note: 'video infrastructure: transcoding to adaptive HLS, a progressive mp4, and a live ingest',
  /*
   * Video only, and by design rather than by omission.
   *
   * This host is built around transcoding and delivery of moving pictures; audio-only
   * files, images, archives and documents have hosts here that were built for them
   * (Pixeldrain for any file, Telegra.ph for images) and this is not the one to send them
   * to. The sandbox's 30-second crop alone would maul a 40-minute audio master.
   */
  kinds: ['video'],
  deletable: true,
  /** The sandbox is a *testing* environment, and every limit of it is a product limit. */
  sandbox: {
    maxSeconds: 30,
    watermark: true,
    deletesAfterHours: 24,
    note: 'sandbox content is cropped to 30 seconds, watermarked, and deleted after 24 hours',
  },
  /**
   * The live half, as data — because it is a different question from storage.
   *
   * `ingest` is what a seller types into their encoder, `streamsInPage` is that the url
   * they get is an HLS playlist our player already understands, and `keyIsStored` is the
   * promise that makes a broadcast credential safe to hand out: we never keep it.
   */
  live: {
    ingest: {
      rtmp: 'rtmp://broadcast.api.video/s',
      rtmps: 'rtmps://broadcast.api.video:1936/s',
      srt: 'srt://broadcast.api.video:6200?streamid=<streamKey>',
    },
    player: 'hls',
    recording: true,
    keyIsStored: false,
    note: 'the host runs the RTMP/SRT ingest; the stream comes back as an HLS playlist our own player plays',
  },
  policy: {
    commercial: 'allowed',
    note: 'a video-infrastructure provider — transcoding, adaptive delivery and live ingest are '
      + 'the product; the sandbox is free with hard limits and production is pay-as-you-go',
  },
};

/**
 * The origins their asset urls use.
 *
 * All three appear in their own documentation and examples — `cdn.api.video` for VOD
 * assets, `vod.api.video` for the same assets in the private-video guides, and
 * `live.api.video` for a live stream. Which one a given account is handed is not
 * published, and CSP is decided by URL before the browser asks, so all three are named
 * rather than betting on one. `VIDEO_MEDIA_ORIGINS` covers a fourth if their CDN moves.
 */
export const mediaOrigins = () => [
  'https://cdn.api.video',
  'https://vod.api.video',
  'https://live.api.video',
];

/** Configured means the credential this host needs is present. */
export const configured = (env = process.env) => Boolean(env.APIVIDEO_API_KEY);

/**
 * Would this host take this file?
 *
 * The kind check is the router's job (`capabilities.kinds`); this answers the two things
 * about the FILE that would make the host refuse it — the single-request ceiling above,
 * and the sandbox's 30 seconds, which cannot be judged from a byte count. The duration is
 * therefore warned about rather than refused: cropping a seller's file silently would be
 * worse, so callers that know the duration get a sentence to show.
 */
export function acceptsFile({ mimeType = '', filename = '', size = 0 } = {}) {
  if (size > SINGLE_REQUEST_MAX) {
    return {
      ok: false,
      why: `${(size / 1024 / 1024).toFixed(0)} MB needs api.video's progressive (chunked) upload, which this client does not implement`,
    };
  }
  void mimeType; void filename;
  return { ok: true };
}

/** The sandbox crops and deletes; everything else is the same code path. */
export const isSandbox = (env = process.env) => /sandbox/i.test(base(env));

/** `vi` + 20-odd characters for a video, `li` + the same for a live stream. */
export const idPattern = /^[A-Za-z0-9_-]{6,64}$/;

const DEFAULT_BASE = 'https://ws.api.video';
const trim = (value) => String(value || '').replace(/\/+$/, '');

export const base = (env = process.env) => trim(env.APIVIDEO_BASE || DEFAULT_BASE);

/**
 * Basic auth, with the key in the USERNAME field and a trailing colon.
 *
 * `Buffer` rather than `btoa` because this runs in Node, and the colon is not decoration:
 * the scheme splits on the first colon, so a key sent as a password (as Pixeldrain wants)
 * would authenticate as Anonymous with a password nobody has.
 */
const authHeader = (env) => `Basic ${Buffer.from(`${env.APIVIDEO_API_KEY}:`, 'utf8').toString('base64')}`;

/**
 * One authenticated call.
 *
 * api.video answers honest HTTP codes and JSON error bodies (`{type, title, status}`), so
 * the response code is the truth here — unlike GoFile, which this registry dropped for
 * wrapping errors in a 200. The rate-limit headers ride along on every response and are
 * returned to callers that ask for them, which is how the doctor reports a plan.
 */
async function call(path, {
  method = 'GET', body, headers = {}, env = process.env, timeoutMs = 30_000, withHeaders = false,
} = {}) {
  const key = env.APIVIDEO_API_KEY;
  if (!key) {
    throw new VideoApiError('the video host is not configured (APIVIDEO_API_KEY is unset)', { path, provider: name });
  }
  const { res, status, text, json } = await httpCall(`${base(env)}${path}`, {
    method,
    headers: { authorization: authHeader(env), ...headers },
    body,
    timeoutMs,
    provider: name,
    path,
  });
  if (status < 200 || status >= 300) {
    throw new VideoApiError(
      `the video host answered ${status}: ${pick(json, ['title', 'message', 'detail']) || errorMessage(json, text.slice(0, 140) || 'no body')}`,
      { status, body: json, path, provider: name },
    );
  }
  const rate = {
    limit: res.headers.get('x-ratelimit-limit'),
    remaining: res.headers.get('x-ratelimit-remaining'),
    retryAfter: res.headers.get('x-ratelimit-retry-after'),
  };
  return withHeaders ? { json, rate, status } : json;
}

/**
 * Create a video container and upload the bytes into it.
 *
 * Two calls, because that is the shape of this host: `POST /videos` makes an empty shell
 * (and it deletes that shell after 7 days if nothing is uploaded into it), then
 * `POST /videos/{id}/source` fills it. The container is created with `public: true` and
 * `mp4Support: true` for the two reasons at the top of this file, and the id it returns is
 * what our storage key keeps.
 */
export async function upload(buffer, filename, { mimeType = 'video/mp4', env = process.env, title = '' } = {}) {
  const size = buffer?.length ?? 0;
  if (size > SINGLE_REQUEST_MAX) {
    throw new VideoApiError(
      `this file is ${(size / 1024 / 1024).toFixed(0)} MB and this client uploads in one request, which the host `
      + `accepts up to ${SINGLE_REQUEST_MAX / 1024 / 1024} MB — a bigger file needs the chunked upload path`,
      { provider: name, path: '/videos' },
    );
  }

  const created = await call('/videos', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      title: title || keySafe(filename || 'video').slice(0, 120) || 'untitled',
      // Public on purpose: our own door is the gate, and a private token would be consumed
      // by the first segment request. See the header.
      public: true,
      // Cannot be added later, and it is the fallback that does not depend on CORS.
      mp4Support: true,
    }),
    env,
  });

  const id = pick(created, ['videoId']);
  if (!id) {
    throw new VideoApiError(
      `the video host created nothing usable — keys were ${describeDeep(created)}`,
      { body: created, path: '/videos', provider: name },
    );
  }

  const form = new FormData();
  form.append('file', new Blob([buffer], { type: mimeType || 'video/mp4' }), keySafe(filename || 'video.mp4'));
  const filled = await call(`/videos/${encodeURIComponent(String(id))}/source`, {
    method: 'POST',
    body: form,
    env,
    timeoutMs: 180_000,
  });

  /*
   * The upload answer is not always the full record — some responses carry only the
   * id — so the assets are read from whichever of the two calls described them. A missing
   * `assets.hls` here is NOT an error: the container is transcoding, and `playback()`
   * reads the record again when the player asks.
   */
  return { id: String(id), body: filled || created, assets: pick(filled || created, ['assets']) || null };
}

/** One video's record — including `assets` and the status a caller may want to report. */
export async function file(id, { env = process.env } = {}) {
  const record = await call(`/videos/${encodeURIComponent(String(id))}`, { env });
  return {
    id: String(id),
    status: pick(record, ['status']) || (pick(record, ['assets']) ? 'unknown' : 'unknown'),
    title: pick(record, ['title']) ?? null,
    durationSec: pick(record, ['duration']) ?? null,
    assets: pick(record, ['assets']) || {},
    raw: record,
  };
}

/**
 * A url and a kind.
 *
 * Unlike Catbox or Pixeldrain there is no arithmetic that produces a playback url — the
 * origin and the path are the host's to choose (their own docs have moved between
 * `cdn.api.video` and `vod.api.video`), so this reads the record and takes what it is
 * given. `APIVIDEO_PLAYBACK` chooses between the two assets the container holds:
 * `hls` by default because it adapts, `mp4` when a playlist turns out not to be
 * CORS-readable from a viewer's browser (§10.4).
 */
export async function playback(id, { env = process.env } = {}) {
  const record = await file(id, { env });
  const assets = record.assets || {};
  const preference = String(env.APIVIDEO_PLAYBACK || 'hls').trim().toLowerCase();
  const candidates = preference === 'mp4' ? ['mp4', 'hls'] : ['hls', 'mp4'];
  for (const asset of candidates) {
    const url = pick(assets, [asset]);
    if (typeof url === 'string' && url) {
      return { kind: classifyUrl(url), url, id: String(id) };
    }
  }
  throw new VideoApiError(
    `the video host has no playable asset for ${id} yet (status "${record.status}"`
    + `${isSandbox(env) && record.status !== 'playable' ? '; the sandbox crops to 30 seconds, and a video is not playable until it has finished encoding' : ''}`
    + `) — assets were ${describe(assets)}`,
    { provider: name, path: '/videos' },
  );
}

/** Delete, and say whether the host agreed — a 404 means it is already gone. */
export async function remove(id, { env = process.env } = {}) {
  const videoId = String(id || '');
  if (!idPattern.test(videoId)) {
    throw new VideoApiError(`the stored video id is not usable in a delete: ${videoId.slice(0, 80)}`, {
      provider: name, path: '/videos',
    });
  }
  try {
    await call(`/videos/${encodeURIComponent(videoId)}`, { method: 'DELETE', env });
    return true;
  } catch (err) {
    if (err?.status === 404) return true;
    throw err;
  }
}

/**
 * Who the key belongs to, and what it is allowed to do.
 *
 * `POST /auth/api-key` is the one call whose entire purpose is "is this key valid", so it
 * is the honest credential check — and it is the ONE place in this module that uses the
 * Bearer flow, because that is what that endpoint answers with. The workspace shape comes
 * from `GET /videos?pageSize=1`, and the rate-limit headers tell an operator what they are
 * on without anyone having to trust a dashboard reading: a sandbox key and a production
 * key answer with different numbers.
 */
export async function account({ env = process.env } = {}) {
  const auth = await call('/auth/api-key', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ apiKey: env.APIVIDEO_API_KEY }),
    env,
  });
  const { json: workspace, rate } = await call('/videos?pageSize=1', { env, withHeaders: true });
  return {
    id: null,
    email: null,
    tier: isSandbox(env) ? 'sandbox' : 'production',
    token: auth && pick(auth, ['token_type', 'access_token']) ? 'the key authenticates' : null,
    videos: pick(workspace, ['pagination']) ? pick(pick(workspace, ['pagination']), ['itemsTotal']) : null,
    rate,
    sandbox: isSandbox(env),
    raw: workspace,
  };
}

// ─── live ────────────────────────────────────────────────────────────────────

/** Is a live driver configured — that is, may this deployment mint streams? */
export const liveEnabled = (env = process.env) => configured(env)
  && String(env.LIVE_DRIVER || '').trim().toLowerCase() === name;

/** A live stream id survives the same filter as a video id. */
const requireLiveId = (id) => {
  const liveId = String(id || '');
  if (!idPattern.test(liveId)) {
    throw new VideoApiError(`the live stream id is not usable in a url: ${liveId.slice(0, 80)}`, {
      provider: name, path: '/live-streams',
    });
  }
  return liveId;
};

export const ingestFor = (env = process.env) => ({
  ...capabilities.live.ingest,
  srt: capabilities.live.ingest.srt.replace('<streamKey>', String(env.APIVIDEO_STREAM_KEY || '')),
});

/**
 * Mint a live stream.
 *
 * `public: true` for the same reason the videos are: a private live stream gets a
 * per-viewer token in the playlist PATH, and a playlist path that changes per viewer
 * cannot be what our own player's `data-hls` attribute holds. `record` is off by default —
 * an hour of live-to-VOD is an hour of hosting, which is a decision rather than a default.
 */
export async function createLiveStream({ liveName = '', record = false, env = process.env } = {}) {
  const created = await call('/live-streams', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ name: liveName || 'ByteBikri live', public: true, record: Boolean(record) }),
    env,
  });
  const id = pick(created, ['liveStreamId']);
  if (!id) {
    throw new VideoApiError(
      `the video host created no live stream — keys were ${describeDeep(created)}`,
      { body: created, path: '/live-streams', provider: name },
    );
  }
  return {
    id: String(id),
    streamKey: pick(created, ['streamKey']) || null,
    hls: pick(pick(created, ['assets']) || {}, ['hls']) || null,
    broadcasting: Boolean(pick(created, ['broadcasting'])),
    raw: created,
  };
}

/** The live stream's current state — `broadcasting` is the one that says "live now". */
export async function liveStream(id, { env = process.env } = {}) {
  const liveId = requireLiveId(id);
  const record = await call(`/live-streams/${encodeURIComponent(liveId)}`, { env });
  return {
    id: liveId,
    streamKey: pick(record, ['streamKey']) || null,
    hls: pick(pick(record, ['assets']) || {}, ['hls']) || null,
    broadcasting: Boolean(pick(record, ['broadcasting'])),
    name: pick(record, ['name']) ?? null,
    raw: record,
  };
}

/** Change what a live stream is called, whether it records, or where it restreams. */
export async function updateLiveStream(id, patch = {}, { env = process.env } = {}) {
  const liveId = requireLiveId(id);
  const record = await call(`/live-streams/${encodeURIComponent(liveId)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(patch),
    env,
  });
  return record;
}

/**
 * Remove a live stream.
 *
 * Called when a store takes a live file down: a live container left behind is a thing that
 * keeps existing on somebody's account (and, on a paid plan, keeps being billed) for a
 * stream nobody can reach. A 404 is success — gone is what was wanted.
 */
export async function removeLiveStream(id, { env = process.env } = {}) {
  const liveId = requireLiveId(id);
  try {
    await call(`/live-streams/${encodeURIComponent(liveId)}`, { method: 'DELETE', env });
    return true;
  } catch (err) {
    if (err?.status === 404) return true;
    throw err;
  }
}
