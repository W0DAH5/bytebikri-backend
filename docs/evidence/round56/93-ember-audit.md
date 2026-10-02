# Ember audit — the pasted "canvas/box-shadow particles" critique, measured

A pasted external critique described the member-card scene as a broken canvas
particle system ("golden leaves", "rigid asset boxes spinning", "flat-line
slicing at a structural boundary") and proposed rewriting the sparks as
pseudo-elements with `will-change`. Measured against the code that actually
ships (styles.css 3422–3487, views.js 1074–1076), live on /s/nima-crafts in
the bundled Chromium:

1. **"Browser animates box-shadow, drops to CPU, rounds to whole pixels" —
   false here.** The three box-shadows are STATIC. The keyframes animate
   `transform: translateY()` and `opacity` only — exactly the compositor path
   the critique recommends. Computed styles mid-flight: translateY
   7.0293 / 18.2287 / 16.8 / 18.0574 / −2.22762 px — fractional, unrounded.
2. **"Hard clipping at a layout boundary" — false here.** The chain is
   `.mascot-embers` (overflow visible) → `.mascot-layer` (overflow VISIBLE —
   the scene deliberately spills its box) → `li.member--mascot` (the card,
   overflow hidden, radius 14px). The ember cluster's worst case over the
   whole 14s path (dot + 3 static shadows + 48px travel: y 1088.8–1172.8)
   stays ≥26.8px inside the card's clip (y 1062–1220). Five-frame burst at
   6x (93-ember-audit.png): no slice lines, no vanish-then-teleport; opacity
   fades are the keyframes' own 0%→12% / 70%→100% design.
3. **"All sparks locked to one clock, stiff" — half-true and deliberate.**
   There are two ember groups, not one clock: 14s linear and 19s linear with
   −7s delay and a 180° mirror; their relative phase drifts continuously.
   The code comment states the intent: "a few sparks rising off the pile, two
   clocks, different paths... restrained on purpose." Mobile hides embers
   entirely (≤560px), reduced-motion freezes them as a still (a11y block).

Also verified: no `<canvas>` element exists in views.js; no "leaf/leaves"
asset exists anywhere in the UI code; the critique's Part-1 subjects
(canvas, leaf sprites, foreground z-ordering of leaves) do not correspond
to anything in this repository.

Conclusion: no code change. The proposed rewrite would add compositor layers
(`will-change` × 2 pseudo-elements) to fix defects that measurement shows do
not exist, against the file's documented restraint discipline.
