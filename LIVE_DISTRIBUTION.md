# LIVE_DISTRIBUTION.md — getting people to the stream

`VIDEO_STORAGE.md` answers *where the bytes live*. This is the other half of a live stream: **who finds
out about it**. The question that opened it — "what can Mastodon be used for live streams?" — has a short
answer and a longer one, and the longer one contains a genuinely useful alternative to paying api.video by
the viewer-minute.

**The short answer: Mastodon cannot stream and cannot play a live stream.** Not as a limitation of our
account — as a fact about the software. Its video is *uploaded files*: MP4/M4V/MOV/WebM up to a per-instance
size cap, transcoded to H.264 at 1300 kbps, **one video per post**, no HLS, no ingest. The feature request
for live streaming in Mastodon was opened in 2022 and **closed as "not planned"**.

What Mastodon *is* is an audience that federates: a post is delivered to followers on **any** compatible
instance, not just the one it was written on. For a live stream that means it is a **distribution channel**:
somewhere to announce, and somewhere a boost can carry an otherwise invisible store to people who have never
heard of it. Delivery stays with the host that runs the stream (§11).

## 1. The facts, and the trap in the word "streaming"

| | |
| --- | --- |
| live ingest (RTMP/SRT/WHIP) | **none** |
| live playback (HLS) | **none** — the player plays a finished file |
| video upload | MP4, M4V, MOV, WebM; **99 MB default cap** (`video_size_limit`, per instance); transcoded to H.264 ≤1300 kbps; **one video per post** |
| images | 4 per post, per-instance size cap (10 MB default) |
| post length | 500 characters default (`statuses.max_characters`) |
| rate limits | **300 requests / 5 min per account and per IP**; media uploads **30 / 30 min** (instance-configurable) |
| the "streaming API" | **timelines over WebSockets** — the *fediverse* meaning of "stream", not video. A naming trap worth writing down before somebody plans a feature around the wrong word |
| token lifetime | **does not expire**; only revocation or deletion ends it |
| limits are readable | `GET /api/v2/instance` → `configuration.media_attachments.video_size_limit`, `image_size_limit`, `statuses.max_characters` — **read them at runtime, never hardcode** |

That last row is the one to act on: an instance is somebody's server with their own caps, so the number
belongs to the instance, not to Mastodon.

**Registering the app is where the second trap lives.** Ours was registered with the out-of-band redirect
(`urn:ietf:wg:oauth:2.0:oob`), which Mastodon still supports — the authorization code is displayed and
pasted by hand. That is fine for **one** account whose owner is sitting at the keyboard, and impossible for
"every seller connects their account": that flow needs an **https redirect URI** added in the Mastodon
dashboard. Which shape we want is a product decision (§5), and it decides whether that registration has to
change.

## 2. What it is actually good for, for a live stream

Three moments, and each is one API call:

| moment | what we post | why it works |
| --- | --- | --- |
| **before** | "Going live at 7pm — <link>" | the post federates into followers' timelines **on other instances**; the link preview (card) carries the stream page's image, so it reads as an announcement rather than a bare url |
| **now** | "🔴 LIVE — <link>" with two or three hashtags | hashtags are how a stranger finds it; a boost puts it in front of a second audience that follows the booster, not us; the reply thread then becomes the chat that was never built |
| **after** | "The recording is up — <link>" | the same audience, one reason to come back; for a sandbox-era demo this is also honest about what was kept |

What it must **not** be used for: delivery (it cannot), viewer counts (it has none), gating (it has no
per-viewer authorization we control), ad breaks (nothing to hook — a pre-roll we cannot attach is not a
pre-roll), or storage of the stream itself (a 99 MB, one-per-post, 1300 kbps transcode is not a store's
catalogue).

## 3. The Fediverse's live platform is PeerTube, and it is a real alternative to api.video

Worth stating plainly because it is the useful half of the answer: if the goal is *live in the Fediverse*,
the software for that is **PeerTube**, not Mastodon — and it can be **followed from Mastodon**, which is how
the two fit together.

* **It runs the ingest**: RTMP (OBS, ffmpeg, Restream), HLS out, live chat, replays, and *permanent* lives
  where the url never changes.
* **It federates over ActivityPub**: a Mastodon account can follow a PeerTube channel and see new videos
  and lives in its timeline; replies from Mastodon federate back as comments on the video. A PeerTube
  instance is therefore its own distribution channel *and* its own host.
* **It is self-hosted** (AGPL-3.0, Docker, documented REST API) and shares delivery load peer-to-peer over
  WebRTC/WebTorrent, which is its answer to the bandwidth bill that kills small video sites. Admins set
  simultaneous-live limits.
* **It is maturing on live**: reviewers in 2026 still describe PeerTube live as working for small audiences
  and less reliable than dedicated streaming platforms.

So the honest trade, against §11's api.video decision:

| | api.video (bought ingest) | PeerTube (own ingest) |
| --- | --- | --- |
| who runs the encoder path | they do | we do — a server, ffmpeg, updates, an on-call story |
| cost shape | **per viewer-minute** (≈$1.70/1,000 delivered) + storage if recorded | our bandwidth, plus the server; the *audience* no longer sets the bill |
| where the bytes come from | their CDN | our server, partly peers |
| Nepal-first bandwidth | their CDN, paid by the meter | ours, unmetered-or-billed by a host |
| federation | none built in | ActivityPub, followable from Mastodon |
| effort to adopt here | **already done** (§11) | a new host, a new deploy, a new failure mode |

**The part that makes this cheap to keep open:** both put an HLS playlist in front of the same product code.
`external_url` holds an `.m3u8`, the player plays it, the breaks and the ladder are untouched — the
abstraction that let api.video arrive without a rewrite is the same one that would let PeerTube arrive the
same way. So this is a decision to *defer with a plan*, not an architecture to redo.

## 4. Credentials, and how they are held

Stored **server-side only**, in `app/.env` (gitignored, `chmod 600`):

```
MASTODON_BASE=https://mastodon.social
MASTODON_CLIENT_KEY=…
MASTODON_CLIENT_SECRET=…
MASTODON_ACCESS_TOKEN=…
```

Rules, all of them already the repository's rules for every other provider:

* never in client code, **never in a url** (a token in a query string ends up in somebody's logs), never in
  an audit payload — the audit records *the event*, not the credential;
* never printed by a check: `scripts/mastodon-check.mjs` prints the account and the instance's limits, and
  **the token never reaches stdout, stderr, or an error message**;
* **rotate after exposure.** These values arrived over chat, which means they exist in a transcript — and a
  Mastodon token does not expire on its own. The same dashboard page has a regenerate button; doing it
  costs one paste into `app/.env` and nothing else;
* for the platform-announcement shape, use a **dedicated ByteBikri account** rather than a personal one: the
  account is the voice, and a store platform posting as its founder's handle is a decision nobody should
  make by accident.

## 5. How it would fit this product — the seam, and the decision

Distribution is a second seam of exactly the kind the storage layer already has (`src/video.js`): providers
declared as data, one chosen per event, **nothing configured means nothing leaves**, every attempt audited,
and a failure at the provider never fails the seller's action. The events that matter are already in the
product: `asset.published`, `live.started`, `live.ended`.

**The decision that unlocks implementation — whose account announces?**

| | platform account (the token we hold) | per-seller accounts |
| --- | --- | --- |
| who the post comes from | ByteBikri | the store itself, to its own followers |
| onboarding | none — one token | a connect flow, a token per seller, encrypt at rest, revoke on disconnect |
| app registration | works as registered (out-of-band is fine for one account) | needs an **https redirect URI** added |
| reach | our followers; stores get no follower of their own | the store's followers, which is the point of a storefront |
| risk | one credential with post-as-us power | many credentials; needs scoping, revocation and a "disconnect" that really disconnects |

There is also a smaller decision underneath it: **what we announce**. Live starts are the natural fit for
this round. New assets and recordings are the same call and can follow, at the cost of more posts from the
same handle — 300 requests/5 min is not the constraint; a follower's patience is.

## 6. Open questions

1. **Platform account, or per-seller accounts?** (§5.) This one decides whether the next step is a small
   announcement service or a full connect-and-revoke story.
2. **Is the Fediverse a real audience for a Nepal-first store**, or a values-aligned one? Mastodon's reach in
   Nepal is small next to Facebook and TikTok; the honest case for posting there is that the audience that
   *is* there is reachable for free, with no algorithm between the post and the person. Worth deciding with
   open eyes rather than by enthusiasm.
3. **Announce live only, or assets too?**
4. **PeerTube: a curiosity, or the escape hatch from per-viewer pricing?** It is the only path here that
   makes a stream cost the same whether ten people watch or ten thousand — and the only one that needs an
   ops commitment this project does not currently have.

**Verify the credential from a machine that can reach mastodon.social** (this sandbox cannot — the request
is refused before TLS, like every other host here):

```
npm run mastodon:check --prefix app                 # who the token is, and the instance's real caps
npm run mastodon:check --prefix app -- --dry-run     # exactly what an announcement would say; posts nothing
```
