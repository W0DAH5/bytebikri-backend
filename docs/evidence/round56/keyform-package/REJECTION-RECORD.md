
## Stroke holdout — the 4× inspection (recorded from the in-session reading; sheet lost in reset #20, not regenerated)

`70-stroke-holdout-4x.png` compared known artwork (the real jaw-shadow channel
and the real arm-gap core) against the stroke model's rebuild. mean 56.32 /
57.25, p90 107 / 125, max 181 / 218. The specific failures, by category:

- **geometry/shape mismatch** — the rebuild is horizontal smears; the master's
  structures are curved (bead circles, the seam's diagonal). Every structure
  edge is a white blob in the difference map.
- **fold/contour discontinuity** — the shadow's double-dip core and its
  contour-following width are gone; strokes do not connect rim to rim along
  the structure, only along image rows.
- **incorrect lighting/highlight** — the traced bounced-light shoulder
  (~79 lum between the dips) is flattened out; the gap's mid-tone rise is
  lost.
- **texture/brushwork loss** — total. The master's mottled gold grain is
  absent, and the row-wise interpolation adds banding of its own.
- **incorrect colour/material** — the gap rebuild shows hue-shifted streaks
  (luminance-only rescaling moved RGB off the master's gold axis): the
  material reads wrong, not just dark.
- **invented/missing detail** — the bead row's beads are simply missing;
  the banding is invented structure.

Verdict: the stroke model cannot reproduce the master's artwork language.
Per directive, automated reconstruction is STOPPED; all R01–R05 pixels are
declared unresolved for manual artist painting (DELIVERY/STATUS.md,
DELIVERY/UNRESOLVED-FOR-ARTIST.json). No acceptance run, no promotion, no
production wiring. The lineage descended from this model (the authored
executor r1–r5) is withdrawn as a delivery by the same verdict.
