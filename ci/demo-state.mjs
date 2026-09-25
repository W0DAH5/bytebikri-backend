/**
 * Put the development database into the state the product is demonstrated in.
 *
 * This lived in /tmp for two rounds and was lost both times the workspace was
 * rebuilt — the demo database survives, the script that explains it does not, and
 * the result is a preview whose interesting states are several manual steps away
 * from existing. Anything that has to be re-created after a rebuild belongs in the
 * repository.
 *
 * Three states, each of them a decision this round was built around:
 *
 *   1. A COUNTRY RULE a creator set: Alice withholds one file from India because
 *      her licence covers Nepal only. The file stays listed and refuses unlocks
 *      in India (403 — it is her choice, not a legal one), and the storefront
 *      itself is untouched.
 *   2. A FILE WAITING FOR ITS FIRST REVIEW: Nima Crafts is a new store whose only
 *      file has not been looked at by anybody. It works at its link and on the
 *      store page, it is absent from search, and it is the one item in the
 *      operator's queue.
 *   3. THE THREE IDENTITY STATES A PERSON ACTUALLY WORKS WITH: Alice's check was
 *      made today and runs for two years (her badge and its record are on her
 *      storefront and her operator page); Nima's was made 23 months ago and has a
 *      month left, so her store shows the badge AND a lapse date, she has asked for
 *      the next check, and she is the one row in the console's "checks ending" list
 *      that nobody has been told about yet; Bob has never been checked, which is
 *      where most stores are and which must look like nothing at all. Asking for a
 *      check needs a plan that includes it, so the seeder takes Nima through the
 *      same three calls the real upgrade path uses rather than writing a row a
 *      person could not have produced.
 *
 * Everything is written through the same store calls the routes use — this is the
 * feature, not a fixture. Idempotent: run it as often as you like.
 *
 *   cd app && node ../ci/demo-state.mjs
 */
process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:55432/bytebikri';
const { many, one, query, scalar, close } = await import('../app/src/db.js');
const { store, storage } = await import('../app/src/store.js');
const { createHash } = await import('node:crypto');
const fs = await import('node:fs/promises');

const say = (label, value) => console.log(`  ${label.padEnd(28)} ${value}`);

// ── 1. The country rule ──────────────────────────────────────────────────────
// Whatever the last walkthrough left, so the demo is one deliberate example.
for (const r of await many('select * from asset_country_rules')) {
  await store.clearAssetCountryRule({ assetId: r.asset_id, countryCode: r.country_code });
}
for (const b of await many(`select * from content_geo_blocks where subject_type = 'channel'`)) {
  await store.clearChannelCountryBlock({ channelId: b.subject_id, countryCode: b.country_code });
}

const alice = await one(`select id, slug from channels where slug = 'alice'`);
const walkthrough = alice
  ? await one(`select id, title from assets where channel_id = $1 and slug = 'poster-kit-walkthrough'`, [alice.id])
  : null;
const aliceOwner = alice ? await one('select owner_id from channels where id = $1', [alice.id]) : null;

if (walkthrough) {
  await store.setAssetCountryRule({
    assetId: walkthrough.id, countryCode: 'IN', state: 'blocked',
    note: 'Licence covers Nepal only.', source: 'creator', actorId: aliceOwner.owner_id,
  });
  await store.audit('geo.rule_set',
    { assetId: walkthrough.id, country: 'IN', state: 'blocked', by: 'creator', demo: true },
    { actorId: aliceOwner.owner_id, subjectType: 'asset', subjectId: walkthrough.id });
  say('country example', `${walkthrough.title} withheld from India by its creator`);
}

// ── 2. A store whose first file is waiting ───────────────────────────────────
const NIMA = 'nima@bytebikri.local';
let nima = await one(`select id, slug, name from channels where owner_id =
  (select id from profiles where email = $1) limit 1`, [NIMA]);
if (!nima) {
  // `createAccount`, not `userByEmailOrCreate`: the demo store's owner has to be
  // able to sign in and look at their own dashboard, or half of what this script
  // sets up is unreachable from a browser.
  const { createAccount } = await import('../app/src/auth.js');
  const owner = await createAccount({
    email: NIMA, password: process.env.DEMO_PASSWORD || 'bytebikri-demo', displayName: 'Nima Gurung',
  });
  nima = await store.createChannel({
    ownerId: owner.id, slug: 'nima-crafts', name: 'Nima Crafts',
    tagline: 'Hand-bound notebooks, made in Pokhara.', listingMode: 'marketplace',
  });
}
if (!nima.tagline) {
  await store.updateChannel(nima.id, {
    tagline: 'Hand-bound notebooks, made in Pokhara.', listing_mode: 'marketplace',
  });
}

// The owner's password, set every time this runs. `userByEmailOrCreate` leaves an
// account that cannot sign in, and a demo store nobody can look at from a browser
// is only half a demo — the creator's own page is where the wait is explained.
const { setPassword } = await import('../app/src/auth.js');
const owner = await one('select id from profiles where email = $1', [NIMA]);
if (owner) {
  await setPassword(owner.id, process.env.DEMO_PASSWORD || 'bytebikri-demo');
  say('demo sign-in', `${NIMA} / ${process.env.DEMO_PASSWORD || 'bytebikri-demo'}`);
}

let waiting = await one(
  'select id, title, moderation_state from assets where channel_id = $1 and slug = $2',
  [nima.id, 'pokhara-notebook-set'],
);
if (!waiting) {
  // Through `createAsset`, so the state is whatever the rule says it is — which is
  // the entire point of this half of the demo.
  waiting = await store.createAsset({
    channelId: nima.id, title: 'Pokhara notebook set',
    slug: 'pokhara-notebook-set',
    description: 'Twelve hand-bound notebooks, photographed and scanned. A new store, before anybody has looked at it.',
  });
  say('waiting file', `${waiting.title} — state ${waiting.moderation_state} (the rule decided)`);
} else {
  say('waiting file', `${waiting.title} — state ${waiting.moderation_state}`);
}

// The file's BYTES, checked separately from the asset.
//
// This script crashed once between `createAsset` and `addFile` — `storage` is
// imported from the store module and the first version imported it from the wrong
// place — and the "does an asset already exist?" check above then saw an asset and
// skipped the file forever. The result was a store page reading "0 files" for a
// file that has none, a bug that looks like the product lying and was this script
// not finishing its job. So each half is checked, not just the first.
const hasFile = (await many('select id from asset_files where asset_id = $1', [waiting.id])).length > 0;
if (!hasFile) {
  const body = Buffer.from('ByteBikri demo file (Nima Crafts).\n');
  await store.addFile({
    assetId: waiting.id, storageKey: await storage.put(body, 'pokhara-notebook-set.txt'),
    filename: 'pokhara-notebook-set.txt', mimeType: 'text/plain', sizeBytes: body.length,
    checksum: createHash('sha256').update(body).digest('hex'),
  });
  say('its file', 'added (was missing — half-created state repaired)');
}
// And a cover, so the storefront card is a picture rather than a generated
// placeholder: a store whose only item has no artwork looks unfinished in Explore,
// and every other demo store has one.
if (!(await one('select cover_url from assets where id = $1', [waiting.id]))?.cover_url) {
  const cover = await fs.readFile(new URL('../app/public/img/demo/sample-pack.jpg', import.meta.url));
  await store.updateAsset(waiting.id, {
    cover_url: `/media/${await storage.put(cover, 'pokhara-notebook-cover.jpg', { namespace: 'public' })}`,
  });
  say('its cover', 'set');
}

// ── 3. A checked seller, and one waiting for a check ─────────────────────────
const OPERATOR = await one(`select id, email from profiles where role = 'admin' order by created_at limit 1`);

// Alice: a record of a document a person looked at. Skipped if she already has an
// outcome, so re-running this does not stack up checks that never happened.
if (alice && OPERATOR && !(await one(
  `select id from seller_verifications where channel_id = $1 and status in ('verified','rejected')`, [alice.id]))) {
  await store.recordVerification({
    channelId: alice.id, outcome: 'verified', method: 'citizenship',
    actorId: OPERATOR.id, months: 24,
    note: 'Name and photograph matched the account holder; seen in person.',
  });
  say('alice checked', 'citizenship certificate, 24 months');
}

// Nima: a check made nearly two years ago. Recorded with the date it was SEEN, so
// its window runs from that day and it is already inside the notice band — which is
// the state the console's "ending soon" list exists for, and the state that is
// impossible to fake from a screenshot.
// A person may have worked the queue in the preview — that is what the console is
// for, and since §30 recording an outcome is one press on a page that now has a
// document on it. Doing so replaces the deliberate state below with a fresh
// twenty-four-month check, and hides the "ending soon" list this store exists to
// show. So the seeder puts the DEMONSTRATED state back rather than only creating it:
// outcomes decided by a preview session are removed, and the one it seeds is
// re-asserted. This is the demo seeder, not a migration — it is allowed to be this
// deliberate about the state it exists to produce.
if (nima && OPERATOR) {
  const deliberateMonths = 23;
  const rows = await many(
    `select id, verified_at from seller_verifications
      where channel_id = $1 and status in ('verified','rejected') order by created_at desc`, [nima.id]);
  const wanted = (d) => {
    const when = new Date();
    when.setMonth(when.getMonth() - deliberateMonths);
    return Math.abs(new Date(d).getTime() - when.getTime()) < 10 * 86400000;
  };
  // The deliberate row is the one dated twenty-three months back; anything else in
  // the decided history is a preview session's work, and it is what stands between
  // this store and the "ending soon" list.
  const keep = rows.filter((r) => r.verified_at && wanted(r.verified_at));
  const extra = rows.filter((r) => !keep.some((k) => k.id === r.id));
  if (extra.length) {
    await many(`delete from seller_verifications where id = any($1::uuid[])`, [extra.map((r) => r.id)]);
    say('nima checked', `reset — removed ${extra.length} decided row(s) a preview session left behind`);
  }
  if (!keep.length) {
    const seen = new Date();
    seen.setMonth(seen.getMonth() - deliberateMonths);
    await store.recordVerification({
      channelId: nima.id, outcome: 'verified', method: 'citizenship', actorId: OPERATOR.id,
      months: 24, seenAt: seen, note: 'Seen in person at the shop; name matched the account.',
    });
    say('nima checked', `citizenship, seen ${deliberateMonths} months ago`);
  }
}

// The upgrades a PREVIEW left behind.
//
// Same reasoning as the Plus queue's strays below, and the same lesson: walking the
// money flow in a browser (which is how §33's silent-flash bug was found) leaves a
// pending upgrade and a submitted reference on whatever store was walked. The next
// person to open the preview then sees a state the seeder did not create and cannot
// explain — and this seeder's own upgrade below is guarded by "only if the plan is
// still free", so it would silently not run.
//
// Decided, not deleted, exactly like the Plus strays: a rejection is a real outcome
// with a reason on it, and it is what an operator would have pressed.
{
  const MINE = 'DEMO-PLAN-0001';
  const strays = await many(
    // plan_payments hangs off the SUBSCRIPTION, not the channel: one store has one
    // subscription and many payments against it.
    `select pp.id, pp.txn_reference, c.slug from plan_payments pp
       join subscriptions s on s.id = pp.subscription_id
       join channels c on c.id = s.channel_id
      where pp.status = 'submitted' and pp.txn_reference <> $1`,
    [MINE],
  );
  for (const row of strays) {
    if (OPERATOR?.id) {
      await store.rejectPlanPayment({
        paymentId: row.id, actorId: OPERATOR.id,
        reason: 'Demo reset: not one of the seeded plan payments.',
      });
    }
  }
  // A pending request with no reference under it is a half-finished walk: the seller
  // asked for the upgrade and closed the page. Clearing it is what "nothing is
  // waiting" means on the billing page, and the state is one click from coming back.
  const orphaned = await many(
    `update subscriptions set pending_plan_code = null, pending_since = null
      where pending_plan_code is not null
        and channel_id not in (select channel_id from plan_payments where status = 'submitted')
      returning channel_id`,
  );
  if (strays.length || orphaned.length) {
    say('upgrades', `reset — decided ${strays.length} stray payment(s), cleared ${orphaned.length} orphaned request(s)`);
  }
}

// Nima: the plan she would have to be on to ask, bought the way a seller buys it —
// a request, a transfer reference, and an operator matching it by hand.
if (nima && OPERATOR) {
  const plan = await one(`select plan_code, status from subscriptions where channel_id = $1`, [nima.id]);
  if (!plan || plan.plan_code === 'free') {
    await store.requestUpgrade({ id: nima.id, slug: nima.slug, name: nima.name }, 'store');
    const payment = await store.recordPlanPayment({
      channelId: nima.id, amountNpr: 1500, txnReference: 'DEMO-PLAN-0001',
      method: 'esewa', payerName: 'Nima Gurung', payerNumber: '9800000009',
    });
    await store.matchPlanPayment({ paymentId: payment.id, actorId: OPERATOR.id });
    say('nima upgraded', 'Store plan, matched by the operator');
  }
  const open = await one(`select id from seller_verifications where channel_id = $1 and status = 'pending'`, [nima.id]);
  if (open) {
    await many(`update seller_verifications set request_note = $2 where id = $1`,
      [open.id, 'I am at the shop most mornings, and can bring the original.']);
  } else {
    const asked = await store.askForVerification({
      channelId: nima.id, note: 'I am at the shop most mornings, and can bring the original.',
    });
    say('nima asked for a check', asked.ok ? 'waiting in the operator queue' : asked.reason);
  }
}

// ── 4. A seller with more than one page of files ─────────────────────────────
//
// §27 exists because of one line in the audit: "one file at a time; a seller with
// 200 files will want more". A demo store with three files cannot show what that
// means — no second page, no "select this page" next to "select all N matching",
// and no sort worth using — so the demo carries a seller who has been publishing
// for a few months. Created the way a seller creates them, guarded by slug so a
// re-run adds nothing, and backdated so the date sorts have something to sort.
const EXTRA_FILES = [
  ['Dashain poster set', 'dashain-poster-set', false],
  ['Tihar diya pack', 'tihar-diya-pack', false],
  ['Devanagari grid pack', 'devanagari-grid-pack', true],
  ['Kathmandu skyline print', 'kathmandu-skyline-print', false],
  ['Newari script sampler', 'newari-script-sampler', false],
  ['Pokhara lake photo pack', 'pokhara-lake-photo-pack', false],
  ['Everest route map', 'everest-route-map', true],
  ['Lumbini travel set', 'lumbini-travel-set', false],
  ['Bhaktapur door detail', 'bhaktapur-door-detail', false],
  ['Thangka line art', 'thangka-line-art', false],
  ['Nepali type specimen', 'nepali-type-specimen', true],
  ['Himalayan icon set', 'himalayan-icon-set', false],
  ['Chitwan bird cards', 'chitwan-bird-cards', false],
  ['Terai harvest sticker', 'terai-harvest-sticker', false],
  ['Momo recipe zine', 'momo-recipe-zine', true],
  ['Sel roti recipe card', 'sel-roti-recipe-card', false],
  ['Dhaka topi pattern', 'dhaka-topi-pattern', false],
  ['Boudhanath mandala', 'boudhanath-mandala', false],
  ['Swayambhu sketch pack', 'swayambhu-sketch-pack', false],
  ['Patan museum tiles', 'patan-museum-tiles', true],
  ['Ilam tea label set', 'ilam-tea-label-set', false],
  ['Mustang desert pack', 'mustang-desert-pack', false],
  ['Rara lake posters', 'rara-lake-posters', false],
  ['Janakpur mural scan', 'janakpur-mural-scan', false],
  ['Nepal map for print', 'nepal-map-for-print', false],
  ['Trek permit checklist', 'trek-permit-checklist', false],
];
if (alice) {
  let made = 0;
  for (const [n, [title, slug, open]] of EXTRA_FILES.entries()) {
    const exists = await one('select id from assets where channel_id = $1 and slug = $2', [alice.id, slug]);
    if (exists) continue;
    const asset = await store.createAsset({
      channelId: alice.id, title, slug,
      description: `${title} — made for the shop, exported for print and screen.`,
      unlockMode: open ? 'open' : 'ad_gated',
    });
    const body = Buffer.from(`ByteBikri demo file — ${title}.\n`);
    await store.addFile({
      assetId: asset.id, storageKey: await storage.put(body, `${slug}.txt`),
      filename: `${slug}.txt`, mimeType: 'text/plain', sizeBytes: body.length,
      checksum: createHash('sha256').update(body).digest('hex'),
    });
    // Every fifth file is one the seller paused, and the oldest is dated six days
    // back so "Newest first" and "Oldest first" are different orders on the page.
    await many(`update assets set created_at = now() - ($2 || ' days')::interval where id = $1`,
      [asset.id, String(6 + n * 4)]);
    if (n % 5 === 4) await store.updateAsset(asset.id, { status: 'paused' });
    made += 1;
  }
  const list = await one(
    `select count(*)::int as all,
            count(*) filter (where status = 'live' and not hidden_by_reports)::int as live,
            count(*) filter (where status = 'paused' and not hidden_by_reports)::int as paused
       from assets where channel_id = $1 and status <> 'removed'`, [alice.id]);
  say('alice file list', `${list.all} files (${list.live} live, ${list.paused} paused${made ? `, ${made} added just now` : ''})`);
}

// ── 4. The buyer's side of the same shop ─────────────────────────────────────
// The library page had nothing to show, which is a page nobody can review: the
// demo needed a person who has unlocked things and watches stores. Alice is that
// person (a seller is a buyer too), and the four states below are the four the
// shelf can render — so every branch of the page is visible in the preview
// rather than only in a test:
//
//   * an ad unlock with its window still open;
//   * a free file, which has no window at all;
//   * a window that has closed (the same row, two days later);
//   * a file the store paused after it was unlocked — an unlock does not make a
//     file immune to its own seller, and the shelf says so instead of hiding it;
//   * and a review, because reviews hang off unlocks and the page can say which
//     of a person's unlocks they have already spoken about.
//
// Everything is written through the store's own calls, and the two date fields a
// person cannot type — `expires_at` in the past, `seen_at` before the store's
// files were published — are moved the way time would have moved them.
if (alice) {
  const aliceOwnerRow = await one('select owner_id from channels where id = $1', [alice.id]);
  const aliceUser = aliceOwnerRow?.owner_id;
  const bob = await one(`select id, slug, name from channels where slug = 'bob'`);
  const nima = await one(`select id, slug, name from channels where slug = 'nima-crafts'`);

  if (aliceUser && bob) {
    const pick = async (slug) =>
      one('select id, title, slug, unlock_mode from assets where channel_id = $1 and slug = $2', [bob.id, slug]);

    // 1. A file bob decided to give away, and 2. one with a 24-hour window.
    const freeOne = await pick('studio-print-16');
    if (freeOne) {
      await store.updateAsset(freeOne.id, { unlock_mode: 'open' });
      await store.grantUnlock({
        assetId: freeOne.id, channelId: bob.id, userId: aliceUser, method: 'open',
        adsCompleted: 0, policy: { unlock_hours: 0 },
      });
    }
    const streetSet = await pick('kathmandu-street-set');
    if (streetSet) {
      await store.grantUnlock({ assetId: streetSet.id, channelId: bob.id, userId: aliceUser, policy: { unlock_hours: 24 } });
    }

    // 3. A window that has closed, and the review that came out of it.
    const closedOne = await pick('studio-print-01');
    if (closedOne) {
      const unlock = await store.grantUnlock({
        assetId: closedOne.id, channelId: bob.id, userId: aliceUser, policy: { unlock_hours: 24 },
      });
      await many(`update unlocks set expires_at = now() - interval '2 days' where id = $1`, [unlock.id]);
      const review = await one('select id from reviews where unlock_id = $1', [unlock.id]);
      if (!review) {
        await store.addReview({
          unlockId: unlock.id, assetId: closedOne.id, channelId: bob.id, buyerId: aliceUser, rating: 4,
          body: 'Sharp and clean at print size. I wanted the originals too, and those are a separate pack.',
        });
      }
    }

    // 4. Unlocked yesterday, paused by its own seller since.
    const downOne = await pick('studio-print-02');
    if (downOne) {
      await store.grantUnlock({ assetId: downOne.id, channelId: bob.id, userId: aliceUser, policy: { unlock_hours: 24 } });
      await store.updateAsset(downOne.id, { status: 'paused' });
    }

    // The two stores this person watches. Bob published everything he has since
    // Alice last looked; Nima's only file is new too, but it is still waiting for
    // its first review, so the count stays at zero — a file nobody can find is not
    // news, and that is the rule the demo should be able to show.
    if (nima) await store.followChannel(aliceUser, nima.id);
    await store.followChannel(aliceUser, bob.id);
    await many(`update follows set seen_at = now() - interval '9 days' where profile_id = $1`, [aliceUser]);
    if (nima) {
      await many(`update follows set seen_at = now() - interval '2 days' where profile_id = $1 and channel_id = $2`,
        [aliceUser, nima.id]);
    }

    const counts = await store.unlockCounts(aliceUser);
    const shelf = await store.followedChannels(aliceUser);
    say('alice library', `${counts.all} unlocked (${counts.open} open now), `
      + shelf.map((s) => `${s.slug}: ${s.new_count} new`).join(', '));
  }
}

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
// Resolved here rather than reused from the sections above: the demo script's
// own `nimaStore` is declared AFTER this point (section 5 needs it for the
// document), and a block that reads a `const` before its declaration throws
// rather than quietly doing the wrong thing — which is how this was caught.
const memberStore = await one(`select id, slug, name from channels where slug = 'nima-crafts'`);
if (memberStore) {
  const nimaOwner = (await one('select owner_id from channels where id = $1', [memberStore.id]))?.owner_id;
  const aliceProfile = await one(`select owner_id from channels where slug = 'alice'`);
  const bobProfile = await one(`select owner_id from channels where slug = 'bob'`);

  // The tiers. Two, named the way a small Nepali studio would name them, and the
  // dues are what the CREATOR asks — the platform is not in this number.
  const TIERS = [
    {
      tierNo: 1, name: 'Friend', duesNpr: 150, periodMonths: 1, accent: 'teal', glyph: null,
      perks: 'Every new template a week early, and the notes behind it',
    },
    {
      // The top tier wears a shape — a peak, which is the one silhouette in the
      // vocabulary that could only belong to a shop in this country — and the entry
      // tier wears none, so the demo shows both states of the picker at once.
      tierNo: 2, name: 'Elite', duesNpr: 600, periodMonths: 3, accent: 'violet', glyph: 'peak',
      perks: 'Everything above, plus the workshop recordings and a file a month only elites open',
    },
  ];
  for (const t of TIERS) {
    await store.saveMembershipTier({
      channelId: memberStore.id, tierNo: t.tierNo, actorId: nimaOwner,
      value: {
        name: t.name, duesNpr: t.duesNpr, periodMonths: t.periodMonths,
        perks: t.perks, accent: t.accent, glyph: t.glyph,
      },
    });
  }
  const note = 'eSewa 9800000009 (Nima Crafts). Put your username in the remark so I can find you — '
    + 'I check the statement every evening.';
  const hadNote = (await one('select membership_note from channels where id = $1', [memberStore.id]))?.membership_note;
  if (hadNote !== note) {
    await store.setMembershipNote({ channelId: memberStore.id, note, actorId: nimaOwner });
  }

  // A theme, because a storefront that has been dressed is the only way to see
  // whether the band is subtle or loud — and `everest` is one of the two that
  // drifts, which is the motion that has to be checked against real text.
  const themed = await store.setChannelTheme({
    channel: await store.channelById(memberStore.id), theme: 'everest', actorId: nimaOwner,
  });
  if (!themed.ok) say('store theme', `refused: ${themed.reason}`);

  // The file only elites open. Created through the store, approved the way an
  // operator approves one (there is no other honest way to make a file public),
  // with a cover and real bytes so the locked card is a picture rather than a
  // placeholder — a shop window with a hole in it demonstrates nothing.
  let eliteFile = await one(
    'select id, status, moderation_state from assets where channel_id = $1 and slug = $2',
    [memberStore.id, 'bhaktapur-workshop-recordings'],
  );
  if (!eliteFile) {
    eliteFile = await store.createAsset({
      channelId: memberStore.id,
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
        assetId: eliteFile.id, action: 'approve', state: 'approved', actorId: OPERATOR.id,
        remedy: 'Demo seed: approved so the members-only card is visible on the storefront.',
      });
    }
    await many(`update assets set member_tier = 2, unlock_mode = 'members', status = 'live' where id = $1`, [eliteFile.id]);
  }

  // ── the two memberships, and the restore ──────────────────────────────────
  const seeded = new Set([aliceProfile?.owner_id, bobProfile?.owner_id].filter(Boolean));
  const stray = await many(
    `select profile_id from memberships where channel_id = $1 and not (profile_id = any($2::uuid[]))`,
    [memberStore.id, [...seeded]],
  );
  for (const row of stray) {
    await store.leaveMembership(row.profile_id, memberStore.id);
  }
  if (stray.length) say('members', `reset — removed ${stray.length} row(s) a preview session left behind`);

  if (aliceProfile?.owner_id && nimaOwner) {
    // Alice is the store that has been checked, the shelf with four states, and
    // now the member in the top tier: one account carrying every state this
    // product can show is how a preview gets read in one pass.
    await store.leaveMembership(aliceProfile.owner_id, memberStore.id);
    await store.joinMembership({
      profileId: aliceProfile.owner_id, channelId: memberStore.id, tierNo: 2,
      claim: { amountNpr: 600, method: 'esewa', txnReference: 'ESW-4517-ELITE', payerName: 'Alice', payerNumber: '9811111111' },
    });
    const confirmed = await store.confirmMembership({
      profileId: aliceProfile.owner_id, channelId: memberStore.id, ownerId: nimaOwner, actorId: nimaOwner,
    });
    // Let the membership cover the tier-2 file, so her library and the file page
    // both show access that came from dues rather than from an ad.
    await store.grantMembershipUnlock({
      assetId: eliteFile.id, channelId: memberStore.id, userId: aliceProfile.owner_id,
      expiresAt: confirmed?.period_end ?? null,
    });
    say('alice member', `Elite, confirmed by the owner, runs to ${String(confirmed?.period_end).slice(0, 10)}`);
  }

  if (bobProfile?.owner_id) {
    // Bob's claim is LEFT PENDING on purpose: it is the queue, and a queue with
    // nothing in it demonstrates nothing. His reference is the one thing the
    // seller's page needs to make the confirm button meaningful.
    await store.leaveMembership(bobProfile.owner_id, memberStore.id);
    await store.joinMembership({
      profileId: bobProfile.owner_id, channelId: memberStore.id, tierNo: 1,
      claim: { amountNpr: 150, method: 'esewa', txnReference: 'ESW-8823-DEMO', payerName: 'Bob', payerNumber: '9822222222' },
    });
    say('bob claim', 'Friend tier, waiting for the creator to find ESW-8823-DEMO in the statement');
  }
}

// ── 4b-bis. The attention door (§33): a store where watching is a way in ─────
//
// Nima's store is the one that sells belonging with dues, and its two files are
// deliberately still waiting for their first review — that is the operator's queue.
// A file nobody can see cannot be watched, so the second door is demonstrated on
// ALICE's store instead: it has a shop window full of live files, each of them one
// short view away, and a plan that includes memberships.
//
// The state this section is responsible for:
//
//   * two tiers on one storefront, so the two doors are visible side by side and a
//     person can compare them without reading a manual;
//   * a live members-only file, approved the way an operator approves one, so the
//     locked card and the member room have something real behind them;
//   * and a standing count of ZERO for the two people the walk uses, because a
//     counter that only ever grows turns its own verification into a demo of the
//     number it happens to be showing.
const doorStore = await one(`select id, slug, name, owner_id from channels where slug = 'alice'`);
if (doorStore) {
  // Doors read off `doorsOf`: tier 1 offers both ways in, tier 2 is dues only. Both
  // promise a member file with no ad — that is the shipped promise, and the seller's
  // opt-in `supporter` arrangement is demonstrated by the walk flipping the picker
  // rather than by seeding a storefront that contradicts it.
  const DOORS = [
    { tierNo: 1, name: 'Friend', duesNpr: 150, periodMonths: 1, accent: 'teal', joinMode: 'both', adMode: 'ad_free',
      perks: 'The source files behind every poster, and a note on what changed' },
    { tierNo: 2, name: 'Elite', duesNpr: 600, periodMonths: 3, accent: 'violet', joinMode: 'dues', adMode: 'ad_free',
      perks: 'Everything above, plus the client work I cannot post publicly' },
  ];
  for (const t of DOORS) {
    await store.saveMembershipTier({
      channelId: doorStore.id, tierNo: t.tierNo, actorId: doorStore.owner_id,
      value: {
        name: t.name, duesNpr: t.duesNpr, periodMonths: t.periodMonths,
        perks: t.perks, accent: t.accent, joinMode: t.joinMode, adMode: t.adMode,
      },
    });
  }

  // Where the dues go, in the creator's own words — the same instruction a real
  // seller writes, because a storefront whose join panel says "this store has not
  // said where to send the dues yet" cannot demonstrate the dues door at all.
  const doorNote = 'eSewa 9801111111 (Alice\'s Studio). Put your username in the remark so I can match it — '
    + 'I check the statement every evening and confirm it the same day.';
  if ((await one('select membership_note from channels where id = $1', [doorStore.id]))?.membership_note !== doorNote) {
    await store.setMembershipNote({ channelId: doorStore.id, note: doorNote, actorId: doorStore.owner_id });
  }

  let doorFile = await one(
    'select id, status, moderation_state from assets where channel_id = $1 and slug = $2',
    [doorStore.id, 'studio-source-files'],
  );
  if (!doorFile) {
    doorFile = await store.createAsset({
      channelId: doorStore.id,
      title: 'Studio source files',
      slug: 'studio-source-files',
      description: 'The layered files behind the last three poster sets. Members open them with no ad — '
        + 'or watch a few things instead of paying.',
      unlockMode: 'members',
    });
    const body = Buffer.from('ByteBikri demo file (Alice\'s Studio, members).\n');
    await store.addFile({
      assetId: doorFile.id, storageKey: await storage.put(body, 'studio-source-files.txt'),
      filename: 'studio-source-files.txt', mimeType: 'text/plain', sizeBytes: body.length,
      checksum: createHash('sha256').update(body).digest('hex'),
    });
    const cover = await fs.readFile(new URL('../app/public/img/demo/sample-pack.jpg', import.meta.url));
    await store.updateAsset(doorFile.id, {
      cover_url: `/media/${await storage.put(cover, 'studio-source-files-cover.jpg', { namespace: 'public' })}`,
    });
    say('members file', `created — ${doorFile.moderation_state}`);
  }
  if (OPERATOR) {
    if (doorFile.moderation_state !== 'approved') {
      await store.setAssetModeration({
        assetId: doorFile.id, action: 'approve', state: 'approved', actorId: OPERATOR.id,
        remedy: 'Demo seed: approved so the members-only card is visible on the storefront.',
      });
    }
    await many(`update assets set member_tier = 1, unlock_mode = 'members', status = 'live' where id = $1`, [doorFile.id]);
  }

  // Alice's own theme. She pays for the Store plan, so the plan's own product — a
  // themed band with the aurora on it — is part of what the preview is supposed to
  // show. Everest is the palette whose note reads as "the hour before sunrise", and
  // it is one of the ones that MOVES, which is the half a card cannot demonstrate.
  const themeWant = 'everest';
  if (doorStore.theme !== themeWant) {
    const themed = await store.setChannelTheme({
      channel: await store.channelById(doorStore.id),
      capabilities: store.plan(await store.channelById(doorStore.id)).capabilities,
      theme: themeWant, actorId: doorStore.owner_id,
    });
    say('store theme', themed.ok ? `set — ${themeWant} (moves, and stops for reduced motion)` : `refused: ${themed.reason}`);
  }

  // The restore. Bob and Carol are the two people the walk takes through the
  // watching door: their memberships on this store are removed and their standing is
  // zeroed, so a second run starts at the same sentence as the first and the count
  // the walk reads is one it produced.
  const walkers = await many(
    `select id, email from profiles where email in ('bob@bytebikri.local', 'carol@bytebikri.local')`,
  );
  for (const who of walkers) {
    await store.leaveMembership(who.id, doorStore.id);
    await many('delete from member_standing where profile_id = $1 and channel_id = $2', [who.id, doorStore.id]);
  }
  const strayHere = await many(
    `select profile_id from memberships where channel_id = $1 and not (profile_id = any($2::uuid[]))`,
    [doorStore.id, walkers.map((w) => w.id)],
  );
  for (const row of strayHere) await store.leaveMembership(row.profile_id, doorStore.id);
  if (strayHere.length) say('watching door', `reset — removed ${strayHere.length} membership(s) a preview session left behind`);
  say('watching door', `Alice's tiers: Friend (dues or watching) and Elite (dues) · `
    + `${walkers.length} walker(s) back to zero standing · members file live`);
}

// ── 4c-before. The addresses the money needs, confirmed the way a person ─────
//             confirms them ──────────────────────────────────────────────────
//
// This block exists because a browser pass found the preview unable to demonstrate
// its own money flows. Every demo account was created unconfirmed, and every route
// that takes money in refuses an unconfirmed address — POST /plus/join, the plan
// payment, the rent payment. So a person clicking through the preview as Alice or
// Carol could not submit a claim or an upgrade at all; they got the "confirm your
// email first" refusal, which is correct behaviour on a state the seeder had left
// behind. The seeder could still CREATE those states, because it calls the store
// methods the routes call rather than the routes — which is exactly how a demo ends
// up showing the result of a purchase nobody following it could make.
//
// Two steps, both of them the product's own: `tokens.issue` mints the link the mail
// would have carried, and `verify.confirm` spends it — the same function the
// /verify/:token route calls. Only the DELIVERY is skipped, because a seeder has no
// mailbox and does not need one: the demo sign-ins are printed on screen.
//
// Reversible and idempotent: an address already confirmed is left alone, and the
// first confirmation's timestamp is preserved (`confirm` uses coalesce for the same
// reason — the first confirmation is the consent evidence).
{
  const tokens = await import('../app/src/tokens.js');
  const verify = await import('../app/src/verify.js');
  const people = ['alice', 'bob', 'nima', 'carol'].map((n) => `${n}@bytebikri.local`);
  const rows = await many('select id, email, email_verified_at from profiles where email = any($1::text[])', [people]);
  let confirmed = 0;
  for (const person of rows) {
    if (person.email_verified_at) continue;
    const { token } = await tokens.issue({ userId: person.id, kind: 'email_verify' });
    const done = await verify.confirm({ token });
    if (!done.ok) throw new Error(`demo-state: could not confirm ${person.email}`);
    confirmed += 1;
  }
  say('addresses', confirmed
    ? `confirmed ${confirmed} demo address(es) — the money routes refuse an unconfirmed one`
    : 'already confirmed');
}

// ── 4c. ByteBikri Plus (§32): the person's own premium, in both its states ───
//
// The same shape as the memberships block above, and for the same reason: the
// operator queue only means something when there is a claim in it, and the look
// only means something when somebody is actually wearing one. So one person has an
// arrangement that is RUNNING (matched against the platform's own statement, wearing
// a palette and an effect wherever the platform shows their name to somebody else),
// and one has a claim WAITING — the queue, with the reference the operator needs.
//
// `cancelPlus` on everybody else is the restore: a subscription that a previous
// session left active stops being worn, because the entitlement is the join and a
// cancelled row is not an active one. Cosmetic choices are left alone — a palette is
// a preference, and the demo should not spend a person's look to tidy a database.
//
// Alice: PLUS-RUNNING-4517, confirmed. Carol: PLUS-WAITING-8823, submitted, so
// /admin/payments has something in its Plus section on a fresh clone.
{
  const alicePerson = await one(`select owner_id from channels where slug = 'alice'`);
  const carolPerson = await one(`select id from profiles where email = 'carol@bytebikri.local'`);
  const operator = await one(`select id from profiles where role = 'admin' order by created_at limit 1`);
  const plan = await store.customerPlan('plus');

  if (plan && alicePerson?.owner_id) {
    const keep = new Set([alicePerson.owner_id, carolPerson?.id].filter(Boolean));
    // Only rows that are actually being WORN right now: a subscription that is already
    // cancelled is not "stopped" by stopping it again, and reporting it as such made
    // the second run of this script print a reset that had not happened.
    const wrong = await many(
      `select profile_id from customer_subscriptions
        where status in ('active','pending_payment')
          and not (profile_id = any($1::uuid[]))`,
      [[...keep]],
    );
    for (const row of wrong) await store.cancelPlus(row.profile_id);
    if (wrong.length) say('plus', `reset — stopped ${wrong.length} arrangement(s) a preview left running`);

    // The two references belong to THIS script, so a second run clears its own first
    // run's rows before re-claiming. Without this the unique index on the reference
    // does exactly what it is for — refuses the duplicate — and the seeder would leave
    // the demo with a cancelled arrangement while printing that it was running. (It
    // did, for one run. The line below is why it cannot again.)
    const MINE = ['PLUS-RUNNING-4517', 'PLUS-WAITING-8823'];
    await query(`delete from customer_plan_payments where txn_reference = any($1::text[])`, [MINE]);

    // Any other claim still waiting in the queue was left there by somebody clicking
    // through the preview, and a queue with three claims in it demonstrates the same
    // thing as a queue with one — worse, in fact, because the operator's page is meant
    // to show a person what THEIR action does. Decided, not deleted: a rejection is a
    // real outcome with a reason on it, and it is what an operator would have pressed.
    const strays = await many(
      `select id from customer_plan_payments where status = 'submitted' and txn_reference <> all($1::text[])`,
      [MINE],
    );
    for (const row of strays) {
      if (operator?.id) {
        await store.rejectCustomerPlanPayment({
          paymentId: row.id, actorId: operator.id,
          reason: 'Demo reset: not one of the seeded claims.',
        });
      }
    }
    if (strays.length) say('plus queue', `reset — decided ${strays.length} claim(s) a preview left waiting`);

    // Alice's arrangement: a real claim, and a real match by the operator account —
    // the same two steps a person and an operator actually take.
    await store.cancelPlus(alicePerson.owner_id);
    const claim = await store.claimPlus({
      profileId: alicePerson.owner_id, planCode: 'plus', amountNpr: plan.price_npr,
      txnReference: MINE[0], method: 'esewa', payerName: 'Alice',
    });
    if (!claim.ok) throw new Error(`demo-state: Alice's Plus claim was refused (${claim.code})`);
    if (operator?.id) await store.matchCustomerPlanPayment({ paymentId: claim.payment.id, actorId: operator.id });
    // A look she chose: a palette from the eight the product has and the one effect
    // that moves, so the preview exercises both halves of the product on a roster and
    // on a review. (The
    // first cut of this line used a name that is not a key at all; `plusWear()` fell
    // back to the default silently and the page said "Halo in Indigo" over a look the
    // seeder believed it had set. The store method takes what it is given — the route
    // is what validates — so a seeder has to name a real one.)
    await store.setPlusLook({ profileId: alicePerson.owner_id, nameplate: 'teal', effect: 'halo' });
    // Reported from the row, not from the intention: a seeder that says "running" over
    // a cancelled subscription is worse than one that says nothing.
    const running = await store.customerSubscription(alicePerson.owner_id);
    say('alice plus', running?.status === 'active'
      ? `running to ${String(running.period_end).slice(0, 10)} — teal, halo`
      : `NOT RUNNING (${running?.status}) — the operator account is missing?`);

    if (carolPerson?.id) {
      await store.cancelPlus(carolPerson.id);
      const waiting = await store.claimPlus({
        profileId: carolPerson.id, planCode: 'plus', amountNpr: plan.price_npr,
        txnReference: MINE[1], method: 'khalti', payerName: 'Carol',
      });
      if (!waiting.ok) throw new Error(`demo-state: Carol's Plus claim was refused (${waiting.code})`);
      await store.setPlusLook({ profileId: carolPerson.id, nameplate: 'rose', effect: 'edge' });
      const held = await store.customerSubscription(carolPerson.id);
      say('carol plus', held?.status === 'pending_payment'
        ? 'claim PLUS-WAITING-8823 waiting in the operator queue'
        : `NOT WAITING (${held?.status})`);
    }
  }
}

// ── 4d. When an ad does not arrive (§32): the count a seller can see ─────────
//
// The ladder's whole premise is that the platform counts attempts it could not
// confirm and says only that. The preview should show the middle rung, where the
// explanation is on the page and the unlock is STILL OFFERED — the state a person
// whose connection dropped meets, and the one that makes "we do not guess why" a
// claim about the product rather than about the copy. Three attempts is the rung
// (`rungFor(3)`), and the rows are Bob's so that signing in as him shows it live.
{
  const kit = await one(`select a.id, a.channel_id from assets a where a.slug = 'devanagari-poster-kit'`);
  const bobPerson = await one(`select id from profiles where email = 'bob@bytebikri.local'`);
  if (kit && bobPerson?.id) {
    // The count is what the seller's page prints, so the seed owns all of it: rows
    // from an earlier visit would otherwise pile on top of these three.
    const cleared = await query('delete from ad_block_signals where asset_id = $1', [kit.id]);
    for (let i = 0; i < 3; i++) {
      await store.recordBlockSignal({
        assetId: kit.id, channelId: kit.channel_id, userId: bobPerson.id, signal: 'no_postback',
      });
    }
    const count = await store.blockSignalCount({ assetId: kit.id, userId: bobPerson.id });
    say('ad signals', `${count} unconfirmed attempt(s) on devanagari-poster-kit`
      + (cleared.rowCount ? ` (cleared ${cleared.rowCount} older)` : ''));
  }
}


// Nima is the store waiting on a check by design (§26), so she is also the store
// that has handed a document over: it makes the two halves of the promise visible
// in the preview at once — her settings page says a copy is with us and what will
// happen to it, and the console's page for her store says a person can open it, that
// the open will be written down, and that a decision destroys it.
//
// The file is SYNTHETIC, built here from zlib and a CRC table, and it looks like
// what it is: a grey rectangle with bars on it, not a photograph of anybody's
// citizenship certificate. A demo database holding a realistic ID would be a worse
// thing to ship than a demo database holding an obvious placeholder — and this one
// goes through `stripMetadata` on the way in, exactly like an upload does, so the
// write path the tests cover is the write path the preview uses.
const nimaStore = nima || await one(`select id, slug, name from channels where slug = 'nima-crafts'`);
if (nimaStore) {
  const { storage } = await import('../app/src/store.js');
  const { stripMetadata, sniff } = await import('../app/src/kyc.js');
  const zlibMod = await import('node:zlib');
  const open = await store.pendingVerificationFor(nimaStore.id);
  const ownerRow = await one('select owner_id from channels where id = $1', [nimaStore.id]);
  if (open && ownerRow && !open.document_key && !open.document_destroyed_at) {
    const placeholder = documentPlaceholder(zlibMod);
    const cleaned = stripMetadata(placeholder, sniff(placeholder) || 'image/png');
    const key = await storage.put(cleaned, 'document.png', { namespace: 'kyc' });
    const attached = await store.attachVerificationDocument({
      channelId: nimaStore.id, key, mime: 'image/png', bytes: cleaned.length, actorId: ownerRow.owner_id,
    });
    say('nima document', attached.ok
      ? `held for review (${cleaned.length} bytes, built here — no real document is in this database)`
      : 'could not be attached');
  } else if (open?.document_key) {
    say('nima document', 'already held for review');
  }
}

/**
 * An 84×56 greyscale PNG with a few bars on it, written by hand.
 *
 * Hand-written because the alternative is a dependency (`sharp`, `pngjs`) or an
 * image copied into the repository, and neither belongs in a seeder. The chunk
 * structure is the whole format: signature, IHDR, IDAT (zlib), IEND, each with its
 * CRC. It is a placeholder that a person can recognise as a placeholder.
 */
function documentPlaceholder(zlib) {
  const w = 84;
  const h = 56;
  const rows = [];
  for (let y = 0; y < h; y += 1) {
    const row = Buffer.alloc(1 + w);          // filter byte 0, then greyscale pixels
    for (let x = 0; x < w; x += 1) {
      const margin = x < 6 || x > w - 7 || y < 5 || y > h - 6;
      const bar = ![12, 20, 28, 36, 44].includes(y) ? 255 : (x > 10 && x < 62 ? 90 : 200);
      row[1 + x] = margin ? 30 : bar;
    }
    rows.push(row);
  }
  const chunk = (type, data) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, 'latin1');
    const body = Buffer.concat([head, data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(body) >>> 0, 0);
    return Buffer.concat([body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;      // bit depth
  ihdr[9] = 0;      // colour type: greyscale
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ── What the database now holds ──────────────────────────────────────────────
const rules = await many(`select r.country_code, r.state, r.source, a.title
                            from asset_country_rules r join assets a on a.id = r.asset_id`);
const waitingNow = await many(`select a.title, a.moderation_state, c.name
                                 from assets a join channels c on c.id = a.channel_id
                                where a.moderation_state = 'pending'`);
console.log('\n  country rules:',
  rules.map((r) => `${r.title} ${r.country_code} ${r.state} (${r.source})`).join(', ') || 'none');
console.log('  waiting files:',
  waitingNow.map((w) => `${w.title} at ${w.name}`).join(', ') || 'none');
const checks = await many(`select c.name, v.status, v.method, v.expires_at, v.notice_sent_at,
                                  v.docs_retained, v.document_destroyed_at
                              from seller_verifications v
                              join channels c on c.id = v.channel_id order by v.created_at`);
const { lapseOf } = await import('../app/src/verification.js');
console.log('  identity:',
  checks.map((c) => {
    const l = lapseOf(c);
    const when = l ? ` — ${l.label}` : '';
    const doc = c.docs_retained ? ' · a copy is held for review'
      : c.document_destroyed_at ? ' · the copy handed over was destroyed' : '';
    return `${c.name} ${c.status}${c.method && c.status !== 'pending' ? ` (${c.method})` : ''}${when}${doc}${l && l.level !== 'current' && !c.notice_sent_at && l.level !== 'lapsed' ? ' (nobody told yet)' : ''}`;
  }).join(', ') || 'none');
// `claimed_at`, not `created_at`: the table records when a claim was made and when a
// period started, and has no row-creation timestamp of its own.
const plusNow = await many(`select p.display_name, cs.status, cs.period_end
                               from customer_subscriptions cs join profiles p on p.id = cs.profile_id
                              order by cs.claimed_at`);
const plusQueue = await scalar(`select count(*)::int from customer_plan_payments where status = 'submitted'`);
console.log('  plus:',
  plusNow.filter((r) => r.status !== 'cancelled')
    .map((r) => `${r.display_name} ${r.status === 'active' ? `wearing a look to ${String(r.period_end).slice(0, 10)}` : r.status}`)
    .join(', ') || 'nothing running',
  `· ${plusQueue} claim(s) waiting on the operator`);
console.log('\n  open the preview at /  ·  the creator’s view at /dashboard/alice'
  + '  ·  the queue at /admin  ·  the person’s premium at /plus\n');

await close();
