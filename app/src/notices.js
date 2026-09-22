// ============================================================================
//  Notices a person sends from the console
// ============================================================================
//  Everything else this platform emails is triggered by the person it is about:
//  they asked for a reset, they signed up, they changed their address. This is the
//  first message that is sent TO somebody who did not ask, so it carries an extra
//  obligation — it has to be about something they can still act on, it has to say
//  what happens if they do nothing, and a person has to have decided to send it.
//
//  That last clause is the design, not a limitation. There is no scheduler here,
//  on purpose: a job that mails people at midnight is a job nobody can be
//  answerable for, and the console already has the pattern for the alternative —
//  a derived list (`verificationsLapsing`), worked by hand, in the order the dates
//  come. The operator sees who is close to the date, who has already been told,
//  and sends the message from the store's own page, where the check it is about is
//  on screen.
//
//  The message text itself lives in `verification.js` with the badge sentence, for
//  the same reason: it is a claim about what the platform checked, and a claim has
//  one author.
// ============================================================================

import { send } from './email.js';
import { lapseNotice, lapseOf } from './verification.js';

/**
 * Tell a seller their identity check is about to stop counting.
 *
 * Never throws — `send()` never throws, and this must not either, because it is
 * called from a route whose other outcome is a redirect with a flash. The return
 * value says what actually happened, including the case where the message was
 * written down but not delivered, which is the normal state of affairs until a
 * mail provider is configured and is NOT the same thing as a failure.
 */
export async function sendLapseNotice({ channel, verification, env = process.env }) {
  const lapse = lapseOf(verification);
  if (!lapse) return { ok: false, why: 'there is no live check to write about' };

  const to = channel.owner_email || null;
  if (!to) return { ok: false, why: 'the store owner has no email address on file' };

  const message = lapseNotice({
    channelName: channel.name,
    expiresAt: verification.expires_at,
    days: lapse.days,
  });

  const result = await send({
    to,
    subject: message.subject,
    text: message.text,
    kind: 'verification.lapse_notice',
    // Tied to the account, so the operator's mail log answers "what has this
    // person been told" and not just "what went out today".
    userId: channel.owner_id || null,
    env,
  });

  return { ...result, to, days: lapse.days, level: lapse.level, subject: message.subject };
}
