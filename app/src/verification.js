import { longDay } from './dates.js';

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

/** Whether a store may ask for a check right now, and why not when it may not. */
export function requestability({ capabilities = {}, state = 'none' } = {}) {
  if (!capabilities.verified_badge) {
    return {
      ok: false,
      code: 'plan',
      reason: 'A document check is included from the Store plan up.',
      detail: 'Your files sell exactly the same either way. This is about who is behind the store, and it costs us a person\'s time to look.',
    };
  }
  if (state === 'pending') return { ok: false, code: 'already-asked', reason: 'Your request is with us.', detail: 'Nobody has looked yet. We do this by hand, in the order requests arrive.' };
  if (state === 'verified') return { ok: false, code: 'already-checked', reason: 'Already checked.', detail: 'There is nothing to ask for until the check lapses.' };
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

/** What the platform does and does not keep, for the panel under the badge. */
export function whatItMeans() {
  return [
    'We keep the outcome, the date and the initials of whoever looked. Nothing else.',
    'No copy, scan or photograph of the document is stored — the database refuses it at the column level.',
    'It is a check on who is behind the store. It is not a review of the files here, and it says nothing about a purchase.',
    'It lapses. After it does, the badge comes down until somebody looks again.',
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
