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
  return {
    events: events.rowCount, unlocks: unlocks.rowCount, views: views.rowCount,
    bookmarks: bookmarks.rowCount, breaks: breaks.rowCount,
  };
});

console.log(`cleared for ${WHO} · "${title}": ${out.events} view event(s), ${out.unlocks} unlock(s), `
  + `${out.views} attempt(s), ${out.bookmarks} bookmark(s), ${out.breaks} break window(s)`);
process.exit(0);
