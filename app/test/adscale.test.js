/**
 * What an unlock is allowed to ask for.  npm test
 *
 * Two number boxes used to sit on the seller's file page — "Ads to unlock" (1–5)
 * and "Minimum ad length" (5–120 s) — and whatever a seller typed became the ask.
 * A person who has never bought an ad in their life was pricing their own
 * audience's patience from memory, and the ceiling allowed ten minutes of it.
 *
 * This file holds the three properties that replaced those boxes:
 *
 *   1. THE ASK SCALES WITH THE FILE'S VALUE, and never linearly. A band table, not
 *      a formula: a NPR 500 file and a NPR 900 file are the same ask, deliberately,
 *      because the difference between them is not a difference in what a stranger
 *      will tolerate.
 *   2. THE PLATFORM'S CEILING IS ABSOLUTE. Three ads, sixty seconds each, three
 *      minutes in total — and the sentence that says so is checked against the
 *      numbers that enforce it, so the copy cannot drift away from the code.
 *   3. NO CALLER CAN ASK FOR MORE THAN THE MODEL ALLOWS. `setUnlockPolicy` takes a
 *      LEVEL, not numbers: a hand-crafted POST cannot invent an ask, which is the
 *      test at the bottom of this file.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:55432/bytebikri_test';

const {
  ASK_FLOOR, ASK_ABSOLUTE, ASK_BANDS, ASK_CEILING, ASK_LEVELS, ASK_PROMISE, ASK_INPUT_LINE,
  bandFor, ceilingFor, resolveAsk, askLabel, askSentence, askReason,
} = await import('../src/adscale.js');
const { store, PLANS } = await import('../src/store.js');
const { close, query } = await import('../src/db.js');

after(async () => { await close(); });

// ---------------------------------------------------------------------------
// The ceiling is a sentence AND a rule
// ---------------------------------------------------------------------------

test('the promise on the page is the arithmetic in the module', () => {
  // Every clause of the printed sentence, read out of ASK_ABSOLUTE. This is the
  // test that stops somebody raising a number here and leaving the page claiming
  // the old one — which is exactly how "ad-free" became a class action elsewhere.
  assert.match(ASK_PROMISE, new RegExp(`${ASK_ABSOLUTE.ads} ads`));
  assert.match(ASK_PROMISE, new RegExp(`${ASK_ABSOLUTE.seconds} seconds`));
  assert.match(ASK_PROMISE, new RegExp(`${ASK_ABSOLUTE.totalSeconds / 60} minutes`));
  // And it explains the reason, because a limit with no reason gets raised by the
  // next person who wants a bigger number.
  assert.match(ASK_PROMISE, /earn less|completion|finish/i);
});

test('no plan may reach past the platform ceiling, and each plan is inside it', () => {
  for (const [code, ceiling] of Object.entries(ASK_CEILING)) {
    assert.ok(ceiling.ads <= ASK_ABSOLUTE.ads, `${code} asks more ads than the platform allows`);
    assert.ok(ceiling.seconds <= ASK_ABSOLUTE.seconds, `${code} asks longer than the platform allows`);
  }
});

test('the capability rows in the database are the ceilings in the code', async () => {
  // `billing.js planDrift` checks the whole capability map at boot; this checks the
  // two keys this module owns, against the table, so a code-only edit fails here
  // with a sentence about which number moved.
  const rows = await query('select code, capabilities from plans');
  for (const row of rows.rows) {
    const ceiling = ASK_CEILING[row.code];
    assert.ok(ceiling, `the table has a plan "${row.code}" with no ask ceiling in adscale.js`);
    assert.equal(row.capabilities.ad_ask_max_ads, ceiling.ads, `${row.code}: ads ceiling drifted`);
    assert.equal(row.capabilities.ad_ask_max_seconds, ceiling.seconds, `${row.code}: seconds ceiling drifted`);
    // And app-side, because PLANS is what the running code reads.
    assert.equal(PLANS[row.code].capabilities.ad_ask_max_ads, ceiling.ads);
    assert.equal(PLANS[row.code].capabilities.ad_ask_max_seconds, ceiling.seconds);
  }
});

// ---------------------------------------------------------------------------
// The ladder
// ---------------------------------------------------------------------------

test('the bands rise with value, and never fall', () => {
  let ads = 0;
  let seconds = 0;
  let previous = null;
  for (const band of ASK_BANDS) {
    assert.ok(band.ads >= ads, `${band.key} asks for fewer ads than the band below it`);
    assert.ok(band.seconds >= seconds, `${band.key} asks for a shorter view than the band below it`);
    assert.ok(previous === null || band.upTo > previous, 'the bands are ordered and do not overlap');
    assert.ok(band.why && band.why.length > 20, `${band.key} explains itself, because the seller did not choose it`);
    ads = band.ads;
    seconds = band.seconds;
    previous = band.upTo;
  }
  // The top band IS the ceiling. A ladder that stops short of its own limit leaves
  // a capability nothing can ever use.
  const top = ASK_BANDS[ASK_BANDS.length - 1];
  assert.equal(top.ads, ASK_ABSOLUTE.ads);
  assert.equal(top.seconds, ASK_ABSOLUTE.seconds);
});

test('spending more attention is a step function, not a slope', () => {
  // Two files an order of magnitude apart in the low bands ask for the SAME thing.
  assert.deepEqual(
    [bandFor(50).ads, bandFor(50).seconds, bandFor(120).ads, bandFor(120).seconds],
    [bandFor(120).ads, bandFor(120).seconds, bandFor(120).ads, bandFor(120).seconds],
  );
  // And the whole ladder only ever moves in a few steps across four orders of
  // magnitude, because each step costs a completion.
  const steps = new Set(ASK_BANDS.map((b) => `${b.ads}x${b.seconds}`));
  assert.ok(steps.size <= 7, `the ladder has ${steps.size} distinct asks, which is more than a person can reason about`);
  // A file with no declared value is at the floor: the ladder must not punish a
  // seller for not having priced anything.
  assert.equal(bandFor(0).key, 'gift');
  assert.equal(bandFor(null).key, 'gift');
  assert.equal(bandFor(-100).key, 'gift');
});

test('every plan, every level and every value lands inside both ceilings', () => {
  const values = [0, 1, 99, 199, 200, 599, 600, 1499, 1500, 3999, 4000, 9999, 10000, 250000, 10_000_000];
  for (const code of Object.keys(ASK_CEILING)) {
    for (const level of ['standard', 'light']) {
      for (const valueNpr of values) {
        const ask = resolveAsk({ valueNpr, planCode: code, level });
        const ceiling = ASK_CEILING[code];
        assert.ok(ask.ads >= ASK_FLOOR.ads, `${code}/${level}/${valueNpr}: below the floor`);
        assert.ok(ask.seconds >= ASK_FLOOR.seconds, `${code}/${level}/${valueNpr}: below the floor`);
        assert.ok(ask.ads <= Math.min(ceiling.ads, ASK_ABSOLUTE.ads), `${code}/${level}/${valueNpr}: past the ceiling`);
        assert.ok(ask.seconds <= Math.min(ceiling.seconds, ASK_ABSOLUTE.seconds), `${code}/${level}/${valueNpr}: past the ceiling`);
        assert.ok(ask.totalSeconds <= ASK_ABSOLUTE.totalSeconds, `${code}/${level}/${valueNpr}: past the total`);
      }
    }
  }
});

test('the plan is what caps a cheap store on an expensive file, and it says so', () => {
  // A Free store selling a NPR 25,000 file sits in the top band and cannot use it.
  const free = resolveAsk({ valueNpr: 25_000, planCode: 'free', level: 'standard' });
  const pro = resolveAsk({ valueNpr: 25_000, planCode: 'pro', level: 'standard' });
  assert.equal(free.ads, ASK_CEILING.free.ads);
  assert.equal(free.seconds, ASK_CEILING.free.seconds);
  assert.equal(free.capped, true, 'the seller is told the plan decided the number');
  assert.equal(pro.ads, ASK_CEILING.pro.ads);
  assert.equal(pro.capped, false);
  // The reason names the band, the number, and what would change it. An upsell that
  // hides the arithmetic is an upsell the seller cannot check.
  const reason = askReason({ valueNpr: 25_000, planCode: 'free', level: 'standard' });
  assert.match(reason, /NPR 25,000/);
  assert.match(reason, /move up a plan/);
});

test('the minimum is available on every plan and every file', () => {
  for (const code of Object.keys(ASK_CEILING)) {
    const light = resolveAsk({ valueNpr: 999_999, planCode: code, level: 'light' });
    assert.deepEqual([light.ads, light.seconds], [ASK_FLOOR.ads, ASK_FLOOR.seconds]);
    assert.equal(light.level, 'light');
  }
  assert.equal(ASK_LEVELS.length, 2, 'two choices, deliberately: the rate, or the minimum');
  assert.equal(ASK_LEVELS[0].key, 'standard', 'the recommendation is the default');
});

test('an unknown plan or a bogus level falls back rather than failing open', () => {
  const unknown = resolveAsk({ valueNpr: 4000, planCode: 'made-up', level: 'standard' });
  assert.equal(unknown.ads, ASK_CEILING.free.ads, 'an unknown plan is treated as the most restrictive one');
  const bogus = resolveAsk({ valueNpr: 4000, planCode: 'pro', level: 'high' });
  assert.equal(bogus.level, 'standard', 'a level that does not exist is the standard ask, not a bigger one');
});

test('the ask is described in whole words wherever it is shown', () => {
  assert.equal(askLabel({ ads: 1, seconds: 15 }), '1 ad of 15 seconds');
  assert.equal(askLabel({ ads: 2, seconds: 30 }), '2 ads of 30 seconds');
  assert.equal(askLabel(null), 'one short ad');
  assert.match(askSentence({ ads: 2, seconds: 30, level: 'standard' }), /2 ads of 30 seconds of your time/);
  assert.match(askSentence({ ads: 1, seconds: 15, level: 'light' }), /chose the minimum/);
  // The input line names the mechanism, because a number that appears without an
  // explanation is a number nobody trusts — and it must not call the value a "price",
  // because the field two lines above it says in as many words that it is not one.
  assert.match(ASK_INPUT_LINE, /worth and by your plan/);
  assert.doesNotMatch(ASK_INPUT_LINE, /\bprice\b/, 'the panel does not contradict its own field label');
});

// ---------------------------------------------------------------------------
// The door: a level, never numbers
// ---------------------------------------------------------------------------

test('setUnlockPolicy derives the ask, and a hand-crafted POST cannot inflate it', async () => {
  const tag = `${Date.now()}-ask`;
  const user = await store.userByEmailOrCreate(`ask-${tag}@test.local`);
  const channel = await store.createChannel({ ownerId: user.id, slug: `ask-${tag}`, name: `Ask ${tag}` });
  // A Pro store, so the ceiling is the platform's own and not the plan's.
  await query(
    `insert into subscriptions (channel_id, plan_code, status, period_start, period_end)
     values ($1, 'pro', 'active', now(), now() + interval '365 days')`,
    [channel.id],
  );
  const asset = await store.createAsset({ channelId: channel.id, title: `Ask ${tag}`, slug: `ask-${tag}` });

  // The value is what moves the ask, and nothing else does.
  await store.updateAsset(asset.id, { declared_value_npr: 50 });
  const cheap = await store.setUnlockPolicy(asset.id, { ask_level: 'standard', unlock_hours: 24 });
  await store.updateAsset(asset.id, { declared_value_npr: 25_000 });
  const dear = await store.setUnlockPolicy(asset.id, { ask_level: 'standard', unlock_hours: 24 });
  // The row is what the pipeline reads, so the assertion is on the row.
  assert.ok(
    dear.ads_required * dear.ad_min_seconds > cheap.ads_required * cheap.ad_min_seconds,
    'the dear file asks for more of somebody’s time',
  );

  // Numbers posted directly are ignored: this is the same call the route makes, and
  // the route cannot pass anything else.
  const forced = await store.setUnlockPolicy(asset.id, {
    ads_required: 20, ad_min_seconds: 999, ask_level: 'standard',
  });
  assert.equal(forced.ads_required, dear.ads_required, 'a posted number did not move the ask');
  assert.equal(forced.ad_min_seconds, dear.ad_min_seconds);
  assert.equal(Number(forced.ad_band_npr), 25_000, 'and the value it was calibrated from is recorded');

  // A price change does not silently re-ask: the stored ask stands until the seller
  // saves the page again, which is what the drift note on their page is for.
  await store.updateAsset(asset.id, { declared_value_npr: 0 });
  const unchanged = await store.unlockPolicy(asset.id);
  assert.equal(unchanged.ads_required, dear.ads_required, 'an ask already advertised does not move on its own');

  // And the schema's own check is wider than the policy, deliberately: the policy is
  // the tighter of the two, and nothing the app writes can reach the schema's edge.
  assert.ok(forced.ads_required <= ASK_ABSOLUTE.ads);
  assert.ok(forced.ad_min_seconds <= ASK_ABSOLUTE.seconds);
});

// ---------------------------------------------------------------------------
// The floor is not a convention — and the way it was broken is worth naming
// ---------------------------------------------------------------------------

test('no writer can put a file below the floor the product publishes', async () => {
  // This test exists because a browser pass found the promise already broken in two
  // places a unit test does not look: the PUBLISH form still carried a "Minimum ad
  // length" box and its route still honored it, and this repository's own demo seed
  // wrote five seconds "for demo friendliness". The file page then said "Now: 1 ad of
  // 5 seconds" directly above the ladder's "1 ad of 15 seconds" — the product
  // contradicting itself in one panel, on the very screen that explains the rule.
  //
  // The fix is a constraint, because the floor is the shortest view a rewarded network
  // will serve and not a policy a plan or a price may move. What follows is the proof
  // that it holds against a writer that goes around the store entirely — the shape any
  // future seeder, script or admin tool would have.
  const channel = await store.createChannel({
    ownerId: (await store.userByEmailOrCreate(`ask-floor-${Date.now()}@test.local`)).id,
    name: 'Floor Test Store', slug: `ask-floor-${Date.now()}`,
  });
  const asset = await store.createAsset({ channelId: channel.id, title: 'Floor probe', unlockMode: 'ad_gated' });

  await assert.rejects(
    () => query('update asset_unlock_policy set ad_min_seconds = 5 where asset_id = $1', [asset.id]),
    /asset_unlock_policy_ask_bounds/,
    'a five-second ask is refused by the database, not by a comment',
  );
  await assert.rejects(
    () => query('update asset_unlock_policy set ad_min_seconds = 3000 where asset_id = $1', [asset.id]),
    /asset_unlock_policy_ask_bounds/,
    'and so is a fifty-minute one',
  );

  // The ask the store writes lands inside those bounds on every plan — the ladder is
  // the tighter of the two, which is why the schema may be wider.
  for (const code of Object.keys(PLANS)) {
    const ask = resolveAsk({ valueNpr: 1_000_000, planCode: code, level: 'standard' });
    assert.ok(ask.seconds >= 15 && ask.seconds <= 600, `${code}: inside the published bounds`);
    assert.ok(ask.ads <= 10, `${code}: and inside the published count`);
  }

  // The dead setter stays dead. It was a public method that wrote any number into the
  // column the pipeline reads; deleting it is what makes "the ask is never typed" a
  // property rather than a description of the routes somebody happened to remember.
  assert.equal(store.setAdMinSeconds, undefined, 'there is no setter for a typed ask');
});

test('the publish path does not accept a typed ask', async () => {
  // The form and the route, read as source, because the defect this replaces was
  // exactly a field that survived a rewrite of the logic behind it: `adscale.js` was
  // written, the file page stopped asking for numbers, and the publish form kept its
  // box for another round. A test that reads the two files is the only kind that
  // catches a control nobody wired up yet.
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const path = await import('node:path');
  const here = path.dirname(fileURLToPath(import.meta.url));
  const server = readFileSync(path.join(here, '..', 'server.js'), 'utf8');
  const views = readFileSync(path.join(here, '..', 'src', 'views.js'), 'utf8');

  assert.doesNotMatch(server, /setAdMinSeconds\(/, 'the publish route writes no typed ask');
  assert.doesNotMatch(views, /name="adMinSeconds"/, 'and the publish form offers no box for one');
  // The seed is the other writer that was found: it may not either.
  assert.doesNotMatch(server, /setAdMinSeconds/);
});
