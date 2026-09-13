# Change Record

**Title:** A superseded rate card could price a deposit deduction — effectiveness, report-date pricing, and rate-type on the money path
**Project:** ArkiLaunch
**Date:** 2026-09-13
**Version:** 0.1
**Status:** `Applied`
**Trigger doc:** [build-arkilaunch.md](build-arkilaunch.md) §5.1 (brownfield change workflow); four red tests in `apps/api/test/billing-engine.spec.ts` blocking the M5 pipeline PR
**Docs touched by this record:** [index.md](index.md) §2

---

## 1. Why this pass exists

Four tests in `billing-engine.spec.ts` had been red on `dev` since 2026-09-07 and were blocking an unrelated pipeline PR. The investigation found the tests were right and the code was wrong, on the path that moves money.

`EdtrService.approve()` resolved the hourly rate for a deposit deduction like this:

```
.where(and(eq(tenantId), eq(equipmentTypeId)))
.orderBy(desc(effectiveFrom))
.limit(1)
```

No effectiveness filter of any kind. Whichever card sorted newest by `effective_from` priced the deduction, whether or not it was superseded, and whether or not it had come into force yet. RFC-3 and QAD-T44/T48 exist to prevent exactly this on the quotation side, and `pricing-engine.service.ts:158-166` implements it there. The side that actually deducts from a customer's deposit had no such guard. The comment above the query already claimed the card was "currently-effective" and that this "reuses the same rate-card lookup the quotation engine uses"; neither was true.

The failing tests were the symptom. `quotes-engine.spec.ts:143-153` (QAD-T44/T48) inserts a permanent `999999.00/hr` card with `effective_from = now` for the same tenant and equipment type, into a shared test project that is never reset. From the first full suite run on 2026-09-07 that card won the unfiltered lookup, and a 4-hour log priced at 3,999,996 against a 50,000 deposit. Three of the four failures cascaded: the blocked approvals left no `deposit_deduction` invoices, so the invoice-filter test found none and the tenant-isolation test dereferenced `items[0]` on an empty list.

## 2. What shipped

### 2.1 Effectiveness and report-date pricing (`a33e4af`)

The lookup filters `effective_from`/`effective_to` the way the quotation engine does, and prices against the EDTR's `report_date` rather than `now`. The work happened on that date, so a rate change made afterwards cannot retroactively reprice it, and a rate that was correct at the time stays correct. `report_date` is set once at capture and has no update path, so a deduction stays re-derivable from the record.

### 2.2 Fail-closed on a date no card covers (`a33e4af`)

Adding the filter creates a state that could not arise before it: cards exist for the equipment type, but none covers `report_date`. Falling through to the pre-existing `0` rate would post a zero-value deduction that reads as a real approved one and silently under-bill the tenant, so that now raises 422 `rate_card_not_effective`, reusing the quote side's error code. An equipment type with no rate cards at all keeps the previous behaviour: nothing is misconfigured, and there is no deduction to price.

### 2.3 Manila calendar dates, and the rate type (`7fb860d`)

Both found by `edtr-ocr-worker`, which returned FAIL on the first attempt.

The first was a regression introduced by §2.1. `report_date` is a bare `date` and the rate card columns are `timestamptz`; anchoring the date to midnight UTC put the cutoff at 08:00 Manila, so a card created during PH business hours on the report date read as not yet effective. Where it was the only card, the new fail-closed throw would have blocked an approval that was correct. Both sides are now compared as Manila calendar dates, which is what a bare `date` means in a PH-only product.

The second predates this branch. The lookup never filtered `rate_type` while multiplying the result by hours. `rate_type` is free text (`hourly`, `daily`) and the overlap guard in `pricing.service.ts:148-158` is scoped by it, so an hourly and a daily card for one equipment type are *designed* to be effective at once. Whichever sorted newest won, making a daily rate priced per hour a 24x mispricing and leaving the amount unspecified. With `rate_type` pinned the overlap guard leaves at most one card effective per instant, so the `order by` is finally deterministic.

### 2.4 Tests (`034fd42`, `823d421`)

The existing test asserted the balance went down, which held at 850/hr or at 999999/hr. It now pins the exact amount. The fail-closed throw had no coverage anywhere in the repo, and neither does its quote-side analogue; it now has a dedicated test that dates an EDTR before the seeded card's `effective_from` so cards exist but none applies, asserting the 422 and an untouched ledger.

## 3. Recorded, not fixed

- **Same-day deactivation now fails closed.** `pricing.service.ts:232` sets `effective_to = new Date()`. Under day granularity that excludes the card for the whole of the current Manila day, so an EDTR dated today, approved after a same-day deactivation, raises 422 where it previously priced. Safe (an admin fixes the card) but a live behaviour change operations should know about.
- **Intra-day rate changes are not expressible.** A card created and superseded within one Manila day has an empty range and can never be selected. Deterministic and fail-closed. If the business needs intra-day rates this wants an RFC-3 amendment, not a patch.
- **`report_date` is now a price-selection input under client control.** It is validated only as `YYYY-MM-DD` (`packages/shared/src/edtr.ts:160`), so backdating a capture selects an older card. The RFC-2 gate (passing reconciliation plus human approval) still stands in front of any deduction, so this is not unsupervised, but a sanity bound (not future, not before the rental start) belongs on the capture schema.
- **A zero-rate deduction is still possible** where an equipment type has no rate cards at all. Pre-existing, preserved deliberately, and worth its own pass.

## 4. Verification

- `apps/api` `billing-engine.spec.ts` — **6 passed**, run directly. The four tests red since 2026-09-07 are green, plus the new fail-closed test.
- `edtr-engine` 11/11, `money-path`, `quotes-engine`, `rate-cards` 31/31 and `ai-abuse` 4/4 green in the same pass.
- `pnpm lint` and the `apps/api` typecheck/build clean.

## 5. Pre-merge gate runs

| Agent | Applies | Verdict |
|---|---|---|
| `edtr-ocr-worker` | Yes | **FAIL then PASS.** First pass found the midnight-UTC regression and the missing `rate_type` filter, both blocking; re-review after §2.3 confirmed both fixed, boundary semantics correct, and the RFC-2 gate untouched. |
| `restraint-guardian` | Yes | **FAIL then PASS.** First pass found the new fail-closed throw had zero test coverage; re-review after §2.4 confirmed no scope creep and nothing cut. |
| `ai-ocr-abuse-runner` | No | Not run. No diff on the OCR/AI path: no extraction, confidence-gate or reconciliation-scoring change. `ai-abuse.spec.ts` green regardless. |
| `tenant-isolation-checker` | No | Not run. No auth, repository or table change; the query is inside the existing `withTenantTx` and keeps its `tenant_id` predicate. |
| `migration-rls-guardian` | No | Not run. No schema or migration diff. |
