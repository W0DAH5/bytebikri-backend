-- ============================================================================
--  0005 — what a connection needs to verify a postback
-- ============================================================================
--  The in-memory store carried callback_secret, callback_base_url and slot_keys
--  on a connection. The database never did. Nothing noticed until the store was
--  ported and the first query named a column that did not exist.
--
--  Three columns, each with a reason it must exist:
--
--  callback_secret — the shared secret the network signs with. Per CONNECTION,
--    not per provider: two channels can both use BitLabs with two different app
--    secrets, which is also why the postback URL names the connection.
--
--  callback_base_url — BitLabs hashes the ABSOLUTE URL configured in their
--    dashboard. We cannot derive it from the Host header, which is
--    attacker-controlled and feeds directly into a hash comparison. So the
--    connection records its own public origin at connect time.
--
--  slot_keys — which slots this connection fills. Distinct from channel_slots,
--    which records the resolved assignment per surface; this is the channel's
--    raw choice.
--
--  ── A note on storing a secret in a database column ──────────────────────
--
--  0001 says credentials live in a KMS and this table holds only a reference.
--  This migration adds a literal secret column, which contradicts that. The
--  contradiction is deliberate and temporary: this build runs with zero external
--  services, and a platform whose postback path cannot be exercised without a
--  cloud KMS is a platform nobody can test.
--
--  It is not a safe default. Before real traffic, callback_secret must become a
--  pointer into a secrets manager, and the value currently in this column must
--  be rotated. See PRODUCTION.md phase 3. The column is named for what it IS so
--  that leaving it in place is a visible decision rather than an oversight.
-- ============================================================================

alter table ad_connections
  add column if not exists callback_secret   text,
  add column if not exists callback_base_url text,
  add column if not exists slot_keys         text[] not null default '{}';

comment on column ad_connections.callback_secret is
  'Shared secret the ad network signs postbacks with. DEV HOLDING PLACE: this '
  'must become a secrets-manager reference before real traffic, and any value '
  'here must be rotated at that point.';

comment on column ad_connections.callback_base_url is
  'Our public origin as the network sees it. Adapters that hash an absolute URL '
  '(BitLabs) need it, and it cannot come from the Host header.';

comment on column ad_connections.slot_keys is
  'Slots this connection fills. The resolved per-surface assignment lives in '
  'channel_slots; this is the channel''s raw choice.';
