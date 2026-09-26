/**
 * Going live: the seller's own path, walked in a browser.
 *
 * `VERIFY THIS` — why this walk exists
 *
 * §12 built a live host: `video-antmedia.js` mints a broadcast, `ingestFor()` says what an encoder
 * types, and the panel renders the break model. What did NOT exist was any way for a SELLER to get
 * one. The live panel renders only for a file that is already a stream, `assetShape` decides that
 * from the playlist address, and the publish form requires a media file — so a live file was
 * reachable only through the seed that builds the demo's. The feature was built, tested and
 * invisible, which is the failure a unit test cannot see: nothing was broken, and nobody could use it.
 *
 * WHAT THIS WALK PROVES, in the order a seller does it:
 *
 *   1. The dashboard offers going live, and says what it will do — including the ingest address this
 *      deployment would hand an encoder.
 *   2. Creating a stream makes a real file: the server mints it, the asset points at its playlist,
 *      and the page the seller lands on PRINTS THE KEY. The key is asserted to be minted entropy
 *      (`crypto.randomBytes` → 32 hex characters), not a counter, because in the Community Edition
 *      the id IS the publish credential.
 *   3. Nothing is sending yet, and the panel says so — the status comes from the SERVER, not from our
 *      own bookkeeping. Then a viewer opens the file, the player fetches the playlist (which is the
 *      closest an HTTP double comes to a publisher connecting), and the panel changes its answer.
 *   4. Rotating replaces the key AND removes the old stream on the server, checked against the
 *      server's own list — because a rotation that leaves the old credential alive protects nothing.
 *   5. Ending takes the stream off the server, keeps the address, and pauses the file, so no viewer is
 *      sent to a stream that is not there.
 *   6. The two refusals are refused by the SERVER, not merely hidden: minting on a deployment with no
 *      streaming server, and clearing a stream's address to nothing.
 *
 * WHAT IT CANNOT PROVE, said plainly: no real encoder pushes to this. The stub has no RTMP ingest, so
 * "broadcasting" here means "the playlist was fetched", which is what the stub's own header says it
 * means. A real ffmpeg/OBS push is the user's machine's test, and `video:check --probe-live` is the
 * probe written for it.
 *
 *   # the server, doubled — over TLS, because the product stores only an https playlist and a
 *   # fresh Ant Media install serves https on :5443 with a self-signed certificate
 *   openssl req -x509 -newkey rsa:2048 -nodes -days 2 -subj '/CN=127.0.0.1' \
 *     -addext 'subjectAltName=IP:127.0.0.1' -keyout /tmp/ams.key -out /tmp/ams.crt
 *   node ci/stub-antmedia.mjs 5443 --tls=/tmp/ams.crt,/tmp/ams.key &
 *   cd app && node scripts/test-db.mjs                   # the test database
 *   PORT=3200 DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55432/bytebikri_test \
 *     LIVE_DRIVER=antmedia ANT_MEDIA_BASE=https://127.0.0.1:5443 \
 *     NODE_EXTRA_CA_CERTS=/tmp/ams.crt VIDEO_MEDIA_ORIGINS=https://127.0.0.1:5443 \
 *     node scripts/boot.mjs
 *   rm -rf /tmp/eyes-live
 *   EYES_BASE=http://127.0.0.1:3200 node ci/eyes/live-mint-walk.mjs
 *
 * It CREATES FILES (that is what it is testing), so it is one-shot-per-reseed like `publish-walk.mjs`:
 * re-running against the same database is fine — every title carries a timestamp — and
 * `node scripts/test-db.mjs` clears what it leaves.
 */
import { chromium } from 'playwright';
import { sessionFor, consent } from './lib.mjs';

const BASE = process.env.EYES_BASE || process.argv[2] || 'http://127.0.0.1:3200';
const STORE = process.env.EYES_STORE || 'alice';
// The ANT_MEDIA_BASE the instance under test was started with. Read from the environment rather than
// hardcoded, because the address is the instance's, and a walk that guessed it would pass against
// one deployment and fail against another for no reason worth reporting.
const AMS = String(process.env.AMS_BASE || 'https://127.0.0.1:5443').replace(/\/+$/, '');
const AMS_APP = process.env.AMS_APP || 'LiveApp';
// A second instance with NO streaming server, for the refusal that only exists there. Optional:
// without it, section 6 checks only what this instance can refuse.
const PLAIN = process.env.EYES_PLAIN_BASE || '';

const errors = [];
const fail = (m) => { console.error(`FAIL  ${m}`); errors.push(m); };
const ok = (m, extra = '') => console.log(`ok    ${m}${extra ? ` — ${extra}` : ''}`);
const flat = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ');

/** The server's own list of broadcasts — asked directly, because our database is not the witness. */
const broadcasts = async () => {
  /*
   * This fetch is the walk's own question to the streaming server ("which broadcasts exist?", the
   * only witness that a rotation really revoked the old key). The stub's certificate is self-signed,
   * exactly like a fresh Ant Media install's, so the walk has to be RUN with
   * `NODE_EXTRA_CA_CERTS=/tmp/ams.crt` — the same trust the app process is given, and the reason the
   * usage block above names it. Without it Node refuses before the request leaves the process, and
   * every rotation assertion below would report a product failure.
   */
  let res;
  try {
    res = await fetch(`${AMS}/${AMS_APP}/rest/v2/broadcasts/list/0/200`);
  } catch (err) {
    /*
     * A certificate refusal is a HARNESS failure, not a product one, and it has to say so in one
     * sentence. The first version of this let undici's stack trace escape, which tells whoever reads
     * the output nothing about what to do — while the fix is a single variable they already have in
     * the usage block at the top of this file.
     */
    const why = err?.cause?.code === 'DEPTH_ZERO_SELF_SIGNED_CERT' || /self-signed/i.test(String(err?.cause?.message))
      ? `the streaming server's certificate is not trusted by this process — re-run with NODE_EXTRA_CA_CERTS pointing at the certificate (see the usage block at the top of this file)`
      : `the streaming server at ${AMS} did not answer (${err?.cause?.code || err?.message})`;
    console.error(`live mint walk: cannot ask the streaming server anything — ${why}`);
    process.exit(2);
  }
  const body = await res.json();
  return Array.isArray(body) ? body.map((b) => String(b.streamId)) : [];
};

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/tmp/chromium',
  args: ['--no-sandbox'],
});

/*
 * `ignoreHTTPSErrors` IS ABOUT THE STUB'S CERTIFICATE, NOT ABOUT BEING LENIENT WITH THE PRODUCT.
 *
 * The playlist this walk plays is fetched BY THE VIEWER'S BROWSER from the streaming server, and the
 * only certificate available in this sandbox is the one `openssl` just made — the same situation a
 * fresh Ant Media install is in, where it serves https on :5443 with a self-signed certificate and
 * every operator clicks through the warning once. Without this, Chromium refuses the playlist with a
 * certificate error and the walk reports a product defect that is really a harness gap.
 *
 * What is NOT relaxed: the address the product STORES still has to be https (asserted below), the
 * streaming origin still has to be in the CSP, and the signature/expiry rules on the app's own routes
 * are untouched — a certificate is not a policy.
 */
const CONTEXT_OPTS = { ignoreHTTPSErrors: true };

try {
  const state = await sessionFor(browser, 'alice', { base: BASE, dir: '/tmp/eyes-live' });
  const context = await browser.newContext({ storageState: state, ...CONTEXT_OPTS });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on('pageerror', (e) => consoleErrors.push(e.message.slice(0, 140)));
  page.on('console', (m) => {
    if (/CORS|ERR_FAILED|blocked by|Refused to/i.test(m.text()) || m.type() === 'error') consoleErrors.push(m.text().slice(0, 200));
  });

  const stamp = new Date().toISOString().slice(11, 19).replace(/:/g, '');
  const TITLE = `Live walk ${stamp}`;

  // ── 1. the way in is on the dashboard, and it says what it does ────────────
  await page.goto(`${BASE}/dashboard/${STORE}`, { waitUntil: 'domcontentloaded' });
  const dash = flat(await page.content());
  if (/Go live/i.test(dash) && /Start a live stream/i.test(dash)) {
    ok('the dashboard offers going live');
  } else {
    fail('the dashboard has no way to start a stream — the live feature is unreachable for a seller again');
  }
  const form = page.locator('form[action$="/live/new"]').first();
  if (await form.count()) {
    const html = flat(await form.innerHTML());
    if (/rtmp:\/\//.test(html)) ok('and names the ingest address an encoder would use', (/rtmp:\/\/[^\s<]+/.exec(html) || [''])[0]);
    else fail('the go-live form does not name an ingest address, on an instance that runs a streaming server');
  } else {
    fail('the go-live form is not on the dashboard');
  }

  // ── 2. mint a stream through it ────────────────────────────────────────────
  //
  // The form is a `<details>` so the dashboard stays calm for stores that never stream — which means
  // the walk has to OPEN IT, exactly as a seller does. (The first run of this walk failed here for
  // the opposite reason: the fields were laid out but not visible, which is a fact about the page
  // rather than a bug in it. A walk that forced a hidden field would be testing a form nobody sees.)
  await page.click('details summary:has-text("Start a live stream")');
  await page.fill('#l-title', TITLE);
  await page.selectOption('#l-mode', 'open');
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => {}),
    page.click('form[action$="/live/new"] button[value="mint"]'),
  ]);
  const landed = new URL(page.url());
  if (landed.pathname.includes('/assets/') && landed.searchParams.get('saved') === 'live-minted') {
    ok('creating a stream lands on the file it made', landed.pathname);
  } else {
    fail(`minting did not land on a new file (${page.url()}) — the seller is not told what happened`);
  }

  const pageHtml = await page.content();
  const text = flat(pageHtml);
  const key = (/data-stream-key="1">([^<]+)</.exec(pageHtml) || [])[1] || '';
  if (/^bb[0-9a-f]{32}$/.test(key)) {
    ok('the page prints a key, and it is minted entropy rather than a counter', key);
  } else {
    fail(`no stream key on the seller's page (found: ${key || 'nothing'}) — the one credential the panel exists to show`);
  }
  const playlist = (/Playlist<\/dt><dd><code>([^<]+)</.exec(pageHtml) || [])[1] || '';
  if (playlist === `${AMS}/${AMS_APP}/streams/${key}.m3u8`) {
    ok('the file points at the playlist the server will produce', playlist);
  } else {
    fail(`the saved playlist is not the minted stream's (${playlist || 'nothing'})`);
  }
  // The credential is a credential: it must not be anywhere a viewer's page reaches.
  if (/This key is the credential/i.test(text)) {
    ok('the page says the key is the credential, in as many words');
  } else {
    fail('nothing on the page tells the seller that the key publishes — a leak nobody is warned about');
  }
  if ((await broadcasts()).includes(key)) ok('and the server has the stream', `${(await broadcasts()).length} broadcast(s)`);
  else fail('the server does not have the stream the file points at');

  // ── 3. the status comes from the server, and changes when someone watches ───
  if (/Nobody is sending yet/i.test(text)) {
    ok('the panel says nothing is publishing yet — asked of the server, not assumed by us');
  } else {
    fail('the panel does not state the server\'s own view of the stream (waiting for an encoder)');
  }

  const assetPath = landed.pathname;
  /*
   * The storefront address of the file the walk just made.
   *
   * It CANNOT be read out of the dashboard url: that path ends in the asset's uuid, and the storefront
   * path uses the SLUG, which the publish route derives from the title. The first version of this tried
   * a regex for `/a/<slug>` against a `/dashboard/<store>/assets/<uuid>` path, found nothing, and asked
   * for `/s/alice/a/undefined` — a 404 page with no player on it, reported as "the viewer's page has no
   * player for the live file". A harness that blames the product for its own 404 is worse than no check.
   *
   * `uniqueAssetSlug` is `slugify(title)`, and the title is this walk's own string, so the slug is
   * known here without asking anybody — and the walk proves the guess below by requiring the player to
   * answer, which is a real check either way.
   */
  const filePage = `${BASE}/s/${STORE}/a/live-walk-${stamp}`;
  // A viewer: the file was published open, so no unlock is needed to reach the player.
  const viewerState = await sessionFor(browser, 'bob', { base: BASE, dir: '/tmp/eyes-live' });
  const viewerContext = await browser.newContext({ storageState: viewerState, ...CONTEXT_OPTS });
  const viewer = await viewerContext.newPage();
  await viewer.goto(filePage, { waitUntil: 'domcontentloaded' });
  await consent(viewer);
  /*
   * A LIVE STREAM HAS A DIFFERENT PLAYER ELEMENT FROM A FILE, and the walk has to look for the right
   * one. A file's player is `<video data-hls="1" src=…>`; a stream's is the stage's own
   * `<div class="live" data-live data-url=…>` wrapping a plain `<video src=…>`, because a stream is
   * not fetched the way a file is — it is polled, and the address lives on the wrapper so the poller
   * and the player cannot disagree about it. The first version asked for `[data-hls]` on a live page,
   * found nothing, and reported a missing player on a page that had one.
   */
  const player = viewer.locator('[data-live]').first();
  if (await player.count()) {
    const asked = await player.getAttribute('data-url')
      || await viewer.locator('[data-live] video').first().getAttribute('src') || '';
    ok('a viewer gets a player for the stream', asked.slice(0, 70));
    // The player's own fetch is what the stub treats as a publisher connecting.
    const played = await viewer.evaluate(async (src) => {
      const target = src || document.querySelector('[data-live]')?.getAttribute('data-url');
      if (!target) return null;
      const res = await fetch(target, { credentials: 'omit' });
      return { status: res.status, type: res.headers.get('content-type') || '' };
    }, asked).catch(() => null);
    if (played && played.status === 200) ok('the playlist itself answers a browser', `${played.status} ${played.type}`);
    else fail(`the stream's playlist did not answer a viewer (${played ? played.status : 'no request'})`);
  } else {
    fail('the viewer\'s page has no player for the live file');
  }
  await viewerContext.close();

  await page.goto(`${BASE}${assetPath}`, { waitUntil: 'domcontentloaded' });
  const afterPlay = flat(await page.content());
  if (/Your encoder is connected/i.test(afterPlay)) {
    ok('and once something is publishing, the panel says so — the status is a fact about the server');
  } else {
    fail('the panel still says nobody is publishing, after the playlist was fetched — the status is not live');
  }

  /*
   * ── 3b. EVERY BUTTON POSTS THE ROUTE ITS LABEL PROMISES ────────────────────
   *
   * Asserted in the BROWSER, against the parsed DOM, because the failure this catches is a parse-tree
   * one: HTML has no nested forms, and a browser that meets one does not complain — it drops the inner
   * <form> start tag and hands the button to the nearest form ancestor instead. The markup on disk was
   * well formed and the server-side tests were green while "Rotate the key" saved the file's details and
   * the settings' own Save button belonged to no form at all. Nothing but a real document can see that,
   * so this check reads `button.form.action` and compares it to what the button says it does.
   */
  const wiring = await page.evaluate(() => {
    const want = {
      'Rotate the key': /\/live$/,
      'End the stream on the server': /\/live$/,
      'Save the address': /\/live$/,
      'Save': /\/assets\/[0-9a-f-]+$/,
    };
    return Object.entries(want).map(([label, re]) => {
      const btn = [...document.querySelectorAll('button')]
        .find((b) => b.textContent.trim() === label);
      const action = btn?.form?.getAttribute('action') || null;
      return { label, action, ok: Boolean(btn) && Boolean(action) && re.test(action) };
    });
  });
  for (const row of wiring) {
    if (row.ok) ok(`“${row.label}” posts where it says it does`, row.action);
    else fail(`“${row.label}” would post to ${row.action || 'nothing at all'} — the form it is written in is not the form the browser gives it`);
  }

  // ── 4. rotate: the new key works, the old one DIES ─────────────────────────
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => {}),
    /*
     * One suffix, and it has to be the one the form actually uses.
     *
     * The first version asked for `form[action$="/assets/"][action$="/live"]` — an element whose action
     * ends in two different strings at once, so it matched nothing, the click was swallowed by its own
     * `.catch(() => {})`, and the walk reported "rotating did not replace the key" about a button it
     * never pressed. Every panel button posts to `.../assets/<id>/live`; the hidden `action` field is
     * what differs, so the selector has to name the button text and no more.
     */
    page.click('form[action$="/live"] button:has-text("Rotate the key")').catch(() => {}),
  ]);
  const rotatedHtml = await page.content();
  const newKey = (/data-stream-key="1">([^<]+)</.exec(rotatedHtml) || [])[1] || '';
  if (/^bb[0-9a-f]{32}$/.test(newKey) && newKey !== key) {
    ok('rotating mints a different key', newKey);
  } else {
    fail(`rotating did not replace the key (was ${key}, now ${newKey || 'nothing'})`);
  }
  const list = await broadcasts();
  if (!list.includes(key)) ok('and the OLD stream is gone from the server — the leaked key publishes nothing');
  else fail('the old stream is still on the server after a rotation — the key was replaced but not revoked');
  if (list.includes(newKey)) ok('while the new one is there');
  else fail('the new stream is not on the server');

  // ── 5. ending it: off the server, off the storefront, address kept ─────────
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => {}),
    page.click('button:has-text("End the stream on the server")').catch(() => {}),
  ]);
  const endedHtml = await page.content();
  const endedText = flat(endedHtml);
  if (/no longer on the server/i.test(endedText)) {
    ok('the panel says the stream is gone from the server, in those words');
  } else {
    fail('after ending, the panel does not say the stream is off the server');
  }
  const afterEnd = await broadcasts();
  if (!afterEnd.includes(newKey)) ok('and the server agrees — the broadcast is deleted');
  else fail('the stream is still on the server after being ended');
  if (/Playlist<\/dt><dd><code>/.test(endedHtml)) {
    ok('the address is kept, so the page still says where it pointed');
  } else {
    fail('ending the stream also removed the address — the file is left with nothing to explain it');
  }
  /*
   * ASK AS A VISITOR, not as the owner: a seller's own storefront is allowed to show them their paused
   * files (it is how they check their shop), so asking with alice's session would pass whatever the
   * route did. The question this check really asks is "would a viewer be sent to a dead player?", and
   * only bob can answer it.
   */
  const guest = await browser.newContext({ storageState: viewerState, ...CONTEXT_OPTS });
  const shelf = flat(await (await guest.request.get(`${BASE}/s/${STORE}`)).text());
  await guest.close();
  const slug = `live-walk-${stamp}`;
  if (slug && !shelf.includes(TITLE)) {
    ok('and the file is off the storefront — a stream nobody is sending is nothing to open');
  } else {
    fail('the ended stream is still on the storefront, where a viewer would get a dead player');
  }

  // ── 6. the refusals, refused by the server ─────────────────────────────────
  const assetId = assetPath.split('/assets/')[1] || '';
  const post = async (base, path, body, tag) => {
    const res = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: (await context.cookies()).map((c) => `${c.name}=${c.value}`).join('; ') },
      body: new URLSearchParams(body).toString(),
      redirect: 'manual',
    });
    return { status: res.status, to: res.headers.get('location') || '' };
  };
  const emptied = await post(BASE, `/dashboard/${STORE}/assets/${assetId}/live`, { action: 'set-url', externalUrl: '' });
  if (/error=live-empty/.test(emptied.to)) {
    ok('clearing a stream\'s address is refused — that used to leave a file with nothing behind it');
  } else {
    fail(`clearing the address was not refused (${emptied.status} ${emptied.to || 'no redirect'})`);
  }
  if (PLAIN) {
    const plainState = await sessionFor(browser, 'alice', { base: PLAIN, dir: '/tmp/eyes-live' });
    const plainContext = await browser.newContext({ storageState: plainState, ...CONTEXT_OPTS });
    const plainPage = await plainContext.newPage();
    /*
     * The BUTTON, not the word. The first version of this check grepped the dashboard for
     * `rtmp://` — and the hint under the address box explains that an rtmp address is what an
     * encoder speaks, so the word is on every dashboard, including one with no streaming server at
     * all. A check that fails on a page for the words in its own explanation is a check that reports
     * a defect nobody can reproduce (the same mistake this walk's sibling made about the host
     * sentence, in the round that wrote it).
     */
    const dash2 = await (await plainPage.request.get(`${PLAIN}/dashboard/${STORE}`)).text();
    if (!/name="source" value="mint"/.test(dash2)) {
      ok('an instance with no streaming server offers no mint button', PLAIN);
    } else {
      fail('an instance with no streaming server still offers to mint one — the button would fail');
    }
    const refused = await plainPage.request.post(`${PLAIN}/dashboard/${STORE}/live/new`, {
      form: { title: `Refused ${stamp}`, source: 'mint', unlockMode: 'open' },
      maxRedirects: 0,
    }).catch((e) => ({ status: () => `threw: ${e.message}` }));
    const where = typeof refused.status === 'function' ? refused.headers?.()?.location : '';
    if (String(refused.status()).startsWith('3') && /error=live-mint-off/.test(where || '')) {
      ok('and a hand-crafted mint there is refused by the server with its own sentence');
    } else {
      fail(`minting on a deployment with no streaming server was not refused (${refused.status()} ${where || ''})`);
    }
    await plainContext.close();
  } else {
    ok('no second instance given (EYES_PLAIN_BASE) — the "no streaming server" refusal was not checked here');
  }

  if (consoleErrors.length) {
    fail(`console errors — ${consoleErrors.slice(0, 4).join(' | ')}`);
  } else {
    ok('no console errors on any of the pages');
  }
  await context.close();
} finally {
  await browser.close();
}

console.log(errors.length ? `\nlive mint walk: ${errors.length} finding(s)` : '\nlive mint walk: ok');
process.exit(errors.length ? 1 : 0);
