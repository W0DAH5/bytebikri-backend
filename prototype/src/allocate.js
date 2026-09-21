/**
 * Slot policy + deterministic allocation.
 *
 * Implements revenue-capture.md workaround B: the platform keeps ONE placement
 * per page as rent, captured in inventory, never in cash.
 *
 * Three fairness rules, enforced here and testable:
 *   1. never rank 1        (best position always belongs to the tenant)
 *   2. never tax a short page (under minTenantSlots, platform takes nothing)
 *   3. one slot, never more
 */

export const POLICY = {
  policy: 'last_rank_reserved',
  platformSlotsPerPage: 1,
  platformTakesRank: 'last',
  minTenantSlotsBeforeTax: 3,
  releaseOnEntitlements: ['pro', 'custom_domain'],
  maxTotalAdsPerPage: 5,
}

/** The closed set of platform-defined slots. Tenants never invent new ones. */
export const PLACEMENT_SLOTS = [
  { key: 'top_leaderboard', rank: 1, position: 'above_fold', formats: ['display'], height: 90 },
  { key: 'in_article_1', rank: 2, position: 'in_content', formats: ['display', 'native'], height: 250 },
  { key: 'sidebar_sticky', rank: 3, position: 'sidebar', formats: ['display'], height: 600 },
  { key: 'in_article_2', rank: 4, position: 'in_content', formats: ['display', 'native'], height: 250 },
  { key: 'footer_native', rank: 5, position: 'footer', formats: ['native'], height: 120 },
]

export function isEntitled(space, policy = POLICY) {
  const ents = space.entitlements ?? []
  return policy.releaseOnEntitlements.some((e) => ents.includes(e))
}

/**
 * Deterministic: the same page always yields the same allocation.
 * No randomness, no round-robin, no per-request drift.
 *
 * @param {string[]} slotKeys  which slots this page actually renders
 * @param {object}   space     { id, entitlements: string[] }
 * @returns {{slot: object, owner: 'tenant'|'platform'}[]}
 */
export function allocateSlots(slotKeys, space, policy = POLICY) {
  const slots = slotKeys
    .map((k) => PLACEMENT_SLOTS.find((s) => s.key === k))
    .filter(Boolean)
    .slice(0, policy.maxTotalAdsPerPage)

  const ranked = [...slots].sort((a, b) => a.rank - b.rank)

  // Rule 3: short pages are never taxed.
  const taxable = ranked.length >= policy.minTenantSlotsBeforeTax && !isEntitled(space, policy)

  if (!taxable) {
    return ranked.map((slot) => ({ slot, owner: 'tenant' }))
  }

  // Rule 1: never rank 1 — the platform takes the LAST (lowest-value) rank.
  const platformSlot = ranked[ranked.length - 1]

  return ranked.map((slot) => ({
    slot,
    owner: slot.key === platformSlot.key ? 'platform' : 'tenant',
  }))
}

/**
 * Estimated monthly value of the platform's take for a space.
 * Powers the Pro buyout pitch: "your platform slot is worth ~NPR X/month".
 */
export function estimatePlatformSlotValue(space, usdPerPagePerMonth, nprPerUsd = 134) {
  const allocation = allocateSlots(space.pageSlots ?? PLACEMENT_SLOTS.map((s) => s.key), space)
  const platformCount = allocation.filter((a) => a.owner === 'platform').length
  if (platformCount === 0 || allocation.length === 0) {
    return { usd: 0, npr: 0, sharePct: 0, platformCount }
  }
  const share = platformCount / allocation.length
  const usd = usdPerPagePerMonth * share
  return { usd, npr: usd * nprPerUsd, sharePct: share * 100, platformCount }
}
