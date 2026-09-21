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

export function layout({ title, user, body, activeChannel = null, wide = false, current = '' }) {
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
    </nav>
    <span class="spacer"></span>
    ${account}
  </div>
</header>
<main id="main"${wide ? '' : ''} class="wrap">${body}</main>
<footer class="footer">
  <div class="wrap">
    <div class="row">
      <span>ByteBikri — the shop belongs to the creator.</span>
      <span class="row-tight">
        <a href="/legal/privacy" style="color:inherit">Privacy</a>
        <a href="/legal/terms" style="color:inherit">Terms</a>
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

export function landing({ channels, user, stats }) {
  const featured = channels.slice(0, 6).map(channelCard).join('');
  return layout({
    title: 'Content that unlocks with attention',
    user, current: 'home',
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
    <span>${num(c.asset_count || 0)} file${(c.asset_count || 0) === 1 ? '' : 's'}</span>
    <span>·</span>
    <span>${esc(c.plan_code || 'free')} plan</span>
  </div>
</a>`;
}

export function marketplace({ channels, user }) {
  const listed = channels.filter((c) => c.listing_mode === 'marketplace');
  const rest = channels.filter((c) => c.listing_mode !== 'marketplace');

  const section = (title, sub, items) => `
  <section class="section">
    <div class="section-head">
      <h2>${esc(title)}</h2>
      ${sub ? `<p>${esc(sub)}</p>` : ''}
    </div>
    ${items.length
      ? `<div class="grid-channels">${items.map(channelCard).join('')}</div>`
      : `<div class="empty">Nothing here yet.</div>`}
  </section>`;

  return layout({
    title: 'Explore', user, current: 'marketplace',
    body: `
<div class="section" style="margin-bottom:0">
  <h1>Explore</h1>
  <p class="lede" style="margin-top:var(--space-3)">Stores that chose to be listed in the marketplace,
  and the ones keeping to their own address.</p>
</div>
${section('Listed stores', 'Paid tiers can appear here.', listed)}
${section('Own address only', 'These stores exist at their link but are not listed.', rest)}`,
  });
}

export function storefront({ channel, assets, slots, user, estimate, pageviews, unlockedIds = new Set() }) {
  const cards = assets.map((a) => {
    const open = a.unlock_mode === 'open';
    const unlocked = open || (user && unlockedIds.has(a.id));
    const badge = open
      ? pill('Free', 'success')
      : unlocked ? pill('Unlocked', 'success') : pill('Ad-gated', 'locked');
    const glyphBadge = open ? '○' : unlocked ? '✓' : '🔒';
    return `<a class="asset" href="/s/${esc(channel.slug)}/a/${esc(a.slug)}">
  <div style="position:relative">
    ${thumb({ title: a.title, coverUrl: a.cover_url })}
    <span class="thumb-badge">${badge}</span>
    <span class="thumb-badge-r pill" title="${open ? 'Free' : unlocked ? 'Unlocked' : 'Locked'}">${glyphBadge}</span>
  </div>
  <div class="asset-body">
    <h3>${esc(a.title)}</h3>
    <p class="asset-desc">${esc(a.description || 'No description yet.')}</p>
    <div class="asset-foot">
      <span>${(a.files || []).length} file${(a.files || []).length === 1 ? '' : 's'}</span>
      <span>${open ? 'No ad needed' : `${a.ads_required} ad${a.ads_required === 1 ? '' : 's'} to unlock`}</span>
    </div>
  </div>
</a>`;
  }).join('');

  const slotHtml = slots.map(renderSlot).join('');

  return layout({
    title: channel.name, user, activeChannel: channel,
    body: `
${channel.banner_url
    ? `<div class="store-hero">
  <img class="store-banner" src="${esc(channel.banner_url)}" alt="" decoding="async">
</div>`
    : ''}
<div class="section" style="margin-bottom:0">
  <div class="row">
    <h1>${esc(channel.name)}</h1>
    ${channel.listing_mode === 'marketplace' ? pill('Listed', 'accent') : pill('Own address')}
  </div>
  <p class="lede" style="margin-top:var(--space-3)">${esc(channel.tagline || 'A store on ByteBikri.')}</p>
  <div class="row" style="margin-top:var(--space-5);font-size:var(--text-xs);color:var(--text-faint)">
    <span>${num(pageviews)} views in 30 days</span>
    <span>·</span>
    <span>${num(assets.length)} file${assets.length === 1 ? '' : 's'}</span>
  </div>
</div>

${slotHtml}

<section class="section">
  <div class="section-head">
    <h2>Files</h2>
    <p>${assets.length} in this store</p>
  </div>
  ${assets.length ? `<div class="grid-assets">${cards}</div>`
    : '<div class="empty">This store has not published anything yet.</div>'}
</section>`,
  });
}

// ---------------------------------------------------------------------------
// Asset page
// ---------------------------------------------------------------------------

export function assetPage({ channel, asset, files, unlocked, user, policy, slots }) {
  const open = asset.unlock_mode === 'open';
  const needsAd = !open && !unlocked;

  const downloads = unlocked
    ? `<ul class="dl-list">${files.map((f) => `
        <li class="dl-item">
          <span class="thumb" style="width:38px;height:38px;flex:none;border-radius:var(--radius-sm)" aria-hidden="true">
            <span class="thumb-glyph" style="font-size:14px">${esc((f.filename || '').split('.').pop().toUpperCase().slice(0, 4))}</span>
          </span>
          <span style="min-width:0">
            <span class="dl-name" style="display:block">${esc(f.filename)}</span>
            <span class="dl-meta">${(f.size_bytes / 1024).toFixed(1)} KB · ${esc(f.mime_type || 'file')}</span>
          </span>
          <span class="spacer"></span>
          <a class="btn btn-sm btn-primary" href="${esc(f.downloadUrl)}" download>Download</a>
        </li>`).join('')}</ul>
      <p class="fine" style="margin-top:var(--space-3)">Links were minted for you and expire in 10 minutes.
      They cannot be forwarded — the file is re-checked against your unlock on every request.</p>`
    : `<div class="locked-panel">
        <div class="locked-glyph" aria-hidden="true">🔒</div>
        <p class="small" style="margin:var(--space-3) 0 0">The download link appears here once you unlock.</p>
      </div>`;

  const actionBlock = open
    ? `<div class="note note-success">Free — no ad needed.</div>${downloads}`
    : unlocked
      ? `<div class="note note-success"><strong>Unlocked.</strong>
           ${assetUnlockExpiry(asset)}</div>${downloads}`
      : `<button class="btn btn-primary btn-lg" style="width:100%" id="unlock-btn"
                 data-asset="${esc(asset.id)}">
           Watch ${policy?.ads_required || 1} ad${(policy?.ads_required || 1) === 1 ? '' : 's'} to unlock
         </button>
         <p class="fine" style="margin-top:var(--space-3);text-align:center">
           About ${policy?.ad_min_seconds || 15} seconds. The unlock is granted only when the ad network
           confirms server-to-server that the view completed.
         </p>
         <div id="unlock-status" class="fine" role="status" aria-live="polite" style="margin-top:var(--space-3);text-align:center"></div>`;

  return layout({
    title: asset.title, user, activeChannel: channel,
    body: `
<a class="fine" href="/s/${esc(channel.slug)}" style="display:inline-block;margin-block:var(--space-6) var(--space-5)">← ${esc(channel.name)}</a>

<div class="asset-layout">
  <div class="stack">
    <div class="asset-hero">
      <div class="asset-hero-visual">
        ${asset.cover_url
          ? `<img src="${esc(asset.cover_url)}" alt="" style="width:100%;height:100%;object-fit:cover">`
          : `<span class="thumb-glyph" aria-hidden="true">${esc(glyph(asset.title))}</span>`}
      </div>
    </div>

    <div>
      <div class="row">
        <h1 style="font-size:var(--text-2xl)">${esc(asset.title)}</h1>
        ${open ? pill('Free', 'success') : unlocked ? pill('Unlocked', 'success') : pill('Ad-gated', 'locked')}
      </div>
      <p class="lede" style="margin-top:var(--space-4)">${esc(asset.description || 'No description yet.')}</p>
    </div>

    <div class="panel">
      <div class="panel-head"><h2>What you get</h2></div>
      <div class="panel-body">
        <dl class="kv">
          <dt>Files</dt><dd>${files.length}</dd>
          <dt>Access</dt><dd>${open ? 'Free' : `${policy?.ads_required || 1} rewarded ad`}</dd>
          <dt>Unlock lasts</dt><dd>${policy?.unlock_hours || 24} hours</dd>
          <dt>Store</dt><dd><a href="/s/${esc(channel.slug)}">${esc(channel.name)}</a></dd>
        </dl>
      </div>
    </div>

    ${slots.map(renderSlot).join('')}
  </div>

  <aside class="unlock-card">
    <div class="panel">
      <div class="panel-head"><h2 style="font-size:var(--text-md)">${unlocked ? 'Your download' : 'Unlock this file'}</h2></div>
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
      signed, and is verified on our side before the download link appears.
    </p>
  </div>
</div>`,
  });
}

function assetUnlockExpiry(asset) {
  return asset.expires_at
    ? ` Access until ${new Date(asset.expires_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}.`
    : ' Permanent access.';
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export function login({ user, error, next = '', email = '', mode = 'login' }) {
  const isSignup = mode === 'signup';
  const action = isSignup ? '/signup' : '/login';
  return layout({
    title: isSignup ? 'Open a store' : 'Sign in', user,
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

export function dashboard({ channel, slots, connections, providers, plan, estimate, pageviews, adViews, upgrade, user, pendingPayments = [], flash = null }) {
  const conn = connections[0] || null;
  const provider = conn ? providers.find((p) => p.id === conn.provider_id) : null;

  const slotRows = slots.map((s) => `
    <tr>
      <td><strong>${esc(s.label)}</strong><div class="fine">rank ${s.rank} of ${slots.length}</div></td>
      <td>${s.owner === 'platform' ? pill('Platform · rent', 'warning') : pill("Channel's own", 'info')}</td>
      <td>${s.serving
        ? pill('Serving', 'success')
        : pill('Reserved — empty', '')}</td>
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
    title: channel.name, user, activeChannel: channel, current: 'dashboard',
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
      <dt>Monthly traffic</dt><dd>${num(estimate.pageviews30d || pageviews)} views in 30 days</dd>
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
    <p>Where ads can appear. The platform takes one slot per page, last rank, never rank 1.</p></div>
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
    </dl>
    ${upgrade ? `
      <div class="note note-info" style="margin-top:var(--space-5)">
        Upgrade to <strong>${esc(upgrade.to.name)}</strong> — ${npr(upgrade.amountNpr)} pro-rated,
        ${upgrade.daysLeft} days left on this cycle.
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
export function renderSlot(slot) {
  const h = Math.min(slot.max_height_px || 250, 280);
  const owner = slot.owner === 'platform' ? 'platform' : 'channel';
  const cls = slot.serving ? `slot slot-serving slot-${owner === 'platform' ? 'platform' : 'channel'}` : 'slot';
  const label = owner === 'platform'
    ? `${slot.label} · ByteBikri rent slot`
    : `${slot.label} · ${owner === 'platform' ? '' : "this store's own ad"}`;
  return `<div class="${cls}" data-slot="${esc(slot.key)}" data-owner="${esc(owner)}"
       data-serving="${slot.serving ? 'true' : 'false'}"
       style="min-height:${h}px" role="complementary" aria-label="${esc(slot.label)} slot">
  <div>
    <div class="slot-label">${esc(label)}</div>
    <div class="slot-sub">rank ${slot.rank}${slot.serving ? ' · serving' : ' · reserved'}</div>
  </div>
</div>`;
}

export const m = { esc, npr, num, relTime, pill };
