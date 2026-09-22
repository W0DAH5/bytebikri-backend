-- ============================================================================
--  0020 — rent that has a due date
-- ============================================================================
--  Rent is the platform's only recurring income, it arrives as a bank transfer,
--  and an operator matches each one by hand. And until this migration the invoice
--  had NO due date: `created_at` recorded when it was issued and nothing recorded
--  when it was owed by.
--
--  Three consequences, all of which showed up as soon as anyone asked the
--  operator's actual question — "who do I chase this week?":
--
--  1. Nothing could be sorted by how late it was. `platformMoney` and the audit
--     code both refer to an 'overdue' status, and the CHECK constraint below has
--     never allowed one: ('issued','submitted','paid','waived','void'). So a
--     filter on `status in ('issued','unpaid','overdue')` matched exactly one
--     real state, silently dropping every invoice the payer had already claimed
--     to have paid. A money figure that under-reports on the operator's front
--     page, and no error anywhere to say so.
--
--  2. `due_at` is a COLUMN rather than a constant multiplied at read time,
--     because payment terms can change and must not change history. If the
--     platform decides in a year that rent is due in 45 days, an invoice issued
--     today is still due in 30, and a stored date is the only way that stays
--     true. Deriving it from a config value would silently re-age every existing
--     invoice the day somebody edited the config.
--
--  3. The backfill has to make a decision, and the honest one is stated rather
--     than hidden: invoices issued before this migration get 30 days from the day
--     they were issued. That is not what they were told at the time — nobody was
--     told anything, which is the problem — so the operator page says in words
--     that the terms were set now and that older invoices are measured from their
--     issue date. An invoice cannot be retroactively made late by a policy that
--     did not exist when it was sent.
-- ============================================================================

alter table rent_invoices
  add column if not exists due_at date;

comment on column rent_invoices.due_at is
  'The date this invoice is owed by. Stored, not derived: terms may change and '
  'must not change the age of an invoice already sent.';

-- Backfill from the issue date, which is the only date such an invoice ever had.
update rent_invoices
   set due_at = (created_at at time zone 'UTC')::date + 30
 where due_at is null;

-- Invoices that are already paid get their own date, so the aging view is about
-- money still owed rather than money that arrived late.
update rent_invoices
   set due_at = least(due_at, (coalesce(paid_at, created_at) at time zone 'UTC')::date)
 where status = 'paid' and due_at is not null;

-- A due date is only meaningful for money that is still owed. `waived` and
-- `void` invoices keep the column (history) but are excluded from every aging
-- query by status, never by a null check.
comment on table rent_invoices is
  'Annual rent, aligned to the store''s own anniversary. Statuses in use: '
  'issued, submitted, paid, waived, void. "Overdue" is DERIVED from due_at — '
  'there is no such status, and a query that filters on one matches nothing.';

create index if not exists idx_rent_invoices_open
  on rent_invoices (due_at)
  where status in ('issued', 'submitted');

-- The collection view reads billed-vs-collected by month, which means grouping on
-- the period, not on the row's created_at: an invoice for March is March's rent
-- even if it was issued in February.
create index if not exists idx_rent_invoices_period on rent_invoices (period_end desc);
