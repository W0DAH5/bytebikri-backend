/**
 * What happens when the ad does not arrive.
 *
 * Roughly a third of the web blocks ads in some form, and one careful 2026 study
 * (Ad-Shield's dark-traffic research, via AdMonsters) found that 79% of that
 * blocking is undetectable — 976 million people whose requests never reach an ad
 * server, with no fingerprint, no script and nothing to detect. The same study
 * found the industry's answer is an anti-adblock wall on about a third of sites,
 * and that those walls reach at most the 21% still running a soft blocker.
 *
 * That arithmetic is why this module starts polite and stays honest:
 *
 *   * DETECTION IS NOT A CONTROL, so nothing here is allowed to depend on it. The
 *     platform cannot reliably tell Brave from a bad connection from an ad network
 *     having a bad morning, and it does not pretend to. There is no user-agent
 *     check in this codebase and there will not be one.
 *   * THE AD-BLOCKER WALL ALREADY EXISTS, BY CONSTRUCTION. A rewarded file is
 *     handed over when a network's signed postback arrives. No postback, no file —
 *     that is the pipeline working, not a punishment, and no rung below invents a
 *     new restriction. What the ladder adds is an EXPLANATION, at the point where
 *     the silence was previously total.
 *   * THE HARSH END IS WITHHOLDING THE FILE, NEVER THE PAGE. Hiding the store,
 *     blanking the listing, or a full-page interstitial is how a publisher loses
 *     the reader for good, and the researched complaints are all about exactly
 *     that: pages that block themselves before they show whether they were worth
 *     it. The listing, the description and every `open` file stay; one file's
 *     unlock stops being offered.
 *   * NOBODY IS ACCUSED. Every rung is phrased about the VIEW ("the ad did not
 *     confirm"), never about the person ("your blocker"). An innocent visitor on a
 *     flaky mobile connection reads the same sentences and is owed the same
 *     courtesy.
 *
 * And the ladder fails open. Attempts age out (SIGNAL_WINDOW_HOURS), and a store's
 * membership route and every open file work at every rung — including the last.
 * The point is to be understood, not to win.
 */

/** How long an attempt counts for. After this, the page starts fresh. */
export const SIGNAL_WINDOW_HOURS = 6;

/**
 * Signals, in the order of how much they mean.
 *
 * `declined` is deliberately NOT a blocker signal: a person who closes an ad has
 * made a choice about their own time, and treating that as evasion would be both
 * wrong and the exact behaviour that turns a good-faith visitor into an angry one.
 */
export const SIGNALS = ['script_blocked', 'no_postback', 'declined', 'unknown'];

/** The ones that climb the ladder. `declined` is not among them. */
export const BLOCKING_SIGNALS = ['script_blocked', 'no_postback', 'unknown'];

/**
 * The rungs. `from` is the number of blocking attempts in the window at which this
 * answer applies — derived from a count, never from a profile field someone has to
 * maintain, so there is no state to get stuck in.
 */
export const LADDER = [
  {
    key: 'quiet',
    from: 0,
    headline: null,
    body: null,
    // A break's own tail, for the two surfaces that ask INSIDE a player rather than at
    // a door (§14.7). Null where the door's copy needs no translation and there is
    // nothing to say yet — a person who has done nothing is told nothing there either.
    player: null,
    reader: null,
    offersUnlock: true,
  },
  {
    key: 'notice',
    from: 1,
    headline: 'The ad did not finish',
    // Inside a player the same fact is not "nothing was unlocked" — the file or the
    // stream kept playing, which is the whole difference between a door and a break. What
    // did not happen is the credit, and the break's own store is who it was for.
    player: 'That break credited nobody — the view did not confirm. Nothing was taken from you, and the '
      + 'next break will ask again. Most of the time it is an ad blocker, a lost connection, or the '
      + 'network having a slow minute.',
    reader: 'That view did not confirm, so the next page is not open yet. Nothing was taken from you — '
      + 'the page in front of you is yours, and turning back to the file and in again is the same gate. '
      + 'Most of the time it is an ad blocker, a lost connection, or the network having a slow minute.',
    body:
      'No view was confirmed, so nothing was unlocked — that is how this works rather than a decision '
      + 'about you. Most of the time it is one of three things: an ad blocker, a lost connection, or the '
      + 'network having a slow minute. Try again, and if you use a blocker, allow ads for this page.',
    offersUnlock: true,
  },
  {
    key: 'explained',
    from: 3,
    headline: 'We cannot unlock this one without the view',
    player: 'Three breaks in a row have produced no confirmed view. The ad inside a break is what pays the '
      + 'store that called it, and ByteBikri never sees that money. If a blocker is on, allowing ads for '
      + 'this page is what fixes it.',
    reader: 'Three views in a row have not confirmed, so the page behind this seam is still shut. The ad '
      + 'is what pays the person who drew these pages, and ByteBikri never sees that money. If a blocker '
      + 'is on, allowing ads for this page is what fixes it.',
    body:
      'This file is unlocked by an ad, and the ad pays the person who made it — ByteBikri never sees that '
      + 'money and cannot hand the file over without it. If your blocker is on, that is why. Two honest '
      + 'ways forward: allow ads for this page, or join the store — the dues go straight to the creator '
      + 'and open the files that are set to members only. Membership does not open this ad-gated file '
      + 'sooner, and nobody here will tell you otherwise.',
    offersUnlock: true,
  },
  {
    key: 'withheld',
    from: 6,
    headline: 'This file is not being offered for a while',
    // The harsh end, on the surfaces that cannot be withheld. The OFFER goes, and that is
    // all: the modal does not open, the player is not stopped, and nothing about the
    // person changes. A file that stopped for this would take a viewer's attention for an
    // ad that has failed six times, and a live one would punish the store's whole audience
    // for one viewer's arithmetic — the mistake §14.2 exists to refuse.
    player: 'This file is not asking you for a view for a while — six breaks with no confirmed view is not '
      + 'worth a seventh. Nothing else changes: the file plays, the stream plays, and it passes on its own.',
    // A reader is the one surface where the ask is not a pause: the seam is the only way
    // to the pages behind it, so a withheld ask there has to say what it costs and who is
    // holding what. It does NOT borrow the player's tail — "it passes on its own" is a
    // promise a shut seam cannot keep, and the walk on this surface caught the panel
    // printing exactly that sentence.
    reader: 'This file is not asking you for a view for a while — six breaks with no confirmed view is not '
      + 'worth a seventh. The pages behind the seam wait with the ask rather than being taken away: the '
      + 'offer comes back on its own, and nothing has been taken from your account.',
    body:
      'Six attempts in a few hours have not produced a single confirmed view, so the unlock is paused here '
      + 'rather than being offered again and failing again. Everything else still works: the file stays '
      + 'listed, its description and preview stay readable, and any file that is open on this store still '
      + 'opens. Come back later and it resets on its own — nothing has been taken from your account.',
    offersUnlock: false,
  },
];

/**
 * Which rung a count of blocking attempts is on.
 *
 * Pure arithmetic on a count of rows in the last `SIGNAL_WINDOW_HOURS`, so there is
 * no per-person flag that can be wrong, and a person who fixes their blocker is
 * back to the first rung after the window passes without asking anybody.
 */
export function rungFor(attempts = 0) {
  const n = Math.max(0, Number(attempts) || 0);
  let out = LADDER[0];
  for (const rung of LADDER) if (n >= rung.from) out = rung;
  return out;
}

/**
 * What a BREAK's tail is at this rung, in the rung's own words.
 *
 * The door's copy and a break's copy are different promises about the same fact — nothing
 * was unlocked, versus the file kept playing and only the credit is missing — so the two
 * live in one table and this is the one reader of the in-player half. `null` means there is
 * nothing to add: the first rung, and any rung a caller invents.
 */
export function playerWords(rung) {
  return rung?.player ?? null;
}

/**
 * The same rung, said to a reader.
 *
 * A separate tail rather than the player's, because the two surfaces do not lose the same
 * thing: a withheld cue on a player is passed over and the file plays on, while a withheld
 * ask at a reader's seam leaves the pages behind it shut for as long as the rung lasts. A
 * rung the module does not know has no reader tail, and neither does one written before
 * this tail existed — the fallback is the player's, which is true for the rungs where the
 * two say the same thing and never reached the withheld one.
 */
export function readerWords(rung) {
  return rung?.reader ?? rung?.player ?? null;
}

/** The signal a failed attempt should be recorded as, from what the client saw. */
export function signalFrom(state = null) {
  const s = String(state || '');
  if (s === 'script_blocked' || s === 'no_postback' || s === 'declined') return s;
  return 'unknown';
}

/**
 * What the platform refuses to do, printed next to the ladder on the seller's page.
 *
 * Each line names the anti-pattern it declines, because the value of a refusal is
 * in being able to check it later. The NYU measurement (PETS 2025) belongs here:
 * users on Acceptable-Ads allowlists met 13.6% MORE intrusive ads than the general
 * population, so "detect and escalate" lands hardest on the people who were
 * compromising in good faith.
 */
export const NEVER_DO = [
  'No full-page interstitial, no countdown before the page, no blanked store. The listing, the description and every open file render at every rung.',
  'No browser or user-agent targeting. Brave is not detectable reliably, reader mode is not detectable at all, and a wall around a guess punishes the wrong people.',
  'No accusation in the copy. The subject of every sentence is the missing view, never the visitor\'s software.',
  'No "please disable your ad blocker" modal in the middle of reading. The one prompt is inside the unlock panel, where the person has already asked to unlock something.',
  'No penalty on the account, no hidden counter, no effect on ranking — a blocked attempt is evidence about a request, not a mark on a person.',
];

/** The seller's version of the same fact: what this costs, stated as a count. */
export function blockedSellerNote(count = 0, hours = SIGNAL_WINDOW_HOURS) {
  const n = Math.max(0, Number(count) || 0);
  if (!n) return `No unlock attempt has failed to confirm in the last ${hours} hours.`;
  return `${n} unlock ${n === 1 ? 'attempt' : 'attempts'} in the last ${hours} hours produced no confirmed view — `
    + 'a blocker, a dropped connection, or a network that did not call back. The platform does not guess which, '
    + 'and it does not penalise the person.';
}

export { blockedSellerNote as default };
