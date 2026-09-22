/**
 * Country rules: who a file is for, and what a visitor is told.  npm test
 *
 * `asset_country_rules` and `content_geo_blocks` have been in the schema since
 * migration 0001 and were read by nobody, so every file was available in every
 * country. The failure modes of the code that now reads them are all quiet ones,
 * which is why they are pinned here rather than trusted:
 *
 *   1. A rule that resolves the wrong way. Most specific wins — an asset rule
 *      beats a store-wide block — and a row whose state this code cannot read
 *      must fail CLOSED. Serving a file because a string was unexpected is the
 *      version nobody notices until a letter arrives.
 *
 *   2. A block that reaches the wrong visitor. An unknown country is not a
 *      blocked country: no header means no rule applies, and a name table that
 *      treated `XX` as a place would black out a file for the whole world the
 *      first time a proxy stripped the header.
 *
 *   3. A rule that moves without a record. Every decision writes the rule, the
 *      enforcement index and a `moderation_actions` row together — a file that
 *      stops being available with nobody recorded as deciding it is
 *      indistinguishable from a bug in the read path.
 *
 * The pure half of this file needs no database. The second half uses one because
 * these promises are about what actually lands in three tables at once.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:55432/bytebikri_test';

const geo = await import('../src/geo.js');
const {
  COUNTRY_NAMES, COUNTRY_OPTIONS, countryIn, countryName, isCountryCode,
} = await import('../src/countries.js');
const {
  ASSET_ACTIONS, ASSET_STATES, assetBehaviour, isAssetPublic, isAssetUnlockable,
  validateAssetDecision,
} = await import('../src/moderation.js');
const { store } = await import('../src/store.js');
const { adminModeration, adminModerationFile } = await import('../src/views.js');
/** The server's own source, so a form action can be checked against it. */
const serverSource = () => readFileSync(new URL('../server.js', import.meta.url), 'utf8');
const { query, close } = await import('../src/db.js');
after(async () => { await close(); });

// ---------------------------------------------------------------------------
// Where a country comes from
// ---------------------------------------------------------------------------

test('the country is read from the edge header, and an unknown one is not a country', () => {
  assert.equal(geo.countryFrom({ headers: { 'cf-ipcountry': 'IN' } }), 'IN');
  assert.equal(geo.countryFrom({ headers: { 'cf-ipcountry': 'in' } }), 'IN', 'case does not matter');
  // Cloudflare sends XX when it cannot place an address and T1 for Tor exits.
  // Neither is a place a rule can be written about, and treating them as one
  // would apply somebody's country rule to every visitor the edge could not place.
  assert.equal(geo.countryFrom({ headers: { 'cf-ipcountry': 'XX' } }), null);
  assert.equal(geo.countryFrom({ headers: { 'cf-ipcountry': 'T1' } }), null);
  assert.equal(geo.countryFrom({}), null, 'no header means no country, not a blocked one');
});

test('a country name reads as an English sentence, not a label', () => {
  // "Visitors in United States cannot open this store" is the sentence this
  // prevents, and it was the sentence the owner notice actually printed.
  assert.equal(countryIn('US'), 'the United States');
  assert.equal(countryIn('GB'), 'the United Kingdom');
  assert.equal(countryIn('NL'), 'the Netherlands');
  assert.equal(countryIn('AE'), 'the United Arab Emirates');
  assert.equal(countryIn('KY'), 'the Cayman Islands');
  assert.equal(countryIn('CG'), 'the Congo');
  assert.equal(countryIn('NP'), 'Nepal', 'most names take no article at all');
  assert.equal(countryIn('IN'), 'India');
  assert.equal(countryIn('SD'), 'Sudan', 'archaic articles are not added');
  assert.equal(countryIn('VA'), 'Vatican City');
  assert.equal(countryIn(''), '—', 'an absent country renders as the dash the tables use');
  // The rule runs over every name we ship: nothing may come out doubled, and
  // every name must survive it unchanged when it needs no article.
  for (const code of Object.keys(COUNTRY_NAMES)) {
    const out = countryIn(code);
    assert.ok(!/^the the /i.test(out), `${code} doubled its article`);
    assert.ok(out.length > 1, `${code} has no name`);
  }
  const sentence = geo.blockSentence({ resolved: { source: 'operator' }, country: 'US' });
  assert.match(sentence.headline, /^Not available in the United States$/);
});

test('the query override works only in development', () => {
  assert.equal(geo.countryFrom({ query: { country: 'np' } }, { dev: true }), 'NP');
  assert.equal(geo.countryFrom({ query: { country: 'np' } }, { dev: false }), null);
  // A parameter that can change what a visitor is allowed to see is a bypass with
  // a URL in production, and the call sites pass `!isProd()`.
  assert.equal(geo.countryFrom({ query: { country: 'np' } }), null);
});

test('the edge cannot be asked for a country that is not a country', () => {
  assert.equal(isCountryCode('NP'), true);
  assert.equal(isCountryCode('np'), true);
  assert.equal(isCountryCode('XK'), true, 'Kosovo has no ISO code and every edge sends XK anyway');
  assert.equal(isCountryCode('ZZ'), true, 'a well-formed code we have no name for is still a code');
  assert.equal(isCountryCode('XX'), false);
  assert.equal(isCountryCode('T1'), false);
  assert.equal(isCountryCode('NPL'), false);
  assert.equal(isCountryCode(''), false);
  assert.equal(countryName('np'), 'Nepal');
  assert.equal(countryName('ZZ'), 'ZZ', 'never a blank cell');
  assert.ok(COUNTRY_OPTIONS.length > 200, 'the picker offers the world');
  assert.equal(COUNTRY_OPTIONS[0].name, 'Afghanistan');
});

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

test('the most specific decision wins, in both directions', () => {
  const assetRule = { state: 'allowed', source: 'operator' };
  const channelBlock = { rule_code: 'gambling-in' };
  const resolved = geo.resolveCountry({ assetRule, channelBlock });
  assert.equal(resolved.state, 'allowed', 'an explicit file decision beats the store decision');
  assert.equal(resolved.inherited, false);
  assert.equal(geo.isBlocked(resolved), false);
  assert.equal(geo.blockStatus(resolved), null, 'an allowed file is not a block and has no block status');

  const inherited = geo.resolveCountry({ channelBlock });
  assert.equal(inherited.state, 'blocked');
  assert.equal(inherited.inherited, true);
  assert.equal(inherited.ruleCode, 'gambling-in');
  assert.equal(geo.blockStatus(inherited), 451);
});

test('a state this code cannot read fails closed', () => {
  const resolved = geo.resolveCountry({ assetRule: { state: 'maybe', source: 'creator' } });
  assert.equal(resolved.state, 'blocked', 'an unreadable row is not a reason to serve the file');
  // …and the source still decides the sentence and the status, because the row
  // did say who decided.
  assert.equal(geo.blockStatus(resolved), 403);
});

test('the status code follows the source: 451 for a rule, 403 for a choice', () => {
  const rule = geo.resolveCountry({ assetRule: { state: 'blocked', source: 'operator' } });
  const choice = geo.resolveCountry({ assetRule: { state: 'blocked', source: 'creator' } });
  assert.equal(geo.blockStatus(rule), 451, 'RFC 7725: withheld for legal reasons');
  assert.equal(geo.blockStatus(choice), 403, 'the owner decided');
  assert.equal(geo.blockStatus(geo.resolveCountry({})), null);
});

test('availability combines the file state and the country rule, and removed wins', () => {
  const none = geo.resolveCountry({});
  assert.deepEqual(geo.availabilityFor({ assetState: 'approved', resolved: none }),
    { visible: true, unlockable: true, reason: null, state: null });

  const blocked = geo.resolveCountry({ assetRule: { state: 'blocked', source: 'operator' } });
  assert.deepEqual(geo.availabilityFor({ assetState: 'approved', resolved: blocked }),
    { visible: false, unlockable: false, reason: 'country', state: 'blocked' });

  const restricted = geo.resolveCountry({ assetRule: { state: 'restricted', source: 'creator' } });
  assert.deepEqual(geo.availabilityFor({ assetState: 'approved', resolved: restricted }),
    { visible: true, unlockable: false, reason: 'country', state: 'restricted' },
    'a country restriction is not a block: the listing stays, and the copy has to say so');

  assert.deepEqual(geo.availabilityFor({ assetState: 'restricted', resolved: none }),
    { visible: true, unlockable: false, reason: 'file', state: 'restricted' });

  const allowed = geo.resolveCountry({ assetRule: { state: 'allowed', source: 'operator' } });
  assert.deepEqual(geo.availabilityFor({ assetState: 'removed', resolved: allowed }),
    { visible: false, unlockable: false, reason: 'file', state: 'removed' },
    'an operator who removed a file did not mean "except where a country rule allows it"');
});

test('the sentence names the country, never the code, and cites the rule', () => {
  const resolved = geo.resolveCountry({ assetRule: { state: 'blocked', source: 'operator' } });
  const sentence = geo.blockSentence({
    resolved, rule: { title: 'Adult content in India' }, store: 'Alice Studio', country: 'IN',
  });
  assert.equal(sentence.headline, 'Not available in India');
  assert.match(sentence.why, /Adult content in India/);
  assert.doesNotMatch(sentence.headline, /\bIN\b/);

  const choice = geo.blockSentence({
    resolved: geo.resolveCountry({ assetRule: { state: 'blocked', source: 'creator' } }),
    store: 'Alice Studio', country: 'GB',
  });
  assert.equal(choice.headline, 'Not available in the United Kingdom',
    'and the name is the one English uses in a sentence');
  assert.match(choice.why, /Alice Studio has not made this file available/,
    'a creator block says it was their choice, not a platform rule');
  assert.doesNotMatch(choice.why, /platform rule/);

  const inherited = geo.blockSentence({
    resolved: geo.resolveCountry({ channelBlock: { rule_code: 'gambling-in' } }),
    rule: { title: 'Gambling promotion in India' }, store: 'Alice Studio', country: 'IN',
  });
  assert.match(inherited.why, /Files from this store are not shown/);
});

test('the operator page states the limits of the feature, out loud', () => {
  const text = geo.COUNTRY_LIMITS.join(' ');
  // The three claims that must never be quietly dropped: how the country is
  // known, that it can be evaded, and that nothing here classifies content.
  assert.match(text, /CF-IPCountry/);
  assert.match(text, /VPN defeats this/);
  assert.match(text, /nothing here classifies content|Nothing here classifies content/i);
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

test('a rule that withholds cites a rule; allowing cites nothing', () => {
  assert.equal(geo.validateCountryDecision({ state: 'blocked' }).error, 'reason');
  assert.equal(geo.validateCountryDecision({ state: 'blocked', ruleCode: 'adult-in' }).ok, true);
  assert.equal(geo.validateCountryDecision({ state: 'allowed', ruleCode: 'adult-in' }).error, 'reason');
  assert.equal(geo.validateCountryDecision({ state: 'allowed', ruleCode: null }).ok, true);
  assert.equal(geo.validateCountryDecision({ state: 'suspended', ruleCode: 'adult-in' }).error, 'state');
  assert.equal(geo.validateCountryDecision({}).error, 'state');
});

test("a creator may withhold, and may not allow", () => {
  const creator = { states: geo.CREATOR_COUNTRY_STATES, requireRule: false };
  assert.equal(geo.validateCountryDecision({ state: 'blocked', ...creator }).ok, true,
    'a creator does not cite a policy rule, and the first version of this refused them outright');
  assert.equal(geo.validateCountryDecision({ state: 'restricted', ...creator }).ok, true);
  assert.equal(geo.validateCountryDecision({ state: 'allowed', ...creator }).error, 'state',
    'allowing a country is how an operator carves a file out of a store-wide rule');
});

test('a file has four states and no suspension', async () => {
  const observed = await query(
    `select pg_get_constraintdef(c.oid) as def
       from pg_constraint c
       join pg_class t on t.oid = c.conrelid
      where t.relname = 'assets' and c.contype = 'c'
        and pg_get_constraintdef(c.oid) like '%moderation_state%'`,
  );
  const values = new Set();
  for (const r of observed.rows) {
    for (const m of String(r.def).matchAll(/'([a-z_]+)'::text/g)) values.add(m[1]);
  }
  assert.deepEqual([...values].sort(), [...ASSET_STATES].sort(),
    'the module and the assets CHECK constraint have to agree');

  assert.equal(ASSET_ACTIONS.includes('suspend'), false);
  const refused = validateAssetDecision({ action: 'suspend', ruleCode: 'copyright' });
  assert.equal(refused.ok, false);
  assert.equal(refused.error, 'action',
    'suspend silently becoming restricted is how a file is hidden everywhere while its operator believes it is listed');
  assert.equal(validateAssetDecision({ action: 'restrict' }).error, 'reason');
  assert.equal(validateAssetDecision({ action: 'restrict', ruleCode: 'copyright' }).state, 'restricted');
  assert.equal(validateAssetDecision({ action: 'warn' }).state, null);
  assert.equal(assetBehaviour('removed').canUnlock, false);
  assert.equal(isAssetPublic('removed'), false);
  assert.equal(isAssetPublic('restricted'), true, 'listed, so the store still reads');
  assert.equal(isAssetUnlockable('restricted'), false);
});

test('moderation_actions can record a file decision and a country', async () => {
  const observed = await query(
    `select pg_get_constraintdef(c.oid) as def
       from pg_constraint c
       join pg_class t on t.oid = c.conrelid
      where t.relname = 'moderation_actions' and c.contype = 'c'
        and pg_get_constraintdef(c.oid) like '%subject_type%'`,
  );
  const subjects = new Set();
  for (const r of observed.rows) {
    for (const m of String(r.def).matchAll(/'([a-z_]+)'::text/g)) subjects.add(m[1]);
  }
  assert.ok(subjects.has('asset'), 'a country rule about a file is recorded against the file');
  assert.ok(subjects.has('channel'), 'a store-wide block is recorded against the store');
  const columns = await query(
    "select column_name from information_schema.columns where table_name = 'moderation_actions'",
  );
  const names = new Set(columns.rows.map((r) => r.column_name));
  assert.ok(names.has('country_code'), 'the country is part of the record, not part of a sentence');
});

// ---------------------------------------------------------------------------
// The three writes, together
// ---------------------------------------------------------------------------

let seq = 0;
async function fixture() {
  const tag = `${Date.now()}-${++seq}`;
  const user = await store.userByEmailOrCreate(`geo-${tag}@test.local`);
  const ch = await store.createChannel({
    ownerId: user.id, slug: `geo-${tag}`, name: `Geo ${tag}`, listingMode: 'marketplace',
  });
  // Approved, because these tests are about countries: a file waiting for its
  // first review is a different question (`test/moderation.test.js` owns it), and
  // mixing the two would make a country failure look like a review failure.
  const asset = await store.createAsset({
    channelId: ch.id, title: `File ${tag}`, slug: `file-${tag}`, description: 'x',
    moderationState: 'approved',
  });
  const other = await store.createAsset({
    channelId: ch.id, title: `Other ${tag}`, slug: `other-${tag}`, description: 'x',
    moderationState: 'approved',
  });
  return { user, ch, asset, other };
}

test('a country rule writes the decision, the index and the record together', async () => {
  const { user, ch, asset } = await fixture();
  const before = await store.countryRulesFor([asset.id], 'IN');
  assert.deepEqual(before, [], 'a new file is available everywhere');
  const beforeRow = (await store.countrySummary()).find((c) => c.country_code === 'IN') ?? {};
  const beforeIn = beforeRow.blocked_files ?? 0;
  const beforeOperator = beforeRow.blocked_files_operator ?? 0;
  const beforeCreator = beforeRow.blocked_files_creator ?? 0;
  const beforeStores = (await store.countrySummary()).find((c) => c.country_code === 'IN')?.blocked_stores ?? 0;

  await store.setAssetCountryRule({
    assetId: asset.id, countryCode: 'in', state: 'blocked',
    ruleCode: 'adult-in', source: 'operator', actorId: user.id,
  });

  const rows = await store.countryRulesFor([asset.id], 'IN');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].state, 'blocked');
  assert.equal(rows[0].rule_code, 'adult-in', 'the index carries the rule the visitor is shown');

  const audit = await store.fileDecisionHistory(asset.id);
  assert.equal(audit.length, 1);
  assert.equal(audit[0].action, 'restrict');
  assert.equal(audit[0].country_code, 'IN');
  assert.equal(audit[0].rule_code, 'adult-in');
  assert.equal(audit[0].actor_id, user.id, 'a decision with nobody on it is not a record');

  // And the store-wide read: the file is in the queue while its state is fine.
  const queue = await store.filesNeedingModeration();
  const mine = queue.find((f) => f.id === asset.id);
  assert.ok(mine, 'an approved file with a country rule still needs a person');
  assert.equal(mine.moderation_state, 'approved');
  assert.match(mine.country_summary, /IN blocked/);

  // Counted relatively: the test database is shared by every test in this file,
  // so an absolute number here would be an assertion about the order tests run in.
  const summary = (await store.countrySummary()).find((c) => c.country_code === 'IN');
  // Relative counts, not absolute ones: every test in this file shares one
  // database, so "1" is really "one more than before".
  assert.equal(summary.blocked_files, beforeIn + 1, 'this file is now counted in India');
  assert.equal(summary.blocked_files_operator, beforeOperator + 1,
    'and counted as ours, because an operator decided it');
  assert.equal(summary.blocked_files_creator, beforeCreator, 'the creator’s column did not move');
  assert.equal(summary.blocked_stores, beforeStores, 'and no store was withheld');
});

test('restricting a country takes the file out of the block index', async () => {
  const { user, asset } = await fixture();
  await store.setAssetCountryRule({
    assetId: asset.id, countryCode: 'NP', state: 'blocked', ruleCode: 'adult-np', actorId: user.id,
  });
  const blocked = await query(
    "select count(*)::int as n from content_geo_blocks where subject_type = 'asset' and subject_id = $1",
    [asset.id],
  );
  assert.equal(blocked.rows[0].n, 1);

  await store.setAssetCountryRule({
    assetId: asset.id, countryCode: 'NP', state: 'restricted', source: 'creator', actorId: null,
  });
  const index = await query(
    "select count(*)::int as n from content_geo_blocks where subject_type = 'asset' and subject_id = $1",
    [asset.id],
  );
  assert.equal(index.rows[0].n, 0, 'a block that is gone from the rule must not linger in the index');

  const rows = await store.countryRulesFor([asset.id], 'NP');
  assert.equal(rows[0].state, 'restricted');
  assert.equal(rows[0].source, 'creator');
  const resolved = geo.resolveCountry({ assetRule: rows[0] });
  const availability = geo.availabilityFor({ assetState: 'approved', resolved });
  assert.equal(availability.visible, true, 'a restricted file stays listed so the store still reads');
  assert.equal(availability.unlockable, false);
  assert.equal(availability.reason, 'country');
});

test('clearing a country rule stands the index down, and a store block is what remains', async () => {
  const { user, ch, asset } = await fixture();
  await store.setAssetCountryRule({
    assetId: asset.id, countryCode: 'IN', state: 'allowed', source: 'operator', actorId: user.id,
  });

  // A store-wide decision inherits to every file…
  await store.setChannelCountryBlock({
    channelId: ch.id, countryCode: 'IN', ruleCode: 'gambling-in', remedy: 'Platform decision.', actorId: user.id,
  });
  const inherited = geo.resolveCountry({ channelBlock: await store.channelCountryBlock(ch.id, 'IN') });
  assert.equal(geo.isBlocked(inherited), true);
  assert.equal(inherited.inherited, true);

  // …and the file's own `allowed` is what carves it back out.
  const carved = geo.resolveCountry({
    assetRule: (await store.countryRulesFor([asset.id], 'IN'))[0],
    channelBlock: await store.channelCountryBlock(ch.id, 'IN'),
  });
  assert.equal(carved.state, 'allowed');
  assert.equal(geo.availabilityFor({ assetState: 'approved', resolved: carved }).unlockable, true);
  // The carve-out has to be distinguishable from "no rule at all", because that
  // is exactly what it is not: a store-wide decision is still standing, and the
  // page says so. Without the flag the visitor sees an ordinary file page, and
  // the store link one click away looks broken.
  assert.equal(carved.carveOut, true, 'the file was allowed back into a blocked country');
  assert.equal(inherited.carveOut, false, 'a store block is not a carve-out');
  assert.equal(geo.resolveCountry({}).carveOut, false, 'no rule is not a carve-out');

  // Clearing the file rule leaves the store block in force for it again.
  await store.clearAssetCountryRule({ assetId: asset.id, countryCode: 'IN', actorId: user.id });
  assert.deepEqual(await store.countryRulesFor([asset.id], 'IN'), []);
  const afterClear = geo.resolveCountry({ channelBlock: await store.channelCountryBlock(ch.id, 'IN') });
  assert.equal(geo.availabilityFor({ assetState: 'approved', resolved: afterClear }).visible, false);
  assert.equal(geo.availabilityFor({ assetState: 'approved', resolved: afterClear }).reason, 'country');

  // The clear is a decision too, and it lands in the history with the country.
  const history = await store.fileDecisionHistory(asset.id);
  assert.ok(history.some((h) => h.action === 'approve' && h.country_code === 'IN'));
});

test('a store-wide block is one row and it counts once, not once per file', async () => {
  const { user, ch } = await fixture();
  const beforeStores = (await store.countrySummary()).find((c) => c.country_code === 'NP')?.blocked_stores ?? 0;
  const beforeFiles = (await store.countrySummary()).find((c) => c.country_code === 'NP')?.blocked_files ?? 0;
  await store.createAsset({ channelId: ch.id, title: 'A', slug: `a-${ch.slug}`, description: '' });
  await store.createAsset({ channelId: ch.id, title: 'B', slug: `b-${ch.slug}`, description: '' });
  await store.setChannelCountryBlock({
    channelId: ch.id, countryCode: 'NP', ruleCode: 'gambling-in', actorId: user.id,
  });

  const blocks = await store.channelCountryBlocks([ch.id], 'NP');
  assert.equal(blocks.length, 1, 'a rule about a shop is one row, not one per file');
  const summary = (await store.countrySummary()).find((c) => c.country_code === 'NP') ?? {};
  // A creator's own withholding must not arrive at the operator's country table
  // wearing the platform's colours: it lands in the creator column, and the
  // operator column does not move.
  assert.equal(summary.restricted_files_creator >= 1, true, 'the creator’s restriction is counted');
  assert.equal(summary.restricted_files_operator, 0, 'and not as a platform rule');
  assert.equal(summary.blocked_stores, beforeStores + 1);
  assert.equal(summary.blocked_files, beforeFiles,
    'nothing was written per file, so nothing is counted per file');

  const listed = await store.storeCountryBlocks();
  assert.ok(listed.some((b) => b.slug === ch.slug && b.rule_title), 'the console sees the rule it cites');

  await store.clearChannelCountryBlock({ channelId: ch.id, countryCode: 'NP', actorId: user.id });
  assert.deepEqual(await store.channelCountryBlocks([ch.id], 'NP'), []);
});

test('a file decision moves the file and records it in one transaction', async () => {
  const { user, asset } = await fixture();
  const moved = await store.setAssetModeration({
    assetId: asset.id, action: 'restrict', state: 'restricted',
    ruleCode: 'copyright', remedy: 'A licence we do not have.', actorId: user.id,
  });
  assert.equal(moved.moderation_state, 'restricted');

  const history = await store.fileDecisionHistory(asset.id);
  assert.equal(history[0].action, 'restrict');
  assert.equal(history[0].rule_code, 'copyright');
  assert.equal(history[0].reason, 'A licence we do not have.');
  assert.equal(history[0].rule_title, 'Copyright infringement');
  const detail = await store.fileModerationDetail(asset.id);
  assert.equal(detail.moderation_state, 'restricted');
  assert.equal(detail.channel_id, moved.channel_id, 'the file page knows which store it belongs to');
  assert.ok(detail.channel_slug && detail.channel_name);
});

test('two files in one store resolve independently', async () => {
  const { user, ch, asset, other } = await fixture();
  await store.setAssetCountryRule({
    assetId: asset.id, countryCode: 'IN', state: 'blocked', ruleCode: 'adult-in', actorId: user.id,
  });
  const rules = await store.countryRulesFor([asset.id, other.id], 'IN');
  const byAsset = new Map(rules.map((r) => [r.asset_id, r]));
  const first = geo.availabilityFor({ assetState: 'approved', resolved: geo.resolveCountry({ assetRule: byAsset.get(asset.id) }) });
  const second = geo.availabilityFor({ assetState: 'approved', resolved: geo.resolveCountry({ assetRule: byAsset.get(other.id) }) });
  assert.equal(first.visible, false);
  assert.equal(second.visible, true, 'one query for the grid, one decision per card');
  assert.equal((await store.channelCountryBlock(ch.id, 'IN')), null, 'no store-wide decision was made');
});

// ---------------------------------------------------------------------------
// The operator's file page: what it offers, and how it words what happened
// ---------------------------------------------------------------------------

/**
 * A page fixture, not a database one: these two tests are about what the console
 * renders, and a store that exists only inside the object keeps them honest about
 * that. The database half of this file proves the rules themselves.
 */
const OPERATOR = { id: '00000000-0000-0000-0000-0000000000aa', role: 'admin', email: 'op@bytebikri.local', display_name: 'Operator' };
const PAGE_CHANNEL = { id: '00000000-0000-0000-0000-0000000000bb', slug: 'alice', name: 'Alice Studio' };
const PAGE_ASSET = {
  id: '00000000-0000-0000-0000-0000000000cc', slug: 'poster-kit', title: 'Poster kit',
  moderation_state: 'approved', channel_id: PAGE_CHANNEL.id, owner_name: 'Alice', owner_email: 'alice@bytebikri.local',
};

test('no country is chosen for the operator, in any of the three pickers', () => {
  const opts = (html) => (html.match(/<select[^>]*name="countryCode"[\s\S]*?<\/select>/g) || []);
  const filePage = adminModerationFile({
    user: OPERATOR, asset: PAGE_ASSET, channel: PAGE_CHANNEL, limits: [],
  });
  const selects = opts(filePage);
  assert.ok(selects.length, 'the file page has a country picker');
  for (const sel of selects) {
    const first = (sel.match(/<option[^>]*>[^<]*<\/option>/) || [''])[0];
    assert.match(first, /value=""/, 'the first option is empty, so a careless submit picks nothing');
    assert.match(first, /Choose a country/, 'and it says so');
  }
  // The list itself still reaches every country we can name: a blank default is
  // not a shorter list, it is one nobody has chosen from yet.
  assert.match(filePage, /value="NP"/);
  assert.match(filePage, /value="US"/);
});

test('every form the console renders posts to a route the server answers', () => {
  // The bug this pins: the store-withhold form posted to `/admin/moderation/country`
  // while the handler listened on `/admin/moderation/blocks`, so the one control
  // built for withdrawing a whole store from a country answered "Channel not
  // found" — the wrong route's message — and nothing said so. A form action is a
  // promise about a URL; it is checked here against the server's own source.
  const html = adminModeration({
    user: OPERATOR, rows: [], files: [], countries: [], storeBlocks: [],
    channels: [{ slug: 'alice', name: 'Alice Studio' }], limits: [],
    rules: [{ code: 'adult-in', title: 'Adult content in India' }],
    actions: ASSET_ACTIONS, labels: { restrict: 'Restricted', approve: 'Approved' },
  });
  const actions = [...new Set((html.match(/<form[^>]*action="([^"]+)"/g) || [])
    .map((f) => f.match(/action="([^"]+)"/)[1]))];
  assert.ok(actions.length, 'the console page has forms');
  const routes = serverSource();
  const answered = (path) => {
    const pattern = path
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\\\$\\\{[^}]*\\\}|:\w+/g, '[^/]+');
    return new RegExp(`['"\`]${pattern}['"\`]`).test(routes);
  };
  for (const action of actions) {
    assert.ok(answered(action), `${action} has no route — the form would 404 or hit the wrong handler`);
  }
  assert.ok(actions.includes('/admin/moderation/blocks'), 'the withhold form posts to its handler');
});

test('a country decision is logged as a country decision, and the table keeps the state', () => {
  const html = adminModerationFile({
    user: OPERATOR, asset: PAGE_ASSET, channel: PAGE_CHANNEL, limits: [],
    countryRules: [{ country_code: 'IN', state: 'blocked', source: 'operator', rule_code: 'gambling-in', rule_title: 'Adult content in India', set_by_name: 'Operator', updated_at: new Date().toISOString() }],
    history: [
      { action: 'restrict', country_code: 'IN', rule_code: 'gambling-in', rule_title: 'Adult content in India', actor_name: 'Operator', created_at: new Date().toISOString() },
      { action: 'restrict', rule_code: 'copyright', rule_title: 'Copyright infringement', actor_name: 'Operator', reason: 'Long clip from a licensed film.', created_at: new Date().toISOString() },
    ],
    labels: { restrict: 'Restricted', approve: 'Approved' },
  });
  assert.match(html, /Limited for India/, 'the country row reads as a country decision');
  assert.ok(!/Restricted <span class="fine">in India/.test(html), 'not the raw verb beside a state table');
  // The cell may carry a data-label — the phone labels it there — so this asserts
  // what it means: the text in the cell is the verb, not the country phrasing.
  assert.ok(/<td[^>]*>Restricted<\/td>/.test(html), 'a decision about the file itself still reads as its own verb');
  assert.match(html, /Copyright infringement/, 'and it still names the rule');
  assert.match(html, /What a country rule can and cannot do/, 'the limits list says what it is');
  assert.match(html, /on this page and everywhere else/, 'and that this is the file page’s copy of it');
});
