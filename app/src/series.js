/**
 * The series: a store's own playlist, and the four questions it answers.
 *
 * ASSET_ECONOMY §15 designed this shape, and §15.1 is its whole architecture: an
 * episode is an ordinary file (its own cover, its own unlock mode, its own ask, its
 * own ledger row), and a series adds ORDER and ONE PLACE TO SEE IT — nothing else.
 *
 * Four questions live here, and they live in ONE module because four pages ask them
 * and a page that answers one of them its own way is how a card and the page behind
 * it start disagreeing:
 *
 *   1. In what order are these episodes listed? (`episodeOrder`) — the store's mode
 *      decides it, and nothing else does.
 *   2. Which one should this person be watching? (`landingEpisode`) — the episode
 *      they were in the middle of, else the head of the list.
 *   3. What is the next one? (`nextEpisode`) — only a serial series has an answer,
 *      and that is the difference between the two modes rather than a preference.
 *   4. What is the person's position worth? (`resumeFrom`, `isFinished`) — a saved
 *      position is a convenience and NEVER evidence: nothing in accounting reads
 *      it, and this module cannot move a number in the ledger because it has no
 *      access to one.
 *
 * The researched reasons are in §15 and they are worth restating where the code
 * enforces them:
 *
 *   · YouTube's own research paper documents the failure of an INFERRED next — the
 *     video such a system recommends is routinely unrelated to the series being
 *     watched. So the order here is authored by the store or there is no series;
 *   · YouTube's Shows splits a serial (in order, oldest first) from a non-serial
 *     (any order, newest first) and defaults a converted playlist to non-serial.
 *     Both are legitimate products and only the store knows which it made, so
 *     `mode` is a column and every function below branches on it;
 *   · autoplay is the thing the evidence is against: an experimental study of
 *     Netflix viewers found 62 % of those who HAD it enabled said they disliked
 *     automatic continuation, and turning it off cut 21 minutes of watching a day.
 *     There is no autoplay here, no countdown, and therefore no need for "are you
 *     still watching" — nothing takes the wheel, so there is no place to lose.
 *
 * Pure module: no database, no clock of its own, and no knowledge of money.
 */

/**
 * What a series may hold.
 *
 * Only files that PLAY: a playlist is a queue of things a player moves through. A
 * reader is already a container — its chapters live inside one archive and §13's
 * step is its episode — and a download has no player to be next in. The refusal
 * says this, because a store who tries it deserves the reason rather than a silence.
 */
export const SERIES_SHAPES = ['watch', 'listen'];

/**
 * The two modes, in the store's words.
 *
 * `collection` is the default, and it is the default for the researched reason:
 * YouTube selects non-serial when a playlist is converted, because claiming an
 * order a store did not ask for is a bigger mistake than leaving one out.
 */
export const SERIES_MODES = {
  collection: {
    key: 'collection',
    label: 'A collection',
    order: 'newest',
    next: false,
    words: 'Any episode can be watched first. Listed newest number first, and there is no '
      + '"next" — there is nothing to be next in.',
  },
  serial: {
    key: 'serial',
    label: 'A serial',
    order: 'oldest',
    next: true,
    words: 'Meant to be watched in order. Listed first episode first, and the player offers the '
      + 'next one when an episode ends.',
  },
};

export const SERIES_MODE_KEYS = Object.keys(SERIES_MODES);

export function modeOf(key) {
  return SERIES_MODES[key] ?? SERIES_MODES.collection;
}

/** The most episodes a series may hold, so a page cannot be built out of thousands. */
export const SERIES_MAX_EPISODES = 200;

/** The longest position worth remembering, matching the migration's own check. */
export const WATCH_MAX_SECONDS = 86_400;

/**
 * How close to the end counts as having finished it.
 *
 * Nothing in this product watches a viewer to the last frame, and the last seconds
 * of a video are the credits. A person who is 96 % of the way through an episode is
 * done with it, and answering "continue watching" with the episode they just
 * finished is the small dishonesty every streaming product commits here.
 *
 * The grace is the credits — thirty seconds — but never more than a tenth of the
 * file. Written as a `min` rather than a bare thirty because of the short end: a
 * twenty-second clip would otherwise be "finished" after ten seconds, which is half
 * of somebody's work. (The first version of this used `max(runtime - 30, 90 %)`,
 * which looks similar and is not: that expression is just `runtime - 30` for
 * anything longer than five minutes, so the 90 % clause was dead code pretending to
 * be a rule. Found by asserting both ends of it.)
 */
export const FINISHED_TAIL_SECONDS = 30;
export const FINISHED_TAIL_SHARE = 0.1;

/** The grace, in seconds, for a file of this length. */
export function finishedGrace(runtimeSec) {
  const runtime = Number(runtimeSec);
  if (!Number.isFinite(runtime) || runtime <= 0) return 0;
  return Math.min(FINISHED_TAIL_SECONDS, runtime * FINISHED_TAIL_SHARE);
}

/** Is this episode finished, given where the person stopped and how long it is? */
export function isFinished(positionSec, runtimeSec) {
  const at = Number(positionSec);
  const runtime = Number(runtimeSec);
  if (!Number.isFinite(at) || at < 0) return false;
  // A file whose length nobody reported cannot be finished: guessing here would
  // hide an episode from somebody who had barely started it.
  if (!Number.isFinite(runtime) || runtime <= 0) return false;
  return at >= runtime - finishedGrace(runtime);
}

/**
 * The listing order for a mode: `serial` counts up, `collection` counts down.
 *
 * Ties are broken by title so that two episodes at the same number — impossible in
 * SQL, but possible in a hand-built array in a test — render in a stable order
 * rather than whatever the sort happened to do.
 */
export function episodeOrder(episodes = [], mode = 'collection') {
  const list = (Array.isArray(episodes) ? episodes : []).filter(Boolean);
  const direction = modeOf(mode).order === 'oldest' ? 1 : -1;
  return [...list].sort((a, b) => {
    const an = Number(a.episode_no ?? a.episodeNo) || 0;
    const bn = Number(b.episode_no ?? b.episodeNo) || 0;
    if (an !== bn) return (an - bn) * direction;
    return String(a.title || '').localeCompare(String(b.title || ''));
  });
}

/** `Episode 3` — the word and the number the store gave it. */
export function episodeWords(episodeNo) {
  const n = Number(episodeNo);
  return Number.isFinite(n) && n > 0 ? `Episode ${n}` : 'An episode';
}

/** `12 episodes` / `1 episode` — for the card, which counts what it holds. */
export function episodeCountWords(count) {
  const n = Math.max(0, Math.floor(Number(count) || 0));
  return `${n} episode${n === 1 ? '' : 's'}`;
}

/**
 * Which episode this person should be handed, and why.
 *
 * The rule, in order:
 *
 *   1. the episode they are IN THE MIDDLE OF — the most recently touched position
 *      that is not finished. This is the promise every reader expects ("continue
 *      where you left off", §13) and the reason the row exists at all;
 *   2. otherwise the head of the list: the first of a serial, the newest of a
 *      collection. A serial that started somebody at episode 9 because 9 was
 *      published last would be the mode ignored;
 *   3. and `null` for an empty series — the caller renders "nothing yet" rather
 *      than an empty player.
 *
 * `positions` is a map of episode id → { seconds, runtime_sec }, which is the shape
 * one query over `watch_progress` joined to `assets` produces.
 *
 * @returns {{episode: object, why: 'continue'|'head'} | null}
 */
export function landingEpisode({ episodes = [], positions = {}, mode = 'collection' } = {}) {
  const ordered = episodeOrder(episodes, mode);
  if (!ordered.length) return null;
  let best = null;
  for (const episode of ordered) {
    const row = positions[episode.id];
    if (!row) continue;
    if (isFinished(row.seconds ?? row.position_sec, episode.runtime_sec ?? row.runtime_sec)) continue;
    const at = new Date(row.updated_at ?? row.updatedAt ?? 0).getTime();
    if (!Number.isFinite(at)) continue;
    if (!best || at > best.at) best = { at, episode };
  }
  if (best) return { episode: best.episode, why: 'continue' };
  return { episode: ordered[0], why: 'head' };
}

/**
 * The next episode after this one — and `null` for a collection, always.
 *
 * "Any order is fine" is what a store says by choosing a collection, so a *Next
 * episode* control there would be inventing an order we were just told does not
 * matter. The control is the difference between the two modes, which is why this
 * function reads `mode` and not a preference.
 */
export function nextEpisode({ episodes = [], currentId = null, mode = 'collection' } = {}) {
  if (!modeOf(mode).next) return null;
  const ordered = episodeOrder(episodes, mode);
  const at = ordered.findIndex((e) => String(e.id) === String(currentId));
  if (at < 0) return null;
  return ordered[at + 1] ?? null;
}

/** The one before, for the strip on an episode's own page. Never a refusal: it is a link back. */
export function previousEpisode({ episodes = [], currentId = null, mode = 'collection' } = {}) {
  const ordered = episodeOrder(episodes, mode);
  const at = ordered.findIndex((e) => String(e.id) === String(currentId));
  if (at <= 0) return null;
  return ordered[at - 1] ?? null;
}

/**
 * Where a saved position should put the playhead.
 *
 * Two answers rather than one, because the page says both: the position to seek to,
 * and whether starting from the beginning is worth offering. A position in the
 * first few seconds is not a resume — it is where everybody starts — and offering
 * it would be a control that does nothing.
 */
export const RESUME_MIN_SECONDS = 5;

export function resumeFrom(positionSec, runtimeSec = null) {
  const at = Math.floor(Number(positionSec));
  if (!Number.isFinite(at) || at < RESUME_MIN_SECONDS) return null;
  if (isFinished(at, runtimeSec)) return null;          // finished episodes start over
  return at;
}

/** `Resumed at 4:05` — the sentence the stage prints, or null. */
export function resumeSentence(seconds) {
  const at = Number(seconds);
  if (!Number.isFinite(at) || at < RESUME_MIN_SECONDS) return null;
  return `Resumed at ${clockWords(at)}.`;
}

/** `4:05` / `1:02:11` — a playhead as people read it. */
export function clockWords(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/**
 * Every way a file can be refused a place in a series, written once.
 *
 * The seller's POST maps a refusal to a flash message and the module prints the same
 * refusal beside the form, so the two readings come from ONE table rather than from two
 * sentences that agree until somebody edits one of them. Each refusal names the actual
 * problem — a shape with no player, a number already taken, a series that is full, a
 * file from another store, a file that is already in a different series (moving one is
 * a decision, not a side effect of adding it somewhere else).
 */
const TAKEN_TAIL = 'Pick a number that is free, or renumber the one that holds it.';

export const SERIES_REFUSALS = {
  missing: 'That file does not exist.',
  'no-series': 'That series does not exist.',
  store: 'That series belongs to another store.',
  // Two halves of one question — is this yours? — and they are separate sentences on
  // purpose: the series being somebody's is a different mistake from the FILE being
  // somebody's, and the panel prints whichever one is actually true. A hand-made POST
  // that names a file the store does not own is the second one, and it is refused in
  // the same place every other refusal is, because the series page lists what a series
  // holds without asking a second time who owns each row.
  'not-yours': 'That file belongs to another store.',
  shape: 'A series is a playlist of things a player moves through — video or audio. A reader '
    + 'holds its own chapters, and a download has no player to be next in.',
  elsewhere: 'That file is already an episode of another series. Take it out of that one first.',
  number: 'An episode number is a whole number from 1 to 9999.',
  taken: (n) => `${episodeWords(n)} is taken. ${TAKEN_TAIL}`,
  // The flash a redirect can carry: a message page has no number in front of it, and
  // "Episode 2 is taken" over a form the seller has already left would be confusing.
  'taken-plain': `That episode number is taken. ${TAKEN_TAIL}`,
  full: `A series holds ${SERIES_MAX_EPISODES} episodes.`,
};

/**
 * The refusal as a code and a sentence — one computation, read twice.
 *
 * `seriesRefusal` is what the seller's panel and the tests print; `seriesRefusalCode`
 * is what the POST turns into a flash message. Both read this function, so a branch
 * cannot exist in one and be missing from the other.
 */
export function refusalOf({ asset = null, shape = null, channelId = null, series = null, episodes = [], episodeNo = null, currentAssetId = null } = {}) {
  if (!asset) return { code: 'missing', sentence: SERIES_REFUSALS.missing };
  if (!series) return { code: 'no-series', sentence: SERIES_REFUSALS['no-series'] };
  if (channelId && series.channel_id && String(series.channel_id) !== String(channelId)) {
    return { code: 'store', sentence: SERIES_REFUSALS.store };
  }
  // The file has to be the store's own too. Trusted when the caller does not say who is
  // asking (`channelId` absent) — the module is pure and a test may call it with a shape
  // stub — but the seller's route always says, and so the check always runs where a
  // person could actually reach it.
  if (channelId && asset.channel_id && String(asset.channel_id) !== String(channelId)) {
    return { code: 'not-yours', sentence: SERIES_REFUSALS['not-yours'] };
  }
  // `shape` is passed in (from `assetShape`, the one place a shape is decided) rather
  // than re-derived here: a second classifier is a second answer.
  if (!SERIES_SHAPES.includes(shape)) return { code: 'shape', sentence: SERIES_REFUSALS.shape };
  if (asset.series_id && String(asset.series_id) !== String(series.id)
    && String(asset.id) !== String(currentAssetId)) {
    return { code: 'elsewhere', sentence: SERIES_REFUSALS.elsewhere };
  }
  const others = episodes.filter((e) => String(e.id) !== String(asset.id));
  if (others.length >= SERIES_MAX_EPISODES) return { code: 'full', sentence: SERIES_REFUSALS.full };
  const n = Number(episodeNo);
  if (episodeNo !== null && episodeNo !== undefined && episodeNo !== '') {
    if (!Number.isInteger(n) || n < 1 || n > 9999) {
      return { code: 'number', sentence: SERIES_REFUSALS.number };
    }
    if (others.some((e) => Number(e.episode_no) === n)) {
      return { code: 'taken', sentence: SERIES_REFUSALS.taken(n) };
    }
  }
  return null;
}

/** May this file join this series? Null means yes; otherwise the sentence. */
export function seriesRefusal(args) {
  return refusalOf(args)?.sentence ?? null;
}

/** The same answer as a code, for a route that has to name it in a redirect. */
export function seriesRefusalCode(args) {
  return refusalOf(args)?.code ?? null;
}

/** The next number when the store does not choose one: one past the highest, or 1. */
export function freeEpisodeNo(episodes = []) {
  return episodes.reduce((max, e) => Math.max(max, Number(e.episode_no) || 0), 0) + 1;
}

/**
 * A series' own slug, from its title.
 *
 * The same rule the storefront and the reader already use for an address: lower case,
 * ASCII, hyphens, and never empty. Two series in one store may not share one — the
 * database says so — and the caller appends a counter rather than refusing, because a
 * store naming their second series "Sketchbook" should get a page, not an error.
 */
export function seriesSlug(title, taken = []) {
  const base = String(title || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'series';
  const used = new Set((taken || []).map((s) => String(s)));
  if (!used.has(base)) return base;
  for (let n = 2; n < 200; n += 1) {
    const candidate = `${base}-${n}`;
    if (!used.has(candidate)) return candidate;
  }
  return `${base}-${Date.now()}`;
}

/**
 * What the store's own panel says about the series' shape: the counts it should
 * never have to add up itself.
 *
 * `gaps` is the honest part. Episode numbers may be 1, 2, 4, 5 — deleting the third
 * is a store's right and renumbering the rest behind their back would be us editing
 * their edit — so the panel says the numbers are not contiguous rather than letting
 * a seller discover it on the buyer's page.
 */
export function seriesSummary(episodes = [], mode = 'collection') {
  const ordered = episodeOrder(episodes, mode);
  const numbers = ordered.map((e) => Number(e.episode_no) || 0).filter((n) => n > 0);
  const contiguous = numbers.length > 0 && numbers.every((n, i) => n === i + 1);
  return {
    count: ordered.length,
    first: ordered[0] ?? null,
    last: ordered[ordered.length - 1] ?? null,
    numbers,
    contiguous,
    words: numbers.length && !contiguous
      ? `Episodes ${numbers.join(', ')} — a gap is fine, nothing was renumbered.`
      : `${episodeCountWords(ordered.length)}.`,
  };
}
