/**
 * The design system, held still.  npm test
 *
 * These are not "the CSS exists" tests. Each one holds a decision that was made
 * from research and would otherwise decay silently, because nothing in a
 * browser complains about a design system drifting: a hardcoded 300ms
 * transition, a hover that moves layout, a tap target under a finger, an
 * animation that hides content until JavaScript runs. All of them render
 * perfectly and are all wrong.
 *
 * The rules, and where they came from:
 *
 *   Duration and easing are tokens (Material 3's values via Helix UI's set):
 *   standard for state change, decelerate for arrival, accelerate for departure.
 *   A raw cubic-bezier in a component is a curve nobody can change in one place.
 *
 *   Motion is opt-in. `prefers-reduced-motion: reduce` collapses every duration
 *   to 0.01ms rather than removing the animation, so `animationend` still fires.
 *
 *   Entrance animations must never be the only thing that makes content
 *   visible. If the stylesheet hides something and the script is meant to reveal
 *   it, a JavaScript failure is a blank page.
 *
 *   One primary action per page and a single CTA in the hero: pages with one CTA
 *   convert at 13.5% against 10.5% for five or more, and the second button was
 *   competing with the first for the same click.
 *
 *   Tap targets are 44px on a touch device — the visual size stays, the hit area
 *   grows, which is what `@media (pointer: coarse)` is for.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const css = await fs.readFile(path.join(root, 'public/styles.css'), 'utf8');
const client = await fs.readFile(path.join(root, 'public/app.js'), 'utf8');
const views = await fs.readFile(path.join(root, 'src/views.js'), 'utf8');

/** Comments discuss curves and durations; they must not satisfy or trip tests. */
const withoutComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '');

const CSS = withoutComments(css);

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

test('motion is defined once, in tokens, and the aliases still resolve', () => {
  for (const token of [
    '--motion-fast', '--motion-normal', '--motion-slow', '--motion-slower',
    '--ease-standard', '--ease-decelerate', '--ease-accelerate', '--ease-spring',
  ]) {
    assert.ok(new RegExp(`${token}:`).test(CSS), `${token} must be defined in the stylesheet`);
  }
  // The four M3 curves, verbatim. If these values change, they change here.
  assert.ok(/--ease-standard:\s*cubic-bezier\(0\.2, 0, 0, 1\)/.test(CSS));
  assert.ok(/--ease-decelerate:\s*cubic-bezier\(0\.05, 0\.7, 0\.1, 1\)/.test(CSS));
  assert.ok(/--ease-accelerate:\s*cubic-bezier\(0\.3, 0, 0\.8, 0\.15\)/.test(CSS));

  // Durations are ordered. A "fast" transition slower than a "slow" one is how a
  // token set stops meaning anything.
  const ms = (t) => Number(new RegExp(`${t}:\\s*(\\d+)ms`).exec(CSS)?.[1]);
  assert.ok(ms('--motion-fast') < ms('--motion-normal'));
  assert.ok(ms('--motion-normal') < ms('--motion-slow'));
  assert.ok(ms('--motion-slow') < ms('--motion-slower'));
  // Over 500ms reads as slow for interface movement (M3's own guidance).
  assert.ok(ms('--motion-slower') <= 500, 'no interface transition should exceed half a second');
});

test('no component invents its own curve or duration', () => {
  // Token definitions are the only place a curve may be written literally.
  const definitions = CSS.slice(0, CSS.indexOf('/* ── semantic'));
  const body = CSS.slice(CSS.indexOf('/* ── semantic'));
  const curves = [...body.matchAll(/cubic-bezier\([^)]*\)/g)].map((m) => m[0]);
  assert.deepEqual(curves, [], `raw easing curves outside the token block: ${curves.join(', ')}`);

  // `transition: all` animates properties nobody chose, including layout ones.
  assert.ok(!/transition:\s*all/.test(CSS), 'transition: all is never allowed');

  // The legacy keywords are the browser default and read as dated; the tokens
  // exist so nobody has to reach for one.
  const keywords = [...body.matchAll(/(?:transition|animation)[^;{}]*\b(ease-in-out|ease-in|ease-out)\b/g)]
    .map((m) => m[0].trim());
  assert.deepEqual(keywords, [], `browser-default easing keywords used: ${keywords.join(' | ')}`);
  assert.ok(definitions.length > 0);
});

// ---------------------------------------------------------------------------
// Reduced motion
// ---------------------------------------------------------------------------

test('reduced motion is honoured, and animations still complete', () => {
  const block = /@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/.exec(CSS)?.[1] || '';
  assert.ok(block, 'the stylesheet must carry a reduced-motion block');
  assert.ok(/transition-duration:\s*0\.01ms\s*!important/.test(block),
    'durations collapse to 0.01ms, not to `none`, so transitionend still fires');
  assert.ok(/animation-duration:\s*0\.01ms\s*!important/.test(block));
  assert.ok(/animation-delay:\s*0ms\s*!important/.test(block),
    'a hover transition with a 200ms delay would still feel broken');
  assert.ok(/scroll-behavior:\s*auto/.test(block));

  // Scroll-driven reveals must be inside a no-preference guard: they hide
  // content until the timeline runs, and a timeline that never runs is a blank
  // section.
  // THE BUG THIS REPLACES, stated as an assertion.
  //
  // `animation-timeline: view()` with `animation-fill-mode: both` holds the
  // keyframe's `from` state — opacity 0 — for every element whose scroll range
  // has not been reached, and Chrome resolves the timeline late enough that it
  // applies on load. `/dashboard/<store>` rendered 3588px tall with 2900px of
  // blank space, and every test passed because every test read the CSS text.
  //
  // So: nothing may be hidden by a scroll timeline, and no animation may hold a
  // hidden final state.
  assert.ok(!/animation-timeline:\s*view\(\)/.test(CSS),
    'a view() timeline can hold content invisible; the reveal is client-driven now');
  // `::view-transition-*` pseudo-elements are exempt and only they: they exist
  // for the duration of a navigation cross-fade and are removed from the tree
  // afterwards, so `both` cannot strand anything. A regular element can be
  // stranded, which is the whole point of this assertion.
  const withoutViewTransitions = CSS.replace(/::view-transition-[a-z-]+[^{]*\{[^}]*\}/g, '');
  const fills = [...withoutViewTransitions.matchAll(/animation:[^;]*\bboth\b/g)].map((m) => m[0].trim());
  assert.deepEqual(fills, [], `an animation fills forwards from a hidden keyframe: ${fills.join(' | ')}`);

  // Hiding is opt-in and gated on one class the inline script adds, and only
  // when motion is welcome. No JavaScript, no hiding.
  for (const m of CSS.matchAll(/\.reveal-ready[^{]*\{([^}]*)\}/g)) {
    assert.ok(!/display:\s*none/.test(m[1]), 'a reveal must not remove content from the page');
  }
  const inline = /<script>([\s\S]*?)<\/script>/.exec(views)?.[1] || '';
  assert.ok(/reveal-ready/.test(inline), 'the head script is what turns reveals on');
  assert.ok(/prefers-reduced-motion: reduce/.test(inline),
    'and it must refuse to add the class when reduced motion is requested');

  // Belt and braces: a reveal that never fires is a blank section, so the client
  // reveals everything after a timeout regardless of what the observer did.
  assert.ok(/setTimeout\(\(\) => targets\.forEach\(show\)/.test(client),
    'there must be a safety timer that un-hides everything');
});

test('the client only decorates what the server already rendered', () => {
  // The counter reads its value from the DOM and writes back the same number:
  // the markup is the truth, the animation is an enhancement.
  assert.ok(/\[data-count\]/.test(client));
  assert.ok(/el\.textContent = String\(target\)/.test(client), 'a counter must land exactly on the rendered value');
  assert.ok(/prefers-reduced-motion: reduce/.test(client), 'the client asks the same question the CSS asks');
  const quiet = client.slice(client.indexOf('── the page itself'));
  assert.ok(!/innerHTML\s*=/.test(quiet), 'presentation code writes text, never markup');
  assert.ok(/IntersectionObserver/.test(client), 'counting waits until the figure is on screen');
});

// ---------------------------------------------------------------------------
// Geometry and touch
// ---------------------------------------------------------------------------

test('touch targets meet 44px where a finger is the pointer', () => {
  const coarse = /@media \(pointer: coarse\)\s*\{([\s\S]*?)\n\}/.exec(CSS)?.[1] || '';
  assert.ok(coarse, 'there must be a coarse-pointer block');
  assert.ok(/\.btn,\s*\.btn-sm\s*\{\s*min-height:\s*44px/.test(coarse),
    'buttons expand their hit area on touch without changing their look');
  // And the base button is a comfortable size on a mouse.
  const btn = /\.btn \{([\s\S]*?)\n\}/.exec(CSS)?.[1] || '';
  assert.ok(/min-height:\s*(\d+)px/.test(btn));
  assert.ok(Number(/min-height:\s*(\d+)px/.exec(btn)[1]) >= 40);
});

test('hover moves things with transform and opacity only', () => {
  // A hover that animates height, margin or padding relayouts the page under
  // the pointer, which is how a card grid jitters when the mouse crosses it.
  const hoverBlocks = [...CSS.matchAll(/[^{}]*:hover[^{}]*\{([^}]*)\}/g)].map((m) => m[1]);
  const layoutProps = [];
  for (const block of hoverBlocks) {
    for (const prop of ['height', 'margin-top', 'margin-bottom', 'padding', 'top:', 'left:', 'width']) {
      if (new RegExp(`(^|[;{\\s])${prop}`).test(block)) layoutProps.push(`${prop} in ${block.trim().slice(0, 40)}`);
    }
  }
  assert.deepEqual(layoutProps, [], `hover animates layout: ${layoutProps.join(' | ')}`);
});

// ---------------------------------------------------------------------------
// The page that sells it
// ---------------------------------------------------------------------------

const viewsModule = await import('../src/views.js');
const { landing, dashboard, storefront } = viewsModule;
const { MONEY_MAP } = await import('../src/earnings.js');

const STATS = { channels: 2, assets: 4, unlocks: 1, views: 9 };
// Just the hero, not the whole document: the header carries its own call to
// action for a signed-out visitor, and that is a different decision.
const doc = landing({ channels: [], user: null, stats: STATS, moneyMap: MONEY_MAP });
const hero = doc.slice(doc.indexOf('<section class="hero">'), doc.indexOf('</section>', doc.indexOf('<section class="hero">')));

const MARKET = {
  id: '00000000-0000-0000-0000-000000000001', slug: 'shop', name: 'Shop',
  tagline: '', listing_mode: 'marketplace', moderation_state: 'approved',
};

test('scroll reveals are opt-in per page, and only on the marketing surfaces', () => {
  const { layout } = viewsModule;
  const on = layout({ title: 'x', user: null, body: '', reveal: true });
  const off = layout({ title: 'x', user: null, body: '' });
  assert.match(on, /if \(true && !matchMedia/, 'the page that wants reveals says so');
  assert.match(off, /if \(false && !matchMedia/, 'and every other page does not');

  // A dashboard is a tool: its panels must not fade in as somebody scrolls to
  // find what they came for.
  const dashboardShell = dashboard({
    channel: MARKET, slots: [], connections: [], providers: [],
    plan: { name: 'Free', code: 'free', capabilities: {} }, estimate: {}, pageviews: 0, adViews: [],
    upgrade: null, user: null,
  });
  assert.match(dashboardShell, /if \(false && !matchMedia/);
  const storeShell = storefront({ channel: MARKET, assets: [], slots: [], estimate: {}, pageviews: 0 });
  assert.match(storeShell, /if \(true && !matchMedia/, 'a storefront is the shelf, so it may animate');
});

test('the hero has one primary action, not a choice of three', () => {
  const primary = [...hero.matchAll(/class="btn[^"]*btn-primary[^"]*"/g)];
  assert.equal(primary.length, 1, 'exactly one primary CTA in the hero');
  assert.ok(/href="\/marketplace"/.test(hero), 'and it is the action a stranger can take today');
  // The secondary action is a link, not an equal-weight button.
  assert.ok(/link-quiet/.test(hero));
  assert.ok(!/class="btn btn-lg"/.test(hero), 'no second button competing with the first');
});

test('the hero shows the product, and the product is the money map', () => {
  assert.ok(/preview-window/.test(hero), 'a real panel, framed as a window');
  // The facts on the landing page are the same strings the earnings page uses,
  // from the same structure — the two pages cannot drift apart.
  for (const fact of [
    MONEY_MAP.toCreator.account, MONEY_MAP.toCreator.held, MONEY_MAP.toCreator.cut,
  ]) {
    assert.ok(hero.includes(fact), `the hero must carry "${fact}" from MONEY_MAP`);
  }
  assert.ok(hero.includes(MONEY_MAP.toCreator.detail));
});

test('the proof strip animates numbers that are already in the markup', () => {
  assert.ok(/data-count="2"/.test(hero), 'the real figure is rendered server-side');
  assert.ok(/class="proof-value"[^>]*>2</.test(hero), 'and it is the text the visitor sees before any script runs');
  assert.ok(/>0%</.test(hero), 'a literal (the 0% cut) is never animated from a wrong value');
  assert.ok(!/data-count="0%"/.test(hero));
});

test('components use semantic tokens, never the raw palette', () => {
  // This is the bug that caused a 1.47:1 money figure on the light theme: a
  // component written against `--emerald-300`, a dark-theme primitive, on a
  // white surface. A primitive cannot know what it is sitting on; a semantic
  // token is defined once per theme and measured against that theme's surfaces.
  const semanticStart = CSS.indexOf('/* ── semantic');
  const body = CSS.slice(CSS.indexOf('/* ── reset', semanticStart));
  const primitives = [...body.matchAll(/var\(--(gray|indigo|violet|emerald|amber|rose|sky|slate)-\d+\)/g)]
    .map((m) => m[0]);
  assert.deepEqual(primitives, [],
    `component CSS reaches past the semantic layer: ${[...new Set(primitives)].join(', ')}`);

  // And every semantic token the stylesheet uses must be defined in BOTH themes
  // — dark in :root, light in the light block — or one of them silently inherits
  // the other's value.
  // Brace-match the light block, then take the first :root block outside it as
  // the dark theme. Comment anchors cannot be used here: this file strips
  // comments before anything else looks at the CSS.
  const lightStart = CSS.indexOf('@media (prefers-color-scheme: light)');
  let depth = 0; let i = CSS.indexOf('{', lightStart); const from = i;
  for (; i < CSS.length && (depth > 0 || i === from); i++) {
    if (CSS[i] === '{') depth += 1;
    else if (CSS[i] === '}') depth -= 1;
  }
  const light = CSS.slice(from, i);
  const withoutLight = CSS.slice(0, lightStart) + CSS.slice(i);
  // The first :root block is the primitive palette; the semantic theme is the one
  // that defines `--surface-base`.
  const root = [...withoutLight.matchAll(/:root\s*\{([\s\S]*?)\n\}/g)].map((m) => m[1])
    .find((b) => /--surface-base:/.test(b)) || '';
  const dark = root;
  const themed = ['--text-primary', '--text-muted', '--text-faint', '--surface-base', '--surface-raised', '--border-subtle', '--success-text', '--danger-text'];
  for (const t of themed) {
    assert.ok(new RegExp(`${t}:`).test(dark), `${t} missing from the dark theme`);
    assert.ok(new RegExp(`${t}:`).test(light), `${t} missing from the light theme — it would inherit the dark value`);
  }
});

test('every new class the design pass introduced has a rule', () => {
  for (const cls of ['preview-window', 'preview-bar', 'preview-body', 'money-map', 'money-leg', 'proof-strip', 'proof-value', 'proof-label', 'link-quiet', 'scroll-progress']) {
    assert.ok(new RegExp(`\\.${cls}\\b`).test(CSS), `.${cls} has no rule in the stylesheet`);
  }
  assert.ok(/@view-transition/.test(CSS), 'same-document navigations cross-fade instead of flashing white');
  assert.ok(/\.header-pinned/.test(CSS) && /header-pinned/.test(client), 'the header lifts once it is floating over content');
});
