#!/usr/bin/env bash
# Bootstrap the browser this harness drives. Idempotent; safe to re-run.
#
# Chromium does not come from Playwright's CDN here — it is blocked in this
# environment — so the browser is pulled as an npm package (@sparticuz/chromium
# ships a headless build plus the shared libraries it needs) and unpacked by
# hand. Run this once after a fresh checkout or a rebuilt workspace, then use
# check.mjs / sweep.mjs.
set -euo pipefail
DIR="${EYES_DIR:-/tmp/eyes}"
mkdir -p "$DIR" && cd "$DIR"

[ -f package.json ] || npm init -y >/dev/null
npm install --silent playwright @sparticuz/chromium >/dev/null

node -e '
const zlib = require("node:zlib"), fs = require("node:fs"), path = require("node:path");
const bin = "/tmp/eyes/node_modules/@sparticuz/chromium/bin";
for (const name of ["al2023", "fonts", "swiftshader"]) {
  const src = path.join(bin, name + ".tar.br");
  if (fs.existsSync(src)) fs.writeFileSync(`/tmp/eyes/${name}.tar`, zlib.brotliDecompressSync(fs.readFileSync(src)));
}'
mkdir -p "$DIR/al2023" && tar -xf "$DIR/al2023.tar" -C "$DIR/al2023"
node -e 'import("@sparticuz/chromium").then(async (m) => { const c = m.default || m; if (c.executablePath) await c.executablePath(); })'
mkdir -p /tmp/chromium-libs && cp -r "$DIR/al2023/lib/." /tmp/chromium-libs/ 2>/dev/null || true

export LD_LIBRARY_PATH="$DIR/al2023/lib"
echo -n "chromium: "; /tmp/chromium --version
echo "run:  cd $DIR && export LD_LIBRARY_PATH=$DIR/al2023/lib && node <harness>.mjs"
