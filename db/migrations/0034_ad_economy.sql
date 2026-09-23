-- 0034 — the ad economy, rewritten around two numbers instead of eight.
--
-- The product shipped able to put EIGHT ad positions on one page (Pro's
-- `slot_count`), each one a box a seller filled by hand, and able to ask a
-- stranger for FIVE rewarded ads of up to 120 seconds each — ten minutes of a
-- person's life — with the seller choosing both numbers from memory.
--
-- Neither of those is defensible, and the researched record says so plainly:
-- rewarded views under 15 s complete at 79.4% against 51.8% for 30 s or more
-- (Nielsen, 18,400 campaigns); ad density past three impressions per page is
-- where fatigue starts; the resentment of 2026 is aimed at 90-second unskippable
-- units. The two changes in this migration are the platform's side of that:
--
--   * `slot_count` becomes a number between one and two, for every plan. A page
--     carries at most two positions the STORE owns, plus at most one the platform
--     takes — three boxes, maximum, on the longest page in the product. Density
--     was the old upsell (3 → 5 → 8); it is not one any more, because a third
--     position is worth less than the visitor it costs.
--   * The ask (`ads_required` × `ad_min_seconds`) becomes DERIVED: a band read off
--     the file's declared value (`assets.declared_value_npr`), then capped by the plan's
--     two new capability keys. `ads_required` and `ad_min_seconds` stay exactly
--     where they are, so every read path in the app — the unlock panel, the
--     storefront listing, the entitlements pipeline — keeps working untouched.
--     What changes is who decides the numbers: `src/adscale.js`, not a text box.
--
-- THE ABSOLUTE CEILING IS NOT A CAPABILITY. No file on this platform asks for more
-- than 3 ads, more than 60 seconds each, or more than 3 minutes in total. That
-- sentence holds on Free and it holds on Pro; the capability only decides how much
-- of it a store may use. A promise with a price list is not a promise.
--
-- See `AD_ECONOMY.md` for the sources and `REVENUE_ARCHITECTURE.md` for where this
-- sits in the money model.

-- ── 1. the positions: one or two, for everybody ────────────────────────────
--
-- `slot_count` is redefined in place rather than renamed, because renaming a
-- capability key means touching the pricing page, the plan panel, the drift check
-- and the seed in 0001 — four places that then have to agree about a name. It now
-- means "positions on a page that this plan's own ads may occupy", and the values
-- are the whole of the density policy.
--
-- The platform's own position is NOT counted here. It is allocated separately
-- (`slot_count` store positions + at most one platform position), which is why the
-- cap and the rent can both stay true: the most any page can carry is three, and a
-- store carries three only when BOTH of its own positions have a live message —
-- an empty position renders nothing to a visitor, so a paid storefront with one
-- message measures two boxes, which is what `/s/alice` did in the browser pass.
update plans set capabilities = capabilities || '{"slot_count": 1, "ad_ask_max_ads": 1, "ad_ask_max_seconds": 30}'::jsonb
 where code = 'free';
update plans set capabilities = capabilities || '{"slot_count": 2, "ad_ask_max_ads": 2, "ad_ask_max_seconds": 45}'::jsonb
 where code = 'store';
update plans set capabilities = capabilities || '{"slot_count": 2, "ad_ask_max_ads": 3, "ad_ask_max_seconds": 60}'::jsonb
 where code = 'pro';

comment on column plans.capabilities is
  'Keys: max_assets, slot_count (positions the STORE owns on one page: 1 free, 2 '
  'paid), ad_ask_max_ads / ad_ask_max_seconds (how much of the platform-wide ask '
  'promise this plan may use), can_theme, custom_sections, remove_footer, '
  'memberships, marketplace_listed, analytics_level, verified_badge, '
  'featured_eligible, ad_free. Nothing here may gate the ability to EARN.';

-- ── 2. the ask: derived, stored, and readable exactly as before ────────────
--
-- `ads_required` and `ad_min_seconds` keep their names and their meaning: they are
-- still what the unlock pipeline reads when it creates a pending view, and still
-- what the buyer is shown before deciding. The two new columns record WHERE the
-- numbers came from, which is what makes the seller's page able to say why, and
-- what lets a later price change be presented honestly as a change:
--
--   ask_level    'standard' (the band rate for this value) or 'light' (the floor)
--   ad_band_npr  the declared value the ask was calibrated from, at save time
--
-- A saved ask is NOT recomputed when the price changes. A file that says "1 ad of
-- 20 seconds" on the storefront keeps saying that until its seller saves the page
-- again — an ask that moved on its own under somebody's feet would be worse than
-- one that is briefly stale, and the seller's page shows the drift.
-- WHERE THE VALUE COMES FROM, and why it is a new column rather than a revived
-- `assets.price_npr`: migration 0004 dropped that column ON PURPOSE, with the
-- argument that "a price column with no payment path behind it is an invitation"
-- and that the schema should describe what IS. That argument is still right.
--
-- This column is not a price and is not a step towards one. Nothing can be bought
-- with it, no checkout reads it, no visitor is shown it, and `NOT_CHARGED` still
-- says there is no price on a file. It is a seller's own statement of what a file
-- is worth to them, and its only reader is the ask ladder in `src/adscale.js`.
-- The distinction is in the comment here so that a later reader does not find a
-- number on an asset and assume the old purchase model came back.
alter table assets add column if not exists declared_value_npr integer not null default 0;
alter table assets drop constraint if exists assets_declared_value_range;
alter table assets
  add constraint assets_declared_value_range
  check (declared_value_npr between 0 and 1000000);
comment on column assets.declared_value_npr is
  'What the seller says the file is worth, in NPR. NOT a price: nothing is sold with '
  'it, no page shows it, and only the ask ladder (src/adscale.js) reads it. 0 means '
  'the seller has not said.';

alter table asset_unlock_policy add column if not exists ask_level text not null default 'standard';
alter table asset_unlock_policy add column if not exists ad_band_npr integer;
alter table asset_unlock_policy drop constraint if exists asset_unlock_policy_ask_level_check;
alter table asset_unlock_policy
  add constraint asset_unlock_policy_ask_level_check
  check (ask_level in ('standard','light'));

comment on column asset_unlock_policy.ads_required is
  'How many rewarded views this file asks for. Derived from the file''s value band '
  'and capped by the plan — see src/adscale.js. Never typed by a seller.';
comment on column asset_unlock_policy.ad_band_npr is
  'The declared value the ask was calibrated from when the seller last saved. Null '
  'on rows written before 0034 and not yet re-saved.';

-- Existing asks are cut to the platform promise, and raised to its floor. The two
-- directions are not the same kind of change and the comment says why:
--
--   * DOWN, at the ceiling: no file asks for more than 3 ads of 60 seconds. A seller
--     who had set 5 × 120 s finds their file asking 3 × 60 s.
--   * UP, at the floor: no file asks for less than one 15-second view. Every row
--     below it is the old form's 5-second default rather than a decision, and a
--     rewarded network does not serve a five-second unit, so the "ask" those rows
--     carried was one the pipeline could never satisfy. Raising it fixes a broken
--     value; it does not lengthen a visitor's wait beyond the product's own floor,
--     which the unlocking panel prints before anybody presses anything.
--
-- No row gains a second ad, no unlock that was already granted is affected
-- (`unlocks` rows are untouched, so anything a person opened with a longer ask stays
-- open for as long as it was granted), and `ad_band_npr` is deliberately NOT filled
-- in here: these asks were typed by hand before the ladder existed, so recording a
-- value they were "calibrated from" would be a claim the row cannot support. A null
-- band means exactly that, and the seller's page shows the derived rate next to it —
-- the numbers are pulled to the promise, the story about where they came from is not
-- invented.
update asset_unlock_policy p
   set ads_required   = least(p.ads_required, 3),
       ad_min_seconds = least(greatest(p.ad_min_seconds, 15), 60),
       updated_at     = now()
  from assets a
 where a.id = p.asset_id
   and (p.ads_required > 3 or p.ad_min_seconds > 60 or p.ad_min_seconds < 15);

-- The database's own checks stay wider than the policy on purpose: the limit that
-- matters is enforced by code both in front of and behind this table, and widening
-- a check constraint to match a policy change is a migration that every
-- environment needs in lockstep. The policy is the tighter of the two, and
-- test/adscale.test.js proves no plan can reach the schema's edge.

-- ── 3. when an ad does not arrive ─────────────────────────────────────────
--
-- The blocker ladder (src/blocked.js) needs one fact it cannot guess: how many
-- times this person's unlock failed to produce a verified view. A row per failure,
-- with the signal that produced it. Deliberately small and deliberately boring:
-- no user agent, no fingerprint, no IP.
--
-- Nothing here identifies a person to a network, and nothing here is a "blocker
-- score". `user_id` is null for a signed-out visitor, whose failures are counted
-- per asset for the length of a session and then forgotten by age.
create table if not exists ad_block_signals (
  id              uuid primary key default gen_random_uuid(),
  asset_id        uuid references assets(id) on delete cascade,
  channel_id      uuid references channels(id) on delete cascade,
  user_id         uuid references profiles(id) on delete set null,
  -- The pending view that never landed, when the client knows it.
  pending_view_id uuid references pending_views(id) on delete set null,
  signal          text not null
                  check (signal in ('script_blocked','no_postback','declined','unknown')),
  created_at      timestamptz not null default now()
);
create index if not exists idx_block_signals_asset_time on ad_block_signals(asset_id, created_at desc);
create index if not exists idx_block_signals_user_time  on ad_block_signals(user_id, created_at desc);
create index if not exists idx_block_signals_channel_time on ad_block_signals(channel_id, created_at desc);
comment on table ad_block_signals is
  'One row per unlock attempt that produced no verified view. Read by the ladder in '
  'src/blocked.js to decide how plainly to explain itself, and by the seller''s '
  'dashboard as a count. Never used to accuse a browser: the platform cannot tell '
  'Brave from a flaky connection, so it does not pretend to.';

-- `pending_views` needs nothing new: a view that exists and never completes IS the
-- evidence, and the signal row points at it.

-- ── 4. what did not change, on purpose ────────────────────────────────────
--
-- `members` mode and `member_tier` (0031) are untouched: a file that opens for
-- members still asks for no ad at all, and a member who paid their creator never
-- sees a rewarded view for the files their tier opens. That is the difference
-- between the two premium things on this platform and it stays sharp — a store's
-- plan buys capabilities for the store, a membership buys access from the store,
-- and the platform's own customer product (0033) buys cosmetics and opens nothing.
