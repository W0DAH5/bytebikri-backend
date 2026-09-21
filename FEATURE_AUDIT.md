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
| Deploy: Docker, CI, config refusal | `Dockerfile`, `ci/` | ✅ |
| Moderation schema, per-country policy | migrations | 🟡 schema only, no workflow |

---

## 6. What is missing

### Stops a launch

| Missing | Why it matters |
|---|---|
| **Ad render layer** | slots exist; nothing draws a creative. Needs one real network account |
| **`ads.txt`** | ad networks require it; needs a publisher ID |
| **Password reset** | no way back into an account. Needs SMTP |
| **Email verification** | anyone can register any address |
| **Moderation workflow** | the schema has states; no UI, no queue, no report button |
| **A second app-facing auth path** | the app signs in through the web form; sign-up in the app needs a JSON endpoint or a WebView |

### Missing product surface

| Missing | Note |
|---|---|
| Reviews and ratings | decided: keyed off unlocks. Schema exists, nothing written |
| Search and filters | the marketplace lists stores; it cannot search |
| Store settings (rename, tagline, banner upload) | create-only |
| Asset editing (rename, re-upload, delete) | create-only |
| Notifications | delegated in the model; nothing implemented |
| Refund/dispute flow | decided: harsh measures; no mechanism |
| KYC verification flow | schema exists, no upload, no review |
| Wallet / plan payment UI | `plan_payments` exists, no checkout |
| Following a store | absent |
| Offline viewing (Android) | absent **on purpose**: a disk cache of unlocked media is a leak with a progress bar |

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

`npm test` → **152 pass, 0 fail** (was 133 at the start of this round).

| New | What it holds still |
|---|---|
| `test/media.test.js` (12) | kind detection with MIME fallback; the label carries no identity and survives a quote; derivative keys cannot escape their directory; the overlay SVG cannot be made to emit markup; the full Range matrix and exact byte slices; the LRU's bound; and a real ImageMagick run asserting sRGB, dimensions, a visible mark, and a loud failure on a corrupt file |
| `test/ui.test.js` (+4) | the player is not a download with a label on it; the page never claims the web can stop a screenshot; every selector the client queries exists in a view; **every class the views emit has a CSS rule** |
| `test/android-contract.test.js` (3) | every endpoint the app calls exists server-side; the parked endpoints stay deleted; `FLAG_SECURE` is set, `FLAG_PRESENTATION` is not, and the app does not kill its own process |
