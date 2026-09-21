import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calibrationVerdict, calibrationRowState } from '../src/earnings.js';
// Imported at module scope: `await import()` inside a non-async test callback is
// a syntax error, which the suite reports as a file-level failure rather than a
// failing assertion — worth remembering, because it looks like a broken test file.
import * as views from '../src/views.js';

/**
 * The operator's calibration page exists to answer one question — is the assumed
 * rate still right — and these tests are about the two ways that page could lie:
 * deriving a rate from a window we never measured, and reporting a signal as if
 * it were a measurement.
 */

const store = (over = {}) => ({
  channel_id: 'ch-1', channel_slug: 'shop', channel_name: 'Shop', provider_id: 'adsterra',
  periods: 1, reported_usd: 10, views: 1000, estimate_usd: 0.2, implied_rpm_usd: 10,
  first_period_start: '2026-01-01', last_period_end: '2026-01-31', ...over,
});

test('a statement covering a window we never measured derives no rate', () => {
  // The seed had this shape for a while: every view in the last fortnight, the
  // statement in August. Our estimate over that window is zero BY CONSTRUCTION,
  // so calling it "we under-count" would send somebody to change a rate that was
  // never measured.
  const row = store({ views: 0, estimate_usd: 0, implied_rpm_usd: null, reported_usd: 0.11 });
  const state = calibrationRowState(row);
  assert.equal(state.state, 'no_views');
  assert.match(state.why, /no accepted ad callback was recorded/);

  const verdict = calibrationVerdict({ rows: [row], assumedRpmUsd: 0.2 });
  assert.equal(verdict.level, 'not_measurable');
  assert.equal(verdict.impliedRpmUsd, null);
  assert.match(verdict.detail, /zero by construction/);
  assert.match(verdict.detail, /delivery question/, 'and it points at the right next step');
});

test('no statements at all is a different state from an unmeasurable one', () => {
  const none = calibrationVerdict({ rows: [], assumedRpmUsd: 0.2 });
  assert.equal(none.level, 'no_statements');
  assert.equal(none.confidence, 'none');
  assert.match(none.detail, /we are not party to the payment/,
    'and it says why we can never fetch the number ourselves');
});

test('the direction and the confidence are reported separately', () => {
  // One period from one store that implies half our rate: we are pricing HIGH.
  const single = calibrationVerdict({
    rows: [store({ views: 1000, reported_usd: 0.09, estimate_usd: 0.2, implied_rpm_usd: 0.09 })],
    assumedRpmUsd: 0.2,
  });
  assert.equal(single.level, 'we_over');
  assert.equal(single.confidence, 'single');
  assert.match(single.headline, /We assume 2\.2× the rate/, 'the direction is the headline');
  assert.match(single.detail, /signal, not a measurement/,
    'and the same sentence admits it rests on one store');
  assert.match(single.detail, /Issued invoices stand/, 'with the decision, not just the diagnosis');

  // Twelve periods across three stores is a measurement rather than a signal.
  const broad = calibrationVerdict({
    rows: [
      store({ channel_id: 'a', periods: 4, views: 1000, reported_usd: 90, estimate_usd: 200, implied_rpm_usd: 90 }),
      store({ channel_id: 'b', periods: 4, views: 1000, reported_usd: 90, estimate_usd: 200, implied_rpm_usd: 90 }),
      store({ channel_id: 'c', periods: 4, views: 1000, reported_usd: 90, estimate_usd: 200, implied_rpm_usd: 90 }),
    ],
    assumedRpmUsd: 0.2,
  });
  assert.equal(broad.confidence, 'broad');
  assert.equal(broad.stores, 3);
  assert.equal(broad.periods, 12);
  assert.ok(!/signal, not a measurement/.test(broad.detail), 'broad evidence does not hedge');
});

test('within 15% is called consistent, and the band is two-sided', () => {
  // The band is applied to the DOLLAR comparison — our estimate against what the
  // statement reported over the same window — because that is the number the
  // seller sees and the number the row chips on the operator's page show. Testing
  // it through the implied rate would have passed while the two surfaces
  // disagreed at the edge, which is the bug this replaced.
  const near = (reported) => calibrationVerdict({
    rows: [store({ views: 1000, reported_usd: reported, estimate_usd: 0.2, implied_rpm_usd: reported })],
    assumedRpmUsd: 0.2,
  }).level;
  assert.equal(near(0.2), 'consistent', 'exactly our estimate');
  assert.equal(near(0.18), 'consistent', 'our estimate is 11% higher — inside the band');
  assert.equal(near(0.23), 'consistent', 'and 13% lower — also inside');
  assert.equal(near(0.17), 'we_over', 'our estimate 17.6% higher is outside it, so the rate is priced high');
  assert.equal(near(0.1), 'we_over', 'half the rate is far outside, and we are the ones over');
  assert.equal(near(0.5), 'we_under', 'two and a half times the rate means we price too cheap');
});

test('the verdict and the rows it counts cannot disagree about the same band', () => {
  // The overview shows a count of contradicted rates immediately above the
  // verdict line. If those two are computed from different denominators they can
  // say opposite things at the edge, and an operator reading both would have no
  // way to tell which one the platform meant.
  for (const reported of [0.2, 0.18, 0.23, 0.175, 0.17, 0.16, 0.1, 0.5, 0.9]) {
    const row = store({ views: 1000, reported_usd: reported, estimate_usd: 0.2, implied_rpm_usd: reported });
    const disagreed = calibrationRowState(row).contradicted ? 1 : 0;
    const verdict = calibrationVerdict({ rows: [row], assumedRpmUsd: 0.2 });
    assert.equal(verdict.level === 'consistent' ? 0 : 1, disagreed,
      `reported $${reported}: the verdict says "${verdict.level}" while the row says contradicted=${disagreed}`);
  }
});

test('a statement of zero against real traffic is a delivery question, not a rate', () => {
  const verdict = calibrationVerdict({
    rows: [store({ views: 4000, reported_usd: 0, estimate_usd: 0.8, implied_rpm_usd: 0 })],
    assumedRpmUsd: 0.2,
  });
  assert.equal(verdict.level, 'not_measurable');
  assert.match(verdict.headline, /reports nothing/);
  assert.ok(!/0\.0×/.test(verdict.headline), 'never "0.0× the rate we assume" — that is arithmetic, not a finding');
});

test('a rate is never derived from zero views, whichever way the row arrives', () => {
  // Guard the arithmetic itself: implied = reported / (views / 1000) is infinite
  // at zero views, and Infinity formatted into a headline reads as a real finding.
  const state = calibrationRowState(store({ views: 0, estimate_usd: 0, implied_rpm_usd: null, reported_usd: 0 }));
  assert.equal(state.state, 'no_views');
  assert.match(state.why, /nothing happened here/);
  const verdict = calibrationVerdict({
    rows: [store({ views: 0, estimate_usd: 0, implied_rpm_usd: null, reported_usd: 0 })],
    assumedRpmUsd: 0.2,
  });
  assert.equal(verdict.ratio, null);
  assert.ok(!/Infinity|NaN/.test(verdict.headline + verdict.detail));
});

test('the console overview carries the rate as a glance value AND a queue', () => {
  // Both, because they answer different questions: the KPI is the number an
  // operator wants to see drift, and the queue row is the decision. A page with
  // only the first would report a contradiction without offering the way to act
  // on it; a page with only the second would make the operator open a page a day
  // to find out whether anything changed.
  const page = views.adminOverview({
    user: { role: 'admin', email: 'op@example.com', display_name: 'Op' },
    kpis: [
      { label: 'Matched this month', value: 'NPR 0', context: '1 transfer to match' },
      { label: 'Reports waiting', value: '0', context: 'nothing reported' },
      { label: 'Stores not public', value: '0', context: 'every store is public' },
      { label: 'Paying stores', value: '1', context: 'on any paid plan' },
      { label: 'Rate the statements imply', value: '$0.09', context: 'We assume $0.20 · rent is priced from it', tone: 'warn', href: '/admin/earnings' },
      { label: 'Views · 30d', value: '331', context: '1 unlocks · 400 ad views' },
    ],
    queues: [
      { title: 'Rates to correct', count: 1, note: 'We assume 2.2× the rate the statements imply.', href: '/admin/earnings' },
    ],
  });
  assert.match(page, /Rate the statements imply/);
  assert.ok(page.includes('href="/admin/earnings"'), 'the figure is a link to where it is explained');
  assert.match(page, /Rates to correct/, 'and the decision is in the queue list');
  assert.match(page, /We assume 2\.2× the rate/, 'with the verdict sentence, not just a number');
  assert.match(page, /kpi-row kpi-row-tight/,
    'six tiles ask for the tighter grid: five fitted, six left an orphan row with four tiles of empty space beside it');
});

test('a page with four tiles is left alone', () => {
  const page = views.adminOverview({
    user: { role: 'admin', email: 'op@example.com' },
    kpis: [{ label: 'a', value: '1' }, { label: 'b', value: '2' }, { label: 'c', value: '3' }, { label: 'd', value: '4' }],
    queues: [],
  });
  assert.ok(!/kpi-row-tight/.test(page), 'the tight variant is for rows that would otherwise wrap unevenly');
});
