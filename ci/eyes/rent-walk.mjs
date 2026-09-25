/**
 * Annual rent, walked end to end in a browser.
 *
 * Rent is the second of the two things bytebikri charges for, and the only one whose
 * amount is arithmetic on traffic rather than a published price. So the claim that
 * matters is not "the seller can pay" — it is "the seller can CHECK", and the whole
 * flow has to survive four separate people's worth of reading:
 *
 *   1. the seller opens billing and finds an invoice that shows its own working —
 *      trailing views, how many slots are on the page, how many of them rent, the
 *      assumed rate — with the amount that working produces;
 *   2. she sends a transfer and submits the reference through the real form, and the
 *      page says what that did and did NOT do (nothing changes until a person matches
 *      it; rent does not touch her plan);
 *   3. the operator's queue shows the same reference beside the same amount, and
 *      "Mark paid" is the only action a match needs;
 *   4. her page says Paid, and the row in her own history agrees.
 *
 * This is the last money path on the platform that had never been walked, and the
 * reason it had not is that it needs three things at once: a paid plan with enough
 * slots for a platform position, traffic above the floor that bills, and the
 * channel's anniversary. The dev fixture has all three (Alice's store, 2 store slots
 * + 1 platform slot, ~380 views in 30 days → NPR 36 for the year).
 *
 *   node ci/demo-state.mjs
 *   node ci/eyes/reset-rent.mjs alice
 *   node ci/eyes/rent-walk.mjs
 *
 * Run it from the repository root, as the README says. The reset is separate for the
 * same reason `member-walk` needs one: a walk that resets its own subject can pass
 * without ever leaving the state it started in.
 */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { open, walk, sessionFor, consent } from './lib.mjs';

const SLUG = process.argv[2] || 'alice';
const OUT = process.argv[3] || 'docs/evidence/round36';
const BASE = process.env.EYES_BASE || 'http://127.0.0.1:3000';
mkdirSync(OUT, { recursive: true });

const say = (n, s) => console.log(`\n[${n}] ${s}`);
const REF = `RENT-WALK-${Date.now()}`;

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/tmp/chromium', args: ['--no-sandbox'],
});

/** A page, signed in, with console errors collected. */
async function pageFor(who) {
  const state = who ? await sessionFor(browser, who, { base: BASE }) : null;
  const { ctx, p } = await open(browser, { width: 1440, height: 1000, storageState: state });
  p.errors = [];
  p.on('console', (m) => { if (m.type() === 'error') p.errors.push(m.text().slice(0, 160)); });
  p.on('pageerror', (e) => p.errors.push(`PAGEERROR ${e.message.slice(0, 160)}`));
  return { ctx, p };
}

/** The rent panel's state, as the seller reads it. */
const rentState = (p) => p.evaluate(() => {
  const head = [...document.querySelectorAll('.panel-head h2')]
    .find((h) => /Rent for the platform slot/.test(h.textContent));
  const panel = head?.closest('.panel');
  if (!panel) return { present: false };
  const amount = panel.querySelector('.amount-line');
  const form = panel.querySelector('form[action$="/rent-payment"]');
  const note = panel.querySelector('.note');
  const historyRow = [...document.querySelectorAll('table.table tbody tr')]
    .find((tr) => /^\s*Rent/.test(tr.textContent));
  return {
    present: true,
    status: panel.querySelector('.pill')?.textContent.trim() ?? null,
    period: amount?.querySelector('span')?.textContent.trim() ?? null,
    amount: amount?.querySelector('strong')?.textContent.trim() ?? null,
    working: [...panel.querySelectorAll('.kv dt')].map((dt) => dt.textContent.trim()),
    note: note ? note.textContent.replace(/\s+/g, ' ').trim().slice(0, 140) : null,
    form: form ? {
      action: form.getAttribute('action'),
      invoiceId: form.querySelector('input[name="invoiceId"]')?.value || null,
      reference: Boolean(form.querySelector('input[name="txnReference"]')),
    } : null,
    history: historyRow ? historyRow.textContent.replace(/\s+/g, ' ').trim().slice(0, 120) : null,
  };
});

const shotOf = async (p, selector, name, { full = false } = {}) => {
  if (selector && await p.locator(selector).count()) {
    await p.locator(selector).first().scrollIntoViewIfNeeded();
    await p.waitForTimeout(350);
  }
  await p.screenshot({ path: `${OUT}/${name}.png`, fullPage: full });
};

try {
  // ── 1. the seller's invoice ────────────────────────────────────────────────
  say(1, 'the invoice shows its own working, and the amount that working produces');
  const alice = await pageFor('alice');
  await alice.p.goto(`${BASE}/dashboard/${SLUG}/billing`);
  await consent(alice.p);
  await walk(alice.p);
  const before = await rentState(alice.p);
  console.log('  the invoice   :', JSON.stringify(before));
  if (!before.present) throw new Error('the seller’s billing page has no rent panel');
  if (before.status !== 'issued') {
    throw new Error(`the invoice is ${before.status}, not issued — run ci/eyes/reset-rent.mjs ${SLUG}`);
  }
  if (!before.amount || !/NPR/.test(before.amount)) throw new Error(`no amount on the invoice: ${before.amount}`);
  if (!/issued/.test(before.status)) throw new Error('the invoice does not say what it is waiting for');
  if (!before.form?.reference) throw new Error('an issued invoice with no way to submit a reference');
  if (!before.form.invoiceId) throw new Error('the form does not name the invoice it pays');
  for (const row of ['Traffic', 'Slots on your pages', 'Platform slot', 'Assumed ad rate']) {
    if (!before.working.includes(row)) throw new Error(`the working is missing “${row}”`);
  }
  const invoiceId = before.form.invoiceId;
  await shotOf(alice.p, 'form[action$="/rent-payment"]', 'rent-1-invoice');

  // ── 2. the reference she sends ─────────────────────────────────────────────
  say(2, 'she submits the transfer reference, and the page says what that did not do');
  await alice.p.selectOption('#m-rent', 'esewa');
  await alice.p.fill('#r-rent', REF);
  await alice.p.fill('#n-rent', 'Alice Sharma');
  await Promise.all([
    alice.p.waitForURL((u) => u.searchParams.get('rent_submitted') === '1', { timeout: 20_000 }),
    alice.p.click('form[action$="/rent-payment"] button[type="submit"]'),
  ]);
  await walk(alice.p);
  const sent = await rentState(alice.p);
  const flash = await alice.p.locator('.note[role="status"]').first().textContent().catch(() => '');
  console.log('  after sending :', JSON.stringify({ ...sent, flash: flash.replace(/\s+/g, ' ').trim().slice(0, 160) }));
  if (sent.status !== 'submitted') throw new Error(`the invoice did not record the reference: ${sent.status}`);
  if (sent.form) throw new Error('the form is still there for a reference that was sent — it can be sent twice');
  if (!sent.note?.includes('Reference received')) throw new Error(`no note about the reference: ${sent.note}`);
  if (!sent.note.includes(REF)) throw new Error('the page does not show the reference an operator will match');
  // The sentence this page has to carry, because the rail is manual: nothing is paid
  // until a person matches it, and the thing being paid is the PLATFORM's invoice, not
  // a plan. The old sentence was the plan flow's — "your plan changes when it clears" —
  // and it was rendered here too, because both routes reported `?submitted=1`.
  if (!/marked paid when it clears/.test(flash)) {
    throw new Error(`the flash does not say when the invoice clears: ${flash}`);
  }
  if (/your plan changes/.test(flash)) {
    throw new Error(`the flash after a rent submission promises a plan change: ${flash}`);
  }
  if (!/Rent buys no capability/.test(flash)) {
    throw new Error(`the flash does not say what rent is not: ${flash}`);
  }
  await shotOf(alice.p, '.panel:has(h2:text("Rent for the platform slot"))', 'rent-2-reference');

  // ── 3. the operator's queue, and the match ────────────────────────────────
  say(3, 'the operator sees the same reference and the same amount, and marks it paid');
  const op = await pageFor('operator');
  await op.p.goto(`${BASE}/admin/payments`);
  await consent(op.p);
  await walk(op.p);
  const rowForm = `form[action="/admin/payments/rent/${invoiceId}"]`;
  await op.p.locator(rowForm).first().waitFor({ timeout: 10_000 });
  const queued = await op.p.evaluate((id) => {
    const form = document.querySelector(`form[action="/admin/payments/rent/${id}"]`);
    const row = form?.closest('tr');
    return { row: row?.textContent.replace(/\s+/g, ' ').trim().slice(0, 160) ?? null,
      button: form?.querySelector('button')?.textContent.trim() ?? null };
  }, invoiceId);
  console.log('  in the queue  :', JSON.stringify(queued));
  if (!queued.row?.includes(REF)) throw new Error('the operator’s queue does not carry the reference');
  if (queued.button !== 'Mark paid') throw new Error(`the queue’s only action is “${queued.button}”`);
  await shotOf(op.p, rowForm, 'rent-3-queue');

  await Promise.all([
    op.p.waitForURL((u) => /\/admin\/payments$/.test(u.pathname), { timeout: 20_000 }),
    op.p.locator(rowForm).first().locator('button').click(),
  ]);
  await walk(op.p);
  const stillQueued = await op.p.locator(rowForm).count();
  console.log('  after the match:', JSON.stringify({ rowsLeftForThisInvoice: stillQueued }));
  if (stillQueued) throw new Error('a paid invoice is still sitting in the open queue');
  await shotOf(op.p, 'table.table', 'rent-4-matched', { full: true });

  // ── 4. what the seller sees now ────────────────────────────────────────────
  say(4, 'her page says paid, and her own history agrees');
  await alice.p.goto(`${BASE}/dashboard/${SLUG}/billing`);
  await walk(alice.p);
  const paid = await rentState(alice.p);
  console.log('  after clearing:', JSON.stringify({ status: paid.status, note: paid.note, history: paid.history }));
  if (paid.status !== 'paid') throw new Error(`the seller’s page still reads ${paid.status}`);
  if (paid.form) throw new Error('the paying form is still offered on a paid invoice');
  if (!/\bPaid\b/.test(paid.note || '')) throw new Error(`no paid note: ${paid.note}`);
  if (!paid.history || !/paid/.test(paid.history)) throw new Error('her history row does not agree that it was paid');
  await shotOf(alice.p, '.panel:has(h2:text("Rent for the platform slot"))', 'rent-5-paid');

  const errors = [...alice.p.errors, ...op.p.errors].filter((e) => !/favicon/.test(e));
  console.log('\nconsole errors:', errors.length ? JSON.stringify(errors, null, 1) : 'none');
  if (errors.length) throw new Error(`${errors.length} console error(s)`);
  console.log(`\nrent walked — invoice ${invoiceId.slice(0, 8)}, reference ${REF}, 5 screenshots in ${OUT}`);
  await alice.ctx.close();
  await op.ctx.close();
  process.exit(0);
} catch (err) {
  console.error(`\nRENT WALK FAILED: ${err.message}`);
  process.exit(1);
} finally {
  await browser.close();
}
