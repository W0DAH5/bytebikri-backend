# After the paint passes — the ordered path back to production

The artwork phase's exit condition: painted corrective artwork delivered,
accepted by `app/scripts/keyform-acceptance.py --paint <dir>` (numeric gate) and
the 1×/2×/4× visual inspection across REST, −3°, −7°, −15°. **Until then, nothing
below happens.** This file exists so the path after acceptance is explicit and
each step's decision is visible before it is needed.

## 0. Decisions already pending (independent of the paint)

| # | decision | what it changes | recorded in |
|---|---|---|---|
| D1 | Apply the ready `_shift` repair to `buddha-rig-art.py` (both-edge fill; the fixed copy lives in `app/scripts/holdout-validation.py`) | makes the pipeline's plate deterministic; today the silhouette membrane's output can depend on allocator garbage when its mask touches the cascade border | `HOLDOUT-VALIDATION.md` §1 |
| D2 | Fix `_kept()` to the gesture's real angles (arm −15…+6, grapes −4.5…+4) instead of ±both signs | the pipeline's own exposed set shrinks from ~36,945 px to the gesture's true 21,350 px; any pipeline re-run before this fix re-guesses the same wrong scope | `ARTWORK-RECONSTRUCTION.md` §7 |
| D3 | Region #6 (`keyform-package/PROPOSAL-region6.json`): paint the ~5,848 page-blend px outside the current regions — 4,146 of them are **rest-visible**, so this changes the shipped look | removes the faint baked pattern and its in-motion amplification | `master-checker-inventory.json`, `68-master-checker-defect.png` |

## 1. Paint delivery and acceptance (the current blocker)

```
/tmp/venv/bin/python app/scripts/keyform-acceptance.py --paint <delivery-dir>
```

Numeric gate: sizes, non-hole = master, hole opaque, sky guard, REST alpha diff 0,
REST vs master on the figure 0, rig restored clean. Then the human pass: the
pose row and the per-region 2×/4× sheets, judged on the five comparisons (folds,
gradients, highlights, texture frequency, boundary transitions).

## 2. Promote the accepted plate (decision)

The acceptance harness already builds the composed plate (master outside the
holes + paint inside, alpha carried). If the paint passes, promoting that
composed image to `app/public/img/cosmetics/rig/clean-plate.webp` is a **decision
— it writes a tracked asset**. The pipeline's exemplar fill is superseded on
exactly the painted pixels; nothing else in the plate changes (REST equality is
the proof).

## 3. Pipeline repairs (decisions D1 + D2, then one re-run)

With the paint promoted, re-run `buddha-rig-art.py` **after** applying D1+D2 so
the regenerated plate inherits the fixes; verify the painted pixels survive the
re-run (the re-run must either load the painted keyform or leave those px
untouched — that wiring is part of this step, reviewed then). Verify:
`grep -c snap_to_edges` stays 0; the gesture sheet regenerates; Gate A
(`gate-a-artwork.py`) PASSes; `rig-buddha.py` health checks pass.

## 4. Animation gate and production wiring

Gate B (`gate-b-animation.py`) across REST/−3/−7/−15/+6 — the 8-item gate (no
shoulder gap, ripped cutout, collapsing arm, necklace discontinuity, impossible
elbow, lighting discontinuity, exposed missing pixels, gold tearing). The CSS
keyframes (`buddha-reach`, `buddha-grapes`) already exist and do not change.
Only then: real-browser verification and the §31 18-item report.

## Standing rules that do not change

The master is the sole reference; the rig (GROUP/CLUSTER/masks/deformation/
animation range/CSS/layer structure) is not touched to hide defects; no
diffusion/texture-synthesis/generic fills; no blur/feather/glow; every claim
visually inspected at 1×/2×/4× before "done".
