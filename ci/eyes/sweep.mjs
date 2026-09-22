// Every signed-in page, both widths, one pass. The regression net: it exists to
// catch a layout change that breaks a page nobody thought to open.
import { chromium } from 'playwright';
import { open, walk, measure, report, sessionFor } from './lib.mjs';
import { pagesFor } from './pages.mjs';

const b = await chromium.launch({ executablePath: '/tmp/chromium', args: ['--no-sandbox'] });
// The list lives in pages.mjs, which also finds the pages whose URL carries an id —
// Bob is on the sweep as well as Alice because he is the seller the demo keeps near
// his plan's file ceiling, so his dashboard is where the usage meter lives, and a
// page that only appears in one account's state is a page the sweep would miss.
let clean = 0, dirty = 0;

for (const who of ['operator', 'alice', 'bob']) {
  const state = await sessionFor(b, who);
  const pages = await pagesFor(b, who, { storageState: state });
  for (const vp of [{ w: 1440, h: 1000, tag: 'desktop' }, { w: 390, h: 844, tag: 'phone' }]) {
    const { ctx, p } = await open(b, { width: vp.w, height: vp.h, storageState: state });
    for (const url of pages) {
      const before = p.errors.length;
      const res = await p.goto('http://127.0.0.1:3000' + url, { waitUntil: 'load' });
      await walk(p);
      const m = await measure(p);
      const errs = p.errors.slice(before).filter((e) => !(res.status() === 404 && /404 \(Not Found\)/.test(e)));
      report(`${vp.tag} ${url} (${res.status()})`, m, errs) ? clean++ : dirty++;
      if (m.length) await p.screenshot({ path: `/tmp/eyes/out/fail${url.replace(/\W+/g, '_')}_${vp.tag}.png`, fullPage: true });
    }
    await ctx.close();
  }
}
console.log(`\n${clean} clean, ${dirty} with findings`);
await b.close();
