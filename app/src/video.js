/**
 * The video hosts, behind one interface: the registry.
 *
 * Four providers are configured for the same seam — Filemoon, Pixeldrain, Telegra.ph and
 * Catbox — and `VIDEO_STORAGE.md` §10 records what each can and cannot do. This module is
 * what the rest of the app talks to, and it owns exactly five things:
 *
 *   1. **Which driver takes which KIND of media** (`VIDEO_DRIVER`, `IMAGE_DRIVER`,
 *      `FILE_DRIVER` — §10.6), and whether it is usable at all.
 *   2. **The keys.** `filemoon/<id>`, `pixeldrain/<id>`, `telegraph/<name>.jpg`,
 *      `catbox/<name>.mp4`. The provider is
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
import * as antmedia from './video-antmedia.js';
import * as pixeldrain from './video-pixeldrain.js';
import * as telegraph from './video-telegraph.js';
import * as catbox from './video-catbox.js';
import { VideoApiError } from './video-shared.js';

export {
  VideoApiError, pick, describe, describeDeep, errorMessage, classifyUrl, keySafe, httpCall,
} from './video-shared.js';

/**
 * Every provider, by the name that appears in front of a key.
 *
 * The order is the order the doctor prints, and it reads as the ROUTING TABLE now that a
 * host is chosen per KIND of media (§10.6):
 *
 *   filemoon    video       the video host, and the one this product deploys with
 *   antmedia    —           THE LIVE HOST: Ant Media Server on a machine we run, RTMP in and
 *                           HLS out, so the audience stops setting the bill (§12). It declares
 *                           NO kind, so no file can ever be routed to a stream engine, and it
 *                           is chosen by LIVE_DRIVER — its own variable, because "who runs the
 *                           stream" was never the same question as "where the bytes live"
 *   pixeldrain  the rest    a general file host: direct urls, byte ranges, a real delete
 *   telegraph   images      small, permanent, free — and it can never delete one
 *   catbox      development only: its terms forbid being a service's CDN
 *
 * GoFile is gone: a free account could not produce a playable link at all, and paying for
 * one to serve files this product keeps on its own disk bought nothing.
 */
export const PROVIDERS = { filemoon, antmedia, pixeldrain, telegraph, catbox };
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

/**
 * The environment variable that chooses a host for each KIND of media.
 *
 * One driver was enough while there was one host. There are four now and they are not
 * interchangeable (§10.5), so the choice is per kind — and every one of them is unset by
 * default, which is what keeps "no configuration means every byte on our disk" true for a
 * fresh clone, for the demo, and for every deployment that never wanted a host.
 *
 *   VIDEO_DRIVER   video     filemoon (or pixeldrain, for a store with no video host)
 *   IMAGE_DRIVER   image     telegraph (or pixeldrain)
 *   FILE_DRIVER    the rest  pixeldrain — audio, archives, documents, and video too
 */
export const DRIVER_VARS = { video: 'VIDEO_DRIVER', image: 'IMAGE_DRIVER', file: 'FILE_DRIVER' };

const driverFrom = (env, variable) => {
  const value = String((env || {})[variable] || '').trim().toLowerCase();
  return isHost(value) ? value : 'local';
};

/**
 * Which host takes this KIND of media — or 'local'.
 *
 * The order is specific-then-general: an image prefers `IMAGE_DRIVER` and falls back to a
 * general `FILE_DRIVER`, so a deployment that configures one host for everything gets
 * that one host for everything it accepts. A kind no configured host declares stays on
 * our disk, which is the same rule the router used when there was only one host.
 *
 * The `configured` and `hostAccepts` checks are not belt-and-braces. They are what stops
 * `IMAGE_DRIVER=telegraph` from being handed a video (no delete, and video has a host),
 * and what keeps a driver whose credential is missing from being used at all.
 */
export function driverForKind(kind, env = process.env, file = null) {
  const key = kind === 'video' ? 'video' : (kind === 'image' ? 'image' : 'file');
  const candidates = key === 'file' ? ['FILE_DRIVER'] : [DRIVER_VARS[key], 'FILE_DRIVER'];
  for (const variable of candidates) {
    const driver = driverFrom(env, variable);
    if (driver === 'local') continue;
    if (!configured(driver, env)) continue;
    if (!hostAccepts(kind, driver, env)) continue;
    /*
     * THE FILE ITSELF, not just its kind.
     *
     * A host can be right for a kind and still refuse a particular file — Telegra.ph's 5 MB
     * cap and four formats, Catbox's 200 MB and its blocked extensions. Asking only about the
     * kind would send those files anyway, the host would refuse them AFTER the bytes crossed
     * the wire, and a seller's upload would fail because a host they never chose has a rule
     * they never saw. With `file` in hand the router moves on to the next candidate — usually
     * no candidate, which means `local`, which always works.
     */
    if (file && typeof PROVIDERS[driver].acceptsFile === 'function') {
      const verdict = PROVIDERS[driver].acceptsFile(file);
      if (!verdict.ok) continue;
    }
    return driver;
  }
  return 'local';
}

/**
 * Why a kind is NOT going to a host, in words a seller could act on.
 *
 * `driverForKind` returning `local` is the right behaviour and a terrible explanation: it
 * means either "no host is configured", "the host is for other kinds", or "this particular
 * file is too big for it", and those are three different things to tell whoever is looking at
 * an upload that stayed on the disk. This is the sentence for the third case.
 */
export function whyLocal(kind, env = process.env, file = null) {
  if (!hostsEnabled(env)) return null;
  const key = kind === 'video' ? 'video' : (kind === 'image' ? 'image' : 'file');
  const candidates = key === 'file' ? ['FILE_DRIVER'] : [DRIVER_VARS[key], 'FILE_DRIVER'];
  const reasons = [];
  for (const variable of candidates) {
    const driver = driverFrom(env, variable);
    if (driver === 'local') continue;
    if (!configured(driver, env)) { reasons.push(`${variable}=${driver} has no credential set`); continue; }
    if (!hostAccepts(kind, driver, env)) { reasons.push(`${driver} does not take ${kind}`); continue; }
    if (file && typeof PROVIDERS[driver].acceptsFile === 'function') {
      const verdict = PROVIDERS[driver].acceptsFile(file);
      if (!verdict.ok) { reasons.push(`${driver}: ${verdict.why}`); continue; }
    }
  }
  return reasons.length ? reasons.join('; ') : null;
}

/**
 * Every kind the router distinguishes, in the order they are worth reading.
 *
 * `audio` IS separate even though it shares a driver variable with `file`: a store's audio
 * and its archives are different promises (one plays in the page, one downloads), and an
 * operator reading the boot line should see that a host is taking audio rather than
 * inferring it from the word "file".
 */
export const ROUTED_KINDS = ['video', 'audio', 'image', 'file'];

/**
 * THE LIVE DRIVER — a second kind of choice, because live is not storage.
 *
 * A media host holds bytes; a live host holds a *stream*. What the seller needs is an
 * ingest address and a key, and what the page needs is an HLS playlist — so a hosted host's
 * live half is a different question from `driverForKind`, and it gets its own variable
 * rather than being smuggled into `VIDEO_DRIVER`.
 *
 * Unset means today's behaviour, unchanged: a seller points a live file at a playlist
 * they obtained somewhere else, and nothing here is involved. That default matters — the
 * live surface, its breaks and its ladder have worked without an ingest server since the
 * live round, and this variable adds to them rather than replacing them.
 */
export const LIVE_VAR = 'LIVE_DRIVER';

export const liveDriver = (env = process.env) => {
  const value = String((env || {})[LIVE_VAR] || '').trim().toLowerCase();
  return isHost(value) && PROVIDERS[value].capabilities.live ? value : 'local';
};

/** Is a live ingest being run for this deployment? The boot line and the seller's panel ask. */
export const liveIngestEnabled = (env = process.env) => {
  const driver = liveDriver(env);
  return driver !== 'local' && configured(driver, env);
};

/** Is ANY kind of media going to a host? The privacy notice and the boot line ask. */
export const hostsEnabled = (env = process.env) =>
  ROUTED_KINDS.some((kind) => driverForKind(kind, env) !== 'local');

/** The hosts in play and the kinds each holds, for a line that has to name what leaves. */
export const activeHosts = (env = process.env) => {
  const found = new Map();
  for (const kind of ROUTED_KINDS) {
    const driver = driverForKind(kind, env);
    if (driver === 'local') continue;
    if (!found.has(driver)) found.set(driver, []);
    found.get(driver).push(kind);
  }
  return [...found].map(([host, kinds]) => ({ host, kinds }));
};

/**
 * ── SERVING THEIR BYTES THROUGH OUR OWN ORIGIN ───────────────────────────────
 *
 * Two of the hosts in this registry will not always let a BROWSER fetch the file directly:
 *
 *   * Pixeldrain's free plan reads a direct browser fetch as a hotlink and answers 403
 *     (`hotlink_detected`). A store page that redirects to it is a hotlink with extra steps.
 *   * Catbox's terms forbid it being a service's CDN at all, which is a different kind of
 *     problem — a licence one, not an HTTP one — and no amount of engineering fixes a term.
 *
 * So delivery has two shapes, and the choice is a decision about BANDWIDTH rather than about
 * code: a redirect is free for us and puts the viewer's browser on the host's connection; a
 * relay sends every byte through this server, which costs upload but is the only way to serve
 * a file the host will not hand to a browser. When the host refuses, the relay is what stands
 * between a working store and a viewer staring at a broken player.
 *
 * WHAT IT DOES NOT FIX, said out loud: Catbox's terms. Relaying their bytes still uses them as
 * this service's CDN — the same thing their operator objects to — so catbox is NOT relayed by
 * default and stays development-only. The relay is for a host that permits the traffic and
 * simply wants it to come from the account holder's server rather than from a stranger's tab.
 *
 * `MEDIA_RELAY` decides, and every value is legible from the outside:
 *
 *   unset            → the hosts that declare `hotlink: 'refused-when-free'` (today: Pixeldrain)
 *   none             → nobody: every remote file is a 302. Right for a Pro account, and the
 *                      setting an operator reaches for when our upload is the scarce resource
 *   all              → every host that stores a file
 *   a,b,c            → exactly those hosts
 *
 * It is a registry question rather than a route question because the answer has to be the same
 * in the route, the doctor and the boot banner — three places that would otherwise each have
 * their own copy of "does this host serve browsers".
 */
export const RELAY_VAR = 'MEDIA_RELAY';

export const relaysThroughUs = (host, env = process.env) => {
  const provider = PROVIDERS[host];
  if (!provider || provider.capabilities.role === 'live') return false;
  const setting = String(env[RELAY_VAR] ?? '').trim().toLowerCase();
  if (!setting) return provider.capabilities.hotlink === 'refused-when-free';
  if (setting === 'none') return false;
  if (setting === 'all') return true;
  return setting.split(/[,\s]+/).filter(Boolean).includes(host);
};

/** The api base of the configured provider, for the messages and the doctor. */
export const videoHostBase = (env = process.env) => {
  const driver = videoDriver(env);
  return isHost(driver) ? PROVIDERS[driver].base(env) : null;
};

/**
 * Every provider's facts, for the doctor and for anything that has to explain a choice.
 *
 * A function rather than a frozen table so that the note can carry the ONE thing that
 * changes per account or per plan without every caller re-deriving it.
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
 * Filemoon is a video host whose non-video uploads are download-only; Telegra.ph takes
 * images and can never delete one; Catbox's own terms forbid being a service's CDN. So a
 * kind a host does not declare stays on our disk. The vocabulary is `mediaKind`'s — video,
 * audio, image, file — and a test holds every provider's list to it.
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
  /*
   * The hosts actually IN USE, not every host whose credential exists.
   *
   * Telegra.ph is the reason this changed: it has no credential, so `configured()` is true
   * for it unconditionally, and a policy built from "configured hosts" would allow
   * telegra.ph in the CSP of every deployment in the world — including the ones that have
   * never sent it a byte. The CSP is a list of the places a page may reach; it should name
   * what this deployment actually uses and nothing else.
   */
  const inUse = new Set(activeHosts(env).map((entry) => entry.host));
  /*
   * THE LIVE DRIVER'S ORIGINS TOO, and this is not a detail.
   *
   * A deployment can run its files on one host and its live streams on another —
   * `VIDEO_DRIVER=filemoon LIVE_DRIVER=antmedia` is the shape this product deploys with.
   * `activeHosts()` answers for the KIND routing only, so building the CSP from it alone
   * would leave a live playlist's origin unnamed: hls.js fetches it with XHR under
   * `connect-src`, the fetch is refused with no error event, and the stream is a black
   * rectangle in a browser that is doing exactly what the policy told it to. The live
   * driver is therefore added by name, not by kind.
   */
  const live = liveDriver(env);
  if (live !== 'local' && configured(live, env)) inUse.add(live);
  const declared = [...inUse].flatMap((host) => PROVIDERS[host].mediaOrigins(env));
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

/**
 * Forget any cached identity — the doctor asks fresh, and so does a test.
 *
 * Every provider that caches anything exposes `forgetAccount`; this asks each of them
 * rather than naming one, which is how the function survived the removal of a host that
 * used to be the only one with a cache.
 */
export function forgetAccount() {
  for (const host of HOSTS) {
    const forget = PROVIDERS[host].forgetAccount;
    if (typeof forget === 'function') forget();
  }
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
