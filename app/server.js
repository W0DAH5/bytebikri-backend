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
import {
  METHODS, DEFAULT_MONTHS, LAPSE_WINDOW_DAYS, stateOf, requestability, lapseOf, lapseNotice,
  withinNoticeWindow,
} from './src/verification.js';
import { assertProductionConfig, readSecret, checkConfig, formatConfigReport, isProd } from './src/config.js';
import { query, many, scalar, health as dbHealth, close as closeDb } from './src/db.js';
import { allocateSlots, estimateRentSlotValue, POLICY } from './src/slots.js';
import { csvCell, csvDocument, exportAll, truncationNote } from './src/export.js';
import { AUDIT_FAMILIES, actorOf } from './src/audit.js';
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
  duesLine, tierByNo,
} from './src/memberships.js';
// Storefront themes: curated palettes, and the plan capability that has been in
// the plans table since migration 0001 without a single reader until now.
import { THEMES, THEME_KEYS, THEME_NOTE, THEME_FREE_LINE, NO_THEME, canTheme, themeDraft, themeStyle } from './src/themes.js';
import { SANDBOX_PROVIDER_IDS } from './src/providers/index.js';
import { selectableProviders, providerById, payoutVerdict, loadRegistry } from './src/registry.js';
import {
  startUnlock, unlockStatus, handlePostback, signHousePostback,
  verifyAccessToken, issueDownloadUrl, issueStreamUrl,
} from './src/unlocks.js';
import {
  mediaKind, isPlayable, isWatermarkable, hasImageMagick, watermarkImage,
  watermarkLabel, watermarkSvgDataUri, derivativeKey, cachedDerivative, cacheDerivative,
  rangeFor,
} from './src/media.js';
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
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
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

async function buildSlots(channel, surfaces = ['web']) {
  const plan = store.plan(channel);
  return allocateSlots({
    slotDefs: SLOT_DEFS,
    capabilities: plan.capabilities,
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
async function slotsFor(channel, { viewer = null, surface = 'storefront', surfaces = ['web'] } = {}) {
  const slots = await buildSlots(channel, surfaces);
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

const LEGAL_DOCS = { privacy: legal.privacy, terms: legal.terms, cookies: legal.cookies };

APP.get('/legal/:slug', async (req, res, next) => {
  try {
    const build = LEGAL_DOCS[req.params.slug];
    if (!build) return res.status(404).send('Not found');
    const doc = build({ consent: req.consent });
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
 * `back` is always the storefront: the person came from there, the panel is
 * there, and the answer ("you are in, waiting for the creator") belongs where
 * they can see their own state.
 */
function memberBack(channel, extra = '') {
  return `/s/${encodeURIComponent(channel.slug)}${extra}`;
}

APP.post('/s/:slug/join', limitWatch, async (req, res, next) => {
  try {
    const channel = await store.channelBySlug(req.params.slug);
    if (!channel) return res.status(404).send(views.notFound({ user: req.user, requestedKind: 'store' }));
    if (!req.user) return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);

    // Two refusals before anything is written, and both are sentences a person
    // is owed: you cannot join your own store (the dues would be a loop), and
    // you cannot join a store whose plan does not include members.
    if (channel.owner_id === req.user.id) return res.redirect(memberBack(channel, '?error=member-own'));
    const plan = store.plan(channel);
    if (plan.capabilities?.memberships !== true) return res.redirect(memberBack(channel, '?error=member-plan'));

    const tiers = await store.membershipTiers(channel.id);
    const wanted = Number(req.body?.tier) || 1;
    const tier = tiers.find((t) => Number(t.tier_no) === wanted) ?? tiers[0] ?? null;
    if (!tier) return res.redirect(memberBack(channel, '?error=member-no-tier'));

    // A reference is the only thing that can be matched against a statement. The
    // form asks for it at the door rather than two screens later, because a
    // claim without one sits in the creator's queue until they give up on it.
    const method = CLAIM_METHODS.includes(String(req.body?.method)) ? String(req.body.method) : 'other';
    const reference = String(req.body?.reference || '').trim();
    if (reference.length < 4) return res.redirect(memberBack(channel, '?error=member-reference'));

    const row = await store.joinMembership({
      profileId: req.user.id,
      channelId: channel.id,
      tierNo: tier.tier_no,
      claim: {
        amountNpr: Number(req.body?.amount) || null,
        method,
        txnReference: reference,
        payerName: String(req.body?.payerName || '').trim().slice(0, 120) || req.user.display_name,
        payerNumber: String(req.body?.payerNumber || '').trim().slice(0, 40) || null,
      },
    });
    if (!row) return res.redirect(memberBack(channel, '?error=member-active'));
    await store.audit('member.claimed', {
      channelId: channel.id, tierNo: tier.tier_no, amountNpr: row.amount_npr,
      txnReference: row.txn_reference, method: row.method,
    }, { actorId: req.user.id, subjectType: 'channel', subjectId: channel.id });
    return res.redirect(memberBack(channel, '?joined=1#members'));
  } catch (err) { return next(err); }
});

APP.post('/s/:slug/leave', limitWatch, async (req, res, next) => {
  try {
    const channel = await store.channelBySlug(req.params.slug);
    if (!channel) return res.status(404).send(views.notFound({ user: req.user, requestedKind: 'store' }));
    if (!req.user) return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
    const left = await store.leaveMembership(req.user.id, channel.id);
    return res.redirect(memberBack(channel, left ? '?left=1#members' : '?error=member-none'));
  } catch (err) { return next(err); }
});

/** Being named on the storefront is the perk, and it is the member's call. */
APP.post('/s/:slug/members/listing', limitWatch, async (req, res, next) => {
  try {
    const channel = await store.channelBySlug(req.params.slug);
    if (!channel) return res.status(404).send(views.notFound({ user: req.user, requestedKind: 'store' }));
    if (!req.user) return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
    const listed = await store.setMemberListed({
      profileId: req.user.id, channelId: channel.id, listed: req.body?.listed === 'yes',
    });
    return res.redirect(memberBack(channel, listed ? '?listed=1#members' : '?error=member-none'));
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
    const rawAssets = await store.assetsOf(channel.id);
    // Two decisions are applied here and not in the view: the file's own state
    // (a removed file is not on the public web) and the country rule that
    // applies where this visitor is standing.
    const listed = await withCountry(rawAssets, country);
    const assets = await Promise.all(
      listed.filter((a) => seesEverything || a.availability.visible).map(async (a) => ({
        ...a,
        files: await store.filesOf(a.id),
        ads_required: (await store.unlockPolicy(a.id))?.ads_required ?? 1,
      })),
    );
    if (country) countryDependent(res);
    const pageviews = await store.pageviews30d(channel.id);
    // The rent estimate is what the CREATOR pays for traffic — billing detail.
    // It feeds the dashboard, not the shop window, so it is not passed here.
    const estimate = estimateRentSlotValue({ pageviews30d: pageviews, slots });

    // Which of these the viewer has already unlocked, in ONE query rather than
    // one per card. The view layer cannot ask; it renders synchronously.
    const unlockedIds = req.user
      ? new Set((await many(
          `select asset_id from unlocks
            where user_id = $1 and revoked_at is null
              and (expires_at is null or expires_at > now())
              and asset_id = any($2)`,
          [req.user.id, rawAssets.map((a) => a.id)],
        )).map((r) => r.asset_id))
      : new Set();

    // Membership, in four reads: what this store offers, what the viewer holds,
    // who is named on it, and whether the plan even includes the feature. All
    // four are skipped for the many stores that do not use it — the tiers query
    // returns nothing and the panel is not drawn.
    const tiers = await store.membershipTiers(channel.id);
    const membership = req.user ? await store.membershipFor(req.user.id, channel.id) : null;
    const membershipsOn = store.plan(channel).capabilities?.memberships === true;
    // A current membership opens the files behind its tier with no ad, so they
    // join the same set the ad-unlocked files live in: one set, one meaning —
    // "you can open this right now" — rather than two flags the view would have
    // to combine and could get wrong.
    if (tiers.length && membershipCurrent(membership)) {
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
      roster: tiers.length ? await store.publicRoster(channel.id) : [],
      memberFlash: flashFor(req.query),
      // The store's own look. Two custom properties rather than a class per theme,
      // so a seventh palette is one entry in `themes.js` and no stylesheet edit —
      // and so a palette can never reach a surface whose contrast nobody measured:
      // the band, and only the band, is what those two properties paint.
      theme: channel.theme ?? null,
      themeStyle: themeStyle(channel.theme),
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
          unlocked: a.unlock_mode === 'open' || unlockedIds.has(a.id),
          adsRequired: (await store.unlockPolicy(a.id))?.ads_required ?? 1,
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
    const memberCover = req.user
      ? await store.memberCoversAsset({ profileId: req.user.id, channelId: channel.id, asset })
      : null;
    const unlocked = (asset.unlock_mode === 'open' || holdsUnlock || Boolean(memberCover))
      && availability.unlockable;

    // Content URLs are minted per request, per user, and expire. They are only
    // produced when an unlock actually exists — never baked into the HTML.
    //
    // The view is told what each file IS, not what to do with it: a video is
    // played, an image is watermarked and shown, a zip is downloaded, and only
    // the page decides how that reads. That keeps the decision in one place
    // instead of a filename suffix check inside a template string.
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

    res.send(views.assetPage({
      channel, asset, files, unlocked, user: req.user, consent: req.consent,
      accessUntil: unlock?.expires_at ?? null,
      previewFile, markUri, markLabel,
      alreadyReported,
      reported: reportedFlag ? { reporters: await store.reportVerdictFor(asset.id).then((v) => v.reporters), filed: true, hidden: false } : null,
      reportError,
      reviews, reviewStats,
      canReview: Boolean(unlock) && !myReview,
      myReview,
      reviewError: REVIEW_ERRORS[String(req.query.error)] || null,
      policy: await store.unlockPolicy(asset.id),
      // Which tier the viewer holds, and what the file needs — the two facts the
      // refusal sentence is built from.
      memberCover,
      memberTiers: asset.unlock_mode === 'members' ? await store.membershipTiers(channel.id) : [],
      memberTierName: asset.unlock_mode === 'members'
        ? (await store.membershipTiers(channel.id)).find((t) => Number(t.tier_no) === (Number(asset.member_tier) || 1))?.name ?? null
        : null,
      refusal, ownerNotice,
      // A file the viewer can open because an operator allowed it back into a
      // country whose store-wide rule would otherwise refuse them.
      carveOut: views.carriedByCarveOut({
        resolved, country, rule: ruleFor(await store.policyRules(), resolved.ruleCode), store: channel.name,
      }),
      // On a file page the whole point of the space is to pay for the unlock, so
      // the platform slot is always here — the creator's own message appears
      // only if they wrote one.
      slots: (await slotsFor(channel, { viewer: req.user, surface: 'asset' }))
        .filter((s) => s.creative && s.surface !== 'app_native'),
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
    res.send(views.slotsPage({
      channel, user: req.user, consent: req.consent,
      slots: await slotsFor(channel, { viewer: req.user, surface: 'dashboard' }),
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
  if (asset.unlock_mode === 'open' && asset.status === 'live' && !await store.isUnlocked(a, u)) {
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

    const unlocked = asset.unlock_mode === 'open' || await store.isUnlocked(asset.id, req.user.id);
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

    let buf = await storage.get(file.storage_key);
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

    let buf = await storage.get(file.storage_key);
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
  submitted: () => 'Reference received. An operator matches it against the bank or wallet statement by hand, and your plan changes when it clears.',
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
  joined: () => `Asked. The creator checks their own statement for your reference and confirms it — the platform never sees these dues, so it cannot confirm them for you. ${LAPSE_LINE}`,
  left: () => 'You left. Nothing was deleted — your opens stay open until their own windows run out.',
  listed: () => 'You are on the list.',
  'member-confirmed': () => 'Confirmed. Their plate is on the storefront now, and the files behind that tier open for them without an ad.',
  'member-rejected': () => 'Marked as not found, and the reason went with it. They can send the reference again.',
  'tier-saved': (v) => `Tier ${String(v || '')} saved. What a member pays, and what they get, is now what the storefront shows.`,
  'tier-removed': () => 'Tier removed. Nobody was holding it, so nothing changed for anybody but the panel.',
  'note-saved': () => 'Saved. This is what a visitor is told about paying you — keep it to something you would be happy to see written down.',
  theme: (v) => (v === 'plain'
    ? 'Back to the default look. Nothing else about your store changed.'
    : `Saved — ${String(v || 'that')} is on your storefront now. It paints the band behind your name and nothing else, and it is checked for readability in both light and dark before it can be offered.`),
};

const ERROR_FLASH = {
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
  'member-owner-only': 'Only the store owner can confirm dues. The platform never receives this money, so nobody here can check it.',
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
  for (const [key, build] of Object.entries(SUCCESS_FLASH)) {
    if (query[key]) return { kind: 'success', message: build(query[key]) };
  }
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

    await store.addFile({
      assetId: asset.id,
      storageKey: await storage.put(media.buffer, media.originalname),
      filename: media.originalname,
      mimeType: media.mimetype,
      sizeBytes: media.size,
      checksum: crypto.createHash('sha256').update(media.buffer).digest('hex'),
    });

    const seconds = Number(req.body.adMinSeconds);
    if (Number.isFinite(seconds)) {
      await store.setAdMinSeconds(asset.id, Math.min(Math.max(Math.round(seconds), 5), 120));
    }

    await store.audit('asset.created', { assetId: asset.id, channelId: channel.id });
    res.redirect(`${back}?published=${encodeURIComponent(assetSlug)}`);
  } catch (err) {
    if (err.code === 'LIMIT_FILE_SIZE' || err.code === 'LIMIT_UNEXPECTED_FILE') return fail('size');
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
    return res.redirect(`${back}?submitted=1`);
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
    res.send(views.assetManage({
      channel, asset, user: req.user, consent: req.consent, flash: flashFor(req.query),
      // The two facts the access control needs: whether the plan includes members
      // at all, and which tiers exist to put a file behind.
      membershipsOn,
      tiers: membershipsOn ? await store.membershipTiers(channel.id) : [],
      files: await store.filesOf(asset.id),
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
    await store.updateAsset(asset.id, {
      title,
      description: String(req.body.description || '').trim().slice(0, 2000),
      unlock_mode: req.body.unlockMode === 'open' ? 'open' : wantsMembers ? 'members' : 'ad_gated',
      member_tier: memberTier,
      status: req.body.status === 'paused' ? 'paused' : 'live',
    });
    await store.setUnlockPolicy(asset.id, {
      ads_required: req.body.adsRequired,
      ad_min_seconds: req.body.adMinSeconds,
      unlock_hours: req.body.unlockHours,
      // The same value that was just written to the asset, so the two rows that
      // carry this one decision cannot drift apart.
      mode: req.body.unlockMode === 'open' ? 'open' : wantsMembers ? 'members' : 'ad_gated',
    });
    await store.audit('asset.updated', { assetId: asset.id, channelId: channel.id });
    return res.redirect(`${back}?saved=1`);
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
      const key = await storage.put(req.file.buffer, req.file.originalname);
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
  // Demo-friendly: 5 seconds rather than the real 15.
  await store.setAdMinSeconds(asset.id, 5);

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
      description: 'Five minutes through the kit — layers, type pairings, and how to export for print.',
    });
    await store.addFile({
      assetId: videoAsset.id, storageKey: await storage.put(clip, 'store-walkthrough.mp4'),
      filename: 'store-walkthrough.mp4', mimeType: 'video/mp4', sizeBytes: clip.length,
      checksum: crypto.createHash('sha256').update(clip).digest('hex'),
    });
    await store.setAdMinSeconds(videoAsset.id, 5);
    walkthrough = videoAsset;
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }

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
  await store.setAdMinSeconds(bobAsset.id, 5);

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
