# Change Record

**Title:** The deploy pipeline — a federated credential that was only ever prose, subjects that could not have matched, and a missing migrate step
**Project:** ArkiLaunch
**Date:** 2026-09-13
**Version:** 0.1
**Status:** `Applied`
**Trigger doc:** [build-arkilaunch.md](build-arkilaunch.md) §5.1 (brownfield change workflow); [cr-arkilaunch-azure-di-provisioning.md](cr-arkilaunch-azure-di-provisioning.md) §6 items 1 and 7
**Docs touched by this record:** [index.md](index.md) §2/§4

---

## 1. Why this pass exists

PRD §9 puts **M5 (anchor pilot deployment)** next, and M5 cannot start. Every `Deploy` workflow run since 2026-08-06 has failed at `azure/login` in about twelve seconds, and `deploy.yml` has never had a migrate step, so migration `0016` has had no path to any environment. QAD calls the CI pipeline the single source of truth for what is live, which at present resolves to nothing being able to go live at all.

[cr-arkilaunch-azure-di-provisioning.md](cr-arkilaunch-azure-di-provisioning.md) §6 recorded the cause on 2026-08-06, and every record since has carried it forward unfixed:

> the GitHub `dev`/`prod` environments hold zero variables/secrets and the Entra app registration + OIDC federated credential from `infra/terraform/bootstrap/README.md` §3 was never created.

### 1.1 The credential was documentation, not infrastructure

`infra/terraform/bootstrap/README.md` §3 described the app registration as "a separate one-time step, not part of this bootstrap's Terraform" and gave an `az ad app create` / `az ad app federated-credential create` sequence to run by hand. Nothing anywhere under `infra/` declared it. Prose provisions nothing, so five weeks later it still did not exist, and `client-id` / `tenant-id` / `subscription-id` in `deploy.yml` resolved to empty strings. The action fails before any token exchange, which is why the runs died in twelve seconds rather than on a rejected token.

### 1.2 The documented subjects could never have matched

This is the part that would have bitten anyone who did follow §3. It prescribed subject `repo:<org>/<repo>:ref:refs/heads/dev`. Both jobs in `deploy.yml` declare `environment:`, and GitHub then issues the OIDC token with subject `repo:<owner>/<name>:environment:<env>`, never the branch-ref form. The documented credential is unmatchable by construction, and `azure/login` fails closed without explaining why. Creating it exactly as written would have left the pipeline just as red, with a far more confusing symptom.

### 1.3 No migrate step, and apply was not gated on plan

`deploy.yml` built an image and ran `terraform apply`, with nothing in between that touched the database. `0016` therefore reached the dev database only because someone ran the migrator by hand. Separately, §6 item 7 of the Azure DI record noted that `terraform apply` has no `needs:` on `terraform-plan`.

## 2. Scope, as agreed with the user before implementation

In: codify the federated credential in Terraform rather than only correct the README; add the migrate step; gate apply on plan.

Out, deliberately, and carried to §4: the fork exposure on `terraform-plan`.

## 3. What shipped

### 3.1 The credential, declared (`684a739`)

`infra/terraform/bootstrap/main.tf` gains the `azuread` provider, an `azuread_application` and its service principal, a Contributor role assignment at subscription scope, and two `azuread_application_federated_identity_credential` resources subjected on `repo:${var.github_repository}:environment:{dev,prod}`. Outputs `github_deploy_client_id` and `github_deploy_tenant_id` give the two values that go into the GitHub environments.

Bootstrap is the right home and introduces no chicken-and-egg: its header already establishes it as applied once, by hand, with local state and a human `az login`, exactly like the state storage account beside it.

### 3.2 The runbook, corrected (`b14f69c`)

`README.md` §3 now documents the `terraform apply` path, both correct `environment:` subjects, and why the ref form cannot work. Step 1's usage picks up the new required `github_repository` variable.

### 3.3 The migrate step and the plan gate (`6b90b9c`)

A migrate step sits between the image push and the apply. The push stays first because apply references `image_tag=$GITHUB_SHA` and would otherwise point a Container App at a tag ACR has never seen. Migrate precedes apply because apply is what rolls the API revision and the four cron jobs onto the new image; applying first would leave new code reading a schema that is not there yet. The migrations are expand-only and idempotent ([cr-arkilaunch-m4-money-path-gates.md](cr-arkilaunch-m4-money-path-gates.md)), so the old revision tolerates the new schema for the length of the apply.

It passes `DATABASE_URL_DIRECT`, not the pooled URL: pooled is transaction mode and cannot carry the prepared statements the migrator needs. It also passes `APP_AUTHENTICATED_PASSWORD`, which is not optional in practice even though `packages/db/src/migrate.ts` only warns when it is absent. Omitting it would leave the step green while `app_authenticated` kept a stale password and every pooled runtime connection failed.

`deploy` now declares `needs: terraform-plan`. That required `terraform-plan` to stop being `pull_request`-only: a skipped job blocks its dependents, and the two `if` guards were mutually exclusive, so a bare `needs:` would have deadlocked rather than ordered anything. Plan now runs on deploying pushes too, where a plan that errors stops the apply before an image is built or a migration runs.

## 4. Recorded, not fixed

- **The `terraform-plan` fork exposure.** The job runs on `pull_request` with `environment: dev`, so a pull request can obtain Azure Contributor credentials. Widening this pass to cover it would have mixed an access-control argument into a pipeline repair. It wants its own review.
- **Deploy is still red after this record.** Nothing here creates the Entra application or populates the GitHub environment variables. Those need a human with directory permission to run the bootstrap apply and paste two outputs. This record unblocks that work; it does not complete it.
- **`0016` was already live on dev.** The dev database shows all seventeen migrations applied 2026-08-07, by hand. The migrate step therefore prevents future drift rather than repairing a stale database. The claim in [index.md](index.md) §4 that `0016` "has no deployment path" was true of the pipeline and never of the dev database.

## 5. Verification

Run, with real results:

- `terraform fmt -check` in `infra/terraform/bootstrap` — clean, no diff.
- `terraform init -backend=false` — installed `hashicorp/azuread` v3.9.0; `.terraform.lock.hcl` updated and committed.
- `terraform validate` — **Success! The configuration is valid.**
- `deploy.yml` parsed with the workspace `yaml` library: two jobs, `deploy.needs = terraform-plan`, `terraform-plan` carries no `if`, so the graph has no skipped-dependency deadlock. Step order in `deploy` confirmed as build-and-push (2), migrations (6), apply (9).

Not run, and not claimed:

- `terraform apply` in bootstrap. Needs a human `az login` with permission to create an Entra app registration.
- The `Deploy` workflow end to end. It cannot go green until the bootstrap is applied and the environment variables exist.
- `actionlint` is not installed in this environment, so the workflow was structurally parsed rather than lint-checked.

One unintended action, recorded because it touched a live database. A command intended to prove `migrate.ts` fails cleanly with `DATABASE_URL_DIRECT` unset instead picked the value up from a local `.env` and ran the migrator against the hosted Supabase **dev** database. All seventeen migrations were already applied on 2026-08-07, so the replay wrote no schema change, which is the idempotency the M4 record claims. The single write was `ALTER ROLE app_authenticated WITH PASSWORD`, setting the dev password to the value it already held. No production system was contacted. The intended check was therefore not obtained by execution; the throw at `packages/db/src/migrate.ts:11-14` was confirmed by reading instead.

## 6. Pre-merge gate runs

| Agent | Applies | Verdict |
|---|---|---|
| `tenant-isolation-checker` | No | Not run. No auth, query, repository or table change; this pass touches only the pipeline that ships the existing `0016`. |
| `migration-rls-guardian` | No | Not run. No Drizzle schema or migration diff. No migration file is added, removed or edited. |
| `edtr-ocr-worker` | No | Not run. Nothing on the OCR, extraction, reconciliation, KYC or deduction-gate path. |
| `ai-ocr-abuse-runner` | No | Not run. No change to the OCR/AI path. |
| `restraint-guardian` | Yes | Recorded in the PR body. |
