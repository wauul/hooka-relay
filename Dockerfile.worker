# Only the always-on queue worker is containerized; Vercel hosts the Next.js app.
FROM node:22-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS build
COPY package.json package-lock.json ./
COPY prisma.config.ts ./
COPY prisma ./prisma
RUN npm ci --no-audit --no-fund
COPY tsconfig.json tsconfig.worker.json ./
COPY lib ./lib
COPY worker ./worker
ARG SENTRY_RELEASE
ARG SENTRY_ORG
ARG SENTRY_WORKER_PROJECT
ENV SENTRY_RELEASE=$SENTRY_RELEASE SENTRY_ORG=$SENTRY_ORG SENTRY_WORKER_PROJECT=$SENTRY_WORKER_PROJECT
COPY scripts/sentry-worker-sourcemaps.mjs ./scripts/sentry-worker-sourcemaps.mjs
# Auth is a BuildKit secret, never an ARG/ENV or copied file.
RUN --mount=type=secret,id=sentry_auth_token \
    npm run build:worker && npm run sentry:worker:sourcemaps

FROM base AS runtime
ENV NODE_ENV=production
ARG SENTRY_RELEASE
ENV SENTRY_RELEASE=$SENTRY_RELEASE
# A separate, locked dependency set excludes Next.js, Vitest, Prisma CLI,
# TypeScript and Testcontainers from the running worker image.
COPY worker/runtime/package.json worker/runtime/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund && npm cache clean --force
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build --chown=node:node /app/dist ./dist
USER node
EXPOSE 8080
CMD ["node", "dist/worker/bootstrap.js"]
