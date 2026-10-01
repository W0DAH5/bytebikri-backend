# Painter brief — corrective artwork for the exposed set

**For a human painter.** This package contains everything needed to paint the
pixels the intended gesture exposes and the master cannot supply. The machine
reconstruction path was hold-out-validated and **failed** (see
`../HOLDOUT-VALIDATION.md`): patch-copying cannot continue a gradient, a fold
direction or a specular roll. Per the artwork brief §7 these pixels are therefore
**painted, not invented by a machine**.

The goal this serves:

```
MASTER + faithful hidden artwork + existing hybrid rig = continuous animated character
```

## The one rule

**The master (`app/public/img/cosmetics/mascot-gold-buddha-base.png`) is the sole
reference.** Paint in its language: its gold, its shadow colours, its edge
sharpness, its texture frequency. No blur, no feather, no glow, no softening
stamp — the master's own edges are hard and its shading is smooth airbrush-free
gradients. Where this file and the master disagree, the master wins.

## What is in this package

| file | what it is |
|---|---|
| `00-overview.png` | the whole figure at 1×: **amber** = paint, **blue** = the page belongs (leave transparent), numbers = region ids |
| `R01..R05-template.png` | one per region: the master crop with the hole **cut out (transparent)** and the hole's edge outlined in amber; paint inside the hole |
| `R01..R05-reference-2x.png` | the same surround at 2×, hole dimmed with an amber edge — the fidelity reference: every fold, gradient and highlight to continue is visible here |
| `manifest.json` → `ramp_master_measured` | each region's measured 5-stop luminance ramp sampled from the rim (shadow → highlight), e.g. R01: 39 → 77 → 107 → 184 → 249 |
| `R01..R05-mask.npy` | full-frame boolean masks (1536×1024), `True` = pixel to paint |
| `manifest.json` | per-region sizes, bboxes, per-pose exposure, rim colours, anchors |
| `SKY-page-belongs.npy` | 2,350 px where the master's own silhouette field says **sky continues** — nothing is painted; the page shows through |
| `BODY-determined.npy` | 4,319 px where the master *does* determine skin — paint these to continue the neighbouring shading exactly (they are inside the regions) |
| `scripts/` | the exact build provenance (see provenance note at the end) |
| `pre-paint-defects.json` | what the interim plate holds inside each region today: gold copies, baked pattern, and 7,993 px of pure void — counted per pose |
| `PROPOSAL-region6*.json/png`, `PROPOSAL-P6-*-mask.npy` | **a proposal, not scope**: ~5,848 page-blend px outside the regions; painting them would change the shipped rest look, so they wait for a decision |

## The regions

| id | px | bbox (x,y) | opens when | what surrounds it (mean RGB of the hole's rim) |
|---|---|---|---|---|
| **R01** | 15,580 | 663,14 – 836,288 | every arm keyform; worst at −15° (6,115 px) plus grape sway | bright sky/arm gold above (252,236,185), deep occlusion shadow against the face right (106,49,8), lit gold left (251,228,160), dark gold below (167,106,17) |
| **R02** | 2,724 | 483,121 – 544,302 | arm swing, esp. +6° and −15° | bright gold above (251,231,171), shadowed gap left (183,149,85), lit arm right (252,236,170) |
| **R03** | 347 | 665,76 – 684,95 | grape sway only (±26 px) | dark gold all round (148–231, 88–152, 1–14) — a shadow lens between stem, wrist and face |
| **R04** | 302 | 604,43 – 631,76 | all arm keyforms (~24 px each) | uniformly bright gold (245–251, 219–236, 134–194) — continuation of lit forearm skin |
| **R05** | 45 | 823,136 – 831,148 | margin sliver near the face edge (never directly opened) | very bright gold (229–253, 217–251, 165–217) |

Region-by-region painting notes:

- **A third defect the paint should normalise where it crosses it:** the
  master's own crevices (grape-bunch gaps, the vine/wrist/face passage) contain
  pale page-blend pixels — page pattern baked into the master (or alpha-edge
  noise; the master cannot tell us which). Faint at rest, amplified by the mesh
  stretch in motion (`../68-master-checker-defect.png`,
  `master-checker-inventory.json`). 433 px of it fall inside the regions: paint
  gold there, not pale page.
- **R01 — the main reveal.** A tall crescent behind the raised forearm, the hand
  and the fruit bunch, from the top of the frame down to the cheek. What it must
  become, top to bottom: **sky** (nothing — see the blue arc in `00-overview`:
  2,350 px package-wide, 0 inside R01's own components but hugging its upper rim),
  then the **occlusion shadow** where limb meets face — the darkest passage in
  the figure (rim RGB 106,49,8) — then, in the lower third, **4,203 px of
  determined skin**: the chest's and chin's own gradient continuing, with the
  master's specular roll (bright band along the cheek/jaw). Follow the shadow's
  core as it narrows downward, exactly as the existing shadow does where the arm
  crosses the chest at rest.
- **R02 — the arm's trailing seam.** The sliver behind the upper arm's back edge.
  Almost entirely undetermined (2,635 of 2,724 px): the master never showed
  behind this arm. Continue the **dark gap shadow** (left rim 183,149,85) upward
  along the arm's back edge with the same softness the existing gap has, and keep
  the arm's own back-edge highlight crisp (right rim 252,236,170).
- **R03 — shadow lens.** A small dark lens between stem, wrist and cheek, visible
  only during the grape sway. Paint the shadow's continuation; both rims are dark
  gold; no highlights anywhere near (0 spec px on a 368 px rim).
- **R04 — lit skin continuation.** A small lens on the forearm's bright side,
  19 px of it determined skin. Continue the bright gradient; nothing dramatic
  lives here (rim max luminance 248, no strong edges).
- **R05 — margin sliver.** 45 px of growth margin near the face edge, never
  directly opened. Bright gold continuation; trivial but not skippable — a 45 px
  gold-less slit reads as a crack at −15°.

## The five comparisons the paint must pass

These are the same tests the machine path failed; the paint is judged by them
(inspected at 1×, 2× and 4× across REST, −3°, −7°, −15°):

1. **Folds** — any fold edge entering the hole continues with the same direction
   and sharpness, never a copied edge at a foreign angle.
2. **Gradients** — the shading's low-frequency shape matches the hole's rim on
   all sides (the anchors above are the rim means; the painter's eye is better).
3. **Highlights** — a specular band that leaves the hole returns with its width
   and brightness preserved; never flattened.
4. **Texture frequency** — the painted gold carries the same high-frequency
   energy as its surround (the master's gold has visible grain at 2×; a smooth
   patch reads as plastic).
5. **Boundary transitions** — no seam: the step across the hole's edge must be
   invisible at 4× (the failed machine path already proved the seam is the easy
   part — the interior is what fails).

## Delivery and acceptance

- Deliver each region as a **full-size PNG the same dimensions as its template,
  same offset** (recorded per region in `manifest.json` as `template_offset`),
  with **every non-hole pixel identical to the MASTER's** (the template is a
  viewing aid; its amber outline is guidance, not content to reproduce).
  Every hole pixel must be **painted, fully opaque**. (The `SKY-page-belongs`
  arcs — blue in `00-overview.png` — sit just OUTSIDE the region components;
  leave anything blue untouched.) Do not reproduce the master's baked
  checkerboard anywhere: the acceptance renders ground the page in magenta, and
  a painted checker square reads as a hole in the figure. The interim plate's
  guesses visibly contain copied checkerboard — that is one of the defects the
  paint replaces. The acceptance harness
  (`app/scripts/keyform-acceptance.py --paint <dir>`) enforces all of this.
- Acceptance composites the paint into the master, re-renders the four poses
  through the frozen rig, and compares: composed REST must equal the master
  exactly outside the holes; each pose is inspected at 1×/2×/4× for the five
  comparisons. Nothing about the rig, masks, deformation, animation range, CSS
  or layer structure changes.

## Numbers the paint replaces

The committed clean-plate currently **guesses on 11,007 of these 19,000 px**
(interim copies from the pipeline's exemplar fill). It is already correctly
transparent on 2,304 of the 2,350 sky px (98.0%). The painted keyform replaces
the guesses; the rig is not touched.

## Provenance

Built at `4b0b69b` with the pipeline's own rotation machinery (lifted, pipeline
unedited) and the **fixed** membrane solver (the `_shift` repair from
`app/scripts/holdout-validation.py`). The exposure construction reproduces the
recorded artwork brief **exactly**: raw 12,893 vs 12,892 (1 px threshold),
grown 21,350 exact, plate-opaque 11,053 exact, membrane residual 0.0030 as
recorded. The recorded per-class pixel counts (3,389/5,517/12,444) came from the
pre-fix solver run and are **not reproducible bit-for-bit** (its mask touched the
cascade border where the `_shift` defect left allocator garbage); this package's
classes use the fixed solver with the stated rule `field ≤ 0.2 sky / ≥ 0.8 body /
else undetermined` — every recorded flag bbox is reproduced within 1 px
(`manifest.json` `cross_ref`).
