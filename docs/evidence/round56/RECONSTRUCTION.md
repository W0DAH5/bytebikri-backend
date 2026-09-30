# The reconstructed artwork — what the gesture needs, and how it was measured

The rig is accepted. What follows is the artwork: the pixels the raised arm is
hiding, reconstructed from the master's own drawing, and the evidence that they
read correctly once the arm is out of the way.

Everything here is built from `mascot-gold-buddha-base.png` and nothing else.

## 1. What the intended gesture exposes

`@keyframes buddha-reach` runs the arm from 0° to −15° and holds it, passing
through +6° on the way in; `@keyframes buddha-grapes` sways the fruit ±5° about
its stem independently. The arm turns about the shoulder (`.mascot-arm` origin
`34.90% 28.52%` ≈ (536,292) master px), the fruit about (740,90).

The exposed set is the union, over those poses and both signs of every angle, of
the limb pixels no pose covers, grown 6 px for the mesh — which bends rather
than turning rigidly:

| | px |
|---|---|
| the limb (arm + hand + fruit) at rest | 58,952 |
| exposed by the intended gesture | 36,762 |

The both-signs union is deliberate: the keyframes genuinely pass through +6°, so
both directions are part of the intended motion, and taking both makes the set
independent of the rotation convention.

## 2. What is behind it — answered from the master, not from a render

`part-plate-armless.webp` was the old answer. It is written by
`scene-parts.py`: a derived render, which the brief bars as a source, and its
own doctrine block had already recorded why it cannot answer this question — it
is a different pose, not a photograph of what the arm hid. Measured, it is worse
than unhelpful: it is transparent exactly where the **lowered** arm hung, which
is where the **raised** arm attaches, so it called the shoulder root background.

The rule now: the master's silhouette is a contour, and what was hidden is what
continues it. The alpha is extended across the limb's footprint as a membrane —
the master's own visible pixels as Dirichlet data, solved inward — and its 0.5
level decides body-or-page per pixel.

| | px |
|---|---|
| hidden body behind the limb | 48,655 |
| hidden page behind the limb | 10,297 |
| of the exposed 36,762: body → painted | 28,227 |
| of the exposed 36,762: page → stays transparent | 8,535 |

## 3. Three defects found by looking at the revealed pose

1. **The membrane was a film, not a field.** The solver stopped when the largest
   change per sweep fell below a tolerance. Jacobi carries information one cell
   per sweep, so an unfinished field changes very little per sweep — the test
   fired before the field had travelled, and the interior kept its seed.
   Measured: 0.85 two pixels from an open sky edge that must be 0. Replaced with
   a cascade (32→16→8→4→2→1, each level seeded by the one above); the residual
   is reported, 0.0030 levels. Pixels of hidden body lying within 2 px of open
   sky: **3,008 → 299**.

2. **A stale gold sliver along the arm's own edge.** The master's silhouette is
   antialiased and runs 1–2 px wider than the drawn separation, so those rim
   pixels sat in the plate — the arm's *own* edge, left behind when the arm
   moved, as a beaded chain of specks floating in the sky. Wherever the limb
   meets the page the figure's rim now joins the limb (545 px). The layers copy
   the master's pixels, so the resting pose cannot change; the arm simply
   carries its own antialiased edge when it moves.

3. **A scalloped silhouette.** `up()` resampled the 768 separation with LANCZOS.
   At an exact 2× upscale Lanczos rings, and the ring lands on a two-pixel
   period along the mask's edge; rotated, the arm came out beaded. Bilinear is
   the exact interpolation between the drawn samples: the edge stays smooth and
   its position does not move.

## 4. A dead end, recorded so it is not repeated

Masking the exemplar fill's SSD to already-painted pixels is the textbook
formulation — the unfilled pixels still hold the master's own limb, so including
them matches the hole against the ghost of what used to cover it. Implemented
with patch 9 and with patch 7, both are measurably worse: the copied detail
rises from 8.3 to 18.0–19.6 against the master's own local contrast of 4.67,
i.e. the fill starts copying hard edges into smooth gold, visible as a dithered
texture at 2×. `56-fill-compared.png` is the comparison. The unmasked SSD's
reference includes the limb's pixels and that is exactly what keeps the fill
smooth and continuous with its surroundings. Reverted.

## 5. Inspection

- `53-reconstruction-inspection.png` — production 172 px, 1×, 2×; the master,
  −15° and +6°.
- `54-reconstructed-artwork.png` — the plate with the limb removed: one
  continuous figure, the shoulder, chest and drape continuing, the page showing
  only where the page belongs.
- `55-edge-after.png` — the arm's edge at 3× before and after the rim fix.
- `52-revealed-diagnosis.png` — every pixel the revealed pose shows, coloured by
  whether the plate carries art or the page.

At production size the three states are indistinguishable in quality. At 1× the
revealed gold continues the master's structures and no stale gold remains. At 2×
the fill is read as interim: it is smooth and correctly lit, but its patchwork is
visible under magnification.

Gate A: PASS. The resting composite remains the master exactly.

## 6. Open

- the fill's texture at 2× — the reconstruction is a copy of the master's own
  drawing but not yet a painter's continuation of its structure;
- the stem and fist fringing where the fruit sways;
- no production wiring until the artwork passes inspection.
