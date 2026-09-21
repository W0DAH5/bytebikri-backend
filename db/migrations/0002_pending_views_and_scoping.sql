-- ============================================================================
--  0002 — the tables the unlock engine actually needs
-- ============================================================================
--  Found by reading the code against the schema instead of assuming. Three
--  drifts, all of which would have failed only in production:
--
--  1. pending_views DID NOT EXIST. Every unlock starts by minting a pending
--     view and the postback resolves against it. The in-memory store had one;
--     the database never did. Nothing would have worked.
--
--  2. ad_view_events had no connection_id, and its uniqueness was
--     (provider_id, external_id). Routing became CONNECTION-scoped in
--     commit f64ac28 (two channels can both use BitLabs with different
--     secrets), so provider-scoped uniqueness is wrong: two channels on the
--     same network could collide on a transaction id and one channel's
--     completed view would be silently swallowed as a duplicate of the
--     other's. 0001 was written before that change and never revisited.
--
--  3. ad_refs DID NOT EXIST. The opaque uuid4 we hand an ad network instead of
--     a user id was map-only. Lost on restart, and then every callback fails
--     to resolve to anybody.
-- ============================================================================

-- ── 1. pending ad views ─────────────────────────────────────────────────────
-- One row per unlock attempt awaiting a signed postback. This is the record the
-- postback resolves against: identity comes from HERE, never from the payload.
create table if not exists pending_views (
  id             uuid primary key default gen_random_uuid(),
  nonce          text not null,

  asset_id       uuid not null references assets(id) on delete cascade,
  channel_id     uuid not null references channels(id) on delete cascade,
  user_id        uuid not null references profiles(id) on delete cascade,
  connection_id  uuid not null references ad_connections(id) on delete cascade,
  provider_id    text not null,

  required_ads   smallint not null default 1,
  ad_min_seconds smallint not null default 15,

  completed      boolean not null default false,
  completed_at   timestamptz,
  created_at     timestamptz not null default now()
);
create index if not exists idx_pending_open on pending_views(connection_id, user_id, created_at desc)
  where completed = false;
create index if not exists idx_pending_asset on pending_views(asset_id, user_id);
-- Mints are cheap to spam, and each one is a row. A view that is never
-- completed is garbage within the hour; the sweep is bounded by this index.
create index if not exists idx_pending_sweep on pending_views(created_at)
  where completed = false;
comment on table pending_views is
  'An unlock attempt awaiting a signed postback. The postback resolves identity '
  'from this row, never from the payload: a signed callback is evidence that a '
  'view happened, not evidence of who the user is.';

-- ── 2. ad_view_events: connection-scoped, plus the normalized state ─────────
alter table ad_view_events
  add column if not exists connection_id uuid references ad_connections(id) on delete set null,
  add column if not exists state text not null default 'complete',
  add column if not exists meta jsonb not null default '{}'::jsonb;

alter table ad_view_events drop constraint if exists ad_view_events_state_check;
alter table ad_view_events add constraint ad_view_events_state_check
  check (state in ('complete','pending','reconciled','screenout','ban','unknown'));

-- Replace provider-scoped uniqueness with connection-scoped uniqueness.
-- external_id stays nullable because not every provider sends a usable
-- transaction id; those rows are deduped by pending_views.completed instead.
drop index if exists uq_ad_view_external;
create unique index if not exists uq_ad_view_connection_external
  on ad_view_events(connection_id, external_id)
  where external_id is not null and connection_id is not null;

-- ── 3. opaque ad-network references ─────────────────────────────────────────
-- The only identifier an ad network ever sees. A real user id or email here
-- would hand a third party the key to a person's account.
create table if not exists ad_refs (
  ref        uuid primary key default gen_random_uuid(),
  user_id    uuid not null unique references profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);
comment on table ad_refs is
  'Opaque uuid4 handed to ad networks in place of a user id. Stable per user so '
  'their anti-fraud still works across views; meaningless outside this database.';

-- ── 4. audit log shape ──────────────────────────────────────────────────────
-- 0001 declares audit_logs; the store writes action + meta. Confirm the shape
-- matches so the write path is not the next surprise.
do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_name = 'audit_logs' and column_name = 'action') then
    alter table audit_logs add column action text;
  end if;
  if not exists (select 1 from information_schema.columns
                 where table_name = 'audit_logs' and column_name = 'meta') then
    alter table audit_logs add column meta jsonb not null default '{}'::jsonb;
  end if;
end $$;
