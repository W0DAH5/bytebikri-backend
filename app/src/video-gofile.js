/**
 * GoFile, as a provider behind the registry in `video.js`.
 *
 * ── THE FACT THIS MODULE EXISTS TO ENCODE ────────────────────────────────────
 *
 * A free or guest GoFile account cannot be a video host for us, and the reason is not
 * uploads — those work on any tier. It is that nothing a free account can produce is
 * PLAYABLE:
 *
 *   * `POST /contents/{id}/directlinks` — "direct links download content straight from
 *     the storage servers… **A Premium feature**";
 *   * `GET /contents/{contentId}` — the file's own metadata, badged Premium in the same
 *     reference, with the line "Direct API access to listings is Premium-only: other
 *     tiers receive error-notPremium";
 *   * the `downloadPage` an upload does return is an HTML page, which a `<video>` cannot
 *     play — and it is the only url a free account is handed.
 *
 * So a video uploaded on a free account would sit at the host, cost the seller their
 * bandwidth, and never play for anyone. `upload()` therefore checks the tier BEFORE it
 * sends a byte and refuses with a sentence that says this, rather than accepting a file
 * it cannot deliver. That is the same rule as the unreachable host in the server's boot
 * probe: fail where somebody can see it.
 *
 * Two more facts from the same documentation are recorded in `capabilities` and printed
 * by the doctor, because they are the kind of thing an operator discovers too late:
 * free-tier content is deleted after roughly ten days of inactivity, and the API's
 * envelope means **`status`, not the HTTP code, is the truth** (several endpoints answer
 * HTTP 200 with an error status), so this client branches on the field.
 */
import { VideoApiError, pick, describe, describeDeep, errorMessage, classifyUrl, httpCall } from './video-shared.js';

export const name = 'gofile';
export const label = 'GoFile';

export const capabilities = {
  maxBytes: null,
  hls: false,
  durable: false,
  lists: false,
  needs: 'GOFILE_TOKEN',
  note: 'uploads work on any tier, but a playable link needs Premium; free content is '
    + 'removed after ~10 days of inactivity',
};

/** Nothing static: direct links arrive from `/directlinks` on a storage host of theirs. */
export const mediaOrigins = () => [];

/** Configured means the credential this host needs is present. */
export const configured = (env = process.env) => Boolean(env.GOFILE_TOKEN);

/**
 * This provider's id alphabet: a content UUID, or the 8-character share code that the
 * read endpoint also accepts. Deliberately narrow — no slashes, no query, no dot-dot —
 * because the id becomes part of a storage key, and a key reaches routes from a URL.
 */
export const idPattern = /^[A-Za-z0-9-]{1,64}$/;

const DEFAULT_API_BASE = 'https://api.gofile.io';
const DEFAULT_UPLOAD_BASE = 'https://upload.gofile.io';
const trim = (value) => String(value || '').replace(/\/+$/, '');

export const base = (env = process.env) => trim(env.GOFILE_API_BASE || DEFAULT_API_BASE);
export const uploadBase = (env = process.env) => trim(env.GOFILE_UPLOAD_BASE || DEFAULT_UPLOAD_BASE);

/**
 * One authenticated call, with the envelope's `status` treated as the truth.
 *
 * `httpCall` gives back the parsed body and the raw text; the judgement about what a
 * response MEANS belongs here, because only this host wraps its answers in a `status`
 * field that can say `error-notPremium` under an HTTP 200.
 */
async function call(path, {
  method = 'GET', body, headers = {}, env = process.env, timeoutMs = 30_000, allow = [],
} = {}) {
  const token = env.GOFILE_TOKEN;
  if (!token) {
    throw new VideoApiError('the video host is not configured (GOFILE_TOKEN is unset)', { path, provider: name });
  }
  const { status, text, json } = await httpCall(`${base(env)}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, ...headers },
    body,
    timeoutMs,
    provider: name,
    path,
  });
  if (status < 200 || status >= 300) {
    throw new VideoApiError(
      `the video host answered ${status}: ${errorMessage(json, text.slice(0, 140) || 'no body')}`,
      { status, body: json, path, provider: name },
    );
  }
  // HTTP 200 is not success here. `status` is, and the documented error statuses
  // (`error-notPremium`, `error-limits`, `error-token`, `error-rateLimit`, …) arrive
  // under a 200 often enough that the reference says so in as many words.
  const verdict = pick(json, ['status']);
  if (typeof verdict === 'string' && verdict !== 'ok' && !allow.includes(verdict)) {
    throw new VideoApiError(
      `the video host refused (${verdict})`,
      { status, body: json, path, provider: name },
    );
  }
  return json ?? (text || null);
}

/**
 * Who the token belongs to — and, for us, whether it is the kind of account that can
 * deliver a video at all.
 *
 * Cached for the process because it is asked once per upload and the answer changes
 * about as often as somebody buys a subscription.
 */
let whoami = null;
export function forgetAccount() { whoami = null; }

export async function account({ env = process.env, fresh = false } = {}) {
  if (whoami && !fresh) return whoami;
  const body = await call('/accounts/getid', { env });
  whoami = {
    id: pick(body, ['id', 'accountId']) ?? null,
    email: pick(body, ['email']) ?? null,
    tier: String(pick(body, ['tier']) ?? 'guest').toLowerCase(),
    raw: body,
  };
  return whoami;
}

/** Premium is the word the provider uses; anything else is a tier that cannot deliver. */
export const canDeliver = (who) => String(who?.tier || '').toLowerCase() === 'premium';

/** The refusal, in one place, because both `upload` and the doctor have to say it. */
export const PLAYBACK_NEEDS_PREMIUM =
  'a GoFile account on the free tier cannot produce a playable link for a video '
  + '(direct links and the file metadata endpoint are Premium features, and the download '
  + 'page is HTML that a player cannot use) — so a video stored there could not be watched. '
  + 'Upload refused: use a Premium GoFile account, or set VIDEO_DRIVER to another host.';

/**
 * Upload bytes — after establishing that the bytes could actually be served.
 *
 * The order matters and is the point of the module: tier first, bytes second. A refusal
 * after the upload would leave a copy of the seller's video at a host we cannot play it
 * from, which is worse than refusing.
 */
export async function upload(buffer, filename, { mimeType = 'application/octet-stream', env = process.env } = {}) {
  const who = await account({ env });
  if (!canDeliver(who)) {
    throw new VideoApiError(PLAYBACK_NEEDS_PREMIUM, { path: '/accounts/getid', provider: name });
  }

  const form = new FormData();
  form.append('file', new Blob([buffer], { type: mimeType }), filename || 'video.mp4');
  if (env.GOFILE_FOLDER_ID) form.append('folderId', env.GOFILE_FOLDER_ID);

  // A DIFFERENT HOSTNAME from the API, which is why it is its own constant: the upload
  // fleet routes each file to the best storage server, so `upload.gofile.io` is not
  // `api.gofile.io` with another path.
  const { status, text, json } = await httpCall(`${uploadBase(env)}/uploadfile`, {
    method: 'POST',
    headers: { authorization: `Bearer ${env.GOFILE_TOKEN}` },
    body: form,
    timeoutMs: 120_000,
    provider: name,
    path: '/uploadfile',
  });
  if (status < 200 || status >= 300) {
    throw new VideoApiError(
      `the video host answered ${status}: ${errorMessage(json, text.slice(0, 140) || 'no body')}`,
      { status, body: json, path: '/uploadfile', provider: name },
    );
  }
  const verdict = pick(json, ['status']);
  if (typeof verdict === 'string' && verdict !== 'ok') {
    throw new VideoApiError(`the video host refused the upload (${verdict})`, { body: json, path: '/uploadfile', provider: name });
  }
  const id = pick(json, ['id', 'fileId']);
  if (!id) {
    throw new VideoApiError(
      `the upload succeeded but no file id came back — response was ${describeDeep(json)}`,
      { body: json, path: '/uploadfile', provider: name },
    );
  }
  return { id: String(id), body: json };
}

/**
 * The playable url.
 *
 * A direct link is the only thing a `<video>` can use, and creating one is the Premium
 * call. `expireTime` is deliberately left off: a link with no expiry is the one a stored
 * asset needs, and a link that quietly expires would turn a paid file into a dead player
 * on a date nobody wrote down.
 */
export async function playback(id, { env = process.env } = {}) {
  const body = await call(`/contents/${encodeURIComponent(id)}/directlinks`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
    env,
  });
  const url = pick(body, ['directLink', 'direct_link', 'link', 'url', 'downloadLink']);
  if (!url) {
    throw new VideoApiError(
      `no direct link in the response — the body was ${describeDeep(body)}; a direct link is what a `
      + 'player can use, and creating one is the Premium call this module documents',
      { body, path: `/contents/${id}/directlinks`, provider: name },
    );
  }
  return { kind: classifyUrl(url), url, id: String(id) };
}

/**
 * Delete, and say whether the host agreed.
 *
 * `DELETE /contents` takes a list; ours always has one member. A 404 is a `true` — the
 * file is not there, which is what the caller asked for — and anything else propagates,
 * because a promise about deletion must not read a failure as success.
 */
export async function remove(id, { env = process.env } = {}) {
  try {
    await call('/contents', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ contentsId: [String(id)] }),
      env,
    });
    return true;
  } catch (err) {
    if (err instanceof VideoApiError && err.status === 404) return true;
    if (err instanceof VideoApiError && /error-notFound/.test(String(err.message))) return true;
    throw err;
  }
}

/** What the doctor prints when a shape is not what this client expects. */
export const shapeOf = (body) => describe(body);
