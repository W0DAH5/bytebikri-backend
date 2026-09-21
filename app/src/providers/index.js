import * as bitlabs from './bitlabs.js';
import * as pubscale from './pubscale.js';
import * as applixir from './applixir.js';
import * as house from './house.js';

/**
 * Provider adapters — how we verify one ad network's postback.
 *
 * This is a DIFFERENT concern from src/registry.js. The registry answers "can a
 * Nepali creator actually withdraw this network's money?" (commercial). An
 * adapter answers "how do I cryptographically verify this network's postback?"
 * (protocol). Same provider id in two files, because they change for unrelated
 * reasons and conflating them means a payout-rail update touches signature code.
 *
 * There is no universal postback scheme. Every network signs differently:
 *
 *   BitLabs   GET   hex HMAC-SHA1 over the raw URL, appended as &hash=
 *   PubScale  GET   hex MD5 of "secret.user_id.value.token"
 *   AppLixir  GET   MD5 of a shared secret (exact template unconfirmed)
 *   House     POST  hex HMAC-SHA256 over the body, in headers  <- ours alone
 *
 * CONTRACT
 *   parse(ctx) -> { ok: true, event } | { ok: false, reason }
 *
 *   ctx   = { method, rawUrl, rawBody, query, body, headers, secret, baseUrl }
 *   event = { userId, externalId, revenueUsd, state, meta }
 *
 * Adapters must never throw on malformed input — a garbage postback from the
 * open internet is an expected input, not an exception. index.js catches
 * anyway, because "should never throw" is not the same as "cannot".
 */

export { safeEqual, hmac, md5, sha256 } from './crypto.js';

export const ADAPTERS = [bitlabs, pubscale, applixir, house];

const BY_ID = new Map(ADAPTERS.map((a) => [a.id, a]));

/**
 * The sandbox network.
 *
 * Its "signature" is a shared secret in this repository and its whole purpose is
 * to let a developer mint an unlock without a real provider watching an ad. That
 * is exactly the capability an attacker wants in production, so it is not merely
 * unlisted there — it does not resolve. A connection already in the database
 * pointing at `house` becomes unusable rather than becoming a forgery endpoint.
 */
export const SANDBOX_PROVIDER_IDS = new Set(['house']);

export function getAdapter(id) {
  if (process.env.NODE_ENV === 'production' && SANDBOX_PROVIDER_IDS.has(id)) return null;
  return BY_ID.get(id) || null;
}

/**
 * Normalized states, because networks disagree on vocabulary:
 *
 *   complete    user finished and is owed the reward -> GRANTS AN UNLOCK
 *   pending     network hasn't finalized; offerwalls reconcile days later
 *   reconciled  network finalized or adjusted an earlier event
 *   screenout   user was disqualified (surveys) -> no reward, and not fraud
 *   ban         network flagged the user for fraud -> revoke, don't reward
 *   unknown     unrecognized vocabulary -> refuse to grant
 *
 * `unknown` never grants. Defaulting to a grant on vocabulary we've never seen
 * would pay out on a state some network invents next quarter.
 */
export const STATES = ['complete', 'pending', 'reconciled', 'screenout', 'ban', 'unknown'];

/** Only `complete` releases content. */
export const GRANTS_UNLOCK = (state) => state === 'complete';

/** Verify + normalize. Never throws. */
export function parsePostback(providerId, ctx) {
  const adapter = getAdapter(providerId);
  if (!adapter) return { ok: false, reason: `no adapter for provider "${providerId}"` };
  if (!ctx || !ctx.secret) {
    // A connection with no secret cannot verify anything. Refusing is the only
    // safe reading; accepting would let anyone POST a completion.
    return { ok: false, reason: 'provider has no callback secret configured' };
  }

  let result;
  try {
    result = adapter.parse(ctx);
  } catch (err) {
    return { ok: false, reason: `adapter threw: ${err.message}` };
  }

  if (!result || typeof result !== 'object') return { ok: false, reason: 'adapter returned nothing' };
  if (!result.ok) return { ok: false, reason: result.reason || 'rejected' };

  const e = result.event || {};
  if (!e.externalId) return { ok: false, reason: 'event has no externalId to dedupe on' };
  if (!STATES.includes(e.state)) return { ok: false, reason: `event has unknown state "${e.state}"` };

  return {
    ok: true,
    event: {
      meta: {},
      ...e,
      state: e.state,
      externalId: String(e.externalId),
      viewId: e.viewId ? String(e.viewId) : null,
      revenueUsd: Number(e.revenueUsd) || 0,
    },
  };
}

/** Adapters that ship a verifier we do not yet trust for production traffic. */
export function advisories() {
  return ADAPTERS.filter((a) => a.verificationStatus && a.verificationStatus.startsWith('unconfirmed')).map((a) => ({
    id: a.id,
    label: a.label,
    verificationStatus: a.verificationStatus,
    note: "Verifier fails closed until the signature template is confirmed against the provider's dashboard.",
  }));
}

/** Runs every adapter's published/self test. Surfaced at /health so drift is loud. */
export function selfTest() {
  const out = {};
  for (const a of ADAPTERS) {
    if (typeof a.selfTest !== 'function') continue;
    try {
      out[a.id] = a.selfTest();
    } catch (err) {
      out[a.id] = { threw: err.message };
    }
  }
  return out;
}
