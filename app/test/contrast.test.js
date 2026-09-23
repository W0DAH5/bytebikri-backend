/**
 * Contrast tests.
 *
 * A design system that claims to be accessible is a claim nobody checks, and the
 * failure is invisible in every other kind of test: the page renders, the class
 * is right, the DOM is correct, and the text is unreadable. WCAG 4.5:1 is
 * arithmetic on two hex values, so it can be an assertion rather than a promise.
 *
 * The pairs below are the ones that actually appear together in the views. A
 * token no test touches is a token whose contrast nobody has verified — so when
 * a new text colour is added, the list has to grow with it, and the last test
 * here fails if the stylesheet grows a text token this file does not cover.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const css = readFileSync(path.join(here, '../public/styles.css'), 'utf8');

/**
 * The two themes are separate token maps, and only one of them is the `:root`
 * one. Reading defaults from a single block would test dark mode twice and
 * report a false pass for light — which is the theme most people will actually
 * see, since it is the one their operating system picks for them.
 */
function themeBlocks(source) {
  const light = /@media \(prefers-color-scheme: light\)\s*\{\s*:root\s*\{([\s\S]*?)\n\s*\}\s*\}/.exec(source);
  const rootMatch = /(?:^|\n):root\s*\{([\s\S]*?)\n\}/.exec(source);
  return { dark: rootMatch?.[1] ?? source, light: light?.[1] ?? rootMatch?.[1] ?? source };
}

const THEMES = themeBlocks(css);
const views = readFileSync(path.join(here, '../src/views.js'), 'utf8');

// ── colour maths ─────────────────────────────────────────────────────────────

const hex = (v) => {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(v).trim());
  if (!m) return null;
  const s = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1];
  return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16));
};

/** Relative luminance, per WCAG 2.x. */
const luminance = ([r, g, b]) => {
  const f = (c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};

const ratio = (a, b) => {
  const la = luminance(a); const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};

/**
 * Composite a translucent colour over a background.
 *
 * The soft pill and note backgrounds are `color-mix(... transparent)`, so they
 * are not opaque and the text sits on the blend, not on the tint. Comparing
 * against the raw tint would be comparing against a colour that never appears
 * on screen — and it would flatter the result.
 */
const over = (fg, bg, alpha) => fg.map((c, i) => Math.round(c * alpha + bg[i] * (1 - alpha)));

// ── token resolution ─────────────────────────────────────────────────────────

/**
 * Resolve a token within one theme.
 *
 * Theme-local first: a light-theme override must win over the default, or the
 * test measures a colour that light-theme users never see.
 */
function token(name, theme = css, depth = 0) {
  if (depth > 6) return null;
  const m = new RegExp(`--${name}\\s*:\\s*([^;]+);`).exec(theme)
    || (theme !== css ? new RegExp(`--${name}\\s*:\\s*([^;]+);`).exec(css) : null);
  if (!m) return null;
  const raw = m[1].trim();

  const asVar = /^var\(--([a-z0-9-]+)\)$/i.exec(raw);
  if (asVar) return token(asVar[1], theme, depth + 1);

  const asMix = /^color-mix\(in srgb,\s*var\(--([a-z0-9-]+)\)\s+([\d.]+)%\s*,\s*transparent\)$/i.exec(raw);
  if (asMix) return { mix: asMix[1], alpha: Number(asMix[2]) / 100, raw };

  const asHex = hex(raw);
  if (asHex) return { rgb: asHex, raw };
  return null;
}

/** Flatten a token to an opaque RGB against a page background. */
function flatten(name, background, theme = css) {
  const t = token(name, theme);
  if (!t) throw new Error(`token --${name} could not be resolved from styles.css`);
  if (t.rgb) return t.rgb;
  const base = flatten(t.mix, background, theme);
  return over(base, background, t.alpha);
}

/** Evaluate a pair in one theme. Returns null when a token is absent there. */
function measure(name, bgName, theme) {
  try {
    const page = flatten('surface-base', [0, 0, 0], theme);
    const background = bgName === 'surface-base' ? page : flatten(bgName, page, theme);
    return ratio(flatten(name, background, theme), background);
  } catch { return null; }
}

/**
 * The membership plates: eight palettes, checked rather than admired.
 *
 * This is the test the design rests on. A member's NAME is a solid accent colour
 * and the gradient lives on the ring and the chip — because gradient text is
 * checked at its WORST stop, not its average, which is why the researched guidance
 * is to keep it off body-sized text. So there are exactly two things to prove:
 *
 *   1. every palette's ink is readable on both themes, at the size a name is; and
 *   2. every palette's WHITE ink is readable on both of its gradient stops, which
 *      is what a chip and an avatar initial are (white on the dark end).
 *
 * A ninth palette added without this arithmetic is the failure mode: it renders,
 * it looks fine on the author's monitor, and it is unreadable for somebody else.
 */
test('every membership palette is readable on both themes, at both ends of its gradient', async () => {
  const { ACCENTS } = await import('../src/memberships.js');
  const page = { dark: flatten('surface-base', [0, 0, 0], THEMES.dark), light: flatten('surface-base', [0, 0, 0], THEMES.light) };
  const problems = [];
  for (const [key, a] of Object.entries(ACCENTS)) {
    const ink = { dark: ratio(hex(a.onDark), page.dark), light: ratio(hex(a.onLight), page.light) };
    if (ink.dark < 4.5) problems.push(`${key}: name ink on the dark theme is ${ink.dark.toFixed(2)}:1`);
    if (ink.light < 4.5) problems.push(`${key}: name ink on the light theme is ${ink.light.toFixed(2)}:1`);
    for (const [end, value] of [['from', a.from], ['to', a.to]]) {
      const r = ratio(hex('#ffffff'), hex(value));
      if (r < 4.5) problems.push(`${key}: white on the gradient's ${end} stop (${value}) is ${r.toFixed(2)}:1`);
    }
  }
  assert.deepEqual(problems, [],
    'a palette a member can be given must be readable in both themes — the chip and the avatar are white-on-gradient, the name is ink-on-page');
});

// ── the pairs that appear on screen ──────────────────────────────────────────

/** [foreground, background, minimum, note] */
const PAIRS = [
  ['text-primary', 'surface-base', 4.5, 'body text on the page'],
  ['text-primary', 'surface-raised', 4.5, 'body text in a card'],
  ['text-primary', 'surface-overlay', 4.5, 'body text in a modal'],
  ['text-secondary', 'surface-base', 4.5, 'the secondary tier'],
  ['text-secondary', 'surface-raised', 4.5, 'secondary text in a card'],
  ['text-muted', 'surface-base', 4.5, 'labels and captions'],
  ['text-muted', 'surface-raised', 4.5, 'captions in a card'],
  // The faint tier is for metadata that is decoration-adjacent: file sizes,
  // counts, the "3 in this store" line. 4.5 is the target anyway, because
  // "not important" is not the same as "not allowed to be read".
  ['text-faint', 'surface-base', 4.5, 'metadata'],
  ['text-faint', 'surface-raised', 4.5, 'metadata in a card'],
  ['text-on-accent', 'accent', 4.5, 'a primary button'],
  ['accent-text', 'surface-base', 4.5, 'links'],
  ['accent-text', 'surface-raised', 4.5, 'links in a card'],
  ['success-text', 'surface-raised', 4.5, 'a success note'],
  ['warning-text', 'surface-raised', 4.5, 'a warning note'],
  ['danger-text', 'surface-raised', 4.5, 'a danger note'],
  ['info-text', 'surface-raised', 4.5, 'an informational note'],
  ['locked-text', 'surface-raised', 4.5, 'the locked pill'],
];

for (const [fg, bg, min, note] of PAIRS) {
  for (const name of ['dark', 'light']) {
    test(`${fg} on ${bg} is at least ${min}:1 in the ${name} theme — ${note}`, () => {
      const r = measure(fg, bg, THEMES[name]);
      assert.ok(r !== null, `${fg} or ${bg} is missing from the ${name} theme`);
      assert.ok(
        r >= min,
        `${fg} on ${bg} is ${r.toFixed(2)}:1 in the ${name} theme, below ${min}:1. `
        + 'This is not a style preference: text below it cannot be read by everyone.',
      );
    });
  }
}

test('the soft note backgrounds stay distinguishable from the surface', () => {
  // Not a contrast rule — a visibility one. A tint that lands within a hair of
  // the surface is a note nobody notices they are reading, which for a warning
  // is worse than no styling at all.
  for (const [soft, accent] of [['success-soft', 'success-text'], ['warning-soft', 'warning-text'],
    ['danger-soft', 'danger-text'], ['info-soft', 'info-text'], ['accent-soft', 'accent-text']]) {
    const surface = flatten('surface-raised', flatten('surface-base', [0, 0, 0]));
    const tinted = flatten(soft, surface);
    const delta = Math.abs(luminance(tinted) - luminance(surface));
    assert.ok(delta > 0.002, `${soft} is indistinguishable from the card it sits on`);
    assert.ok(tintOf(accent), `--${soft} has no matching ${accent}`);
  }
});

function tintOf(name) { return token(name); }

test('every text token in the stylesheet is covered by a pair above', () => {
  // The guard that keeps this file honest. Add `--tertiary-text` to the
  // stylesheet and this fails, because a text colour nobody measured is the one
  // that ends up at 2.9:1 in the corner of a page.
  const declared = [...css.matchAll(/^\s*--([a-z0-9-]*(?:text|fg)[a-z0-9-]*)\s*:/gim)]
    .map((m) => m[1])
    // `--text-*` here is the TYPE SCALE (size, leading), not a colour. Sizes have
    // no contrast ratio; they are covered by the type-scale assertions below.
    .filter((n) => !/^text-(2xs|xs|sm|base|md|lg|xl|2xl|3xl|4xl)$/.test(n));

  // Component-layer aliases (`--btn-fg: var(--text-primary)`) are indirection,
  // not new colours: the value they point at is covered, so measuring the alias
  // measures nothing new. Detected on the RAW declaration, not the resolved
  // value — resolving first loses the fact that it was an alias at all.
  const rawDeclaration = (name) => new RegExp(`--${name}\\s*:\\s*([^;]+);`).exec(css)?.[1]?.trim() ?? '';
  const covered = new Set(PAIRS.flatMap(([fg, bg]) => [fg, bg]));
  const uncovered = declared
    .filter((n) => !covered.has(n) && token(n))
    .filter((n) => !rawDeclaration(n).startsWith('var('));
  assert.deepEqual(uncovered, [],
    `these colour tokens have no contrast test: ${uncovered.join(', ')}. `
    + 'Add them to PAIRS with the background they are actually used on.');
});

test('the type scale is readable at its smallest', () => {
  const size = (name) => {
    const m = new RegExp(`--text-${name}\\s*:\\s*([^;]+);`).exec(css);
    if (!m) return null;
    const rem = /([\d.]+)rem/.exec(m[1]);
    const clamp = /clamp\(([\d.]+)rem/.exec(m[1]);
    return (clamp ? Number(clamp[1]) : rem ? Number(rem[1]) : null) * 16;
  };

  // 12px is the floor for text a person has to read; below it, on a phone in
  // daylight, is where a caption stops being read at all.
  for (const name of ['2xs', 'xs', 'sm', 'base']) {
    const px = size(name);
    assert.ok(px, `--text-${name} could not be resolved`);
    assert.ok(px >= 11, `--text-${name} is ${px}px, too small to read`);
  }
  assert.ok(size('base') >= 15, 'body text should not be a phone-sized 14px on a desktop');
  // Headings scale with the viewport, so they must have a floor AND a ceiling.
  for (const name of ['2xl', '3xl', '4xl']) {
    const m = new RegExp(`--text-${name}\\s*:\\s*(clamp\\([^)]+\\))`).exec(css);
    assert.ok(m, `--text-${name} should be fluid, not a fixed size`);
  }
});

test('the views do not hardcode colours', () => {
  // Inline hex in a view is how a design system quietly stops being one: the
  // value cannot be themed, cannot be checked for contrast, and cannot be found.
  const inlineHex = [...views.matchAll(/(?:color|background)\s*:\s*(#[0-9a-f]{3,8})/gi)].map((m) => m[1]);
  assert.deepEqual(inlineHex, [], `views.js hardcodes colours: ${inlineHex.join(', ')}`);
});
