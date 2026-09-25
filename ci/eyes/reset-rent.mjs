/**
 * Put the newest rent invoice back to `issued`, so the rent walk can be repeated.
 *
 * A paid invoice is the right outcome for a seller and a dead end for a harness: the
 * second run of `rent-walk.mjs` finds no form, prints a page that looks correct, and
 * proves nothing about the submission. This clears the four fields a submission
 * leaves behind — the reference, the method, the payer and the timestamps — for the
 * channel's NEWEST invoice and nothing else, inside a transaction, against the
 * DEVELOPMENT database. The amount, the period and the `basis` working are untouched:
 * they are the invoice's arithmetic and the walk reads them.
 *
 *   node ci/eyes/reset-rent.mjs [slug]
 *
 * Dev-only tooling, like `reset-unlock.mjs`. It refuses to run with NODE_ENV=production.
 */
import { withTransaction, query } from '../../app/src/db.js';

if (process.env.NODE_ENV === 'production') {
  console.error('refusing to re-open rent invoices on a production database');
  process.exit(1);
}

const SLUG = process.argv[2] || 'alice';

const { rows } = await query(
  `select r.id, r.status, r.amount_npr, current_database() as db,
          (select count(*)::int from rent_invoices x
            join channels c2 on c2.id = x.channel_id
           where c2.slug = $1) as total
     from rent_invoices r
     join channels c on c.id = r.channel_id
    where c.slug = $1
    order by r.period_start desc
    limit 1`,
  [SLUG],
);
if (!rows.length) {
  console.error(`no rent invoice for ${SLUG} — open the seller's billing page once, which issues it`);
  process.exit(1);
}
const inv = rows[0];

await withTransaction(async (tx) => {
  await tx.query(
    `update rent_invoices
        set status = 'issued', method = null, txn_reference = null, payer_name = null,
            payer_number = null, submitted_at = null, paid_at = null, matched_by = null, note = null
      where id = $1`,
    [inv.id],
  );
});

console.log(`rent invoice ${inv.id.slice(0, 8)} (${inv.db}, newest of ${inv.total}): `
  + `${inv.status} → issued, NPR ${inv.amount_npr}, reference cleared`);
process.exit(0);
