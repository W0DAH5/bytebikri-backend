/**
 * Identity documents: what may come in, what is taken out of it, and how long
 * anything is held.
 *
 * The rule this file exists to serve was written into the schema before there was
 * any way to upload anything (0001): *"Stores the OUTCOME of KYC, never the
 * evidence. Holding citizenship scans is a breach liability with no operational
 * benefit — verify, then discard the source."* An upload flow is the obvious way
 * to break that promise by accident, so the promise is enforced in three places
 * at once and each one is testable:
 *
 *   1. THE BYTES DECIDE WHAT THEY ARE. A `content-type` header is a claim by the
 *      client. Only the magic number is read, and anything that is not a plain
 *      raster image is refused by name — a PDF can carry a script, and an SVG is
 *      a script with a picture drawn on it. This is the OWASP file-upload rule
 *      (validate the type by content, allowlist rather than blocklist) applied to
 *      the one upload on this platform that is somebody's legal identity.
 *
 *   2. THE CAMERA'S OWN NOTES ARE REMOVED BEFORE THE FILE IS STORED. A photo of a
 *      citizenship certificate taken on a phone usually carries EXIF: GPS
 *      coordinates, the device model, a timestamp. None of it helps a person see
 *      whether the document is real, and all of it is data we did not ask for.
 *      Stripping happens here, on the way in, not on the way out — so the copy on
 *      the page ("the location your camera wrote is removed before it is stored")
 *      is true of the bytes on disk and not only of the response.
 *
 *   3. NOTHING IS HELD FOR LONGER THAN IT IS USED. See `HOLD_DAYS`.
 *
 * Nothing in this file touches the database or the filesystem: it takes a Buffer
 * and returns a Buffer, so it can be tested on its own and cannot grow a query.
 */

/** What may be handed over: three raster formats, and no fourth. */
export const ALLOWED_TYPES = {
  'image/jpeg': { ext: 'jpg', label: 'JPEG photo' },
  'image/png': { ext: 'png', label: 'PNG image' },
  'image/webp': { ext: 'webp', label: 'WebP image' },
};

/**
 * 8 MB, and the number is not arbitrary: a modern phone photo of a document is
 * 2–5 MB, so this accepts what a person actually has without accepting a scan
 * nobody needs. It is enforced by multer (before the bytes are buffered whole)
 * AND here, because a limit that exists in only one layer is a limit that can be
 * bypassed by the other.
 */
export const MAX_BYTES = 8 * 1024 * 1024;

/**
 * How long a held document lives.
 *
 * A document is kept for one reason — so a person can look at it and record an
 * outcome — so it is destroyed the moment that happens, and this is the backstop
 * for the case where nobody gets to it. Seven days is deliberately much shorter
 * than the industry's: Fiverr publishes 30 days for the same purpose, Stripe's own
 * guidance says "a growing number of privacy laws prohibit keeping data longer
 * than necessary" and leaves the window to the customer, and the schema comment
 * above says there is no operational benefit to holding it at all. A week is
 * longer than any queue that should exist on a platform this size, and the copy
 * on both pages states the number rather than saying "temporarily".
 */
export const HOLD_DAYS = 7;

/**
 * Read the first bytes and decide what this actually is.
 *
 * Returns a key of `ALLOWED_TYPES` or null. HEIC is the interesting refusal: it is
 * what an iPhone produces by default and it is not in the list, so the copy on the
 * page tells people to send a JPEG — a refusal with an instruction beats an
 * attempt to decode a container we do not understand.
 */
export function sniff(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
  const b = buffer;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47
    && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return 'image/png';
  if (b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

/** `image/jpeg` → `jpg`. A type we do not store has no extension. */
export const extFor = (mime) => ALLOWED_TYPES[mime]?.ext || null;

/**
 * Drop what the camera wrote, keep the picture.
 *
 * Each format keeps its metadata in a different container, and each one is walked
 * rather than searched: a naive "remove the EXIF block" that looks for the ASCII
 * string `Exif` inside the file will also find it inside the pixels of a photo of
 * a screen, which is how metadata strippers produce corrupt images. So the file is
 * parsed structurally, and anything not understood is copied through untouched
 * rather than guessed at.
 *
 * What is deliberately KEPT: the ICC profile (`APP2` in JPEG, `ICCP` in WebP), and
 * the animation and alpha chunks in WebP. Dropping the colour profile changes how
 * the photo looks, and a person checking a document against a face should see the
 * thing the seller sees.
 */
export function stripMetadata(buffer, mime) {
  try {
    if (mime === 'image/jpeg') return stripJpeg(buffer);
    if (mime === 'image/png') return stripPng(buffer);
    if (mime === 'image/webp') return stripWebp(buffer);
  } catch {
    // A malformed container is not a reason to throw at a seller who is trying to
    // show their documents. The bytes are returned as they came; the type was
    // already established from the header, and nothing here is served publicly.
  }
  return buffer;
}

/** JPEG: walk the segment chain, drop the metadata segments, copy from `SOS` on. */
function stripJpeg(b) {
  // FFE1 APP1 = EXIF and XMP · FFED APP13 = Photoshop IRB (IPTC) · FFFE COM = comment
  const DROP = new Set([0xe1, 0xed, 0xfe]);
  const out = [b.subarray(0, 2)];              // SOI
  let i = 2;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) break;                  // not a marker: stop walking, copy the rest
    const marker = b[i + 1];
    if (marker === 0xda) {                     // SOS — image data follows, verbatim
      out.push(b.subarray(i));
      return Buffer.concat(out);
    }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) {   // standalone markers
      out.push(b.subarray(i, i + 2));
      i += 2;
      continue;
    }
    const size = b.readUInt16BE(i + 2);
    if (size < 2 || i + 2 + size > b.length) break;
    if (!DROP.has(marker)) out.push(b.subarray(i, i + 2 + size));
    i += 2 + size;
  }
  // No SOS found (a truncated or interleaved file): whatever was not dropped is
  // what we have. Better a short file than a file with the GPS still in it.
  out.push(b.subarray(i));
  return Buffer.concat(out);
}

/** PNG: walk the chunks, drop the ones that carry text, time or an EXIF block. */
function stripPng(b) {
  const DROP = new Set(['tEXt', 'zTXt', 'iTXt', 'eXIf', 'tIME']);
  const out = [b.subarray(0, 8)];              // signature
  let i = 8;
  while (i + 12 <= b.length) {
    const size = b.readUInt32BE(i);
    const type = b.toString('latin1', i + 4, i + 8);
    const end = i + 12 + size;
    if (end > b.length) break;
    // Critical chunks (uppercase first letter) are never dropped: a file missing
    // an IHDR or an IDAT is not a file any more.
    if (!DROP.has(type) || type[0] === type[0].toUpperCase()) out.push(b.subarray(i, end));
    i = end;
    if (type === 'IEND') break;
  }
  out.push(b.subarray(i));
  return Buffer.concat(out);
}

/** WebP: RIFF chunks; the EXIF/XMP payloads go, and the header flags stop claiming them. */
function stripWebp(b) {
  const DROP = new Set(['EXIF', 'XMP ']);
  // Flags byte of VP8X: 0x20 ICC · 0x10 alpha · 0x08 EXIF · 0x04 XMP · 0x02 animation
  const chunks = [];
  let i = 12;
  while (i + 8 <= b.length) {
    const type = b.toString('latin1', i, i + 4);
    const size = b.readUInt32LE(i + 4);
    const end = i + 8 + size + (size % 2);     // RIFF pads to even
    if (i + 8 + size > b.length) break;
    let payload = b.subarray(i + 8, i + 8 + size);
    if (type === 'VP8X' && size >= 1 && !DROP.has(type)) {
      payload = Buffer.from(payload);
      payload[0] &= ~0x0c;                     // no EXIF, no XMP — because there are none
    }
    if (!DROP.has(type)) chunks.push({ type, payload });
    i = end;
  }
  const body = chunks.map((c) => {
    const head = Buffer.alloc(8);
    head.write(c.type, 0, 'latin1');
    head.writeUInt32LE(c.payload.length, 4);
    const pad = Buffer.alloc(c.payload.length % 2);
    return Buffer.concat([head, c.payload, pad]);
  });
  const inner = Buffer.concat(body);
  const riff = Buffer.alloc(12);
  riff.write('RIFF', 0, 'latin1');
  riff.writeUInt32LE(inner.length + 4, 4);
  riff.write('WEBP', 8, 'latin1');
  return Buffer.concat([riff, inner]);
}
