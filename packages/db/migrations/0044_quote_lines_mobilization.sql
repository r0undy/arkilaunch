-- Hand-authored, additive (customer feedback 5: multi-line quotes).
--
-- A quote line is now either catalog equipment (rate card, as before) or a
-- free-text item the admin prices by hand, so the rate card and type go
-- nullable for 'custom' lines only (the CHECK keeps equipment lines whole).
-- Mobilization/demobilization become one flat peso amount per quote, with
-- a company default in billing_settings; the per-line km columns stay for
-- old rows and are no longer written.
ALTER TABLE "quotation_items" ADD COLUMN IF NOT EXISTS "kind" text DEFAULT 'equipment' NOT NULL;--> statement-breakpoint
ALTER TABLE "quotation_items" ADD COLUMN IF NOT EXISTS "description" text;--> statement-breakpoint
ALTER TABLE "quotation_items" ALTER COLUMN "equipment_type_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "quotation_items" ALTER COLUMN "rate_card_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "quotation_items" DROP CONSTRAINT IF EXISTS "quotation_items_kind_shape";--> statement-breakpoint
ALTER TABLE "quotation_items" ADD CONSTRAINT "quotation_items_kind_shape" CHECK (
  ("kind" = 'equipment' AND "equipment_type_id" IS NOT NULL AND "rate_card_id" IS NOT NULL)
  OR ("kind" = 'custom' AND "description" IS NOT NULL)
);--> statement-breakpoint
ALTER TABLE "quotations" ADD COLUMN IF NOT EXISTS "mobilization_php" numeric(14, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "quotations" ADD COLUMN IF NOT EXISTS "demobilization_php" numeric(14, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "billing_settings" ADD COLUMN IF NOT EXISTS "mobilization_php" numeric(12, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "billing_settings" ADD COLUMN IF NOT EXISTS "demobilization_php" numeric(12, 2) DEFAULT '0' NOT NULL;
