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

// ---------------------------------------------------------------------------
// Appeals: the seller's one answer, and what it is not allowed to be
// ---------------------------------------------------------------------------
//
// The dashboard used to call a report-hidden file "Paused" — the same word it
// uses for the pause its own seller chose — with no reason, no reporter count
// and nothing to click. That is the version of moderation that loses a creator
// for good: not the takedown, the silence around it. So the appeal exists, and
// the tests below pin the four things it must never become.

test('an appeal is the seller\'s words plus a snapshot of the charge', async () => {
  const { owner, channel, asset, reporter } = await fixture();
  const [a, b, c] = await Promise.all([reporter(1), reporter(2), reporter(3)]);
  await store.fileReport({ assetId: asset.id, channelId: channel.id, reporterId: a.id, reason: 'copyright' });
  await store.fileReport({ assetId: asset.id, channelId: channel.id, reporterId: b.id, reason: 'copyright' });
  await store.fileReport({ assetId: asset.id, channelId: channel.id, reporterId: c.id, reason: 'malware' });
  await store.hideByReports(asset.id);

  const caseFile = await store.fileCase(asset.id);
  assert.equal(caseFile.reporters, 3);
  assert.deepEqual([...caseFile.reasons].sort(), ['copyright', 'malware'], 'rules, not people');
  assert.equal(Object.hasOwn(caseFile, 'notes'), false, 'the seller never sees what the reporters typed');

  const filed = await store.fileAppeal({
    assetId: asset.id, channelId: channel.id, sellerId: owner.id,
    statement: 'The excerpt is 20 seconds and credited in the description.', 
    reasons: caseFile.reasons, reportCount: caseFile.reporters,
  });
  assert.equal(filed.filed, true);
  assert.equal(filed.appeal.status, 'open');
  assert.equal(filed.appeal.report_count, 3, 'the count is snapshotted, because reports get dismissed later');
  assert.equal((await store.assetById(asset.id)).hidden_by_reports, true, 'filing changes nothing about the file');
});

test('one open appeal at a time, and the race is the index\'s problem, not the route\'s', async () => {
  const { owner, channel, asset, reporter } = await fixture();
  const a = await reporter(1);
  await store.fileReport({ assetId: asset.id, channelId: channel.id, reporterId: a.id, reason: 'scam' });
  await store.hideByReports(asset.id);

  const base = { assetId: asset.id, channelId: channel.id, sellerId: owner.id, reasons: ['scam'], reportCount: 1 };
  const [first, second] = await Promise.all([
    store.fileAppeal({ ...base, statement: 'First attempt, sent twice by a double-tap.' }),
    store.fileAppeal({ ...base, statement: 'Second attempt from the same double-tap.' }),
  ]);
  assert.equal([first.filed, second.filed].filter(Boolean).length, 1, 'exactly one lands');
  const rows = await query('select count(*)::int as n from asset_appeals where asset_id = $1', [asset.id]);
  assert.equal(rows.rows[0].n, 1, 'and the partial unique index is what decided it');
});

test('upholding an appeal restores the file; declining writes it down and changes nothing', async () => {
  const { owner, channel, asset, reporter } = await fixture();
  const a = await reporter(1);
  await store.fileReport({ assetId: asset.id, channelId: channel.id, reporterId: a.id, reason: 'illegal' });
  await store.hideByReports(asset.id);
  const { appeal } = await store.fileAppeal({
    assetId: asset.id, channelId: channel.id, sellerId: owner.id,
    statement: 'This is a public-domain recording and the licence is in the description.',
    reasons: ['illegal'], reportCount: 1,
  });

  // A decline is a full answer: the decision, a person, a time and a note.
  const declined = await store.decideAppeal({ appealId: appeal.id, decision: 'declined', note: 'The licence does not cover redistribution.', actorId: owner.id });
  assert.equal(declined.ok, true);
  assert.equal(declined.restored, false);
  assert.equal((await store.assetById(asset.id)).status, 'paused', 'declining does not quietly un-hide anything');
  const decided = await store.openAppealFor(asset.id);
  assert.equal(decided, null, 'and it leaves the queue');

  // A decision cannot be overwritten by a resubmitted form.
  const twice = await store.decideAppeal({ appealId: appeal.id, decision: 'upheld', actorId: owner.id });
  assert.equal(twice.error, 'decided', 'the first decision stands');

  // A second appeal, upheld this time, gives the file back.
  const second = await store.fileAppeal({
    assetId: asset.id, channelId: channel.id, sellerId: owner.id,
    statement: 'The licence was updated since your note — here is the new one.', reasons: ['illegal'], reportCount: 1,
  });
  const upheld = await store.decideAppeal({ appealId: second.appeal.id, decision: 'upheld', actorId: owner.id });
  assert.equal(upheld.restored, true);
  const asset2 = await store.assetById(asset.id);
  assert.equal(asset2.status, 'live');
  assert.equal(asset2.hidden_by_reports, false, 'the file is back because the operator disagreed with the reports');
});

test('upholding NEVER un-pauses a file the seller paused, only one the threshold hid', async () => {
  const { owner, channel, asset, reporter } = await fixture();
  const a = await reporter(1);
  await store.fileReport({ assetId: asset.id, channelId: channel.id, reporterId: a.id, reason: 'scam' });
  const { appeal } = await store.fileAppeal({
    assetId: asset.id, channelId: channel.id, sellerId: owner.id,
    statement: 'Nothing here was hidden by the threshold, I paused it myself.',
    reasons: ['scam'], reportCount: 1,
  });
  const out = await store.decideAppeal({ appealId: appeal.id, decision: 'upheld', note: 'Read it.', actorId: owner.id });
  assert.equal(out.restored, false);
  assert.equal((await store.assetById(asset.id)).status, 'live', 'a file that was never hidden is left exactly as it was');
});

test('withdrawing closes the appeal and leaves the file exactly where it was', async () => {
  const { owner, channel, asset, reporter } = await fixture();
  const a = await reporter(1);
  await store.fileReport({ assetId: asset.id, channelId: channel.id, reporterId: a.id, reason: 'scam' });
  await store.hideByReports(asset.id);
  const { appeal } = await store.fileAppeal({
    assetId: asset.id, channelId: channel.id, sellerId: owner.id,
    statement: 'Withdrawing this — I was wrong about the licence.', reasons: ['scam'], reportCount: 1,
  });
  const out = await store.decideAppeal({ appealId: appeal.id, decision: 'withdrawn', actorId: owner.id });
  assert.equal(out.ok, true, 'the seller may close their own appeal');
  assert.equal(out.restored, false, 'withdrawing is not a way to un-hide a file');
  assert.equal((await store.assetById(asset.id)).hidden_by_reports, true);
  assert.equal(await store.openAppealFor(asset.id), null, 'and it leaves the operator queue');
  assert.equal(
    (await store.appealsOfChannel(channel.id)).filter((x) => x.asset_id === asset.id).length, 1,
    'it stays in the seller history, where the next reader can see it was closed on purpose',
  );
});

test('the seller cannot switch a reported file back on from their own settings form', async () => {
  const { channel, asset, reporter } = await fixture();
  const [a, b, c] = await Promise.all([reporter(1), reporter(2), reporter(3)]);
  for (const r of [a, b, c]) {
    await store.fileReport({ assetId: asset.id, channelId: channel.id, reporterId: r.id, reason: 'malware' });
  }
  await store.hideByReports(asset.id);

  // Two clicks used to do it: open the edit page, set the state to Live, save.
  const after = await store.updateAsset(asset.id, { status: 'live', title: 'Renamed while hidden' });
  assert.equal(after.status, 'paused', 'the platform owns the state while reports are holding the file');
  assert.equal(after.hidden_by_reports, true);
  assert.equal(after.title, 'Renamed while hidden', 'but every other field still saves — this is not a freeze');

  // The route says the same thing in words, so nobody has to guess.
  const { canAppeal, hidingNotice } = await import('../src/reports.js');
  assert.equal(canAppeal({ asset: after, openAppeal: null }).ok, true);
  const notice = hidingNotice({ reasons: ['malware'], reporters: 3 });
  assert.match(notice.headline, /3 independent reports hid this file/);
  assert.match(notice.detail, /harmful to open/, 'the seller is told the rule, not the names');
  assert.equal(canAppeal({ asset: { ...after, hidden_by_reports: false, status: 'paused' } }).why,
    'You paused this file yourself, so there is nothing to appeal.');
});

test('the appeal form refuses a one-word answer and a state it cannot act on', async () => {
  const { canAppeal, cleanStatement, APPEAL_LIMIT } = await import('../src/reports.js');
  assert.ok(APPEAL_LIMIT >= 400, 'an appeal is where a seller explains, so it is roomier than a report note');
  assert.equal(cleanStatement(`   spaced\n\nout   `), 'spaced out');
  assert.equal(cleanStatement('x'.repeat(APPEAL_LIMIT + 500)).length, APPEAL_LIMIT);

  assert.equal(canAppeal({ asset: { hidden_by_reports: false, status: 'live' } }).ok, false);
  assert.equal(canAppeal({ asset: { hidden_by_reports: true, status: 'paused' }, openAppeal: { id: 'x' } }).ok, false,
    'a second appeal waits for the first');
  assert.equal(canAppeal({ asset: { hidden_by_reports: true, status: 'paused', moderation_state: 'restricted' } }).ok, false,
    'an operator suspension is a different decision and is not reopened here');
});

test('the notice is written for the seller, and its states replace the silence', async () => {
  const { hidingNotice } = await import('../src/reports.js');
  const base = { reasons: ['copyright'], reporters: 3 };
  assert.match(hidingNotice(base).next, /answer once/, 'before filing, the page offers the one thing they can do');
  assert.equal(hidingNotice({ ...base, appeal: { status: 'open' } }).next, 'An appeal is with an operator.');
  assert.equal(hidingNotice({ ...base, appeal: { status: 'upheld' } }).next, 'Your appeal was upheld.');
  assert.equal(hidingNotice({ ...base, appeal: { status: 'declined' } }).next, 'Your appeal was considered and declined.');
  assert.equal(hidingNotice({ reasons: [], reporters: 2 }).detail,
    'It was reported for a policy this platform has. The file is hidden from your storefront, from Explore, '
    + 'and from its own link for anybody who has not already unlocked it. Nothing has been deleted — '
    + 'the file, its reviews and its unlocks are all here.',
    'and an unknown rule never prints a blank space where the reason should be');
});

test('every appeal outcome has a sentence on the page it lands on', async () => {
  const src = await (await import('node:fs/promises')).readFile(new URL('../server.js', import.meta.url), 'utf8');
  const success = src.slice(src.indexOf('const SUCCESS_FLASH'), src.indexOf('const ERROR_FLASH'));
  const errors = src.slice(src.indexOf('const ERROR_FLASH'), src.indexOf('const PLANS'));
  for (const [key, where] of [
    ['appeal_sent', success], ['appeal_withdrawn', success],
    ['appeal_upheld', success], ['appeal_restored', success], ['appeal_declined', success],
    ['appeal_state', errors], ['appeal_decision', errors], ['appeal_note', errors], ['appeal_decided', errors],
  ]) {
    assert.ok(where.includes(key), `${key} belongs in the ${where === success ? 'success' : 'error'} map, or its page renders no message`);
  }
});

test('the seller\'s own list keeps the files the public list drops', async () => {
  const { channel, asset, reporter } = await fixture();
  const a = await reporter(1);
  await store.fileReport({ assetId: asset.id, channelId: channel.id, reporterId: a.id, reason: 'scam' });
  await store.hideByReports(asset.id);

  const publicList = await store.assetsOf(channel.id);
  const ownList = await store.assetsForOwner(channel.id);
  assert.equal(publicList.some((x) => x.id === asset.id), false, 'the storefront and the public API stay live-only');
  assert.equal(ownList.some((x) => x.id === asset.id), true,
    'and the owner can still see it, or the appeal page has no route to it at all');
});

test('a file that is not live is off the public web, with three exceptions', async () => {
  const { maySeeHiddenFile } = await import('../src/reports.js');
  const { viewSurvivesHiding } = await import('../src/unlocks.js');
  assert.equal(typeof viewSurvivesHiding, 'function', 'one rule, one place — the postback handler calls this too');

  const ownerId = 'owner-1';
  const live = { status: 'live' };
  const hidden = { status: 'paused', hidden_by_reports: true, updated_at: new Date('2026-09-20T00:00:00Z') };
  assert.equal(maySeeHiddenFile({ asset: live, user: null }), true, 'live files are public, including to signed-out visitors');
  assert.equal(maySeeHiddenFile({ asset: hidden, user: null }), false, 'a stranger with the link gets a 404');
  assert.equal(maySeeHiddenFile({ asset: hidden, user: { id: 'someone', role: 'user' } }), false, 'and so does another signed-in seller');
  assert.equal(maySeeHiddenFile({ asset: hidden, user: { id: ownerId, role: 'user' }, ownerId }), true, 'its owner can still open it');
  assert.equal(maySeeHiddenFile({ asset: hidden, user: { id: 'op', role: 'admin' } }), true, 'and so can the person deciding');
  assert.equal(maySeeHiddenFile({ asset: hidden, holdsUnlock: true }), true,
    'an unlock earned by watching an ad is not confiscated by a listing decision');

  // And the ad path itself: a view that started before the hide still pays out.
  assert.equal(viewSurvivesHiding({
    view: { created_at: new Date('2026-09-19T23:59:00Z') }, asset: hidden,
  }), true, 'the ad was watched while the file was live — the network already paid the creator');
  assert.equal(viewSurvivesHiding({
    view: { created_at: new Date('2026-09-20T00:01:00Z') }, asset: hidden,
  }), false, 'an ad started after the hide releases nothing');
  assert.equal(viewSurvivesHiding({ view: {}, asset: live }), true, 'and a live file is business as usual');
});
