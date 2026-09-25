/**
 * What draws in a slot.
 *
 * A slot that renders as an empty box labelled "Advertisement" charges rent for
 * nothing and makes a storefront look broken. This module decides what a slot
 * shows, and the decisions are all consequences of the revenue model:
 *
 *   RANK 1 BELONGS TO THE CREATOR. Not by policy statement but by allocation —
 *   `allocateSlots` never assigns the top position to the platform. So the first
 *   thing a visitor sees can always be the store's own message, and the rent
 *   slot is the last position on the page. This module renders that consequence:
 *   the top slot is labelled as the store's, and when the creator has not
 *   written anything it says so rather than showing our inventory.
 *
 *   THE PLATFORM SLOT IS OURS. If no network is connected to it (or the network
 *   sends us nothing, which is the normal state), it fills with a house
 *   creative: bytebikri's own ad, in the space the creator is renting to us.
 *   That is the consideration for the rent — the space is used, not held.
 *
 *   A NETWORK CREATIVE IS NEVER STORED. A third-party tag is script. Keeping it
 *   in our database and rendering it from our origin would make every storefront
 *   a place where a network we have not audited can run code under our name.
 *   The slot carries the seam (`data-adapter`) and the adapter serves the tag.
 *   Until an adapter exists, a connected slot with no creative of its own shows
 *   the honest placeholder rather than a fake ad.
 *
 *   WEBVIEW IS NOT THE AUCTION. Rewarded video does not run in a browser; a
 *   display network does. The same slot key earns differently by surface, so a
 *   slot says which surface it is on and does not promise the app's rate.
 *
 * Creative copy is the creator's, so it is sanitised here rather than trusted:
 * a `javascript:` or `data:` link in a column the tenant writes is a stored XSS
 * with our domain on it.
 */

/**
 * The house creative. What bytebikri runs in a rent slot when nothing else can.
 *
 * THE DIRECTION WAS WRITTEN BACKWARDS, and this is where it was corrected. The copy
 * said the space was "rented FROM the store" and that "the store rents it to
 * ByteBikri" — the store as landlord, being paid — while the ledger does the
 * opposite in three places at once: `billing.js` invoices the STORE rent for this
 * position, `MONEY_MAP.toPlatform` lists it under "What you pay bytebikri" with
 * `payer: 'You'`, and `rent_invoices`'s own comment says bytebikri receives it.
 * A shopper reading a footer is the last person who can check, which is why a
 * sentence nobody could falsify sat there wrong for this long.
 *
 * So the words now say whose space it is and who pays for it, in the order a
 * visitor meets them, and they leave out nothing a seller could be surprised by.
 */
export const HOUSE_CREATIVE = {
  headline: 'This space is ByteBikri\u2019s own',
  // "No cut of the store's sales — there are no sales" was true while nothing here
  // was sold. Members pay dues now, and a sentence printed in a footer on every
  // storefront is the worst place in the product to leave one that has stopped
  // being true — so it says what the arrangement actually is: whatever a store
  // earns, in whatever form, bytebikri takes no part of it.
  // THE CAP IS 220 (`normaliseCreative`), AND IT APPLIES TO US. The first draft of this
  // sentence ran 252 characters and was silently cut to "…No cut of what the" by this
  // module's own clamp — on every storefront in the product, in the one box the platform
  // writes itself. A house creative is not exempt from the rule a seller's creative is
  // held to; the sentence is written to fit instead, and `test/creatives.test.js` now
  // asserts that it survives the trip through the normaliser unchanged.
  body: 'One position on every page is ours — always the cheapest, never the first. The store pays rent for it, and we take no cut of what the store earns, dues included.',
  linkUrl: '/',
  linkLabel: 'What ByteBikri is',
};

/**
 * What each slot is for, in the terms of the person deciding whether to care.
 *
 * Positions are not interchangeable: an in-content native between two files is
 * worth more than a footer strip, and a creator choosing where to spend their
 * own inventory should be told which is which rather than picking a number.
 */
export const SLOT_PURPOSE = {
  top_leaderboard: 'The first thing a visitor sees. The best position on the page, and by allocation it is never the platform\'s.',
  in_content_1: 'The first position inside the page, right under the header — seen while somebody is deciding.',
  sidebar_sticky: 'Follows the reader down the page on a wide screen. Display only: native does not fit a rail.',
  in_content_2: 'A second position further down, for a visitor who is already reading.',
  footer_native: 'The last thing before the footer. The cheapest attention on the page, which is why the rent slot is this one.',
};

/**
 * The one thing a visitor must be able to tell at a glance: whose space is this?
 *
 * @param {'platform'|'channel'} owner
 * @returns {{label: string, purpose: string, byline: string}}
 */
export function slotFraming(owner, { channelName = 'this store' } = {}) {
  if (owner === 'platform') {
    return {
      label: 'Advertisement',
      purpose: SLOT_PURPOSE.footer_native,
      // Whose space, in one line — which is this function's whole job. The money
      // direction is NOT restated here: it was restated once and got reversed.
      byline: 'Platform space. Not the store\u2019s, and the store is not the advertiser.',
    };
  }
  // Short. The shopper needs to know whose voice this is; the paragraph about
  // what a slot is belongs on the page where the owner manages it.
  return { label: `From ${channelName}`, purpose: null, byline: 'The store\'s own space.' };
}

const SAFE_SCHEMES = ['https:', 'http:'];

/**
 * A URL the tenant can put on the page.
 *
 * Three things are refused outright, and all three are realistic attempts:
 * `javascript:` and `data:` URLs (stored XSS on our origin), and anything that
 * is not a string. Plain `http:` is upgraded to `https:` rather than refused —
 * a Nepali seller pasting a link to their own blog should not have to know why.
 * Protocol-relative `//evil.example` is refused because it silently inherits
 * whatever scheme the page is on, which is how a page served over http leaks
 * everything.
 *
 * @returns {string|null} the URL, or null if it may not be rendered
 */
export function sanitizeUrl(value) {
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if (!raw) return null;
  if (raw.startsWith('//')) return null;
  if (raw.startsWith('/')) {
    // Same-origin path. `/\` and `/\t` variants are read as protocol-relative
    // by some parsers, so a second slash after an optional control char is out.
    return /^\/[/\\\s]/.test(raw) ? null : raw;
  }
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;   // no scheme and not a path: not a link, just a string
  }
  if (!SAFE_SCHEMES.includes(url.protocol)) return null;
  return url.protocol === 'http:' ? url.href.replace(/^http:/, 'https:') : url.href;
}

/**
 * A stored row, as the render layer needs it.
 *
 * @returns {{headline, body, imageUrl, linkUrl, linkLabel, owner}|null}
 */
export function normaliseCreative(row) {
  if (!row || row.active === false) return null;
  const headline = typeof row.headline === 'string' ? row.headline.trim().slice(0, 90) : '';
  if (!headline) return null;
  const linkUrl = sanitizeUrl(row.link_url);
  return {
    owner: row.owner === 'platform' ? 'platform' : 'channel',
    headline,
    body: typeof row.body === 'string' && row.body.trim() ? row.body.trim().slice(0, 220) : null,
    imageUrl: sanitizeUrl(row.image_url),
    // A label without a link is a label that goes nowhere. Both or neither.
    linkUrl,
    linkLabel: linkUrl && typeof row.link_label === 'string' && row.link_label.trim()
      ? row.link_label.trim().slice(0, 40) : null,
    // Carried through, not decided here: whether a creative is bytebikri's own
    // placeholder is a fact about the row (see migration 0025), and the render
    // needs it to know whether to reserve the slot's height for a tag.
    isHouse: row.is_house === true,
  };
}

/**
 * The whole decision, in one place.
 *
 * @param {object} args
 * @param {object} args.slot          a slot from `allocateSlots`
 * @param {object} [args.creative]    the row that matches this slot, if any
 * @param {boolean} [args.isOwner]    is the viewer the store's owner
 * @param {string} [args.channelName]
 * @param {'storefront'|'asset'|'dashboard'} [args.surface]
 * @returns {object} everything `views.renderSlot` needs, and nothing it has to guess
 */
export function composeSlot({
  slot, creative = null, isOwner = false, channelName = 'this store',
  surface = 'storefront', editHref = null,
}) {
  const owner = slot.owner === 'platform' ? 'platform' : 'channel';
  const framing = slotFraming(owner, { channelName });
  const purpose = SLOT_PURPOSE[slot.slotKey] || null;

  const stored = normaliseCreative(creative);
  // Only our own inventory may fill a platform slot, and only the store's may
  // fill its own. A mismatch is a bug in the caller, and rendering it would put
  // the wrong party's message in someone else's space.
  const usable = stored && stored.owner === owner ? stored : null;

  const house = owner === 'platform'
    ? normaliseCreative({ ...HOUSE_CREATIVE, owner: 'platform', is_house: true })
    : null;
  const filled = usable || house;
  // Whether what is rendering is our own placeholder rather than a creative
  // somebody bought.
  //
  // It matters because a platform slot reserves its height for a tag that is on
  // its way — that reservation is what stops a real ad from shoving the page down
  // as it loads — and a placeholder is not a tag on its way. This module already
  // says so two lines below: "an empty box is a hole, not a commitment". Our own
  // house message was the one case that ignored it, and it rendered at the slot's
  // full reserved height on a storefront holding a single file: 280px of our copy,
  // which is both odd to show a visitor and what a broken banner looks like.
  //
  // Read from the row (`is_house`, migration 0025) rather than inferred from the
  // copy or from "was there a row at all". The first attempt inferred it from the
  // fallback alone and changed nothing on the live page, because the boot upsert
  // had already written the house message as a real row — a distinction the data
  // had to carry, not one a comparison of headlines should guess at.
  const houseFallback = filled !== null && (usable ? usable.isHouse === true : true);

  return {
    ...slot,
    owner,
    label: framing.label,
    purpose,
    byline: framing.byline,
    surface,
    creative: filled,
    // Whether this slot has anything to show. The reserved-height rule applies
    // to a slot that is rendering and waiting for a tag, not to a space nobody
    // has filled — an empty box is a hole, not a commitment.
    serves: filled !== null,
    houseFallback,
    from: usable ? (owner === 'platform' ? 'house' : 'store') : (filled ? 'house' : 'none'),
    // A creator looking at their own empty slot gets told what to do about it;
    // a visitor gets a sentence that does not address them.
    emptyNote: owner === 'channel'
      ? (isOwner
        ? 'Your space. Write a headline for it and it appears here — your announcement, your next file, your mailing list.'
        : `${channelName} has not put a message here yet.`)
      : null,
    // Where the owner can fix an empty space of their own, when they are the one
    // looking at it. A visitor never sees a link into somebody's dashboard.
    // Not on the page that manages slots: the form is right there, and a link to
    // where you already are is noise.
    editHref: owner === 'channel' && !usable && isOwner && surface !== 'dashboard' ? editHref : null,
    // Who is looking. The renderer needs it for one decision it cannot make from
    // `emptyNote`: whether to draw the empty space at all.
    isOwner,
    // The seam. A real network's tag mounts in this container; nothing about the
    // network is stored in our database. A slot the store filled itself is not a
    // network slot however many connections the channel has — the tag seam is
    // only there for a slot a network is actually meant to serve.
    adapter: usable ? (owner === 'platform' ? 'house' : 'store') : (slot.providerId || (owner === 'platform' ? 'house' : 'channel')),
    rtb: false,
    rtbNote: slot.surface === 'webview'
      ? 'Rewarded video does not run in a browser. Web views are display-class traffic: the same slot earns less per view here than in the app.'
      : null,
  };
}

/**
 * Attach creatives to an allocation.
 *
 * @param {object[]} slots                from `allocateSlots`
 * @param {object[]} rows                 `slot_creatives` rows for this channel
 * @param {object} [opts]
 */
export function composeSlots(slots, rows = [], opts = {}) {
  // Two lookups per owner: the creative written for this exact slot, then the
  // wildcard one. A creative written for the TOP slot must never turn up in the
  // footer — an earlier version registered every row under both keys and put the
  // store's announcement in all four of its slots at once.
  const byKey = new Map();
  for (const row of rows) {
    if (row.active === false) continue;
    const key = `${row.owner}:${row.slot_key || '*'}`;
    const held = byKey.get(key);
    // Lowest rank wins regardless of insert order, so an edit never silently
    // reorders the page.
    if (!held || (row.rank ?? 100) < (held.rank ?? 100)) byKey.set(key, row);
  }
  const pick = (owner, slotKey) => (
    byKey.get(`${owner}:${slotKey}`) || byKey.get(`${owner}:*`) || null
  );

  return slots.map((slot) => composeSlot({
    slot,
    creative: pick(slot.owner === 'platform' ? 'platform' : 'channel', slot.slotKey),
    ...opts,
  }));
}
