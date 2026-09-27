# TARGET — the Golden Buddha scene

The visual and animation source of truth for the Golden Buddha cosmetic. Where
this file and a comment in the code disagree, this file wins.

## 1. The direction is FROZEN

Keep the current character and composition. Do not redesign the Buddha, do not
generate another candidate, do not restart the concept. The current artwork
already communicates: a recognisable laughing Golden Buddha, lounging, in a
mountain of gold, grapes in the raised hand, luxurious, strong silhouette.

The remaining problems are **implementation and asset quality**, and they are to
be solved as an artwork-and-animation *pipeline* problem — not with more glow,
more blur, more random effects, or another generated character.

## 2. The pipeline

    HIGH-RES MASTER → CLEAN LAYER EXTRACTION → ANIMATION ASSETS
                    → COMPOSITING → CARD DISPLAY

Never: low-res PNG → crop → upscale → blur → animate → call it done.

Do not repeatedly upscale/downscale/re-export the same asset. Do not solve
enlargement with CSS width, browser interpolation, sharpening, blur or glow.

## 3. The hand must not look ripped

The raised hand/arm must not read as a torn piece of photograph. No rectangular
crop, no aggressive feather, no blur to hide a bad seam, no glow over a seam.

The separated arm must preserve anatomy, gold material, lighting, jewellery,
fingers, grapes, shadows and highlights. Its edge must be clean: no halos, no
missing pixels, no transparent holes, no duplicated gold, no fuzzy edge, no
rectangular remnant, no visible AI seam.

## 4. What is behind the arm must be reconstructed

The body and environment the arm covered must exist as their own clean layer.
The critical test: **the original flattened artwork, and the reconstructed
layered version in the arm's original pose, must visually match.** If the
separation produces a visible seam, stop and fix the asset before animating.

## 5. Layers

Meaningful character parts must be able to move independently:

    background/environment · gold environment · body · head/face
    arm/hand · grape · foreground coins · jewellery · particles · aura · gloss

## 6. Breathing

Animate the body/chest region — never the whole artwork, never a bounce, never a
card pulse. 4–6 s, very small amplitude, natural easing. The viewer should feel
"he is breathing", not "the PNG is bouncing".

## 7. Hand and arm

Slow, relaxed, anatomical. An appropriate shoulder/elbow pivot. Sequence: rest →
slow lift → hand approaches the mouth → brief pause → subtle eating interaction →
slow return → rest → **long idle** → repeat. Never a mechanical up-down loop.
Never rotate the whole Buddha.

## 8. Grapes

A separately controllable element that participates in the eating motion. The
grapes follow the hand and never appear detached from it. A brief pause, a tiny
mouth interaction, or a momentary hide is allowed. The read must be: *he is
casually eating grapes.*

## 9. Face

Keep the current face; never sacrifice facial readability for animation.
Extremely subtle, occasional blink / mouth / cheek movement. The Buddha is
relaxed, so the face is not continuously animated.

## 10. Secondary motion

Restrained: shoulders following the breath, slight settling, tiny robe and
jewellery movement. The hand and the grapes stay the primary interaction.

## 11. Gold environment

The pile keeps its dimensionality — individual coins, depth, shadows,
highlights, foreground/background separation. Only subtle shimmer, an occasional
coin highlight, tiny environmental movement. The pile never bounces.

## 12. Aura

Subtle, warm, may breathe slowly (5–8 s, low amplitude). There must be **no
obvious circular vignette** around the Buddha: never `[ GLOWING GOLD CIRCLE ]`.
The silhouette stays organic.

## 13. Particles

Sparse and premium: gold dust, an occasional sparkle, subtle floaters, each on
its own timing. Never synchronised, never filling the card.

## 14. The 45° gloss

A slow studio-light reflection: ~45°, broad, soft-edged, low opacity, 3–5 s
sweep, smooth easing, then a long idle. Sequence: long idle → slow gloss → long
idle. Never "sweeping like a car".

## 15. Timing

Nothing shares a clock. Starting points: body 4–6 s · hand/grapes 6–10 s+ with
idle · aura 5–8 s · particles slow and independent · gloss 3–5 s + long pause.

## 16. If it cannot be separated, do not fake it

With one flattened image, the only honest motion is environmental: light,
particles, aura, gloss, an extremely subtle parallax. Genuine hand, grape,
breathing and facial movement require real separate assets. Animating a whole
PNG and calling it character animation is a failure.

## 17. Exactly one cosmetic per card

The cosmetic belongs to the profile/member card and renders exactly **once** for
each eligible card. It must never become a normal-flow page image. Every render
path is checked for duplicate mounts — parent, child, fallback, page-level,
card-level, duplicated branches.

## 18. Positioning

The card establishes the positioning context. The cosmetic may overlap and
extend past the card, but must not affect document flow, push surrounding
content, change the card's height, cover unrelated content, or shift the layout.

## 19. Text alignment

The identity block has deliberate geometry — username, tier, membership state,
date — with consistent left alignment, baselines, vertical rhythm, line-height,
padding, chip dimensions and spacing. Text is never positioned by eye, and
animation never moves the username, tier, state, date or avatar.

## 20. Composition

The Buddha stays large enough to read: character + gold + lounging pose + grape
personality, with the identity block readable. The overlap past the card edge is
**designed, not accidental**.

## 21. Quality test

Inspect at 1x, 2x and the maximum intended display size. Check face, fingers,
hand, grapes, jewellery, coin edges, silhouette, gold texture. No pixelation,
muddy detail, obvious upscaling, jagged cutout, fuzzy hand or texture collapse —
and blur is not a disguise.

## 22. Static recomposition test

Before animating: original flattened artwork vs reconstructed layered version in
the same pose must visually match.

## 23. Animation test

Frozen: face readable · hand clean · grape clean · body clean · no seams · no
halos · no missing pixels · gold pile clean · static composition beautiful.

Playing: body breathes · hand moves naturally · grape follows hand · eating
interaction reads · subtle face/idle movement · gold moves subtly · aura subtle ·
particles subtle · gloss slow.

**If the only noticeable movement is the gloss or the glow, character animation
has failed.**

## 24. Performance

Prefer transform, opacity, compositor-friendly animation and efficient layered
assets. Avoid continuous expensive filters, excessive particles, unnecessary DOM
nodes, layout-triggering animation, repeated decoding and oversized assets.

## 25. Reduced motion

Stop hand, breathing, particles, gloss and aura motion; keep the **full static
character**. The premium experience must still look good without motion.

## 26. Responsive

Desktop, tablet, mobile, narrow cards, long and short usernames. The character
may scale and reposition, but is never reduced to an unrecognisable blob.

## 27. Do not cheat

Moving, scaling, rotating or pulsing the whole PNG, adding a glow, moving a gloss
and adding particles are **environmental** animations, not character animation.
At minimum the hand, the grapes and the breathing must be independently animated.

## 28. Iteration

Freeze → high-res master → separate layers → reconstruct hidden areas →
recompose static → compare with the original → fix every seam → breathing →
hand/grape → face/idle → environment → aura → particles → gloss → card →
identity layout → duplicate check → real browser → actual size → 2x → paused →
running → reduced motion → mobile → desktop → fix defects → repeat inspection →
only then report.

## 29. Acceptance

Not done because code compiles, tests pass, an image exists, or the card has
gold and glow. Done only when every item below holds, **verified in a real
browser**:

high-resolution source · face sharp · hand sharp · grapes sharp · gold detailed ·
clean layers · no ripped-photo hand · no segmentation seams · hidden areas
reconstructed · static recomposition matches · body genuinely breathes · hand
genuinely moves · grape follows hand · eating interaction reads · environment
moves subtly · gloss slow · no circular vignette · renders once · scoped to the
card · does not affect page flow · username/tier/state/date/avatar aligned · no
layout shifts · reduced motion · mobile · desktop · acceptable performance ·
actual browser inspection performed.

## 30. The standard

Not "an AI-generated golden Buddha image", not "a static picture with animation
effects", not "a PNG moving around inside a card". It is a tiny living luxury
fantasy character belonging to the user's premium identity: relaxed, lounging in
wealth, casually eating grapes, breathing, moving naturally, ringed by restrained
luxury effects, integrated beautifully into the card. The character feels
**alive**; the card feels **designed**; the animation feels **intentional**; the
artwork stays **clean** at its largest intended size.

Visual problems are not solved by more effects. The asset, the layering, the
composition and the animation get fixed.
