import { z } from 'zod';
import { WeatherSeveritySchema } from './weather.js';

// PRD-F4/F5 read+write surface backing S12/S13/S14 Sites, Weather, and
// Liability Incidents (cr-arkilaunch-f9-read-surface.md).

export const SiteAddressSchema = z.object({
  line1: z.string().min(1).max(200),
  line2: z.string().max(200).optional(),
  city: z.string().min(1).max(120),
  province: z.string().min(1).max(120),
  postalCode: z.string().max(20).optional(),
  country: z.string().length(2).default('PH'),
});
export type SiteAddress = z.infer<typeof SiteAddressSchema>;

export const SiteCreateRequestSchema = z.object({
  address: SiteAddressSchema,
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});
export type SiteCreateRequest = z.infer<typeof SiteCreateRequestSchema>;

// At least one field required -- an empty patch is not a meaningful
// request (same shape as EquipmentUpdateRequestSchema).
export const SiteUpdateRequestSchema = z
  .object({
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
  })
  .refine((data) => data.latitude !== undefined || data.longitude !== undefined, {
    message: 'at least one of latitude or longitude is required',
  });
export type SiteUpdateRequest = z.infer<typeof SiteUpdateRequestSchema>;

// POST /api/v1/sites/:id/deployments (PRD-F4, "deploy/return equipment").
// Same {equipmentId, start, end} shape as BookingItemRequestSchema
// (packages/shared/src/bookings.ts) so both surfaces feed the identical
// overlap-check helper (apps/api/src/common/equipment-availability.ts)
// without one importing the other's request type.
export const DeploymentCreateRequestSchema = z
  .object({
    equipmentId: z.string().uuid(),
    rentalId: z.string().uuid(),
    start: z.string().datetime({ offset: true }),
    end: z.string().datetime({ offset: true }),
  })
  .refine((data) => new Date(data.end).getTime() > new Date(data.start).getTime(), {
    message: 'end must be after start',
  });
export type DeploymentCreateRequest = z.infer<typeof DeploymentCreateRequestSchema>;

// GET /api/v1/incidents?projectSiteId=...
export const IncidentListQuerySchema = z.object({
  projectSiteId: z.string().uuid().optional(),
});
export type IncidentListQuery = z.infer<typeof IncidentListQuerySchema>;

// --- Response schemas (egress allowlists -- expose only what the frontend
// renders, mirroring the discipline set by catalog_list_equipment). ---

export const SiteResponseSchema = z.object({
  id: z.string().uuid(),
  latitude: z.number(),
  longitude: z.number(),
  latestSeverity: WeatherSeveritySchema.nullable(),
  city: z.string().nullable(),
  province: z.string().nullable(),
  observedAt: z.string().datetime().nullable(),
});
export type SiteResponse = z.infer<typeof SiteResponseSchema>;

export const SiteListResponseSchema = z.object({
  items: z.array(SiteResponseSchema),
  total: z.number().int(),
});
export type SiteListResponse = z.infer<typeof SiteListResponseSchema>;

// Response shape for the address sub-object: nullable (not optional) fields,
// since these come back from a nullable DB column, not an omittable request field.
export const SiteAddressResponseSchema = z.object({
  line1: z.string(),
  line2: z.string().nullable(),
  city: z.string(),
  province: z.string(),
  postalCode: z.string().nullable(),
  country: z.string(),
});
export type SiteAddressResponse = z.infer<typeof SiteAddressResponseSchema>;

export const SiteDetailResponseSchema = SiteResponseSchema.extend({
  address: SiteAddressResponseSchema.nullable(),
});
export type SiteDetailResponse = z.infer<typeof SiteDetailResponseSchema>;

export const IncidentResponseSchema = z.object({
  id: z.string().uuid(),
  projectSiteId: z.string().uuid().nullable(),
  siteCity: z.string().nullable(),
  siteProvince: z.string().nullable(),
  severity: z.string().nullable(),
  observed: z.unknown().nullable(),
  occurredAt: z.coerce.date(),
});
export type IncidentResponse = z.infer<typeof IncidentResponseSchema>;

export const IncidentListResponseSchema = z.object({
  items: z.array(IncidentResponseSchema),
  total: z.number().int(),
});
export type IncidentListResponse = z.infer<typeof IncidentListResponseSchema>;
