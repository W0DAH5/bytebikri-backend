/**
 * Concurrency and idempotency tests — against a real Postgres.
 *
 * These are the tests that could not have been written against the in-memory
 * store, and they are the reason for moving to a real database. An in-memory
 * store with synchronous methods cannot interleave, so it passes these by
 * accident. Postgres will genuinely run them at the same time.
 *
 * The bug this is aimed at was real: the duplicate check was
 *   if (adViews().some(e => e.external_id === id)) return duplicate
 * followed by an insert — check-then-act. Two deliveries of the same postback
 * both pass the check, because neither has written yet, and both grant. A
 * provider retry is exactly two deliveries of the same postback, and providers
 * retry by design.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:55432/bytebikri_test';

const { store } = await import('../src/store.js');
const { close, scalar, many } = await import('../src/db.js');

after(async () => { await close(); });

/** A throwaway channel with a connection and a gated asset. */
let seq = 0;
async function fixture(label = 'x') {
  const n = ++seq;
  const tag = `${label}-${Date.now()}-${n}`;
  const user = await store.userByEmailOrCreate(`owner-${tag}@test.local`);
  const channel = await store.createChannel({
    ownerId: user.id, slug: `ch-${tag}`, name: `Channel ${tag}`,
  });
  const connection = await store.createConnection({
    channelId: channel.id, providerId: 'house', secret: 'test-secret',
    callbackBaseUrl: 'http://localhost',
  });
  const asset = await store.createAsset({
    channelId: channel.id, title: `Asset ${tag}`, slug: `a-${tag}`,
  });
  const viewer = await store.userByEmailOrCreate(`viewer-${tag}@test.local`);
  return { user, channel, connection, asset, viewer };
}

// ---------------------------------------------------------------------------
// The race
// ---------------------------------------------------------------------------

test('concurrent deliveries of the SAME transaction claim exactly one view', async () => {
  const { channel, connection, asset, viewer } = await fixture('race');
  const externalId = `tx-${Date.now()}`;

  const event = {
    channel_id: channel.id,
    user_id: viewer.id,
    asset_id: asset.id,
    connection_id: connection.id,
    provider_id: 'house',
    external_id: externalId,
    kind: 'rewarded',
    state: 'complete',
    completed: true,
    duration_sec: 5,
  };

  // Ten simultaneous claims of one event. Before the fix, all ten passed the
  // duplicate check and all ten inserted.
  const results = await Promise.all(
    Array.from({ length: 10 }, () => store.claimAdView({ ...event })),
  );

  const claimed = results.filter((r) => r.claimed).length;
  assert.equal(claimed, 1, `${claimed} of 10 concurrent claims won; exactly one must`);

  const stored = await scalar(
    `select count(*)::int from ad_view_events where connection_id = $1 and external_id = $2`,
    [connection.id, externalId],
  );
  assert.equal(stored, 1, 'the unique index must leave exactly one row');
});

test('concurrent grants produce one unlock row with an accurate ad count', async () => {
  const { channel, asset, viewer } = await fixture('grant');
  const policy = await store.unlockPolicy(asset.id);

  // The old read-then-write incremented ads_completed in JS: `existing.ads_completed += 1`.
  // Ten concurrent grants both read the same value and increments were lost.
  await Promise.all(
    Array.from({ length: 10 }, () => store.grantUnlock({
      assetId: asset.id, channelId: channel.id, userId: viewer.id, policy,
    })),
  );

  const rows = await many(
    'select id, ads_completed from unlocks where asset_id = $1 and user_id = $2',
    [asset.id, viewer.id],
  );
  assert.equal(rows.length, 1, 'ON CONFLICT (asset_id,user_id) must leave one row');
  assert.equal(Number(rows[0].ads_completed), 10, 'every increment must survive');
});

test('a retried postback leaves counters unchanged', async () => {
  const { asset, channel, viewer } = await fixture('retry');
  const before = await scalar('select count(*)::int from ad_view_events');

  const event = {
    channel_id: channel.id, user_id: viewer.id, asset_id: asset.id,
    connection_id: (await store.connectionsOf(channel.id))[0].id,
    provider_id: 'house', external_id: 'same-tx', state: 'complete', completed: true,
  };
  await store.claimAdView({ ...event });
  const mid = await scalar('select count(*)::int from ad_view_events');
  await store.claimAdView({ ...event });
  const after_ = await scalar('select count(*)::int from ad_view_events');

  assert.equal(mid, before + 1, 'first delivery records a view');
  assert.equal(after_, mid, 'the retry must not record a second');
});

// ---------------------------------------------------------------------------
// Isolation between connections and tenants
// ---------------------------------------------------------------------------

test('the same transaction id on two connections is two different events', async () => {
  // This is why uniqueness became connection-scoped. Two channels can both use
  // BitLabs; provider-scoped uniqueness would let one channel's completed view be
  // swallowed as a duplicate of the other's.
  const a = await fixture('collide-a');
  const b = await fixture('collide-b');

  const base = { provider_id: 'house', external_id: 'SAME-ID', state: 'complete', completed: true };
  const ra = await store.claimAdView({
    ...base, channel_id: a.channel.id, user_id: a.viewer.id,
    asset_id: a.asset.id, connection_id: a.connection.id,
  });
  const rb = await store.claimAdView({
    ...base, channel_id: b.channel.id, user_id: b.viewer.id,
    asset_id: b.asset.id, connection_id: b.connection.id,
  });

  assert.equal(ra.claimed, true, 'first connection claims it');
  assert.equal(rb.claimed, true, 'a different connection must still claim its own');
});

test('an unlock is scoped to one user and one asset', async () => {
  const { channel, asset, viewer } = await fixture('scope');
  const policy = await store.unlockPolicy(asset.id);
  const other = await store.userByEmailOrCreate(`other-${Date.now()}@test.local`);
  const otherAsset = await store.createAsset({
    channelId: channel.id, title: 'Second', slug: `second-${Date.now()}`,
  });

  await store.grantUnlock({ assetId: asset.id, channelId: channel.id, userId: viewer.id, policy });

  assert.equal(await store.isUnlocked(asset.id, viewer.id), true);
  assert.equal(await store.isUnlocked(asset.id, other.id), false, 'must not leak to another user');
  assert.equal(await store.isUnlocked(otherAsset.id, viewer.id), false, 'must not leak to another asset');
});

// ---------------------------------------------------------------------------
// Expiry is enforced by the query, not by a sweep job
// ---------------------------------------------------------------------------

test('an expired unlock reads as locked', async () => {
  const { channel, asset, viewer } = await fixture('expiry');
  await store.grantUnlock({
    assetId: asset.id, channelId: channel.id, userId: viewer.id,
    policy: { unlock_hours: 0 }, // 0 -> permanent
  });
  assert.equal(await store.isUnlocked(asset.id, viewer.id), true, '0 hours means permanent');

  // Backdate it past its expiry and confirm the read path enforces the window.
  await store.query(
    `update unlocks set expires_at = now() - interval '1 hour' where asset_id = $1 and user_id = $2`,
    [asset.id, viewer.id],
  );
  assert.equal(await store.isUnlocked(asset.id, viewer.id), false, 'expired must read as locked');
});

test('a revoked unlock reads as locked even before it expires', async () => {
  const { channel, asset, viewer } = await fixture('revoke');
  await store.grantUnlock({
    assetId: asset.id, channelId: channel.id, userId: viewer.id, policy: { unlock_hours: 24 },
  });
  assert.equal(await store.isUnlocked(asset.id, viewer.id), true);

  await store.query(
    `update unlocks set revoked_at = now(), revoked_reason = 'test' where asset_id = $1`,
    [asset.id],
  );
  assert.equal(await store.isUnlocked(asset.id, viewer.id), false);
});

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

test('the same user always gets the same opaque ad ref', async () => {
  // The network's anti-fraud depends on this being stable, and our privacy
  // depends on it not being the user id.
  const user = await store.userByEmailOrCreate(`ref-${Date.now()}@test.local`);
  const [a, b] = await Promise.all([store.adRefFor(user.id), store.adRefFor(user.id)]);
  assert.equal(a, b, 'concurrent calls must converge on one ref, not create two');
  assert.notEqual(a, user.id, 'the ref must not be the user id');
  assert.equal(await store.userByAdRef(a), user.id, 'the ref must resolve back');
});

test('an unknown ad ref resolves to nobody', async () => {
  assert.equal(await store.userByAdRef('00000000-0000-4000-8000-000000000000'), null);
});

// ---------------------------------------------------------------------------
// Page views
// ---------------------------------------------------------------------------

test('concurrent page views are counted exactly', async () => {
  const { channel } = await fixture('views');
  await Promise.all(Array.from({ length: 25 }, () => store.bumpPageView(channel.id)));
  // `pageviews = pageviews + 1` in SQL. A read-modify-write would lose some.
  assert.equal(await store.pageviews30d(channel.id), 25);
});

test('page views are per channel', async () => {
  const a = await fixture('views-a');
  const b = await fixture('views-b');
  await store.bumpPageView(a.channel.id);
  await store.bumpPageView(a.channel.id);
  await store.bumpPageView(b.channel.id);
  assert.equal(await store.pageviews30d(a.channel.id), 2);
  assert.equal(await store.pageviews30d(b.channel.id), 1);
});

// ---------------------------------------------------------------------------
// Hostile input from the open internet must not produce a 500
// ---------------------------------------------------------------------------

test('a malformed id is refused, not thrown', async () => {
  // Postgres rejects a non-UUID cast, which surfaced as a 500 on the postback
  // endpoint — and a webhook sender reads 500 as "retry me", forever. Every
  // id-taking lookup must answer null instead.
  const junk = ['nope', '', '123', "' or 1=1--", 'x'.repeat(200)];
  for (const j of junk) {
    assert.equal(await store.connectionById(j), null, `connectionById(${j})`);
    assert.equal(await store.pendingView(j), null, `pendingView(${j})`);
    assert.equal(await store.assetById(j), null, `assetById(${j})`);
    assert.equal(await store.activeConnection(j, 'house'), null, `activeConnection(${j})`);
  }
});
