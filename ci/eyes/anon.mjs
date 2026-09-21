// Signed-out pages: the ones a stranger, a crawler or a stale link reaches.
import { chromium } from 'playwright';
import { open, consent, walk, measure, report } from './lib.mjs';

const b = await chromium.launch({ executablePath: '/tmp/chromium', args: ['--no-sandbox'] });
let clean = 0, dirty = 0;
for (const url of process.argv.slice(2)) {
  for (const vp of [{ w: 1440, h: 1000, tag: 'desktop' }, { w: 390, h: 844, tag: 'phone' }]) {
    const { ctx, p } = await open(b, { width: vp.w, height: vp.h });
    await p.goto('http://127.0.0.1:3000' + url, { waitUntil: 'load' });
    await consent(p);
    await walk(p);
    const m = await measure(p);
    report(`${vp.tag} ${url}`, m, p.errors) ? clean++ : dirty++;
    await p.screenshot({ path: `/tmp/eyes/out/anon${url.replace(/\W+/g, '_')}_${vp.tag}.png`, fullPage: true });
    await ctx.close();
  }
}
console.log(`\n${clean} clean, ${dirty} with findings`);
await b.close();
