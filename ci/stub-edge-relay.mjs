/**
 * Run the Cloudflare Worker locally, so the edge tier can be tested without an account.
 *
 * ── WHY THIS EXISTS, AND WHY IT RUNS THE REAL FILE ───────────────────────────
 *
 * `ci/cloudflare/media-relay-worker.js` is the one piece of delivery that lives on somebody
 * else's platform, and the tempting way to test it is to write a small stub that does the same
 * thing. That is the trap: a stub tests the stub, and the Worker would first run for real on the
 * morning of a launch, where the failures are `btoa` behaving differently, `crypto.subtle` being
 * unavailable, or a header arriving from a runtime this developer never ran.
 *
 * So this is an ADAPTER, not a reimplementation. It imports the Worker module, builds a real
 * `Request` from the incoming HTTP request, calls the Worker's own `fetch` handler, and streams
 * the `Response` back out. Node 22 has every global the Workers runtime has that this file uses
 * (`fetch`, `Request`, `Response`, `Headers`, `crypto.subtle`, `btoa`), which is what makes the
 * adapter honest rather than approximate.
 *
 * What it does NOT reproduce: Cloudflare's 128 MB memory ceiling (so a buffering bug would pass
 * here and fail there — the Worker's comment says so, and the code streams), the edge network's
 * IP rotation, and the free tier's request accounting. Those are facts about the platform;
 * everything else is the deployment's own code, running for real.
 *
 *   node ci/stub-edge-relay.mjs 4005 --secret=stub-edge-secret
 *   node ci/stub-edge-relay.mjs 4005 --secret=… --key=stub-key --pixeldrain-base=http://127.0.0.1:4003/api
 *
 * Then point an instance at it:
 *
 *   MEDIA_EDGE_BASE=http://127.0.0.1:4005 MEDIA_EDGE_SECRET=stub-edge-secret \
 *     MEDIA_RELAY=pixeldrain,catbox PORT=3100 … node app/scripts/boot.mjs
 *
 * and the stream route answers a 302 with `x-bytebikri-edge: pixeldrain` instead of the 200 it
 * gives when the relay is ours.
 */
import http from 'node:http';
import { Readable } from 'node:stream';

const worker = (await import('./cloudflare/media-relay-worker.js')).default;

const PORT = Number(process.argv[2]) || 4005;
const arg = (name, fallback = null) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

/**
 * The Worker's environment, which on Cloudflare comes from `wrangler secret put`. Here it comes
 * from the command line, and the secret is required rather than defaulted: a stub that invented
 * a secret would let an unsigned url through and prove nothing about the signature check — which
 * is the single most important thing this file is here to exercise.
 */
const env = {
  MEDIA_EDGE_SECRET: arg('secret', process.env.MEDIA_EDGE_SECRET || null),
  PIXELDRAIN_API_KEY: arg('key', process.env.PIXELDRAIN_API_KEY || null),
  PIXELDRAIN_API_BASE: arg('pixeldrain-base', process.env.PIXELDRAIN_API_BASE || null),
  CATBOX_FILE_BASE: arg('catbox-base', process.env.CATBOX_FILE_BASE || null),
};
if (!env.MEDIA_EDGE_SECRET) {
  console.error('stub-edge-relay: --secret=… is required (the Worker refuses every request without one)');
  process.exit(2);
}

const server = http.createServer(async (req, res) => {
  // The request as the Worker would see it. The Host header is the one Cloudflare would supply,
  // so the Worker's own url parsing is exercised rather than bypassed.
  const url = `http://${req.headers.host || `127.0.0.1:${PORT}`}${req.url}`;
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) value.forEach((v) => headers.append(key, v));
    else if (value !== undefined) headers.set(key, value);
  }
  let request;
  try {
    request = new Request(url, { method: req.method, headers });
  } catch (err) {
    res.writeHead(400, { 'content-type': 'text/plain' });
    res.end(`bad request: ${err.message}\n`);
    return;
  }

  let response;
  try {
    response = await worker.fetch(request, env);
  } catch (err) {
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end(`the worker threw: ${err.message}\n`);
    return;
  }

  res.statusCode = response.status;
  for (const [key, value] of response.headers) res.setHeader(key, value);
  if (req.method === 'HEAD' || !response.body) {
    res.end();
    return;
  }
  // Streamed, not buffered — the same reason the Worker passes the body through: a relay that
  // read the file into memory would work here and fall over on a real video.
  Readable.fromWeb(response.body).pipe(res);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`edge relay (the real Worker, run locally) on http://127.0.0.1:${PORT}`);
  console.log(`  pixeldrain base : ${env.PIXELDRAIN_API_BASE || 'https://pixeldrain.com/api'}`);
  console.log(`  catbox base     : ${env.CATBOX_FILE_BASE || 'https://files.catbox.moe'}`);
  console.log(`  key present     : ${env.PIXELDRAIN_API_KEY ? 'yes' : 'no'}`);
});
