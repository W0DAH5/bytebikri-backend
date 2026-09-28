/**
 * The two poses the user reported on, frozen and photographed.
 *
 *   node ci/eyes/pose-stills.mjs [slug] [outDir]
 *
 * "the belly part movement" and "the arms connection to shoulder blade deattach
 * and gap while arm moves" are claims about what happens DURING the animation,
 * so the audit has to look at the animation rather than at the rest pose the
 * other sheets cover.
 *
 * THE CLOCK IS THE ANIMATION'S OWN. Setting `animation-delay` on an element
 * whose animation is already paused does not move it — Chromium holds the
 * paused current time and the delay shift is never applied. The first version
 * of this file did that, and a frame labelled 12s was measured at 14.04s (the
 * arm read -11.57 deg where -4.2 was due): a phase error that would have been
 * read as an artwork defect. `document.getAnimations()` + `currentTime` is the
 * animation's real timeline, and every still below reports the pose it landed
 * in so no frame is taken on faith.
 *
 * The phases that matter on the arm's 24s cycle: rest; the descent; the eating
 * pose, where the arm-down state stands and the limb is hidden; the return.
 */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const SLUG = process.argv[2] || 'nima-crafts';
const OUT = process.argv[3] || 'docs/evidence/round55';
const BASE = process.env.EYES_BASE || 'http://127.0.0.1:3100';
mkdirSync(OUT, { recursive: true });

const PHASES = [
  [0, 'rest'],
  [11, 'descent-begins'],
  [13, 'mid-descent'],
  [14.4, 'last-visible-descent'],
  [15, 'eating-pose'],
  [18, 'eating-pose-late'],
  [20, 'returning'],
  [23, 'idle'],
];

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/tmp/chromium',
  args: ['--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 3 });
await page.goto(`${BASE}/s/${SLUG}`, { waitUntil: 'networkidle' });
await page.waitForTimeout(700);

const freeze = (t) => page.evaluate((seconds) => {
  for (const a of document.getAnimations()) {
    a.pause();
    a.currentTime = seconds * 1000;
  }
  const parts = {};
  const world = document.querySelector('.mascot-world');
  for (const el of world.querySelectorAll('.mascot-part, .mascot-arm, .mascot-grapes')) {
    const cs = getComputedStyle(el);
    const cls = [...el.classList].find((c) => c.startsWith('mascot-part--')) || el.className;
    parts[cls] = { opacity: cs.opacity, transform: cs.transform };
  }
  return parts;
}, t);

for (const [t, name] of PHASES) {
  const state = await freeze(t);
  await page.waitForTimeout(120);
  const world = await page.$('.mascot-world');
  await world.screenshot({ path: `${OUT}/posestill-${String(t).padStart(4, '0')}s-${name}.png` });
  const angle = (() => {
    const m = state['mascot-arm']?.transform?.match(/matrix\(([-0-9.]+), ([-0-9.]+)/);
    return m ? (Math.atan2(Number(m[2]), Number(m[1])) * 180 / Math.PI).toFixed(2) + ' deg' : '-';
  })();
  console.log(`${String(t).padStart(5)}s ${name.padEnd(22)} arm ${angle.padStart(9)}  ` +
              `limb ${state['mascot-arm']?.opacity}  anchor ${state['mascot-part--anchor']?.opacity}  ` +
              `belly ${state['mascot-part--belly']?.opacity}  chest ${state['mascot-part--chest']?.opacity}`);
}

await browser.close();
