#!/usr/bin/env python3
"""WIP preview: render the five acceptance poses with a painter's work-in-progress
paint for ONE region composited over the CURRENT plate. Not acceptance — a fast
feedback loop so the painter can judge continuity in motion while working.

    /tmp/venv/bin/python app/scripts/artist-preview.py --region R01 --paint <file-or-dir>

Honours painter-declared unresolved px (R0X-unresolved.npy / -unresolved.png):
they render GREEN-ON-MAGENTA so nothing fabricated can hide. Output:
docs/evidence/round56/71-wip-<region>-poses.png (REST/+6/-3/-7/-15 at 1x) plus
2x crops of the region. No tracked asset is touched.
"""
import argparse, json, os, shutil, subprocess, sys
import numpy as np
from PIL import Image, ImageDraw

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
COS = os.path.join(ROOT, "app", "public", "img", "cosmetics")
RIG = os.path.join(COS, "rig")
PKG = os.path.join(ROOT, "docs", "evidence", "round56", "keyform-package")
EV = os.path.join(ROOT, "docs", "evidence", "round56")
SCRATCH = "/tmp/artist-preview"
POSES = [("+0", "REST"), ("+6", "+6"), ("-3", "-3"), ("-7", "-7"), ("-15", "-15")]

def find_unresolved(rid, paint_dir):
    for cand in (os.path.join(paint_dir, rid + "-unresolved.npy"),
                 os.path.join(paint_dir, rid + "-unresolved.png")):
        if os.path.exists(cand):
            if cand.endswith(".npy"):
                return np.load(cand) > 0
            return np.asarray(Image.open(cand).convert("L")) > 127
    return None

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--region", required=True)
    ap.add_argument("--paint", required=True, help="file (R0X-paint.png) or directory holding it")
    args = ap.parse_args()
    rid = args.region
    p = args.paint if os.path.isfile(args.paint) else os.path.join(args.paint, rid + "-paint.png")
    if not os.path.exists(p):
        sys.exit("no paint at " + p)
    m = np.load(os.path.join(PKG, rid + "-mask.npy"))
    tpl = np.asarray(Image.open(os.path.join(PKG, rid + "-template.png")).convert("RGBA"))
    ox, oy = json.load(open(os.path.join(PKG, "manifest.json"))) and \
        [r for r in json.load(open(os.path.join(PKG, "manifest.json"))) if r["id"] == rid][0]["template_offset"]
    paint = np.asarray(Image.open(p).convert("RGBA"))
    if paint.shape != tpl.shape:
        sys.exit(f"paint shape {paint.shape} != template {tpl.shape}")
    mm = m[oy:oy + tpl.shape[0], ox:ox + tpl.shape[1]]
    plate = np.asarray(Image.open(os.path.join(RIG, "clean-plate.webp")).convert("RGBA")).copy()
    # composite ONLY hole px; the painter's deferred px stay as the plate is today
    # AND are remembered for the green-on-magenta display
    comp = plate.copy()
    comp[m] = 0
    region = np.zeros_like(plate)
    region[oy:oy + tpl.shape[0], ox:ox + tpl.shape[1], :3][mm] = paint[..., :3][mm]
    region[oy:oy + tpl.shape[0], ox:ox + tpl.shape[1], 3][mm] = paint[..., 3][mm]
    alpha = region[..., 3:4].astype(np.float32) / 255.0
    comp = (region * alpha + comp * (1 - alpha)).astype(np.uint8)
    unres = find_unresolved(rid, os.path.dirname(p))
    os.makedirs(SCRATCH, exist_ok=True)
    Image.fromarray(comp).save(f"{SCRATCH}/composed.png")
    copy = os.path.join(ROOT, "app", "scripts", "_wip-render.py")
    src = open(os.path.join(ROOT, "app", "scripts", "rig-buddha.py")).read()
    src = src.replace([l for l in src.splitlines() if l.startswith("OUT = ")][0], f"OUT = {SCRATCH!r}")
    src = src.replace([l for l in src.splitlines() if l.startswith("PLATE = ")][0],
                      f'PLATE = Image.open({SCRATCH + "/composed.png"!r}).convert("RGBA")')
    open(copy, "w").write(src)
    env = dict(os.environ, RIG_KEYFORMS="-3,-7,-15,6")
    try:
        proc = subprocess.run([sys.executable, copy], cwd=ROOT, env=env,
                              capture_output=True, text=True, timeout=1500)
        if proc.returncode != 0:
            sys.exit("renderer copy failed:\n" + proc.stderr[-1500:])
    finally:
        if os.path.exists(copy):
            os.remove(copy)
        subprocess.run(["git", "checkout", "--", os.path.relpath(RIG, ROOT)], cwd=ROOT, check=False)
        st = subprocess.run(["git", "status", "--porcelain", "--", os.path.relpath(RIG, ROOT)],
                            cwd=ROOT, capture_output=True, text=True).stdout.strip()
    if st:
        sys.exit("rig not restored — investigate before anything else")
    W, H = Image.open(f"{SCRATCH}/06-pose-+0.png").size
    row = []
    for pose, label in POSES:
        im = Image.open(f"{SCRATCH}/06-pose-{pose}.png").convert("RGB")
        if unres is not None:
            a = np.asarray(im).copy()
            a[unres] = [0, 255, 0]
            im = Image.fromarray(a)
        row.append((label, im))
    pad = 8
    s = Image.new("RGB", (pad + (W // 2 + pad) * len(row), H // 2 + 30), (20, 20, 26))
    d = ImageDraw.Draw(s)
    for i, (label, im) in enumerate(row):
        s.paste(im.resize((W // 2, H // 2), Image.LANCZOS), (pad + (W // 2 + pad) * i, 22))
        d.text((pad + (W // 2 + pad) * i, 6), label, fill=(255, 220, 80))
    d.text((pad, H // 2 + 6),
           f"WIP {rid} — unresolved px shown GREEN (never hidden) — judge folds/gradients/highlights/texture/boundaries",
           fill=(150, 220, 255))
    s.save(os.path.join(EV, f"71-wip-{rid.lower()}-poses.png"))
    # 2x crop of the region across poses
    x0, y0, x1, y1 = [r for r in json.load(open(os.path.join(PKG, "manifest.json"))) if r["id"] == rid][0]["bbox"]
    M = 48
    box = (max(0, x0 - M), max(0, y0 - M), min(W, x1 + M), min(H, y1 + M))
    cw, ch = (box[2] - box[0]) * 2, (box[3] - box[1]) * 2
    s2 = Image.new("RGB", (pad + len(row) * (cw + pad), 30 + ch + 26), (20, 20, 26))
    d2 = ImageDraw.Draw(s2)
    for i, (label, im) in enumerate(row):
        s2.paste(im.crop(box).resize((cw, ch), Image.NEAREST), (pad + i * (cw + pad), 26))
        d2.text((pad + i * (cw + pad), 6), label, fill=(255, 220, 80))
    s2.save(os.path.join(EV, f"71-wip-{rid.lower()}-crops-2x.png"))
    print(f"wrote 71-wip-{rid.lower()}-poses.png and 71-wip-{rid.lower()}-crops-2x.png")
    if unres is not None:
        print(f"declared unresolved px for {rid}: {int(unres.sum()):,} (shown green)")
    print("rig restored clean:", st == "")

if __name__ == "__main__":
    main()
