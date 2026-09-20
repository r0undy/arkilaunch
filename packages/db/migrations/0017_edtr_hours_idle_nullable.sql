-- The real Almara EDTR form has no idle-hours column: idle time is never
-- recorded on paper (docs/cr-arkilaunch-edtr-real-form.md). With hours_idle
-- NOT NULL the worker's only options were to fabricate a 0 -- a reading the
-- deduction gate cannot tell apart from a machine that genuinely idled for
-- zero hours -- or to reject every real sheet. Both are wrong, so the column
-- becomes nullable and NULL means "not recorded" rather than "zero".
--
-- Non-destructive: every existing row keeps its value, and the >= 0 check
-- still holds for rows that have one (a CHECK passes on NULL).
ALTER TABLE "edtr_line_items" ALTER COLUMN "hours_idle" DROP NOT NULL;
