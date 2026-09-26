import { z } from 'zod';
import { PaginationQuerySchema } from './pagination.js';

// PRD-F4 (Fleet Inventory, Maintenance & Reporting), SDD §4 endpoint
// contracts for /equipment, /equipment/:id/maintenance,
// /equipment/:id/maintenance-logs, /reports/utilization.

export const EquipmentStatusSchema = z.enum(['available', 'deployed', 'maintenance']);
export type EquipmentStatus = z.infer<typeof EquipmentStatusSchema>;

// GET /equipment?status=... query is validated the same as any other
// external input (AGENTS.md "Always: validate external input at the
// boundary with Zod"), not passed through as a raw string.
export const EquipmentListQuerySchema = PaginationQuerySchema.extend({
  status: EquipmentStatusSchema.optional(),
});
export type EquipmentListQuery = z.infer<typeof EquipmentListQuerySchema>;

// POST /equipment (addition beyond the SDD §4 endpoint list; see
// AGENTS.md §5.1 Change Record). fleet:manage-gated at the controller.
// The spec sheet from Figma 292:1344 (Add Equipment). Every one of these is
// optional: they arrived after the table had rows, and none of them is needed
// to rent a machine out. The frame's HOURLY RATE / DAILY RATE fields are
// deliberately absent -- rate_cards owns pricing and quotes are computed from
// it, so a second price on the equipment row would be a competing source of
// truth on the money path.
const EquipmentSpecFieldsSchema = z.object({
  modelNumber: z.string().max(100).optional(),
  yearOfManufacture: z.number().int().min(1900).max(2100).optional(),
  weightCapacityTons: z.number().positive().max(100_000).optional(),
  engineType: z.string().max(100).optional(),
  fuelType: z.string().max(100).optional(),
  notes: z.string().max(2000).optional(),
  // Free-text category for a machine filed under "Others".
  categoryNote: z.string().max(200).optional(),
});

export const EquipmentCreateRequestSchema = EquipmentSpecFieldsSchema.extend({
  equipmentTypeId: z.string().uuid(),
  model: z.string().min(1).max(200),
  serialNo: z.string().min(1).max(200),
  availabilityStatus: EquipmentStatusSchema.default('available'),
});
export type EquipmentCreateRequest = z.infer<typeof EquipmentCreateRequestSchema>;

// PATCH /equipment/:id. At least one field required -- an empty patch is
// not a meaningful request. Checked generically rather than by naming the
// fields: the named form silently rejected a patch that changed only one of
// the spec fields above.
//
// serialNo is absent on purpose. Migration 0026 REVOKEs UPDATE on that column,
// so a machine's identity cannot be rewritten after a DTR has cited it -- the
// edit form renders it disabled for the same reason.
export const EquipmentUpdateRequestSchema = EquipmentSpecFieldsSchema.extend({
  model: z.string().min(1).max(200).optional(),
  availabilityStatus: EquipmentStatusSchema.optional(),
}).refine((data) => Object.values(data).some((value) => value !== undefined), {
  message: 'at least one field is required',
});
export type EquipmentUpdateRequest = z.infer<typeof EquipmentUpdateRequestSchema>;

// DELETE /equipment/:id is a retire, not a delete. See migration 0026.
export const EquipmentRetireResponseSchema = z.object({
  id: z.string().uuid(),
  retired: z.literal(true),
});
export type EquipmentRetireResponse = z.infer<typeof EquipmentRetireResponseSchema>;

// POST /equipment/:id/maintenance-logs (SDD §4). performedAt is a full
// timestamptz (not a bare date, unlike edtr.reportDate) since a
// maintenance action is logged at a point in time, not a calendar day.
// scheduleId names the task this service resets; omitted = the unit's
// latest schedule (the pre-0035 behavior).
export const MaintenanceLogCreateRequestSchema = z.object({
  performedAt: z.string().datetime({ offset: true }),
  notes: z.string().max(2000).optional(),
  scheduleId: z.string().uuid().optional(),
});
export type MaintenanceLogCreateRequest = z.infer<typeof MaintenanceLogCreateRequestSchema>;

// POST /equipment/:id/maintenance-schedules. One schedule per task.
export const MaintenanceScheduleCreateRequestSchema = z.object({
  task: z.string().min(1).max(100),
  hoursInterval: z.number().positive().max(100_000),
});
export type MaintenanceScheduleCreateRequest = z.infer<typeof MaintenanceScheduleCreateRequestSchema>;

// POST /equipment/:id/maintenance-windows. Dates the unit is out for
// maintenance; bookings cannot land on them.
export const MaintenanceWindowCreateRequestSchema = z
  .object({
    startsAt: z.string().datetime({ offset: true }),
    endsAt: z.string().datetime({ offset: true }),
    notes: z.string().trim().max(500).optional(),
  })
  .refine((w) => new Date(w.endsAt).getTime() > new Date(w.startsAt).getTime(), {
    message: 'endsAt must be after startsAt',
  });
export type MaintenanceWindowCreateRequest = z.infer<typeof MaintenanceWindowCreateRequestSchema>;

// Common service intervals, offered as presets in the maintenance UI.
export const MAINTENANCE_PRESETS: readonly { task: string; hoursInterval: number }[] = [
  { task: 'Engine oil', hoursInterval: 250 },
  { task: 'Hydraulic oil', hoursInterval: 1000 },
  { task: 'Air filter', hoursInterval: 500 },
  { task: 'Grease', hoursInterval: 10 },
  { task: 'Fuel filter', hoursInterval: 500 },
  { task: 'Undercarriage inspection', hoursInterval: 500 },
];

// PATCH /equipment/:id/runtime. A manual hour-meter correction; the reason
// is required and lands in audit_logs.reason.
export const RuntimeCorrectionRequestSchema = z.object({
  runtimeHours: z.number().min(0).max(1_000_000),
  reason: z.string().trim().min(3).max(500),
});
export type RuntimeCorrectionRequest = z.infer<typeof RuntimeCorrectionRequestSchema>;

// GET /reports/utilization?from=&to= (SDD §4). Both optional; the service
// defaults to a trailing 30-day window when omitted.
export const UtilizationQuerySchema = z.object({
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});
export type UtilizationQuery = z.infer<typeof UtilizationQuerySchema>;

// GET /catalog/equipment (@Public, anchor-tenant only -- backend-unblock
// plan workstream 2). Deliberately excludes serialNo/runtimeHours: those
// are operational data with no reason to be visible to an anonymous caller.
export const CatalogEquipmentSchema = z.object({
  id: z.string().uuid(),
  equipmentTypeName: z.string(),
  model: z.string(),
  availabilityStatus: EquipmentStatusSchema,
  // A pointer into the public-read equipment-photos bucket (migration 0028).
  // Null for a machine nobody has photographed yet. The safe-column allowlist
  // behind this endpoint is otherwise unchanged: no serial_no, no
  // runtime_hours -- screens that want a per-unit label use shortCode(id).
  photoUri: z.string().nullable(),
  // The public upfront price (same for every customer); null = on request.
  rateType: z.string().nullable().optional(),
  rateValue: z.number().nullable().optional(),
});
export type CatalogEquipment = z.infer<typeof CatalogEquipmentSchema>;

// Unauthenticated and previously unbounded: every storefront page load
// shipped the anchor tenant's whole equipment table, and the client had no
// way to ask for less (audit-api-surface.md #8).
export const CatalogEquipmentListQuerySchema = PaginationQuerySchema;
export type CatalogEquipmentListQuery = z.infer<typeof CatalogEquipmentListQuerySchema>;

export const CatalogEquipmentListResponseSchema = z.object({
  items: z.array(CatalogEquipmentSchema),
});
export type CatalogEquipmentListResponse = z.infer<typeof CatalogEquipmentListResponseSchema>;

// GET /catalog/testimonials (@Public, anchor-tenant only). Same posture as
// CatalogEquipmentSchema -- a per-tenant quote, nothing else.
export const CatalogTestimonialSchema = z.object({
  id: z.string().uuid(),
  quote: z.string(),
  authorName: z.string(),
  authorTitle: z.string(),
});
export type CatalogTestimonial = z.infer<typeof CatalogTestimonialSchema>;

export const CatalogTestimonialListResponseSchema = z.object({
  items: z.array(CatalogTestimonialSchema),
});
export type CatalogTestimonialListResponse = z.infer<typeof CatalogTestimonialListResponseSchema>;

// GET /catalog/pricing: the storefront's standard fees for potential
// clients (standard-pricing CR). Trucking has no mobilization/demobilization.
export const CatalogStandardPricingSchema = z.object({
  mobilizationPhp: z.number(),
  demobilizationPhp: z.number(),
  truckBaseFeePhp: z.number(),
  truckDriverFeePhp: z.number(),
  transportPhpPerKm: z.number(),
});
export type CatalogStandardPricing = z.infer<typeof CatalogStandardPricingSchema>;

// --- Response schemas (egress allowlists). ---

export const EquipmentResponseSchema = z.object({
  id: z.string().uuid(),
  equipmentTypeId: z.string().uuid(),
  model: z.string(),
  serialNo: z.string(),
  availabilityStatus: z.string(),
  runtimeHours: z.number(),
  modelNumber: z.string().nullable(),
  yearOfManufacture: z.number().int().nullable(),
  weightCapacityTons: z.number().nullable(),
  engineType: z.string().nullable(),
  fuelType: z.string().nullable(),
  notes: z.string().nullable(),
  categoryNote: z.string().nullable(),
  // The rendered public URL, derived at the egress boundary. The raw Storage
  // object key (equipment.photo_uri) is never exposed: it encodes the tenant
  // id and the bucket layout, and keeping it server-side means the bucket can
  // move without a backfill.
  photoUrl: z.string().nullable(),
});
export type EquipmentResponse = z.infer<typeof EquipmentResponseSchema>;

export const EquipmentListResponseSchema = z.object({
  items: z.array(EquipmentResponseSchema),
  total: z.number().int(),
});
export type EquipmentListResponse = z.infer<typeof EquipmentListResponseSchema>;

export const MaintenanceDetailResponseSchema = z.object({
  schedule: z
    .object({
      hoursInterval: z.number(),
      nextDue: z.number().nullable(),
    })
    .nullable(),
  runtimeHours: z.number(),
  // Every task schedule. hoursSinceService = runtime - (nextDue - interval).
  schedules: z.array(
    z.object({
      id: z.string().uuid(),
      task: z.string().nullable(),
      hoursInterval: z.number(),
      nextDue: z.number().nullable(),
      hoursSinceService: z.number().nullable(),
    }),
  ),
  logs: z.array(
    z.object({
      id: z.string().uuid(),
      performedAt: z.coerce.date(),
      notes: z.string().nullable(),
      scheduleId: z.string().uuid().nullable(),
    }),
  ),
  windows: z.array(
    z.object({
      id: z.string().uuid(),
      startsAt: z.coerce.date(),
      endsAt: z.coerce.date(),
      notes: z.string().nullable(),
    }),
  ),
});
export type MaintenanceDetailResponse = z.infer<typeof MaintenanceDetailResponseSchema>;

export const UtilizationReportResponseSchema = z.object({
  period: z.object({ from: z.string(), to: z.string() }),
  fleet: z.array(
    z.object({
      equipmentId: z.string().uuid(),
      runtimeHours: z.number(),
      utilizationPct: z.number(),
      maintenanceDue: z.boolean(),
    }),
  ),
});
export type UtilizationReportResponse = z.infer<typeof UtilizationReportResponseSchema>;

export const FinancialReportResponseSchema = z.object({
  period: z.object({ from: z.string(), to: z.string() }),
  invoiced: z.object({ byType: z.record(z.string(), z.number()), total: z.number() }),
  paid: z.number(),
  depositDeducted: z.number(),
});
export type FinancialReportResponse = z.infer<typeof FinancialReportResponseSchema>;
