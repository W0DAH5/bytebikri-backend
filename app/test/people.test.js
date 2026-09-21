import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exportAll, csvCell, csvDocument, truncationNote } from '../src/export.js';
import { store } from '../src/store.js';
import * as views from '../src/views.js';

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

test('an export pages until the set is exhausted, not until the first page', async () => {
  // The bug this replaces: `perPage: 100, page: 1` sent whatever came back, so an
  // operator exporting 4,000 rows received 100 and a filename that did not say so.
  const all = Array.from({ length: 250 }, (_, i) => ({ id: i }));
  const calls = [];
  const out = await exportAll(async ({ page, perPage }) => {
    calls.push({ page, perPage });
    return { rows: all.slice((page - 1) * perPage, page * perPage), total: all.length };
  }, { perPage: 100 });

  assert.equal(out.rows.length, 250, 'every row is in the file');
  assert.equal(out.total, 250);
  assert.equal(out.truncated, false);
  assert.equal(calls.length, 3, 'three round trips: two full pages and the short one that ends it');
});

test('a set larger than the ceiling is cut, and the cut is reported', async () => {
  const out = await exportAll(async ({ page, perPage }) => ({
    rows: Array.from({ length: perPage }, (_, i) => ({ id: (page - 1) * perPage + i })),
    total: 12_000,
  }), { perPage: 100, maxRows: 250 });

  assert.equal(out.rows.length, 250, 'the ceiling is respected');
  assert.equal(out.total, 12_000, 'and the true total is carried out with it');
  assert.equal(out.truncated, true, 'so the caller cannot mistake the file for the whole set');

  const note = truncationNote(out);
  assert.equal(out.exported, 250, 'the result describes itself, so the note cannot be built from the wrong field');
  assert.match(note, /exported 250 of 12000 rows/, 'the note names both numbers');
  assert.match(note, /INCOMPLETE/, 'and says the file is incomplete in words');
  // The first version of this note interpolated the rows ARRAY, so the file
  // ended in "[object Object],[object Object]…". Assert the shape, not just the
  // presence: a count, and nothing that looks like an object.
  assert.ok(!/\[object/.test(note), 'the note carries a count, not the rows themselves');
  assert.equal(truncationNote({ truncated: true, total: 12, exported: 12 }), '',
    'equal counts mean nothing was left out, whatever the flag says');
  assert.match(truncationNote({ truncated: true, total: 0, exported: 5000 }),
    /the total is not known/,
    'a capped export with no reported total must still admit it: that is the case where an '
    + 'incomplete file looks complete');
  assert.equal(truncationNote({ truncated: false, total: 12, exported: 12 }), '',
    'a complete export carries no note, because there is nothing to admit');
});

test('an empty set does not become an infinite loop', async () => {
  let calls = 0;
  const out = await exportAll(async () => { calls += 1; return { rows: [], total: 0 }; });
  assert.equal(calls, 1);
  assert.equal(out.rows.length, 0);
  assert.equal(out.truncated, false);
});

test('a comma in a store name does not shift every column after it', () => {
  assert.equal(csvCell('Shop, and more'), '"Shop, and more"');
  assert.equal(csvCell('He said "hi"'), '"He said ""hi"""');
  assert.equal(csvCell('two\nlines'), '"two\nlines"');
  assert.equal(csvCell('plain'), 'plain');
  assert.equal(csvCell(null), '', 'a null is an empty field, never the string "null"');
  assert.equal(csvCell(0), '0', 'and a zero is a zero, not an empty field');

  const doc = csvDocument(['store', 'views'], [['Shop, and more', 12], ['Plain', 0]]);
  assert.equal(doc, 'store,views\n"Shop, and more",12\nPlain,0\n');
  assert.ok(doc.endsWith('\n'), 'a CSV that does not end in a newline loses its last row in some tools');
});

// ---------------------------------------------------------------------------
// The people directory
// ---------------------------------------------------------------------------

const SEGMENTS = views.PERSON_SEGMENTS.map((s) => s.key);

test('every segment the tabs offer is a segment the query can produce', async () => {
  // The tab list and the SQL CASE are the same vocabulary in two places, which is
  // the shape of bug that has already bitten this codebase once (a sitemap listing
  // two routes that 404). A renamed branch in the CASE would leave a tab that
  // counts nothing and never explains why.
  const produced = new Set();
  for (const key of SEGMENTS) {
    if (key === 'all') continue;
    const page = await store.peopleDirectory({ segment: key, perPage: 5 });
    for (const row of page.rows) produced.add(row.segment);
  }
  for (const row of (await store.peopleDirectory({ perPage: 100 })).rows) produced.add(row.segment);
  for (const seen of produced) {
    assert.ok(SEGMENTS.includes(seen),
      `the query produced segment "${seen}", which no tab offers — rename it in one place or the other`);
  }
});

test('the counts are over every account, not over the current filter', async () => {
  const all = await store.peopleDirectory({ perPage: 100 });
  const filtered = await store.peopleDirectory({ q: 'zzz-nobody-has-this', perPage: 5 });
  assert.equal(filtered.total, 0, 'the search matches nobody, by construction');
  assert.deepEqual(filtered.counts, all.counts,
    'a tab that says 3 and then shows nothing because a search is also active is a lie about the platform');
});

test('a page past the end is empty, not an error', async () => {
  const out = await store.peopleDirectory({ page: 99, perPage: 25 });
  assert.deepEqual(out.rows, []);
  assert.ok(out.pages >= 1, 'and the page count is never zero, which would read as "no pages"');
});

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const person = {
  id: '11111111-2222-3333-4444-555555555555', email: 'someone@example.com',
  display_name: 'Someone', role: 'user', banned: false, ban_reason: null, locale: 'ne',
  created_at: '2026-01-02T00:00:00Z', has_password: true, sold_by_on_file: true, phone_on_file: false,
};
const row = {
  ...person, stores: 1, files: 3, views_30d: 40, unlocks: 2, last_seen_at: '2026-01-09T00:00:00Z',
  live_sessions: 1, failed_7d: 0, segment: 'working',
};
const detail = (over = {}) => ({
  person, stores: [], unlocksHeld: 0,
  sessions: { total: 4, live: 1, last_seen: '2026-01-09T00:00:00Z', first_seen: '2026-01-02T00:00:00Z' },
  attempts: { failed_7d: 0, ok_30d: 4 }, decisions: [],
  ...over,
});

test('the directory renders counts, and links each row to the account', () => {
  const html = views.adminUsers({
    user: { role: 'admin', email: 'op@example.com', display_name: 'Op' },
    data: { rows: [row], total: 1, page: 1, pages: 1, perPage: 25, counts: { working: { n: 1, live: 1 } } },
    filters: { segment: 'all', sort: 'recent', q: '' },
  });
  assert.ok(html.includes('/admin/users/11111111-2222-3333-4444-555555555555'),
    'the row reaches the account record');
  for (const key of SEGMENTS) {
    if (key === 'all') {
      // Everyone is the unfiltered list, so its link carries no segment at all —
      // a URL that says ?segment=all is a second way to write the same page.
      assert.ok(html.includes('href="/admin/users"'), 'the Everyone tab links to the unfiltered list');
      continue;
    }
    assert.ok(html.includes(`segment=${key}`), `the ${key} tab is a link that filters`);
  }
  assert.match(html, /Counted, never listed|never listed/, 'the privacy stance is on the page, not in a comment');
  assert.match(html, /no KYC step/, 'and the absent badge is explained rather than faked');
});

test('an empty segment explains the segment, an empty search explains the search', () => {
  const blank = { rows: [], total: 0, page: 1, pages: 1, perPage: 25, counts: {} };
  const bySegment = views.adminUsers({
    user: { role: 'admin', email: 'op@example.com', display_name: 'Op' }, data: blank, filters: { segment: 'suspended', sort: 'recent', q: '' },
  });
  assert.match(bySegment, /Nobody is in this segment/, 'an empty segment is a fact about the platform');
  const bySearch = views.adminUsers({
    user: { role: 'admin', email: 'op@example.com', display_name: 'Op' }, data: blank, filters: { segment: 'all', sort: 'recent', q: 'nobody' },
  });
  assert.match(bySearch, /matching “nobody”/, 'an empty search is a fact about the search');
});

test('an account page shows what is on file, and refuses to invent what is not', () => {
  const html = views.adminUser({ user: { role: 'admin', email: 'op@example.com', display_name: 'Op' }, detail: detail() });
  assert.ok(html.includes(`/admin/users/${person.id}`), 'the decision form posts to this account');
  assert.match(html, /Suspend this account/);
  assert.match(html, /not given/, 'a phone number nobody gave reads as not given');
  assert.match(html, /No suspension, reinstatement or note/, 'and an untouched account says so plainly');

  // A suspended account must offer the way back, not the same action again.
  const banned = views.adminUser({
    user: { role: 'admin', email: 'op@example.com', display_name: 'Op' },
    detail: detail({ person: { ...person, banned: true, ban_reason: 'Rule 4' } }),
  });
  assert.match(banned, /Reinstate or record a decision/);
  assert.match(banned, /suspended/, 'and shows the state it is in');
});

test('an account that does not exist renders a page, not a crash', () => {
  const html = views.adminUser({ user: { role: 'admin', email: 'op@example.com', display_name: 'Op' }, detail: null });
  assert.match(html, /That account does not exist/);
  assert.ok(html.includes('href="/admin/users"'), 'with a way back to the list');
});
