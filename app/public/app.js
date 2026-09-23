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

    /*
     * A FAILED ATTEMPT IS REPORTED, NOT GUESSED AT.
     *
     * The client tells the server which of two things happened — the ad script never
     * started, or it started and no postback arrived — and the server decides what
     * that means. The response carries the rung of the ladder (src/blocked.js), which
     * is what gets rendered: one explanation at the first failure, a plain statement
     * of the trade at the third, and at the sixth the unlock stops being offered at
     * all. The client never decides any of that, and it never accuses anybody: the
     * sentences it prints are the server's.
     */
    const reportBlocked = async (signal, viewId = null) => {
      try {
        const r = await api(unlockBtn.dataset.signalUrl || '/api/unlock/blocked', {
          method: 'POST',
          body: JSON.stringify({ assetId: unlockBtn.dataset.asset, viewId, signal }),
        });
        if (!r.ok || !r.rung) return null;
        // The harsh rung is applied by RELOADING: the server renders the withheld
        // state, and nothing the browser says can produce it. A client that could
        // hide its own unlock button would be a client that could show it again.
        if (!r.rung.offersUnlock) {
          location.reload();
          return r.rung;
        }
        if (r.rung.body && note) {
          note.textContent = `${r.rung.headline} — ${r.rung.body}`;
          note.style.color = 'var(--warning-text)';
        }
        return r.rung;
      } catch {
        return null;
      }
    };

    const fail = (message, signal = null, viewId = null) => {
      clearInterval(ticker);
      if (note) {
        note.textContent = message;
        note.style.color = 'var(--danger-text)';
      }
      setStatus(message, 'danger');
      unlockBtn.disabled = false;
      // Reported first, closed after: the reload above needs the modal out of the way
      // and the report needs a live handler.
      if (signal) reportBlocked(signal, viewId).then(() => setTimeout(close, 2600));
      else setTimeout(close, 2600);
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
          fail('The network has not confirmed yet. This can take a moment — reload to check.',
            'no_postback', viewId);
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
        // The one case the browser can recognise for itself: the request for the ad
        // never completed. Reported as `script_blocked`, which is a description of
        // what happened rather than a claim about anybody's software.
        fail('The ad could not be started from this browser.', 'script_blocked');
      });
    });

    $('#ad-close')?.addEventListener('click', () => {
      close();
      unlockBtn.disabled = false;
      setStatus('Closed before the ad finished. Nothing was unlocked.');
      // Recorded as `declined`, which is deliberately NOT a blocker signal: choosing
      // not to watch something is not evasion, and the ladder must not climb for it.
      if (unlockBtn.dataset.signalUrl) reportBlocked('declined');
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

  // ── the page itself ──────────────────────────────────────────────────────
  /**
   * Presentation only, and every piece of it degrades to the markup already
   * rendered. Nothing here decides state, grants anything, or is needed for the
   * page to be correct — the server sends the truth and this decorates it.
   */
  const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /**
   * The header is part of the page at the top and floats over it once scrolled.
   *
   * One rAF-throttled listener writing two custom properties. Nothing is
   * measured per frame except scrollY, which the browser has already computed —
   * `scrollHeight` is read once per resize instead of once per scroll, because
   * that is the read that forces layout.
   */
  const header = $('#site-header');
  if (header) {
    let docHeight = 1;
    const measure = () => { docHeight = Math.max(1, document.documentElement.scrollHeight - innerHeight); };
    let queued = false;
    const paint = () => {
      queued = false;
      const y = scrollY;
      header.classList.toggle('header-pinned', y > 6);
      header.style.setProperty('--scroll-p', String(Math.min(1, Math.max(0, y / docHeight))));
    };
    const onScroll = () => { if (!queued) { queued = true; requestAnimationFrame(paint); } };

    measure();
    paint();
    addEventListener('scroll', onScroll, { passive: true });
    addEventListener('resize', () => { measure(); onScroll(); }, { passive: true });
  }

  /**
   * Count a figure up on first paint.
   *
   * The number is in the DOM already; this only animates the approach to it, so
   * a crawler, a screen reader and a JavaScript-free visitor all get the real
   * value. Tabular figures mean the width never changes while it runs.
   */
  const counters = document.querySelectorAll('[data-count]');
  if (counters.length && !calm) {
    /**
     * How long a figure takes to arrive, and why it is not the CSS token.
     *
     * Every counting library that has settled on a number has settled on about
     * two seconds (CountUp.js and the copy-paste counters all default to it), and
     * the guidance for stat reveals says two to four. This ran at 700ms, which is
     * inside the CSS transition band (Material's own bands top out at 500ms) and
     * is exactly wrong for a counter: a transition is over as soon as it is
     * noticed, while a counter is a READOUT, and the thing that makes it worth
     * animating is that the eye can follow the last digits settling. At 700ms with
     * a cubic curve, 90% of the number is on screen after 200ms — which is why low
     * figures flicker rather than count.
     *
     * So: 1.2s, and an exponent of 4 instead of 3, which both lengthens the visible
     * settle and makes the end slower than the start. Not 2s: this figure is above
     * the fold on the landing page, and holding a real number off the screen for two
     * seconds to decorate it is a worse trade than a slightly quick settle.
     *
     * TWO FIGURES ARE NOT ANIMATED AT ALL. Counting 0→1→2→3 is not a count, it is a
     * stutter: below three digits there is nothing to perceive except a flicker, and
     * the honest version of "3 stores" is the word appearing. The markup already
     * holds the real number, so skipping the animation costs nothing.
     */
    const DURATION = 1200;
    const MIN_TO_ANIMATE = 25;
    const run = (el) => {
      const target = Number(el.dataset.count) || 0;
      if (!target || target < MIN_TO_ANIMATE) return;
      const started = performance.now();
      const step = (now) => {
        const t = Math.min(1, (now - started) / DURATION);
        const eased = 1 - (1 - t) ** 4;
        // Formatted while it runs, so the thousands separator appears in the same
        // frame as the digit that earns it rather than popping in at the end.
        el.textContent = Math.round(target * eased).toLocaleString('en-IN');
        if (t < 1) requestAnimationFrame(step);
        else el.textContent = target.toLocaleString('en-IN');
      };
      requestAnimationFrame(step);
    };
    if ('IntersectionObserver' in window) {
      const io = new IntersectionObserver((entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          io.unobserve(e.target);
          run(e.target);
        }
      }, { threshold: 0.4 });
      counters.forEach((el) => io.observe(el));
    } else {
      counters.forEach(run);
    }
  }

  /**
   * Scroll reveals.
   *
   * The elements are visible in the markup and in the CSS by default; the
   * `reveal-ready` class (set by the inline script in <head>, before paint) is
   * the only thing that lets this hide anything. Then:
   *
   *   - anything already on screen is revealed on the next frame, not observed;
   *   - everything else is revealed as it arrives;
   *   - and after two seconds, everything is revealed regardless. A section that
   *     stays invisible because a callback did not fire is the one failure this
   *     must not be able to produce, so it is not left to a callback.
   */
  if (document.documentElement.classList.contains('reveal-ready')) {
    // Marketing surfaces only — see the inline script in `layout`. `.panel` and
    // `.card` are dashboard furniture as well as landing-page furniture, and a
    // dashboard that fades its own content in is a dashboard that feels slow.
    const targets = document.querySelectorAll('.preview-window, .stat-row, .proof-strip, .rail-card, .channel-card');
    const show = (el) => el.classList.add('is-in');
    if ('IntersectionObserver' in window) {
      const io = new IntersectionObserver((entries) => {
        for (const e of entries) if (e.isIntersecting) { show(e.target); io.unobserve(e.target); }
      }, { rootMargin: '0px 0px -8% 0px' });
      targets.forEach((el) => io.observe(el));
      // The safety net. Not a fallback for old browsers — a fallback for us.
      setTimeout(() => targets.forEach(show), 2000);
    } else {
      targets.forEach(show);
    }
  }

  // ── dashboard actions ────────────────────────────────────────────────────
  /*
   * No handlers for `[data-connect]` or `[data-revoke]` any more.
   *
   * They posted to `/api/ad-connections/*`, which issued its own secret and
   * called the result active — the dashboard could show a verified connection
   * that had never verified anything, and revoke had no ownership check. The
   * network page does all of it as a real form post, which also means it works
   * without JavaScript.
   */

  // ── the seller's file list: selection ────────────────────────────────────
  /*
   * Progressive enhancement, and the enhancement is only ever a COUNT and a
   * sticky position. The form, the checkboxes and the four action buttons are in
   * the markup and work with this file absent — which is the point: a bulk action
   * that only exists once a script has run is a bulk action that disappears on a
   * bad connection, and this is the page somebody uses to take a leak down.
   *
   * What it adds:
   *
   *   - the live count in the bar, so "3 selected" is visible while scrolling;
   *   - the header box, which is indeterminate when some rows are ticked, and
   *     selects THIS PAGE — never "everything matching", which is its own control
   *     with its own label, because the ambiguity between the two is the hazard
   *     the whole pattern has to avoid;
   *   - "select all N matching", which clears the row boxes (so a file cannot be
   *     counted twice) and switches the form to the filter scope the server
   *     re-resolves at commit time.
   */
  const bulkForm = document.getElementById('bulk-form');
  if (bulkForm) {
    const boxes = Array.from(bulkForm.querySelectorAll('input[name="ids"]'));
    const header = document.getElementById('pick-page');
    const matching = document.getElementById('pick-matching');
    const scope = document.getElementById('bulk-scope');
    const bar = document.getElementById('bulk-bar');
    const count = document.getElementById('bulk-count');
    const clear = document.getElementById('bulk-clear');
    const selectable = boxes.filter((b) => !b.disabled);

    const refresh = () => {
      const ticked = selectable.filter((b) => b.checked).length;
      const allMatching = Boolean(matching && matching.checked);
      if (header) {
        // The page control is the tri-state one now: on, off, or neither — which is
        // the part of the header-checkbox convention worth keeping, on a control
        // that also says in words what it selects.
        header.checked = ticked > 0 && ticked === selectable.length;
        header.indeterminate = ticked > 0 && ticked < selectable.length;
      }
      if (scope) scope.value = allMatching ? 'matching' : 'page';
      const total = matching ? Number(matching.dataset.total || 0) : 0;
      if (count) {
        count.textContent = allMatching
          ? `${total} file${total === 1 ? '' : 's'} matching this search`
          : ticked ? `${ticked} file${ticked === 1 ? '' : 's'} picked`
            : 'No files picked';
      }
      // Sticky only once something is picked: a bar pinned to the bottom of the
      // window on a page where nothing is selected is furniture over content.
      if (bar) bar.classList.toggle('is-live', allMatching || ticked > 0);
    };

    for (const b of selectable) b.addEventListener('change', () => {
      // Ticking a row by hand is the other way of saying "not all of them".
      if (b.checked && matching) matching.checked = false;
      refresh();
    });
    header?.addEventListener('change', () => {
      for (const b of selectable) b.checked = header.checked;
      if (matching) matching.checked = false;
      refresh();
    });
    matching?.addEventListener('change', () => {
      if (matching.checked) for (const b of selectable) b.checked = false;
      refresh();
    });
    clear?.addEventListener('click', () => {
      for (const b of selectable) b.checked = false;
      if (matching) matching.checked = false;
      if (header) { header.checked = false; header.indeterminate = false; }
      refresh();
    });
    // A bulk action with nothing picked should say so rather than post an empty
    // selection and come back with a refusal the page could have given itself.
    bulkForm.addEventListener('submit', (event) => {
      if (!selectable.some((b) => b.checked) && !(matching && matching.checked)) {
        event.preventDefault();
        if (count) count.textContent = 'Pick a file first — nothing is selected.';
        if (bar) bar.classList.add('is-live');
      }
    });
    refresh();
  }

})();
