-- ============================================================================
-- 0017 — a buyer says a file is wrong
--
-- The Android app has had `flagged_assets` since its first schema and the web
-- never got it, so the only way to complain about a file was to email somebody.
-- This is that table, with three decisions attached that the app's version does
-- not make:
--
--   ONE PERSON, ONE VOTE. The unique key is (asset_id, reporter_id), not a row
--   per click. Without it the auto-hide threshold is "three clicks from anybody
--   with three accounts", which is not a threshold at all.
--
--   A REPORT IS NOT A TAKEDOWN. Filing one writes exactly one row here and
--   changes nothing about the asset. Hiding a file is a moderation decision with
--   its own record and its own reason, and it stays that way. A single report
--   that could hide a file would hand every seller a weapon against every other
--   seller.
--
--   3+ DISTINCT REPORTERS auto-hide it while an operator looks — that number
--   comes from the trust-and-safety literature ("don't auto-takedown on a single
--   report — that creates a competitor weapon") and it is asserted in
--   test/reports.test.js, not just written here.
--
-- The reason is a `policy_rules.code`, same as moderation, so a report and a
-- decision about the same file speak the same language. The reporter's own words
-- live in `note` and are a hint for the operator, never the charge.
-- ============================================================================

create table if not exists asset_reports (
  id            uuid primary key default gen_random_uuid(),
  asset_id      uuid not null references assets(id) on delete cascade,
  channel_id    uuid not null references channels(id) on delete cascade,
  reporter_id   uuid not null references profiles(id) on delete cascade,

  -- A rule code, never a sentence. FK to the policy table, so a report cannot
  -- cite a rule this platform does not have.
  reason        text not null references policy_rules(code),
  note          text,

  -- What an operator did about it. 'open' is the queue.
  status        text not null default 'open'
                check (status in ('open','actioned','dismissed')),
  resolved_at   timestamptz,
  resolved_by   uuid references profiles(id),
  resolution    text,

  created_at    timestamptz not null default now()
);

-- One report per person per file. The second attempt is a no-op the route can
-- tell apart from a success, so the reporter is told the truth ("you already
-- reported this") instead of a lie ("thank you").
create unique index if not exists uq_asset_report_reporter
  on asset_reports(asset_id, reporter_id);

create index if not exists idx_reports_open   on asset_reports(status, created_at desc);
create index if not exists idx_reports_asset  on asset_reports(asset_id, created_at desc);

-- The three rules a report may cite that the 0001 seed does not carry. Same list
-- as EXTRA_POLICY_RULES in app/src/reports.js; the migration is what makes them
-- real, and test/reports.test.js fails if the two lists drift.
insert into policy_rules (code, title, scope, default_state, severity, description) values
  ('scam',    'Not what was described', 'global', 'restricted', 2, 'Buyers reported that what they unlocked was not what was advertised.'),
  ('illegal', 'Unlawful content',       'global', 'blocked',    3, 'Content that appears to break Nepali law or the law where it is offered.'),
  ('contact', 'Something else',         'global', 'restricted', 1, 'The buyer could not fit their report into a category, so an operator reads it.')
on conflict (code) do nothing;
