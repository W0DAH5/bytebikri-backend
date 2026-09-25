/**
 * The config check, as a command — and it reads the same `.env` the app reads.
 *
 * This was a `node -e` one-liner in package.json, which meant it could not load
 * `.env`: the video host's token lives there (`VIDEO_STORAGE.md` §3), and a check
 * that cannot see the file the app reads would report a perfectly configured
 * laptop as missing its token. Same guarded load as `boot.mjs`, for the same
 * reason, in the same order — the file first, the check second.
 *
 * Exits non-zero when production is misconfigured, so it is usable in a deploy
 * step.
 */
import { checkConfig, formatConfigReport } from '../src/config.js';

try {
  process.loadEnvFile(new URL('../.env', import.meta.url));
} catch {
  // No file: environment variables only, which is the deployment case.
}

process.env.NODE_ENV = process.env.NODE_ENV || 'production';
const report = checkConfig();
console.log(formatConfigReport(report) || '  Configuration is complete.');
process.exit(report.ok ? 0 : 1);
