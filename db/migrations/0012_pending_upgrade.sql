-- ============================================================================
-- 0012 — a requested upgrade is not a paid one
--
-- Migration 0003 put ONE subscription row on a channel (`uq_subscriptions_channel`).
-- That is right for a plan, and wrong for a request: an upgrade the seller has
-- asked for but not yet paid has nowhere to live, so `requestUpgrade` overwrote
-- the row that recorded what they HAD paid for. Three consequences, all real:
--
--   1. Asking for Pro dropped the channel to free until an operator matched the
--      money — the seller lost a plan they had already paid for by using a form.
--   2. The pro-rated amount then recomputed against the requested plan rather
--      than the paid one, so the bill became the full difference: NPR 2,499
--      instead of NPR 1,500.
--   3. A rejected payment left the channel with no plan at all, and no way to
--      tell what it had been.
--
-- So the request gets its own column. `plan_code` keeps meaning "what this
-- channel has paid for"; `pending_plan_code` means "what it has asked for".
-- Capability follows the first; the UI and the pro-rated quote follow the
-- second; only the operator's match moves one to the other.
-- ============================================================================

alter table subscriptions
  add column if not exists pending_plan_code text references plans(code),
  add column if not exists pending_since     timestamptz;

comment on column subscriptions.pending_plan_code is
  'The plan the channel has ASKED for and not yet paid for. Grants NO capability: '
  'the effective plan is still plan_code. Cleared by the operator on match (after '
  'plan_code moves) and on rejection (leaving the paid plan untouched).';

comment on column subscriptions.pending_since is
  'When the upgrade was requested. The amount is fixed at request time, so this is '
  'what the operator compares the transfer date against.';

-- A pending request is exactly one per channel, which the one-row-per-channel
-- schema already guarantees; the constraint here is the honest one for the
-- state, so nothing can request a plan while another request is open.
create unique index if not exists uq_subscriptions_pending
  on subscriptions(channel_id) where pending_plan_code is not null;
