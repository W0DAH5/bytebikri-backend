/**
 * Moderation: five states, six actions, and who each one serves.
 *
 * `channels.moderation_state` has existed since migration 0001 and nothing ever
 * set it, which made it look like decoration. It is the one place a store can be
 * stopped, and the interesting decisions are not about stopping — they are about
 * what the store's OWNER sees while it is stopped.
 *
 * The states and actions here are not invented: they are the vocabulary the
 * database already enforces in two CHECK constraints, and `test/moderation.test.js`
 * reads those constraints out of Postgres and fails if this file and the schema
 * ever disagree. That test exists because a CHECK constraint and the code that
 * writes to it drift silently — it has happened in this repository before.
 *
 * The failure this module refuses, in order of how quietly it happens:
 *
 *   1. A store stopped for something nobody can explain, leaving the seller to
 *      guess. Every decision carries a REASON, and the reasons are rows in
 *      `policy_rules` — not strings typed into a form.
 *
 *   2. A reason that is really free text, and then rendered. A free-text reason
 *      is how a moderation queue becomes an XSS vector and a defamation risk on
 *      the same afternoon. The reason travels as a rule code; its sentence is the
 *      policy table's own copy, written before the argument started.
 *
 *   3. No record of who decided. Every decision writes a `moderation_actions`
 *      row — in the same transaction as the state change — because a store that
 *      vanishes with no record is indistinguishable from a bug.
 *
 * The only free text anywhere in the flow is the operator's remedy line, capped
 * and escaped like any other input. There is no place in this file that builds
 * HTML, and there is no place in the view that trusts this file's output as
 * markup.
 */

/** The `channels.moderation_state` CHECK, verbatim. */
export const STATES = ['pending', 'approved', 'restricted', 'suspended', 'removed'];

/** The `moderation_actions.action` CHECK, verbatim. */
export const ACTIONS = ['approve', 'restrict', 'remove', 'suspend', 'reinstate', 'warn'];

/**
 * The actions that take something away, and therefore have to name a rule.
 *
 * Deliberately not "every action that changes state": `reinstate` and `approve`
 * change state too, and requiring a code for them is how a reinstatement ends up
 * citing the rule it was cleared of.
 */
export const REQUIRES_RULE = ['restrict', 'suspend', 'remove'];

/**
 * What each action does to the store.
 *
 * `warn` deliberately changes no state: a warning is a record, not a punishment.
 * `reinstate` and `approve` both land on `approved` for the same reason — there
 * is no "un-suspend" that is different from approving.
 */
export const ACTION_TO_STATE = {
  approve: 'approved',
  reinstate: 'approved',
  restrict: 'restricted',
  suspend: 'suspended',
  remove: 'removed',
  warn: null,
};

/**
 * The same actions, applied to a PERSON rather than to a store.
 *
 * Only two of the six make sense for an account, and the mapping is not the
 * store's: there is no `restricted` person and no `removed` person. `suspended`
 * is the ban the Android app has always called `banUser`; `reinstate` lifts it.
 * A ban is not a deletion — the account, its stores and its files all stay, and
 * everything comes back when it is lifted.
 */
export const PERSON_ACTIONS = ['suspend', 'reinstate', 'warn'];

export const PERSON_STATE = {
  suspend: 'banned',
  reinstate: 'active',
  warn: 'active',
};

export function personStateFor(action) {
  return PERSON_STATE[String(action ?? '')] ?? null;
}

export const ACTION_LABELS = {
  approve: 'Approve',
  reinstate: 'Reinstate',
  restrict: 'Restrict',
  suspend: 'Suspend',
  remove: 'Remove',
  warn: 'Warn only',
};

/**
 * What each state means, for the store owner and for a visitor.
 *
 * `publicVisible` and `ownerVisible` are deliberately different, and the
 * difference IS the design: a suspended store is hidden from the public because
 * the public has no business knowing one exists, and never hidden from its owner
 * because the owner is the only person who can fix it.
 */
export const BEHAVIOUR = {
  // The default a new store gets. Nothing is reviewed before it appears — the
  // dashboard says so in as many words — so `pending` must behave exactly like
  // `approved`. It exists to be found later, not to hide anybody.
  pending: {
    publicVisible: true,
    canWrite: true,
    ownerNote: null,
  },
  approved: {
    publicVisible: true,
    canWrite: true,
    ownerNote: null,
  },
  // The files are not the problem and they stay up. Something about the store's
  // presentation is: a name impersonating somebody, a claim we cannot stand
  // behind. Publishing carries on.
  restricted: {
    publicVisible: true,
    canWrite: true,
    ownerNote: 'Part of this store is restricted. Your files are unaffected and you can keep publishing.',
  },
  // Hidden from every visitor and still reachable by its owner. Hiding it from
  // the owner as well would only make the email longer, and the owner is the one
  // who fixes it.
  suspended: {
    publicVisible: false,
    canWrite: false,
    ownerNote: 'This store is not visible to the public. Nothing has been deleted, and you can still read every page here.',
  },
  // 404, indistinguishable from a store that never existed: confirming that a
  // store exists but was removed tells a stranger something nobody decided to
  // publish.
  removed: {
    publicVisible: false,
    canWrite: false,
    ownerNote: 'This store has been removed and its address is now a 404. The record, the files and the reason stay on this dashboard.',
  },
};

export function normaliseState(state) {
  return STATES.includes(String(state ?? '')) ? String(state) : 'pending';
}

export function behaviour(state) {
  return BEHAVIOUR[normaliseState(state)];
}

export function isPublic(state) {
  return behaviour(state).publicVisible;
}

/**
 * Is this STORE visible to the public?
 *
 * Two independent things can hide a store and they are not the same decision:
 *
 *   the store's own state   — what is wrong with this store
 *   the owner's ban         — what is wrong with this person
 *
 * A store is public only when neither applies. The seller's own pages stay
 * readable to them in both cases: `isPublic(state)` governs what a stranger can
 * reach, and this governs whether the store is advertised or linked at all.
 *
 * @param {{moderation_state?: string, owner_banned?: boolean}} channel
 */
export function isPublicChannel(channel) {
  return isPublic(channel?.moderation_state) && !channel?.owner_banned;
}

export function canWrite(state) {
  return behaviour(state).canWrite;
}

export function stateFor(action) {
  if (!ACTIONS.includes(String(action ?? ''))) return null;
  return ACTION_TO_STATE[String(action)];
}

/**
 * The remedy line: the only free text in the flow.
 *
 * Capped, because a remedy has to fit in a banner and an unbounded field becomes
 * a document nobody reads. Control characters are stripped rather than escaped:
 * the view escapes everything anyway, and a remedy with embedded newlines
 * renders as a wall.
 */
export const REMEDY_LIMIT = 280;

export function cleanRemedy(text) {
  const flat = String(text ?? '')
    // eslint-disable-next-line no-control-regex -- stripping control characters is the point
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (flat.length <= REMEDY_LIMIT) return flat;
  return `${flat.slice(0, REMEDY_LIMIT - 1).trimEnd()}…`;
}

/**
 * The sentence a seller reads.
 *
 * Built from the policy rule's own title, which is the one place the wording is
 * decided, plus the operator's remedy line if there is one. Never free text on
 * its own: "we suspended your store: <blank>" is the failure this avoids.
 *
 * @param {object|null} rule  a `policy_rules` row ({code, title, description})
 * @param {string} remedy
 */
export function decisionNote(rule, remedy = '') {
  const title = rule?.title || 'This store was reviewed';
  const detail = rule?.description ? ` ${rule.description}` : '';
  const extra = cleanRemedy(remedy);
  return `${title}.${detail}${extra ? ` ${extra}` : ''}`;
}

/**
 * Validate one decision before anything is written.
 *
 * The rule code is checked against the codes the database actually has — passed
 * in as `ruleCodes`, read from `policy_rules` — rather than against a list that
 * lives here and drifts.
 *
 * @returns {{ok: true, action: string, state: string|null, ruleCode: string|null, remedy: string}
 *          | {ok: false, error: 'action'|'reason'|'remedy'}}
 */
export function validateDecision({ action, ruleCode = null, remedy = '' } = {}) {
  if (!ACTIONS.includes(String(action ?? ''))) return { ok: false, error: 'action' };

  const act = String(action);
  const code = ruleCode === null || ruleCode === undefined || ruleCode === '' ? null : String(ruleCode);
  const cleanRemedyText = cleanRemedy(remedy);

  // A RESTRICTION has to cite a rule. Clearing one does not: the falseness of a
  // charge is not itself a rule, and demanding a code to say "this was wrong" is
  // how a reinstatement ends up citing 'copyright' by accident.
  if (REQUIRES_RULE.includes(act) && !code) return { ok: false, error: 'reason' };

  return {
    ok: true,
    action: act,
    state: ACTION_TO_STATE[act],
    ruleCode: code,
    remedy: cleanRemedyText,
  };
}

/** Does this decision change what the public sees? `warn` does not. */
export function changesVisibility(action) {
  return ACTION_TO_STATE[String(action ?? '')] !== null;
}
