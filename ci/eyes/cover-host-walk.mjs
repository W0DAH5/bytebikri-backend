/**
 * A seller's banner now leaves the building, and the door it leaves through is not a back door.
 *
 *   node ci/eyes/cover-host-walk.mjs [outDir]
 *
 * WHY THIS WALK EXISTS. Covers and banners used to be the one thing we served ourselves — no token,
 * no redirect, straight off the disk, which is the point of a cover. The operator applied the
 * production rule to them ("none gets stored on our disk but all in media storages and stuffs i
 * provided already"), so a banner now routes through the same registry as a seller's video: it goes
 * to the image host, and `/media/<provider>/<id>` serves it back. Two things have to be true in a
 * real browser and neither can be asserted from a unit test:
 *
 *   1. the page still renders the banner — a cover that 404s is a store that looks broken, and this
 *      is a picture, so the only proof is pixels arriving on a storefront a stranger can open;
 *   2. the route that serves it does not hand out anything else. `/media/:provider/:file` looks like
 *      a small convenience and is one key away from being an unauthenticated door onto every paid
 *      video we have (`/media/filemoon/<id>`). The guard is that a key must be one a store
 *      ADVERTISES as its cover, and the last section here tries to use the route as that door on
 *      purpose, as a guest.
 *
 * Run against an instance whose `IMAGE_DRIVER` is set (telegraph), with the stubs up: the file it
 * uploads is a real PNG, and the host it lands on is `ci/stub-telegraph.mjs`.
 */
import { chromium } from 'playwright-core';
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { consent, sessionFor } from './lib.mjs';

const OUT = process.argv[2] || 'docs/evidence/round47';
const BASE = process.env.EYES_BASE || 'http://127.0.0.1:3100';
mkdirSync(OUT, { recursive: true });

const say = (n, s) => console.log(`\n[${n}] ${s}`);
const findings = [];
const check = (ok, what) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) findings.push(what);
};

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/tmp/chromium', args: ['--no-sandbox'],
});

// ── 1. the seller sets a banner, through the form a person uses ──────────────────────────────────
say(1, 'a seller sets a banner through the settings form');
const state = await sessionFor(browser, 'alice', { base: BASE });
const seller = await browser.newContext({ storageState: state, viewport: { width: 1400, height: 1000 } });
const page = await seller.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 160)); });
page.on('pageerror', (e) => errors.push(`PAGEERROR ${e.message.slice(0, 160)}`));

await page.goto(`${BASE}/dashboard/alice/settings`);
await consent(page);
/*
 * FAIL FAST ON A SESSION THAT IS NOT A SESSION.
 *
 * A re-used session file that has gone stale (or a sign-in the limiter refused) lands on the
 * sign-in page, and every locator below then waits thirty seconds for a field that will never
 * exist — which reads as "the form is missing" rather than "you are not signed in". This said so
 * once and cost one real diagnosis; it now says so every time.
 */
if (/\/login/.test(page.url())) {
  console.error('the session for alice is not valid — landed on', page.url());
  process.exit(2);
}

const choice = readdirSync('app/public/img/demo').find((f) => /\.(png|jpe?g)$/i.test(f));
const bannerFile = `app/public/img/demo/${choice}`;
const ext = choice.split('.').pop().toLowerCase();
const bytes = readFileSync(bannerFile);
console.log(`  the file      : ${bannerFile} (${bytes.length} bytes)`);
await page.setInputFiles('input[name=banner]', bannerFile);
await Promise.all([
  page.waitForNavigation({ timeout: 20_000 }).catch(() => {}),
  page.click('form[action$="/settings"] button[type=submit]'),
]);
await consent(page);
const after = await page.evaluate(() => ({
  url: location.pathname + location.search,
  error: document.querySelector('.note-danger, [role=alert]')?.innerText?.slice(0, 120) || null,
}));
console.log('  the page      :', JSON.stringify(after));
check(after.error === null, 'setting a banner reports no error');

// ── 2. the store now points at the host, and nothing of it is on our disk ────────────────────────
say(2, 'the store advertises the host key, and our own disk gained nothing');
/*
 * The app's own database module rather than a second connection of its own: `ci/` is not where the
 * dependencies live, and a walk that carries its own driver is a walk that can disagree with the app
 * about which database it is looking at. `DATABASE_URL` is read by the same code the server reads it
 * with, so the walk and the instance it is testing cannot point at different places.
 */
const { one, close } = await import('../../app/src/db.js');
const bannerUrl = (await one('select banner_url from channels where slug = $1', ['alice']))?.banner_url || '';
console.log('  banner_url    :', bannerUrl);
check(/^\/media\/telegraph\//.test(bannerUrl), 'the banner url is the image host’s key, not a local one');
const onDisk = readdirSync('app/.data/uploads/public').filter((f) => f.endsWith(`.${ext}`));
console.log(`  our disk      : ${onDisk.length} public file(s) — ${onDisk.slice(-3).join(', ') || 'none'}`);
const localKey = bannerUrl.replace('/media/', '');
check(!onDisk.some((f) => localKey.endsWith(f)), 'the banner we just uploaded is NOT one of them');

// ── 3. a stranger sees it: the url the page prints really serves the picture ─────────────────────
say(3, 'a stranger opening the store gets the picture, through our own url');
const guest = await browser.newContext();
const stranger = await guest.newPage();
const store = await stranger.goto(`${BASE}/s/alice`);
const shown = await stranger.evaluate(() => {
  const img = document.querySelector('.store-banner img, .banner img, img[src*="/media/"]');
  return img ? { src: img.getAttribute('src'), w: img.naturalWidth, h: img.naturalHeight } : null;
});
console.log('  the storefront:', store.status(), JSON.stringify(shown));
check(Boolean(shown?.src), 'the storefront renders a banner from /media');
const fetched = await guest.request.get(shown.src.startsWith('http') ? shown.src : `${BASE}${shown.src}`);
const body = await fetched.body();
console.log(`  the bytes     : ${fetched.status()} ${fetched.headers()['content-type']} ${body.length} bytes`);
check(fetched.status() === 200, 'the banner url answers 200 to a signed-out visitor');
check(String(fetched.headers()['content-type'] || '').startsWith('image/'), 'and with an image content type');
check(body.length > 1000, 'and with actual bytes, not an error page');
// The picture itself, because the assertion above can be satisfied by a HEAD-ish 200 and the whole
// question is whether a browser PAINTS it: the frame is the evidence, `naturalWidth` is the check.
await stranger.evaluate(() => document.querySelector('.store-banner, .banner, img[src*="/media/"]')
  ?.scrollIntoView({ block: 'center' }));
await stranger.screenshot({ path: `${OUT}/cover-01-hosted-banner.png` });
check(shown.w > 0 && shown.h > 0, `the browser decoded the image (${shown.w}×${shown.h})`);

// ── 4. and the same route refuses to be a door onto paid content ─────────────────────────────────
say(4, 'the cover route is not a way to fetch somebody’s paid video');
const videoKey = (await one(
  `select storage_key from asset_files where storage_key like 'filemoon/%' limit 1`,
))?.storage_key || null;
console.log('  a real key    :', videoKey);
if (videoKey) {
  const probe = await guest.request.get(`${BASE}/media/${videoKey}`);
  console.log(`  as /media/…   : ${probe.status()}`);
  check(probe.status() === 404, 'a paid video key is NOT served by the cover route');
  const viaPublic = await guest.request.get(`${BASE}/media/public/${videoKey}`);
  console.log(`  as a cover    : ${viaPublic.status()}`);
  check(viaPublic.status() === 404, 'nor by pretending it is a public cover');
} else {
  console.log('  (no filemoon key in this database — the door probe was skipped)');
}

await close();
console.log(`\nconsole errors: ${errors.length ? errors.join(' | ') : 'none'}`);
if (errors.length) findings.push(`console errors: ${errors.join(' | ')}`);
console.log(`\nwalk complete — ${findings.length} finding(s)`);
process.exit(findings.length ? 1 : 0);
