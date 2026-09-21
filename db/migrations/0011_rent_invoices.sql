-- ============================================================================
--  0011 — rent invoices
-- ============================================================================
--  bytebikri receives money in exactly two places: a store upgrade, and the
--  annual rent for the platform's one ad slot. Both are billing of the SELLER
--  for space and capability. Neither is a cut of anything the seller earns:
--  the ad networks pay the seller's own account directly and this table has no
--  way to represent a share of that, on purpose.
--
--  Why the rent has its own table rather than a row in plan_payments:
--
--    A plan payment buys a SUBSCRIPTION and covers its period. Rent buys
--    nothing — it is the price of the traffic the platform brought, priced off
--    that traffic. It recurs on the channel's own anniversary, it can be zero,
--    and its amount has to be explainable from the numbers that produced it.
--    Forcing it into plan_payments would mean a subscription row that does not
--    exist for a free store, which is most of them.
--
--  `basis` is the important column. A bill that cannot show its own arithmetic
--  is a bill nobody can dispute, and this one is derived from a trailing
--  pageview estimate — a number the seller is entitled to see the working for.
-- ============================================================================

create table if not exists rent_invoices (
  id            uuid primary key default gen_random_uuid(),
  channel_id    uuid not null references channels(id) on delete cascade,

  -- Aligned to the channel's own anniversary, not the calendar year: a store
  -- that opened in March is not billed for a January it did not exist in.
  period_start  date not null,
  period_end    date not null,
  check (period_end > period_start),

  amount_npr    integer not null check (amount_npr >= 0),

  -- How the number was reached: pageviews, slot count, rent slot count, the
  -- assumed RPM and the FX rate. Every assumption, so the invoice is arithmetic
  -- rather than an assertion.
  basis         jsonb not null default '{}'::jsonb,

  status        text not null default 'issued'
                check (status in ('issued','submitted','paid','waived','void')),

  -- Submitted by the payer, matched by an operator against the platform's own
  -- statement. Same manual rail as plan_payments, because there is no card
  -- processor that will settle to a Nepal entity.
  method        text check (method in ('esewa','khalti','imepay','bank','other')),
  txn_reference text,
  payer_name    text,
  payer_number  text,
  submitted_at  timestamptz,

  paid_at       timestamptz,
  matched_by    uuid references profiles(id),
  note          text,

  created_at    timestamptz not null default now(),

  -- One invoice per channel per period. This is also the ON CONFLICT arbiter
  -- for `ensureRentInvoice`, so issuing twice in a day is a no-op rather than a
  -- second bill for the same year.
  unique (channel_id, period_start)
);

create index if not exists idx_rent_channel on rent_invoices(channel_id, period_start desc);
create index if not exists idx_rent_open    on rent_invoices(status) where status in ('issued','submitted');

comment on table rent_invoices is
  'Annual rent for the platform ad slot. Priced off trailing traffic, never '
  'issued below the three-slot floor, payable by reference and matched by hand. '
  'Not a commission: bytebikri takes no share of what the seller earns.';

comment on column rent_invoices.basis is
  'The working: pageviews30d, slot counts, assumed RPM and FX. Shown to the '
  'seller so the amount can be checked rather than trusted.';

comment on column rent_invoices.amount_npr is
  'Zero is a valid and common amount. A store with no traffic owes no rent — '
  'the floor exists so that a quiet store is never billed into difficulty.';
