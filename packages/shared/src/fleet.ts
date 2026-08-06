import { z } from 'zod';

// PRD-F4 (Fleet Inventory, Maintenance & Reporting), SDD §4 endpoint
// contracts for /equipment, /equipment/:id/maintenance,
// /equipment/:id/maintenance-logs, /reports/utilization.

export const EquipmentStatusSchema = z.enum(['available', 'deployed', 'maintenance']);
export type EquipmentStatus = z.infer<typeof EquipmentStatusSchema>;

// GET /equipment?status=... query is validated the same as any other
// external input (AGENTS.md "Always: validate external input at the
// boundary with Zod"), not passed through as a raw string.
export const EquipmentListQuerySchema = z.object({
  status: EquipmentStatusSchema.optional(),
});
export type EquipmentListQuery = z.infer<typeof EquipmentListQuerySchema>;

// POST /equipment (addition beyond the SDD §4 endpoint list; see
// AGENTS.md §5.1 Change Record). fleet:manage-gated at the controller.
export const EquipmentCreateRequestSchema = z.object({
  equipmentTypeId: z.string().uuid(),
  model: z.string().min(1).max(200),
  serialNo: z.string().min(1).max(200),
  availabilityStatus: EquipmentStatusSchema.default('available'),
});
export type EquipmentCreateRequest = z.infer<typeof EquipmentCreateRequestSchema>;

// PATCH /equipment/:id. At least one field required -- an empty patch is
// not a meaningful request.
export const EquipmentUpdateRequestSchema = z
  .object({
    model: z.string().min(1).max(200).optional(),
    availabilityStatus: EquipmentStatusSchema.optional(),
  })
  .refine((data) => data.model !== undefined || data.availabilityStatus !== undefined, {
    message: 'at least one of model or availabilityStatus is required',
  });
export type EquipmentUpdateRequest = z.infer<typeof EquipmentUpdateRequestSchema>;

// POST /equipment/:id/maintenance-logs (SDD §4). performedAt is a full
// timestamptz (not a bare date, unlike edtr.reportDate) since a
// maintenance action is logged at a point in time, not a calendar day.
export const MaintenanceLogCreateRequestSchema = z.object({
  performedAt: z.string().datetime({ offset: true }),
  notes: z.string().max(2000).optional(),
});
export type MaintenanceLogCreateRequest = z.infer<typeof MaintenanceLogCreateRequestSchema>;

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
});
export type CatalogEquipment = z.infer<typeof CatalogEquipmentSchema>;

export const CatalogEquipmentListResponseSchema = z.object({
  items: z.array(CatalogEquipmentSchema),
});
export type CatalogEquipmentListResponse = z.infer<typeof CatalogEquipmentListResponseSchema>;

// --- Response schemas (egress allowlists). ---

export const EquipmentResponseSchema = z.object({
  id: z.string().uuid(),
  equipmentTypeId: z.string().uuid(),
  model: z.string(),
  serialNo: z.string(),
  availabilityStatus: z.string(),
  runtimeHours: z.number(),
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
  logs: z.array(
    z.object({
      id: z.string().uuid(),
      performedAt: z.coerce.date(),
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
