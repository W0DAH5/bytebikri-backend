# Video storage and delivery

**Status:** framework, then implementation (this round). Provider: **Filemoon**, `https://filemoon.org/api/v1`,
Bearer token. Owner decision: bytes for **video files** may live at the provider; playback stays in **our**
player.

This document exists because moving bytes off our disk is the first dependency this product has ever taken
that can take a page down with it. Everything below is either a rule that keeps a promise already made
somewhere else in this repository, or a rule about what happens when the provider is not there.

---

## 1. The seam that was already there

`store.js` has carried a storage adapter since the beginning with its own comment: *"File storage adapter —
replace with the media API later."* It has three namespaces and four verbs:

```
storage.put(buffer, filename, { namespace })   → key
storage.get(key)                               → Buffer
storage.exists(key)                            → boolean
storage.remove(key)                            → boolean
```

`asset_files.storage_key` holds the key. Two content routes read bytes back, both behind the same door
(`resolveContentRequest` — the unlock, the membership, the break gate):

| route | presentation |
| --- | --- |
| `/api/content/:assetId/file/:fileId` | `attachment`, counted as a download |
| `/api/content/:assetId/file/:fileId/stream` | `inline` + HTTP Range, for the `<video>` element |

**The provider plugs in underneath this adapter and nothing above it moves.** No new table, no new column:
the provider is part of the KEY (`filemoon/<providerId>`), which is how the existing adapter already keeps
`public/` and `private/` from being confused for one another — *"the namespace is part of the KEY, so a
public route can never be coaxed into reading private content."* A key is self-describing, so a route can
decide what to do with it before it touches anything.

**What does not go through it:** `assets.external_url` is the LIVE vocabulary (`isLiveUrl` → shape
`stream`). A hosted video is not a stream: it is an ordinary file with ordinary duration, so it stays an
`asset_files` row and keeps shape `watch`, which is what keeps the cue ladder, the reader, the unlock
ladder and the seller's panels working on it unchanged.

## 2. The boundary: which bytes may leave this building

The adapter is not a pipe to the provider. It is a **router with a whitelist**, and the whitelist is the
privacy notice's promise rather than a convenience:

| namespace | what it holds | goes to the provider? |
| --- | --- | --- |
| `private` (default) | a store's published files | **only when `mediaKind(mime) === 'video'`** |
| `public` | covers, banners | **never** — images, and the shop window is ours to serve |
| `kyc` | identity documents | **never, on any setting, under any mime** |

Three refusals, each with a reason that is already written down somewhere:

1. **Identity documents never leave.** §30 promises a person that the copy they hand over for a check is
   destroyed when the check is decided, and `destroyHeldDocument` is the only path that ends a hold — it
   is built around `storage.remove` being a real unlink. Passing a citizenship certificate to a video host
   would make that sentence false, and no feature is worth that. This is asserted by a test, not by care.
2. **Images and archives never leave.** Covers are served from `/media/public/*` with no token (that is the
   point of a cover); a reader's CBZ is offset-addressed by our own archive reader and its pages are
   gated one at a time. Neither is video, and neither has any business at a video host.
3. **Audio does not leave this round.** `isPlayable` covers audio too, and a `listen` file would work
   through the same path — but the provider is a video host, the demo has no audio fixture to prove it
   against, and "it should work" is not a test. Stated here, so it is a decision rather than an omission.
   **The surface, not the storage:** audio's own player is real and now verified — `app/seed-assets/bell-tone.wav`
   (2 s, 32 KB, written by hand rather than by a codec) uploads, renders the `audio-shell` with its ♪ glyph,
   and plays (`readyState` 4, duration 2 s) with no video element anywhere on the page. What is refused is
   only *hosting* it, and §10.5 is why: Filemoon would serve an mp3 as a download, which would trade away
   exactly this surface for a CDN hop that buys nothing on a 2 MB file.

## 3. Configuration

| variable | meaning |
| --- | --- |
| `VIDEO_DRIVER` | `local` (default) or `filemoon` |
| `FILEMOON_TOKEN` | `id\|secret`, sent as `Authorization: Bearer …` |
| `FILEMOON_API_BASE` | defaults to `https://filemoon.org/api/v1` |

**Local is the default, and it stays the default.** Absent configuration, every byte is on our disk and
every route behaves exactly as it does today — the demo, the walks, the suite and a fresh clone all keep
working with no account anywhere.

`FILEMOON_TOKEN` is **required only when `VIDEO_DRIVER=filemoon`**, and `checkConfig()` says so in its own
style (a list of missing variables, before the process listens). Making it unconditionally required in
production would break a deployment that has no video host, which is the same class of mistake as a
required-on-both-paths secret.

**Where the token lives.** `app/.env`, which is gitignored (only `.env.example`, with names and no values,
is committed). Nothing loads `.env` today — `dev-up.sh` exports the demo values inline — so this round adds
that loading step to `scripts/boot.mjs`, guarded (a missing `.env` is normal in production, where the
variables come from the environment).

## 4. The API, and what is honestly unverified

Endpoints this adapter uses, all from the provider's documented surface:

```
GET    /account                     who we are: the check the doctor runs
POST   /files/upload                multipart `file`, `visibility=1`  → a file with an id
GET    /files/{id}                  the file, including its playback url(s)
GET    /files/{id}/status           processing state — an upload is not playable the moment it lands
PATCH  /files/{id}                  title/visibility
DELETE /files/{id}                  a real delete, and the only one that counts
POST   /remote-uploads              {"urls":[…]}, for files the provider fetches itself
GET    /remote-uploads/{id}         progress
POST   /remote-uploads/{id}/cancel | /retry
```

**Not verified in this environment, and said out loud.** The sandbox this round was built in refuses
egress to `filemoon.org` (TLS reset at Cloudflare; only GitHub-type hosts are reachable), so nothing here
has been exercised against the live API. What that means concretely:

- **The request/response SHAPES are not confirmed.** The adapter is therefore written to be tolerant and
  to fail legibly: `playback(file)` looks for a documented-or-observed field across a small candidate list
  and classifies by extension (`.m3u8` → HLS, everything else → progressive). When it finds none it throws
  a named error carrying the keys the provider actually returned, so the fix is one line and does not
  require a debugging session.
- **The verification is split.** Behaviour is proven here against a **local stub** that implements the
  endpoints above (auth header, multipart, status transitions, playback url, delete) — `app/test/video.test.js`.
  The live check is `npm run video:check` (`app/scripts/video-check.mjs`), which must run on a machine with
  ordinary network access: it prints the account, the shape of one file, and with `--upload` performs one
  small real upload and deletes it. **Whichever of the two playback kinds the account returns decides
  which of §5's two paths is live**, and the doctor says which.

## 5. Playback: who serves the bytes, and what that costs

Two paths, and the player's own source decides between them:

```
remote key?  → 302 to the provider's playback url  (after the door, which is unchanged)
             → progressive: the <video> element follows the redirect, Range included. No player change.
             → HLS: the VOD player attaches the vendored hls.js in VOD mode (not live mode).
local key    → exactly what happens today: bytes read, ranged, and streamed by us.
```

**A 302 is a delivery offload and an access consequence, and both are stated rather than discovered.** The
unlock check still runs first — the URL is never handed out to somebody who has not opened the door — but
once the browser is at the provider, the URL it holds is a bearer. Anyone who copies that URL can watch
without passing our door, the same way anyone who records the screen can keep what they saw (§10 of
`ASSET_ECONOMY` is the honest version of this: *nothing on the web prevents a screenshot*). The mitigations
that do not require the provider's cooperation are: the URL is minted per open (our route is the only place
it is printed), and Range/redirect means nothing is cached in our database.

**What we deliberately did NOT do: the provider's embed player.** It would be the fewest lines and it would
delete this product's television. The cue ladder, the withheld rung, the store's own in-file breaks, the
network postback, the dev simulator, the reader's seam, the `data-watch` bookmark, the runtime report —
every one of them lives inside OUR player. An iframe puts a stranger's player on the page and the whole ad
model evaporates. Same reason there is still no third-party script in any page: hls.js is vendored
(Apache-2.0, `public/vendor/hls.min.js`), and it stays that way.

**Proxy mode is stated and not built.** Re-streaming the provider's bytes through our own route would keep
the door authoritative and hide the viewer's IP from the provider — at the cost of exactly the bandwidth
this round is trying to move. Available later as `VIDEO_DELIVERY=proxy`; refused now because it buys
nothing the model needs and doubles the failure surface.

## 6. Duration, cues, and the one thing that changes

A cue is computed from `assets.runtime_sec`, and today that is measured from the bytes we hold: the mp4
`mvhd` header, or `ffprobe`. A remote file has no bytes to read — but this product already has a solved
case for exactly that: **a live stream's length is measured by a player**, and reported through
`POST /api/assets/:id/runtime` (the route the cues already depend on, `PLACEMENT_BOUNDS` and all). A
remote video takes that path. Nothing about cue computation, the ladder, or the withheld rung changes; the
only change is where the number came from, and the seller's panel already says "measured".

**What degrades when the provider is down or the token is revoked:** playback of remote files stops
(ours keep working; nothing else in the app reads those bytes), an upload fails **visibly with the
provider's own reason** rather than silently dropping to disk — a file that quietly lands somewhere the
seller did not choose is worse than a failed upload — and `DELETE` failing means the delete is reported as
unconfirmed rather than claimed. That last one is the KYC precedent applied to content: *"a promise about
deletion has to be a call that unlinks the bytes."*

## 7. Privacy: one new sentence, and no new third party beyond it

Today the notice says: *"a hosting provider that runs the servers and the database, and a storage provider
that holds uploaded files."* That sentence becomes materially incomplete the moment video is **delivered**
by that provider, because the viewer's browser then talks to it directly and it sees their IP — which is
data we currently never hand to anybody. So the notice names it plainly: video bytes are stored and
delivered by a media host, which sees the viewer's IP address when a video plays.

Nothing else moves: no name, no email, no watch history, no identifier — the provider is a CDN that never
learns who is watching, only that somebody is. The kyc namespace never leaves (§2), the consent banner
gains nothing (no new cookie), and the sentence is asserted by a test so it cannot be dropped by a later
edit that rewords the paragraph.

## 8. What the seller sees

Nothing new in the publish form: same fields, same 25 MB cap (multer buffers to RAM; a bigger cap is a
memory decision, not a video-host decision, and is not part of this round). Two things do change, both
small and both about honesty: a file whose bytes are at the provider says so on the file's own page, and a
provider failure during upload is named as the HOST's failure rather than as an internal error — a fixed
sentence, because the host's own words would otherwise travel in a redirect URL, with those words recorded on
the audit line (`asset.upload_host_failed`) where somebody investigating can read them.

## 9. Verification plan

| what | how |
| --- | --- |
| the router's whitelist | `test/video.test.js` — kyc and public namespaces and non-video mimes go to disk with the driver ON |
| the client's contract | the same file, against a **local stub** of the documented endpoints: bearer header, multipart field names, status mapping, playback classification, delete |
| the door is unchanged | existing suite (807) — the driver is off by default, so every route keeps its current behaviour |
| playback | a walk with the driver on and the stub behind it: open a file, follow the 302, assert the player received a source and the page's own copy says the bytes are hosted |
| the live API | `npm run video:check` on a machine with egress — account, one file's shape, and optionally one real upload + delete |
| the demo | `ci/demo-state.mjs` routes its fixture videos through the same adapter, so with the driver on the demo exercises the provider path end to end; with it off (the default) nothing changes |

`VIDEO_DRIVER=filemoon` with no reachable provider must leave the suite green: every remote behaviour is
tested against the stub, and the one test that asserts the *absence* of egress is the doctor's own report.

## 10. More than one host: the provider registry

The first version of §3 assumed one provider: `VIDEO_DRIVER=filemoon`, one token, one base URL, and a key
namespace named after it. Three hosts are now configured for the same seam — Filemoon, GoFile, Catbox —
and the honest summary of the research is that they are **not interchangeable**. They differ in exactly the
places the product depends on, so the differences are recorded here before a line of client code, and then
encoded in the registry, the doctor and the seller's own copy.

**And they are not three video hosts.** That was the first version's other mistake, and §10.5 is the
correction: each of these services is *designed* for a different kind of file, and the registry now carries
that as data (`capabilities.kinds`, `capabilities.policy`) with the router consulting it — because routing a
kind to a host that is not for it is not a graceful degradation, it is a file a viewer cannot open.

### 10.1 The facts as documented, per host

| | Filemoon | GoFile | Catbox |
| --- | --- | --- | --- |
| what the credential is | API token `id\|secret`, sent as `Authorization: Bearer` | account token, sent as `Authorization: Bearer` | `userhash`, a form field on every call |
| upload | `POST /files/upload`, multipart `file` (+ `visibility`) | `POST https://upload.gofile.io/uploadfile`, multipart `file` (+ optional `folderId`) — **a different hostname from the API** | `POST https://catbox.moe/user/api.php`, `reqtype=fileupload` + `fileToUpload` |
| response | JSON, shape unconfirmed here | JSON envelope `{status, data}` — and **`status`, not the HTTP code, is the truth**: several endpoints answer HTTP 200 with an error | **plain text**, the URL itself, or an error sentence |
| a playable url | `playback_url` / `hls_url` on the file record | **`/contents/{id}` and `/contents/{id}/directlinks` are Premium.** A free or guest account cannot be handed a playable link at all | the upload's return value *is* the url: `https://files.catbox.moe/<name>` |
| deletion | `DELETE /files/{id}` | `DELETE /contents` with `{contentsId: [id]}` | `reqtype=deletefiles`, `files=<name>` — needs the uploaded file's name |
| durability | until deleted | **≈10 days of inactivity on a free account**; Premium is permanent | permanent, no expiry |
| size | not published here | none advertised; free uploads are throttled | **200 MB per file**, hard |
| listings | `GET /files` | Premium | none exposed |
| media delivery | playlist or progressive, per file | direct link (Premium) | progressive only |

Two consequences follow, and both belong in code rather than in a footnote.

**A free GoFile account cannot be a video host for us.** Not because uploading fails — free accounts may
upload — but because nothing the account can produce is playable by a viewer: the download *page* is HTML,
and the direct link is a Premium feature. Storing a seller's video somewhere it can never be watched is
worse than refusing it, so `upload()` refuses before it sends anything, and says why. The doctor checks the
account's tier first and reports the same sentence, because the operator will meet it there.

**Catbox's 200 MB cap has to be refused locally.** A 300 MB upload is rejected by the host after the bytes
have crossed the wire, which on a mobile connection in Kathmandu is somebody's data allowance spent to
learn something we already knew. The cap is checked before the request.

### 10.2 What the registry looks like

- **The provider is part of the key.** `filemoon/<id>` was always a namespace; it is now a *provider*
  namespace: `gofile/<uuid>`, `catbox/<name>.mp4`. This is not cosmetic. A store's file keeps playing from
  wherever it was uploaded even after `VIDEO_DRIVER` changes, and a delete goes to the host that holds the
  bytes rather than to whatever is configured today. A key is a promise about where the bytes are.
- **One configured driver at a time.** `VIDEO_DRIVER=filemoon|gofile|catbox` chooses where NEW uploads go.
  Existing files are read from their own provider. Per-store or per-file provider choice is a product
  decision (and a UI) that this round does not make.
- **One interface, four functions.** `upload`, `playback`, `remove`, `account`. Everything above the
  registry — the storage router, the two content routes, the seeder, the player's `data-hls` decision —
  keeps talking in keys and does not learn any host's field names.
- **Capabilities are data, not prose.** Each provider exports its caps (max bytes, whether it can serve HLS,
  whether it is durable, whether a listing exists) so the doctor and the tests read the same numbers the
  refusal messages are built from.
- **The key regexes are per provider and are allowlists.** `remoteId()` returns null for anything that does
  not match its own provider's shape, so a key that reaches a route from a URL cannot become a path, a query
  or a second host.

### 10.3 What is verified, and where

Nothing below was exercised against a live host: this sandbox has no egress to `filemoon.org`, `gofile.io`
or `catbox.moe` (all three reset or refuse before TLS; `api.github.com` answers, so it is an allowlist, not
a broken network). The split from §9 therefore stands, with one host added per column:

| what | how |
| --- | --- |
| each client's contract | `test/video.test.js` against a per-provider stub in-process: field names, headers, the plain-text response, the envelope's `status` field beating HTTP 200, the size refusal, the free-tier refusal |
| the whole suite with each driver on | `ci/stub-gofile.mjs`, `ci/stub-catbox.mjs`, `ci/stub-filemoon.mjs` |
| playback per host | `ci/eyes/video-host-walk.mjs` against an instance configured for that driver: the 302, the player's own request, and the picture advancing |
| the live hosts | `npm run video:check -- --driver=gofile` / `=catbox` on a machine with ordinary network access — tier, a real upload, the playable url, a Range probe, and the delete |

Range is the one unverifiable-from-here behaviour that a viewer will notice: a host that ignores `Range`
gives a video that plays but cannot be scrubbed. The doctor probes it and reports the answer rather than
assuming one, because "our player, their delivery" is a claim about seeking as much as about bytes.

**The walk has now been run against all three stubs**, and the runs produced the exact recipes below — plus
two facts that are easy to get wrong when setting an instance up. Both were found by running it, not by
reading it:

| driver | stub | instance needs, beyond the driver's own variables |
| --- | --- | --- |
| Filemoon | `node ci/stub-filemoon.mjs 3999 [--hls]` | `VIDEO_MEDIA_ORIGINS=http://127.0.0.1:3999` |
| GoFile | `node ci/stub-gofile.mjs 4001 --tier=premium` | `GOFILE_UPLOAD_BASE`, and `VIDEO_MEDIA_ORIGINS=http://127.0.0.1:4001` |
| Catbox | `node ci/stub-catbox.mjs 4002` | `CATBOX_FILE_BASE=http://127.0.0.1:4002` |

1. **A media origin is not an API origin.** CSP judges a redirect's destination (§10.4), so a stub serving
   media over plain `http` must be named in `VIDEO_MEDIA_ORIGINS` — production is covered by `media-src
   https:` because both hosts hand back `https` urls. The failure mode without it is the nastiest one in
   this document: `MediaError` code 4, `networkState` 3, **no network request at all**, which reads like a
   dead stub rather than a policy.
2. **`CATBOX_FILE_BASE` is a second host, and leaving it out fails quietly.** The client rebuilds the
   playback url from the file base instead of reusing the upload's answer (deliberately — see
   `video-catbox.js`), so an unset base points a sandbox walk at the real CDN.

Both stubs' own usage lines and `ci/eyes/video-host-walk.mjs`'s header now carry the full recipes, because
a half-configured instance reads as a broken client and costs more time than this table took to write.

**Changing `VIDEO_DRIVER` is a reseed, not a restart.** The provider is part of the storage key (§10.2), so
an instance pointed at GoFile still reads the demo's `catbox/…` files from Catbox — which is the design
working. `node scripts/test-db.mjs` first, then boot; a reseed also invalidates the harness's saved session,
so `/tmp/eyes-host` goes with it.

### 10.4 The CORS wall, measured

The playback step of `ci/eyes/video-host-walk.mjs` was written to prove the last claim of §5 — that a
hosted file plays in our player — and it found something instead. Two things, in order:

1. **`media-src` blocked the CDN before the browser even asked.** The policy was `media-src 'self' blob:`,
   written for local files and the hls.js MediaSource. CSP judges a redirect's *destination*, so a hosted
   file's url was refused without a request being made: `networkState` 3 (`NO_SOURCE`), `MediaError` code 4,
   and **no network event at all** — a black rectangle with nothing in the log to explain it. Fixed: the
   directive now names the origins this deployment's providers declare, plus `https:` for media only
   (media cannot execute anything, and `script-src`/`connect-src` stay narrow).
2. **A playlist still cannot be loaded by hls.js from a CDN that sends no CORS headers.** hls.js fetches the
   playlist and segments with `XMLHttpRequest`; our route answers with a 302 to the provider's CDN; and a
   *redirected* XHR is judged by CORS at its final url. Measured against the stub:

   ```
   net: 302 /api/content/…/stream?t=…          (ours — the door, the unlock, the key)
   net: 206 http://…/index.m3u8                (the CDN, twice — the bytes ARE reachable)
   console: Access to XMLHttpRequest at '…/index.m3u8' (redirected from '…/api/content/…')
            from origin 'http://127.0.0.1:3100' has been blocked by CORS policy
   play() never settles: no error event, no stage-error, a still picture and a spinner
   ```

   **A progressive file is not affected** — the element loads it directly, and media elements are not
   CORS-bound. That is why the Catbox and GoFile paths play end to end through the same redirect
   (`the file plays off the host's bytes — 0.41s in, readyState 4`).

What can be done about it is a decision rather than a fix: the CDN may send the header (unknown until
`npm run video:check` asks a real one — the doctor now probes it and names the origin), a store's files can
be limited to progressive sources, or the playlist and its segments can be proxied through our own origin —
which works but puts every hosted byte through this server, which is what §5 was written to avoid. Until
one of those is chosen, a hosted **HLS** file is a file a viewer cannot watch in a browser, and both the
walk and the doctor say so in those words rather than reporting a broken player.

### 10.5 What each host is FOR — the question that decides routing

Researched rather than assumed, because the first draft of this document called all three "video hosts" and
set one boolean for the whole registry. They are three different services that happen to share an HTTP
shape, and the difference is exactly the thing the product's own surfaces depend on: whether a viewer can
**watch or read the file in our page**, or only download it.

| | Filemoon | GoFile | Catbox |
| --- | --- | --- | --- |
| what it is designed to be | a **video host**: twelve video formats (MP4, MKV, AVI, WEBM, MOV, FLV, WMV, 3GP, TS, MPG, MPEG, VOB), every upload encoded for streaming, HLS delivery, subtitles, posters, an embeddable player, remote and FTP intake | a **general file host**: no file-type restrictions at all, "files, images, music, videos", previews for common media inside its own UI, direct links for embedding | a **small-file hotlink host**: images, audio, short video, served from a static url, kept forever, no account needed to serve |
| non-video files | accepted, then **download-only** — its own words: "stream supported videos online **or download allowed files**" | first-class, previewed in its own page | first-class (except executables, `.doc*`, and `.html`/`.php`, which it serves as text) |
| what a page needs from it | an HLS or progressive url per file | **both are Premium**: the listing and the direct link | the upload's answer *is* the url |
| capacity | free: 1 GB guest / 2 GB registered per file; premium: uncapped | no published cap; free tier is bandwidth-throttled | **200 MB hard**; GIF 20 MB |
| retention | until deleted | free: **~10 days idle**; premium: permanent | permanent |
| **may we use it this way** | yes — a streaming host for websites, which is what we are doing with it | yes, and the paid tier is the intended way to serve | **no**: its operator's own blog (July 2026) names "social spaces or other user generated content sites that are using Catbox for file uploads" as not allowed by the Terms of Service and Acceptable Use Policy, and states that "uploads from datacenter/non-residential IP addresses will be heavily filtered and/or purged". A store platform with ads, uploading from a server, is that description. Its paid Spaces product exists for creators who want to publish |

So the registry answers two questions instead of one, and both answers are data:

```js
capabilities.kinds        // the kinds this host is FOR — ['video'] for Filemoon
capabilities.policy       // { commercial: 'allowed' | 'premium' | 'prohibited', note }
hostAccepts(kind, host)   // the router's gate, asked before bytes move
hostSuitability(host)     // the verdict the doctor prints
```

**What that changes concretely:** nothing for video on Filemoon, which is the host the product deploys with
and the kind it is for. What it prevents is the tempting edit — "audio is playable by the same predicate, let
it go to the host" — landing an audio file at a host that would serve it as a download, or at Catbox, whose
terms forbid the use. Audio, images, archives and documents stay on our disk, where they already were, but
now for a *stated reason per kind* rather than because a boolean happened to be named after video.

**And one honest gap.** GoFile is the only one of the three whose design fits audio and images as well as
video. It is not used for them because its playable links are Premium and its free storage expires — an
economic answer, not a technical one. A future round that wants hosted audio or a hosted image library
should price that host first, and §2's third refusal ("audio does not leave this round") is the line to
revisit before anything else.
