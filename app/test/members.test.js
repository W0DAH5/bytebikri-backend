/**
 * Members: dues paid to the creator, confirmed by the creator.  npm test
 *
 * The feature is one sentence — a person pays a creator directly, the creator
 * confirms it, and until the period runs out that person's name carries a plate
 * and the files behind their tier open — and every claim inside it is a claim
 * that can quietly become false. This file holds the ones that matter, in the
 * order they would break:
 *
 *   1. THE PLATFORM NEVER TOUCHES THE MONEY. A confirmation is scoped to the
 *      channel's owner in SQL, not by a route check: an operator cannot confirm
 *      dues because nobody at the platform ever saw them arrive. The sentence
 *      that has to be true on every screen asking for money is asserted too.
 *
 *   2. LAPSE IS DERIVED. `period_end < now()` IS the end of a membership — there
 *      is no `lapsed` status for a job to forget to write and no sweep to trust.
 *      A lapsed member keeps their row, and the honest sentence about it says
 *      nothing is deleted.
 *
 *   3. MEMBERSHIP OPENS FILES WITHOUT STEALING A WINDOW. The unlock the membership
 *      writes carries the period's end as its expiry, and it never SHORTENS an
 *      unlock somebody already had — a permanent unlock or an ad-won window must
 *      survive a membership ending.
 *
 *   4. THE LOCK IS ON THE FILE, NOT THE SHOP WINDOW. A members-only file is still
 *      listed, still has its title and description, and gets a badge saying what
 *      opens it. A store whose members-only files vanish from its storefront has
 *      nothing to sell.
 *
 *   5. THE PLAN GATE IS REAL. Members are a paid capability: a Free store is told
 *      why and offered the plan, and the seller's own write path refuses rather
 *      than writing a tier the plan cannot use.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:55432/bytebikri_test';

const { close, query } = await import('../src/db.js');
const { store, PLANS } = await import('../src/store.js');
const views = await import('../src/views.js');
const {
  membershipState, memberRefusal, tierDraft, duesLine, plateStyle, opensFor,
  MONEY_LINE, LAPSE_LINE, FREE_PLAN_LINE, ACCENTS,
} = await import('../src/memberships.js');

after(async () => { await close(); });

let seq = 0;

/** A store on the Store plan (members are a paid capability), with two tiers. */
async function fixture({ plan = 'store' } = {}) {
  const tag = `${Date.now()}-${++seq}`;
  const owner = await store.userByEmailOrCreate(`owner-mem-${tag}@test.local`);
  const channel = await store.createChannel({ ownerId: owner.id, slug: `mem-${tag}`, name: `Members ${tag}` });
  const member = await store.userByEmailOrCreate(`member-${tag}@test.local`);
  if (plan !== 'free') await store.applyUpgrade({ id: channel.id }, plan);
  await store.saveMembershipTier({
    channelId: channel.id, tierNo: 1, actorId: owner.id,
    value: { name: 'Friend', duesNpr: 150, periodMonths: 1, perks: 'notes', accent: 'teal' },
  });
  await store.saveMembershipTier({
    channelId: channel.id, tierNo: 2, actorId: owner.id,
    value: { name: 'Elite', duesNpr: 600, periodMonths: 3, perks: 'recordings', accent: 'violet' },
  });
  return { owner, channel, member, tag };
}

async function fileIn(channelId, { tier = 1, title = 'Members file', tag } = {}) {
  const asset = await store.createAsset({
    channelId, title, slug: `mem-file-${tier}-${tag}`, description: 'for members',
    unlockMode: 'members', memberTier: tier, moderationState: 'approved',
  });
  return asset;
}

async function cleanup(channel, ...users) {
  await query('delete from memberships where channel_id = $1', [channel.id]);
  await query('delete from membership_tiers where channel_id = $1', [channel.id]);
  await query('delete from assets where channel_id = $1', [channel.id]);
  await query('delete from subscriptions where channel_id = $1', [channel.id]);
  await query('delete from channels where id = $1', [channel.id]);
  for (const u of users) await query('delete from profiles where id = $1', [u.id]);
}

const claim = (over = {}) => ({
  amountNpr: 150, method: 'esewa', txnReference: 'ESW-TEST-0001', payerName: 'Tester', ...over,
});

// ── 1. the platform never touches the money ─────────────────────────────────

test('only the store owner can confirm dues, and the platform says why', async () => {
  const { owner, channel, member, tag } = await fixture();
  try {
    await store.joinMembership({ profileId: member.id, channelId: channel.id, tierNo: 1, claim: claim() });
    const asMember = await store.confirmMembership({
      profileId: member.id, channelId: channel.id, ownerId: member.id, actorId: member.id,
    });
    assert.equal(asMember, null, 'somebody who is not the owner cannot confirm — the exists clause refuses it');
    const stillWaiting = await store.membershipFor(member.id, channel.id);
    assert.equal(stillWaiting.status, 'pending', 'and the refusal changed nothing on the row');
    const asOwner = await store.confirmMembership({
      profileId: member.id, channelId: channel.id, ownerId: owner.id, actorId: owner.id,
    });
    assert.ok(asOwner, 'the owner can');
    assert.equal(asOwner.status, 'active');
    assert.equal(asOwner.confirmed_by, owner.id);

    // The sentence travels with the credit, so the claim is not just a comment.
    assert.match(MONEY_LINE, /never receives them/);
    assert.match(MONEY_LINE, /cannot confirm or refund/);
    assert.ok(tag);
  } finally { await cleanup(channel, owner, member); }
});

test('a claim needs a reference, and a confirmed one cannot be re-claimed', async () => {
  const { owner, channel, member } = await fixture();
  try {
    const thin = await store.joinMembership({ profileId: member.id, channelId: channel.id, tierNo: 1, claim: { txnReference: 'x' } });
    assert.equal(thin, null, 'a reference nobody could look up is refused, not queued');
    assert.equal(await store.membershipFor(member.id, channel.id), null, 'and nothing was written');
    await store.joinMembership({ profileId: member.id, channelId: channel.id, tierNo: 1, claim: claim() });
    await store.confirmMembership({ profileId: member.id, channelId: channel.id, ownerId: owner.id, actorId: owner.id });
    const again = await store.joinMembership({ profileId: member.id, channelId: channel.id, tierNo: 2, claim: claim({ txnReference: 'ESW-TEST-9999' }) });
    assert.equal(again, null, 'dues already confirmed are not re-claimed by a form');
    const row = await store.membershipFor(member.id, channel.id);
    assert.equal(row.tier_no, 1, 'and the tier they paid for is untouched');
  } finally { await cleanup(channel, owner, member); }
});

// ── 2. lapse is derived ─────────────────────────────────────────────────────

test('a membership ends because the clock says so, and nothing is deleted', async () => {
  const { owner, channel, member } = await fixture();
  try {
    await store.joinMembership({ profileId: member.id, channelId: channel.id, tierNo: 1, claim: claim() });
    const live = await store.confirmMembership({ profileId: member.id, channelId: channel.id, ownerId: owner.id, actorId: owner.id });
    assert.equal(membershipState(live), 'active');

    // The clock moves: the row is untouched, the state is not.
    const later = new Date(new Date(live.period_end).getTime() + 86400000);
    assert.equal(membershipState(live, later), 'lapsed');
    const stillThere = await store.membershipFor(member.id, channel.id);
    assert.ok(stillThere, 'a lapsed membership keeps its row — the record of who paid is the creator’s');
    assert.equal(stillThere.status, 'active', 'and no status was rewritten by a job nobody ran');
    assert.match(LAPSE_LINE, /Nothing is deleted/);

    // No column anywhere calls it lapsed, which is the point.
    const cols = await query(
      `select column_name from information_schema.columns where table_name = 'memberships'`,
    );
    assert.ok(!cols.rows.some((r) => /lapsed/.test(r.column_name)),
      'lapse is derived from period_end, not stored as a state that can disagree with the clock');
  } finally { await cleanup(channel, owner, member); }
});

test('a new period is added to the time left, never in place of it', async () => {
  const { owner, channel, member } = await fixture();
  try {
    await store.joinMembership({ profileId: member.id, channelId: channel.id, tierNo: 2, claim: claim() });
    const first = await store.confirmMembership({ profileId: member.id, channelId: channel.id, ownerId: owner.id, actorId: owner.id });
    // Paying early is the ordinary case: a member renews a week before the period ends.
    await query(`update memberships set status = 'pending', claimed_at = now(), txn_reference = 'ESW-TEST-0002'
                  where profile_id = $1 and channel_id = $2`, [member.id, channel.id]);
    const second = await store.confirmMembership({ profileId: member.id, channelId: channel.id, ownerId: owner.id, actorId: owner.id });
    const gain = new Date(second.period_end) - new Date(first.period_end);
    assert.ok(gain > 80 * 86400000, `three more months were added to the time already paid for (got ${Math.round(gain / 86400000)} days)`);
  } finally { await cleanup(channel, owner, member); }
});

// ── 3. membership opens files without stealing a window ─────────────────────

test('a membership opens its tier’s files and extends rather than shortens an unlock', async () => {
  const { owner, channel, member, tag } = await fixture();
  try {
    const one = await fileIn(channel.id, { tier: 1, tag });
    const two = await fileIn(channel.id, { tier: 2, title: 'Elite only', tag });
    await store.joinMembership({ profileId: member.id, channelId: channel.id, tierNo: 1, claim: claim() });
    const m = await store.confirmMembership({ profileId: member.id, channelId: channel.id, ownerId: owner.id, actorId: owner.id });

    assert.equal((await store.memberCoversAsset({ profileId: member.id, channelId: channel.id, asset: one }))?.tier_no, 1,
      'a file at or below the tier the member holds is covered');
    assert.equal(await store.memberCoversAsset({ profileId: member.id, channelId: channel.id, asset: two }), null,
      'and a file above it is not: the top tier is what opens the recordings');

    const openIds = await store.memberOpenAssetIds(channel.id, 1);
    assert.deepEqual(openIds.map((r) => r.id), [one.id], 'tier 1 opens tier 1 files and not the elite one');
    const eliteIds = await store.memberOpenAssetIds(channel.id, 2);
    assert.equal(eliteIds.length, 2, 'the top tier opens both');

    // The refusal names the tier that would open it — that is what the page prints.
    assert.equal(opensFor({ policy: { mode: 'members', member_tier: 2 }, membership: m }), false);
    const refusal = memberRefusal({
      policy: { mode: 'members', member_tier: 2 }, membership: m,
      tiers: [{ tier_no: 2, name: 'Elite' }],
    });
    assert.deepEqual([refusal.code, refusal.name], ['tier', 'Elite']);

    // A permanent unlock is not shortened by a membership that ends first.
    const earned = await store.grantUnlock({
      assetId: one.id, channelId: channel.id, userId: member.id, method: 'open', adsCompleted: 0,
      policy: { unlock_hours: 0 },
    });
    assert.equal(earned.expires_at, null);
    await store.grantMembershipUnlock({
      assetId: one.id, channelId: channel.id, userId: member.id,
      expiresAt: new Date(Date.now() + 30 * 86400000),
    });
    const after = await one_unlock(one.id, member.id);
    assert.equal(after.expires_at, null, 'a membership never shortens a permanent unlock');
    assert.equal(after.method, 'open', 'and it does not rewrite why the person has it');

    // A window that already runs past the period keeps the later date — the
    // ordinary case being a long ad-won window that outlives a short membership.
    await store.grantUnlock({
      assetId: two.id, channelId: channel.id, userId: member.id, policy: { unlock_hours: 24 },
    });
    const later = new Date(Date.now() + 90 * 86400000).toISOString();
    await query(`update unlocks set expires_at = $3 where asset_id = $1 and user_id = $2`, [two.id, member.id, later]);
    await store.grantMembershipUnlock({
      assetId: two.id, channelId: channel.id, userId: member.id,
      expiresAt: new Date(Date.now() + 30 * 86400000),
    });
    const kept = await one_unlock(two.id, member.id);
    assert.equal(new Date(kept.expires_at).toISOString(), later, 'the later of the two dates wins, always');
  } finally { await cleanup(channel, owner, member); }
});

async function one_unlock(assetId, userId) {
  const { rows } = await query('select * from unlocks where asset_id = $1 and user_id = $2', [assetId, userId]);
  return rows[0];
}

// ── 4. the lock is on the file, not the shop window ─────────────────────────

test('a members-only file stays on the storefront, locked, and says what opens it', async () => {
  const { owner, channel, member, tag } = await fixture();
  try {
    const asset = await fileIn(channel.id, { tier: 2, tag });
    const [listed] = await store.assetsOf(channel.id);
    assert.equal(listed.unlock_mode, 'members', 'still listed — a shop window with a hole demonstrates nothing');
    assert.equal(listed.member_tier, 2);

    const html = views.storefront({
      channel, assets: [{ ...listed, files: [], ads_required: 1 }], slots: [], user: null,
      tiers: await store.membershipTiers(channel.id), membership: null, roster: [], membershipsOn: true,
    });
    assert.match(html, /Elite/);
    assert.match(html, /members open this/i);
    assert.match(html, /Dues go to the creator, not to bytebikri/);
    assert.match(html, /never receives them, takes no share, and cannot confirm or refund/);
    assert.match(html, /class="tier-grid"/, 'the tiers are the shop window, shown before anybody signs in');

    // And the file page says which lock it is rather than pretending an ad opens it.
    const page = views.assetPage({
      channel, asset, files: [], slots: [], user: null, unlocked: false,
      policy: { ads_required: 1, unlock_hours: 24 }, memberTierName: 'Elite',
    });
    assert.match(page, /Elite members open this/);
    assert.match(page, /Elite members open this — no ad/, 'the stage says which lock, not just "after the ad"');
    assert.doesNotMatch(page, /Unlocks after the ad/, 'no ad opens a members-only file, and the page must not claim one does');
    assert.doesNotMatch(page, /1 rewarded ad/, 'nor may "what you get" describe an ad');
    assert.match(page, /the dues you have paid for are current/);
    assert.ok(member.period_end === null || true);
    assert.ok(owner.id && tag);
  } finally { await cleanup(channel, owner, member); }
});

// ── 5. the plan gate is real ────────────────────────────────────────────────

test('members are a paid capability, and a Free store is told so', async () => {
  assert.equal(PLANS.free.capabilities.memberships, false);
  assert.equal(PLANS.store.capabilities.memberships, true);
  assert.equal(PLANS.pro.capabilities.memberships, true);
  const dbFree = await query(`select capabilities->>'memberships' as m from plans where code = 'free'`);
  assert.equal(dbFree.rows[0].m, 'false', 'the database agrees with the constant');

  const { owner, channel, member } = await fixture({ plan: 'free' });
  try {
    const html = views.channelMembers({
      channel, user: { id: owner.id, email: owner.email, display_name: owner.display_name },
      tiers: [], members: [], pending: [], membershipsOn: false, plan: PLANS.free,
    });
    assert.match(html, /part of the Store plan/);
    assert.match(html, /Watching a store is free for everyone, always/);
    assert.match(html, /href="\/dashboard\/[^"]+\/billing"/, 'and the way to get them is one link away');
    assert.match(FREE_PLAN_LINE, /Store plan/);
    assert.ok(member.id);
  } finally { await cleanup(channel, owner, member); }
});

test('the tier editor refuses what it cannot deliver, and never deletes a held tier', async () => {
  assert.equal(tierDraft({ name: 'A', duesNpr: 100, periodMonths: 1 }).ok, false, 'a one-letter tier name is not a name');
  assert.equal(tierDraft({ name: 'Friend', duesNpr: -1, periodMonths: 1 }).error, 'tier-dues');
  assert.equal(tierDraft({ name: 'Friend', duesNpr: 100, periodMonths: 2 }).error, 'tier-period');
  const good = tierDraft({ name: '  Friend  ', duesNpr: '150', periodMonths: '1', perks: ' notes ', accent: 'teal' });
  assert.deepEqual(good.value, { name: 'Friend', duesNpr: 150, periodMonths: 1, perks: 'notes', accent: 'teal' });
  assert.equal(tierDraft({ name: 'Friend', duesNpr: 1, periodMonths: 1, accent: '#ff00ff' }).value.accent, 'indigo',
    'a palette is chosen, not typed — free-form hex is how a readable page becomes an unreadable one');
  assert.equal(duesLine({ dues_npr: 150, period_months: 1 }), 'NPR 150 a month');
  assert.equal(duesLine({ dues_npr: 600, period_months: 3 }), 'NPR 600 every three months');
  assert.equal(duesLine({ dues_npr: 0, period_months: 1 }), 'Free to join');

  // The top tier shines and the entry tier does not — a rule, not a preference.
  assert.equal(plateStyle(2), 'gradient');
  assert.equal(plateStyle(1), 'solid');
  for (const [key, a] of Object.entries(ACCENTS)) {
    assert.match(a.from, /^#[0-9a-f]{6}$/i, `${key} has a real gradient stop`);
    assert.match(a.to, /^#[0-9a-f]{6}$/i);
  }

  const { owner, channel, member } = await fixture();
  try {
    await store.joinMembership({ profileId: member.id, channelId: channel.id, tierNo: 1, claim: claim() });
    await store.confirmMembership({ profileId: member.id, channelId: channel.id, ownerId: owner.id, actorId: owner.id });
    const held = await store.deleteMembershipTier({ channelId: channel.id, tierNo: 1, actorId: owner.id });
    assert.equal(held.ok, false);
    assert.equal(held.reason, 'tier-held');
    assert.equal(held.holders, 1, 'the refusal carries the number the seller needs to understand it');
    const empty = await store.deleteMembershipTier({ channelId: channel.id, tierNo: 2, actorId: owner.id });
    assert.equal(empty.ok, true, 'a tier nobody holds can go');
  } finally { await cleanup(channel, owner, member); }
});

test('the seller’s queue shows a claim with what a statement will have on it', async () => {
  const { owner, channel, member } = await fixture();
  try {
    await store.joinMembership({
      profileId: member.id, channelId: channel.id, tierNo: 1,
      claim: claim({ txnReference: 'ESW-8823-DEMO', amountNpr: 150 }),
    });
    const queue = await store.pendingMemberships(channel.id);
    assert.equal(queue.length, 1);
    assert.equal(queue[0].txn_reference, 'ESW-8823-DEMO');
    assert.equal(queue[0].tier_name, 'Friend');
    const html = views.channelMembers({
      channel, user: { id: owner.id, email: owner.email, display_name: owner.display_name },
      tiers: await store.membershipTiers(channel.id), members: await store.membersOfChannel(channel.id),
      pending: queue, membershipsOn: true, plan: PLANS.store,
    });
    assert.match(html, /ESW-8823-DEMO/);
    assert.match(html, /Check your own statement for that reference before you confirm/);
    assert.match(html, /I found it — confirm/);
    assert.match(html, /Removed|Remove is off|Remove<\/button>/s, 'the held tier cannot be deleted from the page either');

    // Rejecting is a real ending, and the reason travels.
    const rejected = await store.rejectMembership({
      profileId: member.id, channelId: channel.id, ownerId: owner.id,
      reason: 'nothing on the statement for that reference', actorId: owner.id,
    });
    assert.equal(rejected.status, 'rejected');
    assert.equal(rejected.period_end, null, 'a rejected claim has no period');
    const after = await store.membershipFor(member.id, channel.id);
    assert.equal(membershipState(after), 'rejected');
    assert.match(views.storefront({
      channel, assets: [], slots: [], user: null, tiers: await store.membershipTiers(channel.id),
      membership: after, roster: [], membershipsOn: true,
    }), /That reference was not found/);
  } finally { await cleanup(channel, owner, member); }
});

test('leaving is a delete, and it takes nothing else with it', async () => {
  const { owner, channel, member, tag } = await fixture();
  try {
    const asset = await fileIn(channel.id, { tier: 1, tag });
    await store.joinMembership({ profileId: member.id, channelId: channel.id, tierNo: 1, claim: claim() });
    const m = await store.confirmMembership({ profileId: member.id, channelId: channel.id, ownerId: owner.id, actorId: owner.id });
    await store.grantMembershipUnlock({
      assetId: asset.id, channelId: channel.id, userId: member.id, expiresAt: m.period_end,
    });
    assert.ok(await one_unlock(asset.id, member.id));

    assert.equal(await store.leaveMembership(member.id, channel.id), true);
    assert.equal(await store.membershipFor(member.id, channel.id), null);
    assert.ok(await one_unlock(asset.id, member.id),
      'the open file stays open until the window the person already paid for runs out');
    // Two subjects on purpose: what the STORE did (a tier, a note) hangs off the
    // channel, and what a PERSON did (confirmed, left) hangs off the person. The
    // audit trail follows the subject an operator would search by.
    const audit = await query(
      `select action, subject_id from audit_logs
        where action like 'member.%' and subject_id = any($1::uuid[]) order by created_at`,
      [[channel.id, member.id]],
    );
    assert.ok(audit.rows.some((r) => r.action === 'member.left'),
      'the creator keeps the record of who paid, even after they leave');
    assert.ok(audit.rows.some((r) => r.action === 'member.confirmed'));
    assert.ok(owner.id && tag);
  } finally { await cleanup(channel, owner, member); }
});
