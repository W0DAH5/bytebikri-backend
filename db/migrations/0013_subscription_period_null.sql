-- ============================================================================
-- 0013 — a free plan has no period, so period_end can be null
--
-- 0001 declared `period_end timestamptz not null`, on the assumption that every
-- subscription row was a paid one. It is not any more: a free store needs a row
-- to record what it has ASKED for (0012), and there is no paid period to put an
-- end on.
--
-- Inventing one would be worse than dropping the constraint. A fabricated end
-- date becomes `channel.subscription_end`, the pro-rated quote divides by the
-- days left to it, and a first purchase is then billed as an upgrade —
-- NPR 1,500 for Pro instead of NPR 2,499. Null says the true thing: nothing is
-- running, so the full difference is due and the year starts at the match.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- A free channel has no paid period, and `period_end` was NOT NULL from 0001.
--
-- That constraint assumed every subscription row was a paid one. It is not: a
-- free store needs a row to record what it has asked for, and inventing a
-- period end for it would be worse than dropping the constraint — a fake end
-- date pro-rates the NEXT upgrade against a period nobody paid for, so a first
-- purchase would be billed NPR 1,500 instead of NPR 2,499.
--
-- Null means exactly what it should here: no paid period is running, so the full
-- difference is due and the year starts when the money is matched.
-- ---------------------------------------------------------------------------
alter table subscriptions alter column period_end drop not null;

comment on column subscriptions.period_end is
  'End of the period the channel has PAID for. NULL on a free plan: nothing is '
  'running, so an upgrade is the full price rather than a pro-rated one, and the '
  'year starts at the operator''s match.';
