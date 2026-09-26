/*
 * The go-live slice, photographed — the pictures that go with `live-mint-walk.mjs`.
 *
 * The walk says whether the behaviour is right; this says what it looks like, because "it works" and
 * "a seller can see what is happening" are two different claims and only one of them is provable in a
 * terminal. It walks the same path as the walk (mint → nobody sending → someone watching → rotate →
 * end) and stops at each step for a frame, saving into `docs/evidence/round45/`.
 *
 *   NODE_EXTRA_CA_CERTS=/tmp/ams/ams.crt \
 *   LD_LIBRARY_PATH=/tmp/eyes/al2023/lib \
 *   EYES_BASE=http://127.0.0.1:3200 EYES_PLAIN_BASE=http://127.0.0.1:3100 \
 *   node ci/eyes/live-shots.mjs
 *
 * Everything runs against the live instance (:3200), which reaches the streaming server over TLS with
 * the certificate from the `--tls` stub; `ignoreHTTPSErrors` here is that same self-signed certificate,
 * exactly what an operator clicks past once on a fresh Ant Media install.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { sessionFor, consent } from './lib.mjs';

const BASE = String(process.env.EYES_BASE || 'http://127.0.0.1:3200').replace(/\/+$/, '');
const PLAIN = String(process.env.EYES_PLAIN_BASE || 'http://127.0.0.1:3100').replace(/\/+$/, '');
const OUT = process.env.EYES_OUT || 'docs/evidence/round45';
const STORE = 'alice';
const CONTEXT_OPTS = { ignoreHTTPSErrors: true };

mkdirSync(OUT, { recursive: true });

/*
 * `scroll-behavior: smooth` makes a shot taken right after a redirect a torn composite — the browser
 * is still animating toward a fragment. Turn the animation off before every frame (see the longer note
 * in `publish-walk.mjs`; this line is the same fix for the same reason).
 */
const shot = async (p, name) => {
  await p.evaluate(() => {
    document.documentElement.style.scrollBehavior = 'auto';
  }).catch(() => {});
  await p.waitForTimeout(250);
  await p.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
  console.log(`  ${OUT}/${name}.png`);
};

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/tmp/chromium',
  args: ['--no-sandbox'],
});

try {
  const state = await sessionFor(browser, 'alice', { base: BASE, dir: '/tmp/eyes-shots' });
  const context = await browser.newContext({ storageState: state, ...CONTEXT_OPTS, viewport: { width: 1440, height: 980 } });
  const page = await context.newPage();

  const stamp = new Date().toISOString().slice(11, 19).replace(/:/g, '');
  const TITLE = `Live walk ${stamp}`;

  // 1. The way in: the dashboard offers it and names the machine an encoder would speak to.
  await page.goto(`${BASE}/dashboard/${STORE}`, { waitUntil: 'domcontentloaded' });
  await consent(page);
  await page.click('details summary:has-text("Start a live stream")');
  await page.evaluate(() => document.querySelector('#l-title')?.scrollIntoView({ block: 'center' }));
  await shot(page, '01-dashboard-go-live');

  // 2. A minted stream: the key, the address, and "nobody is sending yet" — asked of the server.
  await page.fill('#l-title', TITLE);
  await page.selectOption('#l-mode', 'open');
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 60_000 }),
    page.click('button[name="source"][value="mint"]'),
  ]);
  const assetPath = new URL(page.url()).pathname;
  await page.evaluate(() => document.querySelector('h2')?.scrollIntoView({ block: 'start' }));
  const panel = page.locator('.panel', { hasText: 'Your encoder' }).first();
  await panel.scrollIntoViewIfNeeded();
  await shot(page, '02-encoder-panel-waiting');

  // 3. A viewer watches. The playlist request is what the server counts, so this is the step that
  //    turns the seller's panel from "nobody is sending" into "your encoder is connected".
  const slug = `live-walk-${stamp}`;
  const viewerState = await sessionFor(browser, 'bob', { base: BASE, dir: '/tmp/eyes-shots' });
  const viewerContext = await browser.newContext({ storageState: viewerState, ...CONTEXT_OPTS, viewport: { width: 1440, height: 980 } });
  const viewer = await viewerContext.newPage();
  await viewer.goto(`${BASE}/s/${STORE}/a/${slug}`, { waitUntil: 'domcontentloaded' });
  const live = viewer.locator('[data-live]').first();
  await live.scrollIntoViewIfNeeded();
  await viewer.evaluate(async () => {
    const url = document.querySelector('[data-live]')?.getAttribute('data-url');
    if (url) await fetch(url, { credentials: 'omit' }).catch(() => {});
  });
  await shot(viewer, '03-viewer-live-player');

  // 4. Back on the seller's page, the same fact from the other side.
  await page.goto(`${BASE}${assetPath}`, { waitUntil: 'domcontentloaded' });
  await page.locator('.panel', { hasText: 'Your encoder' }).first().scrollIntoViewIfNeeded();
  await shot(page, '04-encoder-panel-connected');

  // 5. Rotated: a different key, and the old broadcast really gone from the server.
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => {}),
    page.click('form[action$="/live"] button:has-text("Rotate the key")'),
  ]);
  await page.locator('.panel', { hasText: 'Your encoder' }).first().scrollIntoViewIfNeeded();
  await shot(page, '05-after-rotate');

  // 6. Ended: off the server, off the storefront, and the address kept as the record of where it was.
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => {}),
    page.click('form[action$="/live"] button:has-text("End the stream on the server")'),
  ]);
  await page.locator('.panel', { hasText: 'Your encoder' }).first().scrollIntoViewIfNeeded();
  await shot(page, '06-after-end-address-kept');

  // 7. The refusal: an instance with no streaming server offers no button that could work.
  const plainState = await sessionFor(browser, 'alice', { base: PLAIN, dir: '/tmp/eyes-shots' });
  const plainContext = await browser.newContext({ storageState: plainState, viewport: { width: 1440, height: 980 } });
  const plain = await plainContext.newPage();
  await plain.goto(`${PLAIN}/dashboard/${STORE}`, { waitUntil: 'domcontentloaded' });
  await plain.click('details summary:has-text("Start a live stream")').catch(() => {});
  await plain.evaluate(() => document.querySelector('#l-url')?.scrollIntoView({ block: 'center' }));
  await shot(plain, '07-no-server-address-only');

  await plainContext.close();
  await viewerContext.close();
  await context.close();
  console.log('live shots: done');
} finally {
  await browser.close();
}
