import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { AUDIT_FAMILIES, familyOf, familyCase, actorOf, subjectOf } from '../src/audit.js';
import { after } from 'node:test';
import * as views from '../src/views.js';

// Before anything that can reach the pool. Static imports are evaluated before
// the importing file's body runs, so an env assignment written above a static
// `import { store }` still lands too late — that is how the first version of
// this file wrote its fixtures into the DEVELOPMENT database.
process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:55432/bytebikri_test';
const { store } = await import('../src/store.js');

// One pool for the whole file, closed once when it ends. Closing inside a test
// ends the pool for every test after it — "Cannot use a pool after calling end
// on the pool" — which is a test-harness bug that looks like a product bug.
const { query, close } = await import('../src/db.js');
after(async () => { await close(); });

const root = path.resolve(import.meta.dirname, '..');
const serverSrc = readFileSync(path.join(root, 'server.js'), 'utf8');
const srcFiles = readdirSync(path.join(root, 'src')).filter((f) => f.endsWith('.js'));

/** Every action string written by `store.audit('...')` or `audit('...')` anywhere. */
function auditActions() {
  const found = new Set();
  const sources = [serverSrc, ...srcFiles.map((f) => readFileSync(path.join(root, 'src', f), 'utf8'))];
  for (const raw of sources) {
    // Comments out first. The first version of this test failed on its own
    // documentation: the audit module explains the shape of a call as
    // `audit('...')`, and `...` matches an action-name pattern perfectly.
    const text = raw.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
    for (const m of text.matchAll(/(?:store\.)?audit\('([a-z_.]+)'/g)) {
      if (!/^[a-z][a-z_.]*$/i.test(m[1]) || /^\.+$/.test(m[1])) continue;
      found.add(m[1]);
    }
  }
  return [...found].sort();
}

// ---------------------------------------------------------------------------
// The vocabulary
// ---------------------------------------------------------------------------

test('every action the code writes belongs to a family', () => {
  // The researched failure: inconsistent action names make a feed read like
  // noise. A new action string that belongs nowhere is how that comes back, so
  // this reads the source and refuses to let one exist unclassified.
  const actions = auditActions();
  assert.ok(actions.length >= 20, `expected the code to write many actions, found ${actions.length}`);
  const orphans = actions.filter((a) => familyOf(a) === null);
  assert.deepEqual(orphans, [],
    `these actions belong to no family, so they would land in "other" on the audit page: ${orphans.join(', ')}. `
    + 'Add a prefix to AUDIT_FAMILIES in src/audit.js.');
});

test('the SQL classifier and the JavaScript one cannot disagree', async () => {
  // They are two implementations of "which family is this", and the first version
  // of the SQL grouped tests by family while the JS took the longest prefix —
  // so `content.watermark_failed` was "delivery" in a tab and "stores" in a
  // filtered query. Both now mean longest-prefix-wins; this proves it over every
  // action the code can write, plus the near-miss pairs.
  const actions = [...auditActions(), 'content.watermark_failed', 'content.denied', 'content.free_grant', 'unknown.thing'];
  const values = actions.map((a) => `('${a}')`).join(',');
  const res = await query(
    `select action, ${familyCase()} as family from (values ${values}) as t(action)`,
  );
  const disagreements = res.rows
    .filter((r) => r.family !== (familyOf(r.action) ?? 'other'))
    .map((r) => `${r.action}: sql=${r.family} js=${familyOf(r.action) ?? 'other'}`);
  assert.deepEqual(disagreements, [], 'the tab and the filter must count the same row the same way');
});

test('an unclassified action is visible rather than silently swallowed', async () => {
  const res = await query(`select ${familyCase()} as family from (values ('something.new')) as t(action)`);
  assert.equal(res.rows[0].family, 'other',
    'an action nobody has classified lands in "other", where the tab list shows it exists');
});

// ---------------------------------------------------------------------------
// Who did it
// ---------------------------------------------------------------------------

test('an actor is a person, the platform, or a visitor — never a dash', () => {
  const person = actorOf({ action: 'auth.login', actor_email: 'a@b.c', actor_name: 'Alice' });
  assert.equal(person.kind, 'person');
  assert.equal(person.label, 'Alice');

  // A null actor is a STATEMENT, not a gap: a postback has no person behind it.
  const platform = actorOf({ action: 'postback.no_grant' });
  assert.equal(platform.kind, 'platform');
  assert.match(platform.detail, /automated/);

  // …but consent is not the platform either. A visitor chose that, and crediting
  // the platform with somebody's decision is a false statement, not a blank.
  const visitor = actorOf({ action: 'consent.recorded' });
  assert.equal(visitor.kind, 'visitor');
  assert.match(visitor.detail, /not signed in/);
  assert.equal(actorOf({ action: 'postback.no_grant' }).kind, 'platform',
    'and the two null-actor cases stay distinct');
});

test('a subject resolves to something a person recognises', () => {
  const storeSubject = subjectOf({ subject_type: 'channel', subject_slug: 'alice', subject_label: "Alice's Studio" });
  assert.equal(storeSubject.href, '/admin/stores/alice', 'a store links to the store');
  const personSubject = subjectOf({ subject_type: 'profile', subject_id: 'abc' });
  assert.equal(personSubject.href, '/admin/users/abc');
  assert.equal(subjectOf({ subject_type: null }), null);
  // A subject whose row is gone keeps its type and no name: the event stays, and
  // the page does not pretend to resolve something that no longer exists.
  const gone = subjectOf({ subject_type: 'channel', subject_slug: null, subject_label: null });
  assert.equal(gone.href, null);
  assert.equal(gone.label, null);
});

// ---------------------------------------------------------------------------
// Attribution: the bug that made the log unreadable
// ---------------------------------------------------------------------------

test('a call site that knows who is acting passes the actor, not just meta', () => {
  // `auth.login` put the user id in `meta.userId` for months, so the largest
  // family in the log had a null actor and nothing could join on it. Nothing about
  // that is visible in a diff — the call looks right — so this reads the source
  // and refuses the shape: if a call names a `userId` in its meta and also has a
  // user in hand, it must pass `actorId`.
  const callSites = [];
  for (const [name, text] of [['server.js', serverSrc], ...srcFiles.map((f) => [f, readFileSync(path.join(root, 'src', f), 'utf8')])]) {
    for (const m of text.matchAll(/(?:store\.)?audit\(/g)) {
      // Balanced-parenthesis scan, so a call containing nested calls is read whole.
      let depth = 0; let i = m.index + m[0].length - 1;
      const start = i;
      for (; i < text.length; i += 1) {
        if (text[i] === '(') depth += 1;
        else if (text[i] === ')') { depth -= 1; if (depth === 0) break; }
      }
      callSites.push({ name, line: text.slice(0, m.index).split('\n').length, body: text.slice(start, i + 1) });
    }
  }
  assert.ok(callSites.length >= 20, `expected many audit call sites, found ${callSites.length}`);

  const suspicious = callSites.filter((c) => /userId:\s*\w/.test(c.body) && !/actorId/.test(c.body));
  assert.deepEqual(suspicious.map((c) => `${c.name}:${c.line}`), [],
    'these audit calls name a user in their meta but do not pass actorId, so the row '
    + 'cannot be attributed to anybody: ' + suspicious.map((c) => `${c.name}:${c.line}`).join(', '));
});

test('the backfill actually attributed the rows that were written wrong', async () => {
  // Migration 0019 fills actor_id from meta->>userId for rows written before the
  // fix. This asserts no such row is left behind: history that cannot answer
  // "who" is the whole reason the migration exists.
  const res = await query(
    `select count(*)::int as n from audit_logs
      where actor_id is null
        and meta ->> 'userId' is not null
        and exists (select 1 from profiles p where p.id = (meta ->> 'userId')::uuid)`,
  );
  assert.equal(res.rows[0].n, 0, 'every row that names a user in its meta has an actor now');
});

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------

const row = (over = {}) => ({
  id: 1, action: 'rent.payment_matched', family: 'money', created_at: '2026-09-21T09:30:00Z',
  actor_id: 'u1', actor_email: 'operator@bytebikri.local', actor_name: 'operator', actor_role: 'admin',
  subject_type: 'channel', subject_id: 'c1', subject_label: "Alice's Studio", subject_slug: 'alice',
  meta: { amountNpr: 1234, reference: 'ESW-9911' }, ...over,
});

const render = (over = {}) => views.adminAudit({
  user: { role: 'admin', email: 'op@example.com', display_name: 'Op' },
  data: {
    rows: [row()], total: 1, allRows: 42, page: 1, pages: 3, perPage: 50,
    counts: { money: { n: 1 }, signins: { n: 40 }, people: { n: 1 } },
    ...over,
  },
  filters: { family: 'decisions', actor: '', q: '', since: 'all' },
});

test('the page states the window, so a page of results is never read as the history', () => {
  const html = render();
  assert.match(html, /Showing 1 of 1 matching, out of 42 in the table/,
    'the count describes the TABLE, not the array the page fetched');
  assert.match(html, /Page 1 of 3/);
  assert.match(html, /Times are UTC/);
  assert.match(html, /2026-09-21 09:30/, 'and a timestamp is unambiguous');
});

test('the tabs count the whole table, so a filter can never change them', () => {
  const html = render();
  // 42 rows in the table; the decisions tab counts money + people families.
  assert.match(html, /Decisions<span class="seg-count">2<\/span>/);
  assert.match(html, /Sign-ins<span class="seg-count">40<\/span>/,
    'the family that dwarfs the rest says so on its own tab');
  assert.match(html, /Everything<span class="seg-count">42<\/span>/);
});

test('a row renders who, what, and a way to look deeper', () => {
  const html = render();
  assert.match(html, /operator@bytebikri\.local/);
  assert.match(html, /href="\/admin\/stores\/alice"[^>]*>Alice&#39;s Studio</);
  assert.match(html, /raw<\/summary>/, 'the full JSON is behind a disclosure, not in the row');
  assert.match(html, /Money/, 'and the family is named next to the action');
});

test('an empty result explains the filters rather than reading as an empty log', () => {
  const filtered = views.adminAudit({
    user: { role: 'admin', email: 'op@example.com', display_name: 'Op' },
    data: { rows: [], total: 0, allRows: 42, page: 1, pages: 1, perPage: 50, counts: { signins: { n: 42 } } },
    filters: { family: 'money', actor: 'nobody', q: '', since: 'all' },
  });
  assert.match(filtered, /Nothing matches the Money view/);
  // The intent, not the wording: the size of the log travels with the failure to
  // match, and the page never says the log itself is empty when it is not.
  assert.match(filtered, /The log holds 42 rows in total/);
  assert.ok(!/nothing has been recorded yet/.test(filtered),
    'a filter that matches nothing is not the same as a log that holds nothing');
  assert.match(filtered, /No rows match\. Clear the filters above/, 'and the reader is told what to do');

  // Found by looking at the page: a FAMILY tab with no rows took the "the table is
  // empty" branch, so the Money tab announced an empty log while eight rows sat in
  // it. A chosen tab narrows the view exactly like a typed filter does.
  const emptyTab = views.adminAudit({
    user: { role: 'admin', email: 'op@example.com', display_name: 'Op' },
    data: { rows: [], total: 0, allRows: 8, page: 1, pages: 1, perPage: 50, counts: { people: { n: 8 } } },
    filters: { family: 'money', actor: '', q: '', since: 'all' },
  });
  assert.match(emptyTab, /Nothing matches the Money view\./);
  assert.match(emptyTab, /The log holds 8 rows in total/);
  assert.ok(!/nothing has been recorded yet/.test(emptyTab), 'the log is not empty because one tab is');

  const emptyLog = views.adminAudit({
    user: { role: 'admin', email: 'op@example.com', display_name: 'Op' },
    data: { rows: [], total: 0, allRows: 0, page: 1, pages: 1, perPage: 50, counts: {} },
    filters: { family: 'decisions', actor: '', q: '', since: 'all' },
  });
  assert.match(emptyLog, /nothing has been recorded yet/);
});

test('families are ordered decisions-first, and the note explains each one', () => {
  const keys = AUDIT_FAMILIES.map((f) => f.key);
  assert.deepEqual(keys.slice(0, 4), ['money', 'moderation', 'people', 'exports'],
    'the families that record a person deciding something come first');
  for (const family of AUDIT_FAMILIES) {
    assert.ok(family.note.length > 40, `${family.key} needs a note saying what it supports — the tabs are not self-explanatory`);
  }
  assert.ok(AUDIT_FAMILIES.find((f) => f.key === 'signins').note.includes('drowns'),
    'the sign-in family admits why it is separated');
});

test('issuing an invoice is recorded once, not on every dashboard view', async () => {
  // `ensureRentInvoice` runs on EVERY dashboard view and is idempotent through
  // `on conflict do nothing`. An audit row written unconditionally would fill the
  // log with "invoiced" lines for an invoice issued months ago — the noise that
  // makes an audit log unreadable — so the row is tied to `returning id`, which
  // only yields on a real insert.
  const user = await store.userByEmailOrCreate(`audit-rent-${Date.now()}@test.local`);
  const ch = await store.createChannel({
    ownerId: user.id, slug: `audit-rent-${Date.now()}`, name: 'Rent audit store',
  });
  const estimate = { pageviews30d: 12_000, rent: 1, total: 5, estNpr: 10, rpmUsd: 0.2, usdToNpr: 133 };

  const first = await store.ensureRentInvoice({ channel: ch, estimate });
  assert.ok(first, 'an invoice was issued');
  const afterFirst = await query(
    `select count(*)::int as n from audit_logs where action = 'rent.invoice_issued' and subject_id = $1`,
    [ch.id],
  );
  assert.equal(afterFirst.rows[0].n, 1, 'the issuance is in the record');

  // Twice more, as three dashboard views would.
  await store.ensureRentInvoice({ channel: ch, estimate });
  await store.ensureRentInvoice({ channel: ch, estimate });
  const afterThree = await query(
    `select count(*)::int as n from audit_logs where action = 'rent.invoice_issued' and subject_id = $1`,
    [ch.id],
  );
  assert.equal(afterThree.rows[0].n, 1, 'and it is not written again for the same period');

  // The row has to be readable by the page it now appears on: an attributed
  // system event in the money family, pointing at the store.
  const detail = await store.auditSearch({ family: 'money', q: 'invoice_issued' });
  const mine = detail.rows.find((r) => r.subject_id === ch.id);
  assert.ok(mine, 'the money family picks it up');
  assert.equal(mine.family, 'money');
  assert.equal(mine.subject_slug, ch.slug, 'and the store resolves, so the row is actionable');
  assert.equal(actorOf(mine).kind, 'platform', 'an invoice issues on its own: no person is credited with it');
  assert.match(briefMetaFor(mine.meta), /amount: NPR/, 'and the amount is in the detail line');
});

/** The page's own one-line renderer, so this test reads a row the way an operator does. */
function briefMetaFor(meta) {
  return views.briefMeta(meta);
}

test('page two is page two, and the route is what decides that', async () => {
  // The failure this guards: the pagers render `?page=2`, the SQL helper honours a
  // `page`, and nothing in between read the query string — so "Older →" showed
  // page 1 again. It cannot be seen until a log has more rows than fit on a page,
  // which is the definition of a bug that ships.
  const stamp = Date.now();
  for (let i = 0; i < 55; i++) {
    await store.audit('file.fetched', { note: `paging ${stamp}`, n: i });
  }

  const first = await store.auditSearch({ family: 'all', perPage: 50, page: 1 });
  const second = await store.auditSearch({ family: 'all', perPage: 50, page: 2 });
  assert.ok(first.pages >= 2, '55 rows do not fit on one page of 50');
  assert.equal(first.rows.length, 50);
  assert.ok(second.rows.length >= 1, 'and the overflow is on the second page');
  assert.equal(second.page, 2);
  const firstIds = new Set(first.rows.map((r) => r.id));
  assert.ok(!second.rows.some((r) => firstIds.has(r.id)), 'no row is on both pages');
  // Newest first: a log read top-down is read from now backwards.
  assert.ok(new Date(first.rows[0].created_at) >= new Date(first.rows.at(-1).created_at));

  // And the route has to pass it through — that is the whole bug.
  // The route's own registration, not the dashboard's link to it — the first
  // occurrence in the file is an `href`.
  const route = serverSrc.slice(serverSrc.indexOf("APP.get('/admin/audit'"));
  const filters = route.slice(0, route.indexOf('};'));
  assert.match(filters, /page:\s*Math[\s\S]{0,80}req\.query\.page/,
    'the audit route reads ?page= into its filters');
});

test('a pager link keeps the view you were reading', () => {
  // Found by clicking: the link builder dropped any filter whose value was the
  // literal string `all`, which is right for `since=all` (the default) and wrong
  // for `family=all`, which is the Everything tab. Every page after the first
  // silently switched to the Decisions tab — a different page of a different log.
  const rows = Array.from({ length: 2 }, (_, i) => ({
    id: String(i), created_at: '2026-09-01T10:00:00Z', action: 'file.fetched',
    family: 'delivery', meta: {}, subject_type: null,
  }));
  const html = views.adminAudit({
    user: { role: 'admin', email: 'op@example.com', display_name: 'Op' },
    data: { rows, total: 172, allRows: 172, page: 1, pages: 4, perPage: 50, counts: { delivery: { n: 172 } } },
    filters: { family: 'all', actor: '', q: '', since: 'all' },
  });
  assert.match(html, /href="\/admin\/audit\?family=all&amp;page=2"/,
    'page two of Everything stays Everything');
  // And the default view is still written without a query string.
  const decisions = views.adminAudit({
    user: { role: 'admin', email: 'op@example.com', display_name: 'Op' },
    data: { rows, total: 172, allRows: 172, page: 1, pages: 4, perPage: 50, counts: {} },
    filters: { family: 'decisions', actor: '', q: '', since: 'all' },
  });
  assert.match(decisions, /href="\/admin\/audit\?page=2"/, 'the default view stays clean');
});
