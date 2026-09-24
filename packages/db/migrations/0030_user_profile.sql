-- Hand-authored. Additive, non-destructive: nullable columns plus one with a
-- default, on a table that already carries tenant_id and its RLS policy.
--
-- Customer settings (profile, notification preferences). Names stay where
-- they are -- first/middle/last are written by a KYC approval only.
-- avatar_key is an object key in the private KYC bucket, served through a
-- short-lived signed URL; it is never a public link.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "phone" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "address" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "avatar_key" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "notification_prefs" jsonb NOT NULL DEFAULT '{"email":true,"sms":false,"inApp":true}'::jsonb;
