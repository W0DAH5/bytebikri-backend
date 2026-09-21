-- ============================================================================
--  ByteBikri — marketplace schema
-- ============================================================================
--  Supersedes the coin-based schema in ../schema.sql (that model is abandoned).
--
--  DESIGN INVARIANTS — read before changing anything here.
--
--   1. bytebikri never touches money, and content has no price.
--      There is no buyer->seller payment anywhere in this model. A buyer unlocks
--      content by completing rewarded ads; the ad network pays the CHANNEL's own
--      ad account directly. The only money bytebikri receives is its OWN revenue
--      (plan subscriptions, rent) — that is being paid, not holding.
--      No column in this schema represents funds held by the platform.
--
--   2. Channel == store. One entity. A user may own more than one.
--
--   3. Entitlements gate scale and features — never the ability to earn.
--      A Free channel can sell unlimited assets forever.
--
--   4. Every slot declares `surface` and `payout_party`.
--      surface:      app_native (our ad account) | webview (theirs)
--      payout_party: platform (our revenue)      | channel (their revenue)
--      Retrofitting these is expensive; they exist from day one.
--
--   5. Verification results are stored, never documents.
--      No citizenship scans, no PAN images. See seller_verifications.
--
--   6. Ad completion is proven by SERVER-SIDE POSTBACK, never a client callback.
--      A browser callback can be forged, and forging it means free content plus a
--      revenue claim the network will reject. See ad_view_events.
--
--  Conventions: uuid PKs, timestamptz, text+CHECK instead of enums
--  (CHECK constraints are far easier to alter than Postgres enums).
-- ============================================================================

create extension if not exists pgcrypto;

-- ============================================================================
-- 1. IDENTITY
-- ============================================================================

-- IDENTITY ROOT. profiles owns identity; nothing here depends on a specific
-- auth vendor. It previously referenced auth.users(id), so the schema could
-- not run on plain Postgres and could not be tested anywhere but a live
-- Supabase project. Decoupling cost one column and removed a hard dependency.
--
-- Private fields live only here and are never exposed to another user
-- through any buyer-facing query.
create table if not exists profiles (
  id            uuid primary key default gen_random_uuid(),
  -- If Supabase Auth (or any external IdP) is adopted, its subject id lands
  -- here and profiles.id keeps working as the internal key. Null means the
  -- account authenticates through our own session table.
  auth_uid      uuid unique,
  display_name  text,
  -- Private. Never rendered to another user. Sold-by attachment, KYC, billing.
  legal_name    text,
  phone         text,
  email         text,
  role          text not null default 'user' check (role in ('user','moderator','admin')),
  banned        boolean not null default false,
  ban_reason    text,
  locale        text not null default 'ne',
  created_at    timestamptz not null default now()
);
comment on column profiles.legal_name is 'PRIVATE. Never exposed to buyers or sellers.';
comment on column profiles.phone      is 'PRIVATE. Display contact is channel_contact, not this.';

-- ============================================================================
-- 2. CHANNELS  (channel == store, same thing)
-- ============================================================================

create table if not exists channels (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null references profiles(id) on delete cascade,

  slug          text not null unique,          -- /s/<slug> in v1; subdomain later
  name          text not null,
  tagline       text,
  about         text,
  avatar_url    text,
  banner_url    text,

  -- Storefront vs marketplace. Marketplace = bytebikri supplies traffic, and is
  -- therefore a paid capability. Storefront = they bring their own, free forever.
  listing_mode  text not null default 'storefront'
                check (listing_mode in ('storefront','marketplace')),

  -- Public buyer-facing contact ONLY. Never a personal number unless the seller
  -- deliberately chooses to publish one. profiles.phone is the private one.
  channel_contact text,

  -- Fulfilment: digital, physical, or both.
  sells_digital boolean not null default true,
  sells_physical boolean not null default false,

  currency      text not null default 'NPR',

  -- Moderation. Global rules and country rules both resolve into this.
  moderation_state text not null default 'pending'
                check (moderation_state in ('pending','approved','restricted','suspended','removed')),
  moderation_reason text,

  -- Seller-controlled kill switch: instantly stop serving ads across the channel.
  ads_enabled   boolean not null default true,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_channels_owner  on channels(owner_id);
create index if not exists idx_channels_listed on channels(listing_mode, moderation_state);

-- Denormalised discovery stats. Rebuilt by a job, never hand-edited.
-- Ranking reads ONLY these — there is no paid-ranking column, by design.
create table if not exists channel_stats (
  channel_id      uuid primary key references channels(id) on delete cascade,
  sales_count     integer not null default 0,
  sales_30d       integer not null default 0,
  revenue_npr_30d bigint  not null default 0,   -- informational only; we hold no funds
  review_count    integer not null default 0,
  review_avg      numeric(3,2),
  assets_live     integer not null default 0,
  last_sale_at    timestamptz,
  updated_at      timestamptz not null default now()
);
comment on table channel_stats is
  'Drives discovery ranking. Deliberately contains no purchase/advertising field. '
  'Ranking is not purchasable; paid visibility lives in labeled slots.';

-- ============================================================================
-- 3. VERIFICATION  (result only — never the document)
-- ============================================================================

create table if not exists seller_verifications (
  id            uuid primary key default gen_random_uuid(),
  channel_id    uuid not null references channels(id) on delete cascade,

  method        text not null check (method in ('citizenship','passport','pan','business_reg','manual')),
  status        text not null default 'pending'
                check (status in ('pending','verified','rejected','expired')),

  -- Salted hash of the document identifier. Lets us detect the same person
  -- registering twice WITHOUT retaining the identifier itself.
  id_hash       text,

  verified_at   timestamptz,
  verified_by   uuid references profiles(id),   -- moderator, when manual
  expires_at    timestamptz,
  notes         text,

  -- EXPLICIT: no document bytes, no scans, no images. Deliberate.
  docs_retained boolean not null default false check (docs_retained = false),

  created_at    timestamptz not null default now()
);
create index if not exists idx_seller_ver_channel on seller_verifications(channel_id, status);
create index if not exists idx_seller_ver_hash    on seller_verifications(id_hash);
comment on table seller_verifications is
  'Stores the OUTCOME of KYC, never the evidence. Holding citizenship scans is a '
  'breach liability with no operational benefit — verify, then discard the source.';

-- ============================================================================
-- 4. PLANS & SUBSCRIPTIONS
-- ============================================================================

-- Capabilities are data, not code. Adding "ad_free" later is an INSERT, not a
-- migration, because plans will change far more often than the flag set.
create table if not exists plans (
  code          text primary key,               -- free | store | pro
  name          text not null,
  price_npr     integer not null default 0,
  period_months integer not null default 12,
  -- Feature flags. This is the entitlement surface the whole app reads.
  capabilities  jsonb not null default '{}'::jsonb,
  sort_order    integer not null default 0,
  active        boolean not null default true
);
comment on column plans.capabilities is
  'Keys: max_assets, slot_count, can_theme, custom_sections, remove_footer, '
  'marketplace_listed, analytics_level, verified_badge, featured_eligible, ad_free. '
  'Never gate the ability to SELL. Gate scale, surface and polish only.';

create table if not exists subscriptions (
  id            uuid primary key default gen_random_uuid(),
  channel_id    uuid not null references channels(id) on delete cascade,
  plan_code     text not null references plans(code),

  period_start  timestamptz not null default now(),
  period_end    timestamptz not null,

  status        text not null default 'pending_payment'
                check (status in ('pending_payment','active','grace','expired','refunded','cancelled')),

  -- Grace period after period_end before capabilities downgrade. Features are
  -- retained during grace; nothing is ever deleted on expiry.
  grace_until   timestamptz,

  -- Manual QR verification: the buyer submits a reference, an admin matches it
  -- against the platform's own statement. See plan_payments.
  verified_by   uuid references profiles(id),
  verified_at   timestamptz,

  created_at    timestamptz not null default now()
);
create index if not exists idx_subs_channel on subscriptions(channel_id, status);
create index if not exists idx_subs_end     on subscriptions(period_end) where status in ('active','grace');

-- One row per plan payment attempt. Volume is LOW (annual), which is exactly why
-- manual verification is viable here and would not be for orders.
create table if not exists plan_payments (
  id             uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references subscriptions(id) on delete cascade,
  amount_npr     integer not null,

  -- Submitted by the payer. REQUIRED — without it a payment cannot be attributed
  -- when several arrive on the same day.
  txn_reference  text not null,
  payer_name     text,
  payer_number   text,
  method         text not null default 'esewa' check (method in ('esewa','khalti','imepay','bank','other')),

  status         text not null default 'submitted'
                 check (status in ('submitted','matched','rejected','duplicate')),
  matched_by     uuid references profiles(id),   -- admin checked their statement
  matched_at     timestamptz,
  reject_reason  text,

  created_at     timestamptz not null default now()
);
create unique index if not exists uq_plan_payment_ref on plan_payments(txn_reference);
comment on table plan_payments is
  'Admin verifies against the platform''s OWN bank/eSewa statement, not a screenshot. '
  'A screenshot proves a transfer was initiated; the statement proves it arrived. '
  'txn_reference is required so a payment can be attributed to one channel.';
comment on column plan_payments.status is
  'submitted -> matched | rejected. Upgrades are rare (annual), so manual is cheap.';

-- ============================================================================
-- 5. ASSETS
-- ============================================================================

create table if not exists assets (
  id            uuid primary key default gen_random_uuid(),
  channel_id    uuid not null references channels(id) on delete cascade,

  title         text not null,
  slug          text not null,
  description   text,
  cover_url     text,

  kind          text not null default 'digital'
                check (kind in ('digital','physical','service')),
  -- For digital: file, template, ebook, video, audio, image, software, other
  format        text,

  price_npr     integer not null default 0,      -- 0 == free
  compare_at_npr integer,                        -- optional strike-through

  status        text not null default 'draft'
                check (status in ('draft','pending_review','live','paused','removed')),
  moderation_state text not null default 'pending'
                check (moderation_state in ('pending','approved','restricted','removed')),

  -- File delivery. Populated when the storage adapter lands; see asset_files.
  delivery_kind text check (delivery_kind in ('file','link','none')),
  -- How a buyer gets in. Default is ad-gated: there is no price in this model.
  unlock_mode   text not null default 'ad_gated'
                check (unlock_mode in ('open','ad_gated','paid')),  -- 'paid' reserved, not built

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (channel_id, slug)
);
create index if not exists idx_assets_channel on assets(channel_id, status);
create index if not exists idx_assets_live    on assets(status, moderation_state);

-- Multiple files per asset (a course = many files). Signed, expiring URLs are
-- generated per entitlement at download time — the storage key itself is never
-- exposed, so a URL cannot be forwarded and reused.
create table if not exists asset_files (
  id            uuid primary key default gen_random_uuid(),
  asset_id      uuid not null references assets(id) on delete cascade,
  storage_key   text not null,                   -- never public
  filename      text not null,
  mime_type     text,
  size_bytes    bigint,
  version       integer not null default 1,
  checksum      text,
  sort_order    integer not null default 0,
  created_at    timestamptz not null default now()
);
create index if not exists idx_asset_files_asset on asset_files(asset_id, sort_order);
comment on table asset_files is
  'This replaces the old WebTorrent path. A magnet URI cannot be revoked, so it '
  'cannot gate a paywall — which is the entire product. Storage keys stay server-side.';

-- Per-country visibility. "Policy same globally + country-wise moderation"
-- resolves to this: one asset can be visible in NP and blocked in IN.
create table if not exists asset_country_rules (
  id            uuid primary key default gen_random_uuid(),
  asset_id      uuid not null references assets(id) on delete cascade,
  country_code  text not null,                   -- ISO-3166 alpha-2, e.g. 'NP'
  state         text not null check (state in ('allowed','restricted','blocked')),
  reason        text,
  created_at    timestamptz not null default now(),
  unique (asset_id, country_code)
);

-- ============================================================================
-- 6. ACCESS  (ad-gated unlocks — no buyer->seller money exists anywhere)
-- ============================================================================
--  READ THIS BEFORE ADDING A PAYMENT COLUMN.
--
--  There is no payment between buyer and seller in this model, and no price.
--  A buyer unlocks content by completing rewarded ads. The ad revenue is paid
--  by the ad network to the CHANNEL's own ad account, directly. bytebikri is
--  not in that path and holds nothing at any point.
--
--  The only money that enters bytebikri is the platform's OWN revenue:
--  plan subscriptions and rent. That is being paid, not holding.
--
--  Consequence worth noticing: with no price there is no transaction, and so
--  there is no transaction to move off-platform. The leakage problem that
--  dominates normal marketplaces does not exist here.

-- Proved by the network's server-side postback (see ad_view_events), never by
-- a client callback — a client callback can be forged to unlock for free.

create table if not exists unlocks (
  id            uuid primary key default gen_random_uuid(),
  asset_id      uuid not null references assets(id) on delete cascade,
  channel_id    uuid not null references channels(id) on delete cascade,
  user_id       uuid not null references profiles(id) on delete cascade,

  method        text not null default 'rewarded_ad'
                check (method in ('rewarded_ad','offerwall','survey','manual','paid')),
  ads_completed smallint not null default 0,

  granted_at    timestamptz not null default now(),
  expires_at    timestamptz,                    -- null = permanent
  revoked_at    timestamptz,
  revoked_reason text,
  download_count integer not null default 0,

  unique (asset_id, user_id)
);
create index if not exists idx_unlocks_user    on unlocks(user_id) where revoked_at is null;
create index if not exists idx_unlocks_channel on unlocks(channel_id);
create index if not exists idx_unlocks_expiry  on unlocks(expires_at) where expires_at is not null;
comment on table unlocks is
  'Replaces the old orders+entitlements pair. Access is the product here, not a sale. '
  'expires_at supports re-lock (watch again tomorrow), which is what makes rewarded '
  'inventory recurring rather than one-off.';

-- Per-asset unlock setting, so one channel can mix open / ad-gated / paid.
create table if not exists asset_unlock_policy (
  asset_id            uuid primary key references assets(id) on delete cascade,
  mode                text not null default 'ad_gated'
                      check (mode in ('open','ad_gated','paid')),
  ads_required        smallint not null default 1 check (ads_required between 0 and 20),
  ad_min_seconds      smallint not null default 15,
  -- 0 = permanent unlock. Otherwise the asset re-locks after N hours, which is
  -- how a channel earns from the same visitor more than once.
  unlock_hours        integer not null default 24 check (unlock_hours >= 0),
  max_unlocks_per_day smallint,                 -- per-user anti-abuse ceiling
  updated_at          timestamptz not null default now()
);

-- Completion events. THIS is the revenue-bearing record and the unlock proof.
--
-- Fed by a server-to-server postback from the ad network, with signature
-- verification. A browser-side callback must never be trusted: it is trivially
-- forged, and forging it means free content plus a revenue claim we cannot
-- substantiate to the provider.
create table if not exists ad_view_events (
  id            bigserial primary key,
  channel_id    uuid references channels(id) on delete set null,
  user_id       uuid references profiles(id) on delete set null,
  asset_id      uuid references assets(id) on delete set null,

  provider_id   text not null,                  -- registry id
  external_id   text,                           -- provider's reward/transaction id
  kind          text not null default 'rewarded'
                check (kind in ('rewarded','offerwall','survey','display')),
  completed     boolean not null default false,
  duration_sec  smallint,

  -- Provider-reported if available. Informational: the channel's earnings
  -- statement lives at the network, not here, and we never claim to be the
  -- authority on what they were paid.
  revenue_usd   numeric(10,4),

  signature_ok  boolean not null default false,
  raw           jsonb,
  ip_hash       text,
  created_at    timestamptz not null default now()
);
create unique index if not exists uq_ad_view_external
  on ad_view_events(provider_id, external_id) where external_id is not null;
create index if not exists idx_ad_view_channel on ad_view_events(channel_id, created_at desc);
create index if not exists idx_ad_view_user    on ad_view_events(user_id, created_at desc);
comment on table ad_view_events is
  'Server-side postbacks only. One row per billable completed view. Also powers '
  'the channel''s own earnings ESTIMATE — clearly labeled as ours, never as their '
  'statement, because the network is the authority on what they were paid.';

-- Access log for delivery. Signed, expiring URLs are minted per unlock; the
-- storage key itself never leaves the server, so a URL cannot be forwarded.
create table if not exists download_events (
  id            bigserial primary key,
  unlock_id     uuid not null references unlocks(id) on delete cascade,
  asset_file_id uuid not null references asset_files(id) on delete cascade,
  ip_hash       text,
  user_agent    text,
  created_at    timestamptz not null default now()
);
create index if not exists idx_downloads_unlock on download_events(unlock_id, created_at desc);

-- 7. REVIEWS  (verified-purchase only, structurally)
-- ============================================================================

create table if not exists reviews (
  id            uuid primary key default gen_random_uuid(),
  unlock_id     uuid not null unique references unlocks(id) on delete cascade,
  asset_id      uuid not null references assets(id) on delete cascade,
  channel_id    uuid not null references channels(id) on delete cascade,
  buyer_id      uuid not null references profiles(id) on delete cascade,

  rating        smallint not null check (rating between 1 and 5),
  body          text,

  -- Seller may reply once.
  seller_response text,
  seller_responded_at timestamptz,

  moderation_state text not null default 'published'
                check (moderation_state in ('published','hidden','removed')),
  created_at    timestamptz not null default now()
);
create index if not exists idx_reviews_asset   on reviews(asset_id, moderation_state);
create index if not exists idx_reviews_channel on reviews(channel_id, moderation_state);
comment on table reviews is
  'unlock_id is NOT NULL and UNIQUE. Verification is structural, not a badge: a '
  'review cannot exist without a real unlock, which required a completed ad view. '
  'Weaker signal than a paid purchase, but it cannot be faked, and it is the '
  'strongest proof this model can produce.';

-- ============================================================================
-- 8. DISPUTES & ENFORCEMENT
-- ============================================================================

create table if not exists disputes (
  id            uuid primary key default gen_random_uuid(),
  unlock_id     uuid not null references unlocks(id) on delete cascade,
  raised_by     uuid not null references profiles(id),
  reason        text not null
                check (reason in ('not_delivered','wrong_item','broken_file','misrepresented','fraud','other')),
  detail        text,

  status        text not null default 'open'
                check (status in ('open','seller_responded','resolved','rejected','escalated')),
  seller_reply  text,

  -- bytebikri holds no funds, so it CANNOT refund. Its lever is access and
  -- visibility — which is exactly what marketplaces with real leverage use.
  -- No 'refund' option exists: no money changed hands for content in this model.
  resolution    text check (resolution in ('none','access_granted','asset_fixed','asset_removed','channel_suspended','banned')),
  resolved_by   uuid references profiles(id),
  resolved_at   timestamptz,

  created_at    timestamptz not null default now()
);
create index if not exists idx_disputes_unlock  on disputes(unlock_id);
create index if not exists idx_disputes_status  on disputes(status, created_at desc);
comment on table disputes is
  'Complaints here are about CONTENT QUALITY (broken file, misrepresented), not about '
  'money — there is no money. bytebikri has nothing to refund and never adjudicates '
  'payment. Sanctions are access and visibility: fix, grant access, delist, suspend, ban.';

-- Consequence ladder. Deliberately separate from disputes so a pattern can
-- accumulate across several buyers reporting the same seller.
create table if not exists channel_strikes (
  id            uuid primary key default gen_random_uuid(),
  channel_id    uuid not null references channels(id) on delete cascade,
  dispute_id    uuid references disputes(id) on delete set null,
  severity      smallint not null check (severity between 1 and 3),
  action        text not null
                check (action in ('warning','asset_removed','marketplace_delisted','suspended','banned')),
  note          text,
  issued_by     uuid references profiles(id),
  expires_at    timestamptz,                     -- minor strikes can age out
  created_at    timestamptz not null default now()
);
create index if not exists idx_strikes_channel on channel_strikes(channel_id, created_at desc);

-- ============================================================================
-- 9. AD LAYER
-- ============================================================================

-- Slot TEMPLATE. Platform-owned. Tenants never create, resize or reposition a
-- slot — they only decide what fills it. This is the "we own WHERE, they own
-- WHAT" rule expressed in data.
create table if not exists slot_definitions (
  key           text primary key,                -- top_leaderboard, in_article_1 ...
  label         text not null,
  rank          integer not null,                -- 1 = most valuable position
  formats       text[] not null default '{display}',
  max_height_px integer,                         -- fixed height: reserves space, no CLS
  surfaces      text[] not null default '{webview,app_native}',
  active        boolean not null default true
);
comment on column slot_definitions.rank is
  'Value rank. The platform rent slot must never take rank 1 — see slot policy.';

-- A tenant's ad-provider connection. One channel may hold several.
create table if not exists ad_connections (
  id            uuid primary key default gen_random_uuid(),
  channel_id    uuid not null references channels(id) on delete cascade,
  provider_id   text not null,                   -- registry id, e.g. 'adsterra'

  -- Credentials live in a secret store (KMS/env). This row holds a REFERENCES
  -- ONLY — never the publisher/zone id or a token in plaintext.
  credential_ref text,
  credential_label text,                         -- non-secret display hint

  onboarding    text not null
                check (onboarding in ('oauth','paste_credentials','signup_redirect')),
  status        text not null default 'draft'
                check (status in ('draft','redirecting','verifying','active','restricted','revoked','failed')),
  status_reason text,

  -- Result of the Nepal payout check at connect time, snapshotted so a later
  -- registry change does not silently rewrite what the user was shown.
  payout_verdict text,

  -- Set when the user arrived via our outbound referral link. SERVER-SIDE ONLY:
  -- this must never appear in a client payload or API response.
  referral_attributed boolean not null default false,
  referral_recorded_at timestamptz,

  connected_at  timestamptz,
  revoked_at    timestamptz,
  created_at    timestamptz not null default now()
);
create index if not exists idx_ad_conn_channel  on ad_connections(channel_id, status);
create index if not exists idx_ad_conn_provider on ad_connections(provider_id);
comment on column ad_connections.credential_ref is
  'Opaque handle into a secret store. Writing a publisher id or token into this '
  'column directly would leak every tenant''s ad account.';
comment on column ad_connections.referral_attributed is
  'Internal revenue attribution only. Never surfaced to the tenant — the tenant''s '
  'earnings statement is the network''s, not ours.';

-- State-machine history. Onboarding leaves the app (OAuth/redirect) and can fail
-- halfway; without this, support tickets are unanswerable.
create table if not exists ad_connection_events (
  id            bigserial primary key,
  connection_id uuid not null references ad_connections(id) on delete cascade,
  from_status   text,
  to_status     text not null,
  detail        text,
  created_at    timestamptz not null default now()
);
create index if not exists idx_ad_conn_events on ad_connection_events(connection_id, created_at desc);

-- Slot instance on a channel's page.
create table if not exists channel_slots (
  id            uuid primary key default gen_random_uuid(),
  channel_id    uuid not null references channels(id) on delete cascade,
  slot_key      text not null references slot_definitions(key),

  -- WHICH SURFACE. app_native = our AdMob inventory, revenue to us.
  -- webview = the channel's own web page, their ad code, revenue to them.
  surface       text not null default 'webview'
                check (surface in ('webview','app_native')),

  -- WHO GETS PAID. This is the whole model, in one column.
  payout_party  text not null default 'channel'
                check (payout_party in ('channel','platform')),

  enabled       boolean not null default true,

  -- Null when payout_party = 'platform' (we fill it from our own account),
  -- or when the channel has not connected a provider yet.
  connection_id uuid references ad_connections(id) on delete set null,

  created_at    timestamptz not null default now(),
  unique (channel_id, slot_key, surface)
);
create index if not exists idx_channel_slots on channel_slots(channel_id) where enabled;
comment on column channel_slots.payout_party is
  'platform = the rent slot (our revenue). channel = theirs, paid direct by the '
  'network. The allocation policy decides which is which; never both for one slot.';

-- ============================================================================
-- 10. TRAFFIC COUNTING
-- ============================================================================

-- Aggregated daily. Server-side and authoritative — never a client ping.
--
-- NOTE THE INCENTIVE: plans are traffic-banded, so a higher number costs the
-- seller more. They are motivated to DEFLATE. Therefore: count server-side,
-- dedupe, and bill on a trailing 30-day average so a viral month is not
-- punished. One counter serves billing, slot valuation and our own ad pricing.
create table if not exists page_view_daily (
  channel_id      uuid not null references channels(id) on delete cascade,
  day             date not null,
  views           bigint not null default 0,
  unique_visitors bigint not null default 0,
  app_views       bigint not null default 0,     -- from the native app
  web_views       bigint not null default 0,
  primary key (channel_id, day)
);
create index if not exists idx_pvd_day on page_view_daily(day desc);
comment on table page_view_daily is
  'Aggregate only. Raw events are retained short-term (bot filtering, dispute '
  'appeals) then dropped. Billing uses a trailing 30-day average, never a spike.';

-- Bot/duplicate exclusion telemetry, so a disputed count can be explained.
create table if not exists page_view_rejects (
  channel_id  uuid not null references channels(id) on delete cascade,
  day         date not null,
  reason      text not null
              check (reason in ('bot_ua','bot_behaviour','duplicate','owner_selfview','refresh','prefetch')),
  count       bigint not null default 0,
  primary key (channel_id, day, reason)
);

-- ============================================================================
-- 11. POLICY & MODERATION
-- ============================================================================

-- Global rules plus country-scoped overrides. country_code NULL == global.
create table if not exists policy_rules (
  id            uuid primary key default gen_random_uuid(),
  code          text not null unique,            -- e.g. 'adult', 'gambling', 'counterfeit'
  title         text not null,
  description   text,

  scope         text not null default 'global' check (scope in ('global','country')),
  country_code  text,                            -- required when scope = 'country'

  default_state text not null default 'restricted'
                check (default_state in ('allowed','restricted','blocked')),
  severity      smallint not null default 2 check (severity between 1 and 3),

  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  check ((scope = 'country') = (country_code is not null))
);
create index if not exists idx_policy_lookup on policy_rules(code, country_code);

-- Each moderation action is recorded. Lets a decision be explained months later,
-- which matters when a seller appeals or a network asks.
create table if not exists moderation_actions (
  id            bigserial primary key,
  subject_type  text not null check (subject_type in ('channel','asset','review','profile')),
  subject_id    uuid not null,
  action        text not null
                check (action in ('approve','restrict','remove','suspend','reinstate','warn')),
  rule_code     text references policy_rules(code),
  country_code  text,
  reason        text,
  actor_id      uuid references profiles(id),
  automated     boolean not null default false,
  created_at    timestamptz not null default now()
);
create index if not exists idx_mod_subject on moderation_actions(subject_type, subject_id, created_at desc);

-- Per-country enforcement result for a single asset.
create table if not exists content_geo_blocks (
  id            bigserial primary key,
  subject_type  text not null check (subject_type in ('channel','asset')),
  subject_id    uuid not null,
  country_code  text not null,
  rule_code     text references policy_rules(code),
  created_at    timestamptz not null default now(),
  unique (subject_type, subject_id, country_code)
);

-- ============================================================================
-- 12. NOTIFICATIONS
-- ============================================================================

create table if not exists notifications (
  id            bigserial primary key,
  user_id       uuid not null references profiles(id) on delete cascade,
  type          text not null,                   -- order.paid, dispute.opened, plan.verified ...
  title         text not null,
  body          text,
  link          text,
  payload       jsonb,

  -- In-app is the source of truth; email is the v1 fallback. SMS/Viber only for
  -- order-critical events, because those cost money per message.
  sent_inapp    boolean not null default true,
  sent_email    boolean not null default false,
  sent_sms      boolean not null default false,

  read_at       timestamptz,
  created_at    timestamptz not null default now()
);
create index if not exists idx_notif_user on notifications(user_id, read_at, created_at desc);

-- ============================================================================
-- 13. AUDIT
-- ============================================================================

create table if not exists audit_logs (
  id            bigserial primary key,
  action        text not null,
  actor_id      uuid,
  subject_type  text,
  subject_id    uuid,
  meta          jsonb,
  created_at    timestamptz not null default now()
);
create index if not exists idx_audit_action  on audit_logs(action, created_at desc);
create index if not exists idx_audit_subject on audit_logs(subject_type, subject_id);

-- ============================================================================
-- 14. ROW LEVEL SECURITY  (outline — enforce these before launch)
-- ============================================================================
-- RLS is not optional here: profiles.legal_name and profiles.phone must never
-- reach a buyer-facing query, and one seller must never read another's orders.
--
--   profiles        : self + moderators only.
--   channels        : public read on approved channels; owner write.
--                     NEVER expose owner_id -> profiles.legal_name.
--   assets          : public read when status='live' and moderation_state='approved';
--                     owner write; respect content_geo_blocks for the viewer's country.
--   unlocks         : the unlocking user, the channel owner, moderators.
--   ad_view_events  : server-side only. Never client-writable: a forged row is free content.
--   asset_files     : NO direct client access. storage_key is server-side only;
--                     downloads go through a signed-URL endpoint.
--   reviews         : public read when published; insert only via a confirmed order.
--   ad_connections  : channel owner + admin. credential_ref never leaves the server.
--   plan_payments   : payer + admins.
--
-- Also required before launch: a trigger maintaining channels.updated_at, and a
-- nightly job rebuilding channel_stats and rolling page_view_daily.
-- ============================================================================

-- ============================================================================
-- 15. SEED — plans
-- ============================================================================

insert into plans (code, name, price_npr, period_months, sort_order, capabilities) values
  ('free', 'Free', 0, 12, 0, jsonb_build_object(
      'max_assets', 20, 'slot_count', 3,
      'can_theme', false, 'custom_sections', 0, 'remove_footer', false,
      'marketplace_listed', false, 'analytics_level', 'basic',
      'verified_badge', false, 'featured_eligible', false, 'ad_free', false)),
  ('store', 'Store', 999, 12, 1, jsonb_build_object(
      'max_assets', 200, 'slot_count', 5,
      'can_theme', true, 'custom_sections', 3, 'remove_footer', true,
      'marketplace_listed', false, 'analytics_level', 'sources',
      'verified_badge', true, 'featured_eligible', false, 'ad_free', false)),
  ('pro', 'Pro', 2499, 12, 2, jsonb_build_object(
      'max_assets', -1, 'slot_count', 8,
      'can_theme', true, 'custom_sections', -1, 'remove_footer', true,
      'marketplace_listed', true, 'analytics_level', 'full',
      'verified_badge', true, 'featured_eligible', true, 'ad_free', false))
on conflict (code) do nothing;
-- max_assets = -1 means unlimited. custom_sections = -1 means unlimited.

-- Slot template. rank 5 is the rent slot: the LAST position, never rank 1, and
-- it is only allocated when a channel has enough slots to spare.
insert into slot_definitions (key, label, rank, formats, max_height_px, surfaces) values
  ('top_leaderboard', 'Top of store',        1, '{display}',        250, '{webview,app_native}'),
  ('in_article_1',    'In content (first)',  2, '{display,native}', 280, '{webview}'),
  ('sidebar_sticky',  'Sidebar',             3, '{display}',        600, '{webview}'),
  ('in_article_2',    'In content (second)', 4, '{display,native}', 280, '{webview}'),
  ('footer_native',   'Footer',              5, '{native,display}', 250, '{webview,app_native}')
on conflict (key) do nothing;

-- Global policy starting point. Country rows are added per scope as needed.
insert into policy_rules (code, title, scope, default_state, severity, description) values
  ('adult',         'Adult content',        'global', 'restricted', 3, 'Restricted by default; country overrides apply.'),
  ('gambling',      'Gambling',             'global', 'restricted', 2, 'Regulated in Nepal; requires review.'),
  ('counterfeit',   'Counterfeit goods',    'global', 'blocked',    3, 'Always blocked.'),
  ('malware',       'Malware / exploits',   'global', 'blocked',    3, 'Always blocked.'),
  ('copyright',     'Copyright infringement','global','blocked',    3, 'Always blocked. Report and remove.'),
  ('personal_data', 'Sale of personal data','global', 'blocked',    3, 'Always blocked.'),
  ('weapons',       'Weapons / regulated',  'global', 'restricted', 2, 'Country overrides apply.'),
  ('financial_scam','Financial fraud',      'global', 'blocked',    3, 'Always blocked.'),
  ('health_claims', 'Unproven health claims','global','restricted', 1, 'Review at scale.')
on conflict (code) do nothing;
