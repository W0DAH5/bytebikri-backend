# The edge relay — Catbox and Pixeldrain, delivered by Cloudflare instead of by us

Two of this product's hosts will not always hand their bytes to a browser, and both problems are
fixed — in the HTTP sense — by putting something in the middle:

| host | the problem | what the middle fixes |
| --- | --- | --- |
| **Pixeldrain** (free plan) | answers a direct browser fetch with `403 hotlink_detected`. A 302 from a store page is a hotlink with extra steps. | the request now comes from the account holder's side, with our key |
| **Catbox** | cannot serve browsers from a store at all; their terms forbid being a service's CDN | the request comes from the relay rather than from every viewer's browser |

There are two ways to be that middle, and this folder is the one that does not cost the operator
bandwidth.

| tier | who pays for the bytes | who the host sees | set up |
| --- | --- | --- | --- |
| **Direct** — a 302 to the host | the host | the viewer | nothing; the default |
| **Edge** — a 302 to `media-relay-worker.js` | **Cloudflare's free tier has no egress charge** | Cloudflare's edge, from many addresses | this page, ~5 minutes |
| **Ours** — piped through the app (`app/server.js`) | the operator's upload | **our one server address** | nothing; the fallback |

The relay inside the app works and is not being removed. It is simply the wrong shape for a store
with no budget: it pays for somebody else's file out of the operator's bandwidth, and it makes
every viewer arrive at the host from a single address — which is precisely the traffic pattern a
host's abuse detection is built to notice.

---

## 1. Deploy the Worker

```bash
npm install -g wrangler
wrangler login
wrangler deploy ci/cloudflare/media-relay-worker.js --name bytebikri-media
#   → https://bytebikri-media.<your-subdomain>.workers.dev

# the secret the application signs with and the Worker verifies with. Generate one:
openssl rand -hex 32
wrangler secret put MEDIA_EDGE_SECRET --name bytebikri-media

# only if Pixeldrain is in use. Without it, Pixeldrain's relay requests are anonymous and
# will hit their free-tier limits almost immediately.
wrangler secret put PIXELDRAIN_API_KEY --name bytebikri-media
```

The Worker's own environment also accepts `PIXELDRAIN_API_BASE` and `CATBOX_FILE_BASE` if a
deployment needs to point them somewhere else; the defaults are the real hosts.

## 2. Point the application at it

In `app/.env` (which is gitignored — the secret must never be committed):

```bash
MEDIA_EDGE_BASE=https://bytebikri-media.<your-subdomain>.workers.dev
MEDIA_EDGE_SECRET=<the same 64-hex secret>
MEDIA_RELAY=pixeldrain,catbox     # which hosts go through a relay at all
MEDIA_EDGE_TTL_SECONDS=21600      # optional; six hours is the default
```

Then check it from a machine that can reach both:

```bash
npm run video:check --prefix app -- --drivers
```

The delivery line says which tier each host is on, and prints the switch when one is missing:

```
  routing:
    video   → filemoon
    image   → telegraph
    audio   → pixeldrain
    file    → pixeldrain
       delivery: a signed redirect to the EDGE RELAY (https://bytebikri-media.….workers.dev) —
                 the Worker fetches with our key and streams the bytes, so this server pays
                 nothing and the host sees Cloudflare rather than our one address
```

## 3. What is actually being relied on

**Cloudflare Workers free tier:** 100,000 requests a day, and — the part that matters here — no
charge for egress. A viewer scrubbing a video makes several Range requests, so the request count
is not the same as the number of files served; a store doing more than 100k media requests a day
has outgrown the free tier and the paid one is $5/month for 10 million with still no egress
charge. **Flag this plainly: nothing here is metered per byte, but the request ceiling is real.**

**What is still unverified, and cannot be verified from this workspace:** this environment has no
outbound access to Cloudflare, Pixeldrain or Catbox (every probe returns `000`), so the Worker has
been proven against a local adapter that runs the *real Worker code* on Node
(`ci/stub-edge-relay.mjs`) and against an upstream the tests start themselves. What that does not
prove is Cloudflare's own behaviour: the 128 MB memory ceiling (the Worker streams for this
reason), the edge network's IP rotation, and whether a Worker's `fetch` to Pixeldrain is treated
as a hotlink or as a normal API call. **The first day of real use is the test for those three.**

## 4. The one problem this does not fix

**Catbox's terms.** Their operator says no service may use Catbox as its CDN, and fetching their
bytes through a Worker and re-serving them is still that. The edge tier fixes a technical problem
and an expensive one; it does not turn a term into a permission. Catbox therefore stays marked
**development-only** in the registry, `video:check` prints the caveat for it, and the honest path
to using it in production is **asking its operator** — not routing around the sentence.

The relay for Catbox also stays opt-in rather than on by default (`MEDIA_RELAY=catbox`), for the
same reason: a deployment that never configured Catbox never sends it a byte or a viewer.

## 5. Try it locally

```bash
# the media host stubs, then the edge relay running the real Worker code
node ci/stub-pixeldrain.mjs 4003 &
node ci/stub-catbox.mjs 4002 &
node ci/stub-edge-relay.mjs 4005 --secret=stub-edge-secret --key=stub-key \
  --pixeldrain-base=http://127.0.0.1:4003/api --catbox-base=http://127.0.0.1:4002

cd app
PORT=3100 DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55432/bytebikri_test \
  VIDEO_DRIVER=filemoon FILEMOON_API_BASE=http://127.0.0.1:3999 \
  FILEMOON_TOKEN='147|stub-token-abcdefghijklmnop' \
  FILE_DRIVER=pixeldrain PIXELDRAIN_API_BASE=http://127.0.0.1:4003/api PIXELDRAIN_API_KEY=stub-key \
  IMAGE_DRIVER=telegraph TELEGRAPH_UPLOAD_BASE=http://127.0.0.1:4004/upload \
  TELEGRAPH_FILE_BASE=http://127.0.0.1:4004 \
  MEDIA_RELAY=pixeldrain,catbox MEDIA_EDGE_BASE=http://127.0.0.1:4005 \
  MEDIA_EDGE_SECRET=stub-edge-secret \
  VIDEO_MEDIA_ORIGINS='http://127.0.0.1:3999 http://127.0.0.1:4005 http://127.0.0.1:4004' \
  node scripts/boot.mjs
```

A Pixeldrain file's stream route then answers **302 with `x-bytebikri-edge: pixeldrain`** — a
signed link to the Worker — instead of the 200 that means the bytes are coming through this
server. The browser fetch that plays it is the one the walk reads.

## 6. Rotating the secret

The secret is a signing key, not a password: nothing stores it and no session depends on it.
Changing it invalidates every url already handed out (viewers reload and get a fresh one) and
requires updating both sides:

```bash
openssl rand -hex 32
wrangler secret put MEDIA_EDGE_SECRET --name bytebikri-media   # then the same value in app/.env, and restart
```
