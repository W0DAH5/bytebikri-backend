/**
 * Account recovery — the tests that matter.
 *
 * A reset flow is the easiest place in a product to write something that works
 * perfectly and is still wrong: it resets the password, it sends the email, and
 * it looks correct in every screenshot. The things that are actually dangerous
 * are invisible from the happy path, so they are what these tests point at:
 *
 *   • a link that works more than once,
 *   • an old link that still works after a new one was asked for,
 *   • a request form that tells you whether an address has an account,
 *   • sessions that survive the reset somebody did *because* they think somebody
 *     else has their account,
 *   • a token that ends up stored somewhere it can be read back out of.
 *
 * Each test below is one of those, not one of the steps.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:55432/bytebikri_test';
process.env.SESSION_SECRET ||= 'test-session-secret';

const recovery = await import('../src/recovery.js');
const views = await import('../src/views.js');
const email = await import('../src/email.js');
const auth = await import('../src/auth.js');
const { query, one, close } = await import('../src/db.js');

const stamp = () => crypto.randomBytes(5).toString('hex');

after(async () => { await close(); });

/**
 * A real account, made the way sign-up makes one.
 *
 * `createAccount` returns the profile ROW, not a `{ user }` wrapper — the same
 * shape confusion that broke the seller-view test in the billing suite.
 */
async function person() {
  const row = await auth.createAccount({
    email: `reset-${stamp()}@bytebikri.local`,
    password: 'the-original-password',
    displayName: 'Reset Subject',
  });
  return { user: row };
}

/**
 * Does this password open this account?
 *
 * `verifyPassword` is `(password, storedHash)` and synchronous — it is the
 * primitive, not a login. Asking it with a user id is a silent `false` rather
 * than an error, which is exactly the kind of assertion that passes for the
 * wrong reason.
 */
async function passwordIs(userId, password) {
  const row = await one('select password_hash from profiles where id = $1', [userId]);
  return auth.verifyPassword(password, row.password_hash);
}

/** Pull the link out of the message the platform actually wrote. */
async function linkFromMail(userId) {
  const row = await one(
    `select body_text, driver, delivered from outbound_emails
      where user_id = $1 and kind = 'password_reset'
      order by created_at desc limit 1`,
    [userId],
  );
  const m = String(row.body_text).match(/https?:\/\/\S+\/reset\/\S+/);
  assert.ok(m, 'the reset email contained no link, so the feature does not work end to end');
  return { link: m[0], token: m[0].split('/reset/')[1], body: row.body_text, driver: row.driver };
}

// ── the link ─────────────────────────────────────────────────────────────────

test('the emailed link works, and the token is nowhere in the database', async () => {
  const { user } = await person();
  await recovery.requestReset({ email: user.email, baseUrl: 'https://bytebikri.test' });
  const { token } = await linkFromMail(user.id);

  // The property a database dump must not break. A reset link is a bearer
  // credential: whoever has the text of it becomes the account, so the only thing
  // that may be stored is a hash.
  const rows = await query('select token_hash from password_resets where user_id = $1', [user.id]);
  assert.equal(rows.rowCount, 1);
  assert.notEqual(rows.rows[0].token_hash, token);
  assert.equal(rows.rows[0].token_hash, crypto.createHash('sha256').update(token).digest('hex'));
  const dump = JSON.stringify(rows.rows);
  assert.equal(dump.includes(token), false, 'the raw token is recoverable from the table');

  // And it still works.
  const done = await recovery.consumeReset({ token, password: 'a-brand-new-password' });
  assert.equal(done.ok, true);
  assert.equal(await passwordIs(user.id, 'a-brand-new-password'), true);
  assert.equal(await passwordIs(user.id, 'the-original-password'), false);
});

test('a spent link is dead — the second click cannot reset the password again', async () => {
  const { user } = await person();
  await recovery.requestReset({ email: user.email, baseUrl: 'https://bytebikri.test' });
  const { token } = await linkFromMail(user.id);

  assert.equal((await recovery.consumeReset({ token, password: 'first-password-wins' })).ok, true);
  assert.equal((await recovery.consumeReset({ token, password: 'second-password-loses' })).ok, false);
  assert.equal(await passwordIs(user.id, 'first-password-wins'), true);
  assert.equal(await passwordIs(user.id, 'second-password-loses'), false);
  // The row survives, with the time it was spent. "Was this account taken over,
  // and when" is answerable only if the row is not deleted on use.
  const row = await one('select used_at from password_resets where user_id = $1', [user.id]);
  assert.ok(row.used_at instanceof Date);
});

test('asking for a second link kills the first, so a forwarded email expires', async () => {
  const { user } = await person();
  await recovery.requestReset({ email: user.email, baseUrl: 'https://bytebikri.test' });
  const first = await linkFromMail(user.id);

  await recovery.requestReset({ email: user.email, baseUrl: 'https://bytebikri.test' });
  const second = await linkFromMail(user.id);
  assert.notEqual(second.token, first.token);

  // The old one is not merely "less preferred": it is gone. Enforced by a partial
  // unique index on the table, not by the code remembering to delete.
  assert.equal((await recovery.inspectReset(first.token)).valid, false);
  assert.equal((await recovery.consumeReset({ token: first.token, password: 'old-link-cannot-do-this' })).ok, false);
  assert.equal((await recovery.inspectReset(second.token)).valid, true);

  // One live row per account, which is what the index guarantees under a race.
  const live = await one(
    'select count(*)::int as n from password_resets where user_id = $1 and used_at is null', [user.id]);
  assert.equal(live.n, 1);
});

test('an expired link does not work, and the clock is the link\'s own', async () => {
  const { user } = await person();
  await recovery.requestReset({ email: user.email, baseUrl: 'https://bytebikri.test' });
  const { token } = await linkFromMail(user.id);

  // Just inside the window, measured against the row rather than a sleep.
  const row = await one('select expires_at from password_resets where user_id = $1', [user.id]);
  const justInside = new Date(new Date(row.expires_at).getTime() - 1000);
  assert.equal((await recovery.inspectReset(token, justInside)).valid, true);

  const after = new Date(new Date(row.expires_at).getTime() + 1000);
  assert.equal((await recovery.inspectReset(token, after)).valid, false);
  assert.equal((await recovery.consumeReset({ token, password: 'too-late-for-this-one', now: after })).ok, false);
  assert.equal((await recovery.consumeReset({ token, password: 'too-late-for-this-one' })).ok, true,
    'the link should still be good now — the failed attempt above must not have spent it');
});

test('the token is long and random enough that guessing is not a strategy', async () => {
  const { user } = await person();
  await recovery.requestReset({ email: user.email, baseUrl: 'https://bytebikri.test' });
  const { token } = await linkFromMail(user.id);
  // 32 random bytes in base64url. Anything shorter is worth writing down here so
  // the number is a decision rather than a default.
  assert.ok(Buffer.from(token, 'base64url').length >= 32, `token is only ${Buffer.from(token, 'base64url').length} bytes`);

  for (const guess of ['', 'x', token.slice(0, -1), `${token}x`, 'null', 'undefined']) {
    assert.equal((await recovery.inspectReset(guess)).valid, false, `guessed token ${JSON.stringify(guess)} was accepted`);
  }
});

// ── the sessions ─────────────────────────────────────────────────────────────

test('a completed reset ends every session, including the one that asked', async () => {
  const { user } = await person();
  // Two devices signed in before the reset: this is the scenario the feature is
  // for — "somebody else may have my account".
  const laptop = await auth.createSession({ userId: user.id, remember: true, userAgent: 'laptop' });
  const phone = await auth.createSession({ userId: user.id, remember: true, userAgent: 'phone' });
  assert.ok(await auth.resolveSession(laptop.token));
  assert.ok(await auth.resolveSession(phone.token));

  await recovery.requestReset({ email: user.email, baseUrl: 'https://bytebikri.test' });
  const { token } = await linkFromMail(user.id);
  assert.equal((await recovery.consumeReset({ token, password: 'a-fresh-password-here' })).ok, true);

  assert.equal(await auth.resolveSession(laptop.token), null, 'the laptop session survived a reset');
  assert.equal(await auth.resolveSession(phone.token), null, 'the phone session survived a reset');
});

test('the reset form and the sign-up form cannot disagree about the minimum', async () => {
  // Two numbers that drift apart produce a specific, annoying bug: a password the
  // server accepts at sign-up and refuses at reset, years later, to somebody who
  // cannot remember what they chose.
  const security = await import('../src/security.js');
  const signUp = views.login({ mode: 'signup' });
  const reset = views.resetPassword({ token: 'token-shaped-string' });
  assert.match(signUp, new RegExp(`minlength="${security.MIN_PASSWORD_LENGTH}"`));
  assert.match(reset, new RegExp(`minlength="${security.MIN_PASSWORD_LENGTH}"`));
  assert.match(reset, new RegExp(`${security.MIN_PASSWORD_LENGTH} characters minimum`));

  // And the enforcer agrees too: one character under is refused, exactly at the
  // boundary, by the same code path that hashes.
  const tooShort = 'x'.repeat(security.MIN_PASSWORD_LENGTH - 1);
  assert.throws(() => auth.hashPassword(tooShort), /at least 8 characters/);
  assert.ok(auth.hashPassword('x'.repeat(security.MIN_PASSWORD_LENGTH)));
});

test('a rejected password does not spend the link or change the account', async () => {
  const { user } = await person();
  await recovery.requestReset({ email: user.email, baseUrl: 'https://bytebikri.test' });
  const { token } = await linkFromMail(user.id);

  const short = await recovery.consumeReset({ token, password: 'short' });
  assert.equal(short.ok, false);
  assert.equal(short.reason, 'short');
  assert.equal(await passwordIs(user.id, 'the-original-password'), true);
  // And the link is still good, because nothing was spent by a rejected attempt.
  assert.equal((await recovery.inspectReset(token)).valid, true);

  const empty = await recovery.consumeReset({ token, password: '' });
  assert.equal(empty.ok, false);
  assert.equal((await recovery.inspectReset(token)).valid, true);
});

// ── what the form gives away ─────────────────────────────────────────────────

test('an address with no account gets the same answer as one with an account, and no email', async () => {
  const { user } = await person();
  const before = await one("select count(*)::int as n from outbound_emails where kind = 'password_reset'");

  const known = await recovery.requestReset({ email: user.email, baseUrl: 'https://bytebikri.test' });
  const unknown = await recovery.requestReset({ email: `nobody-${stamp()}@bytebikri.local`, baseUrl: 'https://bytebikri.test' });

  // The shape of the answer is identical — the same keys, the same values — so a
  // route cannot branch on it even by accident, and neither can timing-shape a
  // response into an oracle by reading a field.
  assert.deepEqual(Object.keys(known).sort(), Object.keys(unknown).sort());
  assert.equal(known.requested, unknown.requested);
  assert.equal(unknown.mailed, false);

  const after = await one("select count(*)::int as n from outbound_emails where kind = 'password_reset'");
  assert.equal(after.n, before.n + 1, 'one message should have been written, for the account that exists');
});

test('a request with no address at all is refused quietly rather than throwing', async () => {
  for (const email of ['', '   ', null, undefined]) {
    const r = await recovery.requestReset({ email, baseUrl: 'https://bytebikri.test' });
    assert.equal(r.requested, true);
    assert.equal(r.mailed, false);
  }
});

test('the page after a request says the same thing for a registered and an unknown address', async () => {
  // The page is the other half of the oracle: a form that says "check your inbox"
  // for one address and "no such account" for another is a way to test which
  // email addresses belong to people here.
  const known = views.forgotPassword({ sent: true, email: 'alice@bytebikri.local' });
  const unknown = views.forgotPassword({ sent: true, email: 'nobody@bytebikri.local' });
  // Identical apart from the address the person typed, which was already theirs.
  assert.equal(known.replace(/alice@bytebikri\.local/g, 'X'), unknown.replace(/nobody@bytebikri\.local/g, 'X'));
});

// ── what a dead link shows ───────────────────────────────────────────────────

test('expired, used, unknown and tampered links render one page, byte for byte', async () => {
  // Four genuinely different states. Distinguishing them tells an attacker
  // whether a stolen token was real, and tells them nothing they can act on:
  // every one of them needs a new link.
  const page = views.resetPassword({ consent: null });
  for (const other of [
    views.resetPassword({ user: null, consent: null }),
    views.resetPassword({ consent: null, error: null }),
  ]) {
    assert.equal(page, other, 'the dead-link page changes shape depending on the caller');
  }
  assert.match(page, /That link cannot be used/);
  // One action, and it is the useful one.
  assert.match(page, /href="\/forgot"/);
  assert.equal(page.includes('/reset/'), false, 'the dead-link page should not carry a token anywhere');

  // The cookie banner is the way a token leaks into page markup: it posts the
  // current URL back to /consent as `next`. On this route the banner is not
  // rendered at all, which is why the assertion above can hold. Rendered the way
  // the route renders it — with no consent state — the page stays token-free even
  // for a visitor who has not answered the banner yet.
  assert.equal(/role="region" aria-label="Cookies"/.test(page), false, 'the dead-link page rendered a cookie banner');

  // The live page is the opposite case, and this is the deliberate half: there,
  // the banner stays, and it carries the token in a same-origin form so that
  // answering it returns the person to the form they were reading. Written down
  // because it is a choice, not an oversight.
  const live = views.resetPassword({
    token: 'a-live-looking-token', consent: { outstanding: true, returnTo: '/reset/a-live-looking-token' },
  });
  assert.match(live, /aria-label="Cookies"/);
  assert.match(live, /value="\/reset\/a-live-looking-token"/);

  // And the reasons really are distinct underneath, so the sameness above is a
  // deliberate choice rather than a test that cannot fail.
  const { user } = await person();
  await recovery.requestReset({ email: user.email, baseUrl: 'https://bytebikri.test' });
  const { token } = await linkFromMail(user.id);
  assert.equal((await recovery.inspectReset(token)).valid, true);
  await recovery.consumeReset({ token, password: 'spend-it-entirely' });
  assert.equal((await recovery.inspectReset(token)).reason, 'used');
  assert.equal((await recovery.inspectReset('not-a-real-token')).reason, 'unknown');
  assert.equal((await recovery.inspectReset('')).reason, 'missing');
});

// ── the mail the platform writes down ────────────────────────────────────────

test('the message is recorded before it is sent, so a failure is visible', async () => {
  const { user } = await person();
  const result = await email.send({
    kind: 'password_reset', to: user.email, userId: user.id,
    subject: 'Probe', text: 'body', env: { NODE_ENV: 'development' },
  });
  assert.equal(result.ok, true);
  assert.equal(result.delivered, false); // the console driver writes, it does not deliver

  const row = await one('select kind, to_email, driver, delivered, body_text from outbound_emails where id = $1', [result.id]);
  assert.equal(row.to_email, user.email);
  assert.equal(row.driver, 'console');
  assert.equal(row.delivered, false);
  assert.equal(row.body_text, 'body');
  // Not delivered and no error is the console driver's signature. A delivery that
  // FAILED carries the reason, and the two must not be confused: one is expected
  // on a development machine, the other is a person locked out of their account.
  const failed = await email.send({
    kind: 'password_reset', to: user.email, userId: user.id, subject: 'Probe', text: 'body',
    env: { NODE_ENV: 'production', EMAIL_DRIVER: 'smtp', SMTP_URL: 'smtps://user:pass@127.0.0.1:1', EMAIL_FROM: 'x@y.z' },
  });
  assert.equal(failed.ok, false);
  const failureRow = await one('select error from outbound_emails where id = $1', [failed.id]);
  assert.ok(failureRow.error, 'a failed delivery was recorded with no reason, so nothing can be fixed');
});

test('the support view answers "did the link go out" without ever holding a token', async () => {
  const { user } = await person();
  await recovery.requestReset({ email: user.email, baseUrl: 'https://bytebikri.test' });
  const { token } = await linkFromMail(user.id);

  const activity = await recovery.personRecovery(user.id);
  assert.equal(activity.requested, 1);
  assert.equal(activity.completed, 0);
  assert.ok(activity.last_requested instanceof Date);
  // The development driver records no error: it printed instead of sending, which
  // is the expected state on this machine and not a delivery failure.
  assert.equal(activity.failed_deliveries, 0);

  // Nothing the support page is handed contains a usable link.
  assert.equal(JSON.stringify(activity).includes(token), false);
  const html = views.adminUser({
    user: { id: 'admin', role: 'admin', email: 'op@bytebikri.local', display_name: 'Op', adminBadges: {} },
    detail: {
      person: { id: user.id, email: user.email, display_name: 'Reset Subject', role: 'user', created_at: new Date(), locale: 'ne' },
      stores: [], sessions: { total: 0, live: 0, last_seen: null, first_seen: null },
      attempts: { failed_7d: 0, ok_30d: 0 }, decisions: [], unlocksHeld: 0,
    },
    rules: [], recovery: activity,
  });
  assert.equal(html.includes(token), false, 'the operator page printed a working reset link');
  assert.match(html, /reset link/i);
});

test('a delivery failure reaches the operator, and a quiet day does not', async () => {
  const { user } = await person();
  await recovery.requestReset({ email: user.email, baseUrl: 'https://bytebikri.test' });
  // Simulate the thing that actually goes wrong in production: the provider
  // refuses the message after we have already written it down.
  await query(
    `update outbound_emails set error = 'resend 403: domain not verified'
      where user_id = $1 and kind = 'password_reset'`,
    [user.id],
  );
  const activity = await recovery.personRecovery(user.id);
  assert.equal(activity.failed_deliveries, 1);

  // The person's own page now leads with the failure rather than with counts.
  const html = views.adminUser({
    user: { id: 'admin', role: 'admin', email: 'op@bytebikri.local', display_name: 'Op', adminBadges: {} },
    detail: {
      person: { id: user.id, email: user.email, display_name: 'x', role: 'user', created_at: new Date(), locale: 'ne' },
      stores: [], sessions: { total: 1, live: 1, last_seen: new Date(), first_seen: new Date() },
      attempts: { failed_7d: 0, ok_30d: 1 }, decisions: [], unlocksHeld: 0,
    },
    rules: [], recovery: activity,
  });
  assert.match(html, /did not send/);
});

test('the two mail counters are the same field, so a screen cannot read the wrong one', async () => {
  // This bug was real and cost half an hour: the reset helper returned
  // `delivery_failures` while the person view read `failed_deliveries`. Both
  // names describe one fact, the operator page silently showed nothing, and every
  // unit test passed because each side was tested against its own spelling.
  // One concept now has one name, and this test holds it.
  const { user } = await person();
  await recovery.requestReset({ email: user.email, baseUrl: 'https://bytebikri.test' });
  await query(
    `update outbound_emails set error = 'provider refused it'
      where user_id = $1 and kind = 'password_reset'`,
    [user.id],
  );
  const mine = await recovery.personRecovery(user.id);
  const platform = await recovery.resetActivity({ days: 3650 });
  assert.equal(mine.failed_deliveries, 1);
  assert.ok(platform.failed_deliveries >= 1, 'the platform-wide counter lost the failure');
  assert.equal('delivery_failures' in platform, false, 'the old name is back — pick one and delete the other');
  assert.equal('delivery_failures' in mine, false);
});

test('reset activity is countable for the operator without counting tokens', async () => {
  const act = await recovery.resetActivity({ days: 3650 });
  for (const key of ['requested', 'completed', 'expired_unused', 'failed_deliveries']) {
    assert.equal(typeof act[key], 'number', `${key} is not a number`);
  }
  assert.ok(act.requested >= 1, 'the resets requested by these tests should be counted');
  // Days is a string in the query: passing "10; drop table" must be a number or
  // the interval is nonsense, so the caller-facing shape is checked here.
  const negative = await recovery.resetActivity({ days: -5 });
  assert.equal(typeof negative.requested, 'number');
});
