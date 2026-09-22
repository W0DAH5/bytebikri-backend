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

## Run

```bash
node check.mjs /admin /admin/plans /dashboard/bob@bob   # named pages, both widths
node sweep.mjs                                          # every signed-in page
node anon.mjs /s/ghost-store /nope                      # signed-out pages
# EYES_BASE=http://127.0.0.1:3100 points every script at a second instance
# (another port, another database) — sessions are cached per account and port.
node csvcheck.mjs                                       # the exports, end to end
node pager.mjs [/admin/audit?family=all]                # a pager that pages
node columns.mjs                                        # tables on a phone: floors, labels, headings

# One page, one element, at a real viewport — for looking closely at one thing:
node shot.mjs /dashboard/alice/billing alice /tmp/eyes/billing.png "main#main" 900 1200
node shot.mjs "/s/alice?country=IN" "" /tmp/eyes/blocked.png ".note:has(strong)" 390 700

# A whole page as the reader scrolls it, at phone width — for reviewing a page
# end to end (and the only honest way to shoot anything under a sticky header):
node fullpage.mjs alice /dashboard/alice/earnings /dashboard/alice/networks
```

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

`page@account` picks who is signed in (`@bob` for a seller dashboard, operator by
default). Screenshots land in `/tmp/eyes/out/` whether or not a page is clean —
useful when a finding is a judgement call rather than a rule.

Sessions are cached in `/tmp/eyes/state-<account>.json` and **verified before
being written**, because the sign-in limiter counts successful attempts too: a
sweep that signed in per page (32 times) tripped a real product limit and then
reported the resulting 429s as page findings. Two logins per sweep now.

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
- `sweep.mjs` and `columns.mjs` walk a LIST of pages, so pages whose URL carries an
  id (a file, an operator's decision page) are in neither until a walk opens them.
  A layout regression there is invisible to both.
- It cannot login-throttle around the product's own limiters, so it reuses
  sessions; a check that needs a fresh no-cookie state has to say so.
- The 404-page allowance is a string match on the console line. A page that
  legitimately fetches something missing will be reported, and that is usually
  worth knowing anyway.
