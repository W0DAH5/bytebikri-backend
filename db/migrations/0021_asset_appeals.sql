-- ============================================================================
--  0021 — the seller gets to answer
-- ============================================================================
--  Three distinct reports hide a file (0017) and an operator can put it back
--  (0018). What neither migration provides is the third voice: the person whose
--  file it is. Today their dashboard says "Paused", exactly as it does when they
--  paused it themselves, and they cannot tell the system's decision from their
--  own switch, cannot see what it was accused of, and cannot ask.
--
--  For a platform whose whole safety mechanism is "three people clicked a
--  button", that is the wrong way round. The threshold is cheap to reach and easy
--  to weaponise — the same reason reports are counted by DISTINCT reporter — and
--  the only party who can explain a false positive is the seller.
--
--  Five decisions are in this schema rather than in the code that will use it:
--
--  1. **One open appeal per file.** A partial unique index, not a convention. An
--     appeal is a request for a person to look, and a person looking at forty
--     copies of the same request is how a queue stops being read. The seller can
--     appeal again after a decision — the index only constrains OPEN ones — but
--     not by holding down a button.
--
--  2. **An appeal never restores the file.** There is no trigger here that flips
--     `assets.status`. Appealing is not a bypass: the file stays exactly as
--     hidden as it was until an operator decides, which is what makes the appeal
--     worth reading rather than worth spamming.
--
--  3. **The charge is recorded in the appeal, not looked up later.** `reasons`
--     holds the rule codes that were on the table when the seller wrote their
--     answer. Reports get dismissed and rules get retired, and the appeal has to
--     keep saying what it was a reply TO — otherwise a reinstated file's history
--     reads as a seller complaining about nothing.
--
--  4. **The seller's words are their own, bounded.** Capped in the app (and the
--     cap is in the reports module next to the report note's), never the charge.
--     Same rule as a report: a person's sentence is a hint, a rule code is a
--     finding.
--
--  5. **Who reported stays out of it, forever.** The appeal shows the RULES and
--     the count, never identities — the same promise the operator's queue makes.
--     A seller who could identify a reporter has been handed a harassment tool
--     by the platform's own fairness feature.
-- ============================================================================

create table if not exists asset_appeals (
  id            uuid primary key default gen_random_uuid(),
  asset_id      uuid not null references assets(id) on delete cascade,
  channel_id    uuid not null references channels(id) on delete cascade,
  seller_id     uuid not null references profiles(id) on delete cascade,

  -- The seller's answer. Bounded in the app; `not null` because an empty appeal
  -- is not a request, it is a click.
  statement     text not null,

  -- What they were answering: the distinct rule codes in play when they wrote it,
  -- and how many were on the table. Both are snapshots on purpose (see 3 above).
  reasons       text[] not null default '{}',
  report_count  integer not null default 0,

  -- open → upheld (the seller was right; an operator restored the file)
  --      → declined (the hiding stands, and the seller is told why)
  --      → withdrawn (the seller changed their mind — a state that exists because
  --        a queue entry nobody intends to act on is worse than no entry)
  status        text not null default 'open'
                check (status in ('open','upheld','declined','withdrawn')),

  created_at    timestamptz not null default now(),
  decided_at    timestamptz,
  decided_by    uuid references profiles(id),
  decision_note text,

  -- A decision without a decider is an automatic system, and this is the one
  -- place the platform promises a person. Enforced by the database, not by the
  -- route, because the promise is the schema's.
  check ((status = 'open') = (decided_at is null)),
  check ((status = 'open') = (decided_by is null))
);

-- One OPEN appeal per file. Decided ones accumulate as history.
create unique index if not exists idx_asset_appeals_open
  on asset_appeals (asset_id) where status = 'open';

-- The operator's queue: open first, oldest first inside that.
create index if not exists idx_asset_appeals_queue
  on asset_appeals (status, created_at);

-- A seller's own history, newest first.
create index if not exists idx_asset_appeals_seller
  on asset_appeals (seller_id, created_at desc);

comment on table asset_appeals is
  'A seller''s answer to a report-driven hiding. One OPEN appeal per file; an '
  'appeal never restores the file by itself, and the decision always names the '
  'person who made it.';
comment on column asset_appeals.reasons is
  'Rule codes in play when the appeal was written, snapshotted: reports are '
  'dismissed and rules retired, so an appeal must keep saying what it answered.';
