-- ============================================================================
--  0003 — unique targets for every upsert
-- ============================================================================
--  Postgres error 42P10: "there is no unique or exclusion constraint matching
--  the ON CONFLICT specification".
--
--  Found the moment the store first ran: ON CONFLICT (email) on profiles had no
--  unique index to arbitrate it, so the app could not create its first user. The
--  question is not why this was missed — it is why nothing caught it. Nothing
--  could: the schema had never been executed, and the in-memory store had no
--  constraints to violate.
--
--  An ON CONFLICT clause is a CONTRACT with the schema. Every one in
--  src/store.js is listed here, and app/test/schema.test.js now asserts that each
--  has a matching unique index — so this class of failure is caught by `npm test`
--  rather than by the app failing to boot.
--
--     on conflict (email)                      profiles.email
--     on conflict (channel_id)                 subscriptions.channel_id
--     on conflict (asset_id)                   asset_unlock_policy (pk)
--     on conflict (asset_id, user_id)          unlocks (already unique)
--     on conflict (channel_id, day)            page_view_daily (pk)
--     on conflict (connection_id, external_id) ad_view_events (0002)
--     on conflict (user_id)                    ad_refs (already unique)
-- ============================================================================

-- One account per email. The app lowercases before insert; the CHECK makes that
-- the database's rule rather than a convention three call sites have to remember.
-- Nullable, because a profile created by an external IdP could arrive before its
-- email is known — and in Postgres multiple NULLs do not collide.
alter table profiles
  add constraint profiles_email_not_blank check (email is null or length(trim(email)) > 0);

create unique index if not exists uq_profiles_email on profiles (email);
create unique index if not exists uq_profiles_email_lower on profiles (lower(email));

comment on index uq_profiles_email_lower is
  'Case-insensitive uniqueness. ON CONFLICT (email) is served by uq_profiles_email; '
  'this one stops Alice@x and alice@x becoming two accounts by another path.';

-- A channel's CURRENT subscription. Historical ones belong in a separate ledger
-- if we ever need them; keeping several rows here would make `on conflict
-- (channel_id) do update` silently pick one.
create unique index if not exists uq_subscriptions_channel on subscriptions (channel_id);
