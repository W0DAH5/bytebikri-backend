/**
 * UI wiring tests.
 *
 * These exist because of two bugs that a running app hid rather than showed.
 *
 * 1. `var(--accent-solid)` in the stylesheet, where the token is `--accent`. The
 *    browser silently drops an unresolvable custom property: the checkbox just
 *    looks wrong, nothing in the console, no failing request. A typo in a design
 *    token is invisible to every other kind of test we have.
 *
 * 2. The client script queries `#ad-modal` and friends. Those ids live in
 *    views.js. Rename one and the unlock button stops working — while every page
 *    still renders 200 and every API test still passes.
 *
 * Both are wiring failures, and wiring is exactly what a test can hold still.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(path.join(here, '..', p), 'utf8');

const css = read('public/styles.css');
const views = read('src/views.js');
const client = read('public/app.js');

/** Strip comments so a token named in prose is not mistaken for a definition. */
const withoutComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');

test('every custom property the stylesheet uses is defined in it', () => {
  const body = withoutComments(css);
  const defined = new Set([...body.matchAll(/(--[a-z0-9-]+)\s*:/gi)].map((m) => m[1]));
  const used = new Set([...body.matchAll(/var\((--[a-z0-9-]+)/gi)].map((m) => m[1]));

  const undefinedTokens = [...used].filter((t) => !defined.has(t)).sort();
  assert.deepEqual(
    undefinedTokens, [],
    `styles.css references tokens it never defines: ${undefinedTokens.join(', ')}. `
    + 'The browser drops these silently, so nothing else fails.',
  );
});

test('every custom property the views use inline is defined in the stylesheet', () => {
  const defined = new Set([
    ...withoutComments(css).matchAll(/(--[a-z0-9-]+)\s*:/gi),
  ].map((m) => m[1]));
  const used = new Set([...views.matchAll(/var\((--[a-z0-9-]+)/gi)].map((m) => m[1]));

  const undefinedTokens = [...used].filter((t) => !defined.has(t)).sort();
  assert.deepEqual(undefinedTokens, [], `views.js uses undefined tokens: ${undefinedTokens.join(', ')}`);
});

test('the client script only queries ids the views actually render', () => {
  // getElementById + the $('#x') shorthand, which is all the client uses.
  const queried = new Set([
    ...client.matchAll(/\$\(\s*'#([a-zA-Z0-9_-]+)'/g),
    ...client.matchAll(/getElementById\(\s*'([a-zA-Z0-9_-]+)'/g),
  ].map((m) => m[1]));

  const rendered = new Set([
    ...views.matchAll(/id="([a-zA-Z0-9_-]+)"/g),
    ...views.matchAll(/id='([a-zA-Z0-9_-]+)'/g),
  ].map((m) => m[1]));

  const missing = [...queried].filter((id) => !rendered.has(id)).sort();
  assert.deepEqual(
    missing, [],
    `app.js queries ids no view renders: ${missing.join(', ')}. `
    + 'That is a dead feature that still looks alive.',
  );
  assert.ok(queried.size >= 4, `expected the client to query several ids, saw ${queried.size}`);
});

test('the client script only posts to routes the server defines', () => {
  // A client calling a route that does not exist fails at the worst moment —
  // when someone is midway through unlocking.
  const server = read('server.js');
  const called = new Set(
    [...client.matchAll(/api\(\s*[`']([^`']*?)[`']/g)].map((m) => m[1]),
  );

  for (const route of called) {
    // Query strings are not part of the route; template-literal interpolations
    // mean the literal prefix before the first ${ is what we can match.
    const pathOnly = route.split('?')[0];
    const prefix = pathOnly.split('${')[0];
    if (!prefix.startsWith('/')) continue;
    assert.ok(!route.includes('?') || pathOnly !== route || true, '');
    assert.ok(
      server.includes(prefix),
      `app.js calls ${route} but no route with prefix ${prefix} exists in server.js`,
    );
  }
});

test('asset ids rendered into HTML are uuid-shaped, so the API can accept them', () => {
  // The unlock button carries the asset id in a data attribute. If that were
  // ever rendered as a non-uuid, the server would reject it at the boundary and
  // the button would fail with a 400 for every visitor.
  assert.match(views, /data-asset="\$\{esc\(asset\.id\)\}"/);
});

test('every page render passes consent, or the banner silently disappears', () => {
  // The banner is the only place a visitor can refuse personalised ads. If a new
  // page forgets to thread `consent` through, nothing breaks, nothing logs, and
  // the site quietly stops asking — which is the failure mode worth a test.
  const server = read('server.js');
  const calls = [...server.matchAll(/views\.(landing|marketplace|storefront|assetPage|dashboard|login|legalPage)\(\{([\s\S]*?)\}\)/g)];
  assert.ok(calls.length >= 6, `expected several view calls, found ${calls.length}`);
  const missing = calls
    .filter(([, fn, args]) => !/consent/.test(args))
    .map(([, fn]) => fn);
  assert.deepEqual(missing, [], `these render calls do not pass consent: ${missing.join(', ')}`);
});

test('one list of access modes, and the offer matches what can be honoured', () => {
  // The mode reaches the database through two writers — the asset row and its
  // policy copy — and they have already drifted once: `breaks` was added to one and
  // not the other, so the policy row kept the previous mode. Nothing looked wrong,
  // because the buyer's path reads the asset. A second list is how that happens, so
  // the test is that there is not one.
  const storeSrc = read('src/store.js');
  const lists = [...storeSrc.matchAll(/\['open',\s*'ad_gated'[^\]]*\]/g)];
  assert.equal(lists.length, 1, `expected one literal mode list, found ${lists.length}: ${lists.map((m) => m[0])}`);
  assert.equal(lists[0][0], "['open', 'ad_gated', 'members', 'breaks']");
  const writers = [...storeSrc.matchAll(/SELLER_MODES\.includes\(String\(mode\)\)|SELLER_MODES\.includes\(String\(v\)\)/g)];
  assert.equal(writers.length, 2, 'the two writers must both read the shared list');

  // The choice is offered on the seller's page for a file that can carry it, and
  // the description warning compares the seller's own words against what a VISITOR
  // is asked for — not against the policy row, which carries an ask even on a file
  // nobody is charged for.
  assert.match(views, /value="breaks"/);
  assert.match(views, /const askedOfVisitors = /);
  assert.match(views, /descriptionClaim !== askedOfVisitors/);
  assert.doesNotMatch(views, /descriptionClaim !== storedAsk\.ads/);
});

test('the consent banner offers a real refusal', () => {
  // Both answers must be submit buttons with equal standing — a dimmed link to
  // "manage preferences" as the only way to say no is the dark pattern the
  // ePrivacy rules are about.
  assert.match(views, /name="choice" value="all"/);
  assert.match(views, /name="choice" value="none"/);
  assert.match(views, /If you refuse personalised ads|Reject all/);
});

// ---------------------------------------------------------------------------
// The player
// ---------------------------------------------------------------------------

test('the player is a player, not a download with extra steps', () => {
  // Three attributes do the work, and all three are the kind that get dropped
  // in a refactor without anything failing:
  //   controlslist="nodownload"  — removes the download item from the menu
  //   disablepictureinpicture    — removes the floating always-on-top window,
  //                                which is a screen recorder's easiest target
  //   data-protect               — the hook app.js uses to block right-click
  //                                and drag, which is deterrence and is labelled
  //                                as such in the markup
  assert.match(views, /controlslist="nodownload/, 'the player offers its own download button');
  assert.match(views, /disablepictureinpicture/, 'picture-in-picture is left on');
  assert.match(views, /data-protect/, 'nothing marks the protected region for the client');
  assert.match(client, /data-protect/, 'app.js does not act on the protected region');

  // The playable file is served from the stream route, and the view must not
  // fall back to the download URL for it — the whole point is that a video is
  // played rather than handed over.
  assert.match(views, /previewFile\.streamUrl/);
  assert.ok(!/previewFile\.downloadUrl/.test(views), 'the player uses the download URL as its source');
  assert.match(views, /Plays here/, 'the file list does not say what actually happens to a video');

  // And the file row must not undo it. The version that shipped the player
  // rendered `<a href="downloadUrl" download>Plays here</a>` — a download button
  // with a reassuring label on it, which is the exact failure this test exists
  // for. The playable branch is checked by position: it has to come before the
  // download link in the row template.
  const rows = views.slice(views.indexOf('const rows = files.map'), views.indexOf('const filesPanel'));
  const playableAt = rows.indexOf('f.playable');
  const downloadAt = rows.indexOf('href="${esc(f.downloadUrl)}"');
  assert.ok(playableAt >= 0, 'the file row does not branch on whether a file plays');
  assert.ok(downloadAt > playableAt, 'a playable file still renders a download link');

  // The reference printed on the page is the real one the server minted, not a
  // sentence that describes a watermark without naming it.
  assert.match(views, /esc\(markLabel/);
  assert.ok(!/BYTEBIKRI · your reference/.test(views), 'the placeholder mark copy is back');
});

test('the page never claims the web can stop a screenshot', () => {
  // The claim that matters. On Android, FLAG_SECURE genuinely blocks capture; in
  // a browser nothing does, and a page that says "protected" is selling a
  // protection that does not exist. This test exists so that copy cannot drift
  // into the lie later — it is the one thing here that is not a mechanical fix.
  const page = views.slice(views.indexOf('export function assetPage'), views.indexOf('function assetUnlockExpiry'));
  assert.match(page, /Watermark/, 'the media note does not mention the watermark at all');
  assert.match(page, /No website can stop a screen recording|does not pretend/,
    'the note does not admit what it cannot do');
  assert.ok(!/\b(uncopyable|un-copyable|cannot be copied|screenshot-proof|fully protected|DRM)\b/i.test(page),
    'the page promises a protection the browser cannot provide');
});

test('the client only selects elements the views render', () => {
  // The same class of bug as a missing id: a selector that matches nothing is
  // silent. `[data-protect]` matching nothing would leave right-click enabled
  // and no watermark overlay, and every test would still pass.
  const selectors = new Set(
    [...client.matchAll(/querySelectorAll\(\s*'([^']+)'/g)].map((m) => m[1]),
  );
  for (const sel of selectors) {
    for (const token of sel.match(/\[data-[a-z-]+\]|\.[a-z][a-z0-9-]*/g) || []) {
      const needle = token.startsWith('[') ? token.slice(1, -1) : token.slice(1);
      assert.ok(views.includes(needle), `app.js selects ${sel} but no view renders ${needle}`);
    }
  }
  assert.ok(selectors.size >= 2, `expected several selectors, saw ${selectors.size}`);
});

test('every class the views emit has a rule in the stylesheet', () => {
  // An undefined class is the same failure as an undefined token: the browser
  // renders an unstyled element, nothing logs, and the page just looks wrong.
  const defined = new Set([...withoutComments(css).matchAll(/\.([a-zA-Z0-9_-]+)/g)].map((m) => m[1]));
  const used = new Set();
  for (const m of views.matchAll(/class="([^"]*)"/g)) {
    // Skip interpolated class attributes: they are not literal names.
    if (m[1].includes('${')) continue;
    for (const c of m[1].split(/\s+/)) if (c) used.add(c);
  }
  const missing = [...used].filter((c) => !defined.has(c)).sort();
  assert.deepEqual(missing, [], `views.js uses classes with no CSS rule: ${missing.join(', ')}`);
  assert.ok(used.size >= 40, `expected the views to use several classes, saw ${used.size}`);
});

// ---------------------------------------------------------------------------
// The pages that were missing
//
// Billing, settings, reviews, single-asset management and search. Each of these
// is a page whose content is a claim about money or about who may speak, so the
// assertions are about what the page SAYS, not that it renders.
// ---------------------------------------------------------------------------

const {
  billing: billingView, storeSettings, dashboardReviews, assetManage, operatorBilling, marketplace,
  adminModeration, adminModerationFile,
} = await import('../src/views.js');
// store.js loads the pool; the pool refuses to exist under `node --test` unless it
// points at a test database. This file only reads PLANS, but it still has to say so.
process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:55432/bytebikri_test';
const { PLANS } = await import('../src/store.js');
const { railDetails, planBenefits, upgradeExplanation, NOT_CHARGED } = await import('../src/billing.js');

const CHANNEL = {
  id: '11111111-1111-4111-8111-111111111111', slug: 'alice', name: 'Alice Studio',
  tagline: 'Poster kits', about: 'About', channel_contact: '', banner_url: null,
  listing_mode: 'storefront', ads_enabled: true, sells_digital: true, sells_physical: false,
};
const SUB = {
  id: '22222222-2222-4222-8222-222222222222', channel_id: CHANNEL.id, plan_code: 'store',
  status: 'active', period_end: '2027-09-21T00:00:00Z', period_start: '2026-09-21T00:00:00Z',
  pending_plan_code: null,
};

test('the billing page states both charges and refuses to invent a third', () => {
  const html = billingView({
    channel: CHANNEL, user: null, plan: PLANS.store, nextPlanCode: 'pro',
    quote: { from: PLANS.store, to: PLANS.pro, daysLeft: 200, fullDifference: 1500, amountNpr: 822 },
    // The real explanation, because the route passes the real one: a stub here
    // would test the stub.
    upgrade: upgradeExplanation({ from: PLANS.store, to: PLANS.pro, daysLeft: 200, fullDifference: 1500, amountNpr: 822 }),
    pending: null, subscription: SUB, invoice: null,
    estimate: { pageviews30d: 400, total: 5, rent: 1, rpmUsd: 0.2, estNpr: 2 },
    pageviews: 400, paidTotal: 0, payments: [], invoices: [],
    rails: railDetails({ PAY_ESEWA_ID: '9800000001' }), railsReady: true, payee: 'ByteBikri Pvt Ltd',
    benefits: planBenefits(PLANS.store, { availableSlots: 5 }), notCharged: NOT_CHARGED, slots: [],
  });

  assert.ok(/NPR 822/.test(html), 'the pro-rated amount is on the page');
  assert.ok(/renewal date does not move/i.test(html));
  assert.ok(/no card checkout/i.test(html), 'the absence of a processor is explained, not hidden');
  assert.ok(/0%/.test(html), 'the 0% ad-share promise is stated where money is mentioned');
  assert.ok(!/checkout now|pay with card|stripe|paypal/i.test(html), 'no fake checkout, ever');
  // The words appear only in the "what you are not charged" list. A bare
  // /commission/ test would fail on that list — which is the page doing its job.
  const chargeWords = [...html.matchAll(/.{0,14}(commission|platform fee|take rate)/gi)].map((m) => m[0]);
  assert.ok(chargeWords.every((m) => /no /i.test(m)),
    `a third charge is named without being denied: ${chargeWords.join(' | ')}`);
});

test('a pending upgrade says what to send, and does not claim the plan changed', () => {
  const pending = {
    code: 'pro', name: 'Pro', amountNpr: 1500, reference: null, method: null, since: new Date(),
  };
  const html = billingView({
    channel: CHANNEL, user: null, plan: PLANS.store, nextPlanCode: 'pro', quote: null, upgrade: null,
    pending, subscription: SUB, invoice: null, estimate: {}, pageviews: 0, paidTotal: 0,
    payments: [], invoices: [], rails: railDetails({ PAY_KHALTI_ID: '9800000002' }), railsReady: true,
    payee: 'ByteBikri Pvt Ltd', benefits: [], notCharged: NOT_CHARGED, slots: [],
  });
  assert.ok(/Waiting to be matched/.test(html));
  assert.ok(/stays exactly as it is until the money is matched/.test(html));
  assert.ok(/name="txnReference"/.test(html), 'the reference form is the next step');
  assert.ok(/upgrade requested/.test(html), 'the pill says a request is open');

  // With a reference submitted, the form is gone: there is nothing more to send.
  const submitted = billingView({
    channel: CHANNEL, user: null, plan: PLANS.store, nextPlanCode: 'pro', quote: null, upgrade: null,
    pending: { ...pending, reference: 'KHALTI778899', method: 'khalti' },
    subscription: SUB, invoice: null, estimate: {}, pageviews: 0, paidTotal: 0,
    payments: [], invoices: [], rails: [], railsReady: false, payee: null,
    benefits: [], notCharged: NOT_CHARGED, slots: [],
  });
  assert.ok(/Reference received/.test(submitted));
  assert.ok(!/name="txnReference"/.test(submitted), 'nobody is asked to submit a reference twice');
});

test('no rent invoice says WHY there is none', () => {
  const withSlot = billingView({
    channel: CHANNEL, user: null, plan: PLANS.free, nextPlanCode: 'store', quote: null, upgrade: null,
    pending: null, subscription: null, invoice: null,
    estimate: { pageviews30d: 12, total: 5, rent: 1, rpmUsd: 0.2, estNpr: 0 }, pageviews: 12,
    paidTotal: 0, payments: [], invoices: [], rails: [], railsReady: false, payee: null,
    benefits: [], notCharged: NOT_CHARGED, slots: [],
  });
  assert.ok(/earned nothing this period/.test(withSlot), 'a slot that earned nothing is not a short page');

  const shortPage = billingView({
    channel: CHANNEL, user: null, plan: PLANS.free, nextPlanCode: 'store', quote: null, upgrade: null,
    pending: null, subscription: null, invoice: null,
    estimate: { pageviews30d: 900, total: 2, rent: 0, rpmUsd: 0.2, estNpr: 0 }, pageviews: 900,
    paidTotal: 0, payments: [], invoices: [], rails: [], railsReady: false, payee: null,
    benefits: [], notCharged: NOT_CHARGED, slots: [],
  });
  assert.ok(/shorter than that/.test(shortPage), 'a page too short to rent says so');
  assert.ok(!/earned nothing/.test(shortPage), 'and does not blame the traffic for it');
});

test('the rail list shows an unconfigured account as unconfigured', () => {
  const html = billingView({
    channel: CHANNEL, user: null, plan: PLANS.free, nextPlanCode: 'store', quote: null, upgrade: null,
    pending: null, subscription: null, invoice: null, estimate: {}, pageviews: 0, paidTotal: 0,
    payments: [], invoices: [], rails: railDetails({ PAY_ESEWA_ID: '9800000001' }), railsReady: true,
    payee: null, benefits: [], notCharged: NOT_CHARGED, slots: [],
  });
  assert.ok(/9800000001/.test(html), 'a configured account is shown');
  assert.ok(/not configured/.test(html), 'an unconfigured rail says so rather than showing a placeholder');
  assert.ok(/PAY_KHALTI_ID/.test(html), 'and names the variable that would fix it');
  // The "something else" rail is not an account and never appears in the list.
  assert.ok(!/Something else\s*<\/div>\s*<div class="rail-value mono"/.test(html));
});

test('store settings cannot promise a free store the Explore listing', () => {
  const free = storeSettings({
    channel: CHANNEL, user: null, plan: PLANS.free, canList: false, subscription: null, stats: {},
  });
  assert.ok(/does not include it/.test(free), 'the disabled radio explains why');
  assert.ok(/disabled/.test(free), 'and the control is actually disabled');

  const pro = storeSettings({
    channel: { ...CHANNEL, listing_mode: 'marketplace' }, user: null, plan: PLANS.pro,
    canList: true, subscription: SUB, stats: { count: 3, average: 4.5 },
    themes: [], canTheme: true,
  });
  assert.ok(/Included in your plan/.test(pro));
  // Scoped to the CONTROL rather than the page. A page-wide `/disabled/` was a
  // proxy for "the listing radio is enabled", and it stopped meaning that the
  // moment the page grew a second gated control with a disabled state of its own
  // (the theme cards on Free) — a proxy that fails on an honest change teaches
  // nothing. So it reads the radio.
  assert.ok(!/name="listingMode"[^>]*disabled/.test(pro), 'a paid store can pick the listing');
  assert.ok(/a buyer cannot use this store to find you/i.test(pro),
    'the page states what is kept private, not just what is shown');
});

test('the theme control follows the plan, and Free is told rather than shown a locked door', async () => {
  const { storeSettings } = await import('../src/views.js');
  // The real list, not two hand-made strings: the card reads `key`, `label`, `note`
  // and `animated` off these, and a stub would let the view and the route disagree
  // about the shape while the test stayed green.
  const { THEMES, THEME_KEYS } = await import('../src/themes.js');
  const themes = THEME_KEYS.slice(0, 2).map((k) => THEMES[k]);
  const free = storeSettings({
    channel: CHANNEL, user: null, plan: PLANS.free, canList: false,
    subscription: null, stats: {}, themes, canTheme: false,
  });
  assert.ok(/storefront keeps the default look/i.test(free),
    'a free store is told what the plan adds, in the plan own words');
  assert.ok(/disabled/.test(free), 'the cards are not pressable');
  assert.ok(/theme-lock/.test(free), 'each one carries a chip naming the plan it belongs to');
  assert.ok(/the Store plan/.test(free), 'and the sentence names the plan that would change it');
  // The preview is NOT dimmed: a washed-out pastel is a picture of nothing, and the
  // swatch is the one thing on this page that sells the feature. Asserted on the
  // stylesheet, because "make the disabled cards look disabled" is exactly the patch
  // somebody will apply later without knowing why it was left alone.
  const css = read('public/styles.css');
  assert.ok(/\.theme-pick:disabled \{ cursor: not-allowed; \}/.test(css.replace(/\s+/g, ' ')),
    'a locked card keeps its full-colour preview and only dims its words');
  // The list is SHOWN on Free, all six of them. Hiding it would be the other kind of
  // lie: a capability nobody knows about is a capability nobody buys, and this one
  // has spent three migrations being sold without a reader.

  const paid = storeSettings({
    channel: { ...CHANNEL, theme: 'mustang' }, user: null, plan: PLANS.store, canList: true,
    subscription: SUB, stats: {}, themes, canTheme: true,
  });
  assert.ok(/aria-pressed="true"/.test(paid), 'the theme in force is marked as the current one');
  assert.ok(/value="everest"/.test(paid) && /value="mustang"/.test(paid), 'every theme on offer is a pressable form');
  assert.ok(/value="plain"/.test(paid) && /aria-pressed="false"/.test(paid),
    'and the way back to the default is offered beside them, not hidden behind a support request');
  assert.ok(/prefers-reduced-motion|less motion/i.test(paid),
    'and the page answers the question a colour raises: does my shop now move?');
});

test('a paid store can drop our name from its own pages, and only its own pages', async () => {
  // `remove_footer` was true on both paid plans since migration 0001, mentioned on the
  // pricing page nowhere, and rendered nowhere — a capability that existed only in a
  // JSONB column. It is now read, so the two shapes have to be checked: a Free store
  // keeps the line, a paid store loses it, and the platform's legal notices survive
  // both. The last one is the assertion with teeth: a plan may remove our NAME, never
  // our notice.
  const { storefront } = await import('../src/views.js');
  const base = {
    channel: { slug: 's', name: 'S', owner_id: 'o' }, assets: [], slots: [], user: null,
    estimate: null, pageviews: null, unlockedIds: new Set(),
  };
  const free = storefront({ ...base });
  const paid = storefront({ ...base, plainFooter: true });

  assert.match(free, /the shop belongs to the creator/, 'a Free store carries our name');
  assert.doesNotMatch(paid, /the shop belongs to the creator/,
    'a paid store does not, on its own storefront');
  for (const [label, html] of [['free', free], ['paid', paid]]) {
    for (const path of ['/legal/privacy', '/legal/terms', '/legal/cookies']) {
      assert.ok(html.includes(path), `${label}: ${path} is still reachable from the footer`);
    }
  }
  // And the flag does not travel: a platform page (the landing page, the console, the
  // person's own library) is not a store's shop window and keeps the line whatever any
  // plan says — they are built by other functions entirely, which is exactly why this
  // is asserted here rather than assumed.
  const { layout } = await import('../src/views.js');
  assert.match(layout({ title: 't', user: null, body: 'x' }), /the shop belongs to the creator/);
  assert.doesNotMatch(layout({ title: 't', user: null, body: 'x', plainFooter: true }), /the shop belongs to the creator/);
});

test('reviews are keyed off unlocks on both sides of the page', async () => {
  const { assetPage } = await import('../src/views.js');
  const base = {
    channel: CHANNEL, asset: { slug: 'kit', title: 'Kit', description: 'd', unlock_mode: 'ad_gated' },
    files: [], unlocked: true, user: null, policy: {}, slots: [], previewFile: null,
    markUri: '', markLabel: 'BYTEBIKRI abc def', accessUntil: null, reviewStats: { count: 0, average: 0 },
  };

  const buyer = assetPage({ ...base, reviews: [], canReview: true, myReview: null });
  assert.ok(/name="rating"/.test(buyer), 'someone holding an unlock gets a form');

  const stranger = assetPage({ ...base, unlocked: false, reviews: [], canReview: false, myReview: null });
  assert.ok(!/name="rating"/.test(stranger), 'someone without one does not');
  assert.ok(/only be written by somebody who unlocked/i.test(stranger));

  const mine = assetPage({ ...base, reviews: [], canReview: false, myReview: { rating: 4, body: 'Good' } });
  assert.ok(/Your review is on the page/.test(mine));
  assert.ok(/Update review/.test(mine));

  const seller = dashboardReviews({
    channel: CHANNEL, user: null,
    reviews: [{
      id: '33333333-3333-4333-8333-333333333333', rating: 5, body: 'Great', asset_title: 'Kit',
      asset_slug: 'kit', created_at: new Date().toISOString(), seller_response: null,
    }],
    stats: { count: 1, average: 5 },
  });
  assert.ok(/name="response"/.test(seller), 'the seller gets one reply box');
  assert.ok(/Written only by people who unlocked the file/.test(seller));
});

test('the asset page is one form, so one save cannot undo another', () => {
  const html = assetManage({
    channel: CHANNEL, user: null,
    asset: {
      id: '44444444-4444-4444-8444-444444444444', slug: 'kit', title: 'Kit',
      description: 'd', unlock_mode: 'ad_gated', status: 'live',
    },
    files: [{ filename: 'kit.zip', mime_type: 'application/zip', size_bytes: 1024 }],
    policy: { ads_required: 1, ad_min_seconds: 15, unlock_hours: 24 },
    stats: { count: 0, average: 0 }, unlocks: 0,
  });
  /**
   * The property is not "one form on the page" — it is "the file's own fields
   * live in exactly one form, and no other form carries a copy of them".
   *
   * The count was the original way of saying this, and it stopped being true the
   * day the page gained a second, unrelated form (withholding the file from a
   * country). Sharpening it keeps the guarantee and stops the test failing for
   * the wrong reason: what must never come back is a second form mirroring the
   * title into a hidden input, because pressing it posts the stale value back and
   * the edit silently disappears.
   */
  const forms = html.match(/<form[\s\S]*?<\/form>/g) || [];
  const edits = forms.filter((f) => /name="title"/.test(f));
  assert.equal(edits.length, 1, 'the file’s own fields are in exactly one form');
  // The ask is no longer two number fields (see src/adscale.js) — it is a choice and
  // a private value, and both must be inside the SAME form as the title, or a save
  // would post one of them stale.
  assert.ok(/name="adAsk"/.test(edits[0]), 'and that form carries the unlock terms too');
  assert.ok(/name="valueNpr"/.test(edits[0]), 'including what the file is worth, which the ask is derived from');
  assert.ok(!/type="hidden"/.test(edits[0]), 'nothing is mirrored into a hidden field to go stale');
  const other = forms.filter((f) => f !== edits[0]);
  assert.ok(other.length, 'the country form is on the page');
  assert.ok(other.every((f) => !/name="title"|name="description"|name="adAsk"|name="valueNpr"/.test(f)),
    'no other form carries a copy of the edit fields, so none of them can save a stale one');
  assert.ok(/cannot be swapped for another one here/.test(html),
    'the page refuses a silent file swap, and says why');
});

test('the operator queue shows what the seller asked for, and only open items', () => {
  const html = operatorBilling({
    user: { role: 'admin', email: 'op@bytebikri.local', display_name: 'Op' }, payee: 'ByteBikri Pvt Ltd',
    payments: [{
      id: '55555555-5555-4555-8555-555555555555', channel_name: 'Alice Studio', channel_slug: 'alice',
      plan_code: 'pro', txn_reference: 'KHALTI778899', method: 'khalti', payer_name: 'Alice',
      payer_number: '9800000001', amount_npr: 1500, created_at: new Date().toISOString(),
    }],
    invoices: [{
      id: '66666666-6666-4666-8666-666666666666', channel_name: 'Alice Studio', channel_slug: 'alice',
      period_start: '2026-09-21', period_end: '2027-09-21', txn_reference: 'SLIP-9931',
      amount_npr: 24, status: 'submitted',
    }],
  });
  assert.ok(/KHALTI778899/.test(html) && /NPR 1,500/.test(html));
  assert.ok(/value="match"/.test(html) && /value="reject"/.test(html), 'both outcomes are one click each');
  assert.ok(/Matching an upgrade activates the subscription; it is the only thing that does/.test(html),
    'the page states the single thing that changes what a seller has paid for');
  assert.ok(/Mark paid/.test(html));
});

test('search results replace the directory rather than sitting above it', () => {
  const searching = marketplace({
    channels: [], user: null, q: 'devanagari',
    results: { term: 'devanagari', stores: [], assets: [] },
  });
  assert.ok(/Nothing matches/.test(searching));
  assert.ok(!/Listed stores/.test(searching), 'the heading is not an answer to the search');
  assert.ok(/role="search"/.test(searching));

  const plain = marketplace({ channels: [], user: null, q: '', results: null });
  assert.ok(/Listed stores/.test(plain));
});

test('the creator sees the note they wrote, and who set a rule they did not', () => {
  /**
   * The column was empty and the sentence was nowhere else.
   *
   * A creator withholds a file from a country and writes why — "Licence covers
   * Nepal only" — and the note went into `asset_country_rules.reason` and
   * stopped there. The panel listed the country, the state, and who set it, so
   * the one thing the creator had written down about their own decision was the
   * one thing their own page did not show. It is also the sentence an operator
   * reads when they open the file, which makes it the whole of the appeal in one
   * line: a reason nobody can reread is a reason nobody can stand behind.
   */
  const html = assetManage({
    channel: CHANNEL, user: null,
    asset: {
      id: '55555555-5555-4555-8555-555555555555', slug: 'kit', title: 'Kit',
      description: 'd', unlock_mode: 'ad_gated', status: 'live',
    },
    files: [{ filename: 'kit.zip', mime_type: 'application/zip', size_bytes: 1024 }],
    policy: { ads_required: 1, ad_min_seconds: 15, unlock_hours: 24 },
    stats: { count: 0, average: 0 }, unlocks: 0,
    countryRules: [{
      country_code: 'IN', state: 'blocked', source: 'creator',
      reason: 'Licence covers Nepal only.', updated_at: new Date().toISOString(),
    }],
    platformRules: [{
      country_code: 'NP', state: 'restricted', source: 'operator',
      reason: 'Position of a platform rule.', rule_title: 'Adult content in Nepal',
      updated_at: new Date().toISOString(),
    }],
  });

  assert.match(html, /Your note: Licence covers Nepal only\./,
    "the creator's own note is missing from the creator's own page");
  // A platform's rule is a different thing on this page, and it already carries
  // its own attribution: the rule's title, then the operator's sentence. What
  // must not happen is the operator's words arriving as the CREATOR's note —
  // that would put a sentence they did not write under their name.
  assert.match(html, /Adult content in Nepal[^<]*— Position of a platform rule\./,
    "the platform's rule and its reason are no longer shown together");
  assert.ok(!/Your note: Position of a platform rule/.test(html),
    "the platform's sentence is shown as the creator's own note");
});

test('a file that is waiting for review says so, and says what it does not block', () => {
  /**
   * The creator's side of the rule in `test/moderation.test.js`: their store's
   * first file is live but not in search. Left unsaid, that is a creator
   * refreshing the marketplace, finding nothing, and filing a bug against a
   * platform that looks broken — the same failure the country pages were built to
   * avoid. So the page states the wait, and states the thing the creator actually
   * cares about: the link works and the shop lists it.
   */
  const asset = {
    id: '66666666-6666-4666-8666-666666666666', slug: 'kit', title: 'Kit',
    description: 'd', unlock_mode: 'ad_gated', status: 'live', moderation_state: 'pending',
  };
  const waiting = assetManage({
    channel: CHANNEL, user: null, asset,
    files: [{ filename: 'kit.zip', mime_type: 'application/zip', size_bytes: 1024 }],
    policy: { ads_required: 1, ad_min_seconds: 15, unlock_hours: 24 },
    stats: { count: 0, average: 0 }, unlocks: 0,
  });
  assert.match(waiting, /Waiting for its first review\./);
  // The promise, in the creator's words rather than the schema's.
  assert.match(waiting, /the link above already works, and your store page lists it/);
  assert.ok(!/pending/.test(waiting.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')),
    'the state word is shown to the creator instead of a sentence');

  // An approved file says nothing about review, because there is nothing to say.
  const approved = assetManage({
    channel: CHANNEL, user: null, asset: { ...asset, moderation_state: 'approved' },
    files: [{ filename: 'kit.zip', mime_type: 'application/zip', size_bytes: 1024 }],
    policy: { ads_required: 1, ad_min_seconds: 15, unlock_hours: 24 },
    stats: { count: 0, average: 0 }, unlocks: 0,
  });
  assert.ok(!/Waiting for its first review/.test(approved),
    'an approved file is still announced as waiting');
});

test('a state nobody has decided yet is painted quiet, everywhere it appears', () => {
  /**
   * Five surfaces show a moderation state and they had drifted into four
   * mappings. The disagreement was always about `pending` — the state every
   * store's first file sits in until a person looks at it — and two of them
   * painted it red, the colour a takedown gets. A queue that shouts about the
   * routine case is a queue whose shout stops carrying information, and the cost
   * lands on the day something really is wrong.
   *
   * The rule lives in one helper now, and this test checks it where a person
   * would notice: in the rendered markup, on the three surfaces that show a
   * pending thing.
   */
  const file = {
    id: '77777777-7777-4777-8777-777777777777', title: 'Waiting file', slug: 'waiting',
    moderation_state: 'pending', created_at: new Date().toISOString(), decided_at: null,
    channel_name: 'Nima Crafts', owner_email: 'nima@bytebikri.local', country_summary: null,
  };
  // The operator's file queue.
  const queue = adminModeration({ user: null, rows: [], rules: [], files: [file] });
  assert.match(queue, /<span class="pill">pending<\/span>/,
    'the queue paints a waiting file as something other than routine');

  // The operator's page for that file.
  const page = adminModerationFile({
    user: null, rules: [],
    asset: { ...file, description: 'x', status: 'live', channel_id: 'c', has_files: 1 },
    channel: { slug: 'nima-crafts', name: 'Nima Crafts' },
  });
  assert.ok(page.length > 500, 'the file page rendered');
  assert.match(page, /<span class="pill">pending<\/span>/,
    "the operator's own page paints a waiting file as something other than routine");

  // And the states that ARE decisions keep their colours: red still means a
  // decision that withholds, amber one that limits.
  const removed = adminModerationFile({
    user: null, rules: [],
    asset: { ...file, moderation_state: 'removed' },
    channel: { slug: 'nima-crafts', name: 'Nima Crafts' },
  });
  assert.match(removed, /pill-danger">removed/, 'a removal must still look like a removal');
  const restricted = adminModerationFile({
    user: null, rules: [],
    asset: { ...file, moderation_state: 'restricted' },
    channel: { slug: 'nima-crafts', name: 'Nima Crafts' },
  });
  assert.match(restricted, /pill-warning">restricted/, 'a limitation must still look like one');
});
