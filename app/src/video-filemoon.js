/**
 * Filemoon, as one provider behind the registry in `video.js`.
 *
 * `store.js`'s storage adapter has said "replace with the media API later" since
 * the beginning. This was that API and is now the first of three: this module knows
 * this host's shape — endpoints, headers, error bodies and the field a playback url
 * comes back in — and nothing above it knows any of that. The other hosts sit beside
 * this file and share `video-shared.js` with it.
 */

import {
  VideoApiError, pick, describe, describeDeep, errorMessage, classifyUrl, httpCall,
} from './video-shared.js';

export const name = 'filemoon';
export const label = 'Filemoon';

/**
 * What this host can and cannot do, as data rather than as prose.
 *
 * The doctor prints it, refusal messages are built from it, and the table in
 * `VIDEO_STORAGE.md` §10.1 is the same list written out. `maxBytes: null` means the
 * provider publishes no cap of its own; the app's own upload limit binds first.
 */
export const capabilities = {
  maxBytes: null,
  hls: true,
  durable: true,
  lists: true,
  needs: 'FILEMOON_TOKEN',
  note: 'plays playlists or progressive files; the token is <id>|<secret>',
  /*
   * WHAT THIS HOST IS FOR (VIDEO_STORAGE.md §10.5, researched rather than assumed).
   *
   * Filemoon is a video host and says so in its own words: twelve video formats
   * (MP4, MKV, AVI, WEBM, MOV, FLV, WMV, 3GP, TS, MPG, MPEG, VOB), every upload
   * encoded for streaming, HLS delivery, a subtitle manager, posters, an embeddable
   * player, remote and FTP intake. Its marketing does mention taking "documents,
   * images, audio and large files" — and then says what happens to them: "stream
   * supported videos online **or download allowed files**". Non-video is a download
   * there, not a preview.
   *
   * So `kinds` is one entry long, and that is not a limitation we are working around:
   * sending an image or an audio file here would mean giving up the inline playback
   * this product's own surfaces are built on, in exchange for nothing.
   */
  kinds: ['video'],
  policy: {
    commercial: 'allowed',
    note: 'a streaming host for websites; no CDN clause against the use this product makes of it',
  },
};

/**
 * Nothing to declare: this host's media urls come back from the API on an origin that is
 * not published anywhere (see the note in `video-catbox.js`), so the deployment either
 * names it in `VIDEO_MEDIA_ORIGINS` or relies on the policy's `https:` allowance for
 * media. The doctor prints the origin it actually observed.
 */
export const mediaOrigins = () => [];

/** Configured means the credential this host needs is present. */
/**
 * Would this host take this file? Whatever its kind check says.
 *
 * Filemoon has no published per-file cap to test here, and the kind question is answered by
 * `capabilities.kinds` before this is ever asked; so the file-level answer is yes, and the
 * router's fallback-to-local path therefore never triggers for a video. Stated explicitly so
 * that every provider answers the same question in the same shape.
 */
export const acceptsFile = () => ({ ok: true });

export const configured = (env = process.env) => Boolean(env.FILEMOON_TOKEN);

const DEFAULT_BASE = 'https://filemoon.org/api/v1';
export const base = (env = process.env) =>
  String(env.FILEMOON_API_BASE || DEFAULT_BASE).replace(/\/+$/, '');

/**
 * One authenticated call to this host.
 *
 * Every path in this module goes through here, which is what makes a wrong guess cheap:
 * when a path or a header turns out to be wrong it is wrong in one place, and
 * `describeDeep()` shows the evidence.
 */
async function request(path, { method = 'GET', body, headers = {}, env = process.env, timeoutMs = 30_000 } = {}) {
  const token = env.FILEMOON_TOKEN;
  if (!token) {
    throw new VideoApiError('the video host is not configured (FILEMOON_TOKEN is unset)', { path, provider: name });
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
  return json ?? (text || null);
}

/** The provider's id for a file, however it names it. */
/**
 * This provider's id alphabet, for the registry's key check.
 *
 * An allowlist, so an id that arrives from a host (or from a caller who copied one out of
 * a database) cannot carry a slash, a query or a dot-dot into a key — and therefore
 * cannot become a second path, a second host or a filesystem escape once a route puts it
 * back together.
 */
export const idPattern = /^[A-Za-z0-9_-]{1,64}$/;

export const fileIdOf = (body) => {
  const id = pick(body, ['id', 'file_id', 'fileId', 'code', 'file_code', 'hash']);
  return id === undefined ? undefined : String(id);
};

/**
 * Upload bytes.
 *
 * `visibility: 1` is what the documented example sends. What it MEANS is not
 * confirmed, and the safe reading is the one we can defend either way: nothing
 * about a store's file should be discoverable at the provider, because the door
 * is here. If it turns out that `1` means "listed", that is a one-character fix
 * found by the doctor's own shape dump — and it is why the value is a named
 * constant rather than a literal buried in a multipart body.
 */
export const UPLOAD_VISIBILITY = '1';

export async function upload(buffer, filename, { mimeType = 'application/octet-stream', env = process.env } = {}) {
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: mimeType }), filename || 'video.mp4');
  form.append('visibility', UPLOAD_VISIBILITY);
  // No content-type header: `fetch` sets it, boundary and all. Setting it by hand
  // is the classic way a multipart upload arrives as one unparseable field.
  const body = await request('/files/upload', { method: 'POST', body: form, env });
  const id = fileIdOf(body);
  if (!id) {
    throw new VideoApiError(
      `the upload succeeded but no file id came back — response was ${describeDeep(body)}`,
      { body, path: '/files/upload' },
    );
  }
  // The KEY is the registry's business now: it prefixes the provider this file landed
  // on, and this module is not the one that knows what providers exist.
  return { id, body };
}

/** Who the token belongs to — the doctor's first question, and cheap. */
export const account = (options = {}) => request('/account', options);

/**
 * One file.
 *
 * `frames` is deliberately absent from the return: a listing carries many fields
 * per file and this module reads only the four the product uses, so a provider
 * that adds fields cannot change our behaviour by adding them.
 */
export async function file(id, { env = process.env } = {}) {
  const body = await request(`/files/${encodeURIComponent(id)}`, { env });
  return {
    id: String(id),
    title: pick(body, ['title', 'name', 'filename']) ?? null,
    status: String(pick(body, ['status', 'state', 'processing_status']) ?? '').toLowerCase() || null,
    sizeBytes: Number(pick(body, ['size', 'size_bytes', 'bytes', 'filesize'])) || null,
    durationSec: Number(pick(body, ['duration', 'duration_sec', 'length'])) || null,
    urls: {
      playback: pick(body, ['playback_url', 'playbackUrl', 'url', 'file_url', 'stream_url', 'link', 'download_url', 'direct_url']) ?? null,
      hls: pick(body, ['hls_url', 'hls', 'm3u8', 'playlist_url', 'master_url']) ?? null,
      download: pick(body, ['download_url', 'dl_url', 'direct_url']) ?? null,
    },
    raw: body,
  };
}

export const status = (id, options = {}) => request(`/files/${encodeURIComponent(id)}/status`, options);

export const updateFile = (id, patch, options = {}) => request(`/files/${encodeURIComponent(id)}`, {
  ...options, method: 'PATCH', headers: { 'content-type': 'application/json', ...(options.headers || {}) },
  body: JSON.stringify(patch),
});

/**
 * Delete, and say whether the provider agreed.
 *
 * A 404 is a `true`: the file is not there, which is the outcome the caller asked
 * for and the same reading the local adapter takes of a missing file. Anything
 * else is a `false` with the reason logged by the caller — because the one thing
 * that must never happen is our side claiming a delete the host did not perform.
 */
export async function remove(id, { env = process.env } = {}) {
  try {
    await request(`/files/${encodeURIComponent(id)}`, { method: 'DELETE', env });
    return true;
  } catch (err) {
    if (err instanceof VideoApiError && err.status === 404) return true;
    throw err;
  }
}

export function playbackOf(record) {
  const url = record.urls?.hls || record.urls?.playback || record.urls?.download;
  if (!url) {
    throw new VideoApiError(
      `no playback url in the response — the body was ${describeDeep(record.raw)}; one of `
      + 'playback_url, url, hls_url or download_url belongs in `playbackOf`',
      { body: record.raw, path: `/files/${record.id}` },
    );
  }
  return { kind: classifyUrl(url), url, id: record.id };
}

/** Fetch + classify in one call — what a route needs, and nothing more. */
export async function playback(id, options = {}) {
  return playbackOf(await file(id, options));
}

/** The provider fetches a URL itself. Kept for the seeder and for large backfills. */
export const remoteUpload = (urls, options = {}) => request('/remote-uploads', {
  ...options,
  method: 'POST',
  headers: { 'content-type': 'application/json', ...(options.headers || {}) },
  body: JSON.stringify({ urls: [].concat(urls) }),
});

export const remoteUploads = (options = {}) => request('/remote-uploads', options);

export const cancelRemoteUpload = (id, options = {}) =>
  request(`/remote-uploads/${encodeURIComponent(id)}/cancel`, { ...options, method: 'POST' });

export const retryRemoteUpload = (id, options = {}) =>
  request(`/remote-uploads/${encodeURIComponent(id)}/retry`, { ...options, method: 'POST' });

export const listFiles = (options = {}) => request('/files', options);
