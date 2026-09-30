#!/usr/bin/env python3
"""Separate the golden buddha's arm and grapes from the MASTER, at master resolution.

THE LINEAGE, and it only runs one way:

    MASTER  mascot-gold-buddha-base.png   1536x1024, mode RGB, immutable
      -> master-alpha.png             its silhouette, recovered and checked
      -> CLEAN PLATE  rig/clean-plate.webp
      -> SEPARATED LAYERS  rig/arm.webp  rig/grapes.webp
      -> MESH / WEIGHTS  rig/buddha-rig.json
      -> CORRECTIVE KEYFORMS  (authored in the rig data)
      -> ANIMATION -> BROWSER RENDER

Never: a render -> a new master -> a new extraction -> a new generation. This
file has been rewritten once because it was doing the middle of that chain
backwards, and the rewrite is the subject of `docs/evidence/round56/`.

WHY THE MASTER AND NOT THE 768 STATES. The 768 states carry the artist's own
alpha, which is why the first cut used them — but they are half the master's
resolution, and the brief's resolution clause asks for the higher-resolution
master. The master is a FLAT RGB image (no alpha channel at all): its silhouette
must be recovered, and `master-alpha.py` recovers it and proves it against the
drawn one (IoU 0.9933, contour median 0.0 px). That proof is what licenses this
file to cut the master.

WHAT WENT WRONG BEFORE, in two numbers, because both are now asserted away:

  * 99% of the grape cluster sat in the ARM's layer (a 6 degree sway uncovered
    698 px of stale cluster), and 736 px of the HAND sat in the GRAPE layer, the
    inheritance of a stamped rectangle. The layers are disjoint by construction
    now, and the stem is traced from the master's own dark ridge instead of
    being drawn as a box.
  * the arm-down state was used as a source. It is a different pose at half
    resolution, so pixels that were never in the master's picture entered the
    plate. The plate now starts as the master, and the ONLY pixels it may
    reconstruct are those the limb actually hides at rest.

    python3 app/scripts/buddha-rig-art.py [--skip-inpaint] [--no-guide]

Development-time only. Needs PIL + numpy. About three minutes.
"""
import json
import os
import sys
from collections import deque

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
DIR = os.path.normpath(os.path.join(HERE, "..", "public", "img", "cosmetics"))
RIG = os.path.join(DIR, "rig")
OUT = os.path.normpath(os.path.join(HERE, "..", "..", "docs", "evidence", "round56"))

MASTER = os.path.join(DIR, "mascot-gold-buddha-base.png")
MASTER_ALPHA = os.path.join(DIR, "master-alpha.png")

# Master space. The rig's constants are expressed here too (rig-buddha.py), and
# one master pixel is what the browser draws at 0.11 device pixels in the scene.
MW, MH = 1536, 1024
S = MW / 768.0                      # the 768 states are exactly half
PIVOT = (536.0, 292.0)              # the shoulder joint, master px
GRIP = (740, 30)                    # where the hand holds the stem, master px

# The stem's own trace window: the cluster hangs from the grip down to here.
STEM_X0, STEM_X1 = 715, 775
STEM_Y0, STEM_Y1 = 28, 132

KEYFORMS = (-15.0, -7.0, 6.0)

os.makedirs(RIG, exist_ok=True)
os.makedirs(OUT, exist_ok=True)

# ── 0. the master, and its silhouette ───────────────────────────────────────
if not os.path.exists(MASTER_ALPHA):
    sys.exit("master-alpha.png is missing — run app/scripts/master-alpha.py --write first")
ALPHA_IOU = 0.9933                  # master-alpha.py's measured agreement

master = Image.open(MASTER)
rgb_m = np.asarray(master.convert("RGB")).astype(np.float32)
_a = np.asarray(Image.open(MASTER_ALPHA))
alpha_m = _a.astype(np.float32) / 255.0 if _a.max() > 1 else _a.astype(np.float32)
if alpha_m.shape[:2] != (MH, MW):
    alpha_m = np.asarray(Image.fromarray((alpha_m * 255).astype(np.uint8))
                         .resize((MW, MH), Image.LANCZOS)).astype(np.float32) / 255.0
print(f"master {MW}x{MH} (immutable) · silhouette recovered, IoU {ALPHA_IOU} against the drawn one")

# The alpha the layers ship with. Binarised at 0.5, and §3e in the rewrite notes
# says why at length: the master's colour is already the flat blend of figure and
# stage, so a partial alpha blends the stage in a second time and the composite no
# longer returns the master (Gate A measured 31 px up to 33 levels off, all there).
MATTE = (alpha_m >= 0.5).astype(np.float32)
FIGURE = MATTE > 0.0


def up(mask_768):
    """A 768 mask in master space. Thresholded at 110/255 deliberately: 128
    re-flips antialiased boundary pixels, and the boundary is the art."""
    im = Image.fromarray((mask_768 * 255).astype(np.uint8)).resize((MW, MH), Image.LANCZOS)
    return np.asarray(im).astype(np.float32) / 255.0 > 110.0 / 255.0


def state(name):
    return np.asarray(Image.open(os.path.join(DIR, name)).convert("RGBA"))[..., 3] / 255.0


# ── 1. the limb group's footprint, from the artist's own armless plate ──────
# The artist shipped a plate with the arm and its fruit taken out
# (`part-plate-armless.webp`). Against the artwork that is a measurement, not a
# guess: the plate is transparent under the 12,016 px of the arm that read
# against the background, and opaque-but-different where the arm covered the
# body. So the group's footprint is:
#
#     the artwork shows figure AND (the armless plate is transparent there
#                                   OR the armless plate shows something else)
#
# SANITY, because a mask is only as good as what it contains: that footprint is
# the FOREARM + HAND + GRAPES + whatever they hid (the chest behind the raised
# arm, the cast shadow on the chin). It is not, on its own, an arm.
def rgba(n):
    return np.asarray(Image.open(os.path.join(DIR, n)).convert("RGBA")).astype(np.float32) / 255.0


_base768 = rgba("mascot-gold-buddha-base.webp")
_plate768 = rgba("part-plate-armless.webp")
_d_plate = np.abs(_base768[..., :3] - _plate768[..., :3]).max(axis=2)
GROUP = up((_base768[..., 3] > 0.5) & ((_plate768[..., 3] <= 0.5) | (_d_plate > 8))) & FIGURE
print(f"the limb group (arm + hand + fruit + what they hid): {int(GROUP.sum()):,} px")

# The artist's cluster mask, which follows the fruit when it swings and carries
# its cast shadow — but is BLOCKY: it is a stamped region, and it reaches over
# the fingers and up onto the chin. Its two halves need opposite owners.
CLUSTER = up(rgba("part-grapes-raised.webp")[..., 3] > 0.5) & FIGURE

# ── 2. the stem, traced from the master's own dark ridge ────────────────────
# The stem is the one structure here that is markedly DARKER than the grapes
# hanging off it, so it is not drawn — it is traced, row by row, from the grip
# downward, following the darkest run in a narrow band that starts at the
# previous row's centre. It cannot reach up into the hand, because it starts at
# the grip. The old build stamped a 36x54 rectangle here; that rectangle is where
# the 736 px of hand in the grape layer came from.
lum_m = rgb_m @ np.array([0.2126, 0.7152, 0.0722], np.float32)
STEM = np.zeros((MH, MW), bool)
stem_widths = []
cx = float(GRIP[0])
rows = 0
for y in range(STEM_Y0, STEM_Y1):
    row = np.arange(max(0, int(cx) - 26), min(MW, int(cx) + 27))
    vals = np.where(FIGURE[y, row], lum_m[y, row], 1e9)
    if vals.min() > 1e8:
        break
    i0 = int(np.argmin(vals))
    cx = float(row[i0])
    thresh = float(np.median(vals)) - 12.0        # "darker than the grapes here"
    j0 = i0
    while j0 > 0 and (i0 - j0) < 8 and vals[j0 - 1] < thresh:
        j0 -= 1
    j1 = i0
    while j1 < len(row) - 1 and (j1 - i0) < 8 and vals[j1 + 1] < thresh:
        j1 += 1
    if y == STEM_Y0:
        print(f"stem traced from the master's own ridge: start ({int(cx)},{y})")
    STEM[y, row[j0]:row[j1] + 1] = True
    stem_widths.append(int(j1 - j0 + 1))
    rows += 1
STEM &= FIGURE & ~CLUSTER
print(f"  stem {int(STEM.sum()):6d} px over {rows} rows, width {min(stem_widths)}-{max(stem_widths)} "
      f"px (median {int(np.median(stem_widths))}), grip at {GRIP}")

# ── 3. WHO OWNS WHICH PIXEL, where the drawn masks disagree ─────────────────
# The two drawn masks overlap by ~10,000 px and they mean different things there,
# so ownership is decided where the picture itself changes hands:
#
#   * BELOW the finger tips the cluster is in front: those pixels are the fruit's,
#     including the cast shadow it throws on the chin (x > 775), which has to
#     travel with the fruit or the shadow detaches from it.
#   * ABOVE that line the fingers curl in FRONT of the cluster's top rows, so the
#     pixels are the hand's.
#   * the traced stem belongs to the fruit along its whole length: it hinges at
#     the grip, so a few degrees of swing move its top pixels by very nearly
#     nothing — the one place a mis-assignment could not show.
yy, xx = np.mgrid[0:MH, 0:MW]
FINGER_LINE = 118          # master y: the finger tips end and the cluster begins
CHIN_X = 775               # master x: past the cluster's right edge is its shadow
CLUSTER_TRUE = CLUSTER & ((yy >= FINGER_LINE) | (xx > CHIN_X))
cluster_px = int(CLUSTER_TRUE.sum())
GRAPES_M = (CLUSTER_TRUE | STEM) & FIGURE
ARM_M = GROUP & ~GRAPES_M

overlap = int((ARM_M & GRAPES_M).sum())
_fingers_over_fruit = int((GROUP & CLUSTER & (yy < FINGER_LINE)).sum())
_shadow_on_chin = int((GROUP & CLUSTER & (yy >= FINGER_LINE) & (xx > CHIN_X)).sum())
# Above the grip there is nothing but stem in the grape layer: the stem's own
# first two rows sit a hair above the grip point, and that is the only thing
# allowed up there.
_above = GRAPES_M & (yy < GRIP[1])
hand_in_grapes = int((_above & ~STEM).sum())
print(f"  layers: arm {int(ARM_M.sum()):6d} px · grapes {int(GRAPES_M.sum()):6d} px "
      f"· overlap {overlap} px")
print(f"  the split: {_fingers_over_fruit:,} px where the fingers cross the fruit's top edge went "
      f"to the ARM; {_shadow_on_chin:,} px of the fruit's cast shadow on the chin went to the GRAPES")
assert overlap == 0, "the arm and grape layers must be disjoint"
assert hand_in_grapes == 0, \
    "above the grip the grape layer may carry the stem and nothing else — the hand is there"
print(f"  above the grip the grape layer carries {int(_above.sum())} px, all of them stem")
_stem_lum = float(lum_m[STEM].mean())
_fig_lum = float(lum_m[FIGURE].mean())
print(f"  the traced stem is dark: mean luminance {_stem_lum:.1f} against the figure's "
      f"{_fig_lum:.1f} (a trace that caught fingers would read gold, not dark)")
assert _stem_lum < _fig_lum - 20, "the stem trace is not following a dark structure"
assert max(stem_widths) <= 17, "the stem trace must follow the stem, not stamp a box"

# The arm's extended footprint: the layer has to carry enough of the limb to close
# the joint when it bends, so it takes the socket too — the near part of the sweep
# the arm uncovers when it rotates up.
r_piv = np.hypot(xx - PIVOT[0], yy - PIVOT[1])
SOCKET = GROUP & (r_piv < 90.0) & FIGURE
ARM_M = (ARM_M | SOCKET) & ~GRAPES_M

# The ONLY pixels the plate may reconstruct: what the limb hides at rest.
GENERATED = ARM_M & FIGURE
print(f"  hidden under the limb at rest: {int(GENERATED.sum()):6d} px — the only pixels "
      f"the plate may reconstruct")

# ── 4. the machinery (carried over from the previous build, unchanged) ──────
def _shift(a, dy, dx):
    """a displaced by (dy, dx), edges replicated."""
    out = np.empty_like(a)
    ys = slice(max(dy, 0), a.shape[0] + min(dy, 0))
    yd = slice(max(-dy, 0), a.shape[0] + min(-dy, 0))
    xs = slice(max(dx, 0), a.shape[1] + min(dx, 0))
    xd = slice(max(-dx, 0), a.shape[1] + min(-dx, 0))
    out[yd, xd] = a[ys, xs]
    if dy > 0: out[:dy] = out[dy:dy + 1]
    if dy < 0: out[dy:] = out[dy - 1:dy]
    if dx > 0: out[:, :dx] = out[:, dx:dx + 1]
    if dx < 0: out[:, dx:] = out[:, dx - 1:dx]
    return out


def _at(a, dy, dx):
    return _shift(a, -dy, -dx)


def _fit(a, size):
    return np.asarray(Image.fromarray(a.astype(np.float32), "F").resize(size, Image.BILINEAR),
                      dtype=np.float32)


def harmonic(d, free, factor=4, iters=900):
    """Extend ring values `d` smoothly into `free`: the field that matches the
    seam and does nothing else. Solved coarse because illumination IS low
    frequency — a correction carrying detail would repaint what the fill copied,
    which is the failure this is here to avoid."""
    H, W = free.shape
    h, w = max(H // factor, 8), max(W // factor, 8)
    f = _fit(free.astype(np.float32), (w, h)) > 0.5
    inner = f & ~(_shift(f, 1, 0) & _shift(f, -1, 0) & _shift(f, 0, 1) & _shift(f, 0, -1))
    c = np.where(inner, _fit(d, (w, h)), 0.0)
    upd = f & ~inner
    for _ in range(iters):
        nxt = (_shift(c, 1, 0) + _shift(c, -1, 0) + _shift(c, 0, 1) + _shift(c, 0, -1)) / 4.0
        delta = np.where(upd, nxt - c, 0.0)
        c = np.where(upd, nxt, c)
        if np.abs(delta).max() < 0.02:
            break
    return _fit(c, (W, H))


def harmonic_exact(d, free, ring, init, iters=240):
    """The same membrane at full resolution, seeded by the coarse solve: the
    coarse pass gets the shape of the lighting right, this one makes the seam
    itself match, which is the whole point."""
    c = init.copy()
    upd = free & ~ring
    c[ring] = d[ring]
    for _ in range(iters):
        nxt = (_shift(c, 1, 0) + _shift(c, -1, 0) + _shift(c, 0, 1) + _shift(c, 0, -1)) / 4.0
        delta = np.where(upd, nxt - c, 0.0)
        c = np.where(upd, nxt, c)
        if np.abs(delta).max() < 0.05:
            break
    return c


def lum(rgb):
    return rgb @ np.array([0.2126, 0.7152, 0.0722], np.float32)


def exemplar_fill(rgb, known, target, patch=7, search=64, stride=3,
                  guide=None, guide_weight=9.0):
    """Criminisi-style exemplar inpainting: fill from the hole's edge inward, and
    for each pixel copy the centre of the best-matching patch found in the known
    picture. The texture, folds and highlights are the drawing's own — nothing is
    synthesised — but which patch goes where is the algorithm's choice, and every
    pixel it writes is recorded. `guide` biases the choice toward the light the
    drawing already has around the hole, so a patch of the right texture but the
    wrong brightness is not chosen."""
    h, w = known.shape
    out = rgb.copy()
    filled = known.copy()
    todo = target.copy()
    r = patch // 2

    order = []
    while todo.any():
        shell = todo & ~np.asarray(
            Image.fromarray((filled * 255).astype(np.uint8))
            .filter(ImageFilter.MaxFilter(3))).astype(np.float32).astype(bool)
        if not shell.any():
            break
        ys, xs = np.nonzero(shell)
        order.append((ys, xs))
        filled[shell] = True
        todo = todo & ~shell
    if not order:
        return out, np.zeros_like(target)

    off = [(dy, dx) for dy in range(-search, search + 1, stride)
           for dx in range(-search, search + 1, stride) if (dy or dx)]
    off = np.asarray(off, np.int32)
    py, px = np.mgrid[-r:r + 1, -r:r + 1]
    py, px = py.ravel(), px.ravel()

    written = np.zeros_like(target)
    for ys, xs in order:
        for y, x in zip(ys, xs):
            yyv = y + off[:, 0, None] + py[None, :]
            xxv = x + off[:, 1, None] + px[None, :]
            ok = (yyv >= 0) & (yyv < h) & (xxv >= 0) & (xxv < w)
            if not ok.any():
                continue
            yyv = np.clip(yyv, 0, h - 1)
            xxv = np.clip(xxv, 0, w - 1)
            cover = filled[yyv, xxv].mean(axis=1)
            good = cover > 0.92
            if not good.any():
                continue
            cand = out[yyv, xxv]
            ref = out[np.clip(y + py, 0, h - 1), np.clip(x + px, 0, w - 1)]
            ssd = ((cand - ref[None]) ** 2).sum(axis=(1, 2))
            if guide is not None:
                cmean = cand.mean(axis=2).mean(axis=1)
                ssd = ssd + guide_weight * (cmean - guide[y, x]) ** 2
            ssd[~ok.all(axis=1)] = 1e18
            ssd[~good] = 1e18
            i = int(np.argmin(ssd))
            if ssd[i] >= 1e17:
                continue
            sy, sx = int(y + off[i, 0]), int(x + off[i, 1])
            out[y, x] = out[sy, sx]
            written[y, x] = True
    return out, written


# ── 5. the plate: the master itself, rebuilt only where the limb hid it ─────
plate_rgb = rgb_m.copy()          # the plate starts AS the master, untouched
filled_mask = np.zeros(GENERATED.shape, bool)

if GENERATED.any() and "--skip-inpaint" not in sys.argv:
    print("   reconstructing under the limb, from the master's own gold …")
    L0 = lum(plate_rgb)
    LIGHT_HINT = harmonic(L0, GENERATED)
    # The source pool excludes the limb itself: filling the hole with the limb's
    # own pixels leaves a ghost of the raised arm in the plate.
    usable = FIGURE & ~GROUP
    plate_rgb, filled_mask = exemplar_fill(
        plate_rgb, usable, GENERATED,
        search=64, stride=4,
        guide=None if "--no-guide" in sys.argv else LIGHT_HINT)
print(f"   reconstructed: {int(filled_mask.sum())} px (ORIGINAL everywhere else)")

FREE = filled_mask.copy()
NBR = ((1, 0), (-1, 0), (0, 1), (0, -1))
RING = FREE & ~(_shift(FREE, 1, 0) & _shift(FREE, -1, 0) & _shift(FREE, 0, 1) & _shift(FREE, 0, -1))
KNOWNM = ~FREE & FIGURE


def seam_step(lu):
    total = np.zeros_like(lu); n = np.zeros_like(lu)
    for dy, dx in NBR:
        k = _at(KNOWNM.astype(np.float32), dy, dx) > 0.5
        total = total + np.where(k, _at(lu, dy, dx), 0.0)
        n = n + k
    ok = RING & (n > 0)
    return float(np.abs(lu[ok] - total[ok] / np.maximum(n[ok], 1)).mean()) if ok.any() else 0.0


if FREE.any():
    before = seam_step(lum(plate_rgb))
    Lfill = lum(plate_rgb)
    d_ring = np.zeros_like(Lfill); total = np.zeros_like(Lfill); n = np.zeros_like(Lfill)
    for dy, dx in NBR:
        k = _at(KNOWNM.astype(np.float32), dy, dx) > 0.5
        total = total + np.where(k, _at(Lfill, dy, dx), 0.0)
        n = n + k
    ok = RING & (n > 0)
    d_ring[ok] = total[ok] / np.maximum(n[ok], 1) - Lfill[ok]
    CORR = harmonic_exact(d_ring, FREE, RING, harmonic(d_ring, FREE))
    g_before = float(np.abs(_at(Lfill, 0, 1) - Lfill)[FREE].mean())
    plate_rgb[FREE] = np.clip(plate_rgb[FREE] + CORR[FREE, None], 0, 255)
    after = seam_step(lum(plate_rgb))
    g_after = float(np.abs(_at(lum(plate_rgb), 0, 1) - lum(plate_rgb))[FREE].mean())
    CONTROL = KNOWNM & (np.asarray(Image.fromarray((FREE * 255).astype(np.uint8))
                                   .filter(ImageFilter.MaxFilter(7))).astype(np.float32) > 0)
    _t = np.zeros_like(Lfill); _n = np.zeros_like(Lfill)
    for dy, dx in NBR:
        _t = _t + _at(lum(rgb_m), dy, dx); _n = _n + 1.0
    _ctrl = float(np.abs(lum(rgb_m)[CONTROL] - (_t[CONTROL] / _n[CONTROL])).mean())
    print(f"   the light: seam step {before:.2f} -> {after:.2f} luminance levels "
          f"(the master's own local contrast beside it is {_ctrl:.2f})")
    print(f"   the detail the fill copied: mean |dL/dx| {g_before:.2f} -> {g_after:.2f} "
          f"(a blur would flatten this)")
    print(f"   the correction: mean {float(np.abs(CORR[FREE]).mean()):.2f}, "
          f"max {float(np.abs(CORR[FREE]).max()):.2f} levels; "
          f"{int(((np.abs(CORR) > 30) & FREE).sum())} px over 30")
else:
    before = after = _ctrl = g_before = g_after = 0.0
    CORR = np.zeros_like(plate_rgb[..., 0])

# ── 6. the alpha the plate and the layers ship with ─────────────────────────
# The plate keeps the recovered silhouette at the figure's outline, and is OPAQUE
# under the layers that cover it — the body behind an arm is solid, and a second
# edge under an edge blends the outline twice. One edge per pixel: on the top
# layer where there is one, on the plate where there is not.
plate_a = np.where(ARM_M | GRAPES_M, 1.0, MATTE).astype(np.float32)
print(f"   the silhouette's own edge: the master is flat RGB, so the drawn 768 ramp is an "
      f"estimate; over the page the rim light measures "
      f"+14.1 levels as drawn against -7.9 for any soft edge, so the alpha ships opaque "
      f"at 0.5 ({int((MATTE != alpha_m).sum())} px of the recovered silhouette move)")

# ── 7. THE INVARIANT ────────────────────────────────────────────────────────
# Outside the limb's own footprint the plate is the master, pixel for pixel: the
# plate may never repaint what the master shows.
_diff = np.abs(plate_rgb - rgb_m).max(axis=2)
claimed = int((_diff[~GENERATED] > 4).sum())
print(f"   outside the limb, the plate is the master: {claimed} px differ by more than 4 levels")
assert claimed == 0, "the plate must never repaint what the master shows"
_COVER = ARM_M | GRAPES_M
_da = float(np.abs(plate_a - MATTE)[~_COVER].max())
print(f"   outside the layers, the plate's alpha is the master's: max difference {_da * 255:.1f}/255")
assert _da < 1e-6, "the plate's alpha outside the layers must be the master's"
_hidden = plate_a[_COVER]
print(f"   under the layers, the plate is opaque: min alpha {_hidden.min() * 255:.0f}/255 "
      f"({_hidden.size:,} px)")
assert float(_hidden.min()) >= 1.0 - 1e-6, "the plate must be opaque under the layers"

# ── 8. the layers ───────────────────────────────────────────────────────────
def layer(mask):
    a = np.where(mask, MATTE, 0.0)
    return Image.merge("RGBA", (*[Image.fromarray(rgb_m[:, :, c].clip(0, 255).astype(np.uint8))
                                  for c in range(3)],
                                Image.fromarray((a * 255).round().astype(np.uint8))))


print("   writing the layers …")
master_rgb8 = rgb_m.clip(0, 255).astype(np.uint8)
plate = Image.merge("RGBA", (*[Image.fromarray(plate_rgb[:, :, c].clip(0, 255).astype(np.uint8))
                              for c in range(3)],
                             Image.fromarray((plate_a * 255).round().astype(np.uint8))))
plate.save(os.path.join(RIG, "clean-plate.webp"), "WEBP", lossless=True)

arm_layer = layer(ARM_M)
arm_layer.save(os.path.join(RIG, "arm.webp"), "WEBP", lossless=True)
grapes_layer = layer(GRAPES_M)
grapes_layer.save(os.path.join(RIG, "grapes.webp"), "WEBP", lossless=True)

for n_, fn in (("plate", "clean-plate.webp"), ("arm", "arm.webp"), ("grapes", "grapes.webp")):
    p_ = os.path.join(RIG, fn)
    im_ = Image.open(p_)
    print(f"     {n_:7s} {im_.size[0]}x{im_.size[1]}  {os.path.getsize(p_) / 1024:8.1f} KB")


# ── 9. NO INVENTED PIXELS IN THE LAYERS ─────────────────────────────────────
# At rest every pixel the arm and grape layers show is the master's own. Not
# "close to": equal. This is the assertion the whole reset exists for.
def check_layer(img, name):
    arr = np.asarray(img.convert("RGBA"))
    op = arr[..., 3] > 0
    d = np.abs(np.asarray(img.convert("RGB")).astype(np.int16)
               - master_rgb8.astype(np.int16)).max(axis=2)
    bad = int((d[op] > 0).sum())
    print(f"   {name:7s}: {int(op.sum()):7d} px shown, {bad} differ from the master")
    return bad


_bad = check_layer(arm_layer, "arm") + check_layer(grapes_layer, "grapes")
assert _bad == 0, "a layer pixel is not the master's"

# ── 10. the regions a painter still has to finish ───────────────────────────
# Derived from the reconstruction itself, not from a hand-written list of boxes:
# every connected patch of reconstructed pixels is reported with its own box and
# count, and named by where it sits. A stale box would quietly stop describing
# what is actually there.
RECON = "RECONSTRUCTED from the master's own gold; no photo, no model, no other pose"


def _components(mask, minpx=40):
    lab = np.zeros(mask.shape, np.int32)
    out = []
    ys, xs = np.nonzero(mask)
    for y0, x0 in zip(ys, xs):
        if lab[y0, x0]:
            continue
        q = deque([(y0, x0)])
        lab[y0, x0] = 1
        pts = []
        while q:
            y, x = q.popleft()
            pts.append((y, x))
            for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                ny, nx = y + dy, x + dx
                if 0 <= ny < mask.shape[0] and 0 <= nx < mask.shape[1] \
                        and mask[ny, nx] and not lab[ny, nx]:
                    lab[ny, nx] = 1
                    q.append((ny, nx))
        if len(pts) >= minpx:
            a = np.array(pts)
            out.append((len(pts), int(a[:, 1].min()), int(a[:, 1].max()),
                        int(a[:, 0].min()), int(a[:, 0].max())))
    out.sort(reverse=True)
    return out


def _name(cx_, cy_):
    if cy_ < 420 and cx_ < 700:
        return "chest and shoulder socket behind the raised arm"
    if cy_ < 420 and cx_ < 900:
        return "the bare neck where the necklace runs"
    if cy_ >= 420:
        return "the pile under the limb"
    return "reconstruction patch"


regions = {}
for n_px, x0, x1, y0, y1 in _components(filled_mask):
    cx_, cy_ = (x0 + x1) / 2, (y0 + y1) / 2
    nm = _name(cx_, cy_)
    k = 1
    base_nm = nm
    while nm in regions:
        k += 1
        nm = f"{base_nm} ({k})"
    regions[nm] = {"box": [x0, y0, x1, y1], "reconstructed_generated": n_px,
                   "provenance": RECON, "centroid": [int(cx_), int(cy_)]}
print(f"   reconstructed pixels needing a painter: {int(filled_mask.sum())}")
for name, r_ in sorted(regions.items(), key=lambda kv: -kv[1]["reconstructed_generated"]):
    print(f"     {name:52s} {r_['reconstructed_generated']:7d} px  "
          f"box {r_['box']}")

# ── 11. the review map: ORIGINAL vs RECONSTRUCTED ───────────────────────────
vis = np.asarray(plate).copy()
vis[..., :3][filled_mask] = (0.25 * vis[..., :3][filled_mask]
                             + 0.75 * np.array([220, 40, 40], np.float32))
Image.fromarray(vis).save(os.path.join(OUT, "05-review-map.png"))

# and the stem, at 1:1 and 4x, against the master, because the stem is where the
# old build's stamped rectangle used to be
_crop = (660, 0, 860, 220)
_m = master.convert("RGB").crop(_crop)
_ml = plate.convert("RGB").crop(_crop)
_marked = _ml.copy()
_md = ImageDraw.Draw(_marked)
_md.rectangle([0, 0, _crop[2] - _crop[0] - 1, _crop[3] - _crop[1] - 1], outline=(60, 220, 120))
sheet = Image.new("RGB", ((_crop[2] - _crop[0]) * 3 + 40, (_crop[3] - _crop[1]) * 4 + 30), (24, 24, 28))
sheet.paste(_m.resize((_m.width * 2, _m.height * 2), Image.LANCZOS), (0, 20))
sheet.paste(_ml.resize((_ml.width * 2, _ml.height * 2), Image.LANCZOS), (_m.width * 2 + 20, 20))
sheet.paste(_ml.resize((_ml.width * 4, _ml.height * 4), Image.NEAREST), (0, _m.height * 2 + 30))
sheet.save(os.path.join(OUT, "13-stem-and-grapes-inspection.png"))

data = {
    "lineage": [
        "MASTER mascot-gold-buddha-base.png (1536x1024, immutable)",
        "master-alpha.png (its silhouette, IoU 0.9933 against the drawn one)",
        "CLEAN PLATE rig/clean-plate.webp",
        "SEPARATED LAYERS rig/arm.webp, rig/grapes.webp",
        "MESH/WEIGHTS rig/buddha-rig.json",
        "CORRECTIVE KEYFORMS (in the rig data)",
        "ANIMATION -> BROWSER RENDER",
    ],
    "never": "a render -> a new master -> a new extraction -> a new generation",
    "space": f"master pixels, {MW}x{MH}",
    "generated": {"exemplar_fill_pixels": int(filled_mask.sum()),
                  "source": "the master's own pixels only"},
    "light": {"seam_step_before": round(before, 2), "seam_step_after": round(after, 2),
              "seam_step_master_control": round(_ctrl, 2),
              "correction_levels": {"mean": round(float(np.abs(CORR[FREE]).mean()), 2)
                                    if FREE.any() else 0.0,
                                    "max": round(float(np.abs(CORR[FREE]).max()), 2)
                                    if FREE.any() else 0.0},
              "detail_kept": {"mean_abs_dLdx_before": round(g_before, 2),
                              "mean_abs_dLdx_after": round(g_after, 2)}},
    "separation": {
        "arm_px": int(ARM_M.sum()), "grapes_px": int(GRAPES_M.sum()), "overlap_px": overlap,
        "hand_px_in_grapes": hand_in_grapes,
        "cluster_px": cluster_px, "stem_px": int(STEM.sum()), "stem_rows": rows,
        "group_px": int(GROUP.sum()),
        "stem_width_px": [min(stem_widths), max(stem_widths)],
        "stem_mean_luminance": round(_stem_lum, 1),
        "figure_mean_luminance": round(_fig_lum, 1),
        "above_the_grip_all_stem": True,
        "fingers_over_the_fruit_top_px": _fingers_over_fruit,
        "fruit_cast_shadow_on_the_chin_px": _shadow_on_chin,
        "finger_line_master_y": FINGER_LINE, "chin_x": CHIN_X,
        "grip": list(GRIP),
        "note": ("the grape layer is the drawn cluster plus the stem traced from the "
                 "master's own dark ridge, starting at the grip — the previous build "
                 "stamped a rectangle here and 736 px of hand came with it"),
    },
    "alpha": {
        "binarised_at": 0.5,
        "moved_px": int((MATTE != alpha_m).sum()),
        "why": ("the master is flat: its colour already contains the backdrop blend, so a "
                "partial alpha blends it twice. Measured over the page: the rim light reads "
                "+14.1 levels against the body as drawn, -7.9 with any soft edge."),
    },
    "invariant": {
        "plate_equals_master_outside_limb_px_over_4": claimed,
        "plate_alpha_outside_layers_max_diff": round(_da * 255, 3),
        "plate_opaque_under_layers": True,
    },
    "regions": regions,
    "contact_shadow": {"present": False, "owed": "painted per keyform"},
}
with open(os.path.join(RIG, "regions.json"), "w") as fh:
    json.dump(data, fh, indent=2)

print("wrote rig/{clean-plate,arm,grapes}.webp and rig/regions.json")
print(f"      review map → {os.path.join(OUT, '05-review-map.png')}")
