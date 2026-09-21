-- ============================================================================
--  0008 — cover images
-- ============================================================================
--  A storefront without product imagery is a wireframe. The product-design
--  research is unambiguous that the cover is the first thing a buyer sees and
--  the single highest-leverage visual on a listing: it appears in the grid, in
--  every share preview, and in the detail page hero.
--
--  Stored as a URL rather than bytes. Covers are PUBLIC — they are the shop
--  window — so they must be servable without a signed token. Asset FILES are
--  private and go through the storage adapter behind an expiring per-user link.
--  Two different visibility models, so two different mechanisms, deliberately.
-- ============================================================================

alter table assets add column if not exists cover_url text;
alter table channels add column if not exists banner_url text;
alter table channels add column if not exists logo_url text;

comment on column assets.cover_url is
  'Public cover image URL. The shop window — no token required. Contrast with '
  'asset_files.storage_key, which is private and never leaves the server.';

comment on column channels.banner_url is
  'Public storefront header image. Same public/private split as assets.cover_url.';

comment on column channels.logo_url is
  'Public store logo. Optional — the UI falls back to the store initial.';
