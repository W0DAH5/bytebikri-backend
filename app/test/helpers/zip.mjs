/**
 * A ZIP writer, for fixtures only.
 *
 * Written at the byte level on purpose: a fixture built by a library shares that
 * library's assumptions with the reader, and the assumptions are exactly what these
 * tests exist to check. Two details are parameters rather than constants, because both
 * of them occur in archives written by real tools and both of them break naive
 * readers:
 *
 *   - `localExtra` vs `centralExtra` — writers put alignment padding in one header and
 *     not the other, so the entry's data does not start at a fixed offset from either;
 *   - `descriptor` — a streaming writer sets bit 3 and leaves ZEROS in the local
 *     header's sizes, so the index is the only place the real sizes exist.
 */
import zlib from 'node:zlib';

export function crc32(buf) {
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let k = 0; k < 8; k += 1) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

export function makeZip(entries, { eocdPatch = null, localExtra = 7, centralExtra = 3 } = {}) {
  const parts = [];
  const centrals = [];
  let offset = 0;
  for (const e of entries) {
    const body = Buffer.isBuffer(e.data) ? e.data : Buffer.from(String(e.data), 'utf8');
    const method = e.method ?? 0;
    const stored = method === 8 ? zlib.deflateRawSync(body) : body;
    const crc = crc32(body);
    const nameBuf = Buffer.from(e.name, 'utf8');

    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(e.descriptor ? 0x08 : 0, 6);
    head.writeUInt16LE(method, 8);
    head.writeUInt32LE(e.descriptor ? 0 : crc, 14);
    head.writeUInt32LE(e.descriptor ? 0 : stored.length, 18);
    head.writeUInt32LE(e.descriptor ? 0 : body.length, 22);
    head.writeUInt16LE(nameBuf.length, 26);
    head.writeUInt16LE(localExtra, 28);
    const local = Buffer.concat([head, nameBuf, Buffer.alloc(localExtra, 0x41), stored]);
    parts.push(local);

    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    // Bit 3 lives in BOTH headers: a reader told only by the local one would be a
    // reader that trusts the wrong copy of the same fact.
    c.writeUInt16LE(e.descriptor ? 0x08 : 0, 8);
    c.writeUInt16LE(method, 10);
    c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(stored.length, 20);
    c.writeUInt32LE(e.lieSize ?? body.length, 24);
    c.writeUInt16LE(nameBuf.length, 28);
    c.writeUInt16LE(centralExtra, 30);
    c.writeUInt32LE(offset, 42);
    centrals.push(Buffer.concat([c, nameBuf, Buffer.alloc(centralExtra, 0x42)]));
    offset += local.length;
  }
  const centralBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  if (eocdPatch) eocdPatch(eocd);
  return Buffer.concat([...parts, centralBuf, eocd]);
}

/**
 * A comic: `pages` image entries, plus the junk and metadata a real archive carries.
 * The bytes are tiny but real (a JPEG header is not needed to read the index).
 */
export function makeComic({ pages = 12, pageBytes = 64, name = (n) => `page-${String(n).padStart(3, '0')}.jpg` } = {}) {
  const entries = [];
  for (let n = 1; n <= pages; n += 1) {
    entries.push({
      name: name(n),
      data: Buffer.alloc(pageBytes, n % 256),
      // One deflated page, so both methods are exercised by every fixture.
      method: n === 3 ? 8 : 0,
    });
  }
  entries.push({ name: 'ComicInfo.xml', data: Buffer.from('<ComicInfo><PageCount/>') });
  entries.push({ name: '__MACOSX/._page-001.jpg', data: Buffer.from('junk') });
  return makeZip(entries);
}
