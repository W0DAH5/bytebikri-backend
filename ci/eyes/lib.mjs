// ============================================================================
//  The measuring stick
// ============================================================================
//  Everything in this folder answers one question that reading a diff cannot:
//  does the page actually look right in a browser? It exists because a design
//  pass broke the layout of a live page while every CSS rule in it was correct,
//  and because the same class of bug has been found by eye — not by test — three
//  times since: a cover image that revealed through five screens of scroll, an
//  invisible dot that measured as visible, and a table that pushed the whole
//  document sideways on a phone.
//
//  It lived in /tmp for four rounds and was destroyed twice by a workspace
//  restore. It is checked in now, because a verification tool that disappears
//  whenever the environment is rebuilt is a tool that stops verifying.
// ============================================================================

/** Open a page at a viewport, collecting console errors as it goes. */
export async function open(browser, { width = 1440, height = 900, scheme = 'dark', storageState = null } = {}) {
  const ctx = await browser.newContext({
    viewport: { width, height }, colorScheme: scheme, ...(storageState ? { storageState } : {}),
  });
  const p = await ctx.newPage();
  p.errors = [];
  p.on('console', (m) => { if (m.type() === 'error') p.errors.push(m.text().slice(0, 140)); });
  p.on('pageerror', (e) => p.errors.push(`PAGEERROR ${e.message.slice(0, 140)}`));
  return { ctx, p };
}

/** Answer the consent banner, if it is up. Harmless when it is not. */
export async function consent(p) {
  await p.evaluate(() => document.querySelector('.consent .btn-primary')?.click());
  await p.waitForTimeout(200);
}

export async function login(p, email, password = 'bytebikri-demo', base = 'http://127.0.0.1:3000') {
  await p.goto(`${base}/login`);
  await consent(p);
  await p.fill('input[name=email]', email);
  await p.fill('input[name=password]', password);
  await Promise.all([p.waitForNavigation(), p.click('button[type=submit]')]);
}

/**
 * Sessions, reused.
 *
 * The sign-in limiter counts SUCCESSFUL attempts too — 12 per 15 minutes per
 * address — so a sweep that signed in once per page (32 times) tripped a real
 * product limit and then reported the 429s as page findings. Two sign-ins per
 * sweep, cached on disk, and the session is verified before it is written: a
 * login that was itself refused would otherwise be cached as "no cookies".
 */
/** Demo accounts whose store is not named after them. */
const STORE_SLUG = { nima: 'nima-crafts', alice: 'alice', bob: 'bob' };

export async function sessionFor(browser, who, { dir = '/tmp/eyes', base = 'http://127.0.0.1:3000' } = {}) {
  const { existsSync, readFileSync, writeFileSync } = await import('node:fs');
  // Any demo account, not just the two this started with: bob is the seller the
  // demo keeps near his plan's file ceiling, so his dashboard is the one that
  // exercises the usage meter.
  const email = who.includes('@') ? who : `${who}@bytebikri.local`;
  // Keyed by port as well as account: a session cookie from the demo database is
  // meaningless against a second instance, and silently reused it would look like
  // a sign-in that worked and a page that refused you.
  const port = new URL(base).port || '3000';
  const file = `${dir}/state-${who.split('@')[0]}-${port}.json`;
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));

  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  await login(p, email, 'bytebikri-demo', base);
  // The proof URL has to be one THIS account may read: /admin is operator-only,
  // and a 404 there for a seller would look exactly like a refused sign-in. The
  // account name is not the store slug either — nima's store is nima-crafts, and
  // guessing `/dashboard/nima` proved nothing except that a 404 looks like a refusal.
  const accountName = who.split('@')[0];
  const proofPath = who.startsWith('operator') ? '/admin' : `/dashboard/${STORE_SLUG[accountName] || accountName}`;
  let proof = await p.goto(base + proofPath);
  let took = proof.status() === 200;
  if (!took) {
    /*
     * An account with no store of its own has no dashboard to prove itself against,
     * and a 404 there is indistinguishable from a refused sign-in. `carol` is exactly
     * that account — the demo's buyer, who exists to check what a PERSON sees — and
     * this used to throw on her, which is a harness bug reported as a product one.
     * `/plus` is the page every signed-in account owns, and the sign-out control is
     * the difference between "her page rendered" and "the sign-in page did".
     */
    proof = await p.goto(`${base}/plus`);
    took = proof.status() === 200
      && (await p.locator('form[action="/logout"]').count()) > 0;
  }
  if (!took) {
    await ctx.close();
    throw new Error(`sign-in did not take (${proof.status()}) — rate limited? restart the web process and retry`);
  }
  const state = await ctx.storageState();
  writeFileSync(file, JSON.stringify(state));
  await ctx.close();
  return state;
}

/** Scroll the whole page so lazy and revealed things settle. */
export async function walk(p) {
  const h = await p.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y < h; y += 600) {
    await p.evaluate((v) => scrollTo(0, v), y);
    await p.waitForTimeout(90);
  }
  await p.evaluate(() => scrollTo(0, 0));
  await p.waitForTimeout(450);
}

/**
 * Everything wrong with the current page, as a list.
 *
 * Three checks, each one earning its place by catching something real:
 *
 *  1. **The page scrolls sideways.** On a phone that is the single worst layout
 *     failure: every paragraph moves under the reader's thumb. Elements inside a
 *     horizontal scroller are exempt on purpose — a table is ALLOWED to scroll in
 *     its own box — so the walk skips anything with `overflow-x: auto|scroll`,
 *     and skips a fixed-position progress bar.
 *  2. **An element sticks out of the viewport** without a scroller to explain it.
 *     This catches the cause of (1) before it becomes a document-wide overflow,
 *     and names the element so the fix is a one-line lookup.
 *  3. **Content that is in the DOM but invisible.** Either a reveal that never
 *     fired, or a decorative element with a size and no paint. Decoration is
 *     exempted by class (`.scroll-progress`, `.dot`, `[aria-hidden]` without text)
 *     because those are dots on purpose, and a false positive here costs more
 *     than it finds.
 */
export async function measure(p) {
  return p.evaluate(() => {
    const de = document.documentElement;
    const vw = de.clientWidth;
    const out = [];
    const scroller = (el) => {
      for (let n = el; n && n !== de; n = n.parentElement) {
        const o = getComputedStyle(n).overflowX;
        if (o === 'auto' || o === 'scroll' || o === 'hidden') return true;
      }
      return false;
    };
    const label = (el) => {
      const id = el.id ? `#${el.id}` : '';
      const cls = String(el.className || '').trim().split(/\s+/).slice(0, 2).map((c) => `.${c}`).join('');
      return `${el.tagName.toLowerCase()}${id}${cls}`.slice(0, 60);
    };

    if (de.scrollWidth > vw + 1) {
      out.push({ kind: 'page-scrolls-sideways', detail: `document ${de.scrollWidth}px wide vs viewport ${vw}px` });
    }
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      if (getComputedStyle(el).position === 'fixed') continue;
      const name = label(el);
      if (r.right > vw + 2 && !scroller(el)) {
        out.push({ kind: 'sticks-out', detail: `${name} right edge at ${Math.round(r.right)}px (viewport ${vw}px)` });
      }
      const st = getComputedStyle(el);
      const exempt = /scroll-progress|\bdot\b/.test(String(el.className)) || el.getAttribute('aria-hidden') === 'true';
      if (!exempt && Number(st.opacity) === 0 && r.height > 8 && el.textContent.trim().length > 4 && !scroller(el)) {
        out.push({ kind: 'invisible-content', detail: `${name} has text and opacity 0` });
      }
    }
    // Deduplicate: one broken row can report the same element from several angles.
    const seen = new Set();
    return out.filter((f) => (seen.has(f.kind + f.detail) ? false : seen.add(f.kind + f.detail)));
  });
}

/** Print a page's findings. Returns true when the page is clean. */
export function report(label, findings, errors = []) {
  const loud = errors.filter((e) => !/favicon/i.test(e));
  if (!findings.length && !loud.length) {
    console.log(`${label}  clean`);
    return true;
  }
  console.log(`${label}  ${findings.length} layout, ${loud.length} console`);
  for (const f of findings.slice(0, 6)) console.log(`    ${f.kind}: ${f.detail}`);
  for (const e of loud.slice(0, 4)) console.log(`    console: ${e}`);
  return false;
}
