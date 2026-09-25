/**
 * The live arithmetic, held still.  npm test
 *
 * A live break is a window and the only thing it pays for is clean entries, so every
 * decision in this module is a number that would decay silently in a browser: the
 * ratio (20 seconds per second — Twitch's 1:20 rule), the cap (a four-minute break
 * buys 60 minutes, not 80), the gap (no two breaks inside four minutes), the ceiling
 * (three an hour), and the grace a viewer gets after a window has closed.
 *
 * The tests below are written against the numbers, not the prose, because the prose
 * is what changes when somebody has an opinion and the numbers are what a seller was
 * promised on the button.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  LIVE_CLEAN_CAP_SECONDS, LIVE_GRACE_SECONDS, LIVE_LENGTHS, LIVE_LONGEST_SECONDS,
  cleanEntrySeconds, cleanEntrySentence, cleanEntryUntil, lengthWords, liveBreakRefusal,
  liveState, nextCueIndex, tradeSentence, windowAcceptsViews, windowEndsAt, windowIsOpen,
} from '../src/live.js';

const at = (iso) => new Date(iso);
const NOW = at('2026-09-25T12:00:00Z');
const mins = (n) => new Date(NOW.getTime() + n * 60_000);
const window_ = ({ started = NOW, seconds = 30, closed = null, cue = 1 } = {}) => ({
  cue_index: cue,
  seconds,
  started_at: started,
  ends_at: new Date(started.getTime() + seconds * 1000),
  closed_at: closed,
});

test('a break buys twenty seconds of clean entry per second, capped at an hour', () => {
  assert.equal(cleanEntrySeconds(30), 600);
  assert.equal(cleanEntrySeconds(180), 3600);
  // The cap is the whole reason running more breaks is not a way to buy an afternoon:
  // 240 s × 20 would be 80 minutes, and Twitch's own ceiling is an hour.
  assert.equal(cleanEntrySeconds(240), LIVE_CLEAN_CAP_SECONDS);
  assert.equal(cleanEntrySeconds(0), 0);
  assert.equal(cleanEntrySeconds('nonsense'), 0);
  for (const length of LIVE_LENGTHS) assert.ok(length <= LIVE_LONGEST_SECONDS);
});

test('coverage runs from the end of the break, and an expired one covers nothing', () => {
  const fresh = window_({ started: mins(-5), seconds: 30 });          // ended 4.5 min ago
  assert.equal(cleanEntryUntil([fresh], NOW).toISOString(), new Date(fresh.ends_at.getTime() + 600_000).toISOString());

  const stale = window_({ started: mins(-60), seconds: 30 });          // its ten minutes are long gone
  assert.equal(cleanEntryUntil([stale], NOW), null);

  assert.equal(cleanEntryUntil([], NOW), null);
});

test('two breaks, and the coverage is the later one — never their sum', () => {
  const a = window_({ started: mins(-40), seconds: 60, cue: 1 });
  const b = window_({ started: mins(-10), seconds: 120, cue: 2 });
  const until = cleanEntryUntil([a, b], NOW);
  assert.equal(until.toISOString(), new Date(b.ends_at.getTime() + 120 * 20 * 1000).toISOString());
  assert.ok(until.getTime() < new Date(a.ends_at.getTime() + 60 * 20 * 1000).getTime() + 1e9);
});

test('a closed window is not a break, and an ended one is not open', () => {
  assert.equal(windowIsOpen(window_({ started: mins(-1), seconds: 240 }), NOW), true);
  assert.equal(windowIsOpen(window_({ started: mins(-10), seconds: 30 }), NOW), false);
  // Closed early: even a window whose end is in the future is over when the store says so.
  assert.equal(windowIsOpen(window_({ started: NOW, seconds: 240, closed: mins(-1) }), NOW), false);
  assert.equal(windowIsOpen(null, NOW), false);
});

test('a viewer stopped by a window can still clear it for a few minutes after', () => {
  const justEnded = window_({ started: mins(-3), seconds: 60 });       // ended two minutes ago
  assert.equal(windowAcceptsViews(justEnded, NOW), true);
  const longGone = window_({ started: mins(-60), seconds: 60 });
  assert.equal(windowAcceptsViews(longGone, NOW), false);
  const closedLongAgo = window_({ started: NOW, seconds: 240, closed: new Date(NOW.getTime() - (LIVE_GRACE_SECONDS + 60) * 1000) });
  assert.equal(windowAcceptsViews(closedLongAgo, NOW), false);
});

test('the four caps, in the order a seller would hit them', () => {
  assert.match(liveBreakRefusal({ seconds: 5, breaks: [], now: NOW }), /between 15 seconds and 4 minutes/);
  assert.match(liveBreakRefusal({ seconds: 300, breaks: [], now: NOW }), /between 15 seconds and 4 minutes/);
  assert.equal(liveBreakRefusal({ seconds: 30, breaks: [], now: NOW }), null);

  const open = window_({ started: NOW, seconds: 60 });
  assert.match(liveBreakRefusal({ seconds: 30, breaks: [open], now: NOW }), /already in a break/);

  const recent = window_({ started: mins(-2), seconds: 30, closed: mins(-1) });
  assert.match(liveBreakRefusal({ seconds: 30, breaks: [recent], now: NOW }), /Wait 2 more minute/);
  // Four minutes after the last one started, the next is allowed.
  assert.equal(liveBreakRefusal({ seconds: 30, breaks: [window_({ started: mins(-4, ), seconds: 30, closed: mins(-3) })], now: NOW }), null);

  const three = [mins(-50), mins(-30), mins(-10)].map((started, i) => window_({ started, seconds: 30, closed: new Date(started.getTime() + 30_000), cue: i + 1 }));
  assert.match(liveBreakRefusal({ seconds: 30, breaks: three, now: NOW }), /3 breaks in an hour/);
  // The oldest falls out of the hour, so the fourth becomes possible.
  const spread = [mins(-70), mins(-30), mins(-10)].map((started, i) => window_({ started, seconds: 30, closed: new Date(started.getTime() + 30_000), cue: i + 1 }));
  assert.equal(liveBreakRefusal({ seconds: 30, breaks: spread, now: NOW }), null);
});

test('live cues are numbered from one, and the door is not a break', () => {
  assert.equal(nextCueIndex([]), 1);
  assert.equal(nextCueIndex([window_({ cue: 1 }), window_({ cue: 2 })]), 3);
  // Gaps do not make a number reusable: the ledger key must never be handed out twice.
  assert.equal(nextCueIndex([window_({ cue: 7 })]), 8);
});

test('a break that has not ended covers nobody yet', () => {
  // A viewer arriving while a break RUNS is arriving into it. Counting the running
  // window as coverage would open the door for free and then stop them for the very
  // break that opened it — the ask and the giveaway at the same time.
  const running = window_({ started: mins(-1), seconds: 240, cue: 1 });
  assert.equal(cleanEntryUntil([running], NOW), null);
  // The same break, five minutes after it ended, covers until its own arithmetic says.
  const ended = window_({ started: mins(-10), seconds: 240, cue: 1 });
  assert.equal(cleanEntryUntil([ended], NOW).toISOString(), new Date(ended.ends_at.getTime() + 3600_000).toISOString());
});

test('the state a viewer is handed: the stop, the door, and the reason for each', () => {
  const running = window_({ started: mins(-1), seconds: 120, cue: 3 });            // ends in a minute
  const paidFor = window_({ started: mins(-6), seconds: 60, cue: 2, closed: mins(-5) }); // covers until +15 min
  const stale = window_({ started: mins(-40), seconds: 60, cue: 1, closed: mins(-39) }); // its twenty minutes are gone

  // A viewer who owes the running window their view is stopped by it. Their DOOR may
  // still be covered by an earlier break — walking in free and sitting through the break
  // that is already playing are two different facts, which is exactly Twitch's model.
  const stopped = liveState({ breaks: [running, paidFor, stale], cleared: [], unlocked: false, now: NOW });
  assert.equal(stopped.entry, 'covered');
  assert.equal(stopped.stop.cueIndex, 3);
  assert.equal(stopped.stop.remainingSeconds, 60);
  assert.equal(stopped.break.cueIndex, 3);

  // The same window, already sat through by this viewer: no second stop, no second ask.
  assert.equal(liveState({ breaks: [running, paidFor], cleared: [3], unlocked: false, now: NOW }).stop, null);

  // Nobody has run a break worth covering, and nobody is stopped: the ordinary door.
  const asking = liveState({ breaks: [stale], cleared: [], unlocked: false, now: NOW });
  assert.equal(asking.entry, 'ask');
  assert.equal(asking.stop, null);
  assert.equal(asking.break, null);

  // A door this person already paid is never re-charged by a break's coverage.
  assert.equal(liveState({ breaks: [paidFor], cleared: [], unlocked: true, now: NOW }).entry, 'unlocked');

  // A closed window is not a break any more — nobody is stopped — and its coverage runs
  // from when the store ENDED it, bought with the length it announced.
  const closedNow = liveState({ breaks: [window_({ started: mins(-2), seconds: 120, closed: mins(-1), cue: 1 })], cleared: [], unlocked: false, now: NOW });
  assert.equal(closedNow.break, null);
  assert.equal(closedNow.stop, null);
  assert.equal(closedNow.entry, 'covered');

  // The same window, ended early but long ago: nothing running, nothing covered.
  const closedLongAgo = liveState({ breaks: [window_({ started: mins(-90), seconds: 120, closed: mins(-80), cue: 1 })], cleared: [], unlocked: false, now: NOW });
  assert.equal(closedLongAgo.entry, 'ask');
  assert.equal(closedLongAgo.coverageUntil, null);
});

test('the words are the offer', () => {
  assert.equal(tradeSentence(30), '30 seconds of break buys 10 minutes of clean entries for newcomers.');
  assert.equal(tradeSentence(240), '4 minutes of break buys 60 minutes of clean entries for newcomers.');
  assert.equal(lengthWords(45), '45 seconds');
  assert.equal(lengthWords(60), '1 minute');
  assert.equal(cleanEntrySentence(null, NOW), null);
  assert.match(cleanEntrySentence(mins(10), NOW), /about 10 minutes more/);
  assert.equal(cleanEntrySentence(mins(-1), NOW), null);
  assert.equal(windowEndsAt(60, NOW).toISOString(), mins(1).toISOString());
});
