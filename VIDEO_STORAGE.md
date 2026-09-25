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
2. **Covers and reader pages never go to a VIDEO host.** Covers are served from `/media/public/*` with no
   token (that is the point of a cover); a reader's CBZ is offset-addressed by our own archive reader and its
   pages are gated one at a time. Neither is video, and neither has any business at a video host — and since
   §10.6 the routing says so per kind rather than by one switch: `VIDEO_DRIVER` cannot be given an image.
   **Amended by this round:** an image *may* leave by its own door (`IMAGE_DRIVER`) to the one host built for
   it, and an archive may leave by `FILE_DRIVER` to a general file host — but only ever as a whole file. A
   reader that must index a store's CBZ byte-offset by byte-offset could not read it back from a host at all
   (`assetPagePlan` loads the archive through `storage.get`), so archives that a store's READER opens stay on
   this disk whatever the configuration says. Only a download-shaped archive may leave.
3. **Audio still does not leave by the VIDEO path — and now has a door of its own.** `isPlayable` covers audio
   too, and `VIDEO_DRIVER` is a video host: Filemoon would serve an mp3 as a download, trading away the
   surface below for a CDN hop that buys nothing on a 2 MB file. That refusal is unchanged. What changed is
   that `FILE_DRIVER=pixeldrain` **can** take audio — a host that serves it with byte ranges and can delete
   it — so the sentence here is no longer "audio never leaves" but "audio never leaves by the video host, and
   only ever to a host that serves it as a file".
   **The surface, not the storage:** audio's own player is real and verified — `app/seed-assets/bell-tone.wav`
   (2 s, 32 KB, written by hand rather than by a codec) uploads, renders the `audio-shell` with its ♪ glyph,
   and plays (`readyState` 4, duration 2 s) with no video element anywhere on the page. Whether the bytes come
   off this disk or off Pixeldrain, that shell and that element are what the viewer meets, because delivery
   and playback were never the same question (§1).

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
namespace named after it. Four hosts are configured for the same seam — Filemoon, Pixeldrain, Telegra.ph,
Catbox — and they are chosen per KIND of media (§10.6), not by one switch.
and the honest summary of the research is that they are **not interchangeable**. They differ in exactly the
places the product depends on, so the differences are recorded here before a line of client code, and then
encoded in the registry, the doctor and the seller's own copy.

**And they are not four interchangeable stores.** That was the first version's other mistake, and §10.5 is
the correction: each of these services is *designed* for a different kind of file — video, any file, images,
small files — and the registry carries that as data (`capabilities.kinds`, `capabilities.policy`,
`capabilities.deletable`) with the router consulting it per kind (§10.6), because routing a kind to a host
that is not for it is not a graceful degradation, it is a file a viewer cannot open.

### 10.1 The facts as documented, per host

**GoFile is gone.** It was the third host added, and it is removed in this round by the repo owner's
instruction after the research came back: on a free or guest account it cannot produce a playable link at all
(§10.5), so the only way to use it was to pay for storage of files this product keeps on its own disk anyway.
Its module (`src/video-gofile.js`), its stub, its tests, its doctor output and its environment variables are
deleted rather than left dormant — a provider that is present but always refused is a provider somebody will
one day route to. The one thing kept from it is the lesson: **a host whose playable link is the paid feature
cannot be a store's delivery path.**

| | Filemoon | Pixeldrain | Telegra.ph | Catbox |
| --- | --- | --- | --- | --- |
| what the credential is | API token `id\|secret`, sent as `Authorization: Bearer` | **`Authorization: Basic` with the API key in the PASSWORD field** and an empty username | **none** — the upload node takes a file from anybody | `userhash`, a form field on every call |
| upload | `POST /files/upload`, multipart `file` (+ `visibility`) | **`PUT /api/file/{filename}` with the bytes as the raw body** — the docs recommend this over the multipart form, which "can cause performance issues" | `POST https://telegra.ph/upload`, multipart `file` — **not `api.telegra.ph`**, which refuses this node | `POST https://catbox.moe/user/api.php`, `reqtype=fileupload` |
| response | JSON, shape unconfirmed here | JSON with a `success` boolean; refusals carry a `value` code (`hotlink_detected`, `not_found`, …) | **an ARRAY on success — `[{"src":"/file/x.jpg"}]` — and an OBJECT on failure** (`{"error":"FILE_TYPE_INVALID"}`) | **plain text**, the url itself, or an error sentence |
| a playable url | `playback_url` / `hls_url` on the file record | `GET /api/file/{id}`, byte ranges supported | `https://telegra.ph` + the returned path; permanent | the upload's return value *is* the url |
| deletion | `DELETE /files/{id}` | `DELETE /api/file/{id}` — a real delete | **none.** No endpoint, no account, no key: a file sent there cannot be recalled by anybody | `reqtype=deletefiles`, by file NAME |
| durability | until deleted | until deleted — but **API keys expire 30 days after their last use** | permanent | permanent |
| size | not published here | plan-dependent; no published hard number | **5 MB per file** (5,242,880 B) | **200 MB per file**, hard |
| formats | twelve video containers, auto-encoded for streaming | any file | **jpg, jpeg, png, gif** — and mp4, which we decline | images, audio, video; blocks `.exe`, `.scr`, `.cpl`, `.doc*`, `.jar` |
| listings | `GET /files` | none used — our database is the record | none | none |
| documentation | documented | documented | **UNDOCUMENTED, NOT PART OF THE PUBLISHED API** | documented |
| media delivery | playlist or progressive, per file | progressive, with ranges | progressive | progressive only |

Three consequences follow, and each belongs in code rather than in a footnote.

**Telegra.ph cannot delete, and that is a product fact rather than a limitation.** There is no endpoint, no
account and no key — an image sent there is public forever. A store that removes an image from its page has
not removed it from the internet, and this product must not imply otherwise. So it is declared —
`capabilities.deletable: false` — `remove()` throws a sentence that says why, the delete route reports the
removal as *unconfirmed* rather than toasting a success, and the boot line prints
`image → telegraph — cannot delete — a file sent there stays`. The §6 rule holds: a promise about deletion
has to be a call that unlinks the bytes, and where there is no such call there is no such promise.

**Pixeldrain's free plan refuses hotlinks, and a store page loading its url is a hotlink.** Its own error
list contains `hotlink_detected: 403 — "hotlinking is only allowed with a premium subscription"`, and its
download limits are described as existing "to stop hotlinking". Our route hands the viewer's browser a 302 to
a pixeldrain url, which is exactly the traffic that rule describes. That makes this host
`policy.commercial: 'premium'` **for our use**, printed as such by `--drivers` and warned about by the doctor
when the key's plan is free. It is not a reason to refuse the upload — the bytes land, the url works, the
delete works — but whether it will serve them to a viewer is a fact about the account. **Which is why the
first thing to run on a machine with real network access is `--driver=pixeldrain --upload`, then open the
returned url in a browser.**

**Telegra.ph's 5 MB cap is refused locally, and its liveness is not assumed.** The cap is checked in
`upload()` before a byte moves (the Catbox pattern), and because the endpoint is undocumented — one widely
used self-hosted image host says Telegram discontinued it in September 2024, while other tools kept using it
successfully — nothing here claims it works. There is a probe instead:
`npm run video:check --prefix app -- --probe-telegraph` makes a small png, uploads it through the product's
own code path, fetches the url back, and answers the question where the answer exists. **Catbox's 200 MB cap
is refused the same way**, for the same reason: a cap discovered after the bytes cross the wire is somebody's
data allowance spent to learn what the client already knew.

### 10.2 What the registry looks like

- **The provider is part of the key.** `filemoon/<id>` was always a namespace; it is now a *provider*
  namespace: `pixeldrain/<id>`, `telegraph/<name>.png`, `catbox/<name>.mp4`. This is not cosmetic. A store's file keeps playing from
  wherever it was uploaded even after `VIDEO_DRIVER` changes, and a delete goes to the host that holds the
  bytes rather than to whatever is configured today. A key is a promise about where the bytes are.
- **One driver PER KIND of media** (§10.6): `VIDEO_DRIVER`, `IMAGE_DRIVER`, `FILE_DRIVER`, all unset by
  default — which is what keeps "no configuration means every byte on our disk" true. A kind with no driver
  declared stays home.
  Existing files are read from their own provider. Per-store or per-file provider choice is a product
  decision (and a UI) that this round does not make.
- **One interface, four functions.** `upload`, `playback`, `remove`, `account`. Everything above the
  registry — the storage router, the two content routes, the seeder, the player's `data-hls` decision —
  keeps talking in keys and does not learn any host's field names.
- **Capabilities are data, not prose.** Each provider exports its caps (max bytes, whether it can serve HLS,
  whether it is durable, whether a listing exists, **whether it can delete**) so the doctor and the tests
  read the same numbers the refusal messages are built from. `deletable` is the newest of them, and the one
  that changes what the product may promise a seller.
- **The key regexes are per provider and are allowlists.** `remoteId()` returns null for anything that does
  not match its own provider's shape, so a key that reaches a route from a URL cannot become a path, a query
  or a second host.

### 10.3 What is verified, and where

Nothing below was exercised against a live host: this sandbox has no egress to `filemoon.org`,
`pixeldrain.com`, `telegra.ph` or `catbox.moe` (all four reset or refuse before TLS; `api.github.com`
answers, so it is an allowlist, not a broken network). The split from §9 therefore stands, with a column per
host:

| what | how |
| --- | --- |
| each client's contract | `test/video.test.js` against a per-provider stub in-process: field names, headers, the plain-text response, the envelope's `status` field beating HTTP 200, the size refusal, the free-tier refusal |
| the whole suite with each driver on | `ci/stub-pixeldrain.mjs` (Basic auth whose password is the key, raw-body PUT, ranges, an optional `--hotlink` refusal mode), `ci/stub-telegraph.mjs` (multipart and both answer envelopes, with `--off` for the discontinued case), `ci/stub-catbox.mjs`, `ci/stub-filemoon.mjs` |
| playback per host | `ci/eyes/video-host-walk.mjs` against an instance configured for that driver: the 302, the player's own request, and the picture advancing |
| the doctor's own modes | every one run against the stubs **in this round**: `--driver=pixeldrain --upload` (auth, upload, playback url, Range `206 bytes 0-1/32044`, delete confirmed); `--probe-telegraph` (upload answered, url served back `HTTP 206 image/png`); `--probe-telegraph` against `--off` (reported in the words *the upload node is gone*, with the fallback named) |
| the live hosts | `npm run video:check -- --drivers` on a machine with ordinary network access, then `--driver=pixeldrain --upload <file>` and `--probe-telegraph` — the answers that cannot be had from here |

Range is the one unverifiable-from-here behaviour that a viewer will notice: a host that ignores `Range`
gives a video that plays but cannot be scrubbed. The doctor probes it and reports the answer rather than
assuming one, because "our player, their delivery" is a claim about seeking as much as about bytes.

**The walk has now been run against all three stubs**, and the runs produced the exact recipes below — plus
two facts that are easy to get wrong when setting an instance up. Both were found by running it, not by
reading it:

| driver | stub | instance needs, beyond the driver's own variables |
| --- | --- | --- |
| Filemoon | `node ci/stub-filemoon.mjs 3999 [--hls]` | `VIDEO_MEDIA_ORIGINS=http://127.0.0.1:3999` |
| Pixeldrain | `node ci/stub-pixeldrain.mjs 4003 [--hotlink] [--cap=bytes]` | `FILE_DRIVER=pixeldrain`, `PIXELDRAIN_API_BASE=http://127.0.0.1:4003/api` (**the `/api` is part of the base**, not a path we add), `PIXELDRAIN_API_KEY=stub-key`, and `VIDEO_MEDIA_ORIGINS=http://127.0.0.1:4003` |
| Telegra.ph | `node ci/stub-telegraph.mjs 4004 [--off]` | `IMAGE_DRIVER=telegraph`, `TELEGRAPH_UPLOAD_BASE=http://127.0.0.1:4004/upload`, `TELEGRAPH_FILE_BASE=http://127.0.0.1:4004`, and `VIDEO_MEDIA_ORIGINS=http://127.0.0.1:4004` |
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

**Changing a driver is a reseed, not a restart.** The provider is part of the storage key (§10.2), so an
instance pointed at Pixeldrain still reads the demo's `catbox/…` files from Catbox — which is the design
working, and also why `scripts/test-db.mjs` comes before boot whenever a driver changes. `node scripts/test-db.mjs` first, then boot; a reseed also invalidates the harness's saved session,
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
   CORS-bound. That is why the Catbox and Pixeldrain paths play end to end through the same redirect
   (`the file plays off the host's bytes — 0.41s in, readyState 4`).

What can be done about it is a decision rather than a fix: the CDN may send the header (unknown until
`npm run video:check` asks a real one — the doctor now probes it and names the origin), a store's files can
be limited to progressive sources, or the playlist and its segments can be proxied through our own origin —
which works but puts every hosted byte through this server, which is what §5 was written to avoid. Until
one of those is chosen, a hosted **HLS** file is a file a viewer cannot watch in a browser, and both the
walk and the doctor say so in those words rather than reporting a broken player.

3. **The same wall, one directive over, found by walking an image.** Adding the image host in §10.6 produced
   the identical failure the media-src bug had produced, in `img-src`: the policy was `img-src 'self' data:`,
   the page's `<img>` pointed at our content route, the route answered 302 to the image host — and **the
   request was never made**. `naturalWidth` was 0 and the network log was empty, with no console error a
   seller would ever report. The fix is the sentence this document already had: a route that redirects means
   CSP judges the destination, so every directive that can receive one has to name the origins. `img-src`
   now carries the configured media origins and `https:` (an image cannot execute or exfiltrate anything;
   `script-src` and `connect-src` stay narrow). There is a test for it beside the media-src one in
   `test/vendor.test.js`, because this is the second time this bug has been found by walking rather than by
   reading, and the second time is a pattern.

**The two new kinds were then walked end to end**, on an instance with all three drivers configured
(`/tmp/eyes/kind-walk.mjs`, kept out of the repository like the other scratch walks): an image whose bytes
are at the image host is **drawn** (`96×54`) after the browser fetched it from `…:4004/file/<name>.png`, and
an audio file at the general host **plays** (`0.48s in, duration 2s, readyState 4`) with the bytes arriving
as `206 …:4003/api/file/<id>` — inside our own `<audio>` shell, no video element anywhere. A fresh seed under
those drivers put **4 files at the video host, 20 at the general host and 1 image at the image host**, which
is the routing table of §10.6 doing the work across a whole demo rather than in a single test.

### 10.5 What each host is FOR — the question that decides routing

Researched rather than assumed, because the first draft of this document called all three "video hosts" and
set one boolean for the whole registry. They are three different services that happen to share an HTTP
shape, and the difference is exactly the thing the product's own surfaces depend on: whether a viewer can
**watch or read the file in our page**, or only download it.

| | Filemoon | Pixeldrain | Telegra.ph | Catbox |
| --- | --- | --- | --- | --- |
| what it is designed to be | a **video host**: twelve video formats, every upload encoded for streaming, HLS delivery, subtitles, posters, an embeddable player, remote and FTP intake | a **general file host**: any kind, a direct url per file with byte ranges, public and private files, real deletes — built for exactly this shape of use | an **image endpoint that happens to exist**: Telegram's publishing site exposes an undocumented upload node that takes jpg/png/gif and returns a permanent link | a **small-file hotlink host**: images, audio, short video, served from a static url, kept forever |
| non-video files | accepted, then **download-only** — its own words: "stream supported videos online **or download allowed files**" | first-class; this is the host's whole purpose | is the non-video case. Video is refused *by us* though the node would take an mp4 (no delete, and Filemoon exists) | first-class (except executables, `.doc*`, `.html`/`.php`) |
| what a page needs from it | an HLS or progressive url per file | a stable direct url — `GET /api/file/{id}`, ranges honoured | a stable direct url — `telegra.ph/file/<name>` | the upload's answer *is* the url |
| capacity | free: 1 GB guest / 2 GB registered per file; premium: uncapped | plan-dependent; no published hard number | **5 MB per file** | **200 MB hard**; GIF 20 MB |
| retention | until deleted | until deleted; **API keys expire after 30 days of no use** | permanent — in the strongest sense | permanent |
| **may we use it this way** | yes — a streaming host for websites, which is what we are doing with it | yes, and **the delivery path wants a paid plan**: hotlinking is its paid feature (`hotlink_detected: 403`) and our 302 is a hotlink | undefined: no terms cover third-party file hosting and the endpoint is undocumented. Fine for images a store need never recall; not a place for anything that must come back | **no**: its operator's own blog (July 2026) names "social spaces or other user generated content sites that are using Catbox for file uploads" as disallowed, and states datacenter uploads "will be heavily filtered and/or purged". A store platform with ads, uploading from a server, is that description |

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

**The gap, and how this round closed it.** The first version of this section ended by saying GoFile was the
only host whose design fit audio and images, that it was unusable for economic reasons, and that a future
round wanting hosted audio should price it first. This is that round, and the answer changed shape: GoFile is
removed, and two hosts take the two halves of the gap.

* **Pixeldrain takes audio, archives, documents and every other file kind** — kinds that are already
  download-shaped in this product (§2). None of them needs a player; they need a stable url, a range and a
  delete, which is exactly what this host publishes. It takes video as well, so `FILE_DRIVER=pixeldrain`
  alone is a complete deployment for a store with no video host.
* **Telegra.ph takes images** — the one kind that is both small enough and free to host, at the price of
  being permanent and undocumented. It is the only provider here whose use is limited by a *product promise*
  rather than by capacity.

So §2's third refusal ("audio does not leave this round") is now **conditional rather than absolute**: audio
may leave, by `FILE_DRIVER`, to a host that serves it as a file — and the surface a viewer meets is still a
real `<audio>` element in our own shell, because delivery and playback were never the same question (§1).

### 10.6 Which host takes which KIND — the routing table

One boolean could not survive four hosts. The first version gated everything on a single `videoHostEnabled()`
and one `VIDEO_DRIVER`, which was right while one host existed and would now either send a photo to a video
host or keep every archive on disk with no way to say otherwise. The router asks per kind, and all of it is
one function:

```js
driverForKind(kind, env)   // 'filemoon' | 'pixeldrain' | 'telegraph' | 'catbox' | 'local'
```

| kind (`mediaKind`) | variable | this deployment | what it holds |
| --- | --- | --- | --- |
| `video` | `VIDEO_DRIVER` | filemoon | the player's source: HLS or progressive |
| `image` | `IMAGE_DRIVER`, falling back to `FILE_DRIVER` | telegraph | pictures a page loads with `<img>` |
| `audio` | `FILE_DRIVER` | pixeldrain | a file our `<audio>` shell fetches |
| `file` (archives, documents, anything else) | `FILE_DRIVER` | pixeldrain | a download |

Four rules make it behave, and each is something that would otherwise be got wrong once per deployment:

1. **Unset means local.** Every variable starts unset, so a fresh clone, the demo, and any deployment that
   never wanted a host keep every byte on disk. Nothing about the default changed.
2. **Specific, then general.** An image prefers `IMAGE_DRIVER` and falls back to `FILE_DRIVER`, so a
   deployment configuring one general host gets that host for everything it accepts, with no second variable.
3. **A kind a host does not accept falls THROUGH rather than being hijacked.** `VIDEO_DRIVER=telegraph` does
   not send video to an image endpoint that cannot delete it: `hostAccepts` refuses, and the search continues
   to `FILE_DRIVER`. This is what makes configuring hosts in any combination safe.
4. **`kyc` and `public` never leave, whatever the variables say.** Unchanged, and still absolute — the
   storage adapter decides that before the kind is even computed.
5. **A host's limit is not the product's limit.** The router asks about the FILE, not only its kind —
   `acceptsFile` on each provider answers for the 5 MB image cap, Catbox's 200 MB and its blocked
   extensions — and where a host would refuse, **the file is stored on our own disk and the upload still
   succeeds**. Nothing about the seller's experience changes except which disk holds the bytes, and the
   reason is logged once. This rule was written because a boot failed: the demo seeder uploads a jpg with
   `storage.put(bytes, 'kathmandu-street.jpg')` and no mime type, the image host refused it for being
   `application/octet-stream`, and the whole seed threw. Two fixes came out of that one failure — the
   client now derives the type from the filename and sends it *consistently* for both its own check and the
   wire, and the router falls back to local storage instead of turning one host's rule into the platform's.

**The lesson worth keeping from writing this.** The first draft of the Pixeldrain module declared
`kinds: ['video','audio','image','archive','document']`, which reads perfectly and could never match
anything: the router's vocabulary is `mediaKind`'s — `video`, `audio`, `image`, and `file` for everything
else. Every archive, pdf and epub would have stayed on disk while the registry *looked* configured. A
declaration that is never consulted is worse than a missing one, because it looks like the work is done.
There is now a test in `test/video.test.js` that holds every provider's `kinds` to that vocabulary.

**And the operator sees it.** Boot prints the routing it will actually use, per kind, with the caveat that
matters for each host — `telegraph — cannot delete — a file sent there stays`,
`pixeldrain — needs a paid plan to serve` — and `npm run video:check -- --drivers` prints the same table plus
each host's terms. Both read from `capabilities`, so neither can drift from what the code does.
