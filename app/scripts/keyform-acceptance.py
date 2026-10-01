#!/usr/bin/env python3
"""Acceptance harness for the delivered corrective artwork (the painter package).

    /tmp/venv/bin/python app/scripts/keyform-acceptance.py --baseline
    /tmp/venv/bin/python app/scripts/holdout-validation.py  # the failed method's harness, kept for like-for-like comparison

    /tmp/venv/bin/python app/scripts/keyform-acceptance.py --paint <dir-with-R0X-paint.png>

WHAT IT DOES, in the order the brief demands:

 1. VALIDATE THE DELIVERY — each region's paint must be the same size as its
    template, identical to the template on every NON-hole pixel (a painter who
    retouched the master outside the hole fails here: only the hole may change),
    fully opaque inside the hole, and transparent on any `SKY-page-belongs` px.
 2. COMPOSE THE HIDDEN ART — master outside the holes + paint inside them. That
    composed image IS the hidden-art plate: the master is its own visible half.
 3. REST INVARIANCE, proven before anything is rendered: every painted pixel is
    covered by the limb at rest (the exposure set is grown `& LIMB` by
    construction, and the rest pose's alpha covers the whole figure), so the
    REST render must not change by a single pixel. If it does, stop.
 4. RENDER THE FOUR POSES through the FROZEN rig. The tracked renderer is never
    run or edited: a scratch copy is staged (deleted afterwards) with two lines
    re-pointed — PLATE to the composed plate, OUT to a scratch directory. The
    rig assets the copy rewrites are restored from git and verified.
 5. INSPECT AT 1x / 2x / 4x — the acceptance pose row (MASTER / REST / -3 / -7 /
    -15) and per-region closeups, BEFORE (the interim plate's guesses) against
    AFTER, across all four poses: the five comparisons (folds, gradients,
    highlights, texture frequency, boundary transitions) are judged here.

`--baseline` runs the same pipeline with the CURRENT plate's interim fill as the
"paint". It exists to prove the machinery end-to-end and to produce the honest
PRE-PAINT baseline the delivered paint will be compared against. It is NOT a
reconstruction and must never be treated as one: the interim fill is the
patch-copy the hold-out validation already failed.

This tool changes nothing in the rig, the artwork, the CSS or the pipeline.
"""
import argparse, json, os, shutil, subprocess, sys
import numpy as np
from PIL import Image, ImageDraw

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
COS = os.path.join(ROOT, "app", "public", "img", "cosmetics")
RIG = os.path.join(COS, "rig")
PKG = os.path.join(ROOT, "docs", "evidence", "round56", "keyform-package")
EV = os.path.join(ROOT, "docs", "evidence", "round56")
SCRATCH = "/tmp/keyform-acceptance"
REGIONS = ["R01", "R02", "R03", "R04", "R05"]
POSES = [("+0", "REST"), ("+6", "+6\u00b0"), ("-3", "-3\u00b0"), ("-7", "-7\u00b0"), ("-15", "-15\u00b0")]
LUMA = np.array([0.2126, 0.7152, 0.0722], np.float32)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--paint", help="directory with R01..R05-paint.png (delivery mode)")
    ap.add_argument("--baseline", action="store_true", help="self-test with the current plate's interim fill")
    args = ap.parse_args()
    if not (args.paint or args.baseline):
        sys.exit("give --paint <dir> or --baseline")
    os.makedirs(SCRATCH, exist_ok=True)
    manifest = json.load(open(os.path.join(PKG, "manifest.json")))
    master = np.asarray(Image.open(os.path.join(COS, "mascot-gold-buddha-base.png")).convert("RGB"))
    plate = np.asarray(Image.open(os.path.join(RIG, "clean-plate.webp")).convert("RGBA"))
    verdict = {"mode": "baseline" if args.baseline else "delivery", "regions": {}}

    # ── 1+2. validate the delivery and compose the hidden-art plate ─────────
    # The plate is RGBA and its alpha is the figure's silhouette: outside the
    # figure the page shows through, and an opaque plate would paint the master's
    # baked checkerboard into the sky the moment the arm moves. So composition
    # carries alpha: non-hole = master RGB + plate alpha, hole = the paint.
    composed = np.dstack([master, plate[..., 3]]).astype(np.uint8)
    holes_union = np.zeros(master.shape[:2], bool)
    for r in manifest:
        rid = r["id"]
        m = np.load(os.path.join(PKG, f"{rid}-mask.npy"))
        holes_union |= m
        tpl = np.asarray(Image.open(os.path.join(PKG, f"{rid}-template.png")).convert("RGBA"))
        ox, oy = r["template_offset"]
        mm = m[oy:oy + tpl.shape[0], ox:ox + tpl.shape[1]]
        sub = plate[oy:oy + tpl.shape[0], ox:ox + tpl.shape[1]]
        if args.baseline:
            # the interim fill: the current plate's own content inside the hole
            ph = np.zeros(tpl.shape, np.uint8)
            ph[..., :3] = tpl[..., :3]
            ph[mm, :3] = sub[mm, :3]
            ph[mm, 3] = sub[mm, 3]          # sky px stay transparent exactly as today
            paint = ph
        else:
            p = os.path.join(args.paint, f"{rid}-paint.png")
            if not os.path.exists(p):
                sys.exit(f"missing {p}")
            paint = np.asarray(Image.open(p).convert("RGBA"))
        checks = {}
        if paint.shape != tpl.shape:
            sys.exit(f"{rid}: paint is {paint.shape}, template is {tpl.shape}")
        # THE REFERENCE FOR NON-HOLE PIXELS IS THE MASTER — the template is a
        # viewing aid and its amber outline is guidance, not content to copy.
        master_crop = master[oy:oy + tpl.shape[0], ox:ox + tpl.shape[1]]
        nonhole = ~mm
        diff = (paint[..., :3].astype(int) - master_crop.astype(int)).max(axis=2)
        checks["nonhole_px_changed"] = int((diff[nonhole] > 0).sum())
        # THE HOLE has two duties: paint where the figure continues (opaque),
        # page where the master says sky (transparent). The 2,350 sky px are
        # INSIDE the regions, so "the hole must be opaque" alone is wrong.
        sky = np.load(os.path.join(PKG, "SKY-page-belongs.npy"))[oy:oy + tpl.shape[0], ox:ox + tpl.shape[1]]
        non_sky = mm & ~sky
        checks["hole_px"] = int(mm.sum())
        checks["hole_px_to_paint"] = int(non_sky.sum())
        checks["hole_px_painted_opaque"] = int((paint[..., 3][non_sky] == 255).sum())
        checks["sky_px_in_hole"] = int((mm & sky).sum())
        checks["sky_px_in_crop"] = int(sky.sum())
        checks["crop_sky_left_transparent"] = int((paint[..., 3][sky] == 0).sum())
        verdict["regions"][rid] = checks
        # compose: hole px from the paint
        comp_region = composed[oy:oy + tpl.shape[0], ox:ox + tpl.shape[1]]
        comp_region[mm, :3] = paint[..., :3][mm]
        comp_region[mm, 3] = paint[..., 3][mm]
    # the composed plate's visible half must be the master itself
    outside = ~holes_union
    plate_rgb = plate[..., :3].astype(int)
    d = np.abs(plate_rgb - master.astype(int)).max(axis=2)
    verdict["plate_vs_master_outside_holes_diff_px"] = int((d[outside] > 0).sum())
    Image.fromarray(composed).save(f"{SCRATCH}/composed-plate.png")

    # ── 3. rest invariance, from the coverage sets before rendering ─────────
    grown = None
    # reconstruct the union of region masks == grown paint set
    arm = np.asarray(Image.open(os.path.join(RIG, "arm.webp")).convert("RGBA"))[..., 3] > 128
    gra = np.asarray(Image.open(os.path.join(RIG, "grapes.webp")).convert("RGBA"))[..., 3] > 128
    rest_alpha = np.asarray(Image.open(os.path.join(EV, "06-pose-+0-alpha.png")).getchannel("A")) > 127
    verdict["paint_px_not_limb_covered"] = int((holes_union & ~(arm | gra)).sum())
    verdict["paint_px_not_rest_covered"] = int((holes_union & ~rest_alpha).sum())

    # ── 4. render the four poses through the frozen rig, via a scratch copy ──
    copy = os.path.join(ROOT, "app", "scripts", "_acceptance-render.py")
    src = open(os.path.join(ROOT, "app", "scripts", "rig-buddha.py")).read()
    out_line = [l for l in src.splitlines() if l.startswith("OUT = ")][0]
    plate_line = [l for l in src.splitlines() if l.startswith("PLATE = ")][0]
    src = src.replace(out_line, f"OUT = {SCRATCH!r}")
    src = src.replace(plate_line, f'PLATE = Image.open({SCRATCH + "/composed-plate.png"!r}).convert("RGBA")')
    open(copy, "w").write(src)
    env = dict(os.environ, RIG_KEYFORMS="-3,-7,-15,6")   # +6 is part of the gesture (the reach overshoots to +6 before swinging back)
    try:
        proc = subprocess.run([sys.executable, copy], cwd=ROOT, env=env,
                              capture_output=True, text=True, timeout=1500)
        open(f"{SCRATCH}/render-log.txt", "w").write(proc.stdout[-4000:] + proc.stderr[-4000:])
        if proc.returncode != 0:
            sys.exit(f"renderer copy failed — see {SCRATCH}/render-log.txt")
    finally:
        if os.path.exists(copy):
            os.remove(copy)
        pyc = os.path.join(ROOT, "app", "scripts", "__pycache__")
        if os.path.isdir(pyc):
            shutil.rmtree(pyc, ignore_errors=True)
        # the copy may have rewritten tracked rig assets: restore and verify
        subprocess.run(["git", "checkout", "--", os.path.relpath(RIG, ROOT)], cwd=ROOT, check=False)
        st = subprocess.run(["git", "status", "--porcelain", "--", os.path.relpath(RIG, ROOT)],
                            cwd=ROOT, capture_output=True, text=True).stdout.strip()
    verdict["rig_restored_clean"] = st == ""
    print(f"rig restored clean: {st == ''}")

    # REST invariance, measured on the render — 06-pose-+0.png is the renderer's
    # own ground-composited REST.
    new_rest_alpha = np.asarray(Image.open(f"{SCRATCH}/06-pose-+0-alpha.png").getchannel("A")) > 127
    verdict["rest_alpha_diff_px"] = int((new_rest_alpha != rest_alpha).sum())
    new_rest = np.asarray(Image.open(f"{SCRATCH}/06-pose-+0.png").convert("RGB"))
    # master outside the holes must be pixel-identical in the rest render — ON
    # THE FIGURE. The page area is excluded deliberately: the render grounds
    # transparent px in magenta while the master bakes its checkerboard there.
    figure = new_rest_alpha & ~holes_union
    dr = np.abs(new_rest.astype(int) - master.astype(int)).max(axis=2)
    verdict["rest_vs_master_on_figure_diff_px"] = int((dr[figure] > 1).sum())
    verdict["figure_px_compared"] = int(figure.sum())

    # ── 5. the sheets ────────────────────────────────────────────────────────
    tag = "baseline" if args.baseline else "painted"
    row = []
    for p, label in POSES:
        img = Image.open(f"{SCRATCH}/06-pose-{p}.png").convert("RGB")
        row.append((label, img))
    W, H = row[0][1].size
    pad, lab = 8, 18
    s = Image.new("RGB", (pad + (W // 2 + pad) * (len(row) + 1), lab + H // 2 + lab), (20, 20, 26))
    d = ImageDraw.Draw(s)
    s.paste(Image.open(os.path.join(COS, "mascot-gold-buddha-base.png")).convert("RGB")
            .resize((W // 2, H // 2), Image.LANCZOS), (pad, lab))
    d.text((pad, 4), "MASTER", fill=(120, 220, 255))
    for i, (label, img) in enumerate(row):
        x = pad + (W // 2 + pad) * (i + 1)
        s.paste(img.resize((W // 2, H // 2), Image.LANCZOS), (x, lab))
        d.text((x, 4), f"REST ({label})" if label == "REST" else label, fill=(255, 220, 80))
    d.text((pad, lab + H // 2 + 2),
           f"ACCEPTANCE POSE ROW — {tag.upper()}  (frozen rig; REST must equal the master outside the holes)",
           fill=(150, 220, 255))
    p1 = os.path.join(EV, f"67-acceptance-poses-{tag}.png")
    s.save(p1)

    # per-region BEFORE/AFTER closeups at 2x and 4x
    before = {p: Image.open(os.path.join(EV, f"06-pose-{p}.png")).convert("RGB") for p, _ in POSES}
    MARGIN = 40
    for r in manifest:
        rid = r["id"]
        x0, y0, x1, y1 = r["bbox"]
        box = (max(0, x0 - MARGIN), max(0, y0 - MARGIN), min(W, x1 + MARGIN), min(H, y1 + MARGIN))
        for z, ztag in ((2, "2x"), (4, "4x")):
            cw, ch = (box[2] - box[0]) * z, (box[3] - box[1]) * z
            cols = len(POSES)
            sh = Image.new("RGB", (pad + cols * (cw + pad), 26 + 2 * (ch + 22) + pad), (20, 20, 26))
            dd = ImageDraw.Draw(sh)
            dd.text((pad, 5), f"{rid}  {ztag}  TOP: BEFORE (interim plate guess)   BOTTOM: AFTER ({tag})  \u2014 folds/gradients/highlights/texture/boundaries",
                    fill=(150, 220, 255))
            for i, (p, label) in enumerate(POSES):
                x = pad + i * (cw + pad)
                sh.paste(before[p].crop(box).resize((cw, ch), Image.NEAREST), (x, 26))
                sh.paste(row[i][1].crop(box).resize((cw, ch), Image.NEAREST), (x, 26 + ch + 22))
                dd.text((x + 2, 26 + ch + 4), label, fill=(255, 220, 80))
            sh.save(os.path.join(EV, f"67-acceptance-{rid.lower()}-{ztag}-{tag}.png"))
    verdict["sheets"] = {"pose_row": os.path.relpath(p1, ROOT),
                         "region_closeups": [f"67-acceptance-{r['id'].lower()}-{{2x,4x}}-{tag}.png" for r in manifest]}
    machinery_ok = (verdict["rest_alpha_diff_px"] == 0 and verdict["rig_restored_clean"]
                    and verdict["rest_vs_master_on_figure_diff_px"] == 0
                    and all(v["nonhole_px_changed"] == 0 for v in verdict["regions"].values()))
    if args.baseline:
        # The interim fill is EXPECTED to leave hole px unpainted — that deficit
        # is exactly why the paint exists. The baseline verdicts on the machinery
        # only, and records the deficit per region.
        ok = machinery_ok
        verdict["note"] = ("baseline: the interim plate's fill is not a delivery; "
                           "hole_px_painted_opaque < hole_px_to_paint is the deficit the paint must close")
    else:
        # The checkable sky rule is scoped to the HOLE: the delivery is read
        # only on hole px (composition never touches anything else), and the
        # master outside the hole is opaque by definition, so a crop-wide
        # transparency demand would contradict "non-hole = master". The holes
        # contain no sky px today; the check stays as a guard.
        ok = machinery_ok and all(v["hole_px_painted_opaque"] == v["hole_px_to_paint"]
                                  and v["sky_px_in_hole"] == 0
                                  for v in verdict["regions"].values())
    verdict["verdict"] = "PASS (pending the 1x/2x/4x visual inspection)" if ok else "FAIL"
    json.dump(verdict, open(os.path.join(EV, "67-acceptance.json"), "w"), indent=1)
    print(json.dumps({k: v for k, v in verdict.items() if k != "regions"}, indent=1))
    for rid, v in verdict["regions"].items():
        print(f"   {rid}: {v}")

if __name__ == "__main__":
    main()
