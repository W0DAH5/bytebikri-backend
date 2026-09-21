/**
 * The Explore rails: earned versus bought.  npm test
 *
 * A marketplace front page has two ways to order itself and this is where the
 * product states which is which. Two rails, two different questions:
 *
 *   Popular — what did people actually do here over thirty days? It reads
 *             traffic, unlocks and how much there is to unlock. Nothing else.
 *   Featured — who bought the placement? Pro plan only, and labelled as
 *             placement everywhere it appears.
 *
 * The failure this file exists to catch is the quiet one: a rail that says
 * "Popular" while sorting on a plan flag. That would be a paid ranking wearing
 * the word "earned", and no test in the suite would notice it, because every
 * individual function would still return an array of stores.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

const {
  WEIGHTS, POPULAR_FLOOR, attentionScore, popular, featured, newest, exploreRails,
} = await import('../src/ranking.js');

const NOW = '2026-09-21T00:00:00Z';
const ch = (id, extra = {}) => ({
  id, slug: id, name: id.toUpperCase(), tagline: null,
  created_at: extra.created_at || NOW, listing_mode: 'marketplace', ...extra,
});
const stats = (o) => o;

// ---------------------------------------------------------------------------
// The score
// ---------------------------------------------------------------------------

test('attention is traffic plus attention that cost something, and nothing else', () => {
  assert.deepEqual(WEIGHTS, { views: 1, unlocks: 8, items: 3 });
  assert.equal(attentionScore({ views30d: 100, unlocks30d: 0, items: 0 }), 100);
  assert.equal(attentionScore({ views30d: 0, unlocks30d: 10, items: 0 }), 80);
  assert.equal(attentionScore({ views30d: 10, unlocks30d: 2, items: 5 }), 41);
  // An unlock outweighs a pageview, and the number is not decoration: an unlock
  // cost the viewer a rewarded ad.
  assert.ok(WEIGHTS.unlocks > WEIGHTS.views);
});

test('a missing or nonsense figure is zero, never NaN', () => {
  const cases = [{}, undefined, { views30d: null }, { views30d: 'x' }, { views30d: -5 }];
  for (const c of cases) {
    const n = attentionScore(c);
    assert.ok(Number.isFinite(n), `attentionScore(${JSON.stringify(c)}) must be a finite number`);
    assert.ok(n >= 0, 'and never negative — a store cannot owe attention');
  }
});

// ---------------------------------------------------------------------------
// Popular: earned, and only earned
// ---------------------------------------------------------------------------

const CH = [ch('solo'), ch('quiet'), ch('busy'), ch('rich'), ch('mid')];
const STATS = {
  solo: stats({ views_30d: 12, unlocks_30d: 9, items: 4 }),   // 12 + 72 + 12 = 96 — below the floor
  quiet: stats({ views_30d: 0, unlocks_30d: 0, items: 1 }),   // nothing at all
  busy: stats({ views_30d: 300, unlocks_30d: 1, items: 2 }),  // 300 + 8 + 6 = 314
  rich: stats({ views_30d: 40, unlocks_30d: 0, items: 1 }),   // 40 + 0 + 3 = 43
  mid: stats({ views_30d: 120, unlocks_30d: 3, items: 3 }),   // 120 + 24 + 9 = 153
};

test('a store with no traffic is not popular, however many unlocks it has', () => {
  const names = popular(CH, STATS).map((e) => e.channel.id);
  assert.ok(!names.includes('solo'), 'below the floor is noise, not popularity');
  assert.ok(!names.includes('quiet'), 'and nothing at all is definitely not popular');
  assert.equal(POPULAR_FLOOR.views, 20, 'the floor is a stated number, not a hidden one');
});

test('popular sorts on evidence, ties deterministically, and can say why', () => {
  const rail = popular(CH, STATS);
  assert.deepEqual(rail.map((e) => e.channel.id), ['busy', 'mid', 'rich']);
  assert.deepEqual(rail.map((e) => e.rank), [1, 2, 3], 'rank is a position, so it counts from one');
  assert.equal(rail[0].score, 314);
  assert.match(rail[0].why, /300 views and 1 unlock in thirty days/);

  // Two stores with identical evidence must not swap places between requests:
  // a front page that reshuffles looks broken.
  const tie = [ch('aaa'), ch('bbb')];
  const same = { aaa: stats({ views_30d: 50 }), bbb: stats({ views_30d: 50 }) };
  assert.deepEqual(
    popular(tie, same).map((e) => e.channel.id),
    popular([...tie].reverse(), same).map((e) => e.channel.id),
  );
});

test('popular cannot read a plan, so a paid store cannot buy its way up', () => {
  // The Pro store has the flag that buys placement. It has no traffic. It does
  // not appear in the earned rail, and it does not appear with a better rank
  // than a free store that does.
  const pro = ch('prostore', { plan_code: 'pro', subscription_status: 'active', featured_eligible: true });
  const free = ch('freestore', { plan_code: 'free' });
  const st = { prostore: stats({ views_30d: 0, items: 0 }), freestore: stats({ views_30d: 500, items: 2 }) };
  const rail = popular([pro, free], st);
  assert.equal(rail.length, 1);
  assert.equal(rail[0].channel.id, 'freestore');

  // The only thing that can outrank a free store is evidence. A paid store with
  // more evidence does — and that is correct, because the ranking read the
  // evidence, not the plan.
  const st2 = { ...st, prostore: stats({ views_30d: 900, items: 9 }) };
  assert.equal(popular([pro, free], st2)[0].channel.id, 'prostore');
});

// ---------------------------------------------------------------------------
// Featured: bought, and said to be bought
// ---------------------------------------------------------------------------

test('featured contains only what the caller allows, and labels itself paid', () => {
  const canFeature = (c) => c.plan_code === 'pro';
  const pro = ch('prostore', { plan_code: 'pro' });
  const free = ch('freestore', { plan_code: 'free' });
  const st = { prostore: stats({ views_30d: 5 }), freestore: stats({ views_30d: 900 }) };

  const rail = featured([pro, free], st, canFeature);
  assert.deepEqual(rail.map((e) => e.channel.id), ['prostore'],
    'a bigger free store does not appear in the paid rail — it did not buy it');
  assert.match(rail[0].why, /Featured placement/);
  assert.match(rail[0].why, /Pro plan/);
  assert.ok(!/rank|popular|earned/i.test(rail[0].why), 'the paid rail never borrows the earned rail\'s word');
});

test('with nobody eligible, the paid rail is empty rather than a shelf with nothing on it', () => {
  assert.deepEqual(featured(CH, STATS, () => false), []);
});

// ---------------------------------------------------------------------------
// Newest
// ---------------------------------------------------------------------------

test('newest is by date, and says something true about a store with no files', () => {
  const list = [
    ch('old', { created_at: '2026-01-01T00:00:00Z' }),
    ch('new', { created_at: '2026-09-01T00:00:00Z' }),
    ch('bare', { created_at: '2026-08-01T00:00:00Z' }),
  ];
  const st = { old: stats({ items: 3 }), new: stats({ items: 1 }), bare: stats({ items: 0 }) };
  const rail = newest(list, st);
  assert.deepEqual(rail.map((e) => e.channel.id), ['new', 'bare', 'old']);
  assert.equal(rail[0].why, '1 file so far', 'a single file is not "1 files"');
  assert.equal(rail[2].why, '3 files so far');
  assert.equal(rail[1].why, 'Just opened');
});

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------

test('the rails are disjoint, and the earned one keeps a store that also bought placement', () => {
  const canFeature = (c) => c.plan_code === 'pro';
  const star = ch('star', { plan_code: 'free' });
  const mid = ch('mid', { plan_code: 'free' });
  const pro = ch('prostore', { plan_code: 'pro' });
  const tiny = ch('tiny', { plan_code: 'free' });
  const st = {
    star: stats({ views_30d: 800, unlocks_30d: 4, items: 6 }),
    mid: stats({ views_30d: 150, unlocks_30d: 1, items: 2 }),
    prostore: stats({ views_30d: 5, items: 1 }),
    tiny: stats({ views_30d: 1, items: 0 }),
  };

  const { rails, rest } = exploreRails({ channels: [star, mid, pro, tiny], stats: st, canFeature });
  const ids = rails.flatMap((r) => r.entries.map((e) => e.channel.id));
  assert.equal(new Set(ids).size, ids.length, 'no store appears on the page twice');
  assert.deepEqual(rails.map((r) => r.key), ['popular', 'featured', 'new']);
  assert.deepEqual(rails[0].entries.map((e) => e.channel.id), ['star', 'mid']);
  assert.deepEqual(rails[1].entries.map((e) => e.channel.id), ['prostore'],
    'the paid rail holds the store that has to buy attention, and only that one');
  assert.equal(rails[1].entries[0].alsoPlaced, undefined);
  assert.deepEqual(rest, [], 'every store was placed somewhere on this page');

  // A store that both earns and buys appears once, in the earned rail, marked.
  const both = exploreRails({
    channels: [star], stats: { star: stats({ views_30d: 300, items: 2 }) },
    canFeature: () => true,
  });
  assert.deepEqual(both.rails.map((r) => r.key), ['popular'], 'no second card for a store already shown');
  assert.equal(both.rails[0].entries[0].alsoPlaced, true, 'and the placement is not swallowed silently');

  // With no eligible store there is no "Featured" heading over an empty row.
  const quiet = exploreRails({
    channels: [star], stats: { star: stats({ views_30d: 1 }) }, canFeature: () => false,
  });
  assert.deepEqual(quiet.rails.map((r) => r.key), ['new'], 'only the rail that has something in it');
});

test('every rail states what its ordering means, and the earned rail comes first', () => {
  const canFeature = (c) => c.plan_code === 'pro';
  const pro = ch('prostore', { plan_code: 'pro' });
  const star = ch('star', { plan_code: 'free' });
  const { rails } = exploreRails({
    channels: [pro, star],
    stats: { prostore: stats({ views_30d: 4, items: 1 }), star: stats({ views_30d: 600, unlocks_30d: 2, items: 4 }) },
    canFeature,
  });
  const byKey = Object.fromEntries(rails.map((r) => [r.key, r]));
  assert.deepEqual(rails.map((r) => r.key).slice(0, 2), ['popular', 'featured'],
    'what people did leads; what money bought follows it');
  assert.match(byKey.popular.note, /Earned, not bought/);
  assert.match(byKey.popular.note, /traffic and unlocks/);
  assert.match(byKey.featured.note, /Paid placement/);
  assert.match(byKey.featured.note, /no effect on the ranking above/);
});

// ---------------------------------------------------------------------------
// The rendered page
// ---------------------------------------------------------------------------

const { marketplace } = await import('../src/views.js');

const star = ch('star', { tagline: 'Templates that do the boring part' });
const billed = ch('billed', { tagline: 'A paid position, said out loud' });

const page = marketplace({
  channels: [star, billed],
  user: null,
  explore: exploreRails({
    channels: [star, billed],
    stats: { star: stats({ views_30d: 240, unlocks_30d: 3, items: 2 }), billed: stats({ views_30d: 2 }) },
    canFeature: (c) => c.id === 'billed',
  }),
});

test('the page shows the earned label with the reason, not just a position', () => {
  assert.match(page, /Popular this week/);
  assert.match(page, /240 views and 3 unlocks in thirty days/, 'a visitor can check the claim');
  assert.match(page, />Earned</);
});

test('the page labels the bought position as bought, and puts it after the earned one', () => {
  assert.match(page, /Featured/);
  assert.match(page, /Paid placement/);
  assert.match(page, /Featured placement — part of the Pro plan/);
  assert.ok(page.indexOf('Popular this week') < page.indexOf('>Featured<'),
    'the earned rail renders first — that order is the product statement');
  assert.match(page, /no effect on the ranking above/);
});

test('the page keeps the full directory below the rails', () => {
  assert.match(page, /All listed stores/);
  assert.match(page, /Listing here is a choice a creator makes/);
});

// ---------------------------------------------------------------------------
// The query behind it
// ---------------------------------------------------------------------------

process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:55432/bytebikri_test';
const { store } = await import('../src/store.js');
const { query, close } = await import('../src/db.js');
const { after } = await import('node:test');
after(async () => { await close(); });

test('channelStats answers for every store in one query, zeros included', async () => {
  const tag = `${Date.now()}-rank`;
  const user = await store.userByEmailOrCreate(`rank-${tag}@test.local`);
  const ch1 = await store.createChannel({ ownerId: user.id, slug: `rank-${tag}`, name: 'Ranked' });

  const rows = await store.channelStats({ days: 30 });
  const mine = rows.find((r) => r.channel_id === ch1.id);
  assert.ok(mine, 'a brand-new store still gets a row — a store missing from the page is a store nobody can find');
  assert.equal(mine.views_30d, 0);
  assert.equal(mine.unlocks_30d, 0);
  assert.equal(mine.items, 0);

  // A view lands, and the rail can see it.
  await query(
    `insert into page_view_daily (channel_id, day, views, web_views, unique_visitors)
     values ($1, current_date, 40, 40, 12) on conflict do nothing`,
    [ch1.id],
  );
  const after_ = (await store.channelStats({ days: 30 })).find((r) => r.channel_id === ch1.id);
  assert.equal(after_.views_30d, 40);
  assert.ok(attentionScore({ views30d: after_.views_30d }) >= POPULAR_FLOOR.views,
    'and forty views across the floor is what makes a store eligible for the earned rail');
});
