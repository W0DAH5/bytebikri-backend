/**
 * Memberships — the rules, with no database and no markup.
 *
 * The feature in one sentence: a person pays the CREATOR directly, the creator
 * confirms it, and until the period runs out that person's name carries a plate
 * on the storefront and the files behind their tier open without an ad.
 *
 * Everything decided here is a decision that would otherwise be scattered across
 * a route, a query and a template:
 *
 *   * which palettes exist (a fixed, contrast-checked set — not free-form hex),
 *   * what the top tier's plate looks like (a rule, not a stored preference),
 *   * when a member counts as current (derived from `period_end`, like every
 *     other clock in this codebase),
 *   * whether a given file opens for a given membership,
 *   * and the sentence that has to be true on every surface where money is
 *     mentioned: bytebikri never receives these dues and cannot confirm them.
 *
 * The palettes are not taste. Gradient text fails a contrast check at small
 * sizes — the researched guidance is to decide the text colour first and pick
 * stops that clear 3:1 at the worst point — so the name stays a solid accent
 * colour and the EFFECT goes on the ring and the tier chip, where the worst-stop
 * contrast can be checked once and printed here. Every palette below clears
 * 4.5:1 for its text tone on both themes and 4.5:1 for white ink on both
 * gradient stops. The numbers are the reason the list is short.
 */
// The ad-slot policy, imported rather than restated. This module already refuses
// to import the database; `slots.js` is pure policy, so the two files that decide
// where an ad may sit are reading the same numbers instead of agreeing today.
import { POLICY } from './slots.js';

export const TIERS_MAX = 2;

/** Offered periods, in months. A month is the default; a year is a discount the
 *  creator can offer, a quarter is the one people can actually decide on. */
export const PERIODS = [1, 3, 12];

export const CLAIM_METHODS = ['esewa', 'khalti', 'imepay', 'bank', 'other'];

/**
 * Eight palettes. `onDark` is the name colour on the night theme, `onLight` on
 * the day one, and `from`/`to` are the two stops of the plate gradient — same
 * family, so the ring reads as one colour rather than a rainbow.
 */
export const ACCENTS = {
  indigo:  { label: 'Indigo',  onDark: '#818cf8', onLight: '#4338ca', from: '#4f46e5', to: '#6d28d9' },
  violet:  { label: 'Violet',  onDark: '#a78bfa', onLight: '#6d28d9', from: '#7c3aed', to: '#5b21b6' },
  teal:    { label: 'Teal',    onDark: '#2dd4bf', onLight: '#0f766e', from: '#0f766e', to: '#115e59' },
  emerald: { label: 'Emerald', onDark: '#34d399', onLight: '#047857', from: '#047857', to: '#065f46' },
  amber:   { label: 'Amber',   onDark: '#fbbf24', onLight: '#b45309', from: '#b45309', to: '#92400e' },
  rose:    { label: 'Rose',    onDark: '#fb7185', onLight: '#be123c', from: '#e11d48', to: '#be123c' },
  sky:     { label: 'Sky',     onDark: '#38bdf8', onLight: '#0369a1', from: '#0369a1', to: '#075985' },
  slate:   { label: 'Slate',   onDark: '#a8b2c1', onLight: '#334155', from: '#334155', to: '#1e293b' },
};

export const ACCENT_KEYS = Object.keys(ACCENTS);

export function accentOf(key) {
  return ACCENTS[key] ?? ACCENTS.indigo;
}

/** The creator's own words for what a tier is; used until they rename it. */
export function defaultTierName(tierNo) {
  return Number(tierNo) === 2 ? 'Elite' : 'Member';
}

/**
 * Which plate a tier wears. Tier 2 is the shiny one and tier 1 is not — that is
 * the rule, and it is the platform's own advice borrowed from how Discord's
 * role styles are deployed (keep gradient and shimmer to one or two roles, or
 * nothing on the page stands out). Deriving it also means a creator cannot make
 * every member look identical to the elite tier, which is the one thing a paid
 * tier cannot survive.
 */
export function plateStyle(tierNo) {
  return Number(tierNo) === 2 ? 'gradient' : 'solid';
}

/** What a plate is worth saying out loud, for the seller's own reassurance. */
export const PLATE_COPY = {
  solid: 'A ring and a name colour in their tier’s palette',
  gradient: 'The same, with the shimmering two-tone ring — the top tier wears it',
};

/**
 * Validate a tier as a seller submitted it.
 *
 * Returns `{ ok, error, value }` rather than throwing, because every one of
 * these refusals is a sentence a seller is owed on a form they just filled in.
 */
export function tierDraft({ name, duesNpr, periodMonths, perks, accent } = {}) {
  const clean = String(name ?? '').trim().replace(/\s+/g, ' ').slice(0, 24);
  if (clean.length < 2) return { ok: false, error: 'tier-name' };
  const dues = Number(duesNpr);
  if (!Number.isFinite(dues) || dues < 0 || dues > 100000) return { ok: false, error: 'tier-dues' };
  const months = Number(periodMonths);
  if (!PERIODS.includes(months)) return { ok: false, error: 'tier-period' };
  const line = String(perks ?? '').trim().replace(/\s+/g, ' ').slice(0, 160);
  const accentKey = ACCENT_KEYS.includes(String(accent)) ? String(accent) : 'indigo';
  return {
    ok: true,
    error: null,
    value: { name: clean, duesNpr: Math.round(dues), periodMonths: months, perks: line || null, accent: accentKey },
  };
}

/** Where the dues go. Public by design — the creator sends the instruction. */
export function paymentNoteDraft(note) {
  const line = String(note ?? '').trim().replace(/\s+/g, ' ').slice(0, 240);
  return line || null;
}

/**
 * What state a membership is in, right now.
 *
 * `lapsed` is not a stored status. A membership that was confirmed and whose
 * period has ended IS lapsed — the same discipline as a check's lapse and a
 * rent invoice's lateness, and the reason nothing here needs a cron job that
 * somebody has to remember to keep running.
 */
export function membershipState(row, now = new Date()) {
  if (!row) return 'none';
  if (row.status === 'pending') return 'pending';
  if (row.status === 'rejected') return 'rejected';
  if (row.status !== 'active') return 'none';
  const end = row.period_end ? new Date(row.period_end) : null;
  if (!end) return 'active';
  return end.getTime() > now.getTime() ? 'active' : 'lapsed';
}

export function daysLeft(periodEnd, now = new Date()) {
  if (!periodEnd) return null;
  return Math.ceil((new Date(periodEnd).getTime() - now.getTime()) / 86400000);
}

/** A membership that opens files: confirmed, and inside its period. */
export function membershipCurrent(membership, now = new Date()) {
  return membershipState(membership, now) === 'active';
}

/**
 * Does this membership open this file?
 *
 * `policy` is an `asset_unlock_policy` row. Only `mode = 'members'` files are
 * decided here; every other file keeps the rule it already had, which is what
 * makes this one function instead of a rewrite of the access path.
 */
export function opensFor({ policy, membership } = {}) {
  if (policy?.mode !== 'members') return false;
  if (!membershipCurrent(membership)) return false;
  const needed = Number(policy.member_tier) || 1;
  const held = Number(membership.tier_no) || 1;
  return held >= needed;
}

/**
 * Why a member cannot open a file, in the words the page will use.
 *
 * A refusal that does not say which tier it wants is the most common way a
 * membership page wastes somebody's click.
 */
export function memberRefusal({ policy, membership, tiers = [] } = {}) {
  if (policy?.mode !== 'members') return null;
  const needed = Number(policy.member_tier) || 1;
  const tier = tiers.find((t) => Number(t.tier_no) === needed) ?? null;
  const name = tier?.name || defaultTierName(needed);
  const state = membershipState(membership);
  if (state === 'pending') return { code: 'pending', tier: needed, name };
  if (state === 'lapsed') return { code: 'lapsed', tier: needed, name };
  if (state === 'active' && Number(membership.tier_no) < needed) return { code: 'tier', tier: needed, name };
  return { code: 'join', tier: needed, name };
}

/** The dues line, for a tier card. "NPR 250 a month" — never a bare number. */
export function duesLine(tier) {
  const months = Number(tier?.period_months) || 1;
  const amount = Number(tier?.dues_npr) || 0;
  const per = months === 12 ? 'a year' : months === 3 ? 'every three months' : 'a month';
  if (!amount) return 'Free to join';
  return `NPR ${amount.toLocaleString('en-IN')} ${per}`;
}

/**
 * THE sentence. It appears wherever a person is asked for money, and it is the
 * product's whole position in one line: this platform is not a payment
 * processor, does not hold dues, takes no share of them, and therefore cannot
 * confirm or refund one. If a screen asks for a payment and does not say this,
 * the screen is lying by omission.
 */
export const MONEY_LINE =
  'The dues go straight to the creator — bytebikri never receives them, takes no share, and cannot confirm or refund a payment. Only the creator can.';

/** Answering the seller's question the user asked: is "no members" too harsh? */
export const FREE_PLAN_LINE =
  'Watching a store is free for everyone, always. Members — names on the storefront, files that open without an ad — come with the Store plan, and this store is on Free.';

/**
 * What the seller sees when a claim is waiting. Spelled out, because the wrong
 * instinct here is to confirm whatever arrives and be helpful.
 */
export const CONFIRM_LINE =
  'Check your own statement for that reference before you confirm. Confirming is what opens the files — the platform cannot check it for you.';

/** The honest rule for a lapsed member, in the words the page will use. */
export const LAPSE_LINE =
  'Nothing is deleted when a period ends. The plate goes quiet and the members-only files close until dues are confirmed again.';

/**
 * WHERE THE ADS ARE, AND WHERE THEY ARE NOT.
 *
 * This is the membership's real promise, and the one the market punishes hardest
 * when it is broken. Researched in September 2026, and the record is unambiguous:
 *
 *   * YouTube Premium is defending TWO class actions over its "ad-free" claim,
 *     filed in California and British Columbia, on the argument that a sponsorship
 *     a creator reads out is still an ad the subscriber paid to avoid.
 *   * Disney+ rewrote its subscriber agreement to permit promotional content
 *     "before/after playback" on EVERY tier including the ad-free ones, and
 *     subscribers began closing accounts over the report of it before Disney
 *     clarified that nothing had actually changed for them yet.
 *   * Medium's whole pitch is a member-funded platform with "no ad strip", and
 *     Substack's support pages say the same from the other side: the business model
 *     is subscriptions, not advertisers, and paid posts carry none.
 *
 * The line every one of them draws, and the one this product draws: an ad may sit
 * AROUND a member's content and never INSIDE what they paid to open. So the
 * membership never gates a file behind an ad, and the ad positions that do exist
 * on a member's page are the same positions that exist on every other page of the
 * store: the shop's own, where the shop already had them, plus the single position
 * the platform rents, which is always last. The member is told both facts in the
 * same sentence, because a promise somebody has to discover for themselves is not
 * a promise, it is a surprise.
 */
export const MEMBER_AD_LINE =
  'Nothing is placed between you and the file: it opens because your dues are current, not because you watched '
  + 'something first. The page around it carries the same ad positions as the rest of the store, the shop’s own '
  + 'and the one bytebikri rents, and none of them gates a download or interrupts one.';

/** The same arrangement, said to a seller, who is deciding whether to sell memberships. */
export const ADS_AROUND_LINE =
  'Ad positions sit around a member’s content and never inside it. That is deliberate: what a member paid for is '
  + 'never interrupted, and the shop and the platform still earn from the page it sits on.';

/**
 * The seller's direction of the same money, in one line, because "0% commission"
 * is only half a model. bytebikri charges a store in exactly two places, and a
 * seller should never have to work out which they are.
 */
export const SELLER_DUES_LINE =
  'Dues are 100% yours. bytebikri never receives them, which is not a 0% rate, it is the absence of a way to take one.';

/**
 * The whole arrangement as rows a page can print.
 *
 * Pure, and takes its numbers as arguments, so the seller's page and the test that
 * checks it read the SAME sentences rather than two copies that agree today. The
 * platform's slot and the threshold that decides whether one is taken at all come
 * from `slots.js`, so if that policy changes this panel changes with it instead of
 * going quietly out of date.
 */
export function revenueRows({ planName = 'Free', planPrice = 'free', slotCount = 0 } = {}) {
  const slots = Number(slotCount) || 0;
  const takesSlot = slots >= POLICY.minTenantSlotsBeforeTax;
  return [
    {
      term: 'Dues you collect',
      text: `All of it stays with you. ${SELLER_DUES_LINE}`,
    },
    {
      term: 'What bytebikri charges you',
      text: `Two things, and neither is a share of your dues: the ${planName} plan (${planPrice}) and the annual rent `
        + `for the one ad position the platform takes on your pages. Rent is priced from the traffic your store `
        + `actually got, so a quiet store is charged nothing at all.`,
    },
    {
      term: 'Where the ad positions are',
      text: takesSlot
        ? `You keep ${slots - POLICY.platformSlotsPerPage} of the ${slots} positions a page can carry; the platform takes `
          + `the last one, never the first, and never more than one. ${ADS_AROUND_LINE}`
        : `Your plan carries ${slots} positions and a page needs ${POLICY.minTenantSlotsBeforeTax} before the platform will `
          + `take one, so none is placed on your pages and there is no rent to price. ${ADS_AROUND_LINE}`,
    },
    {
      term: 'What your members see',
      text: MEMBER_AD_LINE,
    },
  ];
}

export function tierByNo(tiers = [], tierNo) {
  return tiers.find((t) => Number(t.tier_no) === Number(tierNo)) ?? null;
}

/** A tidy label for a method of payment, for the seller's queue. */
export function methodLabel(method) {
  return { esewa: 'eSewa', khalti: 'Khalti', imepay: 'IME Pay', bank: 'bank transfer', other: 'other' }[method] || 'not said';
}

/**
 * A member's own line on the storefront: their tier, and whether it is current.
 * Used for the badge next to a name, so the badge and the roster cannot disagree.
 */
export function memberBadge({ membership, tiers = [], now = new Date() } = {}) {
  const state = membershipState(membership, now);
  const tier = tierByNo(tiers, membership?.tier_no) ?? null;
  const name = tier?.name || defaultTierName(membership?.tier_no);
  return { state, tier: name, tierNo: Number(membership?.tier_no) || 1, plate: plateStyle(membership?.tier_no) };
}
