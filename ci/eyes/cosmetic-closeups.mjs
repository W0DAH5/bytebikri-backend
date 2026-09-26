/**
 * Close-up frames of the premium cosmetic system, for VISUAL inspection
 * (PREMIUM_COSMETICS.md). The full-page walk frames prove the system works;
 * these cropped frames are for judging whether it LOOKS like a distinctive
 * identity — the metallic nameplate, the prismatic crystal, the rim and halo,
 * the mascot — at the size a person actually sees it.
 *
 *   EYES_BASE=http://127.0.0.1:3100 CHROMIUM_PATH=/tmp/chromium \
 *   LD_LIBRARY_PATH=/tmp/eyes/al2023/lib node ci/eyes/cosmetic-closeups.mjs [outDir]
 */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { sessionFor } from './lib.mjs';

const OUT = process.argv[2] || 'docs/evidence/round49-cosmetics';
const BASE = process.env.EYES_BASE || 'http://127.0.0.1:3100';
const ROSTER = `${BASE}/s/nima-crafts`;
mkdirSync(OUT, { recursive: true });
const log = (s) => console.log(s);

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/tmp/chromium', args: ['--no-sandbox'],
});
async function ctx({ scheme = 'dark', storage = null } = {}) {
  const c = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: scheme, ...(storage ? { storageState: storage } : {}) });
  const p = await c.newPage();
  await p.emulateMedia({ reducedMotion: 'no-preference' });
  return { c, p };
}
async function settle(p) {
  const btn = p.locator('.consent .btn-primary');
  if (await btn.count()) { await btn.click(); await p.waitForLoadState('load'); await p.waitForTimeout(300); }
  else await p.waitForTimeout(150);
}
/** Screenshot a bounding box inflated by `pad`, so a card's halo is not cropped off. */
async function clipShot(p, el, name, pad = 46) {
  await el.evaluate((node) => node.scrollIntoView({ block: 'center', inline: 'center' }));
  await p.waitForTimeout(250);
  try {
    const b = await el.boundingBox();
    await p.screenshot({ path: `${OUT}/${name}`, clip: { x: Math.max(0, b.x - pad), y: Math.max(0, b.y - pad), width: b.width + pad * 2, height: b.height + pad * 2 } });
    log(`  shot ${name} (${Math.round(b.width + pad * 2)}x${Math.round(b.height + pad * 2)})`);
  } catch (e) {
    // A clip can land outside the viewport for a very wide node; the element's
    // own screenshot (which scrolls and clips to it) always succeeds.
    await el.screenshot({ path: `${OUT}/${name}` });
    log(`  shot ${name} (element fallback — ${e.message.split('\n')[0]})`);
  }
}

/* 1 · Alice's crystal card, dark — the prismatic nameplate + halo + Buddha. */
log('\n[1] Alice, crystal, dark');
{
  const { c, p } = await ctx();
  await p.goto(ROSTER); await settle(p);
  const alice = p.locator('.member:has(.member-name:text-is("alice"))');
  await clipShot(p, alice, 'close-alice-crystal-dark.png');
  await c.close();
}

/* 2 · The four rungs, each a real member card wearing its power's metal nameplate.
      Injected with the same structure memberPlate() emits, so the frame is the
      production markup — a `.member` li, data-power, avatar, and a .member-name
      wearing wear-solid (the plain effect the metal is allowed to paint). */
log('\n[2] the four rungs, metallic nameplates');
{
  const { c, p } = await ctx();
  await p.goto(ROSTER); await settle(p);
  await p.evaluate(() => {
    const wrap = document.createElement('ul');
    wrap.className = 'member-list';
    wrap.style.cssText = 'display:flex;gap:26px;flex-wrap:wrap;padding:40px;';
    const tierChip = (label) => `<span class="chip chip-tier"><svg width="10" height="9" viewBox="0 0 10 9" aria-hidden="true"><path d="M5 0 10 9H0Z" fill="currentColor"/></svg>${label}</span>`;
    for (const [power, name, initial, accent] of [
      ['silver', 'silver', 'S', 'slate'], ['gold', 'gold', 'G', 'amber'],
      ['crystal', 'crystal', 'C', 'sky'], ['inferno', 'inferno', 'I', 'orange'],
    ]) {
      const li = document.createElement('li');
      li.className = 'member'; li.dataset.power = power;
      li.style.cssText = 'min-width:210px;--plate-ink:#e2e8f0;--plate-ink-light:#334155;--plate-a:#6366f1;--plate-b:#4f46e5;';
      li.innerHTML = `<span class="member-avatar" aria-hidden="true" style="--plate-a:#6366f1;--plate-b:#4f46e5">${initial}</span>
        <span class="member-body">
          <span class="member-name wear-solid" style="--plate-ink:#e2e8f0;--plate-ink-light:#334155;--plate-a:#6366f1;--plate-b:#4f46e5">${name}</span>
          <span class="member-chip">${tierChip('TIER')}</span>
        </span>`;
      wrap.appendChild(li);
    }
    document.body.appendChild(wrap);
  });
  await p.waitForTimeout(120);
  const wrap = p.locator('ul.member-list');
  // element.screenshot() scrolls the node into view and clips to it; the wrap's
  // own 40px padding carries the cards' halos, so nothing important is cropped.
  await wrap.screenshot({ path: `${OUT}/close-ladder-metals.png` });
  const b = await wrap.boundingBox();
  log(`  shot close-ladder-metals.png (${Math.round(b.width)}x${Math.round(b.height)})`);
  await c.close();
}

/* 3 · The /plus wardrobe preview stage — the power it sells, worn live.
      Read-only: it captures the stage and does NOT touch the picker, so the
      demo state (Alice's saved Buddha) is left exactly as the walk left it. */
log('\n[3] the wardrobe preview stage');
{
  const state = await sessionFor(browser, 'alice', { base: BASE });
  const { c, p } = await ctx({ storage: state });
  await p.goto(`${BASE}/plus`); await settle(p);
  const stage = p.locator('[data-look-stage]');
  if (await stage.count()) { await clipShot(p, stage.first(), 'close-stage-preview.png', 34); }
  else log('  (no [data-look-stage] found)');
  // and the whole wardrobe, so the tiles and the stage sit in one frame
  const marks = p.locator('.plus-marks');
  if (await marks.count()) { await clipShot(p, marks.first(), 'close-wardrobe-tiles.png', 24); }
  await c.close();
}

/* 4 · Alice's crystal card, light scheme — the darker metal on the light surface. */
log('\n[4] Alice, crystal, light');
{
  const { c, p } = await ctx({ scheme: 'light' });
  await p.goto(ROSTER); await settle(p);
  const alice = p.locator('.member:has(.member-name:text-is("alice"))');
  await clipShot(p, alice, 'close-alice-crystal-light.png');
  await c.close();
}

await browser.close();
log(`\ncloseups: done — ${OUT}`);
