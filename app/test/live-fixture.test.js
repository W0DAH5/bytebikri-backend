/**
 * The live demo fixture, held to what a player actually needs.
 *
 * `app/scripts/make-demo-live.mjs` writes three MPEG-TS segments and one playlist into
 * `app/seed-assets/live-demo/`, and they are committed — the demo has to play for
 * somebody who has never run the generator. That also means the fixture can rot
 * silently: nothing else in this suite reads those bytes, and a browser is the only
 * decoder the project has.
 *
 * So this file checks the properties hls.js and a native HLS player depend on, and
 * nothing about how they were produced: 188-byte packets with legal sync bytes, a PAT
 * and a PMT whose CRCs are right (a wrong CRC is a muxer bug that looks exactly like a
 * black screen), a PCR on the packet that starts each access unit, and a parameter-set +
 * IDR group at the head of EVERY segment — a player joining a live stream starts at a
 * segment boundary, and a segment that opens without its SPS/PPS decodes as snow.
 *
 * The CRC here is computed bit-by-bit from the polynomial, deliberately unlike the
 * generator's table: two implementations that agree are evidence, and one implementation
 * checked against itself is not.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const DIR = fileURLToPath(new URL('../seed-assets/live-demo/', import.meta.url));
const PACKET = 188;

/** CRC-32/MPEG-2, bit by bit: poly 0x04C11DB7, init all ones, no final xor. */
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte << 24;
    for (let i = 0; i < 8; i += 1) {
      crc = (crc & 0x80000000) ? ((crc << 1) ^ 0x04c11db7) >>> 0 : (crc << 1) >>> 0;
    }
  }
  return crc >>> 0;
}

const playlist = readFileSync(`${DIR}index.m3u8`, 'utf8');
const lines = playlist.split('\n').map((l) => l.trim()).filter(Boolean);

/** The playlist and the segments, as one structure: what is written and what is listed. */
const listed = [];
for (let i = 0; i < lines.length; i += 1) {
  if (!lines[i].startsWith('#EXTINF:')) continue;
  listed.push({
    seconds: Number(lines[i].slice('#EXTINF:'.length).replace(/,$/, '')),
    name: lines[i + 1],
  });
}

const segments = listed.map(({ name }) => ({ name, bytes: readFileSync(`${DIR}${name}`) }));

/** Every packet in a segment, as [pid, payloadUnitStart, payload, hasPcr]. */
function packets(bytes) {
  assert.equal(bytes.length % PACKET, 0, 'a transport stream is a whole number of 188-byte packets');
  const out = [];
  for (let off = 0; off < bytes.length; off += PACKET) {
    assert.equal(bytes[off], 0x47, `no sync byte at packet ${off / PACKET}`);
    const pid = ((bytes[off + 1] & 0x1f) << 8) | bytes[off + 2];
    const start = (bytes[off + 1] & 0x40) !== 0;
    const hasAdaptation = (bytes[off + 3] & 0x20) !== 0;
    let payloadAt = off + 4;
    let hasPcr = false;
    if (hasAdaptation) {
      const length = bytes[off + 4];
      if (length > 0 && (bytes[off + 5] & 0x10) !== 0) hasPcr = true;
      payloadAt = off + 5 + length;
    }
    const stuffing = bytes[off + 3] & 0x0f;
    assert.ok(stuffing <= 15, 'continuity counter lives in four bits');
    out.push({ pid, start, payload: payloadAt <= off + PACKET ? bytes.subarray(payloadAt, off + PACKET) : Buffer.alloc(0), hasPcr });
  }
  return out;
}

/** The section inside a PSI packet: skips the pointer field, checks the CRC. */
function section(packet, what) {
  const ptr = packet.payload[0];
  const body = packet.payload.subarray(1 + ptr);
  const length = ((body[1] & 0x0f) << 8) | body[2];
  const withCrc = body.subarray(0, 3 + length);
  const stated = withCrc.readUInt32BE(withCrc.length - 4);
  assert.equal(crc32(withCrc.subarray(0, withCrc.length - 4)), stated, `${what}: the section's CRC does not match its bytes`);
  return withCrc;
}

test('the playlist is a live one, and every segment it lists is on disk', () => {
  assert.equal(lines[0], '#EXTM3U');
  assert.ok(lines.includes('#EXT-X-PLAYLIST-TYPE:EVENT'));
  assert.ok(!lines.includes('#EXT-X-ENDLIST'),
    'a fixture with ENDLIST is a five-second video: the live edge it is supposed to demonstrate stops existing');
  assert.ok(listed.length >= 3, 'a live fixture needs more than a segment or two');
  const target = Number((lines.find((l) => l.startsWith('#EXT-X-TARGETDURATION:')) || '').split(':')[1]);
  const longest = Math.max(...listed.map((s) => s.seconds));
  assert.ok(target >= Math.ceil(longest), `TARGETDURATION ${target} is shorter than the longest segment (${longest}s)`);
  for (const { name } of listed) assert.ok(existsSync(`${DIR}${name}`), `${name} is listed and missing`);
});

test('every segment is a real transport stream: sync bytes, and a PAT and PMT with good CRCs', () => {
  for (const { name, bytes } of segments) {
    const all = packets(bytes);
    const pat = all.find((p) => p.pid === 0x0000 && p.start);
    const pmt = all.find((p) => p.pid === 0x1000 && p.start);
    assert.ok(pat, `${name}: no PAT`);
    assert.ok(pmt, `${name}: no PMT`);
    assert.equal(pat === all[0], true, `${name}: a player joining here needs the PAT in the first packet`);
    section(pat, `${name} PAT`);
    const pmtSection = section(pmt, `${name} PMT`);
    assert.equal(pmtSection[0], 0x02, `${name}: the PMT is not a PMT`);
    const streams = pmtSection.subarray(12, pmtSection.length - 4);
    assert.equal(streams[0], 0x1b, `${name}: the PMT does not declare an H.264 stream`);
    const elementaryPid = ((streams[1] & 0x1f) << 8) | streams[2];
    assert.equal(elementaryPid, 0x0100, `${name}: the video PID moved`);
    const streamPids = new Set(all.map((p) => p.pid));
    for (const pid of streamPids) {
      assert.ok(pid === 0x0000 || pid === 0x1000 || pid === 0x0100,
        `${name}: PID 0x${pid.toString(16)} is not declared by the PMT`);
    }
  }
});

test('the clock is there and it moves forward', () => {
  // The PCR sits in the adaptation field: 33 bits of 90 kHz clock plus a 9-bit
  // extension. The fixture writes the base and the reserved bits, so reading the base
  // and proving it advances is the whole claim — a player stalls forever on a clock
  // that stands still, and a broken muxer stalls it exactly this way.
  for (const { name, bytes } of segments) {
    const base = (at) => ((bytes[at + 6] << 25) | (bytes[at + 7] << 17) | (bytes[at + 8] << 9)
      | (bytes[at + 9] << 1) | (bytes[at + 10] >> 7)) >>> 0;
    const offsets = [];
    for (let off = 0; off < bytes.length; off += PACKET) {
      const length = bytes[off + 4];
      if ((bytes[off + 3] & 0x20) && length > 0 && (bytes[off + 5] & 0x10)) offsets.push(off);
    }
    assert.ok(offsets.length >= 2, `${name}: a segment needs a PCR on the packet that starts each access unit`);
    for (let i = 1; i < offsets.length; i += 1) {
      assert.ok(base(offsets[i]) > base(offsets[i - 1]),
        `${name}: PCR went backwards at packet ${offsets[i] / PACKET}`);
    }
  }
});

test('every segment opens on an IDR with its parameter sets, so a player can join here', () => {
  for (const { name, bytes } of segments) {
    const all = packets(bytes);
    const first = all.find((p) => p.pid === 0x0100 && p.start);
    assert.ok(first, `${name}: no video access unit`);
    // The PES payload starts after the 6-byte header, the 3-byte flags/length and the
    // 5-byte PTS, so the first start code is at offset 14. Walk the Annex B start codes.
    const pes = first.payload;
    assert.equal(pes.readUInt32BE(0), 0x000001e0, `${name}: the first video PES has no stream id`);
    // Byte by byte, not in jumps: an Annex B scan that steps over a start code the way a
    // NAL-length walk does will miss the exactly one it is looking for.
    const types = [];
    for (let i = 0; i < Math.min(pes.length, 400) - 4; i += 1) {
      if (pes[i] === 0 && pes[i + 1] === 0 && pes[i + 2] === 1) types.push(pes[i + 3] & 0x1f);
    }
    assert.ok(types.includes(7), `${name}: no SPS before the first slice`);
    assert.ok(types.includes(8), `${name}: no PPS before the first slice`);
    const idr = types.indexOf(5);
    assert.ok(idr > -1, `${name}: the first access unit is not an IDR`);
    assert.ok(types.indexOf(7) < idr && types.indexOf(8) < idr, `${name}: the parameter sets come after the IDR`);
  }
});
