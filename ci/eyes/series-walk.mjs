/**
 * The series, walked in a browser (ASSET_ECONOMY §15, slice 8).
 *
 * `test/series.test.js` holds the order, the landing rule and the refusals; the pure
 * module is what decides them. What only a browser can show is the promise §15.2 makes
 * to a viewer, which is four separate things that a unit test cannot see at once:
 *
 *   1. **One card, not two.** Two episodes of one series draw ONE card on the storefront,
 *      saying how many episodes there are and which one is next. The episode pages are
 *      one level down, on the series page — and the storefront does not link to them.
 *   2. **The order is the store's.** The series page lists them in the store's numbers,
 *      not by publish date, and says which mode the store chose and what it means.
 *   3. **A position is remembered, and it is the viewer's own.** The walk pauses in the
 *      middle of the long episode; a reload finds the resume line and the player seeks
 *      there. "Start from the beginning" is an ordinary `?restart=1` link, and it works.
 *   4. **Nothing takes the wheel.** When the episode ENDS the next-episode control appears
 *      — a link with the next episode's name on it — and the episode that was finished
 *      does NOT come back as "continue": a finished file has nothing to resume, so the
 *      series page offers the start of the list rather than the episode just watched.
 *      There is no autoplay and no countdown anywhere in this walk, because there is none
 *      in the product: the 62 %-disliked pattern is refused, not re-implemented.
 *
 * The fifth thing only the seller's own page can show: the panel that adds, numbers and
 * removes episodes, and does NOT show anybody's position — the store is told the order
 * is theirs, not where any viewer is in it.
 *
 *   node series-walk.mjs [storeSlug] [seriesSlug] [viewer] [outDir]
 *
 * Dev-only, like every walk here.
 */
import { chromium } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { login, sessionFor } from './lib.mjs';

const BASE = process.env.EYES_BASE || 'http://127.0.0.1:3000';
const [SLUG = 'alice', SERIES = 'poster-kit', VIEWER = 'alice', OUT = 'docs/evidence/round41'] =
  process.argv.slice(2);

const say = (n, s) => console.log(`\n[${n}] ${s}`);
const fail = (msg) => { throw new Error(msg); };
mkdirSync(OUT, { recursive: true });

// A walk is only evidence if it starts where the last one ended: a position left by the
// previous run would make "no resume on a fresh visit" untestable and the resume
// assertion pass for the wrong reason.
const board = execFileSync('node', ['ci/eyes/reset-watch.mjs', VIEWER], { encoding: 'utf8' }).trim();
console.log(`  the board      : ${board}`);

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/tmp/chromium',
  args: ['--no-sandbox'],
});

/**
 * A signed-in session that is actually signed in.
 *
 * `sessionFor` caches a verified session on disk, and a cached cookie can outlive the
 * database it was made against: recreating the demo database gives the same person a
 * new id, and the old session then renders every page as a visitor. A walk that trusted
 * the cache would quietly test the signed-out page — which is exactly the failure mode
 * this whole file exists to catch, one level up. So the session is PROVEN against the
 * storefront before it is used, and a stale one is thrown away and made again.
 */
async function provenSession(who) {
  const state = await sessionFor(browser, who, { base: BASE });
  const probe = await browser.newContext({ storageState: state });
  const p = await probe.newPage();
  await p.goto(`${BASE}/s/${SLUG}`);
  const signedIn = await p.locator('a[href="/library"]').count() > 0;
  await probe.close();
  if (signedIn) return state;
  console.log('   (the cached session outlived its database — signing in again)');
  rmSync(`/tmp/eyes/state-${who.split('@')[0]}-${new URL(BASE).port || '3000'}.json`, { force: true });
  const fresh = await browser.newContext();
  const q = await fresh.newPage();
  await login(q, `${who}@bytebikri.local`, 'bytebikri-demo', BASE);
  const made = await fresh.storageState();
  await fresh.close();
  return made;
}

const ctx = await browser.newContext({
  viewport: { width: 1280, height: 960 },
  colorScheme: 'dark',
  storageState: await provenSession(VIEWER),
});
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 160)); });
page.on('pageerror', (e) => errors.push(`PAGEERROR ${e.message.slice(0, 160)}`));

const shot = (name) => page.screenshot({ path: `${OUT}/${name}.png` });
const text = async (sel) => (await page.locator(sel).first().innerText()).replace(/\s+/g, ' ').trim();
const stage = () => page.evaluate(() => {
  const v = document.querySelector('[data-watch]');
  if (!v) return null;
  return {
    at: Number(v.currentTime.toFixed(2)),
    duration: Number.isFinite(v.duration) ? Number(v.duration.toFixed(2)) : null,
    paused: v.paused,
    width: v.videoWidth,
    resumeAt: v.dataset.resumeAt ? Number(v.dataset.resumeAt) : null,
  };
});

/* ── 1. The storefront: one card, not two ─────────────────────────────────── */
say(1, 'the storefront draws the series once');
await page.goto(`${BASE}/s/${SLUG}`);
await page.waitForSelector('.asset-series');
const seriesCards = await page.locator('.asset-series').count();
const cardText = await text('.asset-series');
const directLinks = await page.locator(`a[href="/s/${SLUG}/a/${SERIES}-part-one"]`).count();
const storefront = { seriesCards, cardText, directLinks };
console.log('  ', JSON.stringify(storefront));
if (seriesCards !== 1) fail(`expected one series card, saw ${seriesCards}`);
if (!/2 episodes/.test(cardText)) fail(`the card does not count the episodes: ${cardText}`);
if (!/Start with Episode 1/.test(cardText)) fail(`the card does not say which one is next: ${cardText}`);
if (directLinks !== 0) fail('the storefront links straight at an episode; the list belongs one level down');
await shot('series-1-storefront');

/* ── 2. The series page: the store's order ────────────────────────────────── */
say(2, 'the series page keeps the store’s order');
await page.goto(`${BASE}/s/${SLUG}/series/${SERIES}`);
const rows = await page.locator('.ep-list .ep .ep-title').allInnerTexts();
const cta = await text('.series-head .btn-primary');
const mode = await text('.series-head .pill');
const pageFacts = { rows: rows.map((r) => r.trim()), cta, mode };
console.log('  ', JSON.stringify(pageFacts));
if (rows.length !== 2) fail(`expected two episodes, saw ${rows.length}`);
if (!/part one/.test(rows[0]) || !/part two/.test(rows[1])) fail(`the order is not the store's: ${rows.join(' / ')}`);
if (!/Start with Episode 1/.test(cta)) fail(`the series page does not start at the head: ${cta}`);
if (!/serial/i.test(mode)) fail(`the page does not say which mode the store chose: ${mode}`);
const explained = await text('.section-head p');
if (!/in order/i.test(explained)) fail(`the page does not say what the mode means: ${explained}`);
// The states are per episode, which is the architecture: one is free, the other is not.
const said = await page.locator('.ep-list .ep .ep-said').allInnerTexts();
console.log('   states        :', JSON.stringify(said.map((s) => s.trim())));
if (!said.some((s) => /Free/.test(s))) fail('no episode is shown as free');
if (!said.some((s) => /ad/i.test(s))) fail('no episode is shown with its own ask');
await shot('series-2-page');

/* ── 3. An episode: the strip, and no resume on a fresh visit ─────────────── */
say(3, 'an episode says where it sits, and nothing is resumed yet');
await page.goto(`${BASE}/s/${SLUG}/a/${SERIES}-part-one`);
await page.waitForSelector('.ep-strip');
const where = await text('.ep-where');
const nextLink = await page.locator('[data-next-episode]').first().innerText();
const fresh = await stage();
const freshCta = await page.locator('[data-next-cta]').first().evaluate((el) => el.hidden);
console.log('  ', JSON.stringify({ where, nextLink: nextLink.trim(), stage: fresh, ctaHidden: freshCta }));
if (!/Episode 1/.test(where) || !/2 episodes/.test(where)) fail(`the strip does not place the episode: ${where}`);
if (!/part two/.test(nextLink)) fail(`the next control does not name the next episode: ${nextLink}`);
if (fresh.resumeAt !== null) fail('a fresh visit was handed a resume it should not have');
if (freshCta !== true) fail('the next-episode control is visible before the episode has ended');
await shot('series-3-episode');

/* ── 4. Pause in the middle, and come back to it ──────────────────────────── */
say(4, 'a pause in the middle is remembered');
const paused = await page.evaluate(async () => {
  const v = document.querySelector('[data-watch]');
  v.currentTime = 12;
  await v.play().catch(() => {});
  await new Promise((r) => setTimeout(r, 900));
  v.pause();
  return Number(v.currentTime.toFixed(2));
});
console.log('   paused at     :', paused);
if (paused < 11) fail(`the playhead did not get to the middle (${paused})`);
await page.waitForTimeout(700);           // the pause handler posts once
await page.goto(`${BASE}/s/${SLUG}/a/${SERIES}-part-one`);
await page.waitForSelector('.ep-strip');
const resumeLine = await page.locator('.ep-resume').first().innerText().catch(() => '');
const resumed = await stage();
console.log('  ', JSON.stringify({ resumeLine: resumeLine.replace(/\s+/g, ' ').trim(), stage: resumed }));
if (!/You stopped at/i.test(resumeLine)) fail(`no resume sentence after reloading: ${resumeLine}`);
if (!resumed.resumeAt || resumed.resumeAt < 5) fail(`the player was not given the position: ${JSON.stringify(resumed)}`);
// The seek is the client's job, and it happens on metadata.
await page.waitForFunction(() => document.querySelector('[data-watch]')?.currentTime > 5, null, { timeout: 5000 })
  .catch(async () => { const s = await stage(); fail(`the player did not seek to the saved position: ${JSON.stringify(s)}`); });
console.log('   the player    :', JSON.stringify(await stage()));
await shot('series-4-resume');

/* ── 5. Start from the beginning is a link ───────────────────────────────── */
say(5, '“start from the beginning” works without a reload');
const restartHref = await page.locator('[data-resume-restart]').first().getAttribute('href');
await page.locator('[data-resume-restart]').first().click();
await page.waitForTimeout(400);
const restarted = await stage();
console.log('  ', JSON.stringify({ restartHref, stage: restarted }));
if (restartHref !== '?restart=1') fail(`“start from the beginning” is not an ordinary link: ${restartHref}`);
if (restarted.at > 1) fail(`the playhead did not go back to the beginning: ${restarted.at}`);
await page.waitForTimeout(600);
await page.goto(`${BASE}/s/${SLUG}/a/${SERIES}-part-one`);
const afterRestart = await page.locator('.ep-resume').count();
if (afterRestart !== 0) fail('the resume sentence is back after starting over');
console.log('   after restart : no resume line, as it should be');

/* ── 6. The end of an episode, and the control that appears ──────────────── */
say(6, 'the episode ends, and the next control appears — a link, not a countdown');
await page.evaluate(async () => {
  const v = document.querySelector('[data-watch]');
  v.currentTime = Math.max(v.duration - 3, 1);
  await v.play().catch(() => {});
});
await page.waitForSelector('[data-next-cta]:not([hidden])', { timeout: 15000 });
const ctaText = await text('[data-next-cta]');
const endedStage = await stage();
console.log('  ', JSON.stringify({ cta: ctaText, stage: endedStage }));
if (!/part two/.test(ctaText)) fail(`the control does not name the next episode: ${ctaText}`);
if (!endedStage || endedStage.paused !== true) fail('the episode never ended');
await shot('series-5-next');
await page.locator('[data-next-cta] a').click();
await page.waitForURL(`**/a/${SERIES}-part-two`);
const secondStrip = await text('.ep-strip');
const secondNext = await page.locator('[data-next-episode]').count();
const secondCta = await page.locator('[data-next-cta]').count();
console.log('  ', JSON.stringify({ secondStrip, secondNext, secondCta }));
if (!/Episode 2/.test(secondStrip)) fail(`the second episode's strip is wrong: ${secondStrip}`);
if (secondNext !== 0 || secondCta !== 0) fail('the LAST episode of a serial still offers a next');

/* ── 7. A finished episode is not "continue" ─────────────────────────────── */
say(7, 'the episode that was finished does not come back as “continue”');
await page.goto(`${BASE}/s/${SLUG}/a/${SERIES}-part-one`);
const finishedResume = await page.locator('.ep-resume').count();
const finishedStage = await stage();
console.log('  ', JSON.stringify({ resumeLines: finishedResume, stage: finishedStage }));
if (finishedResume !== 0 || finishedStage.resumeAt !== null) {
  fail('a finished episode offered a resume — the small dishonesty §15.2 is written against');
}
await page.goto(`${BASE}/s/${SLUG}/series/${SERIES}`);
const settled = await text('.series-head .btn-primary');
console.log('   the series page:', settled);
if (!/Start with Episode 1/.test(settled)) fail(`a finished episode is still sold as "continue": ${settled}`);

/* ── 8. The seller's panel, and the position it does not show ────────────── */
say(8, 'the seller numbers the episodes, and is never shown a position');
await page.goto(`${BASE}/dashboard/${SLUG}/series`);
await page.waitForSelector('.series-card-panel');
const panel = await text('.series-card-panel');
const panelRows = await page.locator('.ep-row').count();
const numberFields = await page.locator('.ep-row input[name=episodeNo]').count();
console.log('  ', JSON.stringify({ panelRows, numberFields, has12: /\b12\b/.test(panel) }));
if (panelRows !== 2) fail(`the panel does not list the episodes: ${panelRows}`);
if (numberFields !== 2) fail('the panel does not let the store number each episode');
if (!/A serial/.test(panel)) fail('the panel does not say which mode the store chose');
if (/stopped at|left off|12:0/i.test(panel)) fail('the seller’s page shows a viewer’s position — it must never');
await shot('series-6-seller');

console.log(`\nconsole errors  : ${errors.length ? errors.join(' | ') : 'none'}`);
if (errors.length) fail('console errors during the walk');
await browser.close();
console.log(`\nshots           : ${OUT}/series-1..6`);
console.log('series walk: ok');
