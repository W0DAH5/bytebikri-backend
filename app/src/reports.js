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
// The one import: `canAppeal` has to know whether a PERSON has decided anything
// about the file, and that vocabulary belongs to the moderation module rather
// than being re-derived here from a list of states. Domain to domain, no cycle.
import { isAssetDecided } from './moderation.js';

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
/**
 * A reason carries two sentences, because it is read by two different people.
 *
 * `label` is the reporter's radio button — written in the first person, because
 * the person clicking it is describing what they think. `seller` is the same
 * charge written for the file's owner, as a noun phrase, because the seller reads
 * it inside "It was reported for …".
 *
 * The first version used the reporter's sentence in both places and the notice
 * came out as "It was reported for it is somebody else's work, it is harmful to
 * open" — which is how a platform tells a creator that nobody read the copy.
 */
export const REPORT_REASONS = [
  { code: 'malware', label: 'It is harmful to open', seller: 'being harmful to open' },
  { code: 'scam', label: 'It is not what was described', seller: 'not being what the listing describes' },
  { code: 'copyright', label: "It is somebody else's work", seller: "using somebody else's work" },
  { code: 'adult', label: 'It should not be offered here', seller: 'not being allowed here' },
  { code: 'illegal', label: 'I think it breaks the law', seller: 'breaking the law' },
  { code: 'contact', label: 'Something else', seller: 'something the reporter could not name' },
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

/**
 * The one sentence a seller reads when their file was hidden by reports.
 *
 * The seller's dashboard said "Paused" — the same word it uses for the pause
 * they chose themselves. So a store owner whose file was taken down by a
 * threshold could not tell the platform's decision from their own switch, could
 * not see what it was accused of, and had nothing to click. That is the version
 * of this feature that loses a creator permanently: not the takedown, the
 * silence around it.
 *
 * Says three things in order: what happened, what it was reported as (rules, not
 * people), and that nothing is deleted and a person will look.
 */
/**
 * Who may open a file that is not live.
 *
 * The answer used to be "anyone", because the file page never looked at the
 * file's status. Hidden meant hidden from the grid and from Explore and visible
 * to the rest of the internet at the one URL a report or a share carries.
 *
 * Three exceptions, each with a reason: the owner (it is their file, and their
 * dashboard links to it), an operator (they are the person deciding about it),
 * and anyone who holds an unlock from when it was live — an unlock was earned
 * with attention, and a moderation decision about a listing does not confiscate
 * what somebody already earned.
 */
export function maySeeHiddenFile({ asset, user = null, ownerId = null, holdsUnlock = false } = {}) {
  if (!asset) return false;
  if (asset.status === 'live') return true;
  if (holdsUnlock) return true;
  if (!user) return false;
  return user.id === ownerId || user.role === 'admin';
}

export function hidingNotice({ reasons = [], reporters = 0, appeal = null } = {}) {
  const labels = reasons.map(sellerReasonLabel).filter(Boolean);
  const charge = labels.length
    ? asList(labels)
    : 'a policy this platform has';
  const state = appeal?.status === 'open'
    ? 'An appeal is with an operator.'
    : appeal?.status === 'upheld' ? 'Your appeal was upheld.'
      : appeal?.status === 'declined' ? 'Your appeal was considered and declined.'
        : appeal?.status === 'withdrawn' ? 'You withdrew your appeal.' : null;
  return {
    // A threshold hiding is never "you broke the rules" — three people clicking is
    // a signal, not a verdict, and the copy must not convict before a person has.
    headline: reporters >= AUTO_HIDE_AFTER
      ? `${plural(reporters, 'independent report')} hid this file`
      : `${plural(reporters, 'report')} on this file`,
    // One template literal, not a concatenation inside one: the first version of
    // this line merged the two and would have rendered the quote marks and the
    // plus sign onto the page.
    //
    // The last clause is the one that used to be a lie. "Hidden" was true of the
    // grid and of Explore and false of the file's own URL, which every share and
    // every report carries — so the sentence now states the reach exactly, and the
    // code behind it makes it true.
    detail: `It was reported for ${charge}. The file is hidden from your storefront, from Explore, `
      + 'and from its own link for anybody who has not already unlocked it. Nothing has been deleted — '
      + 'the file, its reviews and its unlocks are all here.',
    next: state || (appeal ? null : 'You can answer once, in your own words. A person reads it.'),
    appeal,
  };
}

// A local pluraliser: `reports.js` has no view helpers by design — it is the
// domain layer, and importing from `views.js` would make the rules depend on the
// rendering (and create a cycle the first time a view wanted a rule).
const plural = (n, singular, many = `${singular}s`) => `${n} ${Number(n) === 1 ? singular : many}`;

/** How long an appeal may be. Same spirit as NOTE_LIMIT, generous by design. */
export const APPEAL_LIMIT = 1200;

export function cleanStatement(text) {
  return String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, APPEAL_LIMIT);
}

/**
 * Whether this seller may appeal, and why not when they may not.
 *
 * Deliberately boring rules, all checkable: the file must actually be hidden by
 * reports (not paused by the seller, not removed by an operator), and there must
 * be no open appeal already. A refusal always says which of the two it is — a
 * disabled button with no reason is the thing this whole feature exists to fix.
 */
export function canAppeal({ asset = null, openAppeal = null } = {}) {
  if (!asset) return { ok: false, why: 'That file does not exist.' };
  if (openAppeal) {
    return { ok: false, why: 'You have already appealed this file. An operator reads it before your next one.' };
  }
  // A decision by a person supersedes the report question, so an appeal is
  // refused — and the refusal names the decision that is actually standing.
  //
  // This said "not approved" rather than "decided", which made `pending` an
  // operator decision too: a store's first file, hidden by three reports before
  // anybody had looked at it, was refused an appeal with the words "an operator
  // has restricted this file" — a sentence about a decision nobody had made, on
  // the one file where nobody has looked yet and an appeal is the seller's only
  // move.
  if (isAssetDecided(asset.moderation_state)) {
    return {
      ok: false,
      why: asset.moderation_state === 'removed'
        ? 'An operator has removed this file. That is a separate decision, and it is not reopened by an appeal here.'
        : 'An operator has restricted this file. That is a separate decision, and it is not reopened by an appeal here.',
    };
  }
  if (!asset.hidden_by_reports) {
    return { ok: false, why: asset.status === 'paused'
      ? 'You paused this file yourself, so there is nothing to appeal.'
      : 'This file is not hidden by reports.' };
  }
  return { ok: true, why: null };
}

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
 * The charge, written for the seller, with a fallback that never prints nothing.
 *
 * A retired rule keeps its reports and loses nothing here: an unknown code is
 * described plainly rather than dropped, because dropping it would tell a seller
 * their file was hidden for no reason at all.
 */
export function sellerReasonLabel(code) {
  const known = REPORT_REASONS.find((r) => r.code === String(code ?? ''));
  if (known) return known.seller;
  const title = EXTRA_POLICY_RULES.find((r) => r.code === String(code ?? ''))?.title;
  return title ? title.toLowerCase() : 'a policy the platform applies';
}

/** "a, b and c" — a list as a sentence reads it. */
function asList(items) {
  if (items.length <= 1) return items[0] || '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
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
