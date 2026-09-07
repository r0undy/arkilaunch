# Change Record

**Title:** Doc-reconcile pass: writes back the pilot-honesty addendum RFC-2/QAD/AIA never received, and corrects `index.md`'s Health Check
**Project:** ArkiLaunch
**Date:** 2026-08-20
**Version:** 0.1
**Status:** `Applied`
**Trigger doc:** [index.md](index.md) §4 (Health Check); a session review asked "is there reconciliation work outstanding" and found the index's own Health Check answer was wrong
**Docs touched by this record:** [rfc-arkilaunch-ocr-edtr-reconciliation.md](rfc-arkilaunch-ocr-edtr-reconciliation.md) header + §2 (addenda), [qad-arkilaunch.md](qad-arkilaunch.md) header + §2/§4 (addenda), [aia-arkilaunch.md](aia-arkilaunch.md) §2 risk register (status note), [index.md](index.md) §1/§2/§4 (Change Log + Health Check correction), [log-arkilaunch.md](log-arkilaunch.md) (append)

---

## 1. Why this pass exists

`docs/index.md` §2 records `cr-arkilaunch-pilot-honesty.md` (2026-08-13) as touching `rfc-arkilaunch-ocr-edtr-reconciliation.md §2/§3/§7`, `qad-arkilaunch.md §2/§4`, and `aia-arkilaunch.md`. On inspection, none of those edits were ever written into the target files: `manual_transcription` — the CR's central mechanism, and the only way a deposit deduction can currently be approved at all — appears zero times in RFC-2, QAD, or AIA, and RFC-2 does not backlink the CR. `index.md` §4 nonetheless asserted `[x]` for "Every Locked doc's Last Reconciled date is newer than the last code change to its area" and `[x]` for "No open Change Records." Both were false: three CRs (`cr-arkilaunch-pilot-honesty`, `cr-arkilaunch-azure-di-provisioning`, `cr-arkilaunch-open-meteo-free-tier`) landed after the Locked docs' last-reconciled dates, and two of the three have unfinished internal state (see §3 below).

This is a documentation-integrity pass, not a code change. Per `CLAUDE.md`, a Locked-doc divergence from reality requires a Change Record rather than silent code; this record is that CR, applied retroactively for the gap the pilot-honesty CR left open, plus the correction to `index.md` that should have caught it.

## 2. What was found

### 2.1 RFC-2 divergences (Locked, last reconciled 2026-08-01 — now stale by three CRs)

| RFC-2 said | Code does | Addendum added |
|---|---|---|
| §2 (~line 357): with `ENABLE_OCR_PIPELINE` off, EDTR capture accepts `digital_entry` only | `apps/api/src/edtr/edtr.service.ts:77-114` accepts a `paper_ocr` capture carrying human-transcribed hours, `model_id: 'manual_transcription'`, `min_field_confidence: 1` | New "Pilot addendum" paragraph after the hard-fail bullet in §2; flag-off sentence corrected |
| §2 (~line 61): reconciliation compares start time, end time, active hours, idle hours, and breakdown status | `packages/db/src/reconciliation.ts:24-26` sums active+idle into one delta; `edtr_line_items` has no start/end/breakdown-status columns | New "Implementation gap" callout naming the offsetting-error blind spot (delta can read 0 while `hours_active` alone is still priced) |
| §3: a single log "waits in a bounded pairing window, then routes to review" (`AwaitingCounterpart`) | `reconciliation.ts:73-90` routes to review immediately; `AwaitingCounterpart` has no implementation | Named unimplemented in the same callout |
| §7 (~line 135): `model_id: "arkilaunch-edtr-neural-v1"` shown as a working example | Model not yet trained; no labeled Almara sheets exist (`jobs/src/edtr-ocr-worker.ts:17-23`, `cr-arkilaunch-azure-di-provisioning.md` §3.1) | Note added directly above the JSON example |

None of this is new information — every fact above was already stated somewhere in `jobs/src/edtr-ocr-worker.ts` comments or an existing CR. The gap was purely that RFC-2, the Locked doc a builder is told to read first (`AGENTS.md` §1's traceability map: "The OCR / reconciliation / KYC path → SDD §8 → RFC-2"), still described the pre-pilot-honesty behavior.

### 2.2 QAD divergences (Locked, last reconciled 2026-08-01)

- §2 names `https://staging.arkilaunch.app`; Terraform defines only `dev`/`prod` and `cr-arkilaunch-pilot-honesty.md` §2.3 designated `dev` as staging on 2026-08-13. Never written back. Added as a deviation note under the Staging URL line.
- §4's "what runs on every PR" block lists a Postman/Newman API suite; none exists (`cr-arkilaunch-pilot-honesty.md` §2.2 substitutes supertest inside Vitest, 2026-08-13). Never written back. Added as a deviation note.
- Separately from the pilot-honesty gap: as of this pass, `ocr-accuracy-gate`, `newman-api-suite`, and `money-path-e2e` in `.github/workflows/ci.yml` are literal `echo "skipped: …"` jobs, so QAD-T37/T38/T39/T40 have no live CI enforcement, and `apps/api/test/ai-abuse.spec.ts` covers AI-01..AI-04 only (AI-05/AI-06 have no dedicated test). Recorded in the same QAD §4 note as a currently-open item, not resolved by this pass — see §5 (Deferred).

### 2.3 AIA divergence (Draft, "not yet reconciled with code")

`cr-arkilaunch-pilot-honesty.md` §2.5 states AIA-R1/R3/R5 should read "not exercised" rather than "Mitigated"/"Open (monitored)" while no OCR model is running (both flags `false`, no vendor credentials), and that AIA-R7 is correspondingly not a pilot-launch blocker until re-armed by real credentials. AIA is `Draft` so this was lower-severity than the two Locked docs above, but `index.md` §2 still credits the pilot-honesty CR with this edit, so it is added as a status note in §2 of AIA, directly above the risk table's escalation line.

### 2.4 Two CRs recorded as closed while internally unfinished

- `cr-arkilaunch-pilot-honesty.md` §5 "Verification" is the literal placeholder `*(Filled in as each phase lands.)*`; §6's five-row subagent gate table is entirely `*pending*` with no verdict recorded.
- `cr-arkilaunch-azure-di-provisioning.md` §6 lists live follow-ups including: every Deploy run since 2026-08-06 fails at the `azure/login` step, so the real DI adapter image has never reached Container Apps; `terraform apply` has no `needs:` on `terraform-plan`; prod DI is defined in Terraform but not applied.

`index.md` §4 asserted `[x] No open Change Records`. Not corrected in the CR files themselves (that is each CR's own author's call, and rewriting another CR's verification/gate sections after the fact would misrepresent what was actually run), but the Health Check line is corrected in §3 below to stop claiming otherwise.

### 2.5 Stale header dates where doc bodies had in fact changed

The 2026-08-20 open-meteo CR's edits did land in eight doc bodies (prd/sdd/qad/ops/clr/ues/scrutiny/build all contain "free tier"), but none of PRD, SDD, or QAD bumped their own header's Last Reconciled date, and `index.md` §1's table still shows the pre-08-20 dates for all three.

## 3. Changes made

1. **RFC-2** (`rfc-arkilaunch-ocr-edtr-reconciliation.md`): header note added; three addenda added per §2.1 table above (pilot-addendum paragraph, implementation-gap callout, untrained-model note).
2. **QAD** (`qad-arkilaunch.md`): header note added; deviation notes added under §2 (staging environment) and §4 (Newman substitution + the three still-`echo` CI jobs).
3. **AIA** (`aia-arkilaunch.md`): status note added in §2 above the risk-register escalation line.
4. **`index.md`**:
   - §1: bump Last Updated / Last Reconciled for PRD, SDD, QAD, and RFC-2 to reflect the 2026-08-13/08-15/08-20 waves that actually changed them.
   - §2: add this CR's row.
   - §4: replace the two false `[x]` rows with honest `[~]` rows (see §4 below), matching the existing `[~]` style used for the unreproducible external validator.
5. **`log-arkilaunch.md`**: this pass appended, in the style of the 2026-08-01 remediation entry.

## 4. Corrected Health Check rows (`index.md` §4)

Replacing:
```
- [x] Every Locked doc's **Last Reconciled** date is newer than the last code change to its area. (...)
- [x] No open Change Records.
```
with:
```
- [~] Every Locked doc's **Last Reconciled** date is newer than the last code change to its area. RFC-2, QAD, and PRD headers now bumped to 2026-08-20 by this pass. Still open: neither RFC-2 nor QAD names an owner responsible for catching the *next* silent write-back gap — this pass found the drift by manual review, not by a check that runs automatically.
- [~] No open Change Records. `cr-arkilaunch-pilot-honesty.md` §5/§6 are unfilled (verification placeholder, five subagent gates `*pending*`); `cr-arkilaunch-azure-di-provisioning.md` §6 names a broken Deploy workflow (`azure/login` failing since 2026-08-06) as unresolved. Neither is re-opened by this pass — that is a call for each CR's own follow-through, not a doc-reconcile edit — but the Health Check no longer claims they are closed.
```

## 5. Deferred (explicit scope cuts, not gaps)

- **The reconciliation summed-hours blind spot** (`packages/db/src/reconciliation.ts:24-26`) is documented here as a spec divergence, not fixed. Fixing it is a code change against a Locked RFC's actual comparison semantics (start/end time, breakdown status, and a real per-dimension delta), which belongs in its own RFC-2-implementation CR, not a doc-reconcile pass.
- **The three `echo`-stub CI jobs** (`ocr-accuracy-gate`, `newman-api-suite`, `money-path-e2e`) and the missing AI-05/AI-06 tests are named in the QAD addendum but not turned into real jobs here — that is `ai-ocr-abuse-runner` + CI work, out of scope for a docs pass.
- **The RFC-1-adjacent database grant hole** found in the same review — `tenants` still has INSERT granted with no RLS, `equipment_types`/`subscription_plans` remain fully writable by any tenant user (`0002_force_rls_and_grants.sql:91-97`, only partially revoked by `0007`) — is a cross-tenant write path and the single highest-severity finding of the review, but it is RFC-1 migration work, not documentation. Flagged here for a dedicated CR; not touched by this pass.
- **Live suite execution** (running `pnpm --filter @arkilaunch/api test` etc. against a real Postgres to confirm current pass/fail state) was attempted and could not complete in this environment — no Docker daemon was reachable locally. Not a doc-reconcile item; noted so it isn't mistaken for a "confirmed passing" claim anywhere in this record.
- **`cr-arkilaunch-pilot-honesty.md` §5/§6 and `cr-arkilaunch-azure-di-provisioning.md`'s Deploy-workflow fix** are each that CR's own unfinished work and are intentionally not completed by this record — this pass corrects what `index.md` claims about them, not the CRs' own content.

## 6. Verification

- `grep -c manual_transcription docs/rfc-arkilaunch-ocr-edtr-reconciliation.md` → non-zero (was 0 before this pass).
- `grep -n "staging.*dev\|Newman" docs/qad-arkilaunch.md` shows both new deviation notes.
- `docs/index.md` §1's Last Reconciled column for PRD/SDD/QAD/RFC-2 matches each doc's own header after this pass.
- No `[x]` remains in `index.md` §4 that this record's own findings would contradict.
- No code changed; `pnpm lint`/`pnpm typecheck`/`pnpm test` are unaffected by this pass (docs-only diff).
- Not run: `materialize.py` (external FMD engine, not vendored in this repo) — none of the four touched docs materialize to a root artifact (`build-arkilaunch.md`→`AGENTS.md`, `dsd-arkilaunch.md`→`BRAND.md`/`DESIGN.md`, `aia-arkilaunch.md` §1→`MODEL_CARD.md` are the only materializing docs, and this pass touches AIA's §2, not §1), so no hand-materialization is needed.
