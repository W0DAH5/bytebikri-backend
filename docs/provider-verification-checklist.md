# Provider Verification Checklist

**Project:** bytebikri · **Date:** 2026-09-21
**Purpose:** turn every `VERIFY` flag in [`registry/providers.example.json`](./registry/providers.example.json)
into a confirmed value.

**Rule: a provider does not get `"enabled": true` until every box below is checked from a primary source.**
Not a blog. Not a comparison table. The provider's own docs, or their support team's written answer.

---

## Why this matters more for Nepal

A provider can be perfectly integrable and still be **useless to your users**, because the payout rail doesn't
work from Nepal or the threshold is unreachable. Three filters, not one:

> **Can they integrate? × Can a Nepali actually withdraw? × At what threshold?**

Most "best ad networks" lists optimise for the first and ignore the other two. That is exactly the gap this
checklist closes.

---

## The email to send

Send this to each provider's publisher support. Keep it short — you want a written answer, not a brochure.

> **Subject:** Publisher integration + referral programme questions (platform onboarding publishers)
>
> Hello,
>
> I'm building a content platform in Nepal where individual creators each monetise their own space with
> their own account. Before I integrate, I need written answers to the following:
>
> **Integration**
> 1. Can I place your ad tags on pages served from subdomains of my platform domain (e.g.
>    `creator.myplatform.com`) where the content is created by the user, not by me?
> 2. Does each user need their own account and zone/tag ID, or can tags be issued centrally?
> 3. Is there a site-approval step per domain or per subdomain? What are the requirements?
> 4. Do you require an `ads.txt` entry, and what value must it contain?
>
> **Payouts (Nepal — this is the critical section)**
> 5. Which payout methods are available to a publisher with a **Nepali bank account**?
> 6. For each method above, what is the **minimum payout threshold**?
> 7. Is **PayPal** the only option at the low threshold, or is there a non-PayPal route that works from Nepal?
> 8. Do you support **Payoneer** or direct **bank wire** for Nepali publishers, and at what threshold?
> 9. What is the payout schedule and the currency?
>
> **Referral programme**
> 10. Is your publisher referral programme open to platform operators who onboard multiple publishers?
> 11. What is the commission percentage, and what is the **duration** (lifetime, 12 months, other)?
> 12. Can I append a **sub-ID** or tracking parameter so I can attribute referrals per user/space?
> 13. Are there restrictions on how many publishers I may refer, or on platforms referring their own users?
>
> **Compliance**
> 15. Are you a Google-certified CMP partner, or do you require me to supply consent signals?
> 16. Any restrictions on user-generated content, or on content in Nepali?
>
> Thank you — a written reply is appreciated so I can plan integration accurately.

**Send to:** Adsterra · Monetag · PropellerAds · PopCash · BidVertiser · Adcash

---

## Per-provider verification table

Fill this in as answers arrive. **The `duration` and `subid` answers decide whether referral revenue is
modellable at all.**

| Provider | Tags on subdomains? | Site approval? | ads.txt? | Nepal payout method | Threshold | Referral % | Duration | Sub-ID? | CMP ok? |
|---|---|---|---|---|---|---|---|---|---|
| Adsterra | | | | | | 5% * | ⚠️ conflict | | |
| Monetag | | | | | $5 * | 5% | lifetime * | | |
| PropellerAds | | | | | $5 * | 5% | | | |
| PopCash | | | | | $10 * | 10% * | | | |
| BidVertiser | | | | | $10 * | $10 credit * | | | |
| Adcash | | | | | $5 * | none * | — | — | |

`*` = from secondary sources, **not yet confirmed**.

---

## Known conflicts to resolve first

| Provider | Conflict | Impact |
|---|---|---|
| **Adsterra** | Own referral page says 5% with "no limits"; a secondary source says **first 12 months** | Changes referral revenue from perpetual to one-year — a materially different forecast |
| **Adsterra** | Minimum payout reported as **$5 via Paxum** but **$100 via PayPal** | The $5 only counts if Paxum is usable from Nepal |
| **Monetag** | Payout methods include **crypto**; Nepal prohibits crypto transactions | Low threshold may be unreachable without the prohibited rail |
| **General** | PayPal has historically not supported **receiving** funds in Nepal | A $5 threshold is worthless if PayPal is the only low-threshold route |

---

## Internal verification (no provider needed) — do these this week

- [ ] **Open a publisher account with Adsterra and Monetag yourself.** You are a publisher with real content
      (the platform). Observe: signup flow, approval time, tag format, and **which payout methods the
      dashboard actually offers for a Nepal-registered account.** The dashboard is the authoritative answer,
      not the marketing page.
- [ ] **Confirm the referral parameter name empirically** by starting a signup through your own referral link
      and inspecting the URL.
- [ ] **Register interest for AdSense for Platforms.**
      → https://developers.google.com/adsense/platforms/register-interest
- [ ] **Get your root domain AdSense-approved** (required before any subdomain discussion, and required for AFP).
- [ ] **Verify Nepal's National Advertisement Policy (Feb 2026)** against the primary text — specifically
      whether foreign-product sellers must allocate spend to local awareness campaigns. If so, that is
      mandated demand for your Layer 1 inventory.
- [ ] **Confirm eSewa / Khalti / IME Pay bulk-payout or merchant terms** — this determines whether paying 50
      creators a small NPR amount each is practical.
- [ ] **Ask a Nepali chartered accountant** about: VAT registration at Rs 30 lakh service turnover, TDS on
      payments to creators, invoicing for Layer 1 campaigns, and the 5% final-rate treatment on foreign
      income under Rs 40 lakh.

---

## Definition of done for a provider

```
[ ] Integration question answered in writing
[ ] Payout method confirmed usable from a Nepali bank account
[ ] Threshold confirmed for THAT method
[ ] Referral % + duration + sub-ID support confirmed
[ ] CMP / consent requirement understood
[ ] registry entry updated, "VERIFY" strings removed
[ ] "enabled": true
```

Until all seven are true, the provider stays disabled. A disabled provider with honest unknowns is worth more
than an enabled one with invented numbers.

---

*Verifying takes a few hours of emailing. Guessing costs you a provider relationship, a user's unpaid
earnings, or a revenue model built on a number that was never real.*
