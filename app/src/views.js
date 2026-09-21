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

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const npr = (n) => `NPR ${Number(n).toLocaleString('en-IN')}`;

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

export function layout({ title, user, body, activeChannel = null, wide = false, current = '', consent = null }) {
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
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark light">
<title>${esc(title)} · ByteBikri</title>
<meta name="description" content="Watch an ad, unlock the file. Creators keep their own ad revenue.">
<link rel="stylesheet" href="/styles.css">
</head>
<body>
<a class="skip-link" href="#main">Skip to content</a>
<header class="header">
  <div class="wrap">
    <a class="brand" href="/"><span class="brand-mark">B</span> ByteBikri</a>
    <nav class="nav" aria-label="Main">
      ${navLink('/marketplace', 'Explore', 'marketplace')}
      ${activeChannel ? navLink(`/dashboard/${esc(activeChannel.slug)}`, 'Dashboard', 'dashboard') : ''}
      ${user?.role === 'admin' ? navLink('/admin/billing', 'Billing queue', 'admin') : ''}
    </nav>
    <span class="spacer"></span>
    ${account}
  </div>
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

export function landing({ channels, user, stats, consent = null }) {
  const featured = channels.slice(0, 6).map(channelCard).join('');
  return layout({
    title: 'Content that unlocks with attention',
    user, current: 'home', consent,
    body: `
<section class="hero">
  <span class="pill pill-accent pill-lg">Ad-gated access</span>
  <h1 style="margin-top:var(--space-5)">Watch a short ad.<br>Unlock the file.</h1>
  <p class="lede">Creators publish templates, photos, guides and sample packs. A visitor watches one
  rewarded ad to unlock a download — and the ad network pays <strong>the creator's own account</strong>
  directly. ByteBikri is not in that payment path and never holds the money.</p>
  <div class="hero-actions">
    <a class="btn btn-lg btn-primary" href="/marketplace">Explore stores</a>
    <a class="btn btn-lg" href="/signup">Open your store</a>
  </div>

  <div class="stat-row">
    <div class="stat"><div class="stat-value">${num(stats.channels)}</div><div class="stat-label">Stores</div></div>
    <div class="stat"><div class="stat-value">${num(stats.assets)}</div><div class="stat-label">Unlockable files</div></div>
    <div class="stat"><div class="stat-value">${num(stats.unlocks)}</div><div class="stat-label">Unlocks granted</div></div>
    <div class="stat"><div class="stat-value">0%</div><div class="stat-label">Cut of ad revenue</div></div>
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

<section class="section">
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
export function marketplace({ channels, user, consent = null, q = '', results = null }) {
  const listed = channels.filter((c) => c.listing_mode === 'marketplace');
  const searching = String(q || '').trim().length >= 2;

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
${searching ? '' : `<section class="section">
  <div class="section-head">
    <h2>Listed stores</h2>
    <p>${plural(listed.length, 'store')}</p>
  </div>
  ${listed.length
    ? `<div class="grid-channels">${listed.map(channelCard).join('')}</div>`
    : `<div class="empty">No store has listed itself yet. Every store still works at its own address —
        asking the creator you follow for theirs is the way in.</div>`}
</section>`}
`,
  });
}

export function storefront({ channel, assets, slots, user, estimate, pageviews, unlockedIds = new Set(), consent = null }) {
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
    body: `
${channel.banner_url
    ? `<div class="store-hero">
  <img class="store-banner" src="${esc(channel.banner_url)}" alt="" decoding="async">
</div>`
    : ''}
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

export function assetPage({
  channel, asset, files, unlocked, user, policy, slots, previewFile = null,
  markUri = '', markLabel = '', accessUntil = null, consent = null,
  reviews = [], reviewStats = {}, canReview = false, myReview = null, reviewError = null,
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

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

export function dashboard({
  channel, slots, connections, providers, plan, estimate, pageviews, adViews,
  upgrade, user, pendingPayments = [], flash = null, consent = null,
  assets = [], assetStats = [],
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

  const picker = providers.slice(0, 8).map((p) => {
    const v = p.payoutVerdict;
    const kind = v?.level === 'ok' ? 'success' : v?.level === 'caution' ? 'warning' : v?.level === 'blocked' ? 'danger' : '';
    return `<tr>
      <td><strong>${esc(p.name)}</strong>${p.note ? `<div class="fine">${esc(p.note)}</div>` : ''}</td>
      <td>${v ? pill(v.level, kind) : pill('unknown')}</td>
      <td class="num">${v?.thresholdLabel ? esc(v.thresholdLabel) : '—'}</td>
      <td>${p.enabled
        ? `<button class="btn btn-sm" data-connect="${esc(p.id)}">Connect</button>`
        : `<span class="fine">${esc(p.blockedReason || 'not enabled')}</span>`}</td>
    </tr>`;
  }).join('');

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

${flash ? `<div class="note note-${flash.kind}" style="margin-top:var(--space-6)" role="status">${esc(flash.message)}</div>` : ''}

<div class="stat-row" style="margin-top:var(--space-8)">
  <div class="stat"><div class="stat-value">${num(pageviews)}</div><div class="stat-label">Views · 30d</div></div>
  <div class="stat"><div class="stat-value">${num(adViews.length)}</div><div class="stat-label">Ad views</div></div>
  <div class="stat"><div class="stat-value">${num(estimate.unlocks || 0)}</div><div class="stat-label">Unlocks</div></div>
  <div class="stat"><div class="stat-value">$${earnings.toFixed(3)}</div><div class="stat-label">Est. earned</div></div>
</div>
<p class="fine" style="margin-top:var(--space-3)">
  Estimated earned is <strong>our</strong> figure from provider-reported revenue, not your statement.
  The network is the authority on what you were paid, and it pays your own account directly.
</p>

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
      <thead><tr><th>File</th><th>Access</th><th>State</th><th class="num">Unlocks</th><th class="num"></th></tr></thead>
      <tbody>${assets.map((a) => {
    const st = assetStats.find((x) => x.id === a.id) || { files: 0, unlocks: 0 };
    return `<tr>
        <td><strong>${esc(a.title)}</strong>
          <div class="fine">${esc(a.slug)} · ${plural(Number(st.files) || 0, 'file')}${
  a.unlock_mode === 'open' ? ' · open to everyone' : ''}</div></td>
        <td>${a.unlock_mode === 'open' ? pill('Free', 'success') : pill('Ad-gated', 'locked')}</td>
        <td>${a.status === 'paused'
    ? pill('Paused', 'warning')
    : a.status === 'removed' ? pill('Removed', 'danger') : pill('Live', 'success')}</td>
        <td class="num">${num(Number(st.unlocks) || 0)}</td>
        <td class="num"><a class="btn btn-sm" href="/dashboard/${esc(channel.slug)}/assets/${esc(a.id)}">Edit</a></td>
      </tr>`;
  }).join('')}</tbody>
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
      <button class="btn btn-sm btn-danger" data-revoke="${esc(conn.id)}">Disconnect</button>
    </div>
    ${provider ? `<dl class="kv" style="margin-top:var(--space-5)">
      <dt>Formats</dt><dd>${esc((provider.formats || []).join(', '))}</dd>
      <dt>Callback</dt><dd class="mono">/api/ads/postback/${esc(conn.provider_id)}/${esc(conn.id.slice(0, 8))}…</dd>
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
  <div class="section-head"><h2>Connect a network</h2>
    <p>Ranked by whether a Nepali creator can actually withdraw the money.</p></div>
  <div class="panel"><div class="panel-body panel-body-flush">
    <table class="table">
      <thead><tr><th>Network</th><th>Payout check</th><th class="num">Reachable at</th><th></th></tr></thead>
      <tbody>${picker}</tbody>
    </table>
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

  return `<aside class="${cls.join(' ')}" data-slot="${esc(slot.slotKey || slot.key || '')}"
       data-owner="${esc(owner)}" data-serving="${from === 'none' ? 'false' : 'true'}"
       data-adapter="${esc(slot.adapter || '')}" data-surface="${esc(slot.surface || 'web')}"
       style="min-height:${h}px" role="complementary" aria-label="${esc(slot.label || 'Advertisement')}">
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
    <table class="table" style="margin-top:var(--space-4)">
      <thead><tr><th>Parameter</th><th>Their macro</th><th>What it carries</th></tr></thead>
      <tbody>${onboarding.postback.params.map((p) => `<tr>
        <td class="mono">${esc(p.ours)}</td>
        <td class="mono">${esc(p.theirs || p.value || '—')}</td>
        <td class="small">${esc(p.note || '')}</td>
      </tr>`).join('')}</tbody>
    </table>` : ''}

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

export function operatorBilling({ user, consent = null, flash = null, payments = [], invoices = [], payee = null }) {
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
        <form class="inline-form" method="post" action="/admin/billing/plan/${esc(p.id)}">
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
        <form class="inline-form" method="post" action="/admin/billing/rent/${esc(i.id)}">
          <button class="btn btn-sm btn-primary" type="submit">Mark paid</button>
        </form>
      </td>
    </tr>`).join('');

  return layout({
    title: 'Billing queue', user, consent, current: 'admin',
    body: `
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
</section>`,
  });
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
          <dt>Held by bytebikri</dt><dd><strong>Nothing, ever</strong></dd>
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
