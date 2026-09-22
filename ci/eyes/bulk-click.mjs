// The selection behaviour, in a real browser, because it is the one part of the
// bulk list that only exists once a script has run.
//
// Everything else in this round can be checked with curl: the filters, the counts,
// the refusal sentences, the ownership checks. Two things cannot:
//
//   1. the live count in the bar, and the sticky state that comes with it;
//   2. the difference between the header box (this page) and the labelled box
//      (everything the filter matches) — which is the whole researched hazard, and
//      it lives entirely in the client.
//
// So this drives a real page: ticks two rows, reads the bar, ticks the escape
// hatch, reads the scope field, submits nothing. It prints what it saw and exits
// non-zero if any of it is wrong, so it can be run after every change to app.js.
//
//   LD_LIBRARY_PATH=... node bulk-click.mjs alice /dashboard/alice
import { chromium } from 'playwright';
import { sessionFor } from './lib.mjs';

const BASE = process.env.EYES_BASE || 'http://127.0.0.1:3000';
const [who, path] = process.argv.slice(2);
if (!who || !path) { console.error('usage: node bulk-click.mjs <who> <path>'); process.exit(2); }

const problems = [];
const check = (ok, what, saw) => {
  if (!ok) problems.push(`${what} — saw: ${saw}`);
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${ok ? '' : ` (saw: ${saw})`}`);
};

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/tmp/chromium',
  args: ['--no-sandbox'],
});
const state = await sessionFor(browser, who, { base: BASE });
const ctx = await browser.newContext({
  viewport: { width: Number(process.env.EYES_WIDTH || 390), height: Number(process.env.EYES_HEIGHT || 844) },
  storageState: state,
  colorScheme: 'dark',
  reducedMotion: 'reduce',
});
const page = await ctx.newPage();
await page.goto(BASE + path, { waitUntil: 'load' });
await page.waitForTimeout(400);

const bar = page.locator('#bulk-bar');
const count = page.locator('#bulk-count');
const scope = page.locator('#bulk-scope');
const rows = page.locator('input[name="ids"]:not([disabled])');

const n = await rows.count();
check(n > 1, `the list has rows to tick (${n})`, String(n));
check(!(await bar.evaluate((el) => el.classList.contains('is-live'))), 'the bar is at rest before anything is ticked', 'is-live');
check((await count.textContent()).includes('No files picked'), 'and it says nothing is picked', await count.textContent());

// One row: the count is live, and the bar has come to the foot of the window.
await rows.nth(0).check();
await page.waitForTimeout(150);
const afterOne = await count.textContent();
check(/1 file picked/.test(afterOne), 'one tick reads as "1 file picked", not "1 files"', afterOne);
check(await bar.evaluate((el) => el.classList.contains('is-live')), 'and the bar becomes the sticky one', 'not sticky');
check(await page.locator('#pick-page').evaluate((el) => el.indeterminate), 'the header box is neither on nor off', 'not indeterminate');

// "The bar floats at the foot of the window" is a claim about pixels, and it was
// false for the first version of this: `.panel`'s `overflow: hidden` made the FORM
// the sticky context, so the bar stuck to the bottom of an 1,800px form and was
// never seen. A class name cannot tell the difference; a bounding box can.
const atFoot = async () => {
  const box = await bar.boundingBox();
  const h = await page.evaluate(() => window.innerHeight);
  return box && Math.abs(box.y + box.height - h) < 2;
};
check(await atFoot(), 'and it is pinned to the foot of the window, not the form', 'not at the foot');

// A picture of the state that only exists once the script has run: three rows ticked
// and the bar floating at the foot of a phone screen. Kept, because "the count is
// visible while you scroll" is a claim about a picture as much as about behaviour.
await page.screenshot({ path: '/tmp/eyes/bulk-selected.png' });

// Two more: singular becomes plural, and the header box turns itself on.
await rows.nth(1).check();
await rows.nth(2).check();
await page.waitForTimeout(150);
check(/3 files picked/.test(await count.textContent()), 'three ticks read as "3 files picked"', await count.textContent());
check(await page.evaluate(() => document.querySelectorAll('input[name="ids"]:not([disabled])').length > 3
  ? document.getElementById('pick-page').indeterminate
  : !document.getElementById('pick-page').checked),
  'and the header box still does not claim the page', 'wrong state');

// The header box means THIS PAGE — never the filter.
await page.locator('#pick-page').check();
await page.waitForTimeout(150);
const pageCount = await rows.count();
check(new RegExp(`${pageCount} files? picked`).test(await count.textContent())
  || (await count.textContent()).includes(`${pageCount} file`), `the header box picks the page (${pageCount})`, await count.textContent());
check((await scope.inputValue()) === 'page', 'and the form still posts scope=page', await scope.inputValue());

// The escape hatch is a different control with a different meaning, and it says
// which one it is: the number comes from the server, not from the rows drawn.
const matching = page.locator('#pick-matching');
if (await matching.count()) {
  const total = await matching.getAttribute('data-total');
  await matching.check();
  await page.waitForTimeout(150);
  check((await scope.inputValue()) === 'matching', 'the escape hatch posts scope=matching', await scope.inputValue());
  check((await count.textContent()).includes(`${total} file`), `and the bar counts the ${total} the filter matches`, await count.textContent());
  const stillTicked = await page.evaluate(() => document.querySelectorAll('input[name="ids"]:checked').length);
  check(stillTicked === 0, 'row boxes are cleared so nothing is counted twice', String(stillTicked));

  // Clear puts it all back.
  await page.locator('#bulk-clear').click();
  await page.waitForTimeout(150);
  check((await count.textContent()).includes('No files picked'), 'Clear empties the selection', await count.textContent());
  check((await scope.inputValue()) === 'page', 'and returns the form to the page scope', await scope.inputValue());
  check(!(await bar.evaluate((el) => el.classList.contains('is-live'))), 'and the bar stops floating', 'still sticky');
  check(!(await atFoot()), 'so it is back in the page, at the end of the list', 'still pinned');
} else {
  console.log('—  no escape hatch on this page (the filter fits on one page)');
}

// And the empty-submit guard: pressing an action with nothing picked says so
// instead of posting a selection that is not there.
await page.locator('button[value="pause"]').click();
await page.waitForTimeout(400);
check(page.url().includes(path.split('?')[0]), 'an action with nothing picked does not navigate', page.url());
check((await count.textContent()).includes('Pick a file first'), 'it says what is missing instead', await count.textContent());

await browser.close();
if (problems.length) {
  console.error(`\n${problems.length} problem(s):`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log('\nselection behaviour: all checks passed');
