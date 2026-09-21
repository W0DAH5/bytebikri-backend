import { md5, safeEqual } from './crypto.js';

/**
 * AppLixir — rewarded video only. https://support.applixir.com/
 *
 * !!! VERIFICATION TEMPLATE UNCONFIRMED — DO NOT ENABLE IN PRODUCTION YET !!!
 *
 * What their documentation states outright:
 *   - The server callback is an HTTPS GET with the event data in query params.
 *   - It is configured with a "Callback URL" and a "Callback Secret".
 *   - The request carries "an MD5 signature derived from a shared secret".
 *   - The callback is the source of truth; the SDK's client-side
 *     `status.type === "complete"` is "optimistic UI only" and
 *     "a client-side-only reward grant is trivially forgeable".
 *   - `userId` must be a valid UUID4.
 *
 * What their public docs do NOT state: the exact field order fed into the MD5.
 * We will not guess a signature scheme and then call it verified. The template
 * below is a placeholder that fails closed — it will reject every postback
 * until someone reads the parameter list off the dashboard's Callbacks page and
 * fixes `signingTemplate`.
 *
 * Fail-closed is the correct direction to be wrong in: a verifier that rejects
 * real postbacks shows up as "nothing unlocks", which is loud. A verifier that
 * accepts forged ones shows up as silent free content billed to the channel.
 *
 * Before enabling: read the Callback page's parameter list, confirm the
 * concatenation order, and add their published example (if any) to selfTest().
 */

const signingTemplate = ({ secret, params }) => {
  // PLACEHOLDER — replace once the dashboard field list is known.
  return `${secret}.${params.userId ?? ''}.${params.revenue ?? ''}.${params.txId ?? ''}`;
};

export function parse(ctx) {
  if (ctx.method !== 'GET') {
    return { ok: false, reason: 'AppLixir callbacks are GET' };
  }
  const q = ctx.query || {};
  const userId = q.userId || q.userid || q.user_id;
  const txId = q.custom || q.txId || q.transaction_id;
  const revenue = q.revenue ?? q.amount ?? q.payout;
  const given = q.signature || q.hash;

  if (!userId) return { ok: false, reason: 'no userId' };
  // Their SDK requires UUID4; a non-UUID means the callback is fabricated or
  // the integration is passing junk, and every downstream lookup would miss.
  if (!UUID4.test(userId)) return { ok: false, reason: 'userId is not a UUID4 as their SDK requires' };
  if (!txId) return { ok: false, reason: 'no transaction id — cannot dedupe' };
  if (!given) return { ok: false, reason: 'no signature' };

  const expected = md5(signingTemplate({ secret: ctx.secret, params: { userId, txId, revenue } }));
  if (!safeEqual(String(given).toLowerCase(), expected)) {
    return { ok: false, reason: 'signature mismatch (template unconfirmed — see adapter header)' };
  }

  return {
    ok: true,
    event: {
      userId,
      externalId: String(txId),
      viewId: q.viewId || q.view_id || (q.custom && UUID4.test(q.custom) ? q.custom : null),
      revenueUsd: Number.parseFloat(revenue) || 0,
      state: 'complete',
      meta: { network: 'applixir' },
    },
  };
}

const UUID4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function selfTest() {
  const wellFormed = parse({
    method: 'GET',
    secret: 'x',
    query: {
      userId: '8cc877ee-af19-488d-b28d-216fb866b996',
      custom: 'tx1',
      signature: 'irrelevant',
    },
  });
  const junkId = parse({ method: 'GET', secret: 'x', query: { userId: 'abc', custom: 't', signature: 's' } });
  return {
    // Correctly refuses until the real template is filled in. That is the point.
    failsClosed: wellFormed.ok === false,
    rejectsNonUuidUserId: junkId.ok === false,
  };
}

export const id = 'applixir';
export const label = 'AppLixir';
export const docs = 'https://support.applixir.com/hc/en-us/articles/360053982873-Step-5-Setting-up-Web-Callback';
export const formats = ['rewarded_video'];
export const method = 'GET';
export const verificationStatus = 'unconfirmed-template';
export const onboarding = {
  consolePath: 'AppLixir dashboard → application → Callbacks',
  mustConfigure: [
    'Callback URL → {callbackBase}/api/ads/postback/applixir',
    'Callback Secret → set as this connection\'s secret',
    'CONFIRM THE MD5 FIELD ORDER from this page before enabling — the adapter fails closed until you do',
  ],
};
