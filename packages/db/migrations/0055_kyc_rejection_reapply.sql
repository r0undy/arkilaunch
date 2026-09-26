-- CR: pricebook-kyc-weather. Registration review is approve-or-reject only;
-- a rejection carries a reason, and a curable one lets the customer upload
-- the cure documents and reapply. customers is already tenant-scoped under
-- RLS; new columns inherit its policy. No backfill: existing rejected rows
-- keep a null reason and read as "contact the rental team".
ALTER TABLE customers ADD COLUMN rejection_reason text;--> statement-breakpoint
ALTER TABLE customers ADD COLUMN rejected_at timestamptz;--> statement-breakpoint
ALTER TABLE customers ADD CONSTRAINT customers_rejection_reason_chk CHECK (
  rejection_reason IS NULL OR rejection_reason IN (
    'bir_expired_or_invalid','sec_suspended_or_revoked','id_mismatch','document_unreadable','fraudulent_document'
  )
);
