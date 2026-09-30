import { z } from 'zod';
import { PaginationQuerySchema } from './pagination.js';
import { SelectedOptionsSchema } from './fleet.js';
import { PhMobileSchema } from './phone.js';

export const BookingItemRequestSchema = z
  .object({
    equipmentId: z.string().uuid(),
    start: z.string().datetime({ offset: true }),
    end: z.string().datetime({ offset: true }),
    hours: z.number().finite().positive().max(100_000).optional(),
    selectedOptions: SelectedOptionsSchema.optional(),
  })
  .refine((item) => new Date(item.end).getTime() > new Date(item.start).getTime(), {
    message: 'end must be after start',
  });

export function bookingDays(start: string | Date, end: string | Date): number {
  return Math.max(1, Math.ceil((new Date(end).getTime() - new Date(start).getTime()) / 86_400_000));
}

export function minRentalDays(dailyHours: number, minHours: number): number {
  return minHours > 0 ? Math.ceil(minHours / dailyHours) : 1;
}

export function minBookingHours(days: number, dailyHours: number): number {
  return days * dailyHours;
}

export function maxBookingHours(days: number): number {
  return days * 24;
}
export type BookingItemRequest = z.infer<typeof BookingItemRequestSchema>;

// For a customer caller this picks which of their own companies books; the server verifies it, never trusts it.
export const BookingCreateRequestSchema = z.object({
  customerId: z.string().uuid().optional(),
  projectSiteId: z.string().uuid(),
  siteContact: z.string().trim().max(200).optional(),
  siteContactMobile: PhMobileSchema.optional(),
  siteNotes: z.string().trim().max(1000).optional(),
  items: z.array(BookingItemRequestSchema).min(1),
});
export type BookingCreateRequest = z.infer<typeof BookingCreateRequestSchema>;

export const BookingCreateResponseSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  status: z.string(),
  trackerUrl: z.string(),
});
export type BookingCreateResponse = z.infer<typeof BookingCreateResponseSchema>;

export const BookingSummaryResponseSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  status: z.string(),
  projectSiteId: z.string().uuid(),
  siteCity: z.string().nullable(),
  siteProvince: z.string().nullable(),
  customerName: z.string().nullable().optional(),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().nullable().optional(),
  holdExpiresAt: z.coerce.date().nullable().optional(),
  items: z
    .array(z.object({ equipmentName: z.string(), start: z.coerce.date(), end: z.coerce.date().nullable() }))
    .optional(),
});
export type BookingSummaryResponse = z.infer<typeof BookingSummaryResponseSchema>;

// The tenant is the verified JWT's, never the caller's (RFC-1).
export interface EdtrSheetContext {
  rentalId: string;
  chargeTo: string;
  projectLocation: string;
  equipment: {
    id: string;
    type: string;
    model: string;
    serialNo: string;
    start?: string;
    end?: string | null;
    operatorName?: string | null;
    lastHourMeter?: number | null;
  }[];
  bookingCode?: string;
  customerName?: string;
  siteRep?: string | null;
  rentalStart?: string;
  rentalEnd?: string | null;
  tenant?: { name: string; address: string; contact: string; logoUrl: string | null };
}

export const EDTR_PAPER_SIZES = ['legal', 'letter'] as const;
export type EdtrPaperSize = (typeof EDTR_PAPER_SIZES)[number];
export const EdtrSettingsSchema = z.object({ paperSize: z.enum(EDTR_PAPER_SIZES) }).strict();
export type EdtrSettings = z.infer<typeof EdtrSettingsSchema>;

// A timekeeper may download a unit's sheet this many times per Manila day.
export const FIELD_SHEET_DAILY_LIMIT = 2;

export interface FieldSheetUnit {
  rentalId: string;
  equipmentId: string;
  bookingCode: string;
  unitName: string;
  serialNo: string;
  siteName: string;
  downloadsToday: number;
  remainingToday: number;
}
export interface FieldSheetListResponse {
  weekStart: string;
  items: FieldSheetUnit[];
}
export const FieldSheetDownloadRequestSchema = z.object({ rentalId: z.string().uuid(), equipmentId: z.string().uuid() }).strict();
export type FieldSheetDownloadRequest = z.infer<typeof FieldSheetDownloadRequestSchema>;
export interface FieldSheetDownloadResponse {
  context: EdtrSheetContext;
  weekStart: string;
  page: EdtrPaperSize;
  remainingToday: number;
}

export const BOOKING_STATUSES = ['pending', 'confirmed', 'active', 'completed', 'cancelled'] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];
const IsoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const BookingListQuerySchema = PaginationQuerySchema.extend({
  q: z.string().trim().max(80).optional(),
  status: z
    .string()
    .transform((v) => v.split(',').filter(Boolean))
    .pipe(z.array(z.enum(BOOKING_STATUSES)).max(BOOKING_STATUSES.length))
    .optional(),
  from: IsoDay.optional(),
  to: IsoDay.optional(),
  sort: z.enum(['newest', 'start']).optional(),
});
export type BookingListQuery = z.infer<typeof BookingListQuerySchema>;

export const BookingListResponseSchema = z.object({
  items: z.array(BookingSummaryResponseSchema),
  total: z.number().int(),
  statusCounts: z.record(z.string(), z.number().int()).optional(),
});
export type BookingListResponse = z.infer<typeof BookingListResponseSchema>;

export const BookingDetailResponseSchema = BookingSummaryResponseSchema.extend({
  trackerUrl: z.string(),
  customerId: z.string().uuid(),
  customerName: z.string().nullable().optional(),
  items: z.array(
    z.object({
      id: z.string().uuid(),
      equipmentId: z.string().uuid(),
      equipmentName: z.string().optional(),
      start: z.coerce.date(),
      end: z.coerce.date().nullable(),
      status: z.string(),
      selectedOptions: SelectedOptionsSchema.optional(),
    }),
  ),
  siteContact: z.string().nullable(),
  siteContactMobile: z.string().nullable().optional(),
  siteNotes: z.string().nullable(),
  callRequestedAt: z.coerce.date().nullable(),
  callConfirmedAt: z.coerce.date().nullable(),
  createdAt: z.coerce.date(),
  quotation: z
    .object({
      id: z.string().uuid(),
      revision: z.number().int(),
      status: z.string(),
      totalPhp: z.number().nullable(),
      // Paid upfront with the consumable deposit.
      mobilizationPhp: z.number().optional(),
      demobilizationPhp: z.number().optional(),
      createdAt: z.coerce.date(),
      inNegotiation: z.boolean().optional(),
    })
    .nullable(),
  deposit: z.object({
    required: z.number().nullable(),
    totalDeducted: z.number(),
    deductions: z.array(z.object({ invoiceId: z.string().uuid(), amount: z.number(), createdAt: z.coerce.date() })),
  }),
  changeRequests: z.array(
    z.object({
      id: z.string().uuid(),
      kind: z.string(),
      assignmentId: z.string().uuid().nullable().optional(),
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
  // A customer never sees a pending day (their pending count is 0).
  fieldLogs: z
    .object({
      running: z.number(),
      billable: z.number(),
      idle: z.number(),
      breakdown: z.number(),
      weather: z.number(),
      otherDowntime: z.number(),
      daysApproved: z.number().int(),
      daysInSpan: z.number().int(),
      pending: z.number().int(),
      downtimeDays: z.number().int(),
      days: z.array(
        z.object({
          date: z.string(),
          equipmentName: z.string(),
          hours: z.object({
            running: z.number(),
            billable: z.number(),
            idle: z.number(),
            breakdown: z.number(),
            weather: z.number(),
            otherDowntime: z.number(),
          }),
        }),
      ),
    })
    .optional(),
});
export type BookingDetailResponse = z.infer<typeof BookingDetailResponseSchema>;

// An offer is never charged; the charged number is always the accepted quotation's engine-priced total.
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

export const ChangeRequestCreateSchema = z
  .object({
    kind: z.enum(['extend', 'cancel']),
    assignmentId: z.string().uuid().optional(),
    requestedEnd: z.string().datetime({ offset: true }).optional(),
    reason: z.string().trim().max(1000).optional(),
  })
  .refine((body) => body.kind !== 'extend' || body.requestedEnd, {
    message: 'requestedEnd is required to extend',
    path: ['requestedEnd'],
  })
  .refine((body) => body.kind !== 'extend' || body.assignmentId, {
    message: 'assignmentId is required to extend',
    path: ['assignmentId'],
  });
export type ChangeRequestCreate = z.infer<typeof ChangeRequestCreateSchema>;

export const ChangeRequestResolveSchema = z.object({
  decision: z.enum(['approved', 'rejected']),
});
export type ChangeRequestResolve = z.infer<typeof ChangeRequestResolveSchema>;

// Asia/Manila wall-clock HH:MM; openDays 0 = Sunday; blackouts are Manila dates.
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

export const AvailabilityQuerySchema = z
  .object({
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  })
  .refine((q) => q.to >= q.from, { message: 'to must not be before from' });
export type AvailabilityQuery = z.infer<typeof AvailabilityQuerySchema>;

export type AvailabilityBlocker = 'assignment' | 'hold' | 'maintenance' | 'closed' | 'holiday' | 'operator';

export interface AvailabilityResponse {
  hours: { openTime: string; closeTime: string; openDays: number[] } | null;
  dailyHours: number;
  minHours: number;
  days: { date: string; available: boolean; reason: AvailabilityBlocker | null; heldUntil?: string }[];
}

export interface RescheduleSuggestion {
  items: {
    equipmentId: string;
    sameUnit: { start: string; end: string } | null;
    alternatives: string[];
  }[];
}
