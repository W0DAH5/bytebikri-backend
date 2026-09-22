# Feature audit — what exists, what is missing

Written by reading the repository and then running it, not from memory. Every
"done" below is a file you can open; every claim marked **verified** was checked
against the running server this round.

Three codebases live here and they are at very different stages:

| Codebase | Path | State |
|---|---|---|
| **Web app** (server + storefront) | `app/` | works, **456 tests**, running locally |
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
| **A mail sender on a domain we own** | both flows that need mail are built and tested (§18): password reset and address confirmation. Production refuses to boot on `EMAIL_DRIVER=console` or with no driver, so the last thing between this and sending anything is `EMAIL_DRIVER=resend`/`smtp` plus an `EMAIL_FROM` on a domain you control |
| **Moderation workflow** | the states are enforced, the operator page exists (§14), the seller can answer a report-driven hiding (§14a), a file has its own queue and its own country rules (§19), and a new store's first file now genuinely waits for a person (§20). Still missing: nothing that blocks a launch — the country list is the edge's, and a whole-store legal takedown is still expressed as a block per country |
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
| `test/android-contract.test.js` (4) | every endpoint the app calls exists server-side; the parked endpoints stay deleted; `FLAG_SECURE` is set, `FLAG_PRESENTATION` is not, and the app does not kill its own process; **a refusal is legible to the client** — the server sends `unlockable`, `unavailableFor` and a typed 451/403 wherever it refuses, and the client parses exactly those fields (both halves, because a contract tested on one side is a contract nobody completed) |
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
seller-facing report button is a separate feature with its own design. The
seller-facing report button and the appeal surface it feeds are both built
(§14a), and the asset-level queue and country rules this paragraph used to list
as missing are built too — §19 is that half, and `policy_rules.scope = 'country'`
is what a country block cites.

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

### 14a. The seller's side of a hiding, and what building it exposed

The operator could dismiss a report. The seller could not answer one, and worse,
could not tell a report-driven hiding from the pause they had chosen themselves:
both read **"Paused"**, with no reason and nothing to click. `asset_appeals`
(0021) gives the seller one written answer per hiding, which lands in a queue on
`/admin/reports` above the reports; `/admin/appeals/:id` upholds or declines it,
and a decline must carry a line for the seller, because a decline that records
nothing rebuilds exactly the silence the feature exists to end.

Building it turned up four things that were wrong and are now fixed:

| Found | Fix |
| **A report-hidden file was public at its own URL** — the storefront grid and Explore dropped it, the file page never looked at `status`, and it rendered title, description and an unlock button. An `ad_gated` file was unlockable again via the real postback; an `open` file was auto-granted an unlock on first fetch. "Hidden while it is reviewed" was false at the one URL every report and share carries | `maySeeHiddenFile` (owner, operator, or an unlock earned while it was live) on the page; the auto-grant and the ad postback both refuse a file that is not live — except a view that *started* before the hide, because that ad already paid the creator |
| **Two clicks from the seller un-hid their own file**: any status the seller saved cleared `hidden_by_reports`, so "Paused → Live → Save" made a reported file public again and the appeal form beside it was theatre | While the threshold is hiding a file, the platform owns its state: the select is disabled, the patch ignores `status`, and every other field still saves |
| **A paused file disappeared from its owner's dashboard** (`assetsOf` is the public list, live-only), so the appeal page had no route to it at all | `assetsForOwner` (live + paused) feeds the owner's table; the public list is untouched. The row names who acted — "Hidden after reports" vs "Paused by you" — and links straight to the answer |
| **Declining an appeal was impossible**: two forms, the note field in one of them, so every decline posted an empty note and hit the validation | One form, two named submit buttons, one shared note |

Rate limiting on the report endpoint is also in: six an hour per account and per
address. It does not fix the arithmetic that three throwaway accounts still hide
a file — nothing client-side can — but one account can no longer be the whole
attack, and a looping client is bounded.

**Still missing:** a report on a whole store rather than a file, an asset-level
moderation queue distinct from the report queue, and country rules
(`policy_rules.scope = 'country'` is modelled and unused). *The last two landed in
§19; a report on a store is still a report on the files in it, which is the
honest shape of the same complaint.*

---

## 17. Looking at the pages, and what it found

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

---

## 18. This round: getting back in, and proving an address

Two gaps that were on the launch list for the same reason: both are about an
address being real. A forgotten password had no way back, and anybody could type
any address into the sign-up form and we would treat it as theirs.

### The mail layer

`src/email.js`. **The row is written before the send is attempted**, always, so
"we said we sent it" and "it left" are different facts and the second one is
recorded rather than assumed: `outbound_emails` carries the kind, the address,
the subject, the text, which driver carried it, whether it delivered, and the
provider's error if it did not. Three drivers — `console` (prints, delivers
nothing, the development default), `resend`, `smtp` — and the config refuses to
start in production on `console` or with no driver at all, because a server that
looks healthy while every reset link goes to a log file is worse than one that
refuses to boot.

### A link is one object

Migration 0023 replaced `password_resets` with `email_tokens` and a `kind`. Two
tables with identical columns drift: one gets the fix for the resend race and the
other does not. The "one live link" rule is unique on `(user_id, kind)` — per
kind, so a pending confirmation cannot silently cancel the password reset somebody
is waiting for.

Four rules, each from something that goes wrong without it:

| Rule | What it prevents |
|---|---|
| Only the sha256 is stored | a leaked dump is boring; the token is in the mail and the URL, nowhere else |
| One live link per (user, kind) | a forwarded or stale email stops working the moment a new one is asked for |
| Spending is a single guarded `UPDATE` | two simultaneous clicks cannot both succeed, and a rejected attempt does not consume the link |
| A resend inside 10 minutes does not mint a new token | the loop where asking again kills the link that is arriving right now, so the person asks again — the bug is real and has a fix upstream |

The last one has exactly one exception, and it is the reason the rule looks at the
mail log rather than at a clock: **if the last message was recorded as failed,
there is no link in anybody's inbox, so a fresh one goes out immediately.** Telling
somebody whose mail bounced to wait ten minutes would be the rule protecting
nothing.

### Reset

60 minutes, single-use, "one page for four reasons" for every dead link, and
success ends every session. The request form answers identically whether or not
the address has an account, because a form that says "no such account" is a way
to test which addresses belong to people here.

### Confirmation

48 hours, single-use, soft in a specific and deliberate way. It does **not** block
sign-in, browsing, publishing, unlocking, or the store staying live. It gates
exactly one thing: **submitting a payment reference**, for a plan upgrade or for
rent. Both are matched by hand against a bank or wallet statement and the receipt
goes to the address on file, so an unconfirmed address means money arrives with no
way to tell whose it is. The billing page replaces the submit form with the reason
and leaves everything else — the amount, the account numbers, the working — exactly
where it was, because the seller still has to be able to send it.

Two details that are easy to get wrong and were not:

- **The GET does not confirm.** Mail providers, security scanners and link-preview
  bots fetch every URL in a message. A GET that spent the token would confirm
  addresses no person ever opened — silently, in a way that looks like success.
  So the link opens a page with one button, the form posts to its own URL, and the
  token appears nowhere in the markup.
- **Changing an address mails the new one and tells the old one**, always, even if
  the new send fails. The old address is the only channel that still belongs to the
  previous owner, and that notice is the only warning they will ever get.

### Operator surfaces

`/admin/users/<id>` answers the support question the phone call brings — *"I
signed up and the email never came"* — with the address state, how many links went
out, and whether any message actually failed, plus a button that sends the link on
the person's behalf (same window, same reuse rules; it cannot confirm anything by
itself). `/admin` gained one fact row: confirmation links sent and addresses
confirmed in 30 days, and a queue row that appears **only** when mail failed to
send, because a queue that reads "0" every day is how an operator learns to skim
past the one that matters.

Verified live, not just in the suite: sign-up → strip under the header → link in
the log → `200` on the button page → **token in the markup: 0** → `POST` →
"Address confirmed" → strip gone; and the gate, refused with `?error=verify`
before confirmation and accepted after it.

---

## 19. This round: a file, a country, and the page that explains it

`asset_country_rules` and `content_geo_blocks` were in migration 0001 and read by
nobody, so every file was available in every country. Worse, a file could not be
stopped at all: `assets.moderation_state` existed, but the only surface that
wrote a state wrote it to a **store** — which is why hiding a store hid every
file in it, including the ones whose own state had never been decided.

So this round is the other half of §14: the file as the thing that is moderated,
and the country as a second axis that is not the same axis.

### A file's vocabulary is not a store's

`assets.moderation_state` is `pending | approved | restricted | removed` — read
out of `pg_constraint` by the tests and matched by `src/moderation.js`. There is
no `suspended` for a file, on purpose: suspending is what a store does (it stops
writes and keeps the shop reachable to its owner while a question is settled),
and a file has no writes to stop. `pending` is answered in §20 — for two rounds it
was a state nothing could reach. The operator page **refuses** `suspend` with
`?error=action` rather than silently mapping it to the nearest thing, because a
mapping that quiet is a decision nobody made.

`restricted` is the interesting one, and it is not a softer `removed`: the file
stays listed and stops being unlockable. It is how a licence problem, a pending
question, or a country limitation reads to a visitor, and it is the only state
where the listing and the bytes disagree.

### Two people can write a country rule, and they are not the same writer

| | may set | cites a rule | may clear |
|---|---|---|---|
| Operator | `blocked`, `restricted`, `allowed` | required for the first two; forbidden on `allowed` | any row |
| Creator | `blocked`, `restricted` | never — the note is theirs, and it is private | own rows only |

`allowed` is the operator's alone because it is the carve-out: a store can be
withheld from a country for a policy reason while one file in it is a public-
domain text that the same rule has no business hiding. A creator who could say
`allowed` could override the platform's own rule, and the disagreement they
actually have is the appeal — which a person reads.

The first version of this shipped with the creator's route reusing the
operator's validator, and the bug ran in both directions at once: a creator could
not set **any** rule (the validator demanded a rule code they must not cite), and
`state=allowed` was **accepted** if they sent it. `validateCountryDecision({
states, requireRule })` now takes both from the caller, and `CREATOR_COUNTRY_STATES`
is the creator's list. Retested live: blocked in the UK → saved; a UK visitor
gets **403**; `allowed` → `?error=state`; clearing an operator's row → `?error=nope`.

### Resolution, and the two questions the read paths ask

`availabilityFor({ assetState, resolved })` answers exactly:

    visible     may a stranger see the listing at all
    unlockable  may the unlock be attempted
    reason      'file' | 'country' | null — which one decides the copy

Most specific wins: a file's own country rule beats the store-wide block it
would otherwise inherit. `removed` beats a country rule — an operator who removed
a file did not mean "except where a country rule allows it". A row whose stored
state this code cannot read resolves to **blocked**, because serving a file
because a string was unexpected is the failure nobody notices until a letter
arrives. An **unknown country is not a blocked country**: no header, `XX` and
`T1` mean no rule applies, or the first proxy that strips a header would black
out a file for the world.

### The four answers, and none of them is a dead end

| The visitor's country | What they get | Why that one |
|---|---|---|
| A platform rule blocks it | **451**, with the rule's own title and a way to disagree | RFC 7725 is the status for "unavailable for legal reasons", and the block page has to say so or it reads as the site being broken |
| The creator withheld it | **403** | It is their choice, not a legal one, and the copy says that: "usually a licence that only covers some countries" |
| The file is removed | **404**, byte-identical to a file that never existed | A removal is not a notice |
| The file is listed, not unlockable here | **200** with "Listed, but not unlockable in India" | The honest state, and the one that would otherwise look like a bug in the ad slot |

Every country-dependent response goes out `Cache-Control: private, no-store` and
`Vary: CF-IPCountry`. The `Vary` is a courtesy — CDNs are documented ignoring or
stripping it — and the `no-store` is the thing that is load bearing, because a
cached block served to the wrong country is indistinguishable from a broken site.

### The country itself

It comes from the edge header (`cf-ipcountry`), read in one place (`src/geo.js`),
with a `?country=` override that is wired to `!isProd()` and nothing else. The
limits are printed on the operator page rather than discovered later: a VPN
defeats this, so does a satellite link that egresses somewhere else, and a
connection straight to the origin can claim any country — which is why the
origin belongs behind the edge and nowhere else. Nothing here classifies
content; a rule reaches a file because a person applied it, and the operator
page shows every country where something is currently blocked.

### The pages

- `/admin/moderation` gained a **Files** queue (open items counted separately
  from removed ones, which are down already and waiting on their owner, not on a
  person), a "where content is blocked" table per country, a "stores withheld
  from a country" table, and the one form that withholds a store.
- `/admin/moderation/files/:assetId` is new: decide the file, decide its
  countries (with a `wholeStore` checkbox that promotes the rule to the store), and
  read every decision ever recorded about it, citations included.
- `/dashboard/:slug/assets/:assetId` gained **Where this file is available**:
  what the creator set, what the platform set (read-only, with the platform's own
  note), and a form that can only withhold.
- The owner is told. A file's owner reads the decision in their dashboard and on
  their own public page, from the same record the console shows — a notice
  written from a different query is a notice that will disagree with the console.

### What it cost to get the words right

`countryWithArticle` exists because the owner notice printed *"Visitors in United
States cannot open this store."* — every sentence names a country, and eleven of
the names in the table need an article. Country names in tables and labels stay
bare; names inside sentences go through one helper, tested against the whole
table for doubling and for the four names whose articles are archaic.

### Tests and what was actually run

`test/geo.test.js` (23) pins the resolution order, the fail-closed and fail-open
edges, the creator/operator split, the article rule, the transaction that writes
rule + index + record together, and one thing the suite could not see before:
**every `<form action>` the console renders is checked against the server's own
source**, because a form that posted to `/admin/moderation/country` while the
handler listened on `/admin/moderation/blocks` answered "Channel not found" and
nothing said so. Reverting that action makes the test fail; that is how it was
verified. Full suite: **447/447**, four runs in a row.

Verified live, as a visitor in each country: `?country=IN` on a withheld store →
**451**; `?country=US` → **200**; the same store's file in Nepal →
"Listed, but not unlockable in Nepal"; a creator-blocked file in the UK →
**403**; a removed file → **404** for a stranger, **200** for its owner, absent
from the storefront; the withhold form (via its own button) → `?saved_country=1`
→ the store is out of Explore for that country and the owner is told why.

### The second pass: what a person sees, and what a client is told

Four things were wrong or missing once the feature was looked at on a screen
rather than in a diff. Each is small, and each was a place where a correct
decision reached the wrong sentence.

**A restriction is not a block, and the card said it was.** `availabilityFor`
answered `reason` (`'file' | 'country'`) and the storefront badge mapped
`country` to **"Not here"** — so a file that is *listed* and refuses the unlock
announced itself as absent. `reason` says where the refusal comes from and
`state` says what it is, and the two are different questions; `availabilityFor`
now returns both, the badge reads `state === 'blocked' ? 'Not here' : 'Listed, no
unlock'`, and `test/geo.test.js` pins the full shape including the new field.

**A carve-out is invisible, and that reads as a broken link.** When an operator
allows one file back into a country whose store is withheld, the file opens
normally — and the store's name, one click away, refuses. The visitor has no way
to tell a decision from a bug. `resolveCountry` now sets `carveOut` (an `allowed`
file rule *with* a store block behind it — `allowed` on its own is not a
carve-out), and the file page says it in one sentence: *"This store is withheld
where you are. This file is not."* Verified live: store **451**, that file
**200**, a sibling file **451**, and the sentence rendered — checked at 900 px and
390 px, because the last layout bug in this repository was found in a screenshot
and not in the CSS.

**No refusal could say which decision refused it.** A creator withholding their
own file and an operator removing one are both **403**; a file-level rule and a
store-wide rule are both **451**. So every refusal now carries
`unavailableFor` (`'country' | 'file'`) — on the storefront payload (alongside
`unlockable`), on the asset detail, on the byte routes, on the unlock start, and
on the store-level refusal itself. The Android client reads that field instead of
guessing from the status code, and both 451 and 403 arrive as a typed
`NotAvailableHere` rather than as "the server said 451": a decision the platform
took on purpose is not a failure, and presenting it as one teaches people the
product is unreliable. `test/android-contract.test.js` checks both halves of the
wire — the server sends the fields, the client parses them — because a contract
tested on one side only is a contract nobody completed.

**The creator's own note was stored and never shown.** A creator writes
"Licence covers Nepal only" when they withhold a file; the sentence went into
`asset_country_rules.reason` and stayed there. Their own panel listed the country,
the state, and who set it, so the one thing they had written down about their own
decision was the one thing their page did not show — and that sentence is also
what an operator reads when they open the file, which makes it the whole of the
appeal in one line. It now renders under the state, labelled as theirs:
*"Your note: Licence covers Nepal only."* A platform's rule is deliberately not a
row in that table: it is the notice below, because the two rows ask for different
things (clear mine, or read theirs and appeal) and a shared table invites the
wrong click.

### One more thing the suite was hiding

`npm test` failed a whole **file** with *"Unable to deserialize cloned data due
to invalid or unsupported version"* in roughly one run in two, on a different
file each time, with no failing assertion to point at. It was not the code under
test: a test child writes to the same stdout the runner frames its own messages
on, and the console mail driver printed every message body a test triggered. The
driver no longer prints when `NODE_TEST_CONTEXT` is set — the message is still
written and still recorded, so nothing a test asserts on moved — and the suite
then ran **446/446** four times in a row where it had failed in half the attempts
before. This is written down because the failure looked like flakiness in the
product for two days, and it was flakiness in the harness.

---

## 20. This round: a state that meant nothing, and a search that answered wrongly

`pending` was in `assets.moderation_state`, in `ASSET_STATES`, in
`ASSET_BEHAVIOUR` — and unreachable. `createAsset` hardcoded `approved`, so no
file was ever waiting, the operator's "Files needing a decision" queue could not
contain a new file, and the state a store's first upload was supposed to be in was
decoration. The baseline table in §14 said so in as many words: *"`pending` …
nothing is reviewed before it appears."*

### The question is three questions, not one

Writing the rule forced the vocabulary apart, because `pending` changes **one** of
the three things a state can change and the table could only say two of them:

| | `publicVisible` | `canUnlock` | `searchable` |
|---|---|---|---|
| `pending` | yes | yes | **no** |
| `approved` | yes | yes | yes |
| `restricted` | yes | **no** | yes |
| `removed` | **no** | **no** | **no** |

`restricted` staying searchable is deliberate: a visitor who looks for a limited
file should reach the page that explains the limit, not a dead end. `pending`
leaving search is the whole rule.

**What a new store gets is one review, not one review per file.** The first file
waits; a store that has had one file approved publishes immediately afterwards
(`createAsset` counts approved siblings inside the same transaction, so two
uploads at once cannot both decide they are the first). That is a promise one
operator can keep, and it is the difference between a review queue and a dam.

**What waits is search, not the file.** The file is live at its own address and
listed in its own store from the second it is uploaded — so a creator's launch is
never blocked by an operator being asleep, and the only thing a stranger cannot do
yet is *find* it without being told the link. This is itch.io's model, and they
write it down: a new seller's first published project "is placed in a queue for
review… it is still published and fully functional via your profile and URL" while
it waits ([their indexing docs](https://itch.io/docs/creators/getting-indexed)).
The alternative — holding the file back until reviewed — was rejected on the
research as well as on taste: the pre-moderation model buys control with slower
publication and more human cost, and the post-moderation model leaves harmful
content visible; holding the URL is the hybrid that costs the creator nothing they
need on day one. The claim is stated honestly to the creator rather than implied:
the review is a person reading one file, it does not classify anything, and it is
not a safety guarantee about the store afterwards.

### The bug underneath: search never read the file's state

While wiring `searchable` into `store.search()` it became obvious that the file
branch of that query had **never filtered `moderation_state` at all**:

    and (a.title ilike $1 or a.description ilike $1)

No state filter, so a **removed** file stayed in search results and its link
answered **404** — the same read-path hole §19 closed on the storefront, in the
one surface nobody had looked at, and the same one that had already been fixed for
stores (`c.moderation_state not in ('removed','suspended')`) a few lines above it.
Verified before and after: a removed file was found by title, then was not.
The filter is `SEARCHABLE_ASSET_STATES`, derived from the table above rather than
written out again in SQL, so a state added to the module is filtered here without
anyone remembering to.

### And a sentence about a decision nobody had made

`canAppeal` refused every state that was not `approved`, with the words *"an
operator has restricted this file"*. Harmless while nothing could be `pending` —
and a lie the moment a store's first file could be. It landed on the worst
possible file: the one three reports had just hidden, where nobody has looked at
the store yet and the appeal is the seller's only move. `isAssetDecided(state)`
now answers the question `canAppeal` was actually asking, `pending` is a file with
no decision to defer to, and a removal is no longer described as a restriction.

### The demo state now lives in the repository

`ci/demo-state.mjs` — the script that puts the preview into the two states this
round is about (a creator's country rule, and a new store whose file is waiting)
lived in `/tmp` for two rounds and was destroyed both times the workspace was
rebuilt. The database survives a rebuild; the script explaining it does not, and
the result is a preview whose interesting states are several manual steps away from
existing. It is in `ci/` now and idempotent.

### Tests, and what was actually run

`test/moderation.test.js` (36) gained three: the three questions answered for every
state with `SEARCHABLE_ASSET_STATES` derived from the table; a store's first file
waiting while a second upload from the same store does not; and search returning
decisions rather than questions — a pending file absent, an approved file found, a
removed file absent again. `test/reports.test.js` (27) pins the appeal fix, and
`test/ui.test.js` (22) pins the creator's sentence. Four existing tests failed on
the change and each was answered rather than adjusted: two fixtures now say
`moderationState: 'approved'` because a search fixture has to be a file somebody
has decided about, and one assertion now compares against the state the fixture
came out of creation with, because the property is that a seller cannot move that
column — not that the column holds one particular word.

Verified live, end to end, through the real signup form: a new store's first
upload → the creator reads *"Waiting for its first review"* with the promise that
the link works and the shop lists it → a stranger gets **200** at that link → the
store page lists it → **search returns nothing** → the operator's queue holds
exactly one item → approved → **search returns it** → the next upload from the same
store does not wait → and removing it takes it out of search again with **404** for
a stranger and **200** for its owner. Full suite **452/452**.

### The operator's side of it, looked at rather than reasoned about

The operator's pages were only ever checked as text, so they were opened in a
browser — the queue, the file page, at 1440 and 390 — and two things came out of
it that no assertion had an opinion about.

**Five surfaces show a moderation state and they had drifted into four different
colour mappings.** The state they disagreed about was always `pending`: two of them
painted it **red**, the colour a removal gets — and `pending` is the state every
store's first file is in until somebody looks at it. A queue that shouts about the
routine case is a queue whose shouting stops carrying information, and the cost of
that lands on the day something really is wrong. There is one helper now
(`stateTone`), and the rule it encodes is: red withholds something from somebody,
amber limits it without hiding, green was approved by a person, and a state nobody
has decided yet is quiet. The queue row already says "needs a decision" in its
heading, its count and its `!` — the pill does not have to say it in colour too.
`test/ui.test.js` renders the operator's queue and file page and checks the pill
for each state, so the mappings cannot drift apart again silently.

**An instruction that vanished as soon as it was needed.** The remedy field on the
file page carried *"One line, in your own words. It is shown with the rule's own
wording."* as a **placeholder** — which stops existing the moment somebody starts
typing, and on a 390px screen was truncated mid-sentence to *"It is show…"*. The
other two remedy forms on the same page already printed it as a persistent hint
line, so the same sentence was permanent in one form and invisible in another. It
is a hint everywhere now, and the placeholder is what a placeholder is for: a short
example of the shape.

Both found by looking. Neither would have failed a test — and the second one had
been on that page since the console round.

### The walks moved into the repository, and then had to be made true again

`ci/walk-country.sh` and `ci/walk-first-upload.sh` are the two round-trip
verifications, and until this round they lived in `/tmp` and were destroyed by
every workspace rebuild — which is how they were discovered to have gone stale. Two
things in them were only ever true of one machine:

- **Hardcoded UUIDs.** The two demo files were addressed by literal id. The
  database is recreated on a rebuild with fresh ids, so every step answered
  `?error=file` or 404 — step by step, the feature looked broken rather than the
  script looking old. They are looked up by slot now, and the walk refuses to run
  with an explanation if the demo files are missing.
- **Leftover session jars.** `/tmp/op.txt` was assumed to exist from an earlier
  run, so a fresh workspace produced *"not signed in"* in the middle of a country
  test: a session problem wearing the costume of a country problem. Each walk signs
  in what it needs.

And once the walks ran on every verification, they tripped the **sign-in rate
limiter** — six attempts an hour per address, which is the feature working
correctly. The failure mode is worth naming: a 429 sets no cookie, so the *next*
five steps fail for reasons unrelated to what they test. `signin()` now reuses a
live session when there is one, logs in when there is not, and stops with an
explanation when the limiter is in the way rather than producing a cascade of
zeros that reads like broken code.

Both walks were then run end to end, twice, on a freshly reseeded database: the
country walk green on every step (451 + no-store, the sentence present, unknown
country failing open, the creator refused `allowed` and refused the operator's row,
the carve-out at 200 behind a 451 storefront, the lift restoring the world), and
the review walk green on all eight (waiting → **200** at the link, listed,
**absent from search**, one queue item, approved → found, the next file not waiting,
removed → gone from search, 404 for a stranger and 200 for its owner).

---

## 21. This round: the storefront and the dashboard, opened and looked at

The same treatment the operator's pages got last round, applied to the two surfaces
a creator and a buyer actually live in: home, a storefront, and the dashboard, at
1440 and 390. Three findings, and two of them were mine.

### A store page that said "0 files" about a file that has none

The demo store in the preview read **"0 files"**, and the reason was not the
product: `ci/demo-state.mjs` had crashed once between `createAsset` and `addFile`
(`storage` imported from the wrong module), and its "does this asset already exist?"
check then found an asset and skipped the file for ever. A script whose idempotency
check covers only the first half of a two-part write will bless a half-created
state, and the visible result was a store page looking like it was lying.

The check is per half now — asset first, then the file's bytes — and the missing
piece is repaired rather than skipped. The same run gives the demo store a cover, so
the storefront card is a picture rather than a generated placeholder; a store whose
only item has no artwork looks unfinished in Explore, and every other demo store
has one.

### Our own placeholder was reserving a billboard

On the store with one file, bytebikri's own house message rendered at the platform
slot's **full reserved height**: 280px of our copy, taller than the store's content.
The codebase already stated the rule in this exact place — *"an empty box is a hole,
not a commitment"* — and the reserved height exists for one reason: a network's tag
mounts after the page has loaded, and reserving the space is what stops a late tag
from shoving the page down.

So the distinction the renderer needs is not "is there a creative" but "did anybody
**buy** this space", and the schema had no way to say it: the boot upsert writes the
house message as a real `slot_creatives` row, indistinguishable from a sold one.
Migration **0025** adds `is_house`, the boot upsert sets it, and a sold creative is
`false` by default — the honest case (a tag is coming, reserve the space) is the one
you get by forgetting. Measured on the live page: the slot went from a fixed 280px
to 205px, which is its own content.

**Worth recording: the first attempt at this changed nothing and the test still
passed.** It inferred the flag from "was there a row at all", which is true for the
code fallback and false for the row that actually exists in a running system. The
test passed because it exercised the fallback; the live page kept the 280px box.
It was caught by opening the page and *measuring the element* rather than by reading
the diff — the second time in this audit that looking beat testing. The test now
pins the stored row, which is the case that actually happens.

### The dashboard chart was not saying what it thought it was saying

The traffic chart drew a thirty-day window in which sixteen days have no row at all.
Those days are drawn as a grey band — deliberately, and the code says why: *"a day we
did not measure is a band, not a bar. It must be impossible to read as 'no traffic'."*
But the band was **unlabelled**, it covered more than half the plot, and at 11px a
large grey rectangle does not read as "no records": it reads as a filled area, days
that happened and are being counted. The fact was in the footnote and in a tooltip,
which is to say it was everywhere except where the eye was.

Two more things were wrong at the same size. The axis printed the raw `MM-DD` slice of
the ISO day — `08-24` and `09-22` — and at 11px that is not a date, it is two numbers
with a dash between them; read either way round it looks like a range, and there is no
month name anywhere on the chart. And the scale top was a bare `62` floating over the
grey band, which is exactly where a reader will assume it belongs to the band rather
than to the axis.

The fixes, and where they come from:

- **Wide bands are labelled in place** ("16 days not recorded"). The UX Stack Exchange
  thread on showing missing data in a daily chart is unanimous that the gap must be
  labelled where it is drawn — "label appropriately… explain that the data is missing"
  — with the alternatives being a dotted baseline or a `?`, both of which are weaker
  than the words. The label is HTML positioned over the plot rather than text inside
  the SVG, because the plot scales its columns with `preserveAspectRatio="none"` and
  would stretch the letters with them. It is emitted only when the band is a large
  share of the window, so a one-day hole still relies on the footnote and its tooltip —
  a rule the test pins in both directions.
- **The axis reads as dates** — `24 Aug`, `22 Sep` — with the year added only when the
  window crosses New Year, where the year is the only thing separating two identical
  labels. Numeric date defaults are the single most-complained-about thing in chart
  axes, and the fix everybody lands on is the short month name; day-month is the order
  this country reads. The tooltip keeps the unambiguous full form (`3 Sep 2026`) and
  the screen-reader sentence uses the same words as the print.
- **The scale top says `peak 62`**, so it cannot be mistaken for the band's own value
  or for a total.

Checked rather than assumed: nothing inside `figure.chart` leaves the figure at 320,
360, 390, 768 or 1440px, and the band label is present at all five widths (117px of
text inside a band that is 126px at its narrowest). The chart's own test grew one case
that measures both the label and the axis strings.

### Phone width: 16 tables were crushing the one column that matters

The audit up to here had been at 1440. Opening the dashboard at 390 showed the file
table with its name column — the column the eye scans for — squeezed to about a
hundred pixels: `Free sample pack` broken over two lines, its slug and metadata over
four, and the `ACCESS` heading cut in half at the right edge. `public/styles.css`
already documents the intent for exactly this ("a table that is allowed to be wider
than its container scrolls, and one that is squeezed crushes a column into two
characters per line"), and the table *was* scrolling. The 520px floor is what the
comment missed: **a floor on the table does not protect a column**, because auto layout
sizes the chip columns from their own content and hands the single flexible column —
the name — whatever is left.

Rather than fix the page I was looking at, I wrote the check as a script and ran it
across every signed-in page at 390px: **16 tables on 10 pages**, name cells between 71
and 138px wide, wrapping to between three and nine lines (`/admin/stores` six lines,
`/dashboard/alice/networks` nine). The fix is one rule in the phone block — a
`min-width` floor on the first cell — and the scan is now zero. On the files table the
name cell went from 125px to 176px and the rows got *shorter*, because a name with room
to breathe needs fewer lines. The audit log is excepted twice over: on a phone it stops
being a table and becomes labelled blocks, and a min-width on a display:block cell
would push the page wide.

### A clipped label is a bug, so the table says it scrolls

Even with readable columns the table still cut a column heading in half at its right
edge, and the stylesheet already has a rule about that, written for the navigation: *"A
clipped label is worse than a tall header: the reader cannot tell whether the page is
broken or the site is just bad."* A table can scroll where a header can wrap, but only
if the reader can tell it does.

So the scrolling box now carries **scrolling shadows** — the pattern Lea Verou
published in 2012 (`lea.verou.me/2012/04/background-attachment-local/`, from @kizmarh):
two shadow layers glued to the container and two cover layers glued to the content, so
when there is nothing to scroll the cover sits exactly over its shadow and hides it.
The cue appears when, and only when, there is more to the right. No JavaScript, no
scroll listener, nothing to keep in sync, and a browser without
`background-attachment: local` degrades to exactly the state we were in before. It was
verified in both states rather than trusted: at scroll 0 the right edge is faded, at the
end of the 340px of scroll the right edge is clean and the left one is faded. Desktop is
untouched — the rule lives inside the phone media query, and the same probe reads
`cellMin: 0px`, no shadow layers, at 1440.

### Three misreads, all from the same habit

This round produced three "bugs" that were artefacts of reading a 3×-downscaled PNG:
`ADVERTISMENT` (the label is correct), a red Sign out (it is a ghost button), and the
active tab apparently sitting on `Ad slots` (it is on `Overview`, with
`aria-current="page"`). Each was resolved by reading the DOM or taking an element shot
at native scale, and none of them cost anything but the habit is worth naming: **the
downscaled screenshot is a map, not evidence.** The chart's date labels were the same
kind of misread (`10-24` for `08-24`) and they still led to a real fix — but the reason
to change them was the string measured at 1:1, not the blur.

### What the audit did not find

Worth writing down, because a report that only lists problems is not a measurement:

- The home page's numbers (*3 stores, 21 unlockable files, 1 unlock granted, 0% cut
  of ad revenue*) match the database exactly, and the hero's four-cell money panel
  states who pays, where it lands, what bytebikri holds and what our share is — the
  standing rule about money, in one glance.
- The store page's ad slot is labelled *"Advertisement · Platform space. The store
  rents it to ByteBikri; the store is not the advertiser."* — and the spelling I
  thought was wrong on the first screenshot was correct in the HTML. The label was
  read from a downscaled image; the markup is the authority.
- No overflow, no clipped text and no mis-clipped control at either width in
  `sweep.mjs`'s 38 pages, which is what that harness is for.

### Tooling, made reproducible again

`ci/eyes/shot.mjs` is now in the repository: one page, one element, a real viewport,
with the two capture-hygiene lessons baked in (reduced motion, or an entrance
animation caught mid-flight reads as clipped text; the fixed consent bar hidden, or
it paints over the note being photographed). And `ci/eyes/setup.sh` now copies the
harness scripts into `$DIR` as well as rebuilding the browser — it rebuilt the
browser and left the folder with no scripts in it, so the flow in its own README
(`cd /tmp/eyes && node sweep.mjs`) answered "Cannot find module" after a rebuild.
**Rebuilding the environment and calling the result ready is worse than not
rebuilding it**, because the second run after a restore is the one that looks
broken. `setup.sh` also resolves its own directory before its first `cd`, since a
relative `BASH_SOURCE` is relative to where the script started.

---

## 22. The check that was thrown away, and the five tables it was hiding

§21 ended with the phone tables fixed and a confession: the scan that found them
was **a one-off script, run once and deleted**. Sixteen tables across ten pages
were crushed, one rule fixed them, and nothing on earth stopped table seventeen
from being added crushed tomorrow. This round makes the scan part of the
repository, points it at the whole console again, and fixes what it found — which
was a second instance of the same bug, **one column over from where the first fix
looked**.

### The check is written against the stylesheet's own promise

`ci/eyes/columns.mjs` does not carry a threshold somebody liked the look of. The
number it enforces is the number in `public/styles.css`:

> inside `.panel-body`, `.panel-body-flush` and `.table-scroll`, the first cell of
> every data table is at least **11rem**

It reads that 11rem off the page's own root font size, so editing the rule in the
CSS changes the check with it. And it counts lines the way a reader sees them —
`Range.getClientRects()`, a rect per line box — not `height / line-height`, which
counts the metadata underneath a filename that is *supposed* to wrap.

That distinction cost two wrong versions of this file before it was right. The
first version measured the cell's own box and called **thirteen healthy tables
crushed**. The second tried to measure the "name element" inside the cell and got
seven, because several first columns are dates (`2027-09`, `just now`). Both were
inventing a rule; the third reads the rule that already exists.

Run against the console at 390px it reported **24 tables on 13 pages, six crushed
cells** — every one of them in a column the 11rem floor does not reach:

| Page | Column | Was |
|---|---|---|
| `/admin/stores/alice` | Detail | 123px, **11 lines** of `store: alice · amount: NPR 24 · …` |
| `/admin/users` | State | 96px, 5 lines — a pill and *"can act on others"* |
| `/admin/earnings` | Gap | 94px, 6 lines — a pill and *"we estimate higher"* |
| `/dashboard/alice/earnings` | Our estimate | 131px, 4 lines — `$0.05` and `$0.01 in postbacks` |
| `/dashboard/alice/earnings` | a caveat cell | 90px, **9 lines** |
| `/dashboard/alice/networks` | Minimum | 153px, 4 lines — *"no stated minimum via Bank transfer / NPR"* |

### The floor was the wrong tool for this, and the audit log was the right one

The obvious fix was to extend the min-width floor to more columns. It does not
work: a floor is a number, and what these cells need is a different shape. *"No
stated minimum via Bank transfer / NPR"* is a sentence with no natural minimum
width; `$0.05` under `$0.01 in postbacks` is two lines that belong together; and
*"can act on others"* is a qualifier for the pill above it. A floor wide enough
for the worst of them squeezes everything else off the screen.

The stylesheet already had the right answer, written for **one** table in §21: on a
phone the audit log stops being a table. The header row goes, each row becomes a
block, and the block prints its own label from `data-label`. The reasoning there
was about reading, not width —

> a log is read by scanning, and a scan that requires horizontal scrolling stops
> after the first row

— and that is true of every one of these five tables, which is why the exception
became the pattern. `.table-audit` is now `.table-stacked`, a name that says what
it does, and the six findings are all gone.

Six tables took the audit log's treatment: the operator's **People** page (9
columns), an operator's store **decisions** (4), operator **earnings** (9), the
seller's **earnings by network** (6), **your accounts at the networks** (4), and the
network offers table, which is one row renderer used on two pages.

### What is deliberately *not* stacked

Stacking is not free: every stacked row is about three times taller, so it is worth
saying exactly where it was applied and where it was not. The line drawn this round
was **cells that were crushed, and rows read as one record**. A table whose columns
are short values that fit — a plan, a price, a count — keeps scrolling on a phone
with the shadow cue saying there is more to the right. That is the pattern §21
built, it is verified in both scroll states, and it is still the right one for a
grid the reader compares *across*. What changed for the six tables above is that
their cells were not short values that fit: they were sentences, or a figure with a
note under it, squeezed into a column narrower than a thumb.

That leaves an honest gap rather than a claim, and it is now **measured rather
than estimated**. `columns.mjs` also reports — without failing — every table whose
content is wider than the box it scrolls in. At 390px there are **nine of them**,
five columns or more, on the pages the harness walks: `/admin/stores` (8 columns),
`/admin/stores/alice` (7), `/admin/payments` (8 and 5), `/admin/plans` (6 and 7),
`/dashboard/alice` (6), `/dashboard/alice/billing` (5), `/dashboard/bob` (6).

None has a crushed cell, which is what the failure rules measure, so by the
standard written down this round none of them is a bug. But a phone shows two or
three of those columns and cuts the next one mid-word — the Store list's Plan
column is cut through the chip, so a store on the Store plan reads `STO`, which is
worse than either a wrapped header or a stacked block. The argument that made the
audit log stack applies here too: **a scan that needs horizontal scrolling stops
after the first row.** This is the next phone pass, its list is printed by every
run of the check, and it is written down here rather than quietly left out.

The people table also lost its most-stacked cell before it was stacked at all. The
seller's accounts table had the same sentence printed in **every row** — *"Only you
can see this. It is not the network's record and we cannot check it."* — which is
not row data at all, it is a note about the column. It is now said once, under the
table, where it reads at every width. **A cell that is identical in every row is
not a cell.**

### Two bugs the new check found before it was even finished

Writing the labels rule — *every cell after the first must carry a `data-label`* —
turned up a cell in the seller's accounts table with no label, holding a `Save`
button. Chasing it found something worse underneath: the table had **four
`<th>` over a three-cell body**. `Payout method` had been sitting above the status
cell since before this round, a heading describing a column that does not exist,
with the fourth header empty over a caveat repeated in every row. A browser
renders that without complaint; the empty column simply hangs off the right edge.
The header now has the three columns the body actually has, the sandbox row's
`colspan` was corrected to match, and the method input's placeholder says `payout
method` instead of `method` because it is the only thing naming itself.

That is now **rule five** in `columns.mjs`: every body row has as many columns as
the header says it does, counting `colspan`. It is the cheapest rule in the file
and it is the one that found a real bug on its first run — **nobody counts
columns**, which is exactly why a check should.

The phone screenshot then showed the fix's own edge: the form inside that cell —
two inputs and a button on one line — got about 130px per field at 390 and cut its
placeholders off mid-word (`e.g. Payoneer ▏`), which reads as a broken field
rather than a hint. Inside a stacked table the form is now a column too: each
field full width, the button last.

### The instrument was lying about the first row

Every phone screenshot of a stacked table showed the console's top nav painted
across the top row, cutting it in half. That is not the page. `shot.mjs` takes an
**element** screenshot, which makes Playwright scroll the element into view and
then clip to its box — and anything `position: sticky` lands inside the clip. The
first row looked broken in every picture and was perfect on the page.

So `ci/eyes/fullpage.mjs` takes the page as the reader scrolls it, full height at
390px, and it is in the repository for the same reason `columns.mjs` is. It is the
third capture-hygiene lesson in that folder, after reduced motion and the consent
bar, and it is the one that generalises: **when a reading looks wrong, check the
instrument before believing the reading.** §21 learned the same lesson from the
other direction, when three "bugs" in downscaled screenshots turned out to be
compression artifacts. The screenshots still have to be looked at — but with a
tool that is not inventing things.

### What was run

- `ci/eyes/columns.mjs` — **24 tables on 13 pages, 0 findings** at 390px, five
  rules, exit code 1 if that ever changes.
- `ci/eyes/sweep.mjs` — **38 clean, 0 with findings**, both widths, after the
  stylesheet change.
- `npm test` — **456 / 456 / 0**, one more than before this round, and the new case
  is the cheap half of the same invariant: the stacked table's label is the cell's
  own attribute, and the floor on the first cell does not reach it. That exemption
  had been left pointing at the old class name for part of this round, and nothing
  else in the repository would ever have mentioned it.
- Screenshots looked at, not just measured: `/admin/users`, `/admin/earnings`,
  `/admin/stores/alice`, `/admin/audit` and `/dashboard/alice/networks` on a
  phone, and the accounts table at 1440 as well, because changing a header changes
  the desktop too.

### Still open, and written down rather than fixed

`columns.mjs` and `sweep.mjs` walk a **list** of pages, and pages whose URL carries
an id — a file, an operator's decision page — are on neither list. A layout
regression on one of those pages is invisible to both harnesses until a walk opens
it. That is now in `ci/eyes/README.md` under its limits, because a check that is
believed to cover more than it does is worse than no check.

---

## 23. The next phone pass: nine tables that scrolled, and the two bugs under them

§22 ended by writing down what it had not fixed and could not guess at: **nine
tables five columns or wider still scrolled sideways on a phone**, none of them
crushed, one of them cutting a Plan chip in half so a store on the Store plan read
`STO`. This round is that list, worked through — and the same evening's lesson
again: **fixing the wide thing reveals the wrong thing next to it.**

### Why they had to be stacked, and where the line moved

Rule 2 of the check (no cell under 10rem wrapping to four lines) never fired on
these nine, because their cells are short values that fit: a pill, a number, a
date. What was wrong was not a cell, it was the **table**: at 390px the 11rem floor
on the first cell leaves about 180px for everything else, so a five- or six-column
table cannot show itself. A phone shows the first two or three columns and cuts the
one at the edge — which is the clipping §21 called a bug, arriving through the one
door the floor does not cover.

So the line §22 drew — *crushed cells, and rows read as one record* — turned out to
be the same thing seen twice. Every one of the nine is a row that is read as a
record: a store, a file, a payment, an invoice, a month, a plan. They are stacked
now, and **the check fails if that stops being true**: rule 6 says a table five
columns or wider must not be wider than its box. Below five columns a table may
still scroll, because that is what the shadow cue is for and a narrow table that
scrolls loses nothing.

That is the honest shape of this round: a report was promoted to a rule only after
the last instance of it was fixed.

### Two bugs that were only visible once the tables were stacked

**The upgrade rows were shifted by one column.** The seller's bill — "what you have
paid bytebikri" — is one table of two row shapes: rent invoices (five cells) and
plan upgrades (four). On a desktop the upgrade rows put their amount under *Due* and
their state under *Amount*, and left the Status column empty; nothing complained,
because a browser lays out a short row without a word. The rent rows have the due
date only because rent has one — an upgrade does not — so the upgrade row now says
so, with a dash, and the row has five cells. **A table with two row shapes needs
both of them counted**, which is rule 5, and rule 5 could not see this one because
the page only renders upgrade rows when somebody has bought one.

**A comment had outlived its premise.** The seller's file table carries a long
comment arguing State must come before Access *because* a phone can show the title
and one more column inside the scrolling box, so the order decides what is visible
without swiping. That was true when it was written and is false now that the table
is stacked — every column is visible. The order is kept (it is still the right order
to read) and the comment now says why, because a comment that argues from a dead
premise is how the next person reintroduces the bug.

### The check got a rule and a measurement it was missing

The new rule 6 is above. The other change is in rule 3: it used to assert that a
stacked cell *carries* `data-label`. That is half a promise — the attribute does
nothing unless the stylesheet renders it, and a `display` change on a cell or a
dropped pseudo-element would leave a value with no label and no failure anywhere.
So the check now measures the **gap between the top of the cell and the first line
of its own text**: if no line's worth of room is taken above it, the label is not
being drawn and the check says so.

That measurement exists because of a misread. Looking at a downscaled phone shot of
the month-by-month rent table, the labels appeared to be *below* their values —
"NPR 24" then "BILLED". Measuring the live DOM said otherwise: the label is a
`display: block` pseudo-element and the value's first line sits 19px below the top
of the cell, in every cell. The picture was wrong and the number was right, which is
the third time this audit has learned that (**§21: the downscaled screenshot is a
map, not evidence**). The measurement was then checked against a deliberate break:
with `td::before { display: none }` injected, the same gap collapses to 2px, so the
rule fires when it should rather than passing by construction.

### What was run

- `ci/eyes/columns.mjs` — **25 tables on 14 pages, 0 findings** at 390px, and for
  the first time **nothing at all in the "still scrolls sideways" list**: there is
  no table left in the console that a phone cannot show.
- `npm test` — **456 / 456 / 0**; `ci/eyes/sweep.mjs` — **38 clean, 0 findings** at
  both widths.
- Screenshots looked at, full height at phone width, on the five pages whose layout
  changed: the store list, the billing queue, the seller's dashboard, the seller's
  bill and the month summary.

Sixteen tables carry `.table-stacked` now. The two- and three-column tables are
still tables, which is the point: the treatment marks the tables a phone cannot
show, and stops meaning anything if it is applied to the ones it can.
