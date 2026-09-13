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
# Manifests only, so a source edit does not bust this layer. Every workspace
# package that api or jobs can reach must be listed: a missing manifest does
# not fail `pnpm install`, it just silently leaves that package unlinked, and
# the error surfaces much later as a TS2307 in the build stage. That is
# exactly how packages/weather went missing from this file.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/document-intelligence/package.json packages/document-intelligence/package.json
COPY packages/weather/package.json packages/weather/package.json
COPY jobs/package.json jobs/package.json
COPY apps/api/package.json apps/api/package.json
RUN pnpm install --frozen-lockfile

# --- build: api and jobs, each preceded by whatever it depends on. Each
# package's tsc output is the next one's input via workspace symlinks, so
# the order matters -- but it is pnpm's to work out, not ours. The previous
# hand-written chain named five packages explicitly and went stale the
# moment @arkilaunch/weather was added: jobs/src/weather-poll.ts imports it,
# nothing built it, and the image build failed on TS2307. `<pkg>...` means
# the package and its dependencies, topologically ordered, so a new package
# is picked up by being depended on rather than by someone remembering to
# edit this line. apps/web is excluded by construction; it is deployed to
# Vercel, not into this image. ---
FROM deps AS build
COPY packages packages
COPY jobs jobs
COPY apps/api apps/api
RUN pnpm --filter "@arkilaunch/api..." --filter "@arkilaunch/jobs..." build

# --- runtime: slim image, no build toolchain. Keeps the full node_modules
# tree (workspace symlinks + transitive deps) rather than pruning -- pnpm
# workspace pruning (`pnpm deploy`/`--prod`) is a follow-up size optimization,
# not required for correctness.
#
# Every workspace package api or jobs can reach must be copied here too, for
# the same reason the deps stage lists every manifest. node_modules carries
# pnpm's workspace symlinks, so a package missing from this list is not a
# build error -- it is a *dangling symlink* that only fails at runtime, on
# the first import, inside a cron job nobody is watching. packages/weather
# was missing here from the day it landed: jobs/src/weather-poll.ts imports
# it and dev runs that job on a cron with enable_weather_poll = true, so
# every tick died on ERR_MODULE_NOT_FOUND. Adding a package to the build
# means adding it here. ---
FROM node:24-slim AS runtime
ENV NODE_ENV=production
RUN corepack enable && corepack prepare pnpm@11.11.0 --activate
WORKDIR /app

COPY --from=build /app/node_modules node_modules
COPY --from=build /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=build /app/packages/shared packages/shared
COPY --from=build /app/packages/db packages/db
COPY --from=build /app/packages/document-intelligence packages/document-intelligence
COPY --from=build /app/packages/weather packages/weather
COPY --from=build /app/jobs jobs
COPY --from=build /app/apps/api apps/api

# No default CMD: the API Container App sets `node apps/api/dist/main.js`,
# each Container App Job sets `node jobs/dist/<job-name>.js` -- see
# infra/terraform/modules/api_app and infra/terraform/modules/cron_job.
