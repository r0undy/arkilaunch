# Audit — OCR → reconciliation → deduction (money path)

Status: Findings (not Locked). Date: 2026-09-19. Audited against `dev`.
Scope: `jobs/src/edtr-ocr-worker.ts`, `packages/db/src/reconciliation.ts`,
`packages/shared/src/{edtr.ts,ocr-accuracy.ts}`, `packages/document-intelligence/src/azure-adapter.ts`,
`apps/api/src/edtr/*`, `packages/db/src/schema/billing.ts`, `packages/db/src/seed/anchor.ts`, plus specs.

Read-only. RFC-2 rule under test: OCR output must never trigger a deposit deduction without a
passing reconciliation or explicit human approval.

## Disposition (updated 2026-09-19)

Every finding below now carries its outcome. Closed items are closed in code on `dev`, not merely
planned.

**Correction to this document's original banner.** It said findings 2 and 3 were "solved by commit
`0ce3cbb` on `fix/edtr-ocr-claim-and-stale-locks`" and that "merging that branch is the
highest-value action in this document". That branch had already merged, via PR #36, before this
audit was written: `jobs/src/edtr-ocr-worker.ts` on `dev` carries both `STALE_LOCK_MS` and the
bounded `limit ... for update skip locked` claim. The audit was reporting a stale working state.
Findings 2 and 3 were verified closed rather than rebuilt.

## HIGH

### 1. Deduction gates on a status string alone; a `matched` row with no counterpart still deducts
**CLOSED** (`2695d79`). `edtr_recon_matched_needs_counterpart_chk` added, paired with a repair of the five existing rows (none had raised an invoice) and a correction to `seed/anchor.ts`, which now seeds the second log and links it.
`apps/api/src/edtr/edtr.service.ts:368`, `:409` — the counterpart lock is
`if (reconciliation.counterpartEdtrId)`, i.e. optional.
`packages/db/src/seed/anchor.ts:625,650-659` writes `edtr_reconciliations` rows with
`status: 'matched'`/`'approved'` and no `counterpartEdtrId`, no `ocr_payload`, no gate evaluation.

A recon row with `status='matched', counterpart_edtr_id=NULL` (seeded, demo, pilot, backfill,
manual SQL, import) lets an `edtr:approve` holder POST the approve route, pass the status check,
skip the counterpart lock, and insert a `deposit_deduction` invoice. RFC-2's "two independent
logs" is enforced only by the value of a text column — there is no
`CHECK (status <> 'matched' OR counterpart_edtr_id IS NOT NULL)` and no partial index.
Already written down in `docs/cr-arkilaunch-m4-money-path-gates.md:99`, still unfixed.

Fix is a one-line DB CHECK plus correcting the seed.

### 2. Worker claims every queued row but processes only 10; the rest strand in `extracting`
**ALREADY CLOSED on `dev`** (PR #36). Verified, not rebuilt.
`jobs/src/edtr-ocr-worker.ts:133-139` (on `dev`)

The claim `UPDATE` has no `LIMIT`: it flips *all* rows matching
`status='queued' AND locked_at IS NULL AND attempts<5` to `extracting` + `locked_at=now()`, then
`claimed.slice(0, CLAIM_BATCH_SIZE)` discards the remainder. 25 queued sheets → 25 marked
`extracting`, 10 processed, 15 stuck. The next run's predicate requires
`status='queued' AND locked_at IS NULL`, so those 15 are never re-claimed: `attempts` never
increments, `last_error` stays null, no hard_fail, no review row. Silent permanent loss from the
money path. → fixed by `0ce3cbb`.

### 3. No stale-lock recovery; a worker crash mid-row strands that row permanently
**ALREADY CLOSED on `dev`** (PR #36). Verified, not rebuilt.
`jobs/src/edtr-ocr-worker.ts:133-140` (on `dev`). `'extracting'` is only ever written
(worker, schema check constraint, seed) and never read back or reaped.

A killed/OOMed/timed-out job after the claim commit and before the per-row update leaves the row
at `extracting` + `locked_at` set, with no reaper and no alert. RFC-2 §2 specifies `locked_at` as
"set on claim; cleared on completion" with retry/poison handling
(`docs/rfc-arkilaunch-ocr-edtr-reconciliation.md:108`) — the clear-on-completion half exists, the
timeout-recovery half does not. → fixed by `0ce3cbb`.

## MEDIUM

### 4. No HTTP timeout on the Azure DI calls, so the poll deadline cannot fire on a hung socket
**CLOSED** (`0b41eb0`). 30s `AbortSignal.timeout` on both the analyze POST and the poll GET.
`packages/document-intelligence/src/azure-adapter.ts:111-121`, `:148-150` — bare `fetch` with no
`AbortSignal.timeout()`. `POLL_TIMEOUT_MS` (`:17`) is checked at `:158`, only *after* a response
returns. If Azure accepts the POST and the poll connection then hangs with no response and no RST,
`await fetch` never settles: the row stays `extracting`+locked (feeding #3) and the process is held
past the cron interval. The 60s "timeout" is a poll-loop budget, not a request timeout.

### 5. Unbounded deduction when the rental has no deposit cap
**CLOSED** (`0b41eb0`), with a caveat. Capped at `DEFAULT_DEPOSIT_PHP`, now shared between the side that charges it and the side that deducts against it. Ships without a dedicated test: the money-path fixture has no rate card effective on its report dates, so every deduction it makes prices at PHP 0 and can never exceed the cap. Two further notes, neither introduced by the fix: the cap assumes checkout actually collected, without checking payment status; and that missing rate card means this fixture has been asserting deductions of 0.00 all along.
`apps/api/src/edtr/edtr.service.ts:526-535`. When `resolveDepositLedger` returns
`depositRequired === null` (rental created directly via `bookings.service.ts`, no
quotation/rental_contracts chain), the `balanceAfter < 0` → `deposit_exhausted` guard at `:519`
is skipped entirely and `balanceBefore/After` are repurposed as a running total. A
booking-originated rental can be deducted against a deposit that was never configured, repeatedly,
with no ceiling. Flagged in-code as a documented simplification — but it is a money-moving one.

### 6. Nothing ties a deposit_deduction invoice to its reconciliation, and status can be rewound
**CLOSED** (`2695d79`, `0b41eb0`). `invoice_line_items.reconciliation_id` is a real FK (233 of 314 existing lines backfilled; the rest left NULL rather than guessed), and `reconcileEdtr()` will not reset an `approved`/`rejected` row.
`apps/api/src/edtr/edtr.service.ts:537-557`; `packages/db/src/schema/billing.ts` (no reconciliation
FK; the link is free text at `:553`).

The double-spend guard is the in-transaction `status==='approved'` check plus `FOR UPDATE`
(`:364`, `:401-422`), which holds for concurrent HTTP calls. But `reconcileEdtr()` overwrites
status unconditionally (`packages/db/src/reconciliation.ts:176-178`: `.set(values)` with
`status: 'matched'|'discrepancy'`, no guard against an existing `approved`/`rejected`). Any future
caller, manual re-reconcile or backfill resets `approved → matched`, and approve() deducts a
second time. No caller does this today, so it is latent rather than live.

### 7. Duplicate line items on re-extraction inflate billable hours
**CLOSED** (`2695d79`). `edtr_line_items_edtr_id_uq`.
`jobs/src/edtr-ocr-worker.ts:212-217`; no unique index on `edtr_line_items.edtr_id`
(`schema/billing.ts:44-63`). `approve()` sums *all* line items (`edtr.service.ts:424-425`). An
operator requeueing an already-`extracted` row to retry a suspect extraction gets a second
line-item row → `recordedActive` doubles → the deduction is 2× the real hours. One-sided requeue
would be flagged by the counterpart delta; requeue both sides and it matches cleanly at 2×.

### 8. The QAD-T39 accuracy gate exists but nothing on the runtime path consults it
**CLOSED** (`0b41eb0`). `approve()` consults it for model-sourced evidence on both sides of the pair, and fails closed when unattested -- the correct state today.
`packages/shared/src/ocr-accuracy.ts:99-115` (`assertAccuracyGate`), `:78` (`meetsCorpusFloor`) —
the only consumers are `apps/api/src/edtr/accuracy-harness.spec.ts` and
`jobs/src/ocr-fixtures-pull.ts`. The stated rule is that mean field accuracy must reach 90.06%
before the OCR path may carry a deduction (`:58-62`), but `approve()` and the worker never
reference it: `ENABLE_OCR_PIPELINE=true` alone routes model output into a deduction regardless of
whether the golden set was ever measured or met the 200-sample corpus floor. Compounded by
`EDTR_MODEL_ID`/`EDTR_REQUIRED_FIELDS` still being pre-training placeholders
(`edtr-ocr-worker.ts:21-25`).

## LOW

### 9. The 0.90 confidence gate is hardcoded a second time in worker telemetry
**ALREADY CLOSED on `dev`.** The worker uses the shared `CONFIDENCE_GATE`.
`jobs/src/edtr-ocr-worker.ts:227` — `auto_accepted: field.confidence >= 0.9`, a literal, while the
enforced gate is `CONFIDENCE_GATE` in `packages/shared/src/edtr.ts:32`. Tune the shared gate to
0.95 and the `ocr_field_confidence` events used to calibrate it (RFC-2 §5 / QAD-T39) report a
threshold that decided nothing. Monitoring-only — but this is the measurement *for* the gate.

### 10. `hoursIdle` in a human's discrepancy override is validated and then discarded
**CLOSED** (`0b41eb0`). The override now corrects the `edtr_line_items` row.
`apps/api/src/edtr/edtr.service.ts:426` reads only `body.adjustments?.hoursActive`, while
`AdjustmentsSchema` (`packages/shared/src/edtr.ts:219-222`) requires both. A reviewer correcting
8.0/1.0 → 7.0/2.0 gets the right deduction (7.0), but the `edtr_line_items` rows are never
corrected and the stored `deltas` keep the pre-override idle divergence, so the row's own evidence
permanently contradicts the approved figure. Audit and idle reporting read the stale numbers.

## Clean

- **TODO/FIXME/XXX/HACK on this path:** none across `jobs/`, `packages/{db,shared,document-intelligence}`,
  `apps/api/src/{edtr,billing}`.
- **Skipped or empty tests:** none. No `it.skip`/`describe.skip`/`it.todo`/`xit` in the repo; every
  test in `jobs/src/edtr-ocr-worker.spec.ts` and `apps/api/test/money-path.spec.ts` carries real
  assertions.
- **Fabricated values on extraction failure:** genuinely closed. Missing required field, empty field
  set, missing `raw_file_uri`, over-max-pages truncation and absent/out-of-range Azure confidence all
  hard-fail or floor to 0 rather than defaulting.
- **Concurrent double-approve over HTTP:** closed by the `FOR UPDATE` pair lock and the paired
  `approved` transition. Findings 6 and 7 concern state *outside* that transaction, not races within it.
- **Empty-evidence auto-match and the equal-and-opposite active/idle swap:** both handled and tested.

## Suggested order

Merge `fix/edtr-ocr-claim-and-stale-locks` (closes #2 and #3). Then #1 (one CHECK constraint plus a
seed correction). Then #4 — a one-line `AbortSignal.timeout()` that stops #3 recurring from the
network side.
