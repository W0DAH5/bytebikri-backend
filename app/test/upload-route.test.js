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

/*
 * ── AND IN PRODUCTION THE DISK IS NOT AN ANSWER AT ALL ───────────────────────────────────────────
 *
 * The three tests above describe a laptop: a host took the file or it stayed here, and either way the
 * person has a file that works. A deployment cannot do that, because "here" is a container whose
 * filesystem the next deploy replaces — the upload succeeds, the page opens, and the bytes are gone
 * by morning with nobody having been told. So the same branch REFUSES instead.
 *
 * The assertions are deliberately about what did NOT happen: not the code the error carries, but the
 * absence of the file. A test that only checked `ENOSTORAGE` would pass on a version that threw it
 * after writing.
 */
test('in production a file no host will take is refused, and nothing is written', async () => {
  await withEnv({
    NODE_ENV: 'production',
    IMAGE_DRIVER: 'telegraph',   // configured, but this photo is over its cap
    FILE_DRIVER: null,
    VIDEO_DRIVER: null,
    MEDIA_FALLBACK: null,
  }, async () => {
    const before = await fs.readdir(path.join(UPLOADS, 'private')).catch(() => []);
    const file = { filename: 'six-megabyte-photo.png', mimeType: 'image/png' };

    const lines = await warnings(async () => {
      await assert.rejects(
        () => storage.put(bytesOf(6), file.filename, { namespace: 'private', mimeType: file.mimeType }),
        (err) => {
          assert.equal(err.code, 'ENOSTORAGE', 'the refusal has to be a code a route can branch on');
          assert.match(err.message, /nothing could store this file/);
          assert.match(err.reasons || '', /telegraph/, 'the error carries which host was asked');
          assert.match(err.reasons || '', /5 MB/, "and the host's own ceiling, so the fix is obvious");
          return true;
        },
      );
    });

    const after = await fs.readdir(path.join(UPLOADS, 'private')).catch(() => []);
    assert.deepEqual(after, before, 'the refusal must not leave a byte on our own disk');
    const line = lines.find((l) => l.includes('REFUSED'));
    assert.ok(line, `the operator gets nothing to grep for: ${JSON.stringify(lines)}`);
    assert.match(line, /production stores nothing/);
  });
});

/*
 * `kyc` is the ONE namespace outside the rule, and this pins it — the copy of an identity document is
 * local BY PROMISE, so it must still be written on a production box with nothing configured. Covers
 * USED to be the second exemption and are not any more: the operator decided a banner is a seller's
 * file too, so `public` is refused like everything else (the routing half of that decision is
 * asserted below).
 */
test('an identity document is still kept when production refuses everything else', async () => {
  await withEnv({ NODE_ENV: 'production', IMAGE_DRIVER: null, FILE_DRIVER: null, VIDEO_DRIVER: null, MEDIA_FALLBACK: null },
    async () => {
      const key = await storage.put(bytesOf(0.2), 'document.jpg', { namespace: 'kyc', mimeType: 'image/png' });
      assert.match(key, /^kyc\//, 'a held document stays on this disk by design, in production too');
      await fs.rm(path.join(UPLOADS, key));

      // And the same bytes under a cover's namespace, with nothing configured to take them, are
      // refused — the decision that covers leave, and that the refusal is total.
      await assert.rejects(
        () => storage.put(bytesOf(0.2), 'banner.png', { namespace: 'public', mimeType: 'image/png' }),
        (err) => {
          assert.equal(err.code, 'ENOSTORAGE');
          assert.match(err.message, /nothing could store this file/);
          return true;
        },
      );
    });
});

/*
 * And the other half: with an image host configured, a cover LEAVES. This is what the operator asked
 * for ("all in media storages and stuffs i provided already"), and it is asserted at the routing
 * seam rather than by reading the page, because the page shows a url whichever host holds the bytes.
 */
test('a cover routes to the image host when one is chosen, and an identity document never does', async () => {
  await withEnv({
    IMAGE_DRIVER: 'telegraph', FILE_DRIVER: null, VIDEO_DRIVER: null, MEDIA_FALLBACK: null,
    NODE_ENV: 'development',
  }, async () => {
    const cover = { mimeType: 'image/png', filename: 'banner.png', size: 200_000 };
    assert.equal(storage.routesToHost({ namespace: 'public', ...cover }), true,
      'a cover must go to the chosen image host');
    assert.equal(storage.routesToHost({ namespace: 'kyc', ...cover }), false,
      'a citizenship document must never leave this disk, whatever host is configured');
    // A `public` key that is not an image is not a cover, and this namespace does not own it.
    assert.equal(storage.routesToHost({ namespace: 'public', mimeType: 'application/zip', filename: 'pack.zip', size: 10 }),
      false, 'only images are covers');
  });
});
