-- One ad is not one unlock any more.
--
-- The ask a file carries can be two or three views (`asset_unlock_policy.ads_required`,
-- derived from the file's declared value and capped by the store's plan), and the
-- page has said so since the ad economy landed: "2 ads of 30 seconds", with the
-- second one asked for only if the first is credited. The grant, however, still
-- happened on the first `complete` postback — the sentence was true in the copy
-- and false in the code.
--
-- What was missing is the link between a delivery and the ATTEMPT it belongs to.
-- `ad_view_events` knew the channel, the user, the asset and the provider, and the
-- unique index on (connection_id, external_id) made a replayed delivery harmless —
-- but nothing said "this row is view 1 of attempt X", so counting was impossible:
-- the first row was the whole story.
--
-- So the attempt is written on the event.
--
--   * `pending_view_id` is nullable with ON DELETE SET NULL, not a NOT NULL
--     foreign key. Two reasons, both about not losing evidence: the sweep that
--     clears stale attempts after six hours must not fail or cascade the rows
--     away, and a provider postback that arrives WITHOUT an attempt id (the
--     echoed-user path in `handlePostback`) is still a billable view that the
--     channel's earnings page has to show. An event that outlives its attempt is
--     still an event.
--   * The index is partial, because the overwhelming majority of rows will have a
--     value and the few that do not are exactly the ones no query asks about.
--
-- Nothing is backfilled: rows written before this migration belong to attempts
-- that were already granted under the old rule, and inventing a count for them
-- would be inventing history.

alter table ad_view_events
  add column if not exists pending_view_id uuid references pending_views(id) on delete set null;

create index if not exists idx_ad_view_pending
  on ad_view_events(pending_view_id) where pending_view_id is not null;

comment on column ad_view_events.pending_view_id is
  'The unlock attempt this delivery counts toward. The grant is decided by '
  'counting completed rows for ONE attempt against pending_views.required_ads, '
  'never by the first delivery that arrives. NULL for events that arrived '
  'without an attempt id, or whose attempt was swept after six hours.';
