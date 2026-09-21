-- ============================================================================
--  0010 — an unlock can be granted by a free file
-- ============================================================================
--  `unlocks.method` allowed only paid and ad-watching routes. A file published
--  with `unlock_mode = 'open'` was therefore unrecordable — so no entitlement row
--  existed, the download route checked for one, found nothing, and refused every
--  free download with "unlock no longer valid".
--
--  The free half of the product was broken while the ad-gated half worked
--  perfectly, which is exactly the shape of bug that survives a demo: the thing
--  you show people is the thing with the ad in it.
--
--  'open' is a distinct value rather than reusing 'manual', because the two mean
--  different things in a payout dispute: 'manual' is a human decision, 'open' is
--  the file being free to anyone. Collapsing them would make the ledger lie about
--  why access exists, and the ledger is what a creator is asked to trust.
-- ============================================================================

alter table unlocks drop constraint if exists unlocks_method_check;

alter table unlocks add constraint unlocks_method_check
  check (method in ('rewarded_ad', 'offerwall', 'survey', 'manual', 'paid', 'open'));

comment on column unlocks.method is
  'How access was granted. rewarded_ad/offerwall/survey are network-paid; paid is '
  'reserved for the later direct-payment mode; manual is an operator decision; '
  'open means the file was free and this row records that the person took it.';
