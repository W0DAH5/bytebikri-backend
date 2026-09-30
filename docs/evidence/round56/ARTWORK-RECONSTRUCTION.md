# The artwork reconstruction — what the gesture exposes, what the master determines, and what needs a painter

The rig is frozen: nothing in this phase touches `GROUP`, `CLUSTER`, the layer
masks, the mesh, the deformation, the animation range, the CSS or the layer
structure. The rig's own assets are byte-identical to commit `958000e` after
every run below (restored and verified, not asserted).

Everything here is derived from `mascot-gold-buddha-base.png` and the frozen rig's
own layers. No render is used as a source.

## 1. The gesture the animation actually performs

`@keyframes buddha-reach` runs the arm `0 → +6 → +5.4 → 0 → −2.4 → −15` (held
about three seconds) `→ −2 → 0`; easing changes *when* an angle is reached, not
*which* angles are reached, and interpolation passes through every angle between
keyframes, so **the arm visits [−15°, +6°] and nothing outside it**.
`@keyframes buddha-grapes` sways the fruit `−4.5 → +4 → +1.5 → −4.5` about the
stem, independently.

| | px |
|---|---|
| exposed by the poses the animation uses | 12,892 |
| **the set that needs art behind it** (grown 6 px for the bending mesh) | **21,350** |

## 2. What the MASTER determines is behind the limb

The membrane — the master's own visible alpha extended across the limb's
footprint as Dirichlet data, solved inward — is the only evidence the brief
allows, and it has three outcomes, not two:

| classification | px | share | what it means |
|---|---|---|---|
| **body** continues behind it | 3,389 | 16% | the master's own art determines the content — reconstructable |
| **sky** continues behind it | 5,517 | 26% | the page belongs there — the artist's own arm-down artwork agrees |
| **undetermined** | **12,444** | **58%** | the master shows neither: body and sky meet behind the limb |

The third class is the honest one. The raised arm hides the band where the limb's
own body meets the sky behind it, and at production the two continuations both
touch that band, so the master cannot say which continues through it. Per the
brief: **not invented, flagged.**

## 3. Per structure

| structure | exposed | body | sky | undetermined | verdict |
|---|---|---|---|---|---|
| shoulder / root | 2,833 | 8 | 896 | 1,929 | **UNDETERMINED** — painted keyform |
| robe / drape | 2,834 | 8 | 900 | 1,926 | **UNDETERMINED** — painted keyform |
| chest (skin) | 956 | 956 | 0 | 0 | sufficient — body continues |
| chin / neck | 1,771 | 1,771 | 0 | 0 | sufficient — body continues |
| necklace | 0 | 0 | 0 | 0 | **not exposed by this gesture at all** |
| hand / grape openings | 5,923 | 63 | 3,958 | 1,902 | the silhouette's own openings — the page belongs |

The necklace never enters the exposed set: the arm's rotation about the shoulder
does not uncover it. Nothing needs to be painted along the bead arc, which retires
a worry the earlier passes carried.

## 4. The flag list — painted corrective artwork required

`63-painted-keyform-list.json`; shown in `63-flag-list.png`. The five largest:

| # | px | box (master px) | surrounded by |
|---|---|---|---|
| 1 | 9,512 | x 663–832, y 15–231 | sky, gold, shadow — the band behind the hand and the fruit |
| 2 | 2,239 | x 482–543, y 121–301 | sky, gold, shadow — the band outside the forearm |
| 3 | 347 | x 665–683, y 76–94 | gold |
| 4 | 299 | x 604–630, y 43–75 | gold, sky |
| 5 | 42 | x 823–830, y 136–147 | gold, sky |

These are the pixels where a painter must decide, in the master's own language,
what the raised arm reveals. They are also exactly where the committed plate has
already had to guess: **the plate is opaque on 7,639 px (61.4%) of them.** That
fill is interim — it is a copy of the master's own drawing, but it is not a
painter's continuation of its structure, and the brief forbids treating it as one.

Where the master *does* determine the content the plate is already right: opaque
on **100%** of the determined body, transparent on **99.5%** of the determined
sky.

## 5. Validation of the method (step 8 of the brief)

The reconstruction method was tested by hiding artwork the master **does** show
and reconstructing it with the pipeline's own code, lifted out of
`buddha-rig-art.py` by parsing its source — the test runs the real functions, and
the script is not edited. `64-validation.png`, `64-validation.json`.

| hidden region | mean \|err\| | p90 | max | the artwork's own local contrast |
|---|---|---|---|---|
| drape fold | 5.65 | 12 | 93 | 4.09 |
| belly (smooth skin) | **15.81** | 39 | 176 | 9.91 |
| necklace beads | **15.78** | 40 | 194 | 10.28 |
| arm gold | 5.65 | 13 | 53 | 2.58 |

**The method is not good enough for the determined regions.** Patch-copying
handles busy gold (5.65 against a local contrast of 2.58) but it does not
reproduce a smooth gradient: on the belly and the beads the mean error is ~16 with
p90 ≈ 40 — visible at 2×. The determined body regions here are *smooth skin*
(chest, chin, neck), which is precisely the case that fails.

So the reconstruction must be gradient-preserving — a harmonic solve matched to
the boundary, with the master's own texture carried on top — and this same
harness re-run to prove it beats the copy. That is the next step, and the
validation harness now exists to check it rather than to argue about it.

## 6. Defect recorded, deliberately NOT fixed

**The limb masks' cut edges are staircased.** `GROUP` and `CLUSTER` come from the
768 derived assets, so their outlines are 768 shapes at 2×: two-pixel steps.
Measured against the drawing, the cut sits a median of **3.6 px** from the
strongest master edge within 3 px of it — it is not following any crease the
artwork draws. At 3× (`57-edge-now.png`) it reads as stepped notches and floating
fragments along the vacated band.

Its relationship to the reconstructed artwork: the stepped boundary borders the
revealed area, so any painted continuation has to meet a cut that steps across the
gold rather than following it; the step and the fill error compound there.

It is recorded as an artwork/asset-quality defect and **left in place**. Fixing it
means changing the layer masks, which this phase forbids. It needs a decision.

## 7. Scope finding worth recording

`buddha-rig-art.py` builds its exposed set from *both signs* of every angle
(`_kept()` intersects the mask with its rotation by ±3°, ±6°, ±7°, ±15°). The
animation never visits +15°, so that set is 36,945 px — about 15,000 px larger
than the gesture's real reach (21,350 px with the mesh margin). The reconstruction
effort was aimed at angles the character never reaches, and the band the arm
actually uncovers was classified background and left to the page. This is a scope
error in the artwork work, not a rig fault, and it is recorded rather than
silently corrected: correcting it changes what the pipeline reconstructs, which
is the next phase's job.

## 8. Status

- Rig frozen and verified byte-identical after every run in this phase.
- Sheet produced: `62-gesture-sheet.png` — MASTER, REST, −3°, −7°, −15°, with the
  exposed pixels marked by class (magenta = body determined, blue = sky
  determined, amber = undetermined).
- Flag list produced for the painted corrective artwork.
- Validation harness built and the method's weakness measured.
- **No production wiring**, per the brief, until the artwork passes inspection.
