// ============================================================================
//  Dates
// ============================================================================
//  One helper, because the alternative has now cost this codebase three bugs of
//  exactly the same shape:
//
//    1. Four view files rendered dates as "Sat Aug 01", because a Postgres `date`
//       column arrives as a JS `Date` and `String(value).slice(0, 10)` gives
//       "Sat Aug 01" — which looks like a formatting choice and is a bug.
//    2. A test asserting an invoice was due 30 days after issue compared two
//       Invalid Dates and reported `NaN !== 30`.
//    3. The rent aging view printed **"NaN days late"** on every row and swept
//       every invoice into the worst bucket, because `rentAge` parsed its input
//       with `new Date(\`${String(dueAt).slice(0, 10)}T00:00:00Z\`)`.
//
//  The fix is not three fixes. It is one function that understands both a `Date`
//  and the several string shapes a date arrives in, and every caller using it.
//
//  `isoDay` is deliberately UTC-based: these are calendar dates — a billing
//  period, a due date — not instants, and a calendar date that shifts by a day
//  depending on the server's timezone is how a due date becomes wrong at 18:15
//  Kathmandu time.
// ============================================================================

/** A calendar date as `YYYY-MM-DD`. Accepts Date, ISO string, or null. */
export function isoDay(value) {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'string') {
    // Already a date, or the date half of a timestamp. Nothing to parse, and
    // nothing to shift.
    const match = /^(\d{4}-\d{2}-\d{2})/.exec(value);
    if (match) return match[1];
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
}

/** A calendar date as a `Date` at UTC midnight, or null when it cannot be read. */
export function asDay(value) {
  const iso = isoDay(value);
  if (!iso) return null;
  const date = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * The clock a person reads.
 *
 * The three functions above are calendar dates and are UTC-based on purpose. An
 * INSTANT is the opposite problem: "when did that happen" has to be answered on
 * the reader's own clock, and the reader is here. Nepal is +05:45 with no daylight
 * saving, so pinning it is stable all year, and it is what stops two rows on one
 * dashboard disagreeing — a renewal and a document check that happened in the same
 * minute both read as the 23rd, or neither does.
 *
 * 18:15 UTC is 00:00 in Kathmandu. That is the boundary this exists for: before it,
 * a seller in Nepal reads yesterday's date on something that happened this morning.
 */
export const SHOP_TZ = 'Asia/Kathmandu';

/** `12 Sep 2026` — the long form, for a date that stands on its own. */
export function longDay(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return 'an unknown date';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: SHOP_TZ });
}

/** `12 Sep` — the short form, for a column inside a sentence. */
export function shortDay(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: SHOP_TZ });
}

/** Whole days from `a` to `b`, ignoring the time of day. Null if either is unreadable. */
export function daysBetween(a, b) {
  const from = asDay(a);
  const to = asDay(b);
  if (!from || !to) return null;
  return Math.round((to - from) / 86400000);
}
