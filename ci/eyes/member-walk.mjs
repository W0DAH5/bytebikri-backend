/**
 * The attention door, walked end to end in a browser.
 *
 * The framework this round settled on has one claim at its centre: a store may let
 * somebody in WITHOUT money, by watching the ads it already shows, and the platform
 * — not the seller — decides what that costs. The seller keeps the ad revenue, the
 * platform keeps nothing from it, and the person gets the same tier for the same
 * period as somebody who paid. Every part of that is a sequence across three
 * sessions, which is exactly what a unit test cannot see:
 *
 *   1. a visitor reads the price, in views, on the door itself;
 *   2. a non-member is REFUSED at a members-only file — the hole this round closed —
 *      with a sentence rather than an ad;
 *   3. views accumulate from the store's own files, verified by the network
 *      server-to-server, and the price on the door goes down;
 *   4. the join happens, and the member room opens with the belonging in it;
 *   5. a membership bought with views is invisible in the seller's dues queue, because
 *      there is no statement to check;
 *   6. and the opt-in `supporter` arrangement — the one ad that does not disappear —
 *      behaves the way its own sentence promises.
 *
 * WHAT DELIVERS THE ADS: the dev-only simulator, exactly as `walk-ads.mjs` uses it.
 * Nothing runs a 15-second video: the harness POSTs to `/dev/simulate-network/house`
 * with the `viewId`/`connectionId` the page was handed, which signs a postback the
 * way the provider documents and delivers it over real HTTP.
 *
 *   node ci/demo-state.mjs                       # the fixture, and the restore
 *   node ci/eyes/member-walk.mjs [slug] [membersFile] [outDir]
 *
 * Run it from the repository root, and run the seeder first: this walk is a sequence
 * from zero standing and no membership, and putting the two walkers back there is the
 * seeder's job (§4b-bis), because it is also the state the preview should be found in.
 * The fixture itself: Alice's store on the Store plan, tier 1 "Friend" offering BOTH
 * doors with member files opened with no ad, `studio-source-files` live and
 * members-only at tier 1, and Bob and Carol at zero.
 */
import { chromium } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { sessionFor, consent } from './lib.mjs';

const SLUG = process.argv[2] || 'alice';
const MEMBER_FILE = process.argv[3] || 'studio-source-files';
const OUT = process.argv[4] || 'docs/evidence/round36';
const BASE = process.env.EYES_BASE || 'http://127.0.0.1:3000';
mkdirSync(OUT, { recursive: true });

// Four files that ask for one short view each, so a walker earns the price of a
// month without a single reset: the standing counter is per STORE, not per file,
// and four different files is also the honest demonstration that any of the store's
// files counts.
const EARNERS = {
  bob: ['trek-permit-checklist', 'janakpur-mural-scan', 'rara-lake-posters', 'mustang-desert-pack'],
  carol: ['ilam-tea-label-set', 'swayambhu-sketch-pack', 'boudhanath-mandala', 'dhaka-topi-pattern'],
  // A second set, for the member who keeps watching: the counter is the same counter,
  // and the thing it buys is the NEXT period.
  more: ['sel-roti-recipe-card', 'terai-harvest-sticker', 'chitwan-bird-cards', 'himalayan-icon-set'],
};

const say = (n, s) => console.log(`\n[${n}] ${s}`);

// A finished unlock makes the second run of this walk meaningless — the file is open,
// so there is no button to press and nothing to earn. The standing counter is the
// seeder's job (it goes back to zero there, because it is a demo state); the unlocks
// are this script's, one (viewer, file) pair at a time, exactly as `walk-ads.mjs`
// does it. `EYES_KEEP=1` skips the reset for a run that just wants to look.
if (!process.env.EYES_KEEP) {
  for (const who of Object.keys(EARNERS)) {
    if (who === 'more') continue;
    for (const slug of EARNERS[who]) {
      execFileSync('node', ['ci/eyes/reset-unlock.mjs', who, slug], { encoding: 'utf8' });
    }
  }
  for (const slug of EARNERS.more) {
    execFileSync('node', ['ci/eyes/reset-unlock.mjs', 'bob', slug], { encoding: 'utf8' });
  }
  // And the members-only file, for the supporter: her membership does NOT open it —
  // an ordinary view does — so an unlock left behind by the last run would hide the
  // one page this walk exists to look at.
  execFileSync('node', ['ci/eyes/reset-unlock.mjs', 'carol', MEMBER_FILE], { encoding: 'utf8' });
  console.log('reset            : 13 unlock(s) cleared (12 for the walkers, plus the members file)');
}
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/tmp/chromium', args: ['--no-sandbox'],
});

/** A page plus the two listeners every step of this walk wants. */
async function pageFor(who) {
  const state = who ? await sessionFor(browser, who, { base: BASE }) : null;
  const ctx = await browser.newContext({
    viewport: { width: 1400, height: 1000 }, colorScheme: 'dark', reducedMotion: 'reduce',
    ...(state ? { storageState: state } : {}),
  });
  const p = await ctx.newPage();
  p.errors = [];
  p.starts = [];
  p.on('console', (m) => { if (m.type() === 'error') p.errors.push(m.text().slice(0, 160)); });
  p.on('pageerror', (e) => p.errors.push(`PAGEERROR ${e.message.slice(0, 160)}`));
  // The server's own answer to "watch an ad to unlock", caught as it is handed out.
  p.on('response', async (r) => {
    if (!/\/api\/unlock\/start$/.test(new URL(r.url()).pathname)) return;
    try { p.starts.push(await r.json()); } catch { /* a body the harness cannot read */ }
  });
  return { ctx, p };
}

/** The next ask the page is handed, or null if the button produced none. */
function nextStart(p, before) {
  return new Promise((resolve) => {
    const poll = setInterval(() => {
      if (p.starts.length > before) { clearInterval(poll); resolve(p.starts[before]); }
    }, 100);
    setTimeout(() => { clearInterval(poll); resolve(null); }, 10_000);
  });
}

/**
 * Earn one verified view on one of the store's files, through the real page.
 *
 * Nothing here delivers the ad by hand. The page does, because in this sandbox there
 * is no ad network and the server hands the browser a `devSimulator` flag saying so —
 * which means the request the harness would otherwise write is a request the PRODUCT
 * makes, over HTTP, to the same `/dev/simulate-network/house` route a walk-ads harness
 * posts to. Two deliveries would be two views, and the door's number is the thing
 * under test, so the walk presses the button and then waits to see what the product
 * does with it.
 */
async function watchOne(p, slug, assetSlug) {
  const before = p.starts.length;
  await p.goto(`${BASE}/s/${slug}/a/${assetSlug}`);
  await consent(p);
  const btn = p.locator('#unlock-btn');
  await btn.waitFor({ timeout: 10_000 });
  await btn.scrollIntoViewIfNeeded();
  await btn.click();
  const start = await nextStart(p, before);
  if (!start || start.ok !== true) throw new Error(`no usable ask on ${assetSlug}: ${JSON.stringify(start)}`);
  // The file opening is the server's answer, not the countdown's: the page can only
  // reload once the postback has been verified.
  await p.waitForFunction(() => !document.querySelector('#unlock-btn'), null, { timeout: 25_000 });
  return { assetSlug, ask: `${start.adConfig.requiredViews}×${start.adConfig.minSeconds}s` };
}

/**
 * A screenshot of the thing under discussion, not of the top of the page.
 *
 * Every claim this walk makes is about a control that sits below the fold on a
 * 1400×1000 window, and evidence that shows the store's cover image proves nothing
 * about a button. So each shot scrolls its own subject into view first.
 */
async function shotOf(p, selector, name, { full = false } = {}) {
  if (selector && await p.locator(selector).count()) {
    await p.locator(selector).first().scrollIntoViewIfNeeded();
    await p.waitForTimeout(400);
  }
  await p.screenshot({ path: `${OUT}/${name}.png`, fullPage: full });
}

/** The two numbers on the door: how many views this tier costs, how many are left. */
async function doorState(p, slug, tier) {
  await p.goto(`${BASE}/s/${slug}`);
  await consent(p);
  const card = p.locator('.tier-card').nth(tier - 1);
  const text = (await card.textContent()).replace(/\s+/g, ' ').trim();
  const button = card.locator('button[type=submit]');
  const label = (await button.count()) ? (await button.textContent()).trim() : null;
  return { text, label, disabled: (await button.count()) ? await button.isDisabled() : null };
}

// ── 1. the visitor reads the price ────────────────────────────────────────────
say(1, 'a visitor who is not a member reads what the second door costs');
const bob = await pageFor('bob');
const p = bob.p;
const first = await doorState(p, SLUG, 1);
if (!first.label) {
  // Stated rather than assumed. This walk is a sequence from zero — zero standing,
  // no membership — and that state belongs to the seeder, because it is also the
  // state the preview is meant to be found in. A run that starts from the middle
  // would pass every step for the wrong reason.
  throw new Error(`no join panel for ${SLUG}: ${'run `node ci/demo-state.mjs` first'} `
    + '(it puts the two walkers back at zero standing with no membership)');
}
console.log('  the tier card :', JSON.stringify(first.text.slice(0, 200)));
console.log('  the button    :', JSON.stringify(first.label), '· disabled:', first.disabled);
await shotOf(p, '.tier-watching', 'walk-19-door-price');
if (!/join by watching/i.test(first.text)) throw new Error('the second door is not offered on the tier card');
if (!/more views? to go/i.test(first.label || '')) throw new Error(`the button does not name the price: ${first.label}`);
if (first.disabled !== true) throw new Error('the join button is live before the views are earned');

// ── 2. the members file refuses a non-member, in a sentence ───────────────────
say(2, 'and is refused at a members-only file — the hole this round closed');
await p.goto(`${BASE}/s/${SLUG}/a/${MEMBER_FILE}`);
await consent(p);
const lockedText = (await p.locator('.member-gate').textContent()).replace(/\s+/g, ' ').trim();
console.log('  the gate      :', JSON.stringify(lockedText.slice(0, 160)));
await shotOf(p, '.member-gate', 'walk-20-member-file-locked');
if (await p.locator('#unlock-btn').count()) {
  throw new Error('the members-only file offered an ad to a non-member');
}
// The page a locked file renders does not print the file's id, and it should not:
// nothing on it needs one. The seller's own list does, so the harness reads the id
// from Alice's page — a real link in a real page — and then asks the server as Bob.
const sellerPeek = await pageFor('alice');
await sellerPeek.p.goto(`${BASE}/dashboard/${SLUG}`);
await consent(sellerPeek.p);
const href = await sellerPeek.p.locator('tr', { hasText: 'Studio source files' })
  .locator('a[href*="/assets/"]').first().getAttribute('href');
const assetId = (href || '').split('/').pop();
console.log('  the file id    :', assetId, '(read from the seller\u2019s own list)');
const refusal = await p.evaluate(async (id) => {
  const r = await fetch('/api/unlock/start', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ assetId: id }),
  });
  return { status: r.status, body: await r.json() };
}, assetId);
await sellerPeek.ctx.close();
console.log('  the server    :', refusal.status, JSON.stringify(refusal.body));
if (refusal.body?.ok !== false || !/members/.test(String(refusal.body?.error))) {
  throw new Error(`the server did not refuse the non-member: ${JSON.stringify(refusal.body)}`);
}

// ── 3. the views that pay for it ──────────────────────────────────────────────
say(3, "the person's own views accumulate, and the price on the door goes down");
const earned = [];
for (const [i, slug] of EARNERS.bob.entries()) {
  const one = await watchOne(p, SLUG, slug);
  earned.push(one);
  const now = await doorState(p, SLUG, 1);
  console.log(`  view ${i + 1} (${slug}, ${one.ask}) → door says ${JSON.stringify(now.label)}`);
}
console.log('  views earned  :', JSON.stringify(earned.map((e) => e.assetSlug)));
await p.goto(`${BASE}/s/${SLUG}#members`);
await consent(p);
const after = await doorState(p, SLUG, 1);
await shotOf(p, '.tier-watching', 'walk-21-door-earned');
if (/more views? to go/i.test(after.label || '')) throw new Error(`the door still asks for views: ${after.label}`);
if (after.disabled !== false) throw new Error('the join button is still disabled after the price was paid');

// ── 4. the join, and the room it opens ────────────────────────────────────────
say(4, 'the join itself, and the room behind it');
await p.goto(`${BASE}/s/${SLUG}#members`);
await consent(p);
// The join is pressed in the ROOM, which is the page the door belongs to, and the
// redirect has to bring the person back into it rather than out to the shopfront.
await p.goto(`${BASE}/s/${SLUG}/members`);
await consent(p);
const roomDoor = p.locator('form[action$="/join/watching"] button[type=submit]').first();
await roomDoor.scrollIntoViewIfNeeded();
await roomDoor.click();
await p.waitForLoadState('domcontentloaded');
console.log('  url           :', p.url());
const flash = p.locator('.note[role=status]').first();
console.log('  flash         :', JSON.stringify((await flash.textContent()).replace(/\s+/g, ' ').trim().slice(0, 200)));
const room = (await p.locator('body').textContent()).replace(/\s+/g, ' ');
await shotOf(p, '.member-self', 'walk-22-member-room');
if (!/member room/i.test(room)) throw new Error('the join did not land in the member room');
if (!/open to you/i.test(room)) throw new Error('the room does not show the file as open to the member');
// The card is the storefront's own, in the room: the tier, the days left, and the
// journey that got him here. His name is deliberately NOT on it — the roster is the
// other people, which is what makes the room a room rather than a mirror — so what
// the walk checks is the two facts only a member sees.
if (!/You are a member, Friend/.test(room)) throw new Error('the room does not carry his own card');
if (!/joined by watching — 4 verified views did it/.test(room)) throw new Error('the card does not say how he got in');
console.log('  his own card  :', JSON.stringify((room.match(/You are a member, [^.]*\./) || [''])[0]));
console.log('  how he got in :', JSON.stringify((room.match(/You joined by watching[^.]*\./) || [''])[0]));
// And the counter he will use from now on speaks about the NEXT period, not about a
// joining fee he has already paid — the sentence a member reads on the page they
// will return to. It was a "0 of 4 watched — 4 more views to go" line before this
// round's walk looked at it.
const banked = (room.match(/Nothing banked yet[^.]*\.|You have \d+ of the \d+ views for another period[^.]*\./) || [''])[0];
console.log('  next period   :', JSON.stringify(banked));
if (!/Another period\./.test(room)) throw new Error('the member room still frames the door as a joining fee');
if (!/another period/i.test(banked)) throw new Error('the member is not told what the counter is for');

// The file itself, now that a membership opens it — no ad, no button.
await p.goto(`${BASE}/s/${SLUG}/a/${MEMBER_FILE}`);
await consent(p);
const openText = (await p.locator('body').textContent()).replace(/\s+/g, ' ');
await shotOf(p, '.access-list, .kv', 'walk-23-member-file-open');
console.log('  the file      :', /no ad/i.test(openText) ? 'says no ad' : '(no such sentence)');
if (await p.locator('#unlock-btn').count()) throw new Error('a member was still asked to watch an ad');
if (!/Open to members|Members/i.test(openText)) throw new Error('the file page does not say how it was opened');

// ── 5. the seller's side: a member with nothing to check ──────────────────────
say(5, "the seller's page: a member, and nothing in the queue to check");
const alice = await pageFor('alice');
const seller = alice.p;
await seller.goto(`${BASE}/dashboard/${SLUG}/members`);
await consent(seller);
const sellerText = (await seller.locator('body').textContent()).replace(/\s+/g, ' ');
const row = (await seller.locator('tbody tr').allTextContents()).map((t) => t.replace(/\s+/g, ' ').trim());
console.log('  roster rows   :', JSON.stringify(row));
console.log('  waiting copy  :', JSON.stringify((sellerText.match(/A join by watching never appears here[^.]*\./) || [''])[0]));
await shotOf(seller, 'table.table', 'walk-24-seller-roster');
if (!row.some((r) => /bob/i.test(r) && /by watching/.test(r))) {
  throw new Error(`the roster does not say how Bob got in: ${JSON.stringify(row)}`);
}
if (!/never appears here/.test(sellerText)) throw new Error('the seller is not told why the queue is empty of watching joins');

// ── 6. the opt-in arrangement: a membership whose files keep the asks ─────────
say(6, 'the opt-in arrangement, flipped by the seller and read by the member');
await seller.goto(`${BASE}/dashboard/${SLUG}/members`);
await consent(seller);
const editor = seller.locator('.tier-editor').first();
const adSelect = editor.locator('select[name=adMode]');
console.log('  picker before :', await adSelect.inputValue());
await adSelect.selectOption('supporter');
const joinSelect = editor.locator('select[name=joinMode]');
console.log('  doors before  :', await joinSelect.inputValue(), '(options:', JSON.stringify(await joinSelect.locator('option').allTextContents()), ')');
await editor.locator('button[type=submit]').first().click();
await seller.waitForLoadState('domcontentloaded');
await shotOf(seller, '.tier-editor', 'walk-25-seller-picker');
const saved = (await seller.locator('body').textContent()).replace(/\s+/g, ' ');
if (!/Tier 1 saved/.test(saved)) throw new Error('the picker did not save');
console.log('  held-member warning :', await seller.locator('text=/next join gets/').count()
  ? 'shown — somebody joined while this arrangement was open'
  : 'not shown (nobody joined while it was open)');

// Carol earns the same price and joins under the arrangement that is now in force.
const carol = await pageFor('carol');
const cp = carol.p;
for (const slug of EARNERS.carol) await watchOne(cp, SLUG, slug);
await cp.goto(`${BASE}/s/${SLUG}#members`);
await consent(cp);
const carolCard = cp.locator('.tier-card').nth(0);
const supporterLine = (await carolCard.textContent()).replace(/\s+/g, ' ');
// The buyer is told the arrangement BEFORE the button, not after: a card that
// promised "no ad" and then asked for one is the defect these sentences exist to stop.
const supporterCopy = (supporterLine.match(/This tier keeps the ordinary asks[^.]*\./) || [''])[0];
const fileListCopy = (supporterLine.match(/\d+ files? open to this tier[^:]*:/) || [''])[0];
console.log('  the card says :', JSON.stringify(supporterCopy.slice(0, 120)));
console.log('  the list says :', JSON.stringify(fileListCopy));
if (!/ordinary asks/.test(supporterCopy)) throw new Error('the tier card does not state the arrangement');
if (/with no ad/.test(fileListCopy)) throw new Error('the file list still promises no ad on a supporter tier');
await carolCard.locator('button[type=submit]').scrollIntoViewIfNeeded();
await carolCard.locator('button[type=submit]').click();
await cp.waitForLoadState('domcontentloaded');
await cp.goto(`${BASE}/s/${SLUG}/a/${MEMBER_FILE}`);
await consent(cp);
const carolSees = (await cp.locator('body').textContent()).replace(/\s+/g, ' ');
await shotOf(cp, '#unlock-btn', 'walk-26-supporter-ask');
console.log('  the member is told :', JSON.stringify((carolSees.match(/Your membership\.[^.]*\./) || [''])[0]));
console.log('  and is offered     :', JSON.stringify((await cp.locator('#unlock-btn').textContent()).trim()));
if (!/Your membership/.test(carolSees)) throw new Error('a supporter member is not told why they are being asked');
if (await cp.locator('#unlock-btn').count() !== 1) throw new Error('the supporter member was not offered the ordinary ask');
// The view is what opens it, and that is the whole point of the arrangement: the
// membership did not open this file, an ordinary ad did, exactly as it would for a
// visitor. So the walk presses the button and watches the file open.
const beforeCarol = cp.starts.length;
await cp.locator('#unlock-btn').scrollIntoViewIfNeeded();
await cp.locator('#unlock-btn').click();
const cStart = await nextStart(cp, beforeCarol);
if (!cStart?.ok) throw new Error(`no ask was handed out for the supporter member: ${JSON.stringify(cStart)}`);
console.log('  the same ask   :', `${cStart.adConfig.requiredViews}×${cStart.adConfig.minSeconds}s`);
await cp.waitForFunction(() => !document.querySelector('#unlock-btn'), null, { timeout: 25_000 });
console.log('  after the view :', /Open to members|Unlocked/i.test((await cp.locator('body').textContent()).replace(/\s+/g, ' '))
  ? 'the file opened' : '(nothing opened)');
await shotOf(cp, '.access-list, .kv', 'walk-27-supporter-opened');

// ── 6b. the member keeps watching, and buys the NEXT period ───────────────────
say('6b', 'the member keeps watching — and buys the next period with it');
await p.goto(`${BASE}/s/${SLUG}/members`);
await consent(p);
const memberCard = (await p.locator('.member-self').textContent()).replace(/\s+/g, ' ');
const endsBefore = (memberCard.match(/for (\d+) more days/) || [])[1];
console.log('  days left now :', endsBefore);
for (const slug of EARNERS.more) await watchOne(p, SLUG, slug);
// The room, not the storefront: a member's tier cards are gone from the shopfront —
// the panel that sells a tier is not shown to somebody who already holds it — so the
// counter a member reads is the one on their own door.
await p.goto(`${BASE}/s/${SLUG}/members`);
await consent(p);
const doorBlock = (await p.locator('.tier-watching').first().textContent()).replace(/\s+/g, ' ');
console.log('  his door      :', JSON.stringify((doorBlock.match(/Another period\.[^.]*\./) || [''])[0].slice(0, 130)));
const addButton = p.locator('.tier-watching button[type=submit]').first();
console.log('  the button    :', JSON.stringify((await addButton.textContent()).trim()), '· disabled:', await addButton.isDisabled());
await addButton.scrollIntoViewIfNeeded();
await addButton.click();
await p.waitForLoadState('domcontentloaded');
const extendFlash = (await p.locator('.note[role=status]').first().textContent()).replace(/\s+/g, ' ');
console.log('  flash         :', JSON.stringify(extendFlash.slice(0, 170)));
const endsAfter = ((await p.locator('.member-self').textContent()).replace(/\s+/g, ' ').match(/for (\d+) more days/) || [])[1];
console.log('  days left now :', endsAfter, `(was ${endsBefore})`);
await shotOf(p, '.tier-watching', 'walk-29-next-period');
if (!/Another period/.test(extendFlash)) throw new Error('the extension was not confirmed as a new period');
if (!(Number(endsAfter) > Number(endsBefore))) {
  throw new Error(`the period did not grow: ${endsBefore} → ${endsAfter}`);
}

// Put the storefront back on the promise: the demo's own state is what a preview
// session is supposed to find.
say(7, 'and the store is put back on the shipped promise');
await seller.goto(`${BASE}/dashboard/${SLUG}/members`);
await consent(seller);
await seller.locator('.tier-editor').first().locator('select[name=adMode]').selectOption('ad_free');
await seller.locator('.tier-editor').first().locator('button[type=submit]').first().click();
await seller.waitForLoadState('domcontentloaded');
await seller.goto(`${BASE}/s/${SLUG}#members`);
await consent(seller);
console.log('  tier 1 now    :', await seller.locator('.tier-card').first().locator('text=/no ad|ordinary asks/').allTextContents());
await seller.locator('.tier-file-list').first().scrollIntoViewIfNeeded();
await shotOf(seller, '.tier-card', 'walk-28-restored');

const errors = [...p.errors, ...seller.errors, ...cp.errors];
console.log('\nconsole errors:', errors.length ? JSON.stringify(errors, null, 1) : 'none');
if (errors.length) throw new Error(`${errors.length} console error(s)`);

await bob.ctx.close(); await alice.ctx.close(); await carol.ctx.close();
await browser.close();
console.log(`\nwalk complete — 11 screenshots in ${OUT}`);
