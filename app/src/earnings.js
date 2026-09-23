/**
 * Earning, and who is holding the money.
 *
 * This module exists because of one sentence in the product's own rules:
 * **bytebikri does not touch a creator's ad earnings.** The network pays the
 * creator's own account directly. bytebikri is not in that path, takes 0%, and
 * never holds a balance — which also means there is no withdrawal button to
 * build, no minimum to enforce, and no payout run to operate.
 *
 * What is left to do, and what this file is:
 *
 *   1. Say where the money goes, in the place where a creator looks for it. An
 *      earnings page that shows a number and no counterparty is how a platform
 *      ends up with a user who believes the number is a balance.
 *   2. Compare OUR estimate with the NETWORK'S report. Ours is arithmetic
 *      (`views × assumed RPM`); theirs is the statement. When they disagree, the
 *      network is right — and the disagreement matters because the same traffic
 *      model prices the rent. A creator who can show our estimate is 3× the
 *      statement is a creator who can argue about their rent with evidence.
 *   3. Never present either number as money we owe. There is no third state.
 *
 * The comparison is deliberately conservative about periods: a month the network
 * has not closed yet is marked partial and excluded from the verdict, because
 * "our estimate is higher than your statement" is a false alarm when the
 * statement simply stops before the month does.
 */

/** @typedef {{ period_start: string, period_end: string, reported_usd: number }} Report */

/** Today, in the timezone a billing period is not in — dates here are dates. */
const iso = (d) => new Date(d).toISOString().slice(0, 10);

/**
 * How many days of a period have actually happened.
 *
 * The whole point is to avoid comparing a closed month against a partial one.
 * The window ends today, so a period whose end is in the future is partial, and
 * so is a period that started yesterday.
 */
export function periodStatus(periodEnd, { now = new Date() } = {}) {
  const end = iso(periodEnd);
  const today = iso(now);
  if (end >= today) return { closed: false, daysShort: null };
  const short = Math.round((Date.parse(today) - Date.parse(end)) / 86400000);
  // A network closes its books a few days after the month ends. Treating the last
  // week as settled is a claim we cannot make.
  return { closed: short > 5, daysShort: short };
}

/**
 * One provider's line: what we counted, what they reported, and the gap.
 *
 * `views` and `estimateUsd` are ours. `reportedUsd` is the sum of what the
 * creator entered, over CLOSED periods only — a partial month is shown but not
 * counted, and the number of excluded rows is returned so the page can say so
 * rather than silently dropping them.
 */
/**
 * How many months of statement the closed periods add up to.
 *
 * Counted in days against a 365.25/12 month, so a 31-day month is one month and
 * a quarter is three — close enough for a ratio a human reads, and derived from
 * the dates the creator entered rather than assumed.
 */
export function closedMonths(reports = [], now = new Date()) {
  const DAYS_PER_MONTH = 30.44;
  return reports.reduce((sum, r) => {
    if (!periodStatus(r.period_end, { now }).closed) return sum;
    const days = Math.round((Date.parse(iso(r.period_end)) - Date.parse(iso(r.period_start))) / 86400000) + 1;
    return sum + Math.max(0, days) / DAYS_PER_MONTH;
  }, 0);
}

export function providerLine({
  providerId, providerName = null, views = 0, estimateUsd = 0,
  postbackUsd = 0, reports = [], rpmUsd = 0.2, connected = false, now = new Date(),
}) {
  let reported = 0;
  let counted = 0;
  let excluded = 0;
  let latest = null;

  for (const r of reports) {
    const status = periodStatus(r.period_end, { now });
    if (!status.closed) { excluded += 1; continue; }
    reported += Number(r.reported_usd) || 0;
    counted += 1;
    const start = iso(r.period_start);
    if (!latest || start > latest) latest = start;
  }

  const gap = counted ? reported - estimateUsd : null;
  const gapPct = counted && reported > 0 ? (gap / reported) * 100 : null;

  return {
    providerId,
    providerName: providerName || providerId,
    connected,
    views,
    estimateUsd: round4(estimateUsd),
    // What arrived IN the signed postbacks, if the network sends per-view
    // revenue at all. Most settle in a portal monthly, so this is often zero
    // while real money was earned — which is exactly why it is never shown as
    // the earnings figure.
    postbackUsd: round4(postbackUsd),
    rpmUsd,
    reported: counted ? round4(reported) : null,
    periodsCompared: counted,
    periodsExcluded: excluded,
    latestPeriod: latest,
    gap: gap === null ? null : round4(gap),
    gapPct: gapPct === null ? null : Math.round(gapPct),
    verdict: gapVerdict({ counted, reported, estimateUsd, gapPct }),
  };
}

/**
 * What the gap means, and what to do about it.
 *
 * Direction matters both ways:
 *
 *   we over-count — our estimate is above the statement. Either the assumed RPM
 *     is too high or the views are inflated. This is the dangerous direction,
 *     because rent is priced off the same model: the creator is being charged
 *     from a number that is too large.
 *   we under-count — our estimate is below the statement. The creator is being
 *     under-sold on their own performance and the rent is too cheap. Nothing is
 *     broken for them, but the pricing is not describing the business.
 *
 * A 15% band is called "consistent": an estimate is an estimate, and a page that
 * cries about 4% is a page nobody reads twice.
 */
export function gapVerdict({ counted = 0, reported = 0, estimateUsd = 0, gapPct = null }) {
  if (!counted) {
    return {
      level: 'no_report',
      headline: 'Nothing to compare yet',
      detail: 'Our estimate is arithmetic: completed views × an assumed rate. Paste one closed period from your statement and the two numbers appear side by side.',
    };
  }
  if (reported === 0 && estimateUsd > 0) {
    return {
      level: 'disagree',
      headline: 'Our estimate says you earned something; the statement says nothing',
      detail: 'That usually means a delivery problem at the network, a payment threshold that has not been crossed, or a provider whose reports we are not seeing. Worth checking the statement directly.',
    };
  }
  if (gapPct !== null && Math.abs(gapPct) <= CONSISTENT_BAND_PCT) {
    return {
      level: 'consistent',
      headline: 'Our estimate matches your statement closely',
      detail: `Within ${Math.abs(gapPct)}% over ${counted} period${counted === 1 ? '' : 's'}. The assumed rate used for estimates, and for pricing rent, is describing your traffic honestly.`,
    };
  }
  if (estimateUsd > reported) {
    return {
      level: 'we_over',
      headline: 'Our estimate is higher than your statement',
      detail: 'We are counting more value than you were paid. Rent is priced from the same model, so this is the direction that matters: tell us and the assumed rate for your store gets corrected.',
    };
  }
  return {
    level: 'we_under',
    headline: 'Your statement is higher than our estimate',
    detail: 'You are earning more than our model credits you with. Nothing is broken for you, and the rent — priced from that same model — is cheaper than it would be if we priced it off the statement.',
  };
}

/**
 * One statement row, judged for the OPERATOR rather than for the seller.
 *
 * The seller's `gapVerdict` answers "should I trust the number on my page". This
 * answers "is the rate the whole platform prices from still right", and the two
 * disagree in one case that matters: a statement covering a window in which we
 * recorded no accepted callback at all. For the seller that is a delivery
 * problem worth chasing; for the operator the honest answer is that there is no
 * rate to derive from it — our estimate is zero on that window BY CONSTRUCTION,
 * not because the model is wrong. Calling that "we under-count" would send
 * somebody to change a rate that was never measured.
 */
/**
 * How far our estimate may sit from a statement and still be called consistent.
 *
 * Named, exported and used in all three places that decide it — the row state,
 * the seller's per-statement verdict, and the operator's platform verdict. The
 * number was written out three times as `15` and `0.15` before this turn, which
 * is how a threshold ends up meaning different things on two pages that are
 * supposed to agree about the same traffic.
 */
export const CONSISTENT_BAND_PCT = 15;

export function calibrationRowState(row) {
  const views = Number(row.views) || 0;
  const reported = Number(row.reported_usd) || 0;
  const estimate = Number(row.estimate_usd) || 0;
  if (!row.periods) return { state: 'none', label: 'No settled period', tone: '' };
  if (views === 0) {
    return {
      state: 'no_views',
      label: 'Nothing to measure',
      tone: 'warn',
      // The reason is not "the model is wrong" but "we have no events in this
      // window", and the two lead to different work.
      why: reported > 0
        ? 'The statement covers a window in which no accepted ad callback was recorded, so there is no rate to derive.'
        : 'No views and no reported revenue: nothing happened here.',
    };
  }
  // Only rows with views can carry a rate, so only they can be compared.
  const implied = Number(row.implied_rpm_usd);
  const gapPct = reported > 0 ? Math.round(((estimate - reported) / reported) * 100) : null;
  return {
    state: 'measurable',
    label: 'Measurable',
    tone: '',
    impliedRpmUsd: Number.isFinite(implied) ? implied : null,
    gapPct,
    // The one place "is this rate contradicted" is answered. A caller counting
    // contradicted rows must not re-implement the band.
    contradicted: gapPct !== null && Math.abs(gapPct) > CONSISTENT_BAND_PCT,
    why: `Over the same window: our estimate $${estimate.toFixed(4)} at the assumed rate, their statement $${reported.toFixed(2)}.`,
  };
}

/**
 * What the platform should conclude from every statement on file.
 *
 * The output is deliberately two things rather than one: a DIRECTION (is the
 * assumed rate too high or too low) and a CONFIDENCE (how much evidence is
 * behind it). Reporting a rate off one store as if it were a measurement is the
 * failure mode this function exists to prevent — the first store that reports is
 * a signal, three quarters of stores reporting is a measurement, and the copy has
 * to say which one it is holding.
 */
export function calibrationVerdict({ rows = [], assumedRpmUsd = 0.2, rates = null } = {}) {
  const assumed = Number(assumedRpmUsd) || 0;
  const measure = rows.filter((r) => calibrationRowState(r).state === 'measurable');
  const noViews = rows.filter((r) => calibrationRowState(r).state === 'no_views');

  const totalViews = measure.reduce((a, r) => a + (Number(r.views) || 0), 0);
  const totalReported = measure.reduce((a, r) => a + (Number(r.reported_usd) || 0), 0);
  const totalEstimate = measure.reduce((a, r) => a + (Number(r.estimate_usd) || 0), 0);
  const periods = measure.reduce((a, r) => a + (Number(r.periods) || 0), 0);
  const stores = new Set(measure.map((r) => r.channel_id || r.channel_slug)).size;
  const implied = totalViews > 0 ? totalReported / (totalViews / 1000) : null;
  const coverage = rates?.payingStores ?? null;

  const base = {
    assumedRpmUsd: assumed,
    impliedRpmUsd: implied === null ? null : round4(implied),
    totalViews,
    totalReported: round4(totalReported),
    totalEstimate: round4(totalEstimate),
    periods,
    stores,
    noViewRows: noViews.length,
    // Ratio of what the statements imply to what we assume. 2 means we assume
    // twice the rate the money actually arrived at.
    ratio: implied === null || assumed === 0 ? null : round4(implied / assumed),
    coverage,
  };

  if (!rows.length) {
    return {
      ...base,
      level: 'no_statements',
      confidence: 'none',
      headline: 'No creator has recorded a statement yet',
      detail: 'Our estimate is arithmetic: completed views × an assumed rate. It can only be corrected against the '
        + 'network\'s own numbers, and those arrive in the portal the creator signs into — we are not party to the payment, '
        + 'so we can never fetch them ourselves. Until somebody pastes one, the assumed rate is unchecked.',
    };
  }
  if (!measure.length) {
    return {
      ...base,
      level: 'not_measurable',
      confidence: 'none',
      headline: 'A statement is on file, and no rate can be derived from it',
      detail: `${rows.length} statement${rows.length === 1 ? '' : 's'} recorded, but no accepted ad callback fell inside `
        + `${rows.length === 1 ? 'its window' : 'their windows'} — so our side of the comparison is zero by construction, `
        + 'not because the model is wrong. That is a delivery question: the connections page shows whether callbacks are '
        + 'arriving at all.',
    };
  }

  // The classification is done on the same comparison every other surface shows —
  // our estimate against their reported dollars over the identical window — and
  // through the same band. Computing the level from the implied RATE while the
  // rows and their chips use the DOLLAR gap put two denominators on one screen:
  // at the edge, a row could chip "we estimate higher" while the verdict above it
  // read "consistent", and both were "15%". One comparison, one band, one story.
  const dollarGapPct = totalReported > 0
    ? ((totalEstimate - totalReported) / totalReported) * 100
    : null;
  // A statement that reports nothing has no percentage to take: the fallback to
  // the rate comparison keeps that case classified as it was (we assume more than
  // arrived), rather than falling through to "consistent" because 0 has no gap.
  const off = dollarGapPct !== null
    ? Math.abs(dollarGapPct) / 100
    : (implied !== null && assumed > 0 ? Math.abs(implied - assumed) / assumed : null);
  // Confidence is about evidence, not direction: it is reported for every level.
  const confidence = periods >= 12 && stores >= 3 ? 'broad'
    : (periods >= 3 && stores >= 2) ? 'narrow' : 'single';

  const hedge = confidence === 'broad' ? ''
    : confidence === 'narrow'
      ? ' This rests on a handful of periods, so treat it as a direction rather than a measurement.'
      : ` This rests on ${periods} period${periods === 1 ? '' : 's'} from ${stores} store${stores === 1 ? '' : 's'} — a signal, not a measurement.`;

  if (off === null || off * 100 <= CONSISTENT_BAND_PCT) {
    return {
      ...base, level: 'consistent', confidence,
      headline: 'The statements are consistent with the rate we assume',
      detail: `Our estimate is within ${CONSISTENT_BAND_PCT}% of what the networks reported across ${periods} settled `
        + `period${periods === 1 ? '' : 's'}.${hedge}`,
    };
  }
  if (implied === null || implied === 0) {
    // Neither a dollar gap nor a rate to divide by: a statement of zero against
    // traffic we counted is a delivery question, not a pricing one, and
    // "the statements imply 0.0× the rate we assume" would be arithmetic dressed
    // up as a finding.
    return {
      ...base, level: 'not_measurable', confidence,
      headline: 'A statement reports nothing against views this platform counted',
      detail: 'There is no rate to derive from it, so nothing here changes the assumed rate. It is usually a '
        + 'delivery question at the network, a payment threshold that has not been crossed, or a provider whose '
        + 'reports we are not seeing — the seller can see which from their own portal.',
    };
  }
  if (totalEstimate > totalReported) {
    return {
      ...base, level: 'we_over', confidence,
      headline: `We assume ${(assumed / Math.max(implied, 0.0001)).toFixed(1)}× the rate the statements imply`,
      detail: `We assume $${assumed.toFixed(2)} per 1,000 views; the statements on file imply $${implied.toFixed(2)}. `
        + 'Rent is proportional to that assumed rate, so every rent figure is priced high by the same factor against what '
        + 'this traffic has actually been earning. Issued invoices stand — the correction is for future periods. That is '
        + `the decision this page exists to surface.${hedge}`,
    };
  }
  return {
    ...base, level: 'we_under', confidence,
    headline: `The statements imply ${(implied / Math.max(assumed, 0.0001)).toFixed(1)}× the rate we assume`,
    detail: `We assume $${assumed.toFixed(2)} per 1,000 views; the statements on file imply $${implied.toFixed(2)}. Nothing `
      + 'is broken for a creator — they were paid what they were paid — but rent is priced below what the traffic earns, '
      + `and the estimate on every seller's page understates their month.${hedge}`,
  };
}

/**
 * Rent next to what the network says the channel earned.
 *
 * Not a ratio that changes the rent: rent is priced from traffic, never from
 * earnings, and it stays predictable across a bad month. But a creator is
 * entitled to see the two numbers together, because a charge that is 60% of
 * earnings is a different business decision from one that is 4%, and only the
 * person paying it can decide whether it is worth it.
 */
export function rentInContext({ rentNpr, reportedUsd, monthsCovered = 0, usdToNpr = 133 }) {
  const rentUsd = Number(rentNpr || 0) / usdToNpr;

  // ANNUAL, both sides. Rent is charged once a year; a statement period is
  // almost always a month. Comparing them directly reported a rent twelve times
  // its real share — a page that shouts "164% of what you earned" when the
  // honest answer is 14% is worse than no comparison at all, because the seller
  // has no way to know which number to trust.
  const annualUsd = monthsCovered > 0 ? reportedUsd * (12 / monthsCovered) : null;

  if (!annualUsd || annualUsd <= 0) {
    return {
      rentUsd: round4(rentUsd),
      annualEarningsUsd: null,
      pct: null,
      sentence: 'No closed statement to compare against yet. When you add one, your rent appears as a share of a year at that rate.',
    };
  }

  const pct = Math.round((rentUsd / annualUsd) * 100);
  const sentence = pct <= 10
    ? `${pct}% of what the network reported, annualised — the rest is yours.`
    : pct <= 25
      ? `${pct}% of what the network reported, annualised. Worth watching, and worth telling us about if it holds.`
      : `${pct}% of what the network reported, annualised. That is high: rent is priced from measured traffic at an assumed rate, and a share this size usually means the assumption does not fit your store.`;
  return { rentUsd: round4(rentUsd), annualEarningsUsd: round4(annualUsd), pct, sentence };
}

/** Everything the earnings page needs, from the rows the store returns. */
export function earningsSummary({
  rows = [], estimateUsd = 0, reports = [], rpmUsd = 0.2, rent = null, usdToNpr = 133, now = new Date(),
}) {
  const lines = rows.map((r) => providerLine({
    providerId: r.provider_id,
    providerName: r.provider_name,
    views: Number(r.views) || 0,
    estimateUsd: Number(r.estimate_usd) || 0,
    postbackUsd: Number(r.reported_usd) || 0,
    reports: reports.filter((x) => x.provider_id === r.provider_id),
    rpmUsd: r.rpm_usd ?? rpmUsd,
    connected: Boolean(r.connected),
    now,
  }));

  const reportedTotal = lines.reduce((a, l) => a + (l.reported || 0), 0);
  const compared = lines.filter((l) => l.reported !== null);

  // How many months of statements are actually behind that total. Without it,
  // rent (annual) would be compared against a month and reported as a share
  // twelve times too large.
  const monthsCovered = closedMonths(reports, now);

  return {
    lines,
    estimateUsd: round4(estimateUsd),
    reportedTotal: compared.length ? round4(reportedTotal) : null,
    comparedProviders: compared.length,
    monthsCovered: round4(monthsCovered),
    rent: rent
      ? rentInContext({ rentNpr: rent, reportedUsd: reportedTotal, monthsCovered, usdToNpr })
      : null,
    // The single sentence the page leads with. When there is nothing to compare,
    // it says that instead of showing a ratio of zero.
    headline: compared.length
      ? gapVerdict({
        counted: compared.length,
        reported: reportedTotal,
        estimateUsd,
        gapPct: reportedTotal > 0 ? Math.round(((reportedTotal - estimateUsd) / reportedTotal) * 100) : null,
      })
      : gapVerdict({ counted: 0 }),
  };
}

/**
 * The two directions money moves, stated once so every page can repeat it.
 *
 * `NOT_CHARGED` in `billing.js` is the list of what we do not charge for. This
 * is the same fact from the earning side: what we do not take, and who pays it.
 */
export const MONEY_MAP = {
  toCreator: {
    label: 'Your ad earnings',
    payer: 'The ad network',
    // Short on purpose. This string is rendered in a four-column map on the
    // landing hero AND in the earnings page's definition list, and the long form
    // ("…, at the network") made one box in the map two lines tall while its three
    // neighbours were one — four equal boxes that read as four unequal ones. The
    // rows around it already say who pays ("Paid by: The ad network") and that we
    // hold nothing, so the phrase was repeating its neighbours as well as breaking
    // the shape.
    account: 'Your own account',
    held: 'Nothing, ever',
    cut: '0% to bytebikri',
    detail: 'The advertiser pays the network. The network pays your account. bytebikri is not a party to either leg and cannot see the balance.',
  },
  /*
   * The third leg, and the one memberships added: a member sends the creator money
   * with bytebikri nowhere in the path. It belongs on this map — the page's own
   * heading is "Where the money goes, and who is holding it. It is not us" — and the
   * map was written when there were only two legs. A money map that omits a flow
   * because the platform is not a party to it is a map that stops being true the
   * first time somebody pays somebody here.
   *
   * The answers are phrases of the same length as their neighbours, because this
   * structure is rendered as four equal boxes on the landing hero (see
   * test/design.test.js) — the dues leg is not in that map, but keeping the same
   * shape is what stops the next person adding one that is.
   */
  toCreatorFromMembers: {
    label: 'Your members’ dues',
    payer: 'Your members',
    account: 'Your own account',
    held: 'Nothing, ever',
    cut: '0% to bytebikri',
    detail: 'A member sends the dues straight to you — eSewa, Khalti, bank, whatever you wrote down. bytebikri never receives them, cannot confirm or refund one, and takes no share: not a 0% rate, an absence of a path.',
  },
  toPlatform: {
    label: 'What you pay bytebikri',
    payer: 'You',
    account: 'bytebikri',
    held: 'Two charges only',
    cut: 'An upgrade and annual rent',
    detail: 'A plan upgrade and annual rent for the platform ad slot. Neither is a share of what you earn, and neither is charged on a sale or on the dues your members pay you.',
  },
  /*
   * The fourth leg, added with ByteBikri Plus: a PERSON pays the platform for how
   * their own name looks. It is on a seller's money map on purpose, and the reason is
   * the heading above it — a page that says where the money goes cannot name three
   * flows and leave out the fourth, least of all the one that is ours.
   *
   * The two answers that matter to the reader are the negative ones: nothing of
   * THEIRS is involved, and nothing about this charge can move a file, an ad or a
   * creator's earnings. `held` is phrased from the seller's side ("nothing of yours")
   * rather than as a claim about where our own revenue sits, because the second
   * reading of a row named "Held by bytebikri" is the one that would be wrong here.
   */
  toPlatformFromPeople: {
    label: 'What people pay bytebikri',
    payer: 'A person',
    account: 'bytebikri',
    held: 'Nothing of yours',
    cut: 'One price, no share',
    detail: 'NPR 149 a month, for a palette and an effect beside their own name. It opens no file, removes no ad, shortens no wait, and takes nothing from what you earn or from what your members pay you.',
  },
};

/** The four things a creator must do at the network, in the order that matters. */
export function payoutChecklist(providerName = 'the network') {
  return [
    `Sign up at ${providerName} in your own name. The account has to be yours — we cannot open it, verify it, or hold it for you.`,
    'Complete their KYC. Ad networks run their own checks; the documents you loaded here do not satisfy them.',
    'Set the payout method there, and watch the minimum: a rail that needs $100 is a wait, not a payout.',
    'Add plenty of traffic before expecting anything. A store with a few hundred views a month earns cents, and cents do not clear a threshold.',
  ];
}

const round4 = (n) => Math.round((Number(n) || 0) * 10000) / 10000;
