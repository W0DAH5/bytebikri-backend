/**
 * The seller's half of the break gate, walked in a browser.
 *
 * The buyer's walk proves the pause. This one proves the two things a seller sees
 * and that no server test can show: the mode is OFFERED on a file that can carry a
 * break, with the trade stated in words rather than in a tooltip; and it is
 * REFUSED on a file that cannot, with a sentence that says why and what to do
 * instead — because a seller who picks it on a zip and watches it silently not
 * save has been lied to by omission.
 *
 *   node breaks-seller-walk.mjs <storeSlug> <breaksAssetId> <plainAssetId> [outDir]
 */
import { chromium } from 'playwright-core';
import { sessionFor } from './lib.mjs';

const BASE = process.env.EYES_BASE || 'http://127.0.0.1:3000';
const [SLUG, BREAKS_ID, PLAIN_ID, OUT = 'docs/evidence/round36'] = process.argv.slice(2);
if (!SLUG || !BREAKS_ID || !PLAIN_ID) {
  console.error('usage: node breaks-seller-walk.mjs <storeSlug> <breaksAssetId> <plainAssetId> [outDir]');
  process.exit(2);
}

const say = (n, s) => console.log(`\n[${n}] ${s}`);
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/tmp/chromium', args: ['--no-sandbox'],
});
const state = await sessionFor(browser, 'alice', { base: BASE });
const ctx = await browser.newContext({
  viewport: { width: 1400, height: 1000 }, storageState: state,
  colorScheme: 'dark', reducedMotion: 'reduce',
});
const p = await ctx.newPage();
p.errors = [];
p.on('console', (m) => { if (m.type() === 'error') p.errors.push(m.text().slice(0, 160)); });
p.on('pageerror', (e) => p.errors.push(`PAGEERROR ${e.message.slice(0, 160)}`));
const shot = async (name) => { await p.screenshot({ path: `${OUT}/${name}.png` }); };

say(1, 'the editor on a file that can carry a break');
await p.goto(`${BASE}/dashboard/${SLUG}/assets/${BREAKS_ID}`);
const mode = p.locator('select[name=unlockMode]');
await mode.waitFor();
const options = await mode.locator('option').allTextContents();
console.log('  access options :', JSON.stringify(options));
console.log('  selected       :', await mode.inputValue());
// The hints under the select belong to whichever options are on offer (memberships
// adds one of its own), so the break's sentence is found by what it says rather
// than by being second in the DOM.
const hints = await p.locator('select[name=unlockMode] ~ .hint').allTextContents();
const trade = hints.find((t) => /lifts the door/.test(t)) || '';
console.log('  the trade, in words :', JSON.stringify(trade.replace(/\s+/g, ' ').trim()));
await p.locator('#a-mode').scrollIntoViewIfNeeded();
await shot('walk-16-seller-mode-option');
if (await mode.inputValue() !== 'breaks') throw new Error('the fixture is not on the new mode');
if (!options.some((o) => /a break inside/.test(o))) throw new Error('the mode is not offered on a file that can carry it');
if (!/seek past it/.test(trade)) throw new Error('the seller is not told what the break cannot do');

say(2, 'the panel, for a file that has a plan');
const panel = await p.locator('text=/break/i').allTextContents();
console.log('  panel lines :', JSON.stringify(panel.map((t) => t.replace(/\s+/g, ' ').trim()).slice(0, 6)));
console.log('  break checkboxes :', await p.locator('input[name=placement]').count(),
  JSON.stringify(await p.locator('input[name=placement]').evaluateAll((els) => els.map((e) => [e.value, e.checked]))));
// The panel, not the viewport: the placement plan sits below the fold on this
// page and a picture of the top of the editor proves nothing about it. Found by
// what it contains (the heading AND the checklist), because the markup nests two
// `.panel` elements and picking the outer one would photograph the page.
const panelHandle = await p.evaluateHandle(() => {
  const wanted = ['Where the breaks go', 'Breaks you allow in this file', 'Breaks you allow'];
  let best = null;
  for (const el of document.querySelectorAll('div.panel')) {
    const text = el.textContent || '';
    if (wanted.some((w) => text.includes(w)) && (!best || el.textContent.length < best.textContent.length)) best = el;
  }
  return best;
});
await panelHandle.asElement().scrollIntoViewIfNeeded();
await panelHandle.asElement().screenshot({ path: `${OUT}/walk-17-seller-panel.png` });

say(3, 'the same choice on a file with no player — a zip');
await p.goto(`${BASE}/dashboard/${SLUG}/assets/${PLAIN_ID}`);
const plainMode = p.locator('select[name=unlockMode]');
await plainMode.waitFor();
const plainOptions = await plainMode.locator('option').allTextContents();
console.log('  access options :', JSON.stringify(plainOptions));
if (plainOptions.some((o) => /a break inside/.test(o))) {
  throw new Error('the mode is offered on a file that cannot carry a break');
}
// Force it anyway, the way a person with the page open in another tab would: the
// server has to be the thing that refuses, not the absence of an option.
await plainMode.evaluate((el) => {
  const o = document.createElement('option');
  o.value = 'breaks'; o.textContent = 'Free, with a break inside';
  el.appendChild(o);
  el.value = 'breaks';
});
console.log('  forced value before submit :', await plainMode.inputValue());
const editForm = p.locator(`form[action="/dashboard/${SLUG}/assets/${PLAIN_ID}"]`);
await Promise.all([p.waitForNavigation(), editForm.locator('button[type=submit]').click()]);
// The page's panels enter with `rise-in`, so a shot taken immediately catches them
// mid-transform and the result looks like overlapping, clipped text — a rendering
// artefact reported as a layout bug once already.
await p.waitForTimeout(900);
console.log('  landed on :', p.url().replace(BASE, ''));
const flash = await p.locator('.note-danger, [role=alert]').first().textContent().catch(() => '');
console.log('  the refusal :', JSON.stringify(flash.replace(/\s+/g, ' ').trim()));
await shot('walk-18-seller-refusal');
if (!/no-breaks|error=no-breaks/.test(p.url())) throw new Error(`the switch was not refused (${p.url()})`);
if (!/Not switched/.test(flash)) throw new Error('the refusal did not explain itself');
const modeAfter = await p.locator('select[name=unlockMode]').inputValue();
console.log('  mode after the refusal :', modeAfter, '(unchanged)');
if (modeAfter === 'breaks') throw new Error('a refused switch still changed the file');

console.log('\nconsole errors:', p.errors.length ? JSON.stringify(p.errors, null, 1) : 'none');
await ctx.close();
await browser.close();
console.log('\nwalk complete — 3 screenshots in', OUT);
