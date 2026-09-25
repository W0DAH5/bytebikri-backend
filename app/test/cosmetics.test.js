/**
 * The cosmetics engine.  npm test
 *
 * The engine is a declaration: every look on this platform is one of a handful of
 * SLOTS, each owned by somebody, each with its values and its words. The tests here
 * are what make the declaration true rather than decorative — the catalog against the
 * database that stores it, the catalog against the picker that draws it, and the
 * ownership rule against the schema itself.
 *
 * The rule, stated once more because every assertion below is a form of it: a
 * decoration belongs to the owner of the thing it decorates. A person's look is
 * granted by bytebikri and travels with their name; a store's look belongs to the store
 * and lives on the store's own page. Neither may grant the other's, and no slot may be
 * added without a column, a control and a write path — which is what the last three
 * tests check.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:55432/bytebikri_test';

const { close, query } = await import('../src/db.js');
const {
  SLOTS, SLOT_KEYS, OWNERS, personSlots, storeSlots, slotOf, itemOf, catalogProblems, LOOK_FIELDS,
} = await import('../src/cosmetics.js');
const { ACCENT_KEYS } = await import('../src/memberships.js');
const { EFFECT_KEYS, RING_KEYS, FRAME_KEYS, ringClass, frameClass } = await import('../src/plus.js');
const { THEME_KEYS } = await import('../src/themes.js');
const views = await import('../src/views.js');

after(async () => { await close(); });

/** The values a CHECK constraint refuses and allows, read out of Postgres itself. */
async function checkList(table, column) {
  const { rows } = await query(
    `select pg_get_constraintdef(c.oid) as def
       from pg_constraint c
      where c.conrelid = $1::regclass and c.contype = 'c'
        and pg_get_constraintdef(c.oid) like '%' || $2 || '%'`,
    [table, column],
  );
  if (!rows.length) return null;
  const list = rows[0].def.match(/ARRAY\[([^\]]+)\]/);
  if (!list) return [];
  return [...list[1].matchAll(/'([^']+)'::text/g)].map((m) => m[1]);
}

/** Every table that has a column of this name. A slot's column has exactly one owner. */
async function tablesWithColumn(column) {
  const { rows } = await query(
    `select table_name from information_schema.columns
      where table_schema = 'public' and column_name = $1
      order by table_name`,
    [column],
  );
  return rows.map((r) => r.table_name);
}

test('the catalog is well-formed: every slot has an owner, and every value has words', () => {
  assert.deepEqual(catalogProblems(), []);
  assert.ok(SLOTS.length >= 4, 'the catalog lost a slot');
  assert.equal(new Set(SLOT_KEYS).size, SLOT_KEYS.length, 'two slots share a key');
  for (const slot of SLOTS) {
    assert.ok(OWNERS.includes(slot.owner), `${slot.key} has no real owner`);
    assert.ok(slot.grant, `${slot.key} does not say who may grant it`);
  }
  // A slot whose values include something that moves must say so per value: the person
  // choosing needs to know before they choose, not after.
  for (const slot of personSlots()) {
    for (const v of slot.values) assert.equal(typeof v.moves, 'boolean');
  }
});

test('every value the database will accept is a value in the catalog, and the reverse', async () => {
  // The effects and the tier glyphs are the two slots the schema refuses by name, so
  // these two are checked against Postgres rather than against a copy of a list.
  const effects = await checkList('profiles', 'plus_effect');
  assert.deepEqual(effects, EFFECT_KEYS, 'the effect slot and profiles.plus_effect have drifted');
  assert.deepEqual(slotOf('effect').values.map((v) => v.key), EFFECT_KEYS);

  const glyphs = await checkList('membership_tiers', 'glyph');
  assert.deepEqual(glyphs, slotOf('glyph').values.map((v) => v.key),
    'the glyph slot and membership_tiers.glyph have drifted');

  // The palette slot has NO check constraint, and that absence is the reason the
  // catalog has to be the allowlist: `store.setPlusLook` refuses anything not in it, and
  // `plus.test.js` covers that write path. Asserted here so a later migration that adds
  // a constraint learns that a list now lives in two places.
  assert.equal(await checkList('profiles', 'nameplate'), null,
    'profiles.nameplate gained a check constraint — the catalog is no longer the only list');
  assert.deepEqual(slotOf('nameplate').values.map((v) => v.key), ACCENT_KEYS);

  // The store's band is the sixth value of `THEME_KEYS` plus the plain default, and its
  // values are the themes the stylesheet and `themes.test.js` already govern.
  assert.deepEqual(slotOf('theme').values.map((v) => v.key), THEME_KEYS);
});

test('a slot lives with its owner in the schema, not only in this file', async () => {
  // A person's slot is stored on the person; a store's slot is stored on something the
  // store owns. This is the ownership correction as a schema assertion: if a store-side
  // column ever appeared on `profiles`, a store could decorate a person.
  for (const slot of personSlots()) {
    const tables = await tablesWithColumn(slot.column);
    assert.deepEqual(tables, ['profiles'],
      `${slot.key} is stored on ${tables.join(', ')} — a person's slot belongs on the person`);
  }
  for (const slot of storeSlots()) {
    const tables = await tablesWithColumn(slot.column);
    assert.ok(tables.length, `${slot.key} names a column that does not exist: ${slot.column}`);
    assert.ok(!tables.includes('profiles'),
      `${slot.key} is stored on profiles — a store's slot on a person is a store decorating somebody`);
  }
});

test('only bytebikri grants a person’s slot, and no store can give one away', () => {
  for (const slot of personSlots()) {
    assert.equal(slot.grant, 'plus', `${slot.key} is granted by ${slot.grant}`);
  }
  for (const slot of storeSlots()) {
    assert.ok(['creator', 'store-plan'].includes(slot.grant),
      `${slot.key} is a store slot granted by ${slot.grant}`);
  }
  // And the two sets do not overlap: there is no slot both a person wears and a store
  // sets, because that is a slot with two owners and one of them will always be wrong.
  const person = new Set(personSlots().map((s) => s.key));
  for (const slot of storeSlots()) assert.ok(!person.has(slot.key), `${slot.key} has two owners`);
});

test('the picker draws every slot a person wears, and nothing else', async () => {
  const html = views.plusPage({
    user: { id: 'p1', email: 'cosmetics@test.local', display_name: 'Nima', email_verified_at: '2026-01-01' },
    plan: { code: 'plus', name: 'ByteBikri Plus', price_npr: 149, period_months: 1 },
    state: 'none', rails: [], gifts: [],
  });
  for (const slot of personSlots()) {
    assert.match(html, new RegExp(`aria-labelledby="plus-${slot.key}-label"`),
      `the picker has no control for the ${slot.key} slot`);
    assert.match(html, new RegExp(`>${slot.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}<`),
      `the picker does not name the ${slot.key} slot`);
    for (const value of slot.values) {
      assert.match(html, new RegExp(`name="${slot.key}" value="${value.key}"`),
        `${slot.key}.${value.key} is in the catalog and not in the picker`);
    }
  }
  // Exactly ONE value per slot comes back checked, always. A radio group with nothing
  // selected submits nothing, and the route refuses a slot with no value — so a person
  // who had never opened the picker could not save their look at all, which is the bug
  // this assertion was written for. What is pre-checked is what the product is drawing
  // for them right now: the orbiting ring the account chip already carries, and the
  // card's own plain edge.
  for (const slot of personSlots()) {
    const checked = (html.match(new RegExp(`name="${slot.key}" value="[^"]+" checked`, 'g')) || []).length;
    assert.equal(checked, 1, `${slot.key} comes back with ${checked} values checked, not one`);
  }

  // The route and the picker are the same list: a field the route reads that the picker
  // does not draw is a slot a person can never choose.
  assert.deepEqual(LOOK_FIELDS, personSlots().map((s) => s.key));
  for (const key of LOOK_FIELDS) assert.match(html, new RegExp(`name="${key}"`));
});

test('a new slot cannot ship without a place to store it', () => {
  // The write path is read as source on purpose: `setPlusLook` names its columns in SQL,
  // and a slot declared in the catalog but absent from that statement would be a look
  // that saves and does not stick — the failure mode this whole file exists to prevent.
  const src = readFileSync(new URL('../src/store.js', import.meta.url), 'utf8');
  const at = src.indexOf('setPlusLook(');
  assert.ok(at > -1, 'setPlusLook is gone');
  const body = src.slice(at, src.indexOf('\n  },', at));
  for (const slot of personSlots()) {
    assert.ok(body.includes(slot.column),
      `setPlusLook does not write ${slot.column} — the ${slot.key} slot would save and not stick`);
  }
  // And the route validates against the catalog rather than a second list.
  const server = readFileSync(new URL('../server.js', import.meta.url), 'utf8');
  assert.match(server, /for \(const slot of personSlots\(\)\)/,
    'the look route stopped validating against the catalog');
});

test('the two outer layers are checked by name in the database, like the effects', async () => {
  // The ring and the frame arrived in 0044 with their own vocabulary, so the migration
  // is a second list and this is the assertion that keeps it the same list. The
  // nameplate deliberately still has none — see the test above — so each slot is
  // checked for the arrangement it actually has rather than for a house style.
  const rings = await checkList('profiles', 'plus_ring');
  assert.deepEqual(rings, RING_KEYS, 'the ring slot and profiles.plus_ring have drifted');
  assert.deepEqual(slotOf('ring').values.map((v) => v.key), RING_KEYS);

  const frames = await checkList('profiles', 'plus_frame');
  assert.deepEqual(frames, FRAME_KEYS, 'the frame slot and profiles.plus_frame have drifted');
  assert.deepEqual(slotOf('frame').values.map((v) => v.key), FRAME_KEYS);
});

test('no choice is not the same as choosing nothing, for either outer layer', () => {
  // A person who has never opened the picker keeps the ring this product has always
  // drawn. A person who chose "no ring" gets none. The two must not collapse into one
  // class, or the slot would take a decoration away from somebody who never asked.
  assert.equal(ringClass(null), 'wear-ring', 'the default ring changed for people who never chose');
  assert.equal(ringClass(undefined), 'wear-ring');
  assert.equal(ringClass('none'), 'ring-none');
  assert.equal(ringClass('hairline'), 'ring-hairline');
  assert.equal(ringClass('orbit'), 'wear-ring', 'orbit IS the ring the product already draws');
  assert.equal(ringClass('double'), 'ring-double');
  assert.equal(new Set(RING_KEYS.map(ringClass)).size, RING_KEYS.length,
    'two ring values render identically — four choices must be four rings');

  // A frame has no such history: every card already has an edge, so "not chosen" and
  // "none" are the same rendering, and only the three decorated values have a class.
  assert.equal(frameClass(null), '');
  assert.equal(frameClass('none'), '');
  for (const key of ['hairline', 'double', 'glow']) {
    assert.equal(frameClass(key), `frame-${key}`);
  }
  assert.equal(new Set(['hairline', 'double', 'glow'].map(frameClass)).size, 3);
});

test('a frame decorates an edge and can never repaint the card', () => {
  // The rule this enforces is the ownership one: the surface under a name belongs to
  // whoever owns the page. A frame that set `background` or `color` could change what
  // the ink sits on — and the contrast arithmetic that governs every name on this
  // platform would no longer describe the page. Read as source, because that is the
  // only place a CSS declaration can be checked without rendering.
  const css = readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8');
  const rules = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)]
    .filter(([, selector]) => /\.frame-(hairline|double|glow)\b/.test(selector));
  assert.ok(rules.length >= 4, 'the frame rules went missing');
  for (const [, selector, body] of rules) {
    assert.ok(!/\bbackground(-color|-image)?\s*:/.test(body),
      `${selector.trim()} sets a background — the frame is an edge, not a surface`);
    assert.ok(!/(^|[;{\s])color\s*:/.test(body),
      `${selector.trim()} sets a text colour — the frame is an edge, not a surface`);
  }
  // And the frame classes are on the person's card, not on a store's surface: the store
  // band's own block must not have learned about frames.
  const bandStart = css.indexOf('.own-band--themed');
  const bandEnd = css.indexOf('@keyframes', bandStart);
  assert.ok(!/frame-/.test(css.slice(bandStart, bandEnd)), 'the store’s own band grew a frame');
});

test('a slot item is looked up by its own keys, and an unknown key is nothing', () => {
  assert.equal(itemOf('nameplate', 'indigo').label, 'Indigo');
  assert.equal(itemOf('effect', 'prism').moves, true);
  assert.equal(itemOf('effect', 'solid').moves, false);
  assert.equal(itemOf('effect', 'nope'), null);
  assert.equal(itemOf('nope', 'solid'), null);
  assert.equal(slotOf('nope'), null);
});
