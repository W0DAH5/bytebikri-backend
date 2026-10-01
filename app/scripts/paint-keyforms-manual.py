#!/usr/bin/env python3
"""Execute the AUTHORED keyform artwork (docs/evidence/round56/keyform-package/
DELIVERY/AUTHORED-STROKES.json). This file draws nothing that is not authored:
the control rows and their traced rim colours are the base artwork; the
structure overlays below are hand-set specs traced from named master structures
(provenance in REJECTION-RECORD.md and the session record). Unresolved areas —
where the master gives no evidence for the structure that should continue — are
left TRANSPARENT in the paint files and flagged, never forced opaque.

    /tmp/venv/bin/python app/scripts/paint-keyforms-manual.py            # execute the authored artwork
"""
import json, os
import numpy as np
from PIL import Image

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
COS = os.path.join(ROOT, "app", "public", "img", "cosmetics")
PKG = os.path.join(ROOT, "docs", "evidence", "round56", "keyform-package")
DEL = os.path.join(PKG, "DELIVERY")

# ── AUTHORED STRUCTURE SPECS (hand-set; each traces a named master structure) ─
OCCLUSION = {   # the jaw/chin contact shadow, traced at x=860, y343-376:
                # double-dip core lum 56->34, warm hue ~1:0.55:0.02, ~8px falloff
    "regions": ["R01"],
    "side": "right",                # hugs the face-side rim
    "rim_x_min": 780,               # only where the right rim is the face (authored)
    "width": 8,
    "profile": [(0, 0.75), (2, 0.95), (4, 1.0), (6, 0.85), (9, 0.35), (12, 0.0)],
    "hue": [75.0, 41.0, 1.0],       # traced core rgb; scaled to local brightness
    "only_darken": True,
}
GAP = {         # the arm back-edge gap, traced at y=320: dark plateau then rise
    "regions": ["R02"],
    "side": "left", "plateau": 0.40, "lum": 62.0, "rise_pow": 1.5,
}
LENS = {        # R03: both rims dark, no highlights — a shadow lens (authored)
    "regions": ["R03"], "mid_scale": 0.55, "blend_pow": 1.3,
}
UNRESOLVED_RULE = {
    # authored judgement per region (not a detector):
    "grape_rim_band_px": {"R01": 10},   # berry shades continue here — too specific to continue honestly
    "sky_rim_rows": True,               # a row whose rim is page has no art evidence on that side
}

def execute():
    master = np.asarray(Image.open(os.path.join(COS, "mascot-gold-buddha-base.png")).convert("RGB")).astype(np.float32)
    al = np.asarray(Image.open(os.path.join(COS, "master-alpha.png")))
    MATTE = (al > 127) if al.max() > 1 else (al > 0.5)
    GRA = np.asarray(Image.open(os.path.join(COS, "rig", "grapes.webp")).convert("RGBA"))[..., 3] > 128
    auth = json.load(open(os.path.join(DEL, "AUTHORED-STROKES.json")))
    holes_any = np.zeros(MATTE.shape, bool)
    for rr in ("R01", "R02", "R03", "R04", "R05"):
        holes_any |= np.load(os.path.join(PKG, rr + "-mask.npy"))
    man = {r["id"]: r for r in json.load(open(os.path.join(PKG, "manifest.json")))}
    prov = {"executor": "app/scripts/paint-keyforms-manual.py (draws only authored artwork)",
            "authored": "DELIVERY/AUTHORED-STROKES.json + the hand-set specs in this file",
            "regions": {}}
    for rid in ("R01", "R02", "R03", "R04", "R05"):
        m = np.load(os.path.join(PKG, rid + "-mask.npy"))
        ctrl = auth[rid]["control_rows"]
        out = master.copy()
        unresolved = np.zeros(m.shape, bool)
        H, W = m.shape
        ys = np.unique(np.nonzero(m)[0])
        # ── base stage, authoring revision 3: coherent endpoint tracks ────────
        # Traced rims per hole row, then smoothed ALONG the passage (the stroke
        # is a dragged vertical, not per-row dabs — revision 1/2 banded at 4x
        # because each row's rims jump with whatever berry/cheek it hits).
        rows = list(ys)
        raw = []
        for y in rows:
            xs = np.nonzero(m[y])[0]
            x0, x1 = int(xs[0]), int(xs[-1])
            lf = rf = None
            for k in range(1, 12):
                if lf is None and x0 - k >= 0 and MATTE[y, x0 - k] and not holes_any[y, x0 - k]:
                    lf = [float(v) for v in master[y, x0 - k]]
                if rf is None and x1 + k < W and MATTE[y, x1 + k] and not holes_any[y, x1 + k]:
                    rf = [float(v) for v in master[y, x1 + k]]
            raw.append((y, x0, x1, lf, rf))
        # split into contiguous row spans (gap > 3 rows starts a new span)
        spans, cur = [], [raw[0]]
        for prev, r in zip(raw, raw[1:]):
            if r[0] - prev[0] > 3:
                spans.append(cur); cur = [r]
            else:
                cur.append(r)
        spans.append(cur)
        def smooth_track(vals, sigma=4.0):
            vals = np.array([v if v is not None else [np.nan, np.nan, np.nan] for v in vals], np.float32)
            n = len(vals)
            idx = np.arange(n)
            out = vals.copy()
            for c in range(3):
                col = vals[:, c]
                good = ~np.isnan(col)
                if good.sum() == 0:
                    out[:, c] = 120.0
                    continue
                if good.sum() < n:                      # fill gaps from nearest good
                    out[~good, c] = np.interp(idx[~good], idx[good], col[good])
                k = int(max(1, sigma * 3))
                xs_ = np.arange(-k, k + 1)
                g = np.exp(-0.5 * (xs_ / sigma) ** 2); g /= g.sum()
                pad = np.pad(out[:, c], k, mode="edge")
                out[:, c] = np.convolve(pad, g, mode="valid")
            return out
        def is_pageblend(rgb):
            r, g, b = rgb
            return (r + g + b) / 3 > 195 and (max(r, g, b) - min(r, g, b)) < 70
        def sanitize(track):
            bad = [i for i, v in enumerate(track) if is_pageblend(v)]
            if bad and len(bad) < len(track):
                good = [i for i in range(len(track)) if i not in bad]
                for c in range(3):
                    col = track[:, c]
                    col[bad] = np.interp(bad, good, col[good])
            return track
        for span in spans:
            Ltr = sanitize(smooth_track([r[3] for r in span]))
            Rtr = sanitize(smooth_track([r[4] for r in span]))
            if any(r[3] is None for r in span) or any(r[4] is None for r in span):
                for r in span:                          # a sky rim: no art evidence
                    if r[3] is None or r[4] is None:
                        unresolved[r[0], np.nonzero(m[r[0]])[0]] = True
            for i, (y, x0, x1, lf, rf) in enumerate(span):
                L0, R0 = Ltr[i], Rtr[i]
                if lf is None or rf is None:
                    continue
                for x in np.nonzero(m[y])[0]:
                    w = (x - x0) / max(1, x1 - x0)
                    out[y, x] = L0 * (1 - w) + R0 * w
        # authored structure overlays
        if rid in OCCLUSION["regions"]:
            prof = OCCLUSION["profile"]
            def pv(d):
                for (d0, v0), (d1, v1) in zip(prof, prof[1:]):
                    if d0 <= d <= d1:
                        return v0 + (d - d0) / (d1 - d0) * (v1 - v0)
                return 0.0
            yy, xx = np.nonzero(m)
            for y, x in zip(yy, xx):
                xs = np.nonzero(m[y])[0]
                rx = xs[-1]
                ca = [c for c in ctrl if c["y"] <= y]
                ca = ca[-1] if ca else ctrl[0]
                ra = ca["right"]
                if ra is None or ra["x"] < OCCLUSION["rim_x_min"] or ra["grapes"]:
                    continue
                # authored revision 2: only where the face rim is genuinely in
                # contact shadow (dark rim), and the shadow can never invert a
                # bright rim into a saturated stripe
                rim_l = float(np.mean(master[y, ra["x"]]))
                if rim_l > 185:
                    continue
                d = rx - x
                if d > OCCLUSION["width"]:
                    continue
                rows_all = [c["y"] for c in ctrl]
                frac = (y - min(rows_all)) / max(1, max(rows_all) - min(rows_all))
                wgt = pv(d) * 0.85 * (0.60 + 0.40 * min(1.0, frac * 2.0))
                base = out[y, x]
                scale = min(float(base.sum()), 300.0) / sum(OCCLUSION["hue"])
                hue = np.array(OCCLUSION["hue"]) * scale
                v = base * (1 - wgt) + hue * wgt
                v = np.maximum(v, base * 0.55)          # never darker than 55% of base
                out[y, x] = np.minimum(v, base) if OCCLUSION["only_darken"] else v
            # authored unresolved: the grape-rim band (berry shades)
            n = UNRESOLVED_RULE["grape_rim_band_px"].get(rid, 0)
            if n:
                yy, xx = np.nonzero(m)
                for y, x in zip(yy, xx):
                    xs = np.nonzero(m[y])[0]
                    lx = xs[0]
                    ca = [c for c in ctrl if c["y"] <= y]
                    ca = ca[-1] if ca else ctrl[0]
                    if ca["left"] and ca["left"]["grapes"] and x - lx <= n:
                        unresolved[y, x] = True
        if rid in GAP["regions"]:
            for y in ys:
                xs = np.nonzero(m[y])[0]
                x0, x1 = xs[0], xs[-1]
                wdt = x1 - x0 + 1
                lum_l = float(np.mean(out[y, max(0, x0 - 2)])) if x0 >= 2 else 62.0
                for x in xs:
                    t = (x - x0) / max(1, wdt - 1)
                    if t < GAP["plateau"]:
                        v = min(GAP["lum"], 0.55 * lum_l)
                    else:
                        tt = (t - GAP["plateau"]) / (1 - GAP["plateau"])
                        v = min(GAP["lum"], 0.55 * lum_l) * (1 - tt) ** GAP["rise_pow"] + float(np.mean(out[y, x])) * (1 - (1 - tt) ** GAP["rise_pow"])
                    cur = float(np.mean(out[y, x]))
                    if cur > 1e-3:
                        out[y, x] *= max(v, 12.0) / cur
        if rid in LENS["regions"]:
            for y in ys:
                xs = np.nonzero(m[y])[0]
                x0, x1 = xs[0], xs[-1]
                lum_l = float(np.mean(master[y, max(0, x0 - 2)]))
                lum_r = float(np.mean(master[y, min(W - 1, x1 + 2)]))
                for x in xs:
                    t = (x - x0) / max(1, x1 - x0)
                    v = lum_l * (1 - t) ** LENS["blend_pow"] + lum_r * t ** LENS["blend_pow"]
                    v = min(v, LENS["mid_scale"] * min(lum_l, lum_r) + v * (1 - LENS["mid_scale"]))
                    cur = float(np.mean(out[y, x]))
                    if cur > 1e-3:
                        out[y, x] *= max(v, 10.0) / cur
        # write the paint file: unresolved stays TRANSPARENT (never forced opaque)
        r = man[rid]
        tpl = np.asarray(Image.open(os.path.join(PKG, rid + "-template.png")).convert("RGBA")).copy()
        ox, oy = r["template_offset"]          # the template's true origin (bbox + 24px margin)
        mm = m[oy:oy + tpl.shape[0], ox:ox + tpl.shape[1]]
        paint = np.zeros_like(tpl)
        paint[..., :3] = master[oy:oy + tpl.shape[0], ox:ox + tpl.shape[1]].astype(np.uint8)
        paint[..., :3][mm] = np.clip(out[oy:oy + tpl.shape[0], ox:ox + tpl.shape[1]][mm], 0, 255).astype(np.uint8)
        paint[..., 3] = 255
        paint[..., 3][mm & unresolved[oy:oy + tpl.shape[0], ox:ox + tpl.shape[1]]] = 0
        Image.fromarray(paint).save(os.path.join(DEL, rid + "-paint.png"))
        np.save(os.path.join(DEL, rid + "-unresolved.npy"), m & unresolved)
        prov["regions"][rid] = {"px": int(m.sum()),
                                "resolved_px": int((m & ~unresolved).sum()),
                                "unresolved_px": int((m & unresolved).sum()),
                                "unresolved_pct": round(100 * float((m & unresolved).sum()) / max(1, int(m.sum())), 1),
                                "overlays": [k for k in ("occlusion", "gap", "lens") if rid in {"R01": ["occlusion"], "R02": ["gap"], "R03": ["lens"]}.get(rid, [])]}
        print(f"   {rid}: resolved {prov['regions'][rid]['resolved_px']:,}  UNRESOLVED {prov['regions'][rid]['unresolved_px']:,} ({prov['regions'][rid]['unresolved_pct']}%)")
    json.dump(prov, open(os.path.join(DEL, "PROVENANCE.json"), "w"), indent=1)
    print("DELIVERY paints written (unresolved transparent + flagged)")

if __name__ == "__main__":
    execute()
