-- IF NOT EXISTS because this migration has been applied once already under a
-- different number: it was generated as 0025, renumbered to 0028 when PR #66
-- took 0025, and renumbered again to 0029 when the catalog-photo migration
-- took 0028. Any database that ran an earlier numbering already carries the
-- column, and a bare ADD COLUMN would fail there on the next migrate. Still a
-- plain additive nullable column on a fresh database.
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "sec_number" text;
