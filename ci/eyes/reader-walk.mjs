/**
 * The reader, walked in a browser (ASSET_ECONOMY §13, slice 6).
 *
 * The unit tests prove the page model, the pool of cues and the bookmark's rules. What
 * only a browser can show is the thing §13 claims and the player's gate cannot: **a
 * reader's gate is enforced, not decorated.**
 *
 *   1. The file page offers the way in, and states where the stops are — in the
 *      reader's own words ("One view after page N"), before the first page.
 *   2. Page one draws a real page, out of a real CBZ, through the signed route.
 *   3. A page past an uncleared seam is NOT DRAWN: the ask stands where the page would
 *      be, and the URL for that page is refused by the server (this walk fetches the
 *      byte route by hand, the way a curious visitor would, and reads the 403).
 *   4. The ask is the same verified view as everywhere else: the sandbox network
 *      delivers a signed postback, the page uses the same modal, and the seam then
 *      lets the page through.
 *   5. A bookmark is written for the person who read it, and "continue" comes back.
 *
 *   node reader-walk.mjs [storeSlug] [assetSlug] [who] [outDir]
 *
 * Dev-only, like every walk here: it drives the dev simulator to deliver the postback.
 */
import { chromium } from 'playwright-core';
import { sessionFor } from './lib.mjs';

const BASE = process.env.EYES_BASE || 'http://127.0.0.1:3000';
const [SLUG = 'alice', ASSET = 'kathmandu-sketchbook', WHO = 'bob', OUT = 'docs/evidence/round38'] =
  process.argv.slice(2);

const say = (n, s) => console.log(`\n[${n}] ${s}`);
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/tmp/chromium', args: ['--no-sandbox'],
});
const errors = [];
const fail = (msg) => { throw new Error(msg); };

// ── 1. the file page: the way in, and the promise ───────────────────────────────
say(1, 'the file page offers the reader and states where the stops are');
const state = await sessionFor(browser, WHO, { base: BASE });
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 960 }, storageState: state, colorScheme: 'dark',
});
const p = await ctx.newPage();
// One of the checks below fetches a blocked page ON PURPOSE, and a 403 is the expected
// answer — an error counter that cannot tell a deliberate refusal from a broken page is
// an error counter nobody reads. The credit is spent by that check and by nothing else.
const expected = { refusals: 0 };
p.on('console', (m) => {
  if (m.type() !== 'error') return;
  if (/403 \(Forbidden\)/.test(m.text()) && expected.refusals > 0) { expected.refusals -= 1; return; }
  errors.push(`reader: ${m.text().slice(0, 140)}`);
});
p.on('pageerror', (e) => errors.push(`reader: PAGEERROR ${e.message.slice(0, 140)}`));
// Every reader screenshot waits for the page that is in front of the camera to be
// DECODED first. `decoding="async"` is right for a reader — a photograph should not
// block the text around it — but it also means a screenshot taken the moment the
// element exists can catch an empty frame and make a working page look broken.
const shot = async (name, opts = {}) => {
  await p.evaluate(async () => {
    await Promise.all([...document.querySelectorAll('figure.reader-page img')].slice(0, 2)
      .map((img) => img.decode?.().catch(() => {})));
  }).catch(() => {});
  await p.screenshot({ path: `${OUT}/${name}.png`, ...opts });
};

const fileUrl = `${BASE}/s/${SLUG}/a/${ASSET}`;
await p.goto(fileUrl);
await p.locator('h1').waitFor();
const offer = await p.locator('.reader-offer a').first();
const offerText = (await offer.textContent()).replace(/\s+/g, ' ').trim();
const promise = await p.locator('.reader-offer').innerText();
// The stops sentence sits beside the offer, in the action block — it is the file page's
// promise about the reader, and it must be readable BEFORE the first page, not only at
// the seam. Read it from the page, not from the offer box.
const stopsLine = (await p.locator('main').innerText()).match(/Free to open[^\n]*One view after (?:page|chapter) \d+[^\n]*/i);
console.log('  the offer     :', JSON.stringify(offerText));
console.log('  the promise   :', JSON.stringify((stopsLine?.[0] || '').replace(/\s+/g, ' ').slice(0, 210)));
if (!/Start reading|Continue reading/.test(offerText)) fail('the file page offers no way into the reader');
if (!stopsLine) {
  fail('the file page does not say where the stops are — a gate nobody was told about reads as a fault');
}
if (!/\d+ pages/.test(promise)) fail('the page count is not on the page');

// ── 2. page one, drawn ──────────────────────────────────────────────────────────
say(2, 'the reader draws page one out of the archive');
// Straight to the reader's own URL with no bookmark preference, so this claim is about
// page ONE and not about where the browser last left off — which the walk checks later.
await p.goto(`${fileUrl}/read`);
await p.locator('[data-reader]').waitFor();
await p.locator('[data-reader]').waitFor();
const first = await p.evaluate(() => {
  const reader = document.querySelector('[data-reader]');
  const img = reader.querySelector('figure.reader-page img');
  return {
    assetId: reader.dataset.assetId,
    step: reader.dataset.readerStep,
    direction: reader.dataset.direction,
    mode: reader.dataset.mode,
    label: reader.querySelector('.reader-bar .fine')?.textContent.trim(),
    src: img ? img.getAttribute('src').slice(0, 64) : null,
    // `naturalWidth` is the only honest check that the bytes were an image: a 403
    // renders as a broken image with zero intrinsic size and no thrown error.
    drawn: img ? img.naturalWidth : 0,
    gate: Boolean(reader.querySelector('[data-reader-gate]')),
  };
});
console.log('  page one      :', JSON.stringify(first));
if (first.step !== '1') fail(`the reader did not start at page one (step ${first.step})`);
if (!first.drawn) fail('page one did not draw — the signed page route served nothing usable');
if (first.gate) fail('the first page already shows a gate: nothing may be asked before page three');
if (!/Page 1 of \d+/.test(first.label || '')) fail(`the counter does not count pages: ${first.label}`);
await shot('reader-1-page-one');

// ── 3. the seam: the ask stands where the page would be, and the server refuses ─
say(3, 'walking to the seam: the ask stands before the next page, and the bytes are refused');
const last = Number((first.label.match(/of (\d+)/) || [])[1] || 0);

// A reader's gate is BETWEEN pages, so the last page of a segment is drawn normally and
// the ask stands after it — where the next page would be. Walking page by page is how
// that lands: the first step carrying an ask is the seam's last page.
let seamStep = null;
let seamDrawn = 0;
for (let n = 1; n <= last; n += 1) {
  await p.goto(`${fileUrl}/read?p=${n}`);
  await p.locator('[data-reader]').waitFor();
  const seen = await p.evaluate(() => ({
    gated: Boolean(document.querySelector('[data-reader-gate]')),
    drawn: document.querySelector('figure.reader-page img')?.naturalWidth ?? 0,
  }));
  if (seen.gated) { seamStep = n; seamDrawn = seen.drawn; break; }
  if (!seen.drawn) fail(`page ${n} drew nothing and asked for nothing — that is a fault, not a gate`);
  if (n === last) fail('no gate was found in the whole file — the plan placed none, or the reader ignored them');
}
console.log(`  the seam      : the ask first stands at page ${seamStep} (drawn: ${seamDrawn}px)`);
if (!seamDrawn) fail('the seam\'s own page did not draw — the ask replaced the page it belongs after');
const blocked = seamStep + 1;
if (blocked < 3) fail(`a gate stood before page 3 (blocking page ${blocked}), which the plan may not do`);

// The deep link past the seam — no clicking, which is exactly how somebody would try to
// skip the ask. Here the ask REPLACES the page, and no page is drawn at all.
await p.goto(`${fileUrl}/read?p=${blocked}`);
await p.locator('[data-reader]').waitFor();
const deep = await p.evaluate(() => ({
  gated: Boolean(document.querySelector('[data-reader-gate]')),
  drawn: document.querySelector('figure.reader-page img')?.naturalWidth ?? 0,
  label: document.querySelector('.reader-bar .fine')?.textContent.trim(),
}));
console.log(`  deep-linked   : page ${blocked} →`, JSON.stringify(deep));
if (!deep.gated) fail(`page ${blocked} was drawn without the view that owes it`);
if (deep.drawn) fail('the blocked page drew its bytes anyway — the ask is decoration');

const gate = await p.evaluate(() => {
  const b = document.querySelector('[data-reader-gate]');
  return {
    sentence: document.querySelector('.reader-gate p strong')?.textContent.trim(),
    cueIndex: b.dataset.cueIndex,
    next: b.dataset.next,
    url: b.dataset.breakUrl,
    // The ask replaces the page turn: no dead link beside it.
    nextLink: Boolean(document.querySelector('.reader-bar a[rel="next"]')),
  };
});
console.log('  the ask       :', JSON.stringify(gate));
if (!new RegExp(`One view after (page|chapter) ${seamStep}\\.?`).test(gate.sentence || '')) {
  fail(`the ask counts the wrong seam: ${gate.sentence}`);
}
if (!gate.next || !/p=\d+/.test(gate.next)) fail('the ask carries no page to return to when the view is credited');
if (gate.nextLink) fail('the reader still offers a page turn beside the ask');
await shot('reader-2-the-seam');

// The blocked page, fetched by hand with the token the visitor WAS given — repointed at
// the step they were not. This is the claim a drawn veil cannot make: the bytes
// themselves are refused, and the refusal says the same sentence the page does.
await p.goto(`${fileUrl}/read?p=${seamStep}`);
await p.locator('figure.reader-page img').waitFor();
expected.refusals += 1;
const raw = await p.evaluate(async ({ step }) => {
  const signed = document.querySelector('figure.reader-page img').getAttribute('src');
  const hand = signed.replace(/\/page\/\d+/, `/page/${step}`);
  const res = await fetch(hand, { credentials: 'same-origin' });
  let body = null;
  try { body = await res.json(); } catch { /* bytes or html */ }
  return { status: res.status, error: body?.error, gate: body?.gate?.sentence, type: res.headers.get('content-type') };
}, { step: blocked });
console.log('  by hand       :', JSON.stringify(raw));
if (raw.status !== 403) fail(`the blocked page was not refused (status ${raw.status}) — the veil is decoration`);
if (!/a view is owed before this page/i.test(raw.error || '')) fail(`the refusal does not say what is owed: ${raw.error}`);
if (raw.type && /image\//.test(raw.type)) fail('the refusal returned image bytes');

// ── 4. the same verified view, and the page turns ───────────────────────────────
say(4, 'the ask is the same verified view: the network confirms it, and the page turns');
await p.locator('[data-reader-gate]').click();
await p.locator('#ad-modal').waitFor({ state: 'visible' });
await shot('reader-3-the-ask');
await p.waitForURL(new RegExp(`p=${blocked}`), { timeout: 90_000 });
await p.locator('[data-reader]').waitFor();
const after = await p.evaluate(() => {
  const reader = document.querySelector('[data-reader]');
  const img = reader.querySelector('figure.reader-page img');
  return {
    step: reader.dataset.readerStep,
    drawn: img ? img.naturalWidth : 0,
    gate: Boolean(reader.querySelector('[data-reader-gate]')),
    label: reader.querySelector('.reader-bar .fine')?.textContent.trim(),
  };
});
console.log('  after the view:', JSON.stringify(after));
if (Number(after.step) !== blocked) fail(`the reader did not land on the page the view owed (${after.step})`);
if (!after.drawn) fail('the page after a cleared seam did not draw');
if (after.gate) fail('the ask is still standing after the network confirmed the view');
await shot('reader-4-the-page-turns');

// ── 5. the bookmark, and the way back in ────────────────────────────────────────
say(5, 'the bookmark is kept for this reader, and the file page offers to continue');
await p.goto(`${fileUrl}/read?p=${Math.min(blocked + 1, last)}`);
await p.locator('[data-reader]').waitFor();
await p.waitForTimeout(600);   // the beacon posts on the step change, not on load
const saved = await p.evaluate(async ({ base, assetId }) => {
  // Read it back through the API rather than the database: what matters is that the
  // reader's own client wrote it, and that the server kept it.
  const res = await fetch(`${base}/s/alice/a/kathmandu-sketchbook/read?p=1`, { credentials: 'same-origin' });
  const html = await res.text();
  return { continueLine: /You stopped at Page \d+ of \d+/.test(html), sample: (html.match(/You stopped at [^<]+/) || [])[0] };
}, { base: BASE, assetId: null });
console.log('  the bookmark  :', JSON.stringify(saved));
if (!saved.continueLine) fail('the reader did not offer to continue where this person stopped');

await p.goto(fileUrl);
await p.locator('h1').waitFor();
const back = (await p.locator('.reader-offer a').first().textContent()).replace(/\s+/g, ' ').trim();
console.log('  the offer now :', JSON.stringify(back));
if (!/Continue reading/.test(back)) fail('the file page does not offer to continue after a bookmark was written');
await shot('reader-5-continue');

// ── 6. a phone, with nothing overflowing sideways ───────────────────────────────
say(6, 'the same reader on a phone, with nothing overflowing');
const phoneCtx = await browser.newContext({
  viewport: { width: 390, height: 844 }, storageState: state, colorScheme: 'dark', isMobile: true, hasTouch: true,
});
const ph = await phoneCtx.newPage();
ph.on('console', (m) => { if (m.type() === 'error') errors.push(`phone: ${m.text().slice(0, 140)}`); });
await ph.goto(`${fileUrl}/read?p=1`);
await ph.locator('[data-reader]').waitFor();
const phone = await ph.evaluate(() => ({
  overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  bar: Boolean(document.querySelector('.reader-bar')),
  drawn: document.querySelector('figure.reader-page img')?.naturalWidth ?? 0,
}));
console.log('  phone         :', JSON.stringify(phone));
if (phone.overflow > 0) fail(`the reader scrolls sideways on a phone (${phone.overflow}px)`);
if (!phone.drawn) fail('the page did not draw on a phone');
await ph.screenshot({ path: `${OUT}/reader-6-phone.png`, fullPage: false });
await phoneCtx.close();

// ── 7. the seller's two choices ─────────────────────────────────────────────────
say(7, "the seller's own page sets how the file reads, and the reader obeys");
const seller = await sessionFor(browser, SLUG, { base: BASE });
const sctx = await browser.newContext({
  viewport: { width: 1400, height: 1100 }, storageState: seller, colorScheme: 'dark',
});
const sp = await sctx.newPage();
sp.on('console', (m) => { if (m.type() === 'error') errors.push(`seller: ${m.text().slice(0, 140)}`); });
sp.on('pageerror', (e) => errors.push(`seller: PAGEERROR ${e.message.slice(0, 140)}`));
const manage = `${BASE}/dashboard/${SLUG}/assets/${first.assetId}`;
const saveForm = `form[action$="/assets/${first.assetId}"]`;

await sp.goto(manage);
await sp.locator('h2', { hasText: 'How this file reads' }).waitFor();
// The panel reads what is IN FORCE, not a default: the stored choice is checked.
const before = await sp.evaluate(() => ({
  mode: document.querySelector('input[name=readMode]:checked')?.value,
  direction: document.querySelector('input[name=readDirection]:checked')?.value,
  steps: [...document.querySelectorAll('.panel')]
    .find((panel) => panel.querySelector('h2')?.textContent.includes('How this file reads'))
    ?.querySelector('.pill')?.textContent.trim(),
}));
console.log('  the panel     :', JSON.stringify(before));
if (before.mode !== 'page' || before.direction !== 'ltr') {
  fail(`the panel does not show the stored choice (${before.mode}/${before.direction})`);
}
if (!/12 steps/.test(before.steps || '')) fail(`the panel does not count the steps it describes (${before.steps})`);

// Flip BOTH controls, because the two are one decision from the reader's side.
await sp.check('input[name=readMode][value=scroll]');
await sp.check('input[name=readDirection][value=rtl]');
await Promise.all([
  sp.waitForNavigation(),
  sp.locator(`${saveForm} button[type=submit]`).first().click(),
]);
const said = await sp.locator('.note-success').first().innerText();
console.log('  the sentence  :', JSON.stringify(said.replace(/\s+/g, ' ').slice(0, 130)));
if (!/saved=read-choices/.test(sp.url())) fail(`the save did not report the reader's own outcome (${sp.url()})`);
if (!/way you chose/.test(said)) fail('the save said "Saved." where the reader changed — the sentence must name what moved');
await shot('reader-7-the-sellers-choices');

// The reader the buyer opens now turns the other way, and scrolls.
await p.goto(`${fileUrl}/read?p=1`);
await p.locator('[data-reader]').waitFor();
const after7 = await p.evaluate(() => {
  const reader = document.querySelector('[data-reader]');
  const bar = reader.querySelector('.reader-bar');
  const figures = reader.querySelectorAll('figure.reader-page').length;
  return {
    mode: reader.dataset.mode, direction: reader.dataset.direction, figures,
    // In a right-to-left reader the forward control sits on the LEFT of the bar.
    nextFirst: Boolean(bar.querySelector('a[rel="next"]')?.compareDocumentPosition(bar.querySelector('.fine')) & Node.DOCUMENT_POSITION_FOLLOWING),
  };
});
console.log('  the reader now:', JSON.stringify(after7));
if (after7.mode !== 'scroll') fail(`the reader ignored the seller's mode (${after7.mode})`);
if (after7.direction !== 'rtl') fail(`the reader ignored the seller's direction (${after7.direction})`);
if (after7.figures < 2) fail('scroll mode drew a single page — the strip is what makes it a scroll');
if (!after7.nextFirst) fail('right to left did not put the forward control on the left');
await shot('reader-8-scroll-and-rtl');

// Put it back, so the demo database reads the way it did when the walk started.
await sp.goto(manage);
await sp.locator('h2', { hasText: 'How this file reads' }).waitFor();
await sp.check('input[name=readMode][value=page]');
await sp.check('input[name=readDirection][value=ltr]');
await Promise.all([
  sp.waitForNavigation(),
  sp.locator(`${saveForm} button[type=submit]`).first().click(),
]);
if (!/saved=read-choices/.test(sp.url())) fail('flipping the choices back did not save');
await sctx.close();

console.log(`\nconsole errors: ${errors.length ? JSON.stringify(errors.slice(0, 4)) : 'none'}`);
await browser.close();
console.log(`\nwalk complete — screenshots in ${OUT}`);
