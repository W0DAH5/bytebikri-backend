/**
 * What draws in a slot.  npm test
 *
 * The slot is where the two halves of the revenue model meet: the store's own
 * space, which is the creator's and nobody pays for it, and the platform's rent
 * slot, which is the consideration for the rent. The failure modes are all
 * "the wrong party's message in the wrong party's space", so that is what these
 * assertions are about.
 *
 * One of them is not hypothetical. The first version of `composeSlots`
 * registered every creative under both its own slot key AND the wildcard, which
 * put the store's top-slot announcement into all four of its slots at once, on
 * every page. `a creative written for one slot does not leak` is that bug.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

const {
  composeSlot, composeSlots, sanitizeUrl, normaliseCreative, slotFraming,
  HOUSE_CREATIVE, SLOT_PURPOSE,
} = await import('../src/creatives.js');
// The renderer is imported, not re-implemented: the point of this test is that the
// view reads the flag, and a copy of the view's logic here would pass while the
// real one kept drawing the box.
const { renderSlot } = await import('../src/views.js');

const slot = (over = {}) => ({
  slotKey: 'top_leaderboard', label: 'Top of store', rank: 1, maxHeightPx: 250,
  formats: ['display'], surface: 'webview', owner: 'channel', serving: false, ...over,
});

const channelCreative = { owner: 'channel', slot_key: 'top_leaderboard', headline: 'New kit out', active: true, rank: 100 };
const platformCreative = { owner: 'platform', slot_key: '*', headline: 'ByteBikri house ad', active: true, rank: 100 };

// ---------------------------------------------------------------------------
// Whose space is it
// ---------------------------------------------------------------------------

test('a platform slot shows the house creative, because the rent was paid for space that is used', () => {
  const composed = composeSlot({ slot: slot({ owner: 'platform', slotKey: 'footer_native' }) });
  assert.equal(composed.owner, 'platform');
  assert.equal(composed.creative.headline, HOUSE_CREATIVE.headline);
  assert.equal(composed.from, 'house');
  assert.equal(composed.serves, true);
  assert.equal(composed.purpose, SLOT_PURPOSE.footer_native, 'the rent slot says why it is the one rented out');
});

test('the store\'s creative can never fill the platform\'s slot, or the reverse', () => {
  const platformSlot = composeSlot({ slot: slot({ owner: 'platform' }), creative: channelCreative });
  assert.equal(platformSlot.creative.owner, 'platform', 'the store cannot write into the space it rents out');
  assert.equal(platformSlot.creative.headline, HOUSE_CREATIVE.headline);

  const storeSlot = composeSlot({ slot: slot({ owner: 'channel' }), creative: platformCreative });
  assert.equal(storeSlot.serves, false, 'our inventory does not appear where the store did not ask for it');
  assert.equal(storeSlot.creative, null);
});

test('a creative written for one slot does not leak into the others', () => {
  const slots = [
    slot({ slotKey: 'top_leaderboard', rank: 1 }),
    slot({ slotKey: 'in_content_1', rank: 2 }),
    slot({ slotKey: 'footer_native', rank: 5, owner: 'platform' }),
  ];
  const composed = composeSlots(slots, [channelCreative, platformCreative]);
  assert.equal(composed[0].creative.headline, 'New kit out');
  assert.equal(composed[1].serves, false, 'the footer has no message and an empty slot is not filled with the top one');
  assert.equal(composed[2].creative.headline, 'ByteBikri house ad',
    'the platform slot takes the platform creative, and only the platform one');

  // A wildcard creative is the one that may fill any slot of its owner's.
  const wild = composeSlots(slots, [{ ...channelCreative, slot_key: '*' }]);
  assert.equal(wild[1].creative.headline, 'New kit out');
});

test('the highest-ranked creative for a slot wins, whatever order they arrive in', () => {
  const rows = [
    { ...platformCreative, headline: 'second', rank: 200 },
    { ...platformCreative, headline: 'first', rank: 10 },
  ];
  const composed = composeSlots([slot({ owner: 'platform' })], rows);
  assert.equal(composed[0].creative.headline, 'first');
});

test('an empty slot tells the owner what to do about it and tells a visitor nothing', () => {
  const asOwner = composeSlot({ slot: slot(), isOwner: true, editHref: '/dashboard/alice/slots' });
  assert.equal(asOwner.serves, false);
  assert.match(asOwner.emptyNote, /Write a headline/);
  assert.match(asOwner.editHref, /dashboard/);

  const asVisitor = composeSlot({ slot: slot(), channelName: 'Alice Studio' });
  assert.match(asVisitor.emptyNote, /Alice Studio has not put a message here yet/);
  assert.equal(asVisitor.editHref, null, 'a shopper is never offered a link into somebody\u2019s dashboard');

  const onOwnerPage = composeSlot({
    slot: slot(), isOwner: true, surface: 'dashboard', editHref: '/dashboard/alice/slots',
  });
  assert.equal(onOwnerPage.editHref, null, 'not on the page that already shows the form');
});

test('a slot that the store filled is not a network slot', () => {
  const filled = composeSlot({ slot: slot({ providerId: 'adsterra' }), creative: channelCreative });
  assert.equal(filled.adapter, 'store');
  // A slot with a connection and nothing in it keeps the seam, so a network's
  // own tag has a container to mount in.
  const empty = composeSlot({ slot: slot({ providerId: 'adsterra' }) });
  assert.equal(empty.adapter, 'adsterra');
});

test('the web slot says which surface it is, and that it is not the auction', () => {
  const web = composeSlot({ slot: slot() });
  assert.match(web.rtbNote, /Rewarded video does not run in a browser/);
  assert.equal(web.rtb, false, 'a web view is never presented as a bid');
  assert.equal(composeSlot({ slot: slot({ surface: 'app_native' }) }).rtbNote, null);
});

test('the platform’s own message survives the platform’s own clamp', () => {
  // The house creative is written in this repository and rendered on every storefront,
  // and it is normalised by the same function that normalises a seller's creative —
  // including its 220-character body cap. The first draft of the corrected sentence ran
  // 252 characters and shipped clipped ("…No cut of what the"), which is the worst
  // possible place for this product to print half a sentence: our own box, on somebody
  // else's page. Exemption would be the wrong fix — the platform's copy obeys the rule a
  // seller's copy obeys, so what is asserted here is that the sentence FITS.
  const house = normaliseCreative({ ...HOUSE_CREATIVE, owner: 'platform', is_house: true });
  assert.equal(house.body, HOUSE_CREATIVE.body,
    'the platform’s own line is being cut by its own normaliser');
  assert.ok(HOUSE_CREATIVE.headline.length <= 90 && HOUSE_CREATIVE.body.length <= 220,
    `the house creative is over the cap: headline ${HOUSE_CREATIVE.headline.length}/90, body ${HOUSE_CREATIVE.body.length}/220`);
  assert.ok(HOUSE_CREATIVE.linkLabel.length <= 40);

  // And the direction, in the words a visitor reads: the STORE pays rent for this
  // position. It read "rented to ByteBikri" — the arrangement, exactly backwards — on
  // every storefront for three rounds.
  assert.ok(/The store pays rent for it/.test(HOUSE_CREATIVE.body));
  assert.ok(!/rented to ByteBikri/i.test(HOUSE_CREATIVE.body));
  // The store's own space is never for sale in our copy either: one sentence naming the
  // two owners is the whole model, and half of it is missing without this.
  assert.ok(/no cut of what the store earns/i.test(HOUSE_CREATIVE.body));
});

test('the framing names the party, not a colour', () => {
  assert.equal(slotFraming('platform').label, 'Advertisement');
  assert.match(slotFraming('platform').byline, /store is not the advertiser/);
  assert.equal(slotFraming('channel', { channelName: 'Bob Photography' }).label, 'From Bob Photography');
});

// ---------------------------------------------------------------------------
// Copy the tenant controls is sanitised, not trusted
// ---------------------------------------------------------------------------

test('a link the tenant writes is sanitised before it reaches a page', () => {
  assert.equal(sanitizeUrl('javascript:alert(1)'), null);
  assert.equal(sanitizeUrl('JavaScript:alert(1)'), null, 'case is not a bypass');
  assert.equal(sanitizeUrl('data:text/html,<script>alert(1)</script>'), null);
  assert.equal(sanitizeUrl('//evil.example/phish'), null);
  assert.equal(sanitizeUrl('http://example.com/kit'), 'https://example.com/kit', 'plain http is upgraded, not refused');
  assert.equal(sanitizeUrl('http://example.com'), 'https://example.com/', 'and the path is normalised by the URL parser');
  assert.equal(sanitizeUrl('/s/alice'), '/s/alice');
  assert.equal(sanitizeUrl('  /s/alice  '), '/s/alice');
  assert.equal(sanitizeUrl('/\\evil.example'), null, 'a backslash after the slash is read as protocol-relative');
  assert.equal(sanitizeUrl('not a url'), null);
  assert.equal(sanitizeUrl(''), null);
  assert.equal(sanitizeUrl(null), null);
  assert.equal(sanitizeUrl({ toString: () => 'javascript:alert(1)' }), null, 'not a string, not a link');
});

test('a creative without a headline is not a creative', () => {
  assert.equal(normaliseCreative({ headline: '   ', owner: 'channel' }), null);
  assert.equal(normaliseCreative(null), null);
  assert.equal(normaliseCreative({ owner: 'channel', headline: 'Live', active: false }), null);
});

test('a link label with no link goes nowhere and is dropped', () => {
  const c = normaliseCreative({ owner: 'channel', headline: 'Live', link_label: 'Buy now' });
  assert.equal(c.linkUrl, null);
  assert.equal(c.linkLabel, null, 'a button that does nothing is worse than no button');
  const withLink = normaliseCreative({ owner: 'channel', headline: 'Live', link_url: '/s/a', link_label: '  See it  ' });
  assert.equal(withLink.linkLabel, 'See it');
});

test('creative copy is bounded, so one store cannot take over a page', () => {
  const long = normaliseCreative({ owner: 'channel', headline: 'h'.repeat(400), body: 'b'.repeat(900) });
  assert.equal(long.headline.length, 90);
  assert.equal(long.body.length, 220);
});

// ---------------------------------------------------------------------------
// The store side
// ---------------------------------------------------------------------------

process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:55432/bytebikri_test';
const { store } = await import('../src/store.js');
const { close } = await import('../src/db.js');
const { after } = await import('node:test');
after(async () => { await close(); });

let seq = 0;
async function channel() {
  const tag = `${Date.now()}-${++seq}`;
  const user = await store.userByEmailOrCreate(`slot-${tag}@test.local`);
  return store.createChannel({ ownerId: user.id, slug: `slot-${tag}`, name: `Slot ${tag}` });
}

test('a store keeps one message per slot, and correcting it corrects it', async () => {
  const ch = await channel();
  const first = await store.setCreative({ channelId: ch.id, slotKey: 'top_leaderboard', headline: 'First' });
  const second = await store.setCreative({
    channelId: ch.id, slotKey: 'top_leaderboard', headline: 'Second', body: 'Corrected',
  });
  assert.equal(second.id, first.id, 'the same slot is the same row');
  assert.equal(second.headline, 'Second');

  await store.setCreative({ channelId: ch.id, slotKey: 'in_content_1', headline: 'Elsewhere' });
  const rows = await store.creativesForChannel(ch.id);
  assert.equal(rows.filter((r) => r.owner === 'channel').length, 2, 'two slots, two messages');

  assert.equal(await store.setCreative({ channelId: ch.id, slotKey: 'top_leaderboard', headline: '  ' }), null,
    'a blank headline is not saved over a real one');

  await store.clearCreative({ channelId: ch.id, slotKey: 'top_leaderboard' });
  const after = await store.creativesForChannel(ch.id);
  assert.equal(after.filter((r) => r.owner === 'channel' && r.active).length, 1);
});

test('what one store writes is not returned for another', async () => {
  const a = await channel();
  const b = await channel();
  await store.setCreative({ channelId: a.id, slotKey: 'top_leaderboard', headline: 'A only' });
  const forB = await store.creativesForChannel(b.id);
  assert.ok(!forB.some((r) => r.headline === 'A only'));
  assert.ok(forB.every((r) => r.owner === 'platform'), 'the platform\u2019s own inventory is the only shared row');
});

test('the house creative is upserted, not appended', async () => {
  await store.ensurePlatformCreative({ slotKey: '*', headline: 'House v1', body: 'one' });
  await store.ensurePlatformCreative({ slotKey: '*', headline: 'House v2', body: 'two' });
  const rows = await store.platformCreatives();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].headline, 'House v2');
});

test('our own placeholder does not reserve a billboard, and a sold creative still does', () => {
  /**
   * The rule this module already stated — "an empty box is a hole, not a
   * commitment" — was applied to a store's unfilled slot and not to the platform's
   * house fallback, which rendered at the slot's full reserved height (280px) with
   * our own message centred inside it. On a storefront holding one file, our
   * placeholder took more vertical room than the content did, and a large empty
   * panel is what a broken banner looks like.
   *
   * The distinction the renderer needs is not "is there a creative" but "did
   * anybody buy this space": the reservation exists so a real tag arriving late
   * does not shove the page down, and a fallback is not a tag on its way.
   */
  const platformSlot = (creative) => composeSlot({
    slot: slot({ owner: 'platform', slotKey: 'footer_native', surface: 'storefront' }),
    creative,
  });

  const fallback = platformSlot(null);
  assert.equal(fallback.houseFallback, true, 'the house message is marked as ours, not as a sale');
  assert.equal(fallback.serves, true, 'it is still something to show');

  const sold = platformSlot({
    owner: 'platform', slot_key: '*', headline: 'Bought space', active: true, rank: 100,
  });
  assert.equal(sold.houseFallback, false, 'a sold creative is not a placeholder');
  assert.equal(sold.creative.headline, 'Bought space');

  // The row that actually exists in a running system is a STORED house row: the
  // boot upsert writes it, so on a live page the fallback branch above is never
  // the one taken. The first version of this change inferred the flag from "was
  // there a row at all", and therefore changed nothing on the real page. The flag
  // has to come from the row.
  const storedHouse = platformSlot({
    owner: 'platform', slot_key: '*', headline: HOUSE_CREATIVE.headline,
    body: HOUSE_CREATIVE.body, is_house: true, active: true, rank: 100,
  });
  assert.equal(storedHouse.houseFallback, true,
    'the stored house row is our placeholder, not sold inventory');

  // And the renderer reads it: both kinds of placeholder come out compact (no
  // reserved height), the sold creative keeps its box.
  const tall = (html) => /min-height:\d+px/.test(html);
  const placeholderHtml = renderSlot({ ...fallback, isOwner: false });
  const storedHtml = renderSlot({ ...storedHouse, isOwner: false });
  const soldHtml = renderSlot({ ...sold, isOwner: false });
  assert.ok(!tall(storedHtml), 'the stored house row still reserves a billboard');
  assert.ok(!tall(placeholderHtml), 'the placeholder still reserves a billboard');
  assert.ok(tall(soldHtml), 'a sold creative lost its reserved height, which is what CLS-proofs it');
});
