/**
 * One page, one element, at a real viewport — so a "crop" is a crop of the LIVE
 * page and not of a screenshot file (cropping saved PNGs produced three blank or
 * mis-clipped images before this approach replaced it).
 *
 *   node shot.mjs <path> <who|""> <out.png> <selector> [width] [height]
 *
 * `who` is the part of a demo address before the @; the session is made by logging
 * in through the real form, so the page is the page a person would see.
 *
 * Two capture conditions, both learned the hard way and both about the CAPTURE
 * rather than the product:
 *
 *   1. `reducedMotion: 'reduce'`. The notes and hero children enter with `rise-in`,
 *      and a shot taken 400ms in captures a transform mid-flight — the element's box
 *      and its pixels disagree and the result reads as clipped text, which sent this
 *      repository looking for a layout bug that did not exist.
 *   2. The consent bar is `position: fixed` at the bottom, so on a first visit it
 *      paints OVER the foot of the viewport; an element shot of a note that happened
 *      to sit there captured the bar instead of the note's last line. Hiding it is
 *      not hiding a product problem — it dismisses on one click — but a screenshot of
 *      content should be of the content. No choice is recorded.
 */
import { chromium } from 'playwright-core';

const [path, who, out, sel, w, h] = process.argv.slice(2);
if (!path || !out) {
  console.error('usage: node shot.mjs <path> <who|""> <out.png> <selector> [w] [h]');
  process.exit(2);
}

const BASE = process.env.SHOT_BASE || 'http://127.0.0.1:3000';
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/tmp/chromium',
  args: ['--no-sandbox'],
});
const ctx = await browser.newContext({
  viewport: { width: Number(w) || 1440, height: Number(h) || 900 },
  colorScheme: 'dark',
  reducedMotion: 'reduce',
});

if (who) {
  const login = await ctx.newPage();
  await login.goto(`${BASE}/login`);
  await login.fill('input[name=email]', `${who}@bytebikri.local`);
  await login.fill('input[name=password]', process.env.DEMO_PASSWORD || 'bytebikri-demo');
  await Promise.all([login.waitForNavigation(), login.click('button[type=submit]')]);
  // The sign-in form is rate limited (six an hour per address). A screenshot run
  // that quietly lands back on the login page produces a picture of the login
  // page labelled as the dashboard, so it is worth failing loudly instead.
  if (/\/login/.test(login.url())) {
    const body = await login.textContent('body').catch(() => '');
    throw new Error(`sign-in for ${who} did not take (at ${login.url()})`
      + (/Too many/i.test(body) ? ' — the sign-in rate limiter is in the way' : ''));
  }
  await login.close();
}

const page = await ctx.newPage();
await page.goto(`${BASE}${path}`, { waitUntil: 'load' });
await page.addStyleTag({ content: '.consent{display:none !important}' });
await page.waitForTimeout(700);   // let fonts land; the reveal is off under reduced motion
await page.locator(sel).first().screenshot({ path: out });
await browser.close();
console.log(`${out}  ${sel}  @${w || 1440}x${h || 900}`);
