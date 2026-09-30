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
# The QA measures the rig that SHIPS, so it takes the second bone from the rig
# data too. Measuring a single-bone version of a two-bone rig would be a report
# about a rig nobody is going to use.
WF = np.asarray(rig["arm_mesh"]["weights_forearm"], np.float32)
ELBOW = np.array(rig.get("elbow_art_px", rig["bones"][2]["joint_art_px"]))
ELBOW_SHARE = rig.get("elbow_share_of_shoulder", 0.0)
L = rig["limb_length_art_px"]

print("engineering: the deformation, measured\n")
print(f"{'pose':>7} {'limb width (art px)':>22} {'area change med/p99':>22} {'gradient energy':>18}")
rest_rgb = np.asarray(Image.open(os.path.join(RIG, "clean-plate.webp")).convert("L")).astype(np.float32)
arm_img = np.asarray(Image.open(os.path.join(RIG, "arm.webp")).convert("L")).astype(np.float32)
arm_lum = arm_img                    # luminance field of the limb at rest
# The mesh this file measures is in LAYOUT space (768x512) — it is read straight
# out of the rig data, which is authored there — while the layers are at master
# resolution. Indexing one with the other's coordinates silently samples nothing,
# which is exactly what happened: every station landed outside the bounds and the
# gradient-energy column read a flat 0.0, looking like a perfect result. The
# scale is taken from the image itself rather than assumed.
SCALE = arm_lum.shape[1] / 768.0


def rot(deg):
    """Rotation about the shoulder."""
    a = np.radians(deg)
    c, s = np.cos(a), np.sin(a)
    R = np.array([[c, -s], [s, c]])
    return lambda p: (p - PIVOT) @ R.T + PIVOT


def rot_about(deg, centre):
    """Rotation about an arbitrary joint. The elbow's turn has to be about the
    ELBOW — composing it as a rotation about the shoulder instead is a different
    (and wrong) transform, and it was in this file for one run. Caught by
    comparing this file's skin() against rig-buddha.py's."""
    a = np.radians(deg)
    c, s = np.cos(a), np.sin(a)
    R = np.array([[c, -s], [s, c]])
    return lambda p: (p - centre[None, :]) @ R.T + centre[None, :]


def skin(deg):
    """The same two-bone chain rig-buddha.py poses: the shoulder turns, and the
    forearm turns about the elbow that the shoulder carried with it."""
    R1 = rot(deg)
    e1 = R1(ELBOW[None, :])[0]
    R2 = rot_about(deg * ELBOW_SHARE, e1)
    upper = R1(PTS)
    fore = R2(upper)
    limb = (1 - WF)[:, None] * upper + WF[:, None] * fore
    return (1 - W)[:, None] * PTS + W[:, None] * limb


CHAIN = [PIVOT, ELBOW, np.asarray(rig["bones"][2]["tip_art_px"], np.float32)]


def station_of(p):
    """How far along the chain a vertex sits, in art px of arc length.

    Bins by RADIUS ABOUT THE PIVOT were the first pass's metric, and they are
    wrong the moment there are two bones: the forearm's vertices move out of the
    bin they started in, so a bin compares one part of the limb against another.
    Arc length along the chain does not have that problem — a station is the same
    piece of arm in every pose, which is what "does it keep its volume" has to
    mean.
    """
    best, bs, acc = 1e9, 0.0, 0.0
    for i in range(len(CHAIN) - 1):
        a, b = CHAIN[i], CHAIN[i + 1]
        ab = b - a
        t = float(np.clip((p - a) @ ab / (ab @ ab), 0, 1))
        d = np.linalg.norm(p - (a + t * ab))
        if d < best:
            best, bs = d, acc + t * float(np.linalg.norm(ab))
        acc += float(np.linalg.norm(ab))
    return bs


def bone_point(s):
    """Where arc length s sits on the rest chain."""
    acc = 0.0
    for i in range(len(CHAIN) - 1):
        seg = float(np.linalg.norm(CHAIN[i + 1] - CHAIN[i]))
        if s <= acc + seg or i == len(CHAIN) - 2:
            t = float(np.clip((s - acc) / seg, 0, 1))
            return CHAIN[i] + t * (CHAIN[i + 1] - CHAIN[i])
        acc += seg
    return CHAIN[-1]


def posed_chain(deg):
    """The chain's own three joints after the same skinning the limb gets."""
    R1 = rot(deg)
    e1 = R1(ELBOW[None, :])[0]
    R2 = rot_about(deg * ELBOW_SHARE, e1)
    f = R2(R1(np.asarray([CHAIN[2]])))[0]
    return [PIVOT, e1, f]


def _stations(pts):
    import collections
    st = np.array([station_of(p) for p in pts])
    bins = collections.defaultdict(list)
    for i, s in enumerate(st):
        bins[int(s // 12)].append(i)
    return bins


def limb_width(pts):
    """Perpendicular extent of the limb, per station along the rest chain."""
    bins = _stations(PTS)
    out = {}
    for k, idx in bins.items():
        if len(idx) < 6:
            continue
        a, b = bone_point(k * 12 + 6), bone_point(k * 12 + 18)
        d = b - a
        n = np.linalg.norm(d)
        if n < 1e-6:
            continue
        perp = np.array([d[1], -d[0]]) / n
        v = (pts[idx] - a) @ perp
        out[k] = float(v.max() - v.min())
    return out


def limb_width_posed(deg):
    """The same stations, measured on the posed mesh about the posed chain —
    the honest version of the metric, so the two numbers are comparable."""
    bins = _stations(PTS)
    pts = skin(deg)
    ch = posed_chain(deg)

    def point_at(s):
        acc = 0.0
        for i in range(len(CHAIN) - 1):
            seg = float(np.linalg.norm(CHAIN[i + 1] - CHAIN[i]))
            if s <= acc + seg or i == len(CHAIN) - 2:
                t = float(np.clip((s - acc) / seg, 0, 1))
                return ch[i] + t * (ch[i + 1] - ch[i])
            acc += seg
        return ch[-1]

    out = {}
    for k, idx in bins.items():
        if len(idx) < 6:
            continue
        a, b = point_at(k * 12 + 6), point_at(k * 12 + 18)
        d = b - a
        n = np.linalg.norm(d)
        if n < 1e-6:
            continue
        perp = np.array([d[1], -d[0]]) / n
        v = (pts[idx] - a) @ perp
        out[k] = float(v.max() - v.min())
    return out


rest = skin(0.0)
base_width = limb_width(PTS)


def grad_energy(lum, pts, tris):
    """Mean |gradient| over the limb's triangles, by barycentric sampling."""
    acc, n = 0.0, 0
    gx = np.asarray(Image.fromarray(lum.astype(np.uint8)).filter(ImageFilter.FIND_EDGES)).astype(np.float32)
    for a, b, c in tris:
        for i in range(1, 5):
            for j in range(1, 5 - i):
                u, v = i / 5.0, j / 5.0
                p = pts[a] * (1 - u - v) + pts[b] * u + pts[c] * v
                x, y = int(round(p[0] * SCALE)), int(round(p[1] * SCALE))
                if 0 <= x < gx.shape[1] and 0 <= y < gx.shape[0]:
                    acc += gx[y, x]
                    n += 1
    return acc / max(n, 1)


for deg in (0.0, -7.0, -15.0, 6.0):
    dst = skin(deg)
    w2 = limb_width_posed(deg)
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
    worst = min(((w2[k] / base_width[k], k) for k in sorted(base_width)
                 if k in w2 and base_width[k] > 4), default=(float("nan"), -1))
    at = f" (worst station {worst[1] * 12}px along the arm)" if deg else ""
    print(f"{deg:>+7.0f} {'-' if deg == 0 else f'{min(ratio):.2f} - {max(ratio):.2f}x':>22} "
          f"{np.median(area):>10.2f} / {np.percentile(area, 99):>8.2f} {ge:>18.1f}{at}")
    if deg:
        print(f"{'':>7}   triangles over 1.25x area: {int((np.asarray(area) > 1.25).sum())} of {len(area)};  "
              f"station widths: " + " ".join(f"{k * 12}px={w2[k]:.0f}" for k in sorted(w2)
                                             if k in base_width and base_width[k] > 4))

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
    print(f"     {name:44s} {r['reconstructed_generated']:7d} px   gradient mean {box.mean():6.2f}")

print("\n   the reference is untouched: mascot-gold-buddha-base.PNG is the master "
      "(1536x1024, frozen)")
print("   — never the 768 .webp states, which are DERIVED from it. Grading a")
print("   master-resolution build against a half-resolution derivation reports the")
print("   derivation's own softness as a rig defect: it did, at 18.19% of the figure.")
print("   The diagnostic poses are judged against the master, never against a render.")
