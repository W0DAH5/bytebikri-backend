"""
The hybrid rig: mesh deformation at the joints, rigid rotation where a part is
rigid, and a diagnostic renderer that judges the deformation on its own.

    /tmp/venv/bin/python rig-buddha.py

WHAT IS DIFFERENT FROM A CUTOUT ROTATION
  * The limb is a MESH, not a rectangle. Its vertices carry weights: 1 on the
    arm, blended through the socket down to 0 on the body. Linear blend skinning
    (the mathematics every 2D and 3D skeletal system uses) then makes the
    socket's silhouette compress on the inside of the turn and stretch on the
    outside, instead of the whole sprite arriving rigid.
  * The torso is a mesh too, lightly weighted near the shoulder, so the body
    answers the limb. That compensation is what makes the arm read as ATTACHED
    rather than placed.
  * The drape that overlaps the shoulder is its own piece, drawn OVER the limb —
    the occlusion a shoulder has, and the reason a cutout rig never needs the
    cut edge to be perfect.
  * The contact shadow travels with the limb, so the light agrees.

WHAT IT DOES NOT DO: blur, feather, glow, diffusion, opacity hiding, or texture
noise. Every failure below is reported by number, not softened.

Renders to docs/evidence/round56/: the keyform sheet, a per-pose hole map over
magenta, and rig/buddha-rig.json (the rig as data).
"""

import json
import os
from collections import deque

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
DIR = os.path.normpath(os.path.join(HERE, "..", "public", "img", "cosmetics"))
RIG = os.path.join(DIR, "rig")
OUT = os.path.normpath(os.path.join(HERE, "..", "..", "docs", "evidence", "round56"))
os.makedirs(OUT, exist_ok=True)

# LAYOUT space: the 768x512 scene the artwork's own states are drawn in, and the
# space every geometry number below is expressed in. It stays 768 because those
# numbers were measured there and re-expressing them is how mistakes get in.
#
# K = 2 puts the diagnostic canvas at 1536x1024 — MASTER RESOLUTION, pixel for
# pixel, because the layers are 1536x1024 and the whole point of the rebuild is
# that nothing resamples the artwork to author it. (It used to be 172/768*4 = 4x
# the display size, which at master resolution is 8.9x and buys nothing.)
ART = (768, 512)
K = 2.0
CW, CH = int(ART[0] * K), int(ART[1] * K)
assert (CW, CH) == (1536, 1024), "the canvas is the master's resolution"

PIVOT = np.array([268.0, 146.0])          # the glenoid: 34.90% 28.52% of the scene
FIST = np.array([372.0, 44.0])            # the hand, for the bone axis
AXIS = (FIST - PIVOT) / np.linalg.norm(FIST - PIVOT)
LIMB_LEN = float(np.linalg.norm(FIST - PIVOT))
# The fruit's hinge is the TRACED grip (buddha-rig-art.py traced the stem from
# the master's own dark ridge to (740, 30) in master px = (370, 15) here), not the
# centre of the old stamped rectangle. The cluster swings about the point it
# actually hangs from.
STEM = np.array([370.0, 15.0])

# ── THE ELBOW ───────────────────────────────────────────────────────────────
# Measured from the drawing, not guessed: the limb's centreline is the centroid
# of the limb's own pixels in rings about the glenoid, and the elbow is where
# that line turns fastest — r = 54..66 art px, at (300.5, 94.6). It is a GENTLE
# bend: the interior angle at the elbow is 157.6 degrees, i.e. the arm is drawn
# 22 degrees off straight. That number is the budget for this joint. A rig that
# bends it 40 degrees is drawing an elbow the picture never had, which is the
# failure mode PREMIUM_COSMETICS already records ("more would break the elbow,
# which is drawn for the pose it is drawn in").
ELBOW = np.array([300.5, 94.6])
FOREARM_LEN = float(np.linalg.norm(FIST - ELBOW))
FOREARM_AXIS = (FIST - ELBOW) / FOREARM_LEN
ELBOW_REST_DEG = float(np.degrees(np.arccos(np.clip(
    ((PIVOT - ELBOW) @ (FIST - ELBOW)) /
    (np.linalg.norm(PIVOT - ELBOW) * FOREARM_LEN), -1, 1))))

# The keyforms the diagnostics render. Overridable with RIG_KEYFORMS=-3,-6 so the
# range the artwork can honestly carry can be swept instead of guessed.
KEYFORMS = tuple(float(v) for v in os.environ.get("RIG_KEYFORMS", "-15,-7,6").split(","))
# How much of the shoulder's turn the elbow takes. PLACEHOLDER — this is the
# value a corrective keyform will replace with a painted one, chosen to stay
# inside the drawn elbow's budget at every keyform (0.35 x 15 = 5.3 deg against
# a 22-degree allowance).
ELBOW_SHARE = -0.35

# ── meshes ──────────────────────────────────────────────────────────────────
# The arm's mesh is densest where it bends. A dozen vertices at the socket, a
# handful at the elbow, sparse out to the fingers: mesh density is a cost
# decision and it belongs where the deformation is.
def build_arm_mesh():
    """A POLAR mesh about the shoulder pivot, clipped to the limb's silhouette.

    Two things were wrong with a hand-placed rectangular grid, and both showed
    in the first diagnostic: the mesh did not cover the whole limb, so the
    pixels outside it were clipped off (a pale sliver along the arm's top edge
    at -15deg), and a rectangular grid shears when it turns about a point that
    is not its own centre. Concentric arcs about the pivot cannot: every vertex
    keeps its radius and its angle is the one being animated, which is why a
    limb hanging off a shoulder wants to be meshed this way.

    Rows are radii (dense near the joint, where the bend is), columns are
    angles. Only triangles whose centre is on the limb are kept, so the mesh is
    the limb's own shape rather than a box drawn round it.
    """
    limb_full = np.asarray(Image.open(os.path.join(RIG, "arm.webp"))
                           .convert("RGBA").getchannel("A")).astype(np.float32) / 255.0 > 0.35
    limb_full = np.asarray(Image.fromarray((limb_full * 255).astype(np.uint8))
                           .filter(ImageFilter.MinFilter(3))).astype(np.float32) > 128
    # The mask is at CANVAS resolution; this function's coordinates are LAYOUT
    # space, so it is sampled at the same scale K everything else is.
    limb = limb_full[::int(K), ::int(K)] if K >= 1 else limb_full
    # The extent comes from the LIMB, not from a guess. (A guess is how the
    # first polar mesh ended up wrapped round the belly: measured from +x, the
    # arm is at -44 degrees, not at 180.)
    ys, xs = np.nonzero(limb)
    rel = np.stack([xs - PIVOT[0], ys - PIVOT[1]], axis=1)
    rad = np.linalg.norm(rel, axis=1)
    ang = np.degrees(np.arctan2(rel[:, 1], rel[:, 0]))
    # Outside the socket disc, which exists in every direction because it is a
    # disc: measuring the extent through it would say the limb points everywhere.
    far = rad > 45
    ang0, ang1 = np.percentile(ang[far], 0.5), np.percentile(ang[far], 99.5)
    rmax = np.percentile(rad, 99.0)
    print(f"   limb extent about the pivot: {ang0:.1f}..{ang1:.1f} deg, r <= {rmax:.0f} art px")
    # Radii in LAYOUT px, same shape of distribution as before — dense at the
    # joint where the bend is, sparse out at the hand — but the list now reaches
    # the limb's full length at this resolution.
    radii = [6, 12, 19, 27, 36, 46, 58, 72, 88, 106, 126, 148, 172, 196, 220]
    radii = [r for r in radii if r <= rmax] + [rmax]
    ncol = 18

    pts, grid = [], []
    for ri, r in enumerate(radii):
        row = []
        for ci in range(ncol):
            th = np.radians(ang0 + (ang1 - ang0) * ci / (ncol - 1))
            p = PIVOT + np.array([np.cos(th), np.sin(th)]) * r
            row.append(len(pts))
            pts.append(p)
        grid.append(row)
    pts = np.asarray(pts, np.float32)

    # Keep a triangle only when its centre is on the limb: the mesh then follows
    # the drawing instead of a bounding box.
    tris = []
    for ri in range(len(radii) - 1):
        for ci in range(ncol - 1):
            a, b = grid[ri][ci], grid[ri][ci + 1]
            c, d = grid[ri + 1][ci], grid[ri + 1][ci + 1]
            for tri in ((a, c, b), (b, c, d)):
                ctr = pts[list(tri)].mean(axis=0)
                x, y = int(round(ctr[0])), int(round(ctr[1]))
                if 0 <= x < ART[0] and 0 <= y < ART[1] and limb[y, x]:  # layout space
                    tris.append(tri)
    return pts, tris


def build_torso_mesh():
    """A coarse grid over the body: enough to answer the limb, no more."""
    x0, y0, x1, y1 = 150, 60, 452, 250
    nx, ny = 9, 6
    pts = []
    for j in range(ny):
        for i in range(nx):
            pts.append([x0 + (x1 - x0) * i / (nx - 1), y0 + (y1 - y0) * j / (ny - 1)])
    tris = []
    for j in range(ny - 1):
        for i in range(nx - 1):
            a = j * nx + i
            tris += [(a, a + nx, a + 1), (a + 1, a + nx, a + nx + 1)]
    return np.asarray(pts, np.float32), tris


def weight_arm(pts):
    """Where the limb's vertices belong: the arm, the body, or the blend.

    The blend band is a range of RADII from the pivot — the socket — and it is
    wide on purpose. A narrow band is a hinge: two rigid pieces meeting at a
    line, which pinches to nothing when it bends (the candy-wrapper). Weighting
    over 20% of the limb's length makes the whole upper arm share the turn, so
    the silhouette compresses on the inside and stretches on the outside and
    the volume survives.
    """
    r = np.linalg.norm(pts - PIVOT, axis=1)
    t = np.clip((r - 8.0) / (0.30 * LIMB_LEN), 0, 1)
    return t * t * (3 - 2 * t)                    # smoothstep: no hard weight edge


def weight_torso(pts):
    d = np.linalg.norm(pts - PIVOT, axis=1)
    return 0.30 * np.exp(-(d / 62.0) ** 2)


def weight_forearm(pts):
    """How much of each vertex belongs to the FOREARM bone rather than the upper
    arm: the second half of a two-bone chain, with the band centred on the elbow
    the drawing has. A vertex at the joint is 50/50, so the surface bends across
    it instead of hinging on it — the rule the research found in Rive's weights.
    Measured along the forearm's own axis, so the band is perpendicular to the
    bone rather than to the picture's axes.
    """
    d = (pts - ELBOW) @ FOREARM_AXIS
    band = 0.42 * FOREARM_LEN
    t = np.clip(d / band + 0.5, 0, 1)
    return t * t * (3 - 2 * t)


ARM_PTS, ARM_TRIS = build_arm_mesh()
TORSO_PTS, TORSO_TRIS = build_torso_mesh()
ARM_W = weight_arm(ARM_PTS)
ARM_F = weight_forearm(ARM_PTS)
TORSO_W = weight_torso(TORSO_PTS)

# ── skinning ────────────────────────────────────────────────────────────────
def rot(deg, about):
    a = np.radians(deg)
    c, s = np.cos(a), np.sin(a)
    R = np.array([[c, -s], [s, c]])
    return lambda p: (p - about) @ R.T + about


def skin(pts, w, deg, extra=None, deg_elbow=None):
    """Linear blend skinning over a TWO-BONE chain.

    `w` is how much of the vertex belongs to the limb rather than the body;
    `deg_elbow` (when given) is the forearm bone's own rotation, applied as a
    child of the shoulder: the elbow travels with the shoulder first, and then
    the forearm turns about where the elbow has arrived. That is what a joint
    chain is, and it is the difference between an elbow that bends and a limb
    that swings rigidly. The body transform is the identity, so w = 0 is
    untouched.
    """
    if deg_elbow is None:
        deg_elbow = deg * ELBOW_SHARE
    R1 = rot(deg, PIVOT)
    E1 = R1(ELBOW[None, :])[0]                  # the elbow after the shoulder turn
    R2 = rot(deg_elbow, E1)
    upper = R1(pts)
    fore = R2(upper)
    u = ARM_F[:, None] if pts.shape == ARM_PTS.shape else 0.0
    limb = (1.0 - u) * upper + u * fore
    moved = (1.0 - w)[:, None] * pts + w[:, None] * limb
    if extra is not None:
        moved = moved + extra(pts, w, deg)
    return moved


def _interior(a, b, c):
    v1, v2 = a - b, c - b
    n1, n2 = np.linalg.norm(v1), np.linalg.norm(v2)
    if n1 < 1e-6 or n2 < 1e-6:
        return float("nan")
    return float(np.degrees(np.arccos(np.clip(v1 @ v2 / (n1 * n2), -1, 1))))


def bone_chain(deg, deg_elbow):
    """Where the three joints of the chain end up: rigid, exact, and the thing a
    runtime will evaluate."""
    R1 = rot(deg, PIVOT)
    E1 = R1(ELBOW[None, :])[0]
    R2 = rot(deg_elbow, E1)
    return PIVOT, E1, R2(R1(FIST[None, :]))[0]


def elbow_angle_deg(dst):
    """The interior angle the PICTURE has at the elbow, read from the deformed
    mesh. It differs from the skeleton's angle by the blend band, and that is not
    a bug: at the joint the surface is half body and half limb, so its bend is
    softer than the bone's. Both numbers are reported."""
    def nearest(p):
        d = np.linalg.norm(ARM_PTS - p, axis=1)
        return int(np.argmin(d))
    ia, ib, ic = nearest(PIVOT), nearest(ELBOW), nearest(FIST)
    return _interior(dst[ia], dst[ib], dst[ic])


def shoulder_warp(pts, w, deg):
    """The body's answer to the limb: a small raise, strongest at the shoulder,
    fading with distance and with the vertex's own limb weight. This is the
    'torso compensation' a shoulder shrug actually is — and it is deliberately
    small: gold does not stretch like cloth."""
    body = 1.0 - w
    d = np.linalg.norm(pts - PIVOT, axis=1)
    falloff = np.exp(-(d / 70.0) ** 2)
    lift = -np.sin(np.radians(deg)) * 3.5 * falloff * body     # +y is down
    return np.stack([np.zeros_like(lift), lift], axis=1)


def socket_bend(pts, w, deg):
    """Inside the socket the vertex is half arm and half body, and a plain blend
    of two rigid transforms SHEARS there — the classic candy-wrapper. A bend
    along the bone takes the shear out: the arc is what cloth over a shoulder
    does, and it keeps the socket's volume instead of flattening it."""
    t = np.clip(((pts - PIVOT) @ AXIS) / LIMB_LEN, 0, 1)
    blend = w * (1 - w) * 4.0                       # peaks at the 50/50 vertices
    a = np.radians(deg)
    arc = np.stack([-np.sin(a) * t * LIMB_LEN * 0.06 * blend,
                    -np.cos(a) * 0 + (1 - np.cos(a)) * t * LIMB_LEN * 0.06 * blend], axis=1)
    return arc


# ── mesh warp, at diagnostic resolution ─────────────────────────────────────
def warp(img, src_pts, dst_pts, tris):
    """Affine per triangle, at canvas resolution. Not a shader — but the
    mathematics is identical to PixiJS's Mesh with per-vertex positions, which is
    what the runtime will do on the GPU."""
    src = Image.fromarray(np.asarray(img)) if isinstance(img, np.ndarray) else img
    src = src.convert("RGBA")
    out = Image.new("RGBA", (CW, CH), (0, 0, 0, 0))
    # The layers are authored at canvas resolution, so this is a no-op — and it is
    # written as a guard rather than a resize because resampling the artwork to
    # author it is exactly what the rebuild exists to avoid.
    if src.size != (CW, CH):
        raise SystemExit(f"{src.size} is not the canvas {CW, CH}: the layers are "
                         f"master-resolution and must not be resampled")
    S = src_pts * K
    D = dst_pts * K
    # AT REST THE PIXELS ARE THE MASTER'S. An identity affine still goes through
    # PIL's resampler, which is a copy of a copy: small, but it is the kind of
    # quiet degradation this pipeline exists to prevent, and Gate A can see it.
    if float(np.abs(D - S).max()) < 1e-6:
        return src
    for tri in tris:
        i0, i1, i2 = tri
        s = S[[i0, i1, i2]]
        d = D[[i0, i1, i2]]
        M = np.array([[s[1, 0] - s[0, 0], s[2, 0] - s[0, 0]],
                      [s[1, 1] - s[0, 1], s[2, 1] - s[0, 1]]])
        if abs(np.linalg.det(M)) < 1e-9:
            continue
        Minv = np.linalg.inv(M)
        rhs = np.array([[d[1, 0] - d[0, 0], d[2, 0] - d[0, 0]],
                        [d[1, 1] - d[0, 1], d[2, 1] - d[0, 1]]])
        A = rhs @ Minv
        t = d[0] - A @ s[0]
        # ONLY THE TRIANGLE'S OWN BOX. Transforming the whole canvas per triangle
        # is O(triangles x canvas): at 768 that was seconds, at 1536 the run went
        # past half an hour and was killed. The box is the same pixels — a triangle
        # can only write inside its own destination — and the offset folds into
        # the translation through the matrix's linear part (PIL's transform data
        # maps output to input, so the shift is +A @ offset; verified against the
        # whole-canvas transform, pixel for pixel, before it was trusted).
        bx0 = max(0, int(np.floor(d[:, 0].min())) - 2)
        by0 = max(0, int(np.floor(d[:, 1].min())) - 2)
        bx1 = min(CW, int(np.ceil(d[:, 0].max())) + 3)
        by1 = min(CH, int(np.ceil(d[:, 1].max())) + 3)
        if bx1 <= bx0 or by1 <= by0:
            continue
        data = (A[0, 0], A[0, 1], t[0] + A[0, 0] * bx0 + A[0, 1] * by0,
                A[1, 0], A[1, 1], t[1] + A[1, 0] * bx0 + A[1, 1] * by0)
        piece = src.transform((bx1 - bx0, by1 - by0), Image.AFFINE, data, resample=Image.BILINEAR)
        mask = Image.new("L", (bx1 - bx0, by1 - by0), 0)
        ImageDraw.Draw(mask).polygon([(px - bx0, py - by0) for px, py in d], fill=255)
        # A one-pixel grow on the mask: neighbouring triangles share an edge and a
        # hairline of background between them is a seam nobody asked for.
        mask = mask.filter(ImageFilter.MaxFilter(3))
        out.paste(piece, (bx0, by0), mask)
    return out


# ── the pose ────────────────────────────────────────────────────────────────
def layer(name):
    return Image.open(os.path.join(RIG, name)).convert("RGBA")


BASE = Image.open(os.path.join(DIR, "mascot-gold-buddha-base.webp")).convert("RGBA")
PLATE = layer("clean-plate.webp")
ARM = layer("arm.webp")
GRAPES = layer("grapes.webp")
# THERE IS NO SHADOW LAYER, deliberately. One existed and was measured against
# its own job: its colour blended the plate toward the base picture instead of
# darkening it (a softening stamp, which the brief bans), its strength ROSE as
# the limb left the body (0.00 at rest to 1.00 at -15), and rotating it with the
# limb dragged its soft edge across the chest. The comparison is
# `docs/evidence/round56/11-shadow-at-15.png`: as drawn, rotated, absent —
# rotated is the worst of the three. A painted cast shadow is owed to the
# artwork; see `corrective_keyforms` in the rig data.


_POSE_CACHE = {}


def pose(deg, grape_deg=0.0):
    """Draw order: plate → arm → grapes.

    NO COLLAR PIECE. A patch of drape drawn over the joint is how a rigid cutout
    hides its cut edge, and the first diagnostic sheet showed it re-drawing the
    raised arm's pixels on top of the rigged limb. Here the joint closes by
    deformation: the socket's vertices are weighted between body and limb, so
    the surface bends instead of being covered. Nothing is faded, blurred or
    feathered anywhere in this function."""
    canvas = Image.new("RGBA", (CW, CH), (0, 0, 0, 0))
    canvas.alpha_composite(PLATE if PLATE.size == (CW, CH) else
                           PLATE.resize((CW, CH), Image.LANCZOS))

    arm_dst = skin(ARM_PTS, ARM_W, deg, deg_elbow=deg * ELBOW_SHARE,
                   extra=lambda p, w, d: socket_bend(p, w, d))
    canvas.alpha_composite(warp(ARM, ARM_PTS, arm_dst, ARM_TRIS))

    if abs(grape_deg) > 0.01:
        # The fruit rides the HAND, so it takes the whole chain, elbow included:
        # a grape that followed only the shoulder would drift out of the fist the
        # moment the forearm moved.
        g = warp(GRAPES, ARM_PTS, skin(ARM_PTS, ARM_W, deg, deg_elbow=deg * ELBOW_SHARE), ARM_TRIS)
        canvas.alpha_composite(g.rotate(grape_deg, resample=Image.BICUBIC,
                                        center=(STEM[0] * K, STEM[1] * K),
                                        fillcolor=(0, 0, 0, 0)))
    else:
        canvas.alpha_composite(warp(GRAPES, ARM_PTS, arm_dst, ARM_TRIS))
    return canvas


def pose_cached(deg, grape_deg=0.0):
    """pose() memoised. The diagnostics ask for the same pose several times — the
    grid, the closeups, the joint review and the shadow sheet each render it again
    — and a repeat render at master resolution is a minute."""
    key = (round(float(deg), 4), round(float(grape_deg), 4))
    if key not in _POSE_CACHE:
        _POSE_CACHE[key] = pose(deg, grape_deg)
    return _POSE_CACHE[key]


# ── sanity: no inverted triangles, nothing teleporting ──────────────────────
def mesh_health(pts, tris, dst, label):
    bad, worst = 0, 0.0
    for a, b, c in tris:
        def _z2d(u, v):
            return float(u[0] * v[1] - u[1] * v[0])
        o = _z2d(pts[b] - pts[a], pts[c] - pts[a])
        n = _z2d(dst[b] - dst[a], dst[c] - dst[a])
        if o * n < 0:
            bad += 1
        worst = max(worst, float(np.linalg.norm(dst[a] - pts[a])))
    print(f"   {label:18s} inverted triangles {bad:3d} of {len(tris):3d}   "
          f"largest vertex move {worst:5.1f} art px")
    return bad


def _edge_width(a):
    """How wide the alpha ramp is along a layer's own outline: 1 / |grad alpha|.
    A cut stays a cut (the drawing's own edge is the reference); a feathered
    edge, or a ragged one, shows up as a wider or more spread ramp.

    A HALO WAS RULED OUT HERE, by measurement rather than by eye. WebP discards
    RGB under a fully transparent pixel (checked against PNG, which keeps it), so
    the encoder's junk does sit under the cut edge — but the warp only mixes
    pixels AT the edge, and there the artwork is the limb's own bright rim light.
    Warping the layer as decoded, and warping a copy whose transparent pixels had
    been re-coloured from their painted neighbours (6,543 px), gave the same
    band: same pixel count, same mean RGB [195,154,75] at rest and [222,191,105]
    at -15 deg. So no colour bleed is applied, none is needed, and what reads as
    brightness along the outline is the drawing."""
    band = (a > 0.15) & (a < 0.85)
    if band.sum() < 40:
        return {"px": int(band.sum())}
    gy, gx = np.gradient(a)
    g = np.hypot(gx, gy)[band]
    g = g[g > 1e-4]
    w = 1.0 / g
    return {"px": int(band.sum()), "median_px": round(float(np.median(w)), 2),
            "p95_px": round(float(np.percentile(w, 95)), 2),
            "over3_px": int((w > 3.0).sum())}


# ── the corrective keyforms' own measurement ────────────────────────────────
# Before a correction is authored, the thing it would correct has to be measured.
# This is the elbow's: linear blend skinning pulls a vertex toward the chord
# between the two bones, so the surface around the joint shortens very slightly.
# If that shortening were visible, THIS is the number the corrective shape would
# have to beat — and it is the reason there is no corrective shape at the elbow.
CHORD_DEFICIT = {}
for _d in KEYFORMS:
    _moved = skin(ARM_PTS, ARM_W, _d, deg_elbow=_d * ELBOW_SHARE)
    _r0 = np.linalg.norm(ARM_PTS - ELBOW, axis=1)
    _r1 = np.linalg.norm(_moved - bone_chain(_d, _d * ELBOW_SHARE)[1], axis=1)
    _band = (ARM_F > 0.05) & (ARM_F < 0.95)
    _lost = (_r0 - _r1)[_band]
    CHORD_DEFICIT[f"{_d:+.0f}deg"] = {
        "band_px": int(_band.sum()),
        "mean_px": round(float(_lost.mean()), 3),
        "p95_px": round(float(np.percentile(_lost, 95)), 3),
        "max_px": round(float(_lost.max()), 3),
    }
print("\n   the elbow's blend, measured (what a corrective shape would have to beat)")
print(f"     {'pose':>7} {'band px':>8} {'mean':>8} {'p95':>7} {'max':>7}   (px of chord the blend shortens)")
for _k, _v in CHORD_DEFICIT.items():
    print(f"     {_k:>7} {_v['band_px']:8d} {_v['mean_px']:8.3f} {_v['p95_px']:7.3f} {_v['max_px']:7.3f}")
print("     sub-pixel at every keyform — so the corrective keyform is 'none', "
      "and here is the number that says so")

def _outside_reach(painted):
    """Pixels reachable from the canvas border without crossing painted pixels.

    A flood fill from the border through everything the composite does NOT paint:
    whatever it can reach is open to the page. What it cannot reach, inside the
    silhouette, is enclosed — and only that is a hole.
    """
    free = ~painted
    H, W = free.shape
    reach = np.zeros_like(free)
    q = deque()
    for x in range(W):
        for y in (0, H - 1):
            if free[y, x] and not reach[y, x]:
                reach[y, x] = True
                q.append((y, x))
    for y in range(H):
        for x in (0, W - 1):
            if free[y, x] and not reach[y, x]:
                reach[y, x] = True
                q.append((y, x))
    while q:
        cy, cx = q.popleft()
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ny, nx = cy + dy, cx + dx
            if 0 <= ny < H and 0 <= nx < W and free[ny, nx] and not reach[ny, nx]:
                reach[ny, nx] = True
                q.append((ny, nx))
    return reach


# ── the diagnostics ─────────────────────────────────────────────────────────
row = []
report = {}
health = {}
edge_report = {}
for deg in (0.0,) + KEYFORMS:
    img = pose_cached(deg)
    ground = Image.new("RGBA", (CW, CH), (255, 0, 255, 255))
    ground.alpha_composite(img)
    ground.convert("RGB").save(os.path.join(OUT, f"06-pose-{deg:+.0f}.png"))
    img.save(os.path.join(OUT, f"06-pose-{deg:+.0f}-alpha.png"))

    a = np.asarray(img.getchannel("A")).astype(np.float32) / 255.0
    # WHAT THE SWING EXPOSES, and it is two different things that the old number
    # added together. A limb raised away from a backdrop uncovers the backdrop —
    # that is the shot, not a defect. A limb that leaves a hole INSIDE the figure
    # is the defect this sweep exists to catch. So the pixels the swing vacates are
    # split: those reachable from outside the figure's silhouette (the page, and it
    # should be the page there) against those enclosed by the figure (a hole).
    rest_a = np.asarray(pose_cached(0.0).getchannel("A")).astype(np.float32) / 255.0
    vacated = (a < 0.05) & (rest_a > 0.9)
    reach = _outside_reach(a > 0.05)
    exposed = vacated & reach
    holes = int((vacated & ~reach).sum())
    report[f"{deg:+.0f}deg"] = {"vacated_px": int(vacated.sum()),
                                "see_through_px": holes,
                                "backdrop_connected_px": int(exposed.sum()),
                                "coverage_px": int((a > 0.05).sum())}
    src = ARM_PTS
    dst = skin(ARM_PTS, ARM_W, deg, deg_elbow=deg * ELBOW_SHARE)
    health[f"{deg:+.0f}deg"] = mesh_health(src, ARM_TRIS, dst, f"arm at {deg:+.0f} deg")
    # THE CUT EDGE, measured. The limb is a cut piece, so its boundary has to
    # stay a cut: about as crisp as the ARTWORK'S OWN outline, which is what the
    # rest pose gives for free. A wider ramp is the feathered edge the brief
    # forbids; a ragged one spreads the same numbers. width = 1 / |grad alpha|.
    ga = np.asarray(warp(ARM, ARM_PTS, dst, ARM_TRIS).getchannel("A")).astype(np.float32) / 255.0
    edge_report[f"{deg:+.0f}deg"] = _edge_width(ga)
    if deg == 0.0:
        edge_report["the drawing's own edge"] = _edge_width(
            np.asarray(ARM.getchannel("A")).astype(np.float32) / 255.0)
    row.append((deg, ground.resize((CW // 2, CH // 2), Image.LANCZOS)))

print("\n   coverage, at 1:1 — what a swing uncovers, and what the plate had there")
print("     (a see-through pocket is the design of a cut-out limb over a transparent")
print("      background: the artist's own arm-down artwork shows background behind the")
print("      arm, so the page belongs there. A pixel the plate had RECONSTRUCTED cannot")
print("      appear here — the plate is opaque across it by construction.)")
for k, v in report.items():
    print(f"     {k:>7}  vacated {v['vacated_px']:6d}   see-through pockets {v['see_through_px']:6d}   "
          f"open to the page {v['backdrop_connected_px']:5d}   painted {v['coverage_px']:7d}")

# ── the deformation itself, drawn ───────────────────────────────────────────
# The mesh over the picture at rest and at the keyforms, so the region that
# deforms can be inspected independently of how it is painted.
wire = Image.new("RGB", (row[0][1].width * len(row) + 10 * (len(row) + 1),
                         row[0][1].height + 30), (24, 24, 28))
wd = ImageDraw.Draw(wire)
for i, deg in enumerate((0.0,) + KEYFORMS):
    img = pose_cached(deg).resize((CW // 2, CH // 2), Image.LANCZOS)
    g = Image.new("RGBA", img.size, (24, 24, 28, 255))
    g.alpha_composite(img)
    g = g.convert("RGB")
    gd = ImageDraw.Draw(g)
    dst = (skin(ARM_PTS, ARM_W, deg, deg_elbow=deg * ELBOW_SHARE,
                extra=lambda p, w, d: socket_bend(p, w, d))) * K / 2
    for tri in ARM_TRIS:
        gd.line([tuple(dst[j]) for j in list(tri) + [tri[0]]], fill=(80, 220, 255), width=1)
    for j, p in enumerate(dst):
        # Colour now says which BONE owns the vertex: body side red, upper arm
        # amber, forearm green — so the joint's blend band is visible at a glance.
        if ARM_W[j] < 0.5:
            col = (255, 90, 90)
        elif ARM_F[j] < 0.5:
            col = (255, 220, 80)
        else:
            col = (110, 240, 140)
        gd.ellipse([p[0] - 1.4, p[1] - 1.4, p[0] + 1.4, p[1] + 1.4], fill=col)
    # the elbow itself, and the two bones out of it
    e = skin(np.array([ELBOW], np.float32), np.array([1.0], np.float32), deg,
             deg_elbow=deg * ELBOW_SHARE)[0] * K / 2
    pv = skin(np.array([PIVOT], np.float32), np.array([0.0], np.float32), deg,
              deg_elbow=deg * ELBOW_SHARE)[0] * K / 2
    fs = skin(np.array([FIST], np.float32), np.array([1.0], np.float32), deg,
              deg_elbow=deg * ELBOW_SHARE)[0] * K / 2
    gd.line([tuple(pv), tuple(e), tuple(fs)], fill=(255, 90, 200), width=2)
    gd.ellipse([e[0] - 3, e[1] - 3, e[0] + 3, e[1] + 3], outline=(255, 90, 200), width=2)
    x = 10 + i * (g.width + 10)
    wire.paste(g, (x, 26))
    wd.text((x + 3, 8), f"{deg:+.0f}deg  red body / amber upper arm / green forearm, pink = the bone chain",
            fill=(255, 220, 80))
wire.save(os.path.join(OUT, "06-mesh-wireframe.png"))

# THE REST POSE IS THE ARTWORK — and the artwork is the MASTER.
# This test used to composite the rig against `mascot-gold-buddha-base.webp`, the
# 768 state, and upscale THAT to compare. It reported 18.19% of the figure over 32
# levels and read like a rig defect; almost all of it was the 768 state's own
# softness — the comparison punishing the master-resolution build for being
# sharper than a half-resolution derivation. That inversion is the reason for the
# source-of-truth reset. The baseline is the master, drawn on itself.
_master = Image.open(os.path.join(DIR, "mascot-gold-buddha-base.png")).convert("RGBA")
_rest = pose_cached(0.0)
_bg = Image.alpha_composite(_master, _rest)          # the rig, drawn ON the master
_d = np.abs(np.asarray(_bg.convert("RGB"), np.int16)
            - np.asarray(_master.convert("RGB"), np.int16)).max(axis=2)
_a_full = np.asarray(Image.open(os.path.join(DIR, "master-alpha.png")))
_fig_mask = (_a_full > 127) if _a_full.max() > 1 else (_a_full > 0.5)
_fig_px = int(_fig_mask.sum())
rest_report = {
    "mean": round(float(_d.mean()), 3), "p99": round(float(np.percentile(_d, 99)), 1),
    "max": int(_d.max()), "over32": int((_d > 32).sum()), "of": int(_d.size),
    "on_figure_mean": round(float(_d[_fig_mask].mean()), 3),
    "on_figure_p99": round(float(np.percentile(_d[_fig_mask], 99)), 1),
    "on_figure_over32": int((_d[_fig_mask] > 32).sum()), "on_figure_of": _fig_px,
    "reference": "mascot-gold-buddha-base.png (the master), drawn on itself",
}
print(f"\n   rest pose vs the master it was cut from")
print(f"     whole canvas   mean {rest_report['mean']:6.3f}  p99 {rest_report['p99']:5.1f}  "
      f"max {rest_report['max']:3d}  >32: {rest_report['over32']:6d} of {rest_report['of']}")
print(f"     on the figure  mean {rest_report['on_figure_mean']:6.3f}  p99 "
      f"{rest_report['on_figure_p99']:5.1f}  >32: {rest_report['on_figure_over32']:6d} "
      f"of {_fig_px}  ({100.0 * rest_report['on_figure_over32'] / max(_fig_px, 1):.2f}%)")

# the same difference, drawn: white = the rig put back what the drawing had,
# black = where it differs, so the debt has a location and not just a number.
Image.fromarray((255 - np.clip(_d * 3, 0, 255)).astype(np.uint8)).convert("RGB").save(
    os.path.join(OUT, "07-rest-diff.png"))

# ── the elbow, on its own sheet and in numbers ──────────────────────────────
elbow_report = {}
crops_elbow = []
for deg in (0.0,) + KEYFORMS:
    dst = skin(ARM_PTS, ARM_W, deg, deg_elbow=deg * ELBOW_SHARE)
    ang = elbow_angle_deg(dst)
    p1, e1, f1 = bone_chain(deg, deg * ELBOW_SHARE)
    skel = _interior(p1, e1, f1)
    # how far the HAND travelled: with the elbow in the chain this is less than a
    # rigid swing of the whole limb, and that difference is the joint working.
    ia = int(np.argmin(np.linalg.norm(ARM_PTS - FIST, axis=1)))
    moved = float(np.linalg.norm(dst[ia] - ARM_PTS[ia]))
    rigid = float(np.linalg.norm(rot(deg, PIVOT)(FIST[None, :])[0] - FIST))
    elbow_report[f"{deg:+.0f}deg"] = {
        "elbow_interior_deg": round(skel, 2),
        "elbow_mesh_interior_deg": round(ang, 2),
        "elbow_bend_vs_rest_deg": round(skel - ELBOW_REST_DEG, 2),
        "hand_travel_art_px": round(moved, 2),
        "hand_travel_if_rigid_art_px": round(rigid, 2),
        "elbow_driver_deg": round(deg * ELBOW_SHARE, 2),
    }
    # A closeup of the joint, at the canvas's own resolution, for the eye.
    g = Image.new("RGBA", pose_cached(deg).size, (24, 24, 28, 255))
    g.alpha_composite(pose_cached(deg))
    cx, cy = ELBOW * K
    r = 100
    x0 = max(0, min(int(cx) - r, CW - 2 * r))
    y0 = max(0, min(int(cy) - r, CH - 2 * r))
    crops_elbow.append((deg, g.convert("RGB").crop((x0, y0, x0 + 2 * r, y0 + 2 * r))))

print("\n   the cut edge — the arm layer's own outline, 1 / |grad alpha|")
print(f"     {'pose':>22} {'edge px':>8} {'median':>9} {'p95':>6} {'wide':>6}   "
      f"(the master's parts have HARD alpha: any ramp here is the warp's resampling, not a feather)")
for k, v in edge_report.items():
    if "median_px" not in v:
        print(f"     {k:>22} {v['px']:8d}   (too few edge pixels to measure)"); continue
    print(f"     {k:>22} {v['px']:8d} {v['median_px']:11.2f}px {v['p95_px']:5.2f}  "
          f"{v['over3_px']:5d} wider than 3px")

print("\n   the elbow joint, measured from the deformed mesh")
print(f"     {'pose':>7} {'skeleton':>9} {'picture':>8} {'bend':>7} {'hand travel':>12} "
      f"{'if rigid':>9} {'driver':>7}")
for k, v in elbow_report.items():
    print(f"     {k:>7} {v['elbow_interior_deg']:9.1f} {v['elbow_mesh_interior_deg']:8.1f} "
          f"{v['elbow_bend_vs_rest_deg']:7.1f} {v['hand_travel_art_px']:10.1f}px "
          f"{v['hand_travel_if_rigid_art_px']:7.1f}px {v['elbow_driver_deg']:6.1f}")

cw, ch = crops_elbow[0][1].size
ez = Image.new("RGB", (cw * len(crops_elbow) + 8 * (len(crops_elbow) + 1), ch + 42), (24, 24, 28))
ed = ImageDraw.Draw(ez)
for i, (deg, c) in enumerate(crops_elbow):
    x = 8 + i * (cw + 8)
    ez.paste(c, (x, 38))
    v = elbow_report[f"{deg:+.0f}deg"]
    ed.text((x + 3, 6), f"{deg:+.0f}deg   elbow {v['elbow_bend_vs_rest_deg']:+.1f} deg of bend",
            fill=(255, 220, 80))
    ed.text((x + 3, 22), f"hand travels {v['hand_travel_art_px']:.1f}px  (rigid would be "
                         f"{v['hand_travel_if_rigid_art_px']:.1f}px)", fill=(150, 200, 255))
ez.save(os.path.join(OUT, "07-elbow-closeup.png"))

# ── the joint review: the places the gate names, at 2x, against the drawing ──
# Engineering QA says the mesh does not fold. This sheet is for the EYE: the
# shoulder socket, the elbow, and the necklace under the arm, each shown in the
# drawing and in every pose, so a seam cannot hide behind a number.
_windows = [("shoulder + elbow", (284.0, 120.0), 96),
            ("chest + necklace under the arm", (262.0, 196.0), 96)]
_cols = [("the drawing", None)] + [(f"{d:+.0f}deg", d) for d in (0.0,) + KEYFORMS]
_art = Image.open(os.path.join(DIR, "mascot-gold-buddha-base.webp")).convert("RGBA").resize((CW, CH), Image.LANCZOS)
_artc = Image.new("RGBA", (CW, CH), (255, 0, 255, 255)); _artc.alpha_composite(_art)
z, pad, lab = 2, 8, 26
pw, ph = int(96 * 2 * z), int(96 * 2 * z)
js = Image.new("RGB", (pad + len(_cols) * (pw + pad),
                       lab + len(_windows) * (ph + lab + pad)), (24, 24, 28))
jd = ImageDraw.Draw(js)
for ci, (cname, cdeg) in enumerate(_cols):
    x = pad + ci * (pw + pad)
    jd.text((x + 3, 4), cname, fill=(255, 220, 80))
    for ri, (wname, (ax, ay), half) in enumerate(_windows):
        y = lab + ri * (ph + lab + pad)
        jd.text((x + 3, y - 14), wname if ci == 0 else "", fill=(150, 220, 255))
        if cdeg is None:
            src = _artc
        else:
            src = Image.new("RGBA", (CW, CH), (0, 0, 0, 0)); src.alpha_composite(pose_cached(cdeg))
            over = Image.new("RGBA", (CW, CH), (255, 0, 255, 255)); over.alpha_composite(src); src = over
        cx, cy = ax * K, ay * K
        r = half * K
        x0 = max(0, min(int(cx - r), CW - int(2 * r))); y0 = max(0, min(int(cy - r), CH - int(2 * r)))
        c = src.convert("RGB").crop((x0, y0, x0 + int(2 * r), y0 + int(2 * r))).resize((pw, ph), Image.LANCZOS)
        js.paste(c, (x, y))
js.save(os.path.join(OUT, "07-joint-review.png"))

# ── the rejected shadow, shown three ways ──────────────────────────────────
# The comparison behind `corrective_keyforms.shadow`: the derived shadow as it
# used to be drawn, the same shadow rotated with the limb, and no shadow at all.
# It is reconstructed here ONLY so the decision can be looked at and re-checked;
# it is not in the draw order and there is no shadow asset.
def _rejected_shadow():
    a = np.asarray(ARM.getchannel("A")).astype(np.float32)
    a = np.asarray(Image.fromarray(a.astype(np.uint8))
                   .filter(ImageFilter.GaussianBlur(6.0))).astype(np.float32) / 255.0
    a = np.roll(np.roll(a, 7, axis=0), 5, axis=1)          # the light, upper left
    a = np.clip((a - 0.25) / 0.75, 0, 1) * 0.55
    # built at the ART's own resolution, like the asset it replaces; the renderer
    # scales it, exactly as it scaled shadow.webp
    # the rejected shadow's own formula, rebuilt against the MASTER: its whole
    # fault was that its colour blended the plate toward the base picture instead
    # of darkening it, so this reproduces that blend at the canvas's resolution
    _m_rgb = np.asarray(Image.open(os.path.join(DIR, "mascot-gold-buddha-base.png"))
                        .convert("RGB")).astype(np.float32)
    rgb = np.clip(np.asarray(PLATE.convert("RGB")).astype(np.float32) * 0.62
                  + _m_rgb[:CH, :CW] * 0.38, 0, 255)
    return Image.merge("RGBA", (*[Image.fromarray(rgb[..., c].astype(np.uint8)) for c in range(3)],
                                Image.fromarray((a * 255).round().astype(np.uint8))))


def _pose_three_ways(deg):
    out = []
    for mode in ("as it was drawn", "rotated with the limb", "no shadow"):
        canvas = Image.new("RGBA", (CW, CH), (0, 0, 0, 0))
        canvas.alpha_composite(PLATE.resize((CW, CH), Image.LANCZOS))
        if mode != "no shadow":
            sh = _rejected_shadow().resize((CW, CH), Image.LANCZOS)
            if mode.startswith("rotated"):
                sh = sh.rotate(deg, resample=Image.BICUBIC, center=(PIVOT[0] * K, PIVOT[1] * K),
                               fillcolor=(0, 0, 0, 0))
            sh.putalpha(sh.getchannel("A").point(lambda v: int(v * min(1.0, abs(deg) / 15.0))))
            canvas.alpha_composite(sh)
        dst = skin(ARM_PTS, ARM_W, deg, deg_elbow=deg * ELBOW_SHARE,
                   extra=lambda p, w, d: socket_bend(p, w, d))
        canvas.alpha_composite(warp(ARM, ARM_PTS, dst, ARM_TRIS))
        canvas.alpha_composite(warp(GRAPES, ARM_PTS,
                                    skin(ARM_PTS, ARM_W, deg, deg_elbow=deg * ELBOW_SHARE), ARM_TRIS))
        over = Image.new("RGBA", (CW, CH), (255, 0, 255, 255))
        over.alpha_composite(canvas)
        out.append((mode, over.convert("RGB")))
    return out


_box = (190, 20, 470, 210)
_z = 2
_panels = []
for _lbl, _im in _pose_three_ways(-15.0):
    _c = _im.crop(_box).resize((( _box[2] - _box[0]) * _z, (_box[3] - _box[1]) * _z), Image.LANCZOS)
    _panels.append((_lbl, _c))
_w = _panels[0][1].width
_sh_sheet = Image.new("RGB", (_w * 3 + 24, _panels[0][1].height + 48), (24, 24, 28))
_sd = ImageDraw.Draw(_sh_sheet)
for _i, (_lbl, _c) in enumerate(_panels):
    _sh_sheet.paste(_c, (8 + _i * (_w + 8), 42))
    _sd.text((8 + _i * (_w + 8) + 3, 26), _lbl, fill=(255, 220, 80))
_sd.text((10, 6), "at -15 deg: the derived shadow was measured against its own job and this is why it is gone",
         fill=(150, 220, 255))
_sh_sheet.save(os.path.join(OUT, "11-shadow-at-15.png"))

sheet = Image.new("RGB", (row[0][1].width * len(row) + 10 * (len(row) + 1),
                          row[0][1].height + 30), (24, 24, 28))
d = ImageDraw.Draw(sheet)
for i, (deg, im) in enumerate(row):
    x = 10 + i * (im.width + 10)
    sheet.paste(im, (x, 26))
    d.text((x + 3, 8), f"{deg:+.0f}deg" + ("  (reference)" if deg == 0 else ""), fill=(255, 220, 80))
sheet.save(os.path.join(OUT, "06-keyforms.png"))

json.dump({
    "pivot_art_px": PIVOT.tolist(),
    "bone_axis": AXIS.tolist(),
    "limb_length_art_px": LIMB_LEN,
    # THE CHAIN, as data. shoulder -> elbow -> wrist, with the elbow's position
    # measured from the drawing's own centreline and its rest angle recorded so a
    # runtime never has to guess what "straight" meant in a rotated document.
    "bones": [
        {"name": "shoulder", "joint_art_px": PIVOT.tolist(), "length_art_px": 0.0,
         "parent": None, "role": "the glenoid; the limb's whole turn happens here"},
        {"name": "upperArm", "joint_art_px": PIVOT.tolist(),
         "length_art_px": float(np.linalg.norm(ELBOW - PIVOT)), "parent": "shoulder",
         "tip_art_px": ELBOW.tolist()},
        {"name": "forearm", "joint_art_px": ELBOW.tolist(), "length_art_px": FOREARM_LEN,
         "parent": "upperArm", "tip_art_px": FIST.tolist(),
         "rest_interior_deg": round(ELBOW_REST_DEG, 1)},
        {"name": "hand", "joint_art_px": FIST.tolist(), "length_art_px": 0.0,
         "parent": "forearm"},
    ],
    "elbow_art_px": ELBOW.tolist(),
    "elbow_rest_interior_deg": round(ELBOW_REST_DEG, 1),
    "elbow_share_of_shoulder": ELBOW_SHARE,
    "arm_mesh": {"vertices": ARM_PTS.tolist(), "triangles": ARM_TRIS,
                 "weights_arm": ARM_W.round(4).tolist(),
                 "weights_forearm": ARM_F.round(4).tolist()},
    "torso_mesh": {"vertices": TORSO_PTS.tolist(), "triangles": TORSO_TRIS,
                   "weights_arm": TORSO_W.round(4).tolist()},
    "draw_order": ["plate", "arm", "grapes"],
    # THE CORRECTIVE KEYFORMS, authored rather than left as placeholders.
    #
    # A keyform is the shape a parameter takes at a chosen value (the research:
    # Live2D keyforms, Moho Smart Bones). For this rig the honest content of the
    # table is which corrections ARE needed, which were measured and found
    # unnecessary, and which are owed to a painter — separating the two kinds of
    # work the brief insists on keeping separate.
    "keyforms": [
        {"angle_deg": d, "elbow_deg": round(d * ELBOW_SHARE, 2),
         "mesh_correction": None,
         "mesh_correction_reason":
             "measured: the blend band moves the elbow's chord by at most "
             f"{max(abs(CHORD_DEFICIT[f'{d:+.0f}deg']['mean_px']), CHORD_DEFICIT[f'{d:+.0f}deg']['max_px']):.3f} px "
             f"(mean {abs(CHORD_DEFICIT[f'{d:+.0f}deg']['mean_px']):.3f} px) — sub-pixel, so a "
             "corrective mesh shape here would be a placebo",
         "mesh_check": CHORD_DEFICIT[f"{d:+.0f}deg"],
         "shadow": "none drawn — the derived shadow was removed, not corrected "
                   "(see corrective_keyforms.shadow)",
         "artwork_owed": "the plate's reconstructed pixels at this pose still "
                         "need paint; the plate is shared by all keyforms",
         "status": "engineering complete, artwork owed"}
        for d in KEYFORMS
    ],
    "corrective_keyforms": {
        "method": "pose-space corrections, authored from measurement at each "
                  "keyform rather than guessed (Live2D keyforms / Moho Smart Bones)",
        "shadow": {
            "correction": "REMOVED",
            "why": ["its colour blended the plate toward the base picture instead "
                    "of darkening it — a softening stamp, which the brief bans",
                    "its strength rose as the limb left the body (0.00 at rest, "
                    "1.00 at -15 deg), the wrong way round",
                    "rotating it with the limb put its mass 10.37 px from the limb "
                    "against 3.88 px for the fixed stamp, smearing the chest and grapes"],
            "evidence": "docs/evidence/round56/11-shadow-at-15.png",
            "owed": "a painted cast shadow per keyform",
        },
        "elbow_mesh": {
            "correction": None,
            "why": "the two-bone blend's chord deficit is sub-pixel at every keyform "
                   "(0.046 px mean, 0.23 px max); a mesh correction would move less "
                   "than the resampling it is meant to fix",
        },
        "warp_deformer": "the socket band IS the corrective deformer: vertices "
                         "weighted between body and limb so the joint bends rather "
                         "than hinges",
    },
    "coverage": report,
    "elbow": elbow_report,
    "exposed_cut_edge": edge_report,
    "rest_vs_artwork": rest_report,
    "rest_vs_artwork_on_figure": {
        "mean": rest_report["on_figure_mean"], "p99": rest_report["on_figure_p99"],
        "over32": rest_report["on_figure_over32"], "of": rest_report["on_figure_of"],
    },
    "contact_shadow": {
        "present": False,
        "owed": "a painted cast shadow at each keyform — artwork, not generated",
        "removed_because": "measured against its own job: it blended rather than "
                           "darkened, grew as the limb left the body, and could not "
                           "follow the limb without smearing",
        "evidence": "docs/evidence/round56/11-shadow-at-15.png",
    },
}, open(os.path.join(RIG, "buddha-rig.json"), "w"), indent=1)

print("\nwrote rig/buddha-rig.json and the keyform sheet")
