# Change Record

**Title:** Pilot honesty pass: fail-closed extraction ports, manual-transcription double-entry, and CI that actually runs
**Project:** ArkiLaunch
**Date:** 2026-08-13
**Version:** 0.1
**Status:** `In Progress`
**Trigger doc:** [build-arkilaunch.md](build-arkilaunch.md) §5.1 (brownfield change workflow); pilot-readiness review 2026-08-13
**Docs touched by this record:** [rfc-arkilaunch-ocr-edtr-reconciliation.md](rfc-arkilaunch-ocr-edtr-reconciliation.md) §2/§3/§7 (addendum), [qad-arkilaunch.md](qad-arkilaunch.md) §2/§4 (deviation), [aia-arkilaunch.md](aia-arkilaunch.md) §risk register (status note), [index.md](index.md) §2 (Change Log)

---

## 1. Why this pass exists

The project is being prepared for a **real production pilot with Almara Construction**, the anchor tenant. No external vendor credentials are available yet: no Azure AI Document Intelligence resource, no Open-Meteo commercial key, no PayMongo keys, no email provider.

All eight PRD features have working backends and the Azure Container Apps deploy is live, so on the surface the system looks pilot-ready. A readiness review found it is not, for three reasons that no amount of further feature work would fix.

### 1.1 The core product cannot function without a change

`packages/db/src/reconciliation.ts:53` selects a counterpart log with `ne(edtr.source, record.source)`. Since `source` is limited to `paper_ocr | digital_entry`, reconciliation **requires one row of each type**. With no OCR adapter, a `paper_ocr` row can never reach an `extracted` status carrying line items, so no pair can ever form. Every log therefore lands `single_source` → `pending`, and `apps/api/src/edtr/edtr.service.ts:264` correctly throws `422 not_approvable` for any status that is not `matched` or `discrepancy`.

The consequence: **no deposit deduction can ever be approved.** PRD-F3 trusted usage-based billing, the product's core differentiator, is dead on arrival in a credential-less pilot. This was not previously recorded anywhere.

### 1.2 Production code fabricates data

`apps/api/src/kyc/kyc.module.ts:18-23` binds `FixtureDocumentIntelligenceAdapter` **unconditionally at module scope**, returning literal `sec_number: 'CS202312345'` and `tin: '123-456-789'` at `0.95` confidence for any uploaded document, in any environment. The module's own comment acknowledges that `ENABLE_OCR_KYC` has no effect on which adapter binds.

The human gate does hold: `kyc.service.ts:87` lands every extraction at `needs_review`, and `:146` requires an admin-supplied `registryStatus` plus a portal match score to reach `verified`. So the fixture **cannot** auto-verify a tenant. The harm is narrower but still unacceptable for a real pilot: a reviewer is shown invented registration numbers presented as extracted fact at high confidence (an anchoring risk on a compliance decision), and fabricated `ocr_field_confidence` events enter the audit trail that AIA-R2 and the OPS SLIs both read.

`StubWeatherAdapter` is worse in kind. It returns `tempC: 0, windKph: 0, precipMm: 0, code: 0`, which makes `evaluateSeverity` return `'none'`, and `severityMessage('none')` renders "No weather advisory in effect". That is a **fabricated all-clear safety signal for a construction site** — a false negative on the one output where a false negative can hurt someone.

`StubPaymentsAdapter` returns `checkoutUrl: 'about:blank?...'`, handing a paying customer a blank page while the booking record believes a checkout session exists.

In all three cases the failure mode is the same: a stub that returns a *plausible value* is indistinguishable from a real reading. An empty `{fields:{}}` result is not "no data", it is "the sheet was blank" — a lie the reconciliation engine cannot detect.

### 1.3 Almost nothing is verified

33 spec files execute in **zero** CI jobs. `.github/workflows/ci.yml` runs only `pnpm --filter @arkilaunch/web test`. Not running: 17 specs in `apps/api/test/` (including `ai-abuse`, `role-escalation`, `refresh-rotation`, `auth-lockout`, `edtr-engine`, `payments-engine`), 4 in `apps/api/src/`, 3 in `jobs/src/`, and 5 in `packages/shared/src/`. The 4 `packages/db/test/` isolation specs sit behind `vars.RUN_LIVE_DB_TESTS`, which is off. The three declared gates `ocr-accuracy-gate`, `newman-api-suite`, and `money-path-e2e` are literally `echo "skipped"`.

The AI-adversarial suite and the money-path gate tests were written, are correct, and have never gated a single pull request.

---

## 2. Divergences from Locked docs

### 2.1 RFC-2 §2/§3 — `manual_transcription` as a first-class log source

**Decision:** for the pilot, a `paper_ocr` capture may carry **human-transcribed** line items. The timekeeper photographs the paper EDTR sheet *and* types the hours it shows. The row keeps `source = 'paper_ocr'` and records an `ocr_payload` with `model_id: 'manual_transcription'` and `min_field_confidence: 1`.

**Why this is faithful to RFC-2, not a workaround.** RFC-2's double-entry principle is that two *independent* logs must agree before money moves; a single unchecked source "would defeat the whole point". Source type was only ever a proxy for independence. Under this change the two logs remain genuinely independent: the timekeeper's transcription at the site, and the project manager's `digital_entry` from their own record. The tolerance gate, the `single_source` → `pending` → `422` path, the `FOR UPDATE` pair lock, and the `409 already_approved` joint transition from `cr-arkilaunch-edtr-double-approve.md` all keep working at full strength. RFC-2 already specifies that a hard extraction failure "routes to manual entry and re-enters the pipeline as a second log" — this is that path, made reachable.

**Why `min_field_confidence: 1` is correct and not a fudge.** `minFieldConfidence` (`packages/db/src/reconciliation.ts:17`) already returns `1` for `digital_entry` on the stated grounds that it "has no OCR step". A human transcription has no OCR step either. The 0.90 confidence gate exists to gate *model* output; where there is no model, there is nothing for it to gate, and the double-entry tolerance check remains the real control. The `model_id` string is a permanent, queryable record of exactly how each row was produced, so this can never be mistaken for a real extraction after the fact.

**No schema change and no migration.** `OcrPayloadSchema` (`packages/shared/src/edtr.ts:19`) already carries `model_id` and `min_field_confidence`, and `EdtrCaptureFieldsSchema` already permits `lineItems`.

### 2.2 QAD §4 — supertest in place of Newman/Postman

The QAD names Newman for the API contract suite. **No Postman collection exists anywhere in the repository**, and the contracts it would cover (the `409 reconciliation_discrepancy` shape, webhook signature rejection, status codes) are reachable from the NestJS testing module with supertest inside the Vitest run this pass is already standing up. One test stack instead of two, one CI job instead of two, and no collection to hand-synchronize.

Recorded as a deliberate deviation. If the capstone panel requires Newman by name as a named deliverable, the collection can be added later without undoing this.

### 2.3 QAD §2 — `dev` designated as the staging surface

The QAD names `https://staging.arkilaunch.app`. Terraform defines only `dev` and `prod`. For a single-tenant pilot with fewer than ten daily users, a third environment triples upkeep and cost for no proportionate gain. The existing `dev` environment is designated as staging; it also becomes the safe home for the live-DB isolation suite, which must never run against prod because `pnpm db:seed:test` writes fixture tenants.

### 2.4 RFC-2 §7 — feature flags become real

`ENABLE_OCR_PIPELINE` and `ENABLE_OCR_KYC` are specified in RFC-2 §7 but were referenced by no conditional in code. They are now wired to the behavior RFC-2 already describes, rather than deleted.

`ENABLE_QUOTE_ENGINE` is **retired**. The RFC-3 quotation engine shipped unflagged and is in production use; a flag that would disable a working deterministic feature is dead weight (restraint ladder rung 1).

`ENABLE_WEATHER_POLL` is load-bearing in `jobs/src/weather-poll.ts:16` but appears in neither `.env.example` nor Terraform, so in production the weather job would run on cron and silently no-op forever with no way to diagnose it. It is added to both.

### 2.5 AIA — risk status under a credential-less pilot

With no model running, `AIA-R1`, `AIA-R3`, and `AIA-R5` are **not exercised** rather than merely mitigated; the honest status is "not applicable this pilot", not "controlled". `AIA-R7` (cross-border data residency for Azure DI) stops being a pilot launch blocker for the same reason, and re-arms the moment a real DI resource is provisioned.

---

## 3. Changes

*(Filled in as each phase lands. See §5 for verification.)*

### 3.1 CI executes the existing suite

**`.github/workflows/ci.yml`** gains two jobs:

- **`node-unit-tests`** — runs `packages/shared` (pure logic: Zod schemas, the reconciliation gate, weather severity, OCR accuracy math). No service container needed.
- **`api-integration-suite`** — a `postgres:17` service container, reusing the pattern already proven in `migration-expand-contract-check`. Applies migrations, seeds the two-tenant fixtures, generates a throwaway RS256 keypair, then runs the `apps/api`, `jobs`, and pooler-independent `packages/db` suites.

Two details are load-bearing:

1. **`DATABASE_URL_POOLED` connects as `app_authenticated`, never as `postgres`.** `postgres` is a superuser, and superusers bypass RLS regardless of `FORCE`. Running the suite as `postgres` would make every tenant-isolation assertion pass vacuously — a green pipeline proving nothing. `packages/db/src/migrate.ts` already rotates that role's password from `APP_AUTHENTICATED_PASSWORD`, so the role is loginable.
2. **The `packages/db` specs are named as an explicit file list**, not selected by a runtime `skipIf`. `guc-pooler-leak.spec.ts` genuinely requires Supavisor and stays in the live-DB job; naming the other three explicitly means a security test cannot quietly disappear from CI by skipping itself.

Also fixed: the three stub jobs (`ocr-accuracy-gate`, `newman-api-suite`, `money-path-e2e`) used unquoted `run: echo "skipped: ..."` values. A YAML plain scalar cannot contain `": "`, so the workflow was **strictly invalid YAML** — GitHub's parser tolerates it, but every standard parser rejects the file, which blocks local validation tooling. The three values are now quoted.

#### Finding: a stale privilege-escalation test, failing unnoticed

Turning the suite on immediately surfaced a real failure in `packages/shared/src/users.spec.ts`: *"owner, timekeeper, and customer can never act on anyone"*. This is **not** a security hole — it is a stale test. `ROLE_PROTECTED_FROM.owner` is `['platform_admin']` because commits `354cfc9` / `164e28c` deliberately granted `owner` governance of its own tenant's users, and `users.ts` documents that intent in a comment. The assertion encoded the pre-grant rule and was never updated, because the suite ran in no CI job. Split into `timekeeper and customer can never act on anyone` and `owner governs its own tenant staff but is blocked from platform_admin`.

#### Finding (open): owner-on-owner administration is permitted

While fixing the above: `ROLE_PROTECTED_FROM.owner` lists only `platform_admin`, so **one owner may deactivate or role-change a co-owner**. That is the same lateral-takeover shape the table's own comment says it exists to prevent. Reach is currently limited because no role can *grant* `owner` through this API (`ROLE_ASSIGNABLE_BY` excludes it), so a second owner can only arrive via platform seeding or the S25 console.

Not changed unilaterally — this is an authorization-policy decision, and the policy was shaped deliberately in a recent commit. Current behavior is pinned by an explicitly-named test so it cannot drift either way while the decision is open. To tighten: add `'owner'` to `ROLE_PROTECTED_FROM.owner` and flip that assertion.

### 3.2 Fail-closed extraction ports

**Test doubles are now unreachable from production code at build time**, not merely discouraged:

- `FixtureDocumentIntelligenceAdapter` and `FixtureWeatherAdapter` moved out of `packages/shared/src/*-port.ts` into `packages/shared/src/testing/index.ts`, exposed only through a new `./testing` subpath in the package's `exports` map (plus a `typesVersions` shim, because `apps/api` typechecks with `moduleResolution: "Node"`, which predates `exports`).
- `eslint.config.js` gains a `no-restricted-imports` rule on `@arkilaunch/shared/testing`, overridden for spec files. `pnpm lint` runs in CI, so this is the enforcement. Verified by probe: importing it from `apps/api/src` fails lint with the explanatory message.

A runtime flag was rejected for this: a fixture returns *plausible* values, so one that binds by accident is indistinguishable from a real reading at the call site. A flag can be misconfigured; a module that production code cannot import cannot be.

**Stubs replaced with adapters that throw:**

- `StubDocumentIntelligenceAdapter` → `UnavailableDocumentIntelligenceAdapter`, throwing `ExtractionUnavailableError` with a `reason`. The old stub returned `{ fields: {} }`, which is indistinguishable from "the sheet really was blank".
- `StubWeatherAdapter` → `UnavailableWeatherAdapter`, throwing `WeatherUnavailableError`. `packages/shared/src/weather-port.spec.ts` pins the reason as an executable assertion: `evaluateSeverity({ tempC: 0, windKph: 0, precipMm: 0, code: 0 })` returns `'none'`, so the old stub was writing a fabricated all-clear for a construction site.
- New `documentIntelligenceAvailability(env)` takes the environment as an argument rather than reading `process.env`, keeping `packages/shared` safe to import from the browser bundle. It **cannot return `available: true`** while no real adapter exists, and a test asserts exactly that.
- New `createDocumentIntelligenceAdapter()` in `apps/api/src/ports/document-intelligence.port.ts`, following the `createPaymentsAdapter()` precedent, **throws at construction** if `ENABLE_OCR_PIPELINE`/`ENABLE_OCR_KYC` is on while nothing can serve it. Nest fails to boot rather than accepting uploads it cannot process.
- `jobs/src/edtr-ocr-worker.ts` checks availability **before the claim UPDATE** and returns early, emitting `external_dependency_degraded`. Previously it would have claimed rows, failed, and churned `attempts` toward `MAX_ATTEMPTS`, eventually hard-failing good captures for a reason unrelated to them.
- `apps/api/src/kyc/kyc.module.ts` binds the factory; the literal `CS202312345` / `123-456-789` fixture is gone. `KycService.extract` catches `ExtractionUnavailableError`, stores `ocrPayload: null` (not `{}` — an empty payload would read as "the model found nothing", a different and untrue claim), emits `ocr_extraction_unavailable`, and lands `needs_review` as before.

**Also removed:** the `POST edtr/dev/run-worker` POC shim, pulled forward from Phase 4b because it was the second production binding of a fixture. Its own comment said "Remove before this ships past a POC". `@arkilaunch/jobs` is dropped from `apps/api`'s dependencies (that route was its only importer), so the API image no longer carries cron entrypoints. Replacement for local dev, matching how production runs it: `pnpm --filter @arkilaunch/jobs worker:edtr` (new scripts for all four jobs).

New: `packages/shared/src/document-intelligence-port.spec.ts` carries an exported **port conformance suite** every future adapter must pass — never return a fabricated value, map a missing confidence to `0` rather than `1`, throw rather than return empty on transport failure — written before the adapter deliberately, since those are the rules whose violation produces a wrong *number* rather than a visible error.

### 3.3 Manual-transcription capture path

`apps/api/src/edtr/edtr.service.ts` `capture()`:

1. A `paper_ocr` capture now **requires** `lineItems` when the OCR pipeline is off, and **rejects** them when it is on (`422 line_items_required` / `422 line_items_not_accepted`) — a human pre-filling values the worker would overwrite is ambiguous. The rule lives in the service, not the schema, so Zod stays a pure shape validator; `EdtrCaptureFieldsSchema` already permitted `lineItems` on either source, so **no schema change was needed**.
2. Such a row is written with an `ocr_payload` from the new `buildManualTranscriptionPayload()` (`packages/shared/src/edtr.ts`): `model_id: 'manual_transcription'`, `min_field_confidence: 1`. **No migration and no new column** — `edtr.ocr_payload` already exists and `minFieldConfidence()` already reads `payload.min_field_confidence`.
3. Its initial status is `extracted` rather than `queued`: there is no worker step left for it to wait on.
4. `reconcileEdtr` is now called whenever `body.lineItems` is present, not only for `digital_entry`. That single condition is what previously made a paper row unable to enter the gate at all.
5. `EdtrDetailResponseSchema` gains `extraction: { modelId, analyzedAt, isManualTranscription } | null`, so a client cannot render a transcription's confidence of `1.00` as "OCR 100% confident". The two mean opposite things to a reviewer.

The state machine is untouched. The tolerance gate, `single_source` → `pending` → `422 not_approvable`, the `FOR UPDATE` pair lock, and `409 already_approved` all keep working at full strength — `packages/shared/src/edtr.spec.ts` asserts that two humans disagreeing beyond the ±0.25h tolerance are still stopped.

### 3.4 Feature flags

`ENABLE_OCR_PIPELINE` and `ENABLE_OCR_KYC` are wired to real behavior for the first time (§3.2, §3.3): off means paper capture requires human-transcribed hours and the worker no-ops; on means the API refuses to boot without a real adapter.

`ENABLE_QUOTE_ENGINE` **removed** from `.env.example`, both Terraform environments' `main.tf` / `variables.tf` / `terraform.tfvars`. It was referenced by zero lines of TypeScript, and the RFC-3 engine it nominally guarded shipped unflagged and is in use.

`ENABLE_WEATHER_POLL` **added** to all of the above. It gates `jobs/src/weather-poll.ts:16` but appeared in neither `.env.example` nor Terraform, so in every deployed environment the weather job ran on its cron schedule and silently no-opped with nothing to explain why. The cron modules take `local.common_env_vars`, so adding it there reaches the job.

`terraform fmt -check -recursive` clean.

### 3.5 Evidence access (Evidence Split View)

### 3.5 Deploy, infra, and secret hardening

---

## 4. What cannot be verified without credentials

Recorded explicitly so it is never mistaken for tested behavior:

1. **`arkilaunch-edtr-neural-v1` is a fictional model id** (`jobs/src/edtr-ocr-worker.ts:17`). A custom neural model requires labeled Almara sheets and a training run. The field names the entire worker keys on (`hours_active`, `hours_idle`) are a guess until that model is trained and its labels are fixed.
2. **Whether Azure DI query fields return a per-field confidence at all** for PH corporate documents on the KYC path. If they return `null`, the 0.90 gate would silently evaluate against a language default. This is the highest-severity unknown on the AI path, and it is precisely why the port conformance suite added in this pass requires a missing confidence to map to `0`, never `1`.
3. **Handwriting accuracy against the BRD-M2 ≥90.06% target** (QAD-T39). Unmeasurable without a gold set of real labeled EDTR sheets; the current `EDTR_GOLDEN_SET` is synthetic placeholder data and its harness asserts `6/8`, which proves the metric computes, not that the target is met.
4. **SE Asia region availability** for the required Azure DI models (`AIA-R7`, still open and escalated).
5. **Whether `prebuilt-layout` reads a PH SEC certificate's layout usefully** at all.

---

## 5. Verification

*(Filled in as each phase lands.)*

---

## 6. Pre-merge gate runs

`AGENTS.md` §2 names five pre-merge subagents. A review of the change-record history found that **every prior CR except two records that they were not run**. This pass runs each once against the current tree, scoped to the surface it owns, and records the verdict here. A `.github/pull_request_template.md` is added so the omission becomes visible in the PR body rather than discovered ten records later.

| Agent | Scope | Date | Verdict | Findings |
|---|---|---|---|---|
| `tenant-isolation-checker` | schema, services, jobs | *pending* | | |
| `migration-rls-guardian` | all 16 migrations | *pending* | | |
| `ai-ocr-abuse-runner` | `edtr/`, `kyc/`, ports | *pending* | | |
| `edtr-ocr-worker` | worker + spec | *pending* | | |
| `restraint-guardian` | `793884e`, `d59323d` | *pending* | | |

---

## 7. Corrections to earlier records

- **`cr-arkilaunch-frontend-deploy-readiness.md` §2 is stale.** It states that a root `vercel.json` was added and `apps/web/vercel.json` "removed (superseded)". On disk the opposite is true: commit `1eea33d` renamed the file to `apps/web/vercel.json` and changed `outputDirectory` from `apps/web/dist` to `dist`. The repository additionally contradicts itself, because the repo-root `.vercelignore` is only honored when Vercel's Root Directory is the repo root, which the `apps/web/vercel.json` layout contradicts. Resolved in §3.5.
- **A readiness review initially reported that `infra/terraform/bootstrap/terraform.tfstate` and ~100 MB of provider binaries were committed to git. This was wrong** and is recorded here so it is not re-litigated: `git ls-files` matches neither, `git log --all` confirms they were never committed in any revision, `.git` is 1.4 MB, and `infra/terraform/.gitignore:6` already covers them. No history rewrite is needed and no credential rotation is required *on git-exposure grounds*. A separate, real finding about that same file is handled in §3.5.

---

## 8. Deferred

- The **Azure DI network client**. The async `202` + `Operation-Location` polling loop, written blind against an API version that will move before a key arrives, is speculative code guaranteed to drift (restraint ladder rung 1). A port conformance suite is built instead, so the adapter has a specification to satisfy the day credentials land.
- The **RFC-1 snake_case/camelCase wire drift** (`access_token`/`expires_in` vs `packages/shared/src/auth.ts`). A doc-versus-code contract reconciliation, not a pilot-safety item; changing the auth wire shape during pilot preparation buys risk with no honesty gain.
- A **KYC evidence-URL route**. KYC images are sensitive personal information under RA 10173 with `AIA-R7` open; the EDTR equivalent is built, the KYC one is not.
- **Preview-URL CORS**, **prerender chaining into the Vercel build**, **`pnpm deploy --prod` Dockerfile pruning**, and a **third staging environment** — each an explicit scope cut with its reasoning recorded in §3.5.
