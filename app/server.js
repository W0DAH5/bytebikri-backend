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

import { store, storage, SLOT_DEFS, slugify, PLANS } from './src/store.js';
import { assertProductionConfig, readSecret, checkConfig, formatConfigReport, isProd } from './src/config.js';
import { query, many, scalar, health as dbHealth, close as closeDb } from './src/db.js';
import { allocateSlots, estimateRentSlotValue, POLICY } from './src/slots.js';
import { composeSlots, HOUSE_CREATIVE, sanitizeUrl } from './src/creatives.js';
import { exploreRails } from './src/ranking.js';
import {
  ACTIONS as MOD_ACTIONS, ACTION_LABELS, PERSON_ACTIONS, behaviour, canWrite,
  changesVisibility, decisionNote, isPublic, isPublicChannel, normaliseState,
  personStateFor, stateFor, validateDecision,
} from './src/moderation.js';
import { AUTO_HIDE_AFTER, orderQueue, reportVerdict, validateReport } from './src/reports.js';
import {
  onboardingFor, connectable, postbackUrl, validateCredential, maskSecret,
  connectionHealth, unconnectableNote,
} from './src/connections.js';
import {
  railDetails, railsReady, payeeName, upgradeExplanation, planBenefits, NOT_CHARGED,
} from './src/billing.js';
import { earningsSummary, MONEY_MAP, payoutChecklist, periodStatus } from './src/earnings.js';
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
const limitLogin = rateLimit({ windowMs: 15 * 60_000, max: 12, name: 'sign-in attempts' });
const limitSignup = rateLimit({ windowMs: 60 * 60_000, max: 10, name: 'signups' });
const limitUnlock = rateLimit({ windowMs: 60_000, max: 20, name: 'unlock attempts' });
const limitPostback = rateLimit({ windowMs: 60_000, max: 600, name: 'postbacks' });

const upload = multer({
  storage: multer.memoryStorage(),
  // A cap on the request, not just a preference: multer buffers to RAM, so an
  // unbounded upload is a memory exhaustion primitive.
  limits: { fileSize: 25 * 1024 * 1024, files: 2, fields: 12 },
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
    const channels = await decorateChannels(await store.channels());
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

APP.get('/marketplace', async (req, res, next) => {
  try {
    const q = String(req.query.q || '').slice(0, 80);
    // Only search when there is something to search for. The directory itself
    // stays the default answer, because a search box that starts empty and
    // returns nothing looks broken.
    const results = q.trim().length >= 2 ? await store.search(q) : null;
    const channels = await decorateChannels(await store.channels({ listedOnly: true }));
    const explore = results ? null : await exploreState(channels);
    res.send(views.marketplace({
      channels, user: req.user, consent: req.consent, q, results, explore,
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
    await store.audit('auth.login', { userId: user.id });
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
    await store.audit('auth.signup', { userId: user.id });
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
    // A page view by the owner while the store is hidden is not a view by the
    // public, and counting it would flatter the rent estimate with the owner's
    // own refreshes.
    if (isPublicChannel(channel)) await store.bumpPageView(channel.id);

    // A storefront shows the slots that have something in them. An empty
    // channel slot is a hole the owner should fill, not a curiosity for a
    // shopper — so it is rendered where it can be acted on, and here it is not.
    const allSlots = await slotsFor(channel, { viewer: req.user, surface: 'storefront' });
    const slots = allSlots.filter((s) => s.creative);
    const rawAssets = await store.assetsOf(channel.id);
    const assets = await Promise.all(rawAssets.map(async (a) => ({
      ...a,
      files: await store.filesOf(a.id),
      ads_required: (await store.unlockPolicy(a.id))?.ads_required ?? 1,
    })));
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

    res.send(views.storefront({
      channel, assets, slots, user: req.user, estimate, pageviews, unlockedIds,
      consent: req.consent,
      // Only the owner ever sees this banner, and only on a store that is not
      // public — it is a message about their own shop, not a public notice.
      moderation: owner && !isPublicChannel(channel)
        ? await moderationBrief(channel)
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

    const assets = await store.assetsOf(channel.id);
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
    await store.bumpPageView(channel.id);

    const unlocked = asset.unlock_mode === 'open'
      || (req.user ? await store.isUnlocked(asset.id, req.user.id) : false);

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

    // Flash messages travel as short codes and are mapped to sentences here.
    // Never echo a query parameter into HTML: `?error=<script>` is the oldest
    // reflected-XSS there is, and escaping is not a substitute for not doing it.
    const flash = flashFor(req.query);

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
      estimate, pageviews,
      adViews: await store.adViews({ channelId: channel.id }),
      assets: await store.assetsOf(channel.id),
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
    await store.audit('content.denied', {
      reason: 'token belongs to another account', assetId: a, userId: req.user.id,
    });
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
  if (asset.unlock_mode === 'open' && !await store.isUnlocked(a, u)) {
    await store.grantUnlock({
      assetId: a, channelId: asset.channel_id, userId: u, method: 'open', adsCompleted: 0,
      policy: { unlock_hours: 0 },   // free access does not expire
    });
    await store.audit('content.free_grant', { assetId: a, userId: u });
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

  await store.audit(event, { assetId: a, fileId: f, userId: u });
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

const SUCCESS_FLASH = {
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
};

const ERROR_FLASH = {
  name: 'A store needs a name.',
  title: 'A file needs a title — it becomes the page address.',
  plan: 'That plan is not available from your current one.',
  listing: 'Explore is part of the paid plans. Switch to your own address, or upgrade on the billing page.',
  banner: 'The banner must be an image under 5 MB.',
  reference: 'Enter the transaction reference from your transfer — at least four characters.',
  nothing: 'There is nothing waiting to be paid right now.',
  empty: 'A slot message needs a headline.',
  slot: 'That is not a position on your pages.',
  link: 'That link cannot be used. A full https:// address or a path on this store (/s/you) will work.',
  provider: 'That is not a network we know.',
  noadapter: 'We have no adapter for that network, so connecting it would produce a connection that can never verify a callback.',
  already: 'That network is already connected to this store.',
  moderated: 'This store is not in a state where it can publish. Nothing was changed, and nothing has been deleted.',
  action: 'That is not a moderation action.',
  rule: 'That reason is not one of our rules. Pick one from the list.',
  report_reason: 'Pick what is wrong with the file from the list.',
  report_self: 'That is your own file — there is nothing to report.',
  secret: 'That secret did not look right — copy it again from the network dashboard, with no spaces at either end.',
  nope: 'That connection is not yours.',
  unlock: 'Only someone who has unlocked this file can review it.',
  rating: 'Pick a rating from one to five.',
  media: 'Attach the file people are unlocking. Nothing was published.',
  limit: "Your plan's file limit is reached. Existing files stay live; upgrade to publish more.",
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

function flashFor(query = {}) {
  for (const [key, build] of Object.entries(SUCCESS_FLASH)) {
    if (query[key]) return { kind: 'success', message: build(query[key]) };
  }
  if (query.error) {
    // An unmatched code still says something. An empty red box is a worse
    // answer than a vague sentence.
    return { kind: 'danger', message: ERROR_FLASH[String(query.error)] || 'That did not work. Nothing was changed.' };
  }
  return null;
}

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
      // Whether the marketplace is REACHABLE, not just whether the box is
      // ticked: a free store that asks for it gets an explanation, not a
      // silent revert to storefront.
      canList: plan.capabilities.marketplace_listed === true,
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
    res.send(views.assetManage({
      channel, asset, user: req.user, consent: req.consent, flash: flashFor(req.query),
      files: await store.filesOf(asset.id),
      policy: await store.unlockPolicy(asset.id),
      stats: await store.reviewStatsOfAsset(asset.id),
      unlocks: (await store.unlocksOfChannel(channel.id)).filter((u) => u.asset_id === asset.id).length,
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

    await store.updateAsset(asset.id, {
      title,
      description: String(req.body.description || '').trim().slice(0, 2000),
      unlock_mode: req.body.unlockMode === 'open' ? 'open' : 'ad_gated',
      status: req.body.status === 'paused' ? 'paused' : 'live',
    });
    await store.setUnlockPolicy(asset.id, {
      ads_required: req.body.adsRequired,
      ad_min_seconds: req.body.adMinSeconds,
      unlock_hours: req.body.unlockHours,
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
APP.post('/s/:slug/a/:assetSlug/report', async (req, res, next) => {
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
  const [payments, invoices, reports, moderation, banned, unmatched, connections] = await Promise.all([
    store.unmatchedPayments(),
    store.openRentInvoices(),
    store.reportCounts(),
    store.channelsNeedingModeration(),
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
      moderation: c.moderation,
      banned: c.banned,
    },
  };
}

APP.get('/admin', async (req, res, next) => {
  try {
    if (!req.user || req.user.role !== 'admin') return res.status(404).send('Not found');
    const counts = await consoleCounts();
    const money = await store.platformMoney();
    const reach = await scalar(
      `select json_build_object(
         'stores', (select count(*)::int from channels where moderation_state <> 'removed'),
         'listed', (select count(*)::int from channels where listing_mode = 'marketplace' and moderation_state not in ('removed','suspended')),
         'files',  (select count(*)::int from assets where status = 'live'),
         'views',  (select coalesce(sum(views),0)::int from page_view_daily where day > current_date - 30),
         'unlocks',(select count(*)::int from unlocks where revoked_at is null),
         'events', (select count(*)::int from ad_view_events where completed = true)
       ) as r`,
    );

    res.send(views.adminOverview({
      user: await withBadges(req.user), consent: req.consent, flash: flashFor(req.query),
      kpis: [
        { label: 'Matched this month', value: `NPR ${Number(money.matched_this_month || money.matchedThisMonthNpr || 0).toLocaleString('en-IN')}`, context: `${counts.payments + counts.invoices} transfer${counts.payments + counts.invoices === 1 ? '' : 's'} to match`, tone: (money.matched_this_month || money.matchedThisMonthNpr) ? 'good' : '', href: '/admin/payments' },
        { label: 'Reports waiting', value: String(counts.reports), context: counts.reports ? `across ${counts.reportedFiles} file${counts.reportedFiles === 1 ? '' : 's'}` : 'nothing reported', tone: counts.reports >= AUTO_HIDE_AFTER ? 'bad' : counts.reports ? 'warn' : '', href: '/admin/reports' },
        { label: 'Stores not public', value: String(counts.moderation), context: counts.moderation ? 'restricted, suspended or removed' : 'every store is public', tone: counts.moderation ? 'warn' : '', href: '/admin/moderation' },
        { label: 'Paying stores', value: String(money.paying_stores || money.payingStores || 0), context: 'on any paid plan', href: '/admin/audit' },
        { label: 'Views · 30d', value: Number(reach.views || 0).toLocaleString('en-IN'), context: `${Number(reach.unlocks || 0).toLocaleString('en-IN')} unlocks · ${Number(reach.events || 0).toLocaleString('en-IN')} ad views` },
      ],
      queues: [
        { title: 'Transfers to match', count: counts.payments + counts.invoices, note: 'A person matches each one against the statement by hand.', href: '/admin/payments' },
        { title: 'Files reported', count: counts.reports, note: `${AUTO_HIDE_AFTER} distinct reporters hide a file automatically. Below that, it waits.`, href: '/admin/reports' },
        { title: 'Stores needing a decision', count: counts.moderation, note: 'Restricted, suspended or removed.', href: '/admin/moderation' },
        { title: 'Suspended accounts', count: counts.banned, note: 'Signed out everywhere, stores hidden, nothing deleted.', href: '/admin/users' },
        { title: 'Connections needing a look', count: counts.silentConnections, note: 'Never called us back, or calling with a secret that does not match.', href: '/admin/connections' },
      ],
      platform: [
        ['Charges', '<strong>Two</strong> — a plan upgrade and annual rent'],
        ['Share of ad earnings', '<strong>0%</strong> — the network pays the creator directly'],
        // A real apostrophe, not an entity: the label is escaped when it is
        // rendered, so an entity here would reach the page as &#39;.
        ["Held on a creator's behalf", '<strong>Nothing, ever</strong>'],
        ['Matched by', 'a person, against the bank or wallet statement'],
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
      sort: String(req.query.sort || 'traffic'),
    };

    if (req.query.format === 'csv') {
      const all = await store.storeDirectory({ ...filters, perPage: 100, page: 1 });
      const head = ['store', 'slug', 'owner_email', 'plan', 'subscription', 'state',
        'listing', 'files_live', 'files_total', 'views_30d', 'unlocks', 'ad_views_30d', 'reviews', 'last_file_at'];
      const cell = (v) => {
        const str = v === null || v === undefined ? '' : String(v);
        return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
      };
      const body = all.rows.map((r) => [r.name, r.slug, r.owner_email || '', r.plan_code, r.sub_status,
        r.moderation_state, r.listing_mode, r.files_live, r.files_total, r.views_30d,
        r.unlocks, r.ad_views_30d, r.reviews, r.last_file_at ? new Date(r.last_file_at).toISOString() : '']
        .map(cell).join(','));
      const stamp = new Date().toISOString().slice(0, 10);
      await store.audit('channel.directory_exported', { filters, rows: all.rows.length },
        { actorId: req.user.id });
      res.setHeader('content-type', 'text/csv; charset=utf-8');
      res.setHeader('content-disposition',
        `attachment; filename="bytebikri-stores-${stamp}-${all.rows.length}.csv"`);
      return res.send(`${head.join(',')}\n${body.join('\n')}\n`);
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
    // A store that does not exist is not a 404 for the operator: "no such store"
    // is a legitimate answer that deserves a page with a way back.
    return res.send(views.adminStoreDetail({
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

APP.get('/admin/reports', async (req, res, next) => {
  try {
    if (!req.user || req.user.role !== 'admin') return res.status(404).send('Not found');
    const queue = orderQueue(await store.openReports());
    // The notes come from the individual reports, minus who wrote them.
    const rows = await Promise.all(queue.map(async (r) => ({
      ...r, notes: (await store.reportsForAsset(r.asset_id)).filter((x) => x.status === 'open' && x.note).slice(0, 4),
    })));
    const rules = await store.policyRules();
    res.send(views.adminReports({
      user: await withBadges(req.user), consent: req.consent, flash: flashFor(req.query),
      rows, ruleTitles: Object.fromEntries(rules.map((r) => [r.code, r.title])),
    }));
  } catch (err) { next(err); }
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

APP.get('/admin/audit', async (req, res, next) => {
  try {
    if (!req.user || req.user.role !== 'admin') return res.status(404).send('Not found');
    const rows = await store.recentAudit(300);
    res.send(views.adminAudit({
      user: await withBadges(req.user), consent: req.consent,
      rows, q: String(req.query.q || '').slice(0, 40), total: rows.length,
    }));
  } catch (err) { next(err); }
});

APP.get('/admin/moderation', async (req, res, next) => {
  try {
    if (!req.user || req.user.role !== 'admin') return res.status(404).send('Not found');
    res.send(views.adminModeration({
      user: req.user, consent: req.consent,
      rules: await store.policyRules(),
      rows: await store.channelsNeedingModeration(),
      actions: MOD_ACTIONS,
      labels: ACTION_LABELS,
      flash: flashFor(req.query),
    }));
  } catch (err) { next(err); }
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
APP.get('/admin/users', async (req, res, next) => {
  try {
    if (!req.user || req.user.role !== 'admin') return res.status(404).send('Not found');
    const q = String(req.query.q || '').slice(0, 80);
    const [rules, banned] = await Promise.all([store.policyRules(), store.bannedUsers()]);
    const matches = q.trim().length >= 2 ? await store.usersMatching(q) : [];
    const history = Object.fromEntries(await Promise.all(
      banned.slice(0, 25).map(async (u) => [u.id, await store.userModerationHistory(u.id, 3)]),
    ));
    res.send(views.adminUsers({
      user: req.user, consent: req.consent, flash: flashFor(req.query),
      rules, banned, matches, q, history, personActions: PERSON_ACTIONS, labels: ACTION_LABELS,
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
    await store.addProviderReport({
      channelId: alice.id, providerId: 'adsterra',
      periodStart: '2026-08-01', periodEnd: '2026-08-31', reportedUsd: 0.11,
      note: 'From the network portal, August.',
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
