/**
 * The live surface: what a break is, and the one number that makes it worth calling.
 *
 * ASSET_ECONOMY §14 designed this shape, and §2.3 is the evidence under it. Twitch's
 * automated mid-stream ads are the industry's clearest negative result — forced
 * breaks the streamer could not control, a top user request that read literally
 * "Remove mid-roll ads" (5,089 votes), streamers reporting up to a third of viewers
 * lost per break. What survived, and what Twitch still runs, is the streamer's own
 * schedule plus an entry trade: 30 seconds of mid-roll turns the pre-roll off for the
 * next ten minutes; three minutes turns it off for an hour. That is the 1:20 rule, and
 * it is the entire mechanic of this module.
 *
 * So there are two facts here and nothing else:
 *
 *   1. A BREAK IS A WINDOW, AND ONLY THE STORE OPENS ONE. This module cannot create
 *      one and neither can the server: every function here takes rows it is handed.
 *      There is no timer, no clock read, no code path that decides a break is due —
 *      which is what makes "the platform never inserts one" a fact about the code
 *      rather than a promise about our intentions (placement rule 4).
 *
 *   2. A BREAK BUYS CLEAN ENTRIES AT 20 SECONDS PER SECOND, CAPPED AT AN HOUR. The
 *      ratio is Twitch's own (30 s → 10 min, 180 s → 60 min), and the cap is what
 *      keeps "run more breaks" from being a way to buy an afternoon of clean entries:
 *      a four-minute break buys 60 minutes, not 80. Coverage runs from the END of the
 *      break, because the people a break buys for are the ones arriving after it.
 *
 * The attention rules the catalogue already states for a timed break apply here too,
 * and they are checked in `liveBreakRefusal` rather than in the route, so the seller's
 * page, the POST and the tests all read the same rule: 15 s to 4 minutes long, never
 * two within four minutes, at most three an hour, one open at a time.
 *
 * Pure module. No database, no clock of its own: every function that needs "now" is
 * handed one.
 */

/** Twitch's ratio, in seconds of clean entry per second of break. */
export const LIVE_RATIO = 20;

/** More than this in one break buys nothing more: 20 × 240 s would be 80 minutes. */
export const LIVE_CLEAN_CAP_SECONDS = 3600;

export const LIVE_SHORTEST_SECONDS = 15;
export const LIVE_LONGEST_SECONDS = 240;
export const LIVE_GAP_SECONDS = 240;
export const LIVE_PER_HOUR = 3;

/** How often the player asks whether a break has been called. */
export const LIVE_POLL_SECONDS = 15;

/**
 * How long after a window ends a viewer it stopped can still clear it.
 *
 * The viewer's poll is up to 15 seconds behind and a network postback takes as long
 * as it takes, so a person can be sitting in front of a modal for a break that has
 * technically closed. Refusing to credit them would be punishing them for our lag.
 * Five minutes is generous enough for a slow postback and short enough that a window
 * is not a standing offer.
 */
export const LIVE_GRACE_SECONDS = 300;

/** The lengths the panel offers, in seconds. Four minutes is the ceiling. */
export const LIVE_LENGTHS = [15, 30, 60, 120, 240];

/** What one break buys, in seconds of clean entry. */
export function cleanEntrySeconds(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  return Math.min(s * LIVE_RATIO, LIVE_CLEAN_CAP_SECONDS);
}

/** Is this window still open at `now`? A closed window is not a break, ever. */
export function windowIsOpen(row, now = new Date()) {
  if (!row) return false;
  if (row.closed_at) return false;
  return new Date(row.ends_at).getTime() > new Date(now).getTime();
}

/** Was this window open, or closed within the last few minutes? */
export function windowAcceptsViews(row, now = new Date(), graceSeconds = LIVE_GRACE_SECONDS) {
  if (!row) return false;
  if (windowIsOpen(row, now)) return true;
  const ended = new Date(row.closed_at || row.ends_at).getTime();
  return new Date(now).getTime() < ended + graceSeconds * 1000;
}

/**
 * When the store's clean-entry coverage runs out — null when nobody is covered.
 *
 * The maximum over the breaks handed in, and the caller decides how far back to look.
 * Two exclusions, both of them the difference between a trade and a giveaway:
 *
 *   · a break whose coverage has already expired cannot extend anything. Coverage is a
 *     claim about NOW, and a claim about a time that has passed would open the door for
 *     somebody the store never paid for;
 *   · a break that has not ENDED yet covers nobody. A viewer arriving while a break is
 *     running is arriving INTO it — Twitch's own model, and the one its users described:
 *     mid-rolls turn the pre-roll off for the window that FOLLOWS. Counting a running
 *     break as coverage would hand newcomers a free door and then stop them for the
 *     break anyway, which is both the ask and the giveaway;
 *   · coverage runs from when the break ACTUALLY ended (`closed_at` when the store
 *     ended it early, otherwise its own end), while the length it buys is the length the
 *     store announced. Ending a break early shortens when coverage starts; it is not a
 *     way to buy the same coverage without running the break.
 */
export function cleanEntryUntil(breaks = [], now = new Date()) {
  const at = new Date(now).getTime();
  let best = null;
  for (const row of breaks) {
    const scheduled = new Date(row.ends_at).getTime();
    if (!Number.isFinite(scheduled)) continue;
    // Still running: it covers nobody yet.
    if (!row.closed_at && scheduled > at) continue;
    // It ended when the store ended it, or when the clock did. Coverage runs from
    // THERE — and it is bought with the length the store ANNOUNCED, so ending a break
    // early cannot be a way to buy coverage without running the break.
    const endedAt = row.closed_at ? new Date(row.closed_at).getTime() : scheduled;
    const until = endedAt + cleanEntrySeconds(row.seconds) * 1000;
    if (until <= at) continue;
    if (best === null || until > best) best = until;
  }
  return best === null ? null : new Date(best);
}

/** The next cue index for this file: live cues start at 1; 0 is the door. */
export function nextCueIndex(breaks = []) {
  return breaks.reduce((max, row) => Math.max(max, Number(row.cue_index) || 0), 0) + 1;
}

/**
 * May this break be called? Null means yes; otherwise the sentence the seller sees.
 *
 * The rules are the catalogue's (§5.2 rule 2 and the caps in §14.3), and they are
 * checked here so that the button, the route and the tests cannot drift apart. Three
 * refusals are about the break being asked for; the open-window one is about the
 * stream already being in a break.
 */
export function liveBreakRefusal({ seconds, breaks = [], now = new Date() } = {}) {
  const length = Math.floor(Number(seconds) || 0);
  if (!Number.isInteger(length) || length < LIVE_SHORTEST_SECONDS || length > LIVE_LONGEST_SECONDS) {
    return `A break is between ${LIVE_SHORTEST_SECONDS} seconds and ${LIVE_LONGEST_SECONDS / 60} minutes long.`;
  }
  const at = new Date(now).getTime();
  if (breaks.some((row) => windowIsOpen(row, now))) {
    return 'This stream is already in a break. One at a time.';
  }
  const ordered = [...breaks].sort((a, b) => new Date(b.started_at) - new Date(a.started_at));
  const last = ordered[0];
  if (last) {
    const since = (at - new Date(last.started_at).getTime()) / 1000;
    if (since < LIVE_GAP_SECONDS) {
      const wait = Math.ceil((LIVE_GAP_SECONDS - since) / 60);
      return `The last break was ${Math.max(0, Math.floor(since / 60))} minute(s) ago. `
        + `Wait ${wait} more minute(s) — two breaks inside four minutes cost more than they add.`;
    }
  }
  const hour = ordered.filter((row) => at - new Date(row.started_at).getTime() < 3_600_000);
  if (hour.length >= LIVE_PER_HOUR) {
    return `That is ${LIVE_PER_HOUR} breaks in an hour, which is the ceiling. The next one can be called an hour after the first.`;
  }
  return null;
}

/** The end of a window that starts now and lasts `seconds`. */
export function windowEndsAt(seconds, now = new Date()) {
  return new Date(new Date(now).getTime() + Math.floor(Number(seconds) || 0) * 1000);
}

/** "10 minutes", "1 minute", "45 seconds" — for sentences, not for tables. */
export function lengthWords(seconds) {
  const s = Math.max(0, Math.round(Number(seconds) || 0));
  if (s < 60) return `${s} second${s === 1 ? '' : 's'}`;
  const m = Math.round(s / 60);
  return `${m} minute${m === 1 ? '' : 's'}`;
}

/**
 * The trade, in the panel's own words: what a break of this length buys.
 *
 * It is stated before the button rather than after it, because the seller is deciding
 * whether calling one is worth it and the number that answers that is this one.
 */
export function tradeSentence(seconds) {
  const clean = cleanEntrySeconds(seconds);
  if (clean <= 0) return 'A break needs a length before it buys anything.';
  return `${lengthWords(seconds)} of break buys ${lengthWords(clean)} of clean entries for newcomers.`;
}

/** The sentence a viewer sees when their door is open because of a break. */
export function cleanEntrySentence(until, now = new Date()) {
  if (!until) return null;
  const left = Math.max(0, Math.round((new Date(until).getTime() - new Date(now).getTime()) / 60000));
  if (left <= 0) return null;
  return `The store just ran a break, so the door is open for about ${lengthWords(left * 60)} more.`;
}

/**
 * The whole live picture for one viewer, as the page and the state route both need it.
 *
 * One function, because the two callers must never disagree: the page draws the door
 * from this, and the poller decides whether to stop the player from this. If they read
 * two different compositions, a viewer can be stopped by a break the page never
 * mentioned — which is exactly the surprise Twitch's own users reported (§2.3).
 *
 * `entry` is the trade, stated as one of three facts rather than as a boolean:
 *
 *   'unlocked' — this person already cleared the door; a break cannot re-charge them;
 *   'covered'  — a break that has ENDED is paying for their entry, so the door opens
 *                clean for as long as its coverage runs;
 *   'ask'      — the ordinary door: a verified view, exactly like every other file.
 *
 * `stop` is a break this viewer has NOT been served yet. A viewer who has already sat
 * through window 3 is not stopped by window 3 a second time — the ledger is the memory
 * (rule: no second serving of the same view), which is why `cleared` is a parameter
 * instead of a second table.
 */
export function liveState({ breaks = [], cleared = [], unlocked = false, now = new Date() } = {}) {
  const open = breaks.find((row) => windowIsOpen(row, now)) || null;
  const until = cleanEntryUntil(breaks, now);
  const clearedIndexes = new Set(cleared.map(Number));
  const entry = unlocked ? 'unlocked' : (until ? 'covered' : 'ask');
  const stop = open && !clearedIndexes.has(Number(open.cue_index))
    ? {
      breakId: open.id,
      cueIndex: Number(open.cue_index),
      seconds: Number(open.seconds),
      startedAt: open.started_at,
      endsAt: open.ends_at,
      remainingSeconds: Math.max(0, Math.round((new Date(open.ends_at).getTime() - new Date(now).getTime()) / 1000)),
    }
    : null;
  return {
    break: open
      ? {
        breakId: open.id,
        cueIndex: Number(open.cue_index),
        seconds: Number(open.seconds),
        startedAt: open.started_at,
        endsAt: open.ends_at,
      }
      : null,
    coverageUntil: until,
    entry,
    stop,
    breaksRun: breaks.length,
  };
}
