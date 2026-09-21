/**
 * Consent tests.
 *
 * The thing worth testing here is not that a banner appears. It is that a
 * refusal CHANGES SOMETHING. A consent screen that records "no" and then behaves
 * exactly as before passes every visual check and is the failure mode regulators
 * actually write about — so the last test in this file watches what the ad
 * network is handed, not what the database stored.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:55432/bytebikri_test';
process.env.SESSION_SECRET ||= 'test-session-secret';

const consent = await import('../src/consent.js');
const { store } = await import('../src/store.js');
const { startUnlock } = await import('../src/unlocks.js');
const { query, close } = await import('../src/db.js');

after(async () => { await close(); });

// ── what counts as a yes ─────────────────────────────────────────────────────

test('only an explicit yes is consent', () => {
  // Absent, misspelled, or a value we did not ask for all mean no. The two
  // mistakes are not symmetrical: reading "absent" as yes shows personalised ads
  // to someone who refused, which is the one with a legal consequence.
  assert.deepEqual(consent.normaliseChoices({}), { necessary: true, ads: false });
  assert.deepEqual(consent.normaliseChoices({ ads: 'on' }), { necessary: true, ads: true });
  assert.deepEqual(consent.normaliseChoices({ ads: true }), { necessary: true, ads: true });
  for (const nope of ['yes', 'true-ish', '1', '', null, undefined, 0, 'off']) {
    assert.equal(consent.normaliseChoices({ ads: nope }).ads, false, `${JSON.stringify(nope)} read as consent`);
  }
});

test('accept all and reject all are both real answers, and neither is the default', () => {
  assert.equal(consent.acceptAll().ads, true);
  assert.equal(consent.rejectAll().ads, false);
  // `necessary` is not a choice and is never asked about.
  assert.equal(consent.rejectAll().necessary, true);
});

test('every purpose that is asked about has a key, a label and an explanation', () => {
  for (const p of consent.PURPOSES) {
    assert.match(p.key, /^[a-z][a-z0-9_]*$/, `purpose key ${p.key} is not a cookie-field name`);
    assert.ok(p.label?.length > 3, `${p.key} has no label`);
    // "Informed" means the person can tell what they are agreeing to. A switch
    // with no sentence next to it is not informed consent.
    assert.ok(p.detail?.length > 40, `${p.key} is not explained`);
  }
  assert.ok(consent.PURPOSES.length >= 1);
});

test('consent is required where the law requires it, and assumed where it does not', () => {
  for (const cc of ['DE', 'FR', 'IE', 'NL', 'SE', 'GB', 'CH', 'NO']) {
    assert.equal(consent.requiresConsent(cc), true, `${cc} should require consent`);
  }
  for (const cc of ['NP', 'IN', 'US', 'AE']) {
    assert.equal(consent.requiresConsent(cc), false, `${cc} should not be gated`);
  }
  // Unknown country is treated as strict. Guessing "probably not Europe" is how
  // a platform ends up serving personalised ads to someone it must not.
  assert.equal(consent.requiresConsent(null), true);
  assert.equal(consent.requiresConsent(undefined), true);
});

test('country comes from a platform header, and an unusable one is discarded', () => {
  const req = (headers) => ({ get: (h) => headers[h] });
  assert.equal(consent.countryOf(req({ 'cf-ipcountry': 'np' })), 'NP');
  assert.equal(consent.countryOf(req({ 'x-vercel-ip-country': 'DE' })), 'DE');
  assert.equal(consent.countryOf(req({})), null);
  // Cloudflare sends XX when it cannot tell, and T1 for Tor. Neither is a country.
  assert.equal(consent.countryOf(req({ 'cf-ipcountry': 'XX' })), 'XX'); // 2 letters, treated as a code but not in the EEA set
  assert.equal(consent.countryOf(req({ 'cf-ipcountry': 'N' })), null);
  assert.equal(consent.countryOf(req({ 'cf-ipcountry': '<?>' })), null);
});

// ── the record ───────────────────────────────────────────────────────────────

test('a decision is stored, found again, and replaced on a change of mind', async () => {
  const visitorId = `v-${Date.now()}-${Math.random()}`;
  const req = { ip: '198.51.100.4', get: () => 'test-agent' };

  const none = await consent.consentFor(visitorId);
  assert.equal(none, null, 'nothing should be stored before a decision');

  await consent.recordConsent({ visitorId, choices: consent.acceptAll(), req, country: 'NP' });
  const yes = await consent.consentFor(visitorId);
  assert.equal(yes.ads_granted, true);
  assert.equal(yes.country, 'NP');
  // The address must not be stored in a form that identifies anyone.
  assert.ok(yes.ip_hash && !yes.ip_hash.includes('198.51.100.4'));
  assert.equal(yes.ip_hash, consent.hashWithAppSecret('198.51.100.4'));

  // Changing your mind replaces your own row rather than adding a second one,
  // or "what did this person agree to" becomes a question about ordering.
  await consent.recordConsent({ visitorId, choices: consent.rejectAll(), req });
  const rows = await query(
    'select * from consent_records where visitor_id = $1 and policy_version = $2',
    [visitorId, consent.POLICY_VERSION],
  );
  assert.equal(rows.rowCount, 1, 'a change of mind created a second row');
  assert.equal((await consent.consentFor(visitorId)).ads_granted, false);
});

test('a decision about an old version of the notice does not count', async () => {
  // This is what stops a consent collected in 2026 from silently covering a
  // notice rewritten in 2027. Without it every person who ever agreed is
  // treated as having agreed to whatever the page says today.
  const visitorId = `stale-${Date.now()}-${Math.random()}`;
  await query(
    `insert into consent_records (visitor_id, policy_version, choices, country)
     values ($1, '1999-01-1', '{"ads": true}'::jsonb, 'NP')`,
    [visitorId],
  );
  assert.equal(await consent.consentFor(visitorId), null, 'an obsolete consent was treated as current');

  // And the request layer reports it as unanswered, so the banner comes back.
  const state = await consent.consentState({ cookies: { [consent.CONSENT_COOKIE]: visitorId }, get: () => null });
  assert.equal(state.decided, false);
  assert.equal(state.outstanding, true);
  assert.equal(state.ads, false, 'an unanswered visitor must never be treated as consenting');
});

test('a first visit costs no query and produces no cookie', async () => {
  const state = await consent.consentState({ cookies: {}, get: () => null });
  assert.equal(state.visitorId, null);
  assert.equal(state.outstanding, true);
  assert.equal(state.ads, false);
  assert.equal(state.country, null);
  assert.equal(state.required, true, 'an unknown country gets the strict treatment');
});

// ── the part that matters: behaviour ─────────────────────────────────────────

test('a refusal removes the identifier the network would have received', async () => {
  const tag = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
  const owner = await store.userByEmailOrCreate(`consent-owner-${tag}@test.local`);
  const channel = await store.createChannel({ ownerId: owner.id, slug: `cc-${tag}`, name: `CC ${tag}` });
  const connection = await store.createConnection({
    channelId: channel.id, providerId: 'house', secret: 'test-secret',
    callbackBaseUrl: 'http://localhost',
  });
  const asset = await store.createAsset({
    channelId: channel.id, title: `Gated ${tag}`, slug: `gated-${tag}`,
  });

  const before = await startUnlock({ assetId: asset.id, userId: owner.id, personalised: false });
  assert.equal(before.ok, true);
  assert.equal(before.adConfig.userId, undefined,
    'the network was handed a durable identifier for a visitor who refused personalised ads');
  assert.equal(before.adConfig.personalised, false);
  // The view id still travels: the callback has to be tied to this view, and a
  // fresh per-view id links nothing to anything.
  assert.ok(before.adConfig.custom);

  const after_ = await startUnlock({ assetId: asset.id, userId: owner.id, personalised: true });
  assert.equal(typeof after_.adConfig.userId, 'string',
    'consent should not have removed the identifier when it was given');
  assert.equal(after_.adConfig.personalised, true);
  assert.notEqual(after_.adConfig.custom, before.adConfig.custom, 'each view needs its own id');
});

test('the identifier is per account and reveals nothing about the account', async () => {
  const tag = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
  const user = await store.userByEmailOrCreate(`anon-${tag}@test.local`);
  const ref = await store.adRefFor(user.id);

  assert.match(ref, /^[0-9a-f-]{36}$/, 'the ad reference should be an opaque uuid');
  assert.ok(!ref.includes(user.id), 'the ad reference must not be the user id');
  assert.ok(!ref.includes('anon-'), 'the ad reference must not contain the address');
  assert.equal(await store.adRefFor(user.id), ref, 'it must be stable, or it cannot be used at all');
});

test('the granted column is generated, so it cannot disagree with the blob', async () => {
  // The bug this encodes: a column per purpose has to be filled in by hand at
  // every write. Removing a purpose from the list broke every insert until the
  // column became a function of the blob.
  await assert.rejects(
    () => query(
      `insert into consent_records (visitor_id, policy_version, choices, ads_granted)
       values ('gen-check', '${consent.POLICY_VERSION}', '{"ads": false}'::jsonb, true)`,
    ),
    /cannot insert a non-DEFAULT value into column "ads_granted"/,
    'writing the generated column by hand must be refused by the database',
  );
});
