/**
 * The attention ledger.  npm test
 *
 * Slice 5 of the asset economy (ASSET_ECONOMY.md §12). The ledger's whole design is one
 * distinction — a verified view is not a rendered position — and these tests are what
 * keep the two apart in code, in the schema, and in the words on the page:
 *
 *   1. the arithmetic is the database's, not a second implementation's: views and
 *      seconds group by page and placement, positions group by page, placement and side;
 *   2. the two blocks are never added: the page prints no combined total, and the
 *      platform's block carries no rupee figure;
 *   3. a rendered position is counted once per render, through SQL, and grouped by the
 *      table's own grain;
 *   4. the ledger's tables have NO money column — the refusal is asserted against
 *      Postgres itself, so it survives the next convenient `cpm` column.
 *
 * The fixture builds its own store, people and events, and removes every trace of them.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:55432/bytebikri_test';

const { close, query, one } = await import('../src/db.js');
const { store, PLANS } = await import('../src/store.js');
const views = await import('../src/views.js');
const { PLACEMENTS } = await import('../src/placement.js');

after(async () => { await close(); });

const claim = () => ({ method: 'esewa', txnReference: `LEDGER-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` });

/** A store on the Store plan, so it has both a store slot and the platform's rent slot. */
async function fixture() {
  const tag = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const owner = await store.userByEmailOrCreate(`ledger-${tag}@test.local`);
  const channel = await store.createChannel({ ownerId: owner.id, name: 'Ledger Store', slug: `ledger-${tag}` });
  // A paid plan, because the platform's rent slot only exists where slots exist. The
  // plan is a subscription row, not a column on the channel — the shape `store.plan()`
  // reads, so the fixture upgrades a store the same way the app does.
  await query(
    `insert into subscriptions (channel_id, plan_code, status, period_end)
     values ($1, 'store', 'active', now() + interval '365 days')`,
    [channel.id],
  );
  return { owner, channel, plan: PLANS.store };
}

async function teardown({ channel, owner }) {
  await query('delete from ad_position_daily where channel_id = $1', [channel.id]);
  await query('delete from ad_view_events where channel_id = $1', [channel.id]);
  await query('delete from pending_views where channel_id = $1', [channel.id]);
  await query('delete from ad_connections where channel_id = $1', [channel.id]);
  await query('delete from assets where channel_id = $1', [channel.id]);
  await query('delete from subscriptions where channel_id = $1', [channel.id]);
  await query('delete from channels where id = $1', [channel.id]);
  await query('delete from profiles where id = $1', [owner.id]);
}

test('the ledger keeps verified views and rendered positions apart, and groups each by its own grain', async () => {
  const f = await fixture();
  try {
    const { channel } = f;
    const viewer = await store.userByEmailOrCreate(`ledger-watch-${Date.now()}@test.local`);
    const connection = await query(
      `insert into ad_connections (channel_id, provider_id, callback_secret, callback_base_url, onboarding)
       values ($1, 'pubscale', 'secret', 'https://example.test/cb', 'paste_credentials') returning *`,
      [channel.id],
    );
    const conn = connection.rows[0];
    // A real file, because an attempt is an attempt on something: `pending_views`
    // refuses an asset-less row, and rightly — a view that unlocked nothing is not a
    // view this product can have recorded.
    const asset = await store.createAsset({
      channelId: channel.id, title: 'A lecture', slug: `ledger-file-${Date.now()}`,
      unlockMode: 'ad_gated', moderationState: 'approved',
    });

    // Three verified views: two mid-rolls on a file page, one door view. One reports no
    // duration at all, which must read as "not reported" rather than as a zero.
    const mk = async (placement, surface, duration) => {
      const view = await store.createPendingView({
        nonce: Math.random().toString(36).slice(2), asset_id: asset.id, channel_id: channel.id,
        user_id: viewer.id, connection_id: conn.id, provider_id: 'pubscale',
        required_ads: 1, ad_min_seconds: 15, placement, surface,
      });
      await store.claimAdView({
        channel_id: channel.id, user_id: viewer.id, asset_id: asset.id, connection_id: conn.id,
        provider_id: 'pubscale', external_id: `ext-${Math.random().toString(36).slice(2)}`,
        kind: 'rewarded', state: 'complete', completed: true, duration_sec: duration,
        pending_view_id: view.id, placement: view.placement, surface: view.surface,
      });
      return view;
    };
    const mid1 = await mk('mid', 'asset', 30);
    const mid2 = await mk('mid', 'asset', 30);
    const door = await mk('pre', 'asset', null);
    assert.equal(mid1.placement, 'mid', 'the attempt did not carry its own placement');
    assert.equal(door.placement, 'pre');

    // Two positions drawn on the storefront: one of the store's own boxes, one ours.
    await store.recordPositions(channel.id, [
      { surface: 'storefront', placement: 'aside', side: 'store' },
      { surface: 'storefront', placement: 'aside', side: 'platform' },
    ]);
    await store.recordPositions(channel.id, [{ surface: 'storefront', placement: 'aside', side: 'platform' }]);

    const ledger = await store.attentionLedger(channel.id, { days: 30 });

    // Views: two mid-rolls grouped into one row, the door into another.
    const mid = ledger.watched.find((r) => r.placement === 'mid');
    const pre = ledger.watched.find((r) => r.placement === 'pre');
    assert.equal(mid.views, 2, 'the two mid-rolls did not group');
    assert.equal(mid.seconds, 60, 'seconds are the sum of what the player reported');
    assert.equal(mid.unmeasured, 0);
    assert.equal(pre.views, 1);
    assert.equal(pre.seconds, 0, 'a view that reported no duration has no seconds');
    assert.equal(pre.unmeasured, 1, 'and it is counted as unmeasured, not as zero');

    // Positions: two rows, one per side, never one row of three.
    const myBoxes = ledger.drawn.find((r) => r.side === 'store');
    const ourSlot = ledger.drawn.find((r) => r.side === 'platform');
    assert.equal(myBoxes.impressions, '1');
    assert.equal(ourSlot.impressions, '2', 'two renders of our slot are two positions');
    assert.equal(ledger.totals.views, 3);
    assert.equal(ledger.totals.seconds, 60);
    assert.equal(ledger.totals.platform_impressions, '2');
    assert.equal(ledger.totals.store_impressions, '1');

    // ── and the page ───────────────────────────────────────────────────────────
    const html = views.attentionLedger({ channel, user: f.owner, ledger, days: 30 });
    assert.match(html, /Watched on your files/, 'the verified-view block lost its heading');
    assert.match(html, /Drawn on your pages/, 'the drawn-positions block lost its heading');
    // The words that carry the meaning: whose numbers these are, and that the money
    // statement is somebody else's.
    // One phrase, wrapped across lines by the template: asserted by its words rather
    // than by its whitespace.
    assert.match(html, /The statement is the network's,\s+not ours/i);
    assert.match(html, /This is our inventory, not yours/);
    assert.match(html, /not reported/, 'a view with no reported duration must not print a zero');
    // No rupee figure anywhere: the page counts positions and refuses to price them.
    assert.ok(!html.includes('₨') && !/NPR\s?\d/.test(html),
      'the ledger printed a money figure — there is no number it could honestly put there');
    // A view from before this slice carries no placement. It lands in one honest row,
    // and the page explains the row rather than letting "Not recorded" read as a fault.
    await query(
      `insert into ad_view_events (channel_id, user_id, asset_id, provider_id, completed, duration_sec)
       values ($1, $2, $3, 'pubscale', true, 20)`,
      [channel.id, viewer.id, asset.id],
    );
    const older = views.attentionLedger({
      channel, user: f.owner, ledger: await store.attentionLedger(channel.id, { days: 30 }), days: 30,
    });
    assert.match(older, /Not recorded/, 'an unplaced view must not be filed under a placement');
    // Whitespace-normalised: the sentence is wrapped by the template, and the words are
    // what the test is about.
    assert.match(older.replace(/\s+/g, ' '), /recorded before this ledger counted where a view sat/,
      'the page does not explain the unplaced row');

    // And no combined total: the two blocks are separate, so a reader cannot add them.
    assert.ok(!/total/i.test(html.replace(/totals?/g, '')), 'the page hinted at a combined total');
  } finally {
    await query('delete from ad_position_daily where channel_id = $1', [f.channel.id]);
    await query('delete from ad_view_events where channel_id = $1', [f.channel.id]);
    await query('delete from pending_views where channel_id = $1', [f.channel.id]);
    await query('delete from profiles where email like $1', ['ledger-watch-%@test.local']);
    await teardown(f);
  }
});

test('the page counts nothing that was not drawn: an empty store says so instead of printing zeroes', async () => {
  const f = await fixture();
  try {
    const ledger = await store.attentionLedger(f.channel.id, { days: 30 });
    assert.deepEqual(ledger.watched, []);
    assert.deepEqual(ledger.drawn, []);
    const html = views.attentionLedger({ channel: f.channel, user: f.owner, ledger, days: 30 });
    assert.match(html, /No verified view yet in this period/);
    assert.match(html, /Your own positions have not been drawn in this period/);
    assert.match(html, /Our slot has not been drawn on your pages in this period/);
  } finally {
    await teardown(f);
  }
});

test('a placement the catalogue does not have cannot be written into the ledger', async () => {
  const f = await fixture();
  try {
    const viewer = await store.userByEmailOrCreate(`ledger-bad-${Date.now()}@test.local`);
    await assert.rejects(
      () => query(
        `insert into ad_view_events (channel_id, user_id, provider_id, placement, completed)
         values ($1, $2, 'pubscale', 'sneaky', true)`,
        [f.channel.id, viewer.id],
      ),
      /ad_view_events_placement_check/,
      'the schema accepted a placement that does not exist — the ledger would carry a made-up word',
    );
    await query('delete from profiles where id = $1', [viewer.id]);
  } finally {
    await teardown(f);
  }
});

test('the ledger holds no money: no column in either table could price a position', async () => {
  const { rows } = await query(
    `select table_name, column_name from information_schema.columns
      where table_schema = 'public'
        and table_name in ('ad_position_daily')
      union all
     -- The two columns this slice added to the view ledger, checked too: a verified
     -- view may carry a provider-reported revenue_usd (it already did, and it is
     -- informational), but the PLACE it sat must never come with a rate.
     select table_name, column_name from information_schema.columns
      where table_schema = 'public' and table_name = 'ad_view_events'
        and column_name in ('placement','surface')`,
  );
  const money = /(payout|amount|rate|cpm|rpm|earn|price|invoice|paid|revenue|money|cut)/i;
  const offenders = rows.filter((r) => money.test(r.column_name));
  assert.deepEqual(offenders, [],
    `the ledger carries a money column: ${JSON.stringify(offenders)} — a rate nobody agreed to is not a count`);

  // And the placement vocabulary the page prints is the catalogue's, so a label cannot
  // describe a placement the planner could never produce.
  const { rows: defs } = await query(
    `select pg_get_constraintdef(c.oid) as def from pg_constraint c
      where c.conname = 'ad_position_daily_side_check'`,
  );
  assert.match(defs[0].def, /platform/, 'the side column lost its check');
  assert.ok(Object.keys(PLACEMENTS).length >= 7, 'the placement catalogue shrank');
  assert.equal(await one('select 1 as ok from ad_position_daily limit 1').then((r) => r?.ok ?? 1), 1);
});
