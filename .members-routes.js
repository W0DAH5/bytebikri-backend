// ---------------------------------------------------------------------------
// Memberships — belonging to a store, and paying the creator for it
// ---------------------------------------------------------------------------
// Four seller routes and three buyer routes. The shape of every one of them
// comes from a single fact: this platform never touches the dues. It cannot
// check them, cannot confirm them, cannot hold or refund them. So the seller's
// side is a QUEUE A HUMAN CLEARS against their own statement, and the buyer's
// side is a CLAIM plus a wait — and the pages say exactly that rather than
// dressing a manual rail up as an instant purchase.

/**
 * The join panel, as one redirect helper.
 *
 * `back` is always the storefront: the person came from there, the panel is
 * there, and the answer ("you are in, waiting for the creator") belongs where
 * they can see their own state.
 */
function memberBack(channel, extra = '') {
  return `/s/${encodeURIComponent(channel.slug)}${extra}`;
}

APP.post('/s/:slug/join', limitWatch, async (req, res, next) => {
  try {
    const channel = await store.channelBySlug(req.params.slug);
    if (!channel) return res.status(404).send(views.notFound({ user: req.user, requestedKind: 'store' }));
    if (!req.user) return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);

    // Two refusals before anything is written, and both are sentences a person
    // is owed: you cannot join your own store (the dues would be a loop), and
    // you cannot join a store whose plan does not include members.
    if (channel.owner_id === req.user.id) return res.redirect(memberBack(channel, '?error=member-own'));
    const plan = store.plan(channel);
    if (plan.capabilities?.memberships !== true) return res.redirect(memberBack(channel, '?error=member-plan'));

    const tiers = await store.membershipTiers(channel.id);
    const wanted = Number(req.body?.tier) || 1;
    const tier = tiers.find((t) => Number(t.tier_no) === wanted) ?? tiers[0] ?? null;
    if (!tier) return res.redirect(memberBack(channel, '?error=member-no-tier'));

    // A reference is the only thing that can be matched against a statement. The
    // form asks for it at the door rather than two screens later, because a
    // claim without one sits in the creator's queue until they give up on it.
    const method = CLAIM_METHODS.includes(String(req.body?.method)) ? String(req.body.method) : 'other';
    const reference = String(req.body?.reference || '').trim();
    if (reference.length < 4) return res.redirect(memberBack(channel, '?error=member-reference'));

    const row = await store.joinMembership({
      profileId: req.user.id,
      channelId: channel.id,
      tierNo: tier.tier_no,
      claim: {
        amountNpr: Number(req.body?.amount) || null,
        method,
        txnReference: reference,
        payerName: String(req.body?.payerName || '').trim().slice(0, 120) || req.user.display_name,
        payerNumber: String(req.body?.payerNumber || '').trim().slice(0, 40) || null,
      },
    });
    if (!row) return res.redirect(memberBack(channel, '?error=member-active'));
    await store.audit('member.claimed', {
      channelId: channel.id, tierNo: tier.tier_no, amountNpr: row.amount_npr,
      txnReference: row.txn_reference, method: row.method,
    }, { actorId: req.user.id, subjectType: 'channel', subjectId: channel.id });
    return res.redirect(memberBack(channel, '?joined=1#members'));
  } catch (err) { return next(err); }
});

APP.post('/s/:slug/leave', limitWatch, async (req, res, next) => {
  try {
    const channel = await store.channelBySlug(req.params.slug);
    if (!channel) return res.status(404).send(views.notFound({ user: req.user, requestedKind: 'store' }));
    if (!req.user) return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
    const left = await store.leaveMembership(req.user.id, channel.id);
    return res.redirect(memberBack(channel, left ? '?left=1#members' : '?error=member-none'));
  } catch (err) { return next(err); }
});

/** Being named on the storefront is the perk, and it is the member's call. */
APP.post('/s/:slug/members/listing', limitWatch, async (req, res, next) => {
  try {
    const channel = await store.channelBySlug(req.params.slug);
    if (!channel) return res.status(404).send(views.notFound({ user: req.user, requestedKind: 'store' }));
    if (!req.user) return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
    const listed = await store.setMemberListed({
      profileId: req.user.id, channelId: channel.id, listed: req.body?.listed === 'yes',
    });
    return res.redirect(memberBack(channel, listed ? '?listed=1#members' : '?error=member-none'));
  } catch (err) { return next(err); }
});

// ── the seller's side ──────────────────────────────────────────────────────

APP.get('/dashboard/:slug/members', async (req, res, next) => {
  try {
    const channel = await ownerChannel(req, res);
    if (!channel) return undefined;
    const plan = store.plan(channel);
    res.send(views.channelMembers({
      channel, user: req.user, consent: req.consent, flash: flashFor(req.query),
      tiers: await store.membershipTiers(channel.id),
      members: await store.membersOfChannel(channel.id),
      pending: await store.pendingMemberships(channel.id),
      membershipsOn: plan.capabilities?.memberships === true,
      plan,
    }));
  } catch (err) { return next(err); }
});

/**
 * Save a tier.
 *
 * The capability is refused HERE as well as on the page, because a Free store
 * that posts this form is either a stale tab or somebody poking at the API, and
 * both deserve a sentence rather than a row in a table it cannot use.
 */
APP.post('/dashboard/:slug/members/tier/:tierNo', async (req, res, next) => {
  try {
    const channel = await ownerChannel(req, res);
    if (!channel) return undefined;
    if (refuseWrite(req, res, channel)) return undefined;
    const back = `/dashboard/${encodeURIComponent(channel.slug)}/members`;
    if (store.plan(channel).capabilities?.memberships !== true) return res.redirect(`${back}?error=member-plan`);
    const tierNo = Number(req.params.tierNo);
    if (![1, 2].includes(tierNo)) return res.redirect(`${back}?error=tier-missing`);

    const draft = tierDraft(req.body);
    if (!draft.ok) return res.redirect(`${back}?error=${draft.error}`);
    await store.saveMembershipTier({ channelId: channel.id, tierNo, value: draft.value, actorId: req.user.id });
    return res.redirect(`${back}?tier-saved=${tierNo}`);
  } catch (err) { return next(err); }
});

APP.post('/dashboard/:slug/members/tier/:tierNo/remove', async (req, res, next) => {
  try {
    const channel = await ownerChannel(req, res);
    if (!channel) return undefined;
    if (refuseWrite(req, res, channel)) return undefined;
    const back = `/dashboard/${encodeURIComponent(channel.slug)}/members`;
    const result = await store.deleteMembershipTier({
      channelId: channel.id, tierNo: Number(req.params.tierNo), actorId: req.user.id,
    });
    return res.redirect(`${back}?${result.ok ? 'tier-removed=1' : `error=${result.reason}`}`);
  } catch (err) { return next(err); }
});

APP.post('/dashboard/:slug/members/note', async (req, res, next) => {
  try {
    const channel = await ownerChannel(req, res);
    if (!channel) return undefined;
    if (refuseWrite(req, res, channel)) return undefined;
    const back = `/dashboard/${encodeURIComponent(channel.slug)}/members`;
    if (store.plan(channel).capabilities?.memberships !== true) return res.redirect(`${back}?error=member-plan`);
    await store.setMembershipNote({
      channelId: channel.id, note: paymentNoteDraft(req.body?.note), actorId: req.user.id,
    });
    return res.redirect(`${back}?note-saved=1`);
  } catch (err) { return next(err); }
});

/**
 * The creator says the money arrived.
 *
 * `ownerChannel` has already established that this person owns the store, and
 * `confirmMembership` checks the same thing again in SQL — an operator cannot
 * reach this state by any route, which is the whole design: the platform never
 * sees these dues, so nobody here can honestly confirm one.
 */
APP.post('/dashboard/:slug/members/:profileId/confirm', async (req, res, next) => {
  try {
    const channel = await ownerChannel(req, res);
    if (!channel) return undefined;
    if (refuseWrite(req, res, channel)) return undefined;
    const back = `/dashboard/${encodeURIComponent(channel.slug)}/members`;
    const row = await store.confirmMembership({
      profileId: req.params.profileId, channelId: channel.id,
      ownerId: req.user.id, actorId: req.user.id,
    });
    return res.redirect(`${back}?${row ? 'member-confirmed=1' : 'error=member-missing'}`);
  } catch (err) { return next(err); }
});

APP.post('/dashboard/:slug/members/:profileId/reject', async (req, res, next) => {
  try {
    const channel = await ownerChannel(req, res);
    if (!channel) return undefined;
    if (refuseWrite(req, res, channel)) return undefined;
    const back = `/dashboard/${encodeURIComponent(channel.slug)}/members`;
    const row = await store.rejectMembership({
      profileId: req.params.profileId, channelId: channel.id, ownerId: req.user.id,
      reason: req.body?.reason, actorId: req.user.id,
    });
    return res.redirect(`${back}?${row ? 'member-rejected=1' : 'error=member-missing'}`);
  } catch (err) { return next(err); }
});

