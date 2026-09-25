# Feature audit — what exists, what is missing

Written by reading the repository and then running it, not from memory. Every
"done" below is a file you can open; every claim marked **verified** was checked
against the running server this round.

Three codebases live here and they are at very different stages:

| Codebase | Path | State |
|---|---|---|
| **Web app** (server + storefront) | `app/` | works, **513 tests**, running locally |
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
| KYC verification flow | **built in §29** — the document is handed over, stripped of metadata before it is stored, destroyed the moment a decision is recorded, and after seven days either way |
| A storefront theme (the plans' `can_theme`) | **built in §31** — six curated palettes, each proven at ≥5.5:1 for white at both ends of its gradient and at the middle, a live preview on the seller's own store name, motion that is opt-in per device, and the capability read from the plan rather than restated |
| Per-store fonts, free-form colours, seller CSS | absent **on purpose**: each is a claim about readability that no test can keep, and each can be priced and proven on its own later |
| A member-paid ad-free experience, charged to the seller | **still open** — the revenue-side sibling of the theme round. It cannot be sold by withholding ad money (the networks pay the store directly), so it needs a seller-side capability, a price, and a rule about the platform's rented slot. Researched, deliberately not half-built |
| Per-store footer removal (`remove_footer`) | **built in §33** — a paid store's storefront and file pages lose bytebikri's name; the legal notices stay on every page of every plan, because those are not a store's to remove. Sold on the pricing page in the same words, and pinned in two test files |
| Paying a creator directly | **built in §30** — members: two tiers the store names, dues the member sends the creator and the creator alone confirms, a roster with plates, and files that open with no ad while the period runs |
| Following a store | **built in §28** — a shelf at `/library`, a count of what appeared since you last looked, and no notification promised anywhere, because this product sends buyers none |
| Offline viewing (Android) | absent **on purpose**: a disk cache of unlocked media is a leak with a progress bar |
| Comments, replies between buyers | reviews only; a comment thread is a moderation load nobody has agreed to carry |
| Bulk asset operations | **built in §27** — search, filters, sorts, paging, page/all-matching selection, and a change that can be taken back exactly |
| Analytics beyond the estimate | no per-asset view counts, no traffic sources in the UI |
| ~~A buyer's shelf~~ | **built in §28** — every unlock with its window (open / ended / taken back / file taken down), the stores being followed, and whether a person has reviewed what they opened |

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

---

## 24. The two pages nothing checked

§22 and §23 both ended with the same sentence in slightly different words: the
harness walks a **list**, so a page whose URL carries an id — a file, an operator's
decision page — is on neither list, and a layout regression there is invisible to
every automated check this repository has. This round closes it, and the result is
the cleanest argument for the whole exercise that this audit has produced.

### Why the list could not simply grow

The id changes on every reseed (`ci/demo-state.mjs` makes new rows), so a literal
URL is stale by the next run. Writing it down was never an option. Both pages are
**linked** from pages that are already on the list, so the harness now opens the
linking page and reads the hrefs out of the same markup a person clicks:
`/dashboard/alice` → `/dashboard/alice/assets/<id>`, `/admin/moderation` →
`/admin/moderation/files/<id>`. The list lives in one place, `ci/eyes/pages.mjs`,
shared by `sweep.mjs` and `columns.mjs`, so neither can drift from the other.

If the link is missing the run **says so** — it prints that nothing was found and
that the link may have moved, rather than quietly checking one page fewer. Silence
is what let this gap exist: two rounds of audit notes described it, and neither
round looked.

### What was on them

Both pages were opened at 390px for the first time, and between them carried
**three** rule-6 violations — tables five or more columns wide, wider than the box
they scroll in:

| Page | Table | Columns |
|---|---|---|
| `/admin/moderation/files/<id>` | Countries | 6 (with the Clear button at the far end) |
| `/admin/moderation/files/<id>` | Every decision about this file | 5 |
| `/dashboard/alice/assets/<id>` | Where this file is available | 5 — *"Not shown at all — the page answers 403 to a visitor there"* in one column |

Ten minutes of stacking, and then the more interesting part.

### The fix that was only half a fix

After stacking, all three were still reported as wider than their box. They sit in
`.table-scroll`, and the stylesheet declares its floor for **three** wrappers:

```css
.panel-body .table, .panel-body-flush .table, .table-scroll .table { min-width: 520px; }
```

The exemption written in §22 named two of them. On the pages the harness could
reach, every stacked table happened to live in one of those two — so the third case
had never been rendered by anything, and an exemption that would not have worked
had been passing for a round. This is the exact shape of bug the harness exists
for: **not wrong code, but code whose wrongness could not be displayed.**

Both the rule and its exemption now name the same three wrappers, and
`test/design.test.js` walks the list, so a fourth wrapper added to the floor has to
be added to the exemption or the suite says why.

### The suite caught its own version of this

One test broke, and it was right to be checked: `test/geo.test.js` asserted
`/<td>Restricted<\/td>/` — the raw verb in a cell with no attributes. Adding
`data-label` to that cell (so a phone can label it) broke the pattern while leaving
the behaviour intact. The assertion now allows attributes and still checks the
thing it was written for: that a decision about the file reads as its own verb
rather than the country phrasing. **A test that pins markup instead of meaning
fails on the next good change**, which is worth knowing before it is mistaken for
a regression.

### What was run

- `ci/eyes/sweep.mjs` — **48 clean, 0 with findings** (was 38: the ten extra
  page-visits are the asset pages and the operator decision pages, at both widths).
- `ci/eyes/columns.mjs` — **28 tables on 16 pages, 0 findings**, and the
  "still scrolls sideways" list is empty: for the first time, every table the
  harness can reach fits the phone it is read on.
- `npm test` — **456 / 456 / 0**, after fixing the markup-pinning assertion.
- Both pages looked at, full height at 390px.

### And a note on the workspace, because it happened again

Mid-round the environment was restored: an old `06e551c` in `git log`, `/tmp` gone,
`node_modules` gone, Postgres and the web server down. The recovery is now routine
and is written down at the top of this file — fetch, confirm the last-known tip is
an ancestor, `reset --mixed`, and the overlay's content is preserved because it
matches the push. `ci/dev-up.sh` brought the app back in eight seconds, `ci/eyes/setup.sh`
rebuilt the browser, and the harness found the three violations above on the first
run after the rebuild. **The verification tooling is what made a lost environment a
twenty-minute interruption instead of a lost round**, which is the whole argument
for having put it in the repository rather than in `/tmp`.

---

## §25 — The badge the plans were selling, and the table nobody had read

### The contradiction

The Store and Pro plans have advertised, since the plans page was written, "A
verified-seller badge once your documents are checked". The operator's People page
said the opposite in as many words — that the platform has **no KYC step**, and that
inventing a badge for one would be worse than not having it. Both pages were live at
the same time.

Underneath them, `seller_verifications` had existed since `0001_init.sql` with a
comment that is a specification: *"Stores the OUTCOME of KYC, never the evidence."*
Nothing read it and nothing wrote it.

### What was researched before anything was drawn

- **Badge wording.** The consistent finding across verification vendors is that a
  badge which does not say **what** was checked gets read as "this person is
  trustworthy". A check on identity is not a check on honesty, and the badge is not
  a review of the files. Facebook's own badge copy is the model: it says a real
  person controls the account, and nothing about their claims.
- **Failure is not fraud.** Automated checks fail on glare, blur and transliterated
  names; a refused check needs a specific retry instruction rather than a wall, and
  must not be recorded as a finding against the person.
- **Retention.** Keep only what the decision needs: an outcome record, not the
  document. Regulators' framing is "retain the smaller audit record, not the raw
  ID".
- **Nepal's documents.** A personal PAN requires the citizenship certificate (or a
  passport); registration is free and issued within days, and the digital PAN in the
  Nagarik App is QR-verifiable in real time. So citizenship and PAN are the two
  documents a Nepali seller will actually have, and the seller panel says so instead
  of naming an ID type nobody here holds.

### What was built

A document-free check: the seller asks; a person on our side looks at ONE document
somewhere outside the platform; the outcome is recorded — verified or refused, with
the method, who decided, when, and a note. **The document never arrives here.** The
table enforces that (`docs_retained boolean check (docs_retained = false)`), which is
the strongest form of "we do not store it": not a policy, a constraint.

- Expiry is **derived** from `expires_at` (default 24 months, choices 12/24/36), so
  the badge lapses on its own and nothing sweeps at midnight.
- One open request per store, enforced by a partial unique index.
- The badge is **positive-only**: "Identity checked", with a sentence naming the
  document the person saw and the date. There is no grey "unverified" chip anywhere,
  because a store nobody has asked about is not a suspect.
- A check is plan-gated (the capability already existed in the plans table), and the
  copy says why in a sentence rather than a lock icon.

### Two bugs the review pass caught, both invisible from the code

1. **The `null` in the store name.** The Explore rail rendered
   `${badgeFor(v) && verifiedBadge(v)}` — `null && …` is `null`, and a template
   literal prints it, so every un-checked store in the directory read *"Nima
   Craftsnull"* under its own name. A screenshot found it in ten seconds; nothing in
   the suite could have, because no assertion was ever about a word that should not
   be there. The regression test now asserts it.
2. **The card that showed the chip twice.** The storefront called the pill renderer
   twice — once beside the name and once with the sentence — so a checked store read
   "IDENTITY CHECKED" twice. Fixed by splitting the sentence into its own renderer
   fed by the same `badgeFor`: one sentence, one source, and a test that the two
   cannot disagree.

### What was run

- `ci/eyes/columns.mjs` — **29 tables on 17 pages, 0 findings**.
- `ci/eyes/sweep.mjs` — **48 clean, 0 with findings**.
- `npm test` — **474 / 474 / 0**, of which 18 are new and cover the state machine,
  the gated ask, the refusal path, the Kathmandu date boundary, and the two bugs
  above.
- Storefront, Explore rails, seller settings, operator store page and the operator
  overview all looked at full height at 390px.

## §26 — "We will tell you before it does", said by nobody

### The contradiction

§25 shipped a seller panel with this paragraph, live:

> It lapses on 23 Sept 2028. **We will tell you before it does**; nothing about your
> files changes when it does.

Nothing in the platform told anybody anything. There was no reminder, no list, no
job — the sentence was a promise attached to a mechanism that did not exist, which is
the same failure as §25's page and, like §25's, invisible from the code: the sentence
rendered, the tests passed, and only a person reading it in a browser would ask *how*.

Two smaller versions of the same fault sat next to it. The operator's overview had a
queue row, "Identity checks asked for", that linked to `/admin/stores` — the whole
directory, unfiltered, so the row counted something the page it led to did not show.
And the badge itself came from `verificationFor`, the newest row of any kind, which
meant a seller asking for the *next* check would replace the outcome of the current
one — the badge would come down by asking early.

### What was researched before anything was built

Reverification practice, because "remind them at the right time" is a solved problem
everywhere except here:

- **SheerID, on reverification mechanics** — start roughly a month before expiry;
  remind at 30, 15 and 5 days, each message carrying a direct link to the form; and
  the point that decided this round's shape: **do not deactivate access while
  re-verification is pending** — keep the benefit, ask for the renewal, and only act
  after the date.
- **I-9 reverification guides** (outsolve) — first notice 120 days out, then 90/60/30,
  because renewing a document takes weeks; and the automation is worth less than the
  **named owner** of the list: what produces "fire drills and audit findings" is a
  tracker nobody owns.
- **A Global Entry thread** on a lapsed renewal — "no more reminders? … it totally
  caught me off guard". The failure is not the expiry; it is the expiry arriving
  without a word.

Adopted: a 60-day console window, a list a person works, a notice a person sends, and
the badge kept while the renewal is arranged.

### What was built

- **Bands derived from the date, not stored.** `lapseOf(row, now)` answers `current` /
  `soon` (≤60 days) / `due` (≤30) / `lapsed` (past), from `expires_at` alone. Nothing
  runs at midnight; a store's state is a function of the clock. `lapsed` returns the
  level rather than `null`, because the console has to be able to say the badge came
  down on the 3rd.
- **The badge is the newest DECIDED row.** `verificationFor` excludes pending rows;
  `pendingVerificationFor` is a second read. One row per fact, so asking for the next
  check cannot take the current badge down — and `requestability({…, pending,
  lapsing})` lets a seller ask inside the window while saying, in as many words, that
  the current check keeps counting.
- **A queue, and a notice a person sends.** `POST
  /admin/stores/:slug/verification/notice` claims the row
  (`markVerificationNotice`, only where `notice_sent_at is null`), sends
  `sendLapseNotice`, and releases the claim if nothing was written — two operators
  either side of a slow page load must not both mail a seller, and a claim with no
  message behind it must not survive, because the next person working the list would
  skip someone nobody has contacted. Migration `0027` adds `notice_sent_at`,
  `notice_by` and a partial index on `expires_at where status = 'verified'`.
- **The notice itself.** Subject "Your identity check ends on {date}"; the date, what
  the badge coming off does and does not change, the way back, and the line doing the
  most work: *"You do not need to send us anything now."*
- **The console reads identity as its own column.** `storeDirectory({identity, sort})`
  filters computed state — never checked / waiting on us / checked / ending soon /
  lapsed — in the outer query, so the count agrees with the rows. Two of them are the
  overview's queues, now linked with the filter attached.

### Four bugs, three of them found by looking

1. **The listing that excluded the store it counted.** The directory's `identity_state`
   made the open request beat the standing outcome, so a store that was *both* waiting
   on us and close to its date — the ordinary renew-early case — appeared as
   "waiting", and the "Checks ending soon" row linked to a filter that hid it. The
   count said one, the list said none. The two facts are now two columns of the same
   cell: the pill is the standing outcome, the lines under it are the request and the
   notice.
2. **A window that opened 548 days early.** `lapsing` was computed as "has a live
   check", so a check eighteen months from its date was offered the renewal form — the
   one open window became a permanent button. Caught by rendering the panel with a
   distant date before trusting it. `withinNoticeWindow(lapse)` is now the only
   definition, and both the panel and the POST handler use it.
3. **The form and its handler disagreeing.** The ask route called
   `requestability` with neither `pending` nor `lapsing`, so once the panel correctly
   offered "Ask for the next check", pressing it was refused with "Already checked."
   by the route that received it.
4. **Fine print reading as a button label.** `Withdraw the request` followed by an
   inline `<span class="fine">` wrapped *under* the button and looked like the second
   half of its own sentence. Only the browser showed it; columns and sweep both called
   the page clean. The sentence is a block under the action now.

And one fixed while testing, from the same family: every flash on these four routes
was built as `#verification?error=…`, which is a fragment called
"verification?error=…" — the server never sees it and the person is bounced back to a
form with no explanation. The free-plan seller's refusal had been unreachable since it
was written. `back()` now takes the query as an argument and the anchor is appended
last, with a static test that fails if a new anchored route goes back to the old shape.

### What was run

- `npm test` — **484 / 484 / 0**, including three new view tests (the panel inside the
  window, the panel outside it, the console before and after the notice, and the
  fragment rule), the backdated-check test, and the duplicate-flash-key check.
- `ci/eyes/columns.mjs` — **31 tables on 18 pages, 0 findings at 390px**.
- `ci/eyes/sweep.mjs` — **56 clean, 0 with findings**, now including `nima` as a
  fourth account: her store is the demo's deliberately awkward one (a check inside its
  window *and* a request open), and a seeded state that exists on purpose is worth
  checking on purpose. `sessionFor` needed the store slug for its proof URL —
  `/dashboard/nima` 404s and a 404 looks exactly like a refused sign-in.
- Looked at, at 390px, in the browser: the seller's panel (badge, band, both facts,
  the withdraw action), the operator's ending panel before and after the notice, and
  the directory's identity column across the three demo stores — *"Citizenship
  certificate — 30 days left / asked 16m ago / told 12m ago"*, and *"Never checked"*
  with nothing under it.
- The notice text itself, printed by the console mail driver:

  > The check on Nima Crafts was made after somebody looked at your document. It stops
  > counting on 23 Oct 2026 (in 30 days), and the badge comes off your store page the
  > same day.
  >
  > Nothing else changes. Your store stays open, your files stay published, unlocks and
  > earnings are untouched — the badge is the only thing on the line, and it is the only
  > thing that goes.
  >
  > If you want it back, ask for a check from your store settings when it suits you. It
  > is the same process as the first time: a person looks at one document, and the
  > outcome is recorded. You do not need to send us anything now.

## §27 — the file list, for a seller with more than one file

The audit has carried the same line since §10: *"one file at a time; a seller with 200
files will want more."* Three files are a list you can read. Two hundred are a list you
have to search, sort and act on in groups — and every action had to be done by opening
one file's page, changing it, and coming back.

### What the research said

- **NN/g, "Bulk Actions"** — the three guidelines are: provide a Select All, put the
  actions in a contextual bar, and give feedback *with an undo* rather than a
  confirmation. The undo is the part that gets skipped and the part that matters: a
  seller who pauses thirty files by mistake has thirty files to find.
- **PatternFly's bulk selector** — the reason it is a menu rather than a checkbox is
  that "select all" has two meanings, *this page* and *everything that matches*, and a
  single tick can only be read one of them. Its menu keeps "select none / page / all"
  as separate, labelled items, and keeps the selected count visible the whole time.
- **UX Stack Exchange (two threads on select-all)** — the tri-state header checkbox is
  the established convention, *because* the count of what is ticked is what tells a
  reader whether to use it.
- **An issue on the `can-eye-budget` repo (Livewire)** — the implementation trap, in
  one line: *"store the filter snapshot, not a list of hundreds of ids."* Re-resolve
  the filter on the server at commit time, re-authorise every id against the owner, and
  never trust the ids a browser posts.
- **NN/g heuristics #3 + the general undo-over-confirm writing** — reserve confirmation
  dialogs for the irreversible. Pausing a file is reversible, so it gets an undo.

### What was built

A toolbar that asks the database for the rows (`sellerFiles`): a search over title and
address, state and access filters, five sorts, and paging at 25. The chips carry counts
for the **whole store, not the filtered view**, because a filter with no visible "of N"
is a page that cannot be checked by the person reading it. The three states are written
so they *partition* the store — `live` and `paused` exclude the files the platform is
holding while reports are answered, and `hidden` is exactly those — so the chips add up
to the sentence above them, and a row's pill and the chip that finds it always agree.

Selection is two labelled controls drawn **outside the table**: *"Select this page — the
25 files shown above"* and *"Select all 29 files matching this search — including the 4
you cannot see on this page."* They are outside the table because `.table-stacked thead`
is `display: none` on a phone — a control a phone needs cannot live in a row of cells a
phone does not draw. The second one posts `scope=matching` and no ids at all: the server
re-runs the filter when the button is pressed, which is the snapshot rule.

The action bar is a real toolbar at rest and becomes sticky, with a live count, once
anything is ticked. The count is the client enhancement; the form, the checkboxes and
the four actions all work with JavaScript absent.

A bulk change writes one row to `asset_bulk_batches` with the **previous values** of
every file it actually changed — `[{id,status,unlock_mode}]` — and the page offers an
**Undo** for thirty minutes. The window is derived from `created_at`, never stored, so
there is no second copy of the truth to disagree with the first.

### The decisions that took the longest

- **Undo, not "are you sure?"** Pausing is reversible, so it acts and offers the way
  back. The undo *restores* rather than inverts: a selection holding a live file and a
  paused one, "put back live", and then undo puts the paused one back to paused. An
  inverse action would have made it live, which is a state it was never in.
- **The platform's state is not the seller's to move.** A file hidden while reports are
  answered is skipped by every bulk action, and *counted* — "1 file hidden after reports
  was left alone — the list says which." The undo respects a hold that arrived *after*
  the change, too.
- **A no-op is not a change.** Files already in the asked-for state are not recorded, so
  the undo does not "restore" rows nothing happened to, and a press that changed nothing
  is refused with a reason rather than an empty batch.
- **Three refusals, because they are three different facts.** Nothing arrived (`bulk-empty`),
  everything picked already says that (`bulk-nothing`), or the platform is holding
  everything picked (`bulk-held`). The first used to be reported as the second — telling a
  seller their files "already say this" about a press that sent nothing at all.
- **The filter travels with the action.** Every redirect carries `q`, `state`, `access`
  and `sort` back, so pressing Pause on a filtered list does not silently reset it.

### What testing found that reading did not

1. **The flash said "Saved."** The redirect was `saved=bulk:…`, and `flashFor` returns
   the first key it finds — `saved` is above `bulk` in the map, so a real change reported
   itself as the generic one. Static test now asserts both keys are their own.
2. **The sticky bar was not sticky.** `.panel` carries `overflow: hidden` for its rounded
   corners, which makes the *form* the sticky context: the bar sat at the bottom of an
   1,865px form, so "3 files picked" was invisible exactly when it mattered. The check in
   `bulk-click.mjs` that looked at the class name passed the whole time; the one that
   reads `getBoundingClientRect().bottom` against `innerHeight` is the one that found it.
3. **"1 file picked", "3 files picked".** A count inside a sentence is read as a claim
   about what happened; "Paused 1 files" makes a real change read as a template.
4. **The demo could not show the feature.** A store with three files has no second page
   and no "select all 29 matching". `ci/demo-state.mjs` now gives alice a seller's list —
   29 files, 26 of them created the way a seller creates them and backdated so the date
   sorts differ — because a feature that only exists at scale has to be demonstrable at
   scale.
5. **The list, on a phone.** The row checkbox used to sit in a 34px column with a "Pick"
   label of its own above each card. It now sits beside the card's title, which is how
   every list on a phone does it.

### What was run

- `npm test` — **501 / 501 / 0**, including seventeen new tests in `test/bulk.test.js`:
  the counts that partition the store, the sorts, paging, the ownership guard (a stranger's
  id changes nothing), the held-file skip and its count, the filter-as-selection path, the
  restore-not-invert undo, the hold that arrived after the change, the one-shot window, the
  three refusals, the two labelled controls, and the flash-key rule.
- `ci/eyes/bulk-click.mjs` — **20 checks, all passing**, in a real browser at 390px: the
  live count and its singular, the tri-state control, the bar pinned to the foot of the
  *window*, both scopes, the escape hatch clearing the row ticks, Clear, and the empty
  submit guard.
- `ci/eyes/columns.mjs` — **31 tables on 18 pages, 0 findings at 390px**. The rule learned
  one thing: a row may begin with a control column, so on a stacked card the name cell is
  the one after it. Labelling the title instead would have been the easy fix and the wrong
  one — a title pushed into second place is exactly the defect the rule exists to catch.
- `ci/eyes/sweep.mjs` — **56 clean, 0 with findings.**
- Looked at, in the browser: the toolbar, chips and undo strip at 1440px and 390px; the
  sticky bar with rows ticked on both; the phone card with the box beside its title.

---

## §28 — the buyer's shelf, and the line the audit never closed

### What was missing, in the audit's own words

`## 6. What is missing → Missing product surface` has carried this row since it was
written:

| Missing | Note |
|---|---|
| Following a store | absent |

Looking at it properly turned up a bigger hole next to it, which the audit never had
a row for because the product had never been read from the buyer's side at all:

**There is no library.** An unlock in this product is a **window** — `unlock_hours`,
24 by default, `0` meaning permanent — bought with an ad rather than with money. The
asset page says so in one line (`accessExpiry`), the download route enforces it, and
nothing anywhere listed what a person holds or when it runs out. A buyer who unlocked
a file in the morning had one place to find it again: the tab they left open.

### Research: what a shelf looks like when access is a window

- **Hoopla and Kanopy** are the exact shape of this problem — borrowed media with a
  stated lending period, no purchase at all. Their shelves lead with what is still
  open, print when it closes, and offer the borrow again when it does. Nobody there
  shows an expired item as a dead row; it stays visible with a way back in.
- **Gumroad's Library** is the purchase-shaped version: filter by product or creator,
  sort by date, and the tile is the way back to the content. Useful for the part that
  transfers — a shelf is scanned by what it *is*, not by when it was acquired.
- **itch.io's library and collections** show the same split this page ended up with:
  a flat shelf of what you have, and a second list of the stores you chose to keep.
- **Substack's follow documentation** is the caution on the other half. Their help
  centre has to keep explaining that a *follower* "won't get posts in their inbox",
  because the word follow is read as a promise to tell you about new files. This
  product has no way to reach a buyer at all — no buyer mail, no push — so a Follow
  that implied a notification would be a lie with a well-designed button.

What that settled, in decisions:

1. **The shelf leads with "open now", not with "recent".** The first number on the page
   is how many files can be opened this minute; the rest is under *Ended*, still
   visible, with the way to open them again.
2. **"Not open" is three different facts, not one.** *Ended* (the window closed),
   *Taken back* (the platform or the seller revoked it — the row says the record stays),
   and *File taken down* (the store paused or removed the file after it was unlocked).
   Collapsing them into "unavailable" would have been four lines shorter and would have
   told a person nothing about what happened to their unlock.
3. **The follow is a row and a count, never a message.** `follows(profile_id,
   channel_id, created_at, seen_at)`, `seen_at` moved by *reading the store*, and "N new
   files" derived at read time from it. There is no `notifications` table waiting to be
   wired and no copy that says "we'll email you" — the page says the opposite, twice.
4. **A file is not sold here.** The lede prints the platform's own rule where a buyer
   reads it for the first time: *you watch an ad, the network pays the creator directly,
   and bytebikri takes no cut of it. Nothing here has a price.*
5. **The count only promises what a reader can find.** "New" means live *and*
   searchable, so a store's first file waiting for its human review is not announced,
   and neither is a file the seller has since paused.

### Built

- `0029_follows.sql` — the pair-keyed table, `seen_at` seeded at follow time (a store
  followed today has nothing "new" in it), two indexes, no notification state. Migration
  0029; the test database is built from the same files.
- `store.myUnlocks` / `unlockCounts` / `followChannel` / `unfollowChannel` /
  `followState` / `markChannelSeen` / `followedChannels`. `markChannelSeen` is an
  **update, never an insert**: opening a store moves a line only for somebody who
  already follows it, so browsing cannot subscribe anybody. `grantUnlock` was already
  the one grant path, so nothing about the shelf can disagree with the route.
- `views.library()` — the shelf (open, then ended/revoked/taken-down), the followed
  stores with their count, the unfollow flash strip with its way back, and the
  `no-store` case for a slug that no longer resolves. Two sections are conditional, so
  an empty shelf is three sentences and a pointer to Explore rather than four empty
  headings.
- `views.watchControl()` on the storefront — rendered only for a signed-in person who
  does not own the store, with the sentence about what following does not do. Four
  routes: `POST /s/:slug/watch`, `POST /s/:slug/unfollow`, `POST /library/follow/:slug`,
  `POST /library/unfollow/:slug`, all behind one 60/min limiter, all redirecting back to
  where the person was standing.
- The storefront now moves a follower's `seen_at` when it is opened, and so does the
  file page — reaching a file means reaching the store that keeps it.
- `ci/demo-state.mjs` seeds the shelf through the store's own calls: an ad unlock with
  its window open, a free file with no window, a window closed two days ago with the
  review it produced, a file paused by its seller after it was unlocked, and two
  followed stores (one with 16 new files, one whose single file is still waiting for a
  person). All five states on the shelf are visible in the preview.

### Found by doing it

1. **Every store page linked a dashboard that was not the reader's.** `activeChannel:
   channel` was passed unconditionally, so a signed-out visitor to `/s/alice` got a nav
   link to `/dashboard/alice` — which 404s for them, and reads as a broken product. Now
   the link appears only for the owner (that page and the asset page).
2. **"3 new files" next to "1 file live" would have been a page contradicting itself.**
   `new_count` counted anything not removed; the card's own tail prints the store's live
   count, and the storefront shows live files. A paused file is not news. One clause
   (`status = 'live'`), one more test, and the two numbers agree by construction.
3. **The library dropped the Dashboard link for sellers.** A seller reading their shelf
   lost the one nav item they use most. The page now receives the person's own channel
   and the nav splits at that name, exactly like every dashboard page.
4. **`?unwatched=` was a reflected string waiting to happen.** It is the only query
   parameter this page echoes, so it is validated as a slug shape at the route *and*
   escaped at the render — and there is a test that posts markup through it.
5. **`channels.cover_url` does not exist.** The first query was written by habit from
   `assets.cover_url`; the store columns are `avatar_url` / `banner_url` / `logo_url`.
   The probe caught it in one run, which is the argument for probing new queries against
   the real schema instead of reading them.

### What was run

- `npm test` — **513 / 513 / 0**, including twelve new tests in `test/library.test.js`:
  the window the route would check, the file its seller took down, follow idempotency,
  unfollow-as-delete, the visit that moves a line only for a follower, the paused file
  that is not news, the unreviewed file that is not news either, shelf ordering, the
  counts that come from the account rather than the rows drawn, the promise that is
  never made, the empty shelf, and the escaped `?unwatched=`.
- `ci/eyes/sweep.mjs` — **64 clean, 0 with findings** (`/library` added for operator,
  alice, nima and bob; the four new pages are in the count).
- `ci/eyes/columns.mjs` — **31 tables on 18 pages, 0 findings at 390px** — the new page
  uses no tables, which is the point of a shelf.
- Migration 0029 applied to the dev database and to the test database built by
  `scripts/test-db.mjs`.
- Driven over HTTP with a real session: the signed-out redirect to
  `?next=%2Flibrary`, follow → `?stop following`, unfollow from the library →
  `?unwatched=…` with the way back, a slug that does not resolve →
  `?error=no-store`, the owner's own store → no row written, a non-follower's visit →
  no row written and no count moved.
- Looked at, in the browser: the library at 1440px and at 390×844 (full page), the
  store header with the Following pill and its sentence at 390px.

---

## §30 — Members: paying the creator, and the platform staying out of it

### The user's question, and the answer the product gives

> *"paid feature — make channel members joinable. else no membership option (or is that too
> harsh?)"*

**Not too harsh, but the harshness was in the wrong place.** Watching a store is free for
everyone forever (0029) and stays free — that is the thing a person does before they decide to
pay anybody. What the Store plan buys is the *relationship*: up to two tiers, a roster with the
person's own name on it, a plate next to that name on the storefront, and files that open for
them with no ad. Same shape as the marketplace rule already in the plans table: being found is
free, the relationship and the reach are what a plan is for.

And the dues do not go through bytebikri at all. This is the structural version of the standing
rule — *no money goes to a user through us* — applied to a flow that would normally be a
platform's proudest feature:

- the store publishes a payment instruction in its own words (eSewa id, bank line, "at the shop");
- the member sends the money to the creator, then records the reference;
- **the creator confirms it against their own statement**, and nobody else can: `confirmMembership`
  is scoped to `channels.owner_id` in SQL, so an operator cannot confirm a membership even by
  accident — the platform never saw the money, so there is nothing here to check it against.

Consequences, stated on the page rather than discovered later: bytebikri takes no share, holds
nothing, cannot confirm and cannot refund a dues payment. `MONEY_LINE` says exactly that, and it
is asserted in tests and printed under every button that asks somebody for money.

### What was decided, against what was researched

| Decision | Source of the shape |
| --- | --- |
| Three tiers maximum → **two** | Patreon's own best-practice post and the 2026 tier guides converge on three at ~3x/10x, and all of them warn that the failing pattern is *more tiers than perks*. Two is a name tier and an elite tier — what a creator with fifty members can keep promises about. |
| The plan pays for members, not the member | The researched membership products (Patreon, Fiverr, Discord boosts) all charge the member through the platform. That rail is exactly what this product refuses to be, so the platform charge moved to the seller's existing annual plan — a charge that already exists, on a product the seller already buys. **No third charge appears anywhere.** |
| The top tier shines, the entry tier does not | Discord's *Enhanced Role Styles* and the admin guides on them: keep gradient and holographic effects to one or two roles, or nothing on the page stands out. Derived from `plateStyle(tier_no)` rather than offered as a setting, so a store cannot accidentally make everybody elite. |
| A member's **name** is a solid colour, and the gradient goes on the 2px ring, the avatar and the tier chip | Gradient *text* is contrast-checked at its worst stop, not its average — the guidance is to decide the text colour first and put the gradient where its worst point can be proven. Eight palettes, each checked at 4.5:1:1 for ink on both themes and white-on-gradient at both stops, in `test/contrast.test.js`. |
| The shimmer is declared inside `prefers-reduced-motion: no-preference` | The researched pattern is to build the static version first and *add* motion for people who have not asked for less, rather than adding it by default and taking it back. Asserted in `design.test.js`. |
| A members-only file stays **listed**, locked, with its title and description | Every paywall study worth reading says the wall goes on the content, never on the teaser. A store whose members-only files vanish from its storefront has nothing to sell — so the card stays, wearing "Members" and the sentence naming the tier that opens it. |
| A new period is **added** to the time left, never in place of it | Patreon documents the same rule for membership changes; paying early must not cost the days already paid for. `greatest(coalesce(period_end, now()), now()) + interval`. |
| A lapsed membership closes files, deletes nothing | No `lapsed` status exists to be rewritten by a job nobody ran: `period_end < now()` *is* the end. The unlock row a membership wrote carries that date as its expiry, so `isUnlocked` — already the one rule at the content boundary — closes the file by itself. |

### The three states a person can be in, and why each needed its own page

1. **A stranger.** Sees the tiers, the perks, the creator's payment instruction and the plate
   sample — the plate *shown*, not described, because a decoration is what is being sold. The
   form needs an account; the shop window does not.
2. **A claim waiting.** "Your claim is with the creator" — with the reference echoed back, the
   date, and the sentence that says this is a wait and not a bug. The researched lesson from
   the shelf round applies again: never imply a notification that does not exist.
3. **Current, and lapsed.** Current says which tier and how many days; lapsed says the plate goes
   quiet and the files close, and that nothing was deleted.

Plus the seller's four: the queue (reference in mono, amount, method, date, then confirm/reject),
the payment instruction, the two tier editors, and who is in.

### What was built

- **`db/migrations/0031_memberships.sql`** — `membership_tiers` (max two, `dues_npr`,
  `period_months ∈ {1,3,12}`, a named palette), `channels.membership_note` (the public payment
  instruction), `memberships` (one row per person per store, a claim plus the creator's
  confirmation), `mode = 'members'` added to both copies of the access axis, and
  `unlocks.method` widened with `'membership'`. Two constraints do real work: a confirmed row
  must carry `confirmed_at` and `period_end` (they are written together or not at all), and a
  pending row must carry a reference of at least four characters — a claim nobody could look up
  is a claim that can never be cleared.
- **`app/src/memberships.js`** — pure module, no database, no markup: the eight contrast-checked
  palettes, tier validation, the period maths, `membershipState()` (the derived clock),
  `opensFor()`, `memberRefusal()`, and the money sentences that must be true wherever dues are
  mentioned.
- **`app/src/store.js`** — tiers (save/remove, refused while held), the note, join (an upsert, so
  a typo edits a claim instead of stacking a second one), confirm (owner-scoped in SQL, adds the
  period), reject, leave (a delete, with the audit row kept), the seller's queue and roster, the
  public roster, and `grantMembershipUnlock` — deliberately not `grantUnlock`, because that would
  overwrite a permanent unlock with the membership's end date.
- **`app/server.js`** — 8 routes; the storefront passes four membership reads; the asset page and
  the content boundary both ask the same question (a membership is a third way in, and the first
  fetch writes the row); the seller's asset form gained "Members only" and the tier it wants.
- **`app/src/views.js`** — the roster, the member's own card, the join panel, the seller's page,
  the gate on a members-only file, the "What you get" panel (which must not describe an ad for a
  file no ad opens), and the tier select in `assetManage`.
- **`app/public/styles.css`** — the plates, the roster grid, the tier cards, the join panel, the
  queue, and the four plate custom properties defined at `:root` (a rule that reads an undefined
  property is dropped silently — the one failure a stylesheet cannot report).

### What went wrong, and what was found by looking

1. **`membership_tiers` had no primary key.** The composite foreign key that makes "you cannot
   delete a tier people are holding" true has to point at a unique constraint, and there wasn't
   one. Silent in review, an error at migration time.
2. **A claim with no reference was reaching the queue.** The store now refuses it, the route
   refuses it, and the CHECK constraint refuses it — three times, because this field is the whole
   manual rail.
3. **The asset page told two outright lies on a members-only file**: the stage read "Unlocks
   after the ad" and "What you get" said "1 rewarded ad". Both now say which lock it is. Found by
   screenshotting the page, not by reading the template.
4. **`membershipsOn` was read before it was destructured** in `assetManage` — three existing
   tests caught it, which is the argument for the class/undefined-property tests in `ui.test.js`.
5. **`#members` landed under the sticky header** on a wide screen: the scroll offset only existed
   inside the phone media query, and the new file-page button jumps to that anchor. Now the offset
   is written once, at the base, with the phone block keeping its larger value — and a browser
   probe asserts the heading arrives *below* the header at 1440 and 390.
6. **"1 person hold this tier."** Grammar, caught in the seller's screenshot. Fixed where it was
   written.
7. **`memberStore` had to be resolved locally in the seed.** The block was inserted above a
   `const nimaStore` it read; that is a ReferenceError, not a subtle wrong answer.

### What was run

- `npm test` — **537 / 537 / 0**, including ten new tests in `test/members.test.js` (owner-only
  confirmation, the refused claim, the derived lapse with no `lapsed` column, the period added to
  time left, tier-scoped file access, the unlock that is extended and never shortened, the
  storefront teaser, the Free-store upsell, the tier editor's refusals and the held tier's
  immovability, the queue as a statement would show it, and leaving) plus a contrast test that
  proves all eight palettes in both themes at both gradient stops and two design tests holding
  "the shimmer is on the ring, not the name" and "the motion is opt-in".
- `ci/eyes/sweep.mjs` — **64 clean, 0 with findings**.
- `ci/eyes/columns.mjs` — **28 tables on 16 pages, 0 findings at 390px** (the new page adds a
  table, and it scrolls).
- Browser-measured: the anonymous panel (tiers shown, form gated), Bob's pending claim rendering
  its own card, the day theme's ink (violet `#6d28d9` on white, 7.1:1), and the anchor landing
  below the header at both widths.
- Driven over HTTP: the storefront, the file page as a member (opens with "91 days left" and no
  ad), the seller's queue with the seeded claim.

---

## §31 — The storefront look the plans had been selling since migration 0001

### What was asked

Continue the paid-feature round: "discord like design additions in channel/store for payers —
design additions, animations (store features) effect and animations on names, texts etc (do your
research) like example what discord does (other app research)". The member plates and the name
effect shipped in §30. This section is the **store-level** half: the look of the shop itself.

### What the recon found, before anything was built

`plans.capabilities.can_theme` has been `false` on Free and `true` on Store and Pro **since
migration 0001** — written into the seeded capabilities of both paid plans, documented in the
column's own comment, and **read by nothing in the product**. Not by the routes, not by the views,
not by a test. `planBenefits` did not list it either: the line that would have printed read
`c.theme_custom`, a capability name that exists on no plan, so it was dead code in a benefit list.
Two halves of one gap — a bullet that could never print, for a feature that was never built —
sitting under a price for three migrations. This is the same shape as the badge in §25 and the
identity check in §29, and the third time this audit has found a capability with a price tag and no
behaviour behind it.

### What was built

**A curated list of six palettes, not a colour picker** — `app/src/themes.js`, migration
`0032_store_theme.sql` (`channels.theme`, `channels.theme_set_at`).

The research is Gumroad's design tab and Linktree's pricing page. Gumroad ships **curated** fonts
and colours with a preview that updates as you choose — a list, not a wheel. Linktree puts custom
colours and backgrounds behind its paid plans and keeps "basic themes" free. This feature takes the
first half of each and refuses the second, for a reason that is arithmetic: **a storefront whose
text colour is chosen by the seller is a page whose contrast no test can check.** So the palettes
are chosen to pass, and `test/themes.test.js` proves it at both ends of every gradient *and at the
middle* — where a two-point check would miss a collapse — with white at **≥5.5:1 everywhere**, which
is the margin that lets the band's secondary ink (92% white) clear the 4.5:1 body floor with room
left over.

**The band, and only the band.** The theme paints the store's own header — name, tagline, counts,
badges, follow button — as an opaque gradient of the palette's two stops, with every word on it
white. It reaches nothing else: the file cards, the buttons on them and the member plates keep the
product's colours. Opaque rather than a wash is the decision that makes the whole feature checkable:
a wash would need measuring against both the day and the night surface and would be too faint to
notice on either; an opaque band is identical in both, so one number per stop governs every word in
it, in both directions. Pills and the button inside the band invert to a white surface with the
palette's deep stop as ink — the same ratio read the other way, so nothing inside the band opens a
second contrast question.

**Three of the six drift, and every drift is opt-in.** The animation lives inside
`@media (prefers-reduced-motion: no-preference)`, moves `background-position` only (never the text),
and takes 26 seconds to cross. Measured in a browser: `animation-name: theme-drift` under
`no-preference`, `none` under `reduce`, with the theme itself still showing.

**The gate is honest on both sides.** A paid store gets the six cards, a live preview of **its own
name** on each band, and the way back to the default as a first-class choice. A Free store sees the
same six at full colour with a `Store plan` chip on each and one sentence saying what the plan adds
and what it keeps — the cards are *not* dimmed, because a washed-out pastel is a picture of nothing
and the swatch is the one thing on that page that sells the feature. Hiding the list would be the
other kind of lie: a capability nobody knows about is a capability nobody buys, and this one has
spent three migrations in exactly that state.

**The gate is read, never restated.** `store.setChannelTheme` resolves the capability through
`this.plan(channel)` — the one method that knows about grace periods and pending upgrades — and
`updateChannel`'s allow-list deliberately does **not** carry `theme`, so no future form that posts
the whole channel set can set one on a Free store. The audit row records the **previous** value,
because "when did my shop start looking like this" is asked after a rebrand.

**And the pricing page now admits the feature exists**: the dead `theme_custom` line is replaced by
`can_theme` and a sentence saying what the look is. `test/billing.test.js` now holds the capability
and the sentence together in both directions — a plan that can theme must say so, and a Free plan
must not be sold it.

### Also in this section: the premium showcase

The tier cards now **name the files they open**, with a lock glyph and a link to each — the shape
Patreon's tier list and Substack's locked posts both use, and the reason a card promising "bonus
content" converts nobody. A tier with nothing behind it says so out loud, on the storefront, where
the seller will see it. The seller's own tier editor reads back what is behind each tier from their
full file list — paused files included — so deleting a tier never happens blind.

### What went wrong, and what was found by looking

1. **The first live screenshot showed the name hard against the edge of the band.** The band rule
   was written as `.store-head--themed` only; the product's plain `.store-head` had never carried a
   padding because it had never carried a background. Fixed by giving the box itself the padding and
   the radius, so "Default" is a colour change and never a layout change.
2. **The first arithmetic was wrong, and the test said so.** The wash was 10% over the surface —
   which made every palette fail on the night theme (everest 2.66:1) and put the rule under the
   threshold in both. The band became opaque and the palettes were re-picked against the numbers
   rather than the numbers being loosened to fit the palettes. `#1d4ed8` → `#1e3a8a`, and so on.
3. **`--theme-from`, `--theme-to` were referenced but never defined** — the `:root` omission this
   repository has hit twice before (`--plate-*` in §30). Caught by `ui.test.js`, fixed at the base.
4. **The theme route built a fragment wrong** — `#theme?error=x` is a fragment called
   `theme?error=x`, which the browser never sends. Caught by `verification.test.js`'s per-route
   sweep; now `back(qs)` with the query built before the anchor, the same shape the verification
   routes use.
5. **`$2::text`** — Postgres could not infer the type of a parameter that appears only inside
   `is null` (42P18), so the first palace of the update failed.
6. **The roster table slid off a phone.** `columns.mjs` found five columns 570px wide inside a
   350px box on `/dashboard/:slug/members`. It is the table a seller opens on a phone, in a queue,
   checking who paid — now `table-stacked` with every cell labelled.
7. **`planBenefits` was reading `theme_custom`**, a capability that exists on no plan. Dead code
   for an unbuilt feature; now `can_theme`, and asserted.
8. **A `test/ui.test.js` assertion had become a proxy.** The old test asserted `/disabled/` was
   absent from the paid settings page — which stopped meaning "the listing radio works" the moment
   the page grew a second gated control. Narrowed to the control it is about, and the theme control
   got its own test.
9. **Montage panels are not self-describing.** The first assembly put the "after" caption under the
   "before" panel. Rebuilt with a fixed geometry and re-read.

### What was run

- `npm test` — **553 / 553 / 0**, including eleven new tests in `test/themes.test.js` (white at
  ≥5.5:1 at both ends and the middle of every gradient, the 92% ink at the body floor, the inverted
  controls measured against the same ratio, the curated-list invariants, the tokens the page paints
  are the tokens the tests composite, the two emitted properties and nothing else, every refusal
  (`theme-unknown`, free-form hex, markup), the capability read from the real `PLANS`, the motion
  sentence for both kinds of palette, every drifting rule inside its guard, and the band reaching
  nothing below it), three new member tests for the showcase and the roster's phone shape, and the
  billing test that holds the capability to the pricing line.
- `ci/eyes/sweep.mjs` — **66 clean, 0 with findings** (two pages more than §30: the theme adds no
  route but the sweep list grew).
- `ci/eyes/columns.mjs` — **32 tables on 19 pages, 0 findings at 390px** (was 1 finding; the roster
  fix above).
- Browser-measured: the band's computed gradient in both themes, white ink at `rgb(255,255,255)`,
  the drift present under `no-preference` and absent under `reduce`, the chooser's seven cards with
  the theme in force marked `aria-pressed="true"`, and the Free store's cards disabled but
  full-colour.
- Driven over HTTP: Nima's storefront (banded), a free store's settings page (all six shown, chip
  on each), and the storefront's tier cards naming the file behind each tier.

### What is deliberately not here

Per-store fonts, free-form colours, and seller-authored CSS. Each is a promise about readability that
no test can keep, and each can be built, checked and sold on its own terms later. (A per-store footer
removal was in this list and is not any more: §33 built it, with the platform's own legal notices
excluded — the one part of a footer that is not a store's to remove.)

---

## §31b — The revenue architecture of memberships, priced from the code that already priced it

### The question this answers

"Also another feature: members joinable which will also contain ad space for me and store seller as
well… adds ad slots and payment coming benefits to us… how did u make the revenue arch for these
features?" It deserves a precise answer, because the honest one is *not* a new revenue line. It is
that memberships sell a relationship and a gated file, and **every rupiah of rent already existed
before memberships did**.

### The model, in the order money actually moves

| Leg | Payer | Payee | bytebikri's position | Where it is in the code |
|---|---|---|---|---|
| Ad revenue, per ad | The ad network | The store's own account | **Not a party.** 0%, and not a rate — no path | `src/slots.js` (`payoutParty: 'channel'`), the earnings page's money map |
| Membership dues | The member | The store owner, e.g. eSewa → eSewa | **Not a party.** Never receives, cannot confirm, cannot refund | `memberships.claim*` on the row; `confirmMembership` scoped to `channel.owner_id` in SQL |
| Store upgrade | The seller | bytebikri | **Revenue 1** — NPR 999 / 2,499 a year, pro-rated | `plans.priceNpr`, `upgradeExplanation`, `recordPlanPayment` |
| Annual rent | The seller | bytebikri | **Revenue 2** — one platform slot per page, priced from the store's own measured traffic, 12 × the monthly estimate, **zero below the 3-slot threshold** | `slots.js` `POLICY` + `billing.js` `annualRentNpr` |

**Two charges. No third.** The membership adds nothing to that column: a store that sells memberships
pays exactly what it paid before, and its dues do not appear in any bytebikri figure anywhere.

### The ad-space half, and the correction that comes with it

The user's instinct — "contain ad space for me and store seller as well" — is right about the
mechanism and needed one correction, and the correction is the interesting part.

**Mechanism, already built and unaffected by memberships:** every storefront and file page carries
the shop's own positions (plan-dependent: 3 / 5 / 8) plus **one** platform position, allocated by
`slots.js` under four stated fairness rules — the platform never takes rank 1, never more than one
slot per page, never takes a slot from a page with fewer than three, and an empty slot keeps its
height so nothing reflows on load. `payoutMonday`… rather, each slot carries `payout_party`:
`'channel'` for the store's, `'platform'` for the rented one. Measured live on `/s/alice`: two slots
on the page, the store's at y = 651 (rank 1, first thing under the header) and the platform's at
y = 4,356 — last, below everything the store sells.

**The correction:** a paying member does **not** get the page's ads removed. Adding that would mean
either (a) the store loses ad revenue on exactly the pages its paying members read, or (b) the
platform stops renting its slot there — and (b) is precisely the rent being priced on that traffic.
It would make memberships cannibalise the platform's only traffic-linked revenue.

What happens instead, and what is now written on three surfaces: **an ad may sit around a member's
content and never inside it.** A members file opens because the dues are current, never because
somebody watched something first. And that is not a compromise — it is where the market has landed,
measured in September 2026:

- **YouTube Premium is defending two class actions** (California; British Columbia, filed
  2026-08-21) over its "ad-free" claim, on the argument that a creator's sponsored read is still an
  ad the subscriber paid to avoid.
- **Disney+ rewrote its subscriber agreement** so that all tiers — including the ad-free ones — "may
  include promotional content, sponsorships, and advertisements before/after playback", and
  subscribers started closing accounts over the *report* of it before Disney clarified nothing had
  changed for them yet.
- **Medium's entire pitch is "no ad strip"** on a member-funded platform, and **Substack's own
  support pages** say the model is subscriptions rather than advertisers, with paid posts carrying
  none of them.

The line all four draw is *interruption vs placement*. bytebikri already draws it structurally: a
member's file is opened by an `unlocks` row, not by an ad view.

### Why the AdSense "premium ad-free tier" idea was rejected

It is a real industry pattern and it does not survive contact with this product's own rule: **the ad
networks pay the store's own account directly, so bytebikri cannot withhold an ad's revenue from
anybody.** "Join a premium tier and we will suppress the seller's ad" is therefore not ours to sell
— it would mean reaching into money we never touch. That option needs the seller's consent plus a
platform-side setting, and it is recorded as open in the audit's missing-surface table rather than
half-built.

### What was written in code (not just decided)

`src/memberships.js` now carries the arrangement as data, so a page cannot print a stale version:

- `MEMBER_AD_LINE` — the promise to the member, on the member's own card and on the join panel
  (both the signed-in and the anonymous branch, because a visitor deciding whether to make an account
  is the person who most wants to know what the ads do).
- `ADS_AROUND_LINE` — the same arrangement said to the seller.
- `SELLER_DUES_LINE` — "Dues are 100% yours. bytebikri never receives them, which is not a 0% rate,
  it is the absence of a way to take one."
- `revenueRows({planName, planPrice, slotCount})` — pure, and it reads the platform's slot count and
  the `minTenantSlotsBeforeTax` threshold **from `slots.js`**, so the panel and the allocation policy
  cannot drift.

**The money map gained its third leg.** `MONEY_MAP` had two entries — what the network pays the
creator, and what the creator pays the platform — and the earnings page's own heading is *"Where the
money goes, and who is holding it. It is not us."* Memberships added a flow between two people who
are both not us, and a map that omits a flow because the platform is not a party to it stops being a
map the first time somebody pays somebody here. `toCreatorFromMembers` now renders as its own panel
on the earnings page: paid by your members, into your own account, **held by bytebikri: nothing,
ever**, **0% to bytebikri**. Same four-phrase shape as the other legs, and the earnings test holds
that shape, because this structure is also the landing hero's four equal boxes.

**The seller's page gained a section, "Where the money goes"** — four rows: what they collect, what
bytebikri charges them (two things, named with prices), where the ad positions are (arithmetic:
"you keep 4 of the 5"), and what their members will see. The rent figure itself stays on the earnings
page, one link away, because it is an estimate until an invoice exists.

### Three claims that had quietly stopped being true

Memberships turned out to be a lie-detector for sentences written when nothing here was sold:

1. **The house creative in the platform's own ad slot** — printed on every storefront — said "No cut
   of the store's sales — there are no sales." There are dues now. It reads: "No cut of what the
   store earns — dues included."
2. **`NOT_CHARGED`**, the billing page's list of what a seller is *not* charged for, said "no
   commission, because no money changes hands for content." Money changes hands for content now —
   member to creator. The surviving claim is the real one: no percentage and no mechanism.
3. **`MONEY_MAP.toPlatform.detail`** said "neither is charged on a sale — there is no sale."
   `test/earnings.test.js` asserted `/no sale/i` on it, which is a test holding a sentence in place
   rather than a fact: it now asserts the claim that survives every model this product grows into —
   the platform's two charges are never a share of what a store earns, and the line names dues.

### What was run

- `npm test` — **555 / 555 / 0**, including three new tests: the money map's third leg (its answers
  are phrases of the same length as its neighbours', and its detail names rails a Nepali member can
  actually use); the seller's rows are arithmetic read from
  the slot policy (and a short page is told "no rent to price" instead of a split of positions never
  taken from it), and the member's promise is present on the selling page **before** anybody sends
  money, on the anonymous branch too, and on their own card afterwards.
- `test/earnings.test.js` — the money-map assertion moved from a fact that expired to a claim that
  cannot.
- Browser-measured on `/s/alice`: the page carries exactly two ad positions — the store's at rank 1
  under the header, the platform's as the last element in a 4,837px document — which is what makes
  "around the content, never inside it" a description rather than a slogan.
- Screenshots of all three surfaces: `/home/user/revenue-architecture.png`.

### What the browser found that nothing else could

The pass was not a formality. Five defects came out of looking at live pages, and every one of them
would have passed the whole suite:

1. **The asset page threw `policy is not defined`** — a variable that existed only inside one argument
   list in a route composition, so every file page on the platform was a 500. The route was untested and
   the view tests drove the view directly. A single page fetch found it in a second.
2. **`resolveSession` did not carry the arrangement.** `plusWear()` refuses to dress anybody it cannot
   prove, and `req.user` had no subscription columns — so the header chip and the arrangement panel both
   said "nothing is being worn" to a person wearing a halo at that moment. The join moved into `plus.js`
   and is now imported by `store.js`, `auth.js` and the roster queries: one copy, one answer.
3. **Every file's ask was five seconds.** The platform's floor is 15 (a rewarded view shorter than that
   is not a thing a network serves), and 0034's clamp only pulled *downward* — so the rows the old form
   had defaulted to five seconds kept an ask the pipeline could never satisfy. The migration now raises
   the floor as well, with the reasoning in the comment: no row gains a second ad, and `ad_band_npr` is
   deliberately NOT filled in, because those asks were typed by hand before the ladder existed and a
   calibration claim the row cannot support is worse than a null.
4. **The withheld rung's only route forward was a lie.** Its button said "Open it by joining Alice's
   Studio" — but membership opens the store's *member* files, not this ad-gated one, and in a store with
   no tiers the anchor pointed at nothing at all. The view now renders the offer only when the store has
   memberships (`hasMembers`, computed server-side), says what membership does *not* do, and in a store
   without them says the honest thing instead: waiting is the way back here.
5. **`askReason` lowercased a currency code** ("under npr 200") and a file with no value was described as
   "valued at free". And with the two levels resolving to the same number, the panel drew a two-option
   radio group where both options did the same thing; it now draws one, with a line saying why there is
   nothing to choose yet.

Also caught in the pass: `PLUS_NOT`'s third line rendered literal backticks around `ranking.js`, and the
"Stop at the end of this month" button stopped the arrangement *that day*. The first is now a sentence;
the second is now labelled "Stop it early", with a line saying the paid month does not come back — and
pointing at the cheaper route (choose the plain effect) for anybody who only wanted to be quiet for a
while. `/plus/join` also now enforces the same confirmed-address boundary the store money routes do,
rather than relying on the view to have said so.

### What the browser found that nothing else could

The pass was not a formality. Five defects came out of looking at live pages, and every one of them
would have passed the whole suite:

1. **The asset page threw `policy is not defined`** — a variable that existed only inside one argument
   list in a route composition, so every file page on the platform was a 500. The route was untested and
   the view tests drove the view directly. A single page fetch found it in a second.
2. **`resolveSession` did not carry the arrangement.** `plusWear()` refuses to dress anybody it cannot
   prove, and `req.user` had no subscription columns — so the header chip and the arrangement panel both
   said "nothing is being worn" to a person wearing a halo at that moment. The join moved into `plus.js`
   and is now imported by `store.js`, `auth.js` and the roster queries: one copy, one answer.
3. **Every file's ask was five seconds.** The platform's floor is 15 (a rewarded view shorter than that
   is not a thing a network serves), and 0034's clamp only pulled *downward* — so the rows the old form
   had defaulted to five seconds kept an ask the pipeline could never satisfy. The migration now raises
   the floor as well, with the reasoning in the comment: no row gains a second ad, and `ad_band_npr` is
   deliberately NOT filled in, because those asks were typed by hand before the ladder existed and a
   calibration claim the row cannot support is worse than a null.
4. **The withheld rung's only route forward was a lie.** Its button said "Open it by joining Alice's
   Studio" — but membership opens the store's *member* files, not this ad-gated one, and in a store with
   no tiers the anchor pointed at nothing at all. The view now renders the offer only when the store has
   memberships (`hasMembers`, computed server-side), says what membership does *not* do, and in a store
   without them says the honest thing instead: waiting is the way back here.
5. **`askReason` lowercased a currency code** ("under npr 200") and a file with no value was described as
   "valued at free". And with the two levels resolving to the same number, the panel drew a two-option
   radio group where both options did the same thing; it now draws one, with a line saying why there is
   nothing to choose yet.

Also caught in the pass: `PLUS_NOT`'s third line rendered literal backticks around `ranking.js`, and the
"Stop at the end of this month" button stopped the arrangement *that day*. The first is now a sentence;
the second is now labelled "Stop it early", with a line saying the paid month does not come back — and
pointing at the cheaper route (choose the plain effect) for anybody who only wanted to be quiet for a
while. `/plus/join` also now enforces the same confirmed-address boundary the store money routes do,
rather than relying on the view to have said so.

### What a SECOND browser pass found, on a rebuilt workspace

The first pass above was lost to a workspace restore, so it was repeated on the pushed tree before this
round was called finished — and the repeat was worth it, because a checkout that *looks* current can
still be lying:

1. **"The ask is never typed" had three doors still open.** The publish form kept its "Minimum ad length"
   box and `POST /assets` honored it; the demo seed called `setAdMinSeconds(..., 5)` three times "for
   demo friendliness"; and `store.setAdMinSeconds` was a public setter with no policy in it. The file page
   showed the result of all three at once — *"Now: 1 ad of 5 seconds"* printed directly above the ladder's
   *"1 ad of 15 seconds"* — which is how it was found: not by a test, by reading one panel. Fixed in
   `0035_ask_floor.sql` (bounds as CHECKs on both `asset_unlock_policy` and `pending_views`, so no future
   writer can route around them), plus the deletion of the setter and the form field.
2. **The panel called the value a "price"** in its own footnote, two lines under a field whose hint says
   "not a price".
3. **The ladder's middle rung over-promised membership** — "opens its files with no ad at all", on an
   ad-gated file — which is the same half-truth the withheld rung had already been corrected for. Both
   ends of the ladder now describe membership by what it opens and say what it does not do.

The second pass also produced the measurements this round is judged on, and they are all read off live
pages: `/s/alice` carries **two** ad boxes (the store's at y=607, ours last at y=4,356 of a 4,741px
document), `#members` at Nima Crafts renders alice's name as `member-name member-name--aurora` — the
teal palette a person paid NPR 149 for — the operator's queue shows Carol's claim with its reference,
amount and both buttons, the withheld rung offers no button and no dead anchor, and no page in the set
had a console error or a horizontal overflow.

### Still open, recorded rather than half-built

- **A seller-paid ad-free experience for their members** (the fee the platform would charge to drop
  its own rented slot and the store's positions on a member's pages). It needs a capability, a price
  and a rule about the platform's rent; it cannot be done by withholding revenue bytebikri never
  receives.
- **A dues-based rent component** — whether a store with a large paying roster should pay more rent
  than the flat traffic-priced one, which is the same open question as §30's roster pricing.
- **Which region's viewers actually monetise the rented slot at all** — Nepal's display fill is real
  but thinly measured, and the estimate is currently honest about being an estimate rather than
  about its own error bar.

## §32 — The ad economy, the person's premium, and what happens when the ad never arrives

The brief for this round, in its own words: *"premium means more features included… for a customer too
if they want sleek designs and animations to be a premium member pay us… and if the store owner pays
and unlocks features channel inside channel or premium content separately for certain users we get ad
space there too… required ads to watch or length should vary per the cost of the asset… and only 1 or 2
space inside the store for ad spaces… before applying it all do a sentiment analysis… also take
measures against ad blocker and Brave browser from requesting user to turn off to if not turned off the
no content shown… research it all and expand my concept then apply."*

The sentiment analysis is `AD_ECONOMY.md` (sources, findings, and the decision each one forced). This
section is what was built, and the four things that had been sitting in this audit as open questions
that this round actually closed.

### The third charge, and it is cosmetics

`/plus` — **ByteBikri Plus**, NPR 149 a month, paid to bytebikri by a *person* for how their own name
looks: one palette (eight, contrast-checked), one effect (plain, a static gradient edge, or a slow
halo), worn wherever this platform shows their name to somebody else — a store's roster, the seller's
member queue, a review, the account chip. Migration `0033_buyer_plus.sql`; three tables that mirror the
store side deliberately (`customer_plans` / `customer_subscriptions` / `customer_plan_payments`), and
the same manual rail: a claim is a reference, an operator matches it against the platform's own
statement, and only then does a month start.

Two flags are the whole design, and both are asserted false in `test/plus.test.js`:
`opens_content: false`, `removes_ads: false`. **A cosmetic that could open a file would be a hole in
every creator's paywall at once**, and an ad-free promise would be selling the creator's ad revenue —
which leg 1 pays network-to-store, and which bytebikri never receives. The words "no ads" appear
nowhere; the page carries a full "what this is not" list instead, because the complaint that damages a
cosmetics tier is never the price, it is "I thought it also…".

The entitlement needs no job. `PLUS_JOIN` in `store.js` is a lateral join on
`status = 'active' and period_end > now()`, so a profile row read at any moment carries the truth about
the look; `plusWear()` re-checks and refuses anything it cannot prove. A palette is a preference and is
never deleted — it simply stops being worn.

### Density: one or two positions, not three to eight

Migration `0034_ad_economy.sql` re-points `plans.capabilities.slot_count` from 3/5/8 to **1/2/2**, and
`allocateSlots()` was restructured with it: the platform's position is now the **next rank down** rather
than one converted from the store's own. That conversion was the bug waiting to happen — at a cap of
one it would have handed us a Free store's only position, at rank 1, which is the single rule this
policy has never broken. `maxTotalSlots = 3` now bounds the sum, `minTenantSlotsBeforeTax` falls from 3
(which the cap had made unreachable, silently killing the rent leg) to 1 with its promise restated as
"a page with no position of its own is never taxed", and ranks 4–5 of `SLOT_DEFS` are kept but marked
inactive because sellers' `slot_creatives` rows still name them — the slots page lists those retired
messages rather than letting them vanish.

Density stopped being the upsell. The paid plans buy capability: a second position, a higher ask
ceiling, members, a theme, a badge. The price did not move.

### The ask is derived, not typed

Two number boxes ("Ads to unlock" 1–5, "Minimum ad length" 5–120 s) meant the party with the least
information was pricing a stranger's attention, per file, with no feedback — and the ceiling allowed
ten minutes of one person's life. `app/src/adscale.js` replaces both: a **value ladder** (free → 1×15 s;
under 200 → 1×20; under 600 → 1×30; under 1,500 → 2×30; under 4,000 → 2×45; under 10,000 → 3×45; 10,000+
→ 3×60) capped by the store's plan (Free 1×30, Store 2×45, Pro 3×60) inside an **absolute** platform
ceiling that no plan and no price moves.

- The seller now chooses a *level* — "the standard rate for this value" or "the minimum" — and posts no
  numbers. `setUnlockPolicy` derives the ask; a hand-crafted POST cannot inflate it (asserted).
- The value is `assets.declared_value_npr`, a new column, and deliberately **not** a revival of
  `price_npr`: migration 0004 dropped that column with the argument that "a price column with no payment
  path behind it is an invitation", and that argument still holds. The hint on the field says so: private,
  never shown to a visitor, not a price.
- A saved ask does not move on its own. `ad_band_npr` records the value it was calibrated from, and the
  seller's page shows the drift to re-save.
- The buyer sees the ask in words, as time: "2 ads of 30 seconds", with the platform's ceiling printed
  under the unlock card — `No file here asks for more than 3 ads, more than 60 seconds each, or more
  than 3 minutes in total.`

### The ladder, when the ad never arrives

`app/src/blocked.js` + `ad_block_signals` (migration 0034) + `POST /api/unlock/blocked`. Four rungs
driven by a **count of views that never confirmed** in a six-hour window: silence (0), an explanation
(1), the trade stated plainly with the membership route named (3), and — at 6 — **the unlock stops being
offered**: the button disappears, and the note says the file is still listed, its description and preview
stay readable, any file already open on the store still opens, and the pause resets on its own.

The membership route is named at rung 3, where it is true of *this* file's situation only in the sense
that joining a store opens that store's **member** files — so the withheld rung, which is where an offer
reads most like a way out, prints it only when the store actually sells memberships (`blockRung.hasMembers`),
with the honest qualifier under it: *"It does not open an ad-gated file sooner."* A store that sells none
gets a sentence instead — *"this store sells no memberships, and the pause lifts by itself"* — and no
anchor, because a button that lands on nothing is a worse lie than a missing one. Both shapes are pinned
in `test/blocked.test.js` (#90 renders the rung twice); the first cut offered the membership button
unconditionally, and the page said so before the code did.

Five refusals hold it up, each with a source in `AD_ECONOMY.md`: **no browser checks** (79 % of
ad-blocking is undetectable, reader mode defeats every detection, and a wall around a guess lands on the
people who were compromising — NYU measured 13.6 % *more* intrusive ads on allowlists), **no accusation**
(the subject of every sentence is the missing view), and **no mark on the account** (a count that ages
out, nothing to clear). Closing an ad yourself is recorded as `declined` and climbs nothing. All five are
held in one list (`NEVER_DO` in `src/blocked.js`) and — since this round — **printed on the seller's
ad-slots page**, from that list rather than as a paraphrase, beside the count. They had been written with
sources, asserted in `test/blocked.test.js` and imported by the view layer while rendering nowhere, and
the paragraph standing in their place had drifted into the same over-promise that had to be corrected on
the visitor's side of the ladder (*"a membership opens everything with no ad at all"*, which is false of
an ad-gated file). The seller now sees the count: *"N unlock attempts in the last 6 hours produced no
confirmed view — a blocker, a dropped connection, or a network that did not call back. The platform does
not guess which, and it does not penalise the person."* — and under it, the five things this platform
will not do to the person who caused them.

### Where the third charge is stated

- The seller's earnings page — "Where the money goes" — gained a fourth panel. The map was three legs
  (the network's money, the store's dues to bytebikri, the store's members paying the store) and a map
  that leaves out the platform's own revenue stops being a map of where money goes: the fourth names the
  third charge in the seller's own reading, next to the dues leg, so nobody learns it from a support
  thread. It opens no file, removes no ad, shortens no wait, and touches nothing the store earns.
- `platformMoney()` counts it (`plusThisMonthNpr`, `plusActive`, `plusPending`); the operator's
  `/admin/payments` has its own section and its own match/reject route; the audit log has its own family
  (`plus.`) with `decisions: true`, so "who turned this on" is answerable.
- `REVENUE_ARCHITECTURE.md` now states five legs and three platform revenues; the density revision and
  the two new refusals are recorded there rather than here.

### What was run

- `npm test` — **595 / 595 / 0** (up from 555). New: `test/adscale.test.js` (11), `test/plus.test.js`
  (13), `test/blocked.test.js` (10), `test/slots.test.js` (6). Rewritten rather than deleted:
  `billing.test.js`'s clamp test now proves a posted number cannot move the ask, and `members.test.js`
  checks the seller's panel arithmetic against the new cap.
- Browser pass (`ci/eyes/`): seven pages at 1440×1000, no console errors, no horizontal overflow, no 500s.
  Measured: **`/s/alice` carries two positions** (the store's at y=607, the platform's last at y=4,311 of
  a 4,696px document) and the slots dashboard shows the empty second position as the seller's. It found a
  real bug the suite could not: the asset route threw `policy is not defined` for every file page
  (a variable that only existed inline in an argument list), fixed and re-measured.
- The three claims that only a browser could settle, each shot and read rather than asserted in a test:
  the ask panel has **two states** and both were photographed — one option with its reason on a file with
  no value, two once the value separates them ("2 ads of 45 seconds" standard, "1 ad of 15 seconds"
  minimum, and the drift line *"Saved when this file was worth NPR 0 — saving now recalibrates it."*);
  the plus look is **gated by the arrangement, not by the column** (a palette written straight into
  `profiles.nameplate` renders as nothing — a plain avatar in the header chip and a plain name on a
  review, while an active month wears the same row in teal with a halo); and the withheld rung of the
  ladder reads as the no-memberships shape on this store, because this store sells none.
- Screenshots: **`docs/evidence/round32/`** — checked into the repository, because the previous rounds'
  evidence lived in `/tmp` and in the home directory and every workspace restore took it with it (this
  session opened on a tree rolled back to the branch point, with these documents intact and the pictures
  they described gone). The plus page pending and active, the "what this is not" list, the derived ask
  panel, the storefront with its two ad boxes, the ladder's middle rung and its last, the Plus plate on a
  storefront that is not its wearer's, the slots dashboard with the cap and the unconfirmed count, and
  the operator queue with the third charge in it.
- `ci/demo-state.mjs` (§4c) puts the person's premium into its **two states** the way it puts the store's
  two states there: one account wearing a look with a month running, one whose claim is waiting on the
  operator with the look stored and unworn. It also clears the signals on the ad-gated file and lays down
  a fixed count, so the seller's dashboard screenshot is the same page tomorrow. Both halves are
  idempotent — a second run prints the same four lines — and the script throws rather than reporting a
  claim it did not get: an earlier version printed "running" over a cancelled row, because the *third*
  state of a subscription is "the reference was already used", which is neither of the two it knew about.

### Still open, recorded rather than half-built

- **Flat vs scaled pricing for the person's premium.** Flat (NPR 149/month) shipped: there is nothing to
  meter, and metering a cosmetic is the per-item pricing the research refuses. If a store-scale feature
  ever joins it, the question returns.
- **A paying viewer's page and the platform's own row.** Unanswered and unchanged: the row still renders
  for everyone, because the rent leg is priced on the page rather than on the viewer — and because the
  answer interacts with a seller's rent, it is the user's call, not this round's.
- **A real ad-network integration.** Everything here is verified against the sandbox network; the
  postback path has never carried a signed request from a live provider (credential-gated, and recorded
  as such since §23).
- **`remove_footer` is no longer a capability with no reader.** It was true on both paid plans from
  migration 0001, mentioned on the pricing page nowhere, and rendered nowhere — the same shape of gap
  as `can_theme` (§31) and `verified_badge` (§25) before it. A paid store now loses bytebikri's name on
  its own storefront and file pages, and the platform's legal notices stay on every page of every plan,
  because a visitor reading a creator's store is still on this platform's pages under this platform's
  notice — a capability that could hide those would be selling a compliance problem. Both halves are
  pinned in `test/billing.test.js` (the capability and the sentence that sells it, plus the assertion
  that nothing in the legal-links span depends on the plan) and in `test/ui.test.js` (both shapes, and
  that a platform page keeps the line whatever a plan says).

## §33 — The sentence that never rendered, and a preview that could not take money

Two defects found by walking the money flow in a browser, and they share a shape: the platform did the
right thing and then either **said nothing** or **could not be asked to do it at all**.

### `?saved=plus-claimed` said "Saved."

`flashFor` in `server.js` matched query-parameter *names*, left to right. `SUCCESS_FLASH` carries a
generic `saved: () => 'Saved.'` for the many routes whose outcome needs no explanation, and because the
key `saved` sits before the outcome keys in the map, it shadowed every sentence keyed by the **value**.
Seven outcomes were unreachable: `plus-claimed`, `plus-look`, `plus-stopped`, `doc`, `doc-replaced`,
`withdrawn`, `withdrawn-doc`.

The cost was concentrated in the one place a manual rail cannot afford it. A person who has just sent
NPR 149 read **"Saved."** where the product had written:

> *"Sent. An operator checks that reference against the platform's own statement — nothing is worn until
> it is matched, and if it never is, nothing about your account changes."*

That sentence is the entire explanation of how a claim works on a rail where bytebikri is not a party to
the money. It had been written, reviewed, and printed nowhere. Every test in this repository drives a
view directly and hands it the flash object, so **nothing was ever asked to choose one** — which is why
the suite was green throughout.

The rule now lives in `src/flash.js` with its own tests: **the value of `saved` names the outcome and is
asked first**, and only a value that names nothing falls back to the parameter's own name (so
`?saved=1` still means "Saved.", and `?published=<slug>` still means the publishing sentence).
`test/flash.test.js` then reads the real vocabulary out of `server.js`, comments stripped, and checks
that every outcome any route can name has a sentence — which on its first run found a second real gap:
the verification flow returns `?saved=already` when somebody asks for a check they have already asked
for, the map had `already-with-doc` but not `already`, and the page said "Saved." to a person whose
click had recorded nothing. It now says what happened: one request is open, and nothing needs doing.

### The preview could not demonstrate the product's own money flows

Every demo account was seeded with an unconfirmed address, and **every route that takes money in refuses
an unconfirmed address** — `POST /plus/join`, the plan payment, the rent payment. So a person clicking
through the preview as Alice or Carol could not submit a claim or an upgrade at all; they met the
"confirm your email first" refusal, which is correct behaviour on a state the seeder left behind. The
seeder could still *create* the running state, because it calls store methods rather than routes — and
that is precisely how a demo ends up showing the result of a purchase nobody following it could make.

`ci/demo-state.mjs` now confirms the four demo addresses through the product's own two steps
(`tokens.issue` mints the link the mail would have carried, `verify.confirm` spends it — the same
function `/verify/:token` calls). Only the delivery is skipped, because a seeder has no mailbox and does
not need one: the demo sign-ins are printed on screen. The first confirmation's timestamp is preserved
by `confirm`'s own `coalesce`, so the consent evidence is not rewritten.

Then the whole flow was walked as a person walks it, in a browser: sign in, open `/plus`, submit a
reference through the rendered form, and read the page. That is what surfaced the shadowed sentence. A
second walk as Bob confirmed the fix end to end — the page came back with the full "Sent. An operator
checks…" line, the sections measured cleanly one after another (222 → 653 → 1460 → 1817), no console
error, no horizontal overflow.

### What else the pass verified, from the parallel round's own claims

Six claims that had only been asserted in documents were read off live pages instead: the money map's
fourth leg renders on the seller's earnings page (*"What people pay bytebikri — NPR 149 a month, for a
palette and an effect beside their own name"*); the ladder's refusals print for the seller
(*"No full-page interstitial, no countdown before the page, no blanked store"*); `remove_footer` drops
bytebikri's name on a paid storefront while the legal notices stay, and the free store keeps both; a
member opening a members-only file meets no ad and **still sees the platform's rented box around the
content** — the "we are still winning more" shape the brief asked for, measured rather than claimed; and
the console totals count the third charge.

### The same walk found the twin defect: the money pages rendered no flash at all

Walking the *upgrade* — request it, submit a reference, read the page — came back with no sentence at
all, where the Plus walk had come back with "Saved.". Different cause, same shape:

**`views.billing()` accepted a `flash` prop and never rendered it.** So on the two pages that take
money, six sentences were dead: the two successes (*"Reference received. An operator matches it against
the bank or wallet statement by hand…"*, *"Upgrade requested. Send the amount to the account shown…"*)
and the four refusals — `?error=verify`, `nothing`, `reference`, `plan` — whose copy was written for
exactly the moments a seller is most likely to be confused. A seller who typed a two-character
reference pressed submit and got the form back with **no word about why nothing was recorded**.

It is the same blindness that hid the dispatch bug: every view test in this repository calls the view
directly with the data it wants to see, and the flash is data like any other — a view that ignores a
prop it accepts looks correct to every caller that passes a different one. So the guard is a source
test (`test/flash.test.js`), which walks every exported view in `views.js`, finds the ones that accept a
`flash`, and fails if any of them neither calls `flashNote(flash)` nor reads `flash.message`. On its
first run it named `billing`, and the second name it reported — `verify` — turned out to be a false
positive worth having: that view reads the prop and renders `shown.flash`, which the check now accepts.

Verified live afterwards, in order, as a seller: the pending panel with the pay form and no reference
("Waiting to be matched"), a two-character reference refused with *"Enter the transaction reference from
your transfer — at least four characters."* (submitted with the browser's own `minlength` guard
disabled, which is the stale-tab case the server rule exists for), then a real reference accepted with
*"Reference received. An operator matches it against the bank or wallet statement by hand, and your plan
changes when it clears."* Both the refusal and the acceptance were photographed.

### The seeder now cleans up after a walk

Walking a money flow leaves a pending upgrade and a submitted reference behind, and `ci/demo-state.mjs`
would not clear them — its own upgrade is guarded by "only if the plan is still free", so the next
person to open the preview would meet a state the seeder did not create and could not explain. It now
decides stray plan payments the way it already decided stray Plus claims (a rejection with a reason on
it, which is what an operator would have pressed) and clears a pending request with no reference under
it. First run after the walks: *"reset — decided 2 stray payment(s), cleared 0 orphaned request(s)"*,
then nothing on the second run.

### Clicking the unlock: the status lied for ninety seconds, and the polite request arrived too late

The last unwalked path is the one a visitor actually touches. No real network is attached in the demo —
the ad frame has nothing to load — so what the click exercises is precisely the failure the ladder was
built for. Two defects, both visible, both found only by waiting it out:

1. **The status said "Starting…" for the whole wait.** It is set when the button is pressed and was not
   changed when starting finished, so it stayed on screen through the countdown *and* through the 90
   seconds of polling for a postback — measured at 102 seconds, with the button disabled and no
   explanation anywhere. A person cannot tell slow from broken, so the page now says which one it is:
   *"Waiting for the ad network to confirm…"* from the moment the view is running.
2. **The polite blocker request arrived 105 seconds too late.** The ladder's rungs explain a *failed*
   attempt, and in a blocked browser that takes a minute and a half to become one. The useful sentence —
   *"If nothing appears in a few seconds, an ad blocker is the usual reason. Allowing ads for this page is
   what fixes it, and this button will still be here."* — belongs in the frame while somebody is staring
   at it, and that is where it is now: a new `#ad-hint` element, filled by `app.js` whenever the frame
   opens, naming no browser and accusing nobody (the platform still cannot tell a blocker from a bad
   connection, which is the whole reason `src/blocked.js` refuses user-agent checks).

The re-walk, in order: `t=2.5s` the frame open with "1 ad of 15 seconds", the countdown at 13 and the
hint present; `t=19s` the countdown replaced by ✓ and the status reading "Waiting for the ad network to
confirm…"; `t=114s` the failure's own sentence — "The network has not confirmed yet. This can take a
moment — reload to check." — with the modal closed. The attempt was recorded as `no_postback`, which is
what the whole ladder is built on: the platform counts what it could not confirm and says only that.

### Still open

- **Walking the rent payment in the browser.** Its refusal keys are now rendered (they share the fixed
  view) but the rent invoice itself needs a page with three or more slots and traffic above the billing
  floor before the flow can be walked end to end. — **DONE in §35.**
- **Flat vs scaled pricing for the person's premium**, and **whether the platform's own row may
  disappear for a paying viewer** — both unchanged, both the user's call.
- **A real ad-network integration** (unchanged, credential-gated).

## §34 — Two researched features, and the two ways a seeder can undo them

The round's brief was to take the research summary, apply what fits this product and discard the rest.
Applied: **gifting** (a period bought for somebody else, carried by a code) and **a year at ten months'
price** (the same plan with a longer period, not a second product). Both are built, tested and — for the
gift — walked end to end in `ci/eyes/premium-walk.mjs` §13 across three accounts. The shape of the
feature and the reasons for the discards are written down in `REVENUE_ARCHITECTURE.md`; what belongs
here is what went wrong.

### 1. The seeder rejected its own gift, on the second run

`ci/demo-state.mjs` resets the queue by **deciding** any claim a preview left waiting that is not one of
its own references — a rejection is a real outcome with a reason on it, and it is what an operator would
have pressed. The gift claim the seeder had just created was not in that list of its own references, so
the second run of the seeder rejected it: the buyer's page went from *"waiting on the transfer"* to
**NOT FOUND** on a code nobody had touched, and the operator's queue lost the row the demo is about.

The reference is now named once (`GIFT_DEMO_REF`) and read in both places, and the seeded gift is found
**by reference** rather than by "bob's newest gift" — which had also made the seeder's own report name a
walk's code as the fixture. A reference that was already decided is cleared before re-minting, so a
seeder that runs five times leaves one reserved gift, not five rows of archaeology.

### 2. The seeder handed Alice another month every time it ran

A match extends the period from `greatest(period_end, now())` — the right rule, and one the first cut of
this slice got wrong by restarting the period, silently dropping the remaining days of anybody who paid
early (`test/plus.test.js` now asserts exactly +31 days on a pay-early claim). Cancelling does not move
`period_end`, though, so **every run of the seeder stacked another month on her**: four runs and the
preview said her month ended in January, which is a demo that lies about the product's own arithmetic.
A period that ended is a state the product already has, so the seeder ends her previous period
(`lapsed`) before claiming again; the printed date is now stable across runs.

### 3. What the suite could not see

- **`/plus` answered 500 in a browser while every unit test passed.** `plusContext` read a plan key that
  existed only in the file that used it; the views are rendered directly in tests, so nothing ever asked
  the route for the page. The keys now live in `plus.js` (`PLUS_YEAR_CODE`,
  `PURCHASABLE_PLAN_CODES`), the routes read them instead of typing them, and a test asserts the list and
  the `customer_plans` table agree — a third plan added to one side only fails.
- **The seller's money map named one price.** A creator reconciling the statement now sees 1,490 as well
  as 149, so `MONEY_MAP.toPlatformFromPeople.detail` names both periods and derives the year through
  `plusYearPrice()`; a test reads both numbers out of the plan rows and fails if either is missing.
- **A flash key with no sentence is a test failure, and it did its job.** `flash.test.js` reads the real
  vocabulary out of `server.js` and found the two new outcomes (`gift-claimed`, `gift-redeemed`) before
  a browser could print nothing at the moment a person hands over a code.
- **The copy that handed a store a member's perk.** The roster's empty state still said *"Being named is
  the perk"* — the same conflation the premium-look round was built to fix — and the seller's pricing
  bullet called the store's own chips "your own plates". Both now say whose thing it is: the chip is the
  store's, the look is the person's, and a store cannot name somebody or unname them.

### Still open (unchanged this round)

- **Walking the rent payment in the browser** — done in §35 (`rent-walk.mjs`, with Alice's store as the
  fixture: 2 store slots, 1 platform slot, ~380 views in 30 days → NPR 36 for the year).
- **Flat vs scaled pricing for the person's premium**, and **whether the platform's own ad row may
  disappear for a paying viewer** — both the user's call.
- **Bob's Free-plan panel copy**, checked against the plans the table actually holds — **DONE in §36.**

## §35 — Three leftovers from the premium-look list

The person's own band — slice 9, the last of the premium-look slices — is written up in
`PREMIUM_LOOK.md` §9: the recipe, both contrast tables, why the box is the store band's box, and the
three layers that prove it. What belongs here is the sweep of the older leftovers that went with it.

**"Renews" and "runs until" disagreed across pages.** The seller's settings panel read *"Store · renews
25 Oct 2026"* while two other pages said, in the product's own words, that nothing here renews by itself
and that there is no card on file. The panel was wrong: a period is bought on the manual rail and it ends
when it ends. It now uses the Plus page's verb, `runs until <date>`, and the claim is pinned twice — the
rendered panel has to say it, and no template in `views.js` may put a date straight after the word
"renews". The counterfactual sentence on the money map ("a month if every running arrangement renews —
nothing renews by itself here") stays: it is the product denying the thing, and that is the point of it.

**Lazy loading was judged, not applied everywhere.** Seven of nine `<img>` tags carried no
`loading="lazy"` and the honest answer was not "add it to all of them". The storefront's banner, the
store's mark, the file page's stage and its unlocked preview are what their pages are *for* — the mark is
the identity lockup in a header, the stage is the subject of the file page — and deferring any of them
delays the first thing a visitor looks at. The seller's banner preview is different: it is three panels
down a list of forms that a seller scrolls to, and the demo store's banner is a real upload. It is
`loading="lazy"` now, and a test asserts both halves of that judgement, so a later sweep that adds the
attribute everywhere fails on the banner the storefront cannot defer.

**The rent payment, walked at last — and the sentence it was rendering was the wrong one.** This was
the last money path with no browser walk, and the reason is that it needs three things at once: a paid
plan with enough slots to spare one for the platform, traffic above the floor that bills, and the
channel's own anniversary. The dev fixture has all three, so `ci/eyes/rent-walk.mjs` now takes Alice's
invoice from `issued` to `submitted` to `paid` across two accounts — she sees a bill that shows its own
working (trailing views, slots on the page, slots that rent, the assumed rate) and produces the amount
from it; she submits a reference through the real form; the operator's queue shows the same reference
beside the same amount and one action, "Mark paid"; and her page and her history row agree that it is
paid. `ci/eyes/reset-rent.mjs` puts the invoice back so the walk is repeatable, separately from the walk,
for the same reason `member-walk` has one.

What the walk found is the kind of thing only a browser finds: **the flash after submitting rent was the
PLAN flow's sentence** — *"…and your plan changes when it clears."* Both routes reported `?submitted=1`
and the vocabulary is keyed by parameter, so rent had been promising a plan change since the day the two
flows were written. Rent buys no capability; it is the platform's own invoice. The route now reports
`?rent_submitted=1` with its own sentence ("Rent buys no capability and changes nothing about your
plan"), and the walk asserts all three claims: that it says when the invoice clears, that it does NOT
promise a plan change, and that it says what rent is not.

**The roster's empty sentence**, and the seller's pricing bullet that called the store's chips "your own
plates", were already fixed in §34 — rechecked this round against the two-layer rule and left as they
are: the chip is the store's, the look is the person's, and a store cannot name somebody or unname them.

## §36 — The Free panel, read against the plan the table actually holds

The last leftover on the list was Bob's Free panel: the fixture has a store on the free plan, so the
panel can be read end to end instead of imagined, and reading it found three sentences that were wrong
about the product rather than about him.

**"Renews 25 Sept 2027".** The plan panel's own label. It was the same claim the settings panel made and
§35 removed — nothing here renews by itself — and it was still standing on the one page a seller opens to
find out when their period ends. The label is `Runs until` now, and with no period it reads "No period
running — nothing renews by itself". A test asserts both the presence of the new label and the absence of
the old one, in the same rendered page.

**"1 ad slots on your pages".** `planBenefits` built the slot bullet by concatenation, so the free plan's
single position — and the capped "every web position there is today" line when the product has one —
printed a plural. Small, and exactly the kind of line a seller reads as carelessness about their own shop.
The count is a function now, and a test covers one slot, two slots and the capped line.

**"Your renewal date does not move. The next charge is the full price, on the same date as before."**
That sentence is true and useful for a store upgrading MID-period: the amount is pro-rated to the period
already paid for, so the date it ends does not change. It was being shown to stores with NO period at all,
where it describes a date that does not exist. The two situations now have two sentences: a running store
keeps its date, and a store with nothing running is told the year starts the day the transfer is matched
and that nothing renews by itself when it ends.

## §37 — The two outermost layers: a ring you choose, and the edge of your own card

§10 of `PREMIUM_LOOK.md` built the cosmetics engine and refused two of the review's slots outright: the
"avatar frame" and the "profile frame". Half of that refusal was right and half of it was too broad, and
the difference is the whole of this section.

**What was right.** A *surface* is never a person's to redecorate. On a store's page it belongs to the
store (the themes it pays for), and on a person's own page it belongs to the person (the band §9 built).
So the refusal stands for the review's "card background", because a background is a surface.

**What was too broad.** A ring and an edge are not surfaces. They are decorations of things that are
already the person's own: the initial drawn for them, and the card that is a rendering of them. Refusing
them was refusing the review's actual request on the grounds of a different one, and the engine's own
mechanism was already sitting there waiting.

**The ring** (`profiles.plus_ring`, `0044`) — `none`, `hairline`, `orbit`, `double`. `orbit` is the ring
this product has always drawn (a flat ring with a slow conic sweep on hover), and `NULL` — never chosen —
renders as it always did, so no existing wearer's avatar changed on the day the slot arrived. The four
draw on the avatar's pseudo-elements rather than on `box-shadow`, and that detail is an ownership rule
rather than a style: a store's own top-tier light lands on the same avatar, and a person taking their ring
off must not put out the store's light. The walk checks exactly that on a live roster.

**The frame** (`profiles.plus_frame`) — `hairline`, `double`, `glow`, and `none`. It is the edge of the
person's card wherever that card is drawn — the roster, the seller's member list, the person's own stage.
An edge and nothing else: a test reads the stylesheet and fails if a frame rule ever names a background or
a text colour, because the moment a frame can change what the words sit on, every contrast claim this
product makes about a name is describing a page that no longer exists.

**The engine, tested by its own extension.** Both slots cost one entry in `cosmetics.js`, one checked
column, one renderer branch, and one new picker control kind (`demo` — a tile that IS the thing: an
initial wearing the ring, a small card edged with the frame). Nothing else in the product learned about
them. The tests bind the two new vocabularies to Postgres's own check constraints, the picker's markup,
the write path's SQL and the schema, and `premium-walk.mjs` §15 proves the chain in a browser: chosen on
the stage without a round trip, worn on the account chip after the save, and — read through carol's
session, because a roster does not name the reader's own row — on the person's card in a store, beside
the creator's chip and under the store's own top-tier light.

**One rule the slots taught the picker.** A radio group with nothing checked submits nothing, and the look
route refuses a slot with no value — so a person who had never opened the picker could not have saved
their look at all. The picker now pre-checks what the product is drawing for them right now (the orbiting
ring, the plain edge), and a test asserts exactly one value comes back checked for every slot.

**The bug the slice found underneath it.** Building the card's edge meant the card finally needed the
member's palette on itself, and that is how a much older mistake surfaced: `publicRoster` selected
`p.nameplate as plus_plate`, and `plusWear()` reads `nameplate`. Nobody's *name* is drawn from the roster
row's own field — the paint fell through to the fallback, so on a store's roster every dressed member was
painted indigo, whatever they had chosen and paid for, while their palette sat in the same row. It had
been that way since the look was first worn on a roster, and nothing caught it because indigo is a
perfectly plausible colour for a name and because no test read the roster's palette at all. Two things
changed that: an edge in the wrong colour is visibly the tier's colour rather than the person's, and the
regression test now goes through `publicRoster` itself, so the query and the renderer have to agree about
what the field is called. The walk reads the result on a live roster, in carol's session, where the
store's chip and the store's top-tier light sit on the same card and must both survive.

---

## §38 — Three queries that did not hand the renderer what the renderer reads

The outer slots (ring, card edge) shipped in `8d4e133`/`7a602a7` with a renderer that reads
`row.nameplate`, `row.plus_effect`, `row.plus_ring`, `row.plus_frame` and `plus_status` — and three
queries were written before that vocabulary existed. Each one silently painted the wrong picture, and
each was found by asking one question of every surface that renders a name: **does the query hand the
renderer the field the renderer reads?** All three are one line of SQL and one regression test.

**1. The review list (`reviewsOfAsset`).** Still aliased the column `p.nameplate as plus_plate`. The
alias is from the round where `plusWear()` accepted both names; the acceptance went away and the alias
did not, so every paying reviewer wore their effect in the fallback indigo while their own palette sat
in the row beside it — on the page where a stranger decides whether to trust the file. The query now
selects plain `nameplate`, like the roster, and `billing.test.js` pins the rendered plate (effect class
and `--plate-a`) rather than the helper.

**2. The seller's member list (`membersOfChannel`).** Selected no look fields at all and did not join
the subscription, while `views.channelMembers` passes every row to `memberPlate()` and the page's own
comment says "the member's own look rides on the plate here too — the seller's queue is where names are
read most carefully". So a paying member appeared on the seller's own list wearing nothing, two pages
from the same person wearing their whole look on the storefront. The query carries the fields and the
join now; `members.test.js` asserts a real arrangement (not a faked `plus_active`) reaches the page.

**3. The review name's entitlement.** `reviewSection` computed `plus_active: r.plus_status !== null` in
the template. It agreed with the gate only because `PLUS_SUBSCRIPTION_JOIN` yields a row for nothing but
an active, unexpired subscription — the rule lived in SQL and nothing pinned the two together, so any
change to that join would have started painting looks nobody is paying for. `views.reviewName(row)` now
hands the row to the same `plusWear()` gate the roster, the account chip and the card go through;
`wear.test.js` holds it there (pending wears nothing, lapsed wears nothing, no subscription wears
nothing, an unnamed reviewer is "A buyer").

**And the walk that was only green on alternate runs.** `premium-walk.mjs` §1–§3 asked for
`li [class*="wear-"]` — "the wear" on a row. That was true while a wear was the only such class on a
row; once the tile carried the member's ring it stopped being true, and because the tile comes first in
the DOM the sections measured the AVATAR whenever the saved ring was `orbit` (the value the walk itself
restores at the end, which is why the file passed on the first run and failed on the second at the light
theme's white-on-white 1:1). The selector names the element now (`NAME_WEAR`, one definition, read by
every section), §1 asserts that what it read IS the name, and §16 walks the two surfaces above in a real
browser: the seller's queue (alice dressed in her own teal, bob plain) and a review read by a stranger.
Two consecutive runs are green, which is the property the old file did not have.

---

## §39 — Two more treatments on each outer layer, and the colour they were wearing

The review that asked for a cosmetics engine came back with the same card twice, and the second time the
words were "*grand*". §37's ring and edge were four values each, and half of each vocabulary was
"nothing": one ring and one edge were variations on a hairline. A slot that offers `none`, a line, the
line seen slightly differently, and a line with a second line is a slot, not a choice.

**The ring is six now** — `none`, `hairline`, `beaded` (the ring drawn as a line of dots), `orbit` (the
one the product has always drawn, and what "not chosen" means), `split` (two arcs, one per palette
colour, turning) and `double`. **The edge is six too** — `none`, `hairline`, `bevel` (four one-pixel
insets: two colours across four sides, so the card reads as an object rather than an outline), `double`,
`glow`, `aurora` (both colours travelling the edge). Migration `0045` widens both check constraints;
`test/cosmetics.test.js` fails until the two vocabularies, the two columns, the picker and the
stylesheets agree, and it additionally refuses a ring value whose class has no rule at all — a control
that changes nothing is worse than a missing one.

**The aurora is an edge only if the masks subtract.** A gradient confined to a border band is an edge;
the same gradient with its masks unioned is a repainted surface, which would make every contrast claim
about the name on that card describe a page that no longer exists. So the rule lives inside
`@supports (mask-composite: exclude)` — a browser that cannot subtract gets the card's own edge rather
than a recoloured card — and the statement test now allows a frame rule to paint a background only when
it also masks it, subtracts the content box, and sits behind that support query. The default is
"no decoration", never "repainted card".

**And the ring was in the wrong colour.** Reading the computed paint off a live roster rather than
looking at a screenshot: the avatar on a store's roster carries the STORE's palette (the tier accent
fills the tile, and the store's top-tier glint is drawn from that same `--plate-a`), and it also carries
the PERSON's ring. A ring painted from the plate pair therefore came out in the creator's colour — a
teal member of a violet store wore a violet ring, next to a teal name, and a 2px circle is not something
a screenshot settles. Two owners, one element, so the ring reads `--wear-a/--wear-b` and falls back to
the plate pair: `memberPlate()` writes the wearer's pair beside the store's plate, and everywhere the
palette already IS the person's (their Plus page, the account chip, their own preview) the fallback is
that palette. The store's tile keeps the store's colours; `members.test.js` asserts the whole style
attribute — including the `;` that a first cut left out, which glued the two pairs together and made the
browser drop all four values. `test/ui.test.js`'s token hygiene caught the undeclared pair.

**Two walk defects, same root as §38's.** The walk's sections 4 and 4b asserted that `wear-ring` turns
and anything else does not, and that a ring which is not `wear-ring` declares no animation — true while
`orbit` was the only moving ring, and false the moment `split` existed. Which treatments move is the
picker's own answer, so the tiles now carry `data-demo-moves` and the walk reads it instead of guessing
from a class name. Its live stage also stripped the outgoing ring by listing the keys of the day, so
choosing Split right after Orbit painted both (`ring-split ring-split`, and both classes at once before
that) — the pattern is derived from the naming rule now, and the walk switches rings twice and requires
exactly one ring class on the avatar. Runs are green from the seeded state (`orbit`, the second-run
condition that used to fail) and from the walk's own output.

## §40 — One page, one person, one colour, and the four queries that never handed the look over

**The seller's members page draws the same member twice.** Once above, in "Waiting on you" — a claim
nobody has confirmed yet — and once below, on the roster. The waiting row was the last surface still
printing a bare name, and the reason was upstream of the renderer: `pendingMemberships` selected the
member's name, their tier and its dues, and nothing else, so the row arrived with no look to draw and no
`PLUS_JOIN` to say whether the person was paying bytebikri at all. It now selects what the renderer reads
— `p.nameplate`, the effect and the two outer layers, `pl.plus_status`, `pl.plus_period_end` — and the row
goes through the same `nameTag()` the roster uses. The dues' status is not consulted: whether a store has
confirmed a member's transfer has nothing to do with whether that member pays bytebikri for a look, which
is the ownership correction stated as code.

**Handing the row over exposed the fault underneath it, and this one a screenshot would not have caught.**
With the row wired up, the payload for a member who has bought nothing is a name and no look — and the
renderer's fallback for a look-less name is its own default, indigo. The roster below paints the same
person in the palette of the tier they hold there, teal. One page, one person, two colours, and the only
symptom was a queue that disagreed with the row directly beneath it. The rule is the one this round has
been applying everywhere else: **a name with no look of its own takes the colour of the page it is drawn
on** — on a store's card, the tier accent the store's own roster already uses. `nameTag()` grew an
optional `accent` for exactly this, and `members.test.js` renders a look-less member in both places and
requires the two `<span>`s to come out byte-identical; the walk's §16 compares the waiting row's class and
computed palette against the same person's roster row and fails if they disagree. Removing the accent
fallback fails the test, which is how it was checked.

**The systemic version: a query must return the fields its renderer reads.** This was the fourth time the
same bug class has been found, and the four have nothing in common except the shape — an alias or an
omission that renders a paying person plain. `membersOfChannel` aliased `p.nameplate` to something the
renderer does not read, so every dressed member on a roster fell back to indigo while their palette sat in
the row beside it; `reviewsOfAsset` carried the reviewer's name without their look, so every paying
reviewer was drawn in the fallback; the seller's member list returned bare rows; the pending queue
returned no look at all. All four are now audited against the surfaces that exist, and the two that are
deliberately plain are plain for a reason:

| What draws a person's name | Row comes from | The look |
|---|---|---|
| The account chip in the header | `userById` (`p.*`, `plus_status`, `plus_period_end`) | carried |
| A storefront's public roster | `publicRoster` (look fields + `PLUS_JOIN`) | carried |
| The seller's member list | `membersOfChannel` | carried (§38) |
| The seller's **waiting queue** | `pendingMemberships` | carried (this round) |
| A review, read by a stranger | `reviewsOfAsset` | carried (§38) |
| The person's own stage, and their band on `/library` | `userById` | carried |
| The operator's Plus queue, the admin users table | rows with no look join | **plain on purpose** — an operator work queue is a list of receipts, not a place a person is being shown to somebody |

The rule for the next surface is therefore not "add the join" but "ask what the renderer reads, and make
the query return it": `plusWear()` reads `row.nameplate` and refuses to dress anybody whose plan it cannot
prove from `plus_status`/`plus_period_end`, so a missing column is silent, and silence here looks exactly
like a member who never paid.

## §41 — The ledger: two numbers that are not the same number

Slice 5 of the asset economy (`ASSET_ECONOMY.md` §12). §5.5's fifth rule — *prove it before invoicing
it* — needed a count, and the count needed one distinction held firmly: **a verified view is not a
rendered position.** The first is a network's postback saying a person finished an ad; the second is a
box this application drew. Only the first can be the store's inventory and only the network pays it. Only
the second can count the platform's own slot at all, because nothing verifies a house message. They are
kept in separate blocks on the page and are never added.

**The verified view learns where it sat.** `ad_view_events` gained `placement` and `surface`, both
nullable (every view recorded before today happened somewhere, and the ledger cannot invent where) and
both checked against the catalogues that own those words. They are written by the `INSERT` in
`claimAdView` — the one statement allowed to say a view happened — and they come from the attempt:
`pending_views` gained its own pair, written when the attempt is created, because the plan that built the
cue list is the only thing that knows whether this stop is a mid-roll or a chapter boundary. Wiring this
up found that the claim path already had the attempt row in hand (`lockPendingView`), so the words travel
with the event rather than being guessed at the end.

**The rendered position is counted at render.** `ad_position_daily(channel_id, day, surface, placement,
side, impressions)` is upserted once per page render with the boxes that actually reached the page —
filtered through `views.drawnSlots()`, which mirrors `renderSlot()`'s own early return, because a store's
empty position is hidden from visitors and counting it would inflate our own numbers with boxes nobody
saw. `side` comes from `payoutParty`, the same field that decides whose money a slot is; `channel_id` is
null on our own pages, with a `unique nulls not distinct` key so the platform's pages get one row a day
like every store.

**What the browser proved.** `ci/eyes/ledger-walk.mjs` loads a storefront as a stranger, then opens the
owner's ledger: the storefront render appears in both blocks, on the store's side and on ours, and the
numbers are the ones those renders produced. The page carries the sentence *"The statement is the
network's, not ours"*, labels our position *"This is our inventory, not yours"*, prints **no rupee figure
anywhere**, and refuses to price our own positions in words. The phone read stacks with nothing
overflowing. Three screenshots in `docs/evidence/round37`.

**The fixture's own discovery.** The demo store has 224 verified views recorded before this slice could
say where a view sat. They land in a single *Not recorded* row — and the page says why (*"N of those views
were recorded before this ledger counted where a view sat"*), because an unlabelled "Not recorded" reads
like a fault in the page instead of a fact about history. A test inserts one such view and asserts both
the row and the sentence.

**The refusal is asserted against Postgres, not written in a comment.** A test reads
`information_schema.columns` and fails if any column in the ledger's tables matches
`payout|amount|rate|cpm|rpm|earn|price|invoice|paid|revenue|money|cut`. When leg 6 has real revenue,
pricing it is a new decision with its own record — not a column that quietly appeared here first.

Suite **736/736/0** (four new tests); the walk is green, no console errors.

## §42 — The reader: pages that are counted, a seam the server enforces, and a bookmark that is the reader's own

§13 designed a surface for files that are read rather than played, and the design's own first line was
the blocker: **the planner was told the file count.** A forty-page comic had one chapter, so the
between-chapter cue slice 3 had built could never be placed on one, and the seller's panel said so in
its own words. This slice makes the page count real and then builds the reader on top of it.

**The archive is read the way readers read it.** `app/src/archive.js` finds the end-of-central-directory
record by scanning backwards (a zip may carry a comment, and a reader that trusts the last 22 bytes
loses the archive), takes entry sizes from the central directory rather than the local header, and
inflates DEFLATE entries while STORED ones pass through untouched — which is exactly what a CBZ tool
writes, because the images are already compressed. Two refusal rules ride along: a declared or produced
size past its cap is refused *before* the bytes are trusted, and a zip64 archive is named and refused
rather than misread. The unit fixture is written by hand, byte by byte, with an extra field in the local
header that is a different length from the central one's and an entry whose local header carries zeros —
the two lies a wrongly-written reader believes.

**`pages.js` is the model, and it is the only place the words come from.** Natural order (so `page-10`
follows `page-9`), junk filtered (`__MACOSX/`, dotfiles), `ComicInfo.xml` recognised as metadata and not
drawn, one step per drawable page, a segment list split at the gate cues, and the gate sentence itself —
*"One view after page 6."* The seller's panel, the buyer's file page and the reader all print that one
sentence from one function, so the promise on the file page cannot drift from the ask behind the link.

**A reader's stop is a real stop.** `breakCues` is the player's list and carries timestamps;
`betweenCues` is the reader's and carries page numbers. `startBreak` now finds the cue in whichever list
the file's shape has, snapshots the seam into the attempt (`break_index` with a null `break_at_sec`), and
the ledger row it produces reads `between / asset / rewarded` like any other verified view. A seller can
turn a `read` file into a `breaks` file, and the plan's cues move from timestamps to seams without the
planner learning a second vocabulary.

**The veil is not the enforcement.** Page bytes travel the same signed route as every other file, and
the route refuses a step behind an uncleared gate whether it was reached by clicking or by a URL typed
into the address bar: `403 {"error":"a view is owed before this page","gate":{"sentence":"One view after
page 6."}}`. That is the claim that makes the gate a gate rather than a decoration, and the walk proves
it by repointing the token it was given at the step it was not — no clicking, no client, just the URL.

**The bookmark is the reader's, and the store never sees it.** `reading_progress` is keyed
`(user_id, asset_id)` with a step and a timestamp, and a test reads `information_schema.columns` to
assert no column matches `seconds|percent|completed|revenue|paid|price|cut|amount`. The write only
happens when the step CHANGES (the beacon dedupes in `sessionStorage` by asset), because a position that
moved on every render would be a reading history rather than a bookmark.

**What the browser proved.** `ci/eyes/reader-walk.mjs`, seven sections, eight screenshots in
`docs/evidence/round38`, console errors none. The file page offers *Start reading* and prints the
promise beside it; page one is drawn out of the CBZ at 1400px; the ask first stands at page 6 with page
6 itself drawn (the seam is after it, where page 7 would be); the deep link to page 7 renders the ask
with **no image element at all**; the hand-made fetch gets the 403 above with a JSON content type; the
sandbox network's signed postback turns the page; the bookmark comes back as *Continue reading — Page 8
of 12*; a 390px phone has zero horizontal overflow. Section 7 flips the seller's two choices on the
file's own page (both controls, one save, its own sentence: *"Saved. The reader now presents this file
the way you chose…"*), then reads the buyer's reader — which must be in scroll mode, right to left, with
the forward control on the left and a six-page strip rather than a single frame — and puts it back.

**The walk's own discoveries.** A repeat run proved nothing twice: an unlock already cleared means no
ask, and a bookmark already written means the reader opens on page 12 instead of page 1.
`reset-unlock.mjs` clears the bookmark too now, and the walk starts at the reader's own URL rather than
by clicking *Continue reading*. The screenshot of the scroll mode caught an empty frame on the first
run: `decoding="async"` is right for a reader and wrong for a camera, so every reader screenshot waits
for `img.decode()` first. And a deliberate 403 is now CREDITED rather than counted — the walk spends one
expected refusal on its own hand-made fetch, so "console errors: none" still means what it says.

Suite **763/763/0**; the seller's panel and the save route are covered as tests and as a walk.
