/**
 * Country rules: who a file is for, and what a visitor is told when it is not.
 *
 * `asset_country_rules` has existed since migration 0001 and no route ever read
 * it, so every file was available in every country — including the two the
 * platform's own policy table has rows for. This module is the resolution the
 * read path was missing, and it is deliberately pure: no database, no request,
 * no HTML. Everything here can be tested with three objects and no server.
 *
 * THE MODEL, in one paragraph. `asset_country_rules` is what somebody decided
 * about one file in one country: `allowed`, `restricted` or `blocked`, and who
 * decided — the file's own creator (`source='creator'`, a licensing choice) or
 * an operator citing a row of `policy_rules` (`source='operator'`).
 * `content_geo_blocks` is the enforcement index: a block decided about a whole
 * STORE lands there once and applies to every file in it, which is how a rule
 * about a shop's contents does not need a row per file. Resolution is
 * most-specific-wins: an asset rule beats an inherited store block, always —
 * which is the point of writing one, and the only way an operator can carve an
 * exception out of a store-wide decision.
 *
 * THREE THINGS THIS FILE REFUSES TO DO:
 *
 *   1. Guess a country. There is no GeoIP database here and no lookup; the
 *      country comes from the edge (`CF-IPCountry`), and when the edge does not
 *      say, the answer is `null` and NO country rule applies. Failing open is
 *      the deliberate choice: a missing header would otherwise black out a file
 *      for the whole world the first time a proxy stripped it. The operator page
 *      says out loud that a request without the header is not covered.
 *
 *   2. Invent the reason. A visitor is told either the rule's own title (an
 *      operator decision, which always cites a rule) or that the creator chose
 *      it. There is no free-text sentence from a form in either path.
 *
 *   3. Let a cache move a block. Every response that depends on the viewer's
 *      country is sent `Cache-Control: private, no-store`. `Vary` is sent too,
 *      because it is correct, but it is NOT relied on: CDNs are documented to
 *      strip it, and a cached Indian 451 served to a Nepali visitor is a bug
 *      that looks like the platform is broken. `no-store` is the load-bearing
 *      header; `Vary` is a courtesy to proxies that honour it.
 */

import { countryIn, countryName, isCountryCode, NOT_A_COUNTRY } from './countries.js';
import { cleanRemedy, isAssetPublic, isAssetUnlockable, normaliseAssetState } from './moderation.js';

/** The `asset_country_rules.state` CHECK, verbatim. */
export const RULE_STATES = ['allowed', 'restricted', 'blocked'];

/**
 * The header a country is read from.
 *
 * Cloudflare's, because that is what sits in front of this deployment. The value
 * is only as trustworthy as the edge: a client that can reach the origin
 * directly can send this header itself, which is why DEPLOY.md says the origin
 * must not be publicly reachable except through the proxy.
 */
export const COUNTRY_HEADER = 'cf-ipcountry';

/**
 * The country of the request, or null.
 *
 * `dev` allows a `?country=` override so the whole feature can be exercised on a
 * laptop with no edge in front of it. It is off in production by construction
 * (`!isProd` at the call sites): a query parameter that changes what a visitor
 * may see is not a testing convenience, it is a bypass with a URL.
 *
 * @param {{headers?: Object, query?: Object}} req
 * @param {{dev?: boolean}} [options]
 */
export function countryFrom(req, { dev = false } = {}) {
  const header = String(req?.headers?.[COUNTRY_HEADER] ?? req?.headers?.['x-country-code'] ?? '').trim().toUpperCase();
  if (isCountryCode(header)) return header;
  if (NOT_A_COUNTRY.includes(header)) return null;

  if (dev) {
    const asked = String(req?.query?.country ?? '').trim().toUpperCase();
    if (isCountryCode(asked)) return asked;
  }
  return null;
}

/**
 * What applies to this viewer: the asset's own rule, or the store's block.
 *
 * Most specific wins, and an unknown state fails CLOSED to `blocked`: a row this
 * code cannot read is not a reason to serve the file.
 *
 * @param {{assetRule?: object|null, channelBlock?: object|null}} rows
 */
export function resolveCountry({ assetRule = null, channelBlock = null } = {}) {
  if (assetRule) {
    const state = RULE_STATES.includes(String(assetRule.state))
      ? String(assetRule.state)
      : 'blocked';
    return {
      state,
      source: assetRule.source === 'creator' ? 'creator' : 'operator',
      ruleCode: assetRule.rule_code ? String(assetRule.rule_code) : null,
      // The creator's own note is for the creator and the operator. It is never
      // shown to a visitor: a private note shown in public is how an offhand
      // sentence becomes the platform's statement.
      note: assetRule.reason ? String(assetRule.reason) : null,
      setBy: assetRule.set_by ? String(assetRule.set_by) : null,
      decidedAt: assetRule.updated_at ?? assetRule.created_at ?? null,
      inherited: false,
      // The file was allowed back into a country whose STORE is withheld. That
      // is a carve-out, and it is the one state here that looks like no decision
      // was made at all — so it has to be nameable, or the page cannot tell the
      // visitor that the store around this file is closed to them.
      carveOut: state === 'allowed' && Boolean(channelBlock),
    };
  }
  if (channelBlock) {
    return {
      state: 'blocked',
      source: 'operator',
      ruleCode: channelBlock.rule_code ? String(channelBlock.rule_code) : null,
      note: null,
      setBy: null,
      decidedAt: channelBlock.created_at ?? null,
      // A block that comes from the store rather than the file: the storefront
      // is what a visitor can actually change, so the copy points there.
      inherited: true,
      carveOut: false,
    };
  }
  return {
    state: null, source: null, ruleCode: null, note: null, setBy: null,
    decidedAt: null, inherited: false, carveOut: false,
  };
}

export function isBlocked(resolved) {
  return resolved?.state === 'blocked';
}

export function isRestricted(resolved) {
  return resolved?.state === 'restricted';
}

/** A rule the viewer may not be shown a file by. `allowed` says nothing. */
export function isRefused(resolved) {
  return isBlocked(resolved) || isRestricted(resolved);
}

/**
 * The status code for a country block.
 *
 * RFC 7725 defines 451 for content withheld for legal reasons, and the rule this
 * platform cites is a law or a platform policy with a legal shape — so an
 * operator block answers 451. A creator's own licensing choice answers 403,
 * which is the honest code for "the owner decided", and tells a support thread
 * which of the two they are looking at without opening the database.
 *
 * Deliberately NOT 404. A store that was removed answers 404 because confirming
 * that a store exists is itself information nobody decided to publish. A country
 * block is the opposite: the visitor has to be told, or they file a bug against
 * a platform that looks broken, and the whole point of a rule is that somebody
 * can answer for it.
 */
export function blockStatus(resolved) {
  if (!isBlocked(resolved)) return null;
  return resolved?.source === 'creator' ? 403 : 451;
}

/** The two sentences a blocked visitor gets: a headline, and why. */
export function blockSentence({ resolved, rule = null, store = 'This store', country = null } = {}) {
  // `countryIn` and not `countryName`: every one of these strings puts the name
  // inside a sentence, and "visitors in United States" is not one a person writes.
  const place = country ? countryIn(country) : 'your country';
  const title = rule?.title ? String(rule.title) : null;
  const description = rule?.description ? String(rule.description) : null;

  if (resolved?.source === 'creator') {
    return {
      headline: `Not available in ${place}`,
      why: `${store} has not made this file available in ${place}. That is the creator's choice — it is usually a licence that only covers some countries.`,
      appeal: 'If you believe you should be able to open this, ask the store. Their contact details are on the store page.',
    };
  }
  if (resolved?.inherited) {
    return {
      headline: `Not available in ${place}`,
      why: title
        ? `Files from this store are not shown to visitors in ${place} under the platform rule “${title}”.`
        : `Files from this store are not shown to visitors in ${place} under a platform rule.`,
      appeal: 'An operator decided this. If you are the creator, the decision and its reason are on your dashboard.',
    };
  }
  return {
    headline: `Not available in ${place}`,
    why: title
      ? `We do not show this file to visitors in ${place} under the platform rule “${title}”.${description ? ` ${description}` : ''}`
      : `We do not show this file to visitors in ${place} under a platform rule.`,
    appeal: 'If you think this is wrong, write to us — a person reads it, and the decision is recorded against this file.',
  };
}

/** The sentence a listed-but-unlockable file gets, in the same two parts. */
export function restrictedSentence({ resolved, rule = null, store = 'This store', country = null } = {}) {
  // `countryIn` and not `countryName`: every one of these strings puts the name
  // inside a sentence, and "visitors in United States" is not one a person writes.
  const place = country ? countryIn(country) : 'your country';
  const title = rule?.title ? String(rule.title) : null;

  if (resolved?.source === 'creator') {
    return {
      headline: `Listed, but not unlockable in ${place}`,
      why: `${store} has limited this file to some countries. You can see it; you cannot unlock it from ${place}.`,
    };
  }
  return {
    headline: `Listed, but not unlockable in ${place}`,
    why: title
      ? `It stays listed so the store makes sense, but it cannot be unlocked in ${place} under the platform rule “${title}”.`
      : `It stays listed so the store makes sense, but it cannot be unlocked in ${place} under a platform rule.`,
  };
}

/**
 * Validate a country decision before anything is written.
 *
 * The same two promises a store decision makes, in the country's vocabulary:
 * the state is one of the three the CHECK constraint has, a restriction cites a
 * rule that exists, and — the other way round — ALLOWING a country cites
 * nothing, because "this is permitted here" is not a rule and a row that says it
 * is would eventually be read back as the reason for a block.
 *
 * The rule code is checked by the caller against the codes in `policy_rules`,
 * as it is everywhere else: a list kept here would drift from the table.
 */
export function validateCountryDecision({
  state, ruleCode = null, note = '', states = RULE_STATES, requireRule = true,
} = {}) {
  const wanted = String(state ?? '');
  if (!states.includes(wanted)) return { ok: false, error: 'state' };
  const code = ruleCode === null || ruleCode === undefined || ruleCode === '' ? null : String(ruleCode);
  // A creator withholds and does not cite policy; an operator cites a rule. The
  // two calls pass different `states` and `requireRule`, so neither can quietly
  // borrow the other's vocabulary — which is exactly what happened the first
  // time this ran: a creator submitted `allowed` and the route accepted it.
  if (wanted !== 'allowed' && requireRule && !code) return { ok: false, error: 'reason' };
  if (wanted === 'allowed' && code) return { ok: false, error: 'reason' };
  return { ok: true, state: wanted, ruleCode: code, note: cleanRemedy(note) };
}

/**
 * The states a file's own creator may set.
 *
 * `allowed` is not on the list. Allowing a country is how an operator carves one
 * file out of a store-wide decision, and a creator who could say it could
 * override the platform's own rule — the disagreement they actually have is the
 * appeal, which a person reads.
 */
export const CREATOR_COUNTRY_STATES = Object.freeze(['blocked', 'restricted']);

/**
 * What one file is, to one visitor, given both decisions.
 *
 * The two decisions are independent and both are real: the file's own state
 * (`assets.moderation_state`) and the country rule that applies where the
 * visitor is standing. A file does not have to be either listed or hidden — it
 * can be listed and not unlockable for the same reason a store can be public and
 * restricted, and the three answers here are the only ones the read paths need:
 *
 *   visible   — may a stranger see the listing at all
 *   unlockable — may the unlock be attempted
 *   reason     — 'file' | 'country' | null, which decides the copy
 *
 * `removed` outranks a country rule: an operator who removed a file did not mean
 * "except where a country rule allows it".
 */
export function availabilityFor({ assetState = 'approved', resolved = null } = {}) {
  const state = normaliseAssetState(assetState);
  // `state` comes back with `reason` because the two say different things and the
  // copy needs both: `reason: 'country'` is where the refusal comes from, and
  // `state: 'restricted'` is what it is. A card that showed "Not here" for a
  // restricted file overstates the decision — the file IS listed there, and what
  // is refused is the unlock.
  if (!isAssetPublic(state)) return { visible: false, unlockable: false, reason: 'file', state: 'removed' };
  if (isBlocked(resolved)) return { visible: false, unlockable: false, reason: 'country', state: 'blocked' };
  if (!isAssetUnlockable(state)) return { visible: true, unlockable: false, reason: 'file', state: 'restricted' };
  if (isRestricted(resolved)) return { visible: true, unlockable: false, reason: 'country', state: 'restricted' };
  return { visible: true, unlockable: true, reason: null, state: null };
}

/**
 * The honest limits, as strings the operator page and the docs both use.
 *
 * A country feature that implies more coverage than it has is the same failure
 * as a protection claim that implies more protection than it has, and this
 * platform has written that lesson down twice already.
 */
export const COUNTRY_LIMITS = Object.freeze([
  'The country is read from the edge header `CF-IPCountry`. A request without it has no country, and no country rule applies to it — an unknown visitor is not a blocked one.',
  'A VPN defeats this. So does a proxy, and so does a satellite link that egresses somewhere else. Country rules decide what an honest visitor sees; they are not a security control.',
  'A direct connection to the origin can claim any country, because the header is only as good as the edge that set it. The origin must not be reachable except through the proxy.',
  'Nothing here classifies content. A rule reaches a file because a person applied it, and the operator page shows every country where something is currently blocked.',
]);

/** Where country rules are enforced, for the operator page and the tests. */
export const ENFORCED_AT = Object.freeze([
  'This file cannot be unlocked or played for a visitor whose country is blocked.',
]);
