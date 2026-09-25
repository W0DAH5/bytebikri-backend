-- ============================================================================
--  0047 — a reader of our own, and the two rows it needs
-- ============================================================================
--  §13 designed the reader surface; this is the schema half of it, and it is
--  deliberately small, because almost everything the reader needs already exists:
--  the archive is read from storage, the pages are served by the same signed and
--  ranged route as every other byte, and a gate is cleared by the same verified
--  view that clears a mid-roll. Two things were missing.
--
--  1. HOW A STORE WANTS ITS FILE PRESENTED.
--
--     A webtoon is a vertical scroll with no page turn; a manga volume is page
--     turns, and manga reads RIGHT TO LEFT. Those are the store's decisions about
--     their own work — not ours, and not the reader's — so they are columns on the
--     asset with defaults that describe the common case (`page`, left to right) and
--     a check constraint that keeps the vocabulary closed. A reader that guessed
--     the direction from a filename would turn a manga backwards half the time and
--     a manhwa forwards the rest, which is worse than not turning it at all.
--
--  2. WHERE SOMEBODY STOPPED READING.
--
--     One row per person per file. This is the feature every reader expects
--     ("continue where you left off") and the one place a person's behaviour inside
--     a file is recorded at all — so the shape is a promise: the row holds a step
--     and a time, the store can see that the file was opened and never where in it
--     somebody stopped, and writing it is not a side effect of rendering a page.
--
--  What is deliberately NOT here:
--
--   - No per-page row. Pages are derived from the file (an archive's own index, or
--     the file list) and are never stored: a cached page list is a copy of somebody
--     else's upload that can go stale, and the archive already knows its own pages.
--   - No "current chapter" for a position marker that could be replayed. The step
--     is a convenience for the person reading; it is never read as evidence that a
--     page was seen, because nothing in this product's accounting may be moved by a
--     client saying so.
--   - No reading position on the store's side at all: there is no column, and no
--     page joins this table for a seller.
-- ============================================================================

alter table assets
  add column if not exists read_mode      text not null default 'page',
  add column if not exists read_direction text not null default 'ltr';

alter table assets drop constraint if exists assets_read_mode_check;
alter table assets add constraint assets_read_mode_check
  check (read_mode in ('page', 'scroll'));

alter table assets drop constraint if exists assets_read_direction_check;
alter table assets add constraint assets_read_direction_check
  check (read_direction in ('ltr', 'rtl'));

comment on column assets.read_mode is
  'How the reader presents this file: one page per screen, or a vertical scroll. '
  'The store chooses; the reader never guesses.';
comment on column assets.read_direction is
  'Which way the pages turn: ltr for manhwa and western comics, rtl for manga.';

create table if not exists reading_progress (
  user_id    uuid not null references profiles(id) on delete cascade,
  asset_id   uuid not null references assets(id) on delete cascade,
  step       integer not null check (step >= 1),
  updated_at timestamptz not null default now(),
  primary key (user_id, asset_id)
);
create index if not exists idx_reading_progress_asset on reading_progress(asset_id);
comment on table reading_progress is
  'Where a person stopped reading, one row per (person, file). Written when a page '
  'actually changes, never when a page renders: a crawler or a refresh is not a '
  'reader. Private to the person — no store-facing page reads this table, and the '
  'schema test asserts that no column here can be read as an accounting fact.';

-- The gate lookups: "has this person cleared this seam of this file?" is asked once
-- per gate on every reader render, and answered from the attempt rows that already
-- exist. Partial, because only completed views can clear anything.
create index if not exists idx_pending_cleared
  on pending_views(user_id, asset_id, break_index)
  where completed and break_index is not null;
