-- CR: pricebook-kyc-weather. The fixed price book is keyed by equipment
-- type x size class, so an excavator's price depends on its class instead
-- of one rate for every excavator. Both columns are nullable: existing cards
-- stay type-wide and existing units stay unclassed. Both tables are already
-- tenant-scoped under RLS; adding a column does not change their policies.
ALTER TABLE rate_cards ADD COLUMN size_class text;--> statement-breakpoint
ALTER TABLE rate_cards ADD CONSTRAINT rate_cards_size_class_chk
  CHECK (size_class IS NULL OR size_class IN ('mini','small','medium','large','extra_large'));--> statement-breakpoint
ALTER TABLE equipment ADD COLUMN size_class text;--> statement-breakpoint
ALTER TABLE equipment ADD CONSTRAINT equipment_size_class_chk
  CHECK (size_class IS NULL OR size_class IN ('mini','small','medium','large','extra_large'));--> statement-breakpoint
-- equipment UPDATE is column-granted (migration 0026); the size class is
-- edited from the equipment form like the other spec fields.
GRANT UPDATE (size_class) ON equipment TO app_authenticated;
