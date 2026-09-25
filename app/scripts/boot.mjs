/**
 * Entry point.
 *
 * Exists for one reason: ESM imports are evaluated before any statement in the
 * file that imports them, so a configuration check written inside server.js runs
 * AFTER src/db.js has already thrown its own error. The operator then sees a
 * stack trace pointing at a line in a file they have never opened, instead of
 * the list of variables they have not set.
 *
 * So the check runs first, in a module that imports nothing from the app, and
 * only then is the server loaded. A refusal here is a sentence and an exit code.
 */
import { assertProductionConfig, formatConfigReport, checkConfig } from '../src/config.js';

/*
 * `.env`, if there is one.
 *
 * Nothing loaded this file until a secret existed that a contributor is expected
 * to paste in rather than invent — the video host's token (`VIDEO_STORAGE.md` §3).
 * The three signing secrets have development defaults and the demo values are
 * exported by `ci/dev-up.sh`, so a local checkout never needed a file; a token
 * for somebody else's service has no safe default and must not be typed into a
 * shell history.
 *
 * Guarded, because in production the variables arrive from the environment and a
 * missing file is the normal case. Loaded BEFORE the config check, so a token in
 * the file is seen by the check rather than one boot later. `.env` is gitignored;
 * only `.env.example`, with names and no values, is committed.
 */
try {
  process.loadEnvFile(new URL('../.env', import.meta.url));
} catch {
  // No file: production, a fresh clone, or a deployment that exports its own.
}

const report = checkConfig();

if (report.production) {
  if (!report.ok) {
    console.error(formatConfigReport(report));
    console.error('\n  Refusing to start in production with an incomplete configuration.');
    console.error('  Run `npm run check:env` to see this report without starting anything.\n');
    process.exit(1);
  }
}

// Printed in every environment, including development — a contributor should
// know they are running with default secrets rather than discover it later.
// The wording differs, because "will not start" is a lie when it does.
if (report.warnings.length) {
  console.warn(report.ok
    ? formatConfigReport(report)
    : `\n  Development warnings:\n${report.warnings.map((w) => `    ${w.name} — ${w.why}`).join('\n')}`);
}

// Imported last, on purpose: everything above is a gate, not a setup step.
await import('../server.js');
