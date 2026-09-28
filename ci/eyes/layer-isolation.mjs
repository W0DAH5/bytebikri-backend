/**
 * One layer at a time, over a magenta ground, at one instant.
 *
 *   node ci/eyes/layer-isolation.mjs [slug] [phase seconds] [outDir]
 *
 * Paints the world magenta, freezes the animation's own clock, and photographs
 * the scene once with every layer and once more with each layer hidden. The
 * sheet that comes out names the layer that owns any pixel you can see.
 */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const SLUG = process.argv[2] || 'nima-crafts';
const AT = Number(process.argv[3] || 16);
const OUT = process.argv[4] || 'docs/evidence/round55';
const BASE = process.env.EYES_BASE || 'http://127.0.0.1:3100';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/tmp/chromium',
  args: ['--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 4 });
await page.goto(`${BASE}/s/${SLUG}`, { waitUntil: 'networkidle' });
await page.waitForTimeout(600);

await page.evaluate(() => { document.querySelector('.mascot-world').style.background = '#ff00ff'; });

const freeze = (t) => page.evaluate((seconds) => {
  for (const a of document.getAnimations()) { a.pause(); a.currentTime = seconds * 1000; }
}, t);

await freeze(AT);
await page.waitForTimeout(120);

const key = (el) => [...el.classList].find((c) => c.startsWith('mascot-part--')) || el.className.split(' ')[0];
const shot = async (name) => {
  const world = await page.$('.mascot-world');
  await world.screenshot({ path: `${OUT}/iso-${name}.png` });
};
const hide = (k) => page.evaluate(({ k }) => {
  const world = document.querySelector('.mascot-world');
  for (const el of world.querySelectorAll('img, .mascot-arm, .mascot-grapes')) {
    const key = [...el.classList].find((c) => c.startsWith('mascot-part--')) || el.className.split(' ')[0];
    el.style.visibility = (k && key === k) ? 'hidden' : '';
  }
}, { k });

await hide(null);
await shot(`${AT}-all`);
const classes = await page.evaluate(() => {
  const world = document.querySelector('.mascot-world');
  const out = [];
  for (const el of world.querySelectorAll('img, .mascot-arm, .mascot-grapes')) {
    out.push([[...el.classList].find((c) => c.startsWith('mascot-part--')) || el.className.split(' ')[0],
              el.getAttribute('src') || el.querySelector('img')?.getAttribute('src') || '(wrapper)']);
  }
  return out;
});
console.log(`layers at ${AT}s, in stacking order:`);
for (const [k, src] of classes) console.log(`   ${k.padEnd(22)} ${src}`);

for (const [k] of classes) {
  await hide(k);
  await page.waitForTimeout(60);
  await shot(`${AT}-without-${k.replace(/^mascot-/, '')}`);
  await hide(null);
}

await browser.close();
