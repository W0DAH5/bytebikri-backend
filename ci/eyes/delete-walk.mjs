/**
 * Deleting a file, walked through the seller's own pages in a real browser.
 *
 * `VERIFY THIS` — why it exists, and why a unit test was not enough
 *
 * `app/test/delete.test.js` proves the store call: bytes destroyed, unlocks voided, rows
 * removed, a tombstone kept. What it cannot prove is the thing the ask was actually about —
 * **that a viewer who holds a link cannot get the file any more**. That answer is assembled
 * from four separate pages and a route:
 *
 *   1. the danger-zone link on the manage page, which is the only way in;
 *   2. the confirmation page, which must refuse the wrong word and say the file was not touched;
 *   3. the tombstone, which must report what was destroyed and **name the copy it could not
 *      take back** — Telegra.ph has no delete endpoint, and a delete that quietly claimed
 *      more than it did would be worse than the bug it fixes;
 *   4. the byte routes, which must answer 410 for a deleted file — to the viewer who holds the
 *      link AND to the seller who deleted it — while a merely PAUSED file still serves the
 *      people who opened it.
 *
 * The last one is the reason this is a browser walk rather than an assertion about a function:
 * the URLs are the ones the page handed a viewer, fetched with the sessions that hold them.
 * Nothing about that request is simulated.
 *
 * IT IS A ONE-SHOT AGAINST A FRESHLY SEEDED DATABASE, and it says so on purpose: it ends with a
 * file deleted, and the slug it deletes is the demo's two-file asset (`kathmandu-street-set`:
 * Pixeldrain holds one file, Telegra.ph the other, and Telegra.ph cannot delete). Re-running it
 * without a reseed reports "nothing to delete", which is a pass for the wrong reason — so it
 * fails loudly instead:
 *
 *   cd app && node scripts/test-db.mjs            # recreates and seeds the demo store
 *   PORT=3100 … node scripts/boot.mjs             # see video-host-walk.mjs for the env
 *   rm -rf /tmp/eyes-host                         # a session for a wiped database is stale
 *   node ci/eyes/delete-walk.mjs                  # or EYES_BASE / EYES_DELETE_SLUG
 */
import { chromium } from 'playwright';
import { sessionFor, consent } from './lib.mjs';

const BASE = process.env.EYES_BASE || process.argv[2] || 'http://127.0.0.1:3100';
/* Bob's store, because that is whose it is: the two-file asset is his, and the demo gives Alice
 * the videos. A walk that guessed the store by slug would 404 and blame the product. */
const SELLER = process.env.EYES_SELLER || 'bob';
const STORE = process.env.EYES_STORE || 'bob';
// The two-file asset: Pixeldrain holds one file (deletable), Telegra.ph holds the other and
// cannot delete. One delete therefore exercises both halves of the report.
const SLUG = process.env.EYES_DELETE_SLUG || 'kathmandu-street-set';
// Another of Bob's files, paused through the same bulk control a seller uses — so "a paused file
// still serves whoever opened it" is checked on an ad-gated file, where the unlock is real.
const PAUSE_SLUG = process.env.EYES_PAUSE_SLUG || 'studio-print-01';
// A third account: the viewer who unlocks while the file is live and holds the link afterwards.
const VIEWER = process.env.EYES_VIEWER || 'carol';

const errors = [];
const fail = (m) => { console.error(`FAIL  ${m}`); errors.push(m); };
const ok = (m, extra = '') => console.log(`ok    ${m}${extra ? ` — ${extra}` : ''}`);
const flat = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/\s+/g, ' ');

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/tmp/chromium',
  args: ['--no-sandbox'],
});

/**
 * Open a file the way a viewer does — including the ad, which the walk has to deliver itself
 * (`walk-ads.mjs` explains why a harness plays the network) — and hand back the content URLs
 * that page gave out. On an ad-gated file there is no player and no link until it is opened,
 * so a walk that read the page without unlocking would find nothing and report a product
 * failure that is really a walk mistake. It did, the first time.
 */
async function openAsViewer(page, slug) {
  await page.goto(`${BASE}/s/${STORE}/a/${slug}`, { waitUntil: 'domcontentloaded' });
  await consent(page);
  if (await page.locator('#unlock-btn').count()) {
    const [started] = await Promise.all([
      page.waitForResponse((r) => /\/api\/unlock\/start$/.test(new URL(r.url()).pathname), { timeout: 20_000 })
        .catch(() => null),
      page.click('#unlock-btn'),
    ]);
    const info = started ? await started.json().catch(() => null) : null;
    if (info?.adConfig?.providerId) {
      await fetch(`${BASE}/dev/simulate-network/${info.adConfig.providerId}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          viewId: info.viewId,
          connectionId: info.adConfig.connectionId,
          durationSec: info.adConfig.minSeconds,
        }),
      });
      await page.waitForSelector('[data-watch]', { timeout: 30_000 }).catch(() => {});
      await page.waitForTimeout(400);
    }
  }
  return page.evaluate(() => [...document.querySelectorAll('[href],[src]')]
    .map((e) => e.getAttribute('href') || e.getAttribute('src'))
    .filter((u) => u && u.includes('/api/content')));
}

/** The seller's own row for a slug, found the way a seller finds it: in the files list. */
const rowFor = (page, slug) => page.evaluate((s) => {
  const row = [...document.querySelectorAll('tr')].find((tr) => tr.textContent.includes(s));
  return row ? {
    manage: row.querySelector('a[href*="/assets/"]')?.getAttribute('href') || null,
    checkbox: row.querySelector('input[name="ids"]')?.value || null,
  } : null;
}, slug);

try {
  const sellerState = await sessionFor(browser, SELLER, { base: BASE, dir: '/tmp/eyes-host' });
  const viewerState = await sessionFor(browser, VIEWER, { base: BASE, dir: '/tmp/eyes-host' });
  const sellerCtx = await browser.newContext({ storageState: sellerState });
  const viewerCtx = await browser.newContext({ storageState: viewerState });
  const page = await sellerCtx.newPage();
  const viewer = await viewerCtx.newPage();
  const consoleErrors = [];
  for (const p of [page, viewer]) {
    p.on('pageerror', (e) => consoleErrors.push(e.message.slice(0, 140)));
    p.on('console', (m) => {
      if (/CORS|ERR_FAILED|blocked by/i.test(m.text()) || m.type() === 'error') consoleErrors.push(m.text().slice(0, 200));
    });
  }

  // ── 1. the link a viewer holds, and the page a seller uses ─────────────────
  //
  // Both are read BEFORE anything is deleted, because afterwards there is no page that offers
  // them — which is the point, but it also means a walk that read them later would check an
  // empty list and call that a pass.
  const held = await openAsViewer(viewer, SLUG);
  if (!held.length) {
    fail(`no content url on /s/${STORE}/a/${SLUG} for ${VIEWER} — nothing to hold the routes to. `
      + 'If the store is seeded but this file is gone, a previous run deleted it: reseed with '
      + '`node app/scripts/test-db.mjs`, then `node app/scripts/boot.mjs`');
  } else {
    ok('the viewer opened the file and holds a content url', held[0].slice(0, 64));
  }
  /* The seller's OWN link, minted for their own session. Asking the seller to fetch the URL the
   * viewer holds answers the wrong question and answers it 403 — the token is bound to the
   * account it was issued to, which is a different rule entirely (and the walk's first version
   * reported that 403 as a delete failure). */
  const sellerHeld = await openAsViewer(page, SLUG);

  await page.goto(`${BASE}/dashboard/${STORE}#files`, { waitUntil: 'domcontentloaded' });
  const row = await rowFor(page, SLUG);
  if (!row?.manage) {
    fail(`the seller's file list has no row for ${SLUG} — the danger-zone link is unreachable`);
  } else {
    ok('the seller finds their own file in the list', row.manage);
  }

  await page.goto(`${BASE}${row?.manage || `/dashboard/${STORE}#files`}`, { waitUntil: 'domcontentloaded' });
  const deleteHref = await page.evaluate(() => {
    const link = [...document.querySelectorAll('a[href$="/delete"]')][0];
    return link ? link.getAttribute('href') : null;
  });
  if (!deleteHref) {
    fail('the manage page has no link to the delete page — a file cannot be deleted from the product');
  } else {
    ok('the manage page offers the delete page, in its own danger zone', deleteHref);
  }

  // ── 2. the wrong word ──────────────────────────────────────────────────────
  //
  // A confirmation that lives only in the browser is one a scripted post skips, and this is the
  // check that says so from the outside. The word used here is a DIFFERENT word, not a
  // different case: the first version of this walk typed `DELETE` and the server accepted it,
  // because it folded the case before comparing — a confirmation that accepts something other
  // than what the page asks for is not a confirmation, and it deleted the file mid-walk.
  if (!deleteHref) {
    console.log(`\ndelete walk: ${errors.length} finding(s)`);
    await sellerCtx.close();
    await browser.close();
    process.exit(1);
  }
  const delPath = `${BASE}${deleteHref}`;
  await page.goto(delPath, { waitUntil: 'domcontentloaded' });
  const hasField = await page.evaluate(() => Boolean(
    document.querySelector('form[action$="/delete"] input[name="confirm"]'),
  ));
  if (!hasField) {
    fail('the delete page has no confirm field — there is nothing to type the word into');
  } else {
    await page.fill('form[action$="/delete"] input[name="confirm"]', 'remove');
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
      page.click('form[action$="/delete"] button[type="submit"]'),
    ]);
    const refused = flat(await page.content());
    if (!/error=confirm/.test(page.url())) {
      fail(`the wrong word was accepted (landed on ${new URL(page.url()).pathname}${new URL(page.url()).search}) `
        + '— a confirmation that can be skipped is not one');
    } else if (!/not touched/i.test(refused)) {
      fail('the page refused the word but never said whether anything happened');
    } else {
      ok('a different word is refused, and the page says the file was not touched');
    }
    const stillThere = await viewer.request.get(new URL(held[0], BASE).href, { maxRedirects: 0 });
    if (stillThere.status() === 410) fail('a refused delete still took the file away');
    else ok('and the viewer can still open it after the refusal', `status ${stillThere.status()}`);
  }

  // ── 3. the right word, and the report that comes with it ───────────────────
  //
  // All four assertions below read the page the POST LANDED on. Re-fetching the page afterwards
  // loses the report — it is rendered from the query the redirect carries — and the first
  // version of this walk made exactly that mistake and reported a missing report that was there.
  await page.goto(delPath, { waitUntil: 'domcontentloaded' });
  await page.fill('form[action$="/delete"] input[name="confirm"]', 'delete');
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
    page.click('form[action$="/delete"] button[type="submit"]'),
  ]);
  const tomb = flat(await page.content());
  if (/error=confirm/.test(page.url())) {
    fail('the typed word was refused as well — the confirmation accepts nothing');
  } else if (!/deleted/i.test(tomb)) {
    fail('the page after the delete does not say the file was deleted');
  } else {
    ok('the delete landed on a page that says the file was deleted');
  }
  if (/\d+ file(s)? destroyed/i.test(tomb)) ok('and the report says how many files were destroyed');
  else fail('the report never says the files were destroyed');
  if (/unlock(s)? voided/i.test(tomb)) ok('and what happened to the people who had it open');
  else fail('the report never mentions the unlocks it voided — a delete nobody is told about is one nobody can trust');
  /*
   * THE ORPHAN. Telegra.ph has no delete endpoint, so one of this asset's two files cannot be
   * taken back. The page must name it: a seller told "deleted" while a picture is still served
   * from somebody else's CDN has been misled by omission, and the whole reason this round exists
   * is that the previous behaviour (refuse the delete, keep serving) was worse.
   */
  if (/telegra\.ph|no delete endpoint|could not be taken back/i.test(tomb)) {
    ok('the report names the copy it could not take back');
  } else {
    fail('the report does not mention the orphan — the seller would believe the file is gone everywhere');
  }

  // ── 4. the bytes, for both sessions ────────────────────────────────────────
  //
  // Two requests, and they answer two different questions. The VIEWER's is the ask ("they cannot
  // access it any more"); the SELLER's is the rule the walk had to teach this code — an owner is
  // not privileged to the bytes of a file they deleted, and the first version answered 403
  // "you have not unlocked this" because the privilege exemption let the request fall through to
  // the entitlement check.
  for (const [who, session, urls] of [
    ['the viewer who held it', viewer, held],
    ['the seller who deleted it', page, sellerHeld],
  ]) {
    for (const url of urls) {
      const path = new URL(url, BASE).pathname.replace(/\/file\/[0-9a-f-]{36}/, '/file/…');
      const gone = await session.request.get(new URL(url, BASE).href, { maxRedirects: 0 });
      if (gone.status() === 410) ok(`${who} gets Gone, not merely missing`, `${path} → 410`);
      else fail(`${who} got ${gone.status()} from a deleted file — a link anyone holds must stop working (410)`);
    }
  }
  if (!sellerHeld.length) fail('the seller has no content url of their own to check — the owner half of the rule went unproven');
  const shelf = flat(await (await page.request.get(`${BASE}/s/${STORE}`)).text());
  if (shelf.includes(SLUG)) fail('the storefront still lists a deleted file');
  else ok('the storefront no longer lists it');

  const tombSeller = flat(await (await page.request.get(`${BASE}${row.manage}`)).text());
  if (/Deleted/i.test(tombSeller)) ok('and the seller’s own page for it reads as a tombstone');
  else fail('the seller’s manage page does not read as a tombstone after the delete');

  // ── 5. pausing is not deleting ─────────────────────────────────────────────
  //
  // The other half of the promise, and the reason the state gate does not simply refuse every
  // non-live file: an unlock buys the file, so a two-minute fix must not take it away from every
  // buyer. Pausing is a bulk action on the files list — the control a seller actually has —
  // so this uses it rather than a route of its own.
  const pauseHeld = await openAsViewer(viewer, PAUSE_SLUG);
  await page.goto(`${BASE}/dashboard/${STORE}#files`, { waitUntil: 'domcontentloaded' });
  const pauseRow = await rowFor(page, PAUSE_SLUG);
  if (!pauseHeld.length || !pauseRow?.checkbox) {
    fail(`could not set up the pause check (${PAUSE_SLUG}: url ${pauseHeld.length}, row ${pauseRow ? 'found' : 'missing'})`);
  } else {
    await page.check(`input[name="ids"][value="${pauseRow.checkbox}"]`);
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
      page.click('button[name="action"][value="pause"]'),
    ]);
    const served = await viewer.request.get(new URL(pauseHeld[0], BASE).href, { maxRedirects: 0 });
    if (served.status() === 410 || served.status() === 403) {
      fail(`a paused file answered ${served.status()} to a viewer who holds it — an unlock buys the file, `
        + 'so pausing must not take it away from every buyer');
    } else {
      ok('a paused file still serves the viewer who opened it', `status ${served.status()}`);
    }
    const shelf2 = flat(await (await page.request.get(`${BASE}/s/${STORE}`)).text());
    if (shelf2.includes(PAUSE_SLUG)) fail('a paused file is still listed on the storefront');
    else ok('and the storefront stopped listing it, which is what pausing is for');

    // Put it back, so the instance is left the way it was found.
    await page.goto(`${BASE}/dashboard/${STORE}#files`, { waitUntil: 'domcontentloaded' });
    await page.check(`input[name="ids"][value="${pauseRow.checkbox}"]`);
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
      page.click('button[name="action"][value="live"]'),
    ]);
    const back = await rowFor(page, PAUSE_SLUG);
    const stillPaused = await page.evaluate((value) => {
      const box = document.querySelector(`input[name="ids"][value="${value}"]`);
      const rowEl = box ? box.closest('tr') : null;
      return rowEl ? /Paused/i.test(rowEl.textContent) : null;
    }, pauseRow.checkbox);
    if (stillPaused === false) ok('and the pause was lifted again');
    else fail('the file could not be put back live — the instance is left paused');
    void back;
  }

  if (consoleErrors.length) fail(`console errors — ${consoleErrors.slice(0, 3).join(' | ')}`);
  await sellerCtx.close();
  await viewerCtx.close();
} finally {
  await browser.close();
}

console.log(`\ndelete walk: ${errors.length} finding(s)`);
process.exit(errors.length ? 1 : 0);
