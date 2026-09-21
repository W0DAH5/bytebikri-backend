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
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
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
  // The head script is a constant now, so read it as one rather than guessing
  // its position in the rendered page.
  const bootstrap = /export const REVEAL_BOOTSTRAP =\s*([\s\S]*?);\n/.exec(views)?.[1] || '';
  assert.ok(bootstrap, 'the reveal bootstrap is a named constant the CSP hash is computed from');
  assert.ok(/reveal-ready/.test(CSS), 'the stylesheet is what hides and reveals');
  assert.match(bootstrap, /reveal-ready/, 'and the head script is what turns reveals on');
  assert.match(bootstrap, /prefers-reduced-motion: reduce/,
    'and it must refuse to add the class when reduced motion is requested');
  assert.match(bootstrap, /hasAttribute\('data-reveal'\)/,
    'and it only acts on a page that asked for it');

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
  assert.match(on, /<html lang="en" data-reveal>/, 'the page that wants reveals says so, on the html element');
  // The script mentions the attribute it looks for, so test the html tag itself.
  assert.ok(!/<html[^>]*data-reveal/.test(off), 'and every other page does not');
  // The script itself must be byte-identical on every page, because the CSP
  // allows it by hash. A hash that stops matching does not error — it silently
  // stops the reveal from ever running, which looks exactly like "nothing
  // changed".
  const { REVEAL_BOOTSTRAP } = viewsModule;
  for (const page of [on, off]) {
    assert.ok(page.includes(`<script>${REVEAL_BOOTSTRAP}</script>`),
      'the inline script is the same bytes everywhere, and the page carries one copy of it');
  }
  assert.ok(!/if \(true/.test(on) && !/if \(false/.test(off),
    'nothing is interpolated into the script any more: that is what broke the hash');

  // A dashboard is a tool: its panels must not fade in as somebody scrolls to
  // find what they came for.
  const dashboardShell = dashboard({
    channel: MARKET, slots: [], connections: [], providers: [],
    plan: { name: 'Free', code: 'free', capabilities: {} }, estimate: {}, pageviews: 0, adViews: [],
    upgrade: null, user: null,
  });
  assert.ok(!/<html[^>]*data-reveal/.test(dashboardShell), 'a dashboard does not animate its panels in');
  const storeShell = storefront({ channel: MARKET, assets: [], slots: [], estimate: {}, pageviews: 0 });
  assert.match(storeShell, /<html lang="en" data-reveal>/, 'a storefront is the shelf, so it may animate');
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

test('no HTML comment in a view contains a backtick', () => {
  // Views are template literals, so a backtick anywhere inside one — including
  // inside an HTML comment, which is exactly where it feels safe — ends the
  // literal and turns the rest of the sentence into JavaScript. It has now
  // happened twice: once as the details tag while writing the publish
  // disclosure, once as aria-hidden while writing the landing steps. Both times
  // the only symptom was a module that would not load.
  const src = readFileSync(path.join(root, 'src/views.js'), 'utf8');
  const offenders = [];
  let cursor = 0;
  for (;;) {
    const open = src.indexOf('<!--', cursor);
    if (open < 0) break;
    const close = src.indexOf('-->', open);
    if (close < 0) break;
    const body = src.slice(open + 4, close);
    if (body.includes('\u0060')) offenders.push(body.trim().split('\u000a')[0].slice(0, 60));
    cursor = close + 3;
  }
  assert.deepEqual(offenders, [], 'a backtick in an HTML comment ends the template literal around it');
});

test('the landing explains the unlock in three steps, and the money in one', () => {
  const page = viewsModule.landing({ channels: [], user: null, stats: STATS, moneyMap: MONEY_MAP });
  assert.match(page, /<ol class="steps">/, 'the three steps are a list, so the order is in the markup');
  assert.equal((page.match(/class="step-num"/g) || []).length, 3);
  assert.match(page, /aria-hidden="true">01</, 'the numerals are decoration: the ordered list already says the order');
  assert.match(page, /Someone watches the ad/);
  // Every step that claims money says who pays whom, and step three says we are not a party.
  assert.match(page, /The network pays you/);
  assert.match(page, /We are not a\s+party to that payment and we cannot see the balance/);
  // And the two charges are named as a set, with what they are not.
  assert.match(page, /What this costs, and what it never costs/);
  assert.match(page, /Two charges and no share of anything/);
});

test('the dashboard leads with one verdict, not four equal numbers', () => {
  const { dashboard } = viewsModule;
  const page = dashboard({
    channel: MARKET, slots: [], connections: [], providers: [],
    plan: { code: 'free', name: 'Free', capabilities: { max_assets: 20 } },
    estimate: { unlocks: 0, total: 5, rent: 1, rpmUsd: 0.02, estNpr: 0 },
    pageviews: 120, adViews: [], upgrade: null, user: null,
  });
  assert.match(page, /class="kpi-row"/);
  assert.match(page, /class="kpi kpi-hero"/, 'exactly one figure is the hero');
  assert.equal((page.match(/kpi-hero/g) || []).length, 1);
  assert.match(page, /Files unlocked · last 30 days/);
  // The zero state is designed, not blank: it says what will happen.
  assert.match(page, /Nobody has unlocked a file yet/);
  // Supporting figures are labelled as such, and the estimate keeps its caveat.
  assert.match(page, /Our estimate, not the network's statement/);
  assert.match(page, /Our estimate, not the network's statement\.<\/div>/, 'the caveat belongs to the number it qualifies');
  assert.match(page, /href="\/dashboard\/shop\/earnings"/, 'and the figure links to where money is explained');
  // The old flat row is gone from this page.
  assert.ok(!/class="stat-row"/.test(page), 'four equal stats answered no question');
});

test('audit metadata reads as a sentence, not as JSON', () => {
  const { briefMeta } = viewsModule;
  const line = briefMeta({ channelId: 'c6326d55-1cb6-43cb-8e8d-b2cc17ed2e0f', plan: 'pro', amountNpr: 1500, txnReference: 'ESEWA-90122' });
  assert.ok(!line.includes('{'), 'no braces');
  assert.ok(!line.includes('"'), 'no quoted keys');
  assert.match(line, /amount NPR 1,500/, 'money gets a currency and separators');
  assert.match(line, /store c6326d55/, 'an id is shortened to something still searchable');
  assert.ok(!line.includes('1cb6'), 'and the rest of the uuid is not in the way');
  assert.equal(briefMeta(null), '');
  assert.equal(briefMeta('just a note'), 'just a note');
});

test('the CSP hash is computed from the script the page renders', () => {
  // The reveal bootstrap is inline and script-src is 'self', so the ONLY thing
  // letting it run is its hash. If the hash and the bytes ever disagree the
  // browser blocks the script, nothing throws, and the reveal silently stops
  // existing. Typing the hash into server.js by hand is therefore a bug waiting
  // to happen, and this is the assertion that says so.
  const server = readFileSync(path.join(root, 'server.js'), 'utf8');
  assert.match(server, /crypto\.createHash\('sha256'\)\.update\(REVEAL_BOOTSTRAP/,
    'the hash is derived from the constant the view renders, not pasted in');
  assert.match(server, /import \{ REVEAL_BOOTSTRAP \} from '\.\/src\/views\.js'/);
  const expected = `sha256-${createHash('sha256').update(viewsModule.REVEAL_BOOTSTRAP, 'utf8').digest('base64')}`;
  assert.ok(expected.startsWith('sha256-') && expected.length > 20, 'and it is a real digest');
  // The page must not carry a second, different copy of that script.
  const page = viewsModule.layout({ title: 'x', user: null, body: '', reveal: true });
  assert.equal((page.match(/reveal-ready/g) || []).length, 1, 'one copy of the bootstrap, in one place');
});

// ---------------------------------------------------------------------------
// The charts
// ---------------------------------------------------------------------------

const series = (values, { gapAt = [] } = {}) => values.map((v, i) => ({
  day: `2026-09-${String(i + 1).padStart(2, '0')}`,
  value: v,
  measured: !gapAt.includes(i),
}));

test('a day we did not measure is never drawn as a day with no traffic', () => {
  const { trafficChart } = viewsModule;
  // Day 2 is a gap. Day 3 is a MEASURED zero — the distinction this test exists
  // for, and the one my first fixture got wrong by putting the zero inside the gap.
  const points = series([3, 5, 0, 8, 4], { gapAt: [1] });
  const html = trafficChart({ points, label: 'Views' });

  // Every measured day is a bar, including the measured zero.
  assert.equal((html.match(/class="chart-bar/g) || []).length, 4);
  assert.match(html, /chart-bar-zero/, 'a day we measured at zero is a stub, not an absence');
  assert.match(html, /2026-09-03: 0 views \(measured, none\)/, 'and its tooltip says we looked');
  // Gaps are bands, drawn behind, and there is no bar for them.
  assert.equal((html.match(/class="chart-gap"/g) || []).length, 1, 'a gap run is one band');
  assert.ok(!/2026-09-02:/.test(html), 'an unmeasured day has no value to report');

  // And the accessible name says the quiet parts out loud rather than letting a
  // screen-reader user assume the line is solid.
  const label = /aria-label="([^"]+)"/.exec(html)[1];
  assert.match(label, /1 day was not measured and is not drawn as zero/);
  assert.match(label, /across 4 measured days/);
});

test('a chart describes itself in one sentence, with direction and peak', () => {
  const { trafficChart } = viewsModule;
  const rising = trafficChart({ points: series([1, 1, 1, 9, 9, 9]), label: 'Views' });
  assert.match(/aria-label="([^"]+)"/.exec(rising)[1], /rising across the window/);
  const falling = trafficChart({ points: series([9, 9, 9, 1, 1, 1]), label: 'Views' });
  assert.match(/aria-label="([^"]+)"/.exec(falling)[1], /falling across the window/);
  const flat = trafficChart({ points: series([4, 4, 4, 4]), label: 'Views' });
  assert.match(/aria-label="([^"]+)"/.exec(flat)[1], /peak 4 on 2026-09-01/);

  // One highlight, never several: marking peak, trough, first and last at once
  // is the documented way to defeat the point of a sparkline.
  const html = trafficChart({ points: series([1, 7, 2, 6, 3]), label: 'Views' });
  assert.equal((html.match(/chart-bar-peak/g) || []).length, 1);
  assert.ok(!/chart-bar-trough|chart-bar-first|chart-bar-last/.test(html));
});

test('a file sparkline is scaled by its caller, so rows can be compared', () => {
  const { sparkline } = viewsModule;
  const small = sparkline({ points: series([1, 0, 1]), max: 100 });
  const big = sparkline({ points: series([50, 100, 25]), max: 100 });
  const heightOf = (svg) => Number(/y="([\d.]+)"/.exec(svg)[1]);
  // The same peak value must draw the same height in both, and a small value
  // must be visibly shorter than a large one. Independent axes per row would make
  // a 5% change and a 500% change look identical.
  const tallSmall = 26 - heightOf(small);
  const tallBig = 26 - heightOf(big);
  assert.ok(tallBig > tallSmall * 3, 'the shared scale makes the big row visibly bigger');
  assert.match(big, /100 ad views/);
  // No axes, no gridlines, no legend — the number is in the column beside it.
  assert.ok(!/<line|grid|legend/i.test(sparkline({ points: series([2, 3]), max: 3 })));
});

test('an empty or flat series still says something true', () => {
  const { trafficChart, sparkline } = viewsModule;
  assert.match(trafficChart({ points: [] }), /Nothing to draw yet/);
  const flat = trafficChart({ points: series([0, 0, 0]), label: 'Views' });
  assert.match(/aria-label="([^"]+)"/.exec(flat)[1], /no activity yet/);
  assert.equal(sparkline({ points: [] }), '');
});

// ---------------------------------------------------------------------------
// The pages that exist when something is missing
// ---------------------------------------------------------------------------

test('a missing page is a page, not a bare pre tag', () => {
  const { notFound, serverError } = viewsModule;
  const page = notFound({ user: null, consent: null, requestedKind: 'store' });
  assert.match(page, /Error 404/);
  assert.match(page, /That store is not here/, 'the heading names what is missing');
  assert.match(page, /<h1/, 'it has a heading');
  assert.match(page, /href="\/marketplace"/, 'and a way back into the product');
  assert.match(page, /action="\/marketplace"/, 'and the search that actually exists');
  assert.match(page, /byte for byte the same as a store that never existed/,
    'a removed store and a store that never existed must be indistinguishable');
  // The forbidden shortcut is echoing the requested path, and the way this page
  // avoids it is by having no way to receive one: `notFound()` takes a KIND, never
  // a URL. (A `<script>` is present — that is the CSP-hashed reveal bootstrap every
  // page carries, which is why this asserts the signature rather than a substring.)
  const signature = viewsModule.notFound.toString().split('{')[0];
  assert.ok(!/path|url|req/i.test(signature), `the view cannot receive the address: ${signature.trim()}`);
  assert.ok(!/not-a-page/.test(page), 'nothing resembling a requested path is in the markup');

  const f = notFound({ requestedKind: 'file' });
  assert.match(f, /That file is not here/);
  assert.match(f, /minted per person/);

  const err = serverError({ requestId: 'abc12345' });
  assert.match(err, /Something broke on our side/);
  assert.match(err, /abc12345/, 'the request id is the only way to find the failure in the log');
  assert.match(err, /there is no charge to make/, 'and it says nothing was charged while money is manual');
});

test('a failure answers a browser with a page and an API client with JSON', () => {
  // Behaviour, not markup: this is the router's job, so read the source for the
  // negotiation and assert both branches exist rather than pretending a unit test
  // can boot the server.
  const server = readFileSync(path.join(root, 'server.js'), 'utf8');
  const handler = server.slice(server.indexOf('const requestId = crypto.randomBytes(4)'));
  assert.match(handler, /const wantsHtml = String\(req\.headers\.accept \|\| ''\)\.includes\('text\/html'\)/,
    'the answer depends on what the caller asked for');
  assert.match(handler, /res\.status\(status\)\.json\(\{/, 'JSON for API clients');
  assert.match(handler, /views\.serverError\(\{/, 'a page for browsers');
  assert.match(handler, /if \(res\.headersSent\) return undefined/,
    'and it must not try to answer twice if the response already started');
  // In production the message must not leak the failure itself.
  assert.ok(!/error: err\.message/.test(handler), 'the raw message never reaches the client');
});

test('every URL the sitemap lists is a URL the app actually serves', () => {
  // The first version listed /privacy and /terms. The legal documents live under
  // /legal/, so the sitemap handed crawlers two 404s — the most common sitemap
  // mistake there is, and invisible unless somebody checks each entry.
  const server = readFileSync(path.join(root, 'server.js'), 'utf8');
  const sitemap = server.slice(server.indexOf("APP.get('/sitemap.xml'"));
  const listed = [...sitemap.matchAll(/loc: '([^']+)'/g)].map((m) => m[1]);
  assert.ok(listed.length >= 5, 'the sitemap lists the marketing pages');
  // A route table, not a set: `/legal/privacy` is served by `/legal/:slug`, so
  // membership is "does some route pattern match this URL".
  //
  // Built segment by segment rather than by escaping the whole pattern first:
  // escaping first turns `:slug` into a literal and no parameterized route ever
  // matches, which is how the first version of this helper reported a false
  // failure against a route that exists.
  const patterns = [...server.matchAll(/APP\.get\('([^']+)'/g)].map((m) => m[1]);
  const escape = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const routeRegex = (pattern) => `^${pattern.split('/').map((seg) => (
    seg.startsWith(':') ? '[^/]+' : escape(seg)
  )).join('/')}$`;
  const serves = (url) => patterns.some((pattern) => new RegExp(routeRegex(pattern)).test(url));
  for (const loc of listed) {
    assert.ok(serves(loc), `sitemap lists ${loc} but no route serves it`);
  }
  // And the static list must not name a page whose route takes a parameter.
  assert.ok(!listed.some((l) => l.includes(':')), 'no route patterns in a sitemap');
});
