-- ============================================================================
--  0043 — a subscription row may say "no arrangement"
-- ============================================================================
--  0042 added gifts, and a gift needed a payer to exist in `customer_subscriptions`
--  because that is the row a payment is attached to — `customer_subscriptions
--  (profile_id)` is what `customer_plan_payments.customer_subscription_id` points at,
--  and the operator's queue reaches the payer's name and email through it. The
--  obvious alternative, making that column nullable, is worse: the queue joins
--  `profiles p on p.id = pp.customer_subscription_id`, so a NULL there does not
--  produce a nameless row, it produces NO row — the claim would be invisible to the
--  one person who can act on it.
--
--  So the row has to exist, and it needed a state that says the truth: this person
--  has no arrangement. The four states in 0033 all describe a period that existed
--  (`pending_payment`, `active`, `lapsed`, `cancelled`), and writing `lapsed` for
--  somebody who has never had a month is a small lie that a support conversation
--  would eventually have to explain. `none` is that state, and it is deliberately
--  the state a row is created in when the only thing that exists is a claim for a
--  GIFT — money spent on somebody else.
--
--  Nothing else changes. `plusState()` already maps any unrecognised status to
--  'none', so a row in this state is not worn, is not counted as active, and does
--  not appear in the console's active/arrangements counts. The one thing worth
--  saying out loud: a row in this state is NOT a lapse and must never be counted as
--  one — churn is a period that ended, and this is a period that never started.
-- ============================================================================

alter table customer_subscriptions drop constraint if exists customer_subscriptions_status_check;
alter table customer_subscriptions
  add constraint customer_subscriptions_status_check
  check (status in ('none', 'pending_payment', 'active', 'lapsed', 'cancelled'));

comment on column customer_subscriptions.status is
  'none = a row exists with no arrangement at all (created when somebody claims a '
  'gift for another person, because a payment is attached to this row); '
  'pending_payment = a reference is waiting for a person to check a statement; '
  'active = a period is running, or has run out (which IS the lapse — nothing sweeps '
  'it); lapsed and cancelled are kept for rows written before the derived clock. '
  'No cosmetic is worn while a row is pending: the look is what the money buys.';
