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
    // The blocker hint, shown from the moment the ad frame opens.
    const hint = $('#ad-hint');
    const providerLine = $('#ad-provider');
    const statusEl = $('#unlock-status');

    let poll = null;
    let ticker = null;
    // One unlock attempt, which may take more than one ad. The attempt is the
    // server's row, not a browser idea: `requiredViews` of them have to be
    // proven by signed postbacks before anything opens. Kept across a closed
    // modal on purpose — a person who stops half way and comes back should
    // continue from what they already watched, not start the ask again.
    let attempt = null;

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

    const finish = async (viewId, assetId, creditedBefore = 0) => {
      clearInterval(ticker);
      if (countEl) countEl.textContent = '✓';
      // The status has to change here. It said "Starting…" while a view was being
      // started, and it went on saying it through the whole minute and a half of
      // polling afterwards — a browser pass found the page still reporting "Starting…"
      // 102 seconds after the click, with the button disabled and no explanation. A
      // person cannot tell the difference between slow and broken, so the page says
      // which one it is.
      setStatus('Waiting for the ad network to confirm…');
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
        // The ad was credited and the file asks for more than one. The next ad
        // belongs to the SAME attempt — starting a new one would create a new
        // ask, and the page promised this file's ask, not twice the ask.
        if (Number(s.viewsDone) > creditedBefore && Number(s.viewsDone) < Number(s.viewsRequired)) {
          if (attempt) attempt.viewsDone = Number(s.viewsDone);
          // No line is printed here on purpose. The next ad's own sentence says
          // the same thing and STAYS on screen ("Ad 2 of 2. The first view was
          // credited."); a separate sentence set at this instant is replaced
          // within milliseconds and is therefore read by nobody.
          if (note) {
            note.textContent = 'This file asks for more than one view. The unlock is not granted yet.';
            note.style.color = '';
          }
          await runAd(assetId);
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
      // A second ad on the same file reuses the attempt the first one opened.
      // Before playing it, the progress is re-read from the server: the counts
      // are the network's, and a person who closed the modal mid-ask must not be
      // charged for the views they already sat through.
      if (attempt) {
        const s = await api(`/api/unlock/status?assetId=${encodeURIComponent(assetId)}`
          + `&viewId=${encodeURIComponent(attempt.viewId)}`);
        if (s.unlocked) { location.reload(); return; }
        attempt.viewsDone = Number(s.viewsDone) || 0;
        attempt.adConfig = { ...attempt.adConfig, requiredViews: Number(s.viewsRequired) || 1 };
      }

      const start = attempt
        ? { ok: true, viewId: attempt.viewId, adConfig: attempt.adConfig }
        : await api('/api/unlock/start', {
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
      // How many views this file asks for, and how many the network has already
      // proved. The number is the server's; the browser only counts up to it.
      const viewsRequired = Math.max(1, Number(cfg.requiredViews) || 1);
      // A resumed ask arrives with its own progress: the attempt is the server's
      // row, so somebody who reloaded half way is not asked for the first view
      // again, and the panel says which view this is.
      const creditedSoFar = Math.max(Number(attempt?.viewsDone) || 0, Number(start.viewsDone) || 0);
      const thisAd = Math.min(creditedSoFar + 1, viewsRequired);
      if (!attempt) attempt = { viewId: start.viewId, adConfig: cfg, viewsDone: creditedSoFar };

      // What is owed, said once — and said for the whole ad rather than in the
      // instant between two of them. The credited views are named because the
      // fear this screen has to answer is "does the next one start the count
      // again?", and the answer has to be on screen while it is being asked.
      const creditedTail = creditedSoFar === 0
        ? 'The next one is asked for only if this one is credited.'
        : `${creditedSoFar === 1 ? 'The first view was credited' : `${creditedSoFar} views credited`}. `
          + (viewsRequired - creditedSoFar === 1 ? 'This is the last one.' : 'One more follows this one.');
      setStatus(viewsRequired > 1
        ? `Ad ${thisAd} of ${viewsRequired}. ${creditedTail}`
        : 'Starting…');

      // The modal's own line about the ask, kept in step with the one above it:
      // "the second one is asked for only if the first is credited" is the right
      // sentence while it is still a question, and the wrong one once the first
      // view is credited and the second ad is already playing.
      const askTail = $('#ad-ask-tail');
      if (askTail && viewsRequired > 1) askTail.textContent = `. ${creditedTail}`;
      if (providerLine) providerLine.textContent = `${cfg.providerId} · rewarded video`;
      if (modal) modal.hidden = false;
      if (note) {
        note.textContent = 'The unlock is not granted by this screen. It arrives from the provider\'s '
          + 'server, signed, and is verified before the download link appears.';
        note.style.color = '';
      }
      // The first rung of the ladder, delivered where a person is actually waiting.
      // The server's rungs explain a FAILED attempt, which in a blocked browser takes
      // a minute and a half to become one; this says the useful thing in the meantime,
      // politely, without naming a browser or accusing anybody — the platform still
      // does not know why an ad did not appear, and it says so.
      if (hint) {
        hint.textContent = 'If nothing appears in a few seconds, an ad blocker is the usual reason. '
          + 'Allowing ads for this page is what fixes it, and this button will still be here.';
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

      setTimeout(() => finish(start.viewId, assetId, creditedSoFar), seconds * 1000 + 400);
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

  /*
   * ── THE BREAK GATE ────────────────────────────────────────────────────────
   *
   * A file whose access is "Free to open — a view inside" stops at the cues its
   * seller's plan placed, asks for a rewarded view, and goes on when the ad
   * NETWORK has confirmed it. The cues come from the server (`data-cues`), the
   * confirmation comes from the server (`/api/unlock/status`), and this code
   * decides neither — it only stops the playhead and puts it back.
   *
   * WHAT THIS IS, AND WHAT IT IS NOT. It is a pause, verified server-side, that
   * cannot be forged: a client that lies about the ad still cannot make the server
   * say "credited", and the status route is what releases the playhead. It is NOT
   * DRM. A viewer with devtools can seek past a cue, exactly as anyone can
   * screenshot a page or download a signed URL they hold. The forward-seek clamp
   * below stops the ordinary way of skipping a break — scrubbing the bar — and
   * nothing here pretends to stop the other. That is the trade the mode exists on:
   * a door more people walk through, priced by a pause most of them sit through.
   *
   * Files that ask AT the door are untouched by all of this. Their access is a row
   * in the database, checked before a single byte is minted.
   */
  document.querySelectorAll('[data-cues]').forEach((stage) => {
    const el = stage.querySelector('video[src], audio[src]');
    if (!el) return;
    let cues = [];
    try { cues = JSON.parse(stage.dataset.cues || '[]'); } catch { cues = []; }
    if (!cues.length) return;
    const assetId = stage.dataset.assetId;
    const breakUrl = stage.dataset.breakUrl;
    if (!assetId || !breakUrl) return;

    // Cues already paid for in this sitting. The server is the record — this is
    // only what saves a second postback round trip after a rewind.
    const cleared = new Set();
    const nextCue = () => cues.find((c) => !cleared.has(c.index) && el.currentTime + 0.35 >= c.atSec);
    let gating = false;
    /*
     * Where this person is on the blocker ladder (§14.7), as rendered by the server on
     * this stage and refreshed by every report. The harsh rung means the OFFER goes, not
     * the file: the player stops stopping at cues, and says so once in the rung's own
     * words. Nothing here decides a rung; it reads one.
     */
    let rung = stage.dataset.rungOffers
      ? { offersUnlock: stage.dataset.rungOffers !== 'false', player: stage.dataset.rungWords || null }
      : null;
    let saidWithheld = false;
    // Set while a break is on screen, so the ✕ can end the wait. See the handler.
    let declineBreak = null;

    const modal = $('#ad-modal');
    const countEl = $('#ad-count');
    const progress = $('#ad-progress');
    const note = $('#ad-note');
    const hint = $('#ad-hint');
    const providerLine = $('#ad-provider');
    const titleEl = $('#ad-title');
    const askLine = $('#ad-ask-tail');
    const statusEl = $('#unlock-status');
    let ticker = null;

    const say = (text, kind = '') => {
      if (!statusEl) return;
      statusEl.textContent = text;
      statusEl.style.color = kind ? `var(--${kind}-text)` : '';
    };

    /*
     * A failed break is REPORTED, not guessed at — the same rule the door follows, and
     * the reason a cue break reaches the ladder at all. The client says which of three
     * things happened; the server decides what it means and answers with the rung.
     */
    const reportBlocked = async (signal, viewId = null) => {
      try {
        const r = await api('/api/unlock/blocked', {
          method: 'POST',
          body: JSON.stringify({ assetId, viewId, signal }),
        });
        if (!r.ok || !r.rung) return null;
        rung = { ...r.rung };
        return rung;
      } catch {
        return null;
      }
    };

    /** Wait for the network's confirmation — the only thing that releases the player. */
    const waitForCredit = async (viewId) => {
      const deadline = Date.now() + 90_000;
      while (Date.now() < deadline) {
        const s = await api(`/api/unlock/status?assetId=${encodeURIComponent(assetId)}`
          + `&viewId=${encodeURIComponent(viewId)}`);
        if (Number(s.viewsDone) >= Number(s.viewsRequired)) return true;
        await new Promise((r) => setTimeout(r, 1500));
      }
      return false;
    };

    /*
     * The last rung, inside a player (§14.7): the OFFER goes, never the file.
     *
     * The cue is marked as passed and the rung's own words are said ONCE. This is a
     * function rather than a branch because there are two doors into an ask — the
     * playhead reaching the cue, and a person pressing play while it is already at one
     * — and the withheld rung has to hold at both. It guarded only the second when this
     * round was written, which the walk below caught: a viewer whose playhead crossed
     * the cue mid-playback still got the modal, and the rung looked enforced because the
     * test matched the guard that existed.
     */
    const passOver = (cue) => {
      cleared.add(cue.index);
      if (!saidWithheld && rung?.player) { saidWithheld = true; say(rung.player); }
    };
    const withheldRung = () => Boolean(rung && rung.offersUnlock === false);

    const runBreak = async (cue) => {
      if (withheldRung()) return passOver(cue);
      gating = true;
      // The escape hatch is armed BEFORE anything is asked of the network, so the
      // ✕ works from the first frame the modal is on screen. It was armed after the
      // simulated call returned, which meant that in a slow sandbox the button was
      // dead for exactly as long as the request took — found by holding that
      // request open in a browser walk and clicking it.
      const declined = new Promise((resolve) => { declineBreak = () => resolve('declined'); });
      el.pause();
      const position = cues.filter((c) => c.index <= cue.index || cleared.has(c.index)).length;
      const start = await api(breakUrl, {
        method: 'POST',
        body: JSON.stringify({ assetId, cueIndex: cue.index }),
      });
      if (!start.ok) {
        // A break that cannot start does not hold the file hostage: the person
        // gets the rest of what they came for, and the store's evidence page is
        // what records that the view did not run.
        say(start.error || 'Could not start a view. Playing on.', 'danger');
        gating = false;
        el.play().catch(() => {});
        return;
      }
      const seconds = Number(start.adConfig?.minSeconds) || 15;
      if (titleEl) titleEl.textContent = 'Your ad is playing';
      // No leading period: on an `ad_gated` file this span CONTINUES the door's
      // sentence ("…to unlock this file. The next one is…"), but a file with breaks
      // has no door sentence to continue, so the span starts the line and used to
      // render as a floating full stop before "Break 1 of 2".
      if (askLine) askLine.textContent = `Break ${position} of ${cues.length} in this file.`;
      if (providerLine) providerLine.textContent = `${start.adConfig.providerId} · rewarded video`;
      if (note) {
        note.textContent = 'The player moves on when the network confirms the view, not when this '
          + 'countdown ends.';
        note.style.color = '';
      }
      if (hint) {
        hint.textContent = 'If nothing appears in a few seconds, an ad blocker is the usual reason. '
          + 'Allowing ads for this page is what fixes it.';
      }
      if (countEl) countEl.textContent = String(seconds);
      if (progress) progress.style.width = '0%';
      if (modal) modal.hidden = false;
      say(`Break ${position} of ${cues.length}…`);
      let left = seconds;
      clearInterval(ticker);
      ticker = setInterval(() => {
        left -= 1;
        if (countEl) countEl.textContent = String(Math.max(left, 0));
        if (progress) progress.style.width = `${Math.min(((seconds - left) / seconds) * 100, 100)}%`;
        if (left <= 0) clearInterval(ticker);
      }, 1000);

      // The sandbox network, exactly as the door's flow drives it. A real
      // integration never calls this: the network calls us. Not awaited, because
      // nothing on this page depends on its answer — the postback is what the wait
      // below is waiting for, and whether it lands in 30ms or three seconds must not
      // decide whether a person can leave. A failure here IS reported, because an ad
      // that never started is the first thing the ladder exists to notice.
      if (start.adConfig?.devSimulator) {
        api(`/dev/simulate-network/${encodeURIComponent(start.adConfig.providerId)}`, {
          method: 'POST',
          body: JSON.stringify({
            viewId: start.viewId,
            connectionId: start.adConfig.connectionId,
            durationSec: seconds,
          }),
        }).catch(() => { reportBlocked('script_blocked', start.viewId); });
      }

      // What releases the playhead is the network, not the countdown — so closing
      // the break is a RACE with the postback rather than a decision made here. A
      // person who leaves while the postback is in flight still has it credited.
      const outcome = await Promise.race([
        waitForCredit(start.viewId).then((ok) => (ok ? 'credited' : 'unconfirmed')),
        declined,
      ]);
      declineBreak = null;
      clearInterval(ticker);
      if (modal) modal.hidden = true;
      gating = false;
      /*
       * Asked once per sitting, whatever came of it.
       *
       * A cue that stayed uncleared would be re-asked on the very next timeupdate,
       * which is a modal that reappears every ninety seconds for a person whose
       * network is slow — and a promise this page has no business making, that the
       * next attempt will go differently. A reload is a new sitting, and both of
       * the sentences below say so in their own way.
       */
      cleared.add(cue.index);
      if (outcome === 'credited') {
        say(`Break ${position} of ${cues.length} — confirmed. Playing on.`, 'success');
        // Back to the cue, not forward past it: the few hundred milliseconds the
        // pause consumed are replayed rather than lost.
        el.currentTime = cue.atSec;
        el.play().catch(() => {});
      } else if (outcome === 'declined') {
        // The door's modal has a ✕ and this one is the same modal. On a file with
        // breaks there is no door, so the button had NO handler at all — a close
        // button that closed nothing, found by clicking it. It closes the wait now,
        // and the sentence is the honest description of what that costs: the store
        // loses the impression, the viewer loses nothing, because the file was
        // theirs before the break started.
        say(`Break ${position} of ${cues.length} dropped. The file keeps playing — the store was `
          + 'not credited for that view.', 'warning');
        el.play().catch(() => {});
        reportBlocked('declined', start.viewId);
      } else {
        // No view arrived. This used to be a sentence that blamed the network, repeated at
        // every cue for ever, with the store credited for none of them. The failure is
        // reported now, and the words that come back are the rung's own — including the
        // last one, which withdraws the ASK rather than the file.
        const after = await reportBlocked('no_postback', start.viewId);
        say(after?.player || rung?.player || 'The network has not confirmed that view yet. You can keep '
          + 'watching — reload to try the break again.', after?.offersUnlock === false ? '' : 'danger');
        el.play().catch(() => {});
      }
    };

    /*
     * The ✕, for a break.
     *
     * The door wires its own ✕ only when the door exists, so nothing was listening
     * here. Wired to a race rather than a cancellation, because the postback may
     * already be on its way — see runBreak.
     */
    $('#ad-close')?.addEventListener('click', () => {
      if (gating && declineBreak) declineBreak();
    });

    el.addEventListener('timeupdate', () => {
      if (gating) return;
      const cue = nextCue();
      if (cue) runBreak(cue).catch(() => { gating = false; });
    });

    // Scrubbing past an unpaid cue lands on the cue instead. This is the whole
    // "gate" in the ordinary case, and the reason the countdown is not the thing
    // being trusted.
    el.addEventListener('seeking', () => {
      if (gating) return;
      const cue = cues.find((c) => !cleared.has(c.index) && el.currentTime > c.atSec + 1
        && cues.filter((x) => x.index < c.index).every((x) => cleared.has(x.index)));
      if (cue) el.currentTime = cue.atSec;
    });

    // A person who leaves mid-break and comes back gets the pause again, and the
    // server remembers nothing about the modal — which is the right place for that
    // state to live.
    el.addEventListener('play', () => {
      /*
       * An ask owns the playhead. Pressing play while the modal is up used to fall
       * straight through this handler — `gating` was set, so nothing paused the file —
       * and a viewer could dismiss a break by ignoring it, with the countdown still
       * running: the ask looked enforced and was not. The break resumes playback itself
       * when it is credited, dropped or passed over, so the right answer here is to
       * take the playhead back.
       */
      if (gating) { el.pause(); return; }
      const cue = nextCue();
      if (!cue) return;
      // Resuming AT a cue: the same pass-over, before the pause rather than instead of
      // it — `runBreak` would get there, and this saves the modal a frame on screen.
      if (withheldRung()) return passOver(cue);
      el.pause();
      // And the ask itself, so a person who returns to a file at the cue they left it on
      // is asked again rather than played past: `timeupdate` is not guaranteed to fire
      // while the playhead sits where it already is.
      runBreak(cue).catch(() => { gating = false; });
    });
  });

  /*
   * ── THE READER'S GATE ─────────────────────────────────────────────────────
   *
   * The same verified view as a break in a player, asked at a seam instead of at a
   * timestamp: the reader stops at the end of a segment, this starts an attempt, and
   * the page turns when the NETWORK has confirmed it. Nothing here decides that a
   * view happened, and the button cannot make a page appear: the route that serves
   * the bytes does its own check, so a client that lied would still get a 403.
   *
   * `location.assign` rather than a history entry: the page after a cleared seam is
   * where the person was going, not a place they navigated to from the gate.
   */
  document.querySelectorAll('[data-reader-gate]').forEach((button) => {
    const panel = button.closest('.reader-gate');
    const statusEl = panel ? $('#reader-gate-status', panel) : null;
    const say = (text, kind = '') => {
      if (!statusEl) return;
      statusEl.textContent = text;
      statusEl.style.color = kind ? `var(--${kind}-text)` : '';
    };
    const modal = $('#ad-modal');
    const countEl = $('#ad-count');
    const progressEl = $('#ad-progress');
    const providerLine = $('#ad-provider');
    const titleEl = $('#ad-title');
    const askLine = $('#ad-ask-tail');
    let ticker = null;
    let cancelled = false;
    // The ladder's state for this file, rendered by the server on the button and
    // refreshed by every report — never decided here (§14.7).
    let rung = button.dataset.rungOffers
      ? { offersUnlock: button.dataset.rungOffers !== 'false', words: button.dataset.rungWords || null }
      : null;

    $('#ad-close')?.addEventListener('click', () => { cancelled = true; });

    /* A failed seam is reported like every other failed view, and the answer is a rung. */
    const reportBlocked = async (signal, viewId = null) => {
      try {
        const r = await api('/api/unlock/blocked', {
          method: 'POST',
          body: JSON.stringify({ assetId: button.dataset.assetId, viewId, signal }),
        });
        if (!r.ok || !r.rung) return null;
        rung = { ...r.rung };
        return rung;
      } catch {
        return null;
      }
    };

    button.addEventListener('click', async () => {
      const assetId = button.dataset.assetId;
      const next = button.dataset.next;
      const cueIndex = Number(button.dataset.cueIndex) || 0;
      if (!assetId || !next) return;
      button.disabled = true;
      say('Starting the view…');
      const start = await api(button.dataset.breakUrl || '/api/unlock/break', {
        method: 'POST',
        body: JSON.stringify({ assetId, cueIndex }),
      });
      if (!start.ok) {
        say(start.error || 'Could not start a view. Nothing was charged and no page was turned.', 'danger');
        button.disabled = false;
        return;
      }
      const seconds = Number(start.adConfig?.minSeconds) || 15;
      if (titleEl) titleEl.textContent = 'Your ad is playing';
      if (askLine) askLine.textContent = 'One view, then the next page.';
      if (providerLine) providerLine.textContent = `${start.adConfig.providerId} · rewarded video`;
      if (countEl) countEl.textContent = String(seconds);
      if (progressEl) progressEl.style.width = '0%';
      if (modal) modal.hidden = false;
      say('Waiting for the network to confirm the view…');
      let left = seconds;
      clearInterval(ticker);
      ticker = setInterval(() => {
        left -= 1;
        if (countEl) countEl.textContent = String(Math.max(left, 0));
        if (progressEl) progressEl.style.width = `${Math.min(((seconds - left) / seconds) * 100, 100)}%`;
        if (left <= 0) clearInterval(ticker);
      }, 1000);

      if (start.adConfig?.devSimulator) {
        api(`/dev/simulate-network/${encodeURIComponent(start.adConfig.providerId)}`, {
          method: 'POST',
          body: JSON.stringify({
            viewId: start.viewId,
            connectionId: start.adConfig.connectionId,
            durationSec: seconds,
          }),
        }).catch(() => { reportBlocked('script_blocked', start.viewId); });
      }

      // The wait is on the SERVER's answer, never on the countdown — the same rule
      // the player follows, and the reason the ✕ is a cancellation of the wait rather
      // than a claim about the ad.
      const deadline = Date.now() + 90_000;
      let credited = false;
      while (Date.now() < deadline && !cancelled) {
        const s = await api(`/api/unlock/status?assetId=${encodeURIComponent(assetId)}`
          + `&viewId=${encodeURIComponent(start.viewId)}`);
        if (Number(s.viewsDone) >= Number(s.viewsRequired)) { credited = true; break; }
        await new Promise((r) => setTimeout(r, 1500));
      }
      clearInterval(ticker);
      if (modal) modal.hidden = true;
      if (credited) {
        say('Confirmed. Turning the page…', 'success');
        window.location.assign(next);
        return;
      }
      button.disabled = false;
      if (cancelled) {
        // A cancellation is a choice about one's own time, recorded and never climbed on.
        say('Dropped. The page is still where it was, and the store was not credited for that view.', 'warning');
        reportBlocked('declined', start.viewId);
        return;
      }
      const after = await reportBlocked('no_postback', start.viewId);
      // The reader's own tail, not the player's: this surface's rung says what a shut
      // seam costs, which is not what a paused playhead costs.
      say(after?.reader || rung?.words
        || 'The network has not confirmed that view yet. Reload to try the seam again.',
      after?.offersUnlock === false ? '' : 'warning');
    });
  });

  /*
   * ── WHERE SOMEBODY STOPPED ───────────────────────────────────────────────
   *
   * Posted when the STEP CHANGES, not when the page loads: a refresh, a crawler and a
   * preview all render a page without anybody reading it. The session remembers what
   * was last posted so moving back and forth does not write a row per click, and the
   * final post happens as the page is being hidden, which is the closest a browser
   * gets to "they left here".
   */
  const reader = $('[data-reader]');
  if (reader) {
    const assetId = reader.dataset.assetId;
    const step = Number(reader.dataset.readerStep) || 1;
    const progressUrl = reader.dataset.progressUrl;
    const key = assetId ? `bytebikri:read:${assetId}` : null;
    const last = key ? Number(sessionStorage.getItem(key)) || 0 : 0;
    if (assetId && progressUrl && step !== last) {
      api(progressUrl, { method: 'POST', body: JSON.stringify({ assetId, step }) })
        .then((r) => { if (r.ok && key) sessionStorage.setItem(key, String(step)); })
        .catch(() => { /* losing a bookmark is not worth a visible error */ });
    }

    // Arrow keys, the way every reader has them — and they follow the FILE's
    // direction, so a manga store's right arrow goes back.
    const rtl = reader.dataset.direction === 'rtl';
    document.addEventListener('keydown', (ev) => {
      if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
      const tag = (ev.target?.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || ev.target?.isContentEditable) return;
      const forward = rtl ? 'ArrowLeft' : 'ArrowRight';
      const back = rtl ? 'ArrowRight' : 'ArrowLeft';
      const href = ev.key === forward ? reader.dataset.next : (ev.key === back ? reader.dataset.prev : null);
      if (href) window.location.assign(href);
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

  /*
   * THE LENGTH OF A FILE, MEASURED BY THE THING THAT KNOWS.
   *
   * Slice 3 places a break inside a file, and it needs to know how long the file
   * is. Both easier answers were refused: `ffprobe` on the server (a second media
   * stack for a number the browser already has) and a box for the seller to type
   * minutes into. So the player reports what it measured, once per page load, and
   * the server keeps it if nothing better is there.
   *
   * It is only sent when the element actually loaded metadata: a duration of NaN
   * on a link that failed would be a file whose length is "unknown" forever.
   */
  document.querySelectorAll('video[src], audio[src]').forEach((el) => {
    const assetId = el.closest('[data-asset-id]')?.dataset.assetId;
    if (!assetId) return;
    el.addEventListener('loadedmetadata', () => {
      const seconds = Math.round(el.duration);
      if (!Number.isFinite(seconds) || seconds <= 0) return;
      api(`/api/assets/${encodeURIComponent(assetId)}/runtime`, {
        method: 'POST',
        body: JSON.stringify({ durationSec: seconds }),
      }).catch(() => {
        // Best effort by design: a file whose length never arrives simply gets no
        // break inside it, which is the same as it not having one. Nothing is
        // reported to the person watching — this is not a control they operate.
      });
    }, { once: true });
  });

  /*
   * ── WHERE SOMEBODY STOPPED, IN A PLAYER (§15.2) ──────────────────────────
   *
   * The reader's own block, in the shape video needs. Three moments write a position and
   * nothing else does: the file PAUSES, a timer ticks while it plays (so an hour with no
   * pause is not an hour of nothing), and the page is being hidden, which is the closest
   * a browser gets to "they left here". Never on load and never on metadata — a page that
   * rendered is not a page anybody watched.
   *
   * The position belongs to the person. It goes to one route, it is read to resume, no
   * seller surface can see it, and NO accounting path reads it: a credited view comes
   * from the network's signed postback, so a client that lies about where it is cannot
   * move a number in the ledger. `sessionStorage` only saves requests — the server is the
   * record, and writing the same position twice writes nothing there either.
   *
   * `data-watch` is on this player and deliberately NOT on the live stage: a stream is
   * joined at the edge, and "where somebody stopped" is a question about a file.
   */
  document.querySelectorAll('[data-watch]').forEach((el) => {
    const assetId = el.closest('[data-asset-id]')?.dataset.assetId;
    if (!assetId) return;

    /*
     * A FILE WHOSE BYTES ARE A PLAYLIST.
     *
     * The server marks the element when the storage key says the source is HLS
     * (`views.js mediaStage`, `VIDEO_STORAGE.md` §5) — it cannot be seen from here,
     * because the src is this app's own route and the host's answer is behind a
     * redirect. When it is marked, this element is not a file and the browser's own
     * `src` would render the black rectangle §14.2 is about: Chromium answers
     * `maybe` to `canPlayType('application/vnd.apple.mpegurl')` and has no HLS
     * demuxer at all. So the same vendored hls.js the live stage uses, in VOD mode.
     *
     * The differences from the live stage are the point of writing it twice:
     *
     *   * no `liveSyncDurationCount` — a VOD playlist is not a moving edge, and
     *     tuning it like one makes seeking behave like a stream jump;
     *   * `backBufferLength` and a real duration, so the position this player is
     *     asked to remember (`data-resume-at`, the bookmark) means what it says;
     *   * a fatal error says the file stopped rather than saying the stream did,
     *     because a viewer of a hosted file has no stream to reload.
     */
    const loadHls = () => new Promise((resolve, reject) => {
      if (window.Hls) return resolve(window.Hls);
      const script = document.createElement('script');
      script.src = '/vendor/hls.min.js';
      script.onload = () => (window.Hls ? resolve(window.Hls) : reject(new Error('no player')));
      script.onerror = () => reject(new Error('no player'));
      document.head.append(script);
    });

    if (el.dataset.hls === '1') {
      const nativeHls = typeof window.ManagedMediaSource !== 'undefined'
        || typeof window.MediaSource === 'undefined';
      if (nativeHls) {
        // Safari and anything else that plays HLS itself: the markup's own `src` is
        // the player, and there is nothing to attach — the same division of labour
        // the live stage uses on that engine.
      } else {
        const src = el.getAttribute('src');
        el.removeAttribute('src');
        loadHls().then((Hls) => {
          if (!Hls.isSupported()) throw new Error('no MSE');
          const player = new Hls({ enableWorker: true, backBufferLength: 30 });
          player.attachMedia(el);
          player.on(Hls.Events.MEDIA_ATTACHED, () => player.loadSource(src));
          player.on(Hls.Events.ERROR, (_event, data) => {
            if (!data?.fatal) return;
            /*
             * ONE WAY TO SAY A PLAYER FAILED. The block below this loop already
             * renders `.stage-error` from an element's `error` event, with a hint the
             * server can set per file. Adding a second message channel here would mean
             * two places to look when a viewer says "it went black" — so this sets the
             * hint and dispatches the event the existing handler listens for.
             */
            el.dataset.expiredHint = 'This file stopped playing. Reload the page, and if it does it again the '
              + 'file’s host is the problem — not your connection.';
            el.dispatchEvent(new Event('error'));
          });
        }).catch(() => {
          // The vendored file could not be loaded: put the address back, because an
          // empty stage plus an explanation helps nobody (the live stage's rule).
          el.setAttribute('src', src);
        });
      }
    }
    const key = `bytebikri:watch:${assetId}`;
    const say = (seconds, force = false) => {
      const at = Math.max(0, Math.floor(Number(seconds) || 0));
      if (!force) {
        const last = Number(sessionStorage.getItem(key));
        if (Number.isFinite(last) && Math.abs(last - at) < 2) return;
      }
      try { sessionStorage.setItem(key, String(at)); } catch { /* private mode */ }
      api('/api/watch/progress', { method: 'POST', body: JSON.stringify({ assetId, seconds: at }) })
        .catch(() => { /* losing a bookmark is not worth a visible error */ });
    };

    // The resume, which is a seek and not a jump cut: only once, and only if the file has
    // not already started for some other reason. The sentence beside the player was
    // rendered by the server, so this is the improvement, never the promise.
    const at = Number(el.dataset.resumeAt);
    if (Number.isFinite(at) && at > 0) {
      el.addEventListener('loadedmetadata', () => { if (!el.currentTime) el.currentTime = at; }, { once: true });
    }

    el.addEventListener('pause', () => { if (!el.ended) say(el.currentTime); });
    el.addEventListener('ended', () => {
      say(el.currentTime, true);
      // The next-episode control the design promises, revealed when the episode actually
      // ends. There is no countdown and nothing plays on its own: this is a link, with the
      // next episode's name on it, that a person has to take.
      const cta = document.querySelector('[data-next-cta]');
      if (cta) cta.hidden = false;
    });
    setInterval(() => { if (!el.paused && !el.ended) say(el.currentTime); }, 15_000);
    window.addEventListener('pagehide', () => { if (!el.ended) say(el.currentTime, true); });

    // "Start from the beginning". The link's own `?restart=1` is what happens when this
    // script is not running; here it becomes a seek, so the viewer keeps their page.
    const restart = document.querySelector('[data-resume-restart]');
    if (restart) {
      restart.addEventListener('click', (ev) => {
        ev.preventDefault();
        el.currentTime = 0;
        say(0, true);
        el.play().catch(() => { /* autoplay refusal is the browser's call to make */ });
      });
    }
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

// ── Shape chips on a store page ─────────────────────────────────────────────
//
// The chips are anchors in the markup, so with no JavaScript they jump to the
// section they name — the page still works, it just does not filter. This turns
// them into a filter: one kind at a time, pressing the same chip again puts the
// rest back. Nothing is removed from the document, so a filtered store page is
// still a complete one for anything reading it (a crawler, a find-in-page, or
// somebody who pasted the link).
(() => {
  const chips = [...document.querySelectorAll('[data-shape-chip]')];
  const groups = [...document.querySelectorAll('[data-shape-section]')];
  // One kind of thing is not a filter — and the server does not draw the row.
  if (chips.length < 2 || groups.length < 2) return;

  const clear = () => {
    for (const group of groups) group.hidden = false;
    for (const chip of chips) chip.setAttribute('aria-pressed', 'false');
  };

  for (const chip of chips) {
    chip.addEventListener('click', (event) => {
      const shape = chip.dataset.shapeChip;
      const already = chip.getAttribute('aria-pressed') === 'true';
      event.preventDefault();
      if (already) { clear(); return; }
      for (const group of groups) group.hidden = group.dataset.shapeSection !== shape;
      for (const c of chips) c.setAttribute('aria-pressed', String(c === chip));
      document.getElementById(`shape-${shape}`)?.scrollIntoView({ block: 'start' });
    });
  }

  clear();
})();

// ── The Plus stage: your own name, updating as you choose ────────────────────
//
// The shop window for a name effect. Every palette and every effect is a radio in
// the form the page already renders, so this reads the CHOICE off the DOM and the
// WORDS off the labels — there is no second copy of the palette table or the effect
// table here to drift out of date. Picking up a radio repaints the stage: the four
// palette custom properties, the effect class on the name, the caption line.
//
// Progressive enhancement, deliberately: with no JavaScript the stage still shows
// the saved look and the form still saves, because the markup is the state and this
// only re-draws it a little faster.
(() => {
  const stage = document.querySelector('[data-look-stage]');
  const form = document.querySelector('form.plus-look');
  if (!stage || !form) return;
  const nameEl = stage.querySelector('[data-look-name]');
  const line = stage.querySelector('[data-look-line]');
  if (!nameEl || !line) return;

  const checked = (field) => form.querySelector(`input[name=${field}]:checked`);
  const plateLabel = (input) => input?.closest('[data-plate-key]');
  const effectLabel = (input) => input?.closest('[data-effect-key]');

  const draw = () => {
    const plate = plateLabel(checked('nameplate'));
    const effect = effectLabel(checked('effect'));
    if (!plate || !effect) return;

    // The palette is four custom properties written on the label by the server — the
    // same string the swatch beside it paints with, so the stage and the swatch can
    // never disagree.
    stage.setAttribute('style', plate.getAttribute('style') || '');
    const demo = effect.querySelector('.plus-effect-demo [class*="wear-"]');
    nameEl.className = demo ? demo.className : 'member-name wear-solid';
    // The two outer layers, read off the picker's own tiles: the tile for the checked
    // ring is an initial already wearing that ring, and the tile for the checked frame
    // is a small card already edged with it. Both tiles are drawn by the server with
    // the product's own classes, so this copies a vocabulary instead of keeping a
    // second one in JavaScript.
    const avatarEl = stage.querySelector('[data-look-avatar]');
    const ringTile = checked('ring')?.closest('[data-demo-key]')?.querySelector('.look-avatar');
    if (avatarEl && ringTile) {
      // The classes a ring can be are `wear-ring` (the ring this product has always
      // drawn, and what "orbit" and "no choice" both mean) plus one `ring-<key>` for
      // everything else. This used to enumerate the keys of the day — `ring-(none|
      // hairline|double)` — so when the vocabulary grew, the outgoing treatment was no
      // longer stripped and the avatar accumulated both: choosing Split right after
      // Orbit painted `ring-split` beside a live `wear-ring`, and switching rings left
      // the previous one on. A pattern that is derived from the naming rule cannot fall
      // behind it.
      const keep = [...avatarEl.classList].filter((c) => !/^wear-ring$|^ring-[\w-]+$/.test(c));
      avatarEl.className = [...keep, ...[...ringTile.classList].filter((c) => c !== 'look-avatar')].join(' ');
    }
    const frameTile = checked('frame')?.closest('[data-demo-key]')?.querySelector('.look-frame');
    if (frameTile) {
      const keep = [...stage.classList].filter((c) => !/^frame-/.test(c));
      stage.className = [...keep, ...[...frameTile.classList].filter((c) => c.startsWith('frame-'))].join(' ');
    }

    const moving = effect.dataset.effectMoves === 'yes';
    line.textContent = `${effect.dataset.effectLabel} in ${plate.dataset.plateLabel}`
      + (moving
        ? ' · moving in front of you, and still for anyone whose device asks for less motion'
        : ' · completely still');
  };

  form.addEventListener('change', draw);
  form.addEventListener('input', draw);
})();

// ── The theme chooser's stage: see the band before you keep it ───────────────
//
// The cards below already show each palette, but a 58-pixel card cannot show what a
// whole BAND does — and the interesting half of a paid theme is that it moves. So
// pointing at a card (or tabbing to it) paints the storefront's own band, above the
// grid, with the seller's real name and tagline on it.
//
// Nothing about saving changes: the card is still a submit button, one click, no
// confirmation step added to a decision that used to be one press. This only makes
// the press informed. The stage restores the CURRENT theme when the pointer leaves,
// so the page never lies about what the store looks like right now.
(() => {
  const stage = document.querySelector('[data-theme-stage]');
  const band = stage?.querySelector('[data-theme-stage-band]');
  const line = stage?.querySelector('[data-theme-stage-line]');
  const cards = [...document.querySelectorAll('[data-theme-card]')];
  if (!stage || !band || !line || !cards.length) return;

  const current = { style: stage.dataset.currentStyle || '', label: stage.dataset.currentLabel || 'Default' };
  const draw = ({ style, label, preview }) => {
    band.setAttribute('style', style || '');
    band.classList.toggle('store-head--themed', Boolean(style));
    // textContent, not innerHTML: presentation code writes text, never markup. The
    // server's first paint bolds the label; a repaint by a pointer moving says the
    // same sentence without it, which costs nothing and keeps the rule this codebase
    // already holds itself to.
    line.textContent = preview
      ? `Previewing ${label} — press the card to keep it, or move away to leave things as they are.`
      : `Showing ${label} — point at a card to see it here, and press the card to keep it.`;
  };

  let showing = 'current';
  const show = (card, preview) => {
    if (!card) { showing = 'current'; draw({ ...current, preview: false }); return; }
    const style = card.dataset.themeStyle || '';
    const label = card.dataset.themeLabel || 'Default';
    // The "Default" card has no palette: the stage has to drop the themed class, not
    // paint an empty gradient, or the preview would show a band the store cannot have.
    showing = card.dataset.themeCard;
    draw({ style, label, preview });
  };

  for (const card of cards) {
    card.addEventListener('mouseenter', () => show(card, true));
    card.addEventListener('focusin', () => show(card, true));
  }
  const grid = cards[0].closest('.theme-grid') || document;
  grid.addEventListener('mouseleave', () => show(null, false));
  grid.addEventListener('focusout', (event) => {
    if (!grid.contains(event.relatedTarget)) show(null, false);
  });
})();

/*
 * ── THE LIVE SURFACE (§14) ────────────────────────────────────────────────
 *
 * A live file is the store's own stream: their host serves it, this browser fetches
 * it from them, and nothing about it passes through us. Two things are ours to do.
 *
 * The first is playback. Safari plays HLS from a plain `src`; Chrome, Firefox, Edge
 * and Android do not, so they get the vendored hls.js — loaded on demand, from our
 * own origin, and never from a CDN (the CSP has no third-party script host, and the
 * vendored copy is pinned by a test).
 *
 * The second is the break. The page is rendered with the one window this viewer has
 * not been served, and this code asks the server every ~15 seconds whether a new one
 * has been called. A break is NOT decided here and cannot be: no cue list, no timer,
 * no invented interruption — the only thing that can produce an ask is a row the
 * store's own POST created, which is what "the platform never inserts a break" means
 * in practice.
 *
 * A break ends at the LIVE EDGE, not where the viewer was. A stream does not wait,
 * and pretending otherwise would be the page lying about what it can give back.
 */
(() => {
  'use strict';

  const root = document.querySelector('[data-live]');
  if (!root) return;

  const video = root.querySelector('video');
  const statusEl = root.querySelector('[data-live-status]');
  const modal = document.querySelector('#ad-modal');
  const assetId = root.dataset.assetId;
  const url = root.dataset.url;
  const stateUrl = root.dataset.stateUrl;
  const viewUrl = root.dataset.viewUrl;
  const pollSeconds = Math.max(5, Number(root.dataset.pollSeconds) || 15);
  if (!video || !assetId || !url || !stateUrl || !viewUrl) return;

  const say = (text, kind = '') => {
    if (!statusEl) return;
    statusEl.textContent = text;
    statusEl.style.color = kind ? `var(--${kind}-text)` : '';
  };

  const api = async (target, options = {}) => {
    const res = await fetch(target, {
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      ...options,
    });
    return { status: res.status, ...(await res.json().catch(() => ({ ok: false, error: 'unreadable response' }))) };
  };

  // ── playback ───────────────────────────────────────────────────────────────
  //
  // WHICH PLAYER, AND WHY NOT `canPlayType`. Chromium 153 answers `maybe` to
  // `canPlayType('application/vnd.apple.mpegurl')` — it CLAIMS native HLS — and then
  // fetches the playlist and plays nothing, because it has no HLS demuxer at all. A
  // player chosen by that answer is a black rectangle in the browser most viewers use,
  // which is the trap §14.2 was written about. The honest question is which media
  // source the browser has: with MediaSource Extensions, hls.js plays the stream
  // everywhere; on the one engine without them (Safari) `ManagedMediaSource` is how a
  // modern Safari announces itself, and the plain `src` in the markup is the player.
  const loadPlayer = () => new Promise((resolve, reject) => {
    if (window.Hls) return resolve(window.Hls);
    const script = document.createElement('script');
    script.src = '/vendor/hls.min.js';
    script.onload = () => (window.Hls ? resolve(window.Hls) : reject(new Error('no player')));
    script.onerror = () => reject(new Error('no player'));
    document.head.append(script);
  });

  const playNatively = typeof window.ManagedMediaSource !== 'undefined'
    || typeof window.MediaSource === 'undefined';

  if (!playNatively) {
    // The `src` would be an unplayable address for the player we are about to attach,
    // so it goes first — and comes back if the vendored file cannot be loaded, because
    // an empty stage plus an explanation helps nobody.
    video.removeAttribute('src');
    loadPlayer().then((Hls) => {
      if (!Hls.isSupported()) throw new Error('no MSE');
      const player = new Hls({ liveSyncDurationCount: 3, enableWorker: true });
      player.attachMedia(video);
      player.on(Hls.Events.MEDIA_ATTACHED, () => player.loadSource(url));
      player.on(Hls.Events.ERROR, (_event, data) => {
        if (data?.fatal) say('The stream stopped. Reload to pick it up again at the live edge.', 'danger');
      });
    }).catch(() => {
      video.setAttribute('src', url);
      say('The vendored player did not load, so this page is using the browser\u2019s own HLS support — '
        + 'which Safari has and Chrome does not.', 'warning');
    });
  }

  // ── the break ──────────────────────────────────────────────────────────────
  let gating = false;
  let decline = null;
  let declinedBreak = null;
  let declared = null;
  // Where the server says this person is on the blocker ladder for THIS file. Rendered
  // onto the element and refreshed by the state route, never decided here: the last rung
  // changes what is offered, and a client that could decide that for itself could decide
  // to un-decide it (§14.7).
  let rung = root.dataset.rungOffers
    ? { offersUnlock: root.dataset.rungOffers !== 'false', player: root.dataset.rungWords || null }
    : null;

  /*
   * A FAILED BREAK IS REPORTED, NOT GUESSED AT — the same rule the door follows.
   *
   * The client says which of three things happened (the ad never started, it started and
   * no postback arrived, the viewer chose not to watch) and the SERVER decides what that
   * means. `declined` is deliberately not a blocking signal: closing a break is a choice
   * about your own time, and the ladder must not climb for it.
   */
  const reportBlocked = async (signal, viewId = null) => {
    try {
      const r = await api('/api/unlock/blocked', {
        method: 'POST',
        body: JSON.stringify({ assetId, viewId, signal }),
      });
      if (!r.ok || !r.rung) return null;
      rung = { ...r.rung };
      return rung;
    } catch {
      return null;
    }
  };
  try { declared = root.dataset.stop ? JSON.parse(root.dataset.stop) : null; } catch { declared = null; }

  document.querySelector('#ad-close')?.addEventListener('click', () => {
    if (gating && decline) decline();
  });

  const seekToLiveEdge = () => {
    try {
      const { seekable } = video;
      if (seekable && seekable.length) {
        const edge = seekable.end(seekable.length - 1);
        if (Number.isFinite(edge)) video.currentTime = Math.max(edge - 0.5, 0);
      }
    } catch { /* nothing buffered yet: there is no edge to seek to */ }
  };

  const waitForCredit = async (viewId) => {
    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline) {
      const s = await api(`/api/unlock/status?assetId=${encodeURIComponent(assetId)}`
        + `&viewId=${encodeURIComponent(viewId)}`).catch(() => null);
      if (s && Number(s.viewsDone) >= Number(s.viewsRequired)) return true;
      await new Promise((r) => setTimeout(r, 1500));
    }
    return false;
  };

  /*
   * The window the ask belongs to, and whether it survived the ask.
   *
   * A break the store ends early leaves the person inside a modal for a window that no
   * longer exists. Cancelling their view would take their time and give back nothing —
   * neither the store's ad nor their own standing — so the ask is seen through and the
   * SENTENCE changes instead. §14.6 is the table; the fact comes from the state endpoint
   * (`lastClosed.early`), never from the browser's clock.
   */
  let asking = null;
  const windowEndedEarly = async () => {
    const state = await api(stateUrl).catch(() => null);
    const last = state?.lastClosed;
    return Boolean(last && last.breakId === asking?.breakId && last.early);
  };

  const runBreak = async (window_) => {
    if (!window_ || gating) return;
    // The harsh rung, on a stream: the OFFER is withheld, not the stream. No modal, no
    // countdown, no time taken — playback is not touched, and the stage says why. The
    // window is settled for this sitting, so the poller does not try it again.
    if (rung && rung.offersUnlock === false) {
      declinedBreak = window_.breakId;
      if (rung.player) say(rung.player);
      return;
    }
    gating = true;
    asking = window_;
    video.pause();
    const declined = new Promise((resolve) => { decline = () => resolve('declined'); });
    // Watched while the ask runs, and only then: a window can be closed by the store at
    // any moment, including one second after the modal appeared.
    const watcher = setInterval(() => {
      windowEndedEarly().then((early) => { if (early && asking) asking.early = true; });
    }, 4000);
    try {
      const start = await api(viewUrl, {
        method: 'POST',
        body: JSON.stringify({ assetId, breakId: window_.breakId }),
      });
      if (!start.ok) {
        // A break that cannot start does not hold the stream hostage: the viewer keeps
        // watching, and the store's own panel is where the miss is visible. The window
        // is remembered as settled so the poller does not put the same modal back up
        // fifteen seconds later, for ever.
        declinedBreak = window_.breakId;
        say(start.error || 'Could not start a view. Still watching at the live edge.', 'danger');
        video.play().catch(() => {});
        return;
      }
      const seconds = Number(start.adConfig?.minSeconds) || 15;
      const titleEl = document.querySelector('#ad-title');
      const askLine = document.querySelector('#ad-ask-tail');
      const providerLine = document.querySelector('#ad-provider');
      const note = document.querySelector('#ad-note');
      const countEl = document.querySelector('#ad-count');
      const progress = document.querySelector('#ad-progress');
      const hint = document.querySelector('#ad-hint');
      if (titleEl) titleEl.textContent = 'Your ad is playing';
      if (askLine) askLine.textContent = 'The store called this break. The stream keeps going; you come back at the live edge.';
      if (providerLine) providerLine.textContent = `${start.adConfig.providerId} · rewarded video`;
      if (note) note.textContent = 'The stream moves on when the network confirms the view, not when this countdown ends.';
      if (hint) hint.textContent = 'If nothing appears in a few seconds, an ad blocker is the usual reason.';
      if (countEl) countEl.textContent = String(seconds);
      if (progress) progress.style.width = '0%';
      if (modal) modal.hidden = false;
      let left = seconds;
      const ticker = setInterval(() => {
        left -= 1;
        if (countEl) countEl.textContent = String(Math.max(left, 0));
        if (progress) progress.style.width = `${Math.min(((seconds - left) / seconds) * 100, 100)}%`;
        if (left <= 0) clearInterval(ticker);
      }, 1000);

      // The sandbox network, exactly as the door and the timed break drive it. A real
      // integration never calls this: the network calls us.
      if (start.adConfig?.devSimulator) {
        // The sandbox network, exactly as the door drives it. A real integration never
        // calls this: the network calls us. A failure here is the ad not arriving, so it
        // is reported as one rather than swallowed.
        api(`/dev/simulate-network/${encodeURIComponent(start.adConfig.providerId)}`, {
          method: 'POST',
          body: JSON.stringify({
            viewId: start.viewId,
            connectionId: start.adConfig.connectionId,
            durationSec: seconds,
          }),
        }).catch(() => { reportBlocked('script_blocked', start.viewId); });
      }

      const outcome = await Promise.race([waitForCredit(start.viewId), declined]);
      clearInterval(ticker);
      // Asked once more before the sentence is chosen: the watcher ticks every four
      // seconds, and a window closed in the last of them must not be reported as a
      // window that ran out. One request, at the only moment the answer is read.
      if (outcome && !asking.early) asking.early = await windowEndedEarly();
      if (modal) modal.hidden = true;
      if (outcome === 'declined') {
        // Choosing not to watch is not evasion, and it is not a reason to hold the
        // stream: the window is remembered as settled for this sitting, so the poller
        // does not put the same modal back on screen fifteen seconds later.
        declinedBreak = window_.breakId;
        say('Break closed. You are back at the live edge — the stream kept going while it was up.');
        reportBlocked('declined', start.viewId);
      } else if (outcome && asking.early) {
        say('The store ended this break early. Your view was confirmed — back at the live edge.');
      } else if (outcome) {
        say('View confirmed. Back at the live edge — the stream moved on while the break ran.');
      } else {
        // No view arrived. The door's explanation was a countdown and a sentence that
        // blamed the network for ever; here the failure is REPORTED, and the words that
        // come back are the rung's own — including the last one, which withdraws the ask
        // rather than the stream.
        const after = await reportBlocked('no_postback', start.viewId);
        if (after && !after.offersUnlock) declinedBreak = window_.breakId;
        const tail = after?.player || rung?.player || null;
        if (asking.early) {
          say('The store ended this break early. The network has not confirmed the view yet — you are at the live edge.', 'warning');
        } else if (tail) {
          say(tail, after.offersUnlock ? 'warning' : '');
        } else {
          say('The network has not confirmed the view yet. Still watching at the live edge.', 'warning');
        }
      }
      seekToLiveEdge();
      video.play().catch(() => {});
    } finally {
      clearInterval(watcher);
      asking = null;
      gating = false;
    }
  };

  // A break that is running when the page opens stops this viewer too — they arrive
  // INTO it. One this viewer already settled is not asked twice.
  if (declared && declared.breakId !== declinedBreak) runBreak(declared).catch(() => {});

  const poll = async () => {
    if (gating) return;
    const state = await api(stateUrl).catch(() => null);
    if (!state || state.ok !== true) return;
    if (state.rung) rung = state.rung;
    const stop = state.stop;
    if (stop && stop.breakId !== declinedBreak) {
      await runBreak(stop).catch(() => {});
      return;
    }
    if (!stop && state.entry === 'covered' && state.cleanEntry) {
      // Coverage can open while somebody is reading the page: say so rather than
      // leaving the door's sentence stale.
      const line = root.querySelector('.live-door');
      if (line) line.textContent = state.cleanEntry;
    }
  };

  poll().catch(() => {});
  setInterval(() => { poll().catch(() => {}); }, pollSeconds * 1000);
})();
