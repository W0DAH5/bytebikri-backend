/**
 * Make somebody an operator, or take it away.  `npm run operator -- ops@example.com`
 *
 * WHY THIS EXISTS. `/admin` answers 404 to every account whose `profiles.role` is not `'admin'`, and
 * nothing in the product could set that column — not the sign-up route, not any script. A deployment
 * therefore had an operator console that NOBODY could open, and the documented demo account
 * (`operator@bytebikri.local`) did not exist either, which quietly removed a third of the demo's states:
 * the verification records, the plan payments and the approvals are all recorded AS an operator
 * (`ci/demo-state.mjs` says so on its own line: "the operator account is missing?").
 *
 * The order is deliberate and not negotiable by a flag: the PERSON SIGNS UP FIRST, then gets
 * promoted. Creating an account here would mint a login with no password and no person behind it,
 * and promotion is the step that ought to be attributable. A real deployment runs this once, after
 * registering the operator's own account:
 *
 *   node scripts/operator.mjs ops@example.com            # promote
 *   node scripts/operator.mjs ops@example.com --moderator
 *   node scripts/operator.mjs ops@example.com --demote   # back to an ordinary account
 *   node scripts/operator.mjs --list                     # who is an operator now
 *
 * It is a local administrative action against the database, not a web route: there is no HTTP
 * surface for it, so there is nothing to secure beyond the database credentials themselves.
 */
process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:55432/bytebikri';

const args = process.argv.slice(2);
const LIST = args.includes('--list');
const DEMOTE = args.includes('--demote');
const MODERATOR = args.includes('--moderator');
const email = args.find((a) => !a.startsWith('--')) || '';

const { close, many, one } = await import('../src/db.js');
const { store } = await import('../src/store.js');

try {
  if (LIST || !email) {
    const rows = await many(
      `select email, role, created_at::date as since from profiles
        where role <> 'user' order by role, email`,
    );
    if (!rows.length) {
      console.log('no operators yet — the account signs up first, then:');
      console.log('  node scripts/operator.mjs someone@example.com');
    } else {
      for (const row of rows) console.log(`  ${row.role.padEnd(9)} ${row.email}  (since ${row.since.toISOString().slice(0, 10)})`);
    }
    if (!LIST && !email) {
      // No email and no --list is a person who wants to know the usage, not an error to shout about.
      console.log('\nusage: node scripts/operator.mjs <email> [--moderator|--demote]');
      process.exit(2);
    }
    process.exit(0);
  }

  const account = await one('select id, email, role from profiles where email = $1', [email.trim().toLowerCase()]);
  if (!account) {
    console.error(`no account with the email ${email.trim().toLowerCase()}.`);
    console.error('The person registers on the site first (that sets their password), then this promotes them.');
    process.exit(1);
  }

  const role = DEMOTE ? 'user' : (MODERATOR ? 'moderator' : 'admin');
  const before = account.role;
  if (before === role) {
    console.log(`${account.email} is already ${role} — nothing changed.`);
  } else {
    await store.setOperatorRole({ email: account.email, role });
    console.log(`${account.email}: ${before} → ${role}`);
    if (role === 'admin') console.log('They can sign in and open /admin now.');
  }
} finally {
  await close();
}
