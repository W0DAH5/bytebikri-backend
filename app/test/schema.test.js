/**
 * Schema contract tests.  npm test
 *
 * These run against a REAL Postgres. They exist because the schema had never
 * been executed: it referenced auth.users, so it could not load anywhere but a
 * live Supabase project, and nothing ever compared what the code assumes against
 * what the database enforces.
 *
 * The failure that prompted this was error 42P10 — ON CONFLICT (email) with no
 * unique index to arbitrate it — which surfaced as the app being unable to
 * create its first user. A schema is a set of promises; these tests check that
 * the promises the code relies on are actually made.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, '../..');
const MIGRATIONS = path.join(REPO, 'db/migrations');

process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:55432/bytebikri_test';
const { query, close } = await import('../src/db.js');

after(async () => { await close(); });

// ---------------------------------------------------------------------------
// The contract between an ON CONFLICT clause and the schema.
// ---------------------------------------------------------------------------

/** Every `on conflict (...)` in src/, with the table it upserts into. */
function upsertTargets() {
  const src = fs.readFileSync(path.join(here, '../src/store.js'), 'utf8');
  const out = [];
  // Each statement is of the form `insert into <table> ... on conflict (<cols>)`.
  // (?!insert\s+into) stops the match running past the end of this statement and
  // grabbing the NEXT insert's conflict clause. Without it, `insert into channels`
  // was reported as conflicting on subscriptions' channel_id.
  const re = /insert\s+into\s+([a-z_]+)(?:(?!insert\s+into)[\s\S])*?on\s+conflict\s*\(([^)]+)\)/gi;
  let m;
  while ((m = re.exec(src))) {
    out.push({ table: m[1].toLowerCase(), columns: m[2].split(',').map((c) => c.trim().toLowerCase()) });
  }
  return out;
}

test('every ON CONFLICT in the store has a matching unique index', async () => {
  const targets = upsertTargets();
  assert.ok(targets.length >= 5, `expected several upserts, parsed ${targets.length}`);

  const problems = [];
  for (const { table, columns } of targets) {
    // A unique index serving this exact column list — either a plain unique
    // index, or the primary key.
    const { rows } = await query(`
      select ix.relname as indexname
        from pg_index i
        join pg_class t on t.oid = i.indrelid
        join pg_class ix on ix.oid = i.indexrelid
        cross join lateral (
          select array_agg(a.attname order by k.ord) as cols
            from unnest(i.indkey) with ordinality k(attnum, ord)
            join pg_attribute a on a.attrelid = t.oid and a.attnum = k.attnum
        ) c
       where t.relname = $1
         and i.indisunique
         and c.cols = $2::name[]
    `, [table, columns]);

    if (!rows.length) problems.push(`${table}(${columns.join(', ')}) has no unique index`);
  }

  assert.deepEqual(problems, [], `ON CONFLICT with no arbiter:\n  ${problems.join('\n  ')}`);
});

// ---------------------------------------------------------------------------
// Invariants the business rules depend on.
// ---------------------------------------------------------------------------

test('the schema applies and all expected tables exist', async () => {
  const required = [
    'profiles', 'channels', 'channel_stats', 'assets', 'asset_files', 'asset_unlock_policy',
    'unlocks', 'ad_view_events', 'download_events', 'reviews', 'disputes', 'channel_strikes',
    'plans', 'subscriptions', 'plan_payments', 'ad_connections', 'ad_connection_events',
    'slot_definitions', 'channel_slots', 'page_view_daily', 'page_view_rejects',
    'policy_rules', 'moderation_actions', 'content_geo_blocks', 'notifications', 'audit_logs',
    'seller_verifications', 'asset_country_rules', 'pending_views', 'ad_refs',
  ];
  const { rows } = await query(
    `select table_name from information_schema.tables where table_schema = 'public'`,
  );
  const have = new Set(rows.map((r) => r.table_name));
  const missing = required.filter((t) => !have.has(t));
  assert.deepEqual(missing, [], `missing tables: ${missing.join(', ')}`);
});

test('the schema does not depend on a specific auth vendor', async () => {
  // It previously referenced auth.users(id), which meant it could not run on
  // plain Postgres at all.
  const sql = fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql'))
    .map((f) => fs.readFileSync(path.join(MIGRATIONS, f), 'utf8'))
    // Strip comments. The 0001 header EXPLAINS that it used to reference
    // auth.users, and matching that prose would fail the test on its own
    // documentation — which is what it did the first time it ran.
    .map((t) => t.replace(/--[^\n]*/g, ''))
    .join('\n');
  const refs = [...sql.matchAll(/auth\.users/g)];
  assert.equal(refs.length, 0, 'schema still references auth.users');
});

test('unlocks are unique per (asset, user)', async () => {
  const { rows } = await query(`
    select 1 from pg_index i join pg_class t on t.oid = i.indrelid
     where t.relname = 'unlocks' and i.indisunique limit 1`);
  assert.equal(rows.length, 1, 'unlocks needs a unique index — grantUnlock upserts on it');
});

test('ad view dedup is per CONNECTION, not per provider', async () => {
  // The difference matters: two channels can both use BitLabs with different
  // secrets, and provider-scoped uniqueness would let one channel's completed
  // view be swallowed as a duplicate of the other's.
  const { rows } = await query(`select indexdef from pg_indexes where indexname = 'uq_ad_view_connection_external'`);
  assert.equal(rows.length, 1, 'connection-scoped unique index missing');
  assert.match(rows[0].indexdef, /connection_id/);
  const stale = await query(`select 1 from pg_indexes where indexname = 'uq_ad_view_external'`);
  assert.equal(stale.rows.length, 0, 'provider-scoped index still present');
});

test('the ad-gated model contains no payment fields on content', async () => {
  // Content has no price. If a price column ever appears on assets or unlocks,
  // the model has drifted back to being a shop.
  const { rows } = await query(`
    select table_name, column_name from information_schema.columns
     where table_schema = 'public'
       and table_name in ('assets','unlocks','orders','entitlements')
       and (column_name like '%price%' or column_name like '%amount%' or column_name like '%currency%')`);
  assert.deepEqual(rows, [], `payment fields on content: ${JSON.stringify(rows)}`);
});

test('KYC stores the result, never the documents', async () => {
  // contype 'c' = CHECK. Without it, the NOT NULL constraint on the same column
  // also matches and the assertion passes for the wrong reason.
  const { rows } = await query(`
    select conname, pg_get_constraintdef(oid) def from pg_constraint
     where conrelid = 'seller_verifications'::regclass and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%docs_retained%'`);
  assert.equal(rows.length, 1, 'seller_verifications must CHECK that docs_retained is false');
  assert.match(rows[0].def, /docs_retained\s*=\s*false/i, `unexpected: ${rows[0].def}`);
});

test('a seller\'s legal name and phone are not in any buyer-facing table', async () => {
  // The buyer must not be able to identify or track the seller.
  const { rows } = await query(`
    select table_name, column_name from information_schema.columns
     where table_schema = 'public' and column_name in ('legal_name','phone')
       and table_name <> 'profiles'`);
  assert.deepEqual(rows, [], `private identity outside profiles: ${JSON.stringify(rows)}`);
});

test('seeds are present and idempotent to re-apply', async () => {
  const plans = await query('select code from plans order by code');
  assert.deepEqual(plans.rows.map((r) => r.code), ['free', 'pro', 'store']);
  const slots = await query('select count(*)::int n from slot_definitions');
  assert.ok(slots.rows[0].n >= 5, 'slot_definitions should be seeded');
  const rules = await query('select count(*)::int n from policy_rules');
  assert.ok(rules.rows[0].n >= 9, 'policy_rules should be seeded');
});
