# Assets, placements, and attention: the framework

The brief this answers, in the order it was asked:

1. Customers buy a premium **from bytebikri** (cosmetics, extras, Nitro-shaped) — not from a store.
   Stores buy a premium **from bytebikri** (customisation, membership tools, and more).
2. A store's relationship with its own members is theirs, not ours. **Money movement inside the app
   is a later feature** — so how does a membership exist today?
3. One ad is not the right price for every asset. A video can take an ad **in the middle** (YouTube's
   shape). Stores should eventually get **placement and timing options** per asset type.
4. Digital assets are not one thing — a game build, a zip, a 12-chapter manhwa, a livestream, a video
   playlist. They should be **sectioned and presented differently without making navigation harder**.
5. Research first, then a framework, then implementation, then tests. **This file is the framework.**
   No behaviour has changed yet; Slice 1 starts only when §8 is answered.

Read with `AD_ECONOMY.md` (the ask ladder and the blocker ladder, already built), `REVENUE_ARCHITECTURE.md`
(the five legs) and `FEATURE_AUDIT.md` (what is actually in the code).

---

## 1. Research: what a digital asset actually is

The market does not sort digital goods by file extension. It sorts them by **how the buyer consumes
them**, and the file types follow from that. What the platforms that host this content support:

| Shape | What it is | Evidence |
|---|---|---|
| **Download** | Any file, handed over: builds, ROMs, zips, fonts, psd, source, `.gbs` | itch.io is zip-first: HTML5 games ship as a zip with an `index.html` (≤1,000 files, ≤500 MB extracted, ≤200 MB single file, zip only — no `.rar`, `.7z`); up to **10 files per page**. Gumroad accepts "effectively anything — PDF, ZIP, HTML, video, audio", with multiple versions per product |
| **Read** | A stack of pages: images, CBZ, PDF, EPUB, novel | WEBTOON Canvas specs are **800 px wide, up to 1,280 px tall, ~100 images per episode** — an episode *is* an ordered image set. Readers exist as libraries: foliate-js handles **EPUB, MOBI/KF8, FB2, CBZ, PDF**, and uses `zip.js` for **random access over HTTP range requests**, which is what makes a CBZ readable without downloading it first; PDF.js is Apache-2.0 and already the browser's own |
| **Watch** | Video, one file or a playlist | Nothing to invent — an HTML5 `<video>` with a playhead, which is exactly what the IMA SDK needs for mid-rolls (`getCuePoints`, ad rules, VMAP) |
| **Listen** | Audio, album, podcast, playlist | Same player, different conventions: podcast mid-rolls are **almost universally non-skippable because there is no skip mechanism in audio** |
| **Play** | HTML5/iframe game, emulator, interactive | itch.io embeds an uploaded zip in an iframe; that surface is where **rewarded** ads belong (continue, lives, hint) |
| **Stream** | Live: gaming, watch-party, radio | The only shape where the ad is a *live* interruption, and the one with the worst precedent (§2.3) |

Two consequences for this repository, both good news:

- The schema already has the hooks: `assets.kind`, `assets.format`, `asset_files.sort_order`,
  `asset_files.mime_type`, and a **range-capable stream route** (`/api/content/:assetId/file/:fileId/stream`
  → `sendRanged`). An image-set asset is `N` files with `sort_order`; a zip reader is the range route.
- `app/src/media.js` already classifies by MIME-with-extension-fallback into `video | audio | image | file`.
  The framework's shapes are an **extension of that function**, not a new system.

## 2. Research: where an ad may sit, and what each placement earns

### 2.1 Placement types, and the honest price of each

| Placement | Interrupts? | Completion / CTR | eCPM (2026, tier-1) | Emerging-market note |
|---|---|---|---|---|
| **Rewarded** (opt-in, the buyer chose it) | No — it *is* the door | **93.8–95 %+** completion; opt-in ~97 % | **$12–35** ($16.49 Android / $19.63 iOS US) | ~**$2** in LatAm/SEA-class markets |
| **Interstitial** (forced, between things) | At a transition | 75.8 % avg completion (Adjust); skip 22–35 % | $6–14 (mobile ~$10) | ~$10 reported for Android US; much lower elsewhere |
| **In-stream pre-roll** (before content) | Once, at the start | 60–70 % completion | Bundled into video CPM ($10–25) | — |
| **Mid-roll** (inside content) | Yes, mid-content | 80–90 %+ completion — but see §2.2 | Same CPM as pre-roll; the *placement* changes retention, not price | — |
| **Banner / sticky** (the page boxes) | Never | CTR 0.10–0.30 %; 67 % of users are banner-blind | **$0.20–1.50** | ~$0.15 |
| **Native / in-feed** | Never | CTR 1.16 %, +12 % scroll depth | ~$3.00–5.40 | — |

Three numbers decide the architecture here:

- **Rewarded is worth 5–20× a banner** and is the only format that *adds* retention (D1 +8–40 %,
  Tapjoy's 500 M-user analysis, 2026). Banners are the floor, and the page boxes are banners.
- **Interstitials to new users cost D1 retention ~15 %** (Adexium, 127 apps, 2026) — the same study
  says show them only to returning users. A first-time visitor must never meet a forced full-screen.
- **Hybrid works, but only with balancing**: rewarded + interstitial together returned **+55–85 %**
  over either alone across 47 projects — the constraint being the frequency caps, not the formats.

### 2.2 The YouTube model, exactly

| Rule | Figure | Source |
|---|---|---|
| Mid-rolls unlock at | **8 minutes** of runtime (was 10) | YouTube policy, unchanged 2026 |
| Under 8 minutes | pre-roll, post-roll and overlay only — no mid-roll | same |
| Density that holds retention | 1 per **8–10 minutes**; 1–2 for 8–15 min; 2–3 for 15–20; 3–5 for 20–30 | practitioner consensus, 2026 |
| Never | a break in the **last 90 seconds**; nothing in the first 2 minutes; not within 3–4 minutes of the previous break | ytkits / tubemilestone, 2026 |
| Non-skippable length | 12–30 s (skippable up to 3 min) | AppsFlyer |
| The thing creators get wrong | markers are **ad opportunities, not guaranteed impressions** — YouTube's engine skips breaks rather than serving five in eight minutes | ytkits, 2026 |
| Ad density is not linear | 2–3 auto breaks vs 4–5 manual breaks on an 8-minute video produced **virtually identical revenue** — fatigue capping eats the extra | ytkits, 2026 |
| The best mid-roll placement | a *natural* break — chapter boundary, scene change, topic transition | YouTube Creator Resources |

That last row is the whole implementation: **a mid-roll needs a cue point that means something in the
content**, not a random percentage. For a video, the store marks chapters. For a chaptered asset
(manhwa, serial novel), the boundary already exists by construction.

### 2.3 The live lesson: control, or do not do it

Twitch's automated mid-stream ads remain the industry's clearest negative result: forced breaks the
streamer could not control produced near-universal backlash (the top user request was literally
"Remove mid-roll ads", 5,089 votes), streamers reported losing up to **a third of viewers** per break,
and "creators want control" became the enduring summary. The mechanic that survived instead is the one
Twitch still explains in 2026: **scheduled breaks the streamer chooses, which then reduce or eliminate
the pre-roll a new viewer would otherwise get.**

So for the live shape the rule is inverted from the video shape: **the store schedules breaks; the
platform never inserts one.** A scheduled break buys every new arrival a clean entry — that is the
trade to state in the UI.

### 2.4 The read lesson: an option is fine, the only door is not

WEBTOON's 2026 move from Daily Pass to **Ad Pass** ("watch ads or use Coins to unlock") was received as
a *removal* — readers who had a free path resented the door that replaced it, while the same "watch an
ad for a free episode" mechanic had been tolerated for years as **one of two ways in**. The sentiment
line is not "ads bad". It is **"an option is fine; the only door is not"**, which is also what the
opt-in rewarded numbers (§2.1) say.

## 3. Research: memberships and creator money when you cannot move money

### 3.1 What the platforms that pay creators actually do

| Platform | Ad share to creator | Gate | Payout floor | Reality |
|---|---|---|---|---|
| WEBTOON Canvas | **50 % of net ad revenue** | 1,000 subs + 40,000 monthly page views | $25 | Creator-reported **$0.28–0.50 per 1,000 views** |
| Tapas | **~70 % of ad revenue** | ~100 subscribers | $25 | Forum-reported earnings under $5/month, commonly |
| Market mix (webtoon, 2025) | Ads **21.6 %** | — | — | Subscriptions 38.2 %, pay-per-episode 31.4 %, other (merch/IP/tips) 8.8 %; freemium→paid conversion 3.5–8.2 % |

Two lessons:

- Ads are the **free-tier** engine, explicitly "essential in price-sensitive emerging markets where
  subscription conversion remains challenging" — which is Nepal's row. Revenue per view is small;
  reach is what ads are for.
- **50–70 % to the creator is the norm**, and creators complain about the *transparency* of the split
  before they complain about the percentage. Any share-back we build must be legible: a number, a
  period, and a statement of what it is not.

### 3.2 Attention as a currency that is not money

Twitch Channel Points are the working precedent for the constraint in the brief: viewers earn them
**free, by watching**, they carry **no monetary value**, they **cannot be sold or cashed out** (Twitch's
Acceptable Use Policy is explicit), and they exist to make a lurker a participant. The engineering is
trivial; the point is the framing — *time in, standing out*, with no rupee sign anywhere.

This is the answer to "how do memberships exist before money movement": **a tier can have two doors,
and only one of them is money.**

### 3.3 What already exists in this repository

Memberships shipped in `0031`: **two tiers**, dues set by the creator, periods of 1/3/12 months,
**five claim methods**, and a seller queue a human clears against their own statement. ByteBikri is not
a party to the dues at all (`toCreatorFromMembers`: "0 % to bytebikri … an absence of a path"), and a
file set to a tier opens **with no ad at all** (`AD_ECONOMY.md` §5). So the relationship already works
today — with two standstills: the seller clears claims by hand, and a customer who cannot pay has no
way in.

## 4. Research: a bigger object model without a harder UI

| Finding | Source | What it decides |
|---|---|---|
| Show a few; reveal the rest on request. Improves learnability, efficiency and error rate | NN/g, progressive disclosure | Sections appear **only when non-empty**; the shape chips row appears only when a store has ≥2 shapes |
| **More than two disclosure levels causes navigation confusion** | NN/g | Store → section → asset is the ceiling. No tab bar over a tab bar |
| The failure mode is **hiding a frequently used feature** | NN/g / VERSIONS | The four most-used things (unlock, download, members, the store's own page) stay on the surface |
| People discriminate ~**3** items at a glance (3, then 3+1) | Ding et al., AHFE 2020 | At most 3–4 shape chips in the first row, ordered by how much the store actually has |
| Linear, front-loaded tours convert at **53 %**; contextual, behaviour-triggered disclosure at **75 %** (+30 % paid conversions) | Chameleon, 15 M interactions, 2026 | No onboarding tour for shapes. A one-line hint the first time a reader/player surface opens |
| Two-level chunking beats one long list | NN/g | "Read" is one section with chapters inside it, not twelve episodes flattened into the file list |

---

## 5. The framework

### 5.1 Six shapes, derived — never typed by the seller

`media.js` grows from `video | audio | image | file` to the shapes below. **The seller uploads files;
the platform decides the shape from MIME + extension + how the files sit together.** A seller cannot
mark a zip as a video to dodge an ask.

| Shape | Detected from | Buyer's surface | Default placement |
|---|---|---|---|
| **download** | any non-media file; archives (`zip`, `rar`, `7z`), ROM/`.gbs`, fonts, psd, source | file card → download | none inside; the page carries the boxes |
| **read** | ordered image set (≥2 images), `cbz`, `pdf`, `epub` | reader (pages, chapters) | **between** chapters — never mid-page, never mid-panel |
| **watch** | `mp4`, `webm`, `mkv`, `mov`, HLS link | player with a playhead | **pre** + **mid** at chapter cues (≤ plan ceiling) |
| **listen** | `mp3`, `m4a`, `flac`, `wav`, `opus`, folder as album/playlist | player/queue | **pre** + **mid** at track/chapter marks |
| **play** | zip containing `index.html`; HTML5/iframe build | sandboxed iframe | **rewarded** at failure states (continue, lives, hint) |
| **stream** | live URL (HLS/RTMP-relay) | live player | **store-scheduled breaks only**; no automation, ever |

Unknown media (an extension we do not recognise) is `download` — the honest default. There is no box
anywhere for a seller to type a shape, and there will not be one: the "publish this as a plain
download instead" control (an override *down*, never up) arrives with slice 6, when there is a reader
surface to override away from. Until there is somewhere to play or read a file, a chooser would be a
choice about nothing.

### 5.2 The placement catalogue and the nine rules

Every ad in the product is one of: `pre`, `mid`, `between`, `post`, `aside`, `rewarded`.

`aside` is what exists today (the page boxes: ≤2 store + 1 platform, `slots.js` POLICY). The new
vocabulary is the other five, and they are **only ever available per shape** — a manhwa has no
`mid`; a video has no `between` (its `pre` and `mid` cover it); `post` is nearly worthless
(post-roll completes at 25–40 %) and exists only as a "one more like this" after the content, never
as a toll.

**Platform-wide rules, on every plan, not negotiable by value or price:**

1. One blocking door before content (the ask), ≤3 ads and ≤180 s total per unlock — unchanged.
2. **Never inside a member's file.** (AD_ECONOMY §5 stands.)
3. Never in the **last 90 seconds** of a video; never in the first 2 minutes.
4. Never two breaks within **4 minutes** of each other.
5. `between` only in `read`/`listen`; **never mid-page or mid-track**.
6. `stream`: **store-scheduled breaks only** — the platform never inserts one.
7. A first-time visitor meets **rewarded or nothing**; forced full-screen is for returning viewers.
8. `rewarded` may be generous (it is opt-in); forced placements carry every cap.
9. **Creator control is the default**: every placement a shape allows is a checkbox the seller can
   turn off. The platform supplies a default plan; the seller owns it.

### 5.3 How the ask gets decided now

Today: `declared_value_npr` → band → `ads × seconds`, capped by plan (`adscale.js`). That remains the
**entry ask** — the price of the door. Two additions:

- **Runtime decides placement, not volume.** A 3-minute clip gets one pre-roll. A 40-minute lecture
  gets a pre-roll and a mid-roll at the store's cue. A 12-chapter read gets the door plus a
  between-chapter gate from chapter 3 onward. The **total interruption budget (180 s) does not move**;
  where it lands does.
- **Duration is measured, not declared** for the player shapes: the player reports `durationSec` when
  metadata loads, the server computes the cue list and signs it, and the plan falls back to a single
  pre-roll if the report never arrives. No `ffprobe` dependency, no seller typing "45 minutes".

### 5.4 Membership: two doors into one tier

| | **Dues door** (exists) | **Attention door** (new) |
|---|---|---|
| What the customer gives | money, direct to the creator, outside the app | time: watch the store's asks on its pages |
| Who receives | the creator, 0 % to bytebikri | nobody — no money exists in this door |
| How it is confirmed | the seller clears the queue (5 claim methods) | the platform counts verified views / watch time |
| What it buys | the tier's perks: member files, roster plate, member room | the same perks |
| Why it fits the constraint | no money movement in-app already | **no money at all** |

This is the creative answer to the brief's own question. The membership the user wants — a real
relationship between a store and its people, not a platform subscription — becomes **reachable without
paying**, and every attention-door join is an ad impression on the store's own page, which is revenue
(leg 1, network→store) that the store can already receive today.

Perks that cost nothing and need no rails (the "internal channel", kept to a page, not a feed):

- the **member room** — one page listing member-only files, the roster, and the store's own note;
  it carries the ordinary slot policy and no extra box,
- early access — a member sees a file N days before everyone,
- the roster plate (exists),
- member-only files (exists).

**Ad-free stays the default** for a member file (shipped decision, §5 of AD_ECONOMY). A store may
opt into **`supporter`** mode for a tier, which is the opposite trade: members keep the ordinary asks
and gain the belonging. It is opt-in, labelled on the join panel *before* anyone joins, and it never
changes what an already-joined member was promised.

### 5.5 The money, with the new pieces named

Legs 1–5 (`REVENUE_ARCHITECTURE.md`) are unchanged: network→store ads, dues, store plans, rent, Plus.

- **Leg 6 — our own inventory.** The platform's one slot per page plus house surfaces, sold to a
  network or a direct advertiser. The seam exists (`data-serving`, `data-adapter`); today it renders
  house copy and earns nothing. **This is the only leg where a third party pays bytebikri for
  attention, and it is the leg the membership channel feeds.**
- **Leg 7 — removed by decision.** There is no share-back. A store's ad spaces are the store's — a
  network pays them directly and bytebikri is not a party to it, exactly as bytebikri is not a party
  to dues. Our spaces are ours, wherever they sit in the app. No cross-subsidy, no revenue share, no
  credit against a bill: two clean money paths instead of one shared one.

**How our own inventory earns (the method this needs).** The slot is one box on every store page —
banner-class inventory, which the research prices at **$0.15–1.50 CPM** against native's $3.00–5.40
and rewarded's $12–35. At Nepal-class rates one slot-earns roughly **NPR 20 per 1,000 views**, so the
method cannot be "sell more impressions". In the order that actually matters:

1. **House-first, and the house has the best numbers.** The default creative sells bytebikri's own
   paid products (Plus at NPR 149/month, store plans). One Plus signup is worth about **7,500 banner
   impressions**; one plan upgrade is worth more than a year of them. The platform is its own
   highest-paying advertiser until traffic is large, which is why the slot renders house copy rather
   than nothing.
2. **Native, never a flashing banner.** The slot renders a headline, a body and a link
   (`creatives.js`), and sits in-content or sticky — the native shape, which is 3–10× a display unit
   on the same page.
3. **Sell the place, not the impression** — direct local deals (an ISP, a phone shop, a college) at a
   flat monthly rate, priced by *surface* (every store page, or one category of store) rather than
   per view. At these CPMs a direct deal beats programmatic by an order of magnitude.
4. **Rotation, not another box.** Two advertisers share one position by share-of-voice. The density
   cap is not a limit to sell around; it is the reason the position is worth selling.
5. **Prove it before invoicing it.** Impressions per surface and per placement are counted in slice 5 —
   the ledger is what makes a flat rate defensible, and it is also how we would know which house
   message converts.
6. **Never mix the two inventories.** A store's space is theirs to fill or sell; ours is ours. Nothing
   in the code should ever need a rule about which is which.
- **Plus is untouched.** Cosmetics, paid to bytebikri, no file opened, no ad removed. A store premium
  and a customer premium stay different products, as the brief restated.

### 5.6 Sections, and why the UI does not get harder

- A store page renders **sections in the order the store actually has content**: the shape with the
  most files first, then by count. **Empty sections do not render** (§4).
- A **chip row** appears only when a store has two or more shapes, and it lists every shape it has,
  ordered by how much of each. It filters the same one list — it is not a tab bar, and it does not
  exist on a single-shape store. The chips are anchors first, so the page works without JavaScript.
- Every card carries a **shape chip and the ask** ("1 ad · 15 s", "2 ads · 30 s", "members") — the
  price is visible before the click, which is the rule the unlock already follows.
- **One door per asset**: the ask is stated on the file page. A mid-roll or a between-chapter gate
  never introduces a *new* number the buyer has not seen.
- Search and discover stay **one list with the same chips**, not six feeds.

### 5.7 What is refused, and stays refused

No automated ads on live. No ad inside a paid-for file. No mid-page ad in a reader. No fourth box. No
forced full-screen for a first-time visitor. No "premium removes ads". No browser or blocker
targeting. No payout promise — credit only, and only when there is revenue to share. No per-user
global ad cap that silently caps a creator's earnings (`AD_ECONOMY.md` §6).

---

## 6. The honest math (Nepal first)

Emerging-market rates, not US ones — the difference is 5–10×:

| Placement | Emerging-market eCPM | One impression | NPR (×133) |
|---|---|---|---|
| Rewarded | ~$2 | $0.002 | ~NPR 0.27 |
| Banner (the boxes) | ~$0.15 | $0.00015 | ~NPR 0.02 |

So: a file that asks **one 15 s ad** pays its creator roughly **a quarter of a rupee** per unlock; a
store with 10,000 monthly unlocks and the ceiling ask (3 ads) sees on the order of **NPR 8,000**.
Small, but real, and it is why three things in this framework matter more than any placement trick:

1. **Asks stay short.** The research is unanimous that completion, and therefore payment, collapses
   after 30 s; an unpaid 60 s ad is worse for the creator than a paid 15 s one.
2. **The platform's revenue stays plans + rent + Plus.** At these CPMs the ad side cannot carry the
   platform; it carries the *creators*, which is what leg 1 is for.
3. **Placement flexibility is worth more than volume.** Moving a break from a post-roll (25–40 %
   completion) to a rewarded door (93 %+) is a 3× on the same impression — that, not a fourth box, is
   the efficiency the brief asked for.

---

## 7. Implementation slices

Each slice is independently shippable, testable, and reversible. Nothing here changes a promise
already printed on a page until the copy changes in the same commit.

| # | Slice | Change | Test | Deliberately not |
|---|---|---|---|---|
| 1 | **Shapes** | `media.js` shape detection (7 kinds); store sections; ≤4 chips; card chips; empty sections absent | classification table test; a 4-shape store renders 4 sections and a 1-shape store renders none; chips absent below 2 shapes | no placement logic, no reader |
| 2 | **Enforcement** | server counts verified views against `required_ads` per unlock (not per connection); the client runs ad *n* only after postback *n−1*; the attempt is the promise and survives a reload — and an attempt past the sweep window is not resumed | 1 of 2 views → still locked; 2 of 2 → open; replayed postback does not count twice; a reload resumes the same attempt; an abandoned one is swept; "2 ads of 45 s" becomes true | no changes to the ask ladder |
| 3 | **Placement** | Half built (planner + controls): `placement.js` derives the cue list from shape + measured runtime + the ladder's ask + the plan ceiling; `asset_unlock_policy.ad_plan` holds the seller's opt-outs; `assets.runtime_sec` is reported by the player; the seller's file page renders the plan and its checkboxes | 20 tests: never in the first 2:00 or last 1:30, never two within 4 min, never past the plan ceiling, a reader breaks only between chapters, a live file gets no automatic break at all, a hand-crafted POST cannot write a placement the shape lacks | **the player gate** — nothing stops playback at a cue yet, so no buyer-facing sentence is rendered; the ask is still the door |
| 4 | **The attention door** | tier gains `join_mode` (`dues` / `attention` / both); verified views accrue standing; member room page | an attention join never creates a dues row; a member file stays ad-free in `dues` mode; `supporter` mode's ask equals the public ask | no money handling of any kind |
| 5 | **The ledger** | `attention_events` + a store-facing page: views, seconds, per surface, per placement; the platform slot's own numbers separated from the store's | arithmetic test; the page states which side earned what; no payout field exists anywhere | share-back/credit (waits for leg 6) |
| 6 | **Reader** | `read` surface: PDF/CBZ via range requests (PDF.js/folio-js class libraries, no vendoring until chosen); between-chapter gate; image-folder sets | pagination order; gate position never mid-page; resume position per viewer | no DRM, no per-page watermarking beyond what images already do |
| 7 | **Live** | `stream` shape: store-scheduled break only, picture-by-picture, new-arrival entry trade | a platform-inserted break is impossible by construction (no code path) | everything about RTMP ingest — out of scope until the shape is real |

Order: **1 → 2 → 3** first (they close a shipped lie, then make placement real), then 4 → 5, then 6,
then 7. Slices 4–6 are the ones the brief cares about most; slice 2 is first because "2 ads of 30
seconds" is currently a sentence, not a gate.

## 8. Decisions taken

1. **The attention door: yes** — a second door onto the same tier, never a replacement for dues, and
   never called payment. (Slice 4.)
2. **Share-back: no. Leg 7 is removed.** A store's ad spaces are the store's; ours are ours, wherever
   they sit in the app. The method for making our own inventory earn is in §5.5 — house-first, native
   rather than banner, direct local deals priced by surface, rotation instead of another box, counted
   before invoiced, and never mixed with a store's inventory.
3. **Mid-rolls on openly viewable files: allowed**, store-controlled, under the nine rules of §5.2.
4. **Slice order: 1 → 2 → 3**, then 4 → 5, then 6, then 7.

## 9. Progress

| Slice | State |
|---|---|
| 1 Shapes | **Built** — `assetShape` in `media.js`, sections and chips on the storefront, shape on every card, 12 tests (`media.test.js`, `shapes.test.js`). Suite 620/620/0 |
| 2 Enforcement | **Built** — the grant is `count(completed views) >= the attempt's own ask`; progress is reported, not guessed; an attempt survives a reload; 8 tests (`adviews.test.js`), 5 screenshots from a real two-ad walk (`docs/evidence/round35`, harness `ci/eyes/walk-ads.mjs`). Suite 628/628/0 |
| 3 Placement | **Half built** — planner, seller controls, measured runtime, seller panel; 20 tests (`placement.test.js`, `adplan.test.js`), one screenshot (`docs/evidence/round35/walk-7-placement-seller.png`). **Remaining: the player gate** — until playback stops at a cue, the plan is real to the seller and invisible to the buyer. Suite 650/650/0 |
| 4 Attention door | Not started |
| 5 Ledger | Not started |
| 6 Reader | Not started |
| 7 Live | Not started |
