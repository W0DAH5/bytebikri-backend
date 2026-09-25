/**
 * Build the demo comic — a real CBZ, written the way a real tool writes one.
 *
 * The reader needs something to read, and a fixture that only exists inside a test
 * would leave the browser walk unable to open a page. So the demo archive is a file
 * on disk, generated here from the demo posters, and the demo store seeds it like any
 * other upload.
 *
 * Three details are deliberate, because the reader exists to survive them:
 *
 *   - **zero-padded names** (`page-001.jpg`), which is the convention that makes an
 *     alphabetical sort equal a natural one;
 *   - **both compression methods**: most entries are STORED (what a CBZ tool does with
 *     already-compressed images) and one is DEFLATE (what a generic zip tool does),
 *     so the demo exercises both paths in a browser rather than only in a unit test;
 *   - **the junk and the metadata a real archive carries**: `__MACOSX/._…` resource
 *     forks and a `ComicInfo.xml`, which the reader must filter rather than draw. A
 *     demo that contains none of them would make the filter untestable by eye.
 *
 *   node scripts/make-demo-comic.mjs        # writes seed-assets/demo-comic.cbz
 *
 * Dev tooling, like make-demo-media.mjs beside it.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..');
const IMG = path.join(ROOT, 'public', 'img', 'demo');
const OUT = path.join(ROOT, 'seed-assets', 'demo-comic.cbz');

const PAGES = 12;
// Cycled through the demo posters, so consecutive pages look different.
const SOURCES = ['kathmandu-street.jpg', 'devanagari-poster-kit.jpg', 'sample-pack.jpg'];

function crc32(buf) {
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let k = 0; k < 8; k += 1) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

/** One entry: local header, data, and the central directory row that indexes it. */
function entry({ name, data, method = 0 }) {
  const nameBuf = Buffer.from(name, 'utf8');
  const crc = crc32(data);
  const stored = method === 8 ? zlib.deflateRawSync(data, { level: 6 }) : data;
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0, 6);
  local.writeUInt16LE(method, 8);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(stored.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(nameBuf.length, 26);
  return {
    local: Buffer.concat([local, nameBuf, stored]),
    central: { name: nameBuf, method, crc, compressed: stored.length, size: data.length },
  };
}

const img = {};
for (const file of SOURCES) {
  try {
    img[file] = await fs.readFile(path.join(IMG, file));
  } catch { /* a missing poster is not an error: the cycle just gets shorter */ }
}
const available = Object.values(img);
if (!available.length) {
  console.error(`no demo images in ${IMG}; nothing to build`);
  process.exit(1);
}

const entries = [];
for (let n = 1; n <= PAGES; n += 1) {
  const data = available[(n - 1) % available.length];
  entries.push(entry({
    name: `page-${String(n).padStart(3, '0')}.jpg`,
    data,
    // One page deflated, the rest stored: both paths, in one archive.
    method: n === 7 ? 8 : 0,
  }));
}
entries.push(entry({
  name: 'ComicInfo.xml',
  data: Buffer.from(`<?xml version="1.0" encoding="utf-8"?>
<ComicInfo>
  <Title>Kathmandu Sketchbook</Title>
  <Series>Kathmandu Sketchbook</Series>
  <Number>1</Number>
  <Summary>Twelve pages of the valley's streets, doors and posters.</Summary>
  <PageCount>${PAGES}</PageCount>
  <LanguageISO>en</LanguageISO>
</ComicInfo>
`),
}));
entries.push(entry({ name: '__MACOSX/._page-001.jpg', data: Buffer.from('resource fork junk') }));

let offset = 0;
const locals = [];
const centrals = [];
for (const e of entries) {
  locals.push(e.local);
  const c = e.central;
  const head = Buffer.alloc(46);
  head.writeUInt32LE(0x02014b50, 0);
  head.writeUInt16LE(20, 4);
  head.writeUInt16LE(20, 6);
  head.writeUInt16LE(0, 8);
  head.writeUInt16LE(c.method, 10);
  head.writeUInt32LE(c.crc, 16);
  head.writeUInt32LE(c.compressed, 20);
  head.writeUInt32LE(c.size, 24);
  head.writeUInt16LE(c.name.length, 28);
  head.writeUInt32LE(offset, 42);
  centrals.push(Buffer.concat([head, c.name]));
  offset += e.local.length;
}
const centralBuf = Buffer.concat(centrals);
const eocd = Buffer.alloc(22);
eocd.writeUInt32LE(0x06054b50, 0);
eocd.writeUInt16LE(entries.length, 8);
eocd.writeUInt16LE(entries.length, 10);
eocd.writeUInt32LE(centralBuf.length, 12);
eocd.writeUInt32LE(offset, 16);

const zip = Buffer.concat([...locals, centralBuf, eocd]);
await fs.mkdir(path.dirname(OUT), { recursive: true });
await fs.writeFile(OUT, zip);
console.log(`wrote ${path.relative(ROOT, OUT)} — ${entries.length} entries, ${(zip.length / 1024).toFixed(0)} KB`);
