/**
 * Freeze the scene's animation at named moments in its cycle and photograph the
 * card at each. The Web Animations API is what makes this possible: every CSS
 * animation is seekable, so a moment that lasts a tenth of a second on a real
 * card — the pose handover — can be stood still in front of the camera.
 *
 *   node .tmp-seek.mjs
 */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const BASE = process.env.EYES_BASE || 'http://127.0.0.1:3100';
const OUT = 'docs/evidence/round51-parts';
mkdirSync(OUT, { recursive: true });

// The arm's cycle is 24 s. These are the moments that matter: the idle, the
// beat at the mouth, the idle again, and then the swap — sampled either side of
// it, because a handover is only wrong for a fraction of a second.
const MOMENTS = [
  ['01-idle-arm-up', 0.2],
  ['02-eat-at-mouth', 3.0],
  ['03-idle-mid-cycle', 8.0],
  ['04-arm-coming-down', 13.6],
  ['05-swap-a-before', 14.45],
  ['06-swap-b-halfway', 14.60],
  ['07-swap-c-after', 14.80],
  ['08-eat-at-belly', 16.0],
  ['09-beat-at-belly-late', 17.9],
  ['10-swap-back', 18.30],
  ['11-rising', 19.6],
];

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/tmp/chromium',
  args: ['--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 }, deviceScaleFactor: 2 });
await page.goto(`${BASE}/s/nima-crafts`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);

// One scene, and it is on the card that is wearing it.
const info = await page.evaluate(() => {
  const layers = [...document.querySelectorAll('.member--mascot .mascot-layer')];
  const parts = layers[0] ? [...layers[0].querySelectorAll('.mascot-part')].map((i) => i.getAttribute('src').split('/').pop()) : [];
  return { cardsWithScene: layers.length, parts, anythingStray: document.querySelectorAll('.mascot-layer').length };
});
console.log('scene:', JSON.stringify(info));

const seek = (t) => page.evaluate((ms) => {
  for (const a of document.getAnimations()) {
    try { a.pause(); a.currentTime = ms; } catch { /* an animation without a timeline */ }
  }
  return document.getAnimations().length;
}, t * 1000);

const card = await page.$('.member--mascot');
for (const [name, t] of MOMENTS) {
  const n = await seek(t);
  if (name === '01-idle-arm-up') console.log('animations driven:', n);
  await page.waitForTimeout(90);
  await card.screenshot({ path: `${OUT}/seek-${name}.png` });
}
await browser.close();
console.log('frames written to', OUT);
