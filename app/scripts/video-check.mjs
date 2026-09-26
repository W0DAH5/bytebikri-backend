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
 *   npm run video:check -- --driver=antmedia         # the LIVE host: the server, the app, the auth
 *   npm run video:check -- --probe-live              # mint a live stream, print the ingest
 *                                                    # addresses, and DELETE the container
 *   npm run video:check -- --probe-telegraph         # is the UNDOCUMENTED image upload alive?
 *
 * `--upload` on the live host is REFUSED, by design: a stream engine stores nothing for this
 * product (§12), so there is no file to send it and nothing it would do with one.
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
if (flag('probe-telegraph') || flag('probe-live')) {
  if (flag('probe-telegraph')) await probeTelegraph();
  if (flag('probe-live')) await probeLive();
  /*
   * A probe is a complete run on its own. The driver check is a separate question — "is the
   * configured host usable" — and answering it because somebody asked whether an endpoint
   * exists would report failures nobody asked about (and, with no driver configured, an
   * `Unknown driver "local"` line that reads like a problem).
   */
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
  /*
   * THE WHOLE CHAIN, not just the first host, because the chain is the answer to the question an
   * operator actually has on a launch morning: what happens when the first one says no. A
   * refusal at the host is not hypothetical for either of the two hosts with known problems —
   * Pixeldrain's keys expire after 30 idle days and its free plan refuses what it reads as abuse,
   * and Catbox's terms are enforced by a person, not by an HTTP status — so the line says where
   * the file goes next, and ends where the walk always ends: our own disk.
   */
  const chain = driver === 'local' ? [] : video.uploadChainForKind(kind);
  const tail = chain.length > 1 ? ` → then ${chain.slice(1).join(' → ')}` : '';
  console.log(`    ${kind.padEnd(7)} → ${how}${tail}${chain.length ? ' → our own disk (always works)' : ''}`);
}
if (process.env.MEDIA_FALLBACK) {
  console.log(`    MEDIA_FALLBACK=${process.env.MEDIA_FALLBACK}`);
} else {
  console.log('    MEDIA_FALLBACK is not set — each kind tries only its own driver, then our disk');
  console.log('      set it to name fallbacks in order (`all`, or `pixeldrain,catbox`) so one host'
    + '\n      refusing cannot stop an upload');
}

/*
 * ── HOW THE BYTES REACH A VIEWER, SAID BEFORE ANYTHING ELSE ──────────────────
 *
 * This is here rather than in the account report because two of the hosts have no account to
 * ask (Catbox's userhash, Telegra.ph's absence of one) and would therefore never print it —
 * and it is exactly those hosts whose delivery behaviour an operator needs to know. A
 * redirect puts the viewer's browser on the host's connection and costs us nothing; a relay
 * pipes every byte through this server, which is the only way to serve a host that refuses
 * browser fetches (Pixeldrain's free plan answers 403 `hotlink_detected`).
 */
const factsEarly = video.hostFacts().find((h) => h.host === chosen) || null;
if (chosen !== 'filemoon' && !factsEarly?.role) {
  const relayed = video.relaysThroughUs(chosen);
  says(`delivery: ${relayed
    ? 'through this server (relayed) — every byte is piped, which costs our upload and works when a host will not serve a browser'
    : `a redirect to the host${factsEarly?.hotlink === 'refused-when-free'
      ? ' — and this host refuses browser fetches on a free plan, so a viewer may get a 403' : ''}`}`);
  says('          MEDIA_RELAY=none stops relaying, all relays every host, or name hosts: MEDIA_RELAY=pixeldrain,catbox');
}
if (chosen === 'catbox') {
  says('          Catbox is NOT relayed by default: their terms forbid being a service\'s CDN, and');
  says('          piping their bytes through us is still that — the relay is an HTTP fix, not a licence one');
}

/** `--drivers`: one honest line per provider, then stop. */
if (flag('drivers')) {
  console.log('');
  for (const facts of video.hostFacts()) {
    /*
     * A LIVE HOST GETS ITS OWN LINE, because a file cap and a retention word describe
     * storage and this host does none: printing "no published cap · permanent" beside it
     * would describe a bucket that does not exist. What matters about it instead is that
     * every byte it touches is a stream.
     */
    const shape = facts.role === 'live'
      ? 'live only · nothing stored · metered per minute DELIVERED'
      : `${facts.maxBytes ? `${Math.round(facts.maxBytes / 1024 / 1024)} MB/file` : 'no published cap'}`
        + ` · ${facts.hls ? 'playlists' : 'progressive'} · ${facts.durable ? 'permanent' : 'EXPIRES when idle'}`;
    console.log(`  ${facts.host.padEnd(9)} ${facts.configured ? 'configured' : 'not configured'} · ${shape}`);
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
    /*
     * A SELF-HOSTED SERVER HAS NO TIER, so the report says what it does have: which address,
     * which application, how it authorises us, and what is on it. The three ways this fails
     * look identical from outside — an unlisted IP, a wrong JWT secret, a wrong application
     * name — and each one has a different fix, which is why the provider's error messages
     * name them (that is the only useful thing an error message can do here).
     */
    if (chosen === 'antmedia') {
      says(`server: ${account.base} · application: ${account.app}`);
      says(`authorisation: ${account.token}`);
      says(`on the server: ${account.streams} stream(s) known, ${account.live} live right now`);
      says('role: LIVE ONLY — this host runs streams; no kind of file is routed to it');
      says('listing: GET /broadcasts/list/0/N is the endpoint behind the counts above');
      says('costing: the server and its bandwidth, not the audience — no viewer or broadcaster '
        + 'limit in the Community licence, and no per-minute meter at all');
      says('LICENCE: the Community Edition is free (commercial use included). An Enterprise TRIAL '
        + 'key may not be used commercially or to benefit a third party, so a store\'s broadcast '
        + 'belongs on Community or a paid licence — never on a trial');
      if (video.providers.antmedia.authMode() === 'ip-filter') {
        says('note: no ANT_MEDIA_REST_SECRET is set, so this relies on the server\'s REST API IP');
        says('      filter allowing this address. Setting the JWT filter + secret is the stronger');
        says('      configuration: then the credential travels with the request.');
      }
    }
    /*
     * HOW THIS HOST'S BYTES REACH A VIEWER, because it decides whether a store page works.
     *
     * A redirect puts the viewer's browser on the host's connection and costs us nothing; a
     * relay sends every byte through this server, which is the only way to serve a host that
     * refuses browser fetches (Pixeldrain's free plan answers 403 `hotlink_detected`) and
     * costs upload. Say which one is in force, and name the switch — an operator who has just
     * paid for a Pro key wants to stop paying the hop, and one who is blocked wants to know
     * the relay is already on.
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
} else if (chosen === 'antmedia') {
  /*
   * Reported above, in its own words. A stream list is not a file list: saying "GET /videos"
   * here would name an endpoint this server does not have, and saying "no listing" would be
   * false about the endpoint it does have.
   */
} else if (facts && facts.lists) {
  /*
   * A host that HAS a listing gets told so, with the count — because "does this host still
   * hold the files we think it does" is a question an operator asks after an incident, and
   * the answer should not be "not used for this host" when the endpoint exists.
   */
  says(`listing: GET /videos is available (${account && account.videos !== null && account.videos !== undefined ? `${account.videos} item(s) on the account` : 'count not read'})`);
} else {
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
/*
 * A HOST THAT STORES NOTHING CANNOT BE UPLOADED TO, and it is worth saying why rather
 * than failing the upload with a routing error: the file would go to the kind routing
 * (Filemoon, Pixeldrain, Catbox — or our own disk), never here. Refusing at the door
 * keeps the doctor's own output honest about what this deployment does.
 */
if (toUpload && video.hostFacts().find((h) => h.host === chosen)?.role === 'live') {
  console.log('');
  console.error(`  ${chosen} is the LIVE host: it holds no files, so there is nothing to upload to.`);
  console.error('  The kinds route to the storage hosts (see --drivers). For this one, the check is:');
  console.error('');
  console.error('    npm run video:check -- --probe-live');
  console.error('');
  process.exit(2);
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
      /*
       * RANGE MEANS SOMETHING ONLY ON A FILE, NOT ON A PLAYLIST.
       *
       * This probe asks "can a viewer scrub?" and answers it by asking for two bytes. On a
       * progressive file that is exactly the right question. On an `.m3u8` it is not:
       * seeking inside HLS is the demuxer's business (hls.js fetches the segment it wants),
       * and a playlist is a few hundred bytes of text that fits in one packet — so a plain
       * 200 is a correct answer, not a defect. An earlier version of this loop reported that
       * as "the media url ignored Range", which would have sent an operator looking for a bug
       * in a host that was behaving.
       *
       * A host that also publishes a PROGRESSIVE asset of the same media is probed on that
       * instead, because a progressive file is the thing a viewer would actually scrub. The
       * live hosts here publish HLS and nothing else, so today the playlist is simply not
       * range-probed — the sentence says so rather than inventing a target.
       */
      let rangeTarget = { ok: false, detail: 'no progressive asset to probe' };
      if (played.kind === 'hls') {
        const mp4 = String(played.url).includes('/hls/') ? String(played.url).replace(/\/hls\/manifest\.m3u8.*$/, '/mp4/source.mp4') : null;
        says(`seeking: ${mp4 ? `the playlist is not a byte-ranged file, so the progressive asset is probed instead (${mp4.split('/').pop()})` : 'the playlist is not a byte-ranged file — seeking is the demuxer\'s business, so Range is not probed here'}`);
        if (mp4) rangeTarget = await probeRange(mp4);
        else rangeTarget = { skipped: true, detail: 'playlist only' };
      } else {
        rangeTarget = await probeRange(played.url);
      }
      if (rangeTarget.ok) ok(`the media url honours Range — seeking works (${rangeTarget.detail})`);
      else if (rangeTarget.skipped) says('range probe skipped — nothing byte-ranged to ask (see above)');
      else if (rangeTarget.unreachable) says(`range probe skipped — this machine cannot reach the media url (${rangeTarget.detail})`);
      else bad(`the media url ignored Range, so a viewer cannot scrub (${rangeTarget.detail})`);
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
  /*
   * THE NEXT COMMAND HAS TO BE ONE THAT WORKS. For a storage host that is an upload; for
   * the live host it is a mint, because `--upload` there is refused on purpose and a hint
   * pointing at a refused command teaches an operator to distrust the tool.
   */
  const isLive = video.hostFacts().find((h) => h.host === chosen)?.role === 'live';
  console.log('\n  No file to read a shape from. Re-run with:');
  console.log(isLive
    ? `    npm run video:check -- --driver=${chosen} --probe-live`
      + '\n  (this host stores nothing, so there is no file to check it with — it runs streams)'
    : `    npm run video:check -- --driver=${chosen} --upload app/seed-assets/store-walkthrough.mp4`);
  console.log('');
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
    const readable = res.status >= 200 && res.status < 300;
    if (allow === '*' || allow === 'https://bytebikri.example') {
      /*
       * A HEADER IS NOT A PLAYLIST. The first version of this check called any response
       * carrying `access-control-allow-origin` CORS-clean, and a 401 with the header passed
       * — the browser would have been allowed to read a refusal. So the status is part of
       * the answer now, and a self-hosted server is exactly where it matters: turning on the
       * stream JWT filter (an Enterprise feature) makes every playlist 401, and Community
       * Edition has no way to hand a viewer the token that would fix it.
       */
      if (!readable) {
        return {
          ok: false,
          detail: `${res.status} carries allow-origin: ${allow} but the playlist itself cannot be read`
            + ' — if this is your own server, the JWT STREAM filter is on. Community Edition cannot'
            + ' issue play tokens, so that switch has to be off (the REST filter is a different one)',
        };
      }
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
 * `--probe-live`: mint a live stream, print exactly what a seller would type into their
 * encoder, and remove the container again.
 *
 * This is the one capability no other host in the registry has, and it cannot be proved
 * from this side: creating a stream is a call, but *broadcasting* needs an RTMP push from a
 * machine with ffmpeg (or OBS) and a network that can reach the ingest port. So the
 * probe does what can be done in one command — it mints, reads back the playlist url and the
 * three ingest addresses, confirms the key is there, and deletes the container so nothing is
 * left billing. The push itself is printed as the next step, with the exact command.
 *
 * The streamKey is printed because this is the operator's own terminal and the key is theirs
 * to use; it is never stored by the app (VIDEO_STORAGE.md §11.2).
 */
async function probeLive() {
  /*
   * WHICHEVER LIVE DRIVER IS NAMED, which today means the self-hosted server.
   *
   * The dispatch below is by provider rather than by name-once, because a live driver is a
   * capability (§12): anything that declares `capabilities.live` can be probed by the same
   * command, and a hardcoded provider name is how a second one becomes invisible.
*/
  const liveName = video.liveDriver();
  if (liveName === 'local') {
    bad('no LIVE_DRIVER is configured — nothing can mint a stream. Set LIVE_DRIVER=antmedia');
    return;
  }
  const provider = video.providers[liveName];
  if (!provider.configured()) {
    bad(`${liveName} is named as LIVE_DRIVER but is not configured — see app/.env.example`);
    return;
  }
  console.log(`\n  ${provider.label} live probe\n`);
  console.log(`  base        : ${typeof provider.base === 'function' ? provider.base() : liveName}`);
  let live = null;
  try {
    live = await provider.createLiveStream({ liveName: 'bytebikri-probe' });
    ok(`a live stream was minted — ${live.id}`);
    says(`stream key  : ${live.streamKey}`);
    says(`playlist    : ${live.hls || '(the host did not return one yet)'}`);
    /* The publish url, from the provider when it knows the exact shape and derived when not. */
    const publish = live.publishUrl
      || `${String(provider.capabilities.live.ingest.rtmp).replace(/\/$/, '')}/${live.streamKey}`;
    const suffix = `/${live.streamKey}`;
    const rtmpServer = publish.endsWith(suffix) ? publish.slice(0, -suffix.length)
      : provider.capabilities.live.ingest.rtmp;
    says('');
    says('Put these in OBS (Service: Custom), or push with ffmpeg:');
    says(`  server    : ${rtmpServer}`);
    says(`  stream key: ${live.streamKey}`);
    says('  ffmpeg    : ffmpeg -re -f lavfi -i testsrc=size=640x360:rate=30 \\');
    says('                -f lavfi -i sine=frequency=440 -c:v libx264 -preset veryfast \\');
    says(`                -t 60 -f flv ${publish}`);
    if (liveName === 'antmedia') {
      says('              (the stream id doubles as the key here — Community has no publish');
      says('               tokens, which is why we mint it from 128 bits of entropy and never');
      says('               show it to a viewer)');
    }
    const state = await provider.liveStream(live.id);
    says('');
    says(`broadcasting: ${state.broadcasting ? 'YES — a stream is up' : 'not yet (expected: nothing is pushing)'}`);
    says('A live file points at that playlist and our own player plays it: the breaks, the cue');
    says('and the unlock ladder are unchanged, because the url is still an .m3u8.');

    /*
     * THE TWO FACTS THAT DECIDE WHETHER A STREAM CAN BE SOLD, and neither can be learned
     * from the create call:
     *
     *   * whether the playlist is CORS-readable — hls.js fetches an m3u8 with XHR under
     *     `connect-src`, and a CDN that omits `Access-Control-Allow-Origin` gives a black
     *     rectangle and no error event (§10.4). For a STREAM there is no mp4 to fall back
     *     to, so this is the difference between working and not;
     *   * what a minute of it costs, which is a number an operator should read once,
     *     before a store's first broadcast, rather than discover on an invoice.
     *
     * A playlist that is not broadcasting yet can still answer: a 200 with the header is
     * the whole question, and a 404 is reported as "not yet" rather than as a failure,
     * because the answer only exists while somebody is pushing.
     */
    if (live.hls) {
      try {
        const res = await fetch(live.hls, { method: 'GET' });
        const origin = res.headers.get('access-control-allow-origin');
        const readable = res.status >= 200 && res.status < 300;
        if (res.status === 404) {
          says('cors        : unknown yet — the playlist is not being served (nothing is pushing), '
            + 'so hls.js cannot be tested until a stream is up');
        } else if (res.status === 401 || res.status === 403) {
          /*
           * The header is present and the playlist is still unreadable, which is the one
           * combination a header-only check calls a pass. On a hosted CDN this is a broken
           * delivery rule; on a SELF-HOSTED server it is almost always the stream JWT
           * filter (`jwtStreamControlEnabled`) — an Enterprise feature that Community
           * Edition cannot issue play tokens for, so it must be off there. Either way the
           * viewer gets a black rectangle, so it is a failure with the reason named.
           */
          bad(`the playlist answers ${res.status}${origin ? ` (with allow-origin: ${origin})` : ''} — the header is there `
            + 'and the bytes are not: a viewer\'s player would load a playlist it is not allowed to read. '
            + (liveName === 'antmedia'
              ? 'On your own server this is the JWT STREAM filter: turn it off. The REST filter is a different '
                + 'switch and the two are independent, and Community Edition has no way to issue a play token.'
              : 'Check the delivery rule for this stream.'));
        } else if (origin && readable) {
          ok(`the playlist is CORS-readable — hls.js can load it (${res.status} allow-origin: ${origin})`);
        } else {
          bad(`the live playlist is not CORS-readable (${res.status} with no access-control-allow-origin), `
            + 'so our own player cannot fetch it in a viewer\'s browser: the CDN must send the header, or '
            + 'the playlist and its segments must be served from our own origin (VIDEO_STORAGE.md §10.4 — '
            + 'a bandwidth decision, and there is no mp4 fallback for a live stream)');
        }
      } catch (err) {
        says(`cors        : could not read the playlist from here — ${err.message}`);
      }
    }
    const caps = provider.capabilities;
    says(`limits      : ${caps.live.metering}`);
    /*
     * A sandbox is a fact about a HOSTED service; a self-hosted server has none, and asking
     * one for its sandbox limits threw before this guard existed. Capability questions are
     * asked of the capability, never of the provider's identity.
     */
    if (typeof provider.isSandbox === 'function' && provider.isSandbox()) {
      says(`              SANDBOX: live stops after ${Math.round(caps.sandbox.liveMaxSeconds / 60)} min, `
        + `the recording is cut at ${caps.sandbox.liveRecordSeconds}s`);
    }
  } catch (err) {
    bad(`the live probe failed — ${err.message}`);
  } finally {
    if (live) {
      // Never leave a container behind: on a paid plan it is a thing that exists and bills.
      try {
        await provider.removeLiveStream(live.id);
        says(`removed     : ${live.id} (no container left behind)`);
      } catch (err) {
        bad(`could not remove the probe stream ${live.id} — delete it by hand: ${err.message}`);
      }
    }
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
