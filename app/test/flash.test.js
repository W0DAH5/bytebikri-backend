/**
 * The sentence a success redirect earns.  npm test
 *
 * A person who has just done something consequential lands back on a page with one
 * line at the top of it: that line is the only thing telling them what happened. The
 * review found it saying "Saved." after a person sent NPR 149 by hand on a manual
 * rail, where the product had written:
 *
 *   "Sent. An operator checks that reference against the platform's own statement —
 *    nothing is worn until it is matched, and if it never is, nothing about your
 *    account changes."
 *
 * The sentence existed, was reviewed, and was unreachable: the dispatch matched
 * parameter NAMES, and a generic `saved` key sat in the map casting its shadow over
 * every outcome the `saved` VALUE could have named. Seven outcomes were dark —
 * `plus-claimed`, `plus-look`, `plus-stopped`, `doc`, `doc-replaced`, `withdrawn`,
 * `withdrawn-doc` — and no test noticed, because a test that drives a view directly
 * hands it the flash object rather than making the server choose one.
 *
 * So this file tests the RULE (against a map small enough to read) and the
 * VOCABULARY (against the real map, read out of `server.js`, the way
 * `test/adscale.test.js` reads the publish path). The second half is the one that
 * would have caught the original defect: every outcome a route can name must have a
 * sentence, and that sentence must not be the generic one.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const server = readFileSync(path.join(here, '..', 'server.js'), 'utf8');

const { successFlash } = await import('../src/flash.js');

/** A map with the exact shape the real one has, including the generic `saved`. */
const MAP = {
  published: (v) => `Published ${v}.`,
  saved: () => 'Saved.',
  'plus-claimed': () => 'Sent. An operator checks that reference.',
  'doc-replaced': () => 'Replaced the copy you had already sent.',
};

test('the value of `saved` names the outcome, and is asked before the name', () => {
  // This is the defect, in one line: the generic `saved` builder is in the map, and
  // the specific one must still win when the VALUE names an outcome.
  assert.equal(successFlash(MAP, { saved: 'plus-claimed' }).message, 'Sent. An operator checks that reference.');
  assert.equal(successFlash(MAP, { saved: 'doc-replaced' }).message, 'Replaced the copy you had already sent.');
});

test('a value that names nothing falls back to the generic sentence, never to nothing', () => {
  // `?saved=1` is how a route with nothing to explain reports, and an unrecognised
  // value must not leave the page silent: a person who has just pressed a button and
  // sees no line at all cannot tell whether it worked.
  assert.equal(successFlash(MAP, { saved: '1' }).message, 'Saved.');
  assert.equal(successFlash(MAP, { saved: 'nonsense' }).message, 'Saved.');
  assert.equal(successFlash(MAP, { saved: true }).message, 'Saved.');
});

test('routes that report by parameter name are unaffected', () => {
  assert.equal(successFlash(MAP, { published: 'rara-lake' }).message, 'Published rara-lake.');
  assert.equal(successFlash(MAP, {}), null, 'no parameter, no sentence');
  assert.equal(successFlash(MAP, { error: 'nope' }), null, 'an error is not a success');
});

test('every outcome a route can name has a sentence of its own', () => {
  // The vocabulary half, read from the file that owns it. A route that redirects
  // `?saved=<value>` for a value with no builder is a route whose success is silent;
  // a route that names a value whose builder is the generic one is a route that has
  // written a sentence nobody will read.
  //
  // Comments are stripped first: the flow that redirects here carries a comment using
  // `?saved=x` as an EXAMPLE of what a fragment does to a query string, and a test
  // that cannot tell copy from code reports the copy as a defect (it did, on the
  // first run of this file).
  const code = server
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');

  const start = code.indexOf('const SUCCESS_FLASH = {');
  assert.ok(start > 0, 'the vocabulary is where this test expects it');
  const body = code.slice(start, code.indexOf('\n};', start));
  const keys = new Set([...body.matchAll(/^  '?([a-z0-9-]+)'?:/gm)].map((m) => m[1]));

  // Every value a route can put in `?saved=`: the literals, and the three dynamic
  // sites, each of which resolves to a small closed set written a few lines above it.
  const named = new Set();
  for (const m of code.matchAll(/\?saved=([a-z0-9-]+)/g)) named.add(m[1]);
  for (const m of code.matchAll(/'asked-with-doc' : 'asked'\)[\s\S]{0,80}?'already-with-doc' : 'already'/g)) {
    for (const v of ['asked-with-doc', 'asked', 'already-with-doc', 'already']) named.add(v);
  }
  for (const m of code.matchAll(/const outcome = [^\n]*'([a-z-]+)' : '([a-z-]+)'/g)) {
    named.add(m[1]); named.add(m[2]);
  }
  for (const v of ['noticed', 'noticed-logged']) named.add(v);

  const dark = [...named].filter((v) => v !== '1' && !keys.has(v));
  assert.deepEqual(dark, [], `every named outcome has a sentence: ${dark.join(', ')}`);
  assert.ok(keys.has('plus-claimed') && keys.has('plus-look') && keys.has('plus-stopped'),
    'the money flow keeps its three sentences');
  assert.ok(named.size >= 12, `the scan found the routes (${named.size} outcomes)`);
});
