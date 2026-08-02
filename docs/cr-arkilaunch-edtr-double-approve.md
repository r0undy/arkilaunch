# Change Record

**Title:** EDTR reconciliation double-approve / double-deduction fix
**Project:** ArkiLaunch
**Date:** 2026-08-02
**Version:** 0.1
**Status:** `Applied`
**Trigger doc:** [cr-arkilaunch-f4-f5-fleet-weather.md](cr-arkilaunch-f4-f5-fleet-weather.md) §5 (finding, not fixed in that pass)
**Docs touched by this record:** [rfc-arkilaunch-ocr-edtr-reconciliation.md](rfc-arkilaunch-ocr-edtr-reconciliation.md) §3 (addendum), [index.md](index.md) §2 (Change Log)

---

## 1. Summary

Closes the follow-up recorded in `cr-arkilaunch-f4-f5-fleet-weather.md` §5: `reconcileEdtr()` (`packages/db/src/reconciliation.ts:40`) deliberately writes two reconciliation rows per matched pair, one keyed on each EDTR id, so the same day's work is approvable from either side. `EdtrService.approve()` (`apps/api/src/edtr/edtr.service.ts`) previously marked only the row it was handed as `approved` and never checked the counterpart. An admin approving **both** sides of one matched pair produced two `deposit_deduction` invoices for one day's work. The RFC-2 gate itself was never broken (each deduction genuinely passed a real reconciliation), but a client's deposit could be debited twice.

## 2. Fix

`EdtrService.approve()`:

1. **Early rejection.** If the reconciliation row handed to `approve()` already has `status = 'approved'`, the call now fails fast with `409 { error: 'already_approved', reconciliationId }`, before the matched/discrepancy gate assertions even run.
2. **Race-safe recheck.** Inside the transaction, both the target reconciliation row and its counterpart (`reconciliation.counterpartEdtrId`) are re-read under `SELECT ... FOR UPDATE`. If either is `approved` at that point, the call fails with `409 { error: 'already_approved', reconciliationId, approvedReconciliationId }` and nothing is written. This closes the concurrent case (two near-simultaneous approve calls, one per side) that a plain read-then-check cannot -- QAD-T26 names exactly this ("direct API, replayed, or race").
3. **Joint transition.** On success, **both** reconciliation rows of the matched pair are set to `approved` in the same transaction (previously only the handed row was). This is what makes step 1 sufficient for the sequential case: the counterpart's status flips at the same moment, so a later call against either side always finds `approved`.
4. **Unconditional accrual.** The prior "skip accrual if the counterpart is already approved" branch is removed. Reaching the accrual step now already proves neither side of the pair was previously approved (steps 1-2 would have thrown otherwise), so `equipment.runtime_hours` accrues exactly once per matched pair, unconditionally.

No schema change, no migration. `edtr_reconciliations.status` already allows `approved` as a value on any row (`billing.ts:85-86`); this changes which rows the request-path code writes to and when it rejects, not the state machine's enum.

## 3. Verification

- `apps/api/test/edtr-engine.spec.ts`, test `PRD-F4 / QAD-T26: approving the second side of an already-approved pair is rejected` (renamed from the prior "accrues runtime_hours exactly once" test, which asserted the old -- now removed -- silent-skip behavior): approving side A succeeds and writes exactly one `deposit_deduction` invoice; approving side B afterward is rejected with `ConflictException` (`already_approved`); `equipment.runtime_hours` and the invoice count are both unchanged by the rejected second call.
- All other `edtr-engine.spec.ts` cases (QAD-T1, QAD-T11/T26, QAD-T26 pending, QAD-T29) still pass unchanged.
- Full workspace verification: `packages/shared` 21/21, `packages/db` 67/67, `jobs` 12/12, `apps/api` 56/56 passing. `apps/web`'s pre-existing, unrelated Vitest failure (no `vitest.config.ts`; documented in `cr-arkilaunch-f4-f5-fleet-weather.md` §6) is untouched by this change.
- `pnpm typecheck` clean on `apps/api`.

## 4. Scope note

Pre-merge gates named in `AGENTS.md` §2 (`edtr-ocr-worker`, `ai-ocr-abuse-runner`) were not run as part of this change -- flag if/when you want them run against this diff before it ships.
