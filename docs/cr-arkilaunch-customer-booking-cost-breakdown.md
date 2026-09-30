# Change Record

**Title:** Customer booking equipment costs and rental days
**Date:** 2026-09-30
**Status:** Applied on feature branch
**Traceability:** PRD-F8 / US-09; DSD section 4.1 booking flow; RFC-3 saved pricing snapshots

## Problem and decision

Customer My Bookings showed equipment dates and a quotation total without itemized costs. Make an Equipment cost breakdown card prominent in booking details. Reuse the existing customer-authorized quotation-detail endpoint and QuoteLines component: quoted quantities, rates, billable hours per unit, line totals, transport fees, subtotal, discounts and final quote total. Grouped quantities display an average per-unit line cost before booking-level adjustments. No live rate recalculation or fabricated daily prices.

Machine cards and the booking list show rental days using the same rounded-up elapsed-day calculation as booking pricing. Open or invalid periods do not display a fabricated count. Quotation hours remain separate from rental duration, actual usage invoices and the deposit. Historical quotations retain their original pricing units and category labels; no arbitrary matching of category costs to equipment serial numbers.

No API/schema, pricing, payment, auth or RLS change. Missing quotations show a preparing message; loading, empty and retryable error states reuse DataPanel. Existing ledger and payment controls remain available.

## Documentation and verification

DSD section 4.1 updated and its Booking flow row materialized to DESIGN.md; index records the change. Query handling checked against [official TanStack Query v5 documentation](https://tanstack.com/query/v5/docs/framework/react/guides/queries).

Regression tests cover rounded-up and partial days, unknown periods, saved item costs, multiple units, fees, discount and missing or unpriced quotes. Verification: 19 booking Vitest tests passed; two Playwright checks passed at 1440px and 360px with mocked APIs; frontend TypeScript, changed-file ESLint and production build passed. The initial test-script invocation launched the full frontend suite and exhausted memory; the targeted run used two workers. Browser checks used HTTP because this checkout has no dev HTTPS certificate. SAD-A5 review found grouped-price and negotiated-price clarity gaps; the customer copy now explains both and labels saved line totals and average unit costs. No required control was removed.
