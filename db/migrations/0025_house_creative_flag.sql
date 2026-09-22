-- The platform's own message is not inventory, and the schema should say so.
--
-- `slot_creatives` holds two very different things under `owner = 'platform'`:
-- bytebikri's own house message (what we show when nothing has been sold), and —
-- soon — a creative a real advertiser bought. Nothing in the row distinguished
-- them, and the render did not need to until the reserved height became a
-- question.
--
-- The reservation exists for one reason: a network's tag mounts in the slot
-- container after the page has loaded, and reserving the height is what stops a
-- late tag from shoving the page down (the layout shift every ad-funded site has
-- been blamed for). Our own house message is not a tag on its way. It rendered at
-- the slot's full reserved height anyway — 280px of our own copy on a storefront
-- holding one file, which is both an odd thing to show a visitor and what a
-- broken banner looks like.
--
-- So the row now states what it is. The boot upsert sets it for the house row, and
-- anything sold later is `false` by default, which means the honest case (a tag is
-- coming, reserve the space) is the one you get by forgetting.
alter table slot_creatives
  add column if not exists is_house boolean not null default false;

comment on column slot_creatives.is_house is
  'bytebikri''s own placeholder message, not sold inventory. A house row does not '
  'reserve the slot''s height, because nothing is arriving to fill it.';

-- The row that already exists is the house one: it is written by the boot upsert
-- and it is the only platform row the seed creates.
update slot_creatives set is_house = true
 where owner = 'platform' and channel_id is null;
