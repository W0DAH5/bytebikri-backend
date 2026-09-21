// ============================================================================
//  CSV exports
// ============================================================================
//  Three exports (stores, people, earnings) had grown their own copy of the same
//  escaper and two of them shared the same silent bug. The escaper is one function
//  because a CSV that quotes correctly in one file and not another is a bug that
//  surfaces in somebody's spreadsheet, not in a test run: a comma in a store name
//  shifts every column after it and the file still opens.
//
//  The paging rule is here for the same reason. `perPage: 100` on one page of a
//  four-thousand-row table looked like an export and was a misread waiting to
//  happen, so the loop lives next to the note that admits when it stopped early.
// ============================================================================

/** One CSV field. Quotes when — and only when — the value needs it. */
export function csvCell(value) {
  const str = value === null || value === undefined ? '' : String(value);
  return /[",\n\r]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

/** A header plus rows, as one CSV document. Always ends with a newline. */
export function csvDocument(head, rows) {
  return `${head.map(csvCell).join(',')}\n${rows.map((r) => r.map(csvCell).join(',')).join('\n')}\n`;
}

/**
 * Every row a filter matches, assembled from pages.
 *
 * Pages until the set is exhausted or the ceiling is reached, and reports which
 * happened. A truncated export is worse than no export: it reconciles cleanly
 * against nothing, and the person doing the reconciling blames their own figures.
 */
export async function exportAll(fetchPage, { perPage = 100, maxRows = 5000 } = {}) {
  const rows = [];
  let total = null;
  for (let page = 1; rows.length < maxRows; page += 1) {
    const chunk = await fetchPage({ page, perPage });
    if (total === null) total = Number(chunk.total ?? chunk.rows.length);
    rows.push(...chunk.rows);
    // A short page means the end of the set. Checking it first avoids one more
    // round trip per export, and `0` guards a fetch that reports a total it
    // cannot actually return rows for.
    if (chunk.rows.length < perPage || chunk.rows.length === 0) break;
  }
  const capped = rows.slice(0, maxRows);
  const known = total ?? capped.length;
  // `exported` is returned alongside `rows` so the note can be built from this
  // object directly. The first version left it out, and the note then printed
  // "[object Object]" once per row — a failing test caught it, but only because
  // the test asserted the SHAPE of the note and not just that one existed.
  return { rows: capped, total: known, exported: capped.length, truncated: known > capped.length };
}

/**
 * The closing line an export carries when it could not carry everything.
 *
 * Two cells, so it can never be mistaken for a data row, and it starts with a
 * hash so it reads as a comment in every spreadsheet and every grep. The
 * filename says the same thing — belt and braces, because the filename is what
 * survives somebody emailing the file to their accountant.
 */
export function truncationNote({ truncated, total, exported }) {
  if (!truncated) return '';
  // The counts decide, not the flag. A flag that says "cut" while the counts are
  // equal is a caller passing a stale value, and the honest answer there is
  // silence rather than a warning about a file that is actually whole.
  if (total > 0 && exported >= total) return '';
  // …and when the total is unknown (0, or missing) a capped export must still
  // admit it, because that is precisely the case where an incomplete file looks
  // complete: nothing to compare against, a full-looking page count, and a
  // spreadsheet that reconciles against the wrong number.
  const size = total > 0
    ? `exported ${exported} of ${total} rows`
    : `exported ${exported} rows and the total is not known`;
  return `\n# note,${size} — this file is INCOMPLETE. Narrow the filters and export again, or page through the console.\n`;
}
