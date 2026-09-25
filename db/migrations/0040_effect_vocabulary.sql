-- ============================================================================
--  0040 — the effect vocabulary, and why it is a list rather than a free field
-- ============================================================================
--  0033 shipped three effects: plain, a rule under the name, and a halo. That was
--  enough to prove the shape and not enough to be worth NPR 149 to somebody who
--  came for a look: the researched vocabulary (Discord's display-name styles) is
--  solid / gradient / neon / prism, plus its nameplates, plus the ring on an
--  avatar. This migration widens the CHECK to that set and nothing else changes:
--
--    * still ONE plan, still every effect inside it, still nothing sold twice —
--      the Discord backlash was never against cosmetics, it was against cosmetics
--      sold on top of a subscription already paid for;
--    * still a closed list. A cosmetic whose value comes from being recognised is
--      worth nothing if every store can invent its own string, and a free-text
--      field would also be a free-text field in a stylesheet path, which is how a
--      class name becomes an injection.
--
--  The three existing values keep their meaning, so a person wearing `halo` today
--  still wears it tomorrow. The new four are additive.
-- ============================================================================

alter table profiles drop constraint if exists profiles_plus_effect_check;
alter table profiles
  add constraint profiles_plus_effect_check
  check (plus_effect is null or plus_effect in ('solid','edge','halo','gradient','neon','prism'));

comment on column profiles.plus_effect is
  'The effect on this person''s name, from ByteBikri Plus. A closed list, because '
  'the effect name reaches a class name in the stylesheet: solid (none), edge (a '
  'gradient rule), halo (a glow), gradient (the name painted in the palette), neon '
  '(lit ink with a bloom), prism (a travelling band). Every one of them is a look '
  'first and motion second — the stylesheet stops the motion for anybody whose '
  'system asks for less of it, and the look stays.';
