-- 0026 — the seller asked, a person looked, the outcome is written down.
--
-- `seller_verifications` was created in 0001 with its intent already stated:
-- "Stores the OUTCOME of KYC, never the evidence. Holding citizenship scans is a
-- breach liability with no operational benefit — verify, then discard the source."
-- The table was written and then nothing read or wrote it for the whole life of the
-- project, while the Pro plan's benefit list advertised the badge it was built for
-- and the operator's People page said the platform had no KYC step at all. This
-- migration closes the gap between the three.
--
-- What it adds is the smallest set of facts the flow needs:
--
--   request_note   what the seller wrote when asking. Logistics: "I am in Pokhara
--                  until Friday", "call after six". Never a document number — the
--                  form says so, and the column comment says so, because the one
--                  thing this table exists to avoid is the evidence.
--   decided_by     the person who recorded the outcome, whatever the outcome was.
--   decided_at     when they recorded it.
--
-- `verified_by` is renamed rather than kept alongside `decided_by`: a refusal and a
-- clearance are both decisions by a person, and two columns that disagree about who
-- did it is how a table starts lying. Nothing referenced the old name — the table
-- had no readers — which is the only reason a rename is safe here.

alter table seller_verifications
  rename column verified_by to decided_by;
alter table seller_verifications
  add column if not exists decided_at   timestamptz,
  add column if not exists request_note text;

-- One open request per store. Two clicks on a slow connection are one request, and
-- the seller should not be able to queue themselves twice. Partial, so the decided
-- rows keep their history — a store can be checked, checked again after two years,
-- and the earlier outcome stays on the record.
create unique index if not exists idx_seller_ver_one_pending
  on seller_verifications(channel_id) where status = 'pending';

comment on column seller_verifications.request_note is
  'What the seller wrote when asking for a check: logistics only. Never a document '
  'number, and never anything the operator would need to act on.';
comment on column seller_verifications.decided_by is
  'The person who recorded the outcome, verified or refused. Set with decided_at.';
comment on column seller_verifications.verified_at is
  'When the document itself was seen. Equal to decided_at for a check done in '
  'person; earlier when an outcome is recorded later.';
comment on column seller_verifications.expires_at is
  'When the proof stops counting. Read by the app rather than enforced by a job: a '
  'row past this date reads as expired without anything needing to run at midnight.';
comment on column seller_verifications.status is
  'pending, verified, rejected, expired. The app DERIVES expiry from expires_at, so '
  'a verified row becomes expired on its own and no job has to sweep it.';
