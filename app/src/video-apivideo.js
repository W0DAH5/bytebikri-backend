/**
 * api.video, as a provider behind the registry in `video.js` — and the first one that
 * can run a LIVE INGEST, which makes this file the only host in the registry that
 * changes what the product can do rather than only where the bytes sit.
 *
 * ── TWO ENVIRONMENTS, ONE KEY ────────────────────────────────────────────────
 *
 *   production  https://ws.api.video        the paid, uncapped environment
 *   sandbox     https://sandbox.api.video   free, for testing only, and capped in ways
 *                                           that disqualify it for a store: video is cut
 *                                           to 30 seconds, LIVE IS STOPPED at 30 minutes
 *                                           and its recording is cut at 30 seconds,
 *                                           everything is watermarked and deleted after
 *                                           24 hours
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
 * ── DECISION: THIS HOST STORES NOTHING ──────────────────────────────────────
 *
 * api.video is a LIVE provider here and not a place files live, and the reason is the
 * shape of its bill rather than a preference: encoding is free and unlimited, DELIVERY is
 * metered per minute per viewer, and HOSTING is metered per minute stored — including
 * every minute of a recorded live stream (their pricing page, and their terms of service).
 * The hosts we already have hold files at no marginal cost, so paying a minute-meter for
 * storage we do not need would be paying for the wrong thing. What api.video has that
 * nothing else here has is the INGEST, and that is what we buy.
 *
 * `capabilities.kinds` is therefore EMPTY, which is not a placeholder: `driverForKind`
 * consults exactly that list, so no kind of file — video included — can ever be routed
 * here, whatever `VIDEO_DRIVER` says. The policy is enforced by the registry rather than
 * written down and hoped for, and a test holds it there.
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
import { VideoApiError, pick, describeDeep, errorMessage, httpCall } from './video-shared.js';

export const name = 'apivideo';
export const label = 'api.video';

export const capabilities = {
  /*
   * LIVE ONLY, AND THE EMPTY LIST IS THE POLICY.
   *
   * `driverForKind` asks `hostAccepts()`, which asks this list. With no kinds declared,
   * there is no value of `VIDEO_DRIVER` that can route a byte here — the file hosts are
   * Filemoon, Pixeldrain and Catbox, and this one runs streams. Keeping `['video']` and a
   * paragraph of prose would have left the door open to exactly the configuration this
   * decision exists to prevent.
   */
  role: 'live',
  kinds: [],
  hls: true,
  lists: true,
  needs: 'APIVIDEO_API_KEY',
  note: 'a live ingest and the HLS delivery of it — this host runs streams, it is not where files are stored',
  /** The sandbox's limits are real limits, and on LIVE they are their own set. */
  sandbox: {
    maxSeconds: 30,
    liveMaxSeconds: 1800,
    liveRecordSeconds: 30,
    watermark: true,
    deletesAfterHours: 24,
    note: 'sandbox: video is cropped to 30 seconds; live is STOPPED after 30 minutes and its '
      + 'recording cut at 30 seconds; everything is watermarked and deleted after 24 hours',
  },
  /*
   * The live half, as data — because it is a different question from storage.
   *
   * `ingest` is what a seller types into their encoder, `streamsInPage` is that the url
   * they get is an HLS playlist our player already understands, and `keyIsStored` is the
   * promise that makes a broadcast credential safe to hand out: we never keep it.
   *
   * `recording: false` is the default and it is the metered one: a recorded stream becomes
   * a stored video, and stored minutes are billed. A replay is a decision a seller makes,
   * not something that should quietly start costing money when they press Go live.
   */
  live: {
    ingest: {
      rtmp: 'rtmp://broadcast.api.video/s',
      rtmps: 'rtmps://broadcast.api.video:1936/s',
      srt: 'srt://broadcast.api.video:6200?streamid=<streamKey>',
    },
    player: 'hls',
    recording: false,
    keyIsStored: false,
    metering: 'live is metered per minute DELIVERED to each viewer; encoding is free and unlimited, '
      + 'and only a recorded stream costs hosting — so a stream watched by nobody costs nothing',
    note: 'the host runs the RTMP/SRT ingest; the stream comes back as an HLS playlist our own player plays',
  },
  policy: {
    commercial: 'allowed',
    note: 'a video-infrastructure provider: the ingest, the encoding (free and unlimited) and the '
      + 'delivery are the product; hosting is metered, which is why nothing is stored here',
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
