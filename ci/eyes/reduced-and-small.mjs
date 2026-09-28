/**
 * The two presentations that are not the default: a phone-width card, and the
 * still the scene becomes when motion is not welcome.
 *
 *   node ci/eyes/reduced-and-small.mjs [slug] [outDir]
 */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
const SLUG = process.argv[2] || 'nima-crafts';
const OUT = process.argv[3] || 'docs/evidence/round55';
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: '/tmp/chromium', args: ['--no-sandbox'] });

const open = async (ctx, w, h) => {
  const page = await ctx.newPage();
  await page.setViewportSize({ width: w, height: h });
  await page.goto(`http://127.0.0.1:3100/s/${SLUG}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  return page;
};
const wearing = async (page) => {
  const i = await page.evaluate(() => [...document.querySelectorAll('.member-roster .member')]
    .findIndex((c) => c.querySelector('.mascot-layer .mascot-world')));
  const cards = await page.$$('.member-roster .member');
  return cards[i];
};

const ctx = await browser.newContext();
const page = await open(ctx, 390, 900);
const card = await wearing(page);
await card.scrollIntoViewIfNeeded();
await card.screenshot({ path: `${OUT}/card-390px-rest.png` });
const box = await card.boundingBox();
const world = await page.evaluate(() => {
  const w = document.querySelector('.mascot-world');
  if (!w) return null;
  const r = w.getBoundingClientRect();
  return { w: Math.round(r.width), h: Math.round(r.height) };
});
console.log(`  390px: card ${Math.round(box.width)}x${Math.round(box.height)},  scene ${world?.w}x${world?.h}`);

// Reduced motion: a new context with the preference set, not a runtime toggle.
const still = await browser.newContext({ reducedMotion: 'reduce' });
const p2 = await open(still, 1440, 900);
const c2 = await wearing(p2);
await c2.scrollIntoViewIfNeeded();
await c2.screenshot({ path: `${OUT}/card-reduced-motion.png` });
const parked = await p2.evaluate(() => {
  const out = {};
  for (const el of document.querySelectorAll('.mascot-world .mascot-part, .mascot-world .mascot-arm, .mascot-world .mascot-grapes')) {
    const k = [...el.classList].find((c) => c.startsWith('mascot-part--')) || el.className.split(' ')[0];
    out[k] = { anim: getComputedStyle(el).animationName, opacity: getComputedStyle(el).opacity };
  }
  return out;
});
console.log('  reduced motion:', JSON.stringify(parked));
await browser.close();
