/**
 * What the card actually shows, and how far the hand actually moves.
 *
 * Two questions a still screenshot cannot answer:
 *   1. the frames either side of the pose handover — the two milliseconds it
 *      takes, sampled as close as the animation clock allows;
 *   2. the hand's travel in CSS PIXELS on a real card. "The hand moves" is a
 *      claim that has a number, and if the number is one pixel the claim is
 *      false however good the code looks.
 *
 *   node .tmp-closeups.mjs
 */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const BASE = process.env.EYES_BASE || 'http://127.0.0.1:3100';
const OUT = 'docs/evidence/round51-parts';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/tmp/chromium',
  args: ['--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 }, deviceScaleFactor: 2 });
await page.goto(`${BASE}/s/nima-crafts`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1000);

const seek = (t) => page.evaluate((ms) => {
  for (const a of document.getAnimations()) { try { a.pause(); a.currentTime = ms; } catch {} }
}, t * 1000);

const world = await page.$('.member--mascot .mascot-world');
const card = await page.$('.member--mascot');

// ── the handover, at the closest samples the clock offers ───────────────────
for (const [name, t] of [['swap-in-just-before', 14.49], ['swap-in-just-after', 14.50],
  ['swap-out-just-before', 18.23], ['swap-out-just-after', 18.25]]) {
  await seek(t);
  await page.waitForTimeout(60);
  await world.screenshot({ path: `${OUT}/x-${name}.png` });
}

// ── how far the hand travels, in the card's own pixels ──────────────────────
const travel = await page.evaluate(() => {
  const arm = document.querySelector('.member--mascot .mascot-arm');
  const anims = arm.getAnimations();
  const read = (t) => {
    for (const a of anims) a.currentTime = t * 1000;
    const m = new DOMMatrixReadOnly(getComputedStyle(arm).transform);
    return { x: m.e, y: m.f, angle: Math.atan2(m.b, m.a) * 180 / Math.PI };
  };
  const at0 = read(0);
  const atBottom = read(14.496);
  // the hand's own position, measured rather than assumed: the fist sits at
  // (370,45) in the 768x512 artwork, and the transform is applied about the
  // shoulder, so rotating the arm moves that point by this much.
  const box = arm.getBoundingClientRect();
  const sx = box.width / 768;
  const shoulder = { x: 268, y: 146 };
  const fist = { x: 370, y: 45 };
  const rad = (deg) => deg * Math.PI / 180;
  const rot = (p, deg) => ({
    x: shoulder.x + (p.x - shoulder.x) * Math.cos(rad(deg)) - (p.y - shoulder.y) * Math.sin(rad(deg)),
    y: shoulder.y + (p.x - shoulder.x) * Math.sin(rad(deg)) + (p.y - shoulder.y) * Math.cos(rad(deg)),
  });
  const p0 = rot(fist, at0.angle);
  const p1 = rot(fist, atBottom.angle);
  return {
    armRotationDegrees: { atRest: Number(at0.angle.toFixed(2)), atBelly: Number(atBottom.angle.toFixed(2)) },
    sceneCssPx: { w: Math.round(box.width), h: Math.round(box.height) },
    artToCss: Number(sx.toFixed(4)),
    handTravelArtworkPx: Number(Math.hypot(p1.x - p0.x, p1.y - p0.y).toFixed(1)),
    handTravelCssPx: Number((Math.hypot(p1.x - p0.x, p1.y - p0.y) * sx).toFixed(1)),
  };
});
console.log('hand travel:', JSON.stringify(travel, null, 1));

// ── the card at rest, close up, for the artwork test (§21) ──────────────────
for (const [name, t] of [['card-1x-arm-up', 0.2], ['card-1x-eating', 16.0]]) {
  await seek(t);
  await page.waitForTimeout(60);
  await card.screenshot({ path: `${OUT}/${name}.png` });
  await world.screenshot({ path: `${OUT}/${name}-scene.png` });
}

// ── and the whole page, to show it is one scene on one card ────────────────
await seek(0.2);
await page.screenshot({ path: `${OUT}/page-1x.png`, fullPage: true });
await browser.close();
console.log('written to', OUT);
