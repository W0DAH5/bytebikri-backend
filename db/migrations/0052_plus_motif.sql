-- 0052 — the motif: the identity axis of the premium cosmetic system.
--
-- PREMIUM_COSMETICS.md is the framework; this is its first column. Power decides
-- how STRONG a treatment may be (derived, never stored — cosmetic-model.js), and
-- the motif decides WHAT IT IS: a gold member wearing the Golden Lotus and one
-- wearing the Golden Dragon carry the same treatment and different identities.
--
-- The column follows the engine's own mechanism (PREMIUM_LOOK.md §10): one entry
-- in SLOTS, one column with its check, one renderer branch — and
-- test/cosmetics.test.js refuses the save until the catalog, the database, the
-- picker and the write path all agree on the same list. NULL means never chosen
-- (the picker pre-checks, so a first save works); 'none' is an explicit choice of
-- nothing.
alter table profiles add column if not exists plus_motif text;
alter table profiles drop constraint if exists profiles_plus_motif_check;
alter table profiles
  add constraint profiles_plus_motif_check
  check (plus_motif is null or plus_motif in ('none', 'silver-star', 'golden-sun', 'zen-enso', 'crystal-prism', 'royal-crown', 'aurora-ribbons', 'prism-refraction', 'inferno-flame', 'buddha-gold', 'dragon-gold', 'lotus-gold'));
comment on column profiles.plus_motif is
  'the person''s motif (cosmetic-model.js MOTIFS) — the identity that wears beside the name, '
  'granted by Plus, travels with the person, rendered only by bytebikri';
