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

import { rentPeriod, annualRentNpr, rentWorking, RENT_TERMS } from './billing.js';

/**
 * The statuses that mean "invoiced and not yet collected".
 *
 * Exported and used by every money query, because the alternative — each query
 * spelling out its own list — is how `platformMoney` came to filter on 'unpaid'
 * and 'overdue', two statuses the CHECK constraint has never allowed. It matched
 * one real state and dropped every invoice a payer had claimed to have paid.
 */
export const OPEN_RENT_STATUSES = ['issued', 'submitted'];
// The assumed rate lives in policy, exactly once, and this file reads it rather
// than repeating it: the rent estimate, the seller's page and the operator's
// calibration page must all be arithmetic on the SAME assumption, or comparing
// them is meaningless.
import { POLICY } from './slots.js';
import { familyCase, AUDIT_FAMILIES } from './audit.js';
import { SEARCHABLE_ASSET_STATES } from './moderation.js';

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

/**
 * The next tier up, by price. Null when there is nothing above.
 *
 * The dashboard used to hand the seller `PLANS.pro` as "the plan that lifts your
 * limit" regardless of which plan they were on, so a Free store at 17 of 20 files
 * was told Pro raises it to unlimited — skipping over the tier that actually
 * solves the problem for NPR 999. The researched advice is one recommended plan
 * tied to the wall the person just hit, not the top of the price list.
 */
export function nextPlan(code) {
  const cur = PLANS[code] ?? PLANS.free;
  return Object.values(PLANS)
    .filter((p) => p.priceNpr > cur.priceNpr)
    .sort((a, b) => a.priceNpr - b.priceNpr)[0] ?? null;
}

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
              coalesce(o.banned, false) as owner_banned,
              coalesce(s.plan_code, 'free')           as plan_code,
              s.status                            as subscription_status,
              s.period_end                        as subscription_end,
              s.grace_until                       as subscription_grace
         from channels c
         left join profiles o on o.id = c.owner_id
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
              s.period_end as subscription_end,
              -- A banned seller's stores are not advertised anywhere. Read for
              -- the operator, invisible to the public.
              coalesce(o.banned, false) as owner_banned
         from channels c
         left join profiles o on o.id = c.owner_id
         left join lateral (
           select sub.plan_code, sub.status, sub.period_end
             from subscriptions sub
            where sub.channel_id = c.id
              and sub.status in ('active','grace')
            order by sub.created_at desc limit 1
         ) s on true
        -- Public reads see public states only. 'removed' and 'suspended' are the
        -- two states a visitor must not learn about, and the storefront route
        -- enforces the same rule for a store reached by its own address.
        where c.moderation_state not in ('removed', 'suspended')
          and coalesce(o.banned, false) = false
          ${listedOnly ? "and c.listing_mode = 'marketplace'" : ''}
        order by c.created_at`,
    );
  },
  // ---- people -------------------------------------------------------------
  /**
   * Ban or reinstate an ACCOUNT.
   *
   * This is the Android app's `banUser`, which it has called since its first
   * schema and which never existed on the server — the app was posting to
   * `/api/admin/ban-user` and getting a 404 while its admin screen showed a
   * "Ban User" button in red.
   *
   * Three writes, one transaction:
   *
   *   profiles.banned      the flag every public read already filters on
   *   sessions             revoked, so a live session cannot outlive the ban
   *   moderation_actions   the record: who decided, when, citing which rule
   *
   * Revoking the sessions is defence in depth rather than the control —
   * `auth.resolveSession` already refuses a banned account's token — but a
   * session row that still says "valid" is the kind of thing a later change
   * quietly starts trusting.
   */
  async setUserBanned({ userId, action, ruleCode = null, remedy = '', actorId = null }) {
    const banned = action === 'suspend';
    return withTransaction(async (client) => {
      const res = await client.query(
        'update profiles set banned = $2 where id = $1 returning id, email, display_name, banned',
        [userId, banned],
      );
      const user = res.rows[0] ?? null;
      await client.query(
        `insert into moderation_actions
           (subject_type, subject_id, action, rule_code, reason, actor_id, automated)
         values ('profile', $1, $2, $3, $4, $5, false)`,
        [userId, action, ruleCode, remedy ? String(remedy) : null, actorId],
      );
      if (banned) {
        await client.query(
          'update sessions set revoked_at = now() where user_id = $1 and revoked_at is null',
          [userId],
        );
      }
      return user;
    });
  },

  /** The accounts that are not in a normal state. */
  bannedUsers() {
    return many(
      `select p.id, p.email, p.display_name, p.role, p.banned, p.created_at,
              (select count(*)::int from channels c where c.owner_id = p.id) as stores,
              (select max(m.created_at) from moderation_actions m
                where m.subject_type = 'profile' and m.subject_id = p.id) as last_decision_at,
              (select m.rule_code from moderation_actions m
                where m.subject_type = 'profile' and m.subject_id = p.id
                order by m.created_at desc, m.id desc limit 1) as last_rule,
              (select m.action from moderation_actions m
                where m.subject_type = 'profile' and m.subject_id = p.id
                order by m.created_at desc, m.id desc limit 1) as last_action
         from profiles p
        where p.banned = true
        order by p.created_at desc
        limit 100`,
    );
  },

  /**
   * Find an account to act on.
   *
   * An operator is given a mailbox, not an id: the store page shows an email,
   * and asking somebody to copy a UUID out of the database is how a feature
   * stops being used. An exact match wins over a partial one.
   */
  usersMatching(q, limit = 25) {
    const term = String(q ?? '').trim();
    if (!term) return [];
    return many(
      `select p.id, p.email, p.display_name, p.banned, p.created_at,
              (select count(*)::int from channels c where c.owner_id = p.id) as stores
         from profiles p
        where p.email = $1 or p.email ilike '%' || $1 || '%' or p.display_name ilike '%' || $1 || '%'
        order by (p.email = $1) desc, p.created_at
        limit $2`,
      [term.toLowerCase(), limit],
    );
  },

  userModerationHistory(userId, limit = 20) {
    return many(
      `select m.*, r.title as rule_title
         from moderation_actions m
         left join policy_rules r on r.code = m.rule_code
        where m.subject_type = 'profile' and m.subject_id = $1
        order by m.created_at desc, m.id desc
        limit $2`,
      [userId, limit],
    );
  },

  /**
   * The plan surface: what each tier grants, who is on it, and who is about to
   * hit a wall.
   *
   * `plans` has existed since the first migration with a capabilities blob, and
   * the app has never read it — `store.plan()` resolves from the PLANS constant
   * in JS. That is a real trap: editing the table looks like it changes what the
   * platform enforces and changes nothing. So this query returns BOTH, and the
   * page shows the disagreement when there is one. A console that silently
   * agrees with the runtime is a console that cannot report the day they diverge.
   */
  plansOverview() {
    return withTransaction(async (c) => {
      const plans = await c.query(
        `select code, name, price_npr, period_months, capabilities, sort_order, active
           from plans order by sort_order, code`,
      );
      const mix = await c.query(
        `select coalesce(s.plan_code, 'free') as plan_code,
                count(*)::int as stores,
                count(*) filter (where s.status = 'active')::int as active,
                count(*) filter (where s.status = 'grace')::int as in_grace,
                count(*) filter (where s.status in ('expired','cancelled'))::int as lapsed
           from channels c
           left join subscriptions s on s.channel_id = c.id and s.status in ('active','grace','pending_payment')
          where c.moderation_state <> 'removed'
          group by 1 order by 2 desc`,
      );
      // What the plans bill this cycle, from the records rather than from
      // arithmetic on the price list: an invoice is money somebody was asked for.
      const money = await c.query(
        `select
           coalesce((select sum(amount_npr) from rent_invoices where status in ('issued','unpaid','overdue')), 0)::int as rent_outstanding,
           coalesce((select sum(amount_npr) from rent_invoices where status = 'paid'), 0)::int as rent_collected,
           coalesce((select sum(amount_npr) from plan_payments where status = 'matched'), 0)::int as upgrades_collected,
           coalesce((select sum(amount_npr) from plan_payments where status = 'pending'), 0)::int as upgrades_pending`,
      );
      return {
        plans: plans.rows,
        mix: mix.rows,
        money: money.rows[0],
      };
    });
  },

  /**
   * The stores closest to their plan's ceiling.
   *
   * Ordered by how full they are, not by size: a free store with 19 of 20 files
   * is a more urgent conversation than a pro store with 400 of unlimited, and it
   * is the one where the platform is about to start refusing somebody's work.
   *
   * The cap comes from the plans table, which is exactly the copy the runtime may
   * disagree with — so this list is a convenience, and the page labels it as
   * such. `planUsage` (JS) is what actually refuses an upload.
   */
  storesNearCap({ limit = 25 } = {}) {
    return many(
      `with live as (
         select c.id, c.slug, c.name, c.owner_id,
                coalesce(s.plan_code, 'free') as plan_code,
                (select count(*)::int from assets a where a.channel_id = c.id and a.status = 'live') as files
           from channels c
           left join subscriptions s on s.channel_id = c.id and s.status in ('active','grace')
          where c.moderation_state <> 'removed'
       )
       select l.*, p.name as plan_name, (p.capabilities ->> 'max_assets')::int as cap,
              u.email as owner_email,
              round(100.0 * l.files / nullif((p.capabilities ->> 'max_assets')::int, 0))::int as pct_full
         from live l
         join plans p on p.code = l.plan_code
         left join profiles u on u.id = l.owner_id
        where (p.capabilities ->> 'max_assets')::int <> -1
          and l.files >= floor((p.capabilities ->> 'max_assets')::int * 0.6)
        order by pct_full desc, l.files desc
        limit $1`,
      [limit],
    );
  },

  /**
   * Everyone with an account — built around the four decisions that need people.
   *
   * `bannedUsers` and `usersMatching` could only answer "who is suspended" and
   * "who is this exact person". The questions an operator actually has are staged
   * ones: who signed up and never opened a store, who opened one and never
   * published, who published and never got an unlock. Those three are the funnel,
   * and they were invisible.
   *
   * The segment is computed in SQL rather than in the view so that filtering and
   * counting use the same definition. A CASE in JS would be a second, silently
   * different answer to the same question — the tabs would say twelve and the
   * filtered query would return eleven.
   *
   * Suspended and operator come FIRST in the CASE: they are states that overlay a
   * shape, and an operator looking for the suspension queue should not have to
   * find it inside "files, no unlocks".
   */
  peopleDirectory({ segment = 'all', q = '', sort = 'recent', page = 1, perPage = 25 } = {}) {
    const SEGMENT = `case
      when p.banned then 'suspended'
      when p.role <> 'user' then 'operator'
      when coalesce(st.stores, 0) = 0 then 'no_store'
      when coalesce(st.files, 0) = 0 then 'store_no_files'
      when coalesce(st.unlocks, 0) = 0 then 'files_no_unlocks'
      else 'working' end`;
    // One lateral per person, so the counts are per-person and cannot multiply
    // each other the way four independent joins in one FROM would.
    const STATS = `left join lateral (
        select
          (select count(*)::int from channels c where c.owner_id = p.id and c.moderation_state <> 'removed') as stores,
          (select count(*)::int from assets a
             join channels c on c.id = a.channel_id
            where c.owner_id = p.id and a.status = 'live') as files,
          (select coalesce(sum(v.views), 0)::int from page_view_daily v
             join channels c on c.id = v.channel_id
            where c.owner_id = p.id and v.day > current_date - 30) as views_30d,
          (select count(*)::int from unlocks u
             join assets a on a.id = u.asset_id
             join channels c on c.id = a.channel_id
            where c.owner_id = p.id and u.revoked_at is null) as unlocks
      ) st on true`;
    const LIVE = `s.last_seen_at is not null and s.last_seen_at > now() - interval '30 days'`;
    // The session summary is a lateral, and it must be joined by every query that
    // mentions `s` — the counts query did not, and Postgres said so with
    // "missing FROM-clause entry for table s" rather than counting zero and
    // quietly reporting that nobody had been seen. Shared here so the next query
    // to need it cannot forget.
    const SESSIONS = `left join lateral (
        select max(x.last_seen_at) as last_seen_at,
               count(*) filter (where x.revoked_at is null and x.expires_at > now())::int as live_sessions
          from sessions x where x.user_id = p.id
      ) s on true`;

    const where = [];
    const params = [];
    const bind = (value) => { params.push(value); return `$${params.length}`; };

    if (segment && segment !== 'all') where.push(`${SEGMENT} = ${bind(segment)}`);
    if (String(q).trim().length >= 2) {
      const term = `%${String(q).trim().toLowerCase()}%`;
      const a = bind(term);
      where.push(`(lower(p.email) like ${a} or lower(coalesce(p.display_name, '')) like ${a})`);
    }
    const clause = where.length ? `where ${where.join(' and ')}` : '';

    const ORDER = {
      recent: 'p.created_at desc',
      active: 's.last_seen_at desc nulls last',
      views: 'coalesce(st.views_30d, 0) desc',
      unlocks: 'coalesce(st.unlocks, 0) desc',
      name: 'lower(coalesce(p.display_name, p.email)) asc',
    };
    const order = ORDER[sort] || ORDER.recent;

    const size = Math.min(Math.max(Number(perPage) || 25, 1), 100);
    const pages = Math.max(Number(page) || 1, 1);

    return withTransaction(async (c) => {
      const rows = await c.query(
        `select p.id, p.email, p.display_name, p.role, p.banned, p.created_at, p.locale,
                (p.password_hash is not null) as has_password,
                (p.legal_name is not null) as sold_by_on_file,
                coalesce(st.stores, 0) as stores,
                coalesce(st.files, 0) as files,
                coalesce(st.views_30d, 0) as views_30d,
                coalesce(st.unlocks, 0) as unlocks,
                s.last_seen_at,
                coalesce(s.live_sessions, 0) as live_sessions,
                coalesce(fl.failed_7d, 0) as failed_7d,
                ${SEGMENT} as segment
           from profiles p
           ${STATS}
           ${SESSIONS}
           left join lateral (
             select count(*)::int as failed_7d
               from login_attempts l
              where l.email = p.email and l.succeeded = false
                and l.created_at > now() - interval '7 days'
           ) fl on true
           ${clause}
          order by ${order}
          limit ${size} offset ${(pages - 1) * size}`,
        params,
      );

      const total = await c.query(`select count(*)::int as n from profiles p ${STATS} ${clause}`, params);
      // Counted over every account, never over the filtered set: a tab that says
      // "3" and then shows nothing because a search is also active is a lie about
      // the platform, not about the search.
      const counts = await c.query(
        `select ${SEGMENT} as segment, count(*)::int as n, count(*) filter (where ${LIVE})::int as live
           from profiles p ${STATS} ${SESSIONS}
          group by 1`,
      );

      return {
        rows: rows.rows,
        total: total.rows[0].n,
        counts: Object.fromEntries(counts.rows.map((r) => [r.segment, { n: r.n, live: r.live }])),
        page: pages,
        pages: Math.max(Math.ceil(total.rows[0].n / size), 1),
        perPage: size,
      };
    });
  },

  /**
   * One account, in the detail the directory deliberately leaves out.
   *
   * What is NOT here is a design decision: the files this person unlocked as a
   * BUYER are counted, never listed. What a person reads is theirs, and an
   * operator page that lists it turns a support tool into a surveillance log the
   * platform would then have to defend. The seller may not track a buyer, and the
   * operator does not need to either — a count answers every question moderation
   * actually asks.
   */
  personDetail(userId) {
    // Read-only, so no transaction: five independent reads through the pool run
    // concurrently, whereas `Promise.all` over one transaction client is a
    // deprecated pg pattern (a single connection cannot execute five queries at
    // once) that would also serialise them anyway.
    return (async () => {
      const person = await one(
        `select p.id, p.email, p.display_name, p.role, p.banned, p.ban_reason, p.locale, p.created_at,
                (p.password_hash is not null) as has_password,
                (p.legal_name is not null) as sold_by_on_file,
                p.phone is not null as phone_on_file
           from profiles p where p.id = $1`,
        [userId],
      );
      if (!person) return null;
      const [stores, sessions, attempts, decisions, unlocks] = await Promise.all([
        many(
          `select c.id, c.slug, c.name, c.moderation_state, c.listing_mode, c.created_at,
                  (select count(*)::int from assets a where a.channel_id = c.id and a.status = 'live') as files,
                  (select coalesce(sum(v.views), 0)::int from page_view_daily v
                    where v.channel_id = c.id and v.day > current_date - 30) as views_30d
             from channels c where c.owner_id = $1 order by c.created_at`,
          [userId],
        ),
        one(
          `select count(*)::int as total,
                  count(*) filter (where revoked_at is null and expires_at > now())::int as live,
                  max(last_seen_at) as last_seen,
                  min(created_at) as first_seen
             from sessions where user_id = $1`,
          [userId],
        ),
        one(
          `select count(*) filter (where succeeded = false and created_at > now() - interval '7 days')::int as failed_7d,
                  count(*) filter (where succeeded = true and created_at > now() - interval '30 days')::int as ok_30d
             from login_attempts where email = $1`,
          [person.email],
        ),
        many(
          `select m.id, m.action, m.rule_code, m.reason, m.created_at, r.title as rule_title
             from moderation_actions m
             left join policy_rules r on r.code = m.rule_code
            where m.subject_type = 'profile' and m.subject_id = $1
            order by m.created_at desc, m.id desc limit 20`,
          [userId],
        ),
        one(
          `select count(*)::int as held from unlocks u where u.user_id = $1 and u.revoked_at is null`,
          [userId],
        ),
      ]);
      return {
        person, stores, sessions, attempts, decisions, unlocksHeld: unlocks.held,
      };
    })();
  },

  // ---- moderation ---------------------------------------------------------
  /**
   * The rules a decision can cite. Read from the table, never from a constant in
   * JS: the policy table is the one place the codes and their wording live, and
   * `test/moderation.test.js` fails if this file's vocabulary and the schema's
   * CHECK constraints ever drift apart.
   */
  policyRules() {
    return many(
      `select code, title, description, default_state, severity, scope, country_code
         from policy_rules where active = true
        order by severity desc, code`,
    );
  },
  policyRule(code) {
    return one('select code, title, description, default_state, severity from policy_rules where code = $1 and active = true', [String(code ?? '')]);
  },

  /**
   * Change a store's moderation state, and record who did it and why.
   *
   * Both writes are in ONE transaction. A state change with no `moderation_actions`
   * row is a store that vanished with no explanation, and an action row with no
   * state change is a queue that lies about what it did.
   */
  async setChannelModeration({ channelId, action, state = null, ruleCode = null, remedy = '', actorId = null, automated = false }) {
    return withTransaction(async (client) => {
      const res = await client.query(
        `update channels
            set moderation_state = coalesce($2, moderation_state),
                moderation_reason = $3,
                updated_at = now()
          where id = $1
          returning *`,
        [channelId, state, ruleCode],
      );
      const channel = res.rows[0] ?? null;
      await client.query(
        `insert into moderation_actions
           (subject_type, subject_id, action, rule_code, reason, actor_id, automated)
         values ('channel', $1, $2, $3, $4, $5, $6)`,
        [channelId, action, ruleCode, remedy ? String(remedy) : null, actorId, Boolean(automated)],
      );
      return channel;
    });
  },

  /** The newest decision about a store, with the rule it cited. */
  latestModerationAction(channelId) {
    return one(
      `select m.*, r.title as rule_title, r.description as rule_description
         from moderation_actions m
         left join policy_rules r on r.code = m.rule_code
        where m.subject_type = 'channel' and m.subject_id = $1
        order by m.created_at desc, m.id desc
        limit 1`,
      [channelId],
    );
  },

  // ── files, and the countries they are for ────────────────────────────────
  //
  // Everything below serves one sentence: a file may be listed everywhere and
  // unlockable in four countries. The reads are written for the PUBLIC path
  // (one query per page, never one per file), and every write is paired with a
  // `moderation_actions` row in the same transaction — a file that stopped being
  // available in a country with nobody recorded as deciding it is
  // indistinguishable from a bug in the read path.

  /**
   * The country decisions for a set of files, in one query.
   *
   * Takes an array because the storefront is a grid: a query per card is how a
   * front page becomes forty round trips, and the join to `content_geo_blocks`
   * is what carries the RULE the decision cited, so the visitor can be told why
   * without a second lookup.
   */
  countryRulesFor(assetIds = [], country = null) {
    if (!assetIds.length || !country) return many('select null::uuid as asset_id where false');
    return many(
      `select r.asset_id, r.country_code, r.state, r.reason, r.source, r.set_by, r.updated_at,
              g.rule_code
         from asset_country_rules r
         left join content_geo_blocks g
           on g.subject_type = 'asset' and g.subject_id = r.asset_id
          and g.country_code = r.country_code
        where r.asset_id = any($1::uuid[]) and r.country_code = $2`,
      [assetIds, String(country)],
    );
  },

  /** Every country rule on one file, with the rule's title, for the owner and the operator. */
  assetCountryRules(assetId) {
    return many(
      `select r.*, g.rule_code, p.title as rule_title, p.description as rule_description,
              pr.display_name as set_by_name, pr.email as set_by_email
         from asset_country_rules r
         left join content_geo_blocks g
           on g.subject_type = 'asset' and g.subject_id = r.asset_id
          and g.country_code = r.country_code
         left join policy_rules p on p.code = g.rule_code
         left join profiles pr on pr.id = r.set_by
        where r.asset_id = $1
        order by r.country_code`,
      [assetId],
    );
  },

  /** A store-wide country block, for one visitor's country. */
  channelCountryBlock(channelId, country = null) {
    if (!country) return Promise.resolve(null);
    return one(
      `select * from content_geo_blocks
        where subject_type = 'channel' and subject_id = $1 and country_code = $2`,
      [channelId, String(country)],
    );
  },

  /** The same, for a page that lists stores. */
  channelCountryBlocks(channelIds = [], country = null) {
    if (!channelIds.length || !country) return many('select null::uuid as subject_id where false');
    return many(
      `select subject_id, country_code, rule_code, created_at
         from content_geo_blocks
        where subject_type = 'channel' and subject_id = any($1::uuid[]) and country_code = $2`,
      [channelIds, String(country)],
    );
  },

  /** Every store-level country block, with the rule it cites, for the console. */
  storeCountryBlocks() {
    return many(
      `select g.subject_id, g.country_code, g.rule_code, g.created_at,
              c.slug, c.name, p.title as rule_title
         from content_geo_blocks g
         join channels c on c.id = g.subject_id
         left join policy_rules p on p.code = g.rule_code
        where g.subject_type = 'channel'
        order by c.name, g.country_code`,
    );
  },

  /** Every country where something is currently blocked or restricted. */
  /**
   * Everywhere a country rule is in force, counted by **who** made it.
   *
   * The split is the point. "1 file blocked in Nepal" reads to an operator as a
   * platform rule in force, and a creator's own withholding is not that — one of
   * the two is ours to answer for and the other is theirs. The index alone cannot
   * tell them apart (`content_geo_blocks` records what and where, not who), so
   * this reads the rule table, which carries `source`, and the channel blocks,
   * which are always an operator's.
   */
  countrySummary() {
    return many(
      `select country_code,
              count(*) filter (where kind = 'asset' and state = 'blocked'    and source = 'operator')::int as blocked_files_operator,
              count(*) filter (where kind = 'asset' and state = 'blocked'    and source = 'creator')::int  as blocked_files_creator,
              count(*) filter (where kind = 'asset' and state = 'restricted' and source = 'operator')::int as restricted_files_operator,
              count(*) filter (where kind = 'asset' and state = 'restricted' and source = 'creator')::int  as restricted_files_creator,
              count(*) filter (where kind = 'channel')::int as blocked_stores,
              count(*) filter (where kind = 'asset' and state = 'blocked')::int as blocked_files
         from (
           select country_code, 'asset' as kind, state, source from asset_country_rules
           union all
           select country_code, 'channel', 'blocked', 'operator'
             from content_geo_blocks where subject_type = 'channel'
         ) t
        group by country_code
        order by country_code`,
    );
  },

  /**
   * Files an operator may need to look at: not in the default state, OR carrying
   * a country rule while their state is fine.
   *
   * The second half is the reason this queue exists at all. A file blocked in two
   * countries is `approved` — the state column says nothing is wrong with it —
   * and before this queue a country decision was invisible to everyone except the
   * person who made it.
   */
  filesNeedingModeration() {
    return many(
      `select a.id, a.title, a.slug, a.status, a.moderation_state,
              a.created_at, a.updated_at,
              c.id as channel_id, c.slug as channel_slug, c.name as channel_name,
              p.display_name as owner_name, p.email as owner_email,
              (select count(*)::int from asset_country_rules r where r.asset_id = a.id) as country_rules,
              (select string_agg(r.country_code || ' ' || r.state, ', ' order by r.country_code)
                 from asset_country_rules r where r.asset_id = a.id) as country_summary,
              m.created_at as decided_at
         from assets a
         join channels c on c.id = a.channel_id
         left join profiles p on p.id = c.owner_id
         left join lateral (
           select created_at from moderation_actions ma
            where ma.subject_type = 'asset' and ma.subject_id = a.id
            order by ma.created_at desc, ma.id desc limit 1
         ) m on true
        where a.moderation_state <> 'approved'
           or exists (select 1 from asset_country_rules r where r.asset_id = a.id)
        order by case a.moderation_state
                   when 'removed' then 1 when 'restricted' then 2 else 3 end,
                 coalesce(m.created_at, a.created_at) desc`,
    );
  },

  /** One file, its store, its country rules and its decision history. */
  fileModerationDetail(assetId) {
    return one(
      `select a.*, c.slug as channel_slug, c.name as channel_name, c.moderation_state as channel_state,
              c.owner_id, p.display_name as owner_name, p.email as owner_email
         from assets a
         join channels c on c.id = a.channel_id
         left join profiles p on p.id = c.owner_id
        where a.id = $1`,
      [assetId],
    );
  },

  /** Every decision ever recorded about one file, newest first, with its rule. */
  fileDecisionHistory(assetId) {
    return many(
      `select m.*, r.title as rule_title,
              coalesce(p.display_name, p.email) as actor_name
         from moderation_actions m
         left join policy_rules r on r.code = m.rule_code
         left join profiles p on p.id = m.actor_id
        where m.subject_type = 'asset' and m.subject_id = $1
        order by m.created_at desc, m.id desc
        limit 50`,
      [assetId],
    );
  },

  /**
   * Change a file's own state, and record who did it and why.
   *
   * One transaction for the same reason the store version has one: a file that
   * stopped being listed with no `moderation_actions` row is a file whose owner
   * has nothing to appeal.
   */
  async setAssetModeration({ assetId, action, state = null, ruleCode = null, remedy = '', actorId = null }) {
    return withTransaction(async (client) => {
      // No reason column on `assets`, deliberately: the reason for a file is its
      // newest decision row, which carries the rule code and the person. A
      // column would be a second copy of that, and the copy is what goes stale.
      const res = await client.query(
        `update assets
            set moderation_state = coalesce($2, moderation_state),
                updated_at = now()
          where id = $1
          returning *`,
        [assetId, state],
      );
      const asset = res.rows[0] ?? null;
      await client.query(
        `insert into moderation_actions
           (subject_type, subject_id, action, rule_code, reason, actor_id)
         values ('asset', $1, $2, $3, $4, $5)`,
        [assetId, action, ruleCode, remedy ? String(remedy) : null, actorId],
      );
      return asset;
    });
  },

  /**
   * Set what one file may be seen as, in one country.
   *
   * Three writes and one promise. The rule row is the decision; the
   * `content_geo_blocks` row is the index the public path and the country summary
   * read — written for a block and deleted for anything else, so "blocked"
   * cannot linger in the index after somebody allowed the country again; and the
   * `moderation_actions` row is the record, carrying the country and the rule.
   *
   * `source` is not inferred from who is calling. A creator limiting their own
   * file and an operator citing a rule produce different sentences to a visitor
   * and different HTTP status codes (403 and 451), and a field that has to be
   * guessed from a session is a field that will be guessed wrong.
   */
  async setAssetCountryRule({ assetId, countryCode, state, ruleCode = null, note = null, source = 'operator', actorId = null }) {
    const country = String(countryCode).toUpperCase();
    return withTransaction(async (client) => {
      const res = await client.query(
        `insert into asset_country_rules (asset_id, country_code, state, reason, source, set_by, updated_at)
         values ($1, $2, $3, $4, $5, $6, now())
         on conflict (asset_id, country_code) do update
            set state = excluded.state,
                reason = excluded.reason,
                source = excluded.source,
                set_by = excluded.set_by,
                updated_at = now()
          returning *`,
        [assetId, country, state, note ? String(note) : null, source, actorId],
      );

      if (state === 'blocked') {
        await client.query(
          `insert into content_geo_blocks (subject_type, subject_id, country_code, rule_code)
           values ('asset', $1, $2, $3)
           on conflict (subject_type, subject_id, country_code)
           do update set rule_code = excluded.rule_code`,
          [assetId, country, ruleCode],
        );
      } else {
        await client.query(
          `delete from content_geo_blocks
            where subject_type = 'asset' and subject_id = $1 and country_code = $2`,
          [assetId, country],
        );
      }

      // A country decision is logged with the same verbs as any other: blocking
      // or limiting is `restrict`, allowing is `approve`. `approve` deliberately
      // carries no rule code — clearing a restriction is not itself a rule.
      await client.query(
        `insert into moderation_actions
           (subject_type, subject_id, action, rule_code, country_code, reason, actor_id)
         values ('asset', $1, $2, $3, $4, $5, $6)`,
        [
          assetId,
          state === 'allowed' ? 'approve' : 'restrict',
          state === 'allowed' ? null : ruleCode,
          country,
          note ? String(note) : null,
          actorId,
        ],
      );
      return res.rows[0] ?? null;
    });
  },

  /** Remove a country rule, and stand the index down with it. */
  async clearAssetCountryRule({ assetId, countryCode, actorId = null }) {
    const country = String(countryCode).toUpperCase();
    return withTransaction(async (client) => {
      const res = await client.query(
        'delete from asset_country_rules where asset_id = $1 and country_code = $2 returning id',
        [assetId, country],
      );
      await client.query(
        `delete from content_geo_blocks
          where subject_type = 'asset' and subject_id = $1 and country_code = $2`,
        [assetId, country],
      );
      if (res.rowCount) {
        await client.query(
          `insert into moderation_actions
             (subject_type, subject_id, action, country_code, actor_id)
           values ('asset', $1, 'approve', $2, $3)`,
          [assetId, country, actorId],
        );
      }
      return res.rowCount;
    });
  },

  /**
   * Block or unblock a whole store in one country.
   *
   * This is the row `content_geo_blocks.subject_type = 'channel'` exists for: a
   * rule about a shop's contents reaches every file in it without a row per file,
   * and an operator can still carve one file back out with an asset rule, because
   * the asset decision is the more specific one.
   */
  async setChannelCountryBlock({ channelId, countryCode, ruleCode, remedy = '', actorId = null }) {
    const country = String(countryCode).toUpperCase();
    return withTransaction(async (client) => {
      const res = await client.query(
        `insert into content_geo_blocks (subject_type, subject_id, country_code, rule_code)
         values ('channel', $1, $2, $3)
         on conflict (subject_type, subject_id, country_code)
         do update set rule_code = excluded.rule_code
         returning *`,
        [channelId, country, ruleCode],
      );
      await client.query(
        `insert into moderation_actions
           (subject_type, subject_id, action, rule_code, country_code, reason, actor_id)
         values ('channel', $1, 'restrict', $2, $3, $4, $5)`,
        [channelId, ruleCode, country, remedy ? String(remedy) : null, actorId],
      );
      return res.rows[0] ?? null;
    });
  },

  async clearChannelCountryBlock({ channelId, countryCode, actorId = null }) {
    const country = String(countryCode).toUpperCase();
    return withTransaction(async (client) => {
      const res = await client.query(
        `delete from content_geo_blocks
          where subject_type = 'channel' and subject_id = $1 and country_code = $2`,
        [channelId, country],
      );
      if (res.rowCount) {
        await client.query(
          `insert into moderation_actions
             (subject_type, subject_id, action, country_code, actor_id)
           values ('channel', $1, 'approve', $2, $3)`,
          [channelId, country, actorId],
        );
      }
      return res.rowCount;
    });
  },

  moderationHistory(channelId, limit = 20) {
    return many(
      `select m.*, r.title as rule_title, p.display_name as actor_name
         from moderation_actions m
         left join policy_rules r on r.code = m.rule_code
         left join profiles p on p.id = m.actor_id
        where m.subject_type = 'channel' and m.subject_id = $1
        order by m.created_at desc, m.id desc
        limit $2`,
      [channelId, limit],
    );
  },

  // ---- reports ------------------------------------------------------------
  /**
   * File a report. Idempotent per person per file, by the unique index.
   *
   * Returns the state of the file's queue AFTER the attempt, so the route can say
   * something true: `filed: false` means this person had already reported it, and
   * the count is the same either way because a second report is not a vote.
   */
  async fileReport({ assetId, channelId, reporterId, reason, note = '' }) {
    let filed = true;
    try {
      await query(
        `insert into asset_reports (asset_id, channel_id, reporter_id, reason, note)
         values ($1, $2, $3, $4, $5)`,
        [assetId, channelId, reporterId, reason, note || null],
      );
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      filed = false;
    }
    const verdict = await this.reportVerdictFor(assetId);
    return { filed, ...verdict };
  },

  reportVerdictFor(assetId) {
    return one(
      `select count(distinct reporter_id)::int as reporters,
              jsonb_object_agg(reason, c) as by_reason,
              max(created_at) as latest
         from (select reporter_id, reason, created_at, count(*) over (partition by reason) as c
                 from asset_reports where asset_id = $1 and status = 'open') t`,
      [assetId],
    ).then((r) => ({
      reporters: r?.reporters ?? 0,
      byReason: Object.fromEntries(Object.entries(r?.by_reason || {}).map(([k, v]) => [k, Number(v)])),
      latest: r?.latest ?? null,
    }));
  },

  /** Has this person already reported this file? */
  hasReported(assetId, reporterId) {
    return scalar(
      'select count(*)::int from asset_reports where asset_id = $1 and reporter_id = $2',
      [assetId, reporterId],
    ).then((v) => Number(v) > 0);
  },

  /**
   * The operator queue: one row per FILE, not per report.
   *
   * "Deduplication so moderators don't see the same report dozens of times." A
   * file with four reports is one decision, and the operators' time is the
   * scarcest thing in this system.
   */
  openReports() {
    return many(
      `select a.id as asset_id, a.title, a.slug as asset_slug, a.status as asset_status,
              c.id as channel_id, c.slug as channel_slug, c.name as channel_name,
              count(distinct r.reporter_id)::int as reporters,
              jsonb_object_agg(r.reason, r2.n) as by_reason,
              max(r.created_at) as latest,
              min(r.created_at) as first_at,
              count(*) filter (where r.note is not null)::int as with_notes
         from asset_reports r
         join assets a   on a.id = r.asset_id
         join channels c on c.id = r.channel_id
         -- How many reports of THIS reason, so the operator page can rank them
         -- without a second query per row.
         join lateral (select count(*) as n from asset_reports x
                        where x.asset_id = r.asset_id and x.reason = r.reason and x.status = 'open') r2 on true
        where r.status = 'open'
        group by a.id, a.title, a.slug, a.status, c.id, c.slug, c.name
        order by max(r.created_at) desc`,
    ).then((rows) => rows.map((r) => ({
      ...r,
      byReason: Object.fromEntries(Object.entries(r.by_reason || {}).map(([k, v]) => [k, Number(v)])),
    })));
  },

  /**
   * The case against a file, as its SELLER may see it.
   *
   * The count and the rule codes, never a reporter and never a note. The operator's
   * queue has the same rule for the same reason: a queue that names complainants
   * is a harassment tool, and handing those names to the person being complained
   * about is worse. `reporterMessage` on the seller's side says three people
   * reported it; it does not say who, and cannot be made to.
   */
  fileCase(assetId) {
    return one(
      `select count(distinct reporter_id)::int as reporters,
              array(select distinct reason from asset_reports
                     where asset_id = $1 and status = 'open') as reasons,
              min(created_at) as first_at,
              max(created_at) as latest_at
         from asset_reports where asset_id = $1 and status = 'open'`,
      [assetId],
    ).then((r) => ({
      reporters: r?.reporters ?? 0,
      reasons: r?.reasons ?? [],
      firstAt: r?.first_at ?? null,
      latestAt: r?.latest_at ?? null,
    }));
  },

  /** This seller's appeals, newest first — their history of asking. */
  appealsOfChannel(channelId) {
    return many(
      `select ap.*, a.title as asset_title, a.slug as asset_slug, a.status as asset_status,
              p.display_name as decided_by_name, p.email as decided_by_email
         from asset_appeals ap
         join assets a on a.id = ap.asset_id
         left join profiles p on p.id = ap.decided_by
        where ap.channel_id = $1
        order by ap.created_at desc`,
      [channelId],
    );
  },

  openAppealFor(assetId) {
    return one(
      `select * from asset_appeals where asset_id = $1 and status = 'open'`,
      [assetId],
    );
  },

  /**
   * File an appeal.
   *
   * The partial unique index is the real guard: two taps at once cannot produce
   * two open appeals, and the route can tell the difference between "filed" and
   * "you already have one" without racing. Nothing here touches the asset — an
   * appeal is a request for a person, not a lever.
   */
  async fileAppeal({ assetId, channelId, sellerId, statement, reasons = [], reportCount = 0 }) {
    try {
      const row = await one(
        `insert into asset_appeals (asset_id, channel_id, seller_id, statement, reasons, report_count)
         values ($1, $2, $3, $4, $5, $6) returning *`,
        [assetId, channelId, sellerId, statement, reasons, reportCount],
      );
      await this.audit('asset.appealed', {
        assetId, channelId, reportCount, reasons,
      }, { actorId: sellerId, subjectType: 'asset', subjectId: assetId });
      return { filed: true, appeal: row };
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      return { filed: false, appeal: await this.openAppealFor(assetId) };
    }
  },

  /**
   * The operator's appeal queue: open first, and each one carries everything the
   * decision needs — the seller's words, the charge they were answering, the
   * reports still open, and whether the file is still the threshold's to restore.
   */
  openAppeals() {
    return many(
      `select ap.id, ap.asset_id, ap.channel_id, ap.statement, ap.reasons, ap.report_count,
              ap.created_at, ap.status,
              a.title as asset_title, a.slug as asset_slug, a.status as asset_status,
              a.hidden_by_reports,
              c.slug as channel_slug, c.name as channel_name,
              u.email as seller_email, u.display_name as seller_name,
              (select count(distinct r.reporter_id)::int from asset_reports r
                where r.asset_id = ap.asset_id and r.status = 'open') as reporters_now,
              (select count(*)::int from asset_reports r
                where r.asset_id = ap.asset_id and r.status = 'open') as reports_now
         from asset_appeals ap
         join assets a on a.id = ap.asset_id
         join channels c on c.id = ap.channel_id
         left join profiles u on u.id = ap.seller_id
        where ap.status = 'open'
        order by ap.created_at asc
        limit 100`,
    );
  },

  /** Every appeal ever, for the audit trail — decided ones included. */
  recentAppeals({ limit = 50 } = {}) {
    return many(
      `select ap.*, a.title as asset_title, c.slug as channel_slug, c.name as channel_name,
              p.display_name as decided_by_name
         from asset_appeals ap
         join assets a on a.id = ap.asset_id
         join channels c on c.id = ap.channel_id
         left join profiles p on p.id = ap.decided_by
        order by ap.created_at desc limit $1`,
      [limit],
    );
  },

  /**
   * Decide an appeal.
   *
   * `upheld` restores the file — but ONLY if the threshold is still what is
   * hiding it (`hidden_by_reports`), so upholding an appeal can never quietly
   * un-pause a file its seller took down, nor lift an operator's own suspension.
   * `declined` changes nothing about the file, which is the point: the queue is
   * for reading carefully, not for flipping switches.
   *
   * Guarded on `status = 'open'` so a double-submit cannot overwrite a decision
   * that has already been made and recorded.
   */
  async decideAppeal({ appealId, decision, note = null, actorId }) {
    if (!['upheld', 'declined', 'withdrawn'].includes(decision)) return { ok: false, error: 'decision' };
    const appeal = await one('select * from asset_appeals where id = $1', [appealId]);
    if (!appeal) return { ok: false, error: 'missing' };
    if (appeal.status !== 'open') return { ok: false, error: 'decided' };

    const decided = await one(
      `update asset_appeals
          set status = $2, decided_at = now(), decided_by = $3, decision_note = $4
        where id = $1 and status = 'open'
        returning *`,
      [appealId, decision, actorId, note],
    );
    if (!decided) return { ok: false, error: 'decided' };

    let restored = false;
    if (decision === 'upheld') {
      const asset = await one('select * from assets where id = $1', [appeal.asset_id]);
      if (asset?.hidden_by_reports) {
        // The same reversibility the dismissal path uses, and for the same
        // reason: only the threshold's hiding is un-done here.
        const back = await one(
          `update assets set status = 'live', hidden_by_reports = false, updated_at = now()
            where id = $1 and hidden_by_reports = true returning id`,
          [appeal.asset_id],
        );
        restored = Boolean(back);
      }
    }
    await this.audit('asset.appeal_decided', {
      assetId: appeal.asset_id, appealId, decision, restored,
      note: note || null,
    }, { actorId, subjectType: 'asset', subjectId: appeal.asset_id });
    return { ok: true, appeal: decided, restored };
  },

  /** The individual reports behind one queue row, with the reporter hidden. */
  reportsForAsset(assetId) {
    return many(
      // No reporter identity in the result: an operator deciding about a FILE does
      // not need to know who complained, and a queue that names reporters is how
      // a moderation tool becomes a harassment tool.
      `select id, reason, note, status, created_at, resolved_at
         from asset_reports where asset_id = $1 order by created_at desc`,
      [assetId],
    );
  },

  /**
   * Hide a file because the report threshold was reached.
   *
   * Sets the flag as well as the status, so the decision is reversible by the
   * only person who can reverse it — an operator who reads the reports and
   * disagrees with them.
   */
  hideByReports(assetId) {
    return one(
      `update assets set status = 'paused', hidden_by_reports = true, updated_at = now()
        where id = $1 returning *`,
      [assetId],
    );
  },

  /**
   * Put a file back after the reports against it were dismissed.
   *
   * ONLY a file the threshold hid. A file its seller paused stays paused, which
   * is the whole reason `hidden_by_reports` exists as a column rather than as an
   * inference from `status`.
   */
  restoreFromReports(assetId) {
    return one(
      `update assets set status = 'live', hidden_by_reports = false, updated_at = now()
        where id = $1 and hidden_by_reports = true returning *`,
      [assetId],
    );
  },

  /** Resolve every open report on a file, in one transaction with the decision. */
  async resolveReports({ assetId, status, resolution, actorId }) {
    return withTransaction(async (client) => {
      const res = await client.query(
        `update asset_reports
            set status = $2, resolution = $3, resolved_by = $4, resolved_at = now()
          where asset_id = $1 and status = 'open'
          returning id`,
        [assetId, status, resolution || null, actorId || null],
      );
      return res.rowCount;
    });
  },

  reportCounts() {
    return one(
      `select count(*) filter (where status = 'open')::int as open,
              count(distinct asset_id) filter (where status = 'open')::int as files,
              count(*)::int as total
         from asset_reports`,
    );
  },

  /** Stores an operator may need to look at: everything not in the default state. */
  channelsNeedingModeration() {
    return many(
      `select c.id, c.slug, c.name, c.moderation_state, c.moderation_reason, c.created_at,
              p.display_name as owner_name, p.email as owner_email
         from channels c left join profiles p on p.id = c.owner_id
        where c.moderation_state <> 'approved'
        order by case c.moderation_state
                   when 'suspended' then 1 when 'removed' then 2 when 'restricted' then 3 else 4 end,
                 c.created_at desc`,
    );
  },

  /**
   * Attention evidence for every store at once, for the Explore rails.
   *
   * One query with two lateral aggregates rather than a loop of per-channel
   * counts: the front page is the most-visited page in a marketplace and it must
   * not cost one round trip per store.
   *
   * `unlocks` counts only non-revoked unlocks inside the window, because a
   * revoked unlock is attention that was taken back.
   */
  channelStats({ days = 30 } = {}) {
    return many(
      `select c.id as channel_id,
              coalesce(v.views, 0)::int   as views_30d,
              coalesce(u.unlocks, 0)::int as unlocks_30d,
              coalesce(a.items, 0)::int   as items
         from channels c
         left join lateral (
           select sum(p.views) as views from page_view_daily p
            where p.channel_id = c.id and p.day > current_date - $1::int
         ) v on true
         left join lateral (
           select count(*) as unlocks from unlocks un
            where un.channel_id = c.id and un.revoked_at is null
              and un.granted_at > now() - ($1::int || ' days')::interval
         ) u on true
         left join lateral (
           select count(*) as items from assets as_ where as_.channel_id = c.id and as_.status = 'live'
         ) a on true
        left join profiles o on o.id = c.owner_id
        where c.moderation_state not in ('removed', 'suspended')
          and coalesce(o.banned, false) = false`,
      [days],
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
  /**
   * Create a file, and decide whether a person has to look at it first.
   *
   * The state was hardcoded to `approved`, which made `pending` a state nothing
   * could reach and a queue that could never have anything in it. The rule now:
   * **a store's files wait until a person has approved one of them.** A new store
   * gets one review, not one review per file — that is a promise one operator can
   * keep — and a store that was looked at publishes immediately afterwards.
   *
   * `pending` does not hide the file (see ASSET_BEHAVIOUR): it stays at its link
   * and in the store's own shop, and it is search that waits. The creator is told
   * so on the file's page rather than left to wonder why nobody is finding it.
   *
   * `moderationState` is for the one caller that is not a creator: the seed, which
   * is building a demonstration of a store that has already been reviewed.
   */
  async createAsset({
    channelId, title, slug, description, unlockMode = 'ad_gated', coverUrl = null, moderationState = null,
  }) {
    return withTransaction(async (c) => {
      let state = moderationState;
      if (!state) {
        // Read inside the transaction, so two files uploaded at the same instant
        // by a brand-new store cannot both find "no approved file yet" and race
        // their way to an unpublishable pair. One of them wins the row lock and
        // the other sees its sibling.
        const { rows: [seen] } = await c.query(
          `select count(*)::int as n from assets
            where channel_id = $1 and moderation_state = 'approved'`,
          [channelId],
        );
        state = seen.n > 0 ? 'approved' : 'pending';
      }
      const { rows } = await c.query(
        `insert into assets (channel_id, title, slug, description, kind, unlock_mode, status, moderation_state, cover_url)
         values ($1, $2, $3, $4, 'digital', $5, 'live', $6, $7)
         returning *`,
        [channelId, title, slug || slugify(title), description || '', unlockMode, state, coverUrl],
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
  /**
   * The seller's own list, for the seller's own dashboard: live AND paused.
   *
   * `assetsOf` above is the PUBLIC list — live only, and it must stay that way,
   * because it feeds the storefront and the public API. The dashboard was using
   * it too, which meant a paused file simply disappeared from its owner's list
   * with no explanation. For a file the report threshold hid that was worse than
   * an inconvenience: the appeal page was unreachable, because the only route to
   * it is the file's own row. A seller cannot be asked to answer something they
   * cannot find.
   *
   * `removed` stays out: that is an operator's decision about the listing itself,
   * it keeps its own route, and listing it here would put a file back in front of
   * its owner as though nothing had happened.
   */
  assetsForOwner(channelId) {
    return many(
      `select * from assets where channel_id = $1 and status <> 'removed' order by created_at desc`,
      [channelId],
    );
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
  /**
   * Change a connection's state, secret or slot assignment.
   *
   * Built from a whitelist rather than a spread of the caller's object: this row
   * holds the secret used to verify money, and a route that forwards `req.body`
   * into it would let a form decide what the column means.
   */
  async updateConnection(cid, patch = {}) {
    if (!UUID_RE.test(String(cid || ''))) return null;
    const sets = [];
    const values = [cid];
    const allow = {
      status: (v) => String(v).slice(0, 20),
      status_reason: (v) => String(v).slice(0, 200),
      callback_secret: (v) => String(v),
      credential_label: (v) => String(v).slice(0, 60),
      slot_keys: (v) => (Array.isArray(v) ? v.map(String).slice(0, 12) : []),
    };
    for (const [key, cast] of Object.entries(allow)) {
      if (!(key in patch)) continue;
      values.push(cast(patch[key]));
      sets.push(`${key} = $${values.length}`);
    }
    if (!sets.length) return this.connectionById(cid);
    return one(`update ad_connections set ${sets.join(', ')} where id = $1 returning *`, values);
  },

  /**
   * The state-machine history. The table exists because onboarding leaves the
   * app and can fail halfway; without it a support question has no answer.
   */
  async logConnectionEvent({ connectionId, from = null, to, detail = null }) {
    if (!UUID_RE.test(String(connectionId || ''))) return null;
    return one(
      `insert into ad_connection_events (connection_id, from_status, to_status, detail)
       values ($1, $2, $3, $4) returning *`,
      [connectionId, from, String(to).slice(0, 20), detail ? String(detail).slice(0, 300) : null],
    );
  },

  connectionEvents(connectionId, { limit = 20 } = {}) {
    if (!UUID_RE.test(String(connectionId || ''))) return Promise.resolve([]);
    return many(
      `select * from ad_connection_events where connection_id = $1
        order by created_at desc limit $2`,
      [connectionId, limit],
    );
  },

  /**
   * When each of this channel's networks last called us, and how often.
   *
   * This is the evidence the connections page needs to answer "why is nothing
   * unlocking": a connection that has never received a callback is a URL that
   * was not saved in the network's dashboard, and that is a different problem
   * from a network that takes three days to reconcile an offerwall.
   */
  postbackEvidence(channelId, { days = 30 } = {}) {
    return many(
      `select provider_id, connection_id,
              max(created_at) as last_at,
              count(*) filter (where created_at > now() - ($2 || ' days')::interval) as in_window,
              count(*) as total
         from ad_view_events
        where channel_id = $1
        group by provider_id, connection_id`,
      [channelId, String(days)],
    );
  },

  /**
   * Every ad connection on the platform, with the evidence of whether it works.
   *
   * The seller's networks page answers "is mine connected". Nothing answered
   * "is ANY of them, and which one is quietly dead" — and a connection that never
   * receives a signed callback is the most expensive silent failure in this
   * product: the seller keeps publishing, the buyer keeps watching ads, and no
   * money moves, because a callback URL was never saved in the network's own
   * dashboard.
   *
   * So the numbers here are the ones that distinguish the failure modes:
   * callbacks received at all, callbacks in the window, and callbacks whose
   * signature did not verify. Those three, with the last transition, tell an
   * operator which of the four things went wrong.
   */
  connectionHealth({ days = 30, limit = 200 } = {}) {
    return many(
      `select ac.id, ac.status, ac.status_reason, ac.provider_id, ac.created_at,
              ac.credential_label, ac.payout_verdict, ac.slot_keys,
              c.id as channel_id, c.name as channel_name, c.slug as channel_slug,
              (select count(*)::int from ad_view_events e where e.connection_id = ac.id)      as postbacks_total,
              (select count(*)::int from ad_view_events e
                where e.connection_id = ac.id
                  and e.created_at > now() - ($2 || ' days')::interval)                       as callbacks_window,
              -- A REFUSED callback never reaches ad_view_events: that table records
              -- views we accepted, and the refusal is written to the audit log
              -- instead. Counting "not signature_ok" here would therefore have
              -- returned zero forever — a metric that cannot move, on the page whose
              -- whole purpose is spotting a network whose secret no longer matches.
              -- So the refusals are counted where they are actually recorded, and
              -- split into "the signature did not verify" (a secret problem, the
              -- seller must paste a new one) and "the callback was otherwise
              -- unusable" (a view that had expired, a mismatch).
              (select count(*)::int from audit_logs al
                where al.action = 'postback.rejected'
                  and al.meta->>'connectionId' = ac.id::text)                                 as rejections_total,
              (select count(*)::int from audit_logs al
                where al.action = 'postback.rejected'
                  and al.meta->>'connectionId' = ac.id::text
                  and (al.meta->>'reason') ~* 'signature|hash|no &hash|missing sig|secret')   as signature_failures,
              (select max(e.created_at) from ad_view_events e
                where e.connection_id = ac.id and e.signature_ok)                             as last_verified_at,
              (select max(al.created_at) from audit_logs al
                where al.action = 'postback.rejected'
                  and al.meta->>'connectionId' = ac.id::text)                                 as last_rejected_at,
              (select (al.meta->>'reason') from audit_logs al
                where al.action = 'postback.rejected'
                  and al.meta->>'connectionId' = ac.id::text
                order by al.created_at desc limit 1)                                          as last_rejection_reason,
              (select max(ev.created_at) from ad_connection_events ev
                where ev.connection_id = ac.id)                                               as last_transition_at,
              coalesce(ev.events, '[]'::json)                                                 as history,
              (select count(*)::int from channel_slots cs
                where cs.connection_id = ac.id and cs.enabled)                                as slots_filled
         from ad_connections ac
         join channels c on c.id = ac.channel_id
         left join lateral (select json_agg(x) as events from (
                  select from_status, to_status, detail, created_at
                    from ad_connection_events ev2
                   where ev2.connection_id = ac.id
                   order by ev2.created_at desc limit 4) x) ev on true
        order by case ac.status
                   when 'verifying' then 0 when 'failed' then 1 when 'restricted' then 2
                   when 'active' then 3 else 4 end,
                 ac.created_at desc
        limit $1`,
      [Math.min(Number(limit) || 200, 500), String(days)],
    );
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
  // ---- earnings: what the network says, never what we hold ----------------
  /**
   * Completed views and provider-reported revenue, per provider, for a window.
   *
   * `estimate_usd` is OURS and is arithmetic on the configured assumed rate —
   * `revenue_usd` is whatever a provider put in a signed postback, and is
   * frequently null because most networks settle monthly in a portal rather than
   * per view. The two are returned side by side, never blended: a single
   * "earnings" number that mixes a real report with our own arithmetic is how a
   * dashboard starts lying without a line of it being false.
   *
   * Unlocks are joined in because they are the creator's own measure of value —
   * "someone watched an ad for this file" — and views are the network's count of
   * the same event. When they diverge, that is information.
   */
  earningsByProvider({ channelId, days = 30, rpmUsd = 0.2 }) {
    return many(
      `with win as (
         select now() - ($2 || ' days')::interval as since
       ),
       views as (
         select e.provider_id,
                count(*)::int                     as views,
                coalesce(sum(e.revenue_usd), 0)   as reported_usd
           from ad_view_events e, win
          where e.channel_id = $1 and e.completed and e.created_at >= win.since
          group by e.provider_id
       ),
       unlocks as (
         select u.method,
                count(*)::int as unlocks
           from unlocks u, win
          where u.channel_id = $1 and u.revoked_at is null
            and u.granted_at >= win.since
          group by u.method
       )
       select coalesce(v.provider_id, 'unreported') as provider_id,
              coalesce(v.views, 0)                  as views,
              coalesce(v.reported_usd, 0)           as reported_usd,
              round((coalesce(v.views, 0) / 1000.0 * $3)::numeric, 4) as estimate_usd,
              -- Unlocks are the creator's own count of "somebody watched an ad
              -- for this"; views are the network's count of the same event. Both
              -- are shown, and neither is presented as the other.
              (select coalesce(sum(unlocks)::int, 0) from unlocks) as unlocks
         from views v
        where v.provider_id is not null
        order by views desc`,
      [channelId, String(days), rpmUsd],
    );
  },

  /**
   * Per-asset breakdown: which file people watch an ad for.
   *
   * The seller's only real question is which of their files is worth making
   * more of, and the answer is not total views — it is views per file, with the
   * files that have none visible too. Left-joining assets keeps the zeroes.
   */
  earningsByAsset({ channelId, days = 30, rpmUsd = 0.2, limit = 50 }) {
    return many(
      `select a.id as asset_id, a.title, a.slug, a.unlock_mode, a.status,
              coalesce(v.views, 0)::int      as views,
              coalesce(u.unlocks, 0)::int    as unlocks,
              round((coalesce(v.views, 0) / 1000.0 * $3)::numeric, 4) as estimate_usd
         from assets a
         left join (
           select asset_id, count(*)::int as views
             from ad_view_events
            where channel_id = $1 and completed
              and created_at >= now() - ($2 || ' days')::interval
            group by asset_id
         ) v on v.asset_id = a.id
         left join (
           select asset_id, count(*)::int as unlocks
             from unlocks
            where channel_id = $1 and revoked_at is null
              and granted_at >= now() - ($2 || ' days')::interval
            group by asset_id
         ) u on u.asset_id = a.id
        where a.channel_id = $1 and a.status <> 'removed'
        order by coalesce(v.views, 0) desc, a.created_at desc
        limit $4`,
      [channelId, String(days), rpmUsd, limit],
    );
  },

  // ---- payout accounts: a note, not an account ---------------------------
  /**
   * Which of the creator's OWN accounts the network pays into.
   *
   * A label they typed and the method name, and nothing else. This row cannot
   * move money, cannot be used to authenticate anywhere, and is not the
   * network's record — it is so that a creator can look at this page in six
   * months and remember which account they set up, which is the question every
   * support ticket about ad revenue actually asks.
   */
  payoutAccountsOf(channelId) {
    return many(
      'select * from payout_accounts where channel_id = $1 order by provider_id',
      [channelId],
    );
  },

  async setPayoutAccount({ channelId, providerId, accountLabel, payoutMethod = null, note = null }) {
    const label = String(accountLabel || '').trim().slice(0, 120);
    if (!label) return null;
    return one(
      `insert into payout_accounts (channel_id, provider_id, account_label, payout_method, note)
       values ($1, $2, $3, $4, $5)
       on conflict (channel_id, provider_id) do update
         set account_label = excluded.account_label,
             payout_method = excluded.payout_method,
             note          = excluded.note,
             status        = case when payout_accounts.account_label is distinct from excluded.account_label
                                  then 'changed' else payout_accounts.status end,
             updated_at    = now()
       returning *`,
      [channelId, String(providerId).slice(0, 60), label,
        payoutMethod ? String(payoutMethod).trim().slice(0, 60) : null,
        note ? String(note).trim().slice(0, 300) : null],
    );
  },

  async clearPayoutAccount({ channelId, providerId }) {
    return one(
      'delete from payout_accounts where channel_id = $1 and provider_id = $2 returning *',
      [channelId, providerId],
    );
  },

  // ---- what the network actually paid ------------------------------------
  reportsOfChannel(channelId, { limit = 60 } = {}) {
    return many(
      `select * from provider_reports
        where channel_id = $1 order by period_start desc limit $2`,
      [channelId, limit],
    );
  },

  /**
   * Record a figure from the creator's statement.
   *
   * One figure per provider per period start, so a correction replaces the
   * earlier number instead of sitting beside it. A reconciliation that can hold
   * two answers for one month is a reconciliation nobody can act on.
   */
  async addProviderReport({ channelId, providerId, periodStart, periodEnd, reportedUsd, note = null }) {
    const amount = Number(reportedUsd);
    if (!Number.isFinite(amount) || amount < 0) return null;
    const start = String(periodStart || '').slice(0, 10);
    const end = String(periodEnd || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) return null;
    if (end < start) return null;
    return one(
      `insert into provider_reports (channel_id, provider_id, period_start, period_end, reported_usd, note)
       values ($1, $2, $3, $4, $5, $6)
       on conflict (channel_id, provider_id, period_start) do update
         set period_end   = excluded.period_end,
             reported_usd = excluded.reported_usd,
             note         = excluded.note
       returning *`,
      [channelId, String(providerId).slice(0, 60), start, end,
        Math.round(amount * 100) / 100, note ? String(note).trim().slice(0, 300) : null],
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

  /**
   * A day-by-day traffic series, one row per calendar day, INCLUDING the days
   * with no row at all.
   *
   * `generate_series` is the point of this query. The daily table only holds days
   * something happened, so reading it directly would draw a chart that closes the
   * gaps — and a chart that closes a gap is claiming traffic on a day we did not
   * measure. Each point carries `measured` so the drawing code can tell "we
   * recorded nothing" apart from "we recorded zero", which are different facts
   * and the research says so out loud.
   *
   * `unlocks` comes from a separate table on purpose: unlocks are events, not
   * aggregates, and summing them per day is exact.
   */
  async trafficSeries(channelId, { days = 30 } = {}) {
    const window = Math.min(Math.max(Number(days) || 30, 7), 90);
    return many(
      `with span as (
         select generate_series(current_date - ($2::int - 1), current_date, interval '1 day')::date as day
       )
       select span.day,
              pvd.views,
              (pvd.channel_id is not null) as measured,
              coalesce(u.n, 0)::int       as unlocks
         from span
         left join page_view_daily pvd on pvd.channel_id = $1 and pvd.day = span.day
         left join lateral (
           select count(*) as n from unlocks x
            join assets a on a.id = x.asset_id
           where a.channel_id = $1
             and x.revoked_at is null
             and x.granted_at >= span.day
             and x.granted_at < span.day + 1
         ) u on true
        order by span.day`,
      [channelId, window],
    ).then((rows) => rows.map((r) => ({
      day: r.day instanceof Date ? r.day.toISOString().slice(0, 10) : String(r.day).slice(0, 10),
      views: r.views === null ? null : Number(r.views),
      unlocks: Number(r.unlocks) || 0,
      measured: r.measured === true,
    })));
  },

  /**
   * The same series, per file, for the little charts beside each one.
   *
   * One query for every file rather than one per row: a dashboard with nine files
   * must not cost nine round trips. Days with no events are absent here on
   * purpose — the caller pads them, so the shape of a file's month is drawn
   * against the same 30-day window as every other file and as the store's own
   * chart. Comparing two charts on different axes is how a dashboard lies.
   */
  assetAdViewSeries(channelId, { days = 30 } = {}) {
    const window = Math.min(Math.max(Number(days) || 30, 7), 90);
    return many(
      `select a.id as asset_id, d.day::date as day, count(*)::int as views
         from assets a
         cross join generate_series((current_date - ($2::int - 1))::timestamp,
                                    current_date::timestamp, interval '1 day') d(day)
         left join ad_view_events e
                on e.asset_id = a.id and e.completed
               and e.created_at >= d.day and e.created_at < d.day + interval '1 day'
        where a.channel_id = $1
        group by a.id, d.day
        order by a.id, d.day`,
      [channelId, window],
    ).then((rows) => {
      const byAsset = new Map();
      for (const r of rows) {
        const key = r.asset_id;
        if (!byAsset.has(key)) byAsset.set(key, []);
        const day = r.day instanceof Date ? r.day.toISOString().slice(0, 10) : String(r.day).slice(0, 10);
        byAsset.get(key).push({ day, views: Number(r.views) || 0 });
      }
      return byAsset;
    });
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

  /**
   * What the platform has actually been paid, and by how many stores.
   *
   * Read from the same tables the seller's billing page reads, so the console
   * cannot claim money the ledger does not show. `matched` is what a person has
   * confirmed against the statement; anything else is a request, not revenue.
   */
  platformMoney() {
    return one(
      `select
         coalesce((select sum(amount_npr) from plan_payments
                    where status = 'matched'
                      and matched_at >= date_trunc('month', now())), 0)::int as matched_this_month,
         coalesce((select sum(amount_npr) from rent_invoices
                    where status = 'paid'
                      and paid_at >= date_trunc('month', now())), 0)::int as rent_this_month,
         coalesce((select sum(amount_npr) from rent_invoices
                    where status = any($1) and due_at < current_date), 0)::int as rent_late_npr,
         (select count(*)::int from rent_invoices
           where status = any($1) and due_at < current_date) as rent_late_count,
         (select count(*)::int from rent_invoices where status = any($1)) as rent_open_count,
         (select count(distinct channel_id) from subscriptions
           where status in ('active','grace') and plan_code <> 'free')::int as paying_stores,
         (select count(*) from channels where moderation_state <> 'removed')::int as stores,
         (select count(*) from subscriptions where status = 'active' and plan_code <> 'free')::int as active_subs`,
      [OPEN_RENT_STATUSES],
    ).then((r) => ({
      matchedThisMonthNpr: Number(r?.matched_this_month || 0),
      rentThisMonthNpr: Number(r?.rent_this_month || 0),
      rentLateNpr: Number(r?.rent_late_npr || 0),
      rentLateCount: Number(r?.rent_late_count || 0),
      rentOpenCount: Number(r?.rent_open_count || 0),
      payingStores: Number(r?.paying_stores || 0),
      stores: Number(r?.stores || 0),
      activeSubs: Number(r?.active_subs || 0),
    }));
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

  /**
   * Files and unlocks per asset, for the list of a store's own files.
   *
   * Two correlated counts rather than a join and a GROUP BY: the dashboard needs
   * one row per file, and a join against unlocks would either multiply the rows
   * or need a DISTINCT that hides the count it is meant to show.
   */
  assetStats(channelId) {
    return many(
      `select a.id,
              (select count(*) from asset_files f where f.asset_id = a.id) as files,
              (select count(*) from unlocks u where u.asset_id = a.id and u.revoked_at is null) as unlocks
         from assets a
        where a.channel_id = $1`,
      [channelId],
    );
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
    // While the report threshold is hiding a file, the platform owns that file's
    // state, not its seller.
    //
    // This used to be the other way round — any status the seller saved cleared
    // `hidden_by_reports` — and the effect was that the threshold was optional:
    // open the edit page, set the state back to Live, press Save, and a file
    // three people reported was public again. Two clicks, no operator, and the
    // appeal form sitting next to it would have been theatre. The seller keeps
    // every other field; only the state waits for a person.
    const current = await this.assetById(assetId);
    const stateLocked = Boolean(current?.hidden_by_reports);

    const sets = [];
    let statusApplied = false;
    const values = [assetId];
    for (const [key, coerce] of Object.entries(allowed)) {
      if (!(key in patch)) continue;
      if (stateLocked && key === 'status') continue;
      if (key === 'title' && !String(patch.title || '').trim()) continue;
      values.push(coerce(patch[key]));
      sets.push(`${key} = $${values.length}`);
      if (key === 'status') statusApplied = true;
    }
    if (!sets.length) return this.assetById(assetId);
    // A seller who sets the status on a file nobody reported is the seller taking
    // the decision back, and clears any stale flag. On a reported file the branch
    // above never reaches here, so dismissing an old report can no longer un-pause
    // a file its owner deliberately took down.
    if (statusApplied) sets.push('hidden_by_reports = false');
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
    // `returning id` is what makes the audit row honest: `on conflict do nothing`
    // returns no row when the invoice already existed, and this runs on every
    // dashboard view. Writing an audit row unconditionally would fill the log
    // with "invoiced" lines for an invoice that was issued once, months ago —
    // the exact noise that makes an audit log unreadable.
    // The due date is stamped from the terms AS THEY ARE TODAY. An invoice that
    // already exists keeps the date it was sent with, which is why this is a
    // column and not `created_at + dueDays` computed at read time.
    const dueAt = new Date(now.getTime() + RENT_TERMS.dueDays * 86400000).toISOString().slice(0, 10);
    const inserted = await query(
      `insert into rent_invoices (channel_id, period_start, period_end, amount_npr, basis, due_at)
       values ($1, $2, $3, $4, $5, $6)
       on conflict (channel_id, period_start) do nothing
       returning id`,
      [channel.id, period.start, period.end, amountNpr,
        JSON.stringify(rentWorking(estimate, amountNpr)), dueAt],
    );
    const invoice = await one(
      'select * from rent_invoices where channel_id = $1 and period_start = $2',
      [channel.id, period.start],
    );
    if (inserted.rowCount && invoice) {
      // An invoice is money the platform is owed. Until now it appeared in
      // `rent_invoices` and nowhere in the record of what happened — so "when did
      // this charge first appear" had no answer, on a platform whose entire
      // payment flow is a person matching transfers by hand.
      await this.audit('rent.invoice_issued', {
        amountNpr, periodStart: invoice.period_start, periodEnd: invoice.period_end,
        channelSlug: channel.slug, store: channel.name,
        pageviews30d: estimate?.pageviews30d ?? null, rentSlots: estimate?.rent ?? null,
      }, { subjectType: 'channel', subjectId: channel.id });
    }
    return invoice;
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
   * Rent owed, with how late it is — the operator's actual weekly question.
   *
   * Ordered by lateness rather than by amount: the operator's next action depends
   * on age, not on size, and a NPR 300 invoice four months old is a decision while
   * a NPR 3,000 one due next week is not.
   *
   * Returns rows AND the bucket totals, because the view needs both and computing
   * the buckets in the view would mean a second definition of "late".
   */
  rentAging() {
    return many(
      `select r.id, r.channel_id, r.period_start, r.period_end, r.amount_npr, r.status,
              r.due_at, r.created_at, r.submitted_at, r.txn_reference, r.payer_name,
              c.slug as channel_slug, c.name as channel_name,
              u.email as owner_email,
              (current_date - r.due_at)::int as days_late
         from rent_invoices r
         join channels c on c.id = r.channel_id
         left join profiles u on u.id = c.owner_id
        where r.status = any($1)
        order by r.due_at asc nulls last, r.amount_npr desc
        limit 200`,
      [OPEN_RENT_STATUSES],
    );
  },

  /**
   * Rent across time: what each month was billed, and what actually arrived.
   *
   * Grouped by the invoice's own PERIOD, not by when it was paid: March's rent is
   * March's, whether it arrived in March or June. A collection chart grouped by
   * payment date answers "when did cash arrive" — a useful question, and not the
   * one this exists for, which is whether each month's rent is settling.
   *
   * `billed` is what was invoiced for that period and `collected` is the part of
   * it that is paid, so the difference is a number the operator can act on rather
   * than a churn figure nobody can reconcile with the bank.
   */
  rentByMonth({ months = 12 } = {}) {
    return many(
      `select to_char(date_trunc('month', r.period_end), 'YYYY-MM') as month,
              sum(r.amount_npr)::int as billed_npr,
              coalesce(sum(r.amount_npr) filter (where r.status = 'paid'), 0)::int as collected_npr,
              coalesce(sum(r.amount_npr) filter (where r.status = 'waived'), 0)::int as waived_npr,
              count(*)::int as invoices,
              count(*) filter (where r.status = 'paid')::int as paid_invoices,
              count(*) filter (where r.status = any($1) and r.due_at < current_date)::int as late_invoices
         from rent_invoices r
        where r.period_end > (date_trunc('month', current_date) - ($2 || ' months')::interval)
        group by 1 order by 1 desc`,
      [OPEN_RENT_STATUSES, String(Math.max(Number(months) - 1, 0))],
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
          left join profiles o on o.id = c.owner_id
          where c.listing_mode = 'marketplace'
            and c.moderation_state not in ('removed', 'suspended')
            and coalesce(o.banned, false) = false
            and (c.name ilike $1 or c.tagline ilike $1 or c.about ilike $1)
          order by c.created_at limit $2`,
        [like, limit],
      ),
      many(
        `select a.*, c.slug as channel_slug, c.name as channel_name
           from assets a
           join channels c on c.id = a.channel_id
           left join profiles o on o.id = c.owner_id
          where a.status = 'live'
            and c.moderation_state not in ('removed', 'suspended')
            and coalesce(o.banned, false) = false
            and c.listing_mode = 'marketplace'
            -- The file's own state, which this query never used to read: a removed
            -- file stayed in search results and its link landed on a 404, and a
            -- file nobody has looked at yet had no business being the answer to a
            -- stranger's search. The list comes from src/moderation.js, so a state
            -- added there is filtered here without anyone remembering to.
            and a.moderation_state = any($3)
            and (a.title ilike $1 or a.description ilike $1)
          order by a.created_at desc limit $2`,
        [like, limit, SEARCHABLE_ASSET_STATES],
      ),
    ]);
    return { stores, assets, term };
  },

  // ---- what draws in a slot ----------------------------------------------
  /**
   * Every active creative that could fill this channel's slots: the store's own
   * and the platform's. One query, filtered in the composer rather than here,
   * because "which creative wins" is a product rule and belongs with the rest of
   * the product rules.
   */
  creativesForChannel(channelId) {
    return many(
      `select * from slot_creatives
        where active and (channel_id = $1 or owner = 'platform')
        order by owner desc, rank asc, created_at asc`,
      [channelId],
    );
  },

  /**
   * A store writes one message per slot. Replacing it replaces it — a creative
   * library is a feature nobody asked for, and a version history of ad copy is a
   * liability with an audience of one.
   */
  async setCreative({ channelId, slotKey, headline, body = null, imageUrl = null, linkUrl = null, linkLabel = null }) {
    const head = String(headline || '').trim().slice(0, 90);
    if (!head) return null;
    return one(
      `insert into slot_creatives
         (owner, channel_id, slot_key, headline, body, image_url, link_url, link_label)
       values ('channel', $1, $2, $3, $4, $5, $6, $7)
       on conflict (channel_id, slot_key) where owner = 'channel' do update
         set headline   = excluded.headline,
             body       = excluded.body,
             image_url  = excluded.image_url,
             link_url   = excluded.link_url,
             link_label = excluded.link_label,
             active     = true,
             updated_at = now()
       returning *`,
      [channelId, slotKey || '*', head,
        body ? String(body).trim().slice(0, 220) : null,
        imageUrl ? String(imageUrl).trim().slice(0, 300) : null,
        linkUrl ? String(linkUrl).trim().slice(0, 300) : null,
        linkLabel ? String(linkLabel).trim().slice(0, 40) : null],
    );
  },

  async clearCreative({ channelId, slotKey }) {
    return one(
      `update slot_creatives set active = false, updated_at = now()
        where channel_id = $1 and owner = 'channel'
          and slot_key = $2
        returning *`,
      [channelId, slotKey || '*'],
    );
  },

  /**
   * The platform's own creative. Upserted by key rather than appended: the copy
   * lives in code, so a deploy that changes it should change the page and not
   * stack a second house ad beside the first.
   */
  async ensurePlatformCreative({ slotKey = '*', headline, body = null, linkUrl = null, linkLabel = null }) {
    return one(
      `insert into slot_creatives (owner, channel_id, slot_key, headline, body, link_url, link_label)
       values ('platform', null, $1, $2, $3, $4, $5)
       on conflict (slot_key) where owner = 'platform' do update
         set headline = excluded.headline, body = excluded.body,
             link_url = excluded.link_url, link_label = excluded.link_label,
             active = true, updated_at = now()
       returning *`,
      [slotKey, headline, body, linkUrl, linkLabel],
    );
  },

  /** The platform's own inventory. Seeded at boot, never written by a tenant. */
  platformCreatives() {
    return many("select * from slot_creatives where owner = 'platform' and active order by rank");
  },

  /**
   * One audit row.
   *
   * `actorId` and the subject are optional because most of the thirty existing
   * callers do not pass them, and an audit trail that required every call site to
   * be rewritten would not have been written at all. The operator console reads
   * the ones that do.
   */
  async audit(action, meta = {}, { actorId = null, subjectType = null, subjectId = null } = {}) {
    await query(
      `insert into audit_logs (action, actor_id, subject_type, subject_id, meta)
       values ($1, $2, $3, $4, $5)`,
      [action, actorId, subjectType, subjectId, JSON.stringify(meta)],
    );
  },

  /**
   * Find a store.
   *
   * The console could count stores, and moderate one it was already looking at,
   * but there was no way to FIND one: an operator who needed to act on a store
   * they had been told about by name, slug or owner had to guess a URL or scroll
   * Explore. This is the missing index.
   *
   * Every filter is a parameter, every sort key is from a fixed list (never
   * interpolated from the query string), and the total is counted in the same
   * round trip with `count(*) over ()` so a page never disagrees with the header
   * that says how many there are.
   */
  async storeDirectory({ q = '', state = 'all', plan = 'all', sort = 'traffic', page = 1, perPage = 25 } = {}) {
    const SORTS = {
      traffic: 'views_30d desc nulls last, c.created_at desc',
      unlocks: 'unlocks desc, views_30d desc nulls last',
      files: 'files_live desc, c.created_at desc',
      newest: 'c.created_at desc',
      name: 'lower(c.name) asc',
    };
    const order = SORTS[sort] || SORTS.traffic;
    const term = String(q || '').trim();
    const limit = Math.min(Math.max(Number(perPage) || 25, 5), 100);
    const offset = Math.max((Number(page) || 1) - 1, 0) * limit;

    const rows = await many(
      `select c.id, c.slug, c.name, c.tagline, c.created_at, c.listing_mode, c.moderation_state,
              c.moderation_reason, c.owner_id,
              coalesce(s.plan_code, 'free')                                        as plan_code,
              coalesce(s.status, 'active')                                         as sub_status,
              (select count(*)::int from assets a
                where a.channel_id = c.id and a.status = 'live')                   as files_live,
              (select count(*)::int from assets a where a.channel_id = c.id)       as files_total,
              (select coalesce(sum(pv.views), 0)::int from page_view_daily pv
                where pv.channel_id = c.id and pv.day > current_date - 30)         as views_30d,
              (select count(*)::int from unlocks u
                join assets a on a.id = u.asset_id
                where a.channel_id = c.id and u.revoked_at is null)                as unlocks,
              (select count(*)::int from ad_view_events e
                join assets a on a.id = e.asset_id
                where a.channel_id = c.id and e.completed
                  and e.created_at > now() - interval '30 days')                   as ad_views_30d,
              (select count(*)::int from reviews r
                join assets a on a.id = r.asset_id
                where a.channel_id = c.id)                                        as reviews,
              (select max(a.created_at) from assets a where a.channel_id = c.id)   as last_file_at,
              (select max(pv.day) from page_view_daily pv where pv.channel_id = c.id) as last_view_day,
              p.email as owner_email, p.display_name as owner_name,
              count(*) over () as total_rows
         from channels c
         left join lateral (select sub.plan_code, sub.status
                              from subscriptions sub
                             where sub.channel_id = c.id
                             order by sub.created_at desc limit 1) s on true
         left join profiles p on p.id = c.owner_id
        where ($1 = '' or c.name ilike '%' || $1 || '%' or c.slug ilike '%' || $1 || '%'
               or p.email ilike '%' || $1 || '%' or p.display_name ilike '%' || $1 || '%')
          and ($2 = 'all'
               or ($2 = 'held' and c.moderation_state in ('restricted','suspended','removed'))
               or c.moderation_state = $2)
          and ($3 = 'all'
               or ($3 = 'paid' and coalesce(s.plan_code, 'free') <> 'free')
               or ($3 = 'free' and coalesce(s.plan_code, 'free') = 'free'))
        order by ${order}
        limit $4 offset $5`,
      [term, ['all', 'approved', 'restricted', 'suspended', 'removed', 'held'].includes(state) ? state : 'all',
        ['all', 'free', 'paid'].includes(plan) ? plan : 'all', limit, offset],
    );

    return {
      rows,
      total: rows.length ? Number(rows[0].total_rows) : 0,
      page: Math.max(Number(page) || 1, 1),
      perPage: limit,
    };
  },

  /**
   * Everything an operator needs about ONE store, in four queries.
   *
   * The console had a moderation queue and a payments queue, and both of them
   * ended at the store: to answer "is this seller fine, or is this the third
   * time?", an operator had to open four pages and hold the answers in their
   * head. This assembles the picture in one place — who owns it, what they pay,
   * what they published, what has been reported, and what has been decided about
   * it — so a decision can be made from evidence rather than from a hunch.
   *
   * Deliberately absent: anything a creator was paid. That number belongs to the
   * network's statement, and a console that displays an estimate next to real
   * invoices teaches an operator to trust the wrong one.
   */
  async storeDetail(slug) {
    const channel = await one(
      `select c.*, coalesce(s.plan_code, 'free') as plan_code, s.status as sub_status,
              s.period_start, s.period_end, s.pending_plan_code,
              p.display_name as owner_name, p.email as owner_email, p.created_at as owner_since,
              (select count(*)::int from channel_slots cs
                where cs.channel_id = c.id and cs.enabled and cs.payout_party = 'platform') as rent_slots,
              (select count(*)::int from channel_slots cs
                where cs.channel_id = c.id and cs.enabled and cs.payout_party = 'channel')  as own_slots,
              (select count(*)::int from ad_connections ac
                where ac.channel_id = c.id and ac.status = 'active')                       as live_connections
         from channels c
         left join lateral (select sub.plan_code, sub.status, sub.period_start, sub.period_end,
                                   sub.pending_plan_code
                              from subscriptions sub where sub.channel_id = c.id
                             order by sub.created_at desc limit 1) s on true
         left join profiles p on p.id = c.owner_id
        where c.slug = $1`,
      [slug],
    );
    if (!channel) return null;

    const [files, reports, invoice, history] = await Promise.all([
      many(
        `select a.id, a.title, a.slug, a.status, a.unlock_mode, a.created_at,
                (select count(*)::int from unlocks u
                  where u.asset_id = a.id and u.revoked_at is null)                       as unlocks,
                (select count(*)::int from ad_view_events e
                  where e.asset_id = a.id and e.completed)                                as ad_views,
                (select count(*)::int from asset_reports r
                  where r.asset_id = a.id and r.status = 'open')                          as open_reports,
                (select count(*)::int from asset_reports r where r.asset_id = a.id)       as reports_total,
                (select count(*)::int from reviews v where v.asset_id = a.id)             as reviews,
                (select coalesce(avg(v.rating), 0)::numeric(3,2) from reviews v
                  where v.asset_id = a.id)                                                as rating
           from assets a where a.channel_id = $1
          order by a.created_at desc`,
        [channel.id],
      ),
      many(
        // Postgres has no `count(distinct …) over (…)`. A lateral subquery gives
        // the same number per file without a window function — the alternative
        // was one query per row.
        `select r.id, r.reason, r.note, r.status, r.created_at, r.resolved_at,
                a.title as asset_title, a.slug as asset_slug, a.status as asset_status,
                d.reporters
           from asset_reports r
           join assets a on a.id = r.asset_id
           join lateral (select count(distinct x.reporter_id)::int as reporters
                           from asset_reports x where x.asset_id = r.asset_id) d on true
          where r.channel_id = $1
          order by case r.status when 'open' then 0 else 1 end, r.created_at desc
          limit 40`,
        [channel.id],
      ),
      one(
        `select * from rent_invoices where channel_id = $1 order by period_end desc limit 1`,
        [channel.id],
      ),
      many(
        `select l.*, p.display_name as actor_name, p.email as actor_email
           from audit_logs l left join profiles p on p.id = l.actor_id
          where l.subject_id = $1 or l.meta->>'channelId' = $2
          order by l.created_at desc limit 20`,
        [channel.id, channel.id],
      ),
    ]);

    return { channel, files, reports, invoice: invoice || null, history };
  },

  /**
   * The storefronts a crawler may index.
   *
   * Public and not held, and nothing else: a suspended or removed storefront
   * answers 404 on purpose, so listing one in a sitemap would hand a search
   * engine a broken link. `last_changed` is the newest file in the store, because
   * that is the last time the page's content actually changed — a `lastmod` that
   * moves every day teaches a crawler to ignore it.
   */
  indexableStores() {
    return many(
      `select c.slug,
              greatest(
                coalesce(max(a.created_at), c.created_at),
                c.created_at
              ) as last_changed
         from channels c
         left join assets a on a.channel_id = c.id and a.status = 'live'
        where c.moderation_state = 'approved'
          and c.listing_mode = 'marketplace'
        group by c.id, c.slug, c.created_at
        order by last_changed desc
        limit 5000`,
    );
  },

  /**
   * Every statement a creator has entered, with our estimate for the SAME window.
   *
   * This is the query behind the operator's calibration page, and the window is
   * the whole point. The seller's own page compares a month of statements against
   * the last 30 days of views, which is fine as a rough signal and wrong as a
   * measurement — the two windows can be different months entirely. Here the
   * views are counted inside each statement's own period, so the ratio means what
   * it says.
   *
   * `closed` mirrors `periodStatus()` in earnings.js: a period whose end is in the
   * future, or within the last five days, is not settled and is not counted. A
   * network closes its books after the month ends and we cannot claim to know a
   * number it has not published.
   *
   * Returns one row per (store, provider), plus the store and owner for the
   * operator to act on.
   */
  statementCalibration({ graceDays = 5 } = {}) {
    return many(
      `with closed as (
         select r.*, c.name as channel_name, c.slug as channel_slug, c.moderation_state,
                p.email as owner_email, p.display_name as owner_name
           from provider_reports r
           join channels c on c.id = r.channel_id
           left join profiles p on p.id = c.owner_id
          where r.period_end < (current_date - $1::int)
       ),
       -- Views counted only inside the days the statement covers. A period may be
       -- entered twice for the same store and provider only if the dates differ
       -- (the unique key is on period_start), so overlapping periods would
       -- double-count views; the join is a lateral per report instead of a
       -- straight join so each report's window is measured independently.
       per_report as (
         select k.channel_id, k.provider_id, k.id as report_id,
                k.period_start, k.period_end, k.reported_usd,
                coalesce(v.views, 0) as views,
                coalesce(v.events, 0) as events
           from closed k
           left join lateral (
             select count(*) filter (where e.completed)::int as views,
                    count(*)::int                            as events
               from ad_view_events e
              where e.channel_id = k.channel_id
                and e.provider_id = k.provider_id
                and e.created_at >= k.period_start
                and e.created_at < (k.period_end + interval '1 day')
           ) v on true
       )
       select pr.channel_id, c.slug as channel_slug, c.name as channel_name,
              c.moderation_state, p.email as owner_email, p.display_name as owner_name,
              pr.provider_id,
              count(*)::int                        as periods,
              sum(pr.reported_usd)                 as reported_usd,
              sum(pr.views)::int                   as views,
              sum(pr.events)::int                  as events,
              max(pr.period_end)                   as last_period_end,
              min(pr.period_start)                 as first_period_start,
              -- Our arithmetic over the same days, at the rate the platform
              -- assumes, so the two figures are produced the same way the rent
              -- estimate is.
              round((sum(pr.views) / 1000.0 * $2)::numeric, 4) as estimate_usd,
              -- The rate the statements imply. Null when there is nothing to
              -- divide, because a rate from zero views is not zero, it is unknown.
              case when sum(pr.views) > 0
                   then round((sum(pr.reported_usd) / (sum(pr.views) / 1000.0))::numeric, 4)
                   else null end                  as implied_rpm_usd
         from per_report pr
         join channels c on c.id = pr.channel_id
         left join profiles p on p.id = c.owner_id
        group by pr.channel_id, c.slug, c.name, c.moderation_state, p.email, p.display_name, pr.provider_id
        order by sum(pr.reported_usd) desc`,
      [graceDays, POLICY.assumedRpmUsd],
    );
  },

  /**
   * The statements a creator has entered but which are not settled yet.
   *
   * Shown separately and never counted: the page has to be able to say "two more
   * months are open" instead of silently leaving them out, because a creator who
   * entered a figure and does not see it counted will enter it again.
   */
  openStatements() {
    return many(
      `select r.id, r.period_start, r.period_end, r.reported_usd, r.provider_id,
              c.slug as channel_slug, c.name as channel_name,
              (current_date - r.period_end)::int as days_since_end
         from provider_reports r
         join channels c on c.id = r.channel_id
        where r.period_end >= (current_date - 5)
        order by r.period_end desc
        limit 50`,
    );
  },

  /**
   * The audit log, searched rather than dumped.
   *
   * The page this replaces fetched the newest 300 rows, filtered them in
   * JavaScript by substring, and printed "12 of 300" — a number that describes
   * the page's own array, not the table. An operator reading "300" has no way to
   * know whether the table holds 300 rows or 300,000, and the research on audit
   * UIs is unanimous that filters are what make a feed usable "after the first
   * week". So: every filter is SQL, the total is a real count, and the window is
   * paged.
   *
   * The subject is resolved to something a person can read — a store's name, a
   * profile's email — because `asset 4f2c…` is a row nobody can act on, and the
   * research asks for "the target (record type plus a human-friendly name)".
   * Resolution is by id, so it says nothing about a row whose subject has since
   * been deleted: the name falls back to the type alone, and the row stays.
   */
  auditSearch({
    family = 'decisions', actor = '', q = '', since = 'all', page = 1, perPage = 50,
  } = {}) {
    const FAMILY = familyCase();
    const where = [];
    const params = [];
    const bind = (value) => { params.push(value); return `$${params.length}`; };

    // `decisions` is the default view: the families that record a person
    // choosing something. It is a filter, not a hiding — the count of everything
    // else is on the page next to it.
    const decisionKeys = AUDIT_FAMILIES.filter((f) => f.decisions).map((f) => f.key);
    if (family === 'decisions') {
      where.push(`${FAMILY} = any(${bind(decisionKeys)})`);
    } else if (family && family !== 'all') {
      where.push(`${FAMILY} = ${bind(family)}`);
    }
    if (String(actor).trim().length >= 2) {
      const term = `%${String(actor).trim().toLowerCase()}%`;
      const a = bind(term);
      where.push(`(lower(coalesce(p.email, '')) like ${a} or lower(coalesce(p.display_name, '')) like ${a})`);
    }
    if (String(q).trim().length >= 2) {
      const term = `%${String(q).trim().toLowerCase()}%`;
      const a = bind(term);
      // The meta blob is searchable too: a store id or a reference number pasted
      // from an email is exactly how somebody arrives at this page.
      where.push(`(lower(l.action) like ${a} or lower(coalesce(l.meta::text, '')) like ${a})`);
    }
    const SINCE = { day: "now() - interval '24 hours'", week: "now() - interval '7 days'", month: "now() - interval '30 days'" };
    if (SINCE[since]) where.push(`l.created_at > ${SINCE[since]}`);
    const clause = where.length ? `where ${where.join(' and ')}` : '';

    const size = Math.min(Math.max(Number(perPage) || 50, 10), 200);
    const pages = Math.max(Number(page) || 1, 1);

    return withTransaction(async (c) => {
      const rows = await c.query(
        `select l.id, l.action, l.subject_type, l.subject_id, l.meta, l.created_at,
                p.display_name as actor_name, p.email as actor_email, p.role as actor_role,
                case when l.subject_type = 'channel' then ch.name
                     when l.subject_type = 'profile' then pr.email
                     else null end as subject_label,
                case when l.subject_type = 'channel' then ch.slug else null end as subject_slug,
                ${FAMILY} as family,
                count(*) over () as total_rows
           from audit_logs l
           left join profiles p on p.id = l.actor_id
           left join channels ch on l.subject_type = 'channel' and ch.id = l.subject_id
           left join profiles pr on l.subject_type = 'profile' and pr.id = l.subject_id
           ${clause}
          order by l.created_at desc, l.id desc
          limit ${size} offset ${(pages - 1) * size}`,
        params,
      );
      // Counts over every family, unfiltered, so a tab can never show a number
      // that depends on the search box.
      const counts = await c.query(
        `select ${FAMILY} as family, count(*)::int as n, max(created_at) as last_at from audit_logs group by 1`,
      );
      const total = Number(rows.rows[0]?.total_rows || 0);
      return {
        rows: rows.rows,
        total,
        counts: Object.fromEntries(counts.rows.map((r) => [r.family, { n: r.n, last_at: r.last_at }])),
        allRows: counts.rows.reduce((sum, r) => sum + r.n, 0),
        page: pages,
        pages: Math.max(Math.ceil(total / size), 1),
        perPage: size,
      };
    });
  },

  /** The newest rows, unfiltered — what the overview's activity strip reads. */
  recentAudit(limit = 200) {
    return many(
      `select l.*, p.display_name as actor_name, p.email as actor_email
         from audit_logs l left join profiles p on p.id = l.actor_id
        order by l.created_at desc, l.id desc limit $1`,
      [Math.min(Number(limit) || 200, 500)],
    );
  },

  /**
   * Audit rows somebody DECIDED, newest first.
   *
   * `recentAudit` is the raw log and it is mostly `auth.login` and
   * `consent.recorded`. That is right for the audit page, which says it is
   * everything and has a filter — but it is noise on the operator's overview,
   * where the first few rows should be the most recent decisions about money, a
   * store or a connection. No fallback to the raw log on purpose: eight sign-ins
   * dressed up as an activity feed is worse than an empty one, because it looks
   * like evidence of supervision while showing none.
   */
  recentDecisions(limit = 8) {
    const prefixes = ['plan.', 'rent.', 'moderation.', 'ad_connection.', 'creative.',
      'asset.', 'review.', 'report.', 'channel.', 'user.'];
    return many(
      `select l.*, p.display_name as actor_name, p.email as actor_email
         from audit_logs l left join profiles p on p.id = l.actor_id
        where ${prefixes.map((_, i) => `l.action like $${i + 2}`).join(' or ')}
        order by l.created_at desc, l.id desc limit $1`,
      [Math.min(Number(limit) || 8, 200), ...prefixes.map((pfx) => `${pfx}%`)],
    );
  },
};

export function slugify(s) {
  return String(s).toLowerCase().trim()
    .replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').slice(0, 60);
}
