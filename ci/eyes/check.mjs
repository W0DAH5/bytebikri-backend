// Check specific pages at both widths, signed in.  Usage:
//   node check.mjs /admin /admin/earnings          (as the operator)
//   node check.mjs /dashboard/alice@alice          (as a seller)
import { chromium } from 'playwright';
import { open, walk, measure, report, sessionFor } from './lib.mjs';

const b = await chromium.launch({ executablePath: '/tmp/chromium', args: ['--no-sandbox'] });
const targets = process.argv.slice(2);
let clean = 0, dirty = 0;

for (const t of targets) {
  const [url, who = 'operator'] = t.split('@');
  const state = await sessionFor(b, who);
  for (const vp of [{ w: 1440, h: 1000, tag: 'desktop' }, { w: 390, h: 844, tag: 'phone' }]) {
    const { ctx, p } = await open(b, { width: vp.w, height: vp.h, storageState: state });
    const res = await p.goto('http://127.0.0.1:3000' + url, { waitUntil: 'load' });
    await walk(p);
    const m = await measure(p);
    const errors = p.errors.filter((e) => !(res.status() === 404 && /404 \(Not Found\)/.test(e)));
    report(`${vp.tag} ${url} (${res.status()})`, m, errors) ? clean++ : dirty++;
    await p.screenshot({ path: `/tmp/eyes/out/${url.replace(/\W+/g, '_')}_${vp.tag}.png`, fullPage: true });
    await ctx.close();
  }
}
console.log(`\n${clean} clean, ${dirty} with findings`);
await b.close();
