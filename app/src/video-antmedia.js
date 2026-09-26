/**
 * Ant Media Server, as a LIVE host behind the registry — the second one, and the first that
 * is OURS instead of bought.
 *
 * ── WHAT IT IS, AND WHY IT IS THE ONLY LIVE HOST NOW (§12) ──────────────────
 *
 * The other live host sold an ingest and billed per minute delivered; Ant Media Server is software we
 * run, so the audience stops setting the bill and a server we already pay for becomes the
 * encoder. `LIVE_DRIVER` picks between them, which is what that variable was for: they
 * answer the same question — who runs the stream — and both end as an `.m3u8` in front of
 * the player we already have.
 *
 *   Community Edition   free, and enough for this product: RTMP in, HLS out
 *   Enterprise Edition  paid; adds sub-second WebRTC playback, adaptive bitrate,
 *                       publish/play token control, scaling, GPU encoding
 *
 * ── THE STREAMID IS BOTH THE IDENTITY AND THE PUBLISH CREDENTIAL ─────────────
 *
 * In Community there is no publish-token control (that is an Enterprise feature), so anyone
 * holding a streamId can publish to that stream. Two consequences, both deliberate:
 *
 *   * **we generate the streamId ourselves**, from `crypto.randomBytes` — 32 hex characters,
 *     so it cannot be guessed or enumerated the way a counter can;
 *   * **it is never shown to a viewer.** It appears in the playlist url, so it lives behind
 *     our own door like every other bearer url here (§7, §10.6), and the seller's panel is
 *     the only place it is printed. `capabilities.live.keyIsStored` is therefore **true**:
 *     the id IS the key, which is a different promise from a hosted service's, and a capability
 *     that lies about that would be worse than no capability at all.
 *
 * ── AUTH: TWO MODES, AND THE ONE THAT NEEDS NOTHING ──────────────────────────
 *
 * A fresh server has the REST API's **IP filter** on and the JWT filter off, which means a
 * request from a whitelisted address needs no header at all — so `ANT_MEDIA_REST_SECRET`
 * unset is a supported configuration, not a hole. When the JWT filter IS on (the right
 * setting for a server a user-uploaded catalogue talks to), we sign our own HS256 token per
 * request with Node's crypto: the server only verifies the signature, so there is no token
 * cache and nothing to refresh.
 *
 * ── WHAT THIS MODULE DELIBERATELY DOES NOT HAVE ──────────────────────────────
 *
 * No upload, no playback of stored files, no `acceptsFile`: `capabilities.kinds` is empty,
 * exactly as any live host's is, and for the same reason — this host is for RUNNING a stream,
 * and the product already has three hosts that hold files (§10.6). HLS playback of a live
 * stream is all the player needs from it.
 */
import crypto from 'node:crypto';
import { VideoApiError, pick, describeDeep, errorMessage, httpCall } from './video-shared.js';

export const name = 'antmedia';
export const label = 'Ant Media Server';

export const capabilities = {
  /*
   * LIVE ONLY, and the empty list is the policy — `driverForKind` consults it, so no value
   * of `VIDEO_DRIVER` can route a byte here. The same mechanism the registry has used for a
   * different reason: this is a stream engine, and the product's file hosts are elsewhere.
   */
  role: 'live',
  kinds: [],
  hls: true,
  lists: true,
  needs: 'ANT_MEDIA_BASE',
  note: 'our own streaming server: RTMP in, HLS out — the bill is the server, not the audience',
  live: {
    /* Filled per deployment by `ingestFor()`: the address depends on the server's host. */
    ingest: { rtmp: 'rtmp://<your-server>:1935/<app>' },
    player: 'hls',
    /*
     * The server CAN record (MP4/WebM/HLS, locally or to S3), and that is an app setting on
     * the server rather than something a create call should turn on behind an owner's back:
     * a recorded stream is disk, and disk is the thing an unmetered plan runs out of.
     */
    recording: true,
    recordingIsAppSetting: true,
    /** The id IS the key — see the header. Never displayed to a viewer. */
    keyIsStored: true,
    publishSecret: 'streamId',
    metering: 'unmetered by viewers: the cost is the server and its bandwidth. The Community Edition '
      + 'has no viewer or broadcaster limit in its licence — the limit is the machine',
    note: 'Community Edition: no publish tokens, so the streamId is generated with full entropy and '
      + 'treated as a secret; Enterprise adds publish/play token control and sub-second WebRTC',
  },
  /*
   * The licence facts, because they decide what this deployment may legally do.
   *
   * The Community Edition is free to run, commercial use included. The Enterprise TRIAL —
   * the key that arrives by email and expires two weeks later — may not be used "for any
   * commercial purposes whatsoever or in any manner intended to benefit, aid, or assist a
   * third party" (their EULA §4.1.2), and a platform streaming other people's stores is
   * precisely that. So the trial is for evaluating Enterprise features on a test stream,
   * and the thing this product runs on is Community (or a paid licence).
   */
  policy: {
    commercial: 'allowed',
    note: 'the Community Edition is free software and may be run commercially; the Enterprise '
      + 'TRIAL may not be used commercially or to benefit third parties, so a trial key belongs '
      + 'on a test stream and never on a store\'s broadcast',
  },
};

/** Only what a live host can honestly answer: where the playlist will be. */
export const mediaOrigins = (env = process.env) => {
  try { return [new URL(base(env)).origin]; } catch { return []; }
};

/** Configured means there is a server to talk to. */
export const configured = (env = process.env) => Boolean(String(env.ANT_MEDIA_BASE || '').trim());

const trim = (value) => String(value || '').replace(/\/+$/, '');

export const base = (env = process.env) => trim(env.ANT_MEDIA_BASE || '');

/**
 * The application on the server. `LiveApp` is what a fresh Community install ships;
 * `WebRTCAppEE` is the Enterprise default, and a deployment on that one sets this.
 */
export const appName = (env = process.env) => String(env.ANT_MEDIA_APP || 'LiveApp').trim().replace(/^\/+|\/+$/g, '');

/** `rtmp://host:1935/<app>`, derived from the base unless the deployment says otherwise. */
export function rtmpBase(env = process.env) {
  const explicit = trim(env.ANT_MEDIA_RTMP_BASE || '');
  if (explicit) return explicit;
  let host = 'your-server';
  try { host = new URL(base(env)).hostname; } catch { /* unconfigured: keep the placeholder */ }
  return `rtmp://${host}:1935/${appName(env)}`;
}

/** Where the player will find the stream, once it is up. */
export const hlsUrl = (streamId, env = process.env) =>
  `${base(env)}/${appName(env)}/streams/${encodeURIComponent(String(streamId))}.m3u8`;

/** A stream id survives the same filter as a video id, and a url. */
export const idPattern = /^[A-Za-z0-9_-]{6,64}$/;

/**
 * Mint our own stream id: `bb` + 32 hex characters.
 *
 * Not vanity and not decoration. In Community the id is the publish credential, so its
 * entropy is the only thing standing between a store's broadcast and anybody who fancies
 * streaming to it — and the obvious alternative (let the server number them) produces ids
 * that can be guessed by asking for the stream before it exists.
 */
export function mintStreamId() {
  return `bb${crypto.randomBytes(16).toString('hex')}`;
}

const b64url = (input) => Buffer.from(input).toString('base64url');

/**
 * The HS256 token the JWT REST filter wants.
 *
 * Their filter verifies the SIGNATURE and ignores the payload, so the payload is empty on
 * purpose and there is no expiry to refresh: the token is derived from the secret on every
 * request, which means no cache, no clock to keep and nothing to invalidate.
 */
export function signJwt(secret, { payload = {} } = {}) {
  const signingInput = `${b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${b64url(JSON.stringify(payload))}`;
  const signature = crypto.createHmac('sha256', String(secret)).update(signingInput).digest('base64url');
  return `${signingInput}.${signature}`;
}

/** How this deployment is authorised — reported by the doctor, never guessed. */
export const authMode = (env = process.env) =>
  (String(env.ANT_MEDIA_REST_SECRET || '').trim() ? 'jwt' : 'ip-filter');

const authHeaders = (env) => {
  const secret = String(env.ANT_MEDIA_REST_SECRET || '').trim();
  return secret ? { authorization: `Bearer ${signJwt(secret)}` } : {};
};

/**
 * One call to the application REST API: `{base}/{app}/rest/v2/...`.
 *
 * The error messages carry the diagnosis, because the three ways this fails look identical
 * from the outside and each has a different fix: the IP is not whitelisted, the JWT secret
 * is wrong, or the application name is not what the server has.
 */
async function call(path, { method = 'GET', body, headers = {}, env = process.env, timeoutMs = 30_000 } = {}) {
  if (!configured(env)) {
    throw new VideoApiError('no Ant Media Server is configured (ANT_MEDIA_BASE is unset)', {
      path, provider: name,
    });
  }
  const url = `${base(env)}/${appName(env)}/rest/v2${path}`;
  const { status, text, json } = await httpCall(url, {
    method,
    headers: { accept: 'application/json', ...authHeaders(env), ...headers },
    body,
    timeoutMs,
    provider: name,
    path,
  });
  if (status === 401 || status === 403) {
    throw new VideoApiError(
      `the server refused this request (${status}). Either our address is not in its REST API IP `
      + 'filter, or the JWT filter is on and ANT_MEDIA_REST_SECRET is not the secret set beside it',
      { status, body: json, path, provider: name },
    );
  }
  if (status === 404 && method === 'GET' && path.startsWith('/broadcasts/list')) {
    throw new VideoApiError(
      `no application named "${appName(env)}" answered on that server (404). A fresh Community `
      + 'install ships LiveApp and an Enterprise install ships WebRTCAppEE — set ANT_MEDIA_APP to '
      + 'the one this server actually runs',
      { status, body: json, path, provider: name },
    );
  }
  if (status < 200 || status >= 300) {
    throw new VideoApiError(
      `the server answered ${status}: ${pick(json, ['message', 'error', 'detail'])
        || errorMessage(json, text.slice(0, 140) || 'no body')}`,
      { status, body: json, path, provider: name },
    );
  }
  return json;
}

/**
 * Is there a server there, is it ours to talk to, and what is on it?
 *
 * Deliberately a LIST call rather than a version endpoint: the list is the documented
 * application API, it proves the application name is right, and it answers the question an
 * operator actually has — how many streams does this server know about, and how many are
 * live right now.
 */
export async function account({ env = process.env } = {}) {
  const listed = await call('/broadcasts/list/0/200', { env });
  const items = Array.isArray(listed) ? listed : (Array.isArray(listed?.items) ? listed.items : []);
  return {
    id: null,
    email: null,
    tier: 'self-hosted',
    token: authMode(env) === 'jwt' ? 'signing our own JWT' : 'no credential — the server\'s IP filter authorises us',
    auth: authMode(env),
    base: base(env),
    app: appName(env),
    streams: items.length,
    live: items.filter((b) => String(pick(b, ['status']) || '') === 'broadcasting').length,
    raw: items.slice(0, 3),
  };
}

// ─── live ────────────────────────────────────────────────────────────────────

/** Is a live driver configured — that is, may this deployment mint streams? */
export const liveEnabled = (env = process.env) => configured(env)
  && String(env.LIVE_DRIVER || '').trim().toLowerCase() === name;

/** What a seller types into OBS or ffmpeg, given the stream id. */
export const ingestFor = (streamId, env = process.env) => {
  const rtmp = rtmpBase(env);
  return {
    rtmp,
    publishUrl: streamId ? `${rtmp}/${String(streamId)}` : null,
    note: 'OBS → Settings → Stream → Service: Custom; Server is the address above and the stream id '
      + 'goes in the Stream Key field',
  };
};

const requireId = (id) => {
  const value = String(id || '');
  if (!idPattern.test(value)) {
    throw new VideoApiError(`the stream id is not usable in a url: ${value.slice(0, 80)}`, {
      provider: name, path: '/broadcasts',
    });
  }
  return value;
};

/**
 * Mint a broadcast — with OUR id, minted here.
 *
 * `mp4Enabled: false` asks the server not to keep a recording of THIS stream. Recording is
 * an application setting in Ant Media, so this is a request rather than a guarantee — an
 * operator who wants every broadcast recorded sets it on the server and should expect it to
 * win, which is why the doc says "app setting" out loud instead of pretending otherwise.
 */
export async function createLiveStream({ liveName = '', record = false, env = process.env } = {}) {
  const streamId = mintStreamId();
  const created = await call('/broadcasts/create', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ streamId, name: liveName || 'ByteBikri live', mp4Enabled: Boolean(record) }),
    env,
  });
  const id = pick(created, ['streamId']) || streamId;
  const publish = pick(created, ['rtmpURL', 'rtmpUrl']) || ingestFor(id, env).publishUrl;
  return {
    id: String(id),
    streamKey: String(id),
    hls: hlsUrl(id, env),
    publishUrl: String(publish),
    broadcasting: String(pick(created, ['status']) || '') === 'broadcasting',
    raw: created,
  };
}

/**
 * The state comes from the SERVER, never from our own bookkeeping.
 *
 * `status` is Ant Media's own word — `created`, `broadcasting`, `finished`, `preparing` —
 * and the viewer counts are per protocol, which is how an operator sees that a stream is up
 * but nobody is watching rather than assuming either.
 */
export async function liveStream(id, { env = process.env } = {}) {
  const streamId = requireId(id);
  const record = await call(`/broadcasts/${encodeURIComponent(streamId)}`, { env });
  const status = String(pick(record, ['status']) || '');
  return {
    id: streamId,
    status,
    broadcasting: status === 'broadcasting',
    hls: hlsUrl(streamId, env),
    name: pick(record, ['name']) ?? null,
    viewers: {
      hls: Number(pick(record, ['hlsViewerCount']) || 0),
      webRTC: Number(pick(record, ['webRTCViewerCount']) || 0),
      rtmp: Number(pick(record, ['rtmpViewerCount']) || 0),
    },
    bitrate: Number(pick(record, ['bitrate']) || 0),
    raw: record,
  };
}

export async function updateLiveStream(id, patch = {}, { env = process.env } = {}) {
  const streamId = requireId(id);
  await call(`/broadcasts/${encodeURIComponent(streamId)}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
    env,
  });
  return liveStream(streamId, { env });
}

/** Gone is the outcome we wanted, so a 404 is a success — same rule as every other host. */
export async function removeLiveStream(id, { env = process.env } = {}) {
  const streamId = requireId(id);
  try {
    await call(`/broadcasts/${encodeURIComponent(streamId)}`, { method: 'DELETE', env });
    return true;
  } catch (err) {
    if (err.status === 404) return true;
    throw err;
  }
}

/** A broadcast object, described for a log line — used by the doctor when a shape surprises it. */
export const describeBroadcast = (raw) => describeDeep(raw);
