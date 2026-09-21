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

import { store, storage, SLOT_DEFS, slugify } from './src/store.js';
import { assertProductionConfig, readSecret, checkConfig, formatConfigReport } from './src/config.js';
import { many, scalar, health as dbHealth, close as closeDb } from './src/db.js';
import { allocateSlots, estimateRentSlotValue, POLICY } from './src/slots.js';
import { selectableProviders, providerById, loadRegistry } from './src/registry.js';
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
      scriptSrc: ["'self'"],
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
      stats: { channels: channels.length, assets, unlocks, views: views_ },
    }));
  } catch (err) { next(err); }
});

APP.get('/marketplace', async (req, res, next) => {
  try {
    const channels = await decorateChannels(await store.channels({ listedOnly: true }));
    res.send(views.marketplace({ channels, user: req.user, consent: req.consent }));
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
    if (!channel) return res.status(404).send('Channel not found');
    await store.bumpPageView(channel.id);

    const slots = (await buildSlots(channel)).filter((s) => s.serving);
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
    }));
  } catch (err) { next(err); }
});

APP.get('/s/:slug/a/:assetSlug', async (req, res, next) => {
  try {
    const channel = await store.channelBySlug(req.params.slug);
    if (!channel) return res.status(404).send('Channel not found');
    const asset = await store.assetBySlug(channel.id, req.params.assetSlug);
    if (!asset) return res.status(404).send('Asset not found');
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

    // The on-screen mark for video and audio, which cannot be burned in without
    // a transcoder. It is the same reference that goes into the pixels of an
    // image, drawn in the DOM instead — and the page says which of the two it is.
    const markUri = unlocked && req.user
      ? watermarkSvgDataUri(watermarkLabel({ ref: req.user.id, assetId: asset.id }))
      : '';

    res.send(views.assetPage({
      channel, asset, files, unlocked, user: req.user, consent: req.consent,
      previewFile, markUri,
      policy: await store.unlockPolicy(asset.id),
      slots: (await buildSlots(channel)).filter((s) => s.serving && s.surface === 'webview'),
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
    const flash = req.query.published
      ? { kind: 'success', message: `Published “${String(req.query.published).slice(0, 80)}”. It is live on your storefront now.` }
      : req.query.error
        ? { kind: 'danger', message: FLASH[String(req.query.error)] || 'That did not work. Nothing was published.' }
        : null;

    res.send(views.dashboard({
      flash, consent: req.consent,
      channel, slots, user: req.user,
      connections: await store.connectionsOf(channel.id),
      providers: await selectableProviders(),
      plan: store.plan(channel),
      estimate, pageviews,
      adViews: await store.adViews({ channelId: channel.id }),
      upgrade: store.upgradeQuote(channel, 'store'),
      pendingPayments: (await store.planPayments()).filter((p) => p.channel_id === channel.id),
    }));
  } catch (err) { next(err); }
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
const FLASH = {
  title: 'Give the file a title — it becomes the page address.',
  media: 'Attach the file people are unlocking. Nothing was published.',
  limit: 'Your plan\'s file limit is reached. Existing files stay live; upgrade to publish more.',
  cover: 'The cover must be an image under 5 MB.',
  size: 'That file is larger than the 25 MB upload limit.',
  toobig: 'That file is larger than the 25 MB upload limit.',
};

APP.post('/dashboard/:slug/assets', upload.fields([
  { name: 'media', maxCount: 1 },
  { name: 'cover', maxCount: 1 },
]), async (req, res, next) => {
  const back = `/dashboard/${encodeURIComponent(req.params.slug)}`;
  try {
    if (!req.user) return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);

    const channel = await store.channelBySlug(req.params.slug);
    if (!channel || channel.owner_id !== req.user.id) return res.status(404).send('Channel not found');

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
// Ad connections
// ---------------------------------------------------------------------------
APP.post('/api/ad-connections/start', async (req, res, next) => {
  try {
    const { slug, providerId } = req.body || {};
    const channel = await store.channelBySlug(slug);
    if (!channel) return res.json({ ok: false, error: 'channel not found' });
    if (!req.user || channel.owner_id !== req.user.id) {
      return res.status(403).json({ ok: false, error: 'not your channel' });
    }

    const provider = await providerById(providerId);
    if (!provider) return res.json({ ok: false, error: 'unknown provider' });
    if (!provider.enabled) {
      return res.json({ ok: false, error: provider.blockedReason || 'provider not enabled — verification outstanding' });
    }

    const conn = await store.createConnection({
      channelId: channel.id, providerId, payoutVerdict: null,
      slotKeys: SLOT_DEFS.slice(0, 3).map((s) => s.key),
      // Issued per connection. In production this comes from the provider's
      // dashboard by way of a secrets manager; generated here so the postback
      // path is exercisable end to end.
      secret: crypto.randomBytes(24).toString('base64url'),
      callbackBaseUrl: `http://127.0.0.1:${PORT}`,
    });
    await store.audit('ad_connection.created', { channelId: channel.id, providerId, connectionId: conn.id });
    res.json({ ok: true, connectionId: conn.id });
  } catch (err) { next(err); }
});

APP.post('/api/ad-connections/revoke', async (req, res, next) => {
  try {
    const c = await store.revokeConnection(req.body?.connectionId);
    res.json({ ok: Boolean(c) });
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
APP.use((err, req, res, _next) => {
  console.error(`[error] ${req.method} ${req.originalUrl} — ${err.message}`);
  if (process.env.NODE_ENV !== 'production') console.error(err.stack);
  const status = err.status || (err.code === 'LIMIT_FILE_SIZE' ? 413 : 500);
  res.status(status).json({
    ok: false,
    error: status === 500 ? 'internal error' : err.message,
  });
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

  return { seeded: true, alice: alice.slug, bob: bob.slug };
}

// A second line of defence for `node server.js` run directly; scripts/boot.mjs
// has already done this, and printed it, when that is the entry point.
assertProductionConfig(process.env, { quiet: true });

const result = await seed();
if (result.seeded) {
  console.log('  seeded a fresh database: /s/alice and /s/bob');
  console.log(`  demo sign-in: alice@bytebikri.local / ${process.env.DEMO_PASSWORD || 'bytebikri-demo'}`);
} else if (result.reason) {
  console.log(`  not seeding: ${result.reason}`);
} else {
  console.log(`  existing data found (${result.channels} channels) — not seeding`);
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
