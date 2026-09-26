/**
 * ── THE EDGE RELAY: Catbox and Pixeldrain, delivered by somebody else's connection ──
 *
 * Two of the hosts in the registry will not always hand their bytes to a browser. Pixeldrain's
 * free plan answers a direct browser fetch with 403 `hotlink_detected`, because a redirect from
 * a store page is a hotlink with extra steps; Catbox's terms forbid being a service's CDN at
 * all, which is a licence problem rather than an HTTP one.
 *
 * `relaysThroughUs` (in `video.js`) solved that by piping the bytes through this server. That
 * works, and it puts two costs here that do not belong here: our UPLOAD pays for every byte of
 * somebody else's file, and every viewer arrives at the host from ONE address — ours — which is
 * exactly the traffic shape a host's abuse detection is built to notice. A small deployment
 * cannot afford the first and should not invite the second.
 *
 * So delivery has three tiers now, and this module is the middle one:
 *
 *   1. DIRECT      a 302 to the host. Free, and the default for every host that serves browsers.
 *   2. EDGE        a 302 to a Cloudflare Worker (this file) which fetches with our key, streams
 *                  the bytes unbuffered, and passes Range through. Cloudflare's free tier has no
 *                  egress charge and a Worker's requests leave from the edge, which is many
 *                  addresses rather than one. THIS is what makes Catbox and Pixeldrain survivable
 *                  on a machine with no budget.
 *   3. OURS        the existing relay in `server.js`, used when no edge is configured.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE URL IS SIGNED, AND WHY THAT IS NOT OPTIONAL
 *
 * A Worker that fetches `catbox.moe/<anything>` and returns it is an OPEN RELAY running on the
 * operator's Cloudflare account: anybody who learns the URL gets free, anonymous bandwidth
 * through it, and the operator's 100,000-requests-a-day allowance is somebody else's to spend.
 * Worse, the Pixeldrain route carries our API key — an unauthenticated version of it would hand
 * every visitor our account.
 *
 * So every URL this module hands out carries its own proof, an HMAC over the exact thing being
 * fetched (`host/id/expiry`), and the Worker verifies it before it opens a socket. Three
 * properties fall out of that, and all three matter:
 *
 *   * the secret never leaves the two servers that need it, so guessing a URL is not enough to
 *     use it;
 *   * it EXPIRES (`MEDIA_EDGE_TTL_SECONDS`, six hours by default) — long enough for a viewer to
 *     watch a film through a signed link, short enough that a URL pasted into a chat stops
 *     working the same day;
 *   * the signature covers the PATH, so a link for one file cannot be edited into a link for
 *     another. This is the difference between signing a URL and handing out a key.
 *
 * The token travels in the QUERY STRING because it has to: the browser fetches a media url from
 * a `<video>` element or a Range request, and neither can carry an Authorization header. That is
 * the same property every signed CDN url has, and it is why the expiry is short rather than
 * permanent.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS DOES NOT DO
 *
 * It does not make Catbox's terms allow what they forbid. Their operator says no services may use
 * Catbox as a CDN; a Worker fetching their bytes and re-serving them is still that, and no
 * amount of engineering changes a term — only their permission would, and asking for it is a
 * thing the operator of this deployment should do rather than assume. Catbox therefore stays
 * marked development-only, the relay for it is opt-in (`MEDIA_RELAY=catbox`), and the docs say
 * plainly which of the two problems the edge tier fixes (the HTTP one, and our bandwidth) and
 * which one it does not (the licence one).
 *
 * Nor does it touch the live path: a live host is never relayed (its playlist names its own
 * segments — see `server.js`), and `live` hosts are excluded here for the same reason.
 */
import crypto from 'node:crypto';
import { relaysThroughUs } from './video.js';

export const EDGE_VAR = 'MEDIA_EDGE_BASE';
export const EDGE_SECRET_VAR = 'MEDIA_EDGE_SECRET';
export const EDGE_TTL_VAR = 'MEDIA_EDGE_TTL_SECONDS';
export const DEFAULT_EDGE_TTL_SECONDS = 6 * 60 * 60;

/**
 * The hosts this method is FOR, by name.
 *
 * Not "every host that would be relayed" — that is how a general-purpose open proxy gets built
 * by accident. These two have a known reason to be here (a free plan that refuses browsers, and
 * terms that forbid the traffic shape), and adding a third should be a decision somebody makes
 * on purpose rather than a consequence of setting a variable.
 */
export const EDGE_HOSTS = ['catbox', 'pixeldrain'];

/** The worker's origin, normalised, or null. */
export function edgeBase(env = process.env) {
  const raw = String(env[EDGE_VAR] ?? '').trim().replace(/\/+$/, '');
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return raw;
  } catch { return null; }
}

/**
 * Is the edge usable at all?
 *
 * A base URL WITHOUT a secret is treated as not configured, and that is the important half: the
 * tempting default — sign nothing, let the Worker serve anyone — is the open relay this whole
 * file is written to avoid. A deployment that sets one and not the other gets the host's plain
 * 302 (and the doctor says why), which is a worse experience than a relayed file and a much
 * better one than an abuse report.
 */
export function edgeConfigured(env = process.env) {
  return Boolean(edgeBase(env) && String(env[EDGE_SECRET_VAR] ?? '').trim());
}

/** Does this host's delivery go through the edge? */
export function edgeServes(host, env = process.env) {
  if (!EDGE_HOSTS.includes(host)) return false;
  if (!edgeConfigured(env)) return false;
  // The relay question is still the one that decides WHETHER these bytes need a middleman at
  // all; the edge only decides WHO the middleman is. So `MEDIA_RELAY=none` (a Pro key that
  // hotlinks fine) means no edge either — the file is served directly, which is cheaper for
  // everybody, and one setting switches both off.
  return relaysThroughUs(host, env);
}

/** The exact string that gets signed. The path is covered; the query is not needed in it. */
export const edgePayload = (host, id, exp) => `${host}/${id}/${exp}`;

export function edgeSignature(host, id, exp, env = process.env) {
  const secret = String(env[EDGE_SECRET_VAR] ?? '');
  return crypto.createHmac('sha256', secret).update(edgePayload(host, id, exp)).digest('hex');
}

/**
 * The url to hand the browser, or null when the edge is not configured for this host.
 *
 * `now` is injectable so a test can watch a link expire without waiting six hours, and so the
 * doctor can print the same url it just built.
 */
export function edgeUrl(host, id, { env = process.env, now = Date.now() } = {}) {
  if (!edgeServes(host, env)) return null;
  const ttl = Number(env[EDGE_TTL_VAR]) > 0 ? Number(env[EDGE_TTL_VAR]) : DEFAULT_EDGE_TTL_SECONDS;
  const exp = Math.floor((now + ttl * 1000) / 1000);
  const signature = edgeSignature(host, id, exp, env);
  const base = edgeBase(env);
  return `${base}/${host}/${encodeURIComponent(String(id))}?e=${exp}&s=${signature}`;
}

/**
 * The origins the browser will actually fetch from, for the CSP.
 *
 * The lesson from §10.4, applied one step earlier: the policy must name the origin of the 302's
 * DESTINATION, and with an edge configured that is the Worker rather than the host. Omitting it
 * produces a stream that is refused with no error event and a black rectangle that looks like a
 * player bug — which is exactly what the media-origin test exists to prevent.
 */
export function edgeOrigins(env = process.env) {
  if (!edgeConfigured(env)) return [];
  try { return [new URL(edgeBase(env)).origin]; } catch { return []; }
}
