-- Hand-authored, additive (customer feedback 5: expressway toll matrix).
-- A toll rate can be one expressway entry-to-exit fee for a vehicle class
-- (loaded from the PH Class 3 matrix and editable), beside the free-named
-- tolls admins already add. as_of dates the published fee.
ALTER TABLE "toll_rates" ADD COLUMN IF NOT EXISTS "expressway" text;--> statement-breakpoint
ALTER TABLE "toll_rates" ADD COLUMN IF NOT EXISTS "entry_point" text;--> statement-breakpoint
ALTER TABLE "toll_rates" ADD COLUMN IF NOT EXISTS "exit_point" text;--> statement-breakpoint
ALTER TABLE "toll_rates" ADD COLUMN IF NOT EXISTS "vehicle_class" integer DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE "toll_rates" ADD COLUMN IF NOT EXISTS "as_of" date;
