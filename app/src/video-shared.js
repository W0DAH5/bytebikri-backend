/**
 * The parts every video host shares: the error type, the shape readers, and one
 * HTTP call.
 *
 * Written the same way as the Filemoon client it was carved out of, and for the same
 * reason: this environment refuses egress to every provider we have (TLS reset or a
 * bare connection refusal for every host in the registry alike; GitHub
 * answers, so it is an allowlist rather than a broken network). Not one line here has
 * met a live API, so nothing is trusted beyond HTTP itself and every wrong guess is
 * made legible by `describe()`/`describeDeep()`.
 *
 * The three hosts differ in more than their urls — one answers JSON in an envelope
 * whose `status` field beats the HTTP code, one answers plain text — which is why this
 * module stops at the transport and the providers keep their own reading of a response.
 */

/** Every failure from the video-host layer is this type, with the host's words in it. */
export class VideoApiError extends Error {
  constructor(message, { status = 0, body = null, path = '', provider = '' } = {}) {
    super(message);
    this.name = 'VideoApiError';
    this.status = status;
    this.body = body;
    this.path = path;
    this.provider = provider;
  }
}

/**
 * `fetch` with a deadline and a body in hand.
 *
 * The deadline matters more than it looks: a host that accepts the connection and then
 * says nothing would otherwise hold a seller's upload open until the platform's own
 * proxy gives up, which reads to them as "the site is broken" rather than "the host is".
 * On timeout the error names the host, so the sentence a seller sees is about the video
 * host rather than about us.
 */
export async function httpCall(url, {
  method = 'GET',
  headers = {},
  body,
  timeoutMs = 30_000,
  provider = '',
  path = '',
} = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(url, { method, headers, body, signal: controller.signal });
  } catch (err) {
    clearTimeout(timer);
    const why = err?.name === 'AbortError'
      ? `no answer within ${Math.round(timeoutMs / 1000)}s`
      : (err?.cause?.code || err?.code || err?.message || 'the request failed');
    throw new VideoApiError(`cannot reach the video host (${why})`, { provider, path });
  }
  clearTimeout(timer);

  const text = await res.text().catch(() => '');
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { /* not JSON — the caller may want the text */ }
  return { res, status: res.status, text, json: parsed };
}

/**
 * First present value among candidate keys, at the top level or one level down under
 * `data`.
 *
 * No provider's envelope is confirmed (Filemoon's `{data: {...}}` was a guess from its
 * documentation), so look in both rather than betting on one.
 */
export function pick(source, keys) {
  if (!source || typeof source !== 'object') return undefined;
  const layers = [source];
  if (source.data && typeof source.data === 'object') layers.push(source.data);
  if (source.file && typeof source.file === 'object') layers.push(source.file);
  if (Array.isArray(source.data) && source.data[0] && typeof source.data[0] === 'object') {
    layers.push(source.data[0]);
  }
  for (const key of keys) {
    for (const layer of layers) {
      if (layer[key] !== undefined && layer[key] !== null) return layer[key];
    }
  }
  return undefined;
}

/**
 * The KEYS a response actually had — the one thing that turns "the upload failed" into
 * "the field is called `hls_url`, not `playback_url`".
 *
 * `describeDeep` walks two or three levels, because the level that carries the answer is
 * often not the top one: the Filemoon doctor's first run printed `{data}` for a body
 * whose real shape was `{data: {id, title, status, hls_url}}`, and a message that names
 * the wrong keys is a bug in the tool rather than in the code it was reporting on.
 */
export function describeDeep(body, depth = 0) {
  if (body === null || body === undefined) return String(body);
  if (typeof body !== 'object') return JSON.stringify(body)?.slice(0, 160) ?? String(body);
  if (Array.isArray(body)) {
    return `[${body.length && typeof body[0] === 'object' ? describeDeep(body[0], depth + 1) : ''}]`;
  }
  if (depth >= 2) return '{…}';
  const parts = Object.entries(body).slice(0, 12).map(([key, value]) => {
    if (value && typeof value === 'object') return `${key}: ${describeDeep(value, depth + 1)}`;
    return key;
  });
  return `{${parts.join(', ')}}`;
}

/** One level only — enough for an error message that must stay short. */
export function describe(body) {
  if (!body || typeof body !== 'object') return JSON.stringify(body)?.slice(0, 120) ?? String(body);
  return `{${Object.keys(body).slice(0, 8).join(', ')}}`;
}

/** The provider's own words about a failure, wherever they keep them. */
export function errorMessage(body, fallback = 'the request failed') {
  const value = pick(body, ['message', 'error', 'detail', 'reason', 'status', 'errors']);
  if (value === undefined) return fallback;
  if (typeof value === 'string') return value;
  return describeDeep(value);
}

/**
 * Where the bytes play from, and what kind they are.
 *
 * Classification is by EXTENSION, not by field name: a provider that renames `hls_url`,
 * or starts returning a playlist in `url`, must not silently hand a `.m3u8` to a
 * `<video>` element that cannot demux it — the failure mode there is a black rectangle.
 */
export function classifyUrl(url) {
  const value = String(url || '');
  if (!value) return null;
  if (/\.m3u8(\?|#|$)/i.test(value)) return 'hls';
  return 'file';
}

/**
 * Strip a value down to something that can be a key without escaping anything.
 *
 * Keys are built from ids that came from a host, and a key reaches routes from a URL.
 * Anything that is not in this alphabet is dropped rather than encoded, because a key
 * that needs escaping is a key that will be escaped somewhere it is not meant to be.
 */
export const keySafe = (value, { pattern = /[^A-Za-z0-9._-]/g } = {}) => String(value || '').replace(pattern, '');
