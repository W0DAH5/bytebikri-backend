-- 0035 — the ask's floor and ceiling become facts the database keeps, not
-- conventions the code remembers.
--
-- 0034 said in its own comment that the ask "is never typed by a seller" and that
-- a rewarded view shorter than 15 seconds "is not a thing a network serves". Both
-- statements were true of the seller's file page and FALSE everywhere else, and a
-- browser pass found the contradiction rather than a test:
--
--   * the PUBLISH form still carried a "Minimum ad length" box (min 5, max 120),
--     and `POST` still wrote whatever it was given, clamped to that range — so a
--     seller could publish a file asking for a five-second view from the very form
--     that was supposed to have stopped asking;
--   * the DEMO SEED called `setAdMinSeconds(asset.id, 5)` twice, "demo-friendly:
--     5 seconds rather than the real 15". The demo then showed the product
--     contradicting itself: the file page's own summary read "Now: 1 ad of 5
--     seconds" directly above the ladder's "1 ad of 15 seconds";
--   * `store.setAdMinSeconds` existed as a public method with no policy in it at
--     all — a setter that could write any number into the column the pipeline
--     reads. It is deleted in this round's code change; this migration is what
--     makes deleting it safe rather than merely tidy.
--
-- A CHECK is the right instrument because the floor is not a policy that a plan,
-- a price or a future product decision may move: it is the shortest unit the
-- advertising network will serve, and it is the number the platform publishes on
-- every file page ("No file here asks for more than 3 ads, more than 60 seconds
-- each, or more than 3 minutes in total"). The ceiling is the matching half of the
-- same published sentence. Together they mean no writer — a route, a script, a
-- seeder, a future admin tool, or somebody with a psql prompt — can put a file in a
-- state the product promises not to have.
--
-- The bounds are deliberately WIDER than the ladder's current bands (which top out
-- at 3 × 60): `adscale.js` may add bands, and a band must not need a migration. The
-- check is the promise's edge, not the ladder's.
alter table asset_unlock_policy drop constraint if exists asset_unlock_policy_ask_bounds;

-- Repair first, so the constraint can be added on a database that already holds a
-- row a seed or a script wrote. Same two directions, same reasoning as 0034: down
-- at the ceiling, up at the floor — and NO row gains an ad, because the count is
-- not what this migration is about.
update asset_unlock_policy
   set ad_min_seconds = least(greatest(ad_min_seconds, 15), 600),
       updated_at     = now()
 where ad_min_seconds < 15 or ad_min_seconds > 600;

alter table asset_unlock_policy
  add constraint asset_unlock_policy_ask_bounds
  check (ads_required between 0 and 10 and ad_min_seconds between 15 and 600);

comment on constraint asset_unlock_policy_ask_bounds on asset_unlock_policy is
  'The published promise, enforced where no writer can route around it: a rewarded '
  'view is 15 to 600 seconds, and a file asks for at most 10 of them. The ladder in '
  'src/adscale.js is narrower (3 x 60) and may change without a migration.';

-- The same floor for the view the pipeline creates, because a pending view is what a
-- network is actually asked to serve. It is written from the policy row, so a policy
-- that cannot be under 15 cannot produce one — this is the second lock on the same
-- door, and it is cheap.
alter table pending_views drop constraint if exists pending_views_ad_min_seconds_check;
update pending_views set ad_min_seconds = least(greatest(ad_min_seconds, 15), 600)
 where ad_min_seconds < 15 or ad_min_seconds > 600;
alter table pending_views
  add constraint pending_views_ad_min_seconds_check
  check (ad_min_seconds between 15 and 600);
