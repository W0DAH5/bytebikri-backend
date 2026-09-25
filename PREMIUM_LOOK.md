# The premium look — three payers, two layers, one rule

This is the framework for every visual thing somebody pays for. It exists because
the first version got the ownership wrong in a way a sentence gave away: the
storefront's member list said *"the plate next to a name is the perk"* while that
plate could come from two completely different places — the creator's tier, or the
member's own ByteBikri Plus — and whichever arrived last won.

Written before any of it was implemented, in the order the brief asks for:
research, then framework, then code, then a walk.

---

## 1. The three payers, and why they are unrelated

| Payer | Pays | Gets | Touches |
|---|---|---|---|
| **A person** | bytebikri (Plus, NPR 149/mo) | how **their own name** looks, everywhere | nothing about any store |
| **A store owner** | bytebikri (Store NPR 999 / Pro NPR 2,499 a year) | what **their shop** can do: theme, membership feature, footer, slots | nothing about how people look |
| **A member** | the creator, directly (dues) or in views (attention) | **that store's** files and belonging | nothing about bytebikri's money |

There is no relation between the first and the second. They are two people paying
the same platform for different things, and they never meet. The only thing they
share is a page — which is exactly why the page has to be explicit about which
one is speaking. **A store cannot grant a person's wear, and a person's wear cannot
stand in for a store's mark.**

### The sentence that was wrong

> "One person is named here — they chose it, and the plate next to a name is the perk."

It reads as one thing. It was two:

* the **name treatment** is the person's, bought from bytebikri, worn on every page
  in the product whether or not they belong to any store;
* the **tier mark** next to it is the creator's, defined by the creator's tier, and
  exists only inside that store.

And the code made it worse than the copy: `memberPlate()` rendered a Plus member's
name *instead of* the store's tier mark, so a store's own roster dropped the
creator's chip the moment a member happened to have Plus. Two owners, one element,
and the wrong one won.

---

## 2. The framework: two layers, composed, never merged

**Layer P (person).** The name itself, plus the ring on an avatar. Owned by the
person, from Plus, identical on every page.

**Layer S (store).** The chip after the name — tier colour and tier name. Owned by
the creator, defined by the tier, visible only inside that store.

Both always render. Neither overwrites the other. The rule lives in one function
(`composeName` in `src/plus.js`) so no page can decide it differently, and a test
asserts that a Plus member still carries the store's chip.

What each layer is allowed to be is fixed by what it is *for*:

* Layer P is a **look**, and a look is never information. It cannot open a file, it
  cannot change a size or a position, and the ranking code does not read it.
* Layer S is a **fact** — this person belongs to Friend/Elite here — which is why it
  is the creator's to define and why it never varies between the storefront, the
  member room and the seller's own page.

---

## 3. Research: what the grand treatments actually are

**Discord, 2026 — the vocabulary this product borrows from, because it is the one
its users already know.** Five distinct cosmetic KINDS, each with its own job:

| Discord kind | What it changes | Where it shows | Verified detail worth stealing |
|---|---|---|---|
| Avatar decoration | art/animation around the avatar | profiles **and** compact lists (chat) | keeps a person recognisable in a list, not only on their own page |
| Profile effect | a large animation over the whole profile card | only when a profile is **opened** | "not a permanent animation running everywhere your name appears" |
| Nameplate | styled art **behind** the display name | member lists, DMs | **animates on focus/hover only**; mobile shows it static |
| Display-name style | the name itself: solid, gradient, neon, toon, pop, gummy, prism | profile panel + profile | animations are OFF on mobile; fonts/colours/effects stay |
| Profile frame / banner / theme | the card's edge and colours | profile card | full Nitro only; Nitro Basic gets a subset |

Three implementation facts from the same record, all of which our CSS obeys:

1. **Contrast is not optional and is adjusted dynamically** — Discord "dynamically
   adjusts the contrast of usernames to ensure readability regardless of
   background". A nameplate is art behind TEXT, so it is checked with the actual
   name on it, not on a swatch.
2. **Animate on intent, not forever.** Nameplates animate on hover/focus; profile
   effects play when the profile opens. Infinite looping decoration is not the
   model.
3. **Mobile degrades deliberately** — the same look, static.

**Telegram, 2026.** Premium's visible perks are the emoji status beside the name and
the sheer volume of choices ("infinite reactions"). The lesson: the *breadth* of the
collection is part of what a person is paying for, and the status has to be visible
next to the name where other people already look.

**Premium perception (why restraint wins).** Low colour saturation raises perceived
status and willingness to pay, and the mechanism is perceived continuity (seven
studies, *Journal of Consumer Research*, 2026) — the flagship-luxury palette is not
neon. Status positioning is associated with materially higher margins, and scarcity
framing raises aesthetic appeal most strongly for status-oriented buyers
(*Journal of Consumer Research* pool; *Journal of International Consumer Marketing*,
2026). Practical cues for 2026: space, physics-based micro-interactions, restraint in
palette, one focal point.

**Technique, from the CSS record (all of it used below).**

* `background-clip: text` needs **both** `-webkit-` and the standard form — Safari
  iOS still requires the prefix in 2026 or the gradient renders as nothing.
* Gradient stops **cannot be transitioned**. Two working routes: animate
  `background-position` on a ≥200% background (broadest support), or register the
  angle with `@property --angle { syntax: '<angle>' }` and animate it inside
  `conic-gradient(from var(--angle), …)`. Without registration the angle is a
  string and the gradient **jumps** at every keyframe.
* A true 1–2px animated ring is `mask` + `mask-composite: exclude` on a padded
  pseudo-element (`-webkit-mask-composite: xor` for older WebKit). Forget the second
  mask layer and the whole element disappears.
* Repeat the first colour as the last stop or the conic gradient shows a seam.
* A JS `requestAnimationFrame` loop mutating inline styles per frame is an INP
  hazard; time-driven gradients belong in CSS keyframes.
* "An infinitely spinning border keeps the compositor awake — pause it when the
  state resolves and when the element is off-screen."

**Accessibility, tiered rather than blunt.** WCAG 2.3.3 requires interaction-triggered
motion to be disableable; the harm model is vestibular, and colour/opacity changes are
explicitly *not* motion. So: remove spin/parallax/large translation, keep colour and
opacity, and keep the look — a static version of every effect renders the same idea.
Decorative animation: 1–2 cycles at most, then stop.

---

## 4. The rules this product will follow

1. **Two layers, always both.** `composeName` is the only place that decides; a test
   proves a Plus member still wears the store's chip and a store's chip never
   replaces a person's name look.
2. **Nothing is sold twice.** One Plus plan, every effect inside it. Discord's own
   backlash was against cosmetics sold on top of a subscription, not against
   cosmetics.
3. **Animate on intent.** Resting state: the look, still. Motion runs on
   `:hover`/`:focus-visible`, or for one short arrival when a panel opens. Nothing
   loops forever in a list.
4. **Reduced motion keeps the look.** Under `prefers-reduced-motion: reduce` every
   animation stops and every gradient stays painted. Tiers: remove (spin, travel,
   scale) → soften (fades) → always keep (colour, ring geometry).
5. **Contrast is arithmetic.** Every palette's worst stop is composited and checked
   against the ink that sits on it, in both colour schemes, by a test.
6. **Restraint is the look.** One animated focal point per surface. A roster with six
   animated names has no elite tier at all — the top chip is the only thing allowed
   to glint.
7. **Cheap to render, honest to describe.** CSS-only, no JS per frame; every hint
   says out loud whether the effect moves and that the system decides.

---

## 5. What each payer gets

**A person with Plus** — a palette (8), one name effect (6), a ring on their avatar
wherever an avatar is drawn (6), and the edge of their own card, wherever that card is drawn (6).

| Effect | Look | Motion |
|---|---|---|
| Plain | the palette ink, nothing else | none |
| Edge | a gradient rule under the name | none |
| Halo | a soft glow behind the name, in the palette | slow, hover/focus |
| Gradient | the name painted in the palette's own two stops | slow pan, hover/focus |
| Neon | lit ink with a layered bloom | faint pulse, hover/focus |
| Prism | a conic sweep travelling across the letters | sweep, hover/focus |

**A store on a paid plan** — its theme band (a still gradient, or a drifting one),
the membership feature, the footer removal, and an honest plan mark on the
storefront's own header that says the shop is paid for.

**A member of a store** — the creator's chip, in the creator's palette, on that
store's pages only. The membership bought nothing about bytebikri, and bytebikri
sells nothing about the membership.

---

## 6. Slices

| # | Slice | State |
|---|---|---|
| 0 | The ownership sentence, and `composeName` as the one place that decides | **built** |
| 1 | The effect vocabulary: 8 palettes × 6 effects, described in words, one plan | **built** |
| 2 | The CSS: `@property` conic ring, painted names, on-intent motion, reduced-motion tiers | **built** |
| 3 | The store side: plan mark on the storefront, the animated band | **built** |
| 4 | Verified in a browser: both schemes, reduced motion, and a roster wearing both layers at once | **built** — `ci/eyes/premium-walk.mjs`, 8 sections, run green |
| 5 | The shop window: the member's own name in both layers, updating as they choose | **built** |
| 6 | The aurora band: a mesh in the theme's own stops, a bounded grain layer, and the seller's own stage | **built** |
| 7 | The store's mark: two initials derived from the name, painted in the band's own two colours, on the header, the stage and every card in Explore | **built** — `identity.test.js` (7 tests) + walk §12 |
| 8 | The tier's glyph: six shapes from a closed vocabulary, painted in `currentColor` inside the chip, chosen in the seller's picker | **built** — migration 0041, `identity.test.js` (6 tests) + walk §12 |

### What slices 5 and 6 measure

Both were built after the research in §7 and both are checked where they run:

* **The stage shows the member's own name, never "Aa"** — and it keeps a store's chip
  beside it, in the default store palette, with a caption saying whose it is. The walk
  asserts the name on the stage is the name in the header, that choosing an effect
  repaints the class and the caption **without navigating**, and that choosing a palette
  moves the ring and the name together (`--plate-ink` on the stage equals the
  stylesheet's own value for that palette). Saving still works, and the walk saves the
  seeded look back so the next run starts where this one did.
* **The aurora adds no colour.** The walk reads the mesh's computed
  `background-image` in the browser and refuses any colour that is not one of the
  theme's two stops (or fully transparent) — so the palette test's arithmetic still
  covers every pixel of the band, including the parts that move. It also asserts two
  `theme-aurora` animations are running (13 s and 17 s, one reversed), that the grain
  layer is present, and that under `reduce` the gradient, grain and mesh are all still
  painted while nothing moves.
* **The seller's stage previews without changing the save.** Hovering a card paints the
  band with the store's own name and tagline on it and says "Previewing"; moving away
  restores the current theme. The card is still a submit button and still one click.
* **The default card previews the absence of a theme** — no palette — because a card
  that painted the first palette's fallback would be previewing a band the store cannot
  have.

### What the walk found that the tests could not

Both of these were shipping defects, both invisible to `npm test`, and both found by
the browser the first time it was pointed at a page that was supposed to be moving:

1. **`.is-live` was on the container; the rule matched the element.** The Plus page
   puts the class on `.plus-preview` and the animation sits on the name inside it, so
   `.wear-halo.is-live` never matched anything and the one place in the product where
   the motion IS the product was completely still — while every stylesheet assertion
   passed, because the rule was there and correct. The fix is the second spelling,
   `.is-live .wear-halo`, which is also the one that reads better: the page marks a
   REGION as live and every wear inside it moves.
2. **`Element.getAnimations()` does not return pseudo-element animations.** The ring's
   motion lives on its `::after`, so the ring measured as `[]` while visibly turning.
   Measuring it needs `{ subtree: true }` — and the walk now asserts the ring
   specifically, by name, because "the preview is moving" is a claim about a name and
   a ring rather than about one element.

3. **The header chip wore nothing, and no assertion was looking at the header.** The
   class resolver took a ROW and `plusWear()` on an already-resolved wear object is
   always null, so the signed-in person's own avatar — the avatar in the header of
   every page, the one they see most — silently rendered without its ring. The unit
   suite passed because no test rendered the header; the walk passed because its
   sections were about rosters and the Plus page. It now has a section about the
   header, on a page that is about somebody else's store, and `wear.test.js` renders
   the real header for both an active arrangement and a lapsed one.

A fourth finding was a HARNESS bug worth recording because the shape recurs: the walk
collected every selector it wanted to measure into one list and then walked it, by
which time both pages had navigated to the Plus page — so the roster measurement
found nothing and threw. Measure each thing on the page it lives on, in visit order.

The contrast numbers the walk reads out of a real browser, for the record — every one
of them the WORST stop the browser paints, not the average:

| Where | Scheme | Effect | Worst contrast |
|---|---|---|---|
| A roster name | dark | halo (inked) | 6.23:1 |
| A roster name | light | halo (inked) | 7.90:1 |
| Effect picker demo | dark | gradient (painted) | 6.48:1 |
| Effect picker demo | dark | prism (painted) | 6.48:1 |
| Effect picker demo | light | gradient (painted) | 7.25:1 |
| Effect picker demo | light | prism (painted) | 7.25:1 |

---

## 7. The next slice: the shop window and the aurora band

Slice 4 shipped a look that is *correct* — two layers, motion on intent, contrast
proved. This section is the answer to "the designs seem unenough", and it is split by
payer for the same reason everything else in this document is: a person buys a look for
their **name**, a store buys a look for its **shop**.

### What the research adds

**Discord, one level down.** The pattern that matters most for the store side is
*Enhanced Role Styles*: a role is not a hex code any more, it is **Solid, Gradient or
Holographic** (a shimmering two-colour treatment), with a small role icon beside the
name. Two lessons, both of which this product can use honestly:

* a "gradient/holographic" axis is a *style* axis, not a colour picker — the same
  argument `themes.js` already makes for shopfront palettes;
* the community advice attached to it repeats the accent rule: *"gradients and
  holographic roles are accents — if every role shimmers, none of them feel special."*
  That is the same reason only the top tier glints here.

Discord's server profile also ships **ten built-in gradients or a custom banner**, and
per-server profiles are a **primary + accent** pair — a shop's identity is two colours
and an image, not a theme engine.

**The aurora technique, verified.** The current band drifts `background-position` on a
190%-wide gradient. That works, and it is the technique the 2026 write-ups now flag:
*"animating background-position on a huge gradient repaints a full-width layer every
frame... animate a registered property or a transform instead."* The replacement is the
mesh everyone else has moved to:

* **stacked radial gradients** (3–4 colours maximum — more "creates mud") over a solid
  base, which is what reads as light rather than as a CSS default;
* **8–15 second loops**, because *"animation cycles under 6 seconds feel anxious"* —
  the band's current 26 s alternate is on the slow side of that;
* **a grain layer at 3–5 % opacity** (an inline `feTurbulence` as a data URI) — *"it is
  what stops a large soft gradient from showing banding on 8-bit displays, and what
  makes the surface read as a material"*;
* **transform, not background-position**, for the movement, and pause it off-screen.

**The one warning that decides this design.** *"Text over a moving gradient can drop
below 4.5:1 at some frames. Put the text on its own solid or heavily-tinted layer and
check contrast at several animation offsets."* That is exactly the rule `themes.test.js`
was written around, and it is why the band's base stays an **opaque** gradient and the
aurora is built out of *nothing but the theme's own two stops* — no white lift, no
silver highlight, no new colour for the arithmetic to miss.

### Slice 5 — the shop window (the person's look)

The picker currently previews an effect on "Aa". A person buying a name effect wants to
see **their own name**, and the effect is sold on motion, so the preview has to move.
What changes, all on `/plus`:

* one **stage** above the picker: the member's own name, in the chosen palette, wearing
  the chosen effect, with the ring on the avatar — and the store's chip beside it,
  labelled as such, because the whole point of this round is that the two are different
  owners. The stage is `is-live`: the motion *is* the merchandise;
* it updates **as you choose**, without a round trip, the way Gumroad's design tab does
  — the palette and the effect both, read from the DOM the picker already renders, so
  no second copy of the effect table exists in JavaScript;
* without JavaScript it shows the saved look and still saves. The picker is a form
  first and a preview second.

### Slice 6 — the aurora band (the store's look)

* the band's **base stays an opaque gradient** of the theme's two stops — the surface the
  arithmetic already governs;
* two **drifting mesh layers** (`::before`, `::after`) paint large soft radial gradients
  **in the theme's own stops**, moving by `transform` on coprime durations (17 s and
  23 s, one reversed) so the loop never visibly repeats;
* a **grain layer** at 3.5 % keeps large soft gradients from banding;
* motion only under `prefers-reduced-motion: no-preference`, and it **stops when the
  band is off-screen** — a decoration nobody is looking at has no business on the
  compositor;
* the seller's chooser gets a **stage** too: pointing at (or focusing) a theme card
  paints the full-width band with the store's own name and tagline, without changing the
  one-click save. The card stays the button; the stage is the window.

The floors hold: white ≥ 5.5:1 and the 92 % secondary ink ≥ 4.5:1 at **every point of the
interpolation**, with the grain's worst-case lightening (3 %) composited in. Any new
stop, any white lift, or any noise layer with a bigger budget fails the build rather than
being noticed by a reader on a train.

---

## 8. The next slice: identity — the store's mark, and the tier's glyph

Slices 5 and 6 gave both payers a **surface**. What neither has is an **identity**: a
storefront is a name in a heading (every store looks like every other store that typed a
different word), and a tier is a word in a chip (the creator's colour, and nothing that
belongs to that tier alone). Two complaints, one subject. Researched before built, as
before.

### What the research says

**Discord, on the two things this slice adds.** The **server icon** is 512 × 512, masked
to a circle, scaled down to about 32 px in the sidebar — and every one of the 2026 spec
guides calls it *"the most visible branding element"*, *"the primary visual identity"* of
a server: it appears in the sidebar, in invite previews, in discovery, in notifications.
**Role icons** are a 64 × 64 upload that renders at *"roughly 20 pixels next to a
username, so use one bold shape"*. And the split between free and paid is explicit and
consistent across the guides: **the static icon is free — anyone gets one — while the
banner needs Boost L2, an animated banner L3, and an animated icon L1.** Identity is a
basic thing every shop has; ornament and movement are what the money buys.

**Monograms and generated identity.** The reason Google, Apple, Slack, GitHub and Notion
all generate an initials avatar is the same short list: no dependency on an upload,
identity that exists the second the account does, consistency across the product, and no
storage or moderation attached to it. Apple shows one or two initials; Google shows one
initial and carries differentiation in the colour; GitHub derives *shape and* colour from
a hash. The design advice attached to lettermarks is narrow and worth following: one or
two colours, bold forms, **two initials rather than one where a name allows it** (one
initial collides about 1 in 260 against 1 in 7000 for two), and **test the mark at 32 px**,
which is where every one of these marks actually lives.

**Where this product diverges, on purpose.** Our colour does not come from a hash. A
hash-derived hue would be a second colour system inside a page that already has one — the
store's own palette — and it would be a colour nobody's contrast arithmetic ever measured.
The store already chooses two colours; the mark wears those.

### Slice 7 — the store's mark

* **Derived, never typed**: two initials from the store's name, split on spaces, hyphens,
  underscores and middots, possessives dropped (`Alice's Studio` → `AS`, `nima-crafts` →
  `NC`). No upload, no moderation queue, nothing to be left blank.
* **Painted by the store's own palette**: on a themed store the mark is the band's own
  inversion — the band's ink as the tile, the band's deep stop as the letter — *the pair
  the palette test already measures*, so the mark introduces no colour the arithmetic has
  not covered. On an unthemed store it is the neutral mark the product already draws for
  a person. Identity is free; the colour is what the plan buys.
* **A plate, not a circle.** In this product a circle is a person (the nav chip, the
  roster avatar). A store is a rounded square, the same radius family as its own band.
* Three sizes, one component: the storefront's header, the seller's chooser stage, and
  every card in Explore.
* **Still.** The band is the moving thing on that page. A mark that shimmers beside a band
  that drifts is two things asking for the same attention, and the research on role styles
  has said from the start what happens then: *if every role shimmers, none of them feel
  special.*
* `channels.logo_url` — in the schema since 0008, commented *"the UI falls back to the
  store initial"*, and never rendered anywhere — is read here, so the promise is a
  component instead of a comment.

### Slice 8 — the tier's own glyph

* A curated vocabulary of **six shapes** — the store's role icon, and the same answer this
  product gave the palettes: a set of named, contrast-checked choices rather than a
  free-form field, because a 20-pixel surface cannot carry a design that was not drawn
  for it.
* **Painted in `currentColor`**, which is the whole safety argument in one word: the glyph
  is drawn in *exactly* the ink the tier's own name is drawn in, so it cannot be less
  readable than the word beside it, in either colour scheme, at any palette.
* Chosen by the creator per tier (six shapes plus "no glyph"), shown in the editor's own
  sample, on the storefront's tier cards, and inside the chip wherever the chip renders —
  the roster, the seller's queue, a review.
* No upload. Discord's version is a 64 × 64 image at Boost L2; the thing an upload buys is
  a moderation queue and a way to make the storefront unreadable, and the bold single
  shape is the advice attached to their own spec.
* The chip's existing rule is untouched: the top tier is the only one that glints, and a
  glyph is available to both tiers — it is the tier's identity, not its shine.

### Slice 9 — the person's own colours, on the page that is theirs

Taken from the premium-feature survey's *Identity & Profile Customization* category: **"profile
themes"** — the one item in that list this product had not answered. Discord's version colours the
profile card; the survey's other example (Slack's icon packs, "custom app icon or colour scheme") is the
same idea pointing at the app itself. The question here was where a PERSON's theme can live, and the
answer came from the two-layer rule rather than from the survey.

**It cannot go where a store's band goes.** A storefront's band is the store's surface: a member's
palette repainting it would be layer P standing in for layer S, which is the exact confusion this
document exists to prevent — and it would put a page's whole contrast plan at the mercy of a colour
somebody else chose. So the band goes on **the page that is the person's own**: `/library`, their shelf.
A store keeps its theme; a person's name keeps its paint inside that store's pages. The band is
self-only, and the line inside it says so.

**The arithmetic found something before any code was written.** The store themes are *surfaces*: each one
is built so white clears 5.5:1 at every point of its gradient with the grain composited
(`themes.test.js`). The person's palettes are *inks*: eight accents drawn to be read ON the product's
surfaces. Painted as a band — the palette's lighter stop to its deeper one, white text — two of them
fail:

| palette | white on the gradient (worst point, grain in) | the 92% secondary ink |
|---|---|---|
| indigo | 5.88 | 5.26 |
| sky | 5.55 | 4.96 |
| violet | 5.35 | 4.79 |
| emerald | 5.11 | 4.60 |
| teal | 5.10 | 4.57 |
| **amber** | **4.72** | **4.26** |
| **rose** | **4.56** | **4.05** |
| slate | 9.30 | 8.16 |

(Rose's 4.05 on the smaller line is below the body floor, so the naive design was not "slightly thin" —
it was a palette that ships unreadable text.)

**The recipe that passes, and it is still a band.** The palette's **deep stop is the surface**, and the
lighter stop is the **aurora**, mixed over it at no more than **30%**. Measured at that bound, with the
grain composited, every one of the eight palettes clears the store band's own bars: worst case is rose at
**5.52:1 white** and **4.85:1** for the 92% ink. So the person's band is a deep palette with a slow
lighter drift through it, the same ink tokens (`--theme-ink`, `--theme-muted`), and the same numbers to
beat — one standard, two recipes, both measured.

**One blob, not two.** The store band's aurora is two radials because its base is an opaque surface that
was picked to carry white. Here the base is the deep stop and the mesh is the *lighter* stop; two 30%
layers over the same pixel are **51%**, and the bound is the contract. So the person's band has exactly
one radial, at the bound the table above is computed at, and `plus.test.js` counts the `radial-gradient(`
occurrences in the rule to keep it that way.

**The box is the store band's box.** A band that spans the container with no radius reads as a swatch of
colour laid behind a paragraph — the first screenshot of it, in a browser, is what said so. It is now the
same plate the store's head is: the store head's own radius (`--radius-xl`, 20px), its own inner spacing
(`--space-6` top and sides, `--space-5` under), and a **one-pixel inner light** along the top edge in the
palette's lighter stop at 35% — no blur, no spread, and no word within 16px of it, so it is decoration the
arithmetic never has to carry. The two bands are then recognisably one object worn by two different
owners, which is the whole point of the layer-P / layer-S split.

* Where: `/library` — the head becomes the band, with the page's own words in band ink and one line
  naming what it is. `/plus` states it in words beside the picker rather than wrapping the shop's hero:
  the hero contains the picker, the stage and the chip sample, and putting a moving surface behind all of
  them would mean auditing every colour inside it in both schemes for a decorative gain.
* When: exactly when the person wears a look (`plusWear`), which is the same decision point that paints
  their name — one rule, not two. A running month with no palette chosen shows no band, because there is
  nothing chosen to paint; the picker is what changes that.
* What it is not: not on a store's page, not on the header, not a second paint of the name inside the
  band (their plate ink on their own band is a pair nobody measured: teal's `#2dd4bf` on teal's deep
  stop is **2.9:1**), and not a free-form colour picker.
* Motion: the same aurora keyframes as the store band, declared the same way — inside
  `prefers-reduced-motion: no-preference` and nowhere else, so a reduce user is handed the band with its
  colour, its grain and its mesh, standing still, and there is no reset rule that can fall out of step
  with the declaration.

**What slice 9 measures.** Three layers, because the recipe is arithmetic, the arithmetic is CSS, and the
CSS is a page. (`themes.test.js` already does this for the store band; this is the second recipe under
the same discipline.)

| layer | what it asserts | what it found |
|---|---|---|
| `plus.test.js`, arithmetic | all eight palettes, deep stop + the lighter stop at `OWN_BAND_MIX` + grain composited, worst point | rose worst: **5.52:1** white, **4.85:1** for the 92% ink; every palette clears 5.5 / 4.5 |
| `plus.test.js`, stylesheet | the mix in the CSS equals `OWN_BAND_MIX`; exactly one radial; exactly one `animation:` and it sits inside a `no-preference` query; the paint rule is not inside any media query; radius, padding and the 1px edge light | all hold — the mix and the measured bound cannot drift apart, and the reduce path cannot lose the colour |
| `premium-walk.mjs` §14, browser | the painted surface, the ink the words landed in and the mesh behind them, computed from computed styles with every fallback applied; then the same page as a store, as somebody with no arrangement, and under `prefers-reduced-motion: reduce` | alice, dark: surface `rgb(17, 94, 89)`, **7.58:1** white, **6.70:1** for the 92% ink, mesh painted, `theme-aurora` running, radius **20px**, padding **24px**, edge `0px 1px 0px 0px inset`; a store's page: **0** `.own-band`; no arrangement: no band and the old head, byte for byte; reduce: band and mesh kept, `animationName: none` |

The walk is the layer that would have caught the *sandwich* error — a reduce user losing the colour
because the paint itself was declared inside a motion query — and the layer that proved the quiet case
this slice was most likely to get wrong: `GET /library` hands `personBand()` a row that really does carry
`nameplate`, `plus_effect` and the arrangement, so the band renders for a wearer and silently does not
for everybody else. If that had been wrong, nothing would have errored; the page would simply have been
the old page.

**Still discarded this round, with the reason.** Chat/emoji surfaces (there is no chat), upload
pipelines and CDN (no uploads, by the same reasoning as the store mark), HD streaming and WebRTC, server
boosts and platform-side currency (a flow in the wrong direction), priority support (an operating cost
this plan has none of), app-store IAP and tax handling (nothing is sold in an app store), feature flags
and A/B infrastructure (one operator; the rollout is a page reload), an MRR/churn pipeline (the console
prints the ledger), server-side caching of entitlements (the entitlement join is indexed and the
correctness risk of a stale cache is worse than the query), Lottie-class animation runtimes (a
200 KB runtime for a nameplate, and they do not honour reduced motion by default), group/family plans
and referral rewards (both are money movement, which this product does not do), a paid badge next to a
member's name on a store's roster (layer S wearing layer P), and per-page analytics for the platform's
own pages (the traffic table exists to price a store's rent; a conversion rate computed from three
visits is a number nobody can act on).

## 10. The cosmetics engine — slots with owners, and what a shop would require

The brief for this section came as a design review of one card: the roster plate, with its ringed
initial, the member's name, "since 25 Sept 2026" and a store's `ELITE` chip. The review's argument was
that this is one badge doing the work of a system, and that the system should be a **cosmetics engine** —
an inventory of slots (profile frame, avatar frame, name effect, badge, card background, aura, entrance
effect), separated from the profile, so that "ELITE is just one cosmetic, not the entire visual system",
and so a fifth phase of the product needs no redesign of the first. The phases it proposed ran from
entitlements and a renderer, through visual slots and animation, to a cosmetic shop, bundles, seasonal
passes, rarity and a creator marketplace.

Most of that diagnosis is right, and this codebase had already made the two moves that matter. What it
had not made is the one the review is really asking for, and this section records what was built, what
was already there, and what was refused — with reasons, because the refusals are the part that keeps the
engine coherent.

### The rule that decides every slot: who owns the surface

A decoration belongs to the owner of the thing it decorates. That single line decides every slot here,
and it is the ownership correction from the earlier rounds extended from badges to whole surfaces:

* **A person's slots decorate the person's own identity** — the paint on their name, the effect around
  it. They travel with the person, they are worn anywhere that person's name is rendered, and only
  bytebikri grants them (a Plus period). A store cannot grant one, cannot take one away, and its theme
  never stands in for one.
* **A store's slots decorate the store's own surface** — the band its pages are painted in, the shape its
  tiers wear. They belong to the creator, they are paid for on the store's own plan, and they never
  appear beside a member's name as if they were that member's.

That is why there is no `cardBackground` slot in the engine. On a store's page the surface belongs to the
store (it has themes); on a person's own page it belongs to the person (their own band on `/library`, §9).
A slot that let either repaint the other's surface is the exact confusion the earlier correction was
about — and the researched record says the same thing from the other side: *if every role shimmers, none
feel special*.

The two slots the review called frames are a different matter, because a ring and an edge are not
surfaces, and they were built:

* **The avatar frame is the ring.** The avatar here is an initial, not an upload, so what a person decorates
  is what is drawn around it: `none`, `hairline`, `beaded`, `orbit` (the ring the product has always drawn),
  `split` and `double` — six, each described in words that say whether it moves. It is a person's slot, it
  travels with their name, and — deliberately — it draws on the avatar's pseudo-elements rather than on
  `box-shadow`, because a store's own top-tier light lands on the same avatar and one owner's decoration
  must not be able to put out the other's. The ring also paints from its own pair of custom properties
  (`--wear-a`/`--wear-b`, falling back to the plate's), so a ring worn on a store's roster comes out in the
  WEARER's colours even though the tile around it is painted in the store's.
* **The profile frame is the card's edge.** The card is a rendering of the person, so the edge of it is
  theirs to decorate wherever the card is drawn: a store's roster, the seller's member list, their own
  stage. `none`, `hairline`, `bevel`, `double`, `glow` and `aurora` — six, and still an edge, never the
  surface, never the ink, never the store's chip. `aurora` is the one value that needs a gradient, and it
  is the reason the rule is written as a gate rather than a ban: a frame rule may set a background only if
  it is masked, subtracts the content box, and sits inside `@supports (mask-composite: exclude)` — so where
  the mask is not supported the fallback is a plain edge, never a repainted card. The statement test reads
  the stylesheet and fails on all three conditions.

### The review's eight slots, one by one

| The review proposed | What this product does | Why |
|---|---|---|
| **Profile frame** | Built as the **card's edge**: `frame` — `none`, `hairline`, `bevel`, `double`, `glow`, `aurora`, on the person's own card wherever it is drawn. The page's *surface* stays the page owner's (a store's band, §6; the person's band, §9) | An edge is a decoration of the person's card; a surface would be a claim about somebody else's page |
| **Avatar frame** | Built as the **ring**: `ring` — `none`, `hairline`, `beaded`, `orbit`, `split`, `double`, drawn on the initial, everywhere the person's look is rendered | The avatar here is an initial, not an upload; a "frame" in this product is a ring |
| **Name effect** | `effect` — six, four of which move, each described in words that say so | Already built, and the words exist because choosing on a phone should not be a surprise |
| **Badge** | The store's **tier chip** (creator-defined, layer S), the **plan mark** on a paid store, the **verification badge** on a store an operator checked | Three badges, three owners, three meanings — and none of them granted by a store to a person |
| **Card background** | The surface, as above | Same reason as the profile frame; it is the same slot by another name |
| **Aura / particles** | Refused | Bandwidth on a Nepal-first product, a second design to audit under `prefers-reduced-motion`, and the surest way to make every plate in a roster shimmer |
| **Entrance / hover animation** | Hover and focus on intent is what exists (the ring spins, effects drift, `:focus-visible` included). Entrance animations on lists refused | A roster of forty people animating in is noise, and motion here is deliberately something you ask for |
| **Multiple cosmetics combined** | A look already is a combination: eight palettes × six effects, composed by one decision point (`composeName()`), with the store's chip beside it | This is the review's own point, answered before it was made |

### The engine, as data

`app/src/cosmetics.js` is the declaration. A slot has a `key` (the form field and the column), an
`owner` (`person` or `store`), a `grant` (`plus`, `creator`, `store-plan`), a `kind` (which picker
control draws it), a `label`, the question it answers, and its `values` — each with a label, and with
`moves` and one sentence of words wherever a person can choose it. Six slots today: four a person wears
(`nameplate`, `effect`, `ring`, `frame`) and two a store sets (`glyph`, `theme`).

The two outer layers were added exactly the way the engine was built to add them — one entry each in
`SLOTS`, one column each with its own check (`0044`: `profiles.plus_ring`, `profiles.plus_frame`), one
renderer branch each (`memberPlate`'s avatar and card, the account chip, the stage). The picker grew the
control by kind (`demo`: a tile that IS the thing — an initial wearing the ring, a small card edged with
the frame), not by another hand-written block. `NULL` in either column means **not chosen**, and it
renders as the product always has, which is why nobody's avatar changed on the day the slot arrived; the
two `demo` slots also taught the picker a rule it did not have — a slot with **nothing** checked submits
nothing, so the picker pre-checks what is being drawn (the orbiting ring, the plain edge) and a first save
works.

What makes it an engine rather than a table is that nothing else keeps a second list:

* the **picker** is the catalog drawn — `views.plusPage` iterates the person slots, so a new slot appears
  with its own control and its own words;
* the **route** validates against the catalog — `/plus/look` refuses a submission whose values are not
  that slot's own;
* the **tests** hold all four ends together: the catalog against the database's own check constraints
  (`profiles.plus_effect`, `profiles.plus_ring`, `profiles.plus_frame`, `membership_tiers.glyph`) read
  out of Postgres, against the picker's markup, against the write path's SQL, and against the schema —
  every person slot's column must live on `profiles`, and no store slot's column may. They also refuse a
  value whose class has no rule in the stylesheet: a control that changes nothing is worse than a missing
  one.

A new slot therefore costs: one entry in `SLOTS`, one column with its check, one renderer branch — and
`test/cosmetics.test.js` fails until the database, the picker and the write path all agree. That is the
review's actual ask, and it is the property that makes the fifth phase cheap instead of a redesign.

### The review's phases, and where the line is

**Phase 1 (entitlements, inventory, equipped, renderer):** built — `plusWear()` decides what is worn
from the database's own clock, `profiles` holds what is chosen, `composeName()` is the renderer.

**Phases 2 and 3 (visual slots, animation):** built as far as this product should carry them — the ring
and the frame arrived with the engine's own mechanism, and what stays refused is the aura, the particles
and the per-list entrance animation (bandwidth, and a second design to audit under reduced motion).

**Phases 4 and 5 (shop, individual purchases, bundles, seasonal passes, rarity, collections, creator
marketplace):** all of them are **money movement**, and the standing instruction is that moving money
inside the application is a later feature this product does not have. There is nothing to sell until
there is a rail to sell it on, and inventing prices for entitlements no rail can charge for would put a
shop on a page whose own footer says there is no checkout. Rarity is a property of a shop, so it arrives
with the shop, if it ever does. A creator marketplace would add an upload pipeline, a moderation queue
and a payout path, each already refused on its own grounds.

### What this section changed in the product

The picker no longer keeps its own list of slots: it draws the catalog, the route reads the catalog, and
the catalog is checked against the database it has to agree with. The look a member saves is byte for
byte the look they see in the preview, and the walk that proves it (`premium-walk.mjs` §11) still passes
through the new path: choose prism, save, switch palette to rose, save back to teal and halo.

The round that added the ring and the frame is the engine's own test: the catalog gained two entries, the
schema gained two checked columns, the picker gained one control kind — and `premium-walk.mjs` §15 proves
the whole chain in a browser. That section reads both groups of tiles and requires **six of each, every
one of them drawn** (a control whose tile does not wear the class the product renders for that value is a
promise the picker does not keep), chooses the round's two new treatments — a `split` ring and an `aurora`
edge — and watches them arrive on the stage's own avatar and card with no round trip at all. Then it reads
the person's card **through carol's session** on a store's roster, because the roster does not name the
reader's own row and what matters is what another person sees: the creator's chip still there, the store's
top-tier light still alight, and the person's ring and edge around both — the ring painted in the wearer's
teal while the tile under it stays the store's violet, and the aurora **at rest**, since a page nobody
pointed at must not animate. Finally it saves the pair it found and puts them back, so the walk leaves the
state it started in.
