/**
 * Where the ads sit, and why the seller cannot put one anywhere they like.
 *
 * A file with a playhead has more than one place an ad can go, and the shipped
 * product gives the seller none of them: every ask is a door — "watch 2 ads to
 * unlock" — which is the right shape for a download and a poor one for a 40-minute
 * lecture. Someone who wants to hear the lecture has to sit through two ads to
 * find out whether they want it, and the seller loses the ones who would have
 * stayed if the first minute had been free.
 *
 * So the ask stops being a number and becomes a number AND a place. The budget is
 * unchanged — the ladder in `adscale.js` still decides how much a file asks for,
 * capped by the plan — but where that budget lands is now a decision the seller
 * makes, from a menu the file's SHAPE decides.
 *
 * ── THE RULES, AND WHY THEY ARE NOT NEGOTIABLE ─────────────────────────────
 * Sources in ASSET_ECONOMY.md §5.2; the conclusions became these constraints:
 *
 *   1. NEVER IN THE FIRST TWO MINUTES, NEVER IN THE LAST NINETY SECONDS. The
 *      opening minutes are where a viewer decides whether the file is any good;
 *      the ending is where the payoff is. A break in either place is remembered
 *      as the ad, not the file.
 *   2. NEVER TWO BREAKS WITHIN FOUR MINUTES. The completion rate of the second of
 *      two adjacent breaks is bad enough that it costs more revenue than it adds.
 *   3. BETWEEN, NEVER INSIDE. A reader breaks at a chapter, never mid-page; a
 *      queue breaks between tracks, never during one. Rule 5 of the framework,
 *      enforced here by there being no code path that can produce a mid-page cue.
 *   4. LIVE IS THE SELLER'S, ALWAYS. A stream has no automatic break in this
 *      module at all — not disabled by a flag, absent from the table. The only
 *      breaks a live file has are the ones its owner announces.
 *   5. THE SELLER CAN ALWAYS TURN ONE OFF, AND CANNOT TURN ONE ON THAT THE SHAPE
 *      DOES NOT HAVE. `choices` is a set of opt-outs; the defaults come from the
 *      shape. A manhwa cannot be given a mid-roll because there is nothing to
 *      time one against, and a seller cannot create one by asking nicely.
 *
 * ── WHY THE PLAN IS DERIVED, LIKE THE ASK ──────────────────────────────────
 * Same reasoning as `adscale.js`: the number a person is asked for is a claim
 * about their attention, and the party with the least information about it should
 * not be the one typing it. The seller chooses WHICH breaks, from what the shape
 * allows, at the strength the plan permits; the placement of each cue inside the
 * file is computed from the measured runtime.
 *
 * ── WHERE A QUEUE BREAKS ───────────────────────────────────────────────────
 * An album is a list of tracks, and a break between two of them is a boundary the
 * file already has — the same reasoning as a reader's chapters, and the reason a
 * two-track single gets no break inside it: there is nowhere to put one that is not
 * simply the end of the file. A queue with no track structure falls back to a timed
 * break, which is why `listen` keeps both `mid` and `between` in the catalogue.
 *
 * Pure module. No database, no clock: the seller's page, the buyer's page and the
 * tests all read the same table.
 */

import { ceilingFor } from './adscale.js';

/** The catalogue. A shape can only use the placements it lists. */
export const PLACEMENTS = {
  pre: {
    key: 'pre', label: 'Before it starts',
    shapes: [], // the door: an ad-gated file's ask IS its pre-roll. An open file has no door.
    why: 'The door. An ad-gated file already has one, and a file that opens freely does not get a second.',
  },
  mid: {
    key: 'mid', label: 'Part-way through',
    shapes: ['watch', 'listen'],
    why: 'A short break at a point the rules allow, with the playhead to come back to.',
  },
  between: {
    key: 'between', label: 'Between chapters',
    shapes: ['read', 'listen'],
    why: 'A break at a boundary the file already has — a chapter, a track. Never inside one.',
  },
  post: {
    key: 'post', label: 'When it ends',
    shapes: ['watch', 'listen'],
    why: 'After the end, offered as "one more like this" — never a toll on something already watched.',
  },
  rewarded: {
    key: 'rewarded', label: 'At a failure state',
    shapes: ['play'],
    why: 'A game asks for a view when it can help: continue, an extra life, a hint. Nothing else.',
  },
  live: {
    key: 'live', label: 'At breaks you announce',
    shapes: ['stream'],
    why: 'A live break is the seller\u2019s, at a time they say out loud. The platform never inserts one.',
  },
  aside: {
    key: 'aside', label: 'On the page',
    shapes: ['download', 'read', 'watch', 'listen', 'play', 'stream'],
    why: 'The boxes beside the file, which every store already has and which never interrupt anything.',
  },
};

/**
 * The shapes whose breaks a surface can actually stop for.
 *
 * `watch` and `listen` are played by a real `<video>`/`<audio>` element, so the page
 * can pause the playhead, run the verified view, and put it back where it was.
 * `read` joined them in slice 6, when a page-turner of our own arrived: the reader
 * stops at a SEAM — the boundary between two pages or two chapters — so the gate it
 * honours is the `between` cue the planner was already placing, and the stop is a
 * page turn rather than a pause at a timestamp.
 *
 * The others are named here and nowhere else:
 *
 *   play   — a game asks for a view at a failure state IT owns (slice 3's own
 *            catalogue entry); that is a shell we have not built.
 *   stream — seller-scheduled by rule, never automatic (rule 4).
 *   download — no playhead (its ads are the page's boxes).
 *
 * So this is not a preference list: it is the list of shapes where the promise
 * "it asks while you watch" (or read) can be kept. A mode that switched a read into
 * breaks before the reader existed would have promised a gate nobody could honour,
 * which is the failure slice 2 closed.
 */
export const BREAK_SHAPES = ['watch', 'listen', 'read'];

export const breaksSupported = (shape) => BREAK_SHAPES.includes(shape);

/** Placements that happen inside the content, in play order. */
export const TIMED = ['pre', 'mid', 'between', 'post'];

/** Everything a shape's file could carry. Order is what the seller's page prints. */
export function placementsFor(shape) {
  return Object.values(PLACEMENTS).filter((p) => p.shapes.includes(shape)).map((p) => p.key);
}

/**
 * What a store gets unless the seller changes it.
 *
 * Deliberately modest: `mid` and `between` are ON, `post` is OFF (it completes at
 * 25–40 %, so a store that has not asked for it should not be handed it), and a
 * live file starts with nothing scheduled because the seller has to name a time.
 */
export function defaultChoices(shape) {
  const allowed = placementsFor(shape);
  const on = { mid: true, between: true, post: false, live: false, rewarded: true, aside: true };
  return Object.fromEntries(allowed.map((k) => [k, on[k] ?? true]));
}

/**
 * Did the seller's page render a placement panel for this shape?
 *
 * The save route asks, because "no checkboxes in the body" means two different
 * things: every placement turned off, or a shape that has no panel to render. The
 * first must clear the choices and the second must leave them alone — a download
 * saved today must not erase what the video it becomes next week would have kept.
 * Asking the same module the page asks is how one answer reaches both.
 */
export function placementPanelShown(shape) {
  return placementsFor(shape).filter((k) => k !== 'aside').length > 0;
}

/** Turns a stored blob into a full choice set: unknown keys dropped, gaps filled. */
export function resolveChoices(shape, stored) {
  const defaults = defaultChoices(shape);
  const allowed = placementsFor(shape);
  const out = { ...defaults };
  for (const key of allowed) {
    if (stored && typeof stored[key] === 'boolean') out[key] = stored[key];
  }
  return out;
}

/**
 * The platform's hard bounds on a break, in seconds.
 *
 * Exported because the seller's page prints them and the tests assert the copy
 * against the code — the same reason `ASK_ABSOLUTE` is exported from `adscale.js`.
 */
export const PLACEMENT_BOUNDS = {
  firstBreakAfter: 120, // rule 1: not in the first two minutes
  lastBreakBeforeEnd: 90, // rule 1: not in the last ninety seconds
  minGap: 240, // rule 2: never two breaks within four minutes
  betweenFromChapter: 3, // rule 3: readers break from the third chapter onward
  betweenGap: 2, // rule 3, for readers: at least one chapter between two gates
};

/** m:ss — the one way a time is written in this product. */
export function stamp(seconds) {
  const s = Math.max(0, Math.round(Number(seconds) || 0));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * The plan for one file.
 *
 * Inputs are all facts the platform owns or measured: the shape it derived, the
 * runtime the player reported, the ask the ladder produced, the plan the store is
 * on, and the seller's opt-outs. Nothing here is a seller-typed number.
 *
 * Returns `{ cues, ads, seconds, budget, allowed, refused, notes }`:
 *
 *   cues     what the player will honour, in order — `{ kind, atSec, label }`
 *   ads      how many breaks this plan will actually run
 *   budget   what the ladder said the file may ask for, and what it used
 *   allowed  every placement this shape has, and whether the seller kept it
 *   refused  the ones the seller kept but the rules would not place, with the reason
 *   notes    sentences for the seller's page, never for the buyer's
 */
export function planFor({
  shape, durationSec = null, ask = null, planCode = 'free',
  choices = null, chapters = null, membersOnly = false,
} = {}) {
  const kept = resolveChoices(shape, choices);
  const allowed = placementsFor(shape).map((key) => ({
    ...PLACEMENTS[key], kept: Boolean(kept[key]),
  }));
  const notes = [];
  const refused = [];

  const ceiling = ceilingFor(planCode);
  // The budget is the ask the ladder already produced, capped by the plan. A file
  // with no derived ask (a download, a game) gets no timed budget at all — its
  // ads are the page's boxes and, for a game, the reward the player offers.
  const wanted = ask
    ? { ads: Math.min(Number(ask.ads) || 0, ceiling.ads), seconds: Math.min(Number(ask.seconds) || 0, ceiling.seconds) }
    : { ads: 0, seconds: 0 };
  const budget = {
    ads: wanted.ads,
    seconds: wanted.seconds,
    totalSeconds: wanted.ads * wanted.seconds,
    planCode,
  };
  const cues = [];

  // A member's file has no ad in it, ever. This is a platform rule (framework
  // §5.2 rule 2) and it is checked before anything else can add a cue.
  if (membersOnly) {
    return {
      shape, durationSec, budget, cues, ads: 0, seconds: 0, allowed, refused, notes,
      reason: 'members', reasonText: 'A member\u2019s file carries no ads. That is what the tier buys.',
    };
  }

  if (shape === 'download') {
    // Nothing to time a break against, and the honest answer is that the page's
    // boxes are where this file's ads live.
    return {
      shape, durationSec, budget, cues, ads: 0, seconds: 0, allowed, refused, notes,
      reason: 'none', reasonText: 'A download has no playhead, so its ads are the boxes on its page.',
    };
  }

  if (shape === 'stream') {
    // Rule 4, as a property of the code rather than a promise in a comment: this
    // branch returns before any cue can be built, whatever `choices` says.
    return {
      shape, durationSec, budget, cues, ads: 0, seconds: 0, allowed, refused, notes,
      reason: 'live',
      reasonText: 'A live file breaks only when its owner says so. The platform never inserts one.',
    };
  }

  if (shape === 'play') {
    const cue = kept.rewarded ? [{ kind: 'rewarded', atSec: null, label: 'At a failure state' }] : [];
    return {
      shape, durationSec, budget, cues: cue, ads: cue.length, seconds: 0, allowed, refused, notes,
      reason: cue.length ? 'rewarded' : 'off',
      reasonText: cue.length
        ? 'The player asks for a view where it can help — a continue, a life, a hint — and nowhere else.'
        : 'This game offers no reward for a view.',
    };
  }

  // From here the shapes are `watch` (a playhead), `listen` (a queue) and `read`
  // (chapters). All three can carry a timed break, and all three need a length to
  // place it against.
  const runtime = Number(durationSec) || 0;

  if (shape === 'read' || (shape === 'listen' && Number(chapters) >= PLACEMENT_BOUNDS.betweenFromChapter)) {
    const chapterCount = Number(chapters) || 0;
    const from = PLACEMENT_BOUNDS.betweenFromChapter;
    // Evenly through the chapters that are left: a 12-chapter read with three
    // breaks asks after chapters 3, 6 and 9, and a 40-page manhwa with two asks
    // after page 13 and page 27. Anchoring the first one to chapter 3 instead
    // would put a break three pages into a forty-page story.
    const wanted = Math.max(0, budget.ads);
    const ideals = Array.from({ length: wanted }, (_, i) =>
      Math.max(from, Math.round((chapterCount * (i + 1)) / (wanted + 1))));
    const spread = [];
    for (const at of ideals) {
      if (!spread.length || at - spread[spread.length - 1] >= PLACEMENT_BOUNDS.betweenGap) spread.push(at);
    }
    const budgeted = spread.length;

    if (!kept.between) {
      return {
        shape, durationSec: runtime, budget, cues, ads: 0, seconds: 0, allowed, refused, notes,
        reason: 'off', reasonText: 'You have turned the between-chapter break off for this file.',
      };
    }
    if (chapterCount < PLACEMENT_BOUNDS.betweenFromChapter) {
      return {
        shape, durationSec: runtime || null, budget, cues, ads: 0, seconds: 0, allowed, refused, notes,
        reason: 'too-short',
        reasonText: `A read asks for nothing before chapter ${PLACEMENT_BOUNDS.betweenFromChapter}: `
          + 'the first chapters are how somebody decides whether to keep reading.',
      };
    }
    const word = shape === 'listen' ? 'track' : 'chapter';
    for (const chapter of spread) {
      cues.push({ kind: 'between', atChapter: chapter, atSec: null, label: `After ${word} ${chapter}` });
    }
    if (wanted > budgeted) {
      refused.push({
        kind: 'between',
        reason: `This asks for ${wanted} ${wanted === 1 ? 'break' : 'breaks'}, and with ${chapterCount} `
          + `${word}s there is room for ${budgeted} — no break lands before ${word} ${from}, and two `
          + `breaks need at least one ${word} between them.`,
      });
    }
    return {
      shape, durationSec: runtime || null, budget, cues, ads: cues.length, seconds: cues.length * budget.seconds,
      allowed, refused, notes, reason: cues.length ? 'between' : 'off',
      reasonText: cues.length
        ? `A break after ${cues.map((c) => c.label.replace(/^After /, '')).join(', ')} — `
          + `boundaries this file already has, and never inside one.`
        : 'Nowhere legal to put a break in this file.',
    };
  }

  // ── watch, and a queue with nothing to break between: the timed break ───────
  if (!runtime) {
    // Rule: no ffprobe, no seller typing a runtime. Until the player reports one,
    // there is nothing to place a break against, and guessing is how a viewer
    // meets an ad at second 7 of a clip that is 40 seconds long.
    return {
      shape, durationSec: null, budget, cues, ads: 0, seconds: 0, allowed, refused, notes,
      reason: 'no-runtime',
      reasonText: 'The player has not reported how long this file is yet, so there is nowhere to put a break.',
    };
  }

  const window = { from: PLACEMENT_BOUNDS.firstBreakAfter, to: runtime - PLACEMENT_BOUNDS.lastBreakBeforeEnd };
  if (window.to < window.from) {
    // A clip this short has no legal break at all. The three-minute clip in the
    // framework's own example is this case: it gets its door or it gets nothing,
    // because a break in it would be in the first two minutes or the last ninety
    // seconds, and both are worse than no break.
    notes.push(
      `This file runs ${stamp(runtime)}. A break cannot be placed in the first `
      + `${stamp(PLACEMENT_BOUNDS.firstBreakAfter)} or the last ${PLACEMENT_BOUNDS.lastBreakBeforeEnd} seconds, `
      + 'so there is nowhere inside it to put one.',
    );
    return {
      shape, durationSec: runtime, budget, cues, ads: 0, seconds: 0, allowed, refused, notes,
      reason: 'too-short', reasonText: notes[notes.length - 1],
    };
  }

  const keptMid = kept.mid;
  const keptPost = kept.post;
  const slots = [];
  if (keptMid && budget.ads > 0) {
    for (let i = 0; i < budget.ads; i++) slots.push('mid');
  }
  // A post-roll is only ever the LAST slot, and only when the file has room for a
  // break before it: "when it ends" is not a place, it is an offer.
  if (keptPost && slots.length) {
    slots[slots.length - 1] = 'post';
  } else if (keptPost && !slots.length) {
    notes.push('A post-roll on its own is an offer after the file, not a reason to watch it, so it is not placed.');
  }
  if (!keptMid && !keptPost) {
    return {
      shape, durationSec: runtime, budget, cues, ads: 0, seconds: 0, allowed, refused, notes,
      reason: 'off', reasonText: 'You have turned the breaks inside this file off.',
    };
  }
  if (!keptMid) {
    // With the break in the middle off, there is nothing for a post-roll to follow
    // — the framework is explicit that a post-roll is an offer at the end, never a
    // toll, and an offer is not a reason to run an ad on somebody's file.
    notes.push('A post-roll on its own is an offer after the file, not a break inside one, so nothing is placed.');
    return {
      shape, durationSec: runtime, budget, cues, ads: 0, seconds: 0, allowed, refused, notes,
      reason: 'off', reasonText: notes[notes.length - 1],
    };
  }
  if (!budget.ads) {
    return {
      shape, durationSec: runtime, budget, cues, ads: 0, seconds: 0, allowed, refused, notes,
      reason: 'no-ask', reasonText: 'This file asks for nothing, so there is no break to place.',
    };
  }

  // Distribute the slots across the legal window with the minimum gap, from the
  // chapter marks when the file has them and evenly when it does not. Even
  // distribution is what the research supports: two or three breaks spread across
  // a runtime earn about what the same number clustered at a chapter would, and
  // spreading them is what keeps each one's completion rate up.
  const mids = slots.filter((s) => s === 'mid').length;
  const postCount = slots.filter((s) => s === 'post').length;
  const span = window.to - window.from;
  let placed = [];
  for (let i = 0; i < mids; i++) {
    // The centre of slot i of n, so the first break is not at the very start of
    // the legal window and the last is not at its very end.
    const at = window.from + (span * (i + 0.5)) / Math.max(mids, 1);
    placed.push({ kind: 'mid', atSec: Math.round(at) });
  }
  placed = placed.filter((cue, i, all) => i === 0 || cue.atSec - all[i - 1].atSec >= PLACEMENT_BOUNDS.minGap);
  for (const cue of placed) cues.push({ ...cue, label: `${stamp(cue.atSec)} in` });
  if (postCount) cues.push({ kind: 'post', atSec: runtime, label: 'When it ends' });

  // Anything the rules would not place is reported, never silently dropped: a
  // seller who ticked three boxes and got two breaks is owed the reason.
  const dropped = budget.ads - placed.length - postCount;
  if (dropped > 0) {
    refused.push({
      kind: 'mid',
      reason: `Runs of ${stamp(runtime)} have room for ${placed.length + postCount} `
        + `${placed.length + postCount === 1 ? 'break' : 'breaks'} at least `
        + `${PLACEMENT_BOUNDS.minGap / 60} minutes apart, outside the first `
        + `${stamp(PLACEMENT_BOUNDS.firstBreakAfter)} and the last ${PLACEMENT_BOUNDS.lastBreakBeforeEnd} seconds.`,
    });
  }

  return {
    shape, durationSec: runtime, budget, cues,
    ads: cues.length, seconds: cues.reduce((n, c) => n + (c.kind === 'post' ? 0 : budget.seconds), 0),
    allowed, refused, notes,
    reason: cues.length ? 'placed' : 'too-short',
    reasonText: cues.length
      ? describe(cues, budget)
      : 'Nowhere legal to put a break in this file.',
  };
}

/** One sentence for the buyer's page: where the breaks are, and how long. */
export function describe(cues, budget) {
  const mids = cues.filter((c) => c.kind === 'mid');
  const post = cues.find((c) => c.kind === 'post');
  const parts = [];
  if (mids.length) {
    parts.push(`${mids.length === 1 ? 'One break' : `${mids.length} breaks`} `
      + `of ${budget.seconds} seconds inside it, at ${mids.map((c) => stamp(c.atSec)).join(' and ')}`);
  }
  if (post) parts.push('an offer of another file when it ends');
  if (!parts.length) return 'No breaks inside this file.';
  return `${parts.join(', and ')}.`;
}

/**
 * The buyer's sentence for a file that opens freely and breaks. Printed on the
 * file page above the button, so nobody is ambushed by a break they were not told
 * about — the same rule the ask already follows.
 */
export function placementSentence(plan) {
  if (!plan || !plan.cues?.length) return null;
  const mid = plan.cues.filter((c) => c.kind === 'mid');
  const between = plan.cues.filter((c) => c.kind === 'between');
  const ads = plan.ads;
  if (between.length) {
    return `Free to open. It asks for ${ads === 1 ? 'one view' : `${ads} views`} along the way — `
      + `${between.map((c) => c.label.toLowerCase()).join(', ')} — and nothing before you start.`;
  }
  if (mid.length) {
    return `Free to open. It asks for ${ads === 1 ? 'one view' : `${ads} views`} while you watch, `
      + `at ${mid.map((c) => stamp(c.atSec)).join(' and ')}, and nothing before you start.`;
  }
  return null;
}

/**
 * The timed cues a player can stop at, indexed for the client.
 *
 * `between` cues are excluded on purpose: they have no playhead, and a client
 * that tried to stop at one would be stopping at a number it made up.
 */
export function breakCues(plan) {
  if (!plan?.cues?.length) return [];
  return plan.cues
    .map((cue, index) => ({ cue, index }))
    .filter(({ cue }) => cue.kind === 'mid' && Number.isFinite(cue.atSec))
    .map(({ cue, index }, position) => ({
      index,
      // The order the viewer meets them, which is what the page prints.
      position: position + 1,
      atSec: cue.atSec,
      seconds: plan.budget.seconds,
    }));
}

/**
 * The between-chapter cues a READER can stop at.
 *
 * The mirror of `breakCues`, and separate from it on purpose: a cue with no
 * timestamp cannot be handed to a player (it would be stopping at a number it made
 * up), and a cue with a timestamp cannot be handed to a reader (there is no
 * playhead to compare it to). `between` cues carry the step they follow, which is a
 * page or a chapter depending on the upload — the page model owns that word, and the
 * reader's own sentence uses it.
 */
export function betweenCues(plan) {
  if (!plan?.cues?.length) return [];
  return plan.cues
    .map((cue, index) => ({ cue, index }))
    .filter(({ cue }) => cue.kind === 'between' && Number.isInteger(cue.atChapter))
    .map(({ cue, index }, position) => ({
      index,
      // The order the reader meets them, which is what the page prints.
      position: position + 1,
      atChapter: cue.atChapter,
      atSec: null,
      seconds: plan.budget?.seconds ?? 0,
      label: cue.label,
    }));
}

/**
 * The stops a surface can honour for this plan: a player by timestamp, a reader by
 * seam. Both are the planner's own cues, indexed; neither is derived here.
 */
export function stopCues(plan, surface = 'player') {
  return surface === 'reader' ? betweenCues(plan) : breakCues(plan);
}

/**
 * The buyer's sentence for a file that opens free and asks inside it.
 *
 * Different from `placementSentence` because the promise is different: there is no
 * door to lift here, so the sentence says when the views come and states plainly
 * that nothing blocks the start. It is rendered ONLY for a file whose mode is
 * `breaks` — the words are a description of the player's behaviour, and printing
 * them on a file whose player does not do it would be the kind of sentence this
 * whole slice exists to avoid.
 */
export function breakSentence(plan) {
  const cues = breakCues(plan);
  if (!cues.length) return null;
  const times = cues.map((c) => stamp(c.atSec));
  const when = times.length === 1
    ? `at ${times[0]}`
    : `at ${times.slice(0, -1).join(', ')} and ${times.at(-1)}`;
  return `Free to open, and nothing before you start. It asks for `
    + `${cues.length === 1 ? 'one view' : `${cues.length} views`} while you watch, ${when} — each one `
    + 'confirmed by the ad network before the player moves on.';
}

/** Total seconds of content an ad plan will interrupt, for the ledger. */
export function plannedSeconds(plan) {
  if (!plan?.cues?.length) return 0;
  const per = Number(plan.budget?.seconds) || 0;
  return plan.cues.reduce((n, c) => n + (c.kind === 'post' ? 0 : per), 0);
}
