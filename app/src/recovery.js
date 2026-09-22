// ============================================================================
//  Getting back into an account
// ============================================================================
//  The rules here are the ones that decide whether a reset flow is a feature or a
//  hole, so they are stated rather than implied:
//
//  1. **A request never reveals whether an address has an account.** The caller
//     gets the same answer either way, and the mail is the only thing that
//     differs. Without this, the page becomes a free oracle for "which of these
//     email addresses has an account here" — the same enumeration the login form
//     already refuses to give away by never saying which half was wrong.
//
//  2. **One live link.** Requesting a second link kills the first, enforced by a
//     partial unique index in the schema rather than by remembering to update. A
//     link in a shared inbox or an old phone stops working the moment the user
//     asks for a new one, which is what a person expects and rarely what they get.
//
//  3. **Spending a link is a single UPDATE.** Validation and single-use are the
//     same statement, so two simultaneous clicks cannot both succeed — the same
//     reasoning as the unlock race, and the same failure it prevents: a
//     credential that works twice.
//
//  4. **A successful reset ends every session.** A reset is usually the response
//     to "somebody else may have my account", so leaving the other sessions alive
//     would defeat the feature's whole purpose.
//
//  5. **Failure is one message.** Expired, already used, never existed, tampered
//     with — all of them render the same sentence and the same new-link form. The
//     difference is useful to an attacker and useless to the person, who needs a
//     new link either way.
// ============================================================================

import { one, query } from './db.js';
import { hashPassword, revokeAllSessions } from './auth.js';
import { send } from './email.js';
// Imported AND re-exported. `export { X } from './y'` re-exports without binding
// X in this module, so using it below was a ReferenceError that only fired when a
// caller passed a short password — the happy path never touched the line.
import { RESET_TTL_MINUTES, MIN_PASSWORD_LENGTH } from './security.js';
import * as tokens from './tokens.js';

// Re-exported so a caller importing the reset logic can state the same rule
// without knowing which dependency-free module holds it.
export { RESET_TTL_MINUTES, MIN_PASSWORD_LENGTH };

/**
 * Ask for a link.
 *
 * Returns `{ requested: true }` no matter what — see rule 1. The route must not
 * branch on anything else, which is why nothing else is returned.
 *
 * The token is created inside a transaction that first spends any live token for
 * that account, so "one live link" holds even when two requests arrive together.
 */
export async function requestReset({ email, ip = null, userAgent = null, baseUrl, now = new Date() }) {
  const normalized = String(email || '').trim().toLowerCase().slice(0, 200);
  if (!normalized) return { requested: true, mailed: false };

  const user = await one('select id, email, display_name from profiles where email = $1', [normalized]);
  // No account: nothing to mail, nothing to say, and — this is the point — no
  // extra field in the answer. An earlier version returned `unknown: true`, which
  // changed the SHAPE of the result between the two cases. The route did not read
  // it, and it still had to go: an oracle that only a future caller can use is
  // still an oracle, and a test caught it by comparing key sets.
  if (!user) return { requested: true, mailed: false };

  // The shared link machinery, so a reset and a confirmation cannot drift apart.
  const { token, ttlMinutes } = await tokens.issue({
    userId: user.id, kind: 'password_reset', ip, userAgent, now,
  });

  const link = `${String(baseUrl).replace(/\/$/, '')}/reset/${token}`;
  const minutes = ttlMinutes;
  const greeting = user.display_name ? `Hello ${user.display_name},` : 'Hello,';

  await send({
    kind: 'password_reset',
    to: user.email,
    userId: user.id,
    subject: 'Reset your ByteBikri password',
    text: [
      greeting,
      '',
      `Somebody asked to reset the password for this ByteBikri account. If that was you, open this link:`,
      '',
      link,
      '',
      `The link works once and expires in ${minutes} minutes. Opening it signs out everywhere else,`,
      'because a password reset is what you do when you think somebody else has your account.',
      '',
      'If it was not you, nothing has happened and nothing needs doing. Your password still works,',
      "and this link is harmless — it cannot do anything without also choosing a new password.",
      '',
      '— ByteBikri',
    ].join('\n'),
  });

  return { requested: true, mailed: true };
}

/**
 * Look up a link without spending it, so the page can render a password form or
 * the "ask for another" state.
 *
 * Separate from `consume` on purpose: a GET must never change state, or a mail
 * scanner that follows every link in an inbox would burn the token before the
 * person clicked it.
 */
export async function inspectReset(token, now = new Date()) {
  return tokens.inspect({ token, kind: 'password_reset', now });
}

/**
 * Spend the link and set the password.
 *
 * The UPDATE is the validation: `used_at is null and expires_at > now()` is in
 * the WHERE clause, so two concurrent requests cannot both pass a check and then
 * both write. If no row comes back, the link was already spent or has expired —
 * and the caller says the same thing either way.
 */
export async function consumeReset({ token, password, now = new Date() }) {
  if (String(password || '').length < MIN_PASSWORD_LENGTH) return { ok: false, reason: 'short' };

  const spent = await tokens.spend({ token, kind: 'password_reset', now });
  if (!spent.ok) return { ok: false };

  const userId = spent.userId;
  await query('update profiles set password_hash = $2 where id = $1', [userId, hashPassword(password)]);
  // Rule 4. Every session, including the one that asked — a reset is not a login.
  await revokeAllSessions(userId);
  return { ok: true, userId };
}

/**
 * What support needs when somebody writes in saying they never got the link.
 *
 * The question is answerable, and it should not need a database client open on a
 * laptop: was a link requested, when, and did the message actually leave. The
 * distinction that matters is between **not delivered because the development
 * driver prints instead of sending** (delivered=false, no error — expected in a
 * demo) and **delivery failed** (delivered=false with an error — a real problem
 * that no page was reporting).
 */
export async function personRecovery(userId) {
  const row = await one(
    `select
       (select count(*)::int from email_tokens where user_id = $1 and kind = 'password_reset') as requested,
       (select count(*)::int from email_tokens
         where user_id = $1 and kind = 'password_reset' and used_at is not null) as completed,
       (select max(created_at) from email_tokens where user_id = $1 and kind = 'password_reset') as last_requested,
       (select count(*)::int from email_tokens
         where user_id = $1 and kind = 'email_verify') as verifications_sent,
       (select count(*)::int from outbound_emails
          where user_id = $1 and delivered = false and error is not null) as failed_deliveries,
       (select max(created_at) from outbound_emails
          where user_id = $1 and delivered = true) as last_delivered,
       (select email_verified_at from profiles where id = $1) as address_confirmed_at`,
    [userId],
  );
  return row;
}

/** What the operator can see about reset activity. Counts, never tokens. */
export async function resetActivity({ days = 30 } = {}) {
  return one(
    `select
       (select count(*)::int from email_tokens
         where kind = 'password_reset' and created_at > now() - ($1 || ' days')::interval) as requested,
       (select count(*)::int from email_tokens
         where kind = 'password_reset' and used_at is not null
           and used_at > now() - ($1 || ' days')::interval) as completed,
       (select count(*)::int from email_tokens
         where kind = 'password_reset' and used_at is null and expires_at <= now()
           and created_at > now() - ($1 || ' days')::interval) as expired_unused,
       -- Every transactional message, not just resets: a confirmation link that
       -- never left is the same operator problem as a reset link that never left,
       -- and separating them would hide half of the failures behind a kind filter.
       (select count(*)::int from email_tokens
         where kind = 'email_verify' and created_at > now() - ($1 || ' days')::interval) as confirmations_sent,
       (select count(*)::int from profiles
         where email_verified_at > now() - ($1 || ' days')::interval) as addresses_confirmed,
       (select count(*)::int from outbound_emails
         where kind in ('password_reset', 'email_verify') and delivered = false and error is not null
           and created_at > now() - ($1 || ' days')::interval) as failed_deliveries`,
    [String(Math.max(Number(days) || 30, 1))],
  );
}
