#!/usr/bin/env python3
"""Assemble the ARTIST-KIT: one self-contained folder a human painter opens and
works from. No reconstruction, no detection — packaging only.

    /tmp/venv/bin/python app/scripts/artist-kit.py

Produces docs/evidence/round56/keyform-package/ARTIST-KIT/ :
  R0X-work-4x.png          4x nearest-neighbour working canvas: master surround,
                           the hole fully transparent, amber edge on the hole
  R0X-guide.png            the measured ramp swatches + the must-continue
                           structures for that region, burned in as text
  HOW-TO-PAINT.md          the working method, brush guidance traced from the
                           master, unresolved marking, delivery naming
The references (R0X-reference-2x.png) and masks stay in the package; the kit
links them by name.
"""
import json, os
import numpy as np
from PIL import Image, ImageDraw

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
COS = os.path.join(ROOT, "app", "public", "img", "cosmetics")
PKG = os.path.join(ROOT, "docs", "evidence", "round56", "keyform-package")
KIT = os.path.join(PKG, "ARTIST-KIT")

MUST = {
 "R01": ["the jaw/chin CONTACT SHADOW (traced: core lum 56->34 double-dip, warm hue ~1:0.55:0.02, ~8px falloff, bounced-light shoulder ~79 lum between dips)",
         "the chest/chin skin gradient (rim anchors: DELIVERY/AUTHORED-STROKES.json, 31 rows)",
         "the cheek/jaw specular band where it enters from the right rim",
         "the berry shades hugging the grape rim (left side)"],
 "R02": ["the dark GAP shadow behind the arm's back edge (traced at y=320: plateau lum ~45-80 hugging the arm edge ~40% of the width, then a smooth rise to the torso rim)"],
 "R03": ["a symmetric dark LENS between stem, wrist and cheek: both rims dark gold, centre darker than either, no highlights anywhere near"],
 "R04": ["the bright skin gradient, continued (rim luma 178-239, no strong edges)",
         "rows y72-73 have NO left rim (sky-bounded): decide from the rows above/below, or mark unresolved"],
 "R05": ["bright gold continuation only (rim luma 193-251)"],
}
BRUSH = {
 "R01": "contact shadow: hard-ish round, ~8-9 px at 1x, opacity ~70% core / 0 at 12px; skin: soft round, wide, low opacity, follow the rim anchors per row",
 "R02": "gap: soft round ~45-60 lum plateau hugging the left (arm) rim for ~40% of the width, then one smooth rise to the right rim; no texture",
 "R03": "dark lens: soft round, dip the centre to ~55% of the darker rim, symmetric falloff",
 "R04": "bright gradient: soft round, very low opacity, let the rims meet",
 "R05": "bright gold: soft round, one pass",
}

def main():
    os.makedirs(KIT, exist_ok=True)
    master = Image.open(os.path.join(COS, "mascot-gold-buddha-base.png")).convert("RGB")
    man = {r["id"]: r for r in json.load(open(os.path.join(PKG, "manifest.json")))}
    for rid, r in man.items():
        m = np.load(os.path.join(PKG, rid + "-mask.npy"))
        tpl = np.asarray(Image.open(os.path.join(PKG, rid + "-template.png")).convert("RGBA"))
        ox, oy = r["template_offset"]
        mm = m[oy:oy + tpl.shape[0], ox:ox + tpl.shape[1]]
        # 4x working canvas
        c = tpl.copy()
        inner = mm & np.roll(mm, 1, 0) & np.roll(mm, -1, 0) & np.roll(mm, 1, 1) & np.roll(mm, -1, 1)
        c[mm & ~inner] = (255, 170, 0, 255)
        c[mm] = (0, 0, 0, 0)
        w, h = tpl.shape[1], tpl.shape[0]
        Image.fromarray(c).resize((w * 4, h * 4), Image.NEAREST).save(os.path.join(KIT, rid + "-work-4x.png"))
        # guide sheet
        gw = min(w * 4, 900)
        s = Image.new("RGB", (gw, 620), (24, 24, 30))
        d = ImageDraw.Draw(s)
        d.text((10, 8), rid + " — " + r.get("reference", rid + "-reference-2x.png"), fill=(150, 220, 255))
        d.text((10, 26), "px to paint: %d    bbox x%d y%d - x%d y%d    opens at: %s" % (
            r["px"], r["bbox"][0], r["bbox"][1], r["bbox"][2], r["bbox"][3],
            ", ".join(f"{k} {v}px" for k, v in r["exposed_at"].items())), fill=(200, 200, 210))
        y = 52
        d.text((10, y), "MUST CONTINUE (traced from the master):", fill=(80, 240, 160)); y += 18
        for item in MUST[rid]:
            for line in [item[i:i + 110] for i in range(0, len(item), 110)]:
                d.text((24, y), line, fill=(230, 230, 235)); y += 16
        y += 8
        d.text((10, y), "MEASURED RAMP (rim luma, shadow -> highlight):", fill=(80, 240, 160)); y += 18
        x0 = 24
        for stop in r["ramp_master_measured"]:
            sw = Image.new("RGB", (70, 40), tuple(int(v) for v in
                (np.array(stop["rgb"]))))
            s.paste(sw, (x0, y))
            d.text((x0, y + 42), "%s %d" % (stop["stop"], stop["luma"]), fill=(200, 200, 210))
            x0 += 84
        y += 74
        d.text((10, y), "BRUSH GUIDANCE (traced):", fill=(80, 240, 160)); y += 18
        for line in [BRUSH[rid][i:i + 110] for i in range(0, len(BRUSH[rid]), 110)]:
            d.text((24, y), line, fill=(230, 230, 235)); y += 16
        y += 8
        d.text((10, y), "UNRESOLVED: any pixel you judge under-determined -> leave FULLY", fill=(255, 170, 90)); y += 16
        d.text((10, y), "TRANSPARENT and list it in R0X-unresolved.png (white=unresolved).", fill=(255, 170, 90)); y += 16
        d.text((10, y), "An opaque fabricated pixel is a failure; a declared unresolved pixel is not.", fill=(255, 170, 90))
        s.save(os.path.join(KIT, rid + "-guide.png"))
    readme = """# ARTIST KIT — R01–R05 corrective keyforms

Open each region's `R0X-work-4x.png` in your editor. Paint only inside the
transparent hole. The references: `../R0X-reference-2x.png` (surround at 2x),
`R0X-guide.png` (must-continue structures, measured ramp, brush guidance),
`../manifest.json` (per-row rim anchors in DELIVERY/AUTHORED-STROKES.json).

The one rule: **the master is the sole reference** — its gold, its shadow hue,
its edge sharpness. Continue what the references show crossing the hole.
Anything you judge under-determined: leave FULLY TRANSPARENT and record the
pixels in `R0X-unresolved.png` (white = unresolved, same size as the work
canvas). Never fill to satisfy a checker.

## Deliver

    R0X-paint.png       same size/offset as R0X-work-4x content (save at 1x:
                        the hole painted opaque, unresolved px transparent,
                        every non-hole pixel EXACTLY the master's)
    R0X-unresolved.png  (only if you deferred pixels) white = unresolved

## Then

    /tmp/venv/bin/python app/scripts/keyform-acceptance.py --paint <dir> --unresolved-ok

Deferred px are reported and shown green-on-magenta on the sheets (never
hidden); the five-comparison inspection at 1x/2x/4x across REST/+6/-3/-7/-15
is the real gate. No production wiring until the full acceptance passes.
"""
    open(os.path.join(KIT, "HOW-TO-PAINT.md"), "w").write(readme)
    print("ARTIST-KIT written:", sorted(os.listdir(KIT)))

if __name__ == "__main__":
    main()
