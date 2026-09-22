/**
 * The seller's file list: finding one, and changing several.  npm test
 *
 * §10 shipped the list and the audit has carried the same line since: "one file at
 * a time; a seller with 200 files will want more". This file is about the three
 * claims the new version makes, in the order they can go wrong:
 *
 *   1. THE FILTERS ARE HONEST. A page that says "3 files" while a filter is on, or
 *      a chip with no count behind it, is a page that lies about what it is showing.
 *      So the tests here check both numbers — how many match, and how many exist.
 *
 *   2. A BULK CHANGE DOES EXACTLY WHAT WAS ASKED, AND NOTHING ELSE. It cannot reach
 *      another store's files, it cannot move a file the platform is holding while
 *      reports are answered, and it does not record a file it did not change. Each
 *      of those is a test that injects the case and asserts the count came back.
 *
 *   3. THE UNDO RESTORES, RATHER THAN INVERTS. This is the one that would be easy to
 *      get wrong and invisible if it were: a selection can hold a live file and a
 *      paused one, and "apply the opposite word to everything" would put one of them
 *      back wrong. `before` carries the values, and these tests pick a mixed set on
 *      purpose so a restore and an inverse give different answers.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../..');
process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:55432/bytebikri_test';

const { close, query } = await import('../src/db.js');
const { store } = await import('../src/store.js');
after(async () => { await close(); });

let seq = 0;
/** A store of our own, with as many files as the test needs. */
async function fixture(count = 0) {
  const tag = `${Date.now()}-${++seq}`;
  const user = await store.userByEmailOrCreate(`owner-bulk-${tag}@test.local`);
  const channel = await store.createChannel({ ownerId: user.id, slug: `bulk-${tag}`, name: `Bulk ${tag}` });
  const made = [];
  for (let i = 0; i < count; i += 1) {
    const asset = await store.createAsset({
      channelId: channel.id,
      title: `File ${String.fromCharCode(97 + i)} ${i}`,
      slug: `file-${String.fromCharCode(97 + i)}-${tag}`,
      description: 'x',
      unlockMode: i % 2 ? 'open' : 'ad_gated',
    });
    // createAsset makes a draft; the list the seller sees is everything that is not
    // removed, so make them live the way publishing does.
    await query(`update assets set status = 'live' where id = $1`, [asset.id]);
    made.push(asset);
  }
  return { user, channel, assets: made, tag };
}

async function cleanup(channel, user) {
  await query('delete from asset_bulk_batches where channel_id = $1', [channel.id]);
  await query('delete from assets where channel_id = $1', [channel.id]);
  await query('delete from channels where id = $1', [channel.id]);
  await query('delete from profiles where id = $1', [user.id]);
}

// ── the list ────────────────────────────────────────────────────────────────

test('the list counts what it shows and what it holds, and they are different numbers', async () => {
  const { user, channel, assets } = await fixture(5);
  try {
    await query(`update assets set status = 'paused' where id = $1`, [assets[0].id]);
    await query(`update assets set hidden_by_reports = true where id = $1`, [assets[1].id]);

    const all = await store.sellerFiles(channel.id);
    assert.equal(all.total, 5, 'everything not removed is in the list');
    assert.deepEqual(all.counts, { all: 5, live: 3, paused: 1, hidden: 1 },
      'the chips count the store, not the current view');

    const paused = await store.sellerFiles(channel.id, { state: 'paused' });
    assert.equal(paused.total, 1, '"paused" means paused');
    assert.equal(paused.rows[0].id, assets[0].id);
    assert.equal(paused.counts.all, 5, 'while the store count stays the whole store');

    // Hidden is not a status of its own: it is the platform holding a file, and it
    // cuts across live and paused. A chip called "Hidden" that missed a paused one
    // would be a wrong number rather than a narrow one.
    await query(`update assets set status = 'paused' where id = $1`, [assets[1].id]);
    const hidden = await store.sellerFiles(channel.id, { state: 'hidden' });
    assert.equal(hidden.total, 1, 'a paused-but-hidden file is still hidden');
    assert.equal(hidden.rows[0].status, 'paused');

    const open = await store.sellerFiles(channel.id, { access: 'open' });
    assert.equal(open.total, 2, 'two of the five were made open');
    assert.ok(open.rows.every((r) => r.unlock_mode === 'open'));

    // Search looks at the two things a seller remembers about their own file: what
    // they called it and where it lives.
    const byTitle = await store.sellerFiles(channel.id, { q: 'File c' });
    assert.equal(byTitle.total, 1);
    const bySlug = await store.sellerFiles(channel.id, { q: assets[4].slug.slice(0, 8) });
    assert.equal(bySlug.total, 1, 'and the address works as well as the title');
    const nothing = await store.sellerFiles(channel.id, { q: 'no such file' });
    assert.equal(nothing.total, 0);
    assert.equal(nothing.counts.all, 5, 'an empty result still says how many exist');

    // A search term is matched, never interpolated: the % and _ are the database's.
    const wild = await store.sellerFiles(channel.id, { q: '%' });
    assert.equal(wild.total, 5, 'a percent sign is a character somebody typed, not a wildcard');
  } finally {
    await cleanup(channel, user);
  }
});

test('sorting answers "which file is worth my afternoon", and unknown sorts fall back', async () => {
  const { user, channel, assets } = await fixture(3);
  try {
    await query(`update assets set title = 'Zebra' where id = $1`, [assets[0].id]);
    await query(`update assets set title = 'Apple' where id = $1`, [assets[1].id]);
    await store.applyAssetBulk({ channelId: channel.id, actorId: user.id, action: 'open', ids: [assets[2].id] });

    const byTitle = await store.sellerFiles(channel.id, { sort: 'title' });
    assert.deepEqual(byTitle.rows.map((r) => r.title), ['Apple', 'File c 2', 'Zebra']);
    assert.equal(byTitle.sort, 'title');

    const oldest = await store.sellerFiles(channel.id, { sort: 'oldest' });
    assert.equal(oldest.rows[0].id, assets[0].id, 'the first file made is first');

    // Sorting by unlocks needs the number the row shows, not a second definition of
    // it: one file gets an unlock, and it must come first.
    await query(
      `insert into unlocks (asset_id, channel_id, user_id, method) values ($1, $2, $3, 'manual')`,
      [assets[1].id, channel.id, user.id],
    );
    const byUnlocks = await store.sellerFiles(channel.id, { sort: 'unlocks' });
    assert.equal(byUnlocks.rows[0].id, assets[1].id, 'the file with an unlock sorts above the ones without');

    // A URL somebody typed is not an error and not a filter: it is the default, and
    // the page has to SAY it is the default or the toolbar shows a sort it is not
    // using.
    const nonsense = await store.sellerFiles(channel.id, { sort: 'cheapest', state: 'banana', access: 'free' });
    assert.equal(nonsense.sort, 'newest');
    assert.equal(nonsense.state, 'all');
    assert.equal(nonsense.access, 'all');
    assert.equal(nonsense.total, 3, 'and it filters nothing out');
  } finally {
    await query('delete from unlocks where asset_id = any($1::uuid[])', [assets.map((a) => a.id)]);
    await cleanup(channel, user);
  }
});

test('a long list is paged, and the page says which part of it you are on', async () => {
  const { user, channel } = await fixture(7);
  try {
    const first = await store.sellerFiles(channel.id, { perPage: 5 });
    assert.equal(first.rows.length, 5);
    assert.equal(first.total, 7, 'twenty-five rows would be the whole answer; this is five of seven');
    const second = await store.sellerFiles(channel.id, { perPage: 5, page: 2 });
    assert.equal(second.rows.length, 2);
    const seen = new Set([...first.rows, ...second.rows].map((r) => r.id));
    assert.equal(seen.size, 7, 'and the pages do not overlap or drop a file');

    // A page nobody could read is not a page. Asking for three rows gets five,
    // because the smallest useful page of a table is not three.
    const floor = await store.sellerFiles(channel.id, { perPage: 3 });
    assert.equal(floor.perPage, 5, 'the page size has a floor, and the answer says what it was');

    // The escape hatch has to be able to see the whole answer, including the rows
    // on pages nobody has opened — that is the difference between "select all the
    // files I can see" and "select all the files matching this search".
    const ids = await store.sellerFileIds(channel.id, { perPage: 5 });
    assert.equal(ids.length, 7, 'the id set is the filter, not the page');
    assert.equal(new Set(ids).size, 7);
  } finally {
    await cleanup(channel, user);
  }
});

// ── the bulk change ─────────────────────────────────────────────────────────

test('a bulk change touches exactly the files picked, and writes down what they were', async () => {
  const { user, channel, assets } = await fixture(4);
  try {
    const before = await store.assetById(assets[1].id);
    const out = await store.applyAssetBulk({
      channelId: channel.id, actorId: user.id, action: 'pause', ids: [assets[1].id, assets[2].id],
    });
    assert.equal(out.ok, true);
    assert.equal(out.applied, 2);
    assert.equal(out.unchanged, 0);
    assert.equal(out.skipped, 0);
    assert.equal((await store.assetById(assets[1].id)).status, 'paused');
    assert.equal((await store.assetById(assets[3].id)).status, 'live', 'the unpicked file is untouched');

    const batch = await store.recentAssetBulk(channel.id);
    assert.equal(batch.action, 'pause');
    assert.equal(batch.applied, 2);
    assert.equal(batch.undone_at, null);
    const recorded = batch.before.map((r) => r.id).sort();
    assert.deepEqual(recorded, [assets[1].id, assets[2].id].sort(), 'the ids are in the record');
    assert.equal(batch.before.find((r) => r.id === assets[1].id).status, before.status,
      'with the state each one held, not just which ones changed');
  } finally {
    await cleanup(channel, user);
  }
});

test('another store\u2019s file cannot be reached by posting its id', async () => {
  const mine = await fixture(2);
  const theirs = await fixture(2);
  try {
    const out = await store.applyAssetBulk({
      channelId: mine.channel.id, actorId: mine.user.id, action: 'pause',
      ids: [mine.assets[0].id, theirs.assets[0].id, 'not-a-uuid', theirs.assets[1].id],
    });
    assert.equal(out.applied, 1, 'only the caller\u2019s own file changed');
    assert.equal((await store.assetById(mine.assets[0].id)).status, 'paused');
    assert.equal((await store.assetById(theirs.assets[0].id)).status, 'live', 'the stranger\u2019s file is live');
    assert.equal((await store.assetById(theirs.assets[1].id)).status, 'live');
    // A malformed id is not an error either — it is simply not one of ours.
    assert.equal(out.skipped, 0, 'and ids that match nothing are not reported as held files');
  } finally {
    await cleanup(mine.channel, mine.user);
    await cleanup(theirs.channel, theirs.user);
  }
});

test('a file the platform is holding is counted and left alone', async () => {
  const { user, channel, assets } = await fixture(3);
  try {
    await query(`update assets set hidden_by_reports = true where id = $1`, [assets[0].id]);
    const out = await store.applyAssetBulk({
      channelId: channel.id, actorId: user.id, action: 'pause',
      ids: assets.map((a) => a.id),
    });
    assert.equal(out.applied, 2, 'the two the seller owns change');
    assert.equal(out.skipped, 1, 'and the one we are holding is counted, not dropped');
    const hidden = await store.assetById(assets[0].id);
    assert.equal(hidden.status, 'live', 'its state is not the seller\u2019s to move');
    // A bulk action must not be the way around the rule the single-file form
    // enforces — that lock was added because the old form cleared the flag on save.
    assert.equal(hidden.hidden_by_reports, true, 'and the hold is still there');

    // Nothing left to change: the change is refused with a reason, and nothing is
    // written down, so there is no phantom undo to offer.
    const again = await store.applyAssetBulk({
      channelId: channel.id, actorId: user.id, action: 'pause', ids: [assets[1].id, assets[2].id],
    });
    assert.equal(again.applied, 0);
    assert.equal(again.unchanged, 2, 'already paused is not a change');
    assert.equal(again.batch, null, 'and no batch is recorded for a no-op');
  } finally {
    await cleanup(channel, user);
  }
});

test('a press with nothing usable in it is not reported as "already like that"', async () => {
  const { user, channel, assets } = await fixture(2);
  try {
    // What a form with a stale page in it sends: no ids, or ids that are not ids.
    // The change is a no-op either way, but the SENTENCE has to be true — "every
    // file you picked already says this" tells a seller something false about their
    // own list, and the two are indistinguishable without a count of what arrived.
    const empty = await store.applyAssetBulk({ channelId: channel.id, actorId: user.id, action: 'pause', ids: [] });
    assert.equal(empty.applied, 0);
    assert.equal(empty.picked, 0, 'nothing arrived');
    assert.equal(empty.batch, null);

    const junk = await store.applyAssetBulk({
      channelId: channel.id, actorId: user.id, action: 'pause', ids: ['', 'not-a-uuid', '  '],
    });
    assert.equal(junk.picked, 0, 'and junk is not a file either');

    // The real thing, for contrast: a file that arrived and already says this.
    await query(`update assets set status = 'paused' where id = $1`, [assets[0].id]);
    const unchanged = await store.applyAssetBulk({
      channelId: channel.id, actorId: user.id, action: 'pause', ids: [assets[0].id],
    });
    assert.equal(unchanged.picked, 1, 'this one arrived');
    assert.equal(unchanged.unchanged, 1, 'and had nothing to change to');
    assert.equal(await store.recentAssetBulk(channel.id), null, 'and no batch is written for a no-op');
  } finally {
    await cleanup(channel, user);
  }
});

test('the filter can be the selection, and it is resolved when the button is pressed', async () => {
  const { user, channel, assets } = await fixture(4);
  try {
    await query(`update assets set title = 'Notebook set' where id = $1`, [assets[0].id]);
    await query(`update assets set title = 'Notebook kit' where id = $1`, [assets[1].id]);
    const filter = { q: 'notebook', perPage: 3 };

    const out = await store.applyAssetBulk({ channelId: channel.id, actorId: user.id, action: 'pause', filter });
    assert.equal(out.applied, 2, 'the two matching files, and the page size did not shrink the set');
    assert.equal((await store.assetById(assets[0].id)).status, 'paused');
    assert.equal((await store.assetById(assets[1].id)).status, 'paused');
    assert.equal((await store.assetById(assets[2].id)).status, 'live', 'the ones outside the search are untouched');

    // The batch records what the FILTER resolved to, which is what makes the undo
    // exact even though the browser never named these ids.
    const batch = await store.recentAssetBulk(channel.id);
    assert.deepEqual(batch.before.map((r) => r.id).sort(), [assets[0].id, assets[1].id].sort());
  } finally {
    await cleanup(channel, user);
  }
});

// ── the undo ────────────────────────────────────────────────────────────────

test('the undo restores what changed, and leaves alone what the change never touched', async () => {
  const { user, channel, assets } = await fixture(3);
  try {
    // The selection a seller actually makes: everything they have, without reading
    // that one of them is already in the state they are about to ask for. An undo
    // implemented as "run the opposite action over the same set" would take that
    // file somewhere it has never been; a restore puts the changed ones back and
    // does not touch the rest.
    await query(`update assets set status = 'paused' where id = any($1::uuid[])`, [[assets[0].id, assets[1].id]]);
    const out = await store.applyAssetBulk({
      channelId: channel.id, actorId: user.id, action: 'live', ids: assets.map((a) => a.id),
    });
    assert.equal(out.applied, 2, 'two of the three had something to change to');
    assert.equal(out.unchanged, 1, 'the third was already live');
    assert.equal((await store.assetById(assets[0].id)).status, 'live');

    const batch = await store.recentAssetBulk(channel.id);
    assert.equal(batch.before.length, 2, 'only the changed files are in the record');

    const undone = await store.undoAssetBulk({ batchId: batch.id, channelId: channel.id, actorId: user.id });
    assert.equal(undone.ok, true);
    assert.equal(undone.restored, 2);
    assert.equal((await store.assetById(assets[0].id)).status, 'paused',
      'the files that were paused before come back paused');
    assert.equal((await store.assetById(assets[1].id)).status, 'paused', 'both of them');
    assert.equal((await store.assetById(assets[2].id)).status, 'live', 'and the untouched file is where it was');
    assert.equal(await store.recentAssetBulk(channel.id), null, 'the offer is spent');

    const again = await store.undoAssetBulk({ batchId: batch.id, channelId: channel.id, actorId: user.id });
    assert.equal(again.ok, false);
    assert.equal(again.code, 'already-undone', 'and saying it twice is refused, with a code the page can explain');
  } finally {
    await cleanup(channel, user);
  }
});

test('an undo cannot lift a hold that arrived after the change', async () => {
  const { user, channel, assets } = await fixture(2);
  try {
    await store.applyAssetBulk({ channelId: channel.id, actorId: user.id, action: 'pause', ids: assets.map((a) => a.id) });
    const batch = await store.recentAssetBulk(channel.id);
    // Reports arrive between the change and the change of mind — the platform takes
    // the file, and undoing what the seller did must not overrule that.
    await query(`update assets set hidden_by_reports = true where id = $1`, [assets[0].id]);

    const undone = await store.undoAssetBulk({ batchId: batch.id, channelId: channel.id, actorId: user.id });
    assert.equal(undone.restored, 1);
    assert.equal(undone.skipped, 1, 'the held file is counted as skipped');
    assert.equal((await store.assetById(assets[0].id)).status, 'paused', 'and stays exactly as it was');
    assert.equal((await store.assetById(assets[1].id)).status, 'live', 'while the other one comes back');
  } finally {
    await cleanup(channel, user);
  }
});

test('an undo is offered once, on your own store, inside its window', async () => {
  const mine = await fixture(2);
  const theirs = await fixture(1);
  try {
    await store.applyAssetBulk({ channelId: mine.channel.id, actorId: mine.user.id, action: 'pause', ids: [mine.assets[0].id] });
    const batch = await store.recentAssetBulk(mine.channel.id);

    const foreign = await store.undoAssetBulk({ batchId: batch.id, channelId: theirs.channel.id, actorId: theirs.user.id });
    assert.equal(foreign.ok, false);
    assert.equal(foreign.code, 'no-such-change', 'a batch belonging to another store does not exist here');
    assert.equal((await store.assetById(mine.assets[0].id)).status, 'paused', 'and nothing moved');

    // The window is derived from the row's own timestamp, so ageing the row ages
    // the offer — there is no separate expiry for the two to disagree about.
    await query(`update asset_bulk_batches set created_at = now() - interval '31 minutes' where id = $1`, [batch.id]);
    assert.equal(await store.recentAssetBulk(mine.channel.id), null, 'it is no longer offered');
    const late = await store.undoAssetBulk({ batchId: batch.id, channelId: mine.channel.id, actorId: mine.user.id });
    assert.equal(late.ok, false);
    assert.equal(late.code, 'too-late', 'and the server refuses it even though a page might still link to it');

    const nothing = await store.undoAssetBulk({ batchId: '00000000-0000-4000-8000-000000000000', channelId: mine.channel.id });
    assert.equal(nothing.code, 'no-such-change');
  } finally {
    await cleanup(mine.channel, mine.user);
    await cleanup(theirs.channel, theirs.user);
  }
});

// ── the page ────────────────────────────────────────────────────────────────

// The view reads `connections[0]`, `providers` and the plan usage, so every page
// test starts from the same minimal shape the billing tests use rather than from a
// half-built object that happens to work for one of them.
const PAGE_BASE = {
  channel: { id: 'c1', slug: 'shop', name: 'Shop', owner_id: 'u1', listing_mode: 'storefront', moderation_state: 'approved', ads_enabled: true, tagline: '' },
  user: { id: 'u1', role: 'seller', email: 'seller@example.com', display_name: 'Seller' },
  plan: { code: 'store', name: 'Store', capabilities: {} },
  slots: [], connections: [], providers: [], estimate: {}, pageviews: 0, adViews: [], upgrade: null,
};

test('the page names both sets of ticks, and neither one pretends to be the other', async () => {
  const { dashboard } = await import('../src/views.js');
  const files = {
    q: 'note', state: 'live', access: 'all', sort: 'unlocks',
    total: 9, page: 1, perPage: 3,
    counts: { all: 12, live: 9, paused: 2, hidden: 1 },
    rows: [1, 2, 3].map((n) => ({
      id: `0000000${n}-0000-4000-8000-000000000000`, slug: `f${n}`, title: `File ${n}`,
      status: 'live', unlock_mode: 'ad_gated', hidden_by_reports: false, files: 1, unlocks: 0, views_30d: 0,
    })),
  };
  const html = dashboard({ ...PAGE_BASE, files });

  // All three numbers, on the page: the 3 rows drawn, the 9 the search matched,
  // and the 12 files the store holds. Collapsing any two of them is a lie.
  assert.match(html, /Showing <strong>3 of 9<\/strong> files/, 'the count says what is drawn and what matched');
  assert.match(html, /out of 12 in the store/, 'and how many exist behind the filter');
  assert.match(html, /matching “note”/, 'and quotes the search it applied');
  assert.match(html, /id="pick-page"/, 'there is a control that selects the page');
  assert.match(html, /Select this page <span class="fine">— the 3 files shown above/, 'and it says which three it means');
  assert.match(html, /id="pick-matching"[^>]*data-total="9"/, 'the escape hatch carries the number the SERVER resolved');
  assert.match(html, /Select all <strong>9<\/strong> files matching this search/, 'and names the set it stands for');
  assert.match(html, /including the 6 you cannot see on this page/, 'including the rows on the pages nobody has opened');
  assert.match(html, /name="scope" value="page"/, 'the form posts a scope, and it defaults to the page');
  for (const action of ['pause', 'live', 'ad_gated', 'open']) {
    assert.match(html, new RegExp(`name="action" value="${action}"`), `${action} is a button`);
  }
  assert.match(html, /hidden while reports are answered cannot be changed here/, 'the limit is stated before it is hit');
  // The filter travels with the action, so pressing a button does not silently
  // change the set of files the seller was looking at.
  for (const [name, value] of [['q', 'note'], ['state', 'live'], ['sort', 'unlocks']]) {
    assert.match(html, new RegExp(`name="${name}" value="${value}"`), `${name} is carried in the form`);
  }
});

test('a hidden file shows its state, cannot be ticked, and keeps the way to answer it', async () => {
  const { dashboard } = await import('../src/views.js');
  const hidden = {
    id: '11111111-0000-4000-8000-000000000000', slug: 'held', title: 'Held file',
    status: 'live', unlock_mode: 'ad_gated', hidden_by_reports: true, files: 1, unlocks: 0, views_30d: 0,
  };
  const html = dashboard({
    ...PAGE_BASE,
    files: { q: '', state: 'all', access: 'all', sort: 'newest', total: 1, page: 1, perPage: 25,
      counts: { all: 1, live: 0, paused: 0, hidden: 1 }, rows: [hidden] },
  });
  assert.match(html, /Hidden after reports/, 'the row says who acted');
  assert.match(html, /Your side of it/, 'and links to the answer');
  assert.match(html, /value="11111111-0000-4000-8000-000000000000"\s*\n?\s*aria-label="Select Held file" disabled/,
    'its box is disabled, so it cannot be picked in the first place');
  assert.equal(/name="ids" value="11111111[^>]*disabled/.test(html), true);
});

test('when the filter fits on one page there is one control, not two names for one set', async () => {
  const { dashboard } = await import('../src/views.js');
  const rows = [1, 2].map((n) => ({
    id: `0000000${n}-0000-4000-8000-000000000000`, slug: `f${n}`, title: `File ${n}`,
    status: 'live', unlock_mode: 'ad_gated', hidden_by_reports: false, files: 1, unlocks: 0, views_30d: 0,
  }));
  const html = dashboard({
    ...PAGE_BASE,
    files: { q: '', state: 'all', access: 'all', sort: 'newest', total: 2, page: 1, perPage: 25,
      counts: { all: 2, live: 2, paused: 0, hidden: 0 }, rows },
  });
  assert.match(html, /Select this page/, 'the page control is there');
  assert.equal(/pick-matching/.test(html), false,
    'and there is no second control offering the same two files under a different name');
});

test('the undo strip is on the page, not only in a flash', async () => {
  const { dashboard } = await import('../src/views.js');
  const base = PAGE_BASE;
  const batch = { id: '22222222-0000-4000-8000-000000000000', action: 'pause', applied: 7, skipped: 2, created_at: new Date() };
  // A page with files on it: an undo strip floating above "nothing published yet"
  // would be a page arguing with itself, and that state cannot arise — a bulk change
  // to seven files means seven files.
  const files = {
    q: '', state: 'all', access: 'all', sort: 'newest', total: 7, page: 1, perPage: 25,
    counts: { all: 7, live: 5, paused: 2, hidden: 0 },
    rows: [1, 2].map((n) => ({
      id: `0000000${n}-0000-4000-8000-000000000000`, slug: `f${n}`, title: `File ${n}`,
      status: 'paused', unlock_mode: 'ad_gated', hidden_by_reports: false, files: 1, unlocks: 0, views_30d: 0,
    })),
  };
  const html = dashboard({ ...base, files, recentBulk: batch });
  assert.match(html, /Paused 7 files/, 'what happened, in the page');
  assert.match(html, /2 files hidden after reports were left alone/, 'including what was left alone');
  assert.match(html, /\/dashboard\/shop\/assets\/bulk\/22222222-0000-4000-8000-000000000000\/undo/, 'with a real undo');

  const after = dashboard({ ...base, files, recentBulk: null });
  assert.equal(/\/undo/.test(after), false, 'and nothing to take back means no offer');

  // An undo that only lifted some of the hold is honest about the rest.
  const partial = dashboard({ ...base, files, recentBulk: { ...batch, action: 'live', skipped: 1 } });
  assert.match(partial, /1 file hidden after reports was left alone/);
});

test('the flash for a bulk change is its own key, not the generic "Saved."', () => {
  // The first version redirected with `saved=bulk:…`, and `flashFor` returns the
  // first key it finds — `saved` sits above `bulk` in the map, so a real change
  // reported itself as "Saved." This asserts the shape that was wrong.
  const server = readFileSync(path.join(here, '..', 'server.js'), 'utf8');
  assert.match(server, /back\(`bulk=\$\{action\}:\$\{out\.applied\}:\$\{out\.skipped\}`\)/, 'the change reports itself under its own key');
  assert.match(server, /back\(`undone=\$\{out\.action\}:\$\{out\.restored\}:\$\{out\.skipped\}`\)/, 'and so does the undo');
  assert.equal(/saved=bulk|saved=undone/.test(server), false, 'neither of them is smuggled through `saved`');
  // Both keys exist in the map, and both are builders (they carry counts).
  assert.match(server, /\n  bulk: \(v\) =>/, 'bulk has a builder');
  assert.match(server, /\n  undone: \(v\) =>/, 'undone has a builder');
  // The counts come from the route, never from a form field.
  assert.equal(/req\.body[^;]*filesN/.test(server), false);
});

test('the bulk routes check ownership before they check anything else', () => {
  const server = readFileSync(path.join(here, '..', 'server.js'), 'utf8');
  for (const route of ["APP.post('/dashboard/:slug/assets/bulk'", "APP.post('/dashboard/:slug/assets/bulk/:batchId/undo'"]) {
    const body = server.slice(server.indexOf(route));
    const head = body.slice(0, body.indexOf('catch (err)'));
    assert.match(head, /channel\.owner_id !== req\.user\.id/, `${route} is the seller's own store only`);
    assert.match(head, /refuseWrite\(req, res, channel\)/, 'and a withheld store cannot be edited from here either');
  }
});
