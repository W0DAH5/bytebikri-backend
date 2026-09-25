/**
 * Pixeldrain, as a provider behind the registry in `video.js`.
 *
 * ── THE GENERAL FILE HOST ────────────────────────────────────────────────────
 *
 * Pixeldrain takes any kind of file, keeps it indefinitely, and gives every file a
 * direct url that a browser or media element can fetch with `Range` — which is the
 * whole shape this product needs. It is the one host of the four whose design fits
 * the non-video half of a store's catalogue: an archive, a PDF, an audio master, a
 * photo set too large for an image host.
 *
 *   PUT    /api/file/{filename}        raw body (the docs recommend this over POST
 *                                      multipart, which "can cause performance issues")
 *   GET    /api/file/{id}/info         name, size, mime, views, bandwidth, availability
 *   GET    /api/file/{id}              the bytes, byte ranges supported
 *   DELETE /api/file/{id}              a real delete
 *   GET    /api/user                   who the key belongs to — the doctor's check
 *
 * ── THREE THINGS THAT ARE NOT LIKE THE OTHER HOSTS ───────────────────────────
 *
 * 1. **The credential is a password, not a bearer.** HTTP Basic with the key in the
 *    PASSWORD field and an empty username (`Authorization: Basic :<key>`). Sending it
 *    the way the other three expect would authenticate as nobody.
 * 2. **Hotlinking is the paid feature.** Its own error list includes
 *    `hotlink_detected: 403` — "hotlinking is only allowed with a premium
 *    subscription" — and its download limits are described as existing "to stop
 *    hotlinking". Our 302 sends a viewer's browser to a pixeldrain url, which is
 *    exactly what that means. So this host is `policy.commercial: 'premium'` for the
 *    use this product makes of it — and the doctor probes it rather than assuming.
 *    (GoFile was removed from the registry for this same class of reason: its playable
 *    links were the paid feature and its free storage expired.)
 * 3. **The key expires if it is not used.** Pixeldrain's own API-keys page: keys expire
 *    30 days after the last time they were used. A deployment that stops uploading for
 *    a month finds its key dead, which is why the doctor's check is also the thing that
 *    keeps the key alive.
 *
 * File size depends on the account's plan, so `maxBytes` is null: the product's own
 * upload cap binds first, and this module does not invent a limit the host never
 * published.
 */
import { VideoApiError, pick, describeDeep, errorMessage, httpCall, keySafe } from './video-shared.js';

export const name = 'pixeldrain';
export const label = 'Pixeldrain';

export const capabilities = {
  maxBytes: null,
  hls: false,
  durable: true,
  /*
   * No listing is used, and that is a decision rather than an oversight: a store's files
   * are tracked in OUR database (`assets.external_id`), so a host listing would be a
   * second, diverging copy of the truth. `exists` is answered from our own row, and the
   * doctor says "no listing" rather than calling an endpoint whose shape nobody verified.
   */
  lists: false,
  needs: 'PIXELDRAIN_API_KEY',
  note: 'any file kind; direct urls with byte ranges; a real delete; hotlinking needs Pro',
  /*
   * What this host is FOR (§10.5). Broad on purpose — it is the one provider here that
   * was not built around a single medium, so it can hold a store's archive, document or
   * audio master without turning it into a download-only mistake.
   *
   * `file` is the router's word for "none of the above" (`mediaKind` in `media.js`
   * returns exactly video, audio, image or file), and declaring it is what lets an
   * archive or a PDF leave this disk. A kind a host does not declare never reaches it —
   * which is why this list is checked against the vocabulary in the test file rather
   * than trusted to stay right by memory.
   */
  kinds: ['video', 'audio', 'image', 'file'],
  deletable: true,
  policy: {
    commercial: 'premium',
    note: 'hotlinking is a Pro feature (`hotlink_detected` is in its own error list) and '
      + 'download limits exist to stop it; a redirect to their url is hotlinking. Their '
      + 'API keys also expire 30 days after their last use',
  },
};

/**
 * The origin a page may load this host's media from.
 *
 * Unusually, this one is static: every file is served from the API host itself, so the
 * CSP can name it instead of relying on the policy's `https:` allowance. It follows the
 * configured base, so a self-hosted mirror is covered by the same line.
 */
export const mediaOrigins = (env = process.env) => {
  try { return [new URL(base(env)).origin]; } catch { return []; }
};

/**
 * Would this host take this file? Yes.
 *
 * Written out rather than omitted: this is the one provider with no kind, format or published
 * size limit, so the answer is always yes — and a router that falls back to local storage for
 * a file a host refuses needs to be able to ask every provider the same question. Silent
 * absence would mean "no opinion", which the router would have to guess about.
 */
export const acceptsFile = () => ({ ok: true });

/** Configured means the credential this host needs is present. */
export const configured = (env = process.env) => Boolean(env.PIXELDRAIN_API_KEY);

/** A file id, and nothing that could become a path or a query. */
export const idPattern = /^[A-Za-z0-9_-]{4,64}$/;

const DEFAULT_BASE = 'https://pixeldrain.com/api';
const trim = (value) => String(value || '').replace(/\/+$/, '');

export const base = (env = process.env) => trim(env.PIXELDRAIN_API_BASE || DEFAULT_BASE);

/** The url a stored file plays or downloads from — no token, no expiry, ranges included. */
export const urlFor = (id, env = process.env) => `${base(env)}/file/${encodeURIComponent(String(id))}`;

/**
 * One authenticated call.
 *
 * Pixeldrain answers JSON with a `success` boolean, and it does use HTTP status codes
 * honestly (403 for the hotlink and limit refusals), so both are checked — the body's
 * `success` first because a 200 with `success: false` is the documented shape for
 * `no_file` and friends.
 */
async function call(path, {
  method = 'GET', body, headers = {}, env = process.env, timeoutMs = 30_000, raw = false,
} = {}) {
  const key = env.PIXELDRAIN_API_KEY;
  if (!key) {
    throw new VideoApiError('the file host is not configured (PIXELDRAIN_API_KEY is unset)', { path, provider: name });
  }
  const { status, text, json } = await httpCall(`${base(env)}${path}`, {
    method,
    // Basic auth with the key in the PASSWORD field. `Buffer` rather than `btoa` because
    // this runs in Node, and a key is not guaranteed to be ASCII-safe.
    headers: { authorization: `Basic ${Buffer.from(`:${key}`, 'utf8').toString('base64')}`, ...headers },
    body,
    timeoutMs,
    provider: name,
    path,
  });
  if (status < 200 || status >= 300) {
    /*
     * The host's error CODE belongs in the sentence, not just its prose.
     *
     * Pixeldrain distinguishes its refusals by a `value` field — `hotlink_detected`,
     * `file_rate_limited_captcha_required`, `transfer_limit_exceeded`, `max_concurrent_downloads`
     * — and those words are what somebody searches for. The first draft dropped it and
     * printed only the human sentence, so the one refusal this product most needs to
     * recognise ("hotlinking is only allowed with a premium subscription") arrived without
     * the name that makes it greppable.
     */
    const code = pick(json, ['value']);
    throw new VideoApiError(
      `the file host answered ${status}${code ? ` (${code})` : ''}: `
      + `${errorMessage(json, text.slice(0, 140) || 'no body')}`,
      { status, body: json, path, provider: name },
    );
  }
  if (raw) return { status, text, json };
  if (json && json.success === false) {
    throw new VideoApiError(
      `the file host refused (${pick(json, ['value']) || 'no reason given'}): `
      + `${errorMessage(json, 'no message')}`,
      { status, body: json, path, provider: name },
    );
  }
  return json;
}

/**
 * Upload bytes.
 *
 * `PUT /api/file/{filename}` carries the bytes as the raw request body — no multipart,
 * no boundary, no second copy of the file in memory. The docs recommend it over the
 * POST form "which can cause performance issues in certain environments", and 25 MB of
 * a seller's upload is exactly such an environment.
 */
export async function upload(buffer, filename, { mimeType = 'application/octet-stream', env = process.env } = {}) {
  const safe = keySafe(filename || 'upload').slice(0, 200) || 'upload';
  const body = await call(`/file/${encodeURIComponent(safe)}`, {
    method: 'PUT',
    body: buffer,
    headers: { 'content-type': mimeType || 'application/octet-stream' },
    env,
    timeoutMs: 120_000,
  });
  const id = pick(body, ['id']);
  if (!id) {
    throw new VideoApiError(
      `the file host accepted the upload but named no file — keys were ${describeDeep(body)}`,
      { body, path: '/file', provider: name },
    );
  }
  return { id: String(id), body };
}

/** One file's record — and the doctor's way to classify what a file will play as. */
export async function file(id, { env = process.env } = {}) {
  const body = await call(`/file/${encodeURIComponent(String(id))}/info`, { env });
  return body;
}

/**
 * A url and a kind.
 *
 * Pixeldrain serves the stored bytes directly at a stable url on the API host, so there
 * is nothing to resolve and nothing to classify: one file, one progressive url. The only
 * host call in this module is the one the upload already made.
 */
export async function playback(id, { env = process.env } = {}) {
  const fileId = String(id || '');
  if (!idPattern.test(fileId)) {
    throw new VideoApiError(`the stored file id is not usable as a url: ${fileId.slice(0, 80)}`, {
      provider: name, path: '/file',
    });
  }
  return { kind: 'file', url: urlFor(fileId, env), id: fileId };
}

/** Delete, and say whether the host agreed — a 404 means it is already gone. */
export async function remove(id, { env = process.env } = {}) {
  const fileId = String(id || '');
  if (!idPattern.test(fileId)) {
    throw new VideoApiError(`the stored file id is not usable in a delete: ${fileId.slice(0, 80)}`, {
      provider: name, path: '/file',
    });
  }
  try {
    await call(`/file/${encodeURIComponent(fileId)}`, { method: 'DELETE', env });
    return true;
  } catch (err) {
    if (err?.status === 404) return true;
    throw err;
  }
}

/**
 * What the doctor asks: which account does this key belong to?
 *
 * The tier arrives as an OBJECT (`{id, name}`) rather than a string, which is how the first
 * draft of this function printed `tier: [object Object]` — a shape worth normalising here
 * because the doctor's free-plan warning matches on that word, and a warning that can never
 * match is a warning that can never warn.
 */
export async function account({ env = process.env } = {}) {
  const body = await call('/user', { env });
  const subscription = pick(body, ['subscription', 'plan']);
  const tier = typeof subscription === 'string'
    ? subscription
    : (pick(subscription, ['name', 'id', 'title']) ?? null);
  return {
    id: pick(body, ['id', 'username']) ?? null,
    email: pick(body, ['email']) ?? null,
    tier,
    raw: body,
  };
}
