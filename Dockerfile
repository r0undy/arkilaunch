# Backend-only image: apps/api (persistent Container App) + jobs (Container App
# Jobs). One image, two run modes selected by CMD/command override at deploy
# time -- see infra/terraform/modules/{api_app,cron_job}. apps/web is Vercel,
# not built here (see docs/build-arkilaunch.md §3).

FROM node:24-slim AS base
RUN corepack enable && corepack prepare pnpm@11.11.0 --activate
WORKDIR /app

# --- deps: install once, cached across builds as long as lockfile/manifests
# are unchanged (source-code edits below never bust this layer). ---
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY packages/db/package.json packages/db/package.json
COPY jobs/package.json jobs/package.json
COPY apps/api/package.json apps/api/package.json
RUN pnpm install --frozen-lockfile

# --- build: shared -> db -> jobs -> api, the same dependency order this repo
# already builds in by hand (each package's tsc output is the next one's
# input via workspace symlinks). ---
FROM deps AS build
COPY packages/shared packages/shared
COPY packages/db packages/db
COPY jobs jobs
COPY apps/api apps/api
RUN pnpm --filter @arkilaunch/shared build \
 && pnpm --filter @arkilaunch/db build \
 && pnpm --filter @arkilaunch/jobs build \
 && pnpm --filter @arkilaunch/api build

# --- runtime: slim image, no build toolchain. Keeps the full node_modules
# tree (workspace symlinks + transitive deps) rather than pruning -- pnpm
# workspace pruning (`pnpm deploy`/`--prod`) is a follow-up size optimization,
# not required for correctness. ---
FROM node:24-slim AS runtime
ENV NODE_ENV=production
RUN corepack enable && corepack prepare pnpm@11.11.0 --activate
WORKDIR /app

COPY --from=build /app/node_modules node_modules
COPY --from=build /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=build /app/packages/shared packages/shared
COPY --from=build /app/packages/db packages/db
COPY --from=build /app/jobs jobs
COPY --from=build /app/apps/api apps/api

# No default CMD: the API Container App sets `node apps/api/dist/main.js`,
# each Container App Job sets `node jobs/dist/<job-name>.js` -- see
# infra/terraform/modules/api_app and infra/terraform/modules/cron_job.
