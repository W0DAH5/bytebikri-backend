/**
 * Reports: one person, one vote, and three votes to hide.  npm test
 *
 * The Android app has had `flagged_assets` since its first schema; the web never
 * got it, so the only way to complain about a file was to find somebody's email.
 * This is that feature, and the decisions that matter are all about what a report
 * is NOT allowed to do.
 *
 * The one that matters most:
 *
 *   A SINGLE REPORT NEVER HIDES A FILE. The obvious implementation hides on the
 *   first report, and that hands every seller a weapon — three clicks from one
 *   determined competitor and a rival's best file is invisible until an operator
 *   happens to look. So the threshold is three DISTINCT reporters, the count is
 *   enforced by a unique index rather than by careful arithmetic in a route, and
 *   both facts are asserted here.
 *
 * The rest is the usual: the reasons are policy codes rather than sentences, the
 * reporter is never shown to the operator (a queue that names complainants is a
 * harassment tool), and a second attempt is told the truth instead of being
 * thanked twice.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:55432/bytebikri_test';

const {
  AUTO_HIDE_AFTER, ESCALATE_AFTER, REPORT_REASONS, EXTRA_POLICY_RULES, NOTE_LIMIT,
  cleanNote, knownReportReason, reasonLabel, validateReport, reportVerdict,
  orderQueue, reporterMessage, REPORT_HONESTY,
} = await import('../src/reports.js');

const { store } = await import('../src/store.js');
const { query, close } = await import('../src/db.js');
const { after } = await import('node:test');
after(async () => { await close(); });

// ---------------------------------------------------------------------------
// The threshold, stated as arithmetic
// ---------------------------------------------------------------------------

test('three distinct reporters hide a file, and two do not', () => {
  assert.equal(AUTO_HIDE_AFTER, 3, 'the number is a decision written down, not a magic value in a route');
  assert.ok(ESCALATE_AFTER < AUTO_HIDE_AFTER, 'escalation has to come before the axe');
  assert.equal(reportVerdict({ reporters: 0 }).autoHide, false);
  assert.equal(reportVerdict({ reporters: 1 }).autoHide, false, 'ONE REPORT NEVER HIDES A FILE');
  assert.equal(reportVerdict({ reporters: 2 }).autoHide, false);
  assert.equal(reportVerdict({ reporters: 2 }).escalate, true, 'but two does get a person looking sooner');
  assert.equal(reportVerdict({ reporters: 3 }).autoHide, true);
  assert.equal(reportVerdict({ reporters: 9 }).autoHide, true);
});

test('the summary says how many people, and what they said', () => {
  const v = reportVerdict({ reporters: 4, byReason: { malware: 3, scam: 1 } });
  assert.match(v.summary, /4 distinct reporters/);
  assert.match(v.summary, /most often “It is harmful to open”/);
  assert.equal(v.topReason, 'malware');
  assert.equal(reportVerdict({ reporters: 1 }).summary, '1 distinct reporter');
  assert.equal(reportVerdict({ reporters: 0 }).summary, 'No reports.');
});

test('the queue is ordered by trouble, not by arrival', () => {
  const rows = [
    { id: 'a', reporters: 1, latest: '2026-09-21T10:00:00Z', byReason: {} },
    { id: 'b', reporters: 4, latest: '2026-09-19T10:00:00Z', byReason: {} },   // over the line
    { id: 'c', reporters: 2, latest: '2026-09-21T09:00:00Z', byReason: {} },
    { id: 'd', reporters: 1, latest: '2026-09-21T12:00:00Z', byReason: {} },
  ];
  assert.deepEqual(orderQueue(rows).map((r) => r.id), ['b', 'c', 'd', 'a'],
    'hidden files first, then by how many people, then the newest claim');
});

// ---------------------------------------------------------------------------
// What a reporter may say, and what they are told
// ---------------------------------------------------------------------------

test('a reason is one of our codes, never a sentence', () => {
  assert.ok(REPORT_REASONS.length >= 4, 'a report form with two options is not a report form');
  for (const r of REPORT_REASONS) {
    assert.ok(knownReportReason(r.code), `${r.code} is offered but not known`);
    assert.ok(r.label && r.label.length < 60, `${r.code} needs a label a person would choose`);
  }
  assert.equal(knownReportReason('my_own_idea'), false);
  assert.equal(knownReportReason('<script>'), false);
  assert.equal(reasonLabel('scam'), 'It is not what was described');
  assert.equal(reasonLabel('nope'), null);
});

test('a report is refused unless the reason is real, and a seller cannot report their own file', () => {
  assert.equal(validateReport({ reason: 'nope' }).error, 'reason');
  assert.equal(validateReport({ reason: '' }).error, 'reason');
  assert.equal(validateReport({ reason: 'malware', reporterId: 'u1', ownerId: 'u1' }).error, 'self');
  const ok = validateReport({ reason: 'malware', note: '  it   runs  a script ', reporterId: 'u1', ownerId: 'u2' });
  assert.deepEqual(ok, { ok: true, reason: 'malware', note: 'it runs a script' });
});

test('the reporter\'s own words are capped, flattened, and only ever a hint', () => {
  assert.equal(cleanNote('line\nline'), 'line line');
  assert.equal(cleanNote('a\u0000b'), 'a b');
  assert.equal(cleanNote('x'.repeat(900)).length, NOTE_LIMIT);
  assert.equal(cleanNote(null), '');
  // And the honesty copy says out loud that one report is not a takedown.
  assert.match(REPORT_HONESTY.long, /do not remove a file because one person reported it/);
  assert.match(REPORT_HONESTY.short, /never hides/i);
});

test('the reporter is told the truth, including when they are repeating themselves', () => {
  assert.match(reporterMessage({ reporters: 1 }), /do not take a file down on one report/);
  assert.match(reporterMessage({ reporters: AUTO_HIDE_AFTER }), /now hidden/);
  assert.match(reporterMessage({ already: true }), /already reported/);
  // Nothing promises an outcome we do not control.
  for (const m of [reporterMessage({ reporters: 1 }), reporterMessage({ reporters: 5 }), reporterMessage({ already: true })]) {
    assert.ok(!/will be (removed|deleted|banned)/i.test(m), `a promise we cannot keep: ${m}`);
  }
});

test('the codes this module offers exist in the policy table', async () => {
  // A report reason is a foreign key. If the migration and this module ever
  // drift, the failure lands on a buyer pressing send.
  const rows = await query('select code from policy_rules');
  const known = new Set(rows.rows.map((r) => r.code));
  for (const r of REPORT_REASONS) assert.ok(known.has(r.code), `${r.code} is offered but has no policy rule`);
  for (const r of EXTRA_POLICY_RULES) assert.ok(known.has(r.code), `${r.code} is in EXTRA_POLICY_RULES but not in the table`);
});

// ---------------------------------------------------------------------------
// The store side
// ---------------------------------------------------------------------------

let seq = 0;
async function fixture() {
  const tag = `${Date.now()}-${++seq}`;
  const owner = await store.userByEmailOrCreate(`rep-owner-${tag}@test.local`);
  const channel = await store.createChannel({ ownerId: owner.id, slug: `rep-${tag}`, name: `Rep ${tag}` });
  const asset = await store.createAsset({ channelId: channel.id, title: 'Reported file', slug: `file-${tag}`, unlockMode: 'open' });
  const reporter = async (n) => store.userByEmailOrCreate(`rep-${tag}-${n}@test.local`);
  return { owner, channel, asset, reporter };
}

test('one person, one vote: the second attempt is a no-op and is reported as one', async () => {
  const { channel, asset, reporter } = await fixture();
  const r1 = await reporter(1);

  const first = await store.fileReport({ assetId: asset.id, channelId: channel.id, reporterId: r1.id, reason: 'malware', note: 'script' });
  assert.equal(first.filed, true);
  assert.equal(first.reporters, 1);

  const again = await store.fileReport({ assetId: asset.id, channelId: channel.id, reporterId: r1.id, reason: 'scam', note: '' });
  assert.equal(again.filed, false, 'the unique index is the vote counter, not the route');
  assert.equal(again.reporters, 1, 'and a repeat is not a second vote');
  assert.equal(await store.hasReported(asset.id, r1.id), true);

  const rows = await store.reportsForAsset(asset.id);
  assert.equal(rows.length, 1, 'one row, not two — a queue must not double-count');
});

test('three distinct people cross the threshold; two people and a repeat do not', async () => {
  const { channel, asset, reporter } = await fixture();
  const [a, b, c] = await Promise.all([reporter(1), reporter(2), reporter(3)]);

  await store.fileReport({ assetId: asset.id, channelId: channel.id, reporterId: a.id, reason: 'malware' });
  await store.fileReport({ assetId: asset.id, channelId: channel.id, reporterId: a.id, reason: 'malware' });
  await store.fileReport({ assetId: asset.id, channelId: channel.id, reporterId: b.id, reason: 'scam' });
  let verdict = await store.reportVerdictFor(asset.id);
  assert.equal(verdict.reporters, 2);
  assert.equal(reportVerdict(verdict).autoHide, false, 'still visible, and it should be');

  await store.fileReport({ assetId: asset.id, channelId: channel.id, reporterId: c.id, reason: 'scam' });
  verdict = await store.reportVerdictFor(asset.id);
  assert.equal(verdict.reporters, 3);
  const v = reportVerdict(verdict);
  assert.equal(v.autoHide, true);
  // Two people said 'scam', one said 'malware': the queue row names the majority
  // reason, because that is the one the operator reads first.
  assert.equal(v.topReason, 'scam');
  assert.deepEqual(verdict.byReason, { malware: 1, scam: 2 });
});

test('the queue is one row per file, with the notes and without the names', async () => {
  const { channel, asset, reporter } = await fixture();
  const [a, b] = await Promise.all([reporter(1), reporter(2)]);
  await store.fileReport({ assetId: asset.id, channelId: channel.id, reporterId: a.id, reason: 'copyright', note: 'It is my artwork.' });
  await store.fileReport({ assetId: asset.id, channelId: channel.id, reporterId: b.id, reason: 'copyright', note: '' });

  const queue = await store.openReports();
  const row = queue.find((r) => r.asset_id === asset.id);
  assert.ok(row, 'the file is in the queue');
  assert.equal(row.reporters, 2, 'and it is ONE row for two reports');
  assert.equal(row.with_notes, 1);
  assert.deepEqual(row.byReason, { copyright: 2 });
  assert.equal(row.channel_slug, channel.slug);
  assert.ok(!Object.keys(row).some((k) => k.includes('reporter_id')), 'the operator decides about a file, not about a person');
  assert.ok(!JSON.stringify(row).includes(a.id), 'and no reporter identity leaks into the queue payload');
});

test('resolving closes every open report on the file, and keeps the record', async () => {
  const { owner, channel, asset, reporter } = await fixture();
  const [a, b] = await Promise.all([reporter(1), reporter(2)]);
  await store.fileReport({ assetId: asset.id, channelId: channel.id, reporterId: a.id, reason: 'scam' });
  await store.fileReport({ assetId: asset.id, channelId: channel.id, reporterId: b.id, reason: 'scam' });

  const closed = await store.resolveReports({ assetId: asset.id, status: 'dismissed', resolution: 'checked', actorId: owner.id });
  assert.equal(closed, 2);
  assert.equal((await store.openReports()).find((r) => r.asset_id === asset.id), undefined);
  const after_ = await store.reportsForAsset(asset.id);
  assert.equal(after_.length, 2, 'the reports are still there — dismissed is a decision, not a delete');
  assert.ok(after_.every((r) => r.status === 'dismissed' && r.resolved_at));
  // And a resolved report does not count towards a future threshold.
  const v = await store.reportVerdictFor(asset.id);
  assert.equal(v.reporters, 0, 'closed reports stop voting, or yesterday\'s decision haunts today\'s file');
});

test('the auto-hide is reversible, and only for the file it hid', async () => {
  const { owner, channel, asset, reporter } = await fixture();
  const [a, b, c] = await Promise.all([reporter(1), reporter(2), reporter(3)]);
  for (const r of [a, b, c]) {
    await store.fileReport({ assetId: asset.id, channelId: channel.id, reporterId: r.id, reason: 'malware' });
  }
  assert.equal(reportVerdict(await store.reportVerdictFor(asset.id)).autoHide, true);

  // The threshold hides it, and REMEMBERS that it was the threshold.
  const hidden = await store.hideByReports(asset.id);
  assert.equal(hidden.status, 'paused');
  assert.equal(hidden.hidden_by_reports, true);

  // An operator reads the reports and disagrees.
  await store.resolveReports({ assetId: asset.id, status: 'dismissed', resolution: 'checked', actorId: owner.id });
  const back = await store.restoreFromReports(asset.id);
  assert.equal(back.status, 'live', 'dismissing the reports has to give the file back');
  assert.equal(back.hidden_by_reports, false);
});

test('a file its seller paused is NOT un-paused by dismissing a report', async () => {
  const { owner, channel, asset, reporter } = await fixture();
  const a = await reporter(1);
  await store.fileReport({ assetId: asset.id, channelId: channel.id, reporterId: a.id, reason: 'scam' });

  // The seller takes their own file down, for their own reasons.
  await store.updateAsset(asset.id, { status: 'paused' });
  assert.equal((await store.assetById(asset.id)).hidden_by_reports, false,
    'the seller setting the status clears the system flag');

  await store.resolveReports({ assetId: asset.id, status: 'dismissed', resolution: 'nothing wrong', actorId: owner.id });
  const restored = await store.restoreFromReports(asset.id);
  assert.equal(restored, null, 'restore touches only files the threshold hid');
  assert.equal((await store.assetById(asset.id)).status, 'paused', 'and the seller\'s decision stands');
});

test('reportCounts answers for the console without doing arithmetic in a view', async () => {
  const { channel, asset, reporter } = await fixture();
  const before = await store.reportCounts();
  const a = await reporter(1);
  await store.fileReport({ assetId: asset.id, channelId: channel.id, reporterId: a.id, reason: 'illegal' });
  const after_ = await store.reportCounts();
  assert.equal(Number(after_.open), Number(before.open) + 1);
  assert.ok(Number(after_.total) >= Number(after_.open));
});
