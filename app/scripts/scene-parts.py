#!/usr/bin/env python3
"""
Cut the Golden Buddha scene into the parts its animation moves.

    python3 app/scripts/scene-parts.py [--debug]

WHY THIS EXISTS. The scene shipped as four WHOLE-SCENE states (base, rest,
breath, blink) cross-faded into each other. A cross-fade between two whole
scenes is a dissolve, not an animation: the character never moves, the picture
changes. The four states are also four separate generations of the same figure,
so their coins differ pixel-for-pixel every frame — the dissolve shimmered the
entire pile instead of moving one limb. TARGET.md §3 and §27 refuse exactly
that: a cut-out hand "must not read as a torn piece of photograph", and a moved
PNG is not character animation.

THE PIPELINE (TARGET.md §2):

    HIGH-RES MASTER -> CLEAN LAYER EXTRACTION -> ANIMATION ASSETS
                    -> COMPOSITING -> CARD DISPLAY

The master is `mascot-gold-buddha-base.png`, 1536x1024 — the largest source
that exists. Everything is cut from the master at master resolution and
downscaled ONCE to the shipped 768x512. Cutting from the 768 WebPs instead
would mean cutting a cut-out out of a lossy downscale of itself: the arm edge
is the one place where that shows, which is the defect being fixed.

WHAT THE PARTS ARE

    part-plate-armless   the figure with the raised arm taken out, and the
                         chest the arm was covering filled from the arm-down
                         state's own pixels (same figure, same material, same
                         light). This is what breathes.
    part-arm-raised      the raised arm, cut from the master in place
    part-grapes-raised   the grape cluster alone, so it can swing on its stem
    part-arm-lowered     the arm brought down to the belly, cut from the
                         arm-down state, light-matched to the plate
    part-eye-blink       the closed eyes
    part-chest-breath    the fuller chest

WHY THE MASK IS DERIVED, NOT DRAWN. A hand-drawn polygon was tried first and
left fragments behind at the shoulder — the sash, the necklace, the coin the
arm covers — because a person tracing an outline guesses, and the artwork does
not. So the mask is computed from the two states: where the master has paint
and the arm-down state has none, the arm is against open air; where both are
painted but the pictures disagree, the arm lies across the body. That cannot
miss those places, because it asks the artwork instead of guessing.

WHY THE TWO LAYERS ARE EXACT COMPLEMENTS. `arm_alpha` and the plate's alpha are
cut from one mask: `plate_alpha = base_alpha - arm_alpha`. So the two layers
together cover exactly the silhouette the master had, and laid back in their
original pose they reconstruct it. TARGET.md §22 makes that the gate: no
animation work proceeds past a visible seam.

Needs PIL + numpy. Development-time only — the shipped WebPs are committed.
"""
import os
import sys

import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
DIR = os.path.join(HERE, "..", "public", "img", "cosmetics")
DEBUG = "--debug" in sys.argv

MASTER = os.path.join(DIR, "mascot-gold-buddha-base.png")   # 1536x1024, no alpha
OUT = (768, 512)                                            # what the card serves


def state(name):
    """One keyed state at master resolution (upscaled from the 768 WebP)."""
    im = Image.open(os.path.join(DIR, f"mascot-gold-buddha-{name}.webp")).convert("RGBA")
    return im.resize((im.width * 2, im.height * 2), Image.LANCZOS)


master_rgb = Image.open(MASTER).convert("RGB").resize((1536, 1024), Image.LANCZOS)
W, H = master_rgb.size
# The small states again, at the 768 scale, for the comparison maths.
small = {n: Image.open(os.path.join(DIR, f"mascot-gold-buddha-{n}.webp")).convert("RGBA")
         for n in ("base", "rest", "breath", "blink")}

# ── the arm mask, derived from the artwork ──────────────────────────────────
# The raised arm lives in the upper left. The bound keeps every operation away
# from the coins, the face and the lounging body, so a threshold that misfires
# on a coin highlight cannot touch the composition.
ARM_BOX_768 = (150, 0, 440, 190)


def box_mask(box768):
    m = Image.new("L", (768, 512), 0)
    b = tuple(int(v * 768 / 768) for v in box768)
    ImageDraw.Draw(m).rectangle(b, fill=255)
    return m


def grow(mask, px):
    for _ in range(px):
        mask = mask.filter(ImageFilter.MaxFilter(3))
    return mask


def shrink(mask, px):
    for _ in range(px):
        mask = mask.filter(ImageFilter.MinFilter(3))
    return mask


ba = small["base"].getchannel("A").point(lambda v: 255 if v > 40 else 0)
ra = small["rest"].getchannel("A").point(lambda v: 255 if v > 40 else 0)
over_air = ImageChops.subtract(ba, ra)
over_body = ImageChops.difference(small["base"].convert("RGB"),
                                  small["rest"].convert("RGB")).convert("L").point(
    lambda v: 255 if v > 58 else 0)
arm = ImageChops.multiply(ImageChops.lighter(over_air, over_body), box_mask(ARM_BOX_768))
# A close, so a hairline of disagreement inside the arm cannot open a hole in
# it; then a small grow to catch the anti-aliased rim of the silhouette.
arm = grow(arm, 2).filter(ImageFilter.MaxFilter(3)).filter(ImageFilter.GaussianBlur(2))
arm = arm.resize((W, H), Image.LANCZOS)

# ── the split, done as arithmetic rather than as hope ───────────────────────
# Layering two RGBA images over each other is not the inverse of cutting them
# apart. Over-composited, a half-transparent arm over a half-transparent plate
# lands at 75% of the original colour — a one-pixel dark ring around the arm,
# which is exactly the "halo" TARGET.md §3 forbids, and it is what the first
# pass measured (1.18% of the plate differing from the original).
#
# So the plate is not "the rest state pasted in and hoped for": it is the exact
# REMAINDER of the master once the arm has taken its share —
#
#     plate = (master * base_alpha - arm) / (base_alpha - arm_alpha)
#
# — which composites back to the master pixel-for-pixel at any alpha, because
# it is the same equation rearranged. The reconstruction test (§22) then has
# nothing left to measure but rounding.
arm_alpha = arm.filter(ImageFilter.GaussianBlur(1.6))
base_alpha = small["base"].getchannel("A").resize((W, H), Image.LANCZOS).filter(
    ImageFilter.GaussianBlur(0.8))

# What is behind the arm, where the plate is see-through (the arm is opaque
# there, so this colour is invisible until the arm swings away — which is
# TARGET.md §4's "reconstruct what is behind the arm").
rest_big = state("rest")
chest_rgb = np.asarray(rest_big.convert("RGB").resize((W, H), Image.LANCZOS)).astype("float32")
# The reconstruction goes ONLY where the plate is see-through — where the arm
# is opaque, so those pixels are invisible until the arm swings away. Anywhere
# the plate is even slightly visible the plate must hold the master's own
# colour, or the reconstructed region shows through the arm's feathered edge as
# the halo TARGET.md §3 forbids. (This is the whole of the first pass's 1.18%
# error: the fill was painted where the plate was still 30% visible.)

m = np.asarray(master_rgb).astype("float32")
ba = np.asarray(base_alpha).astype("float32")[..., None] / 255.0
aa = np.asarray(arm_alpha).astype("float32")[..., None] / 255.0

# THE ALPHA DECONVOLUTION. Drawing the arm over the plate is not the inverse of
# cutting them apart: over-composited, the pair produces aa + (1-aa)*plate, and
# subtracting the arm's share from the plate's (the obvious thing) leaves that
# short by (1-aa)^2 — under a feathered edge that is a one-pixel rim of card
# background, and it is where both earlier passes kept their error.
#
# The plate that composites back to the master exactly is
#
#     plate_alpha = (base_alpha - arm_alpha) / (1 - arm_alpha)
#
# with the master's own colour: the plate carries MORE coverage where the arm
# carries less, so the two together land on the master's silhouette and the
# master's pixels at every alpha. Where the arm is opaque the plate is empty,
# which is also where the reconstructed chest belongs — invisible until the arm
# swings away from it.
plate_alpha = np.clip(np.where(aa < 0.999, (ba - aa) / np.clip(1 - aa, 1e-3, 1), 0.0), 0, 1)
# The arm and the plate are cut from the same pixels, so where the plate IS
# visible its colour is simply the master's — and where it is not, nothing
# shows, which is where the reconstruction belongs. `solid` ramps on the
# plate's own alpha, not on the arm's, so the fill can never leak into the
# feathered edge.
solid = np.clip((0.08 - plate_alpha[..., 0]) / 0.06, 0, 1)[..., None]
plate_rgb = np.clip(m * (1 - solid) + chest_rgb * solid, 0, 255)

plate = Image.merge("RGBA", (*[Image.fromarray(plate_rgb[:, :, c].astype("uint8")) for c in range(3)],
                             Image.fromarray((plate_alpha[..., 0] * 255).astype("uint8"))))
arm_alpha_img = Image.fromarray((np.clip(aa[..., 0] * ba[..., 0], 0, 1) * 255).astype("uint8"))
arm_img = Image.merge("RGBA", (*master_rgb.split(), arm_alpha_img))

# The cluster hangs free of the body, so a swing reveals air where it was and
# never a hole in the robe: it is the one part that can move without redrawing
# anything, and TARGET.md §8 makes it its own element. The mask stops short of
# the fist — the knuckles keep their pixels in the arm layer — so the stem
# stays welded to the hand and the cluster pivots out of the grip.
S = W / 768.0
g = Image.new("L", (W, H), 0)
_g = ImageDraw.Draw(g)
_g.ellipse([337 * S, 52 * S, 417 * S, 142 * S], fill=255)
_g.polygon([(366 * S, 30 * S), (380 * S, 30 * S), (384 * S, 66 * S), (362 * S, 66 * S)], fill=255)
# Hard-edged, deliberately. Over-compositing two layers whose alphas both
# feather cannot reproduce the layer they were cut from — the alphas fall short
# by s*r and the colour overshoots to compensate, which is a halo by another
# name. A crisp boundary between the cluster and the knuckles is exact, and the
# two are the same gold at a junction that never reads as an edge.
fist = Image.new("L", (W, H), 0)
ImageDraw.Draw(fist).ellipse([344 * S, 18 * S, 398 * S, 62 * S], fill=255)
grapes_mask = ImageChops.subtract(g, fist.point(lambda v: 255 if v > 128 else 0))

# The same arithmetic as the plate, one level down. The grapes swing inside the
# arm's own frame (`.mascot-grapes` is a child of `.mascot-arm`), so the eye is
# on this junction the whole time the cluster moves: the two layers have to add
# back up to the arm, and with a hard mask they do, exactly.
g_alpha = np.asarray(grapes_mask).astype("float32")[..., None] / 255.0
arm_a = np.clip(aa * ba, 0, 1)
grapes_a = np.clip(arm_a * g_alpha, 0, 1)
# …and the arm keeps the same deconvolved remainder, so grape-over-arm lands on
# the arm exactly. With a hard mask this is simply the arm outside the cluster.
arm_only_a = np.clip(np.where(grapes_a < 0.999,
                              (arm_a - grapes_a) / np.clip(1 - grapes_a, 1e-3, 1), 0.0), 0, 1)

grapes = Image.merge("RGBA", (*master_rgb.split(),
                              Image.fromarray((grapes_a[..., 0] * 255).astype("uint8"))))
arm_only = Image.merge("RGBA", (*master_rgb.split(),
                                Image.fromarray((arm_only_a[..., 0] * 255).astype("uint8"))))

# ── the lowered arm, on the belly ───────────────────────────────────────────
LOWER = [(236, 190), (244, 174), (258, 162), (276, 154), (298, 152), (318, 158),
         (334, 170), (346, 186), (352, 204), (350, 222), (340, 238), (322, 250),
         (300, 258), (278, 260), (258, 254), (244, 242), (236, 224), (232, 206)]
lower_mask = Image.new("L", (768, 512), 0)
ImageDraw.Draw(lower_mask).polygon(LOWER, fill=255)
lower_mask = lower_mask.filter(ImageFilter.GaussianBlur(7)).resize((W, H), Image.LANCZOS)


def match_light(src_rgb, ref_rgb, radius):
    """Bring a patch's low frequencies onto the plate's, and leave its detail.

    The hand on the belly sits in the shade the raised arm used to cast, so the
    patch arrives darker than the plate under it. Matching everything would
    flatten the hand's own modelling, which is the whole reason to use these
    pixels rather than a drawn hand; matching only the low frequencies keeps the
    modelling and lands the patch in the plate's light.
    """
    lo_s = src_rgb.filter(ImageFilter.GaussianBlur(radius))
    lo_r = ref_rgb.filter(ImageFilter.GaussianBlur(radius))
    s = np.asarray(src_rgb).astype("float32")
    out = np.empty_like(s)
    for c in range(3):
        k = np.asarray(lo_r.getchannel(c)).astype("float32") + 8.0
        d = np.asarray(lo_s.getchannel(c)).astype("float32") + 8.0
        out[:, :, c] = np.clip(s[:, :, c] * np.clip(k / d, 0.80, 1.40), 0, 255)
    return Image.fromarray(out.astype("uint8"), "RGB")


belly_rgb = match_light(rest_big.convert("RGB"), master_rgb, 26 * S)
arm_lowered = Image.merge("RGBA", (*belly_rgb.split(),
                                   ImageChops.multiply(rest_big.getchannel("A"), lower_mask)))

# ── the eyes ────────────────────────────────────────────────────────────────
blink_big = state("blink")
eye_mask = Image.new("L", (W, H), 0)
ImageDraw.Draw(eye_mask).ellipse([int(432 * S), int(46 * S), int(534 * S), int(106 * S)], fill=255)
eye_mask = eye_mask.filter(ImageFilter.GaussianBlur(8 * S))
eye_blink = Image.merge("RGBA", (*blink_big.convert("RGB").split(),
                                 ImageChops.multiply(blink_big.getchannel("A"), eye_mask)))

# ── the chest ───────────────────────────────────────────────────────────────
# `breath` differs from `base` across the coins too (a separate generation), so
# this patch is kept to the one region where the difference IS the breath. The
# difference heat map puts it in a compact band across the belly and chest.
CHEST = [(262, 172), (282, 162), (306, 156), (332, 156), (358, 162), (384, 172),
         (404, 186), (414, 204), (410, 224), (396, 240), (374, 252), (348, 260),
         (320, 264), (294, 262), (272, 252), (258, 238), (252, 220), (254, 194)]
chest_mask = Image.new("L", (768, 512), 0)
ImageDraw.Draw(chest_mask).polygon(CHEST, fill=255)
chest_mask = chest_mask.filter(ImageFilter.GaussianBlur(9)).resize((W, H), Image.LANCZOS)
breath_big = state("breath")
chest_rgb = match_light(breath_big.convert("RGB"), master_rgb, 26 * S)
chest_breath = Image.merge("RGBA", (*chest_rgb.split(),
                                    ImageChops.multiply(breath_big.getchannel("A"), chest_mask)))

# ── write ───────────────────────────────────────────────────────────────────
print(f"master {master_rgb.size[0]}x{master_rgb.size[1]} -> shipped {OUT[0]}x{OUT[1]}")


def save(img, name):
    small_img = img.resize(OUT, Image.LANCZOS)
    path = os.path.join(DIR, name)
    small_img.save(path, "WEBP", quality=92, method=6)
    print(f"  {name:32s} {os.path.getsize(path) / 1024:7.1f} KB")


print("scene parts:")
save(plate, "part-plate-armless.webp")
save(arm_only, "part-arm-raised.webp")
save(grapes, "part-grapes-raised.webp")
save(arm_lowered, "part-arm-lowered.webp")
save(eye_blink, "part-eye-blink.webp")
save(chest_breath, "part-chest-breath.webp")

# ── the gate: recomposition against the original (TARGET.md §22) ────────────
# The arm and the plate are cut from one mask and share one set of pixels, so
# laid back in the original pose they have to reconstruct the master. Measured
# rather than asserted by eye: what survives is the anti-aliased blend ring
# where the arm's feather meets the plate's fill, and it is a pixel wide.
# Measured in float, premultiplied: what the browser does when it draws the arm
# over the plate is exactly this arithmetic, and PIL's 8-bit alpha_composite is
# not (it loses a step to rounding at every partly-transparent pixel, which at
# the pile's outer rim reads as a 1px outline that is not in the artwork).
pa = np.asarray(Image.fromarray((plate_alpha[..., 0] * 255).astype("uint8"))).astype("float32") / 255.0
g_a = np.asarray(grapes_a[..., 0]).astype("float32")
ar_a = np.asarray(arm_only_a[..., 0]).astype("float32")
ar_c = np.asarray(arm_only.convert("RGB")).astype("float32")
pl_c = np.asarray(plate.convert("RGB")).astype("float32")
gr_c = np.asarray(grapes.convert("RGB")).astype("float32")

# arm over plate, then grapes over that — premultiplied, in float
over_a = ar_a + pa * (1 - ar_a)
over_c = ar_c * ar_a[..., None] + pl_c * (pa * (1 - ar_a))[..., None]
out_a = g_a + over_a * (1 - g_a)
out_c = (gr_c * g_a[..., None] + over_c * (1 - g_a)[..., None]) / np.clip(out_a, 1e-3, 1)[..., None]

# …against the master it was cut from
ref_a = np.asarray(base_alpha).astype("float32") / 255.0
ref_c = np.asarray(master_rgb).astype("float32")

vis = np.abs(out_c - ref_c).max(axis=2) * (ref_a > 0.5)
d = np.clip(vis, 0, 255)
print("\nrecomposition vs original (TARGET.md §22):")
print(f"  visible pixels differing > 4:  {(d > 4).sum()} of {d.size}")
print(f"  visible pixels differing > 24: {(d > 24).sum()}")
print(f"  worst visible difference:      {d.max():.1f} / 255")

if DEBUG:
    for img, n in ((arm_alpha, "dbg-alpha-arm"), (lower_mask, "dbg-mask-lower"),
                   (chest_mask, "dbg-mask-chest")):
        img.save(os.path.join(DIR, f"{n}.png"))
    Image.fromarray((plate_alpha[..., 0] * 255).astype("uint8")).save(
        os.path.join(DIR, "dbg-plate-alpha.png"))
    Image.fromarray(np.clip(d * 4, 0, 255).astype("uint8")).save(
        os.path.join(DIR, "dbg-recompose-diff.png"))
    print("  debug written")
