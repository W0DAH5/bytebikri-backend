/**
 * Live demo server — renders tenant shop pages through the real resolution engine.
 *
 * Run: npm start   (binds 0.0.0.0 so it works behind a proxy/preview host)
 */
import http from 'node:http'
import { loadRegistry, selectableProviders, payoutVerdict, enableForDemo } from './src/registry.js'
import { resolvePage, buildConnectUrl } from './src/resolve.js'

const PORT = process.env.PORT || 3000
const HOST = '0.0.0.0'

// DEMO ONLY — see registry.js. Verification-by-default disables every provider;
// enable a few so the engine's serving behaviour is visible. Blocked providers
// (AdSense, Ezoic) remain blocked regardless.
const { registry } = enableForDemo(await loadRegistry(), ['propellerads', 'monetag', 'adsterra'])

const conn = (providerId, status, zoneId) => ({
  providerId,
  status,
  credentials: zoneId ? { zoneId } : {},
})

const SCENARIOS = {
  'alice-free-active': {
    title: "Alice's Shop — free tier, PropellerAds active",
    blurb: 'The normal case. Tenant fills 4 slots and keeps 100%; platform keeps the footer as rent.',
    space: {
      id: 'sp_alice',
      name: "Alice's Shop",
      entitlements: [],
      pageSlots: ['top_leaderboard', 'in_article_1', 'sidebar_sticky', 'in_article_2', 'footer_native'],
      owner: 'Alice',
      product: 'Notion templates for students',
    },
    connections: [conn('propellerads', 'active', 'ZN-4821')],
  },
  'bob-pro': {
    title: "Bob's Shop — Pro subscriber",
    blurb: 'Pro buys out the platform slot. All five placements belong to the tenant.',
    space: {
      id: 'sp_bob',
      name: "Bob's Shop",
      entitlements: ['pro'],
      pageSlots: ['top_leaderboard', 'in_article_1', 'sidebar_sticky', 'in_article_2', 'footer_native'],
      owner: 'Bob',
      product: 'Lightroom presets & overlays',
    },
    connections: [conn('adsterra', 'active', 'AD-7731')],
  },
  'carol-pending': {
    title: "Carol's Shop — connection pending review",
    blurb: 'Slots collapse and reserve their space. No layout shift, no broken boxes.',
    space: {
      id: 'sp_carol',
      name: "Carol's Shop",
      entitlements: [],
      pageSlots: ['top_leaderboard', 'in_article_1', 'sidebar_sticky', 'in_article_2', 'footer_native'],
      owner: 'Carol',
      product: 'Hand-lettered Nepali fonts',
    },
    connections: [conn('propellerads', 'pending', 'ZN-1190')],
  },
  'dave-short': {
    title: "Dave's Shop — short page",
    blurb: 'Under three slots the platform takes nothing. Short pages are never taxed.',
    space: {
      id: 'sp_dave',
      name: "Dave's Shop",
      entitlements: [],
      pageSlots: ['top_leaderboard', 'in_article_1'],
      owner: 'Dave',
      product: 'Recipe card printables',
    },
    connections: [conn('monetag', 'active', 'MT-204')],
  },
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
}

function renderSlot(s) {
  // Every outcome reserves its height. Collapsing must not shift the layout.
  const base = `min-height:${s.height}px`
  if (s.outcome === 'tenant_ad') return `<div class="slot slot-tenant" style="${base}">${s.html}</div>`
  if (s.outcome === 'platform_ad') return `<div class="slot slot-platform" style="${base}">${s.html}</div>`
  return `<div class="slot slot-empty" style="${base}">
      <span class="ph">reserved — ${esc(s.outcome.replace(/_/g, ' '))}</span></div>`
}

function pageShell(title, body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · bytebikri prototype</title>
<style>
  :root { --ink:#12161c; --mut:#697586; --line:#e3e7ee; --bg:#f6f7f9; --acc:#2f6df6; --ok:#0f9d58; --warn:#e8a33d; }
  * { box-sizing:border-box }
  body { margin:0; background:var(--bg); color:var(--ink);
         font:15px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif }
  .wrap { max-width:1060px; margin:0 auto; padding:28px 20px 64px }
  h1 { font-size:22px; margin:0 0 4px } h2 { font-size:16px; margin:28px 0 10px }
  .sub { color:var(--mut); margin:0 0 20px }
  a { color:var(--acc) }
  .nav { display:flex; flex-wrap:wrap; gap:8px; margin:18px 0 }
  .nav a { background:#fff; border:1px solid var(--line); border-radius:8px; padding:8px 12px;
           text-decoration:none; font-size:13px }
  .nav a:hover { border-color:var(--acc) }
  .cols { display:grid; grid-template-columns:minmax(0,1fr) 300px; gap:18px }
  @media (max-width:820px){ .cols{ grid-template-columns:1fr } }
  .card { background:#fff; border:1px solid var(--line); border-radius:12px; padding:18px }
  .slot { display:flex; align-items:center; justify-content:center; border-radius:8px; margin:14px 0;
          overflow:hidden }
  .ad { width:100%; height:100%; display:flex; flex-direction:column; align-items:center;
        justify-content:center; gap:4px; border-radius:8px; font-size:13px }
  .ad-tenant { background:#eef4ff; border:1px dashed #9ec0ff; color:#1b4fd8 }
  .ad-house { background:#f3f0ff; border:1px dashed #b9a8ff; color:#5b3fd6 }
  .ad-label { font-size:10px; letter-spacing:.09em; text-transform:uppercase; opacity:.7 }
  .slot-empty { border:1px dashed var(--line); background:
      repeating-linear-gradient(45deg,#fafbfc,#fafbfc 8px,#f1f3f6 8px,#f1f3f6 16px) }
  .ph { font-size:11px; color:#9aa4b2; letter-spacing:.04em }
  .summary { font-family:ui-monospace,Menlo,Consolas,monospace; font-size:12px; background:#fff;
             border:1px solid var(--line); border-radius:12px; padding:16px; white-space:pre-wrap }
  .kv { display:flex; justify-content:space-between; padding:6px 0; border-bottom:1px solid var(--line);
        font-size:13px } .kv:last-child{ border:0 }
  .badge { font-size:11px; padding:2px 8px; border-radius:99px; border:1px solid var(--line); color:var(--mut) }
  .badge.ok { color:var(--ok); border-color:#bfe6cf } .badge.warn { color:var(--warn); border-color:#f2ddb5 }
  code { font-family:ui-monospace,Menlo,Consolas,monospace; font-size:11px; opacity:.85 }
  .prov { display:flex; align-items:center; justify-content:space-between; gap:8px; padding:9px 0;
          border-bottom:1px solid var(--line); font-size:13px } .prov:last-child{ border:0 }
  .note { font-size:13px; color:var(--mut) }
  .money { color:var(--ok); font-weight:600 }
</style></head><body><div class="wrap">${body}</div></body></html>`
}

function indexPage() {
  const providers = selectableProviders(registry)
  const links = Object.entries(SCENARIOS)
    .map(([k, s]) => `<a href="/space/${k}">${esc(s.title)}</a>`)
    .join('')

  const provRows = registry.providers
    .filter((p) => p.id !== 'house')
    .map((p) => {
      const v = payoutVerdict(p)
      const enabled = p.enabled && !p.blockedReason
      const label = !enabled ? (p.blockedReason ? 'blocked' : 'awaiting verification')
                     : v.level === 'ok' ? 'usable' : v.level === 'caution' ? 'check payout' : 'payout blocked'
      const cls = enabled && v.level === 'ok' ? 'ok' : 'warn'
      return `<div class="prov"><span>${esc(p.name)}</span>
        <span class="badge ${cls}">${label}</span></div>`
    })
    .join('')

  return pageShell(
    'bytebikri prototype',
    `<h1>bytebikri — ad resolution prototype</h1>
     <p class="sub">Deterministic slot allocation · capability-gated adapters · defined fallback chain ·
        referral-aware onboarding. No money moved.</p>
     <div class="nav">${links}</div>
     <div class="cols">
       <div>
         <h2>What this demonstrates</h2>
         <div class="card">
           <p style="margin-top:0"><strong>Your shop is free. The platform keeps one placement per page as rent.</strong></p>
           <p class="note">Rank 1 is never taken. Pages under three slots are never taxed. One slot, never more.
              Pro releases it. Every figure below is computed by the same allocator the server uses.</p>
           <p class="note">Providers are capability-gated: a link_rewrite adapter can never be assigned to a
              display slot, and a blocked provider can never be selected at all.</p>
         </div>
         <h2>Provider picker — gated on all three axes</h2>
         <div class="card">${provRows}
           <p class="note" style="margin-bottom:0">Integrable × <em>can a Nepali actually withdraw</em> × threshold.
              Only ${providers.length} providers currently pass all gates.</p>
         </div>
       </div>
       <div>
         <h2>Two revenue lines</h2>
         <div class="card">
           <div class="kv"><span>Referral commission</span><span class="money">network → platform</span></div>
           <div class="kv"><span>Tenant ad earnings</span><span class="money">network → tenant</span></div>
           <div class="kv"><span>Platform slot</span><span>inventory, not cash</span></div>
           <div class="kv"><span>Asset sale cut</span><span>merchant-of-record</span></div>
           <p class="note" style="margin-bottom:0">No intercept, no payout rails, no KYC on tenants.</p>
         </div>
       </div>
     </div>`,
  )
}

function spacePage(key) {
  const sc = SCENARIOS[key]
  const plan = resolvePage({
    space: sc.space,
    registry,
    connections: sc.connections,
  })

  const rendered = plan.slots.map((s) => ({ ...s, html: s.html || '' }))
  const byKey = Object.fromEntries(rendered.map((s) => [s.slotKey, s]))

  const slotHtml = (k) => {
    const s = byKey[k]
    return s ? renderSlot(s) : ''
  }

  const breakdown = rendered
    .map((s) => `${s.slotKey.padEnd(18)} rank ${s.rank}  ${s.outcome}`)
    .join('\n')

  const referrals = sc.connections
    .map((c) => {
      const p = registry.providers.find((x) => x.id === c.providerId)
      if (!p?.referral) return ''
      const built = buildConnectUrl({
        provider: p, platformRefId: 'BB-PLATFORM-REF-0001', spaceId: sc.space.id,
        returnUrl: 'https://bytebikri.com/connect/callback', state: 'st_demo',
      })
      const attachNote = built.referralAttached
        ? `Server-side only. The user keeps 100%; the network pays bytebikri
           ${p.referral.commissionPct}% (${esc(String(p.referral.duration))}).`
        : `Referral param <strong>not attached</strong> — the parameter name is still unverified.
           Refusing to guess is the correct behaviour: a wrong param breaks attribution silently.`
      return `<h2>Referral-aware connect URL</h2>
        <div class="summary">${esc(built.url)}</div>
        <p class="note">${attachNote}</p>`
    })
    .join('')

  const nav = Object.entries(SCENARIOS).map(([k, s]) =>
    `<a href="/space/${k}"${k === key ? ' style="border-color:#2f6df6"' : ''}>${esc(s.owner)}</a>`).join('')

  return pageShell(
    sc.title,
    `<p class="sub"><a href="/">← all scenarios</a></p>
     <h1>${esc(sc.title)}</h1>
     <p class="sub">${esc(sc.blurb)}</p>
     <div class="nav">${nav}</div>
     <div class="cols">
       <div class="card">
         <div style="font-size:12px;color:var(--mut);letter-spacing:.05em;text-transform:uppercase">
           ${esc(sc.space.name)} · selling ${esc(sc.space.product)}</div>
         ${slotHtml('top_leaderboard')}
         <h2 style="margin:14px 0 6px">How to price digital products people actually buy</h2>
         <p style="color:var(--mut);margin:0">
           A short piece of the tenant's own content. The ad placements sit inside and around it,
           exactly where a real shop page would put them.</p>
         ${slotHtml('in_article_1')}
         <p style="color:var(--mut)">More tenant content. The sidebar carries its own placement on desktop.</p>
         ${slotHtml('in_article_2')}
         ${slotHtml('footer_native')}
       </div>
       <div>
         <h2>Page plan</h2>
         <div class="summary">${esc(breakdown)}

total ${plan.summary.total} · tenant ${plan.summary.tenantFilled} · platform ${plan.summary.platformFilled} · collapsed ${plan.summary.collapsed}
platform share ${plan.summary.platformSharePct}%</div>
         <h2>Sidebar slot</h2>
         <div class="card">${slotHtml('sidebar_sticky')}</div>
         ${referrals}
       </div>
     </div>`,
  )
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`)
  const m = url.pathname.match(/^\/space\/([\w-]+)$/)

  if (url.pathname === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' })
    return res.end(JSON.stringify({ ok: true, scenarios: Object.keys(SCENARIOS) }))
  }
  if (m && SCENARIOS[m[1]]) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    return res.end(spacePage(m[1]))
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
  res.end(indexPage())
})

server.listen(PORT, HOST, () => {
  console.log(`bytebikri prototype listening on http://${HOST}:${PORT}`)
})
