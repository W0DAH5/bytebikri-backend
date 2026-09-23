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
const { many, one, close } = await import('../app/src/db.js');
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
if (nima && OPERATOR && !(await one(
  `select id from seller_verifications where channel_id = $1 and status in ('verified','rejected')`, [nima.id]))) {
  const seen = new Date();
  seen.setMonth(seen.getMonth() - 23);
  await store.recordVerification({
    channelId: nima.id, outcome: 'verified', method: 'citizenship', actorId: OPERATOR.id,
    months: 24, seenAt: seen, note: 'Seen in person at the shop; name matched the account.',
  });
  say('nima checked', `citizenship, seen ${Math.round((Date.now() - seen.getTime()) / 86400000 / 30)} months ago`);
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
  if (!open) {
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
const checks = await many(`select c.name, v.status, v.method, v.expires_at, v.notice_sent_at
                              from seller_verifications v
                              join channels c on c.id = v.channel_id order by v.created_at`);
const { lapseOf } = await import('../app/src/verification.js');
console.log('  identity:',
  checks.map((c) => {
    const l = lapseOf(c);
    const when = l ? ` — ${l.label}` : '';
    return `${c.name} ${c.status}${c.method && c.status !== 'pending' ? ` (${c.method})` : ''}${when}${l && l.level !== 'current' && !c.notice_sent_at && l.level !== 'lapsed' ? ' (nobody told yet)' : ''}`;
  }).join(', ') || 'none');
console.log('\n  open the preview at /  ·  the creator’s view at /dashboard/alice'
  + '  ·  the queue at /admin\n');

await close();
