-- ============================================================================
--  0004 — content has no price
-- ============================================================================
--  assets.price_npr integer not null default 0
--
--  Left over from the purchase model that was torn out in 5ac01b4. Nothing reads
--  it. It survived because a column is invisible until something queries it.
--
--  Why it goes rather than staying as "reserved for paid mode":
--
--  A price column with no payment path behind it is an invitation. The obvious
--  next line anybody writes is `if (asset.price_npr > 0)`, and at that moment the
--  platform is in the buyer->seller money path again — the exact model that had
--  to be rebuilt once already, and that would make us a merchant holding funds
--  for someone else's sale.
--
--  `unlock_mode` keeps 'paid' in its CHECK. That is a reserved VALUE, documenting
--  where the later feature attaches without implying anything exists behind it.
--  A reserved value costs nothing. A reserved column looks usable.
--
--  When paid unlocks actually ship, they arrive with a migration that adds what
--  they genuinely need — price, currency, and a payment intent with a state
--  machine — designed against the requirement instead of inherited from a
--  mistake. The schema should describe what IS, not what might be.
-- ============================================================================

alter table assets drop column if exists price_npr;

comment on column assets.unlock_mode is
  'How a buyer gets in. ad_gated = watch rewarded ads. open = free. paid is '
  'RESERVED and unimplemented: it has no price column and no payment path, '
  'deliberately, because a reserved column invites code we would have to delete.';
