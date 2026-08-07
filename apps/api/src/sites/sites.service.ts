import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import {
  addresses,
  auditLogs,
  equipment,
  equipmentAssignments,
  events,
  projectSites,
  rentals,
  weatherAlerts,
  withTenantTx,
} from '@arkilaunch/db';
import {
  severityMessage,
  WEATHER_STALE_AFTER_MINUTES,
  type DeploymentCreateRequest,
  type IncidentListQuery,
  type IncidentListResponse,
  type RequestContext,
  type SiteCreateRequest,
  type SiteDetailResponse,
  type SiteListResponse,
  type SiteResponse,
  type SiteUpdateRequest,
  type WeatherAdvisoryListResponse,
  type WeatherAdvisoryResponse,
  type WeatherObservation,
  type WeatherSeverity,
} from '@arkilaunch/shared';
import { EventsService } from '../events/events.service.js';
import { findAvailableAlternatives, overlappingAssignments } from '../common/equipment-availability.js';

const EMPTY_OBSERVATION: WeatherObservation = { tempC: 0, windKph: 0, precipMm: 0, code: 0 };

// Pure row-to-response mapping shared by weather() and advisories() (PRD-F5)
// so a single-site read and the tenant-wide list can never disagree about
// what a reading means -- the same shared-pure-function shape as
// evaluateSeverity() in packages/shared/src/weather.ts.
function toWeatherAdvisoryResponse(
  siteId: string,
  latest: typeof weatherAlerts.$inferSelect | undefined,
): WeatherAdvisoryResponse {
  if (!latest) {
    // No poll has ever run for this site (ENABLE_WEATHER_POLL default off,
    // or the site was just created) -- nothing to serve yet.
    return {
      siteId,
      observed: EMPTY_OBSERVATION,
      advisory: { severity: 'none', message: severityMessage('none') },
      isStale: true,
      polledAt: null,
    };
  }

  const observed = (latest.observed as WeatherObservation | null) ?? EMPTY_OBSERVATION;
  const severity = latest.severity as WeatherSeverity;
  const ageMinutes = (Date.now() - latest.effectiveAt.getTime()) / 60_000;

  return {
    siteId,
    observed,
    advisory: { severity, message: severityMessage(severity) },
    isStale: latest.isStale || ageMinutes > WEATHER_STALE_AFTER_MINUTES,
    polledAt: latest.effectiveAt.toISOString(),
  };
}

@Injectable()
export class SitesService {
  constructor(private readonly events: EventsService) {}

  // GET /api/v1/sites (S12). Readable by any authenticated tenant member --
  // site-safety information, same posture as fleet/reference reads; RLS is
  // the isolation boundary.
  async list(ctx: RequestContext): Promise<SiteListResponse> {
    return withTenantTx(ctx, async (tx) => {
      const rows = await tx.select().from(projectSites);
      if (rows.length === 0) return { items: [], total: 0 };

      const alertRows = await tx
        .select()
        .from(weatherAlerts)
        .where(inArray(weatherAlerts.projectSiteId, rows.map((row) => row.id)))
        .orderBy(desc(weatherAlerts.effectiveAt));
      const latestBySite = new Map<string, (typeof alertRows)[number]>();
      for (const alert of alertRows) {
        if (!latestBySite.has(alert.projectSiteId)) latestBySite.set(alert.projectSiteId, alert);
      }

      // Human-readable location (BRAND.md: a site is never shown as a bare
      // UUID) -- same address join get() already does, applied here too.
      const addressRows = await tx
        .select()
        .from(addresses)
        .where(inArray(addresses.id, rows.map((row) => row.addressId)));
      const addressById = new Map(addressRows.map((address) => [address.id, address]));

      const items: SiteResponse[] = rows.map((row) => {
        const latest = latestBySite.get(row.id);
        const address = addressById.get(row.addressId);
        return {
          id: row.id,
          latitude: Number(row.latitude),
          longitude: Number(row.longitude),
          latestSeverity: (latest?.severity as WeatherSeverity | undefined) ?? null,
          city: address?.city ?? null,
          province: address?.province ?? null,
          observedAt: latest?.effectiveAt.toISOString() ?? null,
        };
      });
      return { items, total: items.length };
    });
  }

  // GET /api/v1/sites/:id (S12).
  async get(ctx: RequestContext, id: string): Promise<SiteDetailResponse> {
    return withTenantTx(ctx, async (tx) => {
      const [site] = await tx.select().from(projectSites).where(eq(projectSites.id, id)).limit(1);
      if (!site) throw new NotFoundException({ error: 'project_site_not_found' });

      const [address] = await tx.select().from(addresses).where(eq(addresses.id, site.addressId)).limit(1);
      const [latest] = await tx
        .select()
        .from(weatherAlerts)
        .where(eq(weatherAlerts.projectSiteId, id))
        .orderBy(desc(weatherAlerts.effectiveAt))
        .limit(1);

      return {
        id: site.id,
        latitude: Number(site.latitude),
        longitude: Number(site.longitude),
        latestSeverity: (latest?.severity as WeatherSeverity | undefined) ?? null,
        city: address?.city ?? null,
        province: address?.province ?? null,
        observedAt: latest?.effectiveAt.toISOString() ?? null,
        address: address
          ? {
              line1: address.line1,
              line2: address.line2,
              city: address.city,
              province: address.province,
              postalCode: address.postalCode,
              country: address.country,
            }
          : null,
      };
    });
  }

  // POST /api/v1/sites (addition beyond SDD §4; see AGENTS.md §5.1 Change
  // Record). site:manage-gated. project_sites.address_id is NOT NULL, so
  // this inserts the address row in the same transaction.
  async create(ctx: RequestContext, body: SiteCreateRequest) {
    return withTenantTx(ctx, async (tx) => {
      const [address] = await tx
        .insert(addresses)
        .values({
          tenantId: ctx.tenantId,
          line1: body.address.line1,
          line2: body.address.line2 ?? null,
          city: body.address.city,
          province: body.address.province,
          postalCode: body.address.postalCode ?? null,
          country: body.address.country,
        })
        .returning();
      if (!address) throw new Error('addresses insert returned no row');

      const [site] = await tx
        .insert(projectSites)
        .values({
          tenantId: ctx.tenantId,
          addressId: address.id,
          latitude: String(body.latitude),
          longitude: String(body.longitude),
        })
        .returning();
      if (!site) throw new Error('project_sites insert returned no row');

      await tx.insert(auditLogs).values({
        tenantId: ctx.tenantId,
        actorId: ctx.userId,
        action: 'CREATE',
        entity: 'project_sites',
        entityId: site.id,
      });
      await this.events.emit(ctx, 'project_site_created', { project_site_id: site.id });

      return { id: site.id, latitude: Number(site.latitude), longitude: Number(site.longitude) };
    });
  }

  // PATCH /api/v1/sites/:id. site:manage-gated.
  async update(ctx: RequestContext, id: string, body: SiteUpdateRequest) {
    return withTenantTx(ctx, async (tx) => {
      const [existing] = await tx.select().from(projectSites).where(eq(projectSites.id, id)).limit(1);
      if (!existing) throw new NotFoundException({ error: 'project_site_not_found' });

      const [updated] = await tx
        .update(projectSites)
        .set({
          ...(body.latitude !== undefined ? { latitude: String(body.latitude) } : {}),
          ...(body.longitude !== undefined ? { longitude: String(body.longitude) } : {}),
        })
        .where(eq(projectSites.id, id))
        .returning();
      if (!updated) throw new Error('project_sites update returned no row');

      await tx.insert(auditLogs).values({
        tenantId: ctx.tenantId,
        actorId: ctx.userId,
        action: 'UPDATE',
        entity: 'project_sites',
        entityId: id,
      });

      return { id: updated.id, latitude: Number(updated.latitude), longitude: Number(updated.longitude) };
    });
  }

  // POST /api/v1/sites/:id/deployments (PRD-F4 "deploy equipment"). Reuses
  // the exact overlap-check + FOR UPDATE lock + alternatives logic
  // bookings.service.ts uses, so QAD-T16/QAD-T21 (never deploy a
  // maintenance-flagged/already-deployed unit, never double-book) hold on
  // this path too, not only the booking path. Unlike a booking (which only
  // schedules a future window), a deployment happens now: the equipment's
  // own availabilityStatus flips to 'deployed' immediately.
  async createDeployment(ctx: RequestContext, siteId: string, body: DeploymentCreateRequest) {
    return withTenantTx(ctx, async (tx) => {
      const [site] = await tx.select().from(projectSites).where(eq(projectSites.id, siteId)).limit(1);
      if (!site) throw new NotFoundException({ error: 'project_site_not_found' });

      const [rental] = await tx.select().from(rentals).where(eq(rentals.id, body.rentalId)).limit(1);
      // A rental for a different site can never deploy "to" this one --
      // equipment_assignments has no project_site_id of its own (it is
      // derived from the rental), so this is also what keeps
      // returnDeployment's own rental.projectSiteId === siteId check
      // (below) from ever finding a deployment it cannot return.
      if (!rental || rental.projectSiteId !== siteId) {
        throw new NotFoundException({ error: 'rental_not_found' });
      }

      const [equipmentRow] = await tx
        .select()
        .from(equipment)
        .where(eq(equipment.id, body.equipmentId))
        .for('update');
      if (!equipmentRow) throw new NotFoundException({ error: 'equipment_not_found' });

      if (equipmentRow.availabilityStatus !== 'available') {
        const alternatives = await findAvailableAlternatives(tx, equipmentRow.equipmentTypeId, body, [body.equipmentId]);
        throw new ConflictException({ error: 'equipment_unavailable', equipmentId: body.equipmentId, alternatives });
      }
      const overlapping = await overlappingAssignments(tx, body.equipmentId, body);
      if (overlapping.length > 0) {
        const alternatives = await findAvailableAlternatives(tx, equipmentRow.equipmentTypeId, body, [body.equipmentId]);
        throw new ConflictException({ error: 'equipment_unavailable', equipmentId: body.equipmentId, alternatives });
      }

      const [assignment] = await tx
        .insert(equipmentAssignments)
        .values({
          tenantId: ctx.tenantId,
          equipmentId: body.equipmentId,
          rentalId: body.rentalId,
          start: new Date(body.start),
          end: new Date(body.end),
          status: 'scheduled',
        })
        .returning();
      if (!assignment) throw new Error('equipment_assignments insert returned no row');

      await tx.update(equipment).set({ availabilityStatus: 'deployed' }).where(eq(equipment.id, body.equipmentId));

      await tx.insert(auditLogs).values({
        tenantId: ctx.tenantId,
        actorId: ctx.userId,
        action: 'CREATE',
        entity: 'equipment_assignments',
        entityId: assignment.id,
      });
      await this.events.emit(ctx, 'equipment_deployed', {
        equipment_id: body.equipmentId,
        project_site_id: siteId,
        assignment_id: assignment.id,
      });

      return {
        id: assignment.id,
        equipmentId: assignment.equipmentId,
        rentalId: assignment.rentalId,
        start: assignment.start,
        end: assignment.end,
        status: assignment.status,
      };
    });
  }

  // PATCH /api/v1/sites/:id/deployments/:assignmentId/return (PRD-F4
  // "return equipment"). Frees the unit for its next deployment/booking.
  async returnDeployment(ctx: RequestContext, siteId: string, assignmentId: string) {
    return withTenantTx(ctx, async (tx) => {
      const [assignment] = await tx
        .select()
        .from(equipmentAssignments)
        .where(eq(equipmentAssignments.id, assignmentId))
        .limit(1);
      if (!assignment) throw new NotFoundException({ error: 'deployment_not_found' });

      const [rental] = await tx.select().from(rentals).where(eq(rentals.id, assignment.rentalId)).limit(1);
      if (!rental || rental.projectSiteId !== siteId) {
        throw new NotFoundException({ error: 'deployment_not_found' });
      }
      if (assignment.status === 'completed' || assignment.status === 'cancelled') {
        throw new ConflictException({ error: 'already_returned' });
      }

      await tx
        .update(equipmentAssignments)
        .set({ end: new Date(), status: 'completed' })
        .where(eq(equipmentAssignments.id, assignmentId));
      await tx.update(equipment).set({ availabilityStatus: 'available' }).where(eq(equipment.id, assignment.equipmentId));

      await tx.insert(auditLogs).values({
        tenantId: ctx.tenantId,
        actorId: ctx.userId,
        action: 'UPDATE',
        entity: 'equipment_assignments',
        entityId: assignmentId,
      });
      await this.events.emit(ctx, 'equipment_returned', {
        equipment_id: assignment.equipmentId,
        project_site_id: siteId,
        assignment_id: assignmentId,
      });

      return { id: assignmentId, status: 'completed' };
    });
  }

  // GET /api/v1/sites/:id/weather (SDD §4, PRD-F5). Serves the latest
  // weather_alerts row for the site -- jobs/src/weather-poll.ts writes one
  // every cycle, calm or not (T2: the alerts table doubles as the reading
  // cache), so `is_stale` can be computed even for a site that has never
  // crossed a threshold. Readable by any authenticated tenant member (T4):
  // this is site-safety information, and timekeepers are the ones
  // physically on site; RLS is the isolation boundary, same posture as
  // reference/*.
  async weather(ctx: RequestContext, siteId: string): Promise<WeatherAdvisoryResponse> {
    return withTenantTx(ctx, async (tx) => {
      const [site] = await tx.select().from(projectSites).where(eq(projectSites.id, siteId)).limit(1);
      if (!site) throw new NotFoundException({ error: 'project_site_not_found' });

      const [latest] = await tx
        .select()
        .from(weatherAlerts)
        .where(eq(weatherAlerts.projectSiteId, siteId))
        .orderBy(desc(weatherAlerts.effectiveAt))
        .limit(1);

      return toWeatherAdvisoryResponse(siteId, latest);
    });
  }

  // GET /api/v1/weather/advisories (S13). Active advisories (status !=
  // 'cleared') across every site in the tenant, one row per site (its
  // latest active reading).
  async advisories(ctx: RequestContext): Promise<WeatherAdvisoryListResponse> {
    return withTenantTx(ctx, async (tx) => {
      const rows = await tx
        .select()
        .from(weatherAlerts)
        .where(eq(weatherAlerts.status, 'active'))
        .orderBy(desc(weatherAlerts.effectiveAt));

      const latestBySite = new Map<string, (typeof rows)[number]>();
      for (const row of rows) {
        if (!latestBySite.has(row.projectSiteId)) latestBySite.set(row.projectSiteId, row);
      }

      const items = Array.from(latestBySite.entries()).map(([siteId, row]) => toWeatherAdvisoryResponse(siteId, row));
      return { items, total: items.length };
    });
  }

  // GET /api/v1/incidents?projectSiteId=... (S14 Liability Incident Log).
  // No new table: reads the `events` rows jobs/src/weather-poll.ts already
  // writes on a new-or-worsening severity crossing (SDD §4 "auto-logs a
  // liability incident") -- a dedicated incidents table would duplicate
  // data the first-party analytics sink already holds (restraint ladder).
  async incidents(ctx: RequestContext, query: IncidentListQuery): Promise<IncidentListResponse> {
    return withTenantTx(ctx, async (tx) => {
      const conditions: SQL[] = [eq(events.name, 'weather_liability_incident')];
      if (query.projectSiteId) {
        conditions.push(sql`${events.properties} ->> 'project_site_id' = ${query.projectSiteId}`);
      }

      const rows = await tx
        .select()
        .from(events)
        .where(and(...conditions))
        .orderBy(desc(events.occurredAt));

      const siteIds = [
        ...new Set(
          rows
            .map((row) => (row.properties as { project_site_id?: string }).project_site_id)
            .filter((id): id is string => Boolean(id)),
        ),
      ];
      // Human-readable location (an incident is never shown as a bare
      // project_site_id UUID) -- same address-via-site join as GET /sites.
      const siteRows =
        siteIds.length === 0
          ? []
          : await tx
              .select({ id: projectSites.id, city: addresses.city, province: addresses.province })
              .from(projectSites)
              .leftJoin(addresses, eq(addresses.id, projectSites.addressId))
              .where(inArray(projectSites.id, siteIds));
      const siteById = new Map(siteRows.map((site) => [site.id, site]));

      const items = rows.map((row) => {
        const properties = row.properties as { project_site_id?: string; severity?: string; observed?: unknown };
        const site = properties.project_site_id ? siteById.get(properties.project_site_id) : undefined;
        return {
          id: row.id,
          projectSiteId: properties.project_site_id ?? null,
          siteCity: site?.city ?? null,
          siteProvince: site?.province ?? null,
          severity: properties.severity ?? null,
          observed: properties.observed ?? null,
          occurredAt: row.occurredAt,
        };
      });
      return { items, total: items.length };
    });
  }
}
