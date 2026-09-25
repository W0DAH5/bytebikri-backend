/**
 * Build the demo "live" stream that the seed publishes.
 *
 *   node scripts/make-demo-live.mjs
 *
 * Why this exists at all: the live shape needs a stream to be reviewed against, and a
 * demo pointed at somebody else's CDN would put a third-party host in the Content-
 * Security Policy (and in the walk's network log) to make a screenshot look nice. So the
 * demo stream is built here, committed, and served by this app — the same reasoning as
 * `make-demo-media.mjs`, which builds the unlockable clip this file reads.
 *
 * Why an HLS muxer is hand-rolled here instead of using ffmpeg: the machine this was
 * written on has no ffmpeg, and a fixture that can only be rebuilt on a machine that
 * does is a fixture nobody rebuilds. The input is our own 5-second clip — 60 samples,
 * three IDR boundaries, no B-frames, no audio — so the muxer is small and the arithmetic
 * is checkable by reading it. It is a *fixture builder*: it is never used at runtime, it
 * reads one file and writes four, and the app never calls it.
 *
 * The output is three MPEG-TS segments and a playlist:
 *
 *   live-demo/index.m3u8   #EXTINF 1.666667 × 3, TARGETDURATION 2, EVENT, no ENDLIST
 *   live-demo/seg{0,1,2}.ts
 *
 * Segments are cut on the clip's own IDR boundaries (samples 0, 20, 40 — found in the
 * bitstream, not assumed), and every segment starts with AUD + SPS + PPS + IDR, because a
 * decoder that joins at a segment boundary has no memory of the parameter sets. That is
 * also why the whole thing is verifiable by eye: each segment begins with the same four
 * start codes.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(here, '../seed-assets/store-walkthrough.mp4');
const OUT_DIR = path.resolve(here, '../seed-assets/live-demo');

const TARGET_DURATION = 2;         // seconds; must cover the longest segment
const PID_PMT = 0x1000;
const PID_VIDEO = 0x0100;
const STREAM_TYPE_H264 = 0x1b;

const buf = fs.readFileSync(SRC);

// ── MP4: the boxes this file actually has ──────────────────────────────────────
const findBox = (start, end, type) => {
  let off = start;
  while (off + 8 <= end) {
    const size = buf.readUInt32BE(off);
    if (size < 8 || off + size > end) return null;
    if (buf.toString('latin1', off + 4, off + 8) === type) return { body: off + 8, end: off + size };
    off += size;
  }
  return null;
};
const descend = (start, end, ...types) => types.reduce((box, type) => findBox(box.body, box.end, type), { body: start, end });
if (findBox(0, buf.length, 'moof')) throw new Error('fragmented MP4 — this builder reads the one layout it was written for');
const stbl = descend(0, buf.length, 'moov', 'trak', 'mdia', 'minf', 'stbl');
if (findBox(stbl.body, stbl.end, 'ctts')) throw new Error('composition offsets — PTS would need a DTS table this builder does not write');

const mdhd = descend(0, buf.length, 'moov', 'trak', 'mdia', 'mdhd');
const timescale = buf.readUInt32BE(mdhd.body + 12);

const stsd = findBox(stbl.body, stbl.end, 'stsd');
const avc1 = findBox(stsd.body + 8, stsd.end, 'avc1');
const avcC = findBox(avc1.body + 78, avc1.end, 'avcC');       // 78 = visual sample entry header
const nalLengthSize = (buf.readUInt8(avcC.body + 4) & 0x03) + 1;
// Two different lengths live in avcC and they must not be confused: samples are framed
// with `nalLengthSize`-byte lengths (4, here), while the parameter-set lists inside avcC
// are ALWAYS 2-byte lengths. Reading the latter with the former swallows two bytes of the
// SPS header and lands the PPS read past the end of the file.
const parameterSet = (offset) => {
  const len = buf.readUInt16BE(offset);
  return buf.subarray(offset + 2, offset + 2 + len);
};
const sps = parameterSet(avcC.body + 6);
// Between the two lists sits a ONE-BYTE count (`numOfPictureParameterSets`), and it is
// not part of any length: reading the PPS list as `8 + sps.length` lands two bytes late
// and produces four bytes of garbage in place of the real PPS — which every player
// rejects, and which looks exactly like a stream that will not play. Found by
// `test/live-fixture.test.js`, which checks the head of each segment for a real PPS.
const pps = parameterSet(avcC.body + 9 + sps.length);
// Both lists are declared, and both entries must BE what they claim: a generator that
// silently writes a non-SPS where an SPS belongs makes a fixture that no browser can
// play, and the failure surfaces three tools later.
if (buf.readUInt8(avcC.body + 5) !== 0xe1) throw new Error('avcC does not declare exactly one SPS');
if ((sps[0] & 0x1f) !== 7) throw new Error('the first parameter set is not an SPS');
if ((pps[0] & 0x1f) !== 8) throw new Error('the parameter set read after the SPS is not a PPS');

const sampleCount = buf.readUInt32BE(findBox(stbl.body, stbl.end, 'stsz').body + 8);
const stszBox = findBox(stbl.body, stbl.end, 'stsz');
const sizes = Array.from({ length: sampleCount }, (_, i) => buf.readUInt32BE(stszBox.body + 12 + i * 4));

const sttsBox = findBox(stbl.body, stbl.end, 'stts');
const durations = [];
for (let i = 0, entries = buf.readUInt32BE(sttsBox.body + 4); i < entries; i += 1) {
  const at = sttsBox.body + 8 + i * 8;
  for (let k = 0; k < buf.readUInt32BE(at); k += 1) durations.push(buf.readUInt32BE(at + 4));
}

const stscBox = findBox(stbl.body, stbl.end, 'stsc');
const stsc = Array.from({ length: buf.readUInt32BE(stscBox.body + 4) }, (_, i) => {
  const at = stscBox.body + 8 + i * 12;
  return { firstChunk: buf.readUInt32BE(at), samplesPerChunk: buf.readUInt32BE(at + 4) };
});
const stcoBox = findBox(stbl.body, stbl.end, 'stco');
const chunkOffsets = Array.from({ length: buf.readUInt32BE(stcoBox.body + 4) }, (_, i) => buf.readUInt32BE(stcoBox.body + 8 + i * 4));

// Chunk table → per-sample file offsets, then offsets → decode times.
const samples = [];
let sampleIndex = 0;
for (let chunk = 1; chunk <= chunkOffsets.length && sampleIndex < sampleCount; chunk += 1) {
  const entry = [...stsc].reverse().find((e) => e.firstChunk <= chunk) ?? stsc[0];
  let offset = chunkOffsets[chunk - 1];
  for (let i = 0; i < entry.samplesPerChunk && sampleIndex < sampleCount; i += 1) {
    samples.push({ offset, size: sizes[sampleIndex], duration: durations[sampleIndex] });
    offset += sizes[sampleIndex];
    sampleIndex += 1;
  }
}

// ── Bitstream: Annex B, and where the IDRs are ─────────────────────────────────
const START_CODE = Buffer.from([0, 0, 0, 1]);
const AUD = Buffer.concat([START_CODE, Buffer.from([0x09, 0xf0])]);
const firstNalType = (sample) => buf.readUInt8(sample.offset + nalLengthSize) & 0x1f;
const idrStarts = samples.map((s, i) => (firstNalType(s) === 5 ? i : -1)).filter((i) => i >= 0);
if (idrStarts.length < 2) throw new Error('fewer than two IDR frames — nothing to cut segments on');

const annexB = (sample) => {
  const parts = [AUD];
  if (firstNalType(sample) === 5) parts.push(START_CODE, sps, START_CODE, pps);   // decoder joins here
  let off = sample.offset;
  const end = off + sample.size;
  while (off + nalLengthSize <= end) {
    const len = buf.readUIntBE(off, nalLengthSize);
    off += nalLengthSize;
    if (len <= 0 || off + len > end) break;
    parts.push(START_CODE, buf.subarray(off, off + len));
    off += len;
  }
  return Buffer.concat(parts);
};

// ── MPEG-TS ────────────────────────────────────────────────────────────────────
const crc32 = (b) => {
  let crc = 0xffffffff;
  for (const byte of b) {
    crc ^= byte << 24;
    for (let i = 0; i < 8; i += 1) crc = (crc & 0x80000000) ? ((crc << 1) ^ 0x04c11db7) >>> 0 : (crc << 1) >>> 0;
  }
  return crc >>> 0;
};

// A PSI section is one packet: pointer_field, table_id, section_length, the table body,
// then a CRC32 over everything after the pointer field.
const psi = (tableId, tableBody) => {
  const sectionLength = tableBody.length + 4;
  const bytes = Buffer.concat([
    Buffer.from([tableId, 0xb0 | ((sectionLength >> 8) & 0x0f), sectionLength & 0xff]),
    tableBody,
    Buffer.alloc(4),
  ]);
  bytes.writeUInt32BE(crc32(bytes.subarray(0, bytes.length - 4)), bytes.length - 4);
  return Buffer.concat([Buffer.from([0x00]), bytes]);
};

const PAT_PACKET = psi(0x00, Buffer.from([
  0x00, 0x01,                          // transport_stream_id
  0xc1,                                // reserved '11', version 0, current
  0x00, 0x00,                          // section_number, last_section_number
  0x00, 0x01, (PID_PMT >> 8) | 0xe0, PID_PMT & 0xff,
]));
const PMT_PACKET = psi(0x02, Buffer.from([
  0x00, 0x01,                          // program_number
  0xc1, 0x00, 0x00,
  (PID_VIDEO >> 8) | 0xe0, PID_VIDEO & 0xff,   // PCR_PID
  0xf0, 0x00,                          // program_info_length 0
  STREAM_TYPE_H264, (PID_VIDEO >> 8) & 0x1f, PID_VIDEO & 0xff, 0xf0, 0x00,
]));

class Muxer {
  constructor() { this.packets = []; this.counters = new Map(); }

  write(pid, payload, { pcr = null, start = false } = {}) {
    let rest = payload;
    let first = true;
    while (rest.length > 0) {
      const counter = (this.counters.get(pid) ?? 0) & 0x0f;
      this.counters.set(pid, (counter + 1) & 0x0f);
      // A packet is 4 header bytes + an adaptation field (length byte + flags + optional
      // PCR + stuffing) + payload. The adaptation field is also how a packet is filled
      // exactly: only the last packet of a payload may be shorter than its capacity.
      const wantsPcr = first && pcr !== null;
      const capacity = wantsPcr ? 176 : 182;
      const take = Math.min(rest.length, capacity);
      const stuffing = capacity - take;
      const adaptationLength = (wantsPcr ? 7 : 1) + stuffing;

      const header = Buffer.from([
        0x47,
        ((first && start ? 0x40 : 0x00)) | ((pid >> 8) & 0x1f),
        pid & 0xff,
        0x30 | counter,                                  // adaptation field + payload
      ]);
      const adaptation = Buffer.alloc(1 + adaptationLength, 0xff);
      adaptation[0] = adaptationLength;
      adaptation[1] = wantsPcr ? 0x10 : 0x00;
      if (wantsPcr) {
        adaptation[2] = (pcr >> 25) & 0xff;              // base is 33 bits at 90 kHz
        adaptation[3] = (pcr >> 17) & 0xff;
        adaptation[4] = (pcr >> 9) & 0xff;
        adaptation[5] = (pcr >> 1) & 0xff;
        adaptation[6] = ((pcr & 1) << 7) | 0x7e;         // reserved six bits + PCR extension
        adaptation[7] = 0x00;
      }
      const packet = Buffer.concat([header, adaptation, rest.subarray(0, take)]);
      if (packet.length !== 188) throw new Error(`packet is ${packet.length} bytes`);
      this.packets.push(packet);
      rest = rest.subarray(take);
      first = false;
    }
  }

  bytes() { return Buffer.concat(this.packets); }
}

const pes = (payload, pts) => {
  const header = Buffer.alloc(9);
  header.writeUInt32BE(0x000001e0, 0);                        // stream id: video
  header.writeUInt16BE(payload.length + 8, 4);                // length: header_data + 3 flag bytes + payload
  header[6] = 0x80;                                           // '10' — PTS present, no DTS (no B-frames)
  header[7] = 0x80;                                           // PTS only
  header[8] = 5;
  const stamp = Buffer.alloc(5);
  stamp[0] = 0x21 | (((pts >> 30) & 0x07) << 1);
  stamp[1] = (pts >> 22) & 0xff;
  stamp[2] = 0x01 | (((pts >> 15) & 0x7f) << 1);
  stamp[3] = (pts >> 7) & 0xff;
  stamp[4] = 0x01 | ((pts & 0x7f) << 1);
  return Buffer.concat([header, stamp, payload]);
};

// ── Build the segments ─────────────────────────────────────────────────────────
const boundaries = [0, ...idrStarts.filter((i) => i > 0), samples.length];
fs.mkdirSync(OUT_DIR, { recursive: true });

const lines = ['#EXTM3U', '#EXT-X-VERSION:3', `#EXT-X-TARGETDURATION:${TARGET_DURATION}`, '#EXT-X-MEDIA-SEQUENCE:0', '#EXT-X-PLAYLIST-TYPE:EVENT'];
const written = [];
let decodeTime = 0;
const sampleStarts = [];
for (let i = 0; i < samples.length; i += 1) { sampleStarts.push(decodeTime); decodeTime += samples[i].duration; }

for (let s = 0; s < boundaries.length - 1; s += 1) {
  const from = boundaries[s];
  const to = boundaries[s + 1];
  const mux = new Muxer();
  mux.write(0x0000, PAT_PACKET, { start: true });
  mux.write(PID_PMT, PMT_PACKET, { start: true });
  for (let i = from; i < to; i += 1) {
    mux.write(PID_VIDEO, pes(annexB(samples[i]), sampleStarts[i]), { start: true, pcr: sampleStarts[i] });
  }
  const name = `seg${s}.ts`;
  const bytes = mux.bytes();
  fs.writeFileSync(path.join(OUT_DIR, name), bytes);
  written.push({ name, bytes: bytes.length, seconds: (sampleStarts[to - 1] + samples[to - 1].duration - sampleStarts[from]) / timescale });
}
for (const seg of written) lines.push(`#EXTINF:${seg.seconds.toFixed(6)},`, seg.name);
// NO `#EXT-X-ENDLIST`, on purpose. With it, every player treats the demo as a finished
// file — a five-second video with a beginning and an end — and the live surface's whole
// vocabulary (the live edge, "the stream moved on", a resume that jumps forward) would
// be describing a fiction. Without it this is an EVENT playlist that stopped growing:
// the player plays to the last segment and waits at the edge, which is exactly what a
// stream nobody is pushing to looks like, and it is the shape the walk tests.
fs.writeFileSync(path.join(OUT_DIR, 'index.m3u8'), `${lines.join('\n')}\n`);

const total = written.reduce((sum, s) => sum + s.seconds, 0);
console.log(`wrote ${written.length} segments, ${total.toFixed(3)}s, ${written.reduce((sum, s) => sum + s.bytes, 0)} bytes into seed-assets/live-demo/`);
for (const seg of written) console.log(`  ${seg.name}  ${seg.bytes} B  ${seg.seconds.toFixed(6)} s`);
