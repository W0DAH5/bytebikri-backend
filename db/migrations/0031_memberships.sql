-- 0031 — members: people who pay the creator, not the platform.
--
-- The audit has carried "no way to belong to a store" for a long time. A
-- storefront could be watched (follows, 0029) and its files could be opened by
-- watching an ad, but there was no way for the person who actually cares about
-- the work to say so, and no way for the creator to reward them for it.
--
-- THREE DECISIONS ARE ENCODED HERE, and each one is the opposite of the obvious
-- choice:
--
--   1. Members ARE a paid capability — but the payment is for the STORE, not for
--      membership. `plans.capabilities.memberships` is false on Free and true on
--      Store and Pro, so a store buys the ability to have members with the plan
--      it already renews. There is no third charge on this platform and this
--      migration does not add one. Free stores keep follows — the free way to be
--      watched stays free, forever; what the paid plan adds is the relationship
--      with a name attached and files that only members open.
--
--   2. Dues NEVER touch bytebikri. This is the structural version of "no money
--      goes to a user through us": the schema stores a CLAIM (a reference and an
--      amount the member says they sent) and the only person who can turn that
--      claim into a membership is the CHANNEL OWNER (`confirmed_by`), because
--      the owner is the only party who can see the transfer arrive. An operator
--      cannot confirm a membership — not by policy, but because `confirmMember`
--      is scoped to the channel's owner: they never saw the money, so they
--      cannot be the one who says it arrived. The consequence is that the
--      platform takes no cut, holds nothing, and cannot refund anything, and the
--      copy on the page says exactly that.
--
--   3. A membership's life is DERIVED from its period end, like every other
--      clock in this codebase (a check's lapse, a rent invoice's lateness). There
--      is no `lapsed` status to set, no sweep job to trust, and nothing to get
--      out of sync: `period_end < now()` IS the lapse. What that means for the
--      member is concrete and small — the nameplate stops shining and files
--      behind the tier close again — never deletion, never a broken page.
--
-- What is deliberately absent: no recurring billing, no auto-charge, no invoice
-- table (dues are a claim plus a confirmation, and the reference is the receipt),
-- no member count anywhere public, no ranking effect (a nameplate is decoration —
-- `ranking.js` never reads it), no per-file price (a file is not for sale; it is
-- open to members, which is a different sentence), and no `lapsed` row state that
-- a background job would have to remember to write.

-- ── the capability ─────────────────────────────────────────────────────────
-- Data, not code: the plan table already carries a capabilities blob and this is
-- one more key in it. The in-repo PLANS constant keeps the same default so the
-- values agree when the DB is unreachable.
update plans set capabilities = capabilities || jsonb_build_object('memberships', false)
 where code = 'free';
update plans set capabilities = capabilities || jsonb_build_object('memberships', true)
 where code in ('store', 'pro');

-- ── what a store offers ────────────────────────────────────────────────────
-- At most two tiers, and the ceiling is deliberate: the researched pattern
-- (three tiers at roughly 3x/10x) is a pricing exercise for creators with
-- hundreds of patrons, and the failure mode it warns about is more tiers than
-- perks. Two is a name tier and an elite tier, which is what a creator with
-- fifty members can actually keep promises about.
--
-- The plate style is NOT a column. The rule is "the top tier is the shiny one",
-- which is Discord's own published advice for gradient and holographic role
-- styles (keep the effect to one or two roles or nothing stands out) — a rule,
-- not a preference, so it lives in a function and cannot disagree with itself.
create table if not exists membership_tiers (
  channel_id    uuid not null references channels(id) on delete cascade,
  tier_no       smallint not null check (tier_no between 1 and 2),

  name          text not null,
  -- What the creator asks for, in NPR, for the period below. The creator sets
  -- this and collects it directly; bytebikri is not in the path and takes none.
  dues_npr      integer not null check (dues_npr between 0 and 100000),
  period_months smallint not null default 1 check (period_months in (1, 3, 12)),

  -- One line, in the creator's words. Skimmable by design: the researched advice
  -- on tier pages is short bullets and cadence, because a perk list nobody reads
  -- converts nobody.
  perks         text,

  -- A named palette from `memberships.js`, not free-form hex. Every palette is
  -- contrast-checked against both themes, and a creator picking #ff00ff is how a
  -- readable page becomes an unreadable one.
  accent        text not null default 'indigo',

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  primary key (channel_id, tier_no)
);

comment on table membership_tiers is
  'Up to two tiers per store (tier_no 1..2). The tier defines what a member pays '
  'the CREATOR directly and which files it opens; the plate style is derived from '
  'tier_no, not stored.';

-- Where the dues go, in the creator's own words (a wallet id, a bank line, "cash
-- at the shop"). Public on purpose: the whole point is that the member pays the
-- creator directly, so the instruction has to be on the page.
alter table channels add column if not exists membership_note text;

comment on column channels.membership_note is
  'How to pay dues directly to the creator. Displayed publicly on the join panel; '
  'bytebikri never sees or routes this money.';

-- ── who belongs ────────────────────────────────────────────────────────────
create table if not exists memberships (
  profile_id    uuid not null references profiles(id) on delete cascade,
  channel_id    uuid not null references channels(id) on delete cascade,
  tier_no       smallint not null default 1,

  -- A composite foreign key, not a reference to tier_no alone: the tier only
  -- means anything together with its store, and `on delete restrict` is the rule
  -- that a tier with members in it cannot be deleted out from under them. The
  -- seller can rename a tier and change what it costs; they cannot erase the
  -- thing thirty people paid for.
  constraint memberships_tier_fk foreign key (channel_id, tier_no)
    references membership_tiers(channel_id, tier_no) on delete restrict,
  constraint memberships_tier_range check (tier_no between 1 and 2),

  joined_at     timestamptz not null default now(),

  -- pending  — the person said they belong and sent (or is sending) dues
  -- active   — the owner saw the money arrive and confirmed it
  -- rejected — the owner looked and did not find it
  status        text not null default 'pending'
                check (status in ('pending','active','rejected')),

  -- The claim. `txn_reference` is what the creator matches against their own
  -- statement, exactly like the platform's own plan and rent rails — same field,
  -- same discipline, one difference: the statement belongs to a person, not to
  -- the platform.
  amount_npr    integer check (amount_npr is null or amount_npr between 0 and 100000),
  method        text check (method is null or method in ('esewa','khalti','imepay','bank','other')),
  txn_reference text,
  payer_name    text,
  payer_number  text,
  claimed_at    timestamptz,

  -- The moment the creator says the money arrived. Everything about access hangs
  -- off this and `period_end`.
  confirmed_at  timestamptz,
  confirmed_by  uuid references profiles(id) on delete set null,

  rejected_reason text,
  period_end    timestamptz,

  -- Being named on the storefront is the perk — a plate nobody can see is not a
  -- perk — but it is the member's call, so the default is on and the switch off
  -- is one column rather than a delete.
  publicly_listed boolean not null default true,

  primary key (profile_id, channel_id),

  -- A confirmed membership has a period; a pending one must not pretend to. The
  -- confirmation writes both in one statement, so the pair cannot drift.
  constraint memberships_confirmed_shape check (
    (status <> 'active') or (confirmed_at is not null and period_end is not null)
  ),
  -- A claim needs something to match, and four characters is the floor: a
  -- one-letter reference cannot be looked up in anybody's statement, so a pending
  -- row without one is a row that can never be cleared. The write path refuses it
  -- twice over (route and store); this is the third time, which is the one that
  -- holds when somebody is at a psql prompt at two in the morning.
  constraint memberships_claim_shape check (
    (status <> 'pending') or (txn_reference is not null and length(btrim(txn_reference)) >= 4)
  )
);

create index if not exists idx_memberships_channel
  on memberships(channel_id, status);
create index if not exists idx_memberships_profile
  on memberships(profile_id, joined_at desc);
create index if not exists idx_memberships_roster
  on memberships(channel_id, joined_at desc) where status = 'active' and publicly_listed;

comment on table memberships is
  'One row per (person, store). Dues are paid to the creator DIRECTLY — this table '
  'holds a claim and the creator''s confirmation, never a payment the platform '
  'handled. Lapse is derived from period_end rather than stored as a status.';
comment on column memberships.confirmed_by is
  'The channel owner who saw the dues arrive. An operator cannot set this: the '
  'platform never receives this money, so it has nothing to verify against.';

-- ── files that open for members ────────────────────────────────────────────
-- `members` joins the existing access axis (open / ad_gated / paid) instead of
-- growing a parallel one, because every surface that already asks "how does this
-- file open" keeps working. Both columns that carry that axis are widened: the
-- live one on `assets`, which the storefront and the content routes read, and
-- the policy table's copy of it, which is written on creation — a value allowed
-- in one place and refused in the other is a bug waiting for the second file.
--
-- `member_tier` lives on `assets`, beside `unlock_mode`, for the same reason the
-- pair (status, unlock_mode) lives there: they are one decision, read together by
-- one query, and set together by one form.
alter table assets drop constraint if exists assets_unlock_mode_check;
alter table assets
  add constraint assets_unlock_mode_check
  check (unlock_mode in ('open','ad_gated','paid','members'));

alter table asset_unlock_policy drop constraint if exists asset_unlock_policy_mode_check;
alter table asset_unlock_policy
  add constraint asset_unlock_policy_mode_check
  check (mode in ('open','ad_gated','paid','members'));

alter table assets add column if not exists member_tier smallint not null default 0;
alter table assets drop constraint if exists assets_member_tier_range;
alter table assets
  add constraint assets_member_tier_range
  check (member_tier between 0 and 2);
-- The two are one decision, so they are checked as one: a file that is open to
-- members names a tier, and a file that is ad-gated cannot secretly be tiered.
alter table assets drop constraint if exists assets_member_shape;
alter table assets
  add constraint assets_member_shape
  check ((unlock_mode = 'members') = (member_tier > 0));

comment on column assets.member_tier is
  'Which membership tier opens this file when unlock_mode = ''members'': 1 any '
  'member, 2 the top tier only. Zero for every other mode — a file opens one way.';
comment on column assets.unlock_mode is
  'How a viewer gets in. `members` means a confirmed membership of at least '
  '`member_tier` opens it with no ad; the unlock row it writes expires with the '
  'membership''s period.';

-- ── how the unlock row says where it came from ─────────────────────────────
-- Member access is written as an unlock row with an expiry of the membership's
-- period end, not as a second entitlement system. That choice is worth spelling
-- out because it decides behaviour everywhere else for free: the library page,
-- "what is open right now", reviews (which hang off unlocks), the download
-- count, and the revoke path all keep working untouched, and lapse needs no job
-- — `expires_at` already IS the rule, and `isUnlocked` already reads it.
alter table unlocks drop constraint if exists unlocks_method_check;
alter table unlocks
  add constraint unlocks_method_check
  check (method in ('rewarded_ad','offerwall','survey','manual','paid','open','membership'));

comment on column unlocks.method is
  'How access was earned. `membership` rows carry the membership''s period end as '
  'their expiry, so a lapsed membership closes the file without a sweep job.';
