-- Tenant-wide minimum rental hours. billing_settings already carries RLS (0038).
ALTER TABLE "billing_settings" ADD COLUMN IF NOT EXISTS "min_hours" numeric(8, 2) DEFAULT '0' NOT NULL;
