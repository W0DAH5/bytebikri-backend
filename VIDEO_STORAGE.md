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
| `VIDEO_DRIVER` | the host for **video** — `filemoon`, `pixeldrain`, `catbox`, or unset for our disk. **Never `apivideo`**: it stores nothing, so routing a file to it is impossible by declaration (§11.2) |
| `IMAGE_DRIVER` | the host for **images** — `telegraph`, `pixeldrain`, or unset |
| `FILE_DRIVER` | the host for **audio, archives, documents and anything else** — `pixeldrain`, or unset |
| `LIVE_DRIVER` | **the host that runs a live ingest** — `apivideo`, or unset to keep the seller pasting their own playlist |
| `VIDEO_MEDIA_ORIGINS` | extra origins the page may load media from and fetch playlists from (§10.4) |
| `FILEMOON_TOKEN` | `id\|secret`, sent as `Authorization: Bearer …` |
| `FILEMOON_API_BASE` | defaults to `https://filemoon.org/api/v1` |
| `APIVIDEO_API_KEY` | api.video key — Basic auth, **key as the username with a trailing colon** |
| `APIVIDEO_BASE` | `https://ws.api.video` (production) or `https://sandbox.api.video` (video 30 s, live stopped at 30 min, watermarked, 24 h) |
| `PIXELDRAIN_API_KEY` | Pixeldrain key — Basic auth, **key as the password**, empty username |
| `PIXELDRAIN_API_BASE` | defaults to `https://pixeldrain.com/api` (the `/api` is part of the base) |
| `TELEGRAPH_UPLOAD_BASE` | defaults to `https://telegra.ph/upload` — **not** `api.telegra.ph`, which refuses that node |
| `TELEGRAPH_FILE_BASE` | defaults to `https://telegra.ph` |
| `CATBOX_USERHASH` | Catbox account userhash (uploads and deletes for the whole account) |
| `CATBOX_API_BASE`, `CATBOX_FILE_BASE` | defaults to the API and the `files.` CDN — two hosts, and both are needed |

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

**The first of those was only true for video, and the promise is older than the routing.** When this was
written the only thing that left the disk was a video at a player host, so one sentence covered it: *"A video
is kept and delivered by the platform's media host… everything else a store uploads stays on this server."*
Then the registry learned to route by kind — a picture to Telegra.ph, a document or a sound file to
Pixeldrain or Catbox — and the sentence went on saying what it had always said. For a Telegraph-hosted PNG
the seller's page stated, in two clauses, that video was the only kind held elsewhere and that everything
else stayed here: both false, on the page of the one person entitled to know, with no test able to see it
because a sentence is not a return value. `ci/eyes/publish-walk.mjs` found it — and then found that its own
check had been written against the wording the walk *expected* rather than the wording the page rendered, so
it had been failing on a correct page before it failed on a wrong one.

What the page says now is derived, not remembered. The provider comes from the **storage key** — the thing
the upload actually wrote — through `remoteProvider()`, and its name from the registry's own `label`; the
delivery tier comes from `deliveryOf()`, the same call the route consults, so the page cannot claim a viewer's
address reaches the host when the request in fact goes through this server or through Cloudflare. Every file
names where it is, local files included ("on this server", which is a fact rather than silence), and the
paragraph explains the policy once — per-kind routing, the door staying ours, and what the privacy notice
already says in the same words.

**A second instance of the same mistake, found while fixing the first:** the delete page's first line —
*"N files (N held at a media host) — destroyed"* — read a prop (`f.hosted`) that its route never passed, so
the count was always zero and the clause silently never appeared. Nothing about deleting was wrong; the one
sentence that tells a seller some of these bytes are not on our disk simply never rendered. It now names the
hosts, from the same key.

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
namespace named after it. Five hosts are configured for the same seam — Filemoon, api.video, Pixeldrain,
Telegra.ph, Catbox — and they are chosen per KIND of media (§10.6), not by one switch. §11 adds the one
capability none of the others has: a live ingest the platform can run for a seller.
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

| | Filemoon | api.video **(live only)** | Pixeldrain | Telegra.ph | Catbox |
| --- | --- | --- | --- | --- | --- |
| what the credential is | API token `id\|secret`, sent as `Authorization: Bearer` | **API key as the USERNAME of Basic auth, with a trailing colon** (`basic base64("<key>:")`); a Bearer token can be minted from `/auth/api-key` | **`Authorization: Basic` with the API key in the PASSWORD field** and an empty username | **none** — the upload node takes a file from anybody | `userhash`, a form field on every call |
| upload | `POST /files/upload`, multipart `file` (+ `visibility`) | **not used.** The upload path exists in their API (`POST /videos`, then `/videos/{id}/source`) and this product does not call it: the host stores nothing here (§11.2) | **`PUT /api/file/{filename}` with the bytes as the raw body** — the docs recommend this over the multipart form, which "can cause performance issues" | `POST https://telegra.ph/upload`, multipart `file` — **not `api.telegra.ph`**, which refuses this node | `POST https://catbox.moe/user/api.php`, `reqtype=fileupload` |
| response | JSON, shape unconfirmed here | JSON with honest HTTP codes and a `{type,title,status}` body; **rate-limit headers on every response** | JSON with a `success` boolean; refusals carry a `value` code (`hotlink_detected`, `not_found`, …) | **an ARRAY on success — `[{"src":"/file/x.jpg"}]` — and an OBJECT on failure** (`{"error":"FILE_TYPE_INVALID"}`) | **plain text**, the url itself, or an error sentence |
| a playable url | `playback_url` / `hls_url` on the file record | `assets.hls` on the LIVE STREAM — the playlist our own player plays | `GET /api/file/{id}`, byte ranges supported | `https://telegra.ph` + the returned path; permanent | the upload's return value *is* the url |
| deletion | `DELETE /files/{id}` | `DELETE /live-streams/{id}` — a real delete, and what the doctor uses to leave no container behind | `DELETE /api/file/{id}` — a real delete | **none.** No endpoint, no account, no key: a file sent there cannot be recalled by anybody | `reqtype=deletefiles`, by file NAME |
| durability | until deleted | nothing is kept: an unrecorded stream leaves no bytes; the **sandbox deletes everything after 24 h** | until deleted — but **API keys expire 30 days after their last use** | permanent | permanent |
| size | not published here | **no cap on stream duration or on how many run at once**; the one ceiling is the bill — delivery is metered per viewer-minute (§11.1) | plan-dependent; no published hard number | **5 MB per file** (5,242,880 B) | **200 MB per file**, hard |
| formats | twelve video containers, auto-encoded for streaming | live video in (RTMP/RTMPS/SRT), adaptive HLS out; **the sandbox stops live at 30 minutes** | any file | **jpg, jpeg, png, gif** — and mp4, which we decline | images, audio, video; blocks `.exe`, `.scr`, `.cpl`, `.doc*`, `.jar` |
| listings | `GET /files` | none used — our database is the record | none | none |
| **live** | none | **`POST /live-streams` → a streamKey and an HLS url; RTMP/RTMPS/SRT ingest at `broadcast.api.video`** | none | none |
| documentation | documented | documented | documented | **UNDOCUMENTED, NOT PART OF THE PUBLISHED API** | documented |
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
| the doctor's own modes | every one run against the stubs **in this round**: `--probe-live` (a stream minted, the OBS/ffmpeg ingest lines printed, `broadcasting` read, the playlist CORS-checked, the container removed); `--driver=apivideo --upload` (**refused** — this host stores nothing, and the doctor says so instead of uploading); `--no-cors` (the §10.4 wall modeled on a live playlist); `--driver=pixeldrain --upload` (auth, upload, playback url, Range `206 bytes 0-1/32044`, delete confirmed); `--probe-telegraph` (upload answered, url served back `HTTP 206 image/png`); `--probe-telegraph` against `--off` (reported in the words *the upload node is gone*, with the fallback named) |
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
| api.video | `node ci/stub-apivideo.mjs 4005 [--sandbox] [--no-cors]` | `LIVE_DRIVER=apivideo`, `APIVIDEO_BASE=http://127.0.0.1:4005`, `APIVIDEO_API_KEY=stub-key`, `VIDEO_MEDIA_ORIGINS=http://127.0.0.1:4005` (the stub has no RTMP ingest — fetch the playlist to mark a stream broadcasting, which is also what flips `broadcasting`) |
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

| | Filemoon | api.video | Pixeldrain | Telegra.ph | Catbox |
| --- | --- | --- | --- | --- | --- |
| what it is designed to be | a **video host**: twelve video formats, every upload encoded for streaming, HLS delivery, subtitles, posters, an embeddable player, remote and FTP intake | **live video infrastructure**, and the only host here that runs an ingest: RTMP/RTMPS/SRT in, adaptive HLS out, free and unlimited encoding. It also sells storage and we do not buy it (§11.2) | a **general file host**: any kind, a direct url per file with byte ranges, public and private files, real deletes — built for exactly this shape of use | an **image endpoint that happens to exist**: Telegram's publishing site exposes an undocumented upload node that takes jpg/png/gif and returns a permanent link | a **small-file hotlink host**: images, audio, short video, served from a static url, kept forever |
| non-video files | accepted, then **download-only** — its own words: "stream supported videos online **or download allowed files**" | **not applicable: no file is sent to it at all** | first-class; this is the host's whole purpose | is the non-video case. Video is refused *by us* though the node would take an mp4 (no delete, and Filemoon exists) | first-class (except executables, `.doc*`, `.html`/`.php`) |
| what a page needs from it | an HLS or progressive url per file | a live `…m3u8` our own player plays — an absolute url on their CDN, fetched by hls.js | a stable direct url — `GET /api/file/{id}`, ranges honoured | a stable direct url — `telegra.ph/file/<name>` | the upload's answer *is* the url |
| capacity | free: 1 GB guest / 2 GB registered per file; premium: uncapped | no cap on concurrent streams or duration; the meter is delivery minutes. **The sandbox stops live at 30 minutes** | plan-dependent; no published hard number | **5 MB per file** | **200 MB hard**; GIF 20 MB |
| retention | until deleted | nothing is retained unless a seller enables recording; the sandbox is 24 hours by design | until deleted; **API keys expire after 30 days of no use** | permanent — in the strongest sense | permanent |
| **may we use it this way** | yes — a streaming host for websites, which is what we are doing with it | yes — live streaming is exactly what the product is sold for; the sandbox is for testing and production is pay-as-you-go | yes, and **the delivery path wants a paid plan**: hotlinking is its paid feature (`hotlink_detected: 403`) and our 302 is a hotlink | undefined: no terms cover third-party file hosting and the endpoint is undocumented. Fine for images a store need never recall; not a place for anything that must come back | **no**: its operator's own blog (July 2026) names "social spaces or other user generated content sites that are using Catbox for file uploads" as disallowed, and states datacenter uploads "will be heavily filtered and/or purged". A store platform with ads, uploading from a server, is that description |

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
| — | `LIVE_DRIVER` | apivideo | **not a kind of file**: who runs the ingest and mints a stream's playlist (§11) |

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

## 11. api.video: the live ingest, and what "no limit" actually means — **HISTORY, REMOVED**

> **This section is no longer about code in this repository.** The provider was removed at the owner's
> instruction (commit `68a3bea` and the commit that follows it): it is the metered host, it needs a payment
> method before a store can broadcast for real, and the owner has none — the live path now runs on Ant Media
> Server, which is free software on a machine of ours (§12). What remains below is the RESEARCH, kept because
> it is the reasoning that made §12 readable: how a metered live host behaves, what its sandbox does to a
> seller's broadcast, and what "no viewer limit" turned out to mean. The code, the stub and the credential are
> gone; `LIVE_DRIVER` no longer accepts `apivideo` as a value and a typo there is treated as unset, exactly
> as any other misspelled driver is.

api.video was the fifth host on the list and the only one that is **not a place files live**. It was used
for one thing — running a seller's live stream — and the reasons are in §11.2 and §11.3. What follows is
what their own pages say, including the part that is easy to read past.

### 11.1 The limits, in their words

**There is no cap on how many streams run at once, and no cap on how long one runs.** Two of their own
pages, because this is the claim that decides whether a seller can rely on it:

> "with api.video there is no such limitation — as long as you have cameras (and available bandwidth),
> you can stream to your heart's content from every single one of them … You can create as many streams
> as you'd like."
>
> — *How many live streams can I run at once?*, api.video blog

> "You can stream events for as long as you want. If you go over 24 hours, the live stream recording will
> be divided into multiple 24-hour videos."
>
> — *Live streaming*, api.video product page (their own FAQ)

**Encoding is free and unlimited**, at every quality up to 4K — that is the platform's core pitch on their
pricing page, not a rounding.

**But live is metered, and the meter is the viewers.** Two units, and both apply to streams:

| what is billed | their rate | what it means for a store here |
| --- | --- | --- |
| **Delivery** — per minute *watched*, per viewer | from **$0.0017/min** (≈ $1.70 per 1,000 viewer-minutes) | a 1-hour stream watched by 100 people ≈ 6,000 minutes ≈ **$10.20** |
| **Hosting** — per minute *stored* | from **$0.00285/min/month** | applies to every video **and every recorded live stream**: an hour of replay kept for a month ≈ $0.17 |

Their terms state the segment sizes too, which is why a live minute bills slightly differently from a VOD
one: **4-second segments for VOD, 2-second segments for live**, counted as minutes delivered. A stream
nobody watches delivers nothing, so it costs nothing beyond the ingest.

**The honest version of "no limit":** there is no ceiling on quantity, duration or encoding — the ceiling
is money, and it is proportional to viewers. That is a better shape for a store than a hard cap (a quiet
stream is nearly free, a big one costs in proportion to the audience it reached), but it is not free, and
Nepal-first means the bandwidth is ours only in the sense that we pay for it.

**The sandbox is not a small version of production — on LIVE it has its own cut-offs:** video is cropped
to 30 seconds; **live is stopped at 30 minutes and its recording is cut at 30 seconds**; everything is
watermarked and deleted after 24 hours. Their API reference summarises this as "limited to 30 seconds
videos and live streams", which contradicts the more specific live page — assume the stricter reading and
measure it on your own key (§11.5, question 3).

### 11.2 Decision: this host is LIVE ONLY

**api.video stores nothing for this product, and the registry enforces it.** `capabilities.kinds` is an
empty array, and `driverForKind()` consults exactly that list, so no value of `VIDEO_DRIVER` — not
`apivideo`, not a typo of it — can route a file here. A test asserts the empty list, and that every kind
lands somewhere that actually stores it.

The reasoning is the bill above. We already have hosts that hold files at no marginal cost per minute
(and our own disk for free). Paying a **minute-meter for storage** when the encoding is free and the
ingest is the scarce thing would be paying for the wrong half of the product. So:

* `POST /videos` and the whole upload path are **gone** from `video-apivideo.js`, along with
  `acceptsFile`, the 200 MiB single-request ceiling, `mp4Support` and `APIVIDEO_PLAYBACK`. What remains is
  the credential check, the workspace listing the account check reads, and the live half.
* `ci/stub-apivideo.mjs` **lost its upload routes too**, and the in-process double in the suite with it.
  A double that keeps modelling a removed capability is how a dead path goes on looking alive.
* **`record` defaults to off.** A recorded stream becomes a stored video, and stored minutes are billed —
  so a replay is a decision a seller or an owner makes, never something that quietly starts costing money
  when somebody presses Go live. (Their live best-practices page says streams are recorded automatically;
  where that is true, the recording is what the hosting meter counts, which is another reason to keep this
  deployment's use of the host to *running a stream* and to check the dashboard's usage after a test
  broadcast — §11.5, question 4.)

### 11.3 The live path, as built

**`LIVE_DRIVER=apivideo` is a second kind of driver, not a sixth media host.** The three per-kind
variables decide where bytes are *stored*; this one decides who *runs the stream*. The file a seller
publishes is still a live file with an `.m3u8` in `external_url`, so the player, the cue, the breaks and
the unlock ladder cannot tell a playlist we minted from one the seller pasted — the whole reason this
fits. Unset (the default) means today's behaviour, unchanged.

**The streamKey is never stored.** It is a broadcasting credential; `GET /live-streams/{id}` returns it, so
the owner's panel fetches it when the panel is opened. What our database keeps is the container id.

**The CSP names the live host by name** (§11.4, finding 2) — the deployment shape this is built for is
files on one host and live on another.

### 11.4 What running it proved

Everything above was exercised against `ci/stub-apivideo.mjs`, which enforces this host's shape rather
than agreeing with us: Basic auth with the key as the username and a **trailing colon** (a key-as-password
attempt gets a 401, exactly as the real host answers it), a stream that is not `broadcasting` until
something pushes, a listing route, and playlists that can be served with or without CORS headers.

| mode | what it showed |
| --- | --- |
| `--drivers` | five hosts on the credential table, `apivideo configured · live only · nothing stored · metered per minute DELIVERED`, and the routing table showing **no kind going to it** |
| `--probe-live` | a stream minted (`li3420a370595432befc`), its stream key and **all three ingest addresses** printed ready to paste into OBS or ffmpeg, `broadcasting: not yet` read back truthfully, the playlist CORS-checked, the metering restated, and the container removed — *no container left behind* |
| `--driver=apivideo --upload <file>` | **refused in two lines**, with the reason (this host holds no files) and the command that does apply to it. A doctor that uploaded anyway would be describing an architecture this product does not have |
| `--no-cors` | the §10.4 wall, modelled on a live playlist: the doctor fails it and says there is **no mp4 fallback for a stream** — for live, a missing header is not a fallback question, it is a blocker |
| the app suite | **851/851** after the reshape: five storage tests removed with the path they tested, one added that holds the live-only policy in place |

**Four things running it changed, which reading it had not.**

1. **A playlist is not a byte-ranged file.** The doctor's Range probe reported "the media url ignored
   Range" against a host behaving perfectly — `Range` on an `.m3u8` is meaningless (seeking inside HLS is
   the demuxer's job) and asking for two bytes of a few-hundred-byte text file proves nothing. A check
   that fails a correct host is worse than no check: it teaches an operator to ignore it.
2. **The CSP needs the live host by name, not by kind.** `activeHosts()` answers for the kind routing
   only, so with files on one host and live on another — the likeliest production shape —
   `mediaOrigins()` left the live origin unnamed and hls.js would be refused by `connect-src` with no
   error event at all. Found by running `VIDEO_DRIVER=catbox LIVE_DRIVER=apivideo` and reading the
   header, not by reading the function. There is now a test that names that exact shape.
3. **A stub that is missing a route hides a broken check.** The credential probe passed while the
   account check 404'd, because the stub had no `GET /videos`. The double has to fail the way the
   provider would, or it is only agreeing with us.
4. **A per-kind host can be made unreachable by declaring nothing.** `capabilities.kinds` is both the
   routing table and the policy: emptying it removed the upload path from the router, the doctor, the
   stubs and the tests in one edit, and no configuration is left that can bypass it. That is harder to
   undo by accident than an `if (driver === 'apivideo')` in four places, and it is the same mechanism
   that keeps audio away from an image host.

### 11.5 What only the user's machine can settle

Four questions, in the order they matter. None can be answered from this sandbox: it has no egress to
`ws.api.video` or its CDN, and the request is refused before TLS, like every other host here.

1. **Is the key sandbox or production?** A key belongs to one environment and answers 401 against the
   other. If it is sandbox, this deployment is a demo: video is cropped to 30 seconds, **live is stopped
   at 30 minutes**, everything is watermarked and deleted within a day. The doctor prints the base and the
   rate-limit headers (the two environments answer with different numbers) and refuses a sandbox key for a
   store in as many words.
   ```
   npm run video:check --prefix app -- --driver=apivideo
   ```
2. **Is the live playlist CORS-readable from a viewer's browser?** hls.js fetches an `.m3u8` with XHR
   under `connect-src`, and a CDN that omits `Access-Control-Allow-Origin` gives a black rectangle with no
   error event at all (§10.4). **For a live stream there is no progressive fallback** — that decision went
   with the storage path — so if their CDN does not send the header, the playlist and its segments have to
   come from our own origin, which for live is a bandwidth decision rather than a config change.
   `--probe-live` reads the header whenever a stream is up.
3. **Do the sandbox's live limits behave as documented?** Their API reference says 30 seconds for "videos
   and live streams"; their live best-practices page says a 30-minute stop with a 30-second recording cut.
   Push for two minutes and see which is true for your key — it decides whether a sandbox can demo a real
   broadcast at all.
   ```
   ffmpeg -re -f lavfi -i testsrc=size=640x360:rate=30 -f lavfi -i sine=frequency=440 \
     -c:v libx264 -preset veryfast -t 120 -f flv rtmp://broadcast.api.video/s/<streamKey>
   ```
   while watching `https://live.api.video/<liveStreamId>.m3u8` play in our own player.
4. **Does a stream leave anything stored?** Their live best-practices page says live streams are recorded
   automatically; our create call asks for `record: false`. After one test broadcast, read the dashboard's
   usage page: if hosting minutes moved, the recording happens regardless and the §11.1 hosting meter
   applies to every stream — better learned now than on an invoice.

The doctor answers questions 1 and 2 on a machine that can reach them; question 3 needs `ffmpeg` and the
one-liner above; question 4 needs the dashboard's usage page and one broadcast.

### 11.6 Who pays, and what has to be true before a seller can go live

**Nothing in this product moves money.** There is no in-app payment for any of this, by an earlier decision
that still stands, and api.video does not need one: **they bill the account holder directly**, monthly, by
usage — the same way they would bill any other developer. The app holds a key; the account holds the bill.

**An account with no payment method is on the sandbox, and the sandbox cannot run a store.** That is not a
nuisance setting — it is the state of an account before anyone has decided to spend money on it, and it is
worth being concrete about what it means here:

| | sandbox (no payment method) | production (payment method on the account) |
| --- | --- | --- |
| live duration | **stopped at 30 minutes** (their API reference says 30 seconds — measure it, §11.5 Q3) | as long as you want, and as many at once as you have cameras for |
| recording | cut at 30 seconds | kept, in 24-hour chunks, and billed as hosting |
| watermark | unremovable | none |
| content lifetime | **deleted after 24 hours** | until deleted |
| cost | free | delivery ≈ $0.0017/min watched · hosting ≈ $0.00285/min stored per month |
| good for | building the panel, demoing a broadcast end to end, testing CORS and the player | a seller's actual audience |

Two consequences worth stating plainly:

* **The next round can be built and demoed for free.** A sandbox key mints real streams, our own player
  plays the playlist, and the whole panel flow — mint, show the ingest address, go live, stop — works
  against it. What a sandbox cannot show is a long broadcast or one without a watermark, which is exactly
  the difference between a demo and a store.
* **The sandbox is not a permanent free tier either.** Their Free Trial Plan terms cap it at *twelve
  monthly periods per legal entity*. So it is a place to build and test, and the upgrade is a step that
  will arrive on its own.

**So the honest cost picture for Nepal-first, if the account is upgraded:** the meter is viewers, and it
scales with them. A quiet stream is nearly free — a 1-hour event with 10 people watching is about
$1.00; 50 people is about $5.10; 100 is about $10.20; 500 is about $51. Nothing is stored, so there is no
monthly meter running between events, and a stream nobody watches delivers nothing and costs nothing.
That is the whole argument for buying only the ingest from this host: our storage is already paid for, and
the one thing it sells that we cannot make ourselves is billed by use, not by the month.

**The checklist before a seller broadcasts for real** — the first item is the only one that is not code:

1. **a payment method on the api.video account** (their dashboard → billing), then a **production key**;
2. `APIVIDEO_API_KEY` from that environment, with `APIVIDEO_BASE=https://ws.api.video`;
3. `LIVE_DRIVER=apivideo` set on the deployment, which the boot banner acknowledges;
4. the CORS question settled in a real browser (§11.5 Q2), because for live there is no fallback;
5. the seller panel (next round) — mint, ingest address, live status, rotate the key.

Until item 1 exists, the right configuration on this deployment is the one it has: **`LIVE_DRIVER` unset**,
which changes nothing about how the product behaves today.

---

## 12. Ant Media Server: the live host that costs nothing, and is ours

§11 ended the live story at a meter: api.video runs the ingest for us, unbilled until it is watched, and
billed forever after. That is a fine trade for a company that has decided to spend money. It is not a trade
for someone who has none. So the same seam learned a second live host — and this one is **software**, not a
service: it is installed on a machine the seller owns, and after that nobody invoices per minute.

### 12.1 The two editions, and the one trap

Ant Media Server ships in two editions and the difference decides everything:

| | **Community Edition** | **Enterprise Edition** |
| --- | --- | --- |
| price | **free, forever** | per running server — ≈$0.09/h, ≈$69/mo annual, $1,999–2,799 perpetual |
| licence | Apache — source on GitHub, **commercial use allowed** | commercial licence, paid |
| limit | **none in the licence** — the limit is the machine and its bandwidth | none on viewers or broadcasters either |
| ingest | RTMP, SRT, WHIP | + VP8, H.265, CMAF, SRT extras |
| playback | **HLS** and DASH/CMAF — 8–12 s latency with the low-latency HLS extras | **WebRTC playback, ≈0.5 s** |
| rest | REST v2 API, web panel, recording to MP4/WebM/HLS, IP-camera, re-streaming | + adaptive bitrate, GPU encoding, clustering, publish/play token control, mobile SDKs, simulcast |

**The trap in the message that started this round.** The key that was pasted in (an `AMS…` string,
expiring 2026-10-10 — the value itself is deliberately NOT recorded here: a licence key in a git repository
is a key that has leaked, and this one is not ours to publish) is an **Enterprise trial**, and an Enterprise trial is *not* a free tier. Its own EULA
(§4.1.2) limits it to a single instance and says, in as many words, that it **"shall not use the Software for
any commercial purposes whatsoever or in any manner intended to benefit, aid, or assist a third party."** A
platform that runs other people's stores, for their audiences, is a third party being assisted. So the trial
is for evaluating the software on a test box and nothing else; deploying it here would be a licence
violation with a date on it. **Community Edition needs no key at all.**

If Enterprise features are ever genuinely needed, the honest paths are: pay for it, apply for one of the free
educational/community licences, or accept the 8–12 second HLS latency that Community already does well.
PeerTube (§3 of `LIVE_DISTRIBUTION.md`) is the other free-as-in-self-hosted option, and it is built on this
same idea.

### 12.2 What "free" costs instead

Community Edition removes the per-minute meter and replaces it with the ordinary costs of running software:
a server (the smallest VPS that can hold the connection), and **the upstream bandwidth of the broadcast**. A
2 Mbps stream is about 0.9 GB an hour; 100 viewers of it is about 90 GB an hour, which on most hosts is the
real bill. That is arithmetic rather than a vendor's cut, and it is knowable in advance — which is the
difference a person without margin actually cares about. The panel (`https://<host>:5443`) shows the live
streams, viewers per protocol, bitrate and recordings, so the number is legible.

**Latency is the honest concession.** Community playback is HLS, so 8–12 seconds behind the camera — a
chat that keeps up with the audio is impossible at that delay. For a product demo, a teaching stream, a
shop's weekly show, that is fine. For a call-in show it is not, and that is a real limit, stated here rather
than discovered live.

### 12.3 The seam did not change — a second live driver proved it

`LIVE_DRIVER` now names **which** live host runs a stream, exactly as `VIDEO_DRIVER` names which file host
holds bytes. Both live hosts sit in the same registry, both declare `kinds: []` (no file may route to a
stream engine), and `liveIngestEnabled()` answers for either. `video-check.mjs --probe-live` now asks
`liveDriver()` which provider to probe instead of assuming api.video, so the doctor follows the same seam the
product does. That the whole addition was one new module plus a table entry — not a rewrite of the live
path — is the evidence that the seam from §10.2 was drawn in the right place.

```js
LIVE_DRIVER=antmedia
ANT_MEDIA_BASE=https://stream.example.com:5443
ANT_MEDIA_APP=LiveApp
ANT_MEDIA_REST_SECRET=             # only if the panel's JWT filter is on
ANT_MEDIA_RTMP_BASE=rtmp://stream.example.com:1935/LiveApp
```

### 12.4 Authorisation, and the one thing that is a credential here

A fresh install authorises REST calls by **IP filter**: the requests must come from an address the panel
trusts. Turning on `settings.jwtControlEnabled` in the panel replaces that with a **JWT filter** — HS256,
signature verified, **payload ignored** — and our module signs one token per call from
`ANT_MEDIA_REST_SECRET`, so there is no token to refresh and no clock to keep. With no secret set, the module
sends no Authorization header at all rather than invent a credential the server never asked for. All three
failure shapes (wrong secret, filter on with no secret set, address not in the filter) arrive as the same
401/403, so the error message names all three instead of guessing.

**Two filters, not one — and the difference is the whole licensing story.** `jwtControlEnabled` guards the
**REST API** (what we call), and `jwtStreamControlEnabled` guards **the streams themselves** (what a viewer
plays). The first is a normal, recommended switch. The second is Enterprise play/publish-token control, and
Community Edition cannot issue those tokens — so a Community box with the stream filter on serves every
playlist as a 401, and the viewer sees a black rectangle. The doctor now reports that as a failure with the
switch named (`401 carries allow-origin: *` is exactly the case that an earlier header-only check would have
called a pass), and the double can reproduce it with `--jwt-streams`. Both switches are independent: the REST
filter on and the stream filter off is the correct Community configuration.

**Then there is the stream id.** Community Edition has no publish-token control, which means the
**streamId is the publish credential**: whoever knows it can push to that slot. Two consequences, and both
are built in:

* the id is **minted here** — `bb` plus 32 hex characters from `crypto.randomBytes(16)`, 128 bits — never a
  counter and never read back from a listing that anyone with API access could enumerate;
* recording on the broadcast is **off by default**, because a recording is disk, and a self-hosted server is
  the one machine where nobody else is going to clean it up.

Publishing is a plain RTMP push to `rtmp://<host>:1935/<app>/<streamId>` — what a seller pastes into OBS,
and what `ffmpeg` pushes from a laptop. Playback is `https://<host>:5443/<app>/streams/<streamId>.m3u8`,
fetched by our own player, so the live URL stays what it always was: a file with an `.m3u8` in
`external_url`, with the same player, the same breaks and the same unlock ladder.

### 12.5 What was verified here, and what only the user's machine can settle

Verified against a local double (`ci/stub-antmedia.mjs`, an HTTP server with the same shapes and the same
JWT filter): minting a stream, the returned `streamId` matching the one we asked for, the RTMP publish URL
and the HLS playlist URL derived from it, the server's own `status` flipping to `broadcasting`, per-protocol
viewer counts, delete-then-delete-again, the JWT path (wrong secret → 401, right secret → accepted), the
IP-filter path (no header sent), and the wrong-app 404 naming both the app we asked for and `ANT_MEDIA_APP`.
Five tests in `test/video.test.js` hold all of it.

What cannot be settled from here, in order of risk:

1. **SSL.** WebRTC and the panel insist on it; HLS playback over plain HTTP inside an HTTPS page is blocked
   by the browser. A certificate (Let's Encrypt, or the free `antmedia.cloud` subdomain) is part of the
   install, not an afterthought.
2. **CORS on the playlist**, in a real browser, for the same reason as §11.5 — hls.js fetches it with
   `fetch`, and the CSP has to name the origin (which `mediaOrigins()` already emits).
3. **A real broadcast**: `ffmpeg` from the user's laptop into `rtmp://…`, then the player in the panel.
   That is the proof no double can give.
4. **The bandwidth arithmetic above**, on whichever host they rent — measured, not estimated.

Until those hold, the honest configuration on any deployment here stays **`LIVE_DRIVER` unset**, which
changes nothing about how the product behaves today: a seller can still paste a playlist they got elsewhere.

---

## 13. Deleting a file, and not being blocked by a host

Two asks arrived together, and they are the same question from two sides: *a seller must be able to take
something down for real*, and *a third party's mood must not be able to stop the store working*.

### 13.1 "Delete" did not exist

Worth writing down plainly, because the gap was invisible from the outside: until this round the product
had **no way to delete a file at all**. A seller could pause one — take it off the storefront — and that was
everything. Every asset in the database was `live`. The seller who uploads the wrong cut, or a picture they
no longer have the right to show, had no way to take it back, and the platform's only answer was "hide it
from the list".

Pausing is not that answer, and the new status does not overload it:

| | paused | deleted |
| --- | --- | --- |
| storefront | gone | gone |
| someone who already unlocked | **still watches it** — an unlock buys the file, not the sale | **access voided**: the bytes are gone |
| the files | still there | destroyed, and their addresses removed |
| reversible | yes — flip it back | **no** |
| the row | kept | kept, as a tombstone: unlocks, reports, appeals and audits keep their subject |

Two mechanisms make "deleted" mean it rather than look like it:

* **the addresses go with the bytes.** `asset_files` rows are deleted, so both byte routes 404 because there
  is no file to look up — not because a page decided to hide a card. The live `external_url` is cleared, and
  a `cover_url` pointing at somebody else's origin is cleared too (a picture of a deleted file, still being
  served from a CDN, is the same leak one size smaller).
* **the state is checked at the byte boundary.** `closedToViewers` (in `moderation.js`, so it can be tested
  without booting the server) refuses `deleted` with **410 Gone**, refuses a file hidden by reports with 403,
  and refuses an unpublished one with 404 — for everyone except the owner and an operator. Before this,
  the byte routes checked the ENTITLEMENT and nothing else, which meant a moderator's take-down left the
  bytes flowing to anybody holding a token. Pausing is deliberately NOT in that list: making the reversible,
  everyday action cut off every buyer would teach sellers to reach for the irreversible one instead.

### 13.2 A host that cannot delete

Telegra.ph has no delete endpoint — no key, no account, no call. The old behaviour was to refuse the whole
delete, which is the worst of the two options available: the seller disowns the picture and we keep serving
it. What happens now:

1. every file is attempted — local keys unlinked from disk, remote keys deleted at their host;
2. a host that refuses (or cannot) leaves an **orphan**, recorded in the audit log with the host and the key,
   and named on the tombstone: *the copy at Telegra.ph still exists at its address; nothing here serves,
   lists or links it any more, and this delete could not unmake that URL*;
3. everything local is destroyed anyway, the asset becomes a tombstone, and the unlocks are voided.

The sentence is the point. A delete that claimed more than it did would be worse than the bug it fixes,
because the seller would stop worrying about a picture that is still up.

### 13.3 The two workarounds, one per host

The registry declares a **delivery** fact now, separate from what a host is for:

* **Pixeldrain** (`hotlink: 'refused-when-free'`) refuses what it reads as a hotlink — `hotlink_detected`,
  403 — and a 302 from a store's page is exactly that: a browser with the store's referer and no key. So its
  bytes are **relayed**: the request goes from our server, with our key, and the response is piped to the
  viewer with Range intact, status passed through, and nothing buffered in memory (a relay that buffered a
  video would be 300 MB of RAM per viewer). `MEDIA_RELAY=none` turns it off — right for a Pro account, since
  a relay is our upload rather than the host's connection.
* **Catbox** is a licence problem, not an HTTP one: their terms forbid being a service's CDN, and piping
  their bytes through us is still that. So it is **not relayed by default**, stays marked development-only,
  and the relay is not offered as a cure for a term.

And the other half, which is what makes a host failure survivable at all: **an upload that a host refuses at
the wire no longer fails the seller's upload.** The pre-check covered the refusals a host publishes (a size
cap, a kind it does not take); it could not cover an expired key, a free plan reading a datacenter upload as
abuse, or a host having an afternoon — those threw, and the seller got an error page while the file, which
was perfectly good, never landed. Now the host is still tried first, and a failure keeps the bytes on our own
disk with the reason in the log. The driver is still visibly broken to the operator, which is where that
belongs; the seller just gets a file that works.

**One thing the relay deliberately does not do: HLS.** A playlist names its own segments, so piping a
playlist through our origin without rewriting those names hands the player a list of urls it is still
expected to fetch from the host — the same CORS question, hidden one level down. Relaying HLS is a playlist
REWRITER, which is a real feature rather than a delivery flag; until it exists, the live path stays a
redirect, where §10.4's answer (name the origin in the policy) already works.

### 13.4 The edge relay: the same fix, on somebody else's connection

The relay in §13.3 has two costs that a store with no budget should not have to pay, and they are
worth separating because they are different problems with the same cure:

* **the bandwidth is ours.** Every byte of a Pixeldrain or Catbox file goes out through the
  operator's upload, which is the one resource a small deployment has least of;
* **every viewer arrives from ONE address — ours.** That is exactly the traffic shape a host's
  abuse detection exists to notice. Fifty people watching fifty files look like one server
  hammering a host, and the account at risk is the operator's.

So delivery has three tiers now, and the middle one moves both problems off this server:

| tier | who pays for the bytes | who the host sees | when it is used |
| --- | --- | --- | --- |
| **direct** | the host | the viewer | the default, and right for every host that serves browsers |
| **edge** | Cloudflare (no egress charge on Workers) | Cloudflare's edge, many addresses | `MEDIA_EDGE_BASE` + `MEDIA_EDGE_SECRET`, for Catbox and Pixeldrain |
| **ours** | the operator's upload | our one address | the fallback when no edge is configured |

`ci/cloudflare/media-relay-worker.js` is the Worker, `app/src/video-edge.js` is the seam, and
`ci/cloudflare/README.md` is the deployment steps. The interesting part is not the streaming —
that is forty lines of `Response` passthrough — but the fact that a public endpoint fetching other
people's files has to be **unusable by anyone who is not us**:

* every url is signed with an HMAC over `host/id/expiry`, verified on the Worker before a socket
  is opened, compared with `crypto.subtle.verify` so the comparison is the runtime's job and not a
  loop this code wrote;
* the signature covers the PATH, so a link for one file cannot be edited into a link for another —
  the difference between signing a url and handing out a key;
* it expires (`MEDIA_EDGE_TTL_SECONDS`, six hours by default), because a signed media url travels
  in a query string by necessity: a `<video>` element and a Range request cannot send an
  `Authorization` header. That is a property of every signed CDN url, and the reason the window is
  hours rather than forever;
* the host table is two names. "Relay everything that would have been relayed" is how a helper for
  two known problems becomes a general-purpose open proxy carrying our API key, so adding a third
  host is a code change somebody makes on purpose;
* a base url without a secret is treated as **not configured**, so the tempting half-setup — sign
  nothing, serve anyone — cannot happen by setting one variable.

**What it does not fix:** Catbox's terms. Their operator says no service may use Catbox as its
CDN, and fetching their bytes through a Worker and re-serving them is still that. The edge tier
fixes an HTTP problem and an expensive one; a term is a conversation with a person, not an
engineering problem. So Catbox stays marked development-only, its relay stays opt-in, and the
honest route to using it in production is asking.

**And what is not yet proven, said plainly:** no probe from this workspace can reach Cloudflare,
Pixeldrain or Catbox (`000` on every one), so the Worker has been tested against a local adapter
that runs the real Worker code on Node and against an upstream the tests start themselves — which
covers the signature, the streaming, the Range passthrough and the refusals. What it cannot cover
is Cloudflare's own behaviour: the 128 MB memory ceiling (the reason the body is passed through
rather than buffered), the edge network's IP rotation, and whether their edge is treated as a
hotlink by Pixeldrain. The first day of real use is the test for those three.

### 13.5 The 60-day clock, which is an open gap

Pixeldrain's documentation, on how long files are stored: **"Files will be removed if they have
not been accessed for 60 days. When a file is downloaded the expiry time is reset to 60 days from
the current day."**

That is a product risk and not a footnote, because of what this product does with a quiet file: a
store's back-catalogue is exactly the long tail that nobody opens for two months. A file at
Pixeldrain can therefore be deleted by the HOST while the page here goes on listing it, selling it
and asking a viewer to watch an ad for it — and the first symptom is a viewer who paid attention
and got nothing.

**Nothing sweeps for this yet.** Writing it down as a gap rather than a plan is deliberate: the
configuration here routes video to Filemoon, images to Telegra.ph and the general kinds to
Pixeldrain, so the exposure is audio, archives and documents, and the fix wants a decision the
product has not taken — either a keep-alive (a periodic authenticated `HEAD`/info call per file,
which their own API supports and which resets the clock) or a "last verified present" date on the
seller's own page so the risk is visible to the person who owns it. Catbox, for contrast, keeps
files permanently, which is a real reason the two hosts are not interchangeable.

### 13.6 What this does not fix

* **A public URL that was already fetched.** Telegra.ph's copy is still at its address for anyone who saved
  it. Nothing in this repository can change that; the tombstone says so in as many words.
* **Catbox's terms** (above), which no code change addresses.
* **Bandwidth.** A relay is our upload, and it is now in the delivery path for one host. That is a cost the
  operator should see coming rather than discover on a graph — which is why the doctor prints which mode is
  in force, and why `MEDIA_RELAY=none` exists.

### 13.7 When a host says no: the failover chain

§13.3 is about delivery — a host that will not serve a browser. This is about the other half:
a host that will not take the bytes, or refuses them later, in the middle of a launch.

**The refusals that were known, and what each one actually is.**

| | what happens | is it a bug? |
| --- | --- | --- |
| Pixeldrain, hotlink | 403 `hotlink_detected` on a browser fetch, free plan | no — it is their product decision; §13.3 relays around it |
| Pixeldrain, idle key | the API key expires 30 days after its last use | no — but it is the failure an operator meets on the morning of a launch |
| Pixeldrain, upload | the free plan refuses what it reads as abuse, and some formats | no |
| Catbox, terms | "not a service's CDN" — enforced by a person, not a status code | no, and no code fixes a term |
| Catbox, upload | size limits, blocked extensions, and a 200 that can carry an error | no |
| Telegra.ph | 5 MB, four image formats, no delete, no account | no — the host is what it is |
| any host | an outage | no |

**So the walk does not end at one host.** `uploadChainForKind` returns an ordered list, and
`storage.put` walks it: the first host that takes the bytes keeps them, each refusal is logged
with the host's own words, and the walk ends on our own disk — which always says yes. That last
step is not decoration: it is the reason a third party's bad afternoon has never been able to
stop a seller publishing.

`MEDIA_FALLBACK` is how an operator extends the chain:

```
unset                 → the kind's own driver, then our own disk      (today's behaviour)
all                   → every configured host that takes that kind, in registry order
pixeldrain,catbox     → exactly those, after the primary
```

Three rules, each of which is silent if broken: a host is tried **once** (a refusal costs one
call — never a retry loop against a service already saying no); a **live** host can never
appear (it stores no files, so it has no turn); and a host whose **own** rules would refuse this
file is never asked (`driverForKind` handles that first, so a 9 MB photo does not even reach
Telegra.ph's 5 MB cap). The doctor prints the whole chain per kind, because "where does this go
if the first one refuses" is the question an operator has.

**What this does not fix, said plainly:** it cannot make Catbox suitable for production (their
terms, not their uptime), and it cannot make a deleted file un-remembered by a host that issued
it a public URL (§13.2). What it does is make sure neither of those is the reason a seller's
publish fails.

### 13.8 The deploy that has not happened, and everything owed to it

The edge tier is built, tested against its own Worker code and **switched off**. Not by a flag
somebody forgot to flip: `app/.env` carries `MEDIA_EDGE_BASE` and `MEDIA_EDGE_SECRET` commented
out, so `deliveryOf()` answers `ours` for Catbox and Pixeldrain and the product behaves exactly as
it did before §13.4 existed. Nothing below is needed to run, publish or sell today.

It is written down here, in the file rather than in a conversation, because it is the kind of list
that gets lost: each item is a step somebody must take outside this repository, and the work does
not announce its own absence — a store with the relay off works, just from the operator's
bandwidth. The order is the order it has to be done in.

| # | owed | to whom | what it needs |
| --- | --- | --- | --- |
| 1 | `wrangler deploy ci/cloudflare/media-relay-worker.js --name bytebikri-media` | Cloudflare | an account, and `ci/cloudflare/README.md` §2 |
| 2 | `wrangler secret put MEDIA_EDGE_SECRET` | Cloudflare | the same value the app gets, and nothing weaker than a random 32 bytes |
| 3 | `wrangler secret put PIXELDRAIN_API_KEY` | Cloudflare | **optional** — only if the upstream needs the key on the relay's side |
| 4 | set `MEDIA_EDGE_BASE` + `MEDIA_EDGE_SECRET` in the app's environment | this app | the Worker's own url; a base without a secret is unconfigured on purpose |
| 5 | a Pixeldrain **Pro** key, and `MEDIA_RELAY=none` | Pixeldrain, and the operator | money, and a decision: with a paid key the host serves browsers itself and no relay is needed at all |
| 6 | the day-one checks on real Cloudflare | nobody yet | see below — they can only be run once item 1 is true |

**Item 6, spelled out, because it is the one that cannot be tested from here.** Every probe in this
workspace answers `000` for Cloudflare, Pixeldrain and Catbox. So three facts about the edge tier
are undocumented guesses that the first day of real traffic settles:

* whether Cloudflare's edge is seen by Pixeldrain as a hotlink (their protection is plan-tiered and
  activates on detected hotlinking) — if it is, item 5 stops being optional;
* the 128 MB memory ceiling under a real long stream, which is why the body is passed through as a
  stream and never buffered, and which no local test can reproduce;
* the free tier's 100,000 requests/day, which is a **request** ceiling and not a bandwidth one:
  Cloudflare does not bill egress on Workers, so the thing that runs out is the count of Range
  requests a long video makes — a number worth watching rather than estimating.

**Also owed, beyond the edge tier** — recorded here so one list holds them all:

* **the seller's live panel has no mint button.** `src/video-antmedia.js` can create a broadcast and
  return its RTMP url, and the panel renders the facts, but no seller can press anything that mints
  one, and no live stream has ever been pushed from a real encoder. The proof needs the user's own
  machine: `--upload`, `--probe-telegraph`, `--probe-live` are written for exactly that, and none of
  them can pass here.
* **the 60-day clock (§13.5) has no decision**, and therefore no code. Keep-alive or honest "last
  seen" date — either is fine, silence is not.
* **Catbox's terms are still a conversation** (§13.4), and no engineering step in this file changes
  that.
