/**
 * ByteBikri app server.
 *
 * Run:
 *   npm run db:start      # real Postgres, local data dir
 *   npm run db:migrate    # apply db/migrations
 *   npm start             # → http://localhost:3000
 *
 * Uploads land in ./.data/uploads behind the `storage` adapter. Swapping in the
 * media API means implementing three methods there — nothing above changes.
 */
import express from 'express';
import helmet from 'helmet';
import multer from 'multer';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { store, storage, SLOT_DEFS, slugify, PLANS, nextPlan } from './src/store.js';
import { hostsEnabled, mediaOrigins as videoMediaOrigins } from './src/video.js';
// The cosmetics engine: the look picker's slots, declared once. This route validates a
// submitted look against the catalog rather than against a list typed here.
import { personSlots } from './src/cosmetics.js';
import {
  METHODS, DEFAULT_MONTHS, LAPSE_WINDOW_DAYS, stateOf, requestability, lapseOf, lapseNotice,
  withinNoticeWindow,
} from './src/verification.js';
import { assertProductionConfig, readSecret, checkConfig, formatConfigReport, isProd } from './src/config.js';
import { query, many, scalar, health as dbHealth, close as closeDb } from './src/db.js';
import { allocateSlots, estimateRentSlotValue, POLICY } from './src/slots.js';
import { csvCell, csvDocument, exportAll, truncationNote } from './src/export.js';
import { AUDIT_FAMILIES, actorOf } from './src/audit.js';
import { successFlash } from './src/flash.js';
// The first message this platform sends to somebody who did not ask for it. See
// the header of src/notices.js for why a person sends it rather than a job.
import { sendLapseNotice } from './src/notices.js';
// The CSV must print a date the same way the page does, so the export borrows the
// page's formatter rather than growing a second opinion about it.
import { isoDay } from './src/views.js';
// The CSV carries the same one-line detail the page shows, from the same function:
// an export that says something different from the screen is worse than no export.
import { briefMeta } from './src/views.js';
import { composeSlots, HOUSE_CREATIVE, sanitizeUrl } from './src/creatives.js';
import { exploreRails } from './src/ranking.js';
import {
  ACTIONS as MOD_ACTIONS, ACTION_LABELS, ASSET_ACTIONS, ASSET_ACTION_TO_STATE,
  ASSET_BEHAVIOUR, PERSON_ACTIONS, assetBehaviour, behaviour, canWrite,
  changesVisibility, decisionNote, isAssetPublic, isPublic, isPublicChannel, normaliseAssetState,
  normaliseState, personStateFor, stateFor, validateAssetDecision, validateDecision,
} from './src/moderation.js';
import {
  COUNTRY_LIMITS, RULE_STATES, availabilityFor, blockSentence, blockStatus,
  CREATOR_COUNTRY_STATES, countryFrom, isRefused, resolveCountry, restrictedSentence,
  validateCountryDecision,
} from './src/geo.js';
import { COUNTRY_OPTIONS, countryIn, countryName, isCountryCode } from './src/countries.js';
import {
  AUTO_HIDE_AFTER, orderQueue, reportVerdict, validateReport,
  hidingNotice, canAppeal, cleanStatement, APPEAL_LIMIT, reporterMessage,
  maySeeHiddenFile,
} from './src/reports.js';
import {
  onboardingFor, connectable, postbackUrl, validateCredential, maskSecret,
  connectionHealth, unconnectableNote,
} from './src/connections.js';
import {
  railDetails, railsReady, payeeName, upgradeExplanation, planBenefits, planUsage, planDrift, NOT_CHARGED,
} from './src/billing.js';
import { earningsSummary, MONEY_MAP, payoutChecklist, periodStatus, calibrationVerdict, calibrationRowState as calibrationState } from './src/earnings.js';
// Membership rules: the palettes, the tier validation, the lapse clock and the
// one sentence about money that has to be true wherever dues are mentioned.
import {
  TIERS_MAX, PERIODS, CLAIM_METHODS, ACCENTS, ACCENT_KEYS, MONEY_LINE, FREE_PLAN_LINE,
  PLATE_COPY, tierDraft, paymentNoteDraft, membershipState, membershipCurrent, memberBadge,
  doorsOf, adModeOf, attentionProgress, standingOf, attentionViews, JOIN_MODES, AD_MODES,
  duesLine, tierByNo, memberAdFreeFor,
} from './src/memberships.js';
// Storefront themes: curated palettes, and the plan capability that has been in
// the plans table since migration 0001 without a single reader until now.
import { THEMES, THEME_KEYS, THEME_NOTE, THEME_FREE_LINE, NO_THEME, canTheme, themeDraft, themeStyle } from './src/themes.js';
// The person's own premium, and the ladder for a rewarded ad that never arrives.
// Both pure modules, so the route layer decides nothing they have not already
// written down in one place.
import {
  plusState, plusWear, PLUS_NAME, PLUS_CODE, PLUS_YEAR_CODE,
  // The codes a person may actually buy, from the module that owns the plan keys —
  // the routes check a submitted code against THIS list rather than against strings
  // typed into the handler.
  PURCHASABLE_PLAN_CODES,
  // Gifting: the code somebody types, the two periods a person may buy, and the
  // four states a gift can be in — all of them written in the module that owns the
  // vocabulary rather than spelled again here.
  normalizeGiftCode,
} from './src/plus.js';
import {
  SIGNALS, BLOCKING_SIGNALS, signalFrom, rungFor, playerWords, readerWords, SIGNAL_WINDOW_HOURS,
} from './src/blocked.js';
import { SANDBOX_PROVIDER_IDS } from './src/providers/index.js';
import { selectableProviders, providerById, payoutVerdict, loadRegistry } from './src/registry.js';
import {
  startUnlock, startBreak, startLiveView, unlockStatus, handlePostback, signHousePostback,
  verifyAccessToken, issueDownloadUrl, issueStreamUrl, issuePageUrl,
} from './src/unlocks.js';
import {
  mediaKind, isPlayable, isWatermarkable, hasImageMagick, watermarkImage,
  watermarkLabel, watermarkSvgDataUri, derivativeKey, cachedDerivative, cacheDerivative,
  rangeFor, assetShape, isLiveUrl, measuredSeconds, MAX_RUNTIME_SEC,
} from './src/media.js';
import { placementPanelShown, breakCues, betweenCues, breaksSupported } from './src/placement.js';
// The page model (§13): what a read is once its pages are counted, and where the
// gates fall between them. Imported here because the reader's route, the gate and
// the file page must all read the same answer.
import {
  segmentsFor, gatesBefore, segmentFor, stepLabel, gateSentence, isArchiveName,
  readMode, readDirection, READ_MODES, READ_DIRECTIONS,
} from './src/pages.js';
import { readEntry } from './src/archive.js';
// The live surface (§14): the two facts a stream has, and the arithmetic a break
// buys. Imported as a module because the page, the poller, the seller's panel and
// the tests must read the same answer.
import {
  liveState, liveBreakRefusal, nextCueIndex, tradeSentence, cleanEntrySentence,
  cleanEntryUntil, windowIsOpen, windowEndsAt, LIVE_LENGTHS, LIVE_POLL_SECONDS,
} from './src/live.js';
// The series (§15): the store's own order, what counts as finished, which episode a
// person should be handed, and the refusals. One module, because the storefront's card,
// the episode strip, the series page, the seller's panel and the tests must agree about
// all four — and because a second opinion about "the next episode" is exactly how a
// viewer gets handed the episode they just finished.
import {
  SERIES_SHAPES, SERIES_MODE_KEYS, SERIES_REFUSALS, WATCH_MAX_SECONDS,
  episodeOrder, landingEpisode, nextEpisode, previousEpisode, freeEpisodeNo,
  seriesSlug, seriesRefusalCode,
} from './src/series.js';
import { selfTest as adapterSelfTest, advisories as adapterAdvisories, ADAPTERS } from './src/providers/index.js';
import * as views from './src/views.js';
import { REVEAL_BOOTSTRAP } from './src/views.js';

/**
 * The CSP hash of that one inline script.
 *
 * Computed, never typed: a hand-copied hash that stops matching does not fail
 * loudly — it simply stops the reveal from running, which is invisible in every
 * way except that nothing moves.
 */
const REVEAL_HASH = `sha256-${crypto.createHash('sha256').update(REVEAL_BOOTSTRAP, 'utf8').digest('base64')}`;
import * as auth from './src/auth.js';
import { originCheck, rateLimit, cookieParser, setSessionCookie, clearSessionCookie } from './src/security.js';
import * as recovery from './src/recovery.js';
import * as verify from './src/verify.js';
// Named separately so the page code reads 'the person's recovery history' rather
// than 'the recovery module', which are two different things at the call site.
const recoveryOf = recovery.personRecovery;
import {
  consentState, recordConsent, PURPOSES, newVisitorId, CONSENT_COOKIE, POLICY_VERSION,
} from './src/consent.js';
import * as legal from './src/legal.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const APP = express();

APP.disable('x-powered-by');

// Security headers. The CSP is the part that matters: script-src 'self' means
// an injected <script> does not execute, which is the failure that actually
// costs a session. style-src allows inline because slot heights are per-row
// values from the database; that is a real weakening and the honest description
// is "styles are trusted, scripts are not".
APP.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      // One inline script is allowed, and only because its exact bytes are named
      // here: the reveal bootstrap in the head must run before first paint, and
      // it must run as inline. The hash is computed from the constant the view
      // renders, so the two cannot drift — a hash that stops matching does not
      // fail loudly, it silently stops the reveal from ever running.
      scriptSrc: ["'self'", `'${REVEAL_HASH}'`],
      styleSrc: ["'self'", "'unsafe-inline'"],
      // Ad networks load their own scripts and frames from their own origins.
      // Locked to 'self' for now because no tag is rendered yet; this list grows
      // when component 6 does, and it must be an allowlist, never a wildcard.
      /*
       * `img-src` names the media hosts, and for the same reason `media-src` does.
       *
       * A store's image can now live at a host (`IMAGE_DRIVER`), and the page loads it
       * through our route, which answers with a 302 to that host's url. CSP judges a
       * redirect's DESTINATION, so with `'self' data:` alone the element never attempted the
       * request at all: the `<img>` was there, `naturalWidth` was 0, and the network log was
       * completely empty — the exact failure mode §10.4 records for media, found the same way,
       * by walking it (`/tmp/eyes/kind-walk.mjs`) rather than by reading the policy.
       *
       * `data:` was already allowed for the reveal/QR images this product draws itself, which
       * is a weaker allowance than the one added here, and an image can neither execute
       * anything nor send anything anywhere — the directives that could leak (`script-src`,
       * `connect-src`) stay narrow. The enumerated origins come first so a development or
       * staging host on plain `http` works without a certificate; `https:` covers the CDN a
       * provider redirects to, whose origin is only known once it answers.
       */
      imgSrc: ["'self'", 'data:', ...videoMediaOrigins(), 'https:'],
      // Scripts may only talk to us — this is the directive that would otherwise let an
      // injected script post a session somewhere. A hosted PLAYLIST is fetched by hls.js
      // through XHR, though, so the origins this deployment's providers serve media from
      // are named explicitly (`mediaOrigins`: the configured providers that can state
      // theirs, plus `VIDEO_MEDIA_ORIGINS`). Never `https:` here.
      connectSrc: ["'self'", ...videoMediaOrigins()],
      // hls.js plays HLS through MediaSource Extensions, and the MediaSource reaches
      // the element as a `blob:` URL owned by this origin — which Chrome does NOT
      // accept under `'self'` for media. It answers "Media load rejected by URL safety
      // check", the console shows a CSP violation, and the viewer gets a black
      // rectangle in the browser most of them use. The scheme is therefore named, and
      // only the scheme: a blob URL can still only come from this origin's own script.
      // The worker is the same story — hls.js transmuxes inside one when it can.
      // `blob:` because hls.js hands the element a MediaSource through one, which Chrome
      // refuses under `'self'` — the black rectangle this comment has always been about.
      //
      // `https:` because a HOSTED file is delivered by a redirect to the provider's CDN,
      // and CSP judges the redirect's DESTINATION. Without the scheme the element never
      // even attempts the request: `networkState` is 3 (NO_SOURCE), the error is code 4
      // (SRC_NOT_SUPPORTED), no network event fires, and the only person who could see why
      // is one reading the console. That was a real bug, found by
      // `ci/eyes/video-host-walk.mjs` in the round that added the second provider — the
      // server-side 302 was correct and the picture was still black.
      //
      // The widening is confined to media, which cannot execute anything, and `codecs`
      // aside a media element can send nothing anywhere: the directives that could leak
      // (script-src, connect-src) stay narrow. Kept as a named scheme rather than an
      // origin list because the CDN's origin is only known once the host answers.
      // The enumerated origins come first because they are also what makes a development
      // or staging deployment work when its media host is plain `http` — the scheme
      // allowance below is https only, and a stub on a LAN should not need a certificate.
      mediaSrc: ["'self'", 'blob:', ...videoMediaOrigins(), 'https:'],
      workerSrc: ["'self'", 'blob:'],
      frameSrc: ["'none'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      upgradeInsecureRequests: process.env.NODE_ENV === 'production' ? [] : null,
    },
  },
  // Ad networks embed our pages in a WebView, not an iframe, but this is the
  // right default and costs nothing.
  frameguard: { action: 'deny' },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  hsts: process.env.NODE_ENV === 'production' ? { maxAge: 15552000 } : false,
}));

// Raw body is retained so postback signatures cover the exact bytes received.
APP.use(express.json({
  limit: '1mb',
  verify: (req, _res, buf) => { req.rawBody = buf.toString('utf8'); },
}));
APP.use(express.urlencoded({ extended: true, limit: '256kb' }));
APP.use(cookieParser());
APP.use(originCheck({ publicBaseUrl: `http://127.0.0.1:${PORT}` }));
APP.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h', etag: true }));

/*
 * The demo live fixture, served by this app and reachable as itself.
 *
 * A real live file is the store's own URL on the store's own host: the viewer's
 * browser fetches it from them, and this platform never proxies a byte of it. The
 * demo has no such host, so the fixture built by `scripts/make-demo-live.mjs` is
 * served here — publicly, because a stream the platform does not own is not
 * something this app can put a door in front of, and pretending otherwise would be
 * a demo of a product we do not ship.
 *
 * `.m3u8` gets its registered type rather than the static default, because Safari
 * decides whether to hand a URL to its player on the strength of it.
 */
APP.use('/live-demo', express.static(path.join(__dirname, 'seed-assets/live-demo'), {
  maxAge: '1h',
  etag: true,
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.m3u8')) res.type('application/vnd.apple.mpegurl');
  },
}));
APP.set('trust proxy', 1);   // behind Cloudflare/Vercel, so req.ip is the client

// Rate limits. Named per purpose so a flood of one does not exhaust another.
// The three a person can reach from a page get a page back when they hit the
// limit; the postback limiter stays JSON, because a network's server is the only
// client and it reads the response.
const limitLogin = rateLimit({
  windowMs: 15 * 60_000, max: 12, name: 'sign-in attempts',
  render: (info) => views.tooMany({ ...info, consent: null }),
});
const limitSignup = rateLimit({
  windowMs: 60 * 60_000, max: 10, name: 'signups',
  render: (info) => views.tooMany({ ...info, consent: null }),
});
const limitUnlock = rateLimit({
  windowMs: 60_000, max: 20, name: 'unlock attempts',
  render: (info) => views.tooMany({ ...info, consent: null }),
});
const limitPostback = rateLimit({ windowMs: 60_000, max: 600, name: 'postbacks' });

const upload = multer({
  storage: multer.memoryStorage(),
  // A cap on the request, not just a preference: multer buffers to RAM, so an
  // unbounded upload is a memory exhaustion primitive.
  limits: { fileSize: 25 * 1024 * 1024, files: 2, fields: 12 },
});

/**
 * The identity-document uploader, and it is a separate instance on purpose.
 *
 * The shared `upload` allows 25 MB and two files, which is right for a content
 * upload and wrong for a passport: the smaller cap is the one that matters, and it
 * has to be enforced by multer BEFORE the bytes are buffered — a limit checked
 * after the buffer is full is a limit that has already spent the memory.
 */
const uploadDocument = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES, files: 1, fields: 6 },
});

/**
 * Multer refuses inside the middleware, so its refusals never reach a route: an
 * oversized file arrives as an error before any of our code runs, and the default
 * answer is a bare `PayloadTooLargeError` page. This turns the two refusals a
 * person can actually cause into the same kind of flash every other refusal in this
 * product uses, and lets anything else through to the error handler.
 *
 * `back` is a function of the request, because the URL it returns needs the slug —
 * which is why this cannot be a plain string built once at module load.
 */
const documentUpload = (back) => (req, res, next) =>
  uploadDocument.single('document')(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.redirect(back(req, 'error=doc-too-big'));
    }
    if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') {
      return res.redirect(back(req, 'error=doc-one'));
    }
    return next(err);
  });

// ---------------------------------------------------------------------------
// Session
//
// Identity comes from a signed-in session, full stop.
//
// There used to be a `?as=<email>` parameter that selected the acting user. That
// was an authentication bypass: any visitor could read any creator's dashboard by
// guessing an email address. It is gone, and it is not coming back in the form of
// a dev flag either — a flag is one misconfigured environment away from being a
// production bypass, and the whole point of removing it is that it cannot be
// reached. Demo accounts are seeded with real passwords instead (see seed()).
// ---------------------------------------------------------------------------
APP.use(async (req, _res, next) => {
  try {
    req.user = null;
    if (req.cookies?.bb_session) {
      req.user = await auth.resolveSession(req.cookies.bb_session);
    }
    next();
  } catch (err) { next(err); }
});

/**
 * Consent, resolved once per request.
 *
 * A missing cookie short-circuits to the "no decision" state WITHOUT a database
 * query, because that is the path every static asset and every first visit takes.
 * Only a visitor who has answered costs a lookup.
 */
APP.use(async (req, _res, next) => {
  try {
    req.consent = await consentState(req);
    req.consent.returnTo = req.originalUrl === '/consent' ? '/' : req.originalUrl;
    next();
  } catch (err) { next(err); }
});

/** An API route that needs an identity must refuse without one, not borrow one. */
function requireUser(res) {
  res.status(401).json({ ok: false, error: 'not signed in' });
  return null;
}

/** Page routes redirect instead of 401 — a JSON error is not a useful next step. */
function requireUserPage(req, res) {
  const next = encodeURIComponent(req.originalUrl);
  res.redirect(`/login?next=${next}`);
  return null;
}

// ---------------------------------------------------------------------------
// Page helpers
// ---------------------------------------------------------------------------
async function decorateChannels(channels) {
  if (!channels.length) return [];
  // One query for all the counts, rather than one per channel.
  const counts = await many(
    `select channel_id, count(*)::int as n from assets
      where status = 'live' and channel_id = any($1) group by channel_id`,
    [channels.map((c) => c.id)],
  );
  const byId = new Map(counts.map((r) => [r.channel_id, r.n]));
  return channels.map((c) => ({
    ...c,
    asset_count: byId.get(c.id) ?? 0,
    plan_code: store.plan(c).code,
    plan_price: store.plan(c).priceNpr,
  }));
}

/**
 * The page's positions, for one plan — and, when the VIEWER is a member of this store
 * on a plan that carries it, without the platform's own.
 *
 * `releasePlatformSlot` defaults to false, which is what every owner-facing and
 * platform-facing caller wants: the seller's own panel must show the position they pay
 * rent for, and the counter must count what the visitor's page actually drew. Only
 * `slotsFor` — the function that renders a page for a person — passes true, and only
 * after `memberAdFreeFor` has answered yes for that person on that store.
 */
async function buildSlots(channel, surfaces = ['web'], { releasePlatformSlot = false } = {}) {
  const plan = store.plan(channel);
  /*
   * The flag is SET, never inherited — and that distinction is the whole reason this
   * line is written out rather than spread.
   *
   * `plans.capabilities.ad_free` is an ENTITLEMENT: "this store may release the
   * platform's position for its members". `allocateSlots` reads the same key as an
   * INSTRUCTION: "release it, for this page, for this viewer". Passing the plan's blob
   * straight through — which is what this function did for one draft — made a Pro store
   * lose the position for everybody, not just for its members: the entitlement became a
   * site-wide release, the rent leg quietly stopped existing on the top plan, and every
   * page on that store went advertising-free for strangers too. Caught by a test that
   * asserts a position exists on every plan, which is exactly what that test is for.
   */
  const capabilities = { ...plan.capabilities, [POLICY.releasedBy]: releasePlatformSlot === true };
  return allocateSlots({
    slotDefs: SLOT_DEFS,
    capabilities,
    connections: await store.connectionsOf(channel.id),
    surfaces,
  });
}

/**
 * The channel named in the URL, but only for somebody allowed to change it.
 *
 * 404 rather than 403 for a stranger, here as everywhere else: confirming that a
 * store exists but is not yours still tells a stranger it exists. An operator is
 * allowed through — the platform has to be able to look at what it hosts.
 *
 * @returns {Promise<object|null>} the channel, or null once a response has been sent
 */
/**
 * A store hidden by moderation is a 404 to the public.
 *
 * The owner still sees it — they are the only person who can fix it — and an
 * operator sees it because the platform has to be able to look at what it hosts.
 * Everyone else gets exactly what a store that never existed returns: confirming
 * that a store exists but is suspended tells a stranger something nobody decided
 * to publish.
 */
function maySeeHidden(req, channel) {
  if (!req.user) return false;
  return req.user.id === channel.owner_id || req.user.role === 'admin';
}

/**
 * Refuse a WRITE while a store is suspended or removed.
 *
 * Reads stay open: the owner can see their own dashboard, files and history, and
 * an operator can see what they are deciding about. Publishing, editing, filling
 * a slot and connecting an account all stop — a store that is hidden from the
 * public is not one that should be collecting new content, and letting an owner
 * keep publishing into a storefront nobody can reach is the cruellest possible
 * version of this feature.
 *
 * @returns {boolean} true when the response has already been sent
 */
function refuseWrite(req, res, channel) {
  if (canWrite(channel.moderation_state)) return false;
  const wantsJson = req.path.startsWith('/api/') || req.get('accept')?.includes('application/json');
  const note = behaviour(channel.moderation_state).ownerNote;
  if (wantsJson) {
    res.status(403).json({ ok: false, error: 'store is not writable', detail: note });
  } else {
    res.redirect(`/dashboard/${encodeURIComponent(channel.slug)}?error=moderated`);
  }
  return true;
}

/**
 * The one way to say "not here" to a person.
 *
 * The storefront and asset routes used to answer `res.status(404).send('Channel
 * not found')`, which is a bare text page — no header, no footer, no search, no
 * way back. It was reachable by clicking any shared link to a store that had been
 * removed. Removed stores and stores that never existed must stay indistinguishable
 * ("byte for byte the same answer"), and this keeps that property while making the
 * answer a page.
 */
function notFoundPage(req, res, kind = null) {
  return res.status(404).send(views.notFound({
    user: req.user || null, consent: req.consent || null, requestedKind: kind,
  }));
}

async function requireOwnChannel(req, res) {
  if (!req.user) return requireUserPage(req, res);
  const channel = await store.channelBySlug(req.params.slug);
  if (!channel) {
    res.status(404).send('Channel not found');
    return null;
  }
  if (channel.owner_id !== req.user.id && req.user.role !== 'admin') {
    res.status(404).send('Channel not found');
    return null;
  }
  return channel;
}

/**
 * The allocation, with each slot's creative resolved for the viewer.
 *
 * `opts.viewer` decides who is looking: the owner of the store gets told to put
 * something in their empty space, a visitor gets a sentence that is not
 * addressed to them, and a visitor never gets a link into somebody's dashboard.
 */
/**
 * Count the positions a page is about to draw (ASSET_ECONOMY.md §12).
 *
 * Called with the slots the view is handed, and filtered through the view's OWN rule
 * for what reaches a visitor (`drawnSlots`), so the ledger counts boxes that were
 * rendered rather than positions that were allocated. `side` is read off
 * `payoutParty` — the same field that decides whose money a slot is — because the
 * page's whole honesty rests on our inventory and the store's never being added
 * together.
 *
 * Never awaited into the response path's failure modes: a ledger that can take a
 * storefront down is worse than a ledger with a gap, and the same is true of a page
 * view (`bumpPageView` is called the same way). Failures here are counted by the
 * route's own error handler and are visible in the log rather than silent.
 */
async function countPositions(channel, surface, slots = []) {
  const drawn = views.drawnSlots(slots);
  if (!drawn.length) return;
  try {
    await store.recordPositions(channel?.id ?? null, drawn.map((slot) => ({
      surface,
      // A page box is the catalogue's `aside`: "on the page", never a break.
      placement: 'aside',
      side: slot.payoutParty === 'platform' ? 'platform' : 'store',
    })));
  } catch (err) {
    console.error('ledger: positions not counted', err?.message || err);
  }
}

async function slotsFor(channel, { viewer = null, surface = 'storefront', surfaces = ['web'] } = {}) {
  // The one place the member's own page is decided. A signed-out visitor, the owner
  // and the operator all read the plan's capabilities as they are; a signed-in member
  // of a store whose plan carries `ad_free` reads them with the platform's position
  // released. Both conditions live in `memberAdFreeFor` — this call site only supplies
  // the two facts it cannot look up for itself.
  const membership = viewer ? await store.membershipFor(viewer.id, channel.id) : null;
  const release = memberAdFreeFor({
    capabilities: store.plan(channel).capabilities, membership,
  });
  const slots = await buildSlots(channel, surfaces, { releasePlatformSlot: release });
  const isOwner = Boolean(viewer) && viewer.id === channel.owner_id;
  return composeSlots(slots, await store.creativesForChannel(channel.id), {
    channelName: channel.name,
    isOwner,
    surface,
    editHref: isOwner ? `/dashboard/${channel.slug}/slots` : null,
  });
}

// ---------------------------------------------------------------------------
// Consent and legal
// ---------------------------------------------------------------------------
APP.post('/consent', async (req, res, next) => {
  try {
    const { acceptAll, rejectAll, normaliseChoices } = await import('./src/consent.js');
    const choice = String(req.body.choice || 'save');

    const choices = choice === 'all' ? acceptAll()
      : choice === 'none' ? rejectAll()
        : normaliseChoices({
          ads: req.body.ads === 'on',
          analytics: req.body.analytics === 'on',
        });

    // The visitor id is minted here, on the decision, rather than on arrival:
    // no cookie for someone who never answered, which is the least we can set
    // and still remember the answer.
    const visitorId = req.cookies?.[CONSENT_COOKIE] || newVisitorId();
    await recordConsent({ visitorId, choices, req, country: req.consent?.country ?? null });

    res.cookie(CONSENT_COOKIE, visitorId, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 365 * 24 * 60 * 60 * 1000,   // 12 months, then we ask again
    });

    // Only ever back to a path on this site. `?next=https://evil.example` would
    // turn our own consent form into a phishing hop.
    const back = typeof req.body.next === 'string' && req.body.next.startsWith('/') && !req.body.next.startsWith('//')
      ? req.body.next : '/';
    await store.audit('consent.recorded', { ads: choices.ads, analytics: choices.analytics, version: POLICY_VERSION });
    res.redirect(back);
  } catch (err) { next(err); }
});

/*
 * `mediaHost` is passed to every document and read by one of them: the privacy notice
 * is the only page whose text depends on whether this deployment delivers video bytes
 * through somebody else's CDN, and its date moves with that paragraph
 * (`VIDEO_STORAGE.md` §7). The consent version moves with the same fact, in
 * `src/consent.js`, so the two cannot disagree about what changed.
 */
const LEGAL_DOCS = { privacy: legal.privacy, terms: legal.terms, cookies: legal.cookies };

APP.get('/legal/:slug', async (req, res, next) => {
  try {
    const build = LEGAL_DOCS[req.params.slug];
    if (!build) return res.status(404).send('Not found');
    const doc = build({ consent: req.consent, mediaHost: hostsEnabled() });
    res.send(views.legalPage({
      user: req.user, doc, consent: req.consent,
      missingOperatorFields: legal.MISSING_OPERATOR_FIELDS,
      next: req.query.next && String(req.query.next).startsWith('/') ? String(req.query.next) : req.originalUrl,
    }));
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------
APP.get('/', async (req, res, next) => {
  try {
    // A store withheld from the visitor's country is not advertised to it. The
    // filter is the same one the storefront and Explore use, so a visitor cannot
    // find a store on one page that answers 451 on another.
    const channels = await storesVisibleTo(
      await decorateChannels(await store.channels()), viewerCountry(req),
    );
    const [assets, unlocks, views_] = await Promise.all([
      scalar(`select count(*)::int from assets`),
      scalar(`select count(*)::int from unlocks where revoked_at is null`),
      scalar(`select count(*)::int from ad_view_events where completed = true`),
    ]);
    res.send(views.landing({
      channels, user: req.user, consent: req.consent,
      // The same structure the earnings page renders, so the landing page cannot
      // form its own opinion about who pays whom.
      moneyMap: MONEY_MAP,
      stats: { channels: channels.length, assets, unlocks, views: views_ },
    }));
  } catch (err) { next(err); }
});

/**
 * The Explore rails.
 *
 * `canFeature` is the one place that decides who may buy placement, and it is
 * evaluated here rather than inside the ranking module — a ranking function that
 * knew what a plan costs would have to change the day a price changes.
 */
async function exploreState(channels) {
  const rows = await store.channelStats({ days: 30 });
  const stats = Object.fromEntries(rows.map((r) => [r.channel_id, r]));
  return exploreRails({
    channels: channels.filter((c) => c.listing_mode === 'marketplace'),
    stats,
    canFeature: (c) => store.plan(c).capabilities.featured_eligible === true,
  });
}

// ---------------------------------------------------------------------------
// Country rules on the read path
// ---------------------------------------------------------------------------
// The country is read from the edge header, resolved against the asset's own
// rule and the store's, and applied in four places: the storefront, the file
// page, the unlock call and the bytes themselves. See src/geo.js for the model
// and for why an unknown country means NO rule applies.

/** The country this request came from, or null. */
function viewerCountry(req) {
  // `isProd` is a function, not a constant — the first version of this line
  // passed `!isProd`, which is `false`, so the development override silently
  // never armed and the whole feature could only be tested by forging a header.
  return countryFrom(req, { dev: !isProd() });
}

/**
 * Any response that depends on the viewer's country is uncacheable.
 *
 * `no-store` is the load-bearing header, not `Vary`: CDNs are documented to
 * strip `Vary` values, and a cached 451 for India served to a visitor in Nepal
 * is a bug that looks exactly like the platform being broken. `Vary` is sent
 * anyway because it is the correct header wherever it is honoured.
 */
function countryDependent(res) {
  res.set('Cache-Control', 'private, no-store');
  res.set('Vary', 'CF-IPCountry');
}

/** The policy rule a decision cited, looked up in the list the page already has. */
function ruleFor(rules, code) {
  return code ? rules.find((r) => r.code === String(code)) ?? null : null;
}

/**
 * One query per page: what each of these files says about this country.
 *
 * Deliberately not one query per card. The storefront is a grid, and the third
 * query per file is how a front page becomes a hundred round trips.
 */
async function withCountry(assets, country) {
  const rules = await store.countryRulesFor(assets.map((a) => a.id), country);
  const byAsset = new Map(rules.map((r) => [r.asset_id, r]));
  return assets.map((a) => {
    const countryRule = byAsset.get(a.id) ?? null;
    const resolved = resolveCountry({ assetRule: countryRule });
    return {
      ...a,
      countryRule,
      resolved,
      availability: availabilityFor({ assetState: a.moderation_state, resolved }),
    };
  });
}

/**
 * The country check, at the point the bytes leave.
 *
 * The page, the unlock call and the two file routes all consult this one
 * function, because a rule enforced only where the button is drawn is not
 * enforced at all: a player keeps its source URL, a download link is a
 * credential, and a token minted in one country travels. The honest claim is the
 * one this code can make — the check runs where the file is read, every time.
 *
 * @returns {Promise<null|{status: number, country: string|null, availability: object, sentence: object}>}
 */
async function countryRefusalFor(asset, country) {
  const channelBlock = await store.channelCountryBlock(asset.channel_id, country);
  const assetRule = country ? (await store.countryRulesFor([asset.id], country))[0] ?? null : null;
  const resolved = resolveCountry({ assetRule, channelBlock });
  const availability = availabilityFor({ assetState: asset.moderation_state, resolved });
  if (availability.visible && availability.unlockable) return null;

  if (availability.reason === 'file') {
    return {
      status: 403,
      country,
      availability,
      sentence: {
        headline: 'Listed, but not unlockable',
        why: assetBehaviour(asset.moderation_state).visitorNote
          || 'This file cannot be unlocked.',
      },
    };
  }
  const rules = await store.policyRules();
  return {
    status: blockStatus(resolved) ?? 451,
    country,
    availability,
    sentence: blockSentence({
      resolved, rule: ruleFor(rules, resolved.ruleCode), store: 'This store', country,
    }),
  };
}

/**
 * Stores this visitor may be shown, with any store-wide country block applied.
 *
 * A store blocked for one country is not in Explore for that country and nowhere
 * else: the decision is about the visitor's country, not about the store.
 */
async function storesVisibleTo(channels, country) {
  if (!country || !channels.length) return channels;
  const blocked = new Set(
    (await store.channelCountryBlocks(channels.map((c) => c.id), country)).map((b) => b.subject_id),
  );
  return channels.filter((c) => !blocked.has(c.id));
}

APP.get('/marketplace', async (req, res, next) => {
  try {
    const q = String(req.query.q || '').slice(0, 80);
    // Only search when there is something to search for. The directory itself
    // stays the default answer, because a search box that starts empty and
    // returns nothing looks broken.
    const results = q.trim().length >= 2 ? await store.search(q) : null;
    const channels = await storesVisibleTo(
      await decorateChannels(await store.channels({ listedOnly: true })), viewerCountry(req),
    );
    const explore = results ? null : await exploreState(channels);
    // One query for every card on the page, then attached where the view can read
    // it: the badge renderer takes a row, not an id, so nothing here can forget
    // to ask and silently show no badge.
    const verified = await store.verificationsForChannels(channels.map((c) => c.id));
    for (const c of channels) c.verification = verified.get(c.id) || null;
    res.send(views.marketplace({
      channels, user: req.user, consent: req.consent, q, results, explore,
    }));
  } catch (err) { next(err); }
});

/**
 * The open request with the two derived facts the page needs about a held document.
 *
 * `opens` is a count of the audit lines the operator's viewer writes, so the number
 * the seller is shown cannot be incremented by anything except a person actually
 * opening their document. `sweep` destroys holds that have passed their week; it is
 * passed by the two pages that can show a document and not by the routes that only
 * need the row, so a sweep never runs as a side effect of an unrelated page.
 */
async function heldRequest(channelId, { sweep = false } = {}) {
  if (sweep) await store.sweepVerificationDocuments();
  const open = await store.pendingVerificationFor(channelId);
  if (!open) return null;
  return { ...open, opens: await store.documentOpens(open.id) };
}

// ---------------------------------------------------------------------------
// The library: what this person holds, and the stores they follow
// ---------------------------------------------------------------------------
//  The page is small. The rules behind it are the part worth reading, and there
//  are four:
//
//    * a follow is for OTHER people's stores. Following your own shop is a
//      bookmark to a page you can already reach, so the route refuses it and the
//      control is never rendered in the first place;
//    * following is idempotent and unfollowing is a delete, both answered with a
//      redirect, so a double-click or a back button cannot leave a half state;
//    * opening a store page (or a file in it) is what moves the "what is new"
//      line, and only for somebody who already follows it — there is no row to
//      update for anybody else;
//    * nothing here sends a message. The page says so twice, because the word
//      "follow" is read as a promise to tell you about new files and this product
//      has no way to reach a buyer yet.
// ---------------------------------------------------------------------------

/**
 * Following is a write, offered on a page a script can post to in a loop.
 */
const limitWatch = rateLimit({
  windowMs: 60_000, max: 60, name: 'follows',
  render: (info) => views.tooMany({ ...info, consent: null }),
});

/**
 * The one implementation behind all four routes.
 *
 * `back` is where the person was standing, and it changes what the answer says:
 * on the store page the button itself is the feedback (it flips to "Following"),
 * so the redirect goes back to the store; on the library the row disappears, so
 * the redirect carries the slug and the page says what happened — with the way
 * back, because removing something is exactly the kind of action that deserves
 * an undo rather than a confirmation dialog.
 */
async function followRoute(req, res, { follow, back }) {
  const channel = await store.channelBySlug(req.params.slug);
  if (!channel) return res.redirect('/library?error=no-store');
  const onStore = back === 'store';
  const home = onStore ? `/s/${channel.slug}` : '/library';
  // Your own store is not something you keep on your own shelf.
  if (req.user.id === channel.owner_id) return res.redirect(home);
  if (follow) await store.followChannel(req.user.id, channel.id);
  else await store.unfollowChannel(req.user.id, channel.id);
  if (onStore) return res.redirect(home);
  return res.redirect(follow ? home : `${home}?unwatched=${encodeURIComponent(channel.slug)}`);
}

APP.get('/library', async (req, res, next) => {
  try {
    if (!req.user) return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
    // A slug-shaped string or nothing: the one query parameter this page needs,
    // and the only one it will echo. It is a store the person just removed.
    const unwatched = /^[a-z0-9][a-z0-9-]{0,60}$/i.test(String(req.query.unwatched || ''))
      ? String(req.query.unwatched)
      : null;
    res.send(views.library({
      user: req.user, consent: req.consent,
      // Their own store, if they have one: the nav keeps the Dashboard link, so the
      // library is not a dead end for a seller.
      channel: (await store.channelsOf(req.user.id))[0] || null,
      unlocks: await store.myUnlocks(req.user.id, { limit: 100 }),
      counts: await store.unlockCounts(req.user.id),
      shelf: await store.followedChannels(req.user.id),
      unwatched,
      error: req.query.error === 'no-store' ? 'no-store' : null,
    }));
  } catch (err) { next(err); }
});

APP.post('/library/follow/:slug', limitWatch, async (req, res, next) => {
  try {
    if (!req.user) return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
    await followRoute(req, res, { follow: true, back: 'library' });
  } catch (err) { next(err); }
});

APP.post('/library/unfollow/:slug', limitWatch, async (req, res, next) => {
  try {
    if (!req.user) return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
    await followRoute(req, res, { follow: false, back: 'library' });
  } catch (err) { next(err); }
});

APP.post('/s/:slug/watch', limitWatch, async (req, res, next) => {
  try {
    if (!req.user) return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
    await followRoute(req, res, { follow: true, back: 'store' });
  } catch (err) { next(err); }
});

APP.post('/s/:slug/unfollow', limitWatch, async (req, res, next) => {
  try {
    if (!req.user) return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
    await followRoute(req, res, { follow: false, back: 'store' });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Memberships — belonging to a store, and paying the creator for it
// ---------------------------------------------------------------------------
// Four seller routes and three buyer routes. The shape of every one of them
// comes from a single fact: this platform never touches the dues. It cannot
// check them, cannot confirm them, cannot hold or refund them. So the seller's
// side is a QUEUE A HUMAN CLEARS against their own statement, and the buyer's
// side is a CLAIM plus a wait — and the pages say exactly that rather than
// dressing a manual rail up as an instant purchase.

/**
 * The join panel, as one redirect helper.
 *
 * `back` is the storefront by default: the panel is there, and the answer ("you
 * are in, waiting for the creator") belongs where the person can see their own
 * state. Since §33 there is a second page with the same doors on it — the member
 * room — and somebody who joined from there is sent back INTO the room rather than
 * out of it, because being bounced to the shopfront after pressing a button inside
 * the room is how a page with two doors starts feeling like two products. The
 * fragment follows the same rule: `#members` exists on the storefront and nowhere
 * else.
 */
function memberBack(channel, extra = '', req = null) {
  const storefront = `/s/${encodeURIComponent(channel.slug)}`;
  const room = `${storefront}/members`;
  if (extra && req?.get?.('referer')?.includes(room)) return `${room}${extra.replace('#members', '')}`;
  return `${storefront}${extra}`;
}

APP.post('/s/:slug/join', limitWatch, async (req, res, next) => {
  try {
    const channel = await store.channelBySlug(req.params.slug);
    if (!channel) return res.status(404).send(views.notFound({ user: req.user, requestedKind: 'store' }));
    if (!req.user) return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);

    // Two refusals before anything is written, and both are sentences a person
    // is owed: you cannot join your own store (the dues would be a loop), and
    // you cannot join a store whose plan does not include members.
    if (channel.owner_id === req.user.id) return res.redirect(memberBack(channel, '?error=member-own', req));
    const plan = store.plan(channel);
    if (plan.capabilities?.memberships !== true) return res.redirect(memberBack(channel, '?error=member-plan', req));

    const tiers = await store.membershipTiers(channel.id);
    const wanted = Number(req.body?.tier) || 1;
    const tier = tiers.find((t) => Number(t.tier_no) === wanted) ?? tiers[0] ?? null;
    if (!tier) return res.redirect(memberBack(channel, '?error=member-no-tier', req));
    // A tier sold only as "join by watching" has no dues door. Refused with the
    // reason, because the person is standing on a panel that offers the other door.
    if (!doorsOf(tier).dues) return res.redirect(memberBack(channel, '?error=member-watching-only', req));

    // A reference is the only thing that can be matched against a statement. The
    // form asks for it at the door rather than two screens later, because a
    // claim without one sits in the creator's queue until they give up on it.
    const method = CLAIM_METHODS.includes(String(req.body?.method)) ? String(req.body.method) : 'other';
    const reference = String(req.body?.reference || '').trim();
    if (reference.length < 4) return res.redirect(memberBack(channel, '?error=member-reference', req));

    const row = await store.joinMembership({
      profileId: req.user.id,
      channelId: channel.id,
      tierNo: tier.tier_no,
      // The tier travels with the claim: it is what decides the ad arrangement the
      // claim is made under, and that promise is written when the claim is, not
      // whenever the creator gets round to looking at their statement.
      tier,
      claim: {
        amountNpr: Number(req.body?.amount) || null,
        method,
        txnReference: reference,
        payerName: String(req.body?.payerName || '').trim().slice(0, 120) || req.user.display_name,
        payerNumber: String(req.body?.payerNumber || '').trim().slice(0, 40) || null,
      },
    });
    if (!row) return res.redirect(memberBack(channel, '?error=member-active', req));
    await store.audit('member.claimed', {
      channelId: channel.id, tierNo: tier.tier_no, amountNpr: row.amount_npr,
      txnReference: row.txn_reference, method: row.method,
    }, { actorId: req.user.id, subjectType: 'channel', subjectId: channel.id });
    return res.redirect(memberBack(channel, '?joined=1#members', req));
  } catch (err) { return next(err); }
});

/**
 * The attention door: join the tier by watching.
 *
 * Deliberately a different route from `/join`, and deliberately not a variant of
 * it with a flag. The two doors write different things — one a claim a human will
 * read, the other a membership the platform has already verified — and the route
 * is where that difference is visible. Nothing here asks for a reference, an
 * amount or a method, because there is no money in this path for any of the three
 * to describe; a form that asked would be teaching people that it is a payment.
 *
 * Refusals are sentences rather than errors: not enough views says how many are
 * needed, a closed door says which door this store does sell, and a claim already
 * waiting is left alone rather than raced.
 */
APP.post('/s/:slug/join/watching', limitWatch, async (req, res, next) => {
  try {
    const channel = await store.channelBySlug(req.params.slug);
    if (!channel) return res.status(404).send(views.notFound({ user: req.user, requestedKind: 'store' }));
    if (!req.user) return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
    if (channel.owner_id === req.user.id) return res.redirect(memberBack(channel, '?error=member-own', req));
    const plan = store.plan(channel);
    if (plan.capabilities?.memberships !== true) return res.redirect(memberBack(channel, '?error=member-plan', req));

    const tiers = await store.membershipTiers(channel.id);
    const wanted = Number(req.body?.tier) || 1;
    const tier = tiers.find((t) => Number(t.tier_no) === wanted) ?? tiers[0] ?? null;
    if (!tier) return res.redirect(memberBack(channel, '?error=member-no-tier', req));

    const result = await store.joinByAttention({
      profileId: req.user.id, channelId: channel.id, tierNo: tier.tier_no, tier,
      actorId: req.user.id,
    });
    if (!result.ok) return res.redirect(memberBack(channel, `?error=member-${result.reason}#members`, req));
    // An extension (a member buying the NEXT period with views) gets its own
    // sentence. "You are in" would be telling somebody who is already in something
    // they cannot see the point of.
    return res.redirect(memberBack(channel,
      `?joined=${result.extended ? 'watching-more' : 'watching'}#members`, req));
  } catch (err) { return next(err); }
});

/**
 * The member room: one page behind the door, and nothing else.
 *
 * The researched shape rather than an invented one — Patreon's member feed, a
 * Discord server's members channel, Twitch's subscriber-only chat: the belonging
 * has to have a PLACE, or the tier is a badge on a list. It carries what the
 * storefront already shows (the roster, the store's note) plus the two things a
 * member needs in one place: every file their tier opens, and how long they hold
 * it for.
 *
 * A non-member gets the same page with the files listed locked and the way in
 * underneath. That is the shop window, and it is the same decision the storefront
 * already made: what a membership is stays visible to everyone, because hiding it
 * until somebody joins is how a tier sells nothing.
 */
APP.get('/s/:slug/members', limitWatch, async (req, res, next) => {
  try {
    const channel = await store.channelBySlug(req.params.slug);
    if (!channel) return res.status(404).send(views.notFound({ user: req.user, requestedKind: 'store' }));
    const plan = store.plan(channel);
    const tiers = await store.membershipTiers(channel.id);
    if (plan.capabilities?.memberships !== true || !tiers.length) {
      return res.redirect(memberBack(channel));
    }
    const membership = req.user ? await store.membershipFor(req.user.id, channel.id) : null;
    const standing = req.user ? await store.standingFor(req.user.id, channel.id) : 0;
    /*
     * The same two decisions the storefront makes, for the same reason. The PUBLIC
     * list, because `assetsForOwner` includes paused files — it must, since that is
     * how a seller finds their way back to one — and a room that listed a paused
     * file would be showing a visitor a door with nothing behind it. And the file's
     * own state plus any country rule, applied before anything is rendered, so a
     * file withheld where this visitor is standing is not promised to them by the
     * one page whose whole job is to be accurate about what opens.
     */
    const listed = (await withCountry(await store.assetsOf(channel.id), viewerCountry(req)))
      .filter((a) => a.availability.visible);
    res.send(views.memberRoom({
      channel, user: req.user, consent: req.consent, tiers, membership, standing,
      assets: listed,
      roster: await store.publicRoster(channel.id, { limit: 24 }),
      flash: flashFor(req.query),
      membershipsOn: true,
      // The member room prints the same paragraph about where the ads are, so it needs
      // the same entitlement the storefront and the slot allocator read.
      platformPositionReleased: store.plan(channel).capabilities?.ad_free === true,
    }));
  } catch (err) { return next(err); }
});

APP.post('/s/:slug/leave', limitWatch, async (req, res, next) => {
  try {
    const channel = await store.channelBySlug(req.params.slug);
    if (!channel) return res.status(404).send(views.notFound({ user: req.user, requestedKind: 'store' }));
    if (!req.user) return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
    const left = await store.leaveMembership(req.user.id, channel.id);
    return res.redirect(memberBack(channel, left ? '?left=1#members' : '?error=member-none', req));
  } catch (err) { return next(err); }
});

/**
 * Whether a member is named on a storefront is the member's own call. The store cannot
 * put somebody on the list and cannot take them off it, and nothing about the person's
 * own look rides on it — a store has no say in that either.
 */
APP.post('/s/:slug/members/listing', limitWatch, async (req, res, next) => {
  try {
    const channel = await store.channelBySlug(req.params.slug);
    if (!channel) return res.status(404).send(views.notFound({ user: req.user, requestedKind: 'store' }));
    if (!req.user) return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
    const listed = await store.setMemberListed({
      profileId: req.user.id, channelId: channel.id, listed: req.body?.listed === 'yes',
    });
    return res.redirect(memberBack(channel, listed ? '?listed=1#members' : '?error=member-none', req));
  } catch (err) { return next(err); }
});

// ── the seller's side ──────────────────────────────────────────────────────

APP.get('/dashboard/:slug/members', async (req, res, next) => {
  try {
    const channel = await ownerChannel(req, res);
    if (!channel) return undefined;
    const plan = store.plan(channel);
    res.send(views.channelMembers({
      channel, user: req.user, consent: req.consent, flash: flashFor(req.query),
      tiers: await store.membershipTiers(channel.id),
      members: await store.membersOfChannel(channel.id),
      pending: await store.pendingMemberships(channel.id),
      // What each tier actually opens, for the editor on this page: the seller's own
      // list, paused files included, so the answer matches what they see elsewhere.
      files: await store.assetsForOwner(channel.id),
      membershipsOn: plan.capabilities?.memberships === true,
      plan,
    }));
  } catch (err) { return next(err); }
});

/**
 * Save a tier.
 *
 * The capability is refused HERE as well as on the page, because a Free store
 * that posts this form is either a stale tab or somebody poking at the API, and
 * both deserve a sentence rather than a row in a table it cannot use.
 */
APP.post('/dashboard/:slug/members/tier/:tierNo', async (req, res, next) => {
  try {
    const channel = await ownerChannel(req, res);
    if (!channel) return undefined;
    if (refuseWrite(req, res, channel)) return undefined;
    const back = `/dashboard/${encodeURIComponent(channel.slug)}/members`;
    if (store.plan(channel).capabilities?.memberships !== true) return res.redirect(`${back}?error=member-plan`);
    const tierNo = Number(req.params.tierNo);
    if (![1, 2].includes(tierNo)) return res.redirect(`${back}?error=tier-missing`);

    const draft = tierDraft(req.body);
    if (!draft.ok) return res.redirect(`${back}?error=${draft.error}`);
    await store.saveMembershipTier({ channelId: channel.id, tierNo, value: draft.value, actorId: req.user.id });
    return res.redirect(`${back}?tier-saved=${tierNo}`);
  } catch (err) { return next(err); }
});

APP.post('/dashboard/:slug/members/tier/:tierNo/remove', async (req, res, next) => {
  try {
    const channel = await ownerChannel(req, res);
    if (!channel) return undefined;
    if (refuseWrite(req, res, channel)) return undefined;
    const back = `/dashboard/${encodeURIComponent(channel.slug)}/members`;
    const result = await store.deleteMembershipTier({
      channelId: channel.id, tierNo: Number(req.params.tierNo), actorId: req.user.id,
    });
    return res.redirect(`${back}?${result.ok ? 'tier-removed=1' : `error=${result.reason}`}`);
  } catch (err) { return next(err); }
});

APP.post('/dashboard/:slug/members/note', async (req, res, next) => {
  try {
    const channel = await ownerChannel(req, res);
    if (!channel) return undefined;
    if (refuseWrite(req, res, channel)) return undefined;
    const back = `/dashboard/${encodeURIComponent(channel.slug)}/members`;
    if (store.plan(channel).capabilities?.memberships !== true) return res.redirect(`${back}?error=member-plan`);
    await store.setMembershipNote({
      channelId: channel.id, note: paymentNoteDraft(req.body?.note), actorId: req.user.id,
    });
    return res.redirect(`${back}?note-saved=1`);
  } catch (err) { return next(err); }
});

/**
 * The creator says the money arrived.
 *
 * `ownerChannel` has already established that this person owns the store, and
 * `confirmMembership` checks the same thing again in SQL — an operator cannot
 * reach this state by any route, which is the whole design: the platform never
 * sees these dues, so nobody here can honestly confirm one.
 */
APP.post('/dashboard/:slug/members/:profileId/confirm', async (req, res, next) => {
  try {
    const channel = await ownerChannel(req, res);
    if (!channel) return undefined;
    if (refuseWrite(req, res, channel)) return undefined;
    const back = `/dashboard/${encodeURIComponent(channel.slug)}/members`;
    // An operator can open this page (they are trusted with moderation) and
    // cannot clear this queue. That is not a permission the console is missing:
    // the money never reached the platform, so there is nothing here for an
    // operator to check it against.
    if (channel.owner_id !== req.user.id) return res.redirect(`${back}?error=member-owner-only`);
    const row = await store.confirmMembership({
      profileId: req.params.profileId, channelId: channel.id,
      ownerId: req.user.id, actorId: req.user.id,
    });
    return res.redirect(`${back}?${row ? 'member-confirmed=1' : 'error=member-missing'}`);
  } catch (err) { return next(err); }
});

APP.post('/dashboard/:slug/members/:profileId/reject', async (req, res, next) => {
  try {
    const channel = await ownerChannel(req, res);
    if (!channel) return undefined;
    if (refuseWrite(req, res, channel)) return undefined;
    const back = `/dashboard/${encodeURIComponent(channel.slug)}/members`;
    if (channel.owner_id !== req.user.id) return res.redirect(`${back}?error=member-owner-only`);
    const row = await store.rejectMembership({
      profileId: req.params.profileId, channelId: channel.id, ownerId: req.user.id,
      reason: req.body?.reason, actorId: req.user.id,
    });
    return res.redirect(`${back}?${row ? 'member-rejected=1' : 'error=member-missing'}`);
  } catch (err) { return next(err); }
});

/**
 * Choose the storefront's look.
 *
 * Its own route rather than a field on the settings form, because it is its own
 * decision with its own capability: the settings form saves together, and a theme
 * is gated on a plan where the rest of the form is not. Saving them together would
 * mean a seller changing their tagline and losing their theme to one refusal.
 */
APP.post('/dashboard/:slug/theme', async (req, res, next) => {
  try {
    const channel = await ownerChannel(req, res);
    if (!channel) return undefined;
    if (refuseWrite(req, res, channel)) return undefined;
    // The query goes THROUGH the anchor, never after it: `#theme?error=x` is a
    // fragment called "theme?error=x", which the browser never sends and the server
    // never parses, so the seller would land on an unchanged page with no
    // explanation. Same shape as the verification routes.
    const back = (qs = '') => `/dashboard/${encodeURIComponent(channel.slug)}/settings${qs ? `?${qs}` : ''}#theme`;
    const plan = store.plan(channel);
    if (!canTheme(plan.capabilities)) return res.redirect(back('error=theme-plan'));
    // `plain` means "back to the default look", which is the absence of a theme
    // rather than a seventh palette — and it is offered to a paying store because
    // the way back has to be as available as the way in.
    const plain = req.body?.theme === NO_THEME;
    const draft = themeDraft(plain ? '' : req.body?.theme);
    if (!plain && !draft.ok) return res.redirect(back(`error=${draft.error}`));
    const result = await store.setChannelTheme({
      channel, capabilities: plan.capabilities,
      theme: req.body?.theme === NO_THEME ? null : draft.value,
      actorId: req.user.id,
    });
    return res.redirect(back(result.ok ? `theme-saved=${plain ? NO_THEME : draft.value}` : `error=${result.reason}`));
  } catch (err) { return next(err); }
});

// ---------------------------------------------------------------------------
// Getting back into an account
// ---------------------------------------------------------------------------
// Four routes, and the shape of two of them is the security property: the POST
// answers identically whether or not the address has an account, and the GET on a
// dead link renders one page for four different reasons. See src/recovery.js.

// A reset request sends mail to an address somebody else typed in, so it is rate
// limited like sign-in: without a limit it is a way to have the platform send
// unwanted messages from its own domain, which is how a sending reputation dies.
const limitForgot = rateLimit({
  windowMs: 60 * 60_000, max: 8, name: 'password reset requests',
  render: (info) => views.tooMany({ ...info, consent: null }),
});

// ---------------------------------------------------------------------------
// ByteBikri Plus — the person's own premium, and the only thing sold to a person
// ---------------------------------------------------------------------------
//
// Four routes, none of them able to grant anything. `POST /plus/join` writes a
// CLAIM; only `POST /admin/payments/plus/:id`, driven by an operator who has the
// platform's statement in front of them, starts a period. That split is the same
// one the store plans use, and it exists for the same reason: on a manual rail,
// the person who receives the money is the only one who can honestly confirm it.

/**
 * The periods a person may buy, in the order they are offered.
 *
 * `plus-year` (0042) is the same plan with a twelve-month period at ten months' price.
 * The list is here so the routes can check a submitted code against the product rather
 * than against a string they typed, and so adding a third period is one line in one
 * place. `PLUS_CODE` is imported rather than restated, because the module that owns the
 * plan's name also owns its key.
 */
const PURCHASABLE_PLANS = PURCHASABLE_PLAN_CODES;

/** One place that decides what the page should say the arrangement IS. */
async function plusContext(req) {
  // `req.user` already carries the arrangement (the session join in src/auth.js), but
  // this is the page that acts on it, so it re-reads the row rather than trusting a
  // value that arrived with the request — the same reason a route re-checks a plan
  // instead of believing the page that sent the form.
  const me = req.user ? await store.userById(req.user.id) : null;
  const subscription = me ? await store.customerSubscription(me.id) : null;
  const plan = await store.customerPlan(PLUS_CODE);
  // Both periods, read from the plan table rather than typed on the page: a year is
  // the same plan with a twelve-month period, so the second price cannot drift from
  // the first one and the discount is a derived number (`plusYearPrice`).
  const yearPlan = await store.customerPlan(PLUS_YEAR_CODE);
  return {
    plan,
    yearPlan,
    subscription,
    state: plusState({ status: subscription?.status, period_end: subscription?.period_end }),
    look: {
      nameplate: me?.nameplate ?? null, effect: me?.plus_effect ?? null,
      // The two outer layers, read from the row the same way the paint is: the form
      // shows what is actually stored, and an unknown value reads as "not chosen".
      ring: me?.plus_ring ?? null, frame: me?.plus_frame ?? null,
    },
    wear: plusWear(me),
    // What this person has bought for other people. Read here rather than on the view
    // so the page a buyer reloads is the page the database says.
    gifts: me ? await store.giftsGivenBy(me.id) : [],
    rails: railDetails(),
    railsReady: railsReady(),
  };
}

APP.get('/plus', async (req, res, next) => {
  try {
    res.send(views.plusPage({
      user: req.user, consent: req.consent, flash: flashFor(req.query), current: 'plus',
      ...(await plusContext(req)),
    }));
  } catch (err) { next(err); }
});

APP.post('/plus/join', limitUnlock, async (req, res, next) => {
  try {
    if (!req.user) return res.redirect('/login?next=%2Fplus');
    // Money in is the one thing an unconfirmed address holds back, and it is held
    // back here as well as in the view: the page can be stale, this is the boundary.
    // Same rule as a store plan payment, for the same reason — a claim bytebikri
    // cannot put a name or a receipt to is a claim it cannot verify against its own
    // statement. Nothing about the look changes if this is hit; nothing was sent.
    if (!req.user.email_verified_at) return res.redirect('/plus?error=plus-verify');
    // Which period the person chose, checked against the plan table rather than
    // trusted from the form — the same allowlist discipline the look's palette uses.
    // An unknown code falls back to the monthly plan, which is the product's default.
    const wanted = await store.customerPlan(String(req.body.plan || ''));
    const chosen = wanted && wanted.active ? wanted : await store.customerPlan(PURCHASABLE_PLANS[0]);
    const result = await store.claimPlus({
      profileId: req.user.id,
      planCode: chosen?.code || PLUS_CODE,
      amountNpr: chosen?.price_npr ?? 0,
      txnReference: req.body.txnReference,
      method: PAY_METHODS.includes(req.body.method) ? req.body.method : 'other',
      payerName: req.body.payerName,
    });
    if (!result.ok) {
      const code = { reference: 'plus-reference', 'duplicate-reference': 'plus-duplicate' }[result.code] || 'plus-reference';
      return res.redirect(`/plus?error=${code}`);
    }
    await store.audit('plus.claimed', { profileId: req.user.id, paymentId: result.payment.id });
    return res.redirect('/plus?saved=plus-claimed');
  } catch (err) { return next(err); }
});

/**
 * Buying a period for somebody else.
 *
 * Same rail, same rules as `/plus/join` — a reference, an operator, a statement — and
 * deliberately the same wording, because a person buying a gift is doing the same
 * thing with a different destination. What comes back is a CODE, printed on the page
 * with its state attached: it is minted here rather than at match time so the buyer
 * can tell their friend what to type, and it says "waiting on the transfer" until an
 * operator has found the money.
 */
APP.post('/plus/gift', limitUnlock, async (req, res, next) => {
  try {
    if (!req.user) return res.redirect('/login?next=%2Fplus');
    if (!req.user.email_verified_at) return res.redirect('/plus?error=plus-verify');
    const wanted = await store.customerPlan(String(req.body.plan || ''));
    const chosen = wanted && wanted.active ? wanted : await store.customerPlan(PURCHASABLE_PLANS[0]);
    const result = await store.claimPlusGift({
      profileId: req.user.id,
      planCode: chosen?.code || PLUS_CODE,
      amountNpr: chosen?.price_npr ?? 0,
      txnReference: req.body.txnReference,
      method: PAY_METHODS.includes(req.body.method) ? req.body.method : 'other',
      payerName: req.body.payerName,
      note: req.body.note,
    });
    if (!result.ok) {
      const code = { reference: 'gift-reference', 'duplicate-reference': 'gift-duplicate' }[result.code] || 'gift-reference';
      return res.redirect(`/plus?error=${code}#gift`);
    }
    await store.audit('plus.gift_claimed', {
      profileId: req.user.id, giftId: result.gift.id, code: result.gift.code, planCode: result.gift.plan_code,
    });
    return res.redirect(`/plus?saved=gift-claimed#gift`);
  } catch (err) { return next(err); }
});

/**
 * Using a code.
 *
 * Nothing is asked of the recipient except that they are signed in: a code is the
 * claim, and demanding that somebody finish our paperwork before they may accept a
 * present would be a rule with no purpose. Every refusal is a named sentence, because
 * the person reading it is not the person who paid and "it did not work" sends them
 * back to their friend with a complaint instead of an answer.
 */
APP.post('/plus/gift/redeem', limitUnlock, async (req, res, next) => {
  try {
    if (!req.user) return res.redirect('/login?next=%2Fplus');
    const code = normalizeGiftCode(req.body.code);
    if (!code) return res.redirect('/plus?error=gift-unknown#gift');
    const result = await store.redeemPlusGift({ code, profileId: req.user.id });
    if (!result.ok) return res.redirect(`/plus?error=${result.code}#gift`);
    await store.audit('plus.gift_redeemed', {
      profileId: req.user.id, giftId: result.gift.id, months: result.months, buyerId: result.gift.buyer_id,
    });
    return res.redirect('/plus?saved=gift-redeemed#gift');
  } catch (err) { return next(err); }
});

APP.post('/plus/look', limitUnlock, async (req, res, next) => {
  try {
    if (!req.user) return res.redirect('/login?next=%2Fplus');
    // An allowlist, not a free-text colour. Every palette here is contrast-checked
    // against both themes, and a member typing #ff00ff is how a readable product
    // becomes an unreadable one.
    //
    // The allowlist is the CATALOG's, not a second list typed here: every slot a person
    // wears must be answered with one of that slot's own values, so adding a slot in
    // `cosmetics.js` cannot leave this route accepting a form that no longer matches the
    // picker. A field that is not a person slot is not read at all.
    const look = {};
    for (const slot of personSlots()) {
      const value = String(req.body?.[slot.key] ?? '');
      if (!slot.values.some((v) => v.key === value)) return res.redirect('/plus?error=plus-look-bad');
      look[slot.key] = value;
    }
    await store.setPlusLook({ profileId: req.user.id, ...look });
    await store.audit('plus.look_set', { profileId: req.user.id, ...look });
    return res.redirect('/plus?saved=plus-look');
  } catch (err) { return next(err); }
});

APP.post('/plus/cancel', limitUnlock, async (req, res, next) => {
  try {
    if (!req.user) return res.redirect('/login?next=%2Fplus');
    const stopped = await store.cancelPlus(req.user.id);
    if (!stopped) return res.redirect('/plus?error=plus-none');
    await store.audit('plus.stopped', { profileId: req.user.id });
    return res.redirect('/plus?saved=plus-stopped');
  } catch (err) { return next(err); }
});

APP.post('/admin/payments/plus/:id', async (req, res, next) => {
  try {
    if (!req.user || req.user.role !== 'admin') return res.status(404).send('Not found');
    if (req.body.action === 'reject') {
      await store.rejectCustomerPlanPayment({
        paymentId: req.params.id, actorId: req.user.id,
        reason: String(req.body.reason || '').trim().slice(0, 300),
      });
      await store.audit('plus.payment_rejected', { paymentId: req.params.id });
    } else {
      const matched = await store.matchCustomerPlanPayment({ paymentId: req.params.id, actorId: req.user.id });
      await store.audit('plus.payment_matched', { paymentId: req.params.id, ok: Boolean(matched) });
    }
    return res.redirect('/admin/payments');
  } catch (err) { return next(err); }
});

APP.get('/forgot', (req, res) => {
  res.send(views.forgotPassword({ user: req.user, consent: req.consent }));
});

APP.post('/forgot', limitForgot, async (req, res, next) => {
  try {
    const email = String(req.body.email || '').trim().slice(0, 200);
    await recovery.requestReset({
      email,
      ip: req.ip,
      userAgent: req.get('user-agent'),
      baseUrl: publicBase(req),
    });
    // Deliberately NOT branching on the result. The page renders the same for a
    // registered address, an unregistered one, and a typo. The only visible
    // difference is whether a message arrives, which is the point.
    res.send(views.forgotPassword({ user: req.user, consent: req.consent, sent: true, email }));
  } catch (err) { next(err); }
});

APP.get('/reset/:token', async (req, res, next) => {
  try {
    const check = await recovery.inspectReset(req.params.token);
    if (!check.valid) {
      // Nothing about WHY is passed on: one page, one sentence, one action.
      //
      // And no consent banner — the view never renders one on a token route,
      // because the banner posts the current URL back to itself as `next`, which
      // would write a one-time credential into the page's markup. See the note
      // above views.resetPassword.
      return res.status(410).send(views.resetPassword({ user: req.user }));
    }
    // A valid link is not a session. The page renders signed-out on purpose: the
    // token authorises one action, not a visit to somebody's dashboard.
    res.send(views.resetPassword({ user: null, token: req.params.token }));
  } catch (err) { next(err); }
});

APP.post('/reset/:token', async (req, res, next) => {
  try {
    const password = String(req.body.password || '');
    const again = String(req.body.password2 || '');
    if (password !== again) {
      return res.send(views.resetPassword({
        user: null, token: req.params.token,
        error: 'Those two do not match. Nothing was changed — type it once more.',
      }));
    }
    const done = await recovery.consumeReset({ token: req.params.token, password });
    if (!done.ok) {
      // Short password keeps the form with a reason; anything else is a dead link
      // and gets the same page as any other dead link.
      if (done.reason === 'short') {
        return res.send(views.resetPassword({
          user: null, token: req.params.token,
          error: `A password needs at least ${recovery.MIN_PASSWORD_LENGTH} characters. Length beats symbols.`,
        }));
      }
      return res.status(410).send(views.resetPassword({}));
    }

    // Signed straight in: the person just proved control of the address and chose
    // the password, and bouncing them to a login form to retype it is theatre.
    await store.audit('auth.password_reset', { self: true }, { actorId: done.userId });
    const { token, ttl } = await auth.createSession({
      userId: done.userId,
      // Not remembered: a recovery is often done on a borrowed device, and the
      // safe reading of "the person is not sure whose computer this is" is a
      // session that ends when the browser does.
      remember: false,
      userAgent: req.get('user-agent'),
      ip: req.ip,
    });
    setSessionCookie(res, token, ttl);
    res.redirect('/?reset=1');
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Confirming an address
// ---------------------------------------------------------------------------
// A confirmation link is not a session and never creates one. The GET renders a
// button and the POST spends the token, because scanners fetch the URLs in a
// message — see the note above views.verifyConfirm.
//
// Sending is rate limited for the same reason reset requests are: the platform
// would otherwise mail any address on demand, and its own domain pays for that.

const limitVerify = rateLimit({
  windowMs: 60 * 60_000, max: 10, name: 'confirmation emails',
  render: (info) => views.tooMany({ ...info, consent: null }),
});

const minutesAgo = (n) => `${Math.max(1, Math.round(n))} minute${Math.round(n) === 1 ? '' : 's'}`;

APP.get('/verify', async (req, res, next) => {
  if (!req.user) return res.redirect('/login?next=%2Fverify');
  try {
    const state = await verify.addressState(req.user.id);
    const flash = req.query.sent === '1'
      ? `A new link is on its way to ${req.user.email}. It works once and lasts 48 hours.`
      : req.query.sent === 'wait'
        // Named, dated, and not a new email: sending one would retire the link
        // that may be arriving in the inbox right now, and that is a loop the
        // person cannot see the shape of.
        ? `The newest link is the one already out — sent ${minutesAgo(Number(req.query.age) || 1)} ago. Another would cancel it, so check the inbox and the spam folder first.`
        : null;
    res.send(views.verify({
      user: req.user, state, flash, changed: req.query.changed === '1',
      error: typeof req.query.error === 'string' ? req.query.error.slice(0, 40) : null,
      next: safeNext(req.query.next) || '/',
    }));
  } catch (err) { next(err); }
});

APP.post('/verify', limitVerify, async (req, res, next) => {
  if (!req.user) return res.redirect('/login?next=%2Fverify');
  try {
    const out = await verify.sendVerification({
      user: req.user, baseUrl: publicBase(req), ip: req.ip, userAgent: req.get('user-agent'),
    });
    if (!out.sent && out.reason === 'confirmed') return res.redirect('/verify');
    if (!out.sent) {
      const q = new URLSearchParams({ sent: 'wait', age: String(out.ageMinutes ?? 1) });
      return res.redirect(`/verify?${q}`);
    }
    res.redirect('/verify?sent=1');
  } catch (err) { next(err); }
});

// Declared before POST /verify/:token, or "address" would be read as a token.
APP.post('/verify/address', limitVerify, async (req, res, next) => {
  if (!req.user) return res.redirect('/login?next=%2Fverify');
  try {
    const out = await verify.changeAddress({
      userId: req.user.id, newEmail: req.body.email, baseUrl: publicBase(req),
      ip: req.ip, userAgent: req.get('user-agent'),
    });
    if (!out.ok) return res.redirect(`/verify?error=${encodeURIComponent(out.reason)}`);
    res.redirect('/verify?changed=1');
  } catch (err) { next(err); }
});

APP.get('/verify/:token', async (req, res, next) => {
  try {
    const check = await verify.inspectLink({ token: req.params.token });
    // One page for expired, used, replaced and invented links, and no banner:
    // the same reasoning as the dead reset link, one page over.
    if (!check.valid) return res.status(410).send(views.verifyResult({ user: req.user, outcome: 'dead' }));
    res.send(views.verifyConfirm({ user: req.user }));
  } catch (err) { next(err); }
});

APP.post('/verify/:token', async (req, res, next) => {
  try {
    const out = await verify.confirm({ token: req.params.token });
    if (!out.ok) return res.status(410).send(views.verifyResult({ user: req.user, outcome: 'dead' }));
    res.send(views.verifyResult({
      user: req.user, email: out.email, outcome: out.alreadyConfirmed ? 'already' : 'confirmed',
    }));
  } catch (err) { next(err); }
});

APP.get('/login', (req, res) => {
  if (req.user) return res.redirect(safeNext(req.query.next) || '/');
  res.send(views.login({
    user: null, consent: req.consent,
    next: safeNext(req.query.next) || '', email: req.query.email || '',
  }));
});

APP.get('/signup', (req, res) => {
  if (req.user) return res.redirect('/');
  res.send(views.login({
    user: null, consent: req.consent, mode: 'signup', next: safeNext(req.query.next) || '',
  }));
});

/**
 * Only ever redirect to a path on this site.
 *
 * `?next=https://evil.example` would otherwise turn our own login form into a
 * convincing phishing hop: the victim signs in on the real domain and lands
 * somewhere else, having just typed a password into a page they trust.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v) => UUID_RE.test(String(v || ''));

function safeNext(value) {
  if (typeof value !== 'string' || !value) return null;
  if (!value.startsWith('/') || value.startsWith('//')) return null;
  return value;
}

APP.post('/login', limitLogin, async (req, res, next) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const back = safeNext(req.body.next);
    const ipHash = auth.hashIp(req.ip);

    const reject = (message, status = 401) => {
      // Never say WHICH half was wrong. "No such account" tells an attacker
      // which addresses are registered, which is the first half of a breach.
      res.status(status).send(views.login({
        user: null, consent: req.consent, error: message, email, next: back || '',
      }));
    };

    if (!email || !password) return reject('Enter your email and password.', 400);

    // Lockout is checked before the password, and counted in the database so a
    // restart does not hand an attacker a fresh budget.
    const failures = await auth.recentFailures(email, ipHash);
    if (auth.isLockedOut(failures)) {
      await auth.recordAttempt(email, false, ipHash);
      return reject('Too many failed attempts. Try again in about fifteen minutes.', 429);
    }

    const user = await store.userByEmail(email);
    if (!user || !user.password_hash) {
      // Burn the same CPU as a real check. Returning here in 1ms is a
      // user-enumeration oracle: "unknown email" must not be measurably faster
      // than "wrong password".
      auth.burnPasswordTime();
      await auth.recordAttempt(email, false, ipHash);
      return reject('That email and password do not match an account.');
    }
    if (!auth.verifyPassword(password, user.password_hash)) {
      await auth.recordAttempt(email, false, ipHash);
      return reject('That email and password do not match an account.');
    }

    if (user.banned) {
      // Checked AFTER the password, so this is not an oracle for which addresses
      // exist: only somebody who already knows the password learns the account
      // is suspended, and that is the person who needs to know.
      await auth.recordAttempt(email, false, ipHash);
      return reject(
        'This account is suspended. Reply to the message you were sent, or write to the operator address in the footer, and a person will look at it.',
        403,
      );
    }

    await auth.recordAttempt(email, true, ipHash);
    const { token, ttl } = await auth.createSession({
      userId: user.id,
      // Explicitly opt-in: an absent field means a shared machine, which is the
      // safe reading. The form sends "on" when the box is ticked.
      remember: req.body.remember === 'on',
      userAgent: req.get('user-agent'),
      ip: req.ip,
    });
    setSessionCookie(res, token, ttl);
    // `actorId` is not decoration: a sign-in row with a null actor is a row no
    // page can attribute, and the whole point of the table is "who did what".
    // (For months this call put the id in `meta.userId`, which nothing joins on —
    // so the largest family in the log could not answer its own question.)
    await store.audit('auth.login', { userId: user.id },
      { actorId: user.id, subjectType: 'profile', subjectId: user.id });
    res.redirect(back || '/');
  } catch (err) { next(err); }
});

APP.post('/signup', limitSignup, async (req, res, next) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const displayName = String(req.body.display_name || '').trim();
    const channelName = String(req.body.channel || '').trim();

    const fail = (message, status = 400) =>
      res.status(status).send(views.login({
        user: null, consent: req.consent, mode: 'signup', error: message, email,
      }));

    try {
      var user = await auth.createAccount({ email, password, displayName });
    } catch (err) {
      if (err.status) return fail(err.message, err.status);
      if (err.code === '23505') return fail('An account with that email already exists.', 409);
      throw err;
    }

    if (channelName) {
      let slug = slugify(channelName) || 'store';
      let n = 1;
      while (await store.channelBySlug(slug)) slug = `${slugify(channelName)}-${++n}`;
      await store.createChannel({ ownerId: user.id, slug, name: channelName });
    }

    const { token, ttl } = await auth.createSession({
      userId: user.id, userAgent: req.get('user-agent'), ip: req.ip,
    });
    setSessionCookie(res, token, ttl);
    await store.audit('auth.signup', { userId: user.id },
      { actorId: user.id, subjectType: 'profile', subjectId: user.id });

    // A confirmation link, sent after the account exists and NOT awaited: with a
    // real provider the send is a network round trip, and making a person watch a
    // spinner for it — or fail a sign-up because a mail provider is slow — would
    // be paying for the wrong thing. It cannot fail the sign-up either way; the
    // account works unconfirmed, and the strip on every page says so until the
    // link is clicked.
    verify.sendVerification({
      user, baseUrl: publicBase(req), ip: req.ip, userAgent: req.get('user-agent'),
    }).catch((err) => console.error('[verify] signup mail failed:', err.message));

    res.redirect('/');
  } catch (err) { next(err); }
});

APP.post('/logout', async (req, res, next) => {
  try {
    await auth.revokeSession(req.cookies?.bb_session);
    clearSessionCookie(res);
    res.redirect('/');
  } catch (err) { next(err); }
});

/*
 * ── THE SERIES (§15) — three helpers, shared by four routes ────────────────
 *
 * A series is a grouping of a store's own files, so everything about it is a read of
 * rows that already existed plus one column pair on `assets`. These three functions keep
 * the storefront, the file page and the series page from each assembling their own
 * version of "which series is this, and what comes next".
 */

/**
 * Attach each file's series to it, in one read.
 *
 * The storefront draws one card per series and needs to know which files belong
 * together; the file page needs the same fact for its strip. `seriesForAssets` answers
 * for a whole page at once, so a storefront with forty files is one query rather than
 * forty — and neither page has to know that `assets.series_id` exists.
 */
async function withSeries(assets) {
  const rows = assets.length ? await store.seriesForAssets(assets.map((a) => a.id)) : [];
  if (!rows.length) return assets;
  const byAsset = new Map(rows.map((r) => [String(r.asset_id), r]));
  return assets.map((asset) => {
    const row = byAsset.get(String(asset.id));
    return row ? {
      ...asset,
      series: {
        id: row.series_id,
        slug: row.series_slug,
        title: row.series_title,
        blurb: row.series_blurb,
        mode: row.series_mode,
      },
    } : asset;
  });
}

/** Where this viewer is in these files, by asset id. The one reader of `watch_progress`. */
function positionsOf(user, assetIds) {
  return user ? store.watchProgressFor(user.id, assetIds) : Promise.resolve({});
}

/**
 * Every id this person can open right now: an unlock that is still good, plus the files
 * a current ad-free membership covers.
 *
 * ONE set with ONE meaning — "you can open this as you are" — because the storefront's
 * card, the episode strip and the file's own page all read it. Two flags combined in
 * three places is how a card ends up saying "locked" about the page it links to.
 */
async function openSetFor(user, assetIds, { channelId, membership = null, tiers = [] } = {}) {
  const ids = new Set(await store.openUnlockIds(user?.id, assetIds));
  if (channelId && tiers.length && membershipCurrent(membership) && adModeOf(membership) === 'ad_free') {
    for (const row of await store.memberOpenAssetIds(channelId, membership.tier_no)) ids.add(row.id);
  }
  return ids;
}

/**
 * The series an episode belongs to, as its own page's strip needs it.
 *
 * Which episodes are listed follows the file's own visibility rule rather than a second
 * one: a paused episode is not advertised to strangers, but it stays in the strip of
 * somebody who holds an unlock for it (hiding a file is a decision about the storefront,
 * not a way to take back what somebody already paid for with their attention), and the
 * owner and an operator always see the whole series.
 */
async function seriesForFile({ channel, asset, user, maySeeEverything, membership = null, tiers = [] }) {
  const series = await store.seriesById(asset.series_id, channel.id);
  if (!series) return null;
  const all = (await store.episodesForSeries([series.id])).filter((e) => e.status !== 'removed');
  const openIds = new Set(await store.openUnlockIds(user?.id, all.map((e) => e.id)));
  const episodes = all.filter((e) => String(e.id) === String(asset.id)
    || maySeeEverything
    || openIds.has(String(e.id))
    || (e.status === 'live' && isAssetPublic(e.moderation_state)));
  const ordered = episodeOrder(episodes, series.mode);
  return {
    series,
    episodes,
    positions: await positionsOf(user, ordered.map((e) => e.id)),
    previous: previousEpisode({ episodes: ordered, currentId: asset.id, mode: series.mode }),
    next: nextEpisode({ episodes: ordered, currentId: asset.id, mode: series.mode }),
  };
}

APP.get('/s/:slug', async (req, res, next) => {
  try {
    const channel = await store.channelBySlug(req.params.slug);
    if (!channel) return notFoundPage(req, res, 'store');
    const owner = Boolean(req.user) && req.user.id === channel.owner_id;
    if (!isPublicChannel(channel) && !maySeeHidden(req, channel)) {
      // Byte for byte the same answer a store that never existed gets.
      return notFoundPage(req, res, 'store');
    }
    // A store can be withheld from one country, and then the shop window is the
    // wrong door for that visitor: they get the decision, the rule behind it and
    // a way to ask, instead of a storefront they cannot use. The owner and an
    // operator still see the store — every page of it — with the block stated.
    const country = viewerCountry(req);
    const seesEverything = Boolean(req.user)
      && (req.user.id === channel.owner_id || req.user.role === 'admin');
    const channelBlock = await store.channelCountryBlock(channel.id, country);
    if (channelBlock && !seesEverything) {
      const rules = await store.policyRules();
      const resolved = resolveCountry({ channelBlock });
      countryDependent(res);
      return res.status(blockStatus(resolved)).send(views.countryBlocked({
        user: req.user, consent: null, country, store: channel,
        sentence: blockSentence({
          resolved, rule: ruleFor(rules, channelBlock.rule_code), store: channel.name, country,
        }),
      }));
    }

    // A page view by the owner while the store is hidden is not a view by the
    // public, and counting it would flatter the rent estimate with the owner's
    // own refreshes.
    if (isPublicChannel(channel)) await store.bumpPageView(channel.id);

    // Opening a store is what answers "what is new since I last looked", so a
    // follower's line moves here. There is no row to move for anybody else, which
    // is the property that matters: browsing can never quietly follow someone.
    if (req.user) await store.markChannelSeen(req.user.id, channel.id);

    // A storefront shows the slots that have something in them. An empty
    // channel slot is a hole the owner should fill, not a curiosity for a
    // shopper — so it is rendered where it can be acted on, and here it is not.
    const allSlots = await slotsFor(channel, { viewer: req.user, surface: 'storefront' });
    const slots = allSlots.filter((s) => s.creative);
    await countPositions(channel, 'storefront', slots);
    const rawAssets = await store.assetsOf(channel.id);
    // Two decisions are applied here and not in the view: the file's own state
    // (a removed file is not on the public web) and the country rule that
    // applies where this visitor is standing.
    const listed = await withCountry(rawAssets, country);
    const assets = await withSeries(await Promise.all(
      listed.filter((a) => seesEverything || a.availability.visible).map(async (a) => {
        const files = await store.filesOf(a.id);
        return {
          ...a,
          files,
          ads_required: (await store.unlockPolicy(a.id))?.ads_required ?? 1,
          // The shape, decided once, here, from the files themselves. The view
          // names it on the card and groups the page by it; slice 3's placement
          // planner will read the same value rather than deciding again.
          shape: assetShape(files),
        };
      }),
    ));
    if (country) countryDependent(res);
    const pageviews = await store.pageviews30d(channel.id);
    // The rent estimate is what the CREATOR pays for traffic — billing detail.
    // It feeds the dashboard, not the shop window, so it is not passed here.
    const estimate = estimateRentSlotValue({ pageviews30d: pageviews, slots });

    // Membership, read ONCE: what this store offers and what the viewer holds. The same
    // two answers decide what is already open to this person and what the panel says, and
    // asking twice could only ever produce a page whose two halves disagree. The other two
    // reads the panel needs — who is named on a plan, and whether the feature is on for
    // this store — are below, and all four are skipped for the many stores that do not use
    // membership at all: the tiers query returns nothing and the panel is not drawn.
    const tiers = await store.membershipTiers(channel.id);
    const membership = req.user ? await store.membershipFor(req.user.id, channel.id) : null;
    const membershipsOn = store.plan(channel).capabilities?.memberships === true;

    // Which of these the viewer has already unlocked, in ONE query rather than one per
    // card, plus whatever a current membership covers. The view layer cannot ask; it
    // renders synchronously.
    const unlockedIds = await openSetFor(req.user, rawAssets.map((a) => a.id), {
      channelId: channel.id, tiers, membership,
    });
    // A current membership opens the files behind its tier with no ad, so they
    // join the same set the ad-unlocked files live in: one set, one meaning —
    // "you can open this right now" — rather than two flags the view would have
    // to combine and could get wrong.
    // Only an `ad_free` membership puts a member file in that set. A `supporter`
    // membership's files keep the ordinary asks, so showing them as already open
    // would be the card promising something the file's own page refuses.
    if (tiers.length && membershipCurrent(membership) && adModeOf(membership) === 'ad_free') {
      for (const row of await store.memberOpenAssetIds(channel.id, membership.tier_no)) {
        unlockedIds.add(row.id);
      }
    }

    res.send(views.storefront({
      channel, assets, slots, user: req.user, estimate, pageviews, unlockedIds,
      consent: req.consent,
      // Whether this person already follows this store — the button is the state,
      // so it has to be known before the page is drawn.
      watching: Boolean(await store.followState(req.user?.id, channel.id)),
      // The join panel's whole state: the tiers, the viewer's own row, the named
      // members, and whether the feature is even on for this store.
      tiers, membership, membershipsOn,
      // The shop's own plan, for the mark on its header. Passed rather than read in
      // the view because the view is pure and the plan is a database fact.
      plan: store.plan(channel),
      // Where this person is toward the watching door, if the store has one.
      standing: req.user ? await store.standingFor(req.user.id, channel.id) : 0,
      roster: tiers.length ? await store.publicRoster(channel.id) : [],
      memberFlash: flashFor(req.query),
      // The store's own look. Two custom properties rather than a class per theme,
      // so a seventh palette is one entry in `themes.js` and no stylesheet edit —
      // and so a palette can never reach a surface whose contrast nobody measured:
      // the band, and only the band, is what those two properties paint.
      theme: channel.theme ?? null,
      themeStyle: themeStyle(channel.theme),
      // Where this person left off, by asset id — what a series card reads to say which
      // episode is theirs to play next. Empty for a store with no series, and for a
      // signed-out visitor (a position belongs to a person).
      positions: await positionsOf(req.user, assets.map((a) => a.id)),
      // The paid plans may take bytebikri's name off their own shop window. Read from
      // the same `capabilities` row the pricing page reads, so a plan cannot sell this
      // and fail to deliver it (which is what `remove_footer` did for eight migrations:
      // true on both paid plans, rendered nowhere, sold nowhere).
      plainFooter: store.plan(channel).capabilities?.remove_footer === true,
      // The badge, from the same one row the seller's panel reads. A visitor sees
      // "identity checked" and the sentence says what was checked and when.
      verification: await store.verificationFor(channel.id),
      // Only the owner ever sees this banner, and only on a store that is not
      // public — it is a message about their own shop, not a public notice.
      moderation: owner && !isPublicChannel(channel)
        ? await moderationBrief(channel)
        : null,
      // The owner (or an operator) is the only person who reaches this page at
      // all while the store is withheld from their country, and they are told
      // exactly what a visitor would have been told.
      countryBlocked: channelBlock && seesEverything
        ? {
          country: countryIn(country),
          why: blockSentence({
            resolved: resolveCountry({ channelBlock }),
            rule: ruleFor(await store.policyRules(), channelBlock.rule_code),
            store: channel.name,
            country,
          }).why,
        }
        : null,
    }));
  } catch (err) { next(err); }
});

/**
 * A series' own page (§15).
 *
 * One level down from the storefront, and the only page that holds the whole order. Its
 * visibility rules are the storefront's, resolved the same way and in the same order —
 * the store is public, then the country decision — because a series is a part of a store
 * and must not be a way around a decision made about one.
 *
 * The order, the landing episode and the "is there a next" answer all come from
 * `series.js`; this route only decides WHICH episodes this visitor may be shown, and
 * that decision is the file page's own rule applied to a list.
 */
APP.get('/s/:slug/series/:seriesSlug', async (req, res, next) => {
  try {
    const channel = await store.channelBySlug(req.params.slug);
    if (!channel) return notFoundPage(req, res, 'store');
    const owner = Boolean(req.user) && req.user.id === channel.owner_id;
    if (!isPublicChannel(channel) && !maySeeHidden(req, channel)) return notFoundPage(req, res, 'store');

    const country = viewerCountry(req);
    const seesEverything = Boolean(req.user)
      && (req.user.id === channel.owner_id || req.user.role === 'admin');
    const channelBlock = await store.channelCountryBlock(channel.id, country);
    if (channelBlock && !seesEverything) {
      const rules = await store.policyRules();
      const resolved = resolveCountry({ channelBlock });
      countryDependent(res);
      return res.status(blockStatus(resolved)).send(views.countryBlocked({
        user: req.user, consent: null, country, store: channel,
        sentence: blockSentence({
          resolved, rule: ruleFor(rules, channelBlock.rule_code), store: channel.name, country,
        }),
      }));
    }

    const series = await store.seriesBySlug(channel.id, req.params.seriesSlug);
    if (!series) return notFoundPage(req, res, 'series');

    if (isPublicChannel(channel)) await store.bumpPageView(channel.id);
    if (req.user) await store.markChannelSeen(req.user.id, channel.id);
    if (country) countryDependent(res);

    // The store's own files, and then the visitor's own door: the country rule first,
    // exactly as the storefront applies it to a list of the same rows.
    const all = (await store.episodesForSeries([series.id])).filter((e) => e.status !== 'removed');
    const listed = await withCountry(all, country);
    const episodes = listed.filter((e) => seesEverything || e.availability.visible);

    const tiers = await store.membershipTiers(channel.id);
    const membership = req.user ? await store.membershipFor(req.user.id, channel.id) : null;
    const unlockedIds = await openSetFor(req.user, episodes.map((e) => e.id), {
      channelId: channel.id, tiers, membership,
    });

    res.send(views.seriesPage({
      channel, series, episodes, user: req.user, consent: req.consent,
      unlockedIds,
      // Where this person left off in these episodes: the landing episode is decided
      // from it, which is why a series page can say "back to episode 4" rather than
      // starting somebody at the beginning every time.
      positions: await positionsOf(req.user, episodes.map((e) => e.id)),
      tiers,
      slots: (await slotsFor(channel, { viewer: req.user, surface: 'storefront' })).filter((sl) => sl.creative),
      plainFooter: store.plan(channel).capabilities?.remove_footer === true,
    }));
  } catch (err) { next(err); }
});

/**
 * The storefront as data, for a client that cannot read HTML.
 *
 * Same visibility rule as the page above it: if a store answers at /s/<slug>,
 * it answers here. No session required — this is the shop window, and the app's
 * first screen must render before anybody signs in. Nothing in it is gated: no
 * storage keys, no URLs, just what the store is and what it sells.
 */
APP.get('/api/stores/:slug', async (req, res, next) => {
  try {
    const channel = await store.channelBySlug(req.params.slug);
    if (!channel) return res.status(404).json({ ok: false, error: 'store not found' });

    // The app is a client of the same decisions, not a way around them: a store
    // or a file withheld for the viewer's country is withheld here too, with the
    // sentence the app can show.
    const country = viewerCountry(req);
    const channelBlock = await store.channelCountryBlock(channel.id, country);
    if (channelBlock) {
      const rules = await store.policyRules();
      const resolved = resolveCountry({ channelBlock });
      countryDependent(res);
      const sentence = blockSentence({
        resolved, rule: ruleFor(rules, channelBlock.rule_code), store: channel.name, country,
      });
      return res.status(blockStatus(resolved) ?? 451).json({
        ok: false,
        error: 'country',
        country,
        // The same field every other refusal carries, so a client has one name
        // to read whether the store, the file, or the unlock was refused.
        unavailableFor: 'country',
        ...sentence,
      });
    }

    const listed = await withCountry(await store.assetsOf(channel.id), country);
    const assets = listed.filter((a) => a.availability.visible);
    if (country) countryDependent(res);
    const unlockedIds = req.user
      ? new Set((await many(
          `select asset_id from unlocks
            where user_id = $1 and revoked_at is null
              and (expires_at is null or expires_at > now())
              and asset_id = any($2)`,
          [req.user.id, assets.map((a) => a.id)],
        )).map((r) => r.asset_id))
      : new Set();

    res.json({
      ok: true,
      store: {
        slug: channel.slug, name: channel.name, tagline: channel.tagline,
        bannerUrl: channel.banner_url, listingMode: channel.listing_mode,
      },
      assets: await Promise.all(assets.map(async (a) => {
        const files = await store.filesOf(a.id);
        // Which player to open, decided by the same function the web page uses,
        // so a phone and a browser never disagree about what something is: a
        // video if there is one, otherwise whatever the first file is.
        const kinds = files.map((f) => mediaKind(f.mime_type, f.filename));
        return {
          id: a.id, title: a.title, slug: a.slug, description: a.description,
          coverUrl: a.cover_url, unlockMode: a.unlock_mode,
          fileCount: files.length,
          kind: kinds.find((k) => k === 'video' || k === 'audio') || kinds[0] || 'file',
          // `unlockable` is what the app must check before offering the ad flow;
          // `unlocked` is what the account already holds. A client that tried to
          // unlock a refused file would be refused one call later anyway.
          //
          // `unavailableFor` says WHICH decision refused it — `country` or `file`
          // — because the two need different copy and one status code cannot
          // carry both: a creator withholding their own file and an operator
          // removing one are both 403. Null means nothing stands in the way.
          unlockable: a.availability.unlockable,
          unavailableFor: a.availability.unlockable ? null : a.availability.reason,
          unlocked: ['open', 'breaks'].includes(a.unlock_mode) || unlockedIds.has(a.id),
          adsRequired: (await store.unlockPolicy(a.id))?.ads_required ?? 1,
          adMinSeconds: (await store.unlockPolicy(a.id))?.ad_min_seconds ?? 15,
        };
      })),
    });
  } catch (err) { next(err); }
});

APP.get('/s/:slug/a/:assetSlug', async (req, res, next) => {
  try {
    const channel = await store.channelBySlug(req.params.slug);
    if (!channel) return res.status(404).send('Channel not found');
    if (!isPublicChannel(channel) && !maySeeHidden(req, channel)) {
      return res.status(404).send('Channel not found');
    }
    const asset = await store.assetBySlug(channel.id, req.params.assetSlug);
    if (!asset) return notFoundPage(req, res, 'file');

    /**
     * A file that is not live is not on the public web.
     *
     * "Hidden while it is reviewed" was true of the storefront grid and of
     * Explore and false of the one URL every report, share and screenshot
     * carries: this route rendered the whole listing — title, description, the
     * unlock button — for a paused or report-hidden file, because it never looked
     * at `status`. So a file three people reported for being harmful was still
     * advertised to anyone holding the link, and still unlockable.
     *
     * The exceptions are the people who have a reason to be here: the owner, an
     * operator deciding, and anyone who unlocked it while it was live. That last
     * one is deliberate — an unlock was earned by watching an ad, and hiding a
     * listing is a decision about the STOREFRONT, not a way to take back what
     * somebody already paid for with their attention.
     */
    const holdsUnlock = req.user ? await store.isUnlocked(asset.id, req.user.id) : false;
    if (!maySeeHiddenFile({ asset, user: req.user, ownerId: channel.owner_id, holdsUnlock })) {
      // A 404, not a 403: "you may not see this file" confirms the file exists,
      // and for a report about illegal content that is already too much said.
      return notFoundPage(req, res, 'file');
    }

    // `status` was half of the visibility rule; the operator's own decision about
    // the FILE is the other half. A file removed from the store was still served
    // at this URL for as long as its `status` stayed live, which is the same bug
    // the report-hiding path had, one column over.
    const maySeeEverything = Boolean(req.user)
      && (req.user.id === channel.owner_id || req.user.role === 'admin');
    if (!isAssetPublic(asset.moderation_state) && !maySeeEverything && !holdsUnlock) {
      return notFoundPage(req, res, 'file');
    }

    // Reaching a file means reaching the store that keeps it, so a follower's
    // "what is new" line moves here as well. Same rule as the storefront: no row,
    // no write.
    if (req.user) await store.markChannelSeen(req.user.id, channel.id);

    // The country decision, resolved the same way the storefront resolves it:
    // the file's own rule wins, the store's block applies where there is none.
    const country = viewerCountry(req);
    const countryRule = country ? (await store.countryRulesFor([asset.id], country))[0] ?? null : null;
    const channelBlock = await store.channelCountryBlock(channel.id, country);
    const resolved = resolveCountry({ assetRule: countryRule, channelBlock });
    const availability = availabilityFor({ assetState: asset.moderation_state, resolved });

    if (!availability.visible && !maySeeEverything) {
      const rules = await store.policyRules();
      countryDependent(res);
      return res.status(blockStatus(resolved) ?? 451).send(views.countryBlocked({
        user: req.user, consent: null, country, store: channel, asset,
        sentence: blockSentence({
          resolved, rule: ruleFor(rules, resolved.ruleCode), store: channel.name, country,
        }),
      }));
    }

    // What the OWNER is told, in the same pass: they always see the page, and the
    // sentence is the difference between a decision and a mystery. An operator
    // gets the same line, because they are the one who can undo it.
    // The newest decision about the file, so the sentence the owner reads on
    // their own public page is the same record the console shows.
    const fileDecision = asset.moderation_state === 'approved'
      ? null
      : (await store.fileDecisionHistory(asset.id))[0] ?? null;
    const ownerNotice = !availability.unlockable
      ? availability.reason === 'file'
        ? `${assetBehaviour(asset.moderation_state).ownerNote}${fileDecision
          ? ` An operator decided this${fileDecision.rule_title ? ` under “${fileDecision.rule_title}”` : ''}${fileDecision.reason ? `: ${fileDecision.reason}` : '.'}`
          : ''}`
        : `${restrictedSentence({
          resolved,
          rule: ruleFor(await store.policyRules(), resolved.ruleCode),
          store: channel.name,
          country,
        }).why} Visitors from there get a ${blockStatus(resolved) ?? 451} on this page.`
      : null;

    const refusal = availability.unlockable
      ? null
      : availability.reason === 'file'
        ? {
          headline: 'Listed, but not unlockable',
          why: assetBehaviour(asset.moderation_state).visitorNote || 'This file cannot be unlocked.',
          appeal: 'The store has been told, and can appeal.',
        }
        : restrictedSentence({
          resolved,
          rule: ruleFor(await store.policyRules(), resolved.ruleCode),
          store: channel.name,
          country,
        });

    await store.bumpPageView(channel.id);

    // A membership is a third way in, and it is asked about the same way the
    // other two are: as a fact, before anything is minted. `memberCover` is the
    // row itself, so the page can say which tier opened it and how long is left.
    //
    // `memberDoor` is the same read one level up, and it exists because there are
    // three answers rather than two: covered, `ads` (a member of a tier whose files
    // keep the ordinary asks — `supporter`), or not a member at all. The page has to
    // tell them apart; the content route only needs the first.
    const memberDoor = req.user
      ? await store.memberDoorFor({ profileId: req.user.id, channelId: channel.id, asset })
      : { door: 'none', membership: null };
    const memberCover = memberDoor.door === 'covered' ? memberDoor.membership : null;
    const unlocked = (['open', 'breaks'].includes(asset.unlock_mode) || holdsUnlock || Boolean(memberCover))
      && availability.unlockable;

    // Content URLs are minted per request, per user, and expire. They are only
    // produced when an unlock actually exists — never baked into the HTML.
    //
    // The view is told what each file IS, not what to do with it: a video is
    // played, an image is watermarked and shown, a zip is downloaded, and only
    // the page decides how that reads. That keeps the decision in one place
    // instead of a filename suffix check inside a template string.
    const memberTiersHere = asset.unlock_mode === 'members'
      ? await store.membershipTiers(channel.id)
      : [];
    const files = (await store.filesOf(asset.id)).map((f) => {
      const kind = mediaKind(f.mime_type, f.filename);
      // Images get a stream URL too: they are shown on the page through the
      // same signed, ranged route, so there is exactly one way bytes leave this
      // server and exactly one place the watermark is applied.
      const inline = isPlayable(f.mime_type, f.filename) || kind === 'image';
      const minted = unlocked && req.user
        ? {
          downloadUrl: issueDownloadUrl({ assetId: asset.id, file: f, userId: req.user.id, basePath: '' }),
          streamUrl: inline
            ? issueStreamUrl({ assetId: asset.id, file: f, userId: req.user.id, basePath: '' })
            : null,
        }
        : { downloadUrl: null, streamUrl: null };
      return {
        ...f, ...minted, kind,
        playable: isPlayable(f.mime_type, f.filename),
        // Where these bytes physically are. The view cannot read a storage key's
        // meaning (it reads no tables and imports no storage) and the SELLER is
        // entitled to know the difference between our disk and somebody else's CDN
        // (`VIDEO_STORAGE.md` §8) — so it travels as a fact, like the plan does.
        hosted: storage.isRemote(f.storage_key),
        // Watermarking covers images only. Saying so here, per file, is what
        // lets the page be accurate instead of claiming a blanket protection.
        marked: kind === 'image',
      };
    });
    const previewFile = files.find((f) => f.playable) || files.find((f) => f.kind === 'image') || null;

    // The report affordances. `reported` comes from the redirect after a
    // submission and is read as a flag, never echoed; `alreadyReported` is what
    // stops the same person filing the same thing twice and being thanked for it.
    const reportedFlag = req.query.reported === '1';
    const reportError = req.query.report ? (ERROR_FLASH[`report_${req.query.report}`] || null) : null;
    const alreadyReported = req.user && req.user.id !== channel.owner_id
      ? await store.hasReported(asset.id, req.user.id)
      : false;

    // The on-screen mark for video and audio, which cannot be burned in without
    // a transcoder. It is the same reference that goes into the pixels of an
    // image, drawn in the DOM instead — and the page says which of the two it is.
    const markLabel = unlocked && req.user
      ? watermarkLabel({ ref: req.user.id, assetId: asset.id })
      : '';
    const markUri = markLabel ? watermarkSvgDataUri(markLabel) : '';

    // The expiry that matters is the VIEWER's entitlement, not a column on the
    // asset. The old copy read `asset.expires_at`, which is not where an unlock
    // lives, so every 24-hour unlock was described as "permanent access".
    const unlock = unlocked && req.user ? await store.unlockFor(asset.id, req.user.id) : null;

    // Reviews: the list, the average, and whether THIS person may write one.
    // The view cannot ask — it renders synchronously — so all three are decided
    // here, including the one that matters: an unlock row is what earns a voice.
    const reviews = await store.reviewsOfAsset(asset.id);
    const reviewStats = await store.reviewStatsOfAsset(asset.id);
    const myReview = unlock ? reviews.find((r) => r.unlock_id === unlock.id) ?? null : null;

    // Read once, because two things below need it: the panel's copy and the ask it
    // prints. Reading it inline in both places is how the second one ends up naming a
    // variable that does not exist — which this route did for exactly one browser
    // pass, and which no module-level test could see.
    const unlockPolicy = await store.unlockPolicy(asset.id);

    // Where this file's breaks are, if it has any: the buyer is told before they
    // click, the same way the ask is. A file that opens freely and breaks at 11:08
    // must say so on the page rather than surprise somebody mid-listen.
    //
    // Skipped entirely when the file opens no content (`open` mode carries its
    // files panel immediately) — a break nobody can reach is copy about nothing.
    const shape = assetShape(files, { url: asset.external_url });
    const placement = ['watch', 'listen', 'read'].includes(shape)
      ? await store.adPlanFor(asset, { membersOnly: asset.unlock_mode === 'members' }) : null;
    /*
     * The break gate, handed to the player as data.
     *
     * Only for a `breaks` file that is actually open to this person: the cues are a
     * description of what the player will do, and a locked file's player is not
     * running. `cleared` is not sent — what this person already sat through is the
     * database's business, and the client learns it the same way it learns
     * everything else: by asking the status route.
     */
    const stops = shape === 'read' ? betweenCues(placement) : breakCues(placement ?? {});
    const gate = unlocked && asset.unlock_mode === 'breaks' && placement && stops.length
      ? {
        breakUrl: '/api/unlock/break',
        // A player's cue has a second; a reader's has a step. Exactly one of the two
        // is present, which is why the client checks which surface it is on rather
        // than assuming a shape.
        reader: shape === 'read',
        cues: stops.map((c) => ({
          index: c.index, atSec: c.atSec, seconds: c.seconds, chapter: c.atChapter ?? null,
        })),
      }
      : null;

    // The positions this page will draw, counted once, and then narrowed for the page
    // itself: `countPositions` applies the view's own rule for what reaches a
    // visitor, while the `app_native` positions are not drawn on a web page at all.
    const assetSlots = await slotsFor(channel, { viewer: req.user, surface: 'asset' });
    await countPositions(channel, 'asset', assetSlots);

    /*
     * THE LIVE SURFACE (§14).
     *
     * A live file is not bytes we hold: it is the store's own URL, and the page's job
     * is to hand the browser that URL and to decide whether this person walks in now
     * or is asked first. Three facts decide it — a break the store called that this
     * viewer has not been served (`stop`), a break that ran recently and is paying for
     * newcomers' entries (`covered`), or the ordinary door.
     *
     * Computed here AND served to the poller from `/api/live/:id/state`, both from
     * `liveState()`. One composition, two readers: a page that draws one picture and a
     * poller that acts on another is exactly how a viewer gets stopped by a break
     * nobody mentioned, which is the complaint §2.3 recorded against the industry.
     */
    /*
     * WHERE THIS PERSON IS ON THE BLOCKER LADDER, decided here and read by three
     * surfaces: the door's withheld state, the cue gate inside a player, and a live
     * break (§14.7). Computed on the server for the same reason the door's copy always
     * was — a browser that could decide its own rung could decide to un-decide it — and
     * covering `breaks` files as well as `ad_gated` ones, because a cue break asks a
     * viewer for a view inside the player with no door anywhere on the page.
     */
    const blockRung = !req.user || !['ad_gated', 'breaks'].includes(asset.unlock_mode)
      ? null
      : await (async () => {
        const attempts = await store.blockSignalCount({
          assetId: asset.id, userId: req.user.id, hours: SIGNAL_WINDOW_HOURS,
        });
        // Whether this store sells memberships at all. The withheld rung's only route
        // forward used to be a button to `#members` — which is a dead anchor in a store
        // with no tiers, so the button waits for the fact rather than assuming it.
        const hasMembers = (await store.membershipTiers(channel.id)).length > 0;
        const rung = rungFor(attempts);
        return { ...rung, player: playerWords(rung), attempts, hasMembers };
      })();

    const liveBreaks = shape === 'stream' ? await store.liveBreaksOf(asset.id) : [];
    let live = null;
    if (shape === 'stream') {
      const clearedLive = req.user ? await store.clearedGates(req.user.id, asset.id) : [];
      const state = liveState({ breaks: liveBreaks, cleared: clearedLive, unlocked, now: new Date() });
      live = {
        url: asset.external_url,
        stateUrl: `/api/live/${asset.id}/state`,
        viewUrl: `/api/live/${asset.id}/view`,
        pollSeconds: LIVE_POLL_SECONDS,
        state,
        cleanEntry: cleanEntrySentence(state.coverageUntil, new Date()),
        // The blocker ladder, on the surface that cannot be withheld (§14.7). Rendered
        // here as well as served to the poller, for the reason the door's rung is: a
        // person who arrives INSIDE a break must not be asked for a view the server has
        // already stopped offering them, and that decision must not wait for a poll.
        rung: blockRung,
      };
    }

    /*
     * THE EPISODE STRIP (§15), and the position it resumes from.
     *
     * `?restart=1` is what "start from the beginning" is made of: the page is rendered
     * without the resume, so the control works with no script at all. The client honours
     * the same link as a seek when the script is running, and reports 0 so the saved
     * position follows the viewer rather than the button.
     */
    const seriesHere = asset.series_id
      ? await seriesForFile({
        channel, asset, user: req.user, maySeeEverything,
        membership: memberCover, tiers: memberTiersHere,
      })
      : null;
    const restart = req.query.restart === '1';
    const watchPosition = req.user && !restart && ['watch', 'listen'].includes(shape)
      ? await store.watchProgress(req.user.id, asset.id)
      : null;
    const stripUnlocked = seriesHere
      ? await openSetFor(req.user, seriesHere.episodes.map((e) => e.id), {
        channelId: channel.id, tiers: memberTiersHere, membership: memberCover,
      })
      : new Set();

    // Decided before the view is called, because the view is pure and this is a
    // fact about somebody else's server (the same rule as the store's plan).
    const sourceKind = await hostedSourceKind(files);

    res.send(views.assetPage({
      sourceKind,
      channel, asset, files, unlocked, user: req.user, consent: req.consent,
      series: seriesHere,
      watchPosition,
      unlockedIds: stripUnlocked,
      placement,
      gate,
      live,
      // The page model, for a file a reader can open (§13). It is what the page's
      // counting words and its reader link are built from, and null for every other
      // shape — there is no page count for a video, and inventing one would be a
      // number with nothing behind it.
      pages: shape === 'read' ? await store.assetPagePlan(asset, files) : null,
      progress: shape === 'read' && req.user
        ? await store.readingProgress(req.user.id, asset.id)
        : null,
      accessUntil: unlock?.expires_at ?? null,
      previewFile, markUri, markLabel,
      alreadyReported,
      reported: reportedFlag ? { reporters: await store.reportVerdictFor(asset.id).then((v) => v.reporters), filed: true, hidden: false } : null,
      reportError,
      reviews, reviewStats,
      canReview: Boolean(unlock) && !myReview,
      myReview,
      reviewError: REVIEW_ERRORS[String(req.query.error)] || null,
      policy: unlockPolicy,
      // Which tier the viewer holds, and what the file needs — the two facts the
      // refusal sentence is built from.
      memberCover,
      memberDoor: memberDoor.door,
      plainFooter: store.plan(channel).capabilities?.remove_footer === true,
      memberTiers: asset.unlock_mode === 'members' ? memberTiersHere : [],
      memberTierName: asset.unlock_mode === 'members'
        ? memberTiersHere.find((t) => Number(t.tier_no) === (Number(asset.member_tier) || 1))?.name ?? null
        : null,
      // What the FILE's tier currently promises, which is what a stranger reading
      // the page needs to know: "no ad" and "the ordinary asks" are opposite
      // promises, and only one of them is true of this tier.
      memberTierAdMode: asset.unlock_mode === 'members'
        ? adModeOf(memberTiersHere.find((t) => Number(t.tier_no) === (Number(asset.member_tier) || 1)))
        : 'ad_free',
      refusal, ownerNotice,
      // A file the viewer can open because an operator allowed it back into a
      // country whose store-wide rule would otherwise refuse them.
      carveOut: views.carriedByCarveOut({
        resolved, country, rule: ruleFor(await store.policyRules(), resolved.ruleCode), store: channel.name,
      }),
      // On a file page the whole point of the space is to pay for the unlock, so
      // the platform slot is always here — the creator's own message appears
      // only if they wrote one.
      blockRung,

      // The ask as the pipeline will enforce it — the stored pair, not a recomputed
      // one. If a file asks for 2 × 30 s, the page says 2 × 30 s, whatever the value
      // ladder would derive today; the seller's page is where a drift is explained.
      ask: {
        ads: Number(unlockPolicy?.ads_required) || 1,
        seconds: Number(unlockPolicy?.ad_min_seconds) || 15,
        level: unlockPolicy?.ask_level === 'light' ? 'light' : 'standard',
      },
      slots: assetSlots.filter((s) => s.creative && s.surface !== 'app_native'),
    }));
  } catch (err) { next(err); }
});

/**
 * A dashboard shows earnings, ad connections and traffic. It was readable by
 * anyone who knew the slug, because the route never checked who was asking.
 * Now: signed in, and the channel is yours.
 */
APP.get('/dashboard/:slug', async (req, res, next) => {
  try {
    if (!req.user) {
      return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
    }
    const channel = await store.channelBySlug(req.params.slug);
    if (!channel) return res.status(404).send('Channel not found');
    if (channel.owner_id !== req.user.id && req.user.role !== 'admin') {
      // 404 rather than 403: confirming a store exists but is not yours still
      // tells a stranger the store exists.
      return res.status(404).send('Channel not found');
    }

    const slots = await buildSlots(channel);
    const pageviews = await store.pageviews30d(channel.id);
    const unlocks = await store.unlocksOfChannel(channel.id);
    const estimate = {
      ...estimateRentSlotValue({ pageviews30d: pageviews, slots }),
      unlocks: unlocks.filter((u) => !u.revoked_at).length,
    };

    // How full the plan is, from the same helper the operator's pages use. The
    // file count is the LIVE file list this route already fetched, so the number
    // on the dashboard is the number the upload check counts.
    const plan = store.plan(channel);
    const assets = await store.assetsOf(channel.id);
    const usage = planUsage({ plan, files: assets.length, slots });

    // Flash messages travel as short codes and are mapped to sentences here.
    // Never echo a query parameter into HTML: `?error=<script>` is the oldest
    // reflected-XSS there is, and escaping is not a substitute for not doing it.
    // `usage` is passed as context only so the refusal at the wall can name the
    // count and the plan that lifts it: a bare "your limit is reached" leaves a
    // person to guess what the limit is and what fixing it costs.
    const flash = flashFor(req.query, { usage, plan, next: nextPlan(plan.code) });

    res.send(views.dashboard({
      // Only when the state is not the default. A banner that says "nothing is
      // wrong" on every store is a banner nobody reads.
      moderation: normaliseState(channel.moderation_state) === 'approved'
        || normaliseState(channel.moderation_state) === 'pending'
        ? null
        : await moderationBrief(channel),
      flash, consent: req.consent,
      channel, slots, user: req.user,
      connections: await store.connectionsOf(channel.id),
      providers: await selectableProviders(),
      plan: store.plan(channel),
      estimate, pageviews, usage,
      nextPlan: nextPlan(plan.code),
      adViews: await store.adViews({ channelId: channel.id }),
      assets,
      // The table lists everything the seller owns except what an operator
      // removed; `assets` above stays the live-only list, because that is the
      // number the publish check and the plan meter both count.
      // The file list, filtered and paged the way the toolbar on the page asks for
      // it. This used to be the whole store, newest first, with no way to search it
      // — a list, not a tool, for anybody with more than a handful of files.
      files: await store.sellerFiles(channel.id, {
        q: req.query.q, state: req.query.state, access: req.query.access,
        sort: req.query.sort, page: req.query.page, perPage: 25,
      }),
      // The bulk change somebody has not taken back yet, if it is still inside the
      // undo window. On the page rather than only in a flash, because a flash is
      // gone the moment the next page loads and this promise is "you can take it
      // back", not "you could have for a few seconds".
      recentBulk: await store.recentAssetBulk(channel.id),
      assetStats: await store.assetStats(channel.id),
      traffic: await store.trafficSeries(channel.id, { days: 30 }),
      adViewSeries: await store.assetAdViewSeries(channel.id, { days: 30 }),
      upgrade: store.upgradeQuote(channel, 'store'),
      // Through the subscription, because a plan payment has no channel of its
      // own: `plan_payments.subscription_id` is the only path back, and the
      // previous version filtered on a column that does not exist — which is
      // why this counter always read zero.
      pendingPayments: await store.planPaymentsOfChannel(channel.id),
      flash,
    }));
  } catch (err) { next(err); }
});

/**
 * The public base URL, for a callback URL a network has to reach.
 *
 * `PUBLIC_BASE_URL` first, then whatever the request itself says — a seller
 * setting this up on a deployed instance gets a URL that works without an env
 * var, and one behind a proxy gets the host the proxy forwarded. The value is
 * shown to a human to paste, so a wrong one is visible rather than silent.
 */
function publicBase(req) {
  const configured = process.env.PUBLIC_BASE_URL;
  if (configured) return String(configured).replace(/\/+$/, '');
  const proto = req.get('x-forwarded-proto') || req.protocol || 'http';
  return `${proto}://${req.get('host')}`;
}

/** Everything the ad-networks page needs, assembled in one place. */
async function networksState(req, channel) {
  const registry = await loadRegistry();
  const connections = await store.connectionsOf(channel.id);
  const evidence = await store.postbackEvidence(channel.id);
  const base = publicBase(req);

  const evidenceFor = (providerId, connectionId) => {
    const exact = evidence.find((e) => e.connection_id === connectionId);
    const byProvider = evidence.find((e) => e.provider_id === providerId);
    const chosen = exact || byProvider || null;
    return {
      lastPostbackAt: chosen?.last_at || null,
      postbacks30d: Number(chosen?.in_window || 0),
    };
  };

  const connected = await Promise.all(connections.map(async (c) => {
    const provider = registry.providers.find((p) => p.id === c.provider_id) || { id: c.provider_id, name: c.provider_id };
    const onboarding = onboardingFor(provider);
    const sandbox = SANDBOX_PROVIDER_IDS.has(c.provider_id);
    return {
      connection: c,
      provider,
      onboarding,
      sandbox,
      // The URL as the network needs it, macros intact.
      url: postbackUrl({ provider, connectionId: c.id, baseUrl: base }),
      secretHint: maskSecret(c.callback_secret),
      health: connectionHealth({
        connection: c, sandbox, connectable: connectable(provider),
        ...evidenceFor(c.provider_id, c.id),
      }),
      events: await store.connectionEvents(c.id, { limit: 6 }),
    };
  }));

  const providerNames = new Set(connections.map((c) => c.provider_id));
  const available = registry.providers
    .filter((p) => !providerNames.has(p.id) && p.id !== 'house')
    .map((p) => ({ provider: p, onboarding: onboardingFor(p), verdict: payoutVerdict(p), note: unconnectableNote(p) }))
    .sort((a, b) => {
      // Connectable first, then by the registry's own priority: what a Nepali
      // creator can actually use today should be at the top of the page.
      const rank = (x) => (connectable(x.provider) ? 0 : 1);
      return rank(a) - rank(b) || (a.provider.priority ?? 500) - (b.provider.priority ?? 500);
    });

  return { connections: connected, available, base, unusableBase: !process.env.PUBLIC_BASE_URL };
}

// ---------------------------------------------------------------------------
// Ad slots — the creator's own space
// ---------------------------------------------------------------------------
APP.get('/dashboard/:slug/slots', async (req, res, next) => {
  try {
    const channel = await requireOwnChannel(req, res);
    if (!channel) return;
    // Creatives written for positions that no longer exist. Read here rather than
    // in the view, and listed rather than silently dropped: migration 0034 cut the
    // page from eight positions to three, and the words a seller wrote for ranks 4
    // and 5 are still in the table.
    const creatives = await store.creativesForChannel(channel.id);
    const live = new Set((await buildSlots(channel)).map((s) => s.slotKey));
    const retiredSlots = SLOT_DEFS
      .filter((d) => !live.has(d.key))
      .map((d) => ({ ...d, creative: creatives.find((c) => c.slot_key === d.key) }))
      .filter((d) => d.creative && (d.creative.headline || d.creative.body))
      .map((d) => ({ label: d.label, headline: d.creative.headline || d.creative.body }));

    const plan = store.plan(channel);
    const tiers = await store.membershipTiers(channel.id);
    res.send(views.slotsPage({
      channel, user: req.user, consent: req.consent,
      // The panel is told both facts rather than reading them: `views.js` reads no
      // tables, and a capability whose only visible effect is a box NOT appearing for
      // somebody else is one a seller cannot tell they bought.
      memberAdFree: plan.capabilities?.ad_free === true,
      hasTiers: tiers.length > 0,
      planName: plan.name,
      slots: await slotsFor(channel, { viewer: req.user, surface: 'dashboard' }),
      blockedCount: await store.blockSignalCountOfChannel(channel.id, { hours: SIGNAL_WINDOW_HOURS }),
      blockedHours: SIGNAL_WINDOW_HOURS,
      retiredSlots,
      flash: flashFor(req.query),
    }));
  } catch (err) { next(err); }
});

APP.post('/dashboard/:slug/slots', async (req, res, next) => {
  try {
    const channel = await requireOwnChannel(req, res);
    if (!channel) return;
    if (refuseWrite(req, res, channel)) return;
    const { slotKey, headline, body, linkUrl, linkLabel } = req.body || {};

    // The slot has to exist and has to be the store's. Without this check a
    // posted slotKey could write a creative "into" the platform's rent slot, and
    // the store would be filling space it is being paid to leave alone.
    const allocated = await slotsFor(channel, { viewer: req.user });
    const target = allocated.find((s) => (s.slotKey || s.key) === slotKey);
    if (!target || target.owner !== 'channel') {
      return res.redirect(`/dashboard/${channel.slug}/slots?error=slot`);
    }

    // A link that cannot be rendered is refused here rather than stored and then
    // silently dropped at render time. A creator who typed a link and saw it
    // vanish would reasonably conclude the product is broken.
    if (linkUrl && !sanitizeUrl(linkUrl)) {
      return res.redirect(`/dashboard/${channel.slug}/slots?error=link`);
    }

    const saved = await store.setCreative({
      channelId: channel.id, slotKey, headline, body, linkUrl, linkLabel,
    });
    if (!saved) return res.redirect(`/dashboard/${channel.slug}/slots?error=empty`);

    await store.audit('creative.saved', { channelId: channel.id, slotKey });
    res.redirect(`/dashboard/${channel.slug}/slots?saved_slot=1`);
  } catch (err) { next(err); }
});

APP.post('/dashboard/:slug/slots/clear', async (req, res, next) => {
  try {
    const channel = await requireOwnChannel(req, res);
    if (!channel) return;
    if (refuseWrite(req, res, channel)) return;
    await store.clearCreative({ channelId: channel.id, slotKey: req.body?.slotKey });
    await store.audit('creative.cleared', { channelId: channel.id, slotKey: req.body?.slotKey });
    res.redirect(`/dashboard/${channel.slug}/slots?saved_slot=1`);
  } catch (err) { next(err); }
});

/*
 * ── THE SELLER'S SERIES PANEL (§15) ────────────────────────────────────────
 *
 * The store's own edit and nobody else's: the platform cannot create a series, reorder
 * one, or insert into one. Every route below checks the series belongs to the channel
 * asking, and the shape rule is checked with `assetShape` — the one place a shape is
 * decided — rather than by trusting a form's own opinion of what it sent.
 */
APP.get('/dashboard/:slug/series', async (req, res, next) => {
  try {
    const channel = await requireOwnChannel(req, res);
    if (!channel) return;
    const list = await store.seriesOf(channel.id);
    const episodes = (await store.episodesForSeries(list.map((s) => s.id)))
      .filter((e) => e.status !== 'removed');
    const bySeries = {};
    for (const episode of episodes) (bySeries[String(episode.series_id)] ||= []).push(episode);

    // What may still join a series. Shapes come from the files (`media.js`), and a file
    // already in a series is not offered again: moving one is a decision, not a side
    // effect of picking it from a list.
    const owned = (await store.assetsForOwner(channel.id)).filter((a) => a.status === 'live');
    const files = await store.filesForAssets(owned.map((a) => a.id));
    const taken = new Set(episodes.map((e) => String(e.id)));
    const candidates = owned
      .filter((a) => !taken.has(String(a.id)))
      .map((a) => ({ ...a, shape: assetShape(files[String(a.id)] || [], { url: a.external_url }) }))
      .filter((a) => SERIES_SHAPES.includes(a.shape))
      .map((a) => ({ id: a.id, title: a.title, shape: a.shape }));

    res.send(views.seriesPanel({
      channel, user: req.user, consent: req.consent,
      flash: flashFor(req.query),
      series: list.map((s) => ({ ...s, episodes: bySeries[String(s.id)] || [] })),
      candidates,
      plainFooter: store.plan(channel).capabilities?.remove_footer === true,
    }));
  } catch (err) { next(err); }
});

/** Start a series. The slug is derived from the title and counts up inside the store. */
APP.post('/dashboard/:slug/series', async (req, res, next) => {
  try {
    const channel = await requireOwnChannel(req, res);
    if (!channel) return;
    if (refuseWrite(req, res, channel)) return;
    const title = String(req.body?.title || '').trim().slice(0, 140);
    const blurb = String(req.body?.blurb || '').trim().slice(0, 400) || null;
    const mode = String(req.body?.mode || '');
    if (!title) return res.redirect(`/dashboard/${encodeURIComponent(channel.slug)}/series?error=series-title`);
    if (!SERIES_MODE_KEYS.includes(mode)) {
      return res.redirect(`/dashboard/${encodeURIComponent(channel.slug)}/series?error=series-mode`);
    }
    const taken = (await store.seriesOf(channel.id)).map((s) => s.slug);
    const created = await store.createSeries({
      channelId: channel.id, slug: seriesSlug(title, taken), title, blurb, mode,
    });
    await store.audit('series.created', { channelId: channel.id, seriesId: created.id, mode });
    res.redirect(`/dashboard/${encodeURIComponent(channel.slug)}/series?saved=series-created`);
  } catch (err) { next(err); }
});

/** Rename a series, change its blurb, or change its mode. The address never moves. */
APP.post('/dashboard/:slug/series/:seriesId', async (req, res, next) => {
  try {
    const channel = await requireOwnChannel(req, res);
    if (!channel) return;
    if (refuseWrite(req, res, channel)) return;
    const series = await store.seriesById(req.params.seriesId, channel.id);
    if (!series) return res.redirect(`/dashboard/${encodeURIComponent(channel.slug)}/series?error=series-owned`);
    const title = String(req.body?.title || '').trim().slice(0, 140);
    const blurb = String(req.body?.blurb || '').trim().slice(0, 400) || null;
    const mode = String(req.body?.mode || '');
    if (!title) return res.redirect(`/dashboard/${encodeURIComponent(channel.slug)}/series?error=series-title`);
    if (!SERIES_MODE_KEYS.includes(mode)) {
      return res.redirect(`/dashboard/${encodeURIComponent(channel.slug)}/series?error=series-mode`);
    }
    await store.updateSeries({ seriesId: series.id, title, blurb, mode });
    await store.audit('series.updated', { channelId: channel.id, seriesId: series.id, mode });
    res.redirect(`/dashboard/${encodeURIComponent(channel.slug)}/series?saved=series-saved`);
  } catch (err) { next(err); }
});

/**
 * Put a file in a series at a number, or renumber one already in it.
 *
 * The refusal is the module's (`seriesRefusalCode`), mapped to a flash code by the
 * helper below, so the sentence a seller reads after a redirect and the sentence beside
 * the form cannot be two different rules.
 */
APP.post('/dashboard/:slug/series/:seriesId/episode', async (req, res, next) => {
  try {
    const channel = await requireOwnChannel(req, res);
    if (!channel) return;
    if (refuseWrite(req, res, channel)) return;
    const back = `/dashboard/${encodeURIComponent(channel.slug)}/series`;
    const series = await store.seriesById(req.params.seriesId, channel.id);
    if (!series) return res.redirect(`${back}?error=series-owned`);
    const asset = await store.assetById(req.body?.assetId);
    const episodes = (await store.episodesForSeries([series.id])).filter((e) => e.status !== 'removed');
    const raw = req.body?.episodeNo;
    const wanted = raw === '' || raw === null || raw === undefined ? null : Number(raw);
    const code = seriesRefusalCode({
      asset, shape: asset ? await store.shapeOf(asset) : null, channelId: channel.id, series, episodes, episodeNo: wanted,
    });
    if (code) return res.redirect(`${back}?error=${seriesError(code)}`);
    await store.setEpisode({
      assetId: asset.id,
      seriesId: series.id,
      episodeNo: wanted ?? freeEpisodeNo(episodes.filter((e) => String(e.id) !== String(asset.id))),
    });
    await store.audit('series.episode_set', {
      channelId: channel.id, seriesId: series.id, assetId: asset.id, episodeNo: wanted,
    });
    res.redirect(`${back}?saved=episode-set`);
  } catch (err) { next(err); }
});

/** Take a file out of a series. The file is untouched, and nothing is renumbered. */
APP.post('/dashboard/:slug/series/:seriesId/episode/remove', async (req, res, next) => {
  try {
    const channel = await requireOwnChannel(req, res);
    if (!channel) return;
    if (refuseWrite(req, res, channel)) return;
    const back = `/dashboard/${encodeURIComponent(channel.slug)}/series`;
    const series = await store.seriesById(req.params.seriesId, channel.id);
    const asset = series ? await store.assetById(req.body?.assetId) : null;
    if (!series || !asset
      || String(asset.channel_id) !== String(channel.id)
      || String(asset.series_id) !== String(series.id)) {
      return res.redirect(`${back}?error=series-owned`);
    }
    await store.setEpisode({ assetId: asset.id, seriesId: null, episodeNo: null });
    await store.audit('series.episode_removed', { channelId: channel.id, seriesId: series.id, assetId: asset.id });
    res.redirect(`${back}?saved=episode-removed`);
  } catch (err) { next(err); }
});

/** Delete a grouping. Its episodes stay published, and the trigger clears the numbers. */
APP.post('/dashboard/:slug/series/:seriesId/delete', async (req, res, next) => {
  try {
    const channel = await requireOwnChannel(req, res);
    if (!channel) return;
    if (refuseWrite(req, res, channel)) return;
    const back = `/dashboard/${encodeURIComponent(channel.slug)}/series`;
    const series = await store.seriesById(req.params.seriesId, channel.id);
    if (!series) return res.redirect(`${back}?error=series-owned`);
    await store.deleteSeries(series.id);
    await store.audit('series.deleted', { channelId: channel.id, seriesId: series.id, title: series.title });
    res.redirect(`${back}?saved=series-deleted`);
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Ad networks — connecting a store to a network that pays it directly
// ---------------------------------------------------------------------------
APP.get('/dashboard/:slug/networks', async (req, res, next) => {
  try {
    const channel = await requireOwnChannel(req, res);
    if (!channel) return;
    const state = await networksState(req, channel);
    res.send(views.networksPage({
      channel, user: req.user, consent: req.consent, slotDefs: SLOT_DEFS,
      ...state, flash: flashFor(req.query),
    }));
  } catch (err) { next(err); }
});

/**
 * Start a connection.
 *
 * The status is the honest part: a network whose callbacks we verify with a
 * secret they issue starts `verifying`, not `active`, because until the secret
 * arrives nothing it sends can be trusted. Claiming "connected" before that
 * would be a green tick over a connection that refuses every callback.
 */
APP.post('/dashboard/:slug/networks', async (req, res, next) => {
  try {
    const channel = await requireOwnChannel(req, res);
    if (!channel) return;
    if (refuseWrite(req, res, channel)) return;
    const back = `/dashboard/${channel.slug}/networks`;
    const provider = await providerById(String(req.body?.providerId || ''));
    if (!provider) return res.redirect(`${back}?error=provider`);
    if (!connectable(provider)) return res.redirect(`${back}?error=noadapter`);

    const already = (await store.connectionsOf(channel.id)).find((c) => c.provider_id === provider.id);
    if (already) return res.redirect(`${back}?error=already`);

    const onboarding = onboardingFor(provider);
    // No slots on connect. Which positions a network fills is a separate
    // decision, made on the page once the seller can see what each one is for —
    // and a network assigned to a slot it cannot serve is a blank space the
    // seller is already paying rent for.
    const slots = [];

    const conn = await store.createConnection({
      channelId: channel.id,
      providerId: provider.id,
      onboarding: onboarding.mode === 'paste_credentials' ? 'paste_credentials' : 'signup_redirect',
      payoutVerdict: payoutVerdict(provider)?.level || null,
      // Slots a rewarded/offerwall network can serve. It cannot fill a display
      // slot, and a network assigned to a slot it cannot fill is a blank space
      // the seller already paid rent for.
      slotKeys: onboarding.mode === 'paste_credentials' ? [] : slots,
      // Ours, generated per connection, and only for providers we sign for. A
      // network that signs with a secret WE generated would be verifiable by
      // anyone who has read this repository.
      secret: provider.id === 'house' ? readSecret('AD_POSTBACK_SECRET') : null,
      callbackBaseUrl: publicBase(req),
    });
    // createConnection starts a connection active so the sandbox works out of
    // the box; a network we must verify is held back until its secret arrives.
    if (onboarding.needsSecret) {
      await store.updateConnection(conn.id, { status: 'verifying' });
      await store.logConnectionEvent({ connectionId: conn.id, to: 'verifying', detail: 'waiting for the network secret' });
    } else {
      await store.logConnectionEvent({ connectionId: conn.id, to: 'active', detail: 'no credentials needed' });
    }

    await store.audit('ad_connection.started', { channelId: channel.id, providerId: provider.id, connectionId: conn.id });
    return res.redirect(`${back}?started=${encodeURIComponent(provider.id)}`);
  } catch (err) { return next(err); }
});

/** The secret their network signs with. The only credential we ever hold. */
APP.post('/dashboard/:slug/networks/:connectionId/secret', async (req, res, next) => {
  try {
    const channel = await requireOwnChannel(req, res);
    if (!channel) return;
    if (refuseWrite(req, res, channel)) return;
    const back = `/dashboard/${channel.slug}/networks`;
    const conn = await store.connectionById(req.params.connectionId);
    if (!conn || conn.channel_id !== channel.id) return res.redirect(`${back}?error=nope`);

    const provider = await providerById(conn.provider_id);
    const field = onboardingFor(provider).credentials[0];
    if (!field) return res.redirect(`${back}?error=noadapter`);

    const checked = validateCredential(field, req.body?.[field.key]);
    if (!checked.ok) return res.redirect(`${back}?error=secret`);

    await store.updateConnection(conn.id, {
      callback_secret: checked.value,
      credential_label: field.label,
      status: 'active',
      status_reason: null,
    });
    await store.logConnectionEvent({
      connectionId: conn.id, from: conn.status, to: 'active',
      detail: `${field.label} saved`,
    });
    await store.audit('ad_connection.verified', { channelId: channel.id, providerId: conn.provider_id, connectionId: conn.id });
    return res.redirect(`${back}?saved_connection=1`);
  } catch (err) { return next(err); }
});

/** Which slots this network may serve. */
APP.post('/dashboard/:slug/networks/:connectionId/slots', async (req, res, next) => {
  try {
    const channel = await requireOwnChannel(req, res);
    if (!channel) return;
    if (refuseWrite(req, res, channel)) return;
    const back = `/dashboard/${channel.slug}/networks`;
    const conn = await store.connectionById(req.params.connectionId);
    if (!conn || conn.channel_id !== channel.id) return res.redirect(`${back}?error=nope`);

    const offered = new Set(SLOT_DEFS.filter((d) => d.active).map((d) => d.key));
    const picked = [].concat(req.body?.slotKeys || []).filter((k) => offered.has(k));
    await store.updateConnection(conn.id, { slot_keys: picked });
    await store.audit('ad_connection.slots', { channelId: channel.id, connectionId: conn.id, picked });
    return res.redirect(`${back}?saved_connection=1`);
  } catch (err) { return next(err); }
});

APP.post('/dashboard/:slug/networks/:connectionId/revoke', async (req, res, next) => {
  try {
    const channel = await requireOwnChannel(req, res);
    if (!channel) return;
    if (refuseWrite(req, res, channel)) return;
    const back = `/dashboard/${channel.slug}/networks`;
    const conn = await store.connectionById(req.params.connectionId);
    if (!conn || conn.channel_id !== channel.id) return res.redirect(`${back}?error=nope`);

    await store.updateConnection(conn.id, { status: 'revoked', status_reason: 'disconnected by the store' });
    await store.logConnectionEvent({ connectionId: conn.id, from: conn.status, to: 'revoked', detail: 'disconnected by the store' });
    await store.audit('ad_connection.revoked', { channelId: channel.id, connectionId: conn.id, providerId: conn.provider_id });
    return res.redirect(`${back}?revoked=1`);
  } catch (err) { return next(err); }
});

// ---------------------------------------------------------------------------
// Unlock API — the browser may only START an unlock
// ---------------------------------------------------------------------------
APP.post('/api/unlock/start', limitUnlock, async (req, res, next) => {
  try {
    const user = req.user;
    if (!user) return requireUser(res);
    res.json(await startUnlock({
      assetId: req.body?.assetId, userId: user.id, providerId: req.body?.providerId,
      personalised: req.consent?.ads === true,
      // The unlock is refused here as well as at the bytes: an ad that will never
      // be honoured is worse than no ad, and this is the only path that can start
      // one.
      country: viewerCountry(req),
    }));
  } catch (err) { next(err); }
});

/*
 * A break inside a file the viewer is already watching.
 *
 * Same shape as the door's start route and deliberately a different endpoint: the
 * two release different things. This one lets the PLAYER move on past a cue; the
 * door releases the bytes. Keeping them apart is what stops a break from ever
 * being mistaken for an unlock — in the routes, in the ledger, and in whatever
 * reads either later.
 */
APP.post('/api/unlock/break', limitUnlock, async (req, res, next) => {
  try {
    const user = req.user;
    if (!user) return requireUser(res);
    if (!isUuid(req.body?.assetId)) {
      return res.status(400).json({ ok: false, error: 'assetId must be a uuid' });
    }
    res.json(await startBreak({
      assetId: req.body.assetId,
      userId: user.id,
      cueIndex: req.body?.cueIndex,
      providerId: req.body?.providerId,
      // A break asks the network for a view on a file the viewer already has, so
      // the consent question is the same one the door asks and it gets the same
      // answer. Passing it here is what keeps the break from being the quieter
      // route around a refusal.
      personalised: req.consent?.ads === true,
    }));
  } catch (err) { next(err); }
});

/*
 * ── The live state, as the player polls it (§14.3) ─────────────────────────
 *
 * Every ~15 seconds, and the answer is `liveState()` — the SAME composition the page
 * was rendered from, so the page and the poller cannot draw two different pictures.
 * Nothing here grants anything: it says whether a break is running, whether this
 * viewer still owes a view for it, and whether the door is open because the store's
 * own break is paying for newcomers. The view itself is started and credited exactly
 * like every other view in this product.
 */
APP.get('/api/live/:assetId/state', async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ ok: false, error: 'sign in' });
    const asset = await store.assetById(req.params.assetId);
    if (!asset) return res.status(404).json({ ok: false, error: 'asset not found' });
    if (await store.shapeOf(asset) !== 'stream') {
      return res.status(404).json({ ok: false, error: 'this file is not a live stream' });
    }
    const breaks = await store.liveBreaksOf(asset.id);
    const cleared = await store.clearedGates(req.user.id, asset.id);
    // The same rule the page uses for the door. A member's file is decided by the
    // page; this route only ever answers for a page that drew the live stage.
    const unlocked = ['open', 'breaks'].includes(asset.unlock_mode)
      || await store.isUnlocked(asset.id, req.user.id);
    const state = liveState({ breaks, cleared, unlocked, now: new Date() });
    // Where this person is on the blocker ladder FOR THIS FILE, from the same count the
    // door reads — and with the live tail of the rung attached, so the sentence a viewer
    // reads after a failed break is the module's own words rather than the client's.
    // Decided here for the same reason the door's rung is decided on the server: the
    // harsh end must not depend on a browser believing anything.
    const attempts = await store.blockSignalCount({
      assetId: asset.id, userId: req.user.id, hours: SIGNAL_WINDOW_HOURS,
    });
    const rung = rungFor(attempts);
    res.json({
      ok: true,
      ...state,
      cleanEntry: cleanEntrySentence(state.coverageUntil, new Date()),
      rung: {
        key: rung.key,
        headline: rung.headline,
        body: rung.body,
        player: playerWords(rung),
        offersUnlock: rung.offersUnlock,
        attempts,
      },
    });
  } catch (err) { next(err); }
});

/*
 * Start the view a break asks for.
 *
 * The body names a BREAK, not a cue index: there is no cue list for a live file to
 * index into (rule 4 keeps one out of the catalogue), so the only thing that can
 * produce an ask is a row the store's own POST created. A hand-crafted body naming a
 * window that never existed is refused by `startLiveView`, and one naming a window
 * this person already sat through is refused too — no second serving of the same view.
 */
APP.post('/api/live/:assetId/view', limitUnlock, async (req, res, next) => {
  try {
    if (!req.user) return requireUser(res);
    if (!isUuid(req.body?.breakId)) {
      return res.status(400).json({ ok: false, error: 'breakId must be a uuid' });
    }
    res.json(await startLiveView({
      assetId: req.params.assetId,
      userId: req.user.id,
      breakId: req.body.breakId,
      providerId: req.body?.providerId,
      personalised: req.consent?.ads === true,
    }));
  } catch (err) { next(err); }
});

/**
 * A rewarded view that did not arrive.
 *
 * The client knows two things the server cannot: that the ad script never started,
 * and that it gave up waiting. It sends ONE of those as a signal; the server
 * decides what it means. Nothing here is trusted for access — a signal can only
 * ever REDUCE what is offered, never grant an unlock, so a forged one is a person
 * hurting only their own session.
 */
APP.post('/api/unlock/blocked', limitUnlock, async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ ok: false, error: 'sign in' });
    const asset = await store.assetById(req.body.assetId);
    if (!asset) return res.status(404).json({ ok: false, error: 'no such file' });
    const signal = signalFrom(req.body.signal);
    const view = req.body.viewId ? await store.pendingView(String(req.body.viewId)) : null;
    // A view that actually completed is not a blocked attempt, whatever the client
    // says: the postback is the authority on whether the ad was watched.
    if (view?.completed) return res.json({ ok: true, ignored: 'the view completed' });

    await store.recordBlockSignal({
      assetId: asset.id,
      channelId: asset.channel_id,
      userId: req.user.id,
      pendingViewId: view?.id ?? null,
      signal,
    });
    const attempts = await store.blockSignalCount({
      assetId: asset.id, userId: req.user.id, hours: SIGNAL_WINDOW_HOURS,
    });
    const rung = rungFor(attempts);
    // Both tails, for the same reason the stage carries one: whatever surface made the
    // report should be able to say the rung's own sentence without a reload. It was
    // sending neither, so a live poll's third failure printed the rung the PAGE had been
    // rendered with rather than the one this answer just computed.
    return res.json({
      ok: true,
      attempts,
      rung: {
        key: rung.key,
        headline: rung.headline,
        body: rung.body,
        player: playerWords(rung),
        reader: readerWords(rung),
        offersUnlock: rung.offersUnlock,
      },
    });
  } catch (err) { return next(err); }
});

APP.get('/api/unlock/status', async (req, res, next) => {
  try {
    const user = req.user;
    if (!user) return requireUser(res);
    // Validate at the boundary. A client that sends an empty or malformed id is
    // making a bad request, and a bad request deserves 400 — not a 500 that
    // buries a real bug in DB errors and teaches the client to retry forever.
    if (!isUuid(req.query.assetId)) {
      return res.status(400).json({ ok: false, error: 'assetId must be a uuid' });
    }
    if (req.query.viewId && !isUuid(req.query.viewId)) {
      return res.status(400).json({ ok: false, error: 'viewId must be a uuid' });
    }
    res.json(await unlockStatus({
      assetId: req.query.assetId, userId: user.id, viewId: req.query.viewId,
    }));
  } catch (err) { next(err); }
});

/*
 * The length a player measured.
 *
 * Slice 3 needs a runtime before it can place a break, and both easier answers
 * were refused: an `ffprobe` dependency on the server (a second media stack to
 * keep working, for a number a browser already knows), and a box for the seller
 * to type minutes into (the same mistake the ask ladder exists to fix).
 *
 * So the player reports it. Anyone who can play the file at all may report — a
 * member, an unlocked viewer, a visitor on an open file — because the number is a
 * fact about the file rather than about the reporter, and requiring a role would
 * mean the demo's files never get one. What it is not is trusted for money: the
 * plan decides where breaks go, not how much the file asks for, and the ask is
 * derived from the seller's own value either way. A wrong figure costs the seller
 * at worst a badly placed break on their own file, and the seller's page prints
 * the number so they can see it.
 */
APP.post('/api/assets/:assetId/runtime', limitWatch, async (req, res, next) => {
  try {
    const user = req.user;
    if (!user) return requireUser(res);
    if (!isUuid(req.params.assetId)) {
      return res.status(400).json({ ok: false, error: 'assetId must be a uuid' });
    }
    const asset = await store.assetById(req.params.assetId);
    if (!asset) return res.status(404).json({ ok: false, error: 'asset not found' });
    // Only for something with a playhead. An image set has no duration, and a
    // "measured" 4,000 seconds on one would move every break in it.
    const secs = measuredSeconds(req.body?.durationSec);
    if (secs === null) {
      return res.status(400).json({ ok: false, error: `durationSec must be between 1 and ${MAX_RUNTIME_SEC}` });
    }
    // Asked again on every page load, so "already known" is the ORDINARY answer and
    // it is a success. It used to fall through the same `null` as a bad number and
    // came back 400 — a failed request in every viewer's console, for a fact the
    // server already had.
    const row = await store.reportRuntime(asset.id, secs);
    if (!row) return res.json({ ok: true, changed: false });
    res.json({ ok: true, runtimeSec: row.runtime_sec, changed: true });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// THE POSTBACK ENDPOINT — the trust boundary.
//
// Routed by CONNECTION, not just provider: two channels can both use BitLabs
// with two different app secrets, so the URL has to say which one this callback
// is for. A provider-only URL would force us to try every secret until one
// verified, turning our own endpoint into a signature oracle.
//
// `all` rather than `post`: BitLabs, PubScale and AppLixir all send GET.
// ---------------------------------------------------------------------------
APP.all('/api/ads/postback/:providerId/:connectionId', limitPostback, async (req, res, next) => {
  try {
    const { providerId, connectionId } = req.params;
    const result = await handlePostback({
      providerId,
      connectionId,
      ctx: {
        method: req.method,
        // The bytes as received. Adapters that sign a URL must hash this
        // verbatim — rebuilding it from req.query reorders and re-encodes
        // parameters and breaks every signature the provider sends.
        rawUrl: req.originalUrl,
        rawBody: req.rawBody || '',
        query: req.query || {},
        body: req.body || {},
        headers: req.headers,
      },
    });
    // A duplicate must be 2xx: PubScale retries 6 times on non-2xx, so answering
    // 409 to a retry would produce six more retries and an eventual failure.
    res.status(result.ok ? 200 : (result.status || 400)).json(result);
  } catch (err) {
    // A postback that 500s gets retried. Answer 200 for anything we have
    // already decided about, and let the real errors surface in logs only.
    console.error('[postback] unhandled', req.params.providerId, err.message);
    res.status(500).json({ ok: false, error: 'internal error' });
  }
});

// ---------------------------------------------------------------------------
// DEV ONLY — plays each ad network in ITS OWN dialect.
//
// The whole point of the adapter layer is that providers disagree. A simulator
// that signed everything our way would prove the loop works and prove nothing
// about the code that has to talk to BitLabs. So each branch signs exactly as
// that provider documents, and delivery is real HTTP server-to-server.
// ---------------------------------------------------------------------------
const devOnly = (req, res, next) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({ ok: false, error: 'dev endpoint disabled' });
  }
  next();
};

APP.post('/dev/simulate-network/:providerId', devOnly, async (req, res, next) => {
  try {
    const providerId = req.params.providerId;
    const { viewId, connectionId, durationSec, externalId: txOverride } = req.body || {};
    const duration = durationSec || 5;
    // Providers retry on non-2xx (PubScale six times). Sending the SAME
    // transaction id twice is the only way to prove the duplicate path is
    // idempotent rather than merely looking like it in the code.
    const externalId = txOverride || 'sim_' + crypto.randomBytes(8).toString('hex');

    const conn = await store.connectionById(connectionId);
    if (!conn) return res.status(404).json({ ok: false, error: 'unknown connectionId' });
    const base = conn.callback_base_url || `http://127.0.0.1:${PORT}`;
    const secret = conn.callback_secret;
    if (!secret) return res.status(400).json({ ok: false, error: 'connection has no callback secret' });

    // The identity the network knows us by is our opaque uuid4 ref, not a user id.
    const view = await store.pendingView(viewId);
    const adRef = view ? await store.adRefFor(view.user_id) : null;
    const path_ = `/api/ads/postback/${encodeURIComponent(providerId)}/${encodeURIComponent(connectionId)}`;

    let url;
    let init;

    if (providerId === 'bitlabs') {
      const params = new URLSearchParams({
        uid: adRef, tx: externalId, val: '100', raw: '0.004',
        s1: viewId, offer_state: 'COMPLETED', country: 'NP',
      });
      const signedUrl = `${base}${path_}?${params}`;
      const hash = crypto.createHmac('sha1', secret).update(signedUrl, 'utf8').digest('hex');
      url = `${signedUrl}&hash=${hash}`;
      init = { method: 'GET' };
    } else if (providerId === 'pubscale') {
      const token = externalId;
      const value = 1.9; // deliberately non-integer: their rule truncates it
      const signature = crypto.createHash('md5')
        .update(`${secret}.${adRef}.${Math.trunc(value)}.${token}`, 'utf8').digest('hex');
      url = `${base}${path_}?${new URLSearchParams({ user_id: adRef, value: String(value), token, signature })}`;
      init = { method: 'GET' };
    } else if (providerId === 'applixir') {
      // Signature below is deliberately wrong: our Applixir adapter ships a
      // placeholder template and fails closed. Seeing the rejection is the
      // feature working.
      const params = new URLSearchParams({
        userId: adRef, custom: viewId || '', revenue: '0.004',
        signature: crypto.createHash('md5').update(`${secret}.nope`, 'utf8').digest('hex'),
      });
      url = `${base}${path_}?${params}`;
      init = { method: 'GET' };
    } else {
      const payload = { viewId, externalId, userId: adRef, completed: true, durationSec: duration, revenueUsd: 0.004 };
      const rawBody = JSON.stringify(payload);
      const { timestamp, signature } = signHousePostback(rawBody);
      url = `${base}${path_}`;
      init = {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-bb-timestamp': timestamp, 'x-bb-signature': signature },
        body: rawBody,
      };
    }

    const r = await fetch(url, init);
    const json = await r.json().catch(() => ({ ok: false }));
    res.status(r.status).json({ ...json, delivered: true, signed: true, dialect: providerId, method: init.method });
  } catch (err) { next(err); }
});

// A tampered postback, so the rejection path is demonstrable rather than claimed.
APP.post('/dev/forge-postback/:providerId', devOnly, async (req, res, next) => {
  try {
    const providerId = req.params.providerId;
    const { viewId, connectionId } = req.body || {};
    const conn = connectionId ? await store.connectionById(connectionId) : null;
    const base = conn?.callback_base_url || `http://127.0.0.1:${PORT}`;
    const path_ = `/api/ads/postback/${encodeURIComponent(providerId)}/${encodeURIComponent(connectionId || 'unknown')}`;

    // Correct shape, correct params, correctly-formed hash — signed with the
    // WRONG SECRET. This is the forgery that looks most convincing.
    const params = new URLSearchParams({
      uid: '00000000-0000-4000-8000-000000000000', tx: 'forged_tx',
      val: '100', s1: viewId || '', offer_state: 'COMPLETED',
    });
    const forged = crypto.createHmac('sha1', 'not-the-real-secret')
      .update(`${base}${path_}?${params}`, 'utf8').digest('hex');
    const r = await fetch(`${base}${path_}?${params}&hash=${forged}`, { method: 'GET' });
    res.status(r.status).json({ ...(await r.json().catch(() => ({ ok: false }))), forged: true });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Content delivery — signed, expiring, per-user
//
// ONE trust boundary for both routes below. Playback and download differ in what
// they send (inline vs attachment, ranged vs whole, watermarked vs not) and must
// never differ in who is allowed: two copies of an authorisation check is how a
// hole gets opened in one and forgotten in the other.
// ---------------------------------------------------------------------------

/**
 * Check the token, the session, the matching account, the unlock and the file.
 *
 * Returns `{ asset, file, userId }`, or `null` after having already written the
 * refusal — callers only have to handle the success path.
 */
async function resolveContentRequest(req, res, { event }) {
  // The token is necessary but NOT sufficient.
  //
  // Alone it is a bearer credential: anyone the link reaches can use it inside
  // its window, which directly contradicts what the page promises ("They cannot
  // be forwarded"). So the session has to match the account the link was minted
  // for. Now forwarding a link is useless — the recipient is not signed in as
  // the buyer, and signing in as them requires their password.
  if (!req.user) {
    await store.audit('content.denied', { reason: 'not signed in', assetId: req.params.assetId });
    res.status(401).json({ ok: false, error: 'sign in to view this file' });
    return null;
  }

  const check = verifyAccessToken(req.query.t);
  if (!check.ok) {
    await store.audit('content.denied', { reason: check.reason, assetId: req.params.assetId });
    res.status(403).json({ ok: false, error: check.reason });
    return null;
  }
  const { a, f, u } = check.payload;
  if (u !== req.user.id) {
    // The actor here is the account presenting the token — that is the person
    // doing something — while the token's owner is the subject of the refusal.
    await store.audit('content.denied', {
      reason: 'token belongs to another account', assetId: a, userId: req.user.id, tokenOwnerId: u,
    }, { actorId: req.user.id, subjectType: 'profile', subjectId: u });
    res.status(403).json({ ok: false, error: 'this link was issued to a different account' });
    return null;
  }

  /**
   * Free files get an unlock row on first fetch, rather than a special case here.
   *
   * The asset page mints a link for an `open` asset without an ad, so no unlock
   * row existed and this check refused every free file with "unlock no longer
   * valid" — the free half of the product was broken while the paid half worked,
   * which is the kind of bug that survives a demo.
   *
   * The alternative was a flag in the signed token saying "this one is open",
   * which would put a permission decision inside a credential the holder can
   * replay, and would need re-checking against the asset anyway. Writing the
   * entitlement instead keeps ONE rule at the trust boundary: the row exists or
   * it does not. It also means someone who played a free file can review it,
   * because reviews hang off unlocks.
   */
  const asset = await store.assetById(a);
  if (!asset) { res.status(404).json({ ok: false, error: 'file not found' }); return null; }
  // A free file hands out an unlock row on first fetch — but not a file that is
  // paused or hidden pending review. Without this line, hiding a free file
  // changed only what the storefront showed: the file itself kept being served
  // to anyone who had the URL, which is the opposite of the promise.
  //
  // Someone who already holds an unlock keeps it: the check below is on NEW
  // grants, and `isUnlocked` is consulted first.
  // `breaks` is free to open with views inside it: the door does not charge, and
  // what the breaks gate is the PLAYER, not the bytes (migration 0038, decision 2).
  // So it is granted exactly like a free file, and no break can ever be the thing
  // between somebody and content they would otherwise have to pay for.
  if (['open', 'breaks'].includes(asset.unlock_mode) && asset.status === 'live' && !await store.isUnlocked(a, u)) {
    await store.grantUnlock({
      assetId: a, channelId: asset.channel_id, userId: u, method: 'open', adsCompleted: 0,
      policy: { unlock_hours: 0 },   // free access does not expire
    });
    await store.audit('content.free_grant', { assetId: a, userId: u },
      { actorId: u, subjectType: 'asset', subjectId: a });
  }
  /**
   * A member's first fetch of a members-only file writes the unlock, exactly the
   * way a free file does above — same one-rule boundary, a row that exists or a
   * refusal. The row carries the MEMBERSHIP's period end as its expiry, so the
   * file closes when the dues period does and no job has to remember anything.
   *
   * The membership is re-checked here rather than trusted from the page: a token
   * minted while the dues were current must stop working the moment they are not,
   * which is this line and the `isUnlocked` below it.
   */
  if (asset.unlock_mode === 'members' && asset.status === 'live' && !await store.isUnlocked(a, u)) {
    const membership = await store.memberCoversAsset({
      profileId: u, channelId: asset.channel_id, asset,
    });
    if (membership) {
      await store.grantMembershipUnlock({
        assetId: a, channelId: asset.channel_id, userId: u, expiresAt: membership.period_end,
      });
      await store.audit('content.membership_grant', {
        assetId: a, userId: u, tierNo: membership.tier_no, periodEnd: membership.period_end,
      }, { actorId: u, subjectType: 'asset', subjectId: a });
    }
  }
  if (a !== req.params.assetId || f !== req.params.fileId) {
    res.status(403).json({ ok: false, error: 'token does not match this file' });
    return null;
  }
  // Re-check the unlock: a token minted before a revoke must not keep working.
  if (!await store.isUnlocked(a, u)) {
    res.status(403).json({ ok: false, error: 'unlock no longer valid' });
    return null;
  }

  const file = await store.fileById(f);
  if (!file) { res.status(404).json({ ok: false, error: 'file not found' }); return null; }

  // The check that matters most: a token proves an unlock, and an unlock in one
  // country does not carry into a country the file is withheld from.
  const channel = await store.channelById(asset.channel_id);
  const privileged = channel?.owner_id === u || req.user.role === 'admin';
  const refusal = privileged ? null : await countryRefusalFor(asset, viewerCountry(req));
  if (refusal) {
    await store.audit('content.denied', {
      reason: refusal.availability.reason === 'file' ? 'file not unlockable' : 'country rule',
      assetId: a, fileId: f, userId: u, country: refusal.country,
    }, { actorId: u, subjectType: 'asset', subjectId: a });
    res.status(refusal.status).json({
      ok: false,
      error: refusal.sentence.headline,
      why: refusal.sentence.why,
      country: refusal.country,
      unavailableFor: refusal.availability.reason,
    });
    return null;
  }

  await store.audit(event, { assetId: a, fileId: f, userId: u },
    { actorId: u, subjectType: 'asset', subjectId: a });
  return { asset, file, userId: u };
}

/**
 * The KIND of source behind the stream route, for a page about to render a player.
 *
 * Asked at render time and only for files whose bytes are not ours, because the
 * player must choose a demuxer before it has a URL (`views.js mediaStage`). A host
 * that cannot answer must not take the page down with it: the file page renders
 * with no kind, the element plays whatever the redirect returns, and a genuinely
 * broken source ends as the player's own error rather than as a 500 on the file
 * page. `playbackCached` is what keeps this from being a host call per view.
 */
async function hostedSourceKind(files = []) {
  const remote = (files || []).find((f) => storage.isRemote(f.storage_key));
  if (!remote) return null;
  try {
    const { playbackCached } = await import('./src/video.js');
    // The key says which host holds the bytes; the configured driver is irrelevant here.
    const found = await playbackCached(storage.remoteId(remote.storage_key), {
      provider: storage.remoteProvider(remote.storage_key),
    });
    return found.kind;
  } catch (err) {
    // Logged, not thrown. The sentence a viewer would see from a 500 here is about
    // us; the one they see from the player is about the file.
    console.warn(`[video] cannot resolve the source kind for ${remote.storage_key}: ${err.message}`);
    return null;
  }
}

/**
 * Where a file's bytes actually come from — and the one place that decides it.
 *
 * Two possible answers, and the difference is the whole point of the video host
 * (`VIDEO_STORAGE.md` §1): a LOCAL key is read from this disk exactly as it always
 * was, and a REMOTE key becomes a redirect to the host, whose own playback url is
 * minted per open. The door runs before this in both cases and does not know the
 * difference, which is what keeps the unlock ladder, the memberships and the break
 * gate working on a file whose bytes are somebody else's.
 *
 * A host that cannot answer is a 502 with a sentence rather than a stack trace: the
 * viewer's player is going to show an error either way, and only one of the two
 * tells them it is not their connection.
 */
async function resolveBytes(file, req, res) {
  if (!storage.isRemote(file.storage_key)) {
    return { buf: await storage.get(file.storage_key) };
  }
  const id = storage.remoteId(file.storage_key);
  try {
    const { playback } = await import('./src/video.js');
    const found = await playback(id, { provider: storage.remoteProvider(file.storage_key) });
    return { redirect: found };
  } catch (err) {
    if (err.name === 'VideoApiError') {
      res.status(502).json({
        ok: false,
        error: 'the file\u2019s host did not answer',
        detail: err.message,
      });
      return null;
    }
    throw err;
  }
}

/**
 * Serve bytes with HTTP Range support.
 *
 * A player with no `206` cannot seek: it has to fetch from zero every time the
 * user drags the scrubber, which on a long video is the difference between a
 * product and a toy. `bytes=start-end`, open-ended `bytes=start-` and suffix
 * `bytes=-n` are all handled, and an unsatisfiable range answers `416` with the
 * size — which is what makes Safari's first probe behave.
 */
function sendRanged(req, res, buf, { type, filename, disposition = 'inline' }) {
  const total = buf.length;
  res.setHeader('accept-ranges', 'bytes');
  res.setHeader('content-type', type);
  res.setHeader('content-disposition', `${disposition}; filename="${String(filename).replace(/["\\]/g, '')}"`);
  // Private and unstorable: this URL is minted for one account and must never
  // sit in a shared cache or a disk cache the next user can read.
  res.setHeader('cache-control', 'private, no-store');

  const r = rangeFor(req.headers.range, total);
  const wantsBody = req.method !== 'HEAD';

  if (r.kind === 'unsatisfiable') {
    res.setHeader('content-range', `bytes */${total}`);
    return res.status(416).end();
  }
  if (r.kind === 'full') {
    res.setHeader('content-length', String(total));
    return res.status(200).end(wantsBody ? buf : undefined);
  }

  const slice = buf.subarray(r.start, r.end + 1);
  res.setHeader('content-range', `bytes ${r.start}-${r.end}/${total}`);
  res.setHeader('content-length', String(slice.length));
  return res.status(206).end(wantsBody ? slice : undefined);
}

/**
 * The asset as data.
 *
 * The page mints its content URLs while rendering HTML, which is fine for a
 * browser and useless for an app: the Android client has no HTML to parse, and
 * this endpoint is the difference between "the app calls an API that exists" and
 * "the app calls an API I once imagined". Everything it returns is minted here,
 * per request, per account — same token machinery, same unlock check, so the app
 * cannot obtain anything a browser could not.
 */
// ---------------------------------------------------------------------------
// The reader — a page at a time, and the seam where a view is asked for
// ---------------------------------------------------------------------------
//
// §13's surface. The route asks the FILE page's questions in the same order — the
// store, the file, whether this viewer may see it, the country, and whether they can
// open it at all — because a second way into the same bytes is a second place the
// answer can be wrong. When the answer is "not unlocked", the reader sends them to
// the file page rather than rendering a door of its own: there is one door in this
// product, and it is on the page that states the ask.
//
// The step is a query parameter rather than a path segment so that a reader who
// stops mid-chapter has a URL a person can paste, and so `?p=1` is the same page as
// no parameter at all.

/** The reader's own view of a file: what it is, and where this person is in it. */
async function readerContext(req, res) {
  const channel = await store.channelBySlug(req.params.slug);
  if (!channel) { res.status(404).send('Channel not found'); return null; }
  if (!isPublicChannel(channel) && !maySeeHidden(req, channel)) {
    res.status(404).send('Channel not found');
    return null;
  }
  const asset = await store.assetBySlug(channel.id, req.params.assetSlug);
  if (!asset) { await notFoundPage(req, res, 'file'); return null; }

  const holdsUnlock = req.user ? await store.isUnlocked(asset.id, req.user.id) : false;
  if (!maySeeHiddenFile({ asset, user: req.user, ownerId: channel.owner_id, holdsUnlock })) {
    await notFoundPage(req, res, 'file');
    return null;
  }
  const maySeeEverything = Boolean(req.user)
    && (req.user.id === channel.owner_id || req.user.role === 'admin');
  if (!isAssetPublic(asset.moderation_state) && !maySeeEverything && !holdsUnlock) {
    await notFoundPage(req, res, 'file');
    return null;
  }

  const country = viewerCountry(req);
  const countryRule = country ? (await store.countryRulesFor([asset.id], country))[0] ?? null : null;
  const channelBlock = await store.channelCountryBlock(channel.id, country);
  const resolved = resolveCountry({ assetRule: countryRule, channelBlock });
  const availability = availabilityFor({ assetState: asset.moderation_state, resolved });
  if (!availability.visible && !maySeeEverything) {
    const rules = await store.policyRules();
    countryDependent(res);
    res.status(blockStatus(resolved) ?? 451).send(views.countryBlocked({
      user: req.user, consent: null, country, store: channel, asset,
      sentence: blockSentence({
        resolved, rule: ruleFor(rules, resolved.ruleCode), store: channel.name, country,
      }),
    }));
    return null;
  }

  const memberDoor = req.user
    ? await store.memberDoorFor({ profileId: req.user.id, channelId: channel.id, asset })
    : { door: 'none', membership: null };
  const memberCover = memberDoor.door === 'covered' ? memberDoor.membership : null;
  const unlocked = (['open', 'breaks'].includes(asset.unlock_mode) || holdsUnlock || Boolean(memberCover))
    && availability.unlockable;

  const files = await store.filesOf(asset.id);
  const plan = await store.assetPagePlan(asset, files);
  return { channel, asset, files, plan, unlocked, holdsUnlock, memberCover, country };
}

APP.get('/s/:slug/a/:assetSlug/read', async (req, res, next) => {
  try {
    const ctx = await readerContext(req, res);
    if (!ctx) return undefined;
    const { channel, asset, files, plan, unlocked } = ctx;
    const base = `/s/${encodeURIComponent(channel.slug)}/a/${encodeURIComponent(asset.slug)}`;
    // Nothing to read, or nothing this person may read yet: the file page is where
    // both are explained, and it is where the one door in this product lives.
    if (!plan.chapters || !unlocked) return res.redirect(base);

    const rowsById = new Map(files.map((f) => [f.id, f]));
    const placement = asset.unlock_mode === 'breaks'
      ? await store.adPlanFor(asset, { membersOnly: asset.unlock_mode === 'members' })
      : null;
    const cues = asset.unlock_mode === 'breaks' ? betweenCues(placement ?? {}) : [];
    const { segments } = segmentsFor(plan, cues);
    // Cleared seams, by the planner's own cue index — `pending_views.break_index` is
    // what a claimed view records, and comparing it to a segment's position would
    // break the moment a seller edited their plan.
    const cleared = new Set(await store.clearedGates(req.user?.id ?? null, asset.id));
    const owedBefore = (n) => gatesBefore(segments, n).filter((g) => !cleared.has(Number(g.index)));

    const last = plan.steps.length;
    const requested = Number.parseInt(req.query.p ?? '', 10);
    const start = Number.isInteger(requested) && requested >= 1 ? Math.min(requested, last) : 1;
    const mode = readMode(asset.read_mode);
    const direction = readDirection(asset.read_direction);

    // Every byte of content in this product is minted for an account, and the reader
    // is not an exception: a page URL has to know whose bookmark it belongs to. The
    // file page says the same thing in its own words ("unlocks are tied to your
    // account"), so this is the same rule rather than a new one.
    const signedIn = Boolean(req.user);

    const segment = segmentFor(segments, start) ?? segments[segments.length - 1];
    // A step that owes a seam is not drawn AT ALL: no URL is minted for it, which is
    // what makes the veil more than a picture. The refusal in the byte route is the
    // second half of the same rule — arriving here by a pasted URL shows the ask, and
    // taking the URL apart and fetching the page directly gets a 403.
    const owedHere = signedIn ? owedBefore(start) : [];
    const windowEnd = mode === 'scroll' && !owedHere.length ? segment.to : start;
    const items = [];
    if (signedIn && !owedHere.length) {
      for (let n = start; n <= windowEnd; n += 1) {
        const step = plan.steps[n - 1];
        const file = rowsById.get(step.fileId);
        items.push({
          n,
          url: file && step.drawable
            ? issuePageUrl({ assetId: asset.id, file, userId: req.user.id, step: n, basePath: '' })
            : null,
          alt: `${stepLabel(plan, n)}${step.entryName ? ` — ${step.entryName}` : ''}`,
          caption: step.kind === 'archive' && step.entryName ? step.entryName : '',
        });
      }
    }

    // The seam, two ways round: the page AFTER this window may owe a view, and the
    // page we are ON may owe one (a deep link, or a back button into a segment that
    // was never paid for). Both render the same ask; only where it leads differs.
    const after = windowEnd + 1;
    const owedNext = signedIn && after <= last ? owedBefore(after) : [];
    const gateCue = owedHere[0] ?? owedNext[0] ?? null;
    const retrySame = Boolean(owedHere.length);
    /*
     * The blocker ladder, on the surface where the wall is the BYTES rather than a
     * button (§14.7). A seam this person may not pass and an ask that has failed six
     * times is not a question worth asking a seventh time: the panel says what the
     * ladder says and stops offering the button. What still works is everything the
     * door's rung leaves working — the file page, every page already read, the rest of
     * the store — and the count passes on its own.
     */
    const readerRung = req.user && gateCue
      ? await (async () => {
        const attempts = await store.blockSignalCount({
          assetId: asset.id, userId: req.user.id, hours: SIGNAL_WINDOW_HOURS,
        });
        const rung = rungFor(attempts);
        return {
          ...rung,
          player: playerWords(rung),
          // A reader loses something a player does not (§14.7): the seam is the only way
          // to the pages behind it, so the withheld rung has words of its own for it.
          reader: readerWords(rung),
          attempts,
          hasMembers: (await store.membershipTiers(channel.id)).length > 0,
        };
      })()
      : null;
    const gate = gateCue
      ? {
        cueIndex: gateCue.index,
        sentence: gateSentence(plan, gateCue),
        seconds: Number(placement?.budget?.seconds) || 15,
        nextHref: `${base}/read?p=${retrySame ? start : after}`,
        blockRung: readerRung,
      }
      : null;

    const prevHref = start > 1 ? `${base}/read?p=${start - 1}` : null;
    // A gated reader gets the ask INSTEAD of a link that the byte route would refuse:
    // the rule is enforced twice, once so the page never offers a dead end, and once
    // so the dead end cannot be walked around.
    const nextHref = gate
      ? null
      : (after <= last ? `${base}/read?p=${mode === 'scroll' ? windowEnd : after}` : null);

    const step = plan.steps[start - 1];
    const refusal = step.kind === 'file'
      ? {
        sentence: plan.refusals.find((r) => r.fileId === step.fileId)?.sentence
          || 'This reader draws image sets and archives of images. Download this file and use your own app.',
      }
      : null;
    const downloadUrl = step.kind === 'file' && req.user
      ? issueDownloadUrl({ assetId: asset.id, file: rowsById.get(step.fileId), userId: req.user.id, basePath: '' })
      : null;

    const progress = req.user ? await store.readingProgress(req.user.id, asset.id) : null;
    await store.bumpPageView(channel.id);
    if (req.user) await store.markChannelSeen(req.user.id, channel.id);

    res.send(views.layout({
      title: `${asset.title} — ${stepLabel(plan, start)}`,
      user: req.user, consent: req.consent, current: 'marketplace',
      body: views.readerPage({
        channel, asset, user: req.user,
        label: stepLabel(plan, start),
        mode, direction,
        items, current: start, total: last,
        prevHref, nextHref,
        gate,
        refusal: owedHere.length ? null : refusal,
        downloadUrl,
        signin: signedIn
          ? null
          : { href: `/login?next=${encodeURIComponent(`${base}/read?p=${start}`)}` },
        resume: progress && Number(progress.step) !== start
          ? {
            label: stepLabel(plan, Number(progress.step)) || `page ${progress.step}`,
            href: `${base}/read?p=${progress.step}`,
          }
          : null,
        assetUrl: base,
      }),
    }));
  } catch (err) { next(err); }
});

/**
 * Recording where somebody stopped.
 *
 * A page CHANGE, never a render: the client posts this when the step it is showing is
 * a different step from the one it last told us about, which is why the beacon is
 * wired to the page's identity rather than to its load event. The answer is what was
 * stored, so a client cannot believe it moved something it did not.
 */
/**
 * Where the player is, reported by the player.
 *
 * The reader's position in the shape video needs (§15.2), and it carries the same three
 * promises: the store is never shown it (no seller query reads `watch_progress`), no
 * accounting path reads it (a credited view comes from the network's signed postback,
 * and a client claiming a position cannot move a ledger row), and writing the same
 * position twice writes nothing — "where they are" and "when a request arrived" are
 * different questions, and only the first is worth an answer.
 *
 * Only a file with a playhead takes one: a position on an image set or a download would
 * be a number with nothing behind it.
 */
APP.post('/api/watch/progress', limitWatch, async (req, res, next) => {
  try {
    if (!req.user) return requireUser(res);
    const assetId = req.body?.assetId;
    if (!isUuid(assetId)) return res.status(400).json({ ok: false, error: 'assetId must be a uuid' });
    const asset = await store.assetById(assetId);
    if (!asset) return res.status(404).json({ ok: false, error: 'file not found' });
    const shape = await store.shapeOf(asset);
    if (!SERIES_SHAPES.includes(shape)) {
      return res.status(400).json({ ok: false, error: 'that file has no playhead' });
    }
    const seconds = Math.floor(Number(req.body?.seconds));
    if (!Number.isFinite(seconds) || seconds < 0 || seconds > WATCH_MAX_SECONDS) {
      return res.status(400).json({ ok: false, error: `seconds must be between 0 and ${WATCH_MAX_SECONDS}` });
    }
    const saved = await store.saveWatchProgress({ userId: req.user.id, assetId, seconds });
    // `saved` is null when the position did not move, which is not a failure: it is the
    // write that correctly did nothing, the way the reader's own page change does.
    return res.json({ ok: true, seconds: saved ? Number(saved.position_sec) : seconds, changed: Boolean(saved) });
  } catch (err) { return next(err); }
});

APP.post('/api/reading/progress', async (req, res, next) => {
  try {
    if (!req.user) return requireUser(res);
    const assetId = req.body?.assetId;
    if (!assetId) return res.status(400).json({ ok: false, error: 'no file' });
    const asset = await store.assetById(assetId);
    if (!asset) return res.status(404).json({ ok: false, error: 'file not found' });
    const plan = await store.assetPagePlan(asset);
    const step = Number(req.body?.step);
    if (!Number.isInteger(step) || step < 1 || step > plan.chapters) {
      return res.status(400).json({ ok: false, error: 'no such page in this file' });
    }
    const saved = await store.saveReadingProgress({ userId: req.user.id, assetId, step });
    // `saved` is null when the step did not change, which is not a failure: it is the
    // write that correctly did nothing.
    return res.json({ ok: true, step: saved ? saved.step : step, changed: Boolean(saved) });
  } catch (err) { return next(err); }
});

APP.get('/api/content/:assetId', async (req, res, next) => {
  try {
    if (!req.user) return requireUser(res);

    const asset = await store.assetById(req.params.assetId);
    if (!asset) return res.status(404).json({ ok: false, error: 'asset not found' });

    const channel = await store.channelById(asset.channel_id);
    // A draft is not public. The owner may look at their own; nobody else can.
    if (asset.status !== 'live' && channel?.owner_id !== req.user.id) {
      return res.status(404).json({ ok: false, error: 'asset not found' });
    }

    // The owner and an operator are never refused: they are the two people who
    // can do something about it, and a rule that hides its own reason from them
    // is a rule nobody can appeal.
    const privileged = channel?.owner_id === req.user.id || req.user.role === 'admin';
    const country = viewerCountry(req);
    const refusal = privileged ? null : await countryRefusalFor(asset, country);
    if (refusal) {
      await store.audit('content.denied', {
        reason: refusal.availability.reason === 'file' ? 'file not unlockable' : 'country rule',
        assetId: asset.id, country: refusal.country,
      }, { actorId: req.user.id, subjectType: 'asset', subjectId: asset.id });
      return res.status(refusal.status).json({
        ok: false,
        error: refusal.sentence.headline,
        why: refusal.sentence.why,
        country: refusal.country,
        unavailableFor: refusal.availability.reason,
      });
    }

    const unlocked = ['open', 'breaks'].includes(asset.unlock_mode) || await store.isUnlocked(asset.id, req.user.id);
    const policy = await store.unlockPolicy(asset.id);
    const label = watermarkLabel({ ref: req.user.id, assetId: asset.id });

    const files = (await store.filesOf(asset.id)).map((f) => {
      const kind = mediaKind(f.mime_type, f.filename);
      const inline = isPlayable(f.mime_type, f.filename) || kind === 'image';
      return {
        id: f.id,
        filename: f.filename,
        mimeType: f.mime_type,
        sizeBytes: Number(f.size_bytes),
        kind,
        hosted: storage.isRemote(f.storage_key),
        // The app needs to know which player to open, and whether the bytes it
        // receives will already carry a mark.
        playable: isPlayable(f.mime_type, f.filename),
        marked: kind === 'image',
        streamUrl: unlocked && inline
          ? issueStreamUrl({ assetId: asset.id, file: f, userId: req.user.id, basePath: '' })
          : null,
        downloadUrl: unlocked
          ? issueDownloadUrl({ assetId: asset.id, file: f, userId: req.user.id, basePath: '' })
          : null,
      };
    });

    res.json({
      ok: true,
      asset: {
        id: asset.id, title: asset.title, slug: asset.slug,
        description: asset.description, coverUrl: asset.cover_url,
        unlockMode: asset.unlock_mode, status: asset.status,
        channel: channel ? { slug: channel.slug, name: channel.name } : null,
      },
      viewer: {
        signedIn: true,
        unlocked,
        // The entitlement row, not the asset's policy: what this viewer has.
        expiresAt: unlocked ? (await store.unlockFor(asset.id, req.user.id))?.expires_at ?? null : null,
      },
      policy: {
        adsRequired: policy?.ads_required ?? 1,
        adMinSeconds: policy?.ad_min_seconds ?? 15,
        unlockHours: policy?.unlock_hours ?? 24,
      },
      files,
      // The mark the app draws over playback, so a recording of the screen can
      // be traced to an account. The app cannot burn it into the frames — that
      // needs a transcoder — so it overlays exactly as the web page does.
      mark: { label, overlay: watermarkSvgDataUri(label) },
      // Said once, in the payload, so the client does not have to invent copy
      // about a protection that does not exist.
      protection: {
        screenshotsBlocked: false,
        note: 'Watermarked and traceable. No website or app can stop a screen recording of a video; Android can block screenshots of its own windows only.',
      },
    });
  } catch (err) { next(err); }
});

APP.get('/api/content/:assetId/file/:fileId', async (req, res, next) => {
  try {
    const access = await resolveContentRequest(req, res, { event: 'content.served' });
    if (!access) return undefined;
    const { file, userId } = access;

    // Atomic increment in SQL — not read-modify-write in JS.
    await store.query(
      `update unlocks set download_count = download_count + 1
        where asset_id = $1 and user_id = $2 and revoked_at is null`,
      [req.params.assetId, userId],
    );

    const source = await resolveBytes(file, req, res);
    if (!source) return undefined;
    if (source.redirect) {
      // The host's own URL, announced as a download because this route is the
      // download arm. `no-store` on the redirect so a browser does not keep the
      // decision: the entitlement is checked per request, and a cached 302 would
      // outlive it.
      res.setHeader('cache-control', 'private, no-store');
      return res.redirect(302, source.redirect.url);
    }
    let buf = source.buf;
    let type = file.mime_type || 'application/octet-stream';

    // An image download carries the same mark as the on-page view. One rule
    // instead of two: anything served as pixels can be traced back, so there is
    // no path that quietly hands over an unmarked copy.
    if (isWatermarkable(file.mime_type, file.filename) && await hasImageMagick()) {
      const marked = await watermarked(file, userId, buf);
      if (marked) { buf = marked; type = 'image/jpeg'; }
    }

    res.setHeader('content-type', type);
    res.setHeader('content-disposition', `attachment; filename="${String(file.filename).replace(/["\\]/g, '')}"`);
    res.setHeader('cache-control', 'private, no-store');
    res.send(buf);
  } catch (err) {
    if (err.code === 'ENOENT') return res.status(410).json({ ok: false, error: 'file missing from storage' });
    return next(err);
  }
});

/**
 * The player's source. Same authorisation, different presentation.
 *
 * `inline`, not `attachment`, and ranged — a `<video>` element cannot use a
 * response that is announced as a download.
 */
APP.get('/api/content/:assetId/file/:fileId/stream', async (req, res, next) => {
  try {
    const access = await resolveContentRequest(req, res, { event: 'content.streamed' });
    if (!access) return undefined;
    const { file, userId } = access;

    const source = await resolveBytes(file, req, res);
    if (!source) return undefined;
    if (source.redirect) {
      /*
       * THE PLAYER KEEPS OUR URL IN THE PAGE AND THE BYTES COME FROM THE HOST.
       *
       * A 302 rather than the host's address written into the markup, for three
       * reasons: the entitlement stays checked on every single request instead of
       * once at render time; the browser's Range request is re-issued against the
       * redirect target, so seeking works exactly as it does locally; and the page
       * has one shape of source whatever is behind it.
       *
       * What it costs is stated in VIDEO_STORAGE.md §5 rather than discovered: once
       * the redirect is followed, the URL the browser holds is a bearer, and anyone
       * it is copied to can watch without passing this route.
       */
      res.setHeader('cache-control', 'private, no-store');
      // The kind travels to the page so the player can pick its demuxer instead of
      // guessing from an extension it cannot see behind a redirect (`data-hls`).
      res.setHeader('x-bytebikri-source', source.redirect.kind);
      return res.redirect(302, source.redirect.url);
    }
    let buf = source.buf;
    let type = file.mime_type || 'application/octet-stream';

    if (isWatermarkable(file.mime_type, file.filename) && await hasImageMagick()) {
      const marked = await watermarked(file, userId, buf);
      if (marked) { buf = marked; type = 'image/jpeg'; }
    }

    // No download_count increment here. A seek is not a download, and counting
    // one would make the creator's own numbers nonsense the moment anyone
    // scrubbed through a video.
    return sendRanged(req, res, buf, { type, filename: file.filename });
  } catch (err) {
    if (err.code === 'ENOENT') return res.status(410).json({ ok: false, error: 'file missing from storage' });
    return next(err);
  }
});

/**
 * One page of a reader, as bytes — and the place a gate stops being a picture.
 *
 * §10 is honest about the player's gate: a pause the server releases can be skipped
 * by anyone with devtools, and the only thing the clamp stops is the ordinary way of
 * skipping a break. A reader can do better, and this route is the difference: every
 * page is minted separately, so the answer to "may this person see step 14" is asked
 * before a byte is produced, and the answer is no for as long as the seam at step 13
 * is uncleared. There is no client-side trick that turns a 403 into a page.
 *
 * The rule is read from the same two functions the markup uses — `segmentsFor` and
 * `gatesBefore` — so the veil on the page and the refusal here cannot disagree. A
 * deep link (a pasted URL for page 40) owes EVERY gate before it, not the last one,
 * which is why the check is a list rather than a cursor.
 *
 * An archive page is unpacked from the entry the index points at, in memory, and
 * never written to disk; a plain image is served through the same watermark the
 * stream route applies, because "anything served as pixels can be traced" is a rule
 * about pixels rather than about the download button.
 */
APP.get('/api/content/:assetId/file/:fileId/page/:n', async (req, res, next) => {
  try {
    const access = await resolveContentRequest(req, res, { event: 'content.page_served' });
    if (!access) return undefined;
    const { asset, file, userId } = access;

    const step = Number.parseInt(req.params.n, 10);
    if (!Number.isInteger(step) || step < 1) {
      return res.status(400).json({ ok: false, error: 'no such page in this file' });
    }
    const files = await store.filesOf(asset.id);
    const plan = await store.assetPagePlan(asset, files);
    const item = plan.steps[step - 1];
    if (!item || item.fileId !== file.id) {
      return res.status(404).json({ ok: false, error: 'no such page in this file' });
    }

    // The seam. Only a `breaks` file has gates at all; every other mode carries none,
    // and `betweenCues` of an empty plan is an empty list rather than a special case.
    if (asset.unlock_mode === 'breaks') {
      const placement = await store.adPlanFor(asset, { membersOnly: false });
      const { segments } = segmentsFor(plan, betweenCues(placement ?? {}));
      const owed = gatesBefore(segments, step);
      if (owed.length) {
        const cleared = new Set(await store.clearedGates(userId, asset.id));
        const missing = owed.find((gate) => !cleared.has(Number(gate.index)));
        if (missing) {
          // A 403 with the gate's own sentence, and no bytes. The reader's page shows
          // this as an ask rather than an error; a hand-written URL gets the refusal.
          return res.status(403).json({
            ok: false,
            error: 'a view is owed before this page',
            gate: { cueIndex: missing.index, sentence: gateSentence(plan, missing) },
          });
        }
      }
    }

    // A PDF is drawn by the browser's viewer, which ranges: same treatment as a
    // stream, so seeking works inside a document we cannot see into.
    if (item.kind === 'pdf') {
      const buf = await storage.get(file.storage_key);
      return sendRanged(req, res, buf, {
        type: file.mime_type || 'application/pdf', filename: file.filename,
      });
    }

    let buf;
    let type = item.mime || file.mime_type || 'application/octet-stream';
    if (item.kind === 'archive') {
      const archive = await storage.get(file.storage_key);
      const read = readEntry(archive, item.entry);
      if (!read.ok) {
        await store.audit('content.page_failed', {
          assetId: asset.id, fileId: file.id, entry: item.entryName, reason: read.reason,
        });
        return res.status(422).json({ ok: false, error: 'this page could not be unpacked' });
      }
      buf = read.bytes;
    } else {
      buf = await storage.get(file.storage_key);
      if (isWatermarkable(file.mime_type, file.filename) && await hasImageMagick()) {
        const marked = await watermarked(file, userId, buf);
        if (marked) { buf = marked; type = 'image/jpeg'; }
      }
    }

    // `inline` and ranged: a page is content, not a download, and a large scanned
    // page should not have to arrive in one piece to be drawn.
    return sendRanged(req, res, buf, { type, filename: path.basename(item.entryName || file.filename) });
  } catch (err) {
    if (err.code === 'ENOENT') return res.status(410).json({ ok: false, error: 'file missing from storage' });
    return next(err);
  }
});

/**
 * The watermarked derivative for one file and one viewer, cached for the day.
 *
 * Returned as `null` rather than thrown when ImageMagick is missing or a file is
 * not a decodable image: traceability is worth having, but a viewer who has
 * legitimately unlocked something must still get their file.
 */
async function watermarked(file, userId, source) {
  const now = new Date();
  const label = watermarkLabel({ ref: userId, assetId: file.asset_id, at: now });
  const key = derivativeKey({ fileId: file.id, ref: userId, at: now });
  const hit = cachedDerivative(key);
  if (hit) return hit;
  try {
    const buf = await watermarkImage(source ?? await storage.get(file.storage_key), { label });
    return cacheDerivative(key, buf);
  } catch (err) {
    await store.audit('content.watermark_failed', { fileId: file.id, error: String(err.message).slice(0, 160) });
    return null;
  }
}

// ---------------------------------------------------------------------------
// Public media
//
// Covers and banners are the shop window: they must load without a token, on the
// storefront and in a share preview, for a visitor with no account. Gated content
// lives in the same directory but a different namespace, and this route refuses
// anything that is not in the public one — so "public" is enforced by the key,
// not by a flag someone has to remember to set.
// ---------------------------------------------------------------------------
// `/media/public/:file`, NOT `/media/:key`. An Express path parameter does not
// match across a slash, so the two-segment key silently 404s — and the fix is
// also the better design: the public namespace is part of the ROUTE, so there
// is no way to express a request for private content in the first place.
APP.get('/media/public/:file', async (req, res, next) => {
  try {
    const key = `public/${req.params.file}`;
    const buf = await storage.get(key);
    res.setHeader('content-type', mimeFor(key));
    // Safe to cache hard: the key contains a uuid, so replacing an image
    // produces a new URL rather than changing the bytes behind an old one.
    res.setHeader('cache-control', 'public, max-age=31536000, immutable');
    res.send(buf);
  } catch (err) {
    if (err.code === 'ENOENT' || /bad storage key/.test(err.message)) return res.status(404).end();
    next(err);
  }
});

const mimeFor = (key) => ({
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
  gif: 'image/gif', avif: 'image/avif', svg: 'image/svg+xml',
}[key.split('.').pop().toLowerCase()] || 'application/octet-stream');

// ---------------------------------------------------------------------------
// Publishing
//
// Without this the product is read-only: a creator can sign in and look at an
// empty dashboard but cannot put anything in it. The JSON API at /api/assets
// still exists for programmatic use; this is the form a person actually uses,
// which is why it redirects back with a message instead of returning JSON.
// ---------------------------------------------------------------------------
// The identity-document rules: what may come in, what is taken out of it before it
// is stored, and how long it is held. Pure module — no database, no filesystem, and
// the seller's page prints the same `HOLD_DAYS` this file enforces.
import { ALLOWED_TYPES, MAX_BYTES, HOLD_DAYS, sniff, stripMetadata, extFor } from './src/kyc.js';

const PLAN_CODES = Object.keys(PLANS);
const PAY_METHODS = ['esewa', 'khalti', 'imepay', 'bank', 'other'];

/**
 * Flash messages, from short codes.
 *
 * Codes travel in the query string and are mapped to sentences here, because
 * echoing a query parameter into HTML is the oldest reflected-XSS there is and
 * escaping is not a substitute for not doing it. An unknown code produces
 * nothing rather than the code itself.
 */
const REVIEW_ERRORS = {
  unlock: 'Only somebody who unlocked this file can review it. Unlock it first, then come back.',
  rating: 'Pick a rating from one to five.',
};

/**
 * "1 file" / "3 files", for the flash sentences below.
 *
 * The view module has its own because it formats a hundred other things; this one
 * exists so a flash cannot say "Paused 1 files". A count in a sentence is read as a
 * claim about what happened, and losing the grammar makes it read as a template.
 */
const filesN = (n) => `${Number(n) || 0} file${Number(n) === 1 ? '' : 's'}`;

/**
 * The flash code for a refusal from `series.js`.
 *
 * Two of the module's codes are one answer to a seller — "that series is not yours" and
 * "that series is not there" are the same sentence on a page they have already left —
 * and the rest map straight across. The mapping lives here rather than in the module so
 * that the words a SELLER reads stay with every other sentence a redirect carries.
 */
const SERIES_ERROR_CODES = {
  missing: 'series-missing',
  'no-series': 'series-owned',
  store: 'series-owned',
  'not-yours': 'series-owned',
  shape: 'series-shape',
  elsewhere: 'series-elsewhere',
  number: 'series-number',
  taken: 'series-taken',
  full: 'series-full',
};
const seriesError = (code) => SERIES_ERROR_CODES[code] || 'series-owned';

const SUCCESS_FLASH = {
  // `${action}:${applied}:${skipped}` — assembled in the bulk route from counts.
  // The skipped number is in the sentence because a bulk action that quietly did
  // less than it said is worse than one that refused.
  bulk: (v) => {
    const [action, applied, skipped] = String(v).split(':');
    const said = {
      pause: `Paused ${filesN(applied)}`,
      live: `Put ${filesN(applied)} back live`,
      ad_gated: `Set ${filesN(applied)} to ad-gated`,
      open: `Opened ${filesN(applied)} to everyone`,
    }[action] || `Updated ${filesN(applied)}`;
    return `${said}.${Number(skipped) ? ` ${filesN(skipped)} hidden after reports ${Number(skipped) === 1 ? 'was' : 'were'} left alone — the list says which.` : ''} You can take this back below for the next 30 minutes.`;
  },
  undone: (v) => {
    const [action, restored, skipped] = String(v).split(':');
    const said = { pause: 'pausing', live: 'putting back live', ad_gated: 'setting to ad-gated', open: 'opening' }[action] || 'changing';
    return `Undone — ${filesN(restored)} restored to what ${Number(restored) === 1 ? 'it was' : 'they were'} before ${said}.${Number(skipped) ? ` ${filesN(skipped)} stayed as ${Number(skipped) === 1 ? 'it is' : 'they are'}: reports are hiding ${Number(skipped) === 1 ? 'it' : 'them'}, and that is not yours to lift.` : ''}`;
  },
  published: (v) => `Published “${String(v).slice(0, 80)}”. It is live on your storefront now.`,
  saved: () => 'Saved.',
  // The reader's two choices, said as the difference they make. A seller who picked
  // "right to left" has just changed how every page of the file turns, and "Saved."
  // would leave them scrolling to find which control moved.
  'read-choices': () => 'Saved. The reader now presents this file the way you chose — a page at a time or as '
    + 'one continuous scroll, and the pages turn the way this language reads. Nothing about what the file asks '
    + 'changed: a stop still lands between pages, never inside one.',

  // The live panel's two saves, said as the difference they make. A break is an event,
  // not a setting: "Saved." would leave the seller unsure whether the break is RUNNING
  // or merely remembered.
  'live-url': () => 'Saved. This file is now the stream at that address — your host serves it, and nothing '
    + 'about it is copied or kept here. Uncheck-then-save clears it.',
  'live-break': () => 'Break called. It is running now, for the length you chose, and every viewer already '
    + 'watching will be stopped by it. Newcomers walk in without the door ask until the coverage it bought runs out.',
  // Ending one early is the opposite event with a number of its own: the coverage still
  // runs for the length that was ANNOUNCED (ending early is not a way to buy the same
  // hour without running the break), but it starts from this moment rather than from the
  // end the seller picked. The sentence has to say the difference or the seller is left
  // guessing which of the two the button just did.
  'live-closed': () => 'Break ended. The window closes for everyone watching now, and the clean entries it '
    + 'bought run from this moment — for the length you announced, not for whatever was left of it.',

  submitted: () => 'Reference received. An operator matches it against the bank or wallet statement by hand, and your plan changes when it clears.',
  // Rent's own sentence. It shared `submitted` with the plan flow above, which promised
  // a PLAN change — and rent is not a plan: the invoice is the platform's, and clearing
  // it changes nothing about what the store can do. Found by walking the rent payment,
  // which had never been walked.
  rent_submitted: () => 'Reference received. An operator matches it against the platform\'s own statement by hand, and the invoice is marked paid when it clears. Rent buys no capability and changes nothing about your plan — it is the price of the traffic the platform brought you.',
  requested: () => 'Upgrade requested. Send the amount to the account shown, then submit the transfer reference.',
  reviewed: () => 'Thank you — your review is on the page.',
  saved_slot: () => 'Saved. It is on your pages now.',
  saved_connection: () => 'Saved.',
  revoked: () => 'Disconnected. Its callbacks are refused from now on, and anything it gated stops unlocking.',
  responded: () => 'Reply posted.',
  saved_moderation: () => 'Decision recorded. The seller sees the reason and the note on their dashboard.',
  saved_user: () => 'Decision recorded. A suspended account is signed out everywhere, and its stores disappear from the public site.',
  saved_report: () => 'Report closed. The file is paused if you removed it, and every report on it is resolved.',
  appeal_sent: () => 'Sent. An operator reads your side before anything else happens to the file.',
  // Successes belong in this map. They were written into ERROR_FLASH first, which
  // meant the operator's most important action — putting somebody's file back —
  // redirected to a page with no confirmation on it at all, and the seller's
  // "declined" notice was never rendered either.
  appeal_upheld: () => 'Upheld. The file is back in the storefront if the report threshold was what hid it.',
  appeal_restored: () => 'Upheld — the file is live again, and its unlocks, files and reviews were never touched.',
  appeal_declined: () => "Declined. The hiding stands, and your note is now on the seller's page for this file.",
  appeal_withdrawn: () => 'Withdrawn. The appeal is closed and the file is exactly where it was.',
  // The operator sending a confirmation link on somebody's behalf, while they are
  // on the phone saying the email never arrived. The wait state is a refusal and
  // still an answer: it names what is already in flight rather than doing nothing.
  verify_sent: (v) => `Confirmation link sent to ${String(v || 'that address').slice(0, 120)}. It works once and lasts 48 hours.`,
  verify_wait: (v) => `A link went out ${String(v || 'a few minutes')} ago and is still the newest one. Sending another would cancel it — ask them to check spam before you send again.`,
  // Files, and the countries they are for.
  saved_file: () => 'Decision recorded. The file moved, and the owner sees the rule and your note on their own page for it.',
  saved_country: () => 'Country rule saved. Visitors in that country are answered by it from their next request.',
  // Verification. The seller's two, then the operator's two — and each one says
  // what happens NEXT, because a check is a wait and a refusal is not an ending.
  // The ask can now carry the document itself, so the sentence has three endings:
  // one with a copy, one without, and one where the copy replaced an earlier one.
  asked: () => 'Asked. A person looks at one document and records what they saw — we work in the order requests arrive. You can hand the document over here, or show it to somebody in person; both are the same check.',
  'asked-with-doc': (v) => `Asked, and the copy you sent went with it. A person opens it, records what they saw, and it is destroyed the moment they do — and after ${HOLD_DAYS} days either way.`,
  'already-with-doc': () => 'You had already asked — the copy you sent is attached to that request, and a person will get to it.',
  // The fourth ending, and it was missing: the same flow can come back from a click
  // with no document at all, and with no sentence keyed to that outcome the page said
  // "Saved." — which, to somebody who has just asked for a re-check, reads as though
  // something was recorded when nothing was. Found by `test/flash.test.js`, whose job
  // is to notice that a route named an outcome the vocabulary had no words for.
  already: () => 'You had already asked — this did not send a second request. One is open, and a person will get to it; nothing needs doing until it is answered.',
  doc: () => `Copy received. A person opens it, records what they saw, and it is destroyed the moment they do — and after ${HOLD_DAYS} days whether or not anybody looked.`,
  'doc-replaced': () => `Copy received, and the one before it is destroyed. Same rule: gone the moment a decision is recorded, and after ${HOLD_DAYS} days either way.`,
  'withdrawn-doc': () => 'Withdrawn. The request is gone and the copy you handed over was destroyed with it.',
  withdrawn: () => 'Withdrawn. The request is gone and nobody is waiting on anything.',
  verified: () => 'Recorded. The badge is on the store now, with what was checked and the date — and no copy of the document was kept.',
  noticed: () => 'Sent. The seller has the date, what happens on it, and that nothing else changes.',
  'noticed-logged': () => 'Written to the mail log — no provider is configured, so it was not delivered. The seller can see the same date on their own settings page.',
  rejected: () => 'Recorded as refused. The seller is told, with your note, and can ask again with the same or a different document.',
  // Memberships. Every one of these says what happens NEXT, because the whole
  // rail is manual: a claim waits for a person, and a confirmation is that person
  // saying they saw the money. "Done" would be a lie in three of the six.
  joined: (v) => (String(v) === 'watching'
    // The attention door's own success sentence. It says the two things that make
    // the door what it is: nothing was paid, and the views are the whole of it.
    // The counter starts again from zero, which the member can see on their own card.
    ? 'You are in — the views you watched did it, and nothing was charged. Watch this store again and the next '
      + 'period starts building itself.'
    : String(v) === 'watching-more'
      ? 'Another period added. Those views were the whole of it — nothing was charged, and the days you already had '
        + 'are still yours.'
      : `Asked. The creator checks their own statement for your reference and confirms it — the platform never sees these dues, so it cannot confirm them for you. ${LAPSE_LINE}`),
  left: () => 'You left. Nothing was deleted — your opens stay open until their own windows run out.',
  listed: () => 'You are on the list.',
  'member-confirmed': () => 'Confirmed. Their plate is on the storefront now, and the files behind that tier open for them without an ad.',
  'member-rejected': () => 'Marked as not found, and the reason went with it. They can send the reference again.',
  'tier-saved': (v) => `Tier ${String(v || '')} saved. What a member pays, and what they get, is now what the storefront shows.`,
  'tier-removed': () => 'Tier removed. Nobody was holding it, so nothing changed for anybody but the panel.',
  'note-saved': () => 'Saved. This is what a visitor is told about paying you — keep it to something you would be happy to see written down.',
  // ByteBikri Plus. Three outcomes, and each one says which of them happened —
  // a claim is not a purchase, and the page must not let those be confused.
  'plus-claimed': () => 'Sent. An operator checks that reference against the platform\'s own statement — nothing is worn until it is matched, and if it never is, nothing about your account changes.',
  'plus-look': () => 'Saved. Your name wears this wherever the platform shows it to somebody else, for as long as the arrangement is running.',
  'plus-stopped': () => 'Stopped early. Your look stays saved and nothing was deleted — but the month was already paid, and stopping does not return it. If you only wanted to look plain for a while, saving the plain effect does that without giving up the month.',
  'plus-matched': () => 'Matched against the statement. That person\'s month has started and their look is on.',
  // Gifting. The claim sentence says the code is NOT live yet, because a buyer's first
  // instinct is to hand it over immediately — and a code handed over early is a friend
  // typing a string that does nothing.
  'gift-claimed': () => 'Sent. The code above is reserved, not live: an operator checks that reference against the platform\'s own statement, and the code starts working when the transfer is found. Nothing is taken twice, and your own arrangement is untouched.',
  'gift-redeemed': () => 'Redeemed. That period is yours now and your look is on — the person who paid for it is not named to you, and nothing about them changed.',
  'plus-rejected': () => 'Marked as not found. Their arrangement did not start, and any look they had stopped being worn.',
  // The series panel (§15). A series changes what a storefront LOOKS like without
  // changing a single file's door, and every sentence here says so — the fear this panel
  // has to answer is "will this move or re-price my files", and the answer is no.
  'series-created': () => 'Created. It has no episodes yet, so your storefront looks exactly as it did until you add the first one.',
  'series-saved': () => 'Saved. The mode decides the listing order and whether an episode offers a next; the files themselves are untouched.',
  'episode-set': () => 'Saved. That file is in the series at that number now — its own door, its own ads and its own page are unchanged.',
  'episode-removed': () => 'Taken out. The file is still published, and the rest keep their numbers — nothing was renumbered behind your back.',
  'series-deleted': () => 'Deleted. The grouping and the numbers went with it; every file is still published as it was.',
  theme: (v) => (v === 'plain'
    ? 'Back to the default look. Nothing else about your store changed.'
    : `Saved — ${String(v || 'that')} is on your storefront now. It paints the band behind your name and nothing else, and it is checked for readability in both light and dark before it can be offered.`),
};

const ERROR_FLASH = {
  /*
   * The platform's own video host refused an upload (VIDEO_STORAGE.md §6).
   *
   * The seller is told it was the HOST and not their file, because that is the
   * difference between retrying and re-encoding: a fixed sentence, not the host's
   * raw words, because those words travel in a URL here and an arbitrary third
   * party's message is not something this app puts in an address bar. The host's
   * own reason is recorded on the audit line beside this code
   * (`asset.upload_host_failed`), which is where somebody investigating can read it.
   */
  host: 'The platform\u2019s video host would not take the file, so nothing was published and nothing was '
    + 'charged. This is the platform\u2019s storage and not your file: try again in a few minutes, and if it keeps '
    + 'failing write to us — the address is on the privacy page.',
  // The series panel (§15). Each refusal that the module writes is the module's own
  // sentence, read from `SERIES_REFUSALS` — so the seller who reads it after a redirect
  // and the seller who reads it beside the form are reading one rule, not two copies of
  // one. The three codes with no module sentence are the ones only a route can know.
  'series-title': 'A series needs a title — it is what the page and the card say. Nothing was created.',
  'series-mode': 'Pick how the series is meant to be watched: in order (a serial) or any order (a collection). Nothing was changed.',
  'series-owned': 'That series is not one of yours, so nothing was changed. A series belongs to the store that made it.',
  'series-missing': SERIES_REFUSALS.missing,
  'series-shape': SERIES_REFUSALS.shape,
  'series-elsewhere': SERIES_REFUSALS.elsewhere,
  'series-number': SERIES_REFUSALS.number,
  'series-taken': SERIES_REFUSALS['taken-plain'],
  'series-full': SERIES_REFUSALS.full,
  // The live panel's refusals. A break is the one place a seller can cost themselves
  // viewers, so each refusal names the rule rather than saying the button did not work.
  'live-url': 'A live file is an HLS playlist: an https:// address ending in .m3u8, or a same-origin path '
    + 'to one. A plain page URL is a link, not a stream, and rtmp:// would need an ingest server this '
    + 'platform does not have. Nothing was changed.',
  'live-files': 'This file has uploaded files of its own, and a file cannot be both. Remove the uploads '
    + 'first if it is really a stream — otherwise the uploads would become unreachable. Nothing was changed.',
  'live-break': 'That break was not called. The panel shows why next to each length: breaks are 15 seconds '
    + 'to 4 minutes, never two inside four minutes, and never more than three an hour. Nothing was changed.',
  'live-shape': 'Breaks belong to a live stream. This file is not one — point it at its playlist first. '
    + 'Nothing was changed.',
  'live-action': 'That is not something this panel does. Nothing was changed.',
  // The reader's two choices, refused. The panel only renders them for a file a
  // reader opens, so this is reachable by a hand-crafted post — and a refusal that
  // names the rule is the difference between a bug report and a dead end.
  'read-shape': 'This file is not one a reader opens, so there is no page order to set. Nothing was changed.',
  'read-choices': 'Pick "a page at a time" or "one continuous scroll", and a page direction. Nothing was changed.',
  // Membership refusals. Each names the rule, because a person who has just
  // filled in a payment form and been bounced deserves to know which part of it
  // was wrong — and two of these are about who they are, not what they typed.
  'member-own': 'This is your own store, so there are no dues to pay — you are already the one who would confirm them.',
  'member-plan': FREE_PLAN_LINE,
  'member-no-tier': 'This store has not opened a tier yet. Nothing was sent, and nothing was written down.',
  'member-reference': 'A reference of at least four characters is what the creator matches against their statement. Without one there is nothing to look up, so nothing was sent.',
  'member-active': 'Your membership is already confirmed, so there is nothing to re-send. Pay the creator again when the period you have paid for runs out and the panel will take a new reference.',
  'member-none': 'There is no membership here to change. Nothing was sent.',
  'member-missing': 'That claim is not waiting any more — either it was already decided or the person left. Reload the page to see what is there now.',
  'plus-verify': 'Confirm the email address on this account first. A payment needs a receipt, an invoice and a dispute notice to be sendable, and none of those can go to an address that has not answered — nothing was sent.',
  'plus-reference': 'A reference of at least four characters is what an operator matches against the statement. Without one there is nothing to look up, so nothing was sent.',
  'plus-duplicate': 'That transaction reference has already been used here — for this or for another payment. Nothing was written down twice; if the first one was rejected, submit the new reference from the new receipt.',
  'plus-missing': 'That claim is not waiting any more — either it was already decided or it was withdrawn. Reload the page to see what is there now.',
  'plus-look-bad': 'Pick one of the eight palettes and one of the three effects. Nothing was changed.',
  'plus-none': 'There is no arrangement on this account to change. Nothing was sent.',
  // Gifting refusals. The person reading these is often the RECIPIENT and not the
  // buyer, so each one says what happened and what to do next — "it did not work"
  // sends somebody back to their friend with a complaint instead of an answer.
  'gift-reference': 'A reference of at least four characters is what the operator matches against the statement. Without one there is nothing to look up, so nothing was sent.',
  'gift-duplicate': 'That reference is already on a claim. One transfer is one period — check the receipt, because if this is a second gift you bought, it has its own code and its own reference.',
  'gift-unknown': 'That code is not a ByteBikri gift code. They look like BKP-XXXX-XXXX.',
  'gift-used': 'That code has already been used. A code is one period for one person, and it cannot be reused — a second gift needs a second code.',
  'gift-void': 'That code was voided: the transfer behind it was never found on the platform\'s statement. Nothing is taken from you either way, and whoever bought it can see this on their own page.',
  'gift-unfunded': 'That code is not live yet. Whoever bought it submitted a reference, and an operator has not found the transfer on the statement — the period starts the moment they do, and the code will work then.',
  'gift-self': 'That is your own code. A gift is one period for somebody else — your own arrangement is extended by buying one for yourself on this page, and it costs the same.',
  'member-owner-only': 'Only the store owner can confirm dues. The platform never receives this money, so nobody here can check it.',
  // The attention door's refusals. Each one names the way forward, because the
  // person reading it is standing on the one panel where they are trying to get in:
  // "not enough views" without the count is a wall, and "that door is closed"
  // without the other one is a dead end.
  'member-short': 'Not yet — the count is not there. Nothing was spent: keep watching this store\u2019s files and the door opens itself when the views are in.',
  'member-watching-only': 'This tier is sold as “join by watching”, so there is no dues door to send to. Watch its files instead — the panel shows how many views it takes.',
  'member-already-in': 'You are already in, so there is nothing to spend. Your views keep counting toward the next period.',
  'member-claim-waiting': 'A claim of yours is already with the creator. Nothing to watch for it — and if it is not found, the watching door is still here.',
  'member-door-closed': 'That door is closed on this tier. Nothing was spent.',
  'tier-name': 'A tier needs a name of at least two characters — it appears next to a member\'s name.',
  'tier-dues': 'Dues have to be a whole number of rupees between 0 and 100,000.',
  'tier-period': 'Pick a period: monthly, every three months, or yearly.',
  'tier-held': 'Somebody holds that tier, so it stays. You can rename it and change what it costs — what you cannot do is delete the thing people paid for.',
  'tier-missing': 'There is nothing at that tier number. Tiers are 1 and 2.',
  // Themes. The plan refusal is the interesting one: it says what the feature IS
  // and what Free keeps, rather than implying something was taken away.
  'theme-plan': THEME_FREE_LINE,
  'theme-unknown': 'That is not one of the themes on offer. Nothing was changed — pick one from the list and try again.',
  'theme-missing': 'No theme arrived with that press. Nothing was changed.',
  'bulk-action': 'That is not something this list can do. Nothing was changed.',
  'bulk-empty':
    'Nothing arrived to change — this list did not send a single file with that press. '
    + 'Pick the files you mean and try again; nothing was touched.',
  'bulk-nothing': 'Nothing to change — every file you picked already has that setting. Nothing was changed, and nothing was written down.',
  'bulk-held': 'Every file you picked is hidden while reports are answered, and that state is not the seller\'s to move. Nothing was changed. The file\'s own page says what it is waiting for.',
  'undo-missing': 'That change is not on this store, so there is nothing to take back.',
  'undo-taken': 'That change has already been taken back. Undo works once — the second time, the files are already where you left them.',
  'undo-late': 'That change is more than 30 minutes old, so undoing it automatically is no longer offered — the files are as they were left. Set them back by hand and the list will show the new change as its own.',
  'no-numbers': 'That looks like a document number. Nothing here needs it and this field is kept — say where you are or when to call instead.',
  // The document refusals. Each names the rule it refused under, because a person
  // who photographed their citizenship on an iPhone gets a HEIC file and has no way
  // to know that the platform cannot read one.
  'doc-type': 'That is not a photo this can check — send a JPEG, PNG or WebP picture of the document. A PDF or a screenshot from a document app cannot be read here, and one with scripts in it is the last thing we will store.',
  'doc-too-big': `That file is larger than the ${Math.round(MAX_BYTES / 1024 / 1024)} MB limit for a document. A photo of the page at normal size is well under it — resizing usually fixes this.`,
  'doc-one': 'One file at a time, please — a single photo of the document. Nothing was stored.',
  'doc-none': 'Choose the picture first, then press the button. Nothing was stored.',
  'doc-no-request': 'Ask for a check first — the copy hangs off the request, and a document with nothing to be checked against is exactly what we are not keeping.',
  // NOT `plan`: see the FLASH_CODE map on the ask route. Two entries under one key
  // is not a merge, it is a deletion — the later declaration wins and the earlier
  // message becomes unreachable, silently, in a file where nothing looks wrong.
  'check-plan': 'A document check is included from the Store plan up. Your files sell exactly the same either way.',
  'no-check': 'There is no check on this store to write to them about. Nothing was sent.',
  'already-noticed': 'That seller has already been told this check is ending. Nothing was sent a second time.',
  'not-sent': 'The message was not recorded, so nothing was sent and nothing was marked. Try again — and if it keeps failing, the mail settings need looking at.',
  'already-asked': 'You have already asked, and nobody has looked yet.',
  'already-checked': 'This store is checked. There is nothing to ask for until the check lapses.',
  name: 'A store needs a name.',
  title: 'A file needs a title — it becomes the page address.',
  // The mode that moves the ask inside the file, refused with its reason. Both
  // halves are said because both are actionable: the length is measured by opening
  // the file once, and the door is always available meanwhile.
  'no-breaks': 'Not switched. A break inside a file needs a length to sit against, anything the '
    + 'file may ask for inside the first two minutes or the last ninety seconds is refused by the '
    + 'platform, and only a video or a queue has a player that can stop. Open this file once — its '
    + 'length is measured by the player, not typed — or keep the ask at the door, which is exactly '
    + 'where it is now: nothing changed.',
  plan: 'That plan is not available from your current one.',
  listing: 'Explore is part of the paid plans. Switch to your own address, or upgrade on the billing page.',
  banner: 'The banner must be an image under 5 MB.',
  reference: 'Enter the transaction reference from your transfer — at least four characters.',
  verify: 'Confirm the email address on this account first — an operator matches transfers by hand, and the receipt has to reach you. The button is on the verify page.',
  // Country rules. Each refusal names the field, because a form that answers
  // "something went wrong" makes an operator reload and guess.
  // Says the same thing to a form that submitted nothing and to one that
  // submitted nonsense, because both odds are the same operator at the same
  // picker — and the first one is what a blank first option now produces.
  country: 'Pick a country — two letters, ISO-3166: NP, IN, US.',
  state: 'That is not a state a country rule can be in. Allowed, restricted or blocked.',
  reason: 'A country rule that withholds something has to cite a rule. Allowing a country cites nothing.',
  rule: 'That is not a rule this platform has. Pick one from the list.',
  file: 'That file does not exist.',
  store: 'That store does not exist.',
  // Its own key: `nope` belongs to the connection routes (three of them) and the
  // later declaration was silently winning, so this sentence — the one a seller
  // needs when they try to undo a rule the platform set — was unreachable and the
  // page answered "That connection is not yours." on a country-rule form.
  'rule-not-yours': 'That rule is not yours to clear. An operator set it — the appeal on this page is how to disagree.',
  nothing: 'There is nothing waiting to be paid right now.',
  empty: 'A slot message needs a headline.',
  slot: 'That is not a position on your pages.',
  link: 'That link cannot be used. A full https:// address or a path on this store (/s/you) will work.',
  provider: 'That is not a network we know.',
  noadapter: 'We have no adapter for that network, so connecting it would produce a connection that can never verify a callback.',
  already: 'That network is already connected to this store.',
  moderated: 'This store is not in a state where it can publish. Nothing was changed, and nothing has been deleted.',
  action: 'That is not a moderation action.',
  // (There was a second `rule:` here — "That reason is not one of our rules." — which
  // is the same sentence about the same list, and which shadowed the one above. One
  // key, one message, and the duplicate-key test now fails the build if another
  // appears.)
  report_reason: 'Pick what is wrong with the file from the list.',
  report_self: 'That is your own file — there is nothing to report.',
  secret: 'That secret did not look right — copy it again from the network dashboard, with no spaces at either end.',
  nope: 'That connection is not yours.',
  unlock: 'Only someone who has unlocked this file can review it.',
  rating: 'Pick a rating from one to five.',
  media: 'Attach the file people are unlocking. Nothing was published.',
  // Context-aware: the refusal adds the count and names the tier that lifts it.
  // Falls back to the plain sentence when the state is not known (a link on an
  // old page, a bookmarked URL), because the fallback must never be worse than
  // what was there before.
  appeal_decision: 'That is not a decision this queue can record.',
  appeal_note: 'A decline needs a line for the seller — at least a sentence. It is the only part of this they ever see.',
  appeal_decided: 'That appeal was already decided. Nothing was overwritten; the first decision stands.',
  appeal_state: 'That file is not in a state where an appeal can be filed. If it is paused by you, or an operator has restricted it, the page explains what applies.',
  appeal_short: 'An appeal needs at least a sentence — 20 characters or more, so an operator has something to read.',
  appeal_double: 'There is already an appeal open on this file. An operator reads it before the next one.',
  limit: ({ usage, plan, next } = {}) => (usage && plan && usage.files.level !== 'unlimited'
    ? `${usage.files.used} of ${usage.files.limit} published files on ${plan.name}. `
      + `${next ? `${next.name} raises that to ${next.capabilities.max_assets === -1 ? 'unlimited' : next.capabilities.max_assets}` : 'Upgrade to publish more'}. `
      + 'Nothing already published has changed.'
    : "Your plan's file limit is reached. Existing files stay live; upgrade to publish more."),
  cover: 'The cover must be an image under 5 MB.',
  size: 'That file is larger than the 25 MB upload limit.',
  toobig: 'That file is larger than the 25 MB upload limit.',
};

/**
 * What a store owner is told about their own store's moderation state.
 *
 * The note is built from the policy rule's own title and description — the
 * sentence that was written before the argument started — plus the operator's
 * remedy line. Nothing here is free text standing alone, and nothing here is
 * rendered unescaped: `views.js` escapes every field of it.
 */
async function moderationBrief(channel) {
  // A ban hides the store too, and telling the seller "your store is suspended"
  // when it is their ACCOUNT that was stopped would send them to the wrong
  // remedy.
  if (channel.owner_banned) {
    const latest = await store.latestModerationAction(channel.id).catch(() => null);
    const person = channel.owner_id
      ? await store.userModerationHistory(channel.owner_id, 1).catch(() => [])
      : [];
    const decision = person[0] || latest;
    return {
      state: 'account suspended',
      ruleCode: decision?.rule_code || null,
      ruleTitle: decision?.rule_title || null,
      decidedAt: decision?.created_at || null,
      note: decisionNote({ title: decision?.rule_title, description: null }, decision?.reason || ''),
      ownerNote: 'Your account is suspended, so this store is not visible to anyone but you. Your files are untouched and nothing has been deleted. Signing in is switched off until this is lifted.',
    };
  }
  const latest = await store.latestModerationAction(channel.id).catch(() => null);
  const state = normaliseState(channel.moderation_state);
  return {
    state,
    stateLabel: state,
    ruleCode: latest?.rule_code || channel.moderation_reason || null,
    ruleTitle: latest?.rule_title || null,
    decidedAt: latest?.created_at || null,
    note: decisionNote({ title: latest?.rule_title, description: latest?.rule_description }, latest?.reason || ''),
    ownerNote: behaviour(state).ownerNote,
  };
}

function flashFor(query = {}, context = {}) {
  // The dispatch lives in src/flash.js so it can be tested: it was wrong for four
  // rounds in a way no test could see, because a route never returned where the
  // sentence it had written was rendered. `?saved=plus-claimed` read "Saved." — see
  // that module's header for what that cost.
  const succeeded = successFlash(SUCCESS_FLASH, query);
  if (succeeded) return succeeded;
  if (query.error) {
    // A message may be a function of the state the person was in when they hit
    // it. The file limit is the case that matters: "your plan's file limit is
    // reached" is true and useless, because it does not say how many, or which
    // plan lifts it, at the one moment the answer is worth money.
    const entry = ERROR_FLASH[String(query.error)];
    const message = typeof entry === 'function' ? entry(context) : entry;
    // An unmatched code still says something. An empty red box is a worse
    // answer than a vague sentence.
    return { kind: 'danger', message: message || 'That did not work. Nothing was changed.' };
  }
  return null;
}

/**
 * Change several files at once.
 *
 * Two shapes of selection arrive and they are kept distinct on purpose: `ids` is
 * the exact set somebody ticked, and `scope=matching` means "everything this filter
 * matches", which is re-resolved HERE rather than trusted from the browser. The
 * researched hazard in bulk selection is precisely the ambiguity between those two
 * — a checkbox that might mean this page or this search — so the page names them
 * separately and the server decides the second one at commit time.
 *
 * Every way this can decline is a sentence on the page rather than a silent no-op:
 * an action on files the platform is holding (hidden after reports), an action that
 * changes nothing because it was already true, and a selection that arrived empty.
 */
APP.post('/dashboard/:slug/assets/bulk', async (req, res, next) => {
  const slug = encodeURIComponent(req.params.slug);
  // The filter travels back with the redirect, so the seller lands on the list they
  // were working rather than a reset one. Every value is re-validated on read.
  const filter = {
    q: String(req.body?.q || '').trim().slice(0, 80),
    state: String(req.body?.state || 'all'),
    access: String(req.body?.access || 'all'),
    sort: String(req.body?.sort || 'newest'),
  };
  const keep = new URLSearchParams();
  if (filter.q) keep.set('q', filter.q);
  for (const k of ['state', 'access']) if (filter[k] && filter[k] !== 'all') keep.set(k, filter[k]);
  if (filter.sort !== 'newest') keep.set('sort', filter.sort);
  const back = (qs = '') => `/dashboard/${slug}${qs ? `?${qs}` : ''}${keep.toString() ? `${qs ? '&' : '?'}${keep}` : ''}`;
  try {
    if (!req.user) return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
    const channel = await store.channelBySlug(req.params.slug);
    if (!channel || channel.owner_id !== req.user.id) return res.status(404).send('Channel not found');
    if (refuseWrite(req, res, channel)) return undefined;

    const action = ['pause', 'live', 'ad_gated', 'open'].includes(req.body?.action) ? req.body.action : null;
    if (!action) return res.redirect(back('error=bulk-action'));

    const ids = Array.isArray(req.body?.ids) ? req.body.ids : (req.body?.ids ? [req.body.ids] : []);
    const out = await store.applyAssetBulk({
      channelId: channel.id,
      actorId: req.user.id,
      action,
      ids,
      filter: req.body?.scope === 'matching' ? filter : null,
    });

    if (!out.ok) return res.redirect(back('error=bulk-action'));
    if (!out.applied) {
      // Three reasons, and they are different sentences. Nothing usable arrived (a
      // post with no ids, or ids that are not ids); everything picked was already in
      // that state; or the platform is holding everything picked. The first one used
      // to be reported as the second, which told a seller their files "already say
      // this" when nothing had been sent at all.
      if (!out.picked) return res.redirect(back('error=bulk-empty'));
      return res.redirect(back(`error=${out.skipped ? 'bulk-held' : 'bulk-nothing'}`));
    }
    await store.audit('asset.bulk_updated', {
      channelId: channel.id, action, applied: out.applied, skipped: out.skipped,
      unchanged: out.unchanged, batch: out.batch?.id,
    });
    // `bulk`, not `saved`: `flashFor` returns the FIRST entry whose key is in the
    // query, and `saved` is in the map above it — which is how the first version of
    // this shipped a bulk change that reported itself as "Saved.".
    return res.redirect(back(`bulk=${action}:${out.applied}:${out.skipped}`));
  } catch (err) { return next(err); }
});

/**
 * Take a bulk change back.
 *
 * Narrow on purpose: one batch, the seller's own channel, inside the window, once.
 * The restore itself lives in the store — this route only reports what happened,
 * and each of the three ways it can decline has its own sentence, because "that did
 * not work" is not an answer to "why can't I undo this".
 */
APP.post('/dashboard/:slug/assets/bulk/:batchId/undo', async (req, res, next) => {
  const back = (qs = '') => `/dashboard/${encodeURIComponent(req.params.slug)}${qs ? `?${qs}` : ''}`;
  try {
    if (!req.user) return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
    const channel = await store.channelBySlug(req.params.slug);
    if (!channel || channel.owner_id !== req.user.id) return res.status(404).send('Channel not found');
    if (refuseWrite(req, res, channel)) return undefined;

    const out = await store.undoAssetBulk({
      batchId: req.params.batchId, channelId: channel.id, actorId: req.user.id,
    });
    if (!out.ok) {
      const code = { 'no-such-change': 'undo-missing', 'already-undone': 'undo-taken', 'too-late': 'undo-late' }[out.code] || 'undo-missing';
      return res.redirect(back(`error=${code}`));
    }
    await store.audit('asset.bulk_undone', {
      channelId: channel.id, action: out.action, restored: out.restored, skipped: out.skipped,
    });
    return res.redirect(back(`undone=${out.action}:${out.restored}:${out.skipped}`));
  } catch (err) { return next(err); }
});

APP.post('/dashboard/:slug/assets', upload.fields([
  { name: 'media', maxCount: 1 },
  { name: 'cover', maxCount: 1 },
]), async (req, res, next) => {
  const back = `/dashboard/${encodeURIComponent(req.params.slug)}`;
  try {
    if (!req.user) return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);

    const channel = await store.channelBySlug(req.params.slug);
    if (!channel || channel.owner_id !== req.user.id) return res.status(404).send('Channel not found');
    if (refuseWrite(req, res, channel)) return;

    const fail = (code) => res.redirect(`${back}?error=${encodeURIComponent(code)}`);

    const title = String(req.body.title || '').trim().slice(0, 200);
    if (!title) return fail('title');

    const media = req.files?.media?.[0];
    if (!media) return fail('media');

    const plan = store.plan(channel);
    const limit = plan.capabilities.max_assets;
    if (limit !== -1 && (await store.assetsOf(channel.id)).length >= limit) return fail('limit');

    const cover = req.files?.cover?.[0];
    if (cover && !String(cover.mimetype).startsWith('image/')) return fail('cover');
    if (cover && cover.size > 5 * 1024 * 1024) return fail('cover');

    const unlockMode = req.body.unlockMode === 'open' ? 'open' : 'ad_gated';

    // Slug: derived from the title, made unique WITHIN the store. Two stores may
    // both have "poster-kit"; one store may not have two.
    const base = slugify(title) || 'file';
    let assetSlug = base;
    for (let n = 2; await store.assetBySlug(channel.id, assetSlug); n += 1) assetSlug = `${base}-${n}`;

    const asset = await store.createAsset({
      channelId: channel.id, title, slug: assetSlug,
      description: String(req.body.description || '').trim().slice(0, 2000),
      unlockMode,
      coverUrl: cover
        ? `/media/${await storage.put(cover.buffer, cover.originalname, { namespace: 'public' })}`
        : null,
    });

    /*
     * Where these bytes land is decided by `storage` with the mime type in hand
     * (`VIDEO_STORAGE.md` §2): video goes to the configured video host, everything
     * else stays on this disk, and identity documents cannot reach it at all.
     * Passing the type is the whole contract — without it the router takes the
     * safe answer, which is local.
     */
    const storageKey = await storage.put(media.buffer, media.originalname, { mimeType: media.mimetype });

    await store.addFile({
      assetId: asset.id,
      storageKey,
      filename: media.originalname,
      mimeType: media.mimetype,
      sizeBytes: media.size,
      checksum: crypto.createHash('sha256').update(media.buffer).digest('hex'),
    });

    // No `adMinSeconds` is read here any more. The publish form used to carry a
    // "Minimum ad length" box and this route used to honor it, clamped to 5–120 —
    // which is how a file could be published asking for a five-second view, from the
    // form that was supposed to have stopped asking. The ask is derived
    // (`src/adscale.js`) from the file's value and the store's plan, `createAsset`
    // writes the floor, and the seller changes it afterwards with a LEVEL on the
    // file page, never a number. 0035 makes the floor a database constraint, so this
    // route could not write a lower one even if somebody wired the field back up.

    await store.audit('asset.created', { assetId: asset.id, channelId: channel.id });
    res.redirect(`${back}?published=${encodeURIComponent(assetSlug)}`);
  } catch (err) {
    if (err.code === 'LIMIT_FILE_SIZE' || err.code === 'LIMIT_UNEXPECTED_FILE') return fail('size');
    /*
     * A video host is a dependency, and a dependency fails in its own words. The
     * seller gets the reason ("the video host refused the upload: …"), not a 500:
     * an upload that fails silently or unexplained is one a seller retries forever,
     * and the message is the only place the provider's own explanation can surface.
     */
    if (err.name === 'VideoApiError') {
      // The host's own words go to the AUDIT LINE, and the seller gets the fixed sentence
      // in `ERROR_FLASH.host`. That split is deliberate (VIDEO_STORAGE.md §6): the flash
      // travels in a redirect's query string, and a third party's message is not something
      // this app puts in an address bar. The message was passed to `fail` here for one
      // round, where `fail = (code) =>` dropped it — so the code read as though the
      // seller saw the reason when they never did. One place says it, and this is not it.
      await store.audit('asset.upload_host_failed', {
        channelId: channel.id, reason: err.message.slice(0, 200), provider: err.provider || null,
      });
      return fail('host');
    }
    next(err);
  }
});

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Billing — the two things bytebikri charges for
//
// A store upgrade and annual rent. Both are the SELLER paying the PLATFORM for
// space and capability; neither is a cut of what the seller earns, and there is
// no third charge anywhere in this file.
//
// One rule repeated in every route below: bytebikri holds no money from selling,
// so the seller's flow ends with a reference submitted and a human matching it
// against the statement. The page says that plainly rather than rendering a
// checkout that cannot exist.
// ---------------------------------------------------------------------------

/** Resolve the store in the URL, and refuse anyone who is not its owner. */
async function ownerChannel(req, res) {
  if (!req.user) {
    res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
    return null;
  }
  const channel = await store.channelBySlug(req.params.slug);
  // 404 rather than 403, the same as the dashboard: confirming a store exists
  // but is not yours still tells a stranger it exists.
  if (!channel || (channel.owner_id !== req.user.id && req.user.role !== 'admin')) {
    res.status(404).send('Channel not found');
    return null;
  }
  return channel;
}

/** Billing state, assembled once for the page. */
async function billingState(channel) {
  const slots = await buildSlots(channel);
  const pageviews = await store.pageviews30d(channel.id);
  const estimate = estimateRentSlotValue({ pageviews30d: pageviews, slots });
  const invoice = await store.ensureRentInvoice({ channel, estimate });
  const plan = store.plan(channel);
  const nextCode = plan.code === 'free' ? 'store' : plan.code === 'store' ? 'pro' : null;
  const payments = await store.planPaymentsOfChannel(channel.id);
  const subscription = await store.subscriptionOf(channel.id);

  const quote = nextCode ? store.upgradeQuote(channel, nextCode) : null;

  /**
   * An upgrade that has been asked for and not yet paid for.
   *
   * The amount is taken from the submitted payment when there is one, and from
   * the quote when there is not — never from the request's plan price, which is
   * the number nobody owes. A request with no reference yet shows the seller
   * what to send; a request with one says what is being checked.
   */
  const pendingCode = subscription?.pending_plan_code || null;
  const submitted = pendingCode ? payments.find((pay) => pay.status === 'submitted') : null;
  const pending = pendingCode ? {
    code: pendingCode,
    name: (PLANS[pendingCode] || {}).name || pendingCode,
    amountNpr: submitted?.amount_npr ?? quote?.amountNpr ?? 0,
    reference: submitted?.txn_reference || null,
    method: submitted?.method || null,
    since: subscription.pending_since,
  } : null;

  return {
    slots, pageviews, estimate, invoice, plan, nextCode, payments, pending, quote,
    paidTotal: payments.filter((p) => p.status === 'matched').reduce((acc, p) => acc + p.amount_npr, 0),
    invoices: await store.rentInvoicesOfChannel(channel.id),
    subscription,
  };
}

APP.get('/dashboard/:slug/billing', async (req, res, next) => {
  try {
    const channel = await ownerChannel(req, res);
    if (!channel) return undefined;

    const state = await billingState(channel);
    res.send(views.billing({
      channel, user: req.user, consent: req.consent, flash: flashFor(req.query),
      // The view is told, rather than inferring it, so the gate can be rendered
      // where the form was instead of as a refusal after the fact.
      addressConfirmed: Boolean(req.user.email_verified_at),
      plan: state.plan,
      nextPlanCode: state.nextCode,
      pending: state.pending,
      quote: state.quote,
      upgrade: state.quote ? upgradeExplanation(state.quote) : null,
      subscription: state.subscription,
      invoice: state.invoice,
      estimate: state.estimate,
      pageviews: state.pageviews,
      paidTotal: state.paidTotal,
      payments: state.payments,
      invoices: state.invoices,
      rails: railDetails(),
      railsReady: railsReady(),
      payee: payeeName(),
      // How many slots EXIST, not how many the plan allows: the pricing page
      // must not promise a position the storefront cannot render.
      benefits: planBenefits(state.plan, {
        availableSlots: SLOT_DEFS.filter((d) => d.active && (d.surfaces || []).includes('web')).length,
      }),
      notCharged: NOT_CHARGED,
      slots: state.slots,
    }));
  } catch (err) { return next(err); }
});

/** Ask for the upgrade. Creates a PENDING subscription — never an active one. */
APP.post('/dashboard/:slug/upgrade', async (req, res, next) => {
  try {
    const channel = await ownerChannel(req, res);
    if (!channel) return undefined;
    if (refuseWrite(req, res, channel)) return undefined;
    const back = `/dashboard/${encodeURIComponent(channel.slug)}/billing`;

    const code = String(req.body.plan || '');
    if (!PLAN_CODES.includes(code) || code === 'free') return res.redirect(`${back}?error=plan`);

    // Up only. A downgrade mid-period is a refund decision, and there is
    // nothing here to refund into.
    const quote = store.upgradeQuote(channel, code);
    if (!quote) return res.redirect(`${back}?error=plan`);

    await store.requestUpgrade(channel, code);
    await store.audit('plan.requested', { channelId: channel.id, plan: code, amountNpr: quote.amountNpr });
    return res.redirect(`${back}?requested=${encodeURIComponent(code)}`);
  } catch (err) { return next(err); }
});

/** The seller submits the transfer reference for their upgrade. */
APP.post('/dashboard/:slug/billing/plan-payment', async (req, res, next) => {
  try {
    const channel = await ownerChannel(req, res);
    if (!channel) return undefined;
    if (refuseWrite(req, res, channel)) return undefined;
    const back = `/dashboard/${encodeURIComponent(channel.slug)}/billing`;

    // Refuse when there is no OPEN request. The first version tested the
    // subscription status instead, and since a request no longer changes the
    // status (it must not — the paid plan stays active), that check refused
    // every submission with "there is nothing waiting to be paid".
    const subscript = await store.subscriptionOf(channel.id);
    if (!subscript?.pending_plan_code) return res.redirect(`${back}?error=nothing`);

    // Money in is the only thing an unconfirmed address holds back, and the page
    // says so before the form rather than after the refusal. Checked here as well
    // because a page can be stale: this is the boundary that matters, not the view.
    if (!req.user.email_verified_at) return res.redirect(`${back}?error=verify`);

    const reference = String(req.body.txnReference || '').trim().slice(0, 120);
    if (reference.length < 4) return res.redirect(`${back}?error=reference`);

    // The amount is recomputed HERE, from the plan and the period. A hidden
    // field is a suggestion; this one decides how much money is expected.
    // Quoted against the plan being UPGRADED TO, pro-rated from the one being
    // held. Reading `subscript.plan_code` here would have quoted the current
    // plan against itself and billed the full price of the new one.
    const quote = store.upgradeQuote(channel, subscript.pending_plan_code);
    const amount = quote ? quote.amountNpr
      : (PLANS[subscript.pending_plan_code] || {}).priceNpr || 0;

    const payment = await store.recordPlanPayment({
      channelId: channel.id,
      amountNpr: amount,
      txnReference: reference,
      method: PAY_METHODS.includes(req.body.method) ? req.body.method : 'esewa',
      payerName: String(req.body.payerName || '').trim().slice(0, 120),
      payerNumber: String(req.body.payerNumber || '').trim().slice(0, 40),
    });
    if (!payment) return res.redirect(`${back}?error=nothing`);

    await store.audit('plan.payment_submitted', {
      channelId: channel.id, amountNpr: amount, reference, method: payment.method,
    });
    return res.redirect(`${back}?submitted=1`);
  } catch (err) { return next(err); }
});

/** The seller submits the transfer reference for this year's rent. */
APP.post('/dashboard/:slug/billing/rent-payment', async (req, res, next) => {
  try {
    const channel = await ownerChannel(req, res);
    if (!channel) return undefined;
    if (refuseWrite(req, res, channel)) return undefined;
    const back = `/dashboard/${encodeURIComponent(channel.slug)}/billing`;

    // Same gate as the plan upgrade, for the same reason: rent is matched by hand
    // too. Both are money IN; nothing else on the platform waits on an address.
    if (!req.user.email_verified_at) return res.redirect(`${back}?error=verify`);

    const reference = String(req.body.txnReference || '').trim().slice(0, 120);
    if (reference.length < 4) return res.redirect(`${back}?error=reference`);

    // A uuid check before the query: an empty or malformed id reaches Postgres as
    // a cast error, and a cast error is a 500 — which tells the seller the page
    // broke rather than that there is nothing to pay.
    const invoiceId = String(req.body.invoiceId || '');
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(invoiceId)) {
      return res.redirect(`${back}?error=nothing`);
    }

    const invoice = await store.submitRentPayment({
      invoiceId,
      channelId: channel.id,
      method: PAY_METHODS.includes(req.body.method) ? req.body.method : 'esewa',
      txnReference: reference,
      payerName: String(req.body.payerName || '').trim().slice(0, 120),
      payerNumber: String(req.body.payerNumber || '').trim().slice(0, 40),
    });
    if (!invoice) return res.redirect(`${back}?error=nothing`);

    await store.audit('rent.payment_submitted', {
      channelId: channel.id, invoiceId: invoice.id, amountNpr: invoice.amount_npr, reference,
    });
    // Its own key, not the plan flow's `submitted`: that sentence promises a plan
    // change, and rent does not change the plan.
    return res.redirect(`${back}?rent_submitted=1`);
  } catch (err) { return next(err); }
});

// ---------------------------------------------------------------------------
// Earnings — whose money it is
//
// Not a wallet and not a balance. The network pays the creator's own account;
// this page is where that is stated, where our estimate is put next to their
// statement, and where the creator records which of their own accounts the
// network pays into. Nothing here can move money, because bytebikri never has
// any of it.
// ---------------------------------------------------------------------------

/** Everything the earnings page shows, assembled once. */
async function earningsState(channel, days = 30) {
  // Names come from the WHOLE registry, not from the picker: a channel keeps
  // whatever it connected, and a provider gets disabled in the registry the
  // moment its account terms change. Reading names from the picker meant a
  // connected network rendered as its raw id the day it stopped being offered.
  const registry = await loadRegistry();
  const nameOf = (id) => registry.providers.find((p) => p.id === id)?.name || id;
  const provOf = (id) => registry.providers.find((p) => p.id === id) || null;
  const providers = await selectableProviders();
  const connections = await store.connectionsOf(channel.id);
  const plan = store.plan(channel);

  // The assumed rate and FX are read from slot policy, not re-declared here:
  // the earnings estimate and the rent estimate are arithmetic on the same
  // assumption, and this page exists to let a creator check that assumption.
  const rpmUsd = POLICY.assumedRpmUsd;
  const usdToNpr = POLICY.usdToNpr;

  const rows = await store.earningsByProvider({ channelId: channel.id, days, rpmUsd });
  const reports = await store.reportsOfChannel(channel.id);
  const withNames = rows.map((r) => ({
    ...r,
    provider_name: nameOf(r.provider_id),
    connected: connections.some((c) => c.provider_id === r.provider_id),
  }));

  const reportRows = reports.map((r) => ({ ...r, closed: periodStatus(r.period_end).closed }));

  const slots = await buildSlots(channel);
  const pageviews = await store.pageviews30d(channel.id);
  const estimate = estimateRentSlotValue({ pageviews30d: pageviews, slots });
  const invoice = await store.ensureRentInvoice({ channel, estimate });

  const totalViews = withNames.reduce((a, r) => a + Number(r.views), 0);

  // Every provider the channel is connected to, with its payout verdict, plus
  // the suggestion list of ones it could add.
  const providerCards = [...new Set(connections.map((c) => c.provider_id))]
    .map((id) => provOf(id)).filter(Boolean)
    .map((p) => ({ ...p, verdict: payoutVerdict(p), sandbox: SANDBOX_PROVIDER_IDS.has(p.id) }));

  return {
    plan, providers: providerCards, suggestions: providers, connections, reports: reportRows, rpmUsd, usdToNpr,
    invoice,
    summary: earningsSummary({
      rows: withNames,
      reports,
      rpmUsd,
      estimateUsd: (totalViews / 1000) * rpmUsd,
      rent: invoice?.amount_npr ?? 0,
      usdToNpr,
    }),
    byAsset: await store.earningsByAsset({ channelId: channel.id, days, rpmUsd }),
    payoutAccounts: await store.payoutAccountsOf(channel.id),
    days,
  };
}

/**
 * The attention ledger (ASSET_ECONOMY §12, slice 5).
 *
 * Owner-only, like every dashboard page, and read-only: two counters, no post route,
 * no money. It exists so that a flat rate for a direct deal has a number behind it and
 * so a seller can see whether a mid-roll is worth its interruption — while the block
 * that is OURS stays visibly ours.
 */
APP.get('/dashboard/:slug/attention', async (req, res, next) => {
  try {
    const channel = await ownerChannel(req, res);
    if (!channel) return undefined;
    const days = [7, 30, 90].includes(Number(req.query.days)) ? Number(req.query.days) : 30;
    const ledger = await store.attentionLedger(channel.id, { days });
    res.send(views.attentionLedger({
      channel, user: req.user, consent: req.consent, ledger, days,
    }));
  } catch (err) { return next(err); }
});

APP.get('/dashboard/:slug/earnings', async (req, res, next) => {
  try {
    const channel = await ownerChannel(req, res);
    if (!channel) return undefined;
    const state = await earningsState(channel);

    // The checklist is written for a provider the creator has actually
    // connected: telling somebody the sign-up steps for a network they are
    // already on is how a page reads as boilerplate.
    const activeProvider = state.providers.find((p) => state.connections.some((c) => c.provider_id === p.id));

    res.send(views.earnings({
      channel, user: req.user, consent: req.consent, flash: flashFor(req.query),
      plan: state.plan, summary: state.summary, byAsset: state.byAsset, days: state.days,
      connections: state.connections, providers: state.providers, suggestions: state.suggestions,
      sandboxIds: [...SANDBOX_PROVIDER_IDS],
      payoutAccounts: state.payoutAccounts, reports: state.reports,
      rent: state.invoice, usdToNpr: state.usdToNpr, rpmUsd: state.rpmUsd,
      moneyMap: MONEY_MAP,
      checklist: payoutChecklist(activeProvider?.name || 'the ad network you choose'),
    }));
  } catch (err) { return next(err); }
});

/** Record which of the creator's OWN accounts the network pays into. */
APP.post('/dashboard/:slug/earnings/payout', async (req, res, next) => {
  try {
    const channel = await ownerChannel(req, res);
    if (!channel) return undefined;
    if (refuseWrite(req, res, channel)) return undefined;
    const back = `/dashboard/${encodeURIComponent(channel.slug)}/earnings`;

    const providerId = String(req.body.providerId || '').trim().slice(0, 60);
    // Only a network the channel has actually connected: a payout label for a
    // provider that pays them nothing is a note about nothing.
    const connected = (await store.connectionsOf(channel.id)).some((c) => c.provider_id === providerId);
    if (!connected) return res.redirect(`${back}?error=nothing`);

    const account = await store.setPayoutAccount({
      channelId: channel.id,
      providerId,
      accountLabel: req.body.accountLabel,
      payoutMethod: req.body.payoutMethod,
    });
    if (!account) return res.redirect(`${back}?error=reference`);

    await store.audit('payout_account.declared', { channelId: channel.id, providerId });
    return res.redirect(`${back}?saved=1`);
  } catch (err) { return next(err); }
});

APP.post('/dashboard/:slug/earnings/payout/clear', async (req, res, next) => {
  try {
    const channel = await ownerChannel(req, res);
    if (!channel) return undefined;
    if (refuseWrite(req, res, channel)) return undefined;
    const back = `/dashboard/${encodeURIComponent(channel.slug)}/earnings`;
    await store.clearPayoutAccount({
      channelId: channel.id, providerId: String(req.body.providerId || '').slice(0, 60),
    });
    await store.audit('payout_account.cleared', { channelId: channel.id });
    return res.redirect(`${back}?saved=1`);
  } catch (err) { return next(err); }
});

/** The creator pastes what their statement said, so our estimate can be checked. */
APP.post('/dashboard/:slug/earnings/report', limitUnlock, async (req, res, next) => {
  try {
    const channel = await ownerChannel(req, res);
    if (!channel) return undefined;
    if (refuseWrite(req, res, channel)) return undefined;
    const back = `/dashboard/${encodeURIComponent(channel.slug)}/earnings`;

    const periodEnd = String(req.body.periodEnd || '');
    // A figure for a period that has not closed is not a figure: the network is
    // still adding to it, and comparing it against a full month of our counting
    // is how a creator concludes we over-count when we do not.
    if (periodStatus(periodEnd).closed === false && periodEnd >= new Date().toISOString().slice(0, 10)) {
      return res.redirect(`${back}?error=nothing`);
    }

    const report = await store.addProviderReport({
      channelId: channel.id,
      providerId: req.body.providerId,
      periodStart: req.body.periodStart,
      periodEnd,
      reportedUsd: req.body.reportedUsd,
      note: req.body.note,
    });
    if (!report) return res.redirect(`${back}?error=nothing`);

    await store.audit('provider_report.recorded', {
      channelId: channel.id, providerId: report.provider_id, reportedUsd: Number(report.reported_usd),
    });
    return res.redirect(`${back}?saved=1`);
  } catch (err) { return next(err); }
});

// ---------------------------------------------------------------------------
// Operator — matching money against the statement
//
// A page and not an API: this is the one place a human decision changes what
// somebody has paid for, so it should be visible, boring, and hard to do by
// accident. Behind `role = 'admin'`, which no seller account has.
// ---------------------------------------------------------------------------
APP.get('/admin/payments', async (req, res, next) => {
  try {
    if (!req.user) return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
    if (req.user.role !== 'admin') return res.status(404).send('Not found');
    res.send(views.operatorBilling({
      console: true,
      user: await withBadges(req.user), consent: req.consent, flash: flashFor(req.query),
      payments: await store.unmatchedPayments(),
      // The third charge, in the same queue as the other two. Kept as its own list
      // rather than merged into the store payments: the consequence of a match is
      // different (a look turns on, nothing opens), and an operator deciding about a
      // person's rupees should be able to see which product they bought.
      plusPayments: await store.customerPlanPayments({ limit: 50 }),
      // The console rows for the third charge, read from the ledger rather than
      // accumulated on the page.
      money: { ...(await store.platformMoney()), plusPrice: (await store.customerPlan(PLUS_CODE))?.price_npr ?? 149 },
      invoices: await store.openRentInvoices(),
      aging: await store.rentAging(),
      byMonth: await store.rentByMonth({ months: 12 }),
      payee: payeeName(),
    }));
  } catch (err) { return next(err); }
});

// The old address keeps working: it is in bookmarks, in the audit log, and in
// whatever the operator typed last week.
APP.get('/admin/billing', (req, res) => res.redirect('/admin/payments'));
// The action routes moved with the page. Old paths are kept as aliases rather
// than deleted: a form left open in a browser tab tomorrow would otherwise POST
// into a 404, and the operator would reasonably conclude the queue is broken.
APP.post('/admin/billing/plan/:id', (req, res) => res.redirect(307, `/admin/payments/plan/${encodeURIComponent(req.params.id)}`));
APP.post('/admin/billing/rent/:id', (req, res) => res.redirect(307, `/admin/payments/rent/${encodeURIComponent(req.params.id)}`));

APP.post('/admin/payments/plan/:id', async (req, res, next) => {
  try {
    if (!req.user || req.user.role !== 'admin') return res.status(404).send('Not found');
    if (req.body.action === 'reject') {
      await store.rejectPlanPayment({
        paymentId: req.params.id, actorId: req.user.id,
        reason: String(req.body.reason || '').trim().slice(0, 300),
      });
      await store.audit('plan.payment_rejected', { paymentId: req.params.id });
    } else {
      const matched = await store.matchPlanPayment({ paymentId: req.params.id, actorId: req.user.id });
      await store.audit('plan.payment_matched', { paymentId: req.params.id, ok: Boolean(matched) });
    }
    return res.redirect('/admin/payments');
  } catch (err) { return next(err); }
});

APP.post('/admin/payments/rent/:id', async (req, res, next) => {
  try {
    if (!req.user || req.user.role !== 'admin') return res.status(404).send('Not found');
    await store.matchRentPayment({
      invoiceId: req.params.id, actorId: req.user.id,
      note: String(req.body.note || '').trim().slice(0, 300) || null,
    });
    await store.audit('rent.payment_matched', { invoiceId: req.params.id });
    return res.redirect('/admin/payments');
  } catch (err) { return next(err); }
});

// ---------------------------------------------------------------------------
// Verification — the seller asks, a person records what they saw
// ---------------------------------------------------------------------------
// Three routes, and one rule shared by all of them: no document ever arrives here.
// The seller's route takes a note of logistics and nothing else, and the operator's
// route takes an OUTCOME. `seller_verifications.docs_retained` is checked to be
// false in the database, so a future change that tries to accept an upload fails
// at the column rather than quietly becoming a breach.

/**
 * The one door a document comes in through, used by both forms.
 *
 * The "ask for a check" form and the "hand it over" form post one file field to the
 * same rules, so the type check, the size check, the metadata strip and the audit
 * line exist once. What differs is only what happens to the request row afterwards.
 *
 * Returns `{ ok: true, mime, bytes, key }`, or `{ ok: false, code }` where the code
 * is a flash key — never a sentence, because query strings are echoed back to the
 * reader by the flash map and that map is the only writer of that text.
 */
async function takeDocument(req) {
  const file = req.file;
  if (!file) return { ok: false, code: null };              // nothing sent is not a refusal
  // The header is a claim; the bytes decide. A PDF or an SVG is refused by name.
  const mime = sniff(file.buffer);
  if (!mime || !ALLOWED_TYPES[mime]) return { ok: false, code: 'doc-type' };
  if (file.size > MAX_BYTES) return { ok: false, code: 'doc-too-big' };
  // The camera's own notes — GPS, device, timestamp — are removed BEFORE the write,
  // so the page's promise is true of the bytes on disk and not only of the response.
  const cleaned = stripMetadata(file.buffer, mime);
  if (!cleaned.length) return { ok: false, code: 'doc-type' };
  const key = await storage.put(cleaned, `document.${extFor(mime)}`, { namespace: 'kyc' });
  return { ok: true, mime, bytes: cleaned.length, key };
}

APP.post('/dashboard/:slug/verification', documentUpload((req, qs) =>
  `/dashboard/${encodeURIComponent(req.params.slug)}/settings?${qs}#verification`), async (req, res, next) => {
  // Query before fragment: `#verification?error=check-plan` never reaches the
  // server, so a seller on the free plan would be bounced back to a form with no
  // explanation at all — the exact silent-refusal failure this route's flash keys
  // were disambiguated to prevent.
  const back = (qs = '') => `/dashboard/${encodeURIComponent(req.params.slug)}/settings${qs ? `?${qs}` : ''}#verification`;
  try {
    const channel = await ownerChannel(req, res);
    if (!channel) return undefined;
    // A store the platform has withheld is not asking for identity paperwork.
    if (refuseWrite(req, res, channel)) return undefined;

    const plan = store.plan(channel);
    const current = await store.verificationFor(channel.id);
    const open = await store.pendingVerificationFor(channel.id);
    // The same two facts the panel on the page was rendered from — pending and
    // whether the live check is inside its window. This route used to pass neither,
    // which meant the "Ask for the next check" button the panel offers inside the
    // window was refused by the handler with "Already checked.": the form and the
    // thing that receives it have to answer the same question the same way.
    const ask = requestability({
      capabilities: plan.capabilities,
      state: stateOf(current),
      pending: Boolean(open),
      lapsing: withinNoticeWindow(lapseOf(current)),
    });
    // A code, never the sentence: query strings are echoed back to the reader by
    // the flash map, and that map is the only writer of that text.
    // `requestability` answers with a DOMAIN code, and `plan` is the right one for
    // "your plan does not include this". But the upgrade flow already owns the
    // `plan` flash message — and it was declared LATER in the map, so the upgrade
    // sentence silently shadowed this one and a seller on the free plan was told
    // "That plan is not available from your current one." on a form that has no
    // plans on it. The code stays honest; only the flash key is disambiguated.
    const FLASH_CODE = { plan: 'check-plan' };
    if (!ask.ok) {
      const code = FLASH_CODE[ask.code] || ask.code || 'not-now';
      return res.redirect(back(`error=${encodeURIComponent(code)}`));
    }

    // Logistics only. Anything that looks like a document number is refused with
    // an explanation rather than stored: this form must never become the place the
    // evidence lands, and a person pasting one has not been told that yet.
    const note = String(req.body?.note || '').trim().slice(0, 280);
    if (/\d{6,}/.test(note)) return res.redirect(back('error=no-numbers'));
    if (/\b(citizenship|pan|passport)\b[^.]{0,20}\b(no|number|num)\b/i.test(note)) {
      return res.redirect(back('error=no-numbers'));
    }

    const doc = await takeDocument(req);
    if (!doc.ok && doc.code) return res.redirect(back(`error=${doc.code}`));

    const done = await store.askForVerification({ channelId: channel.id, note });
    await store.audit('seller.verification_requested', { channelId: channel.id });

    // A file sent WITH an ask that could not open a request has nowhere to live: the
    // document hangs off the request row, and there is no request. So it is destroyed
    // rather than left on disk with nothing pointing at it — a stored document nobody
    // can find is the exact thing this flow exists not to produce.
    if (doc.ok) {
      const attached = await store.attachVerificationDocument({
        channelId: channel.id, key: doc.key, mime: doc.mime, bytes: doc.bytes, actorId: req.user.id,
      });
      if (!attached.ok) await storage.remove(doc.key);
    }
    const saved = done.ok
      ? (doc.ok ? 'asked-with-doc' : 'asked')
      : (doc.ok ? 'already-with-doc' : 'already');
    return res.redirect(back(`saved=${saved}`));
  } catch (err) { return next(err); }
});

/**
 * Hand the document over for a request that is already open.
 *
 * Two steps, because the request has to exist first: the document lives on the
 * request row, and a document with nothing to be checked against is a liability
 * with no purpose. Sending a second one replaces the first and destroys it in the
 * same call — "I sent the wrong page" must not leave the wrong page on disk for the
 * rest of the week.
 */
APP.post('/dashboard/:slug/verification/document', documentUpload((req, qs) =>
  `/dashboard/${encodeURIComponent(req.params.slug)}/settings?${qs}#verification`), async (req, res, next) => {
  const back = (qs = '') => `/dashboard/${encodeURIComponent(req.params.slug)}/settings${qs ? `?${qs}` : ''}#verification`;
  try {
    const channel = await ownerChannel(req, res);
    if (!channel) return undefined;
    if (refuseWrite(req, res, channel)) return undefined;
    const open = await store.pendingVerificationFor(channel.id);
    if (!open) return res.redirect(back('error=doc-no-request'));

    const doc = await takeDocument(req);
    if (!doc.ok) return res.redirect(back(`error=${doc.code || 'doc-none'}`));

    const attached = await store.attachVerificationDocument({
      channelId: channel.id, key: doc.key, mime: doc.mime, bytes: doc.bytes, actorId: req.user.id,
    });
    if (!attached.ok) {
      await storage.remove(doc.key);
      return res.redirect(back('error=doc-no-request'));
    }
    return res.redirect(back(open.document_key ? 'saved=doc-replaced' : 'saved=doc'));
  } catch (err) { return next(err); }
});

/**
 * The operator's window onto a held document — and the only way to read one.
 *
 * Four properties, and each is a decision rather than a default:
 *
 *   - it is looked up by the REQUEST's id, never by the storage key. A URL carrying
 *     a key is a URL that can be guessed, pasted into a chat, and found in a log;
 *   - `private, no-store` and `noindex`, because a cached identity document is a
 *     copy nobody decided to make and nobody can delete;
 *   - `inline` with the stored type, so it renders as a picture and never as a
 *     download of unknown content with a filename the browser will trust;
 *   - and every open writes an audit line with the operator's name on it, which is
 *     the whole accountability story: the seller is told a person may look, and the
 *     record says which person did.
 */
APP.get('/admin/verification/:id/document', async (req, res, next) => {
  try {
    if (!req.user || req.user.role !== 'admin') return res.status(404).end();
    const row = await store.verificationDocumentById(req.params.id);
    if (!row || !row.document_key) return res.status(404).end();
    const bytes = await storage.get(row.document_key);
    await store.audit('seller.verification_document_opened',
      { channelId: row.channel_id, requestId: row.id, bytes: row.document_bytes },
      { actorId: req.user.id, subjectType: 'channel', subjectId: row.channel_id });
    res.setHeader('content-type', row.document_mime);
    res.setHeader('cache-control', 'private, no-store, max-age=0');
    res.setHeader('x-robots-tag', 'noindex, nofollow');
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('content-disposition', `inline; filename="document.${extFor(row.document_mime) || 'bin'}"`);
    res.send(bytes);
  } catch (err) {
    if (err.code === 'ENOENT' || /bad storage key/.test(err.message)) return res.status(404).end();
    return next(err);
  }
});

APP.post('/dashboard/:slug/verification/withdraw', async (req, res, next) => {
  const back = (qs = '') => `/dashboard/${encodeURIComponent(req.params.slug)}/settings${qs ? `?${qs}` : ''}#verification`;
  try {
    const channel = await ownerChannel(req, res);
    if (!channel) return undefined;
    // `withdrawVerificationRequest` destroys any held copy BEFORE it deletes the
    // request: the row is the only pointer to the bytes, and a pointer nobody has is
    // a file nobody can destroy.
    const had = await store.pendingVerificationFor(channel.id);
    await store.withdrawVerificationRequest(channel.id);
    await store.audit('seller.verification_withdrawn',
      { channelId: channel.id, hadDocument: Boolean(had?.document_key) });
    return res.redirect(back(had?.document_key ? 'saved=withdrawn-doc' : 'saved=withdrawn'));
  } catch (err) { return next(err); }
});

APP.post('/admin/stores/:slug/verification', async (req, res, next) => {
  // Query BEFORE the fragment. `#verification?saved=x` reads to the browser as a
  // fragment called "verification?saved=x" — the parameter is never sent, the flash
  // never appears, and the page just looks like nothing happened. Every route that
  // returns to a section anchors from the outside like this.
  const back = (qs = '') => `/admin/stores/${encodeURIComponent(req.params.slug)}${qs ? `?${qs}` : ''}#verification`;
  try {
    if (!req.user || req.user.role !== 'admin') return res.status(404).send('Not found');
    const channel = await store.channelBySlug(req.params.slug);
    if (!channel) return res.status(404).send('Channel not found');

    const outcome = req.body?.outcome === 'rejected' ? 'rejected' : 'verified';
    const method = METHODS.some((m) => m.code === req.body?.method) ? req.body.method : 'manual';
    const months = [12, 24, 36].includes(Number(req.body?.months)) ? Number(req.body.months) : DEFAULT_MONTHS;
    const notes = String(req.body?.notes || '').trim().slice(0, 500);

    await store.recordVerification({
      channelId: channel.id, outcome, method, actorId: req.user.id, months, note: notes,
    });
    // The audit line records the DECISION, never what was in the note beyond a
    // cue — the note itself is on the outcome row, and the audit log is read by
    // more people than the console.
    await store.audit(outcome === 'verified' ? 'seller.verification_recorded' : 'seller.verification_refused',
      { channelId: channel.id, method, months });
    return res.redirect(back(`saved=${outcome}`));
  } catch (err) { return next(err); }
});

/**
 * Tell a seller their identity check is ending.
 *
 * Sent from the store's own page, by a person, about the check that is on screen —
 * and recorded on that check, so the list cannot ask twice. The order is claim →
 * send → release-if-nothing-was-written: two operators either side of a slow page
 * load must not both mail somebody, and a claim with no message behind it must not
 * survive, because the next person to work the list would skip a seller nobody has
 * actually contacted.
 */
APP.post('/admin/stores/:slug/verification/notice', async (req, res, next) => {
  const back = (qs = '') => `/admin/stores/${encodeURIComponent(req.params.slug)}${qs ? `?${qs}` : ''}#verification`;
  try {
    if (!req.user || req.user.role !== 'admin') return res.status(404).send('Not found');
    const channel = await store.channelBySlug(req.params.slug);
    if (!channel) return res.status(404).send('Channel not found');

    const current = await store.verificationFor(channel.id);
    if (!lapseOf(current)) return res.redirect(back('error=no-check'));

    const claimed = await store.markVerificationNotice({ verificationId: current.id, actorId: req.user.id });
    if (!claimed) return res.redirect(back('error=already-noticed'));

    const sent = await sendLapseNotice({ channel, verification: current });
    if (!sent.id) {
      // Nothing was written down, so nothing was said. Take the claim back.
      await store.releaseVerificationNotice(current.id);
      return res.redirect(back('error=not-sent'));
    }
    await store.audit('seller.verification_notice_sent',
      { channelId: channel.id, method: current.method, days: sent.days, delivered: Boolean(sent.delivered) });
    // `delivered` false is the console driver, which is not a failure — the flash
    // says what happened either way rather than implying a mail left the building.
    return res.redirect(back(`saved=${sent.delivered ? 'noticed' : 'noticed-logged'}`));
  } catch (err) { return next(err); }
});

// ---------------------------------------------------------------------------
// Store settings
// ---------------------------------------------------------------------------
APP.get('/dashboard/:slug/settings', async (req, res, next) => {
  try {
    const channel = await ownerChannel(req, res);
    if (!channel) return undefined;
    const plan = store.plan(channel);
    res.send(views.storeSettings({
      channel, user: req.user, consent: req.consent, flash: flashFor(req.query),
      plan,
      // Two facts, two reads. `verification` is the STANDING outcome (what the
      // badge rests on, and what an operator recorded last) and `pendingRequest` is
      // whether there is an open request — a seller can be waiting on the next check
      // while the current one still counts, and the panel has to be able to say both.
      verification: await store.verificationFor(channel.id),
      // A held document outlives its week only if nothing sweeps it, and this is one
      // of the two pages that can show one — so the sweep runs here, and twice is
      // free because the second call matches nothing.
      pendingRequest: await heldRequest(channel.id, { sweep: true }),
      capabilities: plan.capabilities,
      // Whether the marketplace is REACHABLE, not just whether the box is
      // ticked: a free store that asks for it gets an explanation, not a
      // silent revert to storefront.
      canList: plan.capabilities.marketplace_listed === true,
      // The look of the store. `canTheme` reads the capability the plans table has
      // been carrying since 0001 — and the page says what a plan would add rather
      // than hiding the control a Free store cannot use.
      themes: THEME_KEYS.map((k) => THEMES[k]),
      canTheme: canTheme(plan.capabilities),
      subscription: await store.subscriptionOf(channel.id),
      stats: await store.reviewStatsOfChannel(channel.id),
    }));
  } catch (err) { return next(err); }
});

APP.post('/dashboard/:slug/settings', upload.single('banner'), async (req, res, next) => {
  const back = () => `/dashboard/${encodeURIComponent(req.params.slug)}/settings`;
  try {
    const channel = await ownerChannel(req, res);
    if (!channel) return undefined;
    if (refuseWrite(req, res, channel)) return undefined;
    const fail = (code) => res.redirect(`${back()}?error=${encodeURIComponent(code)}`);

    const name = String(req.body.name || '').trim();
    if (!name) return fail('name');

    const plan = store.plan(channel);
    const wantsListing = req.body.listingMode === 'marketplace';
    // The capability check lives here, where the plan is known: the marketplace
    // is bytebikri's traffic, so listing is what the paid tiers buy.
    if (wantsListing && plan.capabilities.marketplace_listed !== true) return fail('listing');

    const banner = req.file;
    if (banner && !String(banner.mimetype).startsWith('image/')) return fail('banner');
    if (banner && banner.size > 5 * 1024 * 1024) return fail('banner');

    await store.updateChannel(channel.id, {
      name,
      tagline: String(req.body.tagline || '').trim(),
      about: String(req.body.about || '').trim(),
      channel_contact: String(req.body.channelContact || '').trim(),
      listing_mode: wantsListing ? 'marketplace' : 'storefront',
      ads_enabled: req.body.adsEnabled === 'on',
      sells_digital: req.body.sellsDigital === 'on',
      sells_physical: req.body.sellsPhysical === 'on',
      ...(banner
        ? { banner_url: `/media/${await storage.put(banner.buffer, banner.originalname, { namespace: 'public' })}` }
        : {}),
    });

    await store.audit('channel.settings_updated', { channelId: channel.id });
    return res.redirect(`${back()}?saved=1`);
  } catch (err) {
    if (err.code === 'LIMIT_FILE_SIZE' || err.code === 'LIMIT_UNEXPECTED_FILE') return res.redirect(`${back()}?error=banner`);
    return next(err);
  }
});

// ---------------------------------------------------------------------------
// Reviews — written only by someone who unlocked the thing
// ---------------------------------------------------------------------------
APP.post('/s/:slug/a/:assetSlug/review', limitUnlock, async (req, res, next) => {
  const here = () => `/s/${encodeURIComponent(req.params.slug)}/a/${encodeURIComponent(req.params.assetSlug)}`;
  try {
    if (!req.user) return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
    const channel = await store.channelBySlug(req.params.slug);
    if (!channel) return res.status(404).send('Channel not found');
    const asset = await store.assetBySlug(channel.id, req.params.assetSlug);
    if (!asset) return notFoundPage(req, res, 'file');

    /**
     * The gate is the unlock row, not the form.
     *
     * `unlockFor` returns null for anyone who never got the file, so a review
     * cannot be written by a passer-by — which is the only thing that makes a
     * star average worth reading. It is also why a revoked unlock takes its
     * review with it: `reviews.unlock_id` cascades.
     */
    const unlock = await store.unlockFor(asset.id, req.user.id);
    if (!unlock) return res.redirect(`${here()}?error=unlock`);

    const rating = Number(req.body.rating);
    if (!(rating >= 1 && rating <= 5)) return res.redirect(`${here()}?error=rating`);

    await store.addReview({
      unlockId: unlock.id, assetId: asset.id, channelId: channel.id,
      buyerId: req.user.id, rating, body: req.body.body,
    });
    await store.audit('review.written', { assetId: asset.id, channelId: channel.id, rating });
    return res.redirect(`${here()}?reviewed=1`);
  } catch (err) { return next(err); }
});

APP.get('/dashboard/:slug/reviews', async (req, res, next) => {
  try {
    const channel = await ownerChannel(req, res);
    if (!channel) return undefined;
    res.send(views.dashboardReviews({
      channel, user: req.user, consent: req.consent, flash: flashFor(req.query),
      reviews: await store.reviewsOfChannel(channel.id),
      stats: await store.reviewStatsOfChannel(channel.id),
    }));
  } catch (err) { return next(err); }
});

APP.post('/dashboard/:slug/reviews/:reviewId', async (req, res, next) => {
  try {
    const channel = await ownerChannel(req, res);
    if (!channel) return undefined;
    if (refuseWrite(req, res, channel)) return undefined;
    const response = String(req.body.response || '').trim();
    if (response) {
      await store.respondToReview({
        reviewId: req.params.reviewId, channelId: channel.id, response,
      });
      await store.audit('review.responded', { reviewId: req.params.reviewId, channelId: channel.id });
    }
    return res.redirect(`/dashboard/${encodeURIComponent(channel.slug)}/reviews`);
  } catch (err) { return next(err); }
});

// ---------------------------------------------------------------------------
// One asset, from the seller's side
// ---------------------------------------------------------------------------
APP.get('/dashboard/:slug/assets/:assetId', async (req, res, next) => {
  try {
    const channel = await ownerChannel(req, res);
    if (!channel) return undefined;
    const asset = await store.assetById(req.params.assetId);
    if (!asset || asset.channel_id !== channel.id) return res.status(404).send('Not found');
    // The two lists on the availability panel, split by who decided: a creator
    // can clear their own rule and cannot clear the platform's.
    const allCountryRules = await store.assetCountryRules(asset.id);
    const membershipsOn = store.plan(channel).capabilities?.memberships === true;
    /*
     * The live panel's data (§14).
     *
     * Only for a file that IS a stream, because a live panel on a video would be a
     * button that promises a break nothing can stop. `callable` is the honest part:
     * every length the panel offers is checked against the four caps HERE, with the
     * reason it is not available, so a seller sees why the 15-second button is grey
     * instead of pressing it and being bounced.
     */
    const liveShape = await store.shapeOf(asset);
    let livePanel = null;
    if (liveShape === 'stream') {
      const now = new Date();
      const breaks = await store.liveBreaksOf(asset.id);
      livePanel = {
        url: asset.external_url,
        breaks,
        open: breaks.find((b) => windowIsOpen(b, now)) || null,
        lengths: LIVE_LENGTHS,
        callable: Object.fromEntries(LIVE_LENGTHS.map((seconds) => [
          seconds, liveBreakRefusal({ seconds, breaks, now }),
        ])),
        trade: Object.fromEntries(LIVE_LENGTHS.map((seconds) => [seconds, tradeSentence(seconds)])),
        cleanUntil: cleanEntryUntil(breaks, now),
      };
    }
    res.send(views.assetManage({
      channel, asset, user: req.user, consent: req.consent, flash: flashFor(req.query),
      // The two facts the access control needs: whether the plan includes members
      // at all, and which tiers exist to put a file behind.
      membershipsOn,
      tiers: membershipsOn ? await store.membershipTiers(channel.id) : [],
      planCode: store.effectivePlanCode(channel),
      // `hosted` is added here for the same reason `planCode` is computed here: the
      // view renders synchronously and reads no storage key (`VIDEO_STORAGE.md` §8).
      files: (await store.filesOf(asset.id)).map((f) => ({ ...f, hosted: storage.isRemote(f.storage_key) })),
      // The page count, so the seller's plan panel asks the planner the same
      // question the buyer's page does: a forty-page comic has room for a break
      // after page 13, and the panel used to be told it had one chapter.
      pages: await store.assetPagePlan(asset),
      policy: await store.unlockPolicy(asset.id),
      stats: await store.reviewStatsOfAsset(asset.id),
      unlocks: (await store.unlocksOfChannel(channel.id)).filter((u) => u.asset_id === asset.id).length,
      caseFile: await store.fileCase(asset.id),
      appeals: await store.appealsOfChannel(channel.id).then((all) => all.filter((a) => a.asset_id === asset.id)),
      // Only when something was actually decided, so an ordinary page view costs
      // no query — and the seller sees the same record the console does, which is
      // the only version of "you were told" that is worth anything.
      decision: asset.moderation_state === 'approved'
        ? null
        : (await store.fileDecisionHistory(asset.id))[0] ?? null,
      countryRules: allCountryRules.filter((r) => r.source === 'creator'),
      platformRules: allCountryRules.filter((r) => r.source !== 'creator'),
      live: livePanel,
    }));
  } catch (err) { return next(err); }
});

APP.post('/dashboard/:slug/assets/:assetId', async (req, res, next) => {
  try {
    const channel = await ownerChannel(req, res);
    if (!channel) return undefined;
    if (refuseWrite(req, res, channel)) return undefined;
    const back = `/dashboard/${encodeURIComponent(channel.slug)}/assets/${encodeURIComponent(req.params.assetId)}`;
    const asset = await store.assetById(req.params.assetId);
    if (!asset || asset.channel_id !== channel.id) return res.status(404).send('Not found');

    const title = String(req.body.title || '').trim().slice(0, 200);
    if (!title) return res.redirect(`${back}?error=title`);

    // Three ways in for a file, and the tier only exists in the third: a file
    // cannot be ad-gated and secretly tiered, which the database also refuses.
    const wantsMembers = req.body.unlockMode === 'members'
      && store.plan(channel).capabilities?.memberships === true;
    const memberTier = wantsMembers ? (Number(req.body.memberTier) === 2 ? 2 : 1) : 0;

    /*
     * "Free, with a break inside" — offered only where it can be kept.
     *
     * Two conditions, and both are the product's own rules rather than this
     * route's opinion: the shape must have a player the gate can stop (`watch` or
     * `listen`), and the plan must actually place a break. A file whose length the
     * player has not measured yet places nothing, and a `breaks` file with no cues
     * would be a FREE file — which is not what the seller chose, and quietly
     * giving content away under a label about ads is the worst kind of surprise.
     * So the request is refused with a reason and the door stays.
     */
    const shape = await store.shapeOf(asset);
    const wantsBreaks = req.body.unlockMode === 'breaks';
    /*
     * The plan is computed from a COPY carrying the value the seller just typed,
     * not the stored one. `adPlanFor` reads the ask out of the policy row, which is
     * still calibrated to the old value at this point in the route — so asking it
     * directly would refuse a switch to `breaks` on the strength of a number the
     * seller is in the middle of replacing.
     */
    const asSaved = { ...asset, declared_value_npr: Number(req.body.valueNpr) || 0 };
    const plan = wantsBreaks ? await store.adPlanFor(asSaved, { membersOnly: false }) : null;
    // A stop is counted where it can be honoured: a reader's plan carries between
    // cues, and a player's carries timestamps. Counting only the timestamps made a
    // forty-page comic unable to choose the mode its own planner had planned for.
    const stops = shape === 'read' ? betweenCues(plan) : breakCues(plan ?? {});
    const breaksOk = Boolean(plan) && breaksSupported(shape) && stops.length > 0;
    if (wantsBreaks && !breaksOk) {
      // The title and description still save: a seller who chose the wrong mode
      // should not lose their typing over it.
      await store.updateAsset(asset.id, {
        title,
        description: String(req.body.description || '').trim().slice(0, 2000),
        declared_value_npr: req.body.valueNpr,
      });
      return res.redirect(`${back}?error=no-breaks`);
    }

    /*
     * How the file reads — the reader's two choices (§13).
     *
     * They come from the SAME form as everything else, so there is no second save
     * button and no way to change how a file reads while leaving the title half-typed.
     * Only a file a reader opens carries them: on a video they would be two switches
     * wired to nothing, and a body carrying them for one is a hand-crafted post, so it
     * is refused with a sentence instead of ignored.
     *
     * Invalid values are refused rather than defaulted. Defaulting would be the worse
     * bug of the two: a body saying `readMode=diagonal` would silently reset a manga
     * to left-to-right. The refusal is checked HERE, before anything is written, so a
     * bad request moves nothing at all rather than half-saving the form.
     */
    const readSubmitted = req.body.readMode !== undefined || req.body.readDirection !== undefined;
    if (readSubmitted && shape !== 'read') return res.redirect(`${back}?error=read-shape`);
    const readChoices = readSubmitted
      && READ_MODES.includes(req.body.readMode) && READ_DIRECTIONS.includes(req.body.readDirection)
      ? { mode: req.body.readMode, direction: req.body.readDirection }
      : null;
    if (readSubmitted && !readChoices) return res.redirect(`${back}?error=read-choices`);
    const readChanged = readChoices && (readChoices.mode !== readMode(asset.read_mode)
      || readChoices.direction !== readDirection(asset.read_direction));

    await store.updateAsset(asset.id, {
      title,
      description: String(req.body.description || '').trim().slice(0, 2000),
      unlock_mode: wantsBreaks ? 'breaks' : req.body.unlockMode === 'open' ? 'open' : wantsMembers ? 'members' : 'ad_gated',
      member_tier: memberTier,
      status: req.body.status === 'paused' ? 'paused' : 'live',
      // Saved BEFORE the policy below, and the order is the whole point: the ask is
      // derived from this value, so setting the policy first would calibrate the
      // ask against the price the seller just replaced.
      declared_value_npr: req.body.valueNpr,
    });
    await store.setUnlockPolicy(asset.id, {
      // Only the CHOICE travels. The numbers are derived in setUnlockPolicy, so a
      // hand-crafted post cannot ask for ten minutes of somebody's evening.
      ask_level: req.body.adAsk,
      unlock_hours: req.body.unlockHours,
      // The same value that was just written to the asset, so the two rows that
      // carry this one decision cannot drift apart.
      mode: wantsBreaks ? 'breaks' : req.body.unlockMode === 'open' ? 'open' : wantsMembers ? 'members' : 'ad_gated',
    });
    /*
     * Which of the shape's placements this file keeps.
     *
     * An unchecked box is not in the body at all, so the submitted set IS the
     * answer — and `setAdPlan` filters it against what the file's shape actually
     * has. A five-into-three problem (the body says `placement=mid` twice) is
     * impossible here because the name is not repeated, and a hand-crafted body
     * naming a placement this shape does not have is dropped rather than refused:
     * the seller's page never offered it, so there is nothing to explain.
     *
     * The panel is only rendered for shapes that have timed placements, so a
     * download's save must not wipe the choices its shape would have had if it
     * were, say, a video. That is why the array is only read when the file has a
     * placement panel at all — see `placementChoicesSubmitted`.
     */
    if (placementPanelShown(shape)) {
      const submitted = [].concat(req.body.placement ?? []);
      const choices = {};
      for (const key of submitted) choices[String(key)] = true;
      await store.setAdPlan(asset.id, choices);
    }
    if (readChoices) {
      await store.setReadChoices({ assetId: asset.id, mode: readChoices.mode, direction: readChoices.direction });
    }
    await store.audit('asset.updated', { assetId: asset.id, channelId: channel.id });
    // The reader's own sentence, because "Saved." would not say that the file now
    // turns its pages a different way — and that is the whole of what changed.
    if (readChanged) return res.redirect(`${back}?saved=read-choices`);
    return res.redirect(`${back}?saved=1`);
  } catch (err) { return next(err); }
});

/*
 * The live panel's one write: where the stream is, and the break the store calls.
 *
 * One route with an action, because they are one decision — "this file is a stream, and
 * this is the break I am running right now" — and because a second endpoint for the
 * button would be a second place for the four caps to drift.
 *
 * WHAT IS NOT HERE, AND IT IS THE POINT: no schedule, no timer, no "break in 30
 * minutes" row, nothing that opens a window by itself. A break exists only because
 * the store's own request created it, which is what makes "the platform never inserts
 * one" (placement rule 4, ASSET_ECONOMY §14.3) a property of this code rather than a
 * promise about our intentions.
 */
APP.post('/dashboard/:slug/assets/:assetId/live', async (req, res, next) => {
  try {
    const channel = await ownerChannel(req, res);
    if (!channel) return undefined;
    const asset = await store.assetById(req.params.assetId);
    if (!asset || asset.channel_id !== channel.id) return res.status(404).send('Not found');
    const back = `/dashboard/${encodeURIComponent(channel.slug)}/assets/${asset.id}`;
    const action = String(req.body.action || '');
    // The shape, computed the one way it is computed everywhere (media.js reads
    // `external_url` first): a break belongs to a file whose bytes are somebody else's
    // live stream. Without this the panel's own wording was the only thing keeping a
    // hand-crafted POST from calling a break on a CBZ, and the server would have
    // cheerfully created a window no player in the world would ever show.
    const files = await store.filesOf(asset.id);
    const shape = assetShape(files, { url: asset.external_url });

    if (action === 'set-url') {
      const url = String(req.body.externalUrl || '').trim();
      if (!url) {
        await store.setExternalUrl({ assetId: asset.id, url: null });
        return res.redirect(`${back}?saved=live-url`);
      }
      // An HLS playlist, over https or same-origin. `isLiveUrl` is the shape's own
      // predicate for what a playlist is; the scheme check is the promise §14.1 made —
      // no ingest and no re-host, so no `rtmp://` and no plain http.
      if (!isLiveUrl(url) || !(url.startsWith('https://') || url.startsWith('/'))) {
        return res.redirect(`${back}?error=live-url`);
      }
      // A file with uploads cannot also be a stream: the shape code gives a live URL
      // precedence, so the uploads would become unreachable the moment this saved.
      // Refused rather than half-applied, and the sentence says which.
      if (files.length) return res.redirect(`${back}?error=live-files`);
      await store.setExternalUrl({ assetId: asset.id, url });
      await store.audit('asset.live_url_set', { assetId: asset.id, channelId: channel.id });
      return res.redirect(`${back}?saved=live-url`);
    }

    if (action === 'call-break') {
      if (shape !== 'stream') return res.redirect(`${back}?error=live-shape`);
      const seconds = Math.floor(Number(req.body.seconds) || 0);
      const breaks = await store.liveBreaksOf(asset.id);
      // The caps, checked in the module that owns them — the same call the panel made
      // to grey the button, so a hand-crafted post cannot open a break the UI refused.
      if (liveBreakRefusal({ seconds, breaks, now: new Date() })) {
        return res.redirect(`${back}?error=live-break`);
      }
      // One clock for the whole window: the process that decided this break was
      // being called stamps both ends, and everything downstream reads those two.
      const startedAt = new Date();
      try {
        await store.createLiveBreak({
          assetId: asset.id, channelId: channel.id, userId: req.user.id,
          cueIndex: nextCueIndex(breaks), seconds,
          startedAt, endsAt: windowEndsAt(seconds, startedAt),
          note: String(req.body.note || '').trim().slice(0, 140) || null,
        });
      } catch (err) {
        // Two presses at the same moment, or a race against the partial unique index:
        // one open window per file is the rule, and losing that race is not a 500.
        if (err?.code !== '23505') throw err;
        return res.redirect(`${back}?error=live-break`);
      }
      await store.audit('asset.live_break_called', { assetId: asset.id, channelId: channel.id, seconds });
      return res.redirect(`${back}?saved=live-break`);
    }

    if (action === 'close-break') {
      if (shape !== 'stream') return res.redirect(`${back}?error=live-shape`);
      const closed = await store.closeLiveBreak({ assetId: asset.id, breakId: req.body.breakId });
      if (!closed) return res.redirect(`${back}?error=live-break`);
      await store.audit('asset.live_break_closed', { assetId: asset.id, channelId: channel.id });
      return res.redirect(`${back}?saved=live-closed`);
    }

    return res.redirect(`${back}?error=live-action`);
  } catch (err) { return next(err); }
});

// Ad connections
// ---------------------------------------------------------------------------
/*
 * There is no `POST /api/ad-connections/start` here any more, and there should
 * not be.
 *
 * It minted the verification secret ITSELF — a random string the network has
 * never seen — and then marked the connection `active`, which is a connection
 * that can never verify a single callback while the dashboard shows a green
 * tick. It also hardcoded its own callback base to `127.0.0.1`, so the URL it
 * handed out was unreachable by the network from the first minute.
 *
 * The real flow is `POST /dashboard/:slug/networks`: it walks the network's own
 * onboarding steps, accepts only the secret the network issued, keeps the
 * connection `verifying` until one arrives, and builds the callback URL from the
 * registry's dialect. Its revoke checks ownership; the old one did not, which is
 * how a stranger could disconnect somebody else's account.
 */

// ---------------------------------------------------------------------------
// Reports — a buyer says a file is wrong
// ---------------------------------------------------------------------------
/**
 * File a report.
 *
 * What this route does NOT do is hide anything, unless the threshold is reached —
 * and the threshold is the point. One report that could hide a file would hand
 * every seller a weapon against every other seller, and the check is
 * `AUTO_HIDE_AFTER` distinct reporters, one per person, enforced by a unique
 * index rather than by the route counting carefully.
 */
/**
 * Reporting is the one endpoint on this platform where a stranger can change
 * something about somebody else's store, and it had no limiter. Three distinct
 * reports hide a file, and "distinct" means distinct ACCOUNTS — so the cost of a
 * targeted takedown was three throwaway sign-ups. The limiter does not fix that
 * arithmetic; it stops one account from being the whole attack on its own, and it
 * bounds a bad client that loops.
 *
 * Six an hour is generous for a person reading a storefront and stingy for a
 * script, and it is per account and per address like every other limiter here.
 */
const limitReport = rateLimit({
  windowMs: 60 * 60_000, max: 6, name: 'reports',
  render: (info) => views.tooMany({ ...info, consent: null }),
});

APP.post('/s/:slug/a/:assetSlug/report', limitReport, async (req, res, next) => {
  const back = `/s/${encodeURIComponent(req.params.slug)}/a/${encodeURIComponent(req.params.assetSlug)}`;
  try {
    if (!req.user) return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
    const channel = await store.channelBySlug(req.params.slug);
    if (!channel) return res.status(404).send('Channel not found');
    const asset = await store.assetBySlug(channel.id, req.params.assetSlug);
    if (!asset) return notFoundPage(req, res, 'file');

    const check = validateReport({
      reason: req.body?.reason, note: req.body?.note,
      reporterId: req.user.id, ownerId: channel.owner_id,
    });
    if (!check.ok) return res.redirect(`${back}?report=${check.error}`);

    const result = await store.fileReport({
      assetId: asset.id, channelId: channel.id, reporterId: req.user.id,
      reason: check.reason, note: check.note,
    });

    await store.audit('asset.reported', {
      assetId: asset.id, channelId: channel.id, reason: check.reason,
      reporters: result.reporters, filed: result.filed,
    }, { actorId: req.user.id, subjectType: 'asset', subjectId: asset.id });

    // The threshold. Reached only by distinct reporters, and it does not touch
    // the seller's plan, their money or their account — it changes the FILE.
    if (result.reporters >= AUTO_HIDE_AFTER && asset.status === 'live') {
      await store.hideByReports(asset.id);
      await store.audit('asset.hidden_by_reports', {
        assetId: asset.id, reporters: result.reporters, threshold: AUTO_HIDE_AFTER,
      }, { subjectType: 'asset', subjectId: asset.id });
    }

    res.redirect(`${back}?reported=1`);
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Moderation — the operator side
// ---------------------------------------------------------------------------
/**
 * The operator's queue.
 *
 * This page exists because a mechanism nobody can invoke is the same problem as
 * a column nobody sets — which is exactly what `moderation_state` was before
 * this round. It is deliberately plain: what the states mean, every store that is
 * not in the default one, and one form per store.
 *
 * It is not a report queue and it does not pretend to be: nothing here tells an
 * operator which store to look at, because a seller report button is a separate
 * feature with a separate design.
 */
/**
 * Everything the console needs to put a count on a queue.
 *
 * One function, called by every console page, so a badge on the navigation and
 * the number at the top of the page it points at can never disagree — which is
 * the single most common way an admin console loses an operator's trust.
 */
async function consoleCounts() {
  const [payments, invoices, reports, moderation, files, banned, unmatched, connections] = await Promise.all([
    store.unmatchedPayments(),
    store.openRentInvoices(),
    store.reportCounts(),
    store.channelsNeedingModeration(),
    store.filesNeedingModeration(),
    store.bannedUsers(),
    store.planPayments(),
    store.connectionHealth({ limit: 500 }),
  ]);
  // A connection needs a look when it has never called back (and is old enough
  // that "it just connected" is not the explanation) or when its signature is
  // being refused. A house connection is ours and expects no callbacks at all.
  const silentConnections = connections.filter((c) => c.provider_id !== 'house' && c.status !== 'revoked'
    && ((c.postbacks_total === 0 && Date.now() - new Date(c.created_at).getTime() > 6 * 3600_000)
      || (c.signature_failures > 0 && (!c.last_verified_at || new Date(c.last_rejected_at) > new Date(c.last_verified_at)))
      || ['restricted', 'failed'].includes(c.status))).length;
  return {
    payments: payments.length,
    invoices: invoices.length,
    reports: reports.open,
    reportedFiles: reports.files,
    moderation: moderation.length,
    // Files, counted separately from stores on purpose: a country rule can put a
    // file in this queue while its store is perfectly public, and one number for
    // both would hide exactly the case the queue was built for.
    //
    // 'removed' is taken back out. It is not waiting on anybody: the decision is
    // made, the file is down, and the next step is an appeal the owner has to
    // start. Leaving it in keeps this number permanently above zero, and a queue
    // that never reaches zero is a queue people stop reading — which costs us the
    // one time it matters.
    files: files.filter((f) => f.moderation_state !== 'removed').length,
    filesRemoved: files.filter((f) => f.moderation_state === 'removed').length,
    banned: banned.length,
    silentConnections,
    unmatched: Array.isArray(unmatched) ? unmatched.length : 0,
  };
}

/**
 * Attach the counts to the operator, for the navigation badges.
 *
 * `banned` is in the badge set because it is the one queue with no other way to
 * be reminded of it: a suspended account is invisible by design, so nothing on
 * any other page will mention that it is waiting.
 */
async function withBadges(user) {
  if (!user || user.role !== 'admin') return user;
  const c = await consoleCounts();
  return {
    ...user,
    adminBadges: {
      payments: c.payments + c.invoices,
      reports: c.reports,
      // A tab badge is a promise about the page it points at, so it counts what
      // that page is holding: stores that are not public, and files that are not
      // the default. The two are counted separately on the console — a file can be
      // waiting while its store is perfectly public — and summed here, where there
      // is only room for one number.
      moderation: c.moderation + c.files,
      banned: c.banned,
    },
  };
}

APP.get('/admin', async (req, res, next) => {
  try {
    if (!req.user || req.user.role !== 'admin') return res.status(404).send('Not found');
    const [counts, money, reach, calibrationRows, mailHealth] = await Promise.all([
      consoleCounts(),
      store.platformMoney(),
      scalar(
        `select json_build_object(
           'stores', (select count(*)::int from channels where moderation_state <> 'removed'),
           'listed', (select count(*)::int from channels where listing_mode = 'marketplace' and moderation_state not in ('removed','suspended')),
           'files',  (select count(*)::int from assets where status = 'live'),
           'views',  (select coalesce(sum(views),0)::int from page_view_daily where day > current_date - 30),
           'unlocks',(select count(*)::int from unlocks where revoked_at is null),
           'events', (select count(*)::int from ad_view_events where completed = true)
         ) as r`,
      ),
      store.statementCalibration(),
      recovery.resetActivity({ days: 30 }),
    ]);
    // The rate every rent figure on the platform is priced from, checked against
    // the statements creators have recorded. It belongs on this page because it is
    // the one number that can quietly make all of our pricing wrong — and because
    // the seller's earnings page promises that reporting a gap gets the rate
    // corrected, which is a promise nothing was honouring.
    const calibration = calibrationVerdict({ rows: calibrationRows, assumedRpmUsd: POLICY.assumedRpmUsd });
    // Rows the verdict counts as contradicted come from the same per-row state the
    // chip on the earnings table renders, so the count here and the chips there
    // cannot describe the same traffic differently.
    const contradicted = calibrationRows.filter((r) => calibrationState(r).contradicted).length;
    const calibrationNote = calibration.level === 'no_statements'
      ? 'No statement on file, so the assumed rate is unchecked.'
      : calibration.level === 'not_measurable'
        ? (contradicted ? calibration.detail : 'A statement is on file and nothing in it can be measured yet.')
        : `${calibration.headline}.${contradicted ? '' : ' Nothing to correct.'}`;

    const kpiRows = [
        { label: 'Matched this month', value: `NPR ${Number(money.matched_this_month || money.matchedThisMonthNpr || 0).toLocaleString('en-IN')}`, context: `${counts.payments + counts.invoices} transfer${counts.payments + counts.invoices === 1 ? '' : 's'} to match`, tone: (money.matched_this_month || money.matchedThisMonthNpr) ? 'good' : '', href: '/admin/payments' },
        { label: 'Reports waiting', value: String(counts.reports), context: counts.reports ? `across ${counts.reportedFiles} file${counts.reportedFiles === 1 ? '' : 's'}` : 'nothing reported', tone: counts.reports >= AUTO_HIDE_AFTER ? 'bad' : counts.reports ? 'warn' : '', href: '/admin/reports' },
        { label: 'Stores not public', value: String(counts.moderation), context: counts.moderation ? 'restricted, suspended or removed' : 'every store is public', tone: counts.moderation ? 'warn' : '', href: '/admin/moderation' },
        { label: 'Paying stores', value: String(money.paying_stores || money.payingStores || 0), context: 'on any paid plan', href: '/admin/audit' },
        {
          label: 'Rate the statements imply',
          value: calibration.impliedRpmUsd === null ? '—' : `$${Number(calibration.impliedRpmUsd).toFixed(2)}`,
          context: calibration.impliedRpmUsd === null
            ? `We assume $${POLICY.assumedRpmUsd.toFixed(2)} with nothing to check it against`
            : `We assume $${POLICY.assumedRpmUsd.toFixed(2)} · rent is priced from it`,
          tone: ['we_over', 'we_under'].includes(calibration.level) ? 'warn' : calibration.level === 'consistent' ? 'good' : '',
          href: '/admin/earnings',
        },
        { label: 'Views · 30d', value: Number(reach.views || 0).toLocaleString('en-IN'), context: `${Number(reach.unlocks || 0).toLocaleString('en-IN')} unlocks · ${Number(reach.events || 0).toLocaleString('en-IN')} ad views` },
    ];
    const verificationQueue = await store.verificationQueue();
    // Derived on every read, never scheduled: `expires_at` against the clock is the
    // whole mechanism, so there is no job to be late and no state to go stale.
    const lapsing = await store.verificationsLapsing({ days: LAPSE_WINDOW_DAYS });
    const lapsingLapsed = lapsing.filter((v) => new Date(v.expires_at) <= new Date()).length;
    const lapsingUntold = lapsing.filter((v) => !v.notice_sent_at && new Date(v.expires_at) > new Date()).length;
    const queueRows = [
        { title: 'Transfers to match', count: counts.payments + counts.invoices, note: 'A person matches each one against the statement by hand.', href: '/admin/payments' },
        { title: 'Files reported', count: counts.reports, note: `${AUTO_HIDE_AFTER} distinct reporters hide a file automatically. Below that, it waits.`, href: '/admin/reports' },
        { title: 'Stores needing a decision', count: counts.moderation, note: 'Restricted, suspended or removed.', href: '/admin/moderation' },
        // Its own row, because it is its own kind of work: not moderation, and
        // not a payment. A store can wait on a document check with nothing wrong
        // with it at all. Shown only when somebody is waiting — and it links to the
        // FILTERED list. The first version pointed at `/admin/stores`, which is
        // every store on the platform: a queue row that answers its own count and
        // then makes you find the row by hand is worse than no row at all.
        ...(verificationQueue.length ? [{
          title: 'Identity checks asked for',
          count: verificationQueue.length,
          note: `${verificationQueue.length === 1 ? 'One seller has' : 'Sellers have'} asked to be checked. Look at one document, record what you saw, keep no copy. Oldest first.`,
          href: '/admin/stores?identity=pending&sort=newest',
        }] : []),
        // The other half of the identity work, and the half nothing would ever
        // remind anybody about: a check that is about to stop counting, or has
        // just stopped. A badge going quietly dark is the failure mode a seller
        // only discovers when a buyer asks why it disappeared.
        ...(lapsing.length ? [{
          title: Number(lapsingLapsed) ? 'Checks ending, or ended' : 'Checks ending soon',
          count: lapsing.length,
          note: `${lapsing.length === 1 ? 'One check is' : `${lapsing.length} checks are`} within two months of their date`
            + `${Number(lapsingLapsed) ? `, and ${lapsingLapsed} of them ${lapsingLapsed === 1 ? 'has' : 'have'} already lapsed` : ''}.`
            + ` ${Number(lapsingUntold) ? `${lapsingUntold} nobody has been told about yet — send the notice from the store's page.` : 'Everyone has been told.'}`,
          href: '/admin/stores?identity=lapsing&sort=expiry',
        }] : []),
        { title: 'Files needing a decision', count: counts.files, note: `Pending, restricted, or withheld from a country. A file can be in here while its store is public.${counts.filesRemoved ? ` ${counts.filesRemoved} removed file${counts.filesRemoved === 1 ? ' is' : 's are'} not counted — nothing is waiting on us there, the owner has to appeal.` : ''}`, href: '/admin/moderation' },
        { title: 'Suspended accounts', count: counts.banned, note: 'Signed out everywhere, stores hidden, nothing deleted.', href: '/admin/users' },
        {
          title: 'Rates to correct',
          count: contradicted,
          note: calibrationNote,
          href: '/admin/earnings',
        },
        { title: 'Connections needing a look', count: counts.silentConnections, note: 'Never called us back, or calling with a secret that does not match.', href: '/admin/connections' },
        // Recovery links that never left. This one row appears only when there is
        // something to act on: a queue that reads "0" every day is how an operator
        // learns to skim the list that also contains the one that matters. The
        // count comes from the mail log, not from a flag — "we wrote it and the
        // provider refused it" is a fact with a timestamp.
        ...(mailHealth.failed_deliveries ? [{
          title: 'Mail that did not send',
          count: mailHealth.failed_deliveries,
          note: `${mailHealth.requested} reset link${mailHealth.requested === 1 ? '' : 's'} and ${mailHealth.confirmations_sent} confirmation link${mailHealth.confirmations_sent === 1 ? '' : 's'} went out in the last 30 days. Somebody waiting on one of these failures is locked out or stuck unconfirmed, and to them the platform is simply broken. The reason is recorded against each message.`,
          href: '/admin/audit?family=people',
        }] : []),
    ];

    res.send(views.adminOverview({
      user: await withBadges(req.user), consent: req.consent, flash: flashFor(req.query),
      kpis: kpiRows,
      queues: queueRows,
      platform: [
        ['Charges', '<strong>Two</strong> — a plan upgrade and annual rent'],
        ['Share of ad earnings', '<strong>0%</strong> — the network pays the creator directly'],
        // A real apostrophe, not an entity: the label is escaped when it is
        // rendered, so an entity here would reach the page as &#39;.
        ["Held on a creator's behalf", '<strong>Nothing, ever</strong>'],
        ['Matched by', 'a person, against the bank or wallet statement'],
        // Not a KPI — nobody acts on a count of links — but the question the
        // launch asked and nothing answered: are people confirming at all?
        ['Mail · last 30 days', `<strong>${Number(mailHealth.confirmations_sent || 0).toLocaleString('en-IN')}</strong> confirmation link${mailHealth.confirmations_sent === 1 ? '' : 's'} sent, <strong>${Number(mailHealth.addresses_confirmed || 0).toLocaleString('en-IN')}</strong> confirmed`],
      ],
      // Decisions, not logins: this strip is the operator's glance at what has
      // been decided lately, and the audit page is where the raw log lives.
      activity: await store.recentDecisions(8),
    }));
  } catch (err) { next(err); }
});

/**
 * Find a store — and hand the same rows to a spreadsheet if asked.
 *
 * `?format=csv` renders the filtered set rather than the page of it, because the
 * reason to export is to reconcile against something else, and reconciling a
 * page of twenty-five reconciles nothing. The CSV carries the columns an
 * accountant or an operator would join on, and it says in its filename what
 * filters produced it.
 */
APP.get('/admin/stores', async (req, res, next) => {
  try {
    if (!req.user) return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
    if (req.user.role !== 'admin') return res.status(404).send('Not found');

    const filters = {
      q: String(req.query.q || '').trim().slice(0, 80),
      state: String(req.query.state || 'all'),
      plan: String(req.query.plan || 'all'),
      // The console's identity queue links land here. `store.storeDirectory`
      // validates the value against the states it can actually produce, so this is
      // a passthrough rather than a second allowlist to keep in step.
      identity: String(req.query.identity || 'all'),
      sort: String(req.query.sort || 'traffic'),
    };

    if (req.query.format === 'csv') {
      const all = await exportAll(({ page, perPage }) => store.storeDirectory({ ...filters, page, perPage }));
      const head = ['store', 'slug', 'owner_email', 'plan', 'subscription', 'state',
        'listing', 'identity', 'identity_expires', 'files_live', 'files_total', 'views_30d', 'unlocks', 'ad_views_30d', 'reviews', 'last_file_at'];
      const body = all.rows.map((r) => [r.name, r.slug, r.owner_email || '', r.plan_code, r.sub_status,
        r.moderation_state, r.listing_mode, r.identity_state,
        r.verification_expires_at ? new Date(r.verification_expires_at).toISOString() : '',
        r.files_live, r.files_total, r.views_30d,
        r.unlocks, r.ad_views_30d, r.reviews, r.last_file_at ? new Date(r.last_file_at).toISOString() : '']);
      const stamp = new Date().toISOString().slice(0, 10);
      await store.audit('channel.directory_exported',
        { filters, rows: all.rows.length, total: all.total, truncated: all.truncated },
        { actorId: req.user.id });
      res.setHeader('content-type', 'text/csv; charset=utf-8');
      res.setHeader('content-disposition',
        `attachment; filename="bytebikri-stores-${stamp}-${all.rows.length}${all.truncated ? `-of-${all.total}` : ''}.csv"`);
      return res.send(`${csvDocument(head, body)}${truncationNote(all)}`);
    }

    const data = await store.storeDirectory({
      ...filters,
      page: Number(req.query.page || 1),
    });
    return res.send(views.adminStores({
      user: await withBadges(req.user), consent: req.consent, flash: flashFor(req.query), data, filters,
    }));
  } catch (err) { return next(err); }
});

/**
 * One store, in full — the page the queues link to.
 *
 * Registered after the directory but before `/admin/reports`; the slug is matched
 * exactly, so a store called `reports` still reaches this page rather than the
 * one below it (Express matches in registration order, and `/admin/stores/:slug`
 * cannot collide with `/admin/reports` at all).
 */
APP.get('/admin/stores/:slug', async (req, res, next) => {
  try {
    if (!req.user) return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
    if (req.user.role !== 'admin') return res.status(404).send('Not found');

    const data = await store.storeDetail(String(req.params.slug));
    // The identity-check panel needs both halves: the row in force (what the
    // badge says) and the whole history behind it (who decided, when, and on what
    // document). A store with no row has both as null/[] — an honest empty panel.
    const channelId = data?.channel?.id ?? null;
    const verification = channelId ? await store.verificationFor(channelId) : null;
    const verifications = channelId ? await store.verificationsFor(channelId) : [];
    // The second of the two pages that can show a held document, so the sweep runs
    // here as well as on the seller's settings page — whoever opens one first clears
    // the holds that have outlived their week.
    const pendingRequest = channelId ? await heldRequest(channelId, { sweep: true }) : null;
    // A store that does not exist is not a 404 for the operator: "no such store"
    // is a legitimate answer that deserves a page with a way back.
    return res.send(views.adminStoreDetail({
      verification, verifications, pendingRequest,
      user: await withBadges(req.user), consent: req.consent, flash: flashFor(req.query),
      data, rules: await store.policyRules(), actions: MOD_ACTIONS, labels: ACTION_LABELS,
    }));
  } catch (err) { return next(err); }
});

/**
 * The money path, watched.
 *
 * This is the console's answer to a question no seller can ask: which networks,
 * across the whole platform, have gone quiet. A dead connection looks exactly
 * like a quiet week from inside the store, and the difference matters — one is
 * normal, the other means somebody is publishing for nothing.
 */
APP.get('/admin/connections', async (req, res, next) => {
  try {
    if (!req.user) return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
    if (req.user.role !== 'admin') return res.status(404).send('Not found');
    return res.send(views.adminConnections({
      user: await withBadges(req.user), consent: req.consent, flash: flashFor(req.query),
      rows: await store.connectionHealth(),
    }));
  } catch (err) { return next(err); }
});

/**
 * The operator's view of what creators were paid, and the calibration of the rate
 * this platform prices rent from.
 *
 * `?format=csv` exports the comparison rather than the page, for the same reason
 * the store directory does: the purpose of exporting is to reconcile against
 * something else, and one page of a moving table reconciles nothing. The export
 * writes an audit row naming who took it and what it contained.
 */
APP.get('/admin/earnings', async (req, res, next) => {
  try {
    if (!req.user) return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
    if (req.user.role !== 'admin') return res.status(404).send('Not found');

    const rows = await store.statementCalibration();
    const verdict = calibrationVerdict({ rows, assumedRpmUsd: POLICY.assumedRpmUsd });

    if (req.query.format === 'csv') {
      const head = ['store', 'slug', 'owner_email', 'network', 'periods', 'window_start', 'window_end',
        'views_in_window', 'reported_usd', 'our_estimate_usd', 'implied_rpm_usd', 'assumed_rpm_usd', 'state'];
      const body = rows.map((r) => {
        const st = calibrationState(r);
        return [r.channel_name, r.channel_slug, r.owner_email || '', r.provider_id, r.periods,
          isoDay(r.first_period_start), isoDay(r.last_period_end),
          r.views, Number(r.reported_usd).toFixed(2), Number(r.estimate_usd).toFixed(4),
          r.implied_rpm_usd === null ? '' : Number(r.implied_rpm_usd).toFixed(4),
          POLICY.assumedRpmUsd, st.state];
      });
      const stamp = new Date().toISOString().slice(0, 10);
      await store.audit('earnings.calibration_exported',
        { rows: rows.length, periods: verdict.periods, impliedRpmUsd: verdict.impliedRpmUsd, level: verdict.level },
        { actorId: req.user.id });
      res.setHeader('content-type', 'text/csv; charset=utf-8');
      res.setHeader('content-disposition',
        `attachment; filename="bytebikri-earnings-${stamp}-${rows.length}.csv"`);
      return res.send(csvDocument(head, body));
    }

    return res.send(views.adminEarnings({
      user: await withBadges(req.user), consent: req.consent, flash: flashFor(req.query),
      rows, verdict, open: await store.openStatements(),
      assumedRpmUsd: POLICY.assumedRpmUsd, usdToNpr: POLICY.usdToNpr,
    }));
  } catch (err) { return next(err); }
});

APP.get('/admin/reports', async (req, res, next) => {
  try {
    if (!req.user || req.user.role !== 'admin') return res.status(404).send('Not found');
    const queue = orderQueue(await store.openReports());
    // The notes come from the individual reports, minus who wrote them.
    const rows = await Promise.all(queue.map(async (r) => ({
      ...r, notes: (await store.reportsForAsset(r.asset_id)).filter((x) => x.status === 'open' && x.note).slice(0, 4),
    })));
    const rules = await store.policyRules();
    // Appeals come from the same page because they are the same argument, one
    // step later: the report queue decides whether a file is hidden, the appeal
    // queue decides whether that was right, and both are answered by reading.
    const recent = await store.recentAppeals({ limit: 40 });
    const decided = recent.filter((a) => a.status !== 'open');
    // A decided appeal is context for the reports still sitting on the same file.
    // Without it, an operator can decline an appeal ("the reports stand") and then
    // dismiss those same reports from the row below, putting the file back — the
    // platform contradicting itself in two clicks, with the seller reading both.
    const byAsset = new Map();
    for (const a of decided) if (!byAsset.has(a.asset_id)) byAsset.set(a.asset_id, a);
    res.send(views.adminReports({
      user: await withBadges(req.user), consent: req.consent, flash: flashFor(req.query),
      rows: rows.map((r) => ({ ...r, decidedAppeal: byAsset.get(r.asset_id) ?? null })),
      ruleTitles: Object.fromEntries(rules.map((r) => [r.code, r.title])),
      appeals: await store.openAppeals(),
      decided,
    }));
  } catch (err) { next(err); }
});

/**
 * File the seller's answer to a report-driven hiding.
 *
 * The appeal does not restore the file. That is the whole design: a hidden file
 * plus an appeal button that puts it back would be a two-click bypass of a
 * three-report threshold, and the threshold exists because a single report is a
 * competitor weapon. What the seller gets is a person reading their words.
 */
/**
 * A creator withholds their own file from a country.
 *
 * Deliberately a small surface. They can say `blocked` or `restricted`, they can
 * clear a rule they set, and they cannot say `allowed` — that is the word an
 * operator uses to carve a file out of a store-wide decision, and a creator who
 * could say it could override the platform's own rule. They also cannot clear an
 * operator's rule: the disagreement is what the appeal above this panel is for.
 */
APP.post('/dashboard/:slug/assets/:assetId/country', async (req, res, next) => {
  try {
    const channel = await ownerChannel(req, res);
    if (!channel) return undefined;
    if (refuseWrite(req, res, channel)) return undefined;
    const back = `/dashboard/${channel.slug}/assets/${encodeURIComponent(req.params.assetId)}`;
    const asset = await store.assetById(req.params.assetId);
    if (!asset || asset.channel_id !== channel.id) return res.status(404).send('Not found');
    if (!isCountryCode(req.body?.countryCode)) return res.redirect(`${back}?error=country`);

    if (req.body?.clear === '1') {
      // Their own rule only. `clearAssetCountryRule` would happily delete an
      // operator's row, so the check is here, where the operator's identity is
      // known, and not left to a form that only renders one button.
      const existing = (await store.assetCountryRules(asset.id))
        .find((r) => r.country_code === String(req.body.countryCode).toUpperCase());
      if (!existing || existing.source !== 'creator') return res.redirect(`${back}?error=rule-not-yours`);
      await store.clearAssetCountryRule({
        assetId: asset.id, countryCode: existing.country_code, actorId: req.user.id,
      });
      await store.audit('moderation.asset_country_cleared', {
        assetId: asset.id, countryCode: existing.country_code, by: 'creator', actorId: req.user.id,
      });
      return res.redirect(`${back}?saved_country=1`);
    }

    // `states` and `requireRule` are what make this the creator's call and not an
    // operator's: no `allowed`, and no rule to cite.
    const decision = validateCountryDecision({
      state: req.body?.state, ruleCode: null, note: req.body?.note || '',
      states: CREATOR_COUNTRY_STATES, requireRule: false,
    });
    if (!decision.ok) return res.redirect(`${back}?error=${decision.error}`);

    await store.setAssetCountryRule({
      assetId: asset.id,
      countryCode: req.body.countryCode,
      state: decision.state,
      ruleCode: null,
      note: decision.note,
      source: 'creator',
      actorId: req.user.id,
    });
    await store.audit('moderation.asset_country', {
      assetId: asset.id, countryCode: String(req.body.countryCode).toUpperCase(),
      state: decision.state, by: 'creator', actorId: req.user.id,
    });
    return res.redirect(`${back}?saved_country=1`);
  } catch (err) { return next(err); }
});

APP.post('/dashboard/:slug/assets/:assetId/appeal', async (req, res, next) => {
  const back = `/dashboard/${encodeURIComponent(req.params.slug)}/assets/${encodeURIComponent(req.params.assetId)}`;
  try {
    const channel = await ownerChannel(req, res);
    if (!channel) return undefined;
    const asset = await store.assetById(req.params.assetId);
    if (!asset || asset.channel_id !== channel.id) return res.status(404).send('Not found');

    const allowed = canAppeal({ asset, openAppeal: await store.openAppealFor(asset.id) });
    if (!allowed.ok) return res.redirect(`${back}?error=appeal_state`);

    const statement = cleanStatement(req.body?.statement);
    if (statement.length < 20) return res.redirect(`${back}?error=appeal_short`);

    const open = await store.fileCase(asset.id);
    const result = await store.fileAppeal({
      assetId: asset.id, channelId: channel.id, sellerId: req.user.id,
      statement, reasons: open.reasons, reportCount: open.reporters,
    });
    if (!result.filed) return res.redirect(`${back}?error=appeal_double`);
    res.redirect(`${back}?appeal_sent=1`);
  } catch (err) { return next(err); }
});

/** Withdrawing is allowed, because a queue entry nobody intends to act on is worse than none. */
APP.post('/dashboard/:slug/assets/:assetId/appeal/withdraw', async (req, res, next) => {
  const back = `/dashboard/${encodeURIComponent(req.params.slug)}/assets/${encodeURIComponent(req.params.assetId)}`;
  try {
    const channel = await ownerChannel(req, res);
    if (!channel) return undefined;
    const asset = await store.assetById(req.params.assetId);
    if (!asset || asset.channel_id !== channel.id) return res.status(404).send('Not found');
    const open = await store.openAppealFor(asset.id);
    if (!open) return res.redirect(`${back}?error=appeal_state`);
    await store.decideAppeal({ appealId: open.id, decision: 'withdrawn', actorId: req.user.id });
    res.redirect(`${back}?appeal_withdrawn=1`);
  } catch (err) { return next(err); }
});

/**
 * Decide a seller's appeal.
 *
 * A decline needs a line for the seller. The whole reason this feature exists is
 * that a hidden file used to read as "Paused" with no reason and no reply path;
 * a decline button that recorded nothing would rebuild exactly that silence at
 * the end of a process that was supposed to end it. Upholding carries the note
 * too, because "yes, and here is why" is worth more to the next reader than "yes".
 */
APP.post('/admin/appeals/:appealId', async (req, res, next) => {
  try {
    if (!req.user || req.user.role !== 'admin') return res.status(404).send('Not found');
    const decision = String(req.body?.decision || '');
    const note = cleanStatement(req.body?.note).slice(0, 300);
    if (!['upheld', 'declined'].includes(decision)) return res.redirect('/admin/reports?error=appeal_decision');
    if (decision === 'declined' && note.length < 10) return res.redirect('/admin/reports?error=appeal_note');
    const out = await store.decideAppeal({ appealId: req.params.appealId, decision, note: note || null, actorId: req.user.id });
    if (!out.ok) return res.redirect('/admin/reports?error=appeal_decided');
    res.redirect(`/admin/reports?appeal_${out.restored ? 'restored' : decision}=1#appeals`);
  } catch (err) { return next(err); }
});

APP.post('/admin/reports/:assetId', async (req, res, next) => {
  try {
    if (!req.user || req.user.role !== 'admin') return res.status(404).send('Not found');
    const asset = await store.assetById(req.params.assetId);
    if (!asset) return notFoundPage(req, res, 'file');
    const action = req.body?.action === 'dismissed' ? 'dismissed' : 'actioned';

    // A decision and the closure of its reports are one transaction: a queue row
    // that stays open after somebody acted on it is a queue nobody trusts.
    await store.withTransaction(async (client) => {
      if (action === 'actioned') {
        // Removed: the file stays down, and the flag clears so a later dismissal
        // of some future report cannot bring it back.
        await client.query(
          "update assets set status = 'paused', hidden_by_reports = false, updated_at = now() where id = $1",
          [asset.id],
        );
      } else {
        // Dismissed: if the threshold is what hid it, the threshold is undone.
        // This is the appeal path — without it, a wrong report hides a file
        // permanently and the operator's decision means nothing.
        await client.query(
          `update assets set status = 'live', hidden_by_reports = false, updated_at = now()
            where id = $1 and hidden_by_reports = true`,
          [asset.id],
        );
      }
      await client.query(
        `update asset_reports set status = $2, resolved_by = $3, resolved_at = now()
          where asset_id = $1 and status = 'open'`,
        [asset.id, action, req.user.id],
      );
    });

    await store.audit(`report.${action}`, { assetId: asset.id, channelId: asset.channel_id },
      { actorId: req.user.id, subjectType: 'asset', subjectId: asset.id });
    res.redirect('/admin/reports?saved_report=1');
  } catch (err) { next(err); }
});

/**
 * The audit log, filtered in SQL.
 *
 * The version this replaces fetched 300 rows and filtered them in JavaScript, so
 * the header's "of 300" described the array rather than the table, and the filters
 * could not reach past the page. Every filter here is a bound parameter, and the
 * family list is a fixed vocabulary from `src/audit.js` — never a string from the
 * query interpolated into a `case`.
 */
APP.get('/admin/audit', async (req, res, next) => {
  try {
    if (!req.user || req.user.role !== 'admin') return res.status(404).send('Not found');
    const filters = {
      family: String(req.query.family || 'decisions'),
      actor: String(req.query.actor || '').trim().slice(0, 80),
      q: String(req.query.q || '').trim().slice(0, 80),
      since: String(req.query.since || 'all'),
      // Read here, or the page's own "Older →" link goes nowhere: it carries
      // `?page=2`, the view renders it, and the query it produces would have been
      // page 1 again. Invisible while the log fits on one page — which is exactly
      // how long a pager bug survives.
      page: Math.min(10_000, Math.max(1, Number(req.query.page) || 1)),
    };
    // An unknown family falls back to the default view rather than an empty page:
    // a bad URL should show the log, not look like the log is empty.
    const known = ['decisions', 'all', ...AUDIT_FAMILIES.map((f) => f.key)];
    if (!known.includes(filters.family)) filters.family = 'decisions';
    if (!['all', 'day', 'week', 'month'].includes(filters.since)) filters.since = 'all';

    if (req.query.format === 'csv') {
      const all = await exportAll(({ page, perPage }) => store.auditSearch({ ...filters, page, perPage }));
      const head = ['when_utc', 'action', 'family', 'actor', 'actor_email', 'subject_type', 'subject', 'detail'];
      const body = all.rows.map((r) => {
        const who = actorOf(r);
        return [new Date(r.created_at).toISOString(), r.action, r.family,
          who.kind === 'person' ? (r.actor_name || r.actor_email) : who.label,
          r.actor_email || '', r.subject_type || '',
          r.subject_label || '', briefMeta(r.meta)];
      });
      const stamp = new Date().toISOString().slice(0, 10);
      await store.audit('audit.exported', { filters, rows: all.rows.length, total: all.total, truncated: all.truncated },
        { actorId: req.user.id });
      res.setHeader('content-type', 'text/csv; charset=utf-8');
      res.setHeader('content-disposition',
        `attachment; filename="bytebikri-audit-${stamp}-${all.rows.length}${all.truncated ? `-of-${all.total}` : ''}.csv"`);
      return res.send(`${csvDocument(head, body)}${truncationNote(all)}`);
    }

    res.send(views.adminAudit({
      user: await withBadges(req.user), consent: req.consent,
      data: await store.auditSearch(filters), filters,
    }));
  } catch (err) { next(err); }
});

APP.get('/admin/moderation', async (req, res, next) => {
  try {
    if (!req.user || req.user.role !== 'admin') return res.status(404).send('Not found');
    const [rules, rows, files, countries, storeBlocks, channels] = await Promise.all([
      store.policyRules(),
      store.channelsNeedingModeration(),
      store.filesNeedingModeration(),
      store.countrySummary(),
      store.storeCountryBlocks(),
      store.channels(),
    ]);
    res.send(views.adminModeration({
      user: req.user, consent: req.consent,
      rules, rows, files, countries, storeBlocks, channels,
      actions: MOD_ACTIONS,
      labels: ACTION_LABELS,
      limits: COUNTRY_LIMITS,
      flash: flashFor(req.query),
    }));
  } catch (err) { next(err); }
});

/**
 * Withhold a store from one country.
 *
 * Registered BEFORE `/admin/moderation/:slug` on purpose: Express matches in
 * order, so a literal path declared after the parameterised one is a route that
 * never runs — and the failure looks like a form that does nothing.
 */
APP.post('/admin/moderation/blocks', async (req, res, next) => {
  try {
    if (!req.user || req.user.role !== 'admin') return res.status(404).send('Not found');
    const channel = await store.channelBySlug(String(req.body?.slug || ''));
    if (!channel) return res.redirect('/admin/moderation?error=store');
    if (!isCountryCode(req.body?.countryCode)) return res.redirect('/admin/moderation?error=country');

    const rules = await store.policyRules();
    const decision = validateCountryDecision({
      state: 'blocked', ruleCode: req.body?.ruleCode, note: req.body?.remedy || '',
    });
    if (!decision.ok) return res.redirect('/admin/moderation?error=reason');
    if (decision.ruleCode && !rules.some((r) => r.code === decision.ruleCode)) {
      return res.redirect('/admin/moderation?error=rule');
    }

    await store.setChannelCountryBlock({
      channelId: channel.id,
      countryCode: req.body.countryCode,
      ruleCode: decision.ruleCode,
      remedy: decision.note,
      actorId: req.user.id,
    });
    await store.audit('moderation.channel_country', {
      channelId: channel.id, countryCode: String(req.body.countryCode).toUpperCase(),
      ruleCode: decision.ruleCode, actorId: req.user.id,
    });
    return res.redirect('/admin/moderation?saved_country=1');
  } catch (err) { return next(err); }
});

/** One file: its state, its countries, and every decision made about it. */
APP.get('/admin/moderation/files/:assetId', async (req, res, next) => {
  try {
    if (!req.user || req.user.role !== 'admin') return res.status(404).send('Not found');
    if (!isUuid(req.params.assetId)) return res.status(404).send('Not found');
    const asset = await store.fileModerationDetail(req.params.assetId);
    if (!asset) return res.status(404).send('File not found');

    res.send(views.adminModerationFile({
      user: req.user, consent: req.consent,
      asset,
      channel: { id: asset.channel_id, slug: asset.channel_slug, name: asset.channel_name },
      rules: await store.policyRules(),
      countryRules: await store.assetCountryRules(asset.id),
      history: await store.fileDecisionHistory(asset.id),
      actions: ASSET_ACTIONS,
      labels: ACTION_LABELS,
      limits: COUNTRY_LIMITS,
      flash: flashFor(req.query),
    }));
  } catch (err) { next(err); }
});

/** Decide a file's own state. */
APP.post('/admin/moderation/files/:assetId', async (req, res, next) => {
  try {
    if (!req.user || req.user.role !== 'admin') return res.status(404).send('Not found');
    const back = `/admin/moderation/files/${encodeURIComponent(req.params.assetId)}`;
    if (!isUuid(req.params.assetId)) return res.redirect('/admin/moderation');
    const asset = await store.fileModerationDetail(req.params.assetId);
    if (!asset) return res.redirect('/admin/moderation?error=file');

    const ruleCodes = new Set((await store.policyRules()).map((r) => r.code));
    const decision = validateAssetDecision({
      action: req.body?.action,
      ruleCode: req.body?.ruleCode || null,
      remedy: req.body?.remedy || '',
    });
    // `suspend` lands here: a file has no suspended state, and mapping it to
    // something the CHECK constraint accepts would hide a file everywhere while
    // the operator believed they had kept it listed.
    if (!decision.ok) return res.redirect(`${back}?error=${decision.error}`);
    if (decision.ruleCode && !ruleCodes.has(decision.ruleCode)) {
      return res.redirect(`${back}?error=rule`);
    }

    await store.setAssetModeration({
      assetId: asset.id,
      action: decision.action,
      state: decision.state,
      ruleCode: decision.ruleCode,
      remedy: decision.remedy,
      actorId: req.user.id,
    });
    await store.audit('moderation.asset', {
      assetId: asset.id, channelId: asset.channel_id, action: decision.action,
      state: decision.state, ruleCode: decision.ruleCode, actorId: req.user.id,
    });
    return res.redirect(`${back}?saved_file=1`);
  } catch (err) { return next(err); }
});

/** Set, clear, or push a country rule down to a whole store. */
APP.post('/admin/moderation/files/:assetId/country', async (req, res, next) => {
  try {
    if (!req.user || req.user.role !== 'admin') return res.status(404).send('Not found');
    const back = `/admin/moderation/files/${encodeURIComponent(req.params.assetId)}`;
    if (!isUuid(req.params.assetId)) return res.redirect('/admin/moderation');
    const asset = await store.fileModerationDetail(req.params.assetId);
    if (!asset) return res.redirect('/admin/moderation?error=file');
    if (!isCountryCode(req.body?.countryCode)) return res.redirect(`${back}?error=country`);

    if (req.body?.clear === '1') {
      await store.clearAssetCountryRule({
        assetId: asset.id, countryCode: req.body.countryCode, actorId: req.user.id,
      });
      await store.audit('moderation.asset_country_cleared', {
        assetId: asset.id, countryCode: String(req.body.countryCode).toUpperCase(), actorId: req.user.id,
      });
      return res.redirect(`${back}?saved_country=1`);
    }

    const decision = validateCountryDecision({
      state: req.body?.state, ruleCode: req.body?.ruleCode, note: req.body?.note || '',
    });
    if (!decision.ok) return res.redirect(`${back}?error=${decision.error}`);
    const rules = await store.policyRules();
    if (decision.ruleCode && !rules.some((r) => r.code === decision.ruleCode)) {
      return res.redirect(`${back}?error=rule`);
    }

    // "Apply to the whole store" is a different row in a different table, and it
    // is deliberately the same form: the operator has already decided WHAT and
    // WHERE, and the only remaining question is how far it reaches.
    if (req.body?.wholeStore === '1') {
      if (decision.state !== 'blocked') return res.redirect(`${back}?error=state`);
      await store.setChannelCountryBlock({
        channelId: asset.channel_id,
        countryCode: req.body.countryCode,
        ruleCode: decision.ruleCode,
        remedy: decision.note,
        actorId: req.user.id,
      });
      await store.audit('moderation.channel_country', {
        channelId: asset.channel_id, countryCode: String(req.body.countryCode).toUpperCase(),
        ruleCode: decision.ruleCode, actorId: req.user.id,
      });
      return res.redirect(`${back}?saved_country=1`);
    }

    await store.setAssetCountryRule({
      assetId: asset.id,
      countryCode: req.body.countryCode,
      state: decision.state,
      ruleCode: decision.ruleCode,
      note: decision.note,
      source: 'operator',
      actorId: req.user.id,
    });
    await store.audit('moderation.asset_country', {
      assetId: asset.id, countryCode: String(req.body.countryCode).toUpperCase(),
      state: decision.state, ruleCode: decision.ruleCode, actorId: req.user.id,
    });
    return res.redirect(`${back}?saved_country=1`);
  } catch (err) { return next(err); }
});

/** Clear or set a store-wide country block from the console list. */
APP.post('/admin/moderation/:slug/country', async (req, res, next) => {
  try {
    if (!req.user || req.user.role !== 'admin') return res.status(404).send('Not found');
    const channel = await store.channelBySlug(req.params.slug);
    if (!channel) return res.redirect('/admin/moderation?error=store');
    if (!isCountryCode(req.body?.countryCode)) return res.redirect('/admin/moderation?error=country');

    if (req.body?.clear === '1') {
      await store.clearChannelCountryBlock({
        channelId: channel.id, countryCode: req.body.countryCode, actorId: req.user.id,
      });
      await store.audit('moderation.channel_country_cleared', {
        channelId: channel.id, countryCode: String(req.body.countryCode).toUpperCase(), actorId: req.user.id,
      });
    } else {
      const decision = validateCountryDecision({
        state: 'blocked', ruleCode: req.body?.ruleCode, note: req.body?.remedy || '',
      });
      if (!decision.ok) return res.redirect('/admin/moderation?error=reason');
      const rules = await store.policyRules();
      if (decision.ruleCode && !rules.some((r) => r.code === decision.ruleCode)) {
        return res.redirect('/admin/moderation?error=rule');
      }
      await store.setChannelCountryBlock({
        channelId: channel.id,
        countryCode: req.body.countryCode,
        ruleCode: decision.ruleCode,
        remedy: decision.note,
        actorId: req.user.id,
      });
    }
    return res.redirect('/admin/moderation?saved_country=1');
  } catch (err) { return next(err); }
});

APP.post('/admin/moderation/:slug', async (req, res, next) => {
  try {
    if (!req.user || req.user.role !== 'admin') return res.status(404).send('Not found');
    const channel = await store.channelBySlug(req.params.slug);
    if (!channel) return res.status(404).send('Channel not found');

    const ruleCodes = new Set((await store.policyRules()).map((r) => r.code));
    const decision = validateDecision({
      action: req.body?.action,
      ruleCode: req.body?.ruleCode || null,
      remedy: req.body?.remedy || '',
    });
    if (!decision.ok) return res.redirect(`/admin/moderation?error=${decision.error}`);
    // The code has to be a rule this database actually has: `moderation_actions
    // .rule_code` is a foreign key, and a clear refusal beats a 23503.
    if (decision.ruleCode && !ruleCodes.has(decision.ruleCode)) {
      return res.redirect('/admin/moderation?error=rule');
    }

    await store.setChannelModeration({
      channelId: channel.id,
      action: decision.action,
      state: decision.state,
      ruleCode: decision.ruleCode,
      remedy: decision.remedy,
      actorId: req.user.id,
    });
    await store.audit('moderation.channel', {
      channelId: channel.id, action: decision.action,
      state: decision.state, ruleCode: decision.ruleCode, actorId: req.user.id,
    });
    res.redirect('/admin/moderation?saved_moderation=1');
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// People — the account-level half of moderation
// ---------------------------------------------------------------------------
/**
 * `/admin/users` is the Android app's admin screen done on the web.
 *
 * The app has had `fetchFlaggedAssets`, `banUser` and `unflagAsset` since its
 * first schema; the server implemented the file half (reports) and the store
 * half (moderation) and never the person. `banUser` posted to a route that did
 * not exist, so the app's red "Ban User" button had never once worked.
 *
 * A ban is not a deletion and the page says so at every step: the account, its
 * stores and its files all stay, the sessions are revoked, and reinstating gives
 * everything back.
 */
APP.get('/admin/plans', async (req, res, next) => {
  try {
    if (!req.user || req.user.role !== 'admin') return res.status(404).send('Not found');
    const [data, near] = await Promise.all([store.plansOverview(), store.storesNearCap({ limit: 50 })]);
    const drift = planDrift(data.plans, PLANS);

    if (req.query.format === 'csv') {
      const head = ['plan', 'price_npr', 'period_months', 'stores', 'active', 'in_grace', 'lapsed', 'offered'];
      const body = data.plans.map((p) => {
        const m = data.mix.find((x) => x.plan_code === p.code) || {};
        return [p.name, p.price_npr, p.period_months, m.stores || 0, m.active || 0,
          m.in_grace || 0, m.lapsed || 0, p.active ? 'yes' : 'no'];
      });
      await store.audit('plans.exported', { plans: data.plans.length, drift: drift.length }, { actorId: req.user.id });
      res.setHeader('content-type', 'text/csv; charset=utf-8');
      res.setHeader('content-disposition', 'attachment; filename="bytebikri-plans.csv"');
      // Drift travels with the file too: an export that leaves the warning behind
      // is how a wrong number ends up in somebody's spreadsheet, alone.
      const note = drift.length ? `\n# note,${drift.length} drift warning(s): ${drift.join(' | ').replace(/"/g, "'")}\n` : '';
      return res.send(`${csvDocument(head, body)}${note}`);
    }

    res.send(views.adminPlans({
      user: req.user, consent: req.consent, flash: flashFor(req.query), data, near, drift,
    }));
  } catch (err) { next(err); }
});

APP.get('/admin/users', async (req, res, next) => {
  try {
    if (!req.user || req.user.role !== 'admin') return res.status(404).send('Not found');
    const filters = {
      q: String(req.query.q || '').trim().slice(0, 80),
      segment: String(req.query.segment || 'all'),
      sort: String(req.query.sort || 'recent'),
    };
    // An unknown segment is not an error worth a 400: it falls back to Everyone,
    // and the tabs show which segment is actually being displayed.
    if (!views.PERSON_SEGMENTS.some((x) => x.key === filters.segment)) filters.segment = 'all';

    if (req.query.format === 'csv') {
      const all = await exportAll(({ page, perPage }) => store.peopleDirectory({ ...filters, page, perPage }));
      const head = ['email', 'display_name', 'role', 'state', 'segment', 'stores', 'files_live',
        'views_30d', 'unlocks', 'joined', 'last_seen', 'failed_signins_7d', 'live_sessions',
        'sold_by_on_file', 'locale'];
      const body = all.rows.map((r) => [r.email, r.display_name || '', r.role,
        r.banned ? 'suspended' : 'active', r.segment, r.stores, r.files, r.views_30d, r.unlocks,
        new Date(r.created_at).toISOString(), r.last_seen_at ? new Date(r.last_seen_at).toISOString() : '',
        r.failed_7d, r.live_sessions, r.sold_by_on_file ? 'yes' : 'no', r.locale || '']);
      const stamp = new Date().toISOString().slice(0, 10);
      await store.audit('people.directory_exported',
        { filters, rows: all.rows.length, total: all.total, truncated: all.truncated },
        { actorId: req.user.id });
      res.setHeader('content-type', 'text/csv; charset=utf-8');
      res.setHeader('content-disposition',
        `attachment; filename="bytebikri-people-${stamp}-${all.rows.length}${all.truncated ? `-of-${all.total}` : ''}.csv"`);
      return res.send(`${csvDocument(head, body)}${truncationNote(all)}`);
    }

    const [data, rules] = await Promise.all([
      store.peopleDirectory(filters),
      store.policyRules(),
    ]);
    res.send(views.adminUsers({
      user: req.user, consent: req.consent, flash: flashFor(req.query),
      data, filters, rules, personActions: PERSON_ACTIONS, labels: ACTION_LABELS,
    }));
  } catch (err) { next(err); }
});

/**
 * One account, in detail — the record behind a directory row.
 *
 * The suspension decision is taken HERE rather than from the list, and for a
 * reason the old page got wrong: the old page put a suspend button on every row
 * of a list. A destructive action that sits inside a scanning surface gets hit by
 * a mis-click while somebody is reading, so the act moved to the page you only
 * reach on purpose. The POST below still accepts the account id, so nothing about
 * the API changed.
 */
APP.get('/admin/users/:userId', async (req, res, next) => {
  try {
    if (!req.user || req.user.role !== 'admin') return res.status(404).send('Not found');
    const detail = await store.personDetail(req.params.userId);
    // `requestedKind`, not `kind`: the wrong name is silently ignored and every
    // store that never existed would answer with the generic page rather than the
    // store-shaped one. The parameter name is the contract.
    if (!detail) return res.status(404).send(views.notFound({ user: req.user, consent: req.consent, requestedKind: 'page' }));
    // Read alongside the rest: "I never got the reset link" is the support question
    // this page exists to answer, so the answer is on the page rather than in a
    // database client somebody has to open.
    const [rules, recovery] = await Promise.all([store.policyRules(), recoveryOf(detail.person.id)]);
    res.send(views.adminUser({
      user: req.user, consent: req.consent, flash: flashFor(req.query),
      detail, rules, personActions: PERSON_ACTIONS, labels: ACTION_LABELS, recovery,
    }));
  } catch (err) { next(err); }
});

APP.post('/admin/users/:userId', async (req, res, next) => {
  try {
    if (!req.user || req.user.role !== 'admin') return res.status(404).send('Not found');
    const target = await store.userById(req.params.userId);
    if (!target) return res.status(404).send('No such account');

    const action = String(req.body?.action || '');
    if (!PERSON_ACTIONS.includes(action)) return res.redirect('/admin/users?error=action');
    const ruleCodes = new Set((await store.policyRules()).map((r) => r.code));
    const ruleCode = req.body?.ruleCode ? String(req.body.ruleCode) : null;
    // Suspending a PERSON is a restriction, so it cites a rule like any other.
    if (action === 'suspend' && !ruleCode) return res.redirect('/admin/users?error=reason');
    if (ruleCode && !ruleCodes.has(ruleCode)) return res.redirect('/admin/users?error=rule');

    const decision = validateDecision({ action, ruleCode, remedy: req.body?.remedy || '' });
    if (!decision.ok) return res.redirect(`/admin/users?error=${decision.error}`);

    const updated = await store.setUserBanned({
      userId: target.id, action, ruleCode: decision.ruleCode,
      remedy: decision.remedy, actorId: req.user.id,
    });
    await store.audit('moderation.user', {
      userId: target.id, action, state: personStateFor(action),
      ruleCode: decision.ruleCode, actorId: req.user.id,
    });
    res.redirect(`/admin/users?q=${encodeURIComponent(target.email)}&saved_user=1`);
  } catch (err) { next(err); }
});

/**
 * Send a confirmation link on somebody's behalf.
 *
 * This exists because of a phone call that will happen: "I signed up and the
 * email never came." The operator is looking at the account, can see that no
 * link was ever delivered, and the alternative is asking the person to go and
 * find a form. It sends exactly the email the verify page would send — same
 * window, same reuse rules — so it cannot be used to flood an address, and it
 * cannot confirm anything on its own. The address still has to answer.
 */
APP.post('/admin/users/:userId/verify-link', async (req, res, next) => {
  try {
    if (!req.user || req.user.role !== 'admin') return res.status(404).send('Not found');
    const target = await store.userById(req.params.userId);
    if (!target) return res.status(404).send('No such account');
    const back = `/admin/users/${encodeURIComponent(target.id)}`;

    if (target.email_verified_at) {
      return res.redirect(`${back}?verify_wait=${encodeURIComponent('this address is already confirmed')}`);
    }

    const out = await verify.sendVerification({
      user: target, baseUrl: publicBase(req), ip: req.ip,
      userAgent: `operator:${req.user.id}`,
    });

    await store.audit('auth.verify_sent_by_operator', {
      to: target.email, sent: out.sent, reason: out.reason || null, actorId: req.user.id,
    }, { actorId: req.user.id, subjectType: 'profile', subjectId: target.id });

    if (!out.sent) {
      return res.redirect(`${back}?verify_wait=${encodeURIComponent(`${Math.max(1, out.ageMinutes ?? 1)} minutes`)}`);
    }
    res.redirect(`${back}?verify_sent=${encodeURIComponent(target.email)}`);
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------
APP.post('/api/assets', upload.single('file'), async (req, res, next) => {
  try {
    const { slug, title, description, unlockMode } = req.body || {};
    const channel = await store.channelBySlug(slug);
    if (!channel) return res.status(400).json({ ok: false, error: 'channel not found' });
    const user = req.user;
    if (!user) return requireUser(res);
    if (channel.owner_id !== user.id) return res.status(403).json({ ok: false, error: 'not your channel' });
    if (refuseWrite(req, res, channel)) return undefined;

    const plan = store.plan(channel);
    const limit = plan.capabilities.max_assets;
    const existing = (await store.assetsOf(channel.id)).length;
    if (limit !== -1 && existing >= limit) {
      // Downgrade behaviour: existing content stays live. Only NEW uploads block.
      return res.status(400).json({
        ok: false,
        error: `asset limit reached for the ${plan.name} plan — existing content stays live, new uploads are blocked`,
      });
    }

    const asset = await store.createAsset({
      channelId: channel.id, title: title || 'Untitled',
      slug: slugify(title || 'asset'), description, unlockMode: unlockMode || 'ad_gated',
    });

    if (req.file) {
      /*
       * The type travels with the call, and this route used not to pass it — which is
       * the whole difference between a video landing at the configured host and landing
       * on our disk. The router falls back to the filename when the type is absent
       * (`mediaKind`), so a client that sends `clip.mp4` was fine either way and the
       * bug hid; what breaks is the case the app's own comment calls the one that
       * actually happens — a phone that sends `video/mp4` under a name with no
       * extension, which then silently stayed local while every other upload path
       * (`POST /dashboard/…/assets`, the seeder) sent video to the host. Two doors to
       * the same bytes must not disagree about where the bytes are.
       */
      const key = await storage.put(req.file.buffer, req.file.originalname, { mimeType: req.file.mimetype });
      await store.addFile({
        assetId: asset.id, storageKey: key, filename: req.file.originalname,
        mimeType: req.file.mimetype, sizeBytes: req.file.size,
        checksum: crypto.createHash('sha256').update(req.file.buffer).digest('hex'),
      });
    }
    await store.audit('asset.created', { assetId: asset.id, channelId: channel.id });
    res.json({ ok: true, assetId: asset.id, url: `/s/${channel.slug}/a/${asset.slug}` });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Ops
// ---------------------------------------------------------------------------
APP.get('/healthz', (_req, res) => res.json({ ok: true, uptime: process.uptime() }));

/** Readiness: can we actually serve? A liveness check that ignores the database
 *  reports healthy while every request 500s. */
APP.get('/readyz', async (_req, res) => {
  const db = await dbHealth();
  res.status(db.ok ? 200 : 503).json({ ok: db.ok, database: db });
});

APP.get('/health', async (_req, res, next) => {
  try {
    const [channels, assets, unlocks, adViews] = await Promise.all([
      scalar(`select count(*)::int from channels`),
      scalar(`select count(*)::int from assets`),
      scalar(`select count(*)::int from unlocks`),
      scalar(`select count(*)::int from ad_view_events`),
    ]);
    res.json({
      ok: true,
      policy: POLICY,
      database: await dbHealth(),
      counts: { channels, assets, unlocks, adViews },
      // Adapter integrity, self-checked on every health call. These include
      // BitLabs' own published digest vector, so a regression in verification
      // shows up here rather than as silently-unlocking content.
      adapters: Object.fromEntries(ADAPTERS.map((a) => [a.id, a.verificationStatus || 'confirmed'])),
      adapterSelfTest: adapterSelfTest(),
      adapterAdvisories: adapterAdvisories(),
    });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Errors — last, so it catches everything above.
// ---------------------------------------------------------------------------
// eslint-disable-next-line no-unused-vars
/**
 * The files a crawler asks for that are not pages.
 *
 * `robots.txt` disallows the surfaces nobody should index and points at the
 * sitemap. Nothing here is a ranking trick: the disallowed list is the set of
 * pages that are per-person (dashboards, unlock links, admin), and indexing them
 * would be wrong even if it helped.
 */
APP.get('/robots.txt', (req, res) => {
  res.type('text/plain').send([
    'User-agent: *',
    // Per-person and operator surfaces. A dashboard is somebody's own, an unlock
    // link is minted for one person, and the console is not a public page.
    'Disallow: /dashboard/',
    'Disallow: /admin',
    'Disallow: /login',
    'Disallow: /signup',
    'Disallow: /consent',
    'Disallow: /files/',
    'Disallow: /api/',
    // Marketing and legal pages are worth crawling; storefronts are the front door.
    `Sitemap: ${publicBase(req)}/sitemap.xml`,
    '',
  ].join('\n'));
});

/**
 * The sitemap: the front page, the legal pages, and every storefront that is
 * public and not held.
 *
 * Only URLs that return 200 are listed — a suspended or removed storefront
 * answers 404 on purpose, so putting it in a sitemap would be handing a crawler a
 * broken link. Last-modified comes from the newest file in each store, because
 * that is when the page actually changed.
 */
APP.get('/sitemap.xml', async (req, res, next) => {
  try {
    const base = publicBase(req);
    const stores = await store.indexableStores();
    const pages = [
      { loc: '/', priority: '1.0', changefreq: 'daily' },
      { loc: '/marketplace', priority: '0.9', changefreq: 'daily' },
      // The legal documents live under /legal/, not at the root. The first version
      // of this list pointed at /privacy and /terms, which answer 404 — a sitemap
      // full of broken links, which is the single most common mistake with them and
      // the one that wastes the crawler's budget on nothing.
      { loc: '/legal/privacy', priority: '0.3', changefreq: 'monthly' },
      { loc: '/legal/terms', priority: '0.3', changefreq: 'monthly' },
      { loc: '/legal/cookies', priority: '0.3', changefreq: 'monthly' },
    ];
    // XML escaping is not HTML escaping: an apostrophe is legal in a URL inside
    // a sitemap and `&#39;` is not, so this escapes the five characters XML
    // actually reserves rather than reusing the HTML helper.
    const xml = (str) => String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
    const url = (loc, lastmod, changefreq, priority) => `  <url>
    <loc>${xml(base + loc)}</loc>${lastmod ? `
    <lastmod>${xml(new Date(lastmod).toISOString().slice(0, 10))}</lastmod>` : ''}
    <changefreq>${changefreq}</changefreq>
    <priority>${priority}</priority>
  </url>`;
    res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${pages.map((p) => url(p.loc, null, p.changefreq, p.priority)).join('\n')}
${stores.map((c) => url(`/s/${c.slug}`, c.last_changed, 'weekly', '0.8')).join('\n')}
</urlset>
`);
  } catch (err) { return next(err); }
});

// ---------------------------------------------------------------------------
// Seed — ONLY on an empty database.
//
// Data now persists, so seeding unconditionally would duplicate every channel on
// every boot. A demo seed that runs once is a demo; one that runs every time is
// a bug that looks like data.
// ---------------------------------------------------------------------------
async function seed({ force = false } = {}) {
  const existing = await scalar(`select count(*)::int from channels`);
  if (existing > 0 && !force) return { seeded: false, channels: existing };

  // No demo accounts in production. A seeded login with a known password is a
  // back door, and "it only runs on an empty database" is not a mitigation —
  // production starts empty.
  if (process.env.NODE_ENV === 'production') {
    return { seeded: false, reason: 'refusing to seed demo accounts in production' };
  }

  const demoPassword = process.env.DEMO_PASSWORD || 'bytebikri-demo';
  const aliceUser = await store.userByEmailOrCreate('alice@bytebikri.local');
  await auth.setPassword(aliceUser.id, demoPassword);
  const alice = await store.createChannel({
    ownerId: aliceUser.id, slug: 'alice', name: "Alice's Studio",
    tagline: 'Design templates and guides for Nepali creators.',
    bannerUrl: '/img/demo/alice-banner.jpg',
    listingMode: 'marketplace',
  });
  await store.applyUpgrade(alice, 'store');

  const bobUser = await store.userByEmailOrCreate('bob@bytebikri.local');
  await auth.setPassword(bobUser.id, demoPassword);
  const bob = await store.createChannel({
    ownerId: bobUser.id, slug: 'bob', name: 'Bob Photography',
    tagline: 'Print-ready photo packs.', listingMode: 'storefront',
    bannerUrl: '/img/demo/bob-banner.jpg',
  });

  // A provider must be explicitly enabled to be connectable — the registry ships
  // everything disabled until verification is complete. `adsterra` is enabled
  // here purely so the slot engine has something live to show.
  const reg = await loadRegistry();
  const p = reg.providers.find((x) => x.id === 'adsterra');
  if (p) { p.enabled = true; p.blockedReason = undefined; }

  await store.createConnection({
    channelId: alice.id, providerId: 'adsterra',
    slotKeys: SLOT_DEFS.slice(0, 3).map((s) => s.key),
    secret: crypto.randomBytes(24).toString('base64url'),
    callbackBaseUrl: `http://127.0.0.1:${PORT}`,
  });
  // The sandbox network, so the unlock loop runs with no credentials. adsterra
  // above is connected for the rent slot but has no adapter, so it cannot serve
  // an unlock — only a verifiable provider can.
  await store.createConnection({
    channelId: alice.id, providerId: 'house', slotKeys: [],
    secret: readSecret('AD_POSTBACK_SECRET'),
    callbackBaseUrl: `http://127.0.0.1:${PORT}`,
  });
  // BitLabs protocol on a RANDOM secret with no BitLabs account behind it. This
  // is the dialect, not a live placement — no real postback can arrive here. It
  // exists so the GET path is exercised rather than assumed.
  await store.createConnection({
    channelId: bob.id, providerId: 'bitlabs', slotKeys: [],
    secret: crypto.randomBytes(24).toString('base64url'),
    callbackBaseUrl: `http://127.0.0.1:${PORT}`,
  });

  const asset = await store.createAsset({
    channelId: alice.id, title: 'Devanagari Poster Kit', slug: 'devanagari-poster-kit',
    // Already reviewed, deliberately: the seed is a demonstration of a platform
    // that has been running, not of one where nobody has looked at anything yet.
    // Left to the rule, every demo file would wait in the queue and search would
    // answer nothing — a demo of the queue rather than of the product.
    moderationState: 'approved',
    coverUrl: '/img/demo/devanagari-poster-kit.jpg',
    description: '18 layered poster templates with Devanagari type pairings. Unlock with one ad.',
  });
  const body = Buffer.from(
    'ByteBikri demo file.\n\nIf you can read this, you completed a rewarded ad and the\n'
    + 'network postback was signature-verified server-side. The link that delivered\n'
    + 'it was minted per user and expires — it cannot be forwarded and reused.\n');
  await store.addFile({
    assetId: asset.id, storageKey: await storage.put(body, 'poster-kit.txt'),
    filename: 'devanagari-poster-kit.txt', mimeType: 'text/plain',
    sizeBytes: body.length,
    checksum: crypto.createHash('sha256').update(body).digest('hex'),
  });
  // The ask is left alone deliberately. This seed used to set five seconds "for
  // demo friendliness", which made the demo show a contradiction no test could see:
  // the file page's summary line said "Now: 1 ad of 5 seconds" directly above the
  // ladder's "1 ad of 15 seconds", and the unlock pipeline created pending views no
  // network would serve. The demo shows the real product or it shows nothing.


  /**
   * A video asset, so the player has something to play.
   *
   * Generated by `scripts/make-demo-media.mjs` and stored in PRIVATE storage
   * like any other unlockable file — not under `public/`, where it would be
   * downloadable by URL and would make a liar of the page that says the video
   * plays but does not download.
   *
   * Skipped silently if the file is missing: a deployment that did not ship the
   * demo clip should still come up.
   */
  let walkthrough = null;
  try {
    const clip = await fs.readFile(path.resolve(__dirname, 'seed-assets/store-walkthrough.mp4'));
    const videoAsset = await store.createAsset({
      channelId: alice.id, title: 'Poster kit walkthrough', slug: 'poster-kit-walkthrough',
      moderationState: 'approved',
      coverUrl: '/img/demo/devanagari-poster-kit.jpg',
      // Five SECONDS. The sentence used to say five minutes, which was a demo
      // describing a file it did not ship: `break-walk.mjs` points at this clip to
      // watch a door, and a five-minute file would put four minutes of nothing
      // between the two walks that use it. The file that can carry a break INSIDE it
      // is the session below, and only a file longer than three and a half minutes can.
      description: 'Five seconds through the kit — layers, type pairings, and how to export for print.',
    });
    await store.addFile({
      assetId: videoAsset.id, storageKey: await storage.put(clip, 'store-walkthrough.mp4', { mimeType: 'video/mp4' }),
      filename: 'store-walkthrough.mp4', mimeType: 'video/mp4', sizeBytes: clip.length,
      checksum: crypto.createHash('sha256').update(clip).digest('hex'),
    });
    walkthrough = videoAsset;

    /*
     * A FILE A BREAK CAN BE PLACED IN — the demo's only one.
     *
     * A break inside a file may not sit in the first two minutes or the last ninety
     * seconds (`placement.js`, rule 1), so a five-second clip can never carry one: with
     * no legal window there is no cue, no gate, and nothing for the player's own surface
     * to be reviewed against. This clip is four minutes at 6 fps — generated by
     * `scripts/make-demo-media.mjs`, committed, 524 KB — and it is seeded in `breaks`
     * mode, which is the promise its page makes: free to open, one view asked for
     * part-way through, nothing before you start.
     *
     * Its length is NOT seeded: `assets.runtime_sec` is measured by the first player
     * that loads it (the player reports what it measured, and the seller's page prints
     * the number). Until somebody opens this page the file has no runtime, so it has no
     * cues — which is the honest place for a demo to start, and the state a walk has to
     * walk through rather than around.
     *
     * Skipped silently if the fixture is missing, like the two above.
     */
    try {
      const session = await fs.readFile(path.resolve(__dirname, 'seed-assets/poster-kit-session.mp4'));
      const sessionAsset = await store.createAsset({
        channelId: alice.id, title: 'The Poster Kit — the session', slug: 'poster-kit-session',
        moderationState: 'approved', unlockMode: 'breaks',
        coverUrl: '/img/demo/devanagari-poster-kit.jpg',
        // The trade is NOT in this sentence. The product writes that itself once it knows
        // where it can place the break (`breakSentence`), and a description that repeated
        // it would be the demo saying the same thing twice in a row.
        description: 'Four minutes through the kit: layers, type pairings, and how to export for print.',
      });
      await store.addFile({
        assetId: sessionAsset.id,
        storageKey: await storage.put(session, 'poster-kit-session.mp4', { mimeType: 'video/mp4' }),
        filename: 'poster-kit-session.mp4', mimeType: 'video/mp4', sizeBytes: session.length,
        checksum: crypto.createHash('sha256').update(session).digest('hex'),
      });
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }

    /*
     * A SERIES, so §15's pages have something real behind them.
     *
     * Two episodes of two clips, and neither of them is the walkthrough above: that file
     * has `break-walk.mjs` and the live fixture pointing at its own URL, and a series must
     * not change what an existing page looks like.
     *
     * PART ONE IS LONG ON PURPOSE. `series.js` refuses to call anything under five seconds
     * a resume, and a five-second file has nowhere to leave off that is not its own end —
     * so a walk that has to *pause in the middle, come back, and find the resume waiting*
     * needs a file worth pausing. Part two is short: it exists to be the next one.
     *
     * Episode numbers are the STORE's, and the seed stands in for the store here: part one
     * is 1 and part two is 2, visibly not by publish order.
     */
    if (!await store.seriesBySlug(alice.id, 'poster-kit')) {
      const series = await store.createSeries({
        channelId: alice.id, slug: 'poster-kit', title: 'The Poster Kit',
        blurb: 'Two short parts — put together in the order they were made.',
        mode: 'serial',
      });
      const partOne = await store.createAsset({
        channelId: alice.id, title: 'The Poster Kit — part one', slug: 'poster-kit-part-one',
        moderationState: 'approved', coverUrl: '/img/demo/devanagari-poster-kit.jpg',
        // The first part is free and the second is not: each episode keeps its own door,
        // which is §15.1's whole architecture and the thing a series most easily hides.
        unlockMode: 'open',
        description: 'Layers, type pairings and how to export for print. 45 seconds, no ads.',
      });
      const longClip = await fs.readFile(path.resolve(__dirname, 'seed-assets/poster-kit-part-one.mp4'));
      await store.addFile({
        assetId: partOne.id, storageKey: await storage.put(longClip, 'poster-kit-part-one.mp4', { mimeType: 'video/mp4' }),
        filename: 'poster-kit-part-one.mp4', mimeType: 'video/mp4', sizeBytes: longClip.length,
        checksum: crypto.createHash('sha256').update(longClip).digest('hex'),
      });
      const partTwo = await store.createAsset({
        channelId: alice.id, title: 'The Poster Kit — part two', slug: 'poster-kit-part-two',
        moderationState: 'approved', coverUrl: '/img/demo/devanagari-poster-kit.jpg',
        description: 'Paper, ink, and the export settings that survive a print shop.',
      });
      await store.addFile({
        assetId: partTwo.id, storageKey: await storage.put(clip, 'store-walkthrough.mp4', { mimeType: 'video/mp4' }),
        filename: 'store-walkthrough.mp4', mimeType: 'video/mp4', sizeBytes: clip.length,
        checksum: crypto.createHash('sha256').update(clip).digest('hex'),
      });
      await store.setEpisode({ assetId: partOne.id, seriesId: series.id, episodeNo: 1 });
      await store.setEpisode({ assetId: partTwo.id, seriesId: series.id, episodeNo: 2 });
    }
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }

  /**
   * A comic, so the reader has something to read.
   *
   * §13's surface needs a real archive rather than a fixture inside a test: this is a
   * CBZ written by `scripts/make-demo-comic.mjs` — twelve pages, both zip methods, and
   * the junk and metadata a real archive carries — seeded in `breaks` mode, which is the
   * mode whose whole point is a gate INSIDE a file that was already free to open. Its
   * single ask falls at the seam between pages 6 and 7, which is the demo of a seam.
   *
   * Skipped silently if the file is missing, like the clip above: a deployment that did
   * not ship the demo comic should still come up.
   */
  let comic = null;
  try {
    const comicBytes = await fs.readFile(path.resolve(__dirname, 'seed-assets/demo-comic.cbz'));
    const comicAsset = await store.createAsset({
      channelId: alice.id, title: "Kathmandu sketchbook — volume 1", slug: 'kathmandu-sketchbook',
      moderationState: 'approved', unlockMode: 'breaks',
      coverUrl: '/img/demo/kathmandu-street.jpg',
      description: "Twelve pages of the valley's streets, doors and posters. Free to open, and it "
        + 'asks for one view between two pages — nothing before you start.',
    });
    await store.addFile({
      assetId: comicAsset.id,
      storageKey: await storage.put(comicBytes, 'kathmandu-sketchbook.cbz'),
      filename: 'kathmandu-sketchbook.cbz', mimeType: 'application/vnd.comicbook+zip',
      sizeBytes: comicBytes.length,
      checksum: crypto.createHash('sha256').update(comicBytes).digest('hex'),
    });
    comic = comicAsset;
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  void comic;

  /**
   * A live stream, so the live shape has something to be reviewed against.
   *
   * §14's surface is the one whose bytes are NOT ours: the demo's stream is the fixture
   * `scripts/make-demo-live.mjs` built from the committed clip, served by this app at
   * `/live-demo/` — which is the same-url shape a real store's stream has, minus the
   * host they would run. Seeded in `ad_gated` mode, because that is the mode whose door
   * a break can pay for: a newcomer arriving inside the coverage a break bought walks in
   * without the ask, and one arriving outside it gets the ordinary door.
   *
   * Skipped silently if the fixture is missing, like the two above.
   */
  let liveDemo = null;
  try {
    const playlist = await fs.readFile(path.resolve(__dirname, 'seed-assets/live-demo/index.m3u8'), 'utf8');
    if (!playlist.includes('#EXTM3U')) throw new Error('the demo playlist is not a playlist');
    const liveAsset = await store.createAsset({
      channelId: alice.id, title: 'Friday night stream — Kathmandu', slug: 'friday-night-stream',
      moderationState: 'approved',
      coverUrl: '/img/demo/kathmandu-street.jpg',
      description: 'A live stream from the store\u2019s own host. Free to open while a break covers the door; '
        + 'one view at the door otherwise, and the store calls every break itself.',
    });
    await store.setExternalUrl({ assetId: liveAsset.id, url: '/live-demo/index.m3u8' });
    liveDemo = liveAsset;
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  void liveDemo;

  const sampleAsset = await store.createAsset({
    channelId: alice.id, title: 'Free sample pack', slug: 'free-sample-pack',
    moderationState: 'approved',
    coverUrl: '/img/demo/sample-pack.jpg',
    description: 'Open access — no ad needed. Proves the lock is per-asset, not per-channel.',
    unlockMode: 'open',
  });
  const sampleBody = Buffer.from(
    'ByteBikri sample pack.\n\nThis one is free: no ad, no wait, no account. It exists to\n'
    + 'prove the lock is per file — the same store sells ad-gated downloads\n'
    + 'beside this one.\n');
  await store.addFile({
    assetId: sampleAsset.id, storageKey: await storage.put(sampleBody, 'sample-pack.txt'),
    filename: 'sample-pack.txt', mimeType: 'text/plain',
    sizeBytes: sampleBody.length,
    checksum: crypto.createHash('sha256').update(sampleBody).digest('hex'),
  });

  // Bob's asset is gated through a GET-dialect provider. Two channels, two
  // providers, two signature schemes — connection routing is exercised, not just
  // provider routing.
  const bobAsset = await store.createAsset({
    channelId: bob.id, title: 'Kathmandu Street Set', slug: 'kathmandu-street-set',
    moderationState: 'approved',
    coverUrl: '/img/demo/kathmandu-street.jpg',
    description: '40 edited street frames from Kathmandu. Unlock with one ad.',
  });
  const bobBody = Buffer.from('ByteBikri demo file (Bob).\n\nServed over a GET-dialect postback.\n');
  await store.addFile({
    assetId: bobAsset.id, storageKey: await storage.put(bobBody, 'kathmandu.txt'),
    filename: 'kathmandu-street-set.txt', mimeType: 'text/plain',
    sizeBytes: bobBody.length,
    checksum: crypto.createHash('sha256').update(bobBody).digest('hex'),
  });
  // One real image in private storage, so the watermarked derivative is produced
  // on a live request instead of only inside a test that stubs ImageMagick.
  try {
    const photo = await fs.readFile(path.resolve(__dirname, 'public/img/demo/kathmandu-street.jpg'));
    await store.addFile({
      assetId: bobAsset.id, storageKey: await storage.put(photo, 'kathmandu-street.jpg'),
      filename: 'kathmandu-street.jpg', mimeType: 'image/jpeg', sizeBytes: photo.length,
      checksum: crypto.createHash('sha256').update(photo).digest('hex'),
    });
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  // Bob is deliberately near his ceiling: a free store at 17 of 20 files.
  //
  // The demo used to show every seller comfortably inside their allowance, which
  // meant the two surfaces built for the moment a plan fills up — the seller's
  // meter and the operator's "close to a ceiling" list — were empty in every
  // screenshot and untested by every run. 85% is over the 80% warning threshold
  // and under the wall, which is the state worth designing for: still publishing,
  // and able to see it coming. Free-plan limits are not a trial expiring; a seller
  // who fills one should be told the count, not ambushed at upload.
  for (let i = 1; i <= 16; i += 1) {
    const body = Buffer.from(`ByteBikri demo file ${i} (Bob's studio).\n`);
    const asset = await store.createAsset({
      channelId: bob.id, title: `Studio print ${String(i).padStart(2, '0')}`,
      moderationState: 'approved',
      slug: `studio-print-${String(i).padStart(2, '0')}`,
      description: 'Part of a deliberately full free plan.', unlockMode: 'ad_gated',
    });
    await store.addFile({
      assetId: asset.id, storageKey: await storage.put(body, `bob-print-${i}.txt`),
      filename: `studio-print-${i}.txt`, mimeType: 'text/plain', sizeBytes: body.length,
      checksum: crypto.createHash('sha256').update(body).digest('hex'),
    });
  }

  // ---------------------------------------------------------------------
  // Demo earnings, so the earnings page shows its own arithmetic instead of
  // three empty states: completed views across the last fortnight, roughly a
  // fifth of them carrying per-view revenue the way a network that reports per
  // view does, and one closed statement figure the creator "pasted".
  //
  // The statement is deliberately NOT our estimate. A demo where the two agree
  // teaches nobody what the page is for, and the reconciliation is the whole
  // point of the feature.
  // ---------------------------------------------------------------------
  const adsterraConn = (await store.connectionsOf(alice.id)).find((c) => c.provider_id === 'adsterra');
  if (adsterraConn && walkthrough) {
    for (let i = 0; i < 180; i += 1) {
      await query(
        `insert into ad_view_events
           (channel_id, user_id, asset_id, provider_id, connection_id, external_id,
            kind, state, completed, duration_sec, revenue_usd, signature_ok, created_at)
         values ($1, $2, $3, 'adsterra', $4, $5, 'display', 'complete', true, 15,
                 $6, true, now() - ($7 || ' days')::interval - ($8 || ' hours')::interval)`,
        [alice.id, aliceUser.id, walkthrough.id, adsterraConn.id,
          `demo-view-${i}`, i % 5 === 0 ? 0.0002 : null, String(i % 14), String(i % 24)],
      );
    }
    // Views INSIDE the statement's own window, so the comparison on the operator's
    // calibration page is a rate rather than an artifact. The earlier version put
    // every demo view in the last fortnight and the statement in August, which
    // meant the two never overlapped: our estimate in that window was zero by
    // construction, and the page could only say "no rate to derive". A fixture
    // whose windows do not meet cannot demonstrate the arithmetic it exists for.
    //
    // 220 completed views against a $0.02 statement is an implied rate of about
    // $0.09 per 1,000 — deliberately well below the $0.20 the platform assumes,
    // because that gap is the whole point of the page. A demo where the assumed
    // rate is right teaches nobody what the calibration is for.
    for (let i = 0; i < 220; i += 1) {
      await query(
        `insert into ad_view_events
           (channel_id, user_id, asset_id, provider_id, connection_id, external_id,
            kind, state, completed, duration_sec, revenue_usd, signature_ok, created_at)
         values ($1, $2, $3, 'adsterra', $4, $5, 'display', 'complete', true, 15,
                 null, true, date '2026-08-01' + ($6 || ' days')::interval + ($7 || ' hours')::interval)`,
        [alice.id, aliceUser.id, walkthrough.id, adsterraConn.id,
          `demo-aug-view-${i}`, String(i % 30), String(i % 24)],
      );
    }
    await store.addProviderReport({
      channelId: alice.id, providerId: 'adsterra',
      periodStart: '2026-08-01', periodEnd: '2026-08-31', reportedUsd: 0.02,
      note: 'From the network portal, August. Deliberately below our estimate.',
    });
  }

  // Traffic for the last fortnight, written the way the counter writes it, so a
  // fresh database can show the rent invoice being issued rather than only the
  // "nothing is due" state. Server-side counting, never a client ping — the
  // demo goes through the same table the real one does.
  for (let day = 0; day < 14; day += 1) {
    await query(
      `insert into page_view_daily (channel_id, day, views, web_views, unique_visitors)
       values ($1, current_date - $2::int, $3, $3, $4)
       on conflict (channel_id, day) do update
         set views = excluded.views, web_views = excluded.web_views,
             unique_visitors = excluded.unique_visitors`,
      [alice.id, day, 22 + (day % 4), 12 + (day % 5)],
    );
  }

  // Rent invoices across their whole life cycle, including the states a database
  // created five minutes ago cannot produce.
  //
  // This is the one place the demo writes dates directly rather than going through
  // the real flow, and it is worth saying why: nothing in the platform can create
  // an invoice that is four months late, because four months have not passed. A
  // fixture that only contains "issued today" makes the aging view look empty and
  // the collection view look flat — the two things the page exists to show.
  //
  // The amounts are real arithmetic from `annualRentNpr`, so the numbers on the
  // page reconcile with the `basis` blob stored beside them.
  {
    const { annualRentNpr: rentFor } = await import('./src/billing.js');
    const baseEstimate = { pageviews30d: 336, slots: 5, rent: 1 };
    const amount = rentFor(baseEstimate) || 900;
    const day = (offset) => {
      const d = new Date(Date.now() + offset * 86400000);
      return d.toISOString().slice(0, 10);
    };
    const rows = [
      // period end, amount multiple, status, due in N days, paid days after due
      { periodEnd: day(-400), status: 'paid', due: -370, paid: -380, ref: 'DEMO-ESW-2001', method: 'esewa', who: 'Alice Sharma' },
      { periodEnd: day(-130), status: 'paid', due: -100, paid: -95, ref: 'DEMO-KH-2002', method: 'khalti', who: 'Alice Sharma' },
      // Submitted and waiting for a person: the state the payments queue exists for.
      { periodEnd: day(-45), status: 'submitted', due: -15, submittedDays: -2, ref: 'DEMO-IME-2003', method: 'imepay', who: 'Alice Sharma' },
      // Issued, still inside the terms.
      { periodEnd: day(-20), status: 'issued', due: 10 },
      // Late, and old enough to be a decision rather than a reminder.
      { periodEnd: day(-95), status: 'issued', due: -65 },
      { periodEnd: day(-190), status: 'issued', due: -160 },
    ];
    for (const [i, row] of rows.entries()) {
      const periodStart = new Date(new Date(row.periodEnd).getTime() - 364 * 86400000).toISOString().slice(0, 10);
      await query(
        `insert into rent_invoices
           (channel_id, period_start, period_end, amount_npr, basis, status, due_at,
            method, txn_reference, payer_name, submitted_at, paid_at, created_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         on conflict (channel_id, period_start) do nothing`,
        [bob.id, periodStart, row.periodEnd, amount,
          JSON.stringify({ pageviews30d: 336, rentSlots: 1, totalSlots: 5, assumedRpmUsd: 0.2, usdToNpr: 133, note: 'demo fixture' }),
          row.status, day(row.due), row.method || null, row.ref || null, row.who || null,
          row.submittedDays ? day(row.submittedDays) : null,
          row.paid ? day(row.paid) : null, day(row.due - 30 + i)],
      );
    }
  }

  // A storefront with one of its own slots filled, so the two kinds of space are
  // both visible on the demo page: the store's own message in the top position,
  // and the platform's in the last.
  await store.setCreative({
    channelId: alice.id, slotKey: 'top_leaderboard',
    headline: 'The Devanagari kit is out',
    body: 'Eleven weights, two scripts, print-ready. The free sample pack is still free.',
    linkUrl: `/s/${alice.slug}`, linkLabel: 'See the store',
  });

  // One buyer who went through the loop: an unlock and the review it earns.
  // Reviews are keyed off unlocks, so a seeded review without one would be a
  // row the product cannot produce.
  const carolUser = await store.userByEmailOrCreate('carol@bytebikri.local');
  await auth.setPassword(carolUser.id, demoPassword);
  if (sampleAsset) {
    const carolUnlock = await store.grantUnlock({
      assetId: sampleAsset.id, channelId: alice.id, userId: carolUser.id,
      method: 'open', adsCompleted: 0,
    });
    await store.addReview({
      unlockId: carolUnlock.id, assetId: sampleAsset.id, channelId: alice.id,
      buyerId: carolUser.id, rating: 5,
      body: 'Downloaded it for a client deck and it covered the whole thing. The weights are the part I bought it for.',
    });
  }

  return { seeded: true, alice: alice.slug, bob: bob.slug };
}

/**
 * The operator account, and the only thing that makes one.
 *
 * No route grants `role = 'admin'`, deliberately. The only thing that turns an
 * account into an operator is a value in the server's environment, set by
 * whoever runs the server — so becoming an operator is a deploy decision rather
 * than a form somebody can post to. Idempotent, because a redeploy should not
 * fail on the fact that the operator already exists.
 */
async function ensureOperator() {
  const email = String(process.env.OPERATOR_EMAIL || '').trim().toLowerCase();
  if (!email) return null;
  const user = await store.userByEmailOrCreate(email);
  if (user.role !== 'admin') {
    await store.query("update profiles set role = 'admin' where id = $1", [user.id]);
  }

  // An account created by this function has no password, and is therefore
  // unreachable — which is the correct default for the one role that can move
  // money. In development the demo password is set so the flow can be walked
  // end to end; in production DEMO_PASSWORD is a fatal misconfiguration, so the
  // operator signs up normally and then gets promoted on the next boot.
  const fresh = await store.userById(user.id);
  const demoPassword = process.env.DEMO_PASSWORD || (isProd() ? null : 'bytebikri-demo');
  if (!fresh.password_hash && demoPassword) {
    await auth.setPassword(user.id, demoPassword);
    return { email, password: demoPassword };
  }
  return { email, password: null };
}

// A second line of defence for `node server.js` run directly; scripts/boot.mjs
// has already done this, and printed it, when that is the entry point.
assertProductionConfig(process.env, { quiet: true });

/**
 * The platform's own creative, defined in code and written on every boot.
 *
 * It is bytebikri's inventory in a slot the store is being paid to hand over, so
 * it must exist in any database that has rent slots — including one that was
 * never seeded. Content lives in `src/creatives.js` and is upserted rather than
 * appended, so changing the copy changes the page instead of stacking versions.
 */
await store.ensurePlatformCreative(HOUSE_CREATIVE);

const result = await seed();
if (result.seeded) {
  console.log('  seeded a fresh database: /s/alice and /s/bob');
  console.log(`  demo sign-in: alice@bytebikri.local / ${process.env.DEMO_PASSWORD || 'bytebikri-demo'}`);
} else if (result.reason) {
  console.log(`  not seeding: ${result.reason}`);
} else {
  console.log(`  existing data found (${result.channels} channels) — not seeding`);
}

const operator = await ensureOperator();
if (operator) {
  console.log(`  operator (can match payments): ${operator.email}`
    + (operator.password ? `  /  ${operator.password}` : '  (sign in with this account)'));
}

const SERVER = APP.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  ByteBikri  →  http://0.0.0.0:${PORT}`);
  console.log(`  storefront →  /s/alice`);
  console.log(`  dashboard  →  /dashboard/alice   (sign in first)\n`);
  if (hostsEnabled()) {
    /*
     * Say at boot WHICH KIND of media is leaving, to which host, and whether the host
     * answered.
     *
     * Two things changed here at once, and both are because the registry stopped being one
     * driver. A store's bytes can now go to more than one place (`driverForKind`), so a
     * single "video host" line would describe a third of the truth; and a host that cannot
     * do something — Telegra.ph cannot delete, Catbox is development-only — has to say so
     * BEFORE a seller meets it in the publish form rather than after.
     *
     * This is the one dependency whose failure is not obvious: the page still renders, the
     * existing files still play, and the only symptom is that new uploads fail — with a
     * sentence about a host the operator may not remember configuring. It warns rather
     * than refusing to start, because a host being down is not a reason to take the
     * platform down with it (VIDEO_STORAGE.md §6).
     */
    import('./src/video.js').then(async (video) => {
      for (const { host, kinds } of video.activeHosts()) {
        const facts = video.hostFacts().find((h) => h.host === host);
        const caps = facts || {};
        const caveats = [];
        if (caps.deletable === false) caveats.push('cannot delete — a file sent there stays');
        if (caps.policy?.commercial === 'prohibited') caveats.push('DEVELOPMENT ONLY (terms)');
        if (caps.policy?.commercial === 'premium') caveats.push('needs a paid plan to serve');
        console.log(`  ${kinds.join('/').padEnd(9)} →  ${host}${caveats.length ? ` — ${caveats.join('; ')}` : ''}`);
        // A host with no account to ask (Catbox's userhash, Telegra.ph's absence of one)
        // is not probed: the honest check for those is a real upload, which is the doctor.
        if (host === 'catbox' || host === 'telegraph') continue;
        try {
          const who = await video.account({ provider: host });
          console.log(`             reachable (${who.email || who.tier || who.id || 'ok'})`);
        } catch (err) {
          console.warn(`             UNREACHABLE — ${err.message}`);
          console.warn(`             uploads to ${host} will fail until it comes back. Everything else works,`);
          console.warn('             and files already there keep playing. Check it with:');
          console.warn(`               npm run video:check --prefix app -- --driver=${host}\n`);
        }
      }
      /*
       * THE LIVE INGEST GETS ITS OWN LINE, because it is a different kind of fact.
       *
       * Everything above says where bytes are stored. A live driver says that this
       * deployment can RUN a stream for a seller — mint one, hand them an ingest address,
       * and play the playlist that comes back — and an operator who set `LIVE_DRIVER` and
       * does not see it acknowledged here would reasonably wonder whether it took. It is
       * also where the sandbox warning belongs: `broadcasting` from a sandbox key produces
       * a watermarked 30-second stream that vanishes after a day, which is the kind of thing
       * that should be read from a boot log rather than discovered live.
       */
      const live = video.liveDriver();
      if (video.liveIngestEnabled()) {
        const caps = video.providers[live].capabilities;
        console.log(`  live ingest →  ${live} (${caps.live.ingest.rtmp})`);
        if (video.providers[live].isSandbox && video.providers[live].isSandbox()) {
          console.warn('             SANDBOX: streams are cropped to '
            + `${caps.sandbox.maxSeconds}s, watermarked, and deleted after ${caps.sandbox.deletesAfterHours}h`);
        }
      } else if (live !== 'local') {
        console.warn(`  live ingest →  ${live} is named as LIVE_DRIVER but has no credential set`);
      }
      console.log('');
    }).catch((err) => {
      console.warn(`\n  video hosts: could not report status — ${err.message}\n`);
    });
  }
});

// Graceful shutdown: stop accepting, let in-flight requests finish, close the
// pool. Without this a deploy kills in-flight postbacks mid-transaction.
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    console.log(`\n  ${signal} — shutting down`);
    SERVER.close(async () => {
      await closeDb();
      process.exit(0);
    });
    // Don't hang forever on a stuck connection.
    setTimeout(() => process.exit(1), 10_000).unref();
  });
}

// ---------------------------------------------------------------------------
// The last two things a request can hit, and the only two that are allowed to
// answer with something other than a page.
// ---------------------------------------------------------------------------

/**
 * 404. A page, not a bare `<pre>`.
 *
 * `requestedKind` comes from the path so the heading can say "that STORE is not
 * here" rather than a generic apology — the distinction matters because a store
 * link is the one people share, and a removed store answers 404 on purpose. The
 * requested URL is never echoed into the page.
 */
APP.use((req, res) => {
  const wantsHtml = String(req.headers.accept || '').includes('text/html');
  if (!wantsHtml) return res.status(404).json({ ok: false, error: 'not found' });
  const kind = /^\/s\/[^/]+/.test(req.path) ? 'file'
    : (/^\/s\/|^\/dashboard\//.test(req.path) && !req.path.includes('/a/')) ? 'store' : null;
  // A storefront path that reached here is a file, not a store: /s/alice handled
  // its own store already. The only way to be sure is the path shape.
  const asKind = req.path.startsWith('/s/') && req.path.split('/').filter(Boolean).length >= 3
    ? 'file' : (req.path.startsWith('/s/') ? 'store' : kind);
  return res.status(404).send(views.notFound({
    user: req.user || null, consent: req.consent || null, requestedKind: asKind,
  }));
});

APP.use((err, req, res, _next) => {
  const status = err.status || (err.code === 'LIMIT_FILE_SIZE' ? 413 : 500);
  // One id per failure, logged with the stack and shown to the person who hit it.
  // Without it a report says "it broke" and the log says nothing that matches.
  const requestId = crypto.randomBytes(4).toString('hex');
  console.error(`[error ${requestId}] ${req.method} ${req.originalUrl} — ${err.message}`);
  if (process.env.NODE_ENV !== 'production') console.error(err.stack);
  if (res.headersSent) return undefined;

  // Content negotiation, not guessing: an API client asked for JSON and keeps
  // getting it; a browser asked for HTML and gets a page it can read.
  const wantsHtml = String(req.headers.accept || '').includes('text/html');
  if (!wantsHtml) {
    return res.status(status).json({
      ok: false,
      error: status === 500 ? 'internal error' : err.message,
      requestId,
    });
  }
  return res.status(status).send(views.serverError({
    user: req.user || null, consent: req.consent || null, requestId,
  }));
});
