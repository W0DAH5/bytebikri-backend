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
| 5 | **ByteBikri Plus** | person → bytebikri | **revenue 3** | `plus.js` + `customer_plans.price_npr` = NPR 149/month; `store.js` `claimPlus` / `matchCustomerPlanPayment` |

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
one effect from three (plain, a gradient edge, or a slow halo), on every surface that shows their name
to somebody else — a store's roster, the seller's member queue, a review, the account chip.

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

## Still open (yours to call)

1. **Member-paid ad-free, charged to the seller** — a capability, a price, and a rule about our rent.
2. **Roster pricing for the person's premium** — flat (built: NPR 149/month) versus scaled with what a
   member uses. Flat is what shipped, because there is nothing to scale: a palette costs the platform
   nothing to render, and metering a cosmetic would be the per-item pricing the research refuses.
2. **Does a big roster pay more rent?** Traffic prices the rent slot already, so a busy members store
   pays more — but a 500-member store with flat traffic pays the same as one with none.
