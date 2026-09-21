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
```

`page@account` picks who is signed in (`@bob` for a seller dashboard, operator by
default). Screenshots land in `/tmp/eyes/out/` whether or not a page is clean —
useful when a finding is a judgement call rather than a rule.

Sessions are cached in `/tmp/eyes/state-<account>.json` and **verified before
being written**, because the sign-in limiter counts successful attempts too: a
sweep that signed in per page (32 times) tripped a real product limit and then
reported the resulting 429s as page findings. Two logins per sweep now.

## What it checks

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
- It cannot login-throttle around the product's own limiters, so it reuses
  sessions; a check that needs a fresh no-cookie state has to say so.
- The 404-page allowance is a string match on the console line. A page that
  legitimately fetches something missing will be reported, and that is usually
  worth knowing anyway.
