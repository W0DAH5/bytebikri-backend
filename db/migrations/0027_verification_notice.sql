-- 0027 — the notice before a check lapses, and the record that it went out.
--
-- §25 shipped a panel that told the seller "We will tell you before it does", and
-- nothing in the platform could tell anybody anything: there is no scheduler here
-- on purpose, and every message this system sends is written by a person doing
-- something. A promise on a screen with no mechanism behind it is the exact defect
-- this project keeps hunting, so the mechanism is the smallest honest one — a list
-- a person works, and a message they send from it.
--
-- Two things have to be true for that to be worth anything:
--
--   * somebody has to be able to find the sellers whose checks are about to lapse
--     without being nagged by a job (the list is derived from `expires_at`, like
--     every other state in this codebase — see `lapseOf` in src/verification.js);
--   * and once the notice is sent, the record has to say so — otherwise the list
--     cannot tell "not yet told" from "told last week", and a seller gets the same
--     message three Mondays running.
--
-- So the notice is recorded ON THE OUTCOME it belongs to. It is not an audit row
-- and not an email log: the question an operator asks is "has this seller been told
-- that THIS check is ending", and that is a property of the check.
--
-- What is deliberately NOT here: a send counter with retries, a schedule, a
-- `notified_at` on the store. The notice is a person's message, sent once, and the
-- next one is sent when the seller asks for the next check — two years later.

alter table seller_verifications
  add column if not exists notice_sent_at timestamptz,
  add column if not exists notice_by      uuid references profiles(id) on delete set null;

-- The console's lapsing list is one query against this, run whenever an operator
-- opens the page: verified rows, not yet past their date, soonest first. A partial
-- index rather than a full one because every row that matters here is verified —
-- pending rows have no expiry at all and refused ones never will.
create index if not exists idx_seller_ver_expiring
  on seller_verifications(expires_at)
  where status = 'verified';

comment on column seller_verifications.notice_sent_at is
  'When a person told this seller the check was about to lapse. Read by the console '
  'so the same seller is not messaged every time somebody works the list.';
comment on column seller_verifications.notice_by is
  'Who sent that notice. Null on every row nobody has been told about yet.';
