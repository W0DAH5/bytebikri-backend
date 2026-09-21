-- ============================================================================
-- 0015 — where the money actually goes, and what the network says it was
--
-- The agenda, in one sentence: bytebikri does not hold a creator's ad earnings.
-- The network pays the creator's own account, directly, and the only money that
-- reaches bytebikri is a plan upgrade and the annual rent. Nothing in this
-- migration changes that. It makes it VISIBLE and, where possible, checkable:
--
--   payout_accounts  — the creator tells us which of their own accounts the
--                      network pays into. A LABEL, nothing more: no account
--                      number, no token, no credential. We cannot move money
--                      with anything in this table, and it is not the network's
--                      record either — it is a note the creator wrote.
--
--   provider_reports — the creator pastes the total their network statement
--                      showed for a period. Our dashboard has an ESTIMATE; the
--                      network has the truth. Until now the two were never
--                      compared, which meant an estimate could drift arbitrarily
--                      far from reality with nobody able to notice — including
--                      us, and including the seller whose rent is priced off
--                      that same traffic model.
--
-- The second table is the interesting one. Rent is charged from a traffic
-- estimate at an assumed RPM. If that assumption is wrong by a factor of three,
-- the rent is wrong by a factor of three, and the person paying it had no way to
-- say so. With this, they can: the gap is printed, attributed, and used to
-- re-price the assumption where the evidence supports it.
-- ============================================================================

create table if not exists payout_accounts (
  id             uuid primary key default gen_random_uuid(),
  channel_id     uuid not null references channels(id) on delete cascade,

  -- Registry id. Not a foreign key: the registry is a JSON file, and adding a
  -- provider should not need a migration.
  provider_id    text not null,

  -- What the creator typed, shown back to them and to nobody else.
  account_label  text not null,
  payout_method  text,

  -- Self-declared. There is no 'verified' state and there will not be one: we
  -- cannot see the network's account records, and a green tick next to a number
  -- we cannot check would be the exact kind of assurance this project refuses.
  status         text not null default 'declared'
                 check (status in ('declared','changed')),
  note           text,

  declared_at    timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (channel_id, provider_id)
);
create index if not exists idx_payout_accounts_channel on payout_accounts(channel_id);
comment on table payout_accounts is
  'The creator''s OWN account at an ad network, as a label they wrote. Deliberately '
  'holds nothing usable to move money and nothing the network could verify: '
  'bytebikri is not a party to that account, cannot see its balance, and never '
  'receives from it.';
comment on column payout_accounts.status is
  'declared = the creator told us. changed = they told us it changed and we have '
  'not been told the new one. There is no verified state on purpose.';

create table if not exists provider_reports (
  id             uuid primary key default gen_random_uuid(),
  channel_id     uuid not null references channels(id) on delete cascade,
  provider_id    text not null,

  period_start   date not null,
  period_end     date not null,

  -- In USD, because every network here reports in USD and mixing currencies in
  -- one column is how a reconciliation quietly compares two different things.
  -- A creator paid in NPR enters the figure their statement shows in USD, or
  -- leaves it: an uncompared month is better than a wrong comparison.
  reported_usd   numeric(10,2) not null check (reported_usd >= 0),

  note           text,
  created_at     timestamptz not null default now(),

  -- One figure per provider per period start: re-submitting corrects the figure
  -- rather than stacking a second one next to it.
  unique (channel_id, provider_id, period_start)
);
create index if not exists idx_provider_reports_channel
  on provider_reports(channel_id, period_start desc);
comment on table provider_reports is
  'What the NETWORK says the channel earned for a period, entered by the creator. '
  'The authority on ad revenue is the network, not this database; these rows exist '
  'so our estimate can be compared against the truth and corrected where it drifts. '
  'Nothing here is a balance, a payable, or a promise.';
