/**
 * Security middleware.
 *
 * The app grew a login form this round, which changes what is worth attacking.
 * Before, the only endpoint that mattered was the postback — already signature
 * verified. Now there is a password to guess and a session cookie to ride, so:
 *
 *   originOk      — blocks cross-site state changes. SameSite=Lax stops the
 *                   cookie being SENT cross-site, but a request can still arrive
 *                   and be processed; this refuses it outright.
 *   rateLimit     — credential stuffing, and postback floods from a single host.
 *   secureCookie  — httpOnly so script cannot read the session, Secure in
 *                   production, SameSite=Lax so a link from elsewhere still works.
 *
 * Deliberately not added: a hash-based CSRF token store. Origin checking plus
 * SameSite=Lax covers the same attacks without server state, and a token system
 * that is not integrated everywhere is worse than none because it reads as
 * protection. If we ever accept state-changing GETs, this reasoning breaks —
 * so we do not.
 */

// ---------------------------------------------------------------------------
// Origin check
// ---------------------------------------------------------------------------

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Reject cross-origin state changes.
 *
 * The decision is made by `Sec-Fetch-Site`, not by Origin, and the difference
 * matters. Origin is absent on plenty of LEGITIMATE requests — an Android
 * WebView form POST, curl, a provider's server. Treating "no Origin" as hostile
 * breaks all of those, and mobile WebView is the primary surface this app is
 * built for. `Sec-Fetch-Site` is sent by browsers specifically to answer this
 * question: `cross-site` means a page on another origin started the request, and
 * a browser never lies about it because the page cannot set it.
 *
 * So: refuse `cross-site` outright, then fall back to comparing Origin/Referer
 * for browsers too old to send Fetch Metadata, and allow when neither is present
 * (a non-browser client — which cannot forge a cookie-bearing request from a
 * victim's browser anyway, since it has no browser to ride).
 */
export function originCheck({ publicBaseUrl } = {}) {
  const allowed = new Set(
    [publicBaseUrl, process.env.PUBLIC_BASE_URL]
      .filter(Boolean)
      .map((u) => { try { return new URL(u).origin; } catch { return null; } })
      .filter(Boolean),
  );

  const refuse = (res) => res.status(403).json({ ok: false, error: 'cross-origin request refused' });

  return (req, res, next) => {
    if (SAFE_METHODS.has(req.method)) return next();

    // The postback endpoint authenticates with a signature over the exact bytes
    // the provider sent. A browser-origin check there would reject legitimate
    // server-to-server callbacks, which have no browser origin at all.
    if (req.path.startsWith('/api/ads/postback/')) return next();

    // Primary: the browser's own account of who started this.
    const site = req.get('sec-fetch-site');
    if (site) return site === 'cross-site' ? refuse(res) : next();

    // Fallback for browsers without Fetch Metadata.
    const raw = req.get('origin') || req.get('referer');
    if (!raw) return next();   // no browser involved

    let origin;
    try { origin = new URL(raw).origin; } catch { return refuse(res); }

    // The host we were actually reached on — in development the preview host
    // differs from PUBLIC_BASE_URL.
    const selfOrigin = `${req.protocol}://${req.get('host')}`;
    if (origin === selfOrigin || allowed.has(origin)) return next();

    return refuse(res);
  };
}

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------

/**
 * Sliding-window limiter, in memory.
 *
 * LIMITATION, stated because it matters: this is per-process. Behind two
 * instances the effective limit doubles, and a restart clears every budget. That
 * is acceptable for the general endpoints here and NOT acceptable for login,
 * which is why login failures are also counted in the database (see auth.js
 * recentFailures) where a restart cannot erase them.
 */
/**
 * A limiter, with one rule about how it says no.
 *
 * A rate limit is a conversation with whoever is on the other end, and the honest
 * version of it is a sentence with a wait in it. The first version returned JSON
 * unconditionally, so a person who mistyped their password twelve times — a normal
 * thing to do — was shown `{"ok":false,"error":"too many sign-in attempts..."}` as
 * a page of raw text. Browsers navigate; APIs fetch. `render` is how a route that
 * serves pages says which one it is talking to, and the JSON path stays for the
 * postback endpoint, where no human ever reads the answer.
 */
export function rateLimit({
  windowMs = 60_000, max = 60, key = (req) => req.ip, name = 'requests', render = null,
} = {}) {
  const hits = new Map();

  // Bound the map. Without eviction a limiter under attack becomes the memory
  // leak it was meant to prevent: one entry per source address, forever.
  const sweep = setInterval(() => {
    const cutoff = Date.now() - windowMs;
    for (const [k, times] of hits) {
      const live = times.filter((t) => t > cutoff);
      if (live.length) hits.set(k, live); else hits.delete(k);
    }
  }, windowMs).unref();

  const middleware = (req, res, next) => {
    const id = key(req) || 'unknown';
    const now = Date.now();
    const cutoff = now - windowMs;
    const times = (hits.get(id) || []).filter((t) => t > cutoff);

    if (times.length >= max) {
      const retryAfter = Math.max(Math.ceil((times[0] + windowMs - now) / 1000), 1);
      res.setHeader('retry-after', String(retryAfter));
      // `accepts` returns the first type the client will take, in the order we
      // name them — so a browser that sends `text/html,...` gets the page and a
      // client that sends `application/json` keeps the object it was expecting.
      if (render && req.accepts?.(['html', 'json']) === 'html') {
        res.status(429).type('html').send(render({
          retryAfter, what: name, max, windowMs, user: req.user || null,
        }));
        return;
      }
      return res.status(429).json({
        ok: false,
        error: `too many ${name}; try again in ${retryAfter}s`,
      });
    }

    times.push(now);
    hits.set(id, times);
    res.setHeader('x-ratelimit-remaining', String(Math.max(max - times.length, 0)));
    next();
  };

  middleware.stop = () => clearInterval(sweep);
  middleware.reset = () => hits.clear();
  return middleware;
}

// ---------------------------------------------------------------------------
// Account credentials — the rules, with no dependencies
// ---------------------------------------------------------------------------
// These live here, in a module that touches no database, because the sign-up form
// and the reset form both need to state the same minimum as the server enforces.
// Putting them in `recovery.js` next to the reset logic was the obvious choice and
// the wrong one: `recovery.js` queries, so `views.js` importing it made rendering
// a page require a database connection — four test files failed on the import
// alone, which is a good sign the boundary was in the wrong place.

/**
 * The shortest password the product accepts.
 *
 * Eight, because that is what sign-up has always promised and what `hashPassword`
 * refuses below. A reset form demanding ten while the sign-up form accepts eight
 * is not a stricter policy, it is two policies — and a person who chose eight
 * characters last year would be told their own password is not good enough while
 * recovering the account. `auth.js` imports this constant rather than repeating
 * the number, so the two cannot drift.
 */
export const MIN_PASSWORD_LENGTH = 8;

/** How long a reset link is valid. Stated on the page, in the email, and here. */
export const RESET_TTL_MINUTES = 60;

// ---------------------------------------------------------------------------
// Cookies
// ---------------------------------------------------------------------------

const isProd = () => process.env.NODE_ENV === 'production';

/** httpOnly so script cannot read it; Lax so an inbound link still works. */
export function setSessionCookie(res, token, maxAgeMs) {
  res.cookie('bb_session', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProd(),
    path: '/',
    maxAge: maxAgeMs,
  });
}

export function clearSessionCookie(res) {
  res.clearCookie('bb_session', { path: '/' });
}

/**
 * Minimal cookie parser.
 *
 * Six lines against a dependency. The only cookie this app sets or reads is its
 * own session token, and pulling in a parser to handle a case we do not have is
 * a maintenance surface with no matching benefit.
 */
export function cookieParser() {
  return (req, _res, next) => {
    req.cookies = {};
    const header = req.headers.cookie;
    if (header) {
      for (const pair of header.split(';')) {
        const eq = pair.indexOf('=');
        if (eq < 0) continue;
        const k = pair.slice(0, eq).trim();
        if (!k) continue;
        try {
          req.cookies[k] = decodeURIComponent(pair.slice(eq + 1).trim());
        } catch {
          req.cookies[k] = pair.slice(eq + 1).trim();
        }
      }
    }
    next();
  };
}
