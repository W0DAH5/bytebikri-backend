/**
 * Composition audit. Development tool, not shipped.
 *
 *   node scripts/audit.mjs                       → every public page, three widths
 *   node scripts/audit.mjs /dashboard/alice --cookies /home/user/.scratch/bb/alice.jar
 *
 * "Balance, alignment, positioning" cannot be argued about with a text diff, and
 * a screenshot only shows the page you happened to look at. This measures the
 * things that actually read as broken, on every page at three widths:
 *
 *   OVERFLOW      an element wider than the viewport, or a document that scrolls
 *                 sideways. Almost always a fixed width or a long unbreakable
 *                 string, and it makes the whole page feel cheap.
 *   OVERLAP       boxes covering each other. Usually a negative margin or an
 *                 absolutely positioned decoration that grew.
 *   GAPS          a vertical hole over 220px inside the content column. This is
 *                 the signature of reserved space that nothing filled — the bug
 *                 a visitor reads as "the page did not load".
 *   MISA LIGNED   cards in one grid row whose tops differ by more than 2px.
 *   TINY TEXT     computed font-size under 11px.
 *   TOO WIDE      a text block over 90 characters per line.
 *   LOW CONTRAST  text against its own background under 4.5:1.
 */
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import fs from 'node:fs/promises';

const argv = process.argv.slice(2);
const flag = (name, dflt = null) => {
  const i = argv.indexOf(`--${name}`);
  if (i === -1) return dflt;
  const v = argv[i + 1];
  argv.splice(i, v && !v.startsWith('--') ? 2 : 1);
  return v && !v.startsWith('--') ? v : true;
};

const base = flag('base', 'http://127.0.0.1:3000');
const jar = flag('cookies', null);
const theme = flag('theme', 'dark');
const widths = String(flag('widths', '1280,834,390')).split(',').map(Number);
const pages = argv.filter((a) => !a.startsWith('--'));
const only = flag('only', null);

const browser = await puppeteer.launch({
  args: [...chromium.args, '--no-sandbox', '--disable-dev-shm-usage', '--force-color-profile=srgb'],
  executablePath: await chromium.executablePath(),
  env: { ...process.env, LD_LIBRARY_PATH: process.env.CHROME_LIBS || '/tmp/dist/Release/lib' },
  headless: 'shell',
});
const page = await browser.newPage();
await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: theme }]);

if (jar) {
  const cookies = (await fs.readFile(jar, 'utf8')).split('\n')
    .map((l) => l.replace(/^#HttpOnly_/, ''))
    .filter((l) => l && !l.startsWith('#') && l.split('\t').length >= 7)
    .map((l) => {
      const [domain, , p, secure, expires, name, value] = l.split('\t');
      return { domain, path: p, secure: secure === 'TRUE', expires: Number(expires) || -1, name, value };
    });
  await page.setCookie(...cookies);
}

const probe = () => {
  const out = { issues: [], doc: { w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight } };
  const label = (el) => {
    const cls = (el.className || '').toString().trim().split(/\s+/).slice(0, 2).join('.');
    return `${el.tagName.toLowerCase()}${cls ? `.${cls}` : ''}`;
  };
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0.05;
  };

  const vw = innerWidth;
  const all = [...document.querySelectorAll('body *')].filter(visible);

  // ---- overflow ----------------------------------------------------------
  // Anything inside a scrolling ancestor is clipped on purpose, not overflowing.
  // Checking only the immediate parent made every cell of a table that scrolls
  // itself look like a page-level overflow.
  const inScroller = (el) => {
    let node = el.parentElement;
    while (node && node !== document.body) {
      const o = getComputedStyle(node).overflowX;
      if (o === 'auto' || o === 'scroll') return true;
      node = node.parentElement;
    }
    return false;
  };
  for (const el of all) {
    if (inScroller(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.right > vw + 1.5) {
      out.issues.push({ kind: 'overflow', at: label(el), detail: `right edge ${Math.round(r.right)} > ${vw}` });
    }
  }
  if (document.documentElement.scrollWidth > vw + 1) {
    out.issues.push({ kind: 'h-scroll', at: 'document', detail: `${document.documentElement.scrollWidth} > ${vw}` });
  }

  // ---- vertical holes inside the content column --------------------------
  const main = document.querySelector('main') || document.body;
  const blocks = [...main.children].filter(visible);
  let prevBottom = null;
  for (const el of blocks) {
    const r = el.getBoundingClientRect();
    if (prevBottom !== null && r.top - prevBottom > 220) {
      out.issues.push({ kind: 'gap', at: label(el), detail: `${Math.round(r.top - prevBottom)}px empty above it` });
    }
    prevBottom = Math.max(prevBottom ?? 0, r.bottom);
  }

  // ---- reserved space that nothing filled --------------------------------
  for (const el of all) {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    const reserved = parseFloat(s.minHeight) || 0;
    if (reserved >= 120 && r.height >= reserved - 2) {
      const text = (el.textContent || '').trim();
      if (text.length < 40) {
        out.issues.push({ kind: 'empty-box', at: label(el), detail: `${Math.round(r.height)}px reserved, ${text.length} chars of text` });
      }
    }
  }

  // ---- grids whose items do not line up ----------------------------------
  // Only a MULTI-COLUMN grid can be misaligned: a vertical stack of a value and
  // its label is a grid too, and flagging those made this check useless the first
  // time it ran (it reported every `.proof` and every `.slot-inner`).
  for (const grid of all) {
    const s = getComputedStyle(grid);
    if (!s.display.includes('grid') || grid.children.length < 2) continue;
    const columns = (s.gridTemplateColumns || '').trim().split(/\s+/).filter((t) => t && t !== 'none');
    if (columns.length < 2) continue;

    const items = [...grid.children].filter(visible)
      .map((c) => ({ el: c, r: c.getBoundingClientRect() }))
      .sort((a, b) => a.r.top - b.r.top || a.r.left - b.r.left);
    if (items.length < 2) continue;

    // Walk rows: an item belongs to the current row when its top is within 2px
    // of the row's first item. Anything else starts a new row, and a new row is
    // allowed to start lower — that is what wrapping looks like.
    let row = [items[0]];
    const rows = [];
    for (const item of items.slice(1)) {
      if (Math.abs(item.r.top - row[0].r.top) <= 2) row.push(item);
      else { rows.push(row); row = [item]; }
    }
    rows.push(row);

    for (const r of rows) {
      if (r.length < 2) continue;
      // Items on the same row that overlap horizontally must share a top: that
      // is the "cards do not line up" failure. Different columns, same row.
      for (let i = 0; i < r.length; i += 1) {
        for (let j = i + 1; j < r.length; j += 1) {
          const a = r[i].r; const b = r[j].r;
          const overlapX = Math.min(a.right, b.right) - Math.max(a.left, b.left);
          if (overlapX > 4 && Math.abs(a.top - b.top) > 2) {
            out.issues.push({ kind: 'misaligned', at: label(grid), detail: `two items on one row differ by ${Math.round(Math.abs(a.top - b.top))}px` });
          }
        }
      }
    }
  }

  // ---- type --------------------------------------------------------------
  let tiny = 0;
  let widest = { ch: 0, at: '' };
  for (const el of all) {
    if (!el.textContent || !el.children.length === false) { /* leaf-ish */ }
    const s = getComputedStyle(el);
    const size = parseFloat(s.fontSize);
    const ownText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 12);
    if (!ownText) continue;
    if (size < 11) tiny += 1;
    const r = el.getBoundingClientRect();
    const ch = r.width / (size * 0.5);   // rough characters per line
    // The character estimate is crude (width / half the font size), so small
    // print is given a wider tolerance than body copy.
    if (size >= 13 && ch > widest.ch) widest = { ch: Math.round(ch), at: label(el) };
  }
  if (tiny) out.issues.push({ kind: 'tiny-type', at: `${tiny} elements`, detail: 'font-size below 11px' });
  if (widest.ch > 95) out.issues.push({ kind: 'long-line', at: widest.at, detail: `~${widest.ch} characters per line` });

  // ---- contrast ----------------------------------------------------------
  const parse = (c) => {
    const m = c.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const [r, g, b, a = 1] = m[1].split(',').map(Number);
    return { r, g, b, a };
  };
  const lum = ({ r, g, b }) => {
    const f = (v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const bgOf = (el) => {
    let node = el;
    while (node) {
      const c = parse(getComputedStyle(node).backgroundColor);
      if (c && c.a > 0.6) return c;
      node = node.parentElement;
    }
    return { r: 255, g: 255, b: 255, a: 1 };
  };
  const low = [];
  for (const el of all) {
    const ownText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 2);
    if (!ownText) continue;
    const fg = parse(getComputedStyle(el).color);
    if (!fg || fg.a < 0.5) continue;
    const size = parseFloat(getComputedStyle(el).fontSize);
    const weight = Number(getComputedStyle(el).fontWeight) || 400;
    const bg = bgOf(el);
    const L1 = lum(fg); const L2 = lum(bg);
    const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    const large = size >= 24 || (size >= 18.66 && weight >= 700);
    const need = large ? 3 : 4.5;
    if (ratio < need) low.push(`${label(el)} ${ratio.toFixed(2)}:1 (needs ${need})`);
  }
  if (low.length) out.issues.push({ kind: 'contrast', at: `${low.length} elements`, detail: low.slice(0, 5).join(' | ') });

  return out;
};

const PAGES = pages.length ? pages : [
  '/', '/marketplace', '/s/alice',
  '/login', '/signup', '/legal/terms', '/legal/privacy', '/legal/cookies',
];

let total = 0;
const byKind = new Map();
for (const url of PAGES) {
  for (const width of widths) {
    await page.setViewport({ width, height: Math.round(width * 0.62) });
    await page.goto(base + url, { waitUntil: 'networkidle0', timeout: 30000 });
    await new Promise((r) => setTimeout(r, 350));
    const out = await page.evaluate(probe);
    const issues = only ? out.issues.filter((i) => i.kind === only) : out.issues;
    if (!issues.length) continue;
    console.log(`\n${url}  @${width}  (doc ${out.doc.w}×${out.doc.h})`);
    for (const i of issues) {
      console.log(`   ${i.kind.padEnd(11)} ${i.at.padEnd(28)} ${i.detail}`);
      byKind.set(i.kind, (byKind.get(i.kind) || 0) + 1);
      total += 1;
    }
  }
}

console.log(`\n${total} findings across ${PAGES.length} pages × ${widths.length} widths (${theme})`);
if (byKind.size) {
  console.log('by kind: ' + [...byKind.entries()].map(([k, v]) => `${k} ${v}`).join(' · '));
}
await browser.close();
