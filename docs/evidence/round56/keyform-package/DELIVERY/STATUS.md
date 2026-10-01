# STATUS — automated reconstruction STOPPED; all region pixels unresolved for the manual artist

**This directory is NOT a delivery.** Every paint file here (R01–R05
`*-paint.png`, including the authored-executor revisions 1–5) is process
evidence from automated/semi-automated methods that **failed the known-artwork
holdout** and therefore fail the acceptance rule. Per directive:

- patch-copy / exemplar fill — REJECTED (`../../HOLDOUT-VALIDATION.md`, committed);
- harmonic-only — REJECTED (erases structure; "plastic" gold);
- harmonic + mirrored texture — REJECTED (fabricated mirror geometry);
- the stroke model and every implementation descended from it — **REJECTED**:
  the manual stroke holdout on known artwork returned mean error ≈56
  (jaw shadow 56.32 / gap seam 57.25, p90 107/125) against the master's local
  contrast of ~10, and the 4× comparison of that holdout (70-stroke-holdout-4x.png,
  lost in workspace reset #20 before commit; not regenerated — re-running a
  rejected method is banned) showed the failures listed in
  `../REJECTION-RECORD.md` § stroke holdout.

**The affected pixels — all 18,998 px of R01–R05 — are explicitly UNRESOLVED
for manual artist painting.** See `UNRESOLVED-FOR-ARTIST.json` for the
per-region declaration and the evidence a painter should use. Nothing here may
be promoted, composited as final, or wired into production. No acceptance run
has been requested or passed.

Preserved unchanged: the frozen master, the frozen rig, the keyform package,
the committed rejection records, and these process-evidence paints.
