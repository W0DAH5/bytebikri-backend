import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calibrationVerdict, calibrationRowState } from '../src/earnings.js';

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
  const near = (implied) => calibrationVerdict({
    rows: [store({ views: 1000, reported_usd: implied, estimate_usd: 0.2, implied_rpm_usd: implied })],
    assumedRpmUsd: 0.2,
  }).level;
  assert.equal(near(0.2), 'consistent');
  assert.equal(near(0.17), 'consistent', '15% under is still consistent');
  assert.equal(near(0.23), 'consistent', 'and 15% over');
  assert.equal(near(0.1), 'we_over', 'half the rate is not consistent, and we are the ones over');
  assert.equal(near(0.5), 'we_under', 'two and a half times the rate means we price too cheap');
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
