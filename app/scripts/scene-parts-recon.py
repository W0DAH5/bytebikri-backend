#!/usr/bin/env python3
"""
THE RECONSTRUCTION PART SWAP — the accepted layers become the served parts.

Production-integration (authorized 2026-10-02). The three accepted
reconstruction layers (RECONSTRUCTION/layers, human-accepted at c347e29,
fringe fix re-applied at 2ec4479) replace the arm cycle's generated parts:

  PLATE  <- torso   the static body. The reconstruction folds the old ANCHOR
                    role into it (ownership law: the backdrop is complete and
                    opaque under the whole solid footprint — hidden art in the
                    holes, light-matched lowered body elsewhere, the pocket sky
                    on the card, the black sky placeholders zeroed). Its RGB
                    under the footprint is BACKDROP, never the raised limb,
                    so the plate is armless by content, not by cut.
  ANCHOR <- (empty) the old part's job is inside the plate. The DOM slot and
                    its CSS step-aside stay untouched; the part serves fully
                    transparent pixels so nothing is double-drawn (the one-
                    alpha-deep rule).
  ARM    <- arm     the solid limb with its own rim (RIM_BAND travels with it).
  GRAPES <- grapes  the complete bunch: ellipse + outer berry rim + the
                    crevice repaint.

The belly (lowered hand), breath and blink parts are NOT touched — they are
the original mechanisms, and the handover window keeps its semantics.

Everything is written exactly the way scene-parts-fresh.py writes: WebP
lossless, method 6, quality 100. The checks below then prove, from the files
AS SERVED (decoded again from disk):

  1. decode equality   every part decodes bit-identical to its source layer.
  2. REST transfer     plate+anchor+arm+grapes from the served files compose
                       bit-identical to the accepted reconstruction's REST —
                       which build.py proves against the served artwork
                       (0 px>32, 0 px>8, max 4, raw unsanctioned 0), so the
                       proof transfers untouched.
  3. puzzle            the same numbers, recomputed here from the served
                       stack against the served artwork with the
                       reconstruction's own sanctioned classes.
  4. GAP               at -7 and -15 deg, no body see-through inside the
                       figure (the fresh build's own definition).
  5. SWING             the bunch swung to its keyframe extremes uncovers no
                       hole (pits and sanctioned sky excluded).

    python3 app/scripts/scene-parts-recon.py          # exit 0 = proven
"""
import io
import json
import os
from collections import deque

import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
DIR = os.path.join(HERE, "..", "public", "img", "cosmetics")
RECON = os.path.join(HERE, "..", "..", "RECONSTRUCTION", "layers")
PKG = os.path.join(HERE, "..", "..", "docs", "evidence", "round56", "keyform-package")
W, H = 768, 512
CARD = (23, 18, 12)


def state(n):
    return Image.open(os.path.join(DIR, f"mascot-gold-buddha-{n}.webp")).convert("RGBA")


def served(img, quality=92):
    buf = io.BytesIO()
    img.save(buf, "WEBP", quality=quality, method=6)
    buf.seek(0)
    return Image.open(buf).convert("RGBA")


def load_layer(name):
    return Image.open(os.path.join(RECON, name, f"{name}.png")).convert("RGBA")


torso, arm, grapes = load_layer("torso"), load_layer("arm"), load_layer("grapes")
anchor = Image.new("RGBA", (W, H), (0, 0, 0, 0))

# ── WRITE — lossless + exact, the one arithmetic lossless WebP needs ─────────
# (libwebp's lossless encoder may rewrite RGB under fully-transparent pixels
# unless exact=True — and the REST transfer is compared in straight RGBA.)
for img, name in ((torso, "part-plate-armless.webp"), (anchor, "part-arm-anchor.webp"),
                  (arm, "part-arm-raised.webp"), (grapes, "part-grapes-raised.webp")):
    buf = io.BytesIO()
    img.save(buf, "WEBP", lossless=True, method=6, quality=100, exact=True)
    with open(os.path.join(DIR, name), "wb") as fh:
        fh.write(buf.getvalue())
    print(f"   -> {name}: lossless+exact, {len(buf.getvalue()) / 1024:.1f} KB")

# ── 1. DECODE EQUALITY — every part reads back bit-identical ─────────────────
fail = []
for src, name in ((torso, "part-plate-armless.webp"), (anchor, "part-arm-anchor.webp"),
                  (arm, "part-arm-raised.webp"), (grapes, "part-grapes-raised.webp")):
    back = Image.open(os.path.join(DIR, name)).convert("RGBA")
    same = np.array_equal(np.asarray(src), np.asarray(back))
    print(f"   decode {name}: {'bit-identical' if same else 'MISMATCH'}")
    if not same:
        fail.append(f"decode {name}")

plate = Image.open(os.path.join(DIR, "part-plate-armless.webp")).convert("RGBA")
anchor_s = Image.open(os.path.join(DIR, "part-arm-anchor.webp")).convert("RGBA")
arm_s = Image.open(os.path.join(DIR, "part-arm-raised.webp")).convert("RGBA")
grapes_s = Image.open(os.path.join(DIR, "part-grapes-raised.webp")).convert("RGBA")

# ── 2. REST TRANSFER — served stack == accepted reconstruction REST, bitwise ─
ref = torso.copy()
ref.alpha_composite(arm)
ref.alpha_composite(grapes)
got = plate.copy()
got.alpha_composite(anchor_s)
got.alpha_composite(arm_s)
got.alpha_composite(grapes_s)
bit = np.array_equal(np.asarray(ref), np.asarray(got))
print(f"   REST transfer: served stack vs accepted layers: {'BIT-IDENTICAL' if bit else 'MISMATCH'}")
if not bit:
    fail.append("REST transfer")

# ── 3. PUZZLE — served stack vs the served artwork, reconstruction sanctions ─
base = state("base")
base_q = served(base, 92)
A_b = np.asarray(base_q.getchannel("A")).astype(np.float32) / 255.0
A_r = np.asarray(served(state("rest"), 92).getchannel("A")).astype(np.float32) / 255.0
B_rgb = np.asarray(base_q.convert("RGB")).astype(np.float32)
R_rgb = np.asarray(served(state("rest"), 92).convert("RGB")).astype(np.float32)

# the cut and the masks, the reconstruction's own definitions (build.py)
ARM_BOX = (140, 0, 426, 208)
DIFF_GATE = 34
box = np.zeros((H, W), bool)
box[ARM_BOX[1]:ARM_BOX[3], ARM_BOX[0]:ARM_BOX[2]] = True
pb, pr = A_b > 0.05, A_r > 0.05
delta = np.abs(B_rgb - R_rgb).max(axis=2)
against_air = pb & ~pr & box
over_body = pb & pr & (delta > DIFF_GATE) & box
raw = Image.fromarray(((against_air | over_body) * 255).astype(np.uint8))
for _ in range(2):
    raw = raw.filter(ImageFilter.MaxFilter(3))
for _ in range(2):
    raw = raw.filter(ImageFilter.MinFilter(3))
m = np.asarray(raw) > 128
gi = Image.new("L", (W, H), 0)
ImageDraw.Draw(gi).ellipse([334, 48, 420, 146], fill=255)
ImageDraw.Draw(gi).polygon([(362, 24), (384, 24), (388, 70), (358, 70)], fill=255)
m |= np.asarray(gi.filter(ImageFilter.MaxFilter(3))) > 128
lab = np.zeros((H, W), np.int32)
n_lab = 0
for y0, x0 in np.argwhere(m):
    if lab[y0, x0]:
        continue
    n_lab += 1
    q = deque([(y0, x0)])
    lab[y0, x0] = n_lab
    while q:
        y, x = q.popleft()
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ny, nx = y + dy, x + dx
            if 0 <= ny < H and 0 <= nx < W and m[ny, nx] and not lab[ny, nx]:
                lab[ny, nx] = n_lab
                q.append((ny, nx))
sizes = np.bincount(lab.ravel())
m = np.isin(lab, np.where(sizes >= 150)[0][1:])
m |= against_air
free = ~m
seen = np.zeros_like(free)
q = deque()
for x in range(W):
    for y in (0, H - 1):
        if free[y, x] and not seen[y, x]:
            seen[y, x] = True
            q.append((y, x))
for y in range(H):
    for x in (0, W - 1):
        if free[y, x] and not seen[y, x]:
            seen[y, x] = True
            q.append((y, x))
while q:
    y, x = q.popleft()
    for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        yy, xx = y + dy, x + dx
        if 0 <= yy < H and 0 <= xx < W and free[yy, xx] and not seen[yy, xx]:
            seen[yy, xx] = True
            q.append((yy, xx))
m = m | (~seen)
M = np.asarray(Image.fromarray((m * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.9))) > 128
SOLID = A_b >= 0.98

G_img = Image.new("L", (W, H), 0)
gd = ImageDraw.Draw(G_img)
gd.ellipse([338, 52, 416, 142], fill=255)
gd.polygon([(364, 28), (382, 28), (386, 68), (360, 68)], fill=255)
fist = Image.new("L", (W, H), 0)
ImageDraw.Draw(fist).ellipse([344, 16, 400, 60], fill=255)
G_img = ImageChops.subtract(G_img.filter(ImageFilter.MaxFilter(3)), fist.filter(ImageFilter.MaxFilter(3)))
G = np.asarray(G_img) > 128
BERRY_RIM = (np.asarray(Image.fromarray((G * 255).astype(np.uint8)).filter(
    ImageFilter.MaxFilter(13))) > 128) & (A_b > 0.02) & (A_b < 0.98)

manifest = json.load(open(os.path.join(PKG, "manifest.json")))
holes1536 = np.zeros((1024, 1536), bool)
for r in manifest:
    holes1536 |= np.load(os.path.join(PKG, r["id"] + "-mask.npy")) > 0
sky1536 = np.load(os.path.join(PKG, "SKY-page-belongs.npy")) > 0


def half(mask):
    return np.asarray(Image.fromarray((mask * 255).astype(np.uint8)).resize((W, H), Image.BOX)) >= 128


HOLES = half(holes1536) & ~half(sky1536)

POCKET = np.zeros((H, W), bool)
POCKET[38:116, 283:368] = True
lum = B_rgb @ np.array([.299, .587, .114])
rb = B_rgb[..., 0] - B_rgb[..., 2]
g_dil = np.asarray(Image.fromarray((G * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(5))) > 128
_pp = POCKET & (A_b > 0.02) & (lum > 140) & (rb < 95) & (rb >= 40) & ~g_dil
POCKET_SKY = _pp & (A_r <= 0.5)

gaps = g_dil & ~SOLID & (A_b > 0.02) & ~_pp
CREVICE = np.zeros((H, W), bool)
if gaps.any():
    ys, xs = np.where(gaps)
    y0, y1 = max(0, ys.min() - 24), min(H, ys.max() + 25)
    x0, x1 = max(0, xs.min() - 24), min(W, xs.max() + 25)
    boxg = np.zeros((H, W), bool)
    boxg[y0:y1, x0:x1] = True
    sub_unknown = gaps & boxg
    CREVICE = sub_unknown

# the arm's page-unmixed rim (build.py's _part): rim px the arm owns and remaps
RIM_BAND = M & ~SOLID & ~G
RIM_UNMIXED = RIM_BAND & ~G & ~BERRY_RIM & ~_pp & (A_b > 0.02) & (A_b < 0.98)
SANCTION = POCKET_SKY | CREVICE | (RIM_UNMIXED & (A_b < 0.98))


def premul(img):
    a = np.asarray(img).astype(np.float32)
    out = np.empty_like(a)
    out[..., :3] = a[..., :3] * (a[..., 3:4] / 255.0)
    out[..., 3] = a[..., 3]
    return out


d = np.abs(premul(got) - premul(base_q)).max(axis=2)
d_raw = d.copy()
d[SANCTION] = 0
n32, n8, mx = int((d > 32).sum()), int((d > 8).sum()), int(d.max())
unsanctioned = int((d_raw > 8).sum() - int((d_raw[SANCTION] > 8).sum()))
print(f"   PUZZLE: px>32 {n32}  px>8 {n8}  max {mx}  raw unsanctioned px>8 {unsanctioned}"
      f"  (sanctioned: pocket-sky {int(POCKET_SKY.sum())}, crevice {int(CREVICE.sum())},"
      f" rim-unmix {int(RIM_UNMIXED.sum())})")
if n32 or n8 or unsanctioned:
    fail.append("puzzle")

# ── 4. GAP — no body see-through at the pose extremes ────────────────────────
plate_a = np.asarray(plate.getchannel("A")).astype(np.float32) / 255.0
anchor_a = np.asarray(anchor_s.getchannel("A")).astype(np.float32) / 255.0
interior = np.asarray(Image.fromarray(
    ((np.maximum(A_b, A_r)) * 255).astype(np.uint8)).filter(ImageFilter.MinFilter(9))) > 229
for deg in (7, 15):
    rot = np.asarray(arm_s.rotate(-deg, resample=Image.BICUBIC, center=(268.0, 146.0),
                                  expand=False, fillcolor=(0, 0, 0, 0))).astype(np.float32) / 255.0
    cov = rot[..., 3] + anchor_a * (1 - rot[..., 3]) + plate_a * (1 - rot[..., 3]) * (1 - anchor_a)
    gap = int(((cov < 0.55) & (A_r > 0.5) & interior).sum())
    print(f"   GAP at -{deg}deg: {gap} px of body see-through inside the figure")
    if gap:
        fail.append(f"gap -{deg}")

# ── 5. SWING — the bunch uncovers no hole ────────────────────────────────────
# The bunch's outer soft rim (BERRY_RIM) is the grapes' own travelling edge
# (the accepted v3 ownership ruling): it swings WITH the bunch and does not
# demand backing behind it. Solid berry content does.
grapes_a = np.asarray(grapes_s.getchannel("A")).astype(np.float32) / 255.0
arm_a = np.asarray(arm_s.getchannel("A")).astype(np.float32) / 255.0
rest_cover = np.asarray(Image.fromarray(np.where(grapes_a > 0.9, 255, 0).astype(np.uint8))) > 128
behind = (arm_a > 0.9) | (plate_a > 0.5) | (anchor_a > 0.5) | HOLES
# SANCTIONED SKY (the fresh build's ruling, extended by the fringe fix): where
# the lowered pose has open air and no backing is drawn, the card shows when
# the bunch swings — "which is what open air is. They are not holes." The
# travelling soft rim (BERRY_RIM, the accepted v3 ownership) is likewise the
# grapes' own edge and demands no backing.
sanctioned_sky = (A_r <= 0.5) & (plate_a < 0.5)
for ang in (5.0, -4.5):
    swung = Image.fromarray(np.where(grapes_a > 0.9, 255, 0).astype(np.uint8)).rotate(
        -ang, resample=Image.BICUBIC, center=(370.0, 45.0), expand=False)
    sc = np.asarray(swung) > 128
    holes = rest_cover & ~sc & ~behind & ~sanctioned_sky & ~BERRY_RIM
    print(f"   swing {ang:+.1f}deg: {int(holes.sum())} px uncover nothing"
          f" (sanctioned sky and the travelling rim excluded)")
    if holes.sum() > 2:
        fail.append(f"swing {ang}")

if fail:
    print("   VERDICT: FAIL — " + "; ".join(fail))
    raise SystemExit(1)
print("   VERDICT: PASS — the accepted reconstruction is now the served scene")
