/**
 * Prepare the test database.
 *
 * Tests create real channels, users and unlocks — they cannot be run against the
 * development database without filling it with fixtures. That is not a tidiness
 * problem: it made `npm start` report 42 channels and skip its own seed, so the
 * demo silently stopped being a demo.
 *
 * So the test database is a separate one, recreated from scratch on every run.
 * Tests get a clean, migrated database; development keeps its data.
 */
import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(here, '../../db/migrations');

const ADMIN_URL = process.env.DATABASE_URL_ADMIN
  || 'postgres://postgres:postgres@127.0.0.1:55432/postgres';
export const TEST_DB = process.env.TEST_PG_DATABASE || 'bytebikri_test';

export function testConnectionString() {
  const url = new URL(ADMIN_URL);
  url.pathname = `/${TEST_DB}`;
  return url.toString();
}

const admin = new pg.Client({ connectionString: ADMIN_URL });
await admin.connect();
// `with (force)` disconnects anyone still attached, so a stale test run does not
// block the next one.
await admin.query(`drop database if exists ${TEST_DB} with (force)`);
await admin.query(`create database ${TEST_DB}`);
await admin.end();

const client = new pg.Client({ connectionString: testConnectionString() });
await client.connect();
await client.query('create extension if not exists pgcrypto');

const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
for (const file of files) {
  const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
  try {
    await client.query(sql);
  } catch (err) {
    console.error(`  ${file} FAILED: ${err.message}`);
    await client.end();
    process.exit(1);
  }
}
await client.end();

console.log(`  test database ${TEST_DB} recreated, ${files.length} migrations applied`);
