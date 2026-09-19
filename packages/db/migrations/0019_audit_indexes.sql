-- Indexes and money-path integrity (audit-db-tenant-isolation.md #2, #3,
-- #5 and audit-ocr-money-path.md #1, #7).
--
-- Order matters here: the two data repairs run BEFORE the constraints
-- that depend on them, because both constraints would otherwise fail
-- against the existing database.

-- ---------------------------------------------------------------------
-- #3: a real link from a deduction line to the reconciliation behind it.
-- The only tie was the sentence "EDTR reconciliation <uuid> (sources:
-- ...)" in a free-text column, parsed back out with a regex -- no
-- referential integrity, and findEdtrEvidence returned null on any
-- format change.
-- ---------------------------------------------------------------------
ALTER TABLE "invoice_line_items" ADD COLUMN "reconciliation_id" uuid;--> statement-breakpoint
ALTER TABLE "invoice_line_items" ADD CONSTRAINT "invoice_line_items_reconciliation_id_edtr_reconciliations_id_fk" FOREIGN KEY ("reconciliation_id") REFERENCES "public"."edtr_reconciliations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

-- Backfill from the text the writer has been emitting since the deduction
-- path shipped: "EDTR reconciliation <uuid> (sources: <uuid>, <uuid>)".
-- Only rows whose embedded id still resolves to a live reconciliation are
-- linked; anything else is left NULL rather than guessed at, so a broken
-- or hand-edited description stays visibly broken.
UPDATE invoice_line_items ili
SET reconciliation_id = r.id
FROM edtr_reconciliations r
WHERE ili.reconciliation_id IS NULL
  AND ili.tenant_id = r.tenant_id
  AND ili.description LIKE 'EDTR reconciliation %'
  AND substring(ili.description from 'EDTR reconciliation ([0-9a-f-]{36})') = r.id::text;--> statement-breakpoint

-- ---------------------------------------------------------------------
-- audit-ocr-money-path.md #1 repair. Five rows in the pilot tenant sit at
-- status='approved' with counterpart_edtr_id IS NULL -- approved with no
-- second log behind them, which is the exact state the CHECK below
-- forbids. Verified before writing this: none of the five is referenced
-- by any invoice_line_items row, so no deduction was ever raised from
-- them and moving them back is not rewriting a financial record. They
-- return to 'pending', which is the truthful state: they were never
-- legitimately gated. The seed that produces this shape is corrected in
-- the same change.
-- ---------------------------------------------------------------------
UPDATE edtr_reconciliations
SET status = 'pending'
WHERE status IN ('matched','approved')
  AND counterpart_edtr_id IS NULL;--> statement-breakpoint

-- ---------------------------------------------------------------------
-- Constraints.
-- ---------------------------------------------------------------------
ALTER TABLE "edtr_line_items" ADD CONSTRAINT "edtr_line_items_edtr_id_uq" UNIQUE("edtr_id");--> statement-breakpoint
ALTER TABLE "edtr_reconciliations" ADD CONSTRAINT "edtr_recon_matched_needs_counterpart_chk" CHECK ("edtr_reconciliations"."status" NOT IN ('matched','approved') OR "edtr_reconciliations"."counterpart_edtr_id" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "invoice_line_items" ADD CONSTRAINT "invoice_line_items_nonneg_chk" CHECK ("invoice_line_items"."quantity" >= 0 AND "invoice_line_items"."unit_price" >= 0 AND "invoice_line_items"."amount" >= 0);--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_amount_nonneg_chk" CHECK ("invoices"."amount" >= 0);--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_amount_nonneg_chk" CHECK ("payments"."amount" >= 0);--> statement-breakpoint
ALTER TABLE "rental_contracts" ADD CONSTRAINT "rental_contracts_deposit_nonneg_chk" CHECK ("rental_contracts"."deposit_required" >= 0);--> statement-breakpoint

-- ---------------------------------------------------------------------
-- #2: there was not one index in the schema or in any of the previous 18
-- migrations, while RLS appends tenant_id = current_setting(...) to every
-- query on all 32 tenant-owned tables, so every tenant-scoped read
-- seq-scanned every tenant's rows.
--
-- Not indexed on purpose: users, equipment and edtr already carry a
-- composite leading with tenant_id, so a separate one would only tax
-- writes.
--
-- Plain CREATE INDEX, not CONCURRENTLY: drizzle runs a migration inside a
-- transaction and CONCURRENTLY cannot run in one. Brief ACCESS EXCLUSIVE
-- lock per table, acceptable at pilot volumes.
-- ---------------------------------------------------------------------
CREATE INDEX "edtr_tenant_equipment_date_idx" ON "edtr" USING btree ("tenant_id","equipment_id","report_date");--> statement-breakpoint
CREATE INDEX "edtr_status_locked_at_idx" ON "edtr" USING btree ("status","locked_at");--> statement-breakpoint
CREATE INDEX "edtr_line_items_tenant_id_idx" ON "edtr_line_items" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "edtr_reconciliations_tenant_id_idx" ON "edtr_reconciliations" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "invoice_line_items_tenant_id_idx" ON "invoice_line_items" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "invoice_line_items_reconciliation_id_idx" ON "invoice_line_items" USING btree ("reconciliation_id");--> statement-breakpoint
CREATE INDEX "invoices_tenant_id_idx" ON "invoices" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "invoices_rental_id_type_idx" ON "invoices" USING btree ("rental_id","invoice_type");--> statement-breakpoint
CREATE INDEX "payments_tenant_id_idx" ON "payments" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "addresses_tenant_id_idx" ON "addresses" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "customer_addresses_tenant_id_idx" ON "customer_addresses" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "customer_contacts_tenant_id_idx" ON "customer_contacts" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "customers_tenant_id_idx" ON "customers" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "kyc_documents_tenant_id_idx" ON "kyc_documents" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "events_tenant_id_idx" ON "events" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "maintenance_logs_tenant_id_idx" ON "maintenance_logs" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "maintenance_schedules_tenant_id_idx" ON "maintenance_schedules" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "rate_cards_tenant_id_idx" ON "rate_cards" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "audit_logs_tenant_id_idx" ON "audit_logs" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "refresh_tokens_tenant_id_idx" ON "refresh_tokens" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "subscriptions_tenant_id_idx" ON "subscriptions" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "tenant_applications_tenant_id_idx" ON "tenant_applications" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "users_email_idx" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "equipment_assignments_tenant_id_idx" ON "equipment_assignments" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "project_sites_tenant_id_idx" ON "project_sites" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "quotation_items_tenant_id_idx" ON "quotation_items" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "quotations_tenant_id_idx" ON "quotations" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "rental_contracts_tenant_id_idx" ON "rental_contracts" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "rentals_tenant_id_idx" ON "rentals" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "timekeeper_site_assignments_tenant_id_idx" ON "timekeeper_site_assignments" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "notifications_tenant_id_idx" ON "notifications" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "weather_alerts_tenant_id_idx" ON "weather_alerts" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "pricing_parameters_tenant_id_idx" ON "pricing_parameters" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "testimonials_tenant_id_idx" ON "testimonials" USING btree ("tenant_id");
