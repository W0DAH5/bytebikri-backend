/**
 * Identity: what a store looks like when it is not just a word in a heading.
 *
 * `channels.logo_url` has been in the schema since migration 0008, commented
 * *"Optional — the UI falls back to the store initial"*, and nothing ever read it.
 * A storefront was a name in an `h1`, so a shop was indistinguishable from any other
 * shop that typed a different word, and Explore was a grid of cards with nothing of
 * the store on them. The mark this file tests is that missing fallback.
 *
 * Four properties, and each one is a rule rather than a preference:
 *
 *   1. DERIVED, IN BOTH SPELLINGS. `nima-crafts` and `Nima Crafts` are the same
 *      store and must wear the same mark, and it must be TWO letters — a single
 *      initial collides about 1 in 260 where two collide about 1 in 7000, which is
 *      the one number every generated-avatar implementation in the field repeats.
 *      Asserted on real rendered pages rather than on a helper, because the failure
 *      this guards against is a mark that exists but is never rendered.
 *   2. PAINTED IN THE STORE'S OWN TWO COLOURS, AND NO OTHERS. A themed store's tile
 *      is the band's inversion (`--theme-ink` surface, `--theme-from` ink) — the
 *      pair `themes.test.js` measures at twenty points of the palette
 *      interpolation — so the mark cannot introduce a colour no arithmetic has
 *      seen. Asserted from the stylesheet, where the paint lives.
 *   3. STILL. The band on the same page drifts; a mark that shimmered beside it
 *      would be two things asking for the same attention.
 *   4. A SECOND RENDERING OF THE NAME, NEVER A FIRST ONE. `aria-hidden`, because a
 *      screen reader that reads the store's name twice is the failure mode of every
 *      initial-letter component ever written.
 *
 * And the second half of the same slice, the STORE's own role icon — one shape,
 * inside the tier's chip, beside a member's name:
 *
 *   5. `currentColor`, OR NOTHING. A glyph is painted in exactly the ink the tier's
 *      own name is painted in, so it cannot be less readable than the word beside it.
 *      There is no glyph colour to check because there is no glyph colour.
 *   6. A CLOSED VOCABULARY, KEPT CLOSED IN TWO PLACES. The six keys in
 *      `memberships.js` and the six names in migration 0041's check constraint are
 *      compared here, because a database that refuses a key the code can produce is a
 *      save that fails for one seller in a thousand.
 *   7. THE STORE'S GLYPH STAYS THE STORE'S, on a member who also pays us. The two
 *      layers meet on one chip again, and the glyph is layer S's.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const views = await import('../src/views.js');
const { THEMES, themeStyle } = await import('../src/themes.js');
const { GLYPHS, GLYPH_KEYS, glyphOf, tierDraft, plateStyle } = await import('../src/memberships.js');
const { composeName } = await import('../src/plus.js');

const CSS = readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8');

/** The CSS block for a selector, so an assertion is about a rule and not a substring. */
function block(selector) {
  const at = CSS.indexOf(`\n${selector} {`);
  assert.ok(at > -1, `no rule for ${selector} in the stylesheet`);
  const open = CSS.indexOf('{', at);
  const close = CSS.indexOf('}', open);
  return CSS.slice(open + 1, close);
}

const CHANNEL = {
  id: 'c1', slug: 'alice', name: 'Alice’s Studio', tagline: 'Design templates.',
  owner_id: 'p1', banner_url: null, logo_url: null, listing_mode: 'marketplace',
};

function storefront(channel) {
  return views.storefront({
    channel, assets: [], slots: [], user: null, estimate: null, pageviews: 0,
    theme: channel.theme ?? null, themeStyle: channel.theme ? themeStyle(channel.theme) : '',
  });
}

test('the mark is derived from the store’s name, and it is two letters', () => {
  const twoWords = storefront({ ...CHANNEL, name: 'Alice Studio' });
  assert.match(twoWords, /class="store-mark"[^>]*>AS</, 'Alice Studio wears AS');

  // The same store, typed the other way. A mark that changes because a creator has a
  // hyphen in their slug is a mark that is not an identity.
  const slugged = storefront({ ...CHANNEL, name: 'nima-crafts' });
  assert.match(slugged, /class="store-mark"[^>]*>NC</, 'nima-crafts wears NC');

  const possessive = storefront({ ...CHANNEL, name: 'Alice’s Studio' });
  assert.match(possessive, /class="store-mark"[^>]*>AS</, 'the apostrophe is not a letter');
});

test('the mark is on the storefront, on the seller’s stage, and on every card in Explore', () => {
  const head = storefront(CHANNEL);
  // The header row, not merely somewhere on the page: this is a lockup with the name.
  assert.match(head, /<div class="row">\s*<span class="store-mark"[^>]*>AS<\/span>\s*<h1>/,
    'the storefront header carries the mark beside the name');

  const settings = views.storeSettings({
    channel: { ...CHANNEL, theme: 'everest' }, user: { id: 'p1', display_name: 'Alice' },
    plan: { code: 'store', name: 'Store', capabilities: { can_theme: true, memberships: true } },
    themes: Object.values(THEMES), canTheme: true, stats: {},
    subscription: null, capabilities: { can_theme: true, memberships: true },
  });
  assert.match(settings, /data-theme-stage-band[^>]*>\s*<div class="row">\s*<span class="store-mark store-mark--themed"/,
    'the seller’s stage shows the store’s own mark');

  const explore = views.marketplace({ channels: [{ ...CHANNEL, asset_count: 0, plan_code: 'free' }], user: null });
  assert.match(explore, /class="card card-interactive channel-card"[\s\S]*?class="store-mark"[^>]*>AS</,
    'a card in Explore carries the store’s mark');
});

test('a themed store’s mark is painted in the band’s own pair, and nothing else', () => {
  const themed = storefront({ ...CHANNEL, theme: 'everest' });
  const everest = THEMES.everest;
  assert.match(themed, new RegExp(`class="store-mark store-mark--themed" style="--theme-from:${everest.from};--theme-to:${everest.to};"`),
    'the mark carries exactly the two properties the band carries');

  // And the stylesheet agrees, which is where the paint actually happens: the tile is
  // the band's INK and the letter is the band's DEEP STOP — the inversion the band's
  // own pills and buttons already use at the ratio the palette test measures.
  const rule = block('.store-mark--themed');
  assert.match(rule, /background:\s*var\(--theme-ink/, 'the surface is the band’s ink');
  assert.match(rule, /color:\s*var\(--theme-from/, 'the letter is the band’s deep stop');
  for (const stranger of ['--theme-to', '--plate-a', '--plate-b', 'white', '#fff ']) {
    assert.ok(!rule.includes(stranger),
      `the mark’s rule names ${stranger}, which is a colour the palette test does not govern here`);
  }
});

test('an unthemed store still gets a mark — identity is not what the plan buys', () => {
  const plain = storefront(CHANNEL);
  assert.match(plain, /class="store-mark"/, 'a store with no theme has a mark');
  assert.ok(!plain.includes('store-mark--themed'), 'and it is not painted as a themed one');
  // The neutral tile is the one this product already draws for a person.
  const rule = block('.store-mark');
  assert.match(rule, /background:\s*var\(--surface-overlay\)/);
  assert.match(rule, /color:\s*var\(--text-secondary\)/);
});

test('the seller’s stage lets the band paint the mark, so a hover repaints both', () => {
  const settings = views.storeSettings({
    channel: { ...CHANNEL, theme: 'everest' }, user: { id: 'p1', display_name: 'Alice' },
    plan: { code: 'store', name: 'Store', capabilities: { can_theme: true, memberships: true } },
    themes: Object.values(THEMES), canTheme: true, stats: {},
    subscription: null, capabilities: { can_theme: true, memberships: true },
  });
  const markTag = settings.match(/<span class="store-mark[^"]*"[^>]*>/)[0];
  assert.ok(!markTag.includes('--theme-from'),
    'the stage’s mark carries no inline palette: it inherits the band’s, which the card hover repaints');
});

test('a logo is honoured when a store has one, and the mark survives without it', () => {
  const withLogo = storefront({ ...CHANNEL, logo_url: 'https://cdn.example/logo.png' });
  assert.match(withLogo, /class="store-mark"[^>]*aria-hidden="true"><img src="https:\/\/cdn\.example\/logo\.png"/,
    'the logo replaces the letters');
  assert.match(withLogo, /<h1>Alice’s Studio<\/h1>/,
    'and the name is still the accessible text');
});

test('the mark is a plate, it is a second rendering of the name, and it does not move', () => {
  const rule = block('.store-mark');
  assert.match(rule, /border-radius:\s*var\(--radius-lg\)/,
    'a store is a rounded plate, not a circle — a circle is a person in this product');
  assert.ok(!rule.includes('--radius-full'), 'and never the avatar’s full round');
  assert.ok(!/animation|transition/.test(rule), 'the mark is still: the band is what moves');
  const head = storefront(CHANNEL);
  const tag = head.match(/<span class="store-mark[^"]*"[^>]*>/)[0];
  assert.match(tag, /aria-hidden="true"/,
    'screen readers hear the store’s name once, from the heading');
});

// ── the tier's glyph ────────────────────────────────────────────────────────────

const TIERS = [
  { tier_no: 1, name: 'Friend', dues_npr: 150, period_months: 1, perks: null, accent: 'teal', glyph: null, join_mode: 'both', ad_mode: 'ad_free' },
  { tier_no: 2, name: 'Elite', dues_npr: 600, period_months: 3, perks: null, accent: 'rose', glyph: 'peak', join_mode: 'dues', ad_mode: 'ad_free' },
];

test('the vocabulary is closed in two places, and the two agree', () => {
  const sql = readFileSync(new URL('../../db/migrations/0041_tier_glyph.sql', import.meta.url), 'utf8');
  const list = sql.match(/glyph in \(([^)]+)\)/);
  assert.ok(list, 'the migration does not name the shapes it accepts');
  const inSql = list[1].split(',').map((x) => x.trim().replace(/'/g, ''));
  assert.deepEqual(inSql, GLYPH_KEYS,
    'the database’s list of shapes and the module’s list of shapes have drifted');
  assert.equal(GLYPH_KEYS.length, 6);
  for (const key of GLYPH_KEYS) {
    assert.match(block(`.tier-glyph[data-glyph="${key}"]`), /clip-path:\s*polygon\(/,
      `${key} has no shape in the stylesheet, so it would render as a bare square`);
  }
});

test('a glyph is painted in the ink of the word beside it, never a colour of its own', () => {
  const rule = block('.tier-glyph');
  assert.match(rule, /background:\s*currentColor/,
    'the glyph inherits the ink of whatever it sits in');
  assert.ok(!/#|rgb|hsl|color-mix/.test(rule),
    'and names no colour of its own — there is no second contrast question here');
});

test('the chip carries the store’s glyph inside it, before the tier’s name', () => {
  const html = views.storefront({
    channel: { ...CHANNEL, name: 'nima-crafts' }, assets: [], slots: [], user: null,
    estimate: null, pageviews: 0, tiers: TIERS, membershipsOn: true,
    // `profile_id` is what the section filters a viewer’s own row out by, so a row
    // without one is a row that never renders — which is exactly how the first
    // version of this test passed its chip assertions off the tier card’s sample.
    roster: [
      { profile_id: 'p2', display_name: 'Alice', tier_no: 2, tier_name: 'Elite', accent: 'rose', glyph: 'peak', joined_at: '2026-09-01T00:00:00Z' },
      { profile_id: 'p3', display_name: 'Bob', tier_no: 1, tier_name: 'Friend', accent: 'teal', glyph: null, joined_at: '2026-09-02T00:00:00Z' },
    ],
  });
  // INSIDE THE ROSTER, not merely somewhere on the page: the tier CARD carries a
  // sample chip of its own, so an unscoped assertion here is answered by the card and
  // the one surface the shape exists for — a member's name — can be missing it.
  assert.match(html,
    /<ul class="member-roster">[\s\S]*?class="store-chip store-chip--top"[^>]*><span class="tier-glyph" data-glyph="peak" aria-hidden="true"><\/span>Elite<\/span>/,
    'the top tier’s chip wears its shape on the roster');
  // The tier with no glyph renders exactly the chip it rendered before this slice.
  assert.match(html, /<ul class="member-roster">[\s\S]*?store-chip[^>]*>Friend<\/span>[\s\S]*?<\/ul>/,
    'a tier with no mark is unchanged, in the roster');
  assert.ok(!/<ul class="member-roster">[\s\S]*?data-glyph="[a-z]*"[\s\S]*?<\/span>Friend/.test(html),
    'and no shape leaks onto the tier that chose none');
});

test('the seller picks the shape from the shapes, and the saved one is the chosen one', () => {
  const html = views.channelMembers({
    channel: { ...CHANNEL, theme: null }, user: { id: 'p1', display_name: 'nima' },
    tiers: TIERS, members: [], pending: [], membershipsOn: true,
    plan: { code: 'store', name: 'Store', capabilities: { memberships: true } }, files: [],
  });
  for (const key of GLYPH_KEYS) {
    assert.match(html, new RegExp(`<input type="radio" name="glyph" value="${key}"`),
      `the picker does not offer ${key}`);
    assert.match(html, new RegExp(`title="${GLYPHS[key].label}"`), `the ${key} tile has no name`);
  }
  assert.match(html, /<input type="radio" name="glyph" value="">/,
    'and "no mark" is a tile like any other, not a missing option');
  // The elite tier holds `peak` and the entry tier holds none, so each editor shows
  // its own choice as the chosen one — the page edits BOTH tiers, which is why this
  // counts rather than looking for a single winner.
  assert.match(html, /<label class="glyph-choice glyph-choice--on"[\s\S]{0,200}?name="glyph" value="peak" checked>/,
    'the elite tier’s saved shape is the one its editor shows as chosen');
  assert.match(html, /<label class="glyph-choice glyph-choice--on"[\s\S]{0,200}?name="glyph" value="" checked>/,
    'and the entry tier’s “no mark” is too');
  assert.equal((html.match(/glyph-choice--on/g) || []).length, 2, 'one chosen tile per tier editor');
  assert.equal((html.match(/value="peak" checked/g) || []).length, 1, 'and no second tile claims it');
});

test('an unknown shape is no shape, and clearing one is possible', () => {
  const base = { name: 'Elite', duesNpr: 600, periodMonths: 3, accent: 'rose' };
  assert.equal(tierDraft({ ...base, glyph: 'star' }).value.glyph, 'star');
  assert.equal(tierDraft({ ...base, glyph: 'thunder' }).value.glyph, null,
    'a key nobody drew is refused rather than styled into a bare square');
  assert.equal(tierDraft({ ...base, glyph: '' }).value.glyph, null, 'and none is a choice');
  assert.deepEqual(glyphOf('nonsense'), null);
  assert.equal(glyphOf('hex').label, 'Hexagon');
});

test('the store’s glyph belongs to the store, even on a member who also pays us', () => {
  const plusRow = {
    plus_active: true, nameplate: 'teal', plus_effect: 'halo',
    // A person's own row has no glyph, and a hand-made one must not become the
    // store's: the chip's shape is read from the TIER, and from nowhere else.
    glyph: 'star',
  };
  const layers = composeName({ plus: plusRow, tier: TIERS[1] });
  assert.equal(layers.chip.glyph, 'peak', 'the chip wears the creator’s shape for that tier');
  assert.equal(layers.chip.palette, 'rose', 'and the creator’s palette for it');
  assert.equal(layers.name.effect, 'halo', 'while the name keeps the member’s own look');
  const bare = composeName({ plus: plusRow, tier: TIERS[0] });
  assert.equal(bare.chip.glyph, null, 'a tier with no shape gives the chip no shape');
  assert.equal(composeName({ tier: null }).chip, null, 'and no tier means no chip at all');
  assert.equal(plateStyle(2), 'gradient', 'the shine rule is untouched by the glyph');
  assert.equal(plateStyle(1), 'solid');
});
