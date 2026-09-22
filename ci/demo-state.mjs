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
 *   3. ONE CHECKED SELLER AND ONE WHO HAS ASKED: Alice's identity was looked at
 *      (the badge is live on her storefront, and the whole record — who decided,
 *      on what document, until when — is on her operator page), and Nima has an
 *      open request sitting in the operator's identity queue. Asking for a check
 *      needs a plan that includes it, so the seeder takes Nima through the same
 *      three calls the real upgrade path uses rather than writing a row a person
 *      could not have produced.
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
const checks = await many(`select c.name, v.status, v.method from seller_verifications v
                             join channels c on c.id = v.channel_id order by v.created_at`);
console.log('  identity checks:',
  checks.map((c) => `${c.name} ${c.status}${c.method && c.status !== 'pending' ? ` (${c.method})` : ''}`).join(', ') || 'none');
console.log('\n  open the preview at /  ·  the creator’s view at /dashboard/alice'
  + '  ·  the queue at /admin\n');

await close();
