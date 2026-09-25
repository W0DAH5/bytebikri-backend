/**
 * Ask a video host who we are, and what its files actually look like.
 *
 * THIS IS THE HALF OF THE INTEGRATION THIS REPOSITORY COULD NOT TEST.
 *
 * The video-host clients were written in an environment that refuses egress to every
 * provider (TLS reset or a bare refusal for filemoon.org, gofile.io and catbox.moe alike;
 * `api.github.com` answers, so it is an allowlist rather than a broken network). Every
 * request shape in them is therefore a documented guess — right about the endpoints,
 * unverified about the bodies. This command is where the guess meets the truth, and it is
 * deliberately chatty about the truth: it prints the KEYS of every response it gets, so a
 * wrong field name is a one-line fix rather than a debugging session.
 *
 * It also reports the facts that decide whether a host can hold a store's video at all —
 * GoFile's tier, Catbox's size cap, whether the media url honours a Range request (a host
 * that ignores Range gives a video that plays but cannot be scrubbed) — and it exits
 * non-zero on any failure, so it doubles as a deploy smoke test.
 *
 *   npm run video:check                          # the configured driver
 *   npm run video:check -- --driver=catbox       # a provider you are considering
 *   npm run video:check -- --drivers             # all of them, one line each
 *   npm run video:check -- --upload a.mp4        # upload one file, classify, then DELETE it
 *   npm run video:check -- --upload a.mp4 --keep # …and leave it there to look at
 *
 * The upload it performs is small on purpose: this is a check, not a backfill.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import * as video from '../src/video.js';
import { describe, describeDeep, pick } from '../src/video.js';

try {
  process.loadEnvFile(new URL('../.env', import.meta.url));
} catch { /* the deployment case: variables come from the environment */ }

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const value = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : null;
};

const ok = (line) => console.log(`  ok   ${line}`);
const bad = (line) => { console.error(`  FAIL ${line}`); process.exitCode = 1; };
const mask = (s) => String(s || '').replace(/[^\s@.]{2,}/g, (m) => (m.length > 3 ? `${m.slice(0, 2)}…` : m));

const chosen = value('driver') || video.videoDriver();

/** The credential each host needs — read from the provider's own `capabilities.needs`. */
const credentialOf = (host) => video.providers[host].capabilities.needs;

console.log('\nVideo host check\n');
console.log(`  driver      : ${chosen}`);
for (const host of video.HOSTS) {
  const needs = credentialOf(host);
  const present = Boolean(process.env[needs]);
  const mark = host === chosen ? '→' : ' ';
  console.log(`  ${mark} ${host.padEnd(9)} : ${needs} ${present ? `set (${mask(process.env[needs])})` : 'NOT SET'}`);
}

/** `--drivers`: one honest line per provider, then stop. */
if (flag('drivers')) {
  console.log('');
  for (const facts of video.hostFacts()) {
    const cap = facts.maxBytes ? `${Math.round(facts.maxBytes / 1024 / 1024)} MB/file` : 'no published cap';
    console.log(`  ${facts.host.padEnd(9)} ${facts.configured ? 'configured' : 'not configured'} · ${cap}`
      + ` · ${facts.hls ? 'playlists' : 'progressive'} · ${facts.durable ? 'permanent' : 'EXPIRES when idle'}`);
    console.log(`            ${facts.note}`);
    /*
     * WHAT IT IS FOR, and what its terms say about our use of it.
     *
     * `VIDEO_STORAGE.md` §10.5 exists because the first version of this registry implied
     * three interchangeable video hosts. They are not: one is a video host whose
     * non-video uploads are download-only, one is a generalist whose playable links are
     * paid, and one is prohibited from being a service's CDN by its own operator. An
     * operator choosing a driver should meet those three facts here, once, rather than
     * in a failure a month later.
     */
    const kinds = (facts.kinds || []).join(', ') || 'nothing declared';
    const policy = facts.policy || {};
    const verdict = {
      allowed: "fine for a store's delivery path",
      premium: 'usable, on a paid plan',
      prohibited: 'DEVELOPMENT ONLY — terms forbid this use',
      unknown: 'policy not established' }[policy.commercial] || 'policy not established';
    console.log(`            serves: ${kinds} · ${verdict}`);
    if (facts.streamsInPage === 'premium') console.log('            (a free account cannot produce a playable link)');
    if (policy.note) console.log(`            terms: ${policy.note}`);
  }
  console.log('');
  process.exit(process.exitCode || 0);
}

if (!video.HOSTS.includes(chosen)) {
  console.log(`\n  Unknown driver "${chosen}". One of: ${video.HOSTS.join(', ')}`
    + '\n  (anything else means "local disk", which needs no check).\n');
  process.exit(0);
}
if (!video.providers[chosen].configured()) {
  console.log(`\n  ${credentialOf(chosen)} is not set, so there is nothing to check.`
    + `\n  Put it in app/.env (it is gitignored) and set VIDEO_DRIVER=${chosen}.`
    + '\n  The credential is a live one: it belongs in that file and nowhere else.\n');
  process.exit(0);
}

const facts = video.hostFacts().find((h) => h.host === chosen);
const says = (line) => console.log(`       ${line}`);

// ── 1. who are we, and can this account deliver at all ──────────────────────
//
// The second half of that question is the GoFile one: uploading works on any tier, but a
// playable link is Premium, so a free account holding a store's video would be a file
// nobody can watch (VIDEO_STORAGE.md §10.1).
let account = null;
try {
  account = await video.account({ provider: chosen });
  if (chosen === 'catbox') {
    ok('the credential is present (this host has no account endpoint to ask)');
  } else {
    ok(`the token authenticates — ${chosen === 'filemoon' ? 'GET /account' : 'GET /accounts/getid'} answered`);
    says(`shape: ${describeDeep(account.raw ?? account)}`);
    const name = pick(account.raw ?? {}, ['email', 'username', 'name']) ?? account.email;
    if (name) says(`account: ${mask(name)}`);
    if (account.tier) says(`tier: ${account.tier}`);
    if (chosen === 'gofile' && String(account.tier).toLowerCase() !== 'premium') {
      bad(`this GoFile account is "${account.tier}", so it cannot produce a playable link: `
        + video.providers.gofile.PLAYBACK_NEEDS_PREMIUM);
    }
  }
} catch (err) {
  bad(`${chosen} account check failed — ${err.message}`);
  if (/cannot reach|did not answer/.test(err.message)) {
    console.error('\n  A network failure and a rejected credential look different on purpose:'
      + '\n  this one never reached the host. If you are running this inside a sandbox'
      + '\n  that blocks egress, run it where the app itself runs.\n');
  }
  process.exit(1);
}

// ── 2. what does a file look like, and can the media url be sought in ───────
if (chosen === 'filemoon') {
  let sample = null;
  try {
    const listing = await video.filemoon.listFiles();
    const rows = Array.isArray(listing) ? listing
      : (pick(listing, ['files', 'items', 'results', 'data']) ?? []);
    says(`GET /files answered: ${describe(listing)}`);
    says(`entries: ${Array.isArray(rows) ? rows.length : 'unknown'}`);
    sample = Array.isArray(rows) && rows.length ? rows[0] : null;
    if (sample) {
      const id = video.filemoon.fileIdOf(sample);
      says(`one file's keys: ${describeDeep(sample)}`);
      if (!id) bad(`no id-like field in a listing row — keys were ${describe(sample)}`);
      else {
        const record = await video.filemoon.file(id);
        says(`GET /files/${id} keys: ${describeDeep(record.raw)}`);
        says(`parsed: title=${record.title} status=${record.status} size=${record.sizeBytes} duration=${record.durationSec}`);
        try {
          const found = video.playbackOf(record);
          ok(`playback resolves as ${found.kind} (${found.url.slice(0, 60)}…)`);
          if (found.kind === 'hls') {
            says('HLS: the file page will mark the player so it attaches the vendored demuxer (VIDEO_STORAGE.md §5).');
          }
        } catch (err) { bad(err.message); }
      }
    } else {
      says('(no files on the account yet — upload one with --upload to see the file shape)');
    }
  } catch (err) {
    bad(`listing files failed — ${err.message}`);
  }
} else {
  // Neither of the others can list: GoFile's listings are Premium, Catbox has none. Saying
  // so beats an empty section that reads like a bug.
  says(chosen === 'gofile'
    ? 'no listing: GoFile serves folder listings to Premium accounts only'
    : 'no listing: Catbox exposes none');
}

// ── 3. a real upload, a real playback url, and a real delete ────────────────
const toUpload = value('upload');
if (toUpload) {
  const file = path.resolve(toUpload);
  const bytes = await readFile(file);
  says('');
  says(`uploading ${path.basename(file)} (${(bytes.length / 1024).toFixed(1)} KB)`);
  let uploaded = null;
  try {
    uploaded = await video.upload(bytes, path.basename(file), { mimeType: 'video/mp4', provider: chosen });
    ok(`uploaded — id ${uploaded.id}, key ${uploaded.key}`);
  } catch (err) {
    bad(`upload failed — ${err.message}`);
  }

  if (uploaded) {
    // An upload is not playable the moment it lands at every host: Filemoon processes it.
    // Poll a little, and report what the provider calls each state rather than assuming.
    if (chosen === 'filemoon') {
      for (let i = 0; i < 10; i += 1) {
        const record = await video.filemoon.file(uploaded.id).catch((err) => ({ error: err.message }));
        const state = record.status ?? record.error;
        says(`[${i}] status: ${state}${record.durationSec ? ` · ${record.durationSec}s` : ''}`);
        if (record.error || ['ready', 'finished', 'ok', 'active', 'completed', 'done'].includes(String(state))) break;
        await new Promise((r) => setTimeout(r, 3000));
      }
    }

    const played = await video.playback(uploaded.id, { provider: chosen }).catch((err) => ({ error: err.message }));
    if (played.error) {
      bad(`no playback url: ${played.error}`);
    } else {
      ok(`playback resolves as ${played.kind} (${played.url.slice(0, 70)}…)`);
      /*
       * THE ORIGIN THE PAGE WILL HAVE TO BE ALLOWED TO USE.
       *
       * A progressive file loads under `media-src`, which allows `https:` outright — but a
       * PLAYLIST is fetched by hls.js with XHR, and that is `connect-src`, which names
       * origins and must never be widened to a scheme. The origin cannot be known until a
       * real playback url comes back, so this is where the operator learns it — one line,
       * copied into `VIDEO_MEDIA_ORIGINS`, rather than a black rectangle to diagnose.
       */
      try {
        const origin = new URL(played.url).origin;
        const allowed = video.mediaOrigins().includes(origin);
        if (allowed) says(`page policy: ${origin} is already allowed (connect-src)`);
        else if (played.kind === 'hls') {
          bad(`the page cannot fetch this playlist: add VIDEO_MEDIA_ORIGINS=${origin} to app/.env `
            + '(connect-src names origins; it is deliberately never widened to a scheme)');
        } else {
          says(`page policy: ${origin} is not listed — fine for a progressive file (media-src allows https), `
            + `but playlist playback would need VIDEO_MEDIA_ORIGINS=${origin}`);
        }
      } catch { /* an unparseable url is reported by the Range probe below */ }
      if (played.kind === 'hls') {
        /*
         * CORS, asked the way a browser asks it.
         *
         * hls.js loads playlists and segments with XHR, and a redirected XHR is judged at
         * its FINAL url — so a CDN that serves bytes happily and sends no
         * `Access-Control-Allow-Origin` gives a player that loads nothing, with no error
         * event to react to. A progressive file does not care. Whether the provider's CDN
         * sends the header is not published anywhere, which is exactly why it is asked
         * here, from a machine that can reach it.
         */
        const cors = await probeCors(played.url);
        if (cors.ok) ok(`the playlist is CORS-readable — hls.js can load it (${cors.detail})`);
        else if (cors.unreachable) says(`CORS probe skipped — cannot reach the playlist (${cors.detail})`);
        else {
          bad(`the playlist is not CORS-readable (${cors.detail}), so hls.js cannot play it in `
            + 'a viewer\'s browser: the CDN must send Access-Control-Allow-Origin, or the '
            + 'playlist must be served from our own origin (VIDEO_STORAGE.md §10.4 — a '
            + 'bandwidth decision, not a config change)');
        }
      }
      const probed = await probeRange(played.url);
      if (probed.ok) ok(`the media url honours Range — seeking works (${probed.detail})`);
      else if (probed.unreachable) says(`range probe skipped — this machine cannot reach the media url (${probed.detail})`);
      else bad(`the media url ignored Range, so a viewer cannot scrub (${probed.detail})`);
    }

    if (flag('keep')) {
      says(`left on the account: ${uploaded.id} (delete it when you are done)`);
    } else {
      try {
        await video.remove(uploaded.id, { provider: chosen });
        ok('deleted — the host confirmed it');
      } catch (err) {
        bad(`delete failed, the file is still on the account (${uploaded.id}): ${err.message}`);
      }
    }
  }
} else if (!flag('drivers')) {
  console.log('\n  No file to read a shape from. Re-run with:'
    + `\n    npm run video:check -- --driver=${chosen} --upload app/seed-assets/store-walkthrough.mp4\n`);
}

console.log(process.exitCode ? '\nvideo host check: FAILED\n' : '\nvideo host check: ok\n');

/**
 * Ask for the playlist the way a browser would, and read the CORS verdict.
 *
 * `Origin` is set by hand because this is a script, not a page: the header is what makes a
 * CORS-unaware server answer without `Access-Control-Allow-Origin`, and its absence is the
 * whole finding.
 */
async function probeCors(url) {
  try {
    const res = await fetch(url, { headers: { origin: 'https://bytebikri.example', range: 'bytes=0-1' } });
    await res.body?.cancel?.();
    const allow = res.headers.get('access-control-allow-origin');
    if (allow === '*' || allow === 'https://bytebikri.example') {
      return { ok: true, detail: `${res.status} allow-origin: ${allow}` };
    }
    return { ok: false, detail: `${res.status} with ${allow ? `allow-origin: ${allow}` : 'no access-control-allow-origin'}` };
  } catch (err) {
    return { unreachable: true, detail: err?.cause?.code || err?.message || 'fetch failed' };
  }
}

/**
 * Ask for two bytes and read what comes back.
 *
 * The one behaviour of a media host that a viewer notices and an API reference never
 * states: a url that ignores `Range` still plays, but cannot be scrubbed, and a browser
 * that cannot seek in a video looks broken in a way nobody can describe. Reported as
 * three outcomes rather than two, because "this machine could not reach the CDN" is not
 * the same answer as "the CDN does not support Range".
 */
async function probeRange(url) {
  try {
    const res = await fetch(url, { headers: { range: 'bytes=0-1' } });
    await res.body?.cancel?.();
    if (res.status === 206) return { ok: true, detail: `${res.status} ${res.headers.get('content-range') || ''}`.trim() };
    if (res.status === 200) return { ok: false, detail: `200 with ${res.headers.get('content-length') || '?'} bytes — the whole file` };
    return { ok: false, detail: `answered ${res.status}` };
  } catch (err) {
    return { unreachable: true, detail: err?.cause?.code || err?.message || 'fetch failed' };
  }
}
