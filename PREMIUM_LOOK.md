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
| 5 | A picker preview that shows the effect on the member's own real name, side by side | not started — the Plus page previews on "Aa" |

The unstarted slice is deliberately the smallest one, and it is the only place where
this document describes something the product cannot yet show.

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

A third finding was a HARNESS bug worth recording because the shape recurs: the walk
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
