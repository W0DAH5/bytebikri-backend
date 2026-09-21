import { md5, safeEqual } from './crypto.js';

/**
 * PubScale (Offerwall SDK) — https://pubscale.gitbook.io/offerwall-sdk
 *
 * GET with ?user_id=&value=&token=&signature=
 * Signature = hex MD5 of "secret.user_id.value.token", where `value` is
 * truncated to an integer. Their docs give the same template in Go, JS and
 * Python, which is how we know the field order is not an accident:
 *
 *   Go     fmt.Sprintf("%s.%s.%d.%s", secret, user_id, value, token)
 *   JS     `${secret}.${user_id}.${Math.trunc(value)}.${token}`
 *   Python '{secret}.{user_id}.{value}.{token}'.format(... int(value) ...)
 *
 * The truncation is load-bearing: a `value` of "1.9" signs as "1". Formatting
 * the float back in would produce "1.9" and fail every postback.
 *
 * They retry 6 times if we don't answer 2xx — so a duplicate must return 200,
 * not 409. Idempotency handles that; see server.js.
 */

export function parse(ctx) {
  if (ctx.method !== 'GET') {
    return { ok: false, reason: 'PubScale callbacks are GET' };
  }
  const q = ctx.query || {};
  const userId = q.user_id;
  const token = q.token;
  const value = q.value;
  const given = q.signature;

  if (!userId || !token) return { ok: false, reason: 'missing user_id or token' };
  if (!given) return { ok: false, reason: 'missing signature' };

  // Math.trunc, not parseFloat-then-format. "1.9" and "1.0" both sign as "1".
  const asInt = Math.trunc(Number.parseFloat(value));
  if (!Number.isFinite(asInt)) return { ok: false, reason: 'unparseable value' };

  const expected = md5(`${ctx.secret}.${userId}.${asInt}.${token}`);
  if (!safeEqual(String(given).toLowerCase(), expected)) {
    return { ok: false, reason: 'signature mismatch' };
  }

  return {
    ok: true,
    event: {
      userId,
      externalId: String(token),
      // `value` is in the app's own currency, not USD. The USD figure isn't in
      // this callback, so we record 0 rather than misreport revenue.
      revenueUsd: 0,
      state: 'complete',
      meta: { network: 'pubscale', appValue: asInt, revenueNote: 'USD not present in this callback' },
    },
  };
}

/** Exercises the truncation rule, which is the easiest part to get wrong. */
export function selfTest() {
  const secret = 'test-secret';
  const sign = (v) => md5(`${secret}.u1.${Math.trunc(Number.parseFloat(v))}.tk1`);
  const ctx = (value, sig) => ({
    method: 'GET',
    secret,
    query: { user_id: 'u1', token: 'tk1', value, signature: sig },
  });
  const integerAccepts = parse(ctx('1', sign('1'))).ok === true;
  const decimalAccepts = parse(ctx('1.9', sign('1.9'))).ok === true;
  const wrongValueRejected = parse(ctx('2', sign('1.9'))).ok === false;
  return { integerAccepts, decimalAccepts, wrongValueRejected };
}

export const id = 'pubscale';
export const label = 'PubScale';
export const docs = 'https://pubscale.gitbook.io/offerwall-sdk';
export const formats = ['offerwall'];
export const method = 'GET';
export const verificationStatus = 'confirmed-from-docs';
export const onboarding = {
  consolePath: 'Offerwall dashboard → S2S Callback Configuration',
  mustConfigure: [
    'Callback URL → {callbackBase}/api/ads/postback/pubscale',
    'Supply the secret key issued with your app API key',
  ],
};
