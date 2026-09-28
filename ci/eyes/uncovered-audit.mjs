/**
 * Where does the figure stop covering the ground, and is the gap a tear or a pose?
 *
 *   node ci/eyes/uncovered-audit.mjs [slug] [outDir]
 *
 * The scene's own background is painted magenta. Every child (plate, anchor,
 * arm, grapes) paints over it, so any pixel of magenta inside the figure is a
 * place nothing covers — the hole that reads as a torn shoulder. Comparing each
 * pose with the rest pose removes the figure's own outside, which is always
 * magenta and always the same.
 *
 * The phases are the ones the arm can actually be seen in: the limb is shown
 * from the start of the cycle to 60.39% (14.49s) and again from 76% (18.25s).
 * Between those it is hidden and the eating pose stands, so an uncovered pixel
 * there is the pose; in the first group it is a tear.
 *
 * Runs at 4x so a one-CSS-pixel tear is four pixels wide.
 */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const SLUG = process.argv[2] || 'nima-crafts';
const OUT = process.argv[3] || 'docs/evidence/round55';
const BASE = process.env.EYES_BASE || 'http://127.0.0.1:3100';
mkdirSync(OUT, { recursive: true });

const PHASES = [
  [0, 'rest'],
  [6, 'p06-idle'],
  [10, 'p10-descent-begins'],
  [12, 'p12'],
  [13.5, 'p13.5'],
  [14.4, 'p14.4-last-visible'],
  [15, 'p15-eating'],
  [16.5, 'p16.5-eating'],
  [18, 'p18-eating'],
  [19, 'p19-return'],
  [21, 'p21'],
  [23, 'p23-idle'],
];

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/tmp/chromium',
  args: ['--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 4 });
await page.goto(`${BASE}/s/${SLUG}`, { waitUntil: 'networkidle' });
await page.waitForTimeout(700);

await page.evaluate(() => {
  const world = document.querySelector('.mascot-world');
  world.style.background = '#ff00ff';
  for (const el of world.querySelectorAll('.mascot-layer, .mascot-scene')) el.style.background = 'transparent';
});

const freeze = (t) => page.evaluate((seconds) => {
  // THE ANIMATION'S OWN CLOCK. Setting `animation-delay` on an element whose
  // animation is already paused does not move it: Chromium holds the paused
  // current time and the delay shift is never applied. The first version of
  // these harnesses did that, and a frame labelled 12s was measured at 14.04s
  // (the arm read -11.57 deg where -4.2 was due) — a phase error that would
  // have been read as an artwork defect. The Web Animations timeline is exact.
  for (const a of document.getAnimations()) {
    a.pause();
    a.currentTime = seconds * 1000;
  }
}, t);

for (const [t, name] of PHASES) {
  await freeze(t);
  await page.waitForTimeout(90);
  const world = await page.$('.mascot-world');
  await world.screenshot({ path: `${OUT}/ground-${String(t).padStart(4, '0')}-${name}.png` });
}
console.log(PHASES.map(([t, n]) => `${t}s=${n}`).join('  '));
await browser.close();
