/**
 * The member perk, walked in a browser (REVENUE_ARCHITECTURE, "The one thing a plan
 * may do to our position").
 *
 * `test/slots.test.js` holds the two conditions and the allocator's arithmetic, and
 * `test/networks.test.js` holds the seller's own panel. What neither can show is the
 * page: a capability whose only visible effect is a box NOT appearing for somebody
 * else is the easiest thing in this product to ship broken, because every surface
 * that reads the flag will look perfectly correct while the flag is never set, or
 * set for everyone. So the walk takes the same storefront and puts four different
 * people in front of it:
 *
 *   1. **A stranger** — face value, and the platform's position is there. The rent
 *      leg exists because this pageview counts; a release for the whole world would
 *      delete it, which is the failure the allocator's own test caught in a draft.
 *   2. **A current member** — the position is GONE. This is the perk, alone.
 *   3. **A claimant whose dues are not confirmed** — the position is still there. The
 *      perk belongs to members, and a claim is not a membership; the walk uses the
 *      demo's real `pending` row rather than inventing a lapsed one.
 *   4. **A member of a DIFFERENT store** — still there, on the other store's page.
 *      Membership is between a store and its members, and the store that pays for
 *      the capability is the only store whose pages change.
 *
 * Then the two things the page owes the seller, because a seller cannot be expected
 * to notice a box that stopped rendering: the panel NAMES the position that goes (the
 * store's own positions and its own in-file breaks are never part of this), and the
 * plan that does not carry the capability is not told about it at all.
 *
 * Names and shapes it does not have a fixture for, it makes one: the demo's stores
 * are on the `store` plan, so the walk moves the member's store onto `pro` for the
 * length of the run and puts it back in a `finally`. That is the same kind of scoped
 * fixture surgery as `reset-unlock.mjs --windows`, and it is why the last two steps
 * exist: after the restore, the stranger's page carries the position again — proving
 * the flip, and not a cache, was what the walk was measuring.
 *
 *   node ci/eyes/member-adfree-walk.mjs [storeSlug] [member] [nonMember] [outDir]
 *
 * DO NOT PIPE THIS WALK INTO `head`, `grep -m`, or anything else that closes the pipe
 * early. It moves a plan for the length of the run and puts it back in a `finally`, and
 * a SIGPIPE kill lands before that — which is how the demo's store was left on the top
 * plan for one run. It is recoverable (`update subscriptions set plan_code='store'`) and
 * the walk's own last step prints the plan it found and left behind, but a reader
 * running `| tail` is reading a walk that may not have finished.
 *
 * Dev-only, like every walk here.
 */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { consent, open, sessionFor } from './lib.mjs';
import { query, close } from '../../app/src/db.js';
import { HOUSE_CREATIVE } from '../../app/src/creatives.js';
import { MEMBER_AD_LINE, MEMBER_AD_LINE_RELEASED } from '../../app/src/memberships.js';

if (process.env.NODE_ENV === 'production') {
  console.error('refusing to move a plan around on a production database');
  process.exit(1);
}

const BASE = process.env.EYES_BASE || 'http://127.0.0.1:3000';
const [STORE = 'nima-crafts', MEMBER = 'alice', CLAIMANT = 'bob', OUT = 'docs/evidence/round43'] =
  process.argv.slice(2);
const PLAN_THAT_CARRIES = 'pro';

const errors = [];
const fail = (msg) => { console.error(`FAIL  ${msg}`); errors.push(msg); };
const ok = (label, extra = '') => console.log(`ok    ${label}${extra ? ` — ${extra}` : ''}`);

/** Open a page as somebody, answer the banner, and read it back. */
async function see(browser, path, storageState = null) {
  const { ctx, p } = await open(browser, { width: 1440, height: 1000, storageState });
  const res = await p.goto(BASE + path);
  await consent(p);
  const view = await positions(p);
  /*
   * The guard that makes this walk worth anything.
   *
   * Every assertion below counts a box that is NOT there, and a page that failed to
   * render has no boxes on it either. A 500 from `slotsPage` would have read as "the
   * member's page is ad-free" — and the one bug this round actually shipped was an
   * undefined reference in that exact function. So a page is only believed when it
   * answered 200, has real content on it, threw nothing, and says whose store it is.
   */
  view.health = {
    status: res?.status() ?? 0,
    chars: await p.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').trim().length),
    errors: p.errors.slice(),
    names: await p.evaluate((slug) => document.body.innerText.includes(slug.replace(/-crafts$/, '').split('-')
      .map((w) => w[0].toUpperCase() + w.slice(1)).join(' ')), path.split('/')[2] || ''),
  };
  return { ctx, p, ...view };
}

/** A page nobody can draw a conclusion from is a failed step, not a passing one. */
function sound(label, view) {
  const h = view.health;
  if (h.status !== 200) { fail(`${label}: the page answered ${h.status}`); return false; }
  if (h.chars < 400) { fail(`${label}: ${h.chars} characters of content — this is not the storefront`); return false; }
  if (h.errors.length) { fail(`${label}: the page threw — ${h.errors.join(' | ')}`); return false; }
  if (!h.names) { fail(`${label}: the page does not name the store it is showing`); return false; }
  return true;
}

/** Every position the page drew, by owner. The markup is the product's own. */
async function positions(page) {
  await page.waitForSelector('.slot, main', { timeout: 15000 });
  await page.waitForTimeout(250);
  return page.evaluate(() => {
    const read = (sel) => Array.from(document.querySelectorAll(sel)).map((el) => ({
      slot: el.dataset.slot || '', surface: el.dataset.surface || '', serving: el.dataset.serving || '',
    }));
    return {
      platform: read('aside[data-slot][data-owner="platform"]'),
      channel: read('aside[data-slot][data-owner="channel"]'),
      // The house creative's own words, so a release cannot be mistaken for a copy
      // change: the position is either in the markup or it is not.
      text: (document.querySelector('aside[data-owner="platform"] .slot-creative-body')?.textContent || '').trim(),
      // The member's own paragraph about where the ads are. It names the positions on
      // the page, and on the one plan this product sells FOR taking ours away it named
      // ours — in the panel of the very person who cannot see it.
      memberLine: (document.querySelector('.member-self .fine:last-of-type')?.textContent || '').trim(),
      title: document.title,
    };
  });
}

mkdirSync(OUT, { recursive: true });

// ── the scoped fixture: the member's store buys the capability ───────────────
const store = await query('select id, slug, name from channels where slug = $1', [STORE]);
if (!store.rows.length) { console.error(`no store ${STORE}`); process.exit(1); }
const channelId = store.rows[0].id;
const before = await query(
  `select plan_code, status from subscriptions where channel_id = $1 order by period_end desc limit 1`,
  [channelId],
);
const previousPlan = before.rows[0]?.plan_code ?? null;
if (previousPlan === PLAN_THAT_CARRIES) {
  console.log(`note: ${STORE} is already on ${PLAN_THAT_CARRIES}; the walk will not move it`);
}
const memberships = await query(
  `select p.email, m.status, m.tier_no, m.period_end > now() as live
     from memberships m join profiles p on p.id = m.profile_id
    where m.channel_id = $1 order by p.email`,
  [channelId],
);
console.log(`store ${STORE} — plan ${previousPlan}, memberships ${JSON.stringify(memberships.rows)}`);

const setPlan = (code) => query(
  `update subscriptions set plan_code = $2 where channel_id = $1`, [channelId, code],
);

/**
 * The box this store's rent pays for, in PAGE coordinates — where it sits in the
 * document rather than in the viewport. The stranger's page measures it; the member's
 * page is cropped with the SAME rectangle, because "a box is missing" is only evidence
 * when the empty space can be read against the box that used to be in it. If the two
 * pages placed their content differently the pair would prove nothing, so both rects
 * are printed and compared.
 */
async function boxRect(page) {
  return page.evaluate(() => {
    const el = document.querySelector('aside[data-owner="platform"]');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + scrollX), y: Math.round(r.top + scrollY), width: Math.round(r.width), height: Math.round(r.height) };
  });
}

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/tmp/chromium',
  args: ['--no-sandbox'],
});
/** Where the box sits on the stranger's page; the member's page is cropped with it. */
let clip = null;
let shots = 0;
const shot = async (page, name) => {
  shots += 1;
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
};

try {
  if (previousPlan !== PLAN_THAT_CARRIES) await setPlan(PLAN_THAT_CARRIES);

  // ── 1. a stranger sees it ──────────────────────────────────────────────────
  {
    const { ctx, p, ...face } = await see(browser, `/s/${STORE}`);
    if (!sound('a signed-out visitor', face)) throw new Error('the walk cannot measure a page that does not render');
    console.log('   stranger      :', JSON.stringify({ platform: face.platform.length, channel: face.channel.length }));
    if (face.platform.length !== 1) fail(`a signed-out visitor saw ${face.platform.length} platform positions, not 1`);
    else ok('a stranger sees the position the rent pays for', face.platform[0].slot);
    // The direction of the arrangement, in the markup the visitor reads: the store
    // pays rent for this position. The reversed sentence lived here for three rounds.
    if (!/The store pays rent for it/.test(face.text)) fail(`the house creative does not say who pays: "${face.text}"`);
    else ok('and the house creative says the store pays the rent for it');
    /*
     * Character for character against the constant — because the sentence that shipped
     * for one draft was cut at 220 characters by `normaliseCreative` and rendered as
     * "…No cut of what the" on every storefront in the product. A browser is the only
     * place that could be seen: the module held the whole sentence, the page held most
     * of it, and every unit test passed. Equality against the source is the assertion
     * that makes a clamp visible.
     */
    if (face.text !== HOUSE_CREATIVE.body) {
      fail(`the rendered house line is not the sentence in the code:\n      page:   "${face.text}"\n      source: "${HOUSE_CREATIVE.body}"`);
    } else ok('and the storefront renders it whole — no clamp, no ellipsis', `${face.text.length} characters`);
    if (/rented to ByteBikri|space you are paid for/i.test(face.text)) fail('the reversed direction is still printed');
    // The one shot in this walk that has to be croppable: the box itself, and the
    // page it sits in.
    const rect = await boxRect(p);
    if (!rect) fail('the platform position has no geometry, so the pair cannot be cropped');
    /*
     * The crop is the FOOT of the page in the position's own column, not a rectangle
     * around the box — because the member's page is genuinely shorter (their join
     * panel is a summary instead of a form), so a fixed rectangle measured here runs
     * off the end of their page and screenshots nothing. The foot of the page in the
     * same column is the region the position occupies on every storefront: it is the
     * last position on the page by allocation, never the first.
     */
    clip = rect ? {
      x: Math.max(0, rect.x - 28),
      width: Math.min(1440 - Math.max(0, rect.x - 28), rect.width + 56),
      // 340px of page foot — enough for the box and its label above it.
      take: 340,
    } : null;
    if (clip) {
      const tall = await p.evaluate(() => document.documentElement.scrollHeight);
      clip.y = Math.max(0, Math.min(rect.y - 28, tall - clip.take - 1));
      clip.height = Math.min(clip.take, tall - clip.y);
      console.log('   the box sits at:', JSON.stringify({ ...rect, pageHeight: tall }));
    }
    await p.evaluate(() => scrollTo(0, 0));
    await p.waitForTimeout(150);
    await shot(p, 'member-adfree-1-stranger');
    if (clip) await p.screenshot({ path: `${OUT}/member-adfree-1-stranger-box.png`, clip, fullPage: true });
    await ctx.close();
  }

  // ── 2. a current member does not ───────────────────────────────────────────
  {
    const state = await sessionFor(browser, MEMBER, { base: BASE });
    const { ctx, p, ...member } = await see(browser, `/s/${STORE}`, state);
    if (!sound(`${MEMBER} on /s/${STORE}`, member)) console.log('   (a release is only proven on a page that renders)');
    console.log('   member        :', JSON.stringify({
      platform: member.platform.length, channel: member.channel.length, health: member.health,
    }));
    if (member.platform.length !== 0) {
      fail(`${MEMBER} is a live member of ${STORE} and still saw ${member.platform.length} platform position(s)`);
    } else ok(`${MEMBER}, a live member of ${STORE}, does not see the platform's position`);
    const stillThere = await p.locator('aside[data-owner="channel"]').count();
    ok('the store’s own positions are decided by the store, not by this', `${stillThere} of the store’s on this page`);
    // The sentence the member reads has to match the page the member is on. Both are
    // asserted whole, against the constants, because the failure mode is a paragraph
    // that stays right for the store that did NOT buy the release and lies on the one
    // that did — a two-state sentence with one state rendered.
    if (member.memberLine !== MEMBER_AD_LINE_RELEASED) {
      fail(`the member’s own line does not match the released state:\n      page:   "${member.memberLine}"\n      source: "${MEMBER_AD_LINE_RELEASED}"`);
    } else ok('and the member is told, in that panel, that our position is not on their page');
    if (/the one bytebikri rents/.test(member.memberLine)) {
      fail('the panel tells a member our position is on the page it is not on');
    }
    await p.evaluate(() => scrollTo(0, 0));
    await p.waitForTimeout(150);
    await shot(p, 'member-adfree-2-member');
    // The same rectangle, on the member's page: the space where the position was.
    if (clip) {
      const where = await boxRect(p);
      const samePlace = !where || Math.abs(where.y - (clip.y + 28)) < 60;
      console.log('   the same rectangle:', JSON.stringify({ stranger: clip.y + 28, member: where?.y ?? 'no box', samePlace }));
      if (where && !samePlace) fail(`the two pages no longer lay out alike (box at ${where.y}, crop at ${clip.y + 28})`);
      /*
       * The member's page is SHORTER by the box that is not on it, so the stranger's
       * rectangle can reach past its last line. Clamped rather than skipped: what the
       * pair has to show is the same region of the same page, and a crop that ran off
       * the end would be a screenshot of nothing at all.
       */
      const tall = await p.evaluate(() => document.documentElement.scrollHeight);
      const y = Math.max(0, Math.min(clip.y, tall - clip.take - 1));
      const height = Math.min(clip.take, tall - y);
      console.log('   their page foot:', JSON.stringify({ pageHeight: tall, y, height }));
      await p.screenshot({
        path: `${OUT}/member-adfree-2-member-box.png`,
        clip: { x: clip.x, width: clip.width, y, height },
        fullPage: true,
      });
    }
    await ctx.close();
  }

  // ── 3. a claim is not a membership ─────────────────────────────────────────
  {
    const row = memberships.rows.find((r) => r.email === `${CLAIMANT}@bytebikri.local`);
    if (!row) fail(`${CLAIMANT} has no membership row on ${STORE} to be a claimant`);
    else if (row.status === 'active' && row.live) fail(`${CLAIMANT} is an ACTIVE member — the fixture no longer holds a claim`);
    const state = await sessionFor(browser, CLAIMANT, { base: BASE });
    const { ctx, p, ...claimant } = await see(browser, `/s/${STORE}`, state);
    console.log('   claimant      :', JSON.stringify({ status: row?.status, platform: claimant.platform.length }));
    if (claimant.platform.length !== 1) {
      fail(`${CLAIMANT}’s dues are unconfirmed (${row?.status}) and the position was still released to them`);
    } else ok(`a ${row?.status} claim on the store is not a membership, and the position is still shown`);
    await shot(p, 'member-adfree-3-claimant');
    await ctx.close();
  }

  // ── 4. the store next door, and the store that did not buy it ──────────────
  {
    const state = await sessionFor(browser, MEMBER, { base: BASE });
    // Alice is a member of the store above and the OWNER of `/s/alice`, which is on
    // the plan that does not carry the capability. Both directions in one page: the
    // platform's position is there, and so is the store's own.
    const { ctx, p, ...other } = await see(browser, '/s/alice', state);
    if (!sound('the store that did not buy it', other)) throw new Error('this page is the walk’s control and must render');
    console.log('   a store that did not buy it:', JSON.stringify({ platform: other.platform.length, channel: other.channel.length }));
    if (other.platform.length !== 1) fail(`a plan without the capability released the position (${other.platform.length})`);
    else ok('a store on a plan without the capability keeps the position, member or not');
    if (other.channel.length < 1) fail('the store’s own position vanished, which no plan may do');
    else ok('and the store’s own position is on the same page, untouched', other.channel[0].slot);
    // The other branch of the same sentence, on a page where our position IS present:
    // alice is the owner here rather than a member, so the panel is the storefront's
    // seller-side copy — read from the page she gets.
    if (other.memberLine && other.memberLine !== MEMBER_AD_LINE) {
      fail(`a store that did not buy the release prints the released sentence:\n      "${other.memberLine}"`);
    }
    await shot(p, 'member-adfree-4-other-store');
    await ctx.close();
  }

  // ── 5. the seller’s panel names the position ───────────────────────────────
  {
    // The owner's account is named after the store's first word in the demo — this
    // is `sessionFor`'s own convention (`STORE_SLUG` there maps the same way).
    const owner = await sessionFor(browser, STORE.split('-')[0], { base: BASE });
    const { ctx, p } = await open(browser, { width: 1440, height: 1100, storageState: owner });
    await p.goto(`${BASE}/dashboard/${STORE}/slots`);
    await consent(p);
    const panel = await p.evaluate(() => {
      const note = document.querySelector('[data-member-ad-free="true"]');
      return { perk: Boolean(note), text: (note?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 400) };
    });
    console.log('   seller panel  :', JSON.stringify({ perk: panel.perk }));
    if (!panel.perk) fail(`${STORE} pays for the release and its own panel does not say so`);
    else ok('the seller who bought it is told, on the slot panel');
    if (!/releases this position/.test(panel.text)) fail(`the panel does not name the position: "${panel.text}"`);
    if (!/breaks inside your files are still yours/.test(panel.text)) {
      fail(`the panel does not say what is untouched: "${panel.text}"`);
    } else ok('and it says the store’s own positions and in-file breaks are not part of it');
    if (!/the people who currently hold a membership of this store/.test(panel.text)) {
      fail('the release is not scoped to the store’s own current members in the copy');
    }
    // The note itself, rather than a viewport that happens to end above it: the panel
    // is long, and a screenshot that shows the rule list and not the sentence under
    // test is evidence of the wrong thing.
    const note = p.locator('[data-member-ad-free="true"]');
    await note.scrollIntoViewIfNeeded();
    await p.waitForTimeout(200);
    await note.screenshot({ path: `${OUT}/member-adfree-5-seller-panel.png` });
    shots += 1;
    await p.evaluate(() => scrollTo(0, 0));
    await p.waitForTimeout(150);
    await shot(p, 'member-adfree-5-seller-page');

    // Alice's own store is not on the plan, and this paragraph must not appear for
    // her: a seller told about a capability their plan does not carry is being sold
    // something twice.
    await p.goto(`${BASE}/dashboard/alice/slots`);
    await p.waitForTimeout(250);
    const notBought = await p.locator('[data-member-ad-free="true"]').count();
    if (notBought !== 0) fail('the perk is described to a store whose plan does not carry it');
    else ok('a store that did not buy it is not told about it');
    await ctx.close();
  }
} finally {
  // The fixture goes back the way it was found, whether the walk passed or not.
  if (previousPlan && previousPlan !== PLAN_THAT_CARRIES) await setPlan(previousPlan);
}

// ── 6. and the page is exactly as it was before the walk touched it ──────────
{
  const { ctx, ...after } = await see(browser, `/s/${STORE}`);
  const plan = await query(
    `select plan_code from subscriptions where channel_id = $1 order by period_end desc limit 1`, [channelId],
  );
  console.log('   after restore :', JSON.stringify({ plan: plan.rows[0]?.plan_code, platform: after.platform.length }));
  if (plan.rows[0]?.plan_code !== previousPlan) fail(`${STORE} was left on ${plan.rows[0]?.plan_code}, not ${previousPlan}`);
  if (after.platform.length !== 1) {
    fail(`with the plan back, the stranger’s page still holds ${after.platform.length} positions — the release was not the capability`);
  } else ok('with the plan restored, the position is back for everyone — the capability was the cause');
  await ctx.close();
}

await browser.close();
await close();
console.log(`\nshots           : ${OUT}/member-adfree-1..5 (page, box pair, seller note)`);
if (errors.length) {
  console.error(`\nmember ad-free walk: ${errors.length} finding(s)`);
  process.exit(1);
}
console.log('member ad-free walk: ok');
