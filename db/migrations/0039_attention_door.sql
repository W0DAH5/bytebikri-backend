-- ============================================================================
--  0039 — the attention door: a tier you can join by watching
-- ============================================================================
--  The brief's own question, finally answered in the schema. A store's
--  relationship with its members is between the two of them, and money movement
--  inside the app does not exist — so a membership that can only be bought is a
--  membership most people in this market will never have. This migration adds the
--  second door onto the SAME tier, and it is paid in attention.
--
--  Four decisions are encoded here. Each one is a promise about somebody's time,
--  so each one is written down where it cannot be quietly changed.
--
--  1. DUES STAY THE MAIN DOOR. `join_mode` defaults to 'dues', `attention` is
--     opt-in per tier, and nothing about the dues door changes: the claim, the
--     creator's own confirmation, and the sentence that bytebikri never receives
--     a rupee of it all stay exactly as 0031 built them. The attention door is a
--     second way in, never a replacement, and it is never called a payment.
--
--  2. THE PRICE IS THE PLATFORM'S, NOT THE SELLER'S. There is no
--     `attention_views` column, and that absence is the decision. A seller who
--     priced this would be pricing a stranger's evening with no information —
--     the exact mistake `0034` fixed for the ask ladder, where the seller's two
--     number boxes became one choice between two derived asks. The term decides
--     it (`attentionViews` in `memberships.js`: four views for a month, eight for
--     a quarter, twelve for a year) and the ceiling is a promise to the person:
--     no one watches a month of ads for a month of belonging.
--
--  3. STANDING IS THE PLATFORM'S OWN COUNT, PER STORE. `member_standing` is
--     per (person, store), and it is the count of that person's VERIFIED views on
--     that store's files — the same events the ledger will read (slice 5), not a
--     number a page reports about itself. `earned` is written by the postback
--     path and by nothing else; `spent` is written by a join and by nothing else;
--     `spent <= earned` is a constraint rather than a hope, so a balance can
--     never be negative however the code changes later. Views count on the store's
--     files however they were asked for — at the door or inside a file — because
--     both are the same act by the same person for the same shop.
--
--  4. THE AD ARRANGEMENT IS SNAPSHOTTED WHEN SOMEBODY JOINS. `ad_free` is the
--     default and stays the default: a member file opens without an ad, which is
--     the shipped promise. `supporter` is the opposite trade a store may opt into
--     — members keep the ordinary asks and gain the belonging — and a member who
--     joined under one arrangement keeps it until their period ends, because a
--     promise is made at a moment and `memberships.ad_mode` records that moment.
--     A seller changing the tier changes what the NEXT join gets, and the seller's
--     own page says so with the number of people it leaves alone.
-- ============================================================================

-- ── what a tier offers, and how people get in ───────────────────────────────
alter table membership_tiers
  add column if not exists join_mode text not null default 'dues';
alter table membership_tiers drop constraint if exists membership_tiers_join_mode_check;
alter table membership_tiers
  add constraint membership_tiers_join_mode_check
  check (join_mode in ('dues','attention','both'));

comment on column membership_tiers.join_mode is
  'Which doors onto this tier exist. dues = the original (a claim the creator '
  'confirms); attention = join by watching verified views on this store''s own '
  'files; both = either. There is no separate price column for the attention door: '
  'the term decides it, so nobody types a number that describes a stranger''s time.';

alter table membership_tiers
  add column if not exists ad_mode text not null default 'ad_free';
alter table membership_tiers drop constraint if exists membership_tiers_ad_mode_check;
alter table membership_tiers
  add constraint membership_tiers_ad_mode_check
  check (ad_mode in ('ad_free','supporter'));

comment on column membership_tiers.ad_mode is
  'What membership of this tier does to the store''s members-only files. ad_free '
  '(default): they open with no ad, which is the shipped promise. supporter: the '
  'files keep the ordinary asks and the member gets the belonging instead — the '
  'opposite trade, opt-in, printed on the join panel before anybody joins, and '
  'snapshotted onto each membership so a change never takes away what somebody '
  'already joined for.';

-- ── how each member got in ──────────────────────────────────────────────────
-- 'dues' is every row that exists today, so the default is the backfill.
alter table memberships
  add column if not exists join_method text not null default 'dues';
alter table memberships drop constraint if exists memberships_join_method_check;
alter table memberships
  add constraint memberships_join_method_check
  check (join_method in ('dues','attention'));

comment on column memberships.join_method is
  'Which door this person came through. An attention join has no claim fields set '
  '(no amount, no method, no reference) and never enters the creator''s queue — '
  'there is no money for anybody to check, because no money was involved.';

-- The arrangement this member joined under. Snapshotted from the tier, like
-- `pending_views.required_ads` and `pending_views.break_at_sec` are: the promise
-- is the one that was on the page at the moment they joined.
alter table memberships
  add column if not exists ad_mode text not null default 'ad_free';
alter table memberships drop constraint if exists memberships_ad_mode_check;
alter table memberships
  add constraint memberships_ad_mode_check
  check (ad_mode in ('ad_free','supporter'));

comment on column memberships.ad_mode is
  'The ad arrangement this membership was granted under. Read instead of the '
  'tier''s current setting when deciding whether a members-only file opens, so a '
  'seller changing their tier cannot take back what an existing member joined for.';

-- The receipt for an attention join: how many verified views it cost. Zero for
-- every dues membership, which is also what an existing row should say.
alter table memberships
  add column if not exists standing_used integer not null default 0;
alter table memberships drop constraint if exists memberships_standing_used_range;
alter table memberships
  add constraint memberships_standing_used_range
  check (standing_used >= 0);

comment on column memberships.standing_used is
  'Views spent to join, for a membership that came through the attention door. '
  'The attention door''s equivalent of `txn_reference`: what the join actually '
  'cost, recorded so "how did this person get in" has an answer that is not a '
  'recollection.';

-- ── the balance itself ─────────────────────────────────────────────────────
-- One row per (person, store), created on the first verified view. Deliberately
-- NOT a column on `memberships`: leaving deletes that row ("a delete, because that
-- is what a person means by it"), and a balance that vanished with it would make
-- leaving-and-rejoining a way to skip the price.
create table if not exists member_standing (
  profile_id uuid not null references profiles(id) on delete cascade,
  channel_id uuid not null references channels(id) on delete cascade,

  -- Verified views on this store's files, counted by the postback path.
  earned integer not null default 0 check (earned >= 0),
  -- Views spent joining by watching. Only ever grows by a join that the join
  -- itself checked against `earned` inside one transaction with a row lock.
  spent  integer not null default 0 check (spent >= 0),

  updated_at timestamptz not null default now(),

  primary key (profile_id, channel_id),
  -- The balance cannot be negative, in any code path, ever. This is the
  -- constraint the whole door rests on: a broken join takes nothing, and a
  -- balance that has been spent is spent.
  constraint member_standing_not_overspent check (spent <= earned)
);

create index if not exists idx_member_standing_channel
  on member_standing(channel_id, earned desc);

comment on table member_standing is
  'Views earned on a store''s files minus views spent joining it. Evidence, not a '
  'currency: it buys nothing anywhere else, it cannot be transferred, and there is '
  'no way to convert it to money in either direction. `earned` is written only by '
  'a verified postback and `spent` only by a join, which is what makes the ledger '
  'of slice 5 able to check it against `ad_view_events` rather than trust it.';
