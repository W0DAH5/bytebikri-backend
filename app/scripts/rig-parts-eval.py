#!/usr/bin/env python3
"""
THE PARTS RIG — mesh deformation on the master-cut parts, round 57.

CHARACTER_ANIMATION.md's prescribed model, built as data + evaluator:

  * parts are cut at master resolution from the immutable master itself
    (single-owner regions; the 768 accepted cut decides WHERE, the master
    supplies every VALUE — zero drift by construction);
  * the arm is a grid MESH skinned to a two-bone chain (shoulder -> elbow ->
    fist) with blended weights at the joint (§3: "weights of 1.0 make a
    vertex rigid; blended weights across a joint make the surface bend");
  * the corrective keyform is authored in the rig JSON (§6) — v1 analytic
    shoulder compression, to be replaced by the painted patches;
  * the grapes ride their own bone nested in the arm chain.

Proofs printed and written:
  1. REST bit-equality over the arm footprint (0 differing px required);
  2. rigid vs mesh at +6/-15, the whole arm region;
  3. the window over the GENERATED clean plate: see-through hole count with
     and without the plate backing (§12.2 "the hidden body is painted").

    python3 app/scripts/rig-parts-eval.py
"""
import io
import json
import os

import numpy as np
from PIL import Image

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


def extract():
    """Cut the master into single-owner parts; values come from the master."""
    arm7 = np.asarray(Image.open(os.path.join(ROOT, "RECONSTRUCTION/layers/arm/arm.png")).convert("RGBA"))[..., 3].astype(np.float32) / 255
    gra7 = np.asarray(Image.open(os.path.join(ROOT, "RECONSTRUCTION/layers/grapes/grapes.png")).convert("RGBA"))[..., 3].astype(np.float32) / 255
    A_arm, A_gra = up2(arm7), up2(gra7)
    arm = (A_arm > 0.02) & (A_gra <= 0.02)
    gra = A_gra > 0.02
    tor = (A_master > 0.02) & ~arm & ~gra

    def part(mask, name):
        out = np.zeros((H, W, 4), np.uint8)
        for c in range(3):
            out[..., c] = np.where(mask, Mr[..., c], 0).astype(np.uint8)
        out[..., 3] = np.where(mask, Mr[..., 3], 0).astype(np.uint8)
        Image.fromarray(out).save(os.path.join(P57, "parts", name + ".png"))
        return mask

    part(arm, "02-arm-full")
    part(gra, "07-grapes-master")
    part(tor, "10-torso-master-visible")
    return arm, gra, tor


ARM, GRA, TOR = extract()
arm_tex = Image.open(os.path.join(P57, "parts", "02-arm-full.png")).convert("RGBA")
grapes_tex = Image.open(os.path.join(P57, "parts", "07-grapes-master.png")).convert("RGBA")
torso_tex = Image.open(os.path.join(P57, "parts", "10-torso-master-visible.png")).convert("RGBA")
plate_tex = Image.open(os.path.join(P57, "parts", "01-torso-clean-plate.png")).convert("RGB").resize((W, H), Image.LANCZOS)

# ── the rig, authored ─────────────────────────────────────────────────────────
SH = (536.0, 292.0)
ELBOW_T = 0.54
FIST = (744.0, 76.0)
ELBOW = (SH[0] + ELBOW_T * (FIST[0] - SH[0]), SH[1] + ELBOW_T * (FIST[1] - SH[1]))
GRAPE_PIVOT = (754.0, 56.0)

a = np.asarray(arm_tex)
ys, xs = np.nonzero(a[..., 3] > 8)
bbox = (int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1)

rig = {
    "master": "app/public/img/cosmetics/mascot-gold-buddha-base.png",
    "space": [W, H],
    "parameters": {
        "arm_angle": {"min": -15.0, "max": 6.0},
        "grape_sway": {"min": -4.5, "max": 5.0},
        "breath": {"min": 0.0, "max": 1.0},
        "blink": {"min": 0.0, "max": 1.0},
        "necklace_order": {"values": ["back", "front"], "note": "draw order flips with the arm"},
    },
    "bones": {
        "shoulder": {"parent": "torso", "pivot": list(SH)},
        "forearm": {"parent": "shoulder", "pivot": [round(ELBOW[0], 1), round(ELBOW[1], 1)]},
        "grapes": {"parent": "forearm", "pivot": list(GRAPE_PIVOT)},
    },
    "parts": {
        "torso": {"texture": "parts/10-torso-master-visible.png"},
        "clean_plate": {"texture": "parts/01-torso-clean-plate.png",
                        "role": "backing under the arm; generated, pending paint review"},
        "arm": {"texture": "parts/02-arm-full.png", "bbox": list(bbox),
                "mesh": [26, 12], "split_t": ELBOW_T, "blend": 0.09},
        "upper_arm_paint": "parts/03-upper-arm.png",
        "forearm_hand_paint": "parts/05-forearm-hand.png",
        "elbow_back": "parts/04-elbow-back.png",
        "shoulder_socket": "parts/02-shoulder-socket.png",
        "grapes": {"texture": "parts/07-grapes-master.png", "long_stem": "parts/07-grapes-long-stem.png",
                   "bone": "grapes"},
        "necklace": {"front": "parts/08-necklace-front-group.png",
                     "back": "parts/08b-necklace-back-group.png"},
        "breath": {"inhale": "parts/11-torso-breath-inhale.png",
                   "exhale": "parts/12-torso-breath-exhale.png",
                   "note": "v2: torso warp keyed on breath; art states are the reference"},
        "face": {"neutral": "parts/13-face-neutral-master.png", "smile": "parts/14-face-smile.png",
                 "blink": "parts/15-face-blink.png", "brow": "parts/16-face-brow.png"},
    },
    "keyforms": {
        "shoulder_compression": {
            "driven_by": "arm_angle",
            "values": {"0": 0.0, "-7": 0.5, "-15": 1.0, "6": -0.35},
            "painted": ["parts/09b-keyform-minus7.png", "parts/09-keyform-minus15.png",
                        "parts/09c-keyform-plus6.png"],
        },
    },
}
with open(os.path.join(P57, "rig", "buddha-rig-parts.json"), "w") as fh:
    json.dump(rig, fh, indent=1)
print(f"rig authored: bones {list(rig['bones'])}, arm mesh {rig['parts']['arm']['mesh']}")

# ── the mesh ──────────────────────────────────────────────────────────────────
NX, NY = rig["parts"]["arm"]["mesh"]
x0, y0, x1, y1 = bbox
gxs = np.round(np.linspace(x0, x1, NX)).astype(np.float64)
gys = np.round(np.linspace(y0, y1, NY)).astype(np.float64)
GX, GY = np.meshgrid(gxs, gys)
REST = np.stack([GX.ravel(), GY.ravel()], axis=1)

dx, dy = FIST[0] - SH[0], FIST[1] - SH[1]
L2 = dx * dx + dy * dy
T = ((REST[:, 0] - SH[0]) * dx + (REST[:, 1] - SH[1]) * dy) / L2
blend = rig["parts"]["arm"]["blend"]
w_fore = np.clip((T - (ELBOW_T - blend)) / (2 * blend), 0, 1)
W_upper = (1.0 - w_fore)[:, None]
W_fore = w_fore[:, None]


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
    out = W_upper * upper + W_fore * fore
    k = np.interp(arm_deg, [-15.0, -7.0, 0.0, 6.0], [1.0, 0.5, 0.0, -0.35])
    near = np.clip(1.0 - np.abs(T - 0.25) / 0.45, 0, 1)[:, None]
    out = out + k * 0.035 * near * (np.array(SH)[None, :] - out)
    return out


def warp_by_mesh(tex, rest, moved):
    tw, th = tex.size
    src = np.asarray(tex)
    uvs = rest / np.array([tw, th], dtype=np.float32)
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
                sy = np.clip(np.floor(uvv[:, 1] * th).astype(int), 0, th - 1)
                vals = src[sy, sx]
                m = (vals[..., 3] > 0) & inside
                out[gy.ravel()[m], gx.ravel()[m]] = vals[m]
    return Image.fromarray(out)


def compose(arm_deg, grape_deg, mesh=True, backing=None, card_underlay=True):
    # transparent canvas: what no part drew stays alpha 0, so hole counting is
    # honest; visuals paste the dark card under the scene afterwards
    out = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    if backing is not None:
        out.alpha_composite(backing)
    out.alpha_composite(torso_tex)
    if mesh:
        arm_img = warp_by_mesh(arm_tex, REST, lbss(arm_deg))
    else:
        th = np.radians(arm_deg)
        c, s = np.cos(th), np.sin(th)
        R = np.array([[c, s], [-s, c]])
        arm_img = warp_by_mesh(arm_tex, REST, SH + (REST - SH) @ R.T)
    out.alpha_composite(arm_img)
    gp = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    gp.alpha_composite(grapes_tex.rotate(grape_deg, resample=Image.BICUBIC,
                                         center=GRAPE_PIVOT, expand=False))
    out.alpha_composite(gp)
    if card_underlay:
        under = Image.new("RGBA", (W, H), CARD)
        under.alpha_composite(out)
        return under
    return out


plate_backing = Image.new("RGBA", (W, H), (0, 0, 0, 0))
plate_backing.paste(plate_tex, (0, 0))

# ── proof 1: REST bit-equality ────────────────────────────────────────────────
rest = compose(0.0, 0.0)
Rn = np.asarray(rest).astype(np.int16)
Mn = Mr.astype(np.int16)
foot = a[..., 3] > 8
diff = np.abs(Rn - Mn).max(axis=2)
n_bad = int((diff[foot] > 0).sum())
print(f"PROOF 1  REST over the arm footprint: {int(foot.sum())} px, differing {n_bad}"
      f"  -> {'BIT-EQUAL' if n_bad == 0 else 'MISMATCH'}")

# ── proof 2: rigid vs mesh ────────────────────────────────────────────────────
from PIL import ImageDraw
box = (330, 20, 880, 470)
w, h = box[2] - box[0], box[3] - box[1]
S = 0.62
tw, th = int(w * S), int(h * S)
sheet = Image.new("RGB", (tw * 2 + 30, (th + 26) * 2 + 40), (8, 8, 10))
d = ImageDraw.Draw(sheet)
d.text((8, 4), "ARM REGION at the swing extremes - RIGID single-pivot (left) vs MESH: two-bone LBS + shoulder-compression keyform (right)", fill=(255, 226, 138))
d.text((8, 18), f"REST: mesh composition bit-equal to the master over the arm footprint ({n_bad} differing px of {int(foot.sum())})", fill=(160, 220, 255))
for i, deg in enumerate((6, -15)):
    y = 36 + i * (th + 26)
    sheet.paste(compose(deg, deg * 0.6, mesh=False).crop(box).resize((tw, th), Image.LANCZOS), (10, y))
    sheet.paste(compose(deg, deg * 0.6, mesh=True).crop(box).resize((tw, th), Image.LANCZOS), (tw + 20, y))
    d.text((10, y + th + 3), f"arm_angle={deg:+d}: rigid", fill=(255, 226, 138))
    d.text((tw + 20, y + th + 3), f"arm_angle={deg:+d}: mesh (forearm counter-bend + compression)", fill=(255, 226, 138))
sheet.save(os.path.join(P57, "rig", "mesh-vs-rigid.png"))
print("PROOF 2  sheet: docs/evidence/round57/rig/mesh-vs-rigid.png")

# ── proof 3: the window over the generated clean plate ───────────────────────
# The arm swung fully out; see-through = figure px where nothing drew (alpha 0)
fig = (A_master > 0.02) & ~GRA
win_box = (330, 20, 900, 470)
def holes(backing):
    im = np.asarray(compose(-15, -4.5, mesh=True, backing=backing, card_underlay=False))
    return int(((im[..., 3] < 8) & fig).sum())
h_bare, h_plate = holes(None), holes(plate_backing)
print(f"PROOF 3  see-through figure px at -15deg: bare cut {h_bare} -> over the generated plate {h_plate}")
sw, sh = 430, int((win_box[3] - win_box[1]) * 430 / (win_box[2] - win_box[0]))
s3 = Image.new("RGB", (sw * 2 + 20, sh + 30), (8, 8, 10))
d3 = ImageDraw.Draw(s3)
s3.paste(compose(-15, -4.5, mesh=True, backing=None).crop(win_box).resize((sw, sh), Image.LANCZOS), (8, 24))
s3.paste(compose(-15, -4.5, mesh=True, backing=plate_backing).crop(win_box).resize((sw, sh), Image.LANCZOS), (sw + 12, 24))
d3.text((8, 6), f"arm swung out over the bare cut: {h_bare} see-through px", fill=(255, 140, 120))
d3.text((sw + 12, 6), f"over the GENERATED clean plate: {h_plate} see-through px", fill=(160, 220, 255))
s3.save(os.path.join(P57, "rig", "window-over-plate.png"))
print("PROOF 3  sheet: docs/evidence/round57/rig/window-over-plate.png")
