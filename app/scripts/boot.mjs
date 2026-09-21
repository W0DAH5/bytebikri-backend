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
