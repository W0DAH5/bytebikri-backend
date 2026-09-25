-- ============================================================================
--  0049 — the series: a playlist of episodes the store owns
-- ============================================================================
--  §15 is the design and §15.1 is the whole architecture: a series is a store's
--  own grouping of the store's own files, so this migration adds a small table
--  and two columns — NOT a second content table.
--
--  Why not a second content table: an episode is an ordinary file. It has its own
--  cover, its own unlock mode, its own ask, its own ledger row, its own page, and
--  its own position in `ad_view_events`. A `series_episodes` table holding files
--  of its own would need a second unlock path, a second content route, a second
--  ledger and a second shelf, and every one of those would be a place for a file's
--  own rules to be quietly different. Two columns on `assets` keeps an episode a
--  file in every way that matters.
--
--  1. THE SERIES ITSELF. One row per store per series, with a slug unique inside
--     the store (the storefront's own URLs are `/s/<store>/…`, so a title is not
--     an address and a slug is). `mode` is the creator's answer to the one
--     question that changes the buyer's page — see `series.js`, which owns the
--     vocabulary and the order each value implies.
--
--  2. THE ORDER. `episode_no` is the store's number, not a sort key we invent:
--     YouTube's Shows assigns episode numbers from the creator's manual order and
--     falls back to publish date, which is the behaviour this copies — except that
--     here there is no fallback, because a series whose order we guessed would be
--     the "next video is unrelated" failure its own research paper documents.
--     Gaps are allowed on purpose: deleting episode 3 of 5 leaves 1, 2, 4, 5, and
--     renumbering everybody else's episodes behind the store's back would be us
--     editing their edit.
--
--  3. WHERE SOMEBODY STOPPED WATCHING. `watch_progress` is the reader's bookmark
--     (`reading_progress`, 0047) in the shape video needs, and it carries the same
--     two promises, written down here because this is where somebody would look:
--     the store is never shown it (there is no seller query in the codebase that
--     reads this table), and NOTHING in accounting reads it — a view is credited
--     by the network's signed postback, and a client claiming a position cannot
--     move a number in the ledger.
--
--  What is deliberately NOT here:
--
--   - No season. A season is a third level of disclosure, and §4's finding is that
--     more than two causes navigation confusion (YouTube drops every converted
--     playlist into "Season 1" for exactly this reason). A store with two seasons
--     publishes two series.
--   - No series-level price, bundle or unlock. Each episode asks its own door;
--     bundling is pricing and pricing is money movement.
--   - No `sort_order` on the episode. The number IS the order — a second ordering
--     column is a second answer to the same question.
--   - No position on the seller's side, and no aggregate ("episode 3 is where
--     everyone stops"). That number is a reading of the audience, and the reader's
--     own bookmark refused it first.
-- ============================================================================

create table if not exists series (
  id           uuid primary key default gen_random_uuid(),
  channel_id   uuid not null references channels(id) on delete cascade,

  -- The address, unique inside the store: `/s/<store>/series/<slug>`.
  slug         text not null check (slug ~ '^[a-z0-9][a-z0-9-]{1,80}$'),
  title        text not null check (length(title) between 1 and 140),
  -- One line in the creator's words. Optional, because a series with a bad blurb
  -- is better than a form that will not save.
  blurb        text,

  -- `serial` — episodes are intended to be watched in order, listed oldest number
  --            first, with a *Next episode* control;
  -- `collection` — any order, listed newest first, and NO next control, because in
  --            a collection there is no next. What the store chose is what the
  --            buyer's page does, and there is no third behaviour to guess at.
  mode         text not null default 'collection' check (mode in ('serial', 'collection')),

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  unique (channel_id, slug)
);

comment on table series is
  'A store''s own grouping of its own files (ASSET_ECONOMY §15). The store owns the '
  'order; bytebikri cannot create one, reorder one or insert into one.';

--  DELETING A GROUPING MUST NOT DELETE A FILE, AND MUST NOT LEAVE A HALF-STATE EITHER.
--
--  The obvious `on delete set null` is wrong in a way only a database can be wrong:
--  it nulls `series_id` and leaves `episode_no` standing alone, which the paired check
--  below then refuses — so `delete from series` fails outright with a constraint error.
--  (PostgreSQL's `set null (columns)` form cannot help: the column list must be part of
--  the foreign key itself, and `episode_no` is not.) Cascading instead would delete
--  somebody's files because they tidied up a grouping, which is worse.
--
--  So the last act of a series is written down once, as a trigger: its episodes lose the
--  grouping AND the number together and go back to being ordinary files. It fires for
--  a hand-written DELETE, for the store's own delete, and for a channel being removed
--  (which cascades into this table), so there is no path where the pair is half-cleared.
--  Found by the test that drops a series and asserts its episodes survive.
alter table assets add column if not exists series_id uuid;
alter table assets add column if not exists episode_no integer check (episode_no is null or episode_no between 1 and 9999);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'assets_series_id_fkey') then
    alter table assets add constraint assets_series_id_fkey
      foreign key (series_id) references series(id) on delete set null;
  end if;
end $$;

create or replace function assets_leave_series() returns trigger as $$
begin
  update assets
     set series_id = null, episode_no = null
   where series_id = old.id;
  return old;
end;
$$ language plpgsql;

drop trigger if exists assets_leave_series on series;
create trigger assets_leave_series before delete on series
  for each row execute function assets_leave_series();

-- A number without a series is a number about nothing, and a series without a
-- number cannot be ordered. Both halves are required together or neither is.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'assets_episode_needs_series') then
    alter table assets add constraint assets_episode_needs_series
      check ((series_id is null) = (episode_no is null));
  end if;
end $$;

-- One number, one episode. Enforced in SQL rather than in a route, because the
-- route is not the only writer forever and two episodes at number 4 is a page
-- that silently renders four items in an unpredictable order.
create unique index if not exists uq_series_episode_no
  on assets (series_id, episode_no) where series_id is not null;

create index if not exists idx_assets_series on assets (series_id) where series_id is not null;
create index if not exists idx_series_channel on series (channel_id);

-- Where somebody stopped watching. One row per person per file, like the reader's
-- bookmark, and the same promise: nobody but the person reading it ever sees it.
create table if not exists watch_progress (
  user_id     uuid not null references profiles(id) on delete cascade,
  asset_id    uuid not null references assets(id) on delete cascade,
  -- Whole seconds into the file. `0` is a real value (they opened it and left), so
  -- it is not a sentinel for "no row" — the absence of a row is that.
  position_sec integer not null check (position_sec between 0 and 86400),
  updated_at  timestamptz not null default now(),
  primary key (user_id, asset_id)
);

comment on table watch_progress is
  'The viewer''s own position in a file: written by the player, read to resume, never '
  'shown to a store, and never read by any accounting path — a credited view comes '
  'from the network''s signed postback and cannot be moved by a client (ASSET_ECONOMY §15.2).';
