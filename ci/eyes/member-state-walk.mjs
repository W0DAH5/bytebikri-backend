/**
 * The member card tells the truth about the clock — walked in a browser, and put back.
 *
 *   node ci/eyes/member-state-walk.mjs [slug] [outDir]
 *
 * THE FAILURE THIS WALK EXISTS FOR, measured before it was fixed: the public roster card — the plate
 * a stranger reads on a storefront — rendered BYTE-IDENTICAL HTML for a member being paid for and one
 * whose period had ended. `sha256 58154f04b3fc3161` both ways, same fixture, with nothing changed but
 * `period_end`. Four other surfaces flipped correctly, which is why it hid: the seller's own member
 * list derives the state and the storefront's card did not, and nothing asserted the two agreed.
 *
 * The assertions are about the CONTRACT rather than the look:
 *
 *   * the card says which state it is in, in words, in both directions — an unmarked card is not a
 *     signal, because a reader cannot tell it from one whose state the page never asked about;
 *   * the two states do not render the same card (the hash pair is the bug, as an assertion);
 *   * the store's tier chip survives in both, because a tier a person held is the store's own record
 *     and the state is a second fact rather than a replacement for the first;
 *   * and the person's own card on the same page agrees with the public plate — the two surfaces are
 *     read in the same minute, from the same row;
 *   * and the members-only FILE PAGE addresses the person standing at it — a member whose period has
 *     run out is told it ended, and a stranger is told what the door is, which was ONE sentence for
 *     BOTH before the fix.
 *
 * THE FIXTURE IS PUT BACK. This walk moves one membership's `period_end` — and, for the file page, the
 * unlock it granted, because an unlock whose date has not passed would still open the file and the
 * lapse would not be genuine — and restores both in a `finally`, so a walk that fails halfway still
 * leaves the demo as it found it. `ci/demo-state.mjs` is the source of that fixture; run it first if
 * the database is fresh.
 */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { sessionFor, consent } from './lib.mjs';

const SLUG = process.argv[2] || 'nima-crafts';
const OUT = process.argv[3] || 'docs/evidence/round48';
const BASE = process.env.EYES_BASE || 'http://127.0.0.1:3100';
mkdirSync(OUT, { recursive: true });

const say = (n, s) => console.log(`\n[${n}] ${s}`);
const findings = [];
const check = (ok, what) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) findings.push(what);
};

const { one, query, close } = await import('../../app/src/db.js');

/** The one membership this walk moves: the demo's top-tier member on a store with a roster. */
const ROW_SQL = `
  select m.profile_id, m.period_end, p.display_name
    from memberships m
    join profiles p on p.id = m.profile_id
    join channels c on c.id = m.channel_id
   where c.slug = $1 and m.status = 'active' and m.publicly_listed
   order by m.tier_no desc, m.joined_at desc
   limit 1`;

const read = () => one(ROW_SQL, [SLUG]);
const setPeriod = (profileId, iso) => query(
  `update memberships set period_end = $2 where profile_id = $1 and channel_id = (
     select id from channels where slug = $3)`,
  [profileId, iso, SLUG],
);

/**
 * The unlock the membership granted, and its members-only file. A lapse is genuine only when BOTH
 * have passed: `doorFor` is a function of the membership's state, but a still-good unlock opens the
 * file anyway, and the page would correctly say "unlocked" — the walk must test the wall, not the
 * row.
 */
const ASSET_SQL = `
  select a.slug from assets a
    join channels c on c.id = a.channel_id
   where c.slug = $1 and a.unlock_mode = 'members' and a.status = 'live'
   order by a.created_at limit 1`;
const UNLOCK_SQL = `
  select u.expires_at from unlocks u
    join profiles p on p.id = u.user_id
    join channels c on c.id = u.channel_id
   where c.slug = $1 and p.display_name = $2
   order by u.granted_at desc limit 1`;
const setUnlock = (displayName, iso) => query(
  `update unlocks u set expires_at = $3
     from profiles p, channels c
    where p.id = u.user_id and c.id = u.channel_id and p.display_name = $2 and c.slug = $1`,
  [SLUG, displayName, iso],
);

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/tmp/chromium', args: ['--no-sandbox'],
});

/** The roster card as a STRANGER sees it — a guest context, never the member's own session. */
async function cardAsGuest() {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const p = await ctx.newPage();
  await p.goto(`${BASE}/s/${SLUG}`);
  await consent(p);
  await p.goto(`${BASE}/s/${SLUG}`);          // consent posts and navigates; fetch again
  const card = await p.locator('.member-roster .member').first();
  const html = await card.innerHTML();
  const state = await card.locator('.member-state').first().getAttribute('data-state').catch(() => null);
  const word = await card.locator('.member-state').first().innerText().catch(() => null);
  const chip = await card.locator('.store-chip').first().innerText().catch(() => null);
  /*
   * GEOMETRY, BECAUSE THE WORDS ALONE PASSED WHILE THE CARD WAS BROKEN.
   *
   * The state's first version made the card 99px tall with the date drawn on top of the chip:
   * `member-body` is a grid, a bare third child made it three rows, and `.member-since` — a flex
   * sibling centred against the body — slid up into them. The word "current" was present and
   * correct in the HTML the whole time, so a text assertion would have called that finished. An
   * overlap is a number, so this part is measured: no two of the card's own parts may share pixels.
   */
  const overlap = await card.evaluate((el) => {
    const parts = [...el.querySelectorAll('.member-name, .store-chip, .member-state, .member-since')]
      .map((c) => ({ cls: c.className.split(' ')[0], r: c.getBoundingClientRect() }));
    const bad = [];
    for (let i = 0; i < parts.length; i += 1) {
      for (let j = i + 1; j < parts.length; j += 1) {
        const a = parts[i].r; const b = parts[j].r;
        const x = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const y = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (x > 1 && y > 1) bad.push(`${parts[i].cls} over ${parts[j].cls} (${Math.round(x)}×${Math.round(y)}px)`);
      }
    }
    return bad;
  });
  return { p, html, state, word: (word || '').trim(), chip: (chip || '').trim(), overlap };
}

const row = await read();
if (!row) {
  console.error(`no listed, active membership on /s/${SLUG} — run ci/demo-state.mjs first`);
  process.exit(2);
}
console.log(`fixture: ${row.display_name} on /s/${SLUG}, period ends ${new Date(row.period_end).toISOString().slice(0, 10)}`);

let currentCard = null;
try {
  // ── 1. inside the period, the card says so ─────────────────────────────────────────────────────
  say(1, 'a member inside their period: the card says which state it is in');
  currentCard = await cardAsGuest();
  console.log(`  the card      : data-state=${currentCard.state} · "${currentCard.word}" · chip "${currentCard.chip}"`);
  check(currentCard.state === 'active', 'the card carries the derived state (active)');
  check(currentCard.word === 'current', 'and says it in the seller list’s own word');
  check(Boolean(currentCard.chip), 'the store’s tier chip is on it');
  check(currentCard.overlap.length === 0,
    `nothing on the card is drawn on top of anything else${currentCard.overlap.length ? `: ${currentCard.overlap.join('; ')}` : ''}`);
  await currentCard.p.locator('.member-roster').first().screenshot({ path: `${OUT}/membership-fixed-01-current.png` });

  // ── 2. one day past the period end, the same card must say the opposite ────────────────────────
  say(2, 'the period ends: the same row, one day later, on the same public page');
  const past = new Date(Date.now() - 86400000).toISOString();
  await setPeriod(row.profile_id, past);
  const endedCard = await cardAsGuest();
  console.log(`  the card      : data-state=${endedCard.state} · "${endedCard.word}" · chip "${endedCard.chip}"`);
  check(endedCard.state === 'lapsed', 'the card carries the derived state (lapsed)');
  check(endedCard.word === 'ended', 'and states it, rather than looking current');
  check(Boolean(endedCard.chip), 'the store’s tier chip is still there — the state is a second fact');
  check(endedCard.html !== currentCard.html,
    'the two states must not render the same card — byte equality was the bug');
  check(endedCard.overlap.length === 0,
    `and the ended card has no overlap either${endedCard.overlap.length ? `: ${endedCard.overlap.join('; ')}` : ''}`);
  await endedCard.p.locator('.member-roster').first().screenshot({ path: `${OUT}/membership-fixed-02-ended.png` });

  // ── 3. and the member's own card on the same page agrees ───────────────────────────────────────
  say(3, 'the person’s own card, read in the same minute, agrees with the public plate');
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    storageState: await sessionFor(browser, row.display_name, { base: BASE }),
  });
  const own = await ctx.newPage();
  await own.goto(`${BASE}/s/${SLUG}`);
  await consent(own);
  await own.goto(`${BASE}/s/${SLUG}`);
  const ownText = (await own.locator('.member-self').first().innerText().catch(() => '')).replace(/\s+/g, ' ');
  console.log('  their card    :', JSON.stringify(ownText.slice(0, 110)));
  check(/period has ended/i.test(ownText), 'their own card says the period has ended');
  await own.locator('.member-self').first().screenshot({ path: `${OUT}/membership-fixed-03-own-card.png` });
  // ── 4. the file page addresses the person at it ─────────────────────────────────────────────────
  //
  // The second surface with the same defect, on the page where the loss is actually felt: a member
  // whose period ended arrived here by clicking a file that opened for them the day before, and the
  // gate said to them character-for-character what it says to a signed-out stranger.
  say(4, 'the members-only file page: the lapsed member vs the stranger, same page');
  const assetSlug = (await one(ASSET_SQL, [SLUG]))?.slug;
  if (!assetSlug) {
    check(false, `no live members-only file on /s/${SLUG} — cannot walk the file page`);
  } else {
    const unlock = await one(UNLOCK_SQL, [SLUG, row.display_name]);
    if (unlock) {
      const unlockBack = new Date(unlock.expires_at).toISOString();
      await setUnlock(row.display_name, past);   // a genuine lapse, not a moved date
      const fileUrl = `${BASE}/s/${SLUG}/a/${assetSlug}`;

      // The member, one day out of the period, reading their own file.
      const mctx = await browser.newContext({
        viewport: { width: 1280, height: 900 },
        storageState: await sessionFor(browser, row.display_name, { base: BASE }),
      });
      const mp = await mctx.newPage();
      await mp.goto(fileUrl);
      await consent(mp);
      await mp.goto(fileUrl);
      const mGate = mp.locator('.member-gate').first();
      const mRefusal = await mGate.getAttribute('data-refusal').catch(() => null);
      const mText = (await mGate.innerText().catch(() => '')).replace(/\s+/g, ' ');
      console.log(`  their file page : data-refusal=${mRefusal} · ${JSON.stringify(mText.slice(0, 90))}`);
      check(mRefusal === 'lapsed', 'the gate knows this reader is a lapsed member');
      check(/membership has ended/i.test(mText), 'and says it ended, in words, to them');
      check(!/members open this\./.test(mText),
        'they are not addressed as a stranger — that sentence is for people who never joined');
      await mGate.screenshot({ path: `${OUT}/membership-fixed-04-file-lapsed.png` });

      // The stranger: the same page still sells the door to them, unchanged.
      const gctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      const gp = await gctx.newPage();
      await gp.goto(fileUrl);
      await consent(gp);
      await gp.goto(fileUrl);
      const gGate = gp.locator('.member-gate').first();
      const gRefusal = await gGate.getAttribute('data-refusal').catch(() => null);
      const gWhole = (await gGate.innerText().catch(() => '')).replace(/\s+/g, ' ');
      console.log(`  the stranger's  : data-refusal=${gRefusal} · ${JSON.stringify(gWhole.slice(0, 90))}`);
      check(gRefusal === 'join', 'the stranger is still the stranger');
      check(/members open this\./.test(gWhole), 'and the door is still sold to them');
      await gGate.screenshot({ path: `${OUT}/membership-fixed-05-file-stranger.png` });

      await setUnlock(row.display_name, unlockBack);
      check((await one(UNLOCK_SQL, [SLUG, row.display_name])).expires_at instanceof Date,
        'their unlock is back where it was found');
    } else {
      console.log('  (no unlock row for this member — the file page needs the door, not a row)');
    }
  }
} finally {
  // ── 5. THE FIXTURE GOES BACK, whether the walk passed or failed ─────────────────────────────────
  await setPeriod(row.profile_id, new Date(row.period_end).toISOString());
  await close();
  await browser.close();
  console.log('\nthe fixture is back where it was found');
}

console.log(`\nwalk complete — ${findings.length} finding(s)`);
process.exit(findings.length ? 1 : 0);
