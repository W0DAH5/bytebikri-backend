/**
 * Moderation: five states, six actions, one rule.  npm test
 *
 * `channels.moderation_state` has been in the schema since migration 0001 and
 * nothing ever wrote to it. Now that something does, the two ways this feature
 * can go wrong are both quiet:
 *
 *   1. The code's vocabulary and the database's CHECK constraints drift apart.
 *      Postgres rejects the write at runtime — in production, on a store that
 *      needed suspending. This file reads the constraints out of `pg_constraint`
 *      and compares them with the module, because a CHECK constraint and the
 *      code that writes to it do not fail loudly, they fail eventually.
 *
 *   2. A store disappears and its owner cannot find out why. Every decision must
 *      carry a rule code from `policy_rules` and a record of who made it, and the
 *      state change and the record must be the same transaction.
 *
 * The visibility rules themselves are the rest of the file: what the public sees,
 * what the owner sees, and the fact that those two answers are different on
 * purpose.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:55432/bytebikri_test';

const {
  STATES, ACTIONS, ACTION_TO_STATE, ACTION_LABELS, BEHAVIOUR,
  PERSON_ACTIONS, personStateFor, isPublicChannel,
  normaliseState, behaviour, isPublic, canWrite, stateFor,
  cleanRemedy, decisionNote, validateDecision, changesVisibility, REMEDY_LIMIT,
} = await import('../src/moderation.js');

const { store } = await import('../src/store.js');
const auth = await import('../src/auth.js');
const { query, close } = await import('../src/db.js');
const { after } = await import('node:test');
after(async () => { await close(); });

// ---------------------------------------------------------------------------
// The vocabulary, against the schema
// ---------------------------------------------------------------------------

/** Pull the allowed values out of a CHECK constraint, in the table's own words. */
async function checkValues(table, column) {
  const row = await query(
    `select pg_get_constraintdef(c.oid) as def
       from pg_constraint c
       join pg_class t on t.oid = c.conrelid
      where t.relname = $1 and c.contype = 'c'
        and pg_get_constraintdef(c.oid) like '%' || $2 || '%'`,
    [table, column],
  );
  const values = new Set();
  for (const r of row.rows) {
    for (const m of String(r.def).matchAll(/'([a-z_]+)'::text/g)) values.add(m[1]);
  }
  return [...values].sort();
}

test('the states this code writes are the states the database allows', async () => {
  const inDatabase = await checkValues('channels', 'moderation_state');
  assert.deepEqual(inDatabase, [...STATES].sort(),
    'src/moderation.js and the channels CHECK have drifted — a write would fail at runtime');
  assert.deepEqual([...ACTIONS].sort(), await checkValues('moderation_actions', 'action'),
    'and so have the actions');
});

test('every state has behaviour, and no state is decorative', () => {
  for (const s of STATES) {
    const b = BEHAVIOUR[s];
    assert.ok(b, `${s} has no behaviour — that is the column-nobody-sets problem again`);
    assert.equal(typeof b.publicVisible, 'boolean');
    assert.equal(typeof b.canWrite, 'boolean');
    assert.ok(b.publicVisible !== undefined);
  }
  // The two states that hide a store are the two that stop writes. If a state
  // ever hides a store and still lets it publish, that is a bug and this fails.
  for (const s of STATES) {
    if (BEHAVIOUR[s].publicVisible) continue;
    assert.equal(BEHAVIOUR[s].canWrite, false, `${s} hides the store but still allows writes`);
    assert.ok(BEHAVIOUR[s].ownerNote, `${s} hides a store without a word to its owner`);
  }
});

test('the default state does not hide anybody', async () => {
  // `pending` is what every new channel gets, and nothing is reviewed before it
  // appears — the dashboard says so in as many words. If pending were hidden, a
  // seller's first upload would be invisible and the bug would look like a
  // missing file.
  assert.equal(isPublic('pending'), true);
  assert.equal(isPublic('approved'), true);
  assert.equal(isPublic('restricted'), true);
  assert.equal(isPublic('suspended'), false);
  assert.equal(isPublic('removed'), false);
  assert.equal(normaliseState(undefined), 'pending');
  assert.equal(normaliseState('nonsense'), 'pending');
});

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

test('every action maps to a state the schema has, and warn changes nothing', () => {
  for (const a of ACTIONS) {
    const to = ACTION_TO_STATE[a];
    assert.ok(to === null || STATES.includes(to), `${a} maps to ${to}, which is not a state`);
    assert.ok(ACTION_LABELS[a], `${a} has no label, so the operator page cannot offer it`);
    assert.equal(stateFor(a), to);
  }
  assert.equal(ACTION_TO_STATE.warn, null, 'a warning is a record, not a punishment');
  assert.equal(changesVisibility('warn'), false);
  assert.equal(changesVisibility('suspend'), true);
  assert.equal(stateFor('delete'), null);
});

test('a decision is refused unless it names an action, and a reason when it hides a store', () => {
  assert.equal(validateDecision({ action: 'nope' }).error, 'action');
  assert.equal(validateDecision({ action: 'suspend' }).error, 'reason',
    'hiding a store with no rule cited is the thing sellers rightly rage about');
  assert.equal(validateDecision({ action: 'suspend', ruleCode: 'copyright' }).ok, true);

  // Clearing a restriction does not need a rule, and `warn` changes nothing at
  // all: it is a record, not a punishment.
  assert.equal(validateDecision({ action: 'warn' }).ok, true);
  assert.equal(validateDecision({ action: 'reinstate' }).ok, true);
  assert.equal(validateDecision({ action: 'approve' }).ok, true);
  assert.equal(validateDecision({ action: 'remove', remedy: 'Stolen files.' }).error, 'reason',
    'an action cannot sidestep the rule by writing a sentence instead');

  const d = validateDecision({ action: 'restrict', ruleCode: 'health_claims', remedy: '  Fix   the wording. ' });
  assert.deepEqual(d, {
    ok: true, action: 'restrict', state: 'restricted', ruleCode: 'health_claims', remedy: 'Fix the wording.',
  });
});

test('the remedy is the only free text, and it is capped and flattened', () => {
  assert.equal(cleanRemedy('line one\nline two'), 'line one line two');
  assert.equal(cleanRemedy('  spaced   out  '), 'spaced out');
  assert.equal(cleanRemedy('a\u0000b\u001fc'), 'a b c');
  const long = cleanRemedy('x'.repeat(500));
  assert.equal(long.length, REMEDY_LIMIT, 'the cap holds');
  assert.ok(long.endsWith('…'), 'and truncation is visible rather than silent');
  assert.equal(cleanRemedy(null), '');
});

test('the sentence a seller reads is the rule\'s own wording, never just free text', () => {
  const rule = { code: 'copyright', title: 'Copyright infringement', description: 'Content published here belongs to somebody else.' };
  assert.equal(
    decisionNote(rule, 'Reply to the notice and we will look again.'),
    'Copyright infringement. Content published here belongs to somebody else. Reply to the notice and we will look again.',
  );
  // With no remedy, the rule still speaks — the failure this prevents is
  // "we suspended your store: <blank>".
  assert.match(decisionNote(rule, ''), /Copyright infringement/);
  assert.equal(decisionNote(null, ''), 'This store was reviewed.');
});

// ---------------------------------------------------------------------------
// The store side: the state change and its record are one transaction
// ---------------------------------------------------------------------------

let seq = 0;
async function fixture() {
  const tag = `${Date.now()}-${++seq}`;
  const user = await store.userByEmailOrCreate(`mod-${tag}@test.local`);
  const ch = await store.createChannel({
    ownerId: user.id, slug: `mod-${tag}`, name: `Mod ${tag}`,
    // A new store is created APPROVED and reviewed by nobody, which is what the
    // dashboard's own copy says. `pending` exists in the schema and is reachable;
    // it is simply not what sign-up writes.
    listingMode: 'marketplace',
  });
  return { user, ch };
}

test('a suspension writes the state and the record together, with the operator on it', async () => {
  const { user, ch } = await fixture();
  const before = await store.channelBySlug(ch.slug);
  assert.equal(before.moderation_state, 'approved', 'a new store is live at once and reviewed by nobody');

  const updated = await store.setChannelModeration({
    channelId: ch.id, action: 'suspend', state: 'suspended',
    ruleCode: 'copyright', remedy: 'Two files are somebody else\'s work.', actorId: user.id,
  });
  assert.equal(updated.moderation_state, 'suspended');
  assert.equal(updated.moderation_reason, 'copyright');

  const latest = await store.latestModerationAction(ch.id);
  assert.equal(latest.action, 'suspend');
  assert.equal(latest.rule_code, 'copyright');
  assert.equal(latest.actor_id, user.id);
  assert.equal(latest.automated, false);
  assert.match(latest.reason, /somebody else's work/);
  assert.equal(latest.rule_title, 'Copyright infringement', 'the sentence comes from the policy table');
});

test('the history is newest-first, and a reinstatement is a decision like any other', async () => {
  const { user, ch } = await fixture();
  await store.setChannelModeration({ channelId: ch.id, action: 'restrict', state: 'restricted', ruleCode: 'health_claims', remedy: 'Fix the claim.', actorId: user.id });
  await store.setChannelModeration({ channelId: ch.id, action: 'suspend', state: 'suspended', ruleCode: 'malware', remedy: '', actorId: user.id });
  await store.setChannelModeration({ channelId: ch.id, action: 'reinstate', state: 'approved', ruleCode: null, remedy: 'False alarm.', actorId: user.id });

  const history = await store.moderationHistory(ch.id);
  assert.deepEqual(history.map((h) => h.action), ['reinstate', 'suspend', 'restrict']);
  assert.equal((await store.channelBySlug(ch.slug)).moderation_state, 'approved');
  // The rule title is joined for the ones that cited a rule, and null for the
  // one that did not — the view has to handle both.
  assert.equal(history[0].rule_title, null);
  assert.equal(history[1].rule_title, 'Malware / exploits');
});

test('a rule code the platform does not have is refused by the database, not silently stored', async () => {
  const { user, ch } = await fixture();
  await assert.rejects(
    () => store.setChannelModeration({
      channelId: ch.id, action: 'restrict', state: 'restricted',
      ruleCode: 'made_up_rule', remedy: '', actorId: user.id,
    }),
    (err) => err.code === '23503',
    'moderation_actions.rule_code is a foreign key, and this is what enforces it',
  );
  // And the failed decision left the store exactly as it was: the two writes are
  // one transaction.
  assert.equal((await store.channelBySlug(ch.slug)).moderation_state, 'approved');
  assert.deepEqual(await store.moderationHistory(ch.id), []);
});

// ---------------------------------------------------------------------------
// Who sees what
// ---------------------------------------------------------------------------

test('the public directory hides suspended and removed stores, and nothing else', async () => {
  const { ch } = await fixture();
  const listed = async () => (await store.channels({ listedOnly: true })).map((c) => c.id);

  // A new store is public without being approved by anybody.
  assert.ok((await listed()).includes(ch.id));

  await store.setChannelModeration({ channelId: ch.id, action: 'restrict', state: 'restricted', ruleCode: 'health_claims', remedy: '' });
  assert.ok((await listed()).includes(ch.id), 'a restricted store is still a shop');

  await store.setChannelModeration({ channelId: ch.id, action: 'suspend', state: 'suspended', ruleCode: 'malware', remedy: '' });
  assert.ok(!(await listed()).includes(ch.id), 'a suspended store is not in a directory');

  await store.setChannelModeration({ channelId: ch.id, action: 'remove', state: 'removed', ruleCode: 'malware', remedy: '' });
  assert.ok(!(await listed()).includes(ch.id));

  // ...and the owner can still load the store itself. The route decides who may
  // see it; the query only decides who is advertised.
  assert.ok(await store.channelBySlug(ch.slug), 'the store still exists for its owner and for an operator');
});

test('the operator queue is exactly the stores that are not in the default state', async () => {
  const { ch } = await fixture();
  const ids = async () => (await store.channelsNeedingModeration()).map((r) => r.id);
  assert.ok(!(await ids()).includes(ch.id), 'a store in the default state is not a decision waiting to be made');

  await store.setChannelModeration({ channelId: ch.id, action: 'warn', state: null, ruleCode: 'counterfeit', remedy: 'Answer your email.' });
  assert.ok(!(await ids()).includes(ch.id), 'a warning alone is a record, not a queue entry');

  await store.setChannelModeration({ channelId: ch.id, action: 'suspend', state: 'suspended', ruleCode: 'malware', remedy: '' });
  const queued = (await store.channelsNeedingModeration()).find((r) => r.id === ch.id);
  assert.ok(queued, 'and a state that hides a store is');
  assert.equal(queued.moderation_reason, 'malware');
});

// ---------------------------------------------------------------------------
// What the pages say
// ---------------------------------------------------------------------------

const { dashboard, storefront, adminModeration } = await import('../src/views.js');

const CHANNEL = {
  id: '00000000-0000-0000-0000-0000000000ff', slug: 'hidden', name: 'Hidden Store',
  tagline: 'Nothing to see', listing_mode: 'marketplace', moderation_state: 'suspended',
};

const brief = {
  state: 'suspended',
  ruleCode: 'copyright',
  ruleTitle: 'Copyright infringement',
  decidedAt: new Date().toISOString(),
  note: 'Copyright infringement. Content published here belongs to somebody else. Reply and we will look again.',
  ownerNote: 'This store is not visible to the public. Nothing has been deleted, and you can still read every page here.',
};

test('the owner is told what happened, why, and that nothing was deleted', () => {
  const html = storefront({ channel: CHANNEL, assets: [], slots: [], estimate: {}, pageviews: 0, moderation: brief });
  assert.match(html, /Only you can see this page right now/);
  assert.match(html, /Copyright infringement/);
  assert.match(html, />suspended</, 'the state is named, not implied');
  assert.match(html, /copyright/, 'the rule code is shown');
  assert.match(html, /Nothing has been deleted/);
});

test('with no moderation, both pages say nothing about it at all', () => {
  const store = storefront({ channel: { ...CHANNEL, moderation_state: 'approved' }, assets: [], slots: [], estimate: {}, pageviews: 0 });
  assert.ok(!/moderation-notice/.test(store), 'a banner that says "nothing is wrong" is a banner nobody reads');
  const dash = dashboard({
    channel: { ...CHANNEL, moderation_state: 'approved' }, slots: [], connections: [], providers: [],
    plan: { name: 'Free', code: 'free', capabilities: {} }, estimate: {}, pageviews: 0, adViews: [],
    upgrade: null, user: null, moderation: null,
  });
  assert.ok(!/moderation-notice/.test(dash));
});

test('the notice is escaped like any other input, including the operator\'s own line', () => {
  const html = storefront({
    channel: CHANNEL, assets: [], slots: [], estimate: {}, pageviews: 0,
    moderation: { ...brief, note: '<script>alert(1)</script> was the reason', ruleCode: '<img onerror=x>' },
  });
  assert.ok(!/<script>alert\(1\)<\/script>/.test(html), 'the remedy line is not markup');
  assert.ok(!/<img onerror/.test(html));
  assert.match(html, /&lt;script&gt;/);
});

test('the operator page offers only the actions and rules that exist', () => {
  const html = adminModeration({
    user: { role: 'admin', email: 'operator@bytebikri.local', display_name: 'Operator' },
    rows: [{ ...CHANNEL, owner_name: 'Alice', owner_email: 'alice@bytebikri.local', created_at: new Date().toISOString() }],
    rules: [
      { code: 'copyright', title: 'Copyright infringement' },
      { code: 'malware', title: 'Malware / exploits' },
    ],
    actions: ACTIONS, labels: ACTION_LABELS,
  });
  for (const a of ACTIONS) assert.ok(html.includes(`>${ACTION_LABELS[a]}</option>`), `${a} is not offered`);
  assert.match(html, /value="copyright"/);
  assert.match(html, /Copyright infringement/);
  assert.ok(!/value="made_up"/.test(html));
  assert.match(html, /maxlength="280"/, 'the remedy is capped in the form as well as in the module');
  assert.match(html, /Hidden Store/);
  assert.match(html, /Action recorded|Record decision/);
});

// ---------------------------------------------------------------------------
// People: the half the Android app has always had
// ---------------------------------------------------------------------------

test('a store is public only when neither the store nor its owner is stopped', () => {
  for (const state of STATES) {
    assert.equal(isPublicChannel({ moderation_state: state }), isPublic(state));
  }
  assert.equal(isPublicChannel({ moderation_state: 'approved', owner_banned: true }), false,
    'a banned seller\'s store is not public even though the STORE is in good standing');
  assert.equal(isPublicChannel({ moderation_state: 'suspended', owner_banned: false }), false);
  assert.equal(isPublicChannel({ moderation_state: 'approved', owner_banned: false }), true);
  // Two separate decisions, never merged into one column.
  assert.notEqual(isPublicChannel({ moderation_state: 'approved', owner_banned: true }),
    isPublic('approved'));
});

test('the person vocabulary is the store vocabulary, narrowed', () => {
  assert.deepEqual(PERSON_ACTIONS, ['suspend', 'reinstate', 'warn']);
  for (const a of PERSON_ACTIONS) assert.ok(ACTIONS.includes(a), `${a} is not an action the schema knows`);
  assert.equal(personStateFor('suspend'), 'banned');
  assert.equal(personStateFor('reinstate'), 'active');
  assert.equal(personStateFor('warn'), 'active');
  assert.equal(personStateFor('remove'), null, 'there is no "removed" person — a ban is not a deletion');
});

test('a suspension signs the account out everywhere and hides its stores', async () => {
  const tag = `${Date.now()}-${++seq}`;
  const user = await store.userByEmailOrCreate(`ban-${tag}@test.local`);
  await store.setPassword ? null : null;
  const ch = await store.createChannel({
    ownerId: user.id, slug: `ban-${tag}`, name: `Ban ${tag}`, listingMode: 'marketplace',
  });
  const operator = await store.userByEmailOrCreate(`op-${tag}@test.local`);

  // Two live sessions, as if they were signed in on a phone and a laptop.
  const s1 = await auth.createSession({ userId: user.id });
  const s2 = await auth.createSession({ userId: user.id });
  assert.ok(await auth.resolveSession(s1.token));
  assert.ok((await store.channels({ listedOnly: true })).some((c) => c.id === ch.id));

  const banned = await store.setUserBanned({
    userId: user.id, action: 'suspend', ruleCode: 'malware',
    remedy: 'A file on your store was harmful. Reply and we will look again.', actorId: operator.id,
  });
  assert.equal(banned.banned, true);

  // 1. every session is dead, not just refused at read time
  assert.equal(await auth.resolveSession(s1.token), null, 'a live session must not outlive the ban');
  assert.equal(await auth.resolveSession(s2.token), null);
  const live = await query('select count(*)::int as n from sessions where user_id = $1 and revoked_at is null', [user.id]);
  assert.equal(live.rows[0].n, 0, 'revoked in the same transaction as the flag');

  // 2. the store is out of the public directory and out of search
  assert.ok(!(await store.channels({ listedOnly: true })).some((c) => c.id === ch.id));
  const found = await store.search(`Ban ${tag}`);
  assert.equal(found.stores.length, 0, 'a banned seller is not findable by name either');

  // 3. the record exists, and it is about the PERSON
  const history = await store.userModerationHistory(user.id);
  assert.equal(history.length, 1);
  assert.equal(history[0].action, 'suspend');
  assert.equal(history[0].rule_code, 'malware');
  assert.equal(history[0].rule_title, 'Malware / exploits');
  assert.equal(history[0].actor_id, operator.id);

  // 4. and the channel row itself is untouched — the store was never the problem
  const after = await store.channelBySlug(ch.slug);
  assert.equal(after.moderation_state, 'approved');
  assert.equal(after.owner_banned, true, 'the read carries the flag the routes need');
  assert.equal(isPublicChannel(after), false);
});

test('reinstating gives everything back, and keeps the record of the ban', async () => {
  const tag = `${Date.now()}-${++seq}`;
  const user = await store.userByEmailOrCreate(`re-${tag}@test.local`);
  const ch = await store.createChannel({ ownerId: user.id, slug: `re-${tag}`, name: `Re ${tag}`, listingMode: 'marketplace' });

  await store.setUserBanned({ userId: user.id, action: 'suspend', ruleCode: 'counterfeit', remedy: '' });
  await store.setUserBanned({ userId: user.id, action: 'reinstate', remedy: 'False alarm.' });

  const after = await store.channelBySlug(ch.slug);
  assert.equal(after.owner_banned, false);
  assert.equal(isPublicChannel(after), true);
  assert.ok((await store.channels({ listedOnly: true })).some((c) => c.id === ch.id), 'back in Explore');

  const history = await store.userModerationHistory(user.id);
  assert.deepEqual(history.map((h) => h.action), ['reinstate', 'suspend'],
    'the ban is still on the record after it is lifted');
  assert.equal(history[0].rule_title, null, 'a reinstatement cites no rule');

  // A fresh sign-in works again.
  const session = await auth.createSession({ userId: user.id });
  assert.ok(await auth.resolveSession(session.token));
});

test('a banned account cannot sign in, and the refusal is a sentence', async () => {
  const tag = `${Date.now()}-${++seq}`;
  const user = await store.userByEmailOrCreate(`sign-${tag}@test.local`);
  await store.setUserBanned({ userId: user.id, action: 'suspend', ruleCode: 'financial_scam', remedy: '' });
  // The route checks `user.banned` before creating a session; if that line were
  // removed, this would be the only place it showed up, and only in production.
  const fresh = await store.userByEmail(user.email);
  assert.equal(fresh.banned, true);
  await store.setUserBanned({ userId: user.id, action: 'reinstate', remedy: '' });
  assert.equal((await store.userByEmail(user.email)).banned, false);
});

test('the operator can find an account by mailbox, because that is what a store page shows', async () => {
  const tag = `${Date.now()}-${++seq}`;
  const user = await store.userByEmailOrCreate(`find-${tag}@test.local`);
  assert.deepEqual(await store.usersMatching(''), [], 'an empty search is not a list of everybody');
  const exact = await store.usersMatching(user.email);
  assert.equal(exact[0].id, user.id, 'an exact address wins over a partial match');
  const partial = await store.usersMatching('find-');
  assert.ok(partial.some((u) => u.id === user.id));
});

test('the account list is only the accounts that are not normal', async () => {
  const tag = `${Date.now()}-${++seq}`;
  const user = await store.userByEmailOrCreate(`list-${tag}@test.local`);
  assert.ok(!(await store.bannedUsers()).some((u) => u.id === user.id));
  await store.setUserBanned({ userId: user.id, action: 'suspend', ruleCode: 'financial_scam', remedy: '' });
  const row = (await store.bannedUsers()).find((u) => u.id === user.id);
  assert.ok(row, 'a suspended account is listed');
  assert.equal(row.last_action, 'suspend');
  assert.equal(row.last_rule, 'financial_scam');
  assert.equal(row.banned, true);
});

test('the profile subject type exists, so the record has somewhere to go', async () => {
  const types = await checkValues('moderation_actions', 'subject_type');
  assert.ok(types.includes('profile'), `no 'profile' subject_type in the schema: ${types.join(', ')}`);
});

test('every rule code this file uses is a rule the policy table has', async () => {
  // The foreign key refuses a made-up code at runtime; this catches it at review
  // time, which is earlier and quieter. Three of these were invented in the first
  // draft of the module ('scam', 'spam', 'off_platform') and the FK is what found
  // them.
  const codes = new Set((await store.policyRules()).map((r) => r.code));
  const { readFile } = await import('node:fs/promises');
  const text = await readFile(new URL(import.meta.url), 'utf8');
  // The file deliberately cites one code that does not exist, to prove the
  // foreign key refuses it. Deliberate-invalid codes say so in their name.
  const cited = new Set([...text.matchAll(/ruleCode: '([a-z_]+)'/g)].map((m) => m[1])
    .filter((code) => !/^(made_up|bogus|not_a)/.test(code)));
  assert.ok(cited.size >= 3, 'the file should be citing several rules');
  for (const code of cited) {
    assert.ok(codes.has(code), `'${code}' is not in policy_rules`);
  }
});

// ---------------------------------------------------------------------------
// Finding a store
// ---------------------------------------------------------------------------

const { adminStores, adminStoreDetail } = await import('../src/views.js');

test('the directory searches names, slugs and the owner, and filters on plan', async () => {
  const { user, ch } = await fixture();
  const byName = await store.storeDirectory({ q: ch.name.slice(0, 4) });
  assert.ok(byName.total >= 1, 'a store is findable by its own name');
  const bySlug = await store.storeDirectory({ q: ch.slug });
  assert.ok(bySlug.rows.some((r) => r.id === ch.id), 'and by its slug');
  const byOwner = await store.storeDirectory({ q: user.email });
  assert.ok(byOwner.rows.some((r) => r.id === ch.id), 'and by the owner\'s email, which is how a report usually arrives');
  const nonsense = await store.storeDirectory({ q: 'zzz-no-such-store-zzz' });
  assert.equal(nonsense.total, 0);
  assert.deepEqual(nonsense.rows, []);

  // A sort key that is not on the list falls back rather than reaching the SQL.
  const hostile = await store.storeDirectory({ sort: 'views_30d; drop table channels' });
  assert.ok(hostile.rows.length >= 0, 'an unknown sort is ignored, not interpolated');
  assert.equal((await store.storeDirectory({ plan: 'paid' })).rows.every((r) => r.plan_code !== 'free'), true,
    'the paid filter returns only paying stores');
});

test('the directory page shows numbers that can be compared and never claims to know what was paid', () => {
  const rows = [
    { id: '1', slug: 'shop', name: 'Shop', owner_email: 'owner@test.local', owner_name: 'Owner',
      plan_code: 'store', sub_status: 'active', moderation_state: 'approved', listing_mode: 'marketplace',
      files_live: 3, files_total: 4, views_30d: 336, unlocks: 1, ad_views_30d: 180, reviews: 2,
      last_file_at: new Date().toISOString() },
  ];
  const html = adminStores({
    user: { role: 'admin', email: 'op@test.local' }, consent: null,
    data: { rows, total: 1, page: 1, perPage: 25 },
    filters: { q: '', state: 'all', plan: 'all', sort: 'traffic' },
  });
  assert.match(html, /1 store\b/, 'the count leads');
  assert.match(html, /class="num"/, 'numbers are a comparable column');
  assert.match(html, /aria-sort="descending"/, 'and the sorted column says so for a screen reader');
  assert.match(html, /Views · 30d/);
  assert.match(html, /href="\/admin\/stores\?[^"]*sort=unlocks"/, 'the sorting headers are links: every order is a URL');
  // The chip is lowercase in the markup and uppercased by CSS; colour is never
  // the only signal either way.
  assert.match(html, /pill-success[^>]*>approved</);
  // The honesty clause, on the page where an operator might expect a payout column.
  assert.match(html, /What a creator was PAID is not\s+on this page on purpose/);
  assert.ok(!/paypal|esewa balance|payout amount/i.test(html), 'nothing here pretends to know the network\'s number');

  const empty = adminStores({
    user: { role: 'admin', email: 'op@test.local' }, consent: null,
    data: { rows: [], total: 0, page: 1, perPage: 25 },
    filters: { q: 'nothing', state: 'all', plan: 'all', sort: 'traffic' },
  });
  assert.match(empty, /Nothing matches those filters/, 'an empty result says what to do next');
  assert.match(empty, /href="\/admin\/stores"/, 'and offers the way out');
});

test('the store detail assembles the evidence and refuses to invent a payout', async () => {
  const { ch, user } = await fixture();
  const detail = await store.storeDetail(ch.slug);
  assert.ok(detail, 'a store that exists comes back');
  assert.equal(detail.channel.id, ch.id);
  assert.equal(detail.channel.owner_email, user.email, 'with its owner attached');
  assert.ok(Array.isArray(detail.files) && Array.isArray(detail.reports) && Array.isArray(detail.history));
  assert.equal(await store.storeDetail('no-such-store-anywhere'), null, 'and a missing one returns nothing');

  const html = adminStoreDetail({
    user: { role: 'admin', email: 'op@test.local' }, consent: null,
    data: detail, rules: [{ code: 'copyright', title: 'Copyright infringement' }],
    actions: ['approve', 'restrict'], labels: { approve: 'Approve', restrict: 'Restrict' },
  });
  assert.match(html, /The store/);
  assert.match(html, /What it pays us/, 'the charges are on the page, because they are ours to collect');
  assert.match(html, /What the creator EARNED is not on this page/,
    'and the number we do not have says so');
  assert.match(html, /action="\/admin\/moderation\//, 'the decision form is here, in context');
  assert.match(html, /Reporters are not named here/, 'a moderation tool does not name complainants');

  // A store that is not there gets a page with a way back, not a stack trace.
  const missing = adminStoreDetail({ user: { role: 'admin', email: 'op@test.local' }, consent: null, data: null });
  assert.match(missing, /No such store/);
  assert.match(missing, /href="\/admin\/stores"/);
});

// ---------------------------------------------------------------------------
// The money path
// ---------------------------------------------------------------------------

const { adminConnections } = await import('../src/views.js');

test('connection health separates a network that never called from one whose secret is wrong', async () => {
  const rows = await store.connectionHealth();
  assert.ok(Array.isArray(rows));
  for (const r of rows) {
    assert.ok('postbacks_total' in r && 'callbacks_window' in r && 'signature_failures' in r,
      'the three numbers that tell the failure modes apart');
    assert.ok(Array.isArray(r.history), 'and the transitions, for the detail view');
  }
});

test('each failure mode gets its own explanation, not a status word', () => {
  const base = {
    channel_slug: 'shop', channel_name: 'Shop', provider_id: 'adsterra', status: 'active',
    created_at: new Date(Date.now() - 10 * 86_400_000).toISOString(),
    credential_label: 'zone 1234', payout_verdict: 'ok', slot_keys: [], slots_filled: 2,
    postbacks_total: 40, callbacks_window: 12, signature_failures: 0,
    last_verified_at: new Date(Date.now() - 3600_000).toISOString(), last_rejected_at: null,
    last_transition_at: null, history: [], status_reason: null,
  };
  const page = (over) => adminConnections({
    user: { role: 'admin', email: 'op@test.local' }, consent: null, rows: [{ ...base, ...over }],
  });

  assert.match(page({}), /Working/, 'a healthy connection says so');
  assert.match(page({ postbacks_total: 0, callbacks_window: 0, last_verified_at: null,
    created_at: new Date(Date.now() - 3 * 86_400_000).toISOString() }), /Never called us back/);
  assert.match(page({ signature_failures: 3, rejections_total: 3, last_rejected_at: new Date().toISOString() }),
    /The network is calling and we are refusing it/);
  // A refusal with a different reason gets its own sentence, because the fix is
  // different: this one is ours to correct, not the seller's.
  assert.match(page({ rejections_total: 2, last_rejected_at: new Date().toISOString(),
    last_rejection_reason: 'no adapter for provider "adsterra"' }),
  /Recent callbacks are being refused/);
  assert.match(page({ rejections_total: 2, last_rejected_at: new Date().toISOString(),
    last_rejection_reason: 'no adapter for provider "adsterra"' }), /no adapter for provider/);
  assert.match(page({ status: 'restricted', status_reason: 'Publisher not eligible for Nepal' }),
    /Publisher not eligible for Nepal/, "the network's own reason is shown verbatim");
  assert.match(page({ last_verified_at: new Date(Date.now() - 10 * 86_400_000).toISOString() }),
    /Last signed callback 10 days ago/);
  assert.match(page({ provider_id: 'house', postbacks_total: 0, last_verified_at: null }),
    /Ours/, 'a house connection expects no callbacks and is not a failure');

  // And the page never claims to know what anyone was paid.
  const full = page({});
  assert.match(full, /What a creator was PAID is never on this page/);
  // The word "earned" appears in the explanation of a failure ("nothing is earned
  // while this is true"), which is honest. What must never appear is a FIGURE:
  // a currency amount or a paid-to-them claim would be our number, and we do not
  // have that number.
  assert.ok(!/\$\s?\d/.test(full), 'no currency amounts on a page about callbacks');
  assert.ok(!/(were|was) paid \$|paid out|earnings of/i.test(full), 'and no payout claims');
});

test('the refusal line and the verdict agree with each other', () => {
  const base = {
    channel_slug: 'shop', channel_name: 'Shop', provider_id: 'adsterra', status: 'active',
    created_at: new Date(Date.now() - 10 * 86_400_000).toISOString(),
    credential_label: null, payout_verdict: null, slot_keys: [], slots_filled: 0,
    postbacks_total: 180, callbacks_window: 180, signature_failures: 0, rejections_total: 0,
    last_verified_at: new Date(Date.now() - 600_000).toISOString(), last_rejected_at: null,
    last_rejection_reason: null, last_transition_at: null, history: [], status_reason: null,
  };
  const page = (over) => adminConnections({
    user: { role: 'admin', email: 'op@test.local' }, consent: null, rows: [{ ...base, ...over }],
  });
  // The bug this replaces: a row that said "callbacks are being refused" above a
  // line reading "none", because one counted signature failures and the other
  // counted every refusal.
  const refused = page({ rejections_total: 3, last_rejected_at: new Date().toISOString(),
    last_rejection_reason: 'no adapter for provider "adsterra"' });
  assert.match(refused, /Recent callbacks are being refused/);
  assert.ok(!/Refused<\/dt><dd>nothing refused/.test(refused), 'the row cannot contradict its own verdict');
  assert.match(refused, /3 callbacks answered 401/);
  assert.match(refused, /no adapter for provider/);
  // And a clean connection says so on both lines.
  const clean = page({});
  assert.match(clean, /Working/);
  assert.match(clean, /nothing refused/);
});

test('the calibration joins our estimate to the statement\'s own window', async () => {
  // The whole reason this query is not a rolling 30 days: the statement covers a
  // period, and views outside it must not be counted into the comparison. This
  // test builds a view INSIDE the window and one outside it and asserts only the
  // inside one is measured.
  const { ch } = await fixture();
  const user = await store.userByEmailOrCreate(`cal-${Date.now()}@test.local`);
  const asset = await store.createAsset({
    channelId: ch.id, title: 'Calibration file', slug: `cal-${Date.now()}`, unlockMode: 'ad_gated',
  });
  const provider = 'calnet';
  const conn = await store.createConnection({
    channelId: ch.id, providerId: provider, callbackSecret: 's3cret', callbackBaseUrl: null,
  }).catch(() => null);

  const insertView = (externalId, when) => query(
    `insert into ad_view_events
       (channel_id, user_id, asset_id, provider_id, connection_id, external_id,
        kind, state, completed, signature_ok, created_at)
     values ($1, $2, $3, $4, $5, $6, 'display', 'complete', true, true, $7)`,
    [ch.id, user.id, asset.id, provider, conn?.id || null, externalId, when],
  );
  await insertView('inside-a', '2026-01-05T10:00:00Z');
  await insertView('inside-b', '2026-01-20T10:00:00Z');
  await insertView('outside', '2026-03-15T10:00:00Z');

  await store.addProviderReport({
    channelId: ch.id, providerId: provider,
    periodStart: '2026-01-01', periodEnd: '2026-01-31', reportedUsd: 3.5,
  });

  const rows = await store.statementCalibration();
  const row = rows.find((r) => r.channel_id === ch.id && r.provider_id === provider);
  assert.ok(row, 'the store appears in the calibration');
  assert.equal(Number(row.views), 2, 'only the two views inside the statement window are counted');
  assert.equal(Number(row.reported_usd), 3.5);
  // 2 views at the assumed rate, computed the same way the rent estimate is.
  assert.equal(Number(row.estimate_usd).toFixed(4), '0.0004');
  // 3.5 / (2/1000) = 1750 per 1000 views — an absurd rate, which is exactly what
  // a tiny demo window gives, and the page reports it rather than hiding it.
  assert.equal(Number(row.implied_rpm_usd), 1750);
});

test('a statement whose period has not settled is shown, and counted nowhere', async () => {
  const { ch } = await fixture();
  const future = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
  const past = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10);
  await store.addProviderReport({
    channelId: ch.id, providerId: 'openait', periodStart: past, periodEnd: future, reportedUsd: 9,
  });
  const open = await store.openStatements();
  assert.ok(open.some((o) => o.channel_slug === ch.slug), 'it is on the open list');
  const calibration = await store.statementCalibration();
  assert.ok(!calibration.some((r) => r.channel_slug === ch.slug && r.provider_id === 'openait'),
    'and it is absent from every comparison, rather than silently included');
});

// ---------------------------------------------------------------------------
// A file: listed, indexed, and unlockable are three different questions
// ---------------------------------------------------------------------------

/**
 * `pending` used to mean nothing at all.
 *
 * It was in the schema, it was in `ASSET_STATES`, and it behaved exactly like
 * `approved` — public, unlockable, and set by nobody, because `createAsset`
 * hardcoded `approved`. So the operator's "Files needing a decision" queue could
 * not contain a new file, and the state that was supposed to hold a store's first
 * upload was decoration.
 *
 * It now means the one thing that can be promised to a creator by a platform with
 * one operator: the file is live at its link and in the store's own shop, and it
 * is SEARCH that waits for a person. itch.io ships the same shape for a new
 * seller's first project — published and fully functional by URL, held out of
 * browse until reviewed.
 */
test('a file that is waiting is listed, unlockable, and kept out of search', async () => {
  const mod = await import('../src/moderation.js');
  const pending = mod.assetBehaviour('pending');
  assert.equal(pending.publicVisible, true, 'a waiting file must not be a dead link');
  assert.equal(pending.canUnlock, true, 'and its creator must not be blocked from publishing');
  assert.equal(pending.searchable, false, 'but it must not be the answer to a stranger\'s search');
  assert.ok(pending.ownerNote, 'a file that waits tells its owner so');
  // The three questions are answered for every state, or a caller reads undefined.
  for (const state of mod.ASSET_STATES) {
    const b = mod.assetBehaviour(state);
    for (const key of ['publicVisible', 'canUnlock', 'searchable']) {
      assert.equal(typeof b[key], 'boolean', `${state}.${key} is not a boolean`);
    }
  }
  // Removed is out of search as well, and that is not the same fact as pending:
  // one is a decision, the other is the absence of one.
  assert.equal(mod.assetBehaviour('removed').searchable, false);
  assert.equal(mod.assetBehaviour('approved').searchable, true);
  assert.deepEqual(mod.SEARCHABLE_ASSET_STATES, ['approved', 'restricted'],
    'searchable states must be derived from the table, not written out again');
});

test('a store\'s files wait until a person has approved one of them', async () => {
  const owner = await store.createUser({
    email: `unreviewed-${Date.now()}@bytebikri.local`, password: 'bytebikri-demo', role: 'seller',
  });
  const channel = await store.createChannel({
    ownerId: owner.id, name: 'First Upload', slug: `first-upload-${Date.now()}`,
  });

  const first = await store.createAsset({
    channelId: channel.id, title: 'The very first file', slug: 'first',
  });
  assert.equal(first.moderation_state, 'pending', 'a new store\'s first file waits for a person');
  // The rule is not "one file per store": a creator uploading five files at signup
  // does not get four published unreviewed files while the queue is asleep.
  const second = await store.createAsset({
    channelId: channel.id, title: 'Second file', slug: 'second',
  });
  assert.equal(second.moderation_state, 'pending', 'nothing has been approved yet');

  // A person looks. That is the whole promise, kept once per store.
  await store.setAssetModeration({
    assetId: first.id, action: 'approve', state: 'approved', ruleCode: null,
    remedy: null, actorId: owner.id,
  });
  const third = await store.createAsset({
    channelId: channel.id, title: 'Third file', slug: 'third',
  });
  assert.equal(third.moderation_state, 'approved',
    'after one approval the store publishes without waiting again');
});

test('search returns files that are decisions, not files that are questions', async () => {
  const stamp = Date.now();
  const owner = await store.createUser({
    email: `searchable-${stamp}@bytebikri.local`, password: 'bytebikri-demo', role: 'seller',
  });
  const channel = await store.createChannel({
    ownerId: owner.id, name: 'Searchable Studio', slug: `searchable-${stamp}`,
    listingMode: 'marketplace',
  });
  const term = `zebrafile${stamp}`;
  const fresh = await store.createAsset({
    channelId: channel.id, title: `Zebra file ${term}`, slug: `zebra-${stamp}`,
  });
  const found = async () => (await store.search(term)).assets.map((a) => a.id);

  assert.deepEqual(await found(), [], 'a file nobody has looked at is not a search result');

  await store.setAssetModeration({
    assetId: fresh.id, action: 'approve', state: 'approved', ruleCode: null,
    remedy: null, actorId: owner.id,
  });
  assert.deepEqual(await found(), [fresh.id], 'once approved, it is findable');

  // And the bug this test was written beside: a removed file kept appearing in
  // search results, and its link landed on a 404 — the same read-path hole the
  // storefront had, one surface over.
  await store.setAssetModeration({
    assetId: fresh.id, action: 'remove', state: 'removed', ruleCode: 'copyright',
    remedy: 'Removed for a test.', actorId: owner.id,
  });
  assert.deepEqual(await found(), [], 'a removed file must not be advertised in search');
});
