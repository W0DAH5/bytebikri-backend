// Which pages does the harness check?
//
// Both `sweep.mjs` and `columns.mjs` used to carry their own hardcoded list, and a
// page whose URL carries an id could not be listed in either: the id changes on
// every reseed, so a literal would be stale by the next `ci/demo-state.mjs`. That
// left two pages checked by nothing at all —
//
//   /dashboard/<slug>/assets/<id>     the seller's page for one file, its biggest form
//   /admin/moderation/files/<id>      the operator's decision page for one file
//
// — and a layout regression on either was invisible to every automated check. A
// harness believed to cover more than it does is worse than no harness, so the gap
// is closed by finding the ids instead of writing them down: both pages are linked
// from a page that IS on the list, so the harness opens the linker and reads the
// hrefs out of the same markup a person clicks.
//
// If the link disappears the run says so rather than quietly checking one page
// fewer — silence is what let this gap exist in the first place.
import { open, walk } from './lib.mjs';

export const BASE = process.env.EYES_BASE || 'http://127.0.0.1:3000';

/** The pages every run covers, signed in as each account. */
export const PAGES = {
  operator: ['/admin', '/admin/stores', '/admin/stores/alice', '/admin/connections',
    '/admin/payments', '/admin/reports', '/admin/moderation', '/admin/audit',
    '/admin/users', '/admin/plans', '/admin/earnings', '/library'],
  // The library is on every account's list because every account is a buyer too: it
  // is the one page in the product that a seller, an operator and a shopper all read
  // the same way, and alice is seeded with unlocks in each of the four states the
  // shelf can render (§28).
  alice: ['/library', '/dashboard/alice', '/dashboard/alice/earnings', '/dashboard/alice/billing',
    '/dashboard/alice/slots', '/dashboard/alice/networks', '/dashboard/alice/settings',
    '/dashboard/alice/reviews'],
  // Nima is the seller the demo state keeps deliberately awkward: her identity check is
  // inside its notice window AND she is waiting on the next one, which is the only page
  // in the product that has to say two contradictory-looking things at once. A state
  // that is seeded on purpose needs to be the state that is checked on purpose.
  // `/members` is on nima's list because hers is the store the demo gives two
  // tiers and a named member: it is the page where a price is set by a person, so
  // it is the page where a form, a table and a queue have to survive a phone.
  nima: ['/library', '/dashboard/nima-crafts', '/dashboard/nima-crafts/settings',
    '/dashboard/nima-crafts/billing', '/dashboard/nima-crafts/members'],
  bob: ['/library', '/dashboard/bob'],
};

// Where an id-bearing page is linked from, and what one looks like. `take` is how
// many to add per account: two is enough to catch a page that only breaks on the
// second row, and the sweep stays a sweep rather than a crawl.
const SEEDS = {
  alice: { from: '/dashboard/alice', take: 2, match: /^\/dashboard\/[a-z0-9-]+\/assets\/[0-9a-f-]{36}$/ },
  nima: { from: '/dashboard/nima-crafts', take: 1, match: /^\/dashboard\/[a-z0-9-]+\/assets\/[0-9a-f-]{36}$/ },
  bob: { from: '/dashboard/bob', take: 1, match: /^\/dashboard\/[a-z0-9-]+\/assets\/[0-9a-f-]{36}$/ },
  operator: { from: '/admin/moderation', take: 2, match: /^\/admin\/moderation\/files\/[0-9a-f-]{36}$/ },
};

/**
 * The full list for one account: the static pages, plus whatever id-bearing pages
 * the account's own pages link to.
 *
 * `storageState` is the session `sessionFor()` already handed out, so this costs no
 * login — and the sign-in limiter counts successful attempts, which is why that
 * matters.
 */
export async function pagesFor(browser, who, { storageState = null, base = BASE } = {}) {
  const urls = [...(PAGES[who] || [])];
  const seed = SEEDS[who];
  if (!seed) return urls;

  const { ctx, p } = await open(browser, { width: 1440, height: 1000, storageState });
  try {
    await p.goto(base + seed.from, { waitUntil: 'load' });
    await walk(p);
    const hrefs = await p.$$eval('a[href]', (as) => as.map((a) => a.getAttribute('href')));
    const found = [...new Set(hrefs.filter((h) => h && seed.match.test(h)))].slice(0, seed.take);
    if (!found.length) {
      console.log(`  ${who}: no id-bearing pages linked from ${seed.from} —`
        + ' nothing to add, and if that is not expected the link has moved');
    }
    for (const h of found) if (!urls.includes(h)) urls.push(h);
  } finally {
    await ctx.close();
  }
  return urls;
}
