/**
 * What happens when a rewarded ad does not arrive.  npm test
 *
 * The brief asked for a ladder "from requesting user to turn off to if not turned
 * off the no content shown". This file is where that ladder is pinned down, and it
 * pins down the parts that are easy to get wrong in the direction of harshness:
 *
 *   * The harsh end is ONE FILE'S UNLOCK, for a few hours, for one person. The
 *     listing, the description, the preview, every open file and the store's
 *     membership route all still work at the last rung, and the count ages out by
 *     itself. There is no account flag and nothing to clear.
 *   * Nothing is decided by detecting a browser. ~79% of ad blocking is
 *     undetectable (Ad-Shield, 2026), reader mode defeats every check, and NYU's
 *     2025 measurement is that allowlisted "acceptable ads" users met 13.6% MORE
 *     intrusive ads — so a wall built on a guess lands on the people who were
 *     compromising. The ladder climbs on a count of views that never confirmed.
 *   * Declining is not blocking. A person who closes the ad has not evaded
 *     anything, and `declined` does not climb anything.
 *   * The client cannot grant, and cannot hide. The withheld state is rendered by
 *     the server from a count; the client may only report a signal.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:55432/bytebikri_test';

const { store } = await import('../src/store.js');
const { close, query } = await import('../src/db.js');
const { LADDER, NEVER_DO, SIGNALS, BLOCKING_SIGNALS, SIGNAL_WINDOW_HOURS, rungFor, signalFrom, blockedSellerNote } = await import('../src/blocked.js');
const views = await import('../src/views.js');

after(async () => { await close(); });

let seq = 0;
async function fixture() {
  const tag = `${Date.now()}-${++seq}`;
  const owner = await store.userByEmailOrCreate(`blk-owner-${tag}@test.local`);
  const channel = await store.createChannel({ ownerId: owner.id, slug: `blk-${tag}`, name: `Blk ${tag}` });
  const person = await store.userByEmailOrCreate(`blk-person-${tag}@test.local`);
  const asset = await store.createAsset({ channelId: channel.id, title: `Gated ${tag}`, slug: `gated-${tag}` });
  await store.setUnlockPolicy(asset.id, { unlock_hours: 24 });
  return { owner, channel: await store.channelById(channel.id), person, asset, tag };
}

// ---------------------------------------------------------------------------
// The ladder's shape
// ---------------------------------------------------------------------------

test('the ladder is ordered, and only its last rung withholds anything', () => {
  assert.ok(LADDER.length >= 3);
  let previous = -1;
  for (const rung of LADDER) {
    assert.ok(rung.from > previous, `${rung.key} is out of order`);
    previous = rung.from;
    // Every rung either explains itself or is the silent first one.
    if (rung.from > 0) {
      assert.ok(rung.headline && rung.body, `${rung.key} says nothing`);
      assert.ok(rung.body.length > 80, `${rung.key} is too short to be an explanation`);
    }
  }
  const refusing = LADDER.filter((r) => !r.offersUnlock);
  assert.equal(refusing.length, 1, 'exactly one rung withholds, so the escalation has one visible edge');
  assert.equal(refusing[0].key, LADDER[LADDER.length - 1].key, 'and it is the last one');
  // The first rung offers everything: silence is the default state of the product.
  assert.equal(LADDER[0].offersUnlock, true);
  assert.equal(LADDER[0].headline, null, 'a person who has done nothing is told nothing');
});

test('the rung is a step function of a count, and an unknown count is the gentle end', () => {
  assert.equal(rungFor(0).key, 'quiet');
  assert.equal(rungFor(1).key, 'notice');
  assert.equal(rungFor(Number.NaN).key, 'quiet');
  assert.equal(rungFor(-5).key, 'quiet');
  assert.equal(rungFor(10_000).offersUnlock, false, 'a very large count is still the last rung, not an error');
  // Monotone in harshness: the rung never gets friendlier as attempts rise.
  let last = 0;
  for (let n = 0; n <= 20; n++) {
    const rung = LADDER.indexOf(rungFor(n));
    assert.ok(rung >= last, `attempt ${n} was friendlier than attempt ${n - 1}`);
    last = rung;
  }
});

test('the copy blames the view, never the visitor, and never names a browser', () => {
  const text = LADDER.map((r) => `${r.headline || ''} ${r.body || ''}`).join(' ');
  // No product or browser names in anything a visitor reads. The trade-off is
  // explained as a consequence, not as an accusation.
  assert.doesNotMatch(text, /brave|chrome|firefox|safari|edge\b|ublock|adblock plus|adblocker.?plus|ghostery/i);
  assert.doesNotMatch(text, /your ad blocker|you are blocking|disable your|turn off your/i);
  assert.match(text, /ad blocker/, 'the possibility is named at all, because saying nothing helps nobody');
  // And the last rung says out loud what still works, which is the sentence that
  // turns a wall into a wait.
  const last = LADDER[LADDER.length - 1];
  assert.match(last.body, /listed|still opens|membership|resets/i);

  // The middle rung may name membership as a way forward, but not as a way through
  // THIS door. Its first cut said a membership "opens its files with no ad at all",
  // which on an ad-gated file is the same half-truth the last rung was corrected for:
  // membership opens the store's member-only files, never the ad on the file you are
  // looking at. A person who paid dues expecting this file to open would have been
  // told by the product itself that it would.
  const explained = LADDER.find((r) => r.key === 'explained');
  assert.match(explained.body, /members only/, 'membership is described by what it does open');
  assert.match(explained.body, /does not open this ad-gated file sooner/, 'and by what it does not');
});

test('what the platform refuses to do is written down with its reasons', () => {
  assert.ok(NEVER_DO.length >= 4);
  const text = NEVER_DO.join(' ');
  assert.match(text, /interstitial/i, 'the full-page wall is refused by name');
  assert.match(text, /user-agent|Brave/i, 'and so is browser targeting');
  assert.match(text, /account/i, 'and so is any mark on a person');
  for (const line of NEVER_DO) assert.ok(line.length > 60, `"${line}" is a slogan, not a position`);
});

test('a signal is normalised, and only three of them are blocking signals', () => {
  for (const s of SIGNALS) assert.equal(signalFrom(s), s);
  assert.equal(signalFrom('whatever'), 'unknown');
  assert.equal(signalFrom(null), 'unknown');
  assert.ok(BLOCKING_SIGNALS.includes('script_blocked'));
  assert.ok(BLOCKING_SIGNALS.includes('no_postback'));
  assert.ok(!BLOCKING_SIGNALS.includes('declined'), 'choosing not to watch is not evading');
});

// ---------------------------------------------------------------------------
// The count, against a real database
// ---------------------------------------------------------------------------

test('recording a signal is what moves the rung, and it ages out on its own', async () => {
  const { person, asset, channel } = await fixture();
  assert.equal(await store.blockSignalCount({ assetId: asset.id, userId: person.id, hours: SIGNAL_WINDOW_HOURS }), 0);

  for (let i = 0; i < 6; i++) {
    await store.recordBlockSignal({
      assetId: asset.id, channelId: channel.id, userId: person.id, signal: 'no_postback',
    });
  }
  const count = await store.blockSignalCount({ assetId: asset.id, userId: person.id, hours: SIGNAL_WINDOW_HOURS });
  assert.equal(count, 6);
  assert.equal(rungFor(count).offersUnlock, false);

  // The seller's own number is the same rows, read per store.
  assert.equal(await store.blockSignalCountOfChannel(channel.id, { hours: SIGNAL_WINDOW_HOURS }), 6);
  assert.match(blockedSellerNote(6, SIGNAL_WINDOW_HOURS), /6 unlock attempts/);
  assert.match(blockedSellerNote(0, SIGNAL_WINDOW_HOURS), /No unlock attempt/);

  // Age is the only thing that has to pass. No job, no operator, no appeal.
  await query(`update ad_block_signals set created_at = now() - interval '7 days' where user_id = $1`, [person.id]);
  assert.equal(await store.blockSignalCount({ assetId: asset.id, userId: person.id, hours: SIGNAL_WINDOW_HOURS }), 0);
  assert.equal(rungFor(0).offersUnlock, true, 'the ladder fails open');
});

test('declining does not climb the ladder, whoever does it and however often', async () => {
  const { person, asset, channel } = await fixture();
  for (let i = 0; i < 8; i++) {
    await store.recordBlockSignal({ assetId: asset.id, channelId: channel.id, userId: person.id, signal: 'declined' });
  }
  assert.equal(
    await store.blockSignalCount({ assetId: asset.id, userId: person.id, hours: SIGNAL_WINDOW_HOURS }),
    0,
    'eight declines are eight decisions about one’s own time, not eight evasions',
  );
  const rows = await query('select signal from ad_block_signals where user_id = $1', [person.id]);
  assert.equal(rows.rows.length, 8, 'they are still recorded — the seller can see the shape of it');
});

test('one person’s signals never reach another person’s page', async () => {
  const { person, asset, channel } = await fixture();
  const other = await store.userByEmailOrCreate(`blk-other-${Date.now()}-${++seq}@test.local`);
  for (let i = 0; i < 6; i++) {
    await store.recordBlockSignal({ assetId: asset.id, channelId: channel.id, userId: person.id, signal: 'script_blocked' });
  }
  assert.equal(await store.blockSignalCount({ assetId: asset.id, userId: other.id, hours: SIGNAL_WINDOW_HOURS }), 0);
  assert.equal(rungFor(0).offersUnlock, true, 'a stranger on the same file is offered the unlock normally');
});

// ---------------------------------------------------------------------------
// What the page actually renders
// ---------------------------------------------------------------------------

const assetPageFor = (channel, asset, blockRung) => views.assetPage({
  channel, asset: { ...asset, unlock_mode: 'ad_gated', status: 'live', description: 'A kit.' },
  files: [{ filename: 'kit.zip', mime_type: 'application/zip', size_bytes: 2048 }],
  unlocked: false, user: { id: 'u1', email: 'n@test.local', display_name: 'N' },
  policy: { ads_required: 2, ad_min_seconds: 30, unlock_hours: 24, ask_level: 'standard' },
  slots: [], ask: { ads: 2, seconds: 30, level: 'standard' }, blockRung,
  memberTiers: [], reviews: [], reviewStats: {},
});

test('the withheld rung withholds the unlock and nothing else', () => {
  const channel = { slug: 'shop', name: 'Shop', id: 'c1' };
  const asset = { id: 'a1', slug: 'kit', title: 'Kit', channel_id: 'c1' };

  // Rung 0: the ordinary page.
  const quiet = assetPageFor(channel, asset, rungFor(0));
  assert.match(quiet, /id="unlock-btn"/);
  assert.match(quiet, /2 ads of 30 seconds|Watch 2 ads to unlock/);

  // Rung 1: the same page plus an honest note. The button is still there — a person
  // whose connection dropped must be able to try again.
  const notice = assetPageFor(channel, asset, rungFor(1));
  assert.match(notice, /id="unlock-btn"/);
  assert.match(notice, /The ad did not finish/);

  // The last rung: no button, and a full explanation instead. Two shapes, because
  // the way out depends on what the store can actually honour: the route the page
  // offers must be one the store HAS.
  const withheld = assetPageFor(channel, asset, rungFor(6));
  const withMembers = assetPageFor(channel, asset, { ...rungFor(6), hasMembers: true });
  assert.doesNotMatch(withheld, /id="unlock-btn"/, 'the unlock is not offered');
  assert.match(withheld, /not being offered for a while/i);
  // Everything else is still on the page: the file is listed, described, and the
  // route that opens it without an ad is offered rather than withheld.
  assert.match(quiet, /Kit/, 'the file is still listed by name');
  assert.match(withheld, /Kit/);
  assert.match(withheld, /A kit\./, 'its description is still there');
  // Nothing else was taken away: the pages differ by the button and the note, and by
  // nothing else. Counted, because "we only removed the button" is a claim that
  // should be checkable — the cover, the stage and the locked-file panel are all
  // still there.
  const count = (html, re) => (html.match(re) || []).length;
  for (const marker of [/locked-panel/g, /stage-locked/g, /review-list|No reviews yet/g]) {
    assert.equal(
      count(withheld, marker), count(quiet, marker),
      `the withheld page dropped something it should not have: ${marker}`,
    );
  }
  // A store WITH memberships: the route is offered, and the offer is honest about
  // what it does — membership opens the store's MEMBER files, not this ad-gated one.
  assert.match(withMembers, /#members/, 'the membership route is offered, not hidden');
  assert.match(withMembers, /no ad at all/, 'and it says why that route has no ad');
  assert.match(withMembers, /does not open an ad-gated file sooner/, 'and what it does not do');
  // A store WITHOUT them: no dead anchor, and a sentence instead of a button.
  assert.doesNotMatch(withheld, /#members/, 'no anchor into a section that does not exist');
  assert.match(withheld, /this store sells no memberships/, 'and it says so rather than pointing at nothing');
  assert.match(withheld, /pause lifts by itself/);
  // The withheld page still states the platform's ceiling, because the ceiling is
  // about the product rather than about this visitor.
  assert.match(withheld, /No file here asks for more than 3 ads/);
});

test('the withheld state is the server’s decision, and the client cannot talk its way in', () => {
  // The view renders the rung it is GIVEN. A page cannot compute its own rung —
  // there is no count in the browser — and the unlock button carries a URL for
  // reporting a signal, never a way to clear one.
  const channel = { slug: 'shop', name: 'Shop', id: 'c1' };
  const asset = { id: 'a1', slug: 'kit', title: 'Kit', channel_id: 'c1' };
  const html = assetPageFor(channel, asset, rungFor(1));
  assert.match(html, /data-signal-url="\/api\/unlock\/blocked"/);
  assert.doesNotMatch(html, /data-clear|data-reset|data-unblock/i);
  // And there is no browser check anywhere in the page or the ladder.
  assert.doesNotMatch(html, /navigator\.userAgent|brave/i);
});
