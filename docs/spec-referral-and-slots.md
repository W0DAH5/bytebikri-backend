# Spec: Referral Plumbing + Slot Allocation

**Project:** bytebikri · **Date:** 2026-09-21 · **Status:** Implementation-ready
**Implements:** `revenue-capture.md` workarounds **A** (referral) and **B** (inventory split)
**Registry:** [`registry/providers.example.json`](./registry/providers.example.json)

Two mechanisms, roughly three days of work, that mean bytebikri earns from ad money at launch without
touching a single rupee of anyone else's.

---

# PART A — Referral plumbing

## A1. The idea in one sentence

**Every provider connect flow carries bytebikri's referral identity, so the network pays us for bringing
publishers in — while the user keeps 100% of their own earnings.**

## A2. Where it hooks in

It is not a separate feature. It rides on onboarding you already have to build:

```
User: "Connect PropellerAds"
        │
        ▼
┌──────────────────────────────────────────────┐
│ POST /spaces/:id/connections                 │
│   { provider: "propellerads" }               │
│                                              │
│ server builds the outbound URL:              │
│   signup_url(provider)                       │
│     + referral_param(provider, PLATFORM)     │
│     + sub_id(space_id)          ← if supported│
│     + state(token)              ← return path │
└──────────────────────────────────────────────┘
        │
        ▼  302 to provider, carrying our referral id
┌──────────────────────────────────────────────┐
│  Provider signup / login  (leaves the app)   │
└──────────────────────────────────────────────┘
        │
        ▼  returns to /connect/callback?state=...
┌──────────────────────────────────────────────┐
│ resume state machine → user pastes zone ID   │
│ → verify → connection active                 │
└──────────────────────────────────────────────┘
              │
              ▼
   Network pays the USER their earnings (direct)
   Network pays BYTEBRIKRI the referral commission (direct)
```

**One code path does onboarding and monetisation.** The referral param is one extra query parameter on a
redirect you were building anyway.

## A3. Registry fields that drive the redirect

From `providers.example.json`:

```jsonc
"referral": {
  "type": "referral_link",     // referral_link | referral_credit | null
  "param": "ref_id",           // query param name — VERIFY per provider
  "commissionPct": 5,
  "duration": "lifetime",
  "subIds": "VERIFY"           // if true, we can attribute per space
}
```

Redirect builder:

```ts
function buildConnectUrl(provider: Provider, spaceId: string, stateToken: string) {
  const url = new URL(provider.signupUrl)
  if (provider.referral) {
    url.searchParams.set(provider.referral.param, PLATFORM_REFERRAL_ID)
    if (provider.referral.subIds === true) {
      url.searchParams.set('subid', spaceId)   // per-space attribution where offered
    }
  }
  url.searchParams.set('returnUrl', `${ORIGIN}/connect/callback`)
  url.searchParams.set('state', stateToken)
  return url.toString()
}
```

## A4. ⚠️ The attribution reality — read before you promise anything

**Most ad networks do not offer per-referral sub-IDs.** You will typically get an *aggregate* commission
number: "you referred 47 publishers, they earned $X, your commission is $Y."

**What this means:**

| | Consequence |
|---|---|
| Can you show a user "you earned the platform $2.10"? | **No** — and you shouldn't try. It's your revenue, not theirs |
| Can you verify the commission is correct? | Only in aggregate |
| Can you tell which acquisition channel produced valuable publishers? | Only if the provider supports sub-IDs. **Verify per provider** |
| Can you forecast? | Poorly. Treat referral income as variable, not baseline |

**Design decision:** the user's dashboard shows **their** earnings (from provider APIs where available).
Referral income shows only in **your** internal admin, labelled *"estimated, provider-reported, aggregate."*
Never blend the two — one number is theirs and one is yours, and confusing them destroys trust.

## A5. Sub-ID capability check (do this per provider)

Before enabling a provider, answer three questions and record the answers in the registry:

1. **Does the referral programme exist and is it open to publishers?** (Some are advertisers-only.)
2. **Can we append a sub-ID / sub-parameter for per-space attribution?**
3. **What is the actual duration** — lifetime, 12 months, or unstated? Adsterra's own page says "no limits";
   a secondary source says "first 12 months." **Resolve that discrepancy with the provider directly** before
   modelling revenue on it.

Until a provider is verified, leave `"enabled": false` in the registry. The registry should contain only
things you have personally confirmed.

## A6. Disclosure — do it, and put it in the UI

You are earning money because a user connected a provider. **Say so.**

> *"bytebikri receives a referral commission from some ad networks when you connect through us. It costs you
> nothing, comes out of the network's marketing budget, and does not reduce your earnings in any way."*

Three reasons this is the right call:
1. It's true, and it will be discovered eventually.
2. It reframes the 0% promise as *credible* rather than suspicious — "why are they being so generous?" has an answer.
3. Getting caught hiding it costs more than the commission is worth.

## A7. Anti-abuse

**Self-referral is the obvious attack** — a user signs up through their own referral link, or creates
throwaway accounts to farm commissions. Networks ban for this, and a ban takes your referral revenue to zero
permanently.

Controls:

- **One referral attribution per device/fingerprint/payment-identity.** Duplicate-signup detection.
- **Never let a user supply a referral param.** The platform's referral ID is server-side only. A user cannot
  inject their own or harvest others'.
- **Rate-limit connections per space** and flag bursts from one IP/ASN.
- **Reconcile monthly:** compare referred-publisher count against active-connection count. Divergence means
  someone's farming.
- **Do not offer users any incentive per referral.** The moment you pay for referrals you've built a fraud
  economy. Your incentive is *they succeed* — which the network's model already gives you.

## A8. Schema additions

```sql
ALTER TABLE providers
  ADD COLUMN signup_url        text,
  ADD COLUMN referral_param    text,
  ADD COLUMN referral_pct      numeric(5,2),
  ADD COLUMN referral_duration text,
  ADD COLUMN supports_subid    boolean DEFAULT false;

-- our own referral identity per provider (server-side only, never exposed to clients)
CREATE TABLE platform_referrals (
  provider_id      text PRIMARY KEY,
  platform_ref_id  text NOT NULL,
  verified_at      timestamptz,
  notes            text
);

-- monthly reconciliation
CREATE TABLE referral_revenue (
  id            bigserial PRIMARY KEY,
  provider_id   text NOT NULL,
  period        date NOT NULL,
  referred_count int,
  referred_rev  numeric(12,2),
  commission    numeric(12,2),
  currency      text DEFAULT 'USD',
  source        text CHECK (source IN ('provider_report','manual','estimated')),
  recorded_at   timestamptz DEFAULT now(),
  UNIQUE (provider_id, period)
);

-- per-connection attribution, only where supports_subid
ALTER TABLE ad_connections
  ADD COLUMN referral_subid text,
  ADD COLUMN referred_at    timestamptz;
```

## A9. Acceptance criteria

- [ ] Connecting any provider with a `referral` block emits our referral param on the outbound URL
- [ ] Referral param is **never** present in any client-side payload or API response
- [ ] Every connect attempt writes `ad_connections.referred_at` and a state token
- [ ] `platform_referrals` populated for every enabled provider
- [ ] Admin view shows referral revenue, clearly labelled aggregate/estimated
- [ ] Disclosure text present on the provider picker and in the ToS
- [ ] Self-referral controls active and alerting
- [ ] Monthly reconciliation job compares referred count vs active connections

---

# PART B — Slot allocation

## B1. The idea in one sentence

**The tenant gets most of the ad space; the platform keeps one defined placement per page as rent — captured
in inventory, never in cash.**

## B2. Slot taxonomy — platform-defined, tenant-populated

The platform publishes a closed set of slots. Tenants never invent new ones.

```jsonc
// placement_slots — rank 1 is the most valuable position on the page
[
  { "key": "top_leaderboard",  "rank": 1, "position": "above_fold", "maxPerPage": 1,
    "formats": ["display"], "minWidth": 728, "height": 90 },
  { "key": "in_article_1",     "rank": 2, "position": "in_content",  "maxPerPage": 1,
    "formats": ["display","native"], "responsive": true },
  { "key": "sidebar_sticky",   "rank": 3, "position": "sidebar",     "maxPerPage": 1,
    "formats": ["display"], "desktopOnly": true },
  { "key": "in_article_2",     "rank": 4, "position": "in_content",  "maxPerPage": 1,
    "formats": ["display","native"], "responsive": true },
  { "key": "footer_native",    "rank": 5, "position": "footer",      "maxPerPage": 1,
    "formats": ["native"], "responsive": true }
]
```

Every slot declares its allowed formats — so a `link_rewrite` provider can never be assigned to a display
slot, and a popunder can never land above the fold.

## B3. The allocation policy

```jsonc
{
  "policy": "last_rank_reserved",
  "platformSlotsPerPage": 1,
  "platformTakesRank": "last",        // never rank 1
  "minTenantSlotsBeforeTax": 3,       // short pages are never taxed
  "releaseOnEntitlements": ["pro", "custom_domain"],
  "maxTotalAdsPerPage": 5
}
```

**Resolution algorithm — deterministic, not random:**

```ts
function allocateSlots(pageSlots: Slot[], space: Space): Allocation[] {
  const entitled = space.entitlements.includes('pro')
                || space.customDomain;

  const maxTotal = POLICY.maxTotalAdsPerPage;
  const slots = pageSlots.slice(0, maxTotal);

  // short pages are never taxed
  if (slots.length < POLICY.minTenantSlotsBeforeTax || entitled) {
    return slots.map(s => ({ slot: s, owner: 'tenant' }));
  }

  const ranked = [...slots].sort((a, b) => a.rank - b.rank);
  const platformSlot = ranked[ranked.length - 1];   // last rank = lowest value

  return ranked.map(s => ({
    slot: s,
    owner: s.key === platformSlot.key ? 'platform' : 'tenant'
  }));
}
```

**Three rules that make it fair, and that you should say out loud:**

1. **Never rank 1.** The best position always belongs to the tenant.
2. **Never tax a short page.** Under 3 slots, you take nothing.
3. **One slot, never more.** No creep.

With a 5-slot page that's a 20% inventory share; with 3 slots it's 33%; with 2 slots it's 0%. **You take more
proportionally from pages that have more to give** — which is the opposite of how most platforms do it, and
it's defensible in a sales conversation.

## B4. Pro buyout — and how it prices itself

The platform slot is released on entitlement. This turns workaround B into workaround C, and the pricing
writes itself:

```
monthly_value_of_platform_slot(space) ≈
  total_page_ad_revenue(space) / total_slots(space) × platform_slots_taken(space)
```

**Price Pro at a multiple of that.** If the platform slot is worth ~$1/month on a typical space, Pro at
NPR 299–499/month is an easy sell — the user comes out ahead *and* you convert a variable, unverifiable ad
share into **fixed, predictable subscription revenue.**

Do this calculation per space, show it, and let it be the pitch:

> *"Pro removes platform ads and costs NPR 399/month. Your platform slot is currently worth an estimated
> NPR 130/month — so Pro pays for itself if you'd rather have the space than the subsidy."*

## B5. ⚠️ Honest revenue modelling for Nepal

Do not build a business plan on Part B without this arithmetic.

Assume a space with 4 slots earning **$4/month** total (generous for Nepali traffic at ~$0.03 CPC):

| Scale | Platform slot revenue (~25%) |
|---|---|
| 100 active spaces | **~$25/month** |
| 500 active spaces | **~$125/month** |
| 1,000 active spaces | **~$250/month** ≈ NPR 34,000 |

**That is not a business on its own.** Part B is a *subsidy* that makes the free tier self-funding, not a
revenue engine. Three consequences:

1. **Part A (referral) likely outearns Part B** at small scale, because it's a percentage of *every* referred
   publisher's total earnings rather than one slot.
2. **Pro subscriptions beat both** — one NPR 399 subscription ≈ the ad revenue of ~11 platform slots.
3. **The asset-sale cut beats all three.** One template sale ≈ a year of platform-slot revenue on a Nepali space.

**Conclusion: build B for fairness and self-funding, build A because it's nearly free, and put your real
monetisation effort into Pro and asset sales.** Part B is not the plan; it's the floor under the plan.

## B6. Fallback chain

Every slot has a defined behavior when nothing fills it. Never leave a hole, never show a broken box.

```
tenant connection active & serving?   → tenant ad
        ↓ no
tenant connection pending/restricted? → COLLAPSE the slot (reserve the space,
                                        render nothing — do not shift layout)
        ↓ no
platform entitlement has a platform ad? → platform/house ad
        ↓ no
                                        → COLLAPSE (reserved space)
```

**Reserve the space, don't reflow.** Collapsing a slot that shifts the page causes CLS, which damages your
Core Web Vitals and therefore every tenant's ad rates. Fixed-height containers or a reserved min-height on
every slot.

## B7. Enforcement

The platform owns WHERE. Enforce it:

- **Tenant console exposes slot assignment only** — provider per slot. No slot creation, no sizing, no position changes.
- **Reject requests** to activate more ads than `maxTotalAdsPerPage`, with a clear reason.
- **Ad-density monitor** on a sample of rendered pages; alert on violations.
- **Moderation queue** for tenant-supplied creative (if you allow house ads).
- **One-domain kill switch** that strips all provider code instantly, plus per-tenant revocation.

## B8. Schema additions

```sql
CREATE TABLE placement_slots (
  key           text PRIMARY KEY,
  rank          int NOT NULL,
  position      text NOT NULL,
  max_per_page  int DEFAULT 1,
  formats       text[] NOT NULL,
  constraints   jsonb
);

CREATE TABLE platform_slot_policy (
  id                       int PRIMARY KEY DEFAULT 1,
  platform_slots_per_page  int DEFAULT 1,
  platform_takes_rank      text DEFAULT 'last',
  min_tenant_slots         int DEFAULT 3,
  max_total_ads_per_page   int DEFAULT 5
);

ALTER TABLE slot_assignments
  ADD COLUMN owner text CHECK (owner IN ('tenant','platform')) DEFAULT 'tenant';

ALTER TABLE spaces
  ADD COLUMN entitlements text[] DEFAULT '{}';   -- 'pro', 'custom_domain', ...
```

## B9. Acceptance criteria

- [ ] Slot set is closed; tenants cannot create or reposition slots
- [ ] Allocation deterministic — same page always yields the same assignment
- [ ] Platform slot is never rank 1
- [ ] Pages with fewer than 3 slots are never taxed
- [ ] Pro entitlement releases the platform slot immediately
- [ ] No page exceeds `maxTotalAdsPerPage`
- [ ] Empty/restricted slots collapse without layout shift (CLS ≈ 0)
- [ ] Every slot resolves to *something* defined — never an unresolved blank
- [ ] Admin shows estimated value per platform slot, by space

---

# Build order

| # | Task | Effort | Blocks |
|---|---|---|---|
| 1 | Slot taxonomy + `placement_slots` + policy table | 0.5 d | B |
| 2 | Deterministic `allocateSlots()` + render contract | 0.5 d | B |
| 3 | Fallback chain + reserved-height containers | 0.5 d | B |
| 4 | Tenant console: assign provider → slot | 1 d | B |
| 5 | Entitlement flag + Pro buyout of platform slot | 0.5 d | B, C |
| 6 | `platform_referrals` + redirect builder | 0.5 d | A |
| 7 | Verify referral params: Adsterra, Monetag, PropellerAds, PopCash | 1 d | A |
| 8 | Attribution + `referral_subid` where supported | 0.5 d | A |
| 9 | Disclosure copy (picker + ToS) | 0.25 d | A |
| 10 | Self-referral detection + reconciliation job | 1 d | A |

**≈ 6 days total.** Items 1–5 deliver the self-funding free tier; 6–10 deliver the referral revenue.

---

# The two sentences that define this

> **Part A:** *We get paid by the network for bringing you, and you keep everything you earn.*
>
> **Part B:** *Your shop is free. The platform keeps one placement per page as rent.*

Both are true, both are enforceable, and neither requires moving a single rupee of anyone else's money.

---

*Every provider-specific value in the registry must be verified against current published terms before
enabling a provider — referral rates, durations, sub-ID support, payout methods and thresholds all change.
See `revenue-capture.md` §7 for the approaches to avoid.*
