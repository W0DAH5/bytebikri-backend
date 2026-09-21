# Ad Adapter Architecture — Pluggable Multi-Provider System

**Project:** bytebikri · **Date:** 2026-09-21 · **Status:** Technical spec
**Companions:** [`monetization-model.md`](./monetization-model.md) · [`entry-phase-ads-playbook.md`](./entry-phase-ads-playbook.md) · [`ad-infrastructure-plan.md`](./ad-infrastructure-plan.md)

---

## 0. Your model, restated so we agree

You are the **landlord and the utility provider**, not an ad agency.

| Who | Owns |
|---|---|
| **bytebikri** | The space, the plumbing, the dashboard, the layout envelope, compliance, moderation |
| **The user** | Their shop. Their choice of ad provider. Their credentials. **Their earnings** |

- The user **selects which ad company to integrate** — not you.
- Your code must be **provider-agnostic** ("volatile") so a new network is a plugin, not a rewrite.
- Users can **place and manage ads in their own space the way an admin would**.
- **Login/onboarding redirections happen inside your app's experience.**
- Because they run ads on their own property, **they get paid** — by that provider, directly.

**This is a good model and a clean frame.** The pluggable architecture you're describing is the right
engineering answer. Section 2 is where I have to correct something I told you earlier, because it directly
determines how big your provider menu can actually be.

---

## 1. The architecture — capability-aware adapters

The naive version is one function `renderAdTag()` with a switch statement. That breaks immediately, because
providers differ structurally, not cosmetically:

- **AdSense** needs a per-slot ID (`data-ad-slot`) *and* a per-account ID (`data-ad-client`)
- **PropellerAds / Adsterra / Monetag** issue per-**zone** JS tags
- **Ezoic** is a per-**site** integration that injects itself and takes over ad placement
- **Affiliate networks** aren't ads at all — they're **link rewrites**
- **Your own direct campaigns** are served by you

So the abstraction must be a **capability-aware adapter**:

```ts
interface AdProvider {
  id: string                        // 'adsense' | 'propeller' | 'amazon_assoc' | 'house'
  name: string
  capabilities: Capabilities
  onboarding: OnboardingSpec
  render(ctx: RenderContext): RenderedSlot
  verify(creds: Credentials): Promise<VerifyResult>
  report?(creds: Credentials, range: DateRange): Promise<RevenueRow[]>
}

interface Capabilities {
  slotModel: 'per_slot' | 'per_zone' | 'per_site_auto' | 'link_rewrite'
  formats: AdFormat[]               // display | native | video | push | in_text
  environments: ('web' | 'amp' | 'mobile')[]
  requiresOwnDomain: boolean        // 🔴 the decisive flag — see §2
  requiresSiteApproval: boolean
  requiresAdsTxt: boolean
  requiresCmp: boolean
  reportingApi: boolean
}
```

**`requiresOwnDomain` is the most important field in this entire document.** It determines whether a provider
can be offered in your user-selects menu at all. Section 2 explains why.

Adding a provider = one file implementing this interface + a registry entry. That's your "volatile" design
done properly — the volatility lives in the adapter layer, while the core (identity, resolution, logging)
stays stable.

---

## 2. ⚠️ Correction: I told you something earlier that was too optimistic

In `entry-phase-ads-playbook.md` §4b I said: *"give each user a subdomain and they add that subdomain to
their own AdSense account."* **That is the commonly repeated internet advice and it is not reliably true.**
Here is what Google actually documents.

### Google requires site-ownership verification

> "To use AdSense, you must have access to the HTML source code of your site. You need to be able to place
> AdSense code between the tags of your pages. **If you sign up with a site you don't own** (e.g.,
> *www.google.com*), **we won't be able to verify that you're the site owner and we won't set up your
> account.**"
> — [Owning the site you want to use to participate in AdSense](https://support.google.com/adsense/answer/91205)

### Approval is domain-level, and subdomains inherit the parent's status

Per Google's own Site Kit issue tracker (June 2024):

> "AdSense no longer requires subdomain sites to be approved individually before ads are served, instead using
> the status of the **parent domain** for each subdomain."

That same issue names *your exact scenario* as a known dead end:

> "Many users will never be able to get their parent domain approved for ads for various reasons
> (restrictions, access and ownership, no possibility to place AdSense code on the parent domain. Examples
> including mysite.instawp.com, mysite.tastewp.com, mysite.wordpress.com.)"
> — [google/site-kit-wp#8935](https://github.com/google/site-kit-wp/issues/8935)

And the practical consequence, stated by a long-time AdSense moderator:

> "Once the domain is approved, **any subdomain can only serve ads as long as it uses the same AdSense
> publisher code**."
> — [WebmasterWorld](https://www.webmasterworld.com/google_adsense/5120321.htm)

### What this means for you

**Put those three together:**

1. A user cannot sign up for AdSense using `alice.bytebikri.com` — they don't own it, and Google verifies ownership.
2. Subdomain approval inherits from the **parent domain**, which **you** must get approved.
3. Once approved, subdomains are generally expected to serve **the same publisher code** — i.e. *yours*.

**So "each user brings their own AdSense ID onto my domain" is NOT a supported self-serve path.** It is
precisely the gap that **AdSense for Platforms (AFP)** was built to fill — Google's docs literally open by
noting that AFP customers have "thousands of child accounts" and that managing this "becomes difficult."

**There is a documented `subdomain=` ads.txt mechanism** for when "the authorized seller or your publisher ID
**are different for the subdomain**" ([Google's ads.txt FAQ](https://support.google.com/adsense/answer/9785052)),
which does contemplate differing IDs. But the surrounding account-approval mechanics are confusing,
inconsistent across sources, and have been tightening since 2023. **Do not build a business on it without
written confirmation from Google.**

**I should have flagged this more strongly the first time. This is the correction.**

---

## 3. So what CAN a user actually plug in?

This is the real answer, and it's more optimistic than §2 makes it sound — the menu is just **different** from
what you'd expect.

| Provider type | Works in your model? | Why |
|---|---|---|
| **Affiliate networks** (Amazon Associates, Daraz Affiliate, local networks, vCommission-type) | ✅ **Yes — perfectly** | An affiliate link is **your own tag pasted anywhere**. No domain ownership, no site approval, no ads.txt, no policy collision. **This is the one category with zero structural blockers** |
| **Low-barrier ad networks** (PropellerAds, Adsterra, Monetag, AdMaven, PopAds) | ✅ **Usually** | Typically issue per-zone tags with low/looser site-verification. Lower quality and RPM, but genuinely self-serve. **Likely your real entry-phase provider set** |
| **Your own direct campaigns** (Revive Adserver) | ✅ **Yes** | You're the network. Full control |
| **Google AdSense** | ❌ **No** (self-serve) | Site-ownership verification + domain-level approval + shared publisher code. Requires **AFP** |
| **Ezoic** | ⚠️ **Not per-user** | Per-site integration (JS/plugin/nameservers) and now requires **MCM review per site**. Not a per-user plug-in |
| **Media.net, Sovrn, Infolytics** | ⚠️ **Likely no** | Site-approval based; same ownership problem in spirit |
| **AdMob** | ❌ **No** | Mobile SDK only, and one AdMob account per app in the Play Store |
| **AdSense for Platforms** | ✅ **Yes — the sanctioned path** | Built exactly for this. Invite-only. See playbook §1 |

### The honest headline

**Your user-selects menu, at entry phase, is: affiliate networks + low-barrier ad networks + your own direct
campaigns.** That's not a failure — it's actually a workable product, and every item on that list is
integrative *today* with no gatekeeping.

And it means the affiliate category deserves to be first-class in your architecture, not an afterthought.
A "provider" that renders a `<a href>` with the user's affiliate tag is trivially per-user, trivially
revocable, and has none of the domain problems. **Design for it as a peer of the display providers.**

### `slotModel: 'link_rewrite'` deserves special treatment

Affiliate isn't a box on the page — it's a transformation of the user's *own content links*. In the adapter:

```
render(ctx) -> for link_rewrite providers, you don't emit a slot;
               you rewrite the user's outbound links at render time,
               injecting their affiliate tag via a redirect or query param.
```

This is a genuinely different render path, which is exactly why the capability model exists.

---

## 4. Onboarding — three mechanisms, and one thing that's impossible

You want "login redirections all in our app." Here's what's actually achievable.

```ts
type OnboardingSpec = {
  mechanism: 'oauth' | 'paste_credentials' | 'signup_redirect'
  fields?: CredentialField[]        // for paste_credentials
  signupUrl?: string                // for signup_redirect
  returnUrlParam?: string
}
```

| Mechanism | Flow | Providers |
|---|---|---|
| **`oauth`** | Redirect out → provider consent → callback to `bytebikri.com/connect/callback` → store token → verify | Google (AdSense Management API) |
| **`paste_credentials`** | In-app form ("paste your publisher ID / zone ID") → validate format → server-side verify → store | PropellerAds, Adsterra, Monetag, affiliates |
| **`signup_redirect`** | Deep-link out with a return URL → user signs up on provider's site → returns → completes via `paste_credentials` | Most networks lacking an API |

**You cannot create accounts for users.** No ad network exposes a publisher-signup API — onboarding is their
KYC (identity, address, tax, phone, site review). What you build is **account linking**, never account
creation. AFP's "Embedded Sign Up" is the sole exception, and it's invite-only.

**And the thing that's impossible: you cannot iframe these flows.** Providers send `X-Frame-Options` /
`frame-ancestors` headers; embedding their signup or login in a frame will be blocked by the browser, and
attempting to circumvent it is a terms violation. So:

> **The redirect genuinely leaves your app for a moment.** You cannot keep it "all in our app" in the literal
> sense. What you *can* do is own everything around it: branded interstitial ("Connecting to PropellerAds…"),
> a controlled return URL, a resumable state machine so the user lands back exactly where they left off, and
> a clear post-connect confirmation. **The only thing that leaves is the consent screen itself.**

That's a genuinely good user experience — just be honest about the one hop you can't eliminate.

### Connection state machine

```
draft ──start──▶ redirecting ──return──▶ verifying ──ok──▶ active
                     │                       │              │
                  abandoned               failed         restricted
                     │                       │              │
                     └────── resumable ◀─────┘           revoked
```

Every state must be recoverable. Abandoned onboarding is your biggest funnel leak — log every transition.

---

## 5. Tenant admin — "users can place ads like an admin"

This is your instinct and it's right, but it needs one governance rule or the platform becomes unusable.

### The rule: **you own WHERE, they own WHAT**

| Platform (you) controls | Tenant (user) controls |
|---|---|
| **Placement slots** — the defined positions on a page | **Which provider** fills a slot |
| **Maximum ad density** — hard caps per page | **Their credentials** for that provider |
| **Layout envelope** — size, responsiveness, no layout shift | **Slot/zone IDs** within the provider |
| **Compliance** — CMP, consent, policy enforcement | **House creative**, if they run direct |
| **Moderation & kill switch** | Their own reporting view |

Without the WHERE constraint you get: three users stacking four 970×250s, layout collapse, an AdSense
density violation, and one domain-wide enforcement action that kills every tenant's ad serving at once.
**You are not being controlling; you are protecting every other tenant.**

### Tenant console, minimum viable

- **Slots list** — one row per platform-defined slot, showing status, provider, and fill
- **Connect provider** — pick from the enabled registry, run the onboarding flow
- **Assign provider → slot** — with capability validation (don't let a `link_rewrite` provider into a display slot)
- **Status & health** — pending / active / restricted / revoked, with the reason
- **Reporting** — whatever the provider exposes (see §6), clearly labelled
- **Kill switch** — their own, to disable ads on their space instantly

---

## 6. Reporting — be honest about the ceiling

You want a unified earnings view. Here's the truth per mechanism:

| Case | What you can show |
|---|---|
| Provider has an API + user did `oauth` | **Real revenue**, unified in your dashboard ✅ |
| Provider has an API but no OAuth (paste-only) | Only if their API supports server-side keys — rare |
| No API | **Impressions *you* served** and traffic stats. **Not money** ❌ |
| Affiliate | Clicks you can count; **conversions/earnings live in the merchant's dashboard** ❌ |

**Design principle: never imply a number you can't substantiate.** Label every figure as either
*"reported by the provider"* or *"estimated from impressions you served"* or *"see your provider dashboard."*
A dashboard that quietly invents revenue numbers is the fastest way to lose every creator on the platform the
first time a payout doesn't match.

---

## 7. Data model

```
providers                    registry, seeded from code (not user-editable)
  id, name, slot_model, formats[], requires_own_domain, reporting_api, enabled

provider_credentials_spec    per-provider field definitions for paste_credentials

spaces                       the tenant's "shop" — subdomain/slug, owner_id, policy_status
  id, owner_id, subdomain, theme, policy_status, ads_enabled

ad_connections               user × provider × credentials × status
  id, space_id, provider_id, credentials_encrypted, status, verified_at,
  last_error, revenue_share_override

placement_slots              PLATFORM-DEFINED positions (WHERE)
  id, key, description, formats_allowed[], max_per_page, size_constraints

slot_assignments             which connection fills which slot (WHAT)
  id, slot_id, space_id, connection_id, provider_slot_ref, weight, active

impressions                  append-only serving log
  id, space_id, slot_id, connection_id, provider_id, served_at, geo,
  viewable, fill_status

provider_revenue             pulled via APIs where available
  connection_id, period, revenue, currency, source ('api' | 'estimated'), fetched_at
```

**Security note:** `credentials_encrypted` is not decoration. These are users' ad-account identifiers. Encrypt
at rest, never log them, never expose them to any other tenant, and make revocation instant and complete.

---

## 8. Build order

| Step | Deliverable | Why first |
|---|---|---|
| 1 | **Adapter interface + registry + `Capabilities`** | Everything else depends on this shape |
| 2 | **`spaces` + `placement_slots` + `slot_assignments`** | The WHERE/WHAT governance model |
| 3 | **`paste_credentials` onboarding + verification** | Unblocks the largest realistic provider set immediately |
| 4 | **`house` adapter** — your own fallback/default | Every slot needs a defined behavior when empty. Ship this first, actually |
| 5 | **`affiliate` adapter with link rewrite** | The one provider category with zero blockers |
| 6 | **Kill switch + policy state machine** | Before any third party sees a real page |
| 7 | **CMP + consent + ads.txt generation** | Legal and functional prerequisite |
| 8 | **`oauth` flow + AdSense adapter** | Enables the reporting API and single-provider users |
| 9 | **Low-barrier network adapters** (one at a time) | Each is ~a file, if the interface is right |
| 10 | **Reporting ingest where APIs exist** | Last, because it's the least blocking |

**Build steps 4 and 5 before 8 and 9.** House ads and affiliate both work today with no gatekeeping, and
they prove the interface is right before you're debugging Google's OAuth.

---

## 9. What this means for your strategy

1. **Your architecture is correct.** Capability-aware adapters, tenant-scoped identity, platform-owned slots,
   in-app onboarding orchestration. Build exactly that.

2. **Your provider menu is smaller than you think, and that's fine.** Affiliate + low-barrier networks +
   your own direct campaigns is a real product on day one — no gatekeeping, nothing to wait for.

3. **AFP is the unlock for the mainstream providers.** Until then, AdSense/Ezoic/Media.net aren't available
   as per-user plugins. Register interest now (playbook §1); the sales cycle is long and nothing else changes.

4. **Consider the Public Suffix List seriously.** Google's own AFP docs recommend it, and community reports
   say it's the mechanism that lets subdomains be treated as independent sites for ads.txt purposes. It's how
   site builders solve this. **But it changes browser behaviour for your whole domain** (cookie and
   same-origin scope), and Google explicitly warns to "investigate the full impact." Research it properly
   before committing — it's a architectural decision, not a config toggle.

5. **Keep `bytebikri direct` as an adapter, not the core.** In Nepal specifically, a local advertiser will
   outbid any global network for Nepali traffic (see `ad-infrastructure-plan.md` §2). But it should appear in
   the user's provider menu as one option among several — which is exactly your model, and it means you never
   have to force anyone into it.

---

*Platform policy quotes are from Google's published documentation and issue tracker as of 2026-09-21. Ad
network terms change; re-verify §2–§3 before building provider adapters. Not legal advice.*
