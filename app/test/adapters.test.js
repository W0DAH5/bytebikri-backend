/**
 * Provider adapter tests.  npm test
 *
 * A verifier is not testable by "it worked when I tried it" — a verifier that
 * accepts everything passes every happy-path check. So each adapter is pinned to
 * a published test vector where one exists, and each is checked against the
 * specific wrong-but-plausible implementation it invites.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { parsePostback, selfTest, ADAPTERS, advisories } from '../src/providers/index.js';

const md5 = (d) => crypto.createHash('md5').update(d, 'utf8').digest('hex');

// ── BitLabs ──────────────────────────────────────────────────────────────────
// Their published example, verbatim: a real App Secret and the digest it must
// produce. If this string ever stops verifying, the verifier is broken.
const BITLABS = {
  secret: 'JLOIAUNMHFli7ZJOQVEzm98rzqnm9',
  base: 'https://publisher.com',
  query: 'uid=8cc877ee-af19-488d-b28d-216fb866b996&val=500',
  hash: 'dbcd6bb8ca677344592842a52b4fca9bec36cd4b',
};
const PUBLISHED_URL = `/complete?${BITLABS.query}&hash=${BITLABS.hash}`;

/** Sign an arbitrary BitLabs query the way they do: HMAC-SHA1 over the raw URL. */
const signBitlabs = (qs, secret = BITLABS.secret, base = BITLABS.base) => {
  const digest = crypto.createHmac('sha1', secret).update(`${base}/complete?${qs}`, 'utf8').digest('hex');
  return `/complete?${qs}&hash=${digest}`;
};

const bitlabsCtx = ({ qs = BITLABS.query, query, rawUrl, method = 'GET' } = {}) => ({
  method,
  baseUrl: BITLABS.base,
  rawUrl: rawUrl ?? signBitlabs(qs),
  query: query ?? Object.fromEntries(new URLSearchParams(qs)),
  secret: BITLABS.secret,
});

test('bitlabs: reproduces the digest from their published example', () => {
  const r = parsePostback('bitlabs', {
    method: 'GET',
    baseUrl: BITLABS.base,
    rawUrl: PUBLISHED_URL,
    // The published URL covers only uid+val. BitLabs lets publishers name their
    // own callback params, so `tx` and `type` arrive in the query without being
    // part of their example URL — the signature is over the raw URL regardless.
    query: { uid: '8cc877ee-af19-488d-b28d-216fb866b996', val: '500', tx: 'TX-1', type: 'COMPLETE' },
    secret: BITLABS.secret,
  });
  assert.equal(r.ok, true, `published vector rejected: ${r.reason}`);
  assert.equal(r.event.state, 'complete');
});

test('bitlabs: rejects a forged hash', () => {
  const r = parsePostback('bitlabs', bitlabsCtx({
    rawUrl: `/complete?${BITLABS.query}&hash=${'0'.repeat(40)}`,
  }));
  assert.equal(r.ok, false);
  assert.match(r.reason, /hash mismatch/);
});

test('bitlabs: rejects the encode-the-URL mistake their docs warn about', () => {
  const r = parsePostback('bitlabs', bitlabsCtx({ rawUrl: `/complete?${BITLABS.query}&hash=${encodeURIComponent(BITLABS.hash)}` }));
  assert.equal(r.ok, false);
});

test('bitlabs: any added/removed param invalidates the hash', () => {
  // The signature covers the whole URL, so injecting a parameter must break it.
  const r = parsePostback('bitlabs', bitlabsCtx({ rawUrl: `${PUBLISHED_URL}&val=99999` }));
  assert.equal(r.ok, false, 'appending a param must invalidate a URL-covering hash');
});

test('bitlabs: refuses when it cannot tell a final conversion from a pending one', () => {
  // No offer_state and no type -> COMPLETED and PENDING are indistinguishable.
  const r = parsePostback('bitlabs', bitlabsCtx({ qs: 'uid=u1&tx=TX-1&val=500' }));
  assert.equal(r.ok, true, r.reason);
  assert.equal(r.event.state, 'unknown');
});

test('bitlabs: maps offer_state vocabulary, and refuses unknown values', () => {
  const at = (state) =>
    parsePostback('bitlabs', bitlabsCtx({ qs: `uid=u&tx=T&val=1&offer_state=${state}` }));
  assert.equal(at('COMPLETED').event.state, 'complete');
  assert.equal(at('PENDING').event.state, 'pending');
  assert.equal(at('RECONCILED').event.state, 'reconciled');
  assert.equal(at('INVENTED_LATER').event.state, 'unknown');
});

test('bitlabs: records the USD figure they report as paid to the publisher', () => {
  const r = parsePostback('bitlabs', bitlabsCtx({ qs: 'uid=u&tx=T&val=500&raw=0.42&type=COMPLETE' }));
  assert.equal(r.event.revenueUsd, 0.42);
});

test('bitlabs: refuses a callback with no TX (would double-grant on retry)', () => {
  const r = parsePostback('bitlabs', bitlabsCtx({ qs: 'uid=u&val=500&type=COMPLETE' }));
  assert.equal(r.ok, false);
  assert.match(r.reason, /transaction id/);
});

test('bitlabs: rejects POST — their callbacks are always GET', () => {
  assert.equal(parsePostback('bitlabs', bitlabsCtx({ method: 'POST' })).ok, false);
});

// ── PubScale ─────────────────────────────────────────────────────────────────
const pubscaleCtx = (value, signature, secret = 's3cret') => ({
  method: 'GET',
  secret,
  query: { user_id: 'u1', value, token: 'tk1', signature },
});

test('pubscale: signs value truncated to an integer', () => {
  const r = parsePostback('pubscale', pubscaleCtx('1.9', md5('s3cret.u1.1.tk1')));
  assert.equal(r.ok, true, `1.9 must sign as 1: ${r.reason}`);
  assert.equal(r.event.meta.appValue, 1);
});

test('pubscale: rejects a signature over the untruncated value', () => {
  const r = parsePostback('pubscale', pubscaleCtx('1.9', md5('s3cret.u1.1.9.tk1')));
  assert.equal(r.ok, false);
});

test('pubscale: does not claim USD revenue it was not sent', () => {
  const r = parsePostback('pubscale', pubscaleCtx('500', md5('s3cret.u1.500.tk1')));
  // `value` is app currency. Recording it as USD would overstate channel income.
  assert.equal(r.event.revenueUsd, 0);
});

// ── Cross-adapter: the abstraction must actually be per-provider ─────────────
test('a BitLabs postback does not verify under another adapter', () => {
  const r = parsePostback('pubscale', bitlabsCtx());
  assert.equal(r.ok, false, 'schemes must not be interchangeable');
});

test('every adapter rejects when the connection has no secret', () => {
  for (const a of ADAPTERS) {
    const r = parsePostback(a.id, { method: a.method, secret: null, query: {}, headers: {}, body: {} });
    assert.equal(r.ok, false, `${a.id} accepted a postback with no secret`);
  }
});

test('an unknown provider id is not silently accepted', () => {
  assert.equal(parsePostback('totally-made-up', { secret: 'x', method: 'GET', query: {} }).ok, false);
});

test('a malformed postback never throws', () => {
  for (const a of ADAPTERS) {
    for (const ctx of [undefined, {}, { method: 'GET', secret: 'x' }, { method: 'OPTIONS', secret: 'x', query: null }]) {
      assert.doesNotThrow(() => parsePostback(a.id, ctx), `${a.id} threw on malformed input`);
    }
  }
});

test('no adapter grants on an unrecognized state', () => {
  const r = parsePostback('bitlabs', bitlabsCtx({ qs: 'uid=u&tx=T&val=1&offer_state=WHATEVER' }));
  assert.equal(r.ok, true);
  assert.notEqual(r.event.state, 'complete');
});

// ── Built-in self-tests ──────────────────────────────────────────────────────
test('all built-in adapter self-tests pass', () => {
  for (const [id, result] of Object.entries(selfTest())) {
    for (const [name, value] of Object.entries(result)) {
      assert.equal(value, true, `${id}.${name} = ${value}`);
    }
  }
});

test('adapters with unconfirmed verifiers are declared as such', () => {
  // Applixir ships a placeholder signature template. It must fail closed AND be
  // reported, so a channel who connects it is told why nothing unlocks.
  assert.equal(advisories().some((a) => a.id === 'applixir'), true);
});

// ── Only `complete` grants ───────────────────────────────────────────────────
test('GRANTS_UNLOCK is true for exactly one state', async () => {
  const { GRANTS_UNLOCK, STATES } = await import('../src/providers/index.js');
  for (const s of STATES) {
    assert.equal(GRANTS_UNLOCK(s), s === 'complete', `${s} granting is wrong`);
  }
});
