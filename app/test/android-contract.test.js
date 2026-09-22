/**
 * The Android app must call endpoints that exist.
 *
 * This test exists because of the bug it would have caught: `ApiService.kt`
 * called `/api/signup`, `/api/signin`, `/api/assets`, `/api/upload`,
 * `/api/coins/{id}`, `/api/spend` and three `/api/admin/*` routes, and the
 * server implemented none of them. Not one screen in that app could ever have
 * worked, and nothing in this repository noticed — the Kotlin was never
 * compiled here and the server tests never looked across at it.
 *
 * So the contract is checked the cheap way: pull every route literal out of the
 * Kotlin, and assert the server has a route that matches it. It is not a
 * compiler. It is the one check that makes the mistake impossible to repeat
 * silently.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..', '..');
const androidSrc = path.join(root, 'android', 'app', 'src', 'main', 'kotlin');

const server = readFileSync(path.join(root, 'app', 'server.js'), 'utf8');

/** Every `.kt` file under the app, so a new screen cannot dodge this test. */
function kotlinFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...kotlinFiles(full));
    else if (entry.endsWith('.kt')) out.push(full);
  }
  return out;
}

const files = kotlinFiles(androidSrc);

/** Route literals: `/api/...` and `/login`, in a string, not in a comment. */
function routesIn(source) {
  const withoutComments = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  const found = new Set();
  for (const m of withoutComments.matchAll(/"(\/(?:api|login|logout|signup)[A-Za-z0-9/_-]*)"/g)) {
    found.add(m[1]);
  }
  // Interpolated paths: "/api/content/$assetId" and "/api/stores/$slug".
  for (const m of withoutComments.matchAll(/"(\/(?:api|login|logout|signup)[A-Za-z0-9/_-]*)\$\{?[A-Za-z]/g)) {
    found.add(m[1]);
  }
  return [...found];
}

/** Does server.js declare a route whose path matches this one? */
function serverHasRoute(route) {
  const parts = route.split('/').filter(Boolean);        // ['api','content',':assetId']
  // The last segment is a parameter in the Kotlin literal; drop it unless the
  // server also has a literal there.
  const literal = parts.filter((p) => !/^[A-Za-z]*Id$|^slug$/.test(p));
  const pattern = literal
    .map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('/');
  if (pattern === 'login' || pattern === 'signup' || pattern === 'logout') {
    return server.includes(`APP.post('/${pattern}'`);
  }
  return server.includes(`'/${pattern}`) || server.includes(`'/${pattern}/`);
}

test('every endpoint the Android app calls exists on the server', () => {
  assert.ok(files.length >= 5, `expected the app to have several Kotlin files, found ${files.length}`);

  const called = new Set();
  for (const file of files) for (const route of routesIn(readFileSync(file, 'utf8'))) called.add(route);

  assert.ok(called.size >= 4, `expected several endpoints, found ${called.size}: ${[...called]}`);

  const missing = [...called].filter((r) => !serverHasRoute(r)).sort();
  assert.deepEqual(
    missing, [],
    `the app calls endpoints the server does not implement: ${missing.join(', ')}. `
    + 'This is the failure the whole module shipped with.',
  );
});

test('the app does not call the endpoints that were parked or rejected', () => {
  // `/api/coins` and `/api/spend` were coins and buyer payments. Both were
  // decided against: there is no price in this product and the ad network pays
  // the creator directly, so a wallet in the client is a promise the backend
  // must not keep. A deleted endpoint that reappears in a client is worse than
  // one that never existed, because the UI around it looks real.
  const all = files.map((f) => readFileSync(f, 'utf8')).join('\n');
  for (const gone of ['/api/coins', '/api/spend', '/api/admin', '/api/signup', '/api/signin', '/api/upload']) {
    assert.ok(!all.includes(`"${gone}`), `the app still calls ${gone}`);
  }

  // And no price field anywhere: the client cannot display what does not exist.
  assert.ok(!/\bpriceCoins\b/.test(all), 'a price field is back in the client');
  assert.ok(!/\bwallet\b/i.test(all.replace(/\/\*[\s\S]*?\*\//g, '')), 'a wallet screen is back');
});

test('the app protects its windows with FLAG_SECURE and says what that does not cover', () => {
  const all = files.map((f) => readFileSync(f, 'utf8')).join('\n');
  // Comments are where the mistakes are explained, so they must not count as
  // code — otherwise the note saying "this was wrong" fails the test that says
  // it must not come back.
  const code = all
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  assert.match(code, /FLAG_SECURE/, 'nothing sets FLAG_SECURE');
  // The wrong answer this module shipped with: FLAG_PRESENTATION is about cast
  // displays, not recording, and is always false on a phone.
  assert.ok(!/FLAG_PRESENTATION/.test(code), 'FLAG_PRESENTATION is back as a recording detector');
  assert.ok(!/killProcess/.test(code), 'the app kills its own process again');
  // Android 14+ screenshot callback, which is the real API.
  assert.match(all, /registerScreenCaptureCallback/, 'the API 34 screenshot callback is gone');
  // The claim has to stay honest: no promise of an impossible protection.
  assert.ok(!/screenshots? (?:are )?(?:blocked|prevented) (?:on|for) (?:the )?web/i.test(all));
  assert.match(all, /cannot be prevented|screen recording/, 'the honest note about recording is gone');
});

test('the app can be told "not here", and which decision said so', () => {
  // The server has always sent the country decision — the app just could not
  // read it. A file can be listed and still be unlocked by nobody in your
  // country, and the screen drew an unlock button anyway; the person tapped it,
  // watched the ad, and got a failure. Two fields close it: whether an unlock is
  // possible for this viewer, and which of the two decisions (a country rule, or
  // the file's own state) is refusing.
  const service = files.find((f) => f.endsWith('ApiService.kt'));
  assert.ok(service, 'ApiService.kt is gone; this test no longer tests anything');
  const kt = readFileSync(service, 'utf8');

  assert.match(kt, /val\s+unlockable\s*:\s*Boolean/, 'the client does not read `unlockable`');
  assert.match(kt, /val\s+unavailableFor\s*:\s*String\?/, 'the client does not read `unavailableFor`');
  // A typed refusal, so a screen can render a decision instead of "try again".
  assert.match(kt, /class\s+NotAvailableHere/, 'there is no typed country/file refusal');
  assert.match(kt, /451/, 'the client does not treat 451 as an answer');
  // The client has to see the refusal BODY to know which decision said no: 403
  // covers both a creator withholding their file and an operator removing it.
  assert.match(kt, /val\s+body\s*:\s*String/, 'the refusal body is thrown away again');
  assert.match(kt, /field\("unavailableFor"\)/, 'the client guesses the reason from the status code');

  // Both halves of the wire. The server must send what the client parses, or
  // this test would pin one side of a contract nobody completes.
  assert.match(server, /unlockable: a\.availability\.unlockable/, 'the server stopped sending `unlockable`');
  assert.match(server, /unavailableFor: a\.availability\.unlockable \? null : a\.availability\.reason/,
    'the list stopped saying which decision refuses');
  // The store itself can be withheld — the whole screen, not one file — and that
  // refusal speaks the same vocabulary.
  assert.match(server, /unavailableFor: 'country',/, 'a refused store stopped naming the refusal');
  assert.match(kt, /suspend fun store\(slug: String\)[\s\S]{0,900}NotAvailableHere/,
    'the store screen cannot tell a country refusal from a failure');
  // Every refusal path, not just the friendliest one: a token minted in one
  // country is checked again at the bytes, and that refusal has to explain
  // itself the same way.
  const refusalBodies = [...server.matchAll(/unavailableFor: refusal\.availability\.reason/g)];
  assert.equal(refusalBodies.length, 2,
    `expected the detail and the byte routes to name the refusal, found ${refusalBodies.length}`);
});
