-- Hand-authored, additive (customer feedback 5: map pin fills the address).
-- A Philippine address names its barangay; postal_code already exists.
ALTER TABLE "addresses" ADD COLUMN IF NOT EXISTS "barangay" text;
