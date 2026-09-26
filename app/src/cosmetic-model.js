/**
 * The premium cosmetic system's MODEL — the power ladder and the motif catalog,
 * as pure data (PREMIUM_COSMETICS.md).
 *
 * Kept in its own module because two modules that must stay one-way from each
 * other both read it: `plus.js` decides what is worn (`plusWear`, `composeName`,
 * and the power a wearer carries) and `cosmetics.js` declares the engine (slots,
 * budget validation). Both import this file; neither imports the other, and the
 * list of levels lives HERE, once — `motifsFor()` and the engine's validation
 * read the same array.
 *
 * A power level is how STRONG a treatment may be: never a price, never stored,
 * never sold. Derived by `powerOf()` from the entitlements that already exist —
 * a store's tier, a running Plus period, a special grant — in the same minute
 * those entitlements change. Lapsed is not an input: the state layer decides
 * that first (MEMBERSHIP_AUDIT.md), and a lapsed membership is no power.
 *
 * The motif is the identity: power decides how strong, the motif decides what
 * it is. A gold member wearing the Golden Lotus and one wearing the Golden
 * Dragon carry the same treatment — same paint, same sheen, same glow — and
 * different identities. That is the difference between "this account is
 * premium" and "this is MY profile's visual identity".
 *
 * `kind` is `motif` (a mark that wears beside the name at 18 px — the Twitch
 * rule: design the smallest size first, because that is the size it is read at)
 * or `mascot` (a character for the card: resting pose, one idle, a hover
 * reaction, never more, and never a list; the no-sexualization rule is
 * load-bearing and recorded in PREMIUM_COSMETICS.md §0).
 *
 * `minPower` is where a motif unlocks; unlocking is cumulative.
 * `treatment` and `still` are the accessibility contract in the same entry: a
 * moving version whose static version is not declared is a fallback nobody
 * audited.
 * `asset` is the source drawing in `public/`; production variants are cut in
 * Phases B/D, judged at 18 px first.
 */
import { TIERS_MAX } from './memberships.js';

/**
 * ── THE POWER LADDER ──────────────────────────────────────────────────────────────
 *
 * The premium cosmetic system (PREMIUM_COSMETICS.md). A power level is how STRONG a
 * treatment may be — never a price, never stored, never sold. It is derived from the
 * entitlements that already exist, by `powerOf()`, in the same minute those
 * entitlements change:
 *
 *   standard — an account with no live entitlement
 *   silver   — a store's tier 1 membership, active
 *   gold     — a store's tier 2 membership, active (the top tier: TIERS_MAX = 2)
 *   crystal  — a running Plus period (the platform's payer, so it travels with the
 *              person across stores)
 *   inferno  — a special grant, an operator's hand, not a purchase, for now
 *
 * THE BUDGET IS THE ANTI-MYSPEACE RULE, as arithmetic rather than a hope. Three
 * surfaces, because where is half the question:
 *
 *   row    — a roster plate in a list; dozens can be in view. At most ONE slow
 *            (>= 6 s) moving element, transform/opacity only. Inferno is ZERO here:
 *            the fire never touches a list. That is the old refusal of aura and
 *            particles, kept — as a number.
 *   card   — one card in focus (the member's own card, a solo plate).
 *   stage  — the person's own stage (/library, their page). The full treatment; the
 *            environment is allowed to exist here and nowhere else.
 *
 * And one per viewport, at the top: at inferno, exactly one card in the viewport may
 * carry the full treatment — the person's own. "If every plate shimmers, none feel
 * special" is a renderer rule, enforced by this table.
 *
 * Every level carries `treatment` (what moves) and `still` (what a reduced-motion
 * reader gets instead). The static version is not an absence and not a slower
 * version — a slower animation is still motion; the researched rule is a deliberate
 * static composition, declared here so a fallback can never be an un-audited guess.
 */
export const POWER = [
  {
    key: 'standard',
    name: 'Standard',
    source: 'an account, as it is — no live entitlement',
    budget: { row: 0, card: 0, stage: 0 },
    treatment: 'Nothing moves. The account, in its own ink.',
    still: 'Nothing moves. There is no motion to remove, and the state words are the design.',
  },
  {
    key: 'silver',
    name: 'Silver',
    source: 'a store’s tier 1 membership, active',
    budget: { row: 1, card: 1, stage: 1 },
    treatment: 'One sheen — the 45° sweep, 8 s, transform only — and it asks for the '
      + 'viewer: it moves on hover of one’s own card, and on a roster row it is the slow '
      + 'drift, no faster than a breath.',
    still: 'A resting highlight where the sheen would pass, at a third of its strength. '
      + 'Cold chrome reads as silver without a single degree of motion.',
  },
  {
    key: 'gold',
    name: 'Gold',
    source: 'a store’s tier 2 membership, active — the top tier a store may sell',
    budget: { row: 1, card: 2, stage: 2 },
    treatment: 'The silver sheen at 6 s, plus the slow light ring around the initial — '
      + 'the orbit ring in warm gold, a registered angle, not a paint job.',
    still: 'The ring stopped at its brightest angle, the highlight resting where the sheen '
      + 'would end. Gold is a colour here, not a verb.',
  },
  {
    key: 'crystal',
    name: 'Crystal',
    source: 'a running Plus period — the platform’s payer, and it travels with the person',
    budget: { row: 1, card: 3, stage: 3 },
    treatment: 'Gold, plus the frame drift: the card’s edge carries a masked aurora '
      + 'gradient (the existing aurora frame, budgeted), and the sheen at 5 s. The '
      + 'refractive paint on the name is the signature — two colours, drifting on hover.',
    still: 'The aurora frame at its chosen stop, the name in its two colours, the highlight '
      + 'at rest. Three things, three deliberate compositions.',
  },
  {
    key: 'inferno',
    name: 'Inferno',
    source: 'a special grant — an operator’s hand, recorded in the audit log, not a purchase, '
      + 'for now',
    budget: { row: 0, card: 4, stage: 5 },
    treatment: 'Everything above, plus the mascot layer (resting pose, one idle, a hover '
      + 'reaction — never more) and environmental embers on one’s own stage: pseudo-elements '
      + 'and box-shadow layers, eight nodes at most, compositor-only. On a roster row the '
      + 'budget is zero: the fire never touches a list, and one card per viewport ever '
      + 'carries the full treatment.',
    still: 'The mascot in its resting pose, the embers as a fixed scatter, the ring and the '
      + 'highlight at rest. A still inferno is the most expensive-looking thing in the '
      + 'product, because the static composition was designed, not abandoned.',
  },
];

export const POWER_KEYS = POWER.map((p) => p.key);

/** 0..4, or -1 for a key the ladder does not have. */
export function powerIndex(key) {
  return POWER.findIndex((p) => p.key === key);
}

/**
 * The derivation. `storeTierNo` is the member's tier AT THE STORE (0 when not a
 * member), `plusRunning` the Plus clock, `special` the grant. It returns the HIGHEST
 * power in force, capped at the top store tier (a tier 3 does not exist, and a bigger
 * number is not a bigger power — the ladder is closed).
 *
 * Note what is not an input: lapsed. The state layer decides that before power does,
 * and a lapsed membership is not a lower power — it is no power, in the same minute
 * the files close. There is no "ex-gold" look, because gold is a function of a row,
 * not a stain on one.
 */
export function powerOf({ storeTierNo = 0, plusRunning = false, special = false } = {}) {
  if (special) return 'inferno';
  if (plusRunning) return 'crystal';
  const tier = Math.min(Math.max(0, Math.trunc(Number(storeTierNo) || 0)), TIERS_MAX);
  if (tier >= 2) return 'gold';
  if (tier === 1) return 'silver';
  return 'standard';
}

/**
 * ── THE MOTIF CATALOG ──────────────────────────────────────────────────────────────
 *
 * The identity axis: power decides how strong, the motif decides what it is. A gold
 * member wearing the Golden Lotus and a gold member wearing the Golden Dragon carry
 * the same treatment — same paint, same sheen speed, same ring — and completely
 * different identities. That is the difference between "this account is premium" and
 * "this is MY profile's visual identity".
 *
 * A motif is a PERSON slot in waiting (Phase B): it decorates the person, travels
 * with the person, and only bytebikri renders it. A store may raise a person's power
 * (their tier does) but may not paint the person's name.
 *
 * `kind` is `motif` (a mark that wears beside the name, and must be readable at
 * 18 px — the Twitch rule, design the smallest size first) or `mascot` (a character
 * for the mascot layer, Phase D; the no-sexualization rule is load-bearing and
 * recorded in PREMIUM_COSMETICS.md §0).
 *
 * `minPower` is where the motif unlocks, and unlocking is cumulative: motifsFor()
 * returns a level's motifs and everything below it, so a crystal member may still
 * wear the silver star, if that is who they are.
 *
 * `treatment` and `still` are the accessibility contract in the same entry: a moving
 * version whose static version is not declared is a fallback nobody audited, and the
 * test refuses it.
 *
 * `asset` is the source drawing in `app/public/`. Production variants — 18/36/72 for
 * the motifs, under 200 KB for the mascots — are cut in Phases B and D; the test
 * below holds the catalog honest to what is on disk today.
 */
export const MOTIF_KINDS = ['motif', 'mascot'];

export const MOTIFS = [
  {
    key: 'silver-star',
    name: 'Silver Star',
    kind: 'motif',
    minPower: 'silver',
    asset: '/img/cosmetics/motif-silver.png',
    treatment: 'A four-pointed star in cold chrome, one frost line through it; the sheen '
      + 'passes over it once per cycle on one’s own card.',
    still: 'The star, still, with its frost line — the same mark, no motion.',
  },
  {
    key: 'golden-sun',
    name: 'Golden Sun',
    kind: 'motif',
    minPower: 'gold',
    asset: '/img/cosmetics/motif-gold.png',
    treatment: 'An eight-ray sun in warm liquid gold, one sparkle at forty-five degrees; '
      + 'the ring’s light and the sun’s rim turn at the same slow angle.',
    still: 'The sun with its sparkle, at rest in gold — warmth without a single degree of turn.',
  },
  {
    key: 'zen-enso',
    name: 'Zen Enso',
    kind: 'motif',
    minPower: 'gold',
    asset: '/img/cosmetics/motif-zen.png',
    treatment: 'A brushed enso with a lotus bud at its centre, antique gold; the one '
      + 'motion is the sheen’s, and it is slow, because the motif’s whole argument is '
      + 'calm.',
    still: 'The enso and its lotus bud, as drawn — the brush break in the circle is the '
      + 'signature, and it is there either way.',
  },
  {
    key: 'crystal-prism',
    name: 'Crystal Prism',
    kind: 'motif',
    minPower: 'crystal',
    asset: '/img/cosmetics/motif-crystal.png',
    treatment: 'A faceted diamond, ice-blue, three prismatic hairlines catching as the '
      + 'sheen crosses it.',
    still: 'The prism with its hairlines, facets lit once, no catch.',
  },
  {
    key: 'royal-crown',
    name: 'Royal Crown',
    kind: 'motif',
    minPower: 'crystal',
    asset: '/img/cosmetics/motif-royal.png',
    treatment: 'A three-point crown with a sapphire heart; the frame’s drift is the '
      + 'motion, the crown itself sits still, which is the point of a crown.',
    still: 'The crown, sapphire and all, seated and still.',
  },
  {
    key: 'aurora-ribbons',
    name: 'Aurora Ribbons',
    kind: 'motif',
    minPower: 'crystal',
    asset: '/img/cosmetics/motif-aurora.png',
    treatment: 'Two ribbons, teal to violet, under a small crescent; on the stage the '
      + 'ribbons drift, on a card they hold their arc and let the sheen do the moving.',
    still: 'The ribbons holding their arc, the crescent and its stars as drawn.',
  },
  {
    key: 'prism-refraction',
    name: 'Prism Refraction',
    kind: 'motif',
    minPower: 'crystal',
    asset: '/img/cosmetics/motif-prism.png',
    treatment: 'A beam splitting into a thin rainbow fan; the fan’s lines brighten as '
      + 'the sheen passes, and nowhere else do they move.',
    still: 'The beam and its fan, all five lines lit evenly — the rainbow without the sweep.',
  },
  {
    key: 'inferno-flame',
    name: 'Inferno Flame',
    kind: 'motif',
    minPower: 'inferno',
    asset: '/img/cosmetics/motif-inferno.png',
    treatment: 'One flame, blue core, three embers rising; the embers are the box-shadow '
      + 'layer, eight nodes at most, on the stage only — on a card the flame is drawn '
      + 'and the embers hold, because a card is not a campfire.',
    still: 'The flame seated over its blue core, the three embers fixed in their scatter.',
  },
  {
    key: 'buddha-gold',
    name: 'Golden Buddha',
    kind: 'mascot',
    minPower: 'gold',
    asset: '/img/cosmetics/mascot-gold-buddha.png',
    treatment: 'A small laughing buddha, meditating, lotus at the feet: resting pose, one '
      + 'slow idle (the sheen across the statue), a hover reaction no bigger than a '
      + 'nod of the head. It sits on the card’s edge in Phase D; it never performs for '
      + 'a stranger, and it is never more.',
    still: 'The resting pose, which is the design — a buddha does not need motion to be '
      + 'at rest.',
  },
  {
    key: 'dragon-gold',
    name: 'Golden Dragon',
    kind: 'mascot',
    minPower: 'gold',
    asset: '/img/cosmetics/mascot-gold-dragon.png',
    treatment: 'A coiled chibi dragon, friendly eyes, ember dots at the tail: resting '
      + 'pose, one idle (the tail’s embers drift, four dots, compositor-only), a hover '
      + 'reaction of one slow uncoil. Same budget rule as every mascot: the card’s '
      + 'edge, one per viewport, never a list.',
    still: 'The dragon coiled, embers fixed at the tail — a still picture of something '
      + 'that was never aggressive to begin with.',
  },
  {
    key: 'lotus-gold',
    name: 'Golden Lotus',
    kind: 'mascot',
    minPower: 'gold',
    asset: '/img/cosmetics/mascot-gold-lotus.png',
    treatment: 'Six gilded petals, one catching the light (the upper-left, as drawn): '
      + 'resting pose, one idle (that lit petal brightens and eases, a slow breath of the '
      + 'bloom), a hover reaction of a single petal lifting in welcome. The same budget '
      + 'rule as every mascot: the card\u2019s edge, one per viewport, never a list.',
    still: 'The bloom as drawn — petal one lit, the other five in the shade, the '
      + 'centre bud whole. A flower at rest is a flower at rest.',
  },
];

export const MOTIF_KEYS = MOTIFS.map((m) => m.key);

export function motifOf(key) {
  return MOTIFS.find((m) => m.key === key) ?? null;
}

/**
 * What a power may wear: this level's motifs and everything below it. Unlocking is
 * cumulative, so the wardrobe only grows — and a person who drops from crystal to
 * gold keeps any gold-and-below motif they chose, because their motif is a person
 * slot and the picker refuses the values their power no longer reaches (Phase B),
 * rather than silently swapping their identity out from under them.
 */
export function motifsFor(powerKey) {
  const index = powerIndex(powerKey);
  if (index < 0) return [];
  return MOTIFS.filter((m) => powerIndex(m.minPower) <= index);
}

