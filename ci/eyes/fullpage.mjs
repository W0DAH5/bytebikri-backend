// The whole page, at the width a person actually holds.
//
// `shot.mjs` takes an ELEMENT screenshot, which means Playwright scrolls the page
// to bring that element into view and then clips to its box. Anything `position:
// sticky` lands inside the clip — so the console's top nav appears to be painted
// across the first row of every table, and the first row of every table looks
// broken. It is a picture of the capture machinery, not of the page. Both lessons
// in `shot.mjs`'s own header are the same shape: check the instrument before you
// believe the reading.
//
// So this one takes the page as the reader scrolls it. Use it to review a whole
// phone page top to bottom; use `shot.mjs` when there is one section worth a
// close look.
//
//   node fullpage.mjs alice /dashboard/alice/earnings /dashboard/alice/networks
//   node fullpage.mjs operator /admin/users
//   EYES_BASE=http://127.0.0.1:3100 node fullpage.mjs alice /dashboard/alice
//
// Writes /tmp/eyes/fp-<who>-<path>.png and prints the paths.
import { chromium } from 'playwright';
import { sessionFor } from './lib.mjs';

const BASE = process.env.EYES_BASE || 'http://127.0.0.1:3000';
const WIDTH = Number(process.env.EYES_WIDTH || 390);
const HEIGHT = Number(process.env.EYES_HEIGHT || 844);

const [who, ...paths] = process.argv.slice(2);
if (!who || !paths.length) {
  console.error('usage: node fullpage.mjs <who> <path> [path...]');
  process.exit(2);
}

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/tmp/chromium',
  args: ['--no-sandbox'],
});
const state = await sessionFor(browser, who, { base: BASE });
const ctx = await browser.newContext({
  viewport: { width: WIDTH, height: HEIGHT },
  storageState: state,
  colorScheme: 'dark',
  reducedMotion: 'reduce',
});
const page = await ctx.newPage();
// The consent bar is fixed to the foot of the viewport and would be stamped over
// the same band of every screenshot. It is real, but it is not what is being
// reviewed here, and it moves as the page scrolls — one capture, one position,
// which reads as a rendering fault.
await page.goto(BASE + '/', { waitUntil: 'load' });
await page.addStyleTag({ content: '.consent{display:none !important}' });

for (const path of paths) {
  await page.goto(BASE + path, { waitUntil: 'load' });
  await page.waitForTimeout(500);
  const out = `/tmp/eyes/fp-${who}-${path.replace(/\W+/g, '_')}.png`;
  await page.screenshot({ path: out, fullPage: true });
  console.log(out);
}

await browser.close();
