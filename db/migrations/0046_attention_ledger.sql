-- 0046 — the attention ledger (ASSET_ECONOMY.md §12)
--
-- Slice 5 of the asset economy. §5.5's fifth rule is "prove it before invoicing
-- it", and the proof is two counts that are deliberately never added together:
--
--   * a VERIFIED VIEW — a network's postback that a person completed an ad. It is
--     the store's inventory, the network pays the store directly, and the one
--     statement allowed to write it is `claimAdView`.
--   * a RENDERED POSITION — a box this application drew. It is how the platform's
--     own slot is countable at all, since nothing verifies a house message, and it
--     is an upper bound on attention rather than a measurement of it.
--
-- No money column exists in either part of the ledger. A flat direct deal is priced
-- by conversation (§5.5 pt 3); a rate column here would be a number nobody has
-- agreed to, sitting where a reader would take it for an invoice.

-- ── 1. the verified view learns where it sat ─────────────────────────────────
--
-- Nullable, and it has to be: every view recorded before this migration happened
-- somewhere real, and the ledger cannot invent it. The page groups by these, so a
-- null lands in an "unrecorded" row rather than in somebody else's column.
--
-- The values are the catalogue's own vocabulary, not a second list: `placement` is
-- a key from `placement.js` PLACEMENTS, and the check below is the same nine rules
-- in schema form. A placement that does not exist cannot be written here.
alter table ad_view_events
  add column if not exists placement text;
alter table ad_view_events
  add column if not exists surface text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'ad_view_events_placement_check'
  ) then
    alter table ad_view_events
      add constraint ad_view_events_placement_check
      check (placement is null or placement in ('pre','mid','between','post','rewarded','live','aside'));
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'ad_view_events_surface_check'
  ) then
    -- The PAGE kind, which is a different axis from a slot's delivery surface
    -- (`webview` / `app_native` in `slots.js`): a storefront, a file page, the
    -- members' room, or one of the platform's own pages.
    alter table ad_view_events
      add constraint ad_view_events_surface_check
      check (surface is null or surface in
        ('storefront','asset','member_room','library','plus','platform'));
  end if;
end $$;

create index if not exists idx_ad_view_events_placement
  on ad_view_events(placement, created_at desc);
create index if not exists idx_ad_view_events_surface
  on ad_view_events(surface, created_at desc);

-- ── 2. the attempt carries its own placement ─────────────────────────────────
--
-- Written when the attempt is CREATED, from the plan that built the cue list —
-- because that plan is the only thing that knows whether this stop is a mid-roll
-- or a chapter boundary. A claim that tried to derive it later from `break_index`
-- alone would have to re-run the planner against a runtime that may have been
-- re-measured since, and would put the wrong word on the ledger.
alter table pending_views
  add column if not exists placement text;
alter table pending_views
  add column if not exists surface text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'pending_views_placement_check'
  ) then
    alter table pending_views
      add constraint pending_views_placement_check
      check (placement is null or placement in ('pre','mid','between','post','rewarded','live','aside'));
  end if;
end $$;

-- ── 3. the rendered position ─────────────────────────────────────────────────
--
-- The same shape as `page_view_daily`: one row per day, incremented in SQL. The
-- grain is (channel, day, surface, placement, side) — which is exactly how the
-- ledger's page groups its numbers, so the page reads counters rather than
-- re-aggregating a log, and a year of traffic costs a row a day per shape.
--
-- `channel_id` is NULL for the platform's own pages. There is no store to
-- attribute our landing page to, and inventing a sentinel channel would be worse
-- than an honest null.
--
-- `side` is a column rather than an inference from a slot rank: it is decided by
-- `payoutParty`, the same field that decides whose money a slot is, and it is
-- spelled out here so a future surface that renders both side by side is counted
-- correctly without anybody re-deriving the rule.
create table if not exists ad_position_daily (
  channel_id  uuid references channels(id) on delete cascade,
  day         date not null,
  surface     text not null,
  placement   text not null,
  side        text not null check (side in ('store','platform')),
  impressions bigint not null default 0 check (impressions >= 0),

  -- Postgres 15+ : `nulls not distinct`, so the platform's own pages get one row
  -- per day and shape like every store, instead of a new row per render.
  constraint ad_position_daily_unique
    unique nulls not distinct (channel_id, day, surface, placement, side)
);

create index if not exists idx_ad_position_daily_channel
  on ad_position_daily(channel_id, day desc);

comment on table ad_position_daily is
  'Rendered positions, by page kind, placement and side. A drawn box, refreshed
   counts included — an upper bound on attention, never a viewer count, and never a
   payout. Verified views live in ad_view_events and the two are never summed.';
