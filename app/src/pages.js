/**
 * The page model: what a "read" file actually is, once you count.
 *
 * §5.1 calls a read an ordered image set, and §5.3's planner already knows how to
 * place a between-chapter gate — "after page 13 and page 27" of a forty-page read.
 * It was being told `files.length`, which for a single CBZ is **one**, so a
 * forty-page comic could carry no gate at all and the planner's own arithmetic
 * could never run. This module is the missing count, and it is the whole reason the
 * reader exists as a slice rather than as a viewer bolted on later.
 *
 * Four rules, each of them a decision about somebody else's upload:
 *
 * 1. **Natural order, not alphabetical.** `10` comes after `9`. The convention that
 *    makes an alphabetical sort work is zero-padding (`001.jpg`), which we honour
 *    by agreeing with it wherever it is used, and repair where it is not.
 * 2. **Filtered, never reordered.** `__MACOSX/`, `.DS_Store`, resource forks and
 *    `ComicInfo.xml` are not pages. Nothing else is dropped — in particular a
 *    `cover.jpg` stays exactly where it sorts, because moving it to the front would
 *    be inventing an order the seller did not choose.
 * 3. **A file is a chapter when there is more than one of them.** A twelve-file set
 *    is twelve steps and the word on them is "chapter"; the pages inside one archive
 *    (or the files of a one-file set) are "page". The word travels with the step so
 *    the reader's own sentence about a gate says "after page 90" or "after chapter
 *    4" — whichever the person is actually looking at.
 * 4. **An archive that cannot be read is still a step.** A damaged CBZ, a ZIP64, a
 *    bomb: the file keeps its place in the sequence as something to download, and
 *    the refusal sentence is carried alongside it. Dropping it silently would take
 *    a chapter out of somebody's comic.
 *
 * The archive listing is cached by (file, checksum) because the page count is needed
 * whenever a plan is derived — on every asset-page render — and re-reading a
 * store's comic from disk to count it would be work with no answer in it.
 */
import { listArchive, archiveSentence, ZIP_CAPS } from './archive.js';

/** How a reader is allowed to present a page, and which way it turns. */
export const READ_MODES = ['page', 'scroll'];
export const READ_DIRECTIONS = ['ltr', 'rtl'];
export const readMode = (value) => (READ_MODES.includes(value) ? value : 'page');
export const readDirection = (value) => (READ_DIRECTIONS.includes(value) ? value : 'ltr');

const IMAGE_EXT = new Map([
  ['jpg', 'image/jpeg'], ['jpeg', 'image/jpeg'], ['png', 'image/png'],
  ['webp', 'image/webp'], ['gif', 'image/gif'], ['avif', 'image/avif'], ['bmp', 'image/bmp'],
]);
const ARCHIVE_EXT = new Set(['cbz', 'zip']);
const PDF_EXT = new Set(['pdf']);

const extOf = (name) => {
  const base = String(name || '').split('/').pop() || '';
  const dot = base.lastIndexOf('.');
  return dot < 0 ? '' : base.slice(dot + 1).toLowerCase();
};

/** What this page is, by the only thing we can trust about a name: its extension. */
export const pageMime = (name) => IMAGE_EXT.get(extOf(name)) || null;
export const isPageName = (name) => Boolean(pageMime(name));
export const isArchiveName = (name) => ARCHIVE_EXT.has(extOf(name));
export const isPdfName = (name) => PDF_EXT.has(extOf(name));

/**
 * Junk that archives carry and readers must ignore.
 *
 * These are all "a file about a file": macOS resource forks and its archive folder,
 * Windows' thumbnail cache, Linux's desktop entry. None of them is a page, and one
 * of them (`__MACOSX/…jpg`) can carry an image extension while being binary junk —
 * which is exactly why the folder is checked and not only the extension.
 */
const JUNK_RE = /(^|\/)(__MACOSX\/|\.DS_Store$|Thumbs\.db$|desktop\.ini$|\._[^/]*$|\.git\/|\.svn\/)/i;
const METADATA_RE = /(^|\/)(ComicInfo\.xml|metadata\.(opf|xml)|comicinfo\.json)$/i;
export const isJunkPath = (name) => JUNK_RE.test(String(name || ''));
export const isMetadataPath = (name) => METADATA_RE.test(String(name || ''));

/**
 * Natural comparison: digits are numbers.
 *
 * `page2` sorts before `page10`, and `Page 2.png` sorts before `page 2.png` by the
 * tie-break rather than by accident of case order. Written as a comparator so it can
 * be handed straight to `sort`, which is also how the stability comes free.
 */
export function naturalCompare(a, b) {
  const left = String(a ?? '');
  const right = String(b ?? '');
  const ax = left.toLowerCase();
  const bx = right.toLowerCase();
  let i = 0;
  let j = 0;
  while (i < ax.length && j < bx.length) {
    const da = /[0-9]/.test(ax[i]);
    const db = /[0-9]/.test(bx[j]);
    if (da && db) {
      let ni = i;
      let nj = j;
      while (ni < ax.length && /[0-9]/.test(ax[ni])) ni += 1;
      while (nj < bx.length && /[0-9]/.test(bx[nj])) nj += 1;
      // `Number`, not string length: 0010 and 10 are the same page number, and the
      // long form only exists to survive a sort someone else is doing.
      const na = Number(ax.slice(i, ni));
      const nb = Number(bx.slice(j, nj));
      if (na !== nb) return na - nb;
      i = ni;
      j = nj;
      continue;
    }
    if (ax[i] !== bx[j]) return ax[i] < bx[j] ? -1 : 1;
    i += 1;
    j += 1;
  }
  if (ax.length !== bx.length) return ax.length - bx.length;
  // The same name in two cases: the original case decides, so the order is total.
  return left === right ? 0 : (left < right ? -1 : 1);
}

/**
 * The entries of an archive that are pages, in reading order.
 *
 * Ties are impossible after filtering (two entries cannot share a name in a zip), so
 * the comparator is total and the order is a fact rather than an artifact of the sort
 * implementation.
 */
export function orderEntries(entries = []) {
  return entries
    .filter((e) => !e.directory && !isJunkPath(e.name) && !isMetadataPath(e.name) && isPageName(e.name))
    .slice()
    .sort((a, b) => naturalCompare(a.name, b.name));
}

/**
 * The archive's index, memoised per file.
 *
 * Keyed by the checksum when there is one and by size otherwise, so a re-upload that
 * reuses the id is not answered from the old archive's cache. The cache is small on
 * purpose: a store has a handful of comics open, not a library.
 */
const CACHE = new Map();
const CACHE_MAX = 48;
export const __clearArchiveCache = () => CACHE.clear();

export async function archiveIndexFor(file, loadBytes, { caps = ZIP_CAPS } = {}) {
  if (!file || !isArchiveName(file.filename)) return null;
  const key = `${file.id}:${file.checksum || file.size_bytes || '?'}`;
  if (CACHE.has(key)) return CACHE.get(key);

  let result;
  // The declared size is checked before a byte is read: an archive too big to open is
  // refused by a number we already have rather than by loading it into memory first.
  if (Number(file.size_bytes) > caps.maxTotalBytes) {
    result = { ok: false, reason: 'archive-too-big' };
  } else {
    try {
      const bytes = await loadBytes(file.storage_key);
      result = listArchive(bytes, { caps });
    } catch {
      result = { ok: false, reason: 'unreadable' };
    }
  }
  result.pages = result.ok ? orderEntries(result.entries) : [];
  result.sentence = result.ok ? null : archiveSentence(result.reason);
  if (CACHE.size >= CACHE_MAX) CACHE.delete(CACHE.keys().next().value);
  CACHE.set(key, result);
  return result;
}

/**
 * The ordered steps of a read asset: every page a person turns to, and what it is.
 *
 * Pure — the caller hands in the archive listings it loaded — so the ordering rules
 * can be tested without a database or a disk.
 */
export function pagePlan({ files = [], archives = {} } = {}) {
  const ordered = files
    .map((f, index) => ({ f, index }))
    // `sort_order` is the seller's, and today every file is written with 0, so the
    // tie-breaks below are what actually decide the sequence: the upload order, then
    // the names. A total order is the point — "page 3" must mean one specific page.
    .sort((a, b) => (Number(a.f.sort_order) || 0) - (Number(b.f.sort_order) || 0)
      || naturalCompare(a.f.filename, b.f.filename)
      || a.index - b.index)
    .map(({ f }) => f);

  const steps = [];
  const refusals = [];
  for (const file of ordered) {
    if (isArchiveName(file.filename)) {
      const index = archives[file.id];
      const pages = index?.ok ? index.pages : [];
      if (pages.length) {
        for (const entry of pages) {
          steps.push({
            kind: 'archive', fileId: file.id, filename: file.filename,
            entryName: entry.name, entry, mime: pageMime(entry.name),
          });
        }
        continue;
      }
      // A readable archive with no pages in it, or one we could not open: either way
      // the file keeps its place, as something to take away.
      const reason = index?.ok ? 'empty' : (index?.reason ?? 'unreadable');
      refusals.push({ fileId: file.id, filename: file.filename, reason, sentence: archiveSentence(reason) });
      steps.push({ kind: 'file', fileId: file.id, filename: file.filename, reason });
      continue;
    }
    if (isPageName(file.filename)) {
      steps.push({ kind: 'image', fileId: file.id, filename: file.filename, mime: pageMime(file.filename) });
      continue;
    }
    if (isPdfName(file.filename)) {
      steps.push({ kind: 'pdf', fileId: file.id, filename: file.filename });
      continue;
    }
    steps.push({ kind: 'file', fileId: file.id, filename: file.filename });
  }

  // The word each step is counted in: a seller who uploads twelve files has twelve
  // chapters, and one archive (or one image) has pages. The word rides on the step so
  // the gate sentence and the reader's own counter cannot disagree.
  const fileSteps = ordered.length > 1;
  steps.forEach((step, i) => {
    step.n = i + 1;
    step.word = fileSteps && step.kind !== 'archive' ? 'chapter' : 'page';
    step.drawable = step.kind !== 'file';
  });

  return {
    steps,
    refusals,
    files: ordered.length,
    chapters: steps.length,
    // What the reader can actually draw, which is what "a reader exists for this
    // file" means. A PDF is drawable by the browser and counts as ONE step.
    drawable: steps.filter((s) => s.drawable).length,
    // One file with more than one page is a flat page sequence — the shape the
    // planner's "after page 13 and page 27" describes.
    flat: ordered.length === 1 && steps.length > 1,
  };
}

/**
 * Where the gates fall, as segments.
 *
 * A cue's `atChapter` is a step number — the planner's own examples are "after
 * chapter 3" of a twelve-chapter read and "after page 13" of a forty-page one — and
 * a gate at step k means the segment ends at k. Segments are therefore contiguous and
 * exhaustive: every page belongs to exactly one, and a gate is a seam between two of
 * them, never a thing on a page. A cue at or past the last step is reported as
 * unreachable rather than fired: a gate after the final page is a post-roll, and a
 * post-roll in a reader is nothing at all.
 */
export function segmentsFor(plan, cues = []) {
  const last = plan.steps.length;
  const gates = [];
  const unreachable = [];
  for (const cue of cues) {
    const at = Number(cue?.atChapter);
    if (!Number.isInteger(at) || at < 1) continue;
    if (at >= last) unreachable.push(cue);
    else gates.push({ ...cue, at });
  }
  gates.sort((a, b) => a.at - b.at);

  const segments = [];
  let from = 1;
  for (const gate of gates) {
    if (gate.at < from) continue; // two gates on one seam: the first one stands
    segments.push({ from, to: gate.at, gate, steps: gate.at - from + 1 });
    from = gate.at + 1;
  }
  segments.push({ from, to: last, gate: null, steps: last - from + 1 });
  return { segments, gates, unreachable };
}

/**
 * The gates a reader must have cleared before a given step — all of them, not the
 * last one.
 *
 * This is what makes a deep link safe: opening page 40 directly cannot skip the gates
 * at pages 13 and 27, because the answer is a list and the page route checks every
 * one of them. A reader that only remembered where it was would be the easiest way
 * round the gate in the product.
 */
export function gatesBefore(segments, step) {
  return segments.filter((s) => s.gate && s.to < Number(step)).map((s) => s.gate);
}

/** Which segment a step falls in, so the reader knows where the next seam is. */
export function segmentFor(segments, step) {
  return segments.find((s) => Number(step) >= s.from && Number(step) <= s.to) || null;
}

/**
 * One step's place in words: "Chapter 4 of 12", "Page 14 of 40".
 *
 * The word comes from the step itself (rule 3), so a twelve-file set and a flat
 * forty-page archive both read correctly without anybody deciding a global noun.
 */
export function stepLabel(plan, step) {
  const n = Number(step);
  if (!Number.isInteger(n) || n < 1 || n > plan.steps.length) return null;
  const noun = plan.steps[n - 1].word === 'chapter' ? 'Chapter' : 'Page';
  return `${noun} ${n} of ${plan.steps.length}`;
}

/** The sentence a gate gets on the file page, in the reader's own words. */
export function gateSentence(plan, cue) {
  const step = plan.steps[Number(cue?.atChapter) - 1];
  if (!step) return null;
  return `One view after ${step.word} ${step.n}.`;
}
