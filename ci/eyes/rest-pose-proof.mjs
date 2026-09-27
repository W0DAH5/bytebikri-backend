/**
 * The brief's acceptance test, run by the browser instead of by the pipeline.
 *
 *   node ci/eyes/rest-pose-proof.mjs [slug] [outDir]
 *
 * "When every animation layer is placed in its REST position over the single
 * static base, the result must look like ONE coherent artwork."
 *
 * The pipeline proves that of the files it writes (mean 0.00 against the
 * artwork). This proves it of what the BROWSER makes of those files: the four
 * served images are composited in a canvas — the browser's own alpha-over, at
 * the artwork's own 768x512, with nothing to lay out, nothing to scale and
 * nothing animating — and the result is compared, pixel for pixel, against the
 * original artwork drawn the same way.
 *
 * WHY A CANVAS AND NOT A SCREENSHOT. The first version of this photographed two
 * <div>s. The stage came back 768x513 — a fractional layout box — so the browser
 * resampled both sides and the test reported a 44/255 mean difference that was
 * entirely its own measuring instrument. A canvas has no layout: drawImage at
 * 1:1 is a copy, and `globalCompositeOperation = 'source-over'` is the exact
 * operator the card uses to stack the same layers. The instrument stops being
 * part of the measurement.
 *
 * The verdict is about LINES, not averages. A seam is a bright edge, so what
 * matters is whether any line of the difference stands out of the picture's own
 * noise — the same judgement `app/scripts/scene-proof.py` makes of the files.
 */
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';

const SLUG = process.argv[2] || 'nima-crafts';
const OUT = process.argv[3] || 'docs/evidence/round51-layers';
const BASE = process.env.EYES_BASE || 'http://127.0.0.1:3100';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/tmp/chromium',
  args: ['--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
// A page on the real host, so the images are fetched from the server the card uses.
await page.goto(`${BASE}/s/${SLUG}`, { waitUntil: 'domcontentloaded' });

const result = await page.evaluate(async (W) => {
  const parts = ['part-plate-armless', 'part-arm-raised', 'part-grapes-raised']
    .map((n) => `/img/cosmetics/${n}.webp`);
  const artwork = '/img/cosmetics/mascot-gold-buddha-base.webp';
  const load = (src) => new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => rej(new Error(`cannot load ${src}`));
    i.src = src;
  });
  const imgs = await Promise.all([...parts, artwork].map(load));
  const w = imgs[0].naturalWidth;
  const h = imgs[0].naturalHeight;

  const mk = () => {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  };
  // COMPOSITED OVER THE CARD'S OWN BACKGROUND, not over nothing.
  //
  // These are pictures with alpha, and a lossy WebP is allowed to stop storing
  // colour once alpha is nearly zero — so a bare comparison of the two RGBA
  // buffers reports huge differences in pixels the eye cannot see (the first
  // run of this test found 95 of them, up to 255/255, all sitting under low
  // alpha). Painting both sides onto the colour the card actually puts behind
  // the scene asks the only question that matters here: do they look the same?
  const cardBg = '#ffffff';
  const painted = (list) => {
    const c = mk();
    const ctx = c.getContext('2d');
    ctx.fillStyle = cardBg;
    ctx.fillRect(0, 0, w, h);
    list.forEach((im) => ctx.drawImage(im, 0, 0, w, h));
    return c;
  };
  // The layered scene: plate, then arm, then grapes — the card's own stacking.
  const layeredC = painted(imgs.slice(0, 3));
  // The original artwork, drawn by the same canvas so the decoder is common.
  const originalC = painted([imgs[3]]);

  const A = layeredC.getContext('2d').getImageData(0, 0, w, h).data;
  const B = originalC.getContext('2d').getImageData(0, 0, w, h).data;

  let sum = 0; let max = 0; let over32 = 0; let over8 = 0;
  const rows = new Int32Array(h);
  const hist = new Int32Array(6);            // 0, 1-2, 3-8, 9-32, 33-64, 65+
  for (let y = 0; y < h; y += 1) {
    let rmax = 0;
    for (let x = 0; x < w; x += 1) {
      const i = (y * w + x) * 4;
      const d = Math.max(
        Math.abs(A[i] - B[i]), Math.abs(A[i + 1] - B[i + 1]), Math.abs(A[i + 2] - B[i + 2]),
      );
      sum += d;
      if (d > max) max = d;
      if (d > rmax) rmax = d;
      if (d > 32) over32 += 1;
      if (d > 8) over8 += 1;
      hist[d === 0 ? 0 : d <= 2 ? 1 : d <= 8 ? 2 : d <= 32 ? 3 : d <= 64 ? 4 : 5] += 1;
    }
    rows[y] = rmax;
  }
  const n = w * h;
  const sorted = Array.from(rows).sort((p, q) => p - q);
  return {
    w, h, n,
    mean: sum / n, max, over32, over8,
    worstLine: sorted[sorted.length - 1],
    medianLine: sorted[Math.floor(sorted.length / 2)],
    linesOver32: sorted.filter((v) => v > 32).length,
    histogram: Array.from(hist),
    layered: layeredC.toDataURL('image/png'),
    original: originalC.toDataURL('image/png'),
  };
}, 768);

const save = (dataUrl, name) =>
  writeFileSync(`${OUT}/${name}`, Buffer.from(dataUrl.split(',')[1], 'base64'));
save(result.layered, '30-browser-rest-layered.png');
save(result.original, '31-browser-rest-original.png');

await browser.close();

const pct = (v) => `${(100 * v / result.n).toFixed(3)}%`;
console.log(`the browser's own rest composition vs the artwork  (${result.w}x${result.h}, `
  + `${result.n} px)`);
console.log('  how the difference is distributed (a seam is a thin bright edge, so the tail is what matters):');
const [z, a2, b8, c32, d64, e65] = result.histogram;
console.log(`    identical ${z}  · 1-2 ${a2}  · 3-8 ${b8}  · 9-32 ${c32}  · 33-64 ${d64}  · 65+ ${e65}`);
console.log(`  mean ${result.mean.toFixed(2)}   max ${result.max}   over 8: ${pct(result.over8)}   over 32: ${pct(result.over32)}`);
console.log(`  worst line ${result.worstLine}   median line ${result.medianLine}   `
  + `lines over 32: ${result.linesOver32} of ${result.h}`);
const stand = result.worstLine - result.medianLine;
console.log(stand <= 32
  ? '\n  verdict: the browser paints the artwork — no line stands out of the picture\'s noise'
  : `\n  verdict: A LINE STANDS ${stand} ABOVE THE REST — look at the sheets`);
