# Terraform bootstrap

Run this **once per Azure subscription**, manually, before `environments/dev`
or `environments/prod` can `terraform init` — it creates the storage account
that holds their remote state. It intentionally uses local state itself
(nothing else exists yet to store it remotely).

## 1. Apply

```
cd infra/terraform/bootstrap
terraform init
terraform apply -var subscription_id=<your-subscription-id>
```

Note the `storage_account_name` output.

## 2. Wire the environments to it

`environments/dev/main.tf` and `environments/prod/main.tf` each have a
`backend "azurerm"` block referencing `storage_account_name` and a
per-environment `key` (state file path within the `tfstate` container). Fill
in the storage account name from step 1 (already parameterized via
`-backend-config` at `terraform init` time — see each environment's own
README/comments).

## 3. OIDC federated credential (for CI, also one-time/manual)

`deploy.yml` authenticates to Azure via an OIDC federated credential, not a
long-lived Service Principal secret. This is a separate one-time step, not
part of this bootstrap's Terraform (Entra ID app registration + federated
credential trusting GitHub's OIDC issuer for this repo):

```
az ad app create --display-name arkilaunch-github-deploy
az ad sp create --id <app-id>
az role assignment create --assignee <app-id> --role Contributor \
  --scope /subscriptions/<subscription-id>

az ad app federated-credential create --id <app-id> --parameters '{
  "name": "arkilaunch-github-dev",
  "issuer": "https://token.actions.githubusercontent.com",
  "subject": "repo:<org>/<repo>:ref:refs/heads/dev",
  "audiences": ["api://AzureADTokenExchange"]
}'
# Repeat for main (prod): "subject": "repo:<org>/<repo>:ref:refs/heads/main"
```

Then set these as GitHub repo (or per-environment `dev`/`prod`) variables/secrets:
`AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`, and
`TF_STATE_STORAGE_ACCOUNT` (this bootstrap's `storage_account_name` output)
as **variables**, not secrets — OIDC needs no client secret, and the state
storage account name isn't sensitive. Plus every app secret from
`.env.example` (`DATABASE_URL_POOLED`, `JWT_PRIVATE_KEY`, `AZURE_DI_KEY`,
`PAYMONGO_SECRET_KEY`, etc.) as encrypted **secrets** — see
`docs/runbook-local-dev.md` for the full list and what each one is.
