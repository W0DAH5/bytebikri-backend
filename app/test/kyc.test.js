/**
 * The identity document: what may come in, what comes out, and what is left after.
 * npm test
 *
 * The audit listed "KYC verification flow: schema exists, no upload, no review"
 * from the beginning, and the schema had already written the rule the flow has to
 * obey — *"verify, then discard the source"*. An upload is the easiest way in the
 * world to break that rule by accident, so this file is about the three claims the
 * pages make, in the order a mistake would be invisible:
 *
 *   1. THE BYTES DECIDE. A PDF renamed `.jpg`, an SVG with a script in it, a HEIC
 *      from an iPhone: each is refused, and refused for the reason the page prints.
 *      A `content-type` header is a claim by the client and is never read.
 *
 *   2. THE CAMERA'S NOTES NEVER REACH THE DISK. GPS, device, timestamp — stripped
 *      from JPEG, PNG and WebP before the file is written, with the picture
 *      otherwise unchanged (the ICC profile is kept; dropping it would change how
 *      the document looks to the person checking it).
 *
 *   3. NOTHING OUTLIVES THE DECISION. A copy is destroyed when an outcome is
 *      recorded, when the seller withdraws, when a second one replaces it, and by
 *      the sweep after a week — and every one of those is asserted by ASKING THE
 *      STORAGE LAYER whether the key still resolves, not by trusting a flag.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:55432/bytebikri_test';

const { close, query } = await import('../src/db.js');
const { store, storage } = await import('../src/store.js');
const { sniff, stripMetadata, ALLOWED_TYPES, MAX_BYTES, HOLD_DAYS } = await import('../src/kyc.js');
const views = await import('../src/views.js');
after(async () => { await close(); });

let seq = 0;

// ── tiny image builders, so the tests exercise real containers ──────────────
// A JPEG with an APP1 (EXIF) segment carrying GPS text, an APP0, and a fake SOS.
function jpegWithExif(note = 'GPS 27.7172N 85.3240E iPhone 15 Pro') {
  const app0 = Buffer.concat([Buffer.from([0xff, 0xe0, 0x00, 0x10]), Buffer.from('JFIF\0'), Buffer.alloc(9)]);
  const payload = Buffer.from(`Exif\0\0${note}`);
  const app1 = Buffer.concat([
    Buffer.from([0xff, 0xe1]), Buffer.from([(payload.length + 2) >> 8, (payload.length + 2) & 0xff]), payload,
  ]);
  const sos = Buffer.concat([Buffer.from([0xff, 0xda, 0x00, 0x08]), Buffer.from([1, 1, 0, 0, 0x3f, 0x00]), Buffer.from([0x11, 0x22, 0x33])]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, app1, sos, Buffer.from([0xff, 0xd9])]);
}

// A PNG with a tEXt chunk and an eXIf chunk between the header and the data.
function pngWithText() {
  const chunk = (type, data) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, 'latin1');
    return Buffer.concat([head, data, Buffer.alloc(4)]);   // CRC is not checked here
  };
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', Buffer.alloc(13)),
    chunk('tEXt', Buffer.from('Comment\0taken at home 27.7172N')),
    chunk('eXIf', Buffer.from('Exif\0\0device')),
    chunk('IDAT', Buffer.from([1, 2, 3, 4])),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// A WebP with an EXIF chunk, a VP8X header claiming one, and a VP8 bitstream.
function webpWithExif() {
  const riff = (type, data) => {
    const head = Buffer.alloc(8);
    head.write(type, 0, 'latin1');
    head.writeUInt32LE(data.length, 4);
    return Buffer.concat([head, data, Buffer.alloc(data.length % 2)]);
  };
  const vp8x = Buffer.alloc(10);
  vp8x[0] = 0x0c;                                          // "EXIF and XMP are present"
  const inner = Buffer.concat([
    riff('VP8X', vp8x),
    riff('EXIF', Buffer.from('Exif\0\0GPS 27.7172N 85.3240E')),
    riff('VP8 ', Buffer.from([9, 9, 9, 9])),
  ]);
  const head = Buffer.alloc(12);
  head.write('RIFF', 0, 'latin1');
  head.writeUInt32LE(inner.length + 4, 4);
  head.write('WEBP', 8, 'latin1');
  return Buffer.concat([head, inner]);
}

const has = (buf, needle) => buf.includes(Buffer.from(needle, 'latin1'));

async function fixture() {
  const tag = `${Date.now()}-${++seq}`;
  const owner = await store.userByEmailOrCreate(`owner-kyc-${tag}@test.local`);
  const channel = await store.createChannel({ ownerId: owner.id, slug: `kyc-${tag}`, name: `KYC ${tag}` });
  // A seat on the Store plan: a check is included from there up, and the ask route
  // refuses on the free plan — so a fixture that cannot ask would be testing the
  // wrong refusal. The plan lives on the SUBSCRIPTION, which is the one place this
  // codebase allows it to live (a channel that could name its own plan would be a
  // channel that can grant itself one).
  await query(
    `insert into subscriptions (channel_id, plan_code, status, period_start, period_end)
     values ($1, 'store', 'active', now(), now() + interval '365 days')`,
    [channel.id],
  );
  return { owner, channel: await store.channelById(channel.id), tag };
}

async function cleanup(channel, owner, keys = []) {
  for (const k of keys) await storage.remove(k);
  await query('delete from subscriptions where channel_id = $1', [channel.id]);
  await query('delete from seller_verifications where channel_id = $1', [channel.id]);
  await query('delete from audit_logs where subject_id = $1 or meta->>\'channelId\' = $2', [channel.id, channel.id]);
  await query('delete from channels where id = $1', [channel.id]);
  await query('delete from profiles where id = $1', [owner.id]);
}

// ── what may come in ────────────────────────────────────────────────────────

test('the bytes decide what a file is, and three kinds are refused by name', () => {
  assert.equal(sniff(jpegWithExif()), 'image/jpeg', 'a JPEG is a JPEG because it starts FF D8 FF');
  assert.equal(sniff(pngWithText()), 'image/png');
  assert.equal(sniff(webpWithExif()), 'image/webp');

  // The refusals. A PDF that has been renamed, an SVG (which is a script with a
  // picture drawn on it), a HEIC from an iPhone, and a text file.
  assert.equal(sniff(Buffer.from('%PDF-1.7\n%âãÏÓ', 'latin1')), null, 'a PDF is refused, whatever it is named');
  assert.equal(sniff(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')), null,
    'an SVG is a script, not a picture');
  assert.equal(sniff(Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypheic'), Buffer.alloc(20)])), null,
    'HEIC is refused — which is why the form tells iPhone owners to change the setting');
  assert.equal(sniff(Buffer.from('hello there, this is not an image')), null);
  assert.equal(sniff(Buffer.alloc(4)), null, 'a stub too short to hold a header is not sniffed into a type');

  assert.deepEqual(Object.keys(ALLOWED_TYPES).sort(), ['image/jpeg', 'image/png', 'image/webp']);
  assert.equal(MAX_BYTES, 8 * 1024 * 1024, 'the cap is the one the copy states, and multer enforces the same number');
});

// ── what comes out of it ────────────────────────────────────────────────────

test('the camera leaves its notes behind, and the picture survives', () => {
  const jpeg = jpegWithExif();
  assert.ok(has(jpeg, 'GPS 27.7172N'), 'the fixture really does carry a location');
  const cleanJpeg = stripMetadata(jpeg, 'image/jpeg');
  assert.ok(!has(cleanJpeg, 'GPS'), 'the coordinates are gone before the file is stored');
  assert.ok(!has(cleanJpeg, 'iPhone'), 'and so is the device');
  assert.ok(has(cleanJpeg, 'JFIF'), 'the JFIF header stays: this is still a JPEG');
  assert.ok(cleanJpeg.includes(Buffer.from([0xff, 0xda])), 'and the image data is copied through, not re-encoded');
  assert.ok(cleanJpeg.length < jpeg.length, 'the file got smaller, which is what removing something looks like');

  const png = pngWithText();
  assert.ok(has(png, 'taken at home'));
  const cleanPng = stripMetadata(png, 'image/png');
  assert.ok(!has(cleanPng, 'taken at home'), 'PNG text chunks go');
  assert.ok(!has(cleanPng, 'Exif'), 'and so does the EXIF chunk');
  assert.ok(has(cleanPng, 'IHDR') && has(cleanPng, 'IDAT') && has(cleanPng, 'IEND'),
    'every chunk that makes it an image is kept — a file missing IHDR is not a file');

  const webp = webpWithExif();
  assert.ok(has(webp, '27.7172N'));
  const cleanWebp = stripMetadata(webp, 'image/webp');
  assert.ok(!has(cleanWebp, 'Exif'), 'the WebP EXIF chunk goes');
  assert.ok(has(cleanWebp, 'VP8 '), 'and the bitstream stays');
  assert.equal(cleanWebp.readUInt32LE(4), cleanWebp.length - 8, 'the RIFF size is recomputed, not left lying');
  const flagsAt = 12 + 8;
  assert.equal(cleanWebp[flagsAt] & 0x0c, 0, 'and the header stops claiming metadata that is no longer there');
});

test('a file it cannot parse is passed through rather than mangled', () => {
  // A truncated JPEG: no SOS, no clean segment chain. The rule is that dropping
  // metadata must never produce a file the browser cannot open, and a smaller file
  // with the GPS still in it is worse than a file we admit we left alone.
  const broken = Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.from('not really a jpeg')]);
  const out = stripMetadata(broken, 'image/jpeg');
  assert.ok(out.length > 0, 'something comes back');
  assert.equal(stripMetadata(Buffer.from('nothing at all'), 'image/png').toString(), 'nothing at all',
    'an unparsable container is returned as it came');
});

// ── what is left after ──────────────────────────────────────────────────────

test('a handed-over document is on disk while a person looks, and gone the moment they decide', async () => {
  const { owner, channel } = await fixture();
  let key = null;
  try {
    await store.askForVerification({ channelId: channel.id, note: 'In Pokhara until Friday' });
    const open = await store.pendingVerificationFor(channel.id);

    const bytes = stripMetadata(jpegWithExif(), 'image/jpeg');
    key = await storage.put(bytes, 'document.jpg', { namespace: 'kyc' });
    const attached = await store.attachVerificationDocument({
      channelId: channel.id, key, mime: 'image/jpeg', bytes: bytes.length, actorId: owner.id,
    });
    assert.equal(attached.ok, true);
    // The audit line answers "who", not only "when": the seller's own id is on it.
    const line = await query(
      `select actor_id from audit_logs
        where action = 'seller.verification_document_handed' and meta->>'channelId' = $1`, [channel.id]);
    assert.equal(line.rows[0].actor_id, owner.id);

    const held = await store.pendingVerificationFor(channel.id);
    assert.equal(held.document_key, key, 'the request points at the file');
    assert.equal(held.docs_retained, true, 'and the derived column says a copy is being held');
    assert.equal(await storage.exists(key), true, 'the bytes are really there — this is the claim being tested');

    // The operator's reader is the only way in, and it is looked up by the request.
    const byId = await store.verificationDocumentById(held.id);
    assert.equal(byId.document_key, key);
    assert.equal(byId.document_mime, 'image/jpeg');
    assert.equal(await store.verificationDocumentById('not-a-uuid'), null, 'a malformed id is not a database cast');

    // The decision. This is the whole promise, so it is asserted against storage.
    await store.recordVerification({
      channelId: channel.id, outcome: 'verified', method: 'manual', actorId: owner.id, months: 24,
    });
    assert.equal(await storage.exists(key), false, 'THE BYTES ARE GONE — the file is destroyed by the decision');
    key = null;
    const rows = await query('select * from seller_verifications where channel_id = $1', [channel.id]);
    assert.equal(rows.rows.length, 1, 'the outcome row is what is left');
    assert.equal(rows.rows[0].status, 'verified');
    assert.ok(rows.rows[0].document_destroyed_at, 'with the time the copy stopped existing');
    assert.equal(rows.rows[0].docs_retained, false, 'and the derived column agrees');

    const destroyed = await query(
      `select count(*)::int as n from audit_logs
        where action = 'seller.verification_document_destroyed' and meta->>'channelId' = $1`, [channel.id]);
    assert.equal(destroyed.rows[0].n, 1, 'one audit line, naming the reason');
    const handed = await query(
      `select meta->>'reason' as reason from audit_logs
        where action = 'seller.verification_document_destroyed' and meta->>'channelId' = $1`, [channel.id]);
    assert.equal(handed.rows[0].reason, 'decided');
  } finally {
    await cleanup(channel, owner, key ? [key] : []);
  }
});

test('withdrawing destroys the copy, and so does sending a second one', async () => {
  const { owner, channel } = await fixture();
  const keys = [];
  try {
    await store.askForVerification({ channelId: channel.id, note: null });
    const first = await storage.put(stripMetadata(jpegWithExif(), 'image/jpeg'), 'document.jpg', { namespace: 'kyc' });
    keys.push(first);
    await store.attachVerificationDocument({ channelId: channel.id, key: first, mime: 'image/jpeg', bytes: 100 });
    assert.equal(await storage.exists(first), true);

    // "I sent the wrong page." The replacement is one call, and the old file does not
    // survive it for the rest of the week.
    const second = await storage.put(stripMetadata(pngWithText(), 'image/png'), 'document.png', { namespace: 'kyc' });
    keys.push(second);
    await store.attachVerificationDocument({ channelId: channel.id, key: second, mime: 'image/png', bytes: 120 });
    assert.equal(await storage.exists(first), false, 'the replaced copy is destroyed, not archived');
    assert.equal(await storage.exists(second), true);

    // Withdrawing is the seller changing their mind, and it has to be as final as a
    // decision — otherwise "withdrawn" leaves a file on disk with no request behind it.
    await store.withdrawVerificationRequest(channel.id);
    assert.equal(await storage.exists(second), false, 'withdrawing destroys the copy');
    assert.equal(await store.pendingVerificationFor(channel.id), null, 'and the request is gone');
    keys.length = 0;
  } finally {
    await cleanup(channel, owner, keys);
  }
});

test('a copy nobody gets to is destroyed after its week, and the request stays open', async () => {
  const { owner, channel } = await fixture();
  const keys = [];
  try {
    await store.askForVerification({ channelId: channel.id, note: null });
    const key = await storage.put(stripMetadata(jpegWithExif(), 'image/jpeg'), 'document.jpg', { namespace: 'kyc' });
    keys.push(key);
    await store.attachVerificationDocument({ channelId: channel.id, key, mime: 'image/jpeg', bytes: 100 });

    // A fresh hold is not swept: the sweep asks about the date, not about existence.
    assert.equal(await store.sweepVerificationDocuments(), 0, 'nothing is destroyed before its week');
    assert.equal(await storage.exists(key), true);

    // Move the clock instead of waiting for it. `document_added_at` is the only date
    // the sweep reads, which is what makes this a test of the rule and not of a job.
    await query(`update seller_verifications set document_added_at = now() - ($2 || ' days')::interval
                  where channel_id = $1`, [channel.id, String(HOLD_DAYS + 1)]);
    assert.equal(await store.sweepVerificationDocuments(), 1, 'the week is up');
    assert.equal(await storage.exists(key), false, 'the copy is destroyed');
    keys.length = 0;

    const still = await store.pendingVerificationFor(channel.id);
    assert.ok(still, 'THE REQUEST IS STILL OPEN — a slow queue is our problem, not the seller\'s');
    assert.equal(still.document_key, null);
    assert.ok(still.document_destroyed_at, 'and the page can say when the copy went');
    const reason = await query(
      `select meta->>'reason' as reason from audit_logs
        where action = 'seller.verification_document_destroyed' and meta->>'channelId' = $1`, [channel.id]);
    assert.equal(reason.rows[0].reason, 'expired', 'the log says which of the three ways it was');
  } finally {
    await cleanup(channel, owner, keys);
  }
});

test('a document cannot outlive the request it belongs to', async () => {
  const { owner, channel } = await fixture();
  try {
    // No request open: there is nothing to check a document against, so it is refused
    // rather than stored with nothing pointing at it.
    const key = await storage.put(stripMetadata(jpegWithExif(), 'image/jpeg'), 'document.jpg', { namespace: 'kyc' });
    const orphan = await store.attachVerificationDocument({
      channelId: channel.id, key, mime: 'image/jpeg', bytes: 100,
    });
    assert.equal(orphan.ok, false);
    assert.equal(orphan.reason, 'no-request');
    await storage.remove(key);

    // And the schema refuses the same thing independently of this code path: a
    // decided row may not carry a document, whoever writes it.
    await store.recordVerification({ channelId: channel.id, outcome: 'verified', method: 'manual' });
    const row = (await query('select id from seller_verifications where channel_id = $1', [channel.id])).rows[0];
    await assert.rejects(
      query(`update seller_verifications set document_key = 'kyc/00000000-0000-0000-0000-000000000000.jpg',
                    document_mime = 'image/jpeg', document_bytes = 10, document_added_at = now()
              where id = $1`, [row.id]),
      /doc_only_pending/,
      'a row that has been decided cannot be made to hold evidence',
    );
  } finally {
    await cleanup(channel, owner);
  }
});

// ── the pages ───────────────────────────────────────────────────────────────

test('the seller is told what happens to it, in the words the code enforces', async () => {
  const { owner, channel } = await fixture();
  try {
    await store.askForVerification({ channelId: channel.id, note: null });
    const key = await storage.put(stripMetadata(jpegWithExif(), 'image/jpeg'), 'document.jpg', { namespace: 'kyc' });
    await store.attachVerificationDocument({ channelId: channel.id, key, mime: 'image/jpeg', bytes: 100 });
    const open = { ...(await store.pendingVerificationFor(channel.id)), opens: 2 };

    const html = views.storeSettings({
      channel, user: { id: owner.id, email: owner.email, display_name: owner.display_name },
      plan: store.plan(channel), verification: null, pendingRequest: open,
      stats: {}, subscription: null, capabilities: store.plan(channel).capabilities,
    });
    assert.match(html, /A copy is with us, waiting for a person to look at it/, 'the held state is named');
    assert.match(html, /destroyed the moment somebody\s+records an outcome/, 'and the promise is on the page');
    assert.match(html, new RegExp(`${HOLD_DAYS} days`), 'with the number the sweep enforces');
    assert.match(html, /opened 2 times/, 'the seller sees that somebody looked');
    assert.match(html, /camera's own notes[\s\S]{0,60}removed[\s\S]{0,40}before (it|the\s+file) (is|was) stored/,
      'the metadata rule is stated, not implied');
    // `\s+` rather than a space: the sentence is wrapped in the template, and a test
    // that fails on where a line breaks is a test that gets weakened later.
    assert.match(html, /photograph\s+that screen/, 'and the limit of what this can promise is admitted');
    // Nothing on the page may promise a bigger guarantee than the code can keep.
    for (const puff of ['bank-level', 'fully encrypted end-to-end', 'nobody will ever']) {
      assert.ok(!html.toLowerCase().includes(puff), `the page must not claim: ${puff}`);
    }

    // And the state after the sweep: the copy is gone, the request is not.
    await query(`update seller_verifications set document_key = null, document_bytes = null,
                        document_mime = null, document_destroyed_at = now()
                  where channel_id = $1`, [channel.id]);
    await storage.remove(key);
    const after = views.storeSettings({
      channel, user: { id: owner.id, email: owner.email, display_name: owner.display_name },
      plan: store.plan(channel), verification: null,
      pendingRequest: { ...(await store.pendingVerificationFor(channel.id)), opens: 1 },
      stats: {}, subscription: null, capabilities: store.plan(channel).capabilities,
    });
    assert.match(after, /The copy is gone/, 'the panel says it went');
    assert.match(after, /Hand another one over if the request is still open/, 'and offers the way to send another');
  } finally {
    await cleanup(channel, owner);
  }
});

test('the console is told who will know it opened the document', async () => {
  const { owner, channel } = await fixture();
  let key = null;
  try {
    await store.askForVerification({ channelId: channel.id, note: 'call after six' });
    key = await storage.put(stripMetadata(jpegWithExif(), 'image/jpeg'), 'document.jpg', { namespace: 'kyc' });
    await store.attachVerificationDocument({ channelId: channel.id, key, mime: 'image/jpeg', bytes: 2048 });
    const open = { ...(await store.pendingVerificationFor(channel.id)), opens: 0 };

    const html = views.adminStoreDetail({
      data: {
        channel: { id: channel.id, slug: channel.slug, name: channel.name, owner_email: owner.email, listing_mode: 'storefront' },
        files: [], reports: [], invoice: null, history: [],
      },
      user: { id: owner.id, email: owner.email, display_name: owner.display_name, role: 'admin' },
      verification: null, verifications: [], pendingRequest: open,
    });
    assert.match(html, /A copy is here, waiting for a person/, 'the queue says a document is waiting');
    assert.match(html, new RegExp(`/admin/verification/${open.id}/document`), 'and links to the reader');
    assert.match(html, /writes your name and the time into the audit log/,
      'the operator is told the open is recorded before they open it');
    assert.match(html, /destroyed the moment an outcome is recorded/, 'and that the decision destroys it');
    assert.match(html, /there is no copy anywhere else to keep/, 'including that no thumbnail lives on this page');
    assert.doesNotMatch(html, /<img[^>]*document/, 'the picture is not rendered inline: an open is a decision, not a scroll');
  } finally {
    await cleanup(channel, owner, [key]);
  }
});
