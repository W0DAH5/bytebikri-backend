/**
 * Resolution service — the core of what bytebikri owns.
 *
 * Given a page and a space, decide what fills each slot.
 * Deterministic. Auditable. Never leaves a slot unresolved.
 *
 * Also builds referral-aware connect URLs: onboarding and monetisation
 * are the same code path.
 */
import { allocateSlots, POLICY } from './allocate.js'
import { validateAssignment, providerById } from './registry.js'
import { adapterFor } from './adapters.js'

/* ------------------------------------------------------------------ referral */

/**
 * Build the outbound connect URL, carrying the platform's referral identity.
 *
 * The referral param is SERVER-SIDE ONLY — it must never appear in a client
 * payload or API response, or tenants will inject their own.
 */
export function buildConnectUrl({ provider, platformRefId, spaceId, returnUrl, state }) {
  const base = provider.signupUrl ?? `https://${provider.id}.example/signup`
  const u = new URL(base)

  // Never emit an unverified parameter name — a guessed param silently breaks attribution
  // and you would not notice until the first commission statement fails to arrive.
  const param = provider.referral?.param
  const paramUsable = param && !String(param).includes('VERIFY')

  if (paramUsable && platformRefId) {
    u.searchParams.set(param, platformRefId)
    if (provider.referral.subIds === true) {
      u.searchParams.set('subid', spaceId) // per-space attribution, where offered
    }
  }
  u.searchParams.set('returnUrl', returnUrl)
  u.searchParams.set('state', state)
  return { url: u.toString(), referralAttached: Boolean(paramUsable && platformRefId) }
}

/* --------------------------------------------------------------- resolution */

/**
 * Resolve one slot.
 *
 * Fallback chain — every branch is a DEFINED outcome:
 *
 *   tenant connection active & compatible?  -> tenant ad
 *        | no
 *   tenant has a pending/restricted conn?   -> COLLAPSE (reserve space, render nothing)
 *        | no
 *   platform slot & platform demand exists? -> platform/house ad
 *        | no
 *                                           -> COLLAPSE
 *
 * COLLAPSE reserves the space rather than reflowing, because a layout shift
 * damages Core Web Vitals and therefore EVERY tenant's ad rates.
 */
export function resolveSlot({ allocation, registry, space, connections, platformDemand }) {
  const slot = allocation.slot
  const result = {
    slotKey: slot.key,
    rank: slot.rank,
    owner: allocation.owner,
    height: slot.height,
    outcome: 'collapse',
    provider: null,
    html: '',
    meta: { reserved: true },
  }

  if (allocation.owner === 'platform') {
    if (platformDemand?.available) {
      result.outcome = 'platform_ad'
      result.provider = 'house'
      result.html = platformDemand.html
      result.meta = { revenueTo: 'platform', reserved: false }
    }
    return result // else collapse — reserved space, never a broken box
  }

  // owner === 'tenant'
  const candidates = connections
    .map((c) => ({ connection: c, provider: providerById(registry, c.providerId) }))
    .filter(({ provider }) => provider)

  const active = candidates.filter(({ connection, provider }) => {
    if (connection.status !== 'active') return false
    return validateAssignment(provider, slot).ok
  })

  if (active.length > 0) {
    const { connection, provider } = active[0]
    const adapter = adapterFor(provider, registry.providers)
    if (adapter) {
      const rendered = adapter.render(slot, { credentials: connection.credentials, tenant: space.name })
      if (rendered.kind === 'served') {
        result.outcome = 'tenant_ad'
        result.provider = provider.id
        result.html = rendered.html
        result.meta = { ...rendered.meta, reserved: false }
        return result
      }
      result.outcome = 'tenant_noop' // configured but nothing to render
      result.meta = { ...rendered.meta, reserved: true }
      return result
    }
  }

  // Any non-active connection means "this tenant intends to monetise, but can't right now".
  const blocked = candidates.find(({ connection }) =>
    ['pending', 'restricted', 'revoked', 'failed'].includes(connection.status),
  )
  if (blocked) {
    result.outcome = 'blocked_collapse'
    result.meta = { reserved: true, reason: `connection ${blocked.connection.status}` }
  }

  return result
}

/** Resolve every slot on a page. */
export function resolvePage({ space, registry, connections, houseCopy, platformEnabled = true }) {
  const slotKeys = space.pageSlots ?? undefined
  const allocations = allocateSlots(
    slotKeys ?? ['top_leaderboard', 'in_article_1', 'sidebar_sticky', 'in_article_2', 'footer_native'],
    space,
    POLICY,
  )

  const platformDemand = platformEnabled
    ? {
        available: true,
        html: `<div class="ad ad-house"><span class="ad-label">bytebikri</span><strong>${
          houseCopy ?? 'Sell your digital work here'
        }</strong></div>`,
      }
    : null

  const slots = allocations.map((allocation) =>
    resolveSlot({ allocation, registry, space, connections, platformDemand }),
  )

  const tenantFilled = slots.filter((s) => s.outcome === 'tenant_ad').length
  const platformFilled = slots.filter((s) => s.outcome === 'platform_ad').length

  return {
    spaceId: space.id,
    spaceName: space.name,
    entitlements: space.entitlements ?? [],
    slots,
    summary: {
      total: slots.length,
      tenantFilled,
      platformFilled,
      collapsed: slots.length - tenantFilled - platformFilled,
      platformSharePct: slots.length ? Math.round((platformFilled / slots.length) * 100) : 0,
    },
  }
}
