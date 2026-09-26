# Change Record

**Title:** EDTR field logs: rental-span rule, hour categories, timekeeper submit-only, admin approval in a per-site hub
**Project:** ArkiLaunch
**Date:** 2026-09-27
**Version:** 0.1
**Status:** `Applied` (code); migration 0059 applied to the shared Supabase dev database 2026-09-27 (dry-run in a rolled-back transaction first); other environments pick it up from the `deploy.yml` migrate step
**Trigger doc:** [build-arkilaunch.md](build-arkilaunch.md) §5.1 Brownfield Change Workflow; admin feedback 2026-09-27 (item 2 of 6)
**Docs touched by this record:** [rfc-arkilaunch-ocr-edtr-reconciliation.md](rfc-arkilaunch-ocr-edtr-reconciliation.md) §2/§3 (office log as the second log; hour categories; what approval writes), [prd-arkilaunch.md](prd-arkilaunch.md) PRD-F3 US-01/US-02 (timekeeper submits only; admin approves), [sdd-arkilaunch.md](sdd-arkilaunch.md) §3 (`edtr_line_items` columns), §4 (site hub + review endpoints), [index.md](index.md) §2

---

## 1. Why

- A field log could be recorded for a date outside the rental.
- Downtime was not separated from billable idle. One idle number with one reason tick cannot hold "2 h customer idle and 3 h breakdown" on the same day.
- Timekeepers could read the whole field-log queue, and there was no per-site place for the admin to review and approve.

## 2. Decisions (confirmed with the user 2026-09-27)

| # | Decision |
|---|---|
| 3 | Report dates are **hard-blocked** to the unit's assignment window on that rental (fallback: the rental's start/end). The window is read live, so an approved extension widens it with no copy of the dates stored. |
| 4 | Breakdown, weather and other downtime are **not billed**. An approval that adds non-billable full days prompts the admin to extend the rental. **Running** (active) hours feed the hour meter / PMS; idle is excluded from the meter. |
| 5 | The timekeeper **submits only**: scan + typed hours → Pending. No field-log list, detail or scan access. |
| 6 | Approval updates billing, the equipment hour meter + PMS, the customer portal and the dashboard. |
| 7-8 | Sites & Deployments rows open a **site hub** with tabs: Overview, Daily logs, Equipment, Personnel, Documents. |

## 3. How admin approval stays inside RFC-2

RFC-2 requires two independent logs, or explicit human approval, before money moves. `edtr_recon_matched_needs_counterpart_chk` makes an `approved` reconciliation without a counterpart impossible at the database level. That constraint stays, and nothing bypasses it:

1. The timekeeper's submission is a `paper_ocr` row with the typed hours (manual transcription while OCR is off). It reconciles as `single_source` → **Pending**.
2. In the site hub the admin reads the scan and confirms the hours. That reading is recorded as the **office log**: a `digital_entry` row created by the admin, which is exactly the "PM's reading from their own record" RFC-2 names as the second log.
3. The pair reconciles through the unchanged gate. If it matches, `approve()` runs as before. If the admin changed any figure it is a `discrepancy`, and the admin's figures go in as `adjustments`: the existing explicit-human-approval path, with `verified_by` set.
4. Every other gate still runs in `approve()`: pair lock, `already_approved`, the QAD-T39 accuracy gate for model output, the effective rate card, and `deposit_not_paid`.

The office log's fields are prefilled from the timekeeper's typed hours. That makes step 2 a human confirmation of the paper, not an independent re-count, and this record says so plainly: for these days the control is explicit human approval with the scan beside the figures, not double entry.

**Needs correction / Reject** set the reconciliation to `rejected` with `adjustments.correction_requested` (true for Needs correction) and a required reason, write an `audit_logs` row, and notify the timekeeper. A corrected resubmission is a new row for the same day.

## 4. Hour categories (migration 0059)

`edtr_line_items` gains `hours_total`, `hours_breakdown`, `hours_weather`, `hours_other_downtime`, `downtime_note`, `hour_meter_start`, `hour_meter_end`. `hours_active` = running and `hours_idle` = idle by customer choice. The new columns follow the NULL-vs-0 rule of `hours_idle` (migration 0017): NULL means not recorded (every pre-v3 row).

One pure function, `classifyHours()` in `packages/shared/src/edtr.ts`, is the only definition used by billing, the hour meter, the portal and the dashboard:
- `running = active` (hour meter, PMS, utilization)
- `billable = active + idle` **only on a categorised row** (the downtime columns are recorded). On an uncategorised (pre-v3) row idle may include weather or breakdown time, so `billable = active`, which is exactly today's behaviour. No existing row is re-priced.
- `nonBillable = breakdown + weather + other`
- `meterDelta = meter_end − meter_start`

`validateDayEntry()` flags a day for review (never blocks; the paper is the evidence): total ≠ sum of parts by > 0.25 h, weather downtime with both weather ticks clear, meter delta ≠ running by > 0.5 h, meter end < start, meter start ≠ the previous approved end, other downtime with no remark.

## 5. Permissions

- New `edtr:read` (list, detail, scan) for `admin`, `owner`, `platform_admin`. `edtr:create` stays the timekeeper's submit permission.
- `GET /edtr`, `GET /edtr/:id`, `GET /edtr/:id/image` need `edtr:read`. The field app keeps its submit screen; its pending count, which read the list, is removed.
- `POST /edtr/:id/review` (`edtr:approve`): `approve` (with the confirmed figures), `needs_correction` or `reject` (reason required).

## 6. What approval writes (one transaction)

- **Billing:** the deduction line is priced on `billable` hours (see §4), with the booking code in its description.
- **Hour meter:** `equipment.runtime_hours += running`. The maintenance job (`jobs/src/maintenance-notify.ts`) already raises the PMS notification from `runtime_hours`.
- **Portal:** approved days (only) appear on the customer's booking page with per-category totals.
- **Dashboard / hub:** totals count approved rows only.
- **Notify:** the timekeeper (approved / needs correction) and the customer (daily log approved).

## 7. Site hub

`GET /sites/:id/hub` (`site:manage` or `report:read`) returns the overview, the rentals and units on the site with their live span, a day × unit status grid (Missing / Pending / Needs correction / Approved / Rejected), approved-only totals, personnel (operators by unit, timekeepers, customer site rep, truck drivers/helpers on trips to the site) and documents. Timekeeper assignment add/remove uses the existing site endpoints.

## 8. Deliberately not claimed

- **Re-opening an approved day is not built.** Reversing a deduction needs a credit-note model (`invoice_line_items_nonneg_chk` forbids a negative line, correctly) and would have to re-open a terminal reconciliation, which audit-ocr-money-path.md #6 deliberately closed. An approved day is final; a mistake is corrected by a manual credit until a CR designs reversal.
- The extend prompt opens the existing extension flow; it does not extend on its own.
- Bulk approve runs the single-day path once per day; each day can still fail its own gate (for example `deposit_not_paid`).
