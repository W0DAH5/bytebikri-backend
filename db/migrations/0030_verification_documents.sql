-- 0030 — the document can be handed over here, and it is destroyed the moment the
--       person looking at it is finished.
--
-- `seller_verifications` was built to hold the OUTCOME of a check and nothing else,
-- and 0001 said so in the strongest way a schema can:
--
--     docs_retained boolean not null default false check (docs_retained = false)
--
-- A column that could only ever be false. It was not a typo: it was the intent
-- written as a constraint, and the honest reading of it today is that the platform
-- had no way to ACCEPT a document at all (the audit's "KYC verification flow:
-- schema exists, no upload, no review"), so the constraint cost nothing and
-- guaranteed everything.
--
-- This migration gives the flow the upload it was missing, and keeps the promise by
-- changing what the constraint means rather than dropping it:
--
--   * the document lives on the PENDING request row, so its life is exactly the
--     request's life — a decision deletes that row, and the file goes with it;
--   * `docs_retained` becomes DERIVED (`document_key is not null`), so the one
--     column that answers "are we holding somebody's identity document right now"
--     cannot disagree with the column that holds it. That is the same rule this
--     codebase applies to every other pairs-of-columns problem: one truth, computed;
--   * `document_destroyed_at` records when the copy stopped existing, because that
--     is the fact the seller is shown and the fact an operator is asked about
--     afterwards — and it is not evidence, it is a timestamp about OUR handling.
--
-- Deliberately absent: no document number, no extracted name, no date of birth, no
-- hash of the file, no thumbnail, no "verification history" of what was seen. Every
-- one of those is a thing Fiverr keeps for 30 days and Stripe keeps for three years;
-- none of them is needed to answer "did a person look at this seller's document, and
-- when" — which is the only question the badge makes a claim about.
--
-- On what is held meanwhile: see `app/src/kyc.js`. The bytes are re-typed from their
-- magic number (a PDF or an SVG is refused by name), the camera's EXIF — location,
-- device, timestamp — is stripped before the file is written, and the hold expires
-- after seven days whether or not anybody looked.

alter table seller_verifications
  add column if not exists document_key        text,
  add column if not exists document_mime       text,
  add column if not exists document_bytes      int,
  add column if not exists document_added_at   timestamptz,
  add column if not exists document_destroyed_at timestamptz;

-- `docs_retained` was a constant. It becomes a fact about the row: true exactly
-- while a copy is on disk. Nothing read the old column (it could only be false), so
-- nothing can break by the change — and the constraint that said "never retain" is
-- replaced by one that says "say so when you do".
alter table seller_verifications drop constraint if exists seller_verifications_docs_retained_check;
alter table seller_verifications drop column if exists docs_retained;
alter table seller_verifications
  add column docs_retained boolean generated always as (document_key is not null) stored;

-- One document per row, and never on a decided row: a check that has an outcome has
-- no reason to be holding a document, so the shape of the data refuses it rather
-- than a rule trusting every future caller to remember.
alter table seller_verifications drop constraint if exists seller_verifications_doc_only_pending;
alter table seller_verifications add constraint seller_verifications_doc_only_pending
  check (document_key is null or status = 'pending');
alter table seller_verifications drop constraint if exists seller_verifications_doc_shape;
alter table seller_verifications add constraint seller_verifications_doc_shape
  check (document_key is null or (
    document_key ~ '^kyc/[0-9a-f-]{36}\.[a-z0-9]{1,5}$'
    and document_mime in ('image/jpeg', 'image/png', 'image/webp')
    and document_bytes between 1 and 8388608
    and document_added_at is not null
  ));

-- The sweep asks one question, and it is asked whenever the two pages that can show
-- a document are opened: which held copies are past their week. Partial, because a
-- row with no document is never the answer to it.
create index if not exists idx_seller_ver_documents
  on seller_verifications(document_added_at)
  where document_key is not null;

comment on column seller_verifications.document_key is
  'Storage key of the copy being held for a check, or null. Destroyed when an outcome '
  'is recorded, when the seller withdraws, and by the sweep after seven days — the '
  'three ways out are the only three, and all of them delete the bytes.';
comment on column seller_verifications.document_destroyed_at is
  'When the copy stopped existing. Kept after the file is gone because it is the fact '
  'the seller is shown and the one an operator is asked about later — a timestamp '
  'about our handling, never about the person.';
comment on column seller_verifications.docs_retained is
  'DERIVED: a copy is on disk right now. The 0001 column that could only be false is '
  'now the answer to "are we holding somebody''s identity document", and it cannot '
  'disagree with document_key because it is computed from it.';
