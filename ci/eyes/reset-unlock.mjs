/**
 * Put one viewer back in front of one file's ask, so a walk can be repeated.
 *
 * An unlock that has already happened is the right outcome for a person and a
 * dead end for a harness: the second run of `walk-ads.mjs` finds the file open,
 * prints nothing about the ask, and looks like a pass. This clears the rows a
 * finished attempt leaves behind — the unlock, the attempt, the network's view
 * events, and the bookmark — for ONE (viewer, file) pair and nothing else, inside
 * a transaction, against the DEVELOPMENT database.
 *
 * It also closes the slate on a LIVE file's windows. A break the last run called
 * would still be running when the next run's viewer opened the page, and that
 * viewer would be stopped by it before the walk had looked at anything — a walk
 * about watching a break being called has to start with none on the board. The
 * windows belong to the FILE (the store's rows, not the viewer's), so they are
 * cleared for the asset rather than for the pair.
 *
 *   node ci/eyes/reset-unlock.mjs [who] [slug]
 *   node ci/eyes/reset-unlock.mjs [who] [slug] --windows
 *   node ci/eyes/reset-unlock.mjs [who] [slug] --signals
 *   node ci/eyes/reset-unlock.mjs [who] [slug] --runtime
 *
 * The two flags clear ONE thing and leave the viewer's own state alone, which is what a
 * walk needs when the thing under test is not the state it starts from:
 *
 *   `--windows` — the file's break windows, MOVED BACK ten minutes rather than deleted.
 *   A live file refuses two breaks inside four minutes (asserted in `test/live.test.js`)
 *   and a walk cannot sit that out; but deleting the rows would renumber the next break
 *   to cue 1 — an index viewers have already cleared — and would erase the record the
 *   seller's own panel is asked about. Moving them back keeps both facts true: the
 *   breaks happened, and the file is free to run another.
 *
 *   A window that never closed is CLOSED AT ITS OWN END, because that is what happened:
 *   its time ran out. Leaving `closed_at` null would keep the file's one-open-window
 *   index (`unique ... where closed_at is null`) refusing the next break, which is the
 *   rule doing its job on a stale row rather than the walk testing anything.
 *   `--signals` — this person's blocker-ladder count for this file. A walk that proves the
 *   last rung has to PUT somebody there, and the next run would otherwise start six
 *   signals deep with every surface behaving as if the person had failed before arriving.
 *   `--runtime` — the file's MEASURED length, which is not a person's state at all: it is
 *   what the first player that loaded the file reported, and a break's cues are computed
 *   from it. A walk that has to see the measurement happen starts from a file nobody has
 *   measured, the way a freshly seeded database does.
 *
 * Dev-only tooling, like the simulator endpoint it exists to support. It refuses
 * to run with NODE_ENV=production.
 */
import { withTransaction, query } from '../../app/src/db.js';

if (process.env.NODE_ENV === 'production') {
  console.error('refusing to clear unlocks on a production database');
  process.exit(1);
}

const WHO = process.argv[2] || 'bob';
const SLUG = process.argv[3] || 'devanagari-poster-kit';
const WINDOWS_ONLY = process.argv.includes('--windows');
const SIGNALS_ONLY = process.argv.includes('--signals');
const RUNTIME_ONLY = process.argv.includes('--runtime');

const { rows } = await query(
  `select u.id as user_id, a.id as asset_id, a.title
     from profiles u
     join assets a on a.slug = $2
    where u.email = $1`,
  [`${WHO}@bytebikri.local`, SLUG],
);
if (!rows.length) {
  console.error(`no (viewer, file) pair for ${WHO} / ${SLUG}`);
  process.exit(1);
}
const { user_id: userId, asset_id: assetId, title } = rows[0];

if (WINDOWS_ONLY) {
  // Moved, not deleted: cue indexes stay monotone and the seller's record stays true.
  // An open window is closed at its own end — a window whose time is over is over, and
  // `unique (asset_id) where closed_at is null` would otherwise refuse the next break.
  const moved = await query(
    `update live_breaks
        set started_at = started_at - interval '10 minutes',
            ends_at = ends_at - interval '10 minutes',
            closed_at = coalesce(closed_at, ends_at) - interval '10 minutes'
      where asset_id = $1`,
    [assetId],
  );
  console.log(`moved ${moved.rowCount} break window(s) on "${title}" back ten minutes — nothing deleted, viewer untouched`);
  process.exit(0);
}

if (RUNTIME_ONLY) {
  const { rowCount } = await query(
    'update assets set runtime_sec = null, updated_at = updated_at where id = $1 and runtime_sec is not null',
    [assetId],
  );
  console.log(`forgot the measured length of "${title}" (${rowCount} row) — the next player measures it again`);
  process.exit(0);
}

if (SIGNALS_ONLY) {
  const cleared = await query(
    'delete from ad_block_signals where user_id = $1 and asset_id = $2',
    [userId, assetId],
  );
  console.log(`cleared ${cleared.rowCount} blocker signal(s) for ${WHO} on "${title}"`);
  process.exit(0);
}

const out = await withTransaction(async (tx) => {
  const events = await tx.query('delete from ad_view_events where user_id = $1 and asset_id = $2', [userId, assetId]);
  const unlocks = await tx.query('delete from unlocks where user_id = $1 and asset_id = $2', [userId, assetId]);
  const views = await tx.query('delete from pending_views where user_id = $1 and asset_id = $2', [userId, assetId]);
  // The bookmark is the fourth row a walk leaves behind, and it is the one that changes
  // the STARTING state rather than the ending one: a second run of `reader-walk.mjs`
  // would open on "Continue reading — Page 12 of 12" and never see page one at all.
  // It is this person's own row on this one file, and this tool only runs against the
  // development database.
  const bookmarks = await tx.query('delete from reading_progress where user_id = $1 and asset_id = $2', [userId, assetId]);
  // The store's own rows about this file, and only this file: an open window and the
  // coverage the last run bought. `live_breaks` cascades nothing, so this is the clean
  // board a repeated live walk needs.
  const breaks = await tx.query('delete from live_breaks where asset_id = $1', [assetId]);
  // The blocker ladder's memory, for this pair. A walk that proves the last rung has to
  // PUT somebody on it, which means the next run starts nine signals deep and every
  // surface behaves as if the person had failed six times before they arrived — the
  // rung is a count over a six-hour window, and a harness cannot wait six hours.
  const signals = await tx.query('delete from ad_block_signals where user_id = $1 and asset_id = $2', [userId, assetId]);
  return {
    events: events.rowCount, unlocks: unlocks.rowCount, views: views.rowCount,
    bookmarks: bookmarks.rowCount, breaks: breaks.rowCount, signals: signals.rowCount,
  };
});

console.log(`cleared for ${WHO} · "${title}": ${out.events} view event(s), ${out.unlocks} unlock(s), `
  + `${out.views} attempt(s), ${out.bookmarks} bookmark(s), ${out.breaks} break window(s), `
  + `${out.signals} blocker signal(s)`);
process.exit(0);
