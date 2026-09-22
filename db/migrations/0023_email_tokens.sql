-- ============================================================================
--  0023 — one kind of link, two reasons to send one
-- ============================================================================
--  0022 added `password_resets` for exactly one flow. Email verification needs
--  the same machinery — a random token, only its hash stored, one live token at a
--  time, single use, an expiry — and the choice was to write a second table that
--  looks like the first, or to say out loud that these are the same thing.
--
--  They are the same thing. Two tables with identical columns would drift: one
--  would get the fix for the resend race, the other would not, and nobody would
--  notice until a link misbehaved. So there is one table with a `kind`, and the
--  "one live token" rule is per user AND kind — a pending confirmation link must
--  not silently kill a password reset the person is waiting for, which is exactly
--  the bug a plain unique index on user_id would have introduced.
--
--  The rows in `password_resets` move rather than being discarded: an expired
--  reset is evidence that somebody asked, and the person page counts them.
--  `used_at` comes along for the same reason.
-- ============================================================================

create table if not exists email_tokens (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references profiles(id) on delete cascade,

  -- 'password_reset' | 'email_verify'. A CHECK rather than free text: a typo in
  -- a kind is a link that can never be redeemed, and it would be found by a
  -- person, not by a test, unless the database refuses it here.
  kind          text not null check (kind in ('password_reset', 'email_verify')),

  -- sha256 of the value in the link. Never the value itself: both kinds are
  -- bearer credentials, and a leaked dump must not contain a working one.
  token_hash    text not null unique,

  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null,
  used_at       timestamptz,

  -- Coarse, hashed, and only for answering "did these requests come from the same
  -- place" during an incident.
  ip_hash       text,
  user_agent    text
);

comment on table email_tokens is
  'One row per emailed link, both kinds. Hashed, single-use, and one live row per '
  '(user, kind) so an account can hold a pending reset and a pending confirmation '
  'at the same time without either cancelling the other.';

-- Carry over what 0022 created (usually two rows in development, and nothing in
-- a fresh database).
insert into email_tokens (user_id, kind, token_hash, created_at, expires_at, used_at, ip_hash, user_agent)
select user_id, 'password_reset', token_hash, created_at, expires_at, used_at, ip_hash, user_agent
  from password_resets
 where true
on conflict (token_hash) do nothing;

drop table if exists password_resets;

-- "Only the newest request of this kind works", as a constraint.
create unique index if not exists idx_email_tokens_live
  on email_tokens (user_id, kind)
  where used_at is null;

create index if not exists idx_email_tokens_user on email_tokens (user_id, kind, created_at desc);

-- ── the address, and whether anybody has confirmed it ───────────────────────
-- Null means nobody has ever proved they read mail at this address. It is NOT a
-- ban and it does not stop anybody using the platform: it stops them handing us
-- money, because a transfer the operator matches by hand needs a person at the
-- other end of the address.
alter table profiles add column if not exists email_verified_at timestamptz;

comment on column profiles.email_verified_at is
  'When the address was last confirmed by following a link. Null = unconfirmed: '
  'the account works, but a plan payment is refused, because the receipt, the '
  'matching and any dispute all need an address somebody actually reads.';

-- Existing accounts are left unconfirmed on purpose. Backfilling a confirmation
-- nobody performed would be inventing consent, which is the one thing this
-- column exists to record honestly.
