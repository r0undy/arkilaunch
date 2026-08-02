CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"name" text NOT NULL,
	"properties" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "timekeeper_site_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"project_site_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "timekeeper_site_assignments_tenant_id_user_id_project_site_id_unique" UNIQUE("tenant_id","user_id","project_site_id")
);
--> statement-breakpoint
ALTER TABLE "timekeeper_site_assignments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "edtr" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "edtr" ADD COLUMN "locked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "edtr" ADD COLUMN "last_error" text;--> statement-breakpoint
ALTER TABLE "kyc_documents" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "kyc_documents" ADD COLUMN "locked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "kyc_documents" ADD COLUMN "last_error" text;--> statement-breakpoint
ALTER TABLE "kyc_documents" ADD COLUMN "format_valid" jsonb;--> statement-breakpoint
ALTER TABLE "kyc_documents" ADD COLUMN "portal_match_score" numeric(5, 4);--> statement-breakpoint
ALTER TABLE "kyc_documents" ADD COLUMN "registry_status" text;--> statement-breakpoint
ALTER TABLE "quotation_items" ADD COLUMN "estimated_hours" numeric(8, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "quotation_items" ADD COLUMN "pricing_inputs" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "quotation_items" ADD COLUMN "hourly_rate_php" numeric(12, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "quotation_items" ADD COLUMN "operating_cost_php" numeric(14, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "quotation_items" ADD COLUMN "mobilization_cost_php" numeric(14, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "quotation_items" ADD COLUMN "demobilization_cost_php" numeric(14, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "quotation_items" ADD COLUMN "buffer_php" numeric(14, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "quotation_items" ADD COLUMN "subtotal_php" numeric(14, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "quotations" ADD COLUMN "diesel_price_reading_id" uuid;--> statement-breakpoint
ALTER TABLE "quotations" ADD COLUMN "diesel_price_date" text;--> statement-breakpoint
ALTER TABLE "quotations" ADD COLUMN "diesel_price_source" text;--> statement-breakpoint
ALTER TABLE "quotations" ADD COLUMN "pricing_params_id" uuid;--> statement-breakpoint
ALTER TABLE "quotations" ADD COLUMN "parent_quotation_id" uuid;--> statement-breakpoint
ALTER TABLE "quotations" ADD COLUMN "discount_type" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "quotations" ADD COLUMN "discount_value" numeric(12, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "quotations" ADD COLUMN "subtotal_php" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "quotations" ADD COLUMN "total_php" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "quotations" ADD COLUMN "printable_url" text;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timekeeper_site_assignments" ADD CONSTRAINT "timekeeper_site_assignments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timekeeper_site_assignments" ADD CONSTRAINT "timekeeper_site_assignments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timekeeper_site_assignments" ADD CONSTRAINT "timekeeper_site_assignments_project_site_id_project_sites_id_fk" FOREIGN KEY ("project_site_id") REFERENCES "public"."project_sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_diesel_price_reading_id_diesel_price_readings_id_fk" FOREIGN KEY ("diesel_price_reading_id") REFERENCES "public"."diesel_price_readings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_pricing_params_id_pricing_parameters_id_fk" FOREIGN KEY ("pricing_params_id") REFERENCES "public"."pricing_parameters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_parent_quotation_id_quotations_id_fk" FOREIGN KEY ("parent_quotation_id") REFERENCES "public"."quotations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edtr" ADD CONSTRAINT "edtr_status_chk" CHECK ("edtr"."status" IN ('queued','extracting','extracted','review','reconciled','hard_failed'));--> statement-breakpoint
ALTER TABLE "edtr_line_items" ADD CONSTRAINT "edtr_hours_nonneg_chk" CHECK ("edtr_line_items"."hours_active" >= 0 AND "edtr_line_items"."hours_idle" >= 0);--> statement-breakpoint
ALTER TABLE "edtr_reconciliations" ADD CONSTRAINT "edtr_recon_status_chk" CHECK ("edtr_reconciliations"."status" IN ('pending','matched','discrepancy','approved','rejected'));--> statement-breakpoint
ALTER TABLE "quotation_items" ADD CONSTRAINT "hours_positive" CHECK ("quotation_items"."estimated_hours" >= 0);--> statement-breakpoint
ALTER TABLE "quotation_items" ADD CONSTRAINT "km_positive" CHECK ("quotation_items"."mobilization_km" >= 0 AND "quotation_items"."demobilization_km" >= 0);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "events" AS PERMISSIVE FOR ALL TO "app_authenticated" USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "timekeeper_site_assignments" AS PERMISSIVE FOR ALL TO "app_authenticated" USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);