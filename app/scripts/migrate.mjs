/**
 * Migration runner.
 *
 *   npm run db:migrate          apply everything not yet applied
 *   npm run db:migrate -- --dry list what would run
 *
 * Applies db/migrations/*.sql in filename order and records each in
 * schema_migrations. Each file runs in its own transaction, so a failure leaves
 * the database on the last good migration rather than half-applied.
 *
 * Why not a migration framework: this needs to run on Supabase, in CI, and on a
 * laptop, and the entire requirement is "apply ordered .sql files exactly once".
 * A dependency that does that plus 4,000 lines of CLI is not free.
 *
 * The advisory lock matters in production: two app instances booting at the same
 * moment would otherwise both try to apply 0001 and one would crash on a
 * duplicate-object error. It does nothing on a single-node dev box.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { connectionString } from './dev-postgres.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(here, '../../db/migrations');

// Arbitrary but fixed: any process running migrations uses the same key.
const LOCK_KEY = 9_827_311;

const url = process.env.DATABASE_URL || (process.env.NODE_ENV === 'production' ? null : connectionString());

if (!url) {
  console.error('DATABASE_URL is not set. Refusing to guess in production.');
  process.exit(1);
}

const dryRun = process.argv.includes('--dry');
const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();

const client = new pg.Client({ connectionString: url });
await client.connect();

await client.query(`
  create table if not exists schema_migrations (
    filename    text primary key,
    checksum    text not null,
    applied_at  timestamptz not null default now()
  )`);

const applied = new Map(
  (await client.query('select filename, checksum from schema_migrations')).rows.map((r) => [r.filename, r.checksum]),
);

// A migration that already ran must never change. If it did, the schema in this
// environment and the schema in production have silently diverged.
const checksum = (s) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return `${(h >>> 0).toString(16)}:${s.length}`;
};

let drifted = 0;
for (const file of files) {
  const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
  const sum = checksum(sql);
  if (applied.has(file) && applied.get(file) !== sum) {
    console.error(`  DRIFT  ${file} — already applied but its contents changed.`);
    drifted++;
  }
}
if (drifted) {
  console.error(`\n${drifted} applied migration(s) were edited. Add a new migration instead.`);
  await client.end();
  process.exit(1);
}

const pending = files.filter((f) => !applied.has(f));
if (!pending.length) {
  console.log('  already up to date — nothing to apply');
  await client.end();
  process.exit(0);
}

console.log(dryRun ? '  would apply:' : '  applying:');
for (const f of pending) console.log(`    ${f}`);
if (dryRun) { await client.end(); process.exit(0); }

await client.query('select pg_advisory_lock($1)', [LOCK_KEY]);
try {
  for (const file of pending) {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    // Re-check under the lock: another instance may have applied it while we waited.
    const seen = await client.query('select 1 from schema_migrations where filename = $1', [file]);
    if (seen.rowCount) { console.log(`    ${file} — applied by another instance, skipping`); continue; }

    process.stdout.write(`    ${file} ... `);
    try {
      await client.query('begin');
      await client.query(sql);
      await client.query('insert into schema_migrations (filename, checksum) values ($1, $2)', [file, checksum(sql)]);
      await client.query('commit');
      console.log('ok');
    } catch (err) {
      await client.query('rollback');
      console.log('FAILED');
      console.error(`\n  ${file}: ${err.message}`);
      if (err.position) console.error(`  at character ${err.position}`);
      throw err;
    }
  }
} finally {
  await client.query('select pg_advisory_unlock($1)', [LOCK_KEY]);
  await client.end();
}
