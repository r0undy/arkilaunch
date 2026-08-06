import { z } from 'zod';

// PRD-F8 (Client Booking Portal), SDD §4 `POST /api/v1/bookings` contract,
// built as an authenticated `customer`-role surface rather than the PRD's
// public/guest sketch (cr-arkilaunch-f2-f8-bookings-payments.md: RFC-1's
// "tenant_id only from a verified JWT" rules out an unauthenticated write).
// A booking is a `rentals` row plus one `equipment_assignments` row per
// item -- no new table (SDD §3's 35-table catalog already covers both).

export const BookingItemRequestSchema = z
  .object({
    equipmentId: z.string().uuid(),
    start: z.string().datetime({ offset: true }),
    end: z.string().datetime({ offset: true }),
  })
  .refine((item) => new Date(item.end).getTime() > new Date(item.start).getTime(), {
    message: 'end must be after start',
  });
export type BookingItemRequest = z.infer<typeof BookingItemRequestSchema>;

// customerId is accepted only from a staff caller (admin/platform_admin/
// owner booking on a customer's behalf); a `customer`-role caller's own
// customerId is derived server-side from customers.user_id and this field
// is ignored for them (bookings.service.ts), never trusted as given.
export const BookingCreateRequestSchema = z.object({
  customerId: z.string().uuid().optional(),
  projectSiteId: z.string().uuid(),
  items: z.array(BookingItemRequestSchema).min(1),
});
export type BookingCreateRequest = z.infer<typeof BookingCreateRequestSchema>;

// --- Response schemas (egress allowlists). ---

export const BookingCreateResponseSchema = z.object({
  id: z.string().uuid(),
  status: z.string(),
  trackerUrl: z.string(),
});
export type BookingCreateResponse = z.infer<typeof BookingCreateResponseSchema>;

export const BookingSummaryResponseSchema = z.object({
  id: z.string().uuid(),
  status: z.string(),
  projectSiteId: z.string().uuid(),
});
export type BookingSummaryResponse = z.infer<typeof BookingSummaryResponseSchema>;

export const BookingListResponseSchema = z.object({
  items: z.array(BookingSummaryResponseSchema),
  total: z.number().int(),
});
export type BookingListResponse = z.infer<typeof BookingListResponseSchema>;

export const BookingDetailResponseSchema = BookingSummaryResponseSchema.extend({
  trackerUrl: z.string(),
  items: z.array(
    z.object({
      equipmentId: z.string().uuid(),
      start: z.coerce.date(),
      end: z.coerce.date().nullable(),
      status: z.string(),
    }),
  ),
  quotation: z
    .object({
      id: z.string().uuid(),
      status: z.string(),
      totalPhp: z.number().nullable(),
    })
    .nullable(),
  invoices: z.array(
    z.object({
      id: z.string().uuid(),
      invoiceType: z.string(),
      amount: z.number(),
      status: z.string(),
    }),
  ),
  payments: z.array(
    z.object({
      id: z.string().uuid(),
      method: z.string(),
      amount: z.number(),
      status: z.string(),
      providerRef: z.string().nullable(),
    }),
  ),
});
export type BookingDetailResponse = z.infer<typeof BookingDetailResponseSchema>;
