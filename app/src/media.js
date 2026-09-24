/**
 * Media: what a file is, and how it is shown without being given away.
 *
 * The honest position, because it shapes every choice in this file:
 *
 *   ON THE WEB, NOTHING PREVENTS A SCREENSHOT. No browser API can. Any device
 *   that renders pixels can capture them, and every technique sold as a fix is
 *   either detection (unreliable) or DRM at Widevine L3 (which does not block
 *   capture in a desktop browser).
 *
 * So the goal here is not prevention, which would be a lie told in code. It is:
 *
 *   1. Do not hand over a file. Play it. A player is not a download link.
 *   2. Make an unauthorised copy traceable to an account. A watermark does not
 *      stop the leak; it makes the leak attributable, which is the part that
 *      actually changes behaviour.
 *   3. Say plainly which of those two is which, in the UI, so nobody is sold a
 *      protection that does not exist.
 *
 * The one place a real block exists is the Android app, where FLAG_SECURE is
 * enforced by the operating system: screenshots and screen recording of a
 * protected window come out black, on Android 14 and 15 as well. That is a
 * different codebase and a genuinely stronger control.
 */

import { execFile, spawn } from 'node:child_process';
import crypto from 'node:crypto';
import path from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

/**
 * Run a command with bytes on stdin and collect stdout.
 *
 * `execFile`'s promisified form has no `input` option — passing one is silently
 * ignored, and the child then waits on a stdin that never closes. That is not a
 * visible error: the request hangs until something times out. Hence a real
 * spawn, an explicit `end(input)`, a timeout, and an output cap so a decompression
 * bomb cannot be used to exhaust memory through this path.
 */
function runWithInput(cmd, args, input, { maxBuffer = 64 * 1024 * 1024, timeoutMs = 20_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    const out = [];
    const err = [];
    let size = 0;
    let settled = false;

    const done = (fn, value) => { if (!settled) { settled = true; clearTimeout(timer); fn(value); } };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      done(reject, new Error(`${cmd} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on('data', (d) => {
      size += d.length;
      if (size > maxBuffer) {
        child.kill('SIGKILL');
        return done(reject, new Error(`${cmd} produced more than ${maxBuffer} bytes`));
      }
      out.push(d);
    });
    child.stderr.on('data', (d) => err.push(d));
    child.on('error', (e) => done(reject, e));
    child.on('close', (code) => (code === 0
      ? done(resolve, Buffer.concat(out))
      : done(reject, new Error(`${cmd} exited ${code}: ${Buffer.concat(err).toString().slice(0, 200)}`))));

    child.stdin.on('error', () => {});   // the child may exit before reading stdin
    child.stdin.end(input);
  });
}

// ---------------------------------------------------------------------------
// What kind of thing is this?
// ---------------------------------------------------------------------------

const VIDEO_EXT = new Set(['mp4', 'm4v', 'mov', 'webm', 'mkv', 'avi', 'ogv']);
const AUDIO_EXT = new Set(['mp3', 'm4a', 'aac', 'ogg', 'oga', 'wav', 'flac', 'opus']);
const IMAGE_EXT = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif', 'bmp', 'tiff', 'tif']);

/**
 * Kind of media, from the MIME type with the extension as a fallback.
 *
 * Browsers are inconsistent about MIME on upload — `application/octet-stream`
 * for a perfectly good mp4 is common — so the extension is not a nicety, it is
 * the case that actually happens.
 */
export function mediaKind(mimeType, filename = '') {
  const mime = String(mimeType || '').toLowerCase().split(';')[0].trim();
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('image/')) return 'image';

  const ext = path.extname(String(filename)).slice(1).toLowerCase();
  if (VIDEO_EXT.has(ext)) return 'video';
  if (AUDIO_EXT.has(ext)) return 'audio';
  if (IMAGE_EXT.has(ext)) return 'image';
  return 'file';
}

// ---------------------------------------------------------------------------
// What kind of ASSET is this?
// ---------------------------------------------------------------------------
//
// Six shapes, and they are DERIVED — never typed by a seller. The reason is the
// same one that put the unlock ask on a value ladder instead of two number boxes:
// the person uploading knows what their file is, and everybody downstream (the
// card, the section it sits in, and — in slice 3 — the placement planner) needs
// the same answer. A shape a seller could type is a shape a seller could lie
// about to dodge an ask, and a zip is not a video because its uploader says so.
//
// The rules are set-based rather than order-based on purpose: a seller who
// uploads the poster before the video still has a video, and a store that puts a
// cover image first must not turn its player into a page-turner.
//
// The one thing this cannot see is what is INSIDE an archive. A zip that happens
// to contain a game is a download until the play surface can do something with
// it — calling it "play" before there is a place to play it would be a promise
// the page cannot keep.

/** The closed vocabulary. Anything unknown is a download, which is what it is. */
export const ASSET_SHAPES = ['read', 'watch', 'listen', 'play', 'stream', 'download'];

/** Ordering for sections and chips when two shapes hold the same number of files. */
export const SHAPE_ORDER = ['read', 'watch', 'listen', 'play', 'stream', 'download'];

const SHAPE_LABELS = {
  read: 'Read', watch: 'Watch', listen: 'Listen', play: 'Play', stream: 'Live', download: 'Download',
};

/** The word on the card. Never a sentence — the card has a title to fit too. */
export const shapeLabel = (shape) => SHAPE_LABELS[shape] || SHAPE_LABELS.download;

const DOC_EXT = new Set(['pdf', 'epub', 'cbz', 'cbr', 'cb7', 'mobi', 'azw', 'azw3', 'fb2', 'djvu']);
const PLAY_EXT = new Set(['html', 'htm']);
const READER_MIME = /^(application\/(pdf|epub\+zip|x-cbz|x-cbr)|image\/vnd\.comic-book)/;

const extOf = (name) => path.extname(String(name || '')).slice(1).toLowerCase();

/**
 * Is this a live stream rather than a file?
 *
 * HLS is the only live protocol a browser plays without help, so it is the one
 * this recognises. A storefront cannot produce one today — the publish form has
 * no link field yet — and the shape exists here so that the day it does, no
 * second rule has to be invented for it.
 */
export const isLiveUrl = (url) => /\.m3u8(\?|#|$)/i.test(String(url || '')) || /^rtmp/i.test(String(url || ''));

/**
 * The shape of an asset, from the files it actually carries.
 *
 * `files` arrive in the seller's order but the decision does not depend on it.
 * Priority: video, then audio, then a single-file program, then something with
 * pages, then everything else. That order is deliberate — a video with a trailer
 * poster is a video, and a reader with a soundtrack is still a reader only when
 * it has no video at all.
 */
export function assetShape(files = [], { url = null } = {}) {
  if (isLiveUrl(url)) return 'stream';
  const list = (Array.isArray(files) ? files : []).filter(Boolean);
  if (!list.length) return 'download';

  const kinds = list.map((f) => mediaKind(f.mime_type ?? f.mimeType, f.filename));
  const exts = list.map((f) => extOf(f.filename));
  const mimes = list.map((f) => String(f.mime_type ?? f.mimeType ?? '').toLowerCase());

  if (kinds.includes('video')) return 'watch';
  if (kinds.includes('audio')) return 'listen';
  if (exts.some((e) => PLAY_EXT.has(e)) || mimes.some((m) => m.startsWith('text/html'))) return 'play';
  if (exts.some((e) => DOC_EXT.has(e)) || mimes.some((m) => READER_MIME.test(m))) return 'read';
  // One image is a picture to take away. Two are pages to go through, and the
  // difference matters: only the second has anywhere sensible to put a break.
  if (kinds.filter((k) => k === 'image').length >= 2) return 'read';
  return 'download';
}

/** Can this be played rather than handed over? */
export const isPlayable = (mimeType, filename) => ['video', 'audio'].includes(mediaKind(mimeType, filename));

/** Nothing playable is longer than a day; the bound exists so nonsense cannot be stored. */
export const MAX_RUNTIME_SEC = 86_400;

/**
 * A length a player could have measured, in whole seconds — or null.
 *
 * One rule with two readers: the store, which decides whether to write it, and the
 * route, which has to answer a browser. They disagree if the rule is written
 * twice, and they did: the route called a *no-op* a bad request, so every page
 * load after the first put a 400 in a viewer's console for a file whose length was
 * already known. The number is the same fact in both places; now so is the rule.
 */
export function measuredSeconds(value) {
  const secs = Math.round(Number(value));
  if (!Number.isFinite(secs) || secs <= 0 || secs > MAX_RUNTIME_SEC) return null;
  return secs;
}

/** Can this be watermarked server-side? (Video and audio cannot — see below.) */
export const isWatermarkable = (mimeType, filename) => mediaKind(mimeType, filename) === 'image';

// ---------------------------------------------------------------------------
// The watermark
// ---------------------------------------------------------------------------

/**
 * The label burned into a derivative.
 *
 * A pseudonymous reference, not a name or an email address: the pixels leave our
 * control the moment they are rendered, so the value in them has to be useless
 * to anyone except us. The first ten characters of the account's ad reference
 * are enough to find the account and not enough to reconstruct it.
 */
export function watermarkLabel({ ref, assetId, at = new Date() }) {
  const who = String(ref || '').replace(/[^a-z0-9]/gi, '').slice(0, 10) || 'unknown';
  const what = String(assetId || '').replace(/[^a-z0-9]/gi, '').slice(0, 4) || '0000';
  const when = at.toISOString().slice(0, 10);
  return `BYTEBIKRI ${who}-${what} ${when}`;
}

/** Stable cache key: same viewer, same file, same day → one derivative. */
export function derivativeKey({ fileId, ref, at = new Date() }) {
  const who = crypto.createHash('sha256').update(String(ref || 'anon')).digest('hex').slice(0, 12);
  return `derived/${fileId}-${who}-${at.toISOString().slice(0, 10)}.jpg`;
}

let imagemagickChecked = null;

/**
 * Is ImageMagick available?
 *
 * Asked once and remembered, including the negative. A watermark is a
 * traceability feature, and a deployment without ImageMagick should serve the
 * file rather than fail to serve it — so this returns a boolean and the caller
 * decides, rather than throwing in a request path.
 */
export async function hasImageMagick() {
  if (imagemagickChecked !== null) return imagemagickChecked;
  try {
    await run('convert', ['-version'], { timeout: 5000 });
    imagemagickChecked = true;
  } catch {
    imagemagickChecked = false;
  }
  return imagemagickChecked;
}

/** For tests that need to exercise the other branch. */
export const __setImageMagickAvailable = (v) => { imagemagickChecked = v; };

/**
 * Draw the label across an image, several times.
 *
 * Repeat positions rather than one in a corner, because a screenshot is very
 * often a crop: a single corner mark is gone the moment somebody trims the
 * white space, and six marks mean cropping anything meaningful out also removes
 * most of what was cropped.
 *
 * Text is drawn unrotated. The rotated version is prettier and was the first
 * thing I wrote, but ImageMagick's `-annotate` argument order differs between
 * the 6 and 7 lines in ways that fail at runtime rather than at review, and a
 * watermark that silently draws nothing is worse than a plain one. `-draw text`
 * behaves identically across both.
 */
export function watermarkDrawArgs({ width, height, label, columns = 3, rows = 3, pointsize = null }) {
  const size = pointsize ?? Math.max(12, Math.min(22, Math.round(Math.min(width, height) / 45)));
  const stepX = Math.floor(width / columns);
  const stepY = Math.floor(height / rows);
  const args = [
    '-font', 'DejaVu-Sans',
    '-pointsize', String(size),
    // Fill plus a thin dark stroke: a white mark on a white wall is invisible,
    // and photographs have both in the same frame.
    '-fill', 'rgba(255,255,255,0.34)',
    '-stroke', 'rgba(0,0,0,0.20)',
    '-strokewidth', '1',
  ];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < columns; col += 1) {
      const x = Math.round(stepX * col + stepX / 4);
      const y = Math.round(stepY * row + stepY / 1.6);
      args.push('-draw', `text ${x},${y} '${label.replace(/'/g, '')}'`);
    }
  }
  args.push('-stroke', 'none');
  return args;
}

/**
 * Produce a watermarked JPEG from an image buffer.
 *
 * Resized down first. Three reasons, all practical: an 8 MB camera original
 * watermarked on every request is a CPU bill; a derivative smaller than the
 * original is a worse thing to leak; and the resize bounds the work the
 * watermark itself does.
 */
export async function watermarkImage(buffer, { label, maxWidth = 1600 } = {}) {
  const input = ['-', '-resize', `${maxWidth}x${maxWidth}>`, '-colorspace', 'sRGB'];

  // Two passes: size it, then draw. Drawing needs the dimensions to place the
  // marks, and a single `convert` invocation cannot know them before it starts.
  const sized = await runWithInput('convert', [...input, '-quality', '88', 'jpg:-'], buffer);

  const info = await runWithInput('identify', ['-format', '%w %h', '-'], sized,
    { maxBuffer: 1024 * 1024 });
  const [width, height] = String(info).trim().split(/\s+/).map(Number);
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    throw new Error('could not read image dimensions');
  }

  const args = [...watermarkDrawArgs({ width, height, label }), '-quality', '88', 'jpg:-'];
  return runWithInput('convert', ['-', ...args], sized);
}

/**
 * A small in-memory cache of watermarked derivatives.
 *
 * Deliberately NOT written to disk. A directory full of watermarked copies of
 * private files is a second copy of everything that leaks, sitting somewhere
 * nobody audits, and it would need its own retention rules. The cache only has
 * to survive a page reload, so memory is the right home. Keyed per viewer per
 * file per day, so a refresh costs a Map lookup rather than an ImageMagick run.
 */
const CACHE = new Map();
let cacheBudget = 64 * 1024 * 1024;
let cacheBytes = 0;

export function cachedDerivative(key) {
  if (!CACHE.has(key)) return null;
  const buf = CACHE.get(key);
  CACHE.delete(key);            // re-insert: Map order is the LRU order
  CACHE.set(key, buf);
  return buf;
}

export function cacheDerivative(key, buffer) {
  // A derivative that is a quarter of the whole budget is not cached at all:
  // keeping it would evict everything else and then exceed the budget anyway.
  if (!buffer?.length || buffer.length > Math.max(cacheBudget / 4, 64 * 1024)) return buffer;
  if (CACHE.has(key)) cacheBytes -= CACHE.get(key).length;
  CACHE.set(key, buffer);
  cacheBytes += buffer.length;
  while (cacheBytes > cacheBudget && CACHE.size > 1) {
    const oldest = CACHE.keys().next().value;
    cacheBytes -= CACHE.get(oldest).length;
    CACHE.delete(oldest);
  }
  return buffer;
}

export const __cacheStats = () => ({ entries: CACHE.size, bytes: cacheBytes, budget: cacheBudget });
/** Tests need a budget they can exceed in a few bytes rather than 64 MB. */
export const __setCacheBudget = (bytes) => { cacheBudget = bytes; };
export const __clearCache = () => { CACHE.clear(); cacheBytes = 0; };

export async function imageDimensions(buffer) {
  const stdout = await runWithInput('identify', ['-format', '%w %h', '-'], buffer,
    { maxBuffer: 1024 * 1024 });
  const [width, height] = String(stdout).trim().split(/\s+/).map(Number);
  return { width, height };
}

// ---------------------------------------------------------------------------
// Byte ranges
// ---------------------------------------------------------------------------

/**
 * Decide what part of a file a `Range` header asks for.
 *
 * In its own function, and not inline in the route, because this is arithmetic
 * with three special cases — an open-ended range, a suffix range, and a range
 * that cannot be satisfied — and every one of them is an off-by-one waiting to
 * happen. A player that gets a wrong `Content-Range` back does not error; it
 * seeks to the wrong place, which is far harder to notice.
 *
 * `total` is the full length. `end` is INCLUSIVE, per RFC 9110.
 * Returns `{ kind: 'full' }`, `{ kind: 'partial', start, end }`, or
 * `{ kind: 'unsatisfiable' }`.
 */
export function rangeFor(header, total) {
  const text = String(header ?? '').trim();
  if (!text) return { kind: 'full' };

  // A range unit or syntax we do not understand is IGNORED, not refused: RFC
  // 9110 says so, and it is the behaviour that keeps a stray `Range` from a
  // proxy or a scraper from turning a working page into a 416.
  // Multipart ranges are legal, unused by browsers for media, and answering one
  // with a single part would be wrong — so they fall into the same bucket.
  const m = /^bytes=(\d*)-(\d*)$/.exec(text);
  if (!m || (m[1] === '' && m[2] === '')) return { kind: 'full' };

  // A syntactically valid range that cannot be satisfied IS a 416.
  if (!Number.isInteger(total) || total <= 0) return { kind: 'unsatisfiable' };

  let start;
  let end;
  if (m[1] === '') {
    const suffix = Number(m[2]);              // `bytes=-500` → the last 500
    if (suffix <= 0) return { kind: 'unsatisfiable' };
    start = Math.max(0, total - suffix);
    end = total - 1;
  } else {
    start = Number(m[1]);                     // `bytes=500-` → from there on
    end = m[2] === '' ? total - 1 : Math.min(Number(m[2]), total - 1);   // inclusive
  }

  if (start > end || start >= total) return { kind: 'unsatisfiable' };
  return { kind: 'partial', start, end };
}

// ---------------------------------------------------------------------------
// The client-side mark (video and audio)
// ---------------------------------------------------------------------------

/**
 * A repeating SVG used as a CSS background over a playing video.
 *
 * Video cannot be watermarked here — that needs a transcoder (ffmpeg) and a
 * re-encode of every file on upload, which is a real decision with a real cost,
 * not something to slip into a request path. So the mark is drawn in the DOM,
 * on top of the frames: it is composited into any screenshot or screen recording
 * of the page exactly as the burned-in one is composited into an image.
 *
 * What it does NOT survive: a capture that never touches the DOM. If someone
 * grabs the media stream directly, the overlay was never in those pixels.
 */
export function watermarkSvgDataUri(label, { opacity = 0.22 } = {}) {
  const safe = String(label).replace(/[<>&"']/g, '');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="150">`
    + `<text x="10" y="80" font-family="system-ui,sans-serif" font-size="15" font-weight="600"`
    + ` fill="#ffffff" fill-opacity="${opacity}" transform="rotate(-20 180 75)">${safe}</text>`
    + '</svg>';
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}
