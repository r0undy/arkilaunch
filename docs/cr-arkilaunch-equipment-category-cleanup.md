# Change Record

**Title:** Remove equipment category test fixtures while preserving fleet records
**Project:** ArkiLaunch
**Date:** 2026-09-30
**Version:** 0.1
**Status:** Applied to the configured hosted database (branch `chore/clean-equipment-categories`; PR pending)
**Trigger:** Owner requested removal of dummy equipment categories across the existing database, with a commit and PR.
**Traceability:** PRD-F4 / US-04; SDD section 3 global equipment types; RFC-1 tenant isolation.
**Docs touched:** index.md and runbook-deploy-supabase.md. No Locked contract, schema, grant or RLS policy changes.

## Problem

Repeated API integration runs left 71 fixture category rows named Money Path Cap
Fixture, Rate Card Test Type or Daily Only Type, plus linked equipment and rate
cards. These names appear in the live category picker. The earlier owner-authorized
reset retained all equipment, so the categories cannot simply be deleted.

## Decision and implementation

Keep every equipment record and every legitimate category, including empty ones.
Move units from the known fixture categories to the existing Others category;
do not guess their real classification. Remove only fixture categories and their
unused rates. The cleanup fails if a historical quotation item cites a fixture
category or rate. All other equipment fields and tenant IDs remain identical.

The CLI defaults to a read-only preview. Explicit --apply requires an administrative
connection, locks all four affected tables, saves and verifies a local compressed
backup, makes the updates/deletes and compares complete retained rows before
commit. It uses exact anchored fixture patterns confirmed against the three API
test suites and the live inventory. Unknown category names are preserved. No
cascading deletes, schema changes, RLS changes, dependencies or automatic deploy
cleanup are introduced.

The operational procedure and recovery order live in runbook-deploy-supabase.md
section 6. The planner's regression tests are included in the existing CI database
suite. Test fixtures may return if integration tests target the demo database.

## Verification

- Safety regression suite: 21 passed.
- Database package typecheck and build: passed.
- Lint for the three changed TypeScript files: passed.
- Repository-wide lint: blocked by the existing nested .claude/worktrees/jarvis ESLint tsconfigRootDir ambiguity, including files outside this change.
- Live preview: 71 fixture categories, 771 linked units, 137 unused fixture rate cards.
- Live apply: committed; removed those categories and rates, moved the 771 units to Others, preserved all 2,039 equipment records and complete unrelated category/rate/quote rows.
- Fresh read-only preview: zero fixture categories and rates remain; 24 legitimate categories and all 2,039 units retained.
- Compressed four-table backup saved and verified locally before the transaction changed data.
- Full pnpm test / pnpm e2e not run locally: DB-backed suites require fixture accounts/data removed by the earlier requested reset and would repopulate the clean hosted dataset. The existing CI integration suite runs against throwaway Postgres and now includes the new regression file. No frontend or money-path implementation changed.

## Review gates

- Tenant-isolation checker: PASS; tenant IDs and all other unit fields preserved.
- Migration-RLS guardian: PASS; no schema/RLS changes, verified backup and atomic rollback.
- OCR worker and AI abuse runner: not applicable; no OCR or reconciliation implementation changes.
- Restraint guardian: PASS; no unnecessary dependency, schema change or removed control.

## Sources

- [PostgreSQL DELETE](https://www.postgresql.org/docs/17/sql-delete.html): parameterized, predicate-scoped DELETE and RETURNING.
- [PostgreSQL LOCK](https://www.postgresql.org/docs/17/sql-lock.html): transaction-scoped table locks.
- [Postgres.js transactions](https://github.com/porsager/postgres#transactions): reserved transaction connection and rollback on thrown error.
