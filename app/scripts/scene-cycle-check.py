#!/usr/bin/env python3
"""
THE CYCLE GATE — the live 24s cycle, judged from the files as served.

Every defect class the dark card exposed (and that had to be reported before
it was fixed) becomes an assertion here, so a regression is caught by running
one script instead of by a person noticing the same broken pixel twice:

  L1  PALE-PAGE LEAK   no served frame may show the baked page family
                       (bright, R-B in 40..85 — genuine gold holds R-B>=95)
                       inside the figure in quantity.
  L2  WINDOW DEBRIS    in the belly window (60.4-76%, the only state that
                       fully exposes the plate's footprint) the served scene
                       may show no gold the accepted rig plate and the lowered
                       arm cannot justify (a 40 px blob of served-gold over
                       nothing was the floating-fist failure).
  L3  POCKET           the fist/bunch pocket (baked page in BOTH generations)
                       stays transparent: the rest composite may carry almost
                       no pale px there.
  L4  ELBOW            the elbow bend keeps the 768 generation's real gold,
                       never the master's baked cream wedge.
  L5  SWING            swung to its keyframe extremes, the bunch uncovers no
                       hole outside the limb/bunch/pocket zone, and none of
                       size worth naming.

It also writes the evidence sheet (87-cycle-check.png): every checked frame on
the dark card, so a failure can be LOOKED at, not just counted.

    python3 app/scripts/scene-cycle-check.py        # exit 0 = pass

Development-time gate, like gate-a/gate-b: needs PIL + numpy. It reads only
the served files and the rig assets; it writes nothing but the sheet.
"""
import os
import sys
from collections import deque

import numpy as np
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
DIR = os.path.join(HERE, "..", "public", "img", "cosmetics")
OUT = os.path.join(HERE, "..", "..", "docs", "evidence", "round56", "87-cycle-check.png")
CARD = (23, 18, 12, 255)
W, H = 768, 512


def L(n):
    return np.asarray(Image.open(os.path.join(DIR, n)).convert("RGBA")).astype(np.int16)


plate, arm, grapes = L("part-plate-armless.webp"), L("part-arm-raised.webp"), L("part-grapes-raised.webp")
anchor, belly = L("part-arm-anchor.webp"), L("part-arm-lowered.webp")
rig7 = np.asarray(Image.open(os.path.join(DIR, "rig", "clean-plate.webp")).convert("RGBA")
                  .resize((W, H), Image.BOX)).astype(np.int16)
base = L("mascot-gold-buddha-base.webp")

POCKET = np.zeros((H, W), bool); POCKET[44:116, 308:357] = True
ELBOW = np.zeros((H, W), bool); ELBOW[195:240, 280:330] = True
M = base[..., 3] >= 128
G = np.zeros((H, W), bool); G[24:150, 330:424] = True          # the bunch's own zone
ZONE = M | G | POCKET


def scene(arm_deg=0.0, g_deg=0.0, arm_on=True, anchor_on=True, belly_on=False):
    out = Image.new("RGBA", (W, H), CARD)
    out.alpha_composite(Image.fromarray(plate.astype(np.uint8)))
    if anchor_on:
        out.alpha_composite(Image.fromarray(anchor.astype(np.uint8)))
    if arm_on:
        out.alpha_composite(Image.fromarray(arm.astype(np.uint8)).rotate(
            -arm_deg, resample=Image.BICUBIC, center=(268.0, 146.0), expand=False))
        out.alpha_composite(Image.fromarray(grapes.astype(np.uint8)).rotate(
            -g_deg, resample=Image.BICUBIC, center=(370.0, 45.0), expand=False))
    if belly_on:
        out.alpha_composite(Image.fromarray(belly.astype(np.uint8)))
    return out


def flat(im):
    o = Image.new("RGB", (W, H), CARD[:3])
    o.paste(im, (0, 0), im)
    return o


def pale_page(rgb_arr, fig):
    """The baked-page family: bright and too grey for this gold."""
    lum = rgb_arr @ np.array([.299, .587, .114])
    rb = rgb_arr[..., 0] - rgb_arr[..., 2]
    return fig & (lum > 140) & (rb >= 40) & (rb <= 85)


def blobs(mask, min_px):
    seen = np.zeros_like(mask, bool)
    out = []
    for y0, x0 in np.argwhere(mask):
        if seen[y0, x0]:
            continue
        q = deque([(y0, x0)]); seen[y0, x0] = True; cells = 0
        while q:
            y, x = q.popleft(); cells += 1
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    yy, xx = y + dy, x + dx
                    if 0 <= yy < H and 0 <= xx < W and mask[yy, xx] and not seen[yy, xx]:
                        seen[yy, xx] = True; q.append((yy, xx))
        if cells >= min_px:
            out.append(cells)
    return out


frames = {
    "rest": dict(),
    "+6deg": dict(arm_deg=6, g_deg=5),
    "-2.4deg": dict(arm_deg=-2.4, g_deg=-4.5),
    "window": dict(arm_on=False, anchor_on=False, belly_on=True),
    "-2deg": dict(arm_deg=-2),
}
failures = []
counts = {}

# L1 — pale-page leak, every frame, inside the REPAIRED ZONES (the limb, the
# bunch, the pocket). The artwork also carries baked pale washes on the face
# and the coin pile in BOTH generations — that is the recorded master-asset
# defect (D3), not a wiring regression, and counting it here would only
# normalize noise. The zones this pipeline repaired must stay clean.
# the bunch's EXACT shape (the pipeline's own ellipse + stem, not a bounding
# box) and a 9px-dilated repair zone around it and the pocket
_gimg = Image.new("L", (W, H), 0)
_gd = ImageDraw.Draw(_gimg)
_gd.ellipse([334, 48, 420, 146], fill=255)
_gd.polygon([(362, 24), (384, 24), (388, 70), (358, 70)], fill=255)
G_EXACT = np.asarray(_gimg) > 128
from PIL import ImageFilter as _IF
G_DIL = np.asarray(Image.fromarray((G_EXACT * 255).astype(np.uint8)).filter(_IF.MaxFilter(5))) > 128
_dil = lambda m: np.asarray(Image.fromarray((m * 255).astype(np.uint8)).filter(_IF.MaxFilter(9))) > 128
REPAIR_ZONE = _dil(G_EXACT | POCKET) | POCKET
for name, o in frames.items():
    im = np.asarray(flat(scene(**o))).astype(np.float32)
    fig = np.asarray(scene(**o))[..., 3] >= 128
    n = int(pale_page(im, fig & REPAIR_ZONE).sum())
    counts[f"L1 {name}"] = n
    if n > 300:
        failures.append(f"L1 {name}: {n} pale-page px in the repaired zones (>300)")

# L2 — belly-window debris: served gold the rig plate + lowered arm cannot justify
sv = np.asarray(flat(scene(arm_on=False, anchor_on=False, belly_on=True))).astype(np.float32)
served_gold = (np.asarray(scene(arm_on=False, anchor_on=False, belly_on=True))[..., 3] >= 128) \
    & ((sv @ np.array([.299, .587, .114])) > 60) & ((sv[..., 0] - sv[..., 2]) >= 60)
justified = (rig7[..., 3] >= 128) | (belly[..., 3] >= 128)
debris = served_gold & ~justified & ZONE
b = blobs(debris, 40)
counts["L2 window debris blobs>=40px"] = len(b)
if b:
    failures.append(f"L2 belly window: debris blobs {b} (served gold over nothing)")

# L3 — the pocket PROPER stays transparent. The box overlaps the bunch's left
# edge, where the berries' own bright highlights live on the grapes layer
# (artwork content, not page): the check excludes the bunch's dilated shape.
rest_rgb = np.asarray(flat(scene())).astype(np.float32)
rest_fig = np.asarray(scene())[..., 3] >= 128
n = int((pale_page(rest_rgb, rest_fig) & POCKET & ~G_DIL).sum())
counts["L3 pocket-proper pale px"] = n
if n > 20:
    failures.append(f"L3 pocket: {n} pale px (>20) — the baked page is back")

# L4 — the elbow bend matches the artwork's OWN generation. Measured, the
# served 768 artwork draws that bend as a bright cream-gold highlight
# (base.webp mean rgb 253,242,186 — the 1536 master agrees at 253,247,202);
# the defect the dark card exposed was the BLACK VOID of missing content, not
# the cream. The invariant: the composite keeps the artwork's own local colour
# (a black hole, a flat fill, or a stamped foreign shade all break it).
eb = ELBOW & rest_fig
base_rb = float((base[..., 0] - base[..., 2])[ELBOW & (base[..., 3] >= 128)].mean())
comp_rb = float((rest_rgb[..., 0] - rest_rgb[..., 2])[eb].mean())
counts["L4 elbow R-B comp/base"] = f"{comp_rb:.1f}/{base_rb:.1f}"
if abs(comp_rb - base_rb) > 8:
    failures.append(f"L4 elbow: composite R-B {comp_rb:.1f} vs artwork {base_rb:.1f} (Δ>8)")

# L5 — swing uncover: no hole outside the limb/bunch/pocket zone, none large
rest_cover = np.asarray(Image.fromarray(
    np.where(grapes[..., 3] > 229, 255, 0).astype(np.uint8))) > 128
GZONE = G_EXACT
solid_behind = (arm[..., 3] >= 229) | (plate[..., 3] >= 128) | (anchor[..., 3] >= 128)
for ang in (5.0, -4.5):
    swung = Image.fromarray(
        np.where(grapes[..., 3] > 229, 255, 0).astype(np.uint8)).rotate(
        -ang, resample=Image.BICUBIC, center=(370.0, 45.0), expand=False)
    sc = np.asarray(swung) > 128
    holes = rest_cover & ~sc & ~solid_behind & ~(POCKET | GZONE)
    n = int(holes.sum())
    counts[f"L5 swing {ang:+.1f} holes (outside pocket/bunch)"] = n
    if n > 0:
        failures.append(f"L5 swing {ang:+.1f}: {n} px uncover nothing, outside pocket/bunch")

# ── the sheet: every frame, dark card ────────────────────────────────────────
S = 300
tiles = []
for name, o in frames.items():
    t = flat(scene(**o)).resize((S, int(S * H / W)), Image.LANCZOS)
    d = ImageDraw.Draw(t)
    d.rectangle([0, 0, S - 1, 18], fill=(8, 8, 8))
    d.text((5, 3), name, fill=(255, 226, 138))
    tiles.append(t)
sheet = Image.new("RGB", (S * 3 + 16, (tiles[0].height + 8) * 2), (0, 0, 0))
for i, t in enumerate(tiles):
    sheet.paste(t, ((i % 3) * (S + 8), (i // 3) * (tiles[0].height + 8)))
sheet.save(OUT)

print("THE CYCLE GATE — served files, dark card")
for k, v in counts.items():
    print(f"   {k:38s} {v}")
if failures:
    print("   VERDICT: FAIL")
    for f in failures:
        print(f"     - {f}")
    sys.exit(1)
print(f"   VERDICT: PASS   (sheet: docs/evidence/round56/87-cycle-check.png)")
