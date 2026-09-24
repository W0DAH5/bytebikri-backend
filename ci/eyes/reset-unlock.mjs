/**
 * Put one viewer back in front of one file's ask, so a walk can be repeated.
 *
 * An unlock that has already happened is the right outcome for a person and a
 * dead end for a harness: the second run of `walk-ads.mjs` finds the file open,
 * prints nothing about the ask, and looks like a pass. This clears the three rows
 * a finished attempt leaves behind — the unlock, the attempt, and the network's
 * view events — for ONE (viewer, file) pair and nothing else, inside a
 * transaction, against the DEVELOPMENT database.
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
  const events = await tx.query(`delete from ad_view_events where user_id = $1 and asset_id = $2`, [userId, assetId]);
  const unlocks = await tx.query(`delete from unlocks where user_id = $1 and asset_id = $2`, [userId, assetId]);
  const views = await tx.query(`delete from pending_views where user_id = $1 and asset_id = $2`, [userId, assetId]);
  return { events: events.rowCount, unlocks: unlocks.rowCount, views: views.rowCount };
});

console.log(`cleared for ${WHO} · "${title}": ${out.events} view event(s), ${out.unlocks} unlock(s), ${out.views} attempt(s)`);
process.exit(0);
