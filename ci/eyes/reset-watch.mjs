/**
 * Clear one viewer's saved positions, so a series walk can be repeated.
 *
 * A remembered position is the right outcome for a person and a dead end for a
 * harness: the second run of `series-walk.mjs` would find the resume already there,
 * "no resume on a fresh visit" would be untestable, and the walk would look like a
 * pass while proving nothing. It clears `watch_progress` for ONE viewer and nothing
 * else — the rows belong to a person, and this tool is the only thing in the repo
 * that deletes them.
 *
 *   node ci/eyes/reset-watch.mjs [who]
 *
 * Dev-only tooling, like every walk here. It refuses to run with NODE_ENV=production.
 */
import { query } from '../../app/src/db.js';

if (process.env.NODE_ENV === 'production') {
  console.error('refusing to clear watch positions on a production database');
  process.exit(1);
}

const WHO = process.argv[2] || 'alice';
const { rows } = await query(
  `select count(*)::int as n from watch_progress w
     join profiles p on p.id = w.user_id
    where p.email = $1`,
  [`${WHO}@bytebikri.local`],
);
const cleared = await query(
  `delete from watch_progress w
    using profiles p
    where p.id = w.user_id and p.email = $1`,
  [`${WHO}@bytebikri.local`],
);
console.log(`watch positions for ${WHO}: ${rows[0].n} before, ${cleared.rowCount} cleared`);
process.exit(0);
