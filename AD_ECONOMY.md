# The ad economy: what the research said, and what was built because of it

This is the sentiment analysis the brief asked for, written **after** the research and **before**
(ahem: alongside) the code, and kept as the record of which source changed which decision. Every
number below is a published figure; every design choice below is traceable to one of them or to a
refusal that is stated in the same breath.

Read with `REVENUE_ARCHITECTURE.md` (the four legs) and `FEATURE_AUDIT.md` §32 (what shipped).

---

## 1. Rewarded video: length, count, and what actually pays

| Finding | Source | What it decided |
|---|---|---|
| Rewarded views under 15 s complete at **79.4%**; 30 s or more at **51.8%**; sub-60 s ≈ 66–71% | Nielsen, 18,400 campaigns (via Amra & Elma, 2026) | **A completed view is the only thing a network pays for.** Duration is not a lever a seller should be free to pull upward. `ASK_ABSOLUTE.seconds = 60`, and the ladder stops there. |
| 15–20 s now outperforms 30 s; 30 s is the mobile ceiling | RichAds, 2026 | The floor is **15 s** and the middle bands sit at 15–30 s. Most files on this platform are cheap; most asks are therefore one short view. |
| Rewarded is **opt-in**, and the reward must be concrete | RichAds, 2026 | The ask is stated before it starts — "2 ads of 30 seconds", the file's value, and the platform ceiling — and the unlock is granted by the network's postback, not by a timer in the browser. |
| Caps ≈ **3 per session**, 5 per day, and completion holds above 90 % when the reward is real | AudienceLab, 2026 | The per-file ask is capped at 3 ads (`ASK_ABSOLUTE.ads`). Total attention per unlock is capped at **3 minutes**, and that sentence is printed on the file page where the person is deciding. |
| Well-implemented rewarded does not hurt retention | AudienceLab, 2026 | The reward is the file, immediately, with no interstitial, no countdown to the page itself, and no second wall between the postback and the download. |
| 91 % say ads are more intrusive than 2–3 years ago; 87 % say there are more; 67 % are banner-blind; fatigue starts past ~3 impressions | HubSpot/Capterra, 2026 | **The density cap.** A page carries at most three boxes: the store's 1–2 and the platform's 1. Density was the old upsell (3 → 5 → 8 positions); it is not one any more. |
| 90-second unskippable units (YouTube, April 2026) and "triple ads" of 3×15 s are the resentment of the year | press + user reports, 2026 | The platform-wide ceiling exists **on every plan**. A plan decides how much of it a store may use; no plan, and no price, moves the ceiling. |

## 2. Why the seller no longer types the number

Two number boxes — "Ads to unlock" (1–5) and "Minimum ad length" (5–120 s) — meant that the party
with **the least information** about what a stranger will tolerate was setting the price of that
stranger's attention, on every file, with no feedback. The ceiling also allowed ten minutes of one
person's life for a single file.

The replacement (`app/src/adscale.js`) is a **value ladder with a plan cap**:

| Declared value (NPR) | Ask |
|---|---|
| free | 1 ad × 15 s |
| under 200 | 1 × 20 s |
| under 600 | 1 × 30 s |
| under 1,500 | 2 × 30 s |
| under 4,000 | 2 × 45 s |
| under 10,000 | 3 × 45 s |
| 10,000 and up | 3 × 60 s (the ceiling) |

The store's plan decides how far up that ladder it may go (Free 1×30, Store 2×45, Pro 3×60) — the
same shape as every other capability here: **the paid plan widens what a store may do, the platform's
limits protect the person on the other side of the door.** A seller may always choose the floor
("ask the minimum": 1 × 15 s, on any file, on any plan) and may never choose more than the ladder.

Two supporting decisions:

- **The value is not a price.** `assets.declared_value_npr` is a private statement of worth. Migration
  0004 removed `assets.price_npr` on purpose ("a price column with no payment path behind it is an
  invitation") and nothing here puts one back: no checkout reads it, no visitor sees it, and
  `NOT_CHARGED` still says there is no price on a file.
- **A saved ask does not move by itself.** A price change is presented on the seller's page as a
  drift to re-save, because an ask that changed under a visitor's feet would be worse than one that
  is briefly stale.

## 3. Ad blockers and Brave: the whole ladder, including where it stops

| Finding | Source | What it decided |
|---|---|---|
| **79 %** of ad-blocking traffic is undetectable (≈976 M people); only 21 % is soft (Acceptable Ads / adblock walls); ~⅓ of sites run anti-adblock; publishers lose ~$54 B/yr | Ad-Shield dark-traffic study, via AdMonsters, 2026 | **Detection is not a control.** Deterministic anti-adblock reaches at most a fifth of blockers *and* it is unreliable — so nothing here is built on it. |
| Brave Shields is one of the two strongest blockers; some sites detect Brave; **reader mode defeats every check** | adblock-tester / Valitkstudios / TechWench, 2026 | **No user-agent checks, no browser targeting, anywhere.** `src/blocked.js` has none, `test/blocked.test.js` asserts the copy never names a browser, and the escalation runs on evidence the platform actually has: **a signed postback that never arrived.** |
| Users on Acceptable-Ads allowlists met **13.6 % more** problematic ads than the general population | NYU, PETS 2025 | A wall built on a guess lands hardest on people who were compromising in good faith. Rung 1 is therefore an explanation, not a demand, and there is no "disable your blocker to continue" modal. |
| The existing pipeline already withholds the file when no verified view arrives | this repository, `unlocks.js` | **The harsh end already existed.** The ladder adds an explanation at the point where the silence used to be total, and the last rung stops *offering* an unlock that has failed six times in a few hours. |

The ladder, as implemented:

| Rung | Attempts in 6 h | What the visitor gets |
|---|---|---|
| `quiet` | 0 | Nothing. This is the product. |
| `notice` | 1 | The unlock, plus: the ad did not finish, here are the three usual reasons, try again and allow ads for this page if you use a blocker. |
| `explained` | 3 | The unlock, plus the trade stated plainly: the view pays the creator, ByteBikri never sees that money, and membership opens the file with no ad at all. |
| `withheld` | 6 | **The button is gone.** The note says the unlock is paused here for a while; the file stays listed, its description and preview stay readable, open files still open, the membership route is offered, and the count ages out on its own. |

What the platform refuses to do, printed on the seller's page next to the count (`NEVER_DO`):
no full-page interstitial, no browser targeting, no accusation in the copy, no modal in the middle of
reading, and **no mark on the account** — a blocked attempt is evidence about a request, not about a
person. A person who closes an ad is recorded as `declined` and does not climb anything.

## 4. The person's premium: why it is cosmetics, and why it is one price

| Finding | Source | What it decided |
|---|---|---|
| Discord's decoration backlash was about **$5.99–12.99 on top of a subscription already paid for** ("should be free with Nitro"; "$2–3" called fair; "$1 max") | GamingHQ, r/discordapp, 2026 | One plan (**NPR 149/month** ≈ one dollar), **every** effect inside it, no second charge for a frame — and the plan's own capabilities refuse everything else (`opens_content: false`, `removes_ads: false`, asserted in `test/plus.test.js`). |
| The defence that survives is "cosmetics **instead of** ads on a free app" | r/discordapp, 2026 | The page says in the negative what the money does not buy, in full, **before** the price. |
| **Youtube Premium is defending two class actions over the words "ad-free"** (California; a BC filing on 2026-08-21). Disney+ rewrote its terms in the same period and lost subscribers | press, 2026 | **The words "no ads" appear nowhere.** Not in the plan, not on the page, not in a promise. A paying customer's ads are untouched, because the ad money is the *creator's*, paid network-to-store, and bytebikri cannot give away what it never receives. |
| Discord's own advice on role styles: one or two effects, or nothing stands out | Discord, 2025 | Three effects, one of which animates, and the animation is declared only under `prefers-reduced-motion: no-preference`. |

## 5. Ad space inside a store's own premium surfaces

The brief: *"if the store owner pays and unlocks features channel inside channel or premium content
separately for certain users we get ad space there too — we are still winning more."*

The rule that came out of the research, and the one the copy states: **an ad may sit around a
premium surface, never inside the thing that was paid for.** Concretely:

- A member-gated file opens by an `unlocks` row. **No ad ever gates it, and none is placed between
  the member and the download.**
- The page around it carries the ordinary positions — the store's own, and the platform's single one.
  Which is the "winning more" the brief asked for, without taxing the member twice.
- The store's *own* ranked ad positions do **not** appear inside member surfaces as an extra layer;
  the store already monetised that audience twice (dues and its own ads), and the research on
  member-paid surfaces is that a second ask is where the relationship breaks.

## 6. What was explicitly rejected

1. **"Premium removes ads."** The rejected framing, for the third time: it takes a creator's revenue
   to sell a platform feature, and it is the exact promise two class actions are about.
2. **More positions as the upsell.** Density was the old model's upsell; the fatigue data and the
   brief both say the opposite. The cap is 1–2 store positions plus our one.
3. **A hard ad-block wall (interstitial, "disable your blocker to continue").** Unreliable, evadable,
   and it lands on the wrong people.
4. **Per-effect pricing** in the customer premium. Named as the thing that drew the backlash
   everywhere it was tried.
5. **A per-user global ad cap** (e.g. N unlocks a day). It reads as user-protective, but it silently
   caps every creator's revenue to protect a person from a number nobody complained about; the caps
   that matter here are per-file and per-page, and they are visible.
