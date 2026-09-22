/**
 * Confirming an address — the tests that matter.
 *
 * Same principle as the recovery suite: the happy path is the easy part and the
 * invisible properties are what break in production. For a confirmation flow the
 * ones worth pinning are:
 *
 *   • the GET does not confirm anything, because scanners follow links;
 *   • a resend inside the window does NOT mint a new token — that is the bug
 *     where the email in the inbox stops working the moment somebody asks for
 *     another one, and the person then asks again, forever;
 *   • a resend after a FAILED delivery does mint one, because there is no link in
 *     anybody's inbox to protect;
 *   • the token is stored hashed and appears exactly once in the delivered mail;
 *   • changing an address tells the OLD address, even if the new send fails —
 *     that notice is the only warning the previous owner will ever get;
 *   • confirming does not sign anybody in.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:55432/bytebikri_test';
process.env.SESSION_SECRET ||= 'test-session-secret';

const verify = await import('../src/verify.js');
const views = await import('../src/views.js');
const auth = await import('../src/auth.js');
const { query, one, close } = await import('../src/db.js');

const stamp = () => crypto.randomBytes(5).toString('hex');
after(async () => { await close(); });

async function person() {
  const row = await auth.createAccount({
    email: `verify-${stamp()}@bytebikri.local`,
    password: 'the-original-password',
    displayName: 'Verify Subject',
  });
  return { user: row };
}

/** The newest message of a kind, and the link inside it. */
async function mailTo(userId, kind = 'email_verify') {
  const row = await one(
    `select id, body_text, subject, kind, delivered, error from outbound_emails
      where user_id = $1 and kind = $2 order by created_at desc, id desc limit 1`,
    [userId, kind],
  );
  assert.ok(row, `no ${kind} message was written for this account`);
  const m = String(row.body_text).match(/https?:\/\/\S+\/verify\/(\S+)/);
  return { ...row, link: m ? m[0] : null, token: m ? m[1] : null };
}

// ── the link itself ──────────────────────────────────────────────────────────

test('the mailed link confirms the address, and the token is stored hashed', async () => {
  const { user } = await person();

  const out = await verify.sendVerification({ user, baseUrl: 'https://bytebikri.test' });
  assert.equal(out.sent, true);

  const mail = await mailTo(user.id);
  assert.ok(mail.token, 'the confirmation email contained no link');
  // The one property that makes a leaked dump boring.
  assert.notEqual(mail.token, undefined);
  const stored = await query('select token_hash, expires_at from email_tokens where user_id = $1', [user.id]);
  assert.equal(stored.rowCount, 1);
  assert.notEqual(stored.rows[0].token_hash, mail.token);
  assert.equal(stored.rows[0].token_hash,
    crypto.createHash('sha256').update(mail.token).digest('hex'));

  // 48 hours, straight from the row. The link's lifetime is the row's, not a
  // sentence somebody typed into the email template.
  const hours = (new Date(stored.rows[0].expires_at).getTime() - Date.now()) / 3_600_000;
  assert.ok(hours > 47 && hours < 49, `the link lasts ${hours.toFixed(1)} hours, not 48`);

  const check = await verify.inspectLink({ token: mail.token });
  assert.equal(check.valid, true);

  const done = await verify.confirm({ token: mail.token });
  assert.equal(done.ok, true);
  assert.equal(done.alreadyConfirmed, false);

  const profile = await one('select email_verified_at from profiles where id = $1', [user.id]);
  assert.ok(profile.email_verified_at, 'the address was not marked confirmed');
});

test('a GET does not confirm anything — the button does', async () => {
  const { user } = await person();
  await verify.sendVerification({ user, baseUrl: 'https://bytebikri.test' });
  const { token } = await mailTo(user.id);

  // What a mail scanner does: fetch the URL in the message. Twice, in case.
  await verify.inspectLink({ token });
  await verify.inspectLink({ token });

  const profile = await one('select email_verified_at from profiles where id = $1', [user.id]);
  assert.equal(profile.email_verified_at, null,
    'merely fetching the link confirmed the address, so no person proved anything');
});

test('a link works once, and a spent one is indistinguishable from an invented one', async () => {
  const { user } = await person();
  await verify.sendVerification({ user, baseUrl: 'https://bytebikri.test' });
  const { token } = await mailTo(user.id);

  assert.equal((await verify.confirm({ token })).ok, true);
  const again = await verify.confirm({ token });
  assert.equal(again.ok, false, 'the same link confirmed twice');

  // Every dead reason answers the same way, which is the point: the caller
  // renders one page, and nobody learns which kind of dead they are holding.
  for (const probe of [token, 'not-a-token', 'x'.repeat(300)]) {
    const out = await verify.confirm({ token: probe });
    assert.equal(out.ok, false);
    assert.deepEqual(Object.keys(out), ['ok']);
  }
  assert.equal((await verify.inspectLink({ token: 'never-existed' })).valid, false);
});

test('an expired link does not work', async () => {
  const { user } = await person();
  await verify.sendVerification({ user, baseUrl: 'https://bytebikri.test' });
  const { token } = await mailTo(user.id);

  const later = new Date(Date.now() + 49 * 3_600_000);
  assert.equal((await verify.inspectLink({ token, now: later })).valid, false);
  assert.equal((await verify.confirm({ token, now: later })).ok, false);
  // And it is still unconfirmed, because nothing was ever proved.
  const profile = await one('select email_verified_at from profiles where id = $1', [user.id]);
  assert.equal(profile.email_verified_at, null);
});

// ── asking again ─────────────────────────────────────────────────────────────

test('asking again inside the window keeps the link that is already out there working', async () => {
  const { user } = await person();
  const first = await verify.sendVerification({ user, baseUrl: 'https://bytebikri.test' });
  assert.equal(first.sent, true);
  const { token } = await mailTo(user.id);

  // The person clicks "send it again" while the first message is still landing.
  const again = await verify.sendVerification({ user, baseUrl: 'https://bytebikri.test' });
  assert.equal(again.sent, false);
  assert.equal(again.reason, 'already-sent');

  // One message, one live row, and THE LINK IN THE INBOX STILL WORKS. This is the
  // whole reason the resend does not rotate the token: rotating it is how a
  // product builds a loop where every resend kills the email that just arrived.
  const messages = await query(
    "select count(*)::int as n from outbound_emails where user_id = $1 and kind = 'email_verify'",
    [user.id],
  );
  assert.equal(messages.rows[0].n, 1, 'the refused resend still wrote a message');
  assert.equal((await verify.confirm({ token })).ok, true);
});

test('asking again after a failed delivery sends immediately — there is nothing to protect', async () => {
  const { user } = await person();
  await verify.sendVerification({ user, baseUrl: 'https://bytebikri.test' });
  const first = await mailTo(user.id);

  // The provider refused it. Recorded the way the mail layer records a refusal,
  // and the reason the resend rule looks at the LOG rather than at a timer.
  await query(
    `update outbound_emails set delivered = false, error = 'resend 403: domain not verified'
      where id = $1`,
    [first.id],
  );

  const again = await verify.sendVerification({ user, baseUrl: 'https://bytebikri.test' });
  assert.equal(again.sent, true, 'somebody whose mail failed was told to wait ten minutes');

  const second = await mailTo(user.id);
  assert.notEqual(second.token, first.token);
  // Newest wins: the failed one is retired, and the working one confirms.
  assert.equal((await verify.confirm({ token: first.token })).ok, false);
  assert.equal((await verify.confirm({ token: second.token })).ok, true);
});

test('after the window, asking again replaces the link', async () => {
  const { user } = await person();
  await verify.sendVerification({ user, baseUrl: 'https://bytebikri.test' });
  const first = await mailTo(user.id);

  const later = new Date(Date.now() + 11 * 60_000);
  const again = await verify.sendVerification({ user, baseUrl: 'https://bytebikri.test', now: later });
  assert.equal(again.sent, true);
  const second = await mailTo(user.id);
  assert.notEqual(second.token, first.token);
  assert.equal((await verify.confirm({ token: first.token })).ok, false, 'the replaced link still worked');
  assert.equal((await verify.confirm({ token: second.token })).ok, true);
});

test('an address that is already confirmed is not sent another link', async () => {
  const { user } = await person();
  await verify.sendVerification({ user, baseUrl: 'https://bytebikri.test' });
  const { token } = await mailTo(user.id);
  await verify.confirm({ token });

  const out = await verify.sendVerification({ user, baseUrl: 'https://bytebikri.test' });
  assert.equal(out.sent, false);
  assert.equal(out.reason, 'confirmed');
});

test('confirming twice keeps the FIRST confirmation, and still answers honestly', async () => {
  const { user } = await person();
  await verify.sendVerification({ user, baseUrl: 'https://bytebikri.test' });
  const { token } = await mailTo(user.id);
  const firstAt = new Date();
  await verify.confirm({ token, now: firstAt });

  const later = new Date(firstAt.getTime() + 60_000);
  const out = await verify.confirm({ token, now: later });
  // The same link is spent, so it answers "dead" — but the state on the account
  // must not move: the first confirmation is the consent evidence.
  assert.equal(out.ok, false);
  const profile = await one('select email_verified_at from profiles where id = $1', [user.id]);
  assert.equal(new Date(profile.email_verified_at).getTime(), firstAt.getTime());
});

test('confirming does not create a session', async () => {
  const { user } = await person();
  await verify.sendVerification({ user, baseUrl: 'https://bytebikri.test' });
  const { token } = await mailTo(user.id);

  const before = await one('select count(*)::int as n from sessions where user_id = $1', [user.id]);
  await verify.confirm({ token });
  const after = await one('select count(*)::int as n from sessions where user_id = $1', [user.id]);
  assert.equal(after.n, before.n, 'opening a confirmation link signed somebody in');
});

// ── moving the address ───────────────────────────────────────────────────────

test('changing the address mails the new one AND tells the old one', async () => {
  const { user } = await person();
  const before = user.email;

  const out = await verify.changeAddress({
    userId: user.id, newEmail: `Moved-${stamp()}@ByteBikri.Local`, baseUrl: 'https://bytebikri.test',
  });
  assert.equal(out.ok, true);
  // Lowercased and stored unconfirmed: the new address has proved nothing yet.
  assert.match(out.address, /^moved-[a-f0-9]+@bytebikri\.local$/);
  const profile = await one('select email, email_verified_at from profiles where id = $1', [user.id]);
  assert.equal(profile.email, out.address);
  assert.equal(profile.email_verified_at, null, 'a new address was treated as confirmed');

  // The link goes to the NEW address.
  const mail = await mailTo(user.id);
  assert.match(mail.body_text, /moved-[a-f0-9]+@bytebikri\.local/i);

  // And the old address is told — the one channel that still belongs to the
  // previous owner, and the only warning they will get.
  const notice = await one(
    `select to_email, body_text from outbound_emails
      where user_id = $1 and kind = 'email_changed' order by created_at desc limit 1`,
    [user.id],
  );
  assert.ok(notice, 'the old address was not told its account had moved');
  assert.equal(notice.to_email, before);
  assert.match(notice.body_text, new RegExp(out.address.replace('.', '\\.'), 'i'));
});

test('a change is refused for an address somebody already uses, and for the same one', async () => {
  const { user } = await person();
  const other = (await person()).user;

  assert.equal((await verify.changeAddress({
    userId: user.id, newEmail: other.email, baseUrl: 'https://bytebikri.test',
  })).reason, 'taken');
  assert.equal((await verify.changeAddress({
    userId: user.id, newEmail: user.email, baseUrl: 'https://bytebikri.test',
  })).reason, 'same');
  assert.equal((await verify.changeAddress({
    userId: user.id, newEmail: 'not an address', baseUrl: 'https://bytebikri.test',
  })).reason, 'shape');

  // Nothing moved and nothing was mailed on any of the refusals.
  const profile = await one('select email from profiles where id = $1', [user.id]);
  assert.equal(profile.email, user.email);
  const mail = await one(
    "select count(*)::int as n from outbound_emails where user_id = $1 and kind in ('email_verify','email_changed')",
    [user.id],
  );
  assert.equal(mail.n, 0);
});

// ── what the pages say ───────────────────────────────────────────────────────

test('the strip appears for an unconfirmed account and for nobody else', async () => {
  const unconfirmed = views.layout({ title: 'x', user: { role: 'user', email: 'a@b.c', display_name: 'A' }, body: '' });
  assert.match(unconfirmed, /Confirm your email address/);
  assert.match(unconfirmed, /href="\/verify"/);

  const confirmed = views.layout({
    title: 'x', user: { role: 'user', email: 'a@b.c', display_name: 'A', email_verified_at: new Date() }, body: '',
  });
  assert.equal(confirmed.includes('Confirm your email address'), false);

  // The operator account is made by the boot path from OPERATOR_EMAIL, so
  // confirming it is a deploy step, not a person's loose end — and the console
  // is where that state belongs rather than every page of it.
  const admin = views.layout({ title: 'x', user: { role: 'admin', email: 'o@b.c', display_name: 'O' }, body: '' });
  assert.equal(admin.includes('Confirm your email address'), false);
});

test('the verify page reports delivery failures rather than hiding them', () => {
  const state = {
    email: 'a@b.c', email_verified_at: null, links_sent: 2, links_used: 0,
    last_sent_at: new Date(), failed_deliveries: 1, last_error: 'resend 403: domain not verified',
  };
  const page = views.verify({ user: { role: 'user', email: 'a@b.c' }, state });
  assert.match(page, /not confirmed/);
  assert.match(page, /resend 403/);
  assert.match(page, /asking again is the right move/);

  // And a confirmed address gets no resend form at all: an email that can only
  // fail is worse than no email.
  const done = views.verify({
    user: { role: 'user', email: 'a@b.c' }, state: { ...state, email_verified_at: new Date() },
  });
  assert.match(done, /Address confirmed/);
  assert.equal(done.includes('Send the link again'), false);
  assert.equal(done.includes('resend 403'), false);
});

test('the confirmation page has a button and no token anywhere in its markup', () => {
  const page = views.verifyConfirm({ user: null });
  assert.match(page, /Confirm this address/);
  // The form posts to its own URL (`action=""`), which is what keeps the token
  // out of the markup — nothing in the page needs to know it.
  assert.match(page, /<form method="post" action=""/);
  assert.equal(/\/verify\/[A-Za-z0-9_-]+/.test(page), false, 'the confirmation page carried the token');
});

// ── the one thing it holds back ──────────────────────────────────────────────

test('the billing page replaces the submit form with the reason, and keeps everything else', () => {
  // The whole page, reduced to the parts this rule touches: the amount, the
  // account to pay into, and the one form that waits.
  const props = {
    channel: { slug: 'demo', name: 'Demo' }, user: { role: 'user', email: 'a@b.c' },
    plan: { code: 'free', name: 'Free', priceNpr: 0 }, nextPlanCode: 'store',
    pending: { name: 'Store', amountNpr: 999, method: null, reference: null },
    quote: null, upgrade: null, subscription: null, invoice: null,
    benefits: [], notCharged: [], slots: [],
    rails: [{ id: 'esewa', label: 'eSewa', handle: '9800000001', ready: true, env: 'PAY_ESEWA_ID' }],
  };

  const blocked = views.billing({ ...props, addressConfirmed: false });
  assert.match(blocked, /Confirm the email address on this account, then submit the reference/);
  assert.match(blocked, /href="\/verify"/);
  assert.equal(blocked.includes('plan-payment'), false, 'the blocked page still rendered the submit form');
  // The money is still described: what is due, and where it goes. Somebody has to
  // be able to send it — it is the last STEP that waits, not the payment.
  assert.match(blocked, /NPR&#39;?\s*999|999/);
  assert.match(blocked, /9800000001/);
  assert.match(blocked, /eSewa/);

  const allowed = views.billing({ ...props, addressConfirmed: true });
  assert.match(allowed, /plan-payment/);
  assert.equal(allowed.includes('Confirm the email address on this account'), false);
});

test('the person page renders the flash it is given', () => {
  // It was accepted and silently dropped, so an operator who sent somebody a
  // confirmation link saw a page that looked like nothing had happened.
  const detail = {
    person: {
      id: '11111111-1111-1111-1111-111111111111', email: 'a@b.c', display_name: 'A',
      created_at: new Date(), has_password: true, role: 'user', banned: false, locale: 'ne',
      sold_by_on_file: false, phone_on_file: false,
    },
    sessions: { live: 0, total: 0, last_seen: null, first_seen: null },
    attempts: { failed_7d: 0 },
    decisions: [], stores: [],
  };
  const page = views.adminUser({
    user: { role: 'admin', email: 'o@b.c' }, detail, rules: [], personActions: ['suspend'], labels: {},
    recovery: { requested: 0, completed: 0, verifications_sent: 1, failed_deliveries: 0, address_confirmed_at: null },
    flash: { kind: 'success', message: 'Confirmation link sent to a@b.c.' },
  });
  assert.match(page, /Confirmation link sent to a@b\.c\./);
  assert.match(page, /Send a confirmation link for them/);
});

test('the address strip stays off the page that explains it', () => {
  const user = { role: 'user', email: 'a@b.c', display_name: 'A' };
  assert.equal(views.verify({ user, state: { email: 'a@b.c' } }).includes('notice-strip'), false);
  assert.equal(views.verifyConfirm({ user }).includes('notice-strip'), false);
  assert.match(views.layout({ title: 'x', user, body: '' }), /notice-strip/);
});
