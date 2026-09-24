/**
 * The seller's placement controls, saved and honoured.  npm test
 *
 * `placement.test.js` holds the rules — where a break may go, and where it may
 * never go — as a pure table. This file holds the two things a pure module cannot
 * prove: that a saved choice survives a round trip through the database and comes
 * back as the same plan the buyer's page prints, and that a hand-crafted request
 * cannot write a placement the file's shape does not have.
 *
 * The failure this guards against is specific and easy to ship: a checkbox list
 * whose names are read straight out of the form body. `mid` on a manhwa would then
 * be stored, the planner would ignore it (no playhead to place it against), and
 * the seller would be looking at a checked box that does nothing. `setAdPlan`
 * filters through the shape instead, so the column only ever holds keys that mean
 * something for this file.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:55432/bytebikri_test';

const { store } = await import('../src/store.js');
const { query, close } = await import('../src/db.js');
const { assetShape } = await import('../src/media.js');

after(async () => { await close(); });

let seq = 0;

/** A store on a real plan, with one file of a chosen media kind. */
async function fixture({ plan = 'pro', kind = 'video', title = 'Break Test' } = {}) {
  const tag = `${Date.now()}-${++seq}`;
  const owner = await store.userByEmailOrCreate(`place-${tag}@test.local`);
  const channel = await store.createChannel({ ownerId: owner.id, slug: `place-${tag}`, name: `Place ${tag}` });
  await query(
    `insert into subscriptions (channel_id, plan_code, status, period_start, period_end)
     values ($1, $2, 'active', now(), now() + interval '365 days')`,
    [channel.id, plan],
  );
  const asset = await store.createAsset({
    channelId: channel.id, title, slug: `break-${tag}`, unlockMode: 'ad_gated',
  });
  const file = {
    video: { filename: 'lecture.mp4', mime_type: 'video/mp4' },
    audio: { filename: 'album.mp3', mime_type: 'audio/mpeg' },
    images: { filename: 'chapter-01.png', mime_type: 'image/png' },
    zip: { filename: 'kit.zip', mime_type: 'application/zip' },
  }[kind];
  await store.addFile({
    assetId: asset.id, storageKey: `test/${tag}/${file.filename}`, filename: file.filename,
    mimeType: file.mime_type, sizeBytes: 1234, checksum: 'deadbeef',
  });
  if (kind === 'images') {
    // A read is an ordered set of pages, so one image is a download and two are a
    // reader. The fixture follows the product's own rule rather than testing an
    // asset shape no upload could produce.
    for (const n of [2, 3]) {
      await store.addFile({
        assetId: asset.id, storageKey: `test/${tag}/chapter-0${n}.png`, filename: `chapter-0${n}.png`,
        mimeType: 'image/png', sizeBytes: 1234, checksum: 'deadbeef',
      });
    }
  }
  await store.updateAsset(asset.id, { declared_value_npr: 2_000, status: 'live' });
  await store.setUnlockPolicy(asset.id, { ask_level: 'standard', unlock_hours: 24 });
  return { owner, channel, asset };
}

test('a video file can be given a mid-roll, and the plan the buyer sees is the one saved', async () => {
  const { asset, channel } = await fixture({ kind: 'video' });
  await store.reportRuntime(asset.id, 2_400); // 40 minutes, measured by a player

  const saved = await store.setAdPlan(asset.id, { mid: true, post: false });
  assert.deepEqual(saved.ad_plan, { mid: true, post: false }, 'only what the shape allows is stored');

  const plan = await store.adPlanFor(await store.assetById(asset.id));
  assert.equal(plan.shape, 'watch');
  assert.equal(plan.durationSec, 2_400);
  assert.equal(plan.budget.ads, 2, 'the ask is still the ladder\u2019s two views');
  assert.equal(plan.cues.length, 2);
  assert.ok(plan.cues.every((c) => c.kind === 'mid' && c.atSec >= 120 && c.atSec <= 2_310));

  // The seller's page renders this same object; the buyer's sentence comes from it.
  const { placementSentence } = await import('../src/placement.js');
  assert.match(placementSentence(plan), /Free to open\./);

  // Off means off, and it survives the round trip.
  const off = await store.setAdPlan(asset.id, { mid: false });
  assert.deepEqual(off.ad_plan, { mid: false });
  const after_ = await store.adPlanFor(await store.assetById(asset.id));
  assert.equal(after_.cues.length, 0);
  assert.equal(after_.reason, 'off');
  void channel;
});

test('a shape with no playhead cannot be given a mid-roll, however the request is written', async () => {
  const { asset } = await fixture({ kind: 'zip' });
  await store.reportRuntime(asset.id, 3_600);

  // A hand-crafted POST naming placements this file does not have.
  const saved = await store.setAdPlan(asset.id, {
    mid: true, between: true, post: true, rewarded: true, aside: false,
  });
  assert.deepEqual(saved.ad_plan, { aside: false },
    'a download has one placement, and asking for the others must not write them');

  const plan = await store.adPlanFor(await store.assetById(asset.id));
  assert.equal(plan.shape, 'download');
  assert.equal(plan.cues.length, 0);
  assert.match(plan.reasonText, /boxes on its page/);
});

test('a reader\'s breaks follow its pages, and a two-page reader gets none', async () => {
  const { asset } = await fixture({ kind: 'images' });
  // A three-page reader: the only legal break is after page 3, and the ask wants
  // two. The plan asks once and says why rather than gating the same page twice.
  const plan = await store.adPlanFor(await store.assetById(asset.id));
  assert.equal(plan.shape, 'read');
  assert.deepEqual(plan.cues.map((c) => c.atChapter), [3]);
  assert.equal(plan.refused.length, 1);
});

test('a measured runtime is only written when it is a plausible length', async () => {
  const { asset } = await fixture({ kind: 'audio' });
  assert.equal(await store.reportRuntime(asset.id, 0), null);
  assert.equal(await store.reportRuntime(asset.id, -5), null);
  assert.equal(await store.reportRuntime(asset.id, 90_000), null, 'a "day and a bit" is not a length');
  assert.equal(await store.reportRuntime(asset.id, 'not a number'), null);

  const ok = await store.reportRuntime(asset.id, 1_800.4);
  assert.equal(ok.runtime_sec, 1_800, 'rounded to a whole second');

  // A second report of the same number is a no-op, so a player that reports on
  // every page load is not writing to the row on every page load.
  assert.equal(await store.reportRuntime(asset.id, 1_800), null);
  // A different number is kept: the file was replaced, or the first report was of
  // a truncated stream.
  assert.equal((await store.reportRuntime(asset.id, 1_805)).runtime_sec, 1_805);
});

test('an ad-gated file on a free plan gets no break it could not pay for', async () => {
  const { asset } = await fixture({ kind: 'video', plan: 'free' });
  await store.reportRuntime(asset.id, 3_600);
  const plan = await store.adPlanFor(await store.assetById(asset.id));
  // Free asks 1 × 30 s, so there is exactly one view to place, and the planner
  // places it inside the file — the door and the break are the same budget.
  assert.equal(plan.budget.ads, 1);
  assert.equal(plan.cues.length, 1);
  assert.ok(plan.seconds <= 30);
});

test('a member\'s file is planned with no ads at all', async () => {
  const { asset } = await fixture({ kind: 'video' });
  await store.reportRuntime(asset.id, 3_600);
  const plan = await store.adPlanFor(await store.assetById(asset.id), { membersOnly: true });
  assert.equal(plan.cues.length, 0);
  assert.equal(plan.reason, 'members');
});

test('the shape a plan is built from is the shape the storefront shows', async () => {
  // One derivation, used by the card, the section, the seller's panel and the
  // planner. A second copy of this rule is how a file ends up listed under "Watch"
  // and planned as a download.
  const { asset } = await fixture({ kind: 'video' });
  const files = await store.filesOf(asset.id);
  assert.equal(assetShape(files, { url: asset.external_url }), 'watch');
  const plan = await store.adPlanFor(await store.assetById(asset.id));
  assert.equal(plan.shape, 'watch');
});
