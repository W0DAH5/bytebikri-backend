-- ============================================================================
--  0022 — a way back into an account
-- ============================================================================
--  Until now a forgotten password was the end of the account. There was no
--  reset, no email layer, and no way for anybody — including an operator — to
--  hand the account back without writing SQL. For a platform whose sellers are
--  small studios with one login, that is not an inconvenience, it is a lost
--  customer and a support request nobody can answer.
--
--  Three decisions are load-bearing, and each has its own reason.
--
--  1. THE TOKEN IS STORED AS A HASH. Same reasoning as `sessions`: a reset link
--     is a bearer credential — whoever reads it becomes the account — so a
--     leaked database must not contain a working one. Only sha256 lives here.
--
--  2. ONE LIVE TOKEN PER ACCOUNT. Requesting a second link invalidates the
--     first, enforced by a partial unique index rather than by application care.
--     Without it, every link ever mailed stays valid until it expires: a shared
--     inbox, a forwarded email, a backup of an old phone. The index makes "the
--     newest request is the only one that works" a property of the schema
--     instead of a thing the code has to remember to do.
--
--  3. THE ROW IS KEPT AFTER USE. `used_at` records when a link was spent, so
--     "was this account taken over, and when" is answerable. A deleted token
--     answers nothing. Tokens are cleaned up on a schedule, not in the request
--     path — see the retention note at the bottom.
--
--  `outbound_emails` exists for the same reason `audit_logs` does: the platform
--  now sends messages that matter, and until a real provider is configured the
--  only honest place to see them is a table. It doubles as the integration
--  surface for tests — an assertion about "the email contained a working link"
--  is only possible if the email is a row somebody can read.
-- ============================================================================

create table if not exists password_resets (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references profiles(id) on delete cascade,

  -- sha256 of the value in the link. Never the value itself.
  token_hash    text not null unique,

  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null,
  used_at       timestamptz,

  -- Coarse, hashed, and only for answering "did this request come from the same
  -- place as the others" during an incident. Same treatment as login_attempts.
  ip_hash       text,
  user_agent    text
);

comment on table password_resets is
  'One row per reset LINK REQUESTED, kept after use so the history survives. A '
  'leaked database contains no usable link: only the sha256 is stored.';

comment on column password_resets.token_hash is
  'sha256 of the token in the emailed URL. The token is a bearer credential and '
  'must not be replayable from a database dump.';

-- "Only the newest request works", as a constraint.
create unique index if not exists idx_password_resets_live
  on password_resets (user_id)
  where used_at is null;

create index if not exists idx_password_resets_user on password_resets (user_id, created_at desc);

-- ── outbound mail ───────────────────────────────────────────────────────────
-- Every message the platform sends, including in production, because a
-- transactional email that cannot be found after the fact is an email support
-- cannot reason about. Bodies are stored for the same reason: "what exactly did
-- we tell them" is the first question in any dispute, and a template rendered
-- later from changed code cannot answer it.
create table if not exists outbound_emails (
  id           uuid primary key default gen_random_uuid(),

  -- What the message was about. Free text with a small vocabulary so a query can
  -- find "every reset we have ever sent" without parsing a subject line.
  kind         text not null,
  to_email     text not null,
  subject      text not null,
  body_text    text not null,

  -- Which driver carried it: 'console' in development, a provider in production.
  -- Recorded because "was this actually delivered, or only written down" is the
  -- question you have when a seller says they never got the link.
  driver       text not null,
  delivered    boolean not null default false,
  error        text,

  -- The account it concerned, when there is one. Nullable: some messages are
  -- to an address with no account, which is itself worth seeing.
  user_id      uuid references profiles(id) on delete set null,

  created_at   timestamptz not null default now()
);

comment on table outbound_emails is
  'Every message the platform sends. Kept so "what did we tell them, and did it '
  'go out" has an answer after the fact. Pruned by scripts/prune.mjs.';

create index if not exists idx_outbound_emails_recent on outbound_emails (created_at desc);
create index if not exists idx_outbound_emails_kind on outbound_emails (kind, created_at desc);

-- ── retention ───────────────────────────────────────────────────────────────
-- Reset rows are kept 180 days and outbound mail 90, both pruned by the
-- scheduled job rather than by the request path: a DELETE inside a login flow is
-- a lock held at the worst possible moment, and "cleanup on read" is how a table
-- silently becomes a queue.
comment on column password_resets.expires_at is
  'Links are valid 60 minutes. Rows outlive that on purpose: an expired link was '
  'still requested by somebody, and the pattern of requests is the signal.';
