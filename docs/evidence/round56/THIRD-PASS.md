# Third pass — the light, and a bug the rest pose had been carrying

This pass answers the one criterion the second pass left open. It also found and
removed a defect that had been in the plate since the first pass and that every
rest-diff sheet had been drawing without anybody naming it.

**The gate is now closed on all eight criteria.** Production animation is still
not wired — that is a separate decision from the gate, and the keyforms are still
placeholders.

---

## 1. Criterion 6, and how it was measured rather than eyeballed

"Extending the drawing's gold into a hole" and "matching the drawing's light
across that hole" are different jobs, and the exemplar fill only did the first:
it ranked candidate patches by texture, so a patch of the right folds at the
wrong brightness could be selected, and any patch that arrived carried its own
lighting against its neighbours' — a step at the seam.

Two standard clean-plate finishing steps, both of them *matching* rather than
*hiding*:

* **The fill is steered by the drawing's own light.** The illumination around the
  hole is extended into it with a harmonic field (a Laplace membrane, solved on a
  coarse grid because illumination is low frequency), and each candidate patch is
  scored on texture *plus* a small penalty for sitting at the wrong brightness.
  Texture still chooses; the light breaks ties and steers. `--no-guide` disables
  it, so its effect can be measured rather than assumed.
* **The seam is matched afterwards** with an exact full-resolution membrane over
  the reconstructed region, seeded by a coarse solve. This is not a blur: it
  moves only low frequency, so the detail the fill copied survives. Measured both
  ways to prove it.

| measure | before | after |
|---|---|---|
| seam step (mean \|pixel − known neighbours\| along the seam) | **22.73** levels | **0.45** levels — 98 % removed |
| the drawing's own local contrast, just outside the reconstruction | 8.05 levels (the control: what this picture's edges normally look like) | — |
| mean \|dL/dx\| inside the reconstruction (is it still textured?) | 11.05 | **10.89** — a blur would flatten it |
| the correction's own size | mean 7.87, max 140 levels, 636 px over 30 | recorded, not hidden |

A seam of 0.45 levels sits well *below* the drawing's own 8.05, i.e. below the
level at which this artwork's surfaces vary anyway. All of it is in
`rig/regions.json` under `light`.

---

## 2. The defect the rest pose had been carrying

The plate was allowed to replace the drawing **outside the arm layer** — under
which, at rest, the plate is on screen and the drawing's own visible artwork
should be. Two clauses were wrong in ways that only a measurement made obvious:

| what was wrong | what it cost | what it is now |
|---|---|---|
| `REAL` did not require the pixel to be **hidden by the limb**, so the arm-down state's chest and socket pixels were stamped where the drawing already showed its own | 1,105 px differing by >32 levels at rest | the plate is the master outside the arm layer, **pixel for pixel** — asserted in the script, so it cannot silently stop being true |
| the plate's alpha was forced to 1.0 inside the figure (`A_base > 0.05`), turning the whole antialiased boundary ring fully opaque | 1,109 px outside the drawing's silhouette, some pure white — a light rim on a dark card | the plate's alpha **is the master's**, except where the arm-down state really supplies pixels |
| the fill region was the limb's whole *travel*, so at +6° it overwrote the **head** and the pile | the grey speckle every rest-diff sheet had been showing | reconstruction happens only under the limb's own footprint; `regions.json` records robe and pile at **0 generated px** |

**The rest pose, against the artwork:**

| measure | first pass | second pass | now |
|---|---|---|---|
| pixels differing by >32, on the figure | 3,395 of 198,270 (1.71 %) | 3,395 (1.71 %) | **203 of 198,270 (0.10 %)** |
| p99 difference | 57.0 | 57.0 | **2.0** |
| mean difference | 2.041 | 2.041 | **0.197** |

The remaining 203 px are the limb's own antialiased outline — one pixel wide,
where a hard edge meets a resample — and `07-rest-diff.png` now shows only that
outline and nothing else.

Reconstructed area also fell, because it is now the region that is genuinely
hidden: **10,992 px** (was 13,739) — necklace 7,753, back of the elbow 5,522,
chest 1,871, socket 1,392, robe 0, pile 0.

---

## 3. The eight criteria, re-checked

| # | criterion | verdict | evidence |
|---|---|---|---|
| 1 | no shoulder gap | clear | 0 uncovered px @4× in all four poses |
| 2 | no ripped cutout edge | clear | outline ramp median 1.70–2.07 px, p95 ≤ 2.86 |
| 3 | no collapsing arm | clear | width 0.99–1.00× rest; 0 of 253 tris over 1.25× area |
| 4 | no necklace discontinuity | clear | continuous in every pose; seam step 0.45 vs the drawing's own 8.05 |
| 5 | no impossible elbow | clear | 5.2° of the 22° the drawing allows; hand lands 8.0 px off the rigid swing |
| 6 | no lighting discontinuity | **clear** | seam step 22.73 → 0.45; correction mean 7.87 levels; detail preserved 11.05 → 10.89 |
| 7 | no exposed missing pixels | clear | 0 uncovered px @4× at 0 / −15 / −7 / +6° |
| 8 | no gold texture tearing | clear | gradient energy 17.9–20.6 around the rest 19.5; 0 inverted triangles |

**What is still true, and what is not claimed:**

* The reconstruction is still **generated, not painted**. It is the drawing's own
  pixels, chosen and light-matched by software. The brief's rule stands: label it,
  and do not call it final. `05-review-map.png` marks every one of the 10,992 px
  in red, `regions.json` counts them by region, and the correction that touched
  them is drawn in `05-seam-correction.png`.
* The corrective keyforms are still placeholders (`"correction": null,
  "placeholder": true` in the rig data), and `elbow_share_of_shoulder` is still a
  chosen constant rather than an authored curve.
* The contact shadow is still derived from the limb's silhouette and marked as
  such — the first thing a painter should replace.
* No production animation is wired.

---

## 4. Sheets

| file | what it shows |
|---|---|
| `07-rest-diff.png` | rest pose minus the artwork — now only the limb's own outline |
| `09-plate-light-before-after.png` | the plate before and after this pass, against the drawing |
| `05-seam-correction.png` | the correction field that matched the seam, drawn |
| `05-review-map.png` | green = the drawing's or arm-down state's own pixels; red = reconstructed |
| `07-joint-review.png` | the gate sheet: shoulder+elbow, chest+necklace, drawing vs all four poses |
