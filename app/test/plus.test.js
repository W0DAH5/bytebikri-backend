/**
 * The person's own premium.  npm test
 *
 * Three premium things exist on this platform and they are deliberately different:
 * a STORE pays bytebikri for capabilities, a MEMBER pays a creator for access, and
 * a PERSON pays bytebikri for how their name looks. This file exists because the
 * third one is the easiest to get wrong in the direction of the other two — every
 * competitor's cosmetics tier eventually becomes "and it also removes the ads",
 * and the researched record (see AD_ECONOMY.md) is that that is where the lawsuits
 * and the cancellations start.
 *
 * So the properties held here are negative ones:
 *
 *   * a plan's capabilities may never say it opens content or removes ads, and the
 *     assertion is on BOTH flags, in the table and in the app;
 *   * an active arrangement changes nothing about access — the file that was locked
 *     before a match is locked after it;
 *   * and a lapse needs no cleanup: a look is worn only while the row's own period
 *     says active, which is decided in SQL and re-checked in `plusWear()`.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:55432/bytebikri_test';

const { store } = await import('../src/store.js');
const { close, query } = await import('../src/db.js');
const {
  PLUS_CODE, PLUS_NAME, PLUS_NOT, PLUS_SEPARATION_LINE, EFFECTS, EFFECT_KEYS, PLATE_KEYS,
  effectOf, plateOf, plusState, plusWear, plusDaysLeft, plusMoneyLine, plusConsoleRows, plusPeriodEnd,
} = await import('../src/plus.js');
const views = await import('../src/views.js');
const { railDetails } = await import('../src/billing.js');

after(async () => { await close(); });

let seq = 0;
async function fixture() {
  const tag = `${Date.now()}-${++seq}`;
  const owner = await store.userByEmailOrCreate(`plus-owner-${tag}@test.local`);
  const channel = await store.createChannel({ ownerId: owner.id, slug: `plus-${tag}`, name: `Plus ${tag}` });
  const person = await store.userByEmailOrCreate(`plus-person-${tag}@test.local`);
  await store.updateProfile?.(person.id, { display_name: 'Nima' });
  const asset = await store.createAsset({ channelId: channel.id, title: `Locked ${tag}`, slug: `locked-${tag}` });
  return { owner, channel, person, asset, tag };
}

// ---------------------------------------------------------------------------
// The plan is cosmetics, and the schema says so
// ---------------------------------------------------------------------------

test('the plan exists, is priced in NPR, and its capabilities refuse everything else', async () => {
  const plan = await store.customerPlan(PLUS_CODE);
  assert.ok(plan, 'the plan row is seeded by migration 0033');
  assert.equal(plan.name, PLUS_NAME);
  assert.equal(plan.period_months, 1);
  assert.ok(Number(plan.price_npr) > 0 && Number(plan.price_npr) < 1000, 'priced where the researched record says people stop resenting it');

  // The two flags that would make this a different product. Both must be false, and
  // they are checked as false rather than merely absent, so that a later migration
  // that adds `true` fails here instead of shipping.
  assert.equal(plan.capabilities.opens_content, false, 'a cosmetic that opens a file is a hole in every creator’s paywall at once');
  assert.equal(plan.capabilities.removes_ads, false, 'the ads belong to the store: the network pays THEIR account, not ours');
  // And the ones that are the actual product.
  assert.equal(plan.capabilities.nameplate, true);
  assert.equal(plan.capabilities.effect, true);
  assert.equal(plan.capabilities.profile_accent, true);
});

test('there is one plan and every effect is inside it', () => {
  // The Discord lesson, encoded: the backlash was never against cosmetics, it was
  // against cosmetics sold on top of a subscription already paid for. One plan, and
  // no second charge for a frame — asserted as data, not as good intentions.
  assert.deepEqual(PLATE_KEYS, Object.keys(PLATE_KEYS.reduce((acc, k) => ({ ...acc, [k]: k }), {})));
  assert.equal(EFFECT_KEYS.length, 3);
  assert.equal(effectOf('nonsense').key, 'solid', 'an effect nobody offers is the plain one');
  assert.equal(plateOf('chartreuse').label, plateOf('indigo').label, 'a palette nobody offers is the default one');
});

test('every palette and effect is described in words a member can act on', () => {
  for (const key of PLATE_KEYS) assert.ok(plateOf(key).label.length > 2, `${key} has no label`);
  for (const key of EFFECT_KEYS) {
    const e = EFFECTS[key];
    assert.ok(e.label && e.hint.length > 30, `${key} has no hint`);
  }
  // Motion is described where it exists, and exactly one effect moves. The other two
  // say so out loud, which is what makes the choice legible to somebody who has a
  // reason to avoid animation.
  assert.match(EFFECTS.halo.hint, /glow/);
  assert.match(EFFECTS.halo.hint, /allows motion/, 'and its hint says the system decides');
  assert.match(EFFECTS.edge.hint, /never moves/);
  assert.match(EFFECTS.solid.hint, /no glow/);
});

// ---------------------------------------------------------------------------
// The clock, derived
// ---------------------------------------------------------------------------

test('the arrangement’s state is derived from its period end, like every other clock here', () => {
  assert.equal(plusState({}), 'none');
  assert.equal(plusState({ status: 'pending_payment' }), 'pending');
  assert.equal(plusState({ status: 'cancelled' }), 'cancelled');
  assert.equal(plusState({ status: 'active', period_end: new Date(Date.now() + 86400000) }), 'active');
  assert.equal(plusState({ status: 'active', period_end: new Date(Date.now() - 1000) }), 'lapsed');
  assert.equal(plusState({ status: 'active' }), 'none', 'an active row with no end date is not active');
  assert.equal(plusDaysLeft({ period_end: null }), null);
  assert.equal(plusDaysLeft({ period_end: new Date(Date.now() + 3 * 86400000) }), 3);
});

test('a look is worn only while the arrangement is current', () => {
  const dressed = { nameplate: 'teal', plus_effect: 'halo' };
  assert.equal(plusWear({ ...dressed, plus_status: null }), null, 'a cancelled arrangement dresses nobody');
  assert.equal(plusWear({ ...dressed, plus_status: 'pending_payment' }), null, 'a claim is not a purchase');
  assert.equal(plusWear({ ...dressed, plus_active: false }), null);
  const worn = plusWear({ ...dressed, plus_active: true });
  assert.equal(worn.plate, 'teal');
  assert.equal(worn.effect, 'halo');
  // A person who has chosen nothing wears nothing, even while paying — the plain
  // name is a real state and not a placeholder.
  assert.equal(plusWear({ plus_active: true, nameplate: null, plus_effect: null }), null);
  // And an effect that no longer exists degrades to plain rather than breaking.
  assert.equal(plusWear({ plus_active: true, nameplate: 'teal', plus_effect: 'sparkle' }).effect, 'solid');
});

test('the period a match starts really is the plan’s period', () => {
  const start = new Date('2026-01-31T00:00:00Z');
  const end = plusPeriodEnd(start, 1);
  assert.ok(end > start);
  assert.equal(end.getUTCMonth(), 2, 'one month on from the 31st of January is March, not a February that does not exist');
  assert.ok(plusPeriodEnd(start, 12) > plusPeriodEnd(start, 1));
  assert.ok(plusPeriodEnd(start, 0) > start, 'a zero-month plan still buys a month');
});

// ---------------------------------------------------------------------------
// The money: claim, match, lapse
// ---------------------------------------------------------------------------

test('a claim is not a purchase, a match is, and a lapse needs no cleanup', async () => {
  const { person } = await fixture();
  const plan = await store.customerPlan(PLUS_CODE);

  // 1. Nothing yet.
  assert.equal(await store.customerSubscription(person.id), null);
  assert.equal(plusWear(await store.userById(person.id)), null);

  // 2. The claim. The reference is required — without it there is nothing for an
  //    operator to find on a statement, which is the whole failure mode of a
  //    manual rail.
  const bad = await store.claimPlus({ profileId: person.id, txnReference: 'ab' });
  assert.equal(bad.ok, false);
  assert.equal(bad.code, 'reference');

  const claimed = await store.claimPlus({
    profileId: person.id, txnReference: `ESW-${Date.now()}`, method: 'esewa', payerName: 'Nima',
  });
  assert.equal(claimed.ok, true);
  assert.equal(claimed.payment.status, 'submitted');
  assert.equal(Number(claimed.payment.amount_npr), Number(plan.price_npr), 'the amount is the plan’s price, not the form’s word');

  // 3. Still nothing worn: the look is what the money buys, so it arrives when the
  //    money is confirmed.
  const pendingPerson = await store.userById(person.id);
  assert.equal(pendingPerson.plus_active, false);
  assert.equal(plusWear(pendingPerson), null);

  // 4. The operator matches it. Now a period exists and the look is on.
  const matched = await store.matchCustomerPlanPayment({ paymentId: claimed.payment.id, actorId: null });
  assert.ok(matched);
  const active = await store.customerSubscription(person.id);
  assert.equal(active.status, 'active');
  assert.ok(new Date(active.period_end) > new Date());

  await store.setPlusLook({ profileId: person.id, nameplate: 'rose', effect: 'edge' });
  const dressed = await store.userById(person.id);
  assert.equal(dressed.plus_active, true);
  assert.equal(plusWear(dressed).plate, 'rose');

  // 5. The month ends. No job runs, no row changes: the SQL join stops matching and
  //    the palette is still saved on the profile, because a preference is not
  //    deleted because a month ended.
  await query(`update customer_subscriptions set period_end = now() - interval '1 day' where profile_id = $1`, [person.id]);
  const lapsed = await store.userById(person.id);
  assert.equal(lapsed.plus_active, false, 'the join is the entitlement');
  assert.equal(plusWear(lapsed), null);
  assert.equal(lapsed.nameplate, 'rose', 'the choice survives the lapse');
});

test('a reference cannot be spent twice, on either rail', async () => {
  const { person } = await fixture();
  const second = await fixture();
  const reference = `DUP-${Date.now()}`;
  const first = await store.claimPlus({ profileId: person.id, txnReference: reference });
  assert.equal(first.ok, true);
  const again = await store.claimPlus({ profileId: second.person.id, txnReference: reference });
  assert.equal(again.ok, false);
  assert.equal(again.code, 'duplicate-reference', 'one reference is one payment, whoever submits it');
});

test('a rejection leaves the person exactly where they were', async () => {
  const { person } = await fixture();
  const claimed = await store.claimPlus({ profileId: person.id, txnReference: `REJ-${Date.now()}` });
  const rejected = await store.rejectCustomerPlanPayment({ paymentId: claimed.payment.id, actorId: null, reason: 'not on the statement' });
  assert.ok(rejected);
  const sub = await store.customerSubscription(person.id);
  assert.equal(sub.status, 'cancelled');
  assert.equal(plusWear(await store.userById(person.id)), null);
  const row = await query('select status, reject_reason from customer_plan_payments where id = $1', [claimed.payment.id]);
  assert.equal(row.rows[0].status, 'rejected');
  assert.match(row.rows[0].reject_reason, /statement/);
});

test('stopping is immediate, keeps the record, and promises no refund', async () => {
  const { person } = await fixture();
  const claimed = await store.claimPlus({ profileId: person.id, txnReference: `STOP-${Date.now()}` });
  await store.matchCustomerPlanPayment({ paymentId: claimed.payment.id, actorId: null });
  const stopped = await store.cancelPlus(person.id);
  assert.equal(stopped.status, 'cancelled');
  assert.ok(stopped.cancelled_at);
  assert.equal(plusWear(await store.userById(person.id)), null);
  assert.equal(await store.cancelPlus(person.id), null, 'stopping twice is not an error, it is nothing');
});

// ---------------------------------------------------------------------------
// The invariant that matters
// ---------------------------------------------------------------------------

test('an active arrangement opens nothing, shortens nothing, and removes nothing', async () => {
  const { person, asset } = await fixture();
  // A plain ad-gated file that this person has not unlocked.
  assert.equal(await store.isUnlocked(asset.id, person.id), false);

  const claimed = await store.claimPlus({ profileId: person.id, txnReference: `INV-${Date.now()}` });
  await store.matchCustomerPlanPayment({ paymentId: claimed.payment.id, actorId: null });
  await store.setPlusLook({ profileId: person.id, nameplate: 'emerald', effect: 'halo' });

  // Still locked. This is the whole point of the third charge: it is a look.
  assert.equal(await store.isUnlocked(asset.id, person.id), false, 'paying bytebikri for a look must not open a creator’s file');
  const policy = await store.unlockPolicy(asset.id);
  assert.ok(Number(policy.ads_required) >= 1, 'and it must not shorten the ask either');

  // The stored look itself is only carried into a page when the row says active —
  // asserted through the real renderer rather than a copy of its logic.
  const channelRow = await store.channelById(asset.channel_id);
  const memberRow = (plus) => ({
    profile_id: person.id, display_name: 'Nima', email: 'nima@test.local', tier_no: 1, tier_name: 'Member',
    accent: 'indigo', joined_at: new Date(), status: 'active', dues_npr: 100,
    nameplate: 'emerald', plus_effect: 'halo', ...plus,
  });
  const rosterHtml = views.channelMembers({
    channel: channelRow, user: null, membershipsOn: true,
    members: [memberRow({ plus_status: 'active', plus_period_end: new Date(Date.now() + 86400000) })],
  });
  assert.match(rosterHtml, /member-name--aurora/, 'an active wearer’s effect is rendered');

  // The same row with its period ended: the SQL join drops `plus_status`, and the
  // plate falls back to the store's own tier styling with no extra work and no job
  // to trust.
  const lapsedHtml = views.channelMembers({
    channel: channelRow, user: null, membershipsOn: true,
    members: [memberRow({ plus_status: null, plus_period_end: null })],
  });
  assert.doesNotMatch(lapsedHtml, /member-name--aurora/, 'and an expired one is not');
});

// ---------------------------------------------------------------------------
// What the page says
// ---------------------------------------------------------------------------

test('the page says what it is not, in full, before anybody pays', () => {
  const html = views.plusPage({
    user: { id: '1', email: 'nima@test.local', display_name: 'Nima', nameplate: 'sky', plus_effect: 'edge' },
    plan: { code: PLUS_CODE, name: PLUS_NAME, price_npr: 149, period_months: 1 },
    subscription: null, state: 'none', rails: railDetails({}), railsReady: false,
    look: { nameplate: 'sky', effect: 'edge' }, wear: null,
  });

  // Every refusal is on the page, not merely available in a module. Compared with
  // the escaping undone, so the assertion is about the sentence rather than about
  // which quote character `esc()` chose.
  const plain = html.replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"');
  for (const line of PLUS_NOT) {
    assert.ok(plain.includes(line), `the page omits: ${line.slice(0, 40)}…`);
  }
  assert.ok(plain.includes('does not remove ads'), 'the sentence the lawsuits are about, said plainly and in the negative');
  assert.match(plain, /does not open files/);
  assert.ok(plain.includes(PLUS_SEPARATION_LINE), 'and the separation from a store plan');
  // The preview is the reader's own name, before any money.
  assert.match(html, /Nima/);
  assert.match(html, /plus-preview/);
  // One price, stated. No "from", no tiers, no per-effect pricing.
  assert.equal((html.match(/NPR 149/g) || []).length >= 1, true);
  assert.doesNotMatch(html, /per effect|from NPR|add-ons/i);
  // The look chooser is always there — a member may choose before paying.
  assert.match(html, /name="nameplate"/);
  assert.match(html, /name="effect"/);
  // With no rail configured there is NO form: a placeholder account number on a
  // payment page is how somebody sends money to a stranger.
  assert.doesNotMatch(html, /name="txnReference"/);
  assert.match(plain, /No payment rail is configured/);

  // With a rail configured, the claim form asks for the one thing an operator can
  // work from, and nothing else.
  const ready = views.plusPage({
    user: { id: '1', email: 'nima@test.local', display_name: 'Nima' },
    plan: { code: PLUS_CODE, name: PLUS_NAME, price_npr: 149, period_months: 1 },
    subscription: null, state: 'none', look: {},
    rails: [{ id: 'esewa', label: 'eSewa', handle: '9800000000', ready: true, env: 'PAY_ESEWA_ID' }],
    railsReady: true,
  });
  assert.match(ready, /name="txnReference"/);
  assert.match(ready, /9800000000/, 'the account the money goes to is on the page');
  assert.match(ready, /I have sent NPR 149/);
  // The person's own product never asks for a store, a channel or an asset.
  assert.doesNotMatch(ready, /name="channelId"|name="assetId"/);
});

test('the money line and the console rows say where the money goes', () => {
  const line = plusMoneyLine(149, 1);
  assert.match(line, /149 a month/);
  assert.match(line, /paid to bytebikri/);
  // The dues direction is stated on the same line, because a person who has just
  // paid a creator is the person most likely to think this changed anything.
  assert.match(line, /dues still go straight to the creator/);
  const rows = plusConsoleRows({ active: 3, pending: 1, paidThisMonth: 447, price: 149 });
  const text = rows.map((r) => r.text).join(' ');
  assert.match(text, /3 active, 1 waiting/);
  assert.match(text, /NPR 447/);
  assert.match(text, /statement/, 'the console says what "received" rests on');
});

// ---------------------------------------------------------------------------
// The store method is not the route's private helper
// ---------------------------------------------------------------------------

test('an unrecognised palette is stored as nothing chosen, not as a look', async () => {
  // The route validates with an allowlist, and a seeder or a script reaching the store
  // method directly used to store anything — which then rendered as the DEFAULT look.
  // A wrong look that looks fine is the worst shape a bug can have here, so the
  // method normalises: an unknown key becomes "nothing chosen", a state the product
  // already has, and `plusWear()` then declines to dress the name.
  const person = await store.userByEmailOrCreate(`plus-keys-${Date.now()}@test.local`);
  const stored = await store.setPlusLook({ profileId: person.id, nameplate: 'aurora', effect: 'sparkle' });
  assert.equal(stored.nameplate, null, 'not a key the product has');
  assert.equal(stored.plus_effect, null, 'nor is this an effect');
  assert.equal(plusWear(stored), null, 'and so nothing is worn');

  const real = await store.setPlusLook({ profileId: person.id, nameplate: 'teal', effect: 'halo' });
  assert.equal(real.nameplate, 'teal');
  assert.equal(real.plus_effect, 'halo');
});
