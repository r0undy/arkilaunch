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

`environments/dev/main.tf` and `environments/prod/main.tf` each have a
`backend "azurerm"` block referencing `storage_account_name` and a
per-environment `key` (state file path within the `tfstate` container). Fill
in the storage account name from step 1 (already parameterized via
`-backend-config` at `terraform init` time — see each environment's own
README/comments).

## 3. OIDC federated credential (for CI)

`deploy.yml` authenticates to Azure via an OIDC federated credential, not a
long-lived Service Principal secret. This is now part of this bootstrap's
Terraform (`main.tf`), so step 1's `terraform apply` creates it. It used to be
described here as a manual `az ad` sequence, which is why it was never
actually created and why every Deploy run since 2026-08-06 failed at
`azure/login` in about twelve seconds.

Pass the subject prefix GitHub will present, so the credential is scoped to this repository:

```
terraform apply \
  -var subscription_id=<sub-id> \
  -var github_subject_prefix="$(gh api repos/<org>/<repo>/actions/oidc/customization/sub --jq .sub_claim_prefix)"
```

That declares a user-assigned managed identity, a Contributor role assignment
at subscription scope, and one federated credential per environment with these
subjects:

```
<prefix>:environment:dev
<prefix>:environment:prod
```

Read the prefix from GitHub, never assemble it by hand. With immutable
subjects on, which is the default for new repositories, GitHub presents
`repo:<owner>@<owner-id>/<repo>@<repo-id>` rather than the readable
`repo:<owner>/<repo>`, and a credential built from the readable form is
rejected with `AADSTS700213: No matching federated identity record found`.
The `gh api .../actions/oidc/customization/sub` call above returns the exact
prefix that repository will present.

Note the `environment:` form. An earlier version of this README prescribed
`repo:<org>/<repo>:ref:refs/heads/dev` instead, which cannot work here: both
jobs in `deploy.yml` declare `environment:`, and GitHub then issues the token
with an `environment:` subject claim rather than a branch ref. A credential
registered against the ref form is silently unmatchable, and `azure/login`
fails closed with no useful message.

A managed identity rather than an Entra app registration, because the
subscription sits in a tenant we do not administer. That directory allows
creating an app registration and then refuses to let the creator own, modify
or delete it, so the app-registration version of this failed halfway: the
application was created, the service principal and both credentials got 403,
and the ownerless application cannot be cleaned up from here. A managed
identity is an ARM resource, so subscription Owner is sufficient and no
directory privilege is involved. Nothing in `deploy.yml` changes either way;
`azure/login` takes the same client, tenant and subscription ids.

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
`AZURE_DI_ENDPOINT`/`AZURE_DI_KEY` are no longer GitHub secrets: Terraform
provisions the Document Intelligence resource directly and feeds its
`endpoint`/`primary_access_key` outputs into the Container App secrets (see
`infra/terraform/modules/document_intelligence`).
