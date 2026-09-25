/**
 * Do the two NEW hosts actually deliver a store's file to a viewer's browser?
 *
 * The HTTP-level proof already showed the keys: `telegraph/<name>.png` for an image,
 * `pixeldrain/<id>` for audio and an archive. This walk answers the next question, which
 * only a browser can: when a viewer opens the file, does the element load from THAT host,
 * and do the bytes arrive and work — a picture that is actually drawn, a tone that actually
 * plays?
 *
 * It is the same claim `ci/eyes/video-host-walk.mjs` makes for video, applied to the two
 * kinds this round added, and it watches the network rather than the markup: the route is a
 * 302 to the host, so the element's own request is what has to be true.
 *
 *   # an instance with the new drivers on: see the recipes in video-host-walk.mjs's header
 *   node ci/eyes/kind-walk.mjs
 *
 * Run it from the harness directory the other walks use (`ci/eyes/setup.sh` puts the browser
 * and the session helper there), because it imports `./lib.mjs` like all of them. The assets
 * it reads are the ones the round created — upload them first with any seller session:
 *
 *   kind-proof-image.png   image/png    → image host
 *   kind-proof-tone.wav    audio/wav    → general host
 *
 * The session directory is `/tmp/eyes-kind`, separate from the video walk's, so the two can
 * run in either order without invalidating each other.
 */
import { chromium } from 'playwright-core';
import { sessionFor, consent } from './lib.mjs';

const BASE = process.env.EYES_BASE || 'http://127.0.0.1:3100';
const browser = await chromium.launch({ executablePath: '/tmp/chromium', args: ['--no-sandbox'] });
const errors = [];
let failures = 0;
const ok = (m) => console.log(`  ok   ${m}`);
const bad = (m) => { failures += 1; console.error(`  FAIL ${m}`); };
const says = (m) => console.log(`       ${m}`);

try {
  const state = await sessionFor(browser, 'alice', { base: BASE, dir: '/tmp/eyes-kind' });
  const ctx = await browser.newContext({ storageState: state });

  /** Open a file page, do whatever unlocking it asks for, and report the network. */
  async function openPage(path) {
    const p = await ctx.newPage();
    const net = [];
    p.on('response', (r) => {
      const url = r.url();
      if (/\/api\/content\/|telegra\.ph|pixeldrain|127\.0\.0\.1:400[34]/.test(url)) {
        net.push(`${r.status()} ${url.replace(BASE, '')}`.slice(0, 155));
      }
    });
    p.on('pageerror', (e) => errors.push(String(e.message).slice(0, 120)));
    await p.goto(BASE + path, { waitUntil: 'domcontentloaded' });
    await consent(p);
    await p.waitForTimeout(500);
    // "Open file" / "Watch ad" — whichever rung this seller set. Clicking the first enabled
    // control that is not a link to somewhere else is enough for an open file.
    const clicked = await p.evaluate(() => {
      const b = [...document.querySelectorAll('button, a.button, [data-watch], [data-open]')]
        .find((e) => !e.disabled && /open|unlock|watch|play|get|download/i.test(e.textContent || ''));
      if (!b) return null;
      b.click();
      return (b.textContent || '').trim().slice(0, 40);
    });
    await p.waitForTimeout(2500);
    return { p, net, clicked };
  }

  // ── the image, at the image host ──────────────────────────────────────────
  console.log('\nimage → telegraph');
  {
    const { p, net, clicked } = await openPage('/s/alice/a/kind-proof-imagepng');
    says(`unlock control: ${clicked ? `clicked "${clicked}"` : 'none found'}`);
    const facts = await p.evaluate(() => {
      const im = document.querySelector('img[src*="/api/content/"], img');
      return im ? {
        tag: im.tagName, src: im.getAttribute('src'),
        drawn: im.naturalWidth > 0 ? `${im.naturalWidth}×${im.naturalHeight}` : 'NOT DRAWN',
      } : null;
    });
    if (!facts) bad('no <img> on the page after unlocking');
    else if (facts.drawn === 'NOT DRAWN') bad(`the image did not render (src ${facts.src})`);
    else ok(`a real picture is drawn from the host — ${facts.drawn}`);
    const host = net.find((n) => /4004|telegra\.ph/.test(n));
    if (host) ok(`the browser fetched the bytes from the image host — ${host}`);
    else { bad('no request reached the image host — the file may still be coming off our disk'); says(net.join('\n       ') || '(no media requests at all)'); }
    await p.close();
  }

  // ── the audio, at the general host ────────────────────────────────────────
  console.log('\naudio → pixeldrain');
  {
    const { p, net, clicked } = await openPage('/s/alice/a/kind-proof-tonewav');
    says(`unlock control: ${clicked ? `clicked "${clicked}"` : 'none found'}`);
    const shell = await p.evaluate(() => ({
      audio: Boolean(document.querySelector('audio')),
      video: Boolean(document.querySelector('video')),
      glyph: document.querySelector('.audio-glyph')?.textContent || null,
    }));
    says(`shell: audio=${shell.audio} video=${shell.video} glyph=${JSON.stringify(shell.glyph)}`);
    if (!shell.audio) bad('no audio element on the page');
    else ok('the audio shell is ours — an <audio> element, no video element');
    await p.evaluate(() => { const a = document.querySelector('audio'); if (a) { a.muted = true; a.play().catch(() => {}); } });
    let played = null;
    const t0 = Date.now();
    while (Date.now() - t0 < 15_000) {
      played = await p.evaluate(() => {
        const a = document.querySelector('audio');
        return a ? { at: Number(a.currentTime.toFixed(2)), ready: a.readyState, dur: Number.isFinite(a.duration) ? Number(a.duration.toFixed(2)) : null, err: a.error ? `code ${a.error.code}` : null } : null;
      });
      if (played?.err || played?.at > 0.3) break;
      await p.waitForTimeout(300);
    }
    if (played?.at > 0.3) ok(`the tone plays off the host's bytes — ${played.at}s in, duration ${played.dur}s, readyState ${played.ready}`);
    else bad(`the tone did not play — ${JSON.stringify(played)}`);
    const host = net.find((n) => /4003|pixeldrain/.test(n));
    if (host) ok(`the browser fetched the bytes from the general host — ${host}`);
    else { bad('no request reached the general host'); says(net.join('\n       ') || '(no media requests at all)'); }
    await p.close();
  }

  if (errors.length) says(`page errors: ${errors.join(' | ')}`);
  await ctx.close();
} finally {
  await browser.close();
}
console.log(failures ? `\nkind walk: FAILED (${failures})\n` : '\nkind walk: ok\n');
process.exit(failures ? 1 : 0);
