/**
 * Deleting a file — and taking it down for real.  npm test
 *
 * Two claims, and the second one is the one that was false before this round:
 *
 *   1. A DELETE DESTROYS THE BYTES AND VOIDS THE ACCESS. The file rows go, the disk file
 *      goes, the unlocks are revoked, and the asset becomes a tombstone that keeps its
 *      history without keeping its addresses.
 *
 *   2. A HOST THAT CANNOT DELETE DOES NOT MAKE THE DELETE A LIE. Telegra.ph has no delete
 *      endpoint and its `remove()` throws a sentence saying so. The old outcome — refuse
 *      the whole delete, keep serving the picture — is the one a seller would never accept;
 *      what happens instead is that everything local is destroyed, the surviving copy is
 *      reported as an ORPHAN with the host named, and the caller can say exactly what it
 *      could not take back.
 *
 * The state gate is tested here too, because "cannot be accessed any more" is only true if
 * the BYTE path refuses a deleted, hidden or unpublished file — the storefront hiding a card
 * was never the promise. `closedToViewers` is the single rule three routes read, so these
 * assertions are the product's delivery contract rather than one route's behaviour.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:55432/bytebikri_test';

const { close, query } = await import('../src/db.js');
const { store, storage } = await import('../src/store.js');
const { closedToViewers } = await import('../src/moderation.js');
after(async () => { await close(); });

const here = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS = path.resolve(here, '../.data/uploads');

let seq = 0;
/** A store with one live file, and one attached file whose bytes are where the test says. */
async function fixture({ remote = false, unlock = false } = {}) {
  const tag = `${Date.now()}-${++seq}`;
  const owner = await store.userByEmailOrCreate(`owner-delete-${tag}@test.local`);
  const channel = await store.createChannel({ ownerId: owner.id, slug: `del-${tag}`, name: `Delete ${tag}` });
  const asset = await store.createAsset({
    channelId: channel.id, title: `To delete ${tag}`, slug: `to-delete-${tag}`,
    description: 'x', unlockMode: unlock ? 'paid' : 'open',
  });
  await query(`update assets set status = 'live' where id = $1`, [asset.id]);

  let storageKey;
  if (remote) {
    // A key from the one host that declares it cannot delete. The provider is part of the
    // key, which is why the delete goes to Telegra.ph rather than to whatever is configured.
    storageKey = `telegraph/${tag}-0000-0000-0000-000000000000.png`;
  } else {
    storageKey = await storage.put(Buffer.from('bytes that are about to stop existing'), `${tag}.txt`, {
      namespace: 'private', mimeType: 'text/plain',
    });
  }
  const file = await store.addFile({
    assetId: asset.id, storageKey, filename: `${tag}.txt`, mimeType: 'text/plain', sizeBytes: 38,
  });
  const viewer = unlock
    ? await store.userByEmailOrCreate(`viewer-delete-${tag}@test.local`)
    : null;
  if (viewer) {
    await store.grantUnlock({
      assetId: asset.id, channelId: channel.id, userId: viewer.id, method: 'open',
      policy: { unlock_hours: 0 },
    });
  }
  return { owner, channel, asset, file, viewer, storageKey, tag };
}

async function cleanup({ owner, channel, viewer }) {
  await query('delete from audit_logs where subject_id = $1', [channel.id]);
  await query('delete from assets where channel_id = $1', [channel.id]);
  await query('delete from channels where id = $1', [channel.id]);
  await query('delete from profiles where id = $1', [owner.id]);
  if (viewer) await query('delete from profiles where id = $1', [viewer.id]);
}

// ── the delete itself ───────────────────────────────────────────────────────

test('deleting a file destroys its bytes, its addresses, and the access it granted', async () => {
  const f = await fixture({ unlock: true });
  try {
    const onDisk = path.join(UPLOADS, f.storageKey);
    await fs.access(onDisk);                       // the file really is there to begin with

    const out = await store.deleteAsset({ assetId: f.asset.id, actorId: f.owner.id });

    assert.equal(out.asset.status, 'deleted', 'the asset becomes a tombstone');
    assert.ok(out.asset.deleted_at, 'and it remembers when');
    assert.deepEqual(out.orphans, [], 'nothing was left behind: the disk is ours');
    assert.equal(out.destroyed.length, 1);
    assert.equal(out.unlocksVoided, 1, 'the one person who had it open lost access');

    await assert.rejects(() => fs.access(onDisk), 'the bytes are gone from our disk');
    assert.equal(await store.fileById(f.file.id), null, 'and the address is gone, so no route can look it up');
    assert.equal(await store.unlockFor(f.asset.id, f.viewer.id), null, 'the unlock no longer resolves');
    assert.equal((await store.filesOf(f.asset.id)).length, 0);
  } finally { await cleanup(f); }
});

test('a host with no delete endpoint leaves an orphan that is named, not a failed delete', async () => {
  /*
   * THE TELEGRAPH CASE, which is the one that started this: it has no delete API, and the
   * temptation is to refuse. That refusal is what leaves a picture the seller has explicitly
   * disowned still being served by us. So this asserts both halves at once — the delete
   * succeeds locally, and the copy that survives is reported rather than hidden.
   */
  const f = await fixture({ remote: true });
  try {
    const out = await store.deleteAsset({ assetId: f.asset.id, actorId: f.owner.id });

    assert.equal(out.asset.status, 'deleted');
    assert.equal(out.destroyed.length, 0, 'nothing was destroyed at the host, and nothing pretends otherwise');
    assert.equal(out.orphans.length, 1, 'the surviving copy is reported');
    assert.equal(out.orphans[0].host, 'telegraph');
    assert.equal(out.orphans[0].key, f.storageKey);
    assert.match(out.orphans[0].reason, /delete/i, 'and it carries the host\'s own reason');
    assert.equal((await store.filesOf(f.asset.id)).length, 0, 'the address is gone even though the bytes are not');

    // The operator's record: the orphan is in the audit log, with the key, so somebody can
    // go and look at it rather than wonder which URL is still live.
    const { rows } = await query(
      `select meta from audit_logs where action = 'asset.deleted' and subject_id = $1`, [f.asset.id]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].meta.orphans[0].host, 'telegraph');
  } finally { await cleanup(f); }
});

test('a deleted file keeps its row for the history and loses every address', async () => {
  const f = await fixture();
  try {
    await query(
      `update assets set external_url = null, cover_url = 'https://telegra.ph/file/whatever.png' where id = $1`,
      [f.asset.id]);
    await query(`update assets set cover_url = 'https://elsewhere.example/x.png' where id = $1`, [f.asset.id]);

    const out = await store.deleteAsset({ assetId: f.asset.id, actorId: f.owner.id });
    assert.equal(out.asset.cover_url, null,
      'a cover that lives at somebody else\'s address is a picture of a deleted file, and it goes too');

    // A cover on OUR OWN origin is a path (`/img/...`) and stays: it cannot leak anything the
    // tombstone does not already show, and it is the only thing left to look at.
    const f2 = await fixture();
    try {
      await query(`update assets set cover_url = '/img/demo/kathmandu-street.jpg' where id = $1`, [f2.asset.id]);
      const out2 = await store.deleteAsset({ assetId: f2.asset.id, actorId: f2.owner.id });
      assert.equal(out2.asset.cover_url, '/img/demo/kathmandu-street.jpg');
    } finally { await cleanup(f2); }
  } finally { await cleanup(f); }
});

test('deleting twice is the same as deleting once, and a bad id deletes nothing', async () => {
  /*
   * Idempotence matters here more than it looks: the tombstone page offers no delete button,
   * but a seller can hold a stale tab open and press the one they opened before. The second
   * call must not report destroying a file that was already gone, must not void unlocks that
   * are already void, and — the part worth asserting — must not throw.
   */
  const f = await fixture();
  try {
    assert.equal(await store.deleteAsset({ assetId: 'not-a-uuid' }), null, 'an id that is not an id deletes nothing');

    const first = await store.deleteAsset({ assetId: f.asset.id, actorId: f.owner.id });
    assert.equal(first.destroyed.length, 1, 'the first delete really destroys the file');

    const again = await store.deleteAsset({ assetId: f.asset.id, actorId: f.owner.id });
    assert.equal(again.asset.status, 'deleted');
    assert.equal(again.already, true, 'the second call is told there was nothing to do');
    assert.equal(again.unlocksVoided, 0, 'a second delete voids nothing, because there is nothing left');
    assert.equal(again.destroyed.length, 0, 'and it does not claim to have destroyed anything');
    assert.equal(again.orphans.length, 0);
  } finally { await cleanup(f); }
});

test('the delete route is the seller\'s own store only, and asks for the word', () => {
  /*
   * A SOURCE GUARD, in the style the other route rules use. Two things about this route can
   * only be wrong in `server.js` — it must check that the file belongs to THIS channel (an id
   * from another store is a 404, not a delete), and it must check the typed confirmation
   * server-side, because a confirmation that lives in an `onsubmit` is one a scripted post
   * skips. Both are asserted from the source rather than inferred from a store call, which
   * cannot see the route's guards at all.
   */
  const src = readFileSync(new URL('../server.js', import.meta.url), 'utf8');
  const at = src.indexOf("APP.post('/dashboard/:slug/assets/:assetId/delete'");
  assert.ok(at > 0, 'the delete route was not found — this guard needs updating');
  const handler = src.slice(at, src.indexOf('});', at));
  assert.match(handler, /asset\.channel_id !== channel\.id/,
    'a file id from another store must 404 rather than delete');
  assert.match(handler, /req\.body\?\.confirm[^;]*!==\s*'delete'/,
    'the confirmation word is checked on the server, not only in the browser');
  assert.doesNotMatch(handler, /toLowerCase\(\)[^;]*===\s*'delete'|toLowerCase\(\)\s*!==\s*'delete'/,
    'and it is the exact word: folding the case accepts a confirmation nobody typed');
  assert.match(handler, /store\.deleteAsset\(/, 'and the delete goes through the one store call');
});

// ── the delivery rule the delete depends on ─────────────────────────────────

test('a deleted file is closed to viewers, and to the buyer who had unlocked it', () => {
  const closed = closedToViewers({ status: 'deleted' });
  assert.equal(closed.status, 410, '410, not 404: the address was real and the file was really there');
  assert.match(closed.error, /deleted/i);
  /*
   * And to the OWNER as well — the walk found this the hard way. Privilege here means "may
   * still look at a hidden or paused file", and for a deleted one there is nothing to look at:
   * the first version exempted the owner, whose request then fell through to the entitlement
   * check and came back 403 "you have not unlocked this" — an answer about a file that no
   * longer exists. The tombstone PAGE is where an owner inspects a delete; the byte route is
   * where nobody does.
   */
  assert.equal(closedToViewers({ status: 'deleted' }, { privileged: true }).status, 410,
    'the owner does not get the bytes of a file they deleted');
  assert.equal(closedToViewers(null), null, 'and a file that is not there at all is not this branch\'s business');
});

test('pausing keeps serving the people who already hold it — that is what an unlock bought', () => {
  assert.equal(closedToViewers({ status: 'paused' }), null,
    'a two-minute fix must not take the file away from every buyer');
  assert.equal(closedToViewers({ status: 'live' }), null);
});

test('a hidden file stops being served, which is what hiding it was for', () => {
  const closed = closedToViewers({ status: 'live', hidden_by_reports: true });
  assert.equal(closed.status, 403);
  assert.match(closed.error, /review/i);
  assert.equal(closedToViewers({ status: 'live', hidden_by_reports: true }, { privileged: true }), null);
  // And a hidden-but-paused file is still hidden, whatever else its status says.
  assert.equal(closedToViewers({ status: 'paused', hidden_by_reports: true }).status, 403);
});

test('an unpublished file is not served to a stranger who somehow holds a token', () => {
  for (const status of ['draft', 'pending_review', 'removed']) {
    assert.equal(closedToViewers({ status }).status, 404, `${status} is not published`);
  }
});
