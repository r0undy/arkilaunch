# Change Record

**Title:** Customer prerequisites: self-signup, companies with verification documents, customer project sites, payment gated on verification
**Project:** ArkiLaunch
**Date:** 2026-09-21
**Version:** 0.1
**Status:** `Applied`
**Trigger doc:** user request following [cr-arkilaunch-customer-journey.md](cr-arkilaunch-customer-journey.md); Figma `ENpes2ZBsS3baRPKLyx0d3` "Add New Company" (582:3946, 168:2442)
**Docs touched by this record:** [index.md](index.md) §2

---

## 1. Why

The customer journey (cart → quote → pay) had no way in for a real customer:
- The storefront's "Create account" registers a new *rental business* (a tenant).
- A customer login existed only if staff invited one, and nothing then created its `customers` row. `POST /bookings` therefore answered 403 `customer_profile_not_found` for everyone except seeded users.
- `/reference/project-sites` is staff-only, so the cart's site picker was empty.
- The Figma "Add New Company" form had no backend.

## 2. Decisions (confirmed with the user 2026-09-21)

- **Customers sign up themselves**, in the storefront tenant (`ANCHOR_TENANT_SLUG`). Rental-business registration stays at `/register`.
- **One login may own several companies**: several `customers` rows share `user_id`, and the customer names which company a booking is for.
- **Booking before verification is allowed; payment is not.** Checkout returns 409 `company_not_verified` until staff approve the company.
- **Sites are pinned on a map**, using Leaflet with OpenStreetMap tiles.

## 3. What changed

- Migration `0023`:
  - `customers.tin` and `customers.billing_address`.
  - `project_sites.customer_id` (nullable; the yard's own sites stay null), indexed.
  - A SECURITY DEFINER `customer_register(slug, email, hash)`, the same shape as `tenants_register` in `0009`. It refuses an email present in any tenant, because login resolves users by email alone.
- `POST /auth/register-customer`: public, throttled 5/min, signs the new login straight in.
- `/me/companies` (list, create, upload documents), `/me/sites` (list, create). Uploads go through the existing `validateUpload` into the KYC bucket as `kyc_documents` rows marked `pending`.
- `/customers/review`, `/customers/:id/documents/:documentId/url` (a 300-second signed URL) and `PATCH /customers/:id/kyc` for staff, under `quote:approve`. Tenant admins do not hold `kyc:verify`, which is platform-only. A decision notifies the customer.
- Customer scope becomes "any company this login owns" (`ownCustomers` / `ownsCustomer`) across bookings, quotes and payments. A customer-added site can carry only its own company's bookings.
- Web:
  - `/signup`.
  - `/account/companies` with the "Add New Company" form and a document upload screen.
  - A map site dialog.
  - Company and site selection at the cart.
  - A "waiting for verification" state at checkout.
  - A setup checklist on the account home.
  - Real staff queues at `/app/registration/pending|verified`.
- The test seed's fixture customer is now `approved`, so checkout specs still run.

## 4. Deliberately not claimed

- The signup email is not verified. Any address that isn't already registered can sign up.
- `email_taken` reveals that an address has an account, as any signup form does. Login keeps its no-enumeration posture.
- Uploaded documents are not OCR'd. Staff read them; the staff-side KYC OCR path is unchanged.
- Companies and sites cannot be edited or deleted.
- Typed addresses are not geocoded. The pin is the location of record.
- OSM public tiles are fine at pilot volume under OSM's usage policy (marked `ponytail:`); a paid tile source is needed if traffic grows.
- The web bundle's size warning was not addressed.
