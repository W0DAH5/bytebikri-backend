/**
 * The live surface, walked in a browser (ASSET_ECONOMY §14, slice 7).
 *
 * The unit tests hold the arithmetic and `test/live-fixture.test.js` holds the bytes.
 * What only a browser can show is the claim this whole shape rests on: **the store
 * calls the break, a viewer who was already watching is stopped by it, and they come
 * back at the live edge — not where they were — and a newcomer inside the window the
 * break bought walks in with no ask at all.**
 *
 *   1. The door. The trade is stated before anybody presses anything, and the stage is
 *      NOT rendered: an ad-gated live file asks like every other ad-gated file.
 *   2. The door clears through the shared modal, and the stream PLAYS. hls.js is loaded
 *      from our own origin, the fixture is fetched by the browser, and frames decode
 *      (`videoWidth` is the honest check — `currentTime` alone can tick on a black
 *      screen). Playback starts on the viewer's own press, which is the only autoplay
 *      policy this product has.
 *   3. The store calls a break from their own dashboard. The poller stops a player that
 *      was already running, the shared modal runs the same verified view as everywhere,
 *      and playback resumes at the buffer's END — ahead of where the viewer was.
 *   4. The store ends the break early, and its own sentence says so (the window closes
 *      now; the clean entries it bought still run for the length that was announced).
 *      The VIEWER's sentence is asserted too, and that is the point of holding the
 *      network: an ask that started is seen through, and what the person reads at the
 *      end of it says the window was closed early rather than that it ran (§14.6).
 *   5. A newcomer walks in with NO ask: the trade, honoured — plus the seller's own
 *      record of the break, including that it was ended early.
 *   6. THE LADDER REACHES A STREAM (§14.7). After six breaks that produced no confirmed
 *      view, the break stops ASKING that person at all: no modal, no countdown, no
 *      paused stream — and the stage says so in the rung's own words. Then the signals
 *      are cleared and the next break asks again, because a rung that could not be left
 *      would be a wall rather than a ladder.
 *
 *   node live-walk.mjs [storeSlug] [assetSlug] [viewer] [outDir]
 *
 * Dev-only, like every walk here: the pages drive the dev simulator, and the demo
 * fixture serves the stream.
 */
import { chromium } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { sessionFor } from './lib.mjs';

const BASE = process.env.EYES_BASE || 'http://127.0.0.1:3000';
const [SLUG = 'alice', ASSET = 'friday-night-stream', VIEWER = 'bob', OUT = 'docs/evidence/round39'] =
  process.argv.slice(2);

const say = (n, s) => console.log(`\n[${n}] ${s}`);
const fail = (msg) => { throw new Error(msg); };
mkdirSync(OUT, { recursive: true });

// A walk is only evidence if it starts where the last one ended. One break running from
// a previous run would stop the viewer before the door had even been looked at.
const board = execFileSync('node', ['ci/eyes/reset-unlock.mjs', VIEWER, ASSET], { encoding: 'utf8' }).trim();
console.log(`  the board      : ${board}`);

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/tmp/chromium',
  args: ['--no-sandbox'],
});

async function person(who) {
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 960 },
    colorScheme: 'dark',
    storageState: await sessionFor(browser, who, { base: BASE }),
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 160)); });
  page.on('pageerror', (e) => errors.push(`PAGEERROR ${e.message.slice(0, 160)}`));
  return { page, errors };
}

const shot = (p, name) => p.screenshot({ path: `${OUT}/${name}.png` });
const look = (p) => p.evaluate(() => {
  const v = document.querySelector('[data-live] video');
  if (!v) return null;
  const s = v.seekable;
  return {
    at: Number(v.currentTime.toFixed(2)),
    edge: s && s.length ? Number(s.end(s.length - 1).toFixed(2)) : 0,
    paused: v.paused,
    width: v.videoWidth,
    status: (document.querySelector('[data-live-status]')?.textContent || '').trim(),
  };
});

/*
 * Start the stream the way a viewer does: their own press on the picture. The demo stream
 * is a five-second live window pinned at its edge, so a press can land before the player
 * has attached — the press is simply made again, up to three times, and the walk only
 * carries on once the picture is decoding, moving, and not paused.
 */
const startStream = async (p, label) => {
  for (let i = 1; i <= 3; i += 1) {
    await p.locator('[data-live] video').click();
    const ok = await p.waitForFunction(() => {
      const v = document.querySelector('[data-live] video');
      return Boolean(v && v.videoWidth > 0 && v.currentTime > 0.4 && !v.paused);
    }, null, { timeout: 12_000 }).then(() => true).catch(() => false);
    if (ok) return;
    console.log(`  (press ${i} did not take — the player had not attached yet)`);
  }
  fail(`${label}: the stream never started playing`);
};

const fileUrl = `${BASE}/s/${SLUG}/a/${ASSET}`;

// ── 1. the door ─────────────────────────────────────────────────────────────────
say(1, 'the door: the trade is stated, and the stage is not rendered');
const viewer = await person(VIEWER);
const vp = viewer.page;
await vp.goto(fileUrl);
await vp.locator('h1').waitFor();
const pills = (await vp.locator('.pill').allInnerTexts()).map((t) => t.trim()).filter(Boolean);
const trade = (await vp.locator('.live-ask').innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
const ask = (await vp.locator('#unlock-btn').innerText().catch(() => '')).trim();
const stageAtDoor = await vp.locator('[data-live]').count();
console.log('  the pills      :', JSON.stringify(pills));
console.log('  the trade      :', JSON.stringify(trade.slice(0, 120)));
console.log('  the ask        :', JSON.stringify(ask));
if (!pills.some((p) => /^live$/i.test(p))) fail('the page does not say the file is live');
if (!/clean entries/.test(trade)) fail('the trade is not stated before anybody presses anything');
if (!/Unlock|Watch/i.test(ask)) fail('an ad-gated live file does not ask at the door');
if (stageAtDoor) fail('the stage was rendered before the door was cleared — the ask is decoration');
await shot(vp, 'live-1-the-door');

// ── 2. the door clears, and the stream plays ────────────────────────────────────
say(2, 'the door clears, the stage attaches, and the stream plays');
await vp.click('#unlock-btn');
await vp.locator('#ad-modal').waitFor({ state: 'visible' });
await shot(vp, 'live-2-the-ask');
await vp.locator('[data-live]').waitFor({ timeout: 90_000 });
// The vendored player, from our own origin: the one dependency this slice added.
await vp.waitForFunction(() => Boolean(window.Hls), null, { timeout: 30_000 })
  .catch(() => fail('hls.js never loaded from /vendor/hls.min.js'));
const ownerLine = await vp.locator('.live-owner').innerText();
if (!/Press play/.test(ownerLine)) fail('the stage does not say what pressing play does');
await startStream(vp, 'the door opened and nothing plays');
const playing = await look(vp);
console.log('  playing        :', JSON.stringify(playing));
if (playing.paused) fail('the player is paused four tenths of a second in');
if (playing.status) fail(`the stage reports a problem while playing: ${playing.status}`);
await shot(vp, 'live-3-playing');

// ── 3. the store calls a break, and the viewer is stopped by it ──────────────────
say(3, 'the store calls a break; the player that was already running stops for it');
const seller = await person(SLUG);
const sp = seller.page;
await sp.goto(fileUrl);
const editHref = await sp.locator('a[href*="/dashboard/"][href*="/assets/"]').first().getAttribute('href');
await sp.goto(`${BASE}${editHref}`);
const panelUrl = sp.url();
const urlField = await sp.locator('#live-url').inputValue();
const trades = await sp.locator('.choice .fine').allInnerTexts();
console.log('  the panel      :', JSON.stringify({ url: urlField, trade: trades.find((t) => /buys/.test(t)) }));
if (!/\.m3u8/.test(urlField)) fail('the panel does not have the stream address');
if (!trades.some((t) => /buys .* clean entries/.test(t))) fail('the trade is not stated before the button');
// The network is HELD, so the break's ask is still on screen when the seller ends the
// break. In dev the simulator credits a view in about two seconds; without this, the
// state this walk needs to read cannot exist.
let release = null;
const held = new Promise((resolve) => { release = resolve; });
let gate = null;
await vp.route('**/dev/simulate-network/**', async (route) => { await gate; return route.continue(); });
gate = held;
await sp.locator('input[name=seconds][value="30"]').check();
await sp.getByRole('button', { name: 'Call this break' }).click();
await sp.waitForLoadState('load');
if (!/Break called/.test(await sp.locator('body').innerText())) fail('calling a break does not say it was called');

const before = await look(vp);
await vp.locator('#ad-modal').waitFor({ state: 'visible', timeout: 60_000 });
const stopped = await look(vp);
const tail = (await vp.locator('#ad-ask-tail').innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
console.log('  stopped at     :', JSON.stringify({ at: stopped.at, paused: stopped.paused }));
console.log('  the modal says :', JSON.stringify(tail.slice(0, 110)));
if (!stopped.paused) fail('the stream kept playing through the break the store called');
if (!/store called this break/.test(tail)) fail('the modal does not say where this break came from');
await shot(vp, 'live-4-the-break');

if (await vp.locator('#ad-modal').isHidden()) fail('the modal was already over — the network was not held');
console.log('  the ask is still up while the store decides');

// ── 4. the store ends it early, in its own words ────────────────────────────────
say(4, 'the store ends the break early, and the panel says which of the two it did');
await sp.goto(panelUrl);
await sp.getByRole('button', { name: 'End it now' }).click();
await sp.waitForLoadState('load');
const afterEnd = await sp.locator('body').innerText();
console.log('  the panel says :', JSON.stringify(afterEnd.match(/Break (called|ended)[^\n]*/)?.[0].slice(0, 130)));
if (!/Break ended/.test(afterEnd)) fail('ending a break does not say the window closed');
if (/Break called/.test(afterEnd)) fail('ending a break still says a break was called');
await shot(sp, 'live-4-the-break-ended-early');

// ── 5. the viewer finishes the ask, and is told WHICH end it was ────────────────
say(5, 'the ask finishes, and the viewer is told the window was closed early');
gate = null;
release();
await vp.waitForFunction(() => document.querySelector('#ad-modal')?.hidden !== false, null, { timeout: 90_000 })
  .catch(() => fail('the modal never closed — the view was never credited'));
const resumed = await look(vp);
console.log('  resumed        :', JSON.stringify(resumed));
if (resumed.at <= before.at) fail(`playback went backwards (${before.at} → ${resumed.at}): a stream does not wait`);
if (Math.abs(resumed.edge - resumed.at) > 1.6) fail('the viewer did not come back at the live edge');
if (!/store ended this break early/.test(resumed.status)) {
  fail(`the viewer is not told the window was closed early: ${resumed.status}`);
}
if (!/confirmed/i.test(resumed.status)) fail(`the credited view is not confirmed: ${resumed.status}`);
await shot(vp, 'live-5-after-the-early-end');

// ── 6. a newcomer inside the window walks in clean ──────────────────────────────
say(6, 'a newcomer walks in with no ask: the entries the break bought');
const newcomer = await person('carol');
const np = newcomer.page;
await np.goto(fileUrl);
await np.locator('h1').waitFor();
await np.locator('[data-live]').waitFor({ timeout: 30_000 });
const clean = (await np.locator('.live-door').innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
const newcomerAsk = await np.locator('#unlock-btn').count();
const newcomerDoor = await np.locator('.live-ask').count();
console.log('  the door says  :', JSON.stringify(clean.slice(0, 120)));
console.log('  the ask        :', newcomerAsk ? 'still there' : 'none — the entry was clean');
if (newcomerAsk) fail('a newcomer inside the covered window was still asked for a view');
if (newcomerDoor) fail('a newcomer inside the covered window was still shown the door sentence');
if (!/just ran a break/.test(clean)) fail('the covered door does not say why it is open');
await shot(np, 'live-6-clean-entry');

// ── 7. the seller's own record ──────────────────────────────────────────────────
say(7, "the seller's panel keeps the record: one break, ended early, and no live panel on a file that is not one");
await sp.goto(panelUrl);
const history = await sp.locator('body').innerText();
console.log('  the history    :', JSON.stringify((history.match(/\d+ seconds? · cue \d+[^\n]*/) || ['(none)'])[0].slice(0, 100)));
if (!/Breaks you have called/.test(history)) fail('the panel keeps no record of the break');
if (!/ended early/.test(history)) fail('the panel does not record that the break was ended early');
// A file that is NOT the stream: the panel is only rendered where a break can actually
// stop something, and the way to see that is to open another of this store's files.
const liveId = panelUrl.split('/assets/')[1].split(/[?#]/)[0];
const otherHref = await sp.evaluate(async ({ base, skip }) => {
  const res = await fetch(`${base}/dashboard/${location.pathname.split('/')[2]}`);
  const text = await res.text();
  const hrefs = (text.match(/href="(\/dashboard\/[^"]+\/assets\/[^"]+)"/g) || []).map((h) => h.slice(6, -1));
  return hrefs.find((h) => !h.includes(skip)) || null;
}, { base: BASE, skip: liveId });
if (!otherHref) fail('this store has no second file to check the panel against');
await sp.goto(`${BASE}${otherHref}`);
const liveSection = await sp.locator('h2', { hasText: 'The live stream' }).count();
console.log('  another file   :', otherHref.slice(0, 40) + '…', '→ live panel', liveSection ? 'present (wrong)' : 'absent (right)');
if (liveSection) fail('a live panel was rendered for a file that is not a stream');
await shot(sp, 'live-6-the-panel');

// ── the console, at the end, once ───────────────────────────────────────────────
const errors = [...viewer.errors, ...newcomer.errors, ...seller.errors];
console.log('\n  console errors :', errors.length ? JSON.stringify(errors) : 'none');
// ── 8. the ladder reaches a stream ──────────────────────────────────────────────
say(8, 'six unconfirmed breaks later the break stops asking — and the stream never notices');
/*
 * The person is put on the last rung through the product's OWN route, six times, exactly
 * as a browser with an ad blocker would arrive at it. The viewer already holds the file,
 * which is the case that matters: they are watching, and the question is what a break
 * does to them now.
 */
const assetId = await vp.evaluate(() => document.querySelector('[data-live]')?.dataset.assetId || null);
if (!assetId) fail('the stage is gone — there is nothing to be asked for');
for (let i = 1; i <= 6; i += 1) {
  const rung = await vp.evaluate(async (id) => {
    const r = await fetch('/api/unlock/blocked', {
      method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ assetId: id, signal: 'no_postback' }),
    });
    return r.json();
  }, assetId);
  if (i === 6) console.log('  six signals   :', JSON.stringify({ attempts: rung.attempts, rung: rung.rung.key, offers: rung.rung.offersUnlock }));
  if (i === 6 && rung.rung.offersUnlock !== false) fail('six unconfirmed views did not reach the last rung');
}
// The stage is re-rendered by the server with the rung on it: a person who arrives INSIDE
// a break is decided by the server rather than by what a poll has taught the browser.
await vp.goto(fileUrl);
await vp.locator('[data-live]').waitFor();
const attrs = await vp.evaluate(() => {
  const el = document.querySelector('[data-live]');
  return { offers: el?.dataset.rungOffers, words: el?.dataset.rungWords || null };
});
console.log('  the stage says:', JSON.stringify({ offers: attrs.offers, words: (attrs.words || '').slice(0, 64) }));
if (attrs.offers !== 'false') fail('the last rung did not reach the stage');
if (!/not asking you for a view/.test(attrs.words || '')) fail(`the stage carries no sentence: ${attrs.words}`);
// The same facts step 3 checks, by the same helper: frames, movement, and no pause. The
// ladder withholds the ASK, never the stream, so all three must hold on this stage too.
await startStream(vp, 'the ladder took the stream, which it must not');

// Call the break the viewer is not supposed to be asked for. The file's own four-minute
// gap between breaks is asserted in test/live.test.js and a walk cannot sit it out, so
// the file's earlier windows are MOVED BACK ten minutes first — the breaks still happened
// and the cue indexes still climb, which is why this is a move rather than a delete.
execFileSync('node', ['ci/eyes/reset-unlock.mjs', VIEWER, ASSET, '--windows'], { encoding: 'utf8' });
await sp.goto(panelUrl);
await sp.locator('input[name=seconds][value="30"]').check();
await sp.getByRole('button', { name: 'Call this break' }).click();
await sp.waitForLoadState('load');
if (!/Break called/.test(await sp.locator('body').innerText())) fail('the store could not call the break');
// The break is seen by the POLLER, so the wait is on the poller's interval rather than on
// a feeling about how long six seconds is.
await vp.waitForFunction(
  () => /not asking you for a view/.test(document.querySelector('[data-live-status]')?.textContent || ''),
  null, { timeout: 45_000 },
).catch(() => fail('the stage never said why nothing was being asked'));
const status8 = await vp.locator('[data-live-status]').innerText().catch(() => '');
const modalUp = await vp.locator('#ad-modal').isVisible();
/*
 * "The stream kept playing" is read as six samples across five seconds of NOT BEING
 * TOUCHED. The fixture is a three-segment EVENT playlist with no ENDLIST — a five-second
 * live window that the player pins to — so a moving `currentTime` is not a property of
 * this stream and asserting it would be asserting something about the demo rather than
 * about the product. What the product does to a stream is `video.pause()`; that is what
 * is checked, along with the picture still being decoded.
 */
const samples = [];
for (let i = 0; i < 6; i += 1) {
  samples.push(await vp.evaluate(() => {
    const v = document.querySelector('[data-live] video');
    return { paused: v?.paused, width: v?.videoWidth, at: Number((v?.currentTime || 0).toFixed(2)) };
  }));
  if (i < 5) await vp.waitForTimeout(1000);
}
console.log('  the viewer    :', JSON.stringify({
  paused: samples.map((s) => s.paused), at: [...new Set(samples.map((s) => s.at))],
  modal: modalUp, says: status8.slice(0, 80),
}));
if (modalUp) fail('a break the ladder is not offering still opened the modal');
if (samples.some((s) => s.paused)) fail('the stream was stopped for an ask nobody was given');
if (samples.some((s) => !(s.width > 0))) fail('frames stopped decoding during the withheld ask');
if (!/not asking you for a view/.test(status8)) fail(`the stage does not say why nothing was asked: ${status8}`);
await shot(vp, 'live-7-withheld-ask');

// And the rung is a knob, not a wall: clear the signals and the next break asks again.
execFileSync('node', ['ci/eyes/reset-unlock.mjs', VIEWER, ASSET, '--signals'], { encoding: 'utf8' });
execFileSync('node', ['ci/eyes/reset-unlock.mjs', VIEWER, ASSET, '--windows'], { encoding: 'utf8' });
await vp.goto(fileUrl);
await vp.locator('[data-live]').waitFor();
const back2 = await vp.evaluate(() => document.querySelector('[data-live]')?.dataset.rungOffers);
console.log('  after clearing:', JSON.stringify({ offers: back2 }));
if (back2 !== 'true') fail('the ladder did not reset — the last rung is a wall');
await sp.goto(panelUrl);
await sp.locator('input[name=seconds][value="30"]').check();
await sp.getByRole('button', { name: 'Call this break' }).click();
await sp.waitForLoadState('load');
const panel8 = await sp.locator('body').innerText();
if (!/Break called/.test(panel8)) fail(`the store could not call the break again: ${panel8.replace(/\s+/g, ' ').slice(0, 200)}`);
await vp.locator('#ad-modal').waitFor({ state: 'visible', timeout: 60_000 })
  .catch(async () => {
    const seen = [];
    for (let i = 0; i < 4; i += 1) {
      seen.push(await vp.evaluate(async (id) => {
        const r = await (await fetch(`/api/live/${id}/state`, { credentials: 'same-origin' })).json();
        return { stop: r.stop?.cueIndex ?? null, entry: r.entry, offers: r.rung?.offersUnlock, breaks: r.breaksRun };
      }, assetId));
      await vp.waitForTimeout(1500);
    }
    fail(`the break did not ask again after the rung reset: ${JSON.stringify(seen)}`);
  });
console.log('  the ask is back:', JSON.stringify(await vp.locator('#ad-ask-tail').innerText().catch(() => '')));
await vp.locator('#ad-close').click().catch(() => {});
await shot(vp, 'live-8-asking-again');

console.log(`  shots          : ${OUT}/live-{1-the-door,2-the-ask,3-playing,4-the-break,4-the-break-ended-early,5-after-the-early-end,6-clean-entry,7-withheld-ask,8-asking-again}.png`);
if (errors.length) fail('the pages reported console errors — see above');
await browser.close();
console.log('\nthe stream played, a break the store called stopped it, the viewer came back at the edge,'
  + ' and the door it bought was clean.');
