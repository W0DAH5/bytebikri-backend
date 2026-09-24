/**
 * How much an unlock asks for, and why that number is not the seller's to invent.
 *
 * The product shipped with two number boxes: "Ads to unlock" (1–5) and "Minimum
 * ad length" (5–120 seconds). A seller who has never bought an ad in their life
 * was being asked to price their own audience, with no information, in two
 * fields, on every file. Whatever they typed became the ask.
 *
 * This module replaces the boxes with one decision the seller can actually make —
 * "ask the standard rate for what this file is worth, or ask the minimum" — and
 * derives the numbers from the one thing on the page that means anything: the value
 * the seller has declared for the file (`assets.declared_value_npr` — a statement of
 * worth, deliberately NOT a price: migration 0004 removed the price column and
 * nothing here puts one back).
 *
 * ── THE RESEARCHED RULES ───────────────────────────────────────────────────
 * Sources are in `AD_ECONOMY.md`; the conclusions that became constraints here:
 *
 *   1. FEWER, SHORTER ADS EARN MORE PER PERSON. Nielsen, across 18,400 campaigns:
 *      rewarded views under 15 s complete at 79.4%, views of 30 s or more at
 *      51.8%. A completion is the only thing a network pays for. Two ads that
 *      both finish beat three where one is abandoned — and the person is less
 *      annoyed, which is the part that compounds.
 *   2. 15–30 SECONDS IS THE OPTIMUM, 60 IS THE CEILING. 15–20 s now outperforms
 *      30 s in completion; 30 s is the mobile ceiling for rewarded video; the
 *      resentment in 2026 is aimed squarely at 90-second unskippable units. This
 *      platform will not ask for one, ever, at any price: `ASK_ABSOLUTE.seconds`.
 *   3. THE ASK MUST SCALE WITH THE PERCEIVED VALUE OF THE FILE, NOT ITS SIZE.
 *      A file priced at NPR 25,000 asks for more than one priced at NPR 50 —
 *      that part is obvious. What is not obvious is that it must not scale
 *      LINEARLY: a 60-second ask on a NPR 500 file is a wall, and a wall is
 *      where people leave. The bands below double roughly every other step and
 *      then stop. The top band is 3 ads of 60 seconds, which is the most this
 *      platform will ever ask a stranger for: three minutes, in total, after
 *      which they keep the file.
 *   4. THE CEILING IS A PROMISE, SO IT IS ABSOLUTE — AND THE PLAN IS WHAT MAKES
 *      IT USABLE. `ASK_ABSOLUTE` is the same sentence on every page: no file on
 *      ByteBikri asks for more than 3 ads, more than 60 seconds each, or more
 *      than 3 minutes in total. A store's plan decides how much of that promise
 *      it may use (Free asks at most 1×30, Store 2×45, Pro the full 3×60), which
 *      is the same shape as every other capability on this platform: the paid
 *      plan widens what a store may do, the platform's limits protect the person
 *      on the other side of the door, and no plan can cross them.
 *
 * ── WHY THE SELLER CANNOT TYPE A NUMBER ────────────────────────────────────
 * Because the number is a claim about somebody else's attention, and the party
 * with the least information about what a stranger will tolerate was the only
 * one setting it. The seller's real freedom is preserved where it matters: they
 * can always ask LESS (`level: 'light'`), and they set the file's value, which is
 * the input the whole ladder is built on.
 *
 * Pure module. No database, no clock, no randomness — so the seller's page, the
 * buyer's unlock panel and the tests all read the same table.
 */

/** The least this platform will ask for, and the floor a network will credit. */
export const ASK_FLOOR = { ads: 1, seconds: 15 };

/**
 * The absolute ceiling. Not a plan capability — a promise to the person watching.
 * No capability row, no migration and no seller may move these numbers.
 */
export const ASK_ABSOLUTE = { ads: 3, seconds: 60, totalSeconds: 180 };

/**
 * The value ladder. `upTo` is an inclusive upper bound in NPR; the last band has
 * no bound. `why` is printed to the seller and to nobody else — it is the reason
 * the number is what it is, and hiding it is how a product ends up with sellers
 * who think the number is random.
 */
export const ASK_BANDS = [
  {
    key: 'gift', label: 'Free', upTo: 0, ads: 1, seconds: 15,
    why: 'A free file asks for the least the platform allows — one short view.',
  },
  {
    key: 'small', label: 'Under NPR 200', upTo: 199, ads: 1, seconds: 20,
    why: 'One view, twenty seconds. The completion rate at this length is the highest there is.',
  },
  {
    key: 'medium', label: 'Under NPR 600', upTo: 599, ads: 1, seconds: 30,
    why: 'One view at the length rewarded video is built around. Still one interruption.',
  },
  {
    key: 'large', label: 'Under NPR 1,500', upTo: 1499, ads: 2, seconds: 30,
    why: 'Two views. A second interruption is where the step up begins, and each view stays short.',
  },
  {
    key: 'premium', label: 'Under NPR 4,000', upTo: 3999, ads: 2, seconds: 45,
    why: 'Two views, slightly longer. Forty-five seconds still completes far more often than sixty.',
  },
  {
    key: 'high', label: 'Under NPR 10,000', upTo: 9999, ads: 3, seconds: 45,
    why: 'Three views. This is the last band where the number of interruptions rises.',
  },
  {
    key: 'top', label: 'NPR 10,000 and up', upTo: Infinity, ads: 3, seconds: 60,
    why: 'The ceiling: three views of a minute, three minutes in total, and then the file is theirs.',
  },
];

/**
 * What each plan may ask. Keyed by plan code, and mirrored in
 * `plans.capabilities.ad_ask_max_ads` / `ad_ask_max_seconds` so the pricing table
 * and the running app cannot disagree (`billing.js planDrift` checks both).
 *
 * Free is not zero: a free store still earns, it just cannot stretch the ask.
 */
export const ASK_CEILING = {
  free: { ads: 1, seconds: 30 },
  store: { ads: 2, seconds: 45 },
  pro: { ads: 3, seconds: 60 },
};

/** The two asks a seller may choose between. There is deliberately no third. */
export const ASK_LEVELS = [
  {
    key: 'standard',
    label: 'Ask the standard rate for this value',
    hint: 'What a file at this price normally asks for. The recommendation, and the one that earns most per visitor.',
  },
  {
    key: 'light',
    label: 'Ask the minimum instead',
    hint: `One view of ${ASK_FLOOR.seconds} seconds, whatever the file is worth. Best completion, lowest earnings, kindest to your visitors.`,
  },
];

const ceil = (v) => Math.max(0, Math.ceil(Number(v) || 0));

/** The band a declared value falls in. A file with no price is a gift. */
export function bandFor(valueNpr) {
  const price = ceil(valueNpr);
  return ASK_BANDS.find((b) => price <= b.upTo) ?? ASK_BANDS[ASK_BANDS.length - 1];
}

export function ceilingFor(planCode) {
  return ASK_CEILING[String(planCode || 'free')] ?? ASK_CEILING.free;
}

/**
 * The ask for one file, given what it is worth and what its store's plan allows.
 *
 * @returns {{ads:number, seconds:number, level:string, band:object, capped:boolean,
 *            ceiling:object, totalSeconds:number}}
 */
export function resolveAsk({ valueNpr = 0, planCode = 'free', level = 'standard' } = {}) {
  const band = bandFor(valueNpr);
  const ceiling = ceilingFor(planCode);
  const wantsMin = String(level) === 'light';

  // The plan's ceiling and the absolute promise are both applied, and the tighter
  // one wins. `ASK_ABSOLUTE` is checked even though every entry of ASK_CEILING is
  // inside it, because a future capability row is exactly the kind of change that
  // would quietly walk a number past the sentence on the page.
  const maxAds = Math.min(ceiling.ads, ASK_ABSOLUTE.ads);
  const maxSeconds = Math.min(ceiling.seconds, ASK_ABSOLUTE.seconds);

  const wanted = wantsMin ? ASK_FLOOR : { ads: band.ads, seconds: band.seconds };
  const ads = Math.min(Math.max(ASK_FLOOR.ads, wanted.ads), maxAds);
  const seconds = Math.min(Math.max(ASK_FLOOR.seconds, wanted.seconds), maxSeconds);

  return {
    ads,
    seconds,
    level: wantsMin ? 'light' : 'standard',
    band,
    // True when the plan, not the file's value, decided the number. The seller's
    // page says so: it is the honest version of an upsell.
    capped: ads < wanted.ads || seconds < wanted.seconds,
    ceiling: { ads: maxAds, seconds: maxSeconds },
    totalSeconds: ads * seconds,
  };
}

/** "2 ads of 30 seconds" — one phrasing, used by every surface. */
export function askLabel(ask) {
  if (!ask) return 'one short ad';
  const { ads, seconds } = ask;
  return `${ads === 1 ? '1 ad' : `${ads} ads`} of ${seconds} seconds`;
}

/**
 * An ad count a seller's own description promises, if it promises one.
 *
 * The description is free text and the ask is derived, so the two can disagree
 * without anything noticing: the demo file shipped with "Unlock with one ad" in
 * its description, and the moment its value moved it into a two-view band the
 * page said two things at once — the seller's sentence above the button's. The
 * platform cannot police prose, so this does not edit it or block a save. It
 * reads the ONE claim that has a number in it and lets the seller's own page say
 * that the number has moved.
 *
 * Deliberately narrow: a digit or a number word immediately followed by "ad" or
 * "ads". "No ads", "ads are", "ad-free" and prose about advertising in general
 * are all left alone — a false warning on a seller's page teaches them to ignore
 * the true ones.
 */
const AD_COUNT_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };

export function descriptionAskClaim(text) {
  const match = /\b(no|\d{1,2}|one|two|three|four|five|six)\s+ads?\b/i.exec(String(text || ''));
  if (!match) return null;
  const word = match[1].toLowerCase();
  if (word === 'no') return 0; // "no ads" is a real claim, and about a free file it is right
  return AD_COUNT_WORDS[word] ?? Number(word);
}

/** The buyer's sentence, with the file's value in it. */
export function askSentence(ask) {
  if (!ask) return '';
  return `This file asks for ${askLabel(ask)} of your time${ask.level === 'light' ? ' — its seller chose the minimum' : ''}.`;
}

/**
 * The seller's answer to "why that number". Printed under the picker, and it is
 * the only reason the seller is given for a number they did not choose.
 */
export function askReason({ valueNpr = 0, planCode = 'free', level = 'standard' } = {}) {
  const ask = resolveAsk({ valueNpr, planCode, level });
  const price = ceil(valueNpr);
  const value = price > 0 ? `NPR ${price.toLocaleString('en-IN')}` : null;
  if (ask.level === 'light') {
    return `You are asking the minimum: ${askLabel(ask)}. Every visitor sees one short view, whatever the file is worth.`;
  }
  // The band's label is used as written — lowercasing it turned "Under NPR 200"
  // into "under npr 200" on the seller's page, and a currency code is not a word.
  const base = value
    ? `A file valued at ${value} sits in the band “${ask.band.label}”: ${askLabel(ask)}. ${ask.band.why}`
    : `No value set, so this file sits in the lowest band, “${ask.band.label}”: ${askLabel(ask)}. ${ask.band.why}`;
  if (!ask.capped) return base;
  return `${base} Your plan asks at most ${ask.ceiling.ads} ${ask.ceiling.ads === 1 ? 'ad' : 'ads'} of `
    + `${ask.ceiling.seconds} seconds, so this file asks ${askLabel(ask)} until you move up a plan.`;
}

/**
 * The platform's promise, as a sentence on a page. Every clause is checked
 * against `ASK_ABSOLUTE` in test/adscale.test.js, so the sentence and the code
 * cannot drift.
 */
export const ASK_PROMISE =
  `No file here asks for more than ${ASK_ABSOLUTE.ads} ads, more than ${ASK_ABSOLUTE.seconds} seconds `
  + `each, or more than ${ASK_ABSOLUTE.totalSeconds / 60} minutes in total. Longer asks earn less: `
  + 'short rewarded views are the ones people finish, and a finished view is the only one a network pays for.';

/**
 * The line a seller reads where the numbers used to be typed. It says the ask is
 * derived, names the input, and hands back the only lever they have.
 */
export const ASK_INPUT_LINE =
  // "value", not "price": the field directly above says in as many words that this is
  // not a price, and the first cut of this line called it one — the panel contradicting
  // itself two lines apart, on the screen that explains the rule. A browser pass caught
  // it; the sentence and the field label now use the same word.
  'What a file asks for is set by what you say it is worth and by your plan, not typed in by hand — '
  + 'you set the value, and this page shows what that means for the person watching.';
