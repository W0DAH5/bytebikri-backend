// ── 4b. Members (§30): a store that sells belonging, and the two states of a ──
// ──     claim that matter                                                    ──
//
// This section is deliberately a RESTORE, not just a seed, for the same reason
// the check below it is: the preview is a working product and a person working it
// will confirm the waiting claim — that is what the queue is for. A seeder that
// only ever creates leaves the second run looking broken, and "the demo lost its
// state" is a worse bug report than any of the ones this script exists to avoid.
//
// So: any membership row nobody seeded is removed, the two seeded rows are put
// back where they belong (Alice current, Bob waiting), and the members-only file
// is re-asserted. The states the preview is meant to show:
//
//   * a storefront with two tiers, a named member wearing the top tier's plate,
//     and a locked members-only file — the teaser, which is the whole conversion
//     surface;
//   * a seller page with one claim waiting on a reference that can be matched and
//     one member who is current, so both halves of the queue are visible;
//   * and a member's own page (Alice, signed in) saying which tier she holds and
//     how long it runs.
if (nimaStore) {
  const nimaOwner = (await one('select owner_id from channels where id = $1', [nimaStore.id]))?.owner_id;
  const aliceProfile = await one(`select owner_id from channels where slug = 'alice'`);
  const bobProfile = await one(`select owner_id from channels where slug = 'bob'`);

  // The tiers. Two, named the way a small Nepali studio would name them, and the
  // dues are what the CREATOR asks — the platform is not in this number.
  const TIERS = [
    {
      tierNo: 1, name: 'Friend', duesNpr: 150, periodMonths: 1, accent: 'teal',
      perks: 'Every new template a week early, and the notes behind it',
    },
    {
      tierNo: 2, name: 'Elite', duesNpr: 600, periodMonths: 3, accent: 'violet',
      perks: 'Everything above, plus the workshop recordings and a file a month only elites open',
    },
  ];
  for (const t of TIERS) {
    await store.saveMembershipTier({
      channelId: nimaStore.id, tierNo: t.tierNo, actorId: nimaOwner,
      value: { name: t.name, duesNpr: t.duesNpr, periodMonths: t.periodMonths, perks: t.perks, accent: t.accent },
    });
  }
  const note = 'eSewa 9800000009 (Nima Crafts). Put your username in the remark so I can find you — '
    + 'I check the statement every evening.';
  const hadNote = (await one('select membership_note from channels where id = $1', [nimaStore.id]))?.membership_note;
  if (hadNote !== note) {
    await store.setMembershipNote({ channelId: nimaStore.id, note, actorId: nimaOwner });
  }

  // The file only elites open. Created through the store, approved the way an
  // operator approves one (there is no other honest way to make a file public),
  // with a cover and real bytes so the locked card is a picture rather than a
  // placeholder — a shop window with a hole in it demonstrates nothing.
  let eliteFile = await one(
    'select id, status, moderation_state from assets where channel_id = $1 and slug = $2',
    [nimaStore.id, 'bhaktapur-workshop-recordings'],
  );
  if (!eliteFile) {
    eliteFile = await store.createAsset({
      channelId: nimaStore.id,
      title: 'Bhaktapur workshop recordings',
      slug: 'bhaktapur-workshop-recordings',
      description: 'Four evenings of the binding workshop, screen and camera. Members only — this is the file the top tier exists for.',
      unlockMode: 'members',
    });
    const body = Buffer.from('ByteBikri demo file (Nima Crafts · Elite members).\n');
    await store.addFile({
      assetId: eliteFile.id, storageKey: await storage.put(body, 'bhaktapur-workshop.txt'),
      filename: 'bhaktapur-workshop-notes.txt', mimeType: 'text/plain', sizeBytes: body.length,
      checksum: createHash('sha256').update(body).digest('hex'),
    });
    const cover = await fs.readFile(new URL('../app/public/img/demo/sample-pack.jpg', import.meta.url));
    await store.updateAsset(eliteFile.id, {
      cover_url: `/media/${await storage.put(cover, 'bhaktapur-workshop-cover.jpg', { namespace: 'public' })}`,
    });
    say('elite file', `created — ${eliteFile.moderation_state}, waiting for the same look every first file gets`);
  }
  // The state that matters is 'live' + 'approved'; both are asserted so a preview
  // session that paused it, or an operator who has not looked yet, is repaired.
  if (OPERATOR) {
    if (eliteFile.moderation_state !== 'approved') {
      await store.setAssetModeration({
        assetId: eliteFile.id, action: 'approved', state: 'approved', actorId: OPERATOR.id,
        remedy: 'Demo seed: approved so the members-only card is visible on the storefront.',
      });
    }
    await many(`update assets set member_tier = 2, unlock_mode = 'members', status = 'live' where id = $1`, [eliteFile.id]);
  }

  // ── the two memberships, and the restore ──────────────────────────────────
  const seeded = new Set([aliceProfile?.owner_id, bobProfile?.owner_id].filter(Boolean));
  const stray = await many(
    `select profile_id from memberships where channel_id = $1 and not (profile_id = any($2::uuid[]))`,
    [nimaStore.id, [...seeded]],
  );
  for (const row of stray) {
    await store.leaveMembership(row.profile_id, nimaStore.id);
  }
  if (stray.length) say('members', `reset — removed ${stray.length} row(s) a preview session left behind`);

  if (aliceProfile?.owner_id && nimaOwner) {
    // Alice is the store that has been checked, the shelf with four states, and
    // now the member in the top tier: one account carrying every state this
    // product can show is how a preview gets read in one pass.
    await store.leaveMembership(aliceProfile.owner_id, nimaStore.id);
    await store.joinMembership({
      profileId: aliceProfile.owner_id, channelId: nimaStore.id, tierNo: 2,
      claim: { amountNpr: 600, method: 'esewa', txnReference: 'ESW-4517-ELITE', payerName: 'Alice', payerNumber: '9811111111' },
    });
    const confirmed = await store.confirmMembership({
      profileId: aliceProfile.owner_id, channelId: nimaStore.id, ownerId: nimaOwner, actorId: nimaOwner,
    });
    // Let the membership cover the tier-2 file, so her library and the file page
    // both show access that came from dues rather than from an ad.
    await store.grantMembershipUnlock({
      assetId: eliteFile.id, channelId: nimaStore.id, userId: aliceProfile.owner_id,
      expiresAt: confirmed?.period_end ?? null,
    });
    say('alice member', `Elite, confirmed by the owner, runs to ${String(confirmed?.period_end).slice(0, 10)}`);
  }

  if (bobProfile?.owner_id) {
    // Bob's claim is LEFT PENDING on purpose: it is the queue, and a queue with
    // nothing in it demonstrates nothing. His reference is the one thing the
    // seller's page needs to make the confirm button meaningful.
    await store.leaveMembership(bobProfile.owner_id, nimaStore.id);
    await store.joinMembership({
      profileId: bobProfile.owner_id, channelId: nimaStore.id, tierNo: 1,
      claim: { amountNpr: 150, method: 'esewa', txnReference: 'ESW-8823-DEMO', payerName: 'Bob', payerNumber: '9822222222' },
    });
    say('bob claim', 'Friend tier, waiting for the creator to find ESW-8823-DEMO in the statement');
  }
}
