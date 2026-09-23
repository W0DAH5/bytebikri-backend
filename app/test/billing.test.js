/**
 * The revenue model, as arithmetic.  npm test
 *
 * Two charges exist: a store upgrade and annual rent for the platform slot.
 * Everything that decides whether a seller owes money, how much, and what they
 * get for it lives in `src/billing.js` and a handful of store methods — so it
 * can be tested rather than asserted in a pricing page.
 *
 * These run against a real Postgres, like the rest of the store tests, because
 * half of what is being checked here IS the database: the unique constraint that
 * makes the request-then-pay flow idempotent, the column that keeps a requested
 * upgrade from being mistaken for a paid one, and the SQL that a missing `$` in
 * a template literal turns into `title = 2`.
 *
 * That last one is not hypothetical: `updateAsset` shipped with
 * `set ${key} = ${values.length}` — no placeholder sigil — and every save from
 * the asset page failed with "bind message supplies 5 parameters, but prepared
 * statement requires 1". The suite passed, because no test had ever written to
 * that method. The round-trip tests below exist so that cannot happen again.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:55432/bytebikri_test';

const { store, PLANS, nextPlan } = await import('../src/store.js');
const { close, query, scalar } = await import('../src/db.js');
const { annualRentNpr, rentPeriod, upgradeExplanation, planBenefits, planDrift, RENT_TERMS, NOT_CHARGED } = await import('../src/billing.js');

after(async () => { await close(); });

let seq = 0;
/** A paid Store channel with one day short of a year left on its period. */
async function fixture({ plan = 'store', daysLeft = 365, rentSlot = true } = {}) {
  const tag = `${Date.now()}-${++seq}`;
  const user = await store.userByEmailOrCreate(`owner-bill-${tag}@test.local`);
  const channel = await store.createChannel({ ownerId: user.id, slug: `bill-${tag}`, name: `Bill ${tag}` });

  await query(
    `insert into subscriptions (channel_id, plan_code, status, period_start, period_end)
     values ($1, $2, 'active', now(), now() + ($3 || ' days')::interval)`,
    [channel.id, plan, String(daysLeft)],
  );

  const asset = await store.createAsset({ channelId: channel.id, title: `Asset ${tag}`, slug: `a-${tag}` });
  // `estimateRentSlotValue` reads slots, and one platform slot is what rent is
  // charged for. The fixture fakes the estimate rather than building real slots.
  const estimate = { pageviews30d: 10_000, total: 4, rent: rentSlot ? 1 : 0, rpmUsd: 0.2, estNpr: 280 };
  return { user, channel: await store.channelById(channel.id), asset, estimate, tag };
}

// ---------------------------------------------------------------------------
// The two charges, and nothing else
// ---------------------------------------------------------------------------

test('rent is the monthly estimate times twelve, and zero when nothing is rented', () => {
  assert.equal(annualRentNpr({ rent: 1, estNpr: 280 }), 3360);
  assert.equal(annualRentNpr({ rent: 0, estNpr: 280 }), 0, 'no platform slot means no rent');
  assert.equal(annualRentNpr({ rent: 1, estNpr: 0 }), 0, 'no traffic means no rent');
  assert.equal(annualRentNpr(null), 0);
  assert.equal(annualRentNpr({ rent: 1, estNpr: 280.4 }), 3365, 'rounded to the rupee');
});

test('the only amounts bytebikri ever charges are the plan prices and the rent', () => {
  // A guard on the model rather than on a number: if a third charge is ever
  // added it has to be added here too, deliberately.
  assert.deepEqual(Object.values(PLANS).map((p) => p.priceNpr), [0, 999, 2499]);
  assert.equal(NOT_CHARGED.length, 4);
  assert.ok(NOT_CHARGED.some((n) => /0%/.test(n)), 'the 0% ad-share promise is stated on the billing page');
  assert.ok(NOT_CHARGED.every((n) => !/commission on|fee of|%/i.test(n) || /0%/.test(n)),
    'no percentage appears in the not-charged list except the zero one');
});

test('a rent period is the channel anniversary, not the calendar year', () => {
  const { start, end } = rentPeriod('2025-03-14T10:00:00Z', new Date('2026-09-21T00:00:00Z'));
  assert.equal(start, '2026-03-14');
  assert.equal(end, '2027-03-14');
  // A channel created in December gets a full year, not two months and a bill.
  const dec = rentPeriod('2026-12-20T00:00:00Z', new Date('2027-01-05T00:00:00Z'));
  assert.equal(dec.start, '2026-12-20');
  assert.equal(dec.end, '2027-12-20');
});

// ---------------------------------------------------------------------------
// Asking is not paying
// ---------------------------------------------------------------------------

test('requesting an upgrade does not change the plan, and records what was asked', async () => {
  const { channel, user, tag } = await fixture({ plan: 'store' });
  const before = store.plan(channel);
  assert.equal(before.code, 'store');

  const sub = await store.requestUpgrade(channel, 'pro');
  assert.equal(sub.pending_plan_code, 'pro');
  assert.equal(sub.status, 'active', 'the paid status must not change');

  const after_ = await store.channelById(channel.id);
  assert.equal(after_.plan_code, 'store', 'a request must not grant the requested plan');
  assert.equal(store.plan(after_).code, 'store');
  assert.ok(after_, tag);
});

test('the pro-rated amount is quoted from the plan HELD, not the one asked for', async () => {
  const { channel } = await fixture({ plan: 'store', daysLeft: 180 });
  await store.requestUpgrade(channel, 'pro');

  const fresh = await store.channelById(channel.id);
  const quote = store.upgradeQuote(fresh, 'pro');
  assert.ok(quote, 'store -> pro must be quotable');
  assert.equal(quote.from.code, 'store');
  assert.equal(quote.fullDifference, 1500);
  // 365 days of Store->Pro is 1500; half way through the period is 750.
  assert.equal(quote.amountNpr, 740, `180 days of 365 should be about half, got ${quote.amountNpr}`);
  assert.ok(quote.amountNpr < PLANS.pro.priceNpr,
    'the seller must never be billed the full price for a part period');
});

test('a payment cannot be recorded without an open request', async () => {
  const { channel } = await fixture({ plan: 'store' });
  const none = await store.recordPlanPayment({
    channelId: channel.id, amountNpr: 1500, txnReference: `noreq-${Date.now()}`,
  });
  assert.equal(none, null, 'nothing is pending, so there is nothing to attribute a payment to');
});

test('a free channel can ask for its first plan, and is billed the full price', async () => {
  const tag = `${Date.now()}-${++seq}`;
  const user = await store.userByEmailOrCreate(`fresh-${tag}@test.local`);
  const channel = await store.createChannel({ ownerId: user.id, slug: `fresh-${tag}`, name: `Fresh ${tag}` });

  const sub = await store.requestUpgrade(channel, 'store');
  assert.equal(sub.plan_code, 'free');
  assert.equal(sub.pending_plan_code, 'store');
  assert.equal(sub.period_end, null, 'a free plan has no period end — see migration 0013');

  const fresh = await store.channelById(channel.id);
  const quote = store.upgradeQuote(fresh, 'store');
  assert.equal(quote.amountNpr, 999, 'with no running period the full price is due');
});

test('matching moves the plan, clears the request, and does not move the renewal date', async () => {
  const { channel, user } = await fixture({ plan: 'store', daysLeft: 300 });
  await store.requestUpgrade(channel, 'pro');
  const before = await store.subscriptionOf(channel.id);

  const payment = await store.recordPlanPayment({
    channelId: channel.id, amountNpr: 1233, txnReference: `match-${Date.now()}`,
    method: 'esewa', payerName: 'Seller',
  });
  assert.ok(payment, 'a payment against an open request must be recorded');
  assert.equal(payment.status, 'submitted', 'submitting a reference is not approval');

  const mid = await store.channelById(channel.id);
  assert.equal(mid.plan_code, 'store', 'the plan moves only when an operator matches');

  const operator = await store.userByEmailOrCreate(`op-${Date.now()}@test.local`);
  const matched = await store.matchPlanPayment({ paymentId: payment.id, actorId: operator.id });
  assert.equal(matched.status, 'matched');

  const after_ = await store.channelById(channel.id);
  assert.equal(after_.plan_code, 'pro');
  assert.equal(store.plan(after_).code, 'pro');

  const sub = await store.subscriptionOf(channel.id);
  assert.equal(sub.pending_plan_code, null, 'the request is closed');
  assert.equal(sub.status, 'active');
  assert.equal(
    new Date(sub.period_end).toISOString(),
    new Date(before.period_end).toISOString(),
    'a pro-rated upgrade keeps the renewal date it was pro-rated to',
  );
  assert.ok(user);
});

test('matching twice is a no-op, not a second year', async () => {
  const { channel } = await fixture({ plan: 'store', daysLeft: 40 });
  await store.requestUpgrade(channel, 'pro');
  const payment = await store.recordPlanPayment({
    channelId: channel.id, amountNpr: 164, txnReference: `twice-${Date.now()}`,
  });
  const operator = await store.userByEmailOrCreate(`op2-${Date.now()}@test.local`);

  const first = await store.matchPlanPayment({ paymentId: payment.id, actorId: operator.id });
  const second = await store.matchPlanPayment({ paymentId: payment.id, actorId: operator.id });
  assert.ok(first);
  assert.equal(second, null, 'a matched payment is not matched again');

  const sub = await store.subscriptionOf(channel.id);
  assert.equal(new Date(sub.period_end).toISOString(), (await store.subscriptionOf(channel.id)).period_end.toISOString());
});

test('rejecting a payment drops the request and leaves the paid plan alone', async () => {
  const { channel } = await fixture({ plan: 'store' });
  await store.requestUpgrade(channel, 'pro');
  const payment = await store.recordPlanPayment({
    channelId: channel.id, amountNpr: 1500, txnReference: `rej-${Date.now()}`,
  });
  const operator = await store.userByEmailOrCreate(`op3-${Date.now()}@test.local`);

  const rejected = await store.rejectPlanPayment({
    paymentId: payment.id, actorId: operator.id, reason: 'no such transfer on the statement',
  });
  assert.equal(rejected.status, 'rejected');

  const sub = await store.subscriptionOf(channel.id);
  assert.equal(sub.pending_plan_code, null);
  assert.equal(sub.plan_code, 'store', 'a rejected payment must not cost the seller their plan');
  assert.equal(sub.status, 'active');

  // And the operator queue no longer offers it.
  const open = await store.unmatchedPayments();
  assert.ok(!open.some((p) => p.id === payment.id));
});

// ---------------------------------------------------------------------------
// Capability follows the paid plan
// ---------------------------------------------------------------------------

test('the effective plan drops to free only when the period and grace have both run out', () => {
  const base = { plan_code: 'pro' };
  assert.equal(store.effectivePlanCode({ ...base, subscription_status: 'active', subscription_end: '2999-01-01' }), 'pro');
  assert.equal(store.effectivePlanCode({ ...base, subscription_status: 'grace', subscription_end: '2000-01-01' }), 'pro',
    'grace keeps features on');
  assert.equal(store.effectivePlanCode({ ...base, subscription_status: 'expired', subscription_end: '2000-01-01' }), 'free');
  assert.equal(store.effectivePlanCode({ ...base, subscription_status: null, subscription_end: '2999-01-01' }), 'free',
    'a cancelled or refunded subscription grants nothing');
  assert.equal(store.effectivePlanCode({ plan_code: 'free' }), 'free');
  assert.equal(store.effectivePlanCode(null), 'free');
});

test('a lapsed period keeps its features for the grace window', () => {
  const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString();
  assert.equal(store.effectivePlanCode({ plan_code: 'store', subscription_status: 'active', subscription_end: daysAgo(10) }), 'store');
  assert.equal(store.effectivePlanCode({ plan_code: 'store', subscription_status: 'active', subscription_end: daysAgo(31) }), 'free');
});

test('the paid plans can be found; a free one cannot, whatever it asks for', async () => {
  const tag = `${Date.now()}-${++seq}`;
  const owner = await store.userByEmailOrCreate(`list-${tag}@test.local`);
  const channel = await store.createChannel({ ownerId: owner.id, slug: `list-${tag}`, name: `List ${tag}` });
  await store.updateChannel(channel.id, { listing_mode: 'marketplace', name: `List ${tag}` });

  const listed = await store.channels({ listedOnly: true });
  assert.ok(listed.some((c) => c.id === channel.id), 'a free store that opts in is still listed at the data layer');
  assert.equal(PLANS.free.capabilities.marketplace_listed, false, 'the ROUTE is where the plan is checked');
  assert.equal(PLANS.store.capabilities.marketplace_listed, true, 'the first paid tier buys discovery');
  assert.equal(PLANS.pro.capabilities.featured_eligible, true, 'placement, not visibility, is the upsell');
});

// ---------------------------------------------------------------------------
// Writes that go through a generated SET clause
// ---------------------------------------------------------------------------

test('updateAsset writes what it was given, and refuses what it was not', async () => {
  const { channel, asset } = await fixture();
  // Whatever the file came out of creation as — `pending` for a store's first
  // file, `approved` after one has been reviewed. The assertion at the end is
  // that this does not move, which is the promise; naming a value would only
  // pin today's default.
  const before = asset.moderation_state;

  const updated = await store.updateAsset(asset.id, {
    title: 'Renamed', description: 'A new description', unlock_mode: 'open', status: 'paused',
  });
  assert.equal(updated.title, 'Renamed');
  assert.equal(updated.description, 'A new description');
  assert.equal(updated.unlock_mode, 'open');
  assert.equal(updated.status, 'paused');

  // `slug` is the address people already have. `moderation_state` is not the
  // seller's to change. Neither may be writable through this method.
  const after_ = await store.updateAsset(asset.id, {
    slug: 'hijacked', moderation_state: 'removed', channel_id: channel.id,
  });
  assert.equal(after_.slug, asset.slug, 'a slug survives an update that tries to change it');
  assert.equal(after_.channel_id, channel.id);
  assert.equal(after_.moderation_state, before,
    "a seller cannot move their own file's moderation state — that is the moderator's column");

  // An empty patch is a read, not an error.
  const same = await store.updateAsset(asset.id, {});
  assert.equal(same.title, 'Renamed');
});

test('updateChannel writes every column the settings form offers', async () => {
  const { channel } = await fixture();
  const updated = await store.updateChannel(channel.id, {
    name: 'New name', tagline: 'One line', about: 'About this store',
    channel_contact: 'hello@example.com', listing_mode: 'marketplace', ads_enabled: false,
    sells_digital: true, sells_physical: false,
  });
  assert.equal(updated.name, 'New name');
  assert.equal(updated.tagline, 'One line');
  assert.equal(updated.about, 'About this store');
  assert.equal(updated.channel_contact, 'hello@example.com');
  assert.equal(updated.listing_mode, 'marketplace');
  assert.equal(updated.ads_enabled, false);
  assert.equal(updated.sells_digital, true);
  assert.equal(updated.sells_physical, false);
});

test('setUnlockPolicy clamps to something a network will actually credit', async () => {
  const { asset } = await fixture();
  const set = await store.setUnlockPolicy(asset.id, { ads_required: 0, ad_min_seconds: 1, unlock_hours: 0 });
  assert.equal(set.ads_required, 1, 'a zero-ad unlock hands the file over for nothing');
  assert.equal(set.ad_min_seconds, 5, 'below the network floor a view is not credited');
  assert.equal(set.unlock_hours, 1);

  const huge = await store.setUnlockPolicy(asset.id, { ads_required: 99, ad_min_seconds: 999, unlock_hours: 99999 });
  assert.equal(huge.ads_required, 5);
  assert.equal(huge.ad_min_seconds, 120);
  assert.equal(huge.unlock_hours, 720);
});

// ---------------------------------------------------------------------------
// Rent, reviews, search
// ---------------------------------------------------------------------------

test('the rent invoice is issued once, and carries its own working', async () => {
  const { channel, estimate } = await fixture();

  const first = await store.ensureRentInvoice({ channel, estimate });
  assert.ok(first, '10,000 views with a platform slot is a billable period');
  assert.equal(first.amount_npr, 3360);
  assert.equal(first.status, 'issued');
  assert.equal(Number(first.basis.estMonthlyNpr), 280);
  assert.equal(Number(first.basis.months), 12);

  const again = await store.ensureRentInvoice({ channel, estimate });
  assert.equal(again.id, first.id, 'the unique (channel_id, period_start) makes this idempotent');
});

test('no invoice is issued when there is nothing to rent', async () => {
  const { channel, estimate } = await fixture({ rentSlot: false });
  const invoice = await store.ensureRentInvoice({ channel, estimate: { ...estimate, rent: 0 } });
  assert.equal(invoice, null, 'a page too short to spare a slot is not taxed');
});

test('rent is submitted with a reference and marked paid by an operator', async () => {
  const { channel, estimate } = await fixture();
  const invoice = await store.ensureRentInvoice({ channel, estimate });

  const bad = await store.submitRentPayment({ invoiceId: invoice.id, channelId: channel.id, txnReference: 'x' });
  assert.equal(bad, null, 'a one-character reference is not a reference');

  const submitted = await store.submitRentPayment({
    invoiceId: invoice.id, channelId: channel.id, method: 'esewa', txnReference: `rent-${Date.now()}`,
  });
  assert.equal(submitted.status, 'submitted');
  assert.ok((await store.openRentInvoices()).some((i) => i.id === invoice.id));

  const operator = await store.userByEmailOrCreate(`op4-${Date.now()}@test.local`);
  const paid = await store.matchRentPayment({ invoiceId: invoice.id, actorId: operator.id, note: 'seen on statement' });
  assert.equal(paid.status, 'paid');
  assert.ok(!(await store.openRentInvoices()).some((i) => i.id === invoice.id));
});

test('a review can only be written where an unlock exists, and the average counts them', async () => {
  const { asset, channel, user } = await fixture();
  const buyer = await store.userByEmailOrCreate(`buyer-${Date.now()}-${seq}@test.local`);
  const unlock = await store.grantUnlock({ assetId: asset.id, channelId: channel.id, userId: buyer.id, method: 'open', adsCompleted: 0 });

  const first = await store.addReview({ unlockId: unlock.id, assetId: asset.id, channelId: channel.id, buyerId: buyer.id, rating: 4, body: 'Good.' });

  // One unlock, one review: a second submission edits the first. Reviews are
  // keyed off the unlock, so there is no way to write a second opinion with the
  // same ad view — and no way to pad a rating count.
  const edited = await store.addReview({
    unlockId: unlock.id, assetId: asset.id, channelId: channel.id, buyerId: buyer.id, rating: 5, body: 'Better than I said.',
  });
  assert.equal(edited.id, first.id, 'the second write updates the same row');
  const after_ = await store.reviewStatsOfAsset(asset.id);
  assert.equal(Number(after_.count), 1, 'and the count is still one');

  // A rating with no unlock row has nothing to attach to — the FK is the gate.
  await assert.rejects(
    () => store.addReview({
      unlockId: '00000000-0000-0000-0000-000000000000', assetId: asset.id, channelId: channel.id,
      buyerId: user.id, rating: 5, body: 'Not mine.',
    }),
    /foreign key|violates/i,
  );

  const stats = await store.reviewStatsOfAsset(asset.id);
  assert.equal(Number(stats.count), 1);
  assert.equal(Number(stats.average).toFixed(1), '5.0', 'the average follows the edit');
});

test('search finds listed stores and their files, and nothing private', async () => {
  const tag = `${Date.now()}-${++seq}`;
  const owner = await store.userByEmailOrCreate(`search-${tag}@test.local`);
  const channel = await store.createChannel({
    ownerId: owner.id, slug: `srch-${tag}`, name: `Devanagari Studio ${tag}`,
    tagline: 'Poster kits and type',
  });
  await store.updateChannel(channel.id, { listing_mode: 'marketplace', name: `Devanagari Studio ${tag}` });
  // Approved explicitly: search answers with files somebody has decided about, and
  // a brand-new store's file is `pending` on purpose (see test/moderation.test.js).
  // This test is about the marketplace filter, so the file starts decided.
  await store.createAsset({
    channelId: channel.id, title: `Nepali Poster Kit ${tag}`, slug: `kit-${tag}`,
    moderationState: 'approved',
  });

  const results = await store.search('Devanagari');
  assert.ok(results.stores.some((c) => c.id === channel.id), 'a listed store is findable by name');
  assert.ok(Array.isArray(results.assets));

  const byFile = await store.search(`Nepali Poster Kit ${tag}`);
  assert.ok(byFile.assets.some((a) => a.channel_id === channel.id), 'a file is findable by title');

  // A store that kept to its own address is not in a directory, on purpose.
  await store.updateChannel(channel.id, { listing_mode: 'storefront' });
  const after_ = await store.search('Devanagari');
  assert.ok(!after_.stores.some((c) => c.id === channel.id), 'own-address stores are never listed');
});

// ---------------------------------------------------------------------------
// What the page says
// ---------------------------------------------------------------------------

test('the upgrade explanation shows its arithmetic rather than one number', () => {
  const quote = { from: PLANS.store, to: PLANS.pro, daysLeft: 200, fullDifference: 1500, amountNpr: 822 };
  const lines = upgradeExplanation(quote);
  assert.equal(lines.amountNpr, 822);
  assert.ok(lines.lines.some((l) => /2,499/.test(l)), 'the new price is stated');
  assert.ok(lines.lines.some((l) => /999/.test(l)), 'the price being left is stated');
  assert.ok(lines.lines.some((l) => /200 days/.test(l)), 'the days being pro-rated are stated');
  assert.ok(lines.lines.some((l) => /renewal date does not move/i.test(l)));

  assert.equal(upgradeExplanation(null), null);
});

test('plan benefits read as sentences, with no negative sentinel showing through', () => {
  for (const plan of Object.values(PLANS)) {
    const lines = planBenefits(plan);
    assert.ok(lines.length >= 4);
    assert.ok(!lines.some((l) => /-1/.test(l)), `plan ${plan.code} prints a -1 sentinel: ${lines.join(' | ')}`);
  }
  assert.ok(planBenefits(PLANS.pro).some((l) => /Unlimited published files/.test(l)));
  assert.ok(planBenefits(PLANS.free).some((l) => /own address only/i.test(l)));
  assert.ok(planBenefits(PLANS.store).some((l) => /Explore/i.test(l)));

  // The capability and the benefit list have to agree, in both directions. A plan
  // that can theme but does not say so is the exact gap this round closed: the
  // storefront theme was `can_theme: true` on the paid plans, absent from this list,
  // and read by nothing for three migrations. Now that it exists, the line has to be
  // there — and a Free plan must not be sold it.
  for (const plan of [PLANS.store, PLANS.pro]) {
    assert.ok(plan.capabilities.can_theme === true, `${plan.code} carries the capability`);
    assert.ok(planBenefits(plan).some((l) => /storefront theme/i.test(l)),
      `${plan.code} can theme and says so on the pricing page`);
  }
  assert.equal(PLANS.free.capabilities.can_theme, false);
  assert.ok(!planBenefits(PLANS.free).some((l) => /theme/i.test(l)),
    'a Free plan is not sold a look it cannot pick');
});

// ---------------------------------------------------------------------------
// Plan usage
// ---------------------------------------------------------------------------

test('plan usage has three states, and the warning arrives before the wall', async () => {
  const { planUsage } = await import('../src/billing.js');
  const level = (files, plan = PLANS.free) => planUsage({ plan, files }).files.level;

  assert.equal(level(0), 'ok');
  assert.equal(level(15), 'ok', '75% is comfortable: a bar here is decoration, not information');
  assert.equal(level(16), 'near', '80% is where a person can still act on it');
  assert.equal(level(19), 'near');
  assert.equal(level(20), 'at', 'at the allowance the next upload is refused');
  assert.equal(level(35), 'at', 'and over it (a downgrade) is still "at", never a negative number');

  // The researched failure this prevents: nobody is told the count until an
  // upload is refused, so the refusal reads as the product breaking.
  const near = planUsage({ plan: PLANS.free, files: 17 });
  assert.equal(near.files.remaining, 3);
  assert.match(near.sentence, /17 of 20 published files — 3 left on Free/);
  assert.match(planUsage({ plan: PLANS.free, files: 20 }).sentence, /this plan is full/);

  // Unlimited never reports a level: "0% of unlimited" helps nobody, and a bar
  // drawn against -1 would be a full bar on an empty store.
  const unlimited = planUsage({ plan: PLANS.pro, files: 4321 });
  assert.equal(unlimited.files.level, 'unlimited');
  assert.equal(unlimited.files.ratio, null);
  assert.match(unlimited.sentence, /no file limit/);
});

test('the same usage drives the dashboard, the refusal and the operator list', async () => {
  const { planUsage } = await import('../src/billing.js');
  const { dashboard } = await import('../src/views.js');
  const storeRow = {
    id: '00000000-0000-0000-0000-000000000002', slug: 'shop', name: 'Shop', tagline: '',
    listing_mode: 'storefront', moderation_state: 'approved', created_at: new Date(),
  };
  const base = {
    channel: storeRow, slots: [], connections: [], providers: [], plan: PLANS.free,
    estimate: {}, pageviews: 0, adViews: [], upgrade: null, user: null,
  };
  const plain = dashboard({ ...base, assets: Array.from({ length: 5 }, (_, i) => ({ id: i, status: 'live' })) });
  assert.match(plain, /5 of 20 published files/, 'the count is on the panel');
  assert.ok(!/class="meter/.test(plain), 'and no bar while the plan is comfortable');

  // The tier named must be the NEXT one, not the top of the price list: a Free
  // store is told about Store (NPR 999, 200 files), not Pro.
  const nearDoc = dashboard({
    ...base, nextPlan: nextPlan('free'),
    assets: Array.from({ length: 17 }, (_, i) => ({ id: i, status: 'live' })),
  });
  assert.match(nearDoc, /17 of 20 published files — 3 left on Free/);
  assert.match(nearDoc, /class="meter meter-near"/, 'the bar appears at 80%');
  assert.match(nearDoc, /Store allows 200 files/, 'and names the next tier, not the dearest one');
  assert.ok(!/Pro allows/.test(nearDoc), 'never the top of the list by default');
  assert.equal(nextPlan('pro'), null, 'and the dearest tier has nothing above it');

  const fullDoc = dashboard({ ...base, assets: Array.from({ length: 20 }, (_, i) => ({ id: i, status: 'live' })) });
  assert.match(fullDoc, /class="meter meter-at"/);
  assert.match(fullDoc, /publishing another file will be refused/i, 'the wall is stated before it is hit');

  // The refusal itself must carry the same numbers: the seller who arrives from a
  // failed upload sees the count, not a sentence about "your plan's limit".
  const src = readFileSync(new URL('../server.js', import.meta.url), 'utf8');
  assert.match(src, /limit: \(\{ usage, plan, next \} = \{\}\) =>/, 'the limit flash takes the state as context');
  assert.match(src, /raises that to/, 'and names what the next tier allows');
});

test('the plans table and the running app cannot drift apart unnoticed', async () => {
  // The table is the natural place to edit a limit, and editing it changes
  // NOTHING — the app enforces the JS copy. Two sources of truth with no alarm is
  // how a console ends up showing a capability list that is quietly wrong.
  const { store: s } = await import('../src/store.js');
  const dbPlans = (await s.plansOverview()).plans;
  assert.ok(dbPlans.length >= 3, 'the table has the tiers');
  // Compare directly here as well as through the server helper, so this test
  // fails even if the route is refactored away.
  for (const row of dbPlans) {
    const code = PLANS[row.code];
    assert.ok(code, `the app knows the plan "${row.code}"`);
    assert.equal(Number(row.price_npr), code.priceNpr, `${row.code} price: table and app agree`);
    for (const [key, value] of Object.entries(row.capabilities)) {
      assert.equal(code.capabilities[key], value,
        `${row.code}.${key}: the table says ${JSON.stringify(value)} and the app enforces `
        + `${JSON.stringify(code.capabilities[key])}. Change BOTH, or the console and the product disagree.`);
    }
  }
  assert.deepEqual(planDrift(dbPlans, PLANS), [], 'and the helper the page uses reports no drift');
  // A deliberately wrong row must be reported, in a sentence somebody can act on.
  // The row is mutated inside a COMPLETE table so the only complaints are the two
  // deliberate ones — an incomplete table is itself reported, which is correct
  // and would otherwise drown the assertion.
  const mutated = dbPlans.map((row) => (row.code === 'store'
    ? { ...row, price_npr: 1, capabilities: { ...row.capabilities, max_assets: 5 } } : row));
  const wrong = planDrift(mutated, PLANS);
  assert.equal(wrong.length, 2, `a wrong price and a wrong capability are both reported: ${wrong.join(' | ')}`);
  assert.match(wrong.join(' '), /NPR 1.*NPR 999/);
  assert.match(wrong.join(' '), /max_assets.*5.*200/);
  assert.match(planDrift([], PLANS).join(' '), /not in the table/, 'a missing tier is reported too');
});

// ---------------------------------------------------------------------------
// Rent: terms, age, and one definition of "still owed"
// ---------------------------------------------------------------------------

test('rent has stated terms, and an invoice is age-measured from its own due date', async () => {
  const { rentAge, RENT_TERMS, AGE_BUCKETS } = await import('../src/billing.js');
  const today = new Date('2026-09-22T00:00:00Z');
  const at = (due) => rentAge(due, today);

  assert.ok(RENT_TERMS.dueDays > 0);
  assert.match(RENT_TERMS.sentence, new RegExp(String(RENT_TERMS.dueDays)), 'the sentence states the terms');
  assert.ok(RENT_TERMS.why.length > 20, 'and says why they are what they are');

  assert.equal(at('2026-10-20').level, 'current');
  assert.match(at('2026-10-20').label, /due in 28 days/);
  assert.equal(at('2026-09-22').label, 'due today');
  assert.equal(at('2026-09-21').label, '1 day late', 'the first day late is singular');
  assert.equal(at('2026-09-21').level, 'late');
  assert.equal(at('2026-08-01').level, 'old', 'a month late is past a reminder');
  assert.equal(at('2026-08-01').label, '1 month late', 'and reads in months, singular where it should be');
  assert.equal(at('2026-07-01').level, 'old');
  assert.equal(at('2026-07-01').label, '2 months late');
  assert.equal(at('2026-05-01').level, 'stale', 'past three months is a decision, not a reminder');
  // One unit per column: "2 months" beside "160 days" makes a reader do arithmetic
  // to compare two rows.
  assert.equal(at('2026-05-01').label, '4 months late');
  assert.equal(at('2025-01-01').label, 'over a year late');
  assert.equal(at(null).level, 'unknown', 'an invoice with no due date is unknown, never "on time"');
  assert.equal(at('not a date').level, 'unknown', 'and neither is an unreadable one');

  // The bug that made the rendered page say "NAN DAYS LATE" on every row and put
  // every invoice in the worst bucket: pg hands a `date` column over as a JS Date,
  // and `String(date).slice(0, 10)` is "Thu Oct 22", not "2026-10-22". These
  // assertions use Date OBJECTS for that reason — a string input would pass while
  // the real thing failed.
  const asDate = (iso) => new Date(`${iso}T00:00:00Z`);
  assert.equal(rentAge(asDate('2026-09-21'), today).label, '1 day late', 'a Date object ages correctly');
  assert.equal(rentAge(asDate('2026-07-01'), today).level, 'old');
  assert.equal(rentAge(asDate('2026-10-20'), today).label, 'due in 28 days');
  assert.ok(!/NaN/.test(rentAge(asDate('2026-01-01'), today).label), 'and never prints NaN');

  // Every level the buckets offer must be a level rentAge can produce, or a
  // bucket silently totals zero forever.
  const produced = new Set([at('2026-10-20'), at('2026-09-21'), at('2026-07-01'), at('2026-05-01')]
    .map((x) => x.level));
  for (const b of AGE_BUCKETS) {
    if (b.key === 'unknown') continue;
    assert.ok(produced.has(b.key), `the "${b.key}" bucket is reachable`);
  }
});

test('an invoice is stamped with the terms as they were, not as they are now', async () => {
  const { channel, estimate } = await fixture();
  const invoice = await store.ensureRentInvoice({ channel, estimate });
  assert.ok(invoice, 'an invoice was issued');
  assert.ok(invoice.due_at, 'and it carries a due date');
  // pg returns a `date` column as a JS Date, so `String(value).slice(0, 10)` is
  // "Thu Oct 2" — NaN — not "2026-10-22". The same mistake in a view is what made
  // four pages render "Sat Aug 01"; here it just makes the assertion fail loudly,
  // which is the good version of that bug.
  const iso = (value) => (value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10));
  const due = new Date(`${iso(invoice.due_at)}T00:00:00Z`);
  const issued = new Date(`${iso(invoice.created_at)}T00:00:00Z`);
  assert.ok(!Number.isNaN(due.getTime()), 'the due date parses');
  const days = Math.round((due - issued) / 86400000);
  assert.equal(days, RENT_TERMS.dueDays, 'due exactly the stated number of days after issue, not on read');
});

test('"still owed" is one set of statuses, not three scattered lists', async () => {
  const { OPEN_RENT_STATUSES } = await import('../src/store.js');
  // The bug this locks down: `platformMoney` filtered on ('issued','unpaid',
  // 'overdue') — two of which the CHECK constraint forbids — so every invoice a
  // payer had already claimed to have paid fell out of "invoiced, not collected"
  // while the operator's queue still showed it. Two surfaces, two answers.
  assert.deepEqual([...OPEN_RENT_STATUSES].sort(), ['issued', 'submitted']);

  const { query } = await import('../src/db.js');
  const allowed = await query(
    `select pg_get_constraintdef(oid) as def from pg_constraint
      where conrelid = 'rent_invoices'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%status%'`,
  );
  const def = allowed.rows.map((r) => r.def).join(' ');
  for (const status of OPEN_RENT_STATUSES) {
    assert.ok(def.includes(`'${status}'`), `"${status}" is a status the schema allows`);
  }
  for (const phantom of ['unpaid', 'overdue']) {
    assert.ok(!def.includes(`'${phantom}'`), `"${phantom}" is not a status — a filter naming it can never match`);
    assert.ok(!OPEN_RENT_STATUSES.includes(phantom), 'and it is not in the shared set');
  }
});

test('the aging list is ordered by lateness, and counts what the queue counts', async () => {
  const { channel } = await fixture();
  const today = new Date();
  const day = (n) => new Date(today.getTime() + n * 86400000).toISOString().slice(0, 10);
  // One row per PERIOD: (channel_id, period_start) is unique, so a constant
  // period_start would make the second insert a duplicate-key error rather than a
  // test — which is exactly what the first version of this fixture did.
  const mk = (id, due, status, amount) => query(
    `insert into rent_invoices (channel_id, period_start, period_end, amount_npr, basis, status, due_at)
     values ($1, $2, $3, $4, '{}'::jsonb, $5, $6)`,
    [channel.id, day(-3000 - Number(id) * 400), day(-1 - Number(id)), amount, status, due],
  );
  await mk('1', day(-90), 'issued', 3000);
  await mk('2', day(5), 'issued', 9000);
  await mk('3', day(-5), 'submitted', 1500);
  await mk('4', day(-10), 'paid', 7000);       // collected: never in the aging list
  await mk('5', day(-10), 'waived', 500);      // forgiven: never in the aging list

  const rows = await store.rentAging();
  const mine = rows.filter((r) => r.channel_id === channel.id);
  assert.equal(mine.length, 3, 'open invoices only — a paid or waived invoice is not owed');
  assert.deepEqual(mine.map((r) => Number(r.amount_npr)), [3000, 1500, 9000],
    'oldest due date first: the next action depends on age, not on size');
  assert.ok(mine.every((r) => r.days_late !== null), 'each row carries how late it is');

  const months = await store.rentByMonth({ months: 24 });
  const mineMonths = months.filter((m) => Number(m.invoices) >= 3);
  assert.ok(mineMonths.length >= 1, 'and the monthly view sees this channel\'s invoices');
});

test('the seller who owes rent is told the due date and how late it is', async () => {
  const { billing: sellerBilling } = await import('../src/views.js');
  const channel = {
    id: '00000000-0000-0000-0000-000000000009', slug: 'shop', name: 'Shop', tagline: '',
    plan_code: 'free', subscription_status: null, subscription_end: null, created_at: new Date(),
  };
  const today = new Date();
  const day = (n) => new Date(today.getTime() + n * 86400000).toISOString().slice(0, 10);
  const html = sellerBilling({
    user: { id: 'u', email: 'seller@example.com', display_name: 'Seller' },
    channel, plan: PLANS.free, estimate: { estNpr: 0, rent: 0, total: 3 },
    invoices: [
      { id: 'i1', status: 'issued', amount_npr: 900, period_start: day(-400), period_end: day(-20), due_at: day(10) },
      { id: 'i2', status: 'issued', amount_npr: 900, period_start: day(-760), period_end: day(-380), due_at: day(-65) },
      { id: 'i3', status: 'paid', amount_npr: 900, period_start: day(-1100), period_end: day(-740), due_at: day(-700), paid_at: day(-705) },
    ],
    payments: [], rails: [], payee: 'ByteBikri Pvt Ltd',
  });

  // Every row carries a due date. The count is taken from the fixture's own
  // dates rather than a hardcoded year: the fixture is relative to today, so it
  // crosses a year boundary depending on when it runs.
  const dueDates = [day(10), day(-65), day(-700)];
  for (const d of dueDates) {
    assert.ok(html.includes(d), `the due date ${d} is on the seller's page`);
  }
  assert.match(html, /due in 10 days/, 'an invoice inside the terms says how long is left');
  assert.match(html, /<strong>2 months late<\/strong>/, 'a late one states the age in bold');
  assert.ok(!/NaN/.test(html), 'and nothing on the page is NaN');
  // The paid row must not be told it is late: settled invoices are history. The
  // row is isolated by its own <tr> boundaries — slicing a fixed number of
  // characters around the word 'paid' reached into the late row above it and
  // failed an assertion about correct behaviour.
  const rows = html.slice(html.indexOf('<tbody>'), html.indexOf('</tbody>')).split('<tr>');
  const paidRow = rows.find((r) => /pill-success">paid/.test(r));
  const lateRow = rows.find((r) => /2 months late/.test(r));
  assert.ok(paidRow, 'the paid invoice is in the history');
  assert.ok(lateRow, 'and the late one is too');
  assert.ok(!/late/.test(paidRow), 'a paid invoice is not described as late');
  assert.ok(!/late/.test(paidRow.replace(/pill[^"]*"[^>]*>[^<]*<\/span>/g, '')),
    'nor anywhere else in that row');
});
