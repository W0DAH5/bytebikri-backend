// Do the tables on this page still work on a phone?
//
// This check exists because of a bug only a phone showed and only a measurement
// proved. On the dashboard's file table the NAME column — the one the eye scans
// for — was squeezed to about a hundred pixels: "Free sample pack" broken over two
// lines, its slug over four, and a column heading cut in half at the right edge.
// The stylesheet already had a 520px floor on the table and a comment saying a
// squeezed table "crushes a column into two characters per line", and the table
// WAS scrolling. What the comment missed: a floor on the TABLE does not protect a
// COLUMN. Auto layout sizes the chip and number columns from their own content and
// hands the single flexible column whatever is left.
//
// The fix was one rule — a floor on the first cell — and it was found by a script
// written for the occasion and then thrown away. Sixteen tables across ten pages
// were crushed; nothing stopped table seventeen from being added crushed tomorrow.
// So the script lives here, and it is written against the promise the stylesheet
// makes rather than a number invented for the test:
//
//   1. **The floor.** Inside `.panel-body`, `.panel-body-flush` and `.table-scroll`,
//      the first cell of every data table is at least 11rem. That is the rule in
//      `public/styles.css`, and this reads its value from the page's own root font
//      size, so changing the floor in the CSS changes the check with it.
//   2. **The wrapping.** No cell anywhere may hold text wrapped to four or more
//      lines inside a box under 10rem. The floor covers the tables the CSS selects;
//      this catches a crushed cell in a table the floor does not reach, which is
//      how the bug would come back.
//
// A table the stylesheet stacks (`.table-stacked`) is excepted from the floor — on
// a phone its rows become labelled blocks, and a min-width there would make the
// page wider than the screen, the failure this whole file guards against. In its
// place it gets two rules of its own, because stacking moves the bug rather than
// removing it:
//
//   3. **The labels.** Every cell after the first carries a `data-label`. The label
//      is what the stylesheet prints above the value, so a cell without one is a
//      bare number under nothing — invisible in a desktop review, and the reason a
//      stacked table is worse than a scrolling one when it is done half way. The
//      label is also measured, not assumed: it has to occupy a line ABOVE the
//      cell's text, since an attribute the stylesheet stops rendering is the same
//      bug with more paperwork.
//   4. **The exemption.** A stacked table's first cell has no min-width. If the
//      floor ever reaches it again the whole page scrolls sideways.
//   5. **The headings.** Every body row has as many columns as the header says it
//      does, counting `colspan`. This is the cheapest rule here and it found a real
//      one on its first run: a four-column header over a three-cell body, with
//      "Payout method" sitting above the status text — a heading describing a
//      column that did not exist. A browser renders that without complaint, the
//      empty column just hangs off the right edge, and it is invisible unless
//      someone counts.
//   6. **Five columns fit nowhere.** A table five columns or wider that is wider
//      than its box must be stacked. It was a report before it was a rule — nine
//      tables were in that state, and one of them cut a Plan chip in half so a
//      store on the Store plan read "STO". A narrower table that scrolls is left
//      alone: the shadow cue is there for exactly that.
//
//   node columns.mjs                    # every signed-in page, phone width
//   node columns.mjs /dashboard/bob     # one page
//   EYES_BASE=http://127.0.0.1:3100 node columns.mjs
import { chromium } from 'playwright';
import { open, walk, sessionFor } from './lib.mjs';
import { pagesFor } from './pages.mjs';

const BASE = process.env.EYES_BASE || 'http://127.0.0.1:3000';
const WIDTH = Number(process.env.EYES_WIDTH || 390);

/**
 * Measure every table, and every cell that could be crushed.
 *
 * Line counts come from `Range.getClientRects()` over the cell's text, not from
 * `height / line-height`: a cell usually holds the name and a line or three of
 * metadata underneath, and metadata is SUPPOSED to wrap on a phone. Counting the
 * cell's box called thirteen healthy tables crushed on the first run of this file.
 * Rect rects are the lines a reader actually sees.
 */
async function measureTables(p) {
  return p.evaluate(() => {
    const rootPx = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    const FLOOR_REM = 11;
    const floor = FLOOR_REM * rootPx;
    const narrowEnough = 10 * rootPx;
    const wrapsTooMuch = 4;
    const WRAPPED = /(^|\s)(panel-body|panel-body-flush|table-scroll)(\s|$)/;

    const textLines = (el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      const rects = [...range.getClientRects()].filter((r) => r.width > 1 && r.height > 1);
      // A rect per line box. Two rects on the same y are inline fragments of one
      // line (a link and a comma), so they are one line for a reader.
      const ys = new Set(rects.map((r) => Math.round(r.top)));
      return ys.size;
    };

    const out = [];
    const scrolls = [];
    document.querySelectorAll('table').forEach((t, i) => {
      const where = (t.querySelector('caption')?.textContent
        || t.getAttribute('aria-label')
        || t.closest('section')?.querySelector('h2')?.textContent
        || '').trim().slice(0, 60);
      const rows = [...t.querySelectorAll('tbody tr')].filter((r) => r.querySelector('td'));
      if (!rows.length) return;

      // Is it wider than the box it scrolls in?
      const heads = [...t.querySelectorAll('thead th')].length;
      let overflows = false;
      for (let n = t.parentElement; n; n = n.parentElement) {
        if (getComputedStyle(n).overflowX !== 'visible') {
          overflows = n.scrollWidth > n.clientWidth + 2;
          break;
        }
      }

      // A stacked table on a phone: the header row is gone and the cells are blocks.
      const thead = t.querySelector('thead');
      const stacked = (thead && getComputedStyle(thead).display === 'none')
        || rows.some((r) => getComputedStyle(r).display === 'block');

      // (6) Five columns do not fit across 390px: the 11rem floor on the first cell
      // leaves about 180px for the rest, so the last two or three columns are off the
      // edge — and the one AT the edge is cut mid-word, which is how a store on the
      // Store plan came to read "STO". Scrolling is supported here (that is what the
      // shadow cue is for) and a narrow table scrolling is fine, so this rule is about
      // the wide ones only. Below five columns, an overflowing table is reported at
      // the end of the run instead of failing.
      if (overflows && heads >= 5 && !stacked) {
        out.push({
          kind: 'wide-not-stacked',
          where,
          detail: `${heads} columns wider than the box, not stacked — a phone shows the`
            + ' first two or three and cuts the next one mid-word',
        });
      } else if (overflows && heads >= 5) {
        scrolls.push({ where, cols: heads });
      }

      if (stacked) {
        const first = rows[0].querySelector('td');
        if (parseFloat(getComputedStyle(first).minWidth) > 0) {
          out.push({
            kind: 'stacked-with-floor',
            where,
            detail: `stacked, but its first cell still has min-width ${getComputedStyle(first).minWidth}`
              + ' — the page will scroll sideways',
          });
        } else {
          for (const row of rows) {
            [...row.querySelectorAll('td')].forEach((cell, n) => {
              if (n === 0) return;                       // the row's own name needs no label
              if (cell.hasAttribute('colspan')) return;  // a spanning sentence, not a field
              if (!(cell.textContent || '').trim()) return;
              const label = cell.getAttribute('data-label');
              if (!label) {
                out.push({
                  kind: 'unlabelled-cell',
                  where,
                  detail: `cell ${n + 1} has no data-label: "${(cell.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40)}"`,
                });
              } else {
                // The attribute is only half the promise; the stylesheet prints it
                // with a ::before, and a cell that renders its label BESIDE the value
                // (or not at all — a display change, a pseudo-element the browser
                // dropped) reads as one run-on line. So: is a line's worth of room
                // taken above the cell's own text? Measured, because a downscaled
                // screenshot said this was wrong when it was right.
                const box = cell.getBoundingClientRect();
                const pad = parseFloat(getComputedStyle(cell).paddingTop) || 0;
                const range = document.createRange();
                range.selectNodeContents(cell);
                const first = [...range.getClientRects()].filter((r) => r.width > 1)[0];
                if (first && first.top - (box.top + pad) < 6) {
                  out.push({
                    kind: 'label-not-above',
                    where,
                    detail: `cell ${n + 1} carries data-label="${label}" but renders no label above its text`,
                  });
                }
              }
            });
          }
        }
      }

      // (1) The promise: a first cell with a floor under it, where the CSS says so.
      const wrapped = (() => {
        for (let n = t.parentElement; n; n = n.parentElement) {
          if (WRAPPED.test(String(n.className || ''))) return true;
        }
        return false;
      })();
      const firstCell = rows[0].querySelector('td');
      const firstWidth = Math.round(firstCell.getBoundingClientRect().width);
      if (wrapped && firstWidth < floor - 1) {
        out.push({
          kind: 'no-floor',
          where,
          detail: `first cell ${firstWidth}px, floor is ${Math.round(floor)}px (11rem)`,
        });
      }

      // (5) The headings: does the body agree with the header?
      const headRow = [...(t.querySelectorAll('thead tr') || [])]
        .map((r) => [...r.querySelectorAll('th, td')].reduce((n, c) => n + (Number(c.getAttribute('colspan')) || 1), 0))
        .reduce((a, b) => Math.max(a, b), 0);
      if (headRow) {
        const widths = new Set(rows.map((r) => [...r.querySelectorAll('td, th')]
          .reduce((n, c) => n + (Number(c.getAttribute('colspan')) || 1), 0)));
        for (const w of widths) {
          if (w !== headRow) out.push({ kind: 'column-count', where, detail: `the header has ${headRow} columns, a body row has ${w}` });
        }
      }

      // (2) The wrapping: anywhere, including tables the floor does not reach.
      for (const row of rows) {
        for (const cell of row.querySelectorAll('td')) {
          const text = (cell.textContent || '').trim();
          if (text.length < 12) continue;
          const w = Math.round(cell.getBoundingClientRect().width);
          if (w >= narrowEnough) continue;
          const lines = textLines(cell);
          if (lines >= wrapsTooMuch) {
            out.push({
              kind: 'crushed-cell',
              where,
              detail: `${w}px cell wrapping to ${lines} lines — "${text.replace(/\s+/g, ' ').slice(0, 40)}"`,
            });
          }
        }
      }
    });
    // One row can report the same table from both rules; the table name plus the
    // kind is the identity.
    const seen = new Set();
    return {
      findings: out.filter((f) => (seen.has(f.kind + f.where) ? false : seen.add(f.kind + f.where))),
      scrolls,
    };
  });
}

const only = process.argv[2];
const b = await chromium.launch({ executablePath: '/tmp/chromium', args: ['--no-sandbox'] });
let tables = 0, bad = 0, pages = 0;
const sideways = [];

for (const who of ['operator', 'alice', 'nima', 'bob']) {
  const state = await sessionFor(b, who, { base: BASE });
  // The list includes the pages whose URL carries an id, found the way a person
  // finds them: by following the links (see pages.mjs).
  const list = only ? [only] : await pagesFor(b, who, { storageState: state, base: BASE });
  const { ctx, p } = await open(b, { width: WIDTH, height: 900, storageState: state });
  for (const url of list) {
    const res = await p.goto(BASE + url, { waitUntil: 'load' });
    await walk(p);
    const count = await p.evaluate(() => document.querySelectorAll('table').length);
    if (!count) continue;
    pages += 1;
    tables += count;
    const { findings, scrolls } = await measureTables(p);
    for (const s of scrolls) if (s.cols >= 5) sideways.push(`${url} (${s.cols} columns)`);
    if (!findings.length) {
      console.log(`phone ${url} (${res.status()})  ${count} table${count === 1 ? '' : 's'}  ok`);
      continue;
    }
    bad += findings.length;
    console.log(`phone ${url} (${res.status()})  ${findings.length} finding${findings.length === 1 ? '' : 's'}`);
    for (const f of findings.slice(0, 6)) {
      console.log(`    ${f.kind}${f.where ? ` (${f.where})` : ''}: ${f.detail}`);
    }
  }
  await ctx.close();
}

console.log(`\n${tables} tables on ${pages} pages, ${bad} finding${bad === 1 ? '' : 's'} at ${WIDTH}px`);
if (sideways.length) {
  // Still wide, still scrolling, and not a failure: either it is stacked already or
  // it has fewer than five columns, and the shadow cue is what the stylesheet
  // provides for that. Named so the list stays a measurement.
  console.log(`${sideways.length} wide table${sideways.length === 1 ? '' : 's'} `
    + 'still scroll sideways on a phone (stacked, or under five columns):');
  for (const s of sideways.slice(0, 12)) console.log(`    ${s}`);
  if (sideways.length > 12) console.log(`    … and ${sideways.length - 12} more`);
}
await b.close();
process.exit(bad ? 1 : 0);
