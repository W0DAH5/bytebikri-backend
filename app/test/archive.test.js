/**
 * Reading a seller's archive.
 *
 * A CBZ is the one input in this product that arrives as bytes somebody else's
 * software wrote, and every failure mode here is invisible until it is a blank
 * page in front of a reader. So the fixtures are written by hand at the byte level
 * — not by this repository's own code, and not by a library that would share a
 * mistake with the reader — and each one exists to pin a thing that really happens
 * in the wild:
 *
 *   1. **A data descriptor.** ZIP writers that stream an entry write the sizes at
 *      the END of the entry and put zeroes in the local header. Reading the local
 *      header (the intuitive thing) renders every page of a valid comic as nothing.
 *   2. **A local extra field of a different length from the central one.** Writers
 *      put alignment padding in one and not the other, so the entry's data does not
 *      start at a fixed offset from either header.
 *   3. **Both methods.** `STORED` is the CBZ convention because images are already
 *      compressed; `DEFLATE` is permitted and common. A reader that handles one is a
 *      reader that fails on a third of a real library.
 *   4. **A lying index.** A zip bomb claims to be small. The cap has to hold during
 *      the inflate, not because the index was trusted.
 *
 * Plus the refusals: not a zip, a ZIP64 marker, an archive past its caps, a name
 * that looks like a path traversal. The last one is asserted as a *property* rather
 * than as a sanitizer, because this reader never turns a name into a path at all.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { listArchive, readEntry, ZIP_CAPS, archiveSentence } from '../src/archive.js';
import { makeZip } from './helpers/zip.mjs';

// ---------------------------------------------------------------------------
// The fixtures: a zip writer that lives beside the tests that need one.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// The index
// ---------------------------------------------------------------------------

test('the index lists entries with both sizes, and a descriptor entry still reads', () => {
  const zip = makeZip([
    { name: 'page-001.jpg', data: 'FIRST', method: 0 },
    { name: 'page-002.jpg', data: 'SECOND', method: 8, descriptor: true },
  ]);
  const index = listArchive(zip);
  assert.equal(index.ok, true);
  assert.equal(index.entries.length, 2);
  assert.deepEqual(index.entries.map((e) => e.name), ['page-001.jpg', 'page-002.jpg']);
  assert.equal(index.entries[0].size, 5);
  assert.equal(index.entries[1].descriptor, true, 'bit 3 is recorded rather than trusted');

  // The descriptor entry's local header has zero sizes — the index is the only place
  // the real ones exist, and the data offset still has to come from the LOCAL header.
  const read = readEntry(zip, index.entries[1]);
  assert.equal(read.ok, true);
  assert.equal(read.bytes.toString('utf8'), 'SECOND');
});

test('stored and deflated entries both come back byte-for-byte', () => {
  const payload = Buffer.from('a page that is not text, really — ÿ', 'utf8');
  const zip = makeZip([
    { name: 'a.jpg', data: payload, method: 0 },
    { name: 'b.jpg', data: payload, method: 8 },
  ]);
  const index = listArchive(zip);
  assert.equal(index.ok, true);
  for (const entry of index.entries) {
    const read = readEntry(zip, entry);
    assert.equal(read.ok, true, `${entry.name} reads`);
    assert.deepEqual(read.bytes, payload, `${entry.name} is unchanged`);
  }
});

test('a bomb is refused while it inflates, not after', () => {
  // 40 MB of zeroes, deflated, with an index that CLAIMS one kilobyte. The declared
  // size passes the cap check; the inflater's own limit is what has to hold.
  const big = Buffer.alloc(40 * 1024 * 1024, 0);
  const zip = makeZip([{ name: 'bomb.jpg', data: big, method: 8, lieSize: 1024 }]);
  const index = listArchive(zip);
  assert.equal(index.ok, true, 'the index itself is well-formed');
  const read = readEntry(zip, index.entries[0]);
  assert.equal(read.ok, false);
  assert.equal(read.reason, 'entry-too-big');
});

test('an entry the index says is too big is refused without inflating it', () => {
  const zip = makeZip([{ name: 'huge.jpg', data: Buffer.from('tiny'), method: 0, lieSize: 64 * 1024 * 1024 }]);
  const index = listArchive(zip);
  assert.equal(index.ok, false);
  assert.equal(index.reason, 'entry-too-big');
});

test('ZIP64 and non-archives are refusals with sentences, not exceptions', () => {
  const zip64 = makeZip([{ name: 'a.jpg', data: 'x', method: 0 }], {
    eocdPatch: (eocd) => { eocd.writeUInt16LE(0xffff, 10); },
  });
  assert.deepEqual(
    { ok: listArchive(zip64).ok, reason: listArchive(zip64).reason },
    { ok: false, reason: 'zip64' },
  );
  for (const [input, reason] of [
    [Buffer.from('not a zip at all, just some bytes that are long enough'), 'not-a-zip'],
    [Buffer.alloc(0), 'not-a-zip'],
    [makeZip([{ name: 'a.jpg', data: 'x' }]).subarray(0, 40), 'not-a-zip'],
  ]) {
    const result = listArchive(input);
    assert.equal(result.ok, false);
    assert.equal(result.reason, reason);
  }
  // Every reason this module can produce has a sentence — a refusal a page cannot
  // print is a blank screen with extra steps.
  for (const reason of ['not-a-zip', 'truncated', 'zip64', 'empty', 'too-many-pages',
    'entry-too-big', 'archive-too-big', 'unsupported-method', 'corrupt', 'unreadable']) {
    assert.match(archiveSentence(reason), /(download|reader|archive|page)/i, `${reason} has words`);
  }
});

test('too many entries is refused by count, before any of them is read', () => {
  const entries = Array.from({ length: ZIP_CAPS.maxEntries + 1 }, (_, i) => ({
    name: `p${i}.jpg`, data: 'x', method: 0,
  }));
  // Only the index is built here (the writer is O(n) on tiny entries).
  const index = listArchive(makeZip(entries));
  assert.equal(index.ok, false);
  assert.equal(index.reason, 'too-many-pages');
});

test('path traversal is a label, not a path — nothing is written or resolved', () => {
  const zip = makeZip([
    { name: '../../etc/passwd', data: 'root:x:0:0', method: 0 },
    { name: '/absolute/evil.jpg', data: 'x', method: 0 },
  ]);
  const index = listArchive(zip);
  assert.equal(index.ok, true);
  // Both names survive as strings; the module has no filesystem in it at all, so
  // there is nothing a name could be joined to.
  assert.deepEqual(index.entries.map((e) => e.name), ['../../etc/passwd', '/absolute/evil.jpg']);
  assert.equal(readEntry(zip, index.entries[0]).bytes.toString('utf8'), 'root:x:0:0');
});

test('an archive written by another tool reads the same way', (t) => {
  // python3's zipfile is an independent implementation, and this is the test that
  // would catch a fixture and a reader agreeing on a mistake. Skipped where python3
  // is absent, because a harness is not a dependency of the product.
  let zip;
  try {
    zip = execFileSync('python3', ['-c', [
      'import io, zipfile, sys',
      'b = io.BytesIO()',
      'with zipfile.ZipFile(b, "w") as z:',
      '    z.writestr("001.jpg", b"one", zipfile.ZIP_STORED)',
      '    z.writestr("002.jpg", b"two" * 40, zipfile.ZIP_DEFLATED)',
      '    z.writestr("__MACOSX/._001.jpg", b"junk")',
      'sys.stdout.buffer.write(b.getvalue())',
    ].join('\n')]);
  } catch {
    t.skip('python3 not available');
    return;
  }
  const index = listArchive(zip);
  assert.equal(index.ok, true);
  assert.deepEqual(index.entries.map((e) => e.name), ['001.jpg', '002.jpg', '__MACOSX/._001.jpg']);
  assert.equal(readEntry(zip, index.entries[0]).bytes.toString('utf8'), 'one');
  assert.equal(readEntry(zip, index.entries[1]).bytes.toString('utf8'), 'two'.repeat(40));
});
