-- ============================================================================
--  0048 — the live surface: where the stream is, and who called the break
-- ============================================================================
--  §14 designed the live shape; this is the schema half of it. Two things were
--  missing, and one of them was already being asked for.
--
--  1. WHERE THE STORE'S STREAM IS.
--
--     `assetShape(files, { url: asset.external_url })` has been reading
--     `external_url` in five places since the shape vocabulary was written, and no
--     migration ever created the column — so the live shape existed on paper and
--     could not be reached. This adds it, with the check the design promised: an
--     HLS playlist over https, or a same-origin path to one (which is the demo
--     fixture, served by this app, and is https in production by construction).
--
--     What is refused here and not in a route: `http://`, plain page URLs, and
--     `rtmp://`. RTMP needs an ingest endpoint, and an ingest endpoint is a
--     broadcaster — this platform relays nothing and records nothing, so it must
--     not accept an address that would imply it does.
--
--  2. THE BREAKS THE STORE CALLED.
--
--     One row per break, and the row is the whole mechanism: a break is a WINDOW
--     with a start and an end, opened only by the store's own POST. There is no
--     job and no server rule that inserts here, which is what makes "the platform
--     never inserts a break" a fact about the code rather than a promise (rule 4
--     of the placement catalogue, ASSET ECONOMY §14.3).
--
--     Constraints, all of them the attention rules the catalogue already states
--     for a timed break, expressed where they cannot be bypassed:
--
--       * one OPEN window per file (the partial unique index below) — two breaks
--         at once is not a thing a stream can have;
--       * 15 s to 4 minutes long, never zero, never negative;
--       * `cue_index` is unique per asset and is the ledger's key, exactly like a
--         planner cue's index is for a video. Live cues start at 1; 0 is the entry
--         ask, which is the door rather than a break.
--
--  What is deliberately NOT here:
--
--   - No viewer row. "Has this person already been served this window?" is
--     answered from `pending_views`, which is already the record of every view a
--     person sat through, and a second table holding the same fact would be a
--     second answer to the same question.
--   - No schedule table. The design's schedule IS the store pressing the button;
--     a cron-shaped table would be an inserter, and an inserter is the one thing
--     this shape exists not to have.
--   - No manifest, no segment, no recording. We read the store's playlist and
--     play it; nothing about their stream is copied, rewritten or kept.
-- ============================================================================

alter table assets add column if not exists external_url text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'assets_external_url_is_hls'
  ) then
    alter table assets add constraint assets_external_url_is_hls check (
      external_url is null
      or external_url ~ '^https://[^[:space:]]+\.m3u8([?#][^[:space:]]*)?$'
      or external_url ~ '^/[^[:space:]]*\.m3u8([?#][^[:space:]]*)?$'
    );
  end if;
end $$;

comment on column assets.external_url is
  'Where the bytes live when they are not ours: an HLS playlist URL for a live '
  'file. https only, or a same-origin path (the demo fixture). Null everywhere '
  'else — an uploaded file lives in storage and is served by our own byte route.';

create table if not exists live_breaks (
  id          uuid primary key default gen_random_uuid(),
  asset_id    uuid not null references assets(id) on delete cascade,
  channel_id  uuid not null references channels(id) on delete cascade,
  opened_by   uuid references profiles(id) on delete set null,

  -- The ledger's key for this break, 1-based. 0 is the entry ask, which is the
  -- door; a break is never cue 0, so the two can never be confused in a row.
  cue_index   smallint not null check (cue_index > 0),

  seconds     smallint not null check (seconds between 15 and 240),
  started_at  timestamptz not null default now(),
  ends_at     timestamptz not null,
  closed_at   timestamptz,

  -- Why the store called it, in their own words. Optional, and never shown to a
  -- viewer: it is the seller's note to themselves, the way a cue's label is.
  note        text,

  check (ends_at > started_at),
  check (ends_at <= started_at + interval '4 minutes')
);

-- One open window per file. The whole "a break is not a state a stream is in, it
-- is something that happened" property is this index.
create unique index if not exists uq_live_break_open
  on live_breaks(asset_id) where closed_at is null;

create unique index if not exists uq_live_break_cue
  on live_breaks(asset_id, cue_index);

-- The two questions the panel and the door ask: what ran recently, and what is
-- still covering newcomers.
create index if not exists idx_live_break_recent on live_breaks(asset_id, started_at desc);
create index if not exists idx_live_break_covering on live_breaks(asset_id, ends_at desc);

comment on table live_breaks is
  'A break the STORE called, as a window. Opened by the seller''s own POST and '
  'by nothing else — no job, no cron, no server rule writes here. Viewer asks '
  'against a window go through the same verified-view pipeline as every other '
  'ask (pending_views, break_index = cue_index).';
