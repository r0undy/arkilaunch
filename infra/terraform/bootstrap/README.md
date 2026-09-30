# Terraform bootstrap

Run this **once per Azure subscription**, manually, before `environments/dev`
or `environments/prod` can `terraform init` — it creates the storage account
that holds their remote state. It intentionally uses local state itself
(nothing else exists yet to store it remotely).

## 1. Apply

```
cd infra/terraform/bootstrap
terraform init
terraform apply \
  -var subscription_id=<your-subscription-id> \
  -var github_subject_prefix="$(gh api repos/<org>/<repo>/actions/oidc/customization/sub --jq .sub_claim_prefix)"
```

Note the `storage_account_name` output.

## 2. Wire the environments to it

Each environment's `backend "azurerm"` block takes the account name at init
time: `terraform init -backend-config="storage_account_name=<output>"` (CI reads
it from the `TF_STATE_STORAGE_ACCOUNT` variable).

## 3. OIDC federated credential (for CI)

`deploy.yml` authenticates via OIDC, not a long-lived secret. Step 1's apply
creates a user-assigned managed identity, a subscription-scope Contributor
assignment, and one federated credential per environment:

```
<prefix>:environment:dev
<prefix>:environment:prod
```

Read the prefix from GitHub (the `gh api` call in step 1), never assemble it by
hand: with immutable subjects GitHub presents
`repo:<owner>@<owner-id>/<repo>@<repo-id>`, and the readable form fails with
`AADSTS700213`. A managed identity, not an app registration, because this
tenant lets us create app registrations but not own them.

Then set these on the GitHub `dev` and `prod` environments (the workflow reads
them per-environment, with a repo-scope fallback): `AZURE_CLIENT_ID` and
`AZURE_TENANT_ID` (this bootstrap's `github_deploy_client_id` and
`github_deploy_tenant_id` outputs), `AZURE_SUBSCRIPTION_ID`, and
`TF_STATE_STORAGE_ACCOUNT` (this bootstrap's `storage_account_name` output)
as **variables**, not secrets — OIDC needs no client secret, and the state
storage account name isn't sensitive. Plus every app secret from
`.env.example` (`DATABASE_URL_POOLED`, `JWT_PRIVATE_KEY`,
`PAYMONGO_SECRET_KEY`, etc.) as encrypted **secrets** — see
`docs/runbook-local-dev.md` for the full list and what each one is.
`AZURE_DI_ENDPOINT`/`AZURE_DI_KEY` are not GitHub secrets: Terraform
provisions the Document Intelligence resource directly and feeds its
`endpoint`/`primary_access_key` outputs into the Container App secrets (see
`infra/terraform/modules/document_intelligence`).
