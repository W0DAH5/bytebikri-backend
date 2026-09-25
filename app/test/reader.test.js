/**
 * The reader: pages that are counted, seams that are real, and a bookmark.
 *
 * §13 designed the surface; these are the four claims it makes, and each of them was
 * impossible before this slice:
 *
 *   1. **The planner is told the PAGE count.** A forty-page comic is forty steps, so
 *      the between-chapter cue the planner has always known how to place can actually
 *      be placed. The fixture proves it by building two archives of different lengths
 *      and asserting the gates move — the old code handed the planner `files.length`,
 *      which is 1 for both, and the planner's own arithmetic could not run.
 *   2. **A reader's stop is a real stop.** `startBreak` used to look only in
 *      `breakCues`, which is the player's list, so a between-page cue could never be
 *      started. Now it can, it snapshots the seam rather than a second, and the view
 *      it writes carries `placement: 'between'` into the ledger.
 *   3. **A seam that is cleared releases the page, and only for the person who
 *      cleared it.** The gate is read from the attempt rows that already exist, which
 *      is why there is no second record of the same fact that could disagree.
 *   4. **The bookmark is private and only moves when a page actually changes.** The
 *      columns are asserted, because "the store never learns where you stopped" is a
 *      promise about a table, and the upsert's `where` clause is asserted, because a
 *      position that moved on every render would be a reading history rather than a
 *      bookmark.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:55432/bytebikri_test';
process.env.SESSION_SECRET ||= 'test-session-secret';
process.env.AD_POSTBACK_SECRET ||= 'test-postback-secret';

const { store, storage } = await import('../src/store.js');
const { query, close } = await import('../src/db.js');
const { startBreak, handlePostback } = await import('../src/unlocks.js');
const { betweenCues } = await import('../src/placement.js');
const { segmentsFor, gatesBefore, stepLabel, gateSentence } = await import('../src/pages.js');
const views = await import('../src/views.js');
const { makeComic } = await import('./helpers/zip.mjs');
const house = await import('../src/providers/house.js');

after(async () => { await close(); });

const SECRET = 'sandbox-secret';
let seq = 0;

/** A store selling one comic, in `breaks` mode, on a plan that allows gates. */
async function fixture({ pages = 12, value = 2_000, filename = 'comic.cbz', mime = 'application/vnd.comicbook+zip' } = {}) {
  const tag = `${Date.now()}-${++seq}`;
  const owner = await store.userByEmailOrCreate(`rdown-${tag}@test.local`);
  const viewer = await store.userByEmailOrCreate(`rdview-${tag}@test.local`);
  const other = await store.userByEmailOrCreate(`rdother-${tag}@test.local`);
  const channel = await store.createChannel({ ownerId: owner.id, slug: `rd-${tag}`, name: `RD ${tag}` });
  await query(
    `insert into subscriptions (channel_id, plan_code, status, period_start, period_end)
     values ($1, 'pro', 'active', now(), now() + interval '365 days')`,
    [channel.id],
  );
  const connection = await store.createConnection({ channelId: channel.id, providerId: 'house', secret: SECRET });
  const asset = await store.createAsset({
    channelId: channel.id, title: `Comic ${tag}`, slug: `comic-${tag}`, unlockMode: 'open',
  });
  const bytes = makeComic({ pages });
  await store.addFile({
    assetId: asset.id,
    storageKey: await storage.put(bytes, filename),
    filename, mimeType: mime, sizeBytes: bytes.length,
    checksum: crypto.createHash('sha256').update(bytes).digest('hex'),
  });
  await store.updateAsset(asset.id, { declared_value_npr: value, status: 'live', unlock_mode: 'breaks' });
  await store.setUnlockPolicy(asset.id, { ask_level: 'standard', unlock_hours: 24, mode: 'breaks' });
  return { owner, viewer, other, channel, connection, asset, bytes };
}

/** One signed delivery from the sandbox network, exactly as breakgate.test.js does it. */
async function deliver({ connection, viewId, externalId, completed = true }) {
  const body = JSON.stringify({ viewId, externalId, completed, durationSec: 15 });
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

test('the planner is told the page count, so a comic can actually carry its gates', async () => {
  const twelve = await fixture({ pages: 12 });
  const plan = await store.assetPagePlan(twelve.asset);
  assert.equal(plan.chapters, 12, 'twelve archive entries are twelve steps');
  assert.equal(plan.steps.length, 12);
  assert.equal(plan.flat, true, 'one archive is a flat page sequence');

  const placement = await store.adPlanFor(twelve.asset);
  assert.equal(placement.reason, 'between');
  assert.ok(placement.cues.length >= 1, 'a twelve-page read has room for a gate');
  for (const cue of placement.cues) {
    assert.equal(cue.kind, 'between');
    assert.equal(cue.atSec, null, 'a seam is not a timestamp');
    assert.ok(cue.atChapter >= 3 && cue.atChapter < 12, 'never before page 3, never past the last page');
  }
  // And the length is what decides where: a shorter archive gates earlier, because
  // the planner spreads the ask evenly through what there is. Before this slice both
  // fixtures were ONE chapter and neither could carry a gate at all.
  const six = await fixture({ pages: 6 });
  const short = await store.adPlanFor(six.asset);
  assert.ok(short.cues.length >= 1, 'a six-page read still has a legal seam');
  assert.ok(short.cues[0].atChapter < placement.cues[0].atChapter,
    'the shorter read gates sooner — the counts are real numbers, not a constant');
});

test('a reader gate is startable, and it snapshots the seam rather than a second', async () => {
  const { viewer, asset } = await fixture({ pages: 12 });
  const plan = await store.adPlanFor(asset);
  const cue = betweenCues(plan)[0];
  assert.ok(cue, 'the plan has a between cue');

  const started = await startBreak({ assetId: asset.id, userId: viewer.id, cueIndex: cue.index });
  assert.equal(started.ok, true);
  assert.equal(started.atChapter, cue.atChapter);
  assert.equal(started.total, betweenCues(plan).length);
  assert.equal(started.adConfig.cueAtSec, null, 'a reader has no playhead to return to');

  const row = await store.pendingView(started.viewId);
  assert.equal(row.break_index, cue.index);
  assert.equal(row.break_at_sec, null);
  assert.equal(row.placement, 'between', 'the ledger learns the reader’s word for the stop');
  assert.equal(row.surface, 'asset');

  // A cue that is not in the plan is still refused — the list is the planner's.
  const bogus = await startBreak({ assetId: asset.id, userId: viewer.id, cueIndex: 99 });
  assert.equal(bogus.ok, false);
});

test('a cleared seam releases the page, for the person who cleared it and nobody else', async () => {
  const { viewer, other, connection, asset } = await fixture({ pages: 12 });
  const plan = await store.adPlanFor(asset);
  const pagePlan = await store.assetPagePlan(asset);
  const { segments } = segmentsFor(pagePlan, betweenCues(plan));
  const cue = betweenCues(plan)[0];
  const after = cue.atChapter + 1;

  assert.deepEqual(await store.clearedGates(viewer.id, asset.id), []);
  const owed = gatesBefore(segments, after);
  assert.equal(owed.length, 1, 'the page after the seam owes it');
  assert.deepEqual(gatesBefore(segments, cue.atChapter), [], 'the page AT the seam does not');

  const started = await startBreak({ assetId: asset.id, userId: viewer.id, cueIndex: cue.index });
  await deliver({ connection, viewId: started.viewId, externalId: `rd-${cue.index}` });

  const cleared = await store.clearedGates(viewer.id, asset.id);
  assert.deepEqual(cleared, [cue.index]);
  // The rule the page route and the byte route both use: every gate before the step,
  // minus what this person has cleared.
  const stillOwed = gatesBefore(segments, after).filter((g) => !cleared.includes(Number(g.index)));
  assert.deepEqual(stillOwed, [], 'the seam is paid for');
  const otherCleared = await store.clearedGates(other.id, asset.id);
  const otherOwed = gatesBefore(segments, after).filter((g) => !otherCleared.includes(Number(g.index)));
  assert.equal(otherOwed.length, 1, 'and it is nobody else’s payment');
});

test('the bookmark is private, per person, and only moves when a page changes', async () => {
  const { viewer, other, asset } = await fixture({ pages: 12 });

  const first = await store.saveReadingProgress({ userId: viewer.id, assetId: asset.id, step: 5 });
  assert.equal(Number(first.step), 5);
  const again = await store.saveReadingProgress({ userId: viewer.id, assetId: asset.id, step: 5 });
  assert.equal(again, null, 'the same page is not a page change — nothing is written');
  const moved = await store.saveReadingProgress({ userId: viewer.id, assetId: asset.id, step: 9 });
  assert.equal(Number(moved.step), 9);

  const mine = await store.readingProgress(viewer.id, asset.id);
  assert.equal(Number(mine.step), 9);
  assert.equal(await store.readingProgress(other.id, asset.id), null, 'nobody else has one');

  // A step outside the file is refused rather than stored, because a bookmark for a
  // page that does not exist is a broken "continue" link later.
  assert.equal(await store.saveReadingProgress({ userId: viewer.id, assetId: asset.id, step: 0 }), null);
  assert.equal(await store.saveReadingProgress({ userId: viewer.id, assetId: asset.id, step: 2.5 }), null);

  // The promise about the table: four columns, none of them an accounting fact and
  // none of them readable by a store. Adding a column here is a decision, not a
  // refactor, which is why it is asserted.
  const { rows } = await query(
    `select column_name, is_nullable, data_type from information_schema.columns
      where table_name = 'reading_progress' order by ordinal_position`,
  );
  assert.deepEqual(rows.map((r) => r.column_name), ['user_id', 'asset_id', 'step', 'updated_at']);
  assert.ok(!rows.some((r) => /(seconds|percent|completed|revenue|paid|price|cut|amount)/i.test(r.column_name)),
    'no column here can be read as an accounting fact');
});

test('the reader draws pages, keeps the seam out of them, and says what it cannot draw', async () => {
  const { asset } = await fixture({ pages: 12 });
  const plan = await store.assetPagePlan(asset);

  const label = stepLabel(plan, 7);
  assert.equal(label, 'Page 7 of 12');
  assert.equal(gateSentence(plan, { atChapter: 6 }), 'One view after page 6.');

  const gate = views.readerPage({
    channel: { slug: 'rd', name: 'A store' }, asset,
    label, mode: 'page', direction: 'ltr', current: 7, total: 12,
    items: [{ n: 7, url: '/api/content/x/page/7?t=abc', alt: 'Page 7 of 12', caption: 'page-007.jpg' }],
    prevHref: '/s/rd/a/comic/read?p=6', nextHref: '/s/rd/a/comic/read?p=8',
    assetUrl: '/s/rd/a/comic',
    gate: null,
  });
  assert.match(gate, /data-reader data-reader-step="7"/);
  assert.match(gate, /src="\/api\/content\/x\/page\/7\?t=abc"/);
  assert.ok(!/₨|\bNPR\b/.test(gate), 'a reader has no price on it anywhere');

  const gated = views.readerPage({
    channel: { slug: 'rd', name: 'A store' }, asset,
    label: 'Page 7 of 12', mode: 'page', direction: 'ltr', current: 7, total: 12,
    items: [], prevHref: '/s/rd/a/comic/read?p=6', nextHref: null,
    assetUrl: '/s/rd/a/comic',
    gate: {
      cueIndex: 0, sentence: 'One view after page 6.', seconds: 15,
      nextHref: '/s/rd/a/comic/read?p=7',
    },
  });
  assert.match(gated, /data-reader-gate/);
  assert.match(gated, /data-cue-index="0"/);
  assert.match(gated, /data-next="\/s\/rd\/a\/comic\/read\?p=7"/);
  assert.match(gated, /One view after page 6\./);
  // The ask replaces the page turn, so there is no dead link beside it.
  assert.ok(!/rel="next"/.test(gated));

  const refused = views.readerPage({
    channel: { slug: 'rd', name: 'A store' }, asset,
    label: 'Page 1 of 1', mode: 'page', direction: 'ltr', current: 1, total: 1,
    items: [], assetUrl: '/s/rd/a/comic',
    refusal: { sentence: 'This reader draws image sets and archives of images. Download this file and use your own app.' },
    downloadUrl: '/api/content/x/file/y?t=abc',
  });
  assert.match(refused, /Download the file/);
  assert.match(refused, /use your own app/);

  // Right to left is a real swap, not a label: the forward control sits on the left.
  const rtl = views.readerPage({
    channel: { slug: 'rd', name: 'A store' }, asset,
    label: 'Page 3 of 12', mode: 'page', direction: 'rtl', current: 3, total: 12,
    items: [{ n: 3, url: '/p3', alt: 'Page 3' }],
    prevHref: '/prev', nextHref: '/next', assetUrl: '/s/rd/a/comic',
  });
  const bar = rtl.slice(rtl.indexOf('reader-bar'));
  assert.ok(bar.indexOf('href="/next"') < bar.indexOf('href="/prev"'),
    'in a manga the next page is on the left');
});

test('a file the reader cannot draw keeps its place and says so', async () => {
  const { asset } = await fixture({ pages: 1, filename: 'chapter-1.cbr', mime: 'application/x-cbr' });
  const plan = await store.assetPagePlan(asset);
  assert.equal(plan.chapters, 1);
  assert.equal(plan.steps[0].kind, 'file');
  assert.equal(plan.steps[0].drawable, false, 'a RAR comic is a download, not a page');
  const placement = await store.adPlanFor(asset);
  assert.equal(placement.cues.length, 0, 'and nothing can be gated inside it');

  const html = views.readerPage({
    channel: { slug: 'rd', name: 'A store' }, asset,
    label: 'Page 1 of 1', mode: 'page', direction: 'ltr', current: 1, total: 1,
    items: [], assetUrl: '/s/rd/a/comic',
    refusal: {
      sentence: plan.refusals[0]?.sentence
        ?? 'This reader draws image sets and archives of images. Download this file and use your own app.',
    },
    downloadUrl: '/api/content/x/file/y?t=abc',
  });
  assert.match(html, /Download the file/);
});

test('the store chooses page or scroll, and left to right or right to left', async () => {
  const { asset } = await fixture({ pages: 6 });
  const saved = await store.setReadChoices({ assetId: asset.id, mode: 'scroll', direction: 'rtl' });
  assert.equal(saved.read_mode, 'scroll');
  assert.equal(saved.read_direction, 'rtl');
  const reloaded = await store.assetById(asset.id);
  assert.equal(reloaded.read_mode, 'scroll');
  assert.equal(reloaded.read_direction, 'rtl');

  // The vocabulary is closed by the database, not by convention.
  await assert.rejects(() => query(`update assets set read_mode = 'diagonal' where id = $1`, [asset.id]));
  await assert.rejects(() => query(`update assets set read_direction = 'down' where id = $1`, [asset.id]));
});

test('the seller\'s panel renders the two choices, and only for a reader', async () => {
  const { asset, channel } = await fixture({ pages: 6 });
  const pages = await store.assetPagePlan(asset);
  const panel = views.assetManage({
    channel, asset, user: null, consent: null, flash: null,
    membershipsOn: false, tiers: [], planCode: 'free',
    files: await store.filesOf(asset.id), pages,
    policy: await store.unlockPolicy(asset.id),
    stats: { count: 0, average: null, latest: null }, unlocks: 0, caseFile: null,
  });
  assert.match(panel, /How this file reads/, 'the reader\'s panel is not on the page');
  assert.match(panel, /name="readMode" value="page" checked/);
  assert.match(panel, /name="readDirection" value="ltr" checked/);
  assert.match(panel, /6 steps/, 'the panel counts the steps it is describing');
  // Stored choices are read through the reader's own vocabulary, so the panel shows
  // the seller what is actually in force rather than a default.
  await store.setReadChoices({ assetId: asset.id, mode: 'scroll', direction: 'rtl' });
  const again = views.assetManage({
    channel, asset: await store.assetById(asset.id), user: null, consent: null, flash: null,
    membershipsOn: false, tiers: [], planCode: 'free',
    files: await store.filesOf(asset.id), pages,
    policy: await store.unlockPolicy(asset.id),
    stats: { count: 0, average: null, latest: null }, unlocks: 0, caseFile: null,
  });
  assert.match(again, /name="readMode" value="scroll" checked/);
  assert.match(again, /name="readDirection" value="rtl" checked/);

  // A video has no page order, and the panel is not there to pretend otherwise.
  const video = await fixture({ pages: 1, filename: 'talk.mp4', mime: 'video/mp4' });
  const videoPanel = views.assetManage({
    channel: video.channel, asset: video.asset, user: null, consent: null, flash: null,
    membershipsOn: false, tiers: [], planCode: 'free',
    files: await store.filesOf(video.asset.id), pages: await store.assetPagePlan(video.asset),
    policy: await store.unlockPolicy(video.asset.id),
    stats: { count: 0, average: null, latest: null }, unlocks: 0, caseFile: null,
  });
  assert.ok(!/How this file reads/.test(videoPanel), 'a video was offered a page direction');
});
