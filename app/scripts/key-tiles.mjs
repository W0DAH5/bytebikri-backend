/**
 * Key the cosmetic tiles' dark studio background to transparent, so a mascot or
 * motif reads as a character sitting on the card (ringed by the power's rim,
 * drop-shadowed by its own shape) rather than a photograph pasted on.
 *
 * The tiles are drawn on a near-black stage (#111217 at the frame) with a soft
 * warm glow that is brightest around the subject and fades to black at the
 * edges. A pure colour-distance key would eat the subject's dark interior
 * shadows (holes); a pure region-grow would climb the smooth glow gradient into
 * the character (that is exactly how the first pass lost 99% of the Buddha).
 *
 * So this does BOTH: it REGION-GROWS from every border pixel (the subject never
 * touches the frame, so border-connected is background) and it GATES each step
 * on global distance to the corner reference colour. The dark stage and the dim
 * part of the glow are close to the reference and are consumed; the moment the
 * colour leaves the background family (the bright glow, then the gold) the gate
 * stops the fill. What remains is the character plus a faint glow that reads as
 * "lit", on a transparent ground.
 *
 * One-off asset pass; the source tiles are the committed originals, so a bad key
 * is a `git restore` away.
 *
 *   node app/scripts/key-tiles.mjs [gate=70]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { PNG } from 'pngjs';

const DIR = fileURLToPath(new URL('../public/img/cosmetics/', import.meta.url));
const GATE = Number(process.argv[2] || 70);

const files = ['motif-silver.png', 'motif-gold.png', 'motif-crystal.png', 'motif-royal.png',
  'motif-inferno.png', 'motif-aurora.png', 'motif-prism.png', 'motif-zen.png',
  'mascot-gold-buddha.png', 'mascot-gold-dragon.png', 'mascot-gold-lotus.png'];

const dist = (d, i, r, g, b) => Math.sqrt((d[i] - r) ** 2 + (d[i + 1] - g) ** 2 + (d[i + 2] - b) ** 2);

for (const name of files) {
  const path = join(DIR, name);
  let png;
  try { png = PNG.sync.read(readFileSync(path)); } catch { continue; }
  const { width: w, height: h, data } = png;
  // Reference = the mean of the four corners (the stage colour, always the
  // darkest, most background-like point in the tile).
  const corner = (x, y) => (y * w + x) * 4;
  const cs = [corner(1, 1), corner(w - 2, 1), corner(1, h - 2), corner(w - 2, h - 2)];
  const ref = [0, 1, 2].map((k) => cs.reduce((s, i) => s + data[i + k], 0) / cs.length);
  const bg = new Uint8Array(w * h);
  const queue = new Int32Array(w * h);
  let qh = 0, qt = 0;
  const push = (x, y) => { const p = y * w + x; if (!bg[p]) { bg[p] = 1; queue[qt++] = p; } };
  for (let x = 0; x < w; x++) { push(x, 0); push(x, h - 1); }
  for (let y = 0; y < h; y++) { push(0, y); push(w - 1, y); }
  while (qh < qt) {
    const p = queue[qh++];
    const x = p % w, y = (p / w) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const np = ny * w + nx;
      if (bg[np]) continue;
      if (dist(data, np * 4, ref[0], ref[1], ref[2]) < GATE) push(nx, ny);
    }
  }
  let cleared = 0;
  for (let i = 0; i < w * h; i++) if (bg[i]) { data[i * 4 + 3] = 0; cleared++; }
  writeFileSync(path, PNG.sync.write(png));
  console.log(`  ${name}  ref(${ref.map((r) => r | 0)})  ${cleared} px keyed (${(100 * cleared / (w * h)).toFixed(0)}%)`);
}
console.log(`keyed ${files.length} tiles @ gate ${GATE}`);
