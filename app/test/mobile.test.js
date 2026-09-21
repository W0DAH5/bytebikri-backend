/**
 * The phone.  npm test
 *
 * Most of this product's traffic is a phone in one hand, and the failure mode of
 * a desktop-first stylesheet is not ugliness — it is absence. The navigation was
 * `display: none` below 640px for several rounds: on a phone the header offered
 * no route to Explore at all, and nothing in the suite noticed, because every
 * page still rendered and every link still existed in the HTML.
 *
 * So these assertions are about what a small screen must still be able to DO:
 * reach the navigation, read a table, tap a control, and see a heading that fits.
 * They read the stylesheet as a small-screen block rather than testing pixels —
 * there is no browser in this environment — and each one names the failure it
 * prevents.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const raw = await fs.readFile(path.join(root, 'public/styles.css'), 'utf8');
const css = raw.replace(/\/\*[\s\S]*?\*\//g, '');

/** Every `@media (max-width: N)` block, as {max, body}. */
function smallScreenBlocks() {
  const blocks = [];
  const re = /@media[^{]*max-width:\s*(\d+)px[^{]*\{/g;
  let m;
  while ((m = re.exec(css)) !== null) {
    // Brace-match from here.
    let depth = 1;
    let i = re.lastIndex;
    while (i < css.length && depth > 0) {
      if (css[i] === '{') depth += 1;
      else if (css[i] === '}') depth -= 1;
      i += 1;
    }
    blocks.push({ max: Number(m[1]), body: css.slice(re.lastIndex, i - 1) });
  }
  return blocks;
}

const SMALL = smallScreenBlocks();
const PHONE = SMALL.filter((b) => b.max <= 700);

test('the navigation is never hidden on a small screen', () => {
  // Exactly the `.nav` element, not a descendant and not a pseudo-element: the
  // scrollbar rule below uses `display: none` on `.nav::-webkit-scrollbar` and
  // must not be mistaken for the navigation itself being hidden.
  const blocks = SMALL.filter((b) => /\.nav\s*(?:,[^{}]*)?\{[^}]*display:\s*none/.test(b.body));
  assert.deepEqual(blocks.map((b) => b.max), [],
    'the header hides its navigation below some width — on a phone that is a missing feature, not a responsive one');
});

test('the phone header keeps one row and lets the links scroll instead', () => {
  const nav = PHONE.map((b) => /\.nav\s*\{([^}]*)\}/.exec(b.body)?.[1]).filter(Boolean).join('\n');
  assert.ok(nav, 'no small-screen rule for .nav at all');
  assert.match(nav, /overflow-x:\s*auto/, 'the links scroll rather than clip');
  assert.match(nav, /flex:\s*1 1 auto/);
  assert.match(nav, /min-width:\s*0/, 'without min-width:0 a flex item refuses to shrink and pushes the row wide');
  // The account controls keep their place; the caption goes.
  assert.ok(PHONE.some((b) => /\.who\s+\.muted\s*\{[^}]*display:\s*none/.test(b.body)),
    'the display name should be the thing that goes, not the account control');
});

test('tables are allowed to be wider than a phone and scroll', () => {
  const body = PHONE.map((b) => b.body).join('\n');
  assert.match(body, /\.panel-body-flush[^{]*\{[^}]*overflow-x:\s*auto/,
    'a table inside a panel must be in a scroll container, or .panel\'s overflow:hidden clips it');
  assert.match(body, /\.table\s*\{[^}]*min-width:\s*\d+px/,
    'a squeezed table is worse than a scrolled one');
  // And never the other way round: nowrap on cells would hide text instead.
  assert.ok(!/\.table td[^{]*\{[^}]*white-space:\s*nowrap/.test(css));
});

test('the phone gets a shorter hero and stacked definitions, not the desktop spacing', () => {
  const body = PHONE.map((b) => b.body).join('\n');
  assert.match(body, /\.hero\s*\{[^}]*padding-block:\s*var\(--space-12\)/,
    '80px of hero headroom is a third of a phone screen');
  assert.match(body, /\.kv\s*\{[^}]*grid-template-columns:\s*1fr/,
    'two columns of auto/1fr on a 320px screen leaves the value column narrower than the labels');
});

test('headings scale with the viewport rather than wrapping to four lines', () => {
  // The type scale is fluid at the token level, which is where it should be:
  // one clamp per size instead of a media query per heading.
  for (const token of ['--text-2xl', '--text-3xl', '--text-4xl']) {
    const def = new RegExp(`${token}:\\s*clamp\\(`).test(css);
    assert.ok(def, `${token} is not fluid — a phone will get a desktop-sized heading`);
  }
  assert.ok(/\.hero h1\s*\{[^}]*max-width:\s*\d+ch/.test(css),
    'a hero headline needs a measure, not just a size');
});

test('nothing that must be tapped is smaller than a thumb, anywhere', () => {
  // The coarse-pointer block is the only place a tap target may be enlarged, and
  // it must cover every interactive class the views emit.
  const coarse = /@media \(pointer: coarse\)\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] || '';
  assert.ok(coarse, 'no coarse-pointer block');
  assert.match(coarse, /min-height:\s*44px/);
  // The primary in-page controls: buttons, inputs, and the nav links' padding.
  const input = /\.input,\s*\.select,\s*\.textarea\s*\{([^}]*)\}/.exec(css)?.[1] || '';
  const min = Number(/min-height:\s*(\d+)px/.exec(input)?.[1] || 0);
  assert.ok(min >= 40, `inputs are ${min}px tall, which is under a comfortable tap`);
  assert.ok(/@media \(pointer: coarse\)[\s\S]*?\.btn-sm\s*\{[^}]*min-height:\s*44px/.test(css),
    'the small button class must expand too — it is the one used in tables and rows');
});

test('the phone layout does not rely on hover to be usable', () => {
  // Any rule that reveals content only on hover is invisible on a touch device.
  const hasHoverReveal = /[^{}]*:hover[^{}]*\{[^}]*display:\s*(block|flex|grid|inline)/.test(css);
  assert.equal(hasHoverReveal, false, 'something is revealed by hovering, which a phone cannot do');
});
