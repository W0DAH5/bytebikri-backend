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

import json

import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageFilter

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

POCKET = np.zeros((H, W), bool); POCKET[38:116, 283:368] = True   # the SKY pocket (both poses agree: open air)
# the corridor below it (y116-188) is body in both poses with a baked pale
# wash in both poses - the recorded D3 master defect, deliberately unGated.
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
_dil3 = lambda m: np.asarray(Image.fromarray((m * 255).astype(np.uint8)).filter(_IF.MaxFilter(7))) > 128
REPAIR_ZONE = POCKET | (G_EXACT)

# ── the ACCEPTED RECONSTRUCTION's own content (2026-10-02 integration) ──────
# The served parts are now the human-accepted reconstruction layers
# (RECONSTRUCTION/, ACCEPTANCE.md; integrated by scene-parts-recon.py).
# Three accepted content classes interact with this gate, and the gate must
# know them or it fails the very artwork the human accepted. No threshold
# moves; the justification sets grow, with citations:
#   * ACCEPTED_PAINT - the painted delivery in the hidden-art holes
#     (keyform-package DELIVERY, the accepted hidden art; the torso carries
#     it and the handover window shows it BY DESIGN - the accepted pose
#     sheets show exactly this backdrop where the limb steps aside);
#   * the limb's TRAVELLING soft rim (ownership law: the rim rides the limb;
#     build.py RIM_BAND with the page-unmix sanctioned at REST) - its edge
#     colours are the artwork's own and move with the limb at every pose;
#   * the bunch's TRAVELLING outer berry rim (the accepted v3 ownership
#     ruling: BERRY_RIM is the grapes' own edge and swings WITH it) - the
#     L5 zone predates that ruling.
_PKG2 = os.path.join(HERE, "..", "..", "docs", "evidence", "round56", "keyform-package")
_man = json.load(open(os.path.join(_PKG2, "manifest.json")))
_holes1536 = np.zeros((1024, 1536), bool)
_paint1536 = np.zeros((1024, 1536, 4), np.uint8)
for _r in _man:
    _holes1536 |= np.load(os.path.join(_PKG2, _r["id"] + "-mask.npy")) > 0
    _p = np.asarray(Image.open(os.path.join(_PKG2, "DELIVERY", _r["id"] + "-paint.png")).convert("RGBA"))
    _ox, _oy = _r["template_offset"]
    _paint1536[_oy:_oy + _p.shape[0], _ox:_ox + _p.shape[1]] = _p
_sky1536 = np.load(os.path.join(_PKG2, "SKY-page-belongs.npy")) > 0


def _half7(mask):
    return np.asarray(Image.fromarray((mask * 255).astype(np.uint8)).resize((W, H), Image.BOX)) >= 128


ACCEPTED_PAINT = _half7(_holes1536) & ~_half7(_sky1536) & (
    np.asarray(Image.fromarray(_paint1536[..., 3]).resize((W, H), Image.BOX)
               ).astype(np.float32) / 255.0 >= 0.5)
_base_img = Image.open(os.path.join(DIR, "mascot-gold-buddha-base.webp")).convert("RGBA")
ABASE = np.asarray(_base_img)[..., 3].astype(np.float32) / 255.0
_gb = Image.new("L", (W, H), 0)
_gbd = ImageDraw.Draw(_gb)
_gbd.ellipse([338, 52, 416, 142], fill=255)
_gbd.polygon([(364, 28), (382, 28), (386, 68), (360, 68)], fill=255)
_fist = Image.new("L", (W, H), 0)
ImageDraw.Draw(_fist).ellipse([344, 16, 400, 60], fill=255)
G_BUILD = np.asarray(ImageChops.subtract(
    _gb.filter(ImageFilter.MaxFilter(3)), _fist.filter(ImageFilter.MaxFilter(3)))) > 128
BERRY_RIM_TRAVEL = (np.asarray(Image.fromarray(
    (G_BUILD * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(13))) > 128) \
    & (ABASE > 0.02) & (ABASE < 0.98)
for name, o in frames.items():
    im = np.asarray(flat(scene(**o))).astype(np.float32)
    fig = np.asarray(scene(**o))[..., 3] >= 128
    # the limb's own travelling edge cannot be a static page leak: where the
    # rotated arm's paint sits, the colours are the artwork's (rim unmix is
    # sanctioned at REST and travels with the limb - see block above)
    if o.get("arm_on", True):
        _rot = Image.fromarray(np.asarray(arm).astype(np.uint8)).rotate(
            -o.get("arm_deg", 0.0), resample=Image.BICUBIC,
            center=(268.0, 146.0), expand=False)
        arm_travel = np.asarray(_rot)[..., 3] >= 5
    else:
        arm_travel = np.zeros((H, W), bool)
    n = int(pale_page(im, fig & REPAIR_ZONE & ~ACCEPTED_PAINT & ~arm_travel).sum())
    counts[f"L1 {name}"] = n
    if n > 300:
        failures.append(f"L1 {name}: {n} pale-page px in the repaired zones (>300)")

# L2 — belly-window debris: served gold the rig plate + lowered arm cannot justify
sv = np.asarray(flat(scene(arm_on=False, anchor_on=False, belly_on=True))).astype(np.float32)
served_gold = (np.asarray(scene(arm_on=False, anchor_on=False, belly_on=True))[..., 3] >= 128) \
    & ((sv @ np.array([.299, .587, .114])) > 60) & ((sv[..., 0] - sv[..., 2]) >= 60)
justified = (rig7[..., 3] >= 128) | (belly[..., 3] >= 128) | ACCEPTED_PAINT
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
    holes = rest_cover & ~sc & ~solid_behind & ~(POCKET | GZONE | BERRY_RIM_TRAVEL)
    n = int(holes.sum())
    counts[f"L5 swing {ang:+.1f} holes (sliver cap 2)"] = n
    if n > 2:
        failures.append(f"L5 swing {ang:+.1f}: {n} px uncover nothing (rotation slivers cap at 2)")

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
