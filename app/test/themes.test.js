/**
 * Storefront themes.
 *
 * The capability `plans.capabilities.can_theme` has been `true` on Store and Pro
 * since migration 0001 and nothing in the product has ever read it — the plans sold
 * a storefront look for three migrations with no look behind it. These tests are what
 * makes it safe to finally ship one, and the first of them is the whole reason the
 * feature is a fixed list rather than a colour picker.
 *
 * 1. WHITE ON THE BAND, AT BOTH ENDS AND THE MIDDLE. A themed band is an OPAQUE
 *    gradient with white text on it, which is what makes the arithmetic tractable:
 *    the band is the same in day and night, so each palette is measured once, and
 *    white-on-colour and colour-as-ink-on-white are the same ratio — one number
 *    governs every word in the band in both directions. The middle is measured
 *    because that is where the eye actually rests, and a gradient whose ends pass
 *    while its middle fails is exactly the failure a two-point check misses.
 *
 *    The floor asserted is 5.5:1 rather than 4.5:1, deliberately: the secondary ink
 *    in the band is 92% white, and the margin is what lets it clear 4.5:1 with room
 *    to spare. A palette fails this test, it does not get a smaller font size.
 *
 * 2. THE INVERTED CONTROLS ARE THE SAME RATIO. Pills and the follow button become
 *    white surfaces with the palette's deep stop as ink. That is the same number as
 *    the band text, so nothing inside the band opens a second contrast question —
 *    asserted, because the temptation is to give them a translucent plate.
 *
 * 3. MOTION IS OPT-IN, and asserted on the stylesheet rather than on intent: every
 *    drifting rule has to live inside `prefers-reduced-motion: no-preference`. This
 *    is the pattern the whole product uses, and it is the one Discord's own
 *    Nameplates FAQ points users at.
 *
 * 4. THE GATE IS THE PLAN'S, and it is read, not restated. If somebody copies a
 *    capability check into a second place, the two can drift; this reads the one.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  THEMES, THEME_KEYS, BAND_ALPHA, BAND_INK, BAND_NOISE, NO_THEME,
  canTheme, themeDraft, themeStyle, motionNote,
} from '../src/themes.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

// ── colour maths, kept in the test on purpose ───────────────────────────────────
// A contrast helper living in `src/` is a helper that can be imported by the thing it
// is supposed to be checking. This one exists to fail.

function hexRgb(hex) {
  const h = String(hex).replace('#', '');
  const n = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16));
}

/** `over` at alpha `a`: what the eye actually sees. */
function composite(fg, bg, a) {
  const [r1, g1, b1] = hexRgb(fg);
  const [r2, g2, b2] = hexRgb(bg);
  return [r1, g1, b1].map((c, i) => Math.round(c * a + [r2, g2, b2][i] * (1 - a)));
}

function luminance([r, g, b]) {
  const lin = (c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function ratio(a, b) {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

/**
 * Every point of a two-stop gradient a reader can land on — sampled, not guessed.
 *
 * Three points (the two ends and the middle) was enough while the band was one
 * linear gradient. It is not enough now: the band's aurora is painted out of the same
 * two stops in soft radial blobs, so a reader can land anywhere along the
 * interpolation, at any blend the browser's compositing produces. Sampling it is what
 * makes "the mesh adds no colour" a checked claim rather than a comment.
 */
function gradientPoints(from, to, steps = 20) {
  const a = hexRgb(from);
  const b = hexRgb(to);
  const out = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    out.push([i === 0 ? 'from' : i === steps ? 'to' : `at ${Math.round(t * 100)}%`,
      a.map((c, k) => Math.round(c * (1 - t) + b[k] * t))]);
  }
  return out;
}

/** What the grain layer is allowed to do to the surface, composited in. */
const lift = (rgb, share) => rgb.map((c) => Math.round(c * (1 - share) + 255 * share));
const asHex = (rgb) => `#${rgb.map((c) => c.toString(16).padStart(2, '0')).join('')}`;

test('white clears 5.5:1 on every palette, at every point of its gradient', () => {
  const failures = [];
  for (const key of THEME_KEYS) {
    const t = THEMES[key];
    // The grain is the ONE layer that lightens the surface, and it is bounded by
    // BAND_NOISE — so every palette is measured with that much white already
    // composited over it. A palette that only passes when the noise is ignored is a
    // palette that fails on the screen it ships to.
    for (const [where, rgb] of gradientPoints(t.from, t.to)) {
      const r = ratio(hexRgb(BAND_INK), lift(rgb, BAND_NOISE));
      if (r < 5.5) failures.push(`${key} (${where}): ${r.toFixed(2)}:1 with the grain`);
    }
  }
  assert.deepEqual(failures, [],
    'a palette whose band text falls below 5.5:1 anywhere a reader can land is not offered. '
    + 'That margin is what lets the 92% secondary ink clear 4.5:1 too — this is why the '
    + 'feature is a fixed list and not a colour picker.');
});

test('the 92% ink in the band still clears the body floor', () => {
  const failures = [];
  for (const key of THEME_KEYS) {
    const t = THEMES[key];
    for (const [where, rgb] of gradientPoints(t.from, t.to)) {
      const surface = lift(rgb, BAND_NOISE);
      const ink = composite(BAND_INK, asHex(surface), BAND_ALPHA);
      const r = ratio(ink, surface);
      if (r < 4.5) failures.push(`${key} (${where}): ${r.toFixed(2)}:1 with the grain`);
    }
  }
  assert.deepEqual(failures, [],
    'the tagline and the counts are painted at 92% white, and they are the lines that carry '
    + 'the store\'s actual facts — they get the same floor as body text, not a lighter one '
    + 'because they are secondary.');
});

test('a pill or a button inside the band inverts to the same ratio, never a translucent plate', () => {
  // White surface, the palette's deep stop as ink — which is white-on-that-stop read
  // the other way round, so it cannot be worse than the band text and does not need a
  // second measurement. Asserted on the stylesheet, because this is the kind of rule
  // that gets "softened" later by somebody who wants the pill to feel less loud.
  const css = read('public/styles.css');
  const band = css.slice(css.indexOf('.store-head--themed {'), css.indexOf('/* Choosing the look'));
  assert.ok(/\.store-head--themed :is\(\.pill, \.btn\)/.test(band), 'the band styles its pills and its button');
  assert.ok(/background: var\(--theme-ink, #fff\)/.test(band), 'and paints them a solid white surface');
  assert.ok(/color: var\(--theme-from/.test(band), 'with the palette ink on top');
  const block = band.slice(band.indexOf('.store-head--themed :is(.pill, .btn)'));
  assert.ok(!/color-mix|rgba\(255/.test(block.slice(0, block.indexOf('}'))),
    'no translucency in that rule: a plate mixed toward the gradient is a ratio '
    + 'nobody measured, sitting on a gradient that moves');
});

test('the palettes are a curated list, and every one of them is named for a place', () => {
  assert.ok(THEME_KEYS.length >= 6, 'six is the researched number of choices for a look (Gumroad ships exactly six fonts)');
  assert.ok(THEME_KEYS.length <= 9, 'and a list long enough to be a project is a list nobody picks from');
  assert.ok(!THEME_KEYS.includes(NO_THEME), 'the default look is not a palette — it is the absence of one');
  for (const key of THEME_KEYS) {
    const t = THEMES[key];
    assert.match(t.from, /^#[0-9a-f]{6}$/i, `${key}.from is a hex`);
    assert.match(t.to, /^#[0-9a-f]{6}$/i, `${key}.to is a hex`);
    assert.notEqual(t.from, t.to, `${key} is a gradient, so two stops, not one colour twice`);
    assert.ok(t.label && t.label.length <= 16 && t.note && t.note.length <= 120,
      `${key} is named and explained in a line a seller will read`);
  }
});

test('the ink and the muted ink on the page are the ones the tests composite', () => {
  // Two numbers in two places each — a stylesheet and this file — and they are checked
  // rather than trusted because both are contrast decisions wearing the clothes of
  // styling decisions. Raising the muted ink to "make the small print pop" is a
  // contrast change, and it should have to walk past this test to happen.
  const css = read('public/styles.css');
  assert.ok(css.includes(`--theme-ink: ${BAND_INK}`), '--theme-ink is defined in :root, because an undefined property is dropped silently');
  assert.match(css, new RegExp(`--theme-muted: rgba\\(255, 255, 255, ${BAND_ALPHA}\\)`), 'and the muted ink is the alpha this file composites at');
  assert.ok(css.includes('var(--theme-ink, #fff)'), 'and the fallbacks in the rules agree with the tokens');
});

test('themeStyle emits the two properties the stylesheet reads, and nothing else', () => {
  const style = themeStyle('everest');
  assert.ok(style.includes(`--theme-from:${THEMES.everest.from}`));
  assert.ok(style.includes(`--theme-to:${THEMES.everest.to}`));
  assert.ok(!style.includes('--theme-ink') && !style.includes('--theme-muted'),
    'the ink does not vary by palette: it is the same white on all six, which is what makes one ratio per stop enough');
  assert.ok(!/[<>"]/.test(style), 'a style attribute is one attribute; nothing in it may close it');
  assert.equal(themeStyle(NO_THEME), '', 'the default look sets no properties at all');
  assert.equal(themeStyle('not-a-theme'), '', 'and neither does a key that does not exist');
});

test('a theme key that is not on the list is refused rather than stored', () => {
  assert.deepEqual(themeDraft('himal').value, 'himal');
  assert.equal(themeDraft(NO_THEME).value, null, 'the way back is a real choice');
  assert.equal(themeDraft('').ok, false);
  assert.equal(themeDraft('crimson-that-does-not-exist').error, 'theme-unknown');
  assert.equal(themeDraft('#ff0000').ok, false, 'free-form colour is exactly what this feature refuses');
  assert.equal(themeDraft('<script>').ok, false);
});

test('the capability is read from the plans, and only the paid ones have it', async () => {
  // store.js loads the pool, and the pool refuses to exist under `node --test` unless
  // it points at a test database. This test only reads PLANS, but it still has to say so.
  process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:55432/bytebikri_test';
  const { PLANS } = await import('../src/store.js');
  assert.equal(canTheme(PLANS.free.capabilities), false, 'Free keeps the storefront every store has today');
  assert.equal(canTheme(PLANS.store.capabilities), true);
  assert.equal(canTheme(PLANS.pro.capabilities), true);
  // This is the assertion that would have caught the gap this whole round exists to
  // close: `can_theme` was true on the paid plans and NOTHING read it, so the plans
  // page sold a storefront look with no look behind it. If somebody ever sells the
  // capability before the feature, this is where it shows up.
  assert.equal(canTheme({}), false, 'no capabilities means no theme, never a default yes');
});

test('the page tells a seller whether their shop will move', () => {
  const moving = THEME_KEYS.find((k) => THEMES[k].animated);
  const still = THEME_KEYS.find((k) => !THEMES[k].animated);
  assert.ok(moving && still, 'both kinds exist, so the sentence has something to distinguish');
  assert.match(motionNote(moving), /less motion/i, 'the moving themes say they stop for anybody who asks');
  assert.match(motionNote(still), /does not move|still/i);
  assert.match(motionNote(NO_THEME), /does not move/i);
});

test('every drifting rule lives inside a reduced-motion guard', () => {
  const css = read('public/styles.css');
  const names = css.match(/@keyframes\s+([a-z0-9-]+)/gi).map((m) => m.split(/\s+/)[1]);
  const drifting = names.filter((n) => /drift|shine|halo|pulse/.test(n));
  assert.ok(drifting.length >= 1, 'the moving themes exist, so at least one animation does');
  for (const name of drifting) {
    // Find the block that USES it, and require the guard to be in it.
    const uses = css.split('\n').map((l, i) => [l, i]).filter(([l]) => l.includes(`animation: ${name} `));
    assert.ok(uses.length, `${name} is used somewhere`);
    for (const [line, idx] of uses) {
      assert.ok(line.includes('animation:'), 'sanity');
      const before = css.split('\n').slice(0, idx).join('\n');
      const guardAt = before.lastIndexOf('prefers-reduced-motion: no-preference');
      const closeAt = before.lastIndexOf('@media');
      assert.ok(guardAt > closeAt, `${name} is declared under a no-preference guard — motion is opt-in, never the default`);
    }
  }
});

test('the aurora is painted out of the theme’s own stops, behind the words', () => {
  const css = read('public/styles.css');
  const base = css.slice(css.indexOf('.store-head--themed {'), css.indexOf('.store-head--themed :is(.lede'));
  // The base is still the opaque gradient the contrast arithmetic governs, and the
  // grain is the only extra layer on it — nothing else may join the background stack
  // without being measured.
  assert.ok(base.includes('linear-gradient(135deg, var(--theme-from'), 'the base gradient is the two stops');
  const layers = base.slice(base.indexOf('background-image:'), base.indexOf('background-size:'));
  // Counted as top-level layers rather than by every `url(` in the text: the grain IS
  // a data URI and contains one of its own (`filter='url(#n)'`), so a naive count
  // reads three layers where there are two.
  const stack = layers.slice(layers.indexOf(':') + 1).split(/,(?=\s*\n?\s*(?:url|linear|radial|conic|repeating|-webkit))/);
  assert.equal(stack.length, 2, `the band’s own background is the grain and the base, not ${stack.length} layers`);
  assert.ok(/feTurbulence/.test(stack[0]), 'the grain is an inline SVG turbulence');
  assert.ok(/linear-gradient\(135deg, var\(--theme-from/.test(stack[1]), 'and under it the opaque base');

  // The grain's share in the stylesheet IS the share the test proved above. Two
  // places by necessity (CSS cannot import JavaScript); the drift is what is tested.
  const grain = Number((layers.match(/opacity='([\d.]+)'/) || [])[1]);
  assert.ok(grain > 0, 'the grain layer has no opacity in it');
  assert.equal(grain, BAND_NOISE, 'the grain spends more light than the palette test proved');

  // The mesh: two layers, both out of the theme's own stops, both behind the content.
  const mesh = css.slice(css.indexOf('.store-head--themed::before'),
    css.indexOf('@keyframes theme-aurora'));
  assert.ok(/radial-gradient/.test(mesh), 'the mesh is built from radial gradients');
  assert.ok(!/255|#fff|white/i.test(mesh.replace(/--theme-(from|to)[^;]*/g, '')),
    'the mesh must not lighten the band with a colour of its own — that colour is unmeasured');
  assert.ok(/z-index: -1/.test(mesh), 'the mesh sits behind the words');
  assert.ok(/blur\(/.test(mesh), 'and is soft, which is what reads as light rather than as a shape');

  // Motion: transform only, never a colour, and only for people who have not asked
  // for less. A keyframe that touched colour could walk a word off its ratio.
  const keyframes = css.slice(css.indexOf('@keyframes theme-aurora'), css.indexOf('@keyframes theme-aurora') + 200);
  assert.ok(keyframes.includes('transform'), 'the aurora moves by transform, not by repainting');
  assert.ok(!/color|background|opacity|text-shadow|filter/.test(keyframes.split('{').slice(1).join('{').split('}')[0]),
    'and touches nothing but the transform');
  assert.ok(!/@keyframes theme-drift/.test(css), 'the full-layer repaint is gone, not left beside the new one');
  // Declared inside a no-preference block — and it has to be the block that WRAPS it,
  // not merely one somewhere earlier in the file. Searching backwards from the
  // declaration is the only reading that cannot be satisfied by an unrelated media
  // query further up.
  const declares = css.indexOf('.store-head--themed::before { animation: theme-aurora');
  const gate = css.lastIndexOf('@media (prefers-reduced-motion: no-preference)', declares);
  assert.ok(declares > 0 && gate > 0 && gate < declares, 'the aurora is declared outside any motion gate');
  const meshRule = css.indexOf('.store-head--themed::before,\n.store-head--themed::after');
  assert.ok(meshRule > 0 && meshRule < gate,
    'and the gate wraps the animation rather than the layer: a reduce user still gets the mesh, still');
});

test('the band is opaque, and the theme reaches nothing under it', () => {
  const css = read('public/styles.css');
  const band = css.slice(css.indexOf('.store-head--themed {'), css.indexOf('/* Choosing the look'));
  assert.ok(/linear-gradient\(135deg, var\(--theme-from/.test(band),
    'the band is a gradient of the two stops');
  assert.ok(/background-blend-mode: soft-light, normal/.test(band),
    'and the grain is blended over it rather than painted on top of the words');
  assert.ok(!/color-mix\(in srgb, var\(--theme-from[^)]*transparent\)/.test(band.slice(0, band.indexOf('}'))),
    'opaque: a wash would have to be checked against two surfaces and would be invisible on both');
  // What stays out of the band is the point. A theme that could reach a file card's
  // ink is a theme that can break a contrast test nobody re-ran for it.
  assert.ok(!/\.asset-card|\.btn-\.|grid-assets|\.member-name\b|\.member-plate/.test(band),
    'the band stops at the band: files, cards and member plates keep the product colours');
  // And the motion is decoration-only: a moving string of characters is the one
  // animation that makes a heading hard to read. Whatever the band animates, it is
  // never one of its own words, and no keyframe it uses touches a colour.
  const declared = [...band.matchAll(/animation:\s*([\w-]+)/g)].map((m) => m[1]);
  assert.ok(declared.length, 'the band animates nothing at all');
  for (const name of new Set(declared)) {
    const from = css.indexOf(`@keyframes ${name} {`);
    assert.ok(from > 0, `${name} is used but never declared`);
    const body = css.slice(from, from + 300);
    assert.ok(/transform/.test(body), `${name} does not move anything by transform`);
    assert.ok(!/\bcolor\b|text-shadow|background|opacity|filter/.test(body.slice(body.indexOf('{') + 1).split('}')[0]),
      `${name} touches something other than the transform`);
  }
  assert.ok(!/\.store-head--themed[^{]*\b(h1|h2|\.lede|\.store-meta|a)\b[^{]*\{[^}]*animation/.test(band),
    'no word inside the band is animated');
});
