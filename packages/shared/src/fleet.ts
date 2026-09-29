import { z } from 'zod';
import { PaginationQuerySchema } from './pagination.js';

export const EquipmentStatusSchema = z.enum(['available', 'deployed', 'maintenance']);
export type EquipmentStatus = z.infer<typeof EquipmentStatusSchema>;

export const EquipmentListQuerySchema = PaginationQuerySchema.extend({
  status: EquipmentStatusSchema.optional(),
  typeId: z.string().uuid().optional(),
  q: z.string().trim().max(100).optional(),
  missing: z.enum(['photo', 'price']).optional(),
});
export type EquipmentListQuery = z.infer<typeof EquipmentListQuerySchema>;

// Labels, never priced: rate_cards is the one price.
export const EquipmentOptionGroupSchema = z.object({
  name: z.string().trim().min(1).max(60),
  values: z
    .array(z.string().trim().min(1).max(60))
    .min(1)
    .max(12)
    .refine((values) => new Set(values).size === values.length, { message: 'choices must be unique' }),
});
export type EquipmentOptionGroup = z.infer<typeof EquipmentOptionGroupSchema>;

export const EquipmentOptionGroupsSchema = z
  .array(EquipmentOptionGroupSchema)
  .max(6)
  .refine((groups) => new Set(groups.map((g) => g.name)).size === groups.length, {
    message: 'option names must be unique',
  });

export const SelectedOptionsSchema = z.record(z.string().max(60), z.string().max(60));
export type SelectedOptions = z.infer<typeof SelectedOptionsSchema>;

export function selectedOptionsError(
  groups: readonly EquipmentOptionGroup[],
  selected: SelectedOptions,
): string | null {
  for (const group of groups) {
    const pick = selected[group.name];
    if (pick === undefined) return `missing ${group.name}`;
    if (!group.values.includes(pick)) return `${pick} is not a ${group.name} choice`;
  }
  const known = new Set(groups.map((g) => g.name));
  const extra = Object.keys(selected).find((name) => !known.has(name));
  return extra ? `${extra} is not an option on this unit` : null;
}

// No rate fields: rate_cards owns pricing; a second price here would compete on the money path.
const EquipmentSpecFieldsSchema = z.object({
  modelNumber: z.string().max(100).optional(),
  yearOfManufacture: z.number().int().min(1900).max(2100).optional(),
  weightCapacityTons: z.number().positive().max(100_000).optional(),
  engineType: z.string().max(100).optional(),
  fuelType: z.string().max(100).optional(),
  notes: z.string().max(2000).optional(),
  categoryNote: z.string().max(200).optional(),
  optionGroups: EquipmentOptionGroupsSchema.optional(),
  photoCredit: z.string().trim().max(200).optional(),
  photoSourceUrl: z.union([z.string().url().startsWith('https://').max(2000), z.literal('')]).optional(),
});

export const EquipmentCreateRequestSchema = EquipmentSpecFieldsSchema.extend({
  equipmentTypeId: z.string().uuid(),
  model: z.string().min(1).max(200),
  serialNo: z.string().min(1).max(200),
  availabilityStatus: EquipmentStatusSchema.default('available'),
});
export type EquipmentCreateRequest = z.infer<typeof EquipmentCreateRequestSchema>;

// No serialNo: migration 0026 REVOKEs UPDATE on it so a DTR-cited identity cannot be rewritten.
export const EquipmentUpdateRequestSchema = EquipmentSpecFieldsSchema.extend({
  model: z.string().min(1).max(200).optional(),
  availabilityStatus: EquipmentStatusSchema.optional(),
}).refine((data) => Object.values(data).some((value) => value !== undefined), {
  message: 'at least one field is required',
});
export type EquipmentUpdateRequest = z.infer<typeof EquipmentUpdateRequestSchema>;

// A retire, not a delete (migration 0026).
export const EquipmentRetireResponseSchema = z.object({
  id: z.string().uuid(),
  retired: z.literal(true),
});
export type EquipmentRetireResponse = z.infer<typeof EquipmentRetireResponseSchema>;

export const MaintenanceLogCreateRequestSchema = z.object({
  performedAt: z.string().datetime({ offset: true }),
  notes: z.string().max(2000).optional(),
  scheduleId: z.string().uuid().optional(),
});
export type MaintenanceLogCreateRequest = z.infer<typeof MaintenanceLogCreateRequestSchema>;

export const MaintenanceScheduleCreateRequestSchema = z.object({
  task: z.string().min(1).max(100),
  hoursInterval: z.number().positive().max(100_000),
});
export type MaintenanceScheduleCreateRequest = z.infer<typeof MaintenanceScheduleCreateRequestSchema>;

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

export const MAINTENANCE_PRESETS: readonly { task: string; hoursInterval: number }[] = [
  { task: 'Engine oil', hoursInterval: 250 },
  { task: 'Hydraulic oil', hoursInterval: 1000 },
  { task: 'Air filter', hoursInterval: 500 },
  { task: 'Grease', hoursInterval: 10 },
  { task: 'Fuel filter', hoursInterval: 500 },
  { task: 'Undercarriage inspection', hoursInterval: 500 },
];

export const RuntimeCorrectionRequestSchema = z.object({
  runtimeHours: z.number().min(0).max(1_000_000),
  reason: z.string().trim().min(3).max(500),
});
export type RuntimeCorrectionRequest = z.infer<typeof RuntimeCorrectionRequestSchema>;

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

// Public: never expose serialNo/runtimeHours to an anonymous caller.
export const CatalogEquipmentSchema = z.object({
  id: z.string().uuid(),
  equipmentTypeName: z.string(),
  model: z.string(),
  availabilityStatus: EquipmentStatusSchema,
  photoUri: z.string().nullable(),
  rateType: z.string().nullable().optional(),
  rateValue: z.number().nullable().optional(),
  optionGroups: z.array(EquipmentOptionGroupSchema).optional(),
  photoCredit: z.string().nullable().optional(),
  photoSourceUrl: z.string().nullable().optional(),
});
export type CatalogEquipment = z.infer<typeof CatalogEquipmentSchema>;

export const CatalogEquipmentListQuerySchema = PaginationQuerySchema;
export type CatalogEquipmentListQuery = z.infer<typeof CatalogEquipmentListQuerySchema>;

export const CatalogEquipmentListResponseSchema = z.object({
  items: z.array(CatalogEquipmentSchema),
});
export type CatalogEquipmentListResponse = z.infer<typeof CatalogEquipmentListResponseSchema>;

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
  // Never expose the raw Storage key: it encodes the tenant id and bucket layout.
  photoUrl: z.string().nullable(),
  equipmentTypeName: z.string().optional(),
  optionGroups: z.array(EquipmentOptionGroupSchema),
  photoCredit: z.string().nullable(),
  photoSourceUrl: z.string().nullable(),
});
export type EquipmentResponse = z.infer<typeof EquipmentResponseSchema>;

export const EquipmentListResponseSchema = z.object({
  items: z.array(EquipmentResponseSchema),
  total: z.number().int(),
  categories: z
    .array(z.object({ equipmentTypeId: z.string().uuid(), name: z.string(), count: z.number().int() }))
    .optional(),
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

export const MaintenanceWindowExtendRequestSchema = z.object({
  endsAt: z.string().datetime({ offset: true }),
});
export type MaintenanceWindowExtendRequest = z.infer<typeof MaintenanceWindowExtendRequestSchema>;

export interface MaintenanceWindowEndingSoon {
  windowId: string;
  equipmentId: string;
  model: string;
  serialNo: string;
  endsAt: string;
}

export interface EquipmentReportResponse {
  equipmentId: string;
  model: string;
  serialNo: string;
  runtimeHours: number;
  fuelLPerHour: number | null;
  months: { month: string; hours: number; fuelLitres: number | null }[];
  totals: { hours: number; fuelLitres: number | null; rentals: number; revenuePhp: number };
  rentals: { rentalId: string; companyName: string | null; start: string; end: string | null; status: string; revenuePhp: number | null }[];
  maintenance: {
    services: number;
    lastServiceAt: string | null;
    recent: { performedAt: string; task: string | null; notes: string | null }[];
    blocks: { startsAt: string; endsAt: string; notes: string | null; current: boolean }[];
  };
  weather: { warnings: number; usedDespiteWarning: number };
}
