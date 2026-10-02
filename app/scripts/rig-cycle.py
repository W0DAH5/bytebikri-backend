#!/usr/bin/env python3
"""
THE LIVING CYCLE — the parts rig driven by the production clocks, round 57.

The rig's parameter curves are the EXISTING CSS keyframes, translated:
  arm_angle:  24s, 0 -> +6 @2.0s -> +5.4 @4.5s -> 0 @6.5s -> -2.4 @11.5s
              -> -15 @15s (hold to 18s) -> -2 @21.5s -> 0 @24s
              (the CSS cubic-bezier approximated by smoothstep per segment)
  handover:   60.4%..76% of the cycle (14.50s..18.24s): arm+grapes step out,
              the window shows the clean plate + the lowered pose
  grape_sway: 9.5s, -4.5 -> +4 @34% -> +1.5 @51% -> +5 @67% -> -1.5 @83% -> -4.5
  breath:     5.6s, 0 -> 1 @30% -> 1 @58% -> 0 @84% (drives a TORSO WARP here,
              not an art swap: the master-extracted torso texture deforms,
              so breath introduces zero style drift)
  blink:      9.7s, closed 89%..94% (face patches pending registration; the
              strip renders the body cycle)

Output: docs/evidence/round57/rig/cycle-strip.png — 48 frames at 2 fps, the
first full cycle rendered from rig data with mesh deformation (no CSS
rotation anywhere in this path), plus the rig JSON gaining its curves and
the wrist bone.

    python3 app/scripts/rig-cycle.py
"""
import json
import os

import numpy as np
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..", "..")
P57 = os.path.join(ROOT, "docs", "evidence", "round57")
COS = os.path.join(ROOT, "app", "public", "img", "cosmetics")
W, H = 1536, 1024
CARD = (23, 18, 12, 255)

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
# necklace: the master-value strand extraction is a fourth owner region
STRAND = np.asarray(Image.open(os.path.join(P57, "parts", "08-necklace-master-strand.png")).convert("RGBA"))[..., 3] > 8
STRAND &= A_master > 0.02
TOR = (A_master > 0.02) & ~ARM & ~GRA & ~STRAND


def cut(mask, name):
    out = np.zeros((H, W, 4), np.uint8)
    for c in range(3):
        out[..., c] = np.where(mask, Mr[..., c], 0).astype(np.uint8)
    out[..., 3] = np.where(mask, Mr[..., 3], 0).astype(np.uint8)
    return Image.fromarray(out)


torso_tex = cut(TOR, "t")
strand_tex = cut(STRAND, "n")   # master's own strand px; drawn between torso and arm
arm_tex = Image.open(os.path.join(P57, "parts", "02-arm-full.png")).convert("RGBA")
grapes_tex = Image.open(os.path.join(P57, "parts", "07-grapes-master.png")).convert("RGBA")
plate_tex = Image.open(os.path.join(P57, "parts", "01-torso-clean-plate.png")).convert("RGB").resize((W, H), Image.LANCZOS)
lowered7 = Image.open(os.path.join(COS, "part-arm-lowered.webp")).convert("RGBA")
lowered = Image.fromarray(np.asarray(lowered7).repeat(2, 0).repeat(2, 1)[:, :W, :])  # nearest 2x, cross-gen softness documented

plate_backing = Image.new("RGBA", (W, H), (0, 0, 0, 0))
# The plate's ONE purpose (the Clip Studio "draw in the background behind
# them" pass): backing the ARM+GRAPES footprint with plausible painted body,
# so small rotations reveal continuation instead of holes, and the stepped
# handover reveals an inpainted torso. Rulings: only the figure's INTERIOR
# (a ~12px band at the outer contour is sky-truth -> card, same boundary the
# production swap exposes), and only the plate's GOLD paint — the generator
# baked literal checkerboard squares / pale studio background into parts of
# the hole; those are not artwork and fall to the card (sky ruling).
from PIL import ImageFilter as _IF
_interior = np.asarray(Image.fromarray(
    ((A_master > 0.02) * 255).astype(np.uint8)).filter(_IF.MinFilter(25))) > 128
_hole = (ARM | GRA) & (A_master > 0.02) & _interior
_pm = np.asarray(plate_tex)
_gold = (_pm[..., 0].astype(np.int32) - _pm[..., 2].astype(np.int32) > 30) & (_pm[..., 0] > 110)
_rim = _hole & _gold
_pa = np.zeros((H, W, 4), np.uint8)
for c in range(3):
    _pa[..., c] = np.where(_rim, _pm[..., c], 0).astype(np.uint8)
_pa[..., 3] = np.where(_rim, 255, 0).astype(np.uint8)
plate_backing.paste(Image.fromarray(_pa), (0, 0))

SH = (536.0, 292.0)
ELBOW_T, WRIST_T = 0.54, 0.80
FIST = (744.0, 76.0)
ELBOW = (536.0 + ELBOW_T * 208.0, 292.0 - ELBOW_T * 216.0)
WRIST = (536.0 + WRIST_T * 208.0, 292.0 - WRIST_T * 216.0)
GRAPE_PIVOT = (754.0, 56.0)

a = np.asarray(arm_tex)
ys, xs = np.nonzero(a[..., 3] > 8)
bbox = (int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1)

# chest warp region (master px): the ribcage/belly band under the shoulder line
CHEST = np.zeros((H, W), bool)
from PIL import ImageDraw as _ID
_p = Image.new("L", (W, H), 0)
_ID.Draw(_p).polygon([(700, 380), (900, 360), (1080, 390), (1180, 470),
                      (1160, 600), (980, 680), (800, 660), (680, 540)], fill=255)
CHEST = np.asarray(_p) > 128
CHEST_Y = np.nonzero(CHEST)[0]
cy0, cy1 = CHEST_Y.min(), CHEST_Y.max()
cy_c = 0.5 * (cy0 + cy1)

# ── the curves (rig JSON mirror) ──────────────────────────────────────────────
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
    "handover": {"period": 24.0, "window": [14.50, 18.24]},
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


# update the rig JSON with the curves and the wrist bone
rig_path = os.path.join(P57, "rig", "buddha-rig-parts.json")
rig = json.load(open(rig_path))
rig["bones"]["wrist"] = {"parent": "forearm", "pivot": [round(WRIST[0], 1), round(WRIST[1], 1)]}
rig["parts"]["wrist_hand"] = "parts/06-wrist-hand.png"
rig["parts"]["forearm"] = "parts/05-forearm.png"
rig["curves"] = CURVES
rig["breath_mechanism"] = "torso mesh warp on the master-extracted texture (zero drift); generated breath states pending review"
json.dump(rig, open(rig_path, "w"), indent=1)
print("rig JSON updated: wrist bone + curves")

# ── the arm mesh (same as rig-parts-eval) ─────────────────────────────────────
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
W_up = (1.0 - w_fore)[:, None]
W_fo = w_fore[:, None]


def lbss(arm_deg):
    th1 = np.radians(arm_deg)
    c1, s1 = np.cos(th1), np.sin(th1)
    R1 = np.array([[c1, s1], [-s1, c1]])
    upper = SH + (REST - SH) @ R1.T
    elb = SH + (np.array(ELBOW) - SH) @ R1.T
    th2 = np.radians(arm_deg * 0.35)
    c2, s2 = np.cos(th2), np.sin(th2)
    R2 = np.array([[c2, s2], [-s2, c2]])
    fore = elb + (REST - np.array(ELBOW)) @ (R1 @ R2).T
    out = W_up * upper + W_fo * fore
    k = np.interp(arm_deg, [-15.0, -7.0, 0.0, 6.0], [1.0, 0.5, 0.0, -0.35])
    near = np.clip(1.0 - np.abs(T - 0.25) / 0.45, 0, 1)[:, None]
    return out + k * 0.035 * near * (np.array(SH)[None, :] - out)


def warp_by_mesh(tex, rest, moved):
    tw, th_ = tex.size
    src = np.asarray(tex)
    uvs = rest / np.array([tw, th_], dtype=np.float32)
    out = np.zeros((H, W, 4), np.uint8)
    for j in range(NY - 1):
        for i in range(NX - 1):
            n0 = j * NX + i
            for tri in ((n0, n0 + 1, n0 + NX), (n0 + 1, n0 + NX + 1, n0 + NX)):
                p = moved[list(tri)]
                uv = uvs[list(tri)]
                xmin = max(int(np.floor(p[:, 0].min())), 0)
                xmax = min(int(np.ceil(p[:, 0].max())), W - 1)
                ymin = max(int(np.floor(p[:, 1].min())), 0)
                ymax = min(int(np.ceil(p[:, 1].max())), H - 1)
                if xmin > xmax or ymin > ymax:
                    continue
                gy, gx = np.mgrid[ymin:ymax + 1, xmin:xmax + 1]
                pts = np.stack([gx.ravel() + 0.5, gy.ravel() + 0.5], axis=1)
                d = np.stack([p[1] - p[0], p[2] - p[0]])
                det = d[0, 0] * d[1, 1] - d[0, 1] * d[1, 0]
                if abs(det) < 1e-9:
                    continue
                rel = pts - p[0]
                b1 = (rel[:, 0] * d[1, 1] - rel[:, 1] * d[1, 0]) / det
                b2 = (rel[:, 1] * d[0, 0] - rel[:, 0] * d[0, 1]) / det
                b0 = 1.0 - b1 - b2
                inside = (b0 >= -1e-9) & (b1 >= -1e-9) & (b2 >= -1e-9)
                if not inside.any():
                    continue
                uvv = b0[:, None] * uv[0] + b1[:, None] * uv[1] + b2[:, None] * uv[2]
                sx = np.clip(np.floor(uvv[:, 0] * tw).astype(int), 0, tw - 1)
                sy = np.clip(np.floor(uvv[:, 1] * th_).astype(int), 0, th_ - 1)
                vals = src[sy, sx]
                m = (vals[..., 3] > 0) & inside
                out[gy.ravel()[m], gx.ravel()[m]] = vals[m]
    return Image.fromarray(out)


def torso_warped(breath):
    """The chest rises: vertices inside the chest band shift up and out, scaled
    by a vertical profile so the motion reads as volume, not translation."""
    if breath <= 0.001:
        return torso_tex
    src = np.asarray(torso_tex)
    out = np.zeros((H, W, 4), np.uint8)
    ys_c, xs_c = np.nonzero(CHEST)
    w = 1.0 - np.abs(ys_c - cy_c) / (0.5 * (cy1 - cy0))
    disp = np.zeros((H, W, 2), np.float32)
    disp[ys_c, xs_c, 1] = -7.0 * breath * w          # rise
    disp[ys_c, xs_c, 0] = 2.2 * breath * np.sin((xs_c - 880.0) / 260.0) * w  # bulge
    sy = np.clip(ys_c + disp[ys_c, xs_c, 0] * 0 - disp[ys_c, xs_c, 1], 0, H - 1).astype(int)
    sx = np.clip(xs_c + disp[ys_c, xs_c, 0], 0, W - 1).astype(int)
    out[sy, sx] = src[ys_c, xs_c]
    base = src.copy()
    m = out[..., 3] > 0
    base[m] = out[m]
    return Image.fromarray(base)


# ── face patch registration (the swap/cross-fade the order specifies) ────────
# crop-face.png registered against the master at NCC 1.0000, origin (850,60);
# the generated patches are the crop at 3.2x (1120x960). Key the baked
# checkerboard/white background (neutral, bright), clip to the master figure,
# and cross-fade by the rig curves. At rest every fade is 0 -> REST untouched.
FACE_ORIGIN = (850.0, 60.0)
FACE_SIZE = (350, 300)
PATCH_SCALE = 3.2
_fig_dil = np.asarray(Image.fromarray(
    ((A_master > 0.02) * 255).astype(np.uint8)).filter(_IF.MaxFilter(13))) > 128


def face_overlay(name):
    p = Image.open(os.path.join(P57, "parts", name)).convert("RGB").resize(FACE_SIZE, Image.LANCZOS)
    a = np.asarray(p).astype(np.float32)
    lum = a @ np.array([.299, .587, .114])
    chroma = a.max(axis=2) - a.min(axis=2)
    keep = ~((chroma < 25) & (lum > 170))          # drop baked checkerboard/white
    ox, oy = int(FACE_ORIGIN[0]), int(FACE_ORIGIN[1])
    keep &= _fig_dil[oy:oy + FACE_SIZE[1], ox:ox + FACE_SIZE[0]]
    canvas = np.zeros((H, W, 4), np.uint8)
    reg = canvas[oy:oy + FACE_SIZE[1], ox:ox + FACE_SIZE[0]]
    for c in range(3):
        reg[..., c] = np.where(keep, a[..., c], 0).astype(np.uint8)
    reg[..., 3] = np.where(keep, 255, 0).astype(np.uint8)
    canvas[oy:oy + FACE_SIZE[1], ox:ox + FACE_SIZE[0]] = reg
    return Image.fromarray(canvas)


ov_blink = face_overlay("15-face-blink.png")
ov_smile = face_overlay("14-face-smile.png")
ov_brow = face_overlay("16-face-brow.png")

# REGISTRATION VERDICT (face-fades.png is the evidence): the generated face
# pieces are FULL-CROP re-illustrations - a second complete face with shifted
# features - not local expression patches. Cross-fading them onto the master
# face ghosts (double face, doubled ear, keyed speckle). Per the acceptance
# criteria (no artifacts) the fades are gated OFF in the cycle; the pieces
# remain as expression references for review / tight-patch regeneration.
FACE_FADES = False


def fade(canvas, overlay, k):
    if k <= 0.004:
        return
    tmp = np.asarray(overlay).copy()
    tmp[..., 3] = (tmp[..., 3].astype(np.float32) * min(k, 1.0)).astype(np.uint8)
    canvas.alpha_composite(Image.fromarray(tmp))


def sstep(x):
    x = max(0.0, min(1.0, x))
    return x * x * (3 - 2 * x)


def compose(t, backing=None):
    arm_deg = eval_curve(CURVES["arm_angle"], t)
    sway = eval_curve(CURVES["grape_sway"], t)
    breath = eval_curve(CURVES["breath"], t)
    h0, h1 = CURVES["handover"]["window"]
    tt = t % 24.0
    window = h0 <= tt <= h1
    out = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    if backing is not None:
        out.alpha_composite(backing)
    out.alpha_composite(torso_warped(breath))
    out.alpha_composite(strand_tex)   # necklace: master stacking, under the arm
    if window:
        out.alpha_composite(lowered)   # the drawn-behind lowered pose (hand + grapes + sleeve)
    else:
        out.alpha_composite(warp_by_mesh(arm_tex, REST, lbss(arm_deg)))
        gp = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        gp.alpha_composite(grapes_tex.rotate(sway, resample=Image.BICUBIC,
                                             center=GRAPE_PIVOT, expand=False))
        out.alpha_composite(gp)
    # face cross-fades (swap/cross-fade per the order): gated off - the
    # generated pieces are full-crop re-illustrations, not local patches
    # (see the REGISTRATION VERDICT above and rig/face-fades.png)
    if FACE_FADES:
        fade(out, ov_blink, eval_curve(CURVES["blink"], t))
        fade(out, ov_smile, sstep((arm_deg - 3.0) / 3.0))
        fade(out, ov_brow, sstep((-arm_deg - 10.0) / 4.0))
    under = Image.new("RGBA", (W, H), CARD)
    under.alpha_composite(out)
    return under


# sanity: at t=0 every layer must be master-exact; the grapes are swayed
# (-4.5 deg is the cycle's own start value, exactly as production CSS starts),
# so the only legitimate diffs are inside the grapes' sway band. This is now a
# FULL-FIGURE check: torso, necklace strand, arm mesh and face (all fades 0).
from PIL import ImageFilter
r0 = np.asarray(compose(0.0)).astype(np.int16)
dd = np.abs(r0 - Mr.astype(np.int16)).max(axis=2)
sway_band = np.asarray(Image.fromarray(
    ((A_gra > 0.02) * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(49))) > 128
fig = A_master > 0.02
bad = (dd > 0) & fig & ~sway_band
print("REST check at t=0: FULL-FIGURE diffs outside the grape sway band:",
      int(bad.sum()), "| inside the band (the cycle's own sway):",
      int(((dd > 0) & fig & sway_band).sum()))

# ── the strip: 24s at 2fps ────────────────────────────────────────────────────
FR = 48
tw, thh = 188, 125
sheet = Image.new("RGB", (tw * 8 + 72, (thh + 16) * 6 + 30), (8, 8, 10))
d = ImageDraw.Draw(sheet)
d.text((6, 4), "THE LIVING CYCLE - 24s through the parts rig: mesh arm (LBS+keyform), breath torso warp, grape sway, stepped handover over the clean plate. 2fps.", fill=(255, 226, 138))
for f in range(FR):
    t = f * 0.5
    im = compose(t, backing=plate_backing).resize((tw, thh), Image.LANCZOS)
    x = (f % 8) * (tw + 8) + 6
    y = (f // 8) * (thh + 16) + 20
    sheet.paste(im, (x, y))
    d.text((x, y - 11), f"t={t:04.1f}s", fill=(255, 226, 138))
sheet.save(os.path.join(P57, "rig", "cycle-strip.png"))
print("cycle strip written: docs/evidence/round57/rig/cycle-strip.png")

# face closeups: EVIDENCE MODE - fades forced on to document why the
# generated face pieces are rejected as overlays (the ghost double-face)
FC = (850, 60, 1200, 360)
FACE_FADES = True
faces = Image.new("RGB", (350 * 2 * 2 + 24, 300 * 2 + 44), (8, 8, 10))
df = ImageDraw.Draw(faces)
df.text((6, 4), "FACE registration EVIDENCE - rest | blink overlay t=8.6 (ghost: full-crop re-illustration) | smile t=2.6 | brow t=16.5 - 2x. Fades gated OFF in the cycle.", fill=(255, 226, 138))
for i, (t, tag) in enumerate(((0.0, "rest"), (8.633, "blink"), (2.6, "smile"), (16.5, "brow"))):
    im = compose(t, backing=plate_backing).crop(FC).resize((700, 600), Image.LANCZOS)
    x = (i % 2) * 712 + 6
    y = (i // 2) * 616 + 22
    faces.paste(im, (x, y))
    df.text((x, y - 12), "t=%s (%s)" % (t, tag), fill=(255, 226, 138))
faces.save(os.path.join(P57, "rig", "face-fades.png"))
print("face sheet written: docs/evidence/round57/rig/face-fades.png")

rig["registration"] = {
    "face_crop": {"file": "crops/crop-face.png", "origin": [850, 60], "size": [350, 300],
                   "method": "NCC on luminance = 1.0000", "patch_scale": 3.2},
    "face_fades": {"status": "gated_off - generated pieces are full-crop re-illustrations,"
                              " not local patches; overlay ghosts (rig/face-fades.png evidence)",
                   "blink": "15-face-blink by blink curve (when re-cut as a tight patch)",
                   "smile": "14-face-smile when arm_angle > +3 (when re-cut)",
                   "brow": "16-face-brow when arm_angle < -10 (when re-cut)"},
    "necklace": {"strand": "parts/08-necklace-master-strand.png (master values, own region)",
                 "draw_rule": "strand above torso, below arm at every angle (master stacking); painted front/back groups pending review"}}
json.dump(rig, open(rig_path, "w"), indent=1)
print("rig JSON: face registration + necklace draw rule recorded")
