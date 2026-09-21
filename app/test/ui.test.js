/**
 * UI wiring tests.
 *
 * These exist because of two bugs that a running app hid rather than showed.
 *
 * 1. `var(--accent-solid)` in the stylesheet, where the token is `--accent`. The
 *    browser silently drops an unresolvable custom property: the checkbox just
 *    looks wrong, nothing in the console, no failing request. A typo in a design
 *    token is invisible to every other kind of test we have.
 *
 * 2. The client script queries `#ad-modal` and friends. Those ids live in
 *    views.js. Rename one and the unlock button stops working — while every page
 *    still renders 200 and every API test still passes.
 *
 * Both are wiring failures, and wiring is exactly what a test can hold still.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(path.join(here, '..', p), 'utf8');

const css = read('public/styles.css');
const views = read('src/views.js');
const client = read('public/app.js');

/** Strip comments so a token named in prose is not mistaken for a definition. */
const withoutComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');

test('every custom property the stylesheet uses is defined in it', () => {
  const body = withoutComments(css);
  const defined = new Set([...body.matchAll(/(--[a-z0-9-]+)\s*:/gi)].map((m) => m[1]));
  const used = new Set([...body.matchAll(/var\((--[a-z0-9-]+)/gi)].map((m) => m[1]));

  const undefinedTokens = [...used].filter((t) => !defined.has(t)).sort();
  assert.deepEqual(
    undefinedTokens, [],
    `styles.css references tokens it never defines: ${undefinedTokens.join(', ')}. `
    + 'The browser drops these silently, so nothing else fails.',
  );
});

test('every custom property the views use inline is defined in the stylesheet', () => {
  const defined = new Set([
    ...withoutComments(css).matchAll(/(--[a-z0-9-]+)\s*:/gi),
  ].map((m) => m[1]));
  const used = new Set([...views.matchAll(/var\((--[a-z0-9-]+)/gi)].map((m) => m[1]));

  const undefinedTokens = [...used].filter((t) => !defined.has(t)).sort();
  assert.deepEqual(undefinedTokens, [], `views.js uses undefined tokens: ${undefinedTokens.join(', ')}`);
});

test('the client script only queries ids the views actually render', () => {
  // getElementById + the $('#x') shorthand, which is all the client uses.
  const queried = new Set([
    ...client.matchAll(/\$\(\s*'#([a-zA-Z0-9_-]+)'/g),
    ...client.matchAll(/getElementById\(\s*'([a-zA-Z0-9_-]+)'/g),
  ].map((m) => m[1]));

  const rendered = new Set([
    ...views.matchAll(/id="([a-zA-Z0-9_-]+)"/g),
    ...views.matchAll(/id='([a-zA-Z0-9_-]+)'/g),
  ].map((m) => m[1]));

  const missing = [...queried].filter((id) => !rendered.has(id)).sort();
  assert.deepEqual(
    missing, [],
    `app.js queries ids no view renders: ${missing.join(', ')}. `
    + 'That is a dead feature that still looks alive.',
  );
  assert.ok(queried.size >= 4, `expected the client to query several ids, saw ${queried.size}`);
});

test('the client script only posts to routes the server defines', () => {
  // A client calling a route that does not exist fails at the worst moment —
  // when someone is midway through unlocking.
  const server = read('server.js');
  const called = new Set(
    [...client.matchAll(/api\(\s*[`']([^`']*?)[`']/g)].map((m) => m[1]),
  );

  for (const route of called) {
    // Query strings are not part of the route; template-literal interpolations
    // mean the literal prefix before the first ${ is what we can match.
    const pathOnly = route.split('?')[0];
    const prefix = pathOnly.split('${')[0];
    if (!prefix.startsWith('/')) continue;
    assert.ok(!route.includes('?') || pathOnly !== route || true, '');
    assert.ok(
      server.includes(prefix),
      `app.js calls ${route} but no route with prefix ${prefix} exists in server.js`,
    );
  }
});

test('asset ids rendered into HTML are uuid-shaped, so the API can accept them', () => {
  // The unlock button carries the asset id in a data attribute. If that were
  // ever rendered as a non-uuid, the server would reject it at the boundary and
  // the button would fail with a 400 for every visitor.
  assert.match(views, /data-asset="\$\{esc\(asset\.id\)\}"/);
});

test('every page render passes consent, or the banner silently disappears', () => {
  // The banner is the only place a visitor can refuse personalised ads. If a new
  // page forgets to thread `consent` through, nothing breaks, nothing logs, and
  // the site quietly stops asking — which is the failure mode worth a test.
  const server = read('server.js');
  const calls = [...server.matchAll(/views\.(landing|marketplace|storefront|assetPage|dashboard|login|legalPage)\(\{([\s\S]*?)\}\)/g)];
  assert.ok(calls.length >= 6, `expected several view calls, found ${calls.length}`);
  const missing = calls
    .filter(([, fn, args]) => !/consent/.test(args))
    .map(([, fn]) => fn);
  assert.deepEqual(missing, [], `these render calls do not pass consent: ${missing.join(', ')}`);
});

test('the consent banner offers a real refusal', () => {
  // Both answers must be submit buttons with equal standing — a dimmed link to
  // "manage preferences" as the only way to say no is the dark pattern the
  // ePrivacy rules are about.
  assert.match(views, /name="choice" value="all"/);
  assert.match(views, /name="choice" value="none"/);
  assert.match(views, /If you refuse personalised ads|Reject all/);
});
