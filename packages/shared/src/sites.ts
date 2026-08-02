import { z } from 'zod';

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
