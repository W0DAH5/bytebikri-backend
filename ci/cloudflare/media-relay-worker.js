/**
 * ByteBikri's edge relay — the Cloudflare Worker that delivers Catbox and Pixeldrain files.
 *
 * ── WHAT IT IS FOR ───────────────────────────────────────────────────────────
 *
 * Two hosts will not always hand their bytes to a browser. Pixeldrain's free plan answers a
 * direct browser fetch with 403 `hotlink_detected`; Catbox's terms forbid being a service's CDN,
 * which no code fixes. The application's own relay can serve both, and it pays for every byte out
 * of the operator's bandwidth, with every viewer arriving from ONE address — this deployment's.
 *
 * A Worker changes both facts at once: Cloudflare does not bill egress for Workers, and the
 * request leaves from the edge. It is the middle tier described in `app/src/video-edge.js`, and
 * it is the reason a store with no budget can still serve a file that a host refuses to hand
 * over directly.
 *
 * ── WHY IT IS NOT AN OPEN RELAY ──────────────────────────────────────────────
 *
 * The application signs every url it hands out: an HMAC over `host/id/expiry`, with a secret
 * that exists only in the deployment's environment and this Worker's secret store. A request
 * whose signature does not match — or whose expiry has passed — is refused before a socket is
 * opened. Nothing here can be pointed at a third host: the path's first segment must be one of
 * two names in a table, and the id is url-encoded into a url built HERE, so there is no way to
 * smuggle a different destination through.
 *
 * ── DEPLOY ───────────────────────────────────────────────────────────────────
 *
 *   npm install -g wrangler && wrangler login
 *   wrangler deploy ci/cloudflare/media-relay-worker.js --name bytebikri-media
 *   wrangler secret put MEDIA_EDGE_SECRET      # same value as the app's
 *   wrangler secret put PIXELDRAIN_API_KEY     # optional; only if Pixeldrain is in use
 *
 * Then in the application's `.env`:
 *
 *   MEDIA_EDGE_BASE=https://bytebikri-media.<your-subdomain>.workers.dev
 *   MEDIA_EDGE_SECRET=<the same secret>
 *   MEDIA_RELAY=pixeldrain,catbox      # which hosts go through it
 *
 * `../cloudflare/README.md` has the same steps with the reasoning, and the doctor prints which
 * tier each host is on (`npm run video:check --prefix app -- --drivers`).
 */

/** The only two hosts this Worker will ever fetch. Adding a third is a decision, not a config. */
const UPSTREAM = {
  pixeldrain: {
    // The same default the application uses (`video-pixeldrain.js`), and overridable so a
    // deployment can point its own relay somewhere else in a test.
    url: (id, env) => `${(env.PIXELDRAIN_API_BASE || 'https://pixeldrain.com/api').replace(/\/+$/, '')}/file/${encodeURIComponent(id)}`,
    // Their API takes the key as the PASSWORD half of HTTP Basic, which is what their own
    // documentation shows and what the application's upload path already does.
    authorization: (env) => (env.PIXELDRAIN_API_KEY ? `Basic ${btoa(`:${env.PIXELDRAIN_API_KEY}`)}` : null),
  },
  catbox: {
    url: (id, env) => `${(env.CATBOX_FILE_BASE || 'https://files.catbox.moe').replace(/\/+$/, '')}/${encodeURIComponent(id)}`,
    authorization: () => null,
  },
};

/**
 * Verify the signature, in constant time.
 *
 * `crypto.subtle.verify` with HMAC does the comparison inside the runtime rather than in a loop
 * written here, which is the only way to be sure it is constant-time. The payload is the exact
 * string the application signed — `host/id/expiry` — so a valid signature for one file cannot
 * be replayed for another, and neither can it be replayed after the expiry.
 */
async function verified(host, id, exp, signature, env) {
  const seconds = Number(exp);
  if (!Number.isFinite(seconds) || seconds <= 0) return { ok: false, why: 'no expiry' };
  if (seconds * 1000 < Date.now()) return { ok: false, why: 'expired' };
  if (!/^[0-9a-f]{64}$/i.test(String(signature || ''))) return { ok: false, why: 'no signature' };
  const secret = String(env.MEDIA_EDGE_SECRET || '');
  if (!secret) return { ok: false, why: 'the worker has no secret' };
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify'],
  );
  const bytes = new Uint8Array(String(signature).match(/../g).map((pair) => parseInt(pair, 16)));
  const ok = await crypto.subtle.verify(
    'HMAC', key, bytes, new TextEncoder().encode(`${host}/${id}/${seconds}`),
  );
  return ok ? { ok: true } : { ok: false, why: 'signature does not match' };
}

const text = (status, message) => new Response(`${message}\n`, {
  status, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
});

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    // GET and HEAD only: this is a reader, and a relay that accepted writes would be a
    // proxy for something nobody here asked it to proxy.
    if (request.method !== 'GET' && request.method !== 'HEAD' && request.method !== 'OPTIONS') {
      return text(405, 'this relay only serves GET and HEAD');
    }
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    const [, host, ...rest] = url.pathname.split('/');
    const upstream = UPSTREAM[host];
    if (!upstream) return text(404, 'not a host this relay serves');
    const id = rest.join('/');
    if (!id) return text(400, 'no file id');

    const check = await verified(host, id, url.searchParams.get('e'), url.searchParams.get('s'), env);
    if (!check.ok) {
      /*
       * The refusal says WHICH check failed, because the two failures want different actions: an
       * expired link is a viewer reloading a page, and a bad signature is somebody poking at the
       * relay. Neither reveals anything — the response is the same shape either way, and the
       * secret is never echoed.
       */
      return text(403, `refused: ${check.why}`);
    }

    const headers = new Headers();
    // Range is the header that decides whether a viewer can seek. Forwarding it is the whole
    // difference between a video and a very long animated image.
    const range = request.headers.get('range');
    if (range) headers.set('range', range);
    if (request.headers.get('if-range')) headers.set('if-range', request.headers.get('if-range'));
    const authorization = upstream.authorization(env);
    if (authorization) headers.set('authorization', authorization);
    // An honest user-agent. A host refusing a BROWSER is not refusing a server, and pretending
    // to be a browser to get around a term or a rule would be the wrong kind of clever.
    headers.set('user-agent', 'ByteBikri media relay');

    let response;
    try {
      response = await fetch(upstream.url(id, env), { method: request.method, headers, redirect: 'follow' });
    } catch (err) {
      return text(502, `the host did not answer: ${err.message}`);
    }

    /*
     * ── AND NOW THE PART THAT MUST NOT BE GOT WRONG ──────────────────────────
     *
     * The body is handed back as a STREAM. Reading it into a buffer first — `await
     * response.arrayBuffer()`, which is what most examples do — would put the whole file in the
     * Worker's 128 MB memory ceiling, and a video larger than that would fail for every viewer
     * while working perfectly in every test with a small file. Passing the ReadableStream
     * straight through means the bytes move as they arrive and the Worker's memory holds a few
     * kilobytes whatever the file's size.
     *
     * The headers that matter to a media element are copied by name rather than by `for...of`
     * over everything: a host's `set-cookie`, its caching headers or its CORS headers are the
     * host's business and should not be replayed as though they were this relay's.
     */
    const out = new Headers(corsHeaders());
    for (const header of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified']) {
      const value = response.headers.get(header);
      if (value) out.set(header, value);
    }
    out.set('cache-control', 'private, no-store');
    out.set('x-bytebikri-edge', host);

    return new Response(response.body, { status: response.status, headers: out });
  },
};

/**
 * CORS, so a player that fetches with XHR (hls.js does; a progressive `<video>` may not) can read
 * the response. `*` is safe here: the url is already a signed bearer, so allowing a page to read
 * a response it could already play leaks nothing it did not have.
 */
function corsHeaders() {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, HEAD, OPTIONS',
    'access-control-allow-headers': 'range, if-range',
    'access-control-expose-headers': 'content-length, content-range, accept-ranges',
  };
}
