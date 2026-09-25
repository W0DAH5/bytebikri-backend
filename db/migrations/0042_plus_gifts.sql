-- ============================================================================
--  0042 — a gift: one period of Plus, bought for somebody else
-- ============================================================================
--  The researched record on premium products is unanimous about gifting, and it is
--  the one social feature of Discord's Nitro that never drew a backlash: you can buy
--  a friend a month (Nitro gifts, three "friend passes" on some plans) and Twitch
--  lets a viewer gift a subscription. It is also, for THIS product, the only
--  acquisition channel that costs nothing to run and does not need a card on file —
--  which matters, because this platform has no processor and does not intend to grow
--  one for a cosmetic.
--
--  NO MONEY MOVES IN THIS MIGRATION, and that is the point of its shape. The money
--  rail is unchanged: a person sends NPR to the platform's own wallet, submits the
--  reference, and an operator matches it against the statement. What is added here is
--  what happens to the ENTITLEMENT that a matched payment creates — on a gift, it
--  belongs to somebody else, and a code carries it there.
--
--  Three decisions:
--
--  1. A GIFT IS NOT THE BUYER'S SUBSCRIPTION. `customer_subscriptions` has one row
--     per person and `matchCustomerPlanPayment` sets that row active. A gift must do
--     the opposite: the buyer's own arrangement is untouched (they might be wearing a
--     look that a self-gift would have flipped to pending), and the period waits in
--     `customer_plan_gifts` until somebody redeems it. `gift_id` on the payment is how
--     the operator's single action — "I found the money" — knows which of the two
--     things it is doing.
--
--  2. THE CODE IS THE WHOLE CLAIM, SO IT IS BORNE BY THE RECIPIENT. A gift code is a
--     bearer token: whoever holds it redeems it, and the redemption is what starts the
--     period. That is the honest design for a manual rail with no card on file, and it
--     is why redeeming demands nothing of the recipient but a signed-in account —
--     requiring an email check here would demand that a person finish our paperwork
--     before accepting a present.
--
--  3. A YEAR IS A SECOND ROW, NOT A SECOND PRODUCT. `plus-year` is the same plan with
--     the same capabilities and a twelve-month period at ten months' price, because
--     the discount is the whole of the difference and a discount is not a feature.
--     Keeping it as a plan row means the arrangement can honestly say which one
--     somebody is on, and the match already reads months from the plan.
--
--  What is deliberately absent, and why: no `refunded` status (there is no processor
--  to reverse and promising one in copy would be a lie — `cancelPlus` already says
--  this), no expiry on a code (a gift that quietly dies is a rupee somebody's friend
--  took and never used, and the platform already holds the money), and no limit on
--  how many gifts one person may buy.
-- ============================================================================

-- ── a year, at ten months' price ────────────────────────────────────────────
-- NPR 1,490 against 12 × 149 = 1,788. Two months free, stated as such on the page.
-- The same capabilities jsonb as the monthly row, byte for byte, because the perk is
-- the period and nothing else: if this row ever grows a key the monthly one lacks,
-- the annual plan has become a second product and the one-price promise is broken.
insert into customer_plans (code, name, price_npr, period_months, capabilities)
values (
  'plus-year',
  'ByteBikri Plus — a year',
  1490,
  12,
  '{"nameplate": true, "effect": true, "profile_accent": true, "opens_content": false, "removes_ads": false}'::jsonb
)
on conflict (code) do update
  set name = excluded.name,
      price_npr = excluded.price_npr,
      period_months = excluded.period_months,
      capabilities = excluded.capabilities;

-- ── the gift itself ─────────────────────────────────────────────────────────
create table if not exists customer_plan_gifts (
  id          uuid primary key default gen_random_uuid(),
  -- Minted by `giftCode()` in src/plus.js: BKP-XXXX-XXXX, from an alphabet with no
  -- I, O, 0 or 1 in it, because this string gets read aloud over a phone.
  code        text not null unique,
  plan_code   text not null references customer_plans(code),
  months      smallint not null check (months between 1 and 12),
  buyer_id    uuid not null references profiles(id) on delete cascade,
  -- What the buyer wants the recipient to see ("for my sister", a name, anything).
  -- Optional, and the only free-text field on the whole feature.
  note        text,
  -- reserved = the buyer says they sent it, nobody has checked the statement.
  -- funded   = the operator found the money; the code works from here.
  -- redeemed = somebody used it; the period is running on their row.
  -- void     = the transfer was not found. The code never works, and the buyer is
  --            told why rather than being left holding a string that does nothing.
  status      text not null default 'reserved'
              check (status in ('reserved', 'funded', 'redeemed', 'void')),
  matched_at  timestamptz,
  void_reason text,
  redeemed_by uuid references profiles(id) on delete set null,
  redeemed_at timestamptz,
  created_at  timestamptz not null default now(),
  -- A redeemed gift must say who redeemed it and when. Written as a constraint rather
  -- than a convention because "the row says used but nobody used it" is exactly the
  -- shape of bug that is invisible until a person asks where their month went.
  constraint customer_plan_gifts_redeemed_complete
    check (status <> 'redeemed' or (redeemed_by is not null and redeemed_at is not null))
);
create index if not exists idx_plan_gifts_buyer on customer_plan_gifts(buyer_id, created_at desc);
create index if not exists idx_plan_gifts_status on customer_plan_gifts(status);

comment on table customer_plan_gifts is
  'One period of a customer plan, bought by one person for another. The buyer''s own '
  'subscription is never touched: a match on a gift marks the GIFT funded and waits. '
  'A code is single-use and is redeemed by whoever holds it.';

comment on column customer_plan_gifts.status is
  'reserved = claimed, waiting for an operator to find the transfer; funded = matched, '
  'the code works; redeemed = used, the period runs on the redeemer''s own row; '
  'void = the money was not found, and the code never works.';

-- ── the payment knows what it is paying for ─────────────────────────────────
alter table customer_plan_payments
  add column if not exists gift_id uuid references customer_plan_gifts(id) on delete set null;

comment on column customer_plan_payments.gift_id is
  'Set when this transfer buys a GIFT rather than the payer''s own period. The '
  'operator''s match then funds the gift instead of activating the payer — the one '
  'branch in `matchCustomerPlanPayment`, and the reason a person can buy a friend a '
  'month without their own arrangement being disturbed.';
