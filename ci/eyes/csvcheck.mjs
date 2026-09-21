// Fetch every CSV export and check it is actually CSV: a header, the same column
// count on every row, and a truncation note exactly when the set was cut.
import { chromium } from 'playwright';
import { login } from './lib.mjs';

const BASE = process.env.EYES_BASE || 'http://127.0.0.1:3000';
const b = await chromium.launch({ executablePath: '/tmp/chromium', args: ['--no-sandbox'] });
const ctx = await b.newContext();
const p = await ctx.newPage();
await login(p, 'operator@bytebikri.local', 'bytebikri-demo', BASE);

for (const url of ['/admin/users?format=csv', '/admin/stores?format=csv', '/admin/earnings?format=csv',
  '/admin/plans?format=csv', '/admin/audit?format=csv&family=all', '/admin/audit?format=csv&actor=operator']) {
  const res = await p.request.get(BASE + url);
  const body = await res.text();
  const lines = body.replace(/\n$/, '').split('\n');
  const data = lines.filter((l) => !l.startsWith('#'));
  const cols = data[0].split(',').length;
  const ragged = data.slice(1).filter((l) => l.split(',').length !== cols);
  const note = lines.find((l) => l.startsWith('#'));
  console.log(`${url}\n  ${res.status()} ${res.headers()['content-type']} · ${data.length - 1} rows · `
    + `${cols} columns · ragged ${ragged.length}\n  file ${(res.headers()['content-disposition'] || '').replace(/.*filename="/, '').replace('"', '')}`
    + `\n  note ${note ? note.slice(0, 90) : 'none (complete)'}`);
  if (ragged.length) console.log(`  FIRST RAGGED: ${ragged[0].slice(0, 120)}`);
}
await b.close();
