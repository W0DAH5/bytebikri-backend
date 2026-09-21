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
  const supports = CSS.indexOf('@supports (animation-timeline: view())');
  assert.ok(supports !== -1, 'there is a scroll-driven reveal at all');
  const scrollDriven = CSS.slice(supports + '@supports (animation-timeline: view())'.length);
  const guard = scrollDriven.indexOf('prefers-reduced-motion: no-preference');
  const reveal = scrollDriven.indexOf('animation-timeline: view()');
  assert.ok(guard !== -1, 'scroll-driven animation needs the no-preference guard');
  assert.ok(reveal > guard, 'and the timeline must sit inside it, not beside it');
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

const { landing } = await import('../src/views.js');
const { MONEY_MAP } = await import('../src/earnings.js');

const STATS = { channels: 2, assets: 4, unlocks: 1, views: 9 };
// Just the hero, not the whole document: the header carries its own call to
// action for a signed-out visitor, and that is a different decision.
const doc = landing({ channels: [], user: null, stats: STATS, moneyMap: MONEY_MAP });
const hero = doc.slice(doc.indexOf('<section class="hero">'), doc.indexOf('</section>', doc.indexOf('<section class="hero">')));

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

test('every new class the design pass introduced has a rule', () => {
  for (const cls of ['preview-window', 'preview-bar', 'preview-body', 'money-map', 'money-leg', 'proof-strip', 'proof-value', 'proof-label', 'link-quiet', 'scroll-progress']) {
    assert.ok(new RegExp(`\\.${cls}\\b`).test(CSS), `.${cls} has no rule in the stylesheet`);
  }
  assert.ok(/@view-transition/.test(CSS), 'same-document navigations cross-fade instead of flashing white');
  assert.ok(/\.header-pinned/.test(CSS) && /header-pinned/.test(client), 'the header lifts once it is floating over content');
});
