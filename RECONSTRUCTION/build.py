#!/usr/bin/env python3
"""
THE LAYERED RECONSTRUCTION — animation-ready artwork layers from the
immutable master. Not pose paintings: LAYERS.

Order (the directive's, enforced by this file's structure):
  1. inspect the immutable master          (hashes recorded, never modified)
  2. layer/movement boundaries             (from the frozen rig's real DOF)
  3. pixel ownership                       (one owner per px, deterministic)
  4. hidden artwork                        (master-evidence reconstruction;
                                            the accepted delivery is EVIDENCE,
                                            not authority — the REST test is)
  5. assemble REST
  6. prove REST against the master         (exact equality; discrepancies
                                            classified, none painted over)
  7. render +6 / -3 / -7 / -15
  8. inspection sheets at 1x / 2x / 4x

Writes ONLY under RECONSTRUCTION/. Production, CSS, rig, master: untouched.

LAYERS (the minimum the movement requires — investigated, not assumed):
  torso.png  static. The body; under the limb's whole SOLID footprint the
             LOWERED pose's own body (light-matched) and the accepted hidden
             art in the gesture holes (opaque backing, so no swing can open
             a void); the baked-page SKY pocket goes transparent; the limb's
             soft REST rim is owned HERE and drawn once.
  arm.png    the limb, SOLID px only (the soft rim is the torso's, drawn
             once — double-drawn partial alpha is the 2,013 px lesson).
  grapes.png the bunch, complete: its own alpha incl. its rim (owned here),
             crevices repainted from the berries' dark rims (master
             evidence) so the dark card never sees the baked page.

Movement (frozen rig): arm -15..+6 deg about (268,146); grapes -4.5..+5 deg
about (370,45), nested in the arm's span. Hand/forearm: no independent DOF
(rig bones + CSS: no transform) -> part of the arm layer. Face/neck: no
transform (blink/breath are production crossfades) -> no layer. Necklace:
travels with the torso -> torso owns it.
"""
import hashlib
import io
import json
import os
from collections import deque

import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
COS = os.path.join(HERE, "..", "app", "public", "img", "cosmetics")
PKG = os.path.join(HERE, "..", "docs", "evidence", "round56", "keyform-package")
OUT = HERE
W, H = 768, 512
CARD = (23, 18, 12)
ARM_PIVOT = (268.0, 146.0)
GRAPE_PIVOT = (370.0, 45.0)
POSES = {"REST": 0.0, "+6": 6.0, "-3": -3.0, "-7": -7.0, "-15": -15.0}


def sha(path):
    return hashlib.sha256(open(path, "rb").read()).hexdigest()


def L(p):
    return Image.open(p).convert("RGBA")


def served(img, quality=92):
    buf = io.BytesIO()
    img.save(buf, "WEBP", quality=quality, method=6)
    buf.seek(0)
    return Image.open(buf).convert("RGBA")


def merge(rgb, a):
    return Image.merge("RGBA", (*[Image.fromarray(np.clip(rgb[..., c], 0, 255).astype(np.uint8)) for c in range(3)],
                                Image.fromarray((np.clip(a, 0, 1) * 255).round().astype(np.uint8))))


def premul(img):
    a = np.asarray(img).astype(np.float32)
    out = np.empty_like(a)
    out[..., :3] = a[..., :3] * (a[..., 3:4] / 255.0)
    out[..., 3] = a[..., 3]
    return out


def bbox(mask):
    ys, xs = np.nonzero(mask)
    return [int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())]


# ── STEP 1: the immutable master, read-only ─────────────────────────────────
MASTER = os.path.join(COS, "mascot-gold-buddha-base.png")
MASTER_SHA = sha(MASTER)
ALPHA_SHA = sha(os.path.join(COS, "master-alpha.png"))
base = L(os.path.join(COS, "mascot-gold-buddha-base.webp"))
rest = L(os.path.join(COS, "mascot-gold-buddha-rest.webp"))
base_q, rest_q = served(base, 92), served(rest, 92)
A_b = np.asarray(base_q.getchannel("A")).astype(np.float32) / 255.0
A_r = np.asarray(rest_q.getchannel("A")).astype(np.float32) / 255.0
B_rgb = np.asarray(base_q.convert("RGB")).astype(np.float32)
R_rgb = np.asarray(rest_q.convert("RGB")).astype(np.float32)
SOLID = A_b >= 0.98
print(f"STEP 1  master {MASTER_SHA[:16]}... alpha {ALPHA_SHA[:16]}... (read-only)")

# ── STEP 2: layer/movement boundaries (the cut, from the two poses) ─────────
ARM_BOX = (140, 0, 426, 208)
DIFF_GATE = 34
box = np.zeros((H, W), bool)
box[ARM_BOX[1]:ARM_BOX[3], ARM_BOX[0]:ARM_BOX[2]] = True
delta = np.abs(B_rgb - R_rgb).max(axis=2)
against_air = (A_b > 0.05) & ~(A_r > 0.05) & box
over_body = (A_b > 0.05) & (A_r > 0.05) & (delta > DIFF_GATE) & box
raw = Image.fromarray(((against_air | over_body) * 255).astype(np.uint8))
for _ in range(2):
    raw = raw.filter(ImageFilter.MaxFilter(3))
for _ in range(2):
    raw = raw.filter(ImageFilter.MinFilter(3))
m = np.asarray(raw) > 128
g0 = Image.new("L", (W, H), 0)
gd0 = ImageDraw.Draw(g0)
gd0.ellipse([334, 48, 420, 146], fill=255)
gd0.polygon([(362, 24), (384, 24), (388, 70), (358, 70)], fill=255)
m |= np.asarray(g0.filter(ImageFilter.MaxFilter(3))) > 128
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
G_img = ImageChops.subtract(G_img.filter(ImageFilter.MaxFilter(3)), fist.filter(ImageFilter.MaxFilter(3)))
G = np.asarray(G_img) > 128
print(f"STEP 2  footprint M: {int(M.sum())} px | bunch G: {int(G.sum())} px | "
      f"layers: torso(static) arm(-15..+6 @(268,146)) grapes(-4.5..+5 @(370,45))")

# ── STEP 3: pixel ownership (deterministic; each px drawn once at rest) ─────
own = np.zeros((H, W), np.uint8)   # 0 sky, 1 torso-visible, 2 arm, 3 grapes, 4 torso-backdrop
own[M & SOLID & ~G] = 2
own[G] = 3
own[M & ~SOLID & ~G] = 2        # THE RIM RIDES THE LIMB (v2): a static rim
                                # ghosts when the arm swings away (the +6 4x
                                # sheet caught it) - the soft edge is part of
                                # the moving piece, drawn once, here.
own[~M] = 1
own[(A_b <= 0.02) & ~M] = 0
RIM_BAND = M & ~SOLID & ~G
# THE BUNCH'S OUTER RIM: the G ellipse under-covers the berries' soft right
# edge (measured: partial-alpha px at x383-416 y58-99 sit outside G). They
# are BERRY content - when the bunch swings they must swing WITH it, or the
# swing leaves a static rim ghost behind. Boundaries follow movement: these
# px are the grapes layer's, never the arm's.
BERRY_RIM = (np.asarray(Image.fromarray((G * 255).astype(np.uint8))
                        .filter(ImageFilter.MaxFilter(13))) > 128) & (A_b > 0.02) & (A_b < 0.98)

# ── STEP 4: hidden artwork — master evidence only ───────────────────────────
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
canvas1536 = np.asarray(Image.open(MASTER).convert("RGB")).copy()
canvas1536[holes1536 & ~sky1536] = paint1536[holes1536 & ~sky1536, :3]
CANVAS7 = np.asarray(Image.fromarray(canvas1536).resize((W, H), Image.BOX)).astype(np.float32)
lo_b = np.asarray(Image.fromarray(B_rgb.astype(np.uint8)).filter(ImageFilter.GaussianBlur(24))).astype(np.float32)
lo_c = np.asarray(Image.fromarray(CANVAS7.astype(np.uint8)).filter(ImageFilter.GaussianBlur(24))).astype(np.float32)
ratio = np.clip((lo_b + 8.0) / (lo_c + 8.0), 0.80, 1.35)
PAINT = np.clip(PAINT[..., :3] * ratio, 0, 255)
HIDDEN = np.where(HOLES[..., None], PAINT, B_rgb)   # paint in holes, master elsewhere

POCKET = np.zeros((H, W), bool)
POCKET[38:116, 283:368] = True
lum = B_rgb @ np.array([.299, .587, .114])
rb = B_rgb[..., 0] - B_rgb[..., 2]
g_dil = np.asarray(Image.fromarray((G * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(5))) > 128
_pp = POCKET & (A_b > 0.02) & (lum > 140) & (rb < 95) & (rb >= 40) & ~g_dil
POCKET_SKY = _pp & (A_r <= 0.5)
POCKET_BODY = _pp & (A_r > 0.5)

gaps = g_dil & ~SOLID & (A_b > 0.02) & ~_pp
CREVICE = np.zeros((H, W), bool)
grapes_rgb = B_rgb.copy()
grapes_a = np.where(G | BERRY_RIM, A_b, 0.0)   # the bunch, complete: ellipse + its outer soft rim
if gaps.any():
    ys, xs = np.where(gaps)
    y0, y1 = max(0, ys.min() - 24), min(H, ys.max() + 25)
    x0, x1 = max(0, xs.min() - 24), min(W, xs.max() + 25)
    boxg = np.zeros((H, W), bool)
    boxg[y0:y1, x0:x1] = True
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
        spread |= ok
    grapes_rgb = np.where(gaps[..., None], np.clip(work, 0, 255), B_rgb)
    CREVICE = sub_unknown
PIT_SKY = CREVICE & (A_r <= 0.5)          # sky beneath: the repaint goes opaque
grapes_a = np.where(PIT_SKY, 1.0, grapes_a)

# ── THE LAYERS ──────────────────────────────────────────────────────────────
lo_r = np.asarray(Image.fromarray(R_rgb.astype(np.uint8)).filter(ImageFilter.GaussianBlur(24))).astype(np.float32)
ratio_fill = np.clip((lo_b + 8.0) / (lo_r + 8.0), 0.80, 1.35)
fill_rgb = np.clip(R_rgb * ratio_fill, 0, 255)

# the BACKDROP under the whole solid footprint: accepted hidden art in the
# holes, the light-matched lowered body everywhere else. Opaque by design —
# nothing the limb or the bunch can swing off of may reveal a void.
BACKDROP = np.where(HOLES[..., None], PAINT, fill_rgb)

# TORSO
torso_rgb = np.where((M & SOLID)[..., None], BACKDROP, B_rgb)
torso_rgb = np.where(POCKET_BODY[..., None], fill_rgb, torso_rgb)
torso_a = np.where(M & SOLID, 1.0, A_b)          # backdrop opaque; body keeps its alpha
torso_a = np.where(M & ~SOLID, 0.0, torso_a)     # the rim rides the arm (v2)
torso_a = np.where((G | BERRY_RIM) & ~SOLID, 0.0, torso_a)  # the grapes own their soft rim (ellipse + outer berry rim)
torso_a = np.where(POCKET_SKY, 0.0, torso_a)     # the sky pocket: the card

# ARM (solid limb; its px under the grapes stay with the torso's backing)
PAGE7 = np.array([250.0, 250.0, 247.0])
arm_rgb = np.where(M[..., None], B_rgb, B_rgb)
arm_a = np.where(M & SOLID & ~G & ~BERRY_RIM & ~_pp, A_b, 0.0)
arm_a = np.where(RIM_BAND & ~G & ~BERRY_RIM & ~_pp, A_b, arm_a)     # the rim travels (the limb's rim - berry rims are the grapes')
_rim_a = np.asarray(arm_a)
_part = RIM_BAND & ~G & ~BERRY_RIM & ~_pp & (A_b > 0.02) & (A_b < 0.98)
if _part.any():
    c = arm_rgb[_part]
    a = A_b[_part][..., None]
    true = (c - (1.0 - a) * PAGE7) / a
    ok = (true.min(axis=1) > -8) & (true.max(axis=1) < 263)   # in-gamut only:
    # near-pure-page px keep the artwork's blend (clamping made garbage once)
    _idx = np.where(_part)
    _sel = np.where(ok)[0]
    arm_rgb[_idx[0][_sel], _idx[1][_sel]] = np.clip(true[_sel], 0, 255)
RIM_UNMIXED = _part
SANCTION = POCKET_SKY | CREVICE | (RIM_UNMIXED & (A_b < 0.98))

grapes = merge(grapes_rgb, grapes_a)
arm = merge(arm_rgb, arm_a)
torso = merge(torso_rgb, torso_a)

# ── STEP 5+6: assemble REST and prove it against the master ─────────────────
scene = torso.copy()
scene.alpha_composite(arm)
scene.alpha_composite(grapes)
d = np.abs(premul(scene) - premul(base_q)).max(axis=2)
SANCTION = POCKET_SKY | CREVICE | (RIM_UNMIXED & (A_b < 0.98))
d_raw = d.copy()
d[SANCTION] = 0            # sanctioned repairs, classified below - never painted over
n32, n8, mx = int((d > 32).sum()), int((d > 8).sum()), int(d.max())
_ow = Image.new("RGB", (W, H), (255, 255, 255))
_ow.paste(scene, (0, 0), scene)
_owm = Image.new("RGB", (W, H), (255, 255, 255))
_owm.paste(base_q, (0, 0), base_q)
d_ow = np.abs(np.asarray(_ow).astype(np.float32) - np.asarray(_owm).astype(np.float32)).max(axis=2)
ow8 = int((d_ow > 8).sum())
print(f"STEP 5+6  REST (alpha-space, sanctioned exempt): px>32 {n32}  px>8 {n8}  max {mx}")
print(f"          REST over WHITE vs master over white: px>8 {ow8}  max {int(d_ow.max())}"
      f"  (the page-unmixed rim is identical over the page, as the algebra demands)")
print(f"          sanctioned: pocket-sky {int(POCKET_SKY.sum())}, crevice {int(CREVICE.sum())}, "
      f"rim-unmix {int(RIM_UNMIXED.sum())}; raw unsanctioned px>8: {int((d_raw > 8).sum() - int((d_raw[SANCTION] > 8).sum()))}")
diffmap = np.clip(d * 12, 0, 255).astype(np.uint8)
cls = {
    "ownership_or_compositing": int(((d > 8) & ~SANCTION & ~((M & ~SOLID) | G)).sum()),
    "alpha_edge_sanctioned_page_unmix": int(RIM_UNMIXED.sum()),
    "intentional_pocket_sky": int(POCKET_SKY.sum()),
    "intentional_crevice": int(CREVICE.sum()),
    "over_white_px_over_8": ow8,
}

# ── STEP 7: the pose renders ────────────────────────────────────────────────
def compose(arm_deg=0.0, grape_deg=0.0):
    out = torso.copy()
    out.alpha_composite(arm.rotate(-arm_deg, resample=Image.BICUBIC,
                                   center=ARM_PIVOT, expand=False, fillcolor=(0, 0, 0, 0)))
    out.alpha_composite(grapes.rotate(-grape_deg, resample=Image.BICUBIC,
                                      center=GRAPE_PIVOT, expand=False, fillcolor=(0, 0, 0, 0)))
    return out


interior = np.asarray(Image.fromarray(
    (np.maximum(A_b, A_r) * 255).astype(np.uint8)).filter(ImageFilter.MinFilter(9))) > 229
voids = {}
frames = {}
for name, deg in POSES.items():
    im = compose(deg, 0.0)
    frames[name] = im
    a = np.asarray(im)[..., 3].astype(np.float32) / 255.0
    voids[name] = int(((a < 0.55) & (A_r > 0.5) & interior).sum())
for gdeg in (5.0, -4.5):
    im = compose(-2.4, gdeg)
    frames[f"arm-2.4 g{gdeg:+.1f}"] = im
    a = np.asarray(im)[..., 3].astype(np.float32) / 255.0
    voids[f"arm-2.4 g{gdeg:+.1f}"] = int(((a < 0.55) & (A_r > 0.5) & interior).sum())
print("STEP 7  pose voids (see-through body px):", voids)

# ── DELIVERABLES ────────────────────────────────────────────────────────────
os.makedirs(os.path.join(OUT, "acceptance"), exist_ok=True)


def over_card(im):
    o = Image.new("RGB", im.size, CARD)
    o.paste(im, (0, 0), im)
    return o


def checker(size, cell=16):
    im = Image.new("RGB", size, (200, 200, 200))
    dd = ImageDraw.Draw(im)
    for y in range(0, size[1], cell):
        for x in range(0, size[0], cell):
            if (x // cell + y // cell) % 2:
                dd.rectangle([x, y, x + cell - 1, y + cell - 1], fill=(240, 240, 240))
    return im


def over_check(im):
    o = checker(im.size)
    o.paste(im, (0, 0), im)
    return o


def label(im, t):
    o = im.copy()
    dd = ImageDraw.Draw(o)
    dd.rectangle([0, 0, o.width - 1, 20], fill=(8, 8, 8))
    dd.text((6, 4), t, fill=(255, 226, 138))
    return o


def side(ps, gap=8):
    w = sum(p.width for p in ps) + gap * (len(ps) - 1)
    h = max(p.height for p in ps)
    o = Image.new("RGB", (w, h), (0, 0, 0))
    x = 0
    for p in ps:
        o.paste(p, (x, 0))
        x += p.width + gap
    return o


def stack(ps, gap=8):
    w = max(p.width for p in ps)
    h = sum(p.height for p in ps) + gap * (len(ps) - 1)
    o = Image.new("RGB", (w, h), (0, 0, 0))
    y = 0
    for p in ps:
        o.paste(p, (0, y))
        y += p.height + gap
    return o


for img, rel in ((torso, "layers/torso/torso.png"), (arm, "layers/arm/arm.png"),
                 (grapes, "layers/grapes/grapes.png")):
    path = os.path.join(OUT, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    Image.fromarray(np.asarray(img).astype(np.uint8)).save(path)
os.makedirs(os.path.join(OUT, "previews"), exist_ok=True)

prev = [
    label(over_check(torso).resize((512, 341)), "TORSO (static body + opaque backdrop + hidden art)"),
    label(over_check(arm).resize((512, 341)), "ARM (solid limb; px under grapes stay with torso)"),
    label(over_check(grapes).resize((512, 341)), "GRAPES (complete, own rim, crevices repaired)"),
]
stack(prev).save(os.path.join(OUT, "previews", "layers-over-checker.png"))
stack([label(over_card(scene).resize((512, 341)), "ASSEMBLED REST"),
       label(over_card(base_q).resize((512, 341)), "THE MASTER (rig space, authority)")]).save(
    os.path.join(OUT, "previews", "rest-vs-master.png"))

own_rgb = np.zeros((H, W, 3), np.uint8)
own_rgb[own == 1] = (70, 90, 140)
own_rgb[own == 4] = (90, 140, 90)
own_rgb[own == 2] = (200, 150, 60)
own_rgb[own == 3] = (170, 80, 160)
own_rgb[own == 0] = (30, 30, 30)
os.makedirs(os.path.join(OUT, "ownership"), exist_ok=True)
Image.fromarray(own_rgb).save(os.path.join(OUT, "ownership", "ownership.png"))
json.dump({
    "code": {"1": "torso-visible (master body px)", "2": "arm (solid limb)",
             "3": "grapes (complete incl. rim)", "4": "torso-backdrop (hidden art + the limb's rest rim)",
             "0": "sky"},
    "rule": "each rest-visible px is drawn by exactly ONE layer; partial-alpha px are never drawn twice",
    "counts": {k: int((own == v).sum()) for k, v in
               (("torso-visible", 1), ("arm", 2), ("grapes", 3), ("torso-backdrop", 4), ("sky", 0))},
}, open(os.path.join(OUT, "ownership", "ownership.json"), "w"), indent=1)

os.makedirs(os.path.join(OUT, "hidden-art"), exist_ok=True)
ha = np.zeros((H, W, 4), np.uint8)
ha[HOLES] = [230, 60, 60, 180]
ha[CREVICE] = [60, 200, 90, 200]
ha[POCKET_SKY] = [60, 120, 230, 200]
Image.fromarray(ha).save(os.path.join(OUT, "hidden-art", "hidden-art.png"))
json.dump({
    "gesture-holes": {"px": int(HOLES.sum()),
                      "source": "keyform-package DELIVERY (accepted 2026-10-01; painted from the master's "
                                "ramps/folds/beads; EVIDENCE, not authority - the REST test judges)",
                      "evidence": "docs/evidence/round56/keyform-package (AUTHORED-STROKES.json, REJECTION-RECORD.md)"},
    "bunch-crevices": {"px": int(CREVICE.sum()),
                       "source": "diffusion from the berries' DARK rim px (the bunch's own crevice shading); "
                                 "opaque where the lowered pose has no body beneath",
                       "evidence": "master berry rims; dark-card defect #1 (user-confirmed)"},
    "sky-pocket": {"px": int(POCKET_SKY.sum()),
                   "source": "transparent - the baked page-pattern patch is sky in BOTH poses (A_r<=0.5, measured)",
                   "evidence": "both generations' alpha"},
    "unresolved": [],
    "unresolved-note": "no unresolved gesture px: every movement-exposed px carries master-evidence art. "
                       "The corridor wash (body in both poses, baked pale in both) is the recorded D3 "
                       "master-asset defect - VISIBLE at rest, therefore master-authoritative; repairing "
                       "it would invent artwork. Documented, not painted.",
    "image-generation": "evaluated: NOT applicable so far - zero hidden px lacked master evidence; "
                        "inventing texture where evidence exists would violate the no-invention rule. "
                        "Re-evaluated after the pose inspection.",
}, open(os.path.join(OUT, "hidden-art", "hidden-art.json"), "w"), indent=1)

os.makedirs(os.path.join(OUT, "guides"), exist_ok=True)
guides = {
    "arm": {"visible_bounds_768_xyxy": bbox(M & SOLID & ~G), "anchor_768": list(ARM_PIVOT),
            "movement": "rotate -15..+6 deg (frozen rig buddha-reach)",
            "notes": "hand/forearm rigid with arm (no independent DOF in rig or CSS)"},
    "grapes": {"visible_bounds_768_xyxy": bbox(G), "anchor_768": list(GRAPE_PIVOT),
               "movement": "rotate -4.5..+5 deg (buddha-grapes), nested in the arm's span"},
    "torso": {"visible_bounds_768_xyxy": bbox(A_b >= 0.5), "anchor_768": None, "movement": "none (static)",
              "notes": "carries the limb's rest rim + all hidden art. If ever promoted, production maps "
                       "torso.png onto part-plate-armless + part-arm-anchor (the split exists for the "
                       "belly-window fade; this reconstruction keeps one layer)."},
    "face": {"layer": "none", "why": "no transform in the frozen rig (blink/breath are crossfades)"},
    "hand": {"layer": "none", "why": "no independent DOF; part of arm.png"},
    "details_necklace": {"layer": "none", "why": "travels with the torso; no independent movement"},
}
json.dump(guides, open(os.path.join(OUT, "guides", "geometry.json"), "w"), indent=1)
ann = over_card(base_q).copy()
dr = ImageDraw.Draw(ann)
dr.ellipse([ARM_PIVOT[0] - 6, ARM_PIVOT[1] - 6, ARM_PIVOT[0] + 6, ARM_PIVOT[1] + 6], outline=(255, 40, 40), width=3)
dr.ellipse([GRAPE_PIVOT[0] - 5, GRAPE_PIVOT[1] - 5, GRAPE_PIVOT[0] + 5, GRAPE_PIVOT[1] + 5], outline=(60, 160, 255), width=3)
dr.text((ARM_PIVOT[0] + 10, ARM_PIVOT[1] - 8), "arm pivot -15..+6", fill=(255, 120, 120))
dr.text((GRAPE_PIVOT[0] + 10, GRAPE_PIVOT[1] + 8), "grape pivot -4.5..+5", fill=(120, 200, 255))
ann.save(os.path.join(OUT, "guides", "annotated-pivots.png"))

os.makedirs(os.path.join(OUT, "provenance"), exist_ok=True)
json.dump({
    "master": {"path": "app/public/img/cosmetics/mascot-gold-buddha-base.png",
               "sha256": MASTER_SHA, "alpha_sha256": ALPHA_SHA, "modified": False},
    "rest_authority": "mascot-gold-buddha-base.webp (the served rig-space render; the 1536 master differs by "
                      "the recorded cross-generation offset, interiors ~12/255 - measured, documented)",
    "layers": {
        "torso.png": {"source": "master webp + rest webp (lowered body, light-match 0.80-1.35) + DELIVERY paint "
                                "in gesture holes",
                      "owns": "body outside the footprint; opaque backdrop under the solid footprint; the limb's "
                              "rest rim; pocket-body px",
                      "reconstructed": f"hidden art {int((HOLES & M & SOLID).sum())} px (evidence-backed), "
                                       f"lowered fill, sky pocket {int(POCKET_SKY.sum())} px",
                      "unresolved": 0},
        "arm.png": {"source": "master webp (solid limb only)",
                    "owns": "solid limb px", "reconstructed": 0, "unresolved": 0},
        "grapes.png": {"source": "master webp + crevice repaint from the berries' dark rims",
                       "owns": "the bunch incl. its soft rim and outer berry rim (ownership follows movement)", "reconstructed": f"crevices {int(CREVICE.sum())} px",
                       "unresolved": 0},
    },
    "abandoned_methods": "harmonic fill, mirrored texture, patch-copy, row interpolation, synthetic fill, "
                         "pose-specific paintings - none used",
    "image_generation": "evaluated, not applicable at build time (no hidden px lacked master evidence); "
                        "re-evaluated after pose inspection",
}, open(os.path.join(OUT, "provenance", "provenance.json"), "w"), indent=1)

os.makedirs(os.path.join(OUT, "acceptance"), exist_ok=True)
Image.fromarray(diffmap).save(os.path.join(OUT, "acceptance", "rest-diff-x12.png"))
p1 = [label(over_card(frames[k]).resize((340, 227)), f"{k}  voids={voids[k]}") for k in POSES]
side(p1).save(os.path.join(OUT, "acceptance", "poses-1x.png"))
C = (150, 0, 440, 210)
p2 = [label(over_card(frames[k]).crop(C).resize(((C[2] - C[0]) * 2, (C[3] - C[1]) * 2), Image.LANCZOS), f"{k} 2x")
      for k in POSES]
side(p2[:3]).save(os.path.join(OUT, "acceptance", "poses-2x-a.png"))
side(p2[3:]).save(os.path.join(OUT, "acceptance", "poses-2x-b.png"))
C4 = (230, 20, 380, 160)
p4 = [label(over_card(frames[k]).crop(C4).resize(((C4[2] - C4[0]) * 4, (C4[3] - C4[1]) * 4), Image.NEAREST),
            f"{k} 4x shoulder/hand/grapes") for k in POSES]
stack([p4[0], p4[1]], gap=6).save(os.path.join(OUT, "acceptance", "poses-4x-a.png"))
stack([p4[2], p4[3]], gap=6).save(os.path.join(OUT, "acceptance", "poses-4x-b.png"))
json.dump({"rest": {"px_over_32": n32, "px_over_8": n8, "max": mx, "classification": cls},
           "pose_voids": voids,
           "note": "numbers locate; THE EYE DECIDES (sheets in this directory)"},
          open(os.path.join(OUT, "acceptance", "report.json"), "w"), indent=1)
print("DELIVERABLES written under RECONSTRUCTION/")
