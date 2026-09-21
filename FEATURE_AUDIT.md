# Feature audit — what exists, what is missing

Written by reading the repository, not from memory. Every "done" below is a file
you can open; every "missing" is a file that does not exist.

Three codebases live in this repository and they are at very different stages:

| Codebase | Path | State |
|---|---|---|
| **Web app** (server + storefront) | `app/` | works, tested, 133 tests |
| **Android app** (Kotlin/Compose) | `android/` | **calls an API that does not exist** |
| **Old prototype** | `index.js`, `admin.js`, `middleware.js`, `prototype/`, `db/schema.sql` | dead code, superseded |

---

## 1. The headline finding

**The Android app and the server do not speak to each other.**

`android/.../network/ApiService.kt` calls:

```
POST /api/signup        POST /api/signin      GET  /api/assets
POST /api/upload        GET  /api/coins/{id}  POST /api/spend
GET  /api/admin/flagged POST /api/admin/ban   POST /api/admin/unflag
POST /api/admin/security-alert
```

The server implements **none of those**. It serves:

```
POST /api/unlock/start  GET /api/unlock/status  ALL /api/ads/postback/:provider/:connection
GET  /api/content/:assetId/file/:fileId         POST /api/ad-connections/*
GET  /api/assets  (POST only, and auth is a session cookie the app never sends)
```

Both files also hardcode `https://your-replit-url.repl.co` — a placeholder that
was never replaced. So the Android app cannot sign in, cannot list assets, and
cannot unlock anything. It is not a porting problem; it is a different API.

Two of its endpoints also contradict decisions you already made: `/api/coins`
(coins were parked) and `/api/spend` (there is no buyer-to-seller payment and
never will be). Those should be deleted, not implemented.

**What I did about it:** rewrote the client to the real API, with the base URL in
`BuildConfig`. See §6. It cannot be compiled here — no Android SDK in this
environment — so it is written, not verified.

---

## 2. Media protection — your specific question

**There is no media player anywhere.** No ExoPlayer, no `<video>`, no `<audio>`.
Gated files are served as a download (`Content-Disposition: attachment`) or not
at all. So "non-downloadable, non-screenshotable" was not partially built; the
feature it belongs to did not exist.

Here is what is actually achievable, from the research, because the honest answer
changes what should be built:

| Measure | Blocks download? | Blocks screenshot? | Verdict |
|---|---|---|---|
| `Content-Disposition: attachment` | no (it *is* a download) | no | the current behaviour |
| Signed, expiring, per-account URL | yes, for sharing | no | **already implemented** |
| Blob URL + `controlsList="nodownload"` | hides the button and the right-click "Save as" | no | worth it, cosmetic |
| Right-click / devtools JS blocking | no | no | theatre |
| **Dynamic watermark** | no | no — **makes the leak traceable to an account** | the real defence on web |
| Widevine L3 (desktop browser DRM) | yes, mostly | **no** | not worth it |
| Widevine L1 / FairPlay (hardware DRM) | yes | **effectively yes, on compliant devices** | needs a DRM vendor |
| **Android `FLAG_SECURE`** | n/a | **yes — real, OS-enforced block** | already set, keep it |
| Android 14+ `ScreenCaptureCallback` | n/a | detects capture starting | worth adding |

The two things that are genuinely, non-cosmetically true:

- **On Android, `FLAG_SECURE` is a real block.** Screenshots, screen recording,
  casting and the Recents thumbnail all produce a black rectangle. It still works
  on Android 14 and 15. It does not stop a second phone pointed at the screen.
- **On the web, nothing blocks a screenshot.** No browser API can. Everything
  that claims to is either detection (unreliable) or DRM at L3 (does not block
  capture in a desktop browser). The honest web defence is a watermark that
  survives the screenshot and identifies the account.

**What I built:** a real player with the layered version of the above — see §5.

---

## 3. What is implemented (web)

| Feature | Where | State |
|---|---|---|
| Accounts: signup, signin, signout | `src/auth.js` | ✅ |
| Sessions: hashed tokens, TTL, revocation | `src/auth.js` | ✅ |
| Login throttling + lockout in the DB | `src/auth.js`, `login_attempts` | ✅ |
| Storefront: banner, cover art, grid | `src/views.js` | ✅ |
| Publish flow: file + cover + access mode | `POST /dashboard/:slug/assets` | ✅ |
| Free (open) and ad-gated assets | `unlock_mode` | ✅ |
| Rewarded-ad unlock via signed postback | `src/unlocks.js` | ✅ |
| 4 verified ad-network adapters | `src/providers/` | ✅ |
| Ad slot allocation + rent estimates | `src/slots.js` | ✅ |
| Plans, upgrades, manual plan payments | `store.js`, `plans` | ✅ |
| Consent: banner, records, versioning, enforcement | `src/consent.js` | ✅ |
| Legal: privacy, terms, cookies | `src/legal.js` | ✅ |
| Moderation schema, per-country policy | migrations | 🟡 schema only, no workflow |
| Page-view counting | `page_view_daily` | ✅ |
| Dashboard: stats, slots, connect, publish | `src/views.js` | ✅ |
| Deploy: Docker, CI, config refusal | `Dockerfile`, `ci/` | ✅ |

## 4. What is missing

Ordered by whether it stops a launch.

### Stops a launch

| Missing | Why it matters |
|---|---|
| **Media player** | gated files are downloads, not plays. Being built now |
| **No screenshot/download protection beyond a token** | being built now |
| **Ad render layer** | slots exist; nothing draws a creative. Needs one real network account |
| **`ads.txt`** | ad networks require it; needs a publisher ID |
| **Password reset** | no way back into an account. Needs SMTP |
| **Email verification** | anyone can register any address |
| **Moderation workflow** | the schema has states; no UI, no queue, no report button |

### Missing product surface

| Missing | Note |
|---|---|
| Reviews and ratings | decided: keyed off unlocks. Schema exists, nothing written |
| Buyer-side search and filters | marketplace lists stores, cannot search |
| Store settings (rename, tagline, banner upload) | create-only |
| Asset editing (rename, re-upload, delete) | create-only |
| Notifications | delegated in the model; nothing implemented |
| Refund/dispute flow | decided: harsh measures; no mechanism |
| KYC verification flow | schema exists, no upload, no review |
| Wallet / plan payment UI | `plan_payments` exists, no checkout |
| Following a store | absent |
| Offline viewing (Android) | absent, and in tension with no-download |

### Missing infrastructure

| Missing | Note |
|---|---|
| Object storage | files on local disk; lost on redeploy unless a volume |
| Email driver | `EMAIL_DRIVER=console` |
| Error reporting | `SENTRY_DSN` reserved, not wired |
| Backups | none configured |
| Rate-limit store | in-process; resets on restart, per-instance |
| Instrumentation/metrics | `/healthz` only |

## 5. Built in this round

**A player, with the protections that are real.**

- `GET /api/content/:assetId/file/:fileId/stream` — HTTP **Range** support, so
  seeking works and playback streams instead of downloading the whole file first.
  `Content-Disposition: inline`, `Cache-Control: private, no-store`.
- Same trust boundary as the download: the token must be signed, unexpired, and
  belong to the signed-in account.
- **Video and audio play in the page. There is no download link** for gated
  media — the file is played, not handed over.
- `controlsList="nodownload"`, `disablePictureInPicture`, drag blocked,
  right-click on the player blocked, `-webkit-touch-callout: none` so a long-press
  on Android does not offer "Download image".
- **A dynamic watermark** — the viewer's pseudonymous reference, the asset id and
  a timestamp, drawn over the media. It moves. It is composited into the pixels
  of any screenshot or recording, so a leak points at an account. On **images** it
  is burned in server-side with ImageMagick, so it survives a screenshot and a
  re-upload; if ImageMagick is missing it degrades to serving the image rather
  than failing.
- The UI says plainly which of these actually prevents what, because a claim that
  cannot be kept is worse than no claim.

## 6. Android

Rewritten to talk to the real server: session cookie auth, `/api/unlock/start`,
`/api/unlock/status`, `/api/content/.../stream`.

Security measures corrected:

- **`FLAG_SECURE` stays** — it is the one real control, and it was already set
  correctly on the window.
- **The screen-recording check was wrong.** It looked for
  `Display.FLAG_PRESENTATION`, which means "this is a presentation display"
  (casting), not "someone is recording". It would fire on a legitimate cast and
  stay silent on MediaProjection recording. Replaced with Android 14's
  `registerScreenCaptureCallback`, which is the actual API for this, and with a
  documented no-op below API 34 rather than a guess.
- **The alert endpoint** posted to a dead Replit URL with no authentication.
  Now uses `BuildConfig.API_BASE_URL` and the same signed-in session.
- **`CacheManager` wrote gated media to disk** in `filesDir/media_cache` — that is
  exactly the "non-downloadable" failure, performed by the app itself. Protected
  media is now memory-only.

**Not verified:** there is no Android SDK in this environment, so the Kotlin is
written and reviewed but not compiled. `android/README.md` says so and lists what
to run.

---

## 7. Dead code to remove

`index.js` (318 lines), `admin.js`, `middleware.js`, `schema.sql`, `db/schema.sql`,
`prototype/` — the pre-Postgres prototype. `app/` no longer imports any of it.
Left in place only because deleting files is a decision, not a chore.
