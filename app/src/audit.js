// ============================================================================
//  The audit vocabulary
// ============================================================================
//  `audit_logs` holds 29 distinct action strings written from 43 call sites, and
//  the console showed them as one undifferentiated firehose: `auth.login` sitting
//  next to `rent.payment_matched`, with no way to ask "what did people DECIDE" —
//  which is the only question an audit page exists to answer.
//
//  Two decisions live here.
//
//  1. **Families, declared once.** Every action belongs to a family, the family
//     list drives both the SQL filter and the tabs, and a test reads every
//     `audit('...')` call site in the source and fails when one is unclassified.
//     The researched failure mode is exactly this: "using inconsistent action
//     names … so the feed reads like noise". A new action string that quietly
//     belongs nowhere is how the noise comes back.
//
//  2. **People are separated from the platform.** Some rows have no actor: a
//     postback the network sent, a watermark that failed, an unlock that fired on
//     its own. "—" in an actor column is ambiguous — it reads as *unknown*. The
//     research is blunt about it: "make system actions obvious … so admins can
//     tell 'Dana deleted it' from 'Nightly billing sync updated it'." So the
//     absence of an actor is rendered as a fact ("the platform"), never as a gap.
// ============================================================================

/**
 * Families, in the order the tabs should read: the decisions first, the
 * background noise last. `decisions: true` marks the families that record a
 * PERSON choosing something — those are the rows worth a default view.
 */
export const AUDIT_FAMILIES = [
  {
    key: 'money',
    label: 'Money',
    note: 'Payments submitted, matched or rejected, and the statements creators recorded. Every one of these is a person deciding that money moved.',
    prefixes: ['rent.', 'plan.'],
    decisions: true,
  },
  {
    key: 'moderation',
    label: 'Moderation',
    note: 'Stores and accounts restricted, content denied, files hidden because enough people reported them.',
    prefixes: ['moderation.', 'content.denied', 'asset.reported', 'asset.hidden_by_reports'],
    decisions: true,
  },
  {
    key: 'people',
    label: 'Accounts',
    note: 'Sign-ups, consent decisions, payout details declared, passwords recovered, and the document checks that say who is behind a store. The record of who agreed to what, and when — and the first place to look when somebody says their account moved without them.',
    // Every way an account changes hands: signing up, getting back in, and the
    // address it is reachable at. The address actions belong here rather than in
    // a family of their own because "who controls this account, and since when"
    // is one question, and it is asked after an incident rather than before.
    // `seller.verification` belongs here rather than with the store's own actions:
    // it is about a person, it is asked for by a person, and the question it
    // answers after an incident is the same one this family exists for.
    // `operator.` is the promotion or demotion of an account's own powers (`setOperatorRole`).
    // It belongs in this family rather than a family of its own: the question asked after an
    // incident — "who could do this, and since when" — is this family's question, and an
    // operator's role IS a fact about a person, not about a store or a payment.
    prefixes: ['auth.signup', 'auth.password_reset', 'auth.email_verified', 'auth.email_changed', 'auth.verify_sent_by_operator', 'consent.', 'payout_account.', 'seller.verification', 'operator.'],
    decisions: true,
  },
  {
    key: 'exports',
    label: 'Exports',
    note: 'Data leaving the console. Worth its own family: "who took a copy, and of what" is a question that gets asked after an incident, not before.',
    prefixes: ['.directory_exported', '.exported', '.calibration_exported'],
    decisions: true,
  },
  {
    key: 'members',
    label: 'Members',
    // Its own family, and not folded into Money, because none of these rows is
    // about the platform's money: a tier is a price the platform never collects,
    // a claim is a reference somebody says they sent, and a confirmation is the
    // CREATOR saying they saw it arrive. Filing them under Money would put a
    // figure nobody here can verify next to the two charges that are ours.
    //
    // `decisions: false` for the same reason, from the other side: the console's
    // decisions tab is what an OPERATOR decided. Nobody here confirms a
    // membership — they cannot, the money never arrived — so these rows are
    // recorded, searchable and not part of that tab.
    note: 'Memberships: a tier set or removed, a claim made, the creator\'s confirmation or refusal, and the payment instruction a store publishes. Dues are paid to the creator directly — these rows record a relationship, not a transaction the platform handled.',
    prefixes: ['member.'],
    decisions: false,
  },
  {
    key: 'plus',
    label: 'Plus',
    // The platform's own charge to a person, and its own family for the same reason
    // Members has one: the two store charges (a plan, rent) and this one share a
    // ledger but not a consequence. A matched plan turns capabilities on for a shop;
    // a matched Plus claim turns a look on for a person and opens nothing. Filing
    // them together would make the audit page imply the platform sells access.
    note: 'ByteBikri Plus: a claim submitted, a look chosen or changed, an arrangement stopped, and the operator\'s match or refusal. Cosmetics only — no row in this family grants access to a file, removes an ad, or shortens a wait.',
    prefixes: ['plus.'],
    decisions: true,
  },
  {
    key: 'stores',
    label: 'Stores & files',
    note: 'Sellers publishing, editing and connecting networks. High volume, low drama — and the only place a dispute about "when did that change" gets settled.',
    // `series.` is here rather than in a family of its own: a series is a store's own
    // grouping of its own files, so "when did that change, and who changed it" is the
    // same question this family already answers for an edit to a file.
    prefixes: ['asset.', 'channel.', 'creative.', 'ad_connection.', 'review.', 'unlock.', 'content.', 'series.'],
    decisions: false,
  },
  {
    key: 'signins',
    label: 'Sign-ins',
    note: 'Successful sign-ins, one row each. Counted and kept, but not a decision — and the family that drowns every other one if it is not separated.',
    prefixes: ['auth.login'],
    decisions: false,
  },
  {
    key: 'delivery',
    label: 'Delivery & callbacks',
    note: 'What the ad networks told us: callbacks rejected, unlocks granted by a postback, watermark jobs that failed. Mostly the platform talking to itself.',
    prefixes: ['postback.', 'content.watermark_failed', 'provider_report.'],
    decisions: false,
  },
];

/** The family an action belongs to, or null when nothing claims it. */
export function familyOf(action) {
  const name = String(action || '');
  // Longest prefix wins, so `content.denied` (moderation) is not swallowed by the
  // broader `content.` prefix used for the publishing family.
  let best = null;
  for (const family of AUDIT_FAMILIES) {
    for (const prefix of family.prefixes) {
      const hit = prefix.startsWith('.') ? name.endsWith(prefix) : name.startsWith(prefix);
      if (hit && (!best || prefix.length > best.prefix.length)) best = { family, prefix };
    }
  }
  return best ? best.family.key : null;
}

export const FAMILY_KEYS = AUDIT_FAMILIES.map((f) => f.key);

/**
 * The `case` expression that classifies a row in SQL, built from the list above.
 *
 * Interpolated rather than parameterised because these are constants from this
 * file, not input — and generated rather than written out so the SQL and the tabs
 * cannot disagree about what "money" means. Ordering matters here exactly as it
 * does in `familyOf`: `content.denied` has to be tested before `content.`.
 */
export function familyCase(column = 'action') {
  // Flattened and sorted by prefix length, NOT grouped by family.
  //
  // The first version emitted one `when` per family in list order, which gave the
  // two implementations different answers: `content.watermark_failed` is claimed
  // by both the stores family (`content.`) and the delivery family
  // (`content.watermark_failed`), and `familyOf` picks the longest prefix while
  // the SQL would have returned whichever family came first — 'stores'. A log
  // filter and a log tab disagreeing about the same row is exactly the kind of
  // bug that survives review, so the SQL now reproduces longest-prefix-wins
  // literally: every prefix on its own, longest first, first match wins.
  const pairs = [];
  for (const family of AUDIT_FAMILIES) {
    for (const prefix of family.prefixes) pairs.push({ prefix, key: family.key });
  }
  pairs.sort((a, b) => b.prefix.length - a.prefix.length);
  const clauses = pairs.map(({ prefix, key }) => `when ${column} like ${prefix.startsWith('.') ? `'%${prefix}'` : `'${prefix}%'`} then '${key}'`);
  return `case ${clauses.join(' ')} else 'other' end`;
}

/**
 * Who did it, in three kinds rather than two.
 *
 * A null actor means the platform — a postback the network sent, a watermark job,
 * a scheduled sweep — and rendering it as "—" reads as *unknown*, which is the
 * one thing it is not. But not every null actor is the platform either: a consent
 * decision is made by a visitor who is not signed in and never will be, and
 * crediting the platform with somebody's choice is a worse error than a blank,
 * because it is a false statement rather than a missing one.
 *
 * So: a named person, the platform, or a visitor. Every row says which.
 */
export function actorOf(row) {
  if (row?.actor_id || row?.actor_email) {
    return {
      kind: 'person',
      label: row.actor_name || row.actor_email,
      detail: row.actor_name ? row.actor_email : null,
    };
  }
  if (String(row?.action || '').startsWith('consent.')) {
    return { kind: 'visitor', label: 'a visitor', detail: 'not signed in — a consent decision needs no account' };
  }
  return { kind: 'platform', label: 'the platform', detail: 'automated: a callback, a job, or an expiry' };
}

/**
 * The target of a row, as a type and a name somebody can recognise.
 *
 * The research asks for "the target (record type plus a human-friendly name)",
 * and the reason is practical: an operator arriving from a support email has a
 * store name, not a UUID. The name is resolved by the query when the subject
 * still exists; when it does not, the row keeps its type and the page says so
 * rather than showing an id that resolves to nothing.
 */
export function subjectOf(row) {
  if (!row?.subject_type) return null;
  const label = row.subject_label || null;
  const href = row.subject_type === 'channel' && row.subject_slug ? `/admin/stores/${row.subject_slug}`
    : row.subject_type === 'profile' ? `/admin/users/${row.subject_id}` : null;
  return { type: row.subject_type, label, href };
}
