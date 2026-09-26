/**
 * Put the kind-walk's fixtures where the walk expects them: at the image host and the general host.
 *
 * ── WHY THIS IS CHECKED IN ───────────────────────────────────────────────────
 *
 * This was a scratch file in `/tmp` for exactly one round, and it was lost with the workspace —
 * which left `ci/eyes/kind-walk.mjs` unable to run and reporting five FAILs that were about a
 * missing fixture rather than about the product. The README of this folder already says the same
 * thing about the harness itself ("a verification tool that vanishes whenever the environment is
 * rebuilt stops verifying"); the fixtures are part of the tool.
 *
 * ── WHAT IT DOES ─────────────────────────────────────────────────────────────
 *
 * Signs in as a seller and POSTs to the ordinary publish form — the same route a person uses,
 * with the same fields — so what lands in the database is a file whose storage key names a host,
 * which is the only thing that makes a host-level check meaningful. Uploading "by hand" into the
 * table would produce a page that looks identical and proves nothing.
 *
 *   # with an instance whose drivers point at the stubs, and a fresh test database
 *   PORT=3100 … node app/scripts/boot.mjs &
 *   KIND_BASE=http://127.0.0.1:3100 node ci/eyes/kind-http.mjs
 *   rm -rf /tmp/eyes-kind && EYES_BASE=http://127.0.0.1:3100 node ci/eyes/kind-walk.mjs
 *
 * Idempotent: a title that already exists in the store is published under a `-2` slug by the
 * route itself, which would break the walk's fixed urls — so this DELETES its own previous
 * fixtures first (through the seller's own delete page, since that exists now) and reports what
 * it replaced. A helper that silently doubled its fixtures would make the walk fail for a reason
 * nobody could see.
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const BASE = process.env.KIND_BASE || process.argv[2] || 'http://127.0.0.1:3100';
const STORE = process.env.KIND_STORE || 'alice';
const EMAIL = process.env.KIND_EMAIL || 'alice@bytebikri.local';
const PASSWORD = process.env.KIND_PASSWORD || 'bytebikri-demo';

const here = fileURLToPath(new URL('.', import.meta.url));
const SEED = `${here}../../app/seed-assets/`;

/**
 * The two fixtures, and the kinds they must route by.
 *
 * The PNG is generated rather than committed: an 8×8 image is four lines of base64, and a binary
 * fixture in git for the same eight pixels is a worse trade than the four lines. The tone is the
 * demo's own `bell-tone.wav`, which is already there because the seed uses it.
 */
const FIXTURES = [
  {
    title: 'kind-proof-imagepng',
    filename: 'kind-proof-image.png',
    mimeType: 'image/png',
    body: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAIAQMAAAD+wSzIAAAABlBMVEX///+/v7+jQ3Y5AAAADklEQVQI12P4AIX8EAgALgAD/aNpbtEAAAAASUVORK5CYII=',
      'base64',
    ),
    fromDisk: null,
  },
  {
    title: 'kind-proof-tonewav',
    filename: 'kind-proof-tone.wav',
    mimeType: 'audio/wav',
    body: null,
    fromDisk: `${SEED}bell-tone.wav`,
  },
];

const fail = (m) => { console.error(`FAIL  ${m}`); process.exitCode = 1; };
const ok = (m) => console.log(`ok    ${m}`);

/** One cookie-carrying session, and the CSRF token the forms carry if any. */
const jar = new Map();
const cookieHeader = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
async function request(path, init = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    redirect: 'manual',
    headers: {
      ...(init.headers || {}),
      ...(jar.size ? { cookie: cookieHeader() } : {}),
    },
  });
  for (const raw of res.headers.getSetCookie?.() || []) {
    const [pair] = raw.split(';');
    const eq = pair.indexOf('=');
    if (eq > 0) jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
  }
  return res;
}

// ── sign in, the way the form does ──────────────────────────────────────────
const loginPage = await request('/login');
if (!loginPage.ok && loginPage.status !== 200) fail(`/login answered ${loginPage.status}`);
const loginHtml = await loginPage.text();
const token = /name="csrf"[^>]*value="([^"]+)"/.exec(loginHtml)?.[1]
  || /name="_csrf"[^>]*value="([^"]+)"/.exec(loginHtml)?.[1] || null;

const form = new URLSearchParams({ email: EMAIL, password: PASSWORD });
if (token) form.set('csrf', token);
const login = await request('/login', {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: form.toString(),
});
if (login.status !== 302) {
  fail(`sign-in answered ${login.status} — expected a redirect. Is the instance up, and the demo password still ${PASSWORD}?`);
} else {
  ok(`signed in as ${EMAIL}`);
}

// ── replace any earlier copy of each fixture ────────────────────────────────
//
// Through the DELETE PAGE, because that is the only way a file is removed now (and a helper that
// reached into the database would be a second implementation of deleting, which is the thing this
// round just finished removing).
const dashboard = await request(`/dashboard/${STORE}#files`);
const dashboardHtml = await dashboard.text();
for (const fixture of FIXTURES) {
  if (!dashboardHtml.includes(fixture.title)) continue;
  const row = new RegExp(`/dashboard/${STORE}/assets/([0-9a-f-]{36})`, 'g');
  // The list is rendered in order; find the row whose text contains the title, then the id in it.
  const rows = dashboardHtml.split('</tr>');
  const hit = rows.find((r) => r.includes(fixture.title));
  const id = hit ? [...hit.matchAll(row)][0]?.[1] : null;
  if (!id) { console.log(`       (could not find the row for ${fixture.title} to replace it)`); continue; }
  const del = await request(`/dashboard/${STORE}/assets/${id}/delete`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ confirm: 'delete' }).toString(),
  });
  ok(`replaced the previous ${fixture.title} (delete answered ${del.status})`);
}

// ── publish them ────────────────────────────────────────────────────────────
for (const fixture of FIXTURES) {
  let bytes = fixture.body;
  if (!bytes) {
    if (!existsSync(fixture.fromDisk)) {
      fail(`the fixture ${fixture.fromDisk} is missing — the walk cannot be set up`);
      continue;
    }
    bytes = readFileSync(fixture.fromDisk);
  }
  const body = new FormData();
  body.set('title', fixture.title);
  body.set('description', 'A fixture for ci/eyes/kind-walk.mjs — one file per kind, on the host that kind routes to.');
  body.set('unlockMode', 'open');
  body.set('media', new Blob([bytes], { type: fixture.mimeType }), fixture.filename);
  const published = await request(`/dashboard/${STORE}/assets`, { method: 'POST', body });
  const location = published.headers.get('location') || '';
  if (published.status !== 302 || /error=/.test(location)) {
    fail(`${fixture.title} was not published: ${published.status} ${location}`);
    continue;
  }
  ok(`published ${fixture.title} → ${location.split('=').pop()}`);
}

console.log('\nkind fixtures are in place. Now:');
console.log(`  rm -rf /tmp/eyes-kind && EYES_BASE=${BASE} node ci/eyes/kind-walk.mjs`);
if (process.exitCode) console.log('(with findings above — the walk will not prove what it should)');
