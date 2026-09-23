/**
 * Earnings: whose money it is, and what the numbers mean.  npm test
 *
 * The product's central promise is that bytebikri never holds a creator's ad
 * revenue — the network pays them directly. That promise is not testable in the
 * abstract, but three things about how the page behaves are:
 *
 *   1. Our ESTIMATE and the network's STATEMENT are never blended into one
 *      figure. The moment they are, the page implies we know what was paid.
 *   2. A period the network has not closed is not compared. Comparing a partial
 *      month against a full month of our counting produces a gap that is an
 *      artefact of the calendar, and the page then cries "we over-count".
 *   3. Rent (annual) is compared against annualised statements, never against a
 *      single month. The first version of this compared the two directly and
 *      reported rent as 164% of earnings when the true share was 14% — a number
 *      that would have cost a seller their trust in the whole page.
 *
 * The last one is why this file exists. It was found by running the arithmetic
 * against realistic demo figures, not by reading the code.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

const {
  periodStatus, providerLine, gapVerdict, rentInContext, earningsSummary,
  closedMonths, payoutChecklist, MONEY_MAP,
} = await import('../src/earnings.js');

const NOW = new Date('2026-09-21T12:00:00Z');
const CLOSED = { provider_id: 'adsterra', period_start: '2026-08-01', period_end: '2026-08-31', reported_usd: 0.11 };
const OPEN = { provider_id: 'adsterra', period_start: '2026-09-01', period_end: '2026-09-30', reported_usd: 0.09 };

// ---------------------------------------------------------------------------
// Periods
// ---------------------------------------------------------------------------

test('a period the network has not closed is not treated as settled', () => {
  assert.equal(periodStatus('2026-08-31', { now: NOW }).closed, true);
  assert.equal(periodStatus('2026-09-30', { now: NOW }).closed, false, 'the month is still running');
  assert.equal(periodStatus('2026-09-20', { now: NOW }).closed, false,
    'a network closes its books days after the month ends, not on the day');
  assert.equal(periodStatus('2026-09-15', { now: NOW }).closed, true, 'six days later is settled enough');
});

test('closed months are counted from the dates entered, not assumed', () => {
  assert.equal(closedMonths([CLOSED], NOW).toFixed(2), '1.02', 'a 31-day month is a month');
  assert.equal(closedMonths([CLOSED, OPEN], NOW).toFixed(2), '1.02', 'the open period adds nothing');
  const quarter = [
    { period_start: '2026-06-01', period_end: '2026-06-30', reported_usd: 1 },
    { period_start: '2026-07-01', period_end: '2026-07-31', reported_usd: 1 },
    { period_start: '2026-08-01', period_end: '2026-08-31', reported_usd: 1 },
  ];
  // June is 30 days, July and August are 31: three months, 3.02 by the 30.44-day
  // convention. The point is that it is derived from the dates, not assumed.
  assert.equal(closedMonths(quarter, NOW).toFixed(2), '3.02', 'three months is three months');
});

// ---------------------------------------------------------------------------
// Estimate vs statement
// ---------------------------------------------------------------------------

test('the estimate and the statement stay separate, and both are reported', () => {
  const line = providerLine({
    providerId: 'adsterra', providerName: 'Adsterra', views: 180, estimateUsd: 0.036,
    postbackUsd: 0.0085, reports: [CLOSED], now: NOW,
  });
  assert.equal(line.estimateUsd, 0.036, 'our arithmetic, unchanged');
  assert.equal(line.reported, 0.11, 'their statement, unchanged');
  assert.equal(line.postbackUsd, 0.0085, 'per-view postbacks are shown, and are not the statement');
  assert.equal(line.periodsCompared, 1);
  assert.notEqual(line.estimateUsd, line.reported, 'the two are never blended');
});

test('an open period is shown but excluded from the verdict', () => {
  const line = providerLine({ providerId: 'a', views: 100, estimateUsd: 0.02, reports: [CLOSED, OPEN], now: NOW });
  assert.equal(line.periodsCompared, 1);
  assert.equal(line.periodsExcluded, 1, 'the page can say one period is not counted yet');
  assert.equal(line.reported, 0.11, 'the open 0.09 is not added in');
});

test('no statement produces an explanation rather than a zero', () => {
  const line = providerLine({ providerId: 'a', views: 500, estimateUsd: 0.1, reports: [], now: NOW });
  assert.equal(line.reported, null);
  assert.equal(line.verdict.level, 'no_report');
  assert.ok(/arithmetic: completed views/i.test(line.verdict.detail));
});

test('the verdict names the direction of the gap, because only one direction costs the seller', () => {
  const over = gapVerdict({ counted: 1, reported: 0.05, estimateUsd: 0.15, gapPct: -200 });
  assert.equal(over.level, 'we_over');
  assert.ok(/rent is priced from the same model/i.test(over.detail) || /priced from the same/i.test(over.detail));

  const under = gapVerdict({ counted: 1, reported: 0.3, estimateUsd: 0.1, gapPct: 67 });
  assert.equal(under.level, 'we_under');
  assert.ok(/cheaper than it would be/i.test(under.detail));

  const close = gapVerdict({ counted: 2, reported: 1, estimateUsd: 0.92, gapPct: -9 });
  assert.equal(close.level, 'consistent', 'an estimate within 15% is not a problem to report');

  const nothing = gapVerdict({ counted: 1, reported: 0, estimateUsd: 0.4, gapPct: -100 });
  assert.equal(nothing.level, 'disagree');
  assert.ok(/delivery problem|threshold/i.test(nothing.detail));
});

// ---------------------------------------------------------------------------
// Rent, in context
// ---------------------------------------------------------------------------

test('rent is compared against a YEAR of statements, not a month of them', () => {
  // 24 NPR is about $0.18. One month of statements is $0.11, which annualises to
  // $1.32 — a 14% share. Comparing annual rent against a single month gives 164%
  // and is simply a different (wrong) question.
  const r = rentInContext({ rentNpr: 24, reportedUsd: 0.11, monthsCovered: 1, usdToNpr: 133 });
  assert.equal(r.pct, 14);
  assert.equal(r.annualEarningsUsd.toFixed(2), '1.32', 'one month annualises to twelve');
  // And the same figures with the month measured in days rather than assumed:
  // a 31-day August is 1.018 months, which annualises to $1.30 and still rounds
  // to the same 14% share.
  const dated = rentInContext({ rentNpr: 24, reportedUsd: 0.11, monthsCovered: closedMonths([CLOSED], NOW), usdToNpr: 133 });
  assert.equal(dated.pct, 14);
  assert.ok(/annualised/.test(r.sentence));

  // Three months of statements annualise the same way.
  const q = rentInContext({ rentNpr: 24, reportedUsd: 0.33, monthsCovered: 3, usdToNpr: 133 });
  assert.equal(q.pct, 14, 'same rate, same share, whatever the window');

  // A big store: $40/month annualises to $480, so NPR 3,360 of rent is 5%.
  const big = rentInContext({ rentNpr: 3360, reportedUsd: 40, monthsCovered: 1, usdToNpr: 133 });
  assert.equal(big.pct, 5);
  assert.ok(/the rest is yours/i.test(big.sentence));

  // A store the model does not fit: NPR 3,360 against $36 a year is 70%, and the
  // page has to say that out loud rather than presenting it as normal.
  const heavy = rentInContext({ rentNpr: 3360, reportedUsd: 3, monthsCovered: 1, usdToNpr: 133 });
  assert.equal(heavy.pct, 70, 'and when the share is high, the page says so plainly');
  assert.ok(/usually means the assumption does not fit/i.test(heavy.sentence));
});

test('with nothing to compare, the ratio is absent rather than zero', () => {
  const r = rentInContext({ rentNpr: 500, reportedUsd: 0, monthsCovered: 0 });
  assert.equal(r.pct, null);
  assert.equal(r.annualEarningsUsd, null);
  assert.ok(/No closed statement/.test(r.sentence));
});

// ---------------------------------------------------------------------------
// The summary the page renders
// ---------------------------------------------------------------------------

test('the summary carries both totals and refuses a ratio with no report', () => {
  const withReport = earningsSummary({
    rows: [{ provider_id: 'adsterra', provider_name: 'Adsterra', views: 180, estimate_usd: 0.036, reported_usd: 0.0085, connected: true }],
    reports: [CLOSED], estimateUsd: 0.036, rent: 24, rpmUsd: 0.2, now: NOW,
  });
  assert.equal(withReport.reportedTotal, 0.11);
  assert.equal(withReport.monthsCovered.toFixed(2), '1.02');
  assert.equal(withReport.rent.pct, 14);
  assert.equal(withReport.headline.level, 'we_under');

  const without = earningsSummary({
    rows: [{ provider_id: 'house', provider_name: 'House', views: 12, estimate_usd: 0.0024 }],
    reports: [], estimateUsd: 0.0024, rent: 24, now: NOW,
  });
  assert.equal(without.reportedTotal, null, 'no statement means no statement total');
  assert.equal(without.rent.pct, null);
  assert.equal(without.headline.level, 'no_report');
});

test('a creator with no views has an empty summary, not a zero balance', () => {
  const empty = earningsSummary({ rows: [], reports: [], estimateUsd: 0, rent: 0, now: NOW });
  assert.deepEqual(empty.lines, []);
  assert.equal(empty.reportedTotal, null);
  assert.equal(empty.comparedProviders, 0);
  assert.equal(empty.rent, null, 'no rent means no rent panel at all');
});

// ---------------------------------------------------------------------------
// What the page is allowed to say
// ---------------------------------------------------------------------------

test('the money map states both directions, and the payer on each leg', () => {
  assert.equal(MONEY_MAP.toCreator.cut, '0% to bytebikri');
  assert.equal(MONEY_MAP.toCreator.payer, 'The ad network');
  assert.match(MONEY_MAP.toCreator.account, /your own account/i);
  assert.match(MONEY_MAP.toCreator.detail, /not a party/i);
  // Was `/no sale/i`, which the detail line used to satisfy by saying there was no
  // sale at all. There ARE payments now — members send dues to creators — so the
  // assertion moves to the claim that has to survive every model this product
  // grows into: the platform's charges are never a share of what a store earns.
  assert.match(MONEY_MAP.toPlatform.detail, /neither is a share of what you earn/i);
  assert.match(MONEY_MAP.toPlatform.detail, /dues/i,
    'and the line names the money a member sends, rather than pretending it does not exist');

  // The third leg: memberships added a flow between two people who are not us, and a
  // map whose heading is "Where the money goes, and who is holding it. It is not us"
  // cannot omit it. Same shape as the other two, so the page renders it the same way.
  const dues = MONEY_MAP.toCreatorFromMembers;
  assert.equal(dues.cut, '0% to bytebikri');
  assert.equal(dues.held, 'Nothing, ever');
  assert.equal(dues.payer, 'Your members');
  for (const phrase of [dues.payer, dues.account, dues.held, dues.cut]) {
    assert.ok(phrase.length <= 24, `a money-map answer is a phrase: "${phrase}"`);
  }
  assert.match(dues.detail, /ESewa|eSewa|Khalti|bank/,
    'the detail names rails a Nepali member can actually use');
  // The one thing that must never appear: bytebikri holding or forwarding it.
  // "cannot see the balance" is allowed and deliberate — naming the balance is
  // the point. Claiming one is not.
  for (const leg of Object.values(MONEY_MAP)) {
    const text = JSON.stringify(leg);
    assert.ok(!/bytebikri holds|we hold|we forward|held by us|our balance|wallet|withdraw/i.test(text),
      `a leg implies bytebikri holds money: ${text}`);
  }
});

test('the payout checklist is about the network account, not about us', () => {
  const steps = payoutChecklist('Adsterra');
  assert.equal(steps.length, 4);
  assert.ok(steps[0].includes('Adsterra') && /in your own name/.test(steps[0]));
  assert.ok(steps.some((s) => /KYC/.test(s)));
  assert.ok(steps.some((s) => /minimum/.test(s)), 'the threshold is the thing that surprises people');
  assert.ok(!steps.some((s) => /bytebikri/i.test(s)), 'none of it happens here');
});

// ---------------------------------------------------------------------------
// The store side: a label, never an account
// ---------------------------------------------------------------------------

process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:55432/bytebikri_test';
const { store } = await import('../src/store.js');
const { close, query } = await import('../src/db.js');
const { after } = await import('node:test');
after(async () => { await close(); });

let seq = 0;
async function channel() {
  const tag = `${Date.now()}-${++seq}`;
  const user = await store.userByEmailOrCreate(`earn-${tag}@test.local`);
  const ch = await store.createChannel({ ownerId: user.id, slug: `earn-${tag}`, name: `Earn ${tag}` });
  const connection = await store.createConnection({
    channelId: ch.id, providerId: 'adsterra', secret: 'x', callbackBaseUrl: 'http://localhost',
  });
  return { user, ch, connection };
}

test('a payout label round-trips, and holds nothing usable', async () => {
  const { ch } = await channel();
  const saved = await store.setPayoutAccount({
    channelId: ch.id, providerId: 'adsterra', accountLabel: 'Payoneer ending 4417', payoutMethod: 'Payoneer',
  });
  assert.equal(saved.account_label, 'Payoneer ending 4417');
  assert.equal(saved.status, 'declared');

  const columns = await query(
    `select column_name from information_schema.columns where table_name = 'payout_accounts'`,
  );
  const names = columns.rows.map((r) => r.column_name);
  assert.ok(!names.some((n) => /number|token|secret|iban|account_id/i.test(n)),
    `payout_accounts must hold no usable account number: ${names.join(', ')}`);

  // Changing the label marks it as changed — a note that the old one is stale,
  // which is the whole reason the status column exists.
  const changed = await store.setPayoutAccount({ channelId: ch.id, providerId: 'adsterra', accountLabel: 'Bank transfer, NIC Asia' });
  assert.equal(changed.status, 'changed');
  assert.equal((await store.payoutAccountsOf(ch.id)).length, 1, 'one label per provider, not a history');

  await store.clearPayoutAccount({ channelId: ch.id, providerId: 'adsterra' });
  assert.equal((await store.payoutAccountsOf(ch.id)).length, 0);
  assert.equal(await store.setPayoutAccount({ channelId: ch.id, providerId: 'adsterra', accountLabel: '   ' }), null,
    'a blank label is not a label');
});

test('a statement figure is recorded once per period and corrected in place', async () => {
  const { ch } = await channel();
  const first = await store.addProviderReport({
    channelId: ch.id, providerId: 'adsterra', periodStart: '2026-08-01', periodEnd: '2026-08-31', reportedUsd: 0.11,
  });
  assert.equal(Number(first.reported_usd), 0.11);

  const corrected = await store.addProviderReport({
    channelId: ch.id, providerId: 'adsterra', periodStart: '2026-08-01', periodEnd: '2026-08-31', reportedUsd: 0.13,
  });
  assert.equal(corrected.id, first.id, 'the same period is one row, corrected');
  assert.equal((await store.reportsOfChannel(ch.id)).length, 1);

  assert.equal(await store.addProviderReport({
    channelId: ch.id, providerId: 'adsterra', periodStart: '2026-09-30', periodEnd: '2026-09-01', reportedUsd: 5,
  }), null, 'a period that ends before it starts is refused');
  assert.equal(await store.addProviderReport({
    channelId: ch.id, providerId: 'adsterra', periodStart: '2026-09-01', periodEnd: '2026-09-30', reportedUsd: -3,
  }), null, 'negative earnings are refused');
});

test('earnings counts only completed views, and only this channel', async () => {
  const { ch, user, connection } = await channel();
  const other = await channel();
  const asset = await store.createAsset({ channelId: ch.id, title: 'Kit', slug: 'kit' });

  const insert = (channelId, completed, revenue) => query(
    `insert into ad_view_events
       (channel_id, user_id, asset_id, provider_id, connection_id, external_id,
        kind, state, completed, duration_sec, revenue_usd, signature_ok)
     values ($1, $2, $3, 'adsterra', $4, $5, 'rewarded', 'complete', $6, 15, $7, true)`,
    [channelId, user.id, asset.id, connection.id, `x-${Math.random()}`, completed, revenue],
  );

  await insert(ch.id, true, 0.0002);
  await insert(ch.id, true, null);
  await insert(ch.id, false, 0.5);            // abandoned: not billable, not counted
  await insert(other.ch.id, true, 9.99);      // a different channel entirely

  const rows = await store.earningsByProvider({ channelId: ch.id, days: 30, rpmUsd: 0.2 });
  assert.equal(rows.length, 1);
  assert.equal(Number(rows[0].views), 2, 'only completed views, only this channel');
  assert.equal(Number(rows[0].estimate_usd), 0.0004);
  assert.equal(Number(rows[0].reported_usd), 0.0002, 'postback revenue is summed, gaps and all');

  const byAsset = await store.earningsByAsset({ channelId: ch.id, days: 30, rpmUsd: 0.2 });
  assert.equal(Number(byAsset.find((a) => a.asset_id === asset.id).views), 2);
});
