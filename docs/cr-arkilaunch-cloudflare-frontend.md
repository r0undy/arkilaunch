# Change Record

**Title:** Frontend hosting moves to Cloudflare Workers static assets on `arkilaunch.app`; platform domain changes from `arkilaunch.tech` to `arkilaunch.app`
**Project:** ArkiLaunch
**Date:** 2026-09-27
**Version:** 0.1
**Status:** `Applied` (repo); the DNS and dashboard cutover is done by the operator, see §4
**Trigger doc:** [build-arkilaunch.md](build-arkilaunch.md) §5.1 Brownfield Change Workflow
**Docs touched by this record:** [build-arkilaunch.md](build-arkilaunch.md) §3/§5.2 (+ `AGENTS.md`), [sdd-arkilaunch.md](sdd-arkilaunch.md) §1/§2/§5/§6, [ops-arkilaunch.md](ops-arkilaunch.md), [qad-arkilaunch.md](qad-arkilaunch.md), [clr-arkilaunch.md](clr-arkilaunch.md), [prd-arkilaunch.md](prd-arkilaunch.md), [scrutiny-arkilaunch.md](scrutiny-arkilaunch.md), [ues-arkilaunch.md](ues-arkilaunch.md), `README.md`, [index.md](index.md) §1/§2/§5

---

## 1. Summary

Tenant storefronts are resolved from the host (`{slug}.<platform domain>`, `apps/web/src/lib/host.ts`). That requires the same SPA on the apex and on a wildcard subdomain. A `*.vercel.app` deployment URL cannot carry wildcard subdomains, so `almara.<vercel host>` never worked. The operator bought `arkilaunch.app`. The frontend and DNS both move to Cloudflare, and every Vercel artifact is removed from the repo.

**Why a Worker and not Pages.** Pages custom domains cannot be wildcards. A Worker route (`*.arkilaunch.app/*`) can. `apps/web` is a static Vite SPA with no SSR, so an **assets-only Worker** is enough: there is no Worker script, and static asset requests are free and unmetered. Universal SSL covers the apex and one subdomain level, which is exactly the `{slug}.arkilaunch.app` shape.

**Environment.** Only `dev` exists (prod was never provisioned; `dev` is staging per `cr-arkilaunch-pilot-honesty.md`). `arkilaunch.app` therefore serves the dev API. When prod is provisioned it needs its own host decision; `prod/terraform.tfvars` says so.

## 2. Repo changes

- **Removed:** the root `vercel.json`, `apps/web/vercel.json` and `apps/web/public/vercel.json`.
- **Added `apps/web/wrangler.jsonc`:**
  - Worker `arkilaunch-web`, `assets.directory: ./dist`.
  - `not_found_handling: "single-page-application"` replaces the catch-all rewrite. A prerendered file still wins over the fallback.
  - Routes: a custom domain `arkilaunch.app`, plus `*.arkilaunch.app/*` on the zone.
  - `wrangler` 4.139.0 is pinned as a web devDependency. `workerd` is added to `allowBuilds` in `pnpm-workspace.yaml`.
- **`.github/workflows/deploy.yml`:** new `web` job.
  - Runs on push to `dev`, `needs: deploy`, so it ships after the API image and the apply that moves CORS.
  - Builds `shared` + `web` with `VITE_API_BASE_URL` from the `dev` environment variables.
  - Then runs `wrangler deploy` with `CLOUDFLARE_API_TOKEN` (secret) and `CLOUDFLARE_ACCOUNT_ID` (variable).
- **Domain change:**
  - `VITE_PLATFORM_DOMAIN` default in `host.ts` and `platform.index.tsx`: `arkilaunch.tech` → `arkilaunch.app`, with tests updated.
  - Terraform `platform_domain` default is `arkilaunch.app` in dev and prod.
  - `dev/terraform.tfvars` `web_origin = "https://arkilaunch.app"`. This is the API's CORS `WEB_ORIGIN`, which also drives PayMongo return origins and activation links.
  - `EMAIL_FROM` example is on `arkilaunch.app`.
  - `robots.txt`/`sitemap.xml` point at `https://arkilaunch.app`.
- **Deliberately unchanged:**
  - the `0048_host_tenant_resolution.sql` comment, because applied migrations are never edited;
  - past Change Records, `log-arkilaunch.md` and the `IDEA.md` thesis, which record what was true when they were written. This record supersedes their hosting statements.
  - drizzle-orm's optional `@vercel/postgres` peer entry in `pnpm-lock.yaml`. It is not installed and not removable.
- **API domain:** it stays on the ACA ingress FQDN. Tokens live in memory and sessionStorage, not cookies, so a cross-site API has no third-party-cookie problem.

## 3. Compliance

CLR §2: the frontend log sub-processor is now Cloudflare, which was already a named sub-processor for WAF, DDoS and TLS. No new processor is introduced. Cloudflare Workers logs are only kept while `wrangler tail` or the dashboard's real-time logs are open, unless Workers Logs is enabled.

## 4. Operator cutover (dashboards, not code)

1. Copy the deployed `VITE_API_BASE_URL` out of the old Vercel project settings before deleting it. It is `https://<ACA ingress FQDN>/api/v1`.
2. Cloudflare: add the zone `arkilaunch.app` (Free) and delete the imported registrar parking records at `@` and `www`.
3. name.com: turn DNSSEC off if it is on, then set the nameservers to Cloudflare's pair. Wait for the zone to become Active.
4. Cloudflare DNS: `AAAA * 100::`, **Proxied**. This is what lets the wildcard route receive traffic. The apex record is created by the custom domain on the first deploy.
5. Redirect Rule: `www.arkilaunch.app/*` → `https://arkilaunch.app/${1}` (301). `www` is a reserved slug.
6. SSL/TLS: turn on Always Use HTTPS.
7. API token from the "Edit Cloudflare Workers" template, scoped to the account and the `arkilaunch.app` zone.
8. GitHub `dev` environment:
   - secret `CLOUDFLARE_API_TOKEN`
   - variables `CLOUDFLARE_ACCOUNT_ID` and `VITE_API_BASE_URL`
9. Merge to `dev`. The apply moves CORS, then the `web` job deploys. The old deployment origin stops passing CORS at that point, which is intended.
10. Decommission the old host:
    - delete the project;
    - uninstall its GitHub App from the repo;
    - delete the `Preview`/`Production` GitHub environments it created (keep `dev`/`prod`);
    - revoke its tokens.
11. Registrar transfer to Cloudflare Registrar: ICANN allows it 60 days after registration. The domain was registered under 60 days before 2026-09-27. At name.com, unlock the domain and get the auth code, then go to Cloudflare → Domain Registration → Transfer. The DNS set up above carries over unchanged.

## 5. Verification

- Local:
  - `apps/web` Vitest passes: 38 files, 240 tests.
  - `tsc --noEmit` is clean.
  - `vite build` is clean.
  - `wrangler deploy --dry-run` reads the 12 assets from `dist` with no bindings.
  - `pnpm install --frozen-lockfile` is clean.
- After cutover:
  - `https://arkilaunch.app` shows the platform page.
  - `https://arkilaunch.app/equipment` loads directly, not as a 404.
  - `https://almara.arkilaunch.app` shows the Almara storefront, and its requests carry `X-Tenant-Slug: almara`.
  - Login succeeds with no CORS error.
  - `www` returns a 301 to the apex.
