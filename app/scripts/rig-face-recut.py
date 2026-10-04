#!/usr/bin/env python3
"""
Face patch RE-CUT under the registration law (round 57 milestone 13).

The blink peak showed a thin dark streak across the brow contour: the edit
tool redrew the contour slightly offset, and the first tight cut kept that
1-2px band. This re-cut applies the law to all four conditioned edit pieces
(14b smile, 15b blink, 16b brow, 17b mouth-cheek):

  1. SAMPLE only px whose MASTER alpha is SOLID (>0.5) - no soft-contour
     values ever enter a patch;
  2. NEVER WRITE outside the master figure silhouette (A>0.02), enforced
     twice (candidate stage + final mask);
  3. STREAK-PROOF the component cut: binary opening (erode+dilate) removes
     1-2px filaments, then connected components smaller than 30 px are
     dropped - solid feature blobs (lid, crease, cheek, brow band) survive,
     contour-shift lines do not.

Emits 14c2/15c2/16c2/17c2-tight.png next to the first cuts (kept on record),
prints per-patch before/after footprints, and asserts:
  - every written px sits on solid master alpha;
  - no written px outside the figure;
  - blink=0 identity is preserved by construction (patches only render when
    their gate > 0.004 - re-proven by rig-cycle's REST check).

    python3 app/scripts/rig-face-recut.py
"""
import os

import numpy as np
from PIL import Image, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..", "..")
P57 = os.path.join(ROOT, "docs", "evidence", "round57")
COS = os.path.join(ROOT, "app", "public", "img", "cosmetics")
W, H = 1536, 1024
OX, OY, FW, FH = 850, 60, 350, 300          # the registered face crop
SC = 3.2                                     # the edits were conditioned at 3.2x

master = Image.open(os.path.join(COS, "mascot-gold-buddha-base.png")).convert("RGBA")
M = np.asarray(master)
A_master = M[..., 3] / 255.0
crop_solid = A_master[OY:OY + FH, OX:OX + FW] > 0.5
crop_fig = A_master[OY:OY + FH, OX:OX + FW] > 0.02

JOBS = [
    ("14b-smile-edit.png", "14c-smile-tight.png", "14c2-smile-tight.png"),
    ("15b-blink-edit.png", "15c-blink-tight.png", "15c2-blink-tight.png"),
    ("16b-brow-edit.png", "16c-brow-tight.png", "16c2-brow-tight.png"),
    ("17b-mouth-cheek-edit.png", "17b-mouth-cheek-tight.png", "17c2-mouth-cheek-tight.png"),
]

for edit_name, old_name, new_name in JOBS:
    edit = np.asarray(Image.open(os.path.join(P57, "parts", edit_name)).convert("RGB")
                      .resize((FW, FH), Image.LANCZOS)).astype(np.int16)
    base = M[OY:OY + FH, OX:OX + FW, :3].astype(np.int16)
    old = np.asarray(Image.open(os.path.join(P57, "parts", old_name)).convert("RGBA"))

    diff = np.abs(edit - base).max(axis=2)
    cand = (diff > 8) & crop_solid & crop_fig          # law 1+2 at candidate stage
    opened = np.asarray(Image.fromarray((cand * 255).astype(np.uint8))
                        .filter(ImageFilter.MinFilter(3))
                        .filter(ImageFilter.MaxFilter(3))) > 128
    # connected components (8-neighborhood), keep size >= 30
    # feature-band restriction preserved from the first cut: the old tight
    # cut deliberately held ONLY the changed feature band (58-83% of each
    # edit's change), excluding shading drift elsewhere. The re-cut keeps
    # that decision but re-derives it under the law: candidates inside the
    # old band (dilated 2px), then opening + component size, so streaks and
    # filaments die while solid feature blobs survive.
    band = np.asarray(Image.fromarray(old[..., 3]).filter(
        ImageFilter.MaxFilter(5))) > 128
    opened &= band
    keep = np.zeros_like(opened)
    ys, xs = np.nonzero(opened)
    pts = set(zip(ys.tolist(), xs.tolist()))
    comps = []
    while pts:
        seed = pts.pop()
        stack = [seed]
        comp = [seed]
        while stack:
            y0, x0 = stack.pop()
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    p = (y0 + dy, x0 + dx)
                    if p in pts:
                        pts.remove(p)
                        stack.append(p)
                        comp.append(p)
        comps.append(comp)
    comps.sort(key=len, reverse=True)
    for comp in comps:
        if len(comp) >= 30:
            cy = np.array([p[0] for p in comp])
            cx = np.array([p[1] for p in comp])
            keep[cy, cx] = True
    keep &= crop_fig                                    # law 2, final

    out = np.zeros((FH, FW, 4), np.uint8)
    for c in range(3):
        out[..., c] = np.where(keep, edit[..., c], 0).astype(np.uint8)
    out[..., 3] = np.where(keep, 255, 0).astype(np.uint8)
    Image.fromarray(out).save(os.path.join(P57, "parts", new_name))

    old_fp = old[..., 3] > 8
    new_fp = keep
    # assertions: the law holds on the emitted patch
    assert not (new_fp & ~crop_fig).any(), "law 2 violated: write outside figure"
    assert not (new_fp & ~crop_solid).any(), "law 1 violated: write on soft alpha"
    # every kept px must still be a REAL change of the edit (values honest)
    assert (diff[new_fp] > 8).all(), "kept px must be changed px"
    print("%-28s old footprint %5d -> new %5d px | components kept %d/%d | dropped %d px" % (
        new_name, int(old_fp.sum()), int(new_fp.sum()),
        sum(1 for c in comps if len(c) >= 30), len(comps),
        int((opened & ~keep).sum())))

print("recut complete: law asserted on all four patches")
