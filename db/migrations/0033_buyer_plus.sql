-- 0033 — the buyer's own premium. bytebikri's third revenue line, and the first
-- one a MEMBER pays rather than a seller.
--
-- Everything sold here so far has been sold to a store: a plan, and rent on one ad
-- position. Memberships put money between two other people and left the platform
-- out of it, deliberately. This is the other direction — a person pays bytebikri
-- for how they appear, not for what they may open.
--
-- WHY COSMETICS AND NOTHING ELSE, which is the whole design:
--
--   * The creator's lock is the creator's. Nothing here opens a file, removes an
--     ad, or shortens a wait. A person who pays bytebikri must never be able to
--     take something a creator is paid by ads for.
--   * Cosmetics are the one thing this platform can sell at a price a Nepali
--     member will pay without resenting it. The researched record is unambiguous
--     that people DO pay for self-expression and DO resent being charged twice for
--     it: Discord's decoration shop drew its loudest backlash not for existing but
--     for sitting on top of a Nitro subscription already paid for ("should be free
--     with Nitro", "$1 max"). So there is ONE plan and every effect is inside it —
--     no second charge, ever, for a frame.
--   * Nothing that costs the platform per member to run. These are a class name and
--     a palette key on a name that is already being rendered.
--
-- The tables mirror the store side on purpose (plans / subscriptions / payments,
-- a reference a person submits and an operator matches against the statement),
-- because the manual rail is the only rail Nepal has and a second, different
-- payment flow would be a second thing to get wrong.

create table if not exists customer_plans (
  code          text primary key,
  name          text not null,
  -- Nepal-first price, and deliberately in the range the research says people stop
  -- finding insulting. Displayed on every surface that asks for it.
  price_npr     integer not null check (price_npr >= 0),
  period_months smallint not null check (period_months between 1 and 12),
  -- Same shape as `plans.capabilities`, for the same reason: what a plan includes
  -- is data a page reads, not a list of ifs scattered across templates. Every key
  -- here is a cosmetic. If a key that opens content ever appears in this column,
  -- that is the bug.
  capabilities  jsonb not null default '{}'::jsonb,
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);
comment on table customer_plans is
  'Plans a MEMBER buys from the platform. Cosmetics only: no key in capabilities may '
  'open a creator''s file, remove an ad, or shorten an unlock.';

create table if not exists customer_subscriptions (
  profile_id    uuid primary key references profiles(id) on delete cascade,
  plan_code     text not null references customer_plans(code),
  -- 'pending_payment' is a reference somebody submitted; only an operator match
  -- makes it 'active'. There is no card processor for this shape of business in
  -- Nepal, so the flow is the same manual one the store plans use.
  status        text not null default 'pending_payment'
                check (status in ('pending_payment','active','lapsed','cancelled')),
  period_start  timestamptz,
  period_end    timestamptz,
  -- When the pending claim arrived, so the operator queue can order itself and a
  -- stale reference can be spotted.
  claimed_at    timestamptz,
  cancelled_at  timestamptz,
  updated_at    timestamptz not null default now()
);
create index if not exists idx_customer_subs_status on customer_subscriptions(status);
comment on column customer_subscriptions.status is
  'pending_payment = a reference is waiting for a person to check a statement. No '
  'cosmetic is worn while pending: the look is what the money buys, so it arrives '
  'when the money is confirmed.';

create table if not exists customer_plan_payments (
  id                        uuid primary key default gen_random_uuid(),
  customer_subscription_id  uuid not null references customer_subscriptions(profile_id) on delete cascade,
  amount_npr                integer not null check (amount_npr >= 0),
  -- REQUIRED. Without it a payment cannot be attributed when several arrive on the
  -- same day, which is the whole failure mode of a manual rail.
  txn_reference             text not null,
  payer_name                text,
  method                    text not null default 'esewa' check (method in ('esewa','khalti','imepay','bank','other')),
  status                    text not null default 'submitted'
                            check (status in ('submitted','matched','rejected','duplicate')),
  matched_by                uuid references profiles(id),
  matched_at                timestamptz,
  reject_reason             text,
  created_at                timestamptz not null default now()
);
-- One reference is one payment, across every rail this product has. The store-side
-- table has the same index for the same reason: the same eSewa code pasted twice
-- must fail loudly rather than grant a second period.
create unique index if not exists uq_customer_payment_ref on customer_plan_payments(txn_reference);
comment on table customer_plan_payments is
  'Admin verifies against the platform''s OWN bank/eSewa statement, not a screenshot.';

-- What a person chose to look like. Kept even after a membership lapses: a choice is
-- a preference, and deleting somebody's preference because their month ended is a
-- punishment for a decision they may make again. Nothing wears it unless the plan is
-- active — that check lives in `plusWear()` and is asserted in test/plus.test.js.
alter table profiles add column if not exists nameplate text;
alter table profiles add column if not exists plus_effect text;
alter table profiles add column if not exists plus_set_at timestamptz;

alter table profiles drop constraint if exists profiles_plus_effect_check;
alter table profiles
  add constraint profiles_plus_effect_check
  check (plus_effect is null or plus_effect in ('solid','halo','edge'));
comment on column profiles.nameplate is
  'A palette key from src/memberships.js ACCENTS, chosen by the member, worn only '
  'while their own plan is active.';
comment on column profiles.plus_effect is
  'The motion style on that name. Every effect is declared under a reduced-motion '
  'guard in the stylesheet; the stored value never forces movement on anybody.';

-- The plan itself. One row, one price, and every effect inside it.
--
-- NPR 149 a month. The store plans are annual (999/2499) because a store's decision
-- is a business decision; this one is a person deciding whether they like how their
-- name looks, and a price that needs a month's thought is a price that sells nothing.
-- The researched ceiling is much lower than the American one: the loudest complaints
-- about Discord's shop were about paying $6-$13 ON TOP of a subscription, and the
-- number people named as fair was around a dollar. 149 rupees is about one.
--
-- `capabilities` keys, and why each is safe to sell:
--   nameplate      — the wearer picks their own palette for their own name
--   effect         — 'halo' (a slow glow) or 'edge' (a rule under the name)
--   profile_accent — the ring around their avatar in a roster
-- None of them touches a file, an ad, a wait, or a store's perk.
insert into customer_plans (code, name, price_npr, period_months, capabilities)
values (
  'plus',
  'ByteBikri Plus',
  149,
  1,
  '{"nameplate": true, "effect": true, "profile_accent": true, "opens_content": false, "removes_ads": false}'::jsonb
)
on conflict (code) do update
  set name = excluded.name,
      price_npr = excluded.price_npr,
      period_months = excluded.period_months,
      capabilities = excluded.capabilities;
