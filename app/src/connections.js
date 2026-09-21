/**
 * Connecting a store to an ad network.
 *
 * Two facts make this flow different from every "connect your account" button
 * you have seen, and both come from the revenue model:
 *
 *   THE ACCOUNT IS THE CREATOR'S. We never ask for a network login, never hold
 *   a publisher id, and never make the payout ours to forward. What the seller
 *   gives us is the *verification secret* their network uses to sign callbacks
 *   — a value that authorises nothing but the verification of an event we were
 *   told about. `ad_connections.credential_ref` stays an opaque handle.
 *
 *   WE HAVE AN ADAPTER OR WE DO NOT CONNECT. The registry lists 26 networks;
 *   we can verify postbacks from four. Connecting to the rest would produce a
 *   connection that looks live and can never grant an unlock, so those are
 *   shown as reference with what the seller can still do today. A button that
 *   lies is worse than a missing button.
 *
 * The flow:
 *
 *   paste_credentials  sign up there, paste their secret here, we verify
 *   none               nothing to do (our own house network)
 *   unsupported        listed, not connectable: no adapter yet
 *
 * The postback URL is built from the registry's own dialect description, so the
 * page cannot drift from the adapter that parses it: one is generated from the
 * other's mapping.
 */

/** Modes. `unsupported` is derived, not stored. */
export const MODES = ['paste_credentials', 'none', 'unsupported'];

/**
 * What this provider needs, in the terms of somebody who is about to open the
 * network's dashboard in another tab.
 */
export function onboardingFor(provider = {}) {
  const raw = provider.onboarding || {};
  const credentials = Array.isArray(raw.credentials) ? raw.credentials : [];
  return {
    mode: MODES.includes(raw.mode) ? raw.mode : 'unsupported',
    signupUrl: typeof raw.signupUrl === 'string' ? raw.signupUrl : null,
    steps: Array.isArray(raw.steps) ? raw.steps : [],
    credentials,
    postback: raw.postback || null,
    // The one thing the seller must be able to find again: where our URL goes.
    needsSecret: credentials.length > 0,
  };
}

/** True when we ship an adapter that can verify this network's callbacks. */
export function connectable(provider = {}) {
  const o = onboardingFor(provider);
  return o.mode === 'paste_credentials' || o.mode === 'none';
}

/**
 * The URL the seller pastes into the network's panel.
 *
 * The network's macros are left in place, because the network substitutes them:
 * `{uid}` must survive into their dashboard exactly as written. Everything else
 * is encoded, so a connection id can never break the query string it lives in.
 *
 * @returns {string|null} null when we have no dialect (no adapter => no URL)
 */
export function postbackUrl({ provider, connectionId, baseUrl = '' }) {
  const { postback } = onboardingFor(provider);
  if (!postback || !connectionId) return null;
  const base = String(baseUrl || '').replace(/\/+$/, '');
  if (!base) return null;

  const parts = [];
  for (const p of postback.params || []) {
    const value = p.theirs ?? p.value ?? null;
    if (value === null || value === undefined) continue;
    parts.push(`${encodeURIComponent(p.ours)}=${value}`);
  }
  const query = parts.join('&');
  return `${base}/api/ads/postback/${encodeURIComponent(provider.id)}/${encodeURIComponent(connectionId)}${query ? `?${query}` : ''}`;
}

/**
 * Is the pasted value usable as a verification secret?
 *
 * Deliberately strict about whitespace and length: a secret pasted with a
 * trailing newline verifies nothing, and every signature check then fails with
 * the same unhelpful message. A secret that is too short is refused here rather
 * than accepted and relied upon.
 */
export function validateCredential(field = {}, value) {
  const v = typeof value === 'string' ? value : '';
  if (!v.trim()) return { ok: false, error: `${field.label || 'That value'} is empty.` };
  if (v !== v.trim()) return { ok: false, error: 'That value has whitespace at one end — copy it again.' };
  if (field.secret && v.trim().length < 8) {
    return { ok: false, error: `${field.label || 'That value'} looks too short to be a secret. Check the network dashboard.` };
  }
  return { ok: true, value: v };
}

/** What we may show back. A secret is never displayed again; a hint is. */
export function maskSecret(value) {
  const v = String(value || '');
  if (!v) return null;
  return v.length <= 4 ? '••••' : `••••${v.slice(-4)}`;
}

/**
 * Whether this connection is actually working, in one sentence.
 *
 * The support question this answers — "I connected it and nothing unlocks" — is
 * almost always one of three things: no secret saved, the URL never pasted on
 * the network's side, or a network that takes days to reconcile. The page has to
 * be able to tell them apart from evidence rather than from a colour.
 *
 * @param {object} args
 * @param {object} args.connection   the row
 * @param {string} [args.lastPostbackAt]
 * @param {number} [args.postbacks30d]
 * @param {boolean} [args.sandbox]    our own test network
 * @param {Date}   [args.now]
 */
export function connectionHealth({
  connection = {}, lastPostbackAt = null, postbacks30d = 0, sandbox = false,
  connectable: canVerify = true, now = new Date(),
}) {
  // A network we have no adapter for cannot be verified at all, and the honest
  // reading of "connected but never called back" would be wrong here: no
  // callback was ever possible. The dashboard cannot create this state, but a
  // database can arrive in it (a deployment that enabled a network later, a
  // registry change), and the page has to say which one it is looking at.
  if (connection.status !== 'revoked' && !canVerify) {
    return {
      level: 'noadapter',
      label: 'No adapter',
      detail: 'We cannot serve this network\'s tag or verify its callbacks, so nothing through it will unlock. '
        + 'It stays in your record, and the earnings side still works: the network pays you directly and you record what it reports.',
    };
  }
  if (connection.status === 'revoked') {
    return { level: 'off', label: 'Disconnected', detail: 'Revoked. Anything it gated stops unlocking, and its callbacks are refused.' };
  }
  if (sandbox) {
    return {
      level: 'sandbox',
      label: 'Sandbox',
      detail: 'Our own network. It grants unlocks with no account behind it, and pays nobody — useful for testing, not for earning.',
    };
  }
  if (!connection.callback_secret) {
    return {
      level: 'unverified',
      label: 'Not verified',
      detail: 'No secret saved yet, so every callback from this network is refused. Nothing will unlock through it until you paste one.',
    };
  }
  if (!lastPostbackAt) {
    return {
      level: 'silent',
      label: 'Never called back',
      detail: 'Connected, and we have never received a callback from it. Nine times out of ten the postback URL was not saved in the network\u2019s dashboard.',
    };
  }
  const ageMs = now.getTime() - new Date(lastPostbackAt).getTime();
  const days = Math.floor(ageMs / 86_400_000);
  const when = days === 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
  if (days <= 7) {
    return {
      level: 'live',
      label: 'Working',
      detail: `${postbacks30d} callback${postbacks30d === 1 ? '' : 's'} in thirty days, the last ${when}. Unlocks through it are being verified and granted.`,
    };
  }
  return {
    level: 'quiet',
    label: 'Quiet',
    detail: `Last callback ${when}. Offerwalls reconcile over days, so a gap is not proof of a fault — but if this store is getting traffic, check the URL in the network's dashboard.`,
  };
}

/**
 * What the seller can still do when we ship no adapter for a network.
 *
 * The earnings half of the product works without an adapter, and that is not a
 * consolation: the network pays them directly whether or not we can read its
 * callbacks, and the statement figure they record is what keeps the estimate
 * honest.
 */
export function unconnectableNote(provider = {}) {
  const o = onboardingFor(provider);
  if (o.mode !== 'unsupported') return null;
  if (provider.blockedReason) return provider.blockedReason;
  return `We have no adapter for ${provider.name} yet, so we cannot install its tag or verify its callbacks. `
    + 'You can still sign up there in your own name and record what it reports on your earnings page — that is what keeps the estimate honest.';
}
