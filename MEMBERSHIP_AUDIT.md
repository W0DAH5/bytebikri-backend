# The member card, against the membership model

**Reviewed:** 2026-09-26 · `arena/01a0c338-bytebikri-backend` @ `038100c` · the card under review is the
public roster plate on `/s/nima-crafts` (`docs/evidence/round48/membership-*-01-public-roster.png`).
No attachment arrived with the request, so that plate is what this audit treats as "the member card";
if a different card was meant, the same method applies and the finding may differ.

**No fix is applied in this round.** This is the current behavior, traced to implementation and tests,
plus the smallest change that would make the card tell the truth.

---

## 1. The three questions, answered separately

### 1.1 Visual styling — is the card polished?

**Yes.** The plate is well built: an avatar tile in the store's tier palette, the member's name wearing
their own Plus effect, the tier chip with its glyph, the `since` line, and the outer ring/frame layers
composed by one function (`composeName`). `ci/eyes/premium-walk.mjs` §16 asserts the card renders on
the seller's queue, the roster and a review with the same layers in the same colours, and §5 asserts
the reduced-motion and light-scheme variants. Nothing in this audit is a criticism of how it looks.

### 1.2 Membership identity — can a user tell this account has a paid membership?

**Partly, and it is the store's membership that is legible, not the fact of payment.** The chip beside
the name is the *creator's* tier (`Elite`), painted in the store's palette for that tier. That is
genuine and correctly labelled — but it is a statement about **which tier this person holds**, and the
chip renders identically whether that tier is being paid for today or ended last month. The card also
carries `since 26 Sept 2026`, which is a *joined* date, not a *paid-through* date.

So a reader can see *that this person belongs to a tier* and cannot see *whether it is current*. Under
the request's own framing — "can a user immediately understand that this account currently has a paid
membership" — the answer is **no**: the card does not carry the word "current" or its negation, and its
presence is not conditioned on the membership being live.

### 1.3 Membership behavior — does the UI reflect the actual entitlement?

**On four surfaces out of five, yes — and the fifth is the public card.**

The experiment: one real membership row (alice at Nima Crafts, tier 2 "Elite", `status='active'`,
`period_end` 2026-12-26) with **only `period_end` moved one day into the past**. Nothing else touched —
no status rewrite, no job, no second row. All five surfaces were then read in the same minute.

| # | Surface | Renders as | Verdict |
|---|---|---|---|
| 1 | The person's own card (`/s/nima-crafts`, as alice) | "**Your period has ended.**" + "Send this period's dues" | ✅ correct |
| 2 | The members-only file (`bhaktapur-workshop-recordings`) | "Members only / Unlock" — refused | ✅ correct |
| 3 | The seller's own member list (as nima) | `pill-warning` "**ended**" | ✅ correct |
| 4 | The member room (`/s/nima-crafts/members`, as alice) | "Your period has ended" | ✅ correct |
| 5 | **The public roster card** (as a signed-out guest) | `member--top` + Elite chip + `since …` — **identical to a current member** | ❌ **wrong** |

**The proof is a hash.** The public roster card was screenshotted while active and again while one day
lapsed, from the same seed, viewport and selector:

```
active  sha256:58154f04b3fc3161…
lapsed  sha256:58154f04b3fc3161…      ← byte-identical
```

The card is not merely *similar* in the two states; it is the same bytes. A storefront visitor, a
buyer deciding whether to join, and the member's own peers are all shown an expired membership as a
current one.

---

## 2. The model, traced

### 2.1 What makes someone a paying member

One row in `memberships`, one per (person, store), written by one of **two doors**
(`db/migrations/0031_memberships.sql:105`):

- **dues** — the person records a transfer reference (`joinMembership`, `store.js:3650`), the creator
  checks their own statement and confirms (`confirmMembership`, `store.js:3470`). The confirmation is
  what writes `confirmed_at` and `period_end` in one statement, enforced by
  `memberships_confirmed_shape`: a `status='active'` row with no period cannot exist.
- **watching** — `joinByAttention` (`store.js:3440`): verified views are spent on the tier
  (`ATTENTION_VIEWS`, `memberships.js:91`) and the same row is written with no money involved. Tiers
  choose which doors they offer (`doorsOf`, `memberships.js:68`).

Money never passes through the platform: the platform holds a claim and a creator's confirmation.
That is stated in `MONEY_LINE` (`memberships.js:400`) and repeated wherever dues are mentioned.

### 2.2 Current vs expired, as the code defines it

**Lapse is derived, never stored.** `memberships.status` may only be `pending`, `active` or `rejected`
(`0031:125`), and the table's own comment is explicit:

> 'Lapse is derived from period_end rather than stored as a status.' — `0031:176`

`membershipState(row, now)` (`memberships.js:331`) is the single vocabulary: `none | pending |
active | rejected | lapsed`, with `lapsed` computed from the clock. `membershipCurrent()`
(`:347`) is the boolean the entitlement paths use. `app/test/members.test.js:139` —
*"a membership ends because the clock says so, and nothing is deleted"* — asserts the row survives,
`status` stays `'active'`, and **no column anywhere is named `lapsed`**, so the derived answer cannot
disagree with the clock.

### 2.3 What the member actually receives

Four things, and only the first is an entitlement over files:

1. **Files** whose `unlock_mode='members'` and `member_tier <= held tier` open with **no ad**
   (`opensFor`, `memberships.js:358`; `doorFor` → `'covered'`, `:181`). A **supporter**-tier member gets
   the belonging and their files keep their ordinary ask (`doorFor` → `'ads'`) — a deliberate tier
   arrangement, snapshotted on the row as `ad_mode` when they join, so a seller editing the tier later
   cannot change what somebody was promised.
2. **The platform's own ad position, released** — only when the *store's plan* carries the capability
   and the viewer holds a current membership (`memberAdFreeFor`, `memberships.js:163`; migration
   `0050_member_ad_free.sql`). The store's own positions are untouched.
3. **Being named on the public roster** — `publicly_listed`, default true, the member's own switch.
4. **The member room** and the tier's stated perks.

### 2.4 Where those benefits are communicated

| Benefit | Where it is said | Where it is decided |
|---|---|---|
| Files open, no ad | person's own card (`memberAdLine`), tier cards | `opensFor` / `doorFor` |
| Supporter arrangement | `SUPPORTER_LINE` (`memberships.js:604`) | `adModeOf` (`:134`) |
| Platform position released | `MEMBER_AD_LINE_RELEASED` (`:462`) | `memberAdFreeFor` |
| Named on the roster | own card's listing control + footnote | `publicly_listed` |
| How to join, and what it costs | tier cards, `duesLine`, `CONFIRM_LINE`, `MONEY_LINE` | `joinPanel` (`views.js:1233`) |
| What happens at the end | `LAPSE_LINE` (`memberships.js:415`) | own card, lapsed branch |

`LAPSE_LINE` is the sentence that matters for this audit, and it is shown to the member:

> "Nothing is deleted when a period ends. **The plate goes quiet** and the members-only files close
> until dues are confirmed again."

### 2.5 What happens on expiry, cancellation, or change

- **Expiry** — nothing runs, nothing is deleted, `status` is not rewritten. Own card, file gate, seller
  list and member room all switch over (table above). **The public plate does not.**
- **Cancellation ("Leave")** — `leaveMembership` deletes the row and audits `member.left`
  (`store.js:3766`). State becomes `none`, so the card disappears and the join panel returns: coherent
  everywhere, because there is no row left to render.
- **Change** — paying early **extends**: `period_end = greatest(period_end, now()) + months`
  (`store.js:3481` and `:3505`), asserted in `members.test.js:167`. Renaming or re-pricing a tier
  changes the chip's *label* (the roster joins the tiers table) while the person's *arrangement*
  (`ad_mode`) stays as snapshotted. A tier with members in it cannot be deleted: the FK is
  `on delete restrict` and `deleteMembershipTier` (`store.js:3559`) refuses with a sentence.

### 2.6 Does the UI distinguish a genuine entitlement from decorative styling?

**On the same card, one layer does and the other does not — and the codebase already knows the rule.**

The card draws two independent entitlements:

- the **person's own Plus look**, from `customer_subscriptions` — joined through
  `PLUS_SUBSCRIPTION_JOIN` (`plus.js:355`), which requires `cs.status = 'active' AND cs.period_end > now()`.
  Its comment states the reason: *"a query that forgot the comparison would dress somebody who stopped
  paying weeks ago."* A lapsed look wears nothing.
- the **store's tier chip**, from `memberships` — joined with `m.status = 'active' AND
  m.publicly_listed` and **no comparison against `period_end`** (`store.js:3879`).

So a lapsed member loses the look and keeps the chip. The failure mode is described in this repository
in almost these words, about the look, in `views.js:1000`:

> "Change that join (to show a lapsed month, say) and this page starts painting looks nobody is paying
> for, silently, on a storefront."

That is exactly what the membership join does.

---

## 3. Two functions built for this, rendered nowhere

Found while tracing, stated as facts:

- **`memberBadge`** (`memberships.js:641`) returns `{ state, tier, tierNo, plate }` — *"the badge and the
  roster cannot disagree"*. It is imported at `app/server.js:81` and **called nowhere**, and the roster
  renderer does not receive a state to disagree with.
- **`memberRefusal`** (`memberships.js:372`) returns the sentence a refused member should read, and it
  distinguishes `pending`, `lapsed`, `tier` and `join`. It is unit-tested (`members.test.js:199`) and
  **rendered nowhere**; the file page's own gate supplies its wording instead.
- `membershipsOf` (`store.js:3633`) is likewise called nowhere.

None of these is a bug on its own. Together they show the state vocabulary was built with the roster in
mind and never reached it.

---

## 4. The smallest changes that would make the card accurate

Not a redesign: no new vocabulary, no new benefits, no layout change beyond what the words need.

1. **`publicRoster` returns one more column** — `store.js:3854`, add `m.period_end` to the select. The
   query stays `status='active' and publicly_listed`: the question this answers is "still listed", and
   the state is derived, exactly as the table's comment requires.
2. **The renderer derives and states the state** — `memberRoster` (`views.js:1104`) passes `period_end`
   to `memberPlate` (`views.js:903`), which calls the existing `membershipState()` and adds
   `data-state` plus one short marker reusing the seller list's own vocabulary (`views.js:7453`):
   `current` / `ended`. Nothing else on the plate changes: the chip stays, because the tier a person
   held is a fact about the store's own record — what is added is that it says when it ended.
3. **One stylesheet rule for the ended plate** — reuse the quiet treatment the lapsed own-card already
   uses. This is the piece that must not become a red badge: an ended membership is not a fault, and
   `LAPSE_LINE` already promises the plate "goes quiet" rather than disappearing.
4. **Tests, and they are the acceptance criteria rather than the appearance:**
   - the existing `publicRoster` regression test pattern (`members.test.js:275`, *"the query and the
     renderer have to agree"*) extended to assert `period_end` reaches the renderer;
   - a rendered-HTML assertion that an active and a lapsed card **differ** — the byte-identical pair in
     `docs/evidence/round48/` is the failure this pins;
   - one browser assertion in `ci/eyes/member-walk.mjs` that a lapsed member's card carries the ended
     state on a storefront a stranger opens. That walk currently has no lapsed case at all.

**One decision this change needs, and it is the operator's, not mine:** whether a lapsed member stays
on the public roster, marked ended, or leaves it. The evidence points at *marked*: the member's own card
renders "Hide me from the member list" **while they are lapsed**, which only makes sense if a lapsed
member is otherwise still listed, and `LAPSE_LINE` says the plate goes quiet rather than away. Hiding
would also contradict the roster's own footnote — *"You are named on this store's member list"* — for a
person who has not asked to be hidden.

**Explicitly not proposed:** a renewal prompt inside the card, any new perk, any tier redesign, and
touching the chip's colours or the two-layer composition. Those are the parts this audit found correct.

---

## 5. What "done" will mean here

The request's own standard, applied to this fix: a claim of done will point at

- `app/src/store.js` `publicRoster` returning the period end,
- `app/src/views.js` `memberPlate`/`memberRoster` deriving the state through `membershipState()`,
- the CSS rule and the words rendered,
- `app/test/members.test.js` asserting the query and the renderer agree, and that the two states render
  differently,
- `ci/eyes/member-walk.mjs` asserting it in a browser as a stranger,
- and a fresh `docs/evidence/round48/` pair whose hashes **differ**.

Until those exist, this card is decorative in exactly the way the request warned about: it looks like a
membership and does not encode one.

---

### Method

Every claim above was read from the branch at `038100c`, and the five-surface comparison was run live:
the demo seeded with `ci/demo-state.mjs`, one `period_end` moved by a single `update` and restored
afterwards, each surface fetched as the account that may see it (guest for the roster), and the card
photographed rather than described. Frames: `docs/evidence/round48/membership-{active,lapsed}-01…03.png`.
