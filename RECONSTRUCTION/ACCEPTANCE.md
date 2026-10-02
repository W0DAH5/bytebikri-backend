# VISUAL ACCEPTANCE — the reconstruction candidate is final

- **Accepted by:** the operator (in-session, verbatim below).
- **Date:** 2026-10-02.
- **Accepted state:** `RECONSTRUCTION/` at commit `c347e29`
  ("Classify the -15 pale blob: D3 baked body wash - no repair").
- **Scope:** the layered reconstruction (torso / arm / grapes), REST equality
  against the immutable master, poses REST / +6° / −3° / −7° / −15° inspected
  at 1×/2×/4×, the ownership map, the hidden-art record.
- **D3 ruling (operator):** "the blob's present in the REST master with no
  pose applied, so it's baked into the art, not a reconstruction defect" —
  agreed, left untouched, permanently documented.
- **Production integration:** NOT authorized. It is a separately authorized
  step and remains on hold.

> "Accepted. Reviewed the D3 classification evidence (the blob's present in
> the REST master with no pose applied, so it's baked into the art, not a
> reconstruction defect) — agree with leaving it untouched. RECONSTRUCTION/
> at `c347e29` stands as final.
>
> Separately: lift the hold on the checker-fringe fix — go ahead and re-apply
> it, same evidence/rules as before.
>
> Production-integration is still on hold. Don't start wiring this into
> cosmetics/the live product — I'll tell you explicitly when that's
> authorized."

Post-acceptance edit authorized by the same message: the **checker-fringe
fix** (near-sky page px at the pocket edge, exposed only by the limb's sweep;
removal provably REST-neutral because every affected pixel sits under the
solid limb at rest). Applied after this record; the accepted REST appearance
is unchanged — verified bit-level.

## Re-apply executed (2026-10-02)

Evidence, rules, and result of the authorized re-apply:

- **Class located:** 7,945 px drawn by the torso's static backdrop where the
  lowered artwork is sky only (`M & SOLID & ~HOLES & A_r <= 0.5`). The lowered
  webp stores premultiplied black at alpha 0, so the light-matched backdrop
  fill rendered these as **opaque black placeholders** — hidden by the solid
  limb at REST, swept into view at every pose, and read as a dark mosaic
  against the pale delivery paint (the "checker fringe").
- **Edit:** zeroed `torso_a` on the covered subset only — 7,808 px hidden by
  the solid limb (alpha >= 0.999) or the opaque bunch (post-CREVICE) at REST.
  137 residue px under the limb's own soft edge kept (premultiplied-black
  contributes 0 there; documented in build.py). No painting, no new detector;
  existing masks and committed layer alphas only.
- **REST proof:** recomposed REST is **bit-identical** to the accepted
  composite (straight RGBA: 0 differing px; premultiplied delta 0.0).
  Build proof unchanged: px>32 = 0, px>8 = 0, max 4; raw unsanctioned 0;
  pose voids 0 across all seven renders. Arm/grapes layers byte-unchanged.
- **Result:** visible black-in-sky px per pose 812→12 (+6), 189→8 (−3),
  453→9 (−7), 1134→13 (−15); residue is scattered single px under the limb's
  soft edge. D3 untouched. Evidence: `acceptance/93-fringe-reapply.png`
  (before/after 4× + both mosaic zones at 8×), regenerated pose sheets.
