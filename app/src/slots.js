/**
 * Slot allocation policy.
 *
 * THE RULE, in one line: bytebikri owns WHERE, the channel owns WHAT.
 * Channels never create, resize or reposition a slot — they only decide which
 * provider fills it. That keeps ad density, layout and policy enforceable.
 *
 * Allocation is DETERMINISTIC. The same channel always produces the same plan,
 * because a channel that gets a different deal on every pageview cannot reason
 * about their own revenue — and neither can support.
 *
 * Fairness rules, each of which is a promise to the channel:
 *   1. The platform never takes rank 1.
 *   2. A page with no position at all is never taxed.
 *   3. One rent slot per page, never more.
 *   4. Empty slots reserve their height. They are never collapsed, because
 *      reflowing a page damages Core Web Vitals and therefore every channel's
 *      ad rates.
 *
 * DENSITY, as of migration 0034: the store's own positions are `slot_count` and
 * that number is 1 (Free) or 2 (Store, Pro). The platform's own position is a
 * SEPARATE position, taken from the rank immediately after the store's last one —
 * never one of the store's, and never rank 1. So the longest page in the product
 * carries three boxes: two the store owns and one ours. The old model converted
 * the store's lowest-ranked position into ours, which stopped being workable the
 * moment the cap came down to one: a Free store would have had its only position
 * taken, at rank 1, which is the one rule this file has never broken.
 */

export const POLICY = {
  platformSlotsPerPage: 1,
  platformTakesRank: 'last',
  minTenantSlotsBeforeTax: 1,
  // The platform's row is counted on top of the store's, so the total on a page
  // is slot_count + platformSlotsPerPage and this is the outer bound of that sum.
  maxTotalSlots: 3,
  releasedBy: 'ad_free', // capability flag; all plans default false for now

  /**
   * The rate and the exchange rate our ESTIMATES use.
   *
   * Here, in policy, exactly once. Both the rent estimate and the earnings page
   * are arithmetic on this number, and they must not be able to drift apart:
   * a creator checking their rent against their statement is comparing two
   * figures that came from the same assumption, and that is only meaningful if
   * there is one assumption. It is displayed on both pages for the same reason.
   */
  assumedRpmUsd: 0.2,
  usdToNpr: 133,
}

/**
 * @param {object} args
 * @param {Array<{key,label,rank,formats,max_height_px}>} args.slotDefs
 * @param {Record<string, boolean|number>} args.capabilities  resolved plan capabilities
 * @param {Array<{id,provider_id,status}>} args.connections
 * @param {string[]} args.surfaces  surfaces the viewer supports, e.g. ['web','app']
 * @returns {Array<object>} one entry per slot, in rank order
 */
export function allocateSlots({ slotDefs, capabilities, connections, surfaces = ['web'] }) {
  const maxSlots = Math.max(0, Math.min(Number(capabilities.slot_count) || 0, POLICY.maxTotalSlots))
  const pool = slotDefs
    .filter((s) => s.active !== false)
    .filter((s) => (s.surfaces ?? []).some((x) => surfaces.includes(x)))
    .sort((a, b) => a.rank - b.rank)

  // The store's positions, then OURS — the next rank down, which is the least
  // valuable position on the page that is not already the store's.
  const own = pool.slice(0, maxSlots)
  const rentDef = pool[own.length] ?? null

  // Rule: a page with no position at all is never taxed, and a position at rank 1
  // is never taken from the store.
  const rentSlotApplies =
    own.length >= POLICY.minTenantSlotsBeforeTax &&
    Boolean(rentDef) &&
    rentDef.rank > 1 &&
    capabilities[POLICY.releasedBy] !== true

  const rentSlotKey = rentSlotApplies ? rentDef.key : null

  const activeConnections = (connections ?? []).filter((c) => c.status === 'active')

  return (rentSlotApplies ? [...own, rentDef] : own).map((slot) => {
    const isRent = slot.key === rentSlotKey
    // Which surface THIS instance is rendered on, from the surfaces the caller
    // asked for — not from the definition. A def that supports both (rank 1,
    // and the footer strip) was previously labelled `app_native` on every web
    // page, so the web renderer dropped it and the store paid rent for a slot
    // that never appeared anywhere.
    const surface = surfaces.includes('web') ? 'webview' : 'app_native'

    if (isRent) {
      return {
        slotKey: slot.key,
        label: slot.label,
        rank: slot.rank,
        maxHeightPx: slot.max_height_px,
        formats: slot.formats,
        surface,
        payoutParty: 'platform',          // our revenue
        owner: 'platform',
        connectionId: null,
        state: 'serving',
        serving: true,
        reason: 'platform rent slot — last position, never rank 1',
      }
    }

    const conn = activeConnections.find((c) => c.slot_keys?.includes(slot.key))
      ?? activeConnections[0]    // fall back to the channel's first active connection
      ?? null

    if (!conn) {
      return {
        slotKey: slot.key,
        label: slot.label,
        rank: slot.rank,
        maxHeightPx: slot.max_height_px,
        formats: slot.formats,
        surface,
        payoutParty: 'channel',
        owner: 'channel',
        connectionId: null,
        state: 'reserved_empty',   // height reserved; never collapse (no layout shift)
        serving: false,
        reason: 'no active ad connection — space reserved, nothing rendered',
      }
    }

    return {
      slotKey: slot.key,
      label: slot.label,
      rank: slot.rank,
      maxHeightPx: slot.max_height_px,
      formats: slot.formats,
      surface,
      payoutParty: 'channel',      // their revenue, paid to them directly by the network
      owner: 'channel',
      connectionId: conn.id,
      providerId: conn.provider_id,
      state: 'serving',
      serving: true,
      reason: `filled by channel connection (${conn.provider_id})`,
    }
  })
}

/**
 * What the rent slot is worth, so the pitch can be arithmetic rather than a
 * claim. Uses trailing pageviews and an assumed RPM — both stated, never hidden.
 *
 * Shown to the channel as OUR ESTIMATE. Their real earnings number lives in the
 * ad network's dashboard, and we must never present ours as theirs.
 */
export function estimateRentSlotValue({ pageviews30d, rpmUsd = POLICY.assumedRpmUsd, slots, usdToNpr = POLICY.usdToNpr }) {
  const total = slots?.length || 0
  const rent = (slots || []).filter((s) => s.payoutParty === 'platform').length
  if (!total || !rent) return { estNpr: 0, total, rent, rpmUsd, pageviews30d }

  const pageRevenueUsd = (pageviews30d / 1000) * rpmUsd
  const perSlotUsd = pageRevenueUsd / total
  const estNpr = Math.round(perSlotUsd * rent * usdToNpr)
  return { estNpr, total, rent, rpmUsd, pageviews30d, perSlotUsd: Number(perSlotUsd.toFixed(4)) }
}
