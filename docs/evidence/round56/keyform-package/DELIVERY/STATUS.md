# KEYFORM PAINT DELIVERY — FINAL (AI-artist pass, rev 8)

Date: 2026-10-01. Tip: rev-8 artist pass over the r5 authored base (`paint-keyforms-manual.py`).

## Verdict

- Numeric acceptance gate: **PASS** — painted_opaque == hole_to_paint exactly per region
  (R01 15,580 / R02 2,724 / R03 347 / R04 302 / R05 45 = 18,998 px); unresolved_declared 0;
  nonhole_px_changed 0; sky-in-hole 0; crop sky left transparent 0; rig restored clean
  (rest alpha diff 0; rest-vs-master on figure 0 over 968,982 px).
- Visual inspection (the deciding criterion): **PASS** — all five regions read GOOD at 4x;
  full-pose row (REST/+6/-3/-7/-15) coherent at 1x. Sheets:
  `docs/evidence/round56/67-acceptance-r0X-4x-painted.png`, `67-acceptance-poses-painted.png`,
  `67-acceptance-unresolved-green.png` (empty), `67-acceptance.png`.

## Revisions of record

- R01 rev 6: the 537 px interior-bright wedge (x668-739, y152-235) corrected — 134 px deepened
  to cap = max(adjacent rim lum)+2; grain tooth sigma 8.5 tone-scaled (matches master chest
  skin sigma 12.16 / arm skin 7.23).
- R02 rev 8 (third attempt; rev 6 near-black stair line and rev 7 grey-olive REJECTED): gap
  rebuilt from the master's own sampled gap colour (n=2548 dark px in master[300:440,505:545],
  mean rgb 121.7/58.8/2.2, lum 60.9) with per-row plateau lum = clip(0.55 x arm-rim lum, 48-70).
- R04 rev 6: y72-73 rows painted as vertical continuation.
- R03, R05: r5 authored base, accepted unchanged.

## Method & constraints honoured

Master = sole reference; painting confined to the 18,998 gesture-exposed hole px; non-hole px
bit-identical to the master (gate-enforced); the staircase is left as the recorded asset defect;
no blur/feather/glow/opacity/noise hiding; no diffusion/generic fills; nothing invented — every
stroke traces master evidence (AUTHORED-STROKES.json) or adjacent master artwork.
`artist-final.py` is one-shot from a fresh r5 base, NOT idempotent (re-run would double-apply grain).

## Separate standing issues (NOT part of this delivery)

- Baked page-pattern gaps + 199 enclosed alpha pits inside the figure (master alpha classifies
  them as page; visible as page-colour dots e.g. near the eyebrow in pose sheets) — pre-existing
  master-asset defect, unchanged by this work.
- Limb staircase (recorded); page-blend px (4,146 rest-visible) untouched.

Paints are template-geometry PNGs (`R0X-paint.png`). This file supersedes the earlier
"process evidence, NOT a delivery" note (that state was the pre-painter hand-off record).
