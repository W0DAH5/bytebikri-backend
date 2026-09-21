# ByteBikri for Android

**Status: written, not compiled.** There is no Android SDK or Gradle build in
this environment, so nothing in this directory has ever been through a compiler.
Treat it as a reviewed design with real API calls in it, not as a shipped app.
The web app is the product that runs today.

## What changed, and why it had to

An audit of this module found that it called an API the server does not have.

| The app called | The server implements |
|---|---|
| `/api/signup`, `/api/signin` | nothing (auth is the web form at `POST /login`) |
| `/api/assets` | `GET /api/stores/:slug`, `GET /api/content/:assetId` |
| `/api/upload` | `POST /dashboard/:slug/assets` (multipart, session, form) |
| `/api/coins/{id}`, `/api/spend` | nothing, and nothing planned |
| `/api/admin/flagged`, `/api/admin/ban`, `/api/admin/unflag` | nothing, and nothing planned |

Zero overlap. Every screen in the app was built on endpoints that do not exist,
against a base URL (`https://your-replit-url.repl.co`) that was never replaced.
`app/test/android-contract.test.js` now extracts the route literals from the
Kotlin and fails the suite if any of them is missing server-side, which is the
check that would have caught this the day it was written.

## What was deleted

- `WalletScreen.kt` and every coin, balance and purchase call. There is no price
  in this product: a visitor watches rewarded ads, the network pays the
  **creator's own account**, and bytebikri is not in that path. A wallet in the
  client is a promise the backend must not keep. Paying to skip the ad is a
  later feature, and `unlock_mode` already reserves `'paid'` for it.
- `AdminScreen.kt`. Moderation is the operator's job on the server, with a
  country-aware policy. It is not a ban button on a phone.
- `UploadScreen.kt`. Publishing is the dashboard form on the web, where the
  plan limits, the cover upload and the moderation queue already exist.
- `CacheManager.kt` and `CachedAsyncImage.kt`. This one was a self-inflicted
  "non-downloadable" failure: unlocked media was written to
  `filesDir/media_cache`, up to 500 MB, where any file manager can read it. What
  is cached for offline use is a leak with a progress bar. Public covers are
  cached by Coil; gated media is never written to disk.
- The `FileProvider` and the storage permissions (`READ_MEDIA_IMAGES`,
  `READ_MEDIA_VIDEO`, `READ_MEDIA_AUDIO`). Nothing is read from the gallery and
  nothing is written where another app can reach it, so the app does not ask.

## What is real now

- `network/ApiService.kt` — session cookie (in memory, never on disk), the
  storefront, one asset, the two unlock calls, and media URLs that the player
  re-signs with the cookie on every range request.
- `security/SecurityManager.kt` — `FLAG_SECURE` on every window that shows
  locked content, and `Activity.registerScreenCaptureCallback` on API 34+.
  The previous version used `Display.FLAG_PRESENTATION` as a "screen recording
  detector" (it means "this is a cast display" and is always false on a phone),
  counted three detections and then **killed the app's process**.
- `ui/screens/StoreScreen.kt`, `AssetScreen.kt`, `LoginScreen.kt`,
  `MainActivity.kt` — browse, unlock, play.
- Playback is Media3 (ExoPlayer) with an OkHttp datasource so the session
  cookie travels with each request. No `SimpleCache`, no download controller,
  no picture-in-picture.

## What the app claims about capture, exactly

- **Blocked:** screenshots and OS-level screen recording of this app's windows
  (`FLAG_SECURE`), on Android 14 and 15 as well. Enforced by the platform.
- **Not blocked:** a camera pointed at the screen, a rooted or patched device,
  and anything on the open web — no browser can prevent a screen recording, so
  the web product does not claim to.
- **Traceable:** every unlock carries the account's reference. Images are
  re-encoded server-side with it burned in; video and audio are overlaid with it
  while they play. A leaked copy points at the account that played it.

## Before this can ship

1. **A build.** Android Studio or a `gradle` with the SDK. Nothing here has been
   compiled; expect type errors on the first run.
2. **`BASE_URL`** in `app/build.gradle.kts` — the release value is a deliberate
   placeholder, and `MainActivity` throws if a release build is not `https`.
3. **`minSdk 24`**: playback and `FLAG_SECURE` work, but the screenshot callback
   needs API 34 — below that the app returns `null` rather than pretending.
4. **Sign-up.** The app can sign in; creating an account is the web form. Either
   that is acceptable, or the server grows a JSON signup the app can post to.
5. **A real provider.** Unlocking currently runs against the sandbox network in
   development (`house`) or a connected network in production. No app-side
   change is needed when a live network is connected — the postback is
   server-to-server and the app only polls.
