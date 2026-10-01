# Rejection record — reconstruction methods tried and rejected (session log)

The evidence sheets from this window were lost to workspace reset #20 before
they could be committed. They are NOT re-run (each re-run of a rejected method
is banned). The verdicts and the measured numbers from the session log stand as
the record; the surviving committed evidence is `HOLDOUT-VALIDATION.md` (the
original patch-copy rejection, committed) and `69-*` is void.

| method | what it was | holdout (session-measured) | verdict |
|---|---|---|---|
| patch-copy / exemplar fill | pipeline's own Criminisi fill | mean err 5.7–21.1, texture −2%…−29% | **REJECTED** (committed record: `HOLDOUT-VALIDATION.md`) |
| harmonic-only (fixed `_shift`, figure-rim boundary) | smooth per-channel continuation from the hole's own figure rims | fair boxes (measured-smooth): mean 10.6–25.2, p90 21–49; structure boxes: mean 50.7–56.5 | **REJECTED for structured artwork**: erases folds/bead chains/sheen — "plastic" gold. At 2×/4× the smooth passages also lose the master's sheen band and grain |
| harmonic + mirrored master texture | harmonic surface + 0.5× reflected rim high-frequency | texture energy matched (belly 1.09×) but at 4× it **fabricated mirror-geometry streaks** alien to the master | **REJECTED** (synthetic geometry — a direct reject criterion) |
| authored-stroke machinery, first cut | row-wise base + traced profile strokes (occlusion/gap/lens) | holdout on structure cores: mean ≈56 — and the general machinery was still an algorithm, not artwork | **WITHDRAWN by directive**: the phase is manual painting, not another algorithm |

**Standing consequence:** smooth continuation is claimed only where the master
itself is smooth and the rims give evidence on both sides; everywhere a
structure should continue without direct evidence, pixels are left explicitly
UNRESOLVED (transparent in the delivery + flagged), never forced opaque.

The immutable master, the frozen rig, the committed keyform package and all
committed evidence are untouched by this record.
