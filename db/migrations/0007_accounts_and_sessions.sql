-- ============================================================================
--  0007 — accounts and sessions
-- ============================================================================
--  Until now identity was `?as=<email>`: no password, no session, no logout.
--  Anyone could read anyone's dashboard by guessing an email, and a "fresh
--  user" test was really a shared guest account. That is not a placeholder one
--  ships behind; it is an authentication bypass.
-- ============================================================================

-- ── passwords ───────────────────────────────────────────────────────────────
-- Stored as a self-describing hash:  scrypt$N$r$p$<salt-b64>$<hash-b64>
--
-- Self-describing so the parameters can change later without a flag day. When
-- they do, an old hash still verifies under the parameters it was made with,
-- and the row can be upgraded on the next successful login.
--
-- scrypt over bcrypt/argon2 because it is in node:crypto. A native module here
-- means a build toolchain on every deploy target including Supabase's build
-- image, and the difference between a well-parameterised scrypt and argon2id is
-- far smaller than the difference between argon2id and a dependency that fails
-- to compile.
alter table profiles add column if not exists password_hash text;

comment on column profiles.password_hash is
  'scrypt$N$r$p$salt$hash. Nullable: a profile can exist before a password is '
  'set (invited, or created by an external IdP).';

-- ── sessions ────────────────────────────────────────────────────────────────
-- The cookie holds a random token. This table holds only its SHA-256.
--
-- Hashing the token means a leaked database does not hand over live sessions —
-- the same reason password hashes are hashes. A session token is a bearer
-- credential: whoever reads it is the user.
create table if not exists sessions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references profiles(id) on delete cascade,
  token_hash   text not null unique,

  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at   timestamptz not null,
  revoked_at   timestamptz,

  -- Enough to recognise a session in a list ("Chrome, Kathmandu"), and not
  -- enough to reconstruct a person's browsing. Both are hashed.
  user_agent   text,
  ip_hash      text
);
create index if not exists idx_sessions_user on sessions(user_id, created_at desc);
-- The read path filters on expiry, so the index matches the query.
create index if not exists idx_sessions_live on sessions(token_hash) where revoked_at is null;

comment on table sessions is
  'Server-side sessions. token_hash is sha256 of the cookie value: the token is '
  'a bearer credential, so the database must not hold one that can be replayed.';

-- ── login attempts ──────────────────────────────────────────────────────────
-- Rate limiting in memory is per-process and dies with the process; a restart
-- clears an attacker''s budget. Login is the one place where that matters
-- enough to pay for a table.
create table if not exists login_attempts (
  id          bigserial primary key,
  email       text not null,
  succeeded   boolean not null,
  ip_hash     text,
  created_at  timestamptz not null default now()
);
create index if not exists idx_login_attempts on login_attempts(email, created_at desc);
comment on table login_attempts is
  'Powers lockout after repeated failures, and gives the operator a record of '
  'credential stuffing. Holds no plaintext ip.';
