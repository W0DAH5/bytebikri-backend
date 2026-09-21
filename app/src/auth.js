/**
 * Accounts and sessions.
 *
 * Three decisions worth stating, because each is the opposite of what the
 * obvious implementation does:
 *
 *  1. PASSWORDS use scrypt from node:crypto, stored self-describing as
 *     `scrypt$N$r$p$salt$hash`. A native module (bcrypt, argon2) means a build
 *     toolchain on every deploy target. The gap between well-parameterised
 *     scrypt and argon2id is far smaller than the gap between argon2id and a
 *     dependency that will not compile on the host you actually deploy to.
 *
 *  2. SESSION TOKENS are stored as SHA-256, never in the clear. The cookie value
 *     is a bearer credential — whoever reads it IS the user. A leaked database
 *     must not hand over live sessions, exactly as it must not hand over
 *     passwords.
 *
 *  3. LOGIN FAILURES cost real CPU time and are counted per email AND per IP.
 *     Comparing a hash is ~100ms by design; that is a rate limit, but only if
 *     the code actually does the work on failure. Returning early when the user
 *     does not exist makes "unknown email" measurably faster than "wrong
 *     password", which is a user-enumeration oracle.
 */
import crypto from 'node:crypto';
import { one, query, scalar, withTransaction } from './db.js';

// scrypt cost. N=2^15 with r=8,p=1 is ~100ms on a modern core and ~32MB, which
// is the point: it is meant to be expensive.
const SCRYPT = { N: 32768, r: 8, p: 1, keylen: 64 };
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;         // 30 days
const SESSION_TTL_SHORT_MS = 12 * 60 * 60 * 1000;        // 12h, when "remember" is off

const b64 = (buf) => Buffer.from(buf).toString('base64url');

// ---------------------------------------------------------------------------
// Passwords
// ---------------------------------------------------------------------------

/** Derive, then encode the parameters alongside the hash so they can change. */
export function hashPassword(password) {
  if (typeof password !== 'string' || password.length < 8) {
    throw Object.assign(new Error('password must be at least 8 characters'), { status: 400 });
  }
  const salt = crypto.randomBytes(16);
  const { N, r, p, keylen } = SCRYPT;
  const hash = crypto.scryptSync(password, salt, keylen, { N, r, p, maxmem: 256 * 1024 * 1024 });
  return `scrypt$${N}$${r}$${p}$${b64(salt)}$${b64(hash)}`;
}

/**
 * Verify. Returns false for anything malformed rather than throwing — a
 * corrupt hash in the database must not 500 the login endpoint.
 */
export function verifyPassword(password, stored) {
  if (typeof password !== 'string' || typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

  const [, N, r, p, saltB64, hashB64] = parts;
  const salt = Buffer.from(saltB64, 'base64url');
  const expected = Buffer.from(hashB64, 'base64url');
  if (!salt.length || !expected.length) return false;

  let actual;
  try {
    actual = crypto.scryptSync(password, salt, expected.length, {
      N: Number(N), r: Number(r), p: Number(p), maxmem: 256 * 1024 * 1024,
    });
  } catch {
    return false;
  }
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

/**
 * Burn the same work as a real verification.
 *
 * Called when the account does not exist. Without it, "no such user" returns in
 * ~1ms and "wrong password" in ~100ms, and that difference is a reliable oracle
 * for which emails are registered.
 */
export function burnPasswordTime() {
  crypto.scryptSync('not-a-real-password', 'not-a-real-salt', SCRYPT.keylen, {
    N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: 256 * 1024 * 1024,
  });
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

/**
 * Issue a session. The raw token is returned ONCE, to be set as a cookie; only
 * its hash is persisted, so it cannot be recovered from the database later.
 */
export async function createSession({ userId, remember = true, userAgent, ip }) {
  const token = crypto.randomBytes(32).toString('base64url');
  const ttl = remember ? SESSION_TTL_MS : SESSION_TTL_SHORT_MS;
  const expires = new Date(Date.now() + ttl);

  await query(
    `insert into sessions (user_id, token_hash, expires_at, user_agent, ip_hash)
     values ($1, $2, $3, $4, $5)`,
    [
      userId,
      hashToken(token),
      expires,
      (userAgent || '').slice(0, 300),
      ip ? crypto.createHash('sha256').update(String(ip)).digest('hex').slice(0, 32) : null,
    ],
  );
  return { token, expires, ttl };
}

/**
 * Resolve a session token to a user.
 *
 * Expiry and revocation are enforced in the WHERE clause rather than in JS: a
 * check that happens after the row is loaded is a check somebody will later
 * forget to write.
 *
 * last_seen_at is only updated once an hour. Writing it on every request turns
 * each page view into a write, which is how a read-only browse of the app
 * becomes a database bottleneck.
 */
export async function resolveSession(token) {
  if (!token || typeof token !== 'string' || token.length < 20) return null;
  const row = await one(
    `select s.id as session_id, s.user_id, s.expires_at, p.*
       from sessions s
       join profiles p on p.id = s.user_id
      where s.token_hash = $1
        and s.revoked_at is null
        and s.expires_at > now()
        and p.banned = false`,
    [hashToken(token)],
  );
  if (!row) return null;

  query(
    `update sessions set last_seen_at = now()
      where id = $1 and last_seen_at < now() - interval '1 hour'`,
    [row.session_id],
  ).catch(() => { /* best-effort; never fail a request over a timestamp */ });

  return row;
}

export async function revokeSession(token) {
  if (!token) return false;
  const r = await query(
    `update sessions set revoked_at = now() where token_hash = $1 and revoked_at is null`,
    [hashToken(token)],
  );
  return r.rowCount > 0;
}

export async function revokeAllSessions(userId) {
  const r = await query(
    `update sessions set revoked_at = now() where user_id = $1 and revoked_at is null`,
    [userId],
  );
  return r.rowCount;
}

export async function sessionsOf(userId) {
  return query(
    `select id, created_at, last_seen_at, expires_at, user_agent
       from sessions
      where user_id = $1 and revoked_at is null and expires_at > now()
      order by last_seen_at desc`,
    [userId],
  ).then((r) => r.rows);
}

// ---------------------------------------------------------------------------
// Login throttling — durable, because a process restart must not clear it
// ---------------------------------------------------------------------------

const MAX_FAILURES = 8;
const LOCKOUT_WINDOW = '15 minutes';

/**
 * How many failures this email or IP has accumulated in the window.
 * Counted over both, because credential stuffing rotates emails from one IP and
 * rotates IPs against one email; either pattern is a signal.
 */
export async function recentFailures(email, ipHash) {
  const n = await scalar(
    `select count(*)::int from login_attempts
      where succeeded = false
        and created_at > now() - interval '${LOCKOUT_WINDOW}'
        and (email = $1 or ($2::text is not null and ip_hash = $2))`,
    [String(email).toLowerCase(), ipHash ?? null],
  );
  return n ?? 0;
}

export const isLockedOut = (failures) => failures >= MAX_FAILURES;

export async function recordAttempt(email, succeeded, ipHash) {
  await query(
    `insert into login_attempts (email, succeeded, ip_hash) values ($1, $2, $3)`,
    [String(email).toLowerCase(), succeeded, ipHash ?? null],
  );
  // A successful login clears the slate for that email, so a user who fat-fingers
  // eight times and then gets it right is not locked out on their next attempt.
  if (succeeded) {
    await query(
      `delete from login_attempts where email = $1 and succeeded = false`,
      [String(email).toLowerCase()],
    );
  }
}

export const hashIp = (ip) =>
  ip ? crypto.createHash('sha256').update(String(ip)).digest('hex').slice(0, 32) : null;

// ---------------------------------------------------------------------------
// Account lifecycle
// ---------------------------------------------------------------------------

export async function createAccount({ email, password, displayName }) {
  const normalized = String(email).trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalized)) {
    throw Object.assign(new Error('that does not look like an email address'), { status: 400 });
  }
  const passwordHash = hashPassword(password);

  return withTransaction(async (client) => {
    const existing = await client.query(
      'select id, password_hash from profiles where email = $1',
      [normalized],
    );
    if (existing.rowCount && existing.rows[0].password_hash) {
      throw Object.assign(new Error('an account with that email already exists'), { status: 409 });
    }
    if (existing.rowCount) {
      // A profile created earlier (by ?as=, in the pre-auth era) has no password.
      // Claiming it rather than creating a second row keeps existing channels
      // attached to the account that owns them.
      const { rows } = await client.query(
        `update profiles set password_hash = $2, display_name = coalesce(display_name, $3)
          where id = $1 returning *`,
        [existing.rows[0].id, passwordHash, displayName || normalized.split('@')[0]],
      );
      return rows[0];
    }
    const { rows } = await client.query(
      `insert into profiles (email, display_name, password_hash) values ($1, $2, $3) returning *`,
      [normalized, displayName || normalized.split('@')[0], passwordHash],
    );
    return rows[0];
  });
}

/** Set a password without checking the old one. Seed and admin-reset only. */
export async function setPassword(userId, password) {
  await query('update profiles set password_hash = $2 where id = $1', [userId, hashPassword(password)]);
}

export async function changePassword(userId, currentPassword, newPassword) {
  const user = await one('select * from profiles where id = $1', [userId]);
  if (!user) throw Object.assign(new Error('no such user'), { status: 404 });
  if (user.password_hash && !verifyPassword(currentPassword, user.password_hash)) {
    throw Object.assign(new Error('current password is incorrect'), { status: 403 });
  }
  await query('update profiles set password_hash = $2 where id = $1', [
    userId,
    hashPassword(newPassword),
  ]);
  // Every other session dies. Changing a password is what you do when you think
  // somebody else has your account.
  return revokeAllSessions(userId);
}
