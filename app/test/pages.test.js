/**
 * Counting the pages — which is what makes a between-chapter gate possible at all.
 *
 * §5.3's planner was written against page counts ("a 40-page manhwa with two asks
 * after page 13 and page 27") and was being handed `files.length`, which for one CBZ
 * is 1. Nothing failed: a single-archive read simply could never carry a gate, and the
 * planner's own arithmetic was unreachable. These tests are the count, and the four
 * rules that decide it:
 *
 *   1. natural order (`10` after `9`) — the fix for archives that are not zero-padded;
 *   2. junk filtered and NOTHING else moved — a `cover.jpg` keeps its place;
 *   3. the word travels with the step ("chapter" for files, "page" inside an archive);
 *   4. an unreadable archive keeps its place in the sequence as a download.
 *
 * Then the gate geometry: segments are contiguous and exhaustive, a gate is a SEAM
 * between two of them, a cue past the last page is reported rather than fired, and a
 * deep link to page 40 still owes every gate before it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  naturalCompare, orderEntries, isJunkPath, isMetadataPath, pageMime,
  pagePlan, segmentsFor, gatesBefore, segmentFor, stepLabel, gateSentence,
  readMode, readDirection, __clearArchiveCache,
} from '../src/pages.js';
import { listArchive } from '../src/archive.js';

const file = (over = {}) => ({
  id: over.id || Math.random().toString(36).slice(2),
  filename: 'a.jpg', mime_type: 'image/jpeg', size_bytes: 10, sort_order: 0, ...over,
});

const archiveOf = (names) => {
  // Build a listing through the real reader so the fixture is an index, not a stub.
  const zip = [];
  void zip;
  return names;
};

test('natural order puts page 10 after page 9, and agrees with zero-padding', () => {
  const names = ['page10.jpg', 'page9.jpg', 'page2.jpg', 'page1.jpg'];
  assert.deepEqual(names.slice().sort(naturalCompare),
    ['page1.jpg', 'page2.jpg', 'page9.jpg', 'page10.jpg']);
  const padded = ['003.jpg', '010.jpg', '002.jpg'];
  assert.deepEqual(padded.slice().sort(naturalCompare), ['002.jpg', '003.jpg', '010.jpg']);
  // Case is not part of the order, and the tie is broken so the sort is total.
  assert.deepEqual(['B.jpg', 'a.jpg', 'a2.jpg'].slice().sort(naturalCompare), ['a.jpg', 'a2.jpg', 'B.jpg']);
  assert.equal(naturalCompare('same.jpg', 'same.jpg'), 0);
});

test('junk and metadata are dropped; a cover is not moved', () => {
  assert.equal(isJunkPath('__MACOSX/page-001.jpg'), true);
  assert.equal(isJunkPath('comic/._page-002.jpg'), true);
  assert.equal(isJunkPath('comic/.DS_Store'), true);
  assert.equal(isJunkPath('Thumbs.db'), true);
  assert.equal(isJunkPath('pages/page-003.jpg'), false, 'a folder called pages is fine');
  assert.equal(isMetadataPath('ComicInfo.xml'), true);
  assert.equal(isMetadataPath('comic/ComicInfo.xml'), true);
  assert.equal(isMetadataPath('page-001.jpg'), false);

  const entries = [
    { name: 'ComicInfo.xml', directory: false },
    { name: '__MACOSX/._cover.jpg', directory: false },
    { name: 'cover.jpg', directory: false },
    { name: 'page-10.jpg', directory: false },
    { name: 'page-2.jpg', directory: false },
    { name: 'notes.txt', directory: false },
    { name: 'pages/', directory: true },
  ].map((e, i) => ({ ...e, index: i, size: 1, method: 0, compressedSize: 1, localOffset: 0 }));
  assert.deepEqual(orderEntries(entries).map((e) => e.name),
    ['cover.jpg', 'page-2.jpg', 'page-10.jpg'],
    'the cover sorts first because "c" is before "p" — not because we moved it');
  assert.equal(pageMime('a.JPEG'), 'image/jpeg');
  assert.equal(pageMime('a.txt'), null);
});

test('a single archive is a flat page sequence, and the word is "page"', () => {
  const plan = pagePlan({
    files: [file({ id: 'z1', filename: 'vol-1.cbz' })],
    archives: { z1: { ok: true, pages: [{ name: 'p1.jpg' }, { name: 'p2.jpg' }, { name: 'p3.jpg' }] } },
  });
  assert.equal(plan.steps.length, 3);
  assert.equal(plan.chapters, 3, 'the planner is told three, not one');
  assert.equal(plan.flat, true);
  assert.deepEqual(plan.steps.map((s) => s.word), ['page', 'page', 'page']);
  assert.equal(stepLabel(plan, 2), 'Page 2 of 3');
  assert.equal(plan.drawable, 3);
});

test('files are chapters when there is more than one, and an archive is its own chapter', () => {
  const plan = pagePlan({
    files: [
      file({ id: 'f1', filename: 'ch-1.cbz' }),
      file({ id: 'f2', filename: 'ch-2.cbz' }),
      file({ id: 'f3', filename: 'ch-3.pdf' }),
    ],
    archives: {
      f1: { ok: true, pages: [{ name: 'a.jpg' }, { name: 'b.jpg' }] },
      f2: { ok: true, pages: [{ name: 'c.jpg' }] },
    },
  });
  assert.deepEqual(plan.steps.map((s) => [s.kind, s.word]),
    [['archive', 'page'], ['archive', 'page'], ['archive', 'page'], ['pdf', 'chapter']]);
  assert.equal(plan.chapters, 4);
  assert.equal(plan.flat, false);
  assert.equal(stepLabel(plan, 4), 'Chapter 4 of 4');
});

test('an archive that cannot be read keeps its place, with the sentence for why', () => {
  const plan = pagePlan({
    files: [
      file({ id: 'a', filename: 'chapter-1.cbz' }),
      file({ id: 'b', filename: 'chapter-2.cbz' }),
      file({ id: 'c', filename: 'chapter-3.cbz' }),
    ],
    archives: {
      a: { ok: true, pages: [{ name: '1.jpg' }, { name: '2.jpg' }] },
      b: { ok: false, reason: 'zip64' },
      c: { ok: true, pages: [] },
    },
  });
  assert.equal(plan.chapters, 4, 'the damaged chapter is still a chapter');
  assert.deepEqual(plan.steps.map((s) => s.kind), ['archive', 'archive', 'file', 'file']);
  assert.equal(plan.drawable, 2);
  assert.equal(plan.refusals.length, 2);
  assert.match(plan.refusals[0].sentence, /too large/);
  assert.match(plan.refusals[1].sentence, /no pages/);
});

test('segments are contiguous and exhaustive, and a gate is a seam', () => {
  const plan = pagePlan({
    files: [file({ id: 'z', filename: 'vol.cbz' })],
    archives: { z: { ok: true, pages: Array.from({ length: 40 }, (_, i) => ({ name: `p${i + 1}.jpg` })) } },
  });
  const cues = [
    { kind: 'between', atChapter: 13, atSec: null },
    { kind: 'between', atChapter: 27, atSec: null },
  ];
  const { segments, gates, unreachable } = segmentsFor(plan, cues);
  assert.equal(gates.length, 2);
  assert.equal(unreachable.length, 0);
  assert.deepEqual(segments.map((s) => [s.from, s.to, Boolean(s.gate)]),
    [[1, 13, true], [14, 27, true], [28, 40, false]]);
  // Exhaustive and contiguous: no page is in two segments or none.
  const covered = segments.flatMap((s) => Array.from({ length: s.steps }, (_, i) => s.from + i));
  assert.equal(covered.length, 40);
  assert.deepEqual(covered, Array.from({ length: 40 }, (_, i) => i + 1));
  assert.equal(segmentFor(segments, 13).gate.at, 13, 'page 13 is the last of its segment');
  assert.equal(segmentFor(segments, 14).from, 14, 'page 14 is the first of the next');
});

test('a gate past the last page is reported, never fired', () => {
  const plan = pagePlan({
    files: [file({ id: 'z', filename: 'vol.cbz' })],
    archives: { z: { ok: true, pages: Array.from({ length: 6 }, (_, i) => ({ name: `p${i + 1}.jpg` })) } },
  });
  const { segments, unreachable } = segmentsFor(plan, [
    { kind: 'between', atChapter: 4, atSec: null },
    { kind: 'between', atChapter: 6, atSec: null },   // after the last page: nothing
    { kind: 'between', atChapter: 9, atSec: null },   // beyond the file: nothing
  ]);
  assert.equal(segments.length, 2);
  assert.equal(segments[1].gate, null);
  assert.deepEqual(unreachable.map((c) => c.atChapter), [6, 9]);
});

test('a deep link owes every gate before it, not the last one', () => {
  const plan = pagePlan({
    files: [file({ id: 'z', filename: 'vol.cbz' })],
    archives: { z: { ok: true, pages: Array.from({ length: 40 }, (_, i) => ({ name: `p${i + 1}.jpg` })) } },
  });
  const { segments } = segmentsFor(plan, [
    { kind: 'between', atChapter: 13, atSec: null, label: 'After chapter 13' },
    { kind: 'between', atChapter: 27, atSec: null, label: 'After chapter 27' },
  ]);
  assert.deepEqual(gatesBefore(segments, 40).map((g) => g.at), [13, 27]);
  assert.deepEqual(gatesBefore(segments, 14).map((g) => g.at), [13]);
  assert.deepEqual(gatesBefore(segments, 13), [], 'the page AT the seam is before it');
  assert.deepEqual(gatesBefore(segments, 1), []);
});

test('the gate sentence uses the word the reader is looking at', () => {
  const flat = pagePlan({
    files: [file({ id: 'z', filename: 'vol.cbz' })],
    archives: { z: { ok: true, pages: Array.from({ length: 40 }, (_, i) => ({ name: `p${i + 1}.jpg` })) } },
  });
  assert.equal(gateSentence(flat, { atChapter: 13 }), 'One view after page 13.');
  const chapters = pagePlan({
    files: [file({ id: '1', filename: 'ch-1.pdf' }), file({ id: '2', filename: 'ch-2.pdf' })],
    archives: {},
  });
  assert.equal(gateSentence(chapters, { atChapter: 1 }), 'One view after chapter 1.');
});

test('the store decides how the reader presents the file, and nothing else does', () => {
  assert.equal(readMode('scroll'), 'scroll');
  assert.equal(readMode('page'), 'page');
  assert.equal(readMode('weird'), 'page');
  assert.equal(readMode(null), 'page');
  assert.equal(readDirection('rtl'), 'rtl');
  assert.equal(readDirection('ltr'), 'ltr');
  assert.equal(readDirection('down'), 'ltr');
});

test('the archive listing is cached by file and checksum, and a re-upload is not', async () => {
  __clearArchiveCache();
  let loads = 0;
  const loadBytes = async () => { loads += 1; return Buffer.from('not really a zip, but long enough to try'); };
  const { archiveIndexFor } = await import('../src/pages.js');
  const f = { id: 'x1', filename: 'a.cbz', size_bytes: 100, checksum: 'aaa', storage_key: 'private/00000000-0000-0000-0000-000000000000.cbz' };
  const first = await archiveIndexFor(f, loadBytes);
  const second = await archiveIndexFor(f, loadBytes);
  assert.equal(loads, 1, 'the count is not recomputed for every render');
  assert.equal(first, second);
  await archiveIndexFor({ ...f, checksum: 'bbb' }, loadBytes);
  assert.equal(loads, 2, 'a new checksum is a new archive');
  assert.equal(first.ok, false);
  assert.equal(first.reason, 'not-a-zip');
  assert.ok(first.sentence);
  // A file too big to open page by page is refused by the size we already know,
  // without reading a byte of it.
  let read = false;
  const refused = await archiveIndexFor(
    { ...f, id: 'x2', checksum: 'ccc', size_bytes: 900 * 1024 * 1024 },
    async () => { read = true; return Buffer.alloc(0); },
  );
  assert.equal(read, false);
  assert.equal(refused.reason, 'archive-too-big');
  // And a non-archive file is not looked at at all.
  assert.equal(await archiveIndexFor({ ...f, filename: 'a.jpg' }, loadBytes), null);
  void archiveOf;
});
