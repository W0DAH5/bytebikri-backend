import pg from 'pg';
const admin = process.env.DATABASE_URL_ADMIN || 'postgres://postgres:postgres@127.0.0.1:55432/postgres';
const dbName = process.env.DEV_PG_DATABASE || 'bytebikri';
const c = new pg.Client({ connectionString: admin });
await c.connect();
await c.query(`drop database if exists ${dbName} with (force)`);
await c.query(`create database ${dbName}`);
console.log(`  dropped and recreated ${dbName}`);
await c.end();
