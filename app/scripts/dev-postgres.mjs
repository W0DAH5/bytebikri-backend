/**
 * Dev Postgres.
 *
 * Runs a real PostgreSQL server (not an emulator) from a local data directory,
 * so migrations and SQL are exercised against the engine they will actually run
 * on. `npm run db:start` keeps it in the foreground; Ctrl-C stops it.
 *
 * This is a DEVELOPMENT convenience only. Production points DATABASE_URL at a
 * managed Postgres (Supabase). Nothing in src/ knows this file exists.
 */
import EmbeddedPostgres from 'embedded-postgres';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

export const DEV_PORT = Number(process.env.DEV_PG_PORT || 55432);
export const DEV_DB = process.env.DEV_PG_DATABASE || 'bytebikri';
const DATA_DIR = path.join(root, '.data', 'pg');

export function connectionString({ database = DEV_DB } = {}) {
  return `postgres://postgres:postgres@127.0.0.1:${DEV_PORT}/${database}`;
}

export async function startDevPostgres() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const pg = new EmbeddedPostgres({
    databaseDir: DATA_DIR,
    user: 'postgres',
    password: 'postgres',
    port: DEV_PORT,
    persistent: true,
    // Quiet unless something goes wrong; the startup chatter is ~40 lines.
    onLog: () => {},
  });

  const fresh = !fs.existsSync(path.join(DATA_DIR, 'PG_VERSION'));
  if (fresh) await pg.initialise();
  await pg.start();
  try {
    await pg.createDatabase(DEV_DB);
  } catch (err) {
    // Already exists — the normal case on every run after the first.
    if (!/already exists/i.test(err.message)) throw err;
  }
  return pg;
}

// Run directly: start and hold.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const pg = await startDevPostgres();
  console.log(`\n  postgres → ${connectionString()}`);
  console.log('  (Ctrl-C to stop)\n');
  const shutdown = async () => { await pg.stop(); process.exit(0); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
