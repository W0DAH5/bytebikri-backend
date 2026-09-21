import { hmac, safeEqual } from './crypto.js';

/**
 * BitLabs — offerwall + surveys. https://developer.bitlabs.ai/docs/callbacks
 *
 * "A callback is always an HTTP GET request."
 * Signature: hex HMAC-SHA1 of the URL, keyed with the App Secret, appended as
 * the LAST query parameter, `&hash=`. Their docs contain a worked example with
 * a real secret and the expected digest; `selfTest()` below reproduces it.
 *
 * The critical footgun, from their own docs:
 *
 *   "Do not encode/decode the URL before generating the hash. This will cause
 *    differences in the result. Take the URL as it is, without manipulating."
 *
 * So we hash `req.originalUrl` — the bytes as received. Rebuilding the query
 * from `req.query` and re-serialising it would silently reorder or re-encode
 * parameters and fail every single postback. This is why the signed string is
 * sliced out of the raw URL rather than reconstructed from parsed values.
 *
 * Because BitLabs hashes the absolute URL configured in their dashboard, the
 * connection must record its own callback base URL — we can't derive it from
 * the Host header, which is attacker-controlled.
 */

const PARAM = {
  user: ['uid', 'user', 'user_id'],
  tx: ['tx', 'txid', 'transaction_id'],
  value: ['val'],
  raw: ['raw'],
  type: ['type'],
  offerState: ['offer_state'],
  screenoutReason: ['reject_reason', 'reason'],
  country: ['country'],
  // BitLabs passes back any custom parameter you attach to the opening link.
  // We attach our view id so a postback ties to one exact view instead of being
  // guessed from a user id — which is also what makes two open views on the
  // same asset distinguishable.
  view: ['view', 'view_id', 's1'],
};

/** BitLabs lets publishers name callback params; look them up case-insensitively. */
function pick(q, names) {
  for (const n of names) {
    if (q[n] !== undefined && q[n] !== '') return q[n];
    const upper = n.toUpperCase();
    if (q[upper] !== undefined && q[upper] !== '') return q[upper];
  }
  return undefined;
}

/** Map BitLabs vocabulary onto our normalized states. */
function normalizeState(q) {
  const offerState = (pick(q, PARAM.offerState) || '').toUpperCase();
  if (offerState) {
    if (offerState === 'COMPLETED') return 'complete';
    if (offerState === 'PENDING') return 'pending';
    if (offerState === 'RECONCILED') return 'reconciled';
    return 'unknown';
  }
  const type = (pick(q, PARAM.type) || '').toUpperCase();
  if (type) {
    if (type === 'COMPLETE' || type === 'START_BONUS') return 'complete';
    if (type === 'SCREENOUT') return 'screenout';
    if (type === 'RECONCILIATION') return 'reconciled';
    return 'unknown';
  }
  // Neither offer_state nor type was returned. We cannot distinguish a pending
  // conversion from a final one, and BitLabs explicitly warns to reward only on
  // COMPLETED. Refuse rather than guess.
  return 'unknown';
}

export function parse(ctx) {
  if (ctx.method !== 'GET') {
    return { ok: false, reason: 'BitLabs callbacks are always GET' };
  }
  const raw = ctx.rawUrl || '';
  const marker = '&hash=';
  const at = raw.indexOf(marker);
  if (at === -1) return { ok: false, reason: 'no &hash= on the callback' };

  const given = raw.slice(at + marker.length).split('&')[0];
  const signed = (ctx.baseUrl || '') + raw.slice(0, at);

  if (!safeEqual(given, hmac('sha1', ctx.secret, signed))) {
    return { ok: false, reason: 'hash mismatch' };
  }

  const q = ctx.query || {};
  const userId = pick(q, PARAM.user);
  const externalId = pick(q, PARAM.tx);
  if (!userId) return { ok: false, reason: 'no user id' };
  if (!externalId) {
    // Without TX we have no idempotency key and a provider retry (they retry 6
    // times) would grant twice. Refuse.
    return { ok: false, reason: 'no transaction id (TX) — cannot dedupe safely' };
  }

  const rawUsd = pick(q, PARAM.raw);
  return {
    ok: true,
    event: {
      userId,
      externalId: String(externalId),
      viewId: pick(q, PARAM.view) || null,
      revenueUsd: rawUsd ? Number.parseFloat(rawUsd) || 0 : 0,
      state: normalizeState(q),
      meta: {
        network: 'bitlabs',
        country: pick(q, PARAM.country) || null,
        screenoutReason: pick(q, PARAM.screenoutReason) || null,
      },
    },
  };
}

/**
 * Reproduces BitLabs' own published example. If this ever fails, the verifier is
 * wrong and every real postback is being rejected (or worse, accepted).
 */
export function selfTest() {
  const ctx = {
    method: 'GET',
    baseUrl: 'https://publisher.com',
    rawUrl: '/complete?uid=8cc877ee-af19-488d-b28d-216fb866b996&val=500&hash=dbcd6bb8ca677344592842a52b4fca9bec36cd4b',
    query: {
      uid: '8cc877ee-af19-488d-b28d-216fb866b996',
      val: '500',
      tx: 'TX-1',
      type: 'COMPLETE',
    },
    secret: 'JLOIAUNMHFli7ZJOQVEzm98rzqnm9',
  };
  const good = parse(ctx);
  const bad = parse({
    ...ctx,
    rawUrl: ctx.rawUrl.replace('dbcd6bb8ca677344592842a52b4fca9bec36cd4b', 'deadbeef'.repeat(5)),
  });
  return {
    publishedVectorAccepted: good.ok === true,
    publishedVectorYieldsComplete: good.ok && good.event.state === 'complete',
    forgedVectorRejected: bad.ok === false,
  };
}

export const id = 'bitlabs';
export const label = 'BitLabs';
export const docs = 'https://developer.bitlabs.ai/docs/callbacks';
export const formats = ['offerwall', 'survey'];
export const method = 'GET';
export const onboarding = {
  consolePath: 'Dashboard → Apps → your app → Integration → Reward Callback',
  mustConfigure: [
    'Callback URL → {callbackBase}/api/ads/postback/bitlabs',
    'Callback Secret → the app secret (set it as this connection\'s secret)',
    'Callback params must include UID, TX, VAL, RAW',
    'Enable offer_state, or we cannot tell a final conversion from a pending one and will refuse it',
  ],
};
