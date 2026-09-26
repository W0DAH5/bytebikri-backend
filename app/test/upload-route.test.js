/**
 * Where an upload ends up, and the one line that explains it.  npm test
 *
 * `ci/eyes/upload-cap-walk.mjs` drives this through a real form, which is the only way to prove the
 * seller's page and the browser agree with the server. This file holds the part that has to stay
 * true without a browser: the branch of `storage.put` that keeps a file on our own disk, and the
 * sentence it prints for the operator when the file never reached a host at all.
 *
 * The bug this was written for is worth stating, because it is the kind that comes back: `whyLocal`
 * used to be called only INSIDE the routed branch, so the explanation was unreachable for exactly
 * the case its own comment described — a file whose size means `routesToHost` answers "no" before
 * any bytes move. The file landed on our disk, worked, and nothing anywhere said why. A test that
 * only checks the key shape would have passed on the broken version, so this one captures the
 * warning text.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:55432/bytebikri_test';

const { close } = await import('../src/db.js');
const { storage } = await import('../src/store.js');
const { driverForKind } = await import('../src/video.js');
after(async () => { await close(); });

const here = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS = path.resolve(here, '../.data/uploads');

/** Bytes that are big enough to matter and cheap to make: the size is the whole point. */
const bytesOf = (mb) => Buffer.alloc(Math.round(mb * 1024 * 1024), 7);

/** Run `fn` with an environment, and put it back however `fn` ends. */
async function withEnv(env, fn) {
  const saved = { ...process.env };
  Object.assign(process.env, env);
  for (const [k, v] of Object.entries(env)) if (v === null) delete process.env[k];
  try { return await fn(); } finally {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  }
}

/** Capture what the process writes to `console.warn` while `fn` runs. */
async function warnings(fn) {
  const lines = [];
  const real = console.warn;
  console.warn = (...args) => { lines.push(args.join(' ')); };
  try { await fn(); } finally { console.warn = real; }
  return lines;
}

/*
 * The image host refuses by size, and nothing else is configured to take the file — so the routing
 * pre-check sends it to the disk and the local branch has to explain itself. Telegra.ph declares
 * 5 MB; the file is 6 MB, which is inside the PRODUCT's 25 MB cap, so this is the case the whole
 * two-ceiling design exists for.
 */
test('a file too big for its host is kept, and the log names the host\'s own cap', async () => {
  const file = { mimeType: 'image/png', filename: 'six-megabyte-photo.png', size: bytesOf(6).length };
  await withEnv({
    IMAGE_DRIVER: 'telegraph',
    FILE_DRIVER: null,          // nothing general to fall back to: the disk is the only answer left
    VIDEO_DRIVER: null,
    MEDIA_FALLBACK: null,
  }, async () => {
    assert.equal(driverForKind('image', process.env, file), 'local',
      'a 6 MB image with only a 5 MB image host configured must route to the disk');

    const lines = await warnings(() => withEnv({}, async () => {
      const key = await storage.put(bytesOf(6), file.filename, { namespace: 'private', mimeType: file.mimeType });
      assert.match(key, /^private\//, 'the key must be a local one, not a provider id');
      const written = await fs.readFile(path.join(UPLOADS, key));
      assert.equal(written.length, file.size, 'the bytes on the disk are the bytes that were sent');
      await fs.rm(path.join(UPLOADS, key));            // nothing this test wrote is left behind
    }));

    const line = lines.find((l) => l.includes('own disk'));
    assert.ok(line, `the local branch said nothing about why the file is here: ${JSON.stringify(lines)}`);
    assert.match(line, /telegraph/, 'the line must name the host that refused it');
    assert.match(line, /5 MB/, "the line must carry the host's own ceiling, not ours");
  });
});

/*
 * The negative half, and it is the reason the local branch logs only when `refusals` is empty: a
 * deployment that configured NOTHING has nothing to explain, and a warning there would train every
 * operator to ignore the line. `whyLocal` answers null for it; this pins that the disk path is
 * silent in that case.
 */
test('with no host configured at all there is nothing to explain, so nothing is said', async () => {
  await withEnv({
    IMAGE_DRIVER: null, FILE_DRIVER: null, VIDEO_DRIVER: null, MEDIA_FALLBACK: null,
  }, async () => {
    const lines = await warnings(async () => {
      const key = await storage.put(bytesOf(1), 'plain.png', { namespace: 'private', mimeType: 'image/png' });
      await fs.rm(path.join(UPLOADS, key));
    });
    assert.deepEqual(lines.filter((l) => l.includes('own disk')), [],
      'a deployment with no hosts must not print a storage reason for every upload');
  });
});
