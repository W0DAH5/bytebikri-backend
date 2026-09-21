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
| 1 | **Domain name** | Must be registered by you; ties into AdSense approval, ads.txt, and email. **Set `PUBLIC_BASE_URL` when you have it**: the ad-networks page builds every callback URL from it, and a URL a network cannot reach is a network that can never pay the creator. Until it is set the page says so in orange rather than quietly printing a localhost address | `PUBLIC_BASE_URL` |
| 2 | **Business entity + PAN/VAT** | Ad networks and payment rails require a legal entity to pay | Not code — paperwork |
| 3 | **Read the three legal drafts and accept them as the drafts they are** | Written, deployed and rendering at `/legal/privacy`, `/legal/terms`, `/legal/cookies`. They describe what the software actually does, which is the part I can guarantee. Whether they satisfy a jurisdiction is a lawyer's question, and only you can sign off as the operator | `/legal/*` |
| 4 | **Your legal name, address, contact email, and district** | The pages show a yellow warning listing exactly which of these are empty, because a privacy notice that does not say who is responsible is not one | `OPERATOR_LEGAL_NAME`, `OPERATOR_ADDRESS`, `OPERATOR_EMAIL`, `OPERATOR_DISTRICT` |

### To run for real

| # | What | Why it's you |
|---|---|---|
| 5 | **Supabase project** (or any Postgres URL) | I can't create your account. `DATABASE_URL` |
| 6 | **Storage** — Cloudflare R2 or S3 bucket + keys | Your media API decision. `STORAGE_*` env |
| 7 | **SMTP / email sender** (Resend, Postmark, SES) | Verification + password reset need a sender you own |
| 8 | **At least one ad network account** — start with BitLabs or Adsterra | Their signup is their KYC. You paste the callback secret |
| 9 | **Plan payment details** — bank/eSewa/Khalti/IME Pay to receive NPR | Platform revenue only; manual verification at your volume. Four variables, all optional: `PAY_ESEWA_ID`, `PAY_KHALTI_ID`, `PAY_IMEPAY_ID`, `PAY_BANK_ACCOUNT`. Until one is set the billing page says "not configured" and names the variable rather than showing a placeholder account |
| 9b | **`OPERATOR_EMAIL`** — the account that matches payments | Boot promotes it to `role = 'admin'`. It is the only path to operator, so it is a deploy decision, not a form. Sign up with that address first: an account boot creates has no password. Then `/admin/billing` is where an upgrade or a rent payment is matched against your statement |
| 10 | **Sentry DSN** (or equivalent) | Optional but you'll want it before real traffic |
| 10b | **`workflows` permission for the GitHub App**, or run one `cp` by hand | This is why CI lives in `ci/ci.yml` instead of `.github/workflows/`: GitHub refuses a push that creates a workflow file without that permission. `ci/README.md` has the one-line install | GitHub settings |

### Later, when they become the constraint

| # | What |
|---|---|
| 11 | Google Ad Manager / AdSense access (for Offerwall later) |
| 12 | CDN in front of media (R2 + Cloudflare does this) |
| 13 | A second ad network, for fallback when one has no fill |

**Total to launch: items 1–8.** Everything else I can build around.

Items 3 and 4 are no longer blockers in the "unstarted work" sense — the pages
exist and are deployed. What is left is you reading them and filling four
variables.

---

## 3. Release sequence

Each phase ends in something that runs. The "needs you" column is when you get
pulled in; everything else was done without waiting.

| Phase | State | Evidence in the repo |
|---|---|---|
| 1 · Persistence | **done** | 10 migrations, Postgres-only store, survives a restart |
| 2 · Identity | **done** | scrypt + sessions; `?as=` removed; dashboard 404s for anyone else |
| 3 · Hardening | **done** | helmet, CSP, rate limits, CSRF, secret policy, storage allowlist |
| 4 · Deployment | **done** | Dockerfile, render.yaml, fly.toml, CI, `DEPLOY.md` |
| 5 · Consent & legal | **drafted** | banner, records, `/legal/*` — **needs you: 1, 3, 4** |
| 6 · Ads that serve | **blocked** | the render layer needs one real network — **needs you: 8** |
| 7 · Product design | **in progress** | storefront rebuilt on the 8-pt scale; the player, the watermark and the honest per-platform protection copy shipped (`FEATURE_AUDIT.md`) |
| 8 · Operations | not started | moderation workflow, rent enforcement, backups |

### Phase 1 — Persistence ✅

Real Postgres, migrations that apply exactly once with checksum drift detection,
and the whole in-memory store replaced. **The upload survived a restart**, which
was the entire reason for the rewrite.

### Phase 2 — Identity ✅

scrypt with a self-describing parameter string, session tokens stored only as
SHA-256, lockout counted in the database, `burnPasswordTime` so a missing account
is not measurably faster to probe than a wrong password. The `?as=<email>`
parameter that let anyone read anyone's dashboard is gone and there is no
dev-mode replacement, because a flag is one misconfiguration from being a bypass.

### Phase 3 — Security & hardening ✅

Content-Security-Policy with `script-src 'self'`; cross-origin state changes
refused on `Sec-Fetch-Site` rather than `Origin`, because `Origin` is absent on
legitimate WebView and server-to-server requests; rate limits on login, signup,
unlock and postback; a storage key allowlist, because a key arrives from a URL and
a filesystem join on an unchecked key is how `../../` becomes a file read.

Fixed here: download links were bearer credentials and contradicted their own
copy about forwarding — they now require the session they were minted for. A
malformed uuid in a URL was a 500, so a provider would retry it forever; it is a
400 at the boundary now.

### Phase 4 — Deployment ✅

`Dockerfile` (multi-stage, non-root, tini as PID 1 so SIGTERM reaches the
graceful shutdown), `render.yaml`, `fly.toml`, CI against a real PostgreSQL, and
`DEPLOY.md`. Secrets no longer have production fallbacks: the app refuses to
start and names every missing variable at once. The sandbox ad network stops
resolving in production, because its signature is a shared secret in this
repository and its purpose is to mint an unlock without an ad.

**Needs you: 5.**

### Phase 5 — Consent & legal 📝

Banner with two equal-weight answers, no pre-ticked boxes, nothing set before an
answer, and records keyed to the version of the notice. **A refusal removes the
persistent identifier from what the ad network receives** — the point at which a
stored preference becomes a fact about what leaves the building. The behavioural
change was enforced in the unlock API and tested by watching what the network is
handed, not what the database stored.

Privacy, terms and cookie pages drafted from what the code actually does; the
operator fields render as a visible warning until filled in.

**Still outstanding, and it is not optional:** `ads.txt` needs a publisher ID
from a real network, and Consent Mode v2 signals need Google in the path. Both
arrive with Phase 6. **Needs you: 1, 3, 4.**

### Phase 6 — Ads that actually serve 🔒

The adapter layer verifies four networks and a store can connect one. Nothing
**renders** a creative yet, which is why unassigned slots are no longer drawn on
public pages — an empty box where an ad should be is worse than no box. This is
the one phase that cannot be finished without something only you can get: an
account with a real network. **Needs you: 8.**

### Phase 7 — Product design 🚧

Rebuilt on a three-layer token system, with contrast measured in tests rather
than asserted in a comment — the first run failed, on a caption colour at 3.31:1.
Storefronts now have a banner, listings have cover images, the landing page has a
hero, and the dashboard can publish a file with a cover and an access mode. Empty
"reserved" ad slots that pushed the actual files below the fold are gone from
public pages: unassigned slots are inventory, and inventory belongs on the
dashboard where the person selling it can see it.

**The revenue model, built.** Two charges, and the web now has both end to end:
a store upgrade (pro-rated to the period already paid for, renewal date
unmoved) and annual rent for the platform's one ad slot. Payment is a transfer
to an account listed on the billing page plus a reference an operator matches
against the statement — the only shape available to a Nepal-registered entity,
so the page explains the absence of a checkout instead of faking one. Every
money page states the two things bytebikri does **not** take: 0% of ad earnings
and nothing at all from content, which has no price.

**Also built:** store settings (name, tagline, about, banner, listing mode, ads
on/off), reviews keyed off unlocks with one seller reply each, single-asset
management (edit, pause, unlock terms), and search across listed stores and
their files.

**The slots, filled.** Rent is charged for one slot per page, and until this
round that slot rendered as an empty dashed box — when it rendered at all. Two
defects hid the entire ad surface: the allocator returned `state` while the
renderer read `serving` (so every storefront filtered its slots away), and the
rendered surface was derived from the slot *definition* rather than the caller
(so the two defs that support app and web were labelled `app_native` and dropped
by the web renderer — the rent slot itself). Both are fixed and both now have a
test.

What draws in a slot is split by owner: the store's own positions carry the
creator's message (`slot_creatives`, `src/creatives.js`), the platform's rent
slot carries the house creative, and a real network's tag is **never** stored —
a third-party tag is script, and rendering one from our origin would let an
un-audited network run code under our domain. The slot carries the seam
(`data-adapter`) for the adapter that will serve it. Copy the seller writes is
sanitised at write time (`javascript:`, `data:` and protocol-relative links are
refused with a reason) because a stored XSS in a tenant-written column runs on
our origin.

Placement is part of the model, not a styling choice: rank 1 sits at the top of
the page and the platform's slot goes last, so the ordering the slots page
describes is what a visitor sees. Owners manage the space at
`/dashboard/:slug/slots`, which previews every position with the real renderer.

**The motion pass.** Durations and easings are tokens now (M3's values via
Helix UI's set), so the whole product moves on one system: entrance decelerates,
exit accelerates and is shorter, hover animates transform and opacity only, and
section rhythm went to 64 px. The landing hero shows the product instead of
describing it — a framed window containing the actual money map, the same
structure the earnings page renders — with one primary call to action rather
than two competing ones. Reduced motion collapses every duration to 0.01 ms so
`animationend` still fires, and the scroll-driven reveals are behind
`@supports` + `no-preference`, because an animation must never be the only thing
that makes content appear.

**What "popular" means.** Explore has two rails with two questions. *Popular this
week* reads traffic, unlocks and breadth over thirty days and cannot read a plan —
the ranking function never receives one, so no price change can alter it.
*Featured* is Pro-only paid placement, labelled as paid wherever it appears, and
it renders below the earned rail while still holding a position the directory
does not give. A store that both earns and buys keeps one card and an honest pill
rather than two cards.

**Moderation has a mechanism.** `channels.moderation_state` is enforced:
`suspended` hides a store from every listing and returns 404 at its own address
while its owner still sees the whole dashboard and reads why, `removed` is a 404
indistinguishable from never having existed, and both refuse seller writes while
leaving reads open. A decision cites a `policy_rules` row (a real foreign key),
never a sentence; the operator's remedy line is the only free text and it is
capped at 280 characters and escaped. State change and record are one
transaction. The operator page is `/admin/moderation`, deliberately plain.
Still missing: a seller-facing report button, an asset-level queue, and country
rules.

**A browser, finally.** Chromium was not obtainable in this environment until
this round: `storage.googleapis.com` and `deb.debian.org` are unreachable and
`playwright install --with-deps` cannot apt anything. `@sparticuz/chromium` ships
its payload inside the npm package, so `/tmp/chromium` plus
`LD_LIBRARY_PATH=/tmp/al2023/lib` gives a working headless browser with zero `ldd`
misses. Every design change in this phase now gets screenshotted and measured
before it is called done. The first run found the reveal bug in §15 of the audit.

**Reports and the console.** Buyers can report a file (three **distinct**
reporters hide it, one never does; the count is a unique index, not arithmetic),
and operators have a real surface at `/admin`: overview KPIs, the transfer queue,
the report queue, the moderation queue, and the audit log. The operator never
sees who reported — asserted against the payload.

**The phone pass.** The navigation was `display: none` below 640px for several
rounds — on a phone the header offered no route to Explore at all, and nothing in
the suite noticed because every page still rendered. It is now a scrolling strip:
the brand and the account stay, the links take what is left and scroll. Tables
get a `min-width` and a scroll container rather than squeezed columns, hero
headroom halves, definition lists stack, and headings were already fluid at the
token level. `test/mobile.test.js` asserts the phone can still reach the
navigation, read a table and tap a control.

**Still to do:** a look at real storefronts in this category
rather than at my own reasoning; creative images (the column and the sanitiser
exist, the upload path does not). Rent is currently priced from an assumed RPM
and FX rate — the working is printed on the invoice, but it should read
provider-reported revenue instead.

### Phase 8 — Operations

Moderation workflow, backups, monitoring, notifications.

Rent enforcement is **done by policy rather than by dunning**, and it is worth
being explicit that this is a choice: the grace window is thirty days and
self-calculated (`effectivePlanCode`), nothing is deleted on expiry, and a
rejected payment leaves the seller's paid plan exactly as it was. There is no
automatic suspension to operate, because a cron job that failed to run must
never be the reason a paying seller loses their storefront.

What is left here: the moderation queue (schema has the states, no UI), a report
button, backups, and any notification at all.

---

## 4. Honest position on viability

**The engine is sound and unusually well-tested for its age.** The unlock path has verified failure
behaviour on forged, replayed, stale and cross-connection postbacks — most projects never test those.

**The product is not yet viable**, for reasons that are boring rather than deep.
Four of the five are now closed:

1. ~~It forgets everything on restart.~~ **Fixed** — Postgres, proven across a
   restart.
2. ~~There is no login.~~ **Fixed** — accounts, sessions, ownership checks.
3. ~~It looks like a prototype because it is one.~~ **Being fixed** — real token
   system, measured contrast, cover art, a publish flow. The honest remaining gap
   is that I designed it from first principles instead of from looking at what
   works in this category, and that shows most on the asset page.
4. ~~It cannot legally show an ad to a European visitor.~~ **Drafted** — consent
   is recorded, versioned, and enforced at the point where the ad network is
   handed an identifier. `ads.txt` and Consent Mode wait on a real network.
5. **The slots still serve no ads.** This one is not a build problem. It needs an
   account with a real network, and until it has one, ByteBikri is a file host
   with an advertising model attached to it.

**Tests went from 41 to 133** while this was being written, and they caught real
defects rather than confirming known ones: the faint text tier at 3.31:1, free
downloads refused because no entitlement row existed for content that never had
an ad, and a download route that threw on every asset page with a file attached.

The most useful thing in that number is not the count. It is that three of those
bugs were invisible to every check that existed before — one was a colour, one
was a missing row on a path nobody had exercised, one was a missing import on a
route with no test. Each is now something a machine checks.

**The one thing I'd flag as a genuine product risk, not a build risk:** ad-gated access works for content
worth roughly a rewarded video — templates, photos, presets, samples. For something worth NPR 5,000, it
would take thousands of ad views to match a single sale. Until `unlock_mode: 'paid'` ships, ByteBikri is a
content platform, not a place to sell products. That is a scoping decision for you, not a bug.
