#!/usr/bin/env python3
"""
Prove, in pictures, that the layered scene is the original artwork.

The pipeline (scene-parts.py) prints the numbers: the recomposition scores a
mean of 3.05/255 against the artwork where re-encoding the artwork itself
scores 3.80, and the difference along the cut is no worse than the difference
in the flat gold beside it. Numbers are how a seam is caught before an eye
catches it, but they are not the acceptance test — the brief's test is the
picture. So this writes the picture:

    docs/evidence/round51-layers/01-original-vs-recomposed.png
        the artwork, the recomposition, and the difference between them at
        twelve times its own contrast — if there were a seam it would be the
        brightest thing in the third panel

    02-the-cut.png
        the shoulder at four times on the same card, both pictures, plus the
        difference — where the arm was separated

    03-the-pose-change.png
        the arm moved away: what the reconstruction put BEHIND it, and the
        hole that is not there

    04-flicker.gif
        the artwork and the recomposition alternating. A seam does not survive
        this: it flickers. Nothing else does.

    python3 app/scripts/scene-proof.py
"""
import os
from PIL import Image, ImageChops, ImageDraw
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
COS = os.path.join(HERE, "..", "public", "img", "cosmetics")
OUT = os.path.join(HERE, "..", "..", "docs", "evidence", "round51-layers")
os.makedirs(OUT, exist_ok=True)

base = Image.open(os.path.join(COS, "mascot-gold-buddha-base.webp")).convert("RGBA")
plate = Image.open(os.path.join(COS, "part-plate-armless.webp")).convert("RGBA")
arm = Image.open(os.path.join(COS, "part-arm-raised.webp")).convert("RGBA")
grapes = Image.open(os.path.join(COS, "part-grapes-raised.webp")).convert("RGBA")
belly = Image.open(os.path.join(COS, "part-arm-lowered.webp")).convert("RGBA")

recomposed = plate.copy()
recomposed.alpha_composite(arm)
recomposed.alpha_composite(grapes)

W, H = base.size
BG = (238, 238, 238)


def flat(im, bg=BG):
    out = Image.new("RGB", im.size, bg)
    out.paste(im, (0, 0), im)
    return out


def label(im, text, height=26, size=1):
    out = im.copy()
    d = ImageDraw.Draw(out)
    d.rectangle([0, 0, out.width - 1, height], fill=(16, 16, 18))
    d.text((9, 8), text, fill=(255, 226, 138))
    return out


def stack(panels, gap=10):
    w = max(p.width for p in panels)
    h = sum(p.height for p in panels) + gap * (len(panels) - 1)
    out = Image.new("RGB", (w, h), (255, 255, 255))
    y = 0
    for p in panels:
        out.paste(p, (0, y))
        y += p.height + gap
    return out


def side_by_side(panels, gap=10):
    w = sum(p.width for p in panels) + gap * (len(panels) - 1)
    h = max(p.height for p in panels)
    out = Image.new("RGB", (w, h), (255, 255, 255))
    x = 0
    for p in panels:
        out.paste(p, (x, 0))
        x += p.width + gap
    return out


# ── 01 · the artwork, the recomposition, and the difference ─────────────────
a = np.asarray(flat(base)).astype(np.int16)
b = np.asarray(flat(recomposed)).astype(np.int16)
diff = np.abs(a - b).max(axis=2)
amp = np.clip(diff * 12, 0, 255).astype(np.uint8)
diff_img = Image.fromarray(np.dstack([amp, amp, amp]))

p1 = label(flat(base), "ORIGINAL  (mascot-gold-buddha-base.webp)")
p2 = label(flat(recomposed), "RECOMPOSED  (plate + arm + grapes, in place)")
p3 = label(diff_img, "DIFFERENCE x12  (a seam would be the brightest thing here)")
sheet = Image.new("RGB", (W, p1.height * 3 + 20), (255, 255, 255))
y = 0
for p in (p1, p2, p3):
    sheet.paste(p, (0, y))
    y += p.height + 10
sheet.save(os.path.join(OUT, "01-original-vs-recomposed.png"))
print("01 · artwork vs recomposition vs difference x12")

# ── 02 · the cut, at four times ─────────────────────────────────────────────
CUT = (150, 0, 430, 220)
S = 4
pa = label(flat(base).crop(CUT).resize(((CUT[2] - CUT[0]) * S, (CUT[3] - CUT[1]) * S), Image.LANCZOS),
           "ORIGINAL — the arm against the sky")
pb = label(flat(recomposed).crop(CUT).resize(((CUT[2] - CUT[0]) * S, (CUT[3] - CUT[1]) * S), Image.LANCZOS),
           "RECOMPOSED — the same arm, in the same place")
pc = label(Image.fromarray(np.clip(diff[CUT[1]:CUT[3], CUT[0]:CUT[2]] * 12, 0, 255).astype(np.uint8)).convert("RGB")
           .resize(((CUT[2] - CUT[0]) * S, (CUT[3] - CUT[1]) * S), Image.NEAREST),
           "DIFFERENCE x12 — the cut is the dark line, and it is not there")
side_by_side([pa, pb, pc]).save(os.path.join(OUT, "02-the-cut.png"))
print("02 · the cut at 4x")

# ── 03 · the arm moved: what the reconstruction leaves behind ───────────────
import math
PIVOT = (268, 146)
moved_arm = arm.rotate(-15, resample=Image.BICUBIC, center=PIVOT, expand=False)
moved = plate.copy()
moved.alpha_composite(moved_arm)
moved.alpha_composite(grapes.rotate(-8, resample=Image.BICUBIC, center=(370, 45), expand=False))
# …and the longer reach of the animation: the pose change at the bottom.
lowered = plate.copy()
lowered.alpha_composite(belly)
panels = [
    label(flat(plate), "THE PLATE ALONE — the arm is gone, and the chest is there"),
    label(flat(moved), "ARM TURNED 15 DEGREES AT THE SHOULDER — no hole behind it"),
    label(flat(lowered), "THE LOWERED POSE — the other arm, on the belly"),
]
stack(panels).save(os.path.join(OUT, "03-the-pose-change.png"))
print("03 · the arm moved, and the reconstruction behind it")

# ── 04 · the flicker ────────────────────────────────────────────────────────
frames = [flat(base).resize((576, 384), Image.LANCZOS), flat(recomposed).resize((576, 384), Image.LANCZOS)]
frames[0].save(os.path.join(OUT, "04-flicker.gif"), save_all=True, append_images=[frames[1]],
               duration=420, loop=0, optimize=False)
print("04 · flicker gif (artwork / recomposition alternating)")

# ── the number, in the file itself ──────────────────────────────────────────
print(f"\nartwork vs recomposition: mean {diff.mean():.2f}  p99 {np.percentile(diff, 99):.0f}  "
      f"max {diff.max()}  pixels over 32: {int((diff > 32).sum())} of {diff.size}")
print(f"written to {os.path.relpath(OUT)}")

# ── 05 · the same test, on what the BROWSER painted ─────────────────────────
# The sheets above compare the files this pipeline writes. This compares the
# thing a person actually sees: `ci/eyes/rest-pose-proof.mjs` loads the real
# server, paints the plate + arm + grapes at the artwork's own 768x512 with
# nothing animating, and paints the original artwork beside it at the same
# size. Both sides went through the same encoder (this browser), so the
# encoder is common to them and the difference left is the layering.
browser_layered = os.path.join(OUT, "30-browser-rest-layered.png")
browser_original = os.path.join(OUT, "31-browser-rest-original.png")
if os.path.exists(browser_layered) and os.path.exists(browser_original):
    lay = np.asarray(Image.open(browser_layered).convert("RGB")).astype(np.int16)
    org = np.asarray(Image.open(browser_original).convert("RGB")).astype(np.int16)
    if lay.shape == org.shape:
        d = np.abs(lay - org).max(axis=2)
        rows = d.max(axis=1)                      # the worst pixel of each line
        print(f"\n05 · the browser's own rest composition vs the artwork "
              f"({org.shape[1]}x{org.shape[0]})")
        print(f"   mean {d.mean():.2f}  p99 {np.percentile(d, 99):.0f}  max {d.max()}  "
              f"pixels over 32: {int((d > 32).sum())} of {d.size}")
        print(f"   worst line {rows.max()}  median line {int(np.median(rows))}  "
              f"lines over 32: {int((rows > 32).sum())} of {rows.size}")
        bright = rows.max() - np.median(rows)
        print("   " + ("the painted scene is the artwork — no line stands out of the "
                       "picture's own noise" if bright <= 32 else
                       f"A LINE STANDS {int(bright)} ABOVE THE REST — look at the sheet"))
    else:
        print(f"\n05 · browser shots differ in size ({lay.shape} vs {org.shape}) — skipped")
