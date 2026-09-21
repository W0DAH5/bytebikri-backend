import crypto from 'node:crypto';

/**
 * Shared crypto helpers for provider adapters.
 *
 * Deliberately its own module with no imports from index.js: adapters need
 * these, and index.js needs the adapters. Putting them in index.js would make
 * every adapter import a module that imports it back. ESM tolerates that cycle
 * today only because the adapters don't call these at module-evaluation time —
 * which is a property that would break silently the first time someone added a
 * module-level constant computed with `hmac`. This module breaks the cycle.
 */

/** Length-safe constant-time compare. timingSafeEqual throws on length mismatch. */
export function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length === 0 || ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

export const hmac = (algo, secret, data) =>
  crypto.createHmac(algo, secret).update(data, 'utf8').digest('hex');

export const md5 = (data) => crypto.createHash('md5').update(data, 'utf8').digest('hex');

export const sha256 = (data) => crypto.createHash('sha256').update(data, 'utf8').digest('hex');
