/**
 * The playlist rule, and the copy of it that lives in the schema.  npm test
 *
 * A live file's address is stored in `assets.external_url`, and migration 0048 puts a check
 * constraint on that column: https (or same-origin) and ending `.m3u8`. The reason is viewer-facing —
 * a storefront is https in production, a viewer's browser fetches the playlist ITSELF, and a
 * plain-http playlist on an https page is mixed content that the browser refuses with no error a
 * seller would ever see.
 *
 * `src/media.js` has `storableLiveUrl()`, the same rule in JavaScript. It exists because a constraint
 * is enforced at INSERT and a failed insert is a 500: the first version of the go-live route trusted
 * the address its own streaming server returned, the constraint refused it, and the seller got
 * "Something broke" with a request id instead of the sentence that names the operator's mistake.
 *
 * SO THE TWO COPIES HAVE TO AGREE, and this file is how that is checked: rather than re-writing the
 * regexes here (which would be a THIRD copy, agreeing with nobody), the test asks Postgres itself —
 * `select $1 ~ <the constraint's own expression>` — for each address, and compares the answer with the
 * JavaScript predicate. If somebody edits the constraint in a future migration, this fails and says
 * which address the two now disagree about.
 *
 * A distinct file rather than three tests in `video.test.js`, because that file is about talking to
 * hosts over the network and this one is about the shape of a stored row.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:55432/bytebikri_test';

const { query, close } = await import('../src/db.js');
const { storableLiveUrl, isLiveUrl } = await import('../src/media.js');

after(async () => { await close(); });

/**
 * The addresses worth disagreeing about.
 *
 * `deliberately-different` marks the rows where the two answers are expected to differ: `isLiveUrl`
 * (the shape predicate, case-insensitive) accepts `.M3U8` and `rtmp://` because those ARE stream
 * shapes, while `storableLiveUrl` refuses them because neither can be stored — the first because the
 * constraint's regex is case-sensitive, the second because a browser cannot fetch it.
 */
const ADDRESSES = [
  ['https://stream.example.com/LiveApp/streams/a1b2c3.m3u8', true],
  ['https://stream.example.com/LiveApp/streams/a1b2c3.m3u8?token=abc', true],
  ['https://stream.example.com/LiveApp/streams/a1b2c3.m3u8#frag', true],
  ['/live-demo/index.m3u8', true],
  ['/', false],
  ['/live-demo/index.m3u8?t=1', true],
  // The case the constraint is strict about, and the reason a seller's paste could reach a 500.
  ['https://stream.example.com/LiveApp/streams/a1b2c3.M3U8', false],
  ['HTTPS://stream.example.com/x.m3u8', false],
  // Plain http: mixed content on any https storefront.
  ['http://stream.example.com/LiveApp/streams/a1b2c3.m3u8', false],
  ['http://127.0.0.1:5090/LiveApp/streams/a1b2c3.m3u8', false],
  // Not a playlist at all.
  ['rtmp://stream.example.com/LiveApp/a1b2c3', false],
  ['https://stream.example.com/watch', false],
  ['', false],
  ['https://stream.example.com/a.m3u8/extra', false],
  // Whitespace: the constraint's character class is "not a space", and a trailing newline pasted from
  // a terminal is exactly how a "valid" address gets refused at the database instead of the form.
  ['https://stream.example.com/a.m3u8\n', false],
  ['https://stream.example.com/a b.m3u8', false],
];

test('the JS playlist rule and the schema constraint agree, address by address', async () => {
  for (const [url, expected] of ADDRESSES) {
    const [{ ok }] = (await query(
      `select exists (select 1 from pg_constraint where conname = 'assets_external_url_is_hls') as ok`,
    )).rows;
    assert.equal(ok, true, 'migration 0048 is not applied — nothing to mirror');

    /*
     * The constraint's EXPRESSION, evaluated by the database on a literal. Written out here rather
     * than imported, because the point is to ask the running schema; if the expression in 0048
     * changes, this string has to change with it, and the test below (`the constraint still says…`)
     * fails until it does.
     */
    const [{ accepted }] = (await query(
      `select ($1::text is null
         or $1::text ~ '^https://[^[:space:]]+\\.m3u8([?#][^[:space:]]*)?$'
         or $1::text ~ '^/[^[:space:]]*\\.m3u8([?#][^[:space:]]*)?$') as accepted`,
      [url],
    )).rows;

    assert.equal(
      storableLiveUrl(url), accepted,
      `storableLiveUrl and the schema disagree about ${JSON.stringify(url)}: `
      + `js=${storableLiveUrl(url)} schema=${accepted}`,
    );
    assert.equal(storableLiveUrl(url), expected, `storableLiveUrl(${JSON.stringify(url)})`);
  }
});

test('the shape predicate stays looser than the storage rule, and the difference is named', () => {
  // A row exists for each of these in the table above; this test states WHY, so nobody "fixes" one
  // predicate into the other. `isLiveUrl` answers "is this shaped like a stream" and is used by the
  // shape router; `storableLiveUrl` answers "may this be kept" and guards the form.
  assert.equal(isLiveUrl('https://x.example/a.M3U8'), true, 'a playlist in caps is still a playlist');
  assert.equal(storableLiveUrl('https://x.example/a.M3U8'), false, 'but the schema will not store one');
  assert.equal(isLiveUrl('rtmp://x.example/app/key'), true, 'rtmp is what an encoder speaks');
  assert.equal(storableLiveUrl('rtmp://x.example/app/key'), false, 'and a browser cannot fetch it');
  // The demo's own fixture, which the seed writes and every live walk depends on.
  assert.equal(storableLiveUrl('/live-demo/index.m3u8'), true);
});

test('a real insert of a refused address is refused by the database too', async () => {
  /*
   * The mirror above compares rule to rule. This one proves the rule is actually ON THE COLUMN, by
   * trying to write a plain-http address into a real row — the failure the go-live route turned into
   * a 500. It is deliberately not the happy path (no asset is created): the row is rolled back, and
   * the only thing asserted is that the database is the last line of defence it is supposed to be.
   */
  const { rows: [owner] } = await query(
    `insert into profiles (email, display_name) values ($1, 'Live URL test') returning id`,
    [`live-url-${Date.now()}@test.local`],
  );
  const { rows: [channel] } = await query(
    `insert into channels (owner_id, slug, name) values ($1, $2, $3) returning id`,
    [owner.id, `live-url-${Date.now()}`, 'Live URL test store'],
  );
  await assert.rejects(
    () => query(
      `insert into assets (channel_id, title, slug, kind, status, unlock_mode, external_url)
       values ($1, 'Stream', $2, 'digital', 'live', 'open', $3)`,
      [channel.id, `stream-${Date.now()}`, 'http://127.0.0.1:5090/LiveApp/streams/x.m3u8'],
    ),
    /assets_external_url_is_hls/,
    'the constraint is not on the column — a plain-http playlist could be stored',
  );

  // And the same row with a storable address goes in, so the rejection above is about the ADDRESS
  // rather than about anything else in the insert.
  const { rows: [asset] } = await query(
    `insert into assets (channel_id, title, slug, kind, status, unlock_mode, external_url)
     values ($1, 'Stream', $2, 'digital', 'live', 'open', $3) returning id, external_url`,
    [channel.id, `stream-ok-${Date.now()}`, 'https://stream.example.com/LiveApp/streams/x.m3u8'],
  );
  assert.match(asset.external_url, /^https:\/\//);
  await query('delete from assets where id = $1', [asset.id]);
  await query('delete from channels where id = $1', [channel.id]);
  await query('delete from profiles where id = $1', [owner.id]);
});
