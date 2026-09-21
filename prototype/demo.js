/**
 * CLI demo — shows the resolution engine's behaviour across scenarios.
 * Run: npm run demo   (or: node demo.js)
 */
import { loadRegistry, selectableProviders, payoutVerdict, validateAssignment, providerById, enableForDemo } from './src/registry.js'
import { allocateSlots, estimatePlatformSlotValue, PLACEMENT_SLOTS } from './src/allocate.js'
import { resolvePage, buildConnectUrl } from './src/resolve.js'

const line = (c = '─') => console.log(c.repeat(72))
const head = (t) => { console.log(); line('═'); console.log('  ' + t); line('═') }

const rawRegistry = await loadRegistry()

// DEMO ONLY: verify-by-default keeps every provider disabled. Enable three so the
// engine's serving behaviour is observable. Blocked providers (AdSense, Ezoic) stay blocked.
const { registry, enabled } = enableForDemo(rawRegistry, ['propellerads', 'monetag', 'adsterra'])
const propeller = providerById(registry, 'propellerads')

const conn = (providerId, status, zoneId) => ({
  providerId, status, credentials: zoneId ? { zoneId } : {},
})

/* ------------------------------------------------- 1. provider picker ---- */
head('1. Provider picker — capability-gated, with a Nepal payout verdict')
console.log(`\n  Demo enablement active for: ${enabled.join(', ')}`)
console.log('  (In production every provider stays disabled until provider-verification-checklist.md is complete.)')

for (const p of rawRegistry.providers.filter((x) => x.id !== 'house')) {
  const verdict = payoutVerdict(p)
  const usable = p.enabled && !p.blockedReason
  const badge = !usable ? (p.blockedReason ? 'BLOCKED' : 'disabled') : verdict.level.toUpperCase()
  console.log(`\n  ${p.name.padEnd(22)} [${badge}]`)
  console.log(`    slotModel : ${p.slotModel}`)
  console.log(`    threshold : ${verdict.threshold === null ? 'n/a' : '$' + verdict.threshold}`)
  if (!usable && p.blockedReason) console.log(`    reason    : ${p.blockedReason}`)
  if (usable || verdict.message) console.log(`    nepal     : ${verdict.message}`)
}

/* ------------------------------------------------- 2. slot allocation --- */
head('2. Slot allocation — the three fairness rules')

const free = { id: 'sp_alice', name: "Alice's Shop", entitlements: [] }
const pro = { id: 'sp_bob', name: "Bob's Shop", entitlements: ['pro'] }

const show = (label, slots, space) => {
  const alloc = allocateSlots(slots, space)
  const plat = alloc.filter((a) => a.owner === 'platform').length
  console.log(`\n  ${label}`)
  for (const a of alloc) {
    console.log(`    rank ${a.slot.rank}  ${a.slot.key.padEnd(18)} → ${a.owner.toUpperCase()}`)
  }
  console.log(
    `    ${plat} platform / ${alloc.length} slots  = ${Math.round((plat / alloc.length) * 100)}% inventory share`,
  )
}

show('Free tenant, 5-slot page  (rule 1: never rank 1)', PLACEMENT_SLOTS.map((s) => s.key), free)
show('Free tenant, 3-slot page  (boundary case)', ['top_leaderboard', 'in_article_1', 'in_article_2'], free)
show('Free tenant, 2-slot page  (rule 2: short pages never taxed)', ['top_leaderboard', 'in_article_1'], free)
show('Pro tenant, 5-slot page   (rule 3: buyout released)', PLACEMENT_SLOTS.map((s) => s.key), pro)

/* ------------------------------------------------- 3. Pro buyout math --- */
head('3. Pro buyout — the pricing writes itself')
const val = estimatePlatformSlotValue(free, 4) // ~$4/mo per page, generous for Nepali traffic
console.log(`\n  Platform slot share : ${val.sharePct.toFixed(0)}% of page inventory`)
console.log(`  Estimated value     : $${val.usd.toFixed(2)}/mo  ≈ NPR ${val.npr.toFixed(0)}/mo`)
console.log(`  Pro at NPR 399/mo   : user comes out ahead, platform converts`)
console.log(`                        a variable ad share into fixed subscription revenue.`)

/* ------------------------------------------------- 4. fallback chain ---- */
head('4. Fallback chain — never a broken box')

const scenarios = [
  ['Active tenant connection', [conn('propellerads', 'active', 'ZN-4821')]],
  ['Connection pending review', [conn('propellerads', 'pending', 'ZN-4821')]],
  ['No connection at all', []],
  ['Incompatible: footer slot takes native only', [conn('propellerads', 'active', 'ZN-9')]],
]

for (const [label, connections] of scenarios) {
  const plan = resolvePage({ space: free, registry, connections })
  console.log(`\n  ${label}  →  ${plan.summary.tenantFilled} tenant / ${plan.summary.platformFilled} platform / ${plan.summary.collapsed} collapsed`)
  for (const s of plan.slots) {
    const tag = s.outcome.padEnd(16)
    console.log(`    ${s.slotKey.padEnd(18)} ${tag} ${s.provider ?? ''}${s.meta.reason ? '  (' + s.meta.reason + ')' : ''}`)
  }
}

/* ------------------------------------------------- 5. referral plumbing - */
head('5. Referral plumbing — onboarding and monetisation, one code path')

const built = buildConnectUrl({
  provider: propeller,
  platformRefId: 'BB-PLATFORM-REF-0001',
  spaceId: 'sp_alice',
  returnUrl: 'https://bytebikri.com/connect/callback',
  state: 'st_9f3c1a',
})
console.log('\n  Outbound connect URL:')
console.log('   ', built.url)
console.log(`\n  Referral param attached: ${built.referralAttached ? 'YES' : 'NO — param name is unverified'}`)
if (!built.referralAttached) {
  console.log('  Correct behaviour: a guessed param name silently breaks attribution,')
  console.log('  and you would not discover it until a commission statement failed to arrive.')
}
console.log('\n  The referral param is SERVER-SIDE ONLY.')
console.log('  It must never appear in a client payload or API response.')
console.log('  The user keeps 100%; the network pays bytebikri the referral commission.')

/* ------------------------------------------------- 6. capability gate --- */
head('6. Capability gate — assignment validation')

const tests = [
  ['affiliate → display slot', 'affiliate_generic', 'in_article_1'],
  ['propellerads → display slot', 'propellerads', 'top_leaderboard'],
  ['propellerads → native footer', 'propellerads', 'footer_native'],
  ['adsense → display slot', 'adsense', 'top_leaderboard'],
]
for (const [label, pid, slotKey] of tests) {
  const p = providerById(registry, pid)
  const slot = PLACEMENT_SLOTS.find((s) => s.key === slotKey)
  const v = validateAssignment(p, slot)
  console.log(`  ${v.ok ? 'ALLOW' : 'BLOCK'}  ${label.padEnd(32)} ${v.ok ? '' : '— ' + v.reason}`)
}

console.log()
line('═')
console.log('  Deterministic allocation · capability-gated assignment · defined fallbacks')
console.log('  No money moved. No provider hardcoded. Adding one = a file + a registry entry.')
line('═')
