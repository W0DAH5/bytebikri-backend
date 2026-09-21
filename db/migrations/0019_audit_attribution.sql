-- ============================================================================
--  0019 — attributing the audit log
-- ============================================================================
--  `audit_logs` answers "who did what, and when". Six call sites — the two
--  highest-volume ones among them — wrote the person's id into the `meta` blob
--  instead of the `actor_id` column:
--
--    auth.login              meta = {userId}
--    auth.signup             meta = {userId}
--    content.denied          meta = {reason, assetId, userId}
--    content.free_grant      meta = {assetId, userId}
--    unlock.granted          meta = {assetId, fileId, userId}
--
--  Nothing joins on a key inside a JSON blob, so every one of those rows has a
--  null actor: sign-ins — the largest family in the table — could not say who
--  signed in. The console could not filter by actor either, because there was no
--  actor column with anything in it for the rows people ask about.
--
--  The code passes `actorId` now. This backfills the rows already written, so the
--  history becomes as readable as the new rows. It is strictly additive: only
--  null actors are filled, from the id the same row already carries, and a row
--  whose user has since been deleted keeps its null (the profile join is the only
--  thing that could resolve it, and a dangling id is not an actor).
--
--  No data is changed or removed — a column that should have been populated is
--  populated. An audit trail that gets edited to look better is a different, worse
--  thing than one that gets completed.
-- ============================================================================

update audit_logs l
   set actor_id = p.id,
       -- The subject is only set where the row's own actor IS the subject: a
       -- sign-up is about the account that was created. For content events the
       -- subject is the asset, which the row already carries separately.
       subject_type = case when l.action in ('auth.login', 'auth.signup') then 'profile' else l.subject_type end,
       subject_id   = case when l.action in ('auth.login', 'auth.signup') then p.id else l.subject_id end
  from profiles p
 where l.actor_id is null
   and l.meta ->> 'userId' is not null
   and p.id = (l.meta ->> 'userId')::uuid;

comment on column audit_logs.actor_id is
  'The person who did it. NULL means the platform did it — a postback, a '
  'watermark job, a scheduled sweep — which is a statement, not a gap.';

-- The console filters by actor, and the index it needs is on the pair it sorts
-- with: actor then time.
create index if not exists idx_audit_actor on audit_logs(actor_id, created_at desc);
