# Change Record

**Title:** Company Applications: the Figma company list at `/account/applications`, and the registration number behind it
**Project:** ArkiLaunch
**Date:** 2026-09-23
**Version:** 0.1
**Status:** `Applied`
**Trigger doc:** user request; Figma `ENpes2ZBsS3baRPKLyx0d3` "Manage Applications" (`251:1945`), mobile twin `826:2218`
**Docs touched by this record:** [index.md](index.md) §2, [report-figma-route-alignment.md](report-figma-route-alignment.md) §2 and §5

---

## 1. Why

`/account/applications` rendered one `Surface` from `GET /tenants/me/application`.
Figma `251:1945` draws a list: Total / Approved / Pending counter tiles, a search
field, three status tabs, and a card per company carrying a registration-document
thumbnail, a status pill, a registration number and a **Manage** action, plus an
**Add New Company** button.

The screen was widely recorded as blocked on a missing list endpoint. It was not.
It was reading the wrong entity.

- `GET /tenants/me/application` is the **tenant onboarding** application: a
  business becoming an ArkiLaunch tenant. It is correctly singular — `users.tenantId`
  is a single FK and RLS keys off one tenant per JWT, so a login can never hold two.
- What the frame draws is the **companies a customer registers to rent under**:
  `customers` rows, plural since the customer-prerequisites CR, already served by
  `GET /me/companies`. The `customers` schema comment cites this Figma work by name
  (`packages/db/src/schema/customers.ts`: *"Figma 582:3946 'Add New Company'. One
  login may own several companies"*).

So `POST /me/companies` and `/account/companies/new` already were Add New Company,
and `/account/companies/$companyId/documents` already was a Manage target. Two
things were genuinely absent: a column for the registration number, and any way for
a customer to read their own uploaded document.

## 2. Decisions (confirmed with the user 2026-09-23)

- **The list reads `GET /me/companies`.** No second list endpoint, no
  `GET /tenants/me/applications`. The tenant onboarding application stays what it is.
- **`/account/companies` is absorbed.** It was a second, differently-styled list of
  the same rows. It now redirects to `/account/applications` and loses its sidebar
  entry; its card moves to `components/company-card.tsx` and becomes
  `/account/companies/$companyId`, which is what Manage opens — so the documents and
  project-sites detail it carried is not lost.
- **Counters and filtering are client-side.** One login holds a handful of companies
  and `/me/companies` is unpaginated. Marked in place with a `ponytail:` comment
  naming the ceiling.
- **Design-system tokens, Figma layout.** `Surface`, `StatusPill`, `PageHeader`,
  `EmptyState`; not the prototype's raw hexes.
- **Admin side untouched.** `/app/companies/approved` still renders empty and the
  admin detail page still re-reads page 0 of the pending list. Both remain open (§5).

## 3. What changed

- Migration `0025`: `customers.sec_number`, nullable. `customers` takes its grants at
  table level (`0002_force_rls_and_grants.sql`), so the column inherits
  `app_authenticated`'s verbs; `tenantIsolationPolicy()` on the table is untouched.
- `CompanyCreateSchema.secNumber` (optional, `SEC_REGEX`) and
  `CompanyResponseSchema.secNumber` (nullable). `createCompany` persists it.
- `GET /me/companies/:id/documents/:documentId/url` — the customer's own 300s signed
  URL for a KYC document, under `booking:read`. See §4.
- Web: `/account/applications` rebuilt as the Figma list; `/account/companies`
  redirects; `/account/companies/$companyId` added; `components/company-card.tsx`
  extracted; the add-company form gains the registration-number field, prefilled from
  the scan it already runs (`POST /me/kyc/scan` has always returned a `secNumber`
  suggestion that had nowhere to go).

## 4. The one security decision

`GET customers/:id/documents/:documentId/url` already existed, under `quote:approve` —
staff only. Rather than widen it, this adds a `/me` sibling.

`customer` is an **intra-tenant** role. `withTenantTx` bounds the tenant and no
further, so every customer of a tenant shares that RLS scope. RLS is therefore *not*
the gate here: `ownsCustomer()` layered on top is what stops one customer pulling
another's registration certificate or National ID by guessing a customer id
(`audit-api-surface.md` #1). It refuses as `not_found` rather than `forbidden`, so the
check confirms no ids. A staff role never reaches the ownership test — `assertCustomer`
refuses it first; staff read the same document through the audited `quote:approve`
route.

Covered by `apps/api/test/customer-onboarding.spec.ts`: the owner resolves the key,
a second customer of the same tenant gets `NotFoundException`, and both an admin of
this tenant and a staff login of another tenant get `ForbiddenException`.

## 5. Verification gates

| Gate | Result |
|---|---|
| `pnpm lint` | Pass. One pre-existing warning (`ExtractionUnavailableError` unused in `customer-onboarding.spec.ts`), present on `dev`. |
| `pnpm typecheck`, `pnpm build` | Pass, all packages. |
| Web unit suite | Pass — 174 tests, including 4 new ones covering the counters, the status tabs, search over name and registration number, and "no companies match" vs "none registered". |
| `apps/api/test/customer-onboarding.spec.ts` | Pass — 14 tests, including the ownership assertions in §4. |
| `migration-rls-guardian` | **PASS.** Expand-only single column; table-level grants cover it; snapshot diff touches no policy. |
| `tenant-isolation-checker` | **PASS.** Confirms the layering under test: RLS bounds the tenant, `ownsCustomer()` bounds the customer within it, `assertCustomer` refuses staff first. No `service_role` on the request path, no raw SQL. |
| `restraint-guardian` | **PASS**, no blocking findings. Noted `ownDocumentKey`/`documentKey` differ only by the ownership guard and could share a parameterised helper; left duplicated on purpose, as a predicate-callback abstraction for two call sites reads worse than ten repeated lines. |
| Playwright `company-applications.spec.ts` | **Written, not run.** See §6. |

## 6. Honest gaps

- **The e2e spec has not been executed.** `seed/anchor.ts` refuses to write
  development credentials into a non-local database, and `DATABASE_URL_DIRECT` in this
  environment is the live Supabase project, so there is no seeded anchor tenant to
  sign in against. `dev` also carries no Playwright CI job — the `console-e2e` job in
  PR #66 is what will run this. Deliberately not duplicated here.
- **7 pre-existing failures in `payments-engine.spec.ts`** reproduce on clean `dev`
  with none of this branch's changes: leftover `customers` rows on the shared Supabase
  database leave the seeded customer owning more than one company, so
  `POST /bookings` answers `company_required`. `seed:test-two-tenant` does not clear
  them. Not introduced here, not fixed here.
- **Migration numbering.** Numbered `0025` as drizzle generated it against `dev`.
  PR #66 also lands a `0025`; whichever merges second renumbers.
- **Admin-side gaps stay open**: `/app/companies/approved` renders empty
  (`tenants_list_pending_applications` returns pending rows only) and the admin
  application detail page re-reads page 0 of the pending list and `.find()`s the id,
  so deep-linking past page 1 answers "Application not found".
