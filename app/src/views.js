/**
 * Server-rendered views.
 *
 * Plain template literals, no framework. The app is server-rendered by design:
 * an ad-gated page that needs a client bundle before it can show content is a
 * page that shows nothing when the bundle is slow, and component 6 (pageview
 * counting) is only honest if the HTML is the thing being counted.
 *
 * Rules this file follows:
 *   - Every interpolation goes through esc() or a number formatter. There is no
 *     raw `${userValue}` in a tag, ever.
 *   - The view layer never touches the store. Everything it renders is passed
 *     in, because the store is async and this file is not.
 *   - Lock state is precomputed by the caller. A view that could ask "is this
 *     unlocked?" would, and would block rendering to do it.
 */

import { REPORT_REASONS, REPORT_HONESTY, NOTE_LIMIT, reporterMessage, reportVerdict, AUTO_HIDE_AFTER } from './reports.js';
// The calibration judgement lives in the domain file next to gapVerdict, so the
// operator's page and the seller's page can never disagree about what a gap means.
import { calibrationRowState } from './earnings.js';

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const npr = (n) => `NPR ${Number(n).toLocaleString('en-IN')}`;

/**
 * A calendar date, as `2026-08-31`.
 *
 * `date` columns come back from Postgres as `Date` objects at UTC midnight, and
 * `String(date).slice(0, 10)` — which is what four pages were doing — gives
 * "Sat Aug 01". It looked like a formatting choice and was actually a bug that
 * appeared on the store detail page, the period table and the invoice line at
 * once. ISO is also the unambiguous form: `01/08` is two different days depending
 * on which side of the world you read it from, and this platform bills on dates.
 */
export const isoDay = (value) => {
  if (!value) return '';
  if (typeof value === 'string') return value.slice(0, 10);
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? String(value) : d.toISOString().slice(0, 10);
};

/**
 * `plural(1, 'view')` → "1 view"; `plural(3, 'view')` → "3 views".
 *
 * Trivial, and the reason it exists is that "1 views in 30 days" is the kind of
 * detail that makes a product read as unfinished regardless of how well
 * everything else works. Irregular nouns take an explicit plural.
 */
const plural = (n, singular, pluralForm = `${singular}s`) =>
  `${num(n)} ${Number(n) === 1 ? singular : pluralForm}`;
const num = (n) => Number(n).toLocaleString('en-IN');

const relTime = (d) => {
  if (!d) return '—';
  const s = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 2592000) return `${Math.floor(s / 86400)}d ago`;
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
};

const initials = (s) =>
  String(s || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

/**
 * A deterministic placeholder for content with no cover image.
 *
 * Two letters and a hue derived from the title. A grey box reads as a broken
 * image; a coloured monogram reads as a design choice, which is the difference
 * between "unfinished" and "minimal". Real covers replace it the moment a
 * seller uploads one.
 */
const glyph = (title) => {
  const t = String(title || '?');
  return t.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
};
const hue = (title) => {
  let h = 0;
  for (const c of String(title || '')) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
};

function thumb({ title, coverUrl, height = 160 }) {
  const inner = coverUrl
    ? `<img src="${esc(coverUrl)}" alt="" loading="lazy" decoding="async">`
    : `<span class="thumb-glyph" aria-hidden="true">${esc(glyph(title))}</span>`;
  const style = coverUrl ? '' : ` style="filter:hue-rotate(${hue(title)}deg)"`;
  return `<div class="thumb"${style}>${inner}</div>`;
}

function pill(text, kind = '') {
  return `<span class="pill${kind ? ` pill-${kind}` : ''}">${esc(text)}</span>`;
}

/**
 * A moderation notice, for the one person who can act on it.
 *
 * Three parts, in the order a seller needs them: what state the store is in,
 * what the rule says, and when it was decided. The rule's sentence comes from
 * `policy_rules` — written before the argument started — and the operator's own
 * line is the remedy, not the charge. Nothing here is free text standing alone,
 * and every field is escaped like any other input.
 *
 * It is rendered ONLY to the owner. A visitor to a suspended store gets a 404,
 * which is the point.
 */
function moderationNotice(m, { heading = null } = {}) {
  if (!m) return '';
  const kind = m.state === 'restricted' ? 'warning' : 'danger';
  return `<div class="note note-${kind} moderation-notice" role="status">
  <div class="row" style="align-items:baseline">
    <strong>${esc(heading || 'This store is not public right now')}</strong>
    <span class="spacer"></span>
    ${pill(m.state, kind)}
  </div>
  <p class="small" style="margin:var(--space-3) 0 0">${esc(m.note)}</p>
  ${m.ruleCode ? `<p class="fine" style="margin:var(--space-2) 0 0">
    Rule: <span class="mono">${esc(m.ruleCode)}</span>${m.decidedAt
      ? ` · decided ${esc(relTime(m.decidedAt))}`
      : ''}
  </p>` : ''}
  <p class="fine" style="margin:var(--space-3) 0 0">
    Nothing has been deleted, your files are untouched, and you can still read every page here.
    Reply to the message you were sent if this is wrong.
  </p>
</div>`;
}

function avatar(name) {
  return `<span class="avatar" aria-hidden="true">${esc(initials(name))}</span>`;
}

// ---------------------------------------------------------------------------
// Chrome
// ---------------------------------------------------------------------------

/**
 * The consent banner.
 *
 * Two real buttons of equal weight. No dimmed "manage" link as the only way to
 * say no, no pre-ticked boxes, no "by continuing you agree". A banner that is
 * hard to refuse is not consent, and the difference is the whole point of the
 * ePrivacy rules.
 *
 * It is a plain form POST, so it works with no JavaScript and cannot be
 * silently skipped by a script failure.
 */
function consentBanner(consent) {
  if (!consent || !consent.outstanding) return '';
  return `
<div class="consent" role="region" aria-label="Cookies">
  <div class="wrap consent-inner">
    <div>
      <strong>Ads pay for the free downloads here.</strong>
      <p class="small" style="margin:var(--space-2) 0 0">
        Personalised ads let the network use what you have already watched to pick the next one,
        which pays the creator more. Say no and you still watch an ad — an untargeted one. Nothing
        is shared until you choose. <a href="/legal/cookies">What this means</a>.
      </p>
    </div>
    <form method="post" action="/consent" class="consent-actions">
      <input type="hidden" name="next" value="${esc(consent.returnTo || '/')}">
      <button class="btn btn-primary" type="submit" name="choice" value="all">Accept all</button>
      <button class="btn" type="submit" name="choice" value="none">Reject all</button>
      <a class="btn btn-ghost" href="/legal/cookies">Choose individually</a>
    </form>
  </div>
</div>`;
}

/**
 * The entrance-reveal bootstrap, as ONE fixed piece of inline JavaScript.
 *
 * This is a landing-page device, so it is switched on by the page that wants it
 * and by nothing else. A dashboard is a tool: its cards, tables and panels are
 * the thing the person came for, and fading them in as they scroll reads as the
 * interface being slow rather than as movement. Storefronts and Explore get it;
 * every signed-in page does not.
 *
 * Two conditions, both necessary: the page carries `data-reveal`, and motion is
 * welcome. With no JavaScript at all nothing is ever hidden, because the class
 * that hides things is only ever added by this script.
 *
 * It is a CONSTANT — the same bytes on every page, with the decision moved into
 * an attribute on the html element — for one reason: script-src 'self' in the
 * CSP blocks inline scripts, and the way to allow one without opening the door
 * to every injected script is to name its hash. A hash only matches if the text
 * never varies. server.js computes the hash from this same constant at boot and
 * a test asserts the two agree; the earlier version, which interpolated
 * "true" or "false" into the script, was blocked in every browser — the reveal
 * never ran anywhere, and nothing looked broken because the content simply
 * appeared without moving.
 */
export const REVEAL_BOOTSTRAP =
  "if(!matchMedia('(prefers-reduced-motion: reduce)').matches&&document.documentElement.hasAttribute('data-reveal'))" +
  "document.documentElement.classList.add('reveal-ready');";

export function layout({
  title, user, body, activeChannel = null, wide = false, current = '', consent = null,
  reveal = false,
}) {
  const navLink = (href, label, key) =>
    `<a href="${esc(href)}"${current === key ? ' aria-current="page"' : ''}>${esc(label)}</a>`;

  const account = user
    ? `<span class="who">
         ${avatar(user.display_name || user.email)}
         <span class="muted" style="font-size:var(--text-xs)">${esc((user.display_name || user.email).split('@')[0])}</span>
       </span>
       <form method="post" action="/logout" style="display:contents">
         <button class="btn btn-sm btn-ghost" type="submit">Sign out</button>
       </form>`
    : `<a class="btn btn-sm" href="/login">Sign in</a>
       <a class="btn btn-sm btn-primary" href="/signup">Start a store</a>`;

  return `<!doctype html>
<html lang="en"${reveal ? ' data-reveal' : ''}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark light">
<title>${esc(title)} · ByteBikri</title>
<meta name="description" content="Watch an ad, unlock the file. Creators keep their own ad revenue.">
<link rel="stylesheet" href="/styles.css">
<script>${REVEAL_BOOTSTRAP}</script>
</head>
<body>
<a class="skip-link" href="#main">Skip to content</a>
<header class="header" id="site-header">
  <div class="wrap">
    <a class="brand" href="/"><span class="brand-mark">B</span> ByteBikri</a>
    <nav class="nav" aria-label="Main">
      ${navLink('/marketplace', 'Explore', 'marketplace')}
      ${activeChannel ? navLink(`/dashboard/${esc(activeChannel.slug)}`, 'Dashboard', 'dashboard') : ''}
      ${user?.role === 'admin' ? navLink('/admin', 'Console', 'admin') : ''}
    </nav>
    <span class="spacer"></span>
    ${account}
  </div>
  <span class="scroll-progress" aria-hidden="true"></span>
</header>
<main id="main"${wide ? '' : ''} class="wrap">${body}</main>
${consentBanner(consent)}
<footer class="footer">
  <div class="wrap">
    <div class="row">
      <span>ByteBikri — the shop belongs to the creator.</span>
      <span class="row-tight">
        <a href="/legal/privacy" style="color:inherit">Privacy</a>
        <a href="/legal/terms" style="color:inherit">Terms</a>
        <a href="/legal/cookies" style="color:inherit">Cookies</a>
      </span>
    </div>
  </div>
</footer>
<script src="/app.js" defer></script>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Landing
// ---------------------------------------------------------------------------

export function landing({ channels, user, stats, consent = null, moneyMap = null }) {
  const featured = channels.slice(0, 6).map(channelCard).join('');

  /**
   * The hero shows the product, not a description of it.
   *
   * Linear, Vercel and Stripe all open with real interface, and the research is
   * unambiguous that a screenshot removes doubt in a way copy cannot. So the
   * window below is not an illustration of the money map: it is the money map —
   * the same four facts the earnings page renders, from the same structure, so
   * the two pages cannot drift apart or disagree.
   *
   * One primary action, and it is the one a stranger can act on. Pages with a
   * single CTA convert at 13.5% against 10.5% for five or more, and the second
   * button here was competing with the first for the same click.
   */
  const legs = moneyMap ? [
    { dt: 'Who pays for the unlock', dd: 'The ad network', primary: false },
    { dt: 'Paid into', dd: moneyMap.toCreator.account, primary: true },
    { dt: 'Held by ByteBikri', dd: moneyMap.toCreator.held, primary: true },
    { dt: 'Our share of it', dd: moneyMap.toCreator.cut, primary: true },
  ] : [];

  const moneyLegs = legs.map((l) => `<div class="money-leg${l.primary ? ' money-leg-primary' : ''}" style="border:0;padding:0">
    <dt>${esc(l.dt)}</dt><dd>${esc(l.dd)}</dd>
  </div>`).join('');

  return layout({
    title: 'Content that unlocks with attention',
    user, current: 'home', consent,
    reveal: true,
    body: `
<section class="hero">
  <span class="pill pill-accent pill-lg">Ad-gated access</span>
  <h1 style="margin-top:var(--space-5)">Watch a short ad.<br>Unlock the file.</h1>
  <p class="lede">Creators publish templates, photos, guides and sample packs. One rewarded ad
  unlocks a download, and the network pays the creator's own account.</p>
  <div class="hero-actions">
    <a class="btn btn-lg btn-primary" href="/marketplace">Explore stores</a>
    <a class="link-quiet" href="/signup">or open a store of your own →</a>
  </div>

  ${legs.length ? `
  <div class="preview-window" aria-hidden="false">
    <div class="preview-bar" aria-hidden="true">
      <span class="preview-dots"><span></span><span></span><span></span></span>
      <span class="preview-url">bytebikri.com/dashboard/your-store/earnings</span>
    </div>
    <div class="preview-body">
      <dl class="money-map">${moneyLegs}</dl>
      <p class="fine" style="margin:0">${esc(moneyMap.toCreator.detail)}</p>
      <p class="fine" style="margin:0">${esc(moneyMap.toPlatform.detail)}</p>
    </div>
  </div>` : ''}

  <div class="proof-strip">
    ${proof(stats.channels, 'Stores')}
    ${proof(stats.assets, 'Unlockable files')}
    ${proof(stats.unlocks, 'Unlocks granted')}
    ${proof(null, 'Cut of ad revenue', '0%')}
  </div>
</section>

<section class="section">
  <div class="section-head">
    <h2>Stores on ByteBikri</h2>
    <span class="spacer"></span>
    <a href="/marketplace" class="small">See all →</a>
  </div>
  ${featured ? `<div class="grid-channels">${featured}</div>` : '<div class="empty">No stores yet.</div>'}
</section>

<!--
  The step that actually moves money is the one to design around, so it is
  numbered and the other two are not. The ordered list carries the sequence; the numerals
  are decoration and say so with aria-hidden, because announcing "one" twice is
  noise for a screen reader.
-->
<section class="section">
  <div class="section-head">
    <h2>How a file gets unlocked</h2>
    <p>Three steps, and the money moves in exactly one of them — from the network to you.</p>
  </div>
  <ol class="steps">
    <li class="step">
      <span class="step-num" aria-hidden="true">01</span>
      <h3>You publish a file</h3>
      <p class="small">Attach it, set it to <strong>one rewarded ad</strong>, done. No price to set,
      because nobody is buying it with money.</p>
    </li>
    <li class="step">
      <span class="step-num" aria-hidden="true">02</span>
      <h3>Someone watches the ad</h3>
      <p class="small">The network serves the ad inside your page. When it completes, the network
      calls our server with a signature — the browser's word counts for nothing here.</p>
    </li>
    <li class="step">
      <span class="step-num" aria-hidden="true">03</span>
      <h3>The network pays you</h3>
      <p class="small">Your own account at the network, on the network's own schedule. We are not a
      party to that payment and we cannot see the balance.</p>
    </li>
  </ol>
</section>

<section class="section">
  <div class="section-head">
    <h2>What this costs, and what it never costs</h2>
    <p>Two charges and no share of anything. If a number appears anywhere on this site, it is one of these.</p>
  </div>
  <div class="grid-channels">
    <div class="card card-pad-lg">
      <h3>No price on the file</h3>
      <p class="small" style="margin-top:var(--space-2)">Access is bought with attention, not money.
      That means no checkout, no card, and nothing for ByteBikri to hold.</p>
    </div>
    <div class="card card-pad-lg">
      <h3>Earnings go to the creator</h3>
      <p class="small" style="margin-top:var(--space-2)">The network pays the creator's account directly.
      We take 0% of it, and we cannot touch it.</p>
    </div>
    <div class="card card-pad-lg">
      <h3>Links that actually gate</h3>
      <p class="small" style="margin-top:var(--space-2)">Download URLs are minted per person and expire,
      so they cannot be forwarded and reused.</p>
    </div>
  </div>
</section>`,
  });
}

// ---------------------------------------------------------------------------
// Marketplace + storefront
// ---------------------------------------------------------------------------

function channelCard(c) {
  return `<a class="card card-interactive channel-card" href="/s/${esc(c.slug)}">
  ${c.banner_url
    ? `<img class="channel-banner channel-banner-img" src="${esc(c.banner_url)}" alt="" loading="lazy" decoding="async">`
    : '<div class="channel-banner"></div>'}
  <div class="row">
    <h3>${esc(c.name)}</h3>
    <span class="spacer"></span>
    ${c.listing_mode === 'marketplace' ? pill('Listed', 'accent') : ''}
  </div>
  <p class="small" style="margin:0">${esc(c.tagline || 'A store on ByteBikri.')}</p>
  <div class="row-tight" style="font-size:var(--text-xs);color:var(--text-faint)">
    <span>${plural(c.asset_count || 0, 'file')}</span>
    <span>·</span>
    <span>${esc(c.plan_code || 'free')} plan</span>
  </div>
</a>`;
}

/**
 * Explore — stores that chose to be listed.
 *
 * There used to be a second section here, "Own address only", fed by channels
 * the caller had already filtered to `listing_mode = 'marketplace'`. It was
 * therefore empty on every request: a whole column of the page that could never
 * have content, above a promise that these stores "exist at their link".
 *
 * It should not come back. A store that chose its own address is not published
 * in a directory — that is what the choice MEANS — and listing it here would
 * quietly overrule the seller's decision. The empty state now says what the
 * page is for instead of apologising for a section that should not exist.
 */
export function marketplace({ channels, user, consent = null, q = '', results = null, explore = null }) {
  const listed = channels.filter((c) => c.listing_mode === 'marketplace');
  const searching = String(q || '').trim().length >= 2;

  /**
   * A store in a rail, with the reason it is in that rail.
   *
   * The reason is not a caption. A visitor reading "Popular this week" has to be
   * able to see what earned it, and a visitor reading "Featured" has to be able
   * to see that the position was bought — anything else is a dark pattern with
   * better typography.
   */
  const railCard = (entry, paid) => `
    <a class="card card-interactive rail-card${paid ? ' rail-card-paid' : ''}"
       href="/s/${esc(entry.channel.slug)}">
      <div class="row" style="align-items:flex-start">
        <div style="min-width:0">
          <h3 style="font-size:var(--text-md)">${esc(entry.channel.name)}</h3>
          <p class="small" style="margin:var(--space-1) 0 0">${esc(entry.channel.tagline || 'A store on ByteBikri.')}</p>
        </div>
        ${!paid && entry.rank ? `<span class="spacer"></span><span class="rank-badge">${num(entry.rank)}</span>` : ''}
      </div>
      <div class="rail-why">
        ${paid ? pill('Paid placement', 'warning') : pill('Earned', 'success')}
        ${entry.alsoPlaced ? pill('Also featured (paid)', 'warning') : ''}
        <span class="fine">${esc(entry.why)}</span>
      </div>
    </a>`;

  const rail = (r) => `
  <section class="section">
    <div class="section-head">
      <h2>${esc(r.title)}</h2>
      <p>${esc(r.note)}</p>
    </div>
    <div class="grid-rails">${r.entries.map((e) => railCard(e, r.key === 'featured')).join('')}</div>
  </section>`;

  const resultBlock = searching ? `
    <section class="section">
      <div class="section-head">
        <h2>Results for “${esc(results.term)}”</h2>
        <p>${plural(results.stores.length + results.assets.length, 'match', 'matches')}</p>
      </div>
      ${results.stores.length
        ? `<div class="grid-channels">${results.stores.map(channelCard).join('')}</div>`
        : ''}
      ${results.assets.length
        ? `<div class="grid-assets" style="margin-top:var(--space-6)">${results.assets.map((a) => `
            <a class="asset" href="/s/${esc(a.channel_slug)}/a/${esc(a.slug)}">
              <div style="position:relative">${thumb({ title: a.title, coverUrl: a.cover_url })}</div>
              <div class="asset-body">
                <h3>${esc(a.title)}</h3>
                <p class="asset-desc">${esc(a.description || 'No description yet.')}</p>
                <div class="asset-foot">
                  <span>${esc(a.channel_name)}</span>
                  <span>${a.unlock_mode === 'open' ? 'Free' : 'One ad'}</span>
                </div>
              </div>
            </a>`).join('')}</div>`
        : ''}
      ${results.stores.length + results.assets.length
        ? ''
        : `<div class="empty">Nothing matches “${esc(results.term)}”. Search looks at the name,
             the one-line description and the file titles of stores that are listed here —
             it does not reach into anybody's private store.</div>`}
    </section>` : '';
  return layout({
    title: 'Explore', user, current: 'marketplace', consent,
    reveal: true,
    body: `
<div class="section" style="margin-bottom:0">
  <h1>Explore</h1>
  <p class="lede" style="margin-top:var(--space-3)">Stores that opted in to being listed here.
  Plenty of sellers keep to their own address and are found by link — those are not listed, on purpose.</p>
  <form class="search" method="get" action="/marketplace" role="search">
    <label class="sr-only" for="q">Search stores and files</label>
    <input class="input" id="q" name="q" type="search" value="${esc(q || '')}"
           placeholder="Search stores, files, descriptions…" autocomplete="off">
    <button class="btn btn-primary" type="submit">Search</button>
  </form>
</div>
${resultBlock}
${searching ? '' : `
${explore && explore.rails.length ? explore.rails.map(rail).join('') : ''}

<section class="section">
  <div class="section-head">
    <h2>${explore && explore.rails.length ? 'All listed stores' : 'Listed stores'}</h2>
    <p>${plural(listed.length, 'store')}. Listing here is a choice a creator makes — plenty keep to
      their own address and are found by link.</p>
  </div>
  ${listed.length
    ? `<div class="grid-channels">${listed.map(channelCard).join('')}</div>`
    : `<div class="empty">No store has listed itself yet. Every store still works at its own address —
        asking the creator you follow for theirs is the way in.</div>`}
</section>`}
`,
  });
}

export function storefront({ channel, assets, slots, user, estimate, pageviews, unlockedIds = new Set(), consent = null, moderation = null }) {
  const cards = assets.map((a) => {
    const open = a.unlock_mode === 'open';
    const unlocked = open || (user && unlockedIds.has(a.id));
    const badge = open
      ? pill('Free', 'success')
      : unlocked ? pill('Unlocked', 'success') : pill('Ad-gated', 'locked');
    return `<a class="asset" href="/s/${esc(channel.slug)}/a/${esc(a.slug)}">
  <div style="position:relative">
    ${thumb({ title: a.title, coverUrl: a.cover_url })}
    <span class="thumb-badge">${badge}</span>
  </div>
  <div class="asset-body">
    <h3>${esc(a.title)}</h3>
    <p class="asset-desc">${esc(a.description || 'No description yet.')}</p>
    <div class="asset-foot">
      <span>${plural((a.files || []).length, 'file')}</span>
      <span>${open ? 'No ad needed' : `${a.ads_required} ad${a.ads_required === 1 ? '' : 's'} to unlock`}</span>
    </div>
  </div>
</a>`;
  }).join('');

  const placed = placeSlots(slots);

  return layout({
    title: channel.name, user, activeChannel: channel, consent,
    reveal: true,
    body: `
${channel.banner_url
    ? `<div class="store-hero">
  <img class="store-banner" src="${esc(channel.banner_url)}" alt="" decoding="async">
</div>`
    : ''}
${moderation ? `<div class="section" style="margin-bottom:0">${moderationNotice(moderation, { heading: 'Only you can see this page right now' })}</div>` : ''}

<div class="section" style="margin-bottom:0">
  <div class="row">
    <h1>${esc(channel.name)}</h1>
    ${channel.listing_mode === 'marketplace'
      ? pill('In Explore', 'accent')
      : pill('Shared by link')}
  </div>
  <p class="lede" style="margin-top:var(--space-3)">${esc(channel.tagline || 'A store on ByteBikri.')}</p>
  <div class="store-meta">
    <span>${plural(assets.length, 'item')} published</span>
    <span class="dot" aria-hidden="true">·</span>
    <span>${plural(pageviews, 'view')} in the last 30 days</span>
  </div>
</div>

${placed.head}

<section class="section">
  <div class="section-head">
    <h2>Content</h2>
    <p>One ad each. The network pays the creator directly.</p>
  </div>
  ${assets.length ? `<div class="grid-assets">${cards}</div>`
    : '<div class="empty">This store has not published anything yet.</div>'}
</section>

${placed.mid}
${placed.foot}`,
  });
}

// ---------------------------------------------------------------------------
// Asset page
// ---------------------------------------------------------------------------

/**
 * The player, and the honest note that goes under it.
 *
 * A video that is offered as a download link is a video that will be on a file
 * host by the evening. A player is not a protection either — a screen recorder
 * records a browser as easily as anything else — but it changes what the page
 * IS: content you watch, not a file you take. What the mark underneath does is
 * make a copy traceable, and the note says exactly that, because a product that
 * claims to be un-copyable and is not is worse than one that never claimed it.
 */
function mediaStage({ previewFile, markUri, coverUrl, title, unlocked, needsAd, slug, assetSlug }) {
  const frame = (inner, kind) => `
    <figure class="stage stage-${kind}"${kind === 'image' ? '' : ' data-protect'}>
      ${inner}
      ${kind === 'image' ? '' : `<div class="stage-mark" style="background-image:url('${esc(markUri)}')" aria-hidden="true"></div>`}
    </figure>`;

  if (!unlocked) {
    const cover = coverUrl
      ? `<img src="${esc(coverUrl)}" alt="" decoding="async">`
      : `<span class="thumb-glyph" aria-hidden="true">${esc(glyph(title))}</span>`;
    return `
    <div class="stage stage-locked">
      ${cover}
      <div class="stage-veil">
        <span class="locked-glyph" aria-hidden="true">🔒</span>
        <p class="small">${needsAd ? 'Unlocks after the ad' : 'Not unlocked yet'}</p>
      </div>
    </div>`;
  }

  if (previewFile?.playable && previewFile.streamUrl) {
    const poster = coverUrl ? ` poster="${esc(coverUrl)}"` : '';
    const src = esc(previewFile.streamUrl);
    return previewFile.kind === 'audio'
      ? frame(`
        <div class="audio-shell">
          <span class="audio-glyph" aria-hidden="true">♪</span>
          <div class="audio-body">
            <p class="audio-name">${esc(previewFile.filename)}</p>
            <audio controls preload="metadata" controlslist="nodownload noplaybackrate" src="${src}"></audio>
          </div>
        </div>`, 'audio')
      : frame(`
        <video controls playsinline preload="metadata"${poster}
               controlslist="nodownload noplaybackrate noremoteplayback"
               disablepictureinpicture disableremoteplayback
               src="${src}"></video>`, 'video');
  }

  if (previewFile?.marked && previewFile.streamUrl) {
    return frame(`<img src="${esc(previewFile.streamUrl)}" alt="" decoding="async">`, 'image');
  }

  const cover = coverUrl
    ? `<img src="${esc(coverUrl)}" alt="" decoding="async">`
    : `<span class="thumb-glyph" aria-hidden="true">${esc(glyph(title))}</span>`;
  return `<div class="stage">${cover}</div>`;
}

/** One line per file, saying what actually happens to it — no blanket promise. */
function fileTreatment(f) {
  if (f.playable) return { action: 'Plays here', note: 'no download offered' };
  if (f.kind === 'image') return { action: 'Download', note: 'your reference burned in' };
  return { action: 'Download', note: 'shown as a download' };
}

/**
 * Reviews, under the file.
 *
 * Only somebody who holds an unlock can write one, and the form is only
 * rendered for them — the server checks the same thing again, because a hidden
 * form is not a permission. The average is shown with its count, always: "4.8"
 * from two reviews and "4.8" from two hundred are different facts and the page
 * says which one it is.
 */
function reviewSection({ channel, asset, reviews = [], reviewStats = {}, canReview, myReview, reviewError }) {
  const count = Number(reviewStats.count) || 0;
  const average = count ? Number(reviewStats.average).toFixed(1) : null;

  const list = reviews.length
    ? `<ul class="review-list">${reviews.map((r) => `
        <li class="review">
          <div class="review-head">
            <span class="stars" aria-label="${r.rating} out of 5">${'★'.repeat(r.rating)}${'☆'.repeat(5 - r.rating)}</span>
            <span class="review-who">${esc(r.buyer_name || 'A buyer')}</span>
            <span class="spacer"></span>
            <span class="fine">${relTime(r.created_at)}</span>
          </div>
          ${r.body ? `<p class="review-body">${esc(r.body)}</p>` : ''}
          ${r.seller_response ? `<div class="review-reply">
              <span class="fine">${esc(channel.name)} replied</span>
              <p>${esc(r.seller_response)}</p>
            </div>` : ''}
        </li>`).join('')}</ul>`
    : '<p class="fine">No reviews yet. They can only be written by somebody who unlocked the file.</p>';

  const form = myReview
    ? `<div class="note note-success">
         <strong>Your review is on the page.</strong>
         ${'★'.repeat(myReview.rating)}${'☆'.repeat(5 - myReview.rating)}
         <form method="post" action="/s/${esc(channel.slug)}/a/${esc(asset.slug)}/review"
               style="margin-top:var(--space-4)">
           <div class="field">
             <label for="rv-body">Change what you wrote</label>
             <textarea class="textarea" id="rv-body" name="body" rows="3" maxlength="2000">${esc(myReview.body || '')}</textarea>
           </div>
           <div class="rating-picker">
             ${[1, 2, 3, 4, 5].map((v) => `
               <label><input type="radio" name="rating" value="${v}" ${myReview.rating === v ? 'checked' : ''} required><span>${v}</span></label>`).join('')}
           </div>
           <button class="btn btn-sm" type="submit">Update review</button>
         </form>
       </div>`
    : canReview
      ? `<form class="review-write" method="post"
             action="/s/${esc(channel.slug)}/a/${esc(asset.slug)}/review">
           <h3>You unlocked this — what did you think?</h3>
           <div class="rating-picker">
             ${[1, 2, 3, 4, 5].map((v) => `
               <label><input type="radio" name="rating" value="${v}" required><span>${v}</span></label>`).join('')}
             <span class="fine" style="margin-left:var(--space-3)">1 is poor, 5 is what you hoped for.</span>
           </div>
           <textarea class="textarea" name="body" rows="3" maxlength="2000"
                     placeholder="Specific is useful: did the file match the description, was it what you needed?"></textarea>
           <button class="btn btn-primary btn-sm" type="submit">Post review</button>
         </form>`
      : '';

  return `<section class="section" style="margin-top:0">
    <div class="section-head">
      <h2>Reviews</h2>
      ${average
        ? `<p><strong>${average}</strong> from ${plural(count, 'review')}</p>`
        : '<p>Nobody has reviewed this yet</p>'}
    </div>
    ${reviewError ? `<div class="note note-danger">${esc(reviewError)}</div>` : ''}
    ${form}
    ${list}
  </section>`;
}

/**
 * "Something is wrong with this file."
 *
 * One link, not a form: the form appears when it is asked for, because a report
 * box sitting open under every download invites the casual click that the
 * threshold rule then has to absorb. `details`/`summary` does that with no
 * JavaScript at all — it works in the Android WebView, in a text browser, and
 * when the client script has not loaded.
 *
 * The reasons are a `<select>` of the codes in `src/reports.js`, and the copy
 * says out loud that one report does not remove anything. A report button that
 * implies instant action is a button that gets used to threaten people.
 *
 * Hidden from the owner (this is their file) and from signed-out visitors (the
 * route requires an account, so offering the form would be a lie).
 */
function reportBlock({ channel, asset, user, alreadyReported = false, reported = null }) {
  if (!user || user.id === channel.owner_id) return '';
  const option = (r, selected = false) =>
    `<option value="${esc(r.code)}"${selected ? ' selected' : ''}>${esc(r.label)}</option>`;

  if (reported) {
    return `<section class="section">
  <div class="note ${reported.hidden ? 'note-warning' : 'note-info'}" role="status">
    ${esc(reporterMessage({ reporters: reported.reporters, already: !reported.filed }))}
  </div>
</section>`;
  }

  return `<section class="section">
  <details class="report-block">
    <summary class="report-summary">
      Something wrong with this file?
      ${alreadyReported ? '<span class="pill">You reported it</span>' : ''}
    </summary>
    <form method="post" action="/s/${esc(channel.slug)}/a/${esc(asset.slug)}/report" class="report-form">
      <div class="field">
        <label for="report-reason">What is wrong</label>
        <select class="input" id="report-reason" name="reason">
          ${REPORT_REASONS.map((r) => option(r)).join('')}
        </select>
      </div>
      <div class="field">
        <label for="report-note">Anything that would help <span class="fine">(optional)</span></label>
        <textarea class="input textarea" id="report-note" name="note" maxlength="${NOTE_LIMIT}"
                  placeholder="A link, a page number, a line — whatever made you stop and write this."></textarea>
      </div>
      <button class="btn" type="submit">Send the report</button>
      <p class="fine" style="margin-top:var(--space-3)">${esc(REPORT_HONESTY.long)}</p>
    </form>
  </details>
</section>`;
}

export function assetPage({
  channel, asset, files, unlocked, user, policy, slots, previewFile = null,
  markUri = '', markLabel = '', accessUntil = null, consent = null,
  reviews = [], reviewStats = {}, canReview = false, myReview = null, reviewError = null,
  reported = null, alreadyReported = false, reportError = null,
}) {
  const open = asset.unlock_mode === 'open';
  const needsAd = !open && !unlocked;
  const media = Boolean(previewFile?.playable);

  const rows = files.map((f) => {
    const t = fileTreatment(f);
    return `
        <li class="dl-item">
          <span class="file-badge" aria-hidden="true">${esc((f.kind || 'file').slice(0, 4).toUpperCase())}</span>
          <span class="dl-body">
            <span class="dl-name">${esc(f.filename)}</span>
            <span class="dl-meta">${(f.size_bytes / 1024).toFixed(1)} KB · ${esc(f.mime_type || 'file')} · ${esc(t.note)}</span>
          </span>
          <span class="spacer"></span>
          ${f.playable
            // No download link for something that plays. This is the one line
            // that decides whether "it plays here" is true or a sentence with a
            // download button next to it.
            ? `<span class="pill pill-success">Plays above</span>`
            : f.downloadUrl
              ? `<a class="btn btn-sm btn-primary" href="${esc(f.downloadUrl)}" download>${esc(t.action)}</a>`
              : `<span class="pill pill-locked">${esc(t.action)}</span>`}
        </li>`;
  }).join('');

  const filesPanel = unlocked
    ? `<ul class="dl-list">${rows}</ul>
       <p class="fine" style="margin-top:var(--space-4)">
         Links are minted for your account, carry your reference, and expire.
         ${media ? 'Playback links stay valid for four hours so seeking works; a download link expires in ten minutes.' : ''}
         The file itself is re-checked against your unlock on every request, so a forwarded link is useless to anyone else.
       </p>`
    : `<div class="locked-panel">
         <div class="locked-glyph" aria-hidden="true">🔒</div>
         <p class="small" style="margin:var(--space-3) 0 0">
           ${media ? 'The player starts here once you unlock.' : 'The download appears here once you unlock.'}
         </p>
       </div>`;

  const markNote = !unlocked ? '' : media
    ? `<p class="fine mark-note">
         <strong>Watermark: on.</strong> Frames carry
         <span class="mono">${esc(markLabel || 'your account reference')}</span> overlaid while it plays,
         so a recording can be traced back to the account that watched it.
         No website can stop a screen recording, and this one does not pretend to:
         the app is where the operating system blocks it.
       </p>`
    : previewFile?.marked
      ? `<p class="fine mark-note">
           <strong>Watermark: burned in.</strong> The image is re-encoded with your account reference
           before it is sent, so a copy that turns up elsewhere still points back here.
         </p>`
      : '';

  const actionBlock = open
    ? `<div class="note note-success">Free — no ad needed.</div>${filesPanel}`
    : unlocked
      ? `<div class="note note-success"><strong>Unlocked.</strong>
           ${accessExpiry(open ? null : accessUntil)}</div>${filesPanel}`
      : `<button class="btn btn-primary btn-lg btn-block" id="unlock-btn"
                 data-asset="${esc(asset.id)}">
           Watch ${plural(policy?.ads_required || 1, 'ad')} to unlock
         </button>
         <p class="fine" style="margin-top:var(--space-3);text-align:center">
           About ${plural(policy?.ad_min_seconds || 15, 'second')}. The unlock is granted only when the ad network
           confirms server-to-server that the view completed.
         </p>
         <div id="unlock-status" class="fine" role="status" aria-live="polite"
              style="margin-top:var(--space-3);text-align:center"></div>`;

  const kindLabel = { video: 'Video', audio: 'Audio', image: 'Image', file: 'File' }[previewFile?.kind] || null;
  const placed = placeSlots(slots);

  return layout({
    title: asset.title, user, activeChannel: channel, consent,
    body: `
<a class="back-link" href="/s/${esc(channel.slug)}">← ${esc(channel.name)}</a>

<div class="asset-layout">
  <div class="stack stack-8">
    ${mediaStage({
      previewFile, markUri, coverUrl: asset.cover_url, title: asset.title, unlocked, needsAd,
      slug: channel.slug, assetSlug: asset.slug,
    })}

    <div class="asset-head">
      <h1>${esc(asset.title)}</h1>
      ${open ? pill('Free', 'success') : unlocked ? pill('Unlocked', 'success') : pill('Ad-gated', 'locked')}
      ${user && user.id === channel.owner_id
    ? `<a class="btn btn-sm" href="/dashboard/${esc(channel.slug)}/assets/${esc(asset.id)}">Edit this file</a>` : ''}
    </div>
    <p class="lede">${esc(asset.description || 'No description yet.')}</p>
    ${markNote}

    ${placed.head}

    <div class="panel">
      <div class="panel-head"><h2>What you get</h2></div>
      <div class="panel-body">
        <dl class="kv">
          <dt>Files</dt><dd>${plural(files.length, 'file')}</dd>
          ${kindLabel ? `<dt>Format</dt><dd>${esc(kindLabel)}${media ? ' — plays in the page' : ''}</dd>` : ''}
          <dt>Access</dt><dd>${open ? 'Free' : unlocked ? 'Unlocked' : `${plural(policy?.ads_required || 1, 'rewarded ad')}`}</dd>
          <dt>Unlock lasts</dt><dd>${plural(policy?.unlock_hours || 24, 'hour')}</dd>
          <dt>Store</dt><dd><a href="/s/${esc(channel.slug)}">${esc(channel.name)}</a></dd>
        </dl>
      </div>
    </div>

    ${reviewSection({ channel, asset, reviews, reviewStats, canReview, myReview, reviewError })}

    ${placed.mid}
    ${placed.foot}
  </div>

  <aside class="unlock-card">
    <div class="panel">
      <div class="panel-head"><h2 style="font-size:var(--text-md)">${unlocked ? 'Your access' : 'Unlock this file'}</h2></div>
      <div class="panel-body">${actionBlock}</div>
    </div>
    <p class="fine" style="margin-top:var(--space-4)">
      ${user ? '' : `<a href="/login?next=${encodeURIComponent(`/s/${channel.slug}/a/${asset.slug}`)}">Sign in</a> first — unlocks are tied to your account.`}
    </p>
  </aside>
</div>

${reportError ? `<section class="section"><div class="note note-danger" role="alert">${esc(reportError)}</div></section>` : ''}
${reportBlock({ channel, asset, user, alreadyReported, reported })}

<div class="modal" id="ad-modal" hidden role="dialog" aria-modal="true" aria-labelledby="ad-title">
  <div class="modal-card">
    <div class="row">
      <span class="pill pill-locked">Rewarded ad</span>
      <span class="spacer"></span>
      <button class="btn btn-sm btn-ghost" id="ad-close" type="button" aria-label="Close">✕</button>
    </div>
    <h2 id="ad-title" style="margin-top:var(--space-4);font-size:var(--text-lg)">Your ad is playing</h2>
    <p class="fine" id="ad-provider" style="margin-top:var(--space-1)"></p>
    <div class="ad-frame" style="margin-top:var(--space-5)">
      <div style="text-align:center">
        <div class="ad-count" id="ad-count">15</div>
        <div class="fine" style="margin-top:var(--space-2)">seconds remaining</div>
      </div>
      <div class="ad-progress" id="ad-progress"></div>
    </div>
    <p class="fine" style="margin-top:var(--space-4)" id="ad-note">
      The unlock is not granted by this screen. It arrives from the provider's server,
      signed, and is verified on our side before your access appears.
    </p>
  </div>
</div>`,
  });
}

/**
 * How long this viewer's access lasts.
 *
 * A sentence about the entitlement, not about the asset: a free file has no
 * expiry at all, and an ad-unlocked one expires in the number of hours the
 * seller set. The old version read a column off the asset, which is a different
 * thing, and announced "permanent access" on 24-hour unlocks.
 */
function accessExpiry(until) {
  if (!until) return ' No expiry — this one is free.';
  return ` Access until ${new Date(until).toLocaleString('en-GB', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  })}.`;
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

/**
 * The page for an address that does not exist.
 *
 * Express's default is a bare `<pre>Cannot GET /x</pre>` with no header, no
 * footer, no way back and no idea what this site is — which is what a person sees
 * when they mistype a store, follow a dead link, or open a file that was paused.
 * It is the one page that appears when something has already gone wrong, so it is
 * the wrong place to make somebody feel lost.
 *
 * It does two useful things beyond saying sorry: it offers the search that
 * actually exists, and it points at the marketplace. It deliberately does NOT
 * echo the requested path back into the page — a 404 that reflects the URL is a
 * reflected-XSS with extra steps, and the browser already shows the address.
 */
/**
 * The page a rate limit shows a person.
 *
 * Modelled on what the limit actually is: a wait, a reason, and no accusation. A
 * shared office address, a phone on a train, a person who mistyped their password
 * twice — all of those are ordinary, and none of them deserve a page that reads
 * like an incident. It also names the wait in minutes rather than seconds, because
 * "try again in 900s" is a puzzle and "about 15 minutes" is an instruction.
 */
export function tooMany({ user = null, consent = null, retryAfter = 60, what = 'requests', max = 0, windowMs = 60_000 }) {
  const minutes = Math.ceil(retryAfter / 60);
  const wait = minutes <= 1 ? 'about a minute' : `about ${minutes} minutes`;
  const windowMinutes = Math.round(windowMs / 60_000);
  const per = windowMinutes >= 60
    ? `${Math.round(windowMinutes / 60)} hour${windowMinutes >= 120 ? 's' : ''}`
    : `${windowMinutes} minute${windowMinutes === 1 ? '' : 's'}`;
  return layout({
    title: 'Slow down', user, consent, current: null,
    // A panel, not `.empty`: this is not an empty state, it is an answer, and three
    // paragraphs of prose centred on a wide screen read ragged from both edges.
    body: `
<section class="section">
  <div class="panel" style="max-width:64ch">
    <div class="panel-body">
      <h1 style="font-size:var(--text-2xl)">Too many ${esc(what)}</h1>
      <p style="margin-top:var(--space-4)">
        This address has made more than ${num(max)} ${esc(what)} in the last ${esc(per)}, so the next one
        is being refused. Try again in ${esc(wait)}.
      </p>
      <p class="fine" style="margin-top:var(--space-4)">
        Nothing is broken and nothing has been lost. If you are signing in and this followed a few
        mistyped passwords, your password is unchanged — waiting is the whole fix. If several people
        share this connection, someone else may have used the allowance.
      </p>
      <p class="fine" style="margin-top:var(--space-4)">
        The limit exists because a password is guessable and a script can guess quickly. It is per
        address, it counts successes as well as failures, and it lifts on its own.
      </p>
      <p style="margin-top:var(--space-5)">
        <a class="btn" href="/">Back to ByteBikri</a>
      </p>
    </div>
  </div>
</section>`,
  });
}

export function notFound({ user = null, consent = null, requestedKind = null }) {
  const kind = requestedKind === 'store'
    ? 'That store is not here'
    : requestedKind === 'file' ? 'That file is not here' : 'That page is not here';

  return layout({
    title: 'Not found', user, consent, current: null,
    body: `
<div class="section" style="margin-bottom:0">
  <p class="pill pill-warning" style="display:inline-flex">Error 404</p>
  <h1 style="margin-top:var(--space-4)">${esc(kind)}</h1>
  <p class="lede" style="margin-top:var(--space-3)">
    Nothing is stored at this address. A store that was removed returns this page on purpose —
    byte for byte the same as a store that never existed, so the address itself cannot be used to
    find out whether something used to be there.
  </p>
  <div class="row" style="margin-top:var(--space-6);gap:var(--space-3);flex-wrap:wrap">
    <a class="btn btn-primary" href="/marketplace">Browse stores</a>
    <a class="btn" href="/">Home</a>
  </div>
</div>

<section class="section">
  <div class="section-head">
    <h2>If you were looking for a file</h2>
    <p>A file link expires and is minted per person, so a link from somebody else will not work for you — and a link you were given a while ago may simply have run out. Open the store and unlock it again.</p>
  </div>
  <form class="search" method="get" action="/marketplace" role="search">
    <label class="sr-only" for="nf-q">Search stores</label>
    <input class="input" id="nf-q" name="q" type="search" placeholder="Search stores — name, tagline or file">
    <button class="btn" type="submit">Search</button>
  </form>
</section>`,
  });
}

/**
 * The page for a failure we did not anticipate.
 *
 * The error handler used to answer a browser with JSON — `{"ok":false,"error":
 * "internal error"}` rendered as text in a tab — because the only clients it was
 * written for were API callers. A person who hits a bug should get a page that
 * says a page failed, not a serialised object. API clients still get JSON, by
 * content negotiation, and in production the message never carries the stack.
 */
export function serverError({ user = null, consent = null, requestId = null }) {
  return layout({
    title: 'Something broke', user, consent, current: null,
    body: `
<div class="section" style="margin-bottom:0">
  <p class="pill pill-danger" style="display:inline-flex">Error 500</p>
  <h1 style="margin-top:var(--space-4)">Something broke on our side</h1>
  <p class="lede" style="margin-top:var(--space-3)">
    The request failed while we were handling it. Nothing you did caused it, and nothing was
    charged: there is no charge to make. Money that moves here moves by a bank or wallet transfer
    that a person matches by hand, so a failed page cannot take any.
  </p>
  ${requestId ? `<p class="fine" style="margin-top:var(--space-4)">
    If you report this, quote <span class="mono">${esc(requestId)}</span> — it is the only thing that
    lets us find the failure in the log.</p>` : ''}
  <div class="row" style="margin-top:var(--space-6);gap:var(--space-3);flex-wrap:wrap">
    <a class="btn btn-primary" href="/">Home</a>
    <a class="btn" href="javascript:history.back()">Go back</a>
  </div>
</div>`,
  });
}

export function login({ user, error, next = '', email = '', mode = 'login', consent = null }) {
  const isSignup = mode === 'signup';
  const action = isSignup ? '/signup' : '/login';
  return layout({
    title: isSignup ? 'Open a store' : 'Sign in', user, consent,
    body: `
<div class="section auth-card" style="margin-top:var(--space-12)">
  <h1 style="font-size:var(--text-2xl)">${isSignup ? 'Open your store' : 'Sign in'}</h1>
  <p class="small" style="margin-top:var(--space-3)">
    ${isSignup
      ? 'You keep your own ad accounts and your own earnings. ByteBikri takes no cut of them.'
      : 'Welcome back.'}
  </p>

  ${error ? `<div class="note note-danger" style="margin-top:var(--space-5)" role="alert">${esc(error)}</div>` : ''}

  <form method="post" action="${action}" class="card card-pad-lg" style="margin-top:var(--space-5)">
    <input type="hidden" name="next" value="${esc(next)}">
    <div class="field">
      <label for="email">Email</label>
      <input class="input" id="email" name="email" type="email" required
             autocomplete="email" value="${esc(email)}" placeholder="you@example.com">
    </div>
    <div class="field">
      <label for="password">Password</label>
      <input class="input" id="password" name="password" type="password" required
             autocomplete="${isSignup ? 'new-password' : 'current-password'}"
             minlength="${isSignup ? 8 : 1}"
             placeholder="${isSignup ? 'At least 8 characters' : ''}">
      ${isSignup ? '<span class="hint">Eight characters minimum. Length matters more than symbols.</span>' : ''}
    </div>
    ${isSignup ? '' : `
    <label class="check">
      <input type="checkbox" name="remember" value="on" checked>
      <span>Keep me signed in on this device</span>
    </label>`}
    ${isSignup ? `
    <div class="field">
      <label for="display_name">Display name</label>
      <input class="input" id="display_name" name="display_name" autocomplete="nickname" placeholder="Your name or studio">
    </div>
    <div class="field">
      <label for="channel_name">Store name <span class="muted">(optional)</span></label>
      <input class="input" id="channel_name" name="channel" placeholder="e.g. Himalayan Type">
      <span class="hint">You can add more stores later. Names do not have to be unique.</span>
    </div>` : ''}
    <button class="btn btn-primary btn-lg" style="width:100%;margin-top:var(--space-2)" type="submit">
      ${isSignup ? 'Create account' : 'Sign in'}
    </button>
  </form>

  <p class="auth-switch">
    ${isSignup
      ? 'Already have an account? <a href="/login">Sign in</a>'
      : 'No account yet? <a href="/signup">Open a store</a>'}
  </p>
</div>`,
  });
}

/**
 * The operator's moderation queue.
 *
 * Deliberately plain, and deliberately not a report queue: nothing here tells an
 * operator WHICH store to look at, because a seller-report button is a separate
 * feature with its own design. What this page does is make the mechanism
 * reachable, so `moderation_state` stops being a column nobody sets.
 *
 * The form is a real form — no JavaScript, and the reason is a `<select>` of the
 * rule codes the database actually has, so a typo cannot become a rule that does
 * not exist.
 */
export function adminModeration({ user, rows, rules, actions = [], labels = {}, flash = null, consent = null }) {
  const rulesByCode = new Map(rules.map((r) => [r.code, r]));
  const options = (selected = null) => rules
    .map((r) => `<option value="${esc(r.code)}"${r.code === selected ? ' selected' : ''}>${esc(r.title)} (${esc(r.code)})</option>`)
    .join('');

  const row = (c) => `
  <div class="panel moderation-row" style="margin-top:var(--space-5)">
    <div class="panel-head">
      <a href="/s/${esc(c.slug)}"><strong>${esc(c.name)}</strong></a>
      <span class="fine">/s/${esc(c.slug)}</span>
      <span class="spacer"></span>
      ${pill(c.moderation_state, c.moderation_state === 'restricted' ? 'warning' : 'danger')}
    </div>
    <div class="panel-body">
      <p class="small" style="margin:0">
        ${c.owner_name ? `${esc(c.owner_name)} · ` : ''}${esc(c.owner_email || 'no email on file')}
        · opened ${esc(relTime(c.created_at))}
      </p>
      ${c.moderation_reason ? `<p class="fine" style="margin:var(--space-2) 0 0">
        Last cited rule: <span class="mono">${esc(c.moderation_reason)}</span>
        ${rulesByCode.get(c.moderation_reason) ? ` — ${esc(rulesByCode.get(c.moderation_reason).title)}` : ' (not a rule this platform has)'}
      </p>` : ''}

      <form method="post" action="/admin/moderation/${esc(c.slug)}" style="margin-top:var(--space-4)">
        <div class="row" style="align-items:flex-end;gap:var(--space-4);flex-wrap:wrap">
          <div class="field" style="flex:1 1 180px">
            <label for="a-${esc(c.slug)}">Action</label>
            <select class="input" id="a-${esc(c.slug)}" name="action">
              ${actions.map((a) => `<option value="${esc(a)}">${esc(labels[a] || a)}</option>`).join('')}
            </select>
          </div>
          <div class="field" style="flex:2 1 260px">
            <label for="r-${esc(c.slug)}">Reason</label>
            <select class="input" id="r-${esc(c.slug)}" name="ruleCode">
              <option value="">— none cited —</option>
              ${options(c.moderation_reason)}
            </select>
          </div>
        </div>
        <div class="field" style="margin-top:var(--space-4)">
          <label for="m-${esc(c.slug)}">What should the seller do?</label>
          <input class="input" id="m-${esc(c.slug)}" name="remedy" maxlength="280"
                 placeholder="One line, in your own words. They read this and nothing else.">
          <span class="hint">Up to 280 characters. It is shown to the owner with the rule's own wording.</span>
        </div>
        <button class="btn btn-primary" type="submit" style="margin-top:var(--space-4)">Record decision</button>
      </form>
    </div>
  </div>`;

  return layout({
    title: 'Moderation', user, current: 'admin', consent,
    body: `
<div class="section" style="margin-bottom:0">
  <h1>Moderation</h1>
  <p class="lede" style="margin-top:var(--space-3)">Stores that are not in the default state, and the one
  form that changes it. Every decision records who made it, when, and which rule it cites.</p>
</div>

${flash ? `<div class="note note-${flash.kind}" style="margin-top:var(--space-6)" role="status">${esc(flash.message)}</div>` : ''}

<section class="section">
  <div class="panel"><div class="panel-body">
    <h2 style="font-size:var(--text-md)">What the states do</h2>
    <dl class="kv" style="margin-top:var(--space-4)">
      <dt>approved</dt><dd>Public. The default.</dd>
      <dt>restricted</dt><dd>Public and writable, with a note to the owner. For presentation problems, not files.</dd>
      <dt>suspended</dt><dd>Hidden from every visitor and every listing. The owner still sees the whole dashboard, and every page tells them nothing was deleted. Writes stop.</dd>
      <dt>removed</dt><dd>The address returns 404, byte for byte the same as a store that never existed. The record stays.</dd>
    </dl>
    <p class="fine" style="margin-top:var(--space-4)">
      A reason is a rule code, never a sentence. The seller reads the rule's own wording plus your
      remedy line, so the charge and the explanation cannot drift apart.
    </p>
  </div></div>
</section>

<section class="section">
  <div class="section-head">
    <h2>Needs a decision</h2>
    <p>${rows.length ? `${rows.length} store${rows.length === 1 ? '' : 's'} not in the default state` : 'Nothing is waiting'}</p>
  </div>
  ${rows.length ? rows.map(row).join('') : '<div class="empty">No store is restricted, suspended or removed.</div>'}
</section>`,
  });
}

/**
 * The operator's People page.
 *
 * The Android app's admin screen had a red "Ban User" button next to every
 * flagged file, and this is that, done where the server can enforce it: search
 * by email, one form per account, and the history of every decision already made
 * about it. A ban is not a deletion, and the page says so above the button
 * rather than after it.
 */
/**
 * Segments are decisions, not fields.
 *
 * Each one exists because it is a different next action, and the note under the
 * tabs says which. "Signed up, no store" and "store, no files" are both stalls,
 * but they stall in different places and are fixed by different things — which is
 * exactly why a single "unactivated" bucket would be useless.
 */
export const PERSON_SEGMENTS = [
  { key: 'all', label: 'Everyone', note: 'Every account, in the order you choose. The baseline to filter down from.' },
  { key: 'no_store', label: 'Signed up, no store', note: 'They made an account and never opened a store. Nothing is broken — this is where a first step goes missing.' },
  { key: 'store_no_files', label: 'Store, no files', note: 'A store exists and is empty. The seller got as far as the shopfront and stopped before publishing anything.' },
  { key: 'files_no_unlocks', label: 'Files, no unlocks', note: 'Something is published and nobody has unlocked it. That is a distribution problem, not a product one.' },
  { key: 'working', label: 'Has unlocks', note: 'The loop closed at least once: published, unlocked, and whatever follows from that.' },
  { key: 'suspended', label: 'Suspended', note: 'Accounts that are switched off. Everything they had is still here; reinstating gives all of it back.' },
  { key: 'operator', label: 'Operators', note: 'Accounts with power over other people\'s. Worth reading as its own list rather than trusting that it is short.' },
];

export function adminUsers({
  user, consent = null, flash = null, data = null, filters = {}, rules = [],
  personActions = [], labels = {}, canExport = true,
}) {
  const rows = data?.rows || [];
  const total = data?.total || 0;
  const page = data?.page || 1;
  const pages = data?.pages || 1;
  const counts = data?.counts || {};
  const { q = '', segment = 'all', sort = 'recent' } = filters;
  const shown = PERSON_SEGMENTS.find((x) => x.key === segment) || PERSON_SEGMENTS[0];
  const segmentCount = (key) => (key === 'all'
    ? Object.values(counts).reduce((sum, c) => sum + c.n, 0)
    : (counts[key]?.n || 0));

  const link = (next) => {
    const params = new URLSearchParams();
    const merged = { q, segment, sort, ...next };
    for (const [k, v] of Object.entries(merged)) {
      if (!v || v === 'all' || (k === 'sort' && v === 'recent')) continue;
      params.set(k, v);
    }
    const qs = params.toString();
    return `/admin/users${qs ? `?${qs}` : ''}`;
  };

  const sortHead = (key, label) => `
    <th class="num"${sort === key ? ' aria-sort="descending"' : ''}>
      <a href="${esc(link({ sort: key, page: undefined }))}"${sort === key ? ' class="sorted"' : ''}>${esc(label)}${
    sort === key ? ' <span aria-hidden="true">↓</span>' : ''}</a>
    </th>`;

  const stateOf = (r) => {
    if (r.banned) return pill('suspended', 'danger');
    if (r.role !== 'user') return `${pill(r.role, 'accent')}<div class="fine">can act on others</div>`;
    return pill('active', 'success');
  };

  return adminShell({
    user, consent, current: 'people', title: 'People',
    lede: 'Accounts, not stores. Suspending one signs it out everywhere and takes its stores off the public '
      + 'site — and deletes nothing.',
    actions: canExport
      ? `<a class="btn btn-sm" href="${esc(link({ format: 'csv', page: undefined }))}">Download CSV</a>`
      : '',
    body: `
${flash ? `<div class="note note-${flash.kind}" style="margin-top:var(--space-6)" role="status">${esc(flash.message)}</div>` : ''}

<section class="section">
  <div class="kpi-row">
    <div class="kpi kpi-hero">
      <div class="kpi-value">${num(segmentCount('all'))}</div>
      <div class="kpi-label">Accounts</div>
      <div class="kpi-note">${num(Object.values(counts).reduce((sum, c) => sum + c.live, 0))} signed in during the last 30 days.</div>
    </div>
    <div class="kpi">
      <div class="kpi-value">${num(segmentCount('no_store') + segmentCount('store_no_files'))}</div>
      <div class="kpi-label">Stalled before publishing</div>
      <div class="kpi-note">An account with no store, or a store with no files.</div>
    </div>
    <div class="kpi">
      <div class="kpi-value">${num(segmentCount('files_no_unlocks'))}</div>
      <div class="kpi-label">Published, never unlocked</div>
      <div class="kpi-note">Live files, zero unlocks — reach, not product.</div>
    </div>
    <div class="kpi${segmentCount('suspended') ? ' kpi-bad' : ''}">
      <div class="kpi-value">${num(segmentCount('suspended'))}</div>
      <div class="kpi-label">Suspended</div>
      <div class="kpi-note">Nothing deleted. Reinstating restores everything.</div>
    </div>
  </div>
</section>

<section class="section">
  <nav class="segments" aria-label="Segments">
    ${PERSON_SEGMENTS.map((seg) => `<a href="${esc(link({ segment: seg.key, page: undefined }))}"
      ${seg.key === segment ? 'aria-current="page"' : ''}>${esc(seg.label)}<span class="seg-count">${num(segmentCount(seg.key))}</span></a>`).join('')}
  </nav>
  <p class="fine" style="margin-top:var(--space-3)">${esc(shown.note)}</p>

  <form class="filters" method="get" action="/admin/users" role="search" style="margin-top:var(--space-5)">
    <input type="hidden" name="segment" value="${esc(segment)}">
    <div class="field" style="flex:2 1 260px">
      <label for="q">Search</label>
      <input class="input" id="q" name="q" type="search" value="${esc(q)}" placeholder="Email or display name">
    </div>
    <div class="field">
      <label for="sort">Order</label>
      <select class="input" id="sort" name="sort">
        ${[['recent', 'Newest accounts'], ['active', 'Seen most recently'], ['views', 'Most views · 30d'],
    ['unlocks', 'Most unlocks'], ['name', 'Name A→Z']]
    .map(([v, l]) => `<option value="${v}"${sort === v ? ' selected' : ''}>${l}</option>`).join('')}
      </select>
    </div>
    <div class="filters-foot">
      <button class="btn btn-primary" type="submit">Apply</button>
      ${(q || segment !== 'all' || sort !== 'recent') ? `<a class="btn btn-sm" href="/admin/users">Clear</a>` : ''}
    </div>
  </form>

  <div class="section-head" style="margin-top:var(--space-6)">
    <h2>${total ? `${num(total)} account${total === 1 ? '' : 's'}` : 'Nothing here'}</h2>
    <p>${total
    ? `Page ${num(page)} of ${num(pages)}${q ? ` · matching “${esc(q)}”` : ''}`
    : q || segment !== 'all'
      ? 'Nobody matches that. The search looks at email addresses and display names, and the segment tabs count every account.'
      : 'No account exists yet. The first sign-up will appear here.'}</p>
  </div>

  ${rows.length ? `
  <div class="panel"><div class="panel-body panel-body-flush">
    <table class="table table-directory">
      <thead>
        <tr>
          <th>Person</th>
          <th>State</th>
          <th class="num">Stores</th>
          <th class="num">Files</th>
          ${sortHead('views', 'Views · 30d')}
          ${sortHead('unlocks', 'Unlocks')}
          <th>Joined</th>
          <th>Last seen</th>
          <th class="num">Failed sign-ins</th>
        </tr>
      </thead>
      <tbody>${rows.map((r) => `
        <tr>
          <td>
            <a href="/admin/users/${esc(r.id)}"><strong>${esc(r.display_name || r.email)}</strong></a>
            <div class="fine">${esc(r.email)}${r.sold_by_on_file ? ' · sold-by details on file' : ''}</div>
          </td>
          <td>${stateOf(r)}</td>
          <td class="num">${num(r.stores)}${r.stores ? '' : '<div class="fine">none</div>'}</td>
          <td class="num">${num(r.files)}${r.files ? '' : '<div class="fine">none</div>'}</td>
          <td class="num">${num(r.views_30d)}</td>
          <td class="num">${num(r.unlocks)}</td>
          <td class="fine">${esc(isoDay(r.created_at))}</td>
          <td class="fine">${r.last_seen_at ? esc(relTime(r.last_seen_at)) : 'never'}</td>
          <td class="num">${r.failed_7d
    ? `${num(r.failed_7d)}<div class="fine">in 7 days</div>`
    : '<span class="fine">—</span>'}</td>
        </tr>`).join('')}
      </tbody>
    </table>
  </div></div>
  ${pages > 1 ? `<nav class="pager" aria-label="Pages">
    ${page > 1 ? `<a class="btn btn-sm" href="${esc(link({ page: page - 1 }))}">← Back</a>` : ''}
    <span class="fine">Page ${num(page)} of ${num(pages)}</span>
    ${page < pages ? `<a class="btn btn-sm" href="${esc(link({ page: page + 1 }))}">Next →</a>` : ''}
  </nav>` : ''}
  ` : `<div class="empty">
    ${q || segment !== 'all' ? `Nobody is in this segment${q ? ` and matching “${esc(q)}”` : ''}.`
    : 'No account exists yet.'}
  </div>`}

  <div class="cols-2" style="margin-top:var(--space-6)">
    <div class="panel"><div class="panel-body">
      <h2 style="font-size:var(--text-md)">What a suspension does</h2>
      <dl class="kv" style="margin-top:var(--space-4)">
        <dt>Sign-in</dt><dd>Refused, with the reason and where to reply. Checked after the password, so it is not a way to discover which addresses exist.</dd>
        <dt>Sessions</dt><dd>Every live session is revoked in the same transaction. A suspended account's token is refused even if one survived.</dd>
        <dt>Their stores</dt><dd>Hidden from Explore, from search, and from their own addresses — 404 to everyone but the seller and an operator.</dd>
        <dt>Their files</dt><dd>Untouched. Nothing is deleted, and reinstating restores everything exactly as it was.</dd>
      </dl>
    </div></div>

    <div class="panel"><div class="panel-body">
      <h2 style="font-size:var(--text-md)">What this page counts, and what it will not</h2>
      <p class="small" style="margin-top:var(--space-3)">
        Unlocks here are what a person's files earned them as a seller. What somebody unlocks as a
        <em>reader</em> is counted on their own record and never listed — not here, not anywhere an
        operator can browse. A count answers every question moderation asks; a list would turn a
        support tool into a log of what people read, and the platform would then have to defend having it.
      </p>
      <p class="small">
        There is no money column, and that is not an omission: nothing of a creator's ever passes through
        bytebikri, so an account has no balance to show. There is also no “verified” chip yet — this
        platform has no KYC step, and inventing a badge for one that does not exist would be worse than
        the empty column.
      </p>
    </div></div>
  </div>
</section>`,
  });
}

/**
 * One account, in full — the half the directory leaves out on purpose.
 *
 * A directory that showed all of this inline would be a spreadsheet nobody reads,
 * so the table carries the columns you scan and this page carries the ones you
 * read one at a time. It is also where the decision gets made, which is why the
 * suspension form lives here rather than on the row.
 */
export function adminUser({
  user, consent = null, flash = null, detail = null, rules = [],
  personActions = [], labels = {},
}) {
  if (!detail) {
    return adminShell({
      user, consent, title: 'No such account', current: 'overview',
      body: `<section class="section"><div class="empty">That account does not exist. It may have been
        typed into the address bar rather than reached from the list.
        <div style="margin-top:var(--space-4)"><a class="btn btn-sm" href="/admin/users">← All accounts</a></div>
      </div></section>`,
    });
  }
  const p = detail.person;
  const options = (selected = null) => rules
    .map((r) => `<option value="${esc(r.code)}"${r.code === selected ? ' selected' : ''}>${esc(r.title)} (${esc(r.code)})</option>`)
    .join('');
  const id8 = esc(p.id.slice(0, 8));

  return adminShell({
    user, consent, flash, title: p.display_name || p.email,
    lede: p.email,
    body: `
<section class="section">
  <div class="row" style="align-items:center;gap:var(--space-3);flex-wrap:wrap">
    <a class="btn btn-sm" href="/admin/users">← All accounts</a>
    ${p.banned ? pill('suspended', 'danger') : pill('active', 'success')}
    ${p.role !== 'user' ? pill(p.role, 'accent') : ''}
    ${p.banned && p.ban_reason ? `<span class="fine">${esc(p.ban_reason)}</span>` : ''}
    <span class="spacer"></span>
    <a class="btn btn-sm" href="/admin/users?q=${encodeURIComponent(p.email)}">Find their rows in the list</a>
  </div>

  <div class="kpi-row" style="margin-top:var(--space-6)">
    <div class="kpi">
      <div class="kpi-value">${num(detail.stores.length)}</div>
      <div class="kpi-label">Stores</div>
      <div class="kpi-note">${detail.stores.length ? 'Listed below, with their traffic.' : 'They have not opened one.'}</div>
    </div>
    <div class="kpi">
      <div class="kpi-value">${num(detail.unlocksHeld)}</div>
      <div class="kpi-label">Unlocks they hold</div>
      <div class="kpi-note">As a reader. Counted, never listed — see the note on the list page.</div>
    </div>
    <div class="kpi">
      <div class="kpi-value">${num(detail.sessions.live)}</div>
      <div class="kpi-label">Live sessions</div>
      <div class="kpi-note">${detail.sessions.total
    ? `${num(detail.sessions.total)} ever, last seen ${esc(relTime(detail.sessions.last_seen))}.`
    : 'This account has never signed in.'}</div>
    </div>
    <div class="kpi${detail.attempts.failed_7d >= 10 ? ' kpi-bad' : ''}">
      <div class="kpi-value">${num(detail.attempts.failed_7d)}</div>
      <div class="kpi-label">Failed sign-ins · 7d</div>
      <div class="kpi-note">${detail.attempts.failed_7d >= 10
    ? 'High enough to be worth reading as an attack on this address rather than a forgotten password.'
    : `${num(detail.attempts.ok_30d)} succeeded in the last 30 days.`}</div>
    </div>
  </div>
</section>

${detail.stores.length ? `<section class="section">
  <div class="section-head"><h2>Their stores</h2><p>A person can own more than one; each is judged on its own.</p></div>
  <div class="panel"><div class="panel-body panel-body-flush">
    <table class="table">
      <thead><tr><th>Store</th><th>State</th><th class="num">Files</th><th class="num">Views · 30d</th><th>Opened</th></tr></thead>
      <tbody>${detail.stores.map((c) => `<tr>
        <td>
          <a href="/admin/stores/${esc(c.slug)}"><strong>${esc(c.name)}</strong></a>
          <div class="fine">/s/${esc(c.slug)}${c.listing_mode === 'marketplace' ? ' · listed' : ''}</div>
        </td>
        <td>${pill(c.moderation_state, c.moderation_state === 'approved' ? 'success' : c.moderation_state === 'pending' ? '' : 'warning')}</td>
        <td class="num">${num(c.files)}</td>
        <td class="num">${num(c.views_30d)}</td>
        <td class="fine">${esc(isoDay(c.created_at))}</td>
      </tr>`).join('')}
      </tbody>
    </table>
  </div></div>
</section>` : ''}

<section class="section">
  <div class="cols-2">
    <div class="panel"><div class="panel-body">
      <h2 style="font-size:var(--text-md)">On file</h2>
      <dl class="kv" style="margin-top:var(--space-4)">
        <dt>Joined</dt><dd>${esc(isoDay(p.created_at))} <span class="fine">· ${esc(relTime(p.created_at))}</span></dd>
        <dt>Signs in with</dt><dd>${p.has_password ? 'an email and a password' : '<span class="fine">no password set — this account cannot sign in yet</span>'}</dd>
        <dt>First session</dt><dd>${detail.sessions.first_seen ? esc(isoDay(detail.sessions.first_seen)) : '<span class="fine">never</span>'}</dd>
        <dt>Sold-by details</dt><dd>${p.sold_by_on_file
    ? 'A legal name is on file, which an annual rent invoice needs.'
    : '<span class="fine">Not given yet. This is the field an invoice uses, and it stays private from buyers and sellers.</span>'}</dd>
        <dt>Phone</dt><dd>${p.phone_on_file ? 'On file, private' : '<span class="fine">not given</span>'}</dd>
        <dt>Locale</dt><dd>${esc(p.locale || 'ne')}</dd>
      </dl>
      <p class="fine" style="margin-top:var(--space-4)">
        Their legal name and phone are stored, and are not rendered here even for an operator: this page
        is about what to do, and the fields that identify a person to the tax office live on the invoice
        that needs them.
      </p>
    </div></div>

    <div class="panel"><div class="panel-body">
      <h2 style="font-size:var(--text-md)">${p.banned ? 'Reinstate or record a decision' : 'Suspend or record a decision'}</h2>
      <form method="post" action="/admin/users/${esc(p.id)}">
        <div class="row" style="align-items:flex-end;gap:var(--space-4);flex-wrap:wrap;margin-top:var(--space-4)">
          <div class="field" style="flex:1 1 160px;margin:0">
            <label for="a-${id8}">Action</label>
            <select class="input" id="a-${id8}" name="action">
              ${personActions.map((a) => `<option value="${esc(a)}">${esc(labels[a] || a)}</option>`).join('')}
            </select>
          </div>
          <div class="field" style="flex:2 1 220px;margin:0">
            <label for="r-${id8}">Reason</label>
            <select class="input" id="r-${id8}" name="ruleCode">
              <option value="">— none cited —</option>
              ${options(null)}
            </select>
          </div>
          <button class="btn ${p.banned ? '' : 'btn-danger'}" type="submit">${p.banned ? 'Record decision' : 'Suspend this account'}</button>
        </div>
        <div class="field" style="margin-top:var(--space-3)">
          <input class="input" name="remedy" maxlength="280" placeholder="One line to the person. They read this and nothing else.">
        </div>
      </form>
      <p class="fine" style="margin-top:var(--space-4)">
        A suspension is a state, not a deletion. It is also reversible without a support request, which is
        why the record is a history rather than a flag on a row.
      </p>
    </div>
  </div>
</section>

<section class="section">
  <div class="section-head">
    <h2>Decisions about this account</h2>
    <p>${detail.decisions.length ? 'Newest first, with the rule each one cited.' : 'Nothing has been decided about this account.'}</p>
  </div>
  ${detail.decisions.length
    ? `<div class="panel"><div class="panel-body decisions">${detail.decisions.map((h) => `
        <div class="decision">
          <div class="row" style="align-items:baseline;gap:var(--space-3);flex-wrap:wrap">
            <span class="mono small">${esc(h.action)}</span>
            ${h.rule_title ? pill(h.rule_title, 'warning') : '<span class="fine">no rule cited</span>'}
            <span class="fine">${esc(relTime(h.created_at))}</span>
          </div>
          ${h.reason ? `<p class="small" style="margin-top:var(--space-2)">“${esc(h.reason)}”</p>` : ''}
        </div>`).join('')}</div></div>`
    : '<div class="empty">No suspension, reinstatement or note has been recorded for this account — which is the normal state of an account nobody has had to think about.</div>'}
</section>`,
  });
}

/** The decisions already made about an account, newest first. */
function historyOf(userId, history) {
  const rows = history?.[userId] || [];
  if (!rows.length) return '';
  return `<ul class="list-plain fine" style="margin-top:var(--space-4)">
    ${rows.map((h) => `<li>
      <span class="mono">${esc(h.action)}</span>
      ${h.rule_title ? `· ${esc(h.rule_title)}` : ''}
      · ${esc(relTime(h.created_at))}
      ${h.reason ? `<div style="margin-top:var(--space-1)">“${esc(h.reason)}”</div>` : ''}
    </li>`).join('')}
  </ul>`;
}

/**
 * One proof figure.
 *
 * `data-count` makes it animate from zero on first paint — the client reads the
 * attribute, counts up in 700ms, and writes the final value back as text. With
 * no JavaScript, or with reduced motion, the number is simply already there:
 * the markup is the truth and the animation is an enhancement, never the other
 * way round.
 */
function proof(value, label, literal = null) {
  const shown = literal ?? num(value);
  return `<div class="proof">
    <span class="proof-value"${literal === null ? ` data-count="${Number(value) || 0}"` : ''}>${shown}</span>
    <span class="proof-label">${esc(label)}</span>
  </div>`;
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Charts
//
// Two tiny charts, written by hand as SVG rather than pulled from a library,
// because the rules they have to obey are the whole design and a library would
// make them hard to see:
//
//   - ONE series per chart. A sparkline mixing two metrics communicates nothing.
//   - A PINNED scale where charts sit next to each other. If each file's chart
//     picked its own maximum, a 5% change and a 500% change would draw the same
//     shape — "the biggest risk with sparklines" — so the caller passes one max
//     for the whole table and every chart in it shares it.
//   - A MEASURED ZERO and a MISSING DAY are different facts and are drawn
//     differently. The daily table only holds days something happened; a chart
//     that fills the rest with zero is claiming traffic we never measured.
//   - The shape is the point, the exact number is elsewhere. So no axes, no
//     gridlines, no legend: the total is already in the KPI above, and the title
//     element carries the sentence for anyone using a screen reader.
//   - One highlight, never several. Marking the peak, the trough, the first and
//     the last at once defeats the purpose.
// ---------------------------------------------------------------------------

const SVG_NS = 'http://www.w3.org/2000/svg';

/** A short human sentence describing a series, for the accessible name. */
function describeSeries(points, { unit = 'views' } = {}) {
  const measured = points.filter((p) => p.measured !== false);
  if (!measured.length) return `No ${unit} have been measured yet.`;
  const total = measured.reduce((a, p) => a + (p.value || 0), 0);
  const peak = measured.reduce((a, p) => Math.max(a, p.value || 0), 0);
  const peakDay = measured.find((p) => (p.value || 0) === peak);
  const half = Math.floor(measured.length / 2);
  const firstHalf = measured.slice(0, half).reduce((a, p) => a + (p.value || 0), 0);
  const secondHalf = measured.slice(half).reduce((a, p) => a + (p.value || 0), 0);
  const gap = points.length - measured.length;

  let direction = 'flat';
  if (firstHalf > 0 || secondHalf > 0) {
    if (secondHalf > firstHalf * 1.15) direction = 'rising';
    else if (secondHalf < firstHalf * 0.85) direction = 'falling';
  }
  const parts = [
    `${total.toLocaleString('en-IN')} ${unit} across ${measured.length} measured ${measured.length === 1 ? 'day' : 'days'}`,
    peak ? `peak ${peak.toLocaleString('en-IN')} on ${peakDay.day}` : 'no activity yet',
    `${direction} across the window`,
  ];
  // Say the gaps out loud rather than letting the reader assume the line is solid.
  // Agreement matters in a sentence a screen reader will read aloud: "1 day was
  // not measured and are not drawn as zero" is the kind of thing that makes a
  // chart sound broken, and it shipped for one test run.
  if (gap > 0) {
    parts.push(gap === 1
      ? '1 day was not measured and is not drawn as zero'
      : `${gap} days were not measured and are not drawn as zero`);
  }
  return `${parts.join('; ')}.`;
}

/**
 * A 30-day column chart.
 *
 * Columns rather than a line: traffic arrives in whole visits on whole days, and
 * a line implies continuity between today and the day before that nobody
 * measured. Missing days are drawn as a faint band so they cannot be mistaken for
 * quiet ones, and the peak column is the only thing highlighted.
 */
export function trafficChart({ points = [], height = 132, label = 'Views' } = {}) {
  const n = points.length;
  if (!n) return '<div class="empty">Nothing to draw yet.</div>';

  const max = points.reduce((a, p) => Math.max(a, p.value || 0), 0);
  const scale = max > 0 ? max : 1;
  const plot = height - 22;               // room for the date labels under the plot
  const colW = 100 / n;                   // viewBox units, percentages of width

  // Contiguous runs of unmeasured days become one band each.
  const bands = [];
  for (let i = 0; i < n; i += 1) {
    if (points[i].measured === false) {
      const start = i;
      while (i < n && points[i].measured === false) i += 1;
      bands.push([start, i]);
    }
  }

  const peakIndex = points.reduce((best, p, i) => ((p.value || 0) > (points[best]?.value || 0) ? i : best), 0);

  const bars = points.map((p, i) => {
    const value = p.value || 0;
    if (p.measured === false) return '';
    // A measured zero still gets a stub, so "we looked and saw nothing" is on the
    // chart instead of being an absence that reads like a missing day.
    const h = value > 0 ? Math.max((value / scale) * plot, 3) : 2;
    const y = plot - h + 10;
    const cls = value > 0 ? (i === peakIndex ? 'chart-bar chart-bar-peak' : 'chart-bar') : 'chart-bar chart-bar-zero';
    return `<rect class="${cls}" x="${(i * colW + colW * 0.18).toFixed(2)}%" y="${y.toFixed(1)}" `
      + `width="${(colW * 0.64).toFixed(2)}%" height="${h.toFixed(1)}" `
      + `rx="${Math.min(colW * 0.18, 1.2).toFixed(2)}"><title>${esc(p.day)}: ${value.toLocaleString('en-IN')} ${esc(label.toLowerCase())}${value === 0 ? ' (measured, none)' : ''}</title></rect>`;
  }).join('');

  const bandShapes = bands.map(([from, to]) => `<rect class="chart-gap" x="${(from * colW).toFixed(2)}%" y="10" `
    + `width="${((to - from) * colW).toFixed(2)}%" height="${plot}" rx="2"><title>No daily row for these days</title></rect>`).join('');

  const first = points[0].day.slice(5);
  const last = points[n - 1].day.slice(5);

  return `<figure class="chart" data-chart>
  <div class="chart-plot" style="height:${height}px">
    <svg class="chart-svg" viewBox="0 0 100 ${height}" preserveAspectRatio="none" role="img"
         aria-label="${esc(describeSeries(points, { unit: label.toLowerCase() }))}">
      ${bandShapes}${bars}
      <line class="chart-axis" x1="0" y1="${plot + 10}" x2="100" y2="${plot + 10}" vector-effect="non-scaling-stroke"></line>
    </svg>
    ${max > 0 ? `<span class="chart-max" aria-hidden="true">${max.toLocaleString('en-IN')}</span>` : ''}
  </div>
  <figcaption class="chart-foot">
    <span>${esc(first)}</span>
    <span class="spacer"></span>
    <span>${esc(last)}</span>
  </figcaption>
</figure>`;
}

/**
 * A word-sized chart for one row of a table.
 *
 * Columns again, and the scale is PASSED IN rather than computed, so every chart
 * in the table shares one. A subtlety worth stating: `max` of zero would draw
 * every row flat and identical, which is correct — a store with no ad views at
 * all has no shape to show.
 */
export function sparkline({ points = [], max = 0, height = 26, label = 'ad views' } = {}) {
  const n = points.length;
  if (!n) return '';
  const scale = Math.max(max, 1);
  const colW = 100 / n;
  const bars = points.map((p, i) => {
    const value = p.value || 0;
    if (!value) return '';
    const h = Math.max((value / scale) * (height - 2), 2);
    return `<rect class="chart-bar" x="${(i * colW + colW * 0.2).toFixed(2)}%" y="${(height - h).toFixed(1)}" `
      + `width="${(colW * 0.6).toFixed(2)}%" height="${h.toFixed(1)}" rx="0.6"><title>${esc(p.day)}: ${value.toLocaleString('en-IN')} ${esc(label)}</title></rect>`;
  }).join('');
  return `<svg class="spark" viewBox="0 0 100 ${height}" preserveAspectRatio="none" role="img"
      aria-label="${esc(describeSeries(points, { unit: label }))}">${bars}</svg>`;
}

export function dashboard({
  channel, slots, connections, providers, plan, estimate, pageviews, adViews,
  upgrade, user, pendingPayments = [], flash = null, consent = null,
  assets = [], assetStats = [], moderation = null,
  // The day-by-day series behind the totals. Optional so every existing caller
  // and test keeps working, and so a page that has no series simply draws no
  // chart instead of drawing an empty one.
  traffic = [], adViewSeries = null,
}) {
  const conn = connections[0] || null;
  const provider = conn ? providers.find((p) => p.id === conn.provider_id) : null;

  const slotRows = slots.map((s) => `
    <tr>
      <td><strong>${esc(s.label)}</strong><div class="fine">rank ${s.rank} of ${slots.length}</div></td>
      <td>${s.owner === 'platform' ? pill('Platform · rent', 'warning') : pill("Channel's own", 'info')}</td>
      <td>${s.serves
    ? (s.from === 'house' ? pill('Ours — house ad', 'info') : pill('Filled by you', 'success'))
    : (s.owner === 'platform' ? pill('Empty', '') : pill('Yours — empty', ''))}</td>
    </tr>`).join('');

  const earnings = adViews.filter((v) => v.completed).reduce((a, v) => a + (Number(v.revenue_usd) || 0), 0);

  return layout({
    title: channel.name, user, activeChannel: channel, consent, current: 'dashboard',
    body: `
<div class="section" style="margin-bottom:0">
  <div class="row">
    <h1>${esc(channel.name)}</h1>
    ${pill(`${plan.name} plan`, plan.code === 'free' ? '' : 'accent')}
    <span class="spacer"></span>
    <a class="btn btn-sm" href="/s/${esc(channel.slug)}" target="_blank" rel="noopener">View store ↗</a>
  </div>
  <p class="lede" style="margin-top:var(--space-3)">${esc(channel.tagline || '')}</p>
</div>

${storeSectionNav(channel, 'overview')}

${moderation ? `<div style="margin-top:var(--space-6)">${moderationNotice(moderation)}</div>` : ''}

${flash ? `<div class="note note-${flash.kind}" style="margin-top:var(--space-6)" role="status">${esc(flash.message)}</div>` : ''}

<!--
  Four equal numbers answered no question. A seller opens this page to find out
  whether what they published is being used, so that is the hero — at the largest
  size, spanning two columns — and the three figures that explain it are sized
  down from it. Nothing here is a number we profit from, and the estimate says so
  in its own note rather than in a paragraph underneath.
-->
<div class="kpi-row" style="margin-top:var(--space-8)">
  <div class="kpi kpi-hero">
    <div class="kpi-value">${num(estimate.unlocks || 0)}</div>
    <div class="kpi-label">Files unlocked · last 30 days</div>
    <div class="kpi-note">${estimate.unlocks
    ? 'Each one is a person who watched a rewarded ad for something you published.'
    : 'Nobody has unlocked a file yet. It starts the moment your first visitor watches an ad.'}</div>
  </div>
  <div class="kpi">
    <div class="kpi-value">${num(pageviews)}</div>
    <div class="kpi-label">Views · 30d</div>
    <div class="kpi-note">What rent is priced from.</div>
  </div>
  <div class="kpi">
    <div class="kpi-value">${num(adViews.length)}</div>
    <div class="kpi-label">Ad views served</div>
    <div class="kpi-note">Across every network.</div>
  </div>
  <div class="kpi">
    <div class="kpi-value">$${earnings.toFixed(3)}</div>
    <div class="kpi-label">Est. earned</div>
    <div class="kpi-note">Our estimate, not the network's statement.</div>
  </div>
</div>
<p class="fine" style="margin-top:var(--space-3)">
  Estimated earned is <strong>our</strong> figure from provider-reported revenue, not your statement.
  The network is the authority on what you were paid, and it pays your own account directly.
  <a href="/dashboard/${esc(channel.slug)}/earnings">Where the money goes →</a>
</p>

${traffic.length ? `
<div class="panel" style="margin-top:var(--space-6)">
  <div class="panel-head">
    <h2 style="font-size:var(--text-md)">Views, day by day</h2>
    <span class="spacer"></span>
    <span class="fine">Last 30 days</span>
  </div>
  <div class="panel-body">
    ${trafficChart({
    points: traffic.map((p) => ({ day: p.day, value: p.views || 0, measured: p.measured })),
    label: 'Views',
  })}
    <p class="fine" style="margin-top:var(--space-3)">
      Counted in our own table when a storefront page is served, so it is exact for what it measures —
      and it measures page views, not people. Days with no row at all are shaded and never drawn as
      zero: a gap in our records is not a quiet day.
    </p>
  </div>
</div>` : ''}

<div class="panel" style="margin-top:var(--space-5)">
  <div class="panel-head"><h2 style="font-size:var(--text-md)">What this store rents</h2></div>
  <div class="panel-body">
    <dl class="kv">
      <dt>Monthly traffic</dt><dd>${plural(estimate.pageviews30d || pageviews, 'view')} in 30 days</dd>
      <dt>Slots you own</dt><dd>${num((estimate.total || 0) - (estimate.rent || 0))} of ${num(estimate.total || 0)}</dd>
      <dt>Platform rent slots</dt><dd>${num(estimate.rent || 0)} — the platform sells these</dd>
      <dt>Assumed ad rate</dt><dd>$${Number(estimate.rpmUsd || 0).toFixed(2)} per 1,000 views</dd>
      <dt>Estimated rent value</dt><dd><strong>${npr(estimate.estNpr || 0)}</strong> per 30 days</dd>
    </dl>
    <p class="fine" style="margin-top:var(--space-4)">
      Rent is priced from measured traffic, not from a plan tier — a busy store pays more for the
      same slot than a quiet one, and a quiet store is never charged for traffic it did not get.
      The figure above is an estimate at the assumed rate, not an invoice.
    </p>
  </div>
</div>

${assets.length ? `
<section class="section">
  <div class="section-head">
    <h2>Your files</h2>
    <p>${plural(assets.length, 'file')} published. Everything here is editable — nothing is
      reviewed before it appears, and nothing is locked after it does.</p>
  </div>
  <div class="panel"><div class="panel-body panel-body-flush">
    <table class="table">
      <thead><tr><th>File</th><th>Access</th><th>State</th>
        <th class="num">Unlocks</th><th>Ad views · 30d</th><th class="num"></th></tr></thead>
      <tbody>${(() => {
    // One scale for every row. If each chart picked its own maximum, the file
    // with one ad view would draw the same shape as the file with two hundred.
    const seriesOf = (id) => {
      const raw = adViewSeries?.get ? adViewSeries.get(id) : null;
      return raw ? raw.map((p) => ({ day: p.day, value: p.views })) : [];
    };
    const sharedMax = assets.reduce((best, a) => {
      const peak = seriesOf(a.id).reduce((m, p) => Math.max(m, p.value), 0);
      return Math.max(best, peak);
    }, 0);
    return assets.map((a) => {
      const st = assetStats.find((x) => x.id === a.id) || { files: 0, unlocks: 0 };
      const series = seriesOf(a.id);
      const monthTotal = series.reduce((t, p) => t + p.value, 0);
      return `<tr>
        <td><strong>${esc(a.title)}</strong>
          <div class="fine">${esc(a.slug)} · ${plural(Number(st.files) || 0, 'file')}${
    a.unlock_mode === 'open' ? ' · open to everyone' : ''}</div></td>
        <td>${a.unlock_mode === 'open' ? pill('Free', 'success') : pill('Ad-gated', 'locked')}</td>
        <td>${a.status === 'paused'
    ? pill('Paused', 'warning')
    : a.status === 'removed' ? pill('Removed', 'danger') : pill('Live', 'success')}</td>
        <td class="num">${num(Number(st.unlocks) || 0)}</td>
        <td>${series.length
    ? `<div class="row" style="gap:var(--space-3);align-items:center">${sparkline({ points: series, max: sharedMax })}
         <span class="fine">${monthTotal ? `${num(monthTotal)} this month` : 'none yet'}</span></div>`
    : '<span class="fine">—</span>'}</td>
        <td class="num"><a class="btn btn-sm" href="/dashboard/${esc(channel.slug)}/assets/${esc(a.id)}">Edit</a></td>
      </tr>`;
    }).join('');
  })()}</tbody>
    </table>
  </div></div>
</section>` : ''}

<section class="section">
  <div class="section-head">
    <h2>Publish a file</h2>
    <p>It goes live immediately. Nothing is reviewed before it appears on your storefront.</p>
  </div>
  <form class="card card-pad-lg" method="post" enctype="multipart/form-data"
        action="/dashboard/${esc(channel.slug)}/assets">
    <div class="field">
      <label for="p-title">Title</label>
      <input class="input" id="p-title" name="title" required maxlength="200"
             placeholder="e.g. Devanagari Poster Kit">
      <span class="hint">Becomes the page address: /s/${esc(channel.slug)}/a/&lt;title-with-dashes&gt;</span>
    </div>
    <div class="field">
      <label for="p-desc">Description</label>
      <textarea class="textarea" id="p-desc" name="description" rows="3" maxlength="2000"
                placeholder="What is in the file, and who is it for?"></textarea>
    </div>
    <div class="row" style="gap:var(--space-5);align-items:flex-start">
      <div class="field" style="flex:1 1 240px">
        <label for="p-media">The file people unlock</label>
        <input class="input" id="p-media" name="media" type="file" required>
        <span class="hint">Up to 25 MB. Stored privately — it is only ever sent through a
        link minted for one signed-in account.</span>
      </div>
      <div class="field" style="flex:1 1 240px">
        <label for="p-cover">Cover image <span class="muted">(optional)</span></label>
        <input class="input" id="p-cover" name="cover" type="file" accept="image/*">
        <span class="hint">This is what shows in the grid and in every share preview.
        Listings with a cover get looked at.</span>
      </div>
    </div>
    <div class="row" style="gap:var(--space-5);align-items:flex-start">
      <div class="field" style="flex:1 1 200px">
        <label for="p-mode">Access</label>
        <select class="input" id="p-mode" name="unlockMode">
          <option value="ad_gated">One rewarded ad</option>
          <option value="open">Free — no ad</option>
        </select>
      </div>
      <div class="field" style="flex:1 1 200px">
        <label for="p-seconds">Minimum ad length</label>
        <input class="input" id="p-seconds" name="adMinSeconds" type="number"
               min="5" max="120" step="5" value="15">
        <span class="hint">The network sets the real length. This is the floor you ask for.</span>
      </div>
    </div>
    <button class="btn btn-primary" type="submit" style="margin-top:var(--space-2)">Publish</button>
    <p class="fine" style="margin-top:var(--space-3)">
      Selling for money is not switched on yet. Everything published today is unlocked by
      watching one ad, and the network pays your own account for it.
    </p>
  </form>
</section>

<section class="section">
  <div class="section-head"><h2>Ad slots</h2>
    <p>Where ads can appear. The platform takes one slot per page, last rank, never rank 1.
      <a href="/dashboard/${esc(channel.slug)}/slots">What fills each one →</a></p></div>
  <div class="panel"><div class="panel-body panel-body-flush">
    <table class="table">
      <thead><tr><th>Slot</th><th>Owner</th><th>State</th></tr></thead>
      <tbody>${slotRows || '<tr><td colspan="3" class="muted">No slots on this plan.</td></tr>'}</tbody>
    </table>
  </div></div>
</section>

${conn ? `
<section class="section">
  <div class="section-head"><h2>Ad connection</h2></div>
  <div class="panel"><div class="panel-body">
    <div class="row">
      ${pill(provider?.name || conn.provider_id, 'success')}
      <span class="small">Connected ${relTime(conn.connected_at)}</span>
      <span class="spacer"></span>
      <a class="btn btn-sm" href="/dashboard/${esc(channel.slug)}/networks">Credentials and health →</a>
    </div>
    ${provider ? `<dl class="kv" style="margin-top:var(--space-5)">
      <dt>Formats</dt><dd>${esc((provider.formats || []).join(', '))}</dd>
      <dt>Callback</dt>
      <dd><a href="/dashboard/${esc(channel.slug)}/networks">Your exact URL, with the macros to leave alone →</a></dd>
    </dl>` : ''}
    <p class="fine" style="margin-top:var(--space-4)">
      Rewarded ads are served by the network inside your own page. When one completes, the network
      calls us server-to-server with a signature; only then is the unlock granted.
    </p>
  </div></div>
</section>` : `
<section class="section">
  <div class="note note-warning">
    No ad connection yet — nothing on this store can be unlocked, because there is no network to
    verify a completed view. Connect one below.
  </div>
</section>`}

<section class="section">
  <div class="section-head"><h2>Connect a network</h2></div>
  <div class="panel"><div class="panel-body">
    <p class="small" style="margin:0">
      The networks are ranked by whether a Nepali creator can actually withdraw the money,
      and each one is set up in your own name: we show you the four steps, you paste the
      verification secret, and the page gives you the callback URL to paste back at them.
    </p>
    <p class="fine" style="margin-top:var(--space-4)">
      Nothing is stored except that secret, and a connection stays unverified until a real
      callback arrives.
    </p>
    <div class="row" style="margin-top:var(--space-5)">
      <a class="btn btn-primary" href="/dashboard/${esc(channel.slug)}/networks">Open networks →</a>
    </div>
  </div></div>
</section>

<section class="section">
  <div class="section-head"><h2>Plan</h2></div>
  <div class="panel"><div class="panel-body">
    <dl class="kv">
      <dt>Current</dt><dd>${esc(plan.name)} · ${npr(plan.priceNpr)}/year</dd>
      <dt>Files</dt><dd>${plan.capabilities.max_assets === -1 ? 'Unlimited' : plan.capabilities.max_assets}</dd>
      <dt>Slots</dt><dd>${plan.capabilities.slot_count}</dd>
      <dt>Earnings</dt><dd><a href="/dashboard/${esc(channel.slug)}/earnings">Who pays you, and how much →</a></dd>
      <dt>Billing</dt><dd><a href="/dashboard/${esc(channel.slug)}/billing">Plans, rent and payments →</a></dd>
      <dt>Store settings</dt><dd><a href="/dashboard/${esc(channel.slug)}/settings">Name, banner, listing →</a></dd>
      <dt>Reviews</dt><dd><a href="/dashboard/${esc(channel.slug)}/reviews">What buyers wrote →</a></dd>
    </dl>
    ${upgrade ? `
      <div class="note note-info" style="margin-top:var(--space-5)">
        Upgrade to <strong>${esc(upgrade.to.name)}</strong> — ${npr(upgrade.amountNpr)} pro-rated,
        ${plural(upgrade.daysLeft, 'day')} left on this cycle.
        <div class="fine" style="margin-top:var(--space-2)">
          ${npr(upgrade.to.priceNpr)} − ${npr(upgrade.from.priceNpr)} = ${npr(upgrade.fullDifference)}
          × ${upgrade.daysLeft}/365. Your renewal date does not move.
        </div>
      </div>` : ''}
    ${pendingPayments.length
      ? `<p class="fine" style="margin-top:var(--space-4)">${pendingPayments.length} payment(s) awaiting verification.</p>`
      : ''}
  </div></div>
</section>`,
  });
}

// ---------------------------------------------------------------------------
// Slots
// ---------------------------------------------------------------------------

/**
 * An empty slot still occupies its height. Without that, the page reflows when a
 * tag finally loads and everything below it jumps — a layout shift counts
 * against the page in search ranking and against the reader in annoyance.
 */
/**
 * An ad slot.
 *
 * What this looks like when no network is connected matters: it is on every
 * storefront and every asset page, and the previous version printed "rank 3 ·
 * reserved" at the visitor — internal billing vocabulary, on the shop floor.
 * Nobody looking at a shop should be told about slot rank.
 *
 * The space still has to be reserved, because that is the layout commitment the
 * seller is buying, so it stays the same height and says what it is for. When a
 * slot is serving, the render layer is what fills it.
 */
/**
 * Where a slot goes on a page.
 *
 * Position is the product here: the rent slot is the last one, and that ordering
 * is the consideration for the rent rather than a promise in a policy document.
 * Stacking every slot at the bottom of the page would make the rank labels on
 * the slots page untrue, so rank 1 is placed at the top and the rest after the
 * content they sit beside.
 */
function placeSlots(slots = []) {
  const fill = (list) => list.map(renderSlot).join('');
  const own = slots.filter((s) => s.owner !== 'platform');
  const platform = slots.filter((s) => s.owner === 'platform');
  return {
    head: fill(own.filter((s) => s.rank === 1)),
    mid: fill(own.filter((s) => s.rank !== 1)),
    foot: fill(platform),
  };
}

export function renderSlot(slot) {
  const h = Math.min(slot.maxHeightPx || slot.max_height_px || 250, 280);
  const owner = slot.owner === 'platform' ? 'platform' : 'channel';
  const from = slot.from || 'none';
  const creative = slot.creative || null;

  /*
   * AN EMPTY SPACE THE STORE OWNS IS NOT RENDERED TO A VISITOR.
   *
   * This is not tidiness. The store's own slot sits at rank 1 — the first thing
   * a visitor sees, by design, because the top position belongs to the creator
   * rather than to the platform. When the creator has not written anything, that
   * made the most valuable position on the page a 250px box saying "Alice has not
   * put a message here yet", with the actual files pushed below the fold.
   *
   * A screenshot of the storefront is what found it. Nothing in the test suite
   * could have: every assertion about the empty note was true, and the note was
   * correct — it should simply never have reached a shopper.
   *
   * The owner still sees it, because they are the one person who can act on it,
   * and on their dashboard it is a compact prompt rather than a hole.
   */
  if (!creative && owner === 'channel' && !slot.isOwner) return '';
  const compact = !creative && owner === 'channel';
  const cls = ['slot', `slot-${owner}`, from === 'none' ? 'slot-empty' : 'slot-filled'];
  if (slot.surface === 'app_native') cls.push('slot-app');

  // The label is the visitor's answer to "who put this here". It is rendered,
  // not implied by position: a reader has to be able to tell the store's message
  // from the platform's advertisement without inspecting the page.
  const inner = creative ? `
    <a class="slot-creative" href="${esc(creative.linkUrl || '#')}"
       ${creative.linkUrl ? '' : 'aria-disabled="true"'}>
      <div class="slot-creative-head">${esc(creative.headline)}</div>
      ${creative.body ? `<p class="slot-creative-body">${esc(creative.body)}</p>` : ''}
      ${creative.linkLabel ? `<span class="slot-cta">${esc(creative.linkLabel)}</span>` : ''}
    </a>`
    : `
    <div class="slot-empty-note">${esc(slot.emptyNote || slot.byline || '')}</div>
    ${slot.editHref ? `<a class="slot-empty-action" href="${esc(slot.editHref)}">Write one →</a>` : ''}`;

  return `<aside class="${cls.join(' ')}${compact ? ' slot-prompt' : ''}" data-slot="${esc(slot.slotKey || slot.key || '')}"
       data-owner="${esc(owner)}" data-serving="${from === 'none' ? 'false' : 'true'}"
       data-adapter="${esc(slot.adapter || '')}" data-surface="${esc(slot.surface || 'web')}"
       ${compact ? '' : `style="min-height:${h}px"`} role="complementary" aria-label="${esc(slot.label || 'Advertisement')}">
  <div class="slot-inner">
    <div class="slot-label">${esc(slot.label || 'Advertisement')}</div>
    <div class="slot-sub">${esc(slot.byline || '')}</div>
    ${inner}
  </div>
</aside>`;
}

export const m = { esc, npr, num, relTime, pill };

// ---------------------------------------------------------------------------
// Legal
// ---------------------------------------------------------------------------

/**
 * A legal page.
 *
 * Rendered from the structures in src/legal.js rather than written as markup, so
 * the body of each section is authored once and the warning about missing
 * operator details cannot be forgotten on one page but not another.
 */
export function legalPage({ user, doc, consent = null, missingOperatorFields = [], next = '/' }) {
  const body = doc.sections.map((sec) => `
    <section class="section" style="margin-top:var(--space-8)">
      <h2 style="font-size:var(--text-lg)">${esc(sec.h)}</h2>
      <div class="prose" style="margin-top:var(--space-3)">${sec.body}</div>
    </section>`).join('');

  return layout({
    title: doc.title, user, consent, current: 'legal',
    body: `
<div class="section" style="margin-top:var(--space-8);max-width:var(--measure)">
  <h1>${esc(doc.title)}</h1>
  <p class="lede" style="margin-top:var(--space-3)">${esc(doc.lede)}</p>
</div>

${missingOperatorFields.length ? `
<div class="note note-warning" style="max-width:var(--measure)" role="alert">
  <strong>This deployment has not been configured.</strong>
  <p class="small" style="margin-top:var(--space-2)">
    A notice that does not identify who is responsible for the data is not a notice. The
    following are still empty and must be set before this page is shown to anyone:
  </p>
  <ul class="small" style="margin:var(--space-2) 0 0 var(--space-5)">
    ${missingOperatorFields.map((f) => `<li><code>${esc(f.key)}</code> — ${esc(f.why)}</li>`).join('')}
  </ul>
</div>` : ''}

${doc.consent !== undefined ? consentControls({ consent, next }) : ''}

<div style="max-width:var(--measure)">${body}</div>
`,
  });
}

/**
 * The controls, on the page, for changing the decision.
 *
 * A single form rather than three buttons: the checkboxes carry the state, so
 * "save" means exactly what the boxes say. Two mega-buttons that flip everything
 * without showing what they flipped is how people end up granting something they
 * meant to refuse.
 */
function consentControls({ consent, next }) {
  const purposes = consent?.purposes || [];
  // Read straight from the stored choices, so the checkbox reflects what is on
  // file rather than a hand-maintained list of special cases.
  const on = (key) => consent?.choices?.[key] === true;

  return `
<form method="post" action="/consent" class="card card-pad-lg" style="max-width:var(--measure);margin-top:var(--space-6)">
  <input type="hidden" name="next" value="${esc(next)}">
  <div class="row">
    <h2 style="font-size:var(--text-md)">Choose individually</h2>
    <span class="spacer"></span>
    ${consent?.decided
      ? pill(consent.ads ? 'Personalised ads on' : 'Personalised ads off', consent.ads ? 'success' : '')
      : pill('Not answered')}
  </div>

  ${purposes.map((p) => `
  <label class="check" style="align-items:flex-start">
    <input type="checkbox" name="${esc(p.key)}" value="on" ${on(p.key) ? 'checked' : ''}>
    <span>
      <strong>${esc(p.label)}</strong>
      <span class="fine" style="display:block;margin-top:var(--space-1)">${esc(p.detail)}</span>
    </span>
  </label>`).join('')}

  <div class="row" style="margin-top:var(--space-4);gap:var(--space-3)">
    <button class="btn btn-primary" type="submit" name="choice" value="save">Save my choice</button>
    <button class="btn" type="submit" name="choice" value="none">Reject all</button>
    <button class="btn" type="submit" name="choice" value="all">Accept all</button>
  </div>
</form>`;
}

/**
 * Ad networks — connecting a store to the network that pays it.
 *
 * Every other product in this category shows a Connect button that opens OAuth
 * and a green tick that means nothing to anybody. This page has to do three
 * things instead, and all three are consequences of the money model:
 *
 *   1. Be explicit that the account is the CREATOR'S. We never ask for a
 *      network login. What we hold is the value their network signs callbacks
 *      with — it authorises nothing but the verification of an event.
 *   2. Hand over the exact callback URL, with the network's own macros left
 *      intact, and say which macro maps to what. This is the step that fails in
 *      real life, and the page has to make it copy-pastable.
 *   3. Show evidence rather than a colour: has this network ever called us, when
 *      last, and how many times in thirty days. "Connected" with no callbacks
 *      ever is the support ticket, and the page should answer it before it is
 *      opened.
 */
export function networksPage({
  channel, user, consent = null, flash = null, connections = [], available = [],
  base = '', unusableBase = false, slotDefs = [],
}) {
  const card = ({ connection: c, provider, onboarding, url, health, sandbox, secretHint, events }) => {
    const kind = {
      live: 'success', working: 'success', sandbox: 'info',
      quiet: 'warning', silent: 'warning', unverified: 'warning', noadapter: 'warning', off: '',
    }[health.level] || '';
    const connector = onboarding.credentials[0] || null;
    const canVerify = onboarding.mode === 'paste_credentials' || onboarding.mode === 'none';
    // No slots for a network we cannot serve: assigning one would reserve space
    // the seller pays rent for and give it to nothing.
    const slotPicker = !sandbox && canVerify && c.status !== 'revoked';

    return `
  <div class="card card-pad-lg network-card">
    <div class="row">
      <div>
        <h3 style="font-size:var(--text-lg)">${esc(provider.name)}</h3>
        <div class="fine">${esc(provider.slotModel || 'network')}${provider.formats?.length ? ` · ${esc(provider.formats.join(' / '))}` : ''}</div>
      </div>
      <span class="spacer"></span>
      ${pill(health.label, kind)}
    </div>

    <p class="small" style="margin-top:var(--space-3)">${esc(health.detail)}</p>

    ${url ? `
    <div class="field" style="margin-top:var(--space-5)">
      <label for="url-${esc(c.id)}">Callback URL — paste this into ${esc(provider.name)}</label>
      <input class="input mono" id="url-${esc(c.id)}" value="${esc(url)}" readonly
             onclick="this.select()" spellcheck="false">
      <span class="hint">${esc(onboarding.postback?.method || 'GET')} request.
        The braces are macros ${esc(provider.name)} substitutes — leave them exactly as they are.</span>
    </div>

    ${(onboarding.postback?.params || []).length ? `
    <!-- Wrapped so the table scrolls inside itself on a phone. Every other table
         on the site sits in a panel body, which carries that behaviour; this one
         was written directly into the panel body and pushed the whole page
         sideways at 390px, which is a bug that only shows up when somebody
         actually opens the page at that width. -->
    <div class="table-scroll" style="margin-top:var(--space-4)">
    <table class="table">
      <thead><tr><th>Parameter</th><th>Their macro</th><th>What it carries</th></tr></thead>
      <tbody>${onboarding.postback.params.map((p) => `<tr>
        <td class="mono">${esc(p.ours)}</td>
        <td class="mono">${esc(p.theirs || p.value || '—')}</td>
        <td class="small">${esc(p.note || '')}</td>
      </tr>`).join('')}</tbody>
    </table>
    </div>` : ''}

    ${onboarding.postback?.signature ? `
    <div class="note" style="margin-top:var(--space-4)">
      <strong>How they sign it: ${esc(onboarding.postback.signature.algo)}</strong>
      <p class="small" style="margin-top:var(--space-2)">
        Over ${esc(onboarding.postback.signature.covers)}, keyed by ${esc(onboarding.postback.signature.key)}.
        ${esc(onboarding.postback.signature.detail || '')}
      </p>
    </div>` : ''}` : `
    <p class="small" style="margin-top:var(--space-4)">
      ${canVerify
    ? 'This network needs no callback URL and no secret. There is nothing to configure.'
    : `We have no adapter for ${esc(provider.name)}, so there is no callback URL to give it and nothing here to
       configure. What that costs you: no unlocks through this network. What it does not cost you: the money —
       they pay your account directly, and you can record what they report on your earnings page.`}
    </p>`}

    ${connector ? `
    <form method="post" action="/dashboard/${esc(channel.slug)}/networks/${esc(c.id)}/secret"
          style="margin-top:var(--space-5)">
      <div class="field">
        <label for="sec-${esc(c.id)}">${esc(connector.label)}</label>
        <input class="input mono" id="sec-${esc(c.id)}" name="${esc(connector.key)}" type="password"
               autocomplete="off" spellcheck="false"
               placeholder="${secretHint ? esc(secretHint) : 'paste it here'}">
        <span class="hint">${esc(connector.help || '')}</span>
      </div>
      <div class="row">
        <button class="btn btn-primary btn-sm" type="submit">
          ${c.callback_secret ? 'Replace the secret' : `Save and verify`}
        </button>
        ${c.callback_secret ? `<span class="fine">Saved: <span class="mono">${esc(secretHint)}</span> — never shown in full again.</span>` : ''}
      </div>
    </form>` : ''}

    ${slotPicker ? `
    <form method="post" action="/dashboard/${esc(channel.slug)}/networks/${esc(c.id)}/slots"
          style="margin-top:var(--space-5)">
      <div class="field">
        <label>Slots this network may serve</label>
        <span class="hint">Leave all unticked and it fills nothing — a slot it cannot serve is a blank
          space you are paying rent for.</span>
        <div class="check-grid">
          ${slotDefs.filter((d) => d.active).map((d) => `
          <label class="check">
            <input type="checkbox" name="slotKeys" value="${esc(d.key)}"
                   ${(c.slot_keys || []).includes(d.key) ? 'checked' : ''}>
            <span>${esc(d.label)} <span class="fine">· ${esc((d.formats || []).join('/'))}</span></span>
          </label>`).join('')}
        </div>
      </div>
      <button class="btn btn-sm" type="submit">Save slots</button>
    </form>` : ''}

    ${events.length ? `
    <details style="margin-top:var(--space-5)">
      <summary class="fine">History (${num(events.length)})</summary>
      <ul class="list-steps" style="margin-top:var(--space-3)">
        ${events.map((e) => `<li>${esc(day(e.created_at))} — ${esc(e.from_status || 'new')} → ${esc(e.to_status)}${e.detail ? ` · ${esc(e.detail)}` : ''}</li>`).join('')}
      </ul>
    </details>` : ''}

    ${c.status === 'revoked' ? '' : `
    <form method="post" action="/dashboard/${esc(channel.slug)}/networks/${esc(c.id)}/revoke"
          style="margin-top:var(--space-6)">
      <button class="btn btn-sm btn-danger" type="submit">Disconnect</button>
      <span class="fine">Callbacks from it stop being accepted immediately.</span>
    </form>`}
  </div>`;
  };

  const offer = ({ provider, onboarding, verdict, note }) => {
    const ok = landingUrlFor(provider, onboarding);
    return `
  <tr>
    <td>
      <strong>${esc(provider.name)}</strong>
      ${provider.enabled ? '' : '<div class="fine">not enabled on this deployment</div>'}
    </td>
    <td>${pill(verdict?.level || 'unknown', verdict?.level === 'ok' ? 'success' : verdict?.level === 'caution' ? 'warning' : '')}</td>
    <td class="num">${verdict?.thresholdLabel ? esc(verdict.thresholdLabel) : '—'}</td>
    <td class="small">${esc(note || provider._note || '')}</td>
    <td class="num">${ok
    ? `<form method="post" action="/dashboard/${esc(channel.slug)}/networks">
         <input type="hidden" name="providerId" value="${esc(provider.id)}">
         <button class="btn btn-sm btn-primary" type="submit">Connect</button>
       </form>`
    : ok === '' ? '' : '<span class="fine">no adapter yet</span>'}</td>
  </tr>`;
  };

  // A network we cannot verify is not connectable, so it gets no button — and
  // the table says why rather than leaving a dash to be interpreted.
  function landingUrlFor(provider, onboarding) {
    if (provider.enabled === false && provider.blockedReason) return null;
    if (onboarding.mode === 'paste_credentials' || onboarding.mode === 'none') return 'connect';
    return null;
  }

  return layout({
    title: 'Ad networks', user, activeChannel: channel, consent, current: 'dashboard',
    body: `
${pageHead(channel, 'networks', 'Ad networks',
    'Where the ad money comes from, whose account it lands in, and the one URL that makes it work.')}

${flash ? `<div class="note note-${flash.kind}" role="status">${esc(flash.message)}</div>` : ''}

<div class="note">
  <strong>The account is yours, and so is the payment.</strong>
  <p class="small" style="margin-top:var(--space-2)">
    We never ask for a network login and we never hold a publisher id. What you save here is the value
    your network signs its callbacks with, and it authorises nothing except the verification of an event
    we were told about. The network pays your account; we are not a party to it and cannot see the balance.
  </p>
</div>

${unusableBase ? `
<div class="note note-warning">
  <strong>This deployment has no public address configured.</strong>
  <p class="small" style="margin-top:var(--space-2)">
    The callback URLs below are built from the address this browser used, which is
    <span class="mono">${esc(base)}</span>. If that is not reachable from the internet, a network cannot call
    it — set <span class="mono">PUBLIC_BASE_URL</span> and reload this page.
  </p>
</div>` : ''}

<section class="section">
  <div class="section-head">
    <h2>Connected</h2>
    <p>${connections.length ? plural(connections.length, 'network') : 'Nothing connected yet'}.</p>
  </div>
  ${connections.length ? connections.map(card).join('') : `
  <div class="empty">
    No network is connected. Until one is, your ad slots show the platform's own house ad — and that is
    what rent buys, so nothing is broken. Connect a network only when you want the space to earn you money.
  </div>`}
</section>

<section class="section">
  <div class="section-head">
    <h2>Networks you could add</h2>
    <p>Sorted by what a creator in Nepal can actually use today. The threshold column is the network's
      own advertised minimum, which is not always the threshold an individual publisher gets.</p>
  </div>
  <div class="panel"><div class="panel-body panel-body-flush">
    <table class="table">
      <thead><tr><th>Network</th><th>Nepal payout</th><th class="num">Minimum</th><th>What you should know</th><th class="num">Action</th></tr></thead>
      <tbody>${available.map(offer).join('')}</tbody>
    </table>
  </div></div>
  <p class="fine" style="margin-top:var(--space-4)">
    A network with no adapter is listed so you know it exists and what it pays, not because we can
    connect it. You can still open an account there in your own name and record what it reports on your
    earnings page — that is what keeps our estimate honest, and it works without any of this.
  </p>
</section>
`,
  });
}

/**
 * Ad slots — where a creator decides what goes in the space they own, and sees
 * what the space they rented out looks like.
 *
 * Two kinds of slot and they are not interchangeable, so the page never blurs
 * them: the store's own positions (the creator's inventory, no network
 * involved) and the platform's rent slot (our inventory, the consideration for
 * the rent). The rent slot is shown here but not editable, because it is not
 * theirs to fill — that is what renting it means.
 *
 * The preview is the real renderer. A preview that is a drawing of the thing
 * rather than the thing is a preview that lies eventually.
 */
export function slotsPage({ channel, slots = [], user, consent = null, flash = null }) {
  const own = slots.filter((s) => s.owner === 'channel');
  const rented = slots.filter((s) => s.owner === 'platform');

  const card = (slot) => `
  <div class="card card-pad-lg" id="slot-${esc(slot.slotKey || slot.key)}">
    <div class="row">
      <div>
        <h3 style="font-size:var(--text-md)">${esc(slot.label)}</h3>
        <div class="fine">rank ${num(slot.rank)} of ${num(slots.length)} · ${esc(slot.formats?.join(' / ') || '')}</div>
      </div>
      <span class="spacer"></span>
      ${slot.owner === 'platform'
    ? pill('Platform · rented to ByteBikri', 'warning')
    : slot.serves ? pill('Filled by you', 'success') : pill('Yours · empty', '')}
    </div>

    ${slot.purpose ? `<p class="fine" style="margin-top:var(--space-3)">${esc(slot.purpose)}</p>` : ''}

    ${renderSlot(slot)}

    ${slot.owner === 'platform' ? `
    <p class="fine">
      This is the space the store rents to ByteBikri. You do not fill it: the space itself is what is
      being rented, and it stays in the same position on every page load. Nothing about it follows a
      visitor around the web, and no buyer behaviour is sold.
    </p>` : `
    <form method="post" action="/dashboard/${esc(channel.slug)}/slots">
      <input type="hidden" name="slotKey" value="${esc(slot.slotKey || slot.key)}">
      <div class="field">
        <label for="head-${esc(slot.slotKey || slot.key)}">Headline</label>
        <input class="input" id="head-${esc(slot.slotKey || slot.key)}" name="headline" maxlength="90"
               value="${esc(slot.creative?.owner === 'channel' ? slot.creative.headline : '')}"
               placeholder="New pack out Friday">
      </div>
      <div class="field">
        <label for="body-${esc(slot.slotKey || slot.key)}">Line under it <span class="hint">optional</span></label>
        <input class="input" id="body-${esc(slot.slotKey || slot.key)}" name="body" maxlength="220"
               value="${esc(slot.creative?.owner === 'channel' ? (slot.creative.body || '') : '')}"
               placeholder="Twelve more textures, free to anyone who already bought the first kit.">
      </div>
      <div class="cols-2">
        <div class="field">
          <label for="link-${esc(slot.slotKey || slot.key)}">Link <span class="hint">optional</span></label>
          <input class="input" id="link-${esc(slot.slotKey || slot.key)}" name="linkUrl" maxlength="300"
                 value="${esc(slot.creative?.owner === 'channel' ? (slot.creative.linkUrl || '') : '')}"
                 placeholder="/s/${esc(channel.slug)} or https://…">
        </div>
        <div class="field">
          <label for="cta-${esc(slot.slotKey || slot.key)}">Link label</label>
          <input class="input" id="cta-${esc(slot.slotKey || slot.key)}" name="linkLabel" maxlength="40"
                 value="${esc(slot.creative?.owner === 'channel' ? (slot.creative.linkLabel || '') : '')}"
                 placeholder="See it">
        </div>
      </div>
      <div class="row">
        <button class="btn btn-primary btn-sm" type="submit">Save</button>
        ${slot.creative?.owner === 'channel'
    ? `<button class="btn btn-sm" type="submit" formaction="/dashboard/${esc(channel.slug)}/slots/clear">Clear</button>`
    : ''}
        <span class="spacer"></span>
        <span class="fine">Shown to visitors as “From ${esc(channel.name)}”.</span>
      </div>
    </form>
    <p class="fine" style="margin-top:var(--space-3)">
      Your own message, in your own space. There is nothing to buy here and nobody to pay: this is not
      an ad slot for sale, and selling this space to someone else off-platform would put a stranger's
      content on a page you are responsible for.
    </p>`}
  </div>`;

  return layout({
    title: 'Ad slots', user, activeChannel: channel, consent, current: 'dashboard',
    body: `
${pageHead(channel, 'slots', 'Ad slots',
    'The space on your pages, who owns each position, and what fills it today.')}

${flash ? `<div class="note note-${flash.kind}" role="status">${esc(flash.message)}</div>` : ''}

<div class="note">
  <strong>Two kinds of space, and one rule about position.</strong>
  <ul class="list-steps" style="margin-top:var(--space-3)">
    <li><strong>Rank 1 is always yours.</strong> The platform never takes the top position — by
      allocation, not by promise. The slot you rent out is the last one on the page.</li>
    <li><strong>Rent is one slot.</strong> One per page, never more, and a page too short to spare a
      slot is never charged for one.</li>
    <li><strong>Networks fill their own space.</strong> When a network is connected to a slot, the
      network serves the ad inside it. We keep no third-party script in our database, and we never run
      a tag from a network we have not verified.</li>
  </ul>
</div>

<section class="section">
  <div class="section-head">
    <h2>Your space</h2>
    <p>${own.length} of ${num(slots.length)} positions, and they appear on every storefront and
      file page you have. ${own.some((s) => !s.serves) ? 'Empty ones hold their height on the page, so nothing jumps when you fill one.' : ''}</p>
  </div>
  <div class="cols-2">${own.length ? own.map(card).join('') : '<p class="fine">No slots allocated on the free-size store yet — they appear when a page is long enough to spare one.</p>'}</div>
</section>

<section class="section">
  <div class="section-head">
    <h2>Rented to the platform</h2>
    <p>The space you are paid for. You can see what is in it; you cannot put anything in it.</p>
  </div>
  ${rented.length ? rented.map(card).join('') : `<div class="note"><p class="small">None of your pages
    has a rent slot right now. A rent slot appears only when a page has at least three slots to
    allocate, so a short page is never taxed for space it does not have.</p></div>`}
</section>

<div class="note note-warning">
  <strong>What this page does not do.</strong>
  <p class="small" style="margin-top:var(--space-2)">
    Slots on the web are display-class space. Rewarded video — the format that pays several times
    more — runs in the app, where the platform controls the player and can verify a completed view.
    A browser cannot do either, so the same position is worth less here, and no page in this product
    will tell you otherwise.
  </p>
</div>
`,
  });
}

// ---------------------------------------------------------------------------
// Dashboard shell — the pages a seller lives in
// ---------------------------------------------------------------------------

/**
 * The sub-navigation for the account pages.
 *
 * One row of links, the same on every one of them, with the current page marked
 * for assistive technology as well as for the eye. A dashboard whose pages do
 * not link to each other is a set of dead ends, which is what this was before:
 * the only way to billing was to know the URL.
 */
function storeSectionNav(channel, current) {
  const items = [
    ['', 'Overview'],
    ['earnings', 'Earnings'],
    ['billing', 'Billing'],
    ['slots', 'Ad slots'],
    ['networks', 'Ad networks'],
    ['settings', 'Store settings'],
    ['reviews', 'Reviews'],
  ];
  return `<nav class="subnav" aria-label="Store">
    ${items.map(([path, label]) => {
    const href = `/dashboard/${esc(channel.slug)}${path ? `/${path}` : ''}`;
    const isCurrent = current === (path || 'overview');
    return `<a href="${href}"${isCurrent ? ' aria-current="page"' : ''}>${esc(label)}</a>`;
  }).join('')}
  </nav>`;
}

/** `21 Sept 2026` — a date someone can read, not an ISO string. */
const day = (d) => (d
  ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
  : '—');

function pageHead(channel, current, title, lede) {
  return `${storeSectionNav(channel, current)}
<div class="section" style="margin-block:var(--space-6) var(--space-2)">
  <div class="row">
    <h1 style="font-size:var(--text-2xl)">${esc(title)}</h1>
    <span class="spacer"></span>
    <a class="btn btn-sm" href="/s/${esc(channel.slug)}" target="_blank" rel="noopener">View store ↗</a>
  </div>
  ${lede ? `<p class="lede" style="margin-top:var(--space-4)">${lede}</p>` : ''}
</div>`;
}

const flashNote = (flash) => (flash?.message
  ? `<div class="note note-${flash.kind}" role="status" style="margin-top:var(--space-6)">${esc(flash.message)}</div>`
  : '');

// ---------------------------------------------------------------------------
// Billing — the only two things bytebikri charges for
// ---------------------------------------------------------------------------

export function billing({
  channel, user, consent = null, flash = null, plan, nextPlanCode, pending = null, quote, upgrade,
  subscription, invoice, estimate = {}, pageviews = 0, paidTotal = 0, payments = [],
  invoices = [], rails = [], railsReady = false, payee = null, benefits = [],
  notCharged = [], slots = [],
}) {
  const periodEnd = subscription?.period_end;

  const railList = rails.filter((r) => r.id !== 'other');

  const payTo = railList.map((r) => `
    <div class="rail${r.ready ? '' : ' rail-off'}">
      <div class="rail-name">${esc(r.label)}</div>
      ${r.ready
      ? `<div class="rail-value mono">${esc(r.handle || (r.id === 'other' ? 'Ask an operator' : '—'))}</div>`
      : `<div class="rail-value muted">not configured</div>
         <div class="fine">Set <span class="mono">${esc(r.env)}</span> on the server to show this.</div>`}
    </div>`).join('');

  const payForm = (kind) => `
    <form method="post" action="/dashboard/${esc(channel.slug)}/billing/${kind}-payment" class="pay-form">
      <input type="hidden" name="invoiceId" value="${kind === 'rent' ? esc(invoice?.id || '') : ''}">
      <div class="row" style="gap:var(--space-4);align-items:flex-start">
        <div class="field" style="flex:1 1 160px">
          <label for="m-${kind}">Paid with</label>
          <select class="input" id="m-${kind}" name="method">
            ${railList.map((r) => `<option value="${esc(r.id)}">${esc(r.label)}</option>`).join('')}
            <option value="other">Something else</option>
          </select>
        </div>
        <div class="field" style="flex:2 1 220px">
          <label for="r-${kind}">Transaction reference</label>
          <input class="input" id="r-${kind}" name="txnReference" required minlength="4" maxlength="120"
                 autocomplete="off" placeholder="e.g. 8FJ2K19QW">
          <span class="hint">From the wallet receipt or the bank slip. This is what an operator
          matches against the statement.</span>
        </div>
      </div>
      <div class="row" style="gap:var(--space-4);align-items:flex-start">
        <div class="field" style="flex:1 1 200px">
          <label for="n-${kind}">Name on the transfer <span class="muted">(optional)</span></label>
          <input class="input" id="n-${kind}" name="payerName" maxlength="120">
        </div>
        <div class="field" style="flex:1 1 200px">
          <label for="p-${kind}">Number used <span class="muted">(optional)</span></label>
          <input class="input" id="p-${kind}" name="payerNumber" maxlength="40" inputmode="tel">
        </div>
      </div>
      <button class="btn btn-primary" type="submit">I have sent it — submit the reference</button>
      <p class="fine" style="margin-top:var(--space-3)">
        Nothing is activated by this form. It records what you say you sent; an operator matches it
        against the statement and only then does anything change.
      </p>
    </form>`;

  const subPanel = `
<div class="panel">
  <div class="panel-head">
    <h2>Store plan</h2>
    <span class="spacer"></span>
    ${pill(plan.name, plan.code === 'free' ? '' : 'accent')}
  </div>
  <div class="panel-body">
    <dl class="kv">
      <dt>Price</dt><dd>${plan.priceNpr ? `${npr(plan.priceNpr)} a year` : 'Free, permanently'}</dd>
      <dt>Renews</dt><dd>${periodEnd ? day(periodEnd) : 'No renewal — nothing to renew'}</dd>
      <dt>Status</dt><dd>${subscription ? esc(subscription.status.replace('_', ' ')) : 'free'}${pending ? ' · upgrade requested' : ''}</dd>
      <dt>Paid with bytebikri</dt><dd>${npr(paidTotal)} to date</dd>
    </dl>
    <ul class="list-checks" style="margin-top:var(--space-5)">
      ${benefits.map((b) => `<li>${esc(b)}</li>`).join('')}
    </ul>

    ${pending ? `
      <div class="note note-${pending.reference ? 'info' : 'warning'}" style="margin-top:var(--space-5)">
        <strong>${pending.reference ? 'Reference received — waiting to be matched.' : 'Waiting to be matched.'}</strong>
        Your upgrade to ${esc(pending.name)} is ${pending.reference ? 'submitted' : 'requested'}, for
        ${npr(pending.amountNpr)}.
        ${pending.reference
          ? `An operator matches <span class="mono">${esc(pending.reference)}</span> against the
             ${esc(pending.method || '')} statement, and the plan changes when it clears. You do not
             need to do anything else.`
          : 'Send it to one of the accounts below, then submit the reference from the receipt.'}
      </div>
      ${pending.reference ? '' : payForm('plan')}
      <p class="fine" style="margin-top:var(--space-4)">
        Your ${esc(plan.name)} plan stays exactly as it is until the money is matched — asking for an
        upgrade never takes away what you have already paid for.
      </p>
    ` : quote ? `
      <div class="note note-info" style="margin-top:var(--space-5)">
        <strong>Upgrade to ${esc(quote.to.name)}.</strong>
        <ul class="list-plain" style="margin-top:var(--space-3)">
          ${(upgrade?.lines || []).map((l) => `<li class="fine" style="border:0;padding:2px 0">${esc(l)}</li>`).join('')}
        </ul>
        <div class="amount-line">
          <span>Due today</span>
          <strong>${npr(quote.amountNpr)}</strong>
        </div>
        <form method="post" action="/dashboard/${esc(channel.slug)}/upgrade">
          <input type="hidden" name="plan" value="${esc(nextPlanCode)}">
          <button class="btn btn-primary" type="submit">Request this upgrade</button>
        </form>
        <p class="fine" style="margin-top:var(--space-3)">
          Requesting it does not charge anything and does not switch it on. It tells us what you
          want and gives you the account details to pay into.
        </p>
      </div>
    ` : `
      <p class="small" style="margin-top:var(--space-5)">
        You are on the top plan. There is nothing above this one to sell you.
      </p>
    `}
  </div>
</div>`;

  // Rent: an invoice, or the reason there is not one. Both are answers.
  const rentPanel = (() => {
    const working = invoice?.basis || {};
    const rows = `
      <dl class="kv">
        <dt>Traffic</dt><dd>${plural(working.pageviews30d ?? estimate.pageviews30d ?? pageviews, 'view')} in 30 days</dd>
        <dt>Slots on your pages</dt><dd>${num(working.slotsOnPage ?? estimate.total ?? 0)} — you keep
          ${num((working.slotsOnPage ?? estimate.total ?? 0) - (working.rentSlots ?? estimate.rent ?? 0))}</dd>
        <dt>Platform slot</dt><dd>${num(working.rentSlots ?? estimate.rent ?? 0)}${
      (working.rentSlots ?? estimate.rent ?? 0) ? ' — one per page, last rank' : ' — none, so no rent'}</dd>
        <dt>Assumed ad rate</dt><dd>$${Number(working.assumedRpmUsd ?? estimate.rpmUsd ?? 0).toFixed(2)} per 1,000 views</dd>
      </dl>`;

    if (!invoice) {
      // Two different reasons produce no invoice, and saying the wrong one is
      // how a seller concludes the page is lying to them. Either there is no
      // platform slot to rent (a page too short to spare one), or there is a
      // slot and it earned nothing because the traffic did not arrive. The
      // second is not a bill of zero, it is an absence of traffic, and the
      // sentence says which.
      const rentSlots = working.rentSlots ?? estimate.rent ?? 0;
      const views = working.pageviews30d ?? estimate.pageviews30d ?? pageviews;
      const why = rentSlots === 0
        ? `The platform rents one slot per page — always the last, never the first — and only on a
           page with at least three. Your pages are shorter than that, so there is nothing rented
           and nothing to invoice.`
        : `There is a platform slot on your pages, and it earned nothing this period:
           ${plural(views, 'view')} is not enough traffic to be worth billing. Rent is a share of
           the value the platform actually brought you, so a quiet period costs nothing.`;

      return `
<div class="panel">
  <div class="panel-head"><h2>Rent for the platform slot</h2></div>
  <div class="panel-body">
    <div class="note note-success">
      <strong>Nothing is due.</strong> ${why}
    </div>
    ${rows}
    <p class="fine" style="margin-top:var(--space-4)">
      When a page of yours has three or more slots, one of them — always the last, never the first —
      rents to the platform, and this page grows an invoice for it on your anniversary.
    </p>
  </div>
</div>`;
    }

    const statusNote = invoice.status === 'paid'
      ? `<div class="note note-success"><strong>Paid.</strong> Matched ${day(invoice.paid_at)} — thank you.</div>`
      : invoice.status === 'submitted'
        ? `<div class="note note-info"><strong>Reference received.</strong> Waiting for an operator to
           match it against the statement. Reference
           <span class="mono">${esc(invoice.txn_reference || '')}</span>.</div>`
        : '';

    return `
<div class="panel">
  <div class="panel-head">
    <h2>Rent for the platform slot</h2>
    <span class="spacer"></span>
    ${pill(invoice.status, invoice.status === 'paid' ? 'success' : invoice.status === 'submitted' ? 'info' : 'warning')}
  </div>
  <div class="panel-body">
    ${statusNote}
    <div class="amount-line" style="margin-top:var(--space-4)">
      <span>${day(invoice.period_start)} → ${day(invoice.period_end)}</span>
      <strong>${npr(invoice.amount_npr)}</strong>
    </div>
    ${rows}
    <p class="fine" style="margin-top:var(--space-4)">
      This is the working, in full: one rent slot's share of thirty days of pageview value, times
      twelve. It is an estimate at an assumed rate, not a statement — you can check every number in it.
    </p>
    ${invoice.status === 'issued' ? payForm('rent') : ''}
  </div>
</div>`;
  })();

  const history = invoices.length || payments.length
    ? `
<div class="panel">
  <div class="panel-head"><h2>What you have paid bytebikri</h2></div>
  <div class="panel-body panel-body-flush">
    <table class="table">
      <thead><tr><th>What</th><th>Period</th><th class="num">Amount</th><th>Status</th></tr></thead>
      <tbody>
        ${invoices.map((i) => `<tr>
          <td>Rent</td>
          <td>${day(i.period_start)} → ${day(i.period_end)}</td>
          <td class="num">${npr(i.amount_npr)}</td>
          <td>${pill(i.status, i.status === 'paid' ? 'success' : i.status === 'submitted' ? 'info' : 'warning')}</td>
        </tr>`).join('')}
        ${payments.map((p) => `<tr>
          <td>Plan · ${esc(p.plan_code)}</td>
          <td>${day(p.created_at)}</td>
          <td class="num">${npr(p.amount_npr)}</td>
          <td>${pill(p.status, p.status === 'matched' ? 'success' : p.status === 'rejected' ? 'danger' : 'info')}</td>
        </tr>`).join('')}
      </tbody>
    </table>
  </div>
</div>`
    : '';

  return layout({
    title: 'Billing', user, activeChannel: channel, consent, current: 'dashboard',
    body: `
${pageHead(channel, 'billing', 'Billing', `Two things cost money here, and both are yours to pay.
      Nothing is taken from what your store earns.`)}

<div class="section">
  <div class="cols-2">
    ${subPanel}
    ${rentPanel}
  </div>

  <div class="panel" style="margin-top:var(--space-6)">
    <div class="panel-head">
      <h2>Where to send it</h2>
      <span class="spacer"></span>
      ${railsReady ? '' : pill('not configured yet', 'warning')}
    </div>
    <div class="panel-body">
      ${payee ? `<p class="small">Payable to <strong>${esc(payee)}</strong>.</p>` : ''}
      <div class="rail-grid">${payTo}</div>
      <p class="fine" style="margin-top:var(--space-5)">
        There is no card checkout, and that is not an oversight: no acquirer in this market will
        settle to a Nepal-registered entity for this shape of business. So payment is a transfer to
        one of the accounts above, matched by hand against the statement — which is also why your
        reference matters more than usual.
      </p>
    </div>
  </div>

  <div class="panel" style="margin-top:var(--space-6)">
    <div class="panel-head"><h2>What you are not charged for</h2></div>
    <div class="panel-body">
      <ul class="list-checks">
        ${notCharged.map((n) => `<li>${esc(n)}</li>`).join('')}
      </ul>
    </div>
  </div>

  ${history}
</div>`,
  });
}

// ---------------------------------------------------------------------------
// Store settings
// ---------------------------------------------------------------------------

export function storeSettings({
  channel, user, consent = null, flash = null, plan, canList = false,
  subscription = null, stats = {},
}) {
  return layout({
    title: 'Store settings', user, activeChannel: channel, consent, current: 'dashboard',
    body: `
${pageHead(channel, 'settings', 'Store settings', 'How your store looks, where it is listed, and how it behaves.')}
${flashNote(flash)}

<div class="section">
  <form class="cols-2" method="post" enctype="multipart/form-data"
        action="/dashboard/${esc(channel.slug)}/settings">

    <div class="panel">
      <div class="panel-head"><h2>Identity</h2></div>
      <div class="panel-body">
        <div class="field">
          <label for="s-name">Store name</label>
          <input class="input" id="s-name" name="name" required maxlength="120" value="${esc(channel.name)}">
        </div>
        <div class="field">
          <label for="s-tagline">One line about it</label>
          <input class="input" id="s-tagline" name="tagline" maxlength="200"
                 value="${esc(channel.tagline || '')}"
                 placeholder="What you sell, and to whom.">
          <span class="hint">This is the line under your name on Explore and on every file page.</span>
        </div>
        <div class="field">
          <label for="s-about">About <span class="muted">(optional)</span></label>
          <textarea class="textarea" id="s-about" name="about" rows="5" maxlength="4000"
                    placeholder="Who you are, what you make, how you handle a broken file.">${esc(channel.about || '')}</textarea>
        </div>
        <div class="field">
          <label for="s-contact">Public contact <span class="muted">(optional)</span></label>
          <input class="input" id="s-contact" name="channelContact" maxlength="320"
                 value="${esc(channel.channel_contact || '')}"
                 placeholder="An email or a page, not a personal number.">
          <span class="hint">Shown to buyers. Your account email and phone are never shown —
          a buyer cannot use this store to find you.</span>
        </div>
      </div>
    </div>

    <div>
      <div class="panel">
        <div class="panel-head">
          <h2>Banner</h2>
          <span class="spacer"></span>
          ${channel.banner_url ? pill('set', 'success') : pill('none')}
        </div>
        <div class="panel-body">
          ${channel.banner_url
    ? `<img class="settings-banner" src="${esc(channel.banner_url)}" alt="" decoding="async">`
    : `<div class="settings-banner settings-banner-empty"><span>No banner yet</span></div>`}
          <div class="field" style="margin-top:var(--space-4)">
            <label for="s-banner">Replace it</label>
            <input class="input" id="s-banner" name="banner" type="file" accept="image/*">
            <span class="hint">Wide and short works best — it is cropped to a band, not a square.
            Images up to 5 MB.</span>
          </div>
        </div>
      </div>

      <div class="panel" style="margin-top:var(--space-6)">
        <div class="panel-head"><h2>Where you are listed</h2></div>
        <div class="panel-body">
          <label class="choice">
            <input type="radio" name="listingMode" value="storefront"
                   ${channel.listing_mode === 'marketplace' ? '' : 'checked'}>
            <span>
              <strong>My own address</strong>
              <span class="fine">Your store works at its link and is found by the people you send
              there. Free, permanently, and no plan needed.</span>
            </span>
          </label>
          <label class="choice">
            <input type="radio" name="listingMode" value="marketplace"
                   ${channel.listing_mode === 'marketplace' ? 'checked' : ''}
                   ${canList ? '' : 'disabled'}>
            <span>
              <strong>Listed in Explore</strong>
              <span class="fine">bytebikri brings the traffic, so this is what the paid plans buy.
              ${canList
    ? 'Included in your plan.'
    : `Your ${esc(plan.name)} plan does not include it — see the billing page.`}</span>
            </span>
          </label>
          <p class="fine" style="margin-top:var(--space-4)">
            A store keeping to its own address is never listed, never in search, and never shown to
            anybody you did not send. That is what the setting means, not a temporary state.
          </p>
        </div>
      </div>

      <div class="panel" style="margin-top:var(--space-6)">
        <div class="panel-head"><h2>Behaviour</h2></div>
        <div class="panel-body">
          <label class="check">
            <input type="checkbox" name="adsEnabled" ${channel.ads_enabled ? 'checked' : ''}>
            <span>Serve ads on my pages</span>
          </label>
          <p class="fine">
            Turning this off stops the ads immediately and leaves everything else alone: your files
            stay published, your unlocks keep working. Use it if a campaign is running elsewhere.
          </p>
          <label class="check" style="margin-top:var(--space-5)">
            <input type="checkbox" name="sellsDigital" ${channel.sells_digital ? 'checked' : ''}>
            <span>I publish digital files</span>
          </label>
          <label class="check">
            <input type="checkbox" name="sellsPhysical" ${channel.sells_physical ? 'checked' : ''}>
            <span>I also sell something physical</span>
          </label>
          <p class="fine">
            Physical items are recorded, not shipped by us: bytebikri handles no money and no
            delivery. It only tells buyers what to expect.
          </p>
        </div>
      </div>
    </div>

    <div class="form-foot">
      <button class="btn btn-primary" type="submit">Save settings</button>
      <span class="fine">Changes are visible immediately.</span>
    </div>
  </form>

  <div class="panel" style="margin-top:var(--space-8)">
    <div class="panel-head"><h2>Your store as buyers see it</h2></div>
    <div class="panel-body">
      <dl class="kv">
        <dt>Address</dt><dd class="mono">/s/${esc(channel.slug)}</dd>
        <dt>Listed</dt><dd>${channel.listing_mode === 'marketplace' ? 'In Explore' : 'Own address only'}</dd>
        <dt>Plan</dt><dd>${esc(plan.name)}${subscription?.period_end ? ` · renews ${day(subscription.period_end)}` : ''}</dd>
        <dt>Reviews</dt><dd>${stats.count
    ? `${Number(stats.average).toFixed(1)} from ${plural(stats.count, 'review')}`
    : 'None yet'}</dd>
      </dl>
    </div>
  </div>
</div>`,
  });
}

// ---------------------------------------------------------------------------
// Reviews, from the seller's side
// ---------------------------------------------------------------------------

export function dashboardReviews({ channel, user, consent = null, flash = null, reviews = [], stats = {} }) {
  const rows = reviews.map((r) => `
    <li class="review">
      <div class="review-head">
        <span class="stars" aria-label="${r.rating} out of 5">${'★'.repeat(r.rating)}${'☆'.repeat(5 - r.rating)}</span>
        <a href="/s/${esc(channel.slug)}/a/${esc(r.asset_slug)}">${esc(r.asset_title)}</a>
        <span class="spacer"></span>
        <span class="fine">${relTime(r.created_at)}</span>
      </div>
      <p class="review-body">${esc(r.body || '')}</p>
      ${r.seller_response
    ? `<div class="review-reply">
           <span class="fine">Your reply · ${relTime(r.seller_responded_at)}</span>
           <p>${esc(r.seller_response)}</p>
         </div>`
    : `<form class="review-form" method="post"
             action="/dashboard/${esc(channel.slug)}/reviews/${esc(r.id)}">
         <input class="input" name="response" maxlength="2000" required
                placeholder="Reply once — it appears under the review.">
         <button class="btn btn-sm" type="submit">Reply</button>
       </form>`}
    </li>`).join('');

  return layout({
    title: 'Reviews', user, activeChannel: channel, consent, current: 'dashboard',
    body: `
${pageHead(channel, 'reviews', 'Reviews', `Written only by people who unlocked the file. You get one
      reply each, and it stays attached.`)}
${flashNote(flash)}

<div class="section">
  <div class="stat-row">
    <div class="stat"><div class="stat-value">${stats.count ? Number(stats.average).toFixed(1) : '—'}</div>
      <div class="stat-label">Average</div></div>
    <div class="stat"><div class="stat-value">${num(stats.count || 0)}</div><div class="stat-label">Reviews</div></div>
  </div>

  ${reviews.length
    ? `<ul class="review-list">${rows}</ul>`
    : `<div class="empty" style="margin-top:var(--space-8)">
         No reviews yet. They arrive when somebody unlocks a file and writes one — there is no way
         to invite them, and no way to write one for yourself.
       </div>`}
</div>`,
  });
}

// ---------------------------------------------------------------------------
// One asset, from the seller's side
// ---------------------------------------------------------------------------

export function assetManage({
  channel, asset, user, consent = null, flash = null, files = [],
  policy = {}, stats = {}, unlocks = 0,
}) {
  const publicHref = `/s/${channel.slug}/a/${asset.slug}`;

  /**
   * One form, one Save.
   *
   * The first cut had two forms side by side, and the second one mirrored the
   * first one's fields in hidden inputs so that either could be submitted
   * alone. That is a trap: type a new title, press "Save terms", and the hidden
   * — stale — title posts back and the edit disappears. Two buttons that
   * silently undo each other are worse than one button that does both.
   */
  return layout({
    title: asset.title, user, activeChannel: channel, consent, current: 'dashboard',
    body: `
${pageHead(channel, 'overview', asset.title, `Published at <a href="${esc(publicHref)}">${esc(publicHref)}</a>.`)}
${flashNote(flash)}

<form class="cols-2" method="post" action="/dashboard/${esc(channel.slug)}/assets/${esc(asset.id)}">
  <div class="panel">
    <div class="panel-head"><h2>Details</h2></div>
    <div class="panel-body">
      <div class="field">
        <label for="a-title">Title</label>
        <input class="input" id="a-title" name="title" required maxlength="200" value="${esc(asset.title)}">
        <span class="hint">The address stays <span class="mono">${esc(asset.slug)}</span> — changing it
        would break every link anyone has already shared.</span>
      </div>
      <div class="field">
        <label for="a-desc">Description</label>
        <textarea class="textarea" id="a-desc" name="description" rows="4" maxlength="2000">${esc(asset.description || '')}</textarea>
      </div>
      <div class="row" style="gap:var(--space-4);align-items:flex-start">
        <div class="field" style="flex:1 1 160px">
          <label for="a-mode">Access</label>
          <select class="input" id="a-mode" name="unlockMode">
            <option value="ad_gated" ${asset.unlock_mode === 'ad_gated' ? 'selected' : ''}>One rewarded ad</option>
            <option value="open" ${asset.unlock_mode === 'open' ? 'selected' : ''}>Free — no ad</option>
          </select>
          <span class="hint">Changing this does not take back an unlock anyone already has.</span>
        </div>
        <div class="field" style="flex:1 1 160px">
          <label for="a-status">State</label>
          <select class="input" id="a-status" name="status">
            <option value="live" ${asset.status === 'live' ? 'selected' : ''}>Live</option>
            <option value="paused" ${asset.status === 'paused' ? 'selected' : ''}>Paused — hidden</option>
          </select>
          <span class="hint">Pausing hides it without deleting anything.</span>
        </div>
      </div>
      <div class="field">
        <label for="a-ads">Ads to unlock</label>
        <input class="input" id="a-ads" name="adsRequired" type="number" min="1" max="5" step="1"
               value="${Number(policy.ads_required) || 1}">
        <span class="hint">More than one ad per file is allowed and generally earns less per person
        than a single longer view.</span>
      </div>
      <div class="row" style="gap:var(--space-4);align-items:flex-start">
        <div class="field" style="flex:1 1 140px">
          <label for="a-seconds">Minimum ad length</label>
          <input class="input" id="a-seconds" name="adMinSeconds" type="number" min="5" max="120" step="5"
                 value="${Number(policy.ad_min_seconds) || 15}">
          <span class="hint">Seconds. The network sets the real length; this is the floor you ask for.</span>
        </div>
        <div class="field" style="flex:1 1 140px">
          <label for="a-hours">Access lasts</label>
          <input class="input" id="a-hours" name="unlockHours" type="number" min="1" max="720" step="1"
                 value="${Number(policy.unlock_hours) || 24}">
          <span class="hint">Hours. 24 is a day; 720 is a month.</span>
        </div>
      </div>
      <p class="fine">
        Nobody can unlock this file with money. Unlocks come from watching an ad, and the network
        pays your own account for it.
      </p>
    </div>
  </div>

  <div>
    <div class="panel">
      <div class="panel-head"><h2>Since publishing</h2></div>
      <div class="panel-body">
        <dl class="kv">
          <dt>Unlocks</dt><dd>${num(unlocks)}</dd>
          <dt>Files</dt><dd>${plural(files.length, 'file')}</dd>
          <dt>Reviews</dt><dd>${stats.count
    ? `${Number(stats.average).toFixed(1)} from ${plural(stats.count, 'review')}`
    : 'None yet'}</dd>
        </dl>
        <ul class="dl-list" style="margin-top:var(--space-5)">
          ${files.map((f) => `<li class="dl-item">
            <span class="file-badge" aria-hidden="true">${esc((f.mime_type || 'file').split('/').pop().slice(0, 4).toUpperCase())}</span>
            <span class="dl-body">
              <span class="dl-name">${esc(f.filename)}</span>
              <span class="dl-meta">${(f.size_bytes / 1024).toFixed(1)} KB · ${esc(f.mime_type || '')}</span>
            </span>
          </li>`).join('')}
        </ul>
        <p class="fine" style="margin-top:var(--space-4)">
          A file cannot be swapped for another one here. Replacing bytes behind a URL somebody
          already unlocked is how a store loses the argument about what they bought — publish a
          new file instead, and pause this one.
        </p>
      </div>
    </div>

    <div class="panel" style="margin-top:var(--space-6)">
      <div class="panel-head"><h2>Reviews on this file</h2></div>
      <div class="panel-body">
        ${stats.count
    ? `<p class="small">${Number(stats.average).toFixed(1)} out of 5 from ${plural(stats.count, 'review')}.
           <a href="/dashboard/${esc(channel.slug)}/reviews">Read and reply →</a></p>`
    : `<p class="fine">None yet. A review can only be written by somebody holding an unlock.</p>`}
      </div>
    </div>
  </div>

  <div class="form-foot">
    <button class="btn btn-primary" type="submit">Save</button>
    <span class="fine">Details and unlock terms save together.</span>
  </div>
</form>`,
  });
}

// ---------------------------------------------------------------------------
// Operator — matching money against the statement
// ---------------------------------------------------------------------------

/**
 * The operator console.
 *
 * One shell, four pages, and the layout is the research rather than taste:
 *
 *   - an inverted pyramid. Four or five KPIs answer "is anything on fire" without
 *     a click, the queues that need a person come next with their counts, and the
 *     detail sits underneath for whoever wants it;
 *   - equally sized KPI tiles on one row, because a row of unequal tiles reads as
 *     a mistake before it reads as design;
 *   - status is never carried by colour alone. Every tile and every pill has a
 *     word in it, which matters on the operator pages more than anywhere else:
 *     roughly one man in twelve cannot use the red/green difference at all;
 *   - an operator is an expert, so the density is higher here than anywhere else
 *     in the product. `Density follows expertise` — the calm version of this
 *     belongs on the seller's dashboard, not on the console.
 *
 * The navigation is a real <nav> of links, so it works without JavaScript and
 * every page is addressable.
 */
export function adminShell({ user, consent, current, title, lede = '', actions = '', body }) {
  const tab = (href, label, key, badge = 0) => `
    <a href="${esc(href)}"${current === key ? ' aria-current="page"' : ''}>
      ${esc(label)}${badge ? `<span class="nav-count">${num(badge)}</span>` : ''}
    </a>`;
  return layout({
    title, user, current: 'admin', consent,
    body: `
<div class="section console-head" style="margin-bottom:0">
  <div class="row" style="align-items:flex-start">
    <div>
      <h1>${esc(title)}</h1>
      ${lede ? `<p class="lede" style="margin-top:var(--space-2)">${lede}</p>` : ''}
    </div>
    <span class="spacer"></span>
    ${actions}
  </div>
</div>
<nav class="console-nav" aria-label="Console">${tab('/admin', 'Overview', 'overview')}${tab('/admin/payments', 'Payments', 'payments', user.adminBadges?.payments)}${tab('/admin/stores', 'Stores', 'stores')}${tab('/admin/users', 'People', 'people')}${tab('/admin/earnings', 'Earnings', 'earnings')}${tab('/admin/connections', 'Connections', 'connections')}${tab('/admin/reports', 'Reports', 'reports', user.adminBadges?.reports)}${tab('/admin/moderation', 'Moderation', 'moderation', user.adminBadges?.moderation)}${tab('/admin/audit', 'Audit log', 'audit')}</nav>
${body}`,
  });
}

/** One figure an operator can act on. Label, value, and the context line. */
function kpi({ label, value, context = null, tone = '', href = null }) {
  const inner = `
    <span class="kpi-label">${esc(label)}</span>
    <span class="kpi-value">${esc(value)}</span>
    ${context ? `<span class="kpi-context">${esc(context)}</span>` : ''}`;
  const cls = `kpi${tone ? ` kpi-${tone}` : ''}`;
  return href
    ? `<a class="${cls}" href="${esc(href)}">${inner}</a>`
    : `<div class="${cls}">${inner}</div>`;
}

/**
 * The console overview.
 *
 * The one question this page answers, in one sentence: is anything waiting for a
 * person, and is the money moving. Everything on it is a number that changes a
 * decision, and anything that does not is not on it.
 */
export function adminOverview({ user, consent = null, flash = null, kpis = [], queues = [], activity = [], platform = null }) {
  const queueRow = (q) => `
    <a class="queue-row" href="${esc(q.href)}">
      <span class="queue-count${q.count ? ' queue-count-live' : ''}">${num(q.count)}</span>
      <span class="queue-body">
        <strong>${esc(q.title)}</strong>
        <span class="fine">${esc(q.note)}</span>
      </span>
      <span class="queue-go" aria-hidden="true">→</span>
    </a>`;

  const log = activity.map((a) => `
    <tr>
      <td class="fine" style="white-space:nowrap">${esc(relTime(a.created_at))}</td>
      <td><span class="mono">${esc(a.action)}</span></td>
      <td class="fine">${esc(a.actor_name || a.actor_email || (a.actor_id ? 'a person' : 'the platform'))}</td>
    </tr>`).join('');

  return adminShell({
    user, consent, current: 'overview', title: 'Console',
    lede: 'What the platform owes people, and what is waiting for one of us.',
    body: `
${flash ? `<div class="note note-${flash.kind}" style="margin-top:var(--space-6)" role="status">${esc(flash.message)}</div>` : ''}

<section class="section">
  <div class="kpi-row">${kpis.map(kpi).join('')}</div>
</section>

<section class="section">
  <div class="section-head">
    <h2>Waiting for a person</h2>
    <p>Each one is a queue with a count. A zero here is the point of the page.</p>
  </div>
  <div class="queue-list">${queues.map(queueRow).join('')}</div>
</section>

${platform ? `
<section class="section">
  <div class="section-head"><h2>How the platform earns</h2>
    <p>Two charges, and neither is a share of a creator's ad revenue.</p></div>
  <div class="panel"><div class="panel-body">
    <dl class="kv">
      ${/* Values are markup on purpose (they carry <strong>), keys are text. The
            key still has to be escaped, which is why the caller must pass a real
            apostrophe rather than an entity: an entity passed as text comes out
            as &#39; on the page, which is what this line healed. */
      platform.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('')}
    </dl>
  </div></div>
</section>` : ''}

<section class="section">
  <div class="section-head">
    <h2>Recent activity</h2>
    <p>Every decision and every payment, newest first. <a href="/admin/audit">The whole log →</a></p>
  </div>
  <div class="panel"><div class="panel-body panel-body-flush">
    <table class="table">
      <thead><tr><th>When</th><th>Action</th><th>Who</th></tr></thead>
      <tbody>${log || '<tr><td colspan="3" class="muted">Nothing has happened yet.</td></tr>'}</tbody>
    </table>
  </div></div>
</section>`,
  });
}

/**
 * The report queue.
 *
 * One row per FILE, ordered by risk rather than by arrival, and every row says
 * how many distinct people reported it. Under the auto-hide threshold the file is
 * still live and the row says so — an operator looking at a queue needs to know
 * whether they are interrupting a seller or catching up with one.
 */
/**
 * Find a store.
 *
 * This is the page the console was missing: you could count stores and moderate
 * one you were already looking at, but there was no way to find one you had been
 * told about by name, slug or owner. Three filters, four sort orders, and a
 * search that reaches the owner's email because that is how a support message
 * usually arrives ("the person who reported this is alice@…").
 *
 * The research is visible in the details rather than in the decoration: numbers
 * are right-aligned and tabular so two rows can be compared by eye, the columns
 * are the ones an operator acts on rather than every column that exists, status
 * never relies on colour alone, and sorting is a link so it works without
 * JavaScript and every ordering is a URL somebody can send to somebody else.
 */
/**
 * The money path, watched.
 *
 * A connection that is quietly dead is the most expensive failure in this
 * product: the seller keeps publishing, the buyer keeps watching rewarded ads,
 * and nothing moves — because a callback URL was never saved in the network's own
 * dashboard. The seller's networks page answers "is mine connected"; this page
 * answers "is any of them, and which one is dead", which is a question only the
 * platform can ask because only the platform sees all of them at once.
 *
 * The diagnosis is written out per row rather than left as a status word, because
 * the four failure modes look identical from the outside (no money) and have
 * completely different fixes.
 */
function connectionDiagnosis(row, now = Date.now()) {
  const ageHours = (now - new Date(row.created_at).getTime()) / 3_600_000;
  const lastGood = row.last_verified_at ? new Date(row.last_verified_at) : null;
  const quietDays = lastGood ? (now - lastGood.getTime()) / 86_400_000 : null;

  if (row.provider_id === 'house') {
    return { tone: 'info', headline: 'Ours', detail: 'House creatives. No callback is expected, and none is missing.' };
  }
  if (row.status === 'revoked') {
    return { tone: '', headline: 'Disconnected by the seller', detail: 'Nothing to do. The record stays for the audit trail.' };
  }
  // Refusals are recorded for their REASON, and the reason decides the fix. A
  // signature mismatch means the seller must paste a new secret; "no adapter for
  // provider" means we cannot verify that network at all and the seller should be
  // told before they publish more files behind it. Both are refusals, and neither
  // is visible from the storefront.
  const rejectedAfterGood = row.last_rejected_at && (!lastGood || new Date(row.last_rejected_at) > lastGood);
  if (rejectedAfterGood && row.signature_failures > 0) {
    return {
      tone: 'bad', headline: 'The network is calling and we are refusing it',
      detail: 'The shared secret here does not match the one in the network\'s dashboard, so every callback '
        + 'fails verification. The seller has to paste the current secret again — no amount of waiting fixes it.',
    };
  }
  if (rejectedAfterGood && row.last_rejection_reason) {
    return {
      tone: 'warn', headline: 'Recent callbacks are being refused',
      detail: `The network is calling and we are answering 401: ${row.last_rejection_reason}. `
        + 'This is our side of the integration rather than the seller\'s, and it means nothing is unlocking.',
    };
  }
  if (row.status === 'restricted' || row.status === 'failed') {
    return {
      tone: 'warn', headline: 'The network refused this publisher',
      detail: row.status_reason || 'No reason recorded. Reconnect to see what the network says.',
    };
  }
  if (!row.postbacks_total) {
    return ageHours < 1
      ? { tone: 'info', headline: 'Waiting for the first callback', detail: 'Connected under an hour ago. Give it until tomorrow before assuming anything.' }
      : {
        tone: 'warn', headline: 'Never called us back',
        detail: 'Most often the callback URL was never saved in the network\'s own dashboard, which the seller '
          + 'has to do — or the placement is not live on their side. A verified connection is what turns "waiting" into "earning".',
      };
  }
  if (row.status === 'verifying') {
    return { tone: 'info', headline: 'Callbacks arriving, still verifying', detail: 'A signed callback has been received; the connection will settle once it repeats.' };
  }
  if (quietDays !== null && quietDays > 7) {
    return {
      tone: 'warn', headline: `Last signed callback ${Math.floor(quietDays)} days ago`,
      detail: 'It worked and then went quiet. Usually the placement was paused, or the ad code was removed from the store page.',
    };
  }
  return { tone: 'good', headline: 'Working', detail: 'Signed callbacks are arriving and being accepted.' };
}

export function adminConnections({ user, consent = null, flash = null, rows = [], days = 30 }) {
  const now = Date.now();
  const diagnosed = rows.map((r) => ({ ...r, dx: connectionDiagnosis(r, now) }));
  const callbacks = rows.reduce((a, r) => a + Number(r.callbacks_window || 0), 0);
  const rejected = rows.reduce((a, r) => a + Number(r.signature_failures || 0), 0);
  const talking = diagnosed.filter((r) => r.provider_id !== 'house' && r.status !== 'revoked' && r.postbacks_total > 0).length;
  const silent = diagnosed.filter((r) => r.dx.tone === 'warn' || r.dx.tone === 'bad').length;

  return adminShell({
    user, consent, current: 'connections', title: 'Connections',
    lede: 'Every ad network connected to a store, and whether it is actually calling us back. Nothing on this page moves money; it is how we find out that nothing is.',
    actions: `<a class="btn btn-sm" href="/admin/stores">Stores</a>`,
    body: `
${flash ? `<div class="note note-${flash.kind}" style="margin-top:var(--space-6)" role="status">${esc(flash.message)}</div>` : ''}

<section class="section">
  <div class="kpi-row">
    ${kpi({ label: 'Callbacks · 30d', value: callbacks.toLocaleString('en-IN'), context: 'signed requests from networks', href: null })}
    ${kpi({ label: 'Talking', value: String(talking), context: 'connections that have called us', tone: talking ? 'good' : '' })}
    ${kpi({ label: 'Needs a look', value: String(silent), context: silent ? 'never called, or refused signature' : 'every connection is healthy', tone: silent ? 'warn' : '' })}
    ${kpi({ label: 'Rejected signatures', value: rejected.toLocaleString('en-IN'), context: rejected ? 'a secret does not match' : 'none', tone: rejected ? 'bad' : '' })}
  </div>
</section>

<section class="section">
  <div class="section-head">
    <h2>${rows.length ? plural(rows.length, 'connection') : 'No connections'}</h2>
    <p>${rows.length
    ? `Ordered by how much attention each one needs. Callback counts cover the last ${num(days)} days.`
    : 'No store has connected an ad network yet. Until one does, nothing can be unlocked and nothing can be earned.'}</p>
  </div>

  ${rows.length ? diagnosed.map((r) => `
  <div class="panel" style="margin-top:var(--space-5)">
    <div class="panel-head">
      <a href="/admin/stores/${esc(r.channel_slug)}"><strong>${esc(r.channel_name)}</strong></a>
      <span class="fine">${esc(r.provider_id)}${r.credential_label ? ` · ${esc(r.credential_label)}` : ''}</span>
      <span class="spacer"></span>
      ${pill(r.status, r.status === 'active' ? 'success' : r.status === 'verifying' ? 'info' : r.status === 'revoked' ? '' : 'warning')}
    </div>
    <div class="panel-body">
      <p class="small" style="margin:0">
        <strong>${esc(r.dx.headline)}.</strong> ${esc(r.dx.detail)}
      </p>
      <dl class="kv" style="margin-top:var(--space-4)">
        <dt>Callbacks</dt><dd>${r.callbacks_window
    ? `${plural(r.callbacks_window, 'callback')} in ${num(days)} days${r.postbacks_total !== r.callbacks_window ? ` · ${num(r.postbacks_total)} ever` : ''}`
    : (r.postbacks_total ? `none in ${num(days)} days · last ${esc(relTime(r.last_verified_at))}` : 'never')}</dd>
        <dt>Last verified</dt><dd>${r.last_verified_at ? esc(relTime(r.last_verified_at)) : '—'}</dd>
        <dt>Refused</dt><dd>${r.rejections_total
    // The verdict above and this line have to agree. The first version counted
    // only signature failures here while the verdict counted every refusal, so a
    // row could say "callbacks are being refused" and "none" in the same breath.
    ? `${plural(r.rejections_total, 'callback')} answered 401 (last ${esc(relTime(r.last_rejected_at))})`
      + `${r.signature_failures ? ` · ${num(r.signature_failures)} of them a signature mismatch` : ''}`
      + `${r.last_rejection_reason ? `<div class="fine">${esc(r.last_rejection_reason)}</div>` : ''}`
    : 'nothing refused'}</dd>
        <dt>Slots filled</dt><dd>${r.slots_filled ? plural(r.slots_filled, 'slot') : 'none assigned to this connection'}</dd>
        <dt>Connected</dt><dd>${esc(relTime(r.created_at))}${r.payout_verdict ? ` · payout check: ${esc(r.payout_verdict)}` : ''}</dd>
      </dl>
      ${(r.history || []).length ? `<details class="disclosure" style="margin-top:var(--space-4)">
        <summary class="disclosure-head">
          <span class="disclosure-title" style="font-size:var(--text-sm)">Status history</span>
          <span class="disclosure-note">${plural(r.history.length, 'transition')}, newest first</span>
          <span class="disclosure-chevron" aria-hidden="true"></span>
        </summary>
        <div class="panel-body" style="border-top:1px solid var(--border-subtle)">
          <ul class="dl-list">
            ${r.history.map((h) => `<li class="dl-item" style="display:block">
              <span class="fine">${esc(relTime(h.created_at))} — ${esc(h.from_status || 'new')} → <strong>${esc(h.to_status)}</strong></span>
              ${h.detail ? `<div class="small">${esc(h.detail)}</div>` : ''}
            </li>`).join('')}
          </ul>
        </div>
      </details>` : ''}
    </div>
  </div>`).join('') : ''}
</section>

<section class="section">
  <div class="section-head">
    <h2>Four ways this breaks</h2>
    <p>They all look the same from the storefront — nothing unlocks, nothing is earned — and they have four different fixes.</p>
  </div>
  <div class="panel"><div class="panel-body">
    <dl class="kv">
      <dt>Never called us back</dt>
      <dd>The callback URL was never saved in the network's own dashboard, or the placement is not live.
        <span class="fine">The seller fixes this; we cannot do it for them, and the secret we generated is already on their connections page.</span></dd>
      <dt>Signature refused</dt>
      <dd>The network is calling and our check is failing, which means the secret here and the secret there are different.
        <span class="fine">Nothing is earned while this is true, and waiting never fixes it.</span></dd>
      <dt>Went quiet</dt>
      <dd>Signed callbacks stopped. Usually a paused placement or ad code removed from the page.
        <span class="fine">This is the one that looks like success from every other page in the console.</span></dd>
      <dt>Refused by the network</dt>
      <dd>The network rejected this publisher, and the reason it gave is on the row above.
        <span class="fine">Payout eligibility is checked at connect time and snapshotted, so a later registry change cannot rewrite what the seller was shown.</span></dd>
    </dl>
    <p class="fine" style="margin-top:var(--space-4)">
      What a creator was PAID is never on this page. We count the callbacks we received and verified;
      the money is between them and the network, and their statement is the authority.
    </p>
  </div></div>
</section>`,
  });
}

export function adminStores({ user, consent = null, flash = null, data = null, filters = {}, canExport = true }) {
  const rows = data?.rows || [];
  const total = data?.total || 0;
  const page = data?.page || 1;
  const perPage = data?.perPage || 25;
  const pages = Math.max(Math.ceil(total / perPage), 1);
  const { q = '', state = 'all', plan = 'all', sort = 'traffic' } = filters;

  const link = (next) => {
    const params = new URLSearchParams();
    const merged = { q, state, plan, sort, ...next };
    for (const [k, v] of Object.entries(merged)) if (v && v !== 'all' && !(k === 'sort' && v === 'traffic')) params.set(k, v);
    const qs = params.toString();
    return `/admin/stores${qs ? `?${qs}` : ''}`;
  };

  const sortHead = (key, label, numeric = true) => `
    <th${numeric ? ' class="num"' : ''}${sort === key ? ' aria-sort="descending"' : ''}>
      <a href="${esc(link({ sort: key, page: undefined }))}"${sort === key ? ' class="sorted"' : ''}>${esc(label)}${
    sort === key ? ' <span aria-hidden="true">↓</span>' : ''}</a>
    </th>`;

  const stateChip = (st) => pill(st, st === 'approved' ? 'success' : st === 'restricted' ? 'warning' : st === 'pending' ? '' : 'danger');

  return adminShell({
    user, consent, current: 'stores', title: 'Stores',
    lede: 'Everything published, with the numbers an operator needs to judge it. Search reaches the owner\'s name and email.',
    actions: canExport
      ? `<a class="btn btn-sm" href="${esc(link({ format: 'csv', page: undefined }))}">Download CSV</a>`
      : '',
    body: `
${flash ? `<div class="note note-${flash.kind}" style="margin-top:var(--space-6)" role="status">${esc(flash.message)}</div>` : ''}

<section class="section">
  <form class="filters" method="get" action="/admin/stores" role="search">
    <div class="field" style="flex:2 1 260px">
      <label for="q">Search</label>
      <input class="input" id="q" name="q" type="search" value="${esc(q)}" placeholder="Store, slug, owner name or email">
    </div>
    <div class="field">
      <label for="state">State</label>
      <select class="input" id="state" name="state">
        ${[['all', 'Any state'], ['approved', 'Approved'], ['held', 'Held or hidden'], ['restricted', 'Restricted'], ['suspended', 'Suspended'], ['removed', 'Removed']]
    .map(([v, l]) => `<option value="${v}"${state === v ? ' selected' : ''}>${l}</option>`).join('')}
      </select>
    </div>
    <div class="field">
      <label for="plan">Plan</label>
      <select class="input" id="plan" name="plan">
        ${[['all', 'Any plan'], ['paid', 'Paying'], ['free', 'Free']]
    .map(([v, l]) => `<option value="${v}"${plan === v ? ' selected' : ''}>${l}</option>`).join('')}
      </select>
    </div>
    <input type="hidden" name="sort" value="${esc(sort)}">
    <div class="filters-foot">
      <button class="btn btn-primary" type="submit">Apply</button>
      ${(q || state !== 'all' || plan !== 'all')
    ? `<a class="btn btn-sm" href="/admin/stores">Clear</a>` : ''}
    </div>
  </form>

  <div class="section-head" style="margin-top:var(--space-6)">
    <h2>${total ? `${num(total)} store${total === 1 ? '' : 's'}` : 'No store matches'}</h2>
    <p>${total
    ? `Page ${num(page)} of ${num(pages)}${sort === 'traffic' ? ' · busiest first' : ''}`
    : 'Clear the filters, or search for a different word — the search looks at names, slugs, owner names and owner emails.'}</p>
  </div>

  ${rows.length ? `
  <div class="panel"><div class="panel-body panel-body-flush">
    <table class="table table-directory">
      <thead>
        <tr>
          <th>Store</th>
          <th>State</th>
          <th>Plan</th>
          ${sortHead('files', 'Files')}
          ${sortHead('traffic', 'Views · 30d')}
          ${sortHead('unlocks', 'Unlocks')}
          <th class="num">Ad views</th>
          <th>Last file</th>
        </tr>
      </thead>
      <tbody>${rows.map((r) => `
        <tr>
          <td>
            <a href="/admin/stores/${esc(r.slug)}"><strong>${esc(r.name)}</strong></a>
            <div class="fine">/s/${esc(r.slug)} · ${esc(r.owner_name || r.owner_email || 'no owner on file')}${
    r.listing_mode === 'marketplace' ? ' · listed' : ''} · <a href="/s/${esc(r.slug)}" target="_blank" rel="noopener">open store ↗</a></div>
          </td>
          <td>${stateChip(r.moderation_state)}${r.moderation_reason ? `<div class="fine">${esc(r.moderation_reason)}</div>` : ''}</td>
          <td>${r.plan_code === 'free' ? pill('Free', '') : pill(r.plan_code, 'accent')}${
    r.sub_status === 'grace' ? '<div class="fine">in grace</div>' : ''}</td>
          <td class="num">${num(r.files_live)}${r.files_total !== r.files_live ? `<div class="fine">of ${num(r.files_total)}</div>` : ''}</td>
          <td class="num">${num(r.views_30d)}</td>
          <td class="num">${num(r.unlocks)}${r.unlocks ? '' : '<div class="fine">none yet</div>'}</td>
          <td class="num">${num(r.ad_views_30d)}</td>
          <td class="fine">${r.last_file_at ? esc(relTime(r.last_file_at)) : '—'}</td>
        </tr>`).join('')}
      </tbody>
    </table>
  </div></div>
  ${pages > 1 ? `<nav class="pager" aria-label="Pages">
    ${page > 1 ? `<a class="btn btn-sm" href="${esc(link({ page: page - 1 }))}">← Newer</a>` : ''}
    <span class="fine">Page ${num(page)} of ${num(pages)}</span>
    ${page < pages ? `<a class="btn btn-sm" href="${esc(link({ page: page + 1 }))}">Older →</a>` : ''}
  </nav>` : ''}
  ` : `<div class="empty">
    ${q || state !== 'all' || plan !== 'all'
    ? 'Nothing matches those filters.'
    : 'No store has been created yet. The first one will appear here with its traffic and unlocks.'}
  </div>`}

  <p class="fine" style="margin-top:var(--space-5)">
    Views and unlocks are counted from our own tables, so they are exact. What a creator was PAID is not
    on this page on purpose: that number lives in the network's statement, not in our database.
  </p>
</section>`,
  });
}

/**
 * One store, everything about it.
 *
 * The console had a queue per problem and no page per SUBJECT: deciding whether
 * a report is the first sign of trouble or the third required four pages and a
 * good memory. This page assembles the evidence — who owns the store, what it
 * pays, what it published, what has been reported, and what has been decided
 * about it — and puts the decision form at the end of it, in context.
 *
 * The money panel is explicit about what it does NOT know. An operator looking at
 * a store will want to know what it earned, and the honest answer is that we do
 * not have that number: the network pays the creator directly, and the statement
 * belongs to them. Showing our own estimate beside real invoices would teach an
 * operator to trust the wrong figure.
 */
export function adminStoreDetail({ user, consent = null, flash = null, data = null, rules = [], actions = [], labels = {} }) {
  if (!data) {
    return adminShell({
      user, consent, current: 'stores', title: 'No such store',
      lede: 'Nothing is stored under that address. It may have been removed, or the address may be wrong.',
      body: `<section class="section"><a class="btn" href="/admin/stores">← Back to stores</a></section>`,
    });
  }
  const { channel: c, files, reports, invoice, history } = data;
  const openReports = reports.filter((r) => r.status === 'open');
  const options = (selected = null) => rules
    .map((r) => `<option value="${esc(r.code)}"${r.code === selected ? ' selected' : ''}>${esc(r.title)} (${esc(r.code)})</option>`)
    .join('');

  const reportRow = (r) => `
    <tr>
      <td>
        <strong>${esc(r.asset_title)}</strong>
        <div class="fine">/s/${esc(c.slug)}/a/${esc(r.asset_slug)} · file is ${esc(r.asset_status)}</div>
      </td>
      <td>${pill(r.reason, 'warning')}</td>
      <td class="num">${num(r.reporters)}</td>
      <td class="fine">${esc(relTime(r.created_at))}${r.note ? `<div>“${esc(r.note.slice(0, 120))}”</div>` : ''}</td>
      <td>${r.status === 'open' ? pill('open', 'warning') : pill(r.status, 'success')}</td>
    </tr>`;

  return adminShell({
    user, consent, current: 'stores',
    title: c.name,
    lede: `/s/${esc(c.slug)} — ${esc(c.tagline || 'no tagline')}`,
    actions: `<a class="btn btn-sm" href="/s/${esc(c.slug)}" target="_blank" rel="noopener">View store ↗</a>
      <a class="btn btn-sm" href="/admin/stores">All stores</a>`,
    body: `
${flash ? `<div class="note note-${flash.kind}" style="margin-top:var(--space-6)" role="status">${esc(flash.message)}</div>` : ''}

<section class="section">
  <div class="cols-2">
    <div class="panel"><div class="panel-body">
      <h2 style="font-size:var(--text-md)">The store</h2>
      <dl class="kv" style="margin-top:var(--space-4)">
        <dt>Owner</dt><dd>${esc(c.owner_name || 'no name')}<div class="fine">${esc(c.owner_email || 'no email on file')}</div></dd>
        <dt>Opened</dt><dd>${esc(relTime(c.created_at))}</dd>
        <dt>Listing</dt><dd>${c.listing_mode === 'marketplace' ? 'In the marketplace' : 'Unlisted — link only'}</dd>
        <dt>State</dt><dd>${pill(c.moderation_state, c.moderation_state === 'approved' ? 'success' : c.moderation_state === 'restricted' ? 'warning' : 'danger')}
          ${c.moderation_reason ? `<div class="fine">holds reason <span class="mono">${esc(c.moderation_reason)}</span></div>` : ''}</dd>
        <dt>Ad connections</dt><dd>${c.live_connections ? plural(c.live_connections, 'live connection') : 'none active'}</dd>
      </dl>
    </div></div>

    <div class="panel"><div class="panel-body">
      <h2 style="font-size:var(--text-md)">What it pays us</h2>
      <dl class="kv" style="margin-top:var(--space-4)">
        <dt>Plan</dt><dd>${c.plan_code === 'free' ? pill('Free', '') : pill(c.plan_code, 'accent')}${
    c.pending_plan_code ? `<div class="fine">requested ${esc(c.pending_plan_code)} — awaiting a matched transfer</div>` : ''}</dd>
        <dt>Subscription</dt><dd>${esc(c.sub_status || 'active')}${c.period_end ? `<div class="fine">through ${esc(isoDay(c.period_end))}</div>` : ''}</dd>
        <dt>Rent slot</dt><dd>${c.rent_slots
    ? `${plural(c.rent_slots, 'platform slot')}, ${plural(c.own_slots, "slot of the store's own")}`
    : 'none — the platform does not rent a slot here'}</dd>
        <dt>Latest invoice</dt><dd>${invoice
    ? `${npr(invoice.amount_npr)} · ${esc(invoice.status)}<div class="fine">${esc(isoDay(invoice.period_start))} to ${esc(isoDay(invoice.period_end))}</div>`
    : 'no invoice has been issued'}</dd>
      </dl>
      <p class="fine" style="margin-top:var(--space-4)">
        What the creator EARNED is not on this page, and not in our database: the ad network pays them
        directly. Their statement is the authority, not any figure of ours.
      </p>
    </div></div>
  </div>
</section>

<section class="section">
  <div class="section-head">
    <h2>Files</h2>
    <p>${files.length ? `${plural(files.length, 'file')} published. Unlocks and ad views are counted from our own tables.` : 'Nothing published yet.'}</p>
  </div>
  ${files.length ? `<div class="panel"><div class="panel-body panel-body-flush">
    <table class="table table-directory">
      <thead><tr>
        <th>File</th><th>State</th><th>Unlock</th>
        <th class="num">Unlocks</th><th class="num">Ad views</th><th class="num">Reports</th><th class="num">Rating</th>
      </tr></thead>
      <tbody>${files.map((f) => `
        <tr>
          <td>
            <a href="/s/${esc(c.slug)}/a/${esc(f.slug)}" target="_blank" rel="noopener"><strong>${esc(f.title)}</strong> ↗</a>
            <div class="fine">published ${esc(relTime(f.created_at))}</div>
          </td>
          <td>${pill(f.status, f.status === 'live' ? 'success' : '')}</td>
          <td>${pill(f.unlock_mode === 'ad' ? 'one rewarded ad' : f.unlock_mode, 'info')}</td>
          <td class="num">${num(f.unlocks)}</td>
          <td class="num">${num(f.ad_views)}</td>
          <td class="num">${f.open_reports ? `<strong>${num(f.open_reports)}</strong>` : num(f.reports_total)}</td>
          <td class="num">${Number(f.reviews) ? `${Number(f.rating).toFixed(1)}<div class="fine">${plural(f.reviews, 'review')}</div>` : '—'}</td>
        </tr>`).join('')}
      </tbody>
    </table>
  </div></div>` : '<div class="empty">This store has published nothing. There is nothing to moderate yet.</div>'}
</section>

<section class="section">
  <div class="section-head">
    <h2>Reports${openReports.length ? ` · ${num(openReports.length)} open` : ''}</h2>
    <p>Written by people holding an unlock. Reporters are not named here — a decision is about the file, not the complainant.</p>
  </div>
  ${reports.length ? `<div class="panel"><div class="panel-body panel-body-flush">
    <table class="table">
      <thead><tr><th>File</th><th>Reason</th><th class="num">Reporters</th><th>When</th><th>State</th></tr></thead>
      <tbody>${reports.map(reportRow).join('')}</tbody>
    </table>
  </div></div>` : '<div class="empty">Nothing has been reported on this store.</div>'}
</section>

<section class="section">
  <div class="section-head">
    <h2>Record a decision</h2>
    <p>A reason is a rule code, never a sentence. The seller reads the rule's own wording plus your remedy line.</p>
  </div>
  <div class="panel"><div class="panel-body">
    <form method="post" action="/admin/moderation/${esc(c.slug)}">
      <div class="row" style="align-items:flex-end;gap:var(--space-4);flex-wrap:wrap">
        <div class="field" style="flex:1 1 180px">
          <label for="action">Action</label>
          <select class="input" id="action" name="action">
            ${actions.map((a) => `<option value="${esc(a)}">${esc(labels[a] || a)}</option>`).join('')}
          </select>
        </div>
        <div class="field" style="flex:2 1 260px">
          <label for="ruleCode">Reason</label>
          <select class="input" id="ruleCode" name="ruleCode">
            <option value="">— none cited —</option>
            ${options(c.moderation_reason)}
          </select>
        </div>
      </div>
      <div class="field" style="margin-top:var(--space-4)">
        <label for="remedy">What should the seller do?</label>
        <input class="input" id="remedy" name="remedy" maxlength="280"
               placeholder="One line, in your own words. They read this and nothing else.">
      </div>
      <button class="btn btn-primary" type="submit" style="margin-top:var(--space-4)">Record decision</button>
    </form>
  </div></div>
</section>

<section class="section">
  <div class="section-head">
    <h2>What has been decided</h2>
    <p>Every audit row that names this store, newest first. <a href="/admin/audit">The whole log →</a></p>
  </div>
  <div class="panel"><div class="panel-body panel-body-flush">
    <table class="table">
      <thead><tr><th>When</th><th>Action</th><th>Who</th><th>Detail</th></tr></thead>
      <tbody>${history.length ? history.map((h) => `
        <tr>
          <td class="fine" style="white-space:nowrap">${esc(relTime(h.created_at))}</td>
          <td><span class="mono">${esc(h.action)}</span></td>
          <td class="fine">${esc(h.actor_name || h.actor_email || 'the platform')}</td>
          <td class="fine">${esc(briefMeta(h.meta))}</td>
        </tr>`).join('') : '<tr><td colspan="4" class="muted">Nothing has been recorded about this store yet.</td></tr>'}
      </tbody>
    </table>
  </div></div>
</section>`,
  });
}

/**
 * What creators were paid, against what we assume.
 *
 * The seller's earnings page already tells THEM whether our estimate matches
 * their statement, and it ends by asking them to report a gap so the rate can be
 * "corrected". There was nowhere for that correction to happen: the operator
 * could see payments bytebikri receives and nothing about the money the networks
 * pay creators directly.
 *
 * This page is the calibration. It answers one question the platform cannot
 * answer from its own data — is the assumed rate still right — and it is explicit
 * about the two things it will never show: a balance and a payout queue. We are
 * not party to the payment, so the only figure we have is one a creator typed in,
 * and the page says so above the table rather than in a footnote.
 *
 * The verdict function carries the direction and the CONFIDENCE separately, and
 * this page prints both: "we assume 2.1× the rate the statements imply" is a
 * finding, and "from one store" is the reason it is a signal rather than a
 * measurement.
 */
export function adminEarnings({
  user, consent = null, flash = null, rows = [], verdict = null, open = [], assumedRpmUsd = 0.2,
  usdToNpr = 133, canExport = true,
}) {
  const state = (row) => calibrationRowState(row);
  const toneFor = { no_views: 'warn', measurable: '' };
  const gapCell = (row) => {
    const st = state(row);
    if (st.state === 'no_views') {
      // A chip as well as the sentence: this column is scanned, and "Nothing to
      // measure" is the one state where a reader must not think a number is
      // missing because of a bug.
      return `${pill(st.label, 'warning')}<div class="fine">${esc(st.why)}</div>`;
    }
    if (st.state !== 'measurable') return `<span class="fine">${esc(st.label)}</span>`;
    const pct = st.gapPct;
    if (pct === null) return '<span class="fine">no rate to compare</span>';
    const within = Math.abs(pct) <= 15;
    return `${pill(`${pct > 0 ? '+' : ''}${pct}%`, within ? 'success' : 'warning')}
      <div class="fine">${pct > 0 ? 'we estimate higher' : 'we estimate lower'}</div>`;
  };

  return adminShell({
    user, consent, current: 'earnings', title: 'Creator earnings',
    lede: 'What the networks reported to creators, against the arithmetic this platform prices rent from. '
      + 'The statement is the authority; we never see the money.',
    actions: canExport ? '<a class="btn btn-sm" href="/admin/earnings?format=csv">Download CSV</a>' : '',
    body: `
${flash ? `<div class="note note-${flash.kind}" style="margin-top:var(--space-6)" role="status">${esc(flash.message)}</div>` : ''}

<section class="section">
  <div class="kpi-row">
    <div class="kpi kpi-hero${verdict.level === 'we_over' ? ' kpi-bad' : verdict.level === 'consistent' ? ' kpi-good' : ''}">
      <div class="kpi-value">${verdict.impliedRpmUsd === null
    ? '—'
    : `$${Number(verdict.impliedRpmUsd).toFixed(2)}`}</div>
      <div class="kpi-label">Per 1,000 views, implied by the statements</div>
      <div class="kpi-note">${verdict.impliedRpmUsd === null
    ? 'No statement yet carries a measurable window.'
    : `The rate we assume is $${Number(assumedRpmUsd).toFixed(2)}. Rent is proportional to it.`}</div>
    </div>
    <div class="kpi">
      <div class="kpi-value">${num(verdict.periods)}</div>
      <div class="kpi-label">Settled periods compared</div>
      <div class="kpi-note">${verdict.stores
    ? `Across ${plural(verdict.stores, 'store')}. A period in the last five days is not settled.`
    : 'Nothing settled yet.'}</div>
    </div>
    <div class="kpi">
      <div class="kpi-value">$${Number(verdict.totalReported || 0).toFixed(2)}</div>
      <div class="kpi-label">Reported by creators</div>
      <div class="kpi-note">Typed in by them from the network's portal. Not a balance we hold.</div>
    </div>
    <div class="kpi">
      <div class="kpi-value">$${Number(verdict.totalEstimate || 0).toFixed(4)}</div>
      <div class="kpi-label">Our estimate · same windows</div>
      <div class="kpi-note">Views inside those periods only, at the assumed rate.</div>
    </div>
  </div>

  <div class="note note-${verdict.level === 'consistent' ? 'success' : verdict.level === 'we_over' ? 'danger' : 'info'}"
       style="margin-top:var(--space-6)">
    <strong>${esc(verdict.headline)}.</strong> ${esc(verdict.detail)}
  </div>
</section>

${open.length ? `<section class="section">
  <div class="section-head">
    <h2>Not counted yet</h2>
    <p>A network closes its books a few days after the month ends, so these are shown and left out of every number above — never silently dropped.</p>
  </div>
  <div class="panel"><div class="panel-body panel-body-flush">
    <table class="table">
      <thead><tr><th>Store</th><th>Network</th><th>Period</th><th class="num">Reported</th><th>Why it is waiting</th></tr></thead>
      <tbody>${open.map((o) => `<tr>
        <td><a href="/admin/stores/${esc(o.channel_slug)}">${esc(o.channel_name)}</a></td>
        <td>${esc(o.provider_id)}</td>
        <td class="fine nowrap">${esc(isoDay(o.period_start))} → ${esc(isoDay(o.period_end))}</td>
        <td class="num">$${Number(o.reported_usd).toFixed(2)}</td>
        <td class="fine">${Number(o.days_since_end) < 0
    ? 'the period has not ended' : `ended ${plural(Number(o.days_since_end), 'day')} ago — under the five-day settling window`}</td>
      </tr>`).join('')}
      </tbody>
    </table>
  </div></div>
</section>` : ''}

<section class="section">
  <div class="section-head">
    <h2>Every statement on file</h2>
    <p>${rows.length
    ? 'One row per store and network, with our estimate measured over the SAME days the statement covers.'
    : 'Nothing has been recorded yet.'}</p>
  </div>
  ${rows.length ? `<div class="panel"><div class="panel-body panel-body-flush">
    <table class="table table-directory">
      <thead><tr>
        <th>Store</th><th>Network</th><th>Window</th>
        <th class="num">Periods</th><th class="num">Views in window</th>
        <th class="num">Reported</th><th class="num">Our estimate</th><th class="num">Implied rate</th><th>Gap</th>
      </tr></thead>
      <tbody>${rows.map((r) => `<tr>
        <td>
          <a href="/admin/stores/${esc(r.channel_slug)}"><strong>${esc(r.channel_name)}</strong></a>
          <div class="fine">${esc(r.owner_email || 'no owner on file')}</div>
        </td>
        <td>${esc(r.provider_id)}</td>
        <td class="fine nowrap">${esc(isoDay(r.first_period_start))} → ${esc(isoDay(r.last_period_end))}</td>
        <td class="num">${num(r.periods)}</td>
        <td class="num">${num(r.views)}${Number(r.views) === 0 ? '<div class="fine">none recorded</div>' : ''}</td>
        <td class="num">$${Number(r.reported_usd).toFixed(2)}</td>
        <td class="num">$${Number(r.estimate_usd).toFixed(4)}</td>
        <td class="num">${r.implied_rpm_usd === null ? '—' : `$${Number(r.implied_rpm_usd).toFixed(2)}`}</td>
        <td>${gapCell(r)}</td>
      </tr>`).join('')}
      </tbody>
    </table>
  </div></div>`
    : `<div class="empty">
        No creator has pasted a figure from their network portal yet. Until one does, the assumed rate is unchecked —
        and this page cannot compute it from our own data, because the network pays the creator directly and we are not a
        party to that payment.
      </div>`}
</section>

<section class="section">
  <div class="cols-2">
    <div class="panel"><div class="panel-body">
      <h2 style="font-size:var(--text-md)">What correcting it would change</h2>
      <p class="small" style="margin-top:var(--space-3)">
        Rent is twelve months of the platform slot's value, and that value is arithmetic on the assumed rate:
      </p>
      <p class="mono small" style="margin:var(--space-3) 0">
        pageviews ÷ 1,000 × rent slot × $${Number(assumedRpmUsd).toFixed(2)} × ${Number(usdToNpr)} NPR/USD × 12
      </p>
      <p class="small">
        The assumed rate lives in one place — <span class="mono">POLICY.assumedRpmUsd</span> — read by the rent estimate,
        the seller's earnings page and this page, so a correction moves all three together. Nothing else is priced from
        a creator's earnings, and nothing is charged as a share of them.
      </p>
      <p class="small">
        Invoices already issued stand. A rate change applies to the next period, not to a charge somebody has already
        been told to pay.
      </p>
    </div></div>

    <div class="panel"><div class="panel-body">
      <h2 style="font-size:var(--text-md)">What this page will never show</h2>
      <dl class="kv" style="margin-top:var(--space-4)">
        <dt>A balance</dt><dd>Nothing of a creator's ever passes through us, so there is no balance to display.</dd>
        <dt>A payout queue</dt><dd>The network pays them on its own schedule, to their own account, at its own threshold.</dd>
        <dt>Their true figure</dt><dd>Only what they chose to enter. A creator who never records a statement is invisible here, and that is their call.</dd>
      </dl>
    </div></div>
  </div>
</section>`,
  });
}

export function adminReports({ user, consent = null, flash = null, rows = [], ruleTitles = {} }) {
  const row = (r) => {
    const verdict = reportVerdict({ reporters: r.reporters, byReason: r.byReason });
    const reasons = Object.entries(r.byReason).sort((a, b) => b[1] - a[1])
      .map(([code, n]) => `${ruleTitles[code] || code} ×${n}`).join(' · ');
    return `
    <div class="report-row panel">
      <div class="panel-head">
        <a href="/s/${esc(r.channel_slug)}/a/${esc(r.asset_slug)}" target="_blank" rel="noopener"><strong>${esc(r.title)}</strong></a>
        <span class="fine">/s/${esc(r.channel_slug)}</span>
        <span class="spacer"></span>
        ${verdict.autoHide
          ? pill('Hidden while it is reviewed', 'warning')
          : pill(`Live · ${verdict.reporters} of ${AUTO_HIDE_AFTER} to auto-hide`, '')}
      </div>
      <div class="panel-body">
        <p class="small" style="margin:0"><strong>${esc(verdict.summary)}</strong></p>
        <p class="fine" style="margin:var(--space-2) 0 0">${esc(reasons)}${r.with_notes ? ` · ${r.with_notes} with a note` : ''}
          · first ${esc(relTime(r.first_at))}, latest ${esc(relTime(r.latest))}</p>
        ${r.notes && r.notes.length ? `<ul class="list-plain" style="margin-top:var(--space-3)">
          ${r.notes.map((nt) => `<li class="fine">${esc(nt.note)}</li>`).join('')}
        </ul>` : ''}
        <div class="row" style="margin-top:var(--space-4);gap:var(--space-3)">
          <form method="post" action="/admin/reports/${esc(r.asset_id)}">
            <input type="hidden" name="action" value="actioned">
            <button class="btn btn-sm btn-primary" type="submit">Act — remove the file</button>
          </form>
          <form method="post" action="/admin/reports/${esc(r.asset_id)}">
            <input type="hidden" name="action" value="dismissed">
            <button class="btn btn-sm" type="submit">Dismiss — the file is fine</button>
          </form>
          <span class="fine">Removing the file cites the rule and writes nothing to the seller's account.</span>
        </div>
      </div>
    </div>`;
  };

  return adminShell({
    user, consent, current: 'reports', title: 'Reports',
    lede: `A report is a claim, not a verdict. ${AUTO_HIDE_AFTER} distinct reporters hide a file while it waits; one never does.`,
    body: `
${flash ? `<div class="note note-${flash.kind}" style="margin-top:var(--space-6)" role="status">${esc(flash.message)}</div>` : ''}
<section class="section">
  <div class="section-head">
    <h2>Open</h2>
    <p>${plural(rows.length, 'file')} reported, ordered by how many people said it.</p>
  </div>
  ${rows.length ? rows.map(row).join('') : '<div class="empty">Nothing has been reported.</div>'}
</section>`,
  });
}

/** The audit log: a filter and a table, because that is all it is. */
/**
 * Audit metadata, written the way a person would read it out.
 *
 * The first version printed `JSON.stringify(meta).slice(0, 120)`, which produced
 * things like `{"channelId":"c6326d55-1cb6-43cb-8e8d-b2cc17ed2e0f","plan":"pro"}`
 * — half a UUID, no currency, and a field order that came from object insertion
 * rather than from what matters. Ids are shortened to a fingerprint that is
 * still searchable, money gets a currency and thousands separators, booleans
 * become yes/no, and the fields that describe a decision come first.
 */
const AUDIT_LABELS = {
  plan: 'plan', planCode: 'plan', channelId: 'store', channelSlug: 'store', slug: 'store',
  assetId: 'file', assetSlug: 'file', paymentId: 'payment', invoiceId: 'invoice',
  connectionId: 'connection', creativeId: 'ad', slotKey: 'slot', amountNpr: 'amount',
  txnReference: 'reference', reference: 'reference', method: 'method', ruleCode: 'rule',
  state: 'state', from: 'was', to: 'now', reason: 'reason', provider: 'network',
  days: 'days', email: 'email', kind: 'kind', outcome: 'outcome', count: 'count',
};
const AUDIT_ORDER = ['channelSlug', 'channelId', 'slug', 'email', 'plan', 'planCode', 'kind',
  'from', 'to', 'state', 'ruleCode', 'reason', 'provider', 'slotKey', 'assetSlug', 'assetId',
  'paymentId', 'invoiceId', 'connectionId', 'method', 'amountNpr', 'txnReference', 'reference'];

function auditValue(key, value, nprFmt) {
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  if (key === 'amountNpr' || key === 'amount') return nprFmt(Number(value));
  if (key === 'days') return `${value} days`;
  const str = String(value);
  if (/^\d{4}-\d{2}-\d{2}T/.test(str)) return relTime(str);
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-/.test(str)) return str.slice(0, 8);
  return str.length > 48 ? `${str.slice(0, 47)}…` : str;
}

export function briefMeta(meta) {
  if (!meta) return '';
  let value = meta;
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch { return value.slice(0, 140); }
  }
  if (typeof value !== 'object' || value === null) return String(value).slice(0, 140);
  const entries = Object.entries(value).filter(([, v]) => v !== null && v !== undefined && v !== '');
  entries.sort((a, b) => {
    const ia = AUDIT_ORDER.indexOf(a[0]); const ib = AUDIT_ORDER.indexOf(b[0]);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  return entries.map(([k, v]) => `${AUDIT_LABELS[k] || k} ${auditValue(k, v, npr)}`).join(' · ').slice(0, 220);
}

export function adminAudit({ user, consent = null, rows = [], q = '', total = 0 }) {
  const filtered = q ? rows.filter((r) => String(r.action).includes(q)) : rows;
  return adminShell({
    user, consent, current: 'audit', title: 'Audit log',
    lede: 'Every state change that mattered, with who did it. Newest first.',
    actions: `<form class="search search-inline" method="get" action="/admin/audit" role="search">
      <label class="sr-only" for="q">Filter by action</label>
      <input class="input" id="q" name="q" type="search" value="${esc(q)}" placeholder="Filter by action, e.g. rent">
      <button class="btn" type="submit">Filter</button>
    </form>`,
    body: `
<section class="section">
  <div class="section-head">
    <h2>${q ? `Matching “${esc(q)}”` : 'Everything'}</h2>
    <p>${num(filtered.length)} of ${num(total)} rows</p>
  </div>
  <div class="panel"><div class="panel-body panel-body-flush">
    <table class="table">
      <thead><tr><th>When</th><th>Action</th><th>Who</th><th>Subject</th><th>Detail</th></tr></thead>
      <tbody>${filtered.map((a) => `
        <tr>
          <td class="fine" style="white-space:nowrap">${esc(new Date(a.created_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }))}</td>
          <td><span class="mono">${esc(a.action)}</span></td>
          <td class="fine">${esc(a.actor_name || a.actor_email || '—')}</td>
          <td class="fine mono">${esc(a.subject_type ? `${a.subject_type}` : '—')}</td>
          <td class="fine">${esc(briefMeta(a.meta))}</td>
        </tr>`).join('') || '<tr><td colspan="5" class="muted">No rows.</td></tr>'}
      </tbody>
    </table>
  </div></div>
</section>`,
  });
}

export function operatorBilling({ user, consent = null, flash = null, payments = [], invoices = [], payee = null, console = false }) {
  const payRows = payments.map((p) => `
    <tr>
      <td>
        <strong>${esc(p.channel_name)}</strong>
        <div class="fine">/s/${esc(p.channel_slug)} · ${esc(p.plan_code)}</div>
      </td>
      <td class="mono">${esc(p.txn_reference)}</td>
      <td>${esc(p.method)}${p.payer_name ? `<div class="fine">${esc(p.payer_name)}${p.payer_number ? ` · ${esc(p.payer_number)}` : ''}</div>` : ''}</td>
      <td class="num">${npr(p.amount_npr)}</td>
      <td class="fine">${relTime(p.created_at)}</td>
      <td>
        <form class="inline-form" method="post" action="/admin/payments/plan/${esc(p.id)}">
          <button class="btn btn-sm btn-primary" name="action" value="match" type="submit">Match</button>
          <button class="btn btn-sm btn-danger" name="action" value="reject" type="submit">Reject</button>
        </form>
      </td>
    </tr>`).join('');

  const rentRows = invoices.map((i) => `
    <tr>
      <td>
        <strong>${esc(i.channel_name)}</strong>
        <div class="fine">/s/${esc(i.channel_slug)}</div>
      </td>
      <td>${day(i.period_start)} → ${day(i.period_end)}</td>
      <td class="mono">${esc(i.txn_reference || '—')}</td>
      <td class="num">${npr(i.amount_npr)}</td>
      <td>${pill(i.status, i.status === 'submitted' ? 'info' : 'warning')}</td>
      <td>
        <form class="inline-form" method="post" action="/admin/payments/rent/${esc(i.id)}">
          <button class="btn btn-sm btn-primary" type="submit">Mark paid</button>
        </form>
      </td>
    </tr>`).join('');

  const body = `
<div class="section" style="margin-block:var(--space-8) var(--space-2)">
  <h1 style="font-size:var(--text-2xl)">Billing queue</h1>
  <p class="lede" style="margin-top:var(--space-4)">
    Both of these are matched against the platform's own statement by hand.
    ${payee ? `Money arrives in the name of <strong>${esc(payee)}</strong>.` : '<strong>No payee name is configured</strong> — set <span class="mono">OPERATOR_LEGAL_NAME</span>.'}
    Matching an upgrade activates the subscription; it is the only thing that does.
  </p>
</div>
${flashNote(flash)}

<section class="section">
  <div class="section-head"><h2>Upgrades waiting</h2><p>${plural(payments.length, 'payment')}</p></div>
  ${payments.length ? `
    <div class="panel"><div class="panel-body panel-body-flush">
      <table class="table">
        <thead><tr><th>Store</th><th>Reference</th><th>Method</th><th class="num">Amount</th><th>When</th><th></th></tr></thead>
        <tbody>${payRows}</tbody>
      </table>
    </div></div>`
    : '<div class="empty">Nothing waiting. Upgrades only appear here once a seller has submitted a reference.</div>'}
</section>

<section class="section">
  <div class="section-head"><h2>Rent outstanding</h2><p>${plural(invoices.length, 'invoice')}</p></div>
  ${invoices.length ? `
    <div class="panel"><div class="panel-body panel-body-flush">
      <table class="table">
        <thead><tr><th>Store</th><th>Period</th><th>Reference</th><th class="num">Amount</th><th>State</th><th></th></tr></thead>
        <tbody>${rentRows}</tbody>
      </table>
    </div></div>`
    : '<div class="empty">Nothing outstanding. Rent invoices are only issued where a page is long enough to spare a slot.</div>'}
</section>`;

  // Rendered inside the console shell now, so the operator keeps one frame of
  // reference: the same navigation, the same badge counts, the same title style.
  return console
    ? adminShell({ user, consent, current: 'payments', title: 'Payments', lede: 'Every transfer a person has to match against the statement.', body, flash })
    : layout({ title: 'Billing queue', user, consent, current: 'admin', body });
}

// ---------------------------------------------------------------------------
// Earnings — whose money, and who is holding it
// ---------------------------------------------------------------------------

/**
 * The page where a creator finds out how they get paid.
 *
 * It leads with the counterparty, not the number, because that is the fact a
 * creator has to understand: the money on this page is being paid by an ad
 * network into their account, and bytebikri is not in the path. A dashboard that
 * puts a dollar figure at the top and mentions the payer in a footnote is how
 * people come to believe a platform is holding their earnings.
 *
 * The two numbers that can appear here are deliberately kept apart:
 *
 *   our estimate — arithmetic, `completed views ÷ 1000 × assumed rate`
 *   their report — a figure the creator pasted from the network's statement
 *
 * When they disagree the network is right, and the page says which direction it
 * disagrees in, because rent is priced from the same model that produced the
 * estimate.
 */
export function earnings({
  channel, user, consent = null, flash = null, summary, byAsset = [], days = 30,
  connections = [], providers = [], suggestions = [], sandboxIds = [], payoutAccounts = [], reports = [], rent = null, plan = null,
  usdToNpr = 133, moneyMap, checklist = [], rpmUsd = 0.2,
}) {
  const accountOf = (id) => payoutAccounts.find((p) => p.provider_id === id) || null;

  const providerRows = summary.lines.map((l) => {
    const account = accountOf(l.providerId);
    const provider = providers.find((p) => p.id === l.providerId);
    const verdict = provider?.verdict || null;
    const gapPill = l.reported === null
      ? pill('no statement yet')
      : l.verdict.level === 'consistent' ? pill('matches', 'success')
        : l.verdict.level === 'we_over' ? pill('we count higher', 'warning')
          : l.verdict.level === 'we_under' ? pill('statement higher', 'info')
            : pill('disagrees', 'danger');

    return `<tr>
      <td>
        <strong>${esc(l.providerName)}</strong>
        ${provider ? `<div class="fine">${verdict?.usableMethods?.length
          ? `Pays out via ${esc(verdict.usableMethods.join(', '))}`
          : esc(verdict?.message || '')}</div>` : ''}
      </td>
      <td class="num">${num(l.views)}</td>
      <td class="num">$${l.estimateUsd.toFixed(2)}
        ${l.postbackUsd > 0 ? `<div class="fine">$${l.postbackUsd.toFixed(2)} in postbacks</div>` : ''}</td>
      <td class="num">${l.reported === null ? '—' : `$${l.reported.toFixed(2)}`}</td>
      <td>${gapPill}</td>
      <td>${account
        ? `<div class="small">${esc(account.account_label)}</div>
           <div class="fine">${esc(account.payout_method || 'method not noted')}${
    account.status === 'changed' ? ' · you said this changed' : ''}</div>`
        : `<span class="fine">Not recorded — and we do not need it. It is your account at the network.</span>`}</td>
    </tr>`;
  }).join('');

  const assetRows = byAsset.slice(0, 12).map((a) => `
    <tr>
      <td>
        <a href="/s/${esc(channel.slug)}/a/${esc(a.slug)}">${esc(a.title)}</a>
        ${a.status !== 'live' ? `<div class="fine">${esc(a.status)}</div>` : ''}
      </td>
      <td class="num">${num(a.unlocks)}</td>
      <td class="num">${num(a.views)}</td>
      <td class="num">$${Number(a.estimate_usd).toFixed(2)}</td>
    </tr>`).join('');

  const connectedIds = new Set(connections.map((c) => c.provider_id));
  const unconnected = suggestions.filter((p) => !connectedIds.has(p.id)).slice(0, 4);

  const reportForm = `
<form class="card card-pad-lg" method="post" action="/dashboard/${esc(channel.slug)}/earnings/report">
  <h3 style="margin-top:0">Paste your statement figure</h3>
  <p class="small">One closed period from one network. This is the only way our estimate can be
  checked against reality — and the only evidence that would correct the traffic model your rent is
  priced from.</p>
  <div class="row" style="gap:var(--space-4);align-items:flex-start">
    <div class="field" style="flex:2 1 200px">
      <label for="rp-provider">Network</label>
      <select class="input" id="rp-provider" name="providerId">
        ${summary.lines.filter((l) => !sandboxIds.includes(l.providerId))
    .map((l) => `<option value="${esc(l.providerId)}">${esc(l.providerName)}</option>`).join('')}
        <option value="other">Another network</option>
      </select>
    </div>
    <div class="field" style="flex:1 1 140px">
      <label for="rp-start">Period start</label>
      <input class="input" id="rp-start" name="periodStart" type="date" required>
    </div>
    <div class="field" style="flex:1 1 140px">
      <label for="rp-end">Period end</label>
      <input class="input" id="rp-end" name="periodEnd" type="date" required>
    </div>
    <div class="field" style="flex:1 1 140px">
      <label for="rp-usd">Statement total (USD)</label>
      <input class="input" id="rp-usd" name="reportedUsd" type="number" min="0" step="0.01" required>
      <span class="hint">As printed. Not converted, not rounded up.</span>
    </div>
  </div>
  <button class="btn" type="submit">Save the figure</button>
  <p class="fine" style="margin-top:var(--space-3)">
    Nothing is paid from this form and nothing changes hands. It records what the statement said.
  </p>
</form>`;

  const reportHistory = reports.length
    ? `<div class="panel" style="margin-top:var(--space-6)"><div class="panel-body panel-body-flush">
        <table class="table">
          <thead><tr><th>Network</th><th>Period</th><th class="num">Statement</th><th>Counted?</th></tr></thead>
          <tbody>${reports.map((r) => `<tr>
            <td>${esc(r.provider_id)}</td>
            <td>${day(r.period_start)} → ${day(r.period_end)}</td>
            <td class="num">$${Number(r.reported_usd).toFixed(2)}</td>
            <td>${r.closed ? pill('yes', 'success') : pill('not closed yet', 'info')}</td>
          </tr>`).join('')}</tbody>
        </table>
      </div></div>`
    : '';

  return layout({
    title: 'Earnings', user, activeChannel: channel, consent, current: 'dashboard',
    body: `
${pageHead(channel, 'earnings', 'Earnings', `Where the money goes, and who is holding it.
      It is not us.`)}

${flashNote(flash)}

<div class="section">
  <div class="cols-2">
    <div class="panel panel-creator">
      <div class="panel-head">
        <h2>${esc(moneyMap.toCreator.label)}</h2>
        <span class="spacer"></span>
        ${pill(moneyMap.toCreator.cut, 'success')}
      </div>
      <div class="panel-body">
        <p class="small">${esc(moneyMap.toCreator.detail)}</p>
        <dl class="kv" style="margin-top:var(--space-4)">
          <dt>Paid by</dt><dd>${esc(moneyMap.toCreator.payer)}</dd>
          <dt>Into</dt><dd>${esc(moneyMap.toCreator.account)}</dd>
          <dt>Held by bytebikri</dt><dd><strong>${esc(moneyMap.toCreator.held)}</strong></dd>
        </dl>
        <div class="amount-line">
          <span>What the network reported, ${plural(days, 'day')}</span>
          <strong>${summary.reportedTotal === null ? '—' : `$${summary.reportedTotal.toFixed(2)}`}</strong>
        </div>
        <p class="fine">${esc(summary.headline.headline)}. ${esc(summary.headline.detail)}</p>
      </div>
    </div>

    <div class="panel">
      <div class="panel-head">
        <h2>${esc(moneyMap.toPlatform.label)}</h2>
        <span class="spacer"></span>
        ${pill(moneyMap.toPlatform.cut, 'accent')}
      </div>
      <div class="panel-body">
        <p class="small">${esc(moneyMap.toPlatform.detail)}</p>
        <dl class="kv" style="margin-top:var(--space-4)">
          <dt>Plan</dt><dd>${esc(plan?.name || 'Free')}</dd>
          <dt>Rent</dt><dd>${rent && Number(rent.amount_npr)
    ? `${npr(rent.amount_npr)} · ${esc(rent.status)}`
    : 'Nothing due — no rentable traffic'}</dd>
          <dt>Our share of your ad earnings</dt><dd><strong>0%</strong></dd>
        </dl>
        ${summary.rent ? `<div class="amount-line">
          <span>Rent as a share of reported earnings</span>
          <strong>${summary.rent.pct === null ? '—' : `${summary.rent.pct}%`}</strong>
        </div>
        <p class="fine">${esc(summary.rent.sentence)}</p>` : ''}
      </div>
    </div>
  </div>

  <div class="panel" style="margin-top:var(--space-6)">
    <div class="panel-head">
      <h2>Our estimate, next to the statement</h2>
      <span class="spacer"></span>
      <span class="fine">assumed $${Number(rpmUsd).toFixed(2)} per 1,000 views</span>
    </div>
    <div class="panel-body panel-body-flush">
      <table class="table">
        <thead><tr>
          <th>Network</th><th class="num">Views</th><th class="num">Our estimate</th>
          <th class="num">Statement</th><th>Verdict</th><th>Your account there</th>
        </tr></thead>
        <tbody>${providerRows || '<tr><td colspan="6" class="muted">No completed ad views in this window yet — there is nothing for a network to pay.</td></tr>'}</tbody>
      </table>
    </div>
    <div class="panel-body">
      <p class="fine">
        The estimate is arithmetic on the rate above. The statement is what you told us the network
        said. Where they disagree, the network is right — and the same traffic model prices your rent,
        so an over-estimate is the direction that costs you.
      </p>
    </div>
  </div>

  <div class="panel" style="margin-top:var(--space-6)">
    <div class="panel-head"><h2>Which files earn</h2>
      <span class="spacer"></span><span class="fine">last ${num(days)} days</span></div>
    <div class="panel-body panel-body-flush">
      <table class="table">
        <thead><tr><th>File</th><th class="num">Unlocks</th><th class="num">Ad views</th><th class="num">Est.</th></tr></thead>
        <tbody>${assetRows || '<tr><td colspan="4" class="muted">Nothing published yet.</td></tr>'}</tbody>
      </table>
    </div>
    <div class="panel-body">
      <p class="fine">
        Unlocks are our count of “somebody watched an ad for this file”. Views are the network’s count
        of the same event. They usually differ, and the difference is worth a look if it is large.
      </p>
    </div>
  </div>

  <section class="section">
    <div class="section-head">
      <h2>Your accounts at the networks</h2>
      <p>The account has to be yours. We record which one so you can find it again — never a number
      we could use.</p>
    </div>
    ${connections.length ? `<div class="panel"><div class="panel-body panel-body-flush">
      <table class="table">
        <thead><tr><th>Network</th><th>Your account</th><th>Payout method</th><th></th></tr></thead>
        <tbody>${connections.map((c) => {
    const account = accountOf(c.provider_id);
    const provider = providers.find((p) => p.id === c.provider_id);
    const verdict = provider?.verdict || null;
    // The sandbox network exists so the unlock loop can run with no
    // credentials. It pays nobody, so it gets no payout field: asking a creator
    // which of their accounts our own test provider pays into is the kind of
    // row that makes a page feel auto-generated.
    if (verdict?.level === 'unknown' && sandboxIds.includes(c.provider_id)) {
      return `<tr>
            <td><strong>${esc(provider?.name || c.provider_id)}</strong></td>
            <td colspan="3" class="fine">Sandbox network — it completes the unlock loop with no
              credentials and pays nobody. There is nothing to record.</td>
          </tr>`;
    }
    return `<tr>
            <td><strong>${esc(provider?.name || c.provider_id)}</strong>
              ${verdict?.thresholdLabel && verdict.level !== 'unknown'
    ? `<div class="fine">Threshold ${esc(verdict.thresholdLabel)}</div>` : ''}</td>
            <td>
              <form class="inline-form" method="post" action="/dashboard/${esc(channel.slug)}/earnings/payout">
                <input type="hidden" name="providerId" value="${esc(c.provider_id)}">
                <input class="input input-sm" name="accountLabel" maxlength="120" required
                       placeholder="e.g. Payoneer ending 4417" value="${esc(account?.account_label || '')}">
                <input class="input input-sm" name="payoutMethod" maxlength="60"
                       placeholder="method" value="${esc(account?.payout_method || '')}">
                <button class="btn btn-sm" type="submit">Save</button>
              </form>
            </td>
            <td class="fine">${account
      ? (account.status === 'changed' ? 'You said this changed' : 'On file')
      : 'Not recorded'}</td>
            <td class="fine">Only you can see this. It is not the network's record and we cannot check it.</td>
          </tr>`;
  }).join('')}</tbody>
      </table>
    </div></div>` : `<div class="empty">No network connected yet, so nothing is being served and
      nothing can be earned. Connect one first — the account you connect is your own.</div>`}
  </section>

  <div class="cols-2" style="margin-top:var(--space-6)">
    <div>
      ${reportForm}
      ${reportHistory}
    </div>

    <div class="panel">
      <div class="panel-head"><h2>Before the network pays you</h2></div>
      <div class="panel-body">
        <ol class="list-steps">
          ${checklist.map((step) => `<li>${esc(step)}</li>`).join('')}
        </ol>
        <p class="fine" style="margin-top:var(--space-4)">
          None of this passes through bytebikri. There is no balance on this page, no withdrawal
          button and no minimum: the money is between you, the network and your own bank.
        </p>
      </div>
    </div>
  </div>

  ${unconnected.length ? `<section class="section">
    <div class="section-head"><h2>Networks you could add</h2>
      <p>Every one of these pays the creator directly. None of them pays bytebikri.</p></div>
    <div class="panel"><div class="panel-body panel-body-flush">
      <table class="table">
        <thead><tr><th>Network</th><th>Reachable from Nepal</th><th class="num">Minimum</th></tr></thead>
        <tbody>${unconnected.map((p) => `<tr>
          <td><strong>${esc(p.name)}</strong>${p.note ? `<div class="fine">${esc(p.note)}</div>` : ''}</td>
          <td>${pill(p.verdict.level, p.verdict.level === 'ok' ? 'success' : p.verdict.level === 'caution' ? 'warning' : '')}</td>
          <td class="num">${p.verdict.thresholdLabel ? esc(p.verdict.thresholdLabel) : '—'}</td>
        </tr>`).join('')}</tbody>
      </table>
    </div></div>
  </section>` : ''}
</div>`,
  });
}
