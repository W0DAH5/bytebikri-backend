/**
 * How many ad positions a page carries, and whose they are.  npm test
 *
 * The product shipped with a cap of eight positions (Pro's `slot_count`), a
 * five-rank definition list, and an upsell that was, in effect, "more boxes".
 * Migration 0034 brought that down to three: the store's one or two, plus at most
 * one that belongs to the platform.
 *
 * Two of these assertions exist because the arithmetic changed shape, not just
 * size. The platform's position used to be one of the store's, taken (`eligible[last]`)
 * — which stops being workable the moment the cap is one, because a Free store's only
 * position would be taken at rank 1, the one rule this policy has never broken. And
 * "a short page is never taxed" used to mean "fewer than three positions", a number
 * that is now larger than the cap itself; it means "a page with no position of its
 * own" instead.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:55432/bytebikri_test';

const { allocateSlots, POLICY } = await import('../src/slots.js');
const { store, SLOT_DEFS, PLANS } = await import('../src/store.js');
const { close, query } = await import('../src/db.js');

after(async () => { await close(); });

const webCaps = (code, over = {}) => ({ ...PLANS[code].capabilities, ...over });
const run = (code, over = {}) => allocateSlots({
  slotDefs: SLOT_DEFS, capabilities: webCaps(code, over),
  connections: [{ id: 'c1', provider_id: 'x', status: 'active', slot_keys: null }],
  surfaces: ['web'],
});

// ---------------------------------------------------------------------------
// The cap
// ---------------------------------------------------------------------------

test('no page carries more than three positions, on any plan', () => {
  for (const code of Object.keys(PLANS)) {
    const slots = run(code);
    assert.ok(slots.length <= POLICY.maxTotalSlots, `${code} allocated ${slots.length} positions`);
    assert.ok(slots.length <= PLANS[code].capabilities.slot_count + POLICY.platformSlotsPerPage);
  }
  // The free store gets one of its own and one of ours; a paid store gets two and one.
  assert.equal(run('free').length, 2);
  assert.equal(run('store').length, 3);
  assert.equal(run('pro').length, 3, 'density is not an upsell any more: Pro is the same three boxes');
});

test('the platform never takes rank 1, and its position is the least valuable on the page', () => {
  for (const code of Object.keys(PLANS)) {
    const slots = run(code);
    const ours = slots.filter((s) => s.owner === 'platform');
    assert.equal(ours.length, 1, `${code}: exactly one position is ours`);
    assert.ok(ours[0].rank > 1, `${code}: the platform took rank ${ours[0].rank}`);
    const theirs = slots.filter((s) => s.owner === 'channel');
    assert.equal(theirs.length, PLANS[code].capabilities.slot_count, `${code}: the store got its own count`);
    for (const slot of theirs) {
      assert.ok(slot.rank < ours[0].rank, `${code}: the platform's position outranks a store position`);
      assert.equal(slot.payoutParty, 'channel');
    }
    assert.equal(ours[0].payoutParty, 'platform');
    // Rank 1 belongs to the store, always — by allocation, not by promise.
    assert.ok(theirs.some((s) => s.rank === 1), `${code}: nobody holds rank 1`);
  }
});

test('a page with no position of its own is never taxed', () => {
  const none = run('free', { slot_count: 0 });
  assert.deepEqual(none, [], 'no store position means no platform position either');
  // And the release hook still works: a capability that says `ad_free` takes our
  // position out without touching the store's. It is read by no plan today — this is
  // the assertion that keeps it from being dead code if one ever sets it.
  const released = run('store', { ad_free: true });
  assert.equal(released.filter((s) => s.owner === 'platform').length, 0);
  assert.equal(released.filter((s) => s.owner === 'channel').length, PLANS.store.capabilities.slot_count);
});

test('the positions that were cut cannot be allocated, and are still named', () => {
  const allocated = new Set(run('pro').map((s) => s.slotKey));
  for (const key of ['in_content_2', 'footer_native']) {
    const def = SLOT_DEFS.find((d) => d.key === key);
    assert.ok(def, `${key} was deleted; its name is in sellers' creative rows and has to stay readable`);
    assert.equal(def.active, false, `${key} is still allocatable`);
    assert.ok(!allocated.has(key), `${key} was allocated despite being inactive`);
  }
  // And the other direction: every inactive definition is unreachable, so a seller
  // can never fill a position that would not render.
  for (const def of SLOT_DEFS.filter((d) => !d.active)) assert.ok(!allocated.has(def.key));
});

test('the plan capability, the policy and the seller’s panel agree', async () => {
  const rows = await query('select code, capabilities from plans');
  for (const row of rows.rows) {
    assert.equal(
      row.capabilities.slot_count, PLANS[row.code].capabilities.slot_count,
      `${row.code}: the table and the app disagree about how many positions a store owns`,
    );
    assert.ok(row.capabilities.slot_count <= POLICY.maxTotalSlots);
  }
  // `minTenantSlotsBeforeTax` has to be reachable: a threshold above the cap would
  // mean the platform is never placed anywhere, and the rent leg would quietly stop
  // existing while every test that checked the split kept passing.
  assert.ok(POLICY.minTenantSlotsBeforeTax <= Math.min(...Object.values(PLANS).map((p) => p.capabilities.slot_count)));
});

test('the seller’s revenue panel is arithmetic on the same allocation', async () => {
  const { revenueRows } = await import('../src/memberships.js');
  for (const code of Object.keys(PLANS)) {
    const slots = PLANS[code].capabilities.slot_count;
    const row = revenueRows({ planName: PLANS[code].name, planPrice: 'x', slotCount: slots })[2].text;
    // The number the panel prints for "how many a page carries" is the allocation's
    // own number: the store's, plus the platform's one.
    assert.match(row, new RegExp(`${slots + POLICY.platformSlotsPerPage} a page carries`));
  }
});
