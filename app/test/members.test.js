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
  membershipState, memberRefusal, tierDraft, duesLine, plateStyle, opensFor, revenueRows,
  MONEY_LINE, LAPSE_LINE, FREE_PLAN_LINE, MEMBER_AD_LINE, MEMBER_AD_LINE_RELEASED,
  memberAdLine, ADS_AROUND_LINE, ACCENTS,
  // The attention door: the second way in, priced by the platform and paid in views.
  doorsOf, attentionViews, attentionProgress, attentionLine, attentionStandingLine,
  attentionBankedLine, adModeOf, doorFor, ATTENTION_MONEY_LINE, SUPPORTER_LINE,
} = await import('../src/memberships.js');
const { plusWear } = await import('../src/plus.js');
const { startUnlock } = await import('../src/unlocks.js');

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

test('the roster hands the renderer the palette the look is painted from', async () => {
  // A regression test with a real bug behind it. `publicRoster` aliased the column to
  // `plus_plate`, and `plusWear()` reads `nameplate` — so on a store's roster every
  // dressed member's name fell back to indigo while their chosen palette sat in the row
  // beside it. The alias was the bug: the query must hand the renderer the field the
  // renderer reads, and the card's own edge and ring (which take their colours from the
  // same field) are what makes that visible at a glance.
  const { owner, channel, member } = await fixture();
  try {
    // The TOP tier on purpose: its chip is the gradient one, and that is the same tier
    // whose avatar carries the store's own glint — so this is the one card where the
    // store's light and the person's ring land on the same element, and both must show.
    await store.joinMembership({ profileId: member.id, channelId: channel.id, tierNo: 2, claim: claim({ amountNpr: 600 }) });
    await store.confirmMembership({ profileId: member.id, channelId: channel.id, ownerId: owner.id, actorId: owner.id });
    await query(`update profiles
                    set nameplate = 'teal', plus_effect = 'halo',
                        plus_ring = 'double', plus_frame = 'glow'
                  where id = $1`, [member.id]);
    const [row] = await store.publicRoster(channel.id);
    assert.equal(row.nameplate, 'teal', 'the roster row does not carry the field the look is read from');

    // The same row the storefront receives, with the arrangement the join proves in
    // production (asserted directly here so this test needs no subscription fixture).
    const dressed = { ...row, plus_active: true };
    assert.equal(plusWear(dressed).plate, 'teal');
    assert.equal(plusWear(dressed).ring, 'double');
    assert.equal(plusWear(dressed).frame, 'glow');

    const html = views.storefront({
      channel, assets: [], slots: [], user: null, membership: null, membershipsOn: true,
      tiers: await store.membershipTiers(channel.id), roster: [dressed],
    });
    assert.match(html, /<li class="member[^"]*frame-glow"[^>]*style="[^"]*--plate-a:#0f766e/,
      'the roster card is edged in something other than the member’s own palette');
    // The tile is the two-owner element: the STORE's palette fills it (the tier's accent,
    // and the store's top-tier glint is drawn from it) and the PERSON's pair rides beside
    // it for the ring. Asserted as a whole string, because that is the shape the bug had:
    // the two pairs glued together by a missing semicolon, and the browser dropped both.
    assert.match(html,
      /class="member-avatar member-avatar--shine ring-double"\s*style="--plate-ink:#a78bfa;--plate-ink-light:#6d28d9;--plate-a:#7c3aed;--plate-b:#5b21b6;--wear-a:#0f766e;--wear-b:#115e59"/,
      'the tile does not carry the store’s palette AND the wearer’s');
    assert.doesNotMatch(html, /--wear-a:(?!.*;)/,
      'the wearer’s pair is glued onto the store’s — an unwritten variable is a ring in the wrong colour');
    assert.match(html, /member-avatar--shine[^"]*ring-double|ring-double[^"]*member-avatar--shine/,
      'the ring and the store’s top-tier light do not share the avatar');
    assert.match(html, /class="store-chip/, 'the store’s own chip left the card');
  } finally { await cleanup(channel, owner, member); }
});

test('the seller’s own member list hands the renderer the look too', async () => {
  // The sibling of the roster test above, and the same bug in a second query. The
  // seller's members page passes every row to `memberPlate()`, which dresses the name,
  // the avatar and the card's edge from the member's own look — but `membersOfChannel`
  // was written before looks existed and selected none of those fields, so on the page
  // where names are read MOST carefully a paying member appeared wearing nothing at all.
  // Two pages, one person, two different pictures. The query is the fix; this is the pin.
  const { owner, channel, member } = await fixture();
  try {
    await store.joinMembership({ profileId: member.id, channelId: channel.id, tierNo: 2, claim: claim({ amountNpr: 600 }) });
    await store.confirmMembership({ profileId: member.id, channelId: channel.id, ownerId: owner.id, actorId: owner.id });

    // A REAL arrangement, so the row the page receives is the row production assembles:
    // the lateral join is what makes `plus_status` present, and faking it would test the
    // renderer while leaving the query — the half that was broken — unasserted.
    const claimed = await store.claimPlus({ profileId: member.id, txnReference: `MEM-PLUS-${Date.now()}` });
    await store.matchCustomerPlanPayment({ paymentId: claimed.payment.id, actorId: null });
    await query(`update profiles
                    set nameplate = 'teal', plus_effect = 'halo',
                        plus_ring = 'double', plus_frame = 'glow'
                  where id = $1`, [member.id]);

    const [row] = await store.membersOfChannel(channel.id);
    assert.equal(row.nameplate, 'teal', 'the seller’s row does not carry the field the look is read from');
    assert.equal(row.plus_effect, 'halo');
    assert.equal(row.plus_ring, 'double');
    assert.equal(row.plus_frame, 'glow');
    assert.equal(row.plus_status, 'active', 'and the arrangement is not joined, so nothing would be worn');
    const wear = plusWear(row);
    assert.equal(wear?.plate, 'teal', 'the row the seller’s page receives is not wearing the member’s palette');

    const html = views.channelMembers({
      channel, user: owner, members: [row], tiers: await store.membershipTiers(channel.id),
      membershipsOn: true, plan: PLANS.store,
    });
    assert.match(html, /class="member-name wear-halo"/,
      'the seller’s queue did not dress the member’s name');
    assert.match(html, /--plate-a:#0f766e/, 'and not in the member’s own palette');
    assert.match(html, /class="store-chip/, 'the seller’s own chip left the row');

    // AND THE WAITING LIST, which draws the same person one page up. Dues awaiting
    // confirmation are UNRELATED to whether somebody pays bytebikri for a look, so a
    // member sitting in "Waiting on you" still wears the palette they bought — the query
    // carries the look and the subscription join, and the route hands the row straight
    // to `nameTag`. The tier pill beside it remains the store's, as always.
    const waiting = await store.userByEmailOrCreate(`member-wait-${Date.now()}@test.local`);
    try {
      await store.joinMembership({ profileId: waiting.id, channelId: channel.id, tierNo: 1, claim: claim() });
      const waitClaim = await store.claimPlus({ profileId: waiting.id, txnReference: `WAIT-${Date.now()}` });
      await store.matchCustomerPlanPayment({ paymentId: waitClaim.payment.id, actorId: null });
      await query(`update profiles set display_name = 'Bimal', nameplate = 'rose', plus_effect = 'edge' where id = $1`, [waiting.id]);
      const pendingRows = await store.pendingMemberships(channel.id);
      const pendingRow = pendingRows.find((r) => r.profile_id === waiting.id);
      assert.ok(pendingRow, 'the pending claim is not in the queue at all');
      assert.equal(pendingRow.nameplate, 'rose', 'the waiting row does not carry the look');
      assert.equal(pendingRow.plus_status, 'active', 'and not the arrangement behind it');
      const pendingHtml = views.channelMembers({
        channel, user: owner, members: [], pending: [pendingRow],
        tiers: await store.membershipTiers(channel.id), membershipsOn: true, plan: PLANS.store,
      });
      // Asserted as the whole attribute: the palette the look is painted from and the
      // effect class that paints it, in the order the helper writes them.
      assert.match(pendingHtml,
        /class="member-name wear-edge" style="--plate-ink:#fb7185;--plate-ink-light:#be123c;--plate-a:#e11d48;--plate-b:#be123c"/,
        'the waiting list draws the member’s name plain — the store is showing them to somebody');
      assert.match(pendingHtml, /<span class="pill">Friend</, 'the store’s own tier pill left the waiting row');

      // AND THE PERSON WHO BOUGHT NOTHING. Their name has no look of its own, so the
      // colour has to come from the page they are drawn on — and the page draws them
      // twice: once in the queue above, once on the roster below. Falling back to the
      // renderer's default made the SAME person indigo in the queue and the store's teal
      // on their own row, two colours, one page, one name. The accent the tier carries is
      // the single source for both, so the two spans must come out byte-identical.
      const plain = await store.userByEmailOrCreate(`member-plain-${Date.now()}@test.local`);
      try {
        await store.joinMembership({ profileId: plain.id, channelId: channel.id, tierNo: 1, claim: claim() });
        const plainClaim = await store.claimPlus({ profileId: plain.id, txnReference: `PLAIN-${Date.now()}` });
        await store.matchCustomerPlanPayment({ paymentId: plainClaim.payment.id, actorId: null });
        await query(`update profiles set display_name = 'Nirmala', nameplate = null where id = $1`, [plain.id]);
        const tiersNow = await store.membershipTiers(channel.id);
        const plainPending = (await store.pendingMemberships(channel.id)).find((r) => r.profile_id === plain.id);
        assert.ok(plainPending, 'the plain member is not in the queue');
        assert.equal(plainPending.accent, tiersNow[0].accent, 'the queue dropped the tier palette');
        const plainRoster = (await store.membersOfChannel(channel.id)).find((r) => r.profile_id === plain.id);
        assert.ok(plainRoster, 'the plain member is not on the roster');
        const nameSpanOf = (html) => html.match(/<span class="member-name[^"]*"[^>]*>Nirmala<\/span>/)?.[0];
        const queuedName = nameSpanOf(views.channelMembers({
          channel, user: owner, members: [], pending: [plainPending],
          tiers: tiersNow, membershipsOn: true, plan: PLANS.store,
        }));
        const rosterName = nameSpanOf(views.channelMembers({
          channel, user: owner, members: [plainRoster], pending: [],
          tiers: tiersNow, membershipsOn: true, plan: PLANS.store,
        }));
        assert.ok(queuedName && rosterName, 'the plain member’s name is not being drawn at all');
        assert.equal(queuedName, rosterName,
          'the same member is two colours on one page — the queue and the roster disagree');
      } finally {
        await query(`delete from customer_plan_payments where customer_subscription_id in
                      (select id from customer_subscriptions where profile_id = $1)`, [plain.id]);
        await query('delete from customer_subscriptions where profile_id = $1', [plain.id]);
        await query('delete from memberships where profile_id = $1 and channel_id = $2', [plain.id, channel.id]);
        await query('delete from profiles where id = $1', [plain.id]);
      }
    } finally {
      await query(`delete from customer_plan_payments where customer_subscription_id in
                    (select id from customer_subscriptions where profile_id = $1)`, [waiting.id]);
      await query('delete from customer_subscriptions where profile_id = $1', [waiting.id]);
      await query('delete from memberships where profile_id = $1 and channel_id = $2', [waiting.id, channel.id]);
      await query('delete from profiles where id = $1', [waiting.id]);
    }
  } finally {
    // Payments hang off the subscription, not the profile; the receipt goes before the
    // arrangement it paid for.
    await query(`delete from customer_plan_payments
                  where customer_subscription_id in
                        (select id from customer_subscriptions where profile_id = $1)`, [member.id]);
    await query('delete from customer_subscriptions where profile_id = $1', [member.id]);
    await cleanup(channel, owner, member);
  }
});

// ── 4b. the tier card sells the FILES, not the idea of files ────────────────

test('a tier card names the files it opens, and says which tier they sit behind', async () => {
  const { owner, channel, member, tag } = await fixture();
  try {
    await fileIn(channel.id, { tier: 1, title: 'Pokhara sketchbook', tag: `${tag}-a` });
    await fileIn(channel.id, { tier: 2, title: 'Wallpaper pack', tag: `${tag}-b` });
    await fileIn(channel.id, { tier: 2, title: 'Brush set', tag: `${tag}-c` });
    // A file that anybody can unlock is NOT part of what a tier buys, and listing it
    // on a card would be selling something the visitor can already have.
    await store.createAsset({
      channelId: channel.id, title: 'Free sample', slug: `mem-free-${tag}`, description: 'open',
      unlockMode: 'ad_gated', moderationState: 'approved',
    });
    const assets = await store.assetsOf(channel.id);
    const html = views.storefront({
      channel, assets, slots: [], user: null, membershipsOn: true, membership: null, roster: [],
      tiers: await store.membershipTiers(channel.id),
    });
    assert.match(html, /Pokhara sketchbook/, 'the entry tier names the file it opens');
    assert.match(html, /Wallpaper pack/, 'and the top tier names both of its own');
    const flat = html.replace(/\s+/g, ' ');
    assert.match(flat, /3 files open to this tier, with no ad/,
      'the top tier counts everything at or below it — and says the one thing that matters: no ad');
    assert.match(flat, /1 file open to this tier, with no ad/,
      'the entry tier is countable too, and reads as a sentence rather than as a badge');
    // Scoped to the members section: the ad-gated file is legitimately on the
    // storefront, in Content — it is only the TIER CARDS that must not claim it.
    const members = html.slice(html.indexOf('id="members"'), html.indexOf('id="join"'));
    assert.doesNotMatch(members, /Free sample/, 'an ad-unlocked file is not part of what a tier buys');
    assert.ok(member.id && owner.id, 'sanity');

    // The card links to the file page — the teaser the research says converts: a
    // named thing with a cover, not the phrase "bonus content".
    assert.match(html, new RegExp(`/s/${channel.slug}/a/mem-file-1-${tag}-a`));
  } finally { await cleanup(channel, owner, member); }
});

test('a tier with nothing behind it says so, rather than promising bonus content', async () => {
  const { owner, channel, member } = await fixture();
  try {
    const html = views.storefront({
      channel, assets: [], slots: [], user: null, membershipsOn: true, membership: null, roster: [],
      tiers: await store.membershipTiers(channel.id),
    });
    // The honest failure. A card that says "perks: notes" and opens nothing is a
    // chargeback waiting to happen, and the seller is the one who has to find out —
    // so the storefront says it out loud, where they will see it.
    const flat = html.replace(/\s+/g, ' ');
    assert.match(flat, /No files are set to members-only yet/);
    assert.match(flat, /nobody can join until there is something behind the door/);
    assert.ok(member.id && owner.id, 'sanity');
  } finally { await cleanup(channel, owner, member); }
});

test('the seller’s tier editor says what is behind each tier', async () => {
  const { owner, channel, member, tag } = await fixture();
  try {
    await fileIn(channel.id, { tier: 1, title: 'Pokhara sketchbook', tag: `${tag}-a` });
    await fileIn(channel.id, { tier: 2, title: 'Wallpaper pack', tag: `${tag}-b` });
    const ownerView = { id: owner.id, email: owner.email, display_name: owner.display_name };
    const html = views.channelMembers({
      channel, user: ownerView,
      tiers: await store.membershipTiers(channel.id),
      members: [], pending: [], membershipsOn: true, plan: PLANS.store,
      // The seller's OWN list: a paused file that sits behind a tier is still behind
      // it, and an editor that hid it would let a seller delete a tier thinking
      // nothing depended on it.
      files: [
        { title: 'Pokhara sketchbook', unlock_mode: 'members', member_tier: 1 },
        { title: 'Wallpaper pack', unlock_mode: 'members', member_tier: 2 },
        { title: 'Draft nobody can see', unlock_mode: 'members', member_tier: 2, paused: true },
        { title: 'Open to all', unlock_mode: 'ad_gated' },
      ],
    });
    assert.match(html, /Behind this tier now: Pokhara sketchbook/);
    assert.match(html, /Pokhara sketchbook, Wallpaper pack, Draft nobody can see/,
      'the top tier owns everything at or below it, paused files included');
    assert.doesNotMatch(html, /Open to all/);
    assert.ok(member.id, 'sanity');
  } finally { await cleanup(channel, owner, member); }
});

test('the roster stacks on a phone instead of sliding off the side of it', async () => {
  const { owner, channel, member } = await fixture();
  try {
    await store.joinMembership({ profileId: member.id, channelId: channel.id, tierNo: 1, claim: claim() });
    await store.confirmMembership({
      profileId: member.id, channelId: channel.id, ownerId: owner.id, actorId: owner.id,
    });
    const html = views.channelMembers({
      channel, user: { id: owner.id, email: owner.email, display_name: owner.display_name },
      tiers: await store.membershipTiers(channel.id),
      members: await store.membersOfChannel(channel.id),
      pending: [], membershipsOn: true, plan: PLANS.store, files: [],
    });
    // `table-stacked` is the product's phone pattern, and the roster is the one
    // table on this page that a seller opens on a phone — in a queue, checking who
    // paid. Five columns do not fit in 350 pixels; the sweep found them 570 wide in a
    // 350 box. Every cell therefore carries the label it stacks under.
    assert.match(html, /class="table table-stacked"/);
    for (const col of ['Member', 'Joined', 'State', 'Confirmed', 'Listed']) {
      assert.match(html, new RegExp(`data-label="${col}"`), `${col} stacks under a label`);
    }
    assert.ok(member.id, 'sanity');
  } finally { await cleanup(channel, owner, member); }
});

// ── 4c. the revenue architecture, in the words a seller and a member read ───

test('the seller is told where the platform earns, and it is genuinely two things', async () => {
  const { owner, channel, member } = await fixture();
  try {
    const rows = revenueRows({ planName: 'Store', planPrice: 'NPR 999 a year', slotCount: 2 });
    const text = rows.map((r) => r.text).join(' ');

    // The model, in one place, checked against the policy it claims to follow.
    assert.match(text, /Dues are 100% yours/);
    assert.match(text, /NPR 999 a year/, 'the plan is named with its price');
    assert.match(text, /annual rent/, 'and the rent, which is the other half of the model');
    assert.match(text, /You keep 2 positions of the 3/, 'the slot split is arithmetic, not a slogan');
    assert.match(text, /never the first/);
    // The density cap, stated to the seller whose page it applies to. This panel is
    // the one place a store is told how many boxes can appear, so the number in it
    // has to match the allocator: slots + the platform's one.
    assert.match(text, /Three boxes is the most any page in this product holds/);
    // And the third charge, named on the seller's own page: a person can pay the
    // platform for a look, and it must say in the same breath that it opens nothing.
    assert.ok(rows.some((r) => /ByteBikri\u2019s other line/.test(r.term)), 'the platform\'s other income is a row, not a footnote');
    assert.match(text, /opens no file, removes no ad/);

    // A store with no position of its own is told that, rather than shown a split of
    // positions that are never taken from it.
    const short = revenueRows({ planName: 'Free', planPrice: 'free, permanently', slotCount: 0 });
    assert.match(short[2].text, /no rent to price/);
    assert.doesNotMatch(short.map((r) => r.text).join(' '), /You keep 1 of the 2/);

    // And the page shows it: the rows are rendered, not merely available.
    const html = views.channelMembers({
      channel, user: { id: owner.id, email: owner.email, display_name: owner.display_name },
      tiers: await store.membershipTiers(channel.id), members: [], pending: [],
      membershipsOn: true, plan: PLANS.store, files: [],
    });
    assert.match(html, /Where the money goes/, 'the panel is on the seller\'s own page');
    assert.match(html, /Dues are 100% yours/);
    assert.match(html, /href="\/dashboard\/[^"]+\/earnings"/, 'and the arithmetic it does not print is one link away');
    assert.ok(member.id, 'sanity');
  } finally { await cleanup(channel, owner, member); }
});

test('the member is told where the ads are before they are asked for money', async () => {
  const { owner, channel, member } = await fixture();
  try {
    const tiers = await store.membershipTiers(channel.id);
    const signedIn = views.storefront({
      channel, assets: [], slots: [], user: { id: member.id, display_name: 'A Buyer' },
      membershipsOn: true, membership: null, roster: [], tiers,
    });
    // The promise is made on the SELLING page, before anybody sends money: the file
    // opens with no ad, and the page around it carries the store's positions and the
    // one the platform rents. The researched record (September 2026) is the reason
    // this sentence exists at all: YouTube Premium is defending two class actions
    // over "ad-free" claims, and Disney+ had to rewrite its terms to allow ads on
    // its ad-free tiers. A membership sells a promise about ads, so the promise is
    // written down where it is being sold.
    assert.match(signedIn, /Ad positions sit around a member/);
    assert.match(signedIn, /never inside it/);
    // And the ANONYMOUS one, which is the branch most people actually read: a
    // visitor deciding whether to make an account is the person who most wants to
    // know what happens with ads.
    const anonymous = views.storefront({
      channel, assets: [], slots: [], user: null, membershipsOn: true, membership: null,
      roster: [], tiers,
    });
    assert.match(anonymous, /Ad positions sit around a member/);

    // And it is repeated on the member's own card once the dues are confirmed, so
    // the person who paid is not left to find it on a pricing page.
    await store.joinMembership({ profileId: member.id, channelId: channel.id, tierNo: 1, claim: claim() });
    await store.confirmMembership({
      profileId: member.id, channelId: channel.id, ownerId: owner.id, actorId: owner.id,
    });
    const membership = await store.membershipFor(member.id, channel.id);
    const live = views.storefront({
      channel, assets: [], slots: [], user: { id: member.id, display_name: 'A Buyer' },
      membershipsOn: true, membership, roster: [], tiers,
    });
    assert.match(live, /Nothing is placed between you and the file/);
    assert.match(live, /none of them gates a download or interrupts one/);
    // The sentence has to stay true of the product, not only of the copy: the
    // platform's slot is the LAST position on a page, and it is the only one it takes.
    assert.match(MEMBER_AD_LINE, /opens because your dues are current/);
    assert.ok(owner.id && member.id, 'sanity');

    /*
     * AND THE SAME PAGE ON THE PLAN THAT RELEASES OUR POSITION.
     *
     * `MEMBER_AD_LINE` names two kinds of position and says both are on the page. On a
     * store carrying `ad_free` ours is not, and the member reading that sentence is
     * looking at the empty space it describes — the sentence became false in the same
     * release that made the perk real. The storefront now chooses between two
     * sentences on the plan it already holds, and this asserts both, because a
     * two-branch sentence with one branch rendered is one branch tested.
     */
    assert.match(MEMBER_AD_LINE_RELEASED, /releases the one ad position bytebikri keeps/);
    assert.match(MEMBER_AD_LINE_RELEASED, /none of them gates a download or interrupts one/,
      'the promise that matters is word for word the same in both states');
    assert.doesNotMatch(MEMBER_AD_LINE_RELEASED, /the one bytebikri rents/,
      'the released sentence must not claim our position is on the page');
    assert.equal(memberAdLine({}), MEMBER_AD_LINE, 'the default is the sentence for a store that did not buy it');
    assert.equal(memberAdLine({ released: true }), MEMBER_AD_LINE_RELEASED);

    // The seller's own panel prints the member's sentence, so it cannot disagree with
    // the member's page about which positions are on it.
    const released = revenueRows({ planName: 'Pro', planPrice: 'NPR 1999 a year', slotCount: 2, releasesPosition: true });
    assert.match(released[3].text, /releases the one ad position bytebikri keeps/);
    assert.doesNotMatch(revenueRows({ planName: 'Pro', planPrice: 'x', slotCount: 2 })[3].text,
      /releases the one ad position/);
    const releasedPage = views.storefront({
      channel, assets: [], slots: [], user: { id: member.id, display_name: 'A Buyer' },
      membershipsOn: true, membership, roster: [], tiers,
      plan: { code: 'pro', name: 'Pro', capabilities: { ad_free: true } },
    });
    assert.match(releasedPage, /releases the one ad position bytebikri keeps/,
      'a Pro store’s member is told the position is not on their page');
    assert.doesNotMatch(releasedPage, /the one bytebikri rents/,
      'and is not told the opposite on the page above it');
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
  assert.deepEqual(good.value, {
    name: 'Friend', duesNpr: 150, periodMonths: 1, perks: 'notes', accent: 'teal',
    // The two doors. Absent from the form, absent from the draft: `null` is "keep
    // what the tier already has", which is what makes a picker that predates these
    // fields harmless on an edit, and it is not the same as choosing the default.
    joinMode: null, adMode: null,
    // The chip's shape. Unlike the two arrangements above, an absent or unknown glyph
    // means NONE rather than "keep what you have": a tier either wears a shape or
    // wears nothing, and a picker with no way back would keep a decoration somebody
    // has stopped wanting. The vocabulary itself is asserted in identity.test.js.
    glyph: null,
  });
  assert.deepEqual(tierDraft({ name: 'Friend', duesNpr: 150, periodMonths: 1, joinMode: 'attention' }).value.joinMode, 'attention');
  assert.deepEqual(tierDraft({ name: 'Friend', duesNpr: 150, periodMonths: 1, adMode: 'supporter' }).value.adMode, 'supporter');
  assert.equal(tierDraft({ name: 'Friend', duesNpr: 150, periodMonths: 1, joinMode: 'both-doors' }).value.joinMode, null,
    'a mode nobody defined falls back to what the tier has, not to a guess');
  assert.equal(tierDraft({ name: 'Friend', duesNpr: 150, periodMonths: 1, adMode: 'no-ads-ever' }).value.adMode, null,
    'and the same for the ad arrangement');
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

// ── 6. the attention door: the second way in, and it takes no money ──────────
//
// The framework this round settled on has one unusual claim at its centre: a store
// may let somebody in by WATCHING — the ads it already shows — and the platform,
// not the seller, decides what that costs. Four things have to stay true or the
// claim becomes a lie in somebody's favour:
//
//   * a view only counts if a network confirmed it, and the counter is per STORE;
//   * the price is the platform's — a seller has no column to type it into;
//   * joining by watching writes no claim, so it can never appear in the dues queue
//     as something the creator is asked to check against a statement;
//   * and a member who watches further is buying the NEXT period, not joining again,
//     and nothing about how they joined the first time is rewritten.

test('the price of the second door is the platform\'s, and it is stated on both doors', async () => {
  assert.deepEqual(attentionViews(1), 4);
  assert.deepEqual(attentionViews(3), 8);
  assert.deepEqual(attentionViews(12), 12);
  assert.equal(attentionViews(7), 4, 'a period nobody defined costs a month — never free, never undefined');

  // The seller's write path has no field for it: the tier is saved with the doors
  // and the arrangement, and the price comes out of the table above.
  const { owner, channel } = await fixture();
  try {
    await store.saveMembershipTier({
      channelId: channel.id, tierNo: 1, actorId: owner.id,
      value: {
        name: 'Friend', duesNpr: 150, periodMonths: 1, perks: 'notes', accent: 'teal',
        joinMode: 'both', adMode: 'ad_free',
        // A seller trying to type a price. Nothing reads it, so it changes nothing.
        attentionViews: 1,
      },
    });
    const saved = (await store.membershipTiers(channel.id)).find((t) => Number(t.tier_no) === 1);
    assert.deepEqual(doorsOf(saved), { dues: true, attention: true });
    assert.equal(attentionViews(saved.period_months), 4);
    assert.equal(adModeOf(saved), 'ad_free');
    assert.equal(saved.attention_views, undefined, 'there is no such column to save it in');

    const line = attentionLine(saved);
    assert.match(line, /4 verified views/);
    assert.match(ATTENTION_MONEY_LINE, /takes no share/);
    assert.match(ATTENTION_MONEY_LINE, /no money anywhere in this door/);
  } finally { await cleanup(channel, owner); }
});

test('views are earned one at a time, per store, and only a confirmed one counts', async () => {
  const { owner, channel, member, tag } = await fixture();
  const other = await store.userByEmailOrCreate(`walker-${tag}@test.local`);
  try {
    await store.saveMembershipTier({
      channelId: channel.id, tierNo: 1, actorId: owner.id,
      value: { name: 'Friend', duesNpr: 150, periodMonths: 1, perks: 'notes', accent: 'teal', joinMode: 'attention' },
    });
    const asset = await fileIn(channel.id, { tier: 1, tag });
    await query(`update assets set unlock_mode = 'ad_gated', member_tier = 0 where id = $1`, [asset.id]);

    assert.equal(await store.standingFor(member.id, channel.id), 0, 'a missing row is zero, not an error');

    // A view the network did NOT confirm. The same statement that records a delivery
    // is what credits the counter, and it is given completed: false here.
    await store.claimAdView({
      channel_id: channel.id, user_id: member.id, asset_id: asset.id,
      connection_id: null, provider_id: 'house', external_id: `unconf-${tag}`,
      kind: 'rewarded', state: 'pending', completed: false,
    });
    assert.equal(await store.standingFor(member.id, channel.id), 0, 'a pending view banks nothing');

    for (let i = 0; i < 4; i += 1) {
      await store.claimAdView({
        channel_id: channel.id, user_id: member.id, asset_id: asset.id,
        connection_id: null, provider_id: 'house', external_id: `conf-${tag}-${i}`,
        kind: 'rewarded', state: 'complete', completed: true,
      });
    }
    assert.equal(await store.standingFor(member.id, channel.id), 4);
    assert.equal(await store.standingFor(other.id, channel.id), 0,
      'and it is that store\'s counter — watching somewhere else banks nothing here');

    const tier = (await store.membershipTiers(channel.id))[0];
    assert.equal(attentionProgress({ tier, standing: 3 }).short, 1);
    assert.equal(attentionProgress({ tier, standing: 3 }).ready, false);
    assert.match(attentionStandingLine({ tier, standing: 1 }), /1 of the 4/);
    assert.match(attentionBankedLine({ tier, standing: 1 }), /another period/);
  } finally { await cleanup(channel, owner, member, other); }
});

test('joining by watching writes no claim, spends the views, and refuses when short', async () => {
  const { owner, channel, member, tag } = await fixture();
  try {
    await store.saveMembershipTier({
      channelId: channel.id, tierNo: 1, actorId: owner.id,
      value: { name: 'Friend', duesNpr: 150, periodMonths: 3, perks: 'notes', accent: 'teal', joinMode: 'attention' },
    });
    const tier = (await store.membershipTiers(channel.id))[0];

    const short = await store.joinByAttention({
      profileId: member.id, channelId: channel.id, tierNo: 1, tier,
    });
    assert.equal(short.ok, false);
    assert.equal(short.reason, 'short');
    assert.equal(short.needed, 8, 'the refusal carries the price');
    assert.equal(short.have, 0, 'and where they are against it');
    assert.equal(await store.membershipFor(member.id, channel.id), null, 'nothing was written');

    await store.accrueStanding({ profileId: member.id, channelId: channel.id, views: 8 });
    const joined = await store.joinByAttention({
      profileId: member.id, channelId: channel.id, tierNo: 1, tier, actorId: member.id,
    });
    assert.equal(joined.ok, true);
    assert.equal(joined.extended, false);
    const row = await store.membershipFor(member.id, channel.id);
    assert.equal(row.status, 'active');
    assert.equal(row.join_method, 'attention');
    assert.equal(row.standing_used, 8);
    assert.equal(await store.standingFor(member.id, channel.id), 0, 'the price was spent, not spent twice');
    assert.equal(row.txn_reference, null, 'no reference: nobody sent anything to look up');
    assert.equal(row.amount_npr, null);
    assert.equal(row.method, null);
    assert.equal(row.confirmed_by, null, 'and no creator confirmed it, because there was nothing to confirm');

    // The creator's queue is a list of things to check against a statement. This
    // join is not one of them, at any point.
    const queue = await store.membersOfChannel(channel.id);
    const mine = queue.find((r) => r.profile_id === member.id);
    assert.equal(mine.txn_reference, null);
    assert.ok(mine.period_end, 'the period is the thing that is real');
    assert.match(SUPPORTER_LINE, /ordinary asks/);
    assert.ok(owner && tag);
  } finally { await cleanup(channel, owner, member); }
});

test('a member who keeps watching buys the NEXT period, and their history is left alone', async () => {
  const { owner, channel, member } = await fixture();
  try {
    await store.saveMembershipTier({
      channelId: channel.id, tierNo: 1, actorId: owner.id,
      value: { name: 'Friend', duesNpr: 150, periodMonths: 1, perks: 'notes', accent: 'teal', joinMode: 'both' },
    });
    await store.saveMembershipTier({
      channelId: channel.id, tierNo: 2, actorId: owner.id,
      value: { name: 'Elite', duesNpr: 600, periodMonths: 3, perks: 'recordings', accent: 'violet', joinMode: 'both' },
    });
    // In with dues, and hidden from the roster by their own choice.
    await store.joinMembership({ profileId: member.id, channelId: channel.id, tierNo: 1, claim: claim() });
    await store.confirmMembership({ profileId: member.id, channelId: channel.id, ownerId: owner.id, actorId: owner.id });
    await store.setMemberListed({ profileId: member.id, channelId: channel.id, listed: false });
    const before = await store.membershipFor(member.id, channel.id);

    await store.accrueStanding({ profileId: member.id, channelId: channel.id, views: 4 });
    const tiers = await store.membershipTiers(channel.id);
    const one = tiers.find((t) => Number(t.tier_no) === 1);
    const two = tiers.find((t) => Number(t.tier_no) === 2);

    const other = await store.joinByAttention({ profileId: member.id, channelId: channel.id, tierNo: 2, tier: two });
    assert.equal(other.ok, false);
    assert.equal(other.reason, 'already-in', 'another tier is not a watching decision — the membership panel is one tier');
    assert.equal(await store.standingFor(member.id, channel.id), 4, 'and the refusal spent nothing');

    const extended = await store.joinByAttention({
      profileId: member.id, channelId: channel.id, tierNo: 1, tier: one, actorId: member.id,
    });
    assert.equal(extended.ok, true);
    assert.equal(extended.extended, true);
    const after = await store.membershipFor(member.id, channel.id);
    assert.ok(new Date(after.period_end) > new Date(before.period_end), 'the new period was added');
    const added = Math.round((new Date(after.period_end) - new Date(before.period_end)) / 86_400_000);
    assert.ok(added >= 28 && added <= 31, `a month was added, not a second period in place of the first (${added} days)`);
    assert.equal(after.join_method, 'dues', 'how they got in is their history, and four views do not rewrite it');
    assert.equal(after.ad_mode, before.ad_mode, 'nor the arrangement they joined under');
    assert.equal(after.publicly_listed, false, 'nor whether they are named');
    assert.equal(after.standing_used, 4, 'the views spent are recorded');
    assert.equal(await store.standingFor(member.id, channel.id), 0);

    const audit = await query(
      `select action from audit_logs where action = 'member.extended_by_watching' and subject_id = $1`,
      [channel.id],
    );
    assert.equal(audit.rows.length, 1, 'the extension is in the record, where the history was not rewritten');
  } finally { await cleanup(channel, owner, member); }
});

test('a members-only file refuses a non-member, opens for a member, and keeps the ask on a supporter tier', async () => {
  const { owner, channel, member, tag } = await fixture();
  const visitor = await store.userByEmailOrCreate(`visitor-${tag}@test.local`);
  try {
    await store.saveMembershipTier({
      channelId: channel.id, tierNo: 1, actorId: owner.id,
      value: { name: 'Friend', duesNpr: 150, periodMonths: 1, perks: 'notes', accent: 'teal', joinMode: 'both', adMode: 'ad_free' },
    });
    const tier = (await store.membershipTiers(channel.id))[0];
    const asset = await fileIn(channel.id, { tier: 1, tag });

    // The hole this round closed: the page hid the watch button for a members-only
    // file, and the route did not check — so a non-member could watch an ad and get in.
    const refused = await startUnlock({ assetId: asset.id, userId: visitor.id });
    assert.equal(refused.ok, false);
    assert.match(refused.error, /members/, 'the refusal says whose file it is');

    // A member of an ad_free tier: covered, no ask at all.
    await store.joinMembership({ profileId: member.id, channelId: channel.id, tierNo: 1, claim: claim() });
    await store.confirmMembership({ profileId: member.id, channelId: channel.id, ownerId: owner.id, actorId: owner.id });
    const covered = await store.memberDoorFor({ profileId: member.id, channelId: channel.id, asset });
    assert.equal(covered.door, 'covered');
    assert.ok(await store.memberCoversAsset({ profileId: member.id, channelId: channel.id, asset }));

    // The opt-in arrangement, stated before the join and snapshotted onto it.
    await store.saveMembershipTier({
      channelId: channel.id, tierNo: 1, actorId: owner.id,
      value: { name: 'Friend', duesNpr: 150, periodMonths: 1, perks: 'notes', accent: 'teal', joinMode: 'both', adMode: 'supporter' },
    });
    const snapshot = await store.membershipFor(member.id, channel.id);
    assert.equal(adModeOf(snapshot), 'ad_free', 'changing the tier does not change a membership already in');
    await store.accrueStanding({ profileId: visitor.id, channelId: channel.id, views: 4 });
    const joined = await store.joinByAttention({
      profileId: visitor.id, channelId: channel.id, tierNo: 1, tier: (await store.membershipTiers(channel.id))[0],
    });
    assert.equal(joined.ok, true);
    assert.equal(joined.membership.ad_mode, 'supporter', 'the arrangement in force when they pressed the button');
    const door = await store.memberDoorFor({ profileId: visitor.id, channelId: channel.id, asset });
    assert.equal(door.door, 'ads', 'their membership keeps the ordinary ask');
    assert.equal(await store.memberCoversAsset({ profileId: visitor.id, channelId: channel.id, asset }), null,
      'so the page must not show it as open');
    assert.equal(doorFor({ membership: joined.membership, memberTier: 1 }), 'ads');
    // Three answers, and the door is named by who may walk through it: an unpaid
    // claim is not a membership ('members' means "belongs to members"), and neither
    // is a tier below the file's.
    assert.equal(doorFor({ membership: { ...joined.membership, status: 'pending' }, memberTier: 1 }), 'members',
      'a claim waiting is not a membership');
    assert.equal(doorFor({ membership: joined.membership, memberTier: 2 }), 'members',
      'a lower tier does not open a higher tier\'s file');
  } finally { await cleanup(channel, owner, member, visitor); }
});
