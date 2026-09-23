# Deploying ByteBikri

Written to be followed top to bottom by one person on a laptop, in one sitting.
Every step either needs an account you have, or is a command.

The app is one Node process and one Postgres database. That is the whole
topology, and it should stay that way until there is a reason for more.

---

## 0. What you need before you start

| What | Where | Why |
|---|---|---|
| A domain | anywhere | `PUBLIC_BASE_URL`, and the address in every postback URL |
| Postgres | Supabase or Neon, free tier is enough to start | accounts, unlocks, consent |
| A host that runs a container | Render, Railway or Fly.io | the app itself |
| Three secrets | `npm run secrets` | session, download tokens, postback |

Storage of uploaded files is the one piece that is deliberately unfinished —
see [§5](#5-storage-read-this-before-you-deploy).

---

## 1. Generate the secrets

```bash
cd app
npm run secrets
```

Three lines come out. Put them in a password manager **before** pasting them
anywhere — the session secret is the only thing standing between a stolen
database and a set of usable logins, and rotating it signs everyone out.

In production these have no defaults. The app will not start without them, which
is deliberate: the failure mode of a fallback is a running server whose signing
key is in a public repository.

---

## 2. Database

Create a project, then copy two connection strings — most providers give you
both and they are not interchangeable:

- **The pooled string** (Supabase: port `6543`) goes in `DATABASE_URL`. The app
  opens a small pool per instance; without pooling, a few instances exhaust the
  connection limit.
- **The direct string** (port `5432`) is used only for migrations, which take an
  advisory lock and should not do so through a transaction pooler.

Then, from your machine, pointed at production:

```bash
DATABASE_URL="<direct string>" npm run db:migrate
```

This is a **release step, not a boot step.** The container does not migrate on
start: with more than one instance that is a race, and the loser gets a
half-applied schema. The migration runner takes an advisory lock, so running it
twice is harmless and running it from CI is fine.

Verify before deploying:

```bash
DATABASE_URL="<direct string>" node -e "
import('./src/db.js').then(async ({many,close})=>{
  console.log(await many('select count(*)::int as tables from information_schema.tables where table_schema=\$1',['public']));
  await close();})"
```

---

## 3. Environment

Every variable, and what happens if you skip it.

```bash
NODE_ENV=production                    # required. Turns on Secure cookies, HSTS, and the checks below.
PORT=3000                              # most hosts set this for you.
DATABASE_URL=postgres://…              # required. The pooled string.
PUBLIC_BASE_URL=https://your.domain    # required, https. Postback URLs are built from this.
SESSION_SECRET=…                       # required, 32+ chars.
ACCESS_TOKEN_SECRET=…                  # required, 32+ chars. Signs download links.
AD_POSTBACK_SECRET=…                   # rotate it even though the sandbox is off in production.
STORAGE_DRIVER=local                   # see §5.
LOG_LEVEL=info
SENTRY_DSN=                            # optional. Errors are logged either way.
```

Then check, without starting anything:

```bash
npm run check:env
```

It prints every problem at once and exits non-zero. The same check runs at boot
and refuses to open the port if production is misconfigured — an app that is
listening but cannot sign a session correctly is worse than one that never
started.

**What `NODE_ENV=production` changes**, since it is doing more than it looks:

- cookies become `Secure`, and HSTS is sent
- demo accounts are not seeded, and seeding refuses outright
- the sandbox ad network stops resolving — a connection pointing at it becomes
  unusable rather than becoming a way to mint free unlocks
- a missing or default secret is fatal instead of a warning

---

## 4. Deploy

### Render

`render.yaml` in this repository already describes the service. Point Render at
the repo, set the secrets in the dashboard, and **do not** use the
"pre-deploy" hook for migrations unless you have checked the direct connection
string is the one it uses.

### Anywhere else, with Docker

```bash
docker build -t bytebikri:latest app
docker run --rm -p 3000:3000 --env-file .env \
  -v bytebikri-data:/app/.data \
  bytebikri:latest
```

The image runs as a non-root user, and tini is PID 1 so SIGTERM reaches the
graceful-shutdown handler instead of being swallowed — without it, every deploy
drops in-flight requests.

### Health

- `GET /healthz` — the process is up. No database access.
- `GET /readyz` — the database answers. Returns 503 when it does not, so a
  platform takes the instance out of rotation instead of sending it traffic that
  will 500.

Point the platform's health check at `/readyz`. A check that only proves the
process is alive reports healthy while every request fails.

---

## 5. Storage — read this before you deploy

Uploaded files are written to the local filesystem by the `storage` adapter
(`app/src/store.js`). On nearly every container host, **the local filesystem is
discarded on every deploy.** Files vanish, and what is left is a database full
of unlocks pointing at missing content.

Two ways to be safe today:

1. **Mount a volume.** Docker: `-v bytebikri-data:/app/.data` (above). Render:
   add a disk at `/app/.data`. Fly: a volume in `fly.toml`. Works, and does not
   scale past one instance.
2. **Put a bucket behind the adapter.** This is the intended end state and the
   only one that survives a second instance. It is three methods:

   ```js
   storage.put(buffer, filename, { namespace })  // → key
   storage.get(key)                              // → Buffer
   storage.exists(key)                           // → boolean
   ```

   Keys are `<namespace>/<uuid>.<ext>`, where `namespace` is `private` for gated
   content and `public` for covers. `get` must validate the key against
   `/^[a-z]+\/[0-9a-f-]{36}\.[a-z0-9]{1,5}$/i` before it builds anything — that
   check is there because keys arrive from a URL, and a filesystem join on an
   unchecked key is how `../../` becomes a file read.

Everything above the adapter is unaware of where bytes live, which is the point
of the seam. Nothing else needs to change when the bucket arrives.

---

## 6. After the first deploy

- **Open `/legal/privacy`.** If it shows a yellow warning, the operator details
  are still unset and that page is not fit to be public. Fill `OPERATOR_LEGAL_NAME`,
  `OPERATOR_ADDRESS`, `OPERATOR_EMAIL`, `OPERATOR_DISTRICT` and redeploy.
- **Check `/readyz`** from outside the network.
- **Set up a backup.** The database is the business: accounts, unlocks, consent
  records. Supabase's daily backup on a free tier is enough to start, and you
  should restore one into a scratch project once before you need it.
- **Watch the logs for one real visit.** A 500 in the first hour is much cheaper
  than the same 500 discovered by a creator with a store.
- **Put the origin behind the edge, and keep it there.** Country rules read
  `CF-IPCountry`, and that header is only worth what the edge in front of it is:
  a request that reaches the origin directly can claim any country. Block direct
  access (Cloudflare Tunnel or an IP allowlist on the origin), and do not cache
  the pages the header changes — they are sent `no-store` for exactly that
  reason.

---

## 7. Not deployed yet, on purpose

Stated plainly so nobody assumes otherwise:

- **No real ad network is connected.** The registry knows how to verify four of
  them, and a store can connect one, but nothing renders a creative yet. Slots
  only appear once a store actually has a working connection, so an unconfigured
  storefront shows no empty boxes.
- **Address confirmation gates money in, and nothing else.** A seller whose address
  is unconfirmed signs in, publishes, unlocks and keeps their store exactly as it
  is; the one thing that waits is submitting a transfer reference for a plan
  upgrade or rent, because those are matched by hand and the receipt has to reach
  somebody. `/verify` explains it, the strip under the header carries it, and
  `/admin/users/<id>` lets an operator send the link on somebody's behalf.
- **No email sender yet, and this one now matters.** Password reset and address
  confirmation are both built and tested end to end: a person can ask for a link,
  open it, choose a new password, and the old sessions end; a new account gets a
  link that confirms the address it signed up with. `EMAIL_DRIVER=console` prints
  those links to the server log instead of sending them, which is right for a
  development machine and useless in production — so the server **refuses to
  start** with no driver, and refuses `console`, rather than looking healthy while
  every forgotten password becomes a lost account. Set `EMAIL_DRIVER=resend` with
  `RESEND_API_KEY`, or `smtp` with `SMTP_URL`, plus an `EMAIL_FROM` on a domain you
  control. Receipts are still
  printed, not sent.
- **No payment collection.** Store upgrades, annual rent, and the person's
  ByteBikri Plus month all exist in the data model with the same manual-verification
  path; no processor is wired up, because a Nepal entity cannot use the obvious
  ones.
- **No legal review.** The notices describe what the software does, accurately.
  Whether they satisfy a particular jurisdiction is a question for a lawyer.
