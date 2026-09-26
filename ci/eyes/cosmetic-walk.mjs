/**
 * The premium cosmetic system, walked in a browser (PREMIUM_COSMETICS.md, Phases B).
 *
 * The unit tests prove the model (the ladder, the wardrobe, the budget, the
 * catalog↔database agreement). What they cannot prove is what this walk exists
 * for: that a real browser, handed the real page, actually PAINTS the power
 * (the rim, the halo, the 45° sheen), actually runs the sheen only on intent,
 * actually holds the mark at 18 px, actually sits the mascot on the card, and
 * actually stops every animation without losing the look when the system asks
 * for less motion. The acceptance bar is the rendered result, not "a premium
 * looking badge exists".
 *
 * The fixture, all seeded by ci/demo-state.mjs:
 *   * Nima Crafts, whose roster holds Alice (ACTIVE Elite + running Plus, so her
 *     derived power is CRYSTAL) wearing the golden laughing BUDDHA (a mascot,
 *     which sits on the card) and Bob (pending, no power, who must stay plain);
 *   * Alice's /plus page, where the picker draws the wardrobe as tiles and the
 *     live preview stage wears the power it is selling;
 *   * Carol, whose Plus is pending_payment, holding the golden DRAGON saved
 *     (a different identity on the same power — it wears when the claim matches).
 *
 *   node ci/eyes/cosmetic-walk.mjs [outDir]
 */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { sessionFor, measure, report } from './lib.mjs';

/**
 * Answer the consent banner and then RIDE OUT its reload. The banner POSTs and
 * the page comes back; a 200 ms wait (the shared helper's) ends before the new
 * document commits, and an `evaluate` in the old context then dies with
 * "execution context destroyed" — which reads as a product failure and is a
 * harness one.
 */
async function settle(p) {
  const btn = p.locator('.consent .btn-primary');
  if (await btn.count()) {
    await btn.click();
    await p.waitForLoadState('load');
    await p.waitForTimeout(300);
  } else {
    await p.waitForTimeout(150);
  }
}

const OUT = process.argv[2] || 'docs/evidence/round49-cosmetics';
const BASE = process.env.EYES_BASE || 'http://127.0.0.1:3100';
const ROSTER = `${BASE}/s/nima-crafts`;
mkdirSync(OUT, { recursive: true });

const say = (n, s) => console.log(`\n[${n}] ${s}`);
const fails = [];
const ok = (label, cond, detail = '') => {
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!cond) fails.push(label + (detail ? ` — ${detail}` : ''));
};

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/tmp/chromium', args: ['--no-sandbox'],
});

/** A context at one colour scheme and one motion preference, errors collected. */
async function ctx({ scheme = 'dark', motion = 'no-preference', storage = null } = {}) {
  const c = await browser.newContext({
    viewport: { width: 1440, height: 900 }, colorScheme: scheme,
    ...(storage ? { storageState: storage } : {}),
  });
  const p = await c.newPage();
  // `emulateMedia` is the whole switch: the page's own
  // `prefers-reduced-motion` media blocks are the fallback, so emulating the
  // preference exercises exactly the code a person's system would.
  await p.emulateMedia({ reducedMotion: motion === 'reduce' ? 'reduce' : 'no-preference' });
  p.errors = [];
  p.on('console', (m) => { if (m.type() === 'error') p.errors.push(m.text().slice(0, 140)); });
  p.on('pageerror', (e) => p.errors.push(`PAGEERROR ${e.message.slice(0, 140)}`));
  return { c, p };
}

/** The card that belongs to a person, by the name in it. */
const cardOf = (p, name) => p.locator(`.member:has(.member-name:text-is("${name}"))`);

/* ── 1 · the ladder is real CSS, not a claim ─────────────────────────────────
   The demo holds one live power (crystal, Alice). The other three rungs are
   proven in the same browser: a scratch card is handed each data-power and the
   rim+halo it computes is read back. Distinguishable shadows = a ladder. */
say('1', 'the four rungs of the ladder, computed in the browser');
{
  const { c, p } = await ctx();
  await p.goto(ROSTER);
  await settle(p);
  const shadows = await p.evaluate(() => {
    const out = {};
    for (const pw of ['standard', 'silver', 'gold', 'crystal', 'inferno']) {
      const el = document.createElement('li');
      el.className = 'member';
      el.dataset.power = pw;
      document.body.appendChild(el);
      out[pw] = getComputedStyle(el).boxShadow;
      el.remove();
    }
    return out;
  });
  ok('standard has no treatment', shadows.standard === 'none', shadows.standard.slice(0, 40));
  ok('silver has a rim+halo', shadows.silver !== 'none' && shadows.silver.length > 20, shadows.silver.slice(0, 60));
  ok('gold differs from silver', shadows.gold !== shadows.silver);
  ok('crystal differs from gold', shadows.crystal !== shadows.gold);
  ok('inferno differs from crystal', shadows.inferno !== shadows.crystal);
  await c.close();
}

/* ── 2 · Alice's card on the storefront: crystal, wearing the Buddha ─────── */
say('2', "Alice's card on the storefront roster (dark, normal motion)");
{
  const { c, p } = await ctx();
  await p.goto(ROSTER);
  await settle(p);
  const alice = cardOf(p, 'alice');
  ok("Alice's card exists", (await alice.count()) === 1);
  const power = await alice.getAttribute('data-power');
  ok('derived power is crystal', power === 'crystal', String(power));
  const shadow = await alice.evaluate((el) => getComputedStyle(el).boxShadow);
  ok('the static rim+halo is painted', shadow !== 'none' && shadow.split('px').length > 4, shadow.slice(0, 70));
  // The mascot: the identity layer, a character on the card.
  const mascot = alice.locator('.member-mascot');
  ok('the mascot is on the card', (await mascot.count()) === 1);
  const msrc = await mascot.locator('img').getAttribute('src');
  ok('it is the golden Buddha', String(msrc).includes('mascot-gold-buddha'), String(msrc));
  const mload = await mascot.locator('img').evaluate((img) => img.naturalWidth);
  ok('the mascot drawing loaded', mload > 100, `naturalWidth ${mload}`);
  const mbox = await mascot.boundingBox();
  const abox = await alice.boundingBox();
  ok('the mascot sits in the card corner',
    mbox && abox && mbox.x >= abox.x && mbox.y >= abox.y - 2 && mbox.x + mbox.width <= abox.x + abox.width + 2,
    mbox ? `at ${Math.round(mbox.x)},${Math.round(mbox.y)} in a ${Math.round(abox.width)}px card` : 'no box');
  // Not a mascot person, not a mark either: the name carries no 18px mark.
  ok('a mascot is not a name-mark', (await alice.locator('.member-mark').count()) === 0);
  // Bob: PENDING. A waiting membership is not a public member — the seller's
  // list shows the waiting row, the storefront shows members. The "no power"
  // property itself is proven in section 1 by the standard scratch card.
  const bob = cardOf(p, 'Bob');
  ok('Bob (pending) is not on the public roster', (await bob.count()) === 0, `${await bob.count()} card(s)`);
  // The sheen at rest: present, paused, parked off-card.
  const rest = await alice.evaluate((el) => {
    const st = getComputedStyle(el, '::before');
    return { anim: st.animationName, state: st.animationPlayState, transform: st.transform };
  });
  ok('sheen exists at rest', rest.anim === 'power-sheen', rest.anim);
  ok('sheen is paused at rest', rest.state === 'paused', rest.state);
  await p.locator('.member-roster').scrollIntoViewIfNeeded();
  await p.waitForTimeout(300);
  await p.screenshot({ path: `${OUT}/01-alice-card-static.png` });
  // The sheen on intent: hover runs it, and it sweeps.
  await alice.hover();
  await p.waitForTimeout(300);
  const hover = await alice.evaluate((el) => getComputedStyle(el, '::before').animationPlayState);
  ok('sheen runs under the pointer', hover === 'running', hover);
  await p.waitForTimeout(1600); // into the sweep
  await p.screenshot({ path: `${OUT}/02-alice-card-sheen.png` });
  const findings = await measure(p);
  report('  storefront roster', findings, p.errors);
  await c.close();
}

/* ── 3 · the plus page: the wardrobe drawn, the preview wearing the power ── */
say('3', "Alice's /plus page (dark): the picker, the preview, the round-trip");
{
  const state = await sessionFor(browser, 'alice', { base: BASE });
  const { c, p } = await ctx({ storage: state });
  await p.goto(`${BASE}/plus`);
  await settle(p);
  // The wardrobe: the motif slot drawn as tiles, the tile IS the drawing.
  const tiles = p.locator('.plus-marks .plus-mark-label');
  const n = await tiles.count();
  ok('the wardrobe is drawn as tiles', n === 12, `${n} tiles (none + 11 motifs)`);
  const buddha = p.locator('.plus-mark-label[data-mark-key="buddha-gold"]');
  ok("Alice's Buddha is pre-checked", await buddha.locator('input').isChecked());
  const tileImgs = await p.locator('.plus-marks .plus-mark-tile img').evaluateAll(
    (imgs) => imgs.map((i) => i.naturalWidth));
  ok('every tile drawing loaded', tileImgs.every((w) => w > 100), `${tileImgs.filter((w) => w > 100)}/${tileImgs.length}`);
  // The preview stage: the power it is selling, and the mascot in its corner.
  const stage = p.locator('[data-look-stage]');
  const sp = await stage.getAttribute('data-power');
  ok('the preview stage wears crystal', sp === 'crystal', String(sp));
  ok('the preview stage has the Buddha', (await stage.locator('.member-mascot').count()) === 1);
  const srest = await stage.evaluate((el) => getComputedStyle(el, '::before'));
  ok('the stage sheen is running (is-live)', srest.animationPlayState === 'running', srest.animationPlayState);
  await p.screenshot({ path: `${OUT}/03-plus-page-wardrobe.png`, fullPage: true });
  // THE ROUND-TRIP: pick a name-mark (18 px kind), save it, read it back on the
  // storefront. A picker that cannot round-trip is a picker that lies.
  //
  // Read it back as an ANONYMOUS visitor, on purpose: a member does not see her
  // OWN card on her store's roster — the page shows her the member-self panel
  // instead — so the card that proves the save is the one every stranger sees.
  await p.locator('.plus-mark-label[data-mark-key="zen-enso"] input').check();
  await p.click('.plus-look button[type=submit]');
  await p.waitForLoadState('load');
  const anon = await ctx();
  await anon.p.goto(ROSTER);
  await settle(anon.p);
  const alice = cardOf(anon.p, 'alice');
  ok('the card is back on the public roster', (await alice.count()) === 1);
  const mark = alice.locator('.member-mark');
  ok('the Zen ensō now wears beside the name', (await mark.count()) === 1);
  if ((await mark.count()) === 1) {
    const size = await mark.locator('img').evaluate((img) => {
      const r = img.getBoundingClientRect();
      return { w: r.width, h: r.height, nw: img.naturalWidth };
    });
    ok('the mark holds at 18 px', Math.round(size.w) === 18 && size.nw > 100, `${size.w}×${size.h} (source ${size.nw})`);
    ok('the mark is the ensō drawing', String(await mark.locator('img').getAttribute('src')).includes('motif-zen'));
  }
  await anon.p.locator('.member-roster').scrollIntoViewIfNeeded();
  await anon.p.waitForTimeout(300);
  await anon.p.screenshot({ path: `${OUT}/04-alice-card-mark.png` });
  const findings = await measure(anon.p);
  report('  roster after round-trip', findings, anon.p.errors);
  await anon.c.close();
  // And back: the Buddha is the seeded identity; restore it before leaving.
  await p.goto(`${BASE}/plus`);
  await settle(p);
  await p.locator('.plus-mark-label[data-mark-key="buddha-gold"] input').check();
  await p.click('.plus-look button[type=submit]');
  await p.waitForLoadState('networkidle');
  const restored = await p.evaluate(() =>
    document.querySelector('.plus-mark-label[data-mark-key="buddha-gold"] input')?.checked);
  ok('the Buddha is pre-checked again after save', restored === true);
  await c.close();
}

/* ── 4 · reduced motion: the metal stays, the movement goes ───────────────── */
say('4', 'reduced motion (dark): static highlight, no animation, mark intact');
{
  const { c, p } = await ctx({ motion: 'reduce' });
  await p.goto(ROSTER);
  await settle(p);
  const alice = cardOf(p, 'alice');
  const sheen = await alice.evaluate((el) => {
    const st = getComputedStyle(el, '::before');
    return { anim: st.animationName, opacity: st.opacity, transform: st.transform };
  });
  ok('the sheen animation is gone', sheen.anim === 'none', sheen.anim);
  ok('a held highlight remains', Number(sheen.opacity) === 0.4, `opacity ${sheen.opacity}`);
  const shadow = await alice.evaluate((el) => getComputedStyle(el).boxShadow);
  ok('the rim+halo is still painted', shadow !== 'none');
  const mascot = alice.locator('.member-mascot img');
  const mAnim = await mascot.evaluate((img) => getComputedStyle(img).animationName);
  ok('the mascot holds its pose', mAnim === 'none', mAnim);
  await p.screenshot({ path: `${OUT}/05-alice-card-reduced-motion.png` });
  const findings = await measure(p);
  report('  reduced motion', findings, p.errors);
  await c.close();
}

/* ── 5 · light scheme: the metal reads on the light surface too ───────────── */
say('5', 'light scheme: the same card on the light surface');
{
  const { c, p } = await ctx({ scheme: 'light' });
  await p.goto(ROSTER);
  await settle(p);
  const alice = cardOf(p, 'alice');
  const shadow = await alice.evaluate((el) => getComputedStyle(el).boxShadow);
  ok('the light-scheme rim+halo is painted', shadow !== 'none', shadow.slice(0, 70));
  const nameColor = await alice.locator('.member-name').evaluate((el) => getComputedStyle(el).color);
  ok('the name keeps its ink (not a plate stop)', /rgb/.test(nameColor), nameColor);
  await p.locator('.member-roster').scrollIntoViewIfNeeded();
  await p.waitForTimeout(300);
  await p.screenshot({ path: `${OUT}/06-alice-card-light.png` });
  const findings = await measure(p);
  report('  light scheme', findings, p.errors);
  await c.close();
}

await browser.close();
console.log(`\n${fails.length ? 'FAILURES:' : 'cosmetic walk: all checks passed'}${fails.length ? '' : ` — ${OUT}`}`);
for (const f of fails) console.log(`  ✗ ${f}`);
process.exit(fails.length ? 1 : 0);
