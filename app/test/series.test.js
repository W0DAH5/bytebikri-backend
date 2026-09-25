/**
 * The series: a store's playlist, an order the store owns, and a position that is
 * nobody else's business.
 *
 * §15 designed it and §15.1 is the architecture — a series is a grouping of the
 * store's own files, so an episode is still an ordinary file with its own unlock mode,
 * its own ask and its own ledger row. These are the claims that would be lies if the
 * code drifted:
 *
 *   1. **The mode decides the order, and nothing else does.** A serial counts up and
 *      carries a next episode; a collection counts down and carries none, because
 *      "any order is fine" is what the store said by choosing it.
 *   2. **A finished episode is not "continue".** The last thirty seconds are the
 *      credits; handing somebody back the episode they just finished is the small
 *      dishonesty every streaming product commits here.
 *   3. **The order is authored.** There is no inferred next anywhere — YouTube's own
 *      research paper documents that failure — and the number is the store's, gaps and
 *      all: deleting episode 3 of 5 leaves 1, 2, 4, 5 and renumbering the rest behind
 *      the store's back would be us editing their edit.
 *   4. **A position is not evidence.** `watch_progress` is the reader's bookmark in
 *      video's shape: the store is never shown it, and no accounting path reads it.
 *      Asserted on the SQL, because that is where the promise actually lives.
 *   5. **A hand-made POST cannot do what the panel refuses**: a download cannot join a
 *      series, a foreign file cannot enter a store's series, and a number cannot be
 *      taken twice.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:55432/bytebikri_test';

const { store } = await import('../src/store.js');
const { query, close } = await import('../src/db.js');
const {
  SERIES_SHAPES, SERIES_MODES, SERIES_MODE_KEYS, SERIES_MAX_EPISODES, RESUME_MIN_SECONDS,
  FINISHED_TAIL_SECONDS, modeOf, episodeOrder, landingEpisode, nextEpisode, previousEpisode,
  resumeFrom, resumeSentence, isFinished, finishedGrace, clockWords, episodeWords, episodeCountWords,
  seriesSlug, seriesRefusal, seriesRefusalCode, freeEpisodeNo, seriesSummary,
} = await import('../src/series.js');
const { assetShape } = await import('../src/media.js');

after(async () => { await close(); });

let seq = 0;

/** A store on a plan that can publish, with a series and one live video episode in it. */
async function fixture({ seconds = 600, mode = 'serial' } = {}) {
  const tag = `${Date.now()}-${++seq}`;
  const owner = await store.userByEmailOrCreate(`srowner-${tag}@test.local`);
  const viewer = await store.userByEmailOrCreate(`srview-${tag}@test.local`);
  const channel = await store.createChannel({ ownerId: owner.id, slug: `sr-${tag}`, name: `SR ${tag}` });
  await query(
    `insert into subscriptions (channel_id, plan_code, status, period_start, period_end)
     values ($1, 'pro', 'active', now(), now() + interval '365 days')`,
    [channel.id],
  );
  const series = await store.createSeries({
    channelId: channel.id, slug: 'nights', title: 'Kathmandu Nights', mode,
  });
  return { owner, viewer, channel, series, seconds };
}

/** One video episode: a real file row so the shape classifier has something to read. */
async function addEpisode({ channel, series, title, no, seconds = 600, mime = 'video/mp4', filename = null }) {
  const asset = await store.createAsset({
    channelId: channel.id, title, slug: `${series.slug}-${no}-${Math.random().toString(36).slice(2, 7)}`,
    unlockMode: 'ad_gated',
  });
  await store.addFile({
    assetId: asset.id,
    storageKey: `test/${asset.id}/${filename || `${no}.mp4`}`,
    filename: filename || `${no}.mp4`,
    mimeType: mime,
    sizeBytes: 1024,
    checksum: 'a'.repeat(64),
  });
  await store.updateAsset(asset.id, { runtime_sec: seconds });
  await store.setEpisode({ assetId: asset.id, seriesId: series.id, episodeNo: no });
  return store.assetById(asset.id);
}

// ---------------------------------------------------------------------------
// The order, the modes, and what a series may hold
// ---------------------------------------------------------------------------

test('the mode decides the order, and the two modes are different products', () => {
  const episodes = [
    { id: 'c', title: 'Third', episode_no: 4 },
    { id: 'a', title: 'First', episode_no: 1 },
    { id: 'b', title: 'Second', episode_no: 2 },
  ];
  assert.deepEqual(episodeOrder(episodes, 'serial').map((e) => e.episode_no), [1, 2, 4]);
  assert.deepEqual(episodeOrder(episodes, 'collection').map((e) => e.episode_no), [4, 2, 1]);
  // The researched default: YouTube converts a playlist to a NON-serial show, and so
  // does this — claiming an order a store did not ask for is worse than omitting one.
  assert.equal(SERIES_MODES.collection.order, 'newest');
  assert.equal(SERIES_MODES.collection.next, false);
  assert.equal(SERIES_MODES.serial.next, true);
  assert.equal(modeOf('nonsense').key, 'collection', 'an unknown mode reads as the safe one');
  for (const key of SERIES_MODE_KEYS) {
    assert.ok(SERIES_MODES[key].words.length > 40, `${key} does not explain itself to the store`);
  }
  // Two episodes at one number cannot come out of SQL (the unique index refuses), but
  // a stable order is still the module's job rather than the sort's.
  const tied = episodeOrder([{ id: 'x', title: 'B', episode_no: 2 }, { id: 'y', title: 'A', episode_no: 2 }], 'serial');
  assert.deepEqual(tied.map((e) => e.id), ['y', 'x']);
});

test('a series is a playlist of things a player moves through, and the refusal says so', () => {
  assert.deepEqual(SERIES_SHAPES, ['watch', 'listen']);
  const channel = '11111111-1111-4111-8111-111111111111';
  const series = { id: 's', channel_id: channel };
  const base = { series, channelId: channel, episodes: [] };
  // A reader holds its own chapters (its step IS its episode) and a download has no
  // player to be next in.
  for (const shape of ['download', 'read', 'stream', 'play']) {
    const why = seriesRefusal({ ...base, asset: { id: 'a' }, shape });
    assert.ok(why && /player moves through/.test(why), `${shape} was allowed into a series`);
  }
  for (const shape of SERIES_SHAPES) {
    assert.equal(seriesRefusal({ ...base, asset: { id: 'a' }, shape }), null, `${shape} was refused`);
  }
  // Somebody else's file, and somebody else's series.
  assert.match(seriesRefusal({ ...base, asset: { id: 'a' }, shape: 'watch', channelId: 'other-store' }), /another store/);
  // Already in a different series: moving one is a decision, not a side effect.
  assert.match(
    seriesRefusal({ ...base, asset: { id: 'a', series_id: 'other' }, shape: 'watch' }),
    /already an episode of another series/,
  );
  // The same series is fine, and so is the number it already holds (the row is the row).
  assert.equal(seriesRefusal({ ...base, asset: { id: 'a', series_id: 's' }, shape: 'watch' }), null);
  // A taken number, an impossible number, a full series.
  const taken = [{ id: 'b', episode_no: 2 }];
  assert.match(seriesRefusal({ ...base, episodes: taken, asset: { id: 'a' }, shape: 'watch', episodeNo: 2 }), /Episode 2 is taken/);
  assert.match(seriesRefusal({ ...base, asset: { id: 'a' }, shape: 'watch', episodeNo: 0 }), /whole number from 1/);
  assert.equal(seriesRefusal({ ...base, asset: { id: 'a' }, shape: 'watch', episodeNo: 3 }), null);
  const full = Array.from({ length: SERIES_MAX_EPISODES }, (_, i) => ({ id: `e${i}`, episode_no: i + 1 }));
  assert.match(seriesRefusal({ ...base, episodes: full, asset: { id: 'a' }, shape: 'watch' }), /holds 200 episodes/);
  assert.equal(freeEpisodeNo([{ episode_no: 1 }, { episode_no: 4 }]), 5);
  assert.equal(freeEpisodeNo([]), 1);
});

test('an episode number belongs to the store, and a gap is not ours to close', () => {
  const summary = seriesSummary([
    { id: 'a', title: 'One', episode_no: 1 },
    { id: 'b', title: 'Two', episode_no: 2 },
    { id: 'c', title: 'Four', episode_no: 4 },
  ], 'serial');
  assert.equal(summary.count, 3);
  assert.equal(summary.contiguous, false);
  assert.match(summary.words, /Episodes 1, 2, 4/);
  assert.match(summary.words, /nothing was renumbered/);
  const clean = seriesSummary([{ id: 'a', episode_no: 1 }, { id: 'b', episode_no: 2 }], 'serial');
  assert.equal(clean.contiguous, true);
  assert.equal(clean.words, '2 episodes.');
});

test('the words the card and the page count in', () => {
  assert.equal(episodeWords(3), 'Episode 3');
  assert.equal(episodeWords(null), 'An episode');
  assert.equal(episodeCountWords(1), '1 episode');
  assert.equal(episodeCountWords(12), '12 episodes');
  assert.equal(clockWords(245), '4:05');
  assert.equal(clockWords(3725), '1:02:05');
  assert.equal(clockWords(0), '0:00');
});

// ---------------------------------------------------------------------------
// Where a person starts, what comes next, and what a position is worth
// ---------------------------------------------------------------------------

test('continue where you left off — and never with the episode they just finished', () => {
  const episodes = [
    { id: 'a', title: 'One', episode_no: 1, runtime_sec: 600 },
    { id: 'b', title: 'Two', episode_no: 2, runtime_sec: 600 },
    { id: 'c', title: 'Three', episode_no: 3, runtime_sec: 600 },
  ];
  // No rows at all: the head of the list, and the reason says so.
  assert.deepEqual(landingEpisode({ episodes, mode: 'serial' }), { episode: episodes[0], why: 'head' });
  assert.deepEqual(landingEpisode({ episodes, mode: 'collection' }), { episode: episodes[2], why: 'head' });
  // One unfinished position: that is the episode, whatever the mode's list order is.
  const inTheMiddle = {
    b: { position_sec: 120, updated_at: '2026-09-25T09:00:00Z' },
  };
  assert.deepEqual(landingEpisode({ episodes, positions: inTheMiddle, mode: 'serial' }).episode.id, 'b');
  // The most RECENT unfinished one wins — a person who opened two episodes wants the
  // one they were in last, not the one they opened first.
  const both = {
    a: { position_sec: 100, updated_at: '2026-09-25T08:00:00Z' },
    c: { position_sec: 30, updated_at: '2026-09-25T10:00:00Z' },
  };
  assert.equal(landingEpisode({ episodes, positions: both, mode: 'serial' }).episode.id, 'c');
  // Finished does not count. 595 of 600 is the credits, and this is the one place the
  // rule is visible to a person: they get the head of the list, not what they finished.
  const finished = { c: { position_sec: 595, updated_at: '2026-09-25T10:00:00Z' } };
  assert.equal(landingEpisode({ episodes, positions: finished, mode: 'serial' }).why, 'head');
  // A file nobody reported a length for cannot be finished — otherwise a person who
  // watched ten seconds of it would silently lose it.
  assert.equal(isFinished(999, null), false);
  assert.equal(isFinished(595, 600), true);
  assert.equal(isFinished(570, 600), true, 'thirty seconds of credits is the grace');
  assert.equal(isFinished(569, 600), false);
  // And the grace never eats more than a tenth of a SHORT file: a twenty-second clip
  // is finished at eighteen, not at ten, because ten seconds is half of somebody's work.
  assert.equal(isFinished(18, 20), true);
  assert.equal(isFinished(17, 20), false);
  assert.equal(isFinished(90, 100), true);
  assert.equal(isFinished(60, 100), false);
  assert.equal(finishedGrace(600), 30);
  assert.equal(finishedGrace(20), 2);
  assert.equal(landingEpisode({ episodes: [] }), null);
});

test('a next episode exists only where the store said the order matters', () => {
  const episodes = [
    { id: 'a', episode_no: 1 }, { id: 'b', episode_no: 2 }, { id: 'c', episode_no: 4 },
  ];
  assert.equal(nextEpisode({ episodes, currentId: 'a', mode: 'serial' }).id, 'b');
  assert.equal(nextEpisode({ episodes, currentId: 'b', mode: 'serial' }).id, 'c', 'a gap is still the next one');
  assert.equal(nextEpisode({ episodes, currentId: 'c', mode: 'serial' }), null, 'the last episode has none');
  assert.equal(nextEpisode({ episodes, currentId: 'nobody', mode: 'serial' }), null);
  // The collection answer is the mode's whole meaning: any order is fine, so there is
  // no next, and the control is not rendered on the page.
  for (const currentId of ['a', 'b', 'c']) {
    assert.equal(nextEpisode({ episodes, currentId, mode: 'collection' }), null);
  }
  assert.equal(previousEpisode({ episodes, currentId: 'c', mode: 'serial' }).id, 'b');
  assert.equal(previousEpisode({ episodes, currentId: 'a', mode: 'serial' }), null);
  // The strip runs in the LIST's order whichever way the list runs: in a collection
  // (newest first) the one after episode 4 is episode 2.
  assert.equal(previousEpisode({ episodes, currentId: 'b', mode: 'collection' }).id, 'c');
  assert.equal(previousEpisode({ episodes, currentId: 'c', mode: 'collection' }), null);
});

test('a position is a convenience: it resumes, it never counts, and it never claims a finish', () => {
  assert.equal(resumeFrom(0, 600), null, 'the first seconds are where everybody starts');
  assert.equal(resumeFrom(RESUME_MIN_SECONDS - 1, 600), null);
  assert.equal(resumeFrom(RESUME_MIN_SECONDS), RESUME_MIN_SECONDS);
  assert.equal(resumeFrom(300, 600), 300);
  assert.equal(resumeFrom(595, 600), null, 'a finished episode starts over rather than resuming into the credits');
  assert.equal(resumeFrom(300, null), 300, 'a file with no reported length still resumes');
  assert.equal(resumeSentence(300), 'Resumed at 5:00.');
  assert.equal(resumeSentence(2), null);
  assert.ok(FINISHED_TAIL_SECONDS >= 15 && FINISHED_TAIL_SECONDS <= 60, 'the tail is a credits-length grace');
});

// ---------------------------------------------------------------------------
// The schema, the store, and the promise about the position
// ---------------------------------------------------------------------------

test('the schema keeps a number with a series, one number per series, and a bounded position', async () => {
  const { rows } = await query(
    `select conname from pg_constraint
      where conrelid = 'assets'::regclass and conname in ('assets_episode_needs_series')`,
  );
  assert.equal(rows.length, 1, 'a number with no series is a number about nothing');
  const idx = await query(
    `select indexdef from pg_indexes where indexname in ('uq_series_episode_no', 'idx_assets_series')`,
  );
  assert.equal(idx.rows.length, 2);
  assert.match(idx.rows.find((r) => r.indexdef.includes('uq_series_episode_no')).indexdef, /UNIQUE/);
  const wp = await query(
    `select column_name from information_schema.columns
      where table_name = 'watch_progress' order by column_name`,
  );
  // Four columns and no more: a position, a time, and the pair it belongs to. There is
  // no column for a count, a view, an earning or a store.
  assert.deepEqual(wp.rows.map((r) => r.column_name), ['asset_id', 'position_sec', 'updated_at', 'user_id']);
});

test('a position cannot be moved by a client into the ledger, because no accounting path reads it', () => {
  // The promise §15.2 makes, checked where it actually lives: in the SQL. Every
  // earnings/attention/ledger query is in store.js, and none of them may name this
  // table — a credited view comes from the network's signed postback and nothing else.
  const src = readFileSync(new URL('../src/store.js', import.meta.url), 'utf8');
  const lines = src.split('\n');
  const readers = lines
    .map((line, i) => ({ line, i }))
    .filter(({ line }) => /watch_progress/.test(line))
    .map(({ line, i }) => ({ line: line.trim(), i }));
  assert.ok(readers.length >= 4, 'the position table is read somewhere');
  for (const { line, i } of readers) {
    const window = lines.slice(Math.max(0, i - 6), i + 2).join('\n');
    assert.ok(!/earnings|attention|ad_view_events|ad_position_daily|claim/i.test(window),
      `an accounting query reads watch_progress near line ${i + 1}: ${line}`);
  }
  // And the seller's own surfaces are not handed it: no seller method returns it.
  assert.ok(!/watchProgress\(.*channelId/.test(src), 'a store-scoped position reader appeared');
});

test('the store writes and reads a position, and the same one twice writes nothing', async () => {
  const { viewer, channel, series } = await fixture();
  const episode = await addEpisode({ channel, series, title: 'One', no: 1, seconds: 600 });
  assert.equal(await store.watchProgress(viewer.id, episode.id), null);
  const first = await store.saveWatchProgress({ userId: viewer.id, assetId: episode.id, seconds: 120 });
  assert.equal(Number(first.position_sec), 120);
  const at = new Date(first.updated_at).getTime();
  await new Promise((r) => setTimeout(r, 10));
  // The same position again: no row change, so the timestamp does not move. "When did
  // they last watch" and "when did a request arrive" are different questions.
  assert.equal(await store.saveWatchProgress({ userId: viewer.id, assetId: episode.id, seconds: 120 }), null);
  const still = await store.watchProgress(viewer.id, episode.id);
  assert.equal(new Date(still.updated_at).getTime(), at);
  // A moved position does write.
  assert.ok(await store.saveWatchProgress({ userId: viewer.id, assetId: episode.id, seconds: 240 }));
  // Nonsense is refused rather than stored: a negative position is not a place.
  assert.equal(await store.saveWatchProgress({ userId: viewer.id, assetId: episode.id, seconds: -5 }), null);
  assert.equal(await store.saveWatchProgress({ userId: null, assetId: episode.id, seconds: 10 }), null);
  // The batch read the series page uses, keyed by asset id.
  const map = await store.watchProgressFor(viewer.id, [episode.id]);
  assert.equal(Number(map[episode.id].position_sec), 240);
  assert.deepEqual(await store.watchProgressFor(viewer.id, []), {});
  assert.deepEqual(await store.watchProgressFor(null, [episode.id]), {});
});

test('a series groups the store’s own files, and its order is the store’s', async () => {
  const { channel, series } = await fixture({ mode: 'serial' });
  const one = await addEpisode({ channel, series, title: 'One', no: 1 });
  const two = await addEpisode({ channel, series, title: 'Two', no: 2 });
  const three = await addEpisode({ channel, series, title: 'Three', no: 4 });

  const episodes = await store.episodesOf(series.id);
  assert.deepEqual(episodes.map((e) => Number(e.episode_no)), [1, 2, 4]);
  // The shape survives the round trip: an episode is still a `watch` file, decided by
  // the same classifier everything else uses.
  const files = await store.filesOf(three.id);
  assert.equal(assetShape(files, { url: three.external_url }), 'watch');

  // The number is the store's: renumbering writes the number they asked for, and the
  // unique index — not a route — is what refuses a collision.
  await store.setEpisodeNo({ assetId: three.id, episodeNo: 5 });
  assert.equal(Number((await store.assetById(three.id)).episode_no), 5);
  await assert.rejects(
    () => store.setEpisodeNo({ assetId: three.id, episodeNo: 2 }),
    (err) => err.code === '23505',
    'two episodes at one number must be impossible in the database',
  );
  await store.setEpisodeNo({ assetId: three.id, episodeNo: 4 });

  // Taking a file out clears BOTH columns — the check pair means a half removal is not
  // a state this code can reach.
  await store.setEpisode({ assetId: two.id, seriesId: null, episodeNo: null });
  const left = await store.assetById(two.id);
  assert.equal(left.series_id, null);
  assert.equal(left.episode_no, null);
  const after = await store.episodesOf(series.id);
  assert.deepEqual(after.map((e) => Number(e.episode_no)), [1, 4]);

  // The storefront's own query: which series each card belongs to, in one round trip.
  const rows = await store.seriesForAssets([one.id, two.id, three.id]);
  assert.equal(rows.length, 2, 'the file that left the series is not in the answer');
  assert.deepEqual(rows.map((r) => Number(r.episode_no)).sort(), [1, 4]);

  // The series leaves; its episodes stay as ordinary files. Nothing is deleted.
  await store.deleteSeries(series.id);
  assert.equal((await store.seriesById(series.id)), null);
  assert.ok(await store.assetById(one.id), 'an episode is a file and a file is not deleted by a grouping');
});

test('a series belongs to one store, and its slug is unique inside that store', async () => {
  const a = await fixture();
  const b = await fixture();
  const taken = (await store.seriesOf(a.channel.id)).map((s) => s.slug);
  assert.deepEqual(taken, ['nights'], 'the fixture store has exactly the one series');
  // The title decides the address; nothing is taken from the title except its shape.
  const first = seriesSlug('Kathmandu Nights', taken);
  assert.equal(first, 'kathmandu-nights', 'a free address is the title, made addressable');
  const second = await store.createSeries({ channelId: a.channel.id, slug: first, title: 'Kathmandu Nights' });
  assert.equal(second.channel_id, a.channel.id);
  // A second with the same name is the one that gets a counter.
  assert.equal(seriesSlug('Kathmandu Nights', [...taken, first]), 'kathmandu-nights-2');
  assert.equal(seriesSlug('Kathmandu Nights!', [...taken, first, 'kathmandu-nights-2']), 'kathmandu-nights-3');
  // Scoped lookups: the same address in another store is a different series, or none.
  assert.equal((await store.seriesBySlug(a.channel.id, first))?.id, second.id);
  assert.equal(await store.seriesBySlug(b.channel.id, first), null);
  assert.equal(await store.seriesById(second.id, b.channel.id), null, 'a channel-scoped read cannot cross stores');
  assert.equal((await store.seriesOf(a.channel.id)).length, 2);
  // Two series in one store may not share an address — the database says so.
  await assert.rejects(
    () => store.createSeries({ channelId: a.channel.id, slug: first, title: 'Same address' }),
    (err) => err.code === '23505',
  );
  // The same address in ANOTHER store is fine: slugs are per store, not global.
  assert.ok(await store.createSeries({ channelId: b.channel.id, slug: first, title: 'Kathmandu Nights' }));
  // Renaming a series does not move it. The address was shared as a link, and a link
  // must not break because a title changed — the reader's bookmark keeps working.
  const renamed = await store.updateSeries({ seriesId: second.id, title: 'Kathmandu Nights Too' });
  assert.equal(renamed.slug, first);
  assert.equal(renamed.title, 'Kathmandu Nights Too');
});

test('a hand-made POST cannot do what the panel refuses', async () => {
  // The panel lists only what may join, so the interesting attack is the POST that names
  // something the panel would never offer. The route's answer is one function — and this
  // test proves both halves of that: the inputs it hands the function, and what the
  // function does with a file the poster chose.
  const src = readFileSync(new URL('../server.js', import.meta.url), 'utf8');
  const at = src.indexOf("APP.post('/dashboard/:slug/series/:seriesId/episode'");
  assert.ok(at > 0, 'the add-episode route is gone');
  const route = src.slice(at, src.indexOf('APP.post(', at + 10));
  // The file is read back through the store by the id the body carried; the series is
  // looked up SCOPED to the owner's channel; the shape comes from the store's classifier.
  assert.match(route, /store\.assetById\(req\.body\?\.assetId\)/);
  assert.match(route, /store\.seriesById\(req\.params\.seriesId, channel\.id\)/);
  assert.match(route, /shape: asset \? await store\.shapeOf\(asset\) : null/);
  assert.match(route, /channelId: channel\.id/);
  // Nothing posted is believed about ownership: no `req.body.channelId`, no posted shape.
  assert.ok(!/req\.body\??\.(channelId|shape|owner)/.test(route), 'a posted field reached the decision');

  const { channel, series } = await fixture({ mode: 'serial' });
  const one = await addEpisode({ channel, series, title: 'One', no: 1 });

  // (1) A download. A real row, with a real ZIP file, classified by the one classifier.
  const zip = await store.createAsset({
    channelId: channel.id, title: 'An archive', slug: `sr-zip-${Date.now()}`, unlockMode: 'open',
  });
  await store.addFile({
    assetId: zip.id, storageKey: `test/${zip.id}/kit.zip`, filename: 'kit.zip',
    mimeType: 'application/zip', sizeBytes: 2048, checksum: 'b'.repeat(64),
  });
  const zipRow = await store.assetById(zip.id);
  const zipShape = await store.shapeOf(zipRow);
  assert.equal(zipShape, 'download', 'the fixture is not a download any more');
  assert.equal(
    seriesRefusalCode({ asset: zipRow, shape: zipShape, channelId: channel.id, series, episodes: [one], episodeNo: 2 }),
    'shape',
  );

  // (2) Somebody else's file, posted at a series the poster does own.
  const other = await fixture();
  const stranger = await addEpisode({ channel: other.channel, series: other.series, title: 'Theirs', no: 1 });
  const foreign = await store.assetById(stranger.id);
  assert.equal(
    seriesRefusalCode({
      asset: foreign, shape: await store.shapeOf(foreign), channelId: channel.id, series, episodes: [one], episodeNo: 2,
    }),
    'not-yours',
    'a file from another store was allowed into this one',
  );
  // …and the mirror image: the store's own file, posted at another store's series.
  assert.equal(
    seriesRefusalCode({
      asset: one, shape: 'watch', channelId: other.channel.id, series, episodes: [one], episodeNo: 2,
    }),
    'store',
  );

  // (3) A number that is already taken.
  assert.equal(
    seriesRefusalCode({ asset: zipRow, shape: 'watch', channelId: channel.id, series, episodes: [one], episodeNo: 1 }),
    'taken',
  );

  // (4) A file of the store's own that is already an episode of ANOTHER of its series:
  // moving one is a decision, not a side effect of adding it somewhere else. Same store,
  // same owner, and still refused — which is the point of the check being about the file
  // rather than about who is asking.
  const sibling = await store.createSeries({ channelId: channel.id, slug: 'days', title: 'Days' });
  assert.equal(
    seriesRefusalCode({
      asset: one, shape: 'watch', channelId: channel.id, series: sibling, episodes: [], episodeNo: 1,
    }),
    'elsewhere',
    'a file already in a series was quietly moved into another one',
  );
  // …and the file it is already an episode of is the one case that is NOT a refusal.
  assert.equal(
    seriesRefusalCode({
      asset: one, shape: 'watch', channelId: channel.id, series, episodes: [one], episodeNo: null,
    }),
    null,
    'an episode cannot be re-numbered inside its own series',
  );

  // Every code the route can receive has a flash message, and they are not all one word:
  // a refusal that lands on the wrong sentence is a lie about why the store was refused.
  const codes = src.slice(src.indexOf('const SERIES_ERROR_CODES'), src.indexOf('const seriesError'));
  for (const code of ['missing', 'no-series', 'store', 'not-yours', 'shape', 'elsewhere', 'number', 'taken', 'full']) {
    assert.ok(codes.includes(`${code}:`) || codes.includes(`'${code}':`), `${code} has no flash code`);
  }
  assert.match(codes, /shape: 'series-shape'/);

  // The wrong shape never reaches the store: the route returns before the write.
  const decided = route.indexOf('seriesRefusalCode(');
  assert.ok(decided > 0 && route.indexOf('store.setEpisode(') > decided, 'the write happens before the refusal');

  // Taking a file OUT asks the same question about the row it is about to write: a file
  // the store does not own is not theirs to remove from anything either.
  const removeAt = src.indexOf("APP.post('/dashboard/:slug/series/:seriesId/episode/remove'");
  const remove = src.slice(removeAt, src.indexOf('APP.post(', removeAt + 10));
  assert.match(remove, /String\(asset\.channel_id\) !== String\(channel\.id\)/);
});

test('the mode is a closed vocabulary in the database, not only in the module', async () => {
  const { channel } = await fixture();
  await assert.rejects(
    () => store.createSeries({ channelId: channel.id, slug: 'bad-mode', title: 'x', mode: 'seasons' }),
    (err) => err.code === '23514',
  );
  const { series } = await fixture();
  const changed = await store.updateSeries({ seriesId: series.id, title: 'Renamed', blurb: 'A blurb', mode: 'collection' });
  assert.equal(changed.mode, 'collection');
  assert.equal(changed.title, 'Renamed');
  assert.equal(changed.blurb, 'A blurb');
});
