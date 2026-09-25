/**
 * The video host, walked against a running instance that is configured for one.
 *
 * `VERIFY THIS` — what it is for
 *
 * `app/test/video.test.js` proves the client and the router against a stub it starts
 * itself. What no unit test can show is the thing that actually changes for a viewer:
 * a request that leaves this process. This walk signs in through a real browser, opens
 * an ad-gated file the way a viewer does, and then **reads the stream route's redirect
 * instead of following it** — because the question is not "does a video play" (it plays
 * either way) but "whose bytes played".
 *
 * IT NEEDS ITS OWN INSTANCE, AND THAT IS THE POINT OF ITS USAGE LINE.
 *
 * The main dev server must not be pointed at a video host: it would send its own demo
 * fixtures there, and the sandbox this was written in cannot reach the real one at all.
 * So this runs against a SECOND instance, on the TEST database, configured to talk to the
 * stub. The three recipes below are the ones that were actually run, and each has one
 * variable that is easy to leave out — every omission here produces a failure that looks
 * like a broken client rather than a half-configured instance:
 *
 *   # Filemoon  (progressive; add `--hls` to the stub for the playlist branch)
 *   node ci/stub-filemoon.mjs 3999 &
 *   cd app && node scripts/test-db.mjs
 *   PORT=3100 DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55432/bytebikri_test \
 *     VIDEO_DRIVER=filemoon FILEMOON_API_BASE=http://127.0.0.1:3999 \
 *     FILEMOON_TOKEN='147|stub-token-abcdefghijklmnop' \
 *     VIDEO_MEDIA_ORIGINS=http://127.0.0.1:3999 node scripts/boot.mjs
 *
 *   # GoFile  (premium tier — a free one cannot produce a playable link, §10.1)
 *   node ci/stub-gofile.mjs 4001 --tier=premium &
 *   PORT=3100 … VIDEO_DRIVER=gofile GOFILE_API_BASE=http://127.0.0.1:4001 \
 *     GOFILE_UPLOAD_BASE=http://127.0.0.1:4001 GOFILE_TOKEN=stub-token \
 *     VIDEO_MEDIA_ORIGINS=http://127.0.0.1:4001 node scripts/boot.mjs
 *
 *   # Catbox  (no token: a userhash; the FILE base is a second host, §10.1)
 *   node ci/stub-catbox.mjs 4002 &
 *   PORT=3100 … VIDEO_DRIVER=catbox CATBOX_API_BASE=http://127.0.0.1:4002 \
 *     CATBOX_FILE_BASE=http://127.0.0.1:4002 CATBOX_USERHASH=stub-userhash \
 *     node scripts/boot.mjs
 *
 *   node ci/eyes/video-host-walk.mjs                     # http://127.0.0.1:3100 by default
 *
 * WHY `VIDEO_MEDIA_ORIGINS` IS THERE. CSP judges a redirect's DESTINATION, so a media url
 * on another origin has to be named before the element may follow it. In production
 * Filemoon's and GoFile's media urls are `https` and the policy's `media-src https:` covers
 * them; a stub on plain `http` is not, and the failure is silent — `MediaError` code 4,
 * `networkState` 3, and NOT ONE network request, which reads exactly like a dead stub. The
 * variable is the same one an operator uses when a deployment's CDN needs naming (§10.4).
 *
 * Re-seeding the test database invalidates the saved browser session, and a stale session
 * scores a 401 on the unlock: remove `/tmp/eyes-host` and re-run. This walk creates that
 * directory itself.
 *
 * A driver change is a RESEED, not a restart: the provider is part of the storage key, so
 * an instance pointed at GoFile still reads the demo's `catbox/…` files from Catbox (which
 * is §10.2 working exactly as designed). Run `node scripts/test-db.mjs` first.
 *
 * The demo password is the one the seeder prints — the instance seeds itself on an
 * empty database, which is what puts four videos at the host before this walk starts.
 */
import { chromium } from 'playwright-core';
import { sessionFor, consent } from './lib.mjs';

const BASE = process.env.EYES_BASE || process.argv[2] || 'http://127.0.0.1:3100';
const STORE = process.env.EYES_STORE || process.argv[3] || 'alice';
const SLUG = process.env.EYES_SLUG || process.argv[4] || 'poster-kit-walkthrough';
const VIEWER = process.env.EYES_VIEWER || process.argv[5] || 'alice';

const errors = [];
const fail = (m) => { console.error(`FAIL  ${m}`); errors.push(m); };
const ok = (m, extra = '') => console.log(`ok    ${m}${extra ? ` — ${extra}` : ''}`);

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/tmp/chromium',
  args: ['--no-sandbox'],
});

try {
  const state = await sessionFor(browser, VIEWER, { base: BASE, dir: '/tmp/eyes-host' });
  const { context, page } = await (async () => {
    const context = await browser.newContext({ storageState: state });
    const page = await context.newPage();
    page.errors = [];
    page.on('pageerror', (e) => page.errors.push(e.message.slice(0, 140)));
    return { context, page };
  })();

  // ── 1. open the file the way a viewer does ─────────────────────────────────
  //
  // A locked file has no player and no asset id in its markup — the unlock button is
  // the only thing on it that leads anywhere. So this clicks it and plays the part of
  // the ad network (see `walk-ads.mjs` for why a harness has to): it reads the
  // `viewId` the page was handed and POSTs to the dev-only simulator, which signs the
  // postback the way the provider documents and delivers it over real HTTP.
  // The player's own request is the best evidence of what it is playing, and in the
  // HLS branch it is the ONLY place the address still exists: hls.js takes the `src`
  // away from the element on purpose (see the VOD branch in `app/public/app.js`) and
  // hands the browser a `blob:` MediaSource instead.
  const playerRequests = [];
  page.on('request', (r) => {
    if (/\/api\/content\//.test(new URL(r.url()).pathname)) playerRequests.push(r.url());
  });
  // Console messages, because the difference between "the host said no" and "the browser
  // refused the host's answer" is only visible here — see the CORS note in the playback
  // step below.
  const consoleErrors = [];
  // Any severity: Chromium reports a blocked XHR as an error, but a CORS complaint can also
  // arrive as a warning, and this is the one message the walk has to be able to read.
  page.on('console', (m) => {
    const text = m.text();
    if (/CORS|ERR_FAILED|blocked by/i.test(text) || m.type() === 'error') consoleErrors.push(text.slice(0, 200));
  });
  // What the BROWSER received when it fetched the host's media url. The playback check needs
  // this to tell "the bytes never arrived" (a real failure of ours) from "the bytes arrived
  // and this browser cannot decode them" (a fact about the browser — see below).
  const mediaResponses = [];
  page.on('response', (r) => {
    const host = process.env.EYES_MEDIA_HOST || '127.0.0.1:4002';
    if (r.url().includes(host) || /\.(mp4|m3u8|ts)(\?|$)/.test(new URL(r.url()).pathname)) {
      mediaResponses.push({ url: r.url().slice(0, 120), status: r.status() });
    }
  });

  const starts = [];
  const startStatuses = [];
  page.on('response', async (r) => {
    if (!/\/api\/unlock\/start$/.test(new URL(r.url()).pathname)) return;
    startStatuses.push(r.status());
    try { starts.push(await r.json()); } catch { /* the page will say so */ }
  });

  await page.goto(`${BASE}/s/${STORE}/a/${SLUG}`, { waitUntil: 'domcontentloaded' });
  await consent(page);

  const locked = await page.locator('#unlock-btn').count();
  if (locked) {
    await page.click('#unlock-btn');
    await page.waitForTimeout(1200);
    if (!starts.length) {
      // The usual cause is a cached session for a database that has since been recreated:
      // the cookie still verifies (one dev secret), but the profile inside it is gone, so
      // the ask comes back 401 and the page says nothing. Name it rather than leaving a
      // reader to guess, because the same signature appears when the dev server was simply
      // restarted against a reseeded database.
      fail(`the page never asked to start a view — /api/unlock/start answered `
        + `${startStatuses.length ? startStatuses.join(', ') : 'nothing'}; `
        + 'a stale cached session for a reseeded database looks exactly like this '
        + `(remove ${process.env.EYES_DIR || '/tmp/eyes-host'} and re-run)`);
    } else {
      console.log(`       the ask: ${JSON.stringify(starts[0].adConfig).slice(0, 120)}`);
      const delivered = await fetch(`${BASE}/dev/simulate-network/${starts[0].adConfig.providerId}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          viewId: starts[0].viewId,
          connectionId: starts[0].adConfig.connectionId,
          durationSec: starts[0].adConfig.minSeconds,
        }),
      });
      const json = await delivered.json().catch(() => ({}));
      console.log(`       network postback: ${delivered.status} ${JSON.stringify(json).slice(0, 110)}`);
      // The granted page reloads itself; wait for the player rather than a timer.
      await page.waitForSelector('[data-watch]', { timeout: 30_000 }).catch(() => {});
      await page.waitForTimeout(500);
      ok('the file opened', `${starts.length} start call(s)`);
    }
  } else {
    ok('the file was already open', 'no ask on the page — nothing to deliver');
  }

  // Read the id off the markup only after the page has settled, and fall back to the
  // start call, which names the file it was for.
  const page2 = await page.goto(`${BASE}/s/${STORE}/a/${SLUG}`, { waitUntil: 'domcontentloaded' });
  const assetId = await page.evaluate(() => document.querySelector('[data-asset-id]')?.dataset.assetId || null)
    || (starts[0] && (starts[0].assetId || null));
  if (!assetId) fail(`the file page has no asset id (page answered ${page2.status()})`);
  else ok('the file page renders', assetId);

  const player = await page.evaluate(() => {
    const v = document.querySelector('[data-watch]');
    return v ? { hls: v.dataset.hls === '1', src: v.getAttribute('src') } : null;
  });
  if (!player) fail('no player on the page after unlocking');
  else ok('the player is on the page', player.hls ? 'marked data-hls' : 'ordinary element (progressive source)');

  // WHAT THE PLAYER ACTUALLY ASKED FOR, which is the only address that matters here.
  // The content routes take a short-lived signed token (`?t=`) minted for this viewer,
  // so a path assembled by hand earns a 403 — for the right reason, and it would tell
  // the walk nothing. And in the HLS branch the element no longer carries a url at all:
  // hls.js takes the `src` away on purpose (see the VOD branch in `app/public/app.js`)
  // and hands the browser a `blob:` MediaSource. The element's own `src` stays as the
  // fallback for a page whose video has not started fetching yet.
  const askedUrl = playerRequests[playerRequests.length - 1] || player?.src || null;
  console.log(`       the player asked for: ${askedUrl}`);
  const fileId = /\/file\/([0-9a-f-]{36})\//.exec(String(askedUrl))?.[1] || null;
  if (!fileId) {
    fail(`cannot tell which file the player is playing (asked: ${askedUrl})`);
    console.log(`\nvideo host walk: ${errors.length} finding(s)`);
    process.exit(1);
  }
  const srcUrl = new URL(askedUrl, BASE);
  // The redirect is READ, not followed. A `fetch()` inside the page cannot do this —
  // `redirect: 'manual'` hands back an opaque response with no status and no Location —
  // so this uses the browser's own request context, which carries the session.
  const read = (path) => page.request.get(BASE + path, { maxRedirects: 0 });
  const stream = await read(srcUrl.pathname + srcUrl.search);
  const location = stream.headers().location || '';
  const kind = stream.headers()['x-bytebikri-source'];
  console.log(`       stream route: ${stream.status()} ${kind ? `(kind ${kind})` : ''} → ${location}`);
  if (stream.status() !== 302) {
    fail(`the stream route answered ${stream.status()} for a hosted file instead of redirecting`);
  } else if (!/^https?:\/\//.test(location)) {
    fail(`the redirect does not point anywhere usable: ${location}`);
  } else {
    ok('the stream route sends the browser to the host', location.slice(0, 72));
  }

  const download = await read(srcUrl.pathname.replace(/\/stream$/, '') + srcUrl.search);
  if (download.status() !== 302) fail(`the download arm answered ${download.status()}, not a redirect`);
  else ok('the download arm redirects too', (download.headers().location || '').slice(0, 60));

  // ── 2b. and it PLAYS, in our player, off bytes that came from the host ──────
  //
  // Everything above is about addresses. This is the one that decides whether a viewer
  // can watch: the browser has to follow our redirect (the media urls carry no bearer
  // token, because a `<video>` cannot send one), the element has to load a source, and the
  // bytes have to decode. A click first, so Chromium's autoplay policy treats this as a
  // viewer pressing play rather than a page demanding it.
  //
  // THE DECODER IS NOT ALWAYS THERE, AND THIS SAYS WHICH SHAPE OF FAILURE IT SAW.
  // The Chromium that ships with Playwright has no H.264 decoder, and `canPlayType` claims
  // `probably` anyway — so a fixture that plays in Chrome reports `MEDIA_ELEMENT_ERROR:
  // Format error` here. That is a fact about the browser, not about the redirect, and
  // reporting it as a broken host would train whoever reads this to ignore it. So: if the
  // media arrived AND the element failed to decode it, that is a SKIP with the reason; if
  // the media never arrived, that is a finding.
  await Promise.race([page.click('[data-watch]').catch(() => {}), page.waitForTimeout(4000)]);
  // `play()` is STARTED, never awaited. Its promise does not settle when the demuxer gets no
  // data at all — which is exactly one of the failures this step exists to report — and an
  // awaited promise that never resolves hangs the walk instead of describing the bug.
  await Promise.race([
    page.evaluate(() => {
      const v = document.querySelector('[data-watch]');
      if (v) { v.muted = true; v.play().catch(() => {}); }
      return null;
    }),
    page.waitForTimeout(4000),
  ]);
  let played = null;
  const t0 = Date.now();
  while (Date.now() - t0 < 25_000) {
    try {
      played = await page.evaluate(() => {
        const v = document.querySelector('[data-watch]');
        return v ? {
          at: Number(v.currentTime.toFixed(2)), ready: v.readyState,
          err: v.error ? `code ${v.error.code}` : null,
          hint: v.dataset.expiredHint || null,
        } : null;
      });
    } catch (err) {
      // The page went away under the loop (a navigation, or the context closing). Say what
      // was seen rather than throwing a stack trace at the reader.
      played = { gone: String(err.message).slice(0, 90) };
      break;
    }
    if (played?.err || played?.hint || played?.at > 0.4) break;
    await page.waitForTimeout(400);
  }
  const mediagot = mediaResponses.filter((r) => r.status >= 200 && r.status < 400);
  if (played?.at > 0.4) {
    ok('the file plays off the host’s bytes', `${played.at}s in, readyState ${played.ready}`);
  } else if (played?.hint && mediagot.length) {
    // The player's own error path fired, which is the product behaving well. What it cannot
    // say by itself is WHY, and for a hosted playlist the reason is the CORS wall (§10.4):
    // the bytes were fetchable, the demuxer got nothing, and the console holds the reason.
    const blocked = consoleErrors.find((m) => /CORS|ERR_FAILED|blocked by/i.test(m));
    if (blocked) {
      fail(`the host's playlist is reachable but NOT loadable by the player: the browser blocked `
        + `the redirected XHR (${blocked.slice(0, 120)}…). The file page says "the file's host is `
        + 'the problem", which is true and not the whole story — hls.js needs '
        + 'Access-Control-Allow-Origin from the CDN (VIDEO_STORAGE.md §10.4). A progressive file '
        + 'from the same host is unaffected');
    } else {
      fail(`the player stopped with its own sentence and no other explanation: ${played.hint}`);
    }
  } else if (played?.err && mediagot.length) {
    // Bytes arrived; the decoder is what is missing. Reported, never hidden.
    console.log(`skip  playback decode — the host served ${mediagot[0].status} for ${mediagot[0].url}`);
    console.log(`       but this browser could not decode it (${played.err}). The Chromium under`);
    console.log('       Playwright has no proprietary codecs: assert this on a machine with');
    console.log('       Chrome and the same walk, where the picture advancing is the real test.');
    const stageError = await page.locator('.stage-error').count();
    if (stageError) ok('and the page says so in its own words, not with a stack trace');
    else fail('the player failed to decode and the page showed no error of its own');
  } else {
    const blocked = consoleErrors.find((m) => /CORS policy/i.test(m));
    if (blocked && mediagot.length) {
      /*
       * THE CORS WALL, and it is a real one for playlists.
       *
       * hls.js loads a playlist with XMLHttpRequest. Our content route answers it with a 302
       * to the provider's CDN, and a REDIRECTED XHR is subject to CORS at its final url:
       * without `Access-Control-Allow-Origin` from the CDN the browser hands the script
       * nothing, the demuxer never gets data, and `play()` simply does not settle — no
       * error event, no hint, a spinner and a still picture. A progressive file is NOT
       * affected: the element loads it directly, and media elements are not CORS-bound.
       *
       * So this is reported in the host's own terms rather than as "the player broke":
       * the file exists, the bytes are reachable, and the delivery path needs either CORS
       * from the CDN or a proxy (VIDEO_STORAGE.md §10.4 — a bandwidth decision, not a
       * bug fix).
       */
      fail(`the host's playlist is reachable but NOT loadable: the browser blocked the `
        + `redirected XHR with a CORS error (${mediagot[0].url}). hls.js cannot play a `
        + 'playlist from a CDN that sends no Access-Control-Allow-Origin; a progressive '
        + 'file from the same host is unaffected (VIDEO_STORAGE.md §10.4)');
    } else {
      fail(`the player never advanced — ${JSON.stringify(played)}; media responses: ${JSON.stringify(mediaResponses.slice(0, 4))}`);
    }
  }

  // The other side of the same router, on the same store and behind the same door: a
  // FREE file that lives on our disk. If everything redirected, this walk would still
  // pass and the product would be badly wrong — the router has to be deciding by what
  // the file IS, not by which route was called.
  const LOCAL = process.env.EYES_LOCAL_SLUG || 'free-sample-pack';
  await page.goto(`${BASE}/s/${STORE}/a/${LOCAL}`, { waitUntil: 'domcontentloaded' });
  const localUrl = await page.evaluate(() => [...document.querySelectorAll('[href],[src]')]
    .map((e) => e.getAttribute('href') || e.getAttribute('src'))
    .find((u) => u && u.includes('/api/content')) || null);
  if (!localUrl) {
    ok('a local file is still ours to serve', `(${LOCAL} offers no content link to compare)`);
  } else {
    const u = new URL(localUrl, BASE);
    const local = await read(u.pathname + u.search);
    if (local.status() === 302) {
      fail(`a file on our disk redirected away (${LOCAL}) — the router decided by the wrong fact`);
    } else {
      ok('a file on our disk is still served by us', `${LOCAL} → ${local.status()} ${(local.headers()['content-type'] || '').split(';')[0]}`);
    }
  }

  // ── 3. the two pages that have to say so ───────────────────────────────────
  const seller = await read(`/dashboard/${STORE}/assets/${assetId}`);
  const sellerHtml = await seller.text();
  if (!/data-hosted-note="1"/.test(sellerHtml)) {
    fail('the seller is not told their video is held and delivered by the media host');
  } else ok('the seller’s own page says where the bytes are');

  const privacy = await read('/legal/privacy');
  const privacyText = await privacy.text();
  if (!/fetches the video <strong>from\s+them directly rather than through us<\/strong>/.test(privacyText)) {
    fail('the privacy notice does not disclose that the viewer’s browser talks to the host');
  } else if (!/Last updated: 26 September 2026/.test(privacyText)) {
    fail('the notice changed without its date changing — the version rule in consent.js says they move together');
  } else ok('the privacy notice names the delivery fact, and is dated for it');

  if (page.errors.length) fail(`console errors — ${page.errors.join(' | ')}`);
  await context.close();
} finally {
  await browser.close();
}

console.log(errors.length ? `\nvideo host walk: ${errors.length} finding(s)` : '\nvideo host walk: ok');
process.exit(errors.length ? 1 : 0);
