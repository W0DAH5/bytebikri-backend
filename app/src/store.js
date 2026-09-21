/**
 * Storage layer — PostgreSQL.
 *
 * One implementation, not two. The in-memory version was replaced rather than
 * kept alongside: a second implementation behind the same interface is a
 * divergence waiting to happen, and the tests would have run against the copy
 * that production never executes.
 *
 * Files still go through a `storage` adapter (local disk now, the media API
 * later). Nothing outside this file knows where bytes live.
 */
import { randomUUID, randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { one, many, scalar, query, withTransaction, isUniqueViolation } from './db.js';

import { rentPeriod, annualRentNpr, rentWorking } from './billing.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Grace after a subscription period ends: features stay on, nothing is deleted. */
const GRACE_DAYS = 30;
const UPLOAD_DIR = path.resolve(__dirname, '../.data/uploads');

export const now = () => new Date();
export const id = () => randomUUID();
export const orderCode = (n = 6) =>
  randomBytes(4).toString('base64url').slice(0, n).toUpperCase();

// ---------------------------------------------------------------------------
// File storage adapter — replace with the media API later.
// ---------------------------------------------------------------------------
/**
 * Storage adapter.
 *
 * Two namespaces, because the files have opposite visibility. `private` keys
 * are gated content; they are only ever handed out through the download route
 * after an unlock is checked. `public` keys are covers and banners — the shop
 * window — and are served straight from /media with no token, which is the
 * point of a cover image.
 *
 * The namespace is part of the KEY, so a public route can never be coaxed into
 * reading private content: it checks the prefix before it touches the disk.
 */
const KEY_RE = /^[a-z]+\/[0-9a-f-]{36}\.[a-z0-9]{1,5}$/i;

export const storage = {
  async put(buffer, filename, { namespace = 'private' } = {}) {
    if (!/^[a-z]+$/.test(namespace)) throw new Error('bad storage namespace');
    const ext = (path.extname(filename || '') || '').toLowerCase().replace(/[^.a-z0-9]/g, '');
    await fs.mkdir(path.join(UPLOAD_DIR, namespace), { recursive: true });
    const key = `${namespace}/${id()}${ext}`;
    await fs.writeFile(path.join(UPLOAD_DIR, key), buffer);
    return key;
  },

  /**
   * Keys reach here from a URL, so the shape is checked before the path is
   * built. Without this, `../../etc/passwd` is a valid key on a filesystem
   * join — and the check has to be an allowlist, not a scan for '..', because
   * a scan misses encodings and absolute paths.
   */
  async get(key) {
    if (!KEY_RE.test(String(key || ''))) throw new Error('bad storage key');
    return fs.readFile(path.join(UPLOAD_DIR, key));
  },

  async exists(key) {
    if (!KEY_RE.test(String(key || ''))) return false;
    try { await fs.access(path.join(UPLOAD_DIR, key)); return true; } catch { return false; }
  },
};

// ---------------------------------------------------------------------------
// Plans. Capabilities are data — adding `ad_free` later is an INSERT, not a
// migration. Nothing here may gate the ability to EARN.
// ---------------------------------------------------------------------------
export const PLANS = {
  free: {
    code: 'free', name: 'Free', priceNpr: 0, periodMonths: 12,
    capabilities: {
      max_assets: 20, slot_count: 3, can_theme: false, custom_sections: 0,
      remove_footer: false, marketplace_listed: false, analytics_level: 'basic',
      verified_badge: false, featured_eligible: false, ad_free: false,
    },
  },
  store: {
    code: 'store', name: 'Store', priceNpr: 999, periodMonths: 12,
    capabilities: {
      max_assets: 200, slot_count: 5, can_theme: true, custom_sections: 3,
      // Explore listing, which is what the first paid tier buys. Featured
      // placement stays Pro-only — capacity and placement are the upsell, not
      // being found at all. See migration 0014.
      remove_footer: true, marketplace_listed: true, analytics_level: 'sources',
      verified_badge: true, featured_eligible: false, ad_free: false,
    },
  },
  pro: {
    code: 'pro', name: 'Pro', priceNpr: 2499, periodMonths: 12,
    capabilities: {
      max_assets: -1, slot_count: 8, can_theme: true, custom_sections: -1,
      remove_footer: true, marketplace_listed: true, analytics_level: 'full',
      verified_badge: true, featured_eligible: true, ad_free: false,
    },
  },
};

export const SLOT_DEFS = [
  { key: 'top_leaderboard', label: 'Top of store', rank: 1, formats: ['display'], max_height_px: 250, surfaces: ['web', 'app'], active: true },
  { key: 'in_content_1', label: 'In content (first)', rank: 2, formats: ['display', 'native'], max_height_px: 280, surfaces: ['web'], active: true },
  { key: 'sidebar_sticky', label: 'Sidebar', rank: 3, formats: ['display'], max_height_px: 600, surfaces: ['web'], active: true },
  { key: 'in_content_2', label: 'In content (second)', rank: 4, formats: ['display', 'native'], max_height_px: 280, surfaces: ['web'], active: true },
  { key: 'footer_native', label: 'Footer', rank: 5, formats: ['native', 'display'], max_height_px: 250, surfaces: ['web', 'app'], active: true },
];

// ---------------------------------------------------------------------------
// Row -> object mapping. The database is snake_case; so are the callers, so
// most rows pass through untouched. Only dates and numerics need coercing.
// ---------------------------------------------------------------------------
const pgNum = (v) => (v === null || v === undefined ? v : Number(v));

// Guards a uuid parameter before it reaches Postgres. A malformed id in a URL is
// attacker-controlled input, and letting the driver throw turns a 404 into a 500
// — which a webhook sender reads as "retry me".
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ===========================================================================
// Store
// ===========================================================================
export const store = {
  // A transaction handle, for the engine. Anything that must be atomic
  // composes through this rather than being spread across three methods that
  // each commit independently.
  withTransaction,
  query, one, many, scalar,

  // ---- users (profiles) --------------------------------------------------
  async createUser({ email, displayName }) {
    const normalized = String(email).trim().toLowerCase();
    const row = await one(
      `insert into profiles (email, display_name)
       values ($1, $2)
       on conflict (email) do update set email = excluded.email
       returning *`,
      [normalized, displayName || normalized.split('@')[0]],
    );
    return row;
  },
  async userByEmail(email) {
    return one('select * from profiles where email = $1', [String(email).trim().toLowerCase()]);
  },
  async userById(userId) {
    return one('select * from profiles where id = $1', [userId]);
  },
  /** Resolve-or-create. There is no signup flow yet, so first sight IS signup. */
  async userByEmailOrCreate(email) {
    const normalized = String(email).trim().toLowerCase();
    const existing = await one('select * from profiles where email = $1', [normalized]);
    if (existing) return existing;
    return this.createUser({ email: normalized });
  },

  // ---- channels ----------------------------------------------------------
  async createChannel({ ownerId, slug, name, tagline, listingMode = 'storefront', bannerUrl = null }) {
    try {
      return await one(
        `insert into channels (owner_id, slug, name, tagline, listing_mode, moderation_state, banner_url)
         values ($1, $2, $3, $4, $5, 'approved', $6)
         returning *`,
        [ownerId, slug, name, tagline || '', listingMode, bannerUrl],
      );
    } catch (err) {
      if (isUniqueViolation(err)) throw new Error('slug already taken');
      throw err;
    }
  },

  // Plan + subscription live in separate tables; every channel read joins them so
  // callers keep seeing one object.
  async channelBySlug(slug) {
    return one(
      `select c.*,
              coalesce(s.plan_code, 'free')           as plan_code,
              s.status                            as subscription_status,
              s.period_end                        as subscription_end,
              s.grace_until                       as subscription_grace
         from channels c
         left join lateral (
           select sub.plan_code, sub.status, sub.period_end, sub.grace_until
             from subscriptions sub
            where sub.channel_id = c.id
              and sub.status in ('active','grace')
            order by sub.created_at desc limit 1
         ) s on true
        where c.slug = $1`,
      [slug],
    );
  },
  async channelById(cid) {
    return one(
      `select c.*,
              coalesce(s.plan_code, 'free') as plan_code,
              s.status as subscription_status,
              s.period_end as subscription_end,
              s.grace_until as subscription_grace
         from channels c
         left join lateral (
           select sub.plan_code, sub.status, sub.period_end, sub.grace_until
             from subscriptions sub
            where sub.channel_id = c.id
              and sub.status in ('active','grace')
            order by sub.created_at desc limit 1
         ) s on true
        where c.id = $1`,
      [cid],
    );
  },
  channels({ listedOnly = false } = {}) {
    return many(
      `select c.*,
              coalesce(s.plan_code, 'free') as plan_code,
              s.status as subscription_status,
              s.period_end as subscription_end
         from channels c
         left join lateral (
           select sub.plan_code, sub.status, sub.period_end
             from subscriptions sub
            where sub.channel_id = c.id
              and sub.status in ('active','grace')
            order by sub.created_at desc limit 1
         ) s on true
        where c.moderation_state <> 'removed'
          ${listedOnly ? "and c.listing_mode = 'marketplace'" : ''}
        order by c.created_at`,
    );
  },
  channelsOf(ownerId) {
    return many('select * from channels where owner_id = $1 order by created_at', [ownerId]);
  },

  /** Pure function, not a query — plans are constants and capabilities are data. */
  /**
   * Which plan a channel is ACTUALLY on, right now.
   *
   * Not simply the plan on its newest subscription row. Three states must not
   * grant paid capability:
   *
   *   pending_payment — the upgrade has been requested but no money has been
   *     matched. Honouring the requested plan here would give the product away
   *     to anyone who can submit a form.
   *   expired — the period ended and the grace window has run out.
   *   refunded / cancelled — deliberately ended.
   *
   * The grace window is CALCULATED, not stored: thirty days after the period
   * ends, features keep working and nothing is deleted. A cron job that has not
   * run must never be the reason a paying seller loses their storefront, so the
   * rule lives in a pure function rather than in a scheduled task.
   */
  effectivePlanCode(c) {
    const code = c?.plan_code;
    if (!code || code === 'free') return 'free';
    // Read explicitly, with no fallback to "well, it has an end date". A row
    // with an end date and a cancelled status granted Pro before this line was
    // written: the query aliases the status from the subscription, so a missing
    // one means the caller did not read it — not that the plan is running.
    const status = c?.subscription_status ?? null;
    const end = c.subscription_end ? new Date(c.subscription_end) : null;
    if (status !== 'active' && status !== 'grace') return 'free';
    if (status === 'grace') return code;
    if (!end || end > now()) return code;
    return GRACE_DAYS && end.getTime() + GRACE_DAYS * 86400000 > now() ? code : 'free';
  },

  /** Days of grace after a period ends. A seller's bad week is not a data loss. */
  plan(c) { return PLANS[this.effectivePlanCode(c)] ?? PLANS.free; },

  upgradeQuote(channel, newPlanCode) {
    const cur = this.plan(channel);
    const next = PLANS[newPlanCode];
    if (!next || next.priceNpr <= cur.priceNpr) return null;
    const end = channel?.subscription_end ? new Date(channel.subscription_end) : null;
    const daysLeft = end ? Math.max(0, Math.ceil((end - now()) / 86400000)) : 0;
    const full = next.priceNpr - cur.priceNpr;
    // Nothing is running, so nothing can be pro-rated: the seller is buying a
    // whole period. Multiplying by 0/365 would bill NPR 0 for a first purchase —
    // and `upgradeExplanation` promises "the full difference" in writing, so the
    // two have to agree.
    const amount = daysLeft > 0 ? Math.round(full * (daysLeft / 365)) : full;
    return { from: cur, to: next, daysLeft, fullDifference: full, amountNpr: amount };
  },

  /**
   * Pro-rated upgrade. Cycle end is unchanged, so the next charge is predictable.
   *
   * `plans.code` is the primary key — there is no plans.id — and subscriptions
   * reference it as plan_code. The first version of this queried `plans.id` and
   * the app could not seed.
   */
  async applyUpgrade(channel, planCode) {
    return withTransaction(async (c) => {
      const exists = await c.query('select 1 from plans where code = $1', [planCode]);
      if (!exists.rowCount) throw new Error(`unknown plan ${planCode}`);
      await c.query(
        `insert into subscriptions (channel_id, plan_code, status, period_end, period_start)
         values ($1, $2, 'active', coalesce($3::timestamptz, now() + interval '1 year'), now())
         on conflict (channel_id) do update
           set plan_code = excluded.plan_code, status = 'active'`,
        [channel.id, planCode, channel.subscription_end],
      );
      return this.channelById(channel.id);
    });
  },

  // ---- assets ------------------------------------------------------------
  async createAsset({ channelId, title, slug, description, unlockMode = 'ad_gated', coverUrl = null }) {
    return withTransaction(async (c) => {
      const { rows } = await c.query(
        `insert into assets (channel_id, title, slug, description, kind, unlock_mode, status, moderation_state, cover_url)
         values ($1, $2, $3, $4, 'digital', $5, 'live', 'approved', $6)
         returning *`,
        [channelId, title, slug || slugify(title), description || '', unlockMode, coverUrl],
      );
      const asset = rows[0];
      await c.query(
        `insert into asset_unlock_policy (asset_id, mode, ads_required, ad_min_seconds, unlock_hours, max_unlocks_per_day)
         values ($1, $2, 1, 15, 24, 20)
         on conflict (asset_id) do nothing`,
        [asset.id, unlockMode],
      );
      return asset;
    });
  },
  async assetById(aid) {
    if (!UUID_RE.test(String(aid || ''))) return null;
    return one('select * from assets where id = $1', [aid]);
  },
  async assetBySlug(channelId, slug) {
    return one('select * from assets where channel_id = $1 and slug = $2', [channelId, slug]);
  },
  assetsOf(channelId) {
    return many(
      `select * from assets where channel_id = $1 and status = 'live' order by created_at desc`,
      [channelId],
    );
  },
  async unlockPolicy(assetId) {
    return one('select * from asset_unlock_policy where asset_id = $1', [assetId]);
  },
  async setAdMinSeconds(assetId, seconds) {
    return one(
      'update asset_unlock_policy set ad_min_seconds = $2 where asset_id = $1 returning *',
      [assetId, seconds],
    );
  },

  async addFile({ assetId, storageKey, filename, mimeType, sizeBytes, checksum }) {
    return one(
      `insert into asset_files (asset_id, storage_key, filename, mime_type, size_bytes, checksum, version, sort_order)
       values ($1, $2, $3, $4, $5, $6, 1, 0)
       returning *`,
      [assetId, storageKey, filename, mimeType, sizeBytes, checksum],
    );
  },
  filesOf(assetId) {
    return many('select * from asset_files where asset_id = $1 order by sort_order', [assetId]);
  },
  async fileById(fid) {
    return one('select * from asset_files where id = $1', [fid]);
  },

  // ---- ad connections ----------------------------------------------------
  async createConnection({ channelId, providerId, slotKeys = [], onboarding = 'signup_redirect', payoutVerdict, secret, callbackBaseUrl }) {
    const base = (callbackBaseUrl || process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '') || null;
    const { rows } = await query(
      `insert into ad_connections
         (channel_id, provider_id, status, onboarding, credential_ref,
          callback_secret, callback_base_url, payout_verdict, slot_keys)
       values ($1, $2, 'active', $3, $4, $5, $6, $7, $8)
       returning *`,
      [
        channelId, providerId, onboarding,
        // Opaque handle only. A publisher id must never be stored in clear.
        `secret://${channelId}/${providerId}/${id().slice(0, 8)}`,
        // Per connection, because two channels can both use BitLabs with two
        // different app secrets. In production this is a pointer into a secrets
        // manager; literal here only because this build has no external services.
        secret ?? null,
        base,
        payoutVerdict ?? null,
        slotKeys,
      ],
    );
    return rows[0];
  },
  connectionsOf(channelId) {
    return many(
      `select * from ad_connections where channel_id = $1 and status = 'active' order by connected_at`,
      [channelId],
    );
  },
  async connectionById(cid) {
    if (!UUID_RE.test(String(cid || ''))) return null;
    return one('select * from ad_connections where id = $1', [cid]);
  },
  /** The active connection a postback belongs to. Revoked connections refuse. */
  async activeConnection(connectionId, providerId) {
    if (!connectionId) return null;
    // A non-UUID here is a request from the open internet, not an error. Without
    // this guard Postgres rejects the cast and the route answers 500 — which
    // tells a provider to RETRY, forever, on a request that can never succeed.
    if (!UUID_RE.test(String(connectionId))) return null;
    const row = await one(
      `select * from ad_connections where id = $1 and status = 'active'`,
      [connectionId],
    );
    if (!row) return null;
    if (providerId && row.provider_id !== providerId) return null;
    return row;
  },
  async revokeConnection(cid) {
    return one(
      `update ad_connections set status = 'revoked', revoked_at = now() where id = $1 returning *`,
      [cid],
    );
  },
  async setSlotAssignment(channelId, slotKey, connectionId) {
    const row = await one(
      `update ad_connections
          set slot_keys = (select array_agg(distinct k) from unnest(slot_keys || $3::text[]) k)
        where id = $1 and channel_id = $2
        returning *`,
      [connectionId, channelId, [slotKey]],
    );
    if (!row) throw new Error('connection does not belong to channel');
    return row;
  },

  // ---- opaque ad-network references --------------------------------------
  /**
   * The handle we send an ad network instead of a user id.
   *
   * Stable per user so the network's own anti-fraud works across views, and
   * meaningless outside this database. ON CONFLICT makes concurrent calls for
   * the same user converge on one ref instead of racing to create two.
   */
  async adRefFor(userId) {
    const row = await one(
      `insert into ad_refs (user_id) values ($1)
       on conflict (user_id) do update set user_id = excluded.user_id
       returning ref`,
      [userId],
    );
    return row.ref;
  },
  async userByAdRef(ref) {
    return scalar('select user_id from ad_refs where ref = $1', [ref]);
  },

  /** Open (uncompleted) views for a provider+user, newest first. */
  openViewsFor(providerId, userId) {
    return many(
      `select * from pending_views
        where completed = false and provider_id = $1 and user_id = $2
        order by created_at desc`,
      [providerId, userId],
    );
  },

  // ---- unlocks -----------------------------------------------------------
  async unlockFor(assetId, userId) {
    if (!UUID_RE.test(String(assetId || ''))) return null;
    return one(
      `select * from unlocks
        where asset_id = $1 and user_id = $2 and revoked_at is null
          and (expires_at is null or expires_at > now())`,
      [assetId, userId],
    );
  },
  async isUnlocked(assetId, userId) {
    // An id that cannot be a uuid cannot be unlocked. Checking here rather than
    // letting Postgres reject the cast keeps a malformed query string a 400-ish
    // answer instead of a 500 — the same fix the postback needed.
    if (!UUID_RE.test(String(assetId || ''))) return false;
    const n = await scalar(
      `select count(*)::int from unlocks
        where asset_id = $1 and user_id = $2 and revoked_at is null
          and (expires_at is null or expires_at > now())`,
      [assetId, userId],
    );
    return n > 0;
  },

  /**
   * Grant (or extend) an unlock. Idempotent by construction.
   *
   * ON CONFLICT DO UPDATE rather than read-then-write. The previous version did
   * `find existing; if (existing) existing.ads_completed += n`. Under two
   * concurrent postbacks both read the same count and one increment is lost.
   * `ads_completed = unlocks.ads_completed + excluded.ads_completed` does the
   * arithmetic in the database, where it is atomic.
   */
  async grantUnlock({ assetId, channelId, userId, method = 'rewarded_ad', adsCompleted = 1, policy, client }) {
    const hours = policy?.unlock_hours ?? 24;
    const expires = hours > 0 ? new Date(Date.now() + hours * 3600_000) : null;
    const run = (client || { query }).query.bind(client || { query });
    const { rows } = await run(
      `insert into unlocks (asset_id, channel_id, user_id, method, ads_completed, expires_at)
       values ($1, $2, $3, $4, $5, $6)
       on conflict (asset_id, user_id) do update
         set granted_at     = now(),
             expires_at     = excluded.expires_at,
             ads_completed  = unlocks.ads_completed + excluded.ads_completed,
             revoked_at     = null,
             revoked_reason = null
       returning *`,
      [assetId, channelId, userId, method, adsCompleted, expires],
    );
    return rows[0];
  },
  unlocksOfChannel(channelId) {
    return many(
      `select u.*, a.title as asset_title from unlocks u
         join assets a on a.id = u.asset_id
        where u.channel_id = $1 order by u.granted_at desc`,
      [channelId],
    );
  },

  // ---- pending ad views (awaiting a signed postback) ----------------------
  async createPendingView(v) {
    return one(
      `insert into pending_views (nonce, asset_id, channel_id, user_id, connection_id, provider_id, required_ads, ad_min_seconds)
       values ($1, $2, $3, $4, $5, $6, $7, $8)
       returning *`,
      [v.nonce, v.asset_id, v.channel_id, v.user_id, v.connection_id, v.provider_id,
       v.required_ads ?? 1, v.ad_min_seconds ?? 15],
    );
  },
  async pendingView(viewId) {
    if (!UUID_RE.test(String(viewId || ''))) return null;
    return one('select * from pending_views where id = $1', [viewId]);
  },
  async completePendingView(viewId, client) {
    const run = (client || { query }).query.bind(client || { query });
    const { rows } = await run(
      `update pending_views set completed = true, completed_at = now()
        where id = $1 returning *`,
      [viewId],
    );
    return rows[0] ?? null;
  },
  /**
   * Views the user started but never finished. Each one is a row, and minting
   * is unauthenticated-ish by nature, so this bounds the garbage.
   */
  async sweepStalePendingViews({ olderThanHours = 6 } = {}) {
    const n = await scalar(
      `with gone as (
         delete from pending_views
          where completed = false and created_at < now() - ($1 || ' hours')::interval
          returning 1)
       select count(*)::int from gone`,
      [String(olderThanHours)],
    );
    return n;
  },

  // ---- ad view events ----------------------------------------------------
  /**
   * Claim a completed view.
   *
   * THE ATOMIC OPERATION the whole postback path rests on. Insert-first, and let
   * the unique index decide the race. The previous version did
   * `if (adViews().some(...externalId)) return duplicate` and then inserted —
   * check-then-act. Two concurrent deliveries both pass the check and both
   * proceed, which is precisely what a provider retry produces.
   *
   * Returns { claimed: false } when another delivery already owns this event.
   * Must be called inside the same transaction as the grant.
   */
  async claimAdView(e, client) {
    const run = (client || { query }).query.bind(client || { query });
    const { rows } = await run(
      `insert into ad_view_events
         (channel_id, user_id, asset_id, connection_id, provider_id, external_id,
          kind, state, completed, duration_sec, revenue_usd, meta, signature_ok)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, true)
       on conflict (connection_id, external_id) do nothing
       returning *`,
      [
        e.channel_id, e.user_id, e.asset_id, e.connection_id, e.provider_id, e.external_id ?? null,
        e.kind ?? 'rewarded', e.state ?? 'complete', e.completed ?? false,
        e.duration_sec ?? null, e.revenue_usd ?? null, JSON.stringify(e.meta ?? {}),
      ],
    );
    // No row returned means the unique index rejected it: already claimed.
    if (!rows.length) return { claimed: false };
    return { claimed: true, event: rows[0] };
  },
  adViews({ channelId, limit = 500 } = {}) {
    return many(
      `select * from ad_view_events
        where ($1::uuid is null or channel_id = $1)
        order by created_at desc limit $2`,
      [channelId ?? null, limit],
    );
  },
  async adViewsOfUser(userId, sinceHours = 24) {
    return many(
      `select * from ad_view_events
        where user_id = $1 and created_at > now() - ($2 || ' hours')::interval`,
      [userId, String(sinceHours)],
    );
  },
  /** Completed views for one asset by one user in the last 24h — the daily cap. */
  async completedViewsToday(assetId, userId) {
    return scalar(
      `select count(*)::int from ad_view_events
        where asset_id = $1 and user_id = $2 and completed = true
          and created_at > now() - interval '24 hours'`,
      [assetId, userId],
    );
  },

  // ---- traffic -----------------------------------------------------------
  /**
   * Upsert with an atomic increment. `pageviews = pageviews + 1` in SQL, not
   * read-modify-write in JS.
   */
  /**
   * The schema keeps `views`, `web_views` and `app_views` separately — which is
   * better than one counter, because a native-app page view and a web one have
   * different advertiser value and the traffic band bills on them differently.
   * A web hit increments both the total and the web column.
   */
  async bumpPageView(channelId, surface = 'web') {
    await query(
      `insert into page_view_daily (channel_id, day, views, web_views, unique_visitors)
       values ($1, current_date, 1, $2, 1)
       on conflict (channel_id, day) do update
         set views     = page_view_daily.views + 1,
             web_views = page_view_daily.web_views + $2,
             app_views = page_view_daily.app_views + $3`,
      [channelId, surface === 'web' ? 1 : 0, surface === 'app' ? 1 : 0],
    );
  },
  async pageviews30d(channelId) {
    return pgNum(await scalar(
      `select coalesce(sum(views), 0)::bigint from page_view_daily
        where channel_id = $1 and day > current_date - 30`,
      [channelId],
    ));
  },

  // ---- plan payments (money INTO bytebikri — being paid, not holding) -----
  /**
   * A payment attaches to a SUBSCRIPTION, not to a channel. That is the schema's
   * modelling and it is right: the subscription is what the payment buys, and it
   * carries the period the money covers.
   */
  async recordPlanPayment({ channelId, amountNpr, txnReference, method = 'esewa', payerName, payerNumber }) {
    if (String(txnReference || '').trim().length < 4) return null;
    return one(
      `insert into plan_payments (subscription_id, amount_npr, txn_reference, method, payer_name, payer_number)
       select s.id, $2, $3, $4, $5, $6
         from subscriptions s
        where s.channel_id = $1
          and s.pending_plan_code is not null
       returning *`,
      [channelId, amountNpr, txnReference, method, payerName ?? null, payerNumber ?? null],
    );
  },
  planPayments() {
    return many('select * from plan_payments order by created_at desc');
  },

  // ---- channel settings ---------------------------------------------------
  /**
   * Update what a seller controls about their store.
   *
   * An allowlist of columns rather than a spread of the request body: a
   * `set ${keys}` built from user input is how a form eventually writes
   * `moderation_state = 'approved'` on itself, and no amount of route-level
   * validation makes that safe to have in the codebase.
   *
   * `listing_mode` is deliberately NOT gated here. Whether a store MAY be
   * listed is a plan capability, and the capability is checked at the route
   * where the plan is known — the store layer has no business knowing about
   * plans, and a check in two places is a check that will disagree.
   */
  async updateChannel(channelId, patch = {}) {
    const allowed = {
      name: (v) => String(v).trim().slice(0, 120),
      tagline: (v) => String(v).trim().slice(0, 200),
      about: (v) => String(v).trim().slice(0, 4000),
      channel_contact: (v) => String(v).trim().slice(0, 320),
      banner_url: (v) => (v === null ? null : String(v)),
      avatar_url: (v) => (v === null ? null : String(v)),
      listing_mode: (v) => (v === 'marketplace' ? 'marketplace' : 'storefront'),
      ads_enabled: (v) => v === true || v === 'on' || v === 'true',
      sells_digital: (v) => v === true || v === 'on' || v === 'true',
      sells_physical: (v) => v === true || v === 'on' || v === 'true',
    };
    const sets = [];
    const values = [channelId];
    for (const [key, coerce] of Object.entries(allowed)) {
      if (!(key in patch)) continue;
      if ((key === 'name' || key === 'tagline') && !String(patch[key] || '').trim()) continue;
      values.push(coerce(patch[key]));
      sets.push(`${key} = $${values.length}`);
    }
    if (!sets.length) return this.channelById(channelId);
    return one(
      `update channels set ${sets.join(', ')}, updated_at = now() where id = $1 returning *`,
      values,
    );
  },

  /**
   * The seller's kill switch.
   *
   * `ads_enabled = false` stops the channel's ad slots from resolving, without
   * touching anything else: the storefront, the unlocks and the files all keep
   * working. A seller who wants ads off for a week should not have to unpublish.
   */
  async setAdsEnabled(channelId, enabled) {
    return one('update channels set ads_enabled = $2, updated_at = now() where id = $1 returning *',
      [channelId, enabled]);
  },

  async updateAsset(assetId, patch = {}) {
    const allowed = {
      title: (v) => String(v).trim().slice(0, 200),
      description: (v) => String(v).trim().slice(0, 2000),
      unlock_mode: (v) => (v === 'open' ? 'open' : 'ad_gated'),
      cover_url: (v) => (v === null ? null : String(v)),
      // Only live <-> paused. 'removed' is the moderation decision and
      // 'draft'/'pending_review' belong to the publish flow; a settings form
      // must not be able to reach either.
      status: (v) => (v === 'paused' ? 'paused' : 'live'),
    };
    const sets = [];
    const values = [assetId];
    for (const [key, coerce] of Object.entries(allowed)) {
      if (!(key in patch)) continue;
      if (key === 'title' && !String(patch.title || '').trim()) continue;
      values.push(coerce(patch[key]));
      sets.push(`${key} = $${values.length}`);
    }
    if (!sets.length) return this.assetById(assetId);
    return one(
      `update assets set ${sets.join(', ')}, updated_at = now() where id = $1 returning *`,
      values,
    );
  },

  /**
   * Unlock policy, clamped to what the route is willing to promise.
   *
   * The clamp is here rather than in the form because the form is a
   * suggestion: a seller can post `adMinSeconds: 0`, and a zero-second ad is a
   * view a network will not credit, so the creator would be handing files over
   * for nothing and blaming us for the revenue.
   */
  async setUnlockPolicy(assetId, { ads_required, ad_min_seconds, unlock_hours } = {}) {
    const int = (v, lo, hi, fallback) => {
      const n = Number(v);
      if (!Number.isFinite(n)) return fallback;
      return Math.min(hi, Math.max(lo, Math.round(n)));
    };
    return one(
      `update asset_unlock_policy
          set ads_required = $2, ad_min_seconds = $3, unlock_hours = $4
        where asset_id = $1
        returning *`,
      [
        assetId,
        int(ads_required, 1, 5, 1),
        int(ad_min_seconds, 5, 120, 15),
        int(unlock_hours, 1, 720, 24),
      ],
    );
  },

  /**
   * The money did not arrive, or arrived wrong.
   *
   * The request is dropped and the plan the seller already paid for is left
   * exactly as it was. A rejection is not a punishment, and the previous
   * behaviour — clearing the subscription — would have taken a paid plan away
   * because of a typo in a reference.
   */
  async rejectPlanPayment({ paymentId, actorId, reason }) {
    return withTransaction(async (c) => {
      const { rows } = await c.query(
        `update plan_payments
            set status = 'rejected', matched_by = $2, matched_at = now(), reject_reason = $3
          where id = $1 and status = 'submitted'
          returning *`,
        [paymentId, actorId, reason || null],
      );
      if (!rows.length) return null;
      await c.query(
        `update subscriptions
            set pending_plan_code = null, pending_since = null
          where id = $1 and pending_plan_code is not null`,
        [rows[0].subscription_id],
      );
      return rows[0];
    });
  },

  // ---- billing ------------------------------------------------------------
  async subscriptionOf(channelId) {
    return one(
      `select * from subscriptions where channel_id = $1 order by created_at desc limit 1`,
      [channelId],
    );
  },

  /**
   * Ask to move to a paid plan.
   *
   * The subscription row is created as `pending_payment`, NOT active. The
   * upgrade takes effect when an operator matches the money, which is the only
   * honest sequence when the rail is a manual transfer: activating on request
   * would give away the product to anyone who can fill in a form.
   *
   * The amount is recorded on the payment later, not here — but the quote is
   * recomputed server-side at that moment so a stale page cannot submit
   * yesterday's price.
   */
  /**
   * Ask for an upgrade. Creates a REQUEST — never an active subscription, and
   * never at the cost of the plan already paid for.
   *
   * The first version of this overwrote the subscription row, because the
   * schema allows one per channel. A seller who asked for Pro therefore dropped
   * to free until an operator matched the money, and the pro-rated amount
   * recomputed against Pro instead of Store — NPR 2,499 instead of NPR 1,500.
   * The request now lives in `pending_plan_code` (migration 0012) and grants
   * nothing; capability still follows `plan_code`, which only the operator moves.
   *
   * A free channel had no subscription row at all, so this creates one for the
   * free plan first: the row is the record of what is owed and what is paid, and
   * it has to exist before it can hold a request.
   */
  async requestUpgrade(channel, planCode) {
    return withTransaction(async (c) => {
      const plan = await c.query('select 1 from plans where code = $1', [planCode]);
      if (!plan.rowCount) throw new Error(`unknown plan ${planCode}`);

      const { rows } = await c.query(
        `insert into subscriptions (channel_id, plan_code, status, period_start, pending_plan_code, pending_since)
         values ($1, 'free', 'active', now(), $2, now())
         on conflict (channel_id) do update
           set pending_plan_code = excluded.pending_plan_code,
               pending_since     = now()
         returning *`,
        [channel.id, planCode],
      );
      return rows[0];
    });
  },

  /**
   * Payments for a channel, through the subscription they belong to.
   *
   * `plan_payments` has no channel_id — the schema attaches a payment to the
   * subscription it buys, which is correct. The dashboard used to filter
   * `store.planPayments()` by `p.channel_id`, a column that does not exist, so
   * every seller's payment history was silently empty.
   */
  planPaymentsOfChannel(channelId) {
    return many(
      `select pp.*, s.plan_code, s.status as subscription_status
         from plan_payments pp
         join subscriptions s on s.id = pp.subscription_id
        where s.channel_id = $1
        order by pp.created_at desc`,
      [channelId],
    );
  },

  /** Every pending payment, for the operator's matching queue. */
  unmatchedPayments({ limit = 100 } = {}) {
    return many(
      `select pp.*, coalesce(s.pending_plan_code, s.plan_code) as plan_code, s.period_end,
               c.slug as channel_slug, c.name as channel_name
         from plan_payments pp
         join subscriptions s on s.id = pp.subscription_id
         join channels c on c.id = s.channel_id
        where pp.status = 'submitted'
        order by pp.created_at
        limit $1`,
      [limit],
    );
  },

  /**
   * Confirm a plan payment and activate the subscription.
   *
   * Both writes in one transaction, because a payment marked matched with an
   * inactive subscription is a seller who has paid and has nothing.
   */
  async matchPlanPayment({ paymentId, actorId }) {
    return withTransaction(async (c) => {
      const { rows } = await c.query(
        `update plan_payments
            set status = 'matched', matched_by = $2, matched_at = now()
          where id = $1 and status = 'submitted'
          returning *`,
        [paymentId, actorId],
      );
      if (!rows.length) return null;

      /**
       * The plan moves. The renewal date does not.
       *
       * An upgrade is pro-rated to the end of the period already paid for, so
       * extending the period here would hand over days that were never charged
       * for; shortening it would take away days that were. Either way the next
       * charge would arrive on a date nobody agreed to. Only a channel with no
       * running period — a free store buying its first plan — starts a year.
       */
      await c.query(
        `update subscriptions
            set plan_code         = coalesce(pending_plan_code, plan_code),
                pending_plan_code = null,
                pending_since     = null,
                status            = 'active',
                grace_until       = null,
                period_start      = case when period_end > now() then period_start else now() end,
                period_end        = case when period_end > now() then period_end
                                         else now() + interval '1 year' end,
                verified_by       = $2,
                verified_at       = now()
          where id = $1`,
        [rows[0].subscription_id, actorId],
      );
      return rows[0];
    });
  },

  /**
   * Issue this period's rent invoice, if one is due.
   *
   * Idempotent through the schema's `unique (channel_id, period_start)` and
   * `on conflict do nothing`, so calling it on every dashboard view is safe and
   * is exactly what happens. No invoice is issued when the estimate has no
   * platform slot: a store below the three-slot floor is not taxed, and an
   * invoice for NPR 0 would be a bill pretending to be a policy.
   */
  async ensureRentInvoice({ channel, estimate, now = new Date() }) {
    const amountNpr = annualRentNpr(estimate);
    if (!amountNpr) return null;
    const period = rentPeriod(channel.created_at, now);
    await query(
      `insert into rent_invoices (channel_id, period_start, period_end, amount_npr, basis)
       values ($1, $2, $3, $4, $5)
       on conflict (channel_id, period_start) do nothing`,
      [channel.id, period.start, period.end, amountNpr, JSON.stringify(rentWorking(estimate, amountNpr))],
    );
    return one(
      'select * from rent_invoices where channel_id = $1 and period_start = $2',
      [channel.id, period.start],
    );
  },

  rentInvoicesOfChannel(channelId) {
    return many('select * from rent_invoices where channel_id = $1 order by period_start desc', [channelId]);
  },

  /** Every unpaid invoice, for the operator's queue. */
  openRentInvoices({ limit = 100 } = {}) {
    return many(
      `select r.*, c.slug as channel_slug, c.name as channel_name
         from rent_invoices r
         join channels c on c.id = r.channel_id
        where r.status in ('issued','submitted')
        order by r.submitted_at nulls last, r.created_at
        limit $1`,
      [limit],
    );
  },

  /**
   * A seller submits the reference for a transfer they have made.
   *
   * Guarded on the current status so a double-submit cannot rewrite a matched
   * invoice, and so a `paid` row cannot be re-opened by posting again.
   */
  async submitRentPayment({ invoiceId, channelId, method, txnReference, payerName, payerNumber }) {
    // The route checks this too, and the check is repeated here because a
    // reference is what the operator matches against a statement: "x" cannot be
    // matched, so accepting it creates a payment nobody can ever clear.
    if (String(txnReference || '').trim().length < 4) return null;
    return one(
      `update rent_invoices
          set status = 'submitted', method = $3, txn_reference = $4,
              payer_name = $5, payer_number = $6, submitted_at = now()
        where id = $1 and channel_id = $2 and status = 'issued'
        returning *`,
      [invoiceId, channelId, method, txnReference, payerName ?? null, payerNumber ?? null],
    );
  },

  async matchRentPayment({ invoiceId, actorId, note = null }) {
    return one(
      `update rent_invoices
          set status = 'paid', paid_at = now(), matched_by = $2, note = coalesce($3, note)
        where id = $1 and status in ('issued','submitted')
        returning *`,
      [invoiceId, actorId, note],
    );
  },

  // ---- reviews ------------------------------------------------------------
  /**
   * A review hangs off an UNLOCK, not off an asset.
   *
   * That is the schema's design (`reviews.unlock_id` is unique) and it is the
   * right one: it means a review can only be written by somebody who actually
   * got the file, it cannot be written twice, and a revoked unlock takes its
   * review with it. This method exists so the write path uses the same rule.
   */
  async addReview({ unlockId, assetId, channelId, buyerId, rating, body }) {
    const stars = Math.min(5, Math.max(1, Math.round(Number(rating) || 0)));
    if (!stars) return null;
    return one(
      `insert into reviews (unlock_id, asset_id, channel_id, buyer_id, rating, body)
       values ($1, $2, $3, $4, $5, $6)
       on conflict (unlock_id) do update
         set rating = excluded.rating, body = excluded.body
       returning *`,
      [unlockId, assetId, channelId, buyerId, stars, String(body || '').trim().slice(0, 2000) || null],
    );
  },

  reviewsOfAsset(assetId, { limit = 20 } = {}) {
    return many(
      `select r.*, p.display_name as buyer_name
         from reviews r join profiles p on p.id = r.buyer_id
        where r.asset_id = $1 and r.moderation_state = 'published' and r.body is not null
        order by r.created_at desc limit $2`,
      [assetId, limit],
    );
  },

  reviewStatsOfChannel(channelId) {
    return one(
      `select count(*)::int as count, coalesce(round(avg(rating)::numeric, 1), 0)::float as average
         from reviews
        where channel_id = $1 and moderation_state = 'published'`,
      [channelId],
    );
  },

  reviewStatsOfAsset(assetId) {
    return one(
      `select count(*)::int as count, coalesce(round(avg(rating)::numeric, 1), 0)::float as average
         from reviews where asset_id = $1 and moderation_state = 'published'`,
      [assetId],
    );
  },

  reviewsOfChannel(channelId, { limit = 50 } = {}) {
    return many(
      `select r.*, a.title as asset_title, a.slug as asset_slug, p.display_name as buyer_name
         from reviews r
         join assets a on a.id = r.asset_id
         join profiles p on p.id = r.buyer_id
        where r.channel_id = $1
        order by r.created_at desc limit $2`,
      [channelId, limit],
    );
  },

  /** The seller gets one reply. A second one replaces it rather than stacking. */
  async respondToReview({ reviewId, channelId, response }) {
    return one(
      `update reviews
          set seller_response = $3, seller_responded_at = now()
        where id = $1 and channel_id = $2
        returning *`,
      [reviewId, channelId, String(response || '').trim().slice(0, 2000)],
    );
  },

  // ---- search -------------------------------------------------------------
  /**
   * Search across stores and their files.
   *
   * Scoped to `listing_mode = 'marketplace'` on purpose: a store that chose its
   * own address is not published in a directory, and a search that surfaces it
   * would overrule the seller's own setting. Approved stores only, live assets
   * only — a search result that 404s is worse than no result.
   */
  async search(q, { limit = 24 } = {}) {
    const term = String(q || '').trim().slice(0, 80);
    if (term.length < 2) return { stores: [], assets: [] };
    const like = `%${term.replace(/[%_]/g, '')}%`;
    const [stores, assets] = await Promise.all([
      many(
        `select c.*, coalesce(s.plan_code, 'free') as plan_code,
                (select count(*)::int from assets a
                  where a.channel_id = c.id and a.status = 'live') as asset_count
           from channels c
           left join lateral (
             select sub.plan_code from subscriptions sub
              where sub.channel_id = c.id and sub.status in ('active','grace')
              order by sub.created_at desc limit 1
           ) s on true
          where c.listing_mode = 'marketplace'
            and c.moderation_state <> 'removed'
            and (c.name ilike $1 or c.tagline ilike $1 or c.about ilike $1)
          order by c.created_at limit $2`,
        [like, limit],
      ),
      many(
        `select a.*, c.slug as channel_slug, c.name as channel_name
           from assets a join channels c on c.id = a.channel_id
          where a.status = 'live' and c.moderation_state <> 'removed'
            and c.listing_mode = 'marketplace'
            and (a.title ilike $1 or a.description ilike $1)
          order by a.created_at desc limit $2`,
        [like, limit],
      ),
    ]);
    return { stores, assets, term };
  },

  async audit(action, meta = {}) {
    await query('insert into audit_logs (action, meta) values ($1, $2)', [action, JSON.stringify(meta)]);
  },
  async recentAudit(limit = 200) {
    return many('select * from audit_logs order by created_at desc limit $1', [limit]);
  },
};

export function slugify(s) {
  return String(s).toLowerCase().trim()
    .replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').slice(0, 60);
}
