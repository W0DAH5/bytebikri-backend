/**
 * The video hosts, behind one interface: the registry.
 *
 * Three providers are configured for the same seam — Filemoon, GoFile and Catbox — and
 * `VIDEO_STORAGE.md` §10.1 records what each can and cannot do. This module is what the
 * rest of the app talks to, and it owns exactly four things:
 *
 *   1. **Which driver is configured** (`VIDEO_DRIVER`), and whether it is usable at all.
 *   2. **The keys.** `filemoon/<id>`, `gofile/<uuid>`, `catbox/<name>.mp4`. The provider is
 *      part of the key, so a store's file keeps playing from wherever it was uploaded
 *      even after `VIDEO_DRIVER` changes on a later deploy — and a delete goes to the host
 *      holding the bytes rather than to whatever is configured today. A key is a promise
 *      about where the bytes are.
 *   3. **Dispatch.** `upload`, `file`, `playback`, `remove`, `account` take a `provider`
 *      (defaulting to the configured driver) and call the provider module that owns it.
 *   4. **The playback cache**, which must be per provider and per id — the same id at two
 *      hosts is two different answers.
 *
 * Nothing above this file learns a host's field names, urls or error words. `store.js`
 * routes by key prefix, `server.js` redirects by key prefix, and the player's `data-hls`
 * decision comes from `playback()` — none of them can tell which provider answered.
 *
 * ── WRITTEN WITHOUT EVER HAVING CALLED ONE ───────────────────────────────────
 *
 * This environment refuses egress to all three hosts (TLS reset or a bare refusal;
 * `api.github.com` answers, so it is an allowlist rather than a broken network). Every
 * client here has therefore only met its own stub. That is why the shapes are read
 * defensively, why a wrong guess is a legible error rather than a mystery, and why
 * `npm run video:check` exists for the machine that CAN reach them.
 */
import * as filemoon from './video-filemoon.js';
import * as gofile from './video-gofile.js';
import * as catbox from './video-catbox.js';
import { VideoApiError } from './video-shared.js';

export {
  VideoApiError, pick, describe, describeDeep, errorMessage, classifyUrl, keySafe, httpCall,
} from './video-shared.js';

/**
 * Every provider, by the name that appears in front of a key.
 *
 * The order is the order the doctor prints, and it is deliberately not alphabetical:
 * Filemoon is what the product deploys with, and the others are alternatives with a
 * caveat each.
 */
export const PROVIDERS = { filemoon, gofile, catbox };
export const HOSTS = Object.keys(PROVIDERS);

const isHost = (value) => Object.prototype.hasOwnProperty.call(PROVIDERS, value);

/**
 * The configured driver, or 'local'.
 *
 * An unknown name is 'local' rather than an error: a typo in an environment file must
 * leave the product working exactly as it did before the video host existed, and the
 * doctor is where a wrong name gets said out loud. There is no third behaviour where a
 * misspelling sends somebody's video somewhere unexpected.
 */
export function videoDriver(env = process.env) {
  const value = String(env.VIDEO_DRIVER || 'local').trim().toLowerCase();
  return isHost(value) ? value : 'local';
}

/** Is the configured provider usable — that is, does it have the credential it needs? */
export const configured = (driver, env = process.env) =>
  isHost(driver) && PROVIDERS[driver].configured(env);

export const videoHostEnabled = (env = process.env) => configured(videoDriver(env), env);

/** The api base of the configured provider, for the messages and the doctor. */
export const videoHostBase = (env = process.env) => {
  const driver = videoDriver(env);
  return isHost(driver) ? PROVIDERS[driver].base(env) : null;
};

/**
 * Every provider's facts, for the doctor and for anything that has to explain a choice.
 *
 * A function rather than a frozen table so that the note can carry the ONE thing that
 * changes per account (GoFile's tier) without every caller re-deriving it.
 */
export function hostFacts(env = process.env) {
  return HOSTS.map((host) => ({
    host,
    label: PROVIDERS[host].label,
    configured: PROVIDERS[host].configured(env),
    ...PROVIDERS[host].capabilities,
  }));
}

/**
 * Which kinds of media a host is FOR — asked before bytes ever move.
 *
 * The first version of this registry had one question in it ("is the driver set?") and
 * three providers, which quietly implied they were three ways of doing the same job.
 * They are not, and `VIDEO_STORAGE.md` §10.5 records what each is actually designed for:
 * Filemoon is a video host whose non-video uploads are download-only; GoFile is a
 * generalist whose playable links are Premium; Catbox is a small-file host whose own
 * terms forbid being a service's CDN. So a kind a host does not declare stays on our
 * disk, and the answer is data rather than a coincidence of one boolean.
 *
 * `mediaKind` lives in `media.js` (video/audio/image/archive/document/…) and is imported
 * by `store.js` already; this takes the kind it returns rather than re-deriving it, so
 * one definition of "what is this file" serves the router, the doctor and the tests.
 */
export function hostAccepts(kind, provider, env = process.env) {
  const host = isHost(provider) ? provider : videoDriver(env);
  if (!isHost(host)) return false;
  const caps = PROVIDERS[host].capabilities || {};
  return Array.isArray(caps.kinds) && caps.kinds.includes(kind);
}

/** Whether this deployment may send a store's bytes to a host at all (policy, §10.5). */
export function hostSuitability(provider, env = process.env) {
  const host = isHost(provider) ? provider : videoDriver(env);
  if (!isHost(host)) return { host, commercial: 'local', note: 'nothing is configured, so nothing leaves' };
  return { host, ...(PROVIDERS[host].capabilities?.policy || { commercial: 'unknown' }) };
}

/**
 * The credential a host needs, in the operator's words.
 *
 * `capabilities.needs` names the environment variable; this turns that into the sentence
 * a refusal uses, so the message and the check cannot drift apart.
 */
const neededFor = (host) => PROVIDERS[host]?.capabilities?.needs || 'a credential';

/**
 * The origins a page must be allowed to load MEDIA from, and to fetch a playlist from.
 *
 * Two lists in the CSP need this and they are not the same list:
 *
 *   * `media-src` covers the element's own load — a progressive file at a CDN, where a
 *     redirect hands the browser a url on somebody else's origin;
 *   * `connect-src` covers hls.js, which fetches playlists and segments with XHR. That
 *     directive is the one an attacker would use to post a session somewhere, so it is
 *     NOT widened to `https:`: it names origins, and a deployment whose provider serves
 *     playlists from a host we cannot know in advance adds it here.
 *
 * `VIDEO_MEDIA_ORIGINS` (comma or space separated) is how an operator adds one, and the
 * doctor prints the exact origin it observed so that this is a copy-paste rather than a
 * guess.
 */
export function mediaOrigins(env = process.env) {
  const declared = HOSTS.flatMap((host) => (PROVIDERS[host].configured(env) ? PROVIDERS[host].mediaOrigins(env) : []));
  const fromEnv = String(env.VIDEO_MEDIA_ORIGINS || '').split(/[,\s]+/).filter(Boolean);
  return [...new Set([...declared, ...fromEnv])];
}

// ─── keys ────────────────────────────────────────────────────────────────────

/**
 * Our key for a file that lives at a host.
 *
 * The id is filtered to the provider's own alphabet before it becomes part of a key. A
 * key reaches routes from a URL, so an id containing a slash, a dot-dot or a query would
 * be a second path or a second host — and the filter is an allowlist per provider rather
 * than a scan for '..', because a scan misses encodings.
 */
export function remoteKey(id, provider = videoDriver()) {
  const host = isHost(provider) ? provider : null;
  if (!host) throw new VideoApiError(`unknown video host: ${provider}`, { provider: String(provider) });
  const cleaned = String(id ?? '').replace(/[^A-Za-z0-9._-]/g, '');
  if (!PROVIDERS[host].idPattern.test(cleaned)) {
    throw new VideoApiError(`the ${host} id is not usable as a key: ${String(id).slice(0, 80)}`, { provider: host });
  }
  return `${host}/${cleaned}`;
}

/** Which provider a key belongs to, or null for anything that is not a remote key. */
export function remoteProvider(key) {
  const value = String(key || '');
  const slash = value.indexOf('/');
  if (slash <= 0) return null;
  const host = value.slice(0, slash);
  if (!isHost(host)) return null;
  return PROVIDERS[host].idPattern.test(value.slice(slash + 1)) ? host : null;
}

/** Is this key one of ours-to-disk, or one of theirs? */
export const isRemoteKey = (key) => remoteProvider(key) !== null;

/** The provider's id inside a remote key, or null. */
export function remoteId(key) {
  const host = remoteProvider(key);
  return host ? String(key).slice(host.length + 1) : null;
}

/** The provider module for a key or a name, or the configured one. */
function providerFor(provider) {
  const host = provider || videoDriver();
  if (!isHost(host)) {
    throw new VideoApiError(
      `no video host is configured (VIDEO_DRIVER is "${String(provider || 'local')}")`,
      { provider: String(provider) },
    );
  }
  return PROVIDERS[host];
}

// ─── dispatch ────────────────────────────────────────────────────────────────

/**
 * Send bytes to a host and bring back its key.
 *
 * The key is the registry's to build, not the provider's: this is the one place that
 * knows a key begins with the provider's name, and a provider that built its own keys
 * could get that wrong in a way only the router would notice.
 */
export async function upload(buffer, filename, { mimeType = 'application/octet-stream', env = process.env, provider } = {}) {
  const host = provider || videoDriver(env);
  const mod = providerFor(host);
  if (!mod.configured(env)) {
    throw new VideoApiError(
      `the video host is not configured (${neededFor(host)} is unset)`,
      { provider: host },
    );
  }
  const { id, body } = await mod.upload(buffer, filename, { mimeType, env });
  return { id, key: remoteKey(id, host), body };
}

/** One file's record, in the shape the doctor prints and `playbackOf` reads. */
export async function file(id, { env = process.env, provider } = {}) {
  const mod = providerFor(provider);
  if (typeof mod.file !== 'function') {
    // Catbox has no metadata endpoint: the name is the whole record. Saying so is better
    // than a TypeError, and better than pretending the answer is an empty object.
    throw new VideoApiError(`the ${mod.name} host does not serve file metadata`, { provider: mod.name });
  }
  return mod.file(id, { env });
}

/** Where the bytes play from, and what kind they are. */
export async function playback(id, options = {}) {
  const mod = providerFor(options.provider);
  const found = await mod.playback(id, options);
  return { ...found, provider: mod.name };
}

/** The file record plus the classification — Filemoon's split, kept for the doctor. */
export function playbackOf(record) {
  return filemoon.playbackOf(record);
}

/**
 * The same call, remembered for a minute.
 *
 * The asset page needs to know WHICH KIND of source a remote file has before it renders,
 * because the player has to choose a demuxer before it has a URL — a `<video>` pointed at
 * a playlist renders a black rectangle in the browser most people use. That is one host
 * call per page view of a hosted file, which is a cost this product should not pay for a
 * value that changes only when the host reprocesses a file.
 *
 * Sixty seconds, bounded to 200 entries, and keyed by PROVIDER AND ID: the same id at two
 * hosts is two different answers, and a cache that confused them would put a Catbox name
 * in front of Filemoon's answer.
 */
const PLAYBACK_TTL_MS = 60_000;
const PLAYBACK_CACHE_MAX = 200;
const playbackCache = new Map();

export function clearPlaybackCache() { playbackCache.clear(); }

export async function playbackCached(id, { now = Date.now(), env = process.env, provider } = {}) {
  const host = provider || videoDriver(env);
  const cacheKey = `${host}/${id}`;
  const hit = playbackCache.get(cacheKey);
  if (hit && now - hit.at < PLAYBACK_TTL_MS) return hit.value;
  const value = await playback(id, { env, provider: host });
  if (playbackCache.size >= PLAYBACK_CACHE_MAX) playbackCache.delete(playbackCache.keys().next().value);
  playbackCache.set(cacheKey, { at: now, value });
  return value;
}

/**
 * Destroy a file at the host that holds it.
 *
 * A 404 is a `true` — the file is not there, which is what the caller asked for — and a
 * real failure propagates, because the local adapter's `false` means "there was nothing
 * to delete" and a host failure means "it is still there and we could not destroy it".
 * Only the first of those is compatible with a promise about deletion.
 */
export async function remove(id, { env = process.env, provider } = {}) {
  return providerFor(provider).remove(id, { env });
}

/** Who the credential belongs to, which for one host answers whether it can deliver at all. */
export async function account({ env = process.env, provider, ...rest } = {}) {
  return providerFor(provider).account({ env, ...rest });
}

/** Forget the cached identity — the doctor asks fresh, and so does a test. */
export function forgetAccount() {
  if (typeof gofile.forgetAccount === 'function') gofile.forgetAccount();
}

/**
 * Filemoon's extras — remote uploads, listings, processing status.
 *
 * Re-exported rather than hidden: the doctor and the seeder use them, and they are the
 * only host-specific surface this product has. They are namespaced under `filemoon` so
 * that nothing can mistake them for part of the shared interface.
 */
export { filemoon };

/** The fake of one provider, for tests that want to assert on their requests. */
export const providers = PROVIDERS;
