/**
 * Registry loader + capability queries.
 *
 * The registry is the single source of truth for what a provider can do.
 * Nothing else in the system hardcodes provider behaviour.
 *
 * Reads ../../docs/registry/providers.example.json
 */
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REGISTRY_PATH = path.resolve(__dirname, '../../docs/registry/providers.example.json')

let _cache = null

export async function loadRegistry() {
  if (_cache) return _cache
  _cache = JSON.parse(await readFile(REGISTRY_PATH, 'utf8'))
  return _cache
}

export function providerById(registry, id) {
  return registry.providers.find((p) => p.id === id) ?? null
}

/** Providers a tenant may actually pick. Disabled/blocked providers are never shown. */
export function selectableProviders(registry) {
  return registry.providers.filter((p) => p.enabled && !p.blockedReason && p.id !== 'house')
}

/** Loose sentinel check — we never present unverified values as facts. */
export const isUnverified = (v) =>
  v === 'VERIFY' || (typeof v === 'string' && v.includes('VERIFY')) || v === null || v === undefined

/**
 * Can this provider fill this slot?
 * Capability-aware, not a switch statement — the whole point of the adapter layer.
 */
export function validateAssignment(provider, slot) {
  if (!provider) return { ok: false, reason: 'unknown provider' }
  if (!provider.enabled) return { ok: false, reason: 'provider not enabled' }
  if (provider.blockedReason) return { ok: false, reason: provider.blockedReason }

  // slotModel determines the render path — a link_rewrite provider cannot fill a display box
  if (provider.slotModel === 'link_rewrite') {
    return { ok: false, reason: 'link_rewrite providers rewrite content links; they do not fill display slots' }
  }
  if (provider.slotModel === 'per_site_auto') {
    return { ok: false, reason: 'per_site_auto providers take over placement; incompatible with platform-defined slots' }
  }
  if (!['per_slot', 'per_zone'].includes(provider.slotModel)) {
    return { ok: false, reason: `unsupported slotModel: ${provider.slotModel}` }
  }

  const overlap = slot.formats.filter((f) => provider.formats.includes(f))
  if (overlap.length === 0) {
    return { ok: false, reason: `no format overlap (slot: ${slot.formats.join('/')}, provider: ${provider.formats.join('/')})` }
  }

  return { ok: true, matchedFormats: overlap }
}

/**
 * The Nepal payout verdict.
 *
 * The trap this exists to avoid: a provider's ADVERTISED minimum is almost
 * always the cheapest METHOD, not the method a Nepali user can actually use.
 * PropellerAds advertises $5 — that's PayPal/Skrill. Payoneer is $20, wire $550.
 * Showing a Nepali creator "$5" is a lie with a two-year consequence.
 *
 * So we never infer reachability from a method's name. The registry states it
 * per method (`nepalUsable: true | false | "VERIFY"`), and we report the minimum
 * for the rails that are evidenced to work. Unproven rails are surfaced as
 * pending — never as usable.
 */
export function payoutVerdict(provider) {
  const raw = provider.payoutMethods ?? []

  if (raw.length === 0) {
    return {
      level: 'unknown', threshold: null, advertisedThreshold: provider.minPayoutUsd ?? null,
      usableMethods: [], pendingMethods: [], deniedMethods: [],
      message: 'Payout methods not yet verified — cannot promise a Nepali user will get paid.',
    }
  }

  // Tolerate a stale string[] registry without crashing the picker — but note it,
  // because a bare method name cannot express Nepal-reachability.
  const methods = raw.map((m) =>
    typeof m === 'string' ? { method: m, minUsd: null, nepalUsable: 'VERIFY' } : m)

  const usable = methods.filter((m) => m.nepalUsable === true)
  const pending = methods.filter((m) => m.nepalUsable === 'VERIFY')
  const denied = methods.filter((m) => m.nepalUsable === false)

  const withNumber = usable.filter((m) => typeof m.minUsd === 'number')
  const noStatedMin = usable.filter((m) => m.minUsd === null || m.minUsd === undefined)
  const nepalMin = noStatedMin.length > 0
    ? null
    : withNumber.length ? Math.min(...withNumber.map((m) => m.minUsd)) : null

  const advertised = typeof provider.minPayoutUsd === 'number' ? provider.minPayoutUsd : null
  const blockers = []    // affect the verdict — a Nepali user may not get paid
  const advisories = []  // informational — a listed rail exists but is unusable from Nepal

  // The headline trap: advertised number is lower than anything Nepal can reach.
  if (advertised !== null && nepalMin !== null && nepalMin > advertised) {
    const cheapest = usable.find((m) => m.minUsd === nepalMin)
    blockers.push(
      `Advertised $${advertised} minimum is NOT reachable from Nepal — ` +
      `the usable rail (${cheapest.method}) needs $${nepalMin}.`)
  }

  if (usable.length === 0 && pending.length > 0) {
    blockers.push(
      `No evidenced Nepal rail. Unverified: ${pending.map((m) => m.method).join(', ')} — confirm before promising a payout.`)
  } else if (usable.length === 0) {
    blockers.push('Only rails that cannot receive funds in Nepal are listed.')
  }

  if (nepalMin !== null && nepalMin >= 100) {
    blockers.push(`$${nepalMin} minimum — for a small Nepali creator this can mean a multi-year wait.`)
  }

  // A listed-but-unusable rail is only worth mentioning. It does not block anyone
  // who has a working alternative, so it must not colour the verdict.
  if (denied.some((m) => /crypto|bitcoin|usdt/i.test(m.method))) {
    advisories.push('Also lists crypto payouts — prohibited in Nepal, ignored.')
  }
  if (denied.some((m) => /paypal/i.test(m.method))) {
    advisories.push('Also lists PayPal — receiving in Nepal unsupported, ignored.')
  }
  if (pending.length > 0) {
    advisories.push(`Unverified rails: ${pending.map((m) => m.method).join(', ')}.`)
  }

  const level = usable.length === 0
    ? (pending.length > 0 ? 'unknown' : 'blocked')
    : blockers.length > 0 ? 'caution' : 'ok'

  const thresholdLabel = noStatedMin.length > 0
    ? `no stated minimum via ${noStatedMin.map((m) => m.method).join(', ')}`
    : nepalMin !== null ? `$${nepalMin}` : 'unknown'

  return {
    level,
    threshold: nepalMin,                 // the number to SHOW a Nepali user
    advertisedThreshold: advertised,     // kept only to explain discrepancies
    thresholdLabel,
    usableMethods: usable.map((m) => m.method),
    pendingMethods: pending.map((m) => m.method),
    deniedMethods: denied.map((m) => m.method),
    blockers,
    advisories,
    message: blockers.length
      ? blockers.join(' ')
      : `Usable from Nepal via ${usable.map((m) => m.method).join(', ')} — threshold ${thresholdLabel}.`,
  }
}

/**
 * DEMO ONLY. Flip specific providers to enabled so the resolution engine's
 * behaviour is observable before verification is finished.
 *
 * Never do this in production. A provider stays disabled until every box in
 * docs/provider-verification-checklist.md is ticked.
 */
export function enableForDemo(registry, ids) {
  const enabled = [];
  const providers = registry.providers.map((p) => {
    if (!ids.includes(p.id)) return p
    if (p.blockedReason) return p // blocked providers stay blocked even in demo
    enabled.push(p.id)
    return { ...p, enabled: true }
  })
  return { registry: { ...registry, providers }, enabled }
}
