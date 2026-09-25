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

**A person with Plus** — a palette (8), one name effect (6), and a ring on their
avatar wherever an avatar is drawn.

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
