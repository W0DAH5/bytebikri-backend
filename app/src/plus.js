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

import { randomInt } from 'node:crypto';

import { ACCENTS, ACCENT_KEYS, glyphOf } from './memberships.js';
// The product's one clock: `longDay` reads on the shop's timezone (Asia/Kathmandu) in
// the same format every other date in this app uses. A second date formatter is how a
// badge ends up a day out from the invoice beside it.
import { longDay } from './dates.js';

export const PLUS_CODE = 'plus';

/**
 * The second period, and the ONLY difference between the two plans.
 *
 * A year is the monthly plan with a twelve-month period at ten months' price
 * (migration 0042), and the key lives here beside the monthly one for a reason that
 * has bitten this codebase before: a plan code spelled in one file and read in another
 * is a page that 500s the first time somebody mistypes it, and no unit test sees it
 * because the view is rendered directly. Both keys are exported, both are asserted
 * against the `customer_plans` table in `plus.test.js`, and the routes read them
 * rather than typing them.
 */
export const PLUS_YEAR_CODE = 'plus-year';

/** The periods a person may buy, in the order they are offered. */
export const PURCHASABLE_PLAN_CODES = [PLUS_CODE, PLUS_YEAR_CODE];

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

/**
 * THE RING — what the initial is ringed with.
 *
 * A look has always carried a ring: a flat ring in the palette, with a slow conic sweep
 * on hover. It was not a choice, because a look was one thing. It is a slot now, which
 * is what the cosmetics review called the avatar frame, in the only form this product
 * can honestly have it — the avatar here is an initial, not an upload.
 *
 * `none` is a real choice and it is not the same as not choosing: a person who wants
 * nothing around their initial gets nothing, while a row that has never been near the
 * picker keeps the ring every look has always had (`ringClass(null)`). Taking a ring
 * AWAY because somebody never opened a form would be the product inventing a change.
 */
export const RINGS = {
  none: {
    key: 'none',
    label: 'No ring',
    moves: false,
    hint: 'The initial with nothing around it. The quietest option, and the one to pick if a ring on your own card reads as fuss.',
  },
  hairline: {
    key: 'hairline',
    label: 'Hairline',
    moves: false,
    hint: 'A flat ring in your palette, two pixels wide. Completely still, on every device.',
  },
  beaded: {
    key: 'beaded',
    label: 'Beaded',
    moves: false,
    hint: 'The same ring drawn as a line of dots instead of a line. Texture rather than colour, so it reads on a small avatar where a width difference does not.',
  },
  orbit: {
    key: 'orbit',
    label: 'Orbit',
    moves: true,
    hint: 'The same ring, with a slow sweep of your palette turning around it while you hover over your own card. Still, for anyone whose device asks for less motion.',
  },
  split: {
    key: 'split',
    label: 'Split',
    moves: true,
    hint: 'Two arcs, one in each of your palette’s colours, turning slowly while you hover over your card — the grandest of the six.',
  },
  double: {
    key: 'double',
    label: 'Double',
    moves: false,
    hint: 'Two rings with a gap between them — a coin. The most formal of the six, and completely still.',
  },
};

export const RING_KEYS = Object.keys(RINGS);

export function ringOf(key) {
  return RINGS[key] ?? null;
}

/**
 * THE FRAME — the edge of the person's own card.
 *
 * The card is a rendering of a person, and their cosmetics travel with them: the same
 * rule the name paint already follows, everywhere that card is drawn — a store's roster,
 * the seller's member queue, the buyer's preview. What it decorates is an EDGE. It never
 * touches the card's surface, its ink, the store's chip, or the store's own band, and a
 * test reads the stylesheet and fails if a frame rule names a colour or a background.
 */
export const FRAMES = {
  none: {
    key: 'none',
    label: 'None',
    moves: false,
    hint: 'The store’s own card, with nothing of yours on its edge.',
  },
  hairline: {
    key: 'hairline',
    label: 'Hairline',
    moves: false,
    hint: 'A one-pixel edge in your palette, all the way round.',
  },
  bevel: {
    key: 'bevel',
    label: 'Bevel',
    moves: false,
    hint: 'A lit edge: the top and left in one of your colours, the bottom and right in the other. Reads as a solid object rather than an outline, and it is completely still.',
  },
  double: {
    key: 'double',
    label: 'Double rule',
    moves: false,
    hint: 'A hairline with a second one stepped in from it. The most formal of the four, and still just an edge.',
  },
  glow: {
    key: 'glow',
    label: 'Glow',
    moves: false,
    hint: 'A soft light in your palette behind the card’s edge. It does not pulse — a glow that breathes on a page full of cards is a page that will not settle.',
  },
  aurora: {
    key: 'aurora',
    label: 'Aurora',
    moves: true,
    hint: 'Both of your colours travelling along the card’s edge, slowly, while you hover over it. A browser too old to confine a gradient to the edge simply gets no edge rather than a repainted card.',
  },
};

export const FRAME_KEYS = Object.keys(FRAMES);

export function frameOf(key) {
  return FRAMES[key] ?? null;
}

/**
 * The classes a ring adds to an avatar. `null` is not "none": it is the ring every look
 * has always had, which is what keeps every existing wearer looking exactly as they did.
 */
export function ringClass(ringKey) {
  if (ringKey === null || ringKey === undefined) return 'wear-ring';
  return {
    none: 'ring-none',
    hairline: 'ring-hairline',
    beaded: 'ring-beaded',
    orbit: 'wear-ring',
    split: 'ring-split',
    double: 'ring-double',
  }[ringKey] ?? 'wear-ring';
}

/** The classes a frame adds to the card, or '' for the card's own edge. */
export function frameClass(frameKey) {
  // Every decorated frame is `frame-<key>`, which is what the catalog test asserts — a
  // new frame value costs one word here and one rule in the stylesheet, and nothing that
  // can drift: the class is derived from the vocabulary rather than listed beside it.
  return frameKey && frameKey !== 'none' ? `frame-${frameKey}` : '';
}

/**
 * YOUR OWN BAND — the page that is yours, in your own colours.
 *
 * The survey's "profile themes" item, answered inside this product's rules. A store's
 * band is the store's SURFACE and its palettes are built for that: every theme clears
 * 5.5:1 for white at every point of its gradient with the grain composited
 * (`themes.test.js`). A person's palette is an INK: eight accents drawn to be read on
 * the product's own surfaces. Painted as a band, two of the eight fail the store band's
 * own bar — rose reaches 4.56:1 white and 4.05:1 for the 92% ink, amber 4.72 and 4.26 —
 * so the naive version was a palette that ships unreadable text, and it was found before
 * the first line of CSS was written.
 *
 * The recipe that passes is still a band: the palette's DEEP stop is the surface and its
 * lighter stop is the aurora, mixed over it by no more than OWN_BAND_MIX. Measured at
 * that bound, grain composited, the worst palette (rose) clears 5.52:1 and 4.85:1.
 *
 * It shows on the page that is the person's own — `/library` — and nowhere else. A
 * storefront keeps its theme, and a person's name keeps its paint inside it: a member's
 * palette repainting a store's page would be layer P standing in for layer S, which is
 * the confusion this whole file exists to end.
 */
export const OWN_BAND_MIX = 0.3;

export const OWN_BAND_LINE =
  'Your palette and your effect, on the page that is yours. Nobody else sees this band — '
  + 'a store keeps its own theme, and your name keeps its own paint inside it.';

/**
 * The band a person's own pages wear, or `null`.
 *
 * The decision is `plusWear`'s and nothing else: a running month WITH a look chosen. A
 * person who has paid and never opened the picker wears no band and no paint, which is
 * one rule rather than two — the picker is what changes it, and it says so.
 */
export function personBand(row = null) {
  const wear = plusWear(row);
  if (!wear) return null;
  const palette = ACCENTS[wear.plate];
  const effect = effectOf(wear.effect);
  return {
    palette: wear.plate,
    paletteLabel: palette.label,
    effect: effect.key,
    effectLabel: effect.label,
    from: palette.from,
    to: palette.to,
    // `from` stays the lighter stop and `to` the deeper one, the same meaning they have
    // in a store theme, so the ink tokens in the stylesheet apply unchanged.
    style: `--theme-from:${palette.from};--theme-to:${palette.to};`,
  };
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
  // A look is worn when ANY of its slots has been chosen. Before the ring and the frame
  // existed this read "a palette or an effect", and it stays true for those two: a
  // person who has chosen only a ring has still chosen something, and telling them they
  // are wearing nothing would be the product contradicting its own picker.
  if (!row.nameplate && !row.plus_effect && !row.plus_ring && !row.plus_frame) return null;
  const effect = effectOf(row.plus_effect).key;
  return {
    plate: ACCENTS[row.nameplate] ? row.nameplate : 'indigo',
    effect,
    // The two outer layers. An unknown key is the same graceful answer every other
    // vocabulary in this file gives: no choice, and therefore the default.
    ring: ringOf(row.plus_ring)?.key ?? null,
    frame: frameOf(row.plus_frame)?.key ?? null,
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
  // The two outer layers of the person's own card. Same owner as the name and the same
  // decision (`plusWear`), which is the whole reason they are decided here rather than
  // at the four places a card is drawn.
  const ring = wear ? { key: wear.ring, className: ringClass(wear.ring) } : null;
  const frame = wear ? { key: wear.frame, className: frameClass(wear.frame) } : null;
  const tierNo = Number(tier?.tier_no) || 0;
  const chip = tierNo
    ? {
      label: String(tier.name ?? '').trim() || (tierNo === 2 ? 'Elite' : 'Member'),
      palette: ACCENTS[tier.accent] ? tier.accent : 'indigo',
      // The tier's own rank decides how the chip is drawn — the top tier glints and
      // the entry tier does not, which is the platform's advice borrowed from how
      // Discord deploys gradient role styles: one or two, or nothing stands out.
      style: tierNo === 2 ? 'gradient' : 'solid',
      // The shape the creator chose for this tier, or nothing. It travels WITH the
      // chip because it has the same owner: the store defines the tier, so the store
      // decides what its chip wears. A person's own look (layer P) can neither add a
      // glyph to a store's chip nor take one off it — which is the same separation
      // that keeps a Plus member from losing the creator's chip on the roster.
      glyph: glyphOf(tier.glyph)?.key ?? null,
    }
    : null;
  return { name, chip, ring, frame };
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

/**
 * When this person's arrangement started — the fact the blended model's
 * `member_since` field asks for, and the one thing Discord's own badge shows that
 * nothing else on a card does.
 *
 * Derived from the subscription row and never stored a second time. Two rules make
 * it honest rather than decorative: a **pending claim has no date**, because
 * nothing has started yet, and a lapsed arrangement drops the date from the page
 * with the look — the row keeps `period_start` for whenever the person comes back,
 * but a badge that still advertised a month that ended would be a claim about now.
 *
 * @returns {Date|null}
 */
export function memberSince(subscription = null) {
  if (!subscription) return null;
  // The SAME gate the look passes through (`plusState`), not a second opinion: an
  // arrangement whose period end has passed is lapsed even though the row still says
  // 'active', and a badge still advertising a month that ended is a claim about now.
  if (plusState({ status: subscription.status, period_end: subscription.period_end }) !== 'active') return null;
  const start = subscription.period_start ? new Date(subscription.period_start) : null;
  if (!start || Number.isNaN(start.getTime())) return null;
  return start;
}

/** "Since 25 Sep 2026" — on the shop's own clock, like every other date here. */
export function memberSinceWords(subscription = null, now = new Date()) {
  const since = memberSince(subscription);
  if (!since) return null;
  if (since.getTime() > new Date(now).getTime()) return null;   // a clock skew is not a birthday
  return `Since ${longDay(since)}`;
}

/** Days left on an arrangement, or null. Used by the member's own card. */
export function plusDaysLeft({ period_end = null } = {}) {
  if (!period_end) return null;
  const end = new Date(period_end);
  if (Number.isNaN(end.getTime())) return null;
  return Math.max(0, Math.ceil((end.getTime() - Date.now()) / 86400000));
}

/**
 * THE BLENDED CATALOGUE, DECIDED — every row of the premium-customization review,
 * in one list, with its owner and its verdict.
 *
 * The review arrived as a union of four systems (Asura+ Basic/Premium, Discord
 * Nitro, Twitch, Patreon) plus an instanced JSON model. A union is not a decision,
 * and the failure mode of a cosmetics tier is not the price — it is the row
 * somebody assumed was included. So every row is written down here with three
 * facts: **whose it is** (`owner`), **what happened to it** (`state`), and — when
 * the answer is no or not yet — **why**, in the words the buyer reads.
 *
 * ``owner`` is the layer rule this whole document is built on, applied row by row:
 *
 *   · `person` — bytebikri grants it with a period, and it travels with the NAME;
 *   · `store`  — a creator's own arrangement with their own members (layer S);
 *   · `file`   — the file's owner decides it per file, not a subscription;
 *   · `none`   — nobody grants it, and that is the decision.
 *
 * A `built` row must NAME the thing that delivers it (`delivers`), and
 * `plus.test.js` resolves every one of those names against the cosmetics catalog —
 * the same discipline as "every class the views emit has a rule": a perk that
 * claims to be built and points at nothing is a sentence, not a feature.
 *
 * Adding a row is cheap and that is the point: the next review gets answered in one
 * list, in one commit, instead of in a paragraph somebody has to remember.
 */
export const PERK_OWNERS = ['person', 'store', 'file', 'none'];
export const PERK_STATES = ['built', 'refused', 'deferred'];

export const PERKS = [
  // ── what a period actually buys: the person's own look (layer P) ─────────────
  {
    key: 'paint', owner: 'person', state: 'built', delivers: 'nameplate',
    name: 'The paint on your name',
    words: 'Eight palettes, every one checked against both themes. It shows on every page that draws '
      + 'your name, and inside a store’s band without repainting it.',
  },
  {
    key: 'effect', owner: 'person', state: 'built', delivers: 'effect',
    name: 'The effect around it',
    words: 'Six treatments, from none to a slow halo. Motion happens on intent — a page nobody pointed '
      + 'at does not animate — and reduced motion keeps the look, still.',
  },
  {
    key: 'ring', owner: 'person', state: 'built', delivers: 'ring',
    name: 'The ring around your initial',
    words: 'Six rings. This is what the blend calls an animated avatar: there is no picture to upload '
      + 'here, so what moves is the ring, drawn rather than hosted.',
  },
  {
    key: 'frame', owner: 'person', state: 'built', delivers: 'frame',
    name: 'The edge of your card',
    words: 'Six edges on the card that carries your name — on a store’s roster, in the seller’s member '
      + 'list, and on your own page. The edge is yours; the surface under it belongs to the page.',
  },
  {
    key: 'band', owner: 'person', state: 'built', delivers: 'own-band',
    name: 'Your own band on your own page',
    words: 'The blend calls it a profile banner or theme. It is your palette’s own surface on /library, '
      + 'and nowhere else: a store keeps its band, and your name keeps its paint inside it.',
  },
  {
    key: 'badge', owner: 'person', state: 'built', delivers: 'badge-date',
    name: 'Your badge, with the date you started',
    words: 'The month is not just a look — the arrangement carries the day it started, the way Discord’s '
      + 'own badge shows the subscription start date.',
  },

  // ── the creator's own arrangement with their own members (layer S) ────────────
  {
    key: 'tier-chip', owner: 'store', state: 'built', delivers: 'glyph',
    name: 'A store’s tier chip, beside a member’s name',
    words: 'The creator names the tiers and chooses the shape; the chip is painted in the tier’s own '
      + 'colour. bytebikri cannot grant it and a member cannot buy it here.',
  },
  {
    key: 'early-access', owner: 'store', state: 'built', delivers: 'members-only',
    name: 'A file a creator opens to members first',
    words: 'The blend’s “early access”. The creator decides which files, and when they open to everybody '
      + 'else — that is what a membership is for.',
  },
  {
    key: 'member-room', owner: 'store', state: 'built', delivers: 'member-room',
    name: 'The creator’s own room',
    words: 'The blend’s “exclusive channel”. One page per store, for the people whose dues are standing.',
  },
  {
    key: 'store-plan', owner: 'store', state: 'built', delivers: 'store-plan',
    name: 'What a store’s plan buys it',
    words: 'Published files, ad slots per page, custom sections, its own band. The blend files “bigger '
      + 'uploads” under a person’s subscription; here it belongs to the shop’s own plan, paid to it.',
  },
  {
    key: 'gift', owner: 'person', state: 'built', delivers: 'gift-rail',
    name: 'Give a period to somebody else',
    words: 'One code, one period, one person — the one social feature of a cosmetics product that never '
      + 'drew a backlash, and the only acquisition channel that needs no card.',
  },

  // ── and the rows the answer is no to, each with its reason ────────────────────
  {
    key: 'ad-free', owner: 'none', state: 'refused',
    name: 'No ads',
    reason: 'The ads on a store’s page are paid to that store by the ad network. Selling “no ads” would '
      + 'be selling something that belongs to a creator and making them pay for it.',
    notLine: 'It does not remove ads. The ads on a store\'s page are paid to that store by the ad network, and bytebikri cannot give away what a creator earns.',
  },
  {
    key: 'opens-content', owner: 'none', state: 'refused',
    name: 'Opening files',
    reason: 'A file opens by an ad, by a membership, or by nothing. A cosmetic that could open one would '
      + 'be a hole in every creator’s paywall at once.',
    notLine: 'It does not open files. A file opens by an ad, by membership, or by nothing — never by paying us.',
  },
  {
    key: 'priority-rank', owner: 'none', state: 'refused',
    name: 'Moving up a list',
    reason: 'Buying a position in a public list is read as manufactured scarcity the moment the mechanism '
      + 'is visible, and a creator’s roster is the creator’s ordering, not a payer’s.',
    notLine: 'It does not move you up any list. The ranking code does not read it, and a store\'s own roster does not order by it.',
  },
  {
    key: 'see-engagement', owner: 'none', state: 'refused',
    name: 'Seeing who opened your files',
    reason: 'The reading bookmark is the reader’s own and the store is never shown it. A perk that revealed '
      + 'readers would sell a creator’s own audience to the payers.',
    notLine: 'It does not change what a store sees about you. A seller learns that you are a member of their store the way they always did, by confirming your dues.',
  },
  {
    key: 'offline-download', owner: 'file', state: 'refused',
    name: 'Offline downloads',
    reason: 'The treatment — download with your reference burned in, or play-only — is the file’s own '
      + 'setting, chosen by the store that owns it. A subscription cannot override somebody else’s file.',
  },
  {
    key: 'priority-comments', owner: 'none', state: 'refused',
    name: 'Highlighted comments',
    reason: 'There is no comment surface, and if one is built, a store may highlight a member’s question '
      + 'inside its own room — labelled, in the store’s own space. Not sold here.',
  },
  {
    key: 'animated-uploads', owner: 'none', state: 'refused',
    name: 'Uploading an animated picture or banner',
    reason: 'The avatar here is an initial and there is nothing to upload; an upload brings a moderation '
      + 'pipeline this product has refused twice. What moves is drawn — the ring, the edge, the effect.',
  },
  {
    key: 'beta-opt-in', owner: 'none', state: 'refused',
    name: 'Beta access',
    reason: 'There is no flag system, and a paid tier is not how features get tested. Selling a beta '
      + 'before the beta exists is the same class of promise as “ad-free”.',
  },
  {
    key: 'custom-reactions', owner: 'none', state: 'deferred',
    name: 'A reaction pack of your own',
    reason: 'Emoji are a social surface, and this product has none yet. Deferred rather than refused: the '
      + 'day there is a place to react, the pack belongs to the person who made it, not to us.',
  },
];

/**
 * Anything wrong with the catalogue above, as sentences a test can print.
 *
 * The three rules are the ones that keep a catalogue honest: a closed set of states,
 * a reason on every row that is not built, and a `delivers` name on every built row
 * (resolved against the real catalog by the test, because a perk pointing at nothing
 * is a sentence).
 */
export function perkProblems() {
  const problems = [];
  const seen = new Set();
  for (const perk of PERKS) {
    if (seen.has(perk.key)) problems.push(`duplicate perk key: ${perk.key}`);
    seen.add(perk.key);
    if (!PERK_OWNERS.includes(perk.owner)) problems.push(`${perk.key}: owner ${perk.owner} is not one of ${PERK_OWNERS.join(', ')}`);
    if (!PERK_STATES.includes(perk.state)) problems.push(`${perk.key}: state ${perk.state} is not one of ${PERK_STATES.join(', ')}`);
    if (!perk.name || (!perk.words && !perk.reason)) problems.push(`${perk.key}: a perk says what it is, or why it is not`);
    if (perk.state === 'built' && !perk.delivers) problems.push(`${perk.key}: a built perk names what delivers it`);
    if (perk.state !== 'built' && !perk.reason) problems.push(`${perk.key}: a refusal or a deferral carries its reason`);
    if (perk.state !== 'built' && perk.delivers) problems.push(`${perk.key}: nothing delivers what was not built`);
  }
  return problems;
}

/** The rows a buyer is offered, and the rows they are told about. */
export function perksByState(state) {
  return PERKS.filter((p) => p.state === state);
}

/**
 * The honest list of what the money does NOT buy, printed on the page that takes
 * it. This is the paragraph the researched record says to write first: the
 * complaint that damages a cosmetics tier is never "it costs money", it is "I
 * thought it would also do X".
 *
 * Derived from `PERKS` rather than kept beside it: every refusal that is written
 * down in the catalogue is printed on the page, and a row cannot be added to one
 * without appearing in the other.
 */
export const PLUS_NOT = PERKS.filter((perk) => perk.notLine).map((perk) => perk.notLine);

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
export function plusConsoleRows({
  active = 0, pending = 0, lapsed = 0, paidThisMonth = 0, price = 0,
  giftsReserved = 0, giftsReady = 0, giftsRedeemed = 0, giftsVoid = 0,
} = {}) {
  return [
    { term: 'Price', text: `NPR ${Number(price).toLocaleString('en-IN')} a month, or NPR ${Number(plusYearPrice(price)).toLocaleString('en-IN')} a year — ten months' worth` },
    { term: 'Arrangements', text: `${active} active, ${pending} waiting for a reference to be checked, ${lapsed} lapsed` },
    { term: 'Gifts', text: `${giftsReady} ready to give, ${giftsReserved} waiting on a reference, ${giftsRedeemed} redeemed, ${giftsVoid} not found` },
    { term: 'Received this month', text: `NPR ${Number(paidThisMonth).toLocaleString('en-IN')} matched against the platform's own statement` },
  ];
}

/**
 * GIFTING — the one social feature of every cosmetics tier that never drew a
 * backlash, and the only acquisition channel this product can run with no processor.
 *
 * The researched shape is Discord's Nitro gift (and its "friend passes") and Twitch's
 * gifted subscription: one person pays, somebody else gets the period. What this file
 * owns is the part that has nothing to do with money — the code, what it may say, and
 * what state a gift is in — so the store layer never invents a second vocabulary for
 * the same four states.
 */

/**
 * The alphabet a code is drawn from, and it is shorter than the alphabet on purpose.
 * I, O, 0 and 1 are gone: this string is read aloud, written on paper and retyped by
 * somebody who is not looking carefully, and the four characters that require
 * handwriting to distinguish are the four that make a gift fail for a reason nobody
 * can see. 32 characters over eight positions is 2^40 codes.
 */
export const GIFT_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** BKP-XXXX-XXXX. Minted with `randomInt`, which is a CSPRNG — a guessable code is a
 *  free month for whoever guesses it, so this is a credential and not a label. */
export function giftCode(rand = (n) => randomInt(n)) {
  let out = '';
  for (let i = 0; i < 8; i += 1) out += GIFT_ALPHABET[rand(GIFT_ALPHABET.length)];
  return `BKP-${out.slice(0, 4)}-${out.slice(4)}`;
}

/** What somebody typed, made into what we minted — or into null if it is not one. */
export function normalizeGiftCode(input) {
  const raw = String(input ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (raw.length !== 11 || !raw.startsWith('BKP')) return null;
  const body = raw.slice(3);
  if (![...body].every((c) => GIFT_ALPHABET.includes(c))) return null;
  return `BKP-${body.slice(0, 4)}-${body.slice(4)}`;
}

/** The four states, said to the person who is holding the code. */
export const GIFT_STATE_LINE = {
  reserved: 'Waiting on the transfer — an operator has not matched it against the platform’s statement yet, so the code does not work.',
  funded: 'Ready. The code works, once, for whoever you give it to.',
  redeemed: 'Used — the period is running on that person’s account.',
  void: 'Not found. The transfer was not on the statement, so this code never works.',
};

/** The same four states, said to the BUYER, who is the one who can act on them. */
export const GIFT_BUYER_LINE = {
  reserved: 'Your reference is in the queue. Nothing is used up while it waits, and the code starts working the moment the transfer is found.',
  funded: 'The transfer was found. Give the code to whoever you bought it for.',
  redeemed: 'Redeemed. If you want to do this again, buy another — a code is one period, for one person.',
  void: 'The transfer was not found. Nothing was taken from you, and the same money can be claimed again with the right reference.',
};

/**
 * What a gift is NOT, printed on the page that sells it — the same discipline as
 * `PLUS_NOT`, and for the same reason: the complaint that damages a cosmetics tier is
 * never the price, it is what somebody assumed the price included.
 */
export const GIFT_NOT = [
  'It is not a subscription for you. A gift is one period, for one other person — you cannot redeem your own code, and buying one never extends your own arrangement.',
  'It does not stack. A code is used once: the second attempt is refused with a sentence rather than quietly doing nothing.',
  'It opens nothing. A gift is the same look the plan always sells — no file, no ad removed, no wait shortened, for you or for them.',
  'There is no refund path, because there is no processor to reverse. A code that was never redeemed is a period still waiting, not money the platform keeps.',
];

/** A year at ten months' price, derived so the page and the console cannot disagree. */
export function plusYearPrice(monthly = 149) {
  const m = Number(monthly) || 0;
  // Ten months exactly. Derived rather than typed a second time: a discount written
  // twice is a discount that drifts, and this one is stated in words on two pages.
  return m * 10;
}

/** The saving, in words, for the page that offers both periods. */
export function plusYearNote(monthly = 149) {
  const m = Number(monthly) || 0;
  const full = m * 12;
  const saving = full - plusYearPrice(m);
  return `Two months free — NPR ${Number(saving).toLocaleString('en-IN')} less than twelve months bought one at a time.`;
}

/** The date a claim is set for, when an operator matches it. */
export function plusPeriodEnd(from, months) {
  const start = new Date(from);
  const end = new Date(start);
  end.setMonth(end.getMonth() + Math.max(1, Number(months) || 1));
  return end;
}
