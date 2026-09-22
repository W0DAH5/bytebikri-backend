// ============================================================================
//  Emailed links — one implementation, two flows
// ============================================================================
//  A password reset link and an address-confirmation link are the same object:
//  a random token that proves control of an inbox, stored only as a hash, usable
//  once, valid for a stated window, and superseded by the next one. This file is
//  that object, and both flows call it. Writing a second copy for verification is
//  how the two drift apart — one gets the fix for the resend race, the other does
//  not, and the difference shows up as a support message nobody can reproduce.
//
//  Four rules, each of which came from something that goes wrong without it:
//
//  1. **Only the hash is stored.** A leaked dump must not contain a working link.
//
//  2. **One live link per (user, kind).** Asking again retires the previous one,
//     so a forwarded or stale email stops working. Per KIND, not per user: a
//     pending confirmation must not silently cancel the password reset somebody
//     is waiting for.
//
//  3. **Spending is a single guarded UPDATE**, so two simultaneous clicks cannot
//     both succeed and a rejected attempt does not consume the link.
//
//  4. **A resend inside the window does not mint a new token.** This one is
//     subtle and it was a real bug in a real product: if every send rotates the
//     token, then a person who clicks "resend" while the first email is still in
//     flight invalidates the link that is about to land in their inbox. They
//     click it, it fails, they resend again — a loop that sustains itself for as
//     long as they keep trying. So a resend inside `RESEND_WINDOW_MINUTES` sends
//     nothing new and says the last link is the one that works.
//
//     The exception is the one the mail log makes detectable: if the last send
//     FAILED to deliver, there is no link in anyone's inbox to protect, so the
//     resend mints a fresh token immediately rather than stonewalling somebody
//     whose only problem was our provider.
// ============================================================================

import crypto from 'node:crypto';
import { one, query } from './db.js';

/** How long a link is valid. Password resets are shorter: it is a takeover credential. */
export const TTL_MINUTES = { password_reset: 60, email_verify: 48 * 60 };

/**
 * How recently a link of this kind must have been sent for a resend to be
 * answered with "the one you have is the one that works" rather than a new email.
 *
 * Ten minutes: long enough to cover a slow inbox and an impatient second click,
 * short enough that somebody whose mail never arrives is not stuck for the day.
 */
export const RESEND_WINDOW_MINUTES = 10;

const hashToken = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');
const hashIp = (ip) => (ip ? crypto.createHash('sha256').update(String(ip)).digest('hex').slice(0, 32) : null);

const newToken = () => crypto.randomBytes(32).toString('base64url');

/**
 * Mint a link token for a profile.
 *
 * Returns `{ token, expiresAt, replaced }`. `replaced` counts live tokens of the
 * same kind that this one retired — normally 0 or 1, and more only if something
 * else already went wrong.
 */
export async function issue({ userId, kind, ip = null, userAgent = null, now = new Date() }) {
  const minutes = TTL_MINUTES[kind];
  if (!minutes) throw new Error(`unknown link kind: ${kind}`);
  const token = newToken();
  const expires = new Date(now.getTime() + minutes * 60_000);

  const removed = await query(
    'delete from email_tokens where user_id = $1 and kind = $2 and used_at is null',
    [userId, kind],
  );
  await query(
    `insert into email_tokens (user_id, kind, token_hash, expires_at, ip_hash, user_agent)
     values ($1, $2, $3, $4, $5, $6)`,
    [userId, kind, hashToken(token), expires, hashIp(ip), String(userAgent || '').slice(0, 300)],
  );
  return { token, expiresAt: expires, replaced: removed.rowCount, ttlMinutes: minutes };
}

/** The live token of a kind, without its value — which is the point of the hash. */
export async function live({ userId, kind }) {
  const row = await one(
    `select id, created_at, expires_at from email_tokens
      where user_id = $1 and kind = $2 and used_at is null and expires_at > now()
      order by created_at desc limit 1`,
    [userId, kind],
  );
  return row ?? null;
}

/**
 * Should this request send an email, or answer with the link already out there?
 *
 * The answer depends on something only the mail log knows: whether that earlier
 * send actually delivered. `delivered = true` means a link is sitting in an
 * inbox and must keep working; a recorded `error` means the message never left,
 * so the honest thing is to try again immediately rather than tell somebody to
 * check an inbox that has nothing in it.
 */
export async function resendDecision({ userId, kind, now = new Date(), windowMinutes = RESEND_WINDOW_MINUTES }) {
  const current = await live({ userId, kind });
  if (!current) return { action: 'issue', reason: 'no live link' };

  const ageMinutes = (now.getTime() - new Date(current.created_at).getTime()) / 60_000;
  if (ageMinutes >= windowMinutes) return { action: 'issue', reason: 'the last link is old enough to replace' };

  const last = await one(
    `select delivered, error from outbound_emails
      where user_id = $1 and kind = $2
      order by created_at desc limit 1`,
    [userId, kind === 'password_reset' ? 'password_reset' : 'email_verify'],
  );
  if (last && last.delivered === false && last.error) {
    return { action: 'issue', reason: 'the last message failed to deliver, so there is nothing to protect', lastSentAt: current.created_at };
  }

  return { action: 'already-sent', lastSentAt: current.created_at, expiresAt: current.expires_at, ageMinutes: Math.round(ageMinutes) };
}

/**
 * Look up a link without spending it, so a GET can render a page without burning
 * the token — a mail scanner that follows every link in an inbox must not consume
 * the one the person is about to click.
 */
export async function inspect({ token, kind, now = new Date() }) {
  const raw = String(token || '');
  if (!raw || raw.length > 200) return { valid: false, reason: 'missing' };
  const row = await one(
    `select t.*, p.email, p.display_name from email_tokens t
       join profiles p on p.id = t.user_id
      where t.token_hash = $1 and t.kind = $2`,
    [hashToken(raw), kind],
  );
  if (!row) return { valid: false, reason: 'unknown' };
  if (row.used_at) return { valid: false, reason: 'used' };
  if (new Date(row.expires_at) <= now) return { valid: false, reason: 'expired' };
  return {
    valid: true,
    row,
    user: { id: row.user_id, email: row.email, display_name: row.display_name },
  };
}

/** Spend a link. The UPDATE is the validation; returning no row means it is dead. */
export async function spend({ token, kind, now = new Date() }) {
  const raw = String(token || '');
  if (!raw || raw.length > 200) return { ok: false };
  const res = await query(
    `update email_tokens set used_at = now()
      where token_hash = $1 and kind = $2 and used_at is null and expires_at > $3
      returning user_id`,
    [hashToken(raw), kind, now],
  );
  if (!res.rowCount) return { ok: false };
  return { ok: true, userId: res.rows[0].user_id };
}

/**
 * Sent / confirmed / expired, per kind — the numbers the sources say to look at
 * before changing any verification policy, because a policy change made without
 * them is a guess about why people are not confirming.
 */
export async function linkActivity({ userId = null, days = 30 } = {}) {
  const scope = userId ? 'and user_id = $2' : '';
  const params = userId ? [String(days), userId] : [String(days)];
  return one(
    `select kind,
            count(*)::int as sent,
            count(*) filter (where used_at is not null)::int as used,
            count(*) filter (where used_at is null and expires_at <= now())::int as expired
       from email_tokens
      where created_at > now() - ($1 || ' days')::interval ${scope}
      group by kind`,
    params,
  );
}
