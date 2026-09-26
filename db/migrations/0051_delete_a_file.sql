-- ============================================================================
--  0051 — deleting a file: a status of its own, and the day it happened
-- ============================================================================
--  Until now a seller could PAUSE a file and could not delete one. There was no
--  route, no button, and no word for it — every asset in the database is 'live'.
--  That was a real gap rather than a design: a seller who uploads the wrong cut,
--  or a picture they no longer have the right to show, had no way to take it back,
--  and the only answer the product had was "hide it from the storefront".
--
--  'paused' is not that answer, and this migration does not overload it. Pausing
--  takes a file off sale; the people who already unlocked it keep watching, which
--  is what an unlock BUYS. Deleting is the other promise: the bytes go, and the
--  entitlement goes with them.
--
--  So the vocabulary gains one word and one timestamp:
--
--    * `assets.status` gains 'deleted' — terminal, and not the same word as the
--      moderator's 'removed'. A platform removal is a decision about a file that
--      still exists; a deletion is the seller's own act and the bytes are gone.
--      Keeping them separate is what lets an appeal say "this was taken down by
--      the platform" without having to guess.
--    * `deleted_at` records when, because the tombstone page has to be able to
--      say "deleted on 24 Aug" rather than "deleted".
--
--  WHAT THE DATABASE STILL HOLDS AFTER A DELETE, on purpose:
--
--    * The asset ROW. Its unlocks, its audit trail, and any report or appeal
--      about it keep their foreign keys, so history does not develop holes. The
--      row is a tombstone; the files are what go.
--    * NOT the `asset_files` rows. Those are the bytes' addresses, and a route
--      that can look one up could try to serve it. Deleting the addresses is what
--      makes "cannot be accessed any more" true at the byte level rather than
--      only in the storefront query.
--
--  A host that cannot delete (Telegra.ph) leaves an ORPHAN: bytes we can no longer
--  reach but cannot unlink. There is no column for that here because it is an
--  operator's fact rather than a seller's state, and it is written where the
--  operator reads: the audit log (`asset.deleted`, with the host and the key).
--  Inventing a table for one note no product surface displays would be schema for
--  its own sake; the audit row is queryable, dated and attributable, which is what
--  the note needs.

alter table assets drop constraint if exists assets_status_check;

alter table assets
  add constraint assets_status_check
  check (status in ('draft', 'pending_review', 'live', 'paused', 'removed', 'deleted'));

alter table assets add column if not exists deleted_at timestamptz;

comment on column assets.status is
  'draft | pending_review | live | paused | removed | deleted. '
  '`paused` is the seller''s "off sale" and keeps every existing unlock working — '
  'that is what an unlock buys. `deleted` is terminal: the asset_files rows are '
  'gone, so no byte route can find the bytes, and the tombstone row survives only '
  'to keep unlocks, reports and appeals from losing their subject.';

comment on column assets.deleted_at is
  'When the seller deleted the file. Set with status = ''deleted''; the tombstone '
  'page reads it so the seller sees a date rather than an event with no time.';
