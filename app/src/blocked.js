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
    offersUnlock: true,
  },
  {
    key: 'notice',
    from: 1,
    headline: 'The ad did not finish',
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
