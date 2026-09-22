// ============================================================================
//  Confirming an address
// ============================================================================
//  Anyone can type any address into a sign-up form. Until somebody proves they
//  read mail at it, the platform does not know that an account's address belongs
//  to the person holding the account — and three things follow from that:
//
//   • A password reset link goes to an inbox we cannot vouch for. (The reset
//     still works; it is the account's own address, whoever owns it today.)
//   • A receipt, an invoice and any dispute go to the same place.
//   • An operator matching a bank transfer by hand has no reliable way to reach
//     the person whose transfer it is.
//
//  So this flow exists, and it is deliberately SOFT. It does not block sign-in,
//  publishing, unlocking or browsing. The research on the block/warn/accept
//  decision says the cost of blocking a legitimate person always exceeds the cost
//  of accepting one who needs cleanup later, and that a verifier must be advisory
//  rather than a single point of failure — which here is not theoretical, because
//  delivery genuinely can fail and the platform records when it does.
//
//  It blocks exactly one thing: **money in**. Submitting a plan-upgrade transfer
//  reference needs a confirmed address, because that is the moment a human on our
//  side has to be able to reach a human on theirs.
//
//  What it never does: sign anybody in. Following a confirmation link proves an
//  address, not a session — a shared computer where Bob is signed in must not
//  become Alice's session because Alice's email was open in another tab.
// ============================================================================

import { one, query } from './db.js';
import { send } from './email.js';
// The same audit writer every other action uses. `(action, meta, {actorId,
// subjectType, subjectId})` — see src/store.js.
import { store } from './store.js';
import * as tokens from './tokens.js';

/** 48 hours, per the expiry guidance for signup-style confirmations. */
export const VERIFY_TTL_MINUTES = tokens.TTL_MINUTES.email_verify;

const looksLikeEmail = (value) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(value || ''));

/**
 * Send (or refuse to re-send) a confirmation link.
 *
 * The refusal is the interesting branch. Inside the resend window the caller is
 * told the last link is the one that works, rather than being sent a new email —
 * because minting a new token retires the previous one, and the previous one is
 * the email that may be arriving in their inbox right now. That is a real loop:
 * resend, then click the first link, then fail, then resend again.
 *
 * The exception is the one the mail log makes knowable: if the last message was
 * recorded as FAILED, nobody has a link to protect, so a fresh one goes out
 * immediately.
 *
 * Never throws. A confirmation email that cannot be sent must not fail the
 * sign-up that triggered it — the account exists either way, and the person can
 * ask again from a page that will tell them what happened.
 */
export async function sendVerification({ user, baseUrl, ip = null, userAgent = null, now = new Date() }) {
  // Already confirmed: there is nothing to send, and sending anyway would be a
  // link that can only fail. The page says so instead.
  const already = await one(
    'select email_verified_at from profiles where id = $1', [user.id],
  );
  if (already?.email_verified_at) return { sent: false, reason: 'confirmed' };

  const decision = await tokens.resendDecision({ userId: user.id, kind: 'email_verify', now });
  if (decision.action === 'already-sent') {
    return {
      sent: false,
      reason: 'already-sent',
      lastSentAt: decision.lastSentAt,
      expiresAt: decision.expiresAt,
      ageMinutes: decision.ageMinutes,
    };
  }

  const { token, ttlMinutes } = await tokens.issue({
    userId: user.id, kind: 'email_verify', ip, userAgent, now,
  });
  const link = `${String(baseUrl).replace(/\/$/, '')}/verify/${token}`;
  const hours = Math.round(ttlMinutes / 60);
  const greeting = user.display_name ? `Hello ${user.display_name},` : 'Hello,';

  const result = await send({
    kind: 'email_verify',
    to: user.email,
    userId: user.id,
    subject: 'Confirm your email address',
    text: [
      greeting,
      '',
      `Somebody opened a ByteBikri account with ${user.email}. If that was you, confirm it by opening this link:`,
      '',
      link,
      '',
      `The link works once and expires in ${hours} hours. Confirming does not sign you in anywhere.`,
      '',
      'If it was not you, ignore this message: nothing happens without the link, and the account cannot',
      'be used to reach you.',
      '',
      '— ByteBikri',
    ].join('\n'),
  });

  return { sent: true, delivered: result.delivered, driver: result.driver, expiresAt: new Date(now.getTime() + ttlMinutes * 60_000) };
}

/**
 * Look at a link without spending it, so the GET that renders the button cannot
 * be what confirms an address: mail providers and security scanners fetch every
 * URL in a message, and a GET that spent the token would mark addresses confirmed
 * that no person ever opened — silently, and looking exactly like success.
 */
export async function inspectLink({ token, now = new Date() }) {
  return tokens.inspect({ token, kind: 'email_verify', now });
}

/**
 * Follow a link. Returns `{ ok, userId }` or `{ ok: false }` — the caller renders
 * one page for every kind of dead link, so no reason is needed at the call site.
 */
export async function confirm({ token, now = new Date() }) {
  const spent = await tokens.spend({ token, kind: 'email_verify', now });
  if (!spent.ok) return { ok: false };

  const { userId } = spent;
  // Confirming twice is not an error and not a rewrite: the FIRST confirmation is
  // the consent evidence, and moving the timestamp forward would quietly change
  // when the person agreed.
  const updated = await query(
    `update profiles set email_verified_at = coalesce(email_verified_at, $2) where id = $1
     returning email, email_verified_at, (email_verified_at = $2) as first_confirmation`,
    [userId, now],
  );
  const row = updated.rows[0];
  await store.audit('auth.email_verified', { first: row.first_confirmation, address: row.email },
    { actorId: userId, subjectType: 'profile', subjectId: userId });
  return { ok: true, userId, email: row.email, alreadyConfirmed: !row.first_confirmation };
}

/**
 * Move an account to a different address.
 *
 * Three things happen together and each has a reason:
 *
 *  1. the new address becomes the account's, unconfirmed — because it has not
 *     been confirmed yet, and saying otherwise would be the exact lie this whole
 *     flow exists to prevent;
 *  2. a link goes to the new address — so a typo cannot quietly move an account
 *     to a stranger's inbox and leave the owner locked out;
 *  3. a notice goes to the OLD address — the one channel we had that belonged to
 *     the previous owner. If the change was not theirs, that message is how they
 *     find out, and it is the only warning they will get.
 */
export async function changeAddress({ userId, newEmail, baseUrl, ip = null, userAgent = null, now = new Date() }) {
  const address = String(newEmail || '').trim().toLowerCase().slice(0, 200);
  if (!looksLikeEmail(address)) return { ok: false, reason: 'shape' };

  const person = await one('select id, email, display_name from profiles where id = $1', [userId]);
  if (!person) return { ok: false, reason: 'nobody' };
  if (person.email === address) return { ok: false, reason: 'same' };

  // The unique index would throw on a duplicate, and catching it there would tell
  // us only that *some* constraint failed. Asking first lets the caller say what
  // actually happened — and the answer is safe to give here: this person is
  // already signed in and already knows whether they own the address.
  const taken = await one('select id from profiles where email = $1', [address]);
  if (taken) return { ok: false, reason: 'taken' };

  await query('update profiles set email = $2, email_verified_at = null where id = $1', [userId, address]);
  await store.audit('auth.email_changed', { from: person.email, to: address },
    { actorId: userId, subjectType: 'profile', subjectId: userId });

  const sent = await sendVerification({
    user: { ...person, email: address }, baseUrl, ip, userAgent, now,
  });

  // To the previous address, always, even if the new one fails to send. This is a
  // security notice, not a confirmation, and it must not be skippable.
  await send({
    kind: 'email_changed',
    to: person.email,
    userId,
    subject: 'The address on your ByteBikri account was changed',
    text: [
      'The email address on this ByteBikri account was just changed.',
      '',
      `It was: ${person.email}`,
      `It is now: ${address}`,
      '',
      'If you did this, nothing more is needed — a link has gone to the new address to confirm it.',
      '',
      'If you did NOT do this, somebody else has access to the account and the address is the thing they',
      'took away from you first. Reply to this message, or write to the operator address in the site',
      'footer, and a person will look at it.',
      '',
      '— ByteBikri',
    ].join('\n'),
  });

  return { ok: true, previous: person.email, address, sent };
}

/** What a page needs to know about one account's address. No tokens, ever. */
export async function addressState(userId) {
  const row = await one(
    `select p.email, p.email_verified_at,
            (select count(*)::int from email_tokens
              where user_id = p.id and kind = 'email_verify') as links_sent,
            (select count(*)::int from email_tokens
              where user_id = p.id and kind = 'email_verify' and used_at is not null) as links_used,
            (select max(created_at) from email_tokens
              where user_id = p.id and kind = 'email_verify') as last_sent_at,
            (select count(*)::int from outbound_emails
              where user_id = p.id and kind in ('email_verify', 'email_changed')
                and delivered = false and error is not null) as failed_deliveries,
            (select error from outbound_emails
              where user_id = p.id and kind in ('email_verify', 'email_changed') and error is not null
              order by created_at desc limit 1) as last_error
       from profiles p where p.id = $1`,
    [userId],
  );
  return row ?? null;
}

/** Everyone whose address is still unconfirmed, newest first — for the console. */
export async function unconfirmedAccounts({ limit = 50 } = {}) {
  const { rows } = await query(
    `select p.id, p.email, p.display_name, p.created_at, p.role,
            (select count(*)::int from email_tokens
              where user_id = p.id and kind = 'email_verify') as links_sent,
            (select count(*)::int from channels c where c.owner_id = p.id) as stores
       from profiles p
      where p.email_verified_at is null and p.banned = false
      order by p.created_at desc limit $1`,
    [Math.max(1, Math.min(Number(limit) || 50, 200))],
  );
  return rows;
}
