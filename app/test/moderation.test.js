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
  normaliseState, behaviour, isPublic, canWrite, stateFor,
  cleanRemedy, decisionNote, validateDecision, changesVisibility, REMEDY_LIMIT,
} = await import('../src/moderation.js');

const { store } = await import('../src/store.js');
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
