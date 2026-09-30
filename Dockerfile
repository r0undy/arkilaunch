# Backend-only image (api + jobs), run mode set per workload at deploy time. apps/web is a Cloudflare Worker.

FROM node:24-slim AS base
RUN corepack enable && corepack prepare pnpm@11.11.0 --activate
WORKDIR /app

FROM base AS deps
# List every workspace manifest api/jobs reach: a missing one silently leaves that package unlinked.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/document-intelligence/package.json packages/document-intelligence/package.json
COPY packages/weather/package.json packages/weather/package.json
COPY jobs/package.json jobs/package.json
COPY apps/api/package.json apps/api/package.json
RUN pnpm install --frozen-lockfile

# `<pkg>...` builds each package plus its deps in topological order.
FROM deps AS build
COPY packages packages
COPY jobs jobs
COPY apps/api apps/api
RUN pnpm --filter "@arkilaunch/api..." --filter "@arkilaunch/jobs..." build

# Copy every workspace package api/jobs reach: node_modules holds workspace symlinks, so a missing
# package is a dangling symlink that fails only at runtime (ERR_MODULE_NOT_FOUND).
FROM node:24-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY --from=build /app/node_modules node_modules
COPY --from=build /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=build /app/packages/shared packages/shared
COPY --from=build /app/packages/db packages/db
COPY --from=build /app/packages/document-intelligence packages/document-intelligence
COPY --from=build /app/packages/weather packages/weather
COPY --from=build /app/jobs jobs
COPY --from=build /app/apps/api apps/api

# No default CMD: the api_app and cron_job modules set the command.
