/**
 * The two-arm test.
 *
 * The scene carries the raised arm and the arm-down state as two layers. If
 * both are ever drawn at once the card shows a figure with two hands and two
 * bunches of grapes — the single most visible way this animation can fail, and
 * the reason the handover is arranged the way it is.
 *
 * So: step the whole cycle in small increments, read what the browser says the
 * two layers' opacity actually is at each step, and report the worst frame.
 * This is the check that a screen recording cannot make — a ghost that lasts
 * two frames at sixty hertz is invisible to a video and obvious to the eye.
 *
 *   node .tmp-ghost.mjs
 */
import { chromium } from 'playwright-core';

const BASE = process.env.EYES_BASE || 'http://127.0.0.1:3100';
const CYCLE = 24;       // seconds, `.mascot-arm`'s animation
const STEP = 0.01;      // seconds — finer than one frame at 100 Hz

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/tmp/chromium',
  args: ['--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
await page.goto(`${BASE}/s/nima-crafts`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1000);

const result = await page.evaluate(({ cycle, step }) => {
  const arms = document.querySelectorAll('.member--mascot .mascot-arm');
  const bellies = document.querySelectorAll('.member--mascot .mascot-part--belly');
  if (arms.length !== 1 || bellies.length !== 1) {
    return { error: `expected one arm and one belly layer, found ${arms.length} and ${bellies.length}` };
  }
  const arm = arms[0];
  const belly = bellies[0];
  const anims = [...arm.getAnimations(), ...belly.getAnimations()];
  for (const a of anims) { a.pause(); }

  let worst = 0; let worstAt = 0;
  let bothAbove1 = 0; let bothAbove10 = 0;
  for (let t = 0; t <= cycle; t += step) {
    for (const a of anims) a.currentTime = t * 1000;
    const ao = parseFloat(getComputedStyle(arm).opacity);
    const bo = parseFloat(getComputedStyle(belly).opacity);
    const both = Math.min(ao, bo);
    if (both > worst) { worst = both; worstAt = t; }
    if (both > 0.01) bothAbove1 += 1;
    if (both > 0.10) bothAbove10 += 1;
  }
  // and how long each pose is on screen, which is what the brief asks for
  let upFrames = 0; let downFrames = 0; let total = 0;
  for (let t = 0; t <= cycle; t += 0.02) {
    for (const a of anims) a.currentTime = t * 1000;
    const ao = parseFloat(getComputedStyle(arm).opacity);
    const bo = parseFloat(getComputedStyle(belly).opacity);
    total += 1;
    if (ao > 0.5) upFrames += 1;
    if (bo > 0.5) downFrames += 1;
  }
  return {
    samples: Math.round(cycle / step) + 1,
    worstBothVisible: Number(worst.toFixed(4)),
    worstAtSecond: Number(worstAt.toFixed(2)),
    samplesWithBoth: bothAbove1,
    samplesWithBothOver10pct: bothAbove10,
    armUpSeconds: Number((upFrames * 0.02).toFixed(2)),
    armDownSeconds: Number((downFrames * 0.02).toFixed(2)),
    cycleSeconds: total * 0.02,
  };
}, { cycle: CYCLE, step: STEP });

console.log(JSON.stringify(result, null, 1));
if (result.worstBothVisible > 0.01) {
  console.log('\nFAIL: both arms are drawn in the same frame.');
  process.exitCode = 1;
} else {
  console.log('\nok: the two poses never share a frame.');
}
await browser.close();
