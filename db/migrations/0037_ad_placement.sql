-- Where a file's ads sit, as the seller chose it.
--
-- Slice 3 of the asset economy (ASSET_ECONOMY.md §5.2) turns the ask from a number
-- into a number AND a place: a forty-minute lecture may take its price as one
-- break at 11:08 instead of two ads at the door. The ask itself does not move —
-- `ads_required` and `ad_min_seconds` stay exactly as the ladder derived them —
-- so this column adds a decision rather than replacing one.
--
-- The shape the blob may hold is not enforced here, and deliberately so: what a
-- shape allows is a product rule with reasons (a manhwa has no playhead to time a
-- break against), it lives in `src/placement.js` where the seller's page and the
-- tests read it, and a database check duplicating it would be a second copy to
-- keep in step. `setAdPlan` filters every write through that module, so a
-- hand-crafted POST cannot give a download a mid-roll.
--
-- Default `{}` rather than a filled-in object: an empty blob means "nothing
-- chosen yet", which resolves to the shape's defaults at read time (mid on, post
-- off, live off). Storing the defaults would freeze today's defaults into every
-- file — the next time one changes, existing files would keep the old answer.
alter table asset_unlock_policy
  add column if not exists ad_plan jsonb not null default '{}'::jsonb;

comment on column asset_unlock_policy.ad_plan is
  'Seller opt-outs per placement, validated against src/placement.js for the '
  'file''s derived shape. Empty means the shape''s defaults. The ask does not '
  'live here — ads_required/ad_min_seconds do.';

-- The runtime a player measured, reported by the client when metadata loads.
--
-- Placement needs a length to place a break against, and the framework refuses
-- both alternatives: no `ffprobe` dependency on the server, and no seller typing
-- "45 minutes" into a box. So the column is written by the component that
-- actually knows — the player — and stays null until something is played.
--
-- Null is a real state with a real consequence: a file with no measured runtime
-- gets no break inside it (see placement.js `no-runtime`), because guessing a
-- length is how a viewer meets an ad at second 7 of a forty-second clip.
alter table assets
  add column if not exists runtime_sec integer
  check (runtime_sec is null or runtime_sec between 0 and 86400);

comment on column assets.runtime_sec is
  'Measured by the player reporting metadata, never typed by the seller and never '
  'probed on the server. Null until the file has been played once.';
