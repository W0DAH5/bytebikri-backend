/**
 * Ask a video host who we are, and what its files actually look like.
 *
 * THIS IS THE HALF OF THE INTEGRATION THIS REPOSITORY COULD NOT TEST.
 *
 * The media-host clients were written in an environment that refuses egress to every
 * provider (a TLS reset or a bare refusal for filemoon.org, pixeldrain.com and telegra.ph
 * alike; `api.github.com` answers, so it is an allowlist rather than a broken network).
 * Every request shape in them is therefore a documented guess — right about the endpoints,
 * unverified about the bodies. This command is where the guess meets the truth, and it is
 * deliberately chatty about the truth: it prints the KEYS of every response it gets, so a
 * wrong field name is a one-line fix rather than a debugging session.
 *
 * It also reports the facts that decide whether a host can hold a store's file at all —
 * the account's tier, the host's size cap, whether the media url honours a Range request
 * (a host that ignores Range gives a video that plays but cannot be scrubbed), whether a
 * playlist is CORS-readable, and for the two hosts this repository could not reach, THE
 * THING THAT MATTERS MOST: whether an upload works at all. It exits non-zero on any
 * failure, so it doubles as a deploy smoke test.
 *
 *   npm run video:check                              # the configured driver
 *   npm run video:check -- --driver=pixeldrain       # a provider you are considering
 *   npm run video:check -- --drivers                 # all of them, one line each
 *   npm run video:check -- --upload a.mp4            # upload one file, classify, then DELETE it
 *   npm run video:check -- --upload a.jpg --driver=telegraph
 *   npm run video:check -- --probe-telegraph         # is the UNDOCUMENTED image upload alive?
 *   npm run video:check -- --upload a.mp4 --keep     # …and leave it there to look at
 *
 * The upload it performs is small on purpose: this is a check, not a backfill. When a
 * driver is an IMAGE host and no file is named, it uploads one of the demo images itself,
 * because the question "does this host still exist" should not need the operator to go and
 * find a jpeg first.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import * as video from '../src/video.js';
import { describe, describeDeep, pick } from '../src/video.js';

try {
  process.loadEnvFile(new URL('../.env', import.meta.url));
} catch { /* the deployment case: variables come from the environment */ }

const args = process.argv.slice(2);
/*
 * `--name`, and `--name=value` — both, because the usage lines above promise the second.
 *
 * They did not work: every example in this file's own header is written `--driver=catbox`,
 * and the parser looked for the exact string `--driver` followed by a separate argument, so
 * `--driver=catbox` silently fell through to the configured driver. The doctor would then
 * check the WRONG host and report on it in good faith, which is worse than refusing. Both
 * spellings are accepted now, and `--name value` still works because every usage line in
 * the repository's history has that shape somewhere.
 */
const flag = (name) => args.includes(`--${name}`) || args.some((a) => a.startsWith(`--${name}=`));
const value = (name) => {
  const inline = args.find((a) => a.startsWith(`--${name}=`));
  if (inline) return inline.slice(name.length + 3);
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : null;
};

const ok = (line) => console.log(`  ok   ${line}`);
const bad = (line) => { console.error(`  FAIL ${line}`); process.exitCode = 1; };
const mask = (s) => String(s || '').replace(/[^\s@.]{2,}/g, (m) => (m.length > 3 ? `${m.slice(0, 2)}…` : m));
/**
 * The indented voice used for detail under an `ok`/`FAIL` line.
 *
 * Defined with the other output helpers rather than beside the driver sections, because
 * `--probe-telegraph` runs before those sections exist and a `const` used before its
 * declaration throws — which it did, once, and reported as "the endpoint did not answer"
 * about an endpoint that had just answered.
 */
const says = (line) => console.log(`       ${line}`);

const chosen = value('driver') || video.videoDriver();

/*
 * THE LIVENESS QUESTION COMES FIRST, AND DOES NOT NEED A DRIVER.
 *
 * `--probe-telegraph` asks whether an undocumented endpoint still exists — a question that
 * has nothing to do with which driver this deployment runs, and one an operator should be
 * able to ask on a machine with no hosts configured at all. It runs here, then leaves
 * unless a driver check was asked for as well.
 */
if (flag('probe-telegraph')) {
  await probeTelegraph();
  if (!flag('driver') && !args.some((a) => a.startsWith('--driver='))) {
    console.log(process.exitCode ? '\nvideo host check: FAILED\n' : '\nvideo host check: ok\n');
    process.exit(process.exitCode || 0);
  }
  console.log('');
}

/**
 * The credential each host needs — read from the provider's own `capabilities.needs`.
 *
 * One host has none: Telegra.ph takes uploads from anybody, so there is no key to look
 * for and nothing to leak. Its `needs` names the variable that has to be SET for it to be
 * used at all, which is a different kind of fact, and `capabilities.credential === false`
 * is how it says so. Printing "IMAGE_DRIVER NOT SET" beside it would be true and useless;
 * printing "none — the choice is the switch" is the truth an operator can act on.
 */
const credentialOf = (host) => video.providers[host].capabilities.needs;
/** Named so a failure reads as "GET /user did not answer" rather than "something failed". */
const ENDPOINT_OF_ACCOUNT = { filemoon: 'GET /account', pixeldrain: 'GET /api/user' };
const credentialless = (host) => video.providers[host].capabilities.credential === false;

console.log('\nVideo host check\n');
console.log(`  driver      : ${chosen}`);
for (const host of video.HOSTS) {
  const needs = credentialOf(host);
  const mark = host === chosen ? '→' : ' ';
  if (credentialless(host)) {
    console.log(`  ${mark} ${host.padEnd(10)}: no credential needed — ${needs} is the switch`);
    continue;
  }
  const present = Boolean(process.env[needs]);
  console.log(`  ${mark} ${host.padEnd(10)}: ${needs} ${present ? `set (${mask(process.env[needs])})` : 'NOT SET'}`);
}

/*
 * WHICH HOST TAKES WHICH KIND — the routing table, printed before anything else.
 *
 * With four providers and three driver variables, "which host is configured" stopped being
 * a question with one answer. This is the answer for the environment in front of you: the
 * kind of media, the host it would go to, and 'local' where no host was chosen. A seller
 * uploading a photo and a seller uploading a video are two different destinations now, and
 * an operator should be able to see both on one screen instead of inferring them.
 */
console.log('\n  routing:');
for (const kind of ['video', 'image', 'audio', 'file']) {
  const driver = video.driverForKind(kind);
  const how = driver === 'local' ? 'our own disk' : driver;
  console.log(`    ${kind.padEnd(7)} → ${how}`);
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

// ── 1. who are we, and can this account deliver at all ──────────────────────
//
// A host with no account endpoint is not a failure: Catbox's userhash is a key rather
// than an identity, and Telegra.ph has no account at all. For those, the honest check is a
// real upload, which is section 3 — and for the image host that check is the whole point
// of this command, because its endpoint is undocumented and there are reports of it being
// switched off.
let account = null;
const noAccount = chosen === 'catbox' || chosen === 'telegraph';
try {
  account = noAccount ? null : await video.account({ provider: chosen });
  if (chosen === 'catbox') {
    ok('the credential is present (this host has no account endpoint to ask)');
  } else if (chosen === 'telegraph') {
    ok('nothing to authenticate — this host takes an upload from anybody (and can delete none of them)');
  } else {
    ok(`the token authenticates — ${ENDPOINT_OF_ACCOUNT[chosen] || 'the account endpoint'} answered`);
    says(`shape: ${describeDeep(account.raw ?? account)}`);
    const name = pick(account.raw ?? {}, ['email', 'username', 'name']) ?? account.email;
    if (name) says(`account: ${mask(name)}`);
    if (account.tier) says(`tier: ${account.tier}`);
    /*
     * The two hosts whose tier decides whether a store's file can be WATCHED.
     *
     * Pixeldrain's free tier refuses a request that looks like a hotlink
     * (`hotlink_detected`, 403) — and a redirect to its url from a store's page is exactly
     * that, so an operator on a free plan needs to hear it here rather than from a viewer.
     * This does not fail the check: the key is valid and uploads work. It is a warning with
     * a consequence, which is what a warning is for.
     */
    if (chosen === 'pixeldrain' && !/pro|premium|paid/i.test(String(account.tier || ''))) {
      says('NOTE: this account is on a free plan. Pixeldrain refuses requests it reads as');
      says('      hotlinks (403 hotlink_detected), and a store page loading its media is');
      says('      that. Verify with --upload and a browser before routing a kind here.');
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
  // The others expose no listing this product uses, and saying so beats an empty section
  // that reads like a bug.
  says(`no listing: ${chosen === 'catbox' ? 'Catbox exposes none' : 'not used for this host'}`);
}

// ── 3. a real upload, a real playback url, and a real delete ────────────────
//
// WHAT IS BEING CHECKED CHANGED WITH THE REGISTRY.
//
// It used to be one question — "does this video host work" — and the file was always a
// video. Now the routing is per KIND, so the check has to be able to exercise the kind it
// is asked about: an image host handed a video refuses for the right reason and tells you
// nothing, and a general file host needs to be tried with the kinds it will actually hold.
// The type comes from the extension for that reason, and when the driver is an image host
// and no file was named, the demo image is uploaded — because "is this endpoint still
// alive" is a question an operator should be able to answer with one command.
const MIME_OF = {
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', mkv: 'video/x-matroska',
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp',
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4',
  cbz: 'application/vnd.comicbook+zip', zip: 'application/zip', pdf: 'application/pdf',
  epub: 'application/epub+zip', txt: 'text/plain',
};

const imageDriver = chosen === 'telegraph' || chosen === 'pixeldrain';
const named = value('upload');
let toUpload = named ? path.resolve(named) : null;
let bytes = null;
if (toUpload) bytes = await readFile(toUpload);
else if (imageDriver && !flag('drivers')) {
  // An image, made here, so the liveness question needs no preparation and no fixture:
  // "is this endpoint still alive" should be answerable by one command on a fresh clone.
  bytes = probePng();
  toUpload = 'bytebikri-probe.png';
  says(`(no --upload given — ${bytes.length} bytes of generated png, uploaded and left there)`);
}
if (toUpload && bytes) {
  const extension = path.extname(toUpload).replace('.', '').toLowerCase();
  const mimeType = MIME_OF[extension] || 'application/octet-stream';
  says('');
  says(`uploading ${path.basename(toUpload)} (${(bytes.length / 1024).toFixed(1)} KB, ${mimeType})`);
  let uploaded = null;
  try {
    uploaded = await video.upload(bytes, path.basename(toUpload), { mimeType, provider: chosen });
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
    } else if (video.providers[chosen].capabilities.deletable === false) {
      /*
       * A host that cannot delete is not a failing check — it is a fact about the host, and
       * the one an operator most needs from this command. FILE LEVEL, not process level: the
       * upload worked, the url works, and the file is now permanent. Saying FAIL here would
       * train whoever reads it to ignore the word.
       */
      says('');
      says(`NOTE: ${chosen} has NO DELETE. The file above is permanent and public:`);
      says(`      ${uploaded.id} — it cannot be recalled by us, by a seller, or by anybody.`);
      says('      That is why this host is only ever used for kinds a store need not take back,');
      says('      and why `remove()` refuses instead of pretending (VIDEO_STORAGE.md §10.6).');
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

/**
 * A real png, made here, in memory.
 *
 * The probe image is generated rather than committed for two reasons. A fixture is one
 * more thing that can be missing from a checkout (the first draft of this file named one
 * and there is no image in `seed-assets/`), and a file that is uploaded to a host with no
 * delete should not also be a file somebody has to maintain. This is a 96×54 gradient with
 * a diagonal band — small, unmistakably an image, and cheap to make with `zlib` alone.
 */
function probePng(width = 96, height = 54) {
  const zlib = createRequire(import.meta.url)('node:zlib');
  const rows = [];
  for (let y = 0; y < height; y += 1) {
    const row = [0]; // filter byte: none
    for (let x = 0; x < width; x += 1) {
      const band = Math.abs((x / width) - (y / height)) < 0.06;
      row.push(band ? 245 : Math.min(255, 40 + Math.round((200 * x) / width)));
      row.push(band ? 235 : Math.min(255, 30 + Math.round((150 * y) / height)));
      row.push(band ? 200 : Math.min(255, 90 + Math.round((120 * (x + y)) / (width + height))));
    }
    rows.push(Buffer.from(row));
  }
  const chunk = (tag, data) => {
    const body = Buffer.concat([Buffer.from(tag, 'latin1'), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length, 0);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(body) >>> 0, 0);
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // colour type: truecolour
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(Buffer.concat(rows), { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/*
 * ── 4. `--probe-telegraph`: is the undocumented image endpoint alive? ────────
 *
 * Telegra.ph's `/upload` is not part of the published API, its limits are folklore, and
 * there are reports of it having been switched off in September 2024 — while other tools
 * kept using it successfully. Neither claim can be settled from documentation, and this
 * repository is built somewhere that cannot reach telegra.ph at all (TLS reset). So the
 * question is answered where the answer exists: on the machine that will use it.
 *
 * The probe makes a small png, uploads it through the SAME code path the product uses, and
 * fetches the url back. It creates nothing on our side and leaves one image public forever
 * on theirs, which is why it is a separate flag rather than part of the normal run: a probe
 * with a permanent side effect has to be asked for out loud.
 */
async function probeTelegraph() {
  const provider = video.providers.telegraph;
  const png = probePng();
  console.log('\n  Telegra.ph upload probe (undocumented endpoint — the only way to know)\n');
  console.log(`  endpoint    : ${provider.uploadBase()}`);
  try {
    const sent = await provider.upload(png, 'bytebikri-probe.png', { mimeType: 'image/png' });
    ok(`the endpoint answered — it still exists (answer: ${sent.id})`);
    says(`public url: ${sent.url}`);
    const got = await fetch(sent.url, { headers: { range: 'bytes=0-15' } }).catch((err) => ({ error: err }));
    if (got.error) says(`could not fetch it back from here: ${got.error?.message || got.error}`);
    else if (got.ok) ok(`the url serves the image back (HTTP ${got.status}, ${got.headers.get('content-type')})`);
    else says(`the url answered HTTP ${got.status} — uploaded but not served`);
    says('');
    says('A successful probe means the endpoint works TODAY, from THIS machine.');
    says('It does not make it documented, deletable, or promised: keep it to images a');
    says('store need not take back, and re-run this after any unexplained image failure.');
  } catch (err) {
    bad(`the endpoint did not answer: ${err.message}`);
    if (!/cannot reach|refused|ENOTFOUND|ECONN|404|HTTP 4|HTTP 5/i.test(err.message)) throw err;
    console.log('\n  If this is a 404 or a connection failure, the upload node is gone — pick');
    console.log('  another host for images with:  IMAGE_DRIVER=pixeldrain  (or leave it unset,');
    console.log('  which keeps every image on our own disk). Nothing else in the app breaks:\n');
    console.log('  images are stored and served locally by default.\n');
  }
}
