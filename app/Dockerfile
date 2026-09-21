# ByteBikri app.
#
# Two stages, because the app has no build step: the first exists only to
# install production dependencies, so the final image carries no compilers and
# no dev packages. That is a smaller image and a smaller attack surface for the
# same code.
#
#   docker build -t bytebikri:latest app
#   docker run --rm -p 3000:3000 --env-file .env bytebikri:latest
#
# Migrations are NOT run by the entrypoint. See docker-entrypoint note below.

# ── deps ─────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS deps
WORKDIR /app

# Only the manifests, so a source change does not invalidate the install layer.
COPY package.json package-lock.json ./

# `npm ci` and not `npm install`: it installs exactly the lockfile and fails if
# the lockfile and package.json disagree, which is the difference between a
# reproducible deploy and a surprise.
RUN npm ci --omit=dev --no-audit --no-fund

# ── runtime ──────────────────────────────────────────────────────────────────
FROM node:22-alpine
WORKDIR /app

# tini reaps zombies and forwards SIGTERM. The app has a graceful-shutdown
# handler that closes the HTTP server and the pool; without an init process as
# PID 1 that signal can be swallowed, and every deploy drops in-flight requests.
RUN apk add --no-cache tini

ENV NODE_ENV=production \
    PORT=3000

COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY server.js ./
COPY src ./src
COPY public ./public
COPY scripts ./scripts
COPY db /db

# Not root. A container escape is a much shorter conversation when the process
# owns nothing.
RUN addgroup -S app && adduser -S app -G app \
 && mkdir -p /app/.data/uploads && chown -R app:app /app/.data
USER app

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# The entrypoint does not migrate.
#
# A container that migrates on boot races itself the moment there is more than
# one replica, and the loser of that race is a half-applied schema. Run
# `npm run db:migrate` as a separate release step — it takes an advisory lock,
# so running it twice is harmless — and let the app start against a schema that
# is already correct.
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "scripts/boot.mjs"]
