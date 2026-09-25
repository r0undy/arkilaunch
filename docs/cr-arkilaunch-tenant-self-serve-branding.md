# Change Record

**Title:** Self-serve rental companies: auto-approved registration with email activation, editable tenant branding, and a platform directory
**Project:** ArkiLaunch
**Date:** 2026-09-25
**Version:** 0.1
**Status:** `Applied`
**Trigger doc:** user request 2026-09-25 ("a lot of tenants of construction rental companies ... KYC in the platform is not needed ... branding editable, but the name is not editable ... this new company must be visitable")
**Docs touched by this record:** [dsd-arkilaunch.md](dsd-arkilaunch.md) §2.1 (tenant primary override), [index.md](index.md) §2. Supersedes the platform-admin approval step of [cr-arkilaunch-tenant-registration-catalog.md](cr-arkilaunch-tenant-registration-catalog.md).

---

## 1. Why

ArkiLaunch hosts many rental companies. Registration sat in a platform-admin approval queue, a tenant could not brand its storefront (the `tenants` row held only the name), and a visitor on the platform host had no way to find a company. Tenant-level KYC is not needed: the customers who rent are KYC'd per tenant (customer KYC is unchanged).

## 2. What changed

| Area | Change |
|---|---|
| Registration | `POST /tenants/register` auto-approves: `tenants_register()` writes the application as `approved`, and the API emails the owner an activation link at once (Resend, HTTP API via `fetch`; `RESEND_API_KEY`, `EMAIL_FROM`). The tenant stays `onboarding` until the owner sets a password; `POST /auth/activate` then flips it to `active` (`tenants_activate_onboarding`, migration 0051). Email ownership is the only gate. The link points at the platform host's `/activate?token=&slug=` because an onboarding subdomain is not served yet; on success the owner is sent to `{slug}.<host>/login`. |
| Abuse | The existing `/admin/companies` Deactivate toggle (0049). A suspended company disappears from the directory and its subdomain shows "Rental company not found". |
| Branding | New nullable `tenants` columns: `logo_key`, `hero_key`, `primary_color` (`#rrggbb`), `tagline`, `about`, `phone`, `contact_email`, `address`, `city`, `province`. `legal_name` and `slug` are not editable here. Writes go through `tenants_update_branding()` (SECURITY DEFINER, audited); `app_authenticated` keeps no UPDATE grant on these columns. Owner/admin edit at `/app/settings` (`tenant:manage`, tenant from the JWT); a platform admin edits any company from `/admin/companies` (`tenant:approve`). Logo and hero upload to the public equipment-photos bucket under the tenant's own prefix, magic-byte validated, same as equipment photos. |
| Storefront | `GET /catalog/tenant` returns the public branding. Logo in the nav and auth panel, tagline and optional hero on the home page, contact/about on `/contact`. `primary_color` overrides `--color-primary`; text on it is black or white, whichever has the higher WCAG contrast. |
| Directory | `GET /catalog/tenants?q=&category=&location=` (public, throttled, paged) over `catalog_list_tenants()`: active tenants only, never the platform tenant or the test fixtures. Rendered on the platform landing with a name search and equipment-category and location (city or province) filters kept in the URL. Each card links to the company's subdomain. |

## 3. Known gaps

- `tenants.kyc_state` is unused now but not dropped (a destructive migration for no gain).
- Without `RESEND_API_KEY` (local dev, CI) the activation link is logged by the API instead of emailed.
- The `/approve` and `/reject` endpoints stay only to clear applications still `pending` from before this change.
- Custom domains and full-palette theming are out of scope.
- The EDTR sheet keeps the company name only, no logo: it is an OCR-read form on the money path (RFC-2), and a logo would shift the layout the extractor is aligned to. Revisit with the OCR evals (AI-01..AI-06).
- A lost activation email has no resend route yet: the owner is blocked by the one-pending-company-per-email guard until an admin clears the onboarding tenant.
