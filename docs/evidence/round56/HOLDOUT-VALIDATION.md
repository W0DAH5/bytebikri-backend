# Hold-out validation — and it fails

**Verdict: the proposed reconstruction path does NOT faithfully recover the
master's artwork. Stop here, as the brief instructs, and identify what cannot be
recovered.**

The rig is frozen: nothing in this phase touched `GROUP`, `CLUSTER`, the masks,
the mesh, the deformation, the animation range, the CSS or the layers. The
pipeline file `buddha-rig-art.py` was **not edited** — this harness lifts its
functions out of the source and repairs its numerical defect in the lifted copy
only. Rig assets verified byte-identical to `0046bfc` after every run.

## 1. The `RuntimeWarning` — diagnosed and fixed in the validation computation

`RuntimeWarning: overflow encountered in add` came from the membrane solver's
Jacobi update, and it was **silent memory corruption, not an overflow**:

* `_shift()` allocates with `np.empty_like(a)` and then replicates at one edge per
  axis — but for either sign of an offset the edge it writes is the one it *has
  already written*, so exactly one row (or column) per axis keeps whatever the
  allocator left in it.
* Found by `np.seterr(over="raise")` plus a real traceback: at level 8 of the
  cascade, sweep 0, `c` was finite everywhere and all four neighbours were finite
  (246.70, 246.70, 253.27, 241.12) — yet their sum was not. One operand had never
  been written.
* Proven by poisoning every `np.empty_like` allocation with NaN: the pipeline's own
  `_shift(a, -1, 0)` returns **8 non-finite cells out of 64**.
* My first repair fixed only the negative-offset edge and the poison test still
  passed — because the leftover NaN happened not to fall inside the solver's
  update mask on that run. The repaired version fills **both** edges, and the test
  now sweeps every offset in `[-3, 3]²` and runs the whole solver and the fill
  under poisoning: **0 non-finite pixels**.

The numbers before and after the fix are identical. That is the finding, not a
comfort: the garbage was inhaled silently, so "it ran without warning" was never
evidence of anything. The same latent defect is live in `buddha-rig-art.py`, where
it can put nondeterministic values into the shipped plate. **Recorded; not fixed
there, because this phase may not change the pipeline.**

## 2. The hold-out, at 1× / 2× / 4×

Six regions of artwork the master *shows* were hidden and rebuilt by the exact
pipeline path (`docs/evidence/round56/65-holdout-4x.png`, `65-holdout.json`).
Texture is mean |gradient| over the region — the artwork's own visual frequency —
and contrast is luminance standard deviation.

| hidden region | mean \|err\| | p90 | max | texture master → recon | contrast master → recon |
|---|---|---|---|---|---|
| robe fold (creases) | 5.65 | 12 | 93 | 8.67 → 8.49 (**0.98×**) | 33.4 → 32.8 |
| belly (smooth gradient) | 15.81 | 39 | 176 | 18.87 → 15.66 (**0.83×**) | 54.6 → 48.9 |
| necklace (bead specular) | 15.78 | 40 | 194 | 19.71 → 16.10 (**0.82×**) | 50.3 → 45.0 |
| chest highlight | 15.09 | 35 | 141 | 29.19 → 26.32 (**0.90×**) | 60.4 → 58.2 |
| drape (dark fold) | 13.77 | 34 | 178 | 26.18 → 24.68 (**0.94×**) | 72.9 → 70.5 |
| coin pile (engraved texture) | 21.14 | 51 | 172 | 33.06 → 23.33 (**0.71×**) | 58.4 → 53.5 |

Every region loses texture. Nothing gains it. A method that produces a seamless
patch but a *flatter* patch has changed the master's visual language, which the
brief says to reject.

## 3. What the 4× sheet shows, structure by structure

Reading `65-holdout-4x.png` (MASTER | RECONSTRUCTED | |difference|×4):

1. **Smooth gradients and specular falloff — CANNOT be recovered.** The belly's
   dark-to-bright roll is rebuilt as a bright blotch with the bead chain's ghost
   in it: the fill found no smooth equivalent to copy and copied structure from
   elsewhere. The chest highlight's continuous sheen becomes a dithered streak.
   This is the artefact class the brief calls a change of visual language.
2. **Repeated structured motifs — CANNOT be recovered.** The necklace's beads come
   back merged and melted; the individual specular dots on each bead are gone. A
   repeated motif needs its period and its highlight position preserved, and
   patch-copying has neither.
3. **Fold edges and their direction — CANNOT be recovered.** The drape's fold is
   rebuilt with a hard diagonal band and a bright patch that the master does not
   have: the copied patches carry edges from other folds, pointing the wrong way.
4. **Fine engraved texture — CANNOT be recovered.** The coin pile's arabesque is
   replaced by noise; texture energy drops to 0.71×.
5. **Busy, texture-rich gold — PARTIALLY recovered, and not good enough.** The robe
   fold keeps 0.98× of its texture energy (mean error 5.65 against a local contrast
   of 8.67) — the best case in the set — yet the difference map still shows fold
   edges in the wrong place. It survives a glance at production size; it does not
   survive 4×, and the brief asks for 4×.

## 4. Why this matters for the actual task

The regions the gesture actually exposes and the master *determines* are the
**chest, chin and neck** — smooth skin, and therefore the failing case #1. The
undetermined band (shoulder root, robe/drape) was already flagged for a painted
keyform in the previous phase. So:

| what the gesture exposes | class | can this method recover it? |
|---|---|---|
| chin / neck (1,771 px) | determined, smooth skin | **no** — case #1, the hold-out's worst |
| chest (956 px) | determined, smooth skin | **no** — same |
| shoulder root (2,833 px) | 68% undetermined | no — flagged for a painter |
| robe / drape (2,834 px) | 68% undetermined | no — flagged for a painter |
| hand / grape openings (5,923 px) | sky determined | nothing to paint — the page belongs |
| necklace | not exposed at all | nothing to do |

**Nothing in the exposed set can be faithfully reconstructed by the current
path.** No amount of tuning the fill changes this: the failure is not the patch
size or the search radius, it is that patch-copying cannot continue a gradient or
a fold direction.

## 5. What a passing method would require (for decision, not implementation)

- **Smooth skin and sheen** need a boundary-conditioned continuation of the
  master's own gradient — the unique smooth surface matching the hole's edge —
  rather than copied patches. That is a diffusion-type solve, which the brief
  forbids, so **it needs an explicit decision** before I do it.
- **Fold edges and their direction** need explicit structure continuation (the
  edge's line carried across the hole), which is synthesis, and therefore also
  forbidden without a decision.
- **Repeated motifs and engraved texture** should be left alone: a painter.
- Everything the master truly does not determine (the 12,444 px undetermined band)
  is already flagged: **painted corrective artwork / keyform.**

My recommendation, in the brief's own terms: the determined smooth regions are a
small area (2,727 px total across chest, chin and neck) and a painter can finish
them in the master's own language in less time than any scheme I could defend as
"not invention". The reconstruction path as it stands should not be applied to the
exposed regions.

## 6. Status

- Rig frozen, verified; nothing in the rig, masks, animation or CSS changed.
- The pipeline's own `_shift` defect is recorded with a proven diagnosis and a
  patch ready — **not applied**, pending a decision that it may be.
- The hold-out harness is committed as `app/scripts/holdout-validation.py` and is
  reusable for any future method so the comparison is like-for-like.
- **The reconstruction has NOT passed visual inspection. No production wiring.**

---

## Update — the five named comparisons (`66-*`)

The warning resolution is now proven, not asserted: the harness runs clean under
`python -W error::RuntimeWarning` (strict mode, warnings as errors). The poison
test sweeps every offset in [−3, 3]² and runs solver and fill under a NaN heap:
0 non-finite pixels.

### How exposed is the pipeline's own `_shift`?

Measured on the masks the pipeline actually solves (poison every `np.empty_like`
with NaN, or with 1e30, and compare against the clean heap):

* luminance membrane over the real `reconstructed-mask.png` (28,227 px): **0 px
  differ** under NaN poisoning — the unwritten cells never reach the update mask;
* the **silhouette membrane** (body/sky behind the 58,952 px limb footprint) is a
  different story: its mask touches the cascade border at level 32 (48×32 grid),
  which is exactly where `_shift` leaves memory unwritten. Under NaN, **58,786
  cells come back NaN — unclassifiable, and `>0.5` silently reads every one as
  background (46,877 px of hidden body unpainted)**. Under 1e30 garbage, **11,909
  px flip** body/sky against the clean run.

So the plate's body/sky answer *can* depend on what the allocator last held there.
The committed plate happened to be produced by a clean heap. The repair patch
stays ready and unapplied (pipeline frozen this phase).

### The hold-out against the five named comparisons

Same six hidden regions, same lifted pipeline path (`66-holdout-metrics.json`,
`66-holdout-2x.png`, `66-holdout-4x.png`, `66-boundary-profiles.png`):

| region | fold creases (px) | gradient err (mean/max) | specular px (99.5th) | high-freq texture | seam band |
|---|---|---|---|---|---|
| robe fold | 784 → 853 | 1.70 / 10.0 | 50 → 56 | 10.14 → 10.42 | 0.00 → 0.00 |
| belly | 784 → 400 | 3.49 / 11.0 | **51 → 8** | 21.27 → 19.22 | 0.00 → 0.00 |
| necklace | 784 → 346 | 4.05 / 12.0 | 50 → 48 | 22.53 → 20.05 | 0.00 → 0.00 |
| chest highlight | 784 → 627 | 2.16 / 10.0 | **50 → 4** | 34.27 → 32.55 | 0.00 → 0.00 |
| drape (dark fold) | 784 → 676 | 2.17 / 10.0 | 57 → 31 | 32.25 → 31.93 | 0.00 → 0.00 |
| coin pile | 784 → 297 | 2.62 / 13.0 | 50 → 23 | 40.20 → **30.07 (−25%)** | 0.00 → 0.00 |

Reading that against the brief's five:

1. **Folds** — crease pixels roughly halve on smooth regions and drop 62% on the
   coin pile; where they survive they are frequently in the wrong place (the
   difference maps show displaced fold edges on every region).
2. **Gradients** — the low-frequency shading is roughly right (mean error 1.7–4.1
   on a 0–255 field). This is the harmonic guide working. It is the *only* pass.
3. **Highlights** — specular peaks collapse where the surface is smooth: belly
   51 → 8 px, chest 50 → 4 px, drape 57 → 31, coin 50 → 23. The sheen is the
   artwork's strongest light cue and it is mostly gone.
4. **Texture frequency** — high-frequency energy drops everywhere (−25% worst);
   never rises. A flatter patch is a different visual language.
5. **Boundary transitions** — the seam band's Laplacian is 0.00 on both sides
   everywhere: **the seam is invisible. The failure is entirely interior
   content**, which is exactly the failure mode the brief warns about — do not
   judge this method by its seam.

### Structures that cannot be faithfully recovered from the master by this path

* **Smooth shading with its specular roll** (belly, chest, chin, neck) — the fill
  has no smooth exemplar to copy, so it imports structure: the 4× sheet shows the
  bead chain's ghost melted into the belly's gradient.
* **Specular highlights** — collapse 2× to 12× in pixel count.
* **Repeated structured motifs** (bead chain) — period and per-bead specular are
  not preserved; beads merge.
* **Fold edges and their direction** (drape) — copied patches carry edges from
  other folds, pointing the wrong way.
* **Fine engraved texture** (coin arabesque) — replaced by noise (−25% high-freq).

Only **busy textured gold** (robe fold) survives a glance, and even there the 4×
difference shows fold edges landing in the wrong place.

### Consequence for the exposed set (unchanged, now doubly evidenced)

The exposed regions the master *determines* are chest, chin and neck — smooth
skin with specular falloff, i.e. the worst failing class. The undetermined band
is already flagged for painted corrective artwork. **Nothing in the exposed set
can be faithfully recovered by the current path. No production wiring.**

`66-holdout-metrics.json` · `66-holdout-2x.png` · `66-holdout-4x.png` ·
`66-boundary-profiles.png` (luminance scanlines across the boundary: blue master
vs pink reconstruction).
