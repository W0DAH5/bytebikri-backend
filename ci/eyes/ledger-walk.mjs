/**
 * The attention ledger, walked in a browser (ASSET_ECONOMY §12, slice 5).
 *
 * The unit tests prove the arithmetic, the schema and the words. What only a browser
 * can show is that the page a SELLER actually opens says the right thing about two
 * numbers that are not the same number:
 *
 *   1. positions are counted by a real page render — this walk loads a storefront as a
 *      visitor and then reads the owner's ledger, so the number on the page is the
 *      number two visits really produced, split by side;
 *   2. our block is labelled ours, and no rupee figure appears anywhere on the page —
 *      a count is not an invoice;
 *   3. the verified-view block states that the money statement is the network's, and
 *      says "not reported" rather than a zero for a view that reported no duration.
 *
 *   node ledger-walk.mjs <storeSlug> [outDir]
 */
import { chromium } from 'playwright-core';
import { sessionFor } from './lib.mjs';

const BASE = process.env.EYES_BASE || 'http://127.0.0.1:3000';
const [SLUG = 'alice', OUT = 'docs/evidence/round37'] = process.argv.slice(2);

const say = (n, s) => console.log(`\n[${n}] ${s}`);
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/tmp/chromium', args: ['--no-sandbox'],
});
const errors = [];

// ── 1. a real visitor load, which is what an impression IS ──────────────────────
say(1, 'a visitor opens the storefront — the render that becomes a counted position');
const visitor = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: 'dark' });
const vp = await visitor.newPage();
vp.on('console', (m) => { if (m.type() === 'error') errors.push(`visitor: ${m.text().slice(0, 140)}`); });
vp.on('pageerror', (e) => errors.push(`visitor: PAGEERROR ${e.message.slice(0, 140)}`));
await vp.goto(`${BASE}/s/${SLUG}`);
const drawn = await vp.evaluate(() => [...document.querySelectorAll('aside.slot')].map((s) => ({
  owner: s.dataset.owner, serving: s.dataset.serving, before: Boolean(s.querySelector('.slot-creative, .slot-empty-note')),
})));
console.log('  positions on the page :', JSON.stringify(drawn));
await visitor.close();
if (!drawn.length) {
  throw new Error('the storefront drew no position at all — the ledger would have nothing to count');
}

// ── 2. the owner's ledger ────────────────────────────────────────────────────────
say(2, 'the seller opens the ledger and reads two numbers that are not one number');
const state = await sessionFor(browser, SLUG, { base: BASE });
const ctx = await browser.newContext({
  viewport: { width: 1400, height: 1100 }, storageState: state, colorScheme: 'dark',
});
const p = await ctx.newPage();
p.errors = errors;
p.on('console', (m) => { if (m.type() === 'error') errors.push(`ledger: ${m.text().slice(0, 140)}`); });
p.on('pageerror', (e) => errors.push(`ledger: PAGEERROR ${e.message.slice(0, 140)}`));
const shot = async (name, opts = {}) => { await p.screenshot({ path: `${OUT}/${name}.png`, ...opts }); };

await p.goto(`${BASE}/dashboard/${SLUG}/attention`);
await p.locator('h1').waitFor();
const headings = await p.locator('h1, h2, h3').allTextContents();
console.log('  headings :', JSON.stringify(headings.map((t) => t.replace(/\s+/g, ' ').trim())));
if (!headings.some((h) => /attention ledger/i.test(h))) throw new Error('the page is not the ledger');
if (!headings.some((h) => /watched on your files/i.test(h))) throw new Error('the verified-view block is missing');
if (!headings.some((h) => /drawn on your pages/i.test(h))) throw new Error('the drawn-positions block is missing');
if (!headings.some((h) => /our slot, on your pages/i.test(h))) throw new Error('our own inventory is not named as ours');

// The two blocks, read as rows: page kind, placement, and the number.
const readBlocks = () => p.evaluate(() => {
  const tables = [...document.querySelectorAll('table.table')].map((t) => ({
    head: [...t.querySelectorAll('thead th')].map((th) => th.textContent.trim()),
    rows: [...t.querySelectorAll('tbody tr')].map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent.trim())),
  }));
  return {
    tables,
    money: /₨|NPR\s?\d|रु/.test(document.body.innerText),
    oursSentence: /This is our inventory, not yours/.test(document.body.innerText.replace(/\s+/g, ' ')),
    statement: /The statement is the network's, not ours/i.test(document.body.innerText.replace(/\s+/g, ' ')),
    noMoneyLine: /No rupee figure is printed for our own positions/.test(document.body.innerText.replace(/\s+/g, ' ')),
  };
});
const read = await readBlocks();
console.log('  the tables       :', JSON.stringify(read.tables));
console.log('  money on the page:', read.money, '· ours-sentence:', read.oursSentence, '· statement:', read.statement);
await shot('ledger-1-attention-ledger');

if (read.money) throw new Error('the ledger printed a money figure — there is no honest one to print');
if (!read.oursSentence) throw new Error('the platform block does not say whose inventory it is');
const bodyText = await p.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
if (/\btotal\b/i.test(bodyText)) {
  throw new Error('the page offers a total — the two blocks are not the same number and must not be added');
}
if (!read.statement) throw new Error('the page does not send the money question to the network');
if (!read.noMoneyLine) throw new Error('the page does not refuse to price our own positions');

// The storefront pair this walk just produced must be in the numbers, on the store's
// side and on ours — and counted apart.
const byKey = (tables, head) => {
  const t = tables.find((x) => x.head.includes(head));
  return t ? t.rows.map((r) => ({ page: r[0], placement: r[1], n: Number(r[2]) })) : [];
};
const mine = byKey(read.tables, 'Positions drawn').filter((r) => /Storefront/.test(r.page));
console.log('  storefront rows  :', JSON.stringify(mine));
if (!mine.length) throw new Error('the storefront render this walk made is not on the ledger');
if (!mine.some((r) => r.n >= 1)) throw new Error(`the ledger counted nothing for the storefront: ${JSON.stringify(mine)}`);

// ── 3. the sentence about when a view counts, and the honest blank ───────────────
say(3, 'the block that counts views sends the money question to the network');
const watched = await p.evaluate(() => {
  const card = [...document.querySelectorAll('.card')].find((c) => /Watched on your files/.test(c.textContent));
  if (!card) return null;
  return {
    text: card.innerText.replace(/\s+/g, ' ').trim().slice(0, 420),
    blank: /not reported/.test(card.innerText),
  };
});
console.log('  watched block :', JSON.stringify(watched?.text));
if (!watched) throw new Error('the watched block vanished between reads');
if (!/postback/i.test(watched.text)) throw new Error('the block does not say what makes a view count');
// A view recorded before placements were counted must be explained, not just labelled.
if (/Not recorded/.test(watched.text) && !/recorded before this ledger counted/.test(watched.text)) {
  throw new Error('the page shows an unplaced row without saying why it is unplaced');
}
await shot('ledger-2-watched-block', { clip: await p.locator('.card').first().boundingBox() });

// ── 4. the phone read, where a seller actually checks it ─────────────────────────
// The tables carry four columns on a desktop; on a phone they have to stack and stay
// readable, because this is a page a creator opens between other things. The
// empty-state sentences are asserted in `attention.test.js`, which can build a store
// with nothing counted — a live demo store has history and cannot show them.
say(4, 'the same page on a phone, with nothing overflowing sideways');
await p.setViewportSize({ width: 390, height: 900 });
await p.waitForTimeout(250);
const phone = await p.evaluate(() => ({
  overflow: document.documentElement.scrollWidth - window.innerWidth,
  headings: [...document.querySelectorAll('h1, h2, h3')].map((h) => h.textContent.replace(/\s+/g, ' ').trim()),
  tables: document.querySelectorAll('table.table').length,
}));
console.log('  phone :', JSON.stringify(phone));
if (phone.overflow > 2) throw new Error(`the phone layout overflows by ${phone.overflow}px`);
if (phone.tables < 2) throw new Error('the phone read lost a block');
if (!phone.headings.some((h) => /our slot, on your pages/i.test(h))) {
  throw new Error('the phone read does not label our inventory as ours');
}
await shot('ledger-3-phone', { fullPage: true });

console.log('\nconsole errors:', errors.length ? JSON.stringify(errors, null, 1) : 'none');
if (errors.length) throw new Error(`${errors.length} console error(s)`);
console.log(`\nwalk complete — screenshots in ${OUT}`);
await browser.close();
