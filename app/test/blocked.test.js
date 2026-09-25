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
 *   * EVERY SURFACE THAT ASKS climbs the same ladder (§14.7). The door was the first
 *     three surfaces' worth of work done once; a cue break, a reader's seam and a live
 *     break each ask a different way, and each of them used to fail silently — no
 *     signal, no rung, and a sentence that blamed the network for ever. An in-player
 *     rung withholds the OFFER, never the file: a stream that stopped for one
 *     viewer's arithmetic would punish the store's whole audience.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:55432/bytebikri_test';

const { store } = await import('../src/store.js');
const { close, query } = await import('../src/db.js');
const {
  LADDER, NEVER_DO, SIGNALS, BLOCKING_SIGNALS, SIGNAL_WINDOW_HOURS,
  rungFor, signalFrom, playerWords, readerWords, blockedSellerNote,
} = await import('../src/blocked.js');
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

test('an in-player rung withholds the offer, and says so in the file\'s own terms', () => {
  // One table, two readings: the door's copy says what did not happen to an UNLOCK, and
  // an in-player copy says what did not happen to a BREAK. The difference is not style —
  // "nothing was unlocked" is false inside a player, where the file or the stream kept
  // playing and only the credit is missing, and a sentence that is false is worse than
  // no sentence.
  for (const rung of LADDER) {
    const words = playerWords(rung);
    if (rung.key === 'quiet') {
      assert.equal(words, null, 'a person who has done nothing is told nothing');
      continue;
    }
    assert.ok(words && words.length > 60, `${rung.key} has no in-player tail`);
    assert.doesNotMatch(words, /brave|chrome|firefox|safari|edge\b|ublock|ghostery/i);
    assert.doesNotMatch(words, /your ad blocker|you are blocking|disable your|turn off your/i);
    assert.doesNotMatch(words, /nothing was unlocked|has been unlocked/i,
      'inside a player nothing was locked in the first place');
  }
  // The harsh rung, in the words a player needs: what goes is the ASK, and the sentence
  // has to say what does NOT change, because that is the fear it is answering.
  const last = LADDER[LADDER.length - 1];
  assert.match(playerWords(last), /not asking you for a view/i);
  assert.match(playerWords(last), /file plays|stream plays/i);
  assert.match(playerWords(last), /passes on its own|resets/i);
  // A reader's tail is a DIFFERENT sentence at the rung where the ask goes, because the
  // two surfaces do not lose the same thing: a withheld cue is passed over and the file
  // plays on, while a withheld ask at a seam leaves the pages behind it shut. The player's
  // tail promises "it passes on its own", which is a promise a shut seam cannot keep — the
  // reader walk caught the panel printing exactly that.
  for (const rung of LADDER.filter((r) => r.player)) {
    const words = readerWords(rung);
    assert.ok(words && words.length > 60, `${rung.key} has no reader tail`);
    assert.doesNotMatch(words, /brave|chrome|firefox|safari|edge\b|ublock|ghostery/i);
  }
  assert.match(readerWords(last), /not asking you for a view/i);
  assert.doesNotMatch(readerWords(last), /passes on its own/i,
    'a reader does not pass on — the seam is the only way through');
  assert.match(readerWords(last), /behind the seam|wait with the ask/i);
  // And the reader is defensive: a rung the module does not know has no tail rather than
  // a broken one, and the quiet rung's null is not an accident of the copy.
  assert.equal(playerWords(null), null);
  assert.equal(playerWords({ key: 'invented', offersUnlock: true }), null);
  assert.equal(readerWords(null), null);
  assert.equal(readerWords({ key: 'invented', offersUnlock: true }), null);
  // A rung written before the reader tail existed still says something true.
  assert.equal(readerWords({ player: 'the player\u2019s own tail' }), 'the player\u2019s own tail');
});

test('every surface that asks for a view reports the same signal, and reads the same rung', () => {
  // Four places in this product ask a person to watch something before they get the
  // thing they came for: a file's door, a cue inside an open file, a reader's seam, and a
  // break the store called on a live stream. Three of them used to fail in silence, and a
  // failure nobody records is a failure the ladder cannot climb for. Asserted on the
  // source because that is where "a surface was added and the wiring was not" shows up.
  const client = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const server = readFileSync(new URL('../server.js', import.meta.url), 'utf8');
  const view = readFileSync(new URL('../src/views.js', import.meta.url), 'utf8');

  // One reporter per surface — the door, the cue gate, the reader's seam and the live
  // break — all four pointed at the same route.
  const reporters = client.match(/const reportBlocked = async/g) || [];
  assert.equal(reporters.length, 4, 'one reporter per surface that asks');
  // (The door reaches the same route through its own button, which carries the URL.)
  const routes = client.match(/'\/api\/unlock\/blocked'/g) || [];
  assert.equal(routes.length, 4);
  // Every surface reports all three, and the count is exact so that a FIFTH surface
  // cannot be added without this test being told about it. `declined` appears twice per
  // surface in two of them (a branch and its comment), which is why the assertion is a
  // minimum there and an equality for the two that fail.
  for (const signal of ['script_blocked', 'no_postback']) {
    const calls = client.match(new RegExp(`'${signal}'`, 'g')) || [];
    assert.equal(calls.length, 4, `${signal} is reported by ${calls.length} of the four surfaces`);
  }
  assert.ok((client.match(/'declined'/g) || []).length >= 4, 'every surface records a decline too');
  // The three in-player surfaces each read the rung from the element they were rendered
  // with, so a person arriving inside an asking state is decided by the server and not by
  // what a browser happens to have polled yet.
  const seeded = new Set(['stage', 'button', 'root'].filter((el) => client.includes(`${el}.dataset.rungOffers`)));
  assert.equal(seeded.size, 3, 'the cue gate, the reader gate and the live stage read it');
  assert.match(client, /rung\.offersUnlock === false\) \{[\s\S]{0,200}declinedBreak = window_\.breakId/,
    'a withheld live rung must settle the window instead of asking');
  // A withheld cue must be passed over WHERE THE ORDINARY PATH STOPS — inside `runBreak`,
  // which is what `timeupdate` calls — and not only on the resume path. Round one of this
  // guard lived in the `play` handler alone, so a viewer whose playhead reached the cue
  // mid-playback still got the modal; the cue walk caught it. The assertion is anchored on
  // `runBreak` for that reason.
  assert.match(client, /const runBreak = async \(cue\) => \{\n\s+if \(withheldRung\(\)\) return passOver\(cue\)/,
    'a withheld cue must be passed over where the playhead stops, not only on resume');
  assert.match(client, /const passOver = \(cue\) => \{[\s\S]{0,200}cleared\.add\(cue\.index\)/,
    'and the pass-over marks the cue so neither door stops at it again');
  assert.match(client, /el\.addEventListener\('timeupdate'[\s\S]{0,200}runBreak\(cue\)/,
    'the playhead is the door that matters');
  // An ask owns the playhead. The play handler used to return early whenever `gating` was
  // set, so pressing play during a break resumed the file behind the modal while the
  // countdown ran — an ask a viewer could dismiss by ignoring it. Found in the browser.
  assert.match(client, /if \(gating\) \{ el\.pause\(\); return; \}/,
    'pressing play during an ask must give the playhead back to the ask');
  // And a person who comes back to the cue they stopped on is asked again: the resume puts
  // the playhead ON the cue, and `timeupdate` is not guaranteed to fire for a position
  // that has not moved.
  assert.match(client, /if \(withheldRung\(\)\) return passOver\(cue\);[\s\S]{0,400}runBreak\(cue\)\.catch/,
    'resuming onto a cue must raise the ask rather than play past it');

  // The server decides the rung for a `breaks` file too — the cue break asks inside the
  // player, where there is no door for the door's rung to govern.
  assert.match(server, /\['ad_gated', 'breaks'\]\.includes\(asset\.unlock_mode\)/);
  assert.match(server, /player: playerWords\(rung\)/);
  // And the live state route hands the same rung to the poller.
  assert.match(server, /cleanEntry: cleanEntrySentence\(state\.coverageUntil, new Date\(\)\),[\s\S]{0,500}rung: blockRung,/,
    'the live stage is rendered with the rung');
  assert.match(server, /rung: \{[\s\S]{0,300}player: playerWords\(rung\)[\s\S]{0,200}offersUnlock: rung\.offersUnlock/);

  // Both stages render it, so a person who arrives INSIDE an asking state is decided by
  // the server rather than by what a browser happens to know.
  assert.equal((view.match(/rungAttrs\(/g) || []).length, 4, 'the helper and its three users');
  assert.match(view, /data-rung-offers="\$\{rung\.offersUnlock \? 'true' : 'false'\}"/);
  assert.match(view, /gateWithheld/);

  // The withheld reader panel keeps a way out that is not the ask: the button is what
  // goes, and the link back to the file is what stays.
  assert.match(view, /const gateWithheld = Boolean\(gateRung && gateRung\.offersUnlock === false\)/);
  // The reader's own words on the reader's own surface — and only once: the panel used to
  // print the rung's headline above the player's tail, which said "not being offered for a
  // while" twice in a row and promised the file would pass on by itself.
  assert.match(view, /gateWithheld \? readerWords\(gateRung\) : gate.sentence/);
  // And the report's answer carries both tails, so a surface can print the rung this very
  // answer computed instead of the rung its page happened to be rendered with.
  assert.match(server, /player: playerWords\(rung\),[\s\S]{0,120}reader: readerWords\(rung\),/);
  assert.match(client, /after\?\.reader \|\| rung\?\.words/,
    "a reader's failed seam says the reader's own rung, not the player's");
  assert.match(view, /\$\{gateWithheld\n\s+\? `<a class="btn btn-primary" href="\$\{esc\(assetUrl\)\}">Back to the file<\/a>`/);
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
  assert.match(withMembers, /with no ad/, 'and it says what that route opens');
  // The sentence carries the one arrangement that does NOT open a member file with no
  // ad: a tier the seller set to keep the ordinary asks. Stating the promise without
  // it would be the platform making it on a seller's behalf, which is how a buyer
  // ends up holding a membership and an ad at the same time.
  assert.match(withMembers, /unless the tier you pick keeps the ordinary\s+asks/);
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
