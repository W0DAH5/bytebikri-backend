/**
 * Catbox, as a provider behind the registry in `video.js`.
 *
 * ── THE HOST THAT BREAKS EVERY ASSUMPTION THE OTHERS SHARE ───────────────────
 *
 * Catbox is one endpoint with a `reqtype` field, and it answers in **plain text**:
 *
 *   POST https://catbox.moe/user/api.php   multipart
 *     reqtype=fileupload   userhash=<the account>   fileToUpload=<the bytes>
 *   →  https://files.catbox.moe/abc123.mp4          (the whole body; there is no JSON)
 *
 *   POST https://catbox.moe/user/api.php
 *     reqtype=deletefiles  userhash=<the account>   files=<name>
 *
 * Everything else follows from that one difference:
 *
 *   * **There is no id — the upload's return value IS the url**, and the file's name is
 *     the id: it is what the delete call takes and what the url ends with. So our key is
 *     `catbox/<name>` and playback needs no host call at all, which also means the
 *     render-time `data-hls` decision costs nothing for a Catbox file.
 *   * **A failed upload is a sentence, not a status.** The reply is checked for being a
 *     url; anything else is the host's own words, carried into `VideoApiError` unchanged.
 *   * **200 MB per file is a hard cap**, and it is refused LOCALLY before the request.
 *     The alternative is spending a seller's mobile data in Kathmandu to be told
 *     something this module already knew.
 *   * **No playlists**: a Catbox url is one progressive file, so `hls: false` — the
 *     player will not be told to load a demuxer for these bytes.
 *
 * The `userhash` is a full-access credential (it uploads and deletes for the whole
 * account), so it lives beside the other hosts' tokens in `app/.env` and never in a
 * tracked file — the same rule as `FILEMOON_TOKEN` and `GOFILE_TOKEN`.
 */
import { VideoApiError } from './video-shared.js';

export const name = 'catbox';
export const label = 'Catbox';

/** 200 MB, per the host's own limit; the product's own cap is far below it. */
export const MAX_BYTES = 200 * 1024 * 1024;

export const capabilities = {
  maxBytes: MAX_BYTES,
  hls: false,
  durable: true,
  lists: false,
  needs: 'CATBOX_USERHASH',
  note: 'permanent, direct progressive urls; 200 MB per file; no listings, no playlists',
};

/** Configured means the credential this host needs is present. */
export const configured = (env = process.env) => Boolean(env.CATBOX_USERHASH);

const DEFAULT_BASE = 'https://catbox.moe';
export const base = (env = process.env) =>
  String(env.CATBOX_API_BASE || DEFAULT_BASE).replace(/\/+$/, '');

/**
 * Where the files are served from — configuration, like the API base, and NOT part of a
 * file's identity.
 *
 * The key holds the file's NAME and nothing else, so the url is rebuilt from this origin
 * whenever it is needed. That keeps two things true at once: a stored key survives the
 * origin changing (a CDN move, or a mirror stood up in front of it), and a test or a
 * staging deployment can point playback at a stub instead of at the public internet.
 */
const DEFAULT_FILE_BASE = 'https://files.catbox.moe';
export const fileBase = (env = process.env) =>
  String(env.CATBOX_FILE_BASE || DEFAULT_FILE_BASE).replace(/\/+$/, '');

/**
 * The one of our keys that is also a url.
 *
 * The host returns the whole url; what we store has to survive a round trip through a
 * database column and back into a route, so the name is taken from the url's last path
 * segment and nothing else. A name that is not safe to put in a key is not a name we
 * accept — the same allowlist rule the other providers' ids go through.
 */
export function fileNameOf(url) {
  const value = String(url || '').trim();
  const m = /^https?:\/\/[^/]+\/([A-Za-z0-9._-]{1,128})$/.exec(value);
  return m ? m[1] : null;
}

/** The provider's id pattern, for the registry's key check. */
export const idPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/**
 * The origin a page has to be allowed to load this host's media from.
 *
 * A provider that knows where its bytes live can say so, and the CSP in `server.js` names
 * it rather than widening the policy for everyone. Filemoon and GoFile cannot answer this
 * statically — their media urls come back from the API on a host nobody publishes — which
 * is why the policy allows `https:` for MEDIA specifically and why the doctor prints the
 * origin it observed for the operator to add to `VIDEO_MEDIA_ORIGINS` when a playlist has
 * to be fetched by script rather than by the element.
 */
export const mediaOrigins = (env = process.env) => {
  try { return [new URL(fileBase(env)).origin]; } catch { return []; }
};

/** The url a name plays from — no call, no token, no expiry. */
export const urlFor = (id, env = process.env) => `${fileBase(env)}/${id}`;

async function api(fields, { env = process.env, timeoutMs = 120_000 } = {}) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined && value !== null) form.append(key, value);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(`${base(env)}/user/api.php`, { method: 'POST', body: form, signal: controller.signal });
  } catch (err) {
    clearTimeout(timer);
    const why = err?.name === 'AbortError' ? `no answer within ${Math.round(timeoutMs / 1000)}s` : (err?.cause?.code || err?.message);
    throw new VideoApiError(`cannot reach the video host (${why})`, { provider: name, path: '/user/api.php' });
  }
  clearTimeout(timer);
  const text = (await res.text().catch(() => '')).trim();
  if (res.status < 200 || res.status >= 300) {
    throw new VideoApiError(`the video host answered ${res.status}: ${text.slice(0, 140) || 'no body'}`, {
      status: res.status, body: text, path: '/user/api.php', provider: name,
    });
  }
  return text;
}

/**
 * Upload bytes.
 *
 * The size check comes before the FormData is built, so a refusal costs a function call
 * rather than a 200 MB upload. `mimeType` and `filename` are part of the interface every
 * provider shares; Catbox reads neither, and passing them anyway would be this module
 * inventing fields a host ignores.
 */
export async function upload(buffer, filename, { env = process.env } = {}) {
  const size = buffer?.length ?? 0;
  if (size > MAX_BYTES) {
    throw new VideoApiError(
      `this file is ${(size / 1024 / 1024).toFixed(1)} MB and the video host accepts at most `
      + `${MAX_BYTES / 1024 / 1024} MB per file — the upload was refused before sending it`,
      { provider: name, path: '/user/api.php' },
    );
  }
  const text = await api({
    reqtype: 'fileupload',
    userhash: env.CATBOX_USERHASH,
    fileToUpload: new Blob([buffer], { type: 'application/octet-stream' }),
  }, { env });

  const fileName = fileNameOf(text);
  if (!fileName) {
    // The host's answer was not a url, so it was an explanation. Carry its words.
    throw new VideoApiError(`the video host refused the upload: ${text.slice(0, 160) || 'no body'}`, {
      body: text, path: '/user/api.php', provider: name,
    });
  }
  void filename;
  return { id: fileName, body: text };
}

/** A url and a kind — free, because the name is the id. */
export async function playback(id, { env = process.env } = {}) {
  const fileName = String(id || '');
  if (!idPattern.test(fileName)) {
    throw new VideoApiError(`the stored file name is not usable as a url: ${fileName.slice(0, 80)}`, {
      provider: name, path: '/user/api.php',
    });
  }
  const url = urlFor(fileName, env);
  return { kind: 'file', url, id: fileName };
}

/**
 * Delete, and say whether the host agreed.
 *
 * The response is a sentence — the host answers with something like "success" — so a
 * delete cannot be confirmed by a status code alone. Anything but success propagates:
 * the alternative is our side believing a file is gone while it is still downloadable.
 */
export async function remove(id, { env = process.env } = {}) {
  const text = await api({ reqtype: 'deletefiles', userhash: env.CATBOX_USERHASH, files: String(id) }, { env });
  if (/^success/i.test(text) || text === '') return true;
  throw new VideoApiError(`the video host refused the delete: ${text.slice(0, 160)}`, {
    body: text, path: '/user/api.php', provider: name,
  });
}

/**
 * What the doctor can ask this host.
 *
 * There is no account endpoint and no listing: a `userhash` is not an identity, it is a
 * key that uploads and deletes. So the honest check is a real one — upload one small
 * file and delete it again — which is what the doctor does with `--upload` for every
 * provider anyway.
 */
export async function account() {
  return { id: null, email: null, tier: configured() ? 'userhash' : 'unconfigured', raw: null };
}
