# The revenue architecture, as built — not as proposed

Every number below is read out of the repository, not asserted. File paths are the proof.

Written because the question "how did you make the revenue architecture for these features?" has an
answer that is easy to misread: **the architecture predates the features.** Memberships, the theme and
the premium file gate did not add a revenue line. They added reasons to hold the one plan price and
reasons for the pages the one rent slot is priced on — which is the whole of it.

See also: `FEATURE_AUDIT.md` §31b (the round that wrote this down and fixed three sentences the
memberships had turned false).

## The whole model: five legs, three of which are ours

| # | Leg | Payer → Payee | bytebikri | Code that decides it |
|---|---|---|---|---|
| 1 | Ad revenue | network → store's own account | **not a party** — cannot see the balance | `slots.js` (`payoutParty: 'channel'`), `earnings.js` `MONEY_MAP.toCreator` |
| 2 | Membership dues | member → store owner (eSewa/Khalti/bank) | **not a party** — cannot confirm, refund, or take | `store.js` `confirmMembership` (owner-only in SQL), `memberships.js` `MONEY_LINE` |
| 3 | **Store plan** | seller → bytebikri | **revenue 1** | `store.js` `PLANS.priceNpr` = 0 / 999 / 2,499; `billing.js` `upgradeExplanation` (pro-rated) |
| 4 | **Annual rent** | seller → bytebikri | **revenue 2** | `slots.js` `POLICY` + `billing.js` `annualRentNpr` |
| 5 | **ByteBikri Plus** | person → bytebikri | **revenue 3** | `plus.js` + `customer_plans` = NPR 149/month, NPR 1,490/year (ten months' price); `store.js` `claimPlus` / `matchCustomerPlanPayment` / `claimPlusGift` |

Five legs, and the shape of them is the point: **the platform earns from three places and is a party
to only those three.** It touches nothing belonging to a creator — not their ad revenue, not their
dues — and the one thing it sells a person is a look.

## Revenue 1 — the plan (fixed, published)

- Free NPR 0; **Store NPR 999/yr**; **Pro NPR 2,499/yr**. `db/migrations/0001_init.sql` seeds the same
  numbers, and `billing.js planDrift()` fails loudly if the table and the app ever disagree.
- Upgrade is **pro-rated to the end of the period already paid for** — `upgradeExplanation` prints
  `to − from = full difference`, then the days left. Nothing is charged twice for the same day.
- Payment is a **manual rail**: transfer to the operator's account + a reference, matched by hand
  (`recordPlanPayment` needs `pending_plan_code`). The UI says so rather than faking a checkout.

## Revenue 2 — rent on ONE ad position (traffic-priced, self-limiting)

**As revised in migration 0034** — the density cap came down from 8 positions to 3, which changed the
arithmetic of this leg rather than its principle:

1. `SLOT_DEFS` (`store.js`) defines the ranks; ranks 1–3 are active and ranks 4–5 are kept, marked
   `active: false`, because sellers' `slot_creatives` rows still name them.
2. `allocateSlots()` (`slots.js`) takes the plan's `slot_count` — now **1 (Free) or 2 (Store/Pro)** —
   sorts by rank, and slices. The platform's position is the **next rank down**, a separate position
   rather than one converted from the store's: at a cap of one, converting would have handed us the
   Free store's only position, at rank 1, which is the one rule this policy has never broken.
3. The fairness rules, restated:
   - **never rank 1** — `POLICY.platformTakesRank = 'last'`
   - **one per page, never more** — `POLICY.platformSlotsPerPage = 1`
   - **a page with no position of its own is never taxed** — `POLICY.minTenantSlotsBeforeTax = 1`
     (the old threshold of 3 is now larger than the cap itself; the seller's panel prints
     *"no rent to price"* for a store that allocates none)
   - **empty slots keep their height** — no reflow, so nobody's ad rates are damaged by our tag
   - **three boxes is the maximum on any page** — `POLICY.maxTotalSlots = 3`, checked in
     `test/slots.test.js` for every plan
4. The rent position is the **least valuable one** — `payoutParty: 'platform'`; every other slot is
   `'channel'`.
5. Price: `POLICY.assumedRpmUsd = 0.2`, `usdToNpr = 133`, `annualRentNpr = estNpr × 12`, floored at 0.
6. **A zero invoice is normal.** No traffic → no rent → no invoice issued at all.

### The one thing a plan may do to our position: member ad-free

The rent section above describes the position as fixed. It is fixed in *where it goes* — never rank 1, never
more than one per page, never on a page with no position of its own — and there is exactly one condition
under which it is not rendered at all, which was designed in from the first version of `slots.js` and left
unsold until now:

```
POLICY.releasedBy = 'ad_free'   // capability flag; all plans default false for now
```

`allocateSlots()` reads it, and a plan that carries it loses the platform's position **without touching any
of the store's**. `test/slots.test.js` has asserted the hook since the density revision, with a comment
saying it is read by no plan today and that the assertion is what keeps it from becoming dead code. This is
the round that sells it, so the hook earns its keep.

**What is sold, and to whom.** Pro (NPR 2,499) may release the platform's position **for that store's
current members** — nobody else. The buyer is the store, because the money cannot come from anywhere else
without breaking a rule this platform has already written down:

- Not from the person. `Plus` is cosmetics only, and a person's premium may never remove a creator's ads
  (`AD_ECONOMY.md`, and the class actions YouTube Premium is defending over the words "ad-free"). A paid
  tier that made ads disappear would be exactly the product this platform refused to build.
- Not from the platform's ad revenue. Leg 1 is network → store's own account; bytebikri is not a party to
  it and has no mechanism to pay anybody a share. Releasing our own position costs us our own line, not the
  creator's — and it is the only ad on the page that is ours to give away.

So a store buys the capability on its plan, and gives the perk to its own members. That is the layer split
the model already holds: **the platform sells capability to a store, the store sells relationship to a
person** (`ASSET_EVOLUTION` §5.4's two doors), and neither party can grant what belongs to the other.

**Why the store pays, when Twitch makes the creator pay instead.** Twitch ships the same feature and the
streamer eats it: with "Ad-Free Viewing for subscribers" on, subscribers stop counting as impressions, and
Twitch's own guidance is that this is "a minimal change in ad revenue… balanced by higher subscription
rates". YouTube refuses it outright for channel memberships — you can pay a creator monthly and still get
ads — and the reason is structural: its Premium does remove ads, because Google pools subscription revenue
and pays creators out of the pool. This platform has no pool, no path to a creator's money, and no
intention of acquiring one. Twitch's model needs the creator to absorb an invisible cost; YouTube's needs
revenue sharing. We do neither: **the cost is a price, on a plan, published on the pricing page.**

**Four things it does not do**, each because the alternative contradicts something already written:

1. **It does not touch the store's own positions.** Those are the store's, filled by the store's own ad
   connections, and they are leg 1. Releasing them would be giving away somebody else's revenue.
2. **It does not touch the breaks the store's own plan placed inside their files** (`breaks` mode, §10).
   A cue break is the *store's* ad in the *store's* file, and the tier-level `ad_mode: 'ad_free'` already
   covers the member's own file opening. Our position is a different thing from their break, and this
   capability moves only ours.
3. **It does not release the position for everyone.** Rent is priced off the traffic the platform brought
   (measured pageviews), not off impressions, and the position still renders for every visitor who is not a
   current member. A store that wanted our position gone for its whole audience does not exist as an option:
   that would forfeit this leg entirely for a store whose traffic we are still paying to serve.
4. **It cannot be granted by a plan that does not carry it.** The capability is checked first, so a
   membership row on a Free store releases nothing. That is the guard on the hook, kept in the allocator
   where the hook has always been.

**The rent is unchanged**, and the arithmetic is not adjusted for it. A member's pageview still counts — the
traffic is the same traffic — and the invoice still prices one rent position. What changes is which boxes are
drawn for that one viewer: the ledger counts what was drawn (`drawnSlots`), so the numbers stay true rather
than flattering.

**One sentence was wrong before this was built.** The seller's slots page called the position *"Platform ·
rented to ByteBikri"* and said *"the store rents it to ByteBikri"*, while `billing.js` invoices the store
rent for it, `MONEY_MAP` lists it as money the store pays, and the table's own comment says bytebikri
*receives* it. The direction was reversed in the copy: the store pays for the position, the platform fills
it and keeps what it earns. Corrected in the same round, in both the seller's panel and the shopper's.

### What building it found, in the order the checks found it

Four defects, all of them in the gap between *a capability that exists* and *a page that is right*. Recorded
because each one was invisible to the check that would seem obvious:

1. **The entitlement was read as an instruction.** `plans.capabilities.ad_free` means *"this store may
   release our position for its members"*; `allocateSlots` reads the same key as *"release it, for this
   page, for this viewer"*. `buildSlots` spread the plan's blob straight through, which made a Pro store's
   pages carry no platform position for **anybody** — the rent leg deleted on the top plan, and strangers
   handed an ad-free store. Caught by `test/slots.test.js`'s oldest assertion ("a page with a position of
   its own still carries one of ours"), which is the assertion that exists for exactly this. The flag is
   now set explicitly, never inherited, and a new assertion loops every plan for a signed-out visitor.
2. **`views.js` has no database.** The first draft of the seller's panel called `store.plan(channel)` in a
   module that reads no tables — a `ReferenceError` on the page. The fact is passed in from the route, the
   way every other fact in that file is.
3. **The platform clipped its own sentence.** The corrected house creative ran 252 characters and
   `normaliseCreative` caps a body at 220, so every storefront in the product rendered *"…No cut of what
   the"* — half a sentence, in our own box, on somebody else's page. Unit tests passed the whole time: the
   module held the whole string and the page held part of it. `test/creatives.test.js` now asserts the
   sentence survives the normaliser, and `ci/eyes/member-adfree-walk.mjs` asserts the **rendered** text
   equals the constant, character for character.
4. **The member was told our position was on their page.** `MEMBER_AD_LINE` names two positions and says
   both are present — true of every plan until this one, and false on the only plan whose whole point is
   taking ours away. It printed in the member's own panel, on the page with the empty space it described.
   The sentence now has a second state (`MEMBER_AD_LINE_RELEASED`) chosen by the same entitlement, and the
   seller's "What your members see" row reads whichever one is true of the store they are selling to.

The last two were found in a browser and by nothing else, which is the argument for the walk: both were
correct code printing a false or truncated sentence, and no unit test in this repository can see a page.

**Walked end to end** in `ci/eyes/member-adfree-walk.mjs`: a stranger sees the position; the store's live
member does not, and is told so in their own words; a claimant whose dues are unconfirmed still sees it; a
member of a *different* store sees it on the other store's page; a store on a plan without the capability
is not told about it at all, while the seller who bought it is told exactly which position goes and what is
untouched; and after the walk's temporary plan move is restored, the stranger's page carries the position
again — proving the capability was the cause rather than a cache. Shots 1–5 of `docs/evidence/round43`.

## What memberships changed in the model: nothing in our column

`plans.capabilities.memberships` is `true` on Store/Pro and `false` on Free. So memberships:

- **raise plan value** (a reason to hold the 999), which is revenue 1;
- **raise page traffic** (rosters, member file pages, a reason to return), and rent is priced on
  measured traffic — that is revenue 2, indirectly and honestly;
- **add nothing chargeable**: no per-member fee, no dues percentage, no new line item.

Held honest by two tests: `test/billing.test.js` asserts **no plan prints a third charge**, and the
seller's new **"Where the money goes"** panel (`views.js`) renders exactly four rows from
`memberships.js revenueRows()` — *what you collect · what bytebikri charges you · where the ad
positions are · what your members see* — with the slot arithmetic **imported from `slots.js`**, so the
panel and the allocation policy cannot drift.

## Revenue 3 — ByteBikri Plus, and why it is cosmetics only

A person pays the platform NPR 149 a month for **how their own name looks**: one palette from eight,
one effect from six (plain, an edge, a halo, a gradient, a neon bloom, or a moving prism band), on every
surface that shows their name to somebody else — a store's roster, the seller's member queue, a review,
the account chip. **A year is the same plan with a longer period at ten months' price** — NPR 1,490 for
twelve — and it is a period, not a second product: `db/migrations/0042_plus_gifts.sql` seeds the row
with a capabilities jsonb byte-identical to the month's, `plusYearPrice()` is the rule (asserted, and
`plusYearNote()` prints the saving in rupees rather than in adjectives), and `PURCHASABLE_PLAN_CODES`
in `plus.js` is the only list a route checks a submitted code against — a test asserts that list and the
`customer_plans` table agree, because the first cut of the annual release had a plan key spelled in one
file and read in another, and `/plus` answered 500 in a browser while every unit test passed.

Three properties, each one a decision with a reason:

1. **It opens nothing and removes nothing.** `customer_plans.capabilities` carries
   `opens_content: false` and `removes_ads: false`, and `test/plus.test.js` asserts both stay false. A
   cosmetic that could open a file would be a hole in every creator's paywall at once; an "ad-free"
   promise would be selling the creator's ad revenue, which the platform never receives (leg 1 is
   network→store) and is what YouTube Premium is currently defending two class actions about.
2. **One price, everything included.** Researched in `AD_ECONOMY.md`: the backlash against every
   comparable shop was aimed at per-item pricing on top of an existing subscription, not at the
   existence of cosmetics. Nothing is sold twice.
3. **The manual rail, matched by a person.** A claim is a reference (`customer_plan_payments`, unique
   index on the reference across the platform); an operator matches it against the platform's own
   statement; only then does a period start. Cosmetic choices are stored whether or not an arrangement
   is running, and a lapse needs no job — the entitlement is a join (`PLUS_JOIN` in `store.js`:
   `status = 'active' and period_end > now()`), re-checked in `plusWear()`.

**Where the third charge is stated:** the seller's "Where the money goes" panel gained a row
("ByteBikri's other line" — a person can pay us for a look, and it opens no file, removes no ad, and
touches nothing you earn), `MONEY_MAP` gained the leg it was missing (`toPlatformFromPeople`, rendered
as its own panel on the seller's earnings page, because a page headed "where the money goes" cannot
name three flows and omit ours), the operator's `/admin` totals count it
(`platformMoney().plusThisMonthNpr`), the payments queue has its own section, the audit log has its own
family (`plus.`), and `/plus` states the separation from both other premiums on the page that takes the
money.

## Gifts — the researched social pattern, on the rail that already exists

Discord Nitro's gift links and Twitch's gifted subs were studied for this round, and one pattern was
taken: **a period can be bought for somebody else, and what carries it is a code.** Built here on the
manual rail, with no new money path:

- `customer_plan_gifts` (migration `0042_plus_gifts.sql`) holds the code, the buyer, the note and the
  state: `reserved → funded → redeemed`, or `reserved → void`. The CHECK makes `redeemed` require both
  `redeemed_by` and `redeemed_at`, so a gift cannot be used up by nobody.
- The code is minted **at claim time, not at match time**, because the buyer has to tell their friend
  what to type before any operator has looked at anything. `BKP-XXXX-XXXX` over a 32-character alphabet
  with I/O/0/1 removed — a code gets read aloud, and `randomInt` is the source.
- **A reserved code does not work, and says so.** `redeemPlusGift` refuses by name — `gift-unknown`,
  `gift-used`, `gift-void`, `gift-unfunded`, `gift-self` — and the buyer's page prints the state beside
  the code, which is the sentence that stops somebody handing over a string that does nothing.
- **The buyer's own arrangement is never touched.** `claimPlusGift` creates their subscription row only
  if it does not exist and otherwise leaves it exactly as it was: a person with a month running who buys
  a friend a month must not stop wearing their look. `matchCustomerPlanPayment` funds the GIFT
  (`isGift: true`) when the payment carries a `gift_id` — never the payer's own period — and rejecting
  such a payment voids the gift rather than cancelling the buyer.
- **A gift payer has no arrangement to point at, and the ledger requires one.**
  `customer_plan_payments.customer_subscription_id` is NOT NULL and the operator queue joins through
  it, so `0043_subscription_none.sql` adds the one status that was missing: `'none'` — a row that says
  *no arrangement*. It is not a lapse, and nothing can count it as one: the console derives a lapse
  the way every clock here is derived — an **active** row whose `period_end` has passed — so a `'none'`
  row, which is neither active nor dated, cannot appear in `platformMoney().plus_lapsed`.
- **Days are never lost.** Both the match and the redemption extend from
  `greatest(period_end, now()) + months`. The first cut of the match restarted the period, which
  silently dropped the remaining days of anybody who paid early; a test asserts exactly +31 days.
- The operator's queue renders a gift as a gift — a pill, the code, the buyer's note and a **"Fund the
  gift"** button in place of "Match" — and the console's own panel reports
  `gifts_{reserved,ready,redeemed,void}` beside the arrangements.

Walked end to end across three accounts in `ci/eyes/premium-walk.mjs` §13 (buyer, recipient, operator):
claim → the reserved code visible on the buyer's page → the recipient refused with a reason → the
operator funds it → the recipient redeems → a second attempt refused → **the buyer's arrangement is
unchanged**, which is the assertion the whole feature exists for. Shots 15–18 of
`docs/evidence/round36`.

## What the research added, and what it was told to leave

The brief for the round was to take the research that fits this product and discard the rest. Recorded,
so the discards are decisions rather than omissions:

**Taken.** ① **Gifting** (above) — the summary's social pattern, rebuilt on the manual rail.
② **A year at ten months' price** — the summary's "annual discounts", which needs no new capability and
is one extra period on one plan. ③ **Entitlements as the source of truth** — already the shape here
(`PLUS_SUBSCRIPTION_JOIN`, re-checked in `plusWear()`), so research confirmed rather than changed it.

**Discarded, with the reason.** ① **Stripe, webhooks, PCI** — the rail is manual and matched by a
person; there is no card, so there is no token, no webhook and no PCI surface. ② **Server boosts and
platform-side currencies** — the platform does not take money from creators and does not pay users, and
a boost is a flow in the wrong direction. ③ **Emoji, avatar and banner upload pipelines with a CDN** —
an upload path is moderation, storage and cost, and the identity work already chose generated marks
over uploads for the same reason. ④ **HD streaming, WebRTC, priority support** — there is no cost
behind this plan (see "settled: flat" below), and a priority-support promise would be the first thing
in the whole model with an operating cost attached and one operator to carry it. ⑤ **App-store IAP and
taxes** — no store app sells anything yet, and Nepal-first prices are published in NPR by hand.
⑥ **Feature-flag and A/B infrastructure** — with one operator and a manual rail, the experiment is a
decision and a rollout is a page reload. ⑦ **An MRR/churn pipeline** — the console prints what the
ledger holds (`platformMoney()`), which is the number somebody can act on at this size.

**One SQL fact, one copy of it.** "Is this person's arrangement active right now" is decided by
`PLUS_SUBSCRIPTION_JOIN` in `plus.js` — the entitlement is `status = 'active' and period_end > now()`,
joined laterally — and it is imported by `store.js`, `auth.js` (so a session row carries it and the
header chip cannot be the one page that forgets) and every roster and review query that dresses a name.
The first cut kept that join private to `store.js`, and the browser pass found the two pages that had
gone without: the account chip and the arrangement panel both said "nothing is being worn" to somebody
who was, at that moment, wearing a halo.

## The dues leg on the money map (added this round)

`MONEY_MAP` had two entries while the earnings page's heading claimed *"Where the money goes, and who
is holding it. It is not us."* The third leg now renders as its own panel: **paid by your members →
your own account · held by bytebikri: nothing, ever · 0% to bytebikri**, naming eSewa/Khalti/bank.

## Where the ads are — stated to the member, before they pay

- `ADS_AROUND_LINE` on the join panel (signed-in **and** anonymous) and in the seller's revenue panel.
- `MEMBER_AD_LINE` on the member's own card once dues are confirmed.
- The rule the copy rests on: **an ad may sit around a member's content, never inside it.** A members
  file opens by an `unlocks` row, never by an ad view.

Measured on `/s/alice`: the page carries **two** ad positions — the store's at rank 1 (y = 651, first
thing under the header) and the platform's as the **last element** of a 4,837px document (y = 4,356).
"Around the content, never inside it" is a description of the DOM, not a slogan.

## Explicitly rejected, with the reason

1. An AdSense-style "join and the ads go away" tier. **The networks pay the store's account directly**,
   so bytebikri cannot withhold an ad's revenue from anybody — "we will suppress the seller's ad" is not
   ours to sell. It needs seller consent plus a platform-side setting, and it is recorded as **open** in
   `FEATURE_AUDIT.md` rather than half-built. `slots.js` `releasedBy: 'ad_free'` remains the hook, still
   read by no plan.
2. **A customer premium that removes ads.** Rejected a third time this round, on the record: the
   customer's cosmetic plan is cosmetics (revenue 3 above) and the words "no ads" appear nowhere near it.
3. **Selling density.** The per-plan `slot_count` falling from 3/5/8 to 1/2/2 means the paid plans now
   buy *capability* (a second position, a higher ask ceiling up to the platform's fixed limit, members,
   a theme, a badge) rather than more boxes. The seller's panel still says what each charge is, and the
   price did not move.

## Two questions that look alike, and are not

Both get called "roster pricing". They are different decisions about different legs, and separating them
is most of the answer:

### 1. What a person pays for their own look (leg 5) — **settled: flat**

One price — NPR 149 a month, or ten months' price for twelve, which is a period choice on the same
plan and not a second product — everything included. There is nothing to scale: a palette and a gradient cost
the platform nothing to render, and metering a cosmetic would be the per-item pricing every comparable
shop has been punished for (`AD_ECONOMY.md` §4). If a store-scale capability ever joined this plan — a
verified highlight, a profile page — the question would return, because then there *would* be something
with a cost behind it. Until then, a flat price is not a simplification; it is the honest shape of a
product whose marginal cost is zero.

### 2. Whether a store with a big paying roster owes more rent (leg 4) — **charged on traffic, not on dues**

The argument for scaling the rent with the roster is that a store with five hundred paying members is
richer than one with five, so it should pay more. Two facts in the code say no, and one of them is
decisive rather than a preference:

- **The rent buys a position, and a roster creates no position.** The platform's ad slot is never placed
  inside a member surface (that was settled when the member story was built: an ad may sit *around* a
  premium surface, never inside the thing somebody paid for). So a store with five hundred members has
  exactly the same number of rentable positions on exactly the same pages as a store with none. What the
  network pays for a position is a function of the traffic that sees it — and `estimateRentSlotValue()`
  prices it exactly that way: `pageviews × RPM ÷ positions`. **Traffic is already the scaling variable.**
- **Scaling rent on dues would make bytebikri a party to a flow it is built not to touch.** Leg 2 is
  member → creator, with the platform unable to confirm, refund or withhold a rupee of it; `MONEY_MAP`
  says so in the seller's own panel, and `confirmMembership` is owner-only in SQL. A rent that rose with
  the roster would be bytebikri charging for the size of a flow it claims not to be part of — a
  percentage by another name. The one thing this money model refuses everywhere is exactly that.

So the rent stays on traffic. What *is* open, and is a business call rather than an architecture one:

- **Does a members-only store with low public traffic underpay?** Its rent can be near zero precisely
  while its dues are healthy, because dues traffic is not public traffic. Today's answer is that this is
  correct rather than a problem — the platform's inventory is public pages, and a store that earns from
  dues is a store that proves the membership feature works. If that ever needs a floor, the honest
  instrument is a **minimum rent on a paid plan**, charged flat to every paid store, and never a
  percentage of anybody's dues.

## How this document is held to the code

The numbers in it are not prose, they are the product's prices and rules, and a document that states a
price the product no longer charges is worse than no document at all: it is confidently wrong. So
`test/billing.test.js` reads this file the way `config.test.js` reads `DEPLOY.md`, and fails if it drifts
— every plan's price, both Plus period prices against `customer_plans` (the table the routes sell from),
the year's "ten months' price" relation, and the rent policy's three rules as `POLICY` states them: one
platform position per page, a cap of three, and the last rank, never the first.

## Still open (yours to call)

1. ~~**Member ad-free, charged to the seller.**~~ **Built and walked** — see "The one thing a plan may do to
   our position" above and "What building it found" under it. Pro carries `ad_free`, and the platform's
   position is released for that store's current members; the store's own positions and its own cue breaks
   are untouched, the rent is unchanged, and nothing moves between the platform and a creator. The price
   question answered itself: the capability rides on the plan that already exists rather than becoming a
   third charge, which is what the density revision argued for when it refused to sell density. Migration
   `0050_member_ad_free.sql` sells it; `REVENUE_ARCHITECTURE` §"The one thing…" holds the research it rests
   on (Twitch's creator-absorbed version, YouTube's revenue pool, and why neither fits here).
2. **A minimum rent floor on the paid plans**, if the question above ever stops being rhetorical. Flat,
   charged the same to every paid store, published on the pricing page — the failure mode to avoid is a
   floor that quietly scales with a store's success.
