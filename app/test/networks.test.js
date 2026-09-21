/**
 * Connecting a store to an ad network.  npm test
 *
 * This flow is where the platform's promise is easiest to break quietly. A
 * "Connect" button that stores a publisher id, or that reports success before a
 * single callback has been verified, would hand a creator a green tick over a
 * connection that can never pay them — which is the exact failure the whole
 * design is arranged to avoid.
 *
 * So the assertions here are about what the flow REFUSES: no adapter, no
 * connection; no secret, no active; a secret that cannot be used, not saved; and
 * a callback URL that keeps the network's macros intact, because a mangled macro
 * is a postback that silently never arrives.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

const {
  onboardingFor, connectable, postbackUrl, validateCredential, maskSecret,
  connectionHealth, unconnectableNote,
} = await import('../src/connections.js');

const BITLABS = {
  id: 'bitlabs', name: 'BitLabs', enabled: true, priority: 10,
  onboarding: {
    mode: 'paste_credentials',
    signupUrl: 'https://www.bitlabs.ai/',
    credentials: [{ key: 'appSecret', label: 'App secret', secret: true, help: 'their dashboard' }],
    steps: ['Sign up in your own name'],
    postback: {
      method: 'GET',
      params: [
        { ours: 'uid', theirs: '{uid}', note: 'viewer ref' },
        { ours: 's1', theirs: '{s1}', note: 'unlock id' },
        { ours: 'offer_state', value: 'COMPLETED', note: 'fixed' },
      ],
      signature: { algo: 'HMAC-SHA1', key: 'the app secret', covers: 'the URL', detail: 'hash last' },
    },
  },
};
const ADSTERRA = { id: 'adsterra', name: 'Adsterra', enabled: true, priority: 100 };
const HOUSE = { id: 'house', name: 'bytebikri House Ads', enabled: true, onboarding: { mode: 'none', steps: [], postback: null } };

// ---------------------------------------------------------------------------
// What is connectable, and what is not
// ---------------------------------------------------------------------------

test('a network with no adapter is not connectable, and says so instead of offering a button', () => {
  const o = onboardingFor(ADSTERRA);
  assert.equal(o.mode, 'unsupported');
  assert.equal(connectable(ADSTERRA), false);
  const note = unconnectableNote(ADSTERRA);
  assert.match(note, /no adapter/);
  assert.match(note, /record what it reports on your earnings page/,
    'the page offers the thing that DOES work without an adapter');
  assert.ok(!/connect it now|coming soon/i.test(note), 'no promise of an integration nobody has built');
});

test('our own network needs nothing, and a blocked provider is not offered', () => {
  assert.equal(connectable(HOUSE), true);
  assert.equal(onboardingFor(HOUSE).needsSecret, false);
  assert.equal(unconnectableNote(HOUSE), null);
  assert.equal(unconnectableNote({ name: 'X', blockedReason: 'verification outstanding' }), 'verification outstanding');
});

test('the pasted secret is validated before it is stored', () => {
  const field = { key: 'appSecret', label: 'App secret', secret: true };
  assert.equal(validateCredential(field, '  abcdefghij  ').ok, false, 'surrounding whitespace fails the signature check silently');
  assert.equal(validateCredential(field, 'abc').ok, false, 'too short to be a secret');
  assert.equal(validateCredential(field, '').ok, false);
  assert.equal(validateCredential(field, undefined).ok, false);
  assert.deepEqual(validateCredential(field, 'a-good-secret'), { ok: true, value: 'a-good-secret' });
});

test('a stored secret is never shown in full again', () => {
  assert.equal(maskSecret('supersecretvalue'), '••••alue');
  assert.equal(maskSecret('abcd'), '••••');
  assert.equal(maskSecret(''), null);
  assert.equal(maskSecret(null), null);
});

// ---------------------------------------------------------------------------
// The callback URL
// ---------------------------------------------------------------------------

test('the callback URL keeps the network macros and encodes everything else', () => {
  const url = postbackUrl({ provider: BITLABS, connectionId: 'abc-123', baseUrl: 'https://bb.example/' });
  assert.equal(url,
    'https://bb.example/api/ads/postback/bitlabs/abc-123?uid={uid}&s1={s1}&offer_state=COMPLETED');
  assert.ok(url.includes('{uid}'), 'the macro has to survive into their dashboard verbatim');
  assert.ok(!url.includes('%7B'), 'a percent-encoded macro is a callback that never arrives');
});

test('no dialect means no URL, rather than a URL that half works', () => {
  assert.equal(postbackUrl({ provider: ADSTERRA, connectionId: 'abc', baseUrl: 'https://x' }), null);
  assert.equal(postbackUrl({ provider: BITLABS, connectionId: 'abc', baseUrl: '' }), null,
    'a URL with no host is not a URL');
  assert.equal(postbackUrl({ provider: BITLABS, connectionId: null, baseUrl: 'https://x' }), null);
});

test('a connection id cannot break out of the path it is in', () => {
  const url = postbackUrl({ provider: BITLABS, connectionId: '../../admin', baseUrl: 'https://bb.example' });
  assert.ok(!url.includes('../../admin'), 'the id is encoded, not concatenated raw');
  assert.ok(url.includes('%2F'), 'slashes arrive percent-encoded');
});

// ---------------------------------------------------------------------------
// Evidence, not a colour
// ---------------------------------------------------------------------------

test('a connection with no secret is not reported as working', () => {
  const h = connectionHealth({ connection: { status: 'verifying', callback_secret: null } });
  assert.equal(h.level, 'unverified');
  assert.match(h.detail, /every callback from this network is refused/);
});

test('connected but never called back is its own state, with the likeliest cause', () => {
  const h = connectionHealth({ connection: { status: 'active', callback_secret: 's' }, lastPostbackAt: null });
  assert.equal(h.level, 'silent');
  assert.match(h.detail, /postback URL was not saved/);
});

test('a live connection counts its callbacks, and a gap is explained without alarm', () => {
  const now = new Date('2026-09-21T12:00:00Z');
  const live = connectionHealth({
    connection: { status: 'active', callback_secret: 's' },
    lastPostbackAt: '2026-09-21T09:00:00Z', postbacks30d: 4, now,
  });
  assert.equal(live.level, 'live');
  assert.match(live.detail, /4 callbacks in thirty days, the last today/);

  const quiet = connectionHealth({
    connection: { status: 'active', callback_secret: 's' },
    lastPostbackAt: '2026-09-01T09:00:00Z', postbacks30d: 1, now,
  });
  assert.equal(quiet.level, 'quiet');
  assert.match(quiet.detail, /Last callback 20 days ago/);
  assert.match(quiet.detail, /reconcile over days/, 'a gap is not announced as a fault');
});

test('a revoked connection says what it refuses, and the sandbox says it pays nobody', () => {
  const off = connectionHealth({ connection: { status: 'revoked' } });
  assert.equal(off.level, 'off');
  assert.match(off.detail, /its callbacks are refused/);

  const sandbox = connectionHealth({ connection: { status: 'active', callback_secret: 's' }, sandbox: true });
  assert.equal(sandbox.level, 'sandbox');
  assert.match(sandbox.detail, /pays nobody/);
});

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------

const { networksPage, slotsPage } = await import('../src/views.js');
const CHANNEL = {
  id: '11111111-1111-4111-8111-111111111111', slug: 'alice', name: 'Alice Studio',
  tagline: 'Poster kits', listing_mode: 'storefront', ads_enabled: true, banner_url: null,
};

test('the page hands over the URL, the macros and the one thing we hold', () => {
  const html = networksPage({
    channel: CHANNEL, user: null, base: 'https://bb.example', unusableBase: false,
    slotDefs: [{ key: 'footer_native', label: 'Footer', active: true, formats: ['native'] }],
    connections: [{
      connection: {
        id: '33333333-3333-4333-8333-333333333333', provider_id: 'bitlabs', status: 'verifying',
        callback_secret: null, slot_keys: [],
      },
      provider: BITLABS,
      onboarding: onboardingFor(BITLABS),
      url: postbackUrl({ provider: BITLABS, connectionId: '33333333-3333-4333-8333-333333333333', baseUrl: 'https://bb.example' }),
      health: connectionHealth({ connection: { status: 'verifying', callback_secret: null } }),
      secretHint: null,
      events: [],
    }],
    available: [{ provider: ADSTERRA, onboarding: onboardingFor(ADSTERRA), verdict: { level: 'caution', thresholdLabel: '$5' }, note: unconnectableNote(ADSTERRA) }],
  });

  assert.ok(html.includes('?uid={uid}'), 'the copy-pasteable URL is on the page');
  assert.ok(/leave them exactly as they are/i.test(html));
  assert.ok(/HMAC-SHA1/.test(html), 'the signing rule is stated');
  assert.ok(/name="appSecret"/.test(html), 'the secret field is the next step');
  assert.ok(/The account is yours/.test(html));
  // A bare /publisher id/ test would fail on the page's own denial ("we never
  // hold a publisher id") — which is the sentence doing its job. So the
  // assertion is about the FORM instead: the only field we may ever ask for is
  // the verification secret, and every other input is a hidden one we set.
  const fields = [...html.matchAll(/<input[^>]*name="([^"]+)"[^>]*>/gi)]
    .map((m) => m[0])
    .filter((tag) => !/type="hidden"/i.test(tag));
  // Two things are allowed here and nothing else: the credential field their
  // network signs with, and checkboxes choosing which slots it may fill. The
  // layout's site-wide search box is not part of this flow either.
  const FINE = ['appSecret', 'slotKeys', 'q'];
  const names = fields.map((t) => /name="([^"]+)"/.exec(t)[1]).filter((nm) => !FINE.includes(nm));
  assert.deepEqual(names, [],
    `the connection flow asks for something it must never collect: ${names.join(', ')}`);
  assert.ok(!/name="providerId" value="adsterra"/.test(html), 'no connect button for a network we cannot verify');
  assert.ok(/no adapter yet/.test(html));
});

test('an unconfigured public address is announced, because a callback URL nobody can reach is useless', () => {
  const html = networksPage({
    channel: CHANNEL, user: null, base: 'http://127.0.0.1:3000', unusableBase: true,
    connections: [], available: [],
  });
  assert.ok(/PUBLIC_BASE_URL/.test(html));
  assert.ok(/cannot call/.test(html));
});

test('the slots page states the rule, the rent slot, and the web\'s real limit', () => {
  const html = slotsPage({
    channel: CHANNEL, user: null, flash: null,
    slots: [{
      slotKey: 'top_leaderboard', label: 'From Alice Studio', rank: 1, formats: ['native', 'display'],
      owner: 'channel', serves: false, surface: 'webview',
      emptyNote: 'Your space.', byline: 'The store\u2019s own space.', purpose: 'The first thing a visitor sees.',
      creative: null, editHref: null,
    }, {
      slotKey: 'footer_native', label: 'Advertisement', rank: 5, formats: ['native'],
      owner: 'platform', serves: true, surface: 'webview',
      byline: 'Platform space.', purpose: 'The last thing before the footer.',
      creative: { owner: 'platform', headline: 'House ad', body: null, linkUrl: '/', linkLabel: null },
    }],
  });
  assert.ok(/Rank 1 is always yours/.test(html));
  assert.ok(/Rent is one slot/.test(html));
  assert.ok(/We keep no third-party script in our database/.test(html));
  assert.ok(/display-class space/.test(html) && /runs in the app/.test(html),
    'the web is never sold as the app: rewarded video is the app\'s format');
  assert.ok(/you cannot put anything in it/i.test(html), 'the rent slot is not editable by the seller');
  // The store's own space has no price. "not an ad slot for sale" is the denial,
  // so the test looks for a price TAG rather than for the word.
  assert.ok(!/NPR\s?[\d,]+/.test(html), 'the store\'s own space is never given a price');
  assert.ok(/not\s+an ad slot for sale/.test(html), 'and it says so rather than leaving it implied');
});

// ---------------------------------------------------------------------------
// The store side
// ---------------------------------------------------------------------------

process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:55432/bytebikri_test';
const { store } = await import('../src/store.js');
const { query, close } = await import('../src/db.js');
const { after } = await import('node:test');
after(async () => { await close(); });

let seq = 0;
async function fixture() {
  const tag = `${Date.now()}-${++seq}`;
  const user = await store.userByEmailOrCreate(`net-${tag}@test.local`);
  const ch = await store.createChannel({ ownerId: user.id, slug: `net-${tag}`, name: `Net ${tag}` });
  return { user, ch };
}

test('a connection goes verifying -> active, and the change is recorded', async () => {
  const { ch } = await fixture();
  const conn = await store.createConnection({
    channelId: ch.id, providerId: 'bitlabs', secret: null,
    callbackBaseUrl: 'https://bb.example',
  });
  assert.equal(conn.status, 'active', 'createConnection is permissive; the route decides what a verified connection is');

  await store.updateConnection(conn.id, { status: 'verifying', status_reason: 'waiting for the secret' });
  await store.logConnectionEvent({ connectionId: conn.id, to: 'verifying', detail: 'waiting for the network secret' });
  assert.equal((await store.connectionById(conn.id)).callback_secret, null, 'no secret yet, so nothing can verify');

  await store.updateConnection(conn.id, { callback_secret: 'a-real-secret', credential_label: 'App secret', status: 'active' });
  await store.logConnectionEvent({ connectionId: conn.id, from: 'verifying', to: 'active', detail: 'App secret saved' });

  const events = await store.connectionEvents(conn.id);
  assert.equal(events.length, 2);
  assert.deepEqual(events.map((e) => e.to_status), ['active', 'verifying'], 'newest first');

  // A whitelist, not a spread: a form must not be able to set an arbitrary column.
  const before = await store.connectionById(conn.id);
  await store.updateConnection(conn.id, { channel_id: '11111111-1111-4111-8111-111111111111', id: 'x', nope: 1 });
  const untouched = await store.connectionById(before.id);
  assert.equal(untouched.channel_id, before.channel_id, 'the channel a connection belongs to is not form-settable');
  assert.equal(untouched.status, 'active');
});

test('a revoked connection is not returned as connected, and its callbacks stop resolving', async () => {
  const { ch } = await fixture();
  const conn = await store.createConnection({ channelId: ch.id, providerId: 'house', secret: 'sandbox' });
  assert.equal((await store.connectionsOf(ch.id)).length, 1);
  assert.ok(await store.activeConnection(conn.id), 'active while it is connected');

  await store.updateConnection(conn.id, { status: 'revoked', status_reason: 'disconnected by the store' });
  assert.equal((await store.connectionsOf(ch.id)).length, 0, 'a revoked connection is not a connection');
  assert.equal(await store.activeConnection(conn.id), null, 'and a postback from it resolves to nothing');
});

test('postback evidence is per connection, and a channel sees only its own', async () => {
  const { user, ch } = await fixture();
  const other = await fixture();
  const conn = await store.createConnection({ channelId: ch.id, providerId: 'bitlabs', secret: 's' });
  const asset = await store.createAsset({ channelId: ch.id, title: 'Kit', slug: 'kit' });

  const insert = (channelId, connectionId, daysAgo) => query(
    `insert into ad_view_events
       (channel_id, user_id, asset_id, provider_id, connection_id, external_id,
        kind, state, completed, duration_sec, signature_ok, created_at)
     values ($1, $2, $3, 'bitlabs', $4, $5, 'rewarded', 'complete', true, 15, true,
             now() - ($6 || ' days')::interval)`,
    [channelId, user.id, asset.id, connectionId, `ev-${Math.random()}`, String(daysAgo)],
  );
  await insert(ch.id, conn.id, 1);
  await insert(ch.id, conn.id, 40);
  await insert(other.ch.id, other.ch ? null : null, 1);

  const mine = await store.postbackEvidence(ch.id);
  assert.equal(mine.length, 1, 'one row per provider and connection, not one per event');
  assert.equal(Number(mine[0].total), 2);
  assert.equal(Number(mine[0].in_window), 1, 'the thirty-day count is what the page shows');
  assert.equal(String(mine[0].connection_id), String(conn.id));

  const theirs = await store.postbackEvidence(other.ch.id);
  assert.ok(!theirs.some((e) => String(e.connection_id) === String(conn.id)), 'another store\'s evidence is not visible');
});

test('a connection id that is not a uuid is refused rather than thrown at Postgres', async () => {
  assert.equal(await store.updateConnection('../../etc/passwd', { status: 'active' }), null);
  assert.equal(await store.logConnectionEvent({ connectionId: 'x', to: 'active' }), null);
  assert.deepEqual(await store.connectionEvents('not-a-uuid'), []);
});
