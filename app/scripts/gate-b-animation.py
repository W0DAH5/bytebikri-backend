#!/usr/bin/env python3
"""GATE B — does it MOVE right? The sheet, for a person to look at.

    python3 app/scripts/gate-b-animation.py            (after rig-buddha.py)

Gate A (gate-a-artwork.py) asks whether the drawing is still the drawing. This is
the other gate, and the brief is explicit that one must not excuse the other: an
intact picture that tears at the shoulder fails Gate B, and a smooth deformation
of a blurred picture fails Gate A.

The checklist, and which side measures what:

  1. no shoulder gap ................. this sheet, the joint at 1:1 and 2:1
  2. no ripped cutout edge ........... this sheet (4x) + the rig's edge measurement
  3. no collapsing arm ............... rig-qa.py: limb width per pose
  4. no necklace discontinuity ....... this sheet, the necklace across the rebuild
  5. no impossible elbow ............. rig-qa.py: bend against the drawing's 22 deg budget
  6. no lighting discontinuity ....... the art script's seam measurement
  7. no exposed missing pixels ....... the rig's coverage sweep at 4x
  8. no gold tearing ................. rig-qa.py: gradient energy per pose

The diagnostic thumbnails are 300 px wide, and a shoulder gap is two pixels. This
sheet is the same poses at a size where the checklist can actually be seen.
"""
import json
import os

from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.dirname(HERE)
DIR = os.path.join(APP, "public", "img", "cosmetics")
RIG = os.path.join(DIR, "rig")
OUT = os.path.normpath(os.path.join(APP, "..", "docs", "evidence", "round56"))

POSES = [(0.0, "REST  0 deg"), (-15.0, "-15 deg"), (-7.0, "-7 deg"), (6.0, "+6 deg")]
CROPS = [
    ("the shoulder joint, 1:1", (470, 130, 750, 430), 1),
    ("the hand and the fruit, 1:1", (620, 0, 900, 260), 1),
    ("the shoulder joint, 2x", (520, 180, 700, 360), 2),
]
STAGE = (253, 253, 253, 255)


def pose_file(deg):
    tag = "+0" if deg == 0 else f"{deg:+.0f}"
    return os.path.join(OUT, f"06-pose-{tag}.png")


def main():
    master = Image.open(os.path.join(DIR, "mascot-gold-buddha-base.png")).convert("RGBA")
    poses = []
    for deg, label in POSES:
        fn = pose_file(deg)
        if not os.path.exists(fn):
            print(f"   missing {os.path.basename(fn)} — run rig-buddha.py first")
            return 1
        poses.append((label, Image.open(fn).convert("RGBA")))

    def on_stage(im):
        base = Image.new("RGBA", im.size, STAGE)
        base.alpha_composite(im)
        return base.convert("RGB")

    rows = []
    for name, box, z in CROPS:
        tiles = []
        for label, im in poses:
            t = on_stage(im).crop(box)
            if z != 1:
                t = t.resize((t.width * z, t.height * z), Image.NEAREST)
            tiles.append((label, t))
        mref = master.convert("RGB").crop(box)
        if mref.size != tiles[0][1].size:
            mref = mref.resize(tiles[0][1].size, Image.NEAREST)
        rows.append((name, mref, tiles))

    pad, lab = 10, 20
    # One column per pose, sized to the widest tile in ANY row for that pose: a
    # sheet whose later columns fall off the canvas is not evidence of anything.
    master_w = max(r[1].width for r in rows)
    pose_w = [max(r[2][i][1].width for r in rows if i < len(r[2]))
              for i in range(len(poses))]
    rowh = [max([r[1].height] + [t[1].height for t in r[2]]) for r in rows]
    W = pad + master_w + pad + sum(w + pad for w in pose_w)
    H = lab + sum(h + lab + pad for h in rowh)
    sheet = Image.new("RGB", (W, H), (24, 24, 28))
    d = ImageDraw.Draw(sheet)
    d.text((10, 4), "GATE B — the poses: MASTER, then REST / -15 / -7 / +6 degrees.  The pose tiles are "
                    "flattened on magenta, so a gap in the figure shows MAGENTA and a pale rim shows "
                    "as a fringe.", fill=(150, 220, 255))
    y = lab
    for (name, mref, tiles), rh in zip(rows, rowh):
        x = pad
        d.text((x + 2, y), "MASTER", fill=(80, 240, 160))
        sheet.paste(mref, (x, y + 14))
        x += master_w + pad
        for i, (label, t) in enumerate(tiles):
            d.text((x + 2, y), label, fill=(255, 180, 120))
            sheet.paste(t, (x, y + 14))
            x += pose_w[i] + pad
        d.text((pad + 2, y + 14 + rh + 2), name, fill=(255, 220, 80))
        y += rh + lab + pad

    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, "23-gate-b-poses.png")
    sheet.save(path)
    print(f"   GATE B sheet → {path}   ({sheet.width}x{sheet.height})")

    rig = json.load(open(os.path.join(RIG, "buddha-rig.json")))
    regions = json.load(open(os.path.join(RIG, "regions.json")))
    keys = [k for k in rig if any(t in k for t in ("coverage", "elbow", "width", "gradient", "edge"))]
    print("\n   the measured side of the checklist, from the rig's own run:")
    for k in sorted(keys):
        v = rig[k]
        s = json.dumps(v, default=str)
        print(f"     {k}: {s[:150]}{'…' if len(s) > 150 else ''}")
    print(f"     reconstructed pixels a painter still owes: "
          f"{regions['generated']['exemplar_fill_pixels']:,}")
    with open(os.path.join(OUT, "23-gate-b-poses.json"), "w") as fh:
        json.dump({k: rig[k] for k in keys} | {
            "reconstructed_pixels_owed": regions["generated"]["exemplar_fill_pixels"],
            "sheet": "23-gate-b-poses.png"}, fh, indent=2, default=str)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
