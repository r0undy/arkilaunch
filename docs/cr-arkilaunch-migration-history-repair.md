# Change Record: Repair reused migration history

**ID:** cr-arkilaunch-migration-history-repair
**Date:** 2026-09-30
**Status:** Applied
**Trigger:** The dev Deploy workflow failed after PRs #153 and #154 at migration 0072 with `truck_settings.round_trip_multiplier already exists`.

## Decision

Keep the existing truck pricing columns and data. Make 0072 safe to run when the earlier truck policy migration already created those columns and constraints. Add forward migration 0073 to retire any still-current non-hourly rate cards and install the hourly-only check where the earlier 0071 timestamp collision skipped it. Do not edit the live migration ledger or drop and recreate the columns.

## Evidence

The original truck pricing migration shipped as `0071_truck_pricing_policy` at timestamp `1790400032000`, then its source file and journal entry were reverted without a database rollback. The hourly-rate migration later reused that timestamp as `0071_hourly_rate_cards`. Drizzle considered the timestamp applied, so the hourly migration did not run on the dev database. After the truck policy returned as 0072, Deploy tried to add its existing columns and stopped before rolling out the API or web app.

A read-only dev database check found the five truck pricing columns and both truck constraints present, the latest migration ledger row at `1790400032000`, and no `rate_cards_hourly_only_chk` constraint.

## Implementation

- Migration 0072 uses `ADD COLUMN IF NOT EXISTS` and conditionally creates its two constraints. Its definitions match the original truck policy migration. Existing tenant rows and pricing values remain intact.
- Migration 0073 repeats the intended hourly-rate retirement and adds the `NOT VALID` hourly-only check only when absent. Historical non-hourly cards remain available to old quotations.
- The journal gives 0073 a new, increasing timestamp. No request-path role, table ownership, tenant key, RLS policy, or API permission changes.

## Verification

- Both SQL files executed successfully inside a transaction against the existing dev schema, then the transaction was rolled back. Inside it, the hourly constraint existed and no non-hourly card remained in force.
- SAD-A1 tenant-isolation-checker: PASS. SAD-A2 migration-rls-guardian: PASS.
- CI and the subsequent dev Deploy workflow provide the final fresh-schema and rollout checks.
