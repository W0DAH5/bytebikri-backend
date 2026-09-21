/**
 * Unlock engine + the trust boundary.
 *
 * THE INVARIANT: an unlock is granted ONLY on a signed server-to-server
 * postback from the ad network. Never from a browser callback.
 *
 * Why this matters more than it looks: a browser callback is trivially forged.
 * A forged one means the user gets the content for free AND we file a revenue
 * claim with the provider that the provider will reject. That is simultaneously
 * a content leak and a fraud signal against the channel's ad account — the
 * channel loses access to their own money because of our bug.
 *
 * So the browser's only job is to *start* an unlock. Completion arrives from the
 * network, signed, and is verified per-provider by an adapter in src/providers/.
 *
 * There is no universal postback scheme. BitLabs signs HMAC-SHA1 over the raw
 * URL; PubScale signs MD5 of "secret.user_id.value.token"; AppLixir signs MD5 of
 * a shared secret. This file owns what must be identical across every provider:
 * identity, idempotency, atomicity, and what a normalized state means.
 */
import crypto from 'node:crypto';
import { store } from './store.js';
import { readSecret } from './config.js';
import { parsePostback, GRANTS_UNLOCK, getAdapter } from './providers/index.js';

const ACCESS_SECRET = () => readSecret('ACCESS_TOKEN_SECRET');
const DEFAULT_ACCESS_TTL_MS = 10 * 60 * 1000;

// ---------------------------------------------------------------------------
// Ad view session
// ---------------------------------------------------------------------------

/**
 * Step 1 — the browser starts an unlock. We mint a nonce and hand back the ad
 * config. Nothing is unlocked yet; this grants nothing.
 */
export async function startUnlock({ assetId, userId, providerId, personalised = false }) {
  const asset = await store.assetById(assetId);
  if (!asset) return { ok: false, error: 'asset not found' };

  const policy = await store.unlockPolicy(assetId);
  if (!policy) return { ok: false, error: 'asset has no unlock policy' };

  if (await store.isUnlocked(assetId, userId)) {
    return { ok: true, alreadyUnlocked: true };
  }

  // Only connections whose provider has a postback adapter can be used: if we
  // cannot verify the network's callback we can never grant the unlock, and
  // showing a user an ad we will not honour is worse than showing none.
  const connections = await store.connectionsOf(asset.channel_id);
  const usable = connections.filter((c) => getAdapter(c.provider_id) && c.callback_secret);
  const connection =
    (providerId && usable.find((c) => c.provider_id === providerId)) || usable[0] || null;
  if (!connection) {
    return { ok: false, error: 'this store has no verifiable ad connection' };
  }

  const dayCount = await store.completedViewsToday(assetId, userId);
  if (policy.max_unlocks_per_day && dayCount >= policy.max_unlocks_per_day) {
    return { ok: false, error: 'daily unlock limit reached for this asset' };
  }

  const nonce = crypto.randomBytes(16).toString('hex');
  const adRef = await store.adRefFor(userId);
  const view = await store.createPendingView({
    nonce,
    asset_id: assetId,
    channel_id: asset.channel_id,
    user_id: userId,
    connection_id: connection.id,
    provider_id: connection.provider_id,
    required_ads: policy.ads_required || 1,
    ad_min_seconds: policy.ad_min_seconds || 15,
  });

  return {
    ok: true,
    viewId: view.id,
    nonce,
    // Handed to the client so it can render/watch. This is a *request*, not a
    // grant: nothing here is trusted when it comes back.
    adConfig: {
      providerId: connection.provider_id,
      connectionId: connection.id,
      // The identifier the client passes through to the network. A random UUID4
      // that resolves to a user only inside our database — an ad network has no
      // business knowing who is watching.
      //
      // Omitted entirely without consent for personalised ads. This is the point
      // at which a refusal stops being a stored preference and starts being a
      // fact about what the network receives: with no identifier it cannot link
      // this view to the last one, so the ad it serves is untargeted whatever it
      // intends. Sending the id and asking the network nicely would be a promise
      // we have no way to keep or verify.
      userId: personalised ? adRef : undefined,
      // Echoed back by the network so the postback ties to this exact view
      // rather than being guessed at from a user id.
      custom: view.id,
      type: 'rewarded',
      minSeconds: view.ad_min_seconds,
      requiredViews: view.required_ads,
      // Told to the client so the modal can say which kind of ad this is. The
      // server does not trust it back.
      personalised,
    },
  };
}

/** Status poll — the browser asks whether the postback has landed. */
export async function unlockStatus({ assetId, userId, viewId }) {
  const unlocked = await store.isUnlocked(assetId, userId);
  const view = viewId ? await store.pendingView(viewId) : null;
  return { unlocked, viewCompleted: Boolean(view?.completed), viewId: view?.id ?? null };
}

/**
 * Sign a postback the way our sandbox network does. Dev only — real providers
 * sign with their own scheme, which is exactly the point of the adapters.
 */
export function signHousePostback(rawBody, timestamp = Date.now()) {
  const ts = String(timestamp);
  const mac = crypto.createHmac('sha256', houseSecret()).update(`${ts}.${rawBody}`).digest('hex');
  return { timestamp: ts, signature: mac };
}

const houseSecret = () => readSecret('AD_POSTBACK_SECRET');

/**
 * Step 2 — the network tells us a view completed. Grants the unlock.
 *
 * Verification is per-provider (src/providers/). What follows is what has to be
 * identical no matter who signed:
 *
 *   1. Resolve the view from OUR records. A postback is evidence that a view
 *      happened; it is not evidence of who the user is. Identity comes from the
 *      view we created. Taking `userId` from the payload would let any caller
 *      who learned our signing secret unlock content for an arbitrary account,
 *      and would make the network the authority on our user identity.
 *   2. Cross-check what the network echoed against the view.
 *   3. Claim the event and grant the unlock IN ONE TRANSACTION. Claiming is an
 *      insert that the unique index referees, not a read-then-write. See the
 *      note on claimAdView in store.js — the previous version had the textbook
 *      check-then-act race, where two concurrent deliveries (exactly what a
 *      provider retry produces) both pass the duplicate check and both grant.
 *   4. Grant only on state === 'complete'. `pending` offerwall conversions,
 *      survey screenouts and fraud bans all arrive on this same endpoint.
 */
export async function handlePostback({ providerId, connectionId, ctx }) {
  const connection = await store.activeConnection(connectionId, providerId);
  if (!connection) {
    await store.audit('postback.rejected', { providerId, connectionId, reason: 'no active connection' });
    return { ok: false, error: 'unknown or revoked connection', status: 404 };
  }

  const parsed = parsePostback(providerId, {
    ...ctx,
    secret: connection.callback_secret,
    baseUrl: connection.callback_base_url,
  });
  if (!parsed.ok) {
    await store.audit('postback.rejected', { providerId, connectionId, reason: parsed.reason });
    return { ok: false, error: parsed.reason, status: 401 };
  }
  const event = parsed.event;

  // (1) resolve the view from our own records.
  let view = null;
  if (event.viewId) {
    view = await store.pendingView(String(event.viewId));
    // The view exists but belongs to a different connection. A signature from
    // one connection must not release content gated by another's view.
    if (view && view.connection_id !== connection.id) view = null;
  }
  let userId = event.userId ? await store.userByAdRef(event.userId) : null;
  if (!view && userId) {
    const open = await store.openViewsFor(connection.provider_id, userId);
    view = open[0] ?? null;
  }
  if (!view) {
    await store.audit('postback.rejected', { providerId, connectionId, reason: 'no matching open view' });
    return { ok: false, error: 'no matching view for this callback', status: 409 };
  }

  // (2) the view's owner is the truth. If the network echoed somebody else, stop.
  if (userId && view.user_id !== userId) {
    await store.audit('postback.rejected', { providerId, connectionId, reason: 'user mismatch' });
    return { ok: false, error: 'callback user does not own this view', status: 403 };
  }
  userId = view.user_id;

  const policy = await store.unlockPolicy(view.asset_id);

  // (3) claim + grant, atomically.
  const result = await store.withTransaction(async (client) => {
    const claim = await store.claimAdView({
      channel_id: view.channel_id,
      user_id: userId,
      asset_id: view.asset_id,
      connection_id: connection.id,
      provider_id: connection.provider_id,
      external_id: event.externalId ?? null,
      kind: 'rewarded',
      state: event.state,
      completed: GRANTS_UNLOCK(event.state),
      duration_sec: event.meta?.durationSec ?? view.ad_min_seconds,
      revenue_usd: event.revenueUsd ?? null,
      meta: event.meta ?? {},
    }, client);

    if (!claim.claimed) {
      // Another delivery of this exact event already owns it. Still a success —
      // and the caller answers 2xx, because a non-2xx makes the provider retry
      // forever. PubScale retries six times on non-2xx.
      const unlocked = await store.isUnlocked(view.asset_id, userId);
      return { ok: true, duplicate: true, unlocked };
    }

    // (4) only `complete` releases content, and pending/reconciled follow-ups
    // arrive later on the same external id — which means the claim above will
    // refuse them. That is deliberate: a reconciliation changing a view's state
    // is a separate operation (revoke), not a second grant.
    if (!GRANTS_UNLOCK(event.state)) {
      await store.completePendingView(view.id, client);
      return { ok: true, unlocked: false, state: event.state, reason: `state "${event.state}" does not grant` };
    }

    await store.completePendingView(view.id, client);
    const unlock = await store.grantUnlock({
      assetId: view.asset_id,
      channelId: view.channel_id,
      userId,
      policy,
      client,
    });

    return {
      ok: true,
      unlocked: true,
      unlockId: unlock.id,
      expiresAt: unlock.expires_at,
      state: event.state,
      revenueUsd: event.revenueUsd,
    };
  });

  if (result.unlocked) {
    await store.audit('unlock.granted', {
      assetId: view.asset_id, userId, providerId, connectionId, viewId: view.id,
      revenueUsd: event.revenueUsd,
    });
  } else if (!result.duplicate) {
    await store.audit('postback.no_grant', {
      providerId, connectionId, state: event.state, viewId: view.id,
    });
  }

  return result;
}

// ---------------------------------------------------------------------------
// Content access tokens — expiring, unforgeable, per-user
// ---------------------------------------------------------------------------

/**
 * A download URL is minted per unlock and expires. The storage key never leaves
 * the server, so a URL cannot be forwarded to someone else and reused — which is
 * the thing a plain file link (or a magnet URI) can never prevent.
 */
export function signAccessToken({ assetId, fileId, userId, ttlMs = DEFAULT_ACCESS_TTL_MS }) {
  const payload = {
    a: assetId, f: fileId, u: userId,
    exp: Date.now() + ttlMs,
    n: crypto.randomBytes(8).toString('hex'),
  };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac = crypto.createHmac('sha256', ACCESS_SECRET()).update(body).digest('base64url');
  return `${body}.${mac}`;
}

export function verifyAccessToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return { ok: false, reason: 'malformed token' };
  const [body, mac] = token.split('.');
  const expected = crypto.createHmac('sha256', ACCESS_SECRET()).update(body).digest('base64url');

  const a = Buffer.from(expected);
  const b = Buffer.from(mac);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false, reason: 'bad signature' };

  let payload;
  try { payload = JSON.parse(Buffer.from(body, 'base64url').toString()); }
  catch { return { ok: false, reason: 'unreadable payload' }; }

  if (Date.now() > payload.exp) return { ok: false, reason: 'token expired' };
  return { ok: true, payload };
}

/** Mint a short-lived download URL for an unlocked asset file. */
export function issueDownloadUrl({ assetId, file, userId, basePath }) {
  const token = signAccessToken({ assetId, fileId: file.id, userId });
  return `${basePath}/api/content/${assetId}/file/${file.id}?t=${encodeURIComponent(token)}`;
}

/**
 * A stream URL for a player.
 *
 * Ten minutes is right for a download — the request is one round trip. It is
 * WRONG for playback: a video seeks, and every seek is another request, so a
 * twenty-minute file would start 403-ing halfway through and look like a broken
 * player rather than an expired token. Streaming gets hours instead.
 *
 * That is not the weakening it looks like. The token was never the control: the
 * route also requires a session and checks that the token's `u` is the signed-in
 * account, so a forwarded URL is inert even while it is valid. Expiry is the
 * second lock, not the first.
 */
export const STREAM_TTL_MS = 4 * 60 * 60 * 1000;

export function issueStreamUrl({ assetId, file, userId, basePath }) {
  const token = signAccessToken({ assetId, fileId: file.id, userId, ttlMs: STREAM_TTL_MS });
  return `${basePath}/api/content/${assetId}/file/${file.id}/stream?t=${encodeURIComponent(token)}`;
}
