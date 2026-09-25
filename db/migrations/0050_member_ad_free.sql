-- ============================================================================
--  0050 — the platform's own position, released for a store's members
-- ============================================================================
--  `plans.capabilities.ad_free` has been in the plans table since migration 0001
--  and false on every plan. `slots.js` has read it as `POLICY.releasedBy` since
--  the density revision: a capability that takes the platform's own ad position
--  off a page WITHOUT touching any of the store's. It was deliberately unsold,
--  and one test kept the hook from becoming dead code.
--
--  This migration sells it on Pro. The capability is the STORE's side of the
--  purchase; the perk is the store's to give to its own members, and only while
--  their period runs (`memberships.js memberAdFreeFor` checks both).
--
--  WHAT IT DOES NOT DO — each because the alternative contradicts something
--  already written down:
--
--    * It does not release the store's own positions. Those are the store's,
--      filled by the store's own ad connections, and leg 1 of the model.
--    * It does not release the breaks the store's own plan placed inside their
--      own files (`breaks` mode). That is the store's ad in the store's file; a
--      tier's `ad_mode` is what covers a member's own file opening.
--    * It does not release the position for everyone. Rent is priced off the
--      traffic the platform brought, and the position still renders for every
--      visitor who is not a current member of that store.
--    * It cannot be granted by a plan that does not carry it, because the
--      allocator checks the capability before a membership row is ever read.
--
--  The rent is unchanged. A member's pageview still counts; the invoice still
--  prices one rent position. What changes is which boxes are DRAWN for that one
--  viewer, and the ledger counts what was drawn (`drawnSlots`).
--
--  See REVENUE_ARCHITECTURE.md, "The one thing a plan may do to our position",
--  for the research this rests on: Twitch sells the same feature and makes the
--  CREATOR absorb it; YouTube refuses it for memberships because removing ads
--  there requires pooling subscription revenue and paying creators out of the
--  pool. This platform has no such pool and will not acquire one, so the cost is
--  a published price on a plan instead.
-- ============================================================================

update plans
   set capabilities = capabilities || jsonb_build_object('ad_free', true)
 where code = 'pro';

-- The other two plans state it explicitly rather than leaving the key absent:
-- `slots.js` reads `capabilities[releasedBy] !== true`, so absent and false behave
-- the same, and a blob that says false is a blob a seller's page can print.
update plans
   set capabilities = capabilities || jsonb_build_object('ad_free', false)
 where code in ('free', 'store') and not (capabilities ? 'ad_free');

comment on column plans.capabilities is
  'Keys: max_assets, slot_count, can_theme, custom_sections, remove_footer, '
  'marketplace_listed, analytics_level, verified_badge, featured_eligible, ad_free, '
  'memberships, ad_ask_max_ads, ad_ask_max_seconds. '
  '`ad_free` releases the PLATFORM''S OWN ad position (slots.js POLICY.releasedBy) '
  'for a current member of the store, and for nobody else: the store''s own '
  'positions and the breaks inside its own files are untouched by it.';
