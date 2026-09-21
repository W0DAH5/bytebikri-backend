/**
 * Reports: a buyer tells us a file is wrong.
 *
 * The Android app has `flagged_assets` — asset_id, reporter_id, reason — and a
 * running joke in this repository is that the web forgot it. This is that table
 * done properly, and the word "properly" is doing specific work:
 *
 *   A REPORT IS A CLAIM, NOT A VERDICT. The obvious implementation hides the file
 *   the moment anybody reports it, and that gives every seller a weapon: three
 *   clicks and a competitor's best file is invisible until an operator gets to it.
 *   So a single report NEVER hides anything. `autoHideAfter` distinct reporters
 *   agree before the file is taken down automatically, and anything under that
 *   threshold waits in a queue that is ordered by how many people said it.
 *
 *   ONE PERSON, ONE VOTE. A report is unique per (asset, reporter) — otherwise the
 *   threshold is "three clicks from anyone with three accounts", which is the same
 *   weapon with extra steps.
 *
 *   THE REASON IS FROM THE POLICY TABLE. Same rule as moderation: a reason is a
 *   `policy_rules.code`, never a sentence. The reporter's own words go in `note`,
 *   capped and escaped, and they are a hint for the operator rather than the
 *   charge.
 *
 *   THE FILE IS NOT TOUCHED WHILE IT WAITS. No soft-delete, no paused status, no
 *   "temporarily unavailable". Hiding something is a decision with a record, and
 *   this module only ever produces queue entries and numbers.
 *
 * What the reporter is told matters as much as what happens: they get a
 * confirmation that says what will happen next, and they are never promised an
 * outcome we do not control.
 */

/**
 * Distinct reporters before a file is hidden automatically.
 *
 * Three, from the trust-and-safety literature rather than taste: "Don't
 * auto-takedown on a single report — that creates a competitor weapon. Require
 * 3+ reports or a high-confidence flag before auto-hide." Two would let a seller
 * with one friend do it; five would leave obvious piracy up for a day.
 */
export const AUTO_HIDE_AFTER = 3;

/** Distinct reporters before a report is escalated to the top of the queue. */
export const ESCALATE_AFTER = 2;

/** Reasons a reporter may pick, most common first, mapped to `policy_rules`. */
export const REPORT_REASONS = [
  { code: 'malware', label: 'It is harmful to open' },
  { code: 'scam', label: 'It is not what was described' },
  { code: 'copyright', label: "It is somebody else's work" },
  { code: 'adult', label: 'It should not be offered here' },
  { code: 'illegal', label: 'I think it breaks the law' },
  { code: 'contact', label: 'Something else' },
];

/**
 * Extra policy rules a report may cite that the seed data does not carry.
 *
 * They are inserted by `migrate.mjs` from the same list, so the codes here and
 * the rows in `policy_rules` cannot drift: a report citing a code with no row
 * would fail on the foreign key, at the moment a buyer pressed send.
 */
export const EXTRA_POLICY_RULES = [
  { code: 'scam', title: 'Not what was described', default_state: 'restricted', severity: 2, description: 'Buyers reported that what they unlocked was not what was advertised.' },
  { code: 'illegal', title: 'Unlawful content', default_state: 'blocked', severity: 3, description: 'Content that appears to break Nepali law or the law where it is offered.' },
  { code: 'contact', title: 'Something else', default_state: 'restricted', severity: 1, description: 'The buyer could not fit their report into a category, so an operator reads it.' },
];

export const NOTE_LIMIT = 400;

export function cleanNote(text) {
  const flat = String(text ?? '')
    // eslint-disable-next-line no-control-regex -- stripping control characters is the point
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (flat.length <= NOTE_LIMIT) return flat;
  return `${flat.slice(0, NOTE_LIMIT - 1).trimEnd()}…`;
}

export function knownReportReason(code) {
  return REPORT_REASONS.some((r) => r.code === String(code ?? ''));
}

export function reasonLabel(code) {
  return REPORT_REASONS.find((r) => r.code === String(code ?? ''))?.label ?? null;
}

/**
 * Validate one report before anything is written.
 *
 * @returns {{ok: true, reason: string, note: string} | {ok: false, error: 'reason'|'self'}}
 */
export function validateReport({ reason, note, reporterId = null, ownerId = null } = {}) {
  if (!knownReportReason(reason)) return { ok: false, error: 'reason' };
  // Reporting your own file is almost always a mis-click, and letting it through
  // would put a seller in their own queue.
  if (reporterId && ownerId && String(reporterId) === String(ownerId)) return { ok: false, error: 'self' };
  return { ok: true, reason: String(reason), note: cleanNote(note) };
}

/**
 * What a file's reports add up to.
 *
 * @param {{assetId: string, reporters: number|string[], byReason?: Record<string, number>}} args
 */
export function reportVerdict({ reporters = 0, byReason = {} } = {}) {
  const n = Array.isArray(reporters) ? reporters.length : Number(reporters) || 0;
  const top = Object.entries(byReason).sort((a, b) => b[1] - a[1])[0] || null;
  return {
    reporters: n,
    // The only thing that hides a file. Everything below it is a queue entry.
    autoHide: n >= AUTO_HIDE_AFTER,
    escalate: n >= ESCALATE_AFTER,
    topReason: top ? top[0] : null,
    // A sentence the operator page can show without doing arithmetic.
    summary: n === 0
      ? 'No reports.'
      : `${n} distinct reporter${n === 1 ? '' : 's'}${top ? `, most often “${reasonLabel(top[0]) ?? top[0]}”` : ''}`,
  };
}

/**
 * Order a queue the way an operator needs it, not the way it arrived.
 *
 * Risk first, newest second: "Ranking reports by urgency and risk instead of
 * handling them chronologically." A file with four reporters outranks a file
 * with one, and between equals the newer claim wins because the older one has
 * had longer to be seen.
 */
export function orderQueue(rows = []) {
  return [...rows].sort((a, b) => {
    const ra = reportVerdict({ reporters: a.reporters, byReason: a.byReason });
    const rb = reportVerdict({ reporters: b.reporters, byReason: b.byReason });
    if (ra.autoHide !== rb.autoHide) return ra.autoHide ? -1 : 1;
    if (rb.reporters !== ra.reporters) return rb.reporters - ra.reporters;
    return new Date(b.latest || 0) - new Date(a.latest || 0);
  });
}

/**
 * What the reporter is told, and it must not promise an outcome.
 *
 * @param {{reporters: number, filed: boolean, already?: boolean}} args
 */
export function reporterMessage({ reporters = 1, already = false } = {}) {
  if (already) {
    return 'You have already reported this file. Reporting it again does not move it up the queue — an operator reads every report once.';
  }
  if (reporters >= AUTO_HIDE_AFTER) {
    return 'Thank you. Enough people have reported this file that it is now hidden while an operator reviews it.';
  }
  return `Thank you. An operator reads every report. This file stays available until enough people report it or an operator decides — we do not take a file down on one report, because that would let anyone hide a seller's work.`;
}

/** The buyer-facing copy about what reporting does NOT do. */
export const REPORT_HONESTY = {
  short: 'Reports are read by a person. One report never hides a file.',
  long: 'We do not remove a file because one person reported it: that would let anyone hide somebody else\'s work. Three separate reports hide it automatically while an operator looks, and an operator can act on one.',
};
