/**
 * Build the demo video that the seed publishes.
 *
 *   npm i -D h264-mp4-encoder      # not a runtime dependency
 *   node scripts/make-demo-media.mjs
 *
 * Why this exists at all: the app plays video now, and a player that has nothing
 * to play cannot be reviewed. The alternative — pointing the demo at a clip from
 * somebody else's CDN — would need a third-party host in the Content-Security
 * Policy, which is a real security decision taken to make a demo look nice. So
 * the clip is generated here, committed, and served like any other unlockable
 * file: out of private storage, through the signed, ranged stream route.
 *
 * The output is a genuine H.264/MP4 (85 KB, 5 s, 640×360, 12 fps) so the browser
 * exercises the real code path — Range requests, seeking, `controlsList` — rather
 * than a poster image pretending to be a video.
 *
 * Frames are drawn as raw RGBA. There is no canvas and no font here, so the clip
 * is a moving field plus a playhead: enough motion to prove playback works, and
 * deliberately generic so it does not pretend to be content anybody made.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
let HME;
try {
  HME = require('h264-mp4-encoder');
} catch {
  console.error('h264-mp4-encoder is not installed. Run: npm i -D h264-mp4-encoder');
  process.exit(1);
}

const W = 640;
const H = 360;
const FPS = 12;
/*
 * Five seconds is enough to prove a player plays — that is what the store's own
 * walkthrough clip is for. It is NOT enough to prove a RESUME, which is the one thing a
 * series needs a walk to show: `series.js` refuses to call anything under
 * `RESUME_MIN_SECONDS` (5) a resume, and a five-second file has nowhere to leave off
 * that is not its own end. So the series episodes are longer, and the extra seconds cost
 * a few hundred kilobytes.
 *
 *   node scripts/make-demo-media.mjs                 # the 5 s walkthrough clip
 *   node scripts/make-demo-media.mjs 45 <out.mp4>    # a series episode
 */
const SECONDS = Number(process.argv[2]) || 5;
const OUT = process.argv[3]
  ? path.resolve(process.cwd(), process.argv[3])
  : path.resolve(__dirname, '../seed-assets/store-walkthrough.mp4');

const enc = await HME.createH264MP4Encoder();
enc.width = W;
enc.height = H;
enc.frameRate = FPS;
enc.quantizationParameter = 26;   // ~1 Mbps at this size; smaller file, still clean
enc.initialize();

const frames = FPS * SECONDS;
const rgba = new Uint8Array(W * H * 4);
const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));

for (let f = 0; f < frames; f += 1) {
  const t = f / frames;
  const sweep = (t * 1.6) % 1;

  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const i = (y * W + x) * 4;
      const base = 14 + 26 * (y / H);
      let r = base * 0.9;
      let g = base * 0.95;
      let b = base + 34;

      const d = ((x / W) * 0.7 + (y / H) * 0.5 + sweep) % 1;
      const band = Math.exp(-(((d - 0.5) * 7) ** 2));
      r += band * 118; g += band * 62; b += band * 190;

      const glow = Math.exp(-(((x - W * 0.8) / (W * 0.5)) ** 2 + ((y - H * 0.2) / (H * 0.5)) ** 2));
      r += glow * (40 + 30 * Math.sin(t * 6.283 * 2));
      g += glow * 20;
      b += glow * 60;

      const vig = 1 - 0.35 * ((((x - W / 2) / (W / 2)) ** 2 + ((y - H / 2) / (H / 2)) ** 2) / 2);
      rgba[i] = clamp(r * vig);
      rgba[i + 1] = clamp(g * vig);
      rgba[i + 2] = clamp(b * vig);
      rgba[i + 3] = 255;
    }
  }

  // Playhead along the bottom: the one element that makes motion obvious even
  // when the gradient behind it is moving slowly.
  for (let y = H - 8; y < H - 2; y += 1) {
    for (let x = 0; x < Math.round(W * t); x += 1) {
      const i = (y * W + x) * 4;
      rgba[i] = 232; rgba[i + 1] = 236; rgba[i + 2] = 255; rgba[i + 3] = 255;
    }
  }

  enc.addFrameRgba(rgba);
}

enc.finalize();
const out = Buffer.from(enc.FS.readFile('output.mp4'));
enc.delete();

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, out);
console.log(`${path.relative(process.cwd(), OUT)} — ${(out.length / 1024).toFixed(0)} KB, ${frames} frames, ${out.subarray(4, 12).toString('latin1')}`);
