/**
 * Reading a zip without unpacking it.
 *
 * A CBZ is a standard ZIP, and the surface that reads one wants one page at a
 * time: no unpacking, no temp directory, no second copy of a store's artwork on
 * a disk that already holds the original. A ZIP is built for exactly that — the
 * **central directory** at the end of the archive is an index of every entry with
 * its offset and both its sizes, so the archive can be random-accessed from the
 * buffer we already fetched from storage.
 *
 * This is deliberately not a zip library. It reads the two things a page list
 * needs (the index, and one entry's bytes) and it refuses everything else by
 * name: a zip that is not a zip, a ZIP64 archive, an archive with more pages than
 * a person will read, an entry that inflates past its own stated size. Every
 * refusal is a sentence the reader can print, because "the page is blank" is the
 * kind of failure that makes a product look broken when the truth is that the
 * upload was.
 *
 * Three details are the difference between "works on the archives I made" and
 * "works on the archives sellers make":
 *
 * 1. **Sizes come from the central directory.** A ZIP written with a data
 *    descriptor (general-purpose bit 3) has ZEROS in the local header's sizes,
 *    because the writer did not know them when it started the entry. Reading the
 *    local header instead of the index is the classic way to render a valid comic
 *    as 0 bytes.
 * 2. **The data starts after the LOCAL header's name and extra lengths**, which
 *    are frequently not the same lengths as the central directory's copy of the
 *    same entry — writers put alignment padding in one and not the other.
 * 3. **Names are labels.** Nothing here writes an entry to a filesystem or joins a
 *    name to a path, so `../../etc/passwd` inside an archive is a string that
 *    sorts somewhere. There is no traversal surface because there is no path.
 *
 * Inflate is Node's own `zlib`. The CBZ convention is to store images (`STORED`,
 * because JPEGs are already compressed) with `DEFLATE` permitted, so both methods
 * are handled and the test fixtures contain both.
 */
import zlib from 'node:zlib';

/** Signature of the end-of-central-directory record, and of one index row. */
const EOCD = 0x06054b50;
const CEN = 0x02014b50;
const LOC = 0x04034b50;

/**
 * The caps, all three of them a refusal rather than a limit to grow into.
 *
 * A zip bomb is a small archive that claims to be a huge one, so the check has two
 * halves: the size the index *claims*, and the size the inflater actually produced.
 * `zlib`'s own `maxOutputLength` enforces the second while the bomb is being
 * inflated, which is the half that matters when the index is lying.
 */
export const ZIP_CAPS = {
  maxEntries: 2_000,
  maxEntryBytes: 32 * 1024 * 1024,
  maxTotalBytes: 512 * 1024 * 1024,
};

const decodeName = (buf) => buf.toString('utf8');

/**
 * The archive's index: every entry, in the order the writer listed them.
 *
 * Returns `{ ok: false, reason }` rather than throwing, because every one of these
 * outcomes has a sentence on a page and none of them is an exception.
 */
export function listArchive(buf, { caps = ZIP_CAPS } = {}) {
  if (!Buffer.isBuffer(buf) || buf.length < 22) return { ok: false, reason: 'not-a-zip' };

  // The end record is last, but a trailing comment of up to 64k may follow it, so
  // it is found by scanning back rather than by arithmetic from the end.
  const floor = Math.max(0, buf.length - 65_557);
  let end = -1;
  for (let i = buf.length - 22; i >= floor; i -= 1) {
    if (buf.readUInt32LE(i) === EOCD) { end = i; break; }
  }
  if (end < 0) return { ok: false, reason: 'not-a-zip' };

  const count = buf.readUInt16LE(end + 10);
  const cdSize = buf.readUInt32LE(end + 12);
  const cdOffset = buf.readUInt32LE(end + 16);

  // ZIP64 says "look at the ZIP64 end record" by writing the 16-bit and 32-bit
  // fields as all ones. This reader does not follow it: an archive past 4 GB is a
  // download, and saying so is more useful than half-reading it.
  if (count === 0xffff || cdOffset === 0xffffffff || cdSize === 0xffffffff) {
    return { ok: false, reason: 'zip64' };
  }
  if (cdOffset + cdSize > buf.length) return { ok: false, reason: 'truncated' };
  if (count > caps.maxEntries) return { ok: false, reason: 'too-many-pages' };
  if (count === 0) return { ok: false, reason: 'empty' };

  const entries = [];
  let at = cdOffset;
  let totalBytes = 0;
  for (let i = 0; i < count; i += 1) {
    if (at + 46 > buf.length || buf.readUInt32LE(at) !== CEN) return { ok: false, reason: 'truncated' };
    const method = buf.readUInt16LE(at + 10);
    const flags = buf.readUInt16LE(at + 8);
    const compressedSize = buf.readUInt32LE(at + 20);
    const size = buf.readUInt32LE(at + 24);
    const nameLen = buf.readUInt16LE(at + 28);
    const extraLen = buf.readUInt16LE(at + 30);
    const commentLen = buf.readUInt16LE(at + 32);
    const localOffset = buf.readUInt32LE(at + 42);
    const name = decodeName(buf.subarray(at + 46, at + 46 + nameLen));

    if (compressedSize === 0xffffffff || size === 0xffffffff || localOffset === 0xffffffff) {
      return { ok: false, reason: 'zip64' };
    }
    if (size > caps.maxEntryBytes) return { ok: false, reason: 'entry-too-big', name };
    totalBytes += size;
    if (totalBytes > caps.maxTotalBytes) return { ok: false, reason: 'archive-too-big', name };

    entries.push({
      name, method, size, compressedSize, localOffset,
      // Bit 3: the sizes here are the authority, and the local header's are zero.
      descriptor: Boolean(flags & 0x08),
      directory: name.endsWith('/'),
    });
    at += 46 + nameLen + extraLen + commentLen;
  }

  return { ok: true, entries, totalBytes };
}

/**
 * One entry's bytes.
 *
 * The entry's data starts after the **local** header, whose name and extra lengths
 * are read from the local header itself — see the note at the top of the file for
 * why the central directory's lengths cannot be used for this.
 */
export function readEntry(buf, entry, { caps = ZIP_CAPS } = {}) {
  if (!entry || entry.directory) return { ok: false, reason: 'not-a-file' };
  const at = entry.localOffset;
  if (at + 30 > buf.length || buf.readUInt32LE(at) !== LOC) return { ok: false, reason: 'truncated' };
  const nameLen = buf.readUInt16LE(at + 26);
  const extraLen = buf.readUInt16LE(at + 28);
  const start = at + 30 + nameLen + extraLen;
  const end = start + entry.compressedSize;
  if (end > buf.length) return { ok: false, reason: 'truncated' };

  const raw = buf.subarray(start, end);
  if (entry.method === 0) {
    if (raw.length > caps.maxEntryBytes) return { ok: false, reason: 'entry-too-big' };
    return { ok: true, bytes: raw };
  }
  if (entry.method !== 8) return { ok: false, reason: 'unsupported-method' };

  try {
    // The cap is enforced *during* the inflate, which is the only way to survive an
    // archive whose index claims a small entry and whose bytes expand to gigabytes.
    const bytes = zlib.inflateRawSync(raw, { maxOutputLength: caps.maxEntryBytes });
    return { ok: true, bytes };
  } catch (err) {
    return { ok: false, reason: err?.code === 'ERR_BUFFER_TOO_LARGE' ? 'entry-too-big' : 'corrupt' };
  }
}

/** What the reader says when it cannot read the archive, in words. */
export const ARCHIVE_REFUSALS = {
  'not-a-zip': 'This file is not an archive this reader can open. Download it and use your own app.',
  truncated: 'This archive looks cut short — the part of it that lists the pages is missing or damaged.',
  zip64: 'This archive is too large for the reader to open page by page. Download it instead.',
  empty: 'This archive has no pages in it.',
  'too-many-pages': 'This archive has more pages than the reader will open at once. Download it instead.',
  'entry-too-big': 'One page in this archive is larger than the reader will open.',
  'archive-too-big': 'This archive holds more than the reader will open page by page. Download it instead.',
  'unsupported-method': 'A page in this archive is packed in a way this reader cannot unpack.',
  corrupt: 'A page in this archive could not be unpacked — the file may be damaged.',
};

export const archiveSentence = (reason) =>
  ARCHIVE_REFUSALS[reason] || 'This archive could not be opened. Download it and use your own app.';
