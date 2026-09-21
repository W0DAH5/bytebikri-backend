/**
 * Security tests — the parts that are easy to get wrong and invisible when they
 * are wrong.
 *
 * A broken password check still returns "wrong password" for a wrong password,
 * so it passes any test written from the happy path. A storefront that leaks
 * another creator's dashboard still renders perfectly. The tests below aim at
 * the specific wrong implementations, not at the feature.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:55432/bytebikri_test';
process.env.SESSION_SECRET ||= 'test-session-secret';

const auth = await import('../src/auth.js');
const { storage } = await import('../src/store.js');
const { originCheck, rateLimit, cookieParser, setSessionCookie } = await import('../src/security.js');
const { close } = await import('../src/db.js');

after(async () => { await close(); });

// ── storage keys ─────────────────────────────────────────────────────────────

test('storage refuses keys that are not <namespace>/<uuid>.<ext>', async () => {
  // A key arrives from a URL on the public media route. `path.join('uploads',
  // '../../etc/passwd')` is a perfectly valid filesystem path, so the guard has
  // to be an allowlist on the shape — scanning for '..' misses encodings.
  const hostile = [
    '../../etc/passwd',
    '/etc/passwd',
    'public/../../../etc/passwd',
    'private/00000000-0000-0000-0000-000000000000.txt',
    'public/not-a-uuid.txt',
    'public/00000000-0000-0000-0000-000000000000.txt/../../secret',
    '',
    null,
  ];
  for (const key of hostile) {
    if (key === 'private/00000000-0000-0000-0000-000000000000.txt') continue; // shape is valid; namespace is the route's job
    await assert.rejects(
      () => storage.get(key),
      /bad storage key/,
      `storage.get accepted ${JSON.stringify(key)}`,
    );
  }
});

test('storage round-trips a well-formed key and namespaces the write', async () => {
  const key = await storage.put(Buffer.from('cover bytes'), 'cover.png', { namespace: 'public' });
  assert.match(key, /^public\/[0-9a-f-]{36}\.png$/, `unexpected key shape: ${key}`);
  assert.equal((await storage.get(key)).toString(), 'cover bytes');

  const priv = await storage.put(Buffer.from('gated'), 'file.txt');
  assert.match(priv, /^private\//, 'content must not land in the public namespace by default');
});

// ── passwords ────────────────────────────────────────────────────────────────

test('passwords hash with a self-describing parameter string, and verify', () => {
  const h = auth.hashPassword('correct horse battery staple');
  assert.match(h, /^scrypt\$\d+\$\d+\$\d+\$[A-Za-z0-9_\-]+\$[A-Za-z0-9_\-]+$/,
    'the hash must carry its own parameters, or changing them is a flag day');
  assert.ok(auth.verifyPassword('correct horse battery staple', h));
  assert.ok(!auth.verifyPassword('correct horse battery stapl', h));
  assert.ok(!auth.verifyPassword('', h));
});

test('two identical passwords produce different hashes', () => {
  // A shared salt would make identical passwords detectable in the table, which
  // turns one leaked dump into a rainbow-table lookup.
  const pw = 'a-long-enough-password';
  assert.notEqual(auth.hashPassword(pw), auth.hashPassword(pw));
});

test('verifying against a malformed stored hash is false, not a throw', () => {
  // A garbage column value must not 500 the login route.
  for (const bad of ['', 'nonsense', 'scrypt$x$y$z$a$b', 'scrypt$1$1$1$$']) {
    assert.equal(auth.verifyPassword('anything', bad), false);
  }
  assert.equal(auth.verifyPassword('anything', null), false);
});

test('an unknown account still burns password-hashing time', () => {
  // The enumeration oracle: if "no such user" returns in 0.1 ms and "wrong
  // password" takes 60 ms, the response time tells an attacker which addresses
  // are registered before they have guessed a single password.
  assert.equal(typeof auth.burnPasswordTime, 'function');
  const t0 = process.hrtime.bigint();
  auth.burnPasswordTime();
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.ok(ms > 5, `burnPasswordTime returned in ${ms.toFixed(2)}ms — too fast to hide anything`);
});

// ── sessions ─────────────────────────────────────────────────────────────────

test('only the hash of a session token is ever persisted', async () => {
  const crypto = await import('node:crypto');
  const user = await auth.createAccount({
    email: `sess-${Date.now()}@test.local`, password: 'a-long-enough-password', displayName: 'S',
  });
  const { token } = await auth.createSession({ userId: user.id, remember: true });

  // A session token is a bearer credential. If the database stores it in the
  // clear, then a leaked dump is a set of usable logins — no cracking required.
  const { scalar } = await import('../src/db.js');
  const stored = await scalar('select token_hash from sessions order by created_at desc limit 1');
  const sha = crypto.createHash('sha256').update(token).digest('hex');
  assert.notEqual(stored, token, 'the raw token is in the database');
  assert.equal(stored, sha, 'the stored value should be the sha256 of the token');

  const resolved = await auth.resolveSession(token);
  assert.equal(resolved?.id, user.id);
  assert.equal(await auth.resolveSession('not-a-real-token'), null);
});

test('revoking a session makes the token resolve to nothing', async () => {
  const user = await auth.createAccount({
    email: `rev-${Date.now()}@test.local`, password: 'a-long-enough-password',
  });
  const { token } = await auth.createSession({ userId: user.id });
  assert.ok(await auth.resolveSession(token));
  await auth.revokeSession(token);
  assert.equal(await auth.resolveSession(token), null);
});

test('a short password is refused with a status the route can use', async () => {
  await assert.rejects(
    () => auth.createAccount({ email: `short-${Date.now()}@test.local`, password: 'short' }),
    (err) => err.status === 400 && /8 characters/.test(err.message),
  );
});

test('lockout triggers on a run of failures from the same address', async () => {
  // Counted in the database, not in a process variable: a restart must not hand
  // an attacker a fresh budget.
  // The threshold is a plain count, and the count is queried from the database.
  assert.ok(auth.isLockedOut(8));
  assert.ok(auth.isLockedOut(9));
  assert.ok(!auth.isLockedOut(7));
  assert.ok(!auth.isLockedOut(0));
});

// ── download links ───────────────────────────────────────────────────────────

test('a download link signs, verifies, and rejects everything else', async () => {
  // This path broke in production and no test noticed, because nothing exercised
  // it: `readSecret` was not imported, every asset page with a downloadable file
  // threw a ReferenceError, and the suite stayed green. The lesson is that the
  // download URL is a feature, not glue, and it gets tested like one.
  const { signAccessToken, verifyAccessToken, issueDownloadUrl } = await import('../src/unlocks.js');
  const ids = { assetId: '11111111-1111-4111-8111-111111111111',
    fileId: '22222222-2222-4222-8222-222222222222',
    userId: '33333333-3333-4333-8333-333333333333' };

  const token = signAccessToken(ids);
  const check = verifyAccessToken(token);
  assert.equal(check.ok, true, `a freshly signed token did not verify: ${check.reason}`);
  assert.equal(check.payload.a, ids.assetId);
  assert.equal(check.payload.f, ids.fileId);
  assert.equal(check.payload.u, ids.userId);
  assert.ok(check.payload.exp > Date.now(), 'the token must carry an expiry');

  // The token is `<base64url payload>.<hmac>`, so a forged token is easy to
  // build with the right shape and the wrong signature. Two cases, because they
  // fail differently: an altered payload with the original MAC, and a payload
  // re-signed with nothing.
  const [, originalMac] = token.split('.');
  const tampered = Buffer.from(JSON.stringify({ ...check.payload, u: 'someone-else' })).toString('base64url');
  assert.equal(verifyAccessToken(`${tampered}.${originalMac}`).ok, false,
    'a token with a swapped user id verified — the MAC does not cover the whole payload');

  const unsigned = Buffer.from(JSON.stringify({ ...check.payload, exp: Date.now() + 1e9 })).toString('base64url');
  assert.equal(verifyAccessToken(`${unsigned}.`).ok, false, 'a token with no signature verified');
  assert.equal(verifyAccessToken(`${unsigned}`).ok, false, 'a token with no signature at all verified');

  assert.equal(verifyAccessToken('').ok, false);
  assert.equal(verifyAccessToken('not-a-token').ok, false);
  assert.equal(verifyAccessToken(null).ok, false);

  const url = issueDownloadUrl({ ...ids, file: { id: ids.fileId }, basePath: '' });
  assert.match(url, /^\/api\/content\/[0-9a-f-]{36}\/file\/[0-9a-f-]{36}\?t=/,
    'the download URL must be its own route, not a filesystem path');
});

test('an open asset is downloadable, and the entitlement is recorded', async () => {
  // The free half of the product was broken and the suite was green: the page
  // minted a link, no unlock row existed because no ad had run, and the download
  // route refused with "unlock no longer valid". Only the ad-gated path had ever
  // been exercised — which is the path a demo shows people.
  const { store } = await import('../src/store.js');
  const { grantUnlock } = store;
  const tag = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;

  const owner = await store.userByEmailOrCreate(`free-owner-${tag}@test.local`);
  const channel = await store.createChannel({ ownerId: owner.id, slug: `free-${tag}`, name: `Free ${tag}` });
  const asset = await store.createAsset({
    channelId: channel.id, title: `Open ${tag}`, slug: `open-${tag}`, unlockMode: 'open',
  });

  // No unlock exists until someone takes the file.
  assert.equal(await store.isUnlocked(asset.id, owner.id), false);

  const unlock = await grantUnlock({
    assetId: asset.id, channelId: channel.id, userId: owner.id,
    method: 'open', adsCompleted: 0, policy: { unlock_hours: 0 },
  });
  assert.equal(unlock.method, 'open', 'the ledger must say WHY access exists');
  assert.equal(unlock.expires_at, null, 'free access must not expire');
  assert.equal(await store.isUnlocked(asset.id, owner.id), true);

  // Taking it twice is not two entitlements — the same rule the postback path
  // depends on, and the reason this is an upsert rather than an insert.
  await grantUnlock({
    assetId: asset.id, channelId: channel.id, userId: owner.id,
    method: 'open', adsCompleted: 0, policy: { unlock_hours: 0 },
  });
  const { scalar } = await import('../src/db.js');
  assert.equal(await scalar('select count(*)::int from unlocks where asset_id = $1', [asset.id]), 1);
});

test('an expired download link is refused', async () => {
  const { signAccessToken, verifyAccessToken } = await import('../src/unlocks.js');
  const token = signAccessToken({ assetId: 'a', fileId: 'b', userId: 'c', ttlMs: -1000 });
  const check = verifyAccessToken(token);
  assert.equal(check.ok, false);
  assert.match(String(check.reason), /expir/i);
});

// ── origin / CSRF ────────────────────────────────────────────────────────────

/** Minimal req/res doubles — enough for a middleware that only reads headers. */
const fakeReq = ({ method = 'POST', path = '/x', headers = {}, cookies = {} } = {}) => ({
  method, path, cookies,
  protocol: 'https',
  get: (h) => headers[h.toLowerCase()],
});
const fakeRes = () => {
  const res = {
    statusCode: null, body: null, headers: {},
    status(c) { res.statusCode = c; return res; },
    json(b) { res.body = b; return res; },
    setHeader(k, v) { res.headers[k] = v; },
  };
  return res;
};

test('a cross-site state change is refused', () => {
  const mw = originCheck({ publicBaseUrl: 'https://bytebikri.example' });
  const res = fakeRes();
  mw(fakeReq({ headers: { 'sec-fetch-site': 'cross-site' } }), res, () => { throw new Error('should not pass'); });
  assert.equal(res.statusCode, 403);
});

test('same-origin and non-browser requests pass', () => {
  const mw = originCheck({ publicBaseUrl: 'https://bytebikri.example' });
  for (const headers of [
    { 'sec-fetch-site': 'same-origin' },
    { 'sec-fetch-site': 'none' },          // typed URL / bookmark
    {},                                     // curl, a provider's server
  ]) {
    let passed = false;
    mw(fakeReq({ headers }), fakeRes(), () => { passed = true; });
    assert.ok(passed, `should have passed: ${JSON.stringify(headers)}`);
  }
});

test('reads and the signature-verified postback are never origin-blocked', () => {
  const mw = originCheck({});
  let passed = 0;
  mw(fakeReq({ method: 'GET', headers: { 'sec-fetch-site': 'cross-site' } }), fakeRes(), () => { passed += 1; });
  mw(fakeReq({ path: '/api/ads/postback/house/abc', headers: { 'sec-fetch-site': 'cross-site' } }), fakeRes(), () => { passed += 1; });
  assert.equal(passed, 2, 'a provider callback has no browser origin and must not be refused at the door');
});

test('a browser without Fetch Metadata is judged on Origin', () => {
  const mw = originCheck({ publicBaseUrl: 'https://bytebikri.example' });
  const bad = fakeRes();
  mw(fakeReq({ headers: { origin: 'https://evil.example' } }), bad, () => { throw new Error('should not pass'); });
  assert.equal(bad.statusCode, 403);

  let passed = false;
  mw(fakeReq({ headers: { origin: 'https://bytebikri.example' } }), fakeRes(), () => { passed = true; });
  assert.ok(passed);
});

test('a malformed Origin is refused rather than thrown on', () => {
  const res = fakeRes();
  originCheck({})(fakeReq({ headers: { origin: 'not a url' } }), res, () => { throw new Error('should not pass'); });
  assert.equal(res.statusCode, 403);
});

// ── rate limiting ────────────────────────────────────────────────────────────

test('the limiter counts per key and answers 429 with Retry-After', () => {
  const mw = rateLimit({ windowMs: 60_000, max: 3, name: 'tests' });
  try {
    const results = [];
    for (let i = 0; i < 5; i += 1) {
      const res = fakeRes();
      mw(fakeReq({ headers: {} }), res, () => results.push('pass'));
      if (res.statusCode) results.push(res.statusCode);
    }
    assert.deepEqual(results, ['pass', 'pass', 'pass', 429, 429]);

    // A different source has its own budget: one abuser must not lock everyone out.
    let passed = false;
    mw({ ...fakeReq({}), ip: '10.0.0.9' }, fakeRes(), () => { passed = true; });
    assert.ok(passed);
  } finally { mw.stop(); }
});

// ── cookies ──────────────────────────────────────────────────────────────────

test('the session cookie is httpOnly and SameSite=Lax', () => {
  const res = { cookies: [], cookie(name, value, opts) { this.cookies.push({ name, value, opts }); } };
  setSessionCookie(res, 'tok', 1000);
  const [c] = res.cookies;
  assert.equal(c.name, 'bb_session');
  // httpOnly: script must not be able to read a session token, or one XSS is a
  // full account takeover that survives a password change.
  assert.equal(c.opts.httpOnly, true);
  // Lax rather than Strict: a Strict cookie is not sent when someone follows a
  // link into the store, so a signed-in visitor would appear signed out.
  assert.equal(c.opts.sameSite, 'lax');
  assert.equal(c.opts.path, '/');
});

test('the cookie parser handles quoting, padding and junk without throwing', () => {
  const parse = (header) => {
    const req = { headers: header === undefined ? {} : { cookie: header } };
    cookieParser()(req, {}, () => {});
    return req.cookies;
  };
  assert.deepEqual(parse('a=1; bb_session=abc'), { a: '1', bb_session: 'abc' });
  assert.deepEqual(parse('bb_session=a%3Db'), { bb_session: 'a=b' });
  assert.deepEqual(parse('novalue; b=2'), { b: '2' });
  assert.deepEqual(parse(undefined), {});
  assert.deepEqual(parse('broken=%E0%A4%A'), { broken: '%E0%A4%A' });   // bad escape, not a crash
});

test('failures are counted from the database, where a restart cannot erase them', async () => {
  // A unique address per run: `login_attempts` is append-only and shared with
  // every other run against this database, so an absolute count on a fixed
  // address would measure history rather than behaviour.
  const stamp = `${Date.now()}-${Math.random()}`;
  const me = `lock-${stamp}@test.local`;
  const other = `other-${stamp}@test.local`;
  const ipHash = auth.hashIp(`ip-${stamp}`);

  for (let i = 0; i < 3; i += 1) await auth.recordAttempt(me, false, ipHash);
  for (let i = 0; i < 2; i += 1) await auth.recordAttempt(other, false, ipHash);

  assert.equal(await auth.recentFailures(me, null), 3, 'failures for one email');
  // Rotating the email but not the address is still a signal — the count is over
  // `email = $1 OR ip_hash = $2`, not the email alone.
  assert.equal(await auth.recentFailures(other, null), 2, 'the other email');
  assert.equal(await auth.recentFailures(`third-${stamp}@test.local`, ipHash), 5,
    'a fresh email from the same address inherits the address\'s history');

  // A successful sign-in clears failures for THAT account — a person who
  // mistypes twice and then gets it right should not be two-eighths of the way
  // to a lockout. It must not launder the address, or holding one valid
  // credential would be a reset button for everything done from that machine.
  await auth.recordAttempt(me, true, ipHash);

  assert.equal(await auth.recentFailures(me, null), 0, 'my own failures are forgiven');
  assert.equal(await auth.recentFailures(other, null), 2, 'the other account is untouched');
  assert.equal(await auth.recentFailures(`third-${stamp}@test.local`, ipHash), 2,
    'and the address still answers for the failures that were not mine');
});
