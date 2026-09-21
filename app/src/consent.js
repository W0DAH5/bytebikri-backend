/**
 * Consent.
 *
 * The rule that shapes everything here: consent must be FREELY GIVEN, which
 * means a refusal has to be as easy, as visible and as final as an acceptance.
 * A banner with "Accept all" and a grey "manage preferences" link is not consent
 * — it is a dark pattern, the EU's cookie banner task force has said so
 * repeatedly, and regulators have fined for it.
 *
 * So this module offers exactly two first-class answers, and then a preferences
 * screen for people who want to split the difference. There is no default: an
 * unanswered banner is not an acceptance, and `outstanding()` returns null — not
 * `true`, not `false` — until somebody decides.
 *
 * The second rule: the decision is stored server-side, keyed to a random
 * first-party cookie and to the VERSION of the notice the person actually saw.
 * A client can lie about its own consent; the record we hold is what we answer
 * to. And when the notice changes materially, the version changes, the old row
 * stops counting, and the banner returns.
 */

import crypto from 'node:crypto';
import { one, query } from './db.js';

/**
 * Bump this whenever the notice changes in a way a person would care about:
 * a new purpose, a new category of recipient, a new retention period. Not for
 * typos. The number is what makes an old agreement stop being an agreement.
 */
export const POLICY_VERSION = '2026-09-1';

/**
 * The purposes we ask about. `necessary` is not on the list: it is not a choice.
 *
 * There is deliberately only one. An earlier draft also asked about "product
 * analytics", which was removed once it was clear it controlled nothing: the
 * page-view counter is a per-store daily count with no identifier attached to
 * it, which is not tracking and does not need permission. Keeping a toggle that
 * changes no behaviour is worse than not asking — a consent screen full of
 * switches nobody honours teaches people their answers do not matter, and that
 * is how the one answer that DOES matter gets clicked through unread.
 *
 * When there is a purpose that genuinely changes behaviour — Google's consent
 * signals, a second network with its own storage — it gets added here, the
 * policy version is bumped, and everyone is asked again.
 */
export const PURPOSES = [
  {
    key: 'ads',
    label: 'Personalised ads',
    detail: 'The ad network picks which rewarded ad to show you from what you have already '
      + 'watched, and it keeps an identifier so it can do that again next time. This is what '
      + 'makes an ad worth enough for the creator to be paid. Refuse it and you still watch '
      + 'an ad — just an untargeted one, chosen from the page it appears on.',
  },
];

const PURPOSE_KEYS = PURPOSES.map((p) => p.key);

/**
 * Choices a person submits, normalised.
 *
 * Anything absent is FALSE. An unsubmitted checkbox and a refused purpose are
 * indistinguishable in a form POST, and the two possible mistakes are not
 * symmetrical: reading "absent" as consent shows personalised ads to someone who
 * refused, while reading it as refusal shows one less targeted ad. Only one of
 * those is a violation.
 */
export function normaliseChoices(input = {}) {
  const out = { necessary: true };
  for (const key of PURPOSE_KEYS) out[key] = input[key] === true || input[key] === 'on' || input[key] === 'true';
  return out;
}

/** Every purpose off. The "Reject all" button, and a real answer. */
export const rejectAll = () => normaliseChoices({});

/** Every purpose on. The "Accept all" button. */
export const acceptAll = () => normaliseChoices(Object.fromEntries(PURPOSE_KEYS.map((k) => [k, true])));

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

export const CONSENT_COOKIE = 'bb_cv';

/** A fresh visitor id. Opaque and random: it identifies a browser, not a person. */
export const newVisitorId = () => crypto.randomBytes(16).toString('hex');

/** Hashed with the app secret so the stored value cannot be re-identified alone. */
export function hashWithAppSecret(value) {
  if (!value) return null;
  const secret = process.env.SESSION_SECRET || 'dev-only-secret';
  return crypto.createHmac('sha256', secret).update(String(value)).digest('hex').slice(0, 32);
}

/**
 * Country, as best we can tell it from a CDN header.
 *
 * Deliberately only from a header the hosting platform sets. Geo-IP by
 * third-party lookup would mean sending every visitor's address to a company we
 * have no agreement with — a disclosure we would then have to put in the
 * privacy notice. If no header is present we return null and treat the visitor
 * as subject to the strictest rules, because guessing "probably not in Europe"
 * is how a platform ends up serving personalised ads to someone it must not.
 */
export function countryOf(req) {
  const raw = req.get?.('cf-ipcountry') || req.get?.('x-vercel-ip-country') || req.get?.('x-country') || null;
  if (!raw) return null;
  const code = String(raw).toUpperCase().slice(0, 2);
  return /^[A-Z]{2}$/.test(code) ? code : null;
}

/**
 * Jurisdictions where consent is legally required before personalised ads.
 * EEA + UK + Switzerland all implement the ePrivacy directive. Rather than
 * enumerate 30 countries and miss one, the rule is inverted: we ask EVERYONE
 * unless we can positively identify a jurisdiction that does not require it.
 *
 * The cost is a banner in Kathmandu. The alternative costs a fine in Berlin.
 */
export function requiresConsent(country) {
  if (!country) return true;                     // unknown → strict
  const EEA = new Set(['AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR',
    'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE',
    'IS', 'LI', 'NO', 'GB', 'CH']);
  return EEA.has(country) ? true : false;
}

// ---------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------

/**
 * Write the decision. Upsert on (visitor, version): changing your mind replaces
 * your own record, but a new version of the notice produces a new row so the
 * history of what was agreed when survives.
 */
export async function recordConsent({ visitorId, choices, req, country = null }) {
  const c = normaliseChoices(choices);
  // Only the blob is supplied; ads_granted is generated from it. Passing a
  // per-purpose column here is what broke when a purpose was removed.
  return one(
    `insert into consent_records
       (visitor_id, policy_version, choices, ip_hash, user_agent_hash, country)
     values ($1, $2, $3::jsonb, $4, $5, $6)
     on conflict (visitor_id, policy_version) do update
       set choices = excluded.choices,
           updated_at = now(),
           country = excluded.country
     returning *`,
    [
      visitorId, POLICY_VERSION, JSON.stringify(c),
      hashWithAppSecret(req?.ip), hashWithAppSecret(req?.get?.('user-agent')), country,
    ],
  );
}

/** The live decision for this visitor, or null if they have never answered. */
export async function consentFor(visitorId) {
  if (!visitorId) return null;
  return one(
    `select * from consent_records where visitor_id = $1 and policy_version = $2`,
    [visitorId, POLICY_VERSION],
  );
}

/**
 * What the request layer needs, and nothing more.
 *
 * `outstanding` is true when there is no answer for the current version. The
 * caller must treat that as "do not personalise", not as a soft yes.
 */
export async function consentState(req) {
  const visitorId = req.cookies?.[CONSENT_COOKIE] || null;
  const country = countryOf(req);
  const record = visitorId ? await consentFor(visitorId) : null;

  if (!record) {
    return {
      visitorId, country,
      ads: false, choices: {},
      decided: false, outstanding: true,
      required: requiresConsent(country),
      version: POLICY_VERSION,
      purposes: PURPOSES,
    };
  }

  // jsonb comes back parsed, but a driver upgrade or a manual edit could leave
  // it a string. Trust the columns, not the blob.
  return {
    visitorId, country,
    ads: record.ads_granted === true,
    // Straight from the blob, so a purpose added to PURPOSES needs no schema
    // change and no second place to remember.
    choices: record.choices || {},
    decided: true, outstanding: false,
    required: requiresConsent(country),
    version: POLICY_VERSION,
    decidedAt: record.decided_at,
    purposes: PURPOSES,
  };
}

/** Counts for the dashboard: how many people said yes, and how many said no. */
export async function consentSummary({ since = '30 days' } = {}) {
  return one(
    `select
       count(*)::int                                              as decisions,
       count(*) filter (where ads_granted)::int                   as ads_granted,
       count(*) filter (where not ads_granted)::int               as ads_refused,
       count(*) filter (where (choices ->> 'analytics')::boolean)::int as analytics_granted
     from consent_records
     where decided_at > now() - interval '${since}'`,
  );
}

/** Erase a visitor's decision. Wired to the same path as any other erasure. */
export async function forgetVisitor(visitorId) {
  if (!visitorId) return 0;
  const { rowCount } = await query('delete from consent_records where visitor_id = $1', [visitorId]);
  return rowCount;
}
