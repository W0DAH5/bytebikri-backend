/**
 * Storage layer — PostgreSQL.
 *
 * One implementation, not two. The in-memory version was replaced rather than
 * kept alongside: a second implementation behind the same interface is a
 * divergence waiting to happen, and the tests would have run against the copy
 * that production never executes.
 *
 * Files still go through a `storage` adapter (local disk now, the media API
 * later). Nothing outside this file knows where bytes live.
 */
import { randomUUID, randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { one, many, scalar, query, withTransaction, isUniqueViolation } from './db.js';
// What an active arrangement means, as SQL — see src/plus.js.
import {
  PLUS_SUBSCRIPTION_JOIN, PLATE_KEYS as PLUS_PLATE_KEYS, EFFECT_KEYS as PLUS_EFFECT_KEYS,
  RING_KEYS as PLUS_RING_KEYS, FRAME_KEYS as PLUS_FRAME_KEYS,
  giftCode,
} from './plus.js';

import { rentPeriod, annualRentNpr, rentWorking, RENT_TERMS } from './billing.js';

/**
 * The statuses that mean "invoiced and not yet collected".
 *
 * Exported and used by every money query, because the alternative — each query
 * spelling out its own list — is how `platformMoney` came to filter on 'unpaid'
 * and 'overdue', two statuses the CHECK constraint has never allowed. It matched
 * one real state and dropped every invoice a payer had claimed to have paid.
 */
export const OPEN_RENT_STATUSES = ['issued', 'submitted'];
// The assumed rate lives in policy, exactly once, and this file reads it rather
// than repeating it: the rent estimate, the seller's page and the operator's
// calibration page must all be arithmetic on the SAME assumption, or comparing
// them is meaningless.
import { POLICY } from './slots.js';
import { familyCase, AUDIT_FAMILIES } from './audit.js';
import { SEARCHABLE_ASSET_STATES } from './moderation.js';
// How long a held identity document lives, and the sizes that may come in. The
// rule lives in `kyc.js` because the seller's page prints the number: a promise
// about a week that is written twice is a promise that drifts.
import { HOLD_DAYS } from './kyc.js';
import { resolveAsk } from './adscale.js';
import { placementsFor, planFor } from './placement.js';
import { assetShape, measuredSeconds } from './media.js';
// The page model: what a read file is once you count its pages. Imported by the
// store because the planner has to be told a PAGE count and the count is a fact
// about the upload — see §13 and slice 6.
import { pagePlan, archiveIndexFor, isArchiveName } from './pages.js';
// The signal vocabulary, so a recorded kind is one the ladder understands. Pure
// module: no database, no clock of its own, imports nothing.
import { SIGNALS } from './blocked.js';
// Storefront themes: the curated palettes and the plan capability that gates them.
// Imported for the same reason `HOLD_DAYS` is — the seller's settings page prints
// the rule, so the rule lives once.
import { themeOf, canTheme } from './themes.js';
// The two doors onto a tier, what a join by watching costs, and what membership
// does to a member file. Pure module: importing it is importing the rules, not a
// second opinion about them.
import {
  doorsOf, adModeOf, attentionProgress, standingOf,
  JOIN_MODES, AD_MODES, doorFor, glyphOf,
} from './memberships.js';
// The video host, and the four things this file needs to know about: whether a
// driver is configured at all, how to put bytes there, how to tell a remote key
// from a local one, and how to delete one. `VIDEO_STORAGE.md` is the reasoning.
import {
  driverForKind, whyLocal, hostAccepts, upload as videoUpload, remove as videoRemove,
  isRemoteKey, remoteId, remoteProvider,
} from './video.js';
// `mediaKind` is the product's own answer to "what is this file", and the router
// above must use that answer rather than a second opinion about mime types.
import { mediaKind } from './media.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Grace after a subscription period ends: features stay on, nothing is deleted. */
const GRACE_DAYS = 30;
const UPLOAD_DIR = path.resolve(__dirname, '../.data/uploads');

export const now = () => new Date();
export const id = () => randomUUID();
export const orderCode = (n = 6) =>
  randomBytes(4).toString('base64url').slice(0, n).toUpperCase();

// ---------------------------------------------------------------------------
// File storage adapter — now with the media API behind it (VIDEO_STORAGE.md)
// ---------------------------------------------------------------------------
/**
 * Storage adapter.
 *
 * Two namespaces, because the files have opposite visibility. `private` keys
 * are gated content; they are only ever handed out through the download route
 * after an unlock is checked. `public` keys are covers and banners — the shop
 * window — and are served straight from /media with no token, which is the
 * point of a cover image.
 *
 * The namespace is part of the KEY, so a public route can never be coaxed into
 * reading private content: it checks the prefix before it touches the disk.
 *
 * ── AND THE ROUTER ON TOP OF IT ──────────────────────────────────────────────
 *
 * A third key namespace exists now: `filemoon/<providerId>`, for BYTES THAT ARE
 * NOT ON THIS DISK. The adapter is therefore not a pipe but a router with a
 * whitelist, and the whitelist is a privacy promise rather than a convenience
 * (VIDEO_STORAGE.md §2):
 *
 *   * `kyc` NEVER leaves. A person hands over an identity document on the
 *     promise that the copy is destroyed when the check is decided, and
 *     `destroyHeldDocument` is built on `remove` being a real unlink. A
 *     citizenship certificate at a video host would make that sentence false.
 *   * `public` NEVER leaves. Covers and banners are images, and they are the one
 *     thing we serve ourselves with no token — the point of a cover.
 *   * `private` leaves ONLY when the bytes are video and a driver is configured.
 *     Audio is playable by the same predicate and stays local until there is a
 *     fixture to prove it against; that is a decision, and it is written down.
 *
 * The rule is enforced here rather than at the call sites for the same reason the
 * KYC deletion has exactly one path: four call sites each remembering a policy is
 * four chances to forget one, and forgetting this one publishes somebody's
 * passport to a stranger's CDN.
 */
const KEY_RE = /^[a-z]+\/[0-9a-f-]{36}\.[a-z0-9]{1,5}$/i;

export const storage = {
  /**
   * Should these bytes go to the host?
   *
   * Exported so a test can assert the refusal directly instead of inferring it
   * from where a file happened to land. `mimeType` is optional because the
   * adapter's signature predates it: a caller that does not say what it is
   * sending gets the local disk, which is the safe answer and the old answer.
   *
   * Two questions, and the second one is the correction this round makes: IS a host
   * configured, and does that host take this KIND of media at all (`hostAccepts`,
   * VIDEO_STORAGE.md §10.5). The three providers are not three ways of doing one job —
   * Filemoon is for video, Telegra.ph takes images and cannot delete one, Catbox's terms forbid
   * being a service's CDN — so a kind the configured host does not declare stays here
   * rather than being sent somewhere it will not be served from.
   *
   * The whitelist above this line is unchanged and still absolute: `kyc` never leaves,
   * `public` never leaves, and neither does anything a viewer reads rather than plays
   * (a reader's archive is offset-addressed by our own reader).
   */
  routesToHost({ namespace = 'private', mimeType = '', filename = '', size = 0 } = {}) {
    if (namespace !== 'private') return false;
    const kind = mediaKind(mimeType, filename);
    return driverForKind(kind, process.env, { mimeType, filename, size }) !== 'local';
  },

  async put(buffer, filename, { namespace = 'private', mimeType = '' } = {}) {
    if (!/^[a-z]+$/.test(namespace)) throw new Error('bad storage namespace');
    // The SIZE is part of the routing decision now (a host's cap is not our cap), so it is
    // passed rather than defaulted — otherwise `routesToHost` would answer about a file it
    // was told nothing about.
    if (this.routesToHost({ namespace, mimeType, filename, size: buffer?.length ?? 0 })) {
      /*
       * WHICH host, decided HERE and passed in.
       *
       * The adapter used to resolve the provider itself from `VIDEO_DRIVER`, which was
       * right when there was one host and one variable. There are four hosts and three
       * variables now, and the answer depends on the KIND — an image and a video from the
       * same seller leave by different doors. Resolving it twice would let the two answers
       * drift; resolving it once, here, where the routing decision is already made, keeps
       * the key that comes back and the host that holds the bytes the same answer.
       */
      const kind = mediaKind(mimeType, filename);
      const file = { mimeType, filename, size: buffer?.length ?? 0 };
      const driver = driverForKind(kind, process.env, file);
      if (driver !== 'local') {
        /*
         * ── THE HOST SAID NO, SO THE UPLOAD STILL SUCCEEDS ────────────────────
         *
         * The pre-check below (`whyLocal`) covers the refusals a host publishes: a size cap,
         * a kind it does not take. It cannot cover the ones that happen at the wire — a
         * key that expired 30 days after its last use, a free plan that reads a
         * server upload as abuse, a host having a bad afternoon. Those used to THROW, which
         * meant a seller pressed Publish and got an error page: the platform was blocked by
         * a third party's mood, and the file, which was perfectly good, never landed.
         *
         * So a host failure is now the same shape as a host refusal: the bytes stay here, the
         * seller gets a file that works, and the reason is in the log rather than in a stack
         * trace nobody reads. The host is still tried first — this is a fallback, not a
         * policy — and nothing is silently retried at the host, so a refusal costs one call.
         *
         * The failure is NOT swallowed: it is the operator's signal that a driver is
         * misconfigured, and `warning` reaches the local branch's own log line below.
         */
        try {
          const { key } = await videoUpload(buffer, filename, { mimeType, provider: driver });
          return key;
        } catch (err) {
          const why = err?.message || String(err);
          console.warn(`  storage: ${driver} refused "${filename || kind}" — kept on our own disk instead: ${why}`);
        }
      }
      /*
       * THE HOST SAID NO TO THIS FILE, SO WE KEEP IT.
       *
       * Reached when a host is configured for the kind but would refuse this particular file
       * — a 6 MB photo for an image host with a 5 MB cap, a `.docx` for Catbox. The upload
       * succeeds on our own disk instead of failing, because a host's limit must not become
       * the product's: the seller gets a file that works and a page that opens it, and the
       * only difference is which disk the bytes are on. The reason is logged once, at the
       * moment it matters, rather than being discovered by a support question later.
       */
      const why = whyLocal(kind, process.env, file);
      if (why) console.warn(`  storage: kept ${filename || kind} on our own disk — ${why}`);
      // fall through to the local branch below
    }
    const ext = (path.extname(filename || '') || '').toLowerCase().replace(/[^.a-z0-9]/g, '');
    await fs.mkdir(path.join(UPLOAD_DIR, namespace), { recursive: true });
    const key = `${namespace}/${id()}${ext}`;
    await fs.writeFile(path.join(UPLOAD_DIR, key), buffer);
    return key;
  },

  /**
   * Keys reach here from a URL, so the shape is checked before the path is
   * built. Without this, `../../etc/passwd` is a valid key on a filesystem
   * join — and the check has to be an allowlist, not a scan for '..', because
   * a scan misses encodings and absolute paths.
   */
  async get(key) {
    if (isRemoteKey(key)) {
      // Not a disk read, and not a silent undefined: a caller that asks for these
      // bytes wants a redirect (the content routes do exactly that) and a caller
      // that does not is a bug worth seeing. The code is named so a route can
      // branch on it without matching on a sentence.
      const err = new Error('this file lives at the video host, not on this disk');
      err.code = 'EREMOTE';
      err.storageKey = key;
      throw err;
    }
    if (!KEY_RE.test(String(key || ''))) throw new Error('bad storage key');
    return fs.readFile(path.join(UPLOAD_DIR, key));
  },

  async exists(key) {
    // A remote key: we know it exists because we are holding its id, and asking
    // the host would spend a request to learn nothing. The DB row is the record.
    if (isRemoteKey(key)) return true;
    if (!KEY_RE.test(String(key || ''))) return false;
    try { await fs.access(path.join(UPLOAD_DIR, key)); return true; } catch { return false; }
  },

  /** Where the bytes are, from the key alone — the question a route must ask first. */
  isRemote: (key) => isRemoteKey(key),

  /** The provider's id inside a remote key, or null for anything on our disk. */
  remoteId,

  /**
   * WHICH host holds these bytes, from the key alone.
   *
   * A key carries its provider, so a delete or a redirect goes to the host that actually
   * has the file rather than to whatever `VIDEO_DRIVER` says today. Without this, changing
   * the driver would silently orphan every file the previous host was holding — playable
   * from nowhere, deletable from nowhere, and still on the bill.
   */
  remoteProvider,

  /**
   * Destroy a file, and say whether there was one.
   *
   * Added for the identity documents, and it is the point of them: the platform
   * promises that a copy handed over for a check stops existing when the check is
   * decided, and a promise about deletion has to be a call that unlinks the bytes.
   * A missing file is not an error — the answer is `false`, which is what "there
   * was nothing there" means, and the caller records the same outcome either way.
   */
  async remove(key) {
    if (isRemoteKey(key)) {
      const providerId = remoteId(key);
      if (!providerId) return false;
      // `remove` on the host side answers a 404 with a true — the file is not
      // there, which is what the caller asked for. A FAILURE, though, must not be
      // swallowed into `false` the way a missing local file is: the local `false`
      // means "there was nothing to delete", and a host failure means "it is still
      // there and we could not destroy it" — the one distinction a promise about
      // deletion rests on. So it propagates.
      return videoRemove(providerId, { provider: remoteProvider(key) });
    }
    if (!KEY_RE.test(String(key || ''))) return false;
    try { await fs.unlink(path.join(UPLOAD_DIR, key)); return true; } catch { return false; }
  },
};

// ---------------------------------------------------------------------------
// Plans. Capabilities are data — adding `ad_free` later is an INSERT, not a
// migration. Nothing here may gate the ability to EARN.
// ---------------------------------------------------------------------------
export const PLANS = {
  free: {
    code: 'free', name: 'Free', priceNpr: 0, periodMonths: 12,
    capabilities: {
      // Positions on a page is 1 for a free store and 2 for a paid one; the
      // platform's single row is not counted here. Density used to be the upsell
      // (3 / 5 / 8) and stopped being one in migration 0034.
      max_assets: 20, slot_count: 1, can_theme: false, custom_sections: 0,
      remove_footer: false, marketplace_listed: false, analytics_level: 'basic',
      verified_badge: false, featured_eligible: false, ad_free: false,
      // How much of the platform-wide ask promise this plan may use. The absolute
      // ceiling (3 ads, 60 s, 3 minutes total) is in adscale.js and no plan moves
      // it; these two keys only decide how far up the value ladder a store may go.
      ad_ask_max_ads: 1, ad_ask_max_seconds: 30,
      // Members are the paid relationship: a free store is watched (follows are
      // free forever), a paying store is belonged to. Same reasoning as the
      // marketplace line above — being found stays free, the relationship is
      // what the plan buys.
      memberships: false,
    },
  },
  store: {
    code: 'store', name: 'Store', priceNpr: 999, periodMonths: 12,
    capabilities: {
      max_assets: 200, slot_count: 2, can_theme: true, custom_sections: 3,
      // Explore listing, which is what the first paid tier buys. Featured
      // placement stays Pro-only — capacity and placement are the upsell, not
      // being found at all. See migration 0014.
      remove_footer: true, marketplace_listed: true, analytics_level: 'sources',
      verified_badge: true, featured_eligible: false, ad_free: false, memberships: true,
      ad_ask_max_ads: 2, ad_ask_max_seconds: 45,
    },
  },
  pro: {
    code: 'pro', name: 'Pro', priceNpr: 2499, periodMonths: 12,
    capabilities: {
      max_assets: -1, slot_count: 2, can_theme: true, custom_sections: -1,
      remove_footer: true, marketplace_listed: true, analytics_level: 'full',
      verified_badge: true, featured_eligible: true, memberships: true,
      // `ad_free` is the ONE capability that changes a page the way the platform
      // renders it: it releases the platform's own ad position (`slots.js`
      // `POLICY.releasedBy`) for this store's CURRENT members, and for nobody else.
      // Pro carries it; Store and Free do not, and the allocator checks the
      // capability before it ever looks at a membership row, so a Free store cannot
      // grant it with a tier. See REVENUE_ARCHITECTURE.md — "the one thing a plan
      // may do to our position" — for why the store pays rather than the member,
      // and for what it deliberately leaves alone.
      ad_free: true,
      ad_ask_max_ads: 3, ad_ask_max_seconds: 60,
    },
  },
};

/**
 * The next tier up, by price. Null when there is nothing above.
 *
 * The dashboard used to hand the seller `PLANS.pro` as "the plan that lifts your
 * limit" regardless of which plan they were on, so a Free store at 17 of 20 files
 * was told Pro raises it to unlimited — skipping over the tier that actually
 * solves the problem for NPR 999. The researched advice is one recommended plan
 * tied to the wall the person just hit, not the top of the price list.
 */
export function nextPlan(code) {
  const cur = PLANS[code] ?? PLANS.free;
  return Object.values(PLANS)
    .filter((p) => p.priceNpr > cur.priceNpr)
    .sort((a, b) => a.priceNpr - b.priceNpr)[0] ?? null;
}

/**
 * The positions that exist, in rank order. THREE, and that is the whole point.
 *
 * There were five, and Pro's plan could fill all of them while a free store got
 * three — the upsell was density, which is the worst thing to sell on a page whose
 * visitor is the product. As of migration 0034 a page carries at most three boxes:
 * the store's one or two (ranks 1 and 2) and the platform's single one, which is
 * taken from the rank immediately after the store's last.
 *
 * Rank 3 stays active because on a paid plan it is OURS — the last position on the
 * page, never the first, which is the consideration the rent buys. Ranks 4 and 5
 * are kept in this list, marked inactive, rather than deleted: their names are in
 * `slot_creatives` rows that sellers wrote, and a definition that vanishes makes
 * those rows unexplainable. `active: false` means allocateSlots cannot place them
 * and the dashboards do not offer them; the history stays readable.
 */
export const SLOT_DEFS = [
  { key: 'top_leaderboard', label: 'Top of store', rank: 1, formats: ['display'], max_height_px: 250, surfaces: ['web', 'app'], active: true },
  { key: 'in_content_1', label: 'In content (first)', rank: 2, formats: ['display', 'native'], max_height_px: 280, surfaces: ['web'], active: true },
  { key: 'sidebar_sticky', label: 'Sidebar', rank: 3, formats: ['display'], max_height_px: 600, surfaces: ['web'], active: true },
  { key: 'in_content_2', label: 'In content (second)', rank: 4, formats: ['display', 'native'], max_height_px: 280, surfaces: ['web'], active: false },
  { key: 'footer_native', label: 'Footer', rank: 5, formats: ['native', 'display'], max_height_px: 250, surfaces: ['web', 'app'], active: false },
];

// ---------------------------------------------------------------------------
// Row -> object mapping. The database is snake_case; so are the callers, so
// most rows pass through untouched. Only dates and numerics need coercing.
// ---------------------------------------------------------------------------
const pgNum = (v) => (v === null || v === undefined ? v : Number(v));

// Guards a uuid parameter before it reaches Postgres. A malformed id in a URL is
// attacker-controlled input, and letting the driver throw turns a 404 into a 500
// — which a webhook sender reads as "retry me".
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The access modes a seller can put a file on.
 *
 * `paid` is in the database's check constraint and deliberately NOT here: it is
 * reserved for a money path that does not exist yet, and offering it in a select
 * would be offering nothing. Two writers of this list have already drifted once —
 * the policy row was left behind when the asset row learned `breaks`, which is two
 * rows disagreeing about one decision, the exact thing the mode field exists to
 * prevent. One list, both writers.
 */
export const SELLER_MODES = ['open', 'ad_gated', 'members', 'breaks'];

/**
 * The own-look join, written once and used by every query that renders a person's
 * name to somebody else.
 *
 * It answers one question — is this person's ByteBikri Plus arrangement active
 * right now — and it answers it in SQL, from the row that already holds the
 * period end. Nothing is denormalised, nothing has to be swept, and a page that
 * forgets to check cannot exist: if the join is not there, `plus_active` is
 * undefined, and `plusWear()` refuses to dress anybody it cannot prove.
 */
// The subscription join lives with the module that owns its meaning, so the
// session resolver and this file cannot drift about what "active" means.
const PLUS_JOIN = PLUS_SUBSCRIPTION_JOIN;

// ===========================================================================
// Store
// ===========================================================================
export const store = {
  // A transaction handle, for the engine. Anything that must be atomic
  // composes through this rather than being spread across three methods that
  // each commit independently.
  withTransaction,
  query, one, many, scalar,

  // ---- users (profiles) --------------------------------------------------
  async createUser({ email, displayName }) {
    const normalized = String(email).trim().toLowerCase();
    const row = await one(
      `insert into profiles (email, display_name)
       values ($1, $2)
       on conflict (email) do update set email = excluded.email
       returning *`,
      [normalized, displayName || normalized.split('@')[0]],
    );
    return row;
  },
  async userByEmail(email) {
    return one('select * from profiles where email = $1', [String(email).trim().toLowerCase()]);
  },
  /**
   * A person, with whether their own look is currently worn.
   *
   * The lateral join is the whole entitlement check, done in the database rather
   * than remembered in a session: `plus_status` is null unless there is an ACTIVE
   * subscription whose period has not ended, so a profile row read at any moment
   * carries the truth about the look. Nothing has to expire a session, and a page
   * cannot show a lapsed member's palette by forgetting to ask.
   */
  async userById(userId) {
    return one(
      `select p.*,
              pl.plus_status,
              pl.plus_period_end,
              (pl.plus_status is not null) as plus_active
         from profiles p
         ${PLUS_JOIN}
        where p.id = $1`,
      [userId],
    );
  },
  /** Resolve-or-create. There is no signup flow yet, so first sight IS signup. */
  async userByEmailOrCreate(email) {
    const normalized = String(email).trim().toLowerCase();
    const existing = await one('select * from profiles where email = $1', [normalized]);
    if (existing) return existing;
    return this.createUser({ email: normalized });
  },

  // ---- channels ----------------------------------------------------------
  async createChannel({ ownerId, slug, name, tagline, listingMode = 'storefront', bannerUrl = null }) {
    try {
      return await one(
        `insert into channels (owner_id, slug, name, tagline, listing_mode, moderation_state, banner_url)
         values ($1, $2, $3, $4, $5, 'approved', $6)
         returning *`,
        [ownerId, slug, name, tagline || '', listingMode, bannerUrl],
      );
    } catch (err) {
      if (isUniqueViolation(err)) throw new Error('slug already taken');
      throw err;
    }
  },

  // Plan + subscription live in separate tables; every channel read joins them so
  // callers keep seeing one object.
  // ── seller verification ────────────────────────────────────────────────────
  // The outcome of a document check, never the document. See src/verification.js
  // for the model; these are only the reads and writes it needs.

  /** The newest check row about a store: what the seller is told, and the badge. */
  async verificationFor(channelId) {
    // The newest DECIDED row — what the badge is — and deliberately not the newest
    // row of any kind. A seller whose check is close to lapsing can ask for the
    // next one, and that request is a `pending` row; if this query returned it,
    // asking early would take the badge DOWN, so the platform would punish the
    // person for doing the thing it had just asked them to do. (The researched
    // rule for renewals is the same one: keep the mark while prompting.)
    //
    // The join is the same as `verificationsFor` on purpose. Without it the newest
    // row arrived with no name on it, and the operator's own decision from a minute
    // ago rendered as "a person no longer on the console" — a sentence that invents
    // an absence. One row, one shape, whoever reads it.
    return one(
      `select v.*, p.display_name as decided_by_name, p.email as decided_by_email,
              n.display_name as notice_by_name, n.email as notice_by_email
         from seller_verifications v
         left join profiles p on p.id = v.decided_by
         left join profiles n on n.id = v.notice_by
        where v.channel_id = $1 and v.status <> 'pending'
        order by v.created_at desc limit 1`,
      [channelId],
    );
  },

  /** The open request, if there is one. A separate fact from the standing outcome. */
  async pendingVerificationFor(channelId) {
    return one(
      `select * from seller_verifications where channel_id = $1 and status = 'pending'
        order by created_at desc limit 1`,
      [channelId],
    );
  },

  /** Every row about a store, newest first — the operator's record of who signed off. */
  async verificationsFor(channelId) {
    return many(
      `select v.*, p.display_name as decided_by_name, p.email as decided_by_email
         from seller_verifications v
         left join profiles p on p.id = v.decided_by
        where v.channel_id = $1
        order by v.created_at desc`,
      [channelId],
    );
  },

  /** Newest row per store, for a list of stores — one query, not one per row. */
  async verificationsForChannels(channelIds = []) {
    if (!channelIds.length) return new Map();
    // Decided rows only — this feeds the badge in Explore, and a store that has
    // asked for its next check has not stopped having the current one.
    const rows = await many(
      `select distinct on (channel_id) * from seller_verifications
        where channel_id = any($1::uuid[]) and status <> 'pending'
        order by channel_id, created_at desc`,
      [channelIds],
    );
    return new Map(rows.map((r) => [r.channel_id, r]));
  },

  /**
   * Checks that end inside the window — soonest first, so the list is worked in the
   * order the dates arrive.
   *
   * Includes the ones that have ALREADY lapsed, because an operator looking at a
   * store whose badge came down last week should be able to find it, and because
   * "the notice never went out" is a thing worth being able to see. Nothing sweeps
   * this: the window is recomputed on every read from `expires_at`.
   */
  async verificationsLapsing({ days = 60, includeLapsed = true } = {}) {
    return many(
      `select v.*, c.name as channel_name, c.slug as channel_slug,
              p.email as owner_email, p.display_name as owner_name,
              n.display_name as notice_by_name, n.email as notice_by_email
         from seller_verifications v
         join channels c on c.id = v.channel_id
         left join profiles p on p.id = c.owner_id
         left join profiles n on n.id = v.notice_by
        where v.status = 'verified'
          and v.expires_at is not null
          and v.expires_at <= now() + ($1 || ' days')::interval
          and ($2 or v.expires_at > now())
        order by v.expires_at asc`,
      [String(Number(days) || 60), Boolean(includeLapsed)],
    );
  },

  /** A person told the seller their check is ending. Recorded on the outcome itself. */
  async markVerificationNotice({ verificationId, actorId }) {
    return one(
      `update seller_verifications
          set notice_sent_at = now(), notice_by = $2
        where id = $1 and status = 'verified' and notice_sent_at is null
        returning *`,
      [verificationId, actorId],
    );
  },

  /**
   * Undo a notice claim, for the one case where claiming and sending come apart.
   *
   * The route claims the row first (so two operators cannot both send the same
   * message) and then sends. If nothing was written down at all — no mail provider
   * configured, or the insert failed — the claim is released, because a record
   * that says "told them" when nothing was recorded is worse than no record: the
   * next person to work the list would skip a seller nobody has contacted.
   */
  async releaseVerificationNotice(verificationId) {
    return one(
      `update seller_verifications set notice_sent_at = null, notice_by = null
        where id = $1 returning *`,
      [verificationId],
    );
  },

  /** Stores waiting for a person, oldest first: the order they should be worked. */
  async verificationQueue() {
    return many(
      `select v.*, c.name as channel_name, c.slug as channel_slug
         from seller_verifications v join channels c on c.id = v.channel_id
        where v.status = 'pending'
        order by v.created_at asc`,
    );
  },

  /**
   * The seller asks for a check. Logistics only in the note — never a document
   * number; the partial unique index turns a double click into one request.
   */
  async askForVerification({ channelId, note = null }) {
    const cleanNote = String(note || '').trim().slice(0, 280) || null;
    try {
      const row = await one(
        `insert into seller_verifications (channel_id, method, status, request_note)
         values ($1, 'manual', 'pending', $2)
         returning *`,
        [channelId, cleanNote],
      );
      return { ok: true, row };
    } catch (err) {
      if (isUniqueViolation(err)) return { ok: false, reason: 'You have already asked.' };
      throw err;
    }
  },

  /** Withdraw a request nobody has looked at yet. */
  async withdrawVerificationRequest(channelId) {
    // Destroy first, delete second. The request row is where a held document lives,
    // so the delete is the thing that would remove the only pointer to the bytes —
    // and a pointer nobody has is a file nobody can destroy. Withdrawal is one of
    // the three ways a document leaves; the other two are a decision and the sweep.
    await this.destroyHeldDocument(channelId, { reason: 'withdrawn' });
    const res = await query(
      `delete from seller_verifications where channel_id = $1 and status = 'pending'`,
      [channelId],
    );
    return { ok: res.rowCount > 0 };
  },

  // ---- the document a request may carry ----------------------------------
  /**
   * Take a copy in, for a request that is open.
   *
   * One per request, so handing over a second one REPLACES the first and destroys
   * it in the same call: "I sent the wrong page" must not leave the wrong page on
   * disk for the rest of the week. Refuses when there is no open request, because a
   * document with nothing to be checked against is a liability with no purpose.
   */
  async attachVerificationDocument({ channelId, key, mime, bytes, actorId = null }) {
    const open = await this.pendingVerificationFor(channelId);
    if (!open) return { ok: false, reason: 'no-request' };
    await this.destroyHeldDocument(channelId, { reason: 'replaced' });
    await query(
      `update seller_verifications
          set document_key = $2, document_mime = $3, document_bytes = $4,
              document_added_at = now(), document_destroyed_at = null
        where id = $1`,
      [open.id, key, mime, bytes],
    );
    // The seller's own id, passed in by the route: the pending row has no owner
    // column, and an audit line whose actor is null is a line that answers "when"
    // and not "who" — which is the half of the question this log exists for.
    await this.audit('seller.verification_document_handed',
      { channelId, mime, bytes, requestId: open.id },
      { actorId, subjectType: 'channel', subjectId: channelId });
    return { ok: true, requestId: open.id };
  },

  /**
   * The row a document belongs to, for the one route that can serve it.
   *
   * Looked up by the REQUEST's id, never by the storage key: a URL carrying a key
   * would be a URL that can be guessed at, logged, and shared, and the key is the
   * only thing standing between a citizen's certificate and the open internet.
   */
  verificationDocumentById(verificationId) {
    if (!UUID_RE.test(String(verificationId || ''))) return Promise.resolve(null);
    return one(
      `select v.id, v.channel_id, v.status, v.document_key, v.document_mime,
              v.document_bytes, v.document_added_at, c.slug as channel_slug, c.name as channel_name,
              (select count(*)::int from audit_logs l
                where l.action = 'seller.verification_document_opened'
                  and l.meta->>'requestId' = v.id::text) as opens
         from seller_verifications v
         join channels c on c.id = v.channel_id
        where v.id = $1`,
      [verificationId],
    );
  },

  /**
   * Destroy the copy this store is holding, and say which one went.
   *
   * The ONLY place the bytes are deleted, and every path that ends a hold goes
   * through it — a decision, a withdrawal, a replacement, and the sweep. That is
   * deliberate: four call sites each doing their own `storage.remove` is four
   * chances for one of them to forget, and the failure mode of forgetting is a
   * document sitting on disk after the platform told somebody it was destroyed.
   *
   * The audit line is written even when there was nothing to destroy, because
   * "we said we deleted it and here is the record" is the claim being made.
   */
  async destroyHeldDocument(channelId, { reason = 'decided', actorId = null } = {}) {
    const row = await one(
      `select id, document_key from seller_verifications
        where channel_id = $1 and document_key is not null
        order by document_added_at desc limit 1`,
      [channelId],
    );
    if (!row) return null;
    const removed = await storage.remove(row.document_key);
    await query(
      `update seller_verifications
          set document_key = null, document_mime = null, document_bytes = null,
              document_destroyed_at = now()
        where id = $1`,
      [row.id],
    );
    await this.audit('seller.verification_document_destroyed',
      { channelId, reason, requestId: row.id, removed },
      { actorId, subjectType: 'channel', subjectId: channelId });
    return { requestId: row.id, removed };
  },

  /**
   * The backstop: holds that have outlived their week.
   *
   * Called when either page that can show a document is opened — the seller's
   * settings and the operator's queue — so the sweep is a function of the pages
   * that need it rather than a job that has to exist, be deployed and be watched.
   * Running it twice is free (the second call matches nothing), which is what makes
   * that safe.
   *
   * An expired hold does NOT close the request. The person is still waiting, and
   * closing their request because a queue was slow would punish them for our week;
   * the page tells them the copy is gone and how to hand it over again.
   */
  async sweepVerificationDocuments({ days = HOLD_DAYS } = {}) {
    const stale = await many(
      `select channel_id from seller_verifications
        where document_key is not null
          and document_added_at < now() - ($1 || ' days')::interval`,
      [String(days)],
    );
    for (const row of stale) {
      await this.destroyHeldDocument(row.channel_id, { reason: 'expired' });
    }
    return stale.length;
  },

  /** How many times a person has opened the copy for this request. */
  documentOpens(requestId) {
    if (!UUID_RE.test(String(requestId || ''))) return Promise.resolve(0);
    return scalar(
      `select count(*)::int from audit_logs
        where action = 'seller.verification_document_opened' and meta->>'requestId' = $1`,
      [String(requestId)],
    );
  },

  /**
   * A person records what they saw: verified or rejected, with the method, who
   * decided, and when it stops counting. `expires_at` is read, not enforced — a
   * lapsed check needs no job to bring the badge down.
   */
  async recordVerification({
    channelId, outcome, method = 'manual', actorId = null, months = 24, note = null, seenAt = null,
  }) {
    const clean = String(note || '').trim().slice(0, 500) || null;
    // The window runs from when the document was SEEN, not from when the row was
    // typed up. `seenAt` exists for the ordinary case where an operator looks at a
    // document in person and records it afterwards — sometimes weeks afterwards —
    // and starting a fresh two years from the typing would quietly extend a check
    // that has already been running. (It also makes a backdated record possible at
    // all, which is what the demo state and the tests need: a check made 23 months
    // ago has one month left, whatever day somebody enters it.)
    const until = new Date(seenAt || Date.now());
    until.setMonth(until.getMonth() + Number(months));
    // The outcome is what ends the reason to hold a document, so the document is
    // destroyed HERE — inside the one function every decision goes through — rather
    // than in the route that happens to call it today. The timestamp travels onto
    // the outcome row, because the pending row (which is where the file lived) is
    // about to be deleted and the seller is shown when their copy stopped existing.
    const destroyed = await this.destroyHeldDocument(channelId, { reason: 'decided', actorId });
    const row = await one(
      `insert into seller_verifications
         (channel_id, method, status, decided_by, decided_at, verified_at, expires_at, notes,
          document_destroyed_at)
       values ($1, $2, $3, $4, now(), $5, $6, $7, $8)
       returning *`,
      [
        channelId, method, outcome, actorId,
        outcome === 'verified' ? (seenAt ? new Date(seenAt) : new Date()) : null,
        outcome === 'verified' ? until : null,
        clean,
        destroyed ? new Date() : null,
      ],
    );
    // A request that has just been answered is not still open.
    await query(`delete from seller_verifications where channel_id = $1 and status = 'pending'`, [channelId]);
    return row;
  },

  async channelBySlug(slug) {
    return one(
      `select c.*,
              coalesce(o.banned, false) as owner_banned,
              -- The owner's address, because a notice about their store has to reach
              -- them and this is the row everything else about the store is read from.
              o.email as owner_email,
              o.display_name as owner_name,
              coalesce(s.plan_code, 'free')           as plan_code,
              s.status                            as subscription_status,
              s.period_end                        as subscription_end,
              s.grace_until                       as subscription_grace
         from channels c
         left join profiles o on o.id = c.owner_id
         left join lateral (
           select sub.plan_code, sub.status, sub.period_end, sub.grace_until
             from subscriptions sub
            where sub.channel_id = c.id
              and sub.status in ('active','grace')
            order by sub.created_at desc limit 1
         ) s on true
        where c.slug = $1`,
      [slug],
    );
  },
  async channelById(cid) {
    return one(
      `select c.*,
              coalesce(s.plan_code, 'free') as plan_code,
              s.status as subscription_status,
              s.period_end as subscription_end,
              s.grace_until as subscription_grace
         from channels c
         left join lateral (
           select sub.plan_code, sub.status, sub.period_end, sub.grace_until
             from subscriptions sub
            where sub.channel_id = c.id
              and sub.status in ('active','grace')
            order by sub.created_at desc limit 1
         ) s on true
        where c.id = $1`,
      [cid],
    );
  },
  channels({ listedOnly = false } = {}) {
    return many(
      `select c.*,
              coalesce(s.plan_code, 'free') as plan_code,
              s.status as subscription_status,
              s.period_end as subscription_end,
              -- A banned seller's stores are not advertised anywhere. Read for
              -- the operator, invisible to the public.
              coalesce(o.banned, false) as owner_banned
         from channels c
         left join profiles o on o.id = c.owner_id
         left join lateral (
           select sub.plan_code, sub.status, sub.period_end
             from subscriptions sub
            where sub.channel_id = c.id
              and sub.status in ('active','grace')
            order by sub.created_at desc limit 1
         ) s on true
        -- Public reads see public states only. 'removed' and 'suspended' are the
        -- two states a visitor must not learn about, and the storefront route
        -- enforces the same rule for a store reached by its own address.
        where c.moderation_state not in ('removed', 'suspended')
          and coalesce(o.banned, false) = false
          ${listedOnly ? "and c.listing_mode = 'marketplace'" : ''}
        order by c.created_at`,
    );
  },
  // ---- people -------------------------------------------------------------
  /**
   * Ban or reinstate an ACCOUNT.
   *
   * This is the Android app's `banUser`, which it has called since its first
   * schema and which never existed on the server — the app was posting to
   * `/api/admin/ban-user` and getting a 404 while its admin screen showed a
   * "Ban User" button in red.
   *
   * Three writes, one transaction:
   *
   *   profiles.banned      the flag every public read already filters on
   *   sessions             revoked, so a live session cannot outlive the ban
   *   moderation_actions   the record: who decided, when, citing which rule
   *
   * Revoking the sessions is defence in depth rather than the control —
   * `auth.resolveSession` already refuses a banned account's token — but a
   * session row that still says "valid" is the kind of thing a later change
   * quietly starts trusting.
   */
  async setUserBanned({ userId, action, ruleCode = null, remedy = '', actorId = null }) {
    const banned = action === 'suspend';
    return withTransaction(async (client) => {
      const res = await client.query(
        'update profiles set banned = $2 where id = $1 returning id, email, display_name, banned',
        [userId, banned],
      );
      const user = res.rows[0] ?? null;
      await client.query(
        `insert into moderation_actions
           (subject_type, subject_id, action, rule_code, reason, actor_id, automated)
         values ('profile', $1, $2, $3, $4, $5, false)`,
        [userId, action, ruleCode, remedy ? String(remedy) : null, actorId],
      );
      if (banned) {
        await client.query(
          'update sessions set revoked_at = now() where user_id = $1 and revoked_at is null',
          [userId],
        );
      }
      return user;
    });
  },

  /** The accounts that are not in a normal state. */
  bannedUsers() {
    return many(
      `select p.id, p.email, p.display_name, p.role, p.banned, p.created_at,
              (select count(*)::int from channels c where c.owner_id = p.id) as stores,
              (select max(m.created_at) from moderation_actions m
                where m.subject_type = 'profile' and m.subject_id = p.id) as last_decision_at,
              (select m.rule_code from moderation_actions m
                where m.subject_type = 'profile' and m.subject_id = p.id
                order by m.created_at desc, m.id desc limit 1) as last_rule,
              (select m.action from moderation_actions m
                where m.subject_type = 'profile' and m.subject_id = p.id
                order by m.created_at desc, m.id desc limit 1) as last_action
         from profiles p
        where p.banned = true
        order by p.created_at desc
        limit 100`,
    );
  },

  /**
   * Find an account to act on.
   *
   * An operator is given a mailbox, not an id: the store page shows an email,
   * and asking somebody to copy a UUID out of the database is how a feature
   * stops being used. An exact match wins over a partial one.
   */
  usersMatching(q, limit = 25) {
    const term = String(q ?? '').trim();
    if (!term) return [];
    return many(
      `select p.id, p.email, p.display_name, p.banned, p.created_at,
              (select count(*)::int from channels c where c.owner_id = p.id) as stores
         from profiles p
        where p.email = $1 or p.email ilike '%' || $1 || '%' or p.display_name ilike '%' || $1 || '%'
        order by (p.email = $1) desc, p.created_at
        limit $2`,
      [term.toLowerCase(), limit],
    );
  },

  userModerationHistory(userId, limit = 20) {
    return many(
      `select m.*, r.title as rule_title
         from moderation_actions m
         left join policy_rules r on r.code = m.rule_code
        where m.subject_type = 'profile' and m.subject_id = $1
        order by m.created_at desc, m.id desc
        limit $2`,
      [userId, limit],
    );
  },

  /**
   * The plan surface: what each tier grants, who is on it, and who is about to
   * hit a wall.
   *
   * `plans` has existed since the first migration with a capabilities blob, and
   * the app has never read it — `store.plan()` resolves from the PLANS constant
   * in JS. That is a real trap: editing the table looks like it changes what the
   * platform enforces and changes nothing. So this query returns BOTH, and the
   * page shows the disagreement when there is one. A console that silently
   * agrees with the runtime is a console that cannot report the day they diverge.
   */
  plansOverview() {
    return withTransaction(async (c) => {
      const plans = await c.query(
        `select code, name, price_npr, period_months, capabilities, sort_order, active
           from plans order by sort_order, code`,
      );
      const mix = await c.query(
        `select coalesce(s.plan_code, 'free') as plan_code,
                count(*)::int as stores,
                count(*) filter (where s.status = 'active')::int as active,
                count(*) filter (where s.status = 'grace')::int as in_grace,
                count(*) filter (where s.status in ('expired','cancelled'))::int as lapsed
           from channels c
           left join subscriptions s on s.channel_id = c.id and s.status in ('active','grace','pending_payment')
          where c.moderation_state <> 'removed'
          group by 1 order by 2 desc`,
      );
      // What the plans bill this cycle, from the records rather than from
      // arithmetic on the price list: an invoice is money somebody was asked for.
      const money = await c.query(
        `select
           coalesce((select sum(amount_npr) from rent_invoices where status in ('issued','unpaid','overdue')), 0)::int as rent_outstanding,
           coalesce((select sum(amount_npr) from rent_invoices where status = 'paid'), 0)::int as rent_collected,
           coalesce((select sum(amount_npr) from plan_payments where status = 'matched'), 0)::int as upgrades_collected,
           coalesce((select sum(amount_npr) from plan_payments where status = 'pending'), 0)::int as upgrades_pending`,
      );
      return {
        plans: plans.rows,
        mix: mix.rows,
        money: money.rows[0],
      };
    });
  },

  /**
   * The stores closest to their plan's ceiling.
   *
   * Ordered by how full they are, not by size: a free store with 19 of 20 files
   * is a more urgent conversation than a pro store with 400 of unlimited, and it
   * is the one where the platform is about to start refusing somebody's work.
   *
   * The cap comes from the plans table, which is exactly the copy the runtime may
   * disagree with — so this list is a convenience, and the page labels it as
   * such. `planUsage` (JS) is what actually refuses an upload.
   */
  storesNearCap({ limit = 25 } = {}) {
    return many(
      `with live as (
         select c.id, c.slug, c.name, c.owner_id,
                coalesce(s.plan_code, 'free') as plan_code,
                (select count(*)::int from assets a where a.channel_id = c.id and a.status = 'live') as files
           from channels c
           left join subscriptions s on s.channel_id = c.id and s.status in ('active','grace')
          where c.moderation_state <> 'removed'
       )
       select l.*, p.name as plan_name, (p.capabilities ->> 'max_assets')::int as cap,
              u.email as owner_email,
              round(100.0 * l.files / nullif((p.capabilities ->> 'max_assets')::int, 0))::int as pct_full
         from live l
         join plans p on p.code = l.plan_code
         left join profiles u on u.id = l.owner_id
        where (p.capabilities ->> 'max_assets')::int <> -1
          and l.files >= floor((p.capabilities ->> 'max_assets')::int * 0.6)
        order by pct_full desc, l.files desc
        limit $1`,
      [limit],
    );
  },

  /**
   * Everyone with an account — built around the four decisions that need people.
   *
   * `bannedUsers` and `usersMatching` could only answer "who is suspended" and
   * "who is this exact person". The questions an operator actually has are staged
   * ones: who signed up and never opened a store, who opened one and never
   * published, who published and never got an unlock. Those three are the funnel,
   * and they were invisible.
   *
   * The segment is computed in SQL rather than in the view so that filtering and
   * counting use the same definition. A CASE in JS would be a second, silently
   * different answer to the same question — the tabs would say twelve and the
   * filtered query would return eleven.
   *
   * Suspended and operator come FIRST in the CASE: they are states that overlay a
   * shape, and an operator looking for the suspension queue should not have to
   * find it inside "files, no unlocks".
   */
  peopleDirectory({ segment = 'all', q = '', sort = 'recent', page = 1, perPage = 25 } = {}) {
    const SEGMENT = `case
      when p.banned then 'suspended'
      when p.role <> 'user' then 'operator'
      when coalesce(st.stores, 0) = 0 then 'no_store'
      when coalesce(st.files, 0) = 0 then 'store_no_files'
      when coalesce(st.unlocks, 0) = 0 then 'files_no_unlocks'
      else 'working' end`;
    // One lateral per person, so the counts are per-person and cannot multiply
    // each other the way four independent joins in one FROM would.
    const STATS = `left join lateral (
        select
          (select count(*)::int from channels c where c.owner_id = p.id and c.moderation_state <> 'removed') as stores,
          (select count(*)::int from assets a
             join channels c on c.id = a.channel_id
            where c.owner_id = p.id and a.status = 'live') as files,
          (select coalesce(sum(v.views), 0)::int from page_view_daily v
             join channels c on c.id = v.channel_id
            where c.owner_id = p.id and v.day > current_date - 30) as views_30d,
          (select count(*)::int from unlocks u
             join assets a on a.id = u.asset_id
             join channels c on c.id = a.channel_id
            where c.owner_id = p.id and u.revoked_at is null) as unlocks
      ) st on true`;
    const LIVE = `s.last_seen_at is not null and s.last_seen_at > now() - interval '30 days'`;
    // The session summary is a lateral, and it must be joined by every query that
    // mentions `s` — the counts query did not, and Postgres said so with
    // "missing FROM-clause entry for table s" rather than counting zero and
    // quietly reporting that nobody had been seen. Shared here so the next query
    // to need it cannot forget.
    const SESSIONS = `left join lateral (
        select max(x.last_seen_at) as last_seen_at,
               count(*) filter (where x.revoked_at is null and x.expires_at > now())::int as live_sessions
          from sessions x where x.user_id = p.id
      ) s on true`;

    const where = [];
    const params = [];
    const bind = (value) => { params.push(value); return `$${params.length}`; };

    if (segment && segment !== 'all') where.push(`${SEGMENT} = ${bind(segment)}`);
    if (String(q).trim().length >= 2) {
      const term = `%${String(q).trim().toLowerCase()}%`;
      const a = bind(term);
      where.push(`(lower(p.email) like ${a} or lower(coalesce(p.display_name, '')) like ${a})`);
    }
    const clause = where.length ? `where ${where.join(' and ')}` : '';

    const ORDER = {
      recent: 'p.created_at desc',
      active: 's.last_seen_at desc nulls last',
      views: 'coalesce(st.views_30d, 0) desc',
      unlocks: 'coalesce(st.unlocks, 0) desc',
      name: 'lower(coalesce(p.display_name, p.email)) asc',
    };
    const order = ORDER[sort] || ORDER.recent;

    const size = Math.min(Math.max(Number(perPage) || 25, 1), 100);
    const pages = Math.max(Number(page) || 1, 1);

    return withTransaction(async (c) => {
      const rows = await c.query(
        `select p.id, p.email, p.display_name, p.role, p.banned, p.created_at, p.locale,
                (p.password_hash is not null) as has_password,
                (p.legal_name is not null) as sold_by_on_file,
                coalesce(st.stores, 0) as stores,
                coalesce(st.files, 0) as files,
                coalesce(st.views_30d, 0) as views_30d,
                coalesce(st.unlocks, 0) as unlocks,
                s.last_seen_at,
                coalesce(s.live_sessions, 0) as live_sessions,
                coalesce(fl.failed_7d, 0) as failed_7d,
                ${SEGMENT} as segment
           from profiles p
           ${STATS}
           ${SESSIONS}
           left join lateral (
             select count(*)::int as failed_7d
               from login_attempts l
              where l.email = p.email and l.succeeded = false
                and l.created_at > now() - interval '7 days'
           ) fl on true
           ${clause}
          order by ${order}
          limit ${size} offset ${(pages - 1) * size}`,
        params,
      );

      const total = await c.query(`select count(*)::int as n from profiles p ${STATS} ${clause}`, params);
      // Counted over every account, never over the filtered set: a tab that says
      // "3" and then shows nothing because a search is also active is a lie about
      // the platform, not about the search.
      const counts = await c.query(
        `select ${SEGMENT} as segment, count(*)::int as n, count(*) filter (where ${LIVE})::int as live
           from profiles p ${STATS} ${SESSIONS}
          group by 1`,
      );

      return {
        rows: rows.rows,
        total: total.rows[0].n,
        counts: Object.fromEntries(counts.rows.map((r) => [r.segment, { n: r.n, live: r.live }])),
        page: pages,
        pages: Math.max(Math.ceil(total.rows[0].n / size), 1),
        perPage: size,
      };
    });
  },

  /**
   * One account, in the detail the directory deliberately leaves out.
   *
   * What is NOT here is a design decision: the files this person unlocked as a
   * BUYER are counted, never listed. What a person reads is theirs, and an
   * operator page that lists it turns a support tool into a surveillance log the
   * platform would then have to defend. The seller may not track a buyer, and the
   * operator does not need to either — a count answers every question moderation
   * actually asks.
   */
  personDetail(userId) {
    // Read-only, so no transaction: five independent reads through the pool run
    // concurrently, whereas `Promise.all` over one transaction client is a
    // deprecated pg pattern (a single connection cannot execute five queries at
    // once) that would also serialise them anyway.
    return (async () => {
      const person = await one(
        `select p.id, p.email, p.display_name, p.role, p.banned, p.ban_reason, p.locale, p.created_at,
                (p.password_hash is not null) as has_password,
                (p.legal_name is not null) as sold_by_on_file,
                p.phone is not null as phone_on_file
           from profiles p where p.id = $1`,
        [userId],
      );
      if (!person) return null;
      const [stores, sessions, attempts, decisions, unlocks] = await Promise.all([
        many(
          `select c.id, c.slug, c.name, c.moderation_state, c.listing_mode, c.created_at,
                  (select count(*)::int from assets a where a.channel_id = c.id and a.status = 'live') as files,
                  (select coalesce(sum(v.views), 0)::int from page_view_daily v
                    where v.channel_id = c.id and v.day > current_date - 30) as views_30d
             from channels c where c.owner_id = $1 order by c.created_at`,
          [userId],
        ),
        one(
          `select count(*)::int as total,
                  count(*) filter (where revoked_at is null and expires_at > now())::int as live,
                  max(last_seen_at) as last_seen,
                  min(created_at) as first_seen
             from sessions where user_id = $1`,
          [userId],
        ),
        one(
          `select count(*) filter (where succeeded = false and created_at > now() - interval '7 days')::int as failed_7d,
                  count(*) filter (where succeeded = true and created_at > now() - interval '30 days')::int as ok_30d
             from login_attempts where email = $1`,
          [person.email],
        ),
        many(
          `select m.id, m.action, m.rule_code, m.reason, m.created_at, r.title as rule_title
             from moderation_actions m
             left join policy_rules r on r.code = m.rule_code
            where m.subject_type = 'profile' and m.subject_id = $1
            order by m.created_at desc, m.id desc limit 20`,
          [userId],
        ),
        one(
          `select count(*)::int as held from unlocks u where u.user_id = $1 and u.revoked_at is null`,
          [userId],
        ),
      ]);
      return {
        person, stores, sessions, attempts, decisions, unlocksHeld: unlocks.held,
      };
    })();
  },

  // ---- moderation ---------------------------------------------------------
  /**
   * The rules a decision can cite. Read from the table, never from a constant in
   * JS: the policy table is the one place the codes and their wording live, and
   * `test/moderation.test.js` fails if this file's vocabulary and the schema's
   * CHECK constraints ever drift apart.
   */
  policyRules() {
    return many(
      `select code, title, description, default_state, severity, scope, country_code
         from policy_rules where active = true
        order by severity desc, code`,
    );
  },
  policyRule(code) {
    return one('select code, title, description, default_state, severity from policy_rules where code = $1 and active = true', [String(code ?? '')]);
  },

  /**
   * Change a store's moderation state, and record who did it and why.
   *
   * Both writes are in ONE transaction. A state change with no `moderation_actions`
   * row is a store that vanished with no explanation, and an action row with no
   * state change is a queue that lies about what it did.
   */
  async setChannelModeration({ channelId, action, state = null, ruleCode = null, remedy = '', actorId = null, automated = false }) {
    return withTransaction(async (client) => {
      const res = await client.query(
        `update channels
            set moderation_state = coalesce($2, moderation_state),
                moderation_reason = $3,
                updated_at = now()
          where id = $1
          returning *`,
        [channelId, state, ruleCode],
      );
      const channel = res.rows[0] ?? null;
      await client.query(
        `insert into moderation_actions
           (subject_type, subject_id, action, rule_code, reason, actor_id, automated)
         values ('channel', $1, $2, $3, $4, $5, $6)`,
        [channelId, action, ruleCode, remedy ? String(remedy) : null, actorId, Boolean(automated)],
      );
      return channel;
    });
  },

  /** The newest decision about a store, with the rule it cited. */
  latestModerationAction(channelId) {
    return one(
      `select m.*, r.title as rule_title, r.description as rule_description
         from moderation_actions m
         left join policy_rules r on r.code = m.rule_code
        where m.subject_type = 'channel' and m.subject_id = $1
        order by m.created_at desc, m.id desc
        limit 1`,
      [channelId],
    );
  },

  // ── files, and the countries they are for ────────────────────────────────
  //
  // Everything below serves one sentence: a file may be listed everywhere and
  // unlockable in four countries. The reads are written for the PUBLIC path
  // (one query per page, never one per file), and every write is paired with a
  // `moderation_actions` row in the same transaction — a file that stopped being
  // available in a country with nobody recorded as deciding it is
  // indistinguishable from a bug in the read path.

  /**
   * The country decisions for a set of files, in one query.
   *
   * Takes an array because the storefront is a grid: a query per card is how a
   * front page becomes forty round trips, and the join to `content_geo_blocks`
   * is what carries the RULE the decision cited, so the visitor can be told why
   * without a second lookup.
   */
  countryRulesFor(assetIds = [], country = null) {
    if (!assetIds.length || !country) return many('select null::uuid as asset_id where false');
    return many(
      `select r.asset_id, r.country_code, r.state, r.reason, r.source, r.set_by, r.updated_at,
              g.rule_code
         from asset_country_rules r
         left join content_geo_blocks g
           on g.subject_type = 'asset' and g.subject_id = r.asset_id
          and g.country_code = r.country_code
        where r.asset_id = any($1::uuid[]) and r.country_code = $2`,
      [assetIds, String(country)],
    );
  },

  /** Every country rule on one file, with the rule's title, for the owner and the operator. */
  assetCountryRules(assetId) {
    return many(
      `select r.*, g.rule_code, p.title as rule_title, p.description as rule_description,
              pr.display_name as set_by_name, pr.email as set_by_email
         from asset_country_rules r
         left join content_geo_blocks g
           on g.subject_type = 'asset' and g.subject_id = r.asset_id
          and g.country_code = r.country_code
         left join policy_rules p on p.code = g.rule_code
         left join profiles pr on pr.id = r.set_by
        where r.asset_id = $1
        order by r.country_code`,
      [assetId],
    );
  },

  /** A store-wide country block, for one visitor's country. */
  channelCountryBlock(channelId, country = null) {
    if (!country) return Promise.resolve(null);
    return one(
      `select * from content_geo_blocks
        where subject_type = 'channel' and subject_id = $1 and country_code = $2`,
      [channelId, String(country)],
    );
  },

  /** The same, for a page that lists stores. */
  channelCountryBlocks(channelIds = [], country = null) {
    if (!channelIds.length || !country) return many('select null::uuid as subject_id where false');
    return many(
      `select subject_id, country_code, rule_code, created_at
         from content_geo_blocks
        where subject_type = 'channel' and subject_id = any($1::uuid[]) and country_code = $2`,
      [channelIds, String(country)],
    );
  },

  /** Every store-level country block, with the rule it cites, for the console. */
  storeCountryBlocks() {
    return many(
      `select g.subject_id, g.country_code, g.rule_code, g.created_at,
              c.slug, c.name, p.title as rule_title
         from content_geo_blocks g
         join channels c on c.id = g.subject_id
         left join policy_rules p on p.code = g.rule_code
        where g.subject_type = 'channel'
        order by c.name, g.country_code`,
    );
  },

  /** Every country where something is currently blocked or restricted. */
  /**
   * Everywhere a country rule is in force, counted by **who** made it.
   *
   * The split is the point. "1 file blocked in Nepal" reads to an operator as a
   * platform rule in force, and a creator's own withholding is not that — one of
   * the two is ours to answer for and the other is theirs. The index alone cannot
   * tell them apart (`content_geo_blocks` records what and where, not who), so
   * this reads the rule table, which carries `source`, and the channel blocks,
   * which are always an operator's.
   */
  countrySummary() {
    return many(
      `select country_code,
              count(*) filter (where kind = 'asset' and state = 'blocked'    and source = 'operator')::int as blocked_files_operator,
              count(*) filter (where kind = 'asset' and state = 'blocked'    and source = 'creator')::int  as blocked_files_creator,
              count(*) filter (where kind = 'asset' and state = 'restricted' and source = 'operator')::int as restricted_files_operator,
              count(*) filter (where kind = 'asset' and state = 'restricted' and source = 'creator')::int  as restricted_files_creator,
              count(*) filter (where kind = 'channel')::int as blocked_stores,
              count(*) filter (where kind = 'asset' and state = 'blocked')::int as blocked_files
         from (
           select country_code, 'asset' as kind, state, source from asset_country_rules
           union all
           select country_code, 'channel', 'blocked', 'operator'
             from content_geo_blocks where subject_type = 'channel'
         ) t
        group by country_code
        order by country_code`,
    );
  },

  /**
   * Files an operator may need to look at: not in the default state, OR carrying
   * a country rule while their state is fine.
   *
   * The second half is the reason this queue exists at all. A file blocked in two
   * countries is `approved` — the state column says nothing is wrong with it —
   * and before this queue a country decision was invisible to everyone except the
   * person who made it.
   */
  filesNeedingModeration() {
    return many(
      `select a.id, a.title, a.slug, a.status, a.moderation_state,
              a.created_at, a.updated_at,
              c.id as channel_id, c.slug as channel_slug, c.name as channel_name,
              p.display_name as owner_name, p.email as owner_email,
              (select count(*)::int from asset_country_rules r where r.asset_id = a.id) as country_rules,
              (select string_agg(r.country_code || ' ' || r.state, ', ' order by r.country_code)
                 from asset_country_rules r where r.asset_id = a.id) as country_summary,
              m.created_at as decided_at
         from assets a
         join channels c on c.id = a.channel_id
         left join profiles p on p.id = c.owner_id
         left join lateral (
           select created_at from moderation_actions ma
            where ma.subject_type = 'asset' and ma.subject_id = a.id
            order by ma.created_at desc, ma.id desc limit 1
         ) m on true
        where a.moderation_state <> 'approved'
           or exists (select 1 from asset_country_rules r where r.asset_id = a.id)
        order by case a.moderation_state
                   when 'removed' then 1 when 'restricted' then 2 else 3 end,
                 coalesce(m.created_at, a.created_at) desc`,
    );
  },

  /** One file, its store, its country rules and its decision history. */
  fileModerationDetail(assetId) {
    return one(
      `select a.*, c.slug as channel_slug, c.name as channel_name, c.moderation_state as channel_state,
              c.owner_id, p.display_name as owner_name, p.email as owner_email
         from assets a
         join channels c on c.id = a.channel_id
         left join profiles p on p.id = c.owner_id
        where a.id = $1`,
      [assetId],
    );
  },

  /** Every decision ever recorded about one file, newest first, with its rule. */
  fileDecisionHistory(assetId) {
    return many(
      `select m.*, r.title as rule_title,
              coalesce(p.display_name, p.email) as actor_name
         from moderation_actions m
         left join policy_rules r on r.code = m.rule_code
         left join profiles p on p.id = m.actor_id
        where m.subject_type = 'asset' and m.subject_id = $1
        order by m.created_at desc, m.id desc
        limit 50`,
      [assetId],
    );
  },

  /**
   * Change a file's own state, and record who did it and why.
   *
   * One transaction for the same reason the store version has one: a file that
   * stopped being listed with no `moderation_actions` row is a file whose owner
   * has nothing to appeal.
   */
  async setAssetModeration({ assetId, action, state = null, ruleCode = null, remedy = '', actorId = null }) {
    return withTransaction(async (client) => {
      // No reason column on `assets`, deliberately: the reason for a file is its
      // newest decision row, which carries the rule code and the person. A
      // column would be a second copy of that, and the copy is what goes stale.
      const res = await client.query(
        `update assets
            set moderation_state = coalesce($2, moderation_state),
                updated_at = now()
          where id = $1
          returning *`,
        [assetId, state],
      );
      const asset = res.rows[0] ?? null;
      await client.query(
        `insert into moderation_actions
           (subject_type, subject_id, action, rule_code, reason, actor_id)
         values ('asset', $1, $2, $3, $4, $5)`,
        [assetId, action, ruleCode, remedy ? String(remedy) : null, actorId],
      );
      return asset;
    });
  },

  /**
   * Set what one file may be seen as, in one country.
   *
   * Three writes and one promise. The rule row is the decision; the
   * `content_geo_blocks` row is the index the public path and the country summary
   * read — written for a block and deleted for anything else, so "blocked"
   * cannot linger in the index after somebody allowed the country again; and the
   * `moderation_actions` row is the record, carrying the country and the rule.
   *
   * `source` is not inferred from who is calling. A creator limiting their own
   * file and an operator citing a rule produce different sentences to a visitor
   * and different HTTP status codes (403 and 451), and a field that has to be
   * guessed from a session is a field that will be guessed wrong.
   */
  async setAssetCountryRule({ assetId, countryCode, state, ruleCode = null, note = null, source = 'operator', actorId = null }) {
    const country = String(countryCode).toUpperCase();
    return withTransaction(async (client) => {
      const res = await client.query(
        `insert into asset_country_rules (asset_id, country_code, state, reason, source, set_by, updated_at)
         values ($1, $2, $3, $4, $5, $6, now())
         on conflict (asset_id, country_code) do update
            set state = excluded.state,
                reason = excluded.reason,
                source = excluded.source,
                set_by = excluded.set_by,
                updated_at = now()
          returning *`,
        [assetId, country, state, note ? String(note) : null, source, actorId],
      );

      if (state === 'blocked') {
        await client.query(
          `insert into content_geo_blocks (subject_type, subject_id, country_code, rule_code)
           values ('asset', $1, $2, $3)
           on conflict (subject_type, subject_id, country_code)
           do update set rule_code = excluded.rule_code`,
          [assetId, country, ruleCode],
        );
      } else {
        await client.query(
          `delete from content_geo_blocks
            where subject_type = 'asset' and subject_id = $1 and country_code = $2`,
          [assetId, country],
        );
      }

      // A country decision is logged with the same verbs as any other: blocking
      // or limiting is `restrict`, allowing is `approve`. `approve` deliberately
      // carries no rule code — clearing a restriction is not itself a rule.
      await client.query(
        `insert into moderation_actions
           (subject_type, subject_id, action, rule_code, country_code, reason, actor_id)
         values ('asset', $1, $2, $3, $4, $5, $6)`,
        [
          assetId,
          state === 'allowed' ? 'approve' : 'restrict',
          state === 'allowed' ? null : ruleCode,
          country,
          note ? String(note) : null,
          actorId,
        ],
      );
      return res.rows[0] ?? null;
    });
  },

  /** Remove a country rule, and stand the index down with it. */
  async clearAssetCountryRule({ assetId, countryCode, actorId = null }) {
    const country = String(countryCode).toUpperCase();
    return withTransaction(async (client) => {
      const res = await client.query(
        'delete from asset_country_rules where asset_id = $1 and country_code = $2 returning id',
        [assetId, country],
      );
      await client.query(
        `delete from content_geo_blocks
          where subject_type = 'asset' and subject_id = $1 and country_code = $2`,
        [assetId, country],
      );
      if (res.rowCount) {
        await client.query(
          `insert into moderation_actions
             (subject_type, subject_id, action, country_code, actor_id)
           values ('asset', $1, 'approve', $2, $3)`,
          [assetId, country, actorId],
        );
      }
      return res.rowCount;
    });
  },

  /**
   * Block or unblock a whole store in one country.
   *
   * This is the row `content_geo_blocks.subject_type = 'channel'` exists for: a
   * rule about a shop's contents reaches every file in it without a row per file,
   * and an operator can still carve one file back out with an asset rule, because
   * the asset decision is the more specific one.
   */
  async setChannelCountryBlock({ channelId, countryCode, ruleCode, remedy = '', actorId = null }) {
    const country = String(countryCode).toUpperCase();
    return withTransaction(async (client) => {
      const res = await client.query(
        `insert into content_geo_blocks (subject_type, subject_id, country_code, rule_code)
         values ('channel', $1, $2, $3)
         on conflict (subject_type, subject_id, country_code)
         do update set rule_code = excluded.rule_code
         returning *`,
        [channelId, country, ruleCode],
      );
      await client.query(
        `insert into moderation_actions
           (subject_type, subject_id, action, rule_code, country_code, reason, actor_id)
         values ('channel', $1, 'restrict', $2, $3, $4, $5)`,
        [channelId, ruleCode, country, remedy ? String(remedy) : null, actorId],
      );
      return res.rows[0] ?? null;
    });
  },

  async clearChannelCountryBlock({ channelId, countryCode, actorId = null }) {
    const country = String(countryCode).toUpperCase();
    return withTransaction(async (client) => {
      const res = await client.query(
        `delete from content_geo_blocks
          where subject_type = 'channel' and subject_id = $1 and country_code = $2`,
        [channelId, country],
      );
      if (res.rowCount) {
        await client.query(
          `insert into moderation_actions
             (subject_type, subject_id, action, country_code, actor_id)
           values ('channel', $1, 'approve', $2, $3)`,
          [channelId, country, actorId],
        );
      }
      return res.rowCount;
    });
  },

  moderationHistory(channelId, limit = 20) {
    return many(
      `select m.*, r.title as rule_title, p.display_name as actor_name
         from moderation_actions m
         left join policy_rules r on r.code = m.rule_code
         left join profiles p on p.id = m.actor_id
        where m.subject_type = 'channel' and m.subject_id = $1
        order by m.created_at desc, m.id desc
        limit $2`,
      [channelId, limit],
    );
  },

  // ---- reports ------------------------------------------------------------
  /**
   * File a report. Idempotent per person per file, by the unique index.
   *
   * Returns the state of the file's queue AFTER the attempt, so the route can say
   * something true: `filed: false` means this person had already reported it, and
   * the count is the same either way because a second report is not a vote.
   */
  async fileReport({ assetId, channelId, reporterId, reason, note = '' }) {
    let filed = true;
    try {
      await query(
        `insert into asset_reports (asset_id, channel_id, reporter_id, reason, note)
         values ($1, $2, $3, $4, $5)`,
        [assetId, channelId, reporterId, reason, note || null],
      );
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      filed = false;
    }
    const verdict = await this.reportVerdictFor(assetId);
    return { filed, ...verdict };
  },

  reportVerdictFor(assetId) {
    return one(
      `select count(distinct reporter_id)::int as reporters,
              jsonb_object_agg(reason, c) as by_reason,
              max(created_at) as latest
         from (select reporter_id, reason, created_at, count(*) over (partition by reason) as c
                 from asset_reports where asset_id = $1 and status = 'open') t`,
      [assetId],
    ).then((r) => ({
      reporters: r?.reporters ?? 0,
      byReason: Object.fromEntries(Object.entries(r?.by_reason || {}).map(([k, v]) => [k, Number(v)])),
      latest: r?.latest ?? null,
    }));
  },

  /** Has this person already reported this file? */
  hasReported(assetId, reporterId) {
    return scalar(
      'select count(*)::int from asset_reports where asset_id = $1 and reporter_id = $2',
      [assetId, reporterId],
    ).then((v) => Number(v) > 0);
  },

  /**
   * The operator queue: one row per FILE, not per report.
   *
   * "Deduplication so moderators don't see the same report dozens of times." A
   * file with four reports is one decision, and the operators' time is the
   * scarcest thing in this system.
   */
  openReports() {
    return many(
      `select a.id as asset_id, a.title, a.slug as asset_slug, a.status as asset_status,
              c.id as channel_id, c.slug as channel_slug, c.name as channel_name,
              count(distinct r.reporter_id)::int as reporters,
              jsonb_object_agg(r.reason, r2.n) as by_reason,
              max(r.created_at) as latest,
              min(r.created_at) as first_at,
              count(*) filter (where r.note is not null)::int as with_notes
         from asset_reports r
         join assets a   on a.id = r.asset_id
         join channels c on c.id = r.channel_id
         -- How many reports of THIS reason, so the operator page can rank them
         -- without a second query per row.
         join lateral (select count(*) as n from asset_reports x
                        where x.asset_id = r.asset_id and x.reason = r.reason and x.status = 'open') r2 on true
        where r.status = 'open'
        group by a.id, a.title, a.slug, a.status, c.id, c.slug, c.name
        order by max(r.created_at) desc`,
    ).then((rows) => rows.map((r) => ({
      ...r,
      byReason: Object.fromEntries(Object.entries(r.by_reason || {}).map(([k, v]) => [k, Number(v)])),
    })));
  },

  /**
   * The case against a file, as its SELLER may see it.
   *
   * The count and the rule codes, never a reporter and never a note. The operator's
   * queue has the same rule for the same reason: a queue that names complainants
   * is a harassment tool, and handing those names to the person being complained
   * about is worse. `reporterMessage` on the seller's side says three people
   * reported it; it does not say who, and cannot be made to.
   */
  fileCase(assetId) {
    return one(
      `select count(distinct reporter_id)::int as reporters,
              array(select distinct reason from asset_reports
                     where asset_id = $1 and status = 'open') as reasons,
              min(created_at) as first_at,
              max(created_at) as latest_at
         from asset_reports where asset_id = $1 and status = 'open'`,
      [assetId],
    ).then((r) => ({
      reporters: r?.reporters ?? 0,
      reasons: r?.reasons ?? [],
      firstAt: r?.first_at ?? null,
      latestAt: r?.latest_at ?? null,
    }));
  },

  /** This seller's appeals, newest first — their history of asking. */
  appealsOfChannel(channelId) {
    return many(
      `select ap.*, a.title as asset_title, a.slug as asset_slug, a.status as asset_status,
              p.display_name as decided_by_name, p.email as decided_by_email
         from asset_appeals ap
         join assets a on a.id = ap.asset_id
         left join profiles p on p.id = ap.decided_by
        where ap.channel_id = $1
        order by ap.created_at desc`,
      [channelId],
    );
  },

  openAppealFor(assetId) {
    return one(
      `select * from asset_appeals where asset_id = $1 and status = 'open'`,
      [assetId],
    );
  },

  /**
   * File an appeal.
   *
   * The partial unique index is the real guard: two taps at once cannot produce
   * two open appeals, and the route can tell the difference between "filed" and
   * "you already have one" without racing. Nothing here touches the asset — an
   * appeal is a request for a person, not a lever.
   */
  async fileAppeal({ assetId, channelId, sellerId, statement, reasons = [], reportCount = 0 }) {
    try {
      const row = await one(
        `insert into asset_appeals (asset_id, channel_id, seller_id, statement, reasons, report_count)
         values ($1, $2, $3, $4, $5, $6) returning *`,
        [assetId, channelId, sellerId, statement, reasons, reportCount],
      );
      await this.audit('asset.appealed', {
        assetId, channelId, reportCount, reasons,
      }, { actorId: sellerId, subjectType: 'asset', subjectId: assetId });
      return { filed: true, appeal: row };
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      return { filed: false, appeal: await this.openAppealFor(assetId) };
    }
  },

  /**
   * The operator's appeal queue: open first, and each one carries everything the
   * decision needs — the seller's words, the charge they were answering, the
   * reports still open, and whether the file is still the threshold's to restore.
   */
  openAppeals() {
    return many(
      `select ap.id, ap.asset_id, ap.channel_id, ap.statement, ap.reasons, ap.report_count,
              ap.created_at, ap.status,
              a.title as asset_title, a.slug as asset_slug, a.status as asset_status,
              a.hidden_by_reports,
              c.slug as channel_slug, c.name as channel_name,
              u.email as seller_email, u.display_name as seller_name,
              (select count(distinct r.reporter_id)::int from asset_reports r
                where r.asset_id = ap.asset_id and r.status = 'open') as reporters_now,
              (select count(*)::int from asset_reports r
                where r.asset_id = ap.asset_id and r.status = 'open') as reports_now
         from asset_appeals ap
         join assets a on a.id = ap.asset_id
         join channels c on c.id = ap.channel_id
         left join profiles u on u.id = ap.seller_id
        where ap.status = 'open'
        order by ap.created_at asc
        limit 100`,
    );
  },

  /** Every appeal ever, for the audit trail — decided ones included. */
  recentAppeals({ limit = 50 } = {}) {
    return many(
      `select ap.*, a.title as asset_title, c.slug as channel_slug, c.name as channel_name,
              p.display_name as decided_by_name
         from asset_appeals ap
         join assets a on a.id = ap.asset_id
         join channels c on c.id = ap.channel_id
         left join profiles p on p.id = ap.decided_by
        order by ap.created_at desc limit $1`,
      [limit],
    );
  },

  /**
   * Decide an appeal.
   *
   * `upheld` restores the file — but ONLY if the threshold is still what is
   * hiding it (`hidden_by_reports`), so upholding an appeal can never quietly
   * un-pause a file its seller took down, nor lift an operator's own suspension.
   * `declined` changes nothing about the file, which is the point: the queue is
   * for reading carefully, not for flipping switches.
   *
   * Guarded on `status = 'open'` so a double-submit cannot overwrite a decision
   * that has already been made and recorded.
   */
  async decideAppeal({ appealId, decision, note = null, actorId }) {
    if (!['upheld', 'declined', 'withdrawn'].includes(decision)) return { ok: false, error: 'decision' };
    const appeal = await one('select * from asset_appeals where id = $1', [appealId]);
    if (!appeal) return { ok: false, error: 'missing' };
    if (appeal.status !== 'open') return { ok: false, error: 'decided' };

    const decided = await one(
      `update asset_appeals
          set status = $2, decided_at = now(), decided_by = $3, decision_note = $4
        where id = $1 and status = 'open'
        returning *`,
      [appealId, decision, actorId, note],
    );
    if (!decided) return { ok: false, error: 'decided' };

    let restored = false;
    if (decision === 'upheld') {
      const asset = await one('select * from assets where id = $1', [appeal.asset_id]);
      if (asset?.hidden_by_reports) {
        // The same reversibility the dismissal path uses, and for the same
        // reason: only the threshold's hiding is un-done here.
        const back = await one(
          `update assets set status = 'live', hidden_by_reports = false, updated_at = now()
            where id = $1 and hidden_by_reports = true returning id`,
          [appeal.asset_id],
        );
        restored = Boolean(back);
      }
    }
    await this.audit('asset.appeal_decided', {
      assetId: appeal.asset_id, appealId, decision, restored,
      note: note || null,
    }, { actorId, subjectType: 'asset', subjectId: appeal.asset_id });
    return { ok: true, appeal: decided, restored };
  },

  /** The individual reports behind one queue row, with the reporter hidden. */
  reportsForAsset(assetId) {
    return many(
      // No reporter identity in the result: an operator deciding about a FILE does
      // not need to know who complained, and a queue that names reporters is how
      // a moderation tool becomes a harassment tool.
      `select id, reason, note, status, created_at, resolved_at
         from asset_reports where asset_id = $1 order by created_at desc`,
      [assetId],
    );
  },

  /**
   * Hide a file because the report threshold was reached.
   *
   * Sets the flag as well as the status, so the decision is reversible by the
   * only person who can reverse it — an operator who reads the reports and
   * disagrees with them.
   */
  hideByReports(assetId) {
    return one(
      `update assets set status = 'paused', hidden_by_reports = true, updated_at = now()
        where id = $1 returning *`,
      [assetId],
    );
  },

  /**
   * Put a file back after the reports against it were dismissed.
   *
   * ONLY a file the threshold hid. A file its seller paused stays paused, which
   * is the whole reason `hidden_by_reports` exists as a column rather than as an
   * inference from `status`.
   */
  restoreFromReports(assetId) {
    return one(
      `update assets set status = 'live', hidden_by_reports = false, updated_at = now()
        where id = $1 and hidden_by_reports = true returning *`,
      [assetId],
    );
  },

  /** Resolve every open report on a file, in one transaction with the decision. */
  async resolveReports({ assetId, status, resolution, actorId }) {
    return withTransaction(async (client) => {
      const res = await client.query(
        `update asset_reports
            set status = $2, resolution = $3, resolved_by = $4, resolved_at = now()
          where asset_id = $1 and status = 'open'
          returning id`,
        [assetId, status, resolution || null, actorId || null],
      );
      return res.rowCount;
    });
  },

  reportCounts() {
    return one(
      `select count(*) filter (where status = 'open')::int as open,
              count(distinct asset_id) filter (where status = 'open')::int as files,
              count(*)::int as total
         from asset_reports`,
    );
  },

  /** Stores an operator may need to look at: everything not in the default state. */
  channelsNeedingModeration() {
    return many(
      `select c.id, c.slug, c.name, c.moderation_state, c.moderation_reason, c.created_at,
              p.display_name as owner_name, p.email as owner_email
         from channels c left join profiles p on p.id = c.owner_id
        where c.moderation_state <> 'approved'
        order by case c.moderation_state
                   when 'suspended' then 1 when 'removed' then 2 when 'restricted' then 3 else 4 end,
                 c.created_at desc`,
    );
  },

  /**
   * Attention evidence for every store at once, for the Explore rails.
   *
   * One query with two lateral aggregates rather than a loop of per-channel
   * counts: the front page is the most-visited page in a marketplace and it must
   * not cost one round trip per store.
   *
   * `unlocks` counts only non-revoked unlocks inside the window, because a
   * revoked unlock is attention that was taken back.
   */
  channelStats({ days = 30 } = {}) {
    return many(
      `select c.id as channel_id,
              coalesce(v.views, 0)::int   as views_30d,
              coalesce(u.unlocks, 0)::int as unlocks_30d,
              coalesce(a.items, 0)::int   as items
         from channels c
         left join lateral (
           select sum(p.views) as views from page_view_daily p
            where p.channel_id = c.id and p.day > current_date - $1::int
         ) v on true
         left join lateral (
           select count(*) as unlocks from unlocks un
            where un.channel_id = c.id and un.revoked_at is null
              and un.granted_at > now() - ($1::int || ' days')::interval
         ) u on true
         left join lateral (
           select count(*) as items from assets as_ where as_.channel_id = c.id and as_.status = 'live'
         ) a on true
        left join profiles o on o.id = c.owner_id
        where c.moderation_state not in ('removed', 'suspended')
          and coalesce(o.banned, false) = false`,
      [days],
    );
  },

  channelsOf(ownerId) {
    return many('select * from channels where owner_id = $1 order by created_at', [ownerId]);
  },

  /** Pure function, not a query — plans are constants and capabilities are data. */
  /**
   * Which plan a channel is ACTUALLY on, right now.
   *
   * Not simply the plan on its newest subscription row. Three states must not
   * grant paid capability:
   *
   *   pending_payment — the upgrade has been requested but no money has been
   *     matched. Honouring the requested plan here would give the product away
   *     to anyone who can submit a form.
   *   expired — the period ended and the grace window has run out.
   *   refunded / cancelled — deliberately ended.
   *
   * The grace window is CALCULATED, not stored: thirty days after the period
   * ends, features keep working and nothing is deleted. A cron job that has not
   * run must never be the reason a paying seller loses their storefront, so the
   * rule lives in a pure function rather than in a scheduled task.
   */
  effectivePlanCode(c) {
    const code = c?.plan_code;
    if (!code || code === 'free') return 'free';
    // Read explicitly, with no fallback to "well, it has an end date". A row
    // with an end date and a cancelled status granted Pro before this line was
    // written: the query aliases the status from the subscription, so a missing
    // one means the caller did not read it — not that the plan is running.
    const status = c?.subscription_status ?? null;
    const end = c.subscription_end ? new Date(c.subscription_end) : null;
    if (status !== 'active' && status !== 'grace') return 'free';
    if (status === 'grace') return code;
    if (!end || end > now()) return code;
    return GRACE_DAYS && end.getTime() + GRACE_DAYS * 86400000 > now() ? code : 'free';
  },

  /** Days of grace after a period ends. A seller's bad week is not a data loss. */
  plan(c) { return PLANS[this.effectivePlanCode(c)] ?? PLANS.free; },

  upgradeQuote(channel, newPlanCode) {
    const cur = this.plan(channel);
    const next = PLANS[newPlanCode];
    if (!next || next.priceNpr <= cur.priceNpr) return null;
    const end = channel?.subscription_end ? new Date(channel.subscription_end) : null;
    const daysLeft = end ? Math.max(0, Math.ceil((end - now()) / 86400000)) : 0;
    const full = next.priceNpr - cur.priceNpr;
    // Nothing is running, so nothing can be pro-rated: the seller is buying a
    // whole period. Multiplying by 0/365 would bill NPR 0 for a first purchase —
    // and `upgradeExplanation` promises "the full difference" in writing, so the
    // two have to agree.
    const amount = daysLeft > 0 ? Math.round(full * (daysLeft / 365)) : full;
    return { from: cur, to: next, daysLeft, fullDifference: full, amountNpr: amount };
  },

  /**
   * Pro-rated upgrade. Cycle end is unchanged, so the next charge is predictable.
   *
   * `plans.code` is the primary key — there is no plans.id — and subscriptions
   * reference it as plan_code. The first version of this queried `plans.id` and
   * the app could not seed.
   */
  async applyUpgrade(channel, planCode) {
    return withTransaction(async (c) => {
      const exists = await c.query('select 1 from plans where code = $1', [planCode]);
      if (!exists.rowCount) throw new Error(`unknown plan ${planCode}`);
      await c.query(
        `insert into subscriptions (channel_id, plan_code, status, period_end, period_start)
         values ($1, $2, 'active', coalesce($3::timestamptz, now() + interval '1 year'), now())
         on conflict (channel_id) do update
           set plan_code = excluded.plan_code, status = 'active'`,
        [channel.id, planCode, channel.subscription_end],
      );
      return this.channelById(channel.id);
    });
  },

  // ---- assets ------------------------------------------------------------
  /**
   * Create a file, and decide whether a person has to look at it first.
   *
   * The state was hardcoded to `approved`, which made `pending` a state nothing
   * could reach and a queue that could never have anything in it. The rule now:
   * **a store's files wait until a person has approved one of them.** A new store
   * gets one review, not one review per file — that is a promise one operator can
   * keep — and a store that was looked at publishes immediately afterwards.
   *
   * `pending` does not hide the file (see ASSET_BEHAVIOUR): it stays at its link
   * and in the store's own shop, and it is search that waits. The creator is told
   * so on the file's page rather than left to wonder why nobody is finding it.
   *
   * `moderationState` is for the one caller that is not a creator: the seed, which
   * is building a demonstration of a store that has already been reviewed.
   */
  async createAsset({
    channelId, title, slug, description, unlockMode = 'ad_gated', coverUrl = null, moderationState = null,
    // Which tier opens it, when the mode is `members`. Defaulted rather than
    // required, because the pair (unlock_mode, member_tier) is checked as one
    // thing by the database: a call that asks for a members file without naming a
    // tier gets tier 1 — the smallest true answer — instead of a constraint error.
    memberTier = unlockMode === 'members' ? 1 : 0,
  }) {
    return withTransaction(async (c) => {
      let state = moderationState;
      if (!state) {
        // Read inside the transaction, so two files uploaded at the same instant
        // by a brand-new store cannot both find "no approved file yet" and race
        // their way to an unpublishable pair. One of them wins the row lock and
        // the other sees its sibling.
        const { rows: [seen] } = await c.query(
          `select count(*)::int as n from assets
            where channel_id = $1 and moderation_state = 'approved'`,
          [channelId],
        );
        state = seen.n > 0 ? 'approved' : 'pending';
      }
      const { rows } = await c.query(
        `insert into assets (channel_id, title, slug, description, kind, unlock_mode, member_tier, status, moderation_state, cover_url)
         values ($1, $2, $3, $4, 'digital', $5, $6, 'live', $7, $8)
         returning *`,
        [channelId, title, slug || slugify(title), description || '', unlockMode, memberTier, state, coverUrl],
      );
      const asset = rows[0];
      await c.query(
        `insert into asset_unlock_policy (asset_id, mode, ads_required, ad_min_seconds, unlock_hours, max_unlocks_per_day)
         values ($1, $2, 1, 15, 24, 20)
         on conflict (asset_id) do nothing`,
        [asset.id, unlockMode],
      );
      return asset;
    });
  },
  async assetById(aid) {
    if (!UUID_RE.test(String(aid || ''))) return null;
    return one('select * from assets where id = $1', [aid]);
  },
  async assetBySlug(channelId, slug) {
    return one('select * from assets where channel_id = $1 and slug = $2', [channelId, slug]);
  },
  /**
   * The seller's own list, for the seller's own dashboard: live AND paused.
   *
   * `assetsOf` above is the PUBLIC list — live only, and it must stay that way,
   * because it feeds the storefront and the public API. The dashboard was using
   * it too, which meant a paused file simply disappeared from its owner's list
   * with no explanation. For a file the report threshold hid that was worse than
   * an inconvenience: the appeal page was unreachable, because the only route to
   * it is the file's own row. A seller cannot be asked to answer something they
   * cannot find.
   *
   * `removed` stays out: that is an operator's decision about the listing itself,
   * it keeps its own route, and listing it here would put a file back in front of
   * its owner as though nothing had happened.
   */
  assetsForOwner(channelId) {
    return many(
      `select * from assets where channel_id = $1 and status <> 'removed' order by created_at desc`,
      [channelId],
    );
  },

  assetsOf(channelId) {
    return many(
      `select * from assets where channel_id = $1 and status = 'live' order by created_at desc`,
      [channelId],
    );
  },
  async unlockPolicy(assetId) {
    return one('select * from asset_unlock_policy where asset_id = $1', [assetId]);
  },
  // `setAdMinSeconds` used to live here: a public setter that wrote any number at all
  // into the column the unlock pipeline reads, with no policy in it. Three callers
  // reached it (the publish route, the demo seed, and nothing else) and all three
  // were writing an ask the product's own promise forbids. It is deleted rather than
  // guarded, because a guarded setter is still a way to change a number that is not
  // supposed to be typed: the ask comes from `src/adscale.js`, and the seller's lever
  // is the level, not the seconds.

  async addFile({ assetId, storageKey, filename, mimeType, sizeBytes, checksum }) {
    return one(
      `insert into asset_files (asset_id, storage_key, filename, mime_type, size_bytes, checksum, version, sort_order)
       values ($1, $2, $3, $4, $5, $6, 1, 0)
       returning *`,
      [assetId, storageKey, filename, mimeType, sizeBytes, checksum],
    );
  },
  filesOf(assetId) {
    // Total order, not "whatever the planner returns": a reader's step 3 has to be
    // one specific file on every render and every request. `sort_order` is the
    // seller's (the ordering UI does not exist yet, so it is 0 today), then the
    // upload order, then the name — the same order the page model sorts by.
    return many(`select * from asset_files where asset_id = $1
                  order by sort_order, created_at, id`, [assetId]);
  },

  /**
   * The ordered pages of a read asset, and the order is the promise.
   *
   * Derived, never stored: an archive's own index is the page list, and a cached
   * copy of somebody else's upload is a copy that can go stale. The archive listing
   * is memoised per (file, checksum) inside `pages.js`, which is what keeps this
   * cheap enough to call on every asset-page render.
   */
  /**
   * DELETE A FILE — the bytes first, then the last pointer to them.
   *
   * Two promises, and they are different promises:
   *
   *   * an UNLOCK buys access to a file while it exists. Pausing keeps that promise
   *     (the file is off sale, and everyone who opened it keeps watching), which is
   *     why pausing is not this.
   *   * a DELETE says the bytes are gone and nobody can fetch them any more. That has
   *     to be true at the byte level — not only in the storefront query — so the
   *     `asset_files` rows go with the bytes, and both byte routes 404 because there
   *     is no file to look up rather than because a page decided to hide a card.
   *
   * A HOST THAT CANNOT DELETE IS NOT A REASON TO KEEP THE FILE.
   *
   * Telegra.ph has no delete endpoint (VIDEO_STORAGE.md §10.5) and says so by throwing
   * from `remove()`. The old impulse — refuse the whole delete because one copy cannot
   * be recalled — leaves a picture the seller has explicitly disowned still served by
   * us, which is the worse of the two outcomes and the one the product can always
   * avoid. So the attempt is made per file, the failure is recorded as an ORPHAN with
   * the host and the key, and the local side is destroyed anyway. The seller is told
   * the truth in the words the host earned: the copy at Telegra.ph cannot be recalled,
   * and nothing here points at it any more.
   *
   * What survives is the row: unlocks, reports and appeals keep their subject, and the
   * tombstone says what happened and when. What does not survive is every address:
   * `asset_files` rows, the live `external_url`, and a `cover_url` that points off our
   * own origin — a cover is a picture of the file, and a deleted file's picture staying
   * on somebody else's CDN is the same leak one size smaller.
   */
  async deleteAsset({ assetId, actorId = null }) {
    const asset = await this.assetById(assetId);
    if (!asset) return null;
    /*
     * Already a tombstone: nothing to do, and nothing to claim.
     *
     * A seller can hold two tabs open, and the second press must not report destroying a
     * file that is not there — "1 file destroyed" on an empty file is exactly the kind of
     * small untrue sentence that makes a report worth ignoring. The row it would count is
     * the ENOENT below, which is a real answer for a first delete (somebody removed the
     * bytes out of band) and the wrong answer here.
     */
    if (asset.status === 'deleted') {
      return { asset, destroyed: [], orphans: [], unlocksVoided: 0, already: true };
    }
    const files = await this.filesOf(assetId);
    const destroyed = [];
    const orphans = [];

    for (const file of files) {
      const key = String(file.storage_key || '');
      const host = storage.isRemote(key) ? storage.remoteProvider(key) : 'local';
      try {
        if (storage.isRemote(key)) await videoRemove(storage.remoteId(key), { provider: host });
        else await storage.remove(key);
        destroyed.push({ host, key });
      } catch (err) {
        // Not fatal by design. An undeletable host is a fact about the host, and the
        // sentence it throws is the most useful thing anybody can say about the copy
        // that remains — so it is kept rather than swallowed.
        const missing = err?.code === 'ENOENT';
        if (missing) destroyed.push({ host, key });
        else orphans.push({ host, key, reason: err?.message || 'the host refused to delete it' });
      }
    }

    // The entitlement goes with the bytes. Not for tidiness: `isUnlocked` is what the
    // byte routes check, and a live unlock row for a file with no bytes is a promise
    // the product cannot keep.
    const { rows: [{ n: unlocksVoided }] } = await query(
      `with voided as (
         update unlocks set revoked_at = now()
          where asset_id = $1 and revoked_at is null
          returning 1)
       select count(*)::int as n from voided`,
      [assetId],
    );

    await query('delete from asset_files where asset_id = $1', [assetId]);
    const { rows: [row] } = await query(
      `update assets
          set status = 'deleted', deleted_at = now(), updated_at = now(),
              hidden_by_reports = false,
              external_url = null,
              cover_url = case when cover_url like '/%' then cover_url else null end
        where id = $1
        returning *`,
      [assetId],
    );

    await this.audit('asset.deleted', {
      files: files.length, destroyed, orphans, unlocksVoided,
    }, { actorId, subjectType: 'asset', subjectId: assetId });

    return { asset: row, destroyed, orphans, unlocksVoided };
  },

  async assetPagePlan(asset, files = null) {
    if (!asset) return pagePlan({ files: [] });
    const rows = files ?? await this.filesOf(asset.id);
    const archives = {};
    for (const f of rows) {
      if (!isArchiveName(f.filename)) continue;
      const index = await archiveIndexFor(f, (key) => storage.get(key));
      if (index) archives[f.id] = index;
    }
    return pagePlan({ files: rows, archives });
  },

  /** Where this person stopped in this file, or null. Private to them. */
  readingProgress(userId, assetId) {
    if (!userId) return null;
    return one('select step, updated_at from reading_progress where user_id = $1 and asset_id = $2',
      [userId, assetId]);
  },

  /**
   * Record a page change — and only a page change.
   *
   * The upsert carries `where reading_progress.step <> excluded.step`, so a re-render
   * of the same page writes nothing and touches no timestamp. That is not just an
   * optimisation: "when did they last turn a page" and "when did they last load this
   * URL" are different questions, and only the first one is worth an answer.
   */
  saveReadingProgress({ userId, assetId, step }) {
    const n = Number(step);
    if (!userId || !Number.isInteger(n) || n < 1) return null;
    return one(
      `insert into reading_progress (user_id, asset_id, step, updated_at)
       values ($1, $2, $3, now())
       on conflict (user_id, asset_id) do update
         set step = excluded.step, updated_at = now()
       where reading_progress.step <> excluded.step
       returning *`,
      [userId, assetId, n],
    );
  },

  /*
   * ── THE SERIES (§15) ──────────────────────────────────────────────────────
   *
   * A series is the store's own grouping of the store's own files, and these five
   * methods are the whole of its storage. An episode stays an ordinary file: it has
   * its own unlock mode, its own ask, its own ledger row, and its own page. What
   * lives here is the ORDER and the membership — plus the viewer's position, which
   * is the one thing in this block that is not the store's.
   */

  /** Every series this store has, newest first, with how many episodes each holds. */
  seriesOf(channelId) {
    return many(
      `select s.*, count(a.id)::int as episodes
         from series s
         left join assets a on a.series_id = s.id
        where s.channel_id = $1
        group by s.id
        order by s.created_at desc`,
      [channelId],
    );
  },

  /** One series by id, scoped to its channel when one is given. */
  seriesById(id, channelId = null) {
    if (!id) return Promise.resolve(null);
    return one(
      `select * from series where id = $1${channelId ? ' and channel_id = $2' : ''}`,
      channelId ? [id, channelId] : [id],
    );
  },

  /** One series by its address inside a store — the public page's lookup. */
  seriesBySlug(channelId, slug) {
    return one('select * from series where channel_id = $1 and slug = $2', [channelId, slug]);
  },

  /**
   * The episodes of a series, as the files they are.
   *
   * Ordered in SQL by the number because the page needs a stable list before the
   * module sorts it by MODE; the module is still what decides the final order, so
   * this clause is a convenience and not a second opinion. `runtime_sec` comes along
   * because `isFinished` measures the last thirty seconds against it — the player
   * reported that number, and the alternative is guessing how long an episode is.
   */
  episodesOf(seriesId) {
    if (!seriesId) return Promise.resolve([]);
    return many(
      `select id, slug, title, description, cover_url, unlock_mode,
              member_tier, episode_no, runtime_sec, status, created_at
         from assets
        where series_id = $1
        order by episode_no asc nulls last`,
      [seriesId],
    );
  },

  /**
   * Every episode of every one of these series, in one query.
   *
   * The storefront draws ONE card per series, and that card counts the series' episodes
   * and picks the one to play next — so it needs the whole list, not the slice that
   * happens to be on the page. One query with an array parameter, because a store with
   * six series is not six round trips.
   */
  episodesForSeries(seriesIds = []) {
    if (!seriesIds.length) return Promise.resolve([]);
    return many(
      `select id, series_id, episode_no, slug, title, description, cover_url, unlock_mode,
              member_tier, runtime_sec, status, moderation_state, created_at
         from assets
        where series_id = any($1::uuid[])
        order by series_id, episode_no asc nulls last`,
      [seriesIds],
    );
  },

  /**
   * Which series each of these files belongs to, by asset id.
   *
   * The storefront needs this for the cards it is about to draw and the episode's own
   * page needs it for the strip; one query with an array parameter rather than one
   * query per card, because a storefront with forty files is not forty round trips.
   *
   * The series columns are aliased rather than selected with `s.*`: both tables have an
   * `id`, a `slug` and a `created_at`, and a row where `id` means one table in one place
   * and the other table in the next is how a card starts linking to the wrong store.
   */
  seriesForAssets(assetIds = []) {
    if (!assetIds.length) return Promise.resolve([]);
    return many(
      `select a.id as asset_id, a.episode_no,
              s.id as series_id, s.slug as series_slug, s.title as series_title,
              s.blurb as series_blurb, s.mode as series_mode, s.created_at as series_created_at
         from assets a
         join series s on s.id = a.series_id
        where a.id = any($1::uuid[])`,
      [assetIds],
    );
  },

  /**
   * The files of many assets at once, for the one caller that needs a SHAPE for a list:
   * the seller's series page, which shows the files a series may hold and refuses the
   * others. Shapes are derived from files (`media.js` → `assetShape`), so a page that
   * drew that list without them would be guessing at the rule it enforces.
   */
  async filesForAssets(assetIds = []) {
    if (!assetIds.length) return {};
    const rows = await many(
      `select * from asset_files
        where asset_id = any($1::uuid[])
        order by sort_order, created_at, id`,
      [assetIds],
    );
    const out = {};
    for (const row of rows) {
      const key = String(row.asset_id);
      (out[key] ||= []).push(row);
    }
    return out;
  },

  /** Start a series. The slug is unique inside the store, and the caller makes it so. */
  createSeries({ channelId, slug, title, blurb = null, mode = 'collection' }) {
    return one(
      `insert into series (channel_id, slug, title, blurb, mode)
       values ($1, $2, $3, $4, $5)
       returning *`,
      [channelId, slug, String(title).slice(0, 140), blurb ? String(blurb).slice(0, 400) : null, mode],
    );
  },

  updateSeries({ seriesId, title, blurb, mode }) {
    return one(
      `update series
          set title = coalesce($2, title),
              blurb = $3,
              mode = coalesce($4, mode),
              updated_at = now()
        where id = $1
        returning *`,
      [seriesId, title ? String(title).slice(0, 140) : null, blurb ? String(blurb).slice(0, 400) : null, mode ?? null],
    );
  },

  /**
   * Put a file in a series at a number — or take it out.
   *
   * `episodeNo = null` is the removal, and it clears BOTH columns in the same
   * statement: the check constraint requires a number with a series and nothing
   * without one, so a half-applied removal is not a state this code can reach.
   */
  setEpisode({ assetId, seriesId, episodeNo }) {
    return one(
      `update assets
          set series_id = $2, episode_no = $3, updated_at = now()
        where id = $1
        returning id, series_id, episode_no`,
      [assetId, seriesId ?? null, episodeNo ?? null],
    );
  },

  /** Renumber one episode, in place. The unique index is what refuses a collision. */
  setEpisodeNo({ assetId, episodeNo }) {
    return one(
      'update assets set episode_no = $2, updated_at = now() where id = $1 returning id, episode_no',
      [assetId, episodeNo],
    );
  },

  /** A series leaves; its episodes stay, as ordinary files. Nothing is deleted. */
  deleteSeries(seriesId) {
    return one('delete from series where id = $1 returning id, title', [seriesId]);
  },

  /*
   * THE VIEWER'S OWN POSITION.
   *
   * Written by the player, read to resume. Three properties, and each is a decision
   * rather than an implementation detail:
   *
   *   · the store is never shown it — there is no seller query in this file that
   *     reads `watch_progress`, and none may be added;
   *   · nothing in accounting reads it. A credited view comes from the network's
   *     signed postback; a client claiming a position cannot move a ledger row,
   *     and this table is not joined by any earnings or attention query;
   *   · the same position written twice writes nothing, the way the reader's page
   *     number does — "when did they last move" and "when did a request arrive" are
   *     different questions, and only the first is worth an answer.
   */
  watchProgress(userId, assetId) {
    if (!userId) return null;
    return one('select position_sec, updated_at from watch_progress where user_id = $1 and asset_id = $2',
      [userId, assetId]);
  },

  /** The positions this person holds across a set of episodes, keyed by asset id. */
  async watchProgressFor(userId, assetIds = []) {
    if (!userId || !assetIds.length) return {};
    const rows = await many(
      `select asset_id, position_sec, updated_at
         from watch_progress
        where user_id = $1 and asset_id = any($2::uuid[])`,
      [userId, assetIds],
    );
    return Object.fromEntries(rows.map((r) => [String(r.asset_id), r]));
  },

  saveWatchProgress({ userId, assetId, seconds }) {
    const at = Math.floor(Number(seconds));
    if (!userId || !Number.isFinite(at) || at < 0) return null;
    return one(
      `insert into watch_progress (user_id, asset_id, position_sec, updated_at)
       values ($1, $2, $3, now())
       on conflict (user_id, asset_id) do update
         set position_sec = excluded.position_sec, updated_at = now()
       where watch_progress.position_sec <> excluded.position_sec
       returning *`,
      [userId, assetId, Math.min(at, 86_400)],
    );
  },

  /**
   * The gate seams this person has already cleared on this file.
   *
   * Read from the attempt rows that already exist — a completed view at a break
   * index — rather than from a new "unlocked gates" table, because a second record
   * of the same fact is a second thing that can disagree with the ledger. Returns
   * numbers so a caller can build a Set without caring about the driver's types.
   */
  async clearedGates(userId, assetId) {
    if (!userId) return [];
    const rows = await many(
      `select distinct break_index from pending_views
        where user_id = $1 and asset_id = $2 and completed and break_index is not null`,
      [userId, assetId],
    );
    return rows.map((r) => Number(r.break_index)).sort((a, b) => a - b);
  },

  /**
   * How the store wants its own file presented. Its call, not ours: a manga reads
   * right to left, a webtoon does not turn pages at all.
   */
  setReadChoices({ assetId, mode, direction }) {
    return one(
      `update assets set read_mode = $2, read_direction = $3, updated_at = now()
        where id = $1 returning *`,
      [assetId, mode, direction],
    );
  },
  // ---- the live surface (§14) --------------------------------------------
  /*
   * Where the stream is, and the breaks the store called.
   *
   * Nothing in this section can open a break on its own: `createLiveBreak` is called
   * from the seller's own POST and from nowhere else, and there is no timer, no job
   * and no rule that decides a break is due. That absence is the design (§14.3), and
   * it is why these four methods are all reads plus two writes the seller's request
   * makes directly.
   */

  /** The breaks this file has, newest first. Windows, never a schedule. */
  liveBreaksOf(assetId, limit = 20) {
    return many(
      `select id, asset_id, cue_index, seconds, started_at, ends_at, closed_at, note
         from live_breaks where asset_id = $1 order by started_at desc limit $2`,
      [assetId, Math.min(Math.max(Number(limit) || 20, 1), 100)],
    );
  },

  liveBreakById(id) {
    if (!UUID_RE.test(String(id || ''))) return null;
    return one('select * from live_breaks where id = $1', [id]);
  },

  /**
   * Open a window.
   *
   * Both stamps are handed in by the caller rather than computed here, and that is
   * deliberate: the start and the end then come from ONE clock — the process that
   * decided the break was being called — so the panel, the poller and the coverage
   * arithmetic cannot disagree about when the window is over. (The first version asked
   * Postgres for `now() + seconds`, which is the same clock in a single-node deployment
   * and two different ones the moment the database is not on the same host.)
   *
   * The partial unique index (`uq_live_break_open`) is the one-open-at-a-time rule,
   * enforced where it cannot be raced: two sellers pressing the button at the same
   * moment get one window and one constraint error, not two overlapping breaks.
   */
  createLiveBreak({ assetId, channelId, userId, cueIndex, seconds, startedAt, endsAt, note = null }) {
    return one(
      `insert into live_breaks
         (asset_id, channel_id, opened_by, cue_index, seconds, started_at, ends_at, note)
       values ($1, $2, $3, $4, $5, $6, $7, $8)
       returning *`,
      [assetId, channelId, userId, cueIndex, Math.floor(Number(seconds) || 0), startedAt, endsAt, note],
    );
  },

  /**
   * Where the stream is — or, with `null`, that it is not a stream any more.
   *
   * Validated in the route (`isLiveUrl` plus the scheme), not here: this is the write,
   * and the rule belongs in the one place the seller's POST and the seller's panel can
   * both read it.
   */
  setExternalUrl({ assetId, url }) {
    return one(
      `update assets set external_url = $2, updated_at = now() where id = $1 returning *`,
      [assetId, url || null],
    );
  },

  /** End a window early. The store's call, like opening one. */
  closeLiveBreak({ assetId, breakId }) {
    if (!UUID_RE.test(String(breakId || ''))) return null;
    return one(
      `update live_breaks set closed_at = now()
        where id = $1 and asset_id = $2 and closed_at is null
        returning *`,
      [breakId, assetId],
    );
  },

  async fileById(fid) {
    return one('select * from asset_files where id = $1', [fid]);
  },

  // ---- ad connections ----------------------------------------------------
  async createConnection({ channelId, providerId, slotKeys = [], onboarding = 'signup_redirect', payoutVerdict, secret, callbackBaseUrl }) {
    const base = (callbackBaseUrl || process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '') || null;
    const { rows } = await query(
      `insert into ad_connections
         (channel_id, provider_id, status, onboarding, credential_ref,
          callback_secret, callback_base_url, payout_verdict, slot_keys)
       values ($1, $2, 'active', $3, $4, $5, $6, $7, $8)
       returning *`,
      [
        channelId, providerId, onboarding,
        // Opaque handle only. A publisher id must never be stored in clear.
        `secret://${channelId}/${providerId}/${id().slice(0, 8)}`,
        // Per connection, because two channels can both use BitLabs with two
        // different app secrets. In production this is a pointer into a secrets
        // manager; literal here only because this build has no external services.
        secret ?? null,
        base,
        payoutVerdict ?? null,
        slotKeys,
      ],
    );
    return rows[0];
  },
  connectionsOf(channelId) {
    return many(
      `select * from ad_connections where channel_id = $1 and status = 'active' order by connected_at`,
      [channelId],
    );
  },
  async connectionById(cid) {
    if (!UUID_RE.test(String(cid || ''))) return null;
    return one('select * from ad_connections where id = $1', [cid]);
  },
  /**
   * Change a connection's state, secret or slot assignment.
   *
   * Built from a whitelist rather than a spread of the caller's object: this row
   * holds the secret used to verify money, and a route that forwards `req.body`
   * into it would let a form decide what the column means.
   */
  async updateConnection(cid, patch = {}) {
    if (!UUID_RE.test(String(cid || ''))) return null;
    const sets = [];
    const values = [cid];
    const allow = {
      status: (v) => String(v).slice(0, 20),
      status_reason: (v) => String(v).slice(0, 200),
      callback_secret: (v) => String(v),
      credential_label: (v) => String(v).slice(0, 60),
      slot_keys: (v) => (Array.isArray(v) ? v.map(String).slice(0, 12) : []),
    };
    for (const [key, cast] of Object.entries(allow)) {
      if (!(key in patch)) continue;
      values.push(cast(patch[key]));
      sets.push(`${key} = $${values.length}`);
    }
    if (!sets.length) return this.connectionById(cid);
    return one(`update ad_connections set ${sets.join(', ')} where id = $1 returning *`, values);
  },

  /**
   * The state-machine history. The table exists because onboarding leaves the
   * app and can fail halfway; without it a support question has no answer.
   */
  async logConnectionEvent({ connectionId, from = null, to, detail = null }) {
    if (!UUID_RE.test(String(connectionId || ''))) return null;
    return one(
      `insert into ad_connection_events (connection_id, from_status, to_status, detail)
       values ($1, $2, $3, $4) returning *`,
      [connectionId, from, String(to).slice(0, 20), detail ? String(detail).slice(0, 300) : null],
    );
  },

  connectionEvents(connectionId, { limit = 20 } = {}) {
    if (!UUID_RE.test(String(connectionId || ''))) return Promise.resolve([]);
    return many(
      `select * from ad_connection_events where connection_id = $1
        order by created_at desc limit $2`,
      [connectionId, limit],
    );
  },

  /**
   * When each of this channel's networks last called us, and how often.
   *
   * This is the evidence the connections page needs to answer "why is nothing
   * unlocking": a connection that has never received a callback is a URL that
   * was not saved in the network's dashboard, and that is a different problem
   * from a network that takes three days to reconcile an offerwall.
   */
  postbackEvidence(channelId, { days = 30 } = {}) {
    return many(
      `select provider_id, connection_id,
              max(created_at) as last_at,
              count(*) filter (where created_at > now() - ($2 || ' days')::interval) as in_window,
              count(*) as total
         from ad_view_events
        where channel_id = $1
        group by provider_id, connection_id`,
      [channelId, String(days)],
    );
  },

  /**
   * Every ad connection on the platform, with the evidence of whether it works.
   *
   * The seller's networks page answers "is mine connected". Nothing answered
   * "is ANY of them, and which one is quietly dead" — and a connection that never
   * receives a signed callback is the most expensive silent failure in this
   * product: the seller keeps publishing, the buyer keeps watching ads, and no
   * money moves, because a callback URL was never saved in the network's own
   * dashboard.
   *
   * So the numbers here are the ones that distinguish the failure modes:
   * callbacks received at all, callbacks in the window, and callbacks whose
   * signature did not verify. Those three, with the last transition, tell an
   * operator which of the four things went wrong.
   */
  connectionHealth({ days = 30, limit = 200 } = {}) {
    return many(
      `select ac.id, ac.status, ac.status_reason, ac.provider_id, ac.created_at,
              ac.credential_label, ac.payout_verdict, ac.slot_keys,
              c.id as channel_id, c.name as channel_name, c.slug as channel_slug,
              (select count(*)::int from ad_view_events e where e.connection_id = ac.id)      as postbacks_total,
              (select count(*)::int from ad_view_events e
                where e.connection_id = ac.id
                  and e.created_at > now() - ($2 || ' days')::interval)                       as callbacks_window,
              -- A REFUSED callback never reaches ad_view_events: that table records
              -- views we accepted, and the refusal is written to the audit log
              -- instead. Counting "not signature_ok" here would therefore have
              -- returned zero forever — a metric that cannot move, on the page whose
              -- whole purpose is spotting a network whose secret no longer matches.
              -- So the refusals are counted where they are actually recorded, and
              -- split into "the signature did not verify" (a secret problem, the
              -- seller must paste a new one) and "the callback was otherwise
              -- unusable" (a view that had expired, a mismatch).
              (select count(*)::int from audit_logs al
                where al.action = 'postback.rejected'
                  and al.meta->>'connectionId' = ac.id::text)                                 as rejections_total,
              (select count(*)::int from audit_logs al
                where al.action = 'postback.rejected'
                  and al.meta->>'connectionId' = ac.id::text
                  and (al.meta->>'reason') ~* 'signature|hash|no &hash|missing sig|secret')   as signature_failures,
              (select max(e.created_at) from ad_view_events e
                where e.connection_id = ac.id and e.signature_ok)                             as last_verified_at,
              (select max(al.created_at) from audit_logs al
                where al.action = 'postback.rejected'
                  and al.meta->>'connectionId' = ac.id::text)                                 as last_rejected_at,
              (select (al.meta->>'reason') from audit_logs al
                where al.action = 'postback.rejected'
                  and al.meta->>'connectionId' = ac.id::text
                order by al.created_at desc limit 1)                                          as last_rejection_reason,
              (select max(ev.created_at) from ad_connection_events ev
                where ev.connection_id = ac.id)                                               as last_transition_at,
              coalesce(ev.events, '[]'::json)                                                 as history,
              (select count(*)::int from channel_slots cs
                where cs.connection_id = ac.id and cs.enabled)                                as slots_filled
         from ad_connections ac
         join channels c on c.id = ac.channel_id
         left join lateral (select json_agg(x) as events from (
                  select from_status, to_status, detail, created_at
                    from ad_connection_events ev2
                   where ev2.connection_id = ac.id
                   order by ev2.created_at desc limit 4) x) ev on true
        order by case ac.status
                   when 'verifying' then 0 when 'failed' then 1 when 'restricted' then 2
                   when 'active' then 3 else 4 end,
                 ac.created_at desc
        limit $1`,
      [Math.min(Number(limit) || 200, 500), String(days)],
    );
  },

  /** The active connection a postback belongs to. Revoked connections refuse. */
  async activeConnection(connectionId, providerId) {
    if (!connectionId) return null;
    // A non-UUID here is a request from the open internet, not an error. Without
    // this guard Postgres rejects the cast and the route answers 500 — which
    // tells a provider to RETRY, forever, on a request that can never succeed.
    if (!UUID_RE.test(String(connectionId))) return null;
    const row = await one(
      `select * from ad_connections where id = $1 and status = 'active'`,
      [connectionId],
    );
    if (!row) return null;
    if (providerId && row.provider_id !== providerId) return null;
    return row;
  },
  async revokeConnection(cid) {
    return one(
      `update ad_connections set status = 'revoked', revoked_at = now() where id = $1 returning *`,
      [cid],
    );
  },
  async setSlotAssignment(channelId, slotKey, connectionId) {
    const row = await one(
      `update ad_connections
          set slot_keys = (select array_agg(distinct k) from unnest(slot_keys || $3::text[]) k)
        where id = $1 and channel_id = $2
        returning *`,
      [connectionId, channelId, [slotKey]],
    );
    if (!row) throw new Error('connection does not belong to channel');
    return row;
  },

  // ---- opaque ad-network references --------------------------------------
  /**
   * The handle we send an ad network instead of a user id.
   *
   * Stable per user so the network's own anti-fraud works across views, and
   * meaningless outside this database. ON CONFLICT makes concurrent calls for
   * the same user converge on one ref instead of racing to create two.
   */
  async adRefFor(userId) {
    const row = await one(
      `insert into ad_refs (user_id) values ($1)
       on conflict (user_id) do update set user_id = excluded.user_id
       returning ref`,
      [userId],
    );
    return row.ref;
  },
  async userByAdRef(ref) {
    return scalar('select user_id from ad_refs where ref = $1', [ref]);
  },

  /** Open (uncompleted) views for a provider+user, newest first. */
  openViewsFor(providerId, userId) {
    return many(
      `select * from pending_views
        where completed = false and provider_id = $1 and user_id = $2
        order by created_at desc`,
      [providerId, userId],
    );
  },

  // ---- unlocks -----------------------------------------------------------
  async unlockFor(assetId, userId) {
    if (!UUID_RE.test(String(assetId || ''))) return null;
    return one(
      `select * from unlocks
        where asset_id = $1 and user_id = $2 and revoked_at is null
          and (expires_at is null or expires_at > now())`,
      [assetId, userId],
    );
  },
  /**
   * Which of these files this person has open, as ids.
   *
   * One read for a whole page: the storefront draws forty cards from it and an episode
   * strip draws every episode of a series. The conditions are the same three the
   * single-file check uses — not revoked, and not expired — so a card and the file's own
   * page cannot disagree about whether something is open.
   */
  async openUnlockIds(userId, assetIds = []) {
    if (!userId || !assetIds.length) return [];
    const rows = await many(
      `select asset_id from unlocks
        where user_id = $1 and revoked_at is null
          and (expires_at is null or expires_at > now())
          and asset_id = any($2::uuid[])`,
      [userId, assetIds],
    );
    return rows.map((r) => String(r.asset_id));
  },

  async isUnlocked(assetId, userId) {
    // An id that cannot be a uuid cannot be unlocked. Checking here rather than
    // letting Postgres reject the cast keeps a malformed query string a 400-ish
    // answer instead of a 500 — the same fix the postback needed.
    if (!UUID_RE.test(String(assetId || ''))) return false;
    const n = await scalar(
      `select count(*)::int from unlocks
        where asset_id = $1 and user_id = $2 and revoked_at is null
          and (expires_at is null or expires_at > now())`,
      [assetId, userId],
    );
    return n > 0;
  },

  /**
   * Grant (or extend) an unlock. Idempotent by construction.
   *
   * ON CONFLICT DO UPDATE rather than read-then-write. The previous version did
   * `find existing; if (existing) existing.ads_completed += n`. Under two
   * concurrent postbacks both read the same count and one increment is lost.
   * `ads_completed = unlocks.ads_completed + excluded.ads_completed` does the
   * arithmetic in the database, where it is atomic.
   */
  async grantUnlock({ assetId, channelId, userId, method = 'rewarded_ad', adsCompleted = 1, policy, client }) {
    const hours = policy?.unlock_hours ?? 24;
    const expires = hours > 0 ? new Date(Date.now() + hours * 3600_000) : null;
    const run = (client || { query }).query.bind(client || { query });
    const { rows } = await run(
      `insert into unlocks (asset_id, channel_id, user_id, method, ads_completed, expires_at)
       values ($1, $2, $3, $4, $5, $6)
       on conflict (asset_id, user_id) do update
         set granted_at     = now(),
             expires_at     = excluded.expires_at,
             ads_completed  = unlocks.ads_completed + excluded.ads_completed,
             revoked_at     = null,
             revoked_reason = null
       returning *`,
      [assetId, channelId, userId, method, adsCompleted, expires],
    );
    return rows[0];
  },
  unlocksOfChannel(channelId) {
    return many(
      `select u.*, a.title as asset_title from unlocks u
         join assets a on a.id = u.asset_id
        where u.channel_id = $1 order by u.granted_at desc`,
      [channelId],
    );
  },

  // ---- the buyer's shelf: what is open to me, and what I watch ------------
  /**
   * A person's unlocks, as the library shows them.
   *
   * Three facts per row that the storefront cannot answer, and each one is why
   * this page exists rather than a link to the store:
   *
   *   * `open` — whether the window is still open. An unlock is a borrow, not a
   *     purchase (24 hours by default, `unlock_hours = 0` meaning permanent), and
   *     the difference between "yours until 9pm" and "yours" is the whole point of
   *     the page. Computed here from `expires_at`, the same field the download
   *     route checks, so the page cannot say open when the file would refuse.
   *   * the ASSET's availability, because a store can take a file down after
   *     somebody unlocked it, and a library that offers a link to a removed file
   *     is a library that lies by omission.
   *   * the review, if one was written — reviews hang off an unlock, so this is
   *     the only page that can tell a person which of their unlocks they have not
   *     spoken about yet.
   *
   * Ordering is by `open` first, then most recent: what is usable now is at the
   * top, and the history is arranged the way memory is.
   */
  myUnlocks(profileId, { limit = 100 } = {}) {
    return many(
      `select u.id, u.asset_id, u.channel_id, u.method, u.granted_at,
              u.expires_at, u.revoked_at, u.revoked_reason,
              (u.revoked_at is null and (u.expires_at is null or u.expires_at > now())) as open,
              a.slug as asset_slug, a.title, a.status as asset_status,
              a.moderation_state, a.hidden_by_reports, a.cover_url,
              c.slug as channel_slug, c.name as channel_name,
              r.id as review_id, r.rating as review_rating, r.created_at as review_at
         from unlocks u
         join assets a on a.id = u.asset_id
         join channels c on c.id = u.channel_id
         left join reviews r on r.unlock_id = u.id
        where u.user_id = $1
        order by (u.revoked_at is null and (u.expires_at is null or u.expires_at > now())) desc,
                 u.granted_at desc
        limit $2`,
      [profileId, Math.min(Math.max(Number(limit) || 100, 1), 500)],
    );
  },

  /** The one number the library's headline needs, without reading its rows. */
  unlockCounts(profileId) {
    return one(
      `select count(*)::int as all,
              count(*) filter (where revoked_at is null
                                 and (expires_at is null or expires_at > now()))::int as open
         from unlocks where user_id = $1`,
      [profileId],
    );
  },

  /**
   * Start watching a store. Idempotent, and `seen_at` starts at the follow
   * moment — a store followed today has nothing "new" in it, which is the only
   * reading of "new" that does not announce a store's entire back catalogue.
   */
  async followChannel(profileId, channelId) {
    const rows = await query(
      `insert into follows (profile_id, channel_id) values ($1, $2)
       on conflict (profile_id, channel_id) do nothing
       returning *`,
      [profileId, channelId],
    );
    return rows[0] || (await one(
      'select * from follows where profile_id = $1 and channel_id = $2', [profileId, channelId],
    ));
  },
  async unfollowChannel(profileId, channelId) {
    const { rowCount } = await query(
      'delete from follows where profile_id = $1 and channel_id = $2', [profileId, channelId],
    );
    return rowCount > 0;
  },
  followState(profileId, channelId) {
    if (!profileId || !channelId) return Promise.resolve(null);
    return one('select * from follows where profile_id = $1 and channel_id = $2', [profileId, channelId]);
  },
  /**
   * The buyer looked at the store. Only ever moves a row that exists, so a
   * stranger's visit writes nothing, and it never inserts — following is an act,
   * not a side effect of browsing.
   */
  async markChannelSeen(profileId, channelId) {
    if (!profileId || !channelId) return false;
    const { rowCount } = await query(
      'update follows set seen_at = now() where profile_id = $1 and channel_id = $2',
      [profileId, channelId],
    );
    return rowCount > 0;
  },
  /**
   * The shelf, with one derived number per store: files that appeared since this
   * buyer last opened the store page.
   *
   * "Appeared" means published AND findable — live, and in the same
   * `SEARCHABLE_ASSET_STATES` the marketplace uses. A store's first file waits for
   * a person before it joins search, and a file its seller has since paused is not
   * on the storefront either; counting either would send the reader to a store page
   * to hunt for something that is not there. The tail of the shelf card prints the
   * store's live count next to it, so the two numbers have to agree.
   */
  followedChannels(profileId) {
    return many(
      `select c.id, c.slug, c.name, c.tagline, c.avatar_url, c.banner_url, c.logo_url,
              c.listing_mode, c.moderation_state,
              f.created_at as followed_at, f.seen_at,
              (select count(*)::int from assets a
                where a.channel_id = c.id
                  and a.status = 'live'
                  and a.moderation_state = any($2)
                  and a.created_at > f.seen_at)          as new_count,
              (select count(*)::int from assets a
                where a.channel_id = c.id and a.status = 'live') as live_count
         from follows f
         join channels c on c.id = f.channel_id
        where f.profile_id = $1
        order by f.created_at desc`,
      [profileId, SEARCHABLE_ASSET_STATES],
    );
  },

  // ---- members: dues paid to the creator, confirmed by the creator ---------
  /**
   * The tiers a store offers, cheapest first. Empty for a Free store — the
   * capability is checked where the seller writes, not here, because a query
   * that silently returns nothing is worse than a page that says why.
   */
  membershipTiers(channelId) {
    return many(
      'select * from membership_tiers where channel_id = $1 order by tier_no',
      [channelId],
    );
  },

  /**
   * Write a tier. Upsert, because a tier is one of at most two things and a
   * seller editing their elite tier should not create a third one by accident.
   *
   * The audit row is written on EVERY save, old value included: this is the only
   * place a price on this platform is set by a person, and "when did the dues
   * change, and from what" is a question members are entitled to an answer to.
   */
  async saveMembershipTier({ channelId, tierNo, value, actorId = null }) {
    const before = value.before ?? await one(
      'select * from membership_tiers where channel_id = $1 and tier_no = $2',
      [channelId, tierNo],
    );
    /*
     * The two arrangements that are promises rather than preferences, and how they
     * are written.
     *
     * `join_mode` and `ad_mode` are coerced rather than trusted, and an
     * unrecognised value falls back to what the row already says (or to the shipped
     * default on a first save) instead of being stored. That is the same shape as
     * `setUnlockPolicy`'s `coalesce($7, mode)`, and it matters more here: a
     * hand-crafted POST must not be able to promise members an ad-free tier the
     * seller never chose, or open a door onto a tier in a store that only sells dues.
     */
    const wantedJoin = JOIN_MODES.includes(String(value.joinMode)) ? String(value.joinMode) : null;
    const wantedAds = AD_MODES.includes(String(value.adMode)) ? String(value.adMode) : null;
    // The glyph travels like the accent rather than like the two arrangements: it is
    // validated in `tierDraft` (an unknown key became null there), so it is written
    // as given — which is also what makes CLEARING one possible. There is no
    // coalesce here because "no mark" is a value a seller chooses, not an absence to
    // be filled in from the row that is already saved.
    const glyph = glyphOf(value.glyph)?.key ?? null;
    const row = await one(
      `insert into membership_tiers
         (channel_id, tier_no, name, dues_npr, period_months, perks, accent, join_mode, ad_mode, glyph)
       values ($1, $2, $3, $4, $5, $6, $7, coalesce($8, 'dues'), coalesce($9, 'ad_free'), $10)
       on conflict (channel_id, tier_no) do update
         set name = excluded.name, dues_npr = excluded.dues_npr,
             period_months = excluded.period_months, perks = excluded.perks,
             accent = excluded.accent,
             glyph = excluded.glyph,
             join_mode = coalesce($8, membership_tiers.join_mode),
             ad_mode = coalesce($9, membership_tiers.ad_mode),
             updated_at = now()
       returning *`,
      [channelId, tierNo, value.name, value.duesNpr, value.periodMonths, value.perks, value.accent,
        wantedJoin, wantedAds, glyph],
    );
    await this.audit('member.tier_set', {
      tierNo, name: row.name, duesNpr: row.dues_npr, periodMonths: row.period_months,
      joinMode: row.join_mode, adMode: row.ad_mode, glyph: row.glyph,
      was: before
        ? {
          name: before.name, duesNpr: before.dues_npr, periodMonths: before.period_months,
          joinMode: before.join_mode, adMode: before.ad_mode, glyph: before.glyph,
        }
        : null,
    }, { actorId, subjectType: 'channel', subjectId: channelId });
    return row;
  },

  // ── standing: the attention door's balance ──────────────────────────────

  /**
   * Add one verified view to somebody's standing with one store.
   *
   * Called from `claimAdView` inside the postback's own transaction, and from
   * nowhere else — that is what makes `earned` mean "views a network confirmed"
   * rather than "views a page claimed". A view that the provider reports as
   * screenout, pending or banned never reaches it, because `claimAdView` is given
   * `completed: false` for those.
   *
   * `upsert` rather than "insert then update": the first view on a store a person
   * has never watched before has no row, and inventing one in a second statement is
   * how a counter ends up lost between two transactions.
   */
  async accrueStanding({ profileId, channelId, views = 1 }, client) {
    if (!profileId || !channelId || views <= 0) return null;
    const run = (client || { query }).query.bind(client || { query });
    const { rows } = await run(
      `insert into member_standing (profile_id, channel_id, earned)
       values ($1, $2, $3)
       on conflict (profile_id, channel_id) do update
         set earned = member_standing.earned + excluded.earned, updated_at = now()
       returning *`,
      [profileId, channelId, views],
    );
    return rows[0] ?? null;
  },

  /** One person's balance with one store. A missing row is zero. */
  async standingFor(profileId, channelId) {
    if (!profileId || !channelId) return 0;
    const row = await one(
      'select earned, spent from member_standing where profile_id = $1 and channel_id = $2',
      [profileId, channelId],
    );
    return standingOf(row);
  },

  /**
   * Join by watching.
   *
   * Everything that can go wrong is decided inside one transaction with the
   * standing row locked, because the decision is "is there enough left" and the
   * answer must not change between reading it and spending it. Two clicks on a slow
   * connection are the ordinary way that happens, and the second one must not buy a
   * second month with the same views.
   *
   * What it deliberately does NOT do: touch a claim. An attention join writes no
   * amount, no method and no reference, so it can never appear in the creator's
   * queue — that queue is a list of things to check against a statement, and there
   * is nothing here for anybody to check. Refusing while a claim is pending is the
   * same rule from the other side: somebody is looking at that person's money, and
   * this door must not race it.
   */
  async joinByAttention({ profileId, channelId, tierNo, tier = null, actorId = null }) {
    const row = tier ?? await one(
      'select * from membership_tiers where channel_id = $1 and tier_no = $2',
      [channelId, tierNo],
    );
    if (!row) return { ok: false, reason: 'no-tier' };
    if (!doorsOf(row).attention) return { ok: false, reason: 'door-closed' };

    return this.withTransaction(async (client) => {
      const locked = await client.query(
        'select * from member_standing where profile_id = $1 and channel_id = $2 for update',
        [profileId, channelId],
      );
      const have = standingOf(locked.rows[0]);

      const existing = await client.query(
        'select * from memberships where profile_id = $1 and channel_id = $2',
        [profileId, channelId],
      );
      const held = existing.rows[0] ?? null;
      if (held && held.status === 'pending') return { ok: false, reason: 'claim-waiting' };

      /*
       * A member with time left is not joining again — they are buying the NEXT
       * period, which is the same thing the dues door does when somebody pays
       * early, and the reason this is an extension rather than a refusal. What it
       * is not is a way to change tier: the membership panel is one tier by
       * design, and the dues door already refuses an active member's claim for a
       * different one. Pressing another tier's door here is answered with the
       * membership they hold rather than with a quiet switch.
       */
      const live = Boolean(held) && held.status === 'active' && held.period_end
        && new Date(held.period_end) > new Date();
      if (live && Number(held.tier_no) !== Number(row.tier_no)) {
        return { ok: false, reason: 'already-in', membership: held };
      }
      const extending = live;

      /*
       * The price is asked AFTER the two questions about the membership, and the
       * order is the sentence a person reads: somebody who is already in, pressing
       * another tier's door, is owed "you are already a member" rather than a
       * number of views for a door that is not theirs.
       */
      const price = attentionProgress({ tier: row, standing: have });
      if (!price.ready) {
        return { ok: false, reason: 'short', have: price.have, needed: price.needed };
      }

      /*
       * The period is ADDED to whatever is left, exactly as a confirmed dues
       * payment is (`confirmMembership`): somebody who watched their way in early,
       * or whose last period has not quite run out, keeps the days they already
       * have. Two doors onto one tier must not disagree about the calendar.
       *
       * The claim fields are cleared when a lapsed or rejected row becomes active
       * this way: they describe money nobody is going to find, and leaving them on
       * an active row is how a seller ends up looking for a transfer that was never
       * the reason this person got in.
       *
       * An EXTENSION touches three columns and nothing else. The tier they hold, the
       * way they got in, the arrangement they joined under and whether they are
       * named on the roster are all that person's history, and spending four views
       * on another month does not rewrite any of it — the audit entry and the views
       * counter record what actually happened.
       */
      const joined = extending
        ? await client.query(
          `update memberships
              set period_end = greatest(coalesce(period_end, now()), now())
                               + make_interval(months => $3),
                  standing_used = coalesce(standing_used, 0) + $4
            where profile_id = $1 and channel_id = $2
            returning *`,
          [profileId, channelId, Number(row.period_months) || 1, price.needed],
        )
        : await client.query(
          `insert into memberships
             (profile_id, channel_id, tier_no, status, join_method, ad_mode, standing_used,
              confirmed_at, period_end, publicly_listed)
           values ($1, $2, $3, 'active', 'attention', $4, $5, now(),
                   now() + make_interval(months => $6), true)
           on conflict (profile_id, channel_id) do update
             set tier_no = excluded.tier_no,
                 status = 'active',
                 join_method = 'attention',
                 ad_mode = excluded.ad_mode,
                 standing_used = excluded.standing_used,
                 amount_npr = null, method = null, txn_reference = null,
                 payer_name = null, payer_number = null, claimed_at = null,
                 rejected_reason = null,
                 confirmed_at = now(),
                 confirmed_by = null,
                 period_end = greatest(coalesce(memberships.period_end, now()), now())
                              + make_interval(months => $6)
           returning *`,
          [profileId, channelId, row.tier_no, adModeOf(row), price.needed, Number(row.period_months) || 1],
        );

      await client.query(
        `update member_standing
            set spent = spent + $3, updated_at = now()
          where profile_id = $1 and channel_id = $2`,
        [profileId, channelId, price.needed],
      );

      return {
        ok: true, extended: extending, membership: joined.rows[0],
        spent: price.needed, standing: price.have,
      };
    }).then(async (result) => {
      if (result.ok) {
        await this.audit(result.extended ? 'member.extended_by_watching' : 'member.joined_by_watching', {
          channelId, tierNo: result.membership.tier_no, viewsSpent: result.spent,
          periodEnd: result.membership.period_end, adMode: result.membership.ad_mode,
        }, { actorId: actorId ?? profileId, subjectType: 'channel', subjectId: channelId });
      }
      return result;
    });
  },

  /**
   * What a members-only file is, from one viewer's position: the rule in
   * `memberships.js` applied to the rows that decide it.
   *
   * Returns the door AND the membership, because every caller needs both: the
   * content route wants to know whether to release bytes, the asset page wants to
   * say which of the three situations this person is in, and the door in
   * `startUnlock` wants to know whether the ordinary ask is available to them.
   */
  async memberDoorFor({ profileId, channelId, asset }) {
    if (!profileId || !asset || asset.unlock_mode !== 'members') return { door: 'none', membership: null };
    const membership = await this.membershipFor(profileId, channelId);
    return {
      door: doorFor({ membership, memberTier: Number(asset.member_tier) || 1 }),
      membership,
    };
  },

  /**
   * Remove a tier. Refused while anybody holds it.
   *
   * The database refuses too (the composite foreign key is `on delete restrict`),
   * and this catches that refusal to return a sentence instead of a 500 — but the
   * database is the one that is right: a seller may rename a tier and change what
   * it costs, and may not delete the thing people paid for.
   */
  async deleteMembershipTier({ channelId, tierNo, actorId = null }) {
    const held = await scalar(
      'select count(*)::int from memberships where channel_id = $1 and tier_no = $2',
      [channelId, tierNo],
    );
    if (held) return { ok: false, reason: 'tier-held', holders: held };
    const { rowCount } = await query(
      'delete from membership_tiers where channel_id = $1 and tier_no = $2',
      [channelId, tierNo],
    );
    if (rowCount) {
      await this.audit('member.tier_removed', { tierNo },
        { actorId, subjectType: 'channel', subjectId: channelId });
    }
    return { ok: rowCount > 0, reason: rowCount ? null : 'tier-missing' };
  },

  /**
   * Choose a storefront theme, or go back to the default.
   *
   * Two rules, both here rather than in the route, because both are about the
   * record and not about the form:
   *
   *   * the capability is read from the plan the caller passes in, so a Free store
   *     cannot end up with a theme through some other path later; and
   *   * the audit row carries the PREVIOUS value. "When did my store start looking
   *     like this" is asked after a rebrand, and a row that only says what was set
   *     cannot answer what it was before.
   */
  async setChannelTheme({ channel, capabilities = null, theme, actorId = null }) {
    // `this`, not a second import: the effective plan is the one method that knows
    // about grace periods and pending upgrades, and a capability read anywhere else
    // is a capability that can be granted by a row nobody checked.
    const caps = capabilities ?? this.plan(channel)?.capabilities ?? {};
    if (!canTheme(caps)) return { ok: false, reason: 'theme-plan' };
    const wanted = theme === null ? null : themeOf(theme)?.key ?? null;
    if (theme !== null && !wanted) return { ok: false, reason: 'theme-unknown' };
    // `$2::text` is not decoration: without the cast, Postgres cannot infer the type
    // of a parameter that appears only inside `is null`, and the update fails with
    // 42P18 before it ever reaches the row.
    const row = await one(
      `update channels
          set theme = $2::text,
              theme_set_at = case when $2::text is null then null else now() end,
              updated_at = now()
        where id = $1
        returning theme, theme_set_at`,
      [channel.id, wanted],
    );
    await this.audit('channel.theme_set', { theme: row?.theme ?? null, was: channel.theme ?? null },
      { actorId, subjectType: 'channel', subjectId: channel.id });
    return { ok: true, reason: null, theme: row?.theme ?? null, at: row?.theme_set_at ?? null };
  },

  /** Where the dues go, in the creator's words. Public: that is the point. */
  async setMembershipNote({ channelId, note, actorId = null }) {
    const row = await one(
      'update channels set membership_note = $2, updated_at = now() where id = $1 returning membership_note',
      [channelId, note],
    );
    await this.audit('member.payment_note_set', { note: row?.membership_note ?? null },
      { actorId, subjectType: 'channel', subjectId: channelId });
    return row?.membership_note ?? null;
  },

  membershipFor(profileId, channelId) {
    if (!profileId || !channelId) return Promise.resolve(null);
    return one(
      'select * from memberships where profile_id = $1 and channel_id = $2',
      [profileId, channelId],
    );
  },

  /** Every store a person belongs to, for their own page. */
  membershipsOf(profileId) {
    return many(
      `select m.*, c.slug, c.name, c.avatar_url, c.logo_url,
              t.name as tier_name, t.accent, t.perks, t.dues_npr, t.period_months, t.glyph
         from memberships m
         join channels c on c.id = m.channel_id
         left join membership_tiers t
           on t.channel_id = m.channel_id and t.tier_no = m.tier_no
        where m.profile_id = $1
        order by m.joined_at desc`,
      [profileId],
    );
  },

  /**
   * Say you belong, with the reference for what you sent.
   *
   * One row per (person, store), so this is an upsert rather than a new claim
   * each time: a second attempt after a typo edits the claim instead of stacking
   * a second one in the creator's queue. A rejected claim may be replaced — the
   * person is not left in a state they cannot get out of — and a CONFIRMED one is
   * left alone, because dues already confirmed are not re-claimed by a form.
   */
  async joinMembership({ profileId, channelId, tierNo, tier = null, claim = {} }) {
    const heldTier = tier ?? await one(
      'select * from membership_tiers where channel_id = $1 and tier_no = $2',
      [channelId, tierNo],
    );
    // A tier sold only as "join by watching" has no dues door to claim at. The claim
    // is refused rather than queued: a reference nobody will ever look for is worse
    // than a sentence, and the sentence can say the other door is open. `null` is
    // this method's answer for every refusal (the route checks the same door before
    // it gets here, so the sentence the person reads names the right reason).
    if (heldTier && !doorsOf(heldTier).dues) return null;
    const reference = String(claim.txnReference ?? '').trim().slice(0, 120);
    // A claim without a matchable reference is not a claim: it would sit in the
    // creator's queue asking them to find a payment by description, which is how
    // a queue becomes unanswerable. Refused here as well as at the route, and the
    // database refuses it a third time — this is the one field the whole manual
    // rail hangs on.
    if (reference.length < 4) return null;
    const row = await one(
      `insert into memberships
         (profile_id, channel_id, tier_no, status, amount_npr, method, txn_reference,
          payer_name, payer_number, claimed_at, join_method, ad_mode)
       values ($1, $2, $3, 'pending', $4, $5, $6, $7, $8, now(), 'dues', $9)
       on conflict (profile_id, channel_id) do update
         set tier_no = excluded.tier_no, status = 'pending',
             amount_npr = excluded.amount_npr, method = excluded.method,
             txn_reference = excluded.txn_reference, payer_name = excluded.payer_name,
             payer_number = excluded.payer_number, claimed_at = now(),
             rejected_reason = null
       where memberships.status <> 'active'
       returning *`,
      [profileId, channelId, tierNo, claim.amountNpr ?? null, claim.method ?? null,
        reference || null, claim.payerName ?? null, claim.payerNumber ?? null,
        // The arrangement in force when they claimed. Written on a PENDING row on
        // purpose: the promise belongs to the moment the join panel was read, and
        // confirmation months later must not quietly downgrade it because the seller
        // changed the tier in between.
        adModeOf(heldTier)],
    );
    return row ?? null;
  },

  /**
   * The creator looked at their own statement and found it.
   *
   * Two rules live in this statement rather than in the route above it:
   *
   *   * `confirmed_by` must be the channel's owner. Not by policy — an operator
   *     cannot do it at all, because this money never reached the platform and
   *     nobody here can see a statement that contains it. The `exists` clause is
   *     the sentence "only the creator can confirm this" written as SQL.
   *   * A period is ADDED to whatever time is left, never in place of it. A
   *     member who pays early keeps the days they already paid for — the same
   *     rule Patreon documents when a membership changes, and the reason this is
   *     `greatest(coalesce(period_end, now()), now())` rather than `now()`.
   */
  async confirmMembership({ profileId, channelId, ownerId, actorId = null }) {
    const row = await one(
      `update memberships m
          set status = 'active',
              confirmed_at = now(),
              confirmed_by = $3,
              rejected_reason = null,
              period_end = greatest(coalesce(m.period_end, now()), now())
                           + make_interval(months => (select t.period_months
                                                        from membership_tiers t
                                                       where t.channel_id = m.channel_id
                                                         and t.tier_no = m.tier_no))
        where m.profile_id = $1
          and m.channel_id = $2
          and m.status = 'pending'
          and exists (select 1 from channels c where c.id = m.channel_id and c.owner_id = $3)
        returning *`,
      [profileId, channelId, ownerId],
    );
    if (!row) return null;
    await this.audit('member.confirmed', {
      tierNo: row.tier_no, amountNpr: row.amount_npr, txnReference: row.txn_reference,
      periodEnd: row.period_end, channelId,
    }, { actorId: actorId ?? ownerId, subjectType: 'profile', subjectId: profileId });
    return row;
  },

  /** The creator looked and did not find it. The reason is for the member. */
  async rejectMembership({ profileId, channelId, ownerId, reason = null, actorId = null }) {
    const row = await one(
      `update memberships m
          set status = 'rejected', rejected_reason = $4, confirmed_at = null,
              confirmed_by = null, period_end = null
        where m.profile_id = $1 and m.channel_id = $2 and m.status = 'pending'
          and exists (select 1 from channels c where c.id = m.channel_id and c.owner_id = $3)
        returning *`,
      [profileId, channelId, ownerId, String(reason || '').trim().slice(0, 200) || null],
    );
    if (!row) return null;
    await this.audit('member.rejected', { reason: row.rejected_reason, channelId },
      { actorId: actorId ?? ownerId, subjectType: 'profile', subjectId: profileId });
    return row;
  },

  /**
   * Leave. A delete, because that is what a person means by it.
   *
   * The audit row stays, so the creator's record of who paid and when survives
   * the leaving — and the unlock rows a membership wrote are left to expire with
   * the period rather than being ripped out early. Nobody's library should go
   * blank because a person clicked "leave" while their dues were still running.
   */
  async leaveMembership(profileId, channelId) {
    const row = await one(
      'delete from memberships where profile_id = $1 and channel_id = $2 returning *',
      [profileId, channelId],
    );
    if (row) {
      await this.audit('member.left', { tierNo: row.tier_no, status: row.status, channelId },
        { actorId: profileId, subjectType: 'channel', subjectId: channelId });
    }
    return Boolean(row);
  },

  /**
   * The creator's queue: claims waiting to be checked against a statement.
   * Oldest first, because a person who sent money yesterday should not be behind
   * one who sent it today.
   */
  pendingMemberships(channelId) {
    return many(
      // The look rides here for the same reason it rides on the roster and the member
      // list: this row is drawn on the seller's OWN page, and the name on it is a person
      // the platform is showing to somebody else. Whether these dues have been confirmed
      // has nothing to do with whether that person pays bytebikri for a look — the two
      // payers are unrelated — so a member waiting on their store's confirmation still
      // wears the palette they bought, and the join decides that, not the row's status.
      `select m.*, p.display_name, p.email, t.name as tier_name, t.accent, t.dues_npr, t.period_months,
              t.glyph,
              p.nameplate, p.plus_effect as plus_effect,
              p.plus_ring as plus_ring, p.plus_frame as plus_frame,
              pl.plus_status, pl.plus_period_end
         from memberships m
         join profiles p on p.id = m.profile_id
         left join membership_tiers t
           on t.channel_id = m.channel_id and t.tier_no = m.tier_no
         ${PLUS_JOIN}
        where m.channel_id = $1 and m.status = 'pending'
        order by m.claimed_at asc nulls last`,
      [channelId],
    );
  },

  /** Everyone who is in, current or not, for the seller's own page. */
  membersOfChannel(channelId) {
    return many(
      // The look rides on this query because the seller's queue RENDERS it: the page
      // passes each row to `memberPlate()`, and until these columns were selected the
      // renderer was handed a row with no palette, no effect, no ring and no frame — so
      // a paying member appeared on the seller's own list wearing nothing, while the
      // same person wore their whole look on the storefront two pages away. A field the
      // renderer reads has to be a field the query returns; the aliases here follow the
      // roster's rule (`nameplate`, because that is the name `plusWear()` reads).
      `select m.*, p.display_name, p.email, t.name as tier_name, t.accent, t.dues_npr, t.glyph,
              p.nameplate, p.plus_effect as plus_effect,
              p.plus_ring as plus_ring, p.plus_frame as plus_frame,
              pl.plus_status, pl.plus_period_end
         from memberships m
         join profiles p on p.id = m.profile_id
         left join membership_tiers t
           on t.channel_id = m.channel_id and t.tier_no = m.tier_no
         ${PLUS_JOIN}
        where m.channel_id = $1
        order by m.joined_at desc`,
      [channelId],
    );
  },

  /**
   * Being named on the storefront is the MEMBER's own choice, made on their side and
   * changeable by them. The store cannot name somebody or unname them: the roster is the
   * list of people who said yes. (This comment used to read "being named is the perk",
   * which handed the store a member's perk — the person's look is theirs, bought from
   * bytebikri, and the store's own contribution is the tier chip.)
   */
  async setMemberListed({ profileId, channelId, listed }) {
    const row = await one(
      `update memberships set publicly_listed = $3
        where profile_id = $1 and channel_id = $2
        returning publicly_listed`,
      [profileId, channelId, Boolean(listed)],
    );
    return row ? row.publicly_listed : null;
  },

  /**
   * The storefront's roster: confirmed members who chose to be named.
   *
   * No count is returned. A membership count is a vanity metric that changes who
   * asks to join (the same reason the follower count is not on the page, 0029),
   * and the plates themselves are the social proof.
   */
  publicRoster(channelId, { limit = 12 } = {}) {
    return many(
      `select m.profile_id, m.tier_no, m.joined_at, p.display_name,
              coalesce(t.name, 'Member') as tier_name, coalesce(t.accent, 'indigo') as accent,
              t.glyph,
              -- Their own look, worn only while their own plan is active. Two
              -- things are being rendered on one plate (a store's tier and the
              -- person's own palette) and they come from two different payments to
              -- two different parties — which is exactly why they are two columns.
              -- Plain nameplate, NOT plus_plate: plusWear() reads this field by that
              -- name, and the alias this used to carry meant every dressed member's
              -- name on a store's roster silently fell back to indigo while their
              -- palette sat in the row beside it. (The reviews query below keeps its
              -- own alias because its renderer maps it explicitly.)
              p.nameplate, p.plus_effect as plus_effect,
              -- The two outer layers of the person's own look travel with them onto a
              -- store's roster, the same way the palette does: the card is a rendering
              -- of the person, not a surface of the store's.
              p.plus_ring as plus_ring, p.plus_frame as plus_frame,
              pl.plus_status, pl.plus_period_end
         from memberships m
         join profiles p on p.id = m.profile_id
         left join membership_tiers t
           on t.channel_id = m.channel_id and t.tier_no = m.tier_no
         ${PLUS_JOIN}
        where m.channel_id = $1 and m.status = 'active' and m.publicly_listed
        order by m.joined_at desc
        limit $2`,
      [channelId, limit],
    );
  },

  /**
   * Which of a store's files a membership tier already opens.
   *
   * One query for a whole storefront rather than one per file: the page needs a
   * set, and a set is what the browse page's `unlockedIds` already is.
   */
  memberOpenAssetIds(channelId, tierNo) {
    return many(
      `select id from assets
        where channel_id = $1 and unlock_mode = 'members' and member_tier <= $2`,
      [channelId, Number(tierNo) || 1],
    );
  },

  /**
   * Write the unlock a membership is worth, without ever shortening one.
   *
   * Deliberately NOT `grantUnlock`: that one writes `excluded.expires_at` over
   * whatever was there, which would cut a permanent unlock or an ad-won window
   * down to the membership's end date. Here the expiry only ever moves forward,
   * and the method is left alone — the honest answer to "why can I open this" is
   * the first reason that was true.
   */
  async grantMembershipUnlock({ assetId, channelId, userId, expiresAt }) {
    if (!expiresAt) return null;
    const { rows } = await query(
      `insert into unlocks (asset_id, channel_id, user_id, method, ads_completed, expires_at)
       values ($1, $2, $3, 'membership', 0, $4)
       on conflict (asset_id, user_id) do update
         set expires_at = case when unlocks.expires_at is null then null
                               else greatest(unlocks.expires_at, excluded.expires_at) end,
             revoked_at = null, revoked_reason = null
       returning *`,
      [assetId, channelId, userId, expiresAt],
    );
    return rows[0];
  },

  /**
   * Does this person's membership currently open this file? For routes that need
   * the answer without writing anything (the asset page, the storefront).
   */
  async memberCoversAsset({ profileId, channelId, asset }) {
    // Delegates, rather than restating the three conditions: whether a membership
    // opens a file is one rule, and the `supporter` arrangement is the fourth case
    // it now has to answer. A second copy of "status is active and the period has
    // not run out" is how the two copies stop agreeing.
    const { door, membership } = await this.memberDoorFor({ profileId, channelId, asset });
    return door === 'covered' ? membership : null;
  },

  // ---- pending ad views (awaiting a signed postback) ----------------------
  async createPendingView(v) {
    return one(
      // Where this attempt's stop is, recorded when the attempt is MADE rather than
      // derived when its view is claimed: the plan that built the cue list is the only
      // thing that knows whether this is a mid-roll or a chapter boundary, and a plan
      // edited mid-watch would make a later guess wrong. The ledger groups by these two
      // columns, so getting them at the source is the difference between a count and an
      // opinion (ASSET_ECONOMY.md §12).
      `insert into pending_views
         (nonce, asset_id, channel_id, user_id, connection_id, provider_id, required_ads,
          ad_min_seconds, break_index, break_at_sec, placement, surface)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       returning *`,
      [v.nonce, v.asset_id, v.channel_id, v.user_id, v.connection_id, v.provider_id,
       v.required_ads ?? 1, v.ad_min_seconds ?? 15, v.break_index ?? null, v.break_at_sec ?? null,
       v.placement ?? null, v.surface ?? null],
    );
  },

  /**
   * The shape of an asset, derived from the files it carries.
   *
   * One place, because four now read it: the storefront card, the section it sits
   * in, the seller's placement panel, and the planner. A second copy of this rule
   * is how a file ends up listed under "Watch" and planned as a download.
   */
  async shapeOf(asset) {
    if (!asset) return null;
    return assetShape(await this.filesOf(asset.id), { url: asset.external_url });
  },
  async pendingView(viewId) {
    if (!UUID_RE.test(String(viewId || ''))) return null;
    return one('select * from pending_views where id = $1', [viewId]);
  },
  /**
   * The attempt this person already has open on this file, if any.
   *
   * An ask is a server row, not a browser idea, so a person who reloads — or
   * closes the tab and comes back — must not be made to watch what they already
   * watched. There is at most one of these per (file, person) that matters: the
   * oldest stale ones are removed by the sweep, which is why the unlock path
   * runs it before creating anything.
   */
  async openAttemptFor({ assetId, userId }) {
    return one(
      `select * from pending_views
        where asset_id = $1 and user_id = $2 and completed = false
        order by created_at desc
        limit 1`,
      [assetId, userId],
    );
  },
  async completePendingView(viewId, client) {
    const run = (client || { query }).query.bind(client || { query });
    const { rows } = await run(
      `update pending_views set completed = true, completed_at = now()
        where id = $1 returning *`,
      [viewId],
    );
    return rows[0] ?? null;
  },
  /**
   * Views the user started but never finished. Each one is a row, and minting
   * is unauthenticated-ish by nature, so this bounds the garbage.
   */
  async sweepStalePendingViews({ olderThanHours = 6 } = {}) {
    const n = await scalar(
      `with gone as (
         delete from pending_views
          where completed = false and created_at < now() - ($1 || ' hours')::interval
          returning 1)
       select count(*)::int from gone`,
      [String(olderThanHours)],
    );
    return n;
  },

  // ---- ad view events ----------------------------------------------------
  /**
   * Claim a completed view.
   *
   * THE ATOMIC OPERATION the whole postback path rests on. Insert-first, and let
   * the unique index decide the race. The previous version did
   * `if (adViews().some(...externalId)) return duplicate` and then inserted —
   * check-then-act. Two concurrent deliveries both pass the check and both
   * proceed, which is precisely what a provider retry produces.
   *
   * Returns { claimed: false } when another delivery already owns this event.
   * Must be called inside the same transaction as the grant.
   */
  async claimAdView(e, client) {
    const run = (client || { query }).query.bind(client || { query });
    const { rows } = await run(
      `insert into ad_view_events
         (channel_id, user_id, asset_id, connection_id, provider_id, external_id,
          kind, state, completed, duration_sec, revenue_usd, meta, signature_ok,
          pending_view_id, placement, surface)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, true, $13, $14, $15)
       on conflict (connection_id, external_id) do nothing
       returning *`,
      [
        e.channel_id, e.user_id, e.asset_id, e.connection_id, e.provider_id, e.external_id ?? null,
        e.kind ?? 'rewarded', e.state ?? 'complete', e.completed ?? false,
        e.duration_sec ?? null, e.revenue_usd ?? null, JSON.stringify(e.meta ?? {}),
        // Which attempt this delivery counts toward. Null is legitimate: a
        // provider that echoes a user id instead of our view id still produces a
        // billable event, and dropping it would be dropping the creator's money.
        e.pending_view_id ?? null,
        // Where it sat, in the same statement that says it happened — a second
        // write could fail apart from this one and leave a view with no place.
        e.placement ?? null, e.surface ?? null,
      ],
    );
    // No row returned means the unique index rejected it: already claimed.
    if (!rows.length) return { claimed: false };
    /*
     * The same transaction that records the view credits the person's standing with
     * the store — for every completed view, whichever door it was asked at, because
     * the two are the same act by the same person for the same shop.
     *
     * Here rather than in the postback handler, and deliberately: this is the one
     * statement in the codebase that is allowed to say a view happened, so a
     * counter that reads from anywhere else could count something a network never
     * confirmed. A refused or partial state is passed in as `completed: false` and
     * accrues nothing.
     */
    if (e.completed === true && e.user_id && e.channel_id) {
      await this.accrueStanding({ profileId: e.user_id, channelId: e.channel_id }, client);
    }
    return { claimed: true, event: rows[0] };
  },

  /**
   * Completed deliveries for ONE unlock attempt — the number the grant waits for.
   *
   * Read inside the grant's transaction, after the attempt row has been locked
   * (`lockPendingView`), so two postbacks arriving at the same instant from the
   * same network cannot each see one view and both decline to release the file.
   * The count is over `completed = true` only: a 'skip' or a 'declined' delivery
   * is recorded, is evidence, and is not a view the person sat through.
   */
  async completedViewsForPendingView(pendingViewId, client) {
    const run = (client || { query }).query.bind(client || { query });
    const { rows } = await run(
      `select count(*)::int as n from ad_view_events
        where pending_view_id = $1 and completed = true`,
      [pendingViewId],
    );
    return rows[0]?.n ?? 0;
  },

  /**
   * The attempt, locked for the duration of the transaction that decides it.
   *
   * `for update` is the whole point: the grant is a read-then-act on the count of
   * deliveries, and a read-then-act without a lock is the bug this file already
   * has a comment about (see `claimAdView`). Here the lock is on the attempt
   * rather than the delivery, because the attempt is the thing being decided.
   */
  async lockPendingView(viewId, client) {
    const run = (client || { query }).query.bind(client || { query });
    const { rows } = await run(
      'select * from pending_views where id = $1 for update',
      [viewId],
    );
    return rows[0] ?? null;
  },
  adViews({ channelId, limit = 500 } = {}) {
    return many(
      `select * from ad_view_events
        where ($1::uuid is null or channel_id = $1)
        order by created_at desc limit $2`,
      [channelId ?? null, limit],
    );
  },
  // ---- earnings: what the network says, never what we hold ----------------
  /**
   * Completed views and provider-reported revenue, per provider, for a window.
   *
   * `estimate_usd` is OURS and is arithmetic on the configured assumed rate —
   * `revenue_usd` is whatever a provider put in a signed postback, and is
   * frequently null because most networks settle monthly in a portal rather than
   * per view. The two are returned side by side, never blended: a single
   * "earnings" number that mixes a real report with our own arithmetic is how a
   * dashboard starts lying without a line of it being false.
   *
   * Unlocks are joined in because they are the creator's own measure of value —
   * "someone watched an ad for this file" — and views are the network's count of
   * the same event. When they diverge, that is information.
   */
  earningsByProvider({ channelId, days = 30, rpmUsd = 0.2 }) {
    return many(
      `with win as (
         select now() - ($2 || ' days')::interval as since
       ),
       views as (
         select e.provider_id,
                count(*)::int                     as views,
                coalesce(sum(e.revenue_usd), 0)   as reported_usd
           from ad_view_events e, win
          where e.channel_id = $1 and e.completed and e.created_at >= win.since
          group by e.provider_id
       ),
       unlocks as (
         select u.method,
                count(*)::int as unlocks
           from unlocks u, win
          where u.channel_id = $1 and u.revoked_at is null
            and u.granted_at >= win.since
          group by u.method
       )
       select coalesce(v.provider_id, 'unreported') as provider_id,
              coalesce(v.views, 0)                  as views,
              coalesce(v.reported_usd, 0)           as reported_usd,
              round((coalesce(v.views, 0) / 1000.0 * $3)::numeric, 4) as estimate_usd,
              -- Unlocks are the creator's own count of "somebody watched an ad
              -- for this"; views are the network's count of the same event. Both
              -- are shown, and neither is presented as the other.
              (select coalesce(sum(unlocks)::int, 0) from unlocks) as unlocks
         from views v
        where v.provider_id is not null
        order by views desc`,
      [channelId, String(days), rpmUsd],
    );
  },

  /**
   * Per-asset breakdown: which file people watch an ad for.
   *
   * The seller's only real question is which of their files is worth making
   * more of, and the answer is not total views — it is views per file, with the
   * files that have none visible too. Left-joining assets keeps the zeroes.
   */
  earningsByAsset({ channelId, days = 30, rpmUsd = 0.2, limit = 50 }) {
    return many(
      `select a.id as asset_id, a.title, a.slug, a.unlock_mode, a.status,
              coalesce(v.views, 0)::int      as views,
              coalesce(u.unlocks, 0)::int    as unlocks,
              round((coalesce(v.views, 0) / 1000.0 * $3)::numeric, 4) as estimate_usd
         from assets a
         left join (
           select asset_id, count(*)::int as views
             from ad_view_events
            where channel_id = $1 and completed
              and created_at >= now() - ($2 || ' days')::interval
            group by asset_id
         ) v on v.asset_id = a.id
         left join (
           select asset_id, count(*)::int as unlocks
             from unlocks
            where channel_id = $1 and revoked_at is null
              and granted_at >= now() - ($2 || ' days')::interval
            group by asset_id
         ) u on u.asset_id = a.id
        where a.channel_id = $1 and a.status <> 'removed'
        order by coalesce(v.views, 0) desc, a.created_at desc
        limit $4`,
      [channelId, String(days), rpmUsd, limit],
    );
  },

  // ---- payout accounts: a note, not an account ---------------------------
  /**
   * Which of the creator's OWN accounts the network pays into.
   *
   * A label they typed and the method name, and nothing else. This row cannot
   * move money, cannot be used to authenticate anywhere, and is not the
   * network's record — it is so that a creator can look at this page in six
   * months and remember which account they set up, which is the question every
   * support ticket about ad revenue actually asks.
   */
  payoutAccountsOf(channelId) {
    return many(
      'select * from payout_accounts where channel_id = $1 order by provider_id',
      [channelId],
    );
  },

  async setPayoutAccount({ channelId, providerId, accountLabel, payoutMethod = null, note = null }) {
    const label = String(accountLabel || '').trim().slice(0, 120);
    if (!label) return null;
    return one(
      `insert into payout_accounts (channel_id, provider_id, account_label, payout_method, note)
       values ($1, $2, $3, $4, $5)
       on conflict (channel_id, provider_id) do update
         set account_label = excluded.account_label,
             payout_method = excluded.payout_method,
             note          = excluded.note,
             status        = case when payout_accounts.account_label is distinct from excluded.account_label
                                  then 'changed' else payout_accounts.status end,
             updated_at    = now()
       returning *`,
      [channelId, String(providerId).slice(0, 60), label,
        payoutMethod ? String(payoutMethod).trim().slice(0, 60) : null,
        note ? String(note).trim().slice(0, 300) : null],
    );
  },

  async clearPayoutAccount({ channelId, providerId }) {
    return one(
      'delete from payout_accounts where channel_id = $1 and provider_id = $2 returning *',
      [channelId, providerId],
    );
  },

  // ---- what the network actually paid ------------------------------------
  reportsOfChannel(channelId, { limit = 60 } = {}) {
    return many(
      `select * from provider_reports
        where channel_id = $1 order by period_start desc limit $2`,
      [channelId, limit],
    );
  },

  /**
   * Record a figure from the creator's statement.
   *
   * One figure per provider per period start, so a correction replaces the
   * earlier number instead of sitting beside it. A reconciliation that can hold
   * two answers for one month is a reconciliation nobody can act on.
   */
  async addProviderReport({ channelId, providerId, periodStart, periodEnd, reportedUsd, note = null }) {
    const amount = Number(reportedUsd);
    if (!Number.isFinite(amount) || amount < 0) return null;
    const start = String(periodStart || '').slice(0, 10);
    const end = String(periodEnd || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) return null;
    if (end < start) return null;
    return one(
      `insert into provider_reports (channel_id, provider_id, period_start, period_end, reported_usd, note)
       values ($1, $2, $3, $4, $5, $6)
       on conflict (channel_id, provider_id, period_start) do update
         set period_end   = excluded.period_end,
             reported_usd = excluded.reported_usd,
             note         = excluded.note
       returning *`,
      [channelId, String(providerId).slice(0, 60), start, end,
        Math.round(amount * 100) / 100, note ? String(note).trim().slice(0, 300) : null],
    );
  },

  async adViewsOfUser(userId, sinceHours = 24) {
    return many(
      `select * from ad_view_events
        where user_id = $1 and created_at > now() - ($2 || ' hours')::interval`,
      [userId, String(sinceHours)],
    );
  },
  /** Completed views for one asset by one user in the last 24h — the daily cap. */
  async completedViewsToday(assetId, userId) {
    return scalar(
      `select count(*)::int from ad_view_events
        where asset_id = $1 and user_id = $2 and completed = true
          and created_at > now() - interval '24 hours'`,
      [assetId, userId],
    );
  },

  // ---- traffic -----------------------------------------------------------
  /**
   * Upsert with an atomic increment. `pageviews = pageviews + 1` in SQL, not
   * read-modify-write in JS.
   */
  /**
   * The schema keeps `views`, `web_views` and `app_views` separately — which is
   * better than one counter, because a native-app page view and a web one have
   * different advertiser value and the traffic band bills on them differently.
   * A web hit increments both the total and the web column.
   */
  async bumpPageView(channelId, surface = 'web') {
    await query(
      `insert into page_view_daily (channel_id, day, views, web_views, unique_visitors)
       values ($1, current_date, 1, $2, 1)
       on conflict (channel_id, day) do update
         set views     = page_view_daily.views + 1,
             web_views = page_view_daily.web_views + $2,
             app_views = page_view_daily.app_views + $3`,
      [channelId, surface === 'web' ? 1 : 0, surface === 'app' ? 1 : 0],
    );
  },
  async pageviews30d(channelId) {
    return pgNum(await scalar(
      `select coalesce(sum(views), 0)::bigint from page_view_daily
        where channel_id = $1 and day > current_date - 30`,
      [channelId],
    ));
  },

  // ---- the attention ledger (ASSET_ECONOMY.md §12) ------------------------
  /**
   * Count the positions a page actually drew.
   *
   * Called at render with the slots that survived to the markup, never with the
   * slots that were allocated: a storefront hides an empty store slot, and a box
   * that did not reach the page is not an impression. One upsert per page render,
   * with SQL doing the adding — the same shape and the same reason as
   * `bumpPageView`.
   *
   * `side` comes from the slot's own `payoutParty`, so whose inventory a position
   * is stays one rule in one place. `channelId` is null for the platform's own
   * pages, which have no store to attribute a position to.
   *
   * This is a count of RENDERED POSITIONS, not of people: a refresh counts, and so
   * does the owner looking at their own shop. The page says so in words, which is
   * what keeps the number evidence rather than a claim.
   */
  async recordPositions(channelId, rows = []) {
    const counted = rows.filter((r) => r && r.surface && r.placement);
    if (!counted.length) return 0;
    // Grouped by the table's own grain first, so the two boxes of one page with the
    // same shape are one increment rather than a race between two upserts of the
    // same key inside one statement.
    const byKey = new Map();
    for (const r of counted) {
      const key = [r.surface, r.placement, r.side].join('\u0000');
      byKey.set(key, (byKey.get(key) ?? 0) + (Number(r.impressions) || 1));
    }
    const surfaces = [], placements = [], sides = [], counts = [];
    for (const [key, n] of byKey) {
      const [surface, placement, side] = key.split('\u0000');
      surfaces.push(surface); placements.push(placement); sides.push(side); counts.push(n);
    }
    await query(
      `insert into ad_position_daily (channel_id, day, surface, placement, side, impressions)
       select $1, current_date, s.surface, s.placement, s.side, s.n
         from unnest($2::text[], $3::text[], $4::text[], $5::bigint[])
              as s(surface, placement, side, n)
       on conflict (channel_id, day, surface, placement, side) do update
         set impressions = ad_position_daily.impressions + excluded.impressions`,
      [channelId ?? null, surfaces, placements, sides, counts],
    );
    return counted.length;
  },

  /**
   * The ledger, in the two blocks the page renders (ASSET_ECONOMY.md §12).
   *
   * `watched` — verified views on this store's files, by page kind and placement.
   * A network's own postbacks, so this is the store's inventory and the number the
   * network pays on; the seconds are the players' reported durations and are blank
   * for a view that never reported one.
   *
   * `drawn` — positions rendered on this store's pages, by page kind, placement and
   * side. It is our count of our own drawing, kept apart from the block above and
   * never added to it: a rendered position is not a view, ours is not theirs, and a
   * total of the two would be a number with no meaning behind it.
   */
  async attentionLedger(channelId, { days = 30 } = {}) {
    const watched = await many(
      `select surface, placement,
              count(*)::int as views,
              coalesce(sum(duration_sec), 0)::int as seconds,
              count(*) filter (where duration_sec is null)::int as unmeasured
         from ad_view_events
        where channel_id = $1 and completed = true
          and created_at > now() - ($2::int * interval '1 day')
        group by surface, placement
        order by views desc, surface, placement`,
      [channelId, days],
    );
    const drawn = await many(
      `select surface, placement, side, sum(impressions)::bigint as impressions
         from ad_position_daily
        where channel_id = $1 and day > current_date - $2::int
        group by surface, placement, side
        order by side, impressions desc, surface, placement`,
      [channelId, days],
    );
    const totals = await one(
      `select (select count(*)::int from ad_view_events
                where channel_id = $1 and completed = true
                  and created_at > now() - ($2::int * interval '1 day')) as views,
              (select coalesce(sum(duration_sec), 0)::int from ad_view_events
                where channel_id = $1 and completed = true
                  and created_at > now() - ($2::int * interval '1 day')) as seconds,
              (select coalesce(sum(impressions), 0)::bigint from ad_position_daily
                where channel_id = $1 and side = 'platform'
                  and day > current_date - $2::int) as platform_impressions,
              (select coalesce(sum(impressions), 0)::bigint from ad_position_daily
                where channel_id = $1 and side = 'store'
                  and day > current_date - $2::int) as store_impressions`,
      [channelId, days],
    );
    return { days, watched: watched ?? [], drawn: drawn ?? [], totals: totals ?? {} };
  },

  /**
   * A day-by-day traffic series, one row per calendar day, INCLUDING the days
   * with no row at all.
   *
   * `generate_series` is the point of this query. The daily table only holds days
   * something happened, so reading it directly would draw a chart that closes the
   * gaps — and a chart that closes a gap is claiming traffic on a day we did not
   * measure. Each point carries `measured` so the drawing code can tell "we
   * recorded nothing" apart from "we recorded zero", which are different facts
   * and the research says so out loud.
   *
   * `unlocks` comes from a separate table on purpose: unlocks are events, not
   * aggregates, and summing them per day is exact.
   */
  async trafficSeries(channelId, { days = 30 } = {}) {
    const window = Math.min(Math.max(Number(days) || 30, 7), 90);
    return many(
      `with span as (
         select generate_series(current_date - ($2::int - 1), current_date, interval '1 day')::date as day
       )
       select span.day,
              pvd.views,
              (pvd.channel_id is not null) as measured,
              coalesce(u.n, 0)::int       as unlocks
         from span
         left join page_view_daily pvd on pvd.channel_id = $1 and pvd.day = span.day
         left join lateral (
           select count(*) as n from unlocks x
            join assets a on a.id = x.asset_id
           where a.channel_id = $1
             and x.revoked_at is null
             and x.granted_at >= span.day
             and x.granted_at < span.day + 1
         ) u on true
        order by span.day`,
      [channelId, window],
    ).then((rows) => rows.map((r) => ({
      day: r.day instanceof Date ? r.day.toISOString().slice(0, 10) : String(r.day).slice(0, 10),
      views: r.views === null ? null : Number(r.views),
      unlocks: Number(r.unlocks) || 0,
      measured: r.measured === true,
    })));
  },

  /**
   * The same series, per file, for the little charts beside each one.
   *
   * One query for every file rather than one per row: a dashboard with nine files
   * must not cost nine round trips. Days with no events are absent here on
   * purpose — the caller pads them, so the shape of a file's month is drawn
   * against the same 30-day window as every other file and as the store's own
   * chart. Comparing two charts on different axes is how a dashboard lies.
   */
  assetAdViewSeries(channelId, { days = 30 } = {}) {
    const window = Math.min(Math.max(Number(days) || 30, 7), 90);
    return many(
      `select a.id as asset_id, d.day::date as day, count(*)::int as views
         from assets a
         cross join generate_series((current_date - ($2::int - 1))::timestamp,
                                    current_date::timestamp, interval '1 day') d(day)
         left join ad_view_events e
                on e.asset_id = a.id and e.completed
               and e.created_at >= d.day and e.created_at < d.day + interval '1 day'
        where a.channel_id = $1
        group by a.id, d.day
        order by a.id, d.day`,
      [channelId, window],
    ).then((rows) => {
      const byAsset = new Map();
      for (const r of rows) {
        const key = r.asset_id;
        if (!byAsset.has(key)) byAsset.set(key, []);
        const day = r.day instanceof Date ? r.day.toISOString().slice(0, 10) : String(r.day).slice(0, 10);
        byAsset.get(key).push({ day, views: Number(r.views) || 0 });
      }
      return byAsset;
    });
  },

  // ---- plan payments (money INTO bytebikri — being paid, not holding) -----
  /**
   * A payment attaches to a SUBSCRIPTION, not to a channel. That is the schema's
   * modelling and it is right: the subscription is what the payment buys, and it
   * carries the period the money covers.
   */
  async recordPlanPayment({ channelId, amountNpr, txnReference, method = 'esewa', payerName, payerNumber }) {
    if (String(txnReference || '').trim().length < 4) return null;
    return one(
      `insert into plan_payments (subscription_id, amount_npr, txn_reference, method, payer_name, payer_number)
       select s.id, $2, $3, $4, $5, $6
         from subscriptions s
        where s.channel_id = $1
          and s.pending_plan_code is not null
       returning *`,
      [channelId, amountNpr, txnReference, method, payerName ?? null, payerNumber ?? null],
    );
  },
  planPayments() {
    return many('select * from plan_payments order by created_at desc');
  },

  /**
   * What the platform has actually been paid, and by how many stores.
   *
   * Read from the same tables the seller's billing page reads, so the console
   * cannot claim money the ledger does not show. `matched` is what a person has
   * confirmed against the statement; anything else is a request, not revenue.
   */
  platformMoney() {
    return one(
      `select
         coalesce((select sum(amount_npr) from plan_payments
                    where status = 'matched'
                      and matched_at >= date_trunc('month', now())), 0)::int as matched_this_month,
         coalesce((select sum(amount_npr) from rent_invoices
                    where status = 'paid'
                      and paid_at >= date_trunc('month', now())), 0)::int as rent_this_month,
         coalesce((select sum(amount_npr) from rent_invoices
                    where status = any($1) and due_at < current_date), 0)::int as rent_late_npr,
         (select count(*)::int from rent_invoices
           where status = any($1) and due_at < current_date) as rent_late_count,
         (select count(*)::int from rent_invoices where status = any($1)) as rent_open_count,
         (select count(distinct channel_id) from subscriptions
           where status in ('active','grace') and plan_code <> 'free')::int as paying_stores,
         (select count(*) from channels where moderation_state <> 'removed')::int as stores,
         (select count(*) from subscriptions where status = 'active' and plan_code <> 'free')::int as active_subs,
         -- The third charge. Read here rather than derived on the page, so the
         -- console's total is the same arithmetic the payments queue shows.
         coalesce((select sum(amount_npr) from customer_plan_payments
                    where status = 'matched'
                      and matched_at >= date_trunc('month', now())), 0)::int as plus_this_month,
         (select count(*)::int from customer_subscriptions
           where status = 'active' and period_end > now()) as plus_active,
         -- Lapsed is derived the way every clock in this codebase is derived: a row
         -- that says active with a period in the past IS lapsed, and nothing sweeps it.
         (select count(*)::int from customer_subscriptions
           where status = 'active' and (period_end is null or period_end <= now())) as plus_lapsed,
         (select count(*)::int from customer_subscriptions where status = 'pending_payment') as plus_pending,
         -- The gifts, by the four states a gift has. Split rather than summed because
         -- "waiting for an operator" and "waiting for a person to use it" are two
         -- different jobs, and the console is where the first one is worked.
         (select count(*)::int from customer_plan_gifts where status = 'reserved') as gifts_reserved,
         (select count(*)::int from customer_plan_gifts where status = 'funded') as gifts_ready,
         (select count(*)::int from customer_plan_gifts where status = 'redeemed') as gifts_redeemed,
         (select count(*)::int from customer_plan_gifts where status = 'void') as gifts_void`,
      [OPEN_RENT_STATUSES],
    ).then((r) => ({
      matchedThisMonthNpr: Number(r?.matched_this_month || 0),
      rentThisMonthNpr: Number(r?.rent_this_month || 0),
      rentLateNpr: Number(r?.rent_late_npr || 0),
      rentLateCount: Number(r?.rent_late_count || 0),
      rentOpenCount: Number(r?.rent_open_count || 0),
      payingStores: Number(r?.paying_stores || 0),
      stores: Number(r?.stores || 0),
      activeSubs: Number(r?.active_subs || 0),
      plusThisMonthNpr: Number(r?.plus_this_month || 0),
      plusActive: Number(r?.plus_active || 0),
      plusLapsed: Number(r?.plus_lapsed || 0),
      plusPending: Number(r?.plus_pending || 0),
      giftsReserved: Number(r?.gifts_reserved || 0),
      giftsReady: Number(r?.gifts_ready || 0),
      giftsRedeemed: Number(r?.gifts_redeemed || 0),
      giftsVoid: Number(r?.gifts_void || 0),
    }));
  },

  // ---- when an ad does not arrive ------------------------------------------
  //
  // One row per failed attempt, and a count read back. Deliberately no browser
  // fingerprint and no user agent: `src/blocked.js` explains why the ladder is
  // built on "the view did not confirm" rather than on "this looks like Brave".

  recordBlockSignal({ assetId = null, channelId = null, userId = null, pendingViewId = null, signal = 'unknown' }) {
    const kind = SIGNALS.includes(String(signal)) ? String(signal) : 'unknown';
    return one(
      `insert into ad_block_signals (asset_id, channel_id, user_id, pending_view_id, signal)
       values ($1, $2, $3, $4, $5)
       returning id, signal, created_at`,
      [assetId, channelId, userId, pendingViewId, kind],
    );
  },

  /**
   * How many blocking attempts this person has made on this file inside the window.
   *
   * `declined` is excluded in SQL rather than at the call site, so the ladder cannot
   * be climbed by somebody who merely changed their mind about watching an ad.
   */
  blockSignalCount({ assetId, userId, hours = 6 }) {
    return scalar(
      `select count(*)::int from ad_block_signals
        where asset_id = $1 and user_id = $2
          and signal <> 'declined'
          and created_at > now() - ($3 || ' hours')::interval`,
      [assetId, userId, String(hours)],
    ).then((n) => Number(n) || 0);
  },

  /** The same fact for the seller's dashboard: a count, per store, per window. */
  blockSignalCountOfChannel(channelId, { hours = 6 } = {}) {
    return scalar(
      `select count(*)::int from ad_block_signals
        where channel_id = $1
          and signal <> 'declined'
          and created_at > now() - ($2 || ' hours')::interval`,
      [channelId, String(hours)],
    ).then((n) => Number(n) || 0);
  },

  // ---- ByteBikri Plus: what a PERSON buys from the platform -----------------
  //
  // Deliberately the same shape as the store side (a plan row, a subscription, a
  // payment claim an operator matches against the statement), because the manual
  // rail is the only rail this business has and a second, differently-shaped
  // payment flow is a second thing to get wrong. What is different is the
  // consequence: a match here dresses a name. It opens nothing.

  customerPlans() {
    return many('select * from customer_plans where active order by price_npr');
  },

  customerPlan(code = 'plus') {
    return one('select * from customer_plans where code = $1', [code]);
  },

  /** A person's arrangement, with the plan's price for display. */
  customerSubscription(profileId) {
    return one(
      `select cs.*, cp.name as plan_name, cp.price_npr, cp.period_months, cp.capabilities
         from customer_subscriptions cs
         join customer_plans cp on cp.code = cs.plan_code
        where cs.profile_id = $1`,
      [profileId],
    );
  },

  customerPlanPayments({ limit = 100 } = {}) {
    return many(
      `select pp.*, p.display_name, p.email, cs.plan_code,
              g.code as gift_code, g.status as gift_status, g.note as gift_note
         from customer_plan_payments pp
         join profiles p on p.id = pp.customer_subscription_id
         join customer_subscriptions cs on cs.profile_id = pp.customer_subscription_id
         left join customer_plan_gifts g on g.id = pp.gift_id
        order by pp.created_at desc limit $1`,
      [limit],
    );
  },

  /**
   * A person says they have sent the money.
   *
   * Records the claim and NOTHING else: no look is worn and no period starts until
   * an operator has seen the transfer on the platform's own statement. A unique
   * index on `txn_reference` across the whole table is what stops the same eSewa
   * code being submitted twice for two periods — the second attempt fails at the
   * index rather than being noticed later by a human.
   */
  claimPlus({ profileId, planCode = 'plus', amountNpr, txnReference, method = 'esewa', payerName = null }) {
    if (String(txnReference || '').trim().length < 4) return { ok: false, code: 'reference' };
    return withTransaction(async (c) => {
      const plan = (await c.query(
        'select * from customer_plans where code = $1 and active',
        [planCode],
      )).rows[0];
      if (!plan) return { ok: false, code: 'no-plan' };

      await c.query(
        `insert into customer_subscriptions (profile_id, plan_code, status, claimed_at, updated_at)
         values ($1, $2, 'pending_payment', now(), now())
         on conflict (profile_id) do update
           set plan_code = excluded.plan_code,
               status = 'pending_payment',
               claimed_at = now(),
               updated_at = now()`,
        [profileId, plan.code],
      );
      const payment = (await c.query(
        `insert into customer_plan_payments
           (customer_subscription_id, amount_npr, txn_reference, method, payer_name)
         values ($1, $2, $3, $4, $5)
         returning *`,
        [profileId, Number(amountNpr) || plan.price_npr, String(txnReference).trim().slice(0, 80),
          method, payerName ? String(payerName).trim().slice(0, 80) : null],
      )).rows[0];
      return { ok: true, payment, plan };
    }).catch((err) => {
      if (isUniqueViolation(err)) return { ok: false, code: 'duplicate-reference' };
      throw err;
    });
  },

  /**
   * A person says they have sent the money FOR SOMEBODY ELSE.
   *
   * The same rail as `claimPlus`, with three differences and each one matters:
   *
   *   1. THE BUYER'S OWN ROW IS NOT TOUCHED. `claimPlus` upserts their subscription to
   *      `pending_payment` — correct for their own period, and wrong here: a person with
   *      a month running who buys a friend a month would stop wearing their look the
   *      moment they submitted the reference. The row is created if it does not exist
   *      (`do nothing` on conflict) and otherwise left exactly as it was.
   *   2. A CODE IS MINTED AT CLAIM TIME, not at match time, because the buyer needs to
   *      tell their friend what to type. It is printed on their own page with its state
   *      attached — "waiting on the transfer" — so nobody hands over a code believing
   *      it works.
   *   3. THE UNIQUE REFERENCE INDEX STILL GOVERNS. One transfer is one period, whether
   *      that period is for the payer or for a friend.
   */
  claimPlusGift({
    profileId, planCode = 'plus', amountNpr, txnReference, method = 'esewa',
    payerName = null, note = null,
  }) {
    if (String(txnReference || '').trim().length < 4) return { ok: false, code: 'reference' };
    return withTransaction(async (c) => {
      const plan = (await c.query(
        'select * from customer_plans where code = $1 and active',
        [planCode],
      )).rows[0];
      if (!plan) return { ok: false, code: 'no-plan' };
      // The row exists so the payment can point at it (the operator's queue reaches the
      // payer through it), and it says `none` — no arrangement — because that is what
      // is true: this money was spent on somebody else. `do nothing` on conflict is the
      // whole of decision 1 in 0042's header: a buyer with a month running keeps it.
      await c.query(
        `insert into customer_subscriptions (profile_id, plan_code, status, updated_at)
         values ($1, $2, 'none', now())
         on conflict (profile_id) do nothing`,
        [profileId, plan.code],
      );
      // A code is a credential, so a collision is retried rather than trusted to luck.
      // Eight characters of a 32-letter alphabet will not collide in this decade, and
      // the loop is here so that when it does, the person gets a code instead of an
      // error page.
      let gift = null;
      for (let attempt = 0; attempt < 5 && !gift; attempt += 1) {
        try {
          gift = (await c.query(
            `insert into customer_plan_gifts (code, plan_code, months, buyer_id, note)
             values ($1, $2, $3, $4, $5)
             returning *`,
            [giftCode(), plan.code, Number(plan.period_months) || 1, profileId,
              note ? String(note).trim().slice(0, 120) : null],
          )).rows[0];
        } catch (err) {
          if (!isUniqueViolation(err)) throw err;
        }
      }
      if (!gift) return { ok: false, code: 'code' };
      const payment = (await c.query(
        `insert into customer_plan_payments
           (customer_subscription_id, amount_npr, txn_reference, method, payer_name, gift_id)
         values ($1, $2, $3, $4, $5, $6)
         returning *`,
        [profileId, Number(amountNpr) || plan.price_npr, String(txnReference).trim().slice(0, 80),
          method, payerName ? String(payerName).trim().slice(0, 80) : null, gift.id],
      )).rows[0];
      return { ok: true, payment, plan, gift };
    }).catch((err) => {
      if (isUniqueViolation(err)) return { ok: false, code: 'duplicate-reference' };
      throw err;
    });
  },

  /** The gifts one person has bought, newest first, for their own page. */
  giftsGivenBy(profileId) {
    return many(
      `select g.*, cp.name as plan_name, cp.price_npr, r.display_name as redeemed_by_name
         from customer_plan_gifts g
         join customer_plans cp on cp.code = g.plan_code
         left join profiles r on r.id = g.redeemed_by
        where g.buyer_id = $1
        order by g.created_at desc limit 20`,
      [profileId],
    );
  },

  /**
   * Redeem a code. The period lands on the REDEEMER'S row and on nobody else's.
   *
   * Every refusal here is a sentence a person is owed, because the person holding a
   * code is not the person who paid: "it did not work" with no reason sends them back
   * to their friend with a complaint instead of an answer.
   *
   * The extension rule is the same as a match's: the months are added to whichever is
   * later, the end they already have or now. A gift received while a month is running
   * is two months, not a month that replaced one.
   */
  redeemPlusGift({ code, profileId }) {
    return withTransaction(async (c) => {
      const gift = (await c.query(
        'select * from customer_plan_gifts where code = $1 for update',
        [code],
      )).rows[0];
      if (!gift) return { ok: false, code: 'gift-unknown' };
      if (gift.status === 'redeemed') return { ok: false, code: 'gift-used' };
      if (gift.status === 'void') return { ok: false, code: 'gift-void' };
      if (gift.status !== 'funded') return { ok: false, code: 'gift-unfunded' };
      if (gift.buyer_id === profileId) return { ok: false, code: 'gift-self' };
      const months = Number(gift.months) || 1;
      const row = (await c.query(
        `insert into customer_subscriptions
           (profile_id, plan_code, status, period_start, period_end, updated_at)
         values ($1, $2, 'active', now(), now() + ($3 || ' months')::interval, now())
         on conflict (profile_id) do update
           set status = 'active',
               plan_code = excluded.plan_code,
               period_start = coalesce(customer_subscriptions.period_start, now()),
               period_end = greatest(coalesce(customer_subscriptions.period_end, now()), now())
                            + ($3 || ' months')::interval,
               cancelled_at = null,
               updated_at = now()
         returning *`,
        [profileId, gift.plan_code, String(months)],
      )).rows[0];
      await c.query(
        `update customer_plan_gifts
            set status = 'redeemed', redeemed_by = $2, redeemed_at = now()
          where id = $1`,
        [gift.id, profileId],
      );
      return { ok: true, gift, months, subscription: row };
    });
  },

  /** One gift by code, for a page that has to say what state it is in. */
  giftByCode(code) {
    return one('select * from customer_plan_gifts where code = $1', [code]);
  },

  /**
   * An operator found the money. The arrangement starts NOW, not at the date of the
   * transfer: the period is what the person gets for it, and back-dating a period
   * would quietly shorten what they paid for.
   */
  matchCustomerPlanPayment({ paymentId, actorId }) {
    return withTransaction(async (c) => {
      const found = await c.query(
        `select pp.*, cs.plan_code, cs.status as sub_status
           from customer_plan_payments pp
           join customer_subscriptions cs on cs.profile_id = pp.customer_subscription_id
          where pp.id = $1 and pp.status = 'submitted'
          for update of pp`,
        [paymentId],
      );
      const payment = found.rows[0];
      if (!payment) return null;
      const plan = (await c.query('select * from customer_plans where code = $1', [payment.plan_code])).rows[0];
      const months = Number(plan?.period_months) || 1;
      /*
       * A MATCH ON A GIFT FUNDS THE GIFT. NOTHING ELSE.
       *
       * The whole feature is in this branch. The payer's own subscription row must not
       * move: somebody with a month running who buys a friend a month would otherwise
       * watch their own arrangement flip to `pending_payment` when they submitted the
       * reference, and then have a fresh period stamped on their own row when the
       * operator found the money — a gift that dresses the buyer and the recipient is
       * two periods for one transfer, and it is exactly the shape of bug that a page
       * cannot show you. `claimPlusGift` therefore never touches the row, and here the
       * only thing that changes is the gift's own state.
       */
      if (payment.gift_id) {
        const gift = (await c.query(
          `update customer_plan_gifts
              set status = 'funded', matched_at = now()
            where id = $1 and status = 'reserved'
            returning *`,
          [payment.gift_id],
        )).rows[0];
        await c.query(
          `update customer_plan_payments
              set status = 'matched', matched_by = $2, matched_at = now()
            where id = $1`,
          [paymentId, actorId || null],
        );
        return { ...payment, months, gift: gift || null, isGift: true };
      }
      /*
       * THE PERIOD EXTENDS; IT DOES NOT RESTART.
       *
       * This used to write `period_start = now(), period_end = now() + months`, which
       * is correct for a lapsed person starting again and WRONG for anybody whose month
       * is still running: the days they had left were silently dropped, so paying early
       * cost money. The rule is the one the membership side already uses
       * (`extendMembership`): add the months to whichever is later, the end they have or
       * now — and, alongside it, record WHICH plan was matched, because a person moving
       * from a month to a year would otherwise carry twelve months under a row that said
       * `plus`.
       */
      const updated = (await c.query(
        `update customer_subscriptions
            set status = 'active',
                plan_code = $3,
                period_start = coalesce(period_start, now()),
                period_end = greatest(coalesce(period_end, now()), now()) + ($2 || ' months')::interval,
                cancelled_at = null,
                updated_at = now()
          where profile_id = $1
        returning *`,
        [payment.customer_subscription_id, String(months), payment.plan_code],
      )).rows[0];
      await c.query(
        `update customer_plan_payments
            set status = 'matched', matched_by = $2, matched_at = now()
          where id = $1`,
        [paymentId, actorId || null],
      );
      return { ...payment, months, subscription: updated || null };
    });
  },

  /**
   * The money did not arrive, or arrived wrong. The arrangement goes back to
   * nothing and any look stops being worn — not deleted, because the palette is a
   * preference and it is not the person's fault that a reference was mistyped.
   */
  rejectCustomerPlanPayment({ paymentId, actorId, reason = null }) {
    return withTransaction(async (c) => {
      const found = await c.query(
        'select * from customer_plan_payments where id = $1 and status = $2',
        [paymentId, 'submitted'],
      );
      const payment = found.rows[0];
      if (!payment) return null;
      await c.query(
        `update customer_plan_payments
            set status = 'rejected', matched_by = $2, matched_at = now(), reject_reason = $3
          where id = $1`,
        [paymentId, actorId || null, reason ? String(reason).trim().slice(0, 300) : null],
      );
      if (payment.gift_id) {
        // A gift whose money was not found becomes void rather than reserved: the code
        // is out of the buyer's hands already (it is printed the moment they claim),
        // and a code that might still work later is worse than one that says no.
        await c.query(
          `update customer_plan_gifts
              set status = 'void', void_reason = $2
            where id = $1 and status = 'reserved'`,
          [payment.gift_id, reason ? String(reason).trim().slice(0, 300) : null],
        );
        return { ...payment, isGift: true };
      }
      await c.query(
        `update customer_subscriptions
            set status = case when period_end is not null and period_end > now() then 'active' else 'cancelled' end,
                updated_at = now()
          where profile_id = $1 and status = 'pending_payment'`,
        [payment.customer_subscription_id],
      );
      return payment;
    });
  },

  /** Stopping is immediate and keeps the record. No refund path exists — there is
   *  no processor to reverse, and promising one in copy would be a lie. */
  cancelPlus(profileId) {
    return one(
      `update customer_subscriptions
          set status = 'cancelled', cancelled_at = now(), updated_at = now()
        where profile_id = $1 and status in ('active','pending_payment')
        returning *`,
      [profileId],
    );
  },

  /**
   * Choose a look. Separate from the money on purpose: the choice can be made and
   * changed before, during or after an arrangement, and it is stored whether or not
   * anything is worn today.
   */
  setPlusLook({ profileId, nameplate = null, effect = null, ring = null, frame = null }) {
    // The keys are checked HERE as well as at the route, because the route is not the
    // only caller: a seeder, a script or a future admin tool reaches this method
    // directly, and an unrecognised palette used to be stored happily and then render
    // as the default — a look that is wrong and looks fine. An unknown value is stored
    // as "nothing chosen", which is a state the product already has.
    const plate = PLUS_PLATE_KEYS.includes(nameplate) ? nameplate : null;
    const tone = PLUS_EFFECT_KEYS.includes(effect) ? effect : null;
    const band = PLUS_RING_KEYS.includes(ring) ? ring : null;
    const edge = PLUS_FRAME_KEYS.includes(frame) ? frame : null;
    return one(
      `update profiles
          set nameplate = $2::text,
              plus_effect = $3::text,
              plus_ring = $4::text,
              plus_frame = $5::text,
              plus_set_at = now()
        where id = $1
        returning id, nameplate, plus_effect, plus_ring, plus_frame, plus_set_at`,
      [profileId, plate, tone, band, edge],
    );
  },

  /**
   * Who in a set of people is dressed, in one query, for pages that render names
   * from a list. Same join as `userById`, done once.
   */
  plusWornBy(profileIds = []) {
    if (!profileIds.length) return [];
    return many(
      `select p.id, p.nameplate, p.plus_effect, p.plus_ring, p.plus_frame,
              cs.status as plus_status, cs.period_end as plus_period_end
         from profiles p
         join customer_subscriptions cs
           on cs.profile_id = p.id and cs.status = 'active' and cs.period_end > now()
        where p.id = any($1::uuid[])`,
      [profileIds],
    );
  },

  // ---- channel settings ---------------------------------------------------
  /**
   * Update what a seller controls about their store.
   *
   * An allowlist of columns rather than a spread of the request body: a
   * `set ${keys}` built from user input is how a form eventually writes
   * `moderation_state = 'approved'` on itself, and no amount of route-level
   * validation makes that safe to have in the codebase.
   *
   * `listing_mode` is deliberately NOT gated here. Whether a store MAY be
   * listed is a plan capability, and the capability is checked at the route
   * where the plan is known — the store layer has no business knowing about
   * plans, and a check in two places is a check that will disagree.
   */
  async updateChannel(channelId, patch = {}) {
    const allowed = {
      name: (v) => String(v).trim().slice(0, 120),
      tagline: (v) => String(v).trim().slice(0, 200),
      about: (v) => String(v).trim().slice(0, 4000),
      channel_contact: (v) => String(v).trim().slice(0, 320),
      banner_url: (v) => (v === null ? null : String(v)),
      avatar_url: (v) => (v === null ? null : String(v)),
      listing_mode: (v) => (v === 'marketplace' ? 'marketplace' : 'storefront'),
      ads_enabled: (v) => v === true || v === 'on' || v === 'true',
      sells_digital: (v) => v === true || v === 'on' || v === 'true',
      sells_physical: (v) => v === true || v === 'on' || v === 'true',
      // `theme` is NOT in this list, and that is deliberate: it is a paid
      // capability, so it is written by its own method below where the plan is
      // known and the audit row is written. A field this one accepted would let
      // any future form that posts the whole channel set a theme on a Free store.
    };
    const sets = [];
    const values = [channelId];
    for (const [key, coerce] of Object.entries(allowed)) {
      if (!(key in patch)) continue;
      if ((key === 'name' || key === 'tagline') && !String(patch[key] || '').trim()) continue;
      values.push(coerce(patch[key]));
      sets.push(`${key} = $${values.length}`);
    }
    if (!sets.length) return this.channelById(channelId);
    return one(
      `update channels set ${sets.join(', ')}, updated_at = now() where id = $1 returning *`,
      values,
    );
  },

  /**
   * The seller's kill switch.
   *
   * `ads_enabled = false` stops the channel's ad slots from resolving, without
   * touching anything else: the storefront, the unlocks and the files all keep
   * working. A seller who wants ads off for a week should not have to unpublish.
   */
  async setAdsEnabled(channelId, enabled) {
    return one('update channels set ads_enabled = $2, updated_at = now() where id = $1 returning *',
      [channelId, enabled]);
  },

  /**
   * Files and unlocks per asset, for the list of a store's own files.
   *
   * Two correlated counts rather than a join and a GROUP BY: the dashboard needs
   * one row per file, and a join against unlocks would either multiply the rows
   * or need a DISTINCT that hides the count it is meant to show.
   */
  assetStats(channelId) {
    return many(
      `select a.id,
              (select count(*) from asset_files f where f.asset_id = a.id) as files,
              (select count(*) from unlocks u where u.asset_id = a.id and u.revoked_at is null) as unlocks
         from assets a
        where a.channel_id = $1`,
      [channelId],
    );
  },

  // ---- the file list, as something a seller can work -----------------------
  //
  // Three questions a seller with two hundred files asks, and none of them had an
  // answer: WHICH file (search), WHAT state is it in (filter), and WHICH ones are
  // worth my afternoon (sort). The list returned everything, newest first, and at
  // two hundred rows that is a wall rather than a list.
  //
  // The counts are computed over the whole store, not over the current filter, on
  // purpose: they are what makes the filter chips honest ("Live 5 · Paused 2 ·
  // Hidden 1" has to keep saying 5 while you are looking at the paused ones).

  /**
   * The seller's own files, filtered and sorted the way the list is read.
   *
   * `total` is how many match; `counts` is the whole store. A page that reports
   * only one of those two numbers is a page that lies to somebody: "7 files" when
   * 12 exist hides the five the filter removed, and a filter chip with no count is
   * a guess about what is behind it.
   */
  async sellerFiles(channelId, { q = '', state = 'all', access = 'all', sort = 'newest', page = 1, perPage = 25 } = {}) {
    const term = String(q || '').trim().slice(0, 80);
    const st = ['all', 'live', 'paused', 'hidden'].includes(state) ? state : 'all';
    const ac = ['all', 'ad_gated', 'open'].includes(access) ? access : 'all';
    const per = Math.min(Math.max(Number(perPage) || 25, 5), 100);
    const pageNo = Math.max(Number(page) || 1, 1);
    const so = ['newest', 'oldest', 'unlocks', 'views', 'title'].includes(sort) ? sort : 'newest';
    const order = {
      newest: 'a.created_at desc',
      oldest: 'a.created_at asc',
      // The two sorts that answer "what is worth my afternoon". Ties break by date
      // so the order is stable — a list that reshuffles between two page loads is
      // how somebody ticks the wrong file.
      unlocks: 'unlocks desc, a.created_at desc',
      views: 'views_30d desc, a.created_at desc',
      title: 'lower(a.title) asc',
    }[so];

    const where = [`a.channel_id = $1`, `a.status <> 'removed'`];
    const args = [channelId];
    if (term) {
      args.push(`%${term}%`);
      where.push(`(a.title ilike $${args.length} or a.slug ilike $${args.length})`);
    }
    // The three chips partition the store, which is the only arrangement a seller
    // can check by eye: every file is in exactly one of Live, Paused or Hidden, and
    // the numbers under the chips add up to the number in the sentence above them.
    //
    // So "Live" means live AND not held — a file the report threshold took is not
    // live in any sense a seller cares about, and the row itself says "Hidden after
    // reports" rather than "Live". A chip named Live that listed a row labelled
    // Hidden would be the page disagreeing with itself.
    if (st === 'live') where.push(`a.status = 'live' and not a.hidden_by_reports`);
    if (st === 'paused') where.push(`a.status = 'paused' and not a.hidden_by_reports`);
    if (st === 'hidden') where.push(`a.hidden_by_reports`);

    if (ac !== 'all') {
      args.push(ac);
      where.push(`a.unlock_mode = $${args.length}`);
    }

    const from = `
      from assets a
      where ${where.join(' and ')}`;
    // One shared column list, so the row the sorter reads and the row the page
    // draws cannot be computed differently.
    const columns = `
      a.id, a.slug, a.title, a.status, a.unlock_mode, a.hidden_by_reports, a.created_at,
      (select count(*)::int from asset_files f where f.asset_id = a.id)  as files,
      (select count(*)::int from unlocks u
        where u.asset_id = a.id and u.revoked_at is null)                as unlocks,
      (select count(*)::int from ad_view_events e
        where e.asset_id = a.id and e.completed
          and e.created_at >= current_date - interval '29 days')         as views_30d`;

    const rows = await many(
      `select ${columns} ${from} order by ${order} limit ${per} offset ${(pageNo - 1) * per}`,
      args,
    );
    const matched = await scalar(`select count(*)::int as n ${from}`, args);
    // The store's own totals: no search, no filters, so the chips keep their
    // numbers while a filter is on.
    const all = await one(
      `select count(*)::int as all,
              count(*) filter (where status = 'live' and not hidden_by_reports)::int   as live,
              count(*) filter (where status = 'paused' and not hidden_by_reports)::int as paused,
              count(*) filter (where hidden_by_reports)::int                           as hidden
         from assets where channel_id = $1 and status <> 'removed'`,
      [channelId],
    );
    return {
      rows,
      // What was actually applied, not what was asked for: a URL with `state=banana`
      // gets the default, and the toolbar has to show the filter that is in force
      // rather than the one in the address bar. (The chips are built from these.)
      q: term, state: st, access: ac, sort: so,
      total: Number(matched) || 0,
      page: pageNo,
      perPage: per,
      counts: { all: Number(all.all) || 0, live: Number(all.live) || 0, paused: Number(all.paused) || 0, hidden: Number(all.hidden) || 0 },
    };
  },

  /**
   * The ids a filter currently matches — for "select all N matching files".
   *
   * The alternative is asking the browser to post two hundred uuids, which goes
   * wrong in the direction that matters: a selection made from a stale page can
   * carry an id the seller can no longer see. Re-resolving the filter on the server,
   * inside the commit, is the researched pattern ("store the filter snapshot, not a
   * list of hundreds of ids") and it is also the only version where a file added
   * between render and press is a decision the seller can see.
   */
  async sellerFileIds(channelId, filter = {}) {
    const { rows } = await this.sellerFiles(channelId, { ...filter, page: 1, perPage: 100 });
    if (rows.length < 100) return rows.map((r) => r.id);
    // More than one page: read the rest. Bounded, because a store with thousands of
    // files should get a slower answer rather than a wrong one.
    const all = [];
    for (let page = 1; page <= 20; page += 1) {
      const chunk = (await this.sellerFiles(channelId, { ...filter, page, perPage: 100 })).rows;
      all.push(...chunk.map((r) => r.id));
      if (chunk.length < 100) break;
    }
    return all;
  },

  /**
   * Change several files at once, and write down what they were.
   *
   * `action` is one of four words a seller would use, not a patch object: 'pause',
   * 'live', 'ad_gated', 'open'. Selection arrives either as explicit ids (the boxes
   * they ticked) or as `filter` (the "all N matching" escape hatch, re-resolved here
   * so the set is decided by the server at commit time).
   *
   * Two things never change in bulk, and both are counted rather than dropped:
   * a file hidden after reports (an operator owns that state until the appeal is
   * answered — the same rule `updateAsset` enforces one at a time), and a file that
   * already holds the value being applied (a no-op is not a change, and recording it
   * as one would make the undo restore nothing and say it had).
   */
  async applyAssetBulk({ channelId, actorId, action, ids = [], filter = null }) {
    const patches = {
      pause: { column: 'status', value: 'paused' },
      live: { column: 'status', value: 'live' },
      ad_gated: { column: 'unlock_mode', value: 'ad_gated' },
      open: { column: 'unlock_mode', value: 'open' },
    };
    const patch = patches[action];
    if (!patch) return { ok: false, code: 'unknown-action' };

    // The filter is resolved BEFORE the transaction opens, not inside it: every
    // statement in a transaction has to run on that transaction's client, and
    // `sellerFileIds` is a pooled read. Resolving first also keeps the meaning the
    // same — "the set the filter matches at the moment the button is pressed" — with
    // nothing between the resolution and the write but the transaction itself.
    const wanted = filter
      ? await this.sellerFileIds(channelId, filter)
      : (Array.isArray(ids) ? ids : [])
        .map((v) => String(v))
        .filter((v) => /^[0-9a-f-]{36}$/i.test(v));

    // `picked` is what survived — ids that were usable. The route needs it to tell
    // "every file you picked already says this" from "nothing you picked arrived",
    // which are different sentences and only one of them is true at a time.
    if (!wanted.length) {
      return { ok: true, applied: 0, unchanged: 0, skipped: 0, picked: 0, batch: null, action };
    }

    return withTransaction(async (tx) => {

      // The ownership guard is the WHERE clause, not a check above it: an id that
      // belongs to another store is simply not in this set. (A bulk route that
      // trusted posted ids would be a way to pause a stranger's files.)
      const candidates = await tx.query(
        `select id, status, unlock_mode, hidden_by_reports
           from assets
          where channel_id = $1 and id = any($2::uuid[]) and status <> 'removed'`,
        [channelId, wanted],
      );
      const rows = candidates.rows;
      const changeable = rows.filter((r) => !r.hidden_by_reports);
      const changing = changeable.filter((r) => r[patch.column] !== patch.value);
      const skipped = rows.length - changeable.length;
      const unchanged = changeable.length - changing.length;

      if (!changing.length) {
        return { ok: true, applied: 0, unchanged, skipped, picked: wanted.length, batch: null, action };
      }

      await tx.query(
        `update assets set ${patch.column} = $3 where channel_id = $1 and id = any($2::uuid[])`,
        [channelId, changing.map((r) => r.id), patch.value],
      );

      const before = changing.map((r) => ({ id: r.id, status: r.status, unlock_mode: r.unlock_mode }));
      const batch = await tx.query(
        `insert into asset_bulk_batches (channel_id, actor_id, action, before, applied, unchanged, skipped)
         values ($1, $2, $3, $4::jsonb, $5, $6, $7) returning *`,
        [channelId, actorId || null, action, JSON.stringify(before), changing.length, unchanged, skipped],
      );
      return {
        ok: true, applied: changing.length, unchanged, skipped,
        picked: wanted.length, batch: batch.rows[0], action,
      };
    });
  },

  /**
   * The most recent bulk change nobody has taken back, if it is still undoable.
   *
   * The window is derived from `created_at` — thirty minutes — for the same reason
   * every other deadline here is derived: a stored expiry is a second clock, and
   * two clocks is how a page offers an undo the server then refuses.
   */
  recentAssetBulk(channelId, { withinMinutes = 30 } = {}) {
    return one(
      `select * from asset_bulk_batches
        where channel_id = $1 and undone_at is null
          and created_at > now() - ($2::int * interval '1 minute')
        order by created_at desc limit 1`,
      [channelId, withinMinutes],
    );
  },

  /**
   * Put the rows back exactly as they were.
   *
   * A restore, not an inverse action: rows that held different values (a mixed
   * selection: some live, some paused) would come back wrong if the undo simply
   * applied the opposite word to all of them. The values are in `before`, and this
   * reads them.
   *
   * A file that has been hidden after reports SINCE the bulk change keeps its hidden
   * state and is counted as skipped — the platform's hold is not something an undo
   * quietly lifts. Everything else comes back.
   */
  async undoAssetBulk({ batchId, channelId, actorId }) {
    return withTransaction(async (tx) => {
      const found = await tx.query(
        `select * from asset_bulk_batches where id = $1 and channel_id = $2`,
        [batchId, channelId],
      );
      const batch = found.rows[0];
      if (!batch) return { ok: false, code: 'no-such-change' };
      if (batch.undone_at) return { ok: false, code: 'already-undone' };
      const stale = await tx.query(
        `select (created_at < now() - interval '30 minutes') as stale from asset_bulk_batches where id = $1`,
        [batchId],
      );
      if (stale.rows[0]?.stale) return { ok: false, code: 'too-late' };

      const before = Array.isArray(batch.before) ? batch.before : [];
      const ids = before.map((r) => r.id);
      const statuses = before.map((r) => r.status);
      const modes = before.map((r) => r.unlock_mode);
      const restored = await tx.query(
        `update assets a
            set status = v.status, unlock_mode = v.unlock_mode
           from unnest($2::uuid[], $3::text[], $4::text[]) as v(id, status, unlock_mode)
          where a.id = v.id and a.channel_id = $1
            and a.status <> 'removed' and not a.hidden_by_reports
          returning a.id`,
        [channelId, ids, statuses, modes],
      );
      await tx.query(
        `update asset_bulk_batches set undone_at = now(), undone_by = $2 where id = $1`,
        [batchId, actorId || null],
      );
      return { ok: true, restored: restored.rowCount, skipped: ids.length - restored.rowCount, action: batch.action };
    });
  },

  async updateAsset(assetId, patch = {}) {
    const allowed = {
      title: (v) => String(v).trim().slice(0, 200),
      description: (v) => String(v).trim().slice(0, 2000),
      /*
       * Every mode the seller's form offers, and every mode the database allows.
       *
       * This used to read `v === 'open' ? 'open' : 'ad_gated'`, which quietly threw
       * away two of the three other answers: choosing "Members only — no ad" saved,
       * redirected to a page that said Saved, and left the file ad-gated. A control
       * that silently does nothing is worse than a control that is missing, and this
       * one was missing from the list while being offered in the form.
       *
       * 'paid' is still absent on purpose: it is the reserved, unbuilt mode, and a
       * form must not be able to reach a state no code implements.
       */
      unlock_mode: (v) => (SELLER_MODES.includes(String(v)) ? String(v) : 'ad_gated'),
      // Which tier opens a members-only file. Written with the mode, never alone —
      // the database checks the pair as one decision (`assets_member_shape`), so a
      // patch that names a tier without the mode cannot land anyway.
      member_tier: (v) => (Number(v) === 2 ? 2 : Number(v) === 1 ? 1 : 0),
      // What the file is worth. Not a price: nothing on this platform has a
      // checkout (see `NOT_CHARGED`), this column is never rendered to a visitor,
      // and migration 0004 removed the column that WAS a price. It is the input the
      // unlock ask is calibrated from, and the only form that writes it says so.
      declared_value_npr: (v) => {
        const n = Number(v);
        if (!Number.isFinite(n)) return 0;
        return Math.min(1_000_000, Math.max(0, Math.round(n)));
      },
      cover_url: (v) => (v === null ? null : String(v)),
      // Only live <-> paused. 'removed' is the moderation decision and
      // 'draft'/'pending_review' belong to the publish flow; a settings form
      // must not be able to reach either.
      status: (v) => (v === 'paused' ? 'paused' : 'live'),
    };
    // While the report threshold is hiding a file, the platform owns that file's
    // state, not its seller.
    //
    // This used to be the other way round — any status the seller saved cleared
    // `hidden_by_reports` — and the effect was that the threshold was optional:
    // open the edit page, set the state back to Live, press Save, and a file
    // three people reported was public again. Two clicks, no operator, and the
    // appeal form sitting next to it would have been theatre. The seller keeps
    // every other field; only the state waits for a person.
    const current = await this.assetById(assetId);
    const stateLocked = Boolean(current?.hidden_by_reports);

    const sets = [];
    let statusApplied = false;
    const values = [assetId];
    for (const [key, coerce] of Object.entries(allowed)) {
      if (!(key in patch)) continue;
      if (stateLocked && key === 'status') continue;
      if (key === 'title' && !String(patch.title || '').trim()) continue;
      values.push(coerce(patch[key]));
      sets.push(`${key} = $${values.length}`);
      if (key === 'status') statusApplied = true;
    }
    if (!sets.length) return this.assetById(assetId);
    // A seller who sets the status on a file nobody reported is the seller taking
    // the decision back, and clears any stale flag. On a reported file the branch
    // above never reaches here, so dismissing an old report can no longer un-pause
    // a file its owner deliberately took down.
    if (statusApplied) sets.push('hidden_by_reports = false');
    return one(
      `update assets set ${sets.join(', ')}, updated_at = now() where id = $1 returning *`,
      values,
    );
  },

  /**
   * Unlock policy: the ask is DERIVED here, and a seller cannot overrule the model
   * by posting a number.
   *
   * The two boxes this replaces took `adsRequired` and `adMinSeconds` straight from
   * a form and clamped them to 1–5 and 5–120. The clamp existed because the form is
   * only a suggestion — but a range is not a policy, and the thing being clamped
   * was somebody else's attention. Now the caller may only say WHICH ask it wants:
   * `ask_level` of 'standard' (the rate for the file's declared value) or 'light'
   * (the platform floor). The numbers come from `adscale.js`, the plan's ceiling is
   * applied there, and the absolute promise is applied on top of that.
   *
   * `ad_band_npr` records the value the ask was calibrated from, so a later price
   * change is a visible, explainable drift rather than the number moving by itself.
   */
  async setUnlockPolicy(assetId, { ask_level, unlock_hours, mode } = {}) {
    const int = (v, lo, hi, fallback) => {
      const n = Number(v);
      if (!Number.isFinite(n)) return fallback;
      return Math.min(hi, Math.max(lo, Math.round(n)));
    };
    const asset = await this.assetById(assetId);
    const channel = asset ? await this.channelById(asset.channel_id) : null;
    const planCode = channel ? this.effectivePlanCode(channel) : 'free';
    const level = String(ask_level) === 'light' ? 'light' : 'standard';
    const ask = resolveAsk({ valueNpr: asset?.declared_value_npr ?? 0, planCode, level });
    // The mode travels with the rest of the policy, because a file whose
    // `assets.unlock_mode` says "members" while its policy row still says
    // "ad_gated" is two rows disagreeing about one decision. The assets column
    // remains the authority the content path reads; this keeps the copy honest.
    const wanted = SELLER_MODES.includes(String(mode)) ? String(mode) : null;
    return one(
      `update asset_unlock_policy
          set ads_required   = $2,
              ad_min_seconds = $3,
              ask_level      = $4,
              ad_band_npr    = $5,
              unlock_hours   = $6,
              mode           = coalesce($7, mode),
              updated_at     = now()
        where asset_id = $1
        returning *`,
      [
        assetId,
        ask.ads,
        ask.seconds,
        ask.level,
        Number(asset?.declared_value_npr) || 0,
        int(unlock_hours, 1, 720, 24),
        wanted,
      ],
    );
  },

  /**
   * The seller's choice of placements, filtered through what the shape allows.
   *
   * The filter is the whole method. `placement.js` owns which placements exist for
   * a shape and what each one means, so a hand-crafted POST asking for a between-
   * chapter gate on a video is not rejected with an error — it is simply not a key
   * the shape has, and it never reaches the column. Rejecting it would be worse:
   * the seller's page would have to explain a rule it does not show.
   */
  async setAdPlan(assetId, choices = {}) {
    const asset = await this.assetById(assetId);
    if (!asset) return null;
    const files = await this.filesOf(assetId);
    // The same derivation the storefront uses, so the seller cannot choose
    // placements for a shape their file does not have.
    const shape = assetShape(files, { url: asset.external_url });
    const allowed = new Set(placementsFor(shape));
    const clean = {};
    for (const key of Object.keys(choices)) {
      if (allowed.has(key)) clean[key] = Boolean(choices[key]);
    }
    return one(
      `update asset_unlock_policy
          set ad_plan = $2, updated_at = now()
        where asset_id = $1
        returning *`,
      [assetId, JSON.stringify(clean)],
    );
  },

  /**
   * The length a player measured, reported by the client.
   *
   * Written once per file per value and never by the seller: the point of the
   * column is that the number is a measurement rather than a claim. Only the asset
   * owner's own file is accepted by the caller, and only a plausible length — a
   * "duration" of four hours on a ten-second clip would move every break in it.
   */
  async reportRuntime(assetId, seconds) {
    const secs = measuredSeconds(seconds);
    if (secs === null) return null;
    return one(
      `update assets set runtime_sec = $2, updated_at = updated_at
        where id = $1 and (runtime_sec is null or runtime_sec <> $2)
        returning *`,
      [assetId, secs],
    );
  },

  /**
   * The plan a file actually runs: one call, so no caller can half-apply it.
   *
   * Everything the planner needs is gathered here — the derived shape, the length
   * the player measured, the ask the ladder produced, the plan the store pays for,
   * the seller's choices and whether the viewer is a member — and the result is
   * the planner's own object. A caller that renders the seller's page and a caller
   * that renders the buyer's page therefore cannot disagree about where the breaks
   * are, which is the failure mode this whole slice would otherwise have.
   */
  async adPlanFor(asset, { membersOnly = false } = {}) {
    if (!asset) return null;
    const [files, policy, channel] = await Promise.all([
      this.filesOf(asset.id),
      this.unlockPolicy(asset.id),
      this.channelById(asset.channel_id),
    ]);
    const shape = assetShape(files, { url: asset.external_url });
    // A read is counted in PAGES, and this is where the count comes from. The
    // planner was written against page counts from the start ("a 40-page manhwa with
    // two asks after page 13 and page 27") and was being handed the file count,
    // which for one CBZ is 1 — so a forty-page comic could carry no gate at all.
    // Only a read pays for this: every other shape's count IS its file count.
    const pages = shape === 'read' ? await this.assetPagePlan(asset, files) : null;
    const planCode = channel ? this.effectivePlanCode(channel) : 'free';
    const ask = policy
      ? {
        ads: Number(policy.ads_required) || 0,
        seconds: Number(policy.ad_min_seconds) || 0,
        level: policy.ask_level === 'light' ? 'light' : 'standard',
        ceiling: resolveAsk({
          valueNpr: asset.declared_value_npr ?? 0, planCode, level: policy.ask_level === 'light' ? 'light' : 'standard',
        }).ceiling,
      }
      : null;
    return planFor({
      shape,
      durationSec: asset.runtime_sec ?? null,
      ask,
      planCode,
      choices: policy?.ad_plan ?? null,
      // The count, from the thing that can see inside an upload: one page per image
      // entry in a CBZ, one page per image file, one chapter per file when a store
      // uploads a set. The planner is told it rather than deciding it, because what
      // counts as a chapter is a fact about the upload, not about ad placement.
      chapters: pages ? pages.chapters : files.length,
      membersOnly,
    });
  },

  /**
   * The money did not arrive, or arrived wrong.
   *
   * The request is dropped and the plan the seller already paid for is left
   * exactly as it was. A rejection is not a punishment, and the previous
   * behaviour — clearing the subscription — would have taken a paid plan away
   * because of a typo in a reference.
   */
  async rejectPlanPayment({ paymentId, actorId, reason }) {
    return withTransaction(async (c) => {
      const { rows } = await c.query(
        `update plan_payments
            set status = 'rejected', matched_by = $2, matched_at = now(), reject_reason = $3
          where id = $1 and status = 'submitted'
          returning *`,
        [paymentId, actorId, reason || null],
      );
      if (!rows.length) return null;
      await c.query(
        `update subscriptions
            set pending_plan_code = null, pending_since = null
          where id = $1 and pending_plan_code is not null`,
        [rows[0].subscription_id],
      );
      return rows[0];
    });
  },

  // ---- billing ------------------------------------------------------------
  async subscriptionOf(channelId) {
    return one(
      `select * from subscriptions where channel_id = $1 order by created_at desc limit 1`,
      [channelId],
    );
  },

  /**
   * Ask to move to a paid plan.
   *
   * The subscription row is created as `pending_payment`, NOT active. The
   * upgrade takes effect when an operator matches the money, which is the only
   * honest sequence when the rail is a manual transfer: activating on request
   * would give away the product to anyone who can fill in a form.
   *
   * The amount is recorded on the payment later, not here — but the quote is
   * recomputed server-side at that moment so a stale page cannot submit
   * yesterday's price.
   */
  /**
   * Ask for an upgrade. Creates a REQUEST — never an active subscription, and
   * never at the cost of the plan already paid for.
   *
   * The first version of this overwrote the subscription row, because the
   * schema allows one per channel. A seller who asked for Pro therefore dropped
   * to free until an operator matched the money, and the pro-rated amount
   * recomputed against Pro instead of Store — NPR 2,499 instead of NPR 1,500.
   * The request now lives in `pending_plan_code` (migration 0012) and grants
   * nothing; capability still follows `plan_code`, which only the operator moves.
   *
   * A free channel had no subscription row at all, so this creates one for the
   * free plan first: the row is the record of what is owed and what is paid, and
   * it has to exist before it can hold a request.
   */
  async requestUpgrade(channel, planCode) {
    return withTransaction(async (c) => {
      const plan = await c.query('select 1 from plans where code = $1', [planCode]);
      if (!plan.rowCount) throw new Error(`unknown plan ${planCode}`);

      const { rows } = await c.query(
        `insert into subscriptions (channel_id, plan_code, status, period_start, pending_plan_code, pending_since)
         values ($1, 'free', 'active', now(), $2, now())
         on conflict (channel_id) do update
           set pending_plan_code = excluded.pending_plan_code,
               pending_since     = now()
         returning *`,
        [channel.id, planCode],
      );
      return rows[0];
    });
  },

  /**
   * Payments for a channel, through the subscription they belong to.
   *
   * `plan_payments` has no channel_id — the schema attaches a payment to the
   * subscription it buys, which is correct. The dashboard used to filter
   * `store.planPayments()` by `p.channel_id`, a column that does not exist, so
   * every seller's payment history was silently empty.
   */
  planPaymentsOfChannel(channelId) {
    return many(
      `select pp.*, s.plan_code, s.status as subscription_status
         from plan_payments pp
         join subscriptions s on s.id = pp.subscription_id
        where s.channel_id = $1
        order by pp.created_at desc`,
      [channelId],
    );
  },

  /** Every pending payment, for the operator's matching queue. */
  unmatchedPayments({ limit = 100 } = {}) {
    return many(
      `select pp.*, coalesce(s.pending_plan_code, s.plan_code) as plan_code, s.period_end,
               c.slug as channel_slug, c.name as channel_name
         from plan_payments pp
         join subscriptions s on s.id = pp.subscription_id
         join channels c on c.id = s.channel_id
        where pp.status = 'submitted'
        order by pp.created_at
        limit $1`,
      [limit],
    );
  },

  /**
   * Confirm a plan payment and activate the subscription.
   *
   * Both writes in one transaction, because a payment marked matched with an
   * inactive subscription is a seller who has paid and has nothing.
   */
  async matchPlanPayment({ paymentId, actorId }) {
    return withTransaction(async (c) => {
      const { rows } = await c.query(
        `update plan_payments
            set status = 'matched', matched_by = $2, matched_at = now()
          where id = $1 and status = 'submitted'
          returning *`,
        [paymentId, actorId],
      );
      if (!rows.length) return null;

      /**
       * The plan moves. The renewal date does not.
       *
       * An upgrade is pro-rated to the end of the period already paid for, so
       * extending the period here would hand over days that were never charged
       * for; shortening it would take away days that were. Either way the next
       * charge would arrive on a date nobody agreed to. Only a channel with no
       * running period — a free store buying its first plan — starts a year.
       */
      await c.query(
        `update subscriptions
            set plan_code         = coalesce(pending_plan_code, plan_code),
                pending_plan_code = null,
                pending_since     = null,
                status            = 'active',
                grace_until       = null,
                period_start      = case when period_end > now() then period_start else now() end,
                period_end        = case when period_end > now() then period_end
                                         else now() + interval '1 year' end,
                verified_by       = $2,
                verified_at       = now()
          where id = $1`,
        [rows[0].subscription_id, actorId],
      );
      return rows[0];
    });
  },

  /**
   * Issue this period's rent invoice, if one is due.
   *
   * Idempotent through the schema's `unique (channel_id, period_start)` and
   * `on conflict do nothing`, so calling it on every dashboard view is safe and
   * is exactly what happens. No invoice is issued when the estimate has no
   * platform slot: a store below the three-slot floor is not taxed, and an
   * invoice for NPR 0 would be a bill pretending to be a policy.
   */
  async ensureRentInvoice({ channel, estimate, now = new Date() }) {
    const amountNpr = annualRentNpr(estimate);
    if (!amountNpr) return null;
    const period = rentPeriod(channel.created_at, now);
    // `returning id` is what makes the audit row honest: `on conflict do nothing`
    // returns no row when the invoice already existed, and this runs on every
    // dashboard view. Writing an audit row unconditionally would fill the log
    // with "invoiced" lines for an invoice that was issued once, months ago —
    // the exact noise that makes an audit log unreadable.
    // The due date is stamped from the terms AS THEY ARE TODAY. An invoice that
    // already exists keeps the date it was sent with, which is why this is a
    // column and not `created_at + dueDays` computed at read time.
    const dueAt = new Date(now.getTime() + RENT_TERMS.dueDays * 86400000).toISOString().slice(0, 10);
    const inserted = await query(
      `insert into rent_invoices (channel_id, period_start, period_end, amount_npr, basis, due_at)
       values ($1, $2, $3, $4, $5, $6)
       on conflict (channel_id, period_start) do nothing
       returning id`,
      [channel.id, period.start, period.end, amountNpr,
        JSON.stringify(rentWorking(estimate, amountNpr)), dueAt],
    );
    const invoice = await one(
      'select * from rent_invoices where channel_id = $1 and period_start = $2',
      [channel.id, period.start],
    );
    if (inserted.rowCount && invoice) {
      // An invoice is money the platform is owed. Until now it appeared in
      // `rent_invoices` and nowhere in the record of what happened — so "when did
      // this charge first appear" had no answer, on a platform whose entire
      // payment flow is a person matching transfers by hand.
      await this.audit('rent.invoice_issued', {
        amountNpr, periodStart: invoice.period_start, periodEnd: invoice.period_end,
        channelSlug: channel.slug, store: channel.name,
        pageviews30d: estimate?.pageviews30d ?? null, rentSlots: estimate?.rent ?? null,
      }, { subjectType: 'channel', subjectId: channel.id });
    }
    return invoice;
  },

  rentInvoicesOfChannel(channelId) {
    return many('select * from rent_invoices where channel_id = $1 order by period_start desc', [channelId]);
  },

  /** Every unpaid invoice, for the operator's queue. */
  openRentInvoices({ limit = 100 } = {}) {
    return many(
      `select r.*, c.slug as channel_slug, c.name as channel_name
         from rent_invoices r
         join channels c on c.id = r.channel_id
        where r.status in ('issued','submitted')
        order by r.submitted_at nulls last, r.created_at
        limit $1`,
      [limit],
    );
  },

  /**
   * Rent owed, with how late it is — the operator's actual weekly question.
   *
   * Ordered by lateness rather than by amount: the operator's next action depends
   * on age, not on size, and a NPR 300 invoice four months old is a decision while
   * a NPR 3,000 one due next week is not.
   *
   * Returns rows AND the bucket totals, because the view needs both and computing
   * the buckets in the view would mean a second definition of "late".
   */
  rentAging() {
    return many(
      `select r.id, r.channel_id, r.period_start, r.period_end, r.amount_npr, r.status,
              r.due_at, r.created_at, r.submitted_at, r.txn_reference, r.payer_name,
              c.slug as channel_slug, c.name as channel_name,
              u.email as owner_email,
              (current_date - r.due_at)::int as days_late
         from rent_invoices r
         join channels c on c.id = r.channel_id
         left join profiles u on u.id = c.owner_id
        where r.status = any($1)
        order by r.due_at asc nulls last, r.amount_npr desc
        limit 200`,
      [OPEN_RENT_STATUSES],
    );
  },

  /**
   * Rent across time: what each month was billed, and what actually arrived.
   *
   * Grouped by the invoice's own PERIOD, not by when it was paid: March's rent is
   * March's, whether it arrived in March or June. A collection chart grouped by
   * payment date answers "when did cash arrive" — a useful question, and not the
   * one this exists for, which is whether each month's rent is settling.
   *
   * `billed` is what was invoiced for that period and `collected` is the part of
   * it that is paid, so the difference is a number the operator can act on rather
   * than a churn figure nobody can reconcile with the bank.
   */
  rentByMonth({ months = 12 } = {}) {
    return many(
      `select to_char(date_trunc('month', r.period_end), 'YYYY-MM') as month,
              sum(r.amount_npr)::int as billed_npr,
              coalesce(sum(r.amount_npr) filter (where r.status = 'paid'), 0)::int as collected_npr,
              coalesce(sum(r.amount_npr) filter (where r.status = 'waived'), 0)::int as waived_npr,
              count(*)::int as invoices,
              count(*) filter (where r.status = 'paid')::int as paid_invoices,
              count(*) filter (where r.status = any($1) and r.due_at < current_date)::int as late_invoices
         from rent_invoices r
        where r.period_end > (date_trunc('month', current_date) - ($2 || ' months')::interval)
        group by 1 order by 1 desc`,
      [OPEN_RENT_STATUSES, String(Math.max(Number(months) - 1, 0))],
    );
  },

  /**
   * A seller submits the reference for a transfer they have made.
   *
   * Guarded on the current status so a double-submit cannot rewrite a matched
   * invoice, and so a `paid` row cannot be re-opened by posting again.
   */
  async submitRentPayment({ invoiceId, channelId, method, txnReference, payerName, payerNumber }) {
    // The route checks this too, and the check is repeated here because a
    // reference is what the operator matches against a statement: "x" cannot be
    // matched, so accepting it creates a payment nobody can ever clear.
    if (String(txnReference || '').trim().length < 4) return null;
    return one(
      `update rent_invoices
          set status = 'submitted', method = $3, txn_reference = $4,
              payer_name = $5, payer_number = $6, submitted_at = now()
        where id = $1 and channel_id = $2 and status = 'issued'
        returning *`,
      [invoiceId, channelId, method, txnReference, payerName ?? null, payerNumber ?? null],
    );
  },

  async matchRentPayment({ invoiceId, actorId, note = null }) {
    return one(
      `update rent_invoices
          set status = 'paid', paid_at = now(), matched_by = $2, note = coalesce($3, note)
        where id = $1 and status in ('issued','submitted')
        returning *`,
      [invoiceId, actorId, note],
    );
  },

  // ---- reviews ------------------------------------------------------------
  /**
   * A review hangs off an UNLOCK, not off an asset.
   *
   * That is the schema's design (`reviews.unlock_id` is unique) and it is the
   * right one: it means a review can only be written by somebody who actually
   * got the file, it cannot be written twice, and a revoked unlock takes its
   * review with it. This method exists so the write path uses the same rule.
   */
  async addReview({ unlockId, assetId, channelId, buyerId, rating, body }) {
    const stars = Math.min(5, Math.max(1, Math.round(Number(rating) || 0)));
    if (!stars) return null;
    return one(
      `insert into reviews (unlock_id, asset_id, channel_id, buyer_id, rating, body)
       values ($1, $2, $3, $4, $5, $6)
       on conflict (unlock_id) do update
         set rating = excluded.rating, body = excluded.body
       returning *`,
      [unlockId, assetId, channelId, buyerId, stars, String(body || '').trim().slice(0, 2000) || null],
    );
  },

  reviewsOfAsset(assetId, { limit = 20 } = {}) {
    return many(
      `select r.*, p.display_name as buyer_name,
              -- Plain nameplate, NOT plus_plate: plusWear() reads this field by that
              -- name, and the alias made every paying reviewer wear their effect in the
              -- fallback indigo while their own palette sat in the row beside it. Same
              -- rule as the roster above; the renderer is handed what it reads.
              p.nameplate, p.plus_effect as plus_effect,
              p.plus_ring as plus_ring, p.plus_frame as plus_frame,
              pl.plus_status, pl.plus_period_end
         from reviews r join profiles p on p.id = r.buyer_id
         ${PLUS_JOIN}
        where r.asset_id = $1 and r.moderation_state = 'published' and r.body is not null
        order by r.created_at desc limit $2`,
      [assetId, limit],
    );
  },

  reviewStatsOfChannel(channelId) {
    return one(
      `select count(*)::int as count, coalesce(round(avg(rating)::numeric, 1), 0)::float as average
         from reviews
        where channel_id = $1 and moderation_state = 'published'`,
      [channelId],
    );
  },

  reviewStatsOfAsset(assetId) {
    return one(
      `select count(*)::int as count, coalesce(round(avg(rating)::numeric, 1), 0)::float as average
         from reviews where asset_id = $1 and moderation_state = 'published'`,
      [assetId],
    );
  },

  reviewsOfChannel(channelId, { limit = 50 } = {}) {
    return many(
      `select r.*, a.title as asset_title, a.slug as asset_slug, p.display_name as buyer_name
         from reviews r
         join assets a on a.id = r.asset_id
         join profiles p on p.id = r.buyer_id
        where r.channel_id = $1
        order by r.created_at desc limit $2`,
      [channelId, limit],
    );
  },

  /** The seller gets one reply. A second one replaces it rather than stacking. */
  async respondToReview({ reviewId, channelId, response }) {
    return one(
      `update reviews
          set seller_response = $3, seller_responded_at = now()
        where id = $1 and channel_id = $2
        returning *`,
      [reviewId, channelId, String(response || '').trim().slice(0, 2000)],
    );
  },

  // ---- search -------------------------------------------------------------
  /**
   * Search across stores and their files.
   *
   * Scoped to `listing_mode = 'marketplace'` on purpose: a store that chose its
   * own address is not published in a directory, and a search that surfaces it
   * would overrule the seller's own setting. Approved stores only, live assets
   * only — a search result that 404s is worse than no result.
   */
  async search(q, { limit = 24 } = {}) {
    const term = String(q || '').trim().slice(0, 80);
    if (term.length < 2) return { stores: [], assets: [] };
    const like = `%${term.replace(/[%_]/g, '')}%`;
    const [stores, assets] = await Promise.all([
      many(
        `select c.*, coalesce(s.plan_code, 'free') as plan_code,
                (select count(*)::int from assets a
                  where a.channel_id = c.id and a.status = 'live') as asset_count
           from channels c
           left join lateral (
             select sub.plan_code from subscriptions sub
              where sub.channel_id = c.id and sub.status in ('active','grace')
              order by sub.created_at desc limit 1
           ) s on true
          left join profiles o on o.id = c.owner_id
          where c.listing_mode = 'marketplace'
            and c.moderation_state not in ('removed', 'suspended')
            and coalesce(o.banned, false) = false
            and (c.name ilike $1 or c.tagline ilike $1 or c.about ilike $1)
          order by c.created_at limit $2`,
        [like, limit],
      ),
      many(
        `select a.*, c.slug as channel_slug, c.name as channel_name
           from assets a
           join channels c on c.id = a.channel_id
           left join profiles o on o.id = c.owner_id
          where a.status = 'live'
            and c.moderation_state not in ('removed', 'suspended')
            and coalesce(o.banned, false) = false
            and c.listing_mode = 'marketplace'
            -- The file's own state, which this query never used to read: a removed
            -- file stayed in search results and its link landed on a 404, and a
            -- file nobody has looked at yet had no business being the answer to a
            -- stranger's search. The list comes from src/moderation.js, so a state
            -- added there is filtered here without anyone remembering to.
            and a.moderation_state = any($3)
            and (a.title ilike $1 or a.description ilike $1)
          order by a.created_at desc limit $2`,
        [like, limit, SEARCHABLE_ASSET_STATES],
      ),
    ]);
    return { stores, assets, term };
  },

  // ---- what draws in a slot ----------------------------------------------
  /**
   * Every active creative that could fill this channel's slots: the store's own
   * and the platform's. One query, filtered in the composer rather than here,
   * because "which creative wins" is a product rule and belongs with the rest of
   * the product rules.
   */
  creativesForChannel(channelId) {
    return many(
      `select * from slot_creatives
        where active and (channel_id = $1 or owner = 'platform')
        order by owner desc, rank asc, created_at asc`,
      [channelId],
    );
  },

  /**
   * A store writes one message per slot. Replacing it replaces it — a creative
   * library is a feature nobody asked for, and a version history of ad copy is a
   * liability with an audience of one.
   */
  async setCreative({ channelId, slotKey, headline, body = null, imageUrl = null, linkUrl = null, linkLabel = null }) {
    const head = String(headline || '').trim().slice(0, 90);
    if (!head) return null;
    return one(
      `insert into slot_creatives
         (owner, channel_id, slot_key, headline, body, image_url, link_url, link_label)
       values ('channel', $1, $2, $3, $4, $5, $6, $7)
       on conflict (channel_id, slot_key) where owner = 'channel' do update
         set headline   = excluded.headline,
             body       = excluded.body,
             image_url  = excluded.image_url,
             link_url   = excluded.link_url,
             link_label = excluded.link_label,
             active     = true,
             updated_at = now()
       returning *`,
      [channelId, slotKey || '*', head,
        body ? String(body).trim().slice(0, 220) : null,
        imageUrl ? String(imageUrl).trim().slice(0, 300) : null,
        linkUrl ? String(linkUrl).trim().slice(0, 300) : null,
        linkLabel ? String(linkLabel).trim().slice(0, 40) : null],
    );
  },

  async clearCreative({ channelId, slotKey }) {
    return one(
      `update slot_creatives set active = false, updated_at = now()
        where channel_id = $1 and owner = 'channel'
          and slot_key = $2
        returning *`,
      [channelId, slotKey || '*'],
    );
  },

  /**
   * The platform's own creative. Upserted by key rather than appended: the copy
   * lives in code, so a deploy that changes it should change the page and not
   * stack a second house ad beside the first.
   */
  async ensurePlatformCreative({ slotKey = '*', headline, body = null, linkUrl = null, linkLabel = null }) {
    return one(
      `insert into slot_creatives (owner, channel_id, slot_key, headline, body, link_url, link_label, is_house)
       values ('platform', null, $1, $2, $3, $4, $5, true)
       on conflict (slot_key) where owner = 'platform' do update
         set headline = excluded.headline, body = excluded.body,
             link_url = excluded.link_url, link_label = excluded.link_label,
             -- Set on every boot, so a row written before this column existed is
             -- marked by the only writer that produces house rows.
             is_house = true,
             active = true, updated_at = now()
       returning *`,
      [slotKey, headline, body, linkUrl, linkLabel],
    );
  },

  /** The platform's own inventory. Seeded at boot, never written by a tenant. */
  platformCreatives() {
    return many("select * from slot_creatives where owner = 'platform' and active order by rank");
  },

  /**
   * One audit row.
   *
   * `actorId` and the subject are optional because most of the thirty existing
   * callers do not pass them, and an audit trail that required every call site to
   * be rewritten would not have been written at all. The operator console reads
   * the ones that do.
   */
  async audit(action, meta = {}, { actorId = null, subjectType = null, subjectId = null } = {}) {
    await query(
      `insert into audit_logs (action, actor_id, subject_type, subject_id, meta)
       values ($1, $2, $3, $4, $5)`,
      [action, actorId, subjectType, subjectId, JSON.stringify(meta)],
    );
  },

  /**
   * Find a store.
   *
   * The console could count stores, and moderate one it was already looking at,
   * but there was no way to FIND one: an operator who needed to act on a store
   * they had been told about by name, slug or owner had to guess a URL or scroll
   * Explore. This is the missing index.
   *
   * Every filter is a parameter, every sort key is from a fixed list (never
   * interpolated from the query string), and the total is counted in the same
   * round trip with `count(*) over ()` so a page never disagrees with the header
   * that says how many there are.
   */
  async storeDirectory({
    q = '', state = 'all', plan = 'all', identity = 'all', sort = 'traffic', page = 1, perPage = 25,
  } = {}) {
    // Unqualified names below, because the whole select is wrapped in a subselect:
    // `identity_state` is computed from two lateral joins (the standing outcome and
    // any open request) and filtered on in the outer query, since Postgres will not
    // let a WHERE clause read a select alias. The alternative — a second copy of the
    // CASE inside the WHERE — is two definitions of "lapsing", which is how a filter
    // and the chip beside it start disagreeing about the same store.
    const SORTS = {
      traffic: 'views_30d desc nulls last, created_at desc',
      unlocks: 'unlocks desc, views_30d desc nulls last',
      files: 'files_live desc, created_at desc',
      newest: 'created_at desc',
      name: 'lower(name) asc',
      expiry: 'verification_expires_at asc nulls last',
    };
    const order = SORTS[sort] || SORTS.traffic;
    const term = String(q || '').trim();
    const limit = Math.min(Math.max(Number(perPage) || 25, 5), 100);
    const offset = Math.max((Number(page) || 1) - 1, 0) * limit;

    const rows = await many(
      `select x.*, count(*) over () as total_rows from (
      select c.id, c.slug, c.name, c.tagline, c.created_at, c.listing_mode, c.moderation_state,
              c.moderation_reason, c.owner_id,
              coalesce(s.plan_code, 'free')                                        as plan_code,
              coalesce(s.status, 'active')                                         as sub_status,
              (select count(*)::int from assets a
                where a.channel_id = c.id and a.status = 'live')                   as files_live,
              (select count(*)::int from assets a where a.channel_id = c.id)       as files_total,
              (select coalesce(sum(pv.views), 0)::int from page_view_daily pv
                where pv.channel_id = c.id and pv.day > current_date - 30)         as views_30d,
              (select count(*)::int from unlocks u
                join assets a on a.id = u.asset_id
                where a.channel_id = c.id and u.revoked_at is null)                as unlocks,
              (select count(*)::int from ad_view_events e
                join assets a on a.id = e.asset_id
                where a.channel_id = c.id and e.completed
                  and e.created_at > now() - interval '30 days')                   as ad_views_30d,
              (select count(*)::int from reviews r
                join assets a on a.id = r.asset_id
                where a.channel_id = c.id)                                        as reviews,
              (select max(a.created_at) from assets a where a.channel_id = c.id)   as last_file_at,
              (select max(pv.day) from page_view_daily pv where pv.channel_id = c.id) as last_view_day,
              p.email as owner_email, p.display_name as owner_name,
              v.expires_at     as verification_expires_at,
              v.method         as verification_method,
              v.verified_at    as verification_at,
              v.notice_sent_at as verification_notice_at,
              req.created_at   as verification_requested_at,
              -- The standing outcome, which is what the badge is: one fact, and
              -- the same bands lapseOf uses in the app — so the chip in this
              -- column and the sentence on the store's own page cannot disagree.
              case
                when v.id is null                               then 'none'
                when v.expires_at <= now()                      then 'lapsed'
                when v.expires_at <= now() + interval '60 days' then 'lapsing'
                else 'checked'
              end as identity_state
         from channels c
         left join lateral (select sub.plan_code, sub.status
                              from subscriptions sub
                             where sub.channel_id = c.id
                             order by sub.created_at desc limit 1) s on true
         left join profiles p on p.id = c.owner_id
         left join lateral (select sv.id, sv.method, sv.verified_at, sv.expires_at,
                                   sv.notice_sent_at
                              from seller_verifications sv
                             where sv.channel_id = c.id and sv.status <> 'pending'
                             order by sv.created_at desc limit 1) v on true
         left join lateral (select sv.id, sv.created_at
                              from seller_verifications sv
                             where sv.channel_id = c.id and sv.status = 'pending'
                             order by sv.created_at desc limit 1) req on true
        where ($1 = '' or c.name ilike '%' || $1 || '%' or c.slug ilike '%' || $1 || '%'
               or p.email ilike '%' || $1 || '%' or p.display_name ilike '%' || $1 || '%')
          and ($2 = 'all'
               or ($2 = 'held' and c.moderation_state in ('restricted','suspended','removed'))
               or c.moderation_state = $2)
          and ($3 = 'all'
               or ($3 = 'paid' and coalesce(s.plan_code, 'free') <> 'free')
               or ($3 = 'free' and coalesce(s.plan_code, 'free') = 'free'))
      ) x
       -- Two independent questions, and the filter asks whichever one the caller
       -- meant. A store can be BOTH waiting on us and close to its date — the
       -- ordinary renew-early case, not an edge case — and the first version of this
       -- column folded them into one value, so the console's "checks ending" queue
       -- linked to a filter that excluded the very store it had just counted. It is
       -- the same split the model makes everywhere else: the state is the badge, and
       -- a request is a fact of its own.
       where ($6 = 'all'
              or ($6 = 'pending' and x.verification_requested_at is not null)
              or ($6 <> 'pending' and x.identity_state = $6))
        order by ${order}
        limit $4 offset $5`,
      [term, ['all', 'approved', 'restricted', 'suspended', 'removed', 'held'].includes(state) ? state : 'all',
        ['all', 'free', 'paid'].includes(plan) ? plan : 'all', limit, offset,
        // Validated against the states the CASE can actually produce, so a URL
        // somebody typed cannot become a filter that silently matches nothing.
        ['all', 'none', 'pending', 'checked', 'lapsing', 'lapsed'].includes(identity) ? identity : 'all'],
    );

    return {
      rows,
      total: rows.length ? Number(rows[0].total_rows) : 0,
      page: Math.max(Number(page) || 1, 1),
      perPage: limit,
    };
  },

  /**
   * Everything an operator needs about ONE store, in four queries.
   *
   * The console had a moderation queue and a payments queue, and both of them
   * ended at the store: to answer "is this seller fine, or is this the third
   * time?", an operator had to open four pages and hold the answers in their
   * head. This assembles the picture in one place — who owns it, what they pay,
   * what they published, what has been reported, and what has been decided about
   * it — so a decision can be made from evidence rather than from a hunch.
   *
   * Deliberately absent: anything a creator was paid. That number belongs to the
   * network's statement, and a console that displays an estimate next to real
   * invoices teaches an operator to trust the wrong one.
   */
  async storeDetail(slug) {
    const channel = await one(
      `select c.*, coalesce(s.plan_code, 'free') as plan_code, s.status as sub_status,
              s.period_start, s.period_end, s.pending_plan_code,
              p.display_name as owner_name, p.email as owner_email, p.created_at as owner_since,
              (select count(*)::int from channel_slots cs
                where cs.channel_id = c.id and cs.enabled and cs.payout_party = 'platform') as rent_slots,
              (select count(*)::int from channel_slots cs
                where cs.channel_id = c.id and cs.enabled and cs.payout_party = 'channel')  as own_slots,
              (select count(*)::int from ad_connections ac
                where ac.channel_id = c.id and ac.status = 'active')                       as live_connections
         from channels c
         left join lateral (select sub.plan_code, sub.status, sub.period_start, sub.period_end,
                                   sub.pending_plan_code
                              from subscriptions sub where sub.channel_id = c.id
                             order by sub.created_at desc limit 1) s on true
         left join profiles p on p.id = c.owner_id
        where c.slug = $1`,
      [slug],
    );
    if (!channel) return null;

    const [files, reports, invoice, history] = await Promise.all([
      many(
        `select a.id, a.title, a.slug, a.status, a.unlock_mode, a.created_at,
                (select count(*)::int from unlocks u
                  where u.asset_id = a.id and u.revoked_at is null)                       as unlocks,
                (select count(*)::int from ad_view_events e
                  where e.asset_id = a.id and e.completed)                                as ad_views,
                (select count(*)::int from asset_reports r
                  where r.asset_id = a.id and r.status = 'open')                          as open_reports,
                (select count(*)::int from asset_reports r where r.asset_id = a.id)       as reports_total,
                (select count(*)::int from reviews v where v.asset_id = a.id)             as reviews,
                (select coalesce(avg(v.rating), 0)::numeric(3,2) from reviews v
                  where v.asset_id = a.id)                                                as rating
           from assets a where a.channel_id = $1
          order by a.created_at desc`,
        [channel.id],
      ),
      many(
        // Postgres has no `count(distinct …) over (…)`. A lateral subquery gives
        // the same number per file without a window function — the alternative
        // was one query per row.
        `select r.id, r.reason, r.note, r.status, r.created_at, r.resolved_at,
                a.title as asset_title, a.slug as asset_slug, a.status as asset_status,
                d.reporters
           from asset_reports r
           join assets a on a.id = r.asset_id
           join lateral (select count(distinct x.reporter_id)::int as reporters
                           from asset_reports x where x.asset_id = r.asset_id) d on true
          where r.channel_id = $1
          order by case r.status when 'open' then 0 else 1 end, r.created_at desc
          limit 40`,
        [channel.id],
      ),
      one(
        `select * from rent_invoices where channel_id = $1 order by period_end desc limit 1`,
        [channel.id],
      ),
      many(
        `select l.*, p.display_name as actor_name, p.email as actor_email
           from audit_logs l left join profiles p on p.id = l.actor_id
          where l.subject_id = $1 or l.meta->>'channelId' = $2
          order by l.created_at desc limit 20`,
        [channel.id, channel.id],
      ),
    ]);

    return { channel, files, reports, invoice: invoice || null, history };
  },

  /**
   * The storefronts a crawler may index.
   *
   * Public and not held, and nothing else: a suspended or removed storefront
   * answers 404 on purpose, so listing one in a sitemap would hand a search
   * engine a broken link. `last_changed` is the newest file in the store, because
   * that is the last time the page's content actually changed — a `lastmod` that
   * moves every day teaches a crawler to ignore it.
   */
  indexableStores() {
    return many(
      `select c.slug,
              greatest(
                coalesce(max(a.created_at), c.created_at),
                c.created_at
              ) as last_changed
         from channels c
         left join assets a on a.channel_id = c.id and a.status = 'live'
        where c.moderation_state = 'approved'
          and c.listing_mode = 'marketplace'
        group by c.id, c.slug, c.created_at
        order by last_changed desc
        limit 5000`,
    );
  },

  /**
   * Every statement a creator has entered, with our estimate for the SAME window.
   *
   * This is the query behind the operator's calibration page, and the window is
   * the whole point. The seller's own page compares a month of statements against
   * the last 30 days of views, which is fine as a rough signal and wrong as a
   * measurement — the two windows can be different months entirely. Here the
   * views are counted inside each statement's own period, so the ratio means what
   * it says.
   *
   * `closed` mirrors `periodStatus()` in earnings.js: a period whose end is in the
   * future, or within the last five days, is not settled and is not counted. A
   * network closes its books after the month ends and we cannot claim to know a
   * number it has not published.
   *
   * Returns one row per (store, provider), plus the store and owner for the
   * operator to act on.
   */
  statementCalibration({ graceDays = 5 } = {}) {
    return many(
      `with closed as (
         select r.*, c.name as channel_name, c.slug as channel_slug, c.moderation_state,
                p.email as owner_email, p.display_name as owner_name
           from provider_reports r
           join channels c on c.id = r.channel_id
           left join profiles p on p.id = c.owner_id
          where r.period_end < (current_date - $1::int)
       ),
       -- Views counted only inside the days the statement covers. A period may be
       -- entered twice for the same store and provider only if the dates differ
       -- (the unique key is on period_start), so overlapping periods would
       -- double-count views; the join is a lateral per report instead of a
       -- straight join so each report's window is measured independently.
       per_report as (
         select k.channel_id, k.provider_id, k.id as report_id,
                k.period_start, k.period_end, k.reported_usd,
                coalesce(v.views, 0) as views,
                coalesce(v.events, 0) as events
           from closed k
           left join lateral (
             select count(*) filter (where e.completed)::int as views,
                    count(*)::int                            as events
               from ad_view_events e
              where e.channel_id = k.channel_id
                and e.provider_id = k.provider_id
                and e.created_at >= k.period_start
                and e.created_at < (k.period_end + interval '1 day')
           ) v on true
       )
       select pr.channel_id, c.slug as channel_slug, c.name as channel_name,
              c.moderation_state, p.email as owner_email, p.display_name as owner_name,
              pr.provider_id,
              count(*)::int                        as periods,
              sum(pr.reported_usd)                 as reported_usd,
              sum(pr.views)::int                   as views,
              sum(pr.events)::int                  as events,
              max(pr.period_end)                   as last_period_end,
              min(pr.period_start)                 as first_period_start,
              -- Our arithmetic over the same days, at the rate the platform
              -- assumes, so the two figures are produced the same way the rent
              -- estimate is.
              round((sum(pr.views) / 1000.0 * $2)::numeric, 4) as estimate_usd,
              -- The rate the statements imply. Null when there is nothing to
              -- divide, because a rate from zero views is not zero, it is unknown.
              case when sum(pr.views) > 0
                   then round((sum(pr.reported_usd) / (sum(pr.views) / 1000.0))::numeric, 4)
                   else null end                  as implied_rpm_usd
         from per_report pr
         join channels c on c.id = pr.channel_id
         left join profiles p on p.id = c.owner_id
        group by pr.channel_id, c.slug, c.name, c.moderation_state, p.email, p.display_name, pr.provider_id
        order by sum(pr.reported_usd) desc`,
      [graceDays, POLICY.assumedRpmUsd],
    );
  },

  /**
   * The statements a creator has entered but which are not settled yet.
   *
   * Shown separately and never counted: the page has to be able to say "two more
   * months are open" instead of silently leaving them out, because a creator who
   * entered a figure and does not see it counted will enter it again.
   */
  openStatements() {
    return many(
      `select r.id, r.period_start, r.period_end, r.reported_usd, r.provider_id,
              c.slug as channel_slug, c.name as channel_name,
              (current_date - r.period_end)::int as days_since_end
         from provider_reports r
         join channels c on c.id = r.channel_id
        where r.period_end >= (current_date - 5)
        order by r.period_end desc
        limit 50`,
    );
  },

  /**
   * The audit log, searched rather than dumped.
   *
   * The page this replaces fetched the newest 300 rows, filtered them in
   * JavaScript by substring, and printed "12 of 300" — a number that describes
   * the page's own array, not the table. An operator reading "300" has no way to
   * know whether the table holds 300 rows or 300,000, and the research on audit
   * UIs is unanimous that filters are what make a feed usable "after the first
   * week". So: every filter is SQL, the total is a real count, and the window is
   * paged.
   *
   * The subject is resolved to something a person can read — a store's name, a
   * profile's email — because `asset 4f2c…` is a row nobody can act on, and the
   * research asks for "the target (record type plus a human-friendly name)".
   * Resolution is by id, so it says nothing about a row whose subject has since
   * been deleted: the name falls back to the type alone, and the row stays.
   */
  auditSearch({
    family = 'decisions', actor = '', q = '', since = 'all', page = 1, perPage = 50,
  } = {}) {
    const FAMILY = familyCase();
    const where = [];
    const params = [];
    const bind = (value) => { params.push(value); return `$${params.length}`; };

    // `decisions` is the default view: the families that record a person
    // choosing something. It is a filter, not a hiding — the count of everything
    // else is on the page next to it.
    const decisionKeys = AUDIT_FAMILIES.filter((f) => f.decisions).map((f) => f.key);
    if (family === 'decisions') {
      where.push(`${FAMILY} = any(${bind(decisionKeys)})`);
    } else if (family && family !== 'all') {
      where.push(`${FAMILY} = ${bind(family)}`);
    }
    if (String(actor).trim().length >= 2) {
      const term = `%${String(actor).trim().toLowerCase()}%`;
      const a = bind(term);
      where.push(`(lower(coalesce(p.email, '')) like ${a} or lower(coalesce(p.display_name, '')) like ${a})`);
    }
    if (String(q).trim().length >= 2) {
      const term = `%${String(q).trim().toLowerCase()}%`;
      const a = bind(term);
      // The meta blob is searchable too: a store id or a reference number pasted
      // from an email is exactly how somebody arrives at this page.
      where.push(`(lower(l.action) like ${a} or lower(coalesce(l.meta::text, '')) like ${a})`);
    }
    const SINCE = { day: "now() - interval '24 hours'", week: "now() - interval '7 days'", month: "now() - interval '30 days'" };
    if (SINCE[since]) where.push(`l.created_at > ${SINCE[since]}`);
    const clause = where.length ? `where ${where.join(' and ')}` : '';

    const size = Math.min(Math.max(Number(perPage) || 50, 10), 200);
    const pages = Math.max(Number(page) || 1, 1);

    return withTransaction(async (c) => {
      const rows = await c.query(
        `select l.id, l.action, l.subject_type, l.subject_id, l.meta, l.created_at,
                p.display_name as actor_name, p.email as actor_email, p.role as actor_role,
                case when l.subject_type = 'channel' then ch.name
                     when l.subject_type = 'profile' then pr.email
                     else null end as subject_label,
                case when l.subject_type = 'channel' then ch.slug else null end as subject_slug,
                ${FAMILY} as family,
                count(*) over () as total_rows
           from audit_logs l
           left join profiles p on p.id = l.actor_id
           left join channels ch on l.subject_type = 'channel' and ch.id = l.subject_id
           left join profiles pr on l.subject_type = 'profile' and pr.id = l.subject_id
           ${clause}
          order by l.created_at desc, l.id desc
          limit ${size} offset ${(pages - 1) * size}`,
        params,
      );
      // Counts over every family, unfiltered, so a tab can never show a number
      // that depends on the search box.
      const counts = await c.query(
        `select ${FAMILY} as family, count(*)::int as n, max(created_at) as last_at from audit_logs group by 1`,
      );
      const total = Number(rows.rows[0]?.total_rows || 0);
      return {
        rows: rows.rows,
        total,
        counts: Object.fromEntries(counts.rows.map((r) => [r.family, { n: r.n, last_at: r.last_at }])),
        allRows: counts.rows.reduce((sum, r) => sum + r.n, 0),
        page: pages,
        pages: Math.max(Math.ceil(total / size), 1),
        perPage: size,
      };
    });
  },

  /** The newest rows, unfiltered — what the overview's activity strip reads. */
  recentAudit(limit = 200) {
    return many(
      `select l.*, p.display_name as actor_name, p.email as actor_email
         from audit_logs l left join profiles p on p.id = l.actor_id
        order by l.created_at desc, l.id desc limit $1`,
      [Math.min(Number(limit) || 200, 500)],
    );
  },

  /**
   * Audit rows somebody DECIDED, newest first.
   *
   * `recentAudit` is the raw log and it is mostly `auth.login` and
   * `consent.recorded`. That is right for the audit page, which says it is
   * everything and has a filter — but it is noise on the operator's overview,
   * where the first few rows should be the most recent decisions about money, a
   * store or a connection. No fallback to the raw log on purpose: eight sign-ins
   * dressed up as an activity feed is worse than an empty one, because it looks
   * like evidence of supervision while showing none.
   */
  recentDecisions(limit = 8) {
    const prefixes = ['plan.', 'rent.', 'moderation.', 'ad_connection.', 'creative.',
      'asset.', 'review.', 'report.', 'channel.', 'user.'];
    return many(
      `select l.*, p.display_name as actor_name, p.email as actor_email
         from audit_logs l left join profiles p on p.id = l.actor_id
        where ${prefixes.map((_, i) => `l.action like $${i + 2}`).join(' or ')}
        order by l.created_at desc, l.id desc limit $1`,
      [Math.min(Number(limit) || 8, 200), ...prefixes.map((pfx) => `${pfx}%`)],
    );
  },
};

export function slugify(s) {
  return String(s).toLowerCase().trim()
    .replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').slice(0, 60);
}
