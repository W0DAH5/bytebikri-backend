/**
 * Screenshots. Development tool, not shipped.
 *
 *   node scripts/shoot.mjs / /marketplace /s/alice            → /tmp/shots/*.png
 *   node scripts/shoot.mjs --w 390 /                           → phone width
 *   node scripts/shoot.mjs --full /marketplace                  → whole page, not the fold
 *
 * This exists because "it looks wrong" and "it looks right" are both unfalsifiable
 * from a Node test suite. Everything else here can be asserted; composition
 * cannot. So: a real browser, a real viewport, a PNG you can look at.
 */
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import fs from 'node:fs/promises';
import path from 'node:path';

const argv = process.argv.slice(2);
const flag = (name, dflt = null) => {
  const i = argv.indexOf(`--${name}`);
  if (i === -1) return dflt;
  const v = argv[i + 1];
  argv.splice(i, v && !v.startsWith('--') ? 2 : 1);
  return v && !v.startsWith('--') ? v : true;
};

const width = Number(flag('w', 1280));
// A phone is not a 0.62 aspect ratio: 390×242 shows the consent banner and
// nothing else.
const height = Number(flag('h', width < 700 ? 844 : Math.round(width * 0.62)));
const dismissConsent = Boolean(flag('no-consent', false));
const full = Boolean(flag('full', false));
const theme = flag('theme', 'dark');
const outDir = flag('out', '/tmp/shots');
const base = flag('base', 'http://127.0.0.1:3000');
const cookieJar = flag('cookies', null);
const wait = Number(flag('wait', 900));
const pages = argv.filter((a) => !a.startsWith('--'));

const browser = await puppeteer.launch({
  args: [
    ...chromium.args,
    '--no-sandbox', '--disable-dev-shm-usage',
    '--force-color-profile=srgb',
  ],
  defaultViewport: { width, height, deviceScaleFactor: 1 },
  executablePath: await chromium.executablePath(),
  // The NSS libraries this Chromium links against are not on the base image;
  // /tmp/dist/Release/lib is where they were built from source. Without it the
  // launcher dies with "libnss3.so: cannot open shared object file".
  env: { ...process.env, LD_LIBRARY_PATH: process.env.CHROME_LIBS || '/tmp/dist/Release/lib' },
  headless: 'shell',
});

const page = await browser.newPage();
// CDP emulation, not a launch flag: `--force-prefers-color-scheme` is ignored by
// headless shell, so every screenshot came back light and the dark theme was
// never actually looked at.
// ONE call. `emulateMediaFeatures` replaces the whole feature list, so a second
// call wipes the first one's setting — which is how every "dark" screenshot came
// back light while this looked correct.
await page.emulateMediaFeatures([
  { name: 'prefers-color-scheme', value: theme === 'light' ? 'light' : 'dark' },
  { name: 'prefers-reduced-motion', value: flag('motion', 'no-preference') === 'reduce' ? 'reduce' : 'no-preference' },
]);
if (cookieJar) {
  const jar = await fs.readFile(cookieJar, 'utf8');
  const cookies = jar.split('\n')
    // `#HttpOnly_` is a jar prefix, not a comment: filtering lines that start
    // with `#` throws away exactly the session cookie, which is HttpOnly by
    // definition, and every signed-in page silently renders as the sign-in page.
    .map((l) => l.replace(/^#HttpOnly_/, ''))
    .filter((l) => l && !l.startsWith('#') && l.split('\t').length >= 7)
    .map((l) => {
      const [domain, , p, secure, expires, name, value] = l.split('\t');
      return { domain: domain.startsWith('.') ? domain : domain, path: p, secure: secure === 'TRUE', expires: Number(expires) || -1, name, value };
    });
  await page.setCookie(...cookies);
}

await fs.mkdir(outDir, { recursive: true });

for (const url of pages) {
  const target = url.startsWith('http') ? url : base + url;
  await page.goto(target, { waitUntil: 'networkidle0', timeout: 30000 });
  // The consent banner is fixed to the bottom of the viewport and covers the
  // lower third of every screenshot. It is a real part of the product — and it
  // is screenshot separately — but looking at a layout through it is not
  // looking at the layout.
  if (dismissConsent || await page.$('.consent')) {
    await page.evaluate(() => {
      const b = document.querySelector('.consent button[value="none"]');
      if (b) b.click();
    });
    await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 15000 }).catch(() => {});
  }
  await new Promise((r) => setTimeout(r, wait));
  const name = (url === '/' ? 'home' : url.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '')) + (width < 700 ? '-phone' : '');
  const file = path.join(outDir, `${name}${full ? '-full' : ''}.png`);
  await page.screenshot({ path: file, fullPage: full });

  // A few numbers that matter more than the picture: does anything overflow the
  // viewport, and how tall is the document.
  const metrics = await page.evaluate(() => {
    const doc = document.documentElement;
    const overflowing = [...document.querySelectorAll('body *')]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && (r.right > innerWidth + 1 || r.left < -1);
      })
      .slice(0, 6)
      .map((el) => `${el.tagName.toLowerCase()}.${(el.className || '').toString().split(' ')[0]} → ${Math.round(el.getBoundingClientRect().right)}px`);
    return {
      scrollW: doc.scrollWidth, clientW: doc.clientWidth, h: doc.scrollHeight,
      scheme: matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
      bg: getComputedStyle(document.body).backgroundColor,
      overflowing,
      faded: [...document.querySelectorAll('body *')].filter((el) => {
        const s = getComputedStyle(el);
        const o = Number(s.opacity);
        return o > 0 && o < 0.9 && el.getBoundingClientRect().height > 40;
      }).slice(0, 6).map((el) => `${el.tagName.toLowerCase()}.${(el.className || '').toString().split(' ')[0]} opacity=${getComputedStyle(el).opacity}`),
    };
  });
  const title = await page.title();
  console.log(`${url}  ${width}×${height}  ${metrics.scheme} ${metrics.bg}  doc ${metrics.scrollW}×${metrics.h}  "${title}"  ${file}`);
  if (metrics.scrollW > metrics.clientW + 1) console.log(`   ⚠ horizontal overflow ${metrics.scrollW} > ${metrics.clientW}: ${metrics.overflowing.join(' | ')}`);
  if (metrics.faded.length) console.log(`   ⚠ semi-transparent blocks: ${metrics.faded.join(' | ')}`);
}

await browser.close();
