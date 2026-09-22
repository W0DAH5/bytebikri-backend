#!/usr/bin/env bash
# Bring a cold workspace up to a running app with a seeded demo database.
#
# This is the sequence that has been done by hand five times now, once per
# workspace restore: install, start Postgres, migrate, boot. Writing it down is
# not laziness — the fourth time it was done slightly differently (a stale
# `node_modules`, a migration run against the wrong URL) and produced twenty
# minutes of debugging a problem that had nothing to do with the code.
#
#   ci/dev-up.sh            boot in the foreground
#   ci/dev-up.sh --bg       boot in the background, log to /tmp/bytebikri-web.log
#   ci/dev-up.sh --test     also run the suite against the test database
#
# Idempotent: an already-running Postgres is reused, an installed node_modules is
# left alone, and `boot.mjs` seeds only when the database is empty.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP="$(cd "$HERE/../app" && pwd)"
cd "$APP"

MODE="${1:-}"

echo "── app dependencies"
if [ -d node_modules ] && [ -f node_modules/.package-lock.json ]; then
  echo "   installed — skipping"
else
  npm install --no-audit --no-fund
fi

echo "── postgres"
if pgrep -f "[d]ev-postgres.mjs" >/dev/null; then
  echo "   already running on 127.0.0.1:55432"
else
  nohup node scripts/dev-postgres.mjs >/tmp/bytebikri-postgres.log 2>&1 &
  # Wait for the port rather than sleeping a guessed amount: a cold Postgres
  # initdb takes a few seconds and a warm one is instant.
  for _ in $(seq 1 60); do
    if (exec 3<>/dev/tcp/127.0.0.1/55432) 2>/dev/null; then break; fi
    sleep 0.5
  done
  echo "   started on 127.0.0.1:55432 (log /tmp/bytebikri-postgres.log)"
fi

echo "── migrations"
node scripts/migrate.mjs 2>&1 | tail -3

if [ "$MODE" = "--test" ]; then
  echo "── test suite"
  node scripts/test-db.mjs
  npm test 2>&1 | grep -E "^# (tests|pass|fail)"
fi

echo "── web"
export OPERATOR_EMAIL="${OPERATOR_EMAIL:-operator@bytebikri.local}"
export OPERATOR_LEGAL_NAME="${OPERATOR_LEGAL_NAME:-ByteBikri Pvt Ltd}"
export PAY_ESEWA_ID="${PAY_ESEWA_ID:-9800000001}"
export PAY_KHALTI_ID="${PAY_KHALTI_ID:-9800000002}"
export PAY_IMEPAY_ID="${PAY_IMEPAY_ID:-9800000003}"
export PAY_BANK_ACCOUNT="${PAY_BANK_ACCOUNT:-NIC Asia · ByteBikri Pvt Ltd · 0123456789012}"

if [ "$MODE" = "--bg" ]; then
  pkill -f "[b]oot.mjs" 2>/dev/null || true
  sleep 1
  nohup node scripts/boot.mjs >/tmp/bytebikri-web.log 2>&1 &
  for _ in $(seq 1 60); do
    if curl -sf -o /dev/null http://127.0.0.1:3000/healthz; then break; fi
    sleep 0.5
  done
  echo "   running on http://0.0.0.0:3000 (log /tmp/bytebikri-web.log)"
  tail -4 /tmp/bytebikri-web.log
else
  node scripts/boot.mjs
fi
