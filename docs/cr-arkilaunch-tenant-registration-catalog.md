# Change Record

**Title:** Tenant self-registration + approval workflow, admin-initiated password reset, and an anchor-tenant public equipment catalog
**Project:** ArkiLaunch
**Date:** 2026-08-06
**Version:** 0.1
**Status:** `Applied`
**Trigger doc:** [build-arkilaunch.md](build-arkilaunch.md) §5.1 Brownfield Change Workflow
**Docs touched by this record:** [sdd-arkilaunch.md](sdd-arkilaunch.md) §3/§4 (new table, new endpoints), [rfc-arkilaunch-tenancy-rls-auth.md](rfc-arkilaunch-tenancy-rls-auth.md) §3 (RBAC catalog drift, pre-existing wire-contract drift noted below), [index.md](index.md) §2 (Change Log)

---

## 1. Summary

Three backend gaps were forcing `apps/web` to run against fixtures or dead stubs: no `POST /tenants/register` (the two-step registration UI's `submitRegistration()` was a no-op), no public catalog endpoint (the storefront landing page rendered six hardcoded fixtures), and no password reset (the login page's "Forgot password?" was a disabled dead end). This pass closes all three. One new table (`tenant_applications`), two new SECURITY DEFINER functions, one new permission (`tenant:approve`), no changes to the identity model.

## 2. Tenant self-registration (`POST /tenants/register`)

**Design constraint:** registration is an unauthenticated write with no JWT and therefore no tenant context, so it cannot run through the normal `withTenantTx` RLS path. Migration `0007` already revoked INSERT on `tenants` for `app_authenticated` entirely, so a SECURITY DEFINER function is not a convenience here, it is the only path that can create a tenant row at all — the same category of exception as `auth_find_user_by_email` (a read), but for a write.

`packages/db/migrations/0008_tenant_applications_table.sql` adds `tenant_applications` (tenant-owned, `tenantIsolationPolicy()`). `packages/db/migrations/0009_tenant_registration.sql` adds `tenants_register()`: in one transaction, creates the tenant (`status='onboarding'`), the owner user (`status='invited'`, an unusable random password hash — never a caller-chosen password), and the application row (`status='pending'`), and rejects a second pending application for the same email. Slug is derived from company name with a numeric-suffix retry on collision.

**Approval** (`POST /tenants/:id/approve` / `/reject`, new `tenant:approve` permission, `platform_admin` only) is also a SECURITY DEFINER call (`tenants_decide_application()` in the same migration) for a different reason: it is a cross-tenant administrative action — a `platform_admin`'s own RLS GUC is set to *their* tenant, so a normal `withTenantTx` query could never see another tenant's pending application. Authorization is still enforced on the request path (`PermissionsGuard` + `@RequirePermission('tenant:approve')`); the function is the narrow write that check is allowed to make.

**No platform-console UI exists yet** (S3/S25, PRD-frozen but deferred per `cr-arkilaunch-f9-read-surface.md` §notes) — approval is an API/curl-level step today. This is logged honestly, not silently coded around.

**Owner login before approval:** the owner user is created `invited`, so `AuthService.login` already refuses it (no new logic needed). Approve mints an activation token via the existing `AuthService.signActivationToken` — the same invite/activate mechanism `POST /users/:id/invite` already uses — for the platform admin to relay out-of-band (no email provider in the pinned stack, `build-arkilaunch.md` §3). The owner sets their own password through the existing, proven `POST /auth/activate`.

**Frontend consequence:** the registration form's password field is removed (`apps/web/src/routes/register.tsx`) since the owner's password is now set post-approval, not at registration time. `apps/web/src/lib/registration-client.ts` now calls the real endpoint instead of returning a stub `{submitted:true}`.

## 3. Public equipment catalog (`GET /catalog/equipment`)

**Scope decision:** anchor-tenant only, resolved from a new `ANCHOR_TENANT_SLUG` env var — not a general multi-tenant `GET /catalog/:tenantSlug/equipment`. `cr-arkilaunch-f2-f8-bookings-payments.md:82` already flagged that a genuine public multi-tenant catalog needs slug resolution, a guest-identity model, and a CLR review; none of that exists yet, and the storefront (`/`, `/equipment`) is Almara's single-tenant catalog today (`cr-arkilaunch-frontend-storefront-shell.md`). Deferred, one future CR.

`packages/db/migrations/0010_public_catalog.sql` adds `catalog_list_equipment(p_slug)`, another narrow SECURITY DEFINER read for an unauthenticated caller (same category as `auth_find_user_by_email`). It returns only `id`, the equipment type name, `model`, and `availabilityStatus` — deliberately **not** `serialNo` or `runtimeHours`, which are operational data with no reason to be visible to an anonymous caller — and only for a tenant at `status='active'`.

`apps/web/src/lib/equipment-fixtures.ts` is deleted; `/`, `/equipment`, and `/equipment/$equipmentId` now query the real endpoint via a new `catalogQueries` factory. The real contract has no manufacturer field and no price/rating (the fixtures' `make` field doesn't exist on `equipment`); the storefront's sort control is left wired but inert with an honest code comment rather than fabricating price data.

## 4. Admin-initiated password reset (`POST /users/:id/reset-password`)

**Design constraint:** there is no email provider anywhere in the pinned stack (`build-arkilaunch.md` §3) — this is *why* `POST /users/:id/invite` already returns its activation token in the response for out-of-band relay rather than emailing it. A self-service reset that returns a token to an *anonymous* caller would be a direct account-takeover oracle, so self-service reset is out of scope for this pass.

The new endpoint (`user:manage`-gated, same as invite) reuses the invite/activate machinery exactly: rerolls the target's password hash to a fresh unusable value, flips `status` back to `invited`, mints an activation token via `AuthService.signActivationToken`, and additionally calls the existing `RefreshTokenService.revokeAllForUser` so a session hijacked before the reset does not survive it. The login page's disabled "Forgot password?" now says to contact an administrator instead of showing a dead tooltip.

**Follow-up, logged not built:** an email provider (e.g. Resend/SES) would unblock true self-service reset, and also unblocks invites and notifications generally. Needs its own `build-arkilaunch.md` §3 register row and Change Record.

## 5. RBAC catalog drift (RFC-1 §3)

One permission added to `packages/shared/src/permissions.ts`'s `PERMISSION_CODES`, additive only: `tenant:approve`, granted to `platform_admin` only (via the existing `PERMISSION_CODES` wildcard grant, no seed change needed).

## 6. Pre-existing drift noted, not fixed by this pass

Found while working in this area, unrelated to the changes above:

- RFC-1 §3 specifies the client holds the access token **in memory, not `localStorage`**; `apps/web/src/lib/auth-client.ts` uses `sessionStorage`.
- RFC-1's wire contract is snake_case (`access_token`, `expires_in`); `packages/shared/src/auth.ts` and the implementation are camelCase.
- `.env.example`'s `JWT_ACCESS_TOKEN_TTL` is unread; `apps/api/src/auth/auth.service.ts:20` hardcodes 600 seconds.
- `apps/api/src/auth/two-fa.controller.ts` is a complete, live backend, but `apps/web/src/routes/login.tsx` dead-ends the 2FA challenge with "not yet supported here."

None of these are touched here; listed so they aren't lost.

## 7. Verification

- `pnpm --filter @arkilaunch/shared typecheck`, `pnpm --filter @arkilaunch/db typecheck`, `pnpm --filter @arkilaunch/api typecheck`, `pnpm --filter @arkilaunch/web typecheck` — all clean.
- `pnpm --filter @arkilaunch/web test -- --run` — 41/41 passing (no regressions).
- `pnpm lint` — clean.
- Not run against a live database in this pass (no provisioned Supabase project in this environment) — `migration-rls-guardian` and `tenant-isolation-checker` should still be run pre-merge against `0008`/`0009`/`0010` and the whole diff before this ships, per `AGENTS.md` §2.
