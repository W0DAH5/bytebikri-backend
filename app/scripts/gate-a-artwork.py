#!/usr/bin/env python3
"""GATE A — the artwork's integrity. Not Gate B.

    python3 app/scripts/gate-a-artwork.py        # exit 1 if the gate fails

The brief wants two gates and refuses to let animation soundness excuse the
drawing: Gate B is "does it move right", Gate A is "is the drawing still the
drawing". This file answers ONLY Gate A, at master resolution, and renders the
answer as a sheet a person can look at, because automated tests alone are not the
claim of done.

What it measures:

  1. THE FIGURE, PIXEL FOR PIXEL. The layers composited exactly as the runtime
     draws them (plate -> arm -> grapes), at rest, against the frozen master,
     restricted to the master's own figure. Outside the limb's footprint this must
     be the master exactly — no invented pixels where the master already showed
     something.

  2. THE DETAIL THAT MUST SURVIVE. Edge energy (mean absolute gradient) over the
     drawing only, in the hand, the grapes, the forearm, the shoulder and the
     face: a blurred hand, a fused cluster or a smeared stem reads LOWER than the
     master. Nothing in this pipeline resamples the artwork, so the honest
     expectation is equality, not "close enough".

  3. WHAT THE MASTER CARRIES THAT THE DRAWING DOES NOT. The master is a flat RGB
     image whose background is a BAKED TRANSPARENCY CHECKERBOARD (254/241 on a
     ~43 px period, ~3.1e5 px) — mode RGB, no alpha channel at all. The artist's
     own RGBA asset marks every one of those pixels transparent, so it is the
     export's backdrop: painting it back would draw a grey checkerboard behind the
     Buddha. Recorded so nobody rediscovers it, and so this gate's figure-only
     scope is a decision with a number behind it.
"""
import json
import os
import sys

import numpy as np
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.dirname(HERE)
COS = os.path.join(APP, "public", "img", "cosmetics")
RIG = os.path.join(COS, "rig")
OUT = os.path.normpath(os.path.join(APP, "..", "docs", "evidence", "round56"))

MASTER = os.path.join(COS, "mascot-gold-buddha-base.png")
ALPHA = os.path.join(COS, "master-alpha.png")
LAYERS = [("plate", "clean-plate.webp"), ("arm", "arm.webp"), ("grapes", "grapes.webp")]

# The features, located on the master itself and checked against
# 16-gate-a-regions.png. The first set of boxes came from doubling the 768 scene's
# coordinates and framed the WRONG THINGS — the box labelled "grapes" was showing
# the laughing face, and a gate that crops the wrong region passes for the wrong
# reason.
REGIONS = [
    ("hand", (650, 5, 800, 110)),
    ("grapes", (640, 70, 790, 210)),
    ("arm (forearm)", (470, 10, 680, 200)),
    ("shoulder", (460, 100, 610, 250)),
    ("face", (830, 60, 1030, 260)),
]
ZOOMS = (1, 2, 4)
TOL = 4            # a level nobody can see; the same threshold the art script uses
DETAIL_TOL = 0.5   # at 1:1 there is no resampling to excuse


def load():
    m = np.asarray(Image.open(MASTER).convert("RGB")).astype(np.int16)
    a = np.asarray(Image.open(ALPHA))
    a = a.astype(np.float32) / 255.0 if a.max() > 1 else a.astype(np.float32)
    if a.shape[:2] != m.shape[:2]:
        a = np.asarray(Image.fromarray((a * 255).astype(np.uint8))
                       .resize((m.shape[1], m.shape[0]), Image.LANCZOS)).astype(np.float32) / 255.0
    lay = {}
    for name, fn in LAYERS:
        im = Image.open(os.path.join(RIG, fn)).convert("RGBA")
        if im.size != (m.shape[1], m.shape[0]):
            sys.exit(f"{fn} is {im.size}, the master is {(m.shape[1], m.shape[0])} — "
                     f"Gate A compares at master resolution or it compares nothing")
        lay[name] = np.asarray(im)
    return m, a, lay


def compose(lay, stage):
    """Exactly what the runtime draws, at rest — all in 0..1, straight alpha.

    Mixing 0..1 and 0..255 here produces a black render and a gate that fails for
    the wrong reason. It did, once, and the black sheet is why.
    """
    canvas = np.zeros((*lay["plate"].shape[:2], 4), np.float32)
    canvas[..., :3] = stage
    canvas[..., 3] = 1.0
    for name, _ in LAYERS:
        src = lay[name].astype(np.float32) / 255.0
        sa = src[..., 3:4]
        canvas[..., :3] = src[..., :3] * sa + canvas[..., :3] * (1 - sa)
        canvas[..., 3] = sa[..., 0] + canvas[..., 3] * (1 - sa[..., 0])
    rgb = canvas[..., :3] * canvas[..., 3:4] + stage * (1 - canvas[..., 3:4])
    return np.clip(np.rint(rgb * 255.0), 0, 255).astype(np.int16)


def edge_energy(gray, mask):
    """Mean absolute gradient OVER THE DRAWING ONLY.

    Masked, because the master is flat onto a backdrop that carries its own
    gradients: unmasked, every comparison is flattered or penalised by the
    background rather than by the artwork.
    """
    g = gray.astype(np.float32)
    gx = np.abs(np.diff(g, axis=0)); mx = mask[1:] & mask[:-1]
    gy = np.abs(np.diff(g, axis=1)); my = mask[:, 1:] & mask[:, :-1]
    return float(gx[mx].mean() + gy[my].mean())


def main():
    m, alpha, lay = load()
    fig = alpha > 0.5
    clean = (~fig) & (np.abs(m - 255).max(axis=2) <= TOL)
    stage = np.median(m[clean].astype(np.float32), axis=0) / 255.0
    comp = compose(lay, stage)
    diff = np.abs(comp - m).max(axis=2)

    covered = np.zeros(fig.shape, bool)
    for name in ("arm", "grapes"):
        covered |= lay[name][..., 3] > 0

    inside = int(fig.sum())
    bad_uncovered = int((diff[fig & ~covered] > TOL).sum())
    bad_covered = int((diff[fig & covered] > TOL).sum())

    print("GATE A — artwork integrity, at master resolution, 1:1")
    print(f"   master            {os.path.relpath(MASTER, APP)}")
    print(f"   figure pixels     {inside:,} of {fig.size:,}")
    print("   composite vs master, inside the figure:")
    print(f"        outside the layers (no excuse here)   {bad_uncovered:,} px > {TOL} levels")
    print(f"        under the layers (the rest state)     {bad_covered:,} px > {TOL} levels")
    print(f"        mean error inside the figure          {diff[fig].mean():.3f} levels, "
          f"max {int(diff[fig].max())}")

    band = np.zeros(fig.shape, bool)
    for name in ("arm", "grapes"):
        al = lay[name][..., 3].astype(np.float32) / 255.0
        band |= (al > 0.002) & (al < 0.998)
    fringe = int((diff[fig & band] > TOL).sum())
    print(f"   the layers' own partial alpha: {int(band.sum()):,} px, {fringe:,} of them "
          f"differ > {TOL} (the master's alpha is opaque where it is figure, so this is "
          f"plate-under-fringe, not a blur)")

    detail, fails = {}, []
    mg = np.asarray(Image.fromarray(m.astype(np.uint8)).convert("L"))
    cg = np.asarray(Image.fromarray(comp.astype(np.uint8)).convert("L"))
    print("\n   detail, as edge energy (lower = softer than the master = FAIL)")
    for name, (x0, y0, x1, y1) in REGIONS:
        fm = fig[y0:y1, x0:x1]
        em = edge_energy(mg[y0:y1, x0:x1], fm)
        ec = edge_energy(cg[y0:y1, x0:x1], fm)
        ok = ec >= em - DETAIL_TOL
        detail[name] = {"box": [x0, y0, x1, y1], "master": round(em, 3),
                        "rig": round(ec, 3), "verdict": "ok" if ok else "SOFTER"}
        if not ok:
            fails.append(name)
        print(f"        {name:15s} master {em:6.2f}   rig {ec:6.2f}   {'ok' if ok else 'SOFTER — FAIL'}")

    bg_mask = ~fig
    offwhite = np.abs(m - 255).max(axis=2)
    wash = bg_mask & (offwhite > TOL)
    drawn = Image.open(os.path.join(COS, "mascot-gold-buddha-base.webp")).convert("RGBA")
    d768 = np.asarray(drawn.resize((m.shape[1], m.shape[0]), Image.LANCZOS))[..., 3]
    wash_detail = {
        "what": "a baked transparency checkerboard (254/241, ~43 px period), not a wash",
        "pixels": int(wash.sum()),
        "levels_off_white_mean": round(float(offwhite[wash].mean()), 2) if wash.sum() else 0.0,
        "levels_off_white_max": int(offwhite[wash].max()) if wash.sum() else 0,
        "drawn_asset_alpha_there": round(float((d768[wash] >= 128).mean()), 4) if wash.sum() else None,
        "excluded_because": "the master is flat RGB — no alpha — over a baked transparency "
                            "checkerboard; the artist's own RGBA asset marks exactly these pixels "
                            "transparent, so it is the backdrop, not the character. Painting it "
                            "back would draw a grey checkerboard behind the Buddha.",
    }
    print(f"\n   the backdrop, measured and excluded: {wash_detail['pixels']:,} px of a baked "
          f"checkerboard, mean {wash_detail['levels_off_white_mean']} levels off white; the drawn "
          f"asset calls them transparent ({wash_detail['drawn_asset_alpha_there']:.1%} opaque)")

    # ── the sheet ───────────────────────────────────────────────────────────
    _stage_rgb = np.clip(np.rint(stage * 255.0), 0, 255).astype(np.uint8)[None, None, :]
    show_m = Image.fromarray(np.where(fig[:, :, None], m, _stage_rgb).astype(np.uint8))
    show_r = Image.fromarray(np.where(fig[:, :, None], comp, _stage_rgb).astype(np.uint8))
    pad, lab = 10, 20
    cells = []
    for name, box in REGIONS:
        tiles = []
        for z in ZOOMS:
            size = ((box[2] - box[0]) * z, (box[3] - box[1]) * z)
            tiles.append((z, show_m.crop(box).resize(size, Image.NEAREST),
                          show_r.crop(box).resize(size, Image.NEAREST)))
        cells.append((name, tiles))
    col_w = [max(t[1].width for _, ts in cells for t in ts if t[0] == z) + pad for z in ZOOMS]
    row_h = max(max(t[1].height for t in ts) for _, ts in cells) * 2 + 6
    W = pad + sum(col_w)
    H = lab + len(cells) * (row_h + lab + pad) + (row_h + lab + pad)
    sheet = Image.new("RGB", (W, H), (24, 24, 28))
    d = ImageDraw.Draw(sheet)
    d.text((10, 4), "GATE A — the artwork at 1x / 2x / 4x.   Each pair: MASTER above, "
                    "rig layers at rest below.", fill=(150, 220, 255))
    y = lab
    for name, tiles in cells:
        x = pad
        d.text((x + 2, y - 14), name, fill=(255, 220, 80))
        for z, a_, b_ in tiles:
            sheet.paste(a_, (x, y))
            sheet.paste(b_, (x, y + a_.height + 6))
            d.text((x + 2, y + 2), f"{z}x", fill=(80, 240, 160))
            x += max(a_.width, b_.width) + pad
        y += row_h + lab + pad
    d.text((pad + 2, y - 14), "the master's baked transparency checkerboard, amplified 8x "
                              "(the export's backdrop, excluded on purpose — see the header)",
           fill=(255, 140, 140))
    sheet.paste(Image.fromarray(np.clip(offwhite * 8, 0, 255).astype(np.uint8))
                .resize((W - 2 * pad, row_h), Image.LANCZOS), (pad, y))
    os.makedirs(OUT, exist_ok=True)
    sheet_path = os.path.join(OUT, "14-gate-a-artwork.png")
    sheet.save(sheet_path)

    summary = {
        "master": os.path.relpath(MASTER, APP), "figure_px": inside,
        "composite_vs_master": {
            "outside_layers_px_over_tol": bad_uncovered,
            "under_layers_px_over_tol": bad_covered,
            "tolerance_levels": TOL,
            "mean_levels": round(float(diff[fig].mean()), 3),
            "max_levels": int(diff[fig].max()),
            "partial_alpha_px": int(band.sum()), "partial_alpha_over_tol": fringe,
        },
        "detail": detail, "detail_failures": fails, "stage_wash": wash_detail,
        "sheet": os.path.relpath(sheet_path, os.path.dirname(OUT)),
    }
    with open(os.path.join(OUT, "14-gate-a-artwork.json"), "w") as fh:
        json.dump(summary, fh, indent=2)

    fail = bad_uncovered > 0 or bad_covered > 0 or fails
    print(f"\n   GATE A: {'FAIL' if fail else 'PASS'}   sheet → {sheet_path}")
    return 1 if fail else 0


if __name__ == "__main__":
    sys.exit(main())
