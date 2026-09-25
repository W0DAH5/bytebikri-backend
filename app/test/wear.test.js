/**
 * The wear: two layers, two payers, and the rule that keeps them apart.  npm test
 *
 * This file exists because of a real defect, and the defect was a sentence before it
 * was code. The storefront's member list said *"the plate next to a name is the
 * perk"* while the plate could come from either of two unrelated places — the
 * creator's tier, or the member's own ByteBikri Plus — and the renderer gave them to
 * one element, so a Plus member's name REPLACED the store's chip on the store's own
 * roster. Two payers, one element, wrong one wins.
 *
 * So the assertions here are about ownership and about paint:
 *
 *   1. BOTH LAYERS RENDER, ALWAYS. A member with Plus still carries the creator's
 *      chip; a member without it still carries the store's colour on their name.
 *      Neither layer can impersonate the other, because each is built from its own
 *      source and neither branch removes the other.
 *   2. ONE MAP FROM EFFECT TO CLASS. An effect key that no longer exists renders as
 *      the plain look rather than as an unstyled name, which is what a chain of
 *      `if`s in a view could not promise.
 *   3. THE PAINT IS CHECKED AT ITS WORST STOP. A gradient name is text, so it is
 *      painted from palette INKS — never from the plate stops, which are built to
 *      sit UNDER white text (#4f46e5 as a name on a near-black page is ~2.9:1).
 *      Every stop and every mixed stop is composited against both surfaces here.
 *   4. THE SHARE IN THE STYLESHEET IS THE SHARE PROVED HERE. The mix ratio lives in
 *      `--wear-ink-share` in the stylesheet and as a number in `src/plus.js`; this
 *      test reads the file and refuses to let the two drift, because a percentage
 *      edited in a stylesheet is exactly the kind of change no test would notice.
 *   5. MOTION IS OPT-IN AND REDUCED MOTION WINS. Every moving effect's animation is
 *      declared `paused`, started only by hover/focus/the one live preview, and the
 *      reduced-motion block comes after the running state.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const {
  EFFECTS, EFFECT_KEYS, WEAR_CLASS, WEAR_CLASSES, wearClass, composeName, plusWear, plateOf,
  WEAR_OWNER_LINE, CHIP_OWNER_LINE, EFFECT_MIX_SHARE,
} = await import('../src/plus.js');
const { ACCENTS, ACCENT_KEYS, plateStyle } = await import('../src/memberships.js');
const views = await import('../src/views.js');

const CSS = readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8');

// ── the surfaces, read from the stylesheet rather than restated ─────────────────
// These are the pages a painted name actually sits on: `--surface-base` in the night
// theme, and its light-theme override. Reading them here rather than typing two hex
// values matters, because a darker page is EASIER for light ink and a lighter one is
// easier for dark ink — a test that hard-codes an easier surface than the product
// paints is a test that passes over a failure.
function surfaceFrom(css, { scheme }) {
  const scope = scheme === 'light'
    ? css.slice(css.indexOf('@media (prefers-color-scheme: light)'))
    : css;
  const varMatch = scope.match(/--surface-base:\s*var\((--[\w-]+)\)/);
  if (varMatch) {
    const value = css.match(new RegExp(`${varMatch[1]}:\\s*(#[0-9a-fA-F]{3,8})`));
    if (value) return value[1];
  }
  const direct = scope.match(/--surface-base:\s*(#[0-9a-fA-F]{3,8})/);
  assert.ok(direct, `--surface-base is not a plain colour for the ${scheme} theme`);
  return direct[1];
}

const SURFACES = { dark: surfaceFrom(CSS, { scheme: 'dark' }), light: surfaceFrom(CSS, { scheme: 'light' }) };

function hexRgb(hex) {
  const h = String(hex).replace('#', '');
  const n = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16));
}
function rgbHex([r, g, b]) {
  return `#${[r, g, b].map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`;
}
/** `color-mix(in srgb, a share%, b)`, exactly as the stylesheet asks the browser for. */
function mix(a, b, share) {
  const A = hexRgb(a); const B = hexRgb(b);
  return rgbHex(A.map((c, i) => c * share + B[i] * (1 - share)));
}
function luminance(hex) {
  const [r, g, b] = hexRgb(hex);
  const lin = (c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

// ── 1. two layers, composed ───────────────────────────────────────────────────

test('a member with Plus wears their own name AND the store’s chip — neither replaces the other', () => {
  const tier = { tier_no: 1, name: 'Friend', accent: 'teal' };
  const withPlus = composeName({
    plus: { plus_active: true, nameplate: 'rose', plus_effect: 'prism' }, tier,
  });
  assert.equal(withPlus.name.effect, 'prism');
  assert.equal(withPlus.name.palette, 'rose', 'the name uses the wearer’s palette');
  assert.equal(withPlus.name.className, 'wear-prism');
  assert.equal(withPlus.chip.label, 'Friend');
  assert.equal(withPlus.chip.palette, 'teal', 'and the chip uses the store’s');
  assert.equal(withPlus.chip.style, 'solid');

  // Without Plus the name still renders — in the store's palette, plainly.
  const without = composeName({ plus: null, tier });
  assert.equal(without.name, null, 'no wear to render');
  assert.deepEqual(without.chip, withPlus.chip, 'and the chip is identical either way');
});

test('the chip is the store’s, and only the top tier glints', () => {
  const one = composeName({ tier: { tier_no: 1, name: 'Friend', accent: 'teal' } });
  const two = composeName({ tier: { tier_no: 2, name: 'Elite', accent: 'violet' } });
  assert.equal(one.chip.style, 'solid');
  assert.equal(two.chip.style, 'gradient', 'the top tier is the one that wears the sheen');
  assert.equal(plateStyle(2), 'gradient');
  assert.equal(plateStyle(1), 'solid');

  // A tier with no name falls back rather than rendering an empty chip.
  assert.equal(composeName({ tier: { tier_no: 2 } }).chip.label, 'Elite');
  assert.equal(composeName({ tier: { tier_no: 1 } }).chip.label, 'Member');
  // A palette nobody offers is the default one — same rule as the plates.
  assert.equal(composeName({ tier: { tier_no: 1, accent: 'chartreuse' } }).chip.palette, 'indigo');
  // And no tier means no chip: a store cannot mark somebody who holds nothing.
  assert.equal(composeName({ tier: null }).chip, null);
  assert.equal(composeName({}).chip, null);
});

test('the account chip in the header wears the ring, on every page that has a header', () => {
  // This is the avatar a person sees most often — their own, on every page — and it
  // was the one that wore nothing, because the call handed `plusAvatarClass` an
  // already-resolved wear instead of the row and the null propagated silently.
  // `views.layout` is the real renderer, so this is the page's own markup.
  const html = views.layout({
    title: 'Alice', user: { id: '1', display_name: 'Alice', email: 'alice@test.local', nameplate: 'teal', plus_effect: 'halo', plus_status: 'active', plus_period_end: new Date(Date.now() + 86400000) },
    body: '<p>x</p>', consent: null,
  });
  assert.match(html, /class="avatar plus-avatar wear-ring"/, 'the header avatar wears the ring');
  assert.match(html, /class="who-name wear-halo"/, 'and the name beside it wears the effect');
  // Without an arrangement, nothing is worn: the same page, plainly.
  const plain = views.layout({
    title: 'Nima', user: { id: '2', display_name: 'Nima', email: 'nima@test.local', plus_status: null, plus_period_end: null, nameplate: 'teal', plus_effect: 'halo' },
    body: '<p>x</p>', consent: null,
  });
  assert.doesNotMatch(plain, /wear-ring|wear-halo/, 'a lapsed person wears nothing in the header either');
});

test('a lapsed arrangement wears nothing, and its palette is kept for when it returns', () => {
  const lapsed = { nameplate: 'rose', plus_effect: 'prism', plus_status: 'active', plus_period_end: new Date(Date.now() - 86400000) };
  assert.equal(plusWear(lapsed), null, 'the clock decides, not a stored status');
  const composed = composeName({ plus: lapsed, tier: { tier_no: 1, name: 'Friend', accent: 'teal' } });
  assert.equal(composed.name, null);
  assert.ok(composed.chip, 'and the store’s chip does not disappear with it');
});

// ── 2. one map from effect to class ───────────────────────────────────────────

test('every effect has a class, an unknown effect is the plain look, and the list is closed', () => {
  assert.equal(EFFECT_KEYS.length, 6);
  assert.deepEqual(EFFECT_KEYS, Object.keys(EFFECTS));
  for (const key of EFFECT_KEYS) {
    const cls = wearClass(key);
    assert.equal(cls, WEAR_CLASS[key], `${key} maps through the table`);
    if (cls) assert.ok(CSS.includes(`.${cls}`), `${cls} has a rule in the stylesheet`);
  }
  assert.equal(wearClass('sparkle'), null, 'an effect nobody offers renders as plain');
  assert.equal(wearClass('solid'), null, 'and so does the plain one itself — it has no class to carry');
  assert.equal(WEAR_CLASSES.length, EFFECT_KEYS.length - 1, 'every effect but the plain one has a class');
});

test('every effect says whether it moves, and only the ones that do are animated', () => {
  for (const key of EFFECT_KEYS) {
    assert.equal(typeof EFFECTS[key].moves, 'boolean', `${key} does not say whether it moves`);
    assert.ok(EFFECTS[key].hint.length > 40, `${key} has no hint a person could act on`);
    if (EFFECTS[key].moves) {
      assert.match(EFFECTS[key].hint, /hover|moving|drifts|travel/i,
        `${key} moves but does not say so`);
    } else {
      assert.match(EFFECTS[key].hint, /still|never moves|nothing of yours moved/i,
        `${key} does not say that it does not move`);
    }
  }
  assert.equal(EFFECTS.solid.moves, false);
  assert.equal(EFFECTS.edge.moves, false);
});

// ── 3. the paint, checked at its worst stop ───────────────────────────────────

test('every palette’s name ink clears 4.5:1 in both themes, at every stop a gradient paints', () => {
  for (const key of ACCENT_KEYS) {
    const a = ACCENTS[key];
    // The dark theme paints from `onDark`; the white end of that gradient is what
    // has the least contrast against a near-black page, so it is the one that
    // matters. The light theme is the mirror: `onLight` mixed toward black is the
    // darkest, and therefore the safest — its worst stop is the plain ink.
    const lightStop = mix(a.onDark, '#ffffff', EFFECT_MIX_SHARE.dark);
    for (const [label, ink, surface] of [
      ['dark ink', a.onDark, SURFACES.dark],
      ['dark mixed stop', lightStop, SURFACES.dark],
      ['light ink', a.onLight, SURFACES.light],
      ['light mixed stop', mix(a.onLight, '#000000', EFFECT_MIX_SHARE.light), SURFACES.light],
    ]) {
      const ratio = contrast(ink, surface);
      assert.ok(ratio >= 4.5, `${key} ${label} is ${ratio.toFixed(2)}:1 on ${surface} — below 4.5:1`);
    }
  }
});

test('a painted name never uses a plate stop, which is a background colour', () => {
  // The rule, stated as arithmetic rather than as a comment: the plate stops are
  // built to sit UNDER white text, so at least one of them fails as text.
  const failing = [];
  for (const key of ACCENT_KEYS) {
    const a = ACCENTS[key];
    for (const stop of [a.from, a.to]) {
      for (const [scheme, surface] of Object.entries(SURFACES)) {
        const ratio = contrast(stop, surface);
        if (ratio < 4.5) failing.push(`${key} ${stop} on ${scheme} (${ratio.toFixed(2)}:1)`);
      }
    }
  }
  assert.ok(failing.length > 0,
    'if a plate stop ever passed as text, this rule would need rewriting rather than deleting');

  // And the rule inside the stylesheet. Read at the level of a RULE, not of the
  // file: a glow and the ring legitimately use the plate stops, because a shadow is
  // not text and a ring is a background. What may not is a rule that PAINTS GLYPHS —
  // that is, one that clips a background to the text.
  const rules = [...CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, sel, body]) => ({ sel: sel.trim(), body }));
  const painted = rules.filter((r) => /(-webkit-)?background-clip:\s*text/.test(r.body));
  assert.ok(painted.length >= 2, 'the painted-name rules were not found in the stylesheet');
  for (const rule of painted) {
    const stops = [...rule.body.matchAll(/var\(--plate-(ink|ink-light|a|b)/g)].map((m) => m[1]);
    assert.ok(stops.every((x) => x.startsWith('ink')),
      `${rule.sel} paints glyphs with a plate stop (${stops.join(', ')}) — `
      + 'a background colour used as text, which is the 2.9:1 mistake this rule exists to prevent');
    assert.ok(stops.some((x) => x === 'ink' || x === 'ink-light'),
      `${rule.sel} paints glyphs from something that is not the palette ink`);
  }
  // The same rule for a name that is inked rather than painted: `color:` on a wear
  // rule may only ever be an ink (a mix of one is fine, a stop is not).
  for (const rule of rules.filter((r) => /\.wear-/.test(r.sel))) {
    for (const decl of rule.body.matchAll(/(^|[;{]\s*)color:\s*([^;]+)/g)) {
      assert.doesNotMatch(decl[2], /--plate-(a|b)\b/, `${rule.sel} inks a name with a plate stop`);
    }
  }
});

test('the surfaces this test composited are the surfaces the product paints', () => {
  // Stated as an assertion so the two cannot quietly drift apart: the night theme's
  // page is the darkest grey token, the day theme's is a soft off-white rather than
  // pure white — and the off-white is the HARDER of the two for dark ink, which is
  // exactly the case a hand-typed `#ffffff` would have missed.
  assert.equal(SURFACES.dark.toLowerCase(), '#0b0e14', 'the night surface moved');
  assert.equal(SURFACES.light.toLowerCase(), '#f4f5f9', 'the day surface moved');
  assert.ok(contrast('#4f46e5', SURFACES.dark) < 4.5,
    'a plate stop on the real night surface must still fail as text, or the rule this test enforces is moot');
});

test('the mix share in the stylesheet is the share this test proved', () => {
  // The number lives in two places by necessity (CSS cannot import JavaScript), so
  // the drift is what is tested. Both spellings, both themes.
  const dark = CSS.match(/--wear-ink-share:\s*(\d+)%/);
  const light = CSS.match(/@media \(prefers-color-scheme: light\) \{ :root \{ --wear-ink-share:\s*(\d+)%/);
  assert.ok(dark, 'the dark share is not in the stylesheet');
  assert.ok(light, 'the light share is not in the stylesheet');
  assert.equal(Number(dark[1]) / 100, EFFECT_MIX_SHARE.dark);
  assert.equal(Number(light[1]) / 100, EFFECT_MIX_SHARE.light);
});

// ── 4. motion is opt-in, and reduced motion wins ──────────────────────────────

test('every moving effect rests paused, runs on intent, and stops for reduced motion', () => {
  for (const key of EFFECT_KEYS.filter((k) => EFFECTS[k].moves)) {
    const cls = `.${WEAR_CLASS[key]}`;
    assert.ok(CSS.includes(`${cls} { animation:`) || CSS.includes(`${cls} { animation:`), `${cls} declares no animation`);
  }
  // Declared paused, started by the three intents, and the reduce block after them.
  const pausedCount = (CSS.match(/animation-play-state: running/g) || []).length;
  assert.ok(pausedCount >= 2, 'nothing opts motion in, so nothing would ever move');
  assert.match(CSS, /animation: wear-\w+ [^;]*paused;/, 'the moving effects must rest paused');
  const reduceAt = CSS.lastIndexOf('@media (prefers-reduced-motion: reduce)');
  const runAt = CSS.indexOf('animation-play-state: running');
  assert.ok(reduceAt > runAt,
    'the reduced-motion block must come after the running state, or a reduce user sees motion');

  // The avatar ring is the same shape of promise: paused, running on intent.
  assert.match(CSS, /\.wear-ring::after \{ animation: wear-spin 12s linear infinite paused; \}/);
  assert.match(CSS, /\.wear-ring:hover::after/);
});

test('the two ownership sentences exist, and each names its layer', () => {
  assert.match(WEAR_OWNER_LINE, /from bytebikri/);
  assert.match(WEAR_OWNER_LINE, /not a store’s gift/);
  assert.match(CHIP_OWNER_LINE, /STORE’s own colour/);
  assert.match(CHIP_OWNER_LINE, /bytebikri does not sell/);
});

test('the palettes a person may wear are the palettes a store may choose', () => {
  // One list, two uses, which is why the composition can put both on one row
  // without either looking like a mistake.
  assert.deepEqual(Object.keys(plateOf('teal')), ['label', 'onDark', 'onLight', 'from', 'to']);
  assert.equal(plateOf('nonsense').label, plateOf('indigo').label);
});
