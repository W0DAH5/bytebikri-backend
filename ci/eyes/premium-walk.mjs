/**
 * The premium look, walked in a browser — two payers, two layers, both schemes.
 *
 * The unit tests prove the arithmetic (every palette's ink against both surfaces)
 * and the composition rule (a member's wear never replaces the store's chip). What
 * they cannot prove is the thing this walk exists for: that a real browser, handed
 * the real page, actually PAINTS the look, actually runs the motion when somebody
 * points at it, actually stops the motion without losing the look when the system
 * asks for less, and keeps the text readable in both colour schemes.
 *
 * Every assertion that can be measured from the browser is measured from the
 * browser. Contrast is computed from the COMPUTED colours of the element and the
 * surface behind it, not from the stylesheet's text — a rule that never applies
 * proves nothing, and the cascade is exactly where a wrong-looking page hides.
 *
 *   node ci/demo-state.mjs                     # Alice wears teal + halo on a roster
 *   node ci/eyes/premium-walk.mjs [slug] [outDir]
 *
 * The fixture this walk needs, all of it seeded:
 *   * Alice's store on the Store plan (so a `.plan-mark` is on its header), with a
 *     roster holding a PENDING member (Bob) — the row nobody has confirmed;
 *   * Nima Crafts on the Store plan with Alice as an ACTIVE Elite member wearing
 *     Plus teal + halo — the one row in the product that carries both layers at
 *     once, which is the whole point of the round;
 *   * Bob's store on the free plan, whose header must carry no mark at all.
 *
 * Section 4b walks the other half of "worn on every page": the signed-in person's own
 * account chip in the header, on a page about somebody else's store.
 *
 * The motion is read through `getAnimations()` on the real element, so what is
 * asserted is the browser's animation tree rather than the stylesheet: paused at
 * rest, running under the pointer, and gone entirely under `prefers-reduced-motion`.
 */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { consent, sessionFor } from './lib.mjs';

const SLUG = process.argv[2] || 'alice';
const ROSTER_SLUG = process.argv[3] || 'nima-crafts';
const OUT = process.argv[4] || 'docs/evidence/round36';
const BASE = process.env.EYES_BASE || 'http://127.0.0.1:3000';
mkdirSync(OUT, { recursive: true });

const say = (n, s) => console.log(`\n[${n}] ${s}`);
const WAIT = { timeout: 12_000 };

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/tmp/chromium', args: ['--no-sandbox'],
});

/**
 * A context at one colour scheme and one motion preference.
 *
 * Both are set at the CONTEXT level, which is what `prefers-color-scheme` and
 * `prefers-reduced-motion` actually answer to. Reading the stylesheet instead would
 * test the file; this tests the browser's decision.
 */
async function openCtx({ scheme = 'dark', motion = 'no-preference', who = null } = {}) {
  const ctx = await browser.newContext({
    viewport: { width: 1400, height: 1000 }, colorScheme: scheme, reducedMotion: motion,
    ...(who ? { storageState: await sessionFor(browser, who, { base: BASE }) } : {}),
  });
  const p = await ctx.newPage();
  p.errors = [];
  p.on('console', (m) => { if (m.type() === 'error') p.errors.push(m.text().slice(0, 160)); });
  p.on('pageerror', (e) => p.errors.push(`PAGEERROR ${e.message.slice(0, 160)}`));
  return { ctx, p };
}

/**
 * Screenshot of the subject, not of the top of the page.
 *
 * The extra scroll matters and is a capture lesson rather than a product one: the
 * header is sticky, so an element scrolled to the top of the viewport sits UNDER it —
 * the band's own name was cut in half by the navigation in the first version of this
 * shot. Pulling the page up a little after the scroll puts the subject below the header
 * where a reader would actually see it.
 */
async function shotOf(p, selector, name, { full = false } = {}) {
  if (selector && await p.locator(selector).count()) {
    await p.locator(selector).first().scrollIntoViewIfNeeded();
    await p.evaluate(() => window.scrollBy(0, -96));
    await p.waitForTimeout(350);
  }
  await p.screenshot({ path: `${OUT}/${name}.png`, fullPage: full });
}

/**
 * The animation tree of one element, read from the browser.
 *
 * `playState` is the browser's own answer to "is this moving right now", which is
 * the only way to tell a paused animation from one that was never declared — the
 * stylesheet looks identical in both cases and the page looks still.
 *
 * `{ subtree: true }` is for the RING, whose motion lives on its `::after`
 * pseudo-element: Chromium's `Element.getAnimations()` does not return
 * pseudo-element animations, so without this the ring measures as `[]` while it is
 * visibly turning. (Found by measuring a page that was moving and reading zero.)
 */
function animationsOn(p, selector) {
  return p.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    return el.getAnimations({ subtree: true }).map((a) => ({
      name: a.animationName,
      pseudo: a.effect?.pseudoElement || null,
      playState: a.playState,
    }));
  }, selector);
}

/**
 * The contrast a READER actually gets, computed in the page from the computed style.
 *
 * The element's painted colour is resolved by the browser (so `color-mix()`,
 * custom properties, media queries and every fallback have already been applied),
 * the nearest opaque background behind it is walked up the tree, and the two are
 * composited. A painted name has `color: transparent` and a background clipped to
 * the text, so for those the gradient's stops are read from the computed
 * `background-image` and each one is checked — the worst stop is the number that
 * matters, and the average is a number that would hide the failure.
 */
function paintOf(p, selector) {
  return p.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const cs = getComputedStyle(el);
    const parse = (c) => {
      const m = c.match(/rgba?\(([^)]+)\)/);
      if (!m) return null;
      const [r, g, b, a = '1'] = m[1].split(',').map((v) => parseFloat(v));
      return [r, g, b, parseFloat(a)];
    };
    const over = (fg, bg) => {
      const a = fg[3];
      return [0, 1, 2].map((i) => fg[i] * a + bg[i] * (1 - a)).concat(1);
    };
    const lum = ([r, g, b]) => {
      const lin = (c) => { const s = c / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
      return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    };
    const ratio = (a, b) => {
      const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
      return (x + 0.05) / (y + 0.05);
    };

    // The surface behind the text: the first ancestor that paints one.
    let surface = null;
    for (let n = el; n; n = n.parentElement) {
      const bg = parse(getComputedStyle(n).backgroundColor);
      if (bg && bg[3] > 0.95) { surface = bg; break; }
    }
    surface ||= [255, 255, 255, 1];

    const ink = parse(cs.color);
    const painted = /background-clip:\s*text|-webkit-background-clip:\s*text/.test(cs.cssText)
      || cs.webkitBackgroundClip === 'text' || cs.backgroundClip === 'text';
    // The stops of the painted gradient, as the browser resolved them.
    const stops = [...cs.backgroundImage.matchAll(/rgba?\([^)]+\)/g)].map((m) => parse(m[0]));
    const checked = painted && stops.length
      ? stops.map((s) => ({ colour: over(s, surface), from: 'gradient stop' }))
      : [{ colour: over(ink, surface), from: 'ink' }];
    return {
      painted,
      clip: cs.backgroundClip || cs.webkitBackgroundClip,
      stops: stops.length,
      checks: checked.map((c) => ({ from: c.from, ratio: Number(ratio(c.colour, surface).toFixed(2)) })),
      colour: cs.color,
      backgroundImage: cs.backgroundImage.slice(0, 90),
      textShadow: cs.textShadow === 'none' ? 'none' : 'set',
      font: cs.fontFamily,
    };
  }, selector);
}

/** The roster row of one person, from the public storefront. */
function rosterRow(p, who) {
  return p.locator('.member-roster li', { hasText: who }).first();
}

async function openRoster(p, slug) {
  await p.goto(`${BASE}/s/${slug}`);
  await consent(p);
  await p.locator('.member-roster').first().scrollIntoViewIfNeeded();
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Both layers, on one real row
// ─────────────────────────────────────────────────────────────────────────────
say(1, 'a member of this store who also pays bytebikri wears BOTH things on one row');
const dark = await openCtx({ scheme: 'dark' });
const p = dark.p;
await openRoster(p, ROSTER_SLUG);

const rowText = (await rosterRow(p, 'Alice').textContent()).replace(/\s+/g, ' ').trim();
const wear = await rosterRow(p, 'Alice').locator('[class*="wear-"]').first().getAttribute('class');
const chip = await rosterRow(p, 'Alice').locator('.store-chip').first().textContent();
console.log('  the row       :', JSON.stringify(rowText));
console.log('  the name wears:', wear, '· the chip says:', JSON.stringify(chip));

if (!/wear-/.test(wear || '')) throw new Error('the member’s own look is not on the row');
if (!chip) {
  throw new Error('the store’s chip is MISSING on a member who has bought a look elsewhere — '
    + 'this is the regression this round exists to fix');
}
if (!/^Elite$/i.test(chip.trim())) throw new Error(`the chip is not the store’s own tier name: ${chip}`);
// The two are siblings inside the same row, and the wear is on the name rather than
// on the row: neither layer may be an ancestor of the other, or one would be
// decorating the thing the other owns.
const structure = await rosterRow(p, 'Alice').evaluate((li) => {
  const w = li.querySelector('[class*="wear-"]');
  const c = li.querySelector('.store-chip');
  return { sameRow: Boolean(w && c), contained: Boolean(w && c && (w.contains(c) || c.contains(w))), tag: w?.tagName };
});
if (!structure.sameRow || structure.contained) throw new Error('the two layers are not siblings: ' + JSON.stringify(structure));
console.log('  one row, two layers, neither inside the other:', structure.sameRow && !structure.contained);
await shotOf(p, '.member-roster', 'premium-1-two-layers-dark');

// ─────────────────────────────────────────────────────────────────────────────
// 2. The same row in the light scheme — the look, not a different look
// ─────────────────────────────────────────────────────────────────────────────
say(2, 'and it is painted in the day scheme too, not merely inverted');
const light = await openCtx({ scheme: 'light' });
await openRoster(light.p, ROSTER_SLUG);
const lightWear = await rosterRow(light.p, 'Alice').locator('[class*="wear-"]').first().getAttribute('class');
console.log('  the name wears:', lightWear);
await shotOf(light.p, '.member-roster', 'premium-2-two-layers-light');
if (lightWear !== wear) throw new Error(`the effect changes with the scheme: ${wear} → ${lightWear}`);

// ─────────────────────────────────────────────────────────────────────────────
// 3. The paint is readable — measured from the browser, both schemes
// ─────────────────────────────────────────────────────────────────────────────
say(3, 'every painted name is readable where it is actually painted');
// Measured where each thing is really painted, in this order: the roster first,
// because both contexts are still on it, and the picker after, because reading the
// demo chips means leaving the roster. (The first cut of this collected every
// selector into one list and then walked it — by which time both pages were the
// Plus page and the roster measurement found nothing. A harness that measures the
// page it happens to be on is a harness that lies at the first navigation.)
function checkPaint(scheme, paint, sel, where) {
  if (!paint) throw new Error(`nothing was found to measure at ${sel}`);
  const worst = Math.min(...paint.checks.map((c) => c.ratio));
  console.log(`  ${scheme.padEnd(5)} ${where.padEnd(7)} ${sel.replace('.plus-effect-choice ', '').padEnd(24)} `
    + `${paint.painted ? `painted · ${paint.stops} stop(s)` : 'inked'} · worst ${worst}:1 `
    + `(${paint.checks.map((c) => `${c.from} ${c.ratio}`).join(', ')})`);
  if (worst < 4.5) throw new Error(`${scheme} ${sel}: ${worst}:1 is below 4.5:1 — ${paint.colour}`);
}

const ROSTER_WEAR = '.member-roster li [class*="wear-"]';
for (const [scheme, ctx] of [['dark', dark], ['light', light]]) {
  checkPaint(scheme, await paintOf(ctx.p, ROSTER_WEAR), ROSTER_WEAR, 'roster');
}
// And now the two effects that PAINT the glyphs rather than inking them, which the
// seeded look does not use (it is halo). They are read from the Plus page's own demo
// chips, because the shop window for an effect is a real page and is checked rather
// than trusted. This is where the 2.9:1 mistake would live if the plate stops ever
// crept back into `color`.
for (const [scheme, ctx] of [['dark', dark], ['light', light]]) {
  await ctx.p.goto(`${BASE}/plus`);
  await consent(ctx.p);
  await ctx.p.locator('.plus-effects').first().scrollIntoViewIfNeeded();
  for (const effect of ['gradient', 'prism']) {
    const sel = `.plus-effect-choice .wear-${effect}`;
    checkPaint(scheme, await paintOf(ctx.p, sel), sel, 'picker');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Motion on intent: still at rest, moving under the pointer
// ─────────────────────────────────────────────────────────────────────────────
say(4, 'the look is at rest; pointing at the name is what starts it');
await openRoster(p, ROSTER_SLUG);   // section 3 left this page on /plus
const rest = await animationsOn(p, `.member-roster li:has([class*="wear-"]) [class*="wear-"]`);
console.log('  at rest       :', JSON.stringify(rest));
if (!rest?.length) throw new Error('the name declares no animation at all — nothing would ever move');
if (rest.some((a) => a.playState === 'running')) throw new Error('a name is animating before anybody touched it');

await rosterRow(p, 'Alice').locator('[class*="wear-"]').first().hover();
await p.waitForTimeout(300);
const hovered = await animationsOn(p, `.member-roster li:has([class*="wear-"]) [class*="wear-"]`);
console.log('  under pointer :', JSON.stringify(hovered));
if (!hovered?.some((a) => a.playState === 'running')) {
  throw new Error('hovering the name does not start its motion — the effect would be a still sticker');
}
await shotOf(p, '.member-roster', 'premium-3-hover-moving');

// Keyboard focus is the same promise for somebody who does not use a pointer, and it
// is the ONE place a decorative animation has to be reachable: the Plus page's live
// preview is focusable so the effect can be started without a mouse.
// The live preview, in a session that HAS a look. A signed-out visitor's preview is
// the plain default — nothing chosen, nothing moving — and that is the correct page
// too, so the visitor is checked first and then Alice, who wears teal + halo.
await p.goto(`${BASE}/plus`);
await consent(p);
await p.locator('.plus-preview').waitFor(WAIT);
const visitor = await animationsOn(p, '.plus-preview .member-name');
console.log('  a visitor’s preview (nothing chosen yet):', JSON.stringify(visitor));
if (!visitor) throw new Error('the Plus page does not render a preview for a visitor');
if (visitor.some((a) => a.playState === 'running')) {
  throw new Error('a visitor who has chosen nothing is shown a moving preview');
}

const alice = await openCtx({ scheme: 'dark', who: 'alice' });
await alice.p.goto(`${BASE}/plus`);
await consent(alice.p);
await alice.p.locator('.plus-preview').waitFor(WAIT);
// The NAME inside the preview, not the first wear element on the page: the avatar in
// the same preview also carries a wear class (the ring), and measuring whichever came
// first in the DOM is how this assertion read `[]` over a page that was moving.
const previewWear = await alice.p.locator('.plus-preview .member-name').getAttribute('class');
const previewLive = await animationsOn(alice.p, '.plus-preview .member-name');
const ringLive = await animationsOn(alice.p, '.plus-preview .wear-ring');
console.log('  the wearer’s preview:', previewWear, JSON.stringify(previewLive), '· the ring:', JSON.stringify(ringLive));
if (!/wear-/.test(previewWear || '')) throw new Error(`the wearer’s own look is not in the preview: ${previewWear}`);
if (!previewLive?.some((a) => a.playState === 'running')) {
  throw new Error('the Plus preview is not moving — the one place the motion is the product');
}
if (!ringLive?.some((a) => /wear-spin/.test(a.name) && a.playState === 'running')) {
  throw new Error(`the ring is not turning in the preview: ${JSON.stringify(ringLive)}`);
}
await shotOf(alice.p, '.plus-preview', 'premium-4-plus-preview-live');

// ─────────────────────────────────────────────────────────────────────────────
// 4b. The look is worn on EVERY page — the account chip is the one everybody sees
// ─────────────────────────────────────────────────────────────────────────────
say('4b', 'and it is worn on a page that has nothing to do with the look at all');
// The most-seen avatar in the product is the signed-in person's own, in the header of
// every page. It was the one that wore nothing: the call handed the class resolver a
// resolved wear where it expected a row, so the ring silently did not render — and no
// assertion in this file looked at the header. Now one does, on a page about somebody
// else's store.
await alice.p.goto(`${BASE}/s/${ROSTER_SLUG}`);
await consent(alice.p);
const headerChip = await alice.p.locator('.who .avatar').getAttribute('class');
const headerName = await alice.p.locator('.who .who-name').getAttribute('class');
const ringAtRest = await animationsOn(alice.p, '.who .wear-ring');
console.log('  the header    :', headerChip, '·', headerName, '· ring:', JSON.stringify(ringAtRest));
if (!/wear-ring/.test(headerChip || '')) throw new Error(`the account chip in the header wears no ring: ${headerChip}`);
if (!/wear-/.test(headerName || '')) throw new Error('the account name in the header wears nothing');
if (ringAtRest?.some((a) => a.playState === 'running')) {
  throw new Error('the header ring is turning before anybody touched it — motion is on intent');
}
await shotOf(alice.p, '.who', 'premium-9-worn-everywhere');

// ─────────────────────────────────────────────────────────────────────────────
// 5. Reduced motion: the look stays, the movement goes
// ─────────────────────────────────────────────────────────────────────────────
say(5, 'and a system that asks for less motion gets the same look, standing still');
const calm = await openCtx({ scheme: 'dark', motion: 'reduce' });
await openRoster(calm.p, ROSTER_SLUG);
const calmWear = await rosterRow(calm.p, 'Alice').locator('[class*="wear-"]').first().getAttribute('class');
const calmAnim = await animationsOn(calm.p, `.member-roster li:has([class*="wear-"]) [class*="wear-"]`);
const calmPaint = await paintOf(calm.p, `.member-roster li:has([class*="wear-"]) [class*="wear-"]`);
console.log('  the name wears:', calmWear, '· animations:', JSON.stringify(calmAnim));
console.log('  still painted :', calmPaint ? JSON.stringify({ painted: calmPaint.painted, stops: calmPaint.stops, textShadow: calmPaint.textShadow }) : null);
await rosterRow(calm.p, 'Alice').locator('[class*="wear-"]').first().hover();
await calm.p.waitForTimeout(300);
const calmHover = await animationsOn(calm.p, `.member-roster li:has([class*="wear-"]) [class*="wear-"]`);
console.log('  after hover   :', JSON.stringify(calmHover));
if (calmWear !== wear) throw new Error('reduced motion changed WHICH look is worn — that is a value, not a movement');
if (calmAnim?.some((a) => a.playState === 'running') || calmHover?.some((a) => a.playState === 'running')) {
  throw new Error('something is still moving under prefers-reduced-motion: reduce');
}
if (!calmPaint?.textShadow || calmPaint.textShadow === 'none') {
  throw new Error('the glow is gone under reduced motion — the look must survive the setting');
}
// And the Plus page's live preview — the element that DOES move by default — is still
// under the same setting, with its paint intact.
const calmAlice = await openCtx({ scheme: 'dark', motion: 'reduce', who: 'alice' });
await calmAlice.p.goto(`${BASE}/plus`);
await consent(calmAlice.p);
await calmAlice.p.locator('.plus-preview').waitFor(WAIT);
const calmPreview = await animationsOn(calmAlice.p, '.plus-preview .member-name');
const calmRing = await animationsOn(calmAlice.p, '.plus-preview .wear-ring');
const calmPreviewPaint = await paintOf(calmAlice.p, '.plus-preview .member-name');
console.log('  the preview   :', JSON.stringify(calmPreview), '· the ring:', JSON.stringify(calmRing),
  '· painted:', calmPreviewPaint?.painted);
if (calmPreview?.some((a) => a.playState === 'running') || calmRing?.some((a) => a.playState === 'running')) {
  throw new Error('the live preview moves under reduced motion');
}
if (!calmPreviewPaint || calmPreviewPaint.checks.some((c) => c.ratio < 4.5)) {
  throw new Error('the preview’s name lost its contrast under reduced motion');
}
await shotOf(calmAlice.p, '.plus-preview', 'premium-5-reduced-motion');

// The STORE's look under the same setting: the aurora stops and the band keeps its
// gradient, its grain and its mesh — a paying store does not lose what it bought
// because somebody else's device asked for less motion.
await calmAlice.p.goto(`${BASE}/s/${SLUG}`);
await consent(calmAlice.p);
const calmBand = await calmAlice.p.evaluate(() => {
  const band = document.querySelector('.store-head--themed');
  if (!band) return null;
  return {
    grain: /feTurbulence/.test(getComputedStyle(band).backgroundImage),
    mesh: getComputedStyle(band, '::before').backgroundImage.slice(0, 40),
    animations: band.getAnimations({ subtree: true }).map((a) => ({ name: a.animationName, state: a.playState })),
  };
});
console.log('  the band      :', JSON.stringify(calmBand));
if (!calmBand) throw new Error('the storefront has no themed band to check');
if (!calmBand.grain || !/radial-gradient/.test(calmBand.mesh)) {
  throw new Error('reduced motion cost the band its grain or its mesh — the look must survive the setting');
}
if (calmBand.animations.some((a) => a.state === 'running')) {
  throw new Error('the aurora is moving under prefers-reduced-motion: reduce');
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. The store's own mark — the OTHER payer's look
// ─────────────────────────────────────────────────────────────────────────────
say(6, 'a store that pays bytebikri says so on its own header, and a free store says nothing');
await p.goto(`${BASE}/s/${SLUG}`);
await consent(p);
const mark = await p.locator('.plan-mark').first().textContent();
const markTitle = await p.locator('.plan-mark').first().getAttribute('title');
console.log('  the mark      :', JSON.stringify(mark.trim()), '·', JSON.stringify(markTitle.slice(0, 90)));
await shotOf(p, '.store-head', 'premium-6-store-mark');
if (!/plan/i.test(mark)) throw new Error(`the paid store carries no plan mark: ${mark}`);
if (!/bytebikri/.test(markTitle)) throw new Error('the mark does not say who it was paid to');
await p.goto(`${BASE}/s/bob`);
await consent(p);
const free = await p.locator('.plan-mark').count();
console.log('  on the free store:', free, 'mark(s)');
if (free !== 0) throw new Error('a free store carries a plan mark — a mark everybody has means nothing');

// ─────────────────────────────────────────────────────────────────────────────
// 7. What the page SAYS about the two layers
// ─────────────────────────────────────────────────────────────────────────────
say(7, 'the page that used to call one plate “the perk” now names both owners');
await p.goto(`${BASE}/s/${ROSTER_SLUG}#members`);
await consent(p);
const pitch = (await p.locator('#members').textContent()).replace(/\s+/g, ' ');
console.log('  the roster says:', JSON.stringify(pitch.slice(0, 300)));
if (!/chip/i.test(pitch) || !/store/i.test(pitch)) throw new Error('the roster never explains the chip');
if (!/bytebikri/i.test(pitch)) throw new Error('the roster never says where a name’s look comes from');
if (/plate next to a name is the perk/i.test(pitch)) throw new Error('the mixed-up sentence is still on the page');
await shotOf(p, '#members', 'premium-7-roster-copy');

// The Plus page's own two sentences, which is where the person sees the distinction.
const plusCopy = (await p.goto(`${BASE}/plus`).then(() => p.locator('body').textContent())).replace(/\s+/g, ' ');
if (!/not a store’s gift/.test(plusCopy)) throw new Error('the Plus page does not say whose the look is');
if (!/bytebikri does not sell to anybody/.test(plusCopy)) {
  throw new Error('the Plus page does not say the store’s chip is the creator’s own — the one thing '
    + 'bytebikri does not sell');
}
console.log('  the Plus page states both owners: yes');

// ─────────────────────────────────────────────────────────────────────────────
// 8. Every effect is on the page, described, and its name is checked
// ─────────────────────────────────────────────────────────────────────────────
say(8, 'all six effects are offered, each with words for what it does');
await p.goto(`${BASE}/plus`);
await consent(p);
await p.locator('.plus-effects').first().scrollIntoViewIfNeeded();
const choices = await p.locator('.plus-effect-choice').evaluateAll((els) => els.map((el) => ({
  key: el.querySelector('input[name=effect]')?.value,
  label: el.querySelector('strong')?.textContent,
  hint: el.querySelector('.fine')?.textContent,
  demo: el.querySelector('.plus-effect-demo [class*="wear-"]')?.getAttribute('class'),
})));
for (const c of choices) console.log(`  ${(c.key || '?').padEnd(9)} ${c.label.padEnd(10)} ${c.demo || '(plain)'}  ${JSON.stringify(c.hint.slice(0, 62))}`);
if (choices.length !== 6) throw new Error(`the picker offers ${choices.length} effects, not six`);
for (const c of choices) {
  if (!c.key || !c.label || (c.hint || '').length < 40) throw new Error(`effect ${c.key} is not described`);
  // The demo chip wears the effect it names, in the palette being chosen.
  if (c.key === 'solid' ? c.demo?.includes('wear-') : !c.demo?.includes(`wear-${c.key}`)) {
    throw new Error(`the demo for ${c.key} does not wear it: ${c.demo}`);
  }
}
await shotOf(p, '.plus-effects', 'premium-8-effect-picker');

// ─────────────────────────────────────────────────────────────────────────────
// 10. The store's band — the aurora, and the seller seeing it before keeping it
// ─────────────────────────────────────────────────────────────────────────────
say(10, 'a paying store’s band is a mesh of its own colours, and the seller can see it first');
await alice.p.goto(`${BASE}/dashboard/${SLUG}/settings`);
await consent(alice.p);
await alice.p.locator('[data-theme-stage]').waitFor(WAIT);
// One click, the seller's own action: keep the moving palette. The seeder sets it too,
// and this still presses the card rather than trusting that — the route is the thing a
// seller uses, and a walk that assumes a state proves nothing about the button.
if (!(await alice.p.locator('[data-theme-stage-band]').getAttribute('class') || '').includes('store-head--themed')) {
  await alice.p.locator('[data-theme-card="everest"] button[type=submit]').click();
  await alice.p.waitForLoadState('domcontentloaded');
  await consent(alice.p);
  await alice.p.locator('[data-theme-stage]').waitFor(WAIT);
}
const bandPaint = await alice.p.evaluate(() => {
  const band = document.querySelector('[data-theme-stage-band]');
  const cs = getComputedStyle(band);
  const mesh = getComputedStyle(band, '::before');
  const stops = [cs.getPropertyValue('--theme-from').trim(), cs.getPropertyValue('--theme-to').trim()];
  return {
    themed: band.classList.contains('store-head--themed'),
    grain: /feTurbulence/.test(cs.backgroundImage),
    base: /linear-gradient/.test(cs.backgroundImage),
    gradientStops: stops,
    meshImage: mesh.backgroundImage,
    meshColours: [...new Set((mesh.backgroundImage.match(/rgba?\([^)]+\)/g) || []))],
    meshBlur: mesh.filter,
    meshAnimations: band.getAnimations({ subtree: false }).map((a) => a.animationName),
    pseudoAnimations: band.getAnimations({ subtree: true }).map((a) => a.animationName),
  };
});
console.log('  the band      :', JSON.stringify({ themed: bandPaint.themed, grain: bandPaint.grain, base: bandPaint.base, blur: bandPaint.meshBlur }));
console.log('  the mesh      :', bandPaint.meshColours.join(' · '));
console.log('  the motion    :', JSON.stringify(bandPaint.pseudoAnimations ?? bandPaint.meshAnimations));

if (!bandPaint.themed) throw new Error('Alice pays for a theme and the stage is not themed');
if (!bandPaint.grain || !bandPaint.base) throw new Error('the band is missing its grain layer or its base gradient');
// The mesh introduces NO colour of its own: every colour in it is one of the theme's
// two stops (or full transparency). This is the claim the palette test rests on — if a
// tint ever creeps in here, the arithmetic that proves white is readable stops covering
// the band, and this is the assertion that notices.
const allowed = new Set([...bandPaint.gradientStops.map((hex) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}), 'rgba(0, 0, 0, 0)']);
const strangers = bandPaint.meshColours.filter((c) => !allowed.has(c));
if (strangers.length) {
  throw new Error(`the aurora paints colours the palette test never measured: ${strangers.join(', ')}`);
}
// And the mesh is only declared to move for people who have not asked for less.
const aurora = await alice.p.evaluate(() => {
  const band = document.querySelector('[data-theme-stage-band]');
  return band.getAnimations({ subtree: true }).map((a) => ({ name: a.animationName, state: a.playState, target: a.effect?.target?.tagName || a.effect?.pseudoElement || '?' }));
});
console.log('  running       :', JSON.stringify(aurora));
if (!aurora.some((a) => a.name === 'theme-aurora')) {
  throw new Error('the aurora is not running — a paid theme that moves should move in the preview');
}

// Pointing at a card paints the stage, and moving away puts the store back.
const himal = alice.p.locator('[data-theme-card="himal"]');
await himal.hover();
await alice.p.waitForTimeout(250);
const previewed = await alice.p.evaluate(() => ({
  from: document.querySelector('[data-theme-stage-band]').getAttribute('style') || '',
  line: document.querySelector('[data-theme-stage-line]').textContent.replace(/\s+/g, ' ').trim(),
}));
console.log('  on hover      :', JSON.stringify(previewed.from.slice(0, 60)), '·', JSON.stringify(previewed.line.slice(0, 70)));
if (!/6d28d9|--theme-from/.test(previewed.from)) throw new Error('hovering a card does not repaint the stage');
if (!/Previewing/i.test(previewed.line)) throw new Error('the stage does not say that it is previewing');
await shotOf(alice.p, '[data-theme-stage]', 'premium-10-theme-stage');
await alice.p.locator('.theme-grid h1, .theme-grid, body').first().hover({ position: { x: 5, y: 5 } });
await alice.p.mouse.move(5, 5);
await alice.p.waitForTimeout(250);
const restored = await alice.p.evaluate(() => document.querySelector('[data-theme-stage-line]').textContent.replace(/\s+/g, ' ').trim());
console.log('  moved away    :', JSON.stringify(restored.slice(0, 70)));
if (!/Showing/i.test(restored)) throw new Error('the stage does not go back to the store’s own theme');

// ─────────────────────────────────────────────────────────────────────────────
// 11. The shop window — the person’s own name, updating as they choose
// ─────────────────────────────────────────────────────────────────────────────
say(11, 'and the Plus picker shows the member’s own name, in both layers, as they choose');
await alice.p.goto(`${BASE}/plus`);
await consent(alice.p);
await alice.p.locator('[data-look-stage]').waitFor(WAIT);
const before = await alice.p.evaluate(() => ({
  name: document.querySelector('[data-look-name]').textContent.trim(),
  cls: document.querySelector('[data-look-name]').className,
  chip: document.querySelector('[data-look-chip]')?.textContent.trim(),
  line: document.querySelector('[data-look-line]').textContent.replace(/\s+/g, ' ').trim(),
}));
console.log('  the stage     :', JSON.stringify(before));
if (!before.name || /^Aa$/.test(before.name)) throw new Error('the stage does not show the member’s own name');
if (!before.chip) throw new Error('the stage does not show a store’s chip beside the name — the whole point of the round');
const expectedName = (await alice.p.locator('.who .who-name').textContent()).trim().toLowerCase();
if (!before.name.toLowerCase().includes(expectedName)) {
  throw new Error(`the stage shows "${before.name}" for an account named "${expectedName}"`);
}

// Choosing paints it, with no round trip: the page must not navigate.
await alice.p.locator('[data-effect-key="prism"] input[type=radio]').check();
await alice.p.waitForTimeout(200);
const after = await alice.p.evaluate(() => ({
  url: location.pathname,
  cls: document.querySelector('[data-look-name]').className,
  line: document.querySelector('[data-look-line]').textContent.replace(/\s+/g, ' ').trim(),
  chip: document.querySelector('[data-look-chip]')?.textContent.trim(),
}));
console.log('  after choosing:', JSON.stringify(after));
if (after.url !== '/plus') throw new Error('choosing an effect navigated — the preview is a round trip');
if (!/wear-prism/.test(after.cls)) throw new Error(`the stage did not repaint: ${after.cls}`);
if (!/Prism/.test(after.line)) throw new Error(`the caption did not follow: ${after.line}`);
if (!after.chip) throw new Error('repainting the stage dropped the store’s chip');
await shotOf(alice.p, '[data-look-stage]', 'premium-11-look-stage');

// A palette change repaints the ring and the name together — read from the stage's own
// custom properties, which is what the avatar, the ring and the name all paint from.
await alice.p.locator('[data-plate-key="rose"] input[type=radio]').check();
await alice.p.waitForTimeout(200);
const repainted = await alice.p.evaluate(() => {
  const stage = document.querySelector('[data-look-stage]');
  const cs = getComputedStyle(stage);
  return { ink: cs.getPropertyValue('--plate-ink').trim(), line: document.querySelector('[data-look-line]').textContent.replace(/\s+/g, ' ').trim() };
});
const roseInk = await alice.p.evaluate(() => getComputedStyle(document.querySelector('[data-plate-key="rose"]')).getPropertyValue('--plate-ink').trim());
console.log('  the palette   :', repainted.ink, '·', JSON.stringify(repainted.line.slice(0, 60)));
if (repainted.ink !== roseInk) throw new Error(`the palette did not reach the stage: ${repainted.ink} vs ${roseInk}`);
if (!/Rose/i.test(repainted.line)) throw new Error('the caption does not name the chosen palette');

// And putting the choice back leaves the demo where the seeder left it.
await alice.p.locator('[data-effect-key="halo"] input[type=radio]').check();
await alice.p.locator('[data-plate-key="teal"] input[type=radio]').check();
await alice.p.locator('form.plus-look button[type=submit]').click();
await alice.p.waitForLoadState('domcontentloaded');
console.log('  saved back    :', (await alice.p.locator('[data-look-line]').textContent()).replace(/\s+/g, ' ').trim().slice(0, 60));

const errors = [...dark.p.errors, ...light.p.errors, ...calm.p.errors,
  ...alice.p.errors, ...calmAlice.p.errors];
console.log('\nconsole errors:', errors.length ? JSON.stringify(errors, null, 1) : 'none');
if (errors.length) throw new Error(`${errors.length} console error(s)`);

await dark.ctx.close(); await light.ctx.close(); await calm.ctx.close();
await alice.ctx.close(); await calmAlice.ctx.close();
await browser.close();
console.log(`\nwalk complete — 11 screenshots in ${OUT}`);
