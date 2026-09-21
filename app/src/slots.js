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
 *   2. A short page is never taxed (needs >= 3 slots before a rent slot applies).
 *   3. One rent slot per page, never more.
 *   4. Empty slots reserve their height. They are never collapsed, because
 *      reflowing a page damages Core Web Vitals and therefore every channel's
 *      ad rates.
 */

export const POLICY = {
  platformSlotsPerPage: 1,
  platformTakesRank: 'last',
  minTenantSlotsBeforeTax: 3,
  maxTotalSlots: 8,
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
  const maxSlots = Number(capabilities.slot_count) || 3
  const eligible = slotDefs
    .filter((s) => s.active !== false)
    .filter((s) => (s.surfaces ?? []).some((x) => surfaces.includes(x)))
    .sort((a, b) => a.rank - b.rank)
    .slice(0, Math.min(maxSlots, POLICY.maxTotalSlots))

  // Rule: a page too short to spare a slot is never taxed.
  const rentSlotApplies =
    eligible.length >= POLICY.minTenantSlotsBeforeTax &&
    capabilities[POLICY.releasedBy] !== true

  // Rule: rank 1 is never taken. The rent slot is the lowest-value position.
  const rentSlotKey = rentSlotApplies ? eligible[eligible.length - 1].key : null

  const activeConnections = (connections ?? []).filter((c) => c.status === 'active')

  return eligible.map((slot) => {
    const isRent = slot.key === rentSlotKey
    const surface = (slot.surfaces ?? []).includes('app') ? 'app_native' : 'webview'

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
