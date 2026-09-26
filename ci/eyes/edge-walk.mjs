/**
 * The edge relay, walked in a real browser: does a viewer actually watch a Catbox/Pixeldrain file
 * that is being delivered by the Cloudflare Worker?
 *
 * `VERIFY THIS` — what only this can show
 *
 * `app/test/video.test.js` proves the Worker's signature check, its streaming and its Range
 * passthrough by calling the real Worker handler with real `Request`s. What it cannot show is the
 * thing the ask was about: a person, in a browser, pressing play on a page whose file is held by a
 * host that will not serve browsers, and getting a picture — with OUR player, THEIR delivery.
 *
 * That chain has four links, and a break in any one of them looks identical from the outside (a
 * black rectangle):
 *
 *   1. the stream route answers a signed **302 to the Worker**, not a 200 and not a 302 to the
 *      host (`x-bytebikri-edge` says so, which is why that header exists);
 *   2. the CSP names the WORKER's origin, because CSP judges a redirect's destination and the
 *      destination is no longer the host (§10.4's lesson, one tier further out);
 *   3. the Worker accepts the signature and streams the bytes;
 *   4. the player advances — `readyState 4`, currentTime moving — so the bytes arrived and were
 *      decodable.
 *
 * IT NEEDS AN INSTANCE POINTED AT AN EDGE, and the recipe is the one `ci/cloudflare/README.md`
 * §5 prints. Pointed at an instance with no edge configured it reports a finding rather than a
 * pass, because "the edge works" cannot be checked against a deployment that does not have one:
 *
 *   node ci/stub-pixeldrain.mjs 4003 & node ci/stub-catbox.mjs 4002 &
 *   node ci/stub-edge-relay.mjs 4005 --secret=stub-edge-secret --key=stub-key \
 *     --pixeldrain-base=http://127.0.0.1:4003/api --catbox-base=http://127.0.0.1:4002
 *   # then boot :3100 with VIDEO_DRIVER=pixeldrain (so a VIDEO is held by the host that refuses
 *   # browsers), MEDIA_EDGE_BASE/MEDIA_EDGE_SECRET, and MEDIA_RELAY=pixeldrain,catbox
 *   rm -rf /tmp/eyes-host
 *   node ci/eyes/edge-walk.mjs
 *
 * WHY THE VIDEO DRIVER MOVES FOR THIS WALK. The demo's videos normally live at the OTHER host, and
 * only a video proves the last link in the chain — that the bytes arrived through the edge and the
 * PLAYER advanced. A `.txt` at Pixeldrain has a download link and no `<video>` element, so a walk
 * pointed at one would check three of the four links and quietly skip the one that matters. With
 * `VIDEO_DRIVER=pixeldrain` the fixture this opens (`poster-kit-part-one`, an OPEN file, so no ad
 * has to be delivered) is a real mp4 held by a host that will not hand it to a browser.
 */
import { chromium } from 'playwright';
import { sessionFor, consent } from './lib.mjs';

const BASE = process.env.EYES_BASE || process.argv[2] || 'http://127.0.0.1:3100';
const STORE = process.env.EYES_STORE || process.argv[3] || 'alice';
const SLUG = process.env.EYES_SLUG || process.argv[4] || 'poster-kit-part-one';
const VIEWER = process.env.EYES_VIEWER || process.argv[5] || 'alice';
const EDGE_ORIGIN = (() => {
  try { return new URL(process.env.MEDIA_EDGE_BASE || 'http://127.0.0.1:4005').origin; } catch { return null; }
})();

const errors = [];
const fail = (m) => { console.error(`FAIL  ${m}`); errors.push(m); };
const ok = (m, extra = '') => console.log(`ok    ${m}${extra ? ` — ${extra}` : ''}`);

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/tmp/chromium',
  args: ['--no-sandbox'],
});

try {
  const state = await sessionFor(browser, VIEWER, { base: BASE, dir: '/tmp/eyes-host' });
  const context = await browser.newContext({ storageState: state });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on('pageerror', (e) => consoleErrors.push(e.message.slice(0, 140)));
  page.on('console', (m) => {
    if (/CORS|ERR_FAILED|blocked by|Refused to/i.test(m.text()) || m.type() === 'error') {
      consoleErrors.push(m.text().slice(0, 200));
    }
  });
  const mediaResponses = [];
  page.on('response', (r) => {
    const url = new URL(r.url());
    if (EDGE_ORIGIN && url.origin === EDGE_ORIGIN) mediaResponses.push({ url: r.url().slice(0, 110), status: r.status() });
  });

  // ── 1. the page a viewer gets ──────────────────────────────────────────────
  await page.goto(`${BASE}/s/${STORE}/a/${SLUG}`, { waitUntil: 'domcontentloaded' });
  await consent(page);
  if (await page.locator('#unlock-btn').count()) {
    /*
     * Only if the file is gated: this walk is about delivery, so an open file is the better
     * fixture. If it IS gated the walk opens it the way a viewer does rather than skipping the
     * check, because a run that silently verified nothing is the failure mode this repo keeps
     * writing comments about.
     */
    const [started] = await Promise.all([
      page.waitForResponse((r) => /\/api\/unlock\/start$/.test(new URL(r.url()).pathname), { timeout: 20_000 })
        .catch(() => null),
      page.click('#unlock-btn'),
    ]);
    const info = started ? await started.json().catch(() => null) : null;
    if (info?.adConfig?.providerId) {
      await fetch(`${BASE}/dev/simulate-network/${info.adConfig.providerId}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          viewId: info.viewId,
          connectionId: info.adConfig.connectionId,
          durationSec: info.adConfig.minSeconds,
        }),
      });
    }
    await page.waitForSelector('[data-watch]', { timeout: 30_000 }).catch(() => {});
  }

  const asked = await page.evaluate(() => {
    const el = document.querySelector('[data-watch]');
    return el ? (el.getAttribute('src') || null) : null;
  });
  if (!asked) {
    fail(`no player on /s/${STORE}/a/${SLUG} — the walk proved nothing (is the file open, and is its key at Pixeldrain?)`);
    console.log(`\nedge walk: ${errors.length} finding(s)`);
    await context.close();
    await browser.close();
    process.exit(1);
  }
  ok('the file page hands the player a content url', asked.slice(0, 72));

  // ── 2. whose connection the bytes come over ────────────────────────────────
  //
  // Read with `maxRedirects: 0` so the answer is the route's own, not the end of the chain. Three
  // outcomes are possible and only one of them is this deployment's intended shape:
  //
  //   302 + x-bytebikri-edge   → the EDGE is delivering. What this walk exists to check.
  //   200 + x-bytebikri-relay  → our own server is relaying: correct when no edge is configured,
  //                              and a finding for a deployment that set one up.
  //   302 to the host          → the host is delivering directly, which for a host that refuses
  //                              browsers means a 403 is coming and the viewer gets nothing.
  const streamUrl = new URL(asked, BASE);
  const stream = await page.request.get(new URL(streamUrl.pathname + streamUrl.search, BASE).href, { maxRedirects: 0 });
  const location = stream.headers().location || '';
  const edgeHost = stream.headers()['x-bytebikri-edge'] || '';
  const relayHost = stream.headers()['x-bytebikri-relay'] || '';
  console.log(`       stream route: ${stream.status()}`
    + `${edgeHost ? ` (edge: ${edgeHost})` : relayHost ? ` (relay: ${relayHost})` : ''} → ${location.slice(0, 80)}`);

  if (stream.status() === 302 && edgeHost) {
    if (!EDGE_ORIGIN || new URL(location).origin !== EDGE_ORIGIN) {
      fail(`the signed redirect points at ${location}, which is not the configured edge (${EDGE_ORIGIN})`);
    } else {
      ok('the stream route hands the browser a signed url to the edge relay', location.slice(0, 72));
    }
    const link = new URL(location);
    if (!link.searchParams.get('e') || !/^[0-9a-f]{64}$/.test(link.searchParams.get('s') || '')) {
      fail('the edge url carries no expiry or no signature — that is the open relay this design exists to prevent');
    } else {
      ok('and the url is signed and dated', `expires ${new Date(Number(link.searchParams.get('e')) * 1000).toISOString()}`);
    }
  } else if (stream.status() === 200 && relayHost) {
    fail(`this instance is relaying through its own server (${relayHost}) rather than the edge — set `
      + 'MEDIA_EDGE_BASE + MEDIA_EDGE_SECRET and restart, or this walk cannot check the edge');
  } else if (stream.status() === 302) {
    fail(`the stream route sent the browser to the host itself (${location}) — for a host that refuses `
      + 'browsers that is a 403 the viewer cannot see the reason for');
  } else {
    fail(`the stream route answered ${stream.status()} — neither a signed edge redirect nor a relay`);
  }

  // ── 3. the policy names the destination ────────────────────────────────────
  //
  // The §10.4 failure, one tier out: a redirect whose destination is not in the policy is refused
  // by the browser with NO error event, so the player simply never advances and the page says
  // nothing. Asked of the response headers here, because that is where the policy is decided.
  const page_ = await page.request.get(`${BASE}/s/${STORE}/a/${SLUG}`);
  const csp = page_.headers()['content-security-policy'] || '';
  if (!EDGE_ORIGIN) {
    ok('no edge configured in this walk — nothing to check in the policy');
  } else if (csp.includes(EDGE_ORIGIN)) {
    ok('the policy names the edge origin, so the browser may fetch from it', EDGE_ORIGIN);
  } else if (!csp) {
    ok('this response carries no CSP header at all (dev build) — the browser cannot refuse it');
  } else {
    fail(`the CSP does not name ${EDGE_ORIGIN}, so a redirect there would be refused silently. CSP was: ${csp.slice(0, 140)}`);
  }

  // ── 4. it plays ────────────────────────────────────────────────────────────
  //
  // The four links above are about addresses; this is the one that decides whether a viewer
  // watches anything. `readyState 4` plus a currentTime that moves means the bytes arrived,
  // decoded, and advanced — a stub that returned a playlist would fail here.
  const player = page.locator('[data-watch]').first();
  await player.click({ timeout: 5_000 }).catch(() => {});
  await page.evaluate(() => {
    const el = document.querySelector('[data-watch]');
    if (el) { el.muted = true; return el.play().catch(() => {}); }
    return null;
  });
  await page.waitForTimeout(2_500);
  const played = await page.evaluate(() => {
    const el = document.querySelector('[data-watch]');
    return el ? { readyState: el.readyState, time: Number(el.currentTime || 0), paused: el.paused, error: el.error?.code || null } : null;
  });
  console.log(`       player: ${JSON.stringify(played)}`);
  console.log(`       edge responses: ${JSON.stringify(mediaResponses.slice(0, 4))}`);
  if (played && played.readyState >= 3 && played.time > 0) {
    ok('the viewer is watching it — the bytes came through the edge and played in our player',
      `${played.time.toFixed(2)}s in, readyState ${played.readyState}`);
  } else if (mediaResponses.length && mediaResponses.every((r) => r.status === 403)) {
    fail('the edge refused its own signed url — the application and the Worker do not share a secret');
  } else if (mediaResponses.length && mediaResponses.some((r) => r.status >= 400)) {
    fail(`the edge answered ${mediaResponses.map((r) => r.status).join(',')} — the bytes never arrived`);
  } else if (!mediaResponses.length) {
    fail('the browser never asked the edge for anything — the redirect did not reach it '
      + '(a CORS refusal and a policy refusal both look like this; the console errors above name which)');
  } else {
    fail(`the player did not advance — ${JSON.stringify(played)}`);
  }

  if (consoleErrors.length) fail(`console errors — ${consoleErrors.slice(0, 3).join(' | ')}`);
  await context.close();
} finally {
  await browser.close();
}

console.log(`\nedge walk: ${errors.length} finding(s)`);
process.exit(errors.length ? 1 : 0);
