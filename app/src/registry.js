/**
 * Ad provider registry + capability queries.
 *
 * Single source of truth for what a provider can do. Nothing else in the app
 * hardcodes provider behaviour — adding a provider is a registry entry plus,
 * at most, one adapter file.
 *
 * Ported from prototype/src/registry.js (which remains as a frozen reference).
 * Reads ../../docs/registry/providers.example.json
 */
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REGISTRY_PATH = path.resolve(__dirname, '../../docs/registry/providers.example.json')

let _cache = null

export async function loadRegistry() {
  if (!_cache) _cache = JSON.parse(await readFile(REGISTRY_PATH, 'utf8'))
  return _cache
}

export function isUnverified(v) {
  return v === 'VERIFY' || (typeof v === 'string' && v.includes('VERIFY')) || v === null || v === undefined
}

/**
 * Can this provider fill this slot?
 *
 * Capability-aware rather than a switch statement — that is the entire point of
 * the adapter layer. `requiresOwnDomain` is the decisive flag: it is what decides
 * whether a provider can appear in a channel's picker at all.
 */
export function validateAssignment(provider, slotFormats) {
  if (!provider) return { ok: false, reason: 'unknown provider' }
  if (!provider.enabled) return { ok: false, reason: 'provider not enabled' }
  if (provider.blockedReason) return { ok: false, reason: provider.blockedReason }

  if (provider.slotModel === 'link_rewrite') {
    return { ok: false, reason: 'link_rewrite providers rewrite content links; they do not fill display slots' }
  }
  if (provider.slotModel === 'per_site_auto') {
    return { ok: false, reason: 'per_site_auto providers take over placement; incompatible with platform-defined slots' }
  }
  if (!['per_slot', 'per_zone'].includes(provider.slotModel)) {
    return { ok: false, reason: `unsupported slotModel: ${provider.slotModel}` }
  }

  const overlap = slotFormats.filter((f) => provider.formats.includes(f))
  if (overlap.length === 0) {
    return { ok: false, reason: `no format overlap (slot: ${slotFormats.join('/')}, provider: ${provider.formats.join('/')})` }
  }
  return { ok: true, matchedFormats: overlap }
}

/**
 * The Nepal payout verdict.
 *
 * Never infer reachability from a method's NAME — the registry states it per
 * method. And never report the advertised minimum: PropellerAds advertises $5
 * (PayPal/Skrill) but Payoneer needs $20, so an advertised number is a lie with
 * a two-year consequence for a small Nepali creator.
 */
export function payoutVerdict(provider) {
  const raw = provider.payoutMethods ?? []
  if (raw.length === 0) {
    return {
      level: 'unknown', threshold: null, thresholdLabel: 'unknown',
      advertisedThreshold: provider.minPayoutUsd ?? null,
      usableMethods: [], pendingMethods: [], deniedMethods: [], blockers: [], advisories: [],
      message: 'Payout methods not yet verified — cannot promise a Nepali user will get paid.',
    }
  }

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
  const blockers = []
  const advisories = []

  if (advertised !== null && nepalMin !== null && nepalMin > advertised) {
    const cheapest = usable.find((m) => m.minUsd === nepalMin)
    blockers.push(`Advertised $${advertised} minimum is NOT reachable from Nepal — the usable rail (${cheapest.method}) needs $${nepalMin}.`)
  }
  if (usable.length === 0 && pending.length > 0) {
    blockers.push(`No evidenced Nepal rail. Unverified: ${pending.map((m) => m.method).join(', ')} — confirm before promising a payout.`)
  } else if (usable.length === 0) {
    blockers.push('Only rails that cannot receive funds in Nepal are listed.')
  }
  if (nepalMin !== null && nepalMin >= 100) {
    blockers.push(`$${nepalMin} minimum — for a small Nepali creator this can mean a multi-year wait.`)
  }
  if (denied.some((m) => /crypto|bitcoin|usdt/i.test(m.method))) {
    advisories.push('Also lists crypto payouts — prohibited in Nepal, ignored.')
  }
  if (denied.some((m) => /paypal/i.test(m.method))) {
    advisories.push('Also lists PayPal — receiving in Nepal unsupported, ignored.')
  }
  if (pending.length > 0) advisories.push(`Unverified rails: ${pending.map((m) => m.method).join(', ')}.`)

  const level = usable.length === 0
    ? (pending.length > 0 ? 'unknown' : 'blocked')
    : blockers.length > 0 ? 'caution' : 'ok'

  const thresholdLabel = noStatedMin.length > 0
    ? `no stated minimum via ${noStatedMin.map((m) => m.method).join(', ')}`
    : nepalMin !== null ? `$${nepalMin}` : 'unknown'

  return {
    level, threshold: nepalMin, thresholdLabel, advertisedThreshold: advertised,
    usableMethods: usable.map((m) => m.method),
    pendingMethods: pending.map((m) => m.method),
    deniedMethods: denied.map((m) => m.method),
    blockers, advisories,
    message: blockers.length
      ? blockers.join(' ')
      : `Usable from Nepal via ${usable.map((m) => m.method).join(', ')} — threshold ${thresholdLabel}.`,
  }
}

/** Providers a channel may actually pick, best Nepal reachability first. */
export async function selectableProviders() {
  const reg = await loadRegistry()
  const rank = { ok: 0, caution: 1, unknown: 2, blocked: 3 }
  return reg.providers
    .filter((p) => p.enabled && !p.blockedReason && p.id !== 'house')
    .map((p) => ({ ...p, verdict: payoutVerdict(p) }))
    .sort((a, b) =>
      rank[a.verdict.level] - rank[b.verdict.level] ||
      (a.verdict.threshold ?? 9999) - (b.verdict.threshold ?? 9999))
}

export async function providerById(id) {
  const reg = await loadRegistry()
  return reg.providers.find((p) => p.id === id) ?? null
}
