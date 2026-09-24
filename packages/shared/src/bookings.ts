import { z } from 'zod';
import { PaginationQuerySchema } from './pagination.js';

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

// customerId: for staff, the customer being booked for. For a `customer`
// caller it picks WHICH of their own companies books (one login may own
// several); the server checks it is theirs and never trusts it otherwise
// (bookings.service.ts). Omitted, a customer with one company uses it.
export const BookingCreateRequestSchema = z.object({
  customerId: z.string().uuid().optional(),
  projectSiteId: z.string().uuid(),
  siteContact: z.string().trim().max(200).optional(),
  siteNotes: z.string().trim().max(1000).optional(),
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
  siteCity: z.string().nullable(),
  siteProvince: z.string().nullable(),
});
export type BookingSummaryResponse = z.infer<typeof BookingSummaryResponseSchema>;

// Paging, same shape as the users/invoices/equipment lists. GET /bookings
// was the one list module with no query DTO at all, so the ?limit=&offset=
// the UI already sent was silently discarded and page 2 returned page 1
// (audit-api-surface.md #5).
export const BookingListQuerySchema = PaginationQuerySchema;
export type BookingListQuery = z.infer<typeof BookingListQuerySchema>;

export const BookingListResponseSchema = z.object({
  items: z.array(BookingSummaryResponseSchema),
  total: z.number().int(),
});
export type BookingListResponse = z.infer<typeof BookingListResponseSchema>;

export const BookingDetailResponseSchema = BookingSummaryResponseSchema.extend({
  trackerUrl: z.string(),
  customerId: z.string().uuid(),
  items: z.array(
    z.object({
      equipmentId: z.string().uuid(),
      start: z.coerce.date(),
      end: z.coerce.date().nullable(),
      status: z.string(),
    }),
  ),
  siteContact: z.string().nullable(),
  siteNotes: z.string().nullable(),
  // Callback before payment: checkout waits for callConfirmedAt.
  callRequestedAt: z.coerce.date().nullable(),
  callConfirmedAt: z.coerce.date().nullable(),
  createdAt: z.coerce.date(),
  quotation: z
    .object({
      id: z.string().uuid(),
      revision: z.number().int(),
      status: z.string(),
      totalPhp: z.number().nullable(),
      createdAt: z.coerce.date(),
    })
    .nullable(),
  // resolveDepositLedger's view: required is null when no contract exists.
  deposit: z.object({
    required: z.number().nullable(),
    totalDeducted: z.number(),
    deductions: z.array(z.object({ invoiceId: z.string().uuid(), amount: z.number(), createdAt: z.coerce.date() })),
  }),
  changeRequests: z.array(
    z.object({
      id: z.string().uuid(),
      kind: z.string(),
      requestedEnd: z.coerce.date().nullable(),
      reason: z.string().nullable(),
      status: z.string(),
      createdAt: z.coerce.date(),
    }),
  ),
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

// --- Negotiation thread (customer journey CR). An offer is a proposal in a
// conversation; it is never charged. The charged number is always the
// accepted quotation's engine-priced total.
export const NegotiationMessageCreateSchema = z.object({
  body: z.string().trim().min(1).max(2000),
  offerPhp: z.number().finite().positive().max(100_000_000).optional(),
});
export type NegotiationMessageCreate = z.infer<typeof NegotiationMessageCreateSchema>;

export const NegotiationMessageResponseSchema = z.object({
  id: z.string().uuid(),
  authorRole: z.enum(['customer', 'staff']),
  mine: z.boolean(),
  body: z.string(),
  offerPhp: z.number().nullable(),
  createdAt: z.coerce.date(),
});
export type NegotiationMessageResponse = z.infer<typeof NegotiationMessageResponseSchema>;

// --- Change requests (Figma 231:5204 Extend Rental, and cancel after pay).
export const ChangeRequestCreateSchema = z
  .object({
    kind: z.enum(['extend', 'cancel']),
    requestedEnd: z.string().datetime({ offset: true }).optional(),
    reason: z.string().trim().max(1000).optional(),
  })
  .refine((body) => body.kind !== 'extend' || body.requestedEnd, {
    message: 'requestedEnd is required to extend',
    path: ['requestedEnd'],
  });
export type ChangeRequestCreate = z.infer<typeof ChangeRequestCreateSchema>;

export const ChangeRequestResolveSchema = z.object({
  decision: z.enum(['approved', 'rejected']),
});
export type ChangeRequestResolve = z.infer<typeof ChangeRequestResolveSchema>;

// --- Booking availability (feedback phase 3). ---

// Business hours are Asia/Manila wall-clock "HH:MM"; openDays are
// 0 = Sunday .. 6 = Saturday; blackouts are Manila calendar dates.
const HhMm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const TenantCalendarSchema = z
  .object({
    openTime: HhMm,
    closeTime: HhMm,
    openDays: z.array(z.number().int().min(0).max(6)).max(7),
    blackouts: z
      .array(
        z.object({
          date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          label: z.string().trim().max(100).optional(),
        }),
      )
      .max(366),
  })
  .refine((c) => c.closeTime > c.openTime, { message: 'closeTime must be after openTime' });
export type TenantCalendar = z.infer<typeof TenantCalendarSchema>;

// GET /equipment/:id/availability?from&to (dates, YYYY-MM-DD, Manila).
export const AvailabilityQuerySchema = z
  .object({
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  })
  .refine((q) => q.to >= q.from, { message: 'to must not be before from' });
export type AvailabilityQuery = z.infer<typeof AvailabilityQuerySchema>;

export type AvailabilityBlocker = 'assignment' | 'maintenance' | 'closed' | 'holiday' | 'operator';

export interface AvailabilityResponse {
  // null = the tenant set no calendar: any time of any day.
  hours: { openTime: string; closeTime: string; openDays: number[] } | null;
  days: { date: string; available: boolean; reason: AvailabilityBlocker | null }[];
}

// GET /bookings/:id/reschedule-suggestion (staff).
export interface RescheduleSuggestion {
  items: {
    equipmentId: string;
    // Nearest free window of the same length on the same unit, or null.
    sameUnit: { start: string; end: string } | null;
    // Other units of the same type free for the original window.
    alternatives: string[];
  }[];
}
