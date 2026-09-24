-- Hand-authored, additive (feedback batch phase 7: deposit rollover).
--
-- Approved, reconciled hours past the deposit balance no longer fail with
-- deposit_exhausted: the overflow is recorded here as unbilled, and the
-- weekly-billing job rolls unbilled rows into one invoice_type='weekly'
-- invoice per rental (invoice_id set once billed). Every row points at the
-- approved reconciliation behind it (RFC-2). Full RFC-1 §3 isolation.
CREATE TABLE IF NOT EXISTS "deposit_accruals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL REFERENCES "public"."tenants"("id") ON DELETE restrict,
	"rental_id" uuid NOT NULL REFERENCES "public"."rentals"("id"),
	"reconciliation_id" uuid NOT NULL REFERENCES "public"."edtr_reconciliations"("id"),
	"hours" numeric(10, 2) NOT NULL,
	"unit_price" numeric(12, 2) NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"invoice_id" uuid REFERENCES "public"."invoices"("id"),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deposit_accruals_amount_positive" CHECK ("amount" > 0),
	CONSTRAINT "deposit_accruals_reconciliation_unique" UNIQUE ("reconciliation_id")
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "deposit_accruals_tenant_id_idx" ON "deposit_accruals" ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "deposit_accruals_unbilled_idx" ON "deposit_accruals" ("rental_id") WHERE "invoice_id" IS NULL;--> statement-breakpoint
ALTER TABLE "deposit_accruals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "deposit_accruals" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "deposit_accruals";--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "deposit_accruals" AS PERMISSIVE FOR ALL TO "app_authenticated" USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
GRANT SELECT, INSERT ON "deposit_accruals" TO app_authenticated;--> statement-breakpoint
GRANT UPDATE ("invoice_id") ON "deposit_accruals" TO app_authenticated;
