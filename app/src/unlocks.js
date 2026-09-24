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
import { availabilityFor, resolveCountry } from './geo.js';

const ACCESS_SECRET = () => readSecret('ACCESS_TOKEN_SECRET');
const DEFAULT_ACCESS_TTL_MS = 10 * 60 * 1000;

// ---------------------------------------------------------------------------
// Ad view session
// ---------------------------------------------------------------------------

/**
 * Step 1 — the browser starts an unlock. We mint a nonce and hand back the ad
 * config. Nothing is unlocked yet; this grants nothing.
 */
export async function startUnlock({ assetId, userId, providerId, personalised = false, country = null }) {
  const asset = await store.assetById(assetId);
  if (!asset) return { ok: false, error: 'asset not found' };

  /**
   * The refusal comes before anything else, and nobody is exempt.
   *
   * A country rule and a file's own state are both statements that the unlock
   * does not exist here: showing an ad for a file whose bytes are then refused
   * would spend the viewer's attention on nothing, which is the one thing this
   * platform cannot do. The owner and an operator are not exempt either — they
   * can read and manage the file from the dashboard, but an unlock row granted
   * to an operator would be a way around the rule they are meant to be applying.
   */
  const channelBlock = await store.channelCountryBlock(asset.channel_id, country);
  const assetRule = country ? (await store.countryRulesFor([asset.id], country))[0] ?? null : null;
  const availability = availabilityFor({
    assetState: asset.moderation_state,
    resolved: resolveCountry({ assetRule, channelBlock }),
  });
  if (!availability.unlockable) {
    return {
      ok: false,
      country,
      reason: availability.reason,
      // The same word under the name every other refusal uses, so a client has
      // one field to read instead of a different one per endpoint.
      unavailableFor: availability.reason,
      error: availability.reason === 'country'
        ? 'this file is not available in your country'
        : 'this file cannot be unlocked',
    };
  }

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

  const adRef = await store.adRefFor(userId);

  /**
   * What this person has already sat through counts.
   *
   * The ask lives in the attempt, not in the browser, so without the two lines
   * below a reload mid-ask created a SECOND attempt and the first credited view
   * vanished with it — the same person was asked for two more, having already
   * watched one. The attempt that comes back carries its OWN `required_ads`: the
   * promise the page printed when the person started, even if the seller has
   * edited the ask since.
   *
   * The sweep runs here because this is the only place these rows are made, and
   * because a resume must not reach back past its window: an attempt nobody
   * finished is what the sweep is for, and it is indexed for it.
   */
  await store.sweepStalePendingViews();
  const open = await store.openAttemptFor({ assetId, userId });

  const view = open || await store.createPendingView({
    nonce: crypto.randomBytes(16).toString('hex'),
    asset_id: assetId,
    channel_id: asset.channel_id,
    user_id: userId,
    connection_id: connection.id,
    provider_id: connection.provider_id,
    required_ads: policy.ads_required || 1,
    ad_min_seconds: policy.ad_min_seconds || 15,
  });
  const viewsRequired = Math.max(1, Number(view.required_ads) || 1);
  const viewsDone = Math.min(await store.completedViewsForPendingView(view.id), viewsRequired);

  return {
    ok: true,
    viewId: view.id,
    nonce: view.nonce,
    // Not decoration: it is the difference between "one of your views is already
    // banked" and "start from nothing", and the panel says one or the other.
    resumed: Boolean(open) && viewsDone > 0,
    viewsDone,
    // Handed to the client so it can render/watch. This is a *request*, not a
    // grant: nothing here is trusted when it comes back.
    adConfig: {
      providerId: view.provider_id,
      connectionId: view.connection_id,
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

/**
 * Status poll — the browser asks whether the postback has landed.
 *
 * `viewsDone` / `viewsRequired` are what make an ask of two or three honest: the
 * browser can tell "the first ad was credited, start the second" from "keep
 * waiting", and neither answer can grant anything. The client still cannot
 * complete a view; it can only learn how many the network has proved.
 */
export async function unlockStatus({ assetId, userId, viewId }) {
  const unlocked = await store.isUnlocked(assetId, userId);
  const view = viewId ? await store.pendingView(viewId) : null;
  const viewsDone = view ? await store.completedViewsForPendingView(view.id) : 0;
  const viewsRequired = Math.max(1, Number(view?.required_ads) || 1);
  return {
    unlocked,
    viewCompleted: Boolean(view?.completed) || unlocked,
    viewsDone: Math.min(viewsDone, viewsRequired),
    viewsRequired,
    viewId: view?.id ?? null,
  };
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
/**
 * Does an ad view still earn its unlock after the file stopped being live?
 *
 * Pure, and separate, because it is a promise about fairness that deserves a test
 * rather than a condition in the middle of a transaction: the viewer watched the
 * ad before anybody hid the file, so the network has already paid the creator and
 * refusing them access would punish them for the platform's timing. A view that
 * STARTS while the file is hidden gets nothing — the unlock button should not have
 * been there, and "should not have been there" is not a reason to hand over the
 * bytes.
 */
export function viewSurvivesHiding({ view, asset } = {}) {
  if (!asset || asset.status === 'live') return true;
  if (!view?.created_at || !asset.updated_at) return false;
  return new Date(view.created_at).getTime() < new Date(asset.updated_at).getTime();
}

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

  /**
   * A file that is no longer live does not release new access.
   *
   * This is the path a real ad actually goes through, so it is the one that
   * matters most: a report-hidden file whose page still offered "Watch 1 ad to
   * unlock" would grant a full unlock, watermark and all, for content no person
   * had yet decided was allowed to be here.
   *
   * One exception, and it is about fairness rather than moderation: if the view
   * STARTED before the file was hidden, the ad has already been watched and the
   * network has already paid the creator. Refusing that grant would punish the
   * viewer for the platform's timing, so the comparison is against the view's own
   * `created_at`. `updated_at` is when the hide was written.
   */
  const asset = await store.assetById(view.asset_id);
  if (!viewSurvivesHiding({ view, asset })) {
    await store.audit('postback.no_grant', {
      providerId, connectionId, viewId: view.id, assetId: view.asset_id,
      state: event.state, reason: 'file is not live',
    });
    return { ok: true, unlocked: false, state: event.state, reason: 'the file is not live' };
  }

  // (3) claim + count + grant, atomically.
  const result = await store.withTransaction(async (client) => {
    // The attempt is locked before anything is counted. The decision below is a
    // read-then-act on the number of deliveries, and without the lock two
    // postbacks arriving together can each count one view and both decline to
    // release the file — which would cost the viewer a third ad on a file that
    // asked for two. Locking the attempt (not the delivery) is locking the thing
    // being decided.
    const attempt = await store.lockPendingView(view.id, client);

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
      // Which attempt this delivery belongs to, so the count below can find it.
      pending_view_id: view.id,
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

    // (5) the attempt's own ask, not the policy's — they are the same number at
    // the moment the attempt starts, and the attempt's is the one the page
    // printed. A seller raising the ask mid-watch must not change what this
    // person was told, in either direction.
    if (!attempt) {
      return {
        ok: true, unlocked: false, state: event.state,
        reason: 'the unlock attempt expired before this view arrived',
      };
    }
    const viewsRequired = Math.max(1, Number(attempt.required_ads) || 1);
    const viewsDone = await store.completedViewsForPendingView(view.id, client);

    // (6) fewer views than the ask: the delivery is recorded, the attempt stays
    // OPEN, and nothing is released yet. The attempt stays open on purpose — the
    // next delivery has to find it, and the browser polls its progress to know
    // whether to start the next ad or to keep waiting.
    if (viewsDone < viewsRequired) {
      return {
        ok: true, unlocked: false, state: event.state,
        viewsDone, viewsRequired,
        reason: `view ${viewsDone} of ${viewsRequired} credited`,
      };
    }

    await store.completePendingView(view.id, client);
    const unlock = await store.grantUnlock({
      assetId: view.asset_id,
      channelId: view.channel_id,
      userId,
      policy,
      client,
      // What the unlock actually cost the person. `unlocks.ads_completed` has
      // existed since the first migration and never carried the real number —
      // while one view was enough, the number was always 1.
      adsCompleted: viewsDone,
    });

    return {
      ok: true,
      unlocked: true,
      unlockId: unlock.id,
      expiresAt: unlock.expires_at,
      state: event.state,
      revenueUsd: event.revenueUsd,
      viewsDone,
      viewsRequired,
    };
  });

  if (result.unlocked) {
    await store.audit(
      'unlock.granted',
      {
        assetId: view.asset_id, userId, providerId, connectionId, viewId: view.id,
        revenueUsd: event.revenueUsd, views: result.viewsDone ?? undefined,
      },
      // The third argument, not a key in the meta: a row that names a person and
      // cannot be attributed to one is exactly what migration 0019 exists to
      // clean up, and the audit tests assert no new row is written that way.
      { actorId: userId, subjectType: 'asset', subjectId: view.asset_id },
    );
  } else if (result.viewsDone !== undefined && result.viewsDone < result.viewsRequired) {
    // Progress, not failure — the distinction matters because the seller's
    // evidence page reads these rows, and a counted view logged as a refusal
    // would report an ad that ran and paid as an ad that never arrived.
    await store.audit('postback.view_counted', {
      providerId, connectionId, viewId: view.id,
      viewsDone: result.viewsDone, viewsRequired: result.viewsRequired,
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
