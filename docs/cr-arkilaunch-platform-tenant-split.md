# Change Record

**Title:** ArkiLaunch is the platform, Almara is one tenant: host-resolved tenants, a platform landing page and an `/admin` console
**Project:** ArkiLaunch
**Date:** 2026-09-25
**Version:** 0.1
**Status:** `Applied`
**Trigger doc:** user request 2026-09-25 ("a page for arkilaunch and its tenants ... almara.localhost:{port} ... ArkiLaunch branding must follow discord.design.md")
**Docs touched by this record:** [dsd-arkilaunch.md](dsd-arkilaunch.md) §0 Named tiers + Platform tier (materialized to `DESIGN.md`), [runbook-local-dev.md](runbook-local-dev.md), [index.md](index.md) §2, [log-arkilaunch.md](log-arkilaunch.md) §1. Supersedes the `/app/companies/*` routes and `platformAdminMayOpen` from [cr-arkilaunch-platform-console.md](cr-arkilaunch-platform-console.md).

---

## 1. Why

The web app was one Almara-branded app. `/` was Almara's storefront, the API picked the storefront tenant from the `ANCHOR_TENANT_SLUG` env, and the platform admin's console was wedged into the tenant `/app` shell. ArkiLaunch itself, the product, had no landing page and no brand, and a second tenant could not have a storefront at all.

## 2. What changed

| Area | Change |
|---|---|
| Hosts | `apps/web/src/lib/host.ts`: the bare host (`localhost`, `VITE_PLATFORM_DOMAIN`, default `arkilaunch.tech`) is the platform; one label in front of it (`almara.localhost:5173`, `almara.arkilaunch.tech`) is a tenant. Reserved labels (`www`, `admin`, `api`, `app`, `arkilaunch`, `arkilaunch-platform`; `RESERVED_TENANT_SLUGS` in `@arkilaunch/shared`) never resolve to a tenant and are never minted at registration. Vite allows `.localhost` hosts. |
| Tenant selection | Every API call carries `X-Tenant-Slug` from the host. The API's `@StorefrontSlug()` / `@LoginTenantSlug()` decorators read it for public catalog reads, customer signup, login and forgot-password only. **It never reaches `req.ctx`:** authenticated data stays scoped by the JWT (RFC-1). `ANCHOR_TENANT_SLUG` is deleted from code, `.env.example`, CI and Terraform. |
| Login | Scoped to the host's tenant (`auth_find_user_by_email_in_tenant`, migration 0047). The platform host only admits the `arkilaunch-platform` tenant. The wrong host gets the same `invalid_credentials` as a wrong password. This also removes the "first matching row wins" ambiguity of the email-only lookup. |
| Migration 0047 | Functions only: `catalog_get_tenant(slug)` (active-tenant name), `auth_find_user_by_email_in_tenant`, `customer_register` now refuses a tenant that is not `active`, and `tenants_decide_application` also returns the tenant slug (drop and recreate, body otherwise unchanged). |
| Routes | One route tree. `onlyOn('platform' \| 'tenant', next)` guards each layout. Platform: `/` (landing), `/register*`, `/login`, `/admin/*`. Tenant: `/` (storefront home), `/equipment*`, `/contact`, `/help`, `/terms`, `/privacy`, `/login`, `/signup`, `/activate`, `/account/*`, `/app/*`, `/field/*`. The wrong host lands on that host's `/`. |
| Console | `/app/companies/{pending,approved,$id}` moved to `/admin/{applications,approved,applications/$id}` under `routes/_admin.tsx`, plus `/admin/{notifications,profile,users,security-logs}`. `_app.tsx` is admin/owner only. `homeRouteForRole('platform_admin')` is `/admin/applications`. The approval's activation link points at `{slug}.<platform host>/activate`. |
| Tenant brand | The hardcoded "Almara" in the nav, footer, auth panel, help page and EDTR sheet now comes from `GET /catalog/tenant`. A subdomain with no active tenant renders "Rental company not found". `document.title` follows the host. |
| Platform brand | New Platform tier (DSD §0) after `discord.design.md`: `[data-tier="platform"]` tokens, self-hosted Inter variable (OFL), `font-platform-display`, CSS starfield. `routes/platform.index.tsx` is the landing page; the `/admin` console only takes the Blurple accent. New `--color-on-primary` token so text on the accent stays legible (white on Blurple, steel on amber). |
| Companies | `/admin/approved` (applications-based, could not list a seeded tenant like Almara) is replaced by `/admin/companies`: every rental company past review with People, Customers, Equipment, Rentals and paid revenue, platform-wide totals, a search box, an **Open site** link built from the current host (`{slug}.localhost:5173` in dev, `{slug}.arkilaunch.tech` in prod), and **Activate / Deactivate** behind a confirm. Migration 0048: `tenants_list_companies()` (aggregate counts only) and `tenants_set_status()` (active <-> suspended, audited on the target tenant, never the platform tenant). A deactivated company cannot sign in or refresh a session (`auth_find_user_by_email_in_tenant` and `auth_find_refresh_token` skip suspended tenants); its storefront was already active-only. `GET /tenants/applications/approved` is removed; `GET /tenants/companies` and `PATCH /tenants/:id/status` (`tenant:approve`) replace it. |
| CORS | `PLATFORM_DOMAIN` set: the API also allows `https://{slug}.<domain>`. Dev is same-origin through the Vite proxy. |
| Tests | Vitest's jsdom URL is `almara.localhost`; Playwright's default base URL is `https://almara.localhost:5173`, with the platform admin signing in via `platformUrl()`. New: `host.test.ts`, `host-tenant.spec.ts`, a host-scoped login case in `auth-lockout.spec.ts`, `e2e/platform-landing.spec.ts`. |

**DSD amendment:** "Default SaaS purple" stays an absolute anti-reference for the Console and Marketing tiers. The Platform tier's Blurple `#5865f2` is the user's explicit brand choice (discord.design.md), confined to CTAs and the console accent.

## 3. Known gaps

- **Prod hosting** is not deployed yet and moves to Cloudflare later. That migration owns wildcard DNS `*.arkilaunch.tech`, `PLATFORM_DOMAIN` and `WEB_ORIGIN`.
- Contact details (`routes/contact.tsx`) are still Almara's, marked `ponytail:`. They move to tenant settings with per-tenant branding (logo, colours, address).
- Sessions are per-origin (sessionStorage), so a person signs in separately on each host. This is intended.
- Deactivation takes effect on the next sign-in or token refresh; an access token already issued stays valid for its remaining TTL (at most 10 minutes).
- A platform admin can no longer open a tenant's `/app` pages. Support access to a tenant would need its own audited design.

## 4. Verification

- `migration-rls-guardian`: PASS on 0047 and 0048.
- `platform-companies.spec.ts`: list with counts excludes the platform tenant; deactivating blocks login, refresh and the storefront, and reactivating restores them; the platform tenant and unknown ids are refused.
- Browser: `/admin/companies` lists Almara with its stats and an `almara.localhost` link; deactivating Test Tenant B shows Inactive and takes its storefront offline, activating brings it back. `tenant-isolation-checker`: PASS on the API diff.
- API: `auth-lockout`, `customer-onboarding`, `forgot-password`, `two-fa`, `users-admin`, `host-tenant` specs green against the dev database (55 tests).
- Web: typecheck and lint clean; 236/237 vitest. The one failure, `login.test.tsx` redirect preservation, times out only under full-suite load and passes alone and on the base commit.
- Manual, against the running app: `localhost` shows the ArkiLaunch landing (no horizontal scroll at 390px); `almara.localhost` shows the Almara storefront titled "Almara Construction"; `nope.localhost` shows the not-found page; the `test-tenant-a` admin signs in on `test-tenant-a.localhost` and is refused on `almara.localhost` and on the platform host.
