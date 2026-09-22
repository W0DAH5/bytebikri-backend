/**
 * Configuration tests.
 *
 * The behaviour under test is a refusal. Every secret here used to fall back to a
 * hardcoded development value, so the app started in production with a signing
 * key that is in the repository — which does not look like a failure from the
 * outside, and is the reason these tests exist rather than a note in a README.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { checkConfig, formatConfigReport, assertProductionConfig, readSecret, generateSecret } =
  await import('../src/config.js');
const { getAdapter, SANDBOX_PROVIDER_IDS } = await import('../src/providers/index.js');

const GOOD = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgres://user:pass@db.example.com:5432/bytebikri',
  PUBLIC_BASE_URL: 'https://bytebikri.example',
  SESSION_SECRET: 'a'.repeat(48),
  ACCESS_TOKEN_SECRET: 'b'.repeat(48),
  AD_POSTBACK_SECRET: 'c'.repeat(48),
  OPERATOR_EMAIL: 'hello@bytebikri.example',
  // Mail is part of a complete configuration now: the platform sends password
  // reset links, and without a driver a forgotten password is a lost account.
  EMAIL_DRIVER: 'resend',
  RESEND_API_KEY: 're_test_key',
  EMAIL_FROM: 'ByteBikri <hello@bytebikri.example>',
};

test('a complete production configuration passes', () => {
  const r = checkConfig(GOOD);
  assert.deepEqual(r.errors, []);
  assert.ok(r.ok);
});

test('each missing secret is fatal in production, and all are reported at once', () => {
  // Reported together, not one restart at a time: an operator setting up a
  // deploy should see the whole list in one pass.
  const r = checkConfig({ ...GOOD, SESSION_SECRET: undefined, ACCESS_TOKEN_SECRET: undefined });
  assert.equal(r.ok, false);
  assert.deepEqual(
    r.errors.filter((e) => /SECRET$/.test(e.name)).map((e) => e.name).sort(),
    ['ACCESS_TOKEN_SECRET', 'SESSION_SECRET'],
  );
});

test('the development defaults are refused in production', () => {
  // The exact values that used to be the fallbacks.
  for (const bad of [
    'dev-session-secret-change-me',
    'dev-access-secret-change-me',
    'dev-postback-secret-change-me',
  ]) {
    const r = checkConfig({ ...GOOD, SESSION_SECRET: bad, ACCESS_TOKEN_SECRET: bad });
    assert.equal(r.ok, false, `${bad} was accepted as a production secret`);
    assert.ok(r.errors.some((e) => /development default/.test(e.why)));
  }
});

test('a short secret is refused, because a short secret is a guessable one', () => {
  const r = checkConfig({ ...GOOD, SESSION_SECRET: 'too-short' });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.name === 'SESSION_SECRET' && /too short/.test(e.why)));
});

test('production refuses to start without a way to deliver mail', () => {
  // The failure this prevents is specific and nasty: everything looks healthy,
  // and the first sign of trouble is a user who cannot get into their account and
  // cannot tell anyone, because telling anyone requires being signed in.
  const r = checkConfig({ ...GOOD, EMAIL_DRIVER: undefined });
  assert.equal(r.ok, false);
  const err = r.errors.find((e) => e.name === 'EMAIL_DRIVER');
  assert.ok(err, 'a missing mail driver was accepted in production');
  assert.match(err.detail, /reset|recover/i);
});

test('the console driver is refused in production, because it sends nothing', () => {
  // It prints. In development that is the feature — it is how a contributor
  // recovers a demo password without an account at a mail provider. In production
  // it would put working reset links in a log file and deliver none of them.
  const r = checkConfig({ ...GOOD, EMAIL_DRIVER: 'console' });
  assert.equal(r.ok, false);
  assert.match(r.errors.find((e) => e.name === 'EMAIL_DRIVER').why, /cannot send/);
  // Same setting in development is correct, not tolerated.
  assert.equal(checkConfig({ NODE_ENV: 'development', EMAIL_DRIVER: 'console' }).errors.length, 0);
});

test('a driver named without its credential is fatal, not silently ignored', () => {
  // Naming a driver and forgetting its key is the likeliest mistake in a
  // hand-written deploy config, and the resulting behaviour is the worst kind:
  // a server that starts, accepts every reset request, and fails inside a
  // fire-and-forget send where nobody is looking.
  for (const [env, missing] of [
    // Cleared explicitly: GOOD carries a Resend key, and spreading it over a
    // deliberately-broken case would test nothing.
    [{ EMAIL_DRIVER: 'resend', RESEND_API_KEY: undefined }, 'RESEND_API_KEY'],
    [{ EMAIL_DRIVER: 'smtp', SMTP_URL: undefined }, 'SMTP_URL'],
  ]) {
    const r = checkConfig({ ...GOOD, ...env });
    assert.equal(r.ok, false, `${env.EMAIL_DRIVER} without a credential was accepted`);
    const err = r.errors.find((e) => e.name === 'EMAIL_DRIVER');
    // The operator has to be told WHICH variable is missing, in the report they
    // are reading at 2am — "mail cannot send" alone sends them to the source.
    assert.match(err.detail, new RegExp(missing));
    assert.match(err.detail, /EMAIL_DRIVER/);
  }
  // And with the credential, it passes.
  assert.equal(checkConfig({ ...GOOD, EMAIL_DRIVER: 'smtp', SMTP_URL: 'smtps://user:pass@smtp.example:465' }).ok, true);
});

test('a misspelled driver is refused, not discovered at send time', () => {
  // EMAIL_DRIVER=resnd would otherwise pass every check, start the server, accept
  // every reset request, and fail inside a fire-and-forget send where nobody is
  // looking — the worst shape a configuration mistake can take.
  const r = checkConfig({ ...GOOD, EMAIL_DRIVER: 'resnd' });
  assert.equal(r.ok, false);
  const err = r.errors.find((e) => e.name === 'EMAIL_DRIVER');
  assert.match(err.detail, /not a driver/);
  // The message names the alternatives, so the fix does not need the source code.
  assert.match(err.detail, /resend/);
});

test('development prints to the log and says so, without shouting', () => {
  const dev = checkConfig({ NODE_ENV: 'development' });
  const warn = dev.warnings.find((w) => w.name === 'EMAIL_DRIVER');
  assert.ok(warn, 'a developer should be told that mail is going to the log, not to an inbox');
  assert.match(warn.why, /printing/);
  assert.equal(dev.errors.some((e) => e.name === 'EMAIL_DRIVER'), false);
});

test('production requires an https public origin', () => {
  assert.equal(checkConfig({ ...GOOD, PUBLIC_BASE_URL: 'http://bytebikri.example' }).ok, false);
  assert.equal(checkConfig({ ...GOOD, PUBLIC_BASE_URL: undefined }).ok, false);
  // A provider will not send a signed callback to plain http, and neither should
  // we accept one from it.
  assert.equal(checkConfig({ ...GOOD, PUBLIC_BASE_URL: 'https://bytebikri.example' }).ok, true);
});

test('a database is required in production, optional in development', () => {
  const missing = checkConfig({ ...GOOD, DATABASE_URL: undefined });
  assert.equal(missing.ok, false);
  assert.ok(missing.errors.some((e) => e.name === 'DATABASE_URL'));

  // In development src/db.js falls back to the local Postgres from
  // `npm run db:start`, so requiring the variable would be a friction tax on
  // anyone who just cloned the repo. The two files must agree.
  const dev = checkConfig({ NODE_ENV: 'development' });
  assert.equal(dev.ok, true);
  assert.ok(dev.warnings.some((w) => w.name === 'DATABASE_URL'));

  // Fatal to lose a production database; not fatal to have the database on the
  // same host as the app, which is a real deployment shape.
  const local = checkConfig({ ...GOOD, DATABASE_URL: 'postgres://postgres:postgres@127.0.0.1:5432/bytebikri' });
  assert.equal(local.ok, true);
  assert.ok(local.warnings.some((w) => w.name === 'DATABASE_URL'));
});

test('a demo password in production is refused, not ignored', () => {
  // A known login is a back door. Seeding already declines in production; this
  // catches the case where someone set the variable and assumed that was enough.
  const r = checkConfig({ ...GOOD, DEMO_PASSWORD: 'bytebikri-demo' });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.name === 'DEMO_PASSWORD'));
});

test('development warns instead of refusing', () => {
  const r = checkConfig({ NODE_ENV: 'development', DATABASE_URL: GOOD.DATABASE_URL });
  assert.equal(r.ok, true, 'a contributor with no secrets must still be able to run the app');
  assert.ok(r.warnings.length >= 2, 'and must be told what is missing');
  assert.ok(/SESSION_SECRET — using the development default/.test(formatConfigReport(r)));
});

test('a refusal explains itself in sentences, not a stack trace', () => {
  const text = formatConfigReport(checkConfig({ NODE_ENV: 'production' }));
  assert.match(text, /will not start/);
  assert.match(text, /SESSION_SECRET/);
  assert.match(text, /npm run secrets/);
});

test('readSecret hands out working values in development and never a default in production', () => {
  const before = process.env.SESSION_SECRET;
  try {
    delete process.env.SESSION_SECRET;
    process.env.NODE_ENV = 'development';
    assert.ok(readSecret('SESSION_SECRET').length > 0, 'development needs a usable value');

    process.env.NODE_ENV = 'production';
    assert.throws(() => readSecret('SESSION_SECRET'), /not set/,
      'production must not fall back to anything');
  } finally {
    process.env.NODE_ENV = 'test';
    if (before === undefined) delete process.env.SESSION_SECRET; else process.env.SESSION_SECRET = before;
  }
});

test('generated secrets are long, unique and shell-safe', () => {
  const seen = new Set();
  for (let i = 0; i < 20; i += 1) {
    const s = generateSecret();
    assert.ok(s.length >= 40, `generated secret is only ${s.length} characters`);
    assert.match(s, /^[A-Za-z0-9_-]+$/, 'a secret with shell metacharacters will break a .env file');
    assert.ok(!seen.has(s), 'a repeated secret means the generator is not random');
    seen.add(s);
  }
});

test('the sandbox ad network cannot be used in production', () => {
  // Its signature is a shared secret in this repository and its purpose is to
  // mint unlocks without a real ad. That is precisely what an attacker wants.
  process.env.NODE_ENV = 'development';
  const dev = getAdapter('house');
  assert.ok(dev, 'the sandbox should work in development');

  process.env.NODE_ENV = 'production';
  try {
    assert.equal(getAdapter('house'), null, 'the sandbox resolved in production');
    for (const id of SANDBOX_PROVIDER_IDS) assert.equal(getAdapter(id), null);
    // Real adapters are unaffected.
    assert.ok(getAdapter('bitlabs'), 'a real provider must still resolve');
  } finally { process.env.NODE_ENV = 'test'; }
});

test('assertProductionConfig returns rather than exits outside production', () => {
  // Calling it in development must be safe, or it cannot be called at boot.
  const report = assertProductionConfig({ NODE_ENV: 'development', DATABASE_URL: GOOD.DATABASE_URL });
  assert.equal(report.production, false);
});
