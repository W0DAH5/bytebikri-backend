/**
 * The break gate, walked in a browser.
 *
 * The planner shipped with Slice 3 and the seller's panel could describe a break
 * inside a file — but nothing stopped a player at one, so the buyer's page said
 * nothing about it. This walk is the half that has to be seen rather than read:
 *
 *   1. the cues are on the player
 *   2. playing into the first cue STOPS the playhead and raises the modal
 *   3. the network's confirmation — not the countdown — releases it, at the cue
 *   4. scrubbing past a cue that has not been paid for lands ON the cue
 *   5. the second break runs the same way and, once cleared, the file plays on
 *   6. the ✕ ends the wait without crediting it — and the next sitting asks again
 *
 * What it is not: a security test. The client's own comment says a viewer with
 * devtools can seek past a cue; this produces the evidence for what the ordinary
 * viewer gets, and it fails loudly rather than reporting a softened version.
 *
 *   node break-walk.mjs <assetPath> [who] [outDir]
 *
 * Two things make this possible at all. The fixture's file is a real 40-minute
 * video — the cues come from `assets.runtime_sec`, so a five-second stand-in
 * would leave every cue unreachable. And the PAGE drives the sandbox network
 * itself through the `devSimulator` flag the start response carries, which is why
 * the one simulated call is held open below: without a hold the whole break
 * completes in under a second, and a screenshot of a modal that existed for 300ms
 * is not evidence of anything. Holding it is the same flow at human speed — the
 * countdown ticks, the client polls, the postback is the thing that releases.
 */
import { chromium } from 'playwright-core';
import { sessionFor, consent } from './lib.mjs';

const BASE = process.env.EYES_BASE || 'http://127.0.0.1:3000';
const PATH = process.argv[2] || '/s/alice/a/poster-kit-walkthrough';
const WHO = process.argv[3] || 'bob';
const OUT = process.argv[4] || 'docs/evidence/round36';

const say = (n, s) => console.log(`\n[${n}] ${s}`);
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/tmp/chromium', args: ['--no-sandbox'],
});
const state = await sessionFor(browser, WHO, { base: BASE });
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 900 }, storageState: state,
  colorScheme: 'dark', reducedMotion: 'reduce',
});
const p = await ctx.newPage();
p.errors = [];
p.on('console', (m) => { if (m.type() === 'error') p.errors.push(m.text().slice(0, 160)); });
p.on('pageerror', (e) => p.errors.push(`PAGEERROR ${e.message.slice(0, 160)}`));
p.on('response', (r) => { if (r.status() >= 400) p.errors.push(`${r.status()} ${r.url().replace(BASE, '')}`); });

// Held simulated views, in order. Nothing else is intercepted.
const held = [];
await p.route('**/dev/simulate-network/**', (route) => { held.push(route); });

const shot = async (name) => { await p.screenshot({ path: `${OUT}/${name}.png` }); };
const modalIsUp = () => p.waitForFunction(() => !document.querySelector('#ad-modal')?.hidden,
  null, { polling: 'raf', timeout: 30_000 });
const modalIsDown = () => p.waitForFunction(() => document.querySelector('#ad-modal')?.hidden !== false,
  null, { polling: 'raf', timeout: 90_000 });

await p.goto(BASE + PATH);
await consent(p);
await p.waitForTimeout(300);

const stage = p.locator('[data-cues]').first();
const cues = JSON.parse(await stage.getAttribute('data-cues'));
const el = p.locator('[data-cues] video, [data-cues] audio').first();
const duration = await el.evaluate((v) => v.duration);
const modal = p.locator('#ad-modal');
const status = p.locator('#unlock-status');
const ask = async () => (await p.locator('#ad-ask-tail').textContent()).trim();

say(1, 'the page a buyer sees');
console.log('  cues on the player :', JSON.stringify(cues));
console.log('  media duration     :', duration, 'seconds');
console.log('  free-to-open label :', (await p.locator('.pill, .tag').allTextContents())
  .filter((t) => /free|break/i.test(t)).join(' / ') || '(none)');
await shot('walk-8-breaks-buyer-page');
if (!cues.length) throw new Error('no cues on the page — the fixture is not a breaks file');
if (!(duration > cues.at(-1).atSec + 30)) {
  throw new Error(`media is ${duration}s, so cue ${cues.at(-1).atSec}s is unreachable — fix the fixture, not the walk`);
}

/** Play into a cue and stop. Returns what the page looked like while it waited. */
async function walkInto(cue, shotName) {
  const before = await el.evaluate((v) => v.currentTime);
  await el.evaluate((v, at) => {
    // Fast-forward like a person holding the scrubber: jump near the cue and let
    // real playback carry the last few seconds over it.
    v.currentTime = at - 4;
    v.play();
  }, cue.atSec);
  await modalIsUp();
  await p.waitForFunction(() => document.querySelector('[data-cues] video, [data-cues] audio')?.paused,
    null, { polling: 'raf', timeout: 10_000 });
  const stoppedAt = await el.evaluate((v) => v.currentTime);
  const firstCount = (await p.locator('#ad-count').textContent()).trim();
  await p.waitForTimeout(2200);            // let the countdown tick, so the shot shows a live one
  const laterCount = (await p.locator('#ad-count').textContent()).trim();
  const asking = await ask();
  console.log(`  was at ${before.toFixed(1)}s, playhead now ${stoppedAt.toFixed(2)}s (cue ${cue.atSec})`,
    '· paused:', await el.evaluate((v) => v.paused));
  console.log('  modal asks :', JSON.stringify(asking));
  console.log('  countdown  :', firstCount, '→', laterCount, '(cosmetic, and visibly ticking)');
  console.log('  status     :', JSON.stringify((await status.textContent()).trim()));
  await shot(shotName);
  return { stoppedAt, asking };
}

/** Let the held simulated view through, exactly as the network would. */
async function confirm() {
  if (!held.length) throw new Error('the page never called the sandbox network — devSimulator is missing');
  await held.shift().continue();
  await modalIsDown();
  await p.waitForTimeout(600);
  console.log('  simulated call released:', held.length, 'still held');
  console.log('  playhead  :', (await el.evaluate((v) => v.currentTime)).toFixed(2),
    '· paused:', await el.evaluate((v) => v.paused));
  console.log('  status    :', JSON.stringify((await status.textContent()).trim()));
}

say(2, `playing into the first cue (${cues[0].atSec}s)`);
const first = await walkInto(cues[0], 'walk-9-break-modal');
if (!(await el.evaluate((v) => v.paused))) throw new Error('the playhead was not stopped at the cue');
if (Math.abs(first.stoppedAt - cues[0].atSec) > 1.5) {
  throw new Error(`stopped at ${first.stoppedAt}, not at the cue ${cues[0].atSec}`);
}

say(3, 'the network\'s confirmation releases it');
await confirm();
await shot('walk-10-break-cleared');

say(4, 'scrubbing past the second cue without paying for it');
await el.evaluate((v, cue) => { v.currentTime = cue.atSec + 300; }, cues[1]);
await p.waitForTimeout(700);
const clamped = await el.evaluate((v) => v.currentTime);
console.log('  scrubbed to', cues[1].atSec + 300, '→ playhead at', clamped.toFixed(2), '(cue', cues[1].atSec + ')');
await shot('walk-11-seek-clamped');

/*
 * Landing on the cue IS the second break: the clamp puts the playhead exactly at
 * a cue that has not been paid for, and the gate asks for it there. So this step
 * does not re-seek — it reads what the scrub produced, which is the honest
 * description of the feature and the reason the clamp is worth having at all.
 */
say(5, 'and that landing is itself the second break');
await modalIsUp();
await p.waitForFunction(() => document.querySelector('[data-cues] video, [data-cues] audio')?.paused,
  null, { polling: 'raf', timeout: 10_000 });
const secondAsk = (await p.locator('#ad-ask-tail').textContent()).trim();
await p.waitForTimeout(1200);
console.log('  playhead :', (await el.evaluate((v) => v.currentTime)).toFixed(2),
  '· paused:', await el.evaluate((v) => v.paused));
console.log('  modal asks :', JSON.stringify(secondAsk));
await shot('walk-12-break-two');
await confirm();
await p.waitForTimeout(3000);
const after = await el.evaluate((v) => v.currentTime);
console.log('  playhead now :', after.toFixed(2), '(past the last cue:', cues[1].atSec + ')');
await shot('walk-13-after-breaks');

say(6, 'the way out of a break, and the next sitting');
await p.reload();
await consent(p);
await p.waitForTimeout(400);
const el2 = p.locator('[data-cues] video, [data-cues] audio').first();
await el2.evaluate((v, at) => { v.currentTime = at - 4; v.play(); }, cues[0].atSec);
await modalIsUp();
await p.waitForFunction(() => document.querySelector('[data-cues] video, [data-cues] audio')?.paused,
  null, { polling: 'raf', timeout: 10_000 });
console.log('  asked again after a reload :', JSON.stringify((await p.locator('#ad-ask-tail').textContent()).trim()));
await p.click('#ad-close');
await p.waitForFunction(() => document.querySelector('#ad-modal')?.hidden,
  null, { polling: 'raf', timeout: 10_000 });
await p.waitForTimeout(2500);
const afterClose = await el2.evaluate((v) => v.currentTime);
const closed = await el2.evaluate((v) => v.paused);
console.log('  modal closed, playing :', !closed, '· playhead', afterClose.toFixed(2), '(cue', cues[0].atSec + ')');
console.log('  status :', JSON.stringify((await p.locator('#unlock-status').textContent()).trim()));
await shot('walk-14-break-dropped');
if (closed) throw new Error('the ✕ left the player stopped');
if (afterClose < cues[0].atSec) throw new Error(`the file did not play on after the ✕ (${afterClose})`);

say(7, 'and the postback that arrives after the person has left');
// The other half of the race: the held view is released now, so the credit lands
// late — after the modal is gone and the file is playing again. Nothing may
// re-open, and the playhead must not jump.
const beforeLate = await el2.evaluate((v) => v.currentTime);
await held.shift()?.continue();
await p.waitForTimeout(2500);
console.log('  modal still down :', await p.evaluate(() => document.querySelector('#ad-modal').hidden));
console.log('  playhead         :', beforeLate.toFixed(2), '→', (await el2.evaluate((v) => v.currentTime)).toFixed(2));
await shot('walk-15-late-credit');
if (!(await p.evaluate(() => document.querySelector('#ad-modal').hidden))) {
  throw new Error('a late credit re-opened the modal');
}

console.log('\nconsole errors:', p.errors.length ? JSON.stringify(p.errors, null, 1) : 'none');
if (!/Break 1 of 2/.test(first.asking)) throw new Error(`the modal did not number the break: ${first.asking}`);
if (!/Break 2 of 2/.test(secondAsk)) throw new Error(`the second break was not numbered: ${secondAsk}`);
if (clamped > cues[1].atSec + 1) throw new Error(`the scrub was not clamped (${clamped} vs ${cues[1].atSec})`);
if (after < cues[1].atSec) throw new Error('the file did not play on past the last break');
if (held.length) throw new Error(`${held.length} simulated call(s) were never released`);

await ctx.close();
await browser.close();
console.log('\nwalk complete — 8 screenshots in', OUT);
