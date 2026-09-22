// ============================================================================
//  Outbound email
// ============================================================================
//  The platform had no way to send a message. That was fine while every message
//  was optional; it stops being fine the moment an account can be locked out
//  forever, because a reset link IS the feature.
//
//  Two ideas shape this file.
//
//  1. **A message is a row.** Every send writes to `outbound_emails` before it
//     tries to be delivered, including in production. Two reasons, and the
//     second is the one that matters: an operator asked "did the link go out?"
//     can answer it, and a test can assert that the email contained a working
//     link rather than asserting that a function was called.
//
//  2. **The driver is configuration, and in production a missing one is fatal.**
//     Same rule as the signing secrets: a deployment that quietly prints reset
//     links to a log looks healthy and locks out every user who forgets a
//     password. In development the console driver is deliberately chatty — it
//     prints the link — because a contributor resetting a demo password should
//     not need an account with a mail provider.
//
//  Drivers are small on purpose. `resend` and `smtp` cover the two shapes that
//  matter (a JSON API and a relay); anything else can be added as a third case
//  without touching a caller, because callers only ever call `send()`.
// ============================================================================

import { query } from './db.js';
// Pure config rules, from the module that owns "what configuration is acceptable".
// They live there rather than here because this file queries, and config checks run
// before a database exists — importing them from here would make `checkConfig`
// need a connection to answer a question about environment variables.
import { emailDriver, emailFrom } from './config.js';

/**
 * Send one message.
 *
 * Order matters: the row is written FIRST, then delivery is attempted, then the
 * row is updated with the outcome. If the provider throws, the record of what we
 * tried to say survives — and the error is stored on it. A send that fails
 * silently is the failure mode this ordering prevents.
 *
 * Never throws. Mail is not allowed to break the action that triggered it: a
 * reset request whose email bounced must still not tell the requester whether the
 * address existed, so the route cannot branch on this result.
 */
export async function send({ to, subject, text, kind, userId = null, env = process.env }) {
  const { driver, ok, why } = emailDriver(env);
  const from = emailFrom(env);

  const logged = await query(
    `insert into outbound_emails (kind, to_email, subject, body_text, driver, user_id)
     values ($1, $2, $3, $4, $5, $6)
     returning id`,
    [String(kind).slice(0, 60), String(to).toLowerCase(), String(subject).slice(0, 200),
      String(text), driver, userId],
  ).catch(() => null);
  const id = logged?.rows?.[0]?.id ?? null;

  // The row is written before any of this, including before the "cannot send at
  // all" cases. A message that could not be sent is exactly the message somebody
  // needs to find later, and it cannot be found if it was never recorded.
  const record = async (message) => {
    if (id) await query('update outbound_emails set error = $2 where id = $1', [id, message.slice(0, 300)]).catch(() => {});
    return { ok: false, driver, id, delivered: false, why: message };
  };

  if (!ok) return record(why);
  if (driver === 'console') {
    // Deliberately chatty. The whole point of the development driver is that
    // whoever just clicked "forgot password" can copy the link out of the log
    // without an account at a mail provider. config.js refuses this driver in
    // production, so this branch is only reachable in development and test.
    //
    // Not, however, under the test runner. A test child writes its results to the
    // same stdout the runner frames its own messages on, and a suite that prints
    // a message body per send produced this every few runs: the runner failed an
    // entire FILE with "Unable to deserialize cloned data due to invalid or
    // unsupported version", intermittently and with no failing assertion to point
    // at. The message is still written and still recorded — the row, the id and
    // the return value are untouched, so nothing a test asserts on moves. Only the
    // echo of a mail body nobody is reading goes away.
    const printing = !process.env.NODE_TEST_CONTEXT;
    if (printing) {
      console.log('\n── email (console driver, not delivered) ─────────────────────────');
      console.log(`   to      ${to}`);
      console.log(`   subject ${subject}`);
      console.log(String(text).split('\n').map((l) => `   │ ${l}`).join('\n'));
      console.log('─────────────────────────────────────────────────────────────────\n');
    }
    return {
      ok: true, driver, id, delivered: false,
      why: printing
        ? 'console driver: written and printed, not delivered'
        : 'console driver: written to the log, not delivered',
    };
  }
  if (!from) return record('EMAIL_FROM is not set, so there is no address to send from');

  try {
    if (driver === 'resend') {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
        body: JSON.stringify({ from, to: [to], subject, text }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`resend ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
    } else {
      // Imported lazily so a deployment using the API driver does not need the
      // package installed, and so a missing one is a recorded delivery failure
      // rather than an import-time crash on a path nobody exercised yet.
      const nodemailer = await import('nodemailer').catch(() => null);
      if (!nodemailer) throw new Error('EMAIL_DRIVER=smtp needs the nodemailer package installed');
      await nodemailer.default.createTransport(env.SMTP_URL).sendMail({ from, to, subject, text });
    }
    if (id) await query('update outbound_emails set delivered = true where id = $1', [id]).catch(() => {});
    return { ok: true, driver, id, delivered: true, why: null };
  } catch (err) {
    // Logged and recorded, never thrown: mail is not allowed to break the action
    // that triggered it. A reset request whose email bounces must still answer
    // identically to one whose email went out, or the route becomes an oracle.
    const message = String(err.message || err);
    console.error(`[email] ${driver} delivery failed: ${message}`);
    return record(message);
  }
}
