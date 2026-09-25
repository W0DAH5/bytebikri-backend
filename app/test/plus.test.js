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
import { readFileSync, readdirSync } from 'node:fs';

process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:55432/bytebikri_test';

const { store } = await import('../src/store.js');
const { close, query } = await import('../src/db.js');
const {
  PLUS_CODE, PLUS_NAME, PLUS_NOT, PLUS_SEPARATION_LINE, EFFECTS, EFFECT_KEYS, PLATE_KEYS,
  effectOf, plateOf, plusState, plusWear, plusDaysLeft, plusMoneyLine, plusConsoleRows, plusPeriodEnd,
  // The gift: the code, the four states, and the second period's price.
  giftCode, normalizeGiftCode, GIFT_ALPHABET, GIFT_STATE_LINE, GIFT_BUYER_LINE, GIFT_NOT,
  plusYearPrice, plusYearNote, PLUS_YEAR_CODE, PURCHASABLE_PLAN_CODES,
  // The person's own band: the second band recipe, and the bound it is measured at.
  personBand, OWN_BAND_LINE, OWN_BAND_MIX,
  // The blended catalogue (§11) and the one fact it added to the badge.
  PERKS, PERK_OWNERS, PERK_STATES, perkProblems, perksByState, memberSince, memberSinceWords,
} = await import('../src/plus.js');
const { slotOf } = await import('../src/cosmetics.js');
const { ACCENTS } = await import('../src/memberships.js');
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

// ── the page that is yours ──────────────────────────────────────────────────

const wearer = (extra = {}) => ({
  id: 'p-band', email: 'band@test.local', display_name: 'Band',
  plus_status: 'active', plus_period_end: '2099-01-01T00:00:00.000Z',
  nameplate: 'teal', plus_effect: 'halo', ...extra,
});

test('a band appears exactly when a look is worn, and on no store’s page', () => {
  // The decision is `plusWear`'s and nothing else — one rule, not two.
  assert.equal(personBand(null), null);
  assert.equal(personBand({ plus_status: 'none', nameplate: 'teal', plus_effect: 'halo' }), null,
    'no arrangement, no band');
  assert.equal(personBand({ plus_status: 'active', period_end: '2000-01-01', nameplate: 'teal', plus_effect: 'halo' }), null,
    'a period that ended wears nothing');
  assert.equal(personBand(wearer({ nameplate: null, plus_effect: null })), null,
    'a month running with nothing chosen paints nothing — the picker is what changes it');

  const band = personBand(wearer());
  assert.equal(band.palette, 'teal');
  assert.equal(band.paletteLabel, 'Teal');
  assert.equal(band.effectLabel, 'Halo');
  assert.equal(band.from, ACCENTS.teal.from);
  assert.equal(band.to, ACCENTS.teal.to);
  assert.equal(band.style, `--theme-from:${ACCENTS.teal.from};--theme-to:${ACCENTS.teal.to};`,
    '`from` stays the lighter stop so the stylesheet’s ink tokens apply unchanged');
});

test('the band is on the library, absent without it, and never on a storefront', () => {
  const painted = views.library({ user: wearer(), unlocks: [], counts: {}, shelf: [] });
  assert.match(painted, /class="section own-band own-band--themed"/);
  assert.match(painted, /--theme-from:#0f766e/);
  assert.match(painted, /Teal · Halo — Your palette and your effect/,
    'the band names the palette and the effect it is painting');
  assert.match(painted, /Nobody else sees this band/);
  assert.match(painted, /<h1>Your library<\/h1>/, 'and it is still the page’s own head');

  const plain = views.library({ user: { id: 'p-other', email: 'o@test.local', display_name: 'Other' }, unlocks: [], counts: {}, shelf: [] });
  assert.ok(!/own-band/.test(plain), 'a person who is not wearing a look gets the plain head, unchanged');
  assert.match(plain, /<h1>Your library<\/h1>/);

  // The store's page is the store's surface. This is the two-layer rule as an assertion.
  const storefront = views.storefront({
    channel: {
      id: 'c-band', slug: 'bandstore', name: 'Band Store', tagline: 'x', owner_id: 'p-band',
      banner_url: null, logo_url: null, listing_mode: 'marketplace',
    },
    assets: [], slots: [], user: wearer(), estimate: null, pageviews: 0, theme: null, themeStyle: '',
  });
  assert.ok(!/own-band/.test(storefront), 'a member’s palette repainted a store’s page');
});

test('white clears 5.5:1 on the band of every palette a person may wear', () => {
  // The store band's bar, applied to the SECOND recipe. The person's palettes are inks,
  // not surfaces — painted as a band straight away, rose reaches 4.56:1 for white and
  // 4.05:1 for the 92% ink, which is below the body floor. So the deep stop is the
  // surface and the lighter one is bounded: measured here at `OWN_BAND_MIX`, with the
  // grain composited, the way the store band is measured — one standard, two recipes.
  const hexRgb = (hex) => {
    const h = String(hex).replace('#', '');
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  };
  const lum = ([r, g, b]) => {
    const lin = (c) => {
      const v = c / 255;
      return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  };
  const ratio = (a, b) => {
    const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
    return (l1 + 0.05) / (l2 + 0.05);
  };
  const mix = (a, b, t) => a.map((c, i) => Math.round(c * (1 - t) + b[i] * t));
  const lift = (rgb, share) => rgb.map((c) => Math.round(c * (1 - share) + 255 * share));
  const over = (rgb, a) => rgb.map((c) => Math.round(255 * a + c * (1 - a)));

  const failures = [];
  for (const [key, a] of Object.entries(ACCENTS)) {
    // The WORST point a reader can land on: the base with the full allowance of the
    // lighter stop mixed in, then the grain — the one layer that lightens.
    const surface = lift(mix(hexRgb(a.to), hexRgb(a.from), OWN_BAND_MIX), 0.035);
    const white = ratio([255, 255, 255], surface);
    const muted = ratio(over(surface, 0.92), surface);
    if (white < 5.5 || muted < 4.5) {
      failures.push(`${key}: ${white.toFixed(2)}:1 white, ${muted.toFixed(2)}:1 for the 92% ink`);
    }
  }
  assert.deepEqual(failures, [],
    'a palette whose own band cannot carry its words at the store band’s own bar is not offered '
    + 'with that recipe — this is the measurement that made the band a deep stop plus a bounded '
    + 'aurora instead of the palette’s full gradient');
});

test('the stylesheet mixes no more than the measured bound, and one blob only', () => {
  const css = readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8');
  const at = css.indexOf('.own-band--themed::before {');
  assert.ok(at > -1, 'no mesh rule for the person’s band');
  const block = css.slice(at, css.indexOf('}', at));
  const mixPct = Number((block.match(/(\d+)%,\s*transparent/) || [])[1]);
  assert.equal(mixPct / 100, OWN_BAND_MIX,
    'the stylesheet’s mix and the bound the contrast test measures have drifted apart');
  assert.equal((block.match(/radial-gradient\(/g) || []).length, 1,
    'two translucent layers over one pixel are not the bound that was measured');
  // And the paint itself is NOT inside a motion query — a reduce user gets the colour.
  const paintAt = css.indexOf('\n.own-band--themed {');
  assert.ok(paintAt > -1, 'no paint rule for the person’s band');
  assert.ok(!/@media[^{]*$/.test(css.slice(Math.max(0, paintAt - 300), paintAt)),
    'the band is painted inside a media query — a reduce user would lose the colour');
  // The box is the store band's box: a plate with the store head's own radius and
  // spacing, and an edge light that is one pixel with no blur and no spread — and
  // therefore one the words cannot reach, because the padding is bigger than it is.
  const paint = css.slice(paintAt, css.indexOf('}', paintAt));
  assert.match(paint, /border-radius: var\(--radius-xl\)/,
    'the person’s band is not the same plate the store’s band is');
  const shadow = (paint.match(/box-shadow: inset 0 (\d+)px 0[^;]*;/) || []);
  assert.ok(shadow.length, 'the band lost the edge light that makes it a surface');
  assert.equal(Number(shadow[1]), 1, 'the edge light grew past the one pixel it was measured at');
  const pad = (paint.match(/padding:\s*var\(--space-(\d)\)/) || [])[1];
  const token = Number((css.match(new RegExp(`--space-${pad}:\\s*([\\d.]+)rem`)) || [])[1]) * 16;
  assert.ok(token >= 16, `the ink starts ${token}px in, which is not clear of the edge light`);
  // Motion is opt-in, the way the store band does it: the animation is declared inside
  // the no-preference query and nowhere else, so a reduce user is handed the band with
  // its colour, its grain and its mesh — standing still — and there is nothing to reset.
  const optInAt = css.indexOf('@media (prefers-reduced-motion: no-preference) {', paintAt);
  const animAt = css.indexOf('.own-band--themed::before { animation: theme-aurora', optInAt);
  assert.ok(optInAt > -1 && animAt > optInAt && animAt < optInAt + 200,
    'the band’s motion is not declared inside a no-preference query');
  const bandRegion = css.slice(paintAt, css.indexOf('/* Choosing the look', paintAt));
  assert.equal((bandRegion.match(/animation:/g) || []).length, 1,
    'the band declares its motion more than once — the reduce path is the one that loses');
});

// ---------------------------------------------------------------------------
// The blended catalogue (§11) — every row of the review, decided
// ---------------------------------------------------------------------------

/**
 * What each `delivers` name has to resolve to.
 *
 * A perk that claims to be built and points at nothing is a sentence, not a
 * feature — the same failure the stylesheet test catches from the other direction
 * ("every class the views emit has a rule"). So every built row's `delivers` is
 * resolved HERE, against the real thing, and a new row that names something
 * imaginary fails this test rather than shipping as copy.
 */
const DELIVERS = {
  nameplate: () => { const s = slotOf('nameplate'); assert.ok(s && s.owner === 'person' && s.grant === 'plus'); },
  effect: () => { const s = slotOf('effect'); assert.ok(s && s.owner === 'person'); },
  ring: () => { const s = slotOf('ring'); assert.ok(s && s.owner === 'person'); },
  frame: () => { const s = slotOf('frame'); assert.ok(s && s.owner === 'person'); },
  'own-band': () => assert.ok(personBand({ plus_active: true, nameplate: 'teal', plus_effect: 'halo' }), OWN_BAND_LINE),
  'badge-date': () => assert.equal(
    memberSinceWords({ status: 'active', period_start: '2026-09-25T00:00:00Z', period_end: '2099-01-01T00:00:00Z' }),
    'Since 25 Sept 2026',
  ),
  glyph: () => { const s = slotOf('glyph'); assert.ok(s && s.owner === 'store' && s.grant === 'creator'); },
  'members-only': () => {
    // The unlock vocabulary itself, in the migration that defines it: a perk that
    // claims a creator may open a file to members has to be a mode the schema knows.
    const dir = new URL('../../db/migrations/', import.meta.url).pathname;
    const found = readdirSync(dir).filter((f) => f.endsWith('.sql'))
      .some((f) => /'members'/.test(readFileSync(dir + f, 'utf8')));
    assert.ok(found, 'no migration declares the members unlock mode');
  },
  'member-room': () => {
    const server = readFileSync(new URL('../server.js', import.meta.url), 'utf8');
    assert.match(server, /\/s\/:slug\/members/, 'the member room route is gone');
  },
  'store-plan': () => {
    const plans = readFileSync(new URL('../src/store.js', import.meta.url), 'utf8');
    assert.match(plans, /max_assets/, 'the store plan no longer caps published files');
  },
  'gift-rail': () => assert.match(giftCode(() => 0), /^BKP-/),
};

test('every row of the blended catalogue is decided, and every built row points at something real', () => {
  assert.deepEqual(perkProblems(), [], 'the catalogue contradicts itself');
  for (const perk of PERKS) {
    assert.ok(PERK_OWNERS.includes(perk.owner), `${perk.key}: ${perk.owner} is not a layer`);
    assert.ok(PERK_STATES.includes(perk.state), `${perk.key}: ${perk.state} is not a verdict`);
    if (perk.state !== 'built') continue;
    const check = DELIVERS[perk.delivers];
    assert.ok(check, `${perk.key} is built by "${perk.delivers}", which nothing in this product resolves`);
    check();
  }
  // The blend's own rows, by name, so a future edit cannot quietly drop one.
  for (const expected of [
    'paint', 'effect', 'ring', 'frame', 'band', 'badge', 'tier-chip', 'early-access',
    'member-room', 'store-plan', 'gift', 'ad-free', 'opens-content', 'priority-rank',
    'see-engagement', 'offline-download', 'priority-comments', 'animated-uploads',
    'beta-opt-in', 'custom-reactions',
  ]) {
    assert.ok(PERKS.some((p) => p.key === expected), `the catalogue no longer answers "${expected}"`);
  }
});

test('the refusals the blend dragged in stay refused, with their reasons', () => {
  const byKey = Object.fromEntries(PERKS.map((p) => [p.key, p]));
  for (const key of ['ad-free', 'offline-download', 'priority-rank', 'see-engagement', 'priority-comments', 'beta-opt-in']) {
    assert.notEqual(byKey[key].state, 'built', `${key} became a thing we sell`);
    assert.ok(byKey[key].reason.length > 40, `${key} refuses without saying why`);
  }
  // The two that are refused for a reason that is not taste but somebody else's
  // property: the creator's ad revenue, and the file's own treatment.
  assert.match(byKey['ad-free'].reason, /paid to that store/);
  assert.equal(byKey['offline-download'].owner, 'file');
  // And the layer rule, on the rows the blend mixed together.
  assert.equal(byKey['ring'].owner, 'person');
  assert.equal(byKey['tier-chip'].owner, 'store');
  assert.equal(byKey['gift'].owner, 'person');
  assert.equal(perksByState('deferred').length, 1, 'deferrals are named one by one, not accumulated');
  assert.equal(perksByState('deferred')[0].key, 'custom-reactions');
});

test('"what this is not" is the catalogue\'s own refusals, not a second list', () => {
  const notLines = PERKS.filter((p) => p.notLine).map((p) => p.notLine);
  assert.deepEqual(PLUS_NOT, notLines, 'the printed list and the catalogue disagree');
  assert.ok(PLUS_NOT.length >= 4);
  // The sentence the lawsuits are about is in the catalogue, not only on the page.
  assert.ok(PLUS_NOT.some((line) => line.includes('does not remove ads')));
});

test('member since is the month that started, and nothing when nothing did', () => {
  const active = { status: 'active', period_start: '2026-09-25T00:00:00Z', period_end: '2099-01-01T00:00:00Z' };
  assert.match(memberSinceWords(active), /^Since \d+ Sept? \d{4}$/);
  assert.ok(memberSince(active) instanceof Date);
  // A claim is not a month: pending has no date, because nothing started.
  assert.equal(memberSinceWords({ ...active, status: 'pending_payment' }), null);
  // A month that ended is not a claim about now, even though the row still says active.
  assert.equal(memberSinceWords({ ...active, period_end: '2020-01-01T00:00:00Z' }), null);
  // Cancelled, none, and a missing row are the same answer.
  assert.equal(memberSinceWords({ ...active, status: 'cancelled' }), null);
  assert.equal(memberSinceWords(null), null);
  // A clock skew is not a birthday: a start in the future prints nothing.
  assert.equal(memberSinceWords({ ...active, period_start: '2099-06-01T00:00:00Z' }), null);
});

test('the page prints the catalogue, the owners, and the date', () => {
  const html = views.plusPage({
    user: { id: '1', email: 'nima@test.local', display_name: 'Nima', nameplate: 'sky', plus_effect: 'edge' },
    plan: { code: PLUS_CODE, name: PLUS_NAME, price_npr: 149, period_months: 1 },
    subscription: {
      plan_name: PLUS_NAME, status: 'active',
      period_start: '2026-09-25T00:00:00Z', period_end: '2099-01-01T00:00:00Z',
    },
    state: 'active', rails: railDetails({}), railsReady: false,
    look: { nameplate: 'sky', effect: 'edge' }, wear: { plate: 'sky', effect: 'edge' },
  });
  const plain = html.replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"');
  // The date, on the badge's own line, in the table the arrangement prints.
  assert.match(plain, /Member since/);
  assert.match(plain, /Since 25 Sept 2026/);
  // The catalogue, with the owner of each row named beside it.
  for (const perk of perksByState('built')) {
    assert.ok(html.includes(`data-perk="${perk.key}"`), `the page omits ${perk.key}`);
    assert.ok(plain.includes(perk.name), `the page omits the name of ${perk.key}`);
  }
  assert.match(html, /data-perk="ring" data-owner="person"/);
  assert.match(html, /data-perk="tier-chip" data-owner="store"/);
  // The rows we do not sell are on the page too, each with its reason.
  for (const perk of [...perksByState('refused'), ...perksByState('deferred')]) {
    assert.ok(html.includes(`data-perk="${perk.key}"`), `the page omits the refusal ${perk.key}`);
  }
  assert.match(html, /data-perk="offline-download" data-state="refused"/);
  assert.match(plain, /The treatment — download with your reference burned in/);
  // And no shipped copy ever says the tier is ad-free. The assertion is on the TEXT
  // rather than on the markup, because the catalogue's own key is an attribute
  // (`data-perk="ad-free"`) and the thing being forbidden is a promise, not a label.
  const text = plain.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
  // A promise, not a mention: the one place the phrase may appear is inside curly
  // quotes, where the refusal for beta access names the thing it is comparing itself
  // to. Anywhere else it is a claim the tier does not make.
  assert.doesNotMatch(text, /(?<!“)\bad-?free\b(?!”)/i, 'the page promises an ad-free tier');
});
