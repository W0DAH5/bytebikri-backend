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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOAD_DIR = path.resolve(__dirname, '../.data/uploads');

export const now = () => new Date();
export const id = () => randomUUID();
export const orderCode = (n = 6) =>
  randomBytes(4).toString('base64url').slice(0, n).toUpperCase();

// ---------------------------------------------------------------------------
// File storage adapter — replace with the media API later.
// ---------------------------------------------------------------------------
export const storage = {
  async put(buffer, filename) {
    await fs.mkdir(UPLOAD_DIR, { recursive: true });
    const key = `${id()}${path.extname(filename || '')}`;
    await fs.writeFile(path.join(UPLOAD_DIR, key), buffer);
    return key;
  },
  async get(key) { return fs.readFile(path.join(UPLOAD_DIR, key)); },
  async exists(key) {
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
      remove_footer: true, marketplace_listed: false, analytics_level: 'sources',
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
  async createChannel({ ownerId, slug, name, tagline, listingMode = 'storefront' }) {
    try {
      return await one(
        `insert into channels (owner_id, slug, name, tagline, listing_mode, moderation_state)
         values ($1, $2, $3, $4, $5, 'approved')
         returning *`,
        [ownerId, slug, name, tagline || '', listingMode],
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
  plan(c) { return PLANS[c?.plan_code] ?? PLANS.free; },

  upgradeQuote(channel, newPlanCode) {
    const cur = this.plan(channel);
    const next = PLANS[newPlanCode];
    if (!next || next.priceNpr <= cur.priceNpr) return null;
    const end = channel?.subscription_end ? new Date(channel.subscription_end) : null;
    const daysLeft = end ? Math.max(0, Math.ceil((end - now()) / 86400000)) : 0;
    const full = next.priceNpr - cur.priceNpr;
    const amount = Math.round(full * (daysLeft / 365));
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
  async createAsset({ channelId, title, slug, description, unlockMode = 'ad_gated' }) {
    return withTransaction(async (c) => {
      const { rows } = await c.query(
        `insert into assets (channel_id, title, slug, description, kind, unlock_mode, status, moderation_state)
         values ($1, $2, $3, $4, 'digital', $5, 'live', 'approved')
         returning *`,
        [channelId, title, slug || slugify(title), description || '', unlockMode],
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
    return one(
      `select * from unlocks
        where asset_id = $1 and user_id = $2 and revoked_at is null
          and (expires_at is null or expires_at > now())`,
      [assetId, userId],
    );
  },
  async isUnlocked(assetId, userId) {
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
    return one(
      `insert into plan_payments (subscription_id, amount_npr, txn_reference, method, payer_name, payer_number)
       select s.id, $2, $3, $4, $5, $6
         from subscriptions s
        where s.channel_id = $1
        order by s.created_at desc limit 1
       returning *`,
      [channelId, amountNpr, txnReference, method, payerName ?? null, payerNumber ?? null],
    );
  },
  planPayments() {
    return many('select * from plan_payments order by created_at desc');
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
