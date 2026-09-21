# bytebikri — What Is Possible

**The one-page answer.** · 2026-09-21

---

## The bottom line

**Everything you described is possible — with a specific set of providers.** What's impossible is account
creation, fully-in-app signup, and moving the money yourself. Everything else works.

---

## ✅ Possible today, no permission needed

| # | What | How it works | Who gets paid |
|---|---|---|---|
| 1 | **Affiliate monetisation** | User pastes their own affiliate link/tag. You render or rewrite it on their content | User, directly by the merchant |
| 2 | **Low-barrier ad networks** | PropellerAds, Adsterra, Monetag, AdMaven, PopAds. User pastes a zone/tag ID. You render it in their slot | User, directly by the network |
| 3 | **Your own direct campaigns** | You sell to Nepali advertisers, serve via Revive Adserver | You collect, you pay creators |
| 4 | **House / fallback ads** | Your own promos when a slot is empty | You |
| 5 | **Asset-sale cut** | Your real revenue engine | You |
| 6 | **Subdomains per user** | Each user is an independent "site" in structure, layout, and reporting | — |

---

## ⚠️ Possible, but only on a condition

| What | The condition |
|---|---|
| **AdSense on user subdomains** | Your **root domain** must be approved by you, and subdomains then generally serve **your** publisher code. This gives you revenue, not the user |
| **Per-user AdSense IDs** | ❌ Not self-serve. Only via **AFP** |
| **Ezoic / Media.net / Sovrn** | Not per-user. Per-site approval + MCM review |
| **Affiliate (major programs like Amazon)** | Structurally fine — but individual programs may still require the user to **declare the site** in their own account. Less permissive than CPA networks, far more permissive than AdSense |
| **Reporting dashboard with real money** | Only where the provider has an API **and** the user completed OAuth |

---

## ⏳ Possible later — gated, but real

| What | Gate | Effort |
|---|---|---|
| **AFP Transparent** — *your exact model*: user's own ID, embedded signup, Google pays both parties directly, platform-level reporting | **Invite-only.** Contract + Account Manager | Register interest now; long sales cycle |
| **GCPP / MCM partnership** — a certified partner acts as parent for your users | Commercial deal with an existing GCPP | Easier than becoming a parent yourself |

---

## ❌ Not possible — design around these

| # | Impossible | Why |
|---|---|---|
| 1 | **Creating ad accounts for users** | No network exposes a publisher-signup API. Onboarding is their KYC — identity, address, tax, phone, site review. **You build linking, never creation** |
| 2 | **Signup/login fully inside your app** | Providers send `X-Frame-Options` / `frame-ancestors`. Iframing is blocked by the browser and circumventing it violates terms. **One redirect must leave your app** |
| 3 | **You moving the ad money** | Each network pays its own publishers on its own terms. No API to intercept; routing around it violates their terms |
| 4 | **You owning the demand** | An ad server decides *which* ad — it doesn't *create* buyers. Demand comes from networks or from advertisers you personally sell to |
| 5 | **AdMob with per-user IDs** | Mobile SDK only; one AdMob account per app in the Play Store |
| 6 | **AdSense using a site the user doesn't own** | Google verifies site ownership. This is the correction from earlier |

---

## What this means for what you build

**Your architecture is unchanged by which providers are available.** Build it once, add providers as plugins:

```
user selects provider  →  connect (OAuth or paste)  →  verify
        →  assign to a platform-defined slot  →  serve
        →  user gets paid by the provider
```

**Build order — do these first, because nothing blocks them:**

1. **House adapter** — every slot needs defined behavior when empty
2. **Affiliate adapter + link rewriting** — the most permissive category
3. **Low-barrier network adapters** — paste-a-zone-ID, one file each
4. **Kill switch + policy state machine** — before any third party sees a real page
5. **CMP + consent + ads.txt** — legal and functional prerequisite
6. **OAuth + AdSense adapter** — when AFP or a partnership lands

**The honest summary:** at launch your menu is affiliate + low-barrier networks + your own direct campaigns.
That is a real, shippable product with nobody's permission required. AFP later adds the mainstream networks —
and until then, nothing in your codebase has to change to accommodate it.

---

## The five things to remember

1. You own the **space**. The user owns **what's on it**.
2. You can own **the decision layer**. You cannot own **their money** — and don't need to.
3. **Affiliate first** — it has the fewest structural blockers of any category.
4. **Nepal direct sales** is where the real ad money is (AdSense pays ~$0.03 CPC for Nepali traffic).
5. **One advertiser paying real NPR** is your most important milestone. Not the auction engine.

---

### Document index

| Doc | What it covers |
|---|---|
| [`conversation-record.md`](./conversation-record.md) | **Complete turn-by-turn transcript** — every question as asked, every answer in full, all sources, all corrections |
| [`full-discussion.md`](./full-discussion.md) | Structured digest — same material organised by theme, with a source list |
| [`monetization-model.md`](./monetization-model.md) | The three models, MCM, why the money path matters, Nepal tax facts |
| [`entry-phase-ads-playbook.md`](./entry-phase-ads-playbook.md) | **AFP Transparent** — the sanctioned version of your model; the 0% rev-share decision |
| [`ad-infrastructure-plan.md`](./ad-infrastructure-plan.md) | Nepal market reality, three-layer architecture, Revive/Prebid, build vs adopt |
| [`ad-adapter-architecture.md`](./ad-adapter-architecture.md) | Adapter interface, capability matrix, onboarding mechanics, data model |
| [`revenue-capture.md`](./revenue-capture.md) | **How to get paid without touching the ad money** — referral programs, inventory split, Nepal payout filter, what not to do |
| [`spec-referral-and-slots.md`](./spec-referral-and-slots.md) | **Implementation spec** for workarounds A + B: referral plumbing, slot allocation, schemas, acceptance criteria |
| [`provider-verification-checklist.md`](./provider-verification-checklist.md) | **Actionable** — the email to send providers, and the per-provider table to fill in before enabling them |
| [`registry/providers.example.json`](./registry/providers.example.json) | Seed provider registry — capabilities, referral terms, payout thresholds, Nepal warnings |
| [`../prototype/`](../prototype/) | **Runnable** proof-of-concept: deterministic allocation, capability gating, fallback chain. `npm run demo` |
