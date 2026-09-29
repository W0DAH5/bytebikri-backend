# Fourth pass — the corrective keyforms, authored

The brief asks for corrective keyform placeholders at −15° / −7° / +6°. This pass
replaces the placeholders with authored keyforms — and, where the measurement
says no correction is needed, with the number that says so. It also removes the
one thing in the rig that was doing the job the brief bans.

**The choice of slice.** Two candidates were open: paint the plate's remaining
10,992 px, or author the keyforms. The keyforms won, and the reason is the
brief's own rule — the plate's pixels are *generated* and must not be called
final, so more procedural work on them would only produce more generated art of
the same kind. The keyform table, by contrast, was still literally
`"correction": null, "placeholder": true`: unfinished structure, in the part of
the job that is engineering rather than painting.

---

## 1. What a corrective keyform is here

The research (`CHARACTER_ANIMATION.md`) settled the form: Live2D keyforms and
Moho Smart Bones are the same idea — a shape the character takes at a chosen
value of a parameter, authored because linear skinning alone does not produce it.
For this rig the honest content of that table is three things:

* which corrections are **needed**,
* which were **measured and found unnecessary**, with the number,
* which are **owed to a painter**.

Separating engineering from artwork is not a formality here: it is the difference
between a rig that is finished and a rig that is hiding the fact that its plate
still needs paint.

## 2. The elbow: no correction, and here is why

Linear blend skinning pulls a joint's surface toward the chord between the two
bones. If that shortening were visible, it is exactly what a corrective shape
would exist to push back. Measured over the blend band (37 vertices), at every
keyform:

| keyform | chord moved, mean | p95 | max |
|---|---|---|---|
| −15° | 0.046 px | 0.077 | 0.093 px |
| −7° | 0.027 px | 0.017 | 0.020 px |
| +6° | 0.031 px | 0.212 | 0.226 px |

**Sub-pixel at every keyform.** A corrective mesh shape would move the surface
less than the resampling it is meant to fix, so the keyform is authored as
`mesh_correction: null` with this measurement beside it, and `rig-qa.py` prints
it on every run. A correction that exists to look diligent would be worse than
none: it would be a second, unexplained deformation in the draw path.

## 3. The shadow: the corrective keyform is removal

There was a derived contact shadow: the limb's silhouette, blurred, pushed along
the light, darkened, drawn under the limb. It was measured against its own job
description before being corrected, and it failed on three counts:

1. **It was not a shadow.** Its colour was `plate * 0.62 + base * 0.38` — it did
   not darken the plate, it blended the plate toward the base picture. That is a
   soft, opaque stamp of the limb's shape. Inside its own footprint it darkened
   3,440 px by more than 8 levels and **lightened 624 px** by more than 8. The
   brief bans exactly this category: *"no hiding bad deformation with blur,
   feathering, glow, diffusion, opacity or texture noise."*
2. **Its strength was the wrong way round.** Alpha scaled with `|deg| / 15` —
   0.00 at rest, 0.47 at −7°, 1.00 at −15°. But −15° is where the limb has lifted
   **furthest** from the body. Contact darkening must fall as the limb leaves,
   not rise.
3. **It could not follow the limb.** Rotating it with the limb was measured, not
   assumed: at −15° its mass lands **10.37 px** from the limb it belongs to,
   against **3.88 px** for the fixed stamp — the rotation drags its soft edge
   across the chest and smears the grapes.

`11-shadow-at-15.png` shows all three side by side — as it was drawn, rotated
with the limb, and absent — and the script regenerates that sheet on every run,
so the decision can be re-checked rather than taken on trust. Rotated is the
worst of the three; absent is the only one with no smear.

**So the shadow layer is gone**: removed from the draw order (`plate → arm →
grapes`), removed from the assets, and recorded in both `buddha-rig.json` and
`regions.json` as *owed* — a painted cast shadow at each keyform is a painter's
job, and saying so is the point.

## 4. What the rig data now says

```
buddha-rig.json   draw_order: ["plate", "arm", "grapes"]
                  keyforms:      each with mesh_correction, the measurement that
                                 justifies it, its shadow note, and the artwork owed
                  corrective_keyforms:
                    shadow:       REMOVED, with the three reasons and the evidence file
                    elbow_mesh:   null, with the sub-pixel measurement
                    warp_deformer: the socket band IS the corrective deformer
                  contact_shadow: present: false, owed: painted cast shadow
```

## 5. The eight criteria, after the removal

Re-measured on the rig with no shadow layer:

| # | criterion | verdict |
|---|---|---|
| 1 | no shoulder gap | clear — 0 uncovered px @4× at 0 / −15 / −7 / +6° |
| 2 | no ripped cutout edge | clear — ramp median 1.70–2.07 px, p95 ≤ 2.86 |
| 3 | no collapsing arm | clear — width 0.99–1.00× rest; 0 of 253 tris over 1.25× |
| 4 | no necklace discontinuity | clear — seam step 0.45 vs the drawing's own 8.05 |
| 5 | no impossible elbow | clear — 5.2° of the 22° allowed; chord moved ≤ 0.23 px |
| 6 | no lighting discontinuity | clear — no shadow means nothing lightens; plate seam unchanged |
| 7 | no exposed missing pixels | clear — 0 uncovered px @4× |
| 8 | no gold texture tearing | clear — gradient energy 17.9–20.6 around rest 19.5 |

Removing a layer changes what is drawn underneath it, so the coverage test was
re-run rather than assumed: it still reads 0.

## 6. What is still owed

* **The plate's 10,992 reconstructed px** — generated, labelled, not final.
* **A painted cast shadow at each keyform** — now recorded as owed in two places.
* **`elbow_share_of_shoulder = −0.35`** — still a chosen constant, though it is
  bounded by the drawing's own 22° and measured at every keyform.
* **No production animation is wired.**
