-- Hand-authored, additive. A reviewer's comment on a pending company and
-- the fields/documents it unlocks for the customer to fix. Both columns sit
-- on customers, which already carries tenant_id and its RLS policy
-- (tenantIsolationPolicy), so no new policy is needed. IF NOT EXISTS keeps it
-- safe to re-run.
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "review_comment" text;
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "unlocked_fields" jsonb DEFAULT '[]'::jsonb NOT NULL;
