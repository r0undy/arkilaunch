# Audit — database tenant isolation & data integrity

Status: Findings (not Locked). Date: 2026-09-19.
Scope: `packages/db/src/schema/*.ts`, `packages/db/src/rls.ts`, `packages/db/migrations/0000..0016`,
`migrations/meta/*`, and the money-path callers in `apps/api/src/{edtr,billing,payments}`.

This was a read-only audit. **Updated 2026-09-19:** each finding now carries its disposition.
The migrations landed under `cr-arkilaunch-doc-reconcile-2026-09-19.md`'s sibling code commits and
are applied to dev.

## HIGH

### 1. Drizzle snapshot drift will DROP the live `tenants` RLS policy and both composite uniques
**CLOSED** (`2695d79`, migration `0018`). All three declared in the Drizzle schema; `drizzle-kit generate` now answers "No schema changes, nothing to migrate" instead of proposing the drops.
`migrations/meta/0013_snapshot.json` vs `migrations/0016_reference_table_grants.sql:60-68`,
`0002_force_rls_and_grants.sql:42-43`

The snapshot is what `drizzle-kit generate` diffs against. In it `public.tenants` has
`policies: {}` and `isRLSEnabled: false`, and `users` / `equipment` have `uniqueConstraints: {}`.
The live DB has `ENABLE/FORCE RLS` + policy `tenant_self` on `tenants`, plus
`users_tenant_email_uq (tenant_id, email)` and `equipment_tenant_serial_uq (tenant_id, serial_no)`.
None of the three is expressed in the Drizzle schema (`schema/tenancy.ts:6-13`, `:62-79`,
`schema/fleet.ts:11-28` — only a comment "see migration").

The next `drizzle-kit generate` emits `DROP POLICY "tenant_self" ON tenants` and drops both
uniques. Applying it re-opens full cross-tenant read of the tenant registry (legal_name, slug,
status, kyc_state) and allows duplicate emails per tenant and duplicate serials.

### 2. Zero indexes exist anywhere in the schema or in any migration
**CLOSED** (`2695d79`, migration `0019`). 34 indexes. `users`, `equipment` and `edtr` deliberately get none on `tenant_id` alone, since each already carries a composite leading with it.
No `index()` in any of the 9 schema files; no `CREATE INDEX` in any migration; `indexes` empty
for all 39 tables in the snapshot.

Every `tenant_id` is unindexed while RLS appends `tenant_id = current_setting(...)` to every
query, so each tenant-scoped read seq-scans all tenants' rows. Unindexed hot paths:
`invoices.rental_id` + `invoice_type` (`deposit-ledger.ts:49-53`, read on every EDTR approve),
`edtr (tenant_id, equipment_id, report_date)` (`reconciliation.ts:75-86`),
`edtr_line_items.edtr_id`, `edtr(status, locked_at)` for the worker claim loop, and `users.email`
in `auth_find_user_by_email`. Latency scales with total platform rows, not tenant rows.

### 3. The deduction-to-reconciliation evidence link is a regex-parsed string, not a foreign key
**CLOSED** (`2695d79`). Real FK plus backfill; the reader prefers it and keeps the regex only for rows the backfill could not resolve.
`apps/api/src/edtr/edtr.service.ts:550-553` (writer), `apps/api/src/billing/billing.service.ts:41-45`
(reader), `schema/billing.ts:117-133`

`invoice_line_items` has no `reconciliation_id` or `edtr_id`. The only tie between a
`deposit_deduction` invoice and the reconciliation justifying it is the sentence
`"EDTR reconciliation <uuid> (sources: <uuid>, <uuid>)"` in `description`, a plain `text NOT NULL`.
No referential integrity: a deduction's audit trail can be broken or forged by a text edit, and
`findEdtrEvidence` returns `null` on any format change. This is the RFC-2 money path.

### 4. No unique constraint on the EDTR equipment-day key that reconciliation pairs on
**OPEN -- deferred deliberately.** The dev database holds 389 duplicate rows in the `test-tenant-a` fixture; clearing them cascades into 343 line items, 396 reconciliation references (11 of them `approved`) and 10 deduction lines. That is a data decision, not a migration side effect. The real pilot tenant has zero duplicates, so the constraint is safe for production data once the fixture is cleaned. Recorded in a comment on the `edtr` table.
`schema/billing.ts:12-43`; pairing query `reconciliation.ts:75-88`

RFC-2 is "two independent logs per equipment-day", but nothing prevents N rows per
`(tenant_id, equipment_id, report_date, source)`. `reconcileEdtr` takes `candidates.find(...)` —
the first arbitrary row of an unordered scan. A resubmitted paper OCR row makes counterpart
selection nondeterministic, and each extra row is a fresh chance for a separate approve and a
separate `deposit_deduction` invoice for the same equipment-day.

### 5. No CHECK constraints on any money amount
**CLOSED** (`2695d79`, migration `0019`). Verified zero existing violations before adding.
`schema/billing.ts:109`, `:129-130`, `:149`, `schema/rentals.ts:172`; confirmed absent in
`0001_real_tattoo.sql:47,56,68,320` — those numeric columns carry `NOT NULL` and nothing else.

The DB accepts negative amounts. The only over-deduction guard is app code
(`edtr.service.ts:516-524`), skipped entirely when `depositRequired` is null (`:526-535`, the
bookings-created-rental case). A negative `deposit_deduction` also *increases* the remaining
balance in `resolveDepositLedger` (`deposit-ledger.ts:60`). The non-money tables do have checks
(`edtr_hours_nonneg_chk`, `buffer_range`, `price_sane`); the money path is the one without.

## MEDIUM

### 6. Every foreign key is single-column, so a row can reference another tenant's parent
**OPEN -- deferred.** ~40 composite `(tenant_id, id)` FKs is a schema pass of its own.
`schema/billing.ts:105-107`, `:124-126`, `:52-54`, `schema/rentals.ts:65-70`, ~40 more.
No composite `(tenant_id, id)` FK exists. FK validation runs with RLS bypassed, so an INSERT with
`tenant_id = A` and a `rental_id` belonging to B passes both the `tenant_isolation` WITH CHECK
(it only checks `tenant_id`) and the FK check. The row is invisible to B under RLS but corrupts
B's aggregates on any SECURITY DEFINER or service_role read.

### 7. `app_authenticated` holds INSERT on the global, un-RLS'd `diesel_price_readings`
**CLOSED** (`2695d79`, migrations `0020`/`0021`). Revoked to SELECT; both writers go through SECURITY DEFINER functions that each hard-code their own `source`. Note for the record: this audit states writes come from "the service_role cron", and migration 0005's comment assumed the same, but the DOE scrape runs on the same pooled `app_authenticated` client as every request path. Revoking without moving the scrape would have silently broken the daily diesel refresh.
`0005_diesel_manual_entry_grant.sql:11`; table `schema/pricing.ts:10-26`

Granted so a platform-admin manual-entry route works, gated only by an app-layer `diesel:manage`
check. 0007 and 0016 took the opposite decision for the other global reference tables (revoke to
SELECT). One missing permission check on any route reaching this table lets any authenticated
user insert a diesel price (bounded only by `price_sane BETWEEN 20 AND 150`) that every tenant's
quote formula then freezes into its pricing.

### 8. `payments.provider_ref` is nullable-unique, so webhook idempotency is not DB-enforced
**OPEN -- deferred, with a correction.** NOT NULL is not available as a fix: the refund path in `payments.service.ts` inserts a payments row without a `provider_ref` at all, so the column is legitimately null for refunds. Enforcing idempotency properly means giving refunds their own provider-side key first.
`schema/billing.ts:150`. The comment at `:135-137` calls this unique the mechanism for PayMongo
webhook idempotency, but the column is nullable and Postgres allows unlimited NULLs in a unique
index. `0006_paymongo_webhook_lookup.sql:15-22` documents that the webhook resolves the tenant by
`invoice_id`, not `provider_ref` — the key the comment relies on is not the key in use. A retried
webhook landing before `provider_ref` is set inserts a duplicate `payments` row.

## LOW

### 9. `events.tenant_id` is nullable under an equality RLS policy
**OPEN -- record only,** as the audit itself recommends. Fail-closed, not a leak.
`schema/events.ts:17-27` (the comment at `:8-16` already records this as open), `rls.ts:13-21`,
`0003_chubby_blue_shield.sql:3,59`. `tenant_id = current_setting(...)` is NULL for a NULL-tenant
row, which Postgres rejects in WITH CHECK and hides in USING. Platform-level events are therefore
write-only via the superuser client and unreadable through the app role. Fail-closed, so not a
leak.

## Clean

- **Tenant tables with no `tenant_id`:** none. All 32 tenant-owned tables carry
  `tenant_id uuid NOT NULL` FK to `tenants(id) ON DELETE restrict`. The 7 without one are
  genuinely global and match `EXPECTED_GLOBAL_TABLES` in `test/rls-enumeration.spec.ts:21-33`.
- **Incomplete policy sets:** none. `tenantIsolationPolicy()` (`rls.ts:13-21`) is `FOR ALL` with
  both USING and WITH CHECK via one shared helper across all 32 tables, each also
  `FORCE ROW LEVEL SECURITY`. Verbs are narrowed where intended (append-only `audit_logs`;
  `GRANT UPDATE (effective_to)` only on `rate_cards`/`pricing_parameters`).
- **Destructive migrations without a backfill:** none. All 17 are additive. The only DROP is
  `DROP POLICY IF EXISTS "tenant_self"` immediately before recreating it (0016:64-68).
- **Migrations with no schema definition:** none; the snapshot's 39 tables match Drizzle exactly.
  The drift runs the other way — finding #1.

## Suggested order

#1 first (it silently undoes work already done), then #3/#4/#5 together as one money-path
migration, then #2.
