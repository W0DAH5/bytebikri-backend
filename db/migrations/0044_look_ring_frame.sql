-- ============================================================================
--  0044 — the look's two outer layers: the ring, and the card's frame
-- ============================================================================
--  A look was a palette and an effect: what the name is painted in, and what happens
--  around the paint. This migration adds the two decorations a person wears on the
--  CARD rather than on the letters, which is what the cosmetics review asked for
--  ("avatar frame", "profile frame") in the two forms this product can honestly have:
--
--    plus_ring   — what the initial is ringed with. Until now every look carried the
--                  same ring (a flat 2px ring in the palette, with a slow conic sweep
--                  on hover), because that was the only thing a look could mean. It is
--                  a choice now, including the choice to have none.
--
--    plus_frame  — the edge of the person's own card, wherever that card is drawn:
--                  the store's roster, the seller's member queue, their own preview.
--
--  WHAT A FRAME IS, AND WHAT IT IS NOT. It is the PERSON'S, not the store's: the card
--  is a rendering of a person and their cosmetics travel with them, which is the same
--  rule the name paint already follows. It decorates an EDGE — a border, an inset
--  hairline, a soft glow behind the card — and it may never touch the card's surface,
--  its ink, or anything the store owns (its chip, its layout, its band). A test reads
--  the stylesheet and fails if a frame rule sets a colour or a background, because the
--  moment a frame can change what the words sit on, it is a contrast claim nobody made.
--
--  NULL IS "NOT CHOSEN", and it renders exactly as the product does today: the ring a
--  look has always had, and the card's own border. That is deliberate — every existing
--  wearer keeps the look they already have, and the picker is what changes it.
--
--  Both columns are checked by name, the way `0040` and `0041` check their vocabularies,
--  so the database refuses a key the app does not know. `test/cosmetics.test.js` asserts
--  these lists and `src/cosmetics.js` agree, which is what stops a slot shipping in one
--  place and not the other.
-- ============================================================================

alter table profiles add column if not exists plus_ring text;
alter table profiles add column if not exists plus_frame text;

alter table profiles drop constraint if exists profiles_plus_ring_check;
alter table profiles
  add constraint profiles_plus_ring_check
  check (plus_ring is null or plus_ring in ('none','hairline','orbit','double'));

alter table profiles drop constraint if exists profiles_plus_frame_check;
alter table profiles
  add constraint profiles_plus_frame_check
  check (plus_frame is null or plus_frame in ('none','hairline','double','glow'));

comment on column profiles.plus_ring is
  'The ring around the wearer''s initial: none, hairline, orbit (turns on hover), '
  'double. NULL means not chosen, which renders as the ring every look has always had.';

comment on column profiles.plus_frame is
  'The edge of the wearer''s own card: none, hairline, double, glow. Decorates an edge '
  'only — never the card''s surface, its ink, or anything the store owns. NULL means '
  'not chosen, which renders as the card''s own border.';
