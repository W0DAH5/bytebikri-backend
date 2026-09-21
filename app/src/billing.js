/**
 * Billing — the only two things bytebikri charges for.
 *
 *   1. A store upgrade. A subscription, pro-rated to the end of the current
 *      period, and the only thing that unlocks a paid capability.
 *   2. Annual rent for the platform's one ad slot. Priced off the traffic the
 *      platform actually brought, on the channel's own anniversary.
 *
 * That is the whole revenue model, and this file is where it is arithmetic
 * instead of a claim. Everything else is explicitly NOT charged:
 *
 *   - no cut of what the seller earns. The ad networks pay the seller's own
 *     account directly; bytebikri is not in that path and 0% is not a rate, it
 *     is an absence of a mechanism.
 *   - no commission on a sale, because there is no sale. Content is unlocked
 *     with attention, not money.
 *   - no listing fee, no take-rate, no per-download charge, no "platform fee".
 *
 * Two consequences worth stating because they shape the code:
 *
 *   A ZERO INVOICE IS NORMAL. Rent is a share of value the platform created, so
 *   a store with no traffic owes nothing. The floor exists so a quiet store is
 *   never billed into difficulty — which is also why a store below the
 *   three-slot threshold is never issued an invoice at all.
 *
 *   THERE IS NO CARD PROCESSOR. No acquirer settles to a Nepal entity for this
 *   shape of business, so payment is a transfer to the operator's own account
 *   and a reference submitted here, matched by hand against the statement. That
 *   is a real limitation and the UI says so rather than showing a fake checkout.
 */

/** The rails a seller can actually use from Nepal. Order is preference order. */
export const RAILS = [
  { id: 'esewa', label: 'eSewa', env: 'PAY_ESEWA_ID', hint: 'Mobile wallet ID (98…) or the merchant code.' },
  { id: 'khalti', label: 'Khalti', env: 'PAY_KHALTI_ID', hint: 'Mobile wallet ID (98…) or the merchant code.' },
  { id: 'imepay', label: 'IME Pay', env: 'PAY_IMEPAY_ID', hint: 'Wallet ID or the registered mobile number.' },
  { id: 'bank', label: 'Bank transfer', env: 'PAY_BANK_ACCOUNT', hint: 'Account number, then the reference on the slip.' },
  { id: 'other', label: 'Something else', env: null, hint: 'Describe it in the reference — an operator will find it.' },
];

/**
 * Where the money goes, from the environment.
 *
 * Deliberately not hardcoded and deliberately not guessed. An unset rail is
 * shown as "not configured" with the variable name, because the alternative —
 * a placeholder account number on a payment page — is how someone sends money
 * to a stranger.
 */
export function railDetails(env = process.env) {
  return RAILS.map((r) => ({
    ...r,
    handle: r.env ? (env[r.env] || '').trim() || null : null,
    ready: r.env ? Boolean((env[r.env] || '').trim()) : true,
  }));
}

/**
 * Are any rails usable? Until one is, the billing page says so at the top.
 *
 * `other` is excluded on purpose: "something else" has no account to pay into,
 * so counting it would mark the page ready on a server where a seller has
 * nowhere to send money — which is exactly the state this check exists to catch.
 */
export const railsReady = (env = process.env) =>
  railDetails(env).some((r) => r.ready && r.id !== 'other');

/** The operator's own display name, for "pay to …". */
export function payeeName(env = process.env) {
  return (env.OPERATOR_LEGAL_NAME || '').trim() || (env.OPERATOR_NAME || '').trim() || null;
}

// ---------------------------------------------------------------------------
// Rent
// ---------------------------------------------------------------------------

/**
 * The rent period a channel is currently in, on its own anniversary.
 *
 * Not the calendar year: a store that opened in March is not billed for a
 * January it did not exist in, and a store that opened in December would
 * otherwise get two months and then a bill. Returns plain `YYYY-MM-DD` strings,
 * because they are stored as `date` and a timezone is not part of a billing
 * period.
 */
export function rentPeriod(createdAt, now = new Date()) {
  const start = createdAt ? new Date(createdAt) : now;
  const anchor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));

  // Same date this year if it has already passed, otherwise last year's.
  let from = new Date(anchor);
  from.setUTCFullYear(now.getUTCFullYear());
  if (from > now) from.setUTCFullYear(now.getUTCFullYear() - 1);

  const to = new Date(from);
  to.setUTCFullYear(from.getUTCFullYear() + 1);
  return { start: iso(from), end: iso(to) };
}

const iso = (d) => d.toISOString().slice(0, 10);

/**
 * What a year of rent costs, from the trailing-traffic estimate.
 *
 * The estimate is a MONTHLY figure — one rent slot's share of thirty days of
 * pageview value — so a year is twelve of them. Rounded to the nearest rupee,
 * because a bill with paisa in it is a bill nobody can pay exactly.
 *
 * An empty platform slot means zero. That is policy rule 2 doing its job: a
 * page with fewer than three slots is too short to spare one, so it is not
 * taxed, and the amount is honestly 0 rather than a minimum charge invented
 * here.
 */
export function annualRentNpr(estimate) {
  if (!estimate || !estimate.rent || !estimate.estNpr) return 0;
  return Math.max(0, Math.round(estimate.estNpr * 12));
}

/** An invoice's own arithmetic, in the order a person would check it. */
export function rentWorking(estimate, amountNpr) {
  return {
    pageviews30d: estimate?.pageviews30d ?? 0,
    slotsOnPage: estimate?.total ?? 0,
    rentSlots: estimate?.rent ?? 0,
    assumedRpmUsd: estimate?.rpmUsd ?? null,
    estMonthlyNpr: estimate?.estNpr ?? 0,
    months: 12,
    amountNpr,
  };
}

// ---------------------------------------------------------------------------
// Subscriptions
// ---------------------------------------------------------------------------

/**
 * What an upgrade costs today, explained.
 *
 * Pro-rated to the end of the period already paid for, so the next charge stays
 * predictable. The seller sees the days remaining and the full difference as
 * well as the amount, because a pro-rated number that arrives unexplained looks
 * like an arbitrary one.
 */
export function upgradeExplanation(quote, { nprFmt = (n) => `NPR ${Number(n).toLocaleString('en-IN')}` } = {}) {
  if (!quote) return null;
  return {
    fromPlan: quote.from.name,
    toPlan: quote.to.name,
    daysLeft: quote.daysLeft,
    fullDifference: quote.fullDifference,
    amountNpr: quote.amountNpr,
    lines: [
      `${quote.to.name} costs ${nprFmt(quote.to.priceNpr)} a year.`,
      `You are on ${quote.from.name}, which is ${quote.from.priceNpr === 0 ? 'free' : nprFmt(quote.from.priceNpr) + ' a year'}.`,
      quote.daysLeft > 0
        ? `You have ${quote.daysLeft} day${quote.daysLeft === 1 ? '' : 's'} left in the period you have paid for, so today's amount is the difference pro-rated to it.`
        : 'No period is running yet, so today\'s amount is the full difference.',
      'Your renewal date does not move. The next charge is the full price, on the same date as before.',
    ],
  };
}

/**
 * What a plan includes, in sentences rather than a capability map.
 *
 * `availableSlots` is how many positions the product actually has today. A plan
 * whose header says "8 ad slots" while the storefront can only render five is
 * selling something that does not exist yet, so the sentence says "every web
 * position there is today" instead — the tier still costs the same, and the
 * seller is told what they are getting rather than what the JSON says.
 */
export function planBenefits(plan, { availableSlots = null } = {}) {
  const c = plan.capabilities;
  const out = [];
  out.push(c.max_assets === -1 ? 'Unlimited published files' : `Up to ${c.max_assets} published files`);
  out.push(availableSlots && availableSlots < c.slot_count
    ? `${availableSlots} ad slots on your pages — every web position there is today`
    : `${c.slot_count} ad slots on your pages`);
  out.push(c.marketplace_listed
    ? 'Explore listing, if you want it — bytebikri brings the traffic'
    : 'Your own address only — free forever');
  // -1 is "unlimited", the same convention as max_assets. Printing the -1 was
  // the kind of detail that makes a pricing page look unfinished.
  out.push(c.custom_sections === -1 ? 'Unlimited custom sections on your storefront'
    : c.custom_sections ? `${c.custom_sections} custom sections on your storefront`
      : 'A standard storefront layout');
  if (c.theme_custom === true) out.push('Custom theme');
  if (c.verified_badge) out.push('A verified-seller badge once your documents are checked');
  if (c.analytics_level !== 'basic') out.push(`Analytics: ${c.analytics_level}`);
  return out;
}

/**
 * How full a plan is — one function, three surfaces.
 *
 * The seller's Plan panel, the operator's plans page and the message a seller
 * reads when an upload is refused all need to say the same thing about the same
 * account, and the only way to guarantee that is for all three to ask the same
 * function. Two of them deriving "14 of 20" independently is how one ends up
 * counting drafts and the other counting live files, and the seller gets told
 * they have room when the next upload will bounce.
 *
 * Three states, because each has a different next action: nothing, prepare, and
 * act. The researched shape is a running count shown BEFORE the wall — a person
 * who is cut off with no warning reads it as the product failing rather than
 * their usage filling up.
 *
 * `null` limit means unlimited and never reports a level, because "0% of
 * unlimited" is a sentence that helps nobody.
 */
export function planUsage({ plan, files = 0, slots = null }) {
  const limit = plan?.capabilities?.max_assets;
  const slotLimit = plan?.capabilities?.slot_count ?? null;
  const used = Math.max(Number(files) || 0, 0);

  const filesState = (limit === undefined || limit === null || limit === -1)
    ? { limit: null, used, remaining: null, ratio: null, level: 'unlimited', label: `${used} published — unlimited on ${plan?.name || 'this plan'}` }
    : (() => {
      const remaining = Math.max(limit - used, 0);
      const ratio = limit ? used / limit : 1;
      // 80% is where a person can still do something about it. Below that, a
      // progress bar is noise on a dashboard; at 100% it is an instruction.
      const level = used >= limit ? 'at' : ratio >= 0.8 ? 'near' : 'ok';
      return { limit, used, remaining, ratio, level, label: `${used} of ${limit} published` };
    })();

  return {
    files: filesState,
    slots: (slotLimit === null || slots === null)
      ? null
      : { limit: slotLimit, used: Math.max(Number(slots) || 0, 0), remaining: Math.max(slotLimit - (Number(slots) || 0), 0), level: (Number(slots) || 0) >= slotLimit ? 'at' : 'ok' },
    // The single sentence a surface should print. Kept here so the dashboard, the
    // operator page and the refusal message cannot drift apart in wording either.
    sentence: filesState.level === 'unlimited'
      ? `${filesState.used} published files. ${plan?.name || 'This plan'} has no file limit.`
      : filesState.level === 'at'
        ? `${filesState.used} of ${filesState.limit} published files — this plan is full.`
        : filesState.level === 'near'
          ? `${filesState.used} of ${filesState.limit} published files — ${filesState.remaining} left on ${plan?.name}.`
          : `${filesState.used} of ${filesState.limit} published files.`,
  };
}

/**
 * Where the database and the running app disagree about a plan.
 *
 * `plans` in the database and the PLANS constant in code are two descriptions of
 * the same thing, and only the constant is enforced: `store.plan()` resolves from
 * JS, and the table is read by nothing but an existence check. Editing the table
 * therefore looks like it changes a limit and changes nothing — a trap with no
 * symptom, which is the worst kind.
 *
 * Both catalogs are passed in rather than imported, so this is testable without
 * booting a server and so there is exactly one caller-side decision about which
 * copy is authoritative (the code is; the table is what a person will try to
 * edit).
 *
 * Returns sentences, not codes: this list is shown to an operator, and
 * "store.marketplace_listed: table says false, the app enforces true" is the
 * sentence that lets somebody fix it in one edit.
 */
export function planDrift(dbPlans = [], appPlans = {}) {
  const out = [];
  for (const row of dbPlans) {
    const app = appPlans[row.code];
    if (!app) { out.push(`the table has a plan "${row.code}" that the running app does not know about`); continue; }
    if (Number(row.price_npr) !== app.priceNpr) {
      out.push(`${row.code}: the table says NPR ${row.price_npr}, the app charges NPR ${app.priceNpr}`);
    }
    for (const [key, tableValue] of Object.entries(row.capabilities || {})) {
      const appValue = app.capabilities[key];
      if (appValue !== tableValue) {
        out.push(`${row.code}.${key}: the table says ${JSON.stringify(tableValue)}, the app enforces ${JSON.stringify(appValue)}`);
      }
    }
  }
  for (const code of Object.keys(appPlans)) {
    if (!dbPlans.some((p) => p.code === code)) out.push(`the app has a plan "${code}" that is not in the table`);
  }
  return out;
}

/** The four things the seller is NOT being charged for. Stated, not implied. */
export const NOT_CHARGED = [
  'Your ad earnings. The networks pay your own account directly — bytebikri takes 0% and never holds it.',
  'Selling. There is no price on a file, no checkout and no commission, because no money changes hands for content.',
  'Publishing. Free stores publish their own files at their own address, with no listing fee and no time limit.',
  'Downloads and unlocks. A thousand unlocks cost you the same as one.',
];
