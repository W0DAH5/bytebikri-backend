/**
 * The card, as the page draws it, at the poses that matter.
 *
 *   node ci/eyes/card-phases.mjs [slug] [outDir]
 *
 * The card is the real roster card — name, tier, state, date — so the still
 * also answers whether the animation moves anything it should not.
 */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
const SLUG = process.argv[2] || 'nima-crafts';
const OUT = process.argv[3] || 'docs/evidence/round55';
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: '/tmp/chromium', args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 });
await page.goto(`http://127.0.0.1:3100/s/${SLUG}`, { waitUntil: 'networkidle' });
await page.waitForTimeout(700);

const index = await page.evaluate(() => {
  const cards = [...document.querySelectorAll('.member-roster .member')];
  return cards.findIndex((c) => c.querySelector('.mascot-layer .mascot-world'));
});
console.log('the wearing card:', index);
const card = (await page.$$('.member-roster .member'))[index];
await card.scrollIntoViewIfNeeded();

for (const [t, name] of [[0, 'rest'], [13, 'mid-swing'], [15, 'eating-pose'], [20, 'returning']]) {
  await page.evaluate((seconds) => {
    for (const a of document.getAnimations()) { a.pause(); a.currentTime = seconds * 1000; }
  }, t);
  await page.waitForTimeout(120);
  await card.screenshot({ path: `${OUT}/card-${String(t).padStart(2, '0')}s-${name}.png` });
  const text = await card.evaluate((el) => el.innerText.replace(/\s+/g, ' ').trim());
  console.log(`  ${String(t).padStart(2)}s ${name.padEnd(12)} text: ${text}`);
}

// And the small presentation: the card in a narrow column, where the scene has
// to survive being drawn at a fraction of the size (PREMIUM_COSMETICS §2).
await page.setViewportSize({ width: 390, height: 900 });
await page.waitForTimeout(400);
await page.evaluate(() => { for (const a of document.getAnimations()) { a.pause(); a.currentTime = 0; } });
await page.waitForTimeout(120);
const small = (await page.$$('.member-roster .member'))[index];
await small.scrollIntoViewIfNeeded();
await small.screenshot({ path: `${OUT}/card-390px-rest.png` });
const box = await small.boundingBox();
console.log('  390px card:', box && `${Math.round(box.width)}x${Math.round(box.height)}`);
await browser.close();
