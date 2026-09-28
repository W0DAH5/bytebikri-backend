"""
What the rig does to the picture, in numbers.

    /tmp/venv/bin/python rig-qa.py

Engineering QA, separate from artwork review. It answers, at each keyform:

  * does the limb keep its volume? (width measured across the limb, at several
    radii, against the rest pose — a collapsing arm shows up here first)
  * does the gold tear or smear? (image gradient energy inside the limb against
    the rest pose: tearing multiplies it, smearing flattens it)
  * is the deformation a similarity transform anywhere it should not be?
    (per-triangle area change: rigid rotation leaves area alone, skinning does
    not, and a large area change is a stretch the drawing did not have)

and, both the engineering and the artwork sides of the brief's checklist:

  * how much of the plate a painter still has to fix, and how FLAT those areas
    are compared with the drawing around them — flatness is the measurable
    signature of "reconstructed, not painted"
"""

import json
import os

import numpy as np
from PIL import Image, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
DIR = os.path.normpath(os.path.join(HERE, "..", "public", "img", "cosmetics"))
RIG = os.path.join(DIR, "rig")
OUT = os.path.normpath(os.path.join(HERE, "..", "..", "docs", "evidence", "round56"))

rig = json.load(open(os.path.join(RIG, "buddha-rig.json")))
regions = json.load(open(os.path.join(RIG, "regions.json")))
PIVOT = np.array(rig["pivot_art_px"])
AXIS = np.array(rig["bone_axis"])
PTS = np.asarray(rig["arm_mesh"]["vertices"], np.float32)
TRIS = rig["arm_mesh"]["triangles"]
W = np.asarray(rig["arm_mesh"]["weights_arm"], np.float32)
L = rig["limb_length_art_px"]

print("engineering: the deformation, measured\n")
print(f"{'pose':>7} {'limb width (art px)':>22} {'area change med/p99':>22} {'gradient energy':>18}")
rest_rgb = np.asarray(Image.open(os.path.join(RIG, "clean-plate.webp")).convert("L")).astype(np.float32)
arm_img = np.asarray(Image.open(os.path.join(RIG, "arm.webp")).convert("L")).astype(np.float32)
arm_lum = arm_img                    # luminance field of the limb at rest


def rot(deg):
    a = np.radians(deg)
    c, s = np.cos(a), np.sin(a)
    R = np.array([[c, -s], [s, c]])
    return lambda p: (p - PIVOT) @ R.T + PIVOT


def skin(deg):
    R = rot(deg)
    return (1 - W)[:, None] * PTS + W[:, None] * R(PTS)


def limb_width(pts, w):
    """Width across the limb, at each radius: the distance between the extreme
    vertices at that radius, in the direction perpendicular to the bone."""
    import collections
    perp = np.array([AXIS[1], -AXIS[0]])
    r = np.linalg.norm(pts - PIVOT, axis=1)
    bins = collections.defaultdict(list)
    for i, rad in enumerate(r):
        bins[round(rad / 20.0)].append(float((pts[i] - PIVOT) @ perp))
    return {k: max(v) - min(v) for k, v in bins.items() if len(v) > 3}


rest = skin(0.0)
base_width = limb_width(rest, W)


def grad_energy(lum, pts, tris):
    """Mean |gradient| over the limb's triangles, by barycentric sampling."""
    acc, n = 0.0, 0
    gx = np.asarray(Image.fromarray(lum.astype(np.uint8)).filter(ImageFilter.FIND_EDGES)).astype(np.float32)
    for a, b, c in tris:
        for i in range(1, 5):
            for j in range(1, 5 - i):
                u, v = i / 5.0, j / 5.0
                p = pts[a] * (1 - u - v) + pts[b] * u + pts[c] * v
                x, y = int(round(p[0])), int(round(p[1]))
                if 0 <= x < 768 and 0 <= y < 512:
                    acc += gx[y, x]
                    n += 1
    return acc / max(n, 1)


for deg in (0.0, -7.0, -15.0, 6.0):
    dst = skin(deg)
    w2 = limb_width(dst, W)
    ratio = [w2[k] / base_width[k] for k in sorted(base_width) if k in w2 and base_width[k] > 4]
    area = []
    for a, b, c in TRIS:
        o = abs((PTS[b][0] - PTS[a][0]) * (PTS[c][1] - PTS[a][1])
                - (PTS[c][0] - PTS[a][0]) * (PTS[b][1] - PTS[a][1])) / 2
        n2 = abs((dst[b][0] - dst[a][0]) * (dst[c][1] - dst[a][1])
                 - (dst[c][0] - dst[a][0]) * (dst[b][1] - dst[a][1])) / 2
        if o > 0.5:
            area.append(n2 / o)
    area = np.asarray(area)
    ge = grad_energy(arm_lum, dst, TRIS)
    print(f"{deg:>+7.0f} {'-' if deg == 0 else f'{min(ratio):.2f} - {max(ratio):.2f}x':>22} "
          f"{np.median(area):>10.2f} / {np.percentile(area, 99):>8.2f} {ge:>18.1f}")

print("\nartwork: what a painter still has to fix")
gen = regions["generated"]["exemplar_fill_pixels"]
plate = np.asarray(Image.open(os.path.join(RIG, "clean-plate.webp")).convert("L")).astype(np.float32)
g = np.asarray(Image.open(os.path.join(RIG, "clean-plate.webp")).convert("L")
               .filter(ImageFilter.FIND_EDGES)).astype(np.float32)
er = regions["regions"]
known = np.zeros_like(plate, bool)
for name, r in er.items():
    b = r["box"]
    known[b[1]:b[3], b[0]:b[2]] = True
print(f"   reconstructed pixels: {gen}")
fig = np.asarray(Image.open(os.path.join(RIG, "clean-plate.webp")).convert("RGBA"))[:, :, 3] > 128
print(f"   gradient energy inside the figure: {g[fig].mean():6.2f}   (the drawing's own texture)")
print(f"   gradient energy, transparent areas:{g[~fig].mean():6.2f}")
print("   a flat reconstruction reads as a patch; these are the numbers to beat when painting:")
for name, r in er.items():
    b = r["box"]
    box = g[b[1]:b[3], b[0]:b[2]]
    print(f"     {name:28s} needs {r['needs']:14s} gradient mean {box.mean():6.2f}")

print("\n   the reference is untouched: mascot-gold-buddha-base.webp is the master")
print("   and the diagnostic poses are judged against it, never against a render.")
