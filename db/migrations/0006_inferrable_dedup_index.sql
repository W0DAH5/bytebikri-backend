-- ============================================================================
--  0006 — make the dedup index inferrable
-- ============================================================================
--  0002 created:
--
--    create unique index uq_ad_view_connection_external
--      on ad_view_events(connection_id, external_id)
--      where external_id is not null and connection_id is not null;
--
--  A PARTIAL unique index cannot be inferred by a bare ON CONFLICT clause. The
--  statement must repeat the predicate, and `on conflict (connection_id,
--  external_id) do nothing` therefore failed with 42P10 — the same error class as
--  0003, from a different cause. The claim is the single most important
--  statement in the postback path and it did not run at all.
--
--  Dropping the WHERE loses nothing. In Postgres, NULLs are distinct in a unique
--  index, so rows with a null external_id never collide with each other or with
--  anything else. The partial predicate was doing work the engine already does.
--
--  This is the third 42P10-style failure in this porting exercise. They are the
--  clearest argument for the thing that was missing all along: the schema had
--  never been executed. Every one of them was one query away from being found.
-- ============================================================================

drop index if exists uq_ad_view_connection_external;

create unique index if not exists uq_ad_view_connection_external
  on ad_view_events(connection_id, external_id);

comment on index uq_ad_view_connection_external is
  'One row per completed view, scoped to the CONNECTION: two channels can both '
  'use BitLabs with different secrets and must not collide on a transaction id. '
  'Not partial — NULL external ids stay distinct in Postgres, so the predicate '
  '0002 added only made the index un-inferrable by ON CONFLICT.';
