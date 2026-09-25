-- ============================================================================
--  0041 — the tier's glyph: the store's own role icon
-- ============================================================================
--  A tier on this platform is a name and a colour. Both belong to the creator, and
--  both render on somebody else's roster — which is the one place a store cannot
--  say anything with a picture. This migration adds the smallest honest version of
--  that: one shape, from a fixed vocabulary, worn inside the tier's chip.
--
--  Three decisions, each of them about somebody else's page.
--
--  1. A NAMED SET, NOT AN IMAGE. The alternative is an upload — Discord's own role
--     icons are a 64×64 image at Boost L2, and their specs say it renders at
--     "roughly 20 pixels next to a username, so use one bold shape". An upload at
--     that size buys a moderation queue, a storage decision and a way to make a
--     storefront unreadable; a vocabulary buys six shapes that were drawn for 20
--     pixels. The check constraint lists them by name so the database refuses a
--     seventh before any code has to.
--
--  2. NO COLOUR COLUMN, AND THAT ABSENCE IS THE DECISION. A glyph is painted in
--     `currentColor` — exactly the ink the tier's own name is painted in — so it
--     can never be less readable than the word beside it, in either colour scheme,
--     at any of the eight palettes. A `glyph_colour` column would be a second
--     colour to check and a second way for a creator to make their own page
--     unreadable.
--
--  3. NULL MEANS NONE, AND NONE IS THE DEFAULT. Every existing tier gets no glyph
--     and renders exactly as it did before this migration, which is what "the
--     default is the absence of a feature" means here. A creator clears a glyph by
--     choosing "no mark"; nothing is lost by it and nothing needs a new tier.
--
--  The top tier is still the only one that glints (`plateStyle` in
--  `src/memberships.js`). A glyph is available to both tiers, because it is the
--  tier's identity rather than its shine — and one shape beside a name is not the
--  thing that stops an elite tier feeling special.
-- ============================================================================

alter table membership_tiers add column if not exists glyph text;

alter table membership_tiers drop constraint if exists membership_tiers_glyph_check;
alter table membership_tiers
  add constraint membership_tiers_glyph_check
  check (glyph is null or glyph in ('star', 'spark', 'diamond', 'hex', 'shield', 'peak'));

comment on column membership_tiers.glyph is
  'One shape from GLYPHS in src/memberships.js, worn inside this tier''s chip wherever '
  'the chip renders (the roster, the seller''s queue, a review, the tier card). No '
  'image: the shape is drawn in CSS and painted in `currentColor`, so it inherits the '
  'contrast of the tier name it sits beside. NULL = no glyph. The list here and the '
  'module are kept equal by a test rather than by memory.';
