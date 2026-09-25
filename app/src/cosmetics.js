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
 * That is why there is no "card background" or "profile frame" slot in this file: on a
 * store's page the surface belongs to the store (it has themes), and on a person's own
 * page it belongs to the person (they have their own band on `/library`). A slot that
 * let either repaint the other's surface is the exact confusion the ownership
 * correction was about, and the research on premium looks says the same thing from the
 * other side: "if every role shimmers, none feel special".
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
 * picker and the write path all agree. Nothing else in the product has to learn about
 * it: the picker iterates this list, and the `/plus/look` route validates against it.
 */
import { ACCENTS, ACCENT_KEYS, GLYPHS, GLYPH_KEYS } from './memberships.js';
import { EFFECTS, EFFECT_KEYS } from './plus.js';
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
  return problems;
}
