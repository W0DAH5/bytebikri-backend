// Does the pager actually page?  Usage:
//   node pager.mjs [/admin/audit]      (signed in as the operator)
//
// Written because two bugs in the same control were invisible at a glance: the
// route ignored `?page=`, and the link builder dropped `family=all` because the
// string "all" looked like a default. Both produced a plausible-looking page 1.
import { chromium } from 'playwright';
import { open, walk, sessionFor } from './lib.mjs';

const BASE = process.env.EYES_BASE || 'http://127.0.0.1:3000';
const path = process.argv[2] || '/admin/audit?family=all';
const b = await chromium.launch({ executablePath: '/tmp/chromium', args: ['--no-sandbox'] });
const state = await sessionFor(b, 'operator', { base: BASE });
const { ctx, p } = await open(b, { width: 1440, height: 1000, storageState: state });

const rowsOf = () => p.$$eval('tbody tr', (rows) => rows.slice(0, 3).map((r) => r.innerText.split('\n').slice(0, 2).join(' ')));
const head = () => p.$eval('.section-head', (el) => el.innerText.replace(/\s+/g, ' ')).catch(() => '(no .section-head)');

await p.goto(BASE + path, { waitUntil: 'load' });
await walk(p);
const first = await rowsOf();
console.log('page 1:', await head());

const older = await p.$('a:has-text("Older")');
if (!older) {
  console.log('no Older link — either one page of rows, or a broken pager; nothing to verify');
  await ctx.close(); await b.close();
  process.exit(0);
}
console.log('older →', await older.getAttribute('href'));
await Promise.all([p.waitForNavigation(), older.click()]);
await walk(p);
const second = await rowsOf();
console.log('page 2 url:', new URL(p.url()).search);
console.log('page 2:', await head());

const newer = await p.$('a:has-text("Newer")');
const problems = [];
if (!second.length) problems.push('page 2 has no rows');
if (JSON.stringify(first) === JSON.stringify(second)) problems.push('page 2 shows the same rows as page 1');
if (!newer) problems.push('no Newer link on page 2');
if (!new URL(p.url()).search.includes('page=2')) problems.push('url lost ?page=2');
await p.screenshot({ path: `/tmp/eyes/out/${path.replace(/\W+/g, '_')}_page2.png`, fullPage: true });
console.log(problems.length ? `FINDINGS: ${problems.join('; ')}` : 'pager works: page 2 is a different page, and can go back');
await ctx.close(); await b.close();
