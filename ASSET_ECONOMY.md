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
anywhere for a seller to type a shape, and there will not be one: a chooser would be a choice about
nothing. One piece of that design is still unbuilt and is not claimed anywhere else: the override
*down*, "publish this as a plain download instead". The reader that arrived with slice 6 refuses the
formats it cannot draw and hands the file over instead (`.epub .mobi .fb2 .djvu .cbr .cb7`), which is
the honest escape for a buyer — but a seller who wants their `.cbz` treated as a plain download has no
control for it yet.

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
| 4 | **The attention door** | tier gains `join_mode` (`dues` / `attention` / both) and `ad_mode`; verified views accrue standing per (person, store); a member room page; a member who keeps watching buys the NEXT period | an attention join writes no claim and no amount; a non-member is refused at a members-only file's own route; the price is the platform's (4 / 8 / 12 views for 1 / 3 / 12 months); `supporter` mode's ask equals the public ask and is snapshotted per membership | no money handling of any kind |
| 5 | **The ledger** | `attention_events` + a store-facing page: views, seconds, per surface, per placement; the platform slot's own numbers separated from the store's | arithmetic test; the page states which side earned what; no payout field exists anywhere | share-back/credit (waits for leg 6) |
| 6 | **Reader** | `read` surface: PDF/CBZ via range requests (PDF.js/folio-js class libraries, no vendoring until chosen); between-chapter gate; image-folder sets | pagination order; gate position never mid-page; resume position per viewer | no DRM, no per-page watermarking beyond what images already do |
| 7 | **Live** | `stream` shape: store-scheduled break only, picture-by-picture, new-arrival entry trade | a platform-inserted break is impossible by construction (no code path) | everything about RTMP ingest — out of scope until the shape is real |
| 8 | **Series** | the playlist form of `watch`/`listen`: a store-owned grouping with a store-set order, one card on the storefront instead of twelve, a landing episode decided by the server, a resume position that is the person's own, and an explicit *Next episode* — no autoplay, ever | the order flips with the mode; a finished episode is not "continue"; a hand-made POST cannot add a download or somebody else's file; nothing in accounting reads a position | seasons, bundles, series prices, cross-store borrowing, and an algorithmic next |

Order: **1 → 2 → 3** first (they close a shipped lie, then make placement real), then 4 → 5, then 6,
then 7, then 8. Slices 4–6 are the ones the brief cares about most; slice 2 is first because "2 ads of 30
seconds" is currently a sentence, not a gate. Slice 8 is last because it is the only one whose object
(the playlist) the brief names and no earlier slice needed.

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
| 3 Placement | **Built** — planner, seller controls, measured runtime, seller panel, and the player gate. 33 tests (`placement.test.js`, `adplan.test.js`, `breakgate.test.js`), 12 screenshots from two real browser walks (`docs/evidence/round36`, harnesses `ci/eyes/break-walk.mjs` and `ci/eyes/breaks-seller-walk.mjs`). Suite 663/663/0 |
| 4 Attention door | **Built** — `join_mode`/`ad_mode` per tier, `member_standing`, `joinByAttention` (with the extension), `memberDoorFor` + the `unlocks.js` refusal, the member room at `/s/:slug/members`, the seller's two pickers, and one `watchingDoor()` control. 5 tests in `members.test.js` (21 in that file), 11 screenshots from a real three-session walk (`ci/eyes/member-walk.mjs`). Suite 668/668/0 |
| 5 Ledger | **Built** — `ad_view_events` gained `placement`/`surface` (written by the claim, from the attempt's own snapshot); `ad_position_daily` counts rendered positions by page, placement and side; `/dashboard/:slug/attention` prints the two blocks and never their sum. 4 tests (`attention.test.js`), 3 screenshots from a real browser walk (`ci/eyes/ledger-walk.mjs`, `docs/evidence/round37`). §12 is the design |
| 6 Reader | **Built** — `archive.js` (a zip read through the central directory, both compression methods, caps that refuse a bomb rather than a big book: 8 tests) and `pages.js` (the page model: natural order, junk filtered, `ComicInfo.xml` not a page; the plan the reader turns, its segments, and the gate sentence: 11 tests). The reader itself is one page at a time or one continuous scroll, left to right or right to left, the store's choice per file; a stop lands **between** pages and the server refuses the bytes behind it (`403 a view is owed before this page`) rather than hiding them with a veil. The bookmark is the reader's own (`reading_progress`, PK (user, file)) and never shown to the store. 8 tests in `reader.test.js`, 8 screenshots from a real browser walk (`ci/eyes/reader-walk.mjs`, `docs/evidence/round38`) that also flips both seller choices and watches the reader obey. §13 is the design. Suite 763/763/0 |
| 7 Live | **Built** — §14 is the design: a live file is the store's own `https://…m3u8` (no ingest, no re-host, no recording), hls.js 1.7.3 vendored because Chrome and Firefox have no native HLS, and a break is a WINDOW only the store's own POST can open, which buys clean entries for newcomers at the ratio Twitch taught the industry. Built: `live.js` holds the arithmetic and the four caps, `live_breaks` holds the windows (one open per file, enforced by a partial unique index), and the seller's own POST is the only writer. 10 unit tests, 4 fixture tests, and `ci/eyes/live-walk.mjs` in a real browser (6 shots, `docs/evidence/round39`) — the stream plays, a break the seller calls stops it, the view is credited, playback resumes at the EDGE, and a newcomer inside the window walks in clean. Suite 782/782/0 |
| 8 Series | **Built** — §15 is the design: `series` (a slug and a closed `mode` per store), `assets.series_id`/`episode_no` with the pair checked as one thing, and `watch_progress` as the person's own bookmark (`0049_series.sql`). `src/series.js` is pure and decides the order, the landing episode, the next one, and *finished* from one place; the storefront collapses a series into one card, the series page lists the store's order, and an episode's page carries the strip, the resume, and a **Next episode** link that appears only when the episode ends — no timer, no autoplay. 14 tests in `series.test.js` and `ci/eyes/series-walk.mjs` in a real browser (`docs/evidence/round41`, 6 shots). Suite 801/801/0 |

---

## 10. The player gate — what a break is, and what stops it

Slice 3's first half could place a break and describe it to the seller. Nothing
could stop a player at one, so the plan was real to the seller and invisible to the
buyer — and the buyer-facing sentence was deliberately withheld rather than
promised. The gate is the other half, and it is built.

**The rule it rests on is one sentence: a break is a pause, not an unlock.**

| What happens | Where it is decided |
|---|---|
| A file can carry breaks at all | `unlock_mode = 'breaks'`, a separate mode — never a reinterpretation of `open`, which has been promising "Free — no ad needed" to visitors since it shipped |
| Which cues exist | the planner (`src/placement.js`), from the shape, the measured runtime, the value ladder's ask and the seller's choices — never the client |
| Where the playhead stops | `data-cues` on the stage, rendered by the server, drawn from `breakCues(plan)` |
| What releases it | `count(completed views) >= 1` on the attempt, checked by `/api/unlock/status`. The countdown is cosmetic and says so |
| Whether a break was credited | the signed postback, exactly as the door's is. A break's postback grants **nothing** — it marks one cue paid, in its own audit line (`postback.break_credited`) |

**Three things it deliberately is not.** It is not DRM: a viewer with devtools can
seek past a cue, and the client's own comment says so; the seek clamp stops
scrubbing, which is the ordinary way, not the determined one. It is not a door: a
file that asks at the door can never carry a break, so nothing a server-checked
unlock released can be released by a pause in a page — a seek costs the store an
impression it never used to have, and can never cost it content it was charging
for. And it is not a trap: the modal has a ✕, it closes the wait, and the sentence
after it says which half lost what — "the file keeps playing, the store was not
credited for that view." A late postback after somebody has left still counts.

**Measured, in a browser.** The 40-minute fixture's cues are real seconds, so the
walk plays into them: the playhead stops at 667.7s of a 668s cue, the modal numbers
itself "Break 1 of 2", the sandbox postback releases it back at the cue, a scrub to
2063s lands on 1763s, and the second break ends with the file playing on. Console
errors: none. Screenshots 8–18 in `docs/evidence/round36`.

**Four defects the walking found, all fixed:**

1. A player that reported an unchanged runtime got a 400 on every page load. The
   route treated the store's *no-op* the same as a bad number, so every viewer
   after the first had a failed request in their console for a fact the server
   already had. The bound now lives in one place (`measuredSeconds`) with both
   readers; "already known" answers `{ok:true, changed:false}`.
2. The ✕ did nothing on a breaks page. The door wires its own ✕ only when the door
   exists, and a file with breaks has no door — a close button that closed nothing,
   found by clicking it. It now ends the wait, armed before anything is asked of the
   network so it also works while the ad request is in flight.
3. The policy row stopped following the file. `setUnlockPolicy` had its own copy of
   the mode allow-list and it did not include `breaks`, so the two rows that carry
   one decision silently disagreed. One list now (`SELLER_MODES`), both writers
   read it, and a test asserts there is exactly one.
4. The seller's editor told a *free* file that it "now asks for 1" ad — a warning
   comparing the description against the policy row rather than against what a
   visitor is asked for. On a free or members-only file that is zero, and on a
   breaks file it is the plan's cue count, and the sentence now says which.

---

## 11. The attention door — what it is, and the one number that is not a seller's

Slice 4 answers the brief's hardest question with a door instead of a payment: a
store can let somebody in by WATCHING, and the price is the platform's because a
seller pricing a stranger's evening has no information to price it with.

| Decision | Where it lives |
|---|---|
| Which ways in a tier offers | `membership_tiers.join_mode` — `dues`, `attention`, or both. Default `dues`: no store starts selling attention |
| What a period costs in views | `ATTENTION_VIEWS` in `memberships.js` — 4 / 8 / 12 for 1 / 3 / 12 months. Not a column, not a form field, and a POST carrying one changes nothing |
| What counts as a view | `claimAdView`, and only when `completed === true` — the single statement allowed to say a view happened. A pending, screenout or refused delivery banks nothing |
| Where the count is kept | `member_standing(profile_id, channel_id, earned, spent)` — per STORE, with `spent <= earned` in the database rather than in a comment |
| What a member file does | `ad_mode`: `ad_free` (the default, and the shipped promise) or `supporter` (the ordinary asks stay; the belonging is what membership buys). Snapshotted onto the membership at join, so a later change to the tier cannot downgrade somebody mid-period |
| A member who keeps watching | the same door, read as the NEXT period: `joinByAttention` extends, and touches only `period_end` and `standing_used` — never the tier, the join method, the arrangement or the rota choice |

**The four refusals, each with its own sentence:** `short` (with how many views are
had and needed), `already-in` (a member pressing another tier's door — the
membership panel is one tier, and an upgrade is a dues decision), `claim-waiting`
(somebody is looking at that person's money; this door must not race it), and
`door-closed` (the tier has no attention door).

**The hole this slice closed.** Nothing checked `unlock_mode` in `unlocks.js`. The
page hid the watch button on a members-only file and the page is not the boundary:
a direct POST unlocked a members-only file with an ad. It now asks
`memberDoorFor` and answers `covered` / `ads` / not theirs — the same rule the page
renders, from one function.

**Measured, in a browser.** `ci/eyes/member-walk.mjs` (run after
`node ci/demo-state.mjs`) drives three sessions: a visitor reads the price and is
refused at the members file; four short views on four different files walk the door
from "4 more views to go" to "Join by watching"; the join lands back in the member
room with the card naming the journey; the seller's roster says "by watching — 4
views" and the dues queue stays empty; the seller flips the tier to `supporter` and
the member is told why a membership is being asked for a view; and the member
watches four more to buy the next period (30 days → 61). Console errors: none.

---

## 12. The ledger — the two numbers that are not the same number

§5.5's fifth rule is *prove it before invoicing it*: impressions per surface and per placement, counted,
because a flat monthly rate for a direct deal is only defensible with a number behind it. This section is
that count, and the whole of its design is one distinction the product has been careful about everywhere
else and would be easy to blur here:

| | A **verified view** | A **rendered position** |
|---|---|---|
| What it is | A network's own postback saying a person completed an ad | A box this application drew on a page |
| Who can prove it | the network | us, and only to ourselves |
| Where it lives | `ad_view_events` — written by `claimAdView`, the one statement allowed to say a view happened | `ad_position_daily` — written at render, incremented by SQL |
| Whose inventory | the store's; the network pays the store directly and we are not a party | either side's: the platform's slot is ours, the store's boxes are theirs |
| The money question | answered at the network's own statement | **not answerable here, and not answered here** |

**They are never added up.** A store's "watched on your files" and a platform slot's "positions drawn on
your pages" measure different acts by different parties, and a total of the two would be a number that
means nothing while looking like it means something. The page keeps them in separate blocks with their own
headings, and the platform's block carries the sentence that makes it honest: this is our inventory, it is
not your inventory, and it is not your revenue.

**Where the numbers come from, in code.**

1. **The verified view learns where it sat.** `ad_view_events` gains `surface` (the page kind) and
   `placement` (a key from the catalogue in §5.2). They are written by the same `INSERT` that records the
   view — not by a second statement that could fail apart from it — and they come from the attempt:
   `pending_views` gains its own `placement`, written when the attempt is created, because the plan that
   built the cue list is the only thing that knows whether the person is being stopped at a mid-roll or at
   a chapter boundary. A claim that guesses would put the wrong word on the ledger.
2. **The rendered position is counted at render.** `ad_position_daily(channel_id, day, surface, placement,
   side, impressions)` is upserted once per page render with the positions that page actually drew — the
   same shape as `page_view_daily`, and incremented the same way (`impressions = impressions + n` in SQL,
   never read-modify-write). `channel_id` is null for the platform's own pages: our landing page and the
   Plus page have no store to attribute a position to, and inventing one would be worse than a null.
3. **`side` is a column, not an inference.** `store` or `platform`, decided by `payoutParty` — the same
   field that decides who the slot's money belongs to. A future surface that renders both can then be
   counted correctly without anybody re-deriving the rule from a slot rank.
4. **Seconds only where a player reported them.** A mid-roll's duration comes from the verified view's own
   `duration_sec`, so the ledger's "seconds" column is blank for positions that were merely drawn. Blank is
   the true value; zero would be a claim.

**What the page says.** It is the store's page (`/dashboard/:slug/attention`), linked from earnings,
covering the last 30 days by default: the verified views and the seconds watched on the store's own files,
**grouped by surface and by placement** (so a seller can see whether a mid-roll is worth its interruption,
and whether between-chapter reads better than the door); then, separately, the positions we drew on their
pages, by page and by placement, labelled as ours. No rupee figure appears in the platform's block, because
there is no number we could honestly put there: a flat deal is priced by conversation, and §5.5 already says
what that conversation is for (a surface, a month, share of voice).

**What the ledger refuses, and why.**

- **No money columns.** Not a rate, a payout, an amount, an earned_total. The schema test asserts the
  ledger's tables have no such column, so the refusal survives the next person who thinks a `cpm` column
  would be convenient. When leg 6 has real revenue (§5.5), pricing it is a new decision with its own record,
  not a column that quietly appeared here first.
- **No mixing the two sides in one number**, for the reason the table above exists.
- **No third-party measurement.** First-party counting only: the number is ours, the page says so, and it
  does not pretend to be an auditor's.
- **No claim about a person.** A rendered position is a page load, refreshes included, and the page says so
  in words. We count what we drew, which is exactly why the count is evidence and not a bill.
- **No per-person ledger.** The events already carry who watched what (they have to: that is how a view is
  credited). The ledger aggregates them, and adds no new tracking of its own.

---

## 13. The reader — pages are a sequence, and a gate is a seam

§5.1 says a read is "an ordered image set" and §7's slice table says the between-chapter gate waits for a
reader surface, because a gate that nothing can stop at is a sentence rather than a product. This section is
that surface, and its whole design is three boundaries: **what a page is, where a gate may sit, and what the
reader refuses to draw.**

**What the research says, and what it costs us.** Two reading conventions share this shape, and they are
not interchangeable: webtoon-style content is a *vertical continuous scroll* with no page turn at all
("storytelling driven by vertical distance between panels"), while manga and manhwa are *page-based* — and
manga reads right-to-left, manhwa left-to-right. The complaint readers write down about free readers is
always the same three things: full-screen ads **between chapters**, banners **over the reading area**, and a
*mandatory* video before the chapter. So the rules that follow are the readers' own rules: a gate is a seam
between two pages, never a thing on a page, and it is never on every seam.

**1. What the reader draws, and what it says when it cannot.**

| The file | The reader |
|---|---|
| an image (`jpg/png/webp/gif/avif`) | one page per file — the two-image set that `assetShape` already calls a read is exactly this |
| a **zip of images** (`.cbz`; also `.zip`) | one page per image *entry*, read from the archive's own index |
| a **PDF** | the browser's own viewer in a frame, opened at a page (`#page=n`); range requests already work |
| `.epub .mobi .fb2 .djvu .cbr .cb7` | **not drawn.** The reader says so in one line and offers the file, with the "download instead" control §5.2 promised — an override *down*, never up |

Choosing "the import the browser already ships" over vendoring PDF.js is §7's own note (*no vendoring until
chosen*) read strictly: a vendored renderer is a dependency we would have to keep, and a PDF the browser
paints needs no code from us at all. The cost is honest and stated: **we cannot see inside a PDF**, so it
counts as **one chapter** however many pages it has, and no gate can be placed inside it.

**2. The page model — order is the seller's, not ours.**

- **Natural order**, case-insensitive: `10` after `9`. The classic alphabetical sort works only because
  publishers zero-pad (`001.jpg`); natural order agrees with it there and *fixes* the archive that shipped
  `1.jpg … 10.jpg` without padding.
- **Filtered, never reordered.** Junk (`__MACOSX/`, `.DS_Store`, `Thumbs.db`, `._*` resource forks) and
  metadata (`ComicInfo.xml`) are not pages. Nothing else is dropped: `cover.jpg` stays where it sorts,
  because moving it would be inventing an order the seller did not choose.
- **Chapter count is the page count**, and this is the whole reason the model exists: §5.3's planner was
  already written to place gates "after page 13 and page 27" of a forty-page read, and it was being told
  `files.length` — one. A reader makes that count true, and the planner needs no change to receive it.
- **Direction and mode are the store's, per file**: `page` (one page per screen) or `scroll` (a vertical
  strip), left-to-right or right-to-left. Default `page` + `ltr`; a manga store sets `rtl` once and its
  reader turns the right way. Both modes keep the gate at a seam: scrolling is continuous *within a
  segment*, and a segment ends where a gate is.

**3. Reading a zip without unpacking it.** A CBZ is a standard ZIP, and its **central directory** is the
index every reader uses to build the page list — which is exactly the random access this architecture
wants: one page served per request, no unpacking, and the same token machinery as every other byte.

- **Sizes come from the central directory, not the local header.** A ZIP written with a data descriptor
  (bit 3) has zeros in the local header, and the local header's *extra field* is often a different length
  from the central one — the entry's data starts after the **local** header's own name+extra. That is the
  one bug that would make every page of a valid archive unreadable, so it is what the test checks.
- **Both methods**: `stored` (0) copied, `deflate` (8) inflated — built into Node, so this costs no
  dependency. The CBZ convention is `stored` (images are already compressed) with `deflate` permitted;
  real archives contain both.
- **Caps, because a zip can be a bomb**: pages (entries), per-page bytes, and the archive itself are
  bounded, and a test builds a small archive that expands past the cap to prove the refusal is a sentence
  rather than a crash. ZIP64 is refused the same way — a 4 GB comic is a download, and saying so is the
  feature.
- **Names are labels and nothing else.** No entry is ever written to disk or resolved against a path, so
  `../../etc/passwd` inside an archive is a label that sorts somewhere and draws nothing. The reader serves
  bytes from the buffer it already holds; there is no traversal surface to get wrong.

**4. The gate, and how the reader makes it stronger than the player's.** The player's gate is a pause the
server releases (`data-cues` + the network's postback); a viewer with devtools can seek past it, and §10 says
so. A reader can do better, because in a reader **every page is minted separately**: the page route asks the
same question the gate asks, and **refuses bytes past an uncleared seam**. The veil is a courtesy; the
refusal is the product. A gate stands where the planner put it — never before chapter 3, never two within one
chapter of each other, never inside a page — and the file page says where the stops are *before* the first
page, because a gate nobody was told about reads as a fault.

**5. Resume, one row per person and file.** A reader expects "continue where you left off", so
`reading_progress` holds one row per (person, file): the step, and when. It is written when a page actually
changes rather than when a page renders — a URL fetcher, a preview crawler or a refresh is not reading — and
it is private: the store sees that a file was opened, never where somebody stopped in it. The file page
offers *Continue at page N*; the reader never asks twice.

**6. What the reader refuses.** No ad on a page, ever — the gate is a seam or it is not a gate. No gate on
every seam. No DRM, and no per-page watermarking beyond what the images already carry. No page counting for
a format we cannot read (a PDF is one chapter, and the planner is told one). No reading position shared with
the store. No vendored renderer until a renderer is chosen, and no dependency added for a format the
browser or Node already ships.

---

## 14. The live surface — the store calls the break, and the platform has no inserter

Slice 7's promise in §7 is one line, and it is an inversion: **store-scheduled breaks only; the platform
never inserts one.** This is the design behind that line — what a live file is, how it plays, where a
break may sit, and what the shape refuses.

The evidence is §2.3, and it decides everything here: Twitch's automated mid-stream ads are the
industry's clearest negative result — forced breaks the streamer could not control, a top user request
that read literally "Remove mid-roll ads" (5,089 votes), streamers reporting up to a third of viewers
lost per break. What survived, and what Twitch still runs, is the streamer's own schedule plus an entry
trade: **30 seconds of mid-roll turns the pre-roll off for the next ten minutes; three minutes turns it
off for an hour** (the 1:20 rule), run manually or on a schedule the streamer keeps. A newcomer inside
the covered window walks in clean; the pre-roll comes back at the top of a stream until the first break
has run.

So the whole design is one sentence: **a break the store runs buys clean entries.** We do not invent a
second mechanic, and we do not automate the first one.

### 14.1 What a live file is

A URL the store already runs — not something we host, transcode, record or relay.

- `assets.external_url` — the column `assetShape()` has been reading since the shape vocabulary was
  written, and the one place the shape code was ahead of the schema — accepted only as `https://…m3u8`,
  or as a same-origin `/…m3u8` path for the demo fixture, which this app serves itself. (Not
  `live_url`: the column means *the bytes are not ours*, which is the live case and the only case in
  this slice.) A page URL is a `play` embed rather than a live file, and an `rtmp://` URL is refused
  with a sentence: RTMP needs an ingest endpoint, and an ingest endpoint is a broadcaster, which this
  platform is not;
- no ingest, no re-hosting, no transcode, no recording. The card and the ledger say what the platform
  did — verified views — and a live surface that promised a stream quality would be promising something
  we never touched;
- the demo fixture is built offline by `scripts/make-demo-live.mjs`, which repackages the committed clip
  into MPEG-TS segments and a playlist and serves it from this app. Same reasoning as the comic
  generator: a demo pointed at somebody else's CDN would put a third-party host in the CSP to make a
  screenshot look nice.

### 14.2 How it plays

Native where the browser has it, hls.js where it does not, and nothing else.

- Safari (macOS, iOS, iPadOS) plays HLS from the plain `src`; Chrome, Firefox, Edge and Android Chrome
  have **no HLS demuxer at all**. A paid surface that cannot be watched in Chrome is not a surface, so
  one library is added: **hls.js 1.7.3, pinned and vendored** at `app/public/vendor/hls.min.js`
  (Apache-2.0; 619,692 bytes on disk, ≈70 KB gzipped) with its `LICENSE` beside it. It is MSE-based, it
  is what Twitch, Vimeo, Video.js and JW Player use in the same role, and it is served from our own
  origin under the existing CSP (`scriptSrc 'self'`);
- **which player is chosen by `MediaSource`, never by `canPlayType`.** Measured, not assumed: Chromium
  153 answers `maybe` to `canPlayType('application/vnd.apple.mpegurl')` — it *claims* native HLS — and
  then fetches the playlist and plays nothing, a black rectangle with no error. The rule the code
  follows is hls.js's own modern guidance: use the native player only where `ManagedMediaSource`
  exists (Safari), and otherwise hls.js when MSE is present, with the markup's `src` as the last
  resort;
- **the CSP names `blob:` for media and workers.** A MediaSource reaches the element as a
  `blob:` URL owned by this origin, and Chrome does not accept `blob:` under `'self'` for media: it
  logs a CSP violation and the element fails with “Media load rejected by URL safety check”. Both
  findings came from the browser walk, and `test/vendor.test.js` now holds them;
- the vendored file is a decision, not a download: the version is written down here, the licence ships
  with it, and upgrading is a change with a reason. This is the one dependency the reader design
  refused to add, and the difference is the browsers — Node and the browser already ship zip and image
  decoding, and neither ships an HLS client outside Safari.

### 14.3 Where a break may sit

The store calls it. Concretely:

- **a break is a window, not a cue**: `live_breaks(asset_id, started_at, ends_at, …)`, one open window
  per file at a time, at most four minutes long, at most one every four minutes and three an hour —
  the placement catalogue's caps are about a viewer's attention, and attention is not cheaper live;
- **the only writer is the store's own POST**. The panel has a *call a break now* button and a schedule
  the store keeps; there is no job, no cron and no server rule that opens a window, so "the platform
  never inserts one" is a fact about the code rather than a promise about our intentions;
- **viewers poll, we do not push**: the player asks `/api/live/:assetId/state` every ~15 seconds. When a
  window opens that this viewer has not been served, the player stops, runs the *same verified view* as
  everywhere else (the shared modal, the network's signed postback, the ledger row), and resumes **at
  the live edge**. The stream moved on while the break ran; we do not rewind, and the UI says so,
  because a viewer who thinks they missed something is a viewer who leaves;
- **the entry trade, in the panel's own words**: a break buys clean entries for newcomers for
  `ratio × seconds` of break (30 s → 10 minutes, 3 minutes → 1 hour), capped at the hour so that
  running longer buys nothing more than Twitch's own ceiling. Inside the covered window a newcomer's
  door opens with no ask; outside it the door is the ordinary one. That is the trade §2.3 said to
  state in the UI, and the storefront prints it before anybody presses anything;
- **coverage runs from the moment the break ENDS, early or on time, and buys the length that was
  ANNOUNCED.** A viewer who arrives while a break is running arrives *into* it — being stopped and
  being given a clean door are different facts, and only one of them is true of them — so a running
  window covers nobody. Ending a break early moves the coverage earlier, not away: it cannot be a way
  to buy the announced hour without running the break.

### 14.4 What it refuses

- **We never rewrite the store's manifest.** Stitching ads into the stream server-side (SSAI) is
  precisely "the platform inserts a break" — the one thing this shape exists not to do — and it makes
  the platform the party responsible for what plays where the ad network's own statement says
  otherwise. We read the manifest and we play it;
- **we do not read the store's in-band markers in this slice.** `EXT-X-DATERANGE` and SCTE-35 are how an
  encoder-driven schedule arrives from the store's own tooling, and reading them is a later decision
  with its own evidence. In this slice the schedule and the button are both the store's own;
- no RTMP ingest, no DVR, no replay, no recording — we cannot promise a rewind we do not have;
- no autoplay with sound, no interstitial over the stream, no ad on the entry frame itself, and no break
  that hides the fact that the stream continued;
- no second serving of the same view: a credited break is credited once, from the network's own
  postback, like every other view in this product.

### 14.5 What slice 7 builds

- **Schema**: `assets.external_url` with its check, and `live_breaks` with its window ordering and its
  one-open-window-per-file rule expressed in SQL rather than in a route;
- **Store**: `liveState`, `createLiveBreak`, `closeLiveBreak`, `cleanEntryUntil`, `setExternalUrl`, and
  the per-viewer question the player asks — has this person already been served this window? (answered
  from the ledger the views already write, not from a second table);
- **Server**: the seller's panel and its POST — which refuses a break on a file that is not a stream,
  because the panel's wording is not an access rule — the state endpoint, the view endpoint, and the
  entry trade in the door: a covered window opens the door clean, an expired one does not;
- **Client**: the attach (native or hls.js), the ~15 s poller, the shared modal, and the resume at the
  live edge;
- **Tests** for the arithmetic that is easy to get wrong: a closed window is not a break, two open
  windows are impossible, `ratio × seconds` of clean entry is exact, an expired window does not open the
  door, and the row a live break writes to the ledger reads `pre|mid × stream` like every other;
- **The walk**: `ci/eyes/live-walk.mjs` against the generated fixture — playback advances
  (`currentTime` moves), the door asks once, a break called from the *seller's* page stops the viewer,
  the network credits it, the viewer resumes at the live edge, a newcomer inside the covered window
  walks in clean, and the seller's ledger shows the row.

## 15. The series — a playlist of episodes, and the one place we do NOT take the wheel

Slice 1's shape table has said `watch` means "video, **one file or a playlist**" since the beginning, and the
brief's own list of asset types names "playlist videos". This is the design for it: what a series is, who owns
its order, where the buyer starts, and the one thing every streaming product does here that this one will not.

The evidence, all of it 2025–2026 and all of it about the same three decisions:

- **A series is a creator's edit, not a sort.** YouTube shipped Shows in 2026: a playlist becomes a show with
  seasons and numbered episodes, and the episode numbering comes from **the creator's manual order** — the
  publish date is only the fallback. Its own research paper on serial content is the caution underneath:
  identifying "the next episode" from behaviour misses, and the video such a system recommends next is
  routinely *unrelated to the series being watched*. Order is authored here, or it is wrong.
- **Serial and non-serial are different products.** YouTube's own split: a **serial** show is "intended to be
  watched in sequential order and is listed oldest to newest"; a **non-serial** show can be watched in any
  order and is listed newest to oldest, and non-serial is what a converted playlist defaults to. Both are
  legitimate; only the store knows which it made.
- **Autoplay is the thing to refuse, and this is where the numbers are.** An experimental study of Netflix
  viewers (2026) found **62 % of participants who had autoplay ENABLED said they disliked automatic content
  continuation**; turning it off cut **21 minutes of watching per day** and produced longer gaps between
  episodes, which the participants themselves described as *better*: "it made me more conscientious of how many
  episodes I was watching". The same literature calls autoplay the design pattern that "undermines the agency
  of users' experience". Netflix's own answer to the mess is a prompt — *"Are you still watching?"* — whose
  stated purpose is **not to lose your place**. Both of those exist because the player took the wheel. This
  product's player does not, so neither the inflation nor the prompt is needed.

### 15.1 What a series is

**A store's own grouping of the store's own files.** Not a new asset type, and that is the whole architecture:

- `series(id, channel_id, slug, title, blurb, mode, …)` and two columns on `assets` — `series_id`,
  `episode_no`. An episode is an ordinary file: its own cover, its own unlock mode, its own ask, its own
  ledger row, its own page. The series adds **order** and **one place to see it**, and nothing else;
- **the store owns the order.** bytebikri cannot create a series, reorder one, or insert into one — the same
  rule as the store's band and its member tiers. There is no platform-created series and no "recommended for
  you" row;
- **`mode` is the store's, and it changes one thing**: `serial` lists episodes oldest-number-first and carries
  a *Next episode* control; `collection` lists newest-number-first and carries **none**, because in a
  collection there is no next — any order is fine, which is exactly what the store said by choosing it;
- **one series is one kind of thing.** Only files that PLAY can join (`watch`, `listen`). A reader is already
  a container — its chapters live inside one archive, and §13's step is its episode — and a download has no
  player to be next in. Adding a `download` to a series is refused with that sentence, not silently allowed.

### 15.2 What the buyer gets

- **One card on the storefront, not twelve.** §4's rule (two-level chunking beats one long list; progressive
  disclosure) applied to the shape it was written for: the storefront shows the series as a single card in its
  shape's section, saying how many episodes it has and **which one is yours to play next**. The episodes are one
  level down, on the series page, in the store's order, each with its own state — free, ad-gated, locked,
  unlocked, members — so nothing is hidden and nothing is flattened;
- **the landing episode is decided by the server, not by guessing**: the person's own most recent unfinished
  episode if there is one, otherwise the first of a serial series (or the newest of a collection). The card and
  the page both say which one and why;
- **the position is the person's own.** `watch_progress(user_id, asset_id, seconds)` is the reader's bookmark in
  the shape video needs — written by the player, read to resume, **never shown to the store** (there is no
  seller surface for it, and no column on the seller's side), and **never evidence for accounting**: a view is
  credited by the network's signed postback exactly as it was, and a client claiming a position cannot move a
  number in the ledger. The reader made this promise first; a series is where a viewer would most expect us to
  break it, so it is restated here;
- **resume, and a way back to the start.** Opening an episode with a saved position seeks there and says so;
  the stage always offers *start from the beginning*, which is the reader's own "Start reading" in the other
  shape.

### 15.3 What it refuses

- **Autoplay, a countdown, and "are you still watching".** The first two are the agency cost measured above,
  and the third is only needed because of them — nothing here takes the wheel, so there is no place to lose.
  What exists instead is an explicit control with the next episode's title on it, which is also the only version
  that can carry a *door* honestly: our asks sit at the door of each episode, and an autoplayed episode is an
  autoplayed ad;
- **an algorithmic next.** The order is the store's or there is no series;
- **seasons.** YouTube drops every converted playlist into "Season 1" for a reason: a season is a third level of
  disclosure, and §4's finding is that more than two causes navigation confusion. One level: a series, and its
  episodes. A store with two seasons publishes two series, and the words on the page say so;
- **a series-level unlock, bundle or price.** Each episode asks its own door. Bundling is pricing, pricing is
  money movement, and money movement is a later feature;
- **crossing stores.** A series belongs to one channel; an episode may not be borrowed into one. Two
  sentences, because they are two questions — *is this series yours* (`store`) and *is this file yours*
  (`not-yours`) — and the second exists because the test in §15.4 tried it: the route scoped the series to
  the owner's channel and never asked the same question of the file it was handed, so a hand-made POST
  naming somebody else's file would have written that file into the poster's series, where the series page
  lists what a series holds without asking again who owns each row.

### 15.4 What slice 8 builds

- **Schema**: `series` with its own slug per store and a closed `mode` vocabulary, plus `assets.series_id` /
  `assets.episode_no` with a per-series unique number and a check that the number exists only with a series;
- **`src/series.js`** (pure, no database, no clock): the listing order for a mode, what counts as *finished*,
  which episode a person should land on, what the next one is, and the refusals — one module, because the
  card, the page, the seller's panel and the tests must agree about all four;
- **Store**: the series rows, the episode list, the ordering writes, and the position rows;
- **Server**: the public series page, the episode strip on a file's own page (previous / next, in the store's
  order), the seller's panel where episodes are added, numbered and removed, and the storefront's one card;
- **Client**: the position report (throttled, on pause and on a timer), the resume, *start from the beginning*,
  and the **Next episode** control that appears when a serial episode ends — never a timer;
- **Tests**: the order flips with the mode; a finished episode does not come back as "continue"; a hand-crafted
  POST cannot put a download in a series or a foreign file into somebody's series; the position is never read by
  any accounting path; and a browser walk (`ci/eyes/series-walk.mjs`) that watches one episode end, takes the
  next control, and finds the resume line waiting on the one it left.

### 15.5 What was built

- **Schema** (`0049_series.sql`): `series` with `(channel_id, slug)` unique and a closed `mode`; `assets.series_id`
  / `assets.episode_no` with `uq_series_episode_no` and `assets_episode_needs_series` — the pair is one fact, so
  the check refuses a number without a series rather than trusting the writer; `watch_progress` keyed by
  (person, file), four columns wide, with no column for a count, a view, an earning or a store. A series leaves by
  deleting its own row and its episodes stay published, as ordinary files;
- **`src/series.js`**: order by mode, `isFinished`, `landingEpisode`, `nextEpisode`/`previousEpisode`, `resumeFrom`
  (≥ 5 s) with `resumeSentence`, `clockWords`, `seriesSlug`, `freeEpisodeNo`, and the refusal table with
  `refusalOf`/`seriesRefusalCode` — one function, read by the panel, the route and the tests, so a branch cannot
  exist in one reading and be missing from the other;
- **Server**: the public series page, the episode strip on a file's own page, `POST /api/watch/progress`, the
  seller's panel and its five routes, and the storefront's collapse to one card. Every refusal is a flash code the
  panel prints from `SERIES_REFUSALS`, so the sentence a seller reads after a redirect is the module's own;
- **Client** (`public/app.js`): the throttled report (on pause, every 15 s, and on `pagehide`), the one-time seek on
  `loadedmetadata`, the *start from the beginning* link that seeks, saves zero and plays, and the **Next episode**
  control revealed by `ended`. The server is the record; the client is a convenience that may forget;
- **Tests** (14, `series.test.js`): the order, the grace on *finished*, the landing rule, the refusals, the pair in
  SQL, positions never reading into accounting, a position POST that writes nothing twice — and the hand-made POST,
  which is the one that found a hole (the missing `not-yours`) instead of confirming one;
- **The walk** (`ci/eyes/series-walk.mjs` → `docs/evidence/round41`): one card and no direct episode links on the
  storefront; the store's order and per-episode doors on the series page; a fresh visit with no resume; a pause at
  0:12 found again after a reload and sought by the player; *start from the beginning* leaving no resume behind; the
  episode ending to reveal a **Next episode** link and the last episode of a serial offering none; the finished
  episode not coming back as "continue", with the series page still saying *Start with Episode 1*; and the seller's
  panel numbering both episodes while never showing a viewer's position. The walk also refuses a session that is not
  actually signed in — a cached cookie outliving its database would have tested the signed-out page.
