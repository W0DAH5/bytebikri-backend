# Production & release plan

**Date:** 2026-09-21 · **Status:** plan + honest audit

---

## 1. Straight answers to your questions

### "what research did u do"

Enough to get the plumbing right, and not enough to make the product good. Concretely:

**Researched properly:** ad-network postback specs (BitLabs, PubScale, AppLixir, Adsterra),
Nepal payout rails and per-method thresholds, rewarded-video vs display economics, merchant-of-record
options for a Nepal entity, hosting/free-tier limits, and — this round — ad-supported-site legal
requirements (CMP, Consent Mode v2, TCF v2.4, ads.txt, GPC, cookie-wall prohibition).

**Not researched at all, and it shows:** how products in this category are actually designed. I never
looked at how Gumroad, itch.io, Ko-fi, Patreon or Lemon Squeezy present a storefront, an unlock, or a
creator dashboard. I built a UI from first principles and it looks like it. That is a real gap, not a
cosmetic one — the storefront is the product.

### "what designing idea did u implement"

Genuine design ideas are in the backend, not the UI:

| Idea | Why it exists |
|---|---|
| **Signed server-to-server postback is the only way to unlock** | A browser callback is forgeable; a forged one means free content *and* a rejected revenue claim against the channel's own ad account |
| **Per-network adapter registry** | There is no universal postback scheme — I had invented one and would have rejected every real callback |
| **Postback URL identifies the connection, not the provider** | Two channels can both use BitLabs with different secrets; a provider-only URL would have to try every secret and becomes a signature oracle |
| **Identity from our record, never from the payload** | Otherwise a leaked signing secret unlocks any account |
| **Opaque UUID instead of a user id, sent to the network** | The ad network has no business knowing who is watching |
| **Normalized states, and unknown never grants** | Offerwalls reconcile days later; granting on vocabulary we have not seen pays out on reversals |
| **Platform slot never takes rank 1** | The landlord shouldn't take the best shelf |
| **Signed, expiring, per-user download URLs** | A static link (or a magnet URI) cannot be un-shared |

**But there is no product design here.** No information architecture, no design system, no thought
about what a buyer sees first or how a creator's first ten minutes feel. You are right about that.

### "what did u research about features and how to implement them"

Feature research: ad-gated access (found Google Ad Manager **Offerwall** ships exactly this mechanic),
rewarded-video economics, and the ad-format question. Implementation research: provider signature
schemes, payout thresholds per method, slot allocation policy.

**Not researched to implementation depth, and therefore not built:** consent/CMP, ads.txt, pageview
counting, moderation workflow, notifications, plan/rent enforcement, search and discovery.

### "do u even know if u forgot sth"

Yes — and I only knew because you pushed. Measured against the 11-component list, here is the truth:

| # | Component | State |
|---|---|---|
| 1 | Accounts + channels | **Partial** — no real auth, no password, no sessions |
| 2 | Content upload + delivery | **Partial** — local disk, no media API, no transcoding |
| 3 | Ad connection | **Partial** — picker exists; no real onboarding, no credential storage |
| 4 | Slots | **Partial** — allocation is right, **but slots serve no ads at all** |
| 5 | Unlock engine | **Done** — and verified, including the failure paths |
| 6 | Storefront serving | **Partial** — renders, but the design is not shippable |
| 7 | Pageview counting | **Missing entirely** |
| 8 | Plans + rent | **Missing enforcement** — data model only |
| 9 | Moderation | **Missing** — tables only, no workflow |
| 10 | Notifications | **Missing entirely** |
| 11 | AI listing scan | **Missing entirely** |

Plus, this round: **no persistence** (in-memory, dies on restart), **no legal pages**, **no consent**,
**no ads.txt**, **no rate limiting**, **no deployment**, **no logging**, **no monitoring**.

The most damning one: **the ad slots render labels and serve nothing.** Component 4 is decoration.

---

## 2. What I need from you, and when

Nothing below blocks work. I will build everything that doesn't need these, in the order in section 3.
Items marked **BLOCKER** must be filled before real users see the app.

### Before anything goes public (BLOCKER)

| # | What | Why it's you | Where it goes |
|---|---|---|---|
| 1 | **Domain name** | Must be registered by you; ties into AdSense approval, ads.txt, and email | `PUBLIC_BASE_URL` |
| 2 | **Business entity + PAN/VAT** | Ad networks and payment rails require a legal entity to pay | Not code — paperwork |
| 3 | **Privacy policy + Terms + Cookie policy** | I will **draft** all three; only you can accept them as the operator | `/legal/*` |
| 4 | **Contact address for legal pages** | Legally required on the pages themselves | `OPERATOR_*` env |

### To run for real

| # | What | Why it's you |
|---|---|---|
| 5 | **Supabase project** (or any Postgres URL) | I can't create your account. `DATABASE_URL` |
| 6 | **Storage** — Cloudflare R2 or S3 bucket + keys | Your media API decision. `STORAGE_*` env |
| 7 | **SMTP / email sender** (Resend, Postmark, SES) | Verification + password reset need a sender you own |
| 8 | **At least one ad network account** — start with BitLabs or Adsterra | Their signup is their KYC. You paste the callback secret |
| 9 | **Plan payment details** — bank/eSewa to receive NPR | Platform revenue only; manual verification at your volume |
| 10 | **Sentry DSN** (or equivalent) | Optional but you'll want it before real traffic |

### Later, when they become the constraint

| # | What |
|---|---|
| 11 | Google Ad Manager / AdSense access (for Offerwall later) |
| 12 | CDN in front of media (R2 + Cloudflare does this) |
| 13 | A second ad network, for fallback when one has no fill |

**Total to launch: items 1–8.** Everything else I can build around.

---

## 3. Release sequence

Each phase ends in something that runs. I do the work; the "needs you" column is when you get pulled in.

### Phase 1 — Persistence (in progress)
Real Postgres, migrations, repository layer replacing the in-memory store.
→ *Exit: a creator's upload survives a restart.*

**Done this round:** real Postgres running locally, migrations that apply exactly once, drift detection,
and `db/schema.sql` validated against a real server for the first time (28 tables — it had never been executed).

### Phase 2 — Identity
Real accounts: password hashing, sessions in Postgres, httpOnly cookies, email verification and password
reset (stubs until you supply SMTP), channel ownership checks on every route.
→ *Exit: someone can sign up, log in, and only touch their own channel.*

### Phase 3 — Security & hardening
`helmet`, rate limiting on auth and postback endpoints, CSRF, input validation, structured logging,
graceful shutdown, `/healthz` + `/readyz`, centralised error handling.
→ *Exit: it survives contact with the open internet.*

### Phase 4 — Deployment
Dockerfile, `.env.example`, migrations on boot (advisory-locked), CI that runs the tests, deploy docs for
Supabase + a host. → *Exit: `git push` produces a running app.* **Needs you: 5.**

### Phase 5 — Consent & legal *(BLOCKER for real ads)*
Cookie consent with granular purposes and blocking-before-consent, Google Consent Mode v2, GPC support,
ads.txt serving, privacy/terms/cookie pages.
→ *Exit: you may legally serve a personalised ad.* **Needs you: 1, 3, 4.**

> **A finding that changes the unlock model in the EEA:** consent must be *freely given*, and a user who
> refuses ad cookies cannot be shown a personalised rewarded ad. So "watch an ad to unlock" needs a
> defined behaviour for a refusing visitor. Contextual (non-personalised) ads are permitted without
> consent; that is the honest fallback. **Nepal has no such regime**, so this affects only EEA traffic —
> but the app needs to know which it is serving.

### Phase 6 — Ads that actually serve
Slot rendering for real provider tags (per-zone JS, per-slot IDs, link-rewrite for affiliate), the
house/fallback adapter, empty-slot behaviour, `ads.txt`, and the policy kill switch.
→ *Exit: component 4 stops being decoration.* **Needs you: 8.**

### Phase 7 — Product design
A real design system and a rebuilt storefront, asset page, dashboard and marketplace — informed by how
this category actually looks, which I have not yet done.
→ *Exit: it stops looking like a prototype.*

### Phase 8 — Operations
Pageview counting (component 7), plan/rent enforcement (8), moderation workflow (9), notifications (10),
listing scan (11), backups and monitoring.

---

## 4. Honest position on viability

**The engine is sound and unusually well-tested for its age.** The unlock path has verified failure
behaviour on forged, replayed, stale and cross-connection postbacks — most projects never test those.

**The product is not yet viable**, for reasons that are boring rather than deep:

1. It forgets everything on restart.
2. There is no login.
3. It looks like a prototype because it is one.
4. It cannot legally show an ad to a European visitor.
5. The slots serve no ads.

None of these are architectural. They are the work of phases 1–7.

**The one thing I'd flag as a genuine product risk, not a build risk:** ad-gated access works for content
worth roughly a rewarded video — templates, photos, presets, samples. For something worth NPR 5,000, it
would take thousands of ad views to match a single sale. Until `unlock_mode: 'paid'` ships, ByteBikri is a
content platform, not a place to sell products. That is a scoping decision for you, not a bug.
