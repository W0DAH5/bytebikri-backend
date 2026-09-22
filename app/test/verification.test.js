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

  // Only the newest row is what the seller and the storefront read.
  const latest = await store.verificationFor(channel.id);
  assert.equal(stateOf(latest), 'pending');

  await store.withdrawVerificationRequest(channel.id);
  assert.equal(await store.verificationFor(channel.id), null, 'withdrawn means gone, not hidden');

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
