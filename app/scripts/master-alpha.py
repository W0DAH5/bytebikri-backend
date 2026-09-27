#!/usr/bin/env python3
"""
Can the 1536x1024 master be separated as cleanly as the 768 artwork already is?

WHY THIS FILE EXISTS. The scene was cut from the 768x512 states because those
are what carry ALPHA — a silhouette the artwork itself drew. The 1536x1024
master is twice the resolution and visibly sharper (coin engravings and rims are
real detail there and mush at 768), which is what the brief's resolution clause
asks for. But the master is flattened on an opaque near-white stage: `alpha` is
255 everywhere. Using it means RECOVERING the silhouette, and a recovered
silhouette is a guess unless it is checked against something known.

There is something known: the 768 state's alpha — the artwork's own, exact, the
silhouette every measurement in `scene-parts.py` is built on. So this file
derives alpha for the master and then DOWNSAMPLES it to 768 and compares it with
the alpha the artwork already has. That is a real test rather than an opinion:
if the recovered edge agrees with the drawn edge, the recovery is sound and the
master can carry the scene; if it disagrees, the master cannot be separated
cleanly and the 768 artwork stands — which is a finding either way.

    python3 app/scripts/master-alpha.py

Development-time only. Needs PIL + numpy.
"""
import os
import sys
from collections import deque

import numpy as np
from PIL import Image, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
DIR = os.path.join(HERE, "..", "public", "img", "cosmetics")
MASTER = os.path.join(DIR, "mascot-gold-buddha-base.png")
STATE = os.path.join(DIR, "mascot-gold-buddha-base.webp")

master = Image.open(MASTER).convert("RGB")
state = Image.open(STATE).convert("RGBA")
MW, MH = master.size            # 1536x1024
SW, SH = state.size             # 768x512
print(f"master {MW}x{MH}   state {SW}x{SH}")

rgb = np.asarray(master).astype(np.float32)
known = np.asarray(state.getchannel("A")).astype(np.float32) / 255.0

# ── 1. where is the background ──────────────────────────────────────────────
# The stage is a near-white field, brightest at the corners and shading a little
# toward the subject. Two signals, because either alone fails the way the repo's
# tile-keying already documented: distance-to-reference climbs the smooth glow
# into the figure, and a border-grown region alone walks in through any soft
# shadow the figure casts.
corner = rgb[[2, 2, MH - 3, MH - 3], [2, MW - 3, 2, MW - 3]].mean(axis=0)
print(f"stage colour from the corners: {corner.round(1)}")
dist = np.abs(rgb - corner).max(axis=2)

# A high-confidence background: very close to the stage, or very bright (the
# stage is the brightest thing in the frame; gold is not).
bright = rgb.min(axis=2) > 225
close = dist < 22
seed = (bright | close)
# Grow only through near-stage pixels, so the figure's own soft edge stops it.
free = dist < 46
reach = np.zeros((MH, MW), bool)
q = deque()
for x in range(MW):
    for y in (0, MH - 1):
        if free[y, x] and not reach[y, x]:
            reach[y, x] = True
            q.append((y, x))
for y in range(MH):
    for x in (0, MW - 1):
        if free[y, x] and not reach[y, x]:
            reach[y, x] = True
            q.append((y, x))
while q:
    y, x = q.popleft()
    for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        ny, nx = y + dy, x + dx
        if 0 <= ny < MH and 0 <= nx < MW and free[ny, nx] and not reach[ny, nx]:
            reach[ny, nx] = True
            q.append((ny, nx))
background = reach & seed
print(f"background reach {100.0 * reach.mean():.1f}%   of which seed-confirmed "
      f"{100.0 * (background & reach).sum() / max(1, reach.sum()):.1f}%")

# ── 2. the edge: recover PARTIAL alpha rather than a hard cut ───────────────
# Away from the edge alpha is 0 or 1. At the edge the pixel is a blend of figure
# and stage, and the honest estimate is a matte: with the stage colour W known
# and the figure's colour C estimated from the nearest opaque neighbour, the
# coverage is (O - W)/(C - W) per channel. A hard 0/1 edge instead would be a
# visible stair-step at the silhouette, which is the "fuzzy cutout edge" the
# brief lists as unacceptable — in reverse.
#
# C is taken by pushing the figure's own colours outward a few pixels (a blur of
# the opaque region, divided by its own blurred alpha, which is the standard
# un-premultiply), then the matte is solved per channel and averaged.
opaque_solid = np.zeros((MH, MW), np.float32)
interior = ~background
# Feather the interior inwards so the estimate starts from solid figure colour.
solid = Image.fromarray((interior * 255).astype(np.uint8)).filter(ImageFilter.MinFilter(5))
al = (np.asarray(solid).astype(np.float32) / 255.0)[:, :, None]
blur_a = np.asarray(solid.filter(ImageFilter.GaussianBlur(6))).astype(np.float32)[:, :, None] / 255.0
blur_c = np.asarray(master.filter(ImageFilter.GaussianBlur(6))).astype(np.float32)
near = np.clip(blur_c / np.clip(blur_a, 1e-3, 1), 0, 255)

edge_zone = interior & ~(np.asarray(solid) > 128)
num = rgb - corner
den = near - corner
per_ch = np.where(np.abs(den) > 12, num / np.where(np.abs(den) > 12, den, 1), np.nan)
alpha_edge = np.nanmean(per_ch, axis=2)
alpha_edge = np.clip(np.nan_to_num(alpha_edge, nan=1.0), 0, 1)

alpha = np.where(interior, 1.0, 0.0)
alpha[edge_zone] = alpha_edge[edge_zone]
# A light median pass removes solitary speckles without moving the silhouette.
alpha_img = Image.fromarray((alpha * 255).round().astype(np.uint8)).filter(ImageFilter.MedianFilter(3))
alpha = np.asarray(alpha_img).astype(np.float32) / 255.0

# ── 3. THE TEST: does the recovered edge match the drawn one? ───────────────
# Two measures, because they fail for different reasons and the first version of
# this file conflated them.
#
#   SHAPE — is the outline in the same place? Binarise both and ask. This is the
#     measure that decides whether the master can carry the scene at all: if the
#     silhouettes disagree the recovery is wrong, full stop.
#   EDGE — do the PARTIAL alphas in the antialiased band agree? This is a matte
#     estimate against a drawn value, and it is expected to be softer: at the
#     edge the pixel is a blend of figure and stage, and the coverage is being
#     solved rather than read. A disagreement here is a slightly softer edge,
#     not a moved one.
rec = Image.fromarray((alpha * 255).round().astype(np.uint8)).resize((SW, SH), Image.BOX)
rec_a = np.asarray(rec).astype(np.float32) / 255.0
k = known
diff = np.abs(rec_a - k)

edge = (k > 0.03) & (k < 0.97)
inside = k >= 0.97
outside = k <= 0.03
print("\nrecovered alpha, downsampled to 768, against the artwork's own:")
for label, sel in (("the silhouette edge", edge), ("inside the figure", inside), ("outside it", outside)):
    if sel.sum():
        d = diff[sel]
        print(f"  {label:22s} n={int(sel.sum()):7d}  mean {d.mean():.4f}  "
              f"p99 {np.percentile(d, 99):.3f}  max {d.max():.3f}  over 0.10: {int((d > 0.10).sum())}")

# SHAPE. Two silhouettes, and how far apart their contours run.
rec_bin = rec_a > 0.5
own_bin = k > 0.5
iou = (rec_bin & own_bin).sum() / max(1, (rec_bin | own_bin).sum())


def contour(mask):
    inner = Image.fromarray((mask * 255).astype(np.uint8)).filter(ImageFilter.MinFilter(3))
    return mask & ~(np.asarray(inner) > 0)


ya, xa = np.where(contour(own_bin))
yb, xb = np.where(contour(rec_bin))
if len(ya) and len(yb):
    import random
    pick = random.Random(0).sample(range(len(ya)), min(500, len(ya)))
    dists = [float(np.sqrt((yb - ya[i]) ** 2 + (xb - xa[i]) ** 2).min()) for i in pick]
    med, p90, mean = float(np.median(dists)), float(np.percentile(dists, 90)), float(np.mean(dists))
else:
    med = p90 = mean = float("nan")

print(f"\n  SHAPE — silhouette overlap (IoU): {iou:.4f}")
print(f"          contour distance, drawn edge to recovered edge: "
      f"median {med:.1f}px  p90 {p90:.1f}px  mean {mean:.2f}px   (at 768)")
print(f"          the scene displays at 172px, so one artwork pixel is "
      f"{172 / SW:.2f} display px: the outlines agree to about {mean * 172 / SW:.2f} display px")

bad_edge = int((diff[edge] > 0.10).sum()) if edge.sum() else 0
print(f"  EDGE  — antialiased-band coverage differs on {bad_edge} of {int(edge.sum())} "
      f"({100.0 * bad_edge / max(1, int(edge.sum())):.0f}%) — the band is ~2px at 768 "
      f"({2 * 172 / SW:.2f} display px)")

verdict = iou >= 0.97
print("\n  verdict: " + (
    "the master's SILHOUETTE is recoverable — the outlines agree to a fraction of a "
    "display pixel. Its antialiased EDGE is an estimate, so a scene rebuilt from the "
    "master would trade an exact silhouette for twice the resolution."
    if verdict else
    "THE RECOVERED SHAPE DOES NOT MATCH THE DRAWING — the 768 artwork stands"))

if "--write" in sys.argv and verdict:
    out = os.path.join(DIR, "master-alpha.png")
    Image.fromarray((alpha * 255).round().astype(np.uint8)).save(out)
    print(f"  wrote {os.path.relpath(out)}")
