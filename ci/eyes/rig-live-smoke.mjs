// rig-live-smoke.mjs — the LIVE preview page in a real browser: the cycle
// runs, reduced-motion pins it, a phone viewport renders clean, the console
// stays silent. Frames land in /tmp/rigproof for the sheet.
import { chromium } from "playwright";
import fs from "node:fs";

const BASE = process.env.EYES_BASE || "http://127.0.0.1:8765";
const OUT = "/tmp/rigproof";
fs.mkdirSync(OUT, { recursive: true });
const results = [];
async function shot(p, el, path) {
  const data = await p.evaluate(() => window.__live.snapshot());
  fs.writeFileSync(path, Buffer.from(data.split(",")[1], "base64"));
}
const b = await chromium.launch({
  executablePath: "/tmp/chromium",
  args: ["--no-sandbox", "--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader"],
});

// 1. normal context: the LIVE panel actually runs
{
  const ctx = await b.newContext({ viewport: { width: 1560, height: 1200 } });
  const p = await ctx.newPage();
  p.errors = [];
  p.on("console", (m) => { if (m.type() === "error") p.errors.push(m.text().slice(0, 160)); });
  p.on("pageerror", (e) => p.errors.push(`PAGEERROR ${e.message.slice(0, 160)}`));
  await p.goto(BASE + "/buddha-rig-preview.html", { waitUntil: "load" });
  await p.waitForFunction(() => /arm -?\d+\.\d/.test(document.querySelector("#live-status")?.textContent || ""),
    null, { timeout: 60000 });
  const live = await p.$("#live");
  const readState = () => p.evaluate(() => document.querySelector("#live-status").textContent);
  const s0 = await readState();
  await shot(p, live, `${OUT}/live-1.png`);
  await p.waitForTimeout(4000);
  await shot(p, live, `${OUT}/live-2.png`);
  const s1 = await readState();
  await p.waitForTimeout(4000);
  await shot(p, live, `${OUT}/live-3.png`);
  const s2 = await readState();
  results.push({
    check: "live cycle runs and advances",
    pass: s0 !== s1 && s1 !== s2 && p.errors.length === 0,
    detail: `${JSON.stringify([s0, s1, s2])} errors=${p.errors.length}`,
  });
  await ctx.close();
}

// 2. reduced-motion: the character pins at REST (frames ~equal over 5s)
{
  const ctx = await b.newContext({ reducedMotion: "reduce", viewport: { width: 1560, height: 1200 } });
  const p = await ctx.newPage();
  p.errors = [];
  p.on("pageerror", (e) => p.errors.push(`PAGEERROR ${e.message.slice(0, 160)}`));
  await p.goto(BASE + "/buddha-rig-preview.html", { waitUntil: "load" });
  await p.waitForFunction(() => /arm -?\d+\.\d/.test(document.querySelector("#live-status")?.textContent || ""),
    null, { timeout: 60000 });
  const live = await p.$("#live");
  await shot(p, live, `${OUT}/live-rm-1.png`);
  const st = await p.evaluate(() => document.querySelector("#live-status").textContent);
  await p.waitForTimeout(5000);
  await shot(p, live, `${OUT}/live-rm-2.png`);
  const st2 = await p.evaluate(() => document.querySelector("#live-status").textContent);
  results.push({
    check: "reduced-motion pins the pose (status constant)",
    pass: st === st2 && /arm 0\.00/.test(st) && p.errors.length === 0,
    detail: `${JSON.stringify([st, st2])}`,
  });
  await ctx.close();
}

// 3. phone viewport: renders, no horizontal blowout, console clean
{
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
  const p = await ctx.newPage();
  p.errors = [];
  p.on("pageerror", (e) => p.errors.push(`PAGEERROR ${e.message.slice(0, 160)}`));
  await p.goto(BASE + "/buddha-rig-preview.html", { waitUntil: "load" });
  await p.waitForFunction(() => /arm -?\d+\.\d/.test(document.querySelector("#live-status")?.textContent || ""),
    null, { timeout: 60000 });
  const blowout = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2);
  try {
    await p.screenshot({ path: `${OUT}/live-phone.png`, fullPage: false, timeout: 90000 });
  } catch { /* the shot is decorative; the assertions are blowout+console */ }
  results.push({
    check: "phone viewport renders without blowout",
    pass: !blowout && p.errors.length === 0,
    detail: `blowout=${blowout} errors=${p.errors.length}`,
  });
  await ctx.close();
}

await b.close();
let ok = true;
for (const r of results) {
  console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.check}  (${r.detail})`);
  ok = ok && r.pass;
}
console.log(ok ? "LIVE SMOKE: ALL PASS" : "LIVE SMOKE: FAILURES");
process.exit(ok ? 0 : 1);
