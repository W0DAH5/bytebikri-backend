# The premium cosmetic system — tiered treatment, selectable identity

**Status: defined, not built.** This document is the framework the brief asked for —
*first design the underlying tier/cosmetic model and the accessibility fallback, then
implement effects progressively*. No UI in this round: the model is declared in
`app/src/cosmetics.js` with the tests that hold it, and the first motif set is drawn.
The effects themselves start in Phase B, on the word.

## 0. The brief, in its own words

> Premium is not one icon. Premium is a visual-cosmetic system with tiers, animation
> budgets, and selectable identities.

The distinction the brief hammers, and the one this product was missing: **membership
state is a fact; cosmetics are the feeling the fact produces.** `ELITE ▲` was one badge
doing the work of a system. A system is a ladder of *treatment*, a wardrobe of
*identity*, and a budget that keeps forty cards on a roster from all shimmering at once.

Standing constraints that shape everything below (unchanged):

- **No money movement in the application.** No shop, no bundles, no rarity-for-sale —
  cosmetics ride the entitlements that already exist (store membership, Plus).
- **Nepal-first.** The animation budget is a product rule, not an apology: a cosmetic
  that costs a frame on a phone the buyer actually owns is a cosmetic this product does
  not ship.
- **State must remain understandable without animation.** The membership audit
  (`MEMBERSHIP_AUDIT.md`) proved the fact layer; nothing in this document may make the
  word `current`/`ended` depend on a sweep.
- **No sexualized mascots.** A character may orbit, wave, float, sit on the frame,
  throw sparkles, react to hover. The feature is never "pay and a sexy character
  appears"; that moves the product into a different category. The rule is recorded
  because it is load-bearing.

## 1. The layer chain

```
MEMBERSHIP STATE        none · pending · active · lapsed
        ↓  (proved: MEMBERSHIP_AUDIT.md, 881 tests, walk 0 findings)
TIER / ENTITLEMENT      who is owed what — derived, never stored
        ↓
POWER LEVEL             standard · silver · gold · crystal · inferno
        ↓  (treatment class + animation budget — this document, §4)
VISUAL IDENTITY         the motif worn: silver star · golden lotus · buddha …
        ↓  (the person's choice, §5)
ANIMATION BUDGET        how much of it may move, on which surface — §6
        ↓
OPTIONAL EFFECTS        the mascot layer, environmental effects — Phase D
```

Each layer has an owner in this product, and the layers never merge:

| Layer | Owner | Granted by | Changes when |
|---|---|---|---|
| state | the store + the clock | — | confirmation, period end, leave |
| tier | the store | dues confirmed / views spent | the creator confirms or the member leaves |
| power | **derived** — never a row | `powerOf()` over live entitlements | automatically, in the same minute |
| identity | **the person** | a choice, validated against power | the person re-picks it |
| budget | the platform | the ladder, per surface | never — it is the rule |
| effects | the platform | Phase D, per power | never |

## 2. Research — what the systems that do this well actually do

**Twitch (sub badges).** Static PNGs only — *badges may not animate; only emotes may*.
The design convention every guide converges on is the one this system builds: **the
same silhouette with added treatment as the tier rises** — a plain sword, a golden
sword, a glowing sword. Tenure is a second axis (1 month → years), each milestone a
badge slot. The hardest constraint is **legibility at 18 px**, and the professional
rule is to design the smallest size first.

**YouTube (channel memberships).** A distinct badge *per tier* — the creator uploads
one for each level, and a second axis of up to **nine tenure badges** rewards the long
stay. The membership's own framing of the badge: *"the badge that proves it publicly."*
Two lessons: the tier's mark is a per-tier object (which is why the treatment, not just
the chip's colour, must change with the tier), and loyalty deserves its own axis later.

**Discord (Nitro).** Deliberately the negative case: a Nitro badge is a *static*
verification mark, and Nitro's cosmetics are profile themes, not per-tier treatments.
Discord proves the floor — a badge can carry an entire "premium" claim and still feel
like a sticker. This product's brief is the ceiling: treatment, identity, motion.

**The CSS craft (the only techniques the budget will ever use).**

- *The 45° sheen sweep*: a 200%-sized overlay gradient, `transform:
  translate(-100%,-100%) rotate(45deg)` → `translate(200%,200%)`, `pointer-events:
  none`. GPU transform only — never `background-position`. The sweep the brief names
  ("the tiny detail that makes something feel designed rather than merely styled") is
  about 30 lines of CSS.
- *The rotating light ring*: `@property --angle` + `conic-gradient(from var(--angle))`,
  masked to a ring with the `padding-box` XOR trick, with a blurred twin underneath for
  the halo. This is exactly what the existing `orbit` ring already is — the gold
  treatment is its coloured, budgeted version.
- *Particles without canvas*: pseudo-elements + multiple `box-shadow` layers run on
  the compositor; the researched ceiling is roughly 50–150 particles before paint
  degrades. This system's cap is **eight nodes per card**, and it is a cap because a
  roster of forty cards would otherwise be 320 animated nodes on a 3 GB phone.
- *Reduced motion, done right*: the researched rule is **static, not slower** — a
  slower animation is still motion. Every effect settles to a *deliberate* static
  composition (the sheen becomes a resting highlight at 35% opacity; the ring stops
  mid-rotation at its brightest point; the particles become a fixed scatter), never to
  `opacity: 0` and never to an arbitrary frame.

## 3. What exists already (the foundation this builds on)

`PREMIUM_LOOK.md` §10 is the cosmetics **engine**: `app/src/cosmetics.js` declares the
six slots with their owners, `plusWear()` decides what is worn from the database's own
clock, `composeName()` is the one renderer, and `test/cosmetics.test.js` pins the
catalog against the database checks, the picker, the write path and the stylesheet.
Every slot item carries `moves` — the declaration that a person choosing on a phone
must know whether it moves *before* choosing.

The engine also recorded two refusals that this system **re-scopes, not reverses**:

- *Aura/particles were refused* as "bandwidth, a second design to audit under reduced
  motion, and the surest way to make every plate shimmer." The budget in §6 is the
  answer to all three: particles exist, capped at eight nodes, on at most one card per
  viewport, with the static scatter declared in the same catalog entry.
- *Entrance animation on lists was refused.* It stays refused — nothing in this ladder
  animates a row into being. A row may carry one slow treatment; it never performs.

## 4. The power ladder

Five levels, **derived by `powerOf()` from live entitlements — never stored as a
cosmetic, never sold** (there is no rail to sell on, and inventing one would put a
price on a page whose footer says there is no checkout):

| Power | Source in this product | Why this level |
|---|---|---|
| **standard** | an account, no live entitlement | the account, as it is |
| **silver** | a store's tier 1 membership, active | the first door paid through |
| **gold** | a store's tier 2 membership, active — the top tier, `TIERS_MAX = 2` | the store's own top mark |
| **crystal** | a running Plus period | the platform's own payer, which is why it travels with the person across stores |
| **inferno** | a special grant — **an operator's hand, not a purchase, for now** | where the brief's "more ridiculous stuff" lives: fire, the mascot layer, the environment |

The derivation is the highest power in force: `powerOf({ storeTierNo, plusRunning,
special })` → `inferno > crystal > gold > silver > standard`. A tier-2 member at one
store who also holds Plus is **crystal** everywhere, wearing the same identity — the
two payers stay unrelated (PREMIUM_LOOK §1) while the ladder is what makes "unrelated"
mean something visible: different payers, one scale of treatment.

What a power level is *not*: it is not a price, it is not stored, it is not a status
word. Lapsed is not a lower power — a lapsed member's treatment stops in the same
minute their files close (the state layer already says so in words), and re-joining
restores it. There is no "ex-gold" look, because there is no gold *in the row*; gold
is a function of the row.

**The treatment each level earns** (the rendered version is Phase B/C; this table is
the contract):

| Power | Nameplate | Ring | Frame | The signature move |
|---|---|---|---|---|
| standard | plain ink | — | — | nothing moves |
| silver | metallic paint, cold | hairline or orbit | hairline | one sheen, 8 s, on hover of one's own card only |
| gold | metallic paint, warm | orbit, coloured | bevel | sheen 6 s + slow light ring |
| crystal | refractive paint | orbit, coloured | aurora (masked) | sheen 5 s + light ring + frame drift |
| inferno | as chosen | as chosen | as chosen | everything above + the mascot layer + environmental embers — **on one's own stage only, never a roster row** |

## 5. The two-layer separation — power is the treatment, the motif is the identity

The brief's structural contribution, adopted as the model's second axis:

```
POWER decides HOW STRONG   ×   MOTIF decides WHAT IT IS
```

A gold member wearing the *Golden Lotus* and a gold member wearing the *Golden Dragon*
carry the same treatment — the same warm metallic paint, the same sheen speed, the
same ring — and completely different identities. That is the difference between "this
account is premium" and "**this is my profile's visual identity**".

The motif is a **person slot** (ownership rule: it decorates the person, travels with
the person, and only bytebikri renders it — a store can raise a person's power but
cannot paint the person's name). Its values are the catalog in `cosmetics.js →
MOTIFS`, each entry carrying:

- `kind` — `motif` (a mark that wears beside the name, readable at 18 px, per the
  Twitch rule) or `mascot` (a character for the mascot layer, Phase D);
- `minPower` — the level at which it unlocks; a level's motifs include everything
  below it (unlocking is cumulative, so a crystal member may still wear the silver
  star, if that is who they are);
- `treatment` and `still` — the moving version's words **and its static version's
  words, in the same entry**, because the accessibility contract (§7) is enforced by
  the catalog, not by memory.

**The first set (drawn this round, `app/public/img/cosmetics/`):**

| Motif | Kind | Unlocks at | Treatment |
|---|---|---|---|
| Silver Star | motif | silver | four-point star, cold chrome, one frost line |
| Golden Sun | motif | gold | eight-ray sun, warm liquid gold |
| Crystal Prism | motif | crystal | faceted diamond, prismatic hairlines |
| Zen Enso | motif | gold | brushed enso with a lotus bud, antique gold |
| Royal Crown | motif | crystal | three-point crown, sapphire heart |
| Aurora Ribbons | motif | crystal | two ribbons, teal to violet |
| Prism Refraction | motif | crystal | beam splitting into a thin rainbow |
| Inferno Flame | motif | inferno | one flame, blue core, three embers |
| Golden Buddha | mascot | gold | laughing, meditating, lotus at the feet |
| Golden Dragon | mascot | gold | coiled, friendly, ember dots at the tail |
| Golden Lotus | mascot | gold | six petals, one catching the light — the third gold character, drawn and in the catalog |

The style family is matte, not gloss: one restrained metallic gradient, crisp linework,
no bloom, no 3D, no generic-neon — the deliberate anti-cliché, because the cliché is
exactly what "premium-looking but not premium" looked like before.

## 6. The animation budget — the rule that keeps it from becoming MySpace 2007

A budget is a number, so it is declared in `cosmetics.js → POWER[*].budget` and the
tests enforce monotonicity. Surfaces, because *where* is half the question:

- **row** — a roster plate in a list (the storefront's roster, the seller's member
  list). Dozens can be in view. A row may carry **at most one** moving element, slow
  (≥ 6 s), transform/opacity only — and inferno carries **zero**: the fire never
  touches a list, which is the old refusal, now as arithmetic.
- **card** — one card in focus (the member's own card, a solo plate). Up to four
  moving elements at inferno.
- **stage** — the person's own stage (`/library`, their own page). The full treatment,
  up to five — the environment is allowed to exist here and nowhere else.

**One per viewport, at the top.** At inferno, exactly one card in the viewport may
carry the full treatment — the person's own. Every other card on the page renders at
its own lower power. This is "if every plate shimmers, none feel special" as a
renderer rule rather than a hope, and it is the difference between a system and a
spray.

Performance contract (Phase B/C must satisfy it to ship):

- `transform`/`opacity`/`@property`-registered angles only. No `background-position`,
  no per-frame JS, no layout-triggering properties.
- Particles: pseudo-elements + `box-shadow` layers, **≤ 8 nodes per card**, no canvas
  in v1 (a canvas layer is a Phase D decision with its own budget: one rAF loop,
  frame-capped, paused offscreen and on hidden tab, per the researched pattern).
- Blur is expensive on low-end phones: the halo's blur radius is cut below the 480 px
  breakpoint, or the halo renders without it.
- Every animation pauses where the card does not render (the existing reduced-motion
  audit in `premium-walk.mjs` extends to read the budget off the catalog).

## 7. The accessibility contract

1. **State is readable with the animation off.** The state word (`current`/`ended`),
   the chip and the glyph exist in the same markup in both worlds. The cosmetic never
   carries state information the state layer does not already print — a fire that
   means "active" would be a second state system, and the audit exists to prevent
   exactly that.
2. **Reduced motion is static, not slower.** `prefers-reduced-motion: reduce` settles
   each effect to its declared `still` composition: sheen → resting highlight (35%),
   ring → stopped at its brightest angle, particles → fixed scatter, mascot → its
   resting pose. The catalog *requires* `still` on every moving entry; a test refuses
   an entry without one, because an un-audited fallback is the second design nobody
   checked.
3. **Decorative is `aria-hidden`.** The sheen, the ring, the particles and the mascot
   are decoration: present to the eye, absent to the reader. The name and the state
   word are the content.
4. **Contrast is untouched.** A treatment may paint a name's frame; it may not change
   the name's ink against its surface below 5.5:1 — the existing palette rule stands.
5. **The 18 px rule.** Every `motif` (not `mascot`) must be recognizable at 18 px;
   the icons are drawn and reviewed at that size first, per the Twitch convention.

## 8. What this round delivered, and what proves it

- **The model, as data**: `cosmetics.js` gains `POWER` (five levels, sources, budgets,
  treatment words), `powerOf()` (the derivation) and `MOTIFS` (the eleven entries,
  kinds, `minPower`, `treatment` + `still` pairs, asset paths).
- **The tests**: the ladder is ordered and monotone per surface; `inferno.row === 0`
  (fire never on a list); `powerOf` over every entitlement combination; `motifsFor`
  unlocks cumulatively; every motif entry is well-formed and **its icon file exists on
  disk** — a catalog that references a file nobody drew is a catalog lying.
- **The first motif set**, `app/public/img/cosmetics/` — eight tier motifs and three gold
  mascots in one matte style family (buddha, dragon, lotus — the third was drawn in the
  next image budget), source drawings at 1254². Production variants — 18/36/72 for the motifs, under
  200 KB for the mascots — are cut in Phases B and D, judged at 18 px first, per the
  Twitch rule.

No renderer change, no route change, no membership-state change. The demo is
untouched, and nothing on any page moved.

## 9. Phases — the implementation, in the order the brief requires

| Phase | What | Gate |
|---|---|---|
| **A — this round** | model + budget + first motif set + tests; no UI | done: the tests |
| **B — the person's wardrobe** | the `motif` picker on the Plus look page (a `demo`-kind control, like ring/frame), the motif rendered beside the wearer's name at 18 px, and the silver/gold/crystal treatment of the wearer's own card within budget | done: `ci/eyes/cosmetic-walk.mjs` reads the 18 px mark, the power, the sheen state and the reduced-motion fallback off the page; the metallic nameplate passes `test/wear.test.js`'s painted-name rule |
| **C — the store's treatment** | the store's tiers earn their treatment: a tier 1 chip/plate renders silver-class on the store's own pages, tier 2 gold-class — the *store's* slots, owned by the creator, never appearing beside a member's name as if the member's | the ownership test (a store treatment must not land on a person's surface), the walk comparing the same member's plate at a tier-1 store and a tier-2 store |
| **D — the mascot layer + inferno** | a character sits/orbits the frame (resting pose + one idle + a hover reaction, never more), the environmental embers on one's own stage, and the inferno treatment for a special grant | the format decision (sprite sheet vs Lottie — budget < 200 KB), the one-per-viewport rule verified by the walk, the reduced-motion resting pose |
| — | shop, bundles, rarity, seasonal passes, creator marketplace | **refused while money movement is refused** — they arrive with a rail, if ever |

**What Phase B rendered, in the browser (the acceptance bar is the paint, not the badge):**
the power reaches the DOM as one `data-power` attribute and the stylesheet dresses the card —
a static rim+halo in the power's own hue (readable with every animation off), and a single
45° sheen, transform-only, `paused` at rest and run by hover/focus/the live preview. The
**nameplate** column of the §4 table is the name itself wearing the power's metal: a static
gradient painted from the tier's material (cold chrome / liquid gold / prismatic crystal /
banked ember) with the **person's palette ink mixed into the two ends**, so the metal is the
tier and the member's own colour survives in it — the two layers kept apart on the name too,
and the reason a painted name here still satisfies the "painted names are inks" rule that
`test/wear.test.js` proves. A member who bought their own painted name (`wear-gradient`,
`wear-prism`, `wear-edge`) keeps it: the power dresses the card instead. The studio tiles had
their dark stage **keyed to transparent** (`app/scripts/key-tiles.mjs`, a region-grow gated on
the corner reference colour), so a mascot reads as a character sitting on the card — ringed by
the power's rim, drop-shadowed by its own shape — rather than a photograph pasted on; a mark
reads as an emblem at 18 px.

## 9b. Phase C — the scene rebuild (the Golden Buddha, as delivered)

The first mascot scene shipped as a medallion: a coin pinned to the card's edge,
a feather mask around it, the character breathing by the whole image scaling.
The rebuild replaced all of it. What the card now renders:

- **Four state layers, one composition.** The artwork is a single 3:2 scene —
  the buddha lounging in a mountain of coin, grapes in hand — drawn once and
  rendered as four full-scene states: `base` (hand at the mouth), `rest`
  (hand lowered, grapes in the bowl), `breath` (chest raised), `blink`
  (eyes closed). Each is a transparent WebP on the artwork's own irregular
  contour — **no circular crop, no vignette, no sticker ring** — and the
  motion is a crossfade between states: opacity only, compositor only, on the
  compositor. Nothing in the block scales, bounces, or translates the
  artwork. Any single state, frozen, is the full design, so the static card
  is never a broken frame.
- **The clocks, deliberately unsynchronized** (`app/public/styles.css`,
  `buddha-*` keyframes): breath 5.2 s, eating gesture 12.5 s with a long idle,
  blink once per 9 s, the light across the gold once per 24 s, aura 7 s,
  embers 14/19 s on two clocks, sparkle once per 11 s, and the 45° gloss —
  a broad, low, feathered band across the scene's own surface — 26 s per
  cycle with a ~5 s eased sweep and a long parked idle.
- **Fixed geometry, real overflow.** On the card the scene is a grid track —
  `[avatar] [identity] [scene]` — so the text column can never be painted
  over, and the card's box is fixed whether the scene is present, hidden, or
  has failed to load (`min-height` holds the row). The world spills past the
  card's right edge by a constant 5–22 px: a room the card opens onto,
  measured by the walk, not eyeballed.
- **Reduced motion is a composition.** Every layer parks: the base artwork
  stands, the light rests as a static band across the coins, the embers hold
  their scatter. Nothing disappears into `opacity: 0`.
- **The catalogue carries the states.** `cosmetic-model.js`'s buddha entry
  declares `asset` + `states { rest, breath, blink }`; `sceneWorld()` in
  `views.js` renders whatever a mascot has — a future mascot without states
  renders the base artwork only, same markup, one fewer layer. No card
  rewrite is needed for the next seven.
- **The proof** is `ci/eyes/cosmetic-scene-walk.mjs` (12 sections): four
  loaded WebP layers, the layer animations running on their own clocks with
  zero drift over live animation, the box byte-identical with the scene
  hidden, the overflow fixed, no text under the world, **one scene per
  wearing card and zero scenes outside cards on every surface** (the
  duplicate-render check), tablet/mobile simplification, the long-name stress
  case, the parked reduced-motion frame, missing-state and missing-base
  removal, the owner's list, and the picker with its live preview.

## 10. The decisions this document makes — confirm or correct

These are where the brief and the code met and a choice was needed. Each has a
default; say the word if the default is wrong and Phase B is rebuilt around the
correction — that is what "define before build" is for.

1. **D1 — the motif wardrobe's power source.** Default: a person's *highest live
   power anywhere* unlocks their wardrobe (a tier-2 member at one store may wear a
   gold motif platform-wide, and it travels like a Plus look does). Alternative:
   motifs unlock with Plus only, and store tiers upgrade the *store's* treatment
   (Phase C) without touching the person's wardrobe.
2. **D2 — who earns inferno.** Default: an operator's hand (a special grant, recorded
   in the audit log, revocable) — no purchase, because no rail exists. The named
   flagship stores can be the first wearers, which is also a demonstration.
3. **D3 — mascot delivery.** Sprite sheet (PNG + CSS `steps()`, zero dependencies,
   ~60–120 KB) vs Lottie (vector, ~80–200 KB, needs a runtime). Default: sprite
   sheet in v1 — Nepal-first, zero dependencies, and the resting pose is the same
   asset either way.
4. **D4 — tenure, the second axis.** Twitch and YouTube both reward *duration* with
   its own badge set. Deferred deliberately: tenure data exists (the membership's
   `confirmed_at`), but the axis is refused for now — a product that just got its
   first cosmetic ladder should earn it, not ship it, and the model already has room
   (`powerOf` takes one more input without redesign).
