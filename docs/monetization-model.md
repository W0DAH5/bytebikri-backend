# Monetization Model — Design Decision Note

**Project:** bytebikri · **Status:** Decided direction, staged plan · **Date:** 2026-09-21
**Supersedes:** the exploratory draft of the same day.

---

## 0. Decisions recorded

| Question | Your answer | Consequence |
|---|---|---|
| What do users sell/show? | **Mixed, user's choice** | Platform must handle arbitrary digital assets (Gumroad-class file handling), not one format |
| Do you take a cut of ad money? | **Yes — but paid to you by the ad network**, never held or forwarded by you | Model B / MCM. Cleanest legally, **hardest to unlock**. See §2 |
| Which ad company? | Open — advise me | Google is the only realistic default; see §3 |
| User geography | **Global** | Triggers mandatory EEA/UK/CH consent infrastructure, US state privacy, and cross-border payout reality. See §6 |

---

## 1. Verdict in one paragraph

**You have picked the correct end-state and the wrong starting point.** "Network pays the user directly,
and pays me my share directly, so their money never touches my accounts" is a real, supported model —
it is exactly what Google Ad Manager's **Multiple Customer Management (MCM)** does. It is also locked
behind an enterprise gate you cannot pass at launch. So the plan is not *"can I do this"* — it's
*"in what order do I get there."* Stage 0 of that plan is achievable this month; the rev-share stage is
a scale problem, not a policy problem.

---

## 2. The gate: MCM rev-share is not available to you yet

MCM terminology: you would be the **parent publisher**, each user a **child publisher**. Under the
**Manage Account** delegation with payment routed through Google, Google auto-pays the child *and*
auto-pays you your agreed share — **"applied to each child account managed by the parent publisher when
payment is routed through Google."** That is precisely the money flow you described, and it is the only
mainstream implementation of it.

**Why you can't have it at launch:**

1. MCM is a feature of **Google Ad Manager 360** — a paid, contract-based enterprise product, not the
   free "GAM for small business" tier.
2. Ad Manager 360 eligibility is scale-gated. Industry estimates put the entry threshold in the region of
   **90M–200M monthly impressions** depending on country and format ([Mile, GAM guide](https://www.mile.tech/blog/google-dfp-publishers-ultimate-guide)).
   Treat that figure as an order of magnitude, not a published rule — but the order of magnitude is the point.
3. MCM **parent** status in practice is granted to ad-tech companies and Google Certified Publishing
   Partners, not to individual platforms applying cold.
4. Ancillary prerequisites you won't have on day one anyway: a verified site, an active Ads Manager
   account, a valid `ads.txt`, no copyright or sensitive-content violations, demonstrable anti-fraud
   controls, and a clean account history.

**Conclusion: MCM is a 2–4 year destination, gated on traffic, not on paperwork.** Plan accordingly.
Anyone who tells you to "just apply for MCM" has not tried.

---

## 3. The fork I did not expect: **web vs. native mobile**

This is now the most important open question in the project, because the two platforms have
*different* rules and only one of them supports what you want.

| | Web (AdSense / Ad Manager) | Native app (AdMob) |
|---|---|---|
| Multiple publishers on one property | **Explicitly allowed.** "Publishers are allowed to place ad code from more than one AdSense account on a page that complies with our program policies." ([Google](https://support.google.com/adsense/answer/115979)) | **Murky and actively policed.** Google has stated ad units from multiple accounts in one app are technically fine, but it is **not permitted to have multiple AdMob accounts connected to the same app in the Play Store**, and the company enforces this. Community reports of bans are common |
| Declaration surface | `/ads.txt` — you control it, you can generate it dynamically | No equivalent; you do not control the app-level declaration surface |
| Per-content ad targeting by owner | Natural — inject the right tag per page | Requires shipping ad unit IDs inside a binary; changes need app releases |
| Practical verdict | **Works today** | **Do not build your model on this** |

**If bytebikri is a native mobile app, the "user brings their own ad account" model is effectively
dead on Google's stack** and you need a different ad partner (or a web-based content surface).

**If bytebikri is web, you can ship your exact model this month** — just without your rev-share, because
AdSense pays the user directly and pays you nothing. That is Stage 0.

---

## 4. Stage 0 — what you can ship now

The user experience is **identical** to the end state. The only difference is where your revenue comes from.

**Ad layer (works today):**
- User connects **their own** Google AdSense account.
- Your platform injects *their* ad tag on *their* content pages.
- Google pays **them** directly, into their bank account, on the 21st of each month.
- You take **0%** of that money, hold none of it, and invoice nobody. Zero payout infrastructure, zero
  money-transmission exposure, zero KYC burden on you.
- Your ToS grants you the placement permission Google requires, and reserves your right to remove any
  publisher ID at any time.

**Your revenue comes from elsewhere (§5).**

**Important consequence to design for:** because the AdSense account belongs to the user, **you cannot see
their earnings.** An "earnings dashboard" inside bytebikri requires each user to separately OAuth into the
**AdSense Management API** — a second auth flow per user, and API access that Google controls tightly.
Without it, you can only show *impressions you served*, not money. Decide now whether the dashboard shows
"estimated revenue (their account, linked)" or just "views on your content." This changes your product.

---

## 5. Where your money actually comes from

| # | Source | Money path | Notes |
|---|---|---|---|
| 1 | **Your own ads on your own inventory** | Google → you | Home, search, discovery, category, and editorial pages are *your* traffic. Users earn on *their* pages; you earn on *yours*. Highest-confidence revenue at launch |
| 2 | **Cut of digital-asset sales** | Buyer → merchant-of-record → you + seller | Use a **merchant of record** (Paddle, Lemon Squeezy, Gumroad-style) so they handle global VAT/sales tax and you never hold buyer funds. This is commerce, not payouts — a far cleaner legal posture |
| 3 | **Pro subscriptions** | User → you | Analytics, custom storefront, higher listing limits, ad-free storefronts, bulk upload |
| 4 | **Visibility fees** | Seller → you | Featured placement, promoted listings, homepage slots |
| 5 | **MCM rev-share** *(dest. §7)* | Google → you, directly | The thing you actually asked for. Locked until Stage 2 |

**Recommended stack: 1 + 2 + 3.** Note that with "mixed, user's choice" assets, source **2** is probably
the *stronger* business than ads — for digital goods, one template sale can beat a month of impressions.
Ads are the passive layer; the asset sale is the product.

---

## 6. Global users: what you just signed up for

Answering "global" triggers mandatory infrastructure. This is not optional polish — without it you lose
most of your high-value traffic.

**Consent is mandatory, not best-practice.** Since **16 January 2024** for the EEA and UK, and
**31 July 2024** for Switzerland, publishers using AdSense, Ad Manager, or AdMob **must use a
Google-certified CMP integrated with IAB Europe TCF v2.3** to serve personalized ads. Without it, Google
restricts ad serving to non-personalized or limited ads in those regions — i.e. the best-paying traffic
degrades to the worst-paying. Consent Mode v2 signalling is part of the requirement
([Cookiebot](https://www.cookiebot.com/en/google-certified-cmp-requirement-cookiebot/)).

**Also in scope for global:**
- US state privacy: CCPA/CPRA, plus GPC signal handling.
- Per-jurisdiction content rules — taken seriously here, because a Google policy violation on your domain
  devalues the domain for **every** publisher on it, not just the offender.
- **Dynamic `/ads.txt`.** One domain, one ads.txt — collect *your* line plus every active user publisher ID.
  This file becomes production infrastructure: always available, never stale, revocation reflected instantly.
- Multi-currency, multi-language, and timezone-correct reporting.

---

## 7. The staging roadmap

| Stage | Trigger | Ad model | Your revenue | Key work |
|---|---|---|---|---|
| **0 — Launch** | Now | AdSense, user-owned accounts (web only) | Sources 1–3 (§5) | Publisher linking, tag injection, dynamic ads.txt, CMP, moderation, kill switch |
| **1 — Scale** | Steady traffic, clean history, AdSense+site verified | Same, plus GAM for small business | + better yield on your own inventory | Apply to GAM; professionalize yield; build IVT monitoring |
| **2 — MCM** | Traffic in the tens of millions of impressions/month | **MCM Manage Account, payment routed through Google** | **MCM rev-share — Google pays you directly** | GAM 360 contract; MCM parent approval *or* commercial deal with an existing GCPP parent |

**The pragmatic shortcut for Stage 2:** don't try to become an MCM parent. Partner with a company that
**already is one** (a Google Certified Publishing Partner). They act as parent to your users, pay the users
directly through Google's auto-payment, take their cut, and pay you a platform share by commercial
agreement. Your users' money still never passes through your accounts, and you get a cut much earlier than
you would by waiting for your own MCM parent status.

---

## 8. Uncomfortable reality check on CPMs

Because your users are global but likely South-Asia-first, this needs saying plainly:

**Ad revenue per view in Tier-3 geographies is a small fraction of Tier-1.** Order-of-magnitude — verify
against your own AdSense dashboard once live, do not take these as measured figures — a Tier-3 display RPM
might be a few tens of cents per thousand views, where US/UK traffic can be several dollars to low tens.
At the low end, 10,000 views might gross a few dollars; a creator needs on the order of hundreds of
thousands of views a month to earn a modest local salary.

**What this means for the product:**
- Ads alone will disappoint the user base you described. **The asset sale is the earning mechanism; ads are
  the supplement.**
- Your ad-revenue rev-share (Stage 2) is a low-margin line even at scale. Budget accordingly.
- Onboarding must set expectations **before** users invest effort. Over-promising earnings is the fastest
  way to churn your whole creator base and earn a reputation problem.
- Consider paying creators in *visibility* (placement, discovery) at Stage 0, and in *money* only where the
  traffic genuinely supports it.

---

## 9. Nepal-specific facts worth knowing

**Good news — your Nepali users can actually get paid.** Per Google's own APAC payment table, Nepal
supports **Check** and **Wire Transfer** for AdSense (no EFT, no Hyperwallet). Wire transfer is the usable
route: minimum **US$100**, paid on the **21st** of the month, typically landing within a few days to a week,
and up to 15 business days ([Google AdSense payment methods](https://support.google.com/adsense/answer/1714397),
[Nepali Nerd walkthrough](https://nepalinerd.com/withdraw-money-from-google-adsense/)). Users need their
bank's SWIFT BIC. Recommend a commercial bank — Global IME and NMB are commonly cited as fast.

**Tax treatment:**
- AdSense income is treated as **export of services → zero-rated for VAT**. VAT registration becomes
  mandatory once service turnover crosses **Rs 30 lakh** in a rolling 12 months.
- **Foreign-currency income up to Rs 40 lakh/year is taxed at a flat 5% final rate**, typically deducted at
  the bank at the point of FX conversion when PAN is linked. Above that, normal slabs apply
  ([Kharchapatra](https://kharchapatra.com/blog/creator-income-tax-youtube-tiktok-nepal)).
- For a **registered company** earning foreign ad/IT revenue: exported IT services are zero-rated for VAT,
  and a **75% income-tax rebate** can bring the effective rate to roughly 6.25% — conditional on receiving
  payment in **convertible foreign currency through formal banking channels**, with contracts, invoices and
  bank receipts retained ([GPR](https://gpr.com.np/tax-and-compliance-for-it-companies-nepal)).
- **Structurally this is Stage 0's biggest advantage:** because Google pays each user directly, the entire
  tax, VAT and payout burden sits on **the user**, not on you. No withholding, no NRB/forex questions, no
  money-transmission exposure.

---

## 10. What has to be built (Stage 0 technical scope)

**Publisher linking**
- OAuth / sign-in hand-off to the user's own ad account, **or** manual publisher-ID entry + verification.
- **You cannot create ad accounts for users.** Ad networks expose no such API; onboarding is their own KYC
  flow — legal identity, address, tax details, phone verification, site review. What you build is
  *account linking*, never *account creation*.
- Per-user state machine: `unlinked → pending_review → active → suspended → revoked`.

**Tag injection service**
- Resolve `content → owner → publisher ID` and render the correct tag server-side.
- Cache tag fragments; make the resolution path fast and always available.
- **Never render a suspended or revoked user's tag.** Fall back to house/your-own ads.
- If a user's account is pending review, their slot may render blank — decide now whether to fill or collapse.

**Dynamic `/ads.txt`**
- Generated from your own line plus all `active` publisher IDs; short TTL; instant revocation; high availability.

**Consent & privacy**
- Google-certified CMP, IAB TCF v2.3, Consent Mode v2, US state signals.

**Trust & safety (non-negotiable, because it is your domain at stake)**
- Content moderation, abuse reporting, IVT/bot-traffic monitoring.
- **Kill switch:** strip any publisher ID from any page within seconds, with an audit trail.
- Published policy + support script for "Google banned my account" — that ticket is coming, and it will
  arrive before you have a support team.

**ToS**
- Grant of ad-placement permission; user warrants content rights; no earnings guarantee; your right to
  remove any publisher ID; users are independent publishers — not your agents, employees, or partners.

**Asset commerce (the "mixed, their choice" requirement)**
- Arbitrary file storage + delivery/CDN, virus scanning, licensing terms, refund policy, and a
  **merchant-of-record** for global tax.

---

## 11. Open questions, in priority order

1. **Web, native mobile, or both?** (§3) This is the single most consequential unanswered question — it
   decides whether your ad model is shippable at all.
2. **Does the in-app dashboard show money, or only views?** If money, you need per-user AdSense API OAuth (§4).
3. **What are the three asset types you'll support at launch?** "Mixed, user's choice" is right long-term
   and wrong for v1 — start with two or three formats done properly.
4. **Is there a Nepal focus at all?** Your users being global while you're Nepal-based is fine for Stage 0
   but changes payment rails and support load the moment you start paying anyone.
5. **Do you want my help designing the publisher-linking + tag-injection schema next?** That's the concrete
   first buildable thing in this whole document.

---

*Nothing here is legal, tax, or financial advice. Confirm §9 with a Nepali chartered accountant, and
confirm every platform policy in §3–§6 against the current published terms before you build on it —
ad-network policies change faster than any document about them stays accurate.*
