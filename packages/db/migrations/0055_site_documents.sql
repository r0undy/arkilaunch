-- Hand-authored, additive. Proof a customer's project site is real and
-- theirs to work on, required before the site takes a booking or a truck
-- trip; and the site a truck trip serves, so staff can open that proof.
--
-- 1. site_documents: full RFC-1 §3 five-element isolation.
CREATE TABLE IF NOT EXISTS "site_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL REFERENCES "public"."tenants"("id") ON DELETE restrict,
	"project_site_id" uuid NOT NULL REFERENCES "public"."project_sites"("id"),
	"document_type" text NOT NULL,
	"file_uri" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"uploaded_by" uuid REFERENCES "public"."users"("id"),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "site_documents_type_valid" CHECK ("document_type" IN ('site_photo','building_permit','ntp_or_contract','lot_title_or_lease','barangay_clearance')),
	CONSTRAINT "site_documents_status_valid" CHECK ("status" IN ('pending','verified','rejected'))
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "site_documents_tenant_id_idx" ON "site_documents" ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "site_documents_project_site_id_idx" ON "site_documents" ("project_site_id");--> statement-breakpoint
ALTER TABLE "site_documents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "site_documents" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "site_documents";--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "site_documents" AS PERMISSIVE FOR ALL TO "app_authenticated" USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "site_documents" TO app_authenticated;--> statement-breakpoint
-- 2. The site a truck trip serves (null on requests made before this).
ALTER TABLE "truck_requests" ADD COLUMN IF NOT EXISTS "project_site_id" uuid REFERENCES "public"."project_sites"("id");
