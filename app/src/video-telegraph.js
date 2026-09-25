/**
 * Telegra.ph, as a provider behind the registry in `video.js`.
 *
 * ── THE IMAGE HOST, AND THE ONE WITH NO CONTRACT ─────────────────────────────
 *
 * Telegraph is Telegram's publishing site. It has a documented API for pages, and a
 * widely used — but **undocumented** — upload endpoint that returns a permanent direct
 * url for an image:
 *
 *   POST https://telegra.ph/upload        multipart, field `file`
 *     → [{"src":"/file/16016bafcf4eca0ce3e2b.jpg"}]
 *     → {"error":"FILE_TYPE_INVALID"}     when it does not like what it was given
 *
 * Note the host: `telegra.ph/upload`, NOT `api.telegra.ph/upload`. The API host answers
 * the page methods and refuses this one; a client that "helpfully" builds the url from
 * the documented API base gets an error that looks like a refusal of the file.
 *
 * ── WHAT THAT MEANS FOR A STORE'S IMAGES ─────────────────────────────────────
 *
 * 1. **Unofficial and unversioned.** It is not part of the published API, its limits are
 *    folklore rather than documentation (5 MB / 5,242,880 bytes is the number people
 *    measure; jpg, jpeg, png and gif are the types it accepts), and there are reports of
 *    it being switched off — one widely used self-hosted image-hosting project says
 *    Telegram discontinued it in September 2024, while other tools were still using it
 *    successfully long after. Both cannot be true of the whole world, which is exactly
 *    why the doctor PROBES it: `npm run video:check -- --driver=telegraph --upload
 *    <image>` is the only way to know whether it is alive for a given deployment, and
 *    the answer may differ between a laptop in Kathmandu and a server in Frankfurt.
 * 2. **There is no delete.** No endpoint, no key, no account. An image sent here cannot
 *    be recalled — not by us, not by the seller, not by anybody. That is a consequence
 *    for a store that publishes an image and later removes it from its page, so it is
 *    declared as `deletable: false`, `remove()` throws a sentence that says so, and the
 *    delete route reports the delete as unconfirmed rather than claiming it. This is the
 *    §6 rule ("a promise about deletion has to be a call that unlinks the bytes") applied
 *    to a host that cannot make that promise.
 * 3. **No credential, so nothing to configure but the choice itself.** `configured()` is
 *    true when the driver is selected, and images stay on our disk until an operator
 *    writes `IMAGE_DRIVER=telegraph` — because "a host nobody chose" must not be where a
 *    store's pictures end up.
 *
 * The video formats this endpoint also accepts (mp4) are NOT declared: Filemoon is the
 * video host, and a video with no delete is strictly worse than a video with one.
 */
import { VideoApiError, pick, describeDeep, httpCall, keySafe } from './video-shared.js';

export const name = 'telegraph';
export const label = 'Telegra.ph';

/** 5 MB — the limit its own users measure and report; the host does not document it. */
export const MAX_BYTES = 5 * 1024 * 1024;

/** The types it accepts, and the content type to SEND for each. */
export const IMAGE_TYPES = new Map([
  ['image/jpeg', 'jpg'],
  ['image/jpg', 'jpg'],
  ['image/png', 'png'],
  ['image/gif', 'gif'],
]);

/** The extension → the type to declare on the wire. The reverse of the map above. */
const TYPE_OF_EXTENSION = new Map([['jpg', 'image/jpeg'], ['jpeg', 'image/jpeg'], ['png', 'image/png'], ['gif', 'image/gif']]);

/**
 * Would this host take this file?
 *
 * The router asks before sending bytes, because a host's limit must not become the
 * product's limit. A 6 MB photo, an SVG cover, a `.webp` a seller happened to have — all of
 * them are images our own storage serves perfectly well, and all of them would be refused by
 * this endpoint. Where the answer here is `false`, the caller stores the file LOCALLY and the
 * seller's upload still succeeds; the only thing that changed is where the bytes live.
 *
 * (It was a boot failure that made this necessary: the seeder uploads a demo jpg through
 * `storage.put` with no mime type at all, and the first version of this module sent it as
 * `application/octet-stream` — a file the host refused, taking the whole seed with it.)
 */
export function acceptsFile({ mimeType = '', filename = '', size = 0 } = {}) {
  if (size > MAX_BYTES) {
    return { ok: false, why: `${(size / 1024 / 1024).toFixed(1)} MB is over the image host's ${MAX_BYTES / 1024 / 1024} MB cap` };
  }
  const type = String(mimeType || '').toLowerCase().split(';')[0].trim();
  if (IMAGE_TYPES.has(type)) return { ok: true };
  const extension = String(filename || '').split('.').pop().toLowerCase();
  if (TYPE_OF_EXTENSION.has(extension)) return { ok: true, note: 'type taken from the filename' };
  return { ok: false, why: `${type || 'an unknown type'} is not one of jpg, png or gif` };
}

/** What to declare for a file whose mime type the caller did not supply. */
const wireType = (declared, filename) => {
  const type = String(declared || '').toLowerCase().split(';')[0].trim();
  if (IMAGE_TYPES.has(type)) return type === 'image/jpg' ? 'image/jpeg' : type;
  const extension = String(filename || '').split('.').pop().toLowerCase();
  return TYPE_OF_EXTENSION.get(extension) || 'application/octet-stream';
};

export const capabilities = {
  maxBytes: MAX_BYTES,
  hls: false,
  durable: true,
  lists: false,
  needs: 'IMAGE_DRIVER',
  /* No key exists to look for — so the doctor prints that instead of "NOT SET". */
  credential: false,
  note: 'images only, 5 MB per file, permanent direct urls — and no way to delete one',
  kinds: ['image'],
  /*
   * The flag that decides whether a store may use this at all.
   *
   * A host that cannot unlink bytes cannot honour a store removing a file, so this is
   * not a footnote: the doctor prints it, `remove()` refuses instead of pretending, and
   * the only way images go here is an operator choosing it in the environment.
   */
  deletable: false,
  policy: {
    commercial: 'unknown',
    note: 'an UNDOCUMENTED endpoint (not the published Telegraph API), no terms covering '
      + 'file hosting, no delete, and reports of it being switched off — probe it before '
      + 'trusting it, and never for something a store must be able to take back',
  },
};

/** Both urls are static, so the CSP can name them rather than allowing a scheme. */
export const mediaOrigins = (env = process.env) => {
  const origins = new Set();
  for (const value of [fileBase(env), uploadBase(env)]) {
    try { origins.add(new URL(value).origin); } catch { /* a broken override is not an origin */ }
  }
  return [...origins];
};

/**
 * Configured means the driver was chosen.
 *
 * There is no key to look for. `needs: 'IMAGE_DRIVER'` is how this file says that out
 * loud: the credential IS the decision, and `driverForKind` only ever asks a host that
 * an environment variable named.
 */
export const configured = () => true;

/** The name Telegraph gave the file — `<hash>.<ext>`, safe to hold in a key. */
export const idPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

const DEFAULT_UPLOAD = 'https://telegra.ph/upload';
const DEFAULT_FILE_BASE = 'https://telegra.ph';
const trim = (value) => String(value || '').replace(/\/+$/, '');

export const uploadBase = (env = process.env) => trim(env.TELEGRAPH_UPLOAD_BASE || DEFAULT_UPLOAD);
export const fileBase = (env = process.env) => trim(env.TELEGRAPH_FILE_BASE || DEFAULT_FILE_BASE);

/**
 * The url a stored image loads from.
 *
 * The upload's answer is a PATH (`/file/x.jpg`) and the id we keep is its last segment,
 * for the same reason Catbox keeps a name: a key has to survive a round trip through a
 * database column and back into a route. The host is applied at playback time, so a
 * mirror can be pointed at without rewriting every stored key.
 */
export const urlFor = (id, env = process.env) => `${fileBase(env)}/file/${String(id)}`;

/** The last path segment of an answer that looks like a Telegraph file path. */
export function fileIdOf(src) {
  const m = /^\/file\/([A-Za-z0-9][A-Za-z0-9._-]{0,127})$/.exec(String(src || '').trim());
  return m ? m[1] : null;
}

/**
 * Upload one image.
 *
 * The size and the type are both checked HERE, before a byte moves: the host's answer to
 * a 300 MB upload is to accept the bytes and then refuse, which on a mobile connection
 * in Kathmandu is somebody's data allowance spent to learn what this module already knew.
 */
export async function upload(buffer, filename, { mimeType = '', env = process.env } = {}) {
  const size = buffer?.length ?? 0;
  if (size > MAX_BYTES) {
    throw new VideoApiError(
      `this image is ${(size / 1024 / 1024).toFixed(1)} MB and the image host accepts at most `
      + `${MAX_BYTES / 1024 / 1024} MB per file — the upload was refused before sending it`,
      { provider: name, path: '/upload' },
    );
  }
  /*
   * The type is decided the same way the router decides it — from the declared type, or from
   * the filename when there is none — and the SAME answer goes on the wire.
   *
   * That last part is the fix for a real failure: a caller that uploads through
   * `storage.put(bytes, 'photo.jpg')` with no mime type is a normal caller in this codebase
   * (the demo seeder is one), and the first version of this function left the blob's type
   * empty, so the host was told `application/octet-stream` and refused a perfectly good jpg.
   * Deciding the type once and using it for both the check and the wire removes the chance of
   * the two disagreeing.
   */
  const verdict = acceptsFile({ mimeType, filename, size });
  if (!verdict.ok) {
    throw new VideoApiError(
      `the image host takes jpg, png and gif files up to ${MAX_BYTES / 1024 / 1024} MB; ${verdict.why}`,
      { provider: name, path: '/upload' },
    );
  }
  const type = wireType(mimeType, filename);

  const form = new FormData();
  const blob = new Blob([buffer], { type });
  form.append('file', blob, keySafe(filename || `image.${extension}`).slice(0, 120) || `image.${extension}`);

  const { status, text, json } = await httpCall(uploadBase(env), {
    method: 'POST',
    body: form,
    timeoutMs: 60_000,
    provider: name,
    path: '/upload',
  });

  /*
   * The answer is an ARRAY on success and an OBJECT on failure, which is the kind of
   * shape that makes a client guess. It is not guessed here: an array is success, an
   * object is a refusal, and the host's own word (`FILE_TYPE_INVALID`, `FILE_TOO_BIG`)
   * is carried into the sentence rather than replaced by one of ours.
   */
  const first = Array.isArray(json) ? json[0] : null;
  const src = first ? pick(first, ['src', 'url']) : null;
  if (!src) {
    const reason = pick(json, ['error', 'message', 'description']) || text.slice(0, 140) || 'no body';
    throw new VideoApiError(`the image host refused the upload: ${reason} (HTTP ${status})`, {
      status, body: json ?? text, path: '/upload', provider: name,
    });
  }
  const id = fileIdOf(src) || String(src).split('/').pop();
  if (!idPattern.test(id)) {
    throw new VideoApiError(
      `the image host accepted the upload but named no usable file — answer was ${describeDeep(json)}`,
      { body: json, path: '/upload', provider: name },
    );
  }
  return { id, body: json, url: urlFor(id, env) };
}

/** A url and a kind — free, because the upload's answer already had both. */
export async function playback(id, { env = process.env } = {}) {
  const fileId = String(id || '');
  if (!idPattern.test(fileId)) {
    throw new VideoApiError(`the stored image name is not usable as a url: ${fileId.slice(0, 80)}`, {
      provider: name, path: '/upload',
    });
  }
  return { kind: 'file', url: urlFor(fileId, env), id: fileId };
}

/**
 * There is no delete, and this is where that becomes a sentence instead of a silence.
 *
 * Returning `true` would be the easy lie — the local file route would remove its row and
 * the product would report a clean deletion while the image stayed readable at a public
 * url forever. Throwing is what makes the delete route report it as unconfirmed, which
 * is the honest outcome for bytes this side of the internet cannot reach.
 */
export async function remove(id) {
  throw new VideoApiError(
    `the image host has no delete endpoint, so "${String(id).slice(0, 60)}" cannot be recalled — `
    + 'the file stays public at its url and this delete is reported as unconfirmed',
    { provider: name, path: '/upload' },
  );
}

/**
 * What the doctor can ask a host with no account and no API.
 *
 * The honest answer is "nothing" — and the probe that matters (does `/upload` still
 * exist?) is the real upload the doctor does with `--upload`.
 */
export async function account() {
  return { id: null, email: null, tier: 'no account', raw: null };
}
