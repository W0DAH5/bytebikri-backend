# bytebikri — Complete Discussion Record

**Every topic, finding, and answer from this working session.**
Compiled 2026-09-21 · Companion to the topic docs indexed in [`README.md`](./README.md)

This is the archive. It records what was asked, what was found, what was recommended, and — importantly —
**where I corrected myself**. Sources are cited inline, and every figure is dated because ad-network terms
change fast.

---

## Contents

1. [Starting point — what the repository actually was](#1-starting-point)
2. [The core model — and what's actually possible](#2-the-core-model)
3. [AdSense for Platforms — the product built for this](#3-adsense-for-platforms)
4. [Nepal as the starting market](#4-nepal-as-the-starting-market)
5. [Own ad infrastructure — build vs adopt](#5-own-ad-infrastructure)
6. [The adapter architecture](#6-the-adapter-architecture)
7. [What is possible — the consolidated answer](#7-what-is-possible)
8. [Capturing revenue without touching the ad money](#8-capturing-revenue)
9. [The prototype and what running it revealed](#9-the-prototype)
10. [Earning groups, tiers, and the "runaway" problem](#10-earning-groups-and-runaway)
11. [The full feature inventory](#11-feature-inventory)
12. [Can it be built and hosted for free?](#12-hosting-and-domain)
13. [Mobile app, PWA, and the IAP blocker](#13-mobile-and-pwa)
14. [Corrections I made during this session](#14-corrections)
15. [Open decisions](#15-open-decisions)
16. [Source list](#16-sources)

---

## 1. Starting point

**Asked:** *"Analyze the project."*

**Found:** `W0DAH5/bytebikri` was an empty placeholder repository.

| Fact | Value |
|---|---|
| Commits | **1** — `56d849b` "Create src", 2025-09-03 21:41 +0545 |
| Files | **1** — a file named `src`, contents: a single newline byte (blob `8b13789…`) |
| Created → last push | 15:50:59Z → 15:56:26Z the same day. Dormant since |
| Branches / tags / releases | `main` only; none; none |
| Issues / PRs / workflows | 0 / 0 / 0 |
| Description / topics / license | none / none / none |
| Languages detected | `[]` |
| Local clone | shallow (`--depth 1`) — no deeper history exists |
| Contributors | 1 |

**Interpretation:** `src` is a *file*, not a `src/` directory — almost certainly someone typing into GitHub's
"create new file" box without the trailing slash. The name reads as *byte* + *bikri* (बिक्री = "sale" in
Nepali), suggesting a digital-goods marketplace. Nothing in the repo confirms it.

Owner context: Python/JS background, with `media-forwarder-backend`/`-frontend`, `discord-service`, and a
vehicle-tracking system among their other public repos.

**Recommendation given:** delete the stray `src`, add README/gitignore/license, write a one-page spec, land
the first real work as a PR rather than a direct commit to `main`.

---

## 2. The core model

**Asked:** *"If in my app I earn through ads, then I wanna let users earn for showing/selling their digital
assets too — but not through me, but the ad companies. Can I let ad companies directly sign up users from my
app (their own ID), my app just hosts content, and revenue happens by ad and similar stuff used by user, and
revenue comes through the company which is profiting from ad?"*

**Answer: yes — this is a real, established model. It has an industry name, two implementations, and one
hard constraint.**

### The three models

| | A — Platform as publisher | **B — User as publisher** | C — Hybrid |
|---|---|---|---|
| Ad account held by | You, one account | **Each user, their own** | You + linked user accounts |
| Ad network pays | You | **The user, directly** | Split at source |
| Your revenue | Rev-share spread | Zero from ad revenue | Rev-share paid by network |
| Your compliance load | Heavy | **Light** | Medium |
| Real example | YouTube Partner Program | Multi-author blog networks | Google Ad Manager MCM |

What you described is **Model B** — legally the cleanest and lowest-risk option, because you never touch
other people's money.

### The constraint

**Ad networks do not expose an API to create publisher accounts.** Onboarding is their own KYC — identity,
address, tax details, phone verification, site review. What you can build is **account linking, never account
creation**:

```
User taps "Connect your ad account"
   → hand-off to the network's OWN signup/login
   → user adds bytebikri.com as a site in THEIR account, passes review
   → you capture/verify their publisher ID
   → your server injects the right tag per page, per user
   → network pays the user directly
```

### Platform vs native — and why it decides everything

| | Web (AdSense / Ad Manager) | Native app (AdMob) |
|---|---|---|
| Multiple publishers on one property | **Explicitly allowed** — *"Publishers are allowed to place ad code from more than one AdSense account on a page that complies with our program policies"* ([Google](https://support.google.com/adsense/answer/115979)) | **Murky and policed** — you cannot have multiple AdMob accounts connected to the same app in the Play Store |
| Practical verdict | **Works today** | **Do not build on this** |

**Justified permission matters:** *"If a site is in compliance with our Program policies and the company or
owner of the site has given you permission to display ads on their site, you may place your ad code on the
same page as the other publisher's ad code."* Your ToS must grant that permission.

**Also true:** *"you will only be credited for clicks and impressions on the ad units associated with your
account"* — so you can never take a cut of what their code earns.

---

## 3. AdSense for Platforms

**Found by research. This is the product built for exactly this model.**

Google's AFP documentation, versus what was described:

| Described | AFP documentation |
|---|---|
| "revenue comes through the company" | *"Ad revenue payments post-revenue share are **facilitated directly to each party by Google**"* |
| "ad companies can directly signup users from my app" | *"**Embedded Sign Up** — Allow users who are new to AdSense to sign up for new accounts **completely within the CMS and site building platform**"* |
| "no through me" | *"the AdSense account **belongs to the child publisher** and the platform doesn't need to undertake any account management tasks"* |
| "my app just hosts content" | *"Many platforms want to **monetize content generated by their users**"* |

Additional AFP facts:

- **Payments:** *"Ad revenue generated by both the child publishers and platforms are paid **directly on Net-22** in multiple currencies. Both parties can select from multiple payment methods."*
- **Reporting:** *"Pull data and reporting at the platform level and **down to the child publisher level**"* — which solves the "you can never see their earnings" problem.
- **ads.txt at scale:** *"given that most AFP platform customers have **thousands of child accounts**, managing this file... becomes difficult."* Fix: put `data-ad-host` on every tag, then *"the ads.txt file will only ever need one entry."*
- **Eligibility:** *"AdSense for Platforms is currently invite-only."* Requires a signed contract and a named **Account Manager**; Google provides engineering support during integration.
- **Not traffic-gated** the way MCM is (MCM ≈ 90M–200M monthly impressions), but AFP's stated customers are established content platforms and CMS/site-builders.

**AFP Direct** is the second mode: sub-accounts created per user, and *"AdSense [can] localize spam and policy
enforcement to the sub-account, **keeping your main platform account in good health**."* The platform
collects **100%** of ad revenue in that model, users get the service free.

### Why MCM is not the entry path

MCM (Multiple Customer Management) is the Ad Manager 360 feature that pays parent and child separately. It
requires GAM 360 — paid, contract-based, enterprise. Entry is scale-gated, and MCM *parent* status
realistically goes to ad-tech firms and Google Certified Publishing Partners, not to platforms applying cold.

**Verdict: correct destination, wrong starting point.**

---

## 4. Nepal as the starting market

This research **inverted the plan**, and it's the single most important finding in the session.

### AdSense pays ~$0.03 per click for Nepali traffic

Against a global average of ~$1.33 and India at ~$0.50 — roughly **1/40th of global**
([SR Zone](https://www.thesrzone.com/2022/03/adsense-cpc-rates-by-country-2022.html), citing AdExpresso).

**Global programmatic advertising values a Nepali eyeball at almost nothing.**

### But Nepali advertisers spend real money

| Fact | Figure | Source |
|---|---|---|
| Digital share of national ad spend | **~34%** (TV 28%) | [Gurkha Technology](https://gurkhatech.com/estimate-of-advertising-activities/) |
| Agency ads-management fees | **NPR 15,000–40,000/mo**, or 10–20% of spend | [Arjan KC](https://arjankc.com.np/blog/digital-marketing-pricing-nepal-2026/) |
| Typical SME budget | **NPR 40,000–120,000/mo** | [Epitome Solutions](https://epitomesolutions.org/blog/digital-marketing-nepal/) |
| Facebook reach | **17.3M users**, 53.7% of population | [BijayWorks](https://bijayworks.com/digital-marketing-in-nepal/) |

**The conclusion:** a Nepali business will pay real NPR to reach Nepali customers. A global ad network will
pay ~nothing for the same impression. **The demand exists; it just isn't programmatic.**

Therefore: **ad networks are the wrong primary monetisation for Nepal** — not because they're bad, but
because they are structurally unable to price Nepali traffic. Building your own layer isn't optional polish;
it's the only way to capture the actual value. And it yields NPR-denominated revenue, sidestepping forex,
wire transfers, the $100 threshold, and the entire payout-friction problem.

**The play becomes: become the ad network Nepal doesn't have.**

### Nepal-specific mechanics

**Payouts (per Google's own APAC table):** Nepal supports **Check** and **Wire Transfer** for AdSense. No
EFT, no Hyperwallet. $100 minimum, paid the 21st, landing within days to a week
([Google](https://support.google.com/adsense/answer/1714397),
[Nepali Nerd](https://nepalinerd.com/withdraw-money-from-google-adsense/)).

**Tax:**
- AdSense = export of services → **zero-rated for VAT**. VAT registration mandatory above **Rs 30 lakh** rolling 12-month service turnover.
- Foreign-currency income up to **Rs 40 lakh/year** = **5% final rate**, typically deducted at the bank at FX conversion with PAN linked.
- For a registered company: exported IT services zero-rated, and a **75% income-tax rebate** can bring the effective corporate rate to ~6.25%, conditional on receiving convertible foreign currency through formal banking channels with contracts, invoices and receipts retained.

**Structural advantage of Model B:** because Google pays each user directly, the entire tax/VAT/payout burden
falls on **the user**, not the platform. No withholding, no NRB questions, no money-transmission exposure.

**Policy to chase:** Nepal approved a **National Advertisement Policy in February 2026** aimed at regulating
digital ads, with incentives for local advertisers and a reported requirement that foreign-product sellers
allocate spend to consumer awareness campaigns ([Khabarhub](https://english.khabarhub.com/2026/02/556628/)).
**If foreign sellers must spend locally, that is mandated demand for exactly the inventory you'd aggregating.**
Verify against the primary policy text.

---

## 5. Own ad infrastructure

**Asked:** *"Can we build infra ourselves supporting multiple ad providers?"*

### What you can and cannot own

| Layer | Ownable? |
|---|---|
| **Ad decisioning** — which provider serves this slot | ✅ Yes |
| **Per-user identity & routing** | ✅ Yes — this *is* the product |
| **Serving & rendering** | ✅ Yes |
| **Reporting** where APIs exist | ✅ Yes |
| **Direct campaigns** | ✅ Yes — and in Nepal, where the money is |
| **Demand** — someone willing to pay | ❌ No. An ad server decides *which* ad; it does not *create* buyers |
| **Payments** — money reaching users | ❌ No. Each network pays its own publishers; no API to intercept |

### The three-layer architecture

```
LAYER 1 — DIRECT LOCAL CAMPAIGNS        (you sell, you earn)
  Nepali advertisers → your ad server → your inventory. NPR. Highest CPM for Nepali traffic.

LAYER 2 — USER-OWNED GLOBAL NETWORKS    (they earn, you don't)
  User's own AdSense/Ezoic/affiliate ID → user's own account.

LAYER 3 — HOUSE ADS / FALLBACK          (you control)
  Platform promos, featured sellers, empty-slot collapse.
```

**The priority logic is the product.** For a Nepali visitor Layer 1 should win; for a US visitor, Layer 2
should. Your resolution service is the arbitrage engine.

### Build vs adopt

**Adopt: Revive Adserver** — mature open-source ad server (GPL). Multiple advertisers, contract/remnant/
override campaigns, geotargeting (MaxMind), frequency capping, client logins, reporting.
*"Networks and agencies managing campaigns across many sites from one console."* Weaknesses: dated UI,
PHP/MariaDB, limited APIs without paid extensions, community-only support.

**Later: Prebid.js** — open-source header bidding wrapper, 300+ adapters, **not tied to Google Ad Manager**.
But its entire value is extracting more from programmatic demand, and at $0.03 CPC you'd be running an auction
nobody bids on. Stage 4 tool, not a starting point.

**Build yourself: the resolution + identity layer.** Nothing sells this, and it's what bytebikri *is*.

---

## 6. The adapter architecture

**Asked:** *"We just provide space, users select which ad company to integrate, and we build our code so volatilely — the shop is the user's property, they should be paid. Login redirections all in our app."*

### Restated model

| Who | Owns |
|---|---|
| **bytebikri** | The space, the plumbing, the dashboard, the layout envelope, compliance, moderation |
| **The user** | Their shop, their choice of provider, their credentials, **their earnings** |

### Capability-aware adapters, not a switch statement

Providers differ structurally: AdSense needs per-slot + per-account IDs; PropellerAds issues per-zone tags;
Ezoic is a per-site takeover; affiliate isn't ads at all (it's link rewriting).

```ts
interface AdProvider {
  id: string
  capabilities: Capabilities
  onboarding: OnboardingSpec
  render(ctx): RenderedSlot
  verify(creds): Promise<VerifyResult>
  report?(creds, range): Promise<RevenueRow[]>
}

interface Capabilities {
  slotModel: 'per_slot' | 'per_zone' | 'per_site_auto' | 'link_rewrite'
  formats: AdFormat[]
  environments: ('web' | 'amp' | 'mobile')[]
  requiresOwnDomain: boolean      // 🔴 the decisive flag
  requiresSiteApproval: boolean
  requiresAdsTxt: boolean
  requiresCmp: boolean
  reportingApi: boolean
}
```

**`requiresOwnDomain` determines whether a provider can appear in the user's menu at all.**

### The provider menu at entry phase

| Provider type | Works? | Why |
|---|---|---|
| **Affiliate networks** | ✅ **Near-perfect** | A link is your own tag pasted anywhere — no domain ownership, no site approval, no ads.txt, no policy collision. (Major programs like Amazon still require the user to declare the site in their own account — lighter than AdSense, not literally nothing) |
| **Low-barrier networks** (PropellerAds, Adsterra, Monetag, AdMaven, PopAds) | ✅ Usually | Per-zone tags, looser verification, low thresholds |
| **Your own direct campaigns** | ✅ Yes | You're the network |
| **AdSense** | ❌ Not self-serve | Site-ownership verification + domain-level approval + shared publisher code |
| **Ezoic / Media.net / Sovrn** | ⚠️ Not per-user | Per-site approval + MCM review |
| **AdMob** | ❌ No | Mobile SDK; one account per app |
| **AFP** | ✅ The sanctioned path | Invite-only |

### Three onboarding mechanisms — and one impossibility

| Mechanism | Flow |
|---|---|
| **`oauth`** | Redirect out → consent → callback → store token → verify |
| **`paste_credentials`** | In-app form ("paste your publisher/zone ID") → validate → server-side verify |
| **`signup_redirect`** | Deep-link out with a return URL → user signs up → returns → completes |

**You cannot create accounts for users** — no network exposes a publisher-signup API.
**You cannot iframe these flows** — providers send `X-Frame-Options`; circumventing it violates terms.
**So the redirect genuinely leaves your app for a moment.** What you can own is everything around it:
branded interstitial, controlled return URL, resumable state machine, clear confirmation.

Connection state machine: `draft → redirecting → verifying → active → restricted → revoked`, every state
recoverable.

### Governance rule: you own WHERE, they own WHAT

| Platform controls | Tenant controls |
|---|---|
| Placement slots (defined positions) | Which provider fills a slot |
| Maximum ad density | Their credentials |
| Layout envelope, no layout shift | Slot/zone IDs within the provider |
| Compliance, CMP, moderation, kill switch | House creative |

Without this, three users stack four 970×250s, layout collapses, you trip an ad-density violation, and one
domain-wide enforcement action kills ad serving for **every tenant at once**.

### Reporting ceiling — be honest about it

| Case | What you can show |
|---|---|
| Provider API + user OAuth | **Real revenue** ✅ |
| No API | **Impressions you served** — not money ❌ |
| Affiliate | Clicks you can count; conversions live in the merchant's dashboard ❌ |

**Never imply a number you can't substantiate.** Label every figure as *provider-reported*, *estimated from
impressions*, or *see your provider dashboard*.

---

## 7. What is possible

**Asked:** *"So what is possible again?"*

### ✅ Possible today, no permission needed

Affiliate monetisation · low-barrier ad networks · your own direct campaigns · house/fallback ads ·
asset-sale cut · per-user subdomains.

### ⏳ Possible, conditionally

- **AdSense on user subdomains** — your root domain must be approved; subdomains then generally serve **your** publisher code
- **Per-user AdSense IDs** — only via AFP
- **Reporting with real money** — only where an API + OAuth exist

### ⏳ Possible later, gated but real

- **AFP Transparent** — invite-only, contract + Account Manager
- **GCPP/MCM partnership** — a certified partner acts as parent for your users

### ❌ Not possible — design around these

| # | Impossible | Why |
|---|---|---|
| 1 | **Creating ad accounts for users** | No API. Onboarding is their KYC. You build linking, never creation |
| 2 | **Signup/login entirely inside your app** | `X-Frame-Options` blocks iframing; circumventing violates terms |
| 3 | **You moving the ad money** | Each network pays its own publishers; no interception API |
| 4 | **You owning the demand** | An ad server picks which ad; it doesn't create buyers |
| 5 | **AdMob with per-user IDs** | One AdMob account per app in the Play Store |
| 6 | **AdSense on a site the user doesn't own** | Google verifies site ownership |

---

## 8. Capturing revenue

**Asked:** *"Each network pays its own publishers — need a workaround on cutoff. How?"*

### The hard boundary first

**You cannot intercept a payment a network makes to someone else.** Any attempt is a terms violation, and the
approaches to avoid are:

| Don't | Why |
|---|---|
| Ask for ad-account **passwords** | AdSense policy: *"you will only be credited for clicks and impressions on the ad units associated with your account."* Plus you become liable for their traffic |
| Put **your** ad code on their content and share back | Makes the ads legally yours; drags you into payment processing, KYC, withholding |
| Use a **foreign entity / VPS / VPN** to defeat country restrictions | Standard forum advice, standard account termination, and you forfeit accrued balances |
| Promise a cut you can't collect | You've invented a receivable you'll never collect |
| Show **estimated** earnings presented as real | First payout mismatch loses the creator permanently |

### ⭐ A — Make the network pay *you* (referral programs)

| Network | Commission | Terms |
|---|---|---|
| **Adsterra** | **5%** of referred publisher revenue | [*"5% of each referred Publisher revenue with no limits"*](https://adsterra.com/referral-program/) |
| **Monetag** | **5%** of referred monthly earnings | Explicitly **lifetime** |
| **PopCash** | **10%** | From secondary comparisons |
| **BidVertiser** | $10 credit per referred publisher earning $10 | Scales up |

No money movement. User keeps **100%**. Zero collection risk. **And the architecture already supports it** —
`signup_redirect` takes a `signupUrl`, and that URL carries the referral ID. Onboarding and monetisation
become the same code path.

**Attribution reality:** most networks don't offer per-referral sub-IDs. You'll get an aggregate commission.
So never show a user what they "earned the platform" — show **their** earnings from provider APIs, and keep
referral income in your admin labelled aggregate/estimated. **Never blend the two.**

**Anti-abuse:** one attribution per device/fingerprint; **never let a user supply a referral param**
(server-side only); rate-limit; reconcile monthly; **never pay users for referrals** — that builds a fraud
economy.

**Disclose it:** *"bytebikri receives a referral commission from some ad networks when you connect through us.
It costs you nothing, comes out of the network's marketing budget, and does not reduce your earnings."*

### ⭐ B — The inventory split (a cut paid in space)

```
Tenant page: slots 1–3 → tenant's provider, they keep 100%
             slot 4    → PLATFORM slot, your ad code, your revenue
```

A cut captured **entirely in inventory.** No payments, no invoicing, no compliance surface. What YouTube does
to creators.

**Three fairness rules:** never take rank 1 · never tax a page with fewer than 3 slots · one slot, never more.
Result: 20% of a 5-slot page, 33% of a 3-slot page, **0% of a 2-slot page.**

**Never call it a cut:**
> *"Your shop is free. The platform keeps one placement per page as rent."*

### C — Charge for the space (Pro buys out the platform slot)

The slot's value is measurable (`page_revenue / slots × slots_taken`), so pricing writes itself:
*"Pro removes platform ads, NPR 399/month. Your platform slot is currently worth an estimated NPR 130/month."*
This converts a variable, unverifiable ad share into **fixed subscription revenue.**

### D — Capture it downstream

Their ad money lands in their own account → they spend it in your marketplace → you take a cut as **ordinary
commerce.** *"We don't take a cut of your ad earnings. We take a cut when you sell something here."*

### E — Be the network

Direct Nepali campaigns. The only option where you legitimately hold the money, as a normal domestic media
seller rather than a payments intermediary.

### The Nepal payout filter — "cutoff" meaning threshold

| Network | Min payout |
|---|---|
| PropellerAds / Monetag / Adcash / PopAds | **$5** |
| PopCash / BidVertiser / HilltopAds | **$10** |
| Ezoic | $20 |
| Sovrn | $25 ($50 wire) |
| **Google AdSense** | **$100** 🇳🇵 wire only |

**Two Nepal warnings that matter more than the numbers:**
1. **PayPal has historically not supported receiving funds in Nepal** — and several networks route their
   *low-threshold* payouts only through PayPal. A $5 threshold is worthless if PayPal is the only rail.
2. **Nepal prohibits cryptocurrency transactions** — don't surface crypto-only rails to Nepali users.

**Filter providers on three axes, not one:** *can they integrate × can a Nepali actually withdraw × at what
threshold.* Build a "Will I actually get paid?" indicator in the provider picker — nobody does this for Nepal.

### The thing to internalise

A Nepali creator earning **$4/month** means a 20% cut is **80 cents** — for which you'd need a payment
relationship, a reporting integration, a support burden, and an unenforceable promise. Their **first asset
sale** is worth more than a year of that cut.

**The cut you can't take is worth less than the cut you can.**

### Honest modelling of Part B

| Active spaces (4 slots, ~$4/mo page) | Platform slot revenue |
|---|---|
| 100 | **~$25/month** |
| 1,000 | **~$250/month** (≈ NPR 34,000) |

**Part B is not a business on its own** — it's a subsidy making the free tier self-funding. Part A likely
outearns it at small scale; Pro beats both (one NPR 399 subscription ≈ 11 platform slots); the asset-sale cut
beats all three.

---

## 9. The prototype

A runnable proof-of-concept was built at [`../prototype/`](../prototype/) — deterministic slot allocation,
capability gating, fallback chain, referral plumbing. No dependencies, Node 20+.

`npm run demo` (CLI, six sections) · `npm start` (live demo rendering four tenant shops).

### Verified behaviours

| Scenario | Result |
|---|---|
| Free tenant, 5 slots | 4 tenant / 1 platform — **20% share** |
| Free tenant, 2 slots | 2 tenant / **0 platform** — short pages untaxed |
| Pro tenant | 5 tenant / 0 platform — buyout works |
| Connection pending | 4 slots collapse, **space reserved** |
| affiliate → display slot | **BLOCKED** by capability gate |

### Two bugs found only by running it

1. **Provider enablement ≠ connection status.** An active tenant connection to a *disabled* provider correctly
   served nothing — but that conflates "this provider isn't vetted" with "this tenant is live." Production
   needs both flags checked and reported separately, or support tickets become unanswerable.
2. **An unverified referral param rendered as `?VERIFY=…`** — harmless-looking, would have shipped silently,
   and you'd only discover it months later when a commission statement failed to arrive. Now explicitly
   refused: *"Refusing to guess is the correct behaviour: a wrong param breaks attribution silently."*

---

## 10. Earning groups and runaway

**Asked:** *"Maybe different charges for different earning groups so after cashout they can't runaway."*

**Three problems with tiering by earnings:**

1. **You can't measure it.** Your whole model is never seeing their ad earnings — the network pays them
   directly. You could only tier on what you handle (asset sales). Requiring earnings visibility walks back
   toward the payment path the design deliberately avoids.
2. **It targets the people most able to leave.** Top earners have audience, resources, and motive. Raising
   fees on your best customers is the standard way marketplaces lose supply.
3. **Tier cliffs manufacture leakage.** At any threshold, everyone above has an incentive to hide earnings —
   trivial for digital goods. **You'd create the runaway you're trying to prevent.**

**And the core economics: your commission rate determines your leakage rate.** At 5–10% almost nobody evades.
At 25%+ leaking becomes rational business. Raising rates on high earners is self-defeating.

### On runaways specifically

**Distinguish two kinds of lock-in:**
- **by penalty** — fees, reserves, hostage data. Generates resentment, eventually fails.
- **by accumulated value** — their SEO history, reviews, returning buyers living on your domain.

**You already have the second and aren't counting it.** `alice.bytebikri.com` is a subdomain *you* own. Years
of backlinks and rankings accumulate there; leaving means abandoning that. Strongest retention asset in the
design, and it costs nothing to maintain.

**On the stated fear — "take earnings, don't contribute, leave":** line-by-line, what you actually give them
costs almost nothing except **storage/delivery bandwidth** and **payment processing**. So the genuine
free-rider case is narrow: someone burning bandwidth who never sells and never pays. Someone who earns ad
money and leaves cost you almost nothing — **that's churn, not theft.**

**What works, in order:** price the cost not the earnings (meter storage/bandwidth) · make the free tier
self-funding by construction (the platform slot *is* the payment) · reward contribution with the thing you
own (attention/discovery) · settlement terms only where you hold money.

**And the uncomfortable part:** "can't runaway" and "the shop is the user's property" are in direct conflict.
Maximum sovereignty and maximum lock-in cannot both be maximized.

---

## 11. Feature inventory

**~69 doable features. 6 impossible.**

**Accounts & spaces (1–7):** accounts/auth · per-user space · theming · custom domain · entitlements ·
policy status · seller profile & trust signals

**Marketplace (8–19):** arbitrary digital asset upload · storage & CDN · malware scanning · licensing terms ·
pricing · cart/checkout · **merchant-of-record** · refunds · versioning · buyer library · reviews ·
MoR payouts

**Ad system (20–47):** provider registry · per-user ad identity · adapter layer (house/link_rewrite/per_zone/
per_slot) · provider picker with payout verdict · three onboarding mechanisms · connection state machine ·
referral plumbing · sub-ID attribution · closed slot set · allocation policy · deterministic allocation ·
tenant slot assignment · capability-gated validation · resolution service · fallback chain with reserved
height · dynamic ads.txt · CMP/TCF v2.3/Consent Mode v2 · kill switch · impression logging · reporting ingest
· honest labelling · density enforcement · house ads · slot value estimator · Revive direct campaigns ·
geo-aware priority · affiliate rewriting · Prebid (later)

**Revenue (48–54):** 0% cut on user ad earnings (the permanent promise) · referral capture · platform slot ·
Pro subscription · asset-sale commission · visibility fees · refund reserve

**Trust & safety (55–61):** moderation queue · abuse reporting · IVT monitoring · ToS · referral disclosure ·
self-referral detection · audit trail

**Growth (62–65):** search/discovery · featured listings · following/wishlists · SEO (subdomains + Devanagari
content)

**Nepal payments (66–69):** eSewa/Khalti/IME Pay · NPR settlement · payout guidance · Ad Policy compliance

**Not doable (6):** creating ad accounts for users · fully in-app signup · moving the ad money · owning the
demand · AdMob per-user IDs · AdSense on sites users don't own

---

## 12. Hosting and domain

**Asked:** *"Possible to build it and host it right now? No costing, domain for now."*

### The blocker is the domain, and only the domain

| What the ad model needs | On a free platform URL? |
|---|---|
| `ads.txt` at root | Partially — see correction in §14 |
| Per-user subdomains (`alice.…`) | ❌ Wildcard subdomains require DNS control |
| Ad network domain approval | ❌ Nobody approves a shared platform subdomain |
| Users connecting their own IDs | ❌ No network will verify a site neither of you owns |

### The free stack

| Layer | Pick | Why |
|---|---|---|
| Hosting/API | **Cloudflare Workers/Pages** | **Commercial use allowed on free** — unlike Vercel |
| Asset files | **Cloudflare R2** | **Zero egress fees** — kills the only real marginal cost |
| Database | **Neon Postgres** | Permanent free, **no credit card**, scales to zero |
| Auth | Supabase Auth / Neon Auth | Bundled |
| Payments | Gumroad / Lemon Squeezy / Paddle | Merchant-of-record, **% only, no fixed fee** |
| Domain | ❌ | **Required for ads** — the only paid component |

**⚠️ Vercel's Hobby tier prohibits commercial use** — the terms cover "any site that generates revenue
directly or indirectly." A monetizing marketplace there is a terms violation. Don't start there.
Cloudflare's free tier carries no such restriction. ([source](https://www.morphllm.com/comparisons/cloudflare-workers-vs-vercel))

**Also:** Supabase free pauses projects after 7 days idle; Neon scales to zero instead without the pause.

### Can a platform URL substitute for a domain?

**Replit free tier: no custom domains, sleeps after ~5 minutes, 512MB RAM.** Custom domains need Core at
**$17–20/month** — more than a domain costs per year. Worst of both worlds.

**Why platform subdomains fail regardless:**

> "Vercel subdomains foreclose **every major ad network** — not just AdSense. Mediavine, Ezoic, Media.net,
> Raptive: all of them either explicitly require a custom domain or fail their automated checks against
> subdomain URLs. Without one, **the entire ad-revenue ceiling is zero.**"
> — [DEV](https://dev.to/morinaga/why-google-adsense-will-not-approve-a-vercelapp-site-110b)

Same wall reported for `*.netlify.app`, `*.github.io`, **Replit**, and `render.com`.

Plus reputation damage: `*.pages.dev` and `*.vercel.app` are **blocked wholesale by corporate filters** because
the free tiers are common phishing vectors; one ISP blacklisted Vercel's IP entirely; r/InternetIsBeautiful
blanket-banned `vercel.app`.

**Free options that genuinely exist:**

| Option | Verdict |
|---|---|
| **`pp.ua`** | ✅ Best real candidate — free, on the PSL, you're the actual owner. Verify current terms |
| `eu.org` | ❌ Was ideal — **maintainer inactive, requests not being approved** |
| `us.kg` | ⚠️ Reported as successor, also reported gone |
| `is-a.dev`, `js.org`, `thedev.id` | ❌ For personal/open-source projects via GitHub PR; a commercial marketplace would be rejected, and ad networks would treat them as shared domains regardless |
| DuckDNS / no-ip | ❌ No nameserver delegation; built for IoT |
| `$1–3` first-year `.xyz`, `~$5–10` recurring | Cheapest reliable path. Cloudflare Registrar sells at cost |
| `.com.np` | ⚠️ Possibly cheap for a Nepal-first business — **verify with a Nepali registrar; not confident on current pricing** |

**The reframe:** the domain isn't an expense, it's **the access fee to a revenue category.** ~$10–27/year is the
difference between an ad ceiling of zero and an ad ceiling of something.

**What can be done at $0 today:** everything except ads. Build the marketplace on a free URL with path-based
shops, validate that people list and buy.

---

## 13. Mobile and PWA

**Asked:** *"We can't create a mobile app? If something isn't possible in the app, we can keep it in web but
the rest can be done in the app."*

### The blocker isn't ads — it's a 15–30% tax on your actual revenue

Digital goods sold inside an app must use Apple/Google billing — and the exceptions don't include Nepal:

| Region | External purchase links allowed? |
|---|---|
| US (post-Epic v. Apple) | ✅ — Apple's "reasonable commission" pending district-court review |
| EU/EEA | ✅ — via entitlements, ~10–20% fee stack |
| Japan / South Korea | ✅ — with their own fee regimes |
| **Nepal, rest of Asia, Latin America, Africa** | ❌ **"Apple's standard 30% in-app purchase model remains the only option"** |

So in-app digital sales cost **15% (Play, <$1M) to 30% (Apple)** — against ~**5%** via merchant-of-record on
the web. **And MoR providers cannot be used for in-app digital sales at all**, making the commerce
architecture web-only by definition.

**Rate context (2026):** Google Play is reducing standard IAP commission to **20%** (subscriptions 10%) from
June 2026 in key regions, globally by 2027; Apple announced EU moves to **26%** IAP / **15%** link-out /
**10%** for small-business programs (Aug 2026). Physical goods and real-world services are **always 0%**.

### Good news: ads DO work in mobile

Google now permits AdSense in WebView via the **WebView API for Ads** (Mobile Ads SDK 20.6.0+):

> *"AdSense code may only be implemented on web-based pages and **approved WebView technologies**."*
> — [AdSense ad placement policies](https://support.google.com/adsense/answer/1346295)

Previously flat-prohibited; now explicitly allowed. (One Stack Overflow answer: *"This was prohibited in the
past but now it is OK."*) So:

```
Native app → WebView loading alice.bytebikri.com
           → tenant's own AdSense code runs on their own web page
           → tenant gets paid directly
```

**The per-user ad model survives inside a mobile app** — because it isn't really *in* the app, it's the web
page in a shell.

### Nepal developer accounts work

**Nepal is in Apple's App Store territories list.** Nepali developers report linking bank accounts and
receiving payouts at a **$50 threshold**; Apple Developer Program is **$99/year**, Google Play **$25
one-time**. The friction is *paying* for the account — Nepali cards often fail, and Apple requires the card
name to match the account name. Workarounds: Payoneer, or virtual cards (levopay reportedly works for
Apple/Google).

### Recommendation: build a PWA, not a native app

| | Native app | **PWA** |
|---|---|---|
| IAP tax on digital goods | **15–30%** | **None** — it's a website; checkout via MoR |
| Store review | Yes, heavier for UGC marketplaces | **None** |
| Developer account | $99/yr + $25 + payment friction | **None** |
| Installable, push, offline | Yes | **Yes** |
| Codebase | Separate | **Same as web** |
| Distribution | Store search | QR / link — and you need a domain regardless |

**A PWA sidesteps the entire IAP question by not being distributed through a store.**

### The real split is three tiers

| Tier | Contents |
|---|---|
| **Web (canonical)** | Tenant shops on subdomains · all ads · checkout + MoR · payouts · dashboards |
| **PWA** | Everything above, installable |
| **Native app (later, thin)** | Discovery, notifications, shop management, analytics, uploads — and WebView for shops. **No in-app digital purchases** |

The native app becomes a *convenience shell*, not a storefront — the Netflix/Kindle pattern.

**Bonus:** the subdomain design now has a second payoff — it's what makes ads work in WebView too. One
decision serving both surfaces.

---

## 14. Corrections

Recorded because a document that hides its corrections is worse than useless.

### Correction 1 — the subdomain/AdSense claim (most important)

**I originally said:** give each user a subdomain and they add it to their own AdSense account.

**That is the widely-repeated internet advice and it is not reliably true.** Google documents:

> *"**If you sign up with a site you don't own** (e.g. www.google.com), **we won't be able to verify that
> you're the site owner and we won't set up your account.**"*
> — [Owning the site you want to use to participate in AdSense](https://support.google.com/adsense/answer/91205)

Per Google's own Site Kit issue tracker, approval is domain-level and subdomains inherit the parent's status —
naming this exact scenario as a known dead end (`mysite.instawp.com`, `mysite.wordpress.com`, etc.):

> "AdSense no longer requires subdomain sites to be approved individually before ads are served, instead using
> the status of the **parent domain** for each subdomain." — [google/site-kit-wp#8935](https://github.com/google/site-kit-wp/issues/8935)

And a long-time AdSense moderator: *"Once the domain is approved, **any subdomain can only serve ads as long
as it uses the same AdSense publisher code**."*

**Consequence:** "each user brings their own AdSense ID onto my domain" is not a supported self-serve path.
It's precisely the gap AFP fills.

### Correction 2 — ads.txt on `pages.dev`

**I said** ads.txt wouldn't work on a `pages.dev` URL.

**More precisely:** `pages.dev` **is** on the Public Suffix List, so `yourproject.pages.dev` is treated as its
own registrable domain and you *can* serve `/ads.txt` from app routes. **The file isn't the blocker** —
ownership verification, lack of subdomain delegation, and shared-domain reputation are.

### Correction 3 — mobile ads

**I was too pessimistic** in earlier turns. AdSense in an approved WebView **is now permitted** (see §13).

### Correction 4 — process

I drifted from discussion into building and shipped a prototype when the session was explicitly Q&A. The
prototype is a useful reference, but it wasn't asked for. Raised by the user, acknowledged, and corrected by
asking before building thereafter.

---

## 15. Open decisions

| # | Decision | Status |
|---|---|---|
| 1 | AFP Transparent, 0% rev share at launch | ✅ **Decided** — with the caveat that "free now, cut later" needs the schedule published up front and early adopters grandfathered |
| 2 | Market focus | ✅ **Decided** — Nepal first |
| 3 | Who owns the ad money | ✅ **Decided** — nobody moves it; users get paid by networks directly |
| 4 | Web vs native | ✅ **Answered** — web canonical, PWA, thin native shell later |
| 5 | **Should bytebikri ever take an ad rev share?** | 🔶 Open. Recommendation: keep it at 0% permanently and monetise the **asset sale** instead — 20% of a few dollars isn't worth the trust cost |
| 6 | **Which two asset types for v1?** | 🔶 Open. "Mixed, user's choice" is right long-term, wrong for v1 |
| 7 | **Domain** | 🔶 Open. Blocks the entire ad layer. `pp.ua` free, or ~$5–10 recurring |
| 8 | **What is the first vertical for direct sales?** | 🔶 Open. Festival retail, education consultancies, hospitality/trekking, healthcare |
| 9 | **Build the hostable slice?** | 🔶 Awaiting go-ahead |
| 10 | **Prototype disposition** | 🔶 Still running; keep/stop/delete undecided |

### The five things that matter most

1. You own the **space**; the user owns **what's on it**
2. You can own the **decision layer** — not **their money**, and you don't need to
3. **Affiliate first** — fewest structural blockers of any category
4. **Nepal direct sales** is where the real ad money is (~$0.03 CPC from AdSense on Nepali traffic)
5. **One advertiser paying real NPR** beats any amount of auction-engine work

### The two sentences that define the model

> **Referral:** *We get paid by the network for bringing you, and you keep everything you earn.*
>
> **Slot:** *Your shop is free. The platform keeps one placement per page as rent.*

---

## 16. Sources

Primary and secondary sources consulted, all read 2026-09-21:

**Google documentation**
- [AdSense for Platforms](https://developers.google.com/adsense/platforms) · [Transparent overview](https://developers.google.com/adsense/platforms/transparent/overview) · [FAQ](https://developers.google.com/adsense/platforms/transparent/faq) · [Getting started](https://developers.google.com/adsense/platforms/transparent/initial-tasks) · [ads.txt](https://developers.google.com/adsense/platforms/transparent/ads-txt) · [Direct model](https://developers.google.com/adsense/platforms/direct/overview) · [Register interest](https://developers.google.com/adsense/platforms/register-interest)
- [Owning the site you want to use](https://support.google.com/adsense/answer/91205) · [Ad placement policies](https://support.google.com/adsense/answer/1346295) · [ads.txt FAQs](https://support.google.com/adsense/answer/9785052) · [Payment methods](https://support.google.com/adsense/answer/1714397) · [Joint AdSense account](https://support.google.com/adsense/answer/115979)
- [Multiple Customer Management](https://support.google.com/admanager/answer/11130475) · [Invite a child publisher](https://support.google.com/admanager/answer/9470824)
- [site-kit-wp #8935](https://github.com/google/site-kit-wp/issues/8935)

**Ad tech / market**
- [Setupad — MCM guide](https://setupad.com/blog/google-mcm-guide/) · [Freestar — Guide to MCM](https://freestar.com/guide-to-google-mcm/) · [Mile — GAM guide](https://www.mile.tech/blog/google-dfp-publishers-ultimate-guide)
- [Adsterra referral program](https://adsterra.com/referral-program/) · [Monetag/PropellerAds referral](https://propellerads.com/blog/pub-earn-easily-with-propellerads-referral-program) · [Best ad networks for small publishers](https://blog.clickio.com/best-ad-networks-for-publishers/)
- [Prebid.org](https://prebid.org/) · [Revive Adserver](https://www.revive-adserver.com/)
- [Apple EU commission changes](https://www.apple.com/newsroom/2026/08/apple-announces-changes-for-apps-in-the-european-union/) · [RevenueCat — app-to-web purchases](https://www.revenuecat.com/blog/engineering/app-to-web-purchase-guidelines) · [Adapty — EU IAP fees](https://adapty.io/blog/apple-eu-in-app-purchase-fee-system-2025/)
- [Why AdSense won't approve a *.vercel.app site](https://dev.to/morinaga/why-google-adsense-will-not-approve-a-vercelapp-site-110b) · [Vercel vs Cloudflare free tiers](https://www.morphllm.com/comparisons/cloudflare-workers-vs-vercel)

**Nepal**
- [SR Zone — AdSense CPC by country](https://www.thesrzone.com/2022/03/adsense-cpc-rates-by-country-2022.html) · [Gurkha Technology — advertising in Nepal](https://gurkhatech.com/estimate-of-advertising-activities/) · [Arjan KC — Nepal pricing 2026](https://arjankc.com.np/blog/digital-marketing-pricing-nepal-2026/) · [Epitome — digital marketing Nepal](https://epitomesolutions.org/blog/digital-marketing-nepal/) · [BijayWorks — honest guide](https://bijayworks.com/digital-marketing-in-nepal/) · [Nepali Nerd — AdSense withdrawal](https://nepalinerd.com/withdraw-money-from-google-adsense/) · [Kharchapatra — creator income tax](https://kharchapatra.com/blog/creator-income-tax-youtube-tiktok-nepal) · [GPR — tax for IT companies](https://gpr.com.np/tax-and-compliance-for-it-companies-nepal) · [Khabarhub — National Advertisement Policy](https://english.khabarhub.com/2026/02/556628/)

**Infrastructure**
- [Neon free tier](https://neon.com/faqs/managed-postgres-databases-free-tier) · [Cloudflare Pages free limits](https://temps.sh/blog/cloudflare-pages-free-tier-limits-2026) · [Replit custom domains](https://docs.replit.com/features/publishing/custom-domains) · [is-a.dev / free-domains registry](https://github.com/abint7/free-domains)

---

### Documentation index

| Doc | Covers |
|---|---|
| [`README.md`](./README.md) | The one-page "what is possible" summary |
| [`monetization-model.md`](./monetization-model.md) | The three models · MCM · money paths · Nepal tax facts |
| [`entry-phase-ads-playbook.md`](./entry-phase-ads-playbook.md) | AFP Transparent · the 0% rev-share decision |
| [`ad-infrastructure-plan.md`](./ad-infrastructure-plan.md) | Nepal market · three-layer architecture · Revive/Prebid |
| [`ad-adapter-architecture.md`](./ad-adapter-architecture.md) | Adapter interface · capability matrix · onboarding · data model |
| [`revenue-capture.md`](./revenue-capture.md) | Workarounds A–E · Nepal payout filter · what not to do |
| [`spec-referral-and-slots.md`](./spec-referral-and-slots.md) | Implementation spec for A + B · schemas · acceptance criteria |
| [`provider-verification-checklist.md`](./provider-verification-checklist.md) | The email to send providers · verification table |
| [`registry/providers.example.json`](./registry/providers.example.json) | Seed provider registry |
| [`../prototype/`](../prototype/) | Runnable proof-of-concept |

---

*Nothing here is legal, tax, or financial advice. Confirm Nepal tax treatment with a chartered accountant,
and re-verify every ad-network policy and rate against current published terms before building on it —
these change faster than any document about them stays accurate.*
