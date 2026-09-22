/**
 * Seller verification — the outcome, and never the evidence.  npm test
 *
 * The table this uses was written in migration 0001 with its intent already in a
 * comment: "Stores the OUTCOME of KYC, never the evidence." For the whole life of
 * the project nothing read it, while the paid plan advertised the badge it was
 * built for and the operator's People page said the platform had no KYC step. So
 * these tests are about the three things that were actually wrong:
 *
 *   1. The state machine, including the part nobody stores — a check LAPSES, and
 *      nothing has to run at midnight for that to be true.
 *   2. The wording. A badge that says "verified" invites a buyer to hear
 *      "trustworthy"; researched guidance is that it must state what was checked.
 *      A test is the only thing that can hold a sentence still.
 *   3. The evidence. No path may store a document, a number or a scan — and the
 *      database says so itself, which is worth asserting rather than trusting.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
// The repository root, not the app: the migrations this test reads live in
// <repo>/db/migrations.
const repo = path.resolve(here, '../..');
process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:55432/bytebikri_test';

const { close, query } = await import('../src/db.js');
after(async () => { await close(); });

// Fixtures of our own: the test database carries no demo store, and a test that
// reaches for alice is a test that breaks the day the seed changes.
let seq = 0;
async function fixture() {
  const tag = `${Date.now()}-${++seq}`;
  const user = await store.userByEmailOrCreate(`owner-ver-${tag}@test.local`);
  return store.createChannel({ ownerId: user.id, slug: `ver-${tag}`, name: `Ver ${tag}` });
}

const {
  METHODS, methodOf, stateOf, requestability, badgeFor, whatItMeans, expires, longDay,
  lapseOf, lapseNotice, LAPSE_LEVELS, LAPSE_WINDOW_DAYS,
} = await import('../src/verification.js');
const { store } = await import('../src/store.js');

const row = (over = {}) => ({
  id: 'v1', channel_id: 'c1', method: 'citizenship', status: 'verified',
  verified_at: new Date('2026-03-04T00:00:00Z'),
  decided_at: new Date('2026-03-04T00:00:00Z'),
  expires_at: new Date('2028-03-04T00:00:00Z'),
  created_at: new Date('2026-03-04T00:00:00Z'),
  ...over,
});

// ── the state, and the one that lapses by itself ─────────────────────────────

test('a check is only good until it lapses, and nothing has to sweep it', () => {
  const r = row();
  assert.equal(stateOf(r), 'verified', 'inside its window, it counts');
  assert.equal(stateOf(r, new Date('2028-03-03T00:00:00Z')), 'verified', 'the day before it still counts');
  assert.equal(stateOf(r, new Date('2028-03-05T00:00:00Z')), 'expired', 'and the day after it does not');
  // Derived, not stored: the row is untouched and still says verified, which is
  // what the record should say — the STATE is what changed.
  assert.equal(r.status, 'verified', 'the row is not rewritten to make it lapse');
  assert.equal(stateOf(null), 'none', 'no row at all is its own state');
  assert.equal(stateOf({ status: 'pending' }), 'pending');
  assert.equal(stateOf({ status: 'rejected' }), 'rejected');
});

test('a lapsed check can be asked for again, a live one cannot', () => {
  const caps = { verified_badge: true };
  assert.equal(requestability({ capabilities: caps, state: 'none' }).ok, true);
  assert.equal(requestability({ capabilities: caps, state: 'expired' }).ok, true, 'asking again is the point of expiry');
  assert.equal(requestability({ capabilities: caps, state: 'rejected' }).ok, true, 'a refusal is not a ban');
  const pending = requestability({ capabilities: caps, state: 'pending' });
  assert.equal(pending.ok, false);
  assert.equal(pending.code, 'already-asked', 'and the refusal carries a code, not a sentence, into the query string');
  assert.equal(requestability({ capabilities: caps, state: 'verified' }).code, 'already-checked');
  const cheap = requestability({ capabilities: { verified_badge: false }, state: 'none' });
  assert.equal(cheap.ok, false);
  assert.equal(cheap.code, 'plan');
  // The line a free store reads must not make it feel like a suspect.
  assert.match(cheap.detail, /sell exactly the same/);
});

test('a refusal tells the person what to do next, because a failed check is not fraud', () => {
  const again = requestability({ capabilities: { verified_badge: true }, state: 'rejected' });
  assert.match(again.detail, /ask again/i);
  assert.match(again.detail, /note on the refusal/i);
});

// ── the sentence, which is the product ───────────────────────────────────────

test('the badge says what was checked and when, and never says trustworthy', () => {
  const b = badgeFor(row());
  assert.equal(b.label, 'Identity checked');
  assert.match(b.sentence, /citizenship certificate/, 'names the document type');
  assert.match(b.sentence, /4 Mar 2026/, 'and the date it was seen');
  assert.equal(/trusted|trustworthy|safe|genuine|guarantee/i.test(b.sentence), false,
    'a badge cannot claim what a document check does not prove');
  assert.equal(/verified seller/i.test(b.sentence), false,
    '"verified seller" is the phrase that gets over-read — the badge states the check instead');
  // Every method produces its own sentence, and none of them is empty.
  for (const m of METHODS) {
    const line = badgeFor(row({ method: m.code })).sentence;
    assert.ok(line.includes(m.label), `${m.code} names what was looked at`);
  }
});

test('nothing is claimed when there is nothing to claim', () => {
  assert.equal(badgeFor(null), null);
  assert.equal(badgeFor({ status: 'pending' }), null, 'asking is not being checked');
  assert.equal(badgeFor({ status: 'rejected' }), null);
  assert.equal(badgeFor(row({ expires_at: new Date('2020-01-01T00:00:00Z') })), null,
    'and a lapsed check shows no badge without anybody clearing it');
});

test('what we keep is stated plainly, and it is not the document', () => {
  const lines = whatItMeans().join(' ');
  assert.match(lines, /No copy, scan or photograph/i);
  assert.match(lines, /not a review of the files/i, 'the limit is written down where a seller reads it');
  assert.match(lines, /lapses/i);
  // The badge's own sentence and the explainer must not disagree about the date.
  assert.match(lines, /the date/i);
});

// ── the evidence, which must not exist anywhere ──────────────────────────────

test('the database itself refuses to store a document', () => {
  const sql = readFileSync(path.join(repo, 'db/migrations/0001_init.sql'), 'utf8');
  assert.match(sql, /docs_retained boolean not null default false check \(docs_retained = false\)/,
    'the column that makes an evidence breach impossible is still there');
  const ours = readFileSync(path.join(repo, 'db/migrations/0026_seller_verification.sql'), 'utf8');
  assert.equal(/add column[^;]*\b(bytes|scan|image|document|file)\b/i.test(ours), false,
    'and this round added no column that could hold one');
});

test('the seller form cannot become the place a number is pasted', () => {
  // The route refuses anything that looks like a document number, and says why.
  const server = readFileSync(path.join(here, '..', 'server.js'), 'utf8');
  assert.match(server, /no-numbers/, 'there is a refusal for it');
  assert.match(server, /looks like a document number/i, 'with a reason a person can act on');
  const views = readFileSync(path.join(here, '..', 'src/views.js'), 'utf8');
  assert.match(views, /Do not paste a document number here/, 'and the field says so before anybody types');
});

test('an outcome records who decided, and the audit line carries no note', async () => {
  const server = readFileSync(path.join(here, '..', 'server.js'), 'utf8');
  const call = server.slice(server.indexOf("APP.post('/admin/stores/:slug/verification'"));
  const body = call.slice(0, call.indexOf('\n});'));
  assert.match(body, /actorId: req\.user\.id/, 'the decision names the person who made it');
  // The audit entry names the decision, the method and the window. The note stays
  // on the outcome row: the audit log is browsed by more people than the console.
  const audit = body.slice(body.indexOf("store.audit("));
  assert.equal(/notes/.test(audit.split('\n')[0] + audit.split('\n')[1]), false,
    'the audit line does not carry the operator note');
});

// ── the window ───────────────────────────────────────────────────────────────

test('expiry is a real date, from the moment the check happens', () => {
  const from = new Date('2026-03-04T00:00:00Z');
  assert.equal(longDay(expires(24, from)), '4 Mar 2028', 'two years is the default window');
  assert.equal(longDay(expires(12, from)), '4 Mar 2027');
  assert.equal(longDay(expires(36, from)), '4 Mar 2029');
  assert.equal(longDay('not a date'), 'an unknown date', 'a bad date never prints Invalid Date to a person');
});

test('the methods are the documents a creator here actually has', () => {
  assert.deepEqual(METHODS.map((m) => m.code).sort(),
    ['business_reg', 'citizenship', 'manual', 'pan', 'passport']);
  assert.match(methodOf('pan').detail, /Nagarik/, 'the PAN note names how it can actually be checked');
  for (const m of METHODS) {
    assert.ok(m.label && m.title && m.detail, `${m.code} is described wherever it is chosen`);
  }
});

// ── the write path, against the real table ───────────────────────────────────

test('a check decided after midnight in Kathmandu is dated that morning, not the evening before', () => {
  // The one place the choice of clock is visible. 18:45 UTC is 00:30 the NEXT day
  // in Nepal: a seller who brings a document just after midnight must not read that
  // the person looked at it "yesterday". If this ever fails, somebody has moved the
  // formatter back to UTC — read the comment on `longDay` before changing it.
  assert.equal(longDay('2026-09-22T18:45:00Z'), '23 Sept 2026');
  // And the reverse boundary: 18:14 UTC is still 23:59 on the 22nd in Nepal.
  assert.equal(longDay('2026-09-22T18:14:00Z'), '22 Sept 2026');
  // A calendar date arriving as a `date` column is UTC midnight and must not jump.
  assert.equal(longDay('2026-09-02T00:00:00Z'), '2 Sept 2026');
  // The badge sentence uses the same formatter, so it inherits the same day.
  const badge = badgeFor({ status: 'verified', method: 'citizenship', verified_at: '2026-09-22T18:45:00Z' }, new Date('2026-11-01T00:00:00Z'));
  assert.match(badge.sentence, /23 Sept 2026/);
});

const escOf = (rendered) => rendered.replace(/^<p class="fine"[^>]*>/, '').replace(/<\/p>$/, '');

test('a store with no check is not called "null" anywhere', async () => {
  // The Explore rails rendered `${badgeFor(v) && verifiedBadge(v)}`: `null && …` is
  // `null`, and a template literal prints it, so every un-checked store in the
  // directory read "Nima Craftsnull" under its own name. This asserts the whole
  // page for the string, because the bug was a hole in the markup rather than a
  // wrong sentence, and it was only ever visible in a screenshot.
  const views = await import('../src/views.js');
  const plain = { id: 'c2', slug: 'nima', name: 'Nima Crafts', tagline: 'Notebooks', listing_mode: 'marketplace' };
  const rails = {
    rails: [{ key: 'popular', title: 'Popular this week', note: 'Earned.', entries: [
      { channel: plain, rank: 1, why: 'x', alsoPlaced: false },
      { channel: { ...plain, name: 'Alice', verification: { status: 'verified', method: 'pan', verified_at: '2026-01-01T00:00:00Z' } }, rank: 2, why: 'y', alsoPlaced: false },
    ] }],
  };
  const html = views.marketplace({ channels: [plain], user: null, explore: rails, q: '' });
  assert.ok(!/>null</.test(html) && !/null</.test(html), 'nothing on the page literally reads null');
  assert.ok(!html.includes('Nima Craftsnull'), 'the name is the name');
  assert.ok(html.includes('Nima Crafts'), 'and it is still there');
  assert.ok(html.includes('Identity checked'), 'the checked store still shows its chip');
  // The chip is separated from the name, not glued to it.
  assert.match(html, /Alice <span class="pill pill-success">Identity checked/);
});

test('only a recognised verified row paints the badge; anything else paints nothing', () => {
  // The dangerous direction. A status this code does not know about is not a
  // reason to tell the world somebody's identity was checked.
  for (const status of ['none', 'verifed', 'REJECTED', '', null, undefined, 'pending-docs']) {
    assert.equal(stateOf({ status }), 'none', `unknown status ${JSON.stringify(status)} is not a check`);
    assert.equal(badgeFor({ status }), null, `no badge for ${JSON.stringify(status)}`);
  }
  assert.equal(stateOf(null), 'none');
  assert.equal(badgeFor(null), null);
  // And the four it does know.
  assert.equal(stateOf({ status: 'pending' }), 'pending');
  assert.equal(stateOf({ status: 'rejected' }), 'rejected');
  assert.equal(stateOf({ status: 'verified', expires_at: '2099-01-01T00:00:00Z' }), 'verified');
  assert.equal(stateOf({ status: 'verified', expires_at: '2001-01-01T00:00:00Z' }), 'expired', 'a lapsed check is derived, not stored');
});

test('the chip and the sentence come from one string, and the storefront shows each once', async () => {
  // The bug this pins: the storefront called the pill renderer twice, so a checked
  // store read "IDENTITY CHECKED" twice in a row with the sentence only under the
  // second one. The rule now is a chip in the heading row and the sentence beneath
  // the facts — and both render the SAME text, from `badgeFor`.
  const views = await import('../src/views.js');
  const row = {
    status: 'verified', method: 'pan', verified_at: '2026-06-01T04:00:00Z', expires_at: '2028-06-01T04:00:00Z',
  };
  const html = views.storefront({
    channel: { id: 'c1', slug: 's', name: 'S', tagline: 't', listing_mode: 'marketplace' },
    assets: [], slots: [], user: null, estimate: null, pageviews: 0, verification: row,
  });
  assert.equal((html.match(/pill-success">Identity checked/g) || []).length, 1, 'the chip is drawn once');
  assert.equal((html.match(/A person on our side looked at/g) || []).length, 1, 'and the sentence once');
  // Exactly the string the badge carries — not a paraphrase rendered from a
  // second code path.
  assert.ok(html.includes(escOf(views.verifiedSentence(row))));
  assert.equal(views.verifiedSentence({ status: 'none' }), '', 'no row, no sentence');
  assert.equal(views.verifiedBadge({ status: 'none' }), '', 'and no chip');
});

test('asking twice is one request, and the second answer is not an error', async () => {
  const channel = await fixture();

  // A request, then the same request again: the partial unique index decides.
  const first = await store.askForVerification({ channelId: channel.id, note: 'In Pokhara until Friday.' });
  assert.equal(first.ok, true);
  const second = await store.askForVerification({ channelId: channel.id, note: 'again' });
  assert.equal(second.ok, false, 'two clicks are one request');

  // TWO reads, because they are two facts. The open request is one; what the badge
  // is standing on is the other, and a request is not a decision — so the badge
  // read says nothing while the request read says pending.
  const open = await store.pendingVerificationFor(channel.id);
  assert.equal(stateOf(open), 'pending');
  assert.equal(await store.verificationFor(channel.id), null,
    'an open request is not an outcome, and the badge must not read one as the other');

  await store.withdrawVerificationRequest(channel.id);
  assert.equal(await store.pendingVerificationFor(channel.id), null, 'withdrawn means gone, not hidden');

  // And a recorded outcome replaces the request.
  await store.askForVerification({ channelId: channel.id, note: null });
  const decided = await store.recordVerification({
    channelId: channel.id, outcome: 'verified', method: 'citizenship',
    actorId: null, months: 24, note: 'Name matched the account.',
  });
  assert.equal(decided.status, 'verified');
  assert.equal(decided.docs_retained, false, 'and no row may ever say otherwise');
  assert.ok(decided.expires_at, 'a verified row always has a window');
  const after = await store.verificationFor(channel.id);
  assert.equal(stateOf(after), 'verified');
  assert.equal(after.notes, 'Name matched the account.');

  // Clean up after ourselves: a test database is still a database somebody reads.
  await store.recordVerification({ channelId: channel.id, outcome: 'rejected', method: 'manual', actorId: null, note: 'test teardown' });
  await query('delete from seller_verifications where channel_id = $1', [channel.id]);
  assert.equal(await store.verificationFor(channel.id), null);
  await query('delete from channels where id = $1', [channel.id]);
});

test('the lapse bands are boundaries, not vibes', () => {
  const now = new Date('2026-06-01T06:00:00Z');
  const at = (days) => lapseOf(
    { status: 'verified', method: 'pan', verified_at: '2026-01-01T00:00:00Z', expires_at: new Date(now.getTime() + days * 86400000) },
    now,
  );
  assert.equal(at(400).level, 'current');
  assert.equal(at(61).level, 'current', 'one day outside the window is outside it');
  assert.equal(at(60).level, 'soon', 'the window starts here');
  assert.equal(at(31).level, 'soon');
  assert.equal(at(30).level, 'due', 'a month is the loud band');
  assert.equal(at(1).level, 'due');
  assert.equal(at(0).level, 'due', 'the last day is still a warning, not a lapse');
  assert.equal(at(-1).level, 'lapsed');
  assert.equal(at(-400).level, 'lapsed');

  // The labels say what a person needs at a glance, and the units change so nobody
  // has to read "731 days left" and do arithmetic.
  assert.equal(at(1).label, 'ends tomorrow');
  assert.equal(at(9).label, '9 days left');
  assert.equal(at(400).label, '13 months left');
  assert.equal(at(0).label, 'ends today');
  assert.equal(at(-1).label, 'lapsed');

  // Every level the function can return has wording and a note, so a screen cannot
  // render an empty chip.
  const levels = new Set([at(400).level, at(60).level, at(30).level, at(-1).level]);
  assert.deepEqual([...levels].sort(), LAPSE_LEVELS.map((l) => l.key).sort());
  for (const l of LAPSE_LEVELS) assert.ok(l.note && l.label, `${l.key} has wording`);

  // Null rather than a guess for anything that is not a live check.
  for (const row of [null, { status: 'pending' }, { status: 'rejected' }, { status: 'verified' }, { status: 'none' }]) {
    assert.equal(lapseOf(row, now), null, `${JSON.stringify(row)} has no lapse to report`);
  }
  assert.equal(LAPSE_WINDOW_DAYS, 60);
});

test('who may ask, and what they are told when they may not', () => {
  const caps = { verified_badge: true };
  // The plan gate is first, and its code is the domain code — the ROUTE renames it
  // for the flash map, where the upgrade flow already owns `plan`.
  assert.equal(requestability({ capabilities: {}, state: 'none' }).code, 'plan');

  assert.equal(requestability({ capabilities: caps, state: 'none' }).ok, true, 'a free-plan store on a paid tier may ask');
  assert.equal(requestability({ capabilities: caps, state: 'rejected' }).ok, true, 'a refusal is not an ending');
  assert.equal(requestability({ capabilities: caps, state: 'verified' }).code, 'already-checked');
  assert.equal(requestability({ capabilities: caps, state: 'verified', lapsing: true }).ok, true,
    'and a check that is running out can be renewed before it does');
  assert.equal(requestability({ capabilities: caps, state: 'verified', lapsing: true }).detail.includes('keeps counting'), true,
    'the sentence says the current check is not replaced until somebody looks');

  // Pending wins over everything, because it is the one thing that would create a
  // second request in the queue.
  assert.equal(requestability({ capabilities: caps, state: 'none', pending: true }).code, 'already-asked');
  assert.equal(requestability({ capabilities: caps, state: 'verified', pending: true, lapsing: true }).code, 'already-asked');
});

test('the notice names the date, the consequence, and what does NOT happen', () => {
  const msg = lapseNotice({ channelName: 'Alice\'s Studio', expiresAt: '2026-11-01T06:15:00Z', days: 40 });
  assert.match(msg.subject, /1 Nov 2026/, 'the subject carries the date — it is the whole message');
  assert.match(msg.text, /Alice's Studio/);
  assert.match(msg.text, /in 40 days/);
  // The three things a person needs, in order. The third is the one that stops the
  // recipient replying "am I losing my store".
  assert.match(msg.text, /badge comes off/, 'what happens on the date');
  assert.match(msg.text, /store stays open[^]*files stay published/, 'and that nothing else does');
  assert.match(msg.text, /ask for a check from your store settings/, 'with the way back, named');
  // It must not demand anything. (The first version of this assertion banned the
  // words "send us" and failed on the REASSURANCE — "You do not need to send us
  // anything now" — which is the sentence doing the most work in the whole message.
  // Assert the shape of a demand, not a word that appears in its absence.)
  assert.ok(!/you must|you need to (?!send nothing)|required|urgent|immediately|final notice/i.test(msg.text),
    'nothing in it is a demand');
  assert.match(msg.text, /do not need to send us anything/, 'and it says so out loud');
  const past = lapseNotice({ channelName: 'X', expiresAt: '2026-09-01T06:00:00Z', days: -1 });
  assert.match(past.text, /lapsed|stops counting/, 'a notice written late still reads correctly');
});

test('a check made last year expires from the day it was made', async () => {
  // `seenAt` is the ordinary case, not an exotic one: an operator looks at a
  // document in person and types the outcome up later. Deriving the window from
  // "now" would hand the seller a fresh two years for a check that has already
  // been running — a quiet extension nobody decided.
  const channel = await fixture();
  const op = await store.userByEmailOrCreate(`backdated-${Date.now()}@test.local`);
  const seen = new Date();
  seen.setMonth(seen.getMonth() - 23);
  const row = await store.recordVerification({
    channelId: channel.id, outcome: 'verified', method: 'citizenship',
    actorId: op.id, months: 24, seenAt: seen,
  });
  const lapse = lapseOf(row);
  assert.ok(lapse, 'it is a live check');
  assert.ok(lapse.days > 0 && lapse.days <= 31, `about a month left, not twenty-four (got ${lapse.days})`);
  assert.ok(['due', 'soon'].includes(lapse.level),
    `and it is inside the notice window the day it is recorded (got ${lapse.level})`);
  assert.ok(badgeFor(row).sentence.includes(String(seen.getUTCFullYear())),
    'the sentence names the day it was seen, not today');

  // No seenAt still means "seen now", which is the case the buttons produce.
  const now = await store.recordVerification({
    channelId: channel.id, outcome: 'verified', method: 'pan', actorId: op.id, months: 24,
  });
  assert.ok(lapseOf(now).days >= 729, 'a check recorded as made today gets its full window');

  await query('delete from seller_verifications where channel_id = $1', [channel.id]);
  await query('delete from channels where id = $1', [channel.id]);
});

test('asking again while a check is still live does not take the badge down', async () => {
  // The reason the two reads exist, in one scenario. Research on re-verification is
  // explicit that a platform should keep the mark while it prompts for renewal —
  // and asking early would otherwise punish the seller for doing exactly what the
  // notice asked them to. `verificationFor` reads DECIDED rows only, so the badge
  // stands on the old check until a person records the new one.
  const channel = await fixture();
  const op = await store.userByEmailOrCreate(`recheck-${Date.now()}@test.local`);
  const first = await store.recordVerification({
    channelId: channel.id, outcome: 'verified', method: 'pan', actorId: op.id, months: 12,
  });
  assert.ok(badgeFor(await store.verificationFor(channel.id)), 'checked to begin with');

  await store.askForVerification({ channelId: channel.id, note: null });
  const standing = await store.verificationFor(channel.id);
  assert.equal(standing.id, first.id, 'the badge still stands on the check that was made');
  assert.ok(badgeFor(standing), 'and it is still a badge');
  assert.equal(stateOf(await store.pendingVerificationFor(channel.id)), 'pending', 'while the request is on file');

  // A person decides, and the outcome replaces both: the request is answered, the
  // new row is what the badge rests on, and the history keeps the first one.
  const second = await store.recordVerification({
    channelId: channel.id, outcome: 'verified', method: 'pan', actorId: op.id, months: 12,
  });
  assert.equal(await store.pendingVerificationFor(channel.id), null, 'answered requests are not still open');
  assert.equal((await store.verificationFor(channel.id)).id, second.id);
  const history = await store.verificationsFor(channel.id);
  assert.equal(history.length, 2, 'and the earlier check stays on the record');
  assert.equal(history.filter((h) => h.status === 'pending').length, 0, 'with no open request left behind');

  await query('delete from seller_verifications where channel_id = $1', [channel.id]);
  await query('delete from channels where id = $1', [channel.id]);
});

test('the lapsing list is derived from the date, and remembers who was told', async () => {
  // Nothing sweeps at midnight: this list is a query. `expires_at` in the past is
  // still returned (an operator should be able to find the store whose badge went
  // dark), which is why the caller's window is a parameter and not a filter
  // somebody adds later.
  const channel = await fixture();
  const op = await store.userByEmailOrCreate(`notice-${Date.now()}@test.local`);
  await store.recordVerification({
    channelId: channel.id, outcome: 'verified', method: 'citizenship', actorId: op.id, months: 36,
  });
  const far = await store.verificationsLapsing({ days: 60 });
  assert.equal(far.filter((v) => v.channel_id === channel.id).length, 0, 'three years out is not close');

  // Move the date instead of waiting for it: the row is the only state there is.
  const inFortyDays = new Date(Date.now() + 40 * 86400000);
  await query('update seller_verifications set expires_at = $2 where channel_id = $1', [channel.id, inFortyDays]);
  const soon = await store.verificationsLapsing({ days: 60 });
  const mine = soon.find((v) => v.channel_id === channel.id);
  assert.ok(mine, 'forty days out is inside the window');
  assert.equal(mine.notice_sent_at, null, 'nobody has been told yet');
  assert.equal(lapseOf(mine).level, 'soon');

  // A notice is claimed once, by a person, and the claim is on the outcome.
  const claimed = await store.markVerificationNotice({ verificationId: mine.id, actorId: op.id });
  assert.ok(claimed.notice_sent_at, 'the row records that they were told');
  assert.equal(claimed.notice_by, op.id);
  assert.equal(await store.markVerificationNotice({ verificationId: mine.id, actorId: op.id }), null,
    'a second claim gets nothing, so nobody is mailed twice');

  // Releasing is possible, because a claim with no message behind it must not
  // survive: the next person to work the list would skip somebody nobody contacted.
  await store.releaseVerificationNotice(mine.id);
  assert.equal((await store.verificationsLapsing({ days: 60 })).find((v) => v.channel_id === channel.id).notice_sent_at, null);

  // Past its date, the row is still in the list when the caller asks for it — and
  // out of it when they do not.
  await query('update seller_verifications set expires_at = $2 where channel_id = $1',
    [channel.id, new Date(Date.now() - 86400000)]);
  assert.ok((await store.verificationsLapsing({ days: 60 })).some((v) => v.channel_id === channel.id),
    'a lapsed check is still worth seeing');
  assert.equal((await store.verificationsLapsing({ days: 60, includeLapsed: false })).filter((v) => v.channel_id === channel.id).length, 0,
    'and can be left out');
  assert.equal(lapseOf((await store.verificationFor(channel.id))).level, 'lapsed');
  assert.equal(badgeFor(await store.verificationFor(channel.id)), null, 'a lapsed check carries no badge');

  await query('delete from seller_verifications where channel_id = $1', [channel.id]);
  await query('delete from channels where id = $1', [channel.id]);
});

test('no message key is declared twice in the flash maps', () => {
  // JavaScript allows a duplicate key in an object literal and keeps the LAST one,
  // so the earlier message does not merge or conflict — it disappears. That is what
  // happened here: the verification refusal was declared under `plan`, the upgrade
  // flow declared `plan` again further down, and a seller on the free plan asking
  // for a check was told "That plan is not available from your current one." on a
  // form with no plans on it. Nothing in the file looked wrong; the message was
  // simply unreachable, and only a static check can see that.
  const src = readFileSync(path.join(here, '..', 'server.js'), 'utf8');
  for (const name of ['SUCCESS_FLASH', 'ERROR_FLASH']) {
    const start = src.indexOf(`const ${name} = {`);
    assert.ok(start > 0, `${name} is where this test thinks it is`);
    const body = src.slice(start, src.indexOf('\n};', start));
    const keys = [...body.matchAll(/^\s{2}'?([a-zA-Z0-9-]+)'?:/gm)].map((m) => m[1]);
    const seen = new Set();
    const dupes = keys.filter((k) => (seen.has(k) ? true : (seen.add(k), false)));
    assert.deepEqual(dupes, [], `${name} declares these keys twice: ${dupes.join(', ')}`);
  }
});

test('the newest row carries the name of whoever decided it', async () => {
  // The operator page reads ONE row (`verificationFor`) and the history reads
  // many (`verificationsFor`), and they were different shapes: the single-row
  // query selected `*` with no join, so the operator's own decision rendered as
  // "a person no longer on the console". Assert the shape both readers share.
  const channel = await fixture();
  const op = await store.userByEmailOrCreate('decider-${Date.now()}@test.local'.replace('${Date.now()}', String(Date.now())));
  await query('update profiles set display_name = $2 where id = $1', [op.id, 'Sita (operator)']);
  await store.recordVerification({ channelId: channel.id, outcome: 'verified', method: 'pan', actorId: op.id, months: 12 });
  const row = await store.verificationFor(channel.id);
  assert.equal(row.decided_by_name, 'Sita (operator)', 'the single-row read names the decider');
  assert.equal(row.decided_by, op.id);
  const many = await store.verificationsFor(channel.id);
  assert.equal(many[0].decided_by_name, row.decided_by_name, 'and the history agrees with it');
  await query('delete from seller_verifications where channel_id = $1', [channel.id]);
  await query('delete from channels where id = $1', [channel.id]);
});

test('a rejected row carries no expiry and no check date', async () => {
  const channel = await fixture();
  const r = await store.recordVerification({ channelId: channel.id, outcome: 'rejected', method: 'pan', actorId: null, note: 'Glare on every photo of it.' });
  assert.equal(r.status, 'rejected');
  assert.equal(r.verified_at, null, 'refusing is not verifying');
  assert.equal(r.expires_at, null, 'and a refusal does not lapse — it stands until it is answered with a new document');
  await query('delete from seller_verifications where channel_id = $1', [channel.id]);
  await query('delete from channels where id = $1', [channel.id]);
});

test('a check inside the notice window can be renewed, and the panel says both facts at once', async () => {
  // The whole point of the round: the promise "we will tell you before it does" has
  // to be visible in the two places a person acts from. The seller's panel must
  // offer the renewal BEFORE the date (research: prompt early, keep the mark while
  // prompting) and must go on saying the current check counts, or the seller has to
  // guess whether asking early costs them the badge.
  const { storeSettings } = await import('../src/views.js');
  const { PLANS } = await import('../src/store.js');

  const inWindow = new Date();
  inWindow.setDate(inWindow.getDate() + 30);
  const channel = { slug: 'nima-crafts', name: 'Nima Crafts', owner_id: 'x', ads_enabled: true,
    listing_mode: 'marketplace', sells_digital: true, sells_physical: false, moderation_state: 'approved' };
  const verification = { id: 1, status: 'verified', method: 'citizenship', verified_at: new Date(),
    expires_at: inWindow, decided_by_name: 'Operator', notes: null, notice_sent_at: null };
  const stock = { channel, user: null, plan: PLANS.store || PLANS.pro, canList: true, subscription: null,
    stats: {}, capabilities: { verified_badge: true } };

  const askable = storeSettings({ ...stock, verification });
  assert.match(askable, /citizenship certificate/i, 'the document type is named');
  assert.match(askable, /Days left: 30|30 days left/, 'the seller is told how long is left, not just a date');
  assert.match(askable, /Ask for the next check/, 'and the way to renew is right there');
  assert.match(askable, /keeps counting to its own date/, 'asking early is explained, not left to guesswork');
  assert.ok(!/Already checked/.test(askable), 'no refusal on a check that is inside its own window');

  const early = storeSettings({ ...stock, verification, pendingRequest: { id: 2, created_at: new Date(), request_note: null } });
  assert.match(early, /it is with\s+us/, 'a seller waiting on the next check is told so, not left wondering');
  assert.match(early, /Withdraw the request/, 'and can take it back');
  assert.match(early, /badge stays up/, 'while being told the current check still counts');
  assert.match(early, /Your request is with us/, 'asking twice is refused with the reason, not silently');

  // Far from the date: the same panel refuses to open a window nobody can work yet,
  // and says WHEN it will — a refusal without a date is a dead end.
  const far = new Date();
  far.setMonth(far.getMonth() + 18);
  const closed = storeSettings({ ...stock, verification: { ...verification, expires_at: far } });
  assert.match(closed, /Already checked/, 'outside the window the panel says there is nothing to ask for yet');
  assert.match(closed, /asking opens again on \d/, 'and names the day it opens, not a countdown');
});

test('the console sends the notice once, and the button is gone afterwards', async () => {
  const { adminStoreDetail } = await import('../src/views.js');
  const inWindow = new Date();
  inWindow.setDate(inWindow.getDate() + 30);
  const c = { id: 1, slug: 'nima-crafts', name: 'Nima Crafts', owner_id: 'x', owner_email: 'n@test.local',
    moderation_state: 'approved', listing_mode: 'marketplace', plan_code: 'store' };
  const verification = { id: 1, status: 'verified', method: 'citizenship', verified_at: new Date(),
    expires_at: inWindow, decided_by_name: 'Operator', notes: null, notice_sent_at: null, notice_by_name: null };
  const data = { channel: c, files: [], reports: [], history: [], invoice: null };
  const base = { user: { role: 'admin', email: 'op@test.local' }, consent: null, data };

  const before = adminStoreDetail({ ...base, verification });
  assert.match(before, /The check is ending/, 'the console says what this row is');
  assert.match(before, /Days left: 30|30 days left/);
  assert.match(before, /Nobody has told them yet/, 'and whether the promise has been kept');
  assert.match(before, /The notice below gives them the date/, 'the copy is written for the state it is in');
  assert.match(before, /action="\/admin\/stores\/nima-crafts\/verification\/notice"/, 'the send action is on the page');
  assert.match(before, /n@test\.local/, 'it names the address the message goes to');

  const after = adminStoreDetail({ ...base,
    verification: { ...verification, notice_sent_at: new Date(), notice_by_name: 'Operator' } });
  assert.ok(!/verification\/notice/.test(after), 'once sent, the button is gone — nobody is written to twice');
  assert.match(after, /Operator/, 'and the record says who sent it, by name');
  assert.ok(!/Send the notice below|Nobody has told them yet/.test(after),
    'and the panel does not go on asking for a message that has been sent');

  // Lapsed: the notice is pointless and the panel says what actually happened.
  const past = new Date();
  past.setDate(past.getDate() - 12);
  const lapsed = adminStoreDetail({ ...base, verification: { ...verification, expires_at: past } });
  assert.match(lapsed, /The check has ended/, 'a lapsed check is its own sentence');
  assert.match(lapsed, /badge is off the store page/, 'and the console states the consequence plainly');
  assert.ok(!/verification\/notice/.test(lapsed), 'no reminder to send about a date that has passed');
  assert.match(lapsed, /same process as the first time/, 'with the way back, not a dead end');
});

test('no route can build a flash into a fragment', async () => {
  // `#verification?error=x` is a fragment called "verification?error=x": the browser
  // never sends it, the server never parses it, and the person is bounced back to a
  // form with no explanation. Every anchored `back()` must take its query as an
  // argument, so the shape is enforced rather than remembered.
  const src = readFileSync(new URL('../server.js', import.meta.url), 'utf8');
  // Checked per route, because a route with no fragment on it is allowed to keep
  // the plain shape — and a rule that is broader than the hazard would be turned
  // off by the first person it inconvenienced.
  const routes = src.split(/\nAPP\.(?:get|post)\(/).slice(1);
  let anchored = 0;
  for (const route of routes) {
    // Read the rest of the line rather than regex-matching a backtick template:
    // the definition has a template INSIDE it (`?${qs}`), so any pattern that stops
    // at the first backtick stops one nesting level too early and finds nothing —
    // which is a check that quietly passes because it never matches anything.
    const line = route.split('\n').find((l) => l.includes('const back = '));
    if (!line || !line.includes('#')) continue;
    anchored += 1;
    assert.match(line, /qs/, 'an anchored back() takes the query as an argument');
    assert.ok(line.indexOf('#') > line.indexOf('qs'), 'the query is built before the fragment');
    assert.ok(!/\$\{back\(\)\}\?/.test(route),
      'no route appends a query to an anchored back() after the fact');
  }
  assert.ok(anchored >= 4, `the anchored routes are the ones being checked (found ${anchored})`);
});
