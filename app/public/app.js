/* ByteBikri client.
 *
 * The only job the browser has in the unlock flow is to START it and then ask
 * whether it finished. It never declares that an ad completed — that claim
 * arrives from the ad network's server, signed. See app/src/unlocks.js.
 */
(function () {
  'use strict'

  const $ = (sel, root = document) => root.querySelector(sel)
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)]

  // ---------------------------------------------------------------- unlock --
  const box = $('.unlock-box')
  if (box && !box.classList.contains('is-unlocked')) {
    const btn = $('#unlockBtn')
    if (btn) btn.addEventListener('click', () => startUnlock(box))
  }

  async function startUnlock(box) {
    const assetId = box.dataset.asset
    const seconds = Number(box.dataset.seconds || 15)
    const required = Number(box.dataset.required || 1)

    const res = await post('/api/unlock/start', { assetId })
    if (!res.ok) return flash(box, res.error || 'Could not start unlock', true)

    let completed = 0
    while (completed < required) {
      const watched = await playRewardedAd(res, seconds)
      if (!watched) return flash(box, 'Ad was not completed — no unlock granted.', true)
      completed++
    }

    // Ask the server. The postback may already have landed.
    for (let i = 0; i < 10; i++) {
      const st = await get(`/api/unlock/status?assetId=${encodeURIComponent(assetId)}&viewId=${encodeURIComponent(res.viewId)}`)
      if (st.unlocked) {
        flash(box, 'Unlocked — reloading…')
        setTimeout(() => location.reload(), 600)
        return
      }
      await wait(400)
    }
    flash(box, 'Unlock not confirmed. The network postback has not arrived.', true)
  }

  /**
   * Demo player. In production this hands off to the provider's SDK/iframe and
   * the completion arrives by postback. Here we call a dev-only endpoint that
   * plays the part of the network — it SIGNS the postback and delivers it
   * server-to-server, so the trust boundary is exercised for real.
   */
  function playRewardedAd(session, seconds) {
    return new Promise((resolve) => {
      const overlay = document.createElement('div')
      overlay.id = 'adOverlay'
      overlay.innerHTML = `
        <div class="ad-player">
          <div class="ad-label">Rewarded ad · ${session.adConfig.providerId}</div>
          <div class="ad-frame">
            <div class="big" id="adCount">${seconds}</div>
            <div class="sub">verification not required to skip — skip and get nothing</div>
          </div>
          <div class="ad-progress"><i id="adBar"></i></div>
          <div class="ad-status" id="adStatus">Playing…</div>
          <button class="btn" id="adSkip">Skip (no unlock)</button>
        </div>`
      document.body.appendChild(overlay)

      const count = $('#adCount', overlay)
      const bar = $('#adBar', overlay)
      const status = $('#adStatus', overlay)
      let left = seconds
      let settled = false

      bar.style.width = '0%'
      requestAnimationFrame(() => { bar.style.transition = `width ${seconds}s linear`; bar.style.width = '100%' })

      const timer = setInterval(() => {
        left--
        count.textContent = Math.max(0, left)
        if (left <= 0) {
          clearInterval(timer)
          if (settled) return
          settled = true
          status.textContent = 'Completed — sending to network for signing…'
          // Browser → simulated network → (signed) → our postback endpoint.
          post(`/dev/simulate-network/${encodeURIComponent(session.adConfig.providerId)}`, {
            viewId: session.viewId,
            connectionId: session.adConfig.connectionId,
            durationSec: seconds,
          }).then((r) => {
            status.textContent = r.ok
              ? 'Network confirmed. Verifying signature…'
              : 'Network rejected: ' + (r.error || 'unknown')
            setTimeout(() => { overlay.remove(); resolve(r.ok && r.granted !== false) }, 700)
          })
        }
      }, 1000)

      $('#adSkip', overlay).addEventListener('click', () => {
        if (settled) return
        settled = true
        clearInterval(timer)
        overlay.remove()
        resolve(false)
      })
    })
  }

  // ------------------------------------------------------ ad connections --
  $$('[data-connect]').forEach((el) => {
    el.addEventListener('click', async () => {
      const providerId = el.dataset.connect
      const slug = location.pathname.split('/').pop()
      el.disabled = true
      el.textContent = 'Redirecting…'
      // In production this is a top-level redirect to the provider's own signup,
      // carrying our referral parameter server-side. It cannot be an iframe:
      // providers block framing, and circumventing that violates their terms.
      const r = await post('/api/ad-connections/start', { slug, providerId })
      if (r.ok) {
        el.textContent = 'Connected'
        setTimeout(() => location.reload(), 700)
      } else {
        el.disabled = false
        el.textContent = 'Failed — retry'
      }
    })
  })

  $$('[data-revoke]').forEach((el) => {
    el.addEventListener('click', async () => {
      if (!confirm('Revoke this ad connection? Its slots become reserved and empty.')) return
      const r = await post('/api/ad-connections/revoke', { connectionId: el.dataset.revoke })
      if (r.ok) location.reload()
    })
  })

  // ----------------------------------------------------------------- utils --
  async function post(url, body) {
    try {
      const r = await fetch(url, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body || {}),
      })
      return await r.json()
    } catch (e) { return { ok: false, error: String(e) } }
  }
  async function get(url) {
    try { return await (await fetch(url)).json() } catch (e) { return { ok: false, error: String(e) } }
  }
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  function flash(box, msg, isError) {
    let el = $('.unlock-flash', box)
    if (!el) { el = document.createElement('p'); el.className = 'unlock-flash fine'; box.appendChild(el) }
    el.textContent = msg
    el.style.color = isError ? 'var(--danger)' : 'var(--accent)'
  }
})()
