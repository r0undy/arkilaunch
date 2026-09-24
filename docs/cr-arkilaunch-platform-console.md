# Change Record

**Title:** Platform console: the platform admin gets its own short sidebar, one applications queue, and a real approved-companies list
**Project:** ArkiLaunch
**Date:** 2026-09-24
**Version:** 0.1
**Status:** `Applied`
**Trigger doc:** user request 2026-09-24 ("too many sidebars" on `platform@admin.com`)
**Docs touched by this record:** [prd-arkilaunch.md](prd-arkilaunch.md) §5.2 (platform route), [dsd-arkilaunch.md](dsd-arkilaunch.md) Nav shell pattern (materialized to `DESIGN.md`), [index.md](index.md) §2

---

## 1. Why

`platform@admin.com` is the seeded `platform_admin`: the ArkiLaunch team account that onboards rental companies (PRD §3). PRD §5.2 says it "uses a separate console". In practice it got the tenant admin's whole sidebar (Dispatch, Fleet, Billing, Administration: 20 links) with a Platform group of three added at the bottom. Two of those three showed the same pending list (`/app/platform-applications` and `/app/companies/pending`), and the third ("Approved companies") was an empty state because no endpoint read approved rows. It landed on the Almara dispatch dashboard, the app bar showed Almara's EDTR review count, and the same account could open the timekeeper `/field` shell and the customer `/account` shell, each with different navigation.

## 2. What changed

| Area | Change |
|---|---|
| Sidebar | `PLATFORM_ADMIN_NAV` is now the role's whole sidebar, not an add-on to `APP_NAV`. It has two groups: **Companies** (Applications, Approved companies) and **Account** (Notifications, My profile, People, Security logs). |
| Tenant pages | The `_app` layout sends platform_admin home from any `/app` page its sidebar does not list (`platformAdminMayOpen`). This is UX only; API permissions stay the boundary (RFC-1). |
| Home | `homeRouteForRole('platform_admin')` is now `/app/companies/pending`. |
| Duplicate page | `/app/platform-applications` was deleted. `/app/companies/pending` is now titled "Applications". |
| Other shells | `/field` is timekeeper-only. `/account/*` is customer-only; staff are redirected to their own home. |
| App bar | platform_admin no longer fetches `GET /edtr`. Its pill counts pending applications instead. |
| Approved companies | Migration `0033` adds `tenants_list_approved_applications()` (SECURITY DEFINER, same shape as 0011 plus `reviewed_at`), exposed as `GET /tenants/applications/approved` (`tenant:approve`). The page is now a paged table. |

**Not moved:** Onboarding and Registration pending/verified stay in the tenant admin's Administration group. Those queues are a rental company verifying its own customers' companies (`quote:approve`, tenant-scoped), not platform KYC, so they would always be empty for the platform admin.

**My profile, not Rate cards:** `/app/settings` is the tenant's rate-card screen, so the platform sidebar links to My profile (`/app/profile`) instead.

## 3. Known gaps

- Security logs is still the placeholder from `unbacked-screens.tsx`; the link is kept because it was requested.
- The application detail page still reads from the pending list, so an approved company has no detail view.
- Subscription management (PRD §3) has no screen yet.

## 4. Verification

- `apps/web/src/router.test.ts` checks that the platform nav lists no Dispatch/Fleet/Billing page and that `platformAdminMayOpen` allows its own pages and rejects tenant ones.
- `apps/web/e2e/platform-console.spec.ts` covers the landing page, the sidebar contents, the approved list, and the redirects from `/app`, `/app/inventory`, `/field` and `/account`.
- `migration-rls-guardian`: PASS on 0033.
