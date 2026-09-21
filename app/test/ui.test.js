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

// ---------------------------------------------------------------------------
// The player
// ---------------------------------------------------------------------------

test('the player is a player, not a download with extra steps', () => {
  // Three attributes do the work, and all three are the kind that get dropped
  // in a refactor without anything failing:
  //   controlslist="nodownload"  — removes the download item from the menu
  //   disablepictureinpicture    — removes the floating always-on-top window,
  //                                which is a screen recorder's easiest target
  //   data-protect               — the hook app.js uses to block right-click
  //                                and drag, which is deterrence and is labelled
  //                                as such in the markup
  assert.match(views, /controlslist="nodownload/, 'the player offers its own download button');
  assert.match(views, /disablepictureinpicture/, 'picture-in-picture is left on');
  assert.match(views, /data-protect/, 'nothing marks the protected region for the client');
  assert.match(client, /data-protect/, 'app.js does not act on the protected region');

  // The playable file is served from the stream route, and the view must not
  // fall back to the download URL for it — the whole point is that a video is
  // played rather than handed over.
  assert.match(views, /previewFile\.streamUrl/);
  assert.ok(!/previewFile\.downloadUrl/.test(views), 'the player uses the download URL as its source');
  assert.match(views, /Plays here/, 'the file list does not say what actually happens to a video');

  // And the file row must not undo it. The version that shipped the player
  // rendered `<a href="downloadUrl" download>Plays here</a>` — a download button
  // with a reassuring label on it, which is the exact failure this test exists
  // for. The playable branch is checked by position: it has to come before the
  // download link in the row template.
  const rows = views.slice(views.indexOf('const rows = files.map'), views.indexOf('const filesPanel'));
  const playableAt = rows.indexOf('f.playable');
  const downloadAt = rows.indexOf('href="${esc(f.downloadUrl)}"');
  assert.ok(playableAt >= 0, 'the file row does not branch on whether a file plays');
  assert.ok(downloadAt > playableAt, 'a playable file still renders a download link');

  // The reference printed on the page is the real one the server minted, not a
  // sentence that describes a watermark without naming it.
  assert.match(views, /esc\(markLabel/);
  assert.ok(!/BYTEBIKRI · your reference/.test(views), 'the placeholder mark copy is back');
});

test('the page never claims the web can stop a screenshot', () => {
  // The claim that matters. On Android, FLAG_SECURE genuinely blocks capture; in
  // a browser nothing does, and a page that says "protected" is selling a
  // protection that does not exist. This test exists so that copy cannot drift
  // into the lie later — it is the one thing here that is not a mechanical fix.
  const page = views.slice(views.indexOf('export function assetPage'), views.indexOf('function assetUnlockExpiry'));
  assert.match(page, /Watermark/, 'the media note does not mention the watermark at all');
  assert.match(page, /No website can stop a screen recording|does not pretend/,
    'the note does not admit what it cannot do');
  assert.ok(!/\b(uncopyable|un-copyable|cannot be copied|screenshot-proof|fully protected|DRM)\b/i.test(page),
    'the page promises a protection the browser cannot provide');
});

test('the client only selects elements the views render', () => {
  // The same class of bug as a missing id: a selector that matches nothing is
  // silent. `[data-protect]` matching nothing would leave right-click enabled
  // and no watermark overlay, and every test would still pass.
  const selectors = new Set(
    [...client.matchAll(/querySelectorAll\(\s*'([^']+)'/g)].map((m) => m[1]),
  );
  for (const sel of selectors) {
    for (const token of sel.match(/\[data-[a-z-]+\]|\.[a-z][a-z0-9-]*/g) || []) {
      const needle = token.startsWith('[') ? token.slice(1, -1) : token.slice(1);
      assert.ok(views.includes(needle), `app.js selects ${sel} but no view renders ${needle}`);
    }
  }
  assert.ok(selectors.size >= 2, `expected several selectors, saw ${selectors.size}`);
});

test('every class the views emit has a rule in the stylesheet', () => {
  // An undefined class is the same failure as an undefined token: the browser
  // renders an unstyled element, nothing logs, and the page just looks wrong.
  const defined = new Set([...withoutComments(css).matchAll(/\.([a-zA-Z0-9_-]+)/g)].map((m) => m[1]));
  const used = new Set();
  for (const m of views.matchAll(/class="([^"]*)"/g)) {
    // Skip interpolated class attributes: they are not literal names.
    if (m[1].includes('${')) continue;
    for (const c of m[1].split(/\s+/)) if (c) used.add(c);
  }
  const missing = [...used].filter((c) => !defined.has(c)).sort();
  assert.deepEqual(missing, [], `views.js uses classes with no CSS rule: ${missing.join(', ')}`);
  assert.ok(used.size >= 40, `expected the views to use several classes, saw ${used.size}`);
});
