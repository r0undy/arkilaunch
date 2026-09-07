# Change Record

**Title:** M4 iteration 1 — the reconciliation false-accept, the reference-table grant hole, and two CI jobs that gated nothing
**Project:** ArkiLaunch
**Date:** 2026-09-07
**Version:** 0.1
**Status:** `Applied`
**Trigger doc:** [build-arkilaunch.md](build-arkilaunch.md) §5.1 (brownfield change workflow); user request to plan and execute the next milestone iteration
**Docs touched by this record:** [rfc-arkilaunch-tenancy-rls-auth.md](rfc-arkilaunch-tenancy-rls-auth.md) header/§3, [rfc-arkilaunch-ocr-edtr-reconciliation.md](rfc-arkilaunch-ocr-edtr-reconciliation.md) header/§2/§4, [qad-arkilaunch.md](qad-arkilaunch.md) header/§4/§6, [sdd-arkilaunch.md](sdd-arkilaunch.md) header/§3/§4, [prd-arkilaunch.md](prd-arkilaunch.md) header/§5.6, [index.md](index.md) §1/§2/§4

---

## 1. Why this pass exists

[prd-arkilaunch.md](prd-arkilaunch.md) §9 is the authoritative milestone table, and RFC-1/2/3 §10 all defer to it. M1 and M2 are done; M3 (Development) has been functionally complete since 2026-08-02, when all eight features PRD-F1..F8 got working backends, and the four Change Records since then have been honesty, fail-closed, and reconcile passes rather than feature work. **M4 (Testing & QA) is the next iteration.** Its gate is [qad-arkilaunch.md](qad-arkilaunch.md) §6, where every checkbox is unchecked.

M4's own risk column names its top risk as *"Reconciliation false-accept slips through."* That risk was not hypothetical — it was live in the code, and had been since the deduction path first worked.

Three blockers were flagged by [cr-arkilaunch-doc-reconcile-2026-08-20.md](cr-arkilaunch-doc-reconcile-2026-08-20.md) as found-but-deliberately-not-fixed, all three confirmed present before this pass:

### 1.1 The reconciliation gate could auto-accept a wrong deduction

`reconcileEdtr()` (`packages/db/src/reconciliation.ts`) folded `hours_active + hours_idle` into a single scalar per log and compared the two totals. A paper sheet reading **8h active / 0h idle** and a digital counterpart reading **0h active / 8h idle** agree on that total, so `delta_hours` came out **0**, the gate returned `matched`, and the pair became approvable with no queue stop — while `approve()` prices `hours_active` alone.

The two logs disagreed about *every billable hour on the sheet*, and the mechanism built to catch exactly that disagreement reported perfect agreement. RFC-2 §2 recorded this as an open implementation gap on 2026-08-13, so closing it needed a Change Record but no Locked-doc unlock: the spec was already right, the code was not.

### 1.2 Three tables were writable by any authenticated user

`0002_force_rls_and_grants.sql` granted `SELECT, INSERT, UPDATE, DELETE` on `tenants`, `subscription_plans` and `equipment_types` — three of the seven tables that same migration deliberately excluded from `FORCE ROW LEVEL SECURITY` ("28 of 35"). `0007` later narrowed `UPDATE, DELETE`, but only on `tenants`. Because grants are additive and a column-level `GRANT` does not revoke a table-level one, everything else stayed open:

- `INSERT` on `tenants` was still live, so a caller could insert a tenant row directly instead of going through `tenants_register()` — the `SECURITY DEFINER` function that exists precisely to force `status` and `kyc_state` to their pending values. That is the PRD-F6 human KYC gate, and it was self-approvable.
- `equipment_types` and `subscription_plans` were fully writable, so one tenant could rewrite the equipment catalogue or the subscription price list for every tenant on the platform.
- `tenants` had no RLS at all, so the surviving table-wide `SELECT` exposed every tenant's legal name, slug, status and KYC state to every other tenant — the platform's own customer list, on the tenant registry.

`0009_tenant_registration.sql`'s comment had claimed the INSERT was revoked. The 2026-08-20 pass corrected the comment and left the grant.

### 1.3 The money path had no CI gate

`ocr-accuracy-gate`, `newman-api-suite` and `money-path-e2e` were `echo "skipped: …"` in `.github/workflows/ci.yml`. Declared rather than omitted, which kept them visible in the jobs list while gating nothing, so QAD-T26, QAD-T39 and QAD-T40 had no enforcement — as QAD §4 already recorded.

---

## 2. Scope, as agreed with the user before implementation

Two decisions were put to the user rather than assumed:

- **Iteration scope:** correctness fixes plus real CI gates. `newman-api-suite`, the AI-05/AI-06 evals, and the ≥80% coverage thresholds are M4 iteration 2.
- **Depth of the reconciliation fix:** compare `hours_active` and `hours_idle` as independent dimensions using columns that already exist, rather than adding the `start_time` / `end_time` / `breakdown_status` columns RFC-2 §2's five-dimension spec would need. This closes the entire false-accept class without a schema migration; the three missing dimensions stay recorded as open.

---

## 3. What shipped

### 3.1 Per-dimension reconciliation (`72f37b6`)

`evaluateGate()` now takes `{active, idle, total}` and requires **all three** to sit within tolerance.

Keeping the summed `total` as a third checked dimension is deliberate and load-bearing. Per-dimension comparison alone would have made the new gate **looser** than the one it replaced for same-signed errors: active +0.2h and idle +0.2h each clear a 0.25h tolerance individually but accumulate to 0.4h, which the old summed rule caught. Because `total` is computed from exactly the quantity the old `sumHours()` produced, the old failure set is a strict subset of the new one — nothing previously blocked can now pass. `total` cannot be derived from the other two, since absolute per-dimension deltas have already discarded the sign that decides whether errors accumulate or cancel.

`edtr_reconciliations.delta_hours` now stores the **worst** dimension rather than the sum, via a `worstDelta()` shared with the gate so the persisted number can never disagree with the number that decided the gate. Same `numeric(6,2)` column, and every reader passes it through untouched, so there is no migration and no wire-contract change. The per-dimension breakdown goes into the existing free-form `adjustments` jsonb.

### 3.2 Two adjacent defects found while proving the first (`72f37b6`, `5c46670`)

- **A pair with no evidence auto-accepted.** A log with zero `edtr_line_items` rows summed to zero in every dimension and so read as perfect agreement. Now fails closed to `discrepancy`/`review` with reason `unreadable`, short-circuiting before the gate so confidence and tolerance cannot rescue it. `reconcileEdtr()` is reachable from the OCR worker as well as from capture, so this cannot be left to caller-side validation. `delta_hours` is `null` for this case rather than a figure measured against a phantom all-zero side, which would have told a reviewer the sheets disagree about N hours when the truth is that one sheet recorded none.
- **`approve()` erased the machine's own finding.** It replaced the whole `adjustments` column with the human's hours, destroying `reason` — which `get()` reads — precisely on the discrepancy-resolution path where "what the gate concluded vs what the human overrode" is the audit question. Now merges, matching `reject()`'s existing precedent. The keys do not collide, so the merge is lossless.

The 409 `reconciliation_discrepancy` body now carries `reason` and the per-dimension `deltas`, so a reviewer can distinguish a billable-active disagreement from an idle-only classification difference, and an `unreadable` block from a missing value.

### 3.3 The grant hole (`9a3adbe`, `f2e1a4e`)

`0016_reference_table_grants.sql` follows the precedent `0007` set for `roles`/`permissions`: revoke, then grant only what is needed.

- `equipment_types`, `subscription_plans`: `REVOKE INSERT, UPDATE, DELETE`, `GRANT SELECT`. Neither has a `tenant_id`, so they are platform-global catalogues and RLS is not the applicable control — least privilege is.
- `tenants`: `REVOKE INSERT`, plus `ENABLE` + `FORCE ROW LEVEL SECURITY` and a bespoke `tenant_self` policy keyed on `id`. `tenants` cannot use the shared `tenantIsolationPolicy()` helper: it has no `tenant_id` column because its primary key **is** the tenant id.

Verified against every reader before the policy was added: `tenants.service.ts` and `users.service.ts` already scope to `eq(tenants.id, ctx.tenantId)`, and every cross-tenant or pre-auth path (`auth_find_user_by_email`, `auth_find_refresh_token`, `payments_find_tenant_by_invoice`, `tenants_register`, `tenants_decide_application`, `tenants_list_pending_applications`, and the public-catalog functions) is `SECURITY DEFINER` and so unaffected. The migration is expand-only, destroys nothing, and is idempotent on re-run.

`packages/db/test/rls-enumeration.spec.ts` gains the half it was missing. Its existing sweep derives "tenant-owned" from the presence of a `tenant_id` column, so global tables get no policy and every assertion skipped them — which is exactly how this hole survived. The new block asserts no table-wide write grant on any `EXPECTED_GLOBAL_TABLES` entry (driven off the same list, so a newly allowlisted global table is covered automatically), names the two column grants `0007` kept on purpose, and adds two behavioural checks through the pooled URL as `app_authenticated`: a direct `INSERT INTO tenants` is refused, and a tenant sees exactly one row in the registry.

### 3.4 Real CI gates (`c5de34a`)

- **`money-path-e2e`** now runs against a throwaway Postgres 17, reusing `api-integration-suite`'s setup including its load-bearing choice to connect as `app_authenticated` rather than `postgres` — superusers bypass RLS regardless of `FORCE`, which would make the registry assertions pass vacuously. It names its spec files rather than running whole packages, on the same reasoning as the existing `packages/db` step: a money-path test cannot then vanish from CI by being skipped at runtime. QAD-T26 and QAD-T40 are enforced for the first time.
- **`ocr-accuracy-gate`** runs the accuracy harness and a new `assertAccuracyGate()` for real. See §4 for what it deliberately does not assert.
- **`newman-api-suite`** stays a stub, with its comment corrected to name what it actually waits on.
- New `apps/api/test/money-path.spec.ts` is the file the money-path job names. Every assertion is about money *not* moving — a deduction-invoice count that stayed put — rather than about an exception being thrown, since a refused approve that still wrote an invoice would satisfy a bare `rejects.toThrow()`. It pairs a manually transcribed paper sheet with a digital entry, which is not arbitrary: with `ENABLE_OCR_PIPELINE` off, manual transcription is the only way a deduction can be approved at all.
- Added `.github/pull_request_template.md`, which [cr-arkilaunch-pilot-honesty.md](cr-arkilaunch-pilot-honesty.md) §6 said it had added but which had never landed.

---

## 4. Recorded, not fixed

Named here so none of it is mistaken for done:

- **QAD-T39 (OCR ≥ 90.06%) cannot be measured, and `ocr-accuracy-gate` does not assert it.** The golden set is a synthetic placeholder scoring 6/8 = 75% by construction, and `arkilaunch-edtr-neural-v1` has never been trained — no labeled Almara sheets exist. Asserting the product threshold against synthetic fixtures would be a passing check that means nothing. What the job enforces instead is that the threshold *decision* still fails correctly: below the bar, and on an empty corpus, which a `!(overall < threshold)` spelling would wave through. QAD §6's release box stays unchecked.
- **No QAD §6 release criterion is ticked.** Each remaining one needs staging execution or evidence that does not exist; §6 carries a progress note instead.
- **AI-05 has no dedicated test.** `apps/api/test/ai-abuse.spec.ts` covers AI-01..AI-04. AI-06 is now covered by the executed gate regression tests plus `money-path.spec.ts`.
- **Three of RFC-2 §2's five reconciliation dimensions remain unrepresentable.** There is no `start_time`, `end_time`, or `breakdown_status` column on `edtr_line_items` to compare. The bounded pairing window (`AwaitingCounterpart`) is still unimplemented.
- **`body.adjustments` is unbounded and accepted on a `matched` reconciliation too.** A human can approve a matched 8h pair for any `hoursActive` figure, never checked against either log. That is nominally the "explicit human approval" half of the RFC-2 invariant, but it means the tolerance gate has no authority over the priced number whenever adjustments are present. The largest remaining path from a wrong active-hour count to a wrong deduction.
- **`matched` with a null `counterpart_edtr_id` is approvable.** `approve()` gates on the status string alone. `reconcileEdtr()` never produces that combination, but `seed/anchor.ts` does for all three seeded reconciliation rows, so the two-independent-logs requirement is enforced by a status value rather than structurally.
- **`list()` (the review queue) returns no `reason`**, so the queue cannot distinguish `unreadable` from `tolerance_exceeded` without a per-row `get()`. `deltas` is likewise exposed only on the 409, not on `get()`/`list()`.
- **The deduction cap has a documented fallback** at `edtr.service.ts` for rentals with no `rental_contracts` chain: it reports the running total deducted instead of a balance and never blocks the approve. Pre-existing, unchanged.
- **Deploy remains broken.** `azure/login` has failed on every run since 2026-08-06 ([cr-arkilaunch-azure-di-provisioning.md](cr-arkilaunch-azure-di-provisioning.md) §6), so nothing here has been exercised in staging. `deploy.yml` also still has no migration step, which matters now that this pass adds a migration.

---

## 5. Pre-merge gate runs

All five agents from `AGENTS.md` §2 were run against this tree. Verdicts as reported, including the one that found real defects.

| Agent | Scope | Date | Verdict | Findings |
|---|---|---|---|---|
| `migration-rls-guardian` | `0016` + journal | 2026-09-07 | **PASS** | Non-destructive (no contract step, so no backfill needed); all five RLS elements present on `tenant_self`; `SECURITY DEFINER` registration path unaffected by the INSERT revoke; idempotent on re-run; matches `0007`/`0004`/`0014` conventions |
| `tenant-isolation-checker` | schema, services, jobs, new specs | 2026-09-07 | **PASS** | Every `tenants` path derives tenant from the verified JWT; login, refresh, 2FA, registration, the PayMongo webhook, the public catalog and the cron entrypoints all either avoid the table or go through `SECURITY DEFINER`; no legitimate write path to the two catalogues exists in `apps/api` (seeds run as a superuser) |
| `edtr-ocr-worker` | reconciliation, deduction gate, new spec | 2026-09-07 | **FAIL, fixed in `5c46670`** | Gate change itself correct and provably strictly stricter. Found `money-path.spec.ts` would fail deterministically (the paper counterpart had no reconciliation row, so a non-null assertion threw outside the `rejects` wrapper), a parallelism flake in the rental-wide invoice count, a misleading `delta_hours` on the unreadable branch, and a 409 body missing `reason`. All four fixed and re-verified |
| `ai-ocr-abuse-runner` | `edtr/`, `kyc/`, ports | 2026-09-07 | **PASS with a named gap** | AI-01..AI-04 pass; AI-06 passes on the executed gate regression tests. AI-05 **not exercised** — no dedicated test, mitigated by the confidence + tolerance + HITL triple-lock. `ocr_payload` still Zod-validated at write; the new `deltas` object is computed from validated numerics and never from user input; no extraction-to-money path exists |
| `restraint-guardian` | the whole PR | 2026-09-07 | **PASS** | Every item JUSTIFIED, including the `total` dimension (dropping it would regress the gate), the zero-line-items guard, and the merge-not-replace. One caveat raised on `assertAccuracyGate()` being written before it is wired — satisfied by its four unit tests. No validation, authz, RLS, a11y or security control cut |

Note on the `ai-ocr-abuse-runner` and `edtr-ocr-worker` runs: neither could execute the DB-backed suites (see §6), so their conclusions on those files are static review, not execution. Both reported that explicitly rather than claiming a pass.

---

## 6. What the first real CI run found

The two jobs this pass un-stubbed were green before it only because they did nothing. Making them real produced findings immediately, which is the point; recorded here because a CR that omits its own red build is not a record.

**Baseline, before this branch (PR #5, run `34092075419`):** `lint-typecheck-build` red, `api-integration-suite` red (9 failures / 4 files), and `ocr-accuracy-gate` + `money-path-e2e` "green" in 3–4 seconds because they were `echo` stubs.

**First run of this branch (`34097789400`):** `api-integration-suite` at 10 failures / 5 files, i.e. **exactly one new failure**, and `apps/api/test/money-path.spec.ts` **passed**.

Three things fixed in `202aadb`:

1. **A date collision, and it was mine.** `money-path.spec.ts` took `2021-04-01..05` to stay clear of `edtr-engine.spec.ts`'s `2021-03-0X`, but `ai-abuse.spec.ts` already owned `2021-04-01`/`02` on the same seeded rental and equipment. Vitest parallelises spec files, so the suites paired against each other's equipment-days and this suite's `beforeAll` cleanup deleted rows out from under **AI-04**, which went green → red (`expected 'pending' to be 'discrepancy'`). Moved to `2021-06-0X` with the full list of taken dates written beside it. Worth noting plainly: the hazard was described in the comment directly above the constant, and I walked into it anyway.
2. **`diesel_price_readings:INSERT`** — the new privilege assertion found a second instance of the class it was written for, on its first run. This one is **justified, not a hole**: `0005_diesel_manual_entry_grant.sql` adds it for RFC-3's platform-admin manual-entry route, which runs on the request path as `app_authenticated` because `service_role` there is forbidden, gated by the `diesel:manage` permission and audit-logged by the route. Allowlisted as `table:VERB`, so adding `UPDATE`/`DELETE` there would still fail, and the failure message now explains how to justify an exception rather than only how to revoke one.
3. **`lint-typecheck-build` was broken before this branch and is now fixed.** The job ran `pnpm typecheck` without building the workspace packages, and typecheck resolves workspace imports through each package's built `.d.ts` rather than its source — so it failed `TS2307` on `packages/document-intelligence` and `packages/weather` on every run since those landed (2026-08-15, 2026-08-20). Diagnosis verified rather than guessed: deleting `packages/*/dist` locally reproduces the identical two-package failure, and building them clears it. The apps escaped only because they are ordered after `packages/shared` in the recursive run. Strictly outside this pass's scope, but it gates the PR and it is three lines in a file already being touched.

**Still red and pre-existing, deliberately not fixed here:** the 9 baseline `api-integration-suite` failures across `users-admin.spec.ts` (2), `billing-engine.spec.ts` (4) and `refresh-rotation.spec.ts` (2), plus one more. They predate this branch, are unrelated to the money path or tenancy, and belong to M4 iteration 2 — they are the "0 P0/P1" QAD §6 criterion's actual content. Naming the count here so the next pass starts from a known number rather than rediscovering it.

---

## 7. Verification

**Runnable in this environment, and run:**

```
pnpm lint && pnpm typecheck && pnpm build     # all clean
pnpm --filter @arkilaunch/shared test         # 62 passed (8 files)
pnpm --filter @arkilaunch/document-intelligence test   # 8 passed
pnpm --filter @arkilaunch/weather test        # 10 passed
pnpm --filter @arkilaunch/web test            # 67 passed
```

The shared suite is where the money-path fix is actually pinned: `packages/shared/src/edtr.spec.ts` executes the equal-and-opposite swap case, active-only and idle-only divergence, the same-signed accumulation case that proves the gate did not get looser, tolerance boundaries, and confidence precedence.

**Since superseded by §6:** the CI run has now executed the DB-backed suites, so the statement below describes the state at authoring time. `money-path.spec.ts` passed; the `rls-enumeration.spec.ts` addition found one justified grant needing an allowlist entry; migration `0016` applied cleanly.

**Not runnable here, and therefore not claimed:** the `apps/api`, `jobs` and `packages/db` suites are integration tests against a real Postgres. This environment has no Docker daemon and no local Postgres, and `.env` points at a live Supabase project carrying pilot data, so `pnpm db:seed:test` was **not** run against it — that would overwrite the pilot fixtures. `apps/api/test/money-path.spec.ts`, the `rls-enumeration.spec.ts` additions, and migration `0016` applying cleanly are verified by the PR's own CI run (`money-path-e2e`, `api-integration-suite`, `migration-expand-contract-check`), not by a local pass. The pass/fail state of those suites was unconfirmed at the time this record was written.

This is the same environmental limit recorded in LOG entry #21, and it is stated here rather than papered over: the two files this pass adds are precisely the ones it cannot execute locally.

**Manual check once a database is available:** capture a `paper_ocr` EDTR with `lineItems: {hoursActive: 8, hoursIdle: 0}` against a `digital_entry` at `{hoursActive: 0, hoursIdle: 8}` for the same equipment-day, confirm the reconciliation lands `discrepancy` with `reason: 'tolerance_exceeded'` and `delta_hours: 8` (not 0), confirm `POST /edtr/:id/approve` without `adjustments` returns 409 and writes no `deposit_deduction` invoice, then confirm a matching pair still approves and deducts exactly once with `reason` still present in `adjustments` afterward.
