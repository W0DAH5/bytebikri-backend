/**
 * The one vendored library, held to the terms it was vendored under.  npm test
 *
 * `public/vendor/hls.min.js` exists because the live shape needs an HLS client and
 * Chrome, Firefox, Edge and Android Chrome have none (ASSET_ECONOMY §14.2). Adding a
 * dependency to a repository that had refused one is exactly the decision that decays:
 * the file is downloaded once, patched quietly a year later, and the licence quietly
 * stops travelling with it.
 *
 * So these tests hold four things that are cheap to state and impossible to notice in a
 * browser:
 *
 *   1. the bytes are the bytes the NOTICE describes — a hash, checked against a constant
 *      this file carries, so replacing the library without saying so fails here;
 *   2. the version in the NOTICE and the version inside the bundle agree, which is what
 *      "pinned" means: an upgrade that forgets one of the two is caught;
 *   3. the licence notice travels with it, naming the licence and the copyright holders
 *      the package itself names;
 *   4. no external script host has entered the CSP. Vendoring is the reason the policy
 *      did not have to open, and a CDN added "for convenience" would make the licence
 *      question and the privacy question both worse at once.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const VERSION = '1.7.3';
const SHA256 = 'a12e7ee1cd64a69dcdb314157e45dafcba705bfb0b1440b7935cb265d374423e';
const BYTES = 619_692;

const bundle = await fs.readFile(path.join(root, 'public/vendor/hls.min.js'));
const notice = await fs.readFile(path.join(root, 'public/vendor/NOTICE.md'), 'utf8');
const licence = await fs.readFile(path.join(root, 'public/vendor/hls.min.js.LICENSE'), 'utf8');
const server = await fs.readFile(path.join(root, 'server.js'), 'utf8');

test('the vendored player is the published build, byte for byte', () => {
  assert.equal(bundle.length, BYTES, 'the vendored bundle is not the size the NOTICE claims');
  assert.equal(createHash('sha256').update(bundle).digest('hex'), SHA256,
    'the vendored bundle changed without the NOTICE (and this hash) changing with it');
});

test('the pinned version is pinned in both places', () => {
  assert.match(notice, new RegExp(`hls\\.js ${VERSION.replace(/\./g, '\\.')}\\b`),
    'the NOTICE does not name the pinned version');
  // The bundle declares its own version as a quoted constant (`var rs="1.7.3"`), and an
  // upgrade that swaps the file without the NOTICE — or the reverse — is exactly the
  // mistake this test exists to catch. Anchored on the quotes so a version-shaped number
  // somewhere else in a 605 KB bundle cannot satisfy it.
  assert.match(bundle.toString('utf8'), new RegExp(`"${VERSION.replace(/\./g, '\\.')}"`),
    'the vendored bundle does not carry the version the NOTICE pins');
});

test('the licence travels with the file, with the names the package itself names', () => {
  assert.match(licence, /Apache License, Version 2\.0/, 'the Apache-2.0 notice is missing');
  assert.match(licence, /Dailymotion/, 'the upstream copyright holder is not named');
  assert.match(licence, /Brightcove/, 'the derived-work attribution the package ships is not named');
  assert.match(notice, /hls\.min\.js\.LICENSE/, 'the NOTICE does not say where the licence is');
});

test('the CSP did not open for it', () => {
  const line = server.split('\n').find((l) => l.includes('scriptSrc:'));
  assert.ok(line, 'no scriptSrc directive found — the CSP is not where this test reads it');
  assert.match(line, /'self'/, 'scripts are no longer allowed from our own origin');
  assert.ok(!/https?:\/\//.test(line), `an external script host entered the CSP: ${line.trim()}`);
});
