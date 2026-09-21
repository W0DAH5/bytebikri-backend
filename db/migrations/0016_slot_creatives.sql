-- ============================================================================
-- 0016 — what actually draws in a slot
--
-- Until now the slots were real, allocated, priced and rented — and empty. The
-- platform slot is what the creator PAYS RENT FOR, so a page that renders it as
-- an empty box labelled "Advertisement" is charging for nothing, and a
-- storefront whose own slot is blank is a layout with a hole in it.
--
-- Two kinds of creative, and the difference is the whole revenue model again:
--
--   owner = 'platform'  bytebikri's own inventory. Fills the rent slot. Our ad,
--                       our revenue path, and the reason the slot exists.
--   owner = 'channel'   the CREATOR's own message in their own slot: their
--                       announcement, their next product, their mailing list.
--                       Their inventory, their value, nothing to do with us.
--
-- A network creative is deliberately NOT a row here. A real network serves its
-- own tag inside the slot container; storing its HTML in our database would
-- mean storing third-party script and rendering it from our origin, which is a
-- security decision nobody has agreed to make. The container and the seam live
-- in `src/render.js`; the tag, when there is an account, belongs to the adapter.
-- ============================================================================

create table if not exists slot_creatives (
  id            uuid primary key default gen_random_uuid(),

  owner         text not null check (owner in ('platform','channel')),
  -- Null for platform creatives. A channel creative always belongs to one.
  channel_id    uuid references channels(id) on delete cascade,

  -- '*' means "any slot this owner can serve": the platform keeps one house
  -- creative for its slots, and most creators write one notice, not five.
  --
  -- Deliberately NOT a foreign key to slot_definitions. The wildcard is worth
  -- more than the constraint — and the composer already ignores a key no slot
  -- matches, so an unknown value is inert rather than a broken page.
  slot_key      text not null default '*',

  headline      text not null,
  body          text,
  -- A same-origin path we stored, or an https URL. Never a javascript: or data:
  -- URI — the render layer enforces that as well, because a link the creator
  -- controls is a link an attacker can eventually reach.
  image_url     text,
  link_url      text,
  link_label    text,

  active        boolean not null default true,
  -- Ordering for more than one creative per owner; the lowest rank that is
  -- active and fits the slot wins.
  rank          integer not null default 100,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  -- A platform creative cannot belong to a channel, and a channel creative must.
  constraint slot_creatives_owner_shape check (
    (owner = 'platform' and channel_id is null)
    or (owner = 'channel' and channel_id is not null)
  )
);
-- One creative per owner per slot. The upsert in `store.setCreative` names this
-- index as its conflict target, so it is a unique index and not merely a lookup
-- one: without it, "save" would quietly append a second row and the store would
-- alternate between two headlines on every page load.
create unique index if not exists uq_creatives_channel
  on slot_creatives(channel_id, slot_key) where owner = 'channel';
create unique index if not exists uq_creatives_platform
  on slot_creatives(slot_key) where owner = 'platform';

comment on table slot_creatives is
  'Who fills a slot, and with what. Platform creatives are bytebikri''s own '
  'inventory in the rent slot; channel creatives are the creator''s own message '
  'in their own slot. A real network''s tag is never stored here — it is served '
  'by its adapter inside the slot container.';

comment on column slot_creatives.image_url is
  'Same-origin path or https URL only. The render layer refuses javascript: and '
  'data: URLs, because this column is written by whoever owns the store.';
