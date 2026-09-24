-- ============================================================================
--  0038 — a file that opens free and asks inside it
-- ============================================================================
--  Slice 3 built the planner: given a shape, a measured runtime, the ladder's ask
--  and the plan, it says where a break may sit. Nothing could yet STOP a player at
--  one, so the plan was real to the seller and invisible to the buyer, and the
--  buyer-facing sentence was deliberately withheld rather than promised.
--
--  This migration adds the one thing the player gate needs, plus the mode that
--  makes it reachable: `breaks` — free to open, a view inside. Three decisions are
--  recorded here rather than in code comments alone, because each of them is a
--  promise about somebody's attention.
--
--  1. A NEW MODE, not a reinterpretation of an old one.
--
--     `open` means, on the buyer's page, "Free — no ad needed". A store that chose
--     it has been promising that to its visitors ever since, so turning `open`
--     files into ad-carrying ones would break a promise to make a feature easier.
--     `breaks` is a separate value with its own sentence on the page, its own
--     seller label, and its own consequences.
--
--  2. THE BREAK IS INSIDE A FILE THAT WAS ALREADY FREE TO OPEN.
--
--     That restriction is the whole safety argument, and it is expressed here as a
--     value rather than as a rule in a server route: a break can only exist on a
--     mode whose door does not charge. Nothing that used to be released by a
--     server-checked unlock becomes releasable by a client-side pause. A seek past
--     a break costs the store an impression it never used to have; it can never
--     cost the store content it was charging for.
--
--  3. THE BREAK IS SNAPSHOTTED WHEN IT STARTS.
--
--     `break_index` says which cue in the plan this is, and `break_at_sec` records
--     where that cue was at the moment the viewer reached it. A seller editing
--     their plan mid-watch must not move a break somebody is already sitting
--     through — the same rule the door's `required_ads` follows.
-- ============================================================================

alter table assets drop constraint if exists assets_unlock_mode_check;
alter table assets
  add constraint assets_unlock_mode_check
  check (unlock_mode in ('open','ad_gated','paid','members','breaks'));

alter table asset_unlock_policy drop constraint if exists asset_unlock_policy_mode_check;
alter table asset_unlock_policy
  add constraint asset_unlock_policy_mode_check
  check (mode in ('open','ad_gated','paid','members','breaks'));

comment on column assets.unlock_mode is
  'How the file opens. open = free, no ad at all; breaks = free to open with '
  'verified views inside it; ad_gated = the ask is the door; members = opened by a '
  'tier; paid = reserved, not built.';

-- Which cue this attempt is, when it is a break rather than the door. Null means
-- the door — which is what every existing row is, so no backfill is needed.
alter table pending_views add column if not exists break_index smallint;
alter table pending_views add column if not exists break_at_sec integer;

comment on column pending_views.break_index is
  'Index into the asset''s placement plan when this attempt is a break inside a '
  'file. Null = the door (the ask paid before content).';
comment on column pending_views.break_at_sec is
  'Where that cue sat when the viewer reached it, in seconds. Snapshotted so a plan '
  'edited mid-watch cannot move a break under somebody who is watching it.';

create index if not exists idx_pending_break on pending_views(asset_id, user_id, break_index)
  where break_index is not null;
