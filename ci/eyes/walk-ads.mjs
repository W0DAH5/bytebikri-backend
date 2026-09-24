/**
 * Walk the multi-ad unlock in a real browser.
 *
 * "Two ads mean two ads" is a claim about a sequence: a page prints an ask, a
 * modal opens once, the first view is credited, the SECOND starts on the same
 * attempt, and only then does the file open. Every part of that is invisible to a
 * unit test, which can call `handlePostback` twice and still be satisfied by a
 * state machine that never told the person what was happening.
 *
 * So this drives the real page with real clicks, at the real ask (45 s a view for
 * the fixture it expects), and records what the panel said at each step.
 *
 * WHO DELIVERS THE AD: nothing in the browser does. The client asks the server to
 * start a view and then WAITS — the network tells the server, server to server,
 * and the browser can only learn what was proved. A harness cannot be a real ad
 * network, so it plays the part of one: it reads the `viewId`/`connectionId` the
 * page was handed, and POSTs to the dev-only simulator
 * (`/dev/simulate-network/house`), which signs a postback the way that provider
 * documents and delivers it over real HTTP. Second view delivered only after the
 * panel has said the first one was credited — that is the sequence under test, and
 * delivering both at once would walk past it.
 *
 *   node ci/eyes/walk-ads.mjs [slug-or-url] [who]
 *   EYES_KEEP=1 node ci/eyes/walk-ads.mjs     # keep the unlock this run earns
 *
 * Evidence lands in docs/evidence/round35/. Expect ~100 s of wall clock for a
 * two-ad file.
 */
import { chromium } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { sessionFor, consent } from './lib.mjs';

const TARGET = process.argv[2] || '/s/alice/a/devanagari-poster-kit';
const WHO = process.argv[3] || 'bob';
const BASE = process.env.EYES_BASE || 'http://127.0.0.1:3000';
const OUT = 'docs/evidence/round35';
mkdirSync(OUT, { recursive: true });

// A finished unlock makes the second run of this walk meaningless, so it starts
// from the ask again unless asked not to.
if (!process.env.EYES_KEEP) {
  const reset = execFileSync('node', ['ci/eyes/reset-unlock.mjs', WHO, TARGET.split('/').pop()], { encoding: 'utf8' });
  process.stdout.write(`reset            : ${reset}`);
}

/** One delivery from the sandbox network, exactly as the network would make it. */
const deliver = async (start, label) => {
  const r = await fetch(`${BASE}/dev/simulate-network/${start.adConfig.providerId}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      viewId: start.viewId,
      connectionId: start.adConfig.connectionId,
      durationSec: start.adConfig.minSeconds,
    }),
  });
  const json = await r.json().catch(() => ({}));
  console.log(`network ${label}${' '.repeat(Math.max(0, 6 - label.length))}: ${r.status}`,
    JSON.stringify(json).slice(0, 190));
  return json;
};

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/tmp/chromium',
  args: ['--no-sandbox'],
});
const state = await sessionFor(browser, WHO, { base: BASE });
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 }, colorScheme: 'dark', reducedMotion: 'reduce', storageState: state,
});
const p = await ctx.newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(String(e.message)));
p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

// The page's half of the contract: what the server handed it when it started.
const starts = [];
p.on('response', async (r) => {
  if (!/\/api\/unlock\/start$/.test(new URL(r.url()).pathname)) return;
  try { starts.push(await r.json()); } catch { /* not JSON: the page will say so */ }
});

const shot = async (name, sel = null) => {
  const path = `${OUT}/${name}.png`;
  if (sel) await p.locator(sel).screenshot({ path });
  else await p.screenshot({ path });
  return path;
};
const text = (sel) => p.locator(sel).innerText().catch(() => '');
const modalOpen = () => p.locator('#ad-modal:not([hidden])').count().then((n) => n > 0);

const url = TARGET.startsWith('http') ? TARGET : BASE + TARGET;
await p.goto(url);
await consent(p);

console.log('page says        :', JSON.stringify(await text('#unlock-btn')));
console.log('ask pill         :', (await p.locator('.pill').allInnerTexts()).join(' | '));
await p.waitForTimeout(300);
await shot('walk-1-page', '.asset-layout');

await p.click('#unlock-btn');
await p.waitForTimeout(1500);
console.log('modal open       :', await modalOpen(), '| countdown', JSON.stringify(await text('#ad-count')));
console.log('status (ad 1)    :', JSON.stringify(await text('#unlock-status')));
await shot('walk-2-first-ad', '#ad-modal');

if (!starts.length) throw new Error('the page never started a view — nothing to deliver');
await deliver(starts[0], 'view 1');

// Phase 2: the panel must say the first view was credited, on its own, before the
// second one arrives. Delivering early would hide the sentence this walk exists to
// read.
// The granted page reloads itself the moment the unlock lands, so the last thing
// the panel says ("Unlocked — reloading…") is on screen for less time than any
// poll can see. The navigation is what proves it, and it is what this watches.
let navigated = false;
p.on('framenavigated', (f) => { if (f === p.mainFrame() && /\/a\//.test(new URL(f.url()).pathname)) navigated = true; });

const notes = [];
const t0 = Date.now();
let deliveredSecond = false;
let reachedUnlocked = false;
let phase = 1;
while (Date.now() - t0 < 240_000) {
  const s = await text('#unlock-status');
  if (s && s !== notes[notes.length - 1]) {
    notes.push(s);
    console.log(`t+${((Date.now() - t0) / 1000).toFixed(0).padStart(3)}s status  :`, JSON.stringify(s));
  }
  if (phase === 1 && /view was credited|views credited/.test(s)) {
    phase = 2;
    deliveredSecond = true;
    console.log('   ↳ the panel says view 1 was credited, and that this is the last one');
    console.log('modal asks       :', JSON.stringify(await text('#ad-ask-tail')));
    await shot('walk-3-credited', '#ad-modal');
    await p.waitForTimeout(2500);
    console.log('status (ad 2)    :', JSON.stringify(await text('#unlock-status')));
    console.log('start calls      :', starts.length, '(must still be 1 — same attempt)');
    await shot('walk-4-second-ad', '#ad-modal');
    await deliver(starts[starts.length - 1], 'view 2');
  }
  if (navigated || /Unlocked — reloading/i.test(s)) { reachedUnlocked = true; break; }
  if (/refused|no longer being offered|not confirmed yet|trouble/i.test(s)) break;
  await p.waitForTimeout(700);
}

await p.waitForTimeout(3000);
await p.goto(url);
await consent(p);
console.log('after            :', (await p.locator('.pill').allInnerTexts()).join(' | '));
const panel = await text('.asset-layout .note-success').catch(() => '');
console.log('file panel says  :', JSON.stringify(panel.slice(0, 160)));
await p.waitForTimeout(300);
await shot('walk-5-unlocked', '.asset-layout');

console.log('start calls      :', starts.length, '(1 expected, whatever the ad count)');
console.log('statuses seen    :', notes.length);
console.log('panel credited   :', /view was credited|views credited/.test(notes.join(' ')));
console.log('reached unlocked :', reachedUnlocked);
console.log('console errors   :', errors.length ? errors : 'none');
await ctx.close();
await browser.close();
