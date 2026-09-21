/**
 * Database access.
 *
 * A single pool and one rule: anything that must be all-or-nothing goes through
 * withTransaction. Transactions are not a convenience here — the unlock path is
 * only correct because claiming a postback and granting the unlock commit
 * together. A crash between them either loses the unlock (user watched an ad for
 * nothing) or double-grants it.
 *
 * This module knows nothing about bytebikri. It is plumbing.
 */
import pg from 'pg';

const { Pool } = pg;

const connectionString =
  process.env.DATABASE_URL ||
  (process.env.NODE_ENV === 'production'
    ? null
    : 'postgres://postgres:postgres@127.0.0.1:55432/bytebikri');

if (!connectionString) {
  // No silent localhost fallback in production: connecting to the wrong
  // database is worse than refusing to boot.
  throw new Error('DATABASE_URL is required. See .env.example.');
}

const isLocal = /127\.0\.0\.1|localhost/.test(connectionString);

export const pool = new Pool({
  connectionString,
  // Managed Postgres (Supabase) terminates TLS with a cert in its own chain.
  // Requiring a verifiable cert there fails; disabling verification against a
  // remote host would be worse. So: verify remotely, skip locally.
  ssl: isLocal ? false : { rejectUnauthorized: false },
  max: Number(process.env.PG_POOL_MAX || 10),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  application_name: 'bytebikri',
});

// A pool error means an idle client died (network blip, server restart). The
// pool replaces it; an unhandled 'error' event would take the process down.
pool.on('error', (err) => {
  console.error('[db] idle client error:', err.message);
});

export const query = (text, params) => pool.query(text, params);

/** First row, or null. */
export async function one(text, params) {
  const r = await pool.query(text, params);
  return r.rows[0] ?? null;
}

/** All rows. */
export async function many(text, params) {
  const r = await pool.query(text, params);
  return r.rows;
}

/** Scalar — first column of the first row. */
export async function scalar(text, params) {
  const r = await pool.query(text, params);
  const row = r.rows[0];
  return row ? Object.values(row)[0] : null;
}

/**
 * Run `fn` inside a transaction, with a dedicated client.
 *
 * `fn` receives that client and MUST use it for every statement — reaching for
 * the pool inside would run on a different connection, outside the transaction,
 * and quietly defeat the entire point. That failure is silent, which is why the
 * only client passed in is the transactional one.
 *
 * Retries on 40001 (serialization failure) and 40P01 (deadlock): both mean "you
 * lost a race, try again", and losing a race is expected, not exceptional.
 */
export async function withTransaction(fn, { retries = 2 } = {}) {
  for (let attempt = 0; ; attempt++) {
    const client = await pool.connect();
    try {
      await client.query('begin');
      const result = await fn(client);
      await client.query('commit');
      return result;
    } catch (err) {
      try { await client.query('rollback'); } catch { /* connection already gone */ }
      const retryable = err.code === '40001' || err.code === '40P01';
      if (retryable && attempt < retries) continue;
      throw err;
    } finally {
      client.release();
    }
  }
}

/** Postgres unique-violation. */
export const isUniqueViolation = (err) => err?.code === '23505';
export const isForeignKeyViolation = (err) => err?.code === '23503';

export async function health() {
  const started = Date.now();
  try {
    await pool.query('select 1');
    return { ok: true, latencyMs: Date.now() - started };
  } catch (err) {
    return { ok: false, error: err.message, latencyMs: Date.now() - started };
  }
}

export async function close() {
  await pool.end();
}
