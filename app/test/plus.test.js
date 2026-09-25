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
  // The gift: the code, the four states, and the second period's price.
  giftCode, normalizeGiftCode, GIFT_ALPHABET, GIFT_STATE_LINE, GIFT_BUYER_LINE, GIFT_NOT,
  plusYearPrice, plusYearNote, PLUS_YEAR_CODE, PURCHASABLE_PLAN_CODES,
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
  assert.equal(EFFECT_KEYS.length, 6, 'six effects, still one plan — no second charge for a frame');
  assert.equal(effectOf('nonsense').key, 'solid', 'an effect nobody offers is the plain one');
  assert.equal(plateOf('chartreuse').label, plateOf('indigo').label, 'a palette nobody offers is the default one');
});

test('every palette and effect is described in words a member can act on', () => {
  for (const key of PLATE_KEYS) assert.ok(plateOf(key).label.length > 2, `${key} has no label`);
  for (const key of EFFECT_KEYS) {
    const e = EFFECTS[key];
    assert.ok(e.label && e.hint.length > 30, `${key} has no hint`);
  }
  // Motion is described where it exists, and every effect either moves or says that
  // it does not. That sentence is what makes the choice legible to somebody with a
  // reason to avoid animation, so it is asserted per effect rather than in a comment
  // — `test/wear.test.js` does the general sweep; here it is the words on the page.
  assert.match(EFFECTS.halo.hint, /glow/);
  assert.match(EFFECTS.halo.hint, /hover/, 'and its hint says when the motion happens');
  assert.match(EFFECTS.edge.hint, /never moves/);
  assert.match(EFFECTS.solid.hint, /nothing of yours moved/);
  assert.equal(EFFECT_KEYS.filter((k) => EFFECTS[k].moves).length, 4, 'four move, two never do');
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
  assert.match(rosterHtml, /class="member-name wear-halo"/, 'an active wearer’s effect is rendered');
  // AND the store's own chip is still there beside it. This assertion is the one
  // that was missing: the old renderer let the Plus branch REPLACE the store's
  // branch, so a member who paid bytebikri lost the creator's tier chip on the
  // creator's own member list. Two payers, one element, wrong one won.
  assert.match(rosterHtml, /class="store-chip[^"]*"[^>]*>Member</,
    'the creator’s chip must survive a member having bought a look elsewhere');

  // The same row with its period ended: the SQL join drops `plus_status`, and the
  // name falls back to the store's own palette with no extra work and no job to
  // trust. The chip was never theirs, so nothing about it moves.
  const lapsedHtml = views.channelMembers({
    channel: channelRow, user: null, membershipsOn: true,
    members: [memberRow({ plus_status: null, plus_period_end: null })],
  });
  assert.doesNotMatch(lapsedHtml, /wear-halo/, 'and an expired one is not');
  assert.match(lapsedHtml, /class="store-chip[^"]*"[^>]*>Member</, 'the chip is unchanged by any of this');
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

// ---------------------------------------------------------------------------
// Gifting — the researched social feature, and the bug it would have hidden
// ---------------------------------------------------------------------------

test('a gift code is unambiguous when it is read aloud', () => {
  // The alphabet is the whole safety property of a bearer token that gets typed by
  // somebody reading it off a phone screen: I, O, 0 and 1 are gone because they are
  // the four characters that require handwriting to tell apart.
  for (const bad of ['I', 'O', '0', '1']) {
    assert.ok(!GIFT_ALPHABET.includes(bad), `${bad} cannot appear in a code — it is indistinguishable from its pair`);
  }
  const code = giftCode();
  assert.match(code, /^BKP-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  assert.match(normalizeGiftCode(code.toLowerCase()), /^BKP-/,
    'a code typed in lower case with no dashes is the same code');
  assert.equal(normalizeGiftCode('bkp abcd efgh'), 'BKP-ABCD-EFGH');
  assert.equal(normalizeGiftCode('not a code'), null);
  assert.equal(normalizeGiftCode(''), null);
  assert.equal(normalizeGiftCode('BKP-ABCD-EFG'), null, 'a short code is not a code');
  // And it is drawn from the CSPRNG, not from Math.random: a guessable code is a free
  // month for whoever guesses it.
  const many = new Set(Array.from({ length: 200 }, () => giftCode()));
  assert.equal(many.size, 200, 'two hundred codes, two hundred strings');
});

test('every state a gift can be in is said to both of the people looking at it', () => {
  for (const key of ['reserved', 'funded', 'redeemed', 'void']) {
    assert.ok(GIFT_STATE_LINE[key], `no sentence for a ${key} gift`);
    assert.ok(GIFT_BUYER_LINE[key], `nothing to tell the buyer about a ${key} gift`);
  }
  // The distinction that matters most: a reserved code does NOT work yet, and both
  // sentences have to say so — one to the buyer, one to whoever is holding it.
  assert.match(GIFT_STATE_LINE.reserved, /does not work|not live|not work/);
  assert.match(GIFT_BUYER_LINE.reserved, /starts working/);
  assert.equal(GIFT_NOT.length, 4, 'four things a gift is not, and each one is a sentence');
});

test('a year is the same plan, and the discount is derived rather than typed', () => {
  assert.equal(plusYearPrice(149), 1490, 'ten months for twelve — two months free');
  assert.match(plusYearNote(149), /Two months free/);
  assert.match(plusYearNote(149), /298/, 'and the saving in rupees, not in adjectives');
  // A discount written a second time is a discount that drifts: the note is computed
  // from the monthly price, so the two can never disagree.
  assert.notEqual(plusYearNote(200), plusYearNote(149));
});

test('the annual plan is the monthly plan, byte for byte', async () => {
  const month = await store.customerPlan(PLUS_CODE);
  const year = await store.customerPlan(PLUS_YEAR_CODE);
  assert.ok(year, 'migration 0042 seeds the second period');
  assert.equal(year.period_months, 12);
  assert.deepEqual(year.capabilities, month.capabilities,
    'a perk difference between the two periods would make the annual plan a second product');
  assert.equal(Number(year.price_npr), plusYearPrice(Number(month.price_npr)),
    'and the price is the derived one, not a number somebody typed twice');
});

test('a gift never touches the buyer’s own arrangement, and its period lands on the redeemer', async () => {
  const { owner, person } = await fixture();
  const friend = await store.userByEmailOrCreate(`plus-friend-${Date.now()}@test.local`);

  // The buyer has a month running. Buying a friend a month must not disturb it —
  // `claimPlus` would have flipped this row to pending_payment and stopped the look.
  const before = await store.claimPlus({
    profileId: owner.id, planCode: PLUS_CODE, amountNpr: 149, txnReference: `GIFTBASE-${Date.now()}`,
  });
  assert.equal(before.ok, true);
  const matchedBase = await store.matchCustomerPlanPayment({ paymentId: before.payment.id, actorId: null });
  assert.ok(matchedBase, 'the buyer has an arrangement');

  const claim = await store.claimPlusGift({
    profileId: owner.id, planCode: PLUS_CODE, amountNpr: 149,
    txnReference: `GIFT-${Date.now()}`, note: 'for a friend',
  });
  assert.equal(claim.ok, true, 'the gift is claimed');
  assert.match(claim.gift.code, /^BKP-/);
  assert.equal(claim.gift.status, 'reserved');

  // The buyer's own row is untouched: still active, and its end date unmoved.
  const mine = await store.customerSubscription(owner.id);
  assert.equal(mine.status, 'active', 'buying a gift stopped the buyer’s own arrangement');
  assert.equal(new Date(mine.period_end).getTime(), new Date(matchedBase.subscription.period_end).getTime(),
    'buying a gift moved the buyer’s own renewal date');

  // A reserved code does not work.
  const early = await store.redeemPlusGift({ code: claim.gift.code, profileId: friend.id });
  assert.deepEqual(early, { ok: false, code: 'gift-unfunded' });

  // The match funds the GIFT rather than activating the payer.
  const matched = await store.matchCustomerPlanPayment({ paymentId: claim.payment.id, actorId: null });
  assert.equal(matched.isGift, true);
  assert.equal(matched.gift.status, 'funded');
  const stillMine = await store.customerSubscription(owner.id);
  assert.equal(new Date(stillMine.period_end).getTime(), new Date(mine.period_end).getTime(),
    'matching a gift stamped a period on the buyer');

  // Nobody redeems their own gift.
  const selfish = await store.redeemPlusGift({ code: claim.gift.code, profileId: owner.id });
  assert.deepEqual(selfish, { ok: false, code: 'gift-self' });

  // The friend redeems it, and the period lands on THEIR row.
  const used = await store.redeemPlusGift({ code: claim.gift.code, profileId: friend.id });
  assert.equal(used.ok, true);
  assert.equal(used.months, 1);
  const theirs = await store.customerSubscription(friend.id);
  assert.equal(theirs.status, 'active');
  assert.ok(new Date(theirs.period_end) > new Date(), 'the gift started a period for the redeemer');

  // Once, and once only.
  const again = await store.redeemPlusGift({ code: claim.gift.code, profileId: person.id });
  assert.deepEqual(again, { ok: false, code: 'gift-used' });
  // And an unknown code is refused by name rather than by silence.
  const nothing = await store.redeemPlusGift({ code: 'BKP-ZZZZ-ZZZZ', profileId: person.id });
  assert.deepEqual(nothing, { ok: false, code: 'gift-unknown' });
});

test('a gift received while a month is running extends it instead of replacing it', async () => {
  const { owner } = await fixture();
  const friend = await store.userByEmailOrCreate(`plus-extend-${Date.now()}@test.local`);
  const first = await store.claimPlus({
    profileId: friend.id, planCode: PLUS_CODE, amountNpr: 149, txnReference: `EXT1-${Date.now()}`,
  });
  await store.matchCustomerPlanPayment({ paymentId: first.payment.id, actorId: null });
  const before = await store.customerSubscription(friend.id);

  const claim = await store.claimPlusGift({
    profileId: owner.id, planCode: PLUS_CODE, amountNpr: 149, txnReference: `EXT2-${Date.now()}`,
  });
  await store.matchCustomerPlanPayment({ paymentId: claim.payment.id, actorId: null });
  const used = await store.redeemPlusGift({ code: claim.gift.code, profileId: friend.id });
  assert.equal(used.ok, true);

  const after = await store.customerSubscription(friend.id);
  const grew = new Date(after.period_end).getTime() - new Date(before.period_end).getTime();
  const month = 30 * 86400000;
  assert.ok(Math.abs(grew - 31 * 86400000) < 3 * 86400000 || grew >= month,
    `a gift replaced a running period instead of extending it (grew ${Math.round(grew / 86400000)} days)`);
});

test('paying early extends the period instead of throwing the days away', async () => {
  // The defect this test exists for: `matchCustomerPlanPayment` used to write
  // `period_end = now() + months`, so somebody with 20 days left who paid for the next
  // month LOST those 20 days. A renewal that costs days is a renewal nobody makes twice.
  const { owner } = await fixture();
  const first = await store.claimPlus({
    profileId: owner.id, planCode: PLUS_CODE, amountNpr: 149, txnReference: `EARLY1-${Date.now()}`,
  });
  const one = await store.matchCustomerPlanPayment({ paymentId: first.payment.id, actorId: null });
  const end1 = new Date(one.subscription.period_end).getTime();

  const second = await store.claimPlus({
    profileId: owner.id, planCode: PLUS_CODE, amountNpr: 149, txnReference: `EARLY2-${Date.now()}`,
  });
  const two = await store.matchCustomerPlanPayment({ paymentId: second.payment.id, actorId: null });
  const end2 = new Date(two.subscription.period_end).getTime();
  const grew = Math.round((end2 - end1) / 86400000);
  assert.equal(grew, 31, `paying early moved the end date by ${grew} days instead of adding a month`);

  // And the row now says which period was matched, so a year bought after a month is
  // not carried under a row that still says `plus`.
  assert.equal(two.subscription.plan_code, PLUS_CODE);
  const bought = await store.claimPlus({
    profileId: owner.id, planCode: 'plus-year', amountNpr: 1490, txnReference: `EARLY3-${Date.now()}`,
  });
  const three = await store.matchCustomerPlanPayment({ paymentId: bought.payment.id, actorId: null });
  assert.equal(three.subscription.plan_code, 'plus-year');
  const grewTwelve = Math.round((new Date(three.subscription.period_end).getTime() - end2) / 86400000);
  assert.ok(grewTwelve > 360, `a year added ${grewTwelve} days`);
});

test('the page says both periods, the codes somebody holds, and what a gift is not', () => {
  const html = views.plusPage({
    user: { id: 'p1', email: 'nima@test.local', display_name: 'Nima', email_verified_at: '2026-01-01' },
    plan: { code: 'plus', name: 'ByteBikri Plus', price_npr: 149, period_months: 1 },
    yearPlan: { code: 'plus-year', name: 'ByteBikri Plus — a year', price_npr: 1490, period_months: 12 },
    state: 'none', rails: [{ id: 'esewa', label: 'eSewa', handle: '9800000001', ready: true }],
    railsReady: true,
    gifts: [{ code: 'BKP-ABCD-EFGH', status: 'funded', months: 1, plan_code: 'plus' }],
  });
  assert.match(html, /name="plan" value="plus"/, 'the month is offered');
  assert.match(html, /name="plan" value="plus-year"/, 'and so is the year');
  assert.match(html, /NPR 1,490/, 'at the derived price');
  assert.match(html, /Two months free/);
  assert.match(html, /action="\/plus\/gift"/, 'there is a way to buy one');
  assert.match(html, /action="\/plus\/gift\/redeem"/, 'and a way to use one');
  assert.match(html, /BKP-ABCD-EFGH/, 'the code the buyer has is on their own page');
  assert.match(html, /data-gift-status="funded"/, 'with its state as data, not only as words');
  assert.match(html, /ready to give/i);
  // The recipient's half must ask for nothing but a code: a gift is not a payment.
  const redeem = html.slice(html.indexOf('/plus/gift/redeem'));
  assert.ok(!/txnReference/.test(redeem.slice(0, 1200)), 'using a gift asks for a transaction reference');
});

test('a page with no gifts yet states what a gift is not, before anybody buys one', () => {
  const html = views.plusPage({
    user: { id: 'p1', email: 'nima@test.local', display_name: 'Nima' },
    plan: { code: 'plus', name: 'ByteBikri Plus', price_npr: 149, period_months: 1 },
    state: 'none', gifts: [],
  });
  for (const line of GIFT_NOT) {
    assert.ok(html.includes(line.slice(0, 40)), 'the page does not print what a gift is not');
  }
  assert.match(html, /What a gift is not/);
});

test('every code a route may accept names a plan that exists', async () => {
  // The bug this test exists for: `plusContext` was written against a plan key that
  // existed only in the file that used it, and NOTHING in the suite noticed, because
  // the page is rendered directly in tests while the route is what read the key. The
  // first request to `/plus` in a browser answered 500. A constant that a route reads
  // is now asserted against the table the route reads it from.
  assert.equal(PURCHASABLE_PLAN_CODES.length, 2, 'a month and a year, and no third thing');
  assert.ok(PURCHASABLE_PLAN_CODES.includes(PLUS_CODE));
  assert.ok(PURCHASABLE_PLAN_CODES.includes(PLUS_YEAR_CODE));
  for (const code of PURCHASABLE_PLAN_CODES) {
    const plan = await store.customerPlan(code);
    assert.ok(plan, `the route offers ${code} and no such plan exists`);
    assert.equal(plan.active, true, `${code} is offered to people and is not active`);
    assert.equal(plan.capabilities.opens_content, false);
    assert.equal(plan.capabilities.removes_ads, false);
  }
  // And the migration's own list is the same list: a third period added to the table
  // without being offered, or offered without existing, both fail here.
  const all = await store.customerPlans();
  assert.deepEqual(all.map((p) => p.code).sort(), [...PURCHASABLE_PLAN_CODES].sort(),
    'the plans table and the codes the routes accept have drifted apart');
});

test('the seller’s money map names both periods, at the table’s own numbers', async () => {
  // The copy a seller reads when they ask "what is this charge on the statement?" — it
  // used to name one price, and a year arrives as a different number. Both are read out
  // of the plan rows rather than typed here, so a price change that misses this sentence
  // fails this test instead of misleading a creator.
  const { MONEY_MAP } = await import('../src/earnings.js');
  const detail = MONEY_MAP.toPlatformFromPeople.detail;
  const [month, year] = [await store.customerPlan(PLUS_CODE), await store.customerPlan(PLUS_YEAR_CODE)];
  assert.ok(detail.includes(`NPR ${Number(month.price_npr).toLocaleString('en-IN')} a month`),
    `the money map does not name ${month.price_npr} a month`);
  assert.ok(detail.includes(`${Number(year.price_npr).toLocaleString('en-IN')} for a year`),
    `the money map does not name ${year.price_npr} for a year`);
  // And the answers the row exists for survive the numbers being added.
  assert.match(detail, /opens no file, removes no ad/);
  assert.match(detail, /takes nothing from what you earn/);
});
