/**
 * Adapter layer — capability-aware, not a switch statement.
 *
 * Every adapter implements the same contract:
 *   { id, slotModel, render(slot, ctx) -> { html, kind, meta } }
 *
 * Adding a provider = adding a file here + a registry entry.
 * That is the "volatile" design done properly: volatility lives in this layer,
 * while identity/resolution/logging stay stable.
 */

/* ------------------------------------------------------------------ house */

/**
 * THE FLOOR OF EVERY SLOT. Ship this first.
 * A slot with no fill is a broken page; a house ad is a defined outcome.
 */
export const houseAdapter = {
  id: 'house',
  slotModel: 'per_slot',
  render(slot, ctx) {
    return {
      kind: 'served',
      html: `<div class="ad ad-house" style="height:${slot.height}px">
        <span class="ad-label">bytebikri</span>
        <strong>${ctx.houseCopy ?? 'Sell your digital work here'}</strong>
      </div>`,
      meta: { provider: 'house', revenueTo: 'platform' },
    }
  },
}

/* -------------------------------------------------------------- affiliate */

/**
 * link_rewrite — a genuinely different render path.
 *
 * This adapter does NOT emit a display slot. It rewrites the tenant's OWN
 * outbound links, injecting their affiliate tag. The merchant pays them
 * directly; the platform never touches the money.
 *
 * This is the most permissive category: no domain ownership, no site approval,
 * no ads.txt, no shared-policy exposure.
 */
export const affiliateAdapter = {
  id: 'affiliate_generic',
  slotModel: 'link_rewrite',
  render(_slot, ctx) {
    const tag = ctx.credentials?.affiliateTag
    if (!tag) return { kind: 'noop', html: '', meta: { reason: 'no affiliate tag configured' } }
    return {
      kind: 'rewrite',
      html: '',
      meta: {
        provider: 'affiliate_generic',
        // Applied to the tenant's own <a> elements at render time.
        rewrite: (href) => {
          const u = new URL(href)
          u.searchParams.set(ctx.credentials?.param ?? 'tag', tag)
          return u.toString()
        },
        revenueTo: 'tenant',
      },
    }
  },
}

/* ---------------------------------------------------------------- per-zone */

/**
 * per_zone providers (Adsterra, Monetag, PropellerAds, PopCash, Adcash…).
 * The tenant pastes a zone/tag ID from their OWN account; we render it in
 * their slot. The network pays the tenant directly.
 */
export function makePerZoneAdapter(provider) {
  return {
    id: provider.id,
    slotModel: 'per_zone',
    render(slot, ctx) {
      const zoneId = ctx.credentials?.zoneId
      if (!zoneId) return { kind: 'noop', html: '', meta: { reason: 'no zone id configured' } }
      return {
        kind: 'served',
        html: `<div class="ad ad-tenant" data-provider="${provider.id}"
                     data-zone="${zoneId}" data-slot="${slot.key}"
                     style="min-height:${slot.height}px">
          <span class="ad-label">${provider.name}</span>
          <code>zone ${zoneId}</code>
        </div>`,
        meta: { provider: provider.id, revenueTo: 'tenant' },
      }
    },
    buildConnectUrl: (referralParam, platformRefId, spaceId, returnUrl, state) => {
      const u = new URL(`https://${provider.id}.example/signup`)
      if (referralParam && platformRefId) u.searchParams.set(referralParam, platformRefId)
      if (spaceId) u.searchParams.set('subid', spaceId)
      u.searchParams.set('returnUrl', returnUrl)
      u.searchParams.set('state', state)
      return u.toString()
    },
  }
}

/* ---------------------------------------------------------------- registry */

export function adapterFor(provider, allProviders) {
  if (provider.id === 'house') return houseAdapter
  if (provider.slotModel === 'link_rewrite') return affiliateAdapter
  if (provider.slotModel === 'per_zone') return makePerZoneAdapter(provider)
  return null // per_slot display providers (AdSense) require OAuth; not in this prototype
}
