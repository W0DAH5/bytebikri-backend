#!/usr/bin/env python3
"""
Rig EXPORTER — CHARACTER_ANIMATION.md §10 step 3 ("scene-parts.py").

Re-derives every mask, mesh and registration with the exact recipes the
round-57 proofs used (rig-parts-eval.py PROOF 1 bit-equality, rig-cycle.py
PROOF 4), copies the part textures, and emits the runtime package:

    app/public/img/cosmetics/buddha-rig/buddha-rig.json
    app/public/img/cosmetics/buddha-rig/*.png

The JSON is the single source of truth for the browser runtime (js/buddha-rig.js):
curves, bones, arm mesh (rest/uvs/triangles/weights), breath mesh, patch
registrations, draw rules, handover window, plus a PARITY block of expected
curve values that ci asserts the JS evaluator against (app/scripts/rig-runtime-parity.mjs).

Nothing here is wired into the production page - awaiting explicit authorization.

    python3 app/scripts/rig-export.py
"""
import json
import os
import shutil

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..", "..")
P57 = os.path.join(ROOT, "docs", "evidence", "round57")
COS = os.path.join(ROOT, "app", "public", "img", "cosmetics")
OUT = os.path.join(COS, "buddha-rig")
W, H = 1536, 1024
CARD = (23, 18, 12)

os.makedirs(OUT, exist_ok=True)

master = Image.open(os.path.join(COS, "mascot-gold-buddha-base.png")).convert("RGBA")
Mr = np.asarray(master).astype(np.float32)
A_master = Mr[..., 3] / 255.0


def up2(a7):
    return np.asarray(Image.fromarray((a7 * 255).astype(np.uint8)).resize(
        (W, H), Image.BILINEAR)).astype(np.float32) / 255.0


arm7 = np.asarray(Image.open(os.path.join(ROOT, "RECONSTRUCTION/layers/arm/arm.png")).convert("RGBA"))[..., 3].astype(np.float32) / 255
gra7 = np.asarray(Image.open(os.path.join(ROOT, "RECONSTRUCTION/layers/grapes/grapes.png")).convert("RGBA"))[..., 3].astype(np.float32) / 255
A_arm, A_gra = up2(arm7), up2(gra7)
ARM = (A_arm > 0.02) & (A_gra <= 0.02)
GRA = A_gra > 0.02
STRAND = np.asarray(Image.open(os.path.join(P57, "parts", "08-necklace-master-strand.png")).convert("RGBA"))[..., 3] > 8
STRAND &= A_master > 0.02
TOR = (A_master > 0.02) & ~ARM & ~GRA & ~STRAND


def cut(mask):
    out = np.zeros((H, W, 4), np.uint8)
    for c in range(3):
        out[..., c] = np.where(mask, Mr[..., c], 0).astype(np.uint8)
    out[..., 3] = np.where(mask, Mr[..., 3], 0).astype(np.uint8)
    return out


# ── textures ─────────────────────────────────────────────────────────────────
Image.fromarray(cut(TOR)).save(os.path.join(OUT, "torso.png"))
Image.fromarray(cut(STRAND)).save(os.path.join(OUT, "strand.png"))
shutil.copyfile(os.path.join(P57, "parts", "02-arm-full.png"), os.path.join(OUT, "arm.png"))
shutil.copyfile(os.path.join(P57, "parts", "07-grapes-master.png"), os.path.join(OUT, "grapes.png"))

# the plate's ONE admission (milestone-9 ruling): continue the body across
# BOUNDARIES only - the torso cut band + the arm footprint's inner sliver band
# - with saturated gold; the deep hole is former sky and shows the card.
plate_tex = Image.open(os.path.join(P57, "parts", "01-torso-clean-plate.png")).convert("RGB").resize((W, H), Image.LANCZOS)
AG = ARM | GRA
_ag_in = np.asarray(Image.fromarray((AG * 255).astype(np.uint8)).filter(ImageFilter.MinFilter(101))) > 128
_slivers = AG & ~_ag_in
_tor_dil = np.asarray(Image.fromarray((TOR * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(51))) > 128
_cutband = _tor_dil & ~TOR & AG & (A_master > 0.02)
_pm = np.asarray(plate_tex)
_gold = (_pm[..., 0].astype(np.int32) - _pm[..., 2] > 55) & \
        (_pm[..., 0].astype(np.int32) - _pm[..., 1] > 15) & (_pm[..., 0] > 120)
_rim = (_slivers | _cutband) & _gold & (A_master > 0.02)
_pa = np.zeros((H, W, 4), np.uint8)
for c in range(3):
    _pa[..., c] = np.where(_rim, _pm[..., c], 0).astype(np.uint8)
_pa[..., 3] = np.where(_rim, 255, 0).astype(np.uint8)
Image.fromarray(_pa).save(os.path.join(OUT, "plate-backing.png"))

# the accepted drawn-behind lowered pose (768 webp, nearest 2x as proven)
lowered7 = Image.open(os.path.join(COS, "part-arm-lowered.webp")).convert("RGBA")
lowered = Image.fromarray(np.asarray(lowered7).repeat(2, 0).repeat(2, 1)[:, :W, :])
lowered.save(os.path.join(OUT, "lowered.png"))

# ── bones / geometry constants (verbatim from the proofs) ────────────────────
SH = (536.0, 292.0)
ELBOW_T, WRIST_T = 0.54, 0.80
FIST = (744.0, 76.0)
ELBOW = (536.0 + ELBOW_T * 208.0, 292.0 - ELBOW_T * 216.0)
WRIST = (536.0 + WRIST_T * 208.0, 292.0 - WRIST_T * 216.0)
GRAPE_PIVOT = (754.0, 56.0)

a = np.asarray(Image.open(os.path.join(OUT, "arm.png")).convert("RGBA"))
ys, xs = np.nonzero(a[..., 3] > 8)
bbox = (int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1)

NX, NY = 26, 12
x0, y0, x1, y1 = bbox
gxs = np.round(np.linspace(x0, x1, NX)).astype(np.float64)
gys = np.round(np.linspace(y0, y1, NY)).astype(np.float64)
GX, GY = np.meshgrid(gxs, gys)
REST = np.stack([GX.ravel(), GY.ravel()], axis=1)
dx, dy = FIST[0] - SH[0], FIST[1] - SH[1]
L2 = dx * dx + dy * dy
T = ((REST[:, 0] - SH[0]) * dx + (REST[:, 1] - SH[1]) * dy) / L2
blend = 0.09
w_fore = np.clip((T - (ELBOW_T - blend)) / (2 * blend), 0, 1)

tris = []
for j in range(NY - 1):
    for i in range(NX - 1):
        n0 = j * NX + i
        tris += [n0, n0 + 1, n0 + NX, n0 + 1, n0 + NX + 1, n0 + NX]
uvs = (REST / np.array([float(W), float(H)]))  # full-canvas textures

# ── breath mesh (chest band; identity at rest, tapered at the border) ───────
_p = Image.new("L", (W, H), 0)
ImageDraw.Draw(_p).polygon([(700, 380), (900, 360), (1080, 390), (1180, 470),
                            (1160, 600), (980, 680), (800, 660), (680, 540)], fill=255)
CHEST = np.asarray(_p) > 128
cy0, cy1 = np.nonzero(CHEST)[0].min(), np.nonzero(CHEST)[0].max()
cy_c = 0.5 * (cy0 + cy1)
bx0, by0, bx1, by1 = 660, 340, 1200, 700
BNX, BNY = 20, 14
bxs = np.round(np.linspace(bx0, bx1, BNX)).astype(np.float64)
bys = np.round(np.linspace(by0, by1, BNY)).astype(np.float64)
BGX, BGY = np.meshgrid(bxs, bys)
BREST = np.stack([BGX.ravel(), BGY.ravel()], axis=1)
# chest-membership tested directly on the mask (no point-in-poly lib needed)
inside = CHEST[np.clip(BREST[:, 1].astype(int), 0, H - 1), np.clip(BREST[:, 0].astype(int), 0, W - 1)]
wprof = np.clip(1.0 - np.abs(BREST[:, 1] - cy_c) / (0.5 * (cy1 - cy0)), 0, 1)
border = ((BREST[:, 0] <= bx0) | (BREST[:, 0] >= bx1) | (BREST[:, 1] <= by0) | (BREST[:, 1] >= by1))
bw = (inside & ~border).astype(np.float64) * wprof      # zero on the mesh border: no seam vs the static torso
btris = []
for j in range(BNY - 1):
    for i in range(BNX - 1):
        n0 = j * BNX + i
        btris += [n0, n0 + 1, n0 + BNX, n0 + 1, n0 + BNX + 1, n0 + BNX]
buvs = BREST / np.array([float(W), float(H)])

# ── patch registrations (pre-placed full-canvas overlays) ────────────────────
_fig_dil = np.asarray(Image.fromarray(
    ((A_master > 0.02) * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(13))) > 128


def place(name, origin, size):
    p = Image.open(os.path.join(P57, "parts", name)).convert("RGBA")
    arr = np.asarray(p)
    ox, oy = int(origin[0]), int(origin[1])
    keep = (arr[..., 3] > 8) & _fig_dil[oy:oy + size[1], ox:ox + size[0]]
    canvas = np.zeros((H, W, 4), np.uint8)
    reg = canvas[oy:oy + size[1], ox:ox + size[0]]
    for c in range(3):
        reg[..., c] = np.where(keep, arr[..., c], 0).astype(np.uint8)
    reg[..., 3] = np.where(keep, 255, 0).astype(np.uint8)
    canvas[oy:oy + size[1], ox:ox + size[0]] = reg
    return canvas


FACE_ORIGIN, FACE_SIZE = (850, 60), (350, 300)
SHOULDER_ORIGIN, SHOULDER_SIZE = (420, 160), (360, 340)
patches = {
    "face-blink": place("15c-blink-tight.png", FACE_ORIGIN, FACE_SIZE),
    "face-smile": place("14c-smile-tight.png", FACE_ORIGIN, FACE_SIZE),
    "face-brow": place("16c-brow-tight.png", FACE_ORIGIN, FACE_SIZE),
    "face-mouth": place("17b-mouth-cheek-tight.png", FACE_ORIGIN, FACE_SIZE),
    "kf-m15": place("09d-keyform-minus15-tight.png", SHOULDER_ORIGIN, SHOULDER_SIZE),
    "kf-m7": place("09e-keyform-minus7-tight.png", SHOULDER_ORIGIN, SHOULDER_SIZE),
    "kf-p6": place("09f-keyform-plus6-tight.png", SHOULDER_ORIGIN, SHOULDER_SIZE),
}
for name, arr in patches.items():
    Image.fromarray(arr).save(os.path.join(OUT, name + ".png"))

# ── curves (the production CSS clocks, translated) ───────────────────────────
CURVES = {
    "arm_angle": {"period": 24.0, "keys": [[0, 0], [2.0, 6], [4.5, 5.4], [6.5, 0],
                                           [11.5, -2.4], [15.0, -15], [18.0, -15],
                                           [21.5, -2], [24, 0]], "easing": "smoothstep"},
    "grape_sway": {"period": 9.5, "keys": [[0, -4.5], [3.23, 4], [4.845, 1.5],
                                           [6.365, 5], [7.885, -1.5], [9.5, -4.5]],
                   "easing": "smoothstep"},
    "breath": {"period": 5.6, "keys": [[0, 0], [1.68, 1], [3.248, 1], [4.704, 0], [5.6, 0]],
               "easing": "smoothstep"},
    "blink": {"period": 9.7, "keys": [[0, 0], [8.439, 0], [8.633, 1], [8.924, 1],
                                      [9.118, 0], [9.7, 0]], "easing": "linear"},
}


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


def lbss(deg):
    th1 = np.radians(deg)
    c1, s1 = np.cos(th1), np.sin(th1)
    upper = SH + (REST - SH) @ np.array([[c1, s1], [-s1, c1]]).T
    elb = SH + (np.array(ELBOW) - SH) @ np.array([[c1, s1], [-s1, c1]]).T
    th2 = np.radians(deg * 0.35)
    c2, s2 = np.cos(th2), np.sin(th2)
    fore = elb + (REST - np.array(ELBOW)) @ np.array([[c2, s2], [-s2, c2]]).T
    W_up = (1.0 - w_fore)[:, None]
    W_fo = w_fore[:, None]
    out = W_up * upper + W_fo * fore
    k = np.interp(deg, [-15.0, -7.0, 0.0, 6.0], [1.0, 0.5, 0.0, -0.35])
    near = np.clip(1.0 - np.abs(T - 0.25) / 0.45, 0, 1)[:, None]
    return out + k * 0.035 * near * (np.array(SH)[None, :] - out)


# REST identity assertion (the proof invariant, at solver precision; the
# bit-level claim is owned by the Python warp sampler's epsilon+floor, proven
# in rig-parts-eval.py PROOF 1)
_m0 = lbss(0.0)
assert np.allclose(_m0, REST, atol=1e-9), "LBS(0) must be the identity on the rest grid"

probes = [0.0, 1.0, 2.0, 4.5, 6.5, 8.633, 11.5, 14.5, 15.0, 16.5, 18.24, 21.5, 23.9]
parity = {"t": probes,
          "arm_angle": [eval_curve(CURVES["arm_angle"], t) for t in probes],
          "grape_sway": [eval_curve(CURVES["grape_sway"], t) for t in probes],
          "breath": [eval_curve(CURVES["breath"], t) for t in probes],
          "blink": [eval_curve(CURVES["blink"], t) for t in probes]}

rig = {
    "meta": {
        "name": "golden-buddha parts rig (round 57)",
        "spec": "CHARACTER_ANIMATION.md sections 4, 7, 10",
        "authoring": "app/scripts/rig-export.py - regenerated whenever the artwork changes",
        "proofs": {"REST": "bit-equal 0/82,442 px (rig-parts-eval.py PROOF 1, docs evidence)",
                   "necklace_order": "0 px contact across full angle sweep (rig-cycle.py PROOF 4)",
                   "handover": "bare cut 23,258 see-through px at -15 deg -> 0 over plate+lowered"},
        "production": "NOT wired into the app - preview harness only, awaiting explicit authorization"},
    "canvas": {"w": W, "h": H, "card": list(CARD)},
    "textures": {n: f"img/cosmetics/buddha-rig/{n}.png" for n in
                 ("torso", "strand", "arm", "grapes", "plate-backing", "lowered",
                  "face-blink", "face-smile", "face-brow", "face-mouth",
                  "kf-m15", "kf-m7", "kf-p6")},
    "bones": {"shoulder": list(SH), "elbow": [round(ELBOW[0], 1), round(ELBOW[1], 1)],
              "wrist": [round(WRIST[0], 1), round(WRIST[1], 1)], "fist": list(FIST),
              "elbow_t": ELBOW_T, "wrist_t": WRIST_T, "grape_pivot": list(GRAPE_PIVOT)},
    "arm_mesh": {"nx": NX, "ny": NY, "rest": REST.ravel().astype(int).tolist(),
                 "uv": [[round(float(u), 6), round(float(v), 6)] for u, v in uvs],
                 "triangles": tris, "w_fore": [round(float(x), 6) for x in w_fore],
                 "blend": blend, "forearm_gain": 0.35,
                 "keyform": {"table": [[-15.0, 1.0], [-7.0, 0.5], [0.0, 0.0], [6.0, -0.35]],
                             "band_center": 0.25, "band_halfwidth": 0.45, "gain": 0.035}},
    "breath_mesh": {"nx": BNX, "ny": BNY, "bbox": [bx0, by0, bx1, by1],
                    "rest": BREST.ravel().astype(int).tolist(),
                    "uv": [[round(float(u), 6), round(float(v), 6)] for u, v in buvs],
                    "triangles": btris, "weights": [round(float(x), 6) for x in bw],
                    "rise": 7.0, "bulge": 2.2, "bulge_cx": 880.0, "bulge_xscale": 260.0,
                    "profile_center": round(cy_c, 1), "profile_half": round(0.5 * (cy1 - cy0), 1)},
    "draw_order": ["plate-backing", "torso", "breath-mesh", "strand",
                   "lowered|arm+grapes (stepped handover)", "patches(masked to live figure)"],
    "handover": {"window": [14.50, 18.24],
                 "note": "arm+grapes step out; the accepted drawn-behind lowered pose shows"},
    "patch_fades": {
        "face-blink": {"gate": "blink curve"},
        "face-smile": {"gate": "sstep((arm_angle-3)/3)"},
        "face-mouth": {"gate": "same as smile (laugh accent)"},
        "face-brow": {"gate": "sstep((-arm_angle-10)/4)"},
        "kf-p6": {"gate": "smile gate", "rot_about": "shoulder", "rot": "arm_angle"},
        "kf-m7": {"gate": "sstep((-arm_angle-1.5)/3)*(1-deep)", "rot_about": "shoulder", "rot": "arm_angle"},
        "kf-m15": {"gate": "sstep((-arm_angle-10)/4)", "rot_about": "shoulder", "rot": "arm_angle"},
        "clip": "every patch alpha is multiplied by the LIVE composed figure (render-texture mask); registration clip to the master figure is baked into the PNGs"},
    "curves": CURVES,
    "parity": parity,
}
with open(os.path.join(OUT, "buddha-rig.json"), "w") as f:
    json.dump(rig, f, indent=1)

print("exported %d textures + buddha-rig.json" % len(rig["textures"]))
print("arm mesh: %d verts / %d tris; breath mesh: %d verts / %d tris" %
      (len(REST), len(tris) // 3, len(BREST), len(btris) // 3))
print("REST identity asserted at export")
