# ARTIST KIT — R01–R05 corrective keyforms

Open each region's `R0X-work-4x.png` in your editor. Paint only inside the
transparent hole. The references: `../R0X-reference-2x.png` (surround at 2x),
`R0X-guide.png` (must-continue structures, measured ramp, brush guidance),
`../manifest.json` (per-row rim anchors in DELIVERY/AUTHORED-STROKES.json).

The one rule: **the master is the sole reference** — its gold, its shadow hue,
its edge sharpness. Continue what the references show crossing the hole.
Anything you judge under-determined: leave FULLY TRANSPARENT and record the
pixels in `R0X-unresolved.png` (white = unresolved, same size as the work
canvas). Never fill to satisfy a checker.

## Deliver

    R0X-paint.png       same size/offset as R0X-work-4x content (save at 1x:
                        the hole painted opaque, unresolved px transparent,
                        every non-hole pixel EXACTLY the master's)
    R0X-unresolved.png  (only if you deferred pixels) white = unresolved

## Then

    /tmp/venv/bin/python app/scripts/keyform-acceptance.py --paint <dir> --unresolved-ok

Deferred px are reported and shown green-on-magenta on the sheets (never
hidden); the five-comparison inspection at 1x/2x/4x across REST/+6/-3/-7/-15
is the real gate. No production wiring until the full acceptance passes.
