-- 0028 — changing several files at once, and being able to take it back.
--
-- The seller's file list was built one file at a time. It shows everything a
-- seller needs to judge a file — state, access, unlocks, the last thirty days —
-- and then asks them to open each one to change anything. At two files that is
-- fine. At two hundred it is not a tool, it is a wall, and the audit has carried
-- the line "a seller with 200 files will want more" since §10.
--
-- Two decisions are encoded here rather than in the markup:
--
--   * A bulk change has to be UNDOABLE, exactly. The researched guidance is
--     consistent — reversible actions should not get a confirmation dialog, they
--     should get an undo — and an undo that re-applies the inverse action is only
--     correct when every affected row was in the same state, which is exactly
--     what a filtered selection cannot promise. So the rows and their previous
--     values are written down, and undo is a restore, not a guess.
--
--   * WHICH rows changed is part of the record. "7 files paused" is a number
--     nobody can check; the ids and the values they held are what make the answer
--     to "what did I do, and can I prove it" a query rather than a memory.
--
-- The 30-minute undo window is NOT stored: it is derived from `created_at`, the
-- same way a check's lapse and a rent's lateness are derived — this codebase has
-- one kind of clock and every state that depends on time is a function of it.
--
-- What is deliberately absent: no expiry sweep, no job that deletes old batches,
-- no `status` column describing the batch (applied vs undone is `undone_at` being
-- null, which cannot disagree with itself), and no per-row batch membership table —
-- the batch is one statement's worth of rows, and `before` is the list.

create table if not exists asset_bulk_batches (
  id         uuid primary key default gen_random_uuid(),
  channel_id uuid not null references channels(id) on delete cascade,
  actor_id   uuid references profiles(id) on delete set null,

  -- The action is kept as its own word ('pause', 'live', 'ad_gated', 'open')
  -- rather than as the column values it wrote: this is what the seller pressed,
  -- and the audit line, the flash message and the undo copy all read it.
  action     text not null check (action in ('pause', 'live', 'ad_gated', 'open')),

  -- Exactly what changed and what it was before: [{id, status, unlock_mode}, …].
  -- Every field the two bulk actions can write, so a restore is total.
  before     jsonb not null,

  applied    int not null default 0,
  unchanged  int not null default 0,
  -- Rows the seller asked for that the platform would not let them change: a file
  -- the report threshold is hiding belongs to an operator until the appeal is
  -- answered, and a bulk action must not become the way around that.
  skipped    int not null default 0,

  created_at timestamptz not null default now(),
  undone_at  timestamptz,
  undone_by  uuid references profiles(id) on delete set null
);

-- The console asks one question of this table: what is the most recent change the
-- seller has not taken back? Partial, because a batch that has been undone is never
-- the answer to it.
create index if not exists idx_asset_bulk_undoable
  on asset_bulk_batches(channel_id, created_at desc)
  where undone_at is null;

comment on table asset_bulk_batches is
  'One row per bulk change to a store''s files, carrying the previous values so the '
  'change can be undone exactly. Not an audit log — the audit log is separate and '
  'immutable; this is working state, and it is the only place an undo can be honest.';
comment on column asset_bulk_batches.before is
  'The rows that actually changed, with the status and unlock_mode each held before. '
  'A restore reads this; an inverse action would be wrong whenever the rows differed.';
comment on column asset_bulk_batches.skipped is
  'How many selected files the platform refused to change because they are hidden '
  'after reports. Counted and reported, never silently dropped.';
