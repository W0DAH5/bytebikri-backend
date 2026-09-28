# A living Golden Buddha: how 2D characters are actually rigged

Research report, required before the next version is built. It answers the twelve
items in the brief, and it says plainly what the current asset cannot do and what
artwork has to exist first.

**Verdict in one paragraph.** The current technique — flatten the illustration,
cut the arm out along a mask derived from two poses, rotate that layer about a
pivot — fails for reasons that are structural, not cosmetic, and no amount of
mask work fixes it. The professional answer is a **cutout rig with mesh
deformation**: the artwork is separated into parts, each part carries a mesh
whose vertices are weighted to a chain of bones, and *deformers* (rotation at
joints, warp over the torso) bend the parts so the body accommodates the
movement instead of merely transporting a sticker. That model is Live2D Cubism's,
and the same mechanics exist in Spine, Rive and Moho. For **this** Buddha the
recommendation is to build that rig ourselves as data and render it with a free
MIT runtime (PixiJS meshes), because the whole rig is roughly eight parts and
five parameters — but the same research also says, unambiguously, that the rig
needs artwork we do not have yet: **the pixels hidden behind the arm have to be
painted, and the arm has to be re-separated with overlap at the shoulder and a
drawn back-of-elbow.** Rigging alone will not reach the brief's bar. That is the
honest finding, and §9 lists exactly what must be made.

---

## 1. Why the crop-and-pivot approach fails

The brief is right that this is deeper than "the mask needs improving". Eight
distinct causes, and only the last one is about masks:

1. **A rigid transform is a similarity transform.** Rotation preserves lengths
   and angles, so the limb's silhouette is carried to its new angle *unchanged*.
   A real shoulder does the opposite: the inner side compresses, the outer side
   stretches, the volume redistributes. Because our layer cannot change shape,
   the joint must either intersect the chest or pull away from it. There is no
   pivot position that fixes this, which is why moving the pivot never worked.
2. **The cut line is not an anatomical boundary.** Our mask is derived from where
   two renderings disagree, so the boundary lands wherever the two drawings
   happen to differ — through the middle of a fold, through a highlight, along a
   shadow edge. In the drawing, that boundary *is* shading information, and
   shading information cannot be cut without being seen.
3. **Nothing in the picture participates.** In the illustration the robe, the
   necklace and the chest are composed *around* the raised arm: the sleeve's
   folds flow into the shoulder, the beads bend where the arm crosses them, the
   chest carries the arm's contact shadow. A moving limb with a motionless torso
   is not one character moving; it is two drawings fighting, which is exactly
   what the eye reports as "ripped photograph".
4. **Lighting is baked per pose.** The gold's highlights, rim light and
   half-tones on the limb were painted for one orientation. Rotate the limb and
   its specular rotates with it while the body's light stays put, so the two stop
   agreeing about where the light is. In addition the arm's **contact shadow on
   the chest** is painted into the torso; when the arm moves, the shadow stays
   behind and the newly exposed body has no shadow at all. This single point
   accounts for a large part of the "sticker" read, and no mask can address it.
5. **The hidden pixels do not exist.** Every pixel the arm was covering is
   unknown. We were filling them from a *second pose* of the same character:
   better than diffusion blur, but still a different drawing whose forms do not
   continue the visible ones. The authorities are blunt about this — see §5.
6. **The rig is flat.** One pivot is one rotational degree of freedom. Believability
   comes from a chain (torso → shoulder → upper arm → elbow → wrist) plus
   secondary warps, so the hand's *path* is the product of several joints and the
   body reacts along the chain.
7. **Antialiased edges compound.** Compositing two partial alphas gives
   `a + a(1−a)`, not `a`. This repository already measured that at the arm's rim;
   it is a general property of stacking independently cut sprites.
8. **It is a state swap, not a cycle.** Two stills and a step between them is not
   a gesture. The brief's own §5–§7 asks for continuity across the whole arc, and
   a swap cannot provide it.

---

## 2. The four systems, and what each actually does

| | **Live2D Cubism** | **Spine 2D** | **Rive** | **PixiJS (as a renderer)** |
|---|---|---|---|---|
| Unit | *ArtMesh*: an image with a mesh | *Attachment* in a *slot*, on a *bone* | Image (or vector) with a *mesh*, bound to *bones* | *Mesh*: raw geometry + UVs + shader |
| Joint rotation | **Rotation deformer** — "specialised in rotational movements", "primarily used on the neck, arms and legs" | Bone rotation; a weighted mesh bends across the joint | Bone rotation; weighted mesh bends | You write it: transform the vertex buffer |
| Shape accommodation | **Warp deformer** — deforms the ArtMeshes inside it; Bezier divisions (e.g. 2×2) with conversion divisions (e.g. 5×5) | **FFD** (free-form deformation) vertex keys, but the docs say weights are preferred | Vertex keys, or bone weights | You write it: any CPU or shader deformation |
| Skinning | Deformer hierarchy (child follows parent) | **Weights** bind vertices to bones; auto, smooth, prune, update-bindings | Bind bones, then edit **Blend** (how widely weights blend) and **Influence** (bones per vertex) | You write it |
| Corrective poses | **Keyforms**: a deformer's shape keyed per parameter value | Attachment/skin swaps, deform keys | Keyed vertices per timeline | You write it |
| Depth control | Draw order **can be driven by a parameter** | Slot order; triangle order inside a mesh follows weight order | Hierarchy | Layer order / z |
| Pose switching | Parts-visibility keys (100/0) | Attachments / skins | State machine | You write it |
| Runtime | Cubism Web SDK (proprietary Core, WebGL) | official runtimes **require a Spine licence to publish** | **MIT runtime**, WebGL/WASM | **MIT**, WebGL/WebGPU |

The parts of this table that matter for us:

**Live2D's deformer combinations are the exact catalogue of our problem.**
Its own documentation says *Rotation deformer (parent) + Rotation deformer
(child)* "is used to express the articulation of legs and arms", while *Warp
deformer (parent) + Rotation deformer (child)* "is a very useful mechanism when
you want to replicate **breathing, shoulder shrugging**". That is a rotator chain
for the limb, and a warp above it for the chest and shrug — the two things the
brief asks for.

**Spine's warnings are equally relevant.** Deformation should be done with
**weights**, not per-vertex keys; when binding, the bones must be in the
**bind pose** where the part is actually needed ("Update Bindings"); and inside a
self-overlapping mesh, **triangle draw order is determined by the order of the
bones in the weights list** — the mechanism that decides whether the shoulder
draws over or under the collar as it rotates.

**Rive's weight model names the shoulder problem directly.** Weights are edited
with *Blend* (how widely influence spreads at a boundary) and *Influence* (max
bones per vertex); a practitioner write-up describes the intent: a vertex
mid-forearm is 100% forearm, "vertices at the elbow joint must share influence —
perhaps 50% from the upper arm and 50% from the forearm. This interpolation
prevents the mesh from tearing."

---

## 3. How mesh deformation actually works

A mesh is a triangle list laid over the image: vertices carry **UV coordinates**
(where to sample the texture) and **positions** (where to draw it). Move a
vertex and the pixels inside its triangles are **bilinearly remapped** — stretched
and squashed, not merely translated. That is the whole trick: the picture can
change *shape*, which a transform cannot.

Two ways to drive the vertices:

- **Skinning (weights).** Each vertex stores its rest position *relative to* each
  bone and a weight per bone (summing to 100%). At runtime
  `p = Σ wᵢ · Mᵢ · p_restᵢ`. Weights of 1.0 make a vertex rigid to its bone;
  blended weights across a joint make the surface bend smoothly, exactly as in a
  3D character. This is what prevents the tear at the shoulder: the vertices
  *at* the joint interpolate between "follows the torso" and "follows the arm",
  so the silhouette compresses on one side and stretches on the other.
- **Deformers (what Live2D and Moho use).** A hierarchy of deformers — a rotator
  for the joint, a warped grid over the torso — where each deformer's *shape* is
  keyed against a parameter (arm angle, breath). Same mathematics, authored
  per-document rather than per-vertex, which is why riggers prefer it.

Volume is preserved because the deformation is applied to *geometry*: the
shoulder's cross-section shortens on the inner side as it turns, which is what a
mass of gold does. Nothing about it is a rigid transport.

Mesh density is a cost decision, and it is small for us: Rive's guidance is
"< 500 vertices for simple UI elements and < 5,000 for complex main characters".
Our entire scene is ~8 parts with a dozen-odd vertices at each joint — a few
hundred vertices total, which is nothing for a phone GPU and, on the CPU that
PixiJS uses for `MeshPlane`-style updates, is a handful of microseconds per
frame.

---

## 4. The hierarchy this Buddha needs

Following Live2D's combination table and Spine's arm anatomy:

```
root (the card's frame)
└── scene warp ................. the whole figure; subtle sway, breath lift
    ├── coins / gold pile ..... rigid, no deformer (it does not deform)
    ├── torso warp ............ keyed: breath (0→1) and shoulder shrug (← arm angle)
    │   ├── robe warp ......... keyed: the sleeve collapses as the arm lowers
    │   ├── chest warp ........ breath: rise at the sternum, not a scale-Y of the whole body
    │   ├── necklace chain .... 3–4 small rotators along the beads, so the strand
    │   │                       follows the chest and the arm crossing it
    │   └── shoulder rotator .. the joint: pivot at the glenoid, not at the drape's edge
    │       └── upper arm .... weighted mesh, ~50/50 at the shoulder
    │           └── elbow rotator
    │               └── forearm (weighted mesh)
    │                   └── wrist rotator
    │                       ├── hand mesh
    │                       └── grapes rotator (stem pivot, cluster swings)
    └── head (rotation deformer: tiny z-tilt)
        └── face layers: eyes (blink), brow, cheeks
```

Parameters (the "clocks", which already exist as CSS keyframes today):
`arm_angle` (−15°…+6°), `breath` (0…1), `blink` (0…1), `grape_sway` (−4.5°…+5°),
`head_tilt` (±1°), `gloss` + `aura` (environment only, still CSS).

**Draw order is a parameter too.** In the original the arm passes *in front of*
the necklace and *behind* the near beads of the strand; when it lowers, that
changes. Both Live2D (parameterised draw order) and Spine (slot order) treat
this as animation data, not as a fixed stack — our fixed z-order is one of the
reasons the swap looks abrupt.

---

## 5. Hidden pixels: what the authorities do

The brief's §8 is answered by the primary documentation of the tool built for
exactly this job. Live2D's own artwork preparation guide, on turning a single
finished illustration into a rig:

> "If the original image is a single JPG or a PSD with merged layers, it will be
> necessary not only to cut out parts but also to **draw in the background behind
> them**."

and, on the specific case of a limb that moves:

> "In the still image, the arm is bent firmly from the elbow down, but if we want
> to extend the lower arm slightly, we also need to **draw the back of the
> elbow, which is currently hidden**. If we were to extend the lower arm without
> drawing these additional parts ... the back of the elbow and parts of the back
> hair that haven't been drawn in would become **gaping holes**."

The prescribed method: fill the new area with the part's **base colour**, protect
its opacity, **paint the shadows to match the original's style**, draw the **line
art** on top, then use a mask/airbrush to blend the seam where the new and old
artwork meet. The same principle appears in VFX as the **clean plate** — "a frame
or sequence where objects/people have been removed using techniques like
rotoscoping, serving as a reference for seamlessly filling in the resulting
gaps" — usually made by paint/clone or by projecting a plate onto geometry.

So: **not diffusion blur, not feathering, not generated texture, not transparent
holes.** Painted, in the artwork's own light, with the contact shadow included.
The brief is correct to forbid the alternatives.

One useful economy: we hold a **second rendering of the same character in the
arm-down pose**. That pose is a legitimate source for a large part of the hidden
body — same hand, same light, same material — and it already covers most of the
area the raised arm hides. What it cannot cover is the region where the two poses
*disagree about where the body ends* (the drape's edge and the shoulder line),
and that remains a paint job.

---

## 6. Are corrective keyforms needed? Yes

Mesh weights alone will fix the silhouette; they will not fix the shading. The
industry answer is a **pose-space deformation**: Moho calls them *Smart Bones* —
"when you rotate this bone, I want the shape to look like this in this pose",
described in the trade press as "a pose space deformation, or a corrective
shape". They are exported to glTF as **morph targets**. Live2D's *keyforms* are
the same concept: a deformer's shape keyed at a parameter value.

For the Buddha, four corrective keyforms are needed:

| Parameter value | What the keyform adds |
|---|---|
| `arm_angle = 0` | the rest pose — the artwork itself, untouched |
| `arm_angle = −7°` | the shoulder's compression + the drape's fold shifting + the **contact shadow** moving with the arm |
| `arm_angle = −15°` | as above at the extreme, plus the armpit crease closing |
| `arm_angle = +6°` | the reverse: the shoulder rising, the drape opening, the shadow sliding down |

Plus one for `breath` (chest rising *and* the robe folds answering) and one for
the eating pose (the hand's contact with the belly, its shadow, and the beads
across the wrist).

---

## 7. Browser technology: what to render it with

| Option | Can it deform a raster? | Verdict |
|---|---|---|
| **CSS** | No — transform/opacity only | Correct for gloss, aura, particles, opacity. **Not** the arm. (Matches the brief's §10.) |
| **SVG** | No — no texture warping | No |
| **Canvas 2D** | Only by clipping a triangle per `drawImage`, which seams and crawls | No |
| **WebGL / WebGPU via PixiJS** | Yes — explicit geometry, UVs, per-frame vertex updates (`MeshGeometry`, `MeshPlane`), MIT, WebGL+WebGPU | **Yes — the renderer** |
| **Live2D Cubism Web SDK** | Yes, exactly this | Strongest authoring model, but: a heavyweight dependency for a profile card, a proprietary Core, and the moc3 pipeline needs the desktop editor (§11) |
| **Spine runtime** | Yes | Official runtimes require a Spine licence to publish — **$69/$369** |
| **Rive runtime** | Yes — meshes + bones, MIT runtime, small `.riv` | Excellent and cheapest to *author*, but **publishing a `.riv` now requires the paid Cadet plan ($9/mo)** |

**Choice: PixiJS meshes, with the rig authored as data by our own pipeline.**
Reasons: it is MIT and already how a web app renders; the rig we need is ~8 parts
and ~6 parameters, which is at the small end of this technology; and authoring
the rig as **JSON from Python** means the rig is reproducible, reviewable in a
diff, and regenerated whenever the artwork changes — the same discipline this
repository already applies to the sprites. If a designer ever wants a GUI, the
same rig data can be re-emitted as Rive or Spine later, because the *model* is
theirs; the runtime we ship stays free.

---

## 8. Recommendation for this Buddha

**Hybrid cutout rig — mesh-deformed limbs and torso, rigid environment, illustrated
corrective keyforms, all driven by one parameter set, rendered with PixiJS and
authored from a re-separated master.**

Why hybrid rather than all-of-either: the coins, the pile and the background
gold are rigid objects and should stay rigid (they are what makes the Buddha sit
*in* something); the arm, shoulder, chest and robe need deformation; the shoulder
and the eating pose need a correction that no mesh will produce by itself, and
those are painted. This is the brief's §9, arrived at from the sources rather
than assumed.

**What we keep.** The character, the composition, the choreography (the 24 s
gesture, the breath on ~5.5 s, the blink, the grape sway, the gloss cycle — all of
it becomes parameter curves, so the animation work is not discarded), the
card integration, the reduced-motion still, and the extensive browser test
harnesses.

**What changes.** The rendering of the character goes from stacked `<img>` layers
under CSS transforms to one canvas per wearing card, and the asset pipeline
gains a separation + painting stage before mesh derivation.

---

## 9. Assets that must be prepared

This is the part that decides whether the result is beautiful or merely better.
Ordered by importance:

1. **The clean plate — the body behind the arm.** Today's plate borrows the
   arm-down pose and diffuses the remainder; it must instead be *painted*: the
   chest, the robe's folds continuing their flow, the necklace segment, the gold
   pile behind the arm, and the **contact shadow** the lowered arm casts. Painted
   from the 1536×1024 master's palette and light.
2. **The arm as a mesh-ready layer with overlap.** Cut *past* the joint — a
   shoulder "socket" that tucks under the collar, and the **back of the elbow**
   drawn in, exactly as the Live2D guide requires, so bending opens no hole.
3. **The necklace separated into a strand**, with the beads that cross the arm
   split between "in front" and "behind", so draw order can change with the arm.
4. **The grapes' stem drawn longer**, so the cluster can swing ±5° without
   exposing the cut.
5. **Corrective keyform artwork** for the three arm angles and the eating pose
   (§6), each a small painted patch, not a whole new frame.
6. **Meshes and weights**, derived by the pipeline: densest at the shoulder
   (~a dozen vertices), the elbow and the wrist, sparse elsewhere.
7. **Everything cut from the master**, not from the 768 px webps, so the mesh can
   be drawn at 2× without softening. The master (1536×1024) also fits inside the
   texture budgets of every tool compared above.

**Items 1–5 are painting.** I can generate a first pass of the clean plate
procedurally with the rules the guides give (base colour → matching shadows →
masked seam), and I can derive meshes, weights and deformers in Python — but the
corrective keyforms and the drape's continuation are where an artist's stroke
beats an algorithm, and the brief explicitly requires the hidden region to
"belong to the SAME artwork". I will show that first pass for review rather than
silently shipping a generated patch.

---

## 10. The pipeline

```
1536×1024 master
  → 1. separation into painted parts (arm+socket, hand, grapes, torso, robe,
       chest, necklace, head, foreground coins)         [human/AI-assisted paint]
  → 2. clean plate: hidden regions painted from the master's own light
  → 3. scene-parts.py: derive meshes, weights, deformers, keyforms
       → emits  buddha-rig.json + atlas.webp
  → 4. runtime: load rig → evaluate parameters → transform vertices
       (CPU, few hundred vertices) → PixiJS Mesh buffers → draw in order
  → 5. animation: the existing CSS keyframes become parameter curves
  → 6. verification: the harnesses below, plus the moving test (§14)
```

Nothing in steps 3–6 depends on a paid tool, and step 3 is where this repository's
existing Python pipeline already lives.

---

## 11. Tradeoffs, honestly

| Tradeoff | Note |
|---|---|
| **Painting is the real cost** | Items 1–5 in §9 are hours of art, not code. No rigging technique substitutes for them, and this is the one place where the project cannot be advanced by engineering alone. |
| Mesh resampling | Triangles resample the texture, so there is a slight softening under large deformations. Mitigated by cutting from the master and by keeping the rest pose byte-identical (a test that already exists in this repo). |
| Draw-order changes can pop | The arm crossing the necklace genuinely changes overlap; keyed draw order is the standard answer, and it must be stepped, not faded. |
| Performance | A few hundred vertices per card, CPU-side, is negligible; but a roster is *many* cards. Mitigation: the canvas renders only for cards in view, and honours `prefers-reduced-motion` by drawing one static frame. |
| Runtime dependency | PixiJS is ~an extra bundle. Acceptable for the app; alternatively the same rig can be rendered with a small bespoke WebGL renderer (the deformation is ours either way). |
| Licences | Live2D is free below ¥10M revenue but proprietary; Spine needs $69–369 **plus** a licence for its runtimes; Rive's runtime is MIT but publishing needs $9/mo; DragonBones is free but its editor is abandoned; PixiJS is MIT with no fee. The recommendation keeps us at **zero cost**. |
| Maintenance | A bespoke rig needs documenting so the *next* premium character reuses it. That is an advantage if done now: the second character should be data, not code. |

---

## 12. Why this avoids the ripped-arm appearance

Because it removes all five discontinuities at once, and each one is measured:

1. **Geometry** — the limb is a mesh, so the shoulder compresses and stretches
   instead of intersecting, and the hand's path comes from a joint chain rather
   than a single pivot.
2. **Occlusion** — the hidden body is painted, so what the arm uncovers belongs
   to the same drawing, with the same folds and the same gold.
3. **Lighting** — corrective keyforms carry the contact shadow and the drape's
   response, so the limb's light and the body's light stay in agreement.
4. **Material** — the texture is the original artwork throughout; nothing is
   synthesised, and the rest pose is provably identical.
5. **Continuity** — one parameter set driving one rig, so there is no swap between
   drawings and no frame in which two poses coexist.

---

## 13. Decision criteria, applied

| Criterion | Cutout mesh rig (recommended) | Pose-to-pose frames | Rigid rotation (current) |
|---|---|---|---|
| Arm stays attached | Yes — weights blend at the joint | Yes | No |
| Shoulder deforms naturally | Yes — warp + keyform | Yes | No |
| Gold texture coherent | Yes — original texture | Yes | Yes |
| Lighting coherent | With corrective keyforms | Yes | No |
| Feels alive | Yes — one continuous gesture | Best, but needs many drawings | No |
| One character | Yes | Yes | No — two drawings alternate |
| Preserves current artwork | Yes, after re-separation | Only partly | Yes |
| How much reconstruction | Moderate (painted hidden areas) | Large (a drawing per pose) | None |
| Browser practicality | Good — few hundred vertices | Heavy — many images | Trivial |
| Future premium characters | Reusable rig format | Reusable commission | No |

Pose-to-pose is the only method that beats the mesh rig on lighting, and its cost
is a full illustration per key pose plus a consistent identity across all of them
— which the earlier brief explicitly warned against. The hybrid in §8 takes the
best of it: mesh for the broad movement, painted corrections where it matters.

---

## 14. The test the work must pass

The brief's §14 is adopted as-is, and this repository already has three of the
harnesses it needs:

- **at rest**: layered scene vs the artwork (exists — `scene-parts.py`,
  currently 46.15 dB against the artwork's own 45.98, 0 px over 32 along the cut);
- **through the motion**: the scene over a magenta ground at the animation's own
  clock, counting pixels where the figure stops covering the ground (exists —
  `ci/eyes/uncovered-audit.mjs`), extended to per-joint crops;
- **the card**: text and geometry unchanged at every phase (exists —
  `ci/eyes/card-phases.mjs`);
- **new**: a vertex-deformation check (no inverted triangles, no vertex leaving
  its part's bounds) and a **flicker check** across the full cycle, because
  draw-order and keyform steps are exactly where a new seam would appear.

Explicitly not accepted as proof: a pixel-perfect rest frame, a green build, an
animation that is running, opacity changing, whole-image rotation or translation,
gloss or particles moving, or four images crossfading.

The criterion is the brief's: **does he remain one coherent illustrated character
while the arm moves.**

---

## 15. What happens next

Per instruction, nothing has been implemented: the arm implementation is
untouched this round, and no static fallback will be proposed.

The work splits into two tracks, and they can run in parallel:

1. **Artwork (the critical path).** Separate the master into painted parts with
   the shoulder socket and the back of the elbow; paint the clean plate
   (§9.1–9.5) using the arm-down pose as the source where it is correct and the
   artist's hand where it is not. I will produce a first pass of the plate and the
   separation and put it in front of you for review before any of it enters the
   product.
2. **Rig (can start immediately, on the artwork as it is).** Build the rig data
   format and the PixiJS runtime, and prove the deformation quality on the
   existing parts — a mesh arm over the current plate — so the technique is
   demonstrated on real assets while the painting is prepared. This is the piece
   that proves "mesh, not pivot" before we invest in clean art.

One decision is yours, because it changes the work: **who paints the clean plate
and the corrective keyforms** — me (procedurally, shown for review), or a person
with a stylus. Everything downstream is the same either way.
