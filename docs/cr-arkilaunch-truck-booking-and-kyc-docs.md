# Change Record

**Title:** BIR/SEC primary company documents; self-loading truck as a negotiable, payable booking; cash payment
**Project:** ArkiLaunch
**Date:** 2026-09-24
**Version:** 0.1
**Status:** `Draft`
**Trigger doc:** user request 2026-09-24 (customer side items 1–2), answers to 10 clarifying questions
**Docs touched by this record:** [index.md](index.md) §2; extends [cr-arkilaunch-company-applications.md](cr-arkilaunch-company-applications.md) and [cr-arkilaunch-customer-journey.md](cr-arkilaunch-customer-journey.md)

---

## 1. Why

- Company applications accept one generic "company registration" upload. In the Philippines, a corporation proves registration with an SEC certificate and every business with a BIR Certificate of Registration (Form 2303). DTI business-name registration applies only to sole proprietors, so it is a supporting document and not proof of the company.
- The self-loading truck service has free-text addresses and sits outside bookings. It cannot be negotiated, invoiced or paid, and it doesn't appear in My Bookings.
- Some customers pay in cash and need an invoice to pay against. Only PayMongo exists today.

## 2. Decisions (confirmed with the user 2026-09-24)

- **Primary registration = BIR COR (Form 2303) or SEC certificate**, picked from a dropdown. **DTI is optional and secondary.** The government ID of the applicant stays required.
- The staff "Read document" on a primary document suggests **registration number (TIN or SEC no.), registered name, address, registration date**. These stay suggestions: staff edit and approve (RFC-2 human gate unchanged).
- **Truck locations** come from chained region → province → city/municipality dropdowns (bundled PSGC list with centroids), plus an optional street/landmark note. The estimate routes between city centroids, and staff still confirm the real km.
- **Truck requests use the same negotiation thread** as rentals (unlimited counter-offers; an offer is never charged). Staff accept a price, and that price is what gets invoiced.
- **My Bookings has two tabs:** Equipment rental and Self-loading truck.
- **Payment: PayMongo or cash, for both services.** Cash issues an invoice the customer pays at the office. **Staff record the cash receipt by hand**, and it is never auto-accepted.

## 3. What changes

- `COMPANY_DOCUMENT_TYPES` gains `bir_cor`, `sec_certificate`, `dti_certificate`. The legacy `company_registration` stays readable. Submit requires `government_id` + (`bir_cor` or `sec_certificate`).
- Migration: `negotiation_messages.rental_id` and `invoices.rental_id` become nullable. Each table gets `truck_request_id` with an exactly-one-parent CHECK. `truck_requests` gains `agreed_price_php`, and its statuses gain `negotiating` and `agreed`. `payments.method` accepts `cash` with `recorded_by_user_id`. Tenant RLS on each table is unchanged.

## 4. Guardrails

- `tenant_id` always comes from the verified JWT (RFC-1).
- A cash receipt and a negotiated offer are human-entered. Neither triggers a deposit deduction (RFC-2).
