ALTER TABLE "equipment" ADD COLUMN "model_number" text;--> statement-breakpoint
ALTER TABLE "equipment" ADD COLUMN "year_of_manufacture" integer;--> statement-breakpoint
ALTER TABLE "equipment" ADD COLUMN "weight_capacity_tons" numeric(8, 2);--> statement-breakpoint
ALTER TABLE "equipment" ADD COLUMN "engine_type" text;--> statement-breakpoint
ALTER TABLE "equipment" ADD COLUMN "fuel_type" text;--> statement-breakpoint
ALTER TABLE "equipment" ADD COLUMN "notes" text;--> statement-breakpoint
ALTER TABLE "equipment" ADD COLUMN "photo_uri" text;--> statement-breakpoint
ALTER TABLE "equipment" ADD COLUMN "retired_at" timestamp with time zone;