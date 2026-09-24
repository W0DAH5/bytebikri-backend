/**
 * The player gate: a break inside a file that was already free to open.
 *
 * Slice 3's first half planned the breaks; nothing could stop a player at one, so
 * the plan was real to the seller and invisible to the buyer. This file holds the
 * half that makes it reachable — and, more importantly, the half that keeps it from
 * becoming a second door.
 *
 * The rule the whole feature rests on is one sentence long: **a break is a pause,
 * not an unlock.** Three consequences follow, and each is a test below:
 *
 *   1. A break can only be started on a file whose mode is `breaks` — free to open.
 *      Nothing that a server-checked unlock used to release can be released by a
 *      client-side pause instead.
 *   2. A credited break grants nothing: no unlock row, no door, no content. The
 *      bytes were already the viewer's; what the postback releases is the playhead.
 *   3. The number of breaks is the plan's, and the plan's is the ladder's. A client
 *      cannot ask for a cue that is not there, and a file cannot ask for more views
 *      through its breaks than its value gave it.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:55432/bytebikri_test';
process.env.SESSION_SECRET ||= 'test-session-secret';
process.env.AD_POSTBACK_SECRET ||= 'test-postback-secret';

const { store } = await import('../src/store.js');
const { query, close } = await import('../src/db.js');
const { startBreak, handlePostback, unlockStatus } = await import('../src/unlocks.js');
const house = await import('../src/providers/house.js');

after(async () => { await close(); });

const SECRET = 'sandbox-secret';
let seq = 0;

/** A 40-minute video on a Pro store, worth NPR 2,000 — two legal mid breaks. */
async function fixture({ mode = 'breaks', runtime = 2_400, value = 2_000, shape = 'watch' } = {}) {
  const tag = `${Date.now()}-${++seq}`;
  const owner = await store.userByEmailOrCreate(`bgown-${tag}@test.local`);
  const viewer = await store.userByEmailOrCreate(`bgview-${tag}@test.local`);
  const channel = await store.createChannel({ ownerId: owner.id, slug: `bg-${tag}`, name: `BG ${tag}` });
  await query(
    `insert into subscriptions (channel_id, plan_code, status, period_start, period_end)
     values ($1, 'pro', 'active', now(), now() + interval '365 days')`,
    [channel.id],
  );
  const connection = await store.createConnection({ channelId: channel.id, providerId: 'house', secret: SECRET });
  const asset = await store.createAsset({
    channelId: channel.id, title: `Breaks ${tag}`, slug: `breaks-${tag}`,
    unlockMode: mode === 'ad_gated' ? 'ad_gated' : 'open',
  });
  const file = shape === 'watch'
    ? { filename: 'lecture.mp4', mime_type: 'video/mp4' }
    : { filename: 'album.mp3', mime_type: 'audio/mpeg' };
  await store.addFile({
    assetId: asset.id, storageKey: `test/${tag}/${file.filename}`, filename: file.filename,
    mimeType: file.mime_type, sizeBytes: 10, checksum: 'x',
  });
  await store.updateAsset(asset.id, { declared_value_npr: value, status: 'live', unlock_mode: mode });
  await store.setUnlockPolicy(asset.id, { ask_level: 'standard', unlock_hours: 24, mode });
  await store.reportRuntime(asset.id, runtime);
  return { owner, viewer, channel, connection, asset };
}

/** One signed delivery from the sandbox network. */
async function deliver({ connection, viewId, externalId, completed = true }) {
  const body = JSON.stringify({ viewId, externalId, completed, durationSec: 45 });
  const { timestamp, signature } = house.sign({ secret: SECRET, rawBody: body });
  return handlePostback({
    providerId: 'house',
    connectionId: connection.id,
    ctx: {
      method: 'POST', rawBody: body, body: JSON.parse(body), query: {},
      headers: { 'x-bb-timestamp': timestamp, 'x-bb-signature': signature },
    },
  });
}

test('a break starts on a free-to-open file, and the plan decides how many', async () => {
  const { viewer, asset } = await fixture();
  const plan = await store.adPlanFor(await store.assetById(asset.id));
  assert.equal(plan.cues.length, 2, 'a 40-minute file worth NPR 2,000 asks twice, inside it');

  const first = await startBreak({ assetId: asset.id, userId: viewer.id, cueIndex: plan.cues[0].atSec ? 0 : 0 });
  assert.equal(first.ok, true);
  assert.equal(first.break, true);
  assert.equal(first.total, 2);
  assert.equal(first.adConfig.requiredViews, 1, 'a break is ONE view, whatever the file asks in total');
  assert.equal(first.adConfig.cueAtSec, plan.cues[0].atSec);
  assert.equal(first.adConfig.minSeconds, 45);
});

test('a credited break releases the player and grants nothing else', async () => {
  const { viewer, connection, asset } = await fixture();
  // The file is free to open, so the viewer holds an unlock before any break —
  // exactly as they would mid-playback.
  await store.grantUnlock({
    assetId: asset.id, channelId: asset.channel_id, userId: viewer.id,
    method: 'open', adsCompleted: 0, policy: { unlock_hours: 0 },
  });

  const start = await startBreak({ assetId: asset.id, userId: viewer.id, cueIndex: 0 });
  const result = await deliver({ connection, viewId: start.viewId, externalId: 'break-one' });
  assert.equal(result.ok, true);
  assert.equal(result.breakCredited, true);
  assert.equal(result.unlocked, false, 'a break is not a door');
  assert.equal(result.breakIndex, 0);

  const status = await unlockStatus({ assetId: asset.id, userId: viewer.id, viewId: start.viewId });
  assert.equal(status.breakIndex, 0, 'the client can tell a break from a door');
  assert.equal(status.breakAtSec, start.adConfig.cueAtSec);
  assert.equal(status.viewsDone, 1);
  assert.equal(status.viewsRequired, 1);

  // The door was not moved: the free unlock still carries zero ad views, and no
  // second unlock row appeared.
  const [unlock] = await query(
    'select ads_completed, method from unlocks where asset_id = $1 and user_id = $2',
    [asset.id, viewer.id],
  ).then((r) => r.rows);
  assert.equal(unlock.ads_completed, 0, 'a break must not be counted as the price of the file');
  assert.equal(unlock.method, 'open');
  const rows = await query('select count(*)::int as n from unlocks where asset_id = $1', [asset.id]);
  assert.equal(rows.rows[0].n, 1);
});

test('a break cannot be started on a file that asks at the door', async () => {
  const { viewer, asset } = await fixture({ mode: 'ad_gated' });
  const start = await startBreak({ assetId: asset.id, userId: viewer.id, cueIndex: 0 });
  assert.equal(start.ok, false);
  assert.match(start.error, /does not carry breaks/);

  // The plan still exists for the seller's page — the door's file has cues it may
  // switch on — but no client can run one, which is the property that matters.
  const plan = await store.adPlanFor(await store.assetById(asset.id));
  assert.ok(plan.cues.length > 0);
});

test('a cue that is not in the plan cannot be asked for', async () => {
  const { viewer, asset } = await fixture();
  for (const cueIndex of [7, -1, 99, 'first', null, undefined]) {
    const start = await startBreak({ assetId: asset.id, userId: viewer.id, cueIndex });
    assert.equal(start.ok, false, `cueIndex ${JSON.stringify(cueIndex)} was accepted`);
  }
  const attempts = await query('select count(*)::int as n from pending_views where asset_id = $1', [asset.id]);
  assert.equal(attempts.rows[0].n, 0, 'a refused break leaves no attempt behind');
});

test('a file with no measured length has nowhere to break, so nothing starts', async () => {
  const { viewer, asset } = await fixture({ runtime: null });
  const start = await startBreak({ assetId: asset.id, userId: viewer.id, cueIndex: 0 });
  assert.equal(start.ok, false);
  assert.match(start.error, /no such break/);
});

test('a break is snapshotted, so a plan edited mid-break cannot move it', async () => {
  const { viewer, asset } = await fixture();
  const first = await startBreak({ assetId: asset.id, userId: viewer.id, cueIndex: 0 });
  const at = first.adConfig.cueAtSec;

  // The seller edits the plan (or the value) while somebody is sitting through a
  // break. The attempt keeps the cue it was started at.
  await store.updateAsset(asset.id, { declared_value_npr: 9_000 });
  await store.setUnlockPolicy(asset.id, { ask_level: 'standard', unlock_hours: 24 });

  const view = await store.pendingView(first.viewId);
  assert.equal(view.break_at_sec, at, 'the break did not move under the viewer');
  assert.equal(view.required_ads, 1);
});

test('the plan on a queue breaks between tracks, and its kinds are the plan\'s', async () => {
  const { viewer, asset } = await fixture({ shape: 'listen', runtime: 2_400, value: 2_000 });
  // One file is one track, so a queue with a single track has nowhere to break
  // between: the plan says so, and no client can talk it into a cue.
  for (const n of [2, 3, 4, 5]) {
    await store.addFile({
      assetId: asset.id, storageKey: `test/track-${n}.mp3`, filename: `track-0${n}.mp3`,
      mimeType: 'audio/mpeg', sizeBytes: 10, checksum: 'x',
    });
  }
  const plan = await store.adPlanFor(await store.assetById(asset.id));
  assert.equal(plan.shape, 'listen');
  assert.ok(plan.cues.length > 0, 'four tracks have room for a between-track break');
  assert.ok(plan.cues.every((c) => c.kind === 'between'));

  // A between cue has no playhead, so it is NOT a break a player can stop at —
  // the gate is for timed cues, and saying otherwise would stop the player at a
  // number the client made up.
  const { breakCues } = await import('../src/placement.js');
  assert.equal(breakCues(plan).length, 0, 'between-track gates wait for the queue surface');
  const start = await startBreak({ assetId: asset.id, userId: viewer.id, cueIndex: 0 });
  assert.equal(start.ok, false);
});

test('a break on a paused or removed file does not start', async () => {
  const { viewer, asset } = await fixture();
  await store.updateAsset(asset.id, { status: 'paused' });
  const paused = await startBreak({ assetId: asset.id, userId: viewer.id, cueIndex: 0 });
  assert.equal(paused.ok, false);
  assert.match(paused.error, /not live/);
});

test('the policy row follows the file into breaks, and refuses what it cannot offer', async () => {
  const { asset } = await fixture({ mode: 'ad_gated' });
  // The mode lives in two places — the asset and its policy copy — and the whole
  // reason the policy carries it is so the two cannot disagree about one decision.
  // `breaks` was added to the asset's list and not the policy's, so the policy
  // silently kept the OLD mode; the buyer's path reads the asset, which is why no
  // page ever looked wrong.
  await store.setUnlockPolicy(asset.id, { ask_level: 'standard', unlock_hours: 24, mode: 'breaks' });
  const after = await store.unlockPolicy(asset.id);
  assert.equal(after.mode, 'breaks', 'the policy row kept the previous mode');

  // `paid` is in the database's check constraint and not in what a seller can set:
  // it is reserved for a money path that does not exist, so offering it as a value
  // here would be offering nothing. The old mode must survive rather than the write
  // being silently dropped to a default.
  const { SELLER_MODES } = await import('../src/store.js');
  assert.deepEqual(SELLER_MODES, ['open', 'ad_gated', 'members', 'breaks']);
  assert.ok(!SELLER_MODES.includes('paid'));
  await store.setUnlockPolicy(asset.id, { ask_level: 'standard', unlock_hours: 24, mode: 'paid' });
  assert.equal((await store.unlockPolicy(asset.id)).mode, 'breaks', 'an unsupported mode changed the row');
});

test('a break asks for the identifier only when consent allows it', async () => {
  const { viewer, asset } = await fixture();
  // A break is asked for on a file the viewer ALREADY has, which is exactly the
  // situation in which a quiet extra request would go unnoticed — so the rule the
  // door follows has to hold here too, or the break becomes the way round the
  // consent choice.
  const off = await startBreak({ assetId: asset.id, userId: viewer.id, cueIndex: 0 });
  assert.equal(off.adConfig.userId, undefined, 'no consent, no identifier handed to the network');
  assert.equal(off.adConfig.personalised, false, 'and the modal is told which kind of ad it asked for');

  const on = await startBreak({
    assetId: asset.id, userId: viewer.id, cueIndex: 0, personalised: true,
  });
  assert.equal(typeof on.adConfig.userId, 'string', 'consent is a choice, not a permanent refusal');
  assert.equal(on.adConfig.personalised, true);
});

test('the page is told it may drive the sandbox network — outside production only', async () => {
  const { devSimulatorFor } = await import('../src/providers/index.js');
  const { viewer, asset } = await fixture();
  const start = await startBreak({ assetId: asset.id, userId: viewer.id, cueIndex: 0 });
  assert.equal(start.adConfig.devSimulator, true,
    'the client branch that had no flag to read can finally run');

  const before = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    assert.equal(devSimulatorFor('house'), false, 'the sandbox network is not driven from a page in production');
    assert.equal(devSimulatorFor('pubscale'), false, 'and never for a real provider');
  } finally {
    if (before === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = before;
  }
});

test('the audit line for a credited break is its own, and says what it was', async () => {
  const { viewer, connection, asset } = await fixture();
  const start = await startBreak({ assetId: asset.id, userId: viewer.id, cueIndex: 0 });
  await deliver({ connection, viewId: start.viewId, externalId: 'break-audit' });
  const [row] = await query(
    `select action, meta from audit_logs where action = 'postback.break_credited' and meta->>'viewId' = $1`,
    [start.viewId],
  ).then((r) => r.rows);
  assert.ok(row, 'a credited break is recorded as a break, not as a refusal or a grant');
  assert.equal(Number(row.meta.breakIndex), 0);
});
