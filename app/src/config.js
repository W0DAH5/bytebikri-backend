/**
 * Configuration, and the assertions that go with it.
 *
 * Every secret in this file used to have a hardcoded fallback, so the app would
 * start happily in production with `dev-postback-secret-change-me` as its signing
 * key. That is the worst version of a default: it does not fail, it makes the
 * deployment look healthy while the key is a string in a public repository.
 *
 * The rule here is simple. In development, a missing secret gets a loud warning
 * and a working value, because a contributor cloning the repo should not have to
 * generate four random strings to see the site. In production, a missing secret
 * is fatal, the process refuses to start, and the message names every variable
 * that is missing at once — an operator setting up a deploy should not discover
 * them one restart at a time.
 */

import crypto from 'node:crypto';

const isProd = () => process.env.NODE_ENV === 'production';
const isTest = () => process.env.NODE_ENV === 'test';

/** Values that exist only so a local checkout runs. Never valid in production. */
const DEV_DEFAULTS = {
  SESSION_SECRET: 'dev-session-secret-change-me',
  ACCESS_TOKEN_SECRET: 'dev-access-secret-change-me',
  AD_POSTBACK_SECRET: 'dev-postback-secret-change-me',
};

export function readSecret(name) {
  const value = process.env[name];
  if (value && value.length >= 16 && !Object.values(DEV_DEFAULTS).includes(value)) return value;
  if (isProd()) {
    // Unreachable when assertProductionConfig has run — which is the point.
    throw new Error(`${name} is not set. Refusing to sign anything with a default.`);
  }
  return DEV_DEFAULTS[name] || `dev-${name.toLowerCase()}-not-secret`;
}

/** Random value, for `npm run secrets`. */
export function generateSecret() {
  // 32 bytes, base64url: 256 bits of entropy and safe in a shell, a URL and a
  // .env file without quoting.
  return crypto.randomBytes(32).toString('base64url');
}

/**
 * Everything production needs, checked before the server listens.
 *
 * Returns `{ ok, errors, warnings }` rather than throwing, so `npm run check:env`
 * can print a readable report and the boot path can print the same thing before
 * exiting. A thrown error at import time produces a stack trace, which tells an
 * operator nothing about which variable to set.
 */
export function checkConfig(env = process.env) {
  const errors = [];
  const warnings = [];
  const prod = env.NODE_ENV === 'production';

  const secret = (name, { min = 32 } = {}) => {
    const value = env[name];
    if (!value) return errors.push({ name, why: 'missing', detail: 'Generate one with: npm run secrets' });
    if (Object.values(DEV_DEFAULTS).includes(value)) {
      return errors.push({ name, why: 'still the development default',
        detail: 'This value is in the repository. Anyone can sign a session or a postback with it.' });
    }
    if (value.length < min) {
      return errors.push({ name, why: `too short (${value.length} characters)`,
        detail: `At least ${min} are needed; this is what session and download tokens are signed with.` });
    }
    return undefined;
  };

  if (prod) {
    secret('SESSION_SECRET');
    secret('ACCESS_TOKEN_SECRET');
  } else {
    for (const name of Object.keys(DEV_DEFAULTS)) {
      if (!env[name]) warnings.push({ name, why: 'using the development default' });
    }
  }

  // Required in production, where a silent localhost fallback would mean
  // connecting to the wrong database. In development it is optional, because
  // src/db.js defaults to the local Postgres from `npm run db:start` and a
  // contributor should not have to set a variable to run the app they just
  // cloned. The two files must agree on this, which is why the rule is
  // stated in both places rather than inferred in one.
  if (!env.DATABASE_URL && prod) {
    errors.push({ name: 'DATABASE_URL', why: 'missing',
      detail: 'Postgres connection string, e.g. postgres://user:pass@host:5432/bytebikri' });
  } else if (!env.DATABASE_URL) {
    warnings.push({ name: 'DATABASE_URL', why: 'not set — using the local development database' });
  } else if (prod && /localhost|127\.0\.0\.1/.test(env.DATABASE_URL)) {
    // Not fatal — a sidecar database on the same host is legitimate — but it is
    // almost always a copy-paste from a laptop that will lose every account.
    warnings.push({ name: 'DATABASE_URL', why: 'points at localhost in production' });
  }

  if (prod) {
    if (!env.PUBLIC_BASE_URL) {
      errors.push({ name: 'PUBLIC_BASE_URL', why: 'missing',
        detail: 'The public https origin. Ad postback URLs are built from it and sent to networks.' });
    } else if (!/^https:\/\//.test(env.PUBLIC_BASE_URL)) {
      errors.push({ name: 'PUBLIC_BASE_URL', why: 'is not https',
        detail: 'A provider will not send a signed callback to a plain http address, and neither should you.' });
    }
    if (!env.OPERATOR_EMAIL) {
      warnings.push({ name: 'OPERATOR_EMAIL', why: 'missing',
        detail: 'Two things need it: the privacy notice publishes a contact address, and every boot promotes this account to operator so payments can be matched at /admin/billing.' });
    }
    if (env.DEMO_PASSWORD) {
      errors.push({ name: 'DEMO_PASSWORD', why: 'set in production',
        detail: 'This seeds a publicly known login. Unset it; demo accounts are not created in production anyway.' });
    }
    if (env.AD_POSTBACK_SECRET && env.AD_POSTBACK_SECRET === DEV_DEFAULTS.AD_POSTBACK_SECRET) {
      errors.push({ name: 'AD_POSTBACK_SECRET', why: 'still the development default',
        detail: 'It signs the sandbox network. The sandbox is disabled in production, but rotate it anyway.' });
    }

    // Email, checked as a whole. The rule is not "EMAIL_DRIVER must be set" but
    // "a message must be able to reach a person": a console driver in production
    // prints reset links to a log and delivers nothing, and no driver at all means
    // every forgotten password is an account nobody can get back into. Both are
    // fatal here rather than discovered the first time somebody is locked out,
    // which is the worst possible moment — nobody can report it, because the
    // person who would report it cannot sign in.
    const mail = emailDriver(env);
    if (!mail.ok) {
      errors.push({ name: 'EMAIL_DRIVER', why: mail.driver === 'none' ? 'missing' : `${mail.driver} cannot send`,
        detail: `${mail.why}. Set EMAIL_DRIVER to resend with RESEND_API_KEY, or smtp with SMTP_URL.` });
    }
    if (!env.EMAIL_FROM) {
      warnings.push({ name: 'EMAIL_FROM', why: 'missing',
        detail: 'Reset links will be sent from a default address rather than your own, which lands in spam more often.' });
    }
  } else if (!env.EMAIL_DRIVER) {
    // Development stays quiet on purpose: the console driver prints links to the
    // log, which is the shortest path from "I forgot the demo password" to being
    // back in. A warning here would train contributors to ignore warnings.
    warnings.push({ name: 'EMAIL_DRIVER', why: 'not set — printing messages to the log instead of sending them' });
  }

  return { ok: errors.length === 0, errors, warnings, production: prod };
}

/** A printable report. Used by the boot path and by `npm run check:env`. */
export function formatConfigReport({ errors, warnings }) {
  const lines = [];
  if (errors.length) {
    lines.push('', '  The server will not start. Fix the following:', '');
    for (const e of errors) lines.push(`    ${e.name} — ${e.why}`, `      ${e.detail}`);
  }
  if (warnings.length) {
    lines.push('', '  Warnings (the server will start):', '');
    for (const w of warnings) lines.push(`    ${w.name} — ${w.why}`);
  }
  return lines.join('\n');
}

/**
 * Which driver, and whether that is acceptable.
 *
 * Returns `{ driver, ok, why }`. `ok: false` in production means the process
 * should refuse to start — asserted in `checkConfig` — rather than discovering it
 * the first time somebody forgets a password, which is the worst possible moment
 * to learn that mail does not work.
 */
export const EMAIL_DRIVERS = ['console', 'resend', 'smtp'];

export function emailDriver(env = process.env) {
  const configured = String(env.EMAIL_DRIVER || '').trim().toLowerCase();
  if (configured) {
    // A typo in a driver name must be a configuration error, not a runtime
    // surprise: `EMAIL_DRIVER=resnd` would otherwise pass every check, start the
    // server, and fail inside a fire-and-forget send where nobody is looking.
    if (!EMAIL_DRIVERS.includes(configured)) {
      return { driver: configured, ok: false, why: `"${configured}" is not a driver — known drivers are ${EMAIL_DRIVERS.join(', ')}` };
    }
    if (configured === 'console' && env.NODE_ENV === 'production') {
      return { driver: 'console', ok: false, why: 'EMAIL_DRIVER=console in production would print reset links to a log and deliver nothing' };
    }
    if (configured === 'resend' && !env.RESEND_API_KEY) {
      return { driver: 'resend', ok: false, why: 'RESEND_API_KEY is not set' };
    }
    if (configured === 'smtp' && !env.SMTP_URL) {
      return { driver: 'smtp', ok: false, why: 'SMTP_URL is not set' };
    }
    return { driver: configured, ok: true, why: null };
  }
  return env.NODE_ENV === 'production'
    ? { driver: 'none', ok: false, why: 'no EMAIL_DRIVER is set, so a password reset link could never be delivered' }
    : { driver: 'console', ok: true, why: null };
}

/** The address messages come from. Plain, and required in production. */
export function emailFrom(env = process.env) {
  // Reads the *passed* env, not this process's NODE_ENV: otherwise checkConfig(someEnv)
  // and the running server could disagree about whether a from-address exists.
  return env.EMAIL_FROM || (env.NODE_ENV === 'production' ? null : 'ByteBikri <no-reply@bytebikri.local>');
}

/**
 * Called at boot. In production an invalid configuration stops the process
 * before the port opens: a server that is listening but cannot sign a session
 * correctly is worse than one that never started.
 */
export function assertProductionConfig(env = process.env, { quiet = false } = {}) {
  const report = checkConfig(env);
  if (env.NODE_ENV !== 'production') return report;
  if (!report.ok) {
    console.error(formatConfigReport(report));
    console.error('\n  Refusing to start in production with an incomplete configuration.\n');
    process.exit(1);
  }
  // `quiet` when the entry point has already printed this. Saying it twice does
  // not make it truer, and it trains people to skim the output.
  if (report.warnings.length && !quiet) console.warn(formatConfigReport(report));
  return report;
}

export { isProd };
