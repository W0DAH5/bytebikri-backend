import { hmac, safeEqual } from './crypto.js';

/**
 * House — our own sandbox network. Not a real ad provider and never will be.
 *
 * It exists so the unlock loop can be exercised end to end without credentials:
 * every other adapter needs a real secret from a real dashboard, and a platform
 * whose only verifier needs a commercial account is a platform nobody can test.
 *
 * It is a full citizen of the adapter contract on purpose. If the abstraction
 * only fit the provider we invented, it wouldn't be an abstraction — it would
 * be a description of our own bug. Note that this is the ONE adapter using
 * POST+JSON+hex-HMAC-in-headers, which is exactly the scheme I originally
 * mistook for a universal standard. Seeing it here, alone, is the reminder that
 * it isn't.
 *
 * Scheme: POST, JSON body, headers
 *   x-bb-timestamp: epoch millis
 *   x-bb-signature: hex HMAC-SHA256(secret, `${timestamp}.${rawBody}`)
 * Rejected outside a 5-minute window, which bounds replay.
 */

const MAX_SKEW_MS = 5 * 60 * 1000;

export function parse(ctx) {
  if (ctx.method !== 'POST') return { ok: false, reason: 'house callbacks are POST' };

  const ts = ctx.headers?.['x-bb-timestamp'];
  const sig = ctx.headers?.['x-bb-signature'];
  if (!ts || !sig) return { ok: false, reason: 'missing signature headers' };

  const tsNum = Number.parseInt(ts, 10);
  if (!Number.isFinite(tsNum)) return { ok: false, reason: 'unparseable timestamp' };

  const skew = Math.abs(Date.now() - tsNum);
  if (skew > MAX_SKEW_MS) {
    return { ok: false, reason: 'timestamp outside allowed window (possible replay)' };
  }

  // Hash the bytes as received. Re-serialising req.body would change key order
  // and whitespace, and the signature would never match — same class of bug as
  // BitLabs' "do not encode/decode the URL".
  const signed = `${ts}.${ctx.rawBody ?? ''}`;
  if (!safeEqual(String(sig), hmac('sha256', ctx.secret, signed))) {
    return { ok: false, reason: 'signature mismatch' };
  }

  const b = ctx.body || {};
  if (!b.viewId) return { ok: false, reason: 'no viewId' };
  if (b.completed !== true) return { ok: false, reason: 'completed !== true' };

  const durationSec = Number(b.durationSec) || 0;
  if (durationSec <= 0) return { ok: false, reason: 'no watch duration recorded' };

  return {
    ok: true,
    event: {
      userId: b.userId || null, // resolved against our ad-ref map, never trusted as an identity
      viewId: String(b.viewId),
      externalId: String(b.externalId || `house_${b.viewId}`),
      revenueUsd: Number(b.revenueUsd) || 0,
      state: 'complete',
      meta: { network: 'house', viewId: String(b.viewId), durationSec },
    },
  };
}

export function sign({ secret, rawBody, timestamp = Date.now() }) {
  return {
    timestamp: String(timestamp),
    signature: hmac('sha256', secret, `${timestamp}.${rawBody}`),
  };
}

export function selfTest() {
  const secret = 'test';
  const rawBody = '{"viewId":"v1","completed":true,"durationSec":5}';
  const { timestamp, signature } = sign({ secret, rawBody });
  const base = { method: 'POST', secret, rawBody, headers: { 'x-bb-timestamp': timestamp, 'x-bb-signature': signature } };
  const accepts = parse({ ...base, body: JSON.parse(rawBody) }).ok === true;
  const forged = parse({ ...base, body: JSON.parse(rawBody), headers: { ...base.headers, 'x-bb-signature': 'f'.repeat(64) } });
  const stale = sign({ secret, rawBody, timestamp: Date.now() - 10 * 60 * 1000 });
  const staleRejected = parse({
    ...base,
    body: JSON.parse(rawBody),
    headers: { 'x-bb-timestamp': stale.timestamp, 'x-bb-signature': stale.signature },
  });
  return {
    acceptsValid: accepts,
    rejectsForged: forged.ok === false,
    rejectsStale: staleRejected.ok === false,
  };
}

export const id = 'house';
export const label = 'House (sandbox)';
export const docs = null;
export const formats = ['rewarded_video'];
export const method = 'POST';
export const verificationStatus = 'sandbox';
export const onboarding = {
  consolePath: 'none — this is our own simulated network',
  mustConfigure: ['nothing; use /dev/simulate-network/house'],
};
