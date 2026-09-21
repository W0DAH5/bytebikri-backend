-- ============================================================================
-- 0018 — a file hidden by reports can come back
--
-- Migration 0017 lets three distinct reporters hide a file while an operator
-- looks at it. That is the right threshold, and on its own it creates a trap:
-- the file is `paused`, the operator reads the reports, decides they were
-- wrong, dismisses them — and the file stays hidden forever, because nothing
-- remembers WHY it was paused.
--
-- `assets.status = 'paused'` is the seller's own switch. It cannot also be the
-- system's, or dismissing a report quietly un-pauses a file its owner took down
-- on purpose. So the reason gets its own column:
--
--   hidden_by_reports = true   the threshold hid this file; dismissing the
--                              reports puts it back
--   hidden_by_reports = false  the seller paused it, or an operator acted on a
--                              report and meant it to stay down
--
-- Anything the SELLER does to the status clears the flag, because from that
-- point the state is theirs again.
-- ============================================================================

alter table assets
  add column if not exists hidden_by_reports boolean not null default false;
