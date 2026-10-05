# The living Golden Buddha — evidence index (round 57)

Status: **complete and proven on both tracks; NOT wired into the production
page.** Per instruction, the flip (replacing the card's CSS character stack
with the rig renderer) happens only on explicit authorization.

## Spec → artifacts (CHARACTER_ANIMATION.md)

| Spec section | Delivered | Where |
|---|---|---|
| §4 hierarchy + parameters | bones shoulder→elbow→wrist(+grapes pivot), curves arm_angle/grape_sway/breath/blink + handover window, all from the production CSS clocks | `buddha-rig.json` (`curves`, `bones`); authored by `app/scripts/rig-export.py` |
| §5 hidden pixels (draw-behind) | the accepted lowered pose (drawn-behind hand+grapes+sleeve) in the stepped handover; the clean plate admitted ONLY as the boundary-continuation pass with in-material gold | `buddha-rig/{lowered,plate-backing}.png`; filters in `rig-export.py` / `rig-cycle.py` |
| §6 keyforms | painted compression/stretch patches (09d/e/f), blink/smile/brow/mouth-cheek face patches, all re-cut under the registration law | `parts/*c2-*.png`; `app/scripts/rig-face-recut.py` |
| §7 renderer | PixiJS MeshGeometry runtime, MIT, vendored byte-identical (sha256 in `vendor/NOTICE.md`) | `app/public/js/buddha-rig.js`; preview `buddha-rig-preview.html`; vendor `pixi.min.js` 7.4.2 |
| §9 assets 1–7 | all numbered order items delivered or proven unnecessary (necklace front/back flip never triggers — PROOF 4) | `parts/` (41 files), `buddha-rig/` (13 textures) |
| §10 pipeline | separation (proven extractor) → clean plate → rig authoring as JSON → runtime → curves → verification; all six steps exist and run | `app/scripts/rig-parts-eval.py`, `rig-cycle.py`, `rig-export.py`, `js/buddha-rig.js`, this folder's sheets |
| §14 tests | REST bit-equality (Python, 0/82,442 px; browser, 0 px/138 dB outside the sway band); motion-bound handover edges (0 stray px ×4); vertex checks (no inversion, locality ≤11.6px); flicker scan (Python 0.25s + browser 1s, all spikes explained); master-gap constancy (spread 7 px); reduced-motion still; determinism | `rig-runtime-proof.py` + `ci/eyes/rig-runtime-proof.mjs` + `ci/eyes/rig-live-smoke.mjs`; Python suite at the end of `rig-cycle.py` |

## Proof numbers that matter

- Python REST (t=0, full figure): **0 diffs** outside the grape sway band.
- Browser REST (WebGL): **0 px differ, PSNR 138 dB** outside the sway band.
- Necklace draw-order sweep: **0 px contact** across arm_angle −15…+6 —
  the master stacking is correct everywhere in-range.
- Handover: bare cut 23,258 see-through px at −15° → **0** over
  plate+lowered; swap edges motion-bound with **0 stray px**.
- Plate cleanup: 602 px outside the master's material envelope + 847
  filament px evicted; the master itself carries the beige signature at
  0.90%, so the residual 26 sub-perceptual specks are in-material (recorded).
- Runtime parity (node): curve parity 5.3e-15, LBS(0) identity 1.1e-13,
  no inverted triangles, breath border-tapered. **ALL PASS.**

## The one open action

The **production flip**: mount `BuddhaRig` on the wearing card and retire the
CSS character stack (CSS keeps gloss/aura/particles per §8). Everything it
needs is proven, committed, and reproducible from the scripts. Awaiting
explicit authorization.
