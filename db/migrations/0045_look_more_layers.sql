-- ============================================================================
--  0045 — the ring and the frame, two treatments deeper
-- ============================================================================
--  0044 gave a person a ring they choose and an edge for their own card. Both
--  vocabularies were four values wide, and half of each was "nothing": one ring
--  and one edge were variations on a hairline. That is a slot, not a choice.
--
--  This migration widens both by two, and the two new values in each are chosen
--  to be DIFFERENT KINDS of treatment rather than more of the same:
--
--    plus_ring   + 'beaded'  — texture: the ring drawn as a line of dots
--                + 'split'   — two arcs in the palette's two colours, turning
--
--    plus_frame  + 'bevel'   — a lit edge: two colours across four sides
--                + 'aurora'  — both colours travelling along the edge
--
--  WHAT DID NOT CHANGE, because it is the rule rather than the styling:
--
--  * A ring is drawn on the avatar's own pseudo-elements; the store's top-tier
--    light is a box-shadow on the same element. Two owners, two properties — a
--    person taking their ring off can never put out the store's light.
--
--  * A frame is an EDGE and never a surface. The two new frames keep that: the
--    bevel is four one-pixel inset rules, and the aurora is a gradient confined
--    to the border band by a mask, declared inside `@supports (mask-composite:
--    exclude)` so a browser that cannot confine it renders NO edge instead of a
--    repainted card. `test/cosmetics.test.js` reads the stylesheet and holds
--    both halves of that: no frame rule may set a text colour, and a frame rule
--    that sets a background must be masked and inside the support query.
--
--  * NULL still means "never chosen". Every profile that has not opened the
--    picker keeps the ring it has always had, and the four values that existed
--    before this migration render exactly as they did.
-- ============================================================================

alter table profiles drop constraint if exists profiles_plus_ring_check;
alter table profiles
  add constraint profiles_plus_ring_check
  check (plus_ring is null or plus_ring in ('none','hairline','beaded','orbit','split','double'));

alter table profiles drop constraint if exists profiles_plus_frame_check;
alter table profiles
  add constraint profiles_plus_frame_check
  check (plus_frame is null or plus_frame in ('none','hairline','bevel','double','glow','aurora'));

comment on column profiles.plus_ring is
  'The ring around the wearer''s initial: none, hairline, beaded (dotted), orbit '
  '(turns on hover), split (two arcs, turns), double. NULL means not chosen, which '
  'renders as the ring every look has always had.';

comment on column profiles.plus_frame is
  'The edge of the wearer''s own card: none, hairline, bevel, double, glow, aurora. '
  'Decorates an edge only — never the card''s surface, its ink, or anything the store '
  'owns. NULL means not chosen, which renders as the card''s own border.';
