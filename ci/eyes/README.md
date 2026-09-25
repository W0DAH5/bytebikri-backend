# eyes — the visual harness

Reading a diff cannot tell you whether a page looks right. Three of the worst
layout bugs in this repository were found by opening a browser and looking, and
none of them would have been caught by a test:

- a **cover image that revealed through five screens of scroll**, because a scroll
  animation was wired to the wrong range;
- a **table that pushed the whole document sideways on a phone** — one of sixteen
  tables that was not inside a scroll container;
- **dates rendering as "Sat Aug 01"**, because a `date` column was stringified.

So this folder is the third kind of verification, next to `npm test` (logic) and
CI (it boots).

## Bootstrap

```bash
ci/eyes/setup.sh          # idempotent; pulls the browser and its libraries
cd /tmp/eyes && export LD_LIBRARY_PATH=/tmp/eyes/al2023/lib
```

Chromium does **not** come from Playwright's CDN here — it is blocked in this
environment — so `setup.sh` pulls `@sparticuz/chromium` (an npm package that
ships a headless build plus its shared libraries) and unpacks it by hand. This is
why the harness is checked in rather than living in `/tmp`: it lived there for
four rounds and was destroyed twice by a workspace restore, and a verification
tool that vanishes whenever the environment is rebuilt stops verifying.

## What the harness cannot see

Two limits, both found the hard way, both worth knowing before a screenshot is read
as evidence:

- **There is no emoji font.** `fonts.tar` ships Open Sans and the container has
  DejaVu, so ★ ☆ ✕ ✓ render and **🔒 does not** — it appears as a box. Any lock
  glyph in a screenshot is the harness's gap, not a product defect. (It is also a
  reason the product should not lean on an emoji for meaning; the tier list's lock
  is `aria-hidden` decoration next to the file's title, so a box costs nothing.)
- **A section shot can look clipped while the page is fine.** `element.screenshot()`
  on an element narrower than the viewport crops to the element's own box, and a
  panel with a fixed-position ancestor can appear cut at the left edge. When a
  closeup raises a question, take a `fullPage` shot and a `clip` of the same band
  before believing it — twice this round a "clip" turned out to be the capture.

## Run

```bash
node check.mjs /admin /admin/plans /dashboard/bob@bob   # named pages, both widths
node sweep.mjs                                          # every signed-in page, + the id-bearing ones
node anon.mjs /s/ghost-store /nope                      # signed-out pages
# EYES_BASE=http://127.0.0.1:3100 points every script at a second instance
# (another port, another database) — sessions are cached per account and port.
node csvcheck.mjs                                       # the exports, end to end
node pager.mjs [/admin/audit?family=all]                # a pager that pages
node columns.mjs                                        # tables on a phone: floors, labels, headings
node bulk-click.mjs alice /dashboard/alice              # the file list's selection, ticked for real

# Accounts the harness knows (ci/eyes/pages.mjs): operator, alice, nima, bob.
# Nima's store is the demo's deliberately awkward one — her identity check is inside
# its notice window AND she is waiting on the next one, so her settings page has to
# say two things that look contradictory in one panel. Seeded states that exist on
# purpose are the ones worth checking on purpose.

# One page, one element, at a real viewport — for looking closely at one thing:
node shot.mjs /dashboard/alice/billing alice /tmp/eyes/billing.png "main#main" 900 1200
node shot.mjs "/s/alice?country=IN" "" /tmp/eyes/blocked.png ".note:has(strong)" 390 700

# A whole page as the reader scrolls it, at phone width — for reviewing a page
# end to end (and the only honest way to shoot anything under a sticky header):
node fullpage.mjs alice /dashboard/alice/earnings /dashboard/alice/networks
```

`bulk-click.mjs` exists because two claims about the seller's file list can only be
checked with a browser: that the bar's count follows the ticks, and that the bar is
pinned to the foot of the **window**. The second one was false for a whole round while
a check on the class name passed — `.panel`'s `overflow: hidden` made the form the
sticky context, so the bar stuck to the bottom of an 1,865px form. It now measures
`getBoundingClientRect().bottom` against `innerHeight`, which is the only reading that
can tell the difference.

`shot.mjs` carries two capture-hygiene lessons that cost real time: it waits under
`prefers-reduced-motion` (an entrance animation caught mid-flight reads as clipped
text — this repository went looking for a layout bug that did not exist), and it
hides the fixed consent bar (which paints over the foot of the viewport and was
captured instead of the note's last line). Both are about the CAPTURE, not the
product. The third is the reason `fullpage.mjs` exists: an element screenshot
scrolls first and clips second, so a sticky header lands inside the clip and
appears to be painted across the first row of the table.

```bash
# A store, a dashboard, a plan page — the same script, three widths.
```

`page@account` picks who is signed in (`@alice`, `@nima`, `@bob` for a seller
dashboard, operator by default). Screenshots land in `/tmp/eyes/out/` whether or not
a page is clean — useful when a finding is a judgement call rather than a rule.

### The walks, and what they need first

`walk-ads.mjs`, `break-walk.mjs`, `breaks-seller-walk.mjs` and `member-walk.mjs` drive
real flows in a real browser. Two of them are a SEQUENCE from a known state, so they
are run after the seeder rather than being self-contained:

```bash
node ci/demo-state.mjs              # the demo state, and the restore
node ci/eyes/member-walk.mjs        # three sessions, the attention door, 11 shots
node ci/eyes/premium-walk.mjs       # two payers, two schemes, motion on intent; 25 shots of its own
                                    # (21 design, 4 gifting — the folder prints one higher, for the
                                    # 4×-DPR closeup kept from §15)
node ci/eyes/reset-rent.mjs alice   # puts the rent invoice back to issued
node ci/eyes/rent-walk.mjs          # the seller's invoice, the reference, the operator's match; 5 shots
node ci/eyes/ledger-walk.mjs alice  # a storefront render, then the owner's attention ledger; 3 shots
node ci/eyes/reset-unlock.mjs bob kathmandu-sketchbook   # clear one viewer's unlock ON the comic
node ci/eyes/reader-walk.mjs alice kathmandu-sketchbook bob   # the reader: pages, the seam, the bookmark; 8 shots
```

`reader-walk.mjs` is the walk for the reader, and its subject is a file rather than a page: page one is
drawn out of a real CBZ through the signed route, the seam shows the ask *before* the page it owes, a
deep link past the seam is refused by the SERVER with the same sentence the page prints (`403 a view is
owed before this page` — read by hand, from a URL repointed at the blocked step), the network's own
signed postback turns the page, and the bookmark the reader writes brings the offer back as
*Continue reading* on the file page. Section 7 is the seller's own two choices: it flips the mode and the
direction on the file's page and then reads the buyer's reader, which must obey both and put the forward
control on the left for right-to-left. It leaves the demo file reading the way it found it. A repeat run
needs `reset-unlock.mjs`, which clears the unlock, the attempt, the view events AND the bookmark for one
(viewer, file) pair — a bookmark left behind opens the reader on the last page and makes a second run
prove nothing.

`rent-walk.mjs` is the walk for the one money path that had never been walked. It needs the invoice to
be OPEN, so it has its own reset — a paid invoice is the right outcome for a seller and a dead end for a
harness, and a walk that reset its own subject could pass without leaving the state it started in. The
fixture is Alice's store: a paid plan with two store slots, one platform slot, and traffic above the
billing floor, so the invoice exists and is small (NPR 36 for the year) rather than zero. It runs two
sessions — the seller's and the operator's — and its four steps are the four claims the flow makes: the
invoice shows its own working, submitting a reference changes nothing by itself, the operator sees the
same reference and matches it, and the seller's page and history agree that it is paid.

Section 14 is the person's own band, which is a SECOND recipe for the store band's box
and therefore a second set of numbers: the walk reads the painted surface, the ink the
words actually landed in and the mesh behind them, computes white and the 92% ink
against that surface, and stops if the palette's deep stop is not the surface or the
aurora is not running. It then visits a store's page as the same paying person to show
the band is not there, loads `/library` as somebody with no arrangement to show the
head is unchanged, and repeats the whole thing under `prefers-reduced-motion: reduce`
where the band must keep its colour and its mesh and lose only the drift.

Section 15 is the other two slots of the person's own look — the ring around the
initial and the edge of their card, six treatments each. It reads both groups of tiles,
checks that every control is drawn with the class the product renders for that value, and
chooses the round's two new treatments (a split ring and an aurora edge). Then the three
places a choice has to arrive without a round trip and then with one: the stage's avatar
and the stage itself, the account chip in the header after the save, and — seen through
carol's session, because the roster does not name the reader's own row — the person's card
on a store's roster, where the store's chip and the store's own top-tier light must both
still be there beside the person's ring and edge.

`premium-26-card-closeup.png` is that card at four device pixels to the CSS pixel, and it
is evidence of a thing a 1:1 screenshot cannot show: a two-pixel ring's colour. The tile is
the store's violet (its tier accent, and its top-tier glint), the chip is the store's violet,
and the ring, the card's edge and the name are all the member's teal — two owners on one
row, drawn at a size where a person can actually check it.

Two things that section learned the hard way. **Whose colours the ring is:** the tile on a
store's roster carries the store's palette (the tier accent, and the glint drawn from it)
AND the person's ring, so the walk reads the computed PAINT and requires the ring in the
member's own colour while the tile stays the creator's — a screenshot cannot tell you which
of two palettes a two-pixel circle is using, and the answer was wrong until it was read
this way. **Which treatments move:** the walk used to infer that from the class name
(`wear-ring` turns, everything else does not), which stopped being true when a second
moving ring existed; the tiles carry `data-demo-moves` now and the walk reads that, and it
switches rings twice to prove the stage wears exactly one at a time. It puts back exactly
what it found, so the walk is re-runnable against its own output — and it is run both from
the seeded state and from its own output, because those were different runs for a while.

Section 16 is the two surfaces where a STRANGER reads a person's look, and both of them
were broken in the same way — a query that did not select the field the renderer reads:
the seller's own member list (the page where names are read most carefully, where a
paying member appeared wearing nothing) and a review (where every paying reviewer was
painted in the fallback indigo). The walk signs in as the seller and reads the queue —
one member dressed in her own palette, one plain — and then loads a review page signed
out, because the reader is somebody who has never met the reviewer.

The walk's own selectors are part of the evidence too. Sections 1–3 measure "the painted
name on a roster row", and they used `li [class*="wear-"]` — which stopped meaning the
name the moment the avatar carried a ring of its own, because the avatar comes first in
the DOM and the default ring's class is also a `wear-`. The sections then measured a white
initial on the light theme's white page and failed at 1:1, but only on the second run —
the first run started from whatever the last pick left behind, and the walk restores the
default ring at the end. One named selector (`NAME_WEAR`), one assertion that the element
read is the name, and two consecutive runs are green.

`premium-walk.mjs` is the one walk whose subject is a DESIGN rather than a flow, and
it is measured rather than looked at: contrast is computed in the page from the
computed styles of the element and the surface behind it (so `color-mix()`, the
media queries and every fallback have already been applied), painting is read from
`background-clip`, and motion is read from `getAnimations()` — `playState` is the
only thing that can tell a paused animation from one that was never declared, since
both look still. It walks `prefers-color-scheme` in both directions and
`prefers-reduced-motion: reduce`, which is the setting a decorative animation most
often ignores.

It walks the two SHOP WINDOWS as well as the looks: the Plus page's stage (a member's
own name, updating as they choose) and the seller's chooser (pointing at a theme card
paints the real band above the grid). The store's band is checked for the claim that
makes it safe — every colour in its aurora mesh is one of the theme's two stops, so the
palette arithmetic that proves white is readable still covers the whole surface — and
for the same claim the CSS makes: under `prefers-reduced-motion: reduce` the band keeps
its gradient, its grain and its mesh, and nothing moves.

Two of those sections are about IDENTITY rather than about a look, and both are
measured off the rendered page rather than read from the stylesheet: the store's mark
is required to have the band's ink as its surface and the band's deep stop as its
letter (the pair the palette arithmetic already covers) on a plate rather than a
circle, and a tier's glyph is required to be *the same computed colour* as the chip's
ink — which is the whole of its contrast argument, since `currentColor` means there is
no second colour to check. It then chooses a different shape in the seller's own
picker, saves it, and reads it back off the storefront's roster, because a picker that
cannot round-trip is a picker that lies. The demo is put back the way it was found.

Section 13 is a FLOW rather than a design check, and it is in this walk because the
feature is about a look arriving on somebody else's name: a gift is bought by one
person, funded by an operator and redeemed by another, so the walk needs three
accounts at once (bob buys, carol receives, the operator funds) and asserts the three
things a page cannot show you — the buyer's own arrangement is untouched, a RESERVED
code is refused with a reason, and the period lands on the redeemer. It reads the
reference it will use out of the page and stamps it with the clock, because the unique
index on a reference is a real product rule and a walk that reused one would be testing
the refusal instead of the flow.

Three lessons it paid for on its first runs, all worth reusing:

- **`Element.getAnimations()` does not return pseudo-element animations.** The ring's
  motion lives on its `::after`, so it measured as `[]` while visibly turning. It
  needs `{ subtree: true }`.
- **A harness that measures "the page it happens to be on" lies at the first
  navigation.** The first cut collected selectors into one list and walked it after
  navigating to a second page; the roster measurement then found nothing and threw.
  Measure each thing on the page it lives on, in the order you visit them.
- **`scrollIntoViewIfNeeded` puts a subject UNDER the sticky header**, and the first
  shot of the theme stage had the store's own name sliced in half by the navigation.
  The capture helper now scrolls back up ~96px after bringing the subject into view.
- **A radio you styled yourself is not clickable at its own coordinates.** The glyph
  picker's inputs are transparent and sit under the shape they draw, so Playwright's
  actionability check refuses the click ("`<span data-glyph="star">` intercepts pointer
  events"). Click the LABEL — which is what a person does anyway.
- **`getBoundingClientRect()` on an SVG-shaped element reports the border box, not the
  ink.** The star's polygon hand-written from geometry measures 14×13 while the hexagon's
  measures 11×17 against a 1em box; assert on the ORDER of the sizes, never on the pixels
  of a hand-written shape.
- **The walk writes its screenshots relative to its CURRENT DIRECTORY.** The harness runs
  from `/tmp/eyes` (that is where the browser and the copied scripts live), so the four
  gifting shots landed in `/tmp/eyes/docs/evidence/round36/` while the repository kept the
  previous round's fourteen and they were nearly committed as this round's evidence. Copy
  them across before reading a shot as proof of a change — a stale screenshot is worse
  than no screenshot, because it looks like evidence.

`member-walk.mjs` starts from zero standing and no membership — that state belongs to
the seeder because it is also the state the preview should be found in — and it clears
its own unlocks first (an unlock left behind by the last run hides the button the walk
exists to press). It asserts on the copy as well as on behaviour: the point of that
walk is that a buyer is told the arrangement BEFORE they press anything.

Three capture lessons live in its history, all of them the CAPTURE and not the product:
a `fullPage` shot taken while the page was still navigating composited two documents
into one image and read as overlapping text; a storefront shot framed the cover image
rather than the control under discussion, so the walk now scrolls its subject into
view; and a member's own name is deliberately absent from their own card (the roster is
the OTHER people), which is a sentence a walk has to read carefully before asserting.

Sessions are cached in `/tmp/eyes/state-<account>-<port>.json` and **verified before
being written**, because the sign-in limiter counts successful attempts too: a sweep
that signed in per page (32 times) tripped a real product limit and then reported the
resulting 429s as page findings. The port is in the filename because a session from
one instance is meaningless against another, and reusing it would look exactly like a
refused sign-in. The verification URL is per account as well — an account's name is
not always its store's slug (`nima` runs `nima-crafts`), and a 404 on the proof URL
was being read as a failed login. An account with no store at all (carol, the demo's
buyer, whose whole purpose is to check what a PERSON sees) has no dashboard to prove
itself against, so the proof falls back to `/plus` plus the sign-out control — the
difference between "her page rendered" and "the sign-in page did".

## columns.mjs — the tables

The only check that measures something the stylesheet PROMISES, rather than
something a page looks like. It exists because the phone table bug came back once
already, one column over from where it was fixed.

Per table, at phone width:

1. **The floor.** Inside `.panel-body`, `.panel-body-flush` and `.table-scroll`,
   the first cell is at least 11rem. The number is read off the page's own root
   font size, so changing the rule in `styles.css` changes the check with it.
2. **The wrapping.** No cell under 10rem holds text wrapped to four or more lines.
   Line counts come from `Range.getClientRects()` — the lines a reader sees — not
   from `height / line-height`, which counts metadata that is *meant* to wrap and
   called thirteen healthy tables crushed.
3. **The labels.** For a table the stylesheet stacks (`.table-stacked`), every cell
   after the first carries a `data-label`, because that attribute is the only thing
   printing a label on a phone. A cell without one is a bare number under nothing.
4. **The exemption.** A stacked table's first cell has no min-width — the floor
   there would push the page sideways, the failure this whole file guards against.
5. **The headings.** Every body row has as many columns as the header says it does,
   counting `colspan`. Cheapest rule here; found a four-column header over a
   three-cell body on its first run.
6. **Five columns fit nowhere.** A table five columns or wider that is wider than the
   box it scrolls in must be stacked. It was a report before it was a rule, and it
   named nine tables — one of which cut a Plan chip in half, so a store on the Store
   plan read "STO". A narrower table that scrolls is left alone: the shadow cue is
   there for exactly that.

The label rule measures as well as asserts: it checks the line of room a rendered
label takes above the cell's own text, so an attribute the stylesheet stops drawing
fails the run instead of passing quietly. (Verified against a deliberate break —
with `td::before { display: none }` injected, the gap collapses from 19px to 2px.)

```bash
node columns.mjs                    # every signed-in page
node columns.mjs /admin/users       # one page
EYES_MIN_CELL=180 node columns.mjs  # change the crush threshold, not the rule
```

Exit code is 1 when anything is found, so it drops into CI as it stands.

**What it does not fail on:** a table under five columns that is wider than its box.
That is the stylesheet's own supported pattern — a table may scroll in its own box,
with the cue that it does — and a narrow one that scrolls loses nothing. Those are
counted and named at the end of every run so the list stays a measurement rather
than a hunt.

## What the sweep checks

Per page, per viewport:

1. **The document does not scroll sideways.** On a phone that is the worst layout
   failure there is; every paragraph moves under the reader's thumb. Elements
   inside a horizontal scroller are exempt on purpose — a table is *allowed* to
   scroll in its own box.
2. **Nothing sticks out of the viewport** without a scroller to explain it, named
   so the fix is a one-line lookup.
3. **Nothing is in the DOM but invisible** (a reveal that never fired, or
   decoration with a size and no paint). `.scroll-progress`, `.dot` and
   `aria-hidden` are exempt: a false positive costs more than it finds.

Console errors are reported alongside, with expected 404s on 404 pages ignored.

## Limits worth knowing

- It measures geometry, not taste. "Clean" means *nothing is broken*, not *this is
  good* — the screenshot still has to be looked at.
- The page list is in `pages.mjs`, and the pages whose URL carries an id are FOUND
  rather than listed: the harness opens the page that links to them and reads the
  hrefs out of the same markup a person clicks. It used to be a hardcoded list, and
  two pages could not be on it at all — the seller's page for one file and the
  operator's decision page for one file — because the id changes on every reseed.
  When that was fixed, three rule-6 violations turned up on exactly those two pages,
  in the one place nothing had ever looked.
- It cannot login-throttle around the product's own limiters, so it reuses
  sessions; a check that needs a fresh no-cookie state has to say so.
- The 404-page allowance is a string match on the console line. A page that
  legitimately fetches something missing will be reported, and that is usually
  worth knowing anyway.
