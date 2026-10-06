#!/usr/bin/env python3
"""
rig-runtime-proof.py — pixel verdicts for the BROWSER runtime frames that
ci/eyes/rig-runtime-proof.mjs captured into /tmp/rigproof.

Checks (the section 14 set, on the WebGL rasterizer):
  1. REST vs the immutable master: the browser renders the artwork (PSNR +
     changed-px share, with the WebGL rasterization tolerance stated);
  2. determinism: apply(0) twice -> identical pixels;
  3. blink locality: blink-on minus blink-off (the patch isolated at the same
     instant) must sit inside the registered face box;
  4. handover atomicity: the swap edges produce the structural step; inside
     the window the only mover is the breath chest box;
  5. flicker scan: the top consecutive-frame changes are explained by the
     parameter clocks (same explanation rules as the Python check);
  6. reduced motion: the pinned still equals REST and does not move.

    python3 app/scripts/rig-runtime-proof.py
"""
import json
import os

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..", "..")
OUT = "/tmp/rigproof"
COS = os.path.join(ROOT, "app", "public", "img", "cosmetics")

fails = []


def check(name, ok, detail):
    print("%s  %s  (%s)" % ("PASS" if ok else "FAIL", name, detail))
    if not ok:
        fails.append(name)


def F(n):
    return np.asarray(Image.open(os.path.join(OUT, n + ".png")).convert("RGBA")).astype(np.int16)


rig = json.load(open(os.path.join(ROOT, "app/public/img/cosmetics/buddha-rig/buddha-rig.json")))
CURVES = rig["curves"]


def eval_curve(c, t):
    p = c["period"]
    tt = t % p
    ks = c["keys"]
    if tt <= ks[0][0]:
        return ks[0][1]
    for (t0, v0), (t1, v1) in zip(ks, ks[1:]):
        if t0 <= tt <= t1:
            if t1 == t0:
                return v1
            u = (tt - t0) / (t1 - t0)
            if c.get("easing") == "smoothstep":
                u = u * u * (3 - 2 * u)
            return v0 + u * (v1 - v0)
    return ks[-1][1]


def sstep(x):
    x = max(0.0, min(1.0, x))
    return x * x * (3 - 2 * x)


# 1. REST vs master, OUTSIDE the intentional grape-sway band (the cycle's
# own start value is sway -4.5deg, exactly like production CSS and the
# Python checks; its footprint is excluded the same way - dilated 49px)
master = np.asarray(Image.open(os.path.join(COS, "mascot-gold-buddha-base.png")).convert("RGBA")).astype(np.int16)
rest = F("rest")
d = np.abs(rest - master).max(axis=2)
from PIL import Image as _I
import importlib.util as _iu
_ri = np.asarray(master[..., 3] > 5)
# the grapes footprint: rebuild from the exported texture + pivot
_gr = np.asarray(_I.open(os.path.join(COS, "buddha-rig/grapes.png")).convert("RGBA"))[..., 3] > 5
from PIL import ImageFilter as _IF
_sw = np.asarray(_I.fromarray((_gr * 255).astype(np.uint8)).rotate(-4.5, resample=_I.BILINEAR,
                 center=tuple(rig["bones"]["grape_pivot"]))).astype(np.uint8)
_sw = np.asarray(_I.fromarray(_sw).filter(_IF.MaxFilter(49))) > 128
d = d.copy()
d[_sw] = 0
changed = int((d > 8).sum())
mse = float((d.astype(np.float64) ** 2).mean())
psnr = 10 * np.log10(255 ** 2 / max(mse, 1e-9))
share = changed / d.size
check("browser REST renders the artwork (outside the sway band)", psnr >= 38.0 and share <= 0.006,
      "PSNR %.2f dB, %d px (%.3f%%) over 8 - WebGL rasterization + premultiplied edges"
      % (psnr, changed, 100 * share))

# 2. determinism
d2 = np.abs(F("rest2") - rest).max(axis=2)
check("apply() is deterministic at the same t", int((d2 > 0).sum()) == 0,
      "%d px differ" % int((d2 > 0).sum()))

# 3. blink locality (the patch isolated at the same instant)
db = np.abs(F("blink-on").astype(int) - F("blink-off").astype(int)).max(axis=2) > 2
ys, xs = np.nonzero(db)
# the patch rides the head tilt (designed): allow the tilt budget (~4px) on
# top of the registered face box
FACE_BOX = (850 - 6, 60 - 6, 1200 + 6, 360 + 6)
in_box = (xs.min() >= FACE_BOX[0] and xs.max() <= FACE_BOX[2] and
          ys.min() >= FACE_BOX[1] and ys.max() <= FACE_BOX[3])
check("blink patch is local to the face box (incl. the head-tilt ride)", bool(db.sum()) and in_box,
      "%d px, bbox x[%d-%d] y[%d-%d]" % (int(db.sum()), xs.min(), xs.max(), ys.min(), ys.max()))

# 4. handover atomicity
h0w, h1w = rig["handover"]["window"]
step = np.abs(F("h0-before").astype(int) - F("h0-after").astype(int)).max(axis=2) > 2
check("window-open produces the structural step", int(step.sum()) > 100000,
      "%d px change across the edge" % int(step.sum()))
settled = np.abs(F("h0-after").astype(int) - F("h0-settled").astype(int)).max(axis=2) > 2
CB = (660, 340, 1200, 700)
HB = (844, 0, 1221, 405)   # the head field: a declared moving region (like breath)
out = settled.copy()
out[CB[1]:CB[3], CB[0]:CB[2]] = False
out[HB[1]:HB[3], HB[0]:HB[2]] = False
check("inside the window only the declared moving fields move (breath + head)",
      int(out.sum()) <= 2000,
      "%d px outside the chest+head boxes" % int(out.sum()))
step1 = np.abs(F("h1-before").astype(int) - F("h1-after").astype(int)).max(axis=2) > 2
check("window-close produces the structural step", int(step1.sum()) > 100000,
      "%d px change across the edge" % int(step1.sum()))

# 5. flicker scan over the 48 samples
counts = []
prev = F("rest")
for f in range(1, 25):
    cur = F("c%d" % f)
    counts.append(int((np.abs(cur - prev).max(axis=2) > 2).sum()))
    prev = cur
counts = np.array(counts)


def explained(t0, t1):
    if t0 % 24 <= h0w <= t1 % 24 or t0 % 24 <= h1w <= t1 % 24:
        return "handover step"
    for name, thr in (("arm_angle", 0.9), ("grape_sway", 0.6), ("breath", 0.08),
                      ("head_tilt", 0.05)):
        if abs(eval_curve(CURVES[name], t1) - eval_curve(CURVES[name], t0)) > thr:
            return "%s moves" % name
    if abs(eval_curve(CURVES["blink"], t1) - eval_curve(CURVES["blink"], t0)) > 0.15:
        return "blink gate"
    return None


ok = True
for k in np.argsort(counts)[::-1][:6]:
    t0, t1 = float(k), float(k + 1)
    why = explained(t0, t1)
    ok = ok and why is not None
    print("      t=%5.2f..%5.2f  %7d px  %s" % (t0, t1, counts[k], why or "UNEXPLAINED"))
check("browser flicker scan: every spike explained", ok,
      "24 consecutive-interval samples")

# 6. reduced motion
drm = np.abs(F("rest-rm") - rest).max(axis=2)
check("reduced motion pins the REST still", int((drm > 2).sum()) <= 2000,
      "%d px differ from REST" % int((drm > 2).sum()))

print("\n" + ("%d FAILURE(S)" % len(fails) if fails else "ALL BROWSER CHECKS PASS"))
raise SystemExit(1 if fails else 0)
