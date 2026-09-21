# Feature audit — what exists, what is missing

Written by reading the repository and then running it, not from memory. Every
"done" below is a file you can open; every claim marked **verified** was checked
against the running server this round.

Three codebases live here and they are at very different stages:

| Codebase | Path | State |
|---|---|---|
| **Web app** (server + storefront) | `app/` | works, **152 tests**, running locally |
| **Android app** (Kotlin/Compose) | `android/` | **written against the real API now, never compiled** |
| **Old prototype** | `index.js`, `admin.js`, `middleware.js`, `prototype/`, `db/schema.sql` | dead code, superseded |

---

## 1. The headline finding (fixed this round)

**The Android app called an API the server does not have.**

It asked for `POST /api/signup`, `POST /api/signin`, `GET /api/assets`,
`POST /api/upload`, `GET /api/coins/{id}`, `POST /api/spend`,
`GET /api/admin/flagged`, `POST /api/admin/ban`, `POST /api/admin/unflag` and
`POST /api/admin/security-alert`. The server implements **none of them**. Both
files also hardcoded `https://your-replit-url.repl.co`.

Zero overlap. Not a porting problem — a different API, and the app could never
have signed in, listed anything, or unlocked anything.

Two of those endpoints also contradicted decisions already made: `/api/coins`
(coins parked) and `/api/spend` (there is no buyer↔seller payment). Both were
deleted from the client rather than implemented on the server.

**What was done:** the server grew the two endpoints an app actually needs —
`GET /api/stores/:slug` and `GET /api/content/:assetId` — using the same
visibility, unlock and signing rules the HTML pages use. `ApiService.kt` was
rewritten against them, and `app/test/android-contract.test.js` now extracts the
route literals from the Kotlin and fails the suite if the server lacks one. That
is the check this repository did not have, and its absence is why the mismatch
survived.

---

## 2. Media protection — the honest answer

There was **no media player anywhere**: no ExoPlayer, no `<video>`, no `<audio>`.
Gated files were served as `Content-Disposition: attachment`, or not at all.
"Non-downloadable, non-screenshotable" was not half-built; the feature it belongs
to did not exist.

What is actually achievable, from the research, because it decides what should be
built:

| Measure | Blocks download | Blocks screenshot | Verdict |
|---|---|---|---|
| `Content-Disposition: attachment` | no (it *is* a download) | no | the old behaviour |
| Signed, expiring, per-account URL | yes, for sharing | no | **implemented** |
| `blob:` + `controlsList="nodownload"` | hides the button and "Save as" | no | **implemented** (with `inline` playback) |
| Right-click / devtools blocking | no | no | implemented, labelled as deterrence |
| **Dynamic watermark** | no | no — makes a leak **traceable to an account** | **implemented** (burned into images, overlaid on video) |
| Widevine L3 (desktop browser DRM) | mostly | **no** | not built |
| Widevine L1 / FairPlay | yes | **effectively yes on compliant devices** | needs a DRM vendor and money |
| **Android `FLAG_SECURE`** | n/a | **yes — OS-enforced, incl. Android 14/15** | **set on every window** |
| Android 14+ `Activity.ScreenCaptureCallback` | n/a | reports screenshots | **implemented** |

The one-line version, and the version the product now prints on the page:

> **On the web, nothing prevents a screenshot.** Android can block its own
> windows. Everywhere else the achievable goal is traceability, not prevention.

---

## 3. The player, as built and verified

| Item | Where | Verified |
|---|---|---|
| `GET /api/content/:assetId/file/:fileId/stream` | `server.js` | full GET → `200`, `inline`, `video/mp4`, 85,263 B |
| HTTP Range | `rangeFor()` in `src/media.js` | `bytes=0-999` → `206 bytes 0-999/85263`; `bytes=-1024` → `206 84239-85262/85263`; `bytes=99999999-` → `416 bytes */85263`; `HEAD` → headers only |
| One authorisation function for stream and download | `resolveContentRequest()` | anonymous → `401`; another account's token → `403`; bad token → `403` |
| No download link for playable media | `views.js` file row | 0 `download` anchors on a video page |
| `controlsList`, PiP off, drag/right-click blocked | `views.js`, `app.js` | `controlslist="nodownload noplaybackrate noremoteplayback"` + `disablepictureinpicture` |
| Watermark, images | `watermarkImage()` | 1,400×933 sRGB JPEG in **199 ms**, six legible marks reading `BYTEBIKRI <ref>-<asset> <date>` |
| Watermark, video/audio | DOM overlay | same reference, drawn over the frames |
| Derivative cache | in memory, 64 MB LRU | a second fetch is a Map lookup; **nothing is written to disk** |
| Token lifetimes | `unlock.js` | download 10 min; playback 4 h so seeking works |
| Mark up to the client, not decided by it | `GET /api/content/:assetId` | returns `mark.label`, `mark.overlay` and `protection.screenshotsBlocked: false` |

**Why the two lifetimes differ:** a download is one round trip; a video seeks, and
each seek is another request. Ten minutes would have made a long video start
403-ing halfway through and look like a broken file. The token was never the
control — the route also requires a session and checks that the token was minted
for that account, so a forwarded URL is inert while it is valid.

---

## 4. Layout: balance, alignment, professional look

The research input, then what changed. Both matter — "it looks wrong" is only
fixable if you can say what rule it broke.

| Rule (from the layout research) | What the sheet did | Now |
|---|---|---|
| 8-point spacing scale; cards 24–32 px apart | 20 px gutters (`--space-5`) | `--space-6` (24 px) |
| Card minimum ~280 px | 260 px floor, so a title column was one word wide and every card broke over four lines | 280 px |
| Reserve space; one aspect ratio per set | 16/10 thumbnails, 16/9 stage | unchanged, and the stage keeps a video's own ratio instead of cropping it |
| Align titles across a row by truncating, not by patching heights | titles wrapped to 1 or 2 lines, so descriptions started at different heights | two-line clamp with a reserved two-line box |
| 16 px internal card padding | `--space-4` | already correct |
| One primary action per card | ✓ | unchanged |
| 44 px touch targets | ✓ | file badges are a fixed 44 px box |

Also fixed, because they read as unfinished rather than as design:

- **Ad slots printed internal vocabulary.** Every storefront and asset page said
  `rank 3 · reserved` — billing words on the shop floor. They now say
  *Advertisement / this space pays for the servers* or *From this store*.
- **The storefront said "3 files" three times** (header, section head, every
  card). Now: `3 items published · 7 views in the last 30 days` once, and the
  card footer keeps the per-item count.
- **Two badges on every card said the same thing** (a `Free`/`Ad-gated` pill and a
  🔒/✓ glyph). One is gone.
- **"Listed" / "Own address"** as a pill next to the store name became **"In
  Explore" / "Shared by link"**.
- **The unlocked note said "Permanent access" on a 24-hour unlock**, because it
  read an expiry off the asset rather than the viewer's entitlement. It now says
  `Access until 22 Sept, 14:03`.
- **`/marketplace` had a whole section that could never have content** ("Own
  address only"), fed by a query already filtered to listed stores. Removed —
  and it should not come back: a store that chose its own address is not
  published in a directory; that is what the choice means.

Verified after the pass: `/`, `/marketplace`, `/s/alice`, `/s/bob`, the three
legal pages, `/login`, `/signup`, `/healthz`, `/readyz` → **all 200**.

### The motion pass

The second design round, after the layout one. Where the first round fixed
geometry, this one fixes *feel* — and every decision below is a published rule
rather than taste.

| Decision | Source | Why |
|---|---|---|
| Duration and easing are tokens: 120 / 180 / 240 / 320 ms, and M3's four curves (standard `0.2,0,0,1`, decelerate `0.05,0.7,0.1,1`, accelerate `0.3,0,0.8,0.15`, spring `0.16,1,0.3,1`) | Material 3 motion tokens, via Helix UI's set | One place to change how the whole product moves. A raw `cubic-bezier` in a component is a curve nobody can find |
| Enter decelerates, exit accelerates, exit is shorter | M3's pairing rule | Things arriving settle; things leaving get out of the way |
| Hover/press 120 ms · panels 240 ms · page-level 320 ms · nothing over 500 ms | M3 duration bands | Over 500 ms reads as slow, and at that point it is not the curve |
| Hover animates `transform` and `opacity` only | classic compositor rule | A hover that animates height or padding relayouts the page under the pointer — that is the card-grid jitter |
| 44 px hit area on `(pointer: coarse)` | WCAG 2.5.8 / platform guidance | The 32 px small button is fine on a mouse and wrong under a thumb |
| Section rhythm 64 px, up from 48 px | practitioner consensus on the "janky page" problem — line-height ~1.5, ≤2 weights, 64–96 px section padding | A long page stops reading as a wall |
| One primary CTA in the hero, the second action demoted to a link | single-CTA pages convert at 13.5% vs 10.5% for 5+ (SaaSHero 2026) | Two equal buttons make the visitor choose; the choice is ours to make, not theirs |
| The hero shows the product: a window containing the real money map | Linear/Vercel/Stripe pattern; "real UI beats abstract illustration" is unanimous across the 2026 roundups | A screenshot removes doubt, and the money map is the one thing this product says that nobody else does |
| Sections rise as they enter, driven by `animation-timeline: view()` behind `@supports` + `no-preference` | scroll-triggered reveals, 2026 trend | No listeners, no layout reads, and where it is unsupported the content is simply visible — a decorative animation must never be what makes content appear |
| Reduced motion collapses durations to **0.01 ms**, not to `none` | Helix UI's approach | `animationend` and `transitionend` still fire, so components that clean up on those events are not left holding state |
| `@view-transition` for same-document navigation | browser-native, 4 lines | Cross-fade instead of a white flash, ignored where unsupported |

`test/design.test.js` (10 assertions) holds all of it: no raw curves outside the
token block, no `transition: all`, no hover that animates layout, no
browser-default easing keywords, the reduced-motion block complete, the counters
landing exactly on the rendered value, and the hero carrying exactly one primary
call to action. Two of them failed against the code as first written — the hero
had two primaries, and the scroll-driven block was written outside its guard.

### The phone

The layout research above is desktop-shaped, and that is the trap. Two failures
were found by reading the stylesheet rather than by looking at a browser, and
both were *absences* rather than ugliness:

- **The navigation was `display: none` below 640px.** On a phone — where most of
  this product's traffic is — the header had no route to Explore. Every page
  still rendered and every link still existed in the HTML, which is why nothing
  caught it. It is now a scrolling strip: brand and account stay put, the links
  take the remaining room and scroll horizontally, no JavaScript, one row.
- **Tables were squeezed, not scrolled.** `.panel { overflow: hidden }` clipped
  them and the columns crushed to two characters a line. They now get a
  `min-width` inside a scroll container, which is the honest fix: the alternative
  — one card per row — is a different information architecture, not a media
  query.

Also on small screens: hero headroom halves (80px is a third of a phone
viewport), definition lists stack (two columns of `auto 1fr` on a 320px screen
leaves the value column narrower than the labels), search becomes a column, and
the account caption goes while the control stays.

`test/mobile.test.js` (7) asserts what a small screen must still be able to DO —
reach the navigation, read a table, tap a control, see a heading that fits — and
it deliberately checks that nothing is revealed by hovering, because a phone
cannot hover.

### Template research, cited

- **Gumroad** — deliberately minimal storefront, consistent cards, zero design
  work for the seller; its marketplace fee is a discovery tax. Lesson taken: the
  card *is* the product page, so the card has to be clean before anything else.
- **Lemon Squeezy** — cleaner storefronts, no marketplace; a reported switch
  measured **2.8% → 9.6%** conversion. Lesson: layout quality is not decoration,
  it is conversion.
- Highest-leverage page elements: a real cover image as the first visual signal
  and the share thumbnail; a 2–4 minute walkthrough video (**+40–70%**
  conversion — the demo video asset exists now); two-tier pricing above $25
  (not applicable: no price); a **stated** refund policy (digital refunds
  typically <3%); **1–3 specific reviews** beat a high count of generic 5-star.
- Well-optimised pages convert **4–8%**; poor ones under 1%.

---

## 5. What is implemented (web)

| Feature | Where | State |
|---|---|---|
| Accounts: signup, signin, signout | `src/auth.js` | ✅ |
| Sessions: hashed tokens, TTL, revocation | `src/auth.js` | ✅ |
| Login throttling + lockout in the DB | `src/auth.js`, `login_attempts` | ✅ |
| Storefront: banner, cover art, aligned grid | `src/views.js` | ✅ |
| **Media player: video and audio, ranged, inline** | `server.js`, `views.js` | ✅ **new** |
| **Watermarking: burned in for images, overlaid on video** | `src/media.js` | ✅ **new** |
| **JSON API for a native client** | `GET /api/stores/:slug`, `GET /api/content/:assetId` | ✅ **new** |
| Free (open) and ad-gated assets | `unlock_mode` | ✅ |
| Rewarded-ad unlock via signed postback | `src/unlocks.js` | ✅ |
| 4 verified ad-network adapters | `src/providers/` | ✅ |
| Ad slot allocation + rent estimates | `src/slots.js` | ✅ |
| Plans, upgrades, manual plan payments | `store.js`, `plans` | ✅ |
| Consent: banner, records, versioning, enforcement | `src/consent.js` | ✅ |
| Legal: privacy, terms, cookies | `src/legal.js` | ✅ |
| Page-view counting | `page_view_daily` | ✅ |
| Dashboard: stats, slots, connect, publish | `src/views.js` | ✅ |
| **Billing: plans, pro-rated upgrade, payment rails** | `src/billing.js`, `/dashboard/:slug/billing` | ✅ **new** |
| **Annual rent: invoice, working shown, reference, match** | `rent_invoices`, migration 0011 | ✅ **new** |
| **Operator queue for matching money** | `/admin/billing`, `role = 'admin'` | ✅ **new** |
| **Store settings: name, tagline, about, banner, listing, ads** | `/dashboard/:slug/settings` | ✅ **new** |
| **Reviews: written only against an unlock, one reply each** | `reviews` table, asset + dashboard pages | ✅ **new** |
| **Single-asset management: edit, pause, unlock terms** | `/dashboard/:slug/assets/:id` | ✅ **new** |
| **Your files: every published file, its state, unlocks, and an Edit link** | dashboard overview | ✅ **new** |
| **Search: stores and files, listed stores only** | `store.search()`, `/marketplace?q=` | ✅ **new** |
| **Earnings: estimate vs statement, payout label, money map** | `src/earnings.js`, `/dashboard/:slug/earnings` | ✅ **new** |
| **Ad creatives: the store's own message, the house ad** | `src/creatives.js`, `slot_creatives` (0016) | ✅ **new** |
| **Slot placement: rank 1 at the top, the rent slot last** | `views.placeSlots` | ✅ **new** |
| **Ad networks: callback URL, secrets, health evidence** | `src/connections.js`, `/dashboard/:slug/networks` | ✅ **new** |
| Deploy: Docker, CI, config refusal | `Dockerfile`, `ci/` | ✅ |
| Moderation schema, per-country policy | migrations | 🟡 schema only, no workflow |

---

## 6. What is missing

### Stops a launch

| Missing | Why it matters |
|---|---|
| **Network tag render layer** | slots draw now — the store's own message and the house ad — and a network can be connected and verified. Serving a real network's *tag* still needs one real network account: we store no third-party script, and the slot carries only the seam (`data-adapter`) for the adapter that will mount it |
| **`ads.txt`** | ad networks require it; needs a publisher ID |
| **Password reset** | no way back into an account. Needs SMTP |
| **Email verification** | anyone can register any address |
| **Moderation workflow** | the states are enforced and the operator page exists (§14); still missing: a seller-facing report button, an asset-level queue, country rules |
| **A second app-facing auth path** | the app signs in through the web form; sign-up in the app needs a JSON endpoint or a WebView |

### Missing product surface

Built this round (see §10): billing and upgrade, annual rent with its working
shown, the operator matching queue, store settings, reviews keyed off unlocks,
single-asset management, and search.

| Missing | Note |
|---|---|
| Notifications | delegated in the model; nothing implemented |
| Refund/dispute flow | decided: harsh measures; no mechanism |
| KYC verification flow | schema exists, no upload, no review |
| Following a store | absent |
| Offline viewing (Android) | absent **on purpose**: a disk cache of unlocked media is a leak with a progress bar |
| Comments, replies between buyers | reviews only; a comment thread is a moderation load nobody has agreed to carry |
| Bulk asset operations | one file at a time; a seller with 200 files will want more |
| Analytics beyond the estimate | no per-asset view counts, no traffic sources in the UI |

### Missing infrastructure

| Missing | Note |
|---|---|
| Object storage | files on local disk; lost on redeploy unless a volume |
| Email driver | `EMAIL_DRIVER=console` |
| Error reporting | `SENTRY_DSN` reserved, not wired |
| Backups | none configured |
| Rate-limit store | in-process; resets on restart, per-instance |
| Instrumentation/metrics | `/healthz` only |

---

## 7. Android

Rewritten to talk to the real server: an in-memory session cookie, `GET
/api/stores/:slug`, `GET /api/content/:assetId`, `POST /api/unlock/start`,
`GET /api/unlock/status`, and media URLs the player re-signs with the cookie on
every range request.

Corrected:

- **`FLAG_SECURE` stays** — the one real control, now applied to every window.
- **The screen-recording check was wrong.** It looked for
  `Display.FLAG_PRESENTATION`, which means "this is a cast display" and is
  always false on a phone. Replaced with Android 14's
  `Activity.registerScreenCaptureCallback` — the actual API — and a documented
  no-op below API 34 rather than a guess.
- **Blocking the app after three "detections"** and calling
  `Process.killProcess` is gone. There was nothing being detected, and punishing
  a user for a screenshot of a file they unlocked is not security.
- **The alert endpoint** posted a device id to a dead Replit URL. Deleted.
- **`CacheManager` wrote unlocked media to `filesDir/media_cache`**, up to 500 MB.
  That is the "non-downloadable" failure performed by the app itself. Deleted
  with the wallet, admin, upload and settings screens that used it, plus the
  storage permissions and the FileProvider.

**Not verified:** there is no Android SDK in this environment. The Kotlin is
written and reviewed but never compiled, and `android/README.md` says so and
lists what to run before it can ship.

---

## 8. Dead code to remove

`index.js` (318 lines), `admin.js`, `middleware.js`, `schema.sql`,
`db/schema.sql`, `prototype/` — the pre-Postgres prototype. `app/` no longer
imports any of it. Left in place only because deleting files is a decision, not a
chore.

---

## 9. Tests

`npm test` → **295 pass, 0 fail** (133 eight rounds ago; 152 after the player
round; 184 after the revenue round; 214 after the slot round; 232 after the
connection round; 242 after the design pass; 256 after the Explore round; 272
after the moderation round; 280 after the console round; 293 after reports).

| New | What it holds still |
|---|---|
| `test/media.test.js` (12) | kind detection with MIME fallback; the label carries no identity and survives a quote; derivative keys cannot escape their directory; the overlay SVG cannot be made to emit markup; the full Range matrix and exact byte slices; the LRU's bound; and a real ImageMagick run asserting sRGB, dimensions, a visible mark, and a loud failure on a corrupt file |
| `test/ui.test.js` (+4) | the player is not a download with a label on it; the page never claims the web can stop a screenshot; every selector the client queries exists in a view; **every class the views emit has a CSS rule** |
| `test/android-contract.test.js` (3) | every endpoint the app calls exists server-side; the parked endpoints stay deleted; `FLAG_SECURE` is set, `FLAG_PRESENTATION` is not, and the app does not kill its own process |
| `test/billing.test.js` (23) | the two charges and nothing else; rent = monthly estimate × 12 with a zero floor; request-then-pay keeps the paid plan and the renewal date; a payment without an open request is refused; reject leaves the plan alone; matching twice is a no-op; grace is calculated, not stored; **and a write round-trip through every generated `SET` clause** |
| `test/ui.test.js` (+9) | the billing page states both charges and refuses a third; an unconfigured payment rail says so and names its env var; a pending upgrade never claims the plan changed; no rent invoice explains WHICH reason applies; settings cannot promise a free store the Explore listing; reviews appear only for a buyer with an unlock; the asset page is one form; the operator queue shows what was asked for; search replaces the directory |
| `test/earnings.test.js` (15) | an open period is shown but never compared; the estimate and the statement are never blended; rent is annualised against annualised statements; a blank payout label is not a label; **and `payout_accounts` is asserted to hold no column that could move money** |
| `test/design.test.js` (10) | motion lives in tokens and nowhere else; no `transition: all`; no hover that animates layout; reduced motion collapses to 0.01 ms so `animationend` still fires; scroll-driven reveals sit inside their `no-preference` guard; touch targets reach 44 px where the pointer is a finger; the hero has exactly one primary call to action; and **the landing page's money facts are the same strings the earnings page renders**, from the same structure |
| `test/networks.test.js` (18) | a network with no adapter has no Connect button and says what still works; the callback URL keeps the network's macros verbatim (a percent-encoded macro is a postback that never arrives); no secret means not verified; "never called back" names the likeliest cause; **and the only field the flow may ever ask for is the verification secret** — asserted against the rendered form, not the code |
| `test/reports.test.js` (15) | **one report never hides a file, and three distinct reporters do** — asserted as arithmetic and against the store, with the repeat attempt visible as `filed: false` rather than a second vote; the queue is one row per file and carries no reporter identity at all; resolving closes every open report while keeping the record; and the auto-hide is reversible *only* for a file the threshold hid, so a seller's own pause survives an operator dismissing a report |
| `test/mobile.test.js` (7) | the navigation is never `display: none` at any small width; the phone header keeps one row and scrolls its links instead; tables scroll rather than crush; the hero's spacing is halved and definitions stack; headings are fluid at the token level; nothing is revealed on hover, because a phone cannot hover |
| `test/moderation.test.js` (16) | **the code's vocabulary is read out of `pg_constraint` and compared with the schema's CHECK constraints** — a state the code can write but the database rejects fails here rather than at runtime; every state has behaviour and no state hides a store without telling its owner; a restriction must cite a real rule and `moderation_actions.rule_code` refuses a made-up one with 23503; the state change and the record are one transaction, so a failed decision leaves nothing behind; the remedy is the only free text, capped and flattened; the notice is escaped and rendered to the owner only |
| `test/ranking.test.js` (14) | the earned rail cannot read a plan — a Pro store with no traffic stays off it while a free store with traffic leads it; the paid rail is labelled as paid everywhere and never borrows the word "earned"; the score weights an unlock above a pageview; below 20 views a store is not "popular" at all; the rails are disjoint, a store that both earns and buys keeps one card and carries a pill instead of a second; and a store with no rows at all still gets a row from `channelStats`, because a store missing from the page is a store nobody can find |
| `test/creatives.test.js` (15) | the store's message can never fill the platform's slot or the reverse; a creative written for one slot does not leak into the others; `javascript:`, `data:` and protocol-relative links are refused; a link label with no link is dropped; one message per slot, corrected in place |

Two of the assertions above exist because the bug they describe shipped: the
billing page's "renewal date does not move" line had no code behind it for a
zero-length period, and `updateAsset` generated `set title = 2` from a missing
`$`. Both were found by writing the test, not by reading the code.

---

## 10. This round: the revenue model on the web

The model, stated once: **bytebikri charges two things — a store upgrade and
annual rent for the platform's one ad slot.** It takes **0% of ad earnings**,
there is **no price on content**, no commission, and no third charge anywhere in
the code. Content is unlocked with attention; the ad network pays the seller's
own account directly and bytebikri is not in that path.

### The two charges

| Charge | How it works | Where |
|---|---|---|
| Store upgrade | Pro-rated to the end of the period already paid for. Free 0 · Store 999 · Pro 2499 NPR. The renewal date does not move | `store.upgradeQuote`, `/dashboard/:slug/billing` |
| Annual rent | Twelve months of one slot's share of measured traffic, on the channel's own anniversary. Zero when the page is too short to spare a slot, or when the traffic did not arrive | `rent_invoices`, `annualRentNpr` |

### Payment is a transfer and a human, because there is no alternative

No acquirer settles to a Nepal-registered entity for this shape of business and
Stripe Connect is not available to one, so there is no card checkout to build.
The flow is: **request → pay into a listed account → submit the reference →
an operator matches it against the statement**. The migration comment for
`plan_payments` says it exactly: *a screenshot proves a transfer was initiated;
the statement proves it arrived.* The page says so too, rather than rendering a
checkout that cannot exist.

Rails are configured from the environment (`PAY_ESEWA_ID`, `PAY_KHALTI_ID`,
`PAY_IMEPAY_ID`, `PAY_BANK_ACCOUNT`). An unset rail renders as "not configured"
with the variable name, because the alternative — a placeholder account number
on a payment page — is how somebody sends money to a stranger.

### What was wrong before this round, and how it showed

| Defect | Consequence | Fix |
|---|---|---|
| `requestUpgrade` overwrote the subscription row | asking for Pro **dropped the seller to free**, and the pro-rated quote recomputed against Pro — NPR 2,499 instead of NPR 1,500 | migration 0012: the request lives in `pending_plan_code` and grants nothing |
| `subscriptions.period_end` was NOT NULL | a free store buying its first plan had no period to record | migration 0013: null means "nothing paid yet, full price due" |
| the dashboard filtered `plan_payments` by a `channel_id` that does not exist | every seller's payment history was silently empty | `planPaymentsOfChannel` joins through the subscription |
| `updateAsset` emitted `set title = 2` (no `$` in the template literal) | every save from the asset page failed with a 500 | fixed, and a round-trip test now covers every generated `SET` clause |
| `plan()` honoured a subscribed plan regardless of status | a cancelled or unpaid subscription still granted paid capability | `effectivePlanCode` reads the status, and calculates the 30-day grace instead of storing it |
| Store tier had `marketplace_listed: false` | a seller could pay NPR 999 and still be invisible — paying for capacity while the product's promise went unsold | migration 0014: Explore from the first paid tier up; featured placement stays Pro |

### Operator runbook

Set `OPERATOR_EMAIL` to the account that does the matching. Boot promotes that
account to `role = 'admin'` — the only path to operator, deliberately: there is
no route that grants the role, so becoming one is a deploy decision rather than
something somebody can post to. In development the account also gets the demo
password, so the flow can be walked end to end; in production it must sign up
first, because `DEMO_PASSWORD` is fatal there.

`/admin/billing` then shows two queues: upgrades waiting for a reference to be
matched, and rent outstanding. Matching an upgrade is the only action in the
system that changes what a seller has paid for.

### Still honest about the limits

- Rent is priced at an **assumed** RPM ($0.20) and an assumed FX rate (133), both
  shown on the invoice. Real provider-reported revenue exists per ad view
  (`ad_view_events.revenue_usd`) and could replace the assumption instead of
  sitting next to it.
- Grace is 30 days and self-calculated. Nothing is deleted on expiry.
- No dunning, no reminders, no receipts by email: notifications are delegated and
  unimplemented, so the seller sees their own state on their own billing page.

---

## 11. This round: the slot, and what fills it

The rent is charged for **one slot per page**, and until this round that slot
rendered as an empty dashed box labelled "Advertisement" — when it rendered at
all. Two defects made the whole ad surface invisible, and both were found by
looking at the rendered page rather than the code:

| Defect | Symptom | Cause |
|---|---|---|
| `allocateSlots` returned `state`, the render layer read `serving` | **No slot appeared on any page, ever.** The storefront filtered `slots.filter(s => s.serving)`, which is `undefined` for every slot, so the page had no ad space while the seller was charged rent for it | Two names for one fact; nothing asserted they agreed |
| `surface` was derived from the slot *definition*, not the caller | A def that supports both web and app (rank 1, the footer strip) was labelled `app_native` on every web page, so the web renderer dropped it — the rent slot was the one most likely to vanish | `slots.js` asked "does this def include app?" instead of "what is rendering this?" |

### The creative layer (`src/creatives.js`)

A slot now says whose space it is, and something draws in it:

- **The store's own slots** carry the creator's message — a headline, a line, a
  link. Their inventory, their voice, nobody paid.
- **The platform's rent slot** carries bytebikri's house creative when no network
  is serving it. This is the consideration for the rent: the space is used, not
  held, and a seller can see what their money bought.
- **A network's tag is never stored.** A third-party tag is script; keeping it in
  our database and rendering it from our origin would let a network we have not
  audited run code under our domain. The slot carries the seam
  (`data-adapter="<provider>"`), and the adapter serves the tag when there is an
  account. Until then a connected slot with nothing to show is not rendered at
  all — an empty box is worse than no box.
- **Copy the tenant controls is sanitised, not trusted**: `javascript:` and
  `data:` links are refused at write time with a reason, protocol-relative URLs
  are refused, plain `http:` is upgraded. A stored XSS in a column the seller
  writes would run on our origin.
- **Position is the product.** `placeSlots` puts rank 1 at the top of the page
  and the platform's slot last, so the ordering the slots page describes is the
  ordering a visitor sees. Rank 1 is never the platform's — by allocation
  (`allocateSlots`), not by policy.

### What a visitor now sees

| Page | Order |
|---|---|
| Storefront | header → the store's rank-1 message → the content grid → its remaining slots → the platform's advertisement |
| File page | header → the store's rank-1 message → what you get → the player → reviews → its remaining slots → the advertisement |

A store with nothing written shows no slot boxes at all: the storefront is not a
place for our empty inventory, and the seller manages the space on
`/dashboard/:slug/slots`, which renders every position with the real renderer as
its preview.

### Verified live this round

```
GET  /s/alice                     → 2 slots: the store's message, then the advertisement
GET  /s/alice/a/free-sample-pack  → the store's message above the fold, ad last
GET  /dashboard/alice/slots       → every position, the owner's empty-space note, forms
POST   …/slots  javascript: link  → ?error=link (refused at write, not silently dropped)
POST   …/slots  footer_native     → ?error=slot (the rent slot is not the seller's to fill)
POST   …/slots/clear              → creative deactivated, slot returns to empty
500 storefront hits               → rent invoice issued at NPR 36 → reference ESEWA-88213
                                    submitted → operator match → status paid
```

### Still open

- The house creative is one line of copy for every platform slot. A real ad
  server would rotate; a `rank` column exists for that and nothing more.
- A slot's height is reserved whether or not it renders, but only `max_height_px`
  is enforced — a creative taller than the slot is not yet possible, because the
  creative is copy and a link rather than an image.
- Images in creatives are allowed by the schema (`image_url`) and sanitised, but
  the upload path is not wired: a seller pasting a URL is the only way today.

---

## 12. This round: connecting a network, and proving it works

`/dashboard/:slug/networks`. The old surface was one button that POSTed to a
JSON endpoint, generated a random "secret", and hardcoded the callback base to
`http://127.0.0.1:3000` — so the URL a network had to call was a URL no network
could call.

| The flow | Why it is shaped this way |
|---|---|
| Sign up there in your own name → paste the callback URL → paste the secret their network signs with | The account is the creator's, and the money is paid to it. We never ask for a network login, a publisher id or an account number, and a test asserts the secret is the *only* field the flow can render |
| A network with no adapter is listed, with its payout facts, and gets no button | A connection we cannot verify can never grant an unlock. A button that lies is worse than a missing button |
| The callback URL is generated from the registry's dialect description | So the page cannot drift from the adapter that parses it. The macros (`{uid}`, `{tx}`) are left verbatim; everything else is encoded |
| Connected is not verified | A network whose callbacks are signed with a secret it issues starts `verifying` and stays there until the secret arrives. Only our own house network starts active, because we sign it |
| Every connection shows when it last called us and how often (thirty days) | "Connected and nothing unlocks" is the support ticket, and the evidence distinguishes a missing postback URL from a network that reconciles over days |

### Found and fixed while building it

- **Three rewarded networks were missing from the registry.** BitLabs, PubScale
  and AppLixir all had adapters, tests and dialects — and no registry entry, so
  they could not be selected, and a connection to one could not resolve a name.
  They are listed now, with `VERIFY` where we have not confirmed a number,
  because the registry's own convention is that a `VERIFY` beats an invented
  figure.
- **`ad_connection_events` had never been written by anything.** The table exists
  precisely because onboarding leaves the app and can fail halfway. Every state
  change writes a row now.
- **A connected network with no adapter reported "never called back"** — the
  wrong diagnosis for a network where no callback was ever possible. The status
  is derived with the adapter in hand, and says which half of the product still
  works: the earnings half, which never needed us.

### Also this round: the seller's files were an island

`assetManage` — the single-asset page built last round — had **no link to it
anywhere**. A seller could publish a file and could never reach the page that
edits it without typing the URL. Two links close it: a *Your files* table on the
dashboard overview (title, access, state, unlocks, Edit) and an *Edit this file*
button on the public page, shown only to the store's owner. `assetStats` counts
files and unlocks per asset in two correlated subqueries rather than a join that
would either multiply rows or need a `DISTINCT` hiding the count it exists to
show.

### Verified live

```
GET  /dashboard/alice/networks            → 200, three connected, 22 listed
POST /dashboard/alice/networks (bitlabs)  → 302, status verifying, no secret yet
POST …/bitlabs/secret  'ab'               → 302 error=secret  (too short, not saved)
POST …/bitlabs/secret  '<32 chars>'       → 302 ?saved=1, status active
GET  the page again                       → callback URL with {uid}/{tx}/{s1} intact
```

---

## 13. What "popular" means, and what money can buy

The Explore page is the one surface where a marketplace can quietly lie. Two
orderings were merged into one "top sellers" rail — traffic and a plan flag —
and nobody could tell which a given store was in.

They are now two rails with two questions, and the difference is structural
rather than editorial:

| Rail | Question it answers | What it reads | What it cannot read |
|---|---|---|---|
| **Popular this week** | What did people actually do here? | pageviews and non-revoked unlocks over thirty days, plus how much there is to unlock | `plan_code`. The function does not receive it, so no schedule of prices can change the ranking |
| **Featured** | What bought a position? | `canFeature(channel)`, evaluated in the route, not in the ranking | traffic. Ordering inside the rail is by attention, but membership is bought |

The weights are stated in `src/ranking.js` and asserted in `test/ranking.test.js`:
**pageviews ×1, unlocks ×8, items ×3**. An unlock outweighs eight pageviews
because an unlock cost the viewer a rewarded ad — it is the only unambiguous
evidence the platform has that somebody wanted the file, and the whole product is
built on that transaction. Below **20 views in thirty days** nothing is
"popular"; below that the ranking is noise, and a front page that shows noise to
its first visitors teaches them not to return.

Three further decisions, all of them visible on the page:

- **The earned rail renders first**, with the paid rail below it and the full
  directory underneath. That order is the product statement: the front page leads
  with what people did.
- **A store that both earns and buys appears once**, in the earned rail, carrying
  an "Also featured (paid)" pill. Its placement never vanishes silently, and it
  does not get a second card to say so.
- **Every gate the page offers says why it is showing what it is showing** —
  `240 views and 3 unlocks in thirty days` is a sentence a visitor can check,
  which a ranking position is not.

`store.channelStats()` is one query with two lateral aggregates, not a loop: the
front page is the most-visited page in a marketplace and it must not cost one
round trip per store. It returns a row for every store, zeros included — a store
missing from the directory is a store nobody can find.

---

## 14. The moderation state, and who it serves

`channels.moderation_state` has existed since migration 0001 and nothing ever
wrote to it, which made it look like decoration. It is the one place a store can
be stopped, and the interesting decisions are not about stopping — they are about
what the store's OWNER sees while it is stopped.

The vocabulary is the schema's, not this file's. `channels.moderation_state` is
`pending | approved | restricted | suspended | removed` and
`moderation_actions.action` is `approve | restrict | remove | suspend | reinstate
| warn`; both are CHECK constraints, and `test/moderation.test.js` reads them out
of `pg_constraint` and fails if `src/moderation.js` ever drifts from them. A
CHECK constraint and the code that writes to it do not fail loudly — they fail
later, at runtime, on a store that needed stopping.

| State | Public | Owner | Writes | Owner is told |
|---|---|---|---|---|
| `pending` | shown | normal | allowed | nothing. It exists in the schema and is reachable; sign-up writes `approved`, and nothing is reviewed before it appears |
| `approved` | shown | normal | allowed | nothing |
| `restricted` | shown — the files are not the problem | normal | allowed | what is restricted, and that publishing still works |
| `suspended` | **hidden from every listing, 404 at its own address** | full dashboard, banner at the top | refused | that nothing was deleted, and that every page still reads |
| `removed` | 404, indistinguishable from a store that never existed | full dashboard, banner | refused | that the record and the files are still there |

Four rules, each a promise rather than a permission check:

- **A decision cites a rule, not a sentence.** The reasons are rows in
  `policy_rules` — nine seeded (copyright, malware, counterfeit, financial_scam,
  personal_data, weapons, gambling, adult, health_claims) — and
  `moderation_actions.rule_code` is a foreign key to them. A made-up code is
  refused by the database: the test asserts the 23503 rather than trusting the
  form to have been honest.
- **The charge's wording is the policy table's.** The seller reads the rule's own
  title and description plus the operator's remedy line, so what was decided and
  what it is called cannot drift apart — and no sentence an operator types is
  ever the reason on its own.
- **Every decision records who, when and what**, in the same transaction as the
  state change. A store that vanishes with no record is indistinguishable from a
  bug, and the seller is the one who has to argue about it.
- **Only restrictions need a rule.** `reinstate` and `approve` do not, because
  demanding a code to *clear* a charge is how a reinstatement ends up citing the
  charge it cleared.

Reads stay open while a store is suspended: the owner sees the dashboard, the
files and the history, an operator sees what they are deciding about. Publishing,
editing, filling a slot, connecting a network and paying rent all stop. Letting a
seller publish into a storefront nobody can reach would be the cruellest version
of this feature.

The operator page at `/admin/moderation` exists because a mechanism nobody can
invoke is the same problem as a column nobody sets. It is plain on purpose and it
is **not** a report queue: nothing in it says which store to look at, because a
seller-facing report button is a separate feature with its own design. Still
missing: that report button, an asset-level queue, and country rules
(`policy_rules.scope = 'country'` is modelled and unused).

Verified live: a bogus rule code came back `?error=rule`, a suspension with no
rule came back `?error=reason`, a real one saved; `/s/bob` then answered **404 to
a stranger, 200 to its owner**, disappeared from Explore, showed the owner the
rule and the remedy on both the storefront and the dashboard, refused a slot
write with `?error=moderated`, and still served the earnings page. A reinstate
put it back, and the queue returned to "Nothing is waiting".

---

## 15. What a real browser said (and how this got caught)

The reveal animation added in §4 shipped broken, and the failure is worth
recording because of *how* it passed every check.

`animation-timeline: view()` with `animation-fill-mode: both` holds the
keyframe's `from` state — `opacity: 0` — for every element whose scroll range has
not been reached yet, and Chrome resolves the timeline late enough that it applies
on load. `/dashboard/alice` rendered **3588px tall with ~2900px of blank space**:
the layout was there, the content was invisible. Every test passed, because every
test read the CSS text.

There is now a headless browser in this workspace (see below), and the first
thing it produced was the measurement above. The fix is structural rather than a
tuned range:

- **the default state is visible.** Nothing in the stylesheet hides anything on
  its own. One inline script in `<head>` adds `reveal-ready` to `<html>`, and only
  when the visitor has not asked for reduced motion. No JavaScript, no hiding.
- **an IntersectionObserver** makes the transition, and **a two-second timer
  un-hides everything regardless** of what the observer did. A stuck invisible
  section is the one failure this must not be able to produce, so it is not left
  to a callback.
- **the hero still animates on load** — that is finite and time-based — but with
  `backwards` rather than `both`, so nothing is held in a hidden final state.

`test/design.test.js` now asserts the bug rather than the feature three ways: no
`animation-timeline: view()` anywhere, no `animation: … both` on a regular
element (`::view-transition-*` excepted, since those are removed from the tree
after the cross-fade), and a safety timer in the client.

### Two more things the browser found

**A money figure you could not read.** `--emerald-300` on the hero's money map is
1.47:1 on the light theme — a dark-theme primitive used on a white surface. The
light theme already had the right token (`--success-text: #047857`); the new CSS
had reached past the semantic layer. `test/design.test.js` now fails on any
`var(--gray|indigo|violet|emerald|amber|rose|sky|slate-NNN)` in component CSS,
and asserts that every themed token is defined in **both** themes.

**The light theme earned its depth from nothing.** `--border-subtle: #e2e5ec` on
`#fff` is a 1.09:1 edge: present in the source, invisible on the screen. The page
now sits at `#f4f5f9` and the borders are a step stronger, which is what makes a
card read as raised without a heavy shadow.

### The browser, and why it matters for the next round

Chromium cannot be downloaded in this sandbox (`storage.googleapis.com` and
`deb.debian.org` are both unreachable, and `playwright install --with-deps` cannot
apt anything). `@sparticuz/chromium` **does** download from the npm registry, and
its brotli payloads decompress to a working binary plus a bundled `lib/` — zero
`ldd` misses against Debian 12. So:

```
/tmp/chromium                     the browser
LD_LIBRARY_PATH=/tmp/al2023/lib   its libraries
/tmp/pw/shot.mjs                  full-page screenshot + overflow/opacity diagnostics
/tmp/pw/probe.mjs                 three scroll positions, light and dark
/tmp/pw/contrast.mjs              computed-contrast audit per text node
/tmp/pw/console.mjs               signed in as the operator, console pages
```

Every future design change gets run through these before it is called done.
Reading the CSS is not evidence.

---

## 16. The console: an operator surface, and the report flow that feeds it

There was no operator surface. `/admin/billing` was a page with two tables on it,
linked from the navigation as "Billing queue", and that was the whole of it —
while the schema carried `audit_logs`, `moderation_actions` and nine policy
rules, and the **Android app carried `flagged_assets`, a ban action and an audit
endpoint** that the web had never had. (`admin.js` + `PROJECT_ANALYSIS.md` in the
old Supabase prototype: `flagged`, `banned`, `flagged_assets`, `audit_logs`.)
That is the reference this round was built against, and it was expanded well past
what the app had.

### The console

`/admin` — five KPI tiles, then the queues with their counts, then how the
platform earns, then the audit feed. The layout is the research: **inverted
pyramid**, an equal-tile row, and — on this surface more than anywhere —
**status never carried by colour alone**. Every tile has a word in it.

Four pages, one shell, four counts that come from `consoleCounts()` so a badge on
the navigation can never disagree with the number on the page it points at:

| Page | What it is |
|---|---|
| `/admin` | the overview: matched money, reports waiting, stores not public, paying stores, reach |
| `/admin/payments` | the transfer queue (was `/admin/billing`, which redirects; the old POST paths answer 307) |
| `/admin/reports` | the report queue, one row per file, ordered by risk |
| `/admin/moderation` | the state queue from §14 |
| `/admin/audit` | the log with an action filter |

`store.platformMoney()` reads the same tables the seller's billing page reads, so
the console cannot claim money the ledger does not show.

### The report flow

| Rule | Why |
|---|---|
| **One report never hides a file. Three distinct reporters do.** | A single-report takedown is a competitor weapon. `AUTO_HIDE_AFTER = 3`, from the trust-and-safety literature |
| **Distinct, because the unique index says so** — `(asset_id, reporter_id)` | Otherwise the threshold is three clicks from anyone with three accounts |
| **2 distinct escalates, 3 hides** | The queue is ordered by risk, so two gets a person sooner without touching the file |
| **The reason is a `policy_rules` code** | Same rule as moderation; the reporter's words are a hint in `note`, capped at 400, never the charge |
| **The operator never sees who reported** | A queue that names complainants is a harassment tool. Asserted against the payload, not just the view |
| **Hiding is reversible, and only for what the threshold hid** | `assets.hidden_by_reports` (0018). Dismissing the reports gives the file back; a file its *seller* paused stays paused |

Verified live end to end: three accounts (bob, dave, erin) reported alice's
`Free sample pack` → after the third, the asset went `live → paused`, the queue
showed **3** with the reporter's notes and no names, and the nav badge read 3.

**Still missing:** a seller appeal surface (the operator can dismiss, the seller
cannot ask), a report on a whole store rather than a file, rate limiting on the
report endpoint, and country rules (`policy_rules.scope = 'country'` is modelled
and unused).

---

## 15. Looking at the pages, and what it found

Four rounds of CSS were written and none of them had ever been looked at. Every
assertion in the suite reads the stylesheet as text; "balance, alignment,
positioning" cannot be argued about with a text diff, and the one time the site
was inspected in a browser the answer was that the layout had gone haywire.

So there is a browser now, and two tools that use it.

### Getting one

`storage.googleapis.com` and `deb.debian.org` are both unreachable here, so
neither Playwright's own download nor `apt-get` can produce a Chromium.
`@sparticuz/chromium` ships its payload inside the npm package, which works — but
its binary needs `libnss3`, `libnssutil3` and `libnspr4`, and the base image has
none of them. They were built from source (`mozilla/nspr` plus nss-dev's
`build.sh`, which needs `gyp` and `ninja` from pip) into `/tmp/dist/Release/lib`.

Both scripts set `LD_LIBRARY_PATH` themselves. On a normal machine with a normal
package manager, none of that is necessary: `apt-get install chromium` and
`npx playwright install chromium` both do the right thing.

### `npm run shots` — look at it

`scripts/shoot.mjs`. Real browser, real viewport, PNG per page, with
`--cookies`, `--theme`, `--w` and `--full`. It also reports horizontal overflow
and semi-transparent blocks, which is how two of the bugs below were found before
a screenshot was even opened.

### `npm run audit:visual` — measure it

`scripts/audit.mjs`. Every page at 1280, 834 and 390, checking the things that
actually read as broken: an element wider than the viewport, a document that
scrolls sideways, a vertical hole over 220px inside the content column, boxes
covering each other, grid items on one row with different tops, type under 11px,
lines over 95 characters, and text under 4.5:1 against its own background.

The first version of the alignment check was wrong and reported 48 findings that
were not there — it treated a vertical stack (a label above its value) as a row
that had to share a top. It now requires a genuinely multi-column grid and
horizontally overlapping items, and the entire report is 2 findings.

### What it found

| Finding | Why it read as broken |
|---|---|
| **An empty ad slot was rendered to visitors** | The store's own slot is rank 1 — the first thing a visitor sees, by design. With no creative it was a 250px box saying *"Alice has not put a message here yet"*, pushing the files below the fold. Now an empty space the store owns is not rendered to a visitor at all; the owner sees a compact dashed prompt instead, with no reserved height |
| **The phone table rule widened the document** | `.table { min-width: 520px }` was written for tables inside `.panel`, where the container scrolls. The legal pages put tables in prose, so the whole document became 540px wide on a 390px phone and every paragraph moved under a reader's thumb. The floor is now scoped to a scrolling container, and `.prose table` scrolls itself |
| **The phone header clipped a link** | The first fix for "the nav is hidden below 640px" made the links a horizontally scrolling strip, and the screenshot showed `Explore · Da…`. A clipped label is worse than a tall header. Two rows now: brand and account above, navigation below, every label whole |
| **Legal prose had no measure** | 1120px of column, about 120 characters a line, twice what a paragraph is read at |
| **Small print had no measure** | The legend under the hero's product window ran to 168 characters per line |
| **A slot call-to-action at 4.16:1** | Under the 4.5 the rest of the sheet holds to, on the one label that should not be the hardest thing to read |
| **The reveal animation was inert in one place and over-broad in another** | See below |

### The reveal, settled

`animation-timeline: view()` with `fill-mode: both` was holding `opacity: 0` for
anything whose scroll range had not been reached, and Chrome applies that
timeline on load. That is what "everything went haywire" was. It is deleted
outright, with the reasoning left in the stylesheet so it does not come back.

What replaced it is a client-driven reveal whose **default state is visible**: an
inline script adds `reveal-ready` only when the page asks for it and motion is
welcome, an IntersectionObserver adds the transition as elements arrive, and a
two-second timer reveals everything regardless. A section that stays invisible
because a callback did not fire is the one failure this must not be able to
produce, so it is not left to a callback.

It is also **scoped to the marketing surfaces**. A dashboard is a tool: its
panels and tables are what the person came for, and fading them in while they
scroll reads as the interface being slow. The storefront and Explore get it;
every signed-in page does not.

### And one from the app

`/admin/users`. The Android app has had `fetchFlaggedAssets`, `banUser` and
`unflagAsset` since its first schema, and `admin.js` has always said the
`/api/admin/*` routes do not exist — because they did not. The red **Ban User**
button in the app had never once worked.

The file half (reports) and the store half (`moderation_state`) were built; the
person was missing. A ban is now a real mechanism and it is deliberately not the
same thing as hiding a store: `profiles.banned` is the flag the public reads
already filter on, every live session is revoked in the same transaction as the
flag, and **the login route refuses a banned account** — which was the actual
hole, because it previously let a suspended person sign in and then silently
failed to resolve their session, leaving them holding a cookie and a signed-out
page with no explanation.

Nothing is deleted. Reinstating restores everything, and the ban stays on the
record.

Verified live: suspend → sign-in **403** with a sentence, the old cookie **302**
to sign-in, `/s/bob` **404 to a stranger and to its own owner**, out of Explore
and out of search, `moderation_actions` row citing `financial_scam`; reinstate →
sign-in works, storefront 200, back in Explore.
