-- ============================================================================
-- 0014 — the Store tier can list in Explore
--
-- Explore is what a paid plan buys: bytebikri brings the traffic, so discovery
-- is the thing being sold. The Store tier (NPR 999) was marked
-- `marketplace_listed: false`, which meant a seller could pay the first paid
-- tier, get more slots and more files, and still be invisible — paying for
-- capacity while the product's actual promise (we bring the people) went
-- unsold at that tier.
--
-- That also contradicts the rule this pricing was built on: the free tier is
-- the unrestricted one, and the paid tiers are what a seller buys when the
-- store is working. Charging money and withholding discovery is not that.
--
-- What stays premium is PLACEMENT, not visibility: `featured_eligible` (top
-- seller rows) remains Pro-only, as do unlimited files, unlimited sections and
-- full analytics. Both places that hold capabilities are updated here — the
-- `plans` row and `PLANS` in src/store.js — because a capability defined in two
-- places is a capability that will disagree with itself.
-- ============================================================================

update plans
   set capabilities = jsonb_set(capabilities, '{marketplace_listed}', 'true'::jsonb)
 where code = 'store';

comment on column plans.capabilities is
  'Capability map per plan. `marketplace_listed` is the Explore directory — a paid '
  'capability from the Store tier up; `featured_eligible` (top-seller placement) is '
  'Pro only. Nothing in this map may gate the ability to earn.';
