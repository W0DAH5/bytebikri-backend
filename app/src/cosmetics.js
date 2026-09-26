/**
 * The cosmetics engine — every look on this platform, declared once, with its owner.
 *
 * THE PROPOSAL THIS ANSWERS. The brief was, in effect: stop thinking of one badge and
 * "premium features", and build a cosmetics engine — slots (profile frame, avatar
 * frame, name effect, badge, card background, aura, entrance effect), separable from
 * the profile, so that "ELITE is just one cosmetic, not the entire visual system", and
 * so a fifth phase of the product needs no redesign of the first.
 *
 * WHAT THIS CODEBASE ALREADY HAD, and what it did not. It had the separation the
 * proposal asks for, in one decision point (`composeName()` in views.js) and two
 * owners (layer P, the person's own look, and layer S, the store's tier). What it did
 * not have is a DECLARATION: the slots lived as three registries in three modules
 * (`ACCENTS` in memberships.js, `EFFECTS` in plus.js, `THEMES` in themes.js, glyphs
 * beside the accents), each with its own keys, its own DB column and its own check.
 * Adding the fourth slot meant editing four files and hoping. This file is the fourth
 * thing: the list of slots, each with its owner, its grant, its values and its words.
 *
 * THE RULE THAT DECIDES EVERY SLOT HERE — WHO OWNS THE SURFACE. A decoration is owned
 * by the owner of the thing it decorates:
 *
 *   * A PERSON'S SLOTS decorate the person's own identity — the paint on their name,
 *     the effect around it. They travel with the person and are worn on any page that
 *     shows them, and only bytebikri can grant them (a Plus period). A store cannot
 *     grant one, cannot take one away, and its theme never stands in for one.
 *   * A STORE'S SLOTS decorate the store's own surface — the band on its pages, the
 *     shape its tier wears. They are the creator's, they are paid for on the store's
 *     own plan, and they never appear beside a member's name as if they were that
 *     member's.
 *
 * That is why there is no "card background" slot in this file: on a store's page the
 * surface belongs to the store (it has themes), and on a person's own page it belongs to
 * the person (they have their own band on `/library`). A slot that let either repaint
 * the other's surface is the exact confusion the ownership correction was about, and the
 * research on premium looks says the same thing from the other side: "if every role
 * shimmers, none feel special".
 *
 * The two slots the review called frames are a different matter, because a ring and an
 * edge are decorations rather than surfaces, and they ARE here: `ring` (the initial's
 * ring, drawn on the avatar's pseudo-elements so that a store's own top-tier light on
 * the same avatar is untouched) and `frame` (the edge of the person's own card, wherever
 * that card is drawn — an edge only, never the surface or the ink).
 *
 * WHAT IS DELIBERATELY NOT HERE, with the reason (the proposal's phases 4 and 5):
 * a cosmetic shop, individual purchases, bundles, seasonal passes, rarity tiers and a
 * creator marketplace are all MONEY MOVEMENT — the user's own standing instruction is
 * that moving money inside the application is a later feature this product does not
 * have, so the entitlements they would sell do not exist to be sold. User-created
 * cosmetics need an upload pipeline and a moderation queue (both already discarded: no
 * uploads, and a roster of uploaded avatars is a roster of things to moderate). Particle
 * auras, canvas effects and per-list entrance animations are bandwidth and noise on a
 * Nepal-first product, and `prefers-reduced-motion` turns them into a second design that
 * nobody checked. Rarity is a property of a shop, so it arrives with the shop, if ever.
 *
 * WHAT A NEW SLOT COSTS. One entry in `SLOTS`, one column with its check constraint, one
 * renderer branch, and the tests in `test/cosmetics.test.js` fail until the DB, the
 * picker and the write path all agree. The ring and the frame are that claim being
 * cashed: two entries, two columns (0044), one new picker control kind, and the walk
 * (`ci/eyes/premium-walk.mjs` §15) reading the result off a store's roster. Nothing else in the product has to learn about
 * it: the picker iterates this list, and the `/plus/look` route validates against it.
 */
import { ACCENTS, ACCENT_KEYS, GLYPHS, GLYPH_KEYS, TIERS_MAX } from './memberships.js';
import { EFFECTS, EFFECT_KEYS, RINGS, RING_KEYS, FRAMES, FRAME_KEYS } from './plus.js';
import { THEMES, THEME_KEYS } from './themes.js';

/**
 * Who owns a slot. `person` slots are granted by bytebikri (a Plus period) and travel
 * with the person's name; `store` slots belong to the store that set them.
 */
export const OWNERS = ['person', 'store'];

/**
 * The eight palettes, six effects, six tier shapes and eight store bands, as slots.
 *
 * `column` is where the choice is stored, `kind` is which picker control draws it, and
 * `grant` is who may give it to somebody. Every item says in words what it is; for
 * anything that can move, `moves` says whether it does, because a person choosing on a
 * phone needs to know before they choose rather than after.
 */
export const SLOTS = [
  {
    key: 'nameplate',
    column: 'nameplate',
    owner: 'person',
    grant: 'plus',
    kind: 'swatch',
    label: 'Your palette',
    question: 'What colour your name is painted in.',
    hint: 'Eight checked palettes. Every one is contrast-checked against both the light '
      + 'and the dark theme.',
    values: ACCENT_KEYS.map((key) => ({
      key,
      label: ACCENTS[key].label,
      // A palette is paint: it has no motion of its own, on any of the six effects.
      moves: false,
      words: `${ACCENTS[key].label} — your name in this palette, on every page that shows it.`,
    })),
  },
  {
    key: 'effect',
    column: 'plus_effect',
    owner: 'person',
    grant: 'plus',
    kind: 'card',
    label: 'Your effect',
    question: 'What happens around the paint.',
    values: EFFECT_KEYS.map((key) => ({
      key,
      label: EFFECTS[key].label,
      hint: EFFECTS[key].hint,
      moves: EFFECTS[key].moves,
      words: EFFECTS[key].hint,
    })),
  },
  {
    // THE AVATAR'S RING — the second slot the cosmetics review asked for by name
    // ("avatar frame"), in the only form this product can honestly have it: the avatar
    // here is an initial, not an upload, so what can be decorated is the ring around it.
    //
    // It is a PERSON slot and it renders wherever the person's look renders — the
    // account chip, their own card, the roster plate. A store cannot set it and cannot
    // take it away: the card is a rendering of the person, not a surface of the store's.
    key: 'ring',
    column: 'plus_ring',
    owner: 'person',
    grant: 'plus',
    kind: 'demo',
    demo: 'avatar',
    label: 'The ring around your initial',
    question: 'What your initial is ringed with.',
    hint: 'The ring is drawn around the initials this product shows for everybody — there '
      + 'is no picture to upload and nothing to moderate. Only the ring is yours; a store’s '
      + 'own top-tier light on the same avatar is the store’s and stays where it is.',
    values: RING_KEYS.map((key) => ({
      key,
      label: RINGS[key].label,
      hint: RINGS[key].hint,
      moves: RINGS[key].moves,
      words: `${RINGS[key].label} — ${RINGS[key].hint}`,
    })),
  },
  {
    // THE FRAME — the card's edge. Deliberately an EDGE and nothing else: the surface
    // under the words belongs to whoever owns the page (a store has its themes, a person
    // has their own band on /library), so a slot that repainted it would be the exact
    // ownership confusion this engine exists to prevent. The stylesheet test refuses a
    // frame rule that names a background or a colour.
    key: 'frame',
    column: 'plus_frame',
    owner: 'person',
    grant: 'plus',
    kind: 'demo',
    demo: 'card',
    label: 'The edge of your card',
    question: 'What the card with your name on it is edged with.',
    hint: 'Your card is drawn on a store’s roster, in the seller’s member list and on your '
      + 'own page. This is its edge — never its surface, never the store’s chip, and never '
      + 'anything the creator chose.',
    values: FRAME_KEYS.map((key) => ({
      key,
      label: FRAMES[key].label,
      hint: FRAMES[key].hint,
      moves: FRAMES[key].moves,
      words: `${FRAMES[key].label} — ${FRAMES[key].hint}`,
    })),
  },
  {
    key: 'glyph',
    column: 'glyph',
    owner: 'store',
    grant: 'creator',
    kind: 'mark',
    label: 'The shape a tier wears',
    question: 'Which mark the store’s own tiers show beside a member’s name.',
    hint: 'One bold shape, drawn at about 20 pixels. It is painted in the tier’s own '
      + 'colour, so it cannot clash with it.',
    values: GLYPH_KEYS.map((key) => ({
      key,
      label: GLYPHS[key].label ?? key,
      moves: false,
      words: `The tier chip carries this shape — the creator’s mark, on the creator’s page.`,
    })),
  },
  {
    key: 'theme',
    column: 'theme',
    owner: 'store',
    grant: 'store-plan',
    kind: 'band',
    label: 'The store’s band',
    question: 'The surface the store’s own pages are painted in.',
    values: THEME_KEYS.map((key) => ({
      key,
      label: THEMES[key].label ?? key,
      // The band's aurora drifts; the palette itself does not. A store band is a
      // surface, and every one of them clears 5.5:1 for white at every gradient point
      // with the grain composited (themes.test.js), which is why it may carry words
      // where a person's palette may not.
      moves: true,
      words: `${THEMES[key].label ?? key} — the store's own surface, its own name inside it.`,
    })),
  },
];

export const SLOT_KEYS = SLOTS.map((s) => s.key);

export function slotOf(key) {
  return SLOTS.find((s) => s.key === key) ?? null;
}

/** The slots a person wears. Only bytebikri grants these, and only via Plus. */
export function personSlots() {
  return SLOTS.filter((s) => s.owner === 'person');
}

/** The slots a store sets for itself. */
export function storeSlots() {
  return SLOTS.filter((s) => s.owner === 'store');
}

/**
 * The form fields the look picker posts, in the order it renders them, derived from the
 * slots rather than typed in a second place. The route validates a submitted look
 * against this list, so a field that is not a person slot is not a field at all.
 */
export const LOOK_FIELDS = personSlots().map((s) => s.key);

/** One item of one slot, or null. */
export function itemOf(slotKey, itemKey) {
  const slot = slotOf(slotKey);
  if (!slot) return null;
  return slot.values.find((v) => v.key === itemKey) ?? null;
}

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

/**
 * Whether every slot item is well-formed. Used by the tests, and by nothing at runtime:
 * a catalog that fails this is a catalog that would render a control with no words.
 */
export function catalogProblems() {
  const problems = [];
  const seen = new Set();
  for (const slot of SLOTS) {
    if (seen.has(slot.key)) problems.push(`two slots share the key ${slot.key}`);
    seen.add(slot.key);
    if (!OWNERS.includes(slot.owner)) problems.push(`${slot.key} names an owner nobody has: ${slot.owner}`);
    if (!slot.label || !slot.question) problems.push(`${slot.key} has no label or no question`);
    if (!Array.isArray(slot.values) || !slot.values.length) {
      problems.push(`${slot.key} has no values`);
      continue;
    }
    const keys = new Set();
    for (const value of slot.values) {
      if (!value.key) problems.push(`${slot.key} has a value with no key`);
      if (keys.has(value.key)) problems.push(`${slot.key} lists ${value.key} twice`);
      keys.add(value.key);
      if (!value.label) problems.push(`${slot.key}.${value.key} has no label`);
      if (!value.words) problems.push(`${slot.key}.${value.key} has no words — a control nobody can read`);
      if (slot.owner === 'person' && typeof value.moves !== 'boolean') {
        problems.push(`${slot.key}.${value.key} does not say whether it moves`);
      }
    }
  }
  /*
   * The ladder and the catalog. The budget is the whole anti-MySpace argument, so
   * it is checked like a law: monotone up the ladder, and inferno's row is zero —
   * the fire never touches a list.
   */
  const pkeys = new Set();
  for (const p of POWER) {
    if (pkeys.has(p.key)) problems.push(`two power levels share the key ${p.key}`);
    pkeys.add(p.key);
    for (const surface of ['row', 'card', 'stage']) {
      if (typeof p.budget?.[surface] !== 'number' || p.budget[surface] < 0) {
        problems.push(`${p.key}.budget.${surface} is not a non-negative number`);
      }
    }
    if (p.key === 'inferno' && p.budget.row !== 0) {
      problems.push('inferno carries a row budget — the fire touched a list');
    }
    if (!p.treatment || !p.still) {
      problems.push(`${p.key} is missing its treatment or its still — a fallback nobody audited`);
    }
  }
  for (let i = 1; i < POWER.length; i += 1) {
    for (const surface of ['row', 'card', 'stage']) {
      if (POWER[i].budget[surface] < POWER[i - 1].budget[surface]) {
        // The ONE permitted decrease on the whole ladder is inferno's row: the top
        // level refuses the list surface, and that refusal IS the rule. Any other
        // decrease is a level that got poorer, and a ladder that gets poorer is not
        // a ladder.
        const isTheLaw = POWER[i].key === 'inferno' && surface === 'row';
        if (!isTheLaw) {
          problems.push(`${POWER[i].key} is weaker than ${POWER[i - 1].key} on ${surface}`);
        }
      }
    }
  }
  const mkeys = new Set();
  for (const m of MOTIFS) {
    if (mkeys.has(m.key)) problems.push(`two motifs share the key ${m.key}`);
    mkeys.add(m.key);
    if (!MOTIF_KINDS.includes(m.kind)) problems.push(`${m.key} has a kind nobody has: ${m.kind}`);
    if (powerIndex(m.minPower) < 0) problems.push(`${m.key} unlocks at a level the ladder does not have: ${m.minPower}`);
    if (typeof m.asset !== 'string' || !m.asset.startsWith('/img/cosmetics/')) {
      problems.push(`${m.key}'s asset is not a platform-drawn cosmetic: ${m.asset}`);
    }
    if (!m.treatment || !m.still) {
      problems.push(`${m.key} is missing its treatment or its still — a fallback nobody audited`);
    }
  }
  return problems;
}
