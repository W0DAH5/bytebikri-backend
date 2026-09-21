# Multi-Provider Ad Infrastructure — Can We Build It Ourselves?

**Project:** bytebikri · **Date:** 2026-09-21 · **Status:** Architecture decision
**Companions:** [`monetization-model.md`](./monetization-model.md) · [`entry-phase-ads-playbook.md`](./entry-phase-ads-playbook.md)

**Question:** *Can we build our own infrastructure that supports multiple ad providers, working the way we
described — users bring their own IDs, revenue bypasses the platform — starting from Nepal's local market?*

**Answer: Yes for the serving, routing, and reporting layers. No for the payment layer. And starting from
Nepal changes this from "a nice idea" into "the actual business."**

---

## 0. Decisions locked

| Decision | Value |
|---|---|
| AFP Transparent, revenue share | **0% at launch**, cut later — with the caveat in playbook §5a |
| Market focus | **Nepal first** |
| Ad revenue model | Users keep their own network earnings; bytebikri earns from **asset sales** |
| Infrastructure | **Own the routing layer, rent the demand** |

---

## 1. What you can and cannot own

You asked to build "our own infra supporting multiple ad providers." Be precise about which layer you mean,
because one of them is buildable and one is not.

| Layer | Ownable? | Notes |
|---|---|---|
| **Demand** — someone willing to pay for the impression | ❌ **No** | An ad server decides *which* ad; it does not *create* buyers. You cannot conjure demand with code |
| **Payments** — money reaching users | ❌ **No** | Each network pays its own publishers on its own schedule and terms. There is no API to intercept this, and trying to route around it violates their terms |
| **Ad decisioning** — which provider serves this slot | ✅ **Yes** | Fully buildable. This is the core of what you described |
| **Per-user identity & routing** — whose ID goes on which page | ✅ **Yes** | Fully buildable, and it's your actual product |
| **Serving & rendering** | ✅ **Yes** | Buildable, or adopt an open-source ad server |
| **Reporting** — unified earnings across providers | ✅ **Yes** | Partially buildable (provider APIs where available) |
| **Direct campaigns** — selling your own inventory | ✅ **Yes** | Fully buildable, and **in Nepal, this is where the money is** |

So: **you can own the whole decision layer and the whole local-demand layer. You cannot own the global
networks' payment rails — and you don't need to.** The bypass model still holds; you just aren't the one
moving money for it.

---

## 2. The Nepal reality check — and why it changes everything

Before architecture, look at the numbers, because they invert the usual logic.

### AdSense CPC in Nepal is $0.03

Nepal sits at roughly **$0.03 average CPC** — against a global average of about **$1.33** and India at about
**$0.50** ([SR Zone's country CPC compilation](https://www.thesrzone.com/2022/03/adsense-cpc-rates-by-country-2022.html),
citing AdExpresso data). That is roughly **1/40th of the global average**.

Put plainly: **global programmatic advertising values a Nepali eyeball at almost nothing.** If your users'
ad earnings come from AdSense on Nepali traffic, they will earn fractions of a rupee per thousand views. The
earlier warning about thin Tier-3 CPMs was, if anything, understated for Nepal specifically.

### But Nepali advertisers spend real money — just not programmatically

Look at what's actually happening in the market:

- **Digital is ~34% of total ad spend in Nepal**, with TV at ~28% ([Gurkha Technology](https://gurkhatech.com/estimate-of-advertising-activities/)).
- Nepali agencies charge **NPR 15,000–40,000/month** for ads management alone, or **10–20% of ad spend**
  ([Arjan KC's 2026 pricing guide](https://arjankc.com.np/blog/digital-marketing-pricing-nepal-2026/)).
- Typical SME budgets run **NPR 40,000–120,000/month** across channels; Google Ads spend alone commonly
  Rs 15,000–100,000+ ([Epitome Solutions](https://epitomesolutions.org/blog/digital-marketing-nepal/)).
- **Facebook is the market**: ~17.3M users, 53.7% of the population
  ([BijayWorks](https://bijayworks.com/digital-marketing-in-nepal/)). Local portals like Onlinekhabar,
  Setopati and Hamro Patro carry the display inventory.

**Read those two facts together and the conclusion is unavoidable:**

> A Nepali business will pay real NPR to reach Nepali customers. A global ad network will pay ~nothing for
> that same impression. **The demand exists; it just isn't programmatic.**

This is the single most important insight in this document. It means:

1. **The ad networks are the wrong primary monetisation for Nepal.** Not because they're bad — because they
   are structurally unable to price Nepali traffic properly. Use them as a filler layer, not the engine.
2. **Building your own infra isn't optional polish in Nepal — it's the only way to capture the actual value.**
   You become the intermediary that connects local advertisers to local content. That's a business global
   networks will never build for Nepal, because the market is too small for them and too valuable for you.
3. **You also get NPR-denominated revenue**, which sidesteps forex, wire transfers, the $100 AdSense
   threshold, and the entire payout-friction problem in one move.

---

## 3. The architecture — three layers

```
┌─────────────────────────────────────────────────────────────────┐
│  LAYER 1 — DIRECT LOCAL CAMPAIGNS          (you sell, you earn) │
│  Nepali advertisers → your ad server → your inventory           │
│  Paid in NPR. Highest CPM for Nepali traffic. YOUR revenue.     │
├─────────────────────────────────────────────────────────────────┤
│  LAYER 2 — USER-OWNED GLOBAL NETWORKS      (they earn, you don't)│
│  User's own AdSense/Ezoic/affiliate ID → user's own account     │
│  Global programmatic. Fine for international traffic.           │
├─────────────────────────────────────────────────────────────────┤
│  LAYER 3 — HOUSE ADS / FALLBACK            (you control)        │
│  Platform promos, featured sellers, empty-slot collapse         │
└─────────────────────────────────────────────────────────────────┘
                     ▲
        YOUR RESOLUTION SERVICE decides the winner
        (per page, per user, per geography)
```

**The priority logic is the product.** For a Nepali visitor, Layer 1 should win — because a local advertiser
pays more for that impression than any global network will. For a visitor in the US, Layer 2 should win,
because the user's own programmatic account will outearn anything you could sell locally. **Your resolution
service is the arbitrage engine**, and it's genuinely valuable work that no provider will do for you.

### The revenue split that follows

| Layer | Who earns | Why it's fair |
|---|---|---|
| **1 — Direct local** | **bytebikri** (you sold it, you carry the risk, you collect and settle) | You did the sales work. You can pay creators a rev share from it |
| **2 — User networks** | **The user, 100%** | Their account, their content, their ID. You take 0% — the promise you're making |
| **3 — House** | **bytebikri** | Your own promotions |

**This resolves the playbook §5a dilemma cleanly.** You keep the 0% promise permanent — *"your ad network
earnings are 100% yours, forever"* — and you still make money from ads, via Layer 1, where the money is real
and you genuinely earned it. You never have to break a promise, because you were never taking a cut of
*their* earnings in the first place.

---

## 4. Build vs. adopt

### Adopt: **Revive Adserver** (for Layer 1)

[Revive Adserver](https://www.revive-adserver.com/) is the mature open-source ad server (GPL, formerly
OpenX/phpAdsNew). It does exactly what Layer 1 needs:

- **Multiple advertisers, unlimited**, from one console — "advertisers are businesses that have agreed to run
  ad campaigns on your inventory"
- **Contract / remnant / override campaigns** — the priority waterfall you need for Layer 1 vs Layer 2
- **Geotargeting** (MaxMind GeoIP2) — essential for the "Nepal vs international" routing
- **Frequency capping, URL targeting, delivery rules**
- **Reporting** on impressions, clicks, CTR, conversions, revenue, eCPM
- **Client logins** so advertisers can see their own stats
- Documented for "networks and agencies managing campaigns across many sites from one console"

Known weaknesses, stated honestly: dated UI, PHP/MariaDB, limited APIs without paid extensions, limited
programmatic features, and community-support-only. It is deployment and integration work, not a SaaS signup.

**Verdict: adopt it to learn the domain and serve Layer 1 fast. Do not build an ad server from scratch for
v1** — you'd be rebuilding a solved problem while your real differentiator (per-user routing + local sales)
goes unbuilt.

### Use carefully: **Prebid.js** (later, not now)

[Prebid.js](https://prebid.org/) is the leading open-source header bidding wrapper — 300+ bidder adapters,
used by 88,000+ sites, free. It runs parallel auctions across many demand sources. Crucially for you, **it is
not tied to Google Ad Manager** — it works with any ad server, including Revive.

**But do not start here.** Prebid's entire value is extracting more from *programmatic demand*. In Nepal,
programmatic demand is worth ~$0.03 CPC. **You would be building an auction to sell something nobody is
bidding on.** Prebid becomes relevant at Stage 3, when you have meaningful international traffic.

There are also white-label SSP vendors (Teqblaze and similar) who'll sell you Prebid-based infrastructure
under your own brand, if you later want that route without building it.

### Build yourself: **the resolution + identity layer**

This is the piece nobody sells you and the piece that *is* bytebikri:

- Per-user ad identity registry (multiple providers per user, each with its own ID)
- Content → owner → identity resolution
- Priority/waterfall logic (geo-aware: Layer 1 for Nepal, Layer 2 abroad)
- Server-side impression logging and unified reporting
- Kill switch, revocation, moderation hooks
- Provider adapters — one per network, so adding a provider is a plugin, not a rewrite

**Design rule: provider adapters behind a single interface.** Start with AdSense + one affiliate network +
your own direct campaigns. Adding a fifth provider should be a config change.

---

## 5. The tension you need to accept

There is one genuine conflict between this and everything we designed earlier, and I'd rather flag it than
let you discover it in month nine.

**Building Layer 1 puts you back in the payment path.**

If you sell ad space to a Nepali advertiser, they pay **you**, and creators get paid by **you**. That's Model
A — the thing we deliberately designed away from in the first two documents, because of KYC, withholding,
payout rails, and money-transmission risk.

**But it is a different risk, and a smaller one:**

| | Ad-network payouts (avoided) | Local direct ad sales (proposed) |
|---|---|---|
| Currency | Foreign (USD), forex conversion | **NPR, domestic** |
| Regulator sensitivity | NRB/forex, cross-border | Standard domestic business |
| Your role | Money transmitter-adjacent | **Ad agency / media seller** — a normal Nepali business |
| Tax treatment | Export, zero-rated VAT, 5% flat | **Domestic service: 13% VAT, TDS rules apply** |
| Paperwork | Per-user KYC, withholding, cross-border compliance | **One invoice to one advertiser** |
| Counterparties | Thousands of users | **Dozens of advertisers** |

Being a Nepali ad agency that collects NPR from Nepali businesses and pays Nepali creators is a
**well-understood, ordinary business** — not a novel payments problem. The compliance burden is real (VAT
registration once domestic service turnover crosses **Rs 30 lakh**, TDS on payments to creators, proper
invoicing) but it is *tractable and familiar*.

**The hybrid is what makes it work:** Layer 2 stays pure-bypass and promise-keeping; Layer 1 is a conventional
local ad agency business. Two clean models running side by side, not one muddled compromise.

**Get a Nepali accountant involved before you sell your first campaign**, not after.

---

## 6. Build order

| Phase | Ad infrastructure | Goal |
|---|---|---|
| **P0 — Now** | Identity registry + tag resolution + ads.txt + CMP. **No demand layer yet.** | Ship the marketplace. Learn what content users actually make |
| **P1 — First creators** | Layer 2 live: users connect their own network accounts, earn 100%. Kill switch. Moderation. | Prove the model works, at zero cost to you |
| **P2 — First advertiser** | Stand up Revive. Sell **one** local campaign. Geo-targeted to Nepal. | Prove someone will pay NPR. This is the real validation |
| **P3 — Scale Layer 1** | Revive + your resolution service + per-creator rev share. Self-serve advertiser portal | Bytebikri becomes an ad network for Nepal |
| **P4 — Yield** | Add Prebid.js / a white-label SSP once international traffic justifies it | Extract more from global programmatic |

**The single most important milestone is P2: one Nepali advertiser paying real NPR.** Everything before it is
infrastructure; everything after it is a business. Do not let the tech work delay it.

---

## 7. Market and regulatory context worth watching

- **Nepal's National Advertisement Policy was approved in February 2026**, aimed at regulating digital ads and
  AI-generated content, with **incentives for local advertisers** and reportedly a requirement that companies
  selling foreign products allocate part of their spend to consumer awareness campaigns
  ([Khabarhub](https://english.khabarhub.com/2026/02/556628/)). **Verify this — if foreign sellers are
  required to spend locally, that is mandated demand for exactly the inventory you'd be aggregating.** This
  could be the single biggest tailwind available to you. Read the policy text properly.
- **Facebook is the incumbent**, not Google. 17.3M users, 53.7% penetration. You are competing for Nepali
  attention against Facebook and TikTok, not against AdSense.
- **Nepali-language (Devanagari) content is underserved.** Competition for Nepali-script queries is a
  fraction of English-language competition. That's a real wedge for a Nepal-first content marketplace.
- **Local payment rails** — eSewa, Khalti, FonePay, IME Pay — are the natural settlement layer for Nepali
  creators, and are cited as underused marketing levers. Check their merchant/bulk-payout terms early,
  because they determine whether paying 50 creators NPR 2,000 each is practical.
- **Festival calendar drives Nepali ad budgets** — Dashain, Tihar, Teej, Losar concentrate purchase intent.
  Your first campaign sales conversations should be timed around them.

---

## 8. Direct answers to what you asked

**"Can we build infra that supports multiple ad providers in the way I mentioned?"**
Yes — the routing, identity, serving, and reporting layers are fully buildable, and Revive Adserver plus
Prebid.js give you mature open-source components so you're not starting from zero. You cannot own the
networks' payment rails, but you don't need to; each provider pays its own publishers directly.

**"Can we not rely only on Google?"**
You shouldn't, and in Nepal you structurally can't. Google prices Nepali traffic at ~$0.03 CPC. Your own
direct-sales layer will outearn it on Nepali traffic by a wide margin. Google becomes one provider among
several — which is exactly the resilience you were asking for.

**"Starting from Nepal's local market" — is that right?**
For this model, **yes, and it's arguably the strongest version of the idea.** Global platforms won't build
for Nepali advertisers because the market is too small for them. That's precisely why it's available to you.
The play is: **become the ad network Nepal doesn't have.** Domestic advertisers, domestic creators, NPR
settlement, your own infrastructure.

---

## 9. Open decisions

1. **Revive vs. build later?** My recommendation: adopt Revive for P2–P3, revisit only if it becomes a
   limitation. It's PHP and dated, so weigh the maintenance burden honestly.
2. **Do creators get a rev share of Layer 1 revenue, or a fixed NPR rate per 1,000 views?** Rev share is
   fairer and self-adjusting; fixed rate is far simpler to explain and to budget. For Nepali creators, a
   **transparent fixed NPR rate** may build more trust than a percentage of an opaque number.
3. **Advertiser self-serve or sales-led?** At NPR 15,000–40,000/month deal sizes, sales-led is realistic at
   first — that's a phone call, not a funnel.
4. **Does Layer 1 inventory require editorial control?** If Nepali brands are buying placement next to
   user content, brand safety becomes a sales objection you must be able to answer.
5. **What's the first vertical?** Festival retail, education/consultancies, hospitality/trekking, and
   healthcare are all heavy Nepali digital spenders — and each has different creative and compliance needs.

---

*CPC and market figures are drawn from the cited third-party sources on 2026-09-21 and are order-of-magnitude
indicators, not audited numbers — validate against your own AdSense account and local agency quotes before
building a financial model on them. The National Advertisement Policy detail in §7 is from secondary
reporting and must be checked against the primary text. Not legal, tax, or financial advice — consult a
Nepali chartered accountant before selling inventory.*
