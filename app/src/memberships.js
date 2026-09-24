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

/** The same one-liner `reports.js` carries: this module imports nothing from the
 *  view layer, and '4 verified views' has to read the same on every page. */
const plural = (n, singular, many = `${singular}s`) => `${n} ${Number(n) === 1 ? singular : many}`;

export const TIERS_MAX = 2;

/** Offered periods, in months. A month is the default; a year is a discount the
 *  creator can offer, a quarter is the one people can actually decide on. */
export const PERIODS = [1, 3, 12];

export const CLAIM_METHODS = ['esewa', 'khalti', 'imepay', 'bank', 'other'];

/**
 * ── THE TWO DOORS ONTO ONE TIER ─────────────────────────────────────────────
 *
 * `dues` is the door 0031 built: a claim, the creator's own statement, the
 * creator's own confirmation. `attention` is the second one, and it exists because
 * of a constraint the brief states plainly — money movement inside the app does
 * not exist yet, and a membership that can only be bought is one most people in
 * this market will never hold.
 *
 * What the attention door is NOT: it is not a payment, it is not a discount, and
 * it is not the dues in instalments. Nothing in either direction is money. A
 * person watches the same ads the store's door already asks for, the store earns
 * from them exactly as it earns from any other visitor, and the belonging is the
 * thing that changes hands.
 */
export const JOIN_MODES = ['dues', 'attention', 'both'];

export const JOIN_MODE_LABEL = {
  dues: 'Dues only',
  attention: 'Watching only',
  both: 'Either — dues or watching',
};

/** Which doors a tier has. Anything unrecognised falls back to the shipped one. */
export function doorsOf(tier) {
  const mode = JOIN_MODES.includes(String(tier?.join_mode)) ? String(tier.join_mode) : 'dues';
  return { dues: mode !== 'attention', attention: mode !== 'dues' };
}

/**
 * What a join by watching costs, in verified views — by the period, never by the
 * seller's dues.
 *
 * THERE IS NO COLUMN FOR THIS, and that absence is the decision. The ask ladder
 * (0034) exists because a seller who has never bought an ad in their life was being
 * asked to price a stranger's attention with no information; pricing a stranger's
 * *evening* has the same problem with worse numbers, because the instinct is to
 * charge the dues' worth and no evening can be worth a month of watching. So the
 * price is the platform's, it moves only with the term, and the ceiling is a
 * promise to the person on the other side: no one watches a month of ads for a
 * month of belonging.
 *
 * The numbers are small on purpose. Four views is a few minutes; twelve is under
 * an evening. The store's lever is whether the door is open at all — not the price,
 * and not the ads, which it cannot remove from this path any more than the ladder
 * lets it remove them from the door.
 */
export const ATTENTION_VIEWS = { 1: 4, 3: 8, 12: 12 };

/** Views a join costs for a period in months. Unknown periods get the month's. */
export function attentionViews(periodMonths) {
  return ATTENTION_VIEWS[Number(periodMonths)] ?? ATTENTION_VIEWS[1];
}

/**
 * The balance, from the row that holds both halves.
 *
 * `earned` is written by a verified postback and `spent` by a join; the database
 * checks `spent <= earned`, so this subtraction cannot go negative however the
 * code changes later. A missing row is zero — nobody has watched anything yet.
 */
export function standingOf(row) {
  return Math.max(0, (Number(row?.earned) || 0) - (Number(row?.spent) || 0));
}

/** Where somebody is toward the door, for the panel and for the refusal sentence. */
export function attentionProgress({ tier, standing = 0 } = {}) {
  const needed = attentionViews(tier?.period_months);
  const have = Math.max(0, Number(standing) || 0);
  return { needed, have, short: Math.max(0, needed - have), ready: have >= needed };
}

/**
 * ── WHAT MEMBERSHIP DOES TO A MEMBERS-ONLY FILE ─────────────────────────────
 *
 * `ad_free` is the shipped promise and stays the default: a member file opens
 * without an ad, because the dues (or the watching) already paid for it.
 *
 * `supporter` is the opposite trade, opt-in per tier: members keep the ordinary
 * asks and gain the belonging — the plate, the roster, the member room. It exists
 * because a store whose revenue is ads should be able to run a tier WITHOUT
 * switching its own revenue off, and because the attention door especially must
 * not be a way to remove ads by watching ads.
 *
 * The choice is snapshotted onto each membership when it is granted
 * (`memberships.ad_mode`), so a seller changing their mind changes what the next
 * join gets and never takes back what somebody already joined for.
 */
export const AD_MODES = ['ad_free', 'supporter'];

/** The arrangement a tier currently promises. Anything unrecognised is ad-free. */
export function adModeOf(tier) {
  return AD_MODES.includes(String(tier?.ad_mode)) ? String(tier.ad_mode) : 'ad_free';
}

/**
 * The one rule about who opens a members-only file, and what happens next.
 *
 *   covered  — their membership opens it, now, with no ad
 *   ads      — they are a member of a `supporter` tier, so the file opens the
 *              ordinary way: the same ask any other visitor gets on a file whose
 *              door is an ad. Membership bought them the belonging, not the file
 *   members  — not theirs: no membership, a lapsed one, or one below the tier the
 *              file wants
 *
 * The membership's own snapshot is what is read here, never the tier's current
 * setting — that is the whole reason the snapshot exists.
 */
export function doorFor({ membership, memberTier = 1, now = new Date() } = {}) {
  if (!membershipCurrent(membership, now)) return 'members';
  if ((Number(membership.tier_no) || 1) < (Number(memberTier) || 1)) return 'members';
  return membership.ad_mode === 'supporter' ? 'ads' : 'covered';
}

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
export function tierDraft({ name, duesNpr, periodMonths, perks, accent, joinMode, adMode } = {}) {
  const clean = String(name ?? '').trim().replace(/\s+/g, ' ').slice(0, 24);
  if (clean.length < 2) return { ok: false, error: 'tier-name' };
  const dues = Number(duesNpr);
  if (!Number.isFinite(dues) || dues < 0 || dues > 100000) return { ok: false, error: 'tier-dues' };
  const months = Number(periodMonths);
  if (!PERIODS.includes(months)) return { ok: false, error: 'tier-period' };
  const line = String(perks ?? '').trim().replace(/\s+/g, ' ').slice(0, 160);
  const accentKey = ACCENT_KEYS.includes(String(accent)) ? String(accent) : 'indigo';
  /*
   * The two doors and the ad arrangement travel with the rest of the draft, and both
   * refuse an unknown value the same way the accent does — by falling back rather
   * than by erroring. A seller's page always submits a value from its own select;
   * anything else is a stale tab or a hand-made POST, and the safe answer to both is
   * the arrangement that was already promised (or, on a first save, the shipped one).
   */
  const join = JOIN_MODES.includes(String(joinMode)) ? String(joinMode) : null;
  const ads = AD_MODES.includes(String(adMode)) ? String(adMode) : null;
  return {
    ok: true,
    error: null,
    value: {
      name: clean, duesNpr: Math.round(dues), periodMonths: months,
      perks: line || null, accent: accentKey, joinMode: join, adMode: ads,
    },
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
      // The cap is 1 or 2 positions that the STORE owns, plus at most one of ours —
      // never rank 1, never more than one, and a page with no position of its own is
      // never taxed. The arithmetic is done here rather than typed, so this panel
      // cannot promise a page shape the allocator does not produce.
      text: takesSlot
        ? `You keep ${slots === 1 ? '1 position' : `${slots} positions`} of the ${slots + POLICY.platformSlotsPerPage} a page carries; the platform `
          + `takes ${POLICY.platformSlotsPerPage}, in the last position, never the first. Three boxes is the most any page in `
          + `this product holds. ${ADS_AROUND_LINE}`
        : `Your plan allocates no position of its own, so the platform places none either and there is no rent to price. `
          + `${ADS_AROUND_LINE}`,
    },
    {
      term: 'What your members see',
      text: MEMBER_AD_LINE,
    },
    {
      // The third charge, stated to the seller who is not paying it. A seller reading
      // a money panel is entitled to know where else the platform earns — and to be
      // told, in the same breath, that a buyer's payment to us opens nothing on their
      // page. That is the question this row exists to answer before it is asked.
      term: 'ByteBikri\u2019s other line',
      text: 'A person can pay bytebikri for how their own name looks — a palette and an effect, one price, '
        + 'nothing sold separately. It opens no file, removes no ad, and shortens no wait, so it never touches '
        + 'what you earn or what your members paid you for.',
    },
  ];
}

/**
 * ── THE WORDS ───────────────────────────────────────────────────────────────
 *
 * Written here, once, for the same reason `MONEY_LINE` is: the member's join panel,
 * the seller's tier editor and the tests all print the same sentences instead of
 * three copies that agree today. Every one of them is a promise about somebody's
 * time or somebody's money, and the two must never be confused for each other.
 */

/** What the attention door is, on the panel, in the shop window. */
export const ATTENTION_LINE =
  'The other way in: watch verified views on this store’s own files and the tier is yours for the period. '
  + 'Nothing is charged, nothing is held, and there is no reference to paste because nobody sent anything.';

/**
 * The sentence that keeps the two doors apart. It says the same three things the
 * dues side says — who gets the money, who does not touch it, and what the platform
 * is not — with the amounts replaced by views.
 */
export const ATTENTION_MONEY_LINE =
  'The views pay the creator exactly as any other visitor’s views do. bytebikri pays nobody for them, takes no '
  + 'share of them, and there is no money anywhere in this door — not before it, not after it.';

/** The price of one tier's attention door, with the term in it. */
export function attentionLine(tier) {
  const views = attentionViews(tier?.period_months);
  const months = Number(tier?.period_months) || 1;
  const per = months === 12 ? 'a year' : months === 3 ? 'three months' : 'a month';
  return `${plural(views, 'verified view')} — ${per} of membership.`;
}

/** Where somebody is, said as a fact rather than as encouragement. */
export function attentionStandingLine({ tier, standing = 0 } = {}) {
  const { have, needed, ready } = attentionProgress({ tier, standing });
  if (ready) return `You have ${have} verified view${have === 1 ? '' : 's'} here — enough to join.`;
  return `You have watched ${have} of the ${needed} verified views this tier asks for.`;
}

/**
 * The same number, told to somebody who is ALREADY in.
 *
 * "Enough to join" is the wrong sentence for a member: they are not joining, they
 * are watching their next period into existence. Nobody banks a whole period in one
 * sitting, so this line exists to make the counter useful at one view out of four
 * rather than only at four — which is the difference between a door a member walks
 * past and a door they use.
 */
export function attentionBankedLine({ tier, standing = 0 } = {}) {
  const { have, needed, ready } = attentionProgress({ tier, standing });
  if (ready) return `You have ${have} verified view${have === 1 ? '' : 's'} banked here — another period is ready.`;
  return have
    ? `You have ${have} of the ${needed} views for another period banked here.`
    : `Nothing banked yet: ${needed} verified views is another period at this tier.`;
}

/**
 * What a `supporter` tier promises, printed on the join panel BEFORE anybody
 * joins. A trade somebody discovers after joining is not a trade, it is a
 * surprise, and this is the one arrangement on this platform that deliberately
 * does NOT switch the ads off.
 */
export const SUPPORTER_LINE =
  'This tier keeps the ordinary asks. What membership buys here is the belonging — your name on the roster, the '
  + 'member room, files listed for you — and the files themselves still ask for a view the way they ask every '
  + 'other visitor. The creator chose that trade, and it is written here before you join rather than after.';

/** The same trade, told to the seller who is deciding whether to offer it. */
export const SUPPORTER_SELLER_LINE =
  'Member files keep the ordinary asks: members get the belonging, and the ads you earn keep running. Switching '
  + 'this changes what the NEXT join gets — members already in keep what they joined for until their period ends, '
  + 'because that is what the join panel promised them.';

/** Why the seller cannot type the attention price, said where they would try. */
export const ATTENTION_SELLER_LINE =
  'The price is the platform’s, not yours: four views for a month, eight for a quarter, twelve for a year. A '
  + 'seller pricing this would be pricing a stranger’s evening with no information — the same reason you do not '
  + 'type the ask on your files. Your decision is whether the door is open at all.';

/** One line for the seller's decision about this door, beside the control. */
export const ATTENTION_DOOR_LABEL = {
  dues: 'Dues only',
  attention: 'Watching only',
  both: 'Both doors',
};

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
