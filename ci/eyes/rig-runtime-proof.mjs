// rig-runtime-proof.mjs — the section 14 checks against the REAL browser
// runtime (PixiJS MeshGeometry), via the repo's ci/eyes harness stack.
//
// Drives app/public/buddha-rig-test.html (a paused mount exposed as
// window.__rig) and captures deterministic frames into /tmp/rigproof.
// The pixel assertions live in app/scripts/rig-runtime-proof.py, which
// reads the frames and the rig JSON and prints the verdicts.
//
//   ci/eyes/setup.sh   (once)
//   node ci/eyes/rig-runtime-proof.mjs        (server on :8765 required)
//   python3 app/scripts/rig-runtime-proof.py
import { chromium } from "playwright";
import fs from "node:fs";

const BASE = process.env.EYES_BASE || "http://127.0.0.1:8765";
const OUT = "/tmp/rigproof";

const b = await chromium.launch({
  executablePath: "/tmp/chromium",
  args: ["--no-sandbox", "--enable-unsafe-swiftshader",
         "--use-gl=angle", "--use-angle=swiftshader"],
});
const ctx = await b.newContext({ viewport: { width: 1560, height: 1120 } });
const p = await ctx.newPage();
p.errors = [];
p.on("console", (m) => { if (m.type() === "error") p.errors.push(m.text().slice(0, 160)); });
p.on("pageerror", (e) => p.errors.push(`PAGEERROR ${e.message.slice(0, 160)}`));

await p.goto(BASE + "/buddha-rig-test.html", { waitUntil: "load" });
await p.waitForFunction(() => document.title.startsWith("rig-"), null, { timeout: 45000 });
const title = await p.title();
if (title !== "rig-ready") {
  console.error("runtime mount failed:", title, p.errors);
  await b.close();
  process.exit(1);
}

fs.mkdirSync(OUT, { recursive: true });
const canvas = await p.$("canvas");

async function shot(name, t, ov) {
  await p.evaluate(([t, ov]) => { window.__rig.apply(t, ov || undefined); }, [t, ov]);
  await p.waitForTimeout(10);
  await canvas.screenshot({ path: `${OUT}/${name}.png` });
}

// REST + the reduced-motion still (same mount is pinned? no: this context is
// the normal one; the reduced context comes last)
await shot("rest", 0);
await shot("rest2", 0);                       // determinism: same t -> same pixels
await shot("blink-on", 8.8);
await shot("blink-off", 8.8, { blink: 0 });   // the patch isolated
// handover edges (window 14.50..18.24)
await shot("h0-before", 14.49);
await shot("h0-after", 14.51);
await shot("h0-settled", 14.75);
await shot("h1-before", 18.23);
await shot("h1-after", 18.25);
// full-cycle flicker samples at 1.0s (software WebGL: ~9s per readback)
for (let f = 1; f <= 24; f++) await shot(`c${f}`, f * 1.0);

// the reduced-motion context: pinned at REST, never advances
const ctx2 = await b.newContext({ reducedMotion: "reduce", viewport: { width: 1560, height: 1120 } });
const p2 = await ctx2.newPage();
p2.errors = [];
p2.on("pageerror", (e) => p2.errors.push(`PAGEERROR ${e.message.slice(0, 160)}`));
await p2.goto(BASE + "/buddha-rig-test.html", { waitUntil: "load" });
await p2.waitForFunction(() => document.title === "rig-ready", null, { timeout: 45000 });
const canvas2 = await p2.$("canvas");
await p2.waitForTimeout(1100);               // a real second passes: a running rig would move
await canvas2.screenshot({ path: `${OUT}/rest-rm.png` });

const errors = [...p.errors, ...p2.errors];
console.log(JSON.stringify({ frames: fs.readdirSync(OUT).length, errors }, null, 1));
await b.close();
process.exit(errors.length ? 1 : 0);
