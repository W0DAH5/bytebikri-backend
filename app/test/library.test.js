/**
 * The library: what a person holds, and the stores they watch.  npm test
 *
 * The audit carried "Following a store — absent" from the beginning, and the
 * bigger hole was next to it: this product has unlocks with a WINDOW on them
 * (24 hours by default) and nowhere a person could see one. This file is about
 * the four claims the page makes, in the order they can quietly become false:
 *
 *   1. THE WINDOW IS THE ROUTE'S WINDOW. The shelf says "open" from the same
 *      column the download route checks, so a page that offers a file the route
 *      would refuse cannot be written. An expired row is not open, and a file its
 *      seller paused keeps its row but is not offered.
 *
 *   2. A FOLLOW IS A ROW AND NOTHING ELSE. Following twice is one row, unfollowing
 *      is a delete, and opening a store moves a line only for somebody who already
 *      follows it — browsing cannot subscribe anybody, which is the property that
 *      makes a follow an act rather than a side effect.
 *
 *   3. "NEW" MEANS FINDABLE. The count is files published since this person last
 *      looked AND reachable in search, because a store's first file waits for a
 *      person and counting it would send the reader to a store page to hunt for
 *      something that is not there yet.
 *
 *   4. NOTHING PROMISES A MESSAGE. There is no mail to a buyer in this product, so
 *      the words "email", "notify" and "ping" appear only in the sentence that says
 *      they do not happen. That is asserted, because it is the kind of copy that
 *      gets friendlier one commit at a time.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:55432/bytebikri_test';

const { close, query } = await import('../src/db.js');
const { store } = await import('../src/store.js');
const views = await import('../src/views.js');
after(async () => { await close(); });

let seq = 0;

/** A store with files, and a person who has unlocked some of them. */
async function fixture({ files = 2, approved = true } = {}) {
  const tag = `${Date.now()}-${++seq}`;
  const owner = await store.userByEmailOrCreate(`owner-shelf-${tag}@test.local`);
  const channel = await store.createChannel({ ownerId: owner.id, slug: `shelf-${tag}`, name: `Shelf ${tag}` });
  const buyer = await store.userByEmailOrCreate(`buyer-shelf-${tag}@test.local`);
  const made = [];
  for (let i = 0; i < files; i += 1) {
    const asset = await store.createAsset({
      channelId: channel.id, title: `Shelf file ${i}`, slug: `shelf-file-${i}-${tag}`,
      description: 'x', unlockMode: 'ad_gated',
    });
    await query(`update assets set status = 'live', moderation_state = $2 where id = $1`,
      [asset.id, approved ? 'approved' : 'pending']);
    made.push(asset);
  }
  return { owner, channel, buyer, assets: made, tag };
}

async function cleanup(channel, ...users) {
  await query('delete from follows where channel_id = $1', [channel.id]);
  await query('delete from assets where channel_id = $1', [channel.id]);
  await query('delete from channels where id = $1', [channel.id]);
  for (const u of users) await query('delete from profiles where id = $1', [u.id]);
}

/** The view needs a person, not a session: layout reads a name and a role. */
const asUser = (u) => ({ id: u.id, email: u.email, display_name: u.display_name });

// ── the window ──────────────────────────────────────────────────────────────

test('the shelf reports the window the download route would check', async () => {
  const { owner, channel, buyer, assets } = await fixture({ files: 3 });
  try {
    // One open, one that ran out two days ago, one free with no window at all.
    await store.grantUnlock({ assetId: assets[0].id, channelId: channel.id, userId: buyer.id, policy: { unlock_hours: 24 } });
    const spent = await store.grantUnlock({
      assetId: assets[1].id, channelId: channel.id, userId: buyer.id, policy: { unlock_hours: 24 },
    });
    await query(`update unlocks set expires_at = now() - interval '2 days' where id = $1`, [spent.id]);
    await store.grantUnlock({
      assetId: assets[2].id, channelId: channel.id, userId: buyer.id,
      method: 'open', adsCompleted: 0, policy: { unlock_hours: 0 },
    });

    const rows = await store.myUnlocks(buyer.id);
    assert.equal(rows.length, 3, 'every unlock is on the shelf, ended ones included');
    assert.equal(rows[0].open, true, 'open ones come first');
    assert.equal(rows.find((r) => r.asset_id === assets[1].id).open, false,
      'an expiry in the past is not open — the page and the route answer the same way');
    assert.equal(rows.find((r) => r.asset_id === assets[2].id).expires_at, null,
      'a free file has no window, which is not the same as an expired one');

    const counts = await store.unlockCounts(buyer.id);
    assert.equal(counts.all, 3, 'the headline counts every unlock');
    assert.equal(counts.open, 2, 'and how many can be opened this minute');

    // The row that has run out says so, and the view offers the way back in.
    const html = views.library({ user: asUser(buyer), unlocks: rows, counts, shelf: [] });
    assert.match(html, /Ended/, 'a closed window is named as closed');
    assert.match(html, /Unlock it again/, 'and carries the way to open it again');
    assert.match(html, /No window — free to everyone/, 'a free file says it has no window');
  } finally {
    await cleanup(channel, owner, buyer);
  }
});

test('a file its seller paused keeps its row and loses its offer', async () => {
  const { owner, channel, buyer, assets } = await fixture({ files: 1 });
  try {
    await store.grantUnlock({ assetId: assets[0].id, channelId: channel.id, userId: buyer.id, policy: { unlock_hours: 24 } });
    await store.updateAsset(assets[0].id, { status: 'paused' });

    const rows = await store.myUnlocks(buyer.id);
    assert.equal(rows.length, 1, 'the unlock happened; the shelf does not pretend it did not');
    assert.equal(rows[0].open, true, 'the window is still open…');
    assert.equal(rows[0].asset_status, 'paused', '…and the file is not');

    const html = views.library({ user: asUser(buyer), unlocks: rows, counts: { all: 1, open: 1 }, shelf: [] });
    assert.match(html, /File taken down/, 'the row says which of the two facts changed');
    assert.match(html, /Your unlock is still recorded/);
    assert.doesNotMatch(html, /<a href="\/s\/[^"]*">Shelf file 0<\/a>/,
      'a file that is down is named, not linked to a page that would refuse the reader');
  } finally {
    await cleanup(channel, owner, buyer);
  }
});

// ── the follow ──────────────────────────────────────────────────────────────

test('following twice is one row, and unfollowing is a delete', async () => {
  const { owner, channel, buyer } = await fixture({ files: 1 });
  try {
    const first = await store.followChannel(buyer.id, channel.id);
    const second = await store.followChannel(buyer.id, channel.id);
    const rows = await query('select * from follows where profile_id = $1 and channel_id = $2', [buyer.id, channel.id]);
    assert.equal(rows.rowCount, 1, 'a double press is not two follows');
    assert.equal(second.created_at.getTime(), first.created_at.getTime(),
      'and it does not restart the clock on when this person started watching');

    assert.equal(await store.markChannelSeen(buyer.id, channel.id), true, 'a follower\'s line moves');
    assert.equal(await store.unfollowChannel(buyer.id, channel.id), true);
    assert.equal(await store.followState(buyer.id, channel.id), null, 'unfollowing leaves nothing behind');
    assert.equal(await store.unfollowChannel(buyer.id, channel.id), false, 'and pressing it twice is not an error');
  } finally {
    await cleanup(channel, owner, buyer);
  }
});

test('a visit moves the line only for somebody who already follows', async () => {
  const { owner, channel, buyer, assets } = await fixture({ files: 1 });
  try {
    assert.equal(await store.markChannelSeen(buyer.id, channel.id), false,
      'browsing a store cannot subscribe anybody');
    assert.equal((await query('select * from follows where channel_id = $1', [channel.id])).rowCount, 0,
      'and it writes no row at all');

    await store.followChannel(buyer.id, channel.id);
    // The line is moved back to a known point rather than read immediately after the
    // follow wrote it. `followChannel` and `markChannelSeen` are two database calls and
    // can land inside the same clock tick, so a strict `after > before` measured between
    // them is a test that fails on a fast machine — which is exactly what it did, once,
    // in a full parallel run, and not in eight consecutive runs of this file alone. The
    // claim being checked is that opening the store moves the line, and a line an hour
    // old is the honest way to check it.
    await query(`update follows set seen_at = now() - interval '1 hour' where profile_id = $1 and channel_id = $2`,
      [buyer.id, channel.id]);
    const before = (await store.followState(buyer.id, channel.id)).seen_at;
    await store.markChannelSeen(buyer.id, channel.id);
    const after = (await store.followState(buyer.id, channel.id)).seen_at;
    assert.ok(after > before, 'following puts the store on the shelf; opening it moves the line');
    assert.ok(Date.parse(after) > Date.now() - 60_000, 'and it moves it to now, not by a token amount');

    // Time is the only thing that makes a file "new", so the fixture moves the
    // line back rather than pretending a new file appeared.
    await query(`update follows set seen_at = now() - interval '1 day' where profile_id = $1 and channel_id = $2`,
      [buyer.id, channel.id]);
    const shelf = await store.followedChannels(buyer.id);
    assert.equal(shelf.length, 1, 'the shelf holds the store');
    assert.equal(shelf[0].new_count, 1, 'a file published after the line is new');
    assert.equal(shelf[0].live_count, 1, "and the store's own count is a different number");
    assert.equal(shelf[0].slug, channel.slug, 'the shelf is rendered from the channel, not from an id');
    void assets;
  } finally {
    await cleanup(channel, owner, buyer);
  }
});

test('a new file the seller has already paused is not news either', async () => {
  // The card prints the store's live count on the same line as "N new files", so
  // the two have to mean the same thing. A paused file is not on the storefront.
  const { owner, channel, buyer, assets } = await fixture({ files: 2 });
  try {
    await store.followChannel(buyer.id, channel.id);
    await query(`update follows set seen_at = now() - interval '1 day' where profile_id = $1 and channel_id = $2`,
      [buyer.id, channel.id]);
    await store.updateAsset(assets[0].id, { status: 'paused' });

    const card = (await store.followedChannels(buyer.id))[0];
    assert.equal(card.new_count, 1, 'only the file a reader can actually open is counted');
    assert.equal(card.live_count, 1, 'and the line under it agrees');
  } finally {
    await cleanup(channel, owner, buyer);
  }
});

test('a file nobody can find yet is not announced as new', async () => {
  // A store's first file waits for a person before it joins search (the itch.io
  // rule). Counting it would send the reader to a store page to look for
  // something that is not there.
  const { owner, channel, buyer } = await fixture({ files: 1, approved: false });
  try {
    await store.followChannel(buyer.id, channel.id);
    await query(`update follows set seen_at = now() - interval '1 day' where profile_id = $1 and channel_id = $2`,
      [buyer.id, channel.id]);

    assert.equal((await store.followedChannels(buyer.id))[0].new_count, 0, 'waiting for review is not news');

    await query(`update assets set moderation_state = 'approved' where channel_id = $1`, [channel.id]);
    assert.equal((await store.followedChannels(buyer.id))[0].new_count, 1,
      'the moment it can be found, it is new — no second write needed');
  } finally {
    await cleanup(channel, owner, buyer);
  }
});

test('the shelf is ordered by when the person chose it', async () => {
  const a = await fixture({ files: 1 });
  const b = await fixture({ files: 1 });
  const buyer = await store.userByEmailOrCreate(`buyer-order-${Date.now()}@test.local`);
  try {
    await store.followChannel(buyer.id, a.channel.id);
    await query(`update follows set created_at = now() - interval '3 days' where profile_id = $1 and channel_id = $2`,
      [buyer.id, a.channel.id]);
    await store.followChannel(buyer.id, b.channel.id);

    const shelf = await store.followedChannels(buyer.id);
    assert.deepEqual(shelf.map((s) => s.slug), [b.channel.slug, a.channel.slug],
      'the store followed most recently is the one at the top');
  } finally {
    await cleanup(a.channel, a.owner);
    await cleanup(b.channel, b.owner);
    await query('delete from profiles where id = $1', [buyer.id]);
  }
});

// ── the page ────────────────────────────────────────────────────────────────

test('the counts on the page come from the account, not from the rows drawn', async () => {
  const { owner, channel, buyer, assets } = await fixture({ files: 6 });
  try {
    for (const a of assets) {
      await store.grantUnlock({ assetId: a.id, channelId: channel.id, userId: buyer.id, policy: { unlock_hours: 24 } });
    }
    const all = await store.myUnlocks(buyer.id);
    const counts = await store.unlockCounts(buyer.id);
    // The page is given two rows and the true totals: a cap on how many rows are
    // drawn must never read as files that went missing.
    const html = views.library({ user: asUser(buyer), unlocks: all.slice(0, 2), counts, shelf: [] });
    assert.match(html, /6 files open to you right now/, 'the headline is the account\'s number');
    assert.match(html, /Showing the 2 most recent of your 6 unlocks/, 'and the page says it is showing part of them');
  } finally {
    await cleanup(channel, owner, buyer);
  }
});

test('nothing on the page promises a message, and it says so twice', async () => {
  const { owner, channel, buyer, assets } = await fixture({ files: 1 });
  try {
    await store.grantUnlock({ assetId: assets[0].id, channelId: channel.id, userId: buyer.id, policy: { unlock_hours: 24 } });
    await store.followChannel(buyer.id, channel.id);
    const html = views.library({
      user: asUser(buyer),
      unlocks: await store.myUnlocks(buyer.id),
      counts: await store.unlockCounts(buyer.id),
      shelf: await store.followedChannels(buyer.id),
    });
    assert.match(html, /does not email\s+or ping you/, 'the promise is stated where the follows are');
    for (const promise of ['we will email', 'we\'ll email', 'we will notify', 'you will be notified', 'we will ping']) {
      assert.ok(!html.toLowerCase().includes(promise), `the page must not promise: ${promise}`);
    }
    // The money claim is on this page too, and it is the platform's own rule.
    assert.match(html, /bytebikri takes no cut of it/, 'the buyer is told where the money goes');
    assert.match(html, /Nothing here has a price/, 'and that a file is not sold to them');
  } finally {
    await cleanup(channel, owner, buyer);
  }
});

test('an empty shelf explains itself instead of showing holes', async () => {
  const { owner, channel, buyer } = await fixture({ files: 0 });
  try {
    const html = views.library({ user: asUser(buyer), unlocks: [], counts: { all: 0, open: 0 }, shelf: [] });
    assert.match(html, /You have not unlocked anything yet/);
    assert.match(html, /href="\/marketplace"/, 'and points at the place where unlocking starts');
    assert.match(html, /You are not following any store yet/);
    assert.doesNotMatch(html, /Ended<\/h2>/, 'a section with nothing in it is not rendered at all');
  } finally {
    await cleanup(channel, owner, buyer);
  }
});

test('the way back after unfollowing is offered, and what it echoes is escaped', async () => {
  const { owner, channel, buyer } = await fixture({ files: 1 });
  try {
    const html = views.library({
      user: asUser(buyer), unlocks: [], counts: { all: 0, open: 0 }, shelf: [],
      unwatched: '"><script>alert(1)</script>',
    });
    assert.ok(!html.includes('<script>alert(1)</script>'), 'a query parameter is never echoed raw');
    assert.match(html, /is off your shelf/);
    assert.match(html, /Follow it again/, 'removing something offers the way back');

    const missing = views.library({ user: asUser(buyer), unlocks: [], counts: {}, shelf: [], error: 'no-store' });
    assert.match(missing, /That store is not here/);
    assert.match(missing, /Nothing changed on your shelf/);
  } finally {
    await cleanup(channel, owner, buyer);
  }
});

test('the harness can reach every page this round added, and the storefront shows the way in', async () => {
  // A page nobody checks is a page that breaks quietly (§17's lesson). The check
  // is text, not a browser — the browser run is `ci/eyes/sweep.mjs` — but it fails
  // here, in the suite, the moment somebody adds a route and forgets the harness.
  const { readFileSync } = await import('node:fs');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const here = path.dirname(fileURLToPath(import.meta.url));
  const pages = readFileSync(path.join(here, '../../ci/eyes/pages.mjs'), 'utf8');
  assert.match(pages, /'\/library', '/, 'the library is in the sweep');
  assert.match(pages, /operator: \[[^\]]*'\/library'/, 'and on the account that is only ever a buyer');

  // The storefront offers the follow control, and the sentence under it never
  // promises a message — the same rule the library page is held to.
  const store = views.storefront({
    channel: { id: 'c1', slug: 's', name: 'Store', owner_id: 'someone-else', listing_mode: 'storefront' },
    assets: [], slots: [], user: { id: 'me', email: 'me@x', display_name: 'Me' },
    estimate: null, pageviews: 0, unlockedIds: new Set(),
  });
  assert.match(store, /Follow this store/, 'a buyer gets the button');
  assert.match(store, /Nothing is emailed/);
  assert.ok(!/we will (email|notify|ping)/i.test(store));

  // The owner of the store sees neither the button nor a dashboard link that is
  // not theirs; the nav link for the owner is the store they are looking at.
  const mine = views.storefront({
    channel: { id: 'c1', slug: 's', name: 'Store', owner_id: 'me', listing_mode: 'storefront' },
    assets: [], slots: [], user: { id: 'me', email: 'me@x', display_name: 'Me' },
    estimate: null, pageviews: 0, unlockedIds: new Set(),
  });
  assert.doesNotMatch(mine, /Follow this store/, 'you do not follow your own shop');
  const anon = views.storefront({
    channel: { id: 'c1', slug: 's', name: 'Store', owner_id: 'someone-else', listing_mode: 'storefront' },
    assets: [], slots: [], user: null, estimate: null, pageviews: 0,
  });
  assert.doesNotMatch(anon, /Follow this store/, 'a signed-out visitor is not sold a button that cannot work');
  assert.doesNotMatch(anon, /href="\/library"/, 'and is not shown a shelf they do not have');
});
