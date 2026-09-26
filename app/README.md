# ByteBikri app

Storefronts, ad-gated unlocks, members, and the platform's own charges — on **PostgreSQL**.

```bash
npm install
npm run db:start     # real Postgres 18, local data dir (leave running)
npm run db:migrate   # apply db/migrations
npm start            # → http://localhost:3000, seeding a fresh database on first boot
npm test             # 601 tests; recreates a separate test database first
```

`db:start` runs a real server, not an emulator. It needs no credentials and no
external services; `db:reset` drops and recreates, handy when experimenting.

**Production:** point `DATABASE_URL` at any Postgres (Supabase is fine) and run
`npm run db:migrate`. Nothing else changes. See `../DEPLOY.md`.

## Try it

The demo database has three stores and real sign-in. Boot the app, then:

```bash
node ../ci/demo-state.mjs     # from app/, puts the interesting states in place
```

| | |
|---|---|
| Storefront | `/s/alice` (Store plan), `/s/nima-crafts` (memberships), `/s/bob` (Free) |
| File pages | `/s/alice/a/devanagari-poster-kit` (ad-gated), `…/poster-kit-walkthrough` |
| Dashboard | `/dashboard/alice` — sign in as `alice@bytebikri.local` / `bytebikri-demo` |
| The person's premium | `/plus` — `alice` is wearing one, `carol` has a claim waiting |
| Operator console | `/admin` — `operator@bytebikri.local` / `bytebikri-demo` |
| Health / readiness | `/health`, `/readyz` |

### Two databases, and one of them belongs to the tests

`DATABASE_URL` decides which database all of this touches, and `npm run
db:reset && npm run db:migrate && npm start` gets a clean one from nothing. Keep the two apart,
because this cost a whole round of "the demo has lost everything":

| variable | who uses it | what happens to it |
| --- | --- | --- |
| `bytebikri` (the default) | `npm start`, `ci/dev-up.sh`, the demo | seeded once, then filled by `ci/demo-state.mjs`; nothing else touches it |
| `bytebikri_test` | `npm test` (`scripts/test-db.mjs` drops and refills it) | **destroyed and refilled on every test run** |

Pointing a preview at `bytebikri_test` means every `npm test` silently wipes the demo you are about to
show somebody — the stores are still there and the sign-in is gone, which reads as lost work rather
than as a dropped database. After a test run, nothing needs re-seeding; just restart the instance.

**The operator account is not a demo-only idea.** `/admin` answers 404 to anybody whose
`profiles.role` is not `'admin'`, and until this round nothing in the product could set that column —
so a deployment had a console nobody could open, and the demo lost a third of its states (the
verification records, the plan payments and the approvals are all made *as* an operator). The seeder
now creates `operator@bytebikri.local` on a fresh development database, and a real deployment does it
the other way round: the person **signs up first** (that is what sets their password), then gets
promoted from the machine that holds the database.

```bash
npm run operator -- ops@example.com             # promote to admin
npm run operator -- ops@example.com --moderator # or moderator, which is not the console
npm run operator -- ops@example.com --demote    # back to an ordinary account
npm run operator -- --list                      # who is an operator now
```

Deliberately not an HTTP route: there is nothing to secure beyond the database credentials, which the
person running it already has. Every change is audited as `operator.role_changed` with the actor.

## How this file's history reads

Everything below the line was written while the app was a prototype: it had no
session store, no money model and no operator, and the sections that follow record
the defects found in that shape — `?as=<email>` identity switching (replaced by real
sign-in, sessions and `resolveSession`), two demo channels (now three stores with
plans, members and a Plus subscriber), and 41 tests (now **601**, plus the browser
harness in `../ci/eyes/`).

They are kept because the reasoning is the useful part and it has aged well: a
shared `guest` user that made one visitor's unlock visible to another, a
verification scheme no real provider uses, an unlock that could be declared
complete by the browser. Each was fixed, and each fix is narrated where it
happened rather than tidied away. Read it as a record, not as a description of the
current build.

## Provider adapters — `src/providers/`

**There is no universal postback scheme.** My first build verified HMAC-SHA256
over the JSON body in headers, which is what our own simulated network does and
what **no real provider does**:

| Provider | Method | Signature |
|---|---|---|
| BitLabs | GET | hex HMAC-SHA1 over the **raw URL**, appended as `&hash=` |
| PubScale | GET | hex MD5 of `secret.user_id.value.token`, `value` truncated to an int |
| AppLixir | GET | MD5 of a shared secret — **template unconfirmed, fails closed** |
| House (ours) | POST | HMAC-SHA256 over the body, in headers |

An adapter's whole job is to turn one of those into a single normalized event:

```
complete | pending | reconciled | screenout | ban | unknown
```

Only `complete` grants. `unknown` never does — defaulting to a grant on vocabulary
we have never seen would pay out on whatever a network invents next quarter.

Three details that are easy to get wrong, and are pinned by tests:

- **BitLabs hashes the URL as sent.** Their docs: *"Do not encode/decode the URL
  before generating the hash."* We hash `req.originalUrl` verbatim. Rebuilding the
  query from `req.query` reorders and re-encodes parameters and would fail every
  postback. This is also why the route accepts **GET**, not just POST.
- **A duplicate postback must answer 2xx.** PubScale retries 6 times on non-2xx,
  so answering 409 to a retry produces six more retries and an eventual failure.
- **Unrecognised state never grants.** BitLabs only sends `offer_state` if you ask
  for it; without it we cannot tell a final conversion from a pending one, so we
  refuse rather than guess.

`npm test` runs 20 tests, including **BitLabs' own published digest vector** — a
real app secret and the hash it must produce. If verification regresses, that test
fails rather than content silently unlocking.

### Why the URL identifies the connection

`/api/ads/postback/:providerId/:connectionId`

Two channels can both use BitLabs with two different app secrets. A provider-only
URL would have to try every secret until one verified, which turns our own endpoint
into a signature oracle.

## The one design rule everything depends on

**An unlock is granted only on a signed server-to-server postback.** The browser
may only *start* an unlock; it can never declare one complete.

A browser callback is trivially forged. A forged one means free content **and** a
revenue claim the network rejects — against the channel's own ad account. So our
bug would cost the channel their ad money. `src/unlocks.js` and `src/providers/`
are therefore the load-bearing files here.

Two things the postback handler deliberately does **not** do:

- **It does not take the user id from the payload.** Identity comes from the pending
  view *we* created; the network's echoed id is only cross-checked against it.
  Otherwise anyone who learned a signing secret could unlock content for an
  arbitrary account, and the network would be the authority on our user identity.
- **It does not let a view be released by a different connection's signature.**
  A signed postback from channel A claiming channel B's view is refused.

The ad network also never learns who the user is. It receives a random UUID4
(`store.adRefFor`) that resolves to a user only inside our database.

## What is verified by running it

| Test | Result |
|---|---|
| Unlock loop, POST dialect | lock → watch → signed postback → download |
| Unlock loop, **GET dialect** | same, over HMAC-SHA1-signed URL |
| **Forged postback** (right shape, wrong secret) | `401 hash mismatch` |
| Tampered / unsigned GET | `401` |
| **Duplicate tx** (provider retry) | `200`, `duplicate:true`, counters unchanged |
| Postback 10 min old | `401 timestamp outside allowed window` |
| Cross-connection signed postback | `409 no matching view`, target stays locked |
| Wrong provider on a valid connection | `404` |
| No identity (`?as=` absent) | `401`, never borrows a user |
| No token / forged token | `403` on content |
| No unlock | **zero** content links in the page |
| Rent slot | the next rank below the store's own — never rank 1, one per page |
| Free-plan channel | 2 positions: the store's at rank 1, ours at rank 2 |
| Paid channel | 3 positions: the store's at ranks 1-2, ours at rank 3 (three is the ceiling) |
| Channel with no position of its own | not taxed — `.length = 0`, no platform position either |
| Disconnected channel | slots `reserved_empty`, height held (no reflow) |

## Layout

```
server.js              routes, postback endpoint, demo seed
src/providers/         per-network postback verification
  index.js               registry, normalize, advisories, selfTest
  crypto.js              safeEqual/hmac/md5 — no imports from index.js
  bitlabs.js             GET + HMAC-SHA1 over the raw URL
  pubscale.js            GET + MD5 of secret.user_id.int(value).token
  applixir.js            GET + MD5 — FAILS CLOSED until confirmed
  house.js               our sandbox network
src/registry.js        provider registry + Nepal payout verdict
src/slots.js           allocation policy — we own WHERE, the channel owns WHAT
src/unlocks.js         unlock engine, identity, idempotency, access tokens
src/store.js           in-memory store + plans + the storage adapter
src/views.js           server-rendered storefront, asset page, dashboard
test/adapters.test.js  20 tests
```

`src/registry.js` and `src/providers/` both key off a provider id but answer
different questions — *"can a Nepali creator withdraw this network's money?"* versus
*"how do I verify this network's postback?"* — so they are separate files that
change for unrelated reasons.

## Stubbed, and where the seam is

| Stubbed | Seam |
|---|---|
| File storage | `storage` in `src/store.js` — local disk now; three methods to implement |
| Ad provider | `house` simulates one. Real ones implement the postback contract |
| Callback secrets | Literal on the connection. Production: a secrets manager |
| Auth | `?as=<email>`. Real auth is the next phase |
| Callback secrets | Literal on the connection. Production: a secrets manager (see 0005) |
| Plan payment | `planPayments` records a reference for manual verification; no integration, by design |

Nothing above `src/store.js` knows where bytes live, so the media API swaps in
without touching the rest.

## Persistence

The store was in-memory for the first three builds: everything vanished on
restart, so no real creator could use it. It is now PostgreSQL, and the
in-memory version was **deleted rather than kept as a test double** — two
implementations behind one interface drift, and the tests would have run against
the copy production never executes.

The port found things nothing else could, because a database enforces rules an
object map cannot:

| What | Why it mattered |
|---|---|
| `pending_views` did not exist | Every unlock mints one. Nothing would have worked |
| `ad_view_events` was unique on `(provider_id, external_id)` | Routing is connection-scoped; two channels on one network could collide and one's completed view would be swallowed |
| `ON CONFLICT (email)` had no unique index | The app could not create its first user |
| `assets.price_npr` existed | Left over from the purchase model — a price with no payment path invites its return |
| `ad_connections` had no `callback_secret` | Nothing could verify a postback |

`npm test` now includes `schema.test.js`, which asserts every `ON CONFLICT` in
the store has a matching unique index — so that class of failure is caught by a
test rather than by the app refusing to boot.

## Concurrency

`test/concurrency.test.js` runs against real Postgres, because the bugs it covers
cannot occur in a single-threaded object map.

The duplicate check used to be `if (adViews().some(...)) return duplicate`
followed by an insert — **check-then-act**. Two deliveries of the same postback
both pass the check, because neither has written yet, and both grant. A provider
retry *is* two deliveries of the same postback, and providers retry by design.

Claiming is now an insert the unique index referees:

```sql
insert into ad_view_events (...) values (...)
on conflict (connection_id, external_id) do nothing
returning *
```

No row returned means somebody else owns it. Ten simultaneous claims, exactly one
wins. The same reasoning applies to `grantUnlock`
(`ads_completed = unlocks.ads_completed + excluded.ads_completed`, not `+=` in JS)
and to page views (`views = page_views_daily.views + 1`).

## Deliberately absent

No coin system, no order flow, and **no payment between buyer and seller** — content
has no price. A buyer unlocks with attention, the ad network pays the channel's own
account directly, and ByteBikri is not in that path. The only money that reaches
ByteBikri is its own: plan subscriptions and rent.
