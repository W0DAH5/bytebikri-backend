/**
 * The rung INSIDE a player, walked in a browser.
 *
 * `break-walk.mjs` walks the cue gate itself — the pause, the countdown, the clamp, the
 * confirmation that releases it — and it needs a file with TWO cues and a runtime long
 * enough to hold them. `live-walk.mjs` walks the rung on a stream. Neither of them walks
 * a player, and §14.7 says the ladder reaches every surface that asks, so this is the one
 * that does, on the demo's own four-minute file:
 *
 *   1. the door states the trade, and NOTHING has been measured yet — the page has no cue
 *      to draw, because the length of a file is measured by the player rather than typed
 *      by the seller (`runtime_sec` is written by the first player that loads it)
 *   2. the player measures it, the page is rendered again, and the cue is on the stage
 *   3. playing into that cue stops the playhead and the network's confirmation releases it
 *   4. six unconfirmed views later, the SAME cue is passed over: no modal, no pause, the
 *      playhead walks through it, and the stage says why in the rung's own words
 *   5. and clearing the signals puts the cue back — a ladder, not a wall
 *
 *   node cue-rung-walk.mjs [assetPath] [who] [outDir]
 *
 * What makes step 4 possible: the module's ladder is read through the product's own
 * route, six times, exactly as a browser failing to open a break would arrive at it. What
 * makes it possible to see at all: the file's cue is at the middle of four minutes, and
 * the playhead reaches it by SEEKING to four seconds before it and playing the rest —
 * the same way `break-walk.mjs` reaches its cues, and the same way a person scrubs.
 */
import { chromium } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import { sessionFor, consent } from './lib.mjs';

const BASE = process.env.EYES_BASE || 'http://127.0.0.1:3000';
const PATH = process.argv[2] || '/s/alice/a/poster-kit-session';
const WHO = process.argv[3] || 'bob';
const OUT = process.argv[4] || 'docs/evidence/round42';
const ASSET = PATH.split('/a/')[1] || '';

const say = (n, s) => console.log(`\n[${n}] ${s}`);
const fail = (msg) => { throw new Error(msg); };

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/tmp/chromium', args: ['--no-sandbox'],
});
const state = await sessionFor(browser, WHO, { base: BASE });
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 900 }, storageState: state,
  colorScheme: 'dark', reducedMotion: 'reduce',
});
const p = await ctx.newPage();
const errors = [];
p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 160)); });
p.on('pageerror', (e) => errors.push(`PAGEERROR ${e.message.slice(0, 160)}`));
p.on('response', (r) => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url().replace(BASE, '')}`); });

const shot = (name) => p.screenshot({ path: `${OUT}/${name}.png` });
/*
 * The stage, not `[data-cues]`. Before a length has been measured there is no gate and so
 * no `data-cues` attribute at all — the server writes that attribute only when the planner
 * could place a cue — so a walk that looks for the attribute first finds nothing and
 * concludes the page has no player. The player is there; the cue is what is missing.
 */
const STAGE = 'figure.stage[data-protect]';
const stageCues = async () => {
  const raw = await p.locator(STAGE).first().getAttribute('data-cues').catch(() => null);
  try { return JSON.parse(raw || '[]'); } catch { return []; }
};
const media = () => p.locator(`${STAGE} video, ${STAGE} audio`).first();
const modalUp = () => p.locator('#ad-modal').waitFor({ state: 'visible', timeout: 30_000 })
  .then(() => true).catch(() => false);
const statusText = async () => (await p.locator('#unlock-status').textContent().catch(() => '') || '').trim();
/** The rung, as the server rendered it onto this stage. */
const stageRung = () => p.evaluate((sel) => {
  const el = document.querySelector(sel);
  return { offers: el?.dataset.rungOffers ?? null, words: el?.dataset.rungWords ?? null };
}, 'figure.stage[data-protect]');

// The simulated network is HELD here, so the ask is still on screen while the walk looks
// at it: in dev the sandbox credits a view in about two seconds, and a screenshot of a
// modal that existed for 300 ms is evidence of nothing.
const held = [];
await p.route('**/dev/simulate-network/**', (route) => { held.push(route); });

/*
 * What the player reports about the file, collected from the START rather than waited for
 * later. The first version of this walk set up its `waitForResponse` after the page had
 * loaded, and the report had already been sent by then — a wait that could never resolve
 * for a request that had succeeded. The page loads with `preload="metadata"`, so the
 * measurement usually lands within a second of the bytes arriving.
 */
const runtimePosts = [];
p.on('response', async (r) => {
  if (!r.url().includes('/runtime') || r.request().method() !== 'POST') return;
  runtimePosts.push({ status: r.status(), body: await r.json().catch(() => null) });
});

// Nobody has measured this file. A seeded database starts this way and the walk has to
// start this way on every run, or step 1 is a claim about the first ever run.
execFileSync('node', ['ci/eyes/reset-unlock.mjs', WHO, ASSET, '--runtime'], { encoding: 'utf8' });
// And nobody has been here before. A saved position is the right outcome for a person and
// a wrong setup for a walk: the previous run left this viewer stopped at 2:15 — the cue —
// so the page opened with the ask already up and step 3 was reading a resumed ask rather
// than a playhead that walked into a cue.
execFileSync('node', ['ci/eyes/reset-watch.mjs', WHO], { encoding: 'utf8' });

await p.goto(BASE + PATH);
await consent(p);
await p.locator('h1').waitFor();

// ── 1. the door, before anything has measured the file ──────────────────────────
say(1, 'the door states the trade, and the page has no cue yet — nobody has measured the file');
const door = await p.locator('body').innerText();
const trade = (door.match(/Free to open[^\n]*/) || [''])[0] || (door.match(/opens freely[^\n]*/) || [''])[0];
console.log('  the trade      :', JSON.stringify(trade.slice(0, 140)));
console.log('  cues on stage  :', JSON.stringify(await stageCues()), '(empty until the length is known)');
if (!/free to open|opens freely/i.test(door)) fail('this file does not say it opens free');
if ((await stageCues()).length) fail('a cue exists on a file whose length nobody has measured');

// The player reports the length it measured off `loadedmetadata` — the product's own route,
// and the only thing that puts a cue on this page.
await media().evaluate((v) => v.play().catch(() => {}));
for (let i = 0; i < 50 && !runtimePosts.length; i += 1) await p.waitForTimeout(500);
if (!runtimePosts.length) fail('the player never reported the file\'s length');
const runtime = runtimePosts[0].body || {};
console.log('  measured       :', JSON.stringify(runtime));
if (runtime.changed !== true) fail('the report did not record a length — the file was not unknown after all');
if (runtime.runtimeSec !== 240) fail(`the file measured ${runtime.runtimeSec}s, not the four minutes it is`);
await shot('cue-1-the-door');

// ── 2. the page rendered again, with the cue on it ──────────────────────────────
say(2, 'rendered again, the cue is on the stage and the page names it');
await p.goto(BASE + PATH);
await consent(p);
await p.locator(STAGE).first().waitFor();
const cues = await stageCues();
console.log('  cues           :', JSON.stringify(cues));
if (cues.length !== 1) fail(`${cues.length} cue(s) on a one-ask file — the fixture is not what this walk expects`);
const cue = cues[0];
// The sentence the buyer reads, and it names the cue's own second — `stamp()`'s m:ss.
const stamp = (sec) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
const said = (await p.locator('body').innerText()).match(/nothing before you start[^\n]*/);
console.log('  the page says  :', JSON.stringify((said ? said[0] : '').slice(0, 200)));
if (!said || !said[0].includes(stamp(cue.atSec))) {
  fail(`the page does not name the cue it will stop at (${stamp(cue.atSec)}): ${said ? said[0] : 'no sentence'}`);
}
if (!(cue.atSec > 120 && cue.atSec < 240 - 90)) {
  fail(`the cue at ${cue.atSec}s is inside the first two minutes or the last ninety seconds`);
}
await shot('cue-2-the-cue');

/** Seek to just before the cue and let real playback carry the playhead over it. */
const walkInto = async () => {
  await media().evaluate((v, at) => { v.currentTime = at - 4; v.play().catch(() => {}); }, cue.atSec);
};

// ── 3. the ordinary sitting: the cue stops the file, the network releases it ────
say(3, 'the cue stops an ordinary viewer, and only the network\'s confirmation releases it');
await walkInto();
if (!await modalUp()) fail('the cue did not stop the playhead');
await p.waitForFunction(() => {
  const v = document.querySelector('figure.stage video, figure.stage audio');
  return v && v.paused;
}, null, { polling: 'raf', timeout: 10_000 }).catch(() => fail('the playhead is still moving through a cue'));
const stoppedAt = await media().evaluate((v) => v.currentTime);
const countA = (await p.locator('#ad-count').textContent()).trim();
await p.waitForTimeout(2200);
const countB = (await p.locator('#ad-count').textContent()).trim();
console.log('  stopped at     :', stoppedAt.toFixed(2), `(cue ${cue.atSec})`, '· countdown', countA, '→', countB);
console.log('  the ask says   :', JSON.stringify((await p.locator('#ad-ask-tail').textContent()).trim()));
await shot('cue-3-the-break');

if (!held.length) fail('the page never called the sandbox network');
await held.shift().continue();
await p.waitForFunction(() => document.querySelector('#ad-modal')?.hidden !== false, null, { timeout: 90_000 })
  .catch(() => fail('the modal never closed after the view was credited'));
await p.waitForTimeout(600);
console.log('  after credit   :', JSON.stringify(await statusText()));
console.log('  playing        :', !(await media().evaluate((v) => v.paused)));
if (!/confirmed/i.test(await statusText())) fail('the credited sitting does not say it was confirmed');
await shot('cue-4-confirmed');

// ── 3b. the person who left at the cue is asked again, and cannot play past it ──
say('3b', 'a viewer who left at the cue is asked again on the way back, and cannot play past the ask');
await p.waitForTimeout(1500);          // the position is written a moment after the pause
// Rendered again, because the sentence beside the player is the server's: it can only
// say where this person stopped once they have stopped.
await p.goto(BASE + PATH);
await consent(p);
await p.locator(STAGE).first().waitFor();
/*
 * Where the resume comes from: `data-resume-at` on the player, rendered by the server from
 * the position the client posted. A standalone video page does not print the position as a
 * sentence — that belongs to the series page, where "continue" has somewhere to point — and
 * asserting a sentence here would be asserting a promise this page does not make.
 */
const savedAt = await p.evaluate(() => {
  const line = [...document.querySelectorAll('p, span, div')]
    .map((n) => n.textContent.replace(/\s+/g, ' ').trim())
    .find((t) => /^You stopped at /.test(t));
  return line || null;
});
const resumedAt = Number(await media().evaluate((v) => v.dataset.resumeAt || 0));
console.log('  the position   :', JSON.stringify({ sentence: savedAt, resumeAt: resumedAt }));
if (!(resumedAt >= cue.atSec - 2 && resumedAt <= cue.atSec + 2)) {
  fail(`the viewer was not put back at the cue they stopped on (${resumedAt})`);
}
// The playhead is already where the cue is — that is what the resume is — so the ask must
// come back the moment they press play, and the file must not run behind it. Pressing play
// while an ask is up used to fall straight through the play handler, because `gating` made
// it return early: a viewer could dismiss a break by ignoring it while the countdown ran.
await media().evaluate((v) => v.play().catch(() => {}));
await p.waitForTimeout(1500);
const behind = await p.evaluate(() => {
  const v = document.querySelector('figure.stage video');
  return { paused: v.paused, at: Number(v.currentTime.toFixed(2)), modal: !document.querySelector('#ad-modal').hidden };
});
console.log('  playing at the cue:', JSON.stringify(behind));
if (!behind.modal) fail('a person who pressed play on the cue was not asked');
if (!behind.paused || behind.at > cue.atSec + 1) {
  fail(`the file ran behind the ask: ${JSON.stringify(behind)}`);
}
await shot('cue-3b-asked-again');
// Left the way a person leaves it, and the position is cleared so the ladder steps below
// start from a fresh sitting.
await p.locator('#ad-close').click().catch(() => {});
await p.waitForTimeout(500);
execFileSync('node', ['ci/eyes/reset-watch.mjs', WHO], { encoding: 'utf8' });
if (held.length) await held.shift().continue();

// ── 4. the ladder reaches the cue ──────────────────────────────────────────────
say(4, 'six unconfirmed views later the same cue is passed over — the file never stops');
execFileSync('node', ['ci/eyes/reset-unlock.mjs', WHO, ASSET], { encoding: 'utf8' });
const assetId = await p.evaluate((sel) => document.querySelector(sel)?.dataset.assetId || null, 'figure.stage[data-protect]');
if (!assetId) fail('the stage does not name the file');
for (let i = 1; i <= 6; i += 1) {
  const rung = await p.evaluate(async (id) => {
    const r = await fetch('/api/unlock/blocked', {
      method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ assetId: id, signal: 'no_postback' }),
    });
    return r.json();
  }, assetId);
  if (i === 6) {
    console.log('  six signals    :', JSON.stringify({ attempts: rung.attempts, rung: rung.rung?.key, offers: rung.rung?.offersUnlock }));
    if (rung.rung?.offersUnlock !== false) fail('six unconfirmed views did not reach the last rung');
  }
}
// Rendered again, so the stage carries the rung the server decided rather than a rung the
// browser learned about after the fact.
await p.goto(BASE + PATH);
await consent(p);
await p.locator(STAGE).first().waitFor();
const withheldRung = await stageRung();
console.log('  the stage says :', JSON.stringify({ offers: withheldRung.offers, words: (withheldRung.words || '').slice(0, 64) }));
if (withheldRung.offers !== 'false') fail('the last rung did not reach the player');
const stillCues = await stageCues();
if (JSON.stringify(stillCues) !== JSON.stringify(cues)) {
  fail(`the cue list changed with the rung: ${JSON.stringify(stillCues)} — the file must not be withheld, only the ask`);
}
await walkInto();
await p.waitForTimeout(4500);          // four seconds to the cue, then past it
const passed = await media().evaluate((v) => ({ at: v.currentTime, paused: v.paused }));
const modalThere = await p.locator('#ad-modal').isVisible();
const withheldStatus = await statusText();
console.log('  the viewer     :', JSON.stringify({ at: Number(passed.at.toFixed(2)), paused: passed.paused, modal: modalThere }));
console.log('  the player says:', JSON.stringify(withheldStatus));
if (modalThere) fail('a cue the ladder is not offering still opened the modal');
if (passed.paused) fail('the file was stopped for an ask nobody was given');
if (passed.at <= cue.atSec) fail(`the playhead stopped at ${passed.at} instead of walking through the cue at ${cue.atSec}`);
if (!/not asking you for a view/.test(withheldStatus)) {
  fail(`the player does not say why nothing was asked: ${withheldStatus}`);
}
await shot('cue-5-withheld-cue');

// ── 5. a ladder, not a wall: clearing the signals puts the cue back ─────────────
say(5, 'clearing the signals puts the cue back — the last rung is a state, not a sentence');
execFileSync('node', ['ci/eyes/reset-unlock.mjs', WHO, ASSET, '--signals'], { encoding: 'utf8' });
await p.goto(BASE + PATH);
await consent(p);
await p.locator(STAGE).first().waitFor();
const back = await stageRung();
console.log('  the stage says :', JSON.stringify({ offers: back.offers }));
if (back.offers !== 'true') fail('the ladder did not reset — the last rung is a wall');
await walkInto();
if (!await modalUp()) fail('the cue did not come back after the signals were cleared');
console.log('  the ask is back:', JSON.stringify((await p.locator('#ad-ask-tail').textContent()).trim()));
await shot('cue-6-asking-again');
// Ended the way a person ends it when they change their mind: the ✕, which is reported as
// a decline rather than counted against them.
if (held.length) await held.shift().continue();
await p.locator('#ad-close').click().catch(() => {});
await p.waitForTimeout(800);
console.log('  after the ✕    :', JSON.stringify(await statusText()));

console.log(`\n  console errors : ${errors.length ? errors.join(' | ') : 'none'}`);
console.log(`  shots          : ${OUT}/cue-{1-the-door,2-the-cue,3-the-break,3b-asked-again,4-confirmed,5-withheld-cue,6-asking-again}.png`);
if (errors.length) fail('the page reported errors');
console.log('\nthe cue stopped an ordinary viewer, the network released it, and the same cue was passed over for somebody the ladder had stopped asking.\n');

await browser.close();
