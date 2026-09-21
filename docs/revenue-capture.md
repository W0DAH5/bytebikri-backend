# Capturing Revenue Without Touching the Ad Money

**Project:** bytebikri · **Date:** 2026-09-21 · **Status:** Practical playbook
**Companions:** the four docs indexed in [`README.md`](./README.md)

**Question:** *The network pays the user directly and I can't intercept it. How do I still get my cut?*

---

## 0. First, the hard boundary

**You cannot intercept a payment a network makes to someone else.** There is no API, no intermediary, no
technical seam. Any attempt breaks into one of these, and every one is a terms violation that gets accounts
terminated:

- Asking users for their ad-account **password** so you can "manage" or receive their payments
- Putting **your** ad code on their content and passing a share back to them
- Proxying, iframing, or otherwise interposing yourself in the provider's payment path
- Using a foreign entity / VPS / VPN to defeat a provider's country restrictions

That last one is worth naming, because you *will* find it in forums — the standard Reddit answer to "Stripe
in Nepal" is literally "use a VPS and Windows RDP." It works until it doesn't, and when it doesn't you lose
the account **and** any accrued balance. Not a workaround; a time bomb.

**So the question isn't "how do I intercept it." It's "how do I get paid without being the middleman."**
That has five working answers.

---

## 1. ⭐ Workaround A — Make the network pay *you* (referral programs)

This is the direct answer to your question and it **exists today, works globally, and requires no contracts.**

Ad networks pay a commission on the earnings of publishers you refer. You bring the publisher; the network
pays you a percentage of what they earn, **directly to your own account.**

| Network | Referral commission | Terms |
|---|---|---|
| **Adsterra** | **5%** of referred publisher revenue | "5% of each referred Publisher revenue with no limits" — [source](https://adsterra.com/referral-program/) |
| **Monetag** (PropellerAds) | **5%** of referred publisher monthly earnings | Explicitly **lifetime** commission — [source](https://propellerads.com/blog/pub-earn-easily-with-propellerads-referral-program) |
| **PopCash** | **10%** | Noted in network comparisons |
| **BidVertiser** | $10 credit per referred publisher earning $10 | Scales up from there |

**Why this is the right answer:**

| Property | Result |
|---|---|
| Money movement | **None** — the network pays you |
| User's earnings | **Untouched — they keep 100%** |
| Collection risk | **Zero** |
| KYC on your users | **None** |
| Contract negotiation | **None** |
| Legality | It's the network's own advertised programme |

**And here's the elegant part: your architecture already supports it.** The `signup_redirect` onboarding
mechanism from `ad-adapter-architecture.md` §4 takes a `signupUrl`. **That URL carries your referral ID.**
Onboarding and monetisation become the same code path:

```
user picks provider  →  signup_redirect with YOUR referral param
                     →  user signs up, earns, gets paid directly
                     →  network pays you 5% monthly, forever
```

**Honest limitations:** 5–10% is modest, and it is the network's *marketing budget*, not a cut of the user's
money — so it's additive, not a real rev share. Sources also differ on duration (some say lifetime, one says
12 months), so confirm per provider. But it costs you nothing and scales with user success.

---

## 2. ⭐ Workaround B — The inventory split (a cut paid in space, not cash)

**You control the slots. That is your leverage, and you never need to touch money to use it.**

Give each tenant a slot allocation, and keep some for yourself:

```
Tenant space gets 4 ad slots:
  ├─ Slot 1  → tenant's provider, tenant keeps 100%
  ├─ Slot 2  → tenant's provider, tenant keeps 100%
  ├─ Slot 3  → tenant's provider, tenant keeps 100%
  └─ Slot 4  → PLATFORM slot — your ad code, your revenue
```

This is a **25% cut captured entirely in inventory.** No payments, no invoicing, no money movement, no
compliance surface. And it's exactly what YouTube does to creators, so it's a model users already understand.

**Framing matters more than the mechanics here.** Do not call it a cut. Call it:

> *"Your shop is free. The platform keeps one placement per page as rent."*

That's the landlord model you described from the start — and it's clean, because you're not taxing their
earnings, you're using your own property.

**Mitigations that make it fair:**
- Cap it: **one platform slot per page**, never more
- Never take the best position — leave slot 1 to the tenant
- Let Pro users **buy out** the platform slot (turns it into a subscription — effectively option C)

---

## 3. ⭐ Workaround C — Charge for the *space*, not the ads

The cleanest mental model: **you're a landlord, not a tax collector.**

| Free tier | Paid tier |
|---|---|
| Space + baseline slots | Premium placements (above-the-fold, sticky) |
| Platform slot on every page | **No platform ads at all** |
| Standard analytics | Real earnings dashboard, exports |
| Standard subdomain | Custom domain |
| — | Higher limits, more slots |

**Why this beats a rev-share on ads:** a percentage of money you cannot see, cannot verify, and cannot
collect is **unenforceable anyway**. A subscription is enforceable, predictable, and legally trivial — it's
just SaaS. And it doesn't depend on the user's ad earnings at all, which matters enormously in a market where
those earnings are ~$0.03 CPC.

---

## 4. ⭐ Workaround D — Capture it downstream

Their ad money lands in their own bank account or wallet. Then what do they do with it?

**They spend it in your marketplace** — buying assets, boosting listings, paying for Pro.

You take your cut as **ordinary commerce**, not as an ad tax:

```
Ad network → user's bank account
                    │
                    ▼
            user spends in bytebikri
                    │
                    ▼
        your merchant-of-record → your cut
```

**No money movement for you. No ad-revenue relationship. No compliance surface.** And it increases marketplace
liquidity, which is your actual product.

**This is the strongest framing available to you:**

> *"We don't take a cut of your ad earnings. We take a cut when you sell something here."*

A sentence that is both true and impossible for a competitor to copy without rebuilding.

---

## 5. Workaround E — Be the network (Layer 1 direct campaigns)

Covered in `ad-infrastructure-plan.md` §3, and it's the highest-value option in Nepal.

You sell ad space to Nepali advertisers, collect **NPR**, and pay creators from that. You're a domestic
media seller, not an intermediary for foreign ad money. The cut is explicit, contractual, and enforceable —
because **you're the one holding the money**, legitimately, as a normal Nepali business.

**This is the only option where you actually control the money — and the only one where taking a cut is
straightforward rather than clever.**

---

## 6. The Nepal payout filter — and the other meaning of "cutoff"

If by *cutoff* you meant the **payout threshold**, that's a separate and equally serious problem. It is also
where most "just use AdSense" advice falls apart for Nepal.

**AdSense pays at $100 minimum via wire transfer.** A Nepali creator earning $4/month waits **two years** to
see a rupee. That kills retention before it starts.

**Low-threshold networks — and this is a real argument for making them your defaults:**

| Network | Min payout | Notes |
|---|---|---|
| **PropellerAds** | **$5** | No traffic minimum; Payoneer, Skrill, wire |
| **Monetag** | **$5** | Payoneer, PayPal, WebMoney, Capitalist, crypto |
| **Adcash** | **$5** | PayPal, Skrill, Revolut, crypto; $100 for wire |
| **PopAds** | **$5** | Daily payouts; PayPal, wire, Payoneer, WebMoney |
| **HilltopAds** | **$10** | Weekly payouts |
| **PopCash** | **$10** | 80% revenue share; 10% referral program |
| **BidVertiser** | **$10** | Plus the referral credit |
| **Ezoic** | **$20** | Payoneer, PayPal, cheque |
| **Sovrn** | **$25** ($50 wire) | |
| **Google AdSense** | **$100** | 🇳🇵 **Wire only** (no EFT, no Hyperwallet) |

**Two Nepal-specific warnings that matter more than the thresholds:**

1. **PayPal has historically not supported receiving funds in Nepal.** Several of these networks route their
   low-threshold payouts *only* through PayPal — which means the $5 threshold is worthless if PayPal is the
   only option. **Verify the payout method, not just the number.**
2. **Crypto payouts are everywhere in this segment, and Nepal prohibits cryptocurrency transactions.** Do
   not recommend a provider whose low-threshold route is USDT/BTC to Nepali users. Verify current NRB
   position before listing any crypto rail.

**So your provider menu should be filtered on three axes, not one:** *can they integrate* (adapter
capability) × *can a Nepali actually withdraw* (method) × *at what threshold*.

**Build this as a first-class feature:** a "Will I actually get paid?" indicator in the provider picker.
Nobody else does this for Nepal, and it's the single most useful thing you can tell a first-time creator.

---

## 7. What NOT to do

| Don't | Why |
|---|---|
| Ask for ad-account **passwords** | Terms violation; you become liable for their traffic. Instant ban risk for both parties |
| Run **your** ad code on their content and pay them a share | Makes the ads legally yours, not theirs; drags you into payment processing, KYC, and withholding. This is Model A, priced in |
| Use a **foreign entity / VPS / VPN** to defeat country restrictions | Standard forum advice, standard account termination, and you forfeit accrued balances |
| Promise a cut you can't collect | If you can't see their revenue and can't force payment, you've invented a receivable you'll never collect and a promise you'll have to break |
| Build a dashboard that **estimates** earnings and presents them as real | First payout mismatch loses the creator permanently |

**On the last one:** AdSense *does* support multiple users on one account with two access levels, so a user
could legitimately grant you **reporting access**. That solves *verification* — letting you see genuine
earnings — but it does **not** give you access to the money. Useful, but don't confuse the two.

---

## 8. The recommended stack

Implement A, B, D now. Add E when you have an advertiser. Add AFP later.

| # | Mechanism | Effort | Money movement | When |
|---|---|---|---|---|
| **A** | **Referral IDs in every `signup_redirect`** | ~1 day | None | **Now** |
| **B** | **One platform slot per page** | ~2 days | None | **Now** |
| **D** | **Downstream capture via asset sales** | Core product | None | **Now** |
| **C** | **Pro subscription, buys out the platform slot** | Weeks | None | Once users exist |
| **E** | **Direct Nepali campaigns** | Months | You hold NPR | Once you can sell |
| **AFP** | Proper network-level rev share | Gated | None | When invited |

**Total effort for A + B: about three days.** Those two alone mean you're earning from ad money by launch
without touching a single rupee of anyone else's.

---

## 9. The thing to internalise

**The cut you can't take is worth less than the cut you can.**

Run the numbers. A Nepali creator earning $4/month from ads means your theoretical 20% is **80 cents**. For
80 cents you'd need a payment relationship, a reporting integration, a support burden, and an unenforceable
promise.

Meanwhile that same creator's **first asset sale** is worth more than a year of that cut — and it goes
through a merchant-of-record, is trivially enforceable, and requires no cleverness at all.

**So the workaround isn't a hack around the constraint. It's putting your monetisation where the money
actually is:**

- **A** — the network pays you for bringing the publisher *(free money, do it today)*
- **B** — one platform slot per page *(rent, not tax)*
- **D** — they spend their earnings in your marketplace *(commerce)*
- **E** — you sell Nepali inventory yourself *(you hold the money, legitimately)*

None of these require intercepting anything. All four are more valuable than 20% of $4.

---

*Referral percentages, payout thresholds, and payout methods were gathered from the cited sources on
2026-09-21 and change frequently — verify against each provider's current published terms before featuring
them in your provider menu. The Nepal-specific payout-method and cryptocurrency notes are flags to verify,
not legal advice; confirm with the provider and a Nepali chartered accountant.*
