/**
 * Shapes on a store page.
 *
 * The brief's fourth idea was "digital assets are really vast, so section each
 * differently — without making navigation complex". That is a rendering rule, and
 * rendering rules are the ones that go quietly wrong: every page still returns
 * 200, every card still shows a title, and a store that sells videos, a manhwa
 * and a zip looks exactly like a store that sells three zips.
 *
 * So these tests hold the three sentences the page owes a visitor:
 *
 *   1. A store with one kind of thing looks exactly as it did. No chips, no
 *      headings, no new noise — the section machinery must be invisible until
 *      there is something to say.
 *   2. With more than one kind, the biggest comes first and an empty kind is
 *      never drawn. (Progressive disclosure's own failure mode is hiding
 *      something a person needs; a heading over nothing is the opposite failure.)
 *   3. Every card says what it is and what it costs before the click, and the
 *      server sends every section — the filter is the client's job, so a filtered
 *      page is still a complete page.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as views from '../src/views.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(path.join(here, '..', p), 'utf8');

const channel = {
  id: 'c1', slug: 's', name: 'Store', owner_id: 'someone-else', listing_mode: 'storefront',
};
const file = (filename, mime_type = '') => ({ filename, mime_type, size_bytes: 1, sort_order: 0 });
const asset = (id, shape, over = {}) => ({
  id, slug: id, title: id, description: '', shape,
  unlock_mode: 'ad_gated', ads_required: 1, files: [file('x.bin')], ...over,
});
const page = (assets) => views.storefront({
  channel, assets, slots: [], user: null, estimate: null, pageviews: 0,
});

test('a store with one kind of thing looks exactly as it did', () => {
  const html = page([asset('a', 'download'), asset('b', 'download')]);
  assert.match(html, /id="shape-download"/);
  assert.ok(!html.includes('shape-chips'), 'no chips where there is nothing to filter');
  assert.ok(!html.includes('shape-head'), 'and no heading saying the obvious');
  assert.match(html, /Content/);
  assert.match(html, /One ad each\. The network pays the creator directly\./);
});

test('an empty store says so, and says nothing else', () => {
  const html = page([]);
  assert.match(html, /has not published anything yet/);
  assert.ok(!html.includes('shape-chips'));
  assert.ok(!html.includes('shape-group'));
});

test('sections appear when there is more than one kind, biggest first', () => {
  const html = page([
    asset('v1', 'watch'), asset('v2', 'watch'), asset('v3', 'watch'),
    asset('d1', 'download'),
    asset('r1', 'read'),
  ]);
  assert.match(html, /shape-chips/);
  // 3 watches, then the two singletons in canonical order — read before download.
  const order = ['id="shape-watch"', 'id="shape-read"', 'id="shape-download"']
    .map((marker) => html.indexOf(marker));
  assert.ok(order.every((i) => i > -1), `a section is missing: ${order.join(', ')}`);
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'the biggest kind comes first');

  // A kind the store does not have is never drawn as an empty heading.
  assert.ok(!html.includes('id="shape-listen"'), 'no empty section for a shape with no files');
  assert.ok(!html.includes('id="shape-play"'));
  assert.ok(!html.includes('id="shape-stream"'));
});

test('every card says what it is and what it costs, before the click', () => {
  const html = page([asset('v1', 'watch'), asset('d1', 'download')]);
  const cards = html.match(/<a class="asset"[\s\S]*?<\/a>/g) || [];
  assert.equal(cards.length, 2, 'two assets, two cards');
  const video = cards.find((c) => c.includes('/a/v1'));
  const zip = cards.find((c) => c.includes('/a/d1'));
  assert.match(video, /Watch · 1 file/);
  assert.match(video, /1 ad to unlock/);
  assert.match(zip, /Download · 1 file/);
});

test('the server sends every section; filtering is the client’s job', () => {
  const html = page([asset('v1', 'watch'), asset('d2', 'download')]);
  assert.ok(!/<div class="shape-group"[^>]*\shidden/.test(html),
    'a filtered view is drawn by the script, not by the server — so the HTML alone is complete');
});

test('the client script and the view agree on the names they pass each other', () => {
  // The failure this catches: the view writes one attribute and the script reads
  // another. Every other test in the suite passes, the page renders, and the
  // chips quietly do nothing — which is exactly the bug the ui tests exist for.
  const client = read('public/app.js');
  const view = read('src/views.js');

  for (const attr of ['data-shape-chip', 'data-shape-section']) {
    assert.match(view, new RegExp(attr), `${attr} is written by the view`);
    assert.match(client, new RegExp(attr), `${attr} is read by the client`);
  }
  // The anchor the client scrolls to is the id the view writes.
  assert.match(view, /id="shape-\$\{esc\(shape\)\}"/);
  assert.match(client, /getElementById\(`shape-\$\{shape\}`\)/);
  // And the chip is a link first: without the script it still goes somewhere.
  assert.match(view, /href="#shape-\$\{esc\(shape\)\}"/);
});
