# bytebikri — Ad Resolution Prototype

A runnable proof-of-concept for the serving core described in
[`docs/spec-referral-and-slots.md`](../docs/spec-referral-and-slots.md).

**No dependencies. No build step. Node 20+.**

```bash
npm run demo     # CLI: prints every behaviour, deterministic
npm start        # HTTP: renders demo tenant shops at http://localhost:3000
```

---

## What it proves

| Claim | Where it lives | How to see it |
|---|---|---|
| Slot allocation is **deterministic** | `src/allocate.js` | Same page always yields the same plan |
| Platform **never takes rank 1** | `allocateSlots()` | Demo §2, `top_leaderboard` is always TENANT |
| **Short pages are never taxed** | `minTenantSlotsBeforeTax` | Demo §2, 2-slot page → 0% platform share |
| **Pro releases** the platform slot | `isEntitled()` | Demo §2, `bob-pro` → 0% platform share |
| Adapters are **capability-gated** | `src/registry.js#validateAssignment` | Demo §6, affiliate→display is BLOCKED |
| Every slot has a **defined fallback** | `src/resolve.js#resolveSlot` | Demo §4, four distinct outcomes |
| **Collapse reserves space** (no CLS) | `renderSlot()` in `server.js` | Every slot keeps `min-height` |
| Referral rides on **onboarding** | `buildConnectUrl()` | Demo §5, one code path |

---

## Layout

```
prototype/
├── demo.js              CLI demo — six sections, no server needed
├── server.js            Live demo — renders tenant shops through the real engine
└── src/
    ├── registry.js      Registry loader · capability gate · Nepal payout verdict
    ├── allocate.js      Slot policy · deterministic allocation · Pro buyout math
    ├── adapters.js      Adapter contract · house · affiliate (link_rewrite) · per_zone
    └── resolve.js       Fallback chain · referral-aware connect URLs
```

Reads `../docs/registry/providers.example.json` as its single source of truth. **No provider is hardcoded
in the engine** — adding one is a registry entry plus an adapter file.

---

## Design decisions worth noticing

**`allocation` is deterministic, not randomized.** A given page and space always produce the same plan. That
means it's testable, cacheable, and explainable to a tenant who asks *"why is that slot yours?"*

**Capability gating happens before rendering, not during.** A `link_rewrite` provider can never be assigned
to a display slot because `validateAssignment` rejects it — so the failure can't reach a live page.

**Nothing leaves a slot unresolved.** The four outcomes are `tenant_ad`, `platform_ad`, `blocked_collapse`,
and `collapse`. Both collapse variants still reserve their height, because a layout shift damages Core Web
Vitals and therefore *every* tenant's ad rates.

**Unverified values are refused, not guessed.** `buildConnectUrl` will **not** attach a referral parameter
whose name is still `"VERIFY"`. Guessing a param name silently breaks attribution, and you wouldn't find out
until a commission statement failed to arrive months later.

**Verification-by-default.** Every provider ships `"enabled": false`. `enableForDemo()` exists solely so the
engine's behaviour is observable — it's labelled DEMO ONLY and deliberately refuses to unblock providers with
a `blockedReason` (AdSense, Ezoic).

---

## Demo scenarios

| URL | Shows |
|---|---|
| `/space/alice-free-active` | Normal case: tenant fills 4, platform keeps the footer |
| `/space/bob-pro` | Pro buyout: tenant keeps all five |
| `/space/carol-pending` | Connection pending → slots collapse, space reserved, no shift |
| `/space/dave-short` | Two-slot page → platform takes nothing |

---

## What this is not

Not production code. It's a reference implementation of the decisions, intended to make the architecture
arguable in a way prose isn't. Specifically absent: persistence, auth, real ad tags, encryption of
credentials, consent/CMP, the moderation pipeline, and any provider API integration.

---

## Known limitation found by running it

Building this surfaced two real bugs that prose alone would not have caught:

1. **Provider enablement vs connection status are different things.** An active tenant connection to a
   *disabled* provider correctly served nothing — which is right, but it conflated "this provider isn't
   vetted" with "this tenant is live". Production needs both flags checked and reported separately, or
   support tickets become unanswerable.
2. **An unverified referral param renders as `?VERIFY=…`** — harmless-looking, and it would have shipped
   silently. Now refused explicitly.
