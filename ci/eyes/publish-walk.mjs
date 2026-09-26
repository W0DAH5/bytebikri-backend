/**
 * The publish form, walked in a real browser — the seller's primary action.
 *
 * `VERIFY THIS` — why this one matters more than most
 *
 * Every other walk in this folder starts from a file that is ALREADY in the database: the demo
 * seed creates them, and the walks open them. But the demo seed does not go through this form —
 * it writes rows (and re-uploads fixtures through the adapter) — so the product's single most
 * used screen had never been driven the way a seller drives it: pick a file with the operating
 * system's picker, press Publish, and live with what comes back.
 *
 * The failure modes that only appear here are the ones this walk exists for:
 *
 *   1. **An oversized upload.** Multer refuses INSIDE the middleware, while the browser is still
 *      sending the body. A redirect written at that moment can race the upload: the server answers
 *      `302` and closes, the browser is mid-POST, and the seller gets a connection error instead of
 *      the sentence that explains what happened. `app/test/video.test.js` cannot see this — it has
 *      no socket. This walk uses a real one, with a file over the cap.
 *   2. **Where the bytes went.** The publish path routes by KIND through the registry, and the
 *      seller's own page is supposed to say which host holds the file. A form that publishes and a
 *      page that lies about where the file lives are both invisible to a store-level test.
 *   3. **The refusals, in the seller's words.** Each one has a sentence written for it
 *      (`ERROR_FLASH`), and a sentence is only worth writing if the page it lands on renders it.
 *
 *   cd app && node scripts/test-db.mjs          # a fresh demo store, or the slugs change
 *   PORT=3100 … node scripts/boot.mjs           # see video-host-walk.mjs for the env
 *   rm -rf /tmp/eyes-publish
 *   node ci/eyes/publish-walk.mjs
 *
 * It PUBLISHES FILES and leaves them published (that is what it is testing), so it is a
 * one-shot-per-reseed walk like `delete-walk.mjs`: re-running it against the same database is
 * fine — it publishes under a dated title so it never collides with itself — but the store it
 * runs in will accumulate two small files per run. `node scripts/test-db.mjs` clears them.
 */
import { chromium } from 'playwright';
import { sessionFor, consent } from './lib.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.env.EYES_BASE || process.argv[2] || 'http://127.0.0.1:3100';
const STORE = process.env.EYES_STORE || 'alice';
// The product's own cap, read from the same place the flash message reads it — hardcoded in
// `server.js`'s multer config and repeated in two sentences. If those three ever drift, this walk
// reports the file that got through rather than a number from a comment.
const CAP_MB = Number(process.env.EYES_CAP_MB || 25);

const errors = [];
const fail = (m) => { console.error(`FAIL  ${m}`); errors.push(m); };
const ok = (m, extra = '') => console.log(`ok    ${m}${extra ? ` — ${extra}` : ''}`);
const flat = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/\s+/g, ' ');

/** A scratch directory for the files this walk uploads; never inside the repository. */
const SCRATCH = process.env.EYES_SCRATCH || '/tmp/eyes-publish';
mkdirSync(SCRATCH, { recursive: true });

/**
 * The three files. The small one is a real PNG (so the reader and the image path see something
 * real), the big one is over the product's cap by a wide margin, and the text one is small enough
 * for any host.
 */
const SMALL_PNG = join(SCRATCH, 'walk-publish.png');
writeFileSync(SMALL_PNG, Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAOklEQVR42mNkYPhfz0AEYBxVSF+F'
  + 'jIyM/xnpqRAAJgB1VAoYGRkZ/1PUEAaGxwJmZmbG/1QzYPQAANv5D/WXq0B4AAAAAElFTkSuQmCC',
  'base64',
));
const SMALL_TXT = join(SCRATCH, 'walk-publish.txt');
writeFileSync(SMALL_TXT, 'A file published by ci/eyes/publish-walk.mjs to prove the form works end to end.\n');
const BIG_FILE = join(SCRATCH, 'walk-too-big.bin');
if (!process.env.EYES_SKIP_BIG) {
  // Deterministic filler, written in 1 MB chunks so a 26 MB file does not cost 26 MB of string.
  const chunk = Buffer.alloc(1024 * 1024, 7);
  const fd = [];
  for (let i = 0; i < CAP_MB + 1; i += 1) fd.push(chunk);
  writeFileSync(BIG_FILE, Buffer.concat(fd));
}

/*
 * Shots. This walk is the one that proves what a SELLER is told, and two of the things it asserts are
 * sentences — the host holding the file, and the refusal for a file over the cap. A sentence is the
 * kind of thing that can be true, wrong, or absent while a regex still finds something, so the page
 * it appeared on is kept. Written under docs/evidence so the run leaves a picture and not only a
 * console line that somebody has to take on trust.
 */
const OUT = process.env.EYES_OUT || 'docs/evidence/round44';
mkdirSync(OUT, { recursive: true });

/*
 * A screenshot is taken after the page has stopped MOVING.
 *
 * `html { scroll-behavior: smooth }` (app/public/styles.css) makes the browser animate a jump to
 * `#publish`, and the publish flow lands on a url with a fragment — so the frame captured the moment
 * after a redirect is a half-scrolled composite: the hero drawn where it is going, the form still
 * where it was, the two overlapping. It looked exactly like a layout bug and was not one (measured:
 * no element intersects anything, at rest or after the redirect). Disabling the animation before the
 * shot is the whole fix; the alternative — a picture in `docs/evidence` that shows a defect nobody
 * can reproduce — costs someone an afternoon.
 */
const settle = async (p, y = null) => {
  await p.evaluate((to) => {
    document.documentElement.style.scrollBehavior = 'auto';
    window.scrollTo(0, to ?? window.scrollY);
  }, y).catch(() => {});
  await p.waitForTimeout(200);
};
const shot = async (p, name) => {
  await settle(p);
  await p.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
};

const stamp = new Date().toISOString().slice(11, 19).replace(/:/g, '');
const TITLE_SMALL = `Walk publish ${stamp}`;
const TITLE_OVERSIZE = `Walk oversize ${stamp}`;

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/tmp/chromium',
  args: ['--no-sandbox'],
});

try {
  const state = await sessionFor(browser, 'alice', { base: BASE, dir: '/tmp/eyes-publish' });
  const context = await browser.newContext({ storageState: state });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on('pageerror', (e) => consoleErrors.push(e.message.slice(0, 140)));
  page.on('console', (m) => {
    if (/CORS|ERR_FAILED|blocked by/i.test(m.text()) || m.type() === 'error') consoleErrors.push(m.text().slice(0, 200));
  });

  const formUrl = `${BASE}/dashboard/${STORE}#publish`;
  await page.goto(formUrl, { waitUntil: 'domcontentloaded' });

  // ── 0. the form is on the page, and says the cap ───────────────────────────
  const form = page.locator('form[action$="/assets"][enctype*="multipart"]').first();
  if (!(await form.count())) {
    fail('the publish form is not on the dashboard — a seller cannot upload anything');
    console.log(`\npublish walk: ${errors.length} finding(s)`);
    await context.close();
    await browser.close();
    process.exit(1);
  }
  const hint = flat(await form.innerHTML());
  if (new RegExp(`${CAP_MB} MB`).test(hint)) {
    ok('the form states the size limit before a file is chosen', `${CAP_MB} MB`);
  } else {
    fail(`the form never says the ${CAP_MB} MB limit — the seller learns it by hitting it`);
  }

  // ── 1. the happy path, exactly as a seller does it ─────────────────────────
  await page.fill('#p-title', TITLE_SMALL);
  await page.fill('#p-desc', 'Published by the browser walk: one small picture, through the form.');
  await page.setInputFiles('#p-media', SMALL_PNG);
  await page.setInputFiles('#p-cover', SMALL_PNG);
  await page.selectOption('#p-mode', 'open');
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 60_000 }),
    page.click('form[action$="/assets"][enctype*="multipart"] button[type="submit"]'),
  ]);
  const landed = new URL(page.url());
  const afterPublish = flat(await page.content());
  if (landed.searchParams.get('published')) {
    ok('publishing lands on the dashboard with the slug it made', landed.searchParams.get('published'));
  } else if (/error=/.test(landed.search)) {
    fail(`publishing was refused: ${landed.search} — ${afterPublish.slice(0, 200)}`);
  } else {
    fail(`publishing neither confirmed nor refused (landed on ${landed.pathname}${landed.search})`);
  }
  if (/published|is live|Live/i.test(afterPublish)) {
    ok('and the page says the file is live');
  } else {
    fail('nothing on the page after publishing says whether it worked');
  }

  // The file is really in the store, and the page a viewer gets really has a picture on it.
  const slug = landed.searchParams.get('published');
  if (slug) {
    const publicPage = await page.request.get(`${BASE}/s/${STORE}/a/${slug}`);
    const publicHtml = flat(await publicPage.text());
    if (publicPage.status() !== 200) {
      fail(`the new file's public page answered ${publicPage.status()} — the publisher and the storefront disagree`);
    } else if (!publicHtml.includes(TITLE_SMALL)) {
      fail('the storefront page does not carry the title that was published');
    } else {
      ok('the file is on the storefront at its own address', `/s/${STORE}/a/${slug}`);
    }
    // An open file: the picture should be on the page without any unlock.
    const img = await page.goto(`${BASE}/s/${STORE}/a/${slug}`, { waitUntil: 'domcontentloaded' })
      .then(() => page.evaluate(() => {
        const el = document.querySelector('img[src*="/api/content/"], img');
        return el ? { src: el.getAttribute('src'), w: el.naturalWidth || null } : null;
      }));
    if (img?.src?.includes('/api/content/')) {
      ok('a viewer sees the picture without unlocking (it was published as free)', img.src.slice(0, 60));
    } else {
      fail('the open file has no picture on its page for a viewer');
    }
    await consent(page);
  }

  /*
   * ── 2. WHERE THE BYTES WENT, on the seller's own page ──────────────────────
   *
   * The registry routes by kind, so a picture and a document can end up at two different hosts —
   * and the seller's page is supposed to say which. `data-hosted-note="1"` is that element; the
   * walk reads the sentence rather than the attribute, because the attribute being present while
   * the sentence says the wrong host would still pass an attribute check.
   */
  const listRow = await page.request.get(`${BASE}/dashboard/${STORE}#files`);
  const listHtml = flat(await listRow.text());
  if (listHtml.includes(TITLE_SMALL)) ok('the file appears in the seller\'s own list');
  else fail('the published file is not in the seller\'s list');

  await page.goto(`${BASE}/dashboard/${STORE}#files`, { waitUntil: 'domcontentloaded' });
  const sellHref = await page.evaluate((title) => {
    const row = [...document.querySelectorAll('tr')].find((tr) => tr.textContent.includes(title));
    return row ? (row.querySelector('a[href*="/assets/"]')?.getAttribute('href') || '') : '';
  }, TITLE_SMALL);
  const sellPage = await page.request.get(`${BASE}${sellHref}`);
  const sellHtml = flat(await sellPage.text());
  /*
   * ── what this asserts, and the two mistakes it made getting here ──────────────
   *
   * The first version matched `/held at|held by|stored at|is being held/` — a regex written from
   * the sentence the walk EXPECTED, not from the sentence the page renders. The real wording was
   * "held and delivered by our media host", which matches none of those alternatives, so this
   * check failed on a page that was doing exactly what it promised. A test that invents its own
   * phrasing reports the product as broken every time the product is fine.
   *
   * Underneath the false failure was the real defect, and the second version asserts the fact
   * rather than the words. The page DID render a sentence — for a Telegraph-hosted PNG it said
   * "A video is kept and delivered by the platform's media host" and "Everything else a store
   * uploads stays on this server". Both halves false for the file on the screen. So: a host must be
   * NAMED for this file (not "a media host" — the point of the sentence is which one), and the
   * video-only claim must be gone. The host is asserted against the registry's own label, so this
   * cannot pass by naming a provider the product does not use.
   */
  const hostNamed = /held at\s+([A-Za-z][A-Za-z0-9.']{1,30})/.exec(sellHtml);
  if (hostNamed) {
    ok('the seller\'s page names the host holding this file', `held at ${hostNamed[1]}`);
  } else {
    fail('the seller is not told where their own file is held — no host is named on the page');
  }
  if (/A video is kept and delivered by the platform's media host/i.test(sellHtml)) {
    fail('the page still claims the media host only holds video — it is a lie for an image or a document');
  } else ok('the host sentence is about any kind, not only video');

  /*
   * The same fact, asked on the page that destroys it. The delete page's first line promises to say
   * how many of these files are NOT on this disk, and it read a prop its route never passed — so for
   * as long as that page has existed the clause never rendered and the count was always zero. A read
   * only: this walk publishes, it never deletes.
   */
  const delHtml = flat(await (await page.request.get(`${BASE}${sellHref}/delete`)).text());
  if (/holds? a copy, named below/i.test(delHtml)) {
    ok('the delete page says a copy of this file is somewhere else', (/(Telegra\.ph|Pixeldrain|Catbox|Filemoon)[^ ]* holds? a copy/.exec(delHtml) || [''])[0]);
  } else {
    fail('the delete page does not say that a copy of this file is held by a host — its count reads zero again');
  }

  // The page itself, because the two assertions above are about sentences.
  await page.goto(`${BASE}${sellHref}`, { waitUntil: 'domcontentloaded' });
  await settle(page);
  await page.locator('[data-hosted-note="1"]').scrollIntoViewIfNeeded().catch(() => {});
  await shot(page, 'publish-1-where-the-bytes-are');

  // ── 3. a file over the cap, sent the way a browser sends one ───────────────
  //
  // THE ONE THAT NEEDS A SOCKET. The browser streams 26 MB, multer refuses mid-body, and the
  // route redirects. What comes back is either a rendered sentence (the product works) or a
  // connection error (the redirect raced the upload — the bug this check was written for).
  if (!process.env.EYES_SKIP_BIG) {
    await page.goto(formUrl, { waitUntil: 'domcontentloaded' });
    await page.fill('#p-title', TITLE_OVERSIZE);
    await page.setInputFiles('#p-media', BIG_FILE);
    let navigationError = null;
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 120_000 }).catch((err) => { navigationError = err; }),
      page.click('form[action$="/assets"][enctype*="multipart"] button[type="submit"]').catch(() => {}),
    ]);
    if (navigationError) {
      fail(`an oversized upload broke the page instead of explaining itself (${navigationError.message.slice(0, 80)}) `
        + '— the browser was still sending when the server answered');
    } else {
      const bigUrl = new URL(page.url());
      const bigText = flat(await page.content());
      if (/error=size|error=toobig/.test(bigUrl.search)) {
        ok('the refusal is a redirect the browser survives', bigUrl.search);
      }
      if (/larger than the \d+ MB/i.test(bigText)) {
        ok('and the page says the file was too big, naming the number', (/larger than the [\d]+ MB[^.]*/.exec(bigText) || [''])[0].slice(0, 60));
      } else {
        fail(`the oversized upload produced no sentence: ${bigText.slice(0, 180)}`);
      }
      // The top of the page, because that is where the refusal lands and what a seller sees first.
      await settle(page, 0);
      await shot(page, 'publish-2-over-the-cap');
      // And nothing was published, which is the half that matters to a seller's file count.
      const shelfAfter = flat(await (await page.request.get(`${BASE}/s/${STORE}`)).text());
      if (shelfAfter.includes(TITLE_OVERSIZE)) {
        fail('the oversized file was published anyway — the cap is not enforced');
      } else {
        ok('and nothing was published from it');
      }
    }
  }

  // ── 4. the two refusals a person can actually cause ────────────────────────
  //
  // No title is blocked by `required` in the browser, and no file likewise — so those are tested
  // by POST, the way a form without JavaScript would do it. The walk sends what the browser
  // would not, because a server-side rule that only exists in the browser's `required` is a rule
  // any script skips.
  const post = (fields) => page.request.post(`${BASE}/dashboard/${STORE}/assets`, {
    multipart: fields, maxRedirects: 0,
  });

  const noTitle = await post({ media: { name: 'x.txt', mimeType: 'text/plain', buffer: Buffer.from('x') } });
  const noTitleLoc = noTitle.headers()['location'] || '';
  if (/error=title/.test(noTitleLoc)) ok('a file with no title is refused, by the server', noTitleLoc);
  else fail(`a file with no title was accepted (${noTitle.status()} ${noTitleLoc})`);

  const noMedia = await post({ title: `Walk no media ${stamp}` });
  const noMediaLoc = noMedia.headers()['location'] || '';
  if (/error=media/.test(noMediaLoc)) {
    ok('a title with no file is refused, by the server', noMediaLoc);
    // And the sentence the redirect points at is a real one.
    const shown = await page.request.get(`${BASE}${noMediaLoc.replace(/^\//, '/')}`);
    const shownText = flat(await shown.text());
    if (/Attach the file people are unlocking/i.test(shownText)) ok('and the page explains it in the seller\'s words');
    else fail('the media refusal lands on a page whose text does not explain it');
  } else {
    fail(`a title with no file was accepted (${noMedia.status()} ${noMediaLoc})`);
  }

  // ── 5. a cover that is not an image ────────────────────────────────────────
  //
  // `accept="image/*"` is a hint to the picker, not a rule: a POST can carry anything. The route
  // checks the mime type, and this is the check that it really does.
  const badCover = await post({
    title: `Walk bad cover ${stamp}`,
    unlockMode: 'open',
    media: { name: 'y.txt', mimeType: 'text/plain', buffer: Buffer.from('y') },
    cover: { name: 'notanimage.txt', mimeType: 'text/plain', buffer: Buffer.from('not an image') },
  });
  const badCoverLoc = badCover.headers()['location'] || '';
  if (/error=cover/.test(badCoverLoc)) ok('a cover that is not an image is refused by the server, not just the picker');
  else fail(`a non-image cover was accepted (${badCover.status()} ${badCoverLoc})`);

  if (consoleErrors.length) fail(`console errors — ${consoleErrors.slice(0, 3).join(' | ')}`);
  await context.close();
} finally {
  await browser.close();
}

console.log(`\npublish walk: ${errors.length} finding(s)`);
process.exit(errors.length ? 1 : 0);
