-- ============================================================================
--  SUPERSEDED — do not use.
--  This is the original coin-based schema (coin_balances, purchases, WebTorrent
--  info_hash). bytebikri does not run a coin economy: coins were dropped, and
--  P2P delivery cannot gate a paywall. The live schema is ../db/schema.sql.
-- ============================================================================

create extension if not exists pgcrypto;

create table IF NOT EXISTS profiles (
  id uuid primary key references auth.users(id),
  display_name text,
  role text default 'user',
  tier text default 'basic',
  banned boolean default false,
  created_at timestamptz default now()
);

create table IF NOT EXISTS coin_balances (
  user_id uuid primary key references profiles(id),
  coins bigint default 0,
  updated_at timestamptz default now()
);

create table IF NOT EXISTS assets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references profiles(id),
  title text not null,
  price_coins integer default 0,
  file_url text,
  magnet_uri text,
  info_hash text,
  file_size bigint,
  preview_url text,
  type text default 'small',
  flagged boolean default false,
  created_at timestamptz default now()
);

create index IF NOT EXISTS idx_assets_info_hash on assets(info_hash);
create index IF NOT EXISTS idx_assets_owner on assets(owner_id);

create table IF NOT EXISTS purchases (
  id uuid primary key default gen_random_uuid(),
  buyer_id uuid references profiles(id),
  asset_id uuid references assets(id),
  coins_spent integer,
  created_at timestamptz default now()
);

create index IF NOT EXISTS idx_purchases_buyer on purchases(buyer_id);
create index IF NOT EXISTS idx_purchases_asset on purchases(asset_id);

create table IF NOT EXISTS flagged_assets (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid references assets(id),
  reporter_id uuid references profiles(id),
  reason text,
  created_at timestamptz default now()
);

create table IF NOT EXISTS audit_logs (
  id uuid primary key default gen_random_uuid(),
  action text,
  actor_id uuid,
  target_id uuid,
  meta jsonb,
  created_at timestamptz default now()
);

create index IF NOT EXISTS idx_audit_logs_action on audit_logs(action);
create index IF NOT EXISTS idx_audit_logs_created on audit_logs(created_at desc);