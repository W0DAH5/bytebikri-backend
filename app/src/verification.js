import { longDay, daysBetween } from './dates.js';

/**
 * Seller verification — a document check, of which we keep the outcome.
 *
 * The model, in one paragraph: a creator asks for a check; a person on this side
 * looks at ONE identity document somewhere outside this platform and writes down
 * WHAT they saw, WHEN, and WHO looked. No bytes, no scans, no numbers — the
 * database has a `docs_retained boolean check (docs_retained = false)` that makes
 * storing an image impossible, and this module never wants to.
 *
 * Three things the wording is careful about, all of them researched:
 *
 *   The badge says what was checked and when. A badge that just says "verified"
 *   invites a buyer to hear "trustworthy" (Regula's guidance is blunt: badge
 *   wording should state what was checked, "or buyers may read far more into it
 *   than the evidence supports"). So the sentence names the document type and the
 *   date, and then says what it is not — it is not a review of these files.
 *
 *   Verification is not a character reference. Meta's own Marketplace badge means
 *   "a real person controls this account", which is exactly the claim we can
 *   support and no more. A bad file is a moderation matter, handled elsewhere.
 *
 *   Absence is not an accusation. Badges are a positive mark only: there is no
 *   "unverified" chip anywhere, because a creator who has not been checked is not
 *   a suspect and the platform should not paint them as one.
 *
 * Expiry is DERIVED, not stored: a row past `expires_at` reads as expired, so no
 * job has to run at midnight. Same reasoning as the grace period on rent — a
 * self-calculated state cannot be stale.
 *
 * Why Nepal's documents are the list they are (`METHODS`): a freelancer or creator
 * here registers for a PAN, and a PAN application is made with a citizenship
 * certificate — so those are the two documents a working creator actually has.
 * A business has its registration certificate, a foreign or NRN seller has a
 * passport. Registration is free and the digital PAN in the Nagarik App is
 * QR-verifiable, which is what makes a check cost minutes rather than days.
 *
 * This module is deliberately pure: no database, no imports at all. The queries
 * live in `store.js` with every other query, because `views.js` imports this — and
 * a view module that drags a connection pool into a CSS test is a seam in the
 * wrong place. (It did, for ten minutes, and `test/design.test.js` said so.)
 */
/** How long a check counts before it has to be looked at again. */
export const DEFAULT_MONTHS = 24;

export const METHODS = [
  {
    code: 'citizenship',
    label: 'citizenship certificate',
    title: 'Citizenship certificate',
    detail: 'The usual one. It is also what a PAN application is made with, so a working creator already has it to hand.',
  },
  {
    code: 'pan',
    label: 'PAN card',
    title: 'PAN card',
    detail: 'The tax number a freelancer in Nepal registers for. Free, issued the same day or within a few days, and the digital copy in the Nagarik App verifies by QR code.',
  },
  {
    code: 'passport',
    label: 'passport',
    title: 'Passport',
    detail: 'For someone without a citizenship certificate to hand, including a non-resident Nepali.',
  },
  {
    code: 'business_reg',
    label: 'business registration',
    title: 'Business registration',
    detail: 'A firm or a company: the OCR certificate, or the Department of Industry registration for a sole trader.',
  },
  {
    code: 'manual',
    label: 'another document',
    title: 'Something else',
    detail: 'A document that proves who somebody is and is not in this list. Whatever it was goes in the note, because otherwise the record means nothing later.',
  },
];

export const methodOf = (code) => METHODS.find((m) => m.code === code) || null;

/**
 * The state of a store's verification, from the newest row about it.
 *
 * `verified` is the only state that carries a badge, and it lapses on its own.
 */
export function stateOf(row, now = new Date()) {
  if (!row) return 'none';
  if (row.status === 'pending') return 'pending';
  if (row.status === 'rejected') return 'rejected';
  if (row.status === 'expired') return 'expired';
  // An allowlist, not a fallthrough — and this one line is the difference between
  // a badge and a false claim. The first version ended in `return 'verified'`, so
  // every status it did not recognise (`none`, a typo, a state a later migration
  // adds) rendered as a positive mark on a storefront.
  if (row.status !== 'verified') return 'none';
  if (row.expires_at && new Date(row.expires_at) <= now) return 'expired';
  return 'verified';
}

/**
 * How long before the date a person starts working on it.
 *
 * Sixty days, and the number is researched rather than picked. Verification
 * vendors recommend telling somebody at 30 days and again closer to the date, and
 * the employment-eligibility practice is a first notice at 120 days with repeats
 * at 90/60/30 — because the point of the notice is that the person can DO
 * something about it, and renewing a document takes weeks. A platform that
 * notices on the last day has not given anybody time; one that starts a year out
 * is nagging. Sixty days is the window this console works in, and the seller's own
 * panel says the date from the moment the check is recorded.
 */
export const LAPSE_WINDOW_DAYS = 60;

/** The three levels of "how close is this to ending", and what each one means. */
export const LAPSE_LEVELS = [
  { key: 'current', label: 'In date', note: 'More than two months left. Nothing to do.' },
  { key: 'soon', label: 'Due within two months', note: 'Time to ask again — a fresh check is the same two-minute process, and the current one keeps counting while it is arranged.' },
  { key: 'due', label: 'Due within a month', note: 'Send the notice, and expect them to ask again. The badge comes down on the date whether or not anybody has.' },
  { key: 'lapsed', label: 'Lapsed', note: 'The badge is already down. Nothing is broken and nothing was taken away — a store with a lapsed check is a store with no badge, which is where most stores are.' },
];

/**
 * Inside the notice window — the only state in which asking again is the right move.
 *
 * This is a name because the first draft of the seller panel passed `lapsing: true`
 * for ANY live check, which meant a seller whose check runs for another eighteen
 * months was offered the renewal form. `lapseOf(...)` answering with a level is not
 * the same question as "is it close to its date"; the level has to be read.
 */
export const withinNoticeWindow = (lapse) => Boolean(lapse && (lapse.level === 'soon' || lapse.level === 'due'));

/**
 * How close a check is to ending — or how long ago it did.
 *
 * Null when the row is not a check at all (pending, refused, nothing). A row that
 * was verified and has since passed its date returns `lapsed`, NOT null: the
 * console needs to be able to say "this store's badge came down on the 3rd", and a
 * function that goes quiet exactly when the thing happened is a function that
 * answers the easy half of the question.
 *
 * Derived, like every other state here: read `expires_at`, compare to now, and
 * nothing has to run at midnight to move a seller into a list. The same shape as
 * `rentAge`, deliberately — a console where "how late is this money" and "how
 * close is this check" are answered by two different kinds of machinery is a
 * console with two places to be stale.
 */
export function lapseOf(row, now = new Date()) {
  if (!row || row.status !== 'verified' || !row.expires_at) return null;
  const days = daysBetween(now, row.expires_at);
  if (days === null) return null;
  const level = days < 0 ? 'lapsed' : days <= 30 ? 'due' : days <= LAPSE_WINDOW_DAYS ? 'soon' : 'current';
  const label = days < 0
    ? 'lapsed'
    : days === 0 ? 'ends today'
      : days === 1 ? 'ends tomorrow'
        : days <= 90 ? `${days} days left`
          : `${Math.round(days / 30)} months left`;
  return { days, level, label };
}

/**
 * Whether a store may ask for a check right now, and why not when it may not.
 *
 * `state` is the STANDING outcome — what the badge is — and `pending` is a
 * separate fact, because they are genuinely independent: a seller whose check is
 * still good can ask for the next one, and the badge must not disappear because
 * they did. (Research is explicit about that direction: maintain the mark while
 * prompting for renewal.)
 */
export function requestability({ capabilities = {}, state = 'none', pending = false, lapsing = false } = {}) {
  if (!capabilities.verified_badge) {
    return {
      ok: false,
      code: 'plan',
      reason: 'A document check is included from the Store plan up.',
      detail: 'Your files sell exactly the same either way. This is about who is behind the store, and it costs us a person\'s time to look.',
    };
  }
  if (pending || state === 'pending') {
    return { ok: false, code: 'already-asked', reason: 'Your request is with us.', detail: 'Nobody has looked yet. We do this by hand, in the order requests arrive.' };
  }
  if (state === 'verified' && !lapsing) {
    return { ok: false, code: 'already-checked', reason: 'Already checked.', detail: 'There is nothing to ask for until the check is close to lapsing — and we tell you when it is.' };
  }
  if (state === 'verified' && lapsing) {
    return {
      ok: true,
      code: null,
      reason: null,
      detail: 'Ask again now and a person looks at your document when your turn comes. Nothing changes until they do: the check you have keeps counting to its own date, and the badge stays up.',
    };
  }
  if (state === 'rejected') {
    return {
      ok: true,
      code: null,
      // Research is explicit that a failed check is not a finding of fraud, and
      // that the person needs a specific instruction rather than a wall.
      reason: null,
      detail: 'You can ask again. Show the same document, or a different one — the note on the refusal says what did not work.',
    };
  }
  return { ok: true, code: null, reason: null, detail: null };
}

/**
 * What the badge says. Null when there is nothing to show.
 *
 * The sentence is the product here, so it is built in one place: the storefront,
 * the Explore card and the seller's own settings all render this and nothing else.
 */
export function badgeFor(row, now = new Date()) {
  if (stateOf(row, now) !== 'verified') return null;
  const method = methodOf(row.method);
  const seen = row.verified_at || row.decided_at || row.created_at;
  return {
    label: 'Identity checked',
    method: method ? method.label : 'a document',
    seenAt: seen,
    // What was checked, and when. Not "trusted seller".
    sentence: `A person on our side looked at this seller's ${method ? method.label : 'identity document'}`
      + ` and matched it to this account on ${longDay(seen)}.`,
  };
}

/**
 * The message a person sends before a check lapses.
 *
 * Composed here rather than in the route for the same reason the badge sentence
 * is composed here: it is copy about a claim, and it has to say the same thing
 * wherever it is sent from. Three facts, in the order the reader needs them — the
 * date, what happens on the date, and what happens to everything else (nothing).
 * The last line exists because the first question somebody asks on receiving this
 * is "am I about to lose my store", and the answer is no.
 */
export function lapseNotice({ channelName, expiresAt, days = null, site = 'ByteBikri' }) {
  const when = longDay(expiresAt);
  const soon = days === null ? '' : days <= 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`;
  return {
    subject: `Your identity check ends on ${when}`,
    text: [
      `The check on ${channelName} was made after somebody looked at your document. It stops counting on ${when}${soon ? ` (${soon})` : ''}, and the badge comes off your store page the same day.`,
      '',
      'Nothing else changes. Your store stays open, your files stay published, unlocks and earnings are untouched — the badge is the only thing on the line, and it is the only thing that goes.',
      '',
      'If you want it back, ask for a check from your store settings when it suits you. It is the same process as the first time: a person looks at one document, and the outcome is recorded. You do not need to send us anything now.',
      '',
      `— ${site}`,
    ].join('\n'),
  };
}

/** What the platform does and does not keep, for the panel under the badge. */
export function whatItMeans() {
  return [
    'We keep the outcome, the date and the initials of whoever looked. Nothing else.',
    'No copy, scan or photograph of the document is stored — the database refuses it at the column level.',
    'It is a check on who is behind the store. It is not a review of the files here, and it says nothing about a purchase.',
    'It lapses. We tell you about two months before it does, and the badge comes down on the date either way.',
  ];
}

/** When a check made today stops counting. */
export function expires(months = DEFAULT_MONTHS, from = new Date()) {
  const d = new Date(from);
  d.setMonth(d.getMonth() + months);
  return d;
}

// The date form used in the badge sentence and both panels. It lives in
// `dates.js` with the reasoning (and with the shop's clock), so the sentence, the
// panel and the plan renewal date beside them cannot disagree about the day.
export { longDay };

export const STATE_WORDING = {
  none: 'Not checked',
  pending: 'Asked for a check',
  verified: 'Identity checked',
  expired: 'Check has lapsed',
  rejected: 'Not checked — the document did not work',
};
