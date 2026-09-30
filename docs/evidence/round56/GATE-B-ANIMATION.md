# GATE B — does it move right?

**Verdict: the shoulder no longer tears open, and I am not claiming the motion is
finished.** Gate A passes at the same time (0 px differ from the master), which is
the point of keeping them separate: the artwork being intact must not be used to
excuse the movement, and it isn't.

    python3 app/scripts/buddha-rig-art.py     # the plate and the layers
    python3 app/scripts/rig-buddha.py         # the poses   (~23 s)
    python3 app/scripts/gate-b-animation.py   # the sheet   (23-gate-b-poses.png)

## What was wrong, and how it was found

### 1. The shoulder tore open to the page

The -15° pose had a jagged hole across the arm's root — the arm read as detached
from the body, which is the first failure on the brief's list. It was not a mesh
fault: the bone chain is anatomically right (`33-bone-chain-on-the-artwork.png` —
shoulder at the root, elbow mid-mass, fist at the grip, elbow interior 157.6°
against the drawing's 22° budget).

It was the **clean plate's classification of what is behind the limb**. The
evidence the last build used is `part-plate-armless.webp`, the artist's arm-down
state — and that artwork is transparent wherever the *lowered arm* hung, which is
exactly where the *raised arm* is attached to the body. So "background behind the
limb" came out true across the whole root, the plate was made transparent there,
and the first swing lifted the root away from the robe and left the page showing
through the middle of the figure.

### 2. The boundary was a staircase

The artist's plate answers in 768, so upscaled and thresholded its boundary is
2-px steps with thin slivers crossing the limb. Measured on the boundary itself:
1,613 px of boundary around 48,005 px of area, i.e. a very ragged contour.

### 3. The coverage number did not mean what it said

`uncovered_px` counted every pixel a swing revealed, as if all of them were
defects. A limb raised away from a backdrop *uncovers the backdrop* — that is the
shot. The number conflated that with a genuine hole inside the figure, so it
reported 32,490 and could not tell the two apart.

## What changed

**The apron.** A band inside the limb's own boundary, grown from the
body-adjacent boundary only — never from the boundary that faces the background,
which is why the sky between the arm and the landscape survives untouched. 13,323
px, depth 10 px at master resolution (1.1 display px in the scene). Where the limb
touches the body it is attached to the body, so the plate is body there, and the
root can no longer tear. It is asserted: `plate_a[APRON] == 1.0` or the script
fails.

**The boundary, smoothed.** Median-7 plus a 2 px opening: boundary 1,613 → 1,049
px for 937 px of area, and 937 master px is a tenth of a display pixel. The gaps
that remain are the master's own silhouette contour.

**The metric, split.** `vacated` / `see-through pockets` / `open to the page`, and
the print explains what each means instead of asserting a verdict.

## The measured side of the checklist

| | before | after |
|---|---|---|
| vacated at −15° | 32,490 px | 23,554 px |
| reconstructed body behind the limb | 10,114 px | 20,287 px |
| seam step (master's own local contrast 4.99) | 12.96 | **0.48** |
| detail the fill copied, mean \|dL/dx\| | — | 10.32 → 10.24 (a blur would flatten it) |
| coverage at rest | 987,980 | 987,980 |
| Gate A | PASS | PASS (0 px differ, mean 0.000) |
| rig rest pose vs the master | 0 px | 0 px of 1,572,864 |
| limb width per pose | — | 0.96–1.00× |
| inverted triangles | — | 0 of 330 |
| elbow corrective | — | sub-pixel (mean 0.046 px at −15°), so `none` |

## What is still not right, plainly

* **The swing leaves see-through pockets.** 23,554 px at −15°, 9,764 px at +6°.
  They are pockets rather than open page because the posed silhouette closes
  around them. The plate is transparent across them on the artist's own evidence
  — the arm-down artwork shows background behind the arm there — so the page shows
  through, and the alternative is inventing backdrop, which the brief forbids. At
  production scale the scene is drawn at 172 CSS px, so −15° uncovers about 295
  CSS px²: a dark notch roughly 17×17 px behind the shoulder. Whether that reads
  as a gap of light behind a raised arm or as a hole is a judgement on
  `37-shoulder-final.png`, not on this page.
* **20,287 px of reconstructed gold still needs a painter.** `regions.json` names
  them per region with provenance, and `rig-qa.py` prints the gradient energy each
  region has to beat (23.65–26.79 against the drawing's own texture of 40.12).
* **The eight-item visual checklist is not signed off here.** No shoulder gap, no
  ripped cutout edge, no collapsing arm, no necklace discontinuity, no impossible
  elbow, no lighting discontinuity, no exposed missing pixels, no gold tearing —
  these are looked at on the sheet, at a size where a shoulder gap is visible,
  and that has not been done by eye front to back for this build.
* **Nothing is wired into production animation.** By the user's ordering: the
  source comes first.

## How far can this arm honestly rotate? (swept, not guessed)

`RIG_KEYFORMS=-15,-7,6` overrides the diagnostic angles, so the envelope was
swept rather than argued. Vacated pixels are what the swing uncovers; CSS px is
that area at production scale (the scene is drawn 172 px wide, so one master
pixel is 0.112 CSS px — 12,400 master px to the CSS pixel²); *deepest reach* is
how far the far side of the largest pocket is from any artwork, measured with a
chamfer distance:

| angle | vacated | CSS px¹ | largest pocket | deepest reach |
|---|---|---|---|---|
| 0° | 0 | 0.0 | 0 | 0.0 px |
| −3° | 12,064 | 151 | 11,200 | 43.0 px |
| −5° | 14,010 | 176 | 12,339 | 44.7 px |
| −8° | 17,416 | 218 | 15,098 | 47.0 px |
| −11° | 20,290 | 254 | 19,297 | 50.6 px |
| −15° | 23,574 | 296 | 22,445 | 52.6 px |

The pocket is 84–95% of the vacated area at every angle and is **established by
−3°**: the artwork's hidden region has a hard edge, not a gradient, so this is not
a tearing rig that fails at −15° — it is a finite illustration that runs out of
hidden art almost immediately, and the rest of the sweep only deepens it by 10 px.
`40-angle-sweep.png` shows the same sweep at the card's real size (drawn 172 px,
shown at 2×), where the poses read as a natural lift.

**What that means, plainly: at production scale this passes the eye; at 1:1 it is
a hole of 296 CSS px² and I am not going to call it seamless.** The alternatives
are all worse or forbidden — inventing backdrop (the brief forbids it), keeping
the arm's rest gold under the raised arm (the stale-cluster defect, one limb
over), or narrowing the motion to roughly −3°, which costs the gesture its
expressive range. The real fix is artwork: the artist would paint what the raised
arm exposes, exactly as Live2D's own guide instructs for this situation ("draw the
back of the elbow, which is currently hidden"). That is a decision for the user,
not for this script to make silently.

¹ rounded; the column is CSS px².

## One thing worth knowing before the next pass

The arm's pivot is the glenoid at (536,292) in master pixels and −15° swings the
hand 60.9 px. The tear scale is a function of how far the root rotates: the
apron makes the root body-backed for 10 px, so a larger swing eventually reaches
outside it. If the production motion needs more than ±15°, the apron depth is the
number to revisit — and a pivot nearer the arm's true attachment point would tear
less for the same hand travel, at the cost of the shoulder's own volume staying
still while the arm turns inside it.
