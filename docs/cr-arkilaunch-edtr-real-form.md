# Change Record

**Title:** The real Almara EDTR is a multi-day timesheet; EDTR extraction moves to layout tables and fans out per day
**Project:** ArkiLaunch
**Date:** 2026-09-18
**Version:** 0.1
**Status:** `In Progress`
**Trigger doc:** [build-arkilaunch.md](build-arkilaunch.md) §5.1 (brownfield change workflow); [cr-arkilaunch-ocr-extraction-enablement.md](cr-arkilaunch-ocr-extraction-enablement.md) §2.1 (EDTR extraction blocked pending a training run)
**Docs touched by this record:** [rfc-arkilaunch-ocr-edtr-reconciliation.md](rfc-arkilaunch-ocr-edtr-reconciliation.md) §2/§3/§7 (addenda), [aia-arkilaunch.md](aia-arkilaunch.md) §2 (status note), [index.md](index.md) §2 (Change Log), [README.md](../README.md)

---

## 1. Why this pass exists

The operator supplied an actual Almara "EQUIPMENT DAILY TIME REPORT" form. Every EDTR
assumption in the codebase was written against a form nobody had seen, and the real one
does not match it in three independent ways:

| The code assumed | The real form has |
| --- | --- |
| an `hours_active` field | no such field — a `TOTAL HOURS` column per row, plus AM/PM/OVERTIME in-out pairs |
| an `hours_idle` field | **no idle column anywhere.** Idle time is never recorded on paper |
| one sheet = one equipment-day (`edtr.report_date` is a single date) | one sheet = up to ~22 dated rows spanning a `DATE COVERED` range |

`EDTR_REQUIRED_FIELDS` was not merely "unconfirmed pending a training run", as
`model-registry.ts` and `cr-arkilaunch-pilot-honesty.md` §4 had it. It described a document
that does not exist. Fed a real sheet, the worker would have hard-failed every capture on
`missing_required_field:hours_idle` — the honest outcome, but never a working pipeline.

## 2. What was measured, against the live resource

All findings below come from `di-arkilaunch-dev` (F0, `southeastasia`), analysing a
**synthetic replica** of the real form — a machine-generated PNG carrying invented header
values and a fabricated operator name. The sheet the operator supplied is a **blank form
template** containing no personal data of any kind.

1. **`prebuilt-layout` table extraction is the right tool and it works.** The timesheet came
   back as a 22×9 table with every date, in-out time and total correctly positioned;
   header in rows 0–1, data from row 2.
2. **`queryFields` is the wrong tool for this document, and fails dangerously.** Asked for
   the same sheet's `Operator` it answered `"ALMARA CONSTRUCTION CORPORATION"` at **0.883** —
   confidently wrong, having read the letterhead. `Total` came back at 0.756. The four header
   scalars (`ChargeTo`, `EqptType`, `ProjectLocation`, `DateCovered`) were correct at
   0.94–0.99. queryFields answers per-document scalars; this sheet's payload is a table.
3. **Table cells carry no confidence, but words do.** Cells expose `spans` into the same
   content string that `pages[].words[].span` indexes, and words carry `confidence`
   (0.926–0.999 on the replica). Per-cell confidence is therefore a real measurement, not a
   number we picked.
4. **The header uses merged cells.** `AM`/`PM`/`OVERTIME` span two columns each and
   `DATE`/`TOTAL HOURS`/`SIGNATURE` span both header rows. This was found by the end-to-end
   run failing with `no_timesheet_table`, not in review — see §5.

## 3. Changes

**Extraction.** `EDTR_MODEL_ID` is `arkilaunch-edtr-layout-table` and resolves to
`prebuilt-layout` with no query fields. The id is renamed because
`arkilaunch-edtr-neural-v1` would now be a lie in `ocr_payload.model_id`, a provenance
field, claiming a trained neural model read a sheet that layout read. The custom-model
branch in `resolveModelRequest()` is untouched, so training that model later is a
one-constant change.

**Port.** `DocumentExtractionResult.tables` is optional, so KYC and the fixture adapters are
unaffected. Merged cells are expanded into every position they cover rather than dropped;
Azure reports explicit indices, so this cannot shift a neighbouring column.

**Sheet parsing** (`packages/shared/src/edtr-sheet.ts`, pure and offline-testable). The
written `TOTAL HOURS` is the reading, because it is what the operator signed. The in-out
pairs are re-derived independently and compared against it — a second reading of the same
page, free, and RFC-2's two-independent-logs idea applied within one document. The parser
refuses rather than guesses: an unreadable total, an unparseable date or a duplicated date
fails the **whole** capture naming the day, since dropping one dated row would lose a
billable day with nothing downstream able to tell it had existed.

**Fan-out.** One capture becomes one `edtr` row per dated line — the claimed row hosts day
one, siblings carry the rest and share its `raw_file_uri`. This keeps `report_date` a single
date, so reconciliation's `(equipment_id, report_date)` pairing and the whole deduction gate
are **unchanged**. The alternative (one row, many line items) was rejected because
`sumHours()` would collapse a week before the gate saw a day, letting a +2h Monday error
cancel a −2h Tuesday error. All days land in one transaction: a partial write would leave
the claimed row out of `queued` with the remaining days lost and nothing to retry them.

**Idle hours** (migration `0017`, non-destructive). `edtr_line_items.hours_idle` becomes
nullable and `NULL` means "not recorded", not zero. With `NOT NULL` the worker's only
options were to fabricate a 0 — indistinguishable to the deduction gate from a machine that
genuinely idled — or reject every real sheet. The gate follows: an absent idle reading skips
the idle dimension *and* the summed total that contains it, rather than defaulting to a 0
delta. A 0 delta would assert the two logs **agree** about idle hours, a claim neither made,
and would pull a real disagreement elsewhere through on evidence that does not exist. Active
hours, which the deduction is priced on, are never skipped. `Number(null) === 0` is also
stopped from re-fabricating the zero on the way out through the API and the capture modal.

**Self-contradiction override.** A day whose in-out times disagree with its written total is
forced to `review` after reconciliation, overriding even a matching digital counterpart —
two readings of that page already disagree, so a human decides.

## 4. Verification

End-to-end against live Azure DI, one capture of the replica sheet:

```
1 capture -> 5 edtr rows
2026-03-01  review  active=10.50  idle=NULL  conf=0.988  computed=10.5  single_source
2026-03-02  review  active=9.00   idle=NULL  conf=0.993  computed=9      single_source
2026-03-03  review  active=6.00   idle=NULL  conf=0.998  computed=6      single_source
2026-03-04  review  active=10.00  idle=NULL  conf=0.989  computed=10     single_source
2026-03-05  review  active=7.00   idle=NULL  conf=0.997  computed=7      single_source
```

Bare `MM/DD` dates resolved to the correct year against the capture date; written totals
match the recomputed figures exactly; `single_source` is correct, as no digital counterpart
existed. Suites: `shared` 78, `document-intelligence` 13, `jobs/edtr-ocr-worker` 10, API 136.

## 5. What this pass got wrong, and how it surfaced

The port initially **dropped** merged cells, on the stated reasoning that a flattened merge
would shift times under the wrong date. That reasoning was wrong — Azure reports explicit
`rowIndex`/`columnIndex`, so nothing is positional — and the real form's header is entirely
merged cells, so the guard deleted the header and every real sheet parsed as
`no_timesheet_table`. It was caught by running the pipeline against the live resource, not
by review or by unit tests, both of which used hand-written grids that had never met Azure's
actual output. Recorded here because the unit fixtures are now pinned to the shape the live
resource really returned.

## 6. Deliberately NOT claimed

- **No accuracy number.** QAD-T39's ≥ 90.06% gate remains unmeasured and its §6 release box
  unchecked. Everything above was measured on a **machine-generated** sheet: 0.99 confidence
  on crisp rendered text says nothing about a photographed page of handwriting, which is the
  only input that matters. No labeled corpus exists (QAD §2 asks for ≥ 200 EDTR pages).
- **Handwriting is entirely unexercised.** The real form is filled in by hand on site. AIA-R5
  concerns exactly this and stays not exercised.
- **F0 limits stand.** Two pages per document, 4 MB, and rate limits that will not support a
  pilot. `AZURE_DI_MAX_PAGES=2` keeps the adapter hard-failing a longer document rather than
  truncating it. A sheet whose grid runs onto a second page is therefore rejected, not
  half-read.
- **Re-capturing the same sheet is not de-duplicated.** A second photograph of the same
  paper creates a second set of day rows. Paper cannot pair with paper
  (`reconcileEdtr()` requires `ne(source)`), so this produces duplicate review items rather
  than a wrong deduction, but it is an open gap.
- **The full API path was not re-run** (signed URL → download → analyze). The worker path was
  exercised directly with the real adapter and a stubbed byte fetch.

## 7. AIA-R7 / CLR gap E1 — unchanged and still blocking

`ENABLE_OCR_PIPELINE` is set `true` in **dev only**, at the operator's explicit direction,
to exercise the path. Recorded plainly:

- **AIA-R7 stays `Open (escalated)`** and remains a launch blocker for PRD-F6 and any
  production launch. CLR gap E1 (RA 10173 cross-border transfer basis) is **not** cleared by
  this pass, which changes no legal fact.
- **No real PH personal data has crossed a border.** Everything sent to Singapore was
  machine-generated with invented values. The blank form the operator supplied carries no
  personal data.
- The moment a **filled** Almara sheet is sent, that changes: these forms carry an operator
  name and signature, which are personal data under RA 10173. Doing so before counsel clears
  E1 is the decision this record flags, not one it endorses.
- `prod` keeps `enable_ocr_pipeline = false`.

## 8. Follow-ups

1. Collect real filled sheets and measure accuracy on handwriting — the only number that
   decides whether this path can carry the pilot.
2. De-duplicate re-captures of the same sheet.
3. Decide whether `hours_idle` should be dropped from the digital-entry capture form too,
   or kept as the one source that records it.
4. `EDTR_REQUIRED_FIELDS` is deleted; `runbook-ocr-fixtures.md` still describes the
   custom-model training flow and needs rewriting against the layout-table path.
