/**
 * Is the Mastodon credential real, and what can it actually DO?
 *
 * The Mastodon half of `video-check.mjs`: a read-only check for a credential that arrived
 * before anything uses it. It answers four questions an operator should be able to answer
 * without reading a transcript:
 *
 *   1. does the token still authenticate — and as WHICH account, on which instance?
 *   2. what is the APPLICATION allowed to do (`read`, `write`, `push`)? A token without
 *      `write` cannot post an announcement, and that failure should be found here rather
 *      than by a seller whose stream went unannounced;
 *   3. what are THIS instance's real caps? A 99 MB video limit is the default, not a fact:
 *      `GET /api/v2/instance` publishes the numbers, and an instance is somebody's server
 *      with their own settings (LIVE_DISTRIBUTION.md §1);
 *   4. `--dry-run`: exactly what an announcement would say, character count and all — with
 *      NOTHING posted. There is no posting code in this file at all, which is the point:
 *      announcing is a feature, and this is a probe.
 *
 *   npm run mastodon:check --prefix app                  # the credential, and the instance
 *   npm run mastodon:check --prefix app -- --dry-run      # what an announcement would look like
 *   npm run mastodon:check --prefix app -- --url https://example.com/s/alice/live
 *
 * It never prints the token, never logs a request header, and never puts the credential in
 * a url. Failures say what happened and exit non-zero, so it can serve as a deploy check.
 * Run it from a machine that can reach the instance: this repository's sandbox has no
 * egress to mastodon.social (the request is refused before TLS, like every media host).
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// `.env` is gitignored and holds the credential; a missing one is normal in production,
// where the variables come from the environment instead. Same loader as boot.mjs.
try { process.loadEnvFile(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.env')); }
catch { /* no .env — the environment may already carry the variables */ }

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const valueOf = (name, fallback = '') => {
  const asEquals = argv.find((a) => a.startsWith(`--${name}=`));
  if (asEquals) return asEquals.slice(name.length + 3);
  const at = argv.indexOf(`--${name}`);
  return at >= 0 && argv[at + 1] && !argv[at + 1].startsWith('--') ? argv[at + 1] : fallback;
};

const BASE = String(process.env.MASTODON_BASE || 'https://mastodon.social').replace(/\/+$/, '');
const TOKEN = process.env.MASTODON_ACCESS_TOKEN || '';

/*
 * The INSTANCE's numbers, filled in by the check below and used by the dry run.
 *
 * The first version of this file printed the instance's real `max_characters` and then
 * hardcoded 500 three lines later when measuring the draft — the exact mistake the line
 * above it warns about. An instance is somebody's server; its limits are read, not assumed,
 * and what is read is what the draft gets measured against.
 */
const caps = { maxCharacters: null, maxMedia: null };

let failures = 0;
const ok = (m) => console.log(`  ok   ${m}`);
const bad = (m) => { failures += 1; console.error(`  FAIL ${m}`); };
const says = (m) => console.log(`       ${m}`);

/** One GET, with the credential in the header and never in the url or the output. */
async function get(pathname, { auth = true, timeout = 12_000 } = {}) {
  const url = `${BASE}${pathname}`;
  const headers = { accept: 'application/json' };
  if (auth) headers.authorization = `Bearer ${TOKEN}`;
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(timeout) });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* an HTML error page is a result too */ }
  return { status: res.status, json, text: text.slice(0, 300) };
}

console.log('\n  Mastodon check\n');
console.log(`  instance    : ${BASE}`);
console.log(`  credential  : ${TOKEN ? `MASTODON_ACCESS_TOKEN set (${TOKEN.length} chars)` : 'MISSING'}`);

if (!TOKEN) {
  bad('MASTODON_ACCESS_TOKEN is not set — there is no credential to check');
  console.log('\nmastodon check: FAILED\n');
  process.exit(1);
}

// ── 1. the instance's public facts: the caps nobody should hardcode ──────────
try {
  const { status, json } = await get('/api/v2/instance', { auth: false });
  if (status !== 200 || !json) {
    bad(`the instance did not answer /api/v2/instance (${status}) — is this a Mastodon server?`);
    says(String(failures && '' ) + 'the base must be the instance url, e.g. https://mastodon.social');
  } else {
    const media = json.configuration?.media_attachments || {};
    const statuses = json.configuration?.statuses || {};
    caps.maxCharacters = statuses.max_characters || null;
    caps.maxMedia = statuses.max_media_attachments || null;
    ok(`the instance answered — ${json.title || '(untitled)'} · ${json.domain || BASE} · v${json.version || '?'}`);
    says(`media caps  : video ${mb(media.video_size_limit)} · image ${mb(media.image_size_limit)} · `
      + `${media.supported_mime_types?.length || '?'} mime types`);
    says(`posts       : ${statuses.max_characters} characters · ${statuses.max_media_attachments} attachments`);
    says('              THESE ARE THE INSTANCE\'S NUMBERS, not Mastodon\'s — read them, never hardcode');
  }
} catch (err) {
  bad(`cannot reach ${BASE} — ${err.message}`);
  says('a network failure and a rejected token look different on purpose: this one never arrived.');
  says('this repository\'s own sandbox has no egress to mastodon.social, so run this where the app runs.');
  console.log('\nmastodon check: FAILED\n');
  process.exit(1);
}

// ── 2. who the token is, and whether it may write ───────────────────────────
let account = null;
try {
  const { status, json } = await get('/api/v1/accounts/verify_credentials');
  if (status === 401 || status === 403) {
    bad(`the token was REFUSED (${status}) — it may have been regenerated or revoked`);
  } else if (status !== 200 || !json) {
    bad(`the credential check answered ${status}`);
    if (json?.error) says(`the instance said: ${json.error}`);
  } else {
    account = json;
    ok(`the token authenticates — @${json.acct}${json.display_name ? ` (${json.display_name})` : ''}`);
    says(`account     : ${json.statuses_count} statuses · ${json.followers_count} followers · joined ${String(json.created_at).slice(0, 10)}`);
    says(`the handle a store would see: @${json.acct}${BASE.includes('mastodon.social') ? '' : `@${new URL(BASE).host}`}`);
  }
} catch (err) {
  bad(`the credential check could not run — ${err.message}`);
}

/*
 * The application's scopes. A token without `write` authenticates perfectly and cannot
 * post, which is the exact failure this check exists to catch before a live stream goes
 * unannounced.
 */
try {
  const { status, json } = await get('/api/v1/apps/verify_credentials');
  if (status === 200 && json) {
    const scopes = Array.isArray(json.scopes) ? json.scopes : [];
    says(`app         : ${json.name || '(unnamed)'} · scopes ${scopes.join(' ') || '(none reported)'}`);
    if (scopes.length && !scopes.includes('write')) {
      bad('this application has NO `write` scope — it can read but it cannot post an announcement');
    } else if (scopes.includes('write')) {
      ok('the application may post (it has `write`) — announcing is possible with this credential');
    }
  } else {
    says(`app scopes  : not readable with this token (${status}) — not a failure, just unknown`);
  }
} catch (err) {
  says(`app scopes  : not readable — ${err.message}`);
}

// ── 3. what an announcement would say, without posting anything ─────────────
if (flag('dry-run')) {
  const url = valueOf('url', 'https://<your-store-domain>/s/<store>/live');
  const store = valueOf('store', 'alice');
  /*
   * The shape, and why: a hook, what it is, where to go, and two or three tags — hashtags
   * are how a stranger finds a post, and the link is what turns a reader into a viewer. The
   * character count is shown against the INSTANCE's limit, because that number varies.
   */
  const text = [
    '🔴 LIVE now — ' + store + ' is streaming.',
    '',
    `${url}`,
    '',
    '#live #Nepal',
  ].join('\n');
  const limit = caps.maxCharacters;
  if (!limit) says('(the instance did not publish its character limit — the count below is just a count)');
  says('');
  says('the announcement this would post (NOTHING WAS POSTED — this script has no posting path):');
  says('');
  for (const line of text.split('\n')) says(`  │ ${line}`);
  says('');
  says(`length      : ${text.length} characters`
    + (limit ? ` (this instance allows ${limit}${text.length > limit ? ' — TOO LONG' : ''})` : ''));
  says(`media       : none — a link preview is what carries the image, and one video per post`
    + (caps.maxMedia ? ` (max ${caps.maxMedia} attachments here)` : ''));
  says(`visibility  : public is what federates; unlisted reaches followers without the public timeline`);
}

if (account) says('');
console.log(failures ? '\nmastodon check: FAILED\n' : '\nmastodon check: ok\n');
process.exit(failures ? 1 : 0);

function mb(bytes) {
  return typeof bytes === 'number' ? `${Math.round(bytes / 1024 / 1024)} MB` : '?';
}
