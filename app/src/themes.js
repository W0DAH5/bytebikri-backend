/**
 * Storefront themes — the dress code a paying store can choose.
 *
 * This closes a gap with an uncomfortable history: `plans.capabilities.can_theme`
 * has been `false` on Free and `true` on Store and Pro since the FIRST migration,
 * and until now nothing in the product read it. The pricing page was selling a
 * theme — `planBenefits` did not even list it — while a seller who paid had no
 * theme to pick. A capability nothing reads is not a feature; it is a claim.
 *
 * WHY A FIXED SET AND NOT A COLOUR PICKER
 *
 * Gumroad's design tab is the model this follows: a curated list, and a preview
 * that updates as you choose (their help centre says exactly that — "pick one of
 * the six fonts… set your background and highlight colors… the preview updates as
 * you choose, so you can see the result before saving"). Linktree's pricing page
 * is the other half of the same lesson: curated themes come with the paid plan,
 * full customisation is the upsell, and the free tier keeps "basic themes".
 *
 * The reason to copy the first half and not the second is the one this codebase
 * keeps running into: a storefront whose text colour is chosen by the seller is a
 * page whose contrast no test can check. So every palette here is arithmetic —
 * `test/themes.test.js` composites white over each stop, and over the middle of each
 * gradient, and refuses to let a palette in that drops below 5.5:1 anywhere. A
 * seller picks a mood, not a hex code, and nobody's shopfront becomes unreadable
 * because of a choice they were allowed to make.
 *
 * WHAT A THEME ACTUALLY PAINTS, and why it is the band and only the band:
 *
 *   * the band behind the store's own header — the name, the tagline, the numbers,
 *     the badges and the follow button — as an OPAQUE gradient of the palette's two
 *     stops, with the text on it painted white;
 *   * nothing else. The files under it, the buttons on the file cards and the
 *     members' plates keep the product's colours, because a storefront is for
 *     looking at what is sold and a theme that recolours every button is a theme
 *     that fights the shop.
 *
 * An opaque band is the reason this feature can be checked at all. A band painted at
 * 10% over the page's surface would have to be measured against TWO surfaces (the
 * day one and the night one), and it would be nearly invisible on both. An opaque
 * band is the same in day and night, so each palette is measured ONCE per stop
 * against white — and white on a colour and that colour as ink on white are the same
 * ratio, which means one number per stop governs every word in the band, both
 * directions.
 *
 * So the palettes below are not chosen by eye and then checked. They are chosen so
 * that white clears 5.5:1 at BOTH ends and at the MIDDLE of the gradient, which
 * leaves room for the secondary ink in the band (92% white) to clear 4.5:1 too.
 * `test/themes.test.js` composites all three points and fails the build otherwise.
 * The reason to bother: this is the first feature here that a seller buys for how it
 * looks, which makes it the first one that can be made worse by taste alone.
 */
export const THEMES = {
  everest: {
    key: 'everest',
    label: 'Everest',
    note: 'Cold blue going indigo — the one that reads as "the hour before sunrise".',
    from: '#1e3a8a',
    to: '#4f46e5',
    animated: true,
  },
  mustang: {
    key: 'mustang',
    label: 'Mustang',
    note: 'Ochre into rust: warm and dry, the colours of the walls in Lo Manthang.',
    from: '#854d0e',
    to: '#9a3412',
    animated: false,
  },
  ilam: {
    key: 'ilam',
    label: 'Ilam',
    note: 'Tea green into deep teal. Quiet, and the one that flatters photographs.',
    from: '#065f46',
    to: '#115e59',
    animated: false,
  },
  rhododendron: {
    key: 'rhododendron',
    label: 'Rhododendron',
    note: 'Crimson into rose. Loud on purpose, for a store that wants to be noticed.',
    from: '#9f1239',
    to: '#be123c',
    animated: true,
  },
  monsoon: {
    key: 'monsoon',
    label: 'Monsoon',
    note: 'Sky into slate: the grey-blue of a Kathmandu afternoon in July.',
    from: '#075985',
    to: '#334155',
    animated: false,
  },
  himal: {
    key: 'himal',
    label: 'Himal',
    note: 'Violet into magenta — the brightest of the six, and the closest to a neon sign.',
    from: '#6d28d9',
    to: '#a21caf',
    animated: true,
  },
};

export const THEME_KEYS = Object.keys(THEMES);

/**
 * How much light the band's own decoration is allowed to add, as a fraction.
 *
 * The band's surface carries a grain layer (an inline `feTurbulence`, the cheapest
 * cure for the banding a large soft gradient shows on an 8-bit display) and two
 * drifting mesh layers. The mesh introduces NO new colour — it is painted out of the
 * theme's own two stops, so every point of it is a point of the interpolation the
 * palette test already measures. The grain is the only thing that can lift the
 * surface, and it is bounded here: the test composites this much white over every
 * sampled point of every palette and requires white text to still clear 5.5:1 and the
 * 92% secondary ink to still clear 4.5:1.
 *
 * It is not a taste decision. A decoration that lightens a band by an unbounded
 * amount is a decoration that can drop a heading below the floor on somebody's
 * screen at one particular frame of one particular loop.
 */
export const BAND_NOISE = 0.035;

/** The storefront as it has always looked. Not a theme: the absence of one. */
export const NO_THEME = 'plain';

/**
 * The white every word in the band is painted in, and the alpha the smaller words
 * are painted at.
 *
 * 92% for the tagline, the counts and the small print: enough of a step down from
 * the name to read as a hierarchy, not enough to matter to a contrast check. The
 * number lives here rather than in the stylesheet because the thing that decides is
 * the thing that gets measured, and the test composites at exactly this alpha.
 */
export const BAND_INK = '#ffffff';
export const BAND_ALPHA = 0.92;

export function themeOf(key) {
  return THEMES[String(key || '')] ?? null;
}

export function themeLabel(key) {
  return themeOf(key)?.label ?? 'Default';
}

/**
 * May this store choose a theme at all?
 *
 * Read from the plan's capabilities, which is where it has been sitting unused
 * since migration 0001. A free store gets the default storefront — which is the
 * storefront every store has today, not a degraded one — and the settings page
 * tells it what the plan would add rather than hiding the control.
 */
export function canTheme(capabilities = {}) {
  return capabilities?.can_theme === true;
}

/** Validate what the settings form posted. `null` = "keep what you have". */
export function themeDraft(value) {
  const key = String(value ?? '').trim();
  if (!key) return { ok: false, error: 'theme-missing', value: null };
  if (key === NO_THEME) return { ok: true, error: null, value: null };
  const theme = themeOf(key);
  if (!theme) return { ok: false, error: 'theme-unknown', value: null };
  return { ok: true, error: null, value: theme.key };
}

/**
 * The CSS custom properties a themed storefront needs.
 *
 * Returned as a style attribute rather than a class per theme, so adding a seventh
 * theme is one entry in the object above and nothing else — no stylesheet edit, no
 * selector to forget.
 */
export function themeStyle(key) {
  const t = themeOf(key);
  if (!t) return '';
  return `--theme-from:${t.from};--theme-to:${t.to};`;
}

/**
 * What the settings page says about the choice, in one sentence, because the
 * question a seller actually has is "does this show up on my files".
 */
export const THEME_NOTE =
  'The theme paints the band behind your store’s name — your name, your tagline, your numbers and your follow button — and nothing else. '
  + 'Your files, the buttons on them and your members’ plates keep the product’s own colours, so a shopfront never becomes harder to read because of a colour somebody chose. '
  + 'Every palette here carries white text at better than 5.5 to 1, which is why we offer six looks and not a colour picker.';

/** The line a free store sees — the honest version of "this is a paid feature". */
export const THEME_FREE_LINE =
  'Themes come with the Store plan. Your storefront keeps the default look, which is what every store has today — nothing is taken away by being on Free.';

/**
 * Motion is a property of the theme and not a separate switch, and every one of
 * them is gated by `prefers-reduced-motion`. Said out loud on the page, because
 * "will this move on my customers' phones" is a fair question to ask of a colour.
 */
export function motionNote(key) {
  const t = themeOf(key);
  if (!t) return 'The default storefront does not move.';
  return t.animated
    ? `${t.label} drifts slowly across the band. It stops entirely for anybody whose device asks for less motion, and the theme still shows.`
    : `${t.label} is a still gradient — it does not move at all.`;
}
