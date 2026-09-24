/**
 * Two ads mean two ads.
 *
 * The file page has said "2 ads of 30 seconds" since the ad economy landed, and
 * the sentence was true in the copy and false in the code: `handlePostback`
 * granted on the first `complete` delivery, so a file that advertised three views
 * opened after one. The person on the other side of that sentence paid nothing
 * extra — what they lost was the meaning of the number, which is worse: an ask
 * that does not hold is a promise the platform cannot keep, and the next ask gets
 * believed less.
 *
 * What is tested here is only the rule. The ladder that decides the number has
 * its own tests (`adscale.test.js`), the page that prints it is checked in
 * `members.test.js` and `blocked.test.js`, and what an ad-blocked browser sees is
 * `blocked.test.js`. This file holds the gate itself:
 *
 *   one delivery does not open a two-view file;
 *   the second does;
 *   a replay of either counts once (the unique index still referees);
 *   the attempt's own number is the one that counts, not a policy edited mid-watch;
 *   and a delivery that is not a completed view is evidence that is not a view.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:55432/bytebikri_test';
process.env.SESSION_SECRET ||= 'test-session-secret';
process.env.AD_POSTBACK_SECRET ||= 'test-postback-secret';

const { store } = await import('../src/store.js');
const { close, query } = await import('../src/db.js');
const { startUnlock, handlePostback, unlockStatus } = await import('../src/unlocks.js');
const house = await import('../src/providers/house.js');

after(async () => { await close(); });

const SECRET = 'sandbox-secret';
let seq = 0;

/**
 * A live, ad-gated file whose ask is whatever the ladder gives a store plan it
 * is on. `value` is the lever, exactly as it is in the product — the test does
 * not write an ask the ladder would not produce, because the number under test
 * is the number a seller can actually publish.
 */
async function fixture({ value = 2_000, plan = 'pro' } = {}) {
  const tag = `${Date.now()}-${++seq}`;
  const owner = await store.userByEmailOrCreate(`adown-${tag}@test.local`);
  const viewer = await store.userByEmailOrCreate(`adview-${tag}@test.local`);
  const channel = await store.createChannel({ ownerId: owner.id, slug: `ad-${tag}`, name: `Ad ${tag}` });
  await query(
    `insert into subscriptions (channel_id, plan_code, status, period_start, period_end)
     values ($1, $2, 'active', now(), now() + interval '365 days')`,
    [channel.id, plan],
  );
  const connection = await store.createConnection({
    channelId: channel.id, providerId: 'house', secret: SECRET,
  });
  const asset = await store.createAsset({
    channelId: channel.id, title: `Two ads ${tag}`, slug: `two-${tag}`, unlockMode: 'ad_gated',
  });
  await store.updateAsset(asset.id, { declared_value_npr: value, status: 'live' });
  const policy = await store.setUnlockPolicy(asset.id, { ask_level: 'standard', unlock_hours: 24 });
  return { owner, viewer, channel, connection, asset, policy };
}

/** One signed delivery from the sandbox network, exactly as the client drives it. */
async function deliver({ connection, viewId, externalId, durationSec = 20, completed = true, state = null }) {
  const body = JSON.stringify({
    viewId, externalId, completed, durationSec,
  });
  const { timestamp, signature } = house.sign({ secret: SECRET, rawBody: body });
  let n = 0;
  const result = await handlePostback({
    providerId: 'house',
    connectionId: connection.id,
    ctx: {
      method: 'POST',
      rawBody: body,
      body: { ...JSON.parse(body), ...(state ? { state } : {}) },
      query: {},
      headers: { 'x-bb-timestamp': timestamp, 'x-bb-signature': signature },
    },
  });
  n += 1;
  return { ...result, seq: n };
}

test('the ladder gives this fixture a real two-view ask', async () => {
  // Guards the guard: if the ladder ever stops producing a two-view ask at this
  // value, every assertion below would pass for the wrong reason.
  const { policy } = await fixture();
  assert.equal(policy.ads_required, 2, 'a file worth NPR 2,000 asks for two views');
  assert.ok(policy.ad_min_seconds >= 15);
});

test('one delivery does not open a two-view file, and the second one does', async () => {
  const { viewer, connection, asset } = await fixture();
  const start = await startUnlock({ assetId: asset.id, userId: viewer.id });
  assert.equal(start.ok, true);
  assert.equal(start.adConfig.requiredViews, 2, 'the client is told two, not one');

  const first = await deliver({ connection, viewId: start.viewId, externalId: 'view-one' });
  assert.equal(first.ok, true);
  assert.equal(first.unlocked, false, 'one view is not two');
  assert.equal(first.viewsDone, 1);
  assert.equal(first.viewsRequired, 2);
  assert.equal(await store.isUnlocked(asset.id, viewer.id), false, 'nothing was granted');

  // The attempt stays open — that is what lets the second delivery find it.
  assert.equal((await store.pendingView(start.viewId)).completed, false,
    'an attempt that still owes views is not complete');

  const status = await unlockStatus({ assetId: asset.id, userId: viewer.id, viewId: start.viewId });
  assert.equal(status.viewsDone, 1);
  assert.equal(status.viewsRequired, 2);
  assert.equal(status.unlocked, false);
  assert.equal(status.viewCompleted, false, 'the browser must keep going, not declare victory');

  const second = await deliver({ connection, viewId: start.viewId, externalId: 'view-two' });
  assert.equal(second.unlocked, true, 'the second credited view opens the file');
  assert.equal(second.viewsDone, 2);
  assert.equal(await store.isUnlocked(asset.id, viewer.id), true);

  // And the record says what it cost the viewer.
  const [unlock] = await query('select ads_completed from unlocks where asset_id = $1 and user_id = $2',
    [asset.id, viewer.id]).then((r) => r.rows);
  assert.equal(unlock.ads_completed, 2);
});

test('a replay of a delivery counts once, before and after the grant', async () => {
  const { viewer, connection, asset } = await fixture();
  const start = await startUnlock({ assetId: asset.id, userId: viewer.id });

  const first = await deliver({ connection, viewId: start.viewId, externalId: 'same-id' });
  assert.equal(first.viewsDone, 1);
  // The provider retries (PubScale retries six times on non-2xx). Same delivery,
  // so it must not become a second view — the unique index still referees.
  const retry = await deliver({ connection, viewId: start.viewId, externalId: 'same-id' });
  assert.equal(retry.duplicate, true, 'answered as a duplicate, so the provider stops retrying');
  assert.equal((await store.completedViewsForPendingView(start.viewId)), 1, 'one delivery, one count');

  await deliver({ connection, viewId: start.viewId, externalId: 'fresh-id' });
  assert.equal(await store.isUnlocked(asset.id, viewer.id), true);
  const late = await deliver({ connection, viewId: start.viewId, externalId: 'fresh-id' });
  assert.equal(late.duplicate, true);
  assert.equal(late.unlocked, true, 'a replay after the grant still reports the unlock honestly');
});

test('the attempt keeps the number the page printed, even if the ask is edited mid-watch', async () => {
  const { viewer, connection, asset } = await fixture();
  const start = await startUnlock({ assetId: asset.id, userId: viewer.id });

  // A seller lowering the ask at the moment somebody is watching must not change
  // what this person was told — in either direction. The attempt is the promise.
  await query('update asset_unlock_policy set ads_required = 1 where asset_id = $1', [asset.id]);

  const first = await deliver({ connection, viewId: start.viewId, externalId: 'a' });
  assert.equal(first.unlocked, false, 'the page said two, so one view is not enough');
  const second = await deliver({ connection, viewId: start.viewId, externalId: 'b' });
  assert.equal(second.unlocked, true);
});

test('a reload mid-ask resumes the same attempt instead of asking twice', async () => {
  const { viewer, connection, asset } = await fixture();
  const first = await startUnlock({ assetId: asset.id, userId: viewer.id });
  await deliver({ connection, viewId: first.viewId, externalId: 'before-reload' });

  // A reload is a browser with nothing in memory, so it calls start again. The
  // server must hand back the attempt that already has one view credited — the
  // alternative asks a person to watch what they have already watched.
  const again = await startUnlock({ assetId: asset.id, userId: viewer.id });
  assert.equal(again.viewId, first.viewId, 'same attempt, not a second one');
  assert.equal(again.resumed, true);
  assert.equal(again.viewsDone, 1, 'the credited view is not forgotten');
  assert.equal(again.adConfig.requiredViews, 2, 'and the ask is still the one that was printed');

  const attempts = await query(
    'select count(*)::int as n from pending_views where asset_id = $1 and user_id = $2',
    [asset.id, viewer.id],
  );
  assert.equal(attempts.rows[0].n, 1, 'one attempt, however many times the page loads');

  const second = await deliver({ connection, viewId: again.viewId, externalId: 'after-reload' });
  assert.equal(second.unlocked, true, 'the view that was still owed is the only one left');
  assert.equal(second.viewsDone, 2);
});

test('an attempt nobody came back to is swept, and the next ask starts fresh', async () => {
  const { viewer, asset } = await fixture();
  const stale = await startUnlock({ assetId: asset.id, userId: viewer.id });

  // The window is the sweep's, not the browser's: a half-finished attempt from
  // another day is not progress, and resuming it would count a view the person
  // cannot remember watching.
  await query(`update pending_views set created_at = now() - interval '7 hours' where id = $1`, [stale.viewId]);
  const fresh = await startUnlock({ assetId: asset.id, userId: viewer.id });
  assert.notEqual(fresh.viewId, stale.viewId, 'an abandoned attempt is not resumed');
  assert.equal(fresh.viewsDone, 0);
  assert.equal(fresh.resumed, false);
  assert.equal(await store.pendingView(stale.viewId), null, 'and it is gone, not merely ignored');
});

test('a delivery that is not a completed view is evidence, not a view', async () => {
  const { viewer, connection, asset } = await fixture();

  // The house sandbox only ever signs a completion, so this goes at the record
  // directly: a row with completed = false is what a screenout or a ban leaves
  // behind, and it must not move the count.
  const start = await startUnlock({ assetId: asset.id, userId: viewer.id });
  await store.claimAdView({
    channel_id: asset.channel_id, user_id: viewer.id, asset_id: asset.id,
    connection_id: connection.id, provider_id: 'house', external_id: 'screened-out',
    kind: 'rewarded', state: 'screenout', completed: false, meta: {},
    pending_view_id: start.viewId,
  });
  assert.equal(await store.completedViewsForPendingView(start.viewId), 0, 'a screenout is not a view');
  assert.equal(await store.isUnlocked(asset.id, viewer.id), false);

  // And the delivery is still recorded: the seller's evidence page has to be able
  // to show an ad that ran and was not finished.
  const [row] = await query(
    'select state, completed from ad_view_events where external_id = $1', ['screened-out'],
  ).then((r) => r.rows);
  assert.equal(row.state, 'screenout');
  assert.equal(row.completed, false);
});

test('a one-view file still opens on the first credited view', async () => {
  // The regression guard on the other side: enforcement must not turn every
  // unlock into a two-view ask for files that ask for one.
  const { viewer, connection, asset, policy } = await fixture({ value: 50 });
  assert.equal(policy.ads_required, 1);
  const start = await startUnlock({ assetId: asset.id, userId: viewer.id });
  assert.equal(start.adConfig.requiredViews, 1);
  const only = await deliver({ connection, viewId: start.viewId, externalId: 'only' });
  assert.equal(only.unlocked, true);
  assert.equal(only.viewsDone, 1);
});
