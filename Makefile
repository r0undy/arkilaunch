# ArkiLaunch
#
#   Run
#     make web          frontend only, http://localhost:5173
#     make api          backend only, http://localhost:3000
#     make dev          both together, with labelled output
#     make start        the built API (run make build first)
#
#   Database
#     make migrate      apply migrations to DATABASE_URL_DIRECT
#     make seed         seed the anchor tenant and its accounts
#     make seed-test    seed the two-tenant isolation fixture
#     make fixtures     pull the OCR fixture corpus
#
#   Check
#     make check        typecheck, then lint, then test
#     make test         unit tests across every workspace
#     make test-web     web tests only
#     make test-api     api tests only
#     make e2e          Playwright end-to-end suite
#     make lint         eslint
#     make typecheck    tsc across every workspace
#
#   Build
#     make install      install dependencies
#     make build        build every workspace
#     make build-web    build the frontend
#     make build-api    build the backend
#     make clean        remove build output and caches
#
#   After make clean, run make build before make typecheck: the workspaces
#   resolve @arkilaunch/shared through its built output.
#
# ---------------------------------------------------------------------------
#
# Every recipe forwards to the pnpm script of the same job in package.json,
# so this file is a set of shorthands and never a second source of truth.
#
# Each recipe is deliberately ONE line. GNU make runs every line of a recipe,
# but the `make` task runner many of us have on PATH here (the npm package,
# not GNU make) runs only the first -- so a multi-line recipe would silently
# do part of its job. Chain with && rather than adding a second line.

.DEFAULT_GOAL := help
.PHONY: help install web api dev start migrate seed seed-test fixtures check test test-web test-api e2e lint typecheck build build-web build-api clean

# The usage block above is the help text, so the two can never drift apart.
help:
	@head -32 Makefile

install:
	pnpm install

# --- run ---------------------------------------------------------------

web:
	pnpm dev:web

api:
	pnpm dev:api

dev:
	pnpm dev

start:
	pnpm start:api

# --- database ----------------------------------------------------------

migrate:
	pnpm db:migrate

seed:
	pnpm db:seed

seed-test:
	pnpm db:seed:test

fixtures:
	pnpm ocr:fixtures:pull

# --- check -------------------------------------------------------------

# Cheapest first, so an obvious type error fails before the slow
# database-backed suites run.
check: typecheck lint test

test:
	pnpm test

test-web:
	pnpm --filter @arkilaunch/web test

test-api:
	pnpm --filter @arkilaunch/api test

e2e:
	pnpm e2e

lint:
	pnpm lint

typecheck:
	pnpm typecheck

# --- build -------------------------------------------------------------

build:
	pnpm build

build-web:
	pnpm build:web

build-api:
	pnpm build:api

# One command: see the note at the top about single-line recipes. Removes
# packages/*/dist as well, which the other workspaces resolve
# @arkilaunch/shared through.
clean:
	rm -rf apps/web/dist apps/api/dist packages/*/dist jobs/dist node_modules/.vite apps/web/node_modules/.vite
