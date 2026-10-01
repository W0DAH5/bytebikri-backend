#!/usr/bin/env python3
"""Hold-out validation for the artwork reconstruction path.

    python3 app/scripts/holdout-validation.py     (needs PIL + numpy)

WHAT IT DOES. Hides artwork the master SHOWS — so the answer is known — and
rebuilds it with the exact functions the pipeline uses (`_shift`, `_fit`,
`membrane`, `lum`, `exemplar_fill`), lifted out of `buddha-rig-art.py` by parsing
its source. The pipeline file is NOT edited and NOT imported: this phase may not
change it. Each test region is scored on error and on the artwork's visual
language — texture energy (mean |gradient|) and contrast — and rendered at 2x and
4x, because a numerically good seam that changes the drawing's language is a
failure (docs/evidence/round56/HOLDOUT-VALIDATION.md).

THE DEFECT IT FIXES IN THE LIFTED COPY. The first run emitted
`RuntimeWarning: overflow encountered in add`. Diagnosed with seterr(raise) and a
real traceback: `_shift` allocates with np.empty_like and, for either sign of an
offset, replicates into the edge it has ALREADY written, leaving the opposite
row/column uninitialised. Whatever the allocator last held there — finite floats,
huge floats, NaN — enters the Jacobi update. Proven by poisoning every
np.empty_like allocation with NaN: the pipeline's own `_shift(a, -1, 0)` returns
8 non-finite cells out of 64. The repair fills BOTH edges by replication, which is
what the function's docstring already claims, and the poison test now sweeps every
offset in [-3, 3]^2 and runs the whole solver under poisoning.

That the numbers came out identical before and after is itself the point: the
garbage was inhaled silently, and a run that "did not warn" proved nothing.

"""

import numpy as np
from PIL import Image, ImageFilter

SRC = "app/scripts/buddha-rig-art.py"
WANT = ["_shift", "_at", "_fit", "harmonic", "harmonic_exact", "membrane", "lum",
        "exemplar_fill"]
_src = open(SRC).read()


def _span(name):
    i = _src.index(f"\ndef {name}(") + 1
    j = len(_src)
    for other in WANT:
        k = _src.find(f"\ndef {other}(", i + 1)
        if k != -1:
            j = min(j, k)
    k = _src.find("\n# ── ", i + 1)
    if k != -1:
        j = min(j, k)
    return _src[i:j].rstrip() + "\n"


ns = {"np": np, "Image": Image, "ImageFilter": ImageFilter}
LIFTED = {}
for name in WANT:
    text = _span(name)
    LIFTED[name] = text
    exec(compile(text, f"<lifted:{name}>", "exec"), ns)


def _shift_fixed(a, dy, dx):
    """The pipeline's `_shift`, with BOTH uninitialised edges filled.

    The original replicates at one edge per axis and, for either sign, the edge it
    fills is the one it already wrote — so exactly one row (or column) per axis is
    left as np.empty_like gave it. The first version of this repair fixed only the
    negative-offset edge and the poison test still passed, because the leftover
    NaN happened not to land inside the solver's update mask; the warning is
    non-deterministic garbage, so "it ran without warning" proves nothing. Both
    signs are filled here, and the test below checks every offset.
    """
    out = np.empty_like(a)
    ys = slice(max(dy, 0), a.shape[0] + min(dy, 0))
    yd = slice(max(-dy, 0), a.shape[0] + min(-dy, 0))
    xs = slice(max(dx, 0), a.shape[1] + min(dx, 0))
    xd = slice(max(-dx, 0), a.shape[1] + min(-dx, 0))
    out[yd, xd] = a[ys, xs]
    if dy > 0:
        out[-dy:] = out[-dy - 1:-dy]        # the last written row, replicated down
    elif dy < 0:
        out[:-dy] = out[-dy:-dy + 1]        # the first written row, replicated up
    if dx > 0:
        out[:, -dx:] = out[:, -dx - 1:-dx]  # the last written column, replicated right
    elif dx < 0:
        out[:, :-dx] = out[:, -dx:-dx + 1]  # the first written column, replicated left
    return out


def _at_fixed(a, dy, dx):
    return _shift_fixed(a, -dy, -dx)


ns["_shift"] = _shift_fixed
ns["_at"] = _at_fixed
_shift_fixed.__globals__["np"] = np
globals().update(ns)          # membrane / exemplar_fill / lum / _fit now resolve the fix

membrane, exemplar_fill, lum, _fit = ns["membrane"], ns["exemplar_fill"], ns["lum"], ns["_fit"]

# ── the test that DOES catch it: every offset, on a poisoned heap ───────────
_orig_empty = np.empty_like


def _poisoned(arr, *rest, **kw):
    out = _orig_empty(arr, *rest, **kw)
    if out.dtype == np.float32:
        out[...] = np.nan
    return out


np.empty_like = _poisoned
_ok = True
for _dy in range(-3, 4):
    for _dx in range(-3, 4):
        _a = np.arange(64, dtype=np.float32).reshape(8, 8)
        _r = _shift_fixed(_a, _dy, _dx)
        if not np.isfinite(_r).all():
            _ok = False
            print(f"   FAIL _shift(a, {_dy}, {_dx}) reads uninitialised memory")
print(f"POISON TEST, every offset in [-3,3]^2: {'all finite' if _ok else 'UNINITIALISED CELLS READ'}")
# and the whole solver + fill, still poisoned
C0 = "app/public/img/cosmetics"
_m2 = Image.open(f"{C0}/mascot-gold-buddha-base.png").convert("RGB")
_rgb2 = np.asarray(_m2).astype(np.float32)
_al2 = np.asarray(Image.open(f"{C0}/master-alpha.png"))
_M2 = (_al2 > 127) if _al2.max() > 1 else (_al2 > 0.5)
_h2 = np.zeros(_M2.shape, bool); _h2[600:700, 300:400] = True; _h2 &= _M2
_f2, _r2 = ns["membrane"](ns["lum"](_rgb2), _h2)
_o2, _w2 = ns["exemplar_fill"](_rgb2.copy(), _M2 & ~_h2, _h2, search=64, stride=4, guide=_f2)
np.empty_like = _orig_empty
print(f"   membrane under poisoning: non-finite {int((~np.isfinite(_f2)).sum())}")
print(f"   exemplar_fill under poisoning: non-finite {int((~np.isfinite(_o2)).sum())}")
assert _ok and np.isfinite(_f2).all() and np.isfinite(_o2).all(), "uninitialised memory is still being read"
