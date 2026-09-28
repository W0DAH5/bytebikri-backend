/**
 * The Golden Buddha scene, walked in a real browser (PREMIUM_COSMETICS.md §15, Phase C).
 *
 *   node ci/eyes/cosmetic-scene-walk.mjs [slug] [outDir]
 *
 * The unit tests prove the card's HTML and the stylesheet agree. This walk proves
 * the RENDERED thing: that the scene reads as a small world pinned to the card's
 * right edge, with real motion from real layers, at real sizes, with real names,
 * in both motion modes — and that exactly one scene exists per eligible card.
 *
 *   * the scene is there in four state layers, every asset loaded, all webp;
 *   * the world overflows the card edge by a fixed amount and the overflow does
 *     not drift while the scene is alive (fixed geometry + animated layers);
 *   * no word on the card is drawn under the world's box — identity first;
 *   * one scene per card, zero stray scenes anywhere else on the page
 *     (the duplicate-render check, PREMIUM_COSMETICS.md §16);
 *   * the character rhythms are the LAYER animations (breathe / eat / blink) —
 *     not a scale or translate on the whole artwork;
 *   * desktop, tablet, mobile widths — the small screen simplifies
 *     (embers/sparkle gone) and nothing clips;
 *   * a long username beside the scene — the stress case for the text axis;
 *   * reduced motion — every layer parks and the still card still reads as gold;
 *   * a failed state asset removes its layer only; a failed base removes the scene;
 *   * the picker — the worn motif is pre-checked, locked ones say where they unlock.
 *
 * The only fixture moved is alice's display name (the long-username case), restored
 * in a `finally`. Everything else is read as the demo left it.
 */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { sessionFor, consent } from './lib.mjs';

const SLUG = process.argv[2] || 'nima-crafts';
const OUT = process.argv[3] || 'docs/evidence/cosmetic-walk';
const BASE = process.env.EYES_BASE || 'http://127.0.0.1:3100';
mkdirSync(OUT, { recursive: true });

const say = (n, s) => console.log(`\n[${n}] ${s}`);
const findings = [];
const check = (ok, what) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) findings.push(what);
};

const { one, query, close } = await import('../../app/src/db.js');

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/tmp/chromium', args: ['--no-sandbox'],
});

/**
 * What the card says about its own scene, measured in the page. The world's
 * box is measured where the browser actually put it, so a position change in
 * the stylesheet cannot drift from this check.
 */
const measureCard = (page, nth = 0) => page.evaluate((nth) => {
  const card = document.querySelectorAll('.member-roster .member, .member-list .member, table .member')[nth]
    ?? document.querySelectorAll('.member')[nth];
  if (!card) return null;
  const box = card.getBoundingClientRect();
  const layer = card.querySelector('.mascot-layer');
  const world = card.querySelector('.mascot-world');
  const base = layer?.querySelector('.mascot-state');
  const parts = [...card.querySelectorAll('.member-name, .store-chip, .member-state, .member-since')]
    .map((c) => ({ cls: c.className.split(' ')[0], r: c.getBoundingClientRect() }));
  const overlap = [];
  for (let i = 0; i < parts.length; i += 1) {
    for (let j = i + 1; j < parts.length; j += 1) {
      const a = parts[i].r; const b = parts[j].r;
      const x = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const y = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (x > 1 && y > 1) overlap.push(`${parts[i].cls} over ${parts[j].cls} (${Math.round(x)}×${Math.round(y)}px)`);
    }
  }
  let spill = null;
  let textUnderWorld = null;
  if (world) {
    const wr = world.getBoundingClientRect();
    spill = {
      right: Math.round((wr.right - box.right) * 10) / 10,
      top: Math.round((wr.top - box.top) * 10) / 10,
      bottom: Math.round((wr.bottom - box.bottom) * 10) / 10,
      w: Math.round(wr.width), h: Math.round(wr.height),
    };
    for (const p of parts) {
      const r = p.r;
      const x = Math.min(r.right, wr.right) - Math.max(r.left, wr.left);
      const y = Math.min(r.bottom, wr.bottom) - Math.max(r.top, wr.top);
      if (x > 2 && y > 2) textUnderWorld = { cls: p.cls, x: Math.round(x), y: Math.round(y) };
    }
  }
  const states = layer
    ? [...layer.querySelectorAll('.mascot-state')].map((img) => ({
      cls: img.className, src: img.getAttribute('src'),
      loaded: img.naturalWidth > 0,
      anim: getComputedStyle(img).animationName,
      transform: getComputedStyle(img).transform,
    }))
    : null;
  // The parts: the plate and the layers laid over it. `nat` is the artwork's
  // own size, which is how the image-quality check knows whether the card is
  // asking for more detail than the file has.
  const partList = layer
    ? [...layer.querySelectorAll('.mascot-part')].map((img) => ({
      cls: img.className.split(' ').pop(),
      src: img.getAttribute('src'),
      loaded: img.naturalWidth > 0,
      nat: [img.naturalWidth, img.naturalHeight],
      anim: getComputedStyle(img).animationName,
      opacity: getComputedStyle(img).opacity,
    }))
    : null;
  // The two joints. A part that only fades would pass every other check here;
  // these are the numbers that say the arm and the grapes actually turn.
  const joint = (sel) => {
    const el = layer ? layer.querySelector(sel) : null;
    if (!el) return null;
    const cs = getComputedStyle(el);
    return { anim: cs.animationName, transform: cs.transform, origin: cs.transformOrigin, dur: cs.animationDuration };
  };
  const partsCount = layer
    ? { aura: layer.querySelectorAll('.mascot-aura').length, embers: layer.querySelectorAll('.mascot-embers').length,
        sparkle: layer.querySelectorAll('.mascot-sparkle').length, imgs: layer.querySelectorAll('img').length,
        canvases: layer.querySelectorAll('canvas').length }
    : null;
  const anim = (sel, pseudo) => {
    const el = layer ? layer.querySelector(sel) : null;
    return el ? getComputedStyle(el, pseudo).animationName : null;
  };
  return {
    box: { w: Math.round(box.width * 10) / 10, h: Math.round(box.height * 10) / 10 },
    hasLayer: Boolean(layer),
    motif: layer?.getAttribute('data-motif') ?? null,
    states, parts: partList, joints: { arm: joint('.mascot-arm'), grapes: joint('.mascot-grapes') },
    world: world ? { w: Math.round(world.getBoundingClientRect().width), h: Math.round(world.getBoundingClientRect().height) } : null,
    spill,
    overlap, textUnderWorld, partsCount,
    animAura: anim('.mascot-aura'),
    animGloss: anim('.mascot-world', '::before'),
    glossDur: layer ? getComputedStyle(layer.querySelector('.mascot-world'), '::before').animationDuration : null,
    embersDisplay: layer ? getComputedStyle(layer.querySelector('.mascot-embers')).display : null,
    sparkleDisplay: layer ? getComputedStyle(layer.querySelector('.mascot-sparkle')).display : null,
  };
}, nth);

/** The whole page's scene inventory — the duplicate-render check. */
const pageSceneAudit = (page) => page.evaluate(() => ({
  layers: document.querySelectorAll('.mascot-layer').length,
  cardsWithScene: [...document.querySelectorAll('.member')].filter((m) => m.querySelector('.mascot-layer')).length,
  scenesOutsideCards: [...document.querySelectorAll('.mascot-layer')].filter((l) => !l.closest('.member')).length,
  imgs: document.querySelectorAll('.mascot-state').length,
  partImgs: document.querySelectorAll('.mascot-part').length,
  canvases: document.querySelectorAll('.mascot-layer canvas').length,
}));

async function openRoster(width, height, reduced = false, session = null) {
  const ctx = await browser.newContext({
    viewport: { width, height },
    reducedMotion: reduced ? 'reduce' : 'no-preference',
    deviceScaleFactor: 1,
    ...(session ? { storageState: session } : {}),
  });
  const p = await ctx.newPage();
  // The consent helper can race the page's own redirect; one retry settles it.
  for (let attempt = 0; ; attempt += 1) {
    try {
      await p.goto(`${BASE}/s/${SLUG}`);
      await consent(p);
      await p.goto(`${BASE}/s/${SLUG}`);
      break;
    } catch (err) {
      if (attempt > 2) throw err;
    }
  }
  await p.waitForSelector('.member-roster .member');
  return { ctx, p };
}

/** The index of the card that wears the motif (alice in the demo roster). */
const sceneIndex = (p) => p.evaluate(() =>
  [...document.querySelectorAll('.member-roster .member')].findIndex((m) => m.querySelector('.mascot-layer')));

const row = await one(`select p.display_name, p.email from profiles p
  where p.plus_motif = 'buddha-gold' and p.email = 'alice@bytebikri.local'`);
if (!row) {
  console.error('alice has no buddha-gold motif — run ci/demo-state.mjs first');
  process.exit(2);
}
const nameBack = row.display_name;
let long = false;
try {
  // ── 1. the scene, at the card's own size ──────────────────────────────────────────────────────
  say(1, 'the scene renders as a plate with parts, every asset loaded and cheap');
  let { p } = await openRoster(1440, 900);
  const i0 = await sceneIndex(p);
  check(i0 >= 0, 'some card on the roster wears a scene');
  let m = await measureCard(p, i0);
  console.log(`  card ${i0}: ${m.box.w}×${m.box.h}px · motif=${m.motif} · ${m.parts?.length ?? 0} parts · world ${m.world?.w}×${m.world?.h}`);
  check(m.motif === 'buddha-gold', 'it is the golden buddha, not a placeholder key');
  // The plate is the figure with the arm taken out; the parts are laid over it.
  // SIX of them. The anchor joined the rig with the region split — it is what
  // the limb's edge slides over at the joint — and this count (and the two
  // below) predated it: a walk that still expects the old rig reports the new
  // one as broken.
  check(m.parts?.length === 7, `a plate and six parts (chest, belly, blink, anchor, arm, grapes), found ${m.parts?.length}`);
  check(m.parts?.some((x) => x.cls === 'mascot-part--plate'), 'the plate is in the card');
  check(m.parts?.every((x) => x.loaded), 'every part actually loaded');
  check(m.parts?.every((x) => /\.webp$/.test(x.src ?? '')), 'every part is the optimised webp, not a master png');
  // THE MOTION HAS TO BE REAL. The brief refuses a cross-fade and a moved PNG;
  // what it asks for is the arm turning at the shoulder and the grapes swinging
  // on their stem, which is a rotate() on a layer with a joint for an origin.
  check(m.joints?.arm?.anim === 'buddha-reach', 'the arm carries the reach animation');
  check(m.joints?.grapes?.anim === 'buddha-grapes', 'the grapes carry a swing of their own');
  const parts = m.parts ?? [];
  check(parts.find((x) => x.cls === 'mascot-part--chest')?.anim === 'buddha-breathe',
    'the chest breathes on its own clock');
  // The handover is deliberately NOT a fourth clock: the pose must change at
  // the bottom of the arm's own swing, or the two arms share a frame and the
  // step reads as a glitch. Same duration as the arm, by design.
  check(parts.find((x) => x.cls === 'mascot-part--belly')?.anim === 'buddha-belly',
    'the lowered pose arrives on the handover animation');
  check(m.joints?.arm?.dur === '24s', `the arm's cycle is 24s (found ${m.joints?.arm?.dur})`);
  // The origin is written as a percentage of the artwork, so the browser
  // reports it in the box's pixels; the check is the fraction that matters —
  // (268,146) of 768x512 is 34.90% x 28.52%, and (370,45) is 48.18% x 8.79%.
  const frac = (origin) => {
    const [x, y] = (origin ?? '').split(' ').map(parseFloat);
    return { x: x / (m.world?.w || 1), y: y / (m.world?.h || 1) };
  };
  const aF = frac(m.joints?.arm?.origin); const gF = frac(m.joints?.grapes?.origin);
  const near = (v, want) => Math.abs(v - want) < 0.02;
  console.log(`  pivots — arm ${aF.x.toFixed(3)}/${aF.y.toFixed(3)} (want 0.349/0.285) · grapes ${gF.x.toFixed(3)}/${gF.y.toFixed(3)} (want 0.482/0.088)`);
  check(near(aF.x, 0.349) && near(aF.y, 0.285),
    `the arm pivots at the shoulder (268,146 of 768x512), not the centre of the picture`);
  check(near(gF.x, 0.482) && near(gF.y, 0.088),
    'the grapes pivot at the stem (370,45 of 768x512)');
  // A rotation, and nothing else. The brief forbids moving/scaling the
  // picture; a joint that quietly scaled or slid would pass every other check
  // here, so this reads the matrix itself: for a pure rotation a=d, b=-c, and
  // the basis stays unit length.
  const isPureRotation = (t) => {
    if (!t || t === 'none') return true;
    const n = t.match(/matrix\(([^)]+)\)/);
    if (!n) return false;
    const [a, b, c, d] = n[1].split(',').map(Number);
    return Math.abs(a - d) < 0.02 && Math.abs(b + c) < 0.02 && Math.abs(a * a + b * b - 1) < 0.04;
  };
  check(isPureRotation(m.joints?.arm?.transform), `the arm turns without scaling or sliding (${m.joints?.arm?.transform})`);
  check(isPureRotation(m.joints?.grapes?.transform), `the grapes swing without scaling (${m.joints?.grapes?.transform})`);
  // §21: the artwork must be bigger than the box it is drawn in — the browser
  // must not be inventing detail. 172 CSS px at 2x wants 344 real pixels.
  const plateNat = parts.find((x) => x.cls === 'mascot-part--plate')?.nat ?? [0, 0];
  const want = (m.world?.w ?? 0) * 2;
  console.log(`  artwork ${plateNat[0]}px wide for a ${m.world?.w}px box at 2x (needs ${want}px)`);
  check(plateNat[0] >= want, `the artwork has 2x headroom, ${plateNat[0]} >= ${want}`);
  check(m.partsCount && m.partsCount.canvases === 0, 'no canvas — the effects are CSS');
  check(m.partsCount && m.partsCount.embers === 2 && m.partsCount.sparkle === 1 && m.partsCount.aura === 1,
    'the particle budget: two embers, one sparkle, one aura');
  await p.locator('.member-roster').first().screenshot({ path: `${OUT}/01-scene-desktop.png` });

  // ── 2. the scene is a layer: the card's box does not care whether it is there ─────────────────
  say(2, 'hide the scene — the card must be exactly the same size');
  const hidden = await p.evaluate((nth) => {
    const card = document.querySelectorAll('.member-roster .member')[nth];
    const layer = card.querySelector('.mascot-layer');
    const before = card.getBoundingClientRect();
    layer.style.display = 'none';
    const after = card.getBoundingClientRect();
    layer.style.display = '';
    return { before, after };
  }, i0);
  const sameBox = hidden.before.width === hidden.after.width && hidden.before.height === hidden.after.height
    && hidden.before.top === hidden.after.top && hidden.before.left === hidden.after.left;
  check(sameBox, 'box-identical with the scene present or removed (layout is not the scene’s business)');

  // ── 3. fixed geometry: the overflow is real and it does not drift ────────────────────────────
  say(3, 'the world spills past the card edge by a fixed, undrifting amount');
  check(m.spill && m.spill.right > 0,
    `the world overflows the card's right edge (${m.spill?.right}px) — a room, not a tile`);
  const t0 = await measureCard(p, i0);
  await p.waitForTimeout(3200); // through part of the breathing + gloss cycles
  const t1 = await measureCard(p, i0);
  const drift = Math.abs(t0.spill.right - t1.spill.right) + Math.abs(t0.spill.top - t1.spill.top)
    + Math.abs(t1.box.w - t0.box.w) + Math.abs(t1.box.h - t0.box.h);
  check(drift < 1, `overflow and card box did not drift over 3.2 s of live animation (drift ${drift.toFixed(2)}px)`);

  // ── 4. identity is primary: no word under the world ──────────────────────────────────────────
  say(4, 'no word on the card is drawn under the world');
  check(m.overlap.length === 0,
    `no text-on-text overlap${m.overlap.length ? `: ${m.overlap.join('; ')}` : ''}`);
  check(!m.textUnderWorld,
    `no text intersects the world's box${m.textUnderWorld ? ` (${m.textUnderWorld.cls} ${m.textUnderWorld.x}×${m.textUnderWorld.y}px)` : ''}`);

  // ── 5. one scene per card, zero strays ───────────────────────────────────────────────────────
  say(5, 'exactly one scene per eligible card, none anywhere else on the page');
  const audit = await pageSceneAudit(p);
  console.log(`  layers=${audit.layers} cardsWithScene=${audit.cardsWithScene} outsideCards=${audit.scenesOutsideCards} imgs=${audit.imgs} canvases=${audit.canvases}`);
  check(audit.scenesOutsideCards === 0, 'no scene renders outside a card (no page-level duplicate)');
  check(audit.layers === audit.cardsWithScene, 'one scene per wearing card — no double render');
  check(audit.cardsWithScene === 1, 'in this roster exactly one member wears the scene');

  // ── 6. the hierarchy of motion, present and calm ─────────────────────────────────────────────
  say(6, 'the rhythms are running on their own clocks — aura, gloss, shimmer, particles');
  check(m.animAura && m.animAura !== 'none', `the aura breathes (animation: ${m.animAura})`);
  check(m.animGloss && m.animGloss !== 'none', `the gloss sweeps (animation: ${m.animGloss})`);
  console.log(`  gloss cycle: ${m.glossDur}`);
  check(parseFloat(m.glossDur ?? '0') >= 20, 'the gloss is a long cycle with a long pause — not a sweep machine');
  const shimmer = await p.evaluate(() => {
    const el = document.querySelector('.member-roster .member .mascot-shimmer');
    return el ? { anim: getComputedStyle(el).animationName, dur: getComputedStyle(el).animationDuration } : null;
  });
  check(shimmer && shimmer.anim !== 'none', `the light crosses the gold (animation: ${shimmer?.anim} ${shimmer?.dur})`);

  // ── 7. widths: tablet and mobile simplify, nothing clips ─────────────────────────────────────
  say(7, 'narrower viewports: the scene shrinks and the effects thin out');
  for (const [w, h, tag] of [[1024, 768, 'tablet'], [390, 844, 'mobile']]) {
    const { p: p2 } = await openRoster(w, h);
    const i2 = await sceneIndex(p2);
    const m2 = await measureCard(p2, i2);
    const clipped = await p2.evaluate(() => {
      const bad = [];
      for (const c of document.querySelectorAll('.member-roster .member .member-name, .member-roster .member .member-since')) {
        if (c.scrollWidth > c.clientWidth + 1) bad.push(c.className.split(' ')[0]);
      }
      return bad;
    });
    const a2 = await pageSceneAudit(p2);
    console.log(`  ${w}px ${tag}: ${m2.box.w}×${m2.box.h}px · embers=${m2.embersDisplay} · sparkle=${m2.sparkleDisplay} · world=${m2.spill?.w}×${m2.spill?.h}`);
    check(m2.parts?.every((s) => s.loaded), `${tag}: every part still loads`);
    check(m2.overlap.length === 0, `${tag}: no text overlap${m2.overlap.length ? `: ${m2.overlap.join('; ')}` : ''}`);
    check(!m2.textUnderWorld, `${tag}: no text under the world${m2.textUnderWorld ? ` (${m2.textUnderWorld.cls})` : ''}`);
    check(clipped.length === 0, `${tag}: no clipped name or date${clipped.length ? `: ${clipped.join(', ')}` : ''}`);
    check(a2.scenesOutsideCards === 0 && a2.layers === a2.cardsWithScene, `${tag}: still one scene per card`);
    if (w <= 560) {
      check(m2.embersDisplay === 'none' && m2.sparkleDisplay === 'none',
        `${tag}: embers and sparkle are gone at small size — the scene keeps only aura + character`);
    }
    await p2.locator('.member-roster').first().screenshot({ path: `${OUT}/02-scene-${tag}.png` });
    await p2.context().close();
  }

  // ── 8. the long username beside the scene ────────────────────────────────────────────────────
  say(8, 'a long username beside the scene — the text axis under stress');
  const longName = 'a-really-very-long-username-that-wraps-onto-two-lines';
  await query(`update profiles set display_name = $2 where email = $1`, [row.email, longName]);
  long = true;
  const { p: pLong } = await openRoster(1440, 900);
  const iL = await sceneIndex(pLong);
  const mL = await measureCard(pLong, iL);
  console.log(`  long name: ${mL.box.w}×${mL.box.h}px · overlap=${mL.overlap.length} · textUnderWorld=${JSON.stringify(mL.textUnderWorld)}`);
  check(mL.overlap.length === 0, `long name: no text overlap${mL.overlap.length ? `: ${mL.overlap.join('; ')}` : ''}`);
  check(!mL.textUnderWorld, 'long name: nothing under the world — the scene yields to the words');
  const clippedLong = await pLong.evaluate(() =>
    [...document.querySelectorAll('.member-roster .member .member-name')]
      .filter((c) => c.scrollWidth > c.clientWidth + 1).length);
  check(clippedLong === 0, 'long name: the name wraps rather than clipping');
  await pLong.locator('.member-roster').first().screenshot({ path: `${OUT}/03-scene-longname.png` });
  await pLong.context().close();

  // ── 9. reduced motion: the scene stands, still the scene ─────────────────────────────────────
  say(9, 'prefers-reduced-motion: the world stands still and still reads as gold');
  const { p: pRed } = await openRoster(1440, 900, true);
  const iR = await sceneIndex(pRed);
  const mR = await measureCard(pRed, iR);
  check(mR.hasLayer && mR.states?.every((s) => s.loaded), 'the artwork and the tier survive — nothing information-bearing is motion');
  const parked = await pRed.evaluate(() => {
    const layer = document.querySelector('.member-roster .member .mascot-layer');
    if (!layer) return null;
    return {
      states: [...layer.querySelectorAll('.mascot-part')].map((img) => ({
        cls: img.className.split(' ').pop(),
        anim: getComputedStyle(img).animationName,
        opacity: getComputedStyle(img).opacity,
      })),
      aura: getComputedStyle(layer.querySelector('.mascot-aura')).animationName,
      gloss: getComputedStyle(layer.querySelector('.mascot-world'), '::before').animationName,
      shimmer: getComputedStyle(layer.querySelector('.mascot-shimmer')).opacity,
    };
  });
  console.log(`  parked: ${JSON.stringify(parked)}`);
  const plateStill = parked?.states?.find((s) => s.cls === 'mascot-part--plate');
  // The still is the RAISED pose parked: the plate, the limb, its fruit and the
  // joint it swings from are all part of that pose. What must be hidden is the
  // alternative states (chest, belly, blink), which are poses the still is not.
  const othersHidden = parked?.states?.filter((s) => s.cls !== 'mascot-part--plate' && s.cls !== 'mascot-part--arm' && s.cls !== 'mascot-part--berries' && s.cls !== 'mascot-part--anchor')
    ?.every((s) => parseFloat(s.opacity) === 0);
  check(plateStill && plateStill.anim === 'none', 'the plate stands, animation parked');
  check(othersHidden, 'the pose layers are parked at opacity 0 — the still is the plate in its own pose');
  check(parked?.states?.every((s) => s.anim === 'none'), 'no part is left animating under reduced motion');
  check(parked?.aura === 'none' && parked?.gloss === 'none', 'aura and gloss are parked too');
  check(parseFloat(parked?.shimmer ?? '0') > 0, 'the light rests as a static band across the coins — nothing disappears');
  await pRed.locator('.member-roster').first().screenshot({ path: `${OUT}/04-scene-reduced-motion.png` });
  await pRed.context().close();

  // ── 10. a failed state asset: the scene keeps standing; a failed base: the card stands ───────
  say(10, 'a missing part loses that motion; a missing plate is no scene');
  const { p: pF } = await openRoster(1440, 900);
  const iF = await sceneIndex(pF);
  await pF.evaluate((nth) => {
    const card = document.querySelectorAll('.member-roster .member')[nth];
    const chest = card.querySelector('.mascot-part--chest');
    chest.src = '/img/cosmetics/definitely-missing.webp';
  }, iF);
  const stateGone = await pF.waitForFunction(
    (nth) => !document.querySelectorAll('.member-roster .member')[nth]?.querySelector('.mascot-part--chest'),
    iF, { timeout: 3000 },
  ).then(() => true).catch(() => false);
  const afterState = await measureCard(pF, iF);
  check(stateGone, 'a part that cannot load removes itself — the scene still stands');
  check(afterState.hasLayer && afterState.parts?.length === 6, 'the plate, the arm and the rest remain');
  await pF.evaluate((nth) => {
    const card = document.querySelectorAll('.member-roster .member')[nth];
    card.querySelector('.mascot-part--plate').src = '/img/cosmetics/definitely-missing.webp';
  }, iF);
  const layerGone = await pF.waitForFunction(
    (nth) => !document.querySelectorAll('.member-roster .member')[nth]?.querySelector('.mascot-layer'),
    iF, { timeout: 3000 },
  ).then(() => true).catch(() => false);
  check(layerGone, 'the missing base artwork removed the whole scene — no broken-image icon');

  // ── 11. the owner's member list: the scene travels with the person, the others stay plain ────
  say(11, 'the owner’s list: the scene travels with the person, the other cards stay untouched');
  const sesO = await sessionFor(browser, 'nima', { base: BASE });
  const pBctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, storageState: sesO });
  const pB = await pBctx.newPage();
  const settle = async (pg, url) => {
    for (let attempt = 0; ; attempt += 1) {
      try {
        await pg.goto(url);
        await consent(pg);
        await pg.goto(url);
        break;
      } catch (err) {
        if (attempt > 2) throw err;
      }
    }
  };
  await settle(pB, `${BASE}/dashboard/${SLUG}/members`);
  await pB.waitForSelector('.member');
  const ownerCards = await pB.evaluate(() => [...document.querySelectorAll('.member')].map((m) => ({
    name: m.querySelector('.member-name')?.textContent ?? '?',
    cls: m.className,
    hasLayer: Boolean(m.querySelector('.mascot-layer')),
    motif: m.querySelector('.mascot-layer')?.getAttribute('data-motif') ?? null,
  })));
  console.log('  ' + ownerCards.map((c) => `${c.name}${c.hasLayer ? ` (scene:${c.motif})` : ''}`).join('   '));
  const plain = ownerCards.find((c) => !c.hasLayer);
  const sceneCard = ownerCards.find((c) => c.hasLayer);
  const aB = await pageSceneAudit(pB);
  check(Boolean(plain) && !/member--mascot/.test(plain.cls), 'a member without the cosmetic is exactly the card it has always been');
  check(sceneCard?.motif === 'buddha-gold', 'the scene travels with the person onto the seller’s own list, from the same row');
  check(aB.scenesOutsideCards === 0 && aB.layers === aB.cardsWithScene, 'owner list: one scene per wearing card, no strays');
  await pB.screenshot({ path: `${OUT}/06-owner-list.png`, fullPage: true }).catch(() => {});
  await pBctx.close();

  // ── 12. the picker: what is worn is checked, what is locked says where it unlocks ─────────────
  say(12, 'the plus page: the worn motif is checked, the out-of-reach ones are locked');
  const ses = await sessionFor(browser, nameBack, { base: BASE });
  const pPctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, storageState: ses });
  const pP = await pPctx.newPage();
  await settle(pP, `${BASE}/plus`);
  await pP.waitForSelector('.plus-effects, .plus-swatches');
  const pick = await pP.evaluate(() => {
    const labels = [...document.querySelectorAll('label.plus-mark-label')]
      .filter((l) => l.getAttribute('data-mark-key'));
    return labels.map((l) => ({
      key: l.getAttribute('data-mark-key'),
      checked: l.querySelector('input')?.checked,
      disabled: l.querySelector('input')?.disabled,
      text: l.innerText.replace(/\s+/g, ' ').slice(0, 80),
    }));
  });
  console.log('  ' + pick.map((x) => `${x.key}:${x.checked ? '✓' : '·'}${x.disabled ? '🔒' : ''}`).join('  '));
  const worn = pick.find((x) => x.key === 'buddha-gold');
  check(worn?.checked === true, 'the worn motif is pre-checked');
  const unlocked = pick.filter((x) => x.disabled);
  for (const u of unlocked) {
    check(/unlocks with/i.test(u.text), `locked ${u.key} says where it unlocks: "${u.text.slice(-40)}"`);
  }
  await pP.screenshot({ path: `${OUT}/05-picker.png`, fullPage: true });
  await pP.context().close();
} finally {
  if (long) await query(`update profiles set display_name = $2 where email = $1`, [row.email, nameBack]);
  await close();
  await browser.close();
  console.log('\nfixture (display name) is back where it was found');
}

console.log(`\nwalk complete — ${findings.length} finding(s)`);
process.exit(findings.length ? 1 : 0);
