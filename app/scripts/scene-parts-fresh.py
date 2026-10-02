#!/usr/bin/env python3
"""
THE FRESH PART BUILD — each part its own complete original picture.

The method (the user's hypothesis, confirmed by Live2D's own illustration-
processing guide and Clip Studio's official Live2D companion): divide the
character into the minimum parts the motion needs — here the BODY (still),
the ARM (rotates about the shoulder), the BUNCH (rotates about the stem,
nested in the arm's swing) — draw every part COMPLETE (each part is its own
original picture, nothing cut away from the master), and fit them together
like puzzle pieces: the stacked scene at rest must BE the original artwork,
bit for bit. "Always overlap the divided parts with the original drawing
after cutting them out and check for any missing parts."

Sources, and nothing else:
  * the served artwork (mascot-gold-buddha-base.webp) — every pixel a part
    shows AT REST is this file's own pixel;
  * the accepted painted delivery (keyform-package DELIVERY, 18,998 px,
    numeric gate + 4x eye passed) — every pixel a part shows ONLY WHILE
    MOVING (under the turning limb, under the swinging berries) is the
    delivery's paint;
  * the two poses the artwork itself provides (base/rest) for the lowered
    body the belly window must show.

The one sanctioned deviation from the artwork: the baked page-pattern pocket
beside the fist — sky in both generations — goes transparent, so the card
shows through. The master is never modified; if a part is deleted the
artwork is untouched on disk.

Roles, stated once, enforced below:
  ARM   = the visible limb: solid pixels only, the artwork's own colours.
          Under opaque berries (revealed by the swing) it carries the paint.
  ANCHOR= the limb's backdrop: the artwork's own alpha across the footprint
          (the soft rim rides it — one alpha deep, never doubled), the paint
          where the holes lie under solid coverage (seen only when the limb
          turns away).
  PLATE = the body, and behind the footprint the LOWERED pose's own body,
          light-matched — what the belly window shows when arm and anchor
          step aside.
  GRAPES= the straight copy: the artwork's own pixels and alpha.

    python3 app/scripts/scene-parts-fresh.py
"""
import io
import json
import os
from collections import deque

import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
DIR = os.path.join(HERE, "..", "public", "img", "cosmetics")
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


base, rest = state("base"), state("rest")
base_q, rest_q = served(base, 92), served(rest, 92)
A_b = np.asarray(base_q.getchannel("A")).astype(np.float32) / 255.0
A_r = np.asarray(rest_q.getchannel("A")).astype(np.float32) / 255.0
B_rgb = np.asarray(base_q.convert("RGB")).astype(np.float32)
R_rgb = np.asarray(rest_q.convert("RGB")).astype(np.float32)

# ── 1. WHERE THE PARTS SPLIT (the cut, from the two poses as drawn) ─────────
ARM_BOX = (140, 0, 426, 208)
DIFF_GATE = 34
box = np.zeros((H, W), bool)
box[ARM_BOX[1]:ARM_BOX[3], ARM_BOX[0]:ARM_BOX[2]] = True
paint_b, paint_r = A_b > 0.05, A_r > 0.05
delta = np.abs(B_rgb - R_rgb).max(axis=2)
against_air = paint_b & ~paint_r & box
over_body = paint_b & paint_r & (delta > DIFF_GATE) & box
raw = Image.fromarray(((against_air | over_body) * 255).astype(np.uint8))
for _ in range(2):
    raw = raw.filter(ImageFilter.MaxFilter(3))
for _ in range(2):
    raw = raw.filter(ImageFilter.MinFilter(3))
m = np.asarray(raw) > 128

gd_img = Image.new("L", (W, H), 0)
gd = ImageDraw.Draw(gd_img)
gd.ellipse([334, 48, 420, 146], fill=255)
gd.polygon([(362, 24), (384, 24), (388, 70), (358, 70)], fill=255)
m |= np.asarray(gd_img.filter(ImageFilter.MaxFilter(3))) > 128

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
if n_lab:
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

G_img = Image.new("L", (W, H), 0)
gd = ImageDraw.Draw(G_img)
gd.ellipse([338, 52, 416, 142], fill=255)
gd.polygon([(364, 28), (382, 28), (386, 68), (360, 68)], fill=255)
fist = Image.new("L", (W, H), 0)
ImageDraw.Draw(fist).ellipse([344, 16, 400, 60], fill=255)
G_img = ImageChops.subtract(
    G_img.filter(ImageFilter.MaxFilter(3)), fist.filter(ImageFilter.MaxFilter(3)))
G = np.asarray(G_img) > 128

SOLID = A_b >= 0.98

# ── 2. THE HIDDEN ART — the accepted delivery, light-matched once ───────────
manifest = json.load(open(os.path.join(PKG, "manifest.json")))
holes1536 = np.zeros((1024, 1536), bool)
paint1536 = np.zeros((1024, 1536, 4), np.uint8)
for r in manifest:
    rid = r["id"]
    holes1536 |= np.load(os.path.join(PKG, rid + "-mask.npy")) > 0
    p = np.asarray(Image.open(os.path.join(PKG, "DELIVERY", rid + "-paint.png")).convert("RGBA"))
    ox, oy = r["template_offset"]
    paint1536[oy:oy + p.shape[0], ox:ox + p.shape[1]] = p
sky1536 = np.load(os.path.join(PKG, "SKY-page-belongs.npy")) > 0


def half(mask):
    return np.asarray(Image.fromarray((mask * 255).astype(np.uint8)).resize((W, H), Image.BOX)) >= 128


HOLES = half(holes1536) & ~half(sky1536)
PAINT = np.asarray(Image.fromarray(paint1536).resize((W, H), Image.BOX)).astype(np.float32)

# One low-frequency match (the paints were graded against the 1536 master;
# the parts are the served 768 artwork), blurred over the paints' REAL
# backdrop — the accepted canvas — never over black transparency.
canvas1536 = np.asarray(Image.open(os.path.join(
    DIR, "mascot-gold-buddha-base.png")).convert("RGB")).copy()
canvas1536[holes1536 & ~sky1536] = paint1536[holes1536 & ~sky1536, :3]
CANVAS7 = np.asarray(Image.fromarray(canvas1536).resize((W, H), Image.BOX)).astype(np.float32)
lo_b = np.asarray(Image.fromarray(B_rgb.astype(np.uint8)).filter(ImageFilter.GaussianBlur(24))).astype(np.float32)
lo_c = np.asarray(Image.fromarray(CANVAS7.astype(np.uint8)).filter(ImageFilter.GaussianBlur(24))).astype(np.float32)
ratio = np.clip((lo_b + 8.0) / (lo_c + 8.0), 0.80, 1.35)
PAINT = np.clip(PAINT[..., :3] * ratio, 0, 255)

# ── 3. THE POCKET — the sanctioned baked-page repair ────────────────────────
# The box covers the whole corridor between arm and bunch, because the wash
# the dark card exposes runs the length of it (measured on the sheets: pale
# grey below the fist and left of the bunch, baked into BOTH generations).
# The classifier stays strict: bright + too grey for this gold (genuine gold
# holds R-B >= 95), never the berries themselves.
POCKET = np.zeros((H, W), bool)
POCKET[38:188, 283:368] = True
lum = B_rgb @ np.array([.299, .587, .114])
rb = B_rgb[..., 0] - B_rgb[..., 2]
g_dil = np.asarray(Image.fromarray((G * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(5))) > 128
_pp = POCKET & (A_b > 0.02) & (lum > 140) & (rb < 95) & (rb >= 40) & ~g_dil
# TWO KINDS of baked page: where the LOWERED pose also has no body it is sky
# (the card shows through everywhere); where the lowered pose HAS body, the
# plate shows the lowered body instead (opaque - otherwise the swing tears
# real body see-through), and only the raised pose's furniture (anchor, arm)
# steps aside there.
PAGE_POCKET_SKY = _pp & (A_r <= 0.5)
PAGE_POCKET_BODY = _pp & (A_r > 0.5)
PAGE_POCKET = _pp

# ── 4. THE PARTS, each complete, each with its job ──────────────────────────
lo_r = np.asarray(Image.fromarray(R_rgb.astype(np.uint8)).filter(ImageFilter.GaussianBlur(24))).astype(np.float32)
ratio_fill = np.clip((lo_b + 8.0) / (lo_r + 8.0), 0.80, 1.35)
fill_rgb = np.clip(R_rgb * ratio_fill, 0, 255)

# PLATE — the body; behind the footprint, the lowered body (the belly window
# shows it when arm and anchor step aside); pocket goes to the card.
plate_rgb = np.where((M & SOLID)[..., None], fill_rgb, B_rgb)
plate_a = np.where(M & SOLID, A_r, np.where(M, 0.0, A_b))
plate_rgb = np.where(PAGE_POCKET_BODY[..., None], fill_rgb, plate_rgb)
plate_a = np.where(PAGE_POCKET_BODY, A_r, plate_a)
plate_a = np.where(PAGE_POCKET_SKY, 0.0, plate_a)
plate_a = np.where(G & M & SOLID, 0.0, plate_a)   # no ghost bunch in the plate

# ANCHOR — the limb's backdrop: the artwork's own alpha across the whole
# footprint (the soft rim rides HERE, one alpha deep — never doubled with the
# limb's), the artwork's own colours everywhere EXCEPT under solid coverage
# in the holes, where the accepted paint waits for the limb to turn away.
anchor_rgb = np.where((HOLES & SOLID & ~G & ~PAGE_POCKET)[..., None], PAINT, B_rgb)
# the GRAPES' own soft rim stays the grapes': a partial-alpha berry edge drawn
# by both layers doubles its alpha (measured: 70 px along the cheek-side rim).
anchor_a = np.where(M & ~(G & ~SOLID), A_b, 0.0)
anchor_a = np.where(PAGE_POCKET, 0.0, anchor_a)

# ARM — the visible limb, complete: SOLID pixels only (the soft rim belongs
# to the anchor — partial alpha drawn twice is the one arithmetic that breaks
# the puzzle), the artwork's own colours — except under the berries, where
# the paint is what a swung berry reveals.
arm_rgb = np.where(M[..., None], B_rgb, B_rgb)
arm_rgb = np.where((G & SOLID & ~PAGE_POCKET)[..., None], PAINT, arm_rgb)
arm_alpha = np.where(M & SOLID & ~G & ~PAGE_POCKET, A_b, 0.0)

# GRAPES — the artwork's own pixels and alpha, WITH the one repaint the dark
# card forced and the eye confirmed (defect #1): between the berries the
# artwork's alpha is partial or zero and the BAKED PAGE shows through — pale
# mush over a dark card. The gaps are repainted from the neighbouring berries'
# DARK rim pixels (the bunch's own crevice shading — never from the bright
# berry faces, which averaged to a pale wedge once before), opaque where the
# sky is beneath (the pits), colour-only where the plate carries the figure.
# This is a SANCTIONED deviation at rest, like the pocket, and it is exempt
# in the puzzle check below.
gd_d = np.asarray(Image.fromarray((G * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(5))) > 128
gaps = gd_d & ~SOLID & (A_b > 0.02) & ~PAGE_POCKET
crevice = B_rgb.copy()
grapes_a = np.where(G, A_b, 0.0)
if gaps.any():
    ys, xs = np.where(gaps)
    y0, y1 = max(0, ys.min() - 24), min(H, ys.max() + 25)
    x0, x1 = max(0, xs.min() - 24), min(W, xs.max() + 25)
    boxg = np.zeros((H, W), bool); boxg[y0:y1, x0:x1] = True
    sub_unknown = gaps & boxg
    _adj = np.asarray(Image.fromarray((gaps * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(3))) > 128
    _cand = SOLID & boxg & _adj & ~POCKET
    _lum = B_rgb @ np.array([.299, .587, .114])
    _med = float(np.median(_lum[_cand])) if _cand.any() else 0.0
    sub_source = _cand & (_lum <= _med)
    if not sub_source.any():
        sub_source = _cand
    work = B_rgb.copy()
    work[sub_unknown] = B_rgb[sub_source].mean(axis=0)
    spread = sub_unknown | sub_source
    for _ in range(4000):
        acc = np.zeros_like(work)
        cnt = np.zeros((H, W), np.float32)
        for axis, shift in ((0, 1), (0, -1), (1, 1), (1, -1)):
            v = np.roll(work, shift, axis=axis)
            msk = np.roll(spread, shift, axis=axis)
            acc += v * msk[..., None]
            cnt += msk
        ok = sub_unknown & (cnt > 0)
        work[ok] = acc[ok] / cnt[ok][..., None]
        spread = spread | ok
        if bool((sub_unknown & ~spread).any()) is False:
            pass
    crevice = np.clip(work, 0, 255)
    grapes_rgb = np.where(gaps[..., None], crevice, B_rgb)
    _plate_fig = plate_a >= 0.5
    grapes_a = np.where(sub_unknown & ~_plate_fig, 1.0, grapes_a)
    CREVICE_SET = sub_unknown
else:
    CREVICE_SET = np.zeros((H, W), bool)


def merge(rgb, a):
    return Image.merge("RGBA", (*[Image.fromarray(np.clip(rgb[..., c], 0, 255).astype(np.uint8)) for c in range(3)],
                                Image.fromarray((np.clip(a, 0, 1) * 255).round().astype(np.uint8))))


plate = merge(plate_rgb, plate_a)
anchor = merge(anchor_rgb, anchor_a)
arm = merge(arm_rgb, arm_alpha)
grapes_part = merge(grapes_rgb, grapes_a)

# ── 5. THE LOWERED HAND, THE BREATH, THE BLINK — original mechanisms ────────
_pd = np.abs(R_rgb - plate_rgb).max(axis=2)
LOWER_BOX = (200, 138, 404, 302)
lower_box = np.zeros((H, W), bool)
lower_box[LOWER_BOX[1]:LOWER_BOX[3], LOWER_BOX[0]:LOWER_BOX[2]] = True
hand = (_pd > 26) & lower_box & (A_r > 0.05)
h = Image.fromarray((hand * 255).astype(np.uint8))
for _ in range(2):
    h = h.filter(ImageFilter.MaxFilter(3))
for _ in range(2):
    h = h.filter(ImageFilter.MinFilter(3))
hm = np.asarray(h) > 128
lab2 = np.zeros((H, W), np.int32)
n2 = 0
for y0, x0 in np.argwhere(hm):
    if lab2[y0, x0]:
        continue
    n2 += 1
    q = deque([(y0, x0)])
    lab2[y0, x0] = n2
    while q:
        y, x = q.popleft()
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ny, nx = y + dy, x + dx
            if 0 <= ny < H and 0 <= nx < W and hm[ny, nx] and not lab2[ny, nx]:
                lab2[ny, nx] = n2
                q.append((ny, nx))
if n2:
    sizes2 = np.bincount(lab2.ravel())
    hm = np.isin(lab2, np.where(sizes2 >= 120)[0][1:])
free2 = ~hm
seen2 = np.zeros_like(free2)
q = deque()
for x in range(W):
    for y in (0, H - 1):
        if free2[y, x] and not seen2[y, x]:
            seen2[y, x] = True
            q.append((y, x))
for y in range(H):
    for x in (0, W - 1):
        if free2[y, x] and not seen2[y, x]:
            seen2[y, x] = True
            q.append((y, x))
while q:
    y, x = q.popleft()
    for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        yy, xx = y + dy, x + dx
        if 0 <= yy < H and 0 <= xx < W and free2[yy, xx] and not seen2[yy, xx]:
            seen2[yy, xx] = True
            q.append((yy, xx))
hand = hm | (~seen2)
lower_mask = Image.fromarray((hand * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.0))
lower_rgb = np.where(hand[..., None], R_rgb, plate_rgb)
lowered = merge(lower_rgb, A_r)
lowered.putalpha(ImageChops.multiply(lowered.getchannel("A"), lower_mask))

blink_src = served(state("blink").convert("RGBA"), 92)
eye_mask = Image.new("L", (W, H), 0)
ImageDraw.Draw(eye_mask).ellipse([432, 46, 534, 106], fill=255)
eye_mask = eye_mask.filter(ImageFilter.GaussianBlur(8))
eye_blink = blink_src.copy()
eye_blink.putalpha(ImageChops.multiply(eye_blink.getchannel("A"), eye_mask))

breath = served(state("breath").convert("RGBA"), 92)
CHEST = [(262, 172), (282, 162), (306, 156), (332, 156), (358, 162), (384, 172),
         (404, 186), (414, 204), (410, 224), (396, 240), (374, 252), (348, 260),
         (320, 264), (294, 262), (272, 252), (258, 238), (252, 220), (254, 194)]
chest_mask = Image.new("L", (W, H), 0)
ImageDraw.Draw(chest_mask).polygon(CHEST, fill=255)
chest_mask = chest_mask.filter(ImageFilter.GaussianBlur(9))
lo_br = np.asarray(Image.fromarray(np.asarray(breath.convert("RGB")).astype(np.uint8))
                   .filter(ImageFilter.GaussianBlur(24))).astype(np.float32)
ratio_b = np.clip((lo_b + 8.0) / (lo_br + 8.0), 0.80, 1.35)
chest_rgb = np.clip(np.asarray(breath.convert("RGB")).astype(np.float32) * ratio_b, 0, 255)
chest_breath = merge(chest_rgb, np.asarray(breath.getchannel("A")).astype(np.float32) / 255.0)
chest_breath.putalpha(ImageChops.multiply(chest_breath.getchannel("A"), chest_mask))

# ── 6. THE PUZZLE CHECK — the stacked scene at rest IS the artwork ──────────
def premul(img):
    a = np.asarray(img).astype(np.float32)
    out = np.empty_like(a)
    out[..., :3] = a[..., :3] * (a[..., 3:4] / 255.0)
    out[..., 3] = a[..., 3]
    return out


scene = plate.copy()
scene.alpha_composite(anchor)
scene.alpha_composite(arm)
scene.alpha_composite(grapes_part)
d = np.abs(premul(scene) - premul(base_q)).max(axis=2)
d_sanc = d.copy()
d_sanc[PAGE_POCKET] = 0
d_sanc[CREVICE_SET] = 0
print("THE PUZZLE CHECK (scene at rest vs the served artwork)")
print(f"   px over 32: {int((d_sanc > 32).sum())}   px over 8: {int((d_sanc > 8).sum())}   max {int(d_sanc.max())}"
      f"   (sanctioned pocket excluded: {int((PAGE_POCKET).sum())} px)")

interior = np.asarray(Image.fromarray(
    ((np.maximum(A_b, A_r)) * 255).astype(np.uint8)).filter(ImageFilter.MinFilter(9))) > 229
for deg in (7, 15):
    rot = np.asarray(arm.rotate(-deg, resample=Image.BICUBIC, center=(268.0, 146.0),
                                expand=False, fillcolor=(0, 0, 0, 0))).astype(np.float32) / 255.0
    anc = np.asarray(anchor.getchannel("A")).astype(np.float32) / 255.0
    cov = rot[..., 3] + anc * (1 - rot[..., 3]) + plate_a * (1 - rot[..., 3]) * (1 - anc)
    gap = int(((cov < 0.55) & (A_r > 0.5) & interior).sum())
    print(f"   GAP at -{deg}deg: {gap} px of body see-through inside the figure")

rest_cover = np.asarray(Image.fromarray((np.where(grapes_a > 0.9, 255, 0).astype(np.uint8)))) > 128
behind = (arm_alpha > 0.9) | (plate_a > 0.5) | (anchor_a > 0.5) | HOLES
# the repainted sky-pits are SANCTIONED sky: when the bunch swings they show
# the card, which is what open air is. They are not holes.
PIT_SKY = CREVICE_SET & (plate_a < 0.5)
for ang in (5.0, -4.5):
    swung = Image.fromarray((np.where(grapes_a > 0.9, 255, 0).astype(np.uint8))).rotate(
        -ang, resample=Image.BICUBIC, center=(370.0, 45.0), expand=False)
    sc = np.asarray(swung) > 128
    holes = rest_cover & ~sc & ~behind & ~PIT_SKY
    print(f"   swing {ang:+.1f}deg: {int(holes.sum())} px uncover nothing (sanctioned pits excluded)")

over_card = Image.new("RGB", (W, H), CARD)
over_card.paste(scene, (0, 0), scene)
oc = np.asarray(over_card).astype(np.float32)
oc_lum = oc @ np.array([.299, .587, .114])
oc_rb = oc[..., 0] - oc[..., 2]
_sky_pale = int(((oc_lum > 140) & (oc_rb >= 40) & (oc_rb <= 85) & PAGE_POCKET_SKY).sum())
print(f"   pocket pale px over the dark card (sky region): {_sky_pale}")
print("   note: the corridor's lower part is body in BOTH poses, baked pale in"
      " both - that is the recorded D3 master-asset defect, not repairable"
      " without inventing; out of scope by the standing rules.")

# ── 7. WRITE — lossless, every part ─────────────────────────────────────────
for img, name in ((plate, "part-plate-armless.webp"), (anchor, "part-arm-anchor.webp"),
                  (arm, "part-arm-raised.webp"), (grapes_part, "part-grapes-raised.webp"),
                  (lowered, "part-arm-lowered.webp"), (eye_blink, "part-eye-blink.webp"),
                  (chest_breath, "part-chest-breath.webp")):
    buf = io.BytesIO()
    img.save(buf, "WEBP", lossless=True, method=6, quality=100)
    with open(os.path.join(DIR, name), "wb") as fh:
        fh.write(buf.getvalue())
    print(f"   -> {name}: lossless, {len(buf.getvalue()) / 1024:.1f} KB")
print("verdict: fresh parts written — the puzzle check and the sheets decide")
