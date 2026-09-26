/*
 * The two ceilings, driven through the form — and the difference between them.
 *
 * `publish-walk.mjs` already proves the PRODUCT's ceiling: a file over 25 MB is refused with a
 * sentence that names the number, and nothing is published. This walk is about the other one,
 * which is smaller and much easier to get wrong:
 *
 *   THE HOST'S CEILING. Telegra.ph takes 5 MB per image. A 6 MB photograph is inside every
 *   promise this product makes to a seller — the form says 25 MB, the picker accepts it, the
 *   bytes arrive — and yet the host it would have gone to must not receive it. The designed
 *   answer is that the host is never asked: `acceptsFile` is consulted while the ROUTE is being
 *   decided, so a file the host would refuse moves to the next candidate, and when there is no
 *   next candidate it stays on our own disk. The seller gets a working file, on a page that says
 *   where the bytes are, and the operator gets one line in the log saying why.
 *
 * WHAT ACTUALLY HAPPENS, MEASURED BEFORE THIS WALK WAS WRITTEN — and it is better than the note
 * in `video-telegraph.js` claims. The kind's driver list is [the kind's own host, the general file
 * host], so a 5.5 MB image does NOT go to our disk on a deployment that also configures a general
 * host: Telegra.ph is skipped for size, Pixeldrain takes it. It lands on our disk only when no
 * configured host will take it — and THAT is the state that has to explain itself:
 *
 *   1. The form's own sentence and the module in `src/upload-limit.js` are the same number.
 *   2. A 5.5 MB image publishes, is served byte for byte, and the file's OWN LINE on the seller's
 *      page says where it really is. (The first version of this walk searched the whole page for
 *      "on this server" and passed on a file held at Pixeldrain, because the page's explanatory
 *      note contains those words. It asserts the row now.)
 *   3. On an instance where NO host will take the file — the image host refuses it by size and no
 *      general host is configured — it stays on our own disk, the instance's log names the host's
 *      ceiling as the reason, and no bytes were sent to the host that would have refused them.
 *   4. When a general host IS configured, the same file goes there instead: a host's limit does not
 *      become the product's limit, and the seller is not punished for a rule they never saw.
 *
 * Two instances are needed because 3 and 4 are opposites, and each needs its own output in a file
 * for the log check to mean anything.
 *
 * USAGE
 *
 * Two throwaway instances of the same app, each with its output in a file — the demo env (:3100)
 * with the general host configured, and the same env with the general host removed:
 *
 *   # A: the image host AND a general file host (MEDIA relay/edge env as usual)
 *   PORT=3300 DATABASE_URL=… IMAGE_DRIVER=telegraph FILE_DRIVER=pixeldrain … > /tmp/3300.log 2>&1 &
 *   # B: the image host only, so nothing else can take what it refuses
 *   PORT=3400 DATABASE_URL=… IMAGE_DRIVER=telegraph FILE_DRIVER= … > /tmp/3400.log 2>&1 &
 *
 *   EYES_BASE=http://127.0.0.1:3300 EYES_LOG=/tmp/3300.log \
 *   EYES_ALONE=http://127.0.0.1:3400 EYES_ALONE_LOG=/tmp/3400.log \
 *   node ci/eyes/upload-cap-walk.mjs
 *
 * `EYES_LOG` / `EYES_ALONE_LOG` are optional because a walk has no business requiring how somebody
 * runs their server; without them the log lines are skipped with a printed note. The lines are what
 * separate "the host was never asked" from "the host said no" — a difference the page cannot show,
 * because both are a file that works.
 *
 * `EYES_LOG` is a path to the instance's own output. It is optional because a walk has no business
 * requiring how an operator runs their server, but when it is given, the walk checks the two log
 * lines that distinguish "the host was never asked" from "the host said no" — a difference the page
 * cannot show, because both end with the file on our disk.
 */
import { chromium } from 'playwright';
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { deflateSync, crc32 } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { sessionFor } from './lib.mjs';
import { UPLOAD_CAP_MB } from '../../app/src/upload-limit.js';

const BASE = String(process.env.EYES_BASE || 'http://127.0.0.1:3100').replace(/\/+$/, '');
const LOG = process.env.EYES_LOG || null;
const ALONE = process.env.EYES_ALONE ? String(process.env.EYES_ALONE).replace(/\/+$/, '') : null;
const ALONE_LOG = process.env.EYES_ALONE_LOG || null;
const STORE = process.env.EYES_STORE || 'alice';
const OUT = process.env.EYES_OUT || 'docs/evidence/round46';
mkdirSync(OUT, { recursive: true });

/*
 * `scroll-behavior: smooth` makes a shot taken after a redirect a torn composite; the animation is
 * turned off before every frame, the same fix (and the same reason) as the other walks.
 */
const shot = async (p, name) => {
  await p.evaluate(() => { document.documentElement.style.scrollBehavior = 'auto'; }).catch(() => {});
  await p.waitForTimeout(200);
  await p.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
  console.log(`  ${OUT}/${name}.png`);
};

const errors = [];
const fail = (m) => { console.error(`FAIL  ${m}`); errors.push(m); };
const ok = (m, extra = '') => console.log(`ok    ${m}${extra ? ` — ${extra}` : ''}`);
const flat = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/\s+/g, ' ');

/*
 * A REAL 6 MB PNG, generated rather than padded.
 *
 * Padding a small PNG with junk would be easier and would prove less: the product's image path
 * draws the file, so a fixture that is not a picture would fail at the last step for the wrong
 * reason. Random rows do not compress, so the file really is ~5.8 MB on the wire, and every chunk
 * is a valid PNG chunk (IHDR, IDAT, IEND with real CRCs).
 */
function bigPng(width = 1600, height = 1200) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;   // 8-bit RGB, no interlace
  const rows = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y += 1) {
    const at = y * (1 + width * 3);
    rows[at] = 0;                                   // filter: none
    randomBytes(width * 3).copy(rows, at + 1);      // incompressible, so the file is genuinely big
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(rows, { level: 6 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}

const PNG = bigPng();
const PNG_SHA = createHash('sha256').update(PNG).digest('hex').slice(0, 16);
const PNG_MB = PNG.length / 1024 / 1024;
if (PNG_MB <= 5) {
  // A fixture that does not cross the line would make every check below pass for the wrong reason.
  console.error(`upload cap walk: the generated image is only ${PNG_MB.toFixed(2)} MB — it must be over 5 MB`);
  process.exit(2);
}

/**
 * The seller's own page for a file, found the way a seller finds it: the Edit link in the row
 * whose text is that file's title. Returns an absolute url, or null.
 */
async function assetIdFor(page, base, store, title) {
  await page.goto(`${base}/dashboard/${store}`, { waitUntil: 'domcontentloaded' });
  const href = await page.evaluate((wanted) => {
    const links = [...document.querySelectorAll('a[href*="/assets/"]')];
    const row = links.map((a) => a.closest('tr') || a.parentElement).find((r) => r && r.textContent.includes(wanted));
    return row ? (row.querySelector('a[href*="/assets/"]') || {}).getAttribute?.('href') || null : null;
  }, title);
  return href ? `${base}${href}` : null;
}

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/tmp/chromium',
  args: ['--no-sandbox'],
});

/** Publish one file through the real form and return where the browser landed. */
async function publish(page, { title, name, mimeType, buffer }) {
  const formUrl = `${BASE}/dashboard/${STORE}#publish`;
  await page.goto(formUrl, { waitUntil: 'domcontentloaded' });
  await page.fill('#p-title', title);
  await page.selectOption('#p-mode', 'open').catch(() => {});
  await page.setInputFiles('#p-media', { name, mimeType, buffer });
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 120_000 }).catch(() => {}),
    page.click('form[action$="/assets"][enctype*="multipart"] button[type="submit"]').catch(() => {}),
  ]);
  return new URL(page.url());
}

try {
  const state = await sessionFor(browser, 'alice', { base: BASE, dir: '/tmp/eyes-cap' });
  const context = await browser.newContext({ storageState: state, viewport: { width: 1440, height: 980 } });
  const page = await context.newPage();
  const stamp = new Date().toISOString().slice(11, 19).replace(/:/g, '');

  // ── 1. the number the form promises is the number the module holds ─────────
  await page.goto(`${BASE}/dashboard/${STORE}#publish`, { waitUntil: 'domcontentloaded' });
  const hint = flat(await page.content());
  await page.evaluate(() => document.querySelector('#p-media')?.scrollIntoView({ block: 'center' }));
  await shot(page, '01-the-form-promise');
  const promised = Number((/Up to (\d+) MB/.exec(hint) || [])[1] || 0);
  if (promised === UPLOAD_CAP_MB) {
    ok('the form promises the same cap the product enforces', `${promised} MB`);
  } else {
    fail(`the form promises ${promised || 'nothing'} MB while the product enforces ${UPLOAD_CAP_MB} MB`);
  }

  // ── 2. a file under OUR ceiling and over the HOST'S: published, kept, served ─
  const title = `Cap walk ${stamp}`;
  const landed = await publish(page, {
    title, name: `walk-cap-${stamp}.png`, mimeType: 'image/png', buffer: PNG,
  });
  if (landed.searchParams.get('published')) {
    ok(`a ${PNG_MB.toFixed(1)} MB image publishes — it is inside the product's ceiling`, landed.searchParams.get('published'));
  } else {
    fail(`a ${PNG_MB.toFixed(1)} MB image did not publish (landed on ${landed.pathname}${landed.search})`);
  }

  const slug = landed.searchParams.get('published');
  /*
   * `published` is the SLUG, which is the storefront's address for the file. The seller's own page
   * is addressed by the asset's uuid, and the first version of this walk pasted the slug into that
   * url — which lands on a 404 reading "Not found", and was reported as "the seller's page does not
   * say where a locally-kept file lives". The row for the file is the honest way to get the id: it
   * is the same link a seller clicks.
   */
  const assetUrl = slug ? await assetIdFor(page, BASE, STORE, title) : null;
  let heldLine = null;
  if (assetUrl) {
    await page.goto(assetUrl, { waitUntil: 'domcontentloaded' });
    /*
     * THE FILE'S OWN LINE, not the page. The page carries an explanatory note — "anything a host
     * will not take stays on this server's disk" — so a check for "on this server" anywhere in the
     * document passes on a file held at Pixeldrain. The row is the fact; the note is the rule.
     */
    heldLine = await page.evaluate((name) => {
      const row = [...document.querySelectorAll('.dl-item')].find((el) => el.textContent.includes(name));
      return row ? (row.querySelector('.dl-meta')?.textContent || '').trim() : null;
    }, `walk-cap-${stamp}.png`).catch(() => null);
    await page.evaluate(() => document.querySelector('.dl-list')?.scrollIntoView({ block: 'center' }));
    await shot(page, '02-held-at-the-host-that-took-it');
    if (heldLine && /held at ([A-Za-z.]+)/.test(heldLine)) {
      ok('the file line says which host holds it', heldLine.slice(0, 80));
    } else {
      fail(`the seller's file line does not say where the bytes are: ${JSON.stringify(heldLine)}`);
    }
  }

  // The bytes themselves, through the storefront's own door — a picture that publishes and does
  // not open is not a published picture.
  await page.goto(`${BASE}/s/${STORE}/a/${slug}`, { waitUntil: 'domcontentloaded' });
  const imgSrc = await page.evaluate(() => document.querySelector('.asset-layout img')?.getAttribute('src') || null);
  if (imgSrc) {
    const res = await page.request.get(imgSrc.startsWith('http') ? imgSrc : `${BASE}${imgSrc}`);
    const body = await res.body();
    const sha = createHash('sha256').update(body).digest('hex').slice(0, 16);
    if (res.status() === 200 && body.length === PNG.length && sha === PNG_SHA) {
      ok('and the file comes back byte for byte through the storefront', `${body.length} bytes, ${sha}`);
    } else {
      fail(`the published image did not come back identical (${res.status()}, ${body.length} bytes, ${sha})`);
    }
  } else {
    fail('the file page has no image for the picture that was just published');
  }

  // ── 2b. the same file where NOTHING else will take it: our disk, and why ──
  if (ALONE) {
    const aloneState = await sessionFor(browser, 'alice', { base: ALONE, dir: '/tmp/eyes-cap' });
    const aloneContext = await browser.newContext({ storageState: aloneState, viewport: { width: 1440, height: 980 } });
    const alonePage = await aloneContext.newPage();
    const aloneTitle = `Cap alone ${stamp}`;
    await alonePage.goto(`${ALONE}/dashboard/${STORE}#publish`, { waitUntil: 'domcontentloaded' });
    await alonePage.fill('#p-title', aloneTitle);
    await alonePage.selectOption('#p-mode', 'open').catch(() => {});
    await alonePage.setInputFiles('#p-media', { name: `walk-alone-${stamp}.png`, mimeType: 'image/png', buffer: PNG });
    await Promise.all([
      alonePage.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 120_000 }).catch(() => {}),
      alonePage.click('form[action$="/assets"][enctype*="multipart"] button[type="submit"]').catch(() => {}),
    ]);
    const aloneSlug = new URL(alonePage.url()).searchParams.get('published');
    if (!aloneSlug) {
      fail(`with no host that will take the file, it did not publish at all (${alonePage.url()})`);
    } else {
      const aloneAsset = await assetIdFor(alonePage, ALONE, STORE, aloneTitle);
      await alonePage.goto(aloneAsset || `${ALONE}/dashboard/${STORE}`, { waitUntil: 'domcontentloaded' });
      const aloneLine = await alonePage.evaluate((name) => {
        const row = [...document.querySelectorAll('.dl-item')].find((el) => el.textContent.includes(name));
        return row ? (row.querySelector('.dl-meta')?.textContent || '').trim() : null;
      }, `walk-alone-${stamp}.png`).catch(() => null);
      await alonePage.evaluate(() => document.querySelector('.dl-list')?.scrollIntoView({ block: 'center' }));
      await shot(alonePage, '03-nothing-would-take-it-on-our-disk');
      if (aloneLine && /on this server/.test(aloneLine)) {
        ok('where no host will take it, the file stays on our own disk — and the line says so', aloneLine.slice(0, 70));
      } else {
        fail(`the file that no host would take is not reported as being on this server: ${JSON.stringify(aloneLine)}`);
      }
      if (ALONE_LOG) {
        const log = readFileSync(ALONE_LOG, 'utf8');
        const kept = log.split('\n').filter((l) => l.includes('own disk') && l.includes('5 MB cap')).pop();
        const refused = log.split('\n').filter((l) => l.includes('telegraph refused')).pop();
        if (kept) ok('and the log names the host\'s own ceiling as the reason', kept.trim().slice(0, 120));
        else fail('the log does not explain why the file stayed on our disk');
        if (refused) fail(`the image host WAS sent bytes it should never have seen: ${refused.trim().slice(0, 120)}`);
        else ok('and the host was never asked — the refusal happened before the bytes crossed the wire');
      } else {
        console.log('note  EYES_ALONE_LOG was not set, so the "why our disk" log line was not checked');
      }
    }
    await aloneContext.close();
  } else {
    console.log('note  EYES_ALONE was not set, so the "no host will take it" case was not exercised');
  }

  // ── 2c. the operator's witness on the first instance, when a log was given ─
  if (LOG) {
    const log = readFileSync(LOG, 'utf8');
    const refused = log.split('\n').filter((l) => l.includes('telegraph refused')).pop();
    if (refused) {
      fail(`the image host WAS sent bytes it should never have seen: ${refused.trim().slice(0, 120)}`);
    } else {
      ok('on this instance too, the image host was never asked — the refusal happened before the wire');
    }
  } else {
    console.log('note  EYES_LOG was not set, so the "never asked" line was not checked on the first instance');
  }

  await context.close();
} finally {
  await browser.close();
}

if (errors.length) {
  console.log(`\nupload cap walk: ${errors.length} finding(s)`);
  process.exit(1);
}
console.log('\nupload cap walk: ok');
