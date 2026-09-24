/**
 * Media: what a file is, how it is marked, and how bytes are ranged.
 *
 * The parts worth testing here are the parts where being wrong is quiet.
 *
 *   - A Range answer that is off by one does not throw; the browser seeks to the
 *     wrong place, or plays ten seconds short, and nobody can tell whether that
 *     is the file or us.
 *   - A watermark that draws nothing still returns a valid JPEG. It would ship.
 *   - A label that contains a name, or an email address, or a quote that breaks
 *     the ImageMagick argument, is a privacy problem or a 500 — and both would
 *     survive a page render that looks fine.
 *
 * These are unit tests over the module. `watermarkImage` is exercised for real
 * where ImageMagick exists, and skipped with a reason where it does not — a test
 * that silently passes because the tool is absent is worse than no test.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const media = await import('../src/media.js');

// ---------------------------------------------------------------------------
// What kind of file is it
// ---------------------------------------------------------------------------

test('media kind comes from the MIME type, and falls back to the extension', () => {
  assert.equal(media.mediaKind('video/mp4', 'clip.mp4'), 'video');
  assert.equal(media.mediaKind('audio/mpeg', 'track.mp3'), 'audio');
  assert.equal(media.mediaKind('image/jpeg', 'poster.jpg'), 'image');
  assert.equal(media.mediaKind('application/pdf', 'guide.pdf'), 'file');

  // The case that actually happens: an upload the browser could not type. A
  // player that trusts the MIME type alone shows a download link for a video.
  assert.equal(media.mediaKind('application/octet-stream', 'clip.mp4'), 'video');
  assert.equal(media.mediaKind('', 'walkthrough.mov'), 'video');
  assert.equal(media.mediaKind(null, 'TRACK.MP3'), 'audio');
  assert.equal(media.mediaKind(undefined, 'archive.zip'), 'file');

  // A file that has no extension and no useful type is not guessed at.
  assert.equal(media.mediaKind('application/octet-stream', 'mystery'), 'file');
  // Parameters are stripped rather than compared.
  assert.equal(media.mediaKind('video/mp4; codecs="avc1.42E01E"', 'clip.mp4'), 'video');
});

test('only playable kinds get a player, only images get a burned-in mark', () => {
  assert.equal(media.isPlayable('video/mp4', 'a.mp4'), true);
  assert.equal(media.isPlayable('audio/wav', 'a.wav'), true);
  assert.equal(media.isPlayable('image/png', 'a.png'), false);
  assert.equal(media.isPlayable('application/zip', 'a.zip'), false);

  assert.equal(media.isWatermarkable('image/jpeg', 'a.jpg'), true);
  assert.equal(media.isWatermarkable('image/png', 'a.png'), true);
  // Video and audio cannot be marked without re-encoding the file, so the module
  // must not claim it can — the page renders a DOM overlay instead and says so.
  assert.equal(media.isWatermarkable('video/mp4', 'a.mp4'), false);
  assert.equal(media.isWatermarkable('audio/mpeg', 'a.mp3'), false);
});

// ---------------------------------------------------------------------------
// The label
// ---------------------------------------------------------------------------

test('the watermark label identifies an account without being an identity', () => {
  const ref = 'e51b3efa-ac79-48e3-96af-bd767fe1d082';
  const label = media.watermarkLabel({ ref, assetId: '0bf4d56a-3b3d-4adf-9642-42f1c51ce165' });

  assert.match(label, /^BYTEBIKRI [a-z0-9]{10}-[a-z0-9]{4} \d{4}-\d{2}-\d{2}$/, label);
  assert.ok(label.includes('e51b3efaac'), 'label carries the account reference');
  assert.ok(label.includes('0bf4'), 'label carries which asset leaked');

  // The whole point: the pixels leave our control, so nothing in them may be a
  // name, an email address or a session token.
  assert.ok(!label.includes('@'));
  assert.equal(media.watermarkLabel({ ref, assetId: 'x' }), media.watermarkLabel({ ref, assetId: 'x' }),
    'the same inputs give the same label');

  // Missing pieces degrade to a mark that still works, rather than `undefined`.
  assert.match(media.watermarkLabel({}), /^BYTEBIKRI unknown-0000 \d{4}-\d{2}-\d{2}$/);
  assert.match(media.watermarkLabel({ ref: '!!!!', assetId: '????' }), /unknown-0000/);
});

test('the label grows arithmetically rather than being escaped later', () => {
  // An ImageMagick draw string is built by concatenation, so a quote in a value
  // must not be able to close it and inject arguments.
  const label = media.watermarkLabel({ ref: "a'b\"c;rm -rf /", assetId: 'x' });
  assert.ok(!label.includes("'"), label);
  assert.ok(!label.includes('"'), label);
  assert.ok(!label.includes(';'), label);
});

test('the derivative key is stable per viewer, per file, per day', () => {
  const at = new Date('2026-09-21T10:00:00Z');
  const later = new Date('2026-09-21T23:59:00Z');
  const tomorrow = new Date('2026-09-22T00:01:00Z');
  const base = { fileId: '0946d4a5-0000-4000-8000-000000000000', ref: 'e51b3efa-ac79-48e3-96af-bd767fe1d082', at };

  assert.equal(media.derivativeKey(base), media.derivativeKey({ ...base, at: later }),
    'same day → one derivative, so a refresh does not re-render');
  assert.notEqual(media.derivativeKey(base), media.derivativeKey({ ...base, at: tomorrow }),
    'next day → a new derivative, so a leak is dateable');
  assert.notEqual(media.derivativeKey(base), media.derivativeKey({ ...base, ref: 'someone-else' }),
    'two viewers never share a derivative');

  // The key is written into a path on disk, so it must not contain a home
  // directory, a slash from a value, or anything else that could escape.
  for (const ref of ['../../etc/passwd', 'a/b', '..', '', null, undefined]) {
    const key = media.derivativeKey({ ...base, ref });
    // Exactly one slash, no traversal, no separator smuggled in from a value.
    assert.match(key, /^derived\/[A-Za-z0-9-]+\.jpg$/, key);
    assert.ok(!key.includes('..'), key);
    assert.equal(key.split('/').length, 2, key);
  }
  assert.equal(media.derivativeKey({ fileId: null, ref: 'x', at }), media.derivativeKey({ fileId: null, ref: 'x', at }));
});

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

test('the draw arguments tile the image and stay inside it', () => {
  const label = 'BYTEBIKRI e51b3efaac-0bf4 2026-09-21';
  const args = media.watermarkDrawArgs({ width: 1200, height: 800, label });

  // Colour is preserved: a mark with no stroke disappears on a white wall, and
  // a mark with no fill disappears on a dark one.
  assert.ok(args.includes('-fill'));
  assert.ok(args.includes('-stroke'));
  assert.equal(args.at(-2), '-stroke', 'the stroke is switched off before output');

  const draws = args.filter((a) => String(a).startsWith('text '));
  assert.equal(draws.length, 9, 'three columns by three rows');

  // Every mark has to land on the canvas. A negative or out-of-range coordinate
  // is silently dropped by ImageMagick, which looks exactly like "no watermark".
  const pointsize = Number(args[args.indexOf('-pointsize') + 1]);
  assert.ok(pointsize >= 12 && pointsize <= 22, `pointsize ${pointsize}`);
  for (const d of draws) {
    const [, x, y] = /^text (\d+),(\d+) /.exec(d).map(Number);
    assert.ok(x >= 0 && x < 1200, `x ${x} outside the image`);
    assert.ok(y > 0 && y <= 800, `y ${y} outside the image`);
    assert.ok(y + pointsize <= 800 + pointsize, 'the mark is not pushed off the bottom');
    assert.ok(d.includes(label), 'the label is in every mark');
  }

  // A small image must not get a mark bigger than itself.
  const small = media.watermarkDrawArgs({ width: 200, height: 120, label });
  assert.equal(Number(small[small.indexOf('-pointsize') + 1]), 12, 'pointsize floors at 12');
  const big = media.watermarkDrawArgs({ width: 4000, height: 3000, label });
  assert.equal(Number(big[big.indexOf('-pointsize') + 1]), 22, 'pointsize caps at 22');

  // Explicit columns/rows are honoured, because a tall thin image needs a
  // different grid from a wide one.
  const tall = media.watermarkDrawArgs({ width: 600, height: 2000, label, columns: 1, rows: 5 });
  assert.equal(tall.filter((a) => String(a).startsWith('text ')).length, 5);
});

test('the overlay mark is a decodable SVG with the label in it and no markup escape', () => {
  const uri = media.watermarkSvgDataUri('BYTEBIKRI e51b3efaac-0bf4 2026-09-21');
  assert.ok(uri.startsWith('data:image/svg+xml;base64,'), uri.slice(0, 40));

  const svg = Buffer.from(uri.split(',')[1], 'base64').toString();
  assert.match(svg, /<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.ok(svg.includes('BYTEBIKRI e51b3efaac-0bf4 2026-09-21'));

  // The label is interpolated into markup, so a value that contains markup must
  // not be able to add a tag. Comparing tag counts against a clean label is
  // stronger than grepping for `<script`: it catches any element, not the one
  // payload somebody thought of.
  const tagsIn = (str) => str.match(/<\/?[a-z][^>]*>/gi) || [];
  const clean = Buffer.from(media.watermarkSvgDataUri('BYTEBIKRI aaaa-bbbb 2026-09-21').split(',')[1], 'base64').toString();
  const nasty = Buffer.from(media.watermarkSvgDataUri("</text><script>alert(1)</script><img src=x onerror=alert(2)>").split(',')[1], 'base64').toString();

  assert.deepEqual(tagsIn(nasty), tagsIn(clean), 'an injected label must not add markup');
  // Everything between the opening tag and `</text>` is inert text: no `<` can
  // survive the strip, so nothing can ever be parsed as a tag there.
  const textTagEnd = nasty.indexOf('>', nasty.indexOf('<text')) + 1;
  const label = nasty.slice(textTagEnd, nasty.lastIndexOf('</text>'));
  assert.ok(!label.includes('<'), label);
});

// ---------------------------------------------------------------------------
// Range arithmetic — the quiet bug
// ---------------------------------------------------------------------------

test('a Range header is answered per the spec, and nonsense is ignored', () => {
  const total = 100;

  // No header, and anything we do not understand, is the whole file.
  for (const header of [undefined, null, '', 'bytes=abc', 'bytes=0-99,200-299', 'items=0-9']) {
    assert.deepEqual(media.rangeFor(header, total), { kind: 'full' }, `header ${header}`);
  }

  assert.deepEqual(media.rangeFor('bytes=0-', total), { kind: 'partial', start: 0, end: 99 });
  assert.deepEqual(media.rangeFor('bytes=0-99', total), { kind: 'partial', start: 0, end: 99 });
  assert.deepEqual(media.rangeFor('bytes=5-9', total), { kind: 'partial', start: 5, end: 9 });
  assert.deepEqual(media.rangeFor('bytes=99-', total), { kind: 'partial', start: 99, end: 99 });
  // A suffix range is the last N bytes, not from byte N.
  assert.deepEqual(media.rangeFor('bytes=-10', total), { kind: 'partial', start: 90, end: 99 });
  // A suffix larger than the file is the whole file, not an error.
  assert.deepEqual(media.rangeFor('bytes=-500', total), { kind: 'partial', start: 0, end: 99 });
  // An end past the end is clamped, which is what a player probing for headers does.
  assert.deepEqual(media.rangeFor('bytes=90-1000', total), { kind: 'partial', start: 90, end: 99 });
  // Whitespace around the value is tolerated.
  assert.deepEqual(media.rangeFor('  bytes=1-2  ', total), { kind: 'partial', start: 1, end: 2 });

  // Valid syntax, impossible region → 416, so the client stops asking.
  for (const header of ['bytes=100-', 'bytes=150-200', 'bytes=50-10', 'bytes=-0']) {
    assert.deepEqual(media.rangeFor(header, total), { kind: 'unsatisfiable' }, `header ${header}`);
  }

  // An empty file can satisfy nothing, and must not produce start > end.
  assert.deepEqual(media.rangeFor('bytes=0-', 0), { kind: 'unsatisfiable' });
  assert.deepEqual(media.rangeFor('bytes=0-', Number.NaN), { kind: 'unsatisfiable' });
});

test('every partial range is exactly the bytes it says it is', () => {
  const buf = Buffer.from('0123456789');
  for (const header of ['bytes=0-', 'bytes=3-6', 'bytes=-4', 'bytes=9-9', 'bytes=0-0']) {
    const r = media.rangeFor(header, buf.length);
    assert.equal(r.kind, 'partial');
    const slice = buf.subarray(r.start, r.end + 1);
    assert.equal(slice.length, r.end - r.start + 1, `length for ${header}`);
    assert.ok(r.end < buf.length, `end ${r.end} is inside the buffer for ${header}`);
    assert.ok(r.start >= 0, `start ${r.start} is not negative for ${header}`);
  }
  // Spot-check the actual bytes, since equal lengths are not equal contents.
  const mid = media.rangeFor('bytes=3-6', buf.length);
  assert.equal(buf.subarray(mid.start, mid.end + 1).toString(), '3456');
  const tail = media.rangeFor('bytes=-4', buf.length);
  assert.equal(buf.subarray(tail.start, tail.end + 1).toString(), '6789');
});

// ---------------------------------------------------------------------------
// The cache
// ---------------------------------------------------------------------------

test('the derivative cache is bounded, and evicts the least recently used', () => {
  media.__clearCache();
  media.__setCacheBudget(25);
  assert.deepEqual(media.__cacheStats(), { entries: 0, bytes: 0, budget: 25 });

  media.cacheDerivative('a', Buffer.alloc(10, 1));
  media.cacheDerivative('b', Buffer.alloc(10, 2));
  assert.equal(media.__cacheStats().bytes, 20);

  // A hit moves an entry to the most-recent end, so the untouched one goes first.
  assert.ok(media.cachedDerivative('a'));
  media.cacheDerivative('c', Buffer.alloc(10, 3));
  assert.equal(media.cachedDerivative('b'), null, 'b was the least recently used');
  assert.ok(media.cachedDerivative('a'), 'a survived because it was read');
  assert.ok(media.cachedDerivative('c'));
  assert.equal(media.cachedDerivative('missing'), null);
  assert.ok(media.__cacheStats().bytes <= 25, 'the budget is never exceeded');

  // Replacing a key corrects the byte total instead of double-counting it.
  media.cacheDerivative('a', Buffer.alloc(4, 9));
  assert.equal(media.cachedDerivative('a').length, 4);
  assert.ok(media.__cacheStats().bytes <= 25);

  media.__clearCache();

  // A single oversize buffer is not cached at all — one huge derivative must not
  // evict the working set and then blow the budget anyway.
  media.__setCacheBudget(64 * 1024 * 1024);
  const huge = Buffer.alloc(17 * 1024 * 1024);
  media.cacheDerivative('huge', huge);
  assert.equal(media.cachedDerivative('huge'), null);
  assert.deepEqual({ entries: 0, bytes: 0 }, { entries: media.__cacheStats().entries, bytes: media.__cacheStats().bytes });
  media.__setCacheBudget(64 * 1024 * 1024);
  media.__clearCache();
});

// ---------------------------------------------------------------------------
// The real thing
// ---------------------------------------------------------------------------

let imagemagick = true;
try {
  execFileSync('convert', ['-version'], { stdio: 'ignore', timeout: 5000 });
} catch {
  imagemagick = false;
}

test('watermarking a real image keeps it a colour image, and the label survives',
  { skip: imagemagick ? false : 'ImageMagick is not installed on this machine' },
  async () => {
    // A 400×300 mid-grey field with a red square: enough colour to catch a
    // pipeline that silently converts to grayscale.
    const base = execFileSync('convert', [
      '-size', '400x300', 'xc:#c8a07a',
      '-fill', '#b03030', '-draw', 'rectangle 40,40 160,160',
      '-quality', '90', 'jpg:-',
    ], { maxBuffer: 8 * 1024 * 1024 });

    const label = media.watermarkLabel({ ref: 'e51b3efa-ac79-48e3', assetId: '0bf4' });
    const out = await media.watermarkImage(base, { label });

    assert.ok(out.length > 1000, 'something came back');
    assert.equal(out.subarray(0, 2).toString('hex'), 'ffd8', 'JPEG magic');
    assert.equal(out.subarray(-2).toString('hex'), 'ffd9', 'JPEG ends with EOI');

    const { width, height } = await media.imageDimensions(out);
    assert.equal(width, 400);
    assert.equal(height, 300);

    // Still colour. A grayscale JPEG reports `gray` here, and a watermark drawn
    // as a separate layer used to produce exactly that.
    const colorspace = execFileSync('identify', ['-format', '%[colorspace]', '-'],
      { input: out, maxBuffer: 1024 * 1024 }).toString();
    assert.equal(colorspace, 'sRGB');

    // The mark is actually in the pixels. `compare` needs two files rather than
    // stdin, and the count of differing pixels is what catches the silent no-op:
    // a watermark that draws nothing returns a perfectly valid JPEG.
    const a = path.join(os.tmpdir(), `bb-media-${process.pid}-a.jpg`);
    const b = path.join(os.tmpdir(), `bb-media-${process.pid}-b.jpg`);
    writeFileSync(a, base);
    writeFileSync(b, out);
    let differing;
    try {
      execFileSync('compare', ['-metric', 'AE', a, b, 'null:'], { stdio: ['ignore', 'ignore', 'pipe'] });
      differing = 0;
    } catch (err) {
      // `compare` exits non-zero when the images differ, and reports on stderr.
      differing = Number(String(err.stderr).trim());
    } finally {
      rmSync(a, { force: true });
      rmSync(b, { force: true });
    }
    assert.ok(Number.isFinite(differing) && differing > 200,
      `expected visible marks, ${differing} pixels differ`);
    // And not a wholesale repaint: a mark is a few per cent of a 400×300 image.
    assert.ok(differing < 400 * 300 * 0.5, `${differing} pixels differ — that is not a watermark`);

    // And it is smaller than what it was made from, so a derivative is never
    // more than the original it came from — the resize runs first.
    const big = execFileSync('convert', ['-size', '3000x2000', 'xc:#203040', '-quality', '95', 'jpg:-'],
      { maxBuffer: 64 * 1024 * 1024 });
    const shrunk = await media.watermarkImage(big, { label });
    const dims = await media.imageDimensions(shrunk);
    assert.equal(dims.width, 1600, 'resized down to the working width');
    assert.equal(Math.round(dims.height), Math.round(2000 * (1600 / 3000)));
    assert.ok(shrunk.length < big.length, `${shrunk.length} < ${big.length}`);
  });

test('a file that is not an image fails loudly, so the caller can fall back',
  { skip: imagemagick ? false : 'ImageMagick is not installed on this machine' },
  async () => {
    await assert.rejects(
      () => media.watermarkImage(Buffer.from('this is not an image at all')),
      /convert exited|timed out/,
      'a corrupt upload must throw, not return garbage the caller serves as a JPEG',
    );
  });

// ---------------------------------------------------------------------------
// What kind of asset is it
// ---------------------------------------------------------------------------
//
// The shape decides which section a card lands in, and (from slice 3) where an
// ad may sit. Getting it wrong is quiet in the same way a wrong media kind is:
// the page renders, the card looks fine, and a video is filed under Files. So
// the cases below are the ones that actually arrive from an upload form, in the
// order they arrive — including the ones where the browser could not type the
// file and the extension had to answer.

const at = (filename, mime_type = '') => ({ filename, mime_type });

test('the shape of an asset comes from its files, and the vocabulary is closed', () => {
  assert.deepEqual(media.ASSET_SHAPES, ['read', 'watch', 'listen', 'play', 'stream', 'download']);
  for (const shape of media.ASSET_SHAPES) {
    assert.match(media.shapeLabel(shape), /^[A-Z]/, `${shape} needs a word for the card`);
  }
  // An unknown shape — a row written by an older version, a typo in a fixture —
  // is named as what it is in practice: a file handed over.
  assert.equal(media.shapeLabel('hologram'), 'Download');
  assert.equal(media.shapeLabel(undefined), 'Download');
});

test('video, audio and pages are told apart by what they are, not by order', () => {
  assert.equal(media.assetShape([at('ep1.mp4', 'video/mp4')]), 'watch');
  assert.equal(media.assetShape([at('track.mp3', 'audio/mpeg')]), 'listen');
  assert.equal(media.assetShape([at('chapter1.jpg', 'image/jpeg'), at('chapter2.jpg', 'image/jpeg')]), 'read');
  assert.equal(media.assetShape([at('book.pdf', 'application/pdf')]), 'read');
  assert.equal(media.assetShape([at('volume.cbz', '')]), 'read');
  assert.equal(media.assetShape([at('game.html', 'text/html')]), 'play');
  assert.equal(media.assetShape([at('build.zip', 'application/zip')]), 'download');

  // The poster-first case: a seller uploads the cover before the video, and the
  // asset must still be a video. This is why the rules are set-based.
  assert.equal(
    media.assetShape([at('cover.jpg', 'image/jpeg'), at('film.mp4', 'video/mp4')]),
    'watch',
    'a cover image does not turn a video into a page-turner',
  );
  // And the other direction: two images beside an audio file is an album.
  assert.equal(
    media.assetShape([at('front.jpg', 'image/jpeg'), at('back.jpg', 'image/jpeg'), at('a.mp3', 'audio/mpeg')]),
    'listen',
  );
});

test('a file the browser could not type is still read correctly', () => {
  // The case that actually happens: `application/octet-stream` for a good mp4.
  assert.equal(media.assetShape([at('clip.mp4', 'application/octet-stream')]), 'watch');
  assert.equal(media.assetShape([at('SONG.MP3', '')]), 'listen');
  assert.equal(media.assetShape([at('pages.pdf', 'application/octet-stream')]), 'read');
});

test('one image is something to take away; two are pages to go through', () => {
  assert.equal(media.assetShape([at('wallpaper.png', 'image/png')]), 'download');
  assert.equal(media.assetShape([at('a.png', 'image/png'), at('b.png', 'image/png')]), 'read');
});

test('a shape cannot be claimed: an archive stays a download', () => {
  // A zip that happens to contain a game is still a zip until the play surface
  // exists to run it. Saying otherwise would be a promise the page cannot keep.
  assert.equal(media.assetShape([at('game.zip', 'application/zip'), at('readme.txt', 'text/plain')]), 'download');
  assert.equal(media.assetShape([]), 'download');
  assert.equal(media.assetShape(null), 'download');
});

test('a live URL is the live shape, and nothing else is', () => {
  assert.equal(media.assetShape([], { url: 'https://cdn.example/live/index.m3u8' }), 'stream');
  assert.equal(media.assetShape([], { url: 'https://cdn.example/live/index.m3u8?token=1' }), 'stream');
  assert.equal(media.assetShape([at('clip.mp4', 'video/mp4')], { url: 'https://example.com/watch.mp4' }), 'watch');
  assert.equal(media.isLiveUrl('https://example.com/notes.m3u8'), true);
  assert.equal(media.isLiveUrl('https://example.com/video.mp4'), false);
  assert.equal(media.isLiveUrl(null), false);
});
