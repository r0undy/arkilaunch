# Change Record

**Title:** Azure AI Document Intelligence provisioned and the real extraction adapter lands; Azure Monitor telemetry wired in
**Project:** ArkiLaunch
**Date:** 2026-08-15
**Version:** 0.1
**Status:** `In Progress`
**Trigger doc:** [build-arkilaunch.md](build-arkilaunch.md) §5.1 (brownfield change workflow); [cr-arkilaunch-pilot-honesty.md](cr-arkilaunch-pilot-honesty.md) §8 (deferred: "The Azure DI network client")
**Docs touched by this record:** [aia-arkilaunch.md](aia-arkilaunch.md) (AIA-R7 status), [clr-arkilaunch.md](clr-arkilaunch.md) §1 gap E1, [rfc-arkilaunch-ocr-edtr-reconciliation.md](rfc-arkilaunch-ocr-edtr-reconciliation.md) §5/§7, [ops-arkilaunch.md](ops-arkilaunch.md) §2/§4, [index.md](index.md) §2 (Change Log)

---

## 1. Why this pass exists

An audit of ArkiLaunch's Azure footprint found the Terraform stack complete (RG, ACR, Log
Analytics + App Insights, Container Apps Environment, managed identity, API app, 4 cron jobs) but
two things it promised were not actually wired up:

1. **Document Intelligence was plumbed end-to-end but the resource never existed.**
   `AZURE_DI_ENDPOINT`/`AZURE_DI_KEY` flowed GitHub secret → `TF_VAR_*` → Container App secret →
   env, and `packages/shared/src/document-intelligence-port.ts`'s `documentIntelligenceAvailability`
   hardcoded `no_adapter`. `cr-arkilaunch-pilot-honesty.md` §8 deferred the network client
   deliberately, "so the adapter has a specification to satisfy the day credentials land." This
   pass is that day.
2. **Application Insights was provisioned and injected but never consumed.**
   `infra/terraform/modules/log_analytics/main.tf` creates the workspace and the App Insights
   resource, and `APPLICATIONINSIGHTS_CONNECTION_STRING` was injected into the API app and all 4
   jobs — but no OpenTelemetry/`applicationinsights` SDK existed in any package.json and no code
   read the variable. `ops-arkilaunch.md` claims OpenTelemetry-to-App-Insights tracing; that
   instrumentation did not exist.

Also found and fixed in the same pass, because they were latent bugs the real adapter would have
activated silently: `jobs/src/edtr-ocr-worker.ts` had **no `ENABLE_OCR_PIPELINE` check at all**
(only an availability probe) — once Terraform populates real credentials, the cron would begin
actually calling Azure DI every 5 minutes regardless of whether an operator asked for the
pipeline; a missing extracted field defaulted to **0 hours** via `?? 0`, which is a fabricated
reading reaching the deduction gate; and `port.analyze()` ran **inside** the worker's Postgres
transaction, which would pin a Supavisor transaction-mode connection for the whole extraction
round trip once that call became a real network request instead of an instant stub return.

## 2. AIA-R7 re-arming — the section this CR exists for

`cr-arkilaunch-pilot-honesty.md` de-armed AIA-R7 (cross-border transfer of PH personal data to
Azure DI) "for the same reason" no DI resource existed, and stated it "re-arms the moment a real
DI resource is provisioned."

- A Document Intelligence resource (`kind = FormRecognizer`) now exists in Terraform for both
  `dev` (SKU `F0`) and `prod` (SKU `S0`), region `southeastasia`. Only `dev` has been applied
  locally as of this record; `prod` is defined but not yet applied (its `terraform.tfvars` still
  carries placeholder `web_origin`/`supabase_url`).
- **AIA-R7 is re-armed and remains `Open (escalated)`.** It is again a launch blocker for
  PRD-F6 and any production launch, per `aia-arkilaunch.md`.
- **No PH personal data has crossed a border.** `ENABLE_OCR_PIPELINE` and `ENABLE_OCR_KYC` stay
  `false` in both `dev` and `prod` `terraform.tfvars`. `createDocumentIntelligenceAdapter()` binds
  `UnavailableDocumentIntelligenceAdapter('flag_disabled')` whenever neither flag is set, even
  though credentials now always exist.
- The region-availability half of the previously "UNVERIFIED" note at
  `infra/terraform/environments/{dev,prod}/variables.tf` and `bootstrap/main.tf` is now resolved:
  Azure AI Document Intelligence is confirmed available in `southeastasia`. The RA 10173
  cross-border transfer basis (CLR gap E1, AIA-R7) is unchanged and remains the open item —
  region availability was never the blocker, the legal transfer basis is.
- Unlocking either flag additionally requires: `ENABLE_OCR_KYC` — counsel clearance of CLR gap
  E1, closing the launch gate in `clr-arkilaunch.md`. `ENABLE_OCR_PIPELINE` — training
  `arkilaunch-edtr-neural-v1` (no labeled data or training pipeline exists yet) plus a non-synthetic
  golden set for the RFC-2 ≥90.06% accuracy gate.

## 3. Changes — Document Intelligence

- New Terraform module `infra/terraform/modules/document_intelligence/`
  (`azurerm_cognitive_account`, `kind = FormRecognizer`, `custom_subdomain_name` set so the
  resource cannot later be destroyed-and-recreated by adding one, which would delete any trained
  custom model). SKU `F0` in dev (a genuine spend ceiling on this credit-capped subscription —
  see `docs/index.md`'s recorded monthly-spend-limit incident), `S0` in prod (no standing charge;
  bills nothing while the flags are off).
- `environments/{dev,prod}/main.tf`: `local.all_secrets.azure-di-endpoint`/`azure-di-key` now read
  directly from the module's outputs instead of `var.azure_di_endpoint`/`var.azure_di_key`. Those
  two Terraform variables, the two `TF_VAR_azure_di_*` deploy-workflow inputs, and (never having
  been set) the corresponding GitHub secrets are all deleted — Terraform-owned credentials are
  strictly better here: rotation becomes `az cognitiveservices account keys regenerate` followed
  by a plain `terraform apply`, rather than a hand-copied GitHub secret update.
- New workspace package `@arkilaunch/document-intelligence`: implements `DocumentIntelligencePort`
  against the real Azure DI v4.0 REST API (`api-version=2024-11-30`) using native `fetch` — no
  Azure SDK dependency, matching the existing "native fetch over a client SDK" precedent already
  set by `apps/api/src/storage/storage.service.ts` and the PayMongo adapter. Implements the async
  202 + `Operation-Location` polling loop, a small model registry mapping the two logical model
  ids (`arkilaunch-edtr-neural-v1`, `arkilaunch-kyc-layout-query`) to their real Azure calls
  (custom model / `prebuilt-layout` + `queryFields`), and the fail-closed rules the port
  conformance suite exists to enforce: a missing or out-of-range confidence floors to 0, never
  defaults to 1; an unknown model (404) or rejected credentials (401/403) hard-fail rather than
  return an empty result; and — because the F0 tier silently analyzes only the first 2 pages of
  any document — a page-count guard (`maxPagesPerDocument`) hard-fails rather than return a
  result computed from a truncated document.
- `packages/shared/src/document-intelligence-port.ts`: `documentIntelligenceAvailability` gained
  a `hasAdapter` parameter (default `false`, preserving the old fail-closed answer for any caller
  that forgets to pass it). Only `apps/api/src/ports/document-intelligence.port.ts` — the single
  factory that actually constructs the real adapter — is allowed to pass `true`.
- `jobs/src/edtr-ocr-worker.ts` and `apps/api/src/kyc/kyc.service.ts`: both previously called
  `port.analyze(modelId, Buffer.alloc(0))`. Both now fetch the real document bytes via a
  short-TTL Supabase Storage signed URL first (RFC-2 §6, "never a public URL" — the signed URL is
  read server-side, never handed to a third party). The worker's storage fetch and `analyze()`
  call were also hoisted **out** of the `db.transaction()` that wraps the row updates, so a
  multi-second extraction round trip no longer holds a pooled Supavisor connection open.
- `jobs/src/edtr-ocr-worker.ts` gained the missing `ENABLE_OCR_PIPELINE` gate (mirroring
  `weather-poll.ts`), and the `hoursActive ?? 0` / `hoursIdle ?? 0` fallback was replaced with a
  hard-fail to `manual entry` when either field is absent from the extraction — a missing field
  is not zero hours, and writing zero would be a fabricated reading reaching the reconciliation
  gate.

### 3.1 What is actually usable after this

| Path | Status |
|---|---|
| KYC (`prebuilt-layout` + `queryFields`) | Technically functional — no training needed. Still gated `false` pending counsel (§2). |
| EDTR (custom neural model) | Not functional. `arkilaunch-edtr-neural-v1` does not exist; needs a labeled-data training run in Document Intelligence Studio, a human task outside this pass's scope. |

## 4. Changes — Azure Monitor / Application Insights

- Added `@azure/monitor-opentelemetry@1.19.0` (the Azure Monitor OpenTelemetry Distro) to
  `apps/api` and `jobs`. Not added to `packages/shared` (must stay browser-safe) or `apps/web`
  (excluded from the Docker image).
- `apps/api/src/telemetry/instrumentation.ts`: `initTelemetry()` is called from `main.ts`
  immediately after the existing `dotenv` `config()` call and before every other `require()` —
  the same ordering hazard `main.ts` already solves for `dotenv`, generalized. No-ops silently
  (log line, no throw) when `APPLICATIONINSIGHTS_CONNECTION_STRING` is unset, which is the case
  in local dev, in CI, and whenever Terraform's empty-string secret filter drops it — telemetry
  must never be the reason the API fails to boot. A `RedactingSpanProcessor` strips
  credential-shaped attribute keys and query strings from URL attributes on every span, in both
  `onStart` and `onEnd`.
- `jobs/src/telemetry.ts`: `runInstrumentedJob(name, fn)` wraps each of the 4 cron entrypoints.
  The `finally`-block flush is the load-bearing part — a one-shot ACA Job process that returns
  from `main()` exits immediately, and without an explicit `shutdownAzureMonitor()` call the
  exporter's buffered batch would never be sent. All auto-instrumentations are disabled for jobs:
  there is no HTTP server, and the only outbound call (`diesel.ts`'s `fetch`) uses undici, which
  `instrumentation-http` does not patch — enabling it would cost a module hook for zero signal.
- `packages/shared/src/telemetry-redact.ts`: the PII-scrubbing rules as plain, dependency-free
  functions (`redactUrl`, `redactAttributes`), covered by their own spec so the guard survives
  independent of the OTel wiring around it.
- `infra/terraform/modules/log_analytics/main.tf`: added `daily_data_cap_in_gb` (default 1 GB) to
  the App Insights resource as a cost backstop against a runaway (an error loop, or a future
  change accidentally re-enabling console/winston log capture — which would double-bill every
  log line the Container Apps environment already ships to the same workspace).

### 4.1 Deliberately deferred (not in this pass)

- Route-name instrumentation (`instrumentation-express`/`instrumentation-nestjs-core`) — every
  request span's operation name is currently the raw URL rather than a normalized route
  (`GET /api/v1/edtr/:id`), which is unbounded cardinality. Left out to avoid pinning two more
  OpenTelemetry contrib packages whose peer-range compatibility with the Distro's own
  `@opentelemetry/instrumentation` version was not verified in this pass.
- An Azure Cost Management budget + `azurerm_monitor_metric_alert` for SLO-2 (p95 < 400ms,
  alert A10) and for Azure DI per-page spend (alert A7, `ops-arkilaunch.md` SLO-12) — needs a
  product-set budget figure not stated in any doc, and the exact metric shape needs confirming
  against a live resource once CI/CD can actually deploy this code (see §6).
- An error-biased sampler (drop non-error spans in `onEnd` while always keeping errors) — the
  Distro's default rate-limited sampler (5 traces/sec) is effectively 100% at this pilot's stated
  volume (<10 daily active users), so this is unnecessary today.

## 5. Corrections to earlier records

- `infra/terraform/environments/{dev,prod}/variables.tf` and `bootstrap/main.tf` previously
  flagged the `southeastasia` region choice as "UNVERIFIED against Azure DI region availability."
  Availability is now confirmed (§2); the comments have been updated to point at the real
  remaining gap (RA 10173 transfer basis, CLR E1 / AIA-R7).

## 6. Deferred / follow-ups

1. **Unblock CI/CD.** Every `Deploy` workflow run since 2026-08-06 has failed at `azure/login` in
   ~12s: the GitHub `dev`/`prod` environments hold zero variables/secrets and the Entra app
   registration + OIDC federated credential from `infra/terraform/bootstrap/README.md` §3 was
   never created. Until this is fixed, the Terraform changes in this record take effect on local
   `apply`, but the container image carrying the new adapter and telemetry code does not reach
   Container Apps.
2. Train `arkilaunch-edtr-neural-v1` and confirm the real EDTR field names (`hours_active`/
   `hours_idle` are a documented guess pending labeling).
3. Counsel/DPO clearance of CLR gap E1 + AIA-R7 before either OCR flag is turned on anywhere.
4. Azure Cost Management budget + action group for alert A7/A10 (§4.1).
5. Prod `terraform.tfvars` placeholders (`web_origin`, `supabase_url`) and prod secrets — prod
   Document Intelligence is defined but not applied.
6. Route-name instrumentation for bounded operation-name cardinality (§4.1).
7. `terraform apply` in `deploy.yml` has no `needs:` on the `terraform-plan` job — it applies
   directly on push. Unrelated to this record but noticed while reading the workflow.

## 7. Verification run in this pass

- `pnpm --filter @arkilaunch/shared build && pnpm --filter @arkilaunch/shared test` — 51 tests
  pass, including the updated `document-intelligence-port.spec.ts` conformance suite and the new
  `telemetry-redact.spec.ts`.
- `pnpm --filter @arkilaunch/document-intelligence test` — 8 tests against a mocked `fetch`,
  covering the confidence-flooring rule, the F0 page-truncation guard, 401/404 mapping, and
  KYC `queryFields` camelCase-to-port-key mapping.
- `pnpm --filter @arkilaunch/jobs test` (edtr-ocr-worker.spec.ts) and
  `pnpm --filter @arkilaunch/api test` (kyc-engine.spec.ts, ai-abuse.spec.ts, full suite) — all
  pass against the dev Supabase project's `test-tenant-a` fixtures, the designated safe home for
  this live-DB suite per `cr-arkilaunch-pilot-honesty.md`.
- `pnpm lint` — clean across the whole workspace.
- `terraform validate` — clean (no warnings) for both `environments/dev` and `environments/prod`
  with `-backend=false` (the CLI's Azure token could not complete interactive MFA in this pass,
  so a full `terraform plan`/`apply` against the real backend was not run by the same actor who
  authored this record — see §6.1).

### 7.1 Not run in this pass

- `terraform plan`/`apply` against the live backend — blocked on an interactive `az login` (MFA).
- The DI smoke test (a real `curl` against the provisioned endpoint) — same blocker; also would
  answer, empirically, whether the `queryFields` add-on is available in `southeastasia` (documented
  as available for the `2024-11-30` API with no region restriction, but not independently verified
  against a live resource).
- A live-telemetry smoke test (confirming spans actually arrive in the App Insights workspace).
