/**
 * Server-rendered views. Deliberately server-side: storefronts must be real
 * crawlable pages on real URLs, because that is what makes them linkable,
 * shareable, and — when the ad layer arrives — approvable as sites.
 */
const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;')

const npr = (n) => `NPR ${Number(n || 0).toLocaleString('en-IN')}`

function layout({ title, body, user, activeChannel }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · ByteBikri</title>
<link rel="stylesheet" href="/styles.css">
</head>
<body>
<header class="topbar">
  <a class="brand" href="/">Byte<span>Bikri</span></a>
  <nav>
    ${activeChannel ? `<a href="/dashboard/${esc(activeChannel.slug)}">Dashboard</a>` : ''}
    <a href="/marketplace">Marketplace</a>
    ${user ? `<span class="who">${esc(user.display_name)}</span>` : `<a href="/login">Sign in</a>`}
  </nav>
</header>
<main>${body}</main>
<footer class="foot">
  <strong>ByteBikri</strong> — ad-gated content storefronts.
  Creators keep their ad revenue: ad networks pay each channel's own account directly.
  ByteBikri takes 0% of ad earnings and never holds anyone's money.
</footer>
</body>
</html>`
}

// ---------------------------------------------------------------------------

export function landing({ channels, user, stats }) {
  const cards = channels.map((c) => `
    <a class="card" href="/s/${esc(c.slug)}">
      <div class="card-top"><h3>${esc(c.name)}</h3>
        <span class="pill ${c.listing_mode === 'marketplace' ? 'pill-paid' : ''}">${esc(c.listing_mode)}</span></div>
      <p>${esc(c.tagline || 'No tagline yet.')}</p>
      <div class="meta"><span>${c.asset_count} items</span><span>${npr(c.plan_price)} · ${esc(c.plan_code)}</span></div>
    </a>`).join('') || `<p class="empty">No channels yet.</p>`

  return layout({
    title: 'Home', user,
    body: `
<section class="hero">
  <h1>Your storefront. Your ad revenue. Zero cut.</h1>
  <p>Publish content behind a rewarded ad. The ad network pays <em>your</em> account directly —
     we never touch it. Upgrades and rent are the only money that reaches us.</p>
  <div class="hero-stats">
    <div><strong>${stats.channels}</strong><span>channels</span></div>
    <div><strong>${stats.assets}</strong><span>items</span></div>
    <div><strong>${stats.unlocks}</strong><span>unlocks</span></div>
    <div><strong>${stats.views}</strong><span>ad views served</span></div>
  </div>
</section>
<h2 class="section">Channels</h2>
<div class="grid">${cards}</div>`,
  })
}

export function marketplace({ channels, user }) {
  const listed = channels.filter((c) => c.listing_mode === 'marketplace')
  return layout({
    title: 'Marketplace', user,
    body: `
<h1>Marketplace</h1>
<p class="lede">Channels that opted into discovery. Storefront-only channels are reachable by their
   own link and do not appear here — being listed is a paid capability, because discovery is the
   thing ByteBikri actually supplies.</p>
<div class="grid">${listed.map((c) => `
  <a class="card" href="/s/${esc(c.slug)}">
    <div class="card-top"><h3>${esc(c.name)}</h3><span class="pill pill-paid">listed</span></div>
    <p>${esc(c.tagline || '')}</p>
  </a>`).join('') || `<p class="empty">Nothing listed yet.</p>`}</div>`,
  })
}

// ---------------------------------------------------------------------------
// Slot rendering. An empty slot RESERVES ITS HEIGHT — it never collapses,
// because reflow damages Core Web Vitals and therefore every channel's rates.
// ---------------------------------------------------------------------------
function renderSlot(slot, { editable = false } = {}) {
  const height = slot.maxHeightPx || 250
  const isPlatform = slot.payoutParty === 'platform'
  const cls = ['slot', isPlatform ? 'slot-platform' : 'slot-channel', `slot-${slot.state}`].join(' ')
  const badge = isPlatform
    ? `<span class="slot-badge badge-platform">platform · rent</span>`
    : `<span class="slot-badge badge-channel">channel's own ad</span>`

  let inner
  if (slot.state === 'reserved_empty') {
    inner = `<div class="slot-reserved">space reserved — no active ad provider<br>
             <small>height held so the page never shifts</small></div>`
  } else if (isPlatform) {
    inner = `<div class="slot-fill slot-fill-platform">ByteBikri house / rent slot<br>
             <small>rank ${slot.rank} of ${slot.rank} — the last position, never rank 1</small></div>`
  } else {
    inner = `<div class="slot-fill">ad served by <strong>${esc(slot.providerId || 'provider')}</strong><br>
             <small>revenue paid to the channel directly by the network</small></div>`
  }

  return `<div class="${cls}" style="min-height:${height}px" data-slot="${esc(slot.slotKey)}">
    <div class="slot-head">${badge}<span class="slot-key">${esc(slot.slotKey)} · rank ${slot.rank}</span></div>
    ${inner}
    ${editable ? `<div class="slot-edit">${esc(slot.reason)}</div>` : ''}
  </div>`
}

export function storefront({ channel, assets, slots, user, estimate, pageviews, unlockedIds = new Set() }) {
  const cards = assets.map((a) => {
    // Lock state is PRECOMPUTED by the caller and passed in. The view layer must
    // never reach for the store: it rendered strings synchronously, and a
    // synchronous hook into an async database is exactly the kind of thing that
    // works in development and lies in production.
    const unlocked = a.unlock_mode === 'open' || (user && unlockedIds.has(a.id))
    const files = a.files || []
    return `<a class="asset ${unlocked ? 'is-unlocked' : ''}" href="/s/${esc(channel.slug)}/a/${esc(a.slug)}">
      <div class="asset-lock">${a.unlock_mode === 'open' ? '○' : unlocked ? '✓' : '🔒'}</div>
      <div>
        <h3>${esc(a.title)}</h3>
        <p>${esc(a.description || '')}</p>
        <div class="meta">
          <span class="tag">${esc(a.unlock_mode === 'open' ? 'open' : `${a.ads_required} ad to unlock`)}</span>
          ${files.length ? `<span>${esc(files[0].filename)}</span>` : ''}
        </div>
      </div>
    </a>`
  }).join('') || `<p class="empty">Nothing published yet.</p>`

  return layout({
    title: channel.name, user, activeChannel: channel,
    body: `
<div class="store-head">
  <div>
    <h1>${esc(channel.name)}</h1>
    <p class="lede">${esc(channel.tagline || '')}</p>
  </div>
  <div class="store-facts">
    <span class="pill">${esc(channel.plan_code)} plan</span>
    ${channel.listing_mode === 'marketplace' ? '<span class="pill pill-paid">marketplace listed</span>' : '<span class="pill">storefront</span>'}
    <span class="pill">${pageviews.toLocaleString('en-IN')} pageviews / 30d</span>
  </div>
</div>

${renderSlot(slots[0], {})}

<h2 class="section">Content</h2>
<div class="assets">${cards}</div>

${slots.slice(1, -1).map((s) => renderSlot(s, {})).join('')}
${slots.length > 1 ? renderSlot(slots[slots.length - 1], {}) : ''}

<div class="note">
  <strong>How the ad money works here.</strong>
  Slots marked <em>channel's own ad</em> are filled from this channel's own ad account. The network pays
  them directly — ByteBikri is not in the payment path. The single <em>rent</em> slot is ours, and it
  always takes the lowest-value position on the page.
  ${estimate?.estNpr ? `Estimated rent-slot value: <strong>${npr(estimate.estNpr)}</strong>/month
  (our estimate from ${estimate.pageviews30d.toLocaleString('en-IN')} pageviews at an assumed
  $${estimate.rpmUsd} RPM — your real earnings come from your network's dashboard, not from us).` : ''}
</div>`,
  })
}

export function assetPage({ channel, asset, files, unlocked, user, policy, slots }) {
  const downloads = unlocked
    ? files.map((f) => `<li><a class="btn btn-download" href="${esc(f.downloadUrl)}" download>Download ${esc(f.filename)}</a>
        <small>expiring link · ${(f.size_bytes / 1024).toFixed(1)} KB · cannot be forwarded and reused</small></li>`).join('')
    : `<li class="locked-hint">Unlock to reveal the download link. Links are minted per user and expire,
        so they cannot be forwarded.</li>`

  return layout({
    title: asset.title, user, activeChannel: channel,
    body: `
<a class="back" href="/s/${esc(channel.slug)}">← ${esc(channel.name)}</a>
<div class="asset-page">
  <h1>${esc(asset.title)}</h1>
  <p class="lede">${esc(asset.description || '')}</p>

  <div class="unlock-box ${unlocked ? 'is-unlocked' : 'is-locked'}"
       data-asset="${esc(asset.id)}"
       data-channel="${esc(channel.slug)}"
       data-seconds="${policy?.ad_min_seconds || 15}"
       data-required="${policy?.ads_required || 1}">
    <div class="unlock-state">
      ${unlocked
        ? `<strong>Unlocked</strong> <span>re-locks ${policy?.unlock_hours ? `after ${policy.unlock_hours}h` : 'never'}</span>`
        : `<strong>Locked</strong> <span>watch ${policy?.ads_required || 1} rewarded ad${(policy?.ads_required || 1) > 1 ? 's' : ''} to unlock</span>`}
    </div>
    ${unlocked ? '' : `<button class="btn btn-primary" id="unlockBtn">Watch to unlock</button>
      <p class="fine">The ad network pays this channel's own ad account directly. ByteBikri takes 0%.</p>`}
  </div>

  <h2 class="section">Files</h2>
  <ul class="files">${downloads}</ul>

  <div class="note">
    Access is proven by a signed server-to-server postback from the ad network — never by the browser.
    A browser callback can be forged, and a forged one would mean free content <em>plus</em> a revenue
    claim the network rejects against this channel's account.
  </div>
</div>
${slots.map((s) => renderSlot(s, {})).join('')}
<script src="/app.js"></script>`,
  })
}

export function dashboard({ channel, slots, connections, providers, plan, estimate, pageviews, adViews, upgrade, user, pendingPayments }) {
  const connRows = connections.map((c) => `
    <tr><td>${esc(c.provider_id)}</td>
      <td><span class="pill pill-ok">${esc(c.status)}</span></td>
      <td class="mono">${esc(c.credential_ref)}</td>
      <td>${esc((c.slot_keys || []).join(', ') || '—')}</td>
      <td><button class="btn btn-sm" data-revoke="${esc(c.id)}">Revoke</button></td></tr>`).join('')
    || `<tr><td colspan="5" class="empty">No ad provider connected yet — slots stay reserved and empty.</td></tr>`

  const slotRows = slots.map((s) => `
    <tr><td class="mono">${esc(s.slotKey)}</td><td>${s.rank}</td>
      <td><span class="pill ${s.payoutParty === 'platform' ? 'pill-warn' : 'pill-ok'}">${esc(s.payoutParty)}</span></td>
      <td>${esc(s.surface)}</td><td>${esc(s.state)}</td><td class="small">${esc(s.reason)}</td></tr>`).join('')

  const picker = providers.slice(0, 8).map((p) => `
    <div class="provider">
      <div class="provider-head">
        <strong>${esc(p.name)}</strong>
        <span class="pill level-${esc(p.verdict.level)}">${esc(p.verdict.level)}</span>
      </div>
      <div class="provider-body">
        <div><span class="k">Nepal threshold</span><span class="v">${esc(p.verdict.thresholdLabel)}</span></div>
        <div><span class="k">Advertised</span><span class="v muted">$${p.verdict.advertisedThreshold ?? '—'}</span></div>
        <div><span class="k">Usable rails</span><span class="v">${esc(p.verdict.usableMethods.join(', ') || '—')}</span></div>
      </div>
      ${p.verdict.blockers.length ? `<p class="warn">${esc(p.verdict.blockers[0])}</p>` : ''}
      <button class="btn btn-sm btn-primary" data-connect="${esc(p.id)}">Connect (redirect)</button>
    </div>`).join('')

  const payRows = (pendingPayments || []).map((p) => `
    <tr><td class="mono">${esc(p.txn_reference)}</td><td>${npr(p.amount_npr)}</td>
      <td>${esc(p.payer_name || '—')}</td><td><span class="pill pill-warn">${esc(p.status)}</span></td></tr>`).join('')
    || `<tr><td colspan="4" class="empty">No plan payments submitted.</td></tr>`

  const viewRows = adViews.slice(-8).reverse().map((v) => `
    <tr><td>${esc(v.provider_id)}</td><td class="mono">${esc((v.external_id || '').slice(0, 18))}</td>
      <td>${v.completed ? 'completed' : 'incomplete'}</td>
      <td>${v.duration_sec ?? '—'}s</td>
      <td class="small">${esc(new Date(v.created_at).toISOString().replace('T', ' ').slice(0, 19))}</td></tr>`).join('')
    || `<tr><td colspan="5" class="empty">No ad views yet.</td></tr>`

  return layout({
    title: `${channel.name} dashboard`, user, activeChannel: channel,
    body: `
<h1>${esc(channel.name)} — dashboard</h1>
<div class="facts">
  <div><span>Plan</span><strong>${esc(plan.name)}</strong></div>
  <div><span>Pageviews / 30d</span><strong>${pageviews.toLocaleString('en-IN')}</strong></div>
  <div><span>Unlocks</span><strong>${esc(estimate.unlocks ?? 0)}</strong></div>
  <div><span>Rent-slot value (est.)</span><strong>${npr(estimate.estNpr)}/mo</strong></div>
</div>

<h2 class="section">Slot plan</h2>
<p class="lede">You own <em>what</em> fills a slot. ByteBikri owns <em>where</em> slots exist and how many —
   which is what keeps ad density and layout enforceable for everyone.</p>
<table class="tbl">
  <thead><tr><th>Slot</th><th>Rank</th><th>Paid to</th><th>Surface</th><th>State</th><th>Why</th></tr></thead>
  <tbody>${slotRows}</tbody>
</table>

<h2 class="section">Ad provider</h2>
<p class="lede">Sorted by what you can actually withdraw in Nepal. The advertised minimum is usually the
   cheapest <em>method</em>, not one you can use — so we show the reachable figure instead.</p>
<div class="providers">${picker}</div>

<h3>Connected</h3>
<table class="tbl">
  <thead><tr><th>Provider</th><th>Status</th><th>Credential</th><th>Slots</th><th></th></tr></thead>
  <tbody>${connRows}</tbody>
</table>

<h2 class="section">Ad views (postback log)</h2>
<p class="lede">Every billable view, recorded only when a signed postback arrives from the network's server.</p>
<table class="tbl">
  <thead><tr><th>Provider</th><th>External id</th><th>Result</th><th>Length</th><th>Received</th></tr></thead>
  <tbody>${viewRows}</tbody>
</table>

<h2 class="section">Plan &amp; rent</h2>
${upgrade ? `<div class="upgrade">
  <div><span class="k">Upgrade to ${esc(upgrade.to.name)}</span>
    <span class="v">${npr(upgrade.amountNpr)}</span></div>
  <p class="small">${upgrade.daysLeft} days left on ${esc(upgrade.from.name)}.
     Pro-rated: (${npr(upgrade.to.priceNpr)} − ${npr(upgrade.from.priceNpr)}) × ${upgrade.daysLeft}/365.
     Your cycle end does not move.</p>
  <p class="fine">Upgrades are rare — annual, not hourly. That is precisely why verifying a payment by hand
     is viable here, and would not be for content purchases.</p>
</div>` : ''}
<table class="tbl">
  <thead><tr><th>Reference</th><th>Amount</th><th>Payer</th><th>Status</th></tr></thead>
  <tbody>${payRows}</tbody>
</table>
<p class="fine">We verify against our own bank/eSewa statement, not a screenshot. A screenshot proves a
   transfer was initiated; the statement proves it arrived.</p>

<script src="/app.js"></script>`,
  })
}

export function login({ user }) {
  return layout({
    title: 'Sign in', user,
    body: `
<div class="auth">
  <h1>Sign in or create a channel</h1>
  <form method="post" action="/login">
    <label>Email <input name="email" type="email" required placeholder="you@example.com"></label>
    <label>Channel name <input name="channel" placeholder="Alice's Studio"></label>
    <button class="btn btn-primary" type="submit">Continue</button>
  </form>
  <p class="fine">Demo auth — no password. Real signup uses Supabase auth.</p>
</div>`,
  })
}
