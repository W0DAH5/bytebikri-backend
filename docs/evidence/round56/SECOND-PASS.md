# Second pass — the elbow, and the eight criteria

The first pass (`FIRST-PASS.md`) built the hybrid rig and named its own gap:
**"the elbow is rigid because there is no elbow bone yet."** This pass adds the
bone, re-measures everything, and answers the eight criteria the brief sets
before any production animation may be wired.

Nothing here is a new drawing. The Buddha is the same artwork: every asset is
derived from `mascot-gold-buddha-base.webp`, and the rest pose is still checked
against that master, never against a render.

---

## 1. What changed

**The elbow exists now, and it is where the drawing put it.** The limb's
centreline was measured (centroid of the limb's own pixels in rings about the
glenoid); it turns fastest at **r = 54–66 art px**, so the elbow is at
**(300.5, 94.6)**, `|pivot→elbow| = 60.8`, `|elbow→fist| = 87.6`.

Its rest angle is **157.6° interior** — the drawn arm is ~22° off straight. That
is the entire budget for this joint: bending it 40° would be inventing an elbow
the picture never had. The forearm's driver is therefore a fraction of the
shoulder's turn (`elbow_share_of_shoulder = −0.35`, i.e. **5.2° at −15°**), and
the rig data keeps the two numbers side by side so a runtime cannot confuse them.

The chain is now `shoulder → upperArm (60.8) → forearm (87.6) → hand`, and it is
in the rig data as bones, not as constants in a script:

```
buddha-rig.json  bones: shoulder · upperArm · forearm (rest interior 157.6°) · hand
                 elbow_art_px (300.5, 94.6)   elbow_share_of_shoulder −0.35
                 arm_mesh: 195 v / 253 tris + weights_arm + weights_forearm
                 torso_mesh: 54 v / 80 tris  + weights_arm
                 keyforms: −15° (−5.25 elbow) · −7° (−2.45) · +6° (+2.10)
                 draw_order: plate → shadow → arm → grapes
```

The forearm weight is a smoothstep band centred on the elbow, measured **along
the forearm's own axis**, so the surface bends across the joint instead of
hinging on it. The grapes ride the hand through the whole chain, so the fruit
cannot drift out of the fist when the forearm moves.

**The full keyform, as data:** shoulder −15° → elbow −5.25°; −7° → −2.45°;
+6° → +2.10°. All are inside the drawn budget.

---

## 2. Engineering review — does the deformation hold?

`rig-qa.py` (numbers), `06-mesh-wireframe.png` (the mesh and its weights),
`07-elbow-closeup.png` (the joint at 4×).

| pose | limb width | triangle area med / p99 | triangles > 1.25× | gradient energy | inverted tris |
|---|---|---|---|---|---|
| rest | — | 1.00 / 1.00 | 0 of 253 | 19.5 | 0 |
| −7° | 0.99 – 1.00× | 1.00 / 1.03 | 0 of 253 | 20.0 | 0 |
| −15° | 0.99 – 1.00× | 1.00 / 1.06 | 0 of 253 | 17.9 | 0 |
| +6° | 0.99 – 1.00× | 1.00 / 1.04 | 0 of 253 | 20.6 | 0 |

* **Width** is now measured per **station along the bone chain** (12 px bands),
  compared with the same station at rest. The first pass binned vertices by
  radius about the pivot, which is wrong the moment there are two bones: the
  forearm's vertices leave the bin they started in, so the metric compares one
  part of the arm with another. Stations do not have that problem.
* **Area** per triangle: 1.00 median, no triangle over 1.25× anywhere. A
  stretched triangle is a stretch the drawing did not have.
* **The hand lags, measurably.** At −15° the chained hand sits at (348.0, 26.0)
  against (342.1, 20.6) for a rigid swing: **8.0 px off**, and it travels 30.5 px
  where the board-like version travels 38.0. At −7° the offset is 3.8 px, at +6°
  3.2 px. A joint that changed nothing would leave exactly 0 here; a joint doing
  too much would leave the mesh folding, which the area numbers rule out.
* **Gradient energy** inside the limb stays in a 17.9–20.6 band around the rest
  value 19.5: tearing multiplies it, smearing flattens it, neither happens.
  (−15° reads slightly *lower* because a longer corner of the limb is resampled,
  and resampling softens — it is not a tear.)

**Two bugs were found in the QA tooling itself and fixed, because a measurement
that flatters or slanders the rig is worse than none:**

1. `rig-qa.py` composed the elbow's rotation about the *shoulder* instead of
   about the elbow. That made the forearm swing about a point 300 px away and
   reported p99 area changes of 2.17 with 46 triangles over 1.25×. The real rig
   does not do that. Fixed to rotate about the elbow, exactly as
   `rig-buddha.py` skins; the numbers above are the fixed ones.
2. The width metric above (pivot-radius bins → bone stations).

---

## 3. Artwork review — does it look like the drawing?

`07-joint-review.png` is the sheet for this: two windows — **shoulder + elbow**
and **chest + necklace under the arm** — each shown as the drawing next to every
pose, at 2× the canvas.

| what to look at | what is there |
|---|---|
| shoulder socket, all poses | closes by deformation; no patch, no collar piece, no gap |
| the elbow at −15° | the arm bends as one piece; the hand lands **8.0 px** from where a rigid swing would put it (3.8 px at −7°, 3.2 px at +6°) |
| the cut edge against the background | ~2 px, the same as the drawing's own hard edge |
| necklace under the arm | runs continuous through the joint in every pose |
| chest / belly behind the arm | unchanged from the drawing; the belly is not part of this rig |

**The fringe was investigated and ruled out by measurement.** WebP discards RGB
under a fully transparent pixel (verified against PNG, which keeps it), so the
encoder's junk does sit under the cut edge. Warping the layer as decoded, and
warping a copy whose 6,543 transparent pixels had been re-coloured from their
painted neighbours, produced **the same edge to the pixel** — same band count,
same mean RGB [195,154,75] at rest, [222,191,105] at −15°. The brightness along
the limb's outline is the **drawing's own rim light**. No colour bleed is
applied, because none is needed, and applying one would be hiding, not fixing.

---

## 4. The eight criteria

Verdicts are on the poses REST → −15° → −7° → +6°.

| # | criterion | verdict | the number |
|---|---|---|---|
| 1 | no shoulder gap | **clear** | 0 uncovered px @4× in all four poses; socket stations 0.99–1.00× rest |
| 2 | no ripped cutout edge | **clear** | outline ramp median 1.70–2.07 px, p95 ≤ 2.86; 1–12 px wider than 3 px out of 179–324 |
| 3 | no collapsing arm | **clear** | width 0.99–1.00× rest at every pose; 0 of 253 tris over 1.25× area |
| 4 | no necklace discontinuity | **clear, with debt** | continuous in every pose; its hidden stretch is still exemplar fill (8,590 px), not paint |
| 5 | no impossible elbow | **clear** | bends 5.2° of the 22° the drawing allows; the hand lands 8.0 px off the rigid swing (−15°), travelling 30.5 px instead of 38.0 |
| 6 | no lighting discontinuity | **NOT clear** | the mesh adds no new light (17.9–20.6 vs 19.5), but the **reconstructed** areas do not carry the drawing's light direction |
| 7 | no exposed missing pixels | **clear** | 0 uncovered px @4× at 0 / −15 / −7 / +6° |
| 8 | no gold texture tearing | **clear** | gradient energy never multiplies; 0 inverted triangles |

**The gate is not passed, so no production animation is wired.** Seven criteria
are clear; the one that is not is criterion 6 — and it is *artwork*, not rig: the
plate's reconstructed pixels (necklace continuation 8,590 px, back of the elbow
5,559, chest 2,035, socket 1,546, gold 1,420, robe 5 — 13,739 in all, listed per
region in `regions.json` and drawn in `05-review-map.png`) are plausible in
colour and texture but were never painted with the drawing's light.

That is the next job, and it is a painter's job on `rig/clean-plate.webp` —
followed by the corrective keyforms, which are still explicit placeholders in the
rig data (`"correction": null, "placeholder": true`).

---

## 5. Rest pose, against the artwork

| measure | whole canvas | on the figure |
|---|---|---|
| mean abs diff | 1.445 / 255 | 2.041 / 255 |
| p99 | 42.0 | 57.0 |
| pixels differing by > 32 | 3,961 of 315,104 | 3,395 of 198,270 (**1.71 %**) |

`07-rest-diff.png` draws it: near-white where the rig reproduced the drawing,
grey where it did not. The grey is the reconstructed stretches and the
antialiasing of a hard edge resampled — the same debt as criterion 6.

The canvas is 688×458: the master's 768×512 scaled by the card's own geometry
(172 CSS px × 4 = 688 device px). The rig never works above the master, and never
upscales it.

---

## 6. Sheets in this directory

| file | what it is |
|---|---|
| `07-joint-review.png` | **the sheet for the gate** — shoulder+elbow and chest+necklace, drawing vs all four poses, 2× |
| `06-DIAGNOSTIC-POSES.png` | REST → −15° → −7° → +6° over magenta, inspectable on its own |
| `06-keyforms.png`, `06-keyforms-closeup.png` | the keyforms, and the limb close up |
| `06-mesh-wireframe.png` | the mesh over the picture; red body / amber upper arm / green forearm, pink = the bone chain |
| `07-elbow-closeup.png` | the joint at 4×, with each pose's bend and hand travel |
| `07-rest-diff.png` | rest pose minus the artwork |
| `07-landmarks.png` | where the shoulder, elbow and fist sit on the drawing |
| `05-plate-compare.png`, `05-review-map.png` | plate provenance; green = the drawing's own pixels, red = reconstructed |
| `FIRST-PASS.md` | the first pass's report, kept as written — its "elbow is rigid" verdict is what this pass answers |

Engineering review is §2 (numbers), artwork review is §3–§4 (the eye). They are
deliberately not the same table: a rig can be structurally sound and still be
painted wrong, and this one is.
