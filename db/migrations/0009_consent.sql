-- ============================================================================
--  0009 — consent
-- ============================================================================
--  Personalised advertising in the EEA requires consent that is freely given,
--  specific, informed and — the part that gets ignored — provable. Provable
--  means a record of what this person was shown, when they decided, and which
--  version of the notice that decision was about.
--
--  Three consequences shape the schema:
--
--  1. The record is keyed by POLICY VERSION. When the notice changes materially
--     the old decision no longer covers it, so a new row is required and the
--     banner comes back. Without the version column there is no way to tell a
--     current consent from a stale one, and everyone silently keeps the old one.
--
--  2. A refusal is a record too. "Rejected" is a decision, and the only way to
--     prove we honoured it is to have stored it.
--
--  3. The visitor is identified by a random cookie, not by an account. The
--     banner has to work before anyone signs in — and most visitors never will.
-- ============================================================================

create table if not exists consent_records (
  id               uuid primary key default gen_random_uuid(),

  -- Random, first-party, set when the banner is answered. Not a fingerprint:
  -- it is a value WE generated, and it is meaningless on any other site.
  visitor_id       text not null,

  policy_version   text not null,

  -- {"ads": true, "analytics": false, "necessary": true}
  -- jsonb rather than three boolean columns because the set of purposes will
  -- change (a new network, a new measurement tool) and that should be data.
  choices          jsonb not null,

  -- Derived, not supplied. A column per purpose has to be kept in step with the
  -- purpose list by hand, and the failure is invisible: add a purpose, forget the
  -- column, and every insert dies on a not-null violation — which is exactly what
  -- happened the first time round. Generating the value from the blob means the
  -- purpose list is the only place a purpose is declared, and it can still be
  -- indexed and counted.
  ads_granted boolean generated always as
    (coalesce((choices ->> 'ads')::boolean, false)) stored,

  decided_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  -- Hashed, and hashed with the app secret: we need to demonstrate the record
  -- is authentic, not to keep a log of who was where. A raw IP next to a
  -- browsing record is exactly the liability consent is supposed to avoid.
  ip_hash          text,
  user_agent_hash  text,

  -- Country at the time of the decision. Consent law is territorial, and
  -- "which rules applied to this person" must be answerable after the fact.
  country          text,

  -- One live decision per visitor per version. A change of mind updates it;
  -- a new version inserts alongside.
  unique (visitor_id, policy_version)
);

comment on column consent_records.ads_granted is
  'Generated from choices->>''ads''. Do not insert into it: Postgres refuses, '
  'which is the point — it cannot drift from the blob it is derived from.';

comment on table consent_records is
  'One row per visitor per notice version. Append-by-version: a new notice '
  'requires a new decision, and the old row is kept as evidence of what was '
  'agreed at the time.';

create index if not exists idx_consent_visitor on consent_records (visitor_id, decided_at desc);

-- Ad view events already record the unlock that paid for them. This records
-- which consent was in force, so a paid-for view can be traced back to a
-- granted permission rather than an assumption.
alter table ad_view_events add column if not exists consent_id uuid references consent_records(id);

comment on column ad_view_events.consent_id is
  'The consent that permitted this view, when the view was a personalised ad. '
  'Null for contextual or unattributed views — an absence that is meaningful.';
