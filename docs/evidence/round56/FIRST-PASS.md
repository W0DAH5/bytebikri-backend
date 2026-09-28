# The hybrid rig, first pass — engineering report and artwork debt

Commit `302976c`. **The production animation is NOT wired.** What follows is the
foundation and its diagnostic poses, judged against the eight criteria in the
brief. Where a criterion is met by engineering, it says so with a number; where
it is met only by artwork that does not exist yet, it says that instead.

---

## 1. What was built

| Piece | What it is |
|---|---|
| `rig/arm.webp` | the limb, **extended past the joint** along its own direction (a wedge into the socket, radius < 52 px) so the mesh has a shoulder to bend instead of a cut edge |
| `rig/clean-plate.webp` | the body behind the arm: the arm-down rendering's own chest/shoulder/necklace where that pose is confident, exemplar fill from the drawing's own gold elsewhere |
| `rig/grapes.webp` | the cluster with its stem extended up the wrist, so sway never shows the cut |
| `rig/shadow.webp` | the contact shadow, derived from the limb's silhouette — **marked as not painted** |
| `rig/buddha-rig.json` | the rig as data: 253-vertex polar arm mesh, 54-vertex torso mesh, per-vertex weights, pivot, bone axis, draw order, keyform list |
| `app/scripts/rig-buddha.py` | the pose evaluator (linear blend skinning + socket bend + shoulder warp) and the diagnostic renderer |
| `app/scripts/rig-qa.py` | the measurements below |

**The reference is untouched.** `mascot-gold-buddha-base.webp` is the master; the
rig reads it and never writes to it. Every pose is judged against it.

**Draw order** is `plate → shadow → arm → grapes`. There is deliberately **no
"collar" patch**: a piece of drape drawn over the joint is how a rigid cutout
hides its cut, and the first diagnostic sheet showed it re-drawing the raised
arm's pixels on top of the rigged limb. Here the joint closes by *deformation* —
the socket's vertices are weighted between body and limb. Where the drawing does
show the drape in front of the arm, those pixels are already in the plate.

**Nothing is hidden.** No blur, feather, glow, diffusion or opacity fill anywhere
in the pose function. The three failures that the first sheets exposed were fixed
by correcting the rig, not by masking them.

---

## 2. Engineering: the deformation, measured

| pose | limb width vs rest | triangle area change (median / p99) | texture gradient energy |
|---|---|---|---|
| rest | — | 1.00 / 1.00 | 19.5 |
| −7° | 0.97 – 1.00× | 1.00 / 1.01 | 19.8 |
| −15° | **0.92** – 1.00× | 1.00 / 1.04 | 16.5 |
| +6° | 1.00 – 1.01× | 1.00 / 1.01 | 20.0 |

- **Volume is preserved.** The limb never narrows below 0.92× at any radius, and
  that one 8% narrowing is at the socket, which is the direction a shoulder
  actually compresses.
- **No impossible stretching.** Triangle area is 1.00 median, 1.04 at the 99th
  percentile: the deformation redistributes shape almost exactly without changing
  area.
- **Inverted triangles: 0 of 253** at every keyform (they were 3 of 48 before the
  mesh was rebuilt).
- The 16.5 at −15° is a 15% loss of gradient energy: resampling under a larger
  rotation. It is a slight softening, not tearing — tearing would push this
  number up, and it falls.

---

## 3. The eight criteria, honestly

| Criterion | Status | Evidence |
|---|---|---|
| **No shoulder gap** | ✅ met | 0 uncovered pixels (4×) at all three keyforms; the socket mesh bends rather than parting |
| **No ripped cutout edge** | ✅ met | there is no cut edge in the interior any more — the mesh covers the limb's silhouette and the draped plate carries what is behind it |
| **No collapsing arm** | ✅ met | limb width 0.92–1.01× across ±15°; see table |
| **No exposed missing pixels** | ✅ met | `coverage` in `rig/buddha-rig.json`: 0 px at 0°, −7°, −15°, +6° |
| **No gold texture tearing** | ✅ met by measurement | gradient energy 19.5 → 19.8 / 16.5 / 20.0; area ratio ≈ 1.00 |
| **No necklace discontinuity** | ⚠️ **mostly** | the necklace is continuous as a *line*, and 4968 px of it come from the arm-down drawing's own beads. But 8590 px of it are exemplar fill, so bead-by-bead fidelity is an artwork debt, not an engineering result |
| **No impossible elbow** | ⚠️ **not yet** | there is no elbow joint in this rig. The limb below the socket is rigid and only translates, so the elbow *cannot* be wrong — but it also cannot bend. A two-bone arm (forearm weighted to a child bone) is the next engineering step, and the mesh is already dense at the elbow in anticipation |
| **No lighting discontinuity** | ⚠️ **the main debt** | the reconstructed regions carry real texture (gradient mean 27–39 against 38 inside the drawing) but the *direction* of the light was not reconstructed — the exemplar fill copies patches from wherever they match. This is exactly the class of fault a painter fixes and an algorithm cannot, and it is why §4 exists |

Two further honest notes, both about things the brief asked for that are present
but provisional:

- **Corrective keyform placeholders** are in place as the three pose angles
  (−15°, −7°, +6°) driving the evaluator, plus a `k` hook per keyform in
  `buddha-rig.json`. They currently carry **no painted correction** — no shadow
  shift, no drape fold. They are the structure, ready for artwork.
- **Draw-order changes** are implemented as a fixed order. The brief lists them
  as a requirement; in this rig they only become *necessary* once the arm crosses
  the necklace, which is the "reaching the mouth" part of the cycle, not the
  three block keyforms. The mechanism is `draw_order` in the rig JSON.

---

## 4. Artwork debt: every reconstructed pixel, labelled

`rig/regions.json` names each area, its box, how many pixels came from the
arm-down drawing (real) and how many were generated (needs a painter).
The review map is `docs/evidence/round56/05-review-map.png`: **green = the
drawing's own pixels, red = reconstructed**.

| Area | from the arm-down drawing | reconstructed — **needs painting** |
|---|---|---|
| chest behind the arm | 432 | 2035 |
| shoulder socket | 273 | 1546 |
| robe / drape continuation | 31 | 5 |
| necklace continuation | 4968 | 8590 |
| back of the elbow | 1090 | 5559 |
| gold / pile continuity | 164 | 1420 |
| **total** | **6958** | **13739** |

The brief's six named regions are all represented. The numbers to beat when
painting are in `rig-qa.py`'s output: the reconstructed areas currently measure
gradient energies of 27–39, i.e. they are **not** flat patches — they carry the
drawing's own texture — but their light direction is not guaranteed.

Contact shadow: **derived, not painted**, marked as such in `regions.json`. Its
shape is currently a stamp of the limb's silhouette; a painter's version is a
corrective keyform input.

---

## 5. What is NOT done, and why no animation is wired yet

1. **The clean plate is not final art.** It is a first pass, as instructed, and
   its light direction is unverified.
2. **The elbow does not bend.** The brief's "no impossible elbow" is satisfied
   only in the sense that the elbow is rigid. A second bone is needed for the
   reach-to-mouth half of the cycle.
3. **The corrective keyforms are empty.** Structure, not artwork.
4. **The PixiJS runtime is not built.** The evaluator here is Python; the
   mathematics is identical to what the runtime will do per-vertex, but no
   browser has run it yet, so the diagnostic sheet is the current evidence and
   the card is untouched.

Per the brief — "do not wire the final production animation until the diagnostic
poses show ..." — the CSS scene still runs exactly as it did before this commit.
`scene-parts.py`, the served parts and `styles.css` are unchanged.

---

## 6. What I recommend next

1. **You review the sheet** — `06-keyforms.png` (the four poses),
   `06-keyforms-closeup.png` (the shoulder and hand region),
   `06-mesh-wireframe.png` (the mesh and its weights, red = body side),
   `05-review-map.png` (which pixels need a painter).
2. **Then pick the order**: (a) paint the reconstructed areas, (b) add the elbow
   bone and the reach pose, or (c) build the PixiJS runtime so the card can show
   the rig. My recommendation is **(b) then (c), with (a) in parallel** — the
   elbow is what unlocks the actual gesture, the runtime is what makes it a
   product, and the painting is the only part that is hours of hand work and can
   proceed while the two engineering items land.
