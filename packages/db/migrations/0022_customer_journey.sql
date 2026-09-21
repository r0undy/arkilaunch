CREATE TABLE "booking_change_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"rental_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"requested_end" timestamp with time zone,
	"reason" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"requested_by" uuid NOT NULL,
	"resolved_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "booking_change_requests_kind_chk" CHECK ("booking_change_requests"."kind" IN ('extend', 'cancel')),
	CONSTRAINT "booking_change_requests_status_chk" CHECK ("booking_change_requests"."status" IN ('pending', 'approved', 'rejected')),
	CONSTRAINT "booking_change_requests_extend_end_chk" CHECK ("booking_change_requests"."kind" <> 'extend' OR "booking_change_requests"."requested_end" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "booking_change_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "negotiation_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"rental_id" uuid NOT NULL,
	"author_user_id" uuid NOT NULL,
	"author_role" text NOT NULL,
	"body" text NOT NULL,
	"offer_php" numeric(14, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "negotiation_messages_offer_nonneg_chk" CHECK ("negotiation_messages"."offer_php" IS NULL OR "negotiation_messages"."offer_php" >= 0)
);
--> statement-breakpoint
ALTER TABLE "negotiation_messages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "rentals" ADD COLUMN "site_contact" text;--> statement-breakpoint
ALTER TABLE "rentals" ADD COLUMN "site_notes" text;--> statement-breakpoint
ALTER TABLE "booking_change_requests" ADD CONSTRAINT "booking_change_requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_change_requests" ADD CONSTRAINT "booking_change_requests_rental_id_rentals_id_fk" FOREIGN KEY ("rental_id") REFERENCES "public"."rentals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_change_requests" ADD CONSTRAINT "booking_change_requests_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_change_requests" ADD CONSTRAINT "booking_change_requests_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "negotiation_messages" ADD CONSTRAINT "negotiation_messages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "negotiation_messages" ADD CONSTRAINT "negotiation_messages_rental_id_rentals_id_fk" FOREIGN KEY ("rental_id") REFERENCES "public"."rentals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "negotiation_messages" ADD CONSTRAINT "negotiation_messages_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "booking_change_requests_tenant_id_idx" ON "booking_change_requests" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "booking_change_requests_rental_id_idx" ON "booking_change_requests" USING btree ("rental_id");--> statement-breakpoint
CREATE INDEX "negotiation_messages_tenant_id_idx" ON "negotiation_messages" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "negotiation_messages_rental_id_idx" ON "negotiation_messages" USING btree ("rental_id");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "booking_change_requests" AS PERMISSIVE FOR ALL TO "app_authenticated" USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "negotiation_messages" AS PERMISSIVE FOR ALL TO "app_authenticated" USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
-- Hand-appended (drizzle-kit has no FORCE RLS or grants; same split as 0004/0014).
ALTER TABLE "negotiation_messages" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "booking_change_requests" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "negotiation_messages", "booking_change_requests" TO app_authenticated;
