-- 0032 — the storefront theme the plans have been promising since 0001.
--
-- `plans.capabilities.can_theme` has been false on Free and true on Store and Pro
-- since the first migration, and nothing in the product has ever read it. The
-- billing page did not even list it among the benefits. So there was a capability
-- with a price attached to it and no feature behind it, which is the exact shape
-- of a claim rather than a product — and it is the one kind of gap this codebase
-- cannot leave open, because the seller paid for the sentence.
--
-- The column is nullable and NULL is meaningful: no theme chosen is the storefront
-- every store has always had. That is not a degraded state and the settings page
-- says so — a Free store is not missing a feature it was never sold.
--
-- `theme_set_at` is a second column rather than a trigger because it answers a
-- different question from `updated_at`: a store can be edited a hundred times
-- after picking a theme, and "when did this look start" is what a seller asks
-- after a rebrand. Nothing reads it yet except the settings page, which is
-- exactly why it is written at the moment the choice is made and not derived.
--
-- What is deliberately absent: no free-form hex, no font per store, no CSS the
-- seller can paste. Every palette lives in `app/src/themes.js` where its contrast
-- is arithmetic and a test refuses one that fails. A colour picker here would be
-- a promise about readability that no test could keep.

alter table channels add column if not exists theme text;
alter table channels add column if not exists theme_set_at timestamptz;

comment on column channels.theme is
  'The key of a curated storefront theme from src/themes.js, or NULL for the '
  'default look. Not free-form: each palette is contrast-checked for both the day '
  'and night themes before it can be offered.';
comment on column channels.theme_set_at is
  'When the current look was chosen. Distinct from updated_at, which moves on any '
  'edit to the store.';
