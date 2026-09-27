/**
 * The scene at the sizes it is actually seen, and with the arm actually moving.
 *
 *   node ci/eyes/scene-shots.mjs [slug] [outDir]
 *
 * The walk proves the mechanics (joints, clocks, one instance, no layout shift).
 * This is the picture: the card as it renders, the character at the size the
 * card gives it (so the face and the grapes can be judged rather than assumed),
 * the arm at two points of its cycle, and the parked reduced-motion still.
 */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const SLUG = process.argv[2] || 'nima-crafts';
const OUT = process.argv[3] || 'docs/evidence/round53';
const BASE = process.env.EYES_BASE || 'http://127.0.0.1:3100';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/tmp/chromium',
  args: ['--no-sandbox'],
});

const open = async (opts = {}, width = 1440) => {
  const page = await browser.newPage({ viewport: { width, height: 1000 }, ...opts });
  await page.goto(`${BASE}/s/${SLUG}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  return page;
};

const cardOf = (page) => page.evaluate(() => {
  const card = [...document.querySelectorAll('.member')].find((c) => c.querySelector('.mascot-layer'));
  const r = card.getBoundingClientRect();
  return { x: r.x, y: r.y + window.scrollY, w: r.width, h: r.height };
});

// ── the card, as the eye meets it ───────────────────────────────────────────
{
  const page = await open({ deviceScaleFactor: 1 });
  const box = await cardOf(page);
  await page.evaluate((b) => window.scrollTo(0, b.y - 80), box);
  await page.waitForTimeout(400);
  const card = await page.$('.member--mascot') ?? await page.$('.member');
  await card.screenshot({ path: `${OUT}/20-card-live-1x.png` });
  await page.close();
}
{
  const page = await open({ deviceScaleFactor: 3 });
  const card = await page.$('.member--mascot') ?? await page.$('.member');
  await card.screenshot({ path: `${OUT}/21-card-live-3x.png` });
  await page.close();
}

// ── the character alone, at the size the card gives it, and at 3x ───────────
{
  const page = await open({ deviceScaleFactor: 3 });
  const world = await page.$('.mascot-world');
  await world.screenshot({ path: `${OUT}/22-character-3x.png` });
  await page.close();
}

// ── the arm, at points of its cycle ─────────────────────────────────────────
{
  const page = await open({ deviceScaleFactor: 2 });
  const shot = async (n) => {
    const world = await page.$('.mascot-world');
    await world.screenshot({ path: `${OUT}/23-arm-${n}.png` });
    return page.evaluate(() => {
      const a = document.querySelector('.mascot-arm');
      const g = document.querySelector('.mascot-grapes');
      return { arm: getComputedStyle(a).transform, grapes: getComputedStyle(g).transform,
               belly: getComputedStyle(document.querySelector('.mascot-part--belly')).opacity };
    });
  };
  const seen = [];
  for (let i = 0; i < 8; i += 1) {
    seen.push(await shot(i));
    await page.waitForTimeout(2600);
  }
  console.log('the arm through its cycle:');
  for (const s of seen) console.log('  ', JSON.stringify(s));
  await page.close();
}

// ── reduced motion: the parked still, full size ─────────────────────────────
{
  const page = await open({ reducedMotion: 'reduce', deviceScaleFactor: 3 });
  const world = await page.$('.mascot-world');
  await world.screenshot({ path: `${OUT}/24-reduced-motion-3x.png` });
  await page.close();
}

await browser.close();
console.log(`\nshots in ${OUT}`);
