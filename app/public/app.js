/**
 * Client.
 *
 * The client's entire job is to START an unlock and then wait. It cannot grant
 * one, and the code here is written so that it plainly cannot: the only thing it
 * can do is ask the server whether a postback has arrived. Anything else would
 * mean the browser's word counted, and a browser's word is forgeable.
 *
 * It also never decides a view is complete. The countdown is a courtesy to the
 * person watching; the network tells the server what happened, not us.
 */
(() => {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);

  const api = async (url, options = {}) => {
    const res = await fetch(url, {
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      ...options,
    });
    const body = await res.json().catch(() => ({ ok: false, error: 'unreadable response' }));
    return { status: res.status, ...body };
  };

  // ── the unlock flow ──────────────────────────────────────────────────────
  const unlockBtn = $('#unlock-btn');
  if (unlockBtn) {
    const modal = $('#ad-modal');
    const countEl = $('#ad-count');
    const progress = $('#ad-progress');
    const note = $('#ad-note');
    const providerLine = $('#ad-provider');
    const statusEl = $('#unlock-status');

    let poll = null;
    let ticker = null;

    const setStatus = (text, kind = '') => {
      if (!statusEl) return;
      statusEl.textContent = text;
      statusEl.style.color = kind ? `var(--${kind}-text)` : '';
    };

    const close = () => {
      clearInterval(poll);
      clearInterval(ticker);
      poll = ticker = null;
      if (modal) modal.hidden = true;
    };

    const fail = (message) => {
      clearInterval(ticker);
      if (note) {
        note.textContent = message;
        note.style.color = 'var(--danger-text)';
      }
      setStatus(message, 'danger');
      unlockBtn.disabled = false;
      setTimeout(close, 2600);
    };

    const finish = async (viewId, assetId) => {
      clearInterval(ticker);
      if (countEl) countEl.textContent = '✓';
      if (note) {
        note.textContent = 'Verified. Minting your download link…';
        note.style.color = 'var(--success-text)';
      }

      // Reload and let the server decide what to render. It re-checks the
      // unlock and mints a fresh expiring URL; doing it here would mean the
      // browser constructing its own access.
      const started = Date.now();
      const check = async () => {
        const s = await api(`/api/unlock/status?assetId=${encodeURIComponent(assetId)}&viewId=${encodeURIComponent(viewId)}`);
        if (s.unlocked) {
          setStatus('Unlocked — reloading…', 'success');
          location.reload();
          return;
        }
        // Providers reconcile asynchronously, so keep asking for a while rather
        // than declaring failure the moment the ad ends.
        if (Date.now() - started < 90_000) {
          poll = setTimeout(check, 1500);
        } else {
          fail('The network has not confirmed yet. This can take a moment — reload to check.');
        }
      };
      check();
    };

    const runAd = async (assetId) => {
      const start = await api('/api/unlock/start', {
        method: 'POST',
        body: JSON.stringify({ assetId }),
      });

      if (!start.ok) {
        if (start.status === 401) {
          location.href = `/login?next=${encodeURIComponent(location.pathname)}`;
          return;
        }
        setStatus(start.error || 'Could not start.', 'danger');
        unlockBtn.disabled = false;
        return;
      }
      if (start.alreadyUnlocked) { location.reload(); return; }

      const cfg = start.adConfig;
      const seconds = Number(cfg.minSeconds) || 15;

      if (providerLine) providerLine.textContent = `${cfg.providerId} · rewarded video`;
      if (modal) modal.hidden = false;
      if (note) {
        note.textContent = 'The unlock is not granted by this screen. It arrives from the provider\'s '
          + 'server, signed, and is verified before the download link appears.';
        note.style.color = '';
      }

      // Countdown. Cosmetic only — see the file header.
      let left = seconds;
      if (countEl) countEl.textContent = String(left);
      if (progress) progress.style.width = '0%';
      ticker = setInterval(() => {
        left -= 1;
        if (countEl) countEl.textContent = String(Math.max(left, 0));
        if (progress) progress.style.width = `${Math.min(((seconds - left) / seconds) * 100, 100)}%`;
        if (left <= 0) clearInterval(ticker);
      }, 1000);

      if (cfg.devSimulator) {
        // The sandbox network, driven from the browser ONLY because there is no
        // real provider here. A real integration never calls this: the network
        // calls us. Guarded by cfg.devSimulator, which the server omits in
        // production.
        try {
          const r = await api(`/dev/simulate-network/${encodeURIComponent(cfg.providerId)}`, {
            method: 'POST',
            body: JSON.stringify({
              viewId: start.viewId,
              connectionId: cfg.connectionId,
              durationSec: seconds,
            }),
          });
          if (!r.ok) return fail(r.error || 'The network rejected the view.');
        } catch {
          return fail('Could not reach the sandbox network.');
        }
      }

      setTimeout(() => finish(start.viewId, assetId), seconds * 1000 + 400);
    };

    unlockBtn.addEventListener('click', () => {
      unlockBtn.disabled = true;
      setStatus('Starting…');
      runAd(unlockBtn.dataset.asset).catch(() => {
        setStatus('Something went wrong starting the ad.', 'danger');
        unlockBtn.disabled = false;
      });
    });

    $('#ad-close')?.addEventListener('click', () => {
      close();
      unlockBtn.disabled = false;
      setStatus('Closed before the ad finished. Nothing was unlocked.');
    });
  }

  // ── protected media ──────────────────────────────────────────────────────
  //
  // Deterrence, and nothing more. The honest statement is in the markup above
  // the player: the overlay mark is what makes a copy traceable, and hiding the
  // right-click menu is what stops the casual two-click grab. It does not stop
  // devtools, it cannot stop a screen recorder, and this comment exists so that
  // nobody later mistakes it for a control and removes the watermark on the
  // grounds that "the JS already handles it".
  document.querySelectorAll('[data-protect]').forEach((el) => {
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('dragstart', (e) => e.preventDefault());
  });

  // A media element that fails is almost always an expired link (four hours) or
  // a revoked unlock. Saying which beats a black rectangle.
  document.querySelectorAll('video[src], audio[src]').forEach((el) => {
    el.addEventListener('error', () => {
      const stage = el.closest('.stage');
      if (!stage || stage.querySelector('.stage-error')) return;
      const note = document.createElement('p');
      note.className = 'fine stage-error';
      note.style.cssText = 'position:absolute;inset:auto 0 0 0;z-index:3;margin:0;'
        + 'padding:var(--space-3) var(--space-4);background:var(--danger-soft);color:var(--danger-text)';
      note.textContent = el.dataset.expiredHint || 'This file could not be loaded. Reload the page for a fresh link.';
      stage.appendChild(note);
    });
  });

  // ── dashboard actions ────────────────────────────────────────────────────
  document.querySelectorAll('[data-connect]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const slug = location.pathname.split('/').pop();
      btn.disabled = true;
      btn.textContent = 'Connecting…';
      const r = await api('/api/ad-connections/start', {
        method: 'POST',
        body: JSON.stringify({ slug, providerId: btn.dataset.connect }),
      });
      if (r.ok) location.reload();
      else { btn.disabled = false; btn.textContent = r.error || 'Failed'; }
    });
  });

  document.querySelectorAll('[data-revoke]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('Disconnect this ad network? Anything it gates stops unlocking.')) return;
      btn.disabled = true;
      await api('/api/ad-connections/revoke', {
        method: 'POST',
        body: JSON.stringify({ connectionId: btn.dataset.revoke }),
      });
      location.reload();
    });
  });
})();
