-- Hand-authored, additive. The registration review is approve-or-reject:
-- a rejection carries a reason code, the reviewer's note and the papers
-- that cure it, and the customer reapplies with them. Approval records the
-- reviewer's identity checks (PhilSys QR, selfie, holder authorized).
-- All columns sit on customers, which already carries tenant_id and its RLS
-- policy, so no new policy is needed. review_comment / unlocked_fields are
-- left in place (retired, still readable). IF NOT EXISTS keeps it re-runnable.
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "rejection_reason" text;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "rejection_note" text;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "cure_documents" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "rejected_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "identity_checks" jsonb;
