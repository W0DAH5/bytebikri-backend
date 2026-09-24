/**
 * Where a break may go, and where it may never go.  npm test
 *
 * The ask has been a door since the beginning: "watch 2 ads to unlock", the whole
 * price paid before a second of the file. That is right for a download and wrong
 * for a forty-minute lecture, and the fix is not to lower the price but to move
 * where it is paid — one break before, one at 11:08, one at 29:23.
 *
 * What can go wrong when placement becomes a setting is not subtle: a break seven
 * seconds into a clip, two breaks back to back, an ad in the last minute where the
 * payoff is, a reader interrupted mid-page, an ad inserted into somebody's live
 * stream. Every one of those is a rule in `placement.js`, and every one is a test
 * here rather than a sentence in a comment — those rules are the only reason a
 * seller can be handed this control at all.
 *
 * The properties, in the order the module argues for them:
 *
 *   1. THE SHAPE DECIDES WHAT IS AVAILABLE. A manhwa has no mid-roll; a video has
 *      no between-chapter gate; a live file has no automatic break, ever.
 *   2. THE PLATFORM'S WINDOW IS ABSOLUTE. Never in the first two minutes, never in
 *      the last ninety seconds, never two breaks within four minutes.
 *   3. THE BUDGET DOES NOT MOVE. Placement redistributes the ladder's ask; it can
 *      never add seconds to it, and it can never exceed the plan's ceiling.
 *   4. THE SELLER TURNS THINGS OFF. Every placement the shape allows is a checkbox,
 *      and a file too short to hold a break gets none rather than a bad one.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

const {
  PLACEMENTS, PLACEMENT_BOUNDS, placementsFor, defaultChoices, resolveChoices,
  planFor, describe, placementSentence, plannedSeconds, stamp,
} = await import('../src/placement.js');
const { resolveAsk } = await import('../src/adscale.js');

/** The ask a file of this value is given on this plan — never typed by a test. */
const askFor = (valueNpr, planCode = 'pro') => resolveAsk({ valueNpr, planCode, level: 'standard' });

test('the shape decides which placements exist, and "pre" is not one of them', () => {
  // `pre` is the door itself. An ad-gated file's ask IS its pre-roll, and this
  // module exists to place what is left — which is why no shape lists it.
  for (const shape of Object.keys({ download: 1, read: 1, watch: 1, listen: 1, play: 1, stream: 1 })) {
    assert.ok(!placementsFor(shape).includes('pre'),
      `${shape} must not be offered a pre-roll on top of the door it may already have`);
  }

  assert.deepEqual(placementsFor('watch'), ['mid', 'post', 'aside']);
  assert.deepEqual(placementsFor('read'), ['between', 'aside']);
  assert.deepEqual(placementsFor('listen'), ['mid', 'between', 'post', 'aside']);
  assert.deepEqual(placementsFor('stream'), ['live', 'aside']);
  assert.deepEqual(placementsFor('play'), ['rewarded', 'aside']);
  assert.deepEqual(placementsFor('download'), ['aside']);

  // And the table is the single source: every catalogue entry names the shapes it
  // belongs to, so the seller's page and this function cannot disagree.
  for (const key of Object.keys(PLACEMENTS)) {
    assert.ok(Array.isArray(PLACEMENTS[key].shapes), `${key} declares its shapes`);
    assert.ok(PLACEMENTS[key].why, `${key} explains itself to the seller`);
  }
});

test('the seller\'s defaults are modest, and a stored blob cannot invent a placement', () => {
  assert.deepEqual(defaultChoices('watch'), { mid: true, post: false, aside: true },
    'a mid-roll is on, a post-roll is not — it completes at 25–40% and is an offer, not a toll');
  assert.deepEqual(defaultChoices('stream'), { live: false, aside: true },
    'a live break starts off: the seller has to name a time before one exists');

  // A hand-crafted POST cannot give a download a mid-roll, whatever it claims.
  const lying = resolveChoices('download', { mid: true, between: true, rewarded: true });
  assert.deepEqual(lying, { aside: true });
  // …and a missing key falls back to the default rather than to `undefined`.
  assert.deepEqual(resolveChoices('watch', { mid: false }), { mid: false, post: false, aside: true });
});

test('a file too short for a legal break gets none, and is told why', () => {
  const ask = askFor(2_000); // 2 ads of 45s on Pro
  // Three minutes: a break would be inside the first two minutes or the last
  // ninety seconds. Both are worse than no break.
  const short = planFor({ shape: 'watch', durationSec: 180, ask, planCode: 'pro' });
  assert.equal(short.cues.length, 0);
  assert.equal(short.reason, 'too-short');
  assert.match(short.reasonText, /first 2:00|first/);

  // The boundary is the boundary: 210 s of runtime leaves exactly one legal slot
  // (2:00 to 0:30 before the end), and it gets one.
  const edge = planFor({ shape: 'watch', durationSec: 210, ask, planCode: 'pro' });
  assert.equal(edge.cues.length, 1);
  assert.equal(edge.cues[0].atSec, 120);
  assert.ok(210 - edge.cues[0].atSec >= PLACEMENT_BOUNDS.lastBreakBeforeEnd);
});

test('a long file gets its budget spread across the window, never at the edges', () => {
  const ask = askFor(2_000); // 2 × 45 s
  const plan = planFor({ shape: 'watch', durationSec: 2_400, ask, planCode: 'pro' });

  assert.equal(plan.cues.length, 2);
  assert.deepEqual(plan.cues.map((c) => c.kind), ['mid', 'mid']);
  for (const cue of plan.cues) {
    assert.ok(cue.atSec >= PLACEMENT_BOUNDS.firstBreakAfter, 'never in the first two minutes');
    assert.ok(cue.atSec <= 2_400 - PLACEMENT_BOUNDS.lastBreakBeforeEnd, 'never in the last ninety seconds');
  }
  assert.ok(plan.seconds <= plan.budget.totalSeconds, 'placement never adds seconds to the ask');
  assert.equal(plan.seconds, 90);
  // And the buyer is told, in the platform's own words, where they are.
  assert.match(describe(plan.cues, plan.budget), /11:0\d|2 breaks of 45 seconds/);
});

test('the window and the gap hold for every runtime and every plan, not just the examples', () => {
  // A property, because the failure mode is an edge nobody pictured: a runtime
  // just over a threshold, an ask that has more breaks than the file can hold.
  for (const planCode of ['free', 'store', 'pro']) {
    for (const value of [0, 50, 600, 2_000, 1_000_000]) {
      const ask = askFor(value, planCode);
      for (const durationSec of [30, 120, 181, 300, 600, 601, 1_200, 3_600, 7_200, 60, 239, 240, 241]) {
        const plan = planFor({ shape: 'watch', durationSec, ask, planCode });
        const mids = plan.cues.filter((c) => c.kind === 'mid');
        for (const cue of mids) {
          assert.ok(cue.atSec >= PLACEMENT_BOUNDS.firstBreakAfter,
            `${planCode}/${value}/${durationSec}: break at ${cue.atSec} is inside the first two minutes`);
          assert.ok(cue.atSec <= durationSec - PLACEMENT_BOUNDS.lastBreakBeforeEnd,
            `${planCode}/${value}/${durationSec}: break at ${cue.atSec} is inside the last ninety seconds`);
        }
        for (let i = 1; i < mids.length; i++) {
          assert.ok(mids[i].atSec - mids[i - 1].atSec >= PLACEMENT_BOUNDS.minGap,
            `${planCode}/${value}/${durationSec}: two breaks ${mids[i].atSec - mids[i - 1].atSec}s apart`);
        }
        assert.ok(plannedSeconds(plan) <= 180, `${planCode}/${value}/${durationSec}: over the 180-second promise`);
        assert.ok(plan.ads <= ask.ceiling.ads, 'never more breaks than the plan allows');
        // Whatever it decided, it explains itself in one sentence.
        assert.ok(plan.reasonText && plan.reasonText.length > 10);
      }
    }
  }
});

test('a file with more ask than room is cut down, and the cut is reported', () => {
  // Pro may ask for 3 ads of 60 s. A five-minute file has room for one break.
  const ask = resolveAsk({ valueNpr: 10_000_000, planCode: 'pro', level: 'standard' });
  assert.equal(ask.ads, 3);
  const plan = planFor({ shape: 'watch', durationSec: 300, ask, planCode: 'pro' });
  assert.equal(plan.cues.length, 1, 'the file decides how many breaks it can hold');
  assert.equal(plan.refused.length, 1, 'and the seller is told what did not fit');
  assert.match(plan.refused[0].reason, /room for 1 break/);
  assert.equal(plan.seconds, 60, 'the one break that fits keeps its length');
});

test('the seller can turn a break off, and off means off', () => {
  const ask = askFor(2_000);
  const noMid = planFor({ shape: 'watch', durationSec: 2_400, ask, planCode: 'pro', choices: { mid: false } });
  assert.equal(noMid.cues.length, 0);
  assert.equal(noMid.reason, 'off');

  // A post-roll on its own is an offer at the end, and an offer is not a reason to
  // run an ad on somebody's file — so with the break off, nothing is placed.
  const postOnly = planFor({
    shape: 'watch', durationSec: 2_400, ask, planCode: 'pro', choices: { mid: false, post: true },
  });
  assert.equal(postOnly.cues.length, 0);
  assert.match(postOnly.notes.join(' '), /offer after the file/);

  // With both on, the post-roll is last and is not a paid break.
  const both = planFor({
    shape: 'watch', durationSec: 2_400, ask, planCode: 'pro', choices: { mid: true, post: true },
  });
  assert.equal(both.cues.at(-1).kind, 'post');
  assert.equal(both.seconds, both.cues.filter((c) => c.kind === 'mid').length * 45);
});

test('a reader breaks between chapters, never inside one, and not in the opening chapters', () => {
  const ask = askFor(2_000); // 2 ads
  const twoChapters = planFor({ shape: 'read', durationSec: 900, chapters: 2, ask, planCode: 'pro' });
  assert.equal(twoChapters.cues.length, 0);
  assert.equal(twoChapters.reason, 'too-short');

  // Five chapters and a two-ad ask: the two even positions (chapters 2 and 3)
  // collapse to one, because the third chapter is the earliest a break may sit
  // and two gates with no chapter between them is one interruption, not two.
  const five = planFor({ shape: 'read', durationSec: 900, chapters: 5, ask, planCode: 'pro' });
  assert.deepEqual(five.cues.map((c) => c.atChapter), [3]);
  assert.match(five.refused[0].reason, /with 5 chapters there is room for 1/);
  assert.ok(five.cues.every((c) => c.kind === 'between' && c.atSec === null),
    'a between cue has no playhead — there is nothing to time a page against');

  // Three breaks need a three-ad ask, and a twelve-chapter read has room for all
  // of them: after chapters 3, 6 and 10 rather than after three chapters in a row.
  const big = planFor({ shape: 'read', durationSec: 3_600, chapters: 12, ask: askFor(10_000_000), planCode: 'pro' });
  assert.deepEqual(big.cues.map((c) => c.atChapter), [3, 6, 9]);

  // A forty-page manhwa is a read of forty chapters, so its breaks land deep in
  // the story rather than three pages in.
  const manhwa = planFor({ shape: 'read', durationSec: 600, chapters: 40, ask, planCode: 'pro' });
  assert.deepEqual(manhwa.cues.map((c) => c.atChapter), [13, 27]);

  // A queue breaks between tracks the same way, and its sentence says "track".
  const album = planFor({ shape: 'listen', durationSec: 2_400, chapters: 8, ask, planCode: 'pro' });
  assert.match(album.cues[0].label, /^After track /);
});

test('live is the seller\'s, and the platform cannot insert a break into it', () => {
  const ask = askFor(10_000_000, 'pro'); // the largest ask the platform allows
  const plan = planFor({
    shape: 'stream', durationSec: 4 * 3_600, ask, planCode: 'pro',
    choices: { live: true, aside: true },
  });
  assert.equal(plan.cues.length, 0, 'no automatic break, whatever the ask and the runtime');
  assert.equal(plan.reason, 'live');
  assert.match(plan.reasonText, /owner says so/);

  // The guarantee is structural rather than a flag: the stream branch of `planFor`
  // returns before any cue could be built, so no combination of inputs reaches a
  // cue. Sweeping the inputs is how that stays true after the next edit.
  for (const durationSec of [60, 3_600, 14_400]) {
    for (const choices of [null, { live: true }, { live: true, aside: false }]) {
      const swept = planFor({ shape: 'stream', durationSec, ask, planCode: 'pro', choices });
      assert.equal(swept.cues.length, 0, `a ${durationSec}s live file was given a break`);
    }
  }
});

test('the shapes with nothing to time get nothing, and say so', () => {
  const ask = askFor(2_000);
  const download = planFor({ shape: 'download', durationSec: 3_600, ask, planCode: 'pro' });
  assert.equal(download.cues.length, 0);
  assert.match(download.reasonText, /boxes on its page/);

  const noRuntime = planFor({ shape: 'watch', durationSec: null, ask, planCode: 'pro' });
  assert.equal(noRuntime.cues.length, 0);
  assert.equal(noRuntime.reason, 'no-runtime', 'no ffprobe and no seller-typed runtime: the player reports it');

  const game = planFor({ shape: 'play', ask, planCode: 'pro' });
  assert.deepEqual(game.cues.map((c) => c.kind), ['rewarded']);
  assert.equal(game.seconds, 0, 'a reward at a failure state is not a timed break');
  assert.equal(planFor({ shape: 'play', ask, planCode: 'pro', choices: { rewarded: false } }).cues.length, 0);
});

test('an ad never goes inside a member\'s file', () => {
  const ask = askFor(10_000_000, 'pro');
  const plan = planFor({
    shape: 'watch', durationSec: 3_600, ask, planCode: 'pro',
    choices: { mid: true, post: true }, membersOnly: true,
  });
  assert.equal(plan.cues.length, 0);
  assert.equal(plan.reason, 'members');
  assert.match(plan.reasonText, /tier buys/);
});

test('the buyer\'s sentence names the breaks before they click, and only when there are any', () => {
  const ask = askFor(2_000);
  const watch = planFor({ shape: 'watch', durationSec: 2_400, ask, planCode: 'pro' });
  const sentence = placementSentence(watch);
  assert.match(sentence, /^Free to open\./);
  assert.match(sentence, /nothing before you start/);

  const read = planFor({ shape: 'read', durationSec: 900, chapters: 5, ask, planCode: 'pro' });
  assert.match(placementSentence(read), /along the way/);
  assert.match(placementSentence(read), /chapter 3/);

  // A file with no breaks gets no sentence: a line that says "no ads inside" on a
  // file that never had any is noise, and noise is what people stop reading.
  assert.equal(placementSentence(planFor({ shape: 'watch', durationSec: 180, ask, planCode: 'pro' })), null);
  assert.equal(placementSentence(null), null);
});

test('the times are written one way, and the rule numbers are the published ones', () => {
  assert.equal(stamp(0), '0:00');
  assert.equal(stamp(9), '0:09');
  assert.equal(stamp(68), '1:08');
  assert.equal(stamp(1_763), '29:23');
  assert.equal(stamp(3_600), '60:00', 'hours are minutes here: a long lecture reads 60:00, not 1:00:00');

  // These four numbers are the framework's rules, and the seller's page prints
  // them. If one moves, the copy moves with it — the same contract `ASK_PROMISE`
  // has in adscale.test.js.
  assert.deepEqual(PLACEMENT_BOUNDS, {
    firstBreakAfter: 120,
    lastBreakBeforeEnd: 90,
    minGap: 240,
    betweenFromChapter: 3,
    betweenGap: 2,
  });
});
