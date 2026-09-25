/**
 * ByteBikri Plus — what a PERSON buys from the platform, and the two things it is
 * not allowed to be.
 *
 * There are three premium concepts in this product and they are deliberately
 * different things:
 *
 *   1. A STORE plan (NPR 999/2,499 a year) — buys capabilities for a shop.
 *   2. A MEMBERSHIP (dues the member pays the creator, directly) — buys access to
 *      that creator's files. bytebikri is not a party and takes nothing.
 *   3. THIS — a person pays the platform for how they appear. It opens nothing,
 *      and it removes nothing.
 *
 * ── WHAT IT IS NOT ─────────────────────────────────────────────────────────
 * It is not an ad-free tier, and that is a deliberate, researched refusal.
 *
 *   * It would break leg 1 of the revenue model. The networks pay the STORE's own
 *     account; a platform that sells "no ads" is selling something that belongs to
 *     somebody else, and the store would be the one paying for it. `slots.js` has
 *     carried `releasedBy: 'ad_free'` as an unread hook since the beginning, and it
 *     stays unread.
 *   * It would punish the creators who make the platform worth being on. The
 *     clearest lesson in the 2026 sentiment record is that "cosmetics instead of
 *     ads" survives as a defence of a paid tier while "pay to skip the ads the
 *     creator is paid by" does not.
 *   * It would be a promise the platform cannot keep. Youtube Premium is defending
 *     two class actions over the words "ad-free" (California; a BC filing on
 *     2026-08-21), and Disney+ rewrote its terms in the same period and lost
 *     subscribers for it. Every line of copy in this module says "fewer
 *     interruptions" or says nothing at all — never "no ads".
 *
 * ── WHAT IT IS ─────────────────────────────────────────────────────────────
 * A name that looks better: a palette, an edge, a slow halo. Discord's own
 * published advice is the rule this follows — one or two effects or nothing stands
 * out — and its own shop is the pricing lesson: the backlash was never against
 * cosmetics, it was against cosmetics sold ON TOP of a subscription already paid
 * for ("should be free with Nitro", "$2–3", "$1 max"). So there is ONE plan, every
 * effect is INSIDE it, and nothing cosmetic is ever charged for a second time.
 *
 * Two consequences that are structural rather than stylistic:
 *   * `opens_content` and `removes_ads` are in the plan's capabilities, both
 *     `false`, and `test/plus.test.js` asserts they stay false. A cosmetic that
 *     could open a file would be a hole in every creator's paywall at once.
 *   * Motion is opt-in at the layer that renders it (the stylesheet), never a
 *     property of the effect itself: an effect is a look, and a person whose
 *     system asks for less motion gets the same look, still.
 *
 * Pure module: no database, no clock of its own. The database decides whether a
 * subscription is active; this module decides what an active one looks like.
 */

import { ACCENTS, ACCENT_KEYS } from './memberships.js';

export const PLUS_CODE = 'plus';

/** The plan's own name, spelled once. */
export const PLUS_NAME = 'ByteBikri Plus';

/**
 * The effects on a name — six of them, one of them the absence of an effect.
 *
 * `solid` is the default, because the safest version of a cosmetic feature is the
 * one that looks like the product did before you paid for it. The other five are
 * the researched vocabulary: Discord ships seven display-name styles (solid,
 * gradient, neon, toon, pop, gummy, prism) and its nameplates animate **on hover**,
 * which is the pattern every effect here follows — a look at rest, motion on
 * intent.
 *
 * `moves` is not decoration. It is read by the picker's own sentence and by the
 * test that keeps the hints honest: a person with a vestibular reason to avoid
 * animation has to be able to tell WHICH choices move before choosing, and the
 * answer has to stay true when somebody adds a seventh effect.
 *
 * Every hint is written for that person: what it looks like, whether it moves, and
 * that a system asking for less motion still gets the look.
 */
export const EFFECTS = {
  solid: {
    key: 'solid',
    label: 'Plain',
    moves: false,
    hint: 'Your name in your palette, nothing else. The version that looks right everywhere, and the one to pick if you would rather nothing of yours moved.',
  },
  edge: {
    key: 'edge',
    label: 'Edge',
    moves: false,
    hint: 'A thin gradient rule under your name, in your palette. Completely still — it never moves, on any device.',
  },
  halo: {
    key: 'halo',
    label: 'Halo',
    moves: true,
    hint: 'A slow glow behind your name that breathes in your palette. It drifts only while you are hovering over it, and a system that asks for less motion gets the glow, still.',
  },
  gradient: {
    key: 'gradient',
    label: 'Gradient',
    moves: true,
    hint: 'Your name itself painted in your palette’s two colours, drifting slowly across the letters while you hover. Every browser falls back to the painted name if it cannot animate it.',
  },
  neon: {
    key: 'neon',
    label: 'Neon',
    moves: true,
    hint: 'Lit ink: your name in your palette with a bloom around it, breathing gently while you hover. The most visible effect in a dark page, and the quietest in a bright one.',
  },
  prism: {
    key: 'prism',
    label: 'Prism',
    moves: true,
    hint: 'A band of your palette’s colours travelling around the letters — the grandest of the six, and the one to avoid if movement is uncomfortable. Static, it is a two-tone name.',
  },
};

export const EFFECT_KEYS = Object.keys(EFFECTS);

export function effectOf(key) {
  return EFFECTS[key] ?? EFFECTS.solid;
}

/** The palettes a member may wear, reusing the plates the memberships shipped. */
export const PLATE_KEYS = ACCENT_KEYS;
export function plateOf(key) {
  return ACCENTS[key] ?? ACCENTS.indigo;
}

/**
 * Where a person is in the arrangement, derived — like every other clock in this
 * codebase — rather than stored as a status somebody has to remember to update.
 *
 * `period_end < now()` IS the lapse. There is no sweep job to fail, and nothing to
 * get out of sync.
 */
/**
 * The join that answers "is this person's arrangement active right now" in SQL.
 *
 * One copy, in the leaf module, because THREE readers need the same answer:
 * `store.userById`, the session resolver in `auth.js` (so `req.user` carries it on
 * every page), and the roster and review queries that dress a name. The period end
 * is part of the entitlement rather than a separate sweep: a month that has run out
 * is not an active arrangement, and a query that forgot the comparison would dress
 * somebody who stopped paying weeks ago.
 */
export const PLUS_SUBSCRIPTION_JOIN = `left join lateral (
         select cs.status as plus_status, cs.period_end as plus_period_end
           from customer_subscriptions cs
          where cs.profile_id = p.id
            and cs.status = 'active'
            and cs.period_end > now()
          limit 1
       ) pl on true`;

export function plusState({ status = null, period_end = null } = {}) {
  if (!status || status === 'cancelled') return status === 'cancelled' ? 'cancelled' : 'none';
  if (status === 'pending_payment') return 'pending';
  if (status !== 'active') return 'none';
  const end = period_end ? new Date(period_end) : null;
  if (!end || Number.isNaN(end.getTime())) return 'none';
  return end.getTime() > Date.now() ? 'active' : 'lapsed';
}

/**
 * What a row wears, or nothing.
 *
 * The single gate between "a person chose this" and "a page shows it", and the
 * reason a lapse needs no cleanup: a profile keeps its palette and its effect
 * forever (a preference is not deleted because a month ended) and stops WEARING
 * them the moment the subscription stops being active.
 *
 * @returns {{plate:string, effect:string, effects:object}|null}
 */
export function plusWear(row = null) {
  if (!row) return null;
  // Two shapes are accepted: a profile row joined with its subscription
  // (`plus_status`, `plus_period_end`) and an already-decided boolean. Both are
  // read here rather than at four call sites, so a page cannot be the one that
  // forgets to check.
  const active = row.plus_active === true
    || plusState({ status: row.plus_status ?? row.status, period_end: row.plus_period_end ?? row.period_end }) === 'active';
  if (!active) return null;
  if (!row.nameplate && !row.plus_effect) return null;
  const effect = effectOf(row.plus_effect).key;
  return {
    plate: ACCENTS[row.nameplate] ? row.nameplate : 'indigo',
    effect,
    effects: EFFECTS,
  };
}

/**
 * The OWNERSHIP LINE, one per layer, because this is the mistake the whole document
 * exists to prevent: a page reading "the plate next to a name is the perk" while the
 * plate could have come from either of two unrelated payers.
 */
export const WEAR_OWNER_LINE =
  'Your look is yours: a palette, an effect and the ring on your avatar, from bytebikri, worn on every page — '
  + 'in a creator’s store and everywhere else. It is not a store’s gift and no creator can change it.';

export const CHIP_OWNER_LINE =
  'The chip beside a member’s name is the STORE’s own colour for the tier that member holds. The creator chose '
  + 'it, it appears only on that store’s pages, and it is the one thing here that bytebikri does not sell to anybody.';

/**
 * Both layers on one name, decided in one place.
 *
 * THE BUG THIS REPLACES, because it is worth remembering: the roster used to render
 * a Plus member's name INSTEAD of the store's tier mark, so a store's own member
 * list lost the creator's chip the moment that member happened to have bought
 * something from bytebikri. Two unrelated payers were deciding one element and the
 * wrong one won.
 *
 * The rule now: the name is the person's (layer P), the chip is the store's
 * (layer S), and both render, always. A creator cannot grant wear and a wearer
 * cannot stand in for a tier.
 *
 * @param {{plus?: object|null, tier?: object|null}} input
 *   `plus` is the row `plusWear()` reads (or null); `tier` is the membership tier
 *   the person holds in THIS store, or null when they hold none.
 */
export function composeName({ plus = null, tier = null } = {}) {
  const wear = plusWear(plus);
  const name = wear
    ? { effect: wear.effect, palette: wear.plate, className: wearClass(wear.effect) }
    : null;
  const tierNo = Number(tier?.tier_no) || 0;
  const chip = tierNo
    ? {
      label: String(tier.name ?? '').trim() || (tierNo === 2 ? 'Elite' : 'Member'),
      palette: ACCENTS[tier.accent] ? tier.accent : 'indigo',
      // The tier's own rank decides how the chip is drawn — the top tier glints and
      // the entry tier does not, which is the platform's advice borrowed from how
      // Discord deploys gradient role styles: one or two, or nothing stands out.
      style: tierNo === 2 ? 'gradient' : 'solid',
    }
    : null;
  return { name, chip };
}

/**
 * The class an effect wears, in one map.
 *
 * It was a chain of `if`s on the effect key in the view layer, which meant a new
 * effect shipped as a name that rendered with no styling at all and no test could
 * see it. Here, an unknown key has no class and therefore renders as plain — the
 * same graceful answer `effectOf()` gives.
 */
export const WEAR_CLASS = {
  solid: null,
  edge: 'wear-edge',
  halo: 'wear-halo',
  gradient: 'wear-gradient',
  neon: 'wear-neon',
  prism: 'wear-prism',
};

export function wearClass(effectKey) {
  return WEAR_CLASS[effectOf(effectKey).key] ?? null;
}

/**
 * How much of a palette's ink survives the mix toward white (dark theme) or black
 * (light theme) when a name is PAINTED rather than inked.
 *
 * Both directions raise contrast against their own background, so one share per
 * theme is enough — and both numbers are also written into the stylesheet, which
 * cannot import this file. `test/wear.test.js` reads the stylesheet and refuses to
 * let the two drift, because a percentage edited in CSS is precisely the change no
 * other test would notice.
 */
export const EFFECT_MIX_SHARE = { dark: 0.62, light: 0.55 };

/** Every class this module can emit, for the test that checks each has a rule. */
export const WEAR_CLASSES = Object.values(WEAR_CLASS).filter(Boolean);

/** Days left on an arrangement, or null. Used by the member's own card. */
export function plusDaysLeft({ period_end = null } = {}) {
  if (!period_end) return null;
  const end = new Date(period_end);
  if (Number.isNaN(end.getTime())) return null;
  return Math.max(0, Math.ceil((end.getTime() - Date.now()) / 86400000));
}

/**
 * The honest list of what the money does NOT buy, printed on the page that takes
 * it. This is the paragraph the researched record says to write first: the
 * complaint that damages a cosmetics tier is never "it costs money", it is "I
 * thought it would also do X".
 */
export const PLUS_NOT = [
  'It does not remove ads. The ads on a store\'s page are paid to that store by the ad network, and bytebikri cannot give away what a creator earns.',
  'It does not open files. A file opens by an ad, by membership, or by nothing — never by paying us.',
  'It does not move you up any list. The ranking code does not read it, and a store\'s own roster does not order by it.',
  'It does not change what a store sees about you. A seller learns that you are a member of their store the way they always did, by confirming your dues.',
];

/** The other direction, in one line, for anyone who arrives from a store page. */
export const PLUS_SEPARATION_LINE =
  'A store plan and this are different things. A store pays bytebikri for what its shop can do; this pays '
  + 'bytebikri for how your name looks. Neither one touches what you pay a creator, or what a creator earns.';

/** The single line about the money, on every surface that asks for it. */
export function plusMoneyLine(price = 149, months = 1) {
  const period = Number(months) === 1 ? 'a month' : `every ${Number(months)} months`;
  return `NPR ${Number(price).toLocaleString('en-IN')} ${period}, paid to bytebikri. Your store memberships are `
    + 'untouched by this: dues still go straight to the creator, and we still take none of them.';
}

/** Rows for the console, so the platform's own revenue is visible in one place. */
export function plusConsoleRows({ active = 0, pending = 0, paidThisMonth = 0, price = 0 } = {}) {
  return [
    { term: 'Price', text: `NPR ${Number(price).toLocaleString('en-IN')} a month, charged by bytebikri` },
    { term: 'Arrangements', text: `${active} active, ${pending} waiting for a reference to be checked` },
    { term: 'Received this month', text: `NPR ${Number(paidThisMonth).toLocaleString('en-IN')} matched against the platform's own statement` },
  ];
}

/** The date a claim is set for, when an operator matches it. */
export function plusPeriodEnd(from, months) {
  const start = new Date(from);
  const end = new Date(start);
  end.setMonth(end.getMonth() + Math.max(1, Number(months) || 1));
  return end;
}
