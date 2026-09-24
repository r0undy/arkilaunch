-- Hand-authored. docs/cr-arkilaunch-truck-booking-and-kyc-docs.md.
-- A truck request is negotiated, invoiced and paid like a rental, on the
-- same negotiation_messages / invoices tables. Each row now belongs to
-- exactly one parent: a rental OR a truck request (CHECK below), so no
-- existing rental row changes meaning. No new table: tenant RLS on every
-- touched table is unchanged.
ALTER TABLE "negotiation_messages" ALTER COLUMN "rental_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "negotiation_messages" ADD COLUMN IF NOT EXISTS "truck_request_id" uuid REFERENCES "public"."truck_requests"("id");--> statement-breakpoint
ALTER TABLE "negotiation_messages" ADD CONSTRAINT "negotiation_messages_one_parent_chk" CHECK (num_nonnulls("rental_id", "truck_request_id") = 1);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "negotiation_messages_truck_request_id_idx" ON "negotiation_messages" ("truck_request_id");--> statement-breakpoint
ALTER TABLE "invoices" ALTER COLUMN "rental_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "truck_request_id" uuid REFERENCES "public"."truck_requests"("id");--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_one_parent_chk" CHECK (num_nonnulls("rental_id", "truck_request_id") = 1);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoices_truck_request_id_idx" ON "invoices" ("truck_request_id");--> statement-breakpoint
-- The price staff accepted in the negotiation; what the truck invoice charges.
ALTER TABLE "truck_requests" ADD COLUMN IF NOT EXISTS "agreed_price_php" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "truck_requests" DROP CONSTRAINT IF EXISTS "truck_requests_status_valid";--> statement-breakpoint
ALTER TABLE "truck_requests" ADD CONSTRAINT "truck_requests_status_valid" CHECK ("status" IN ('estimated','km_confirmed','agreed','paid','cancelled'));--> statement-breakpoint
-- Cash is recorded by a staff member by hand, never by a webhook; who
-- recorded it is kept on the payment row.
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "recorded_by_user_id" uuid REFERENCES "public"."users"("id");
