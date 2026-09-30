import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { and, count, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import {
  addresses,
  auditLogs,
  customers,
  equipment,
  equipmentAssignments,
  events,
  projectSites,
  rentals,
  users,
  weatherAlerts,
  withTenantTx,
} from '@arkilaunch/db';
import {
  manilaDate,
  onLuzonMainland,
  severityMessage,
  WEATHER_STALE_AFTER_MINUTES,
  type DeploymentCreateRequest,
  type DeploymentReturnRequest,
  type IncidentListQuery,
  type SiteEquipmentWeatherResponse,
  type SiteListQuery,
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
import {
  availabilityBlockers,
  findAvailableAlternatives,
} from '../common/equipment-availability.js';
import { countRows } from '../common/count-rows.js';
import { loadFieldLogs } from '../common/field-logs.js';
import { latestEquipmentWeather } from '../common/equipment-weather.js';

// Caps the active-alert rows scanned before the per-site dedupe.
const ACTIVE_ADVISORY_SCAN_LIMIT = 1000;

const EMPTY_OBSERVATION: WeatherObservation = { tempC: 0, windKph: 0, precipMm: 0, code: 0 };

function toWeatherAdvisoryResponse(
  siteId: string,
  latest: typeof weatherAlerts.$inferSelect | undefined,
): WeatherAdvisoryResponse {
  if (!latest) {
    // No poll has run for this site yet: nothing to serve.
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

function discrepancyDetail(
  rule?: string,
  date?: string,
  half?: string,
  system?: { totalPrecipMm?: number; maxWindKph?: number },
  readings?: { minute: number; precip_mm: number }[],
): string {
  const when = `${date ?? ''}${half && half !== 'day' ? ` ${half.toUpperCase()}` : ''}`;
  const base =
    rule === 'D1'
      ? `Idle hours put down to weather, but the site readings show no rain or wind (${when}).`
      : rule === 'D2'
        ? `Worked through a weather warning the timekeeper marked clear or cloudy (${when}).`
        : `Weather report discrepancy (${when}).`;
  const evidence: string[] = [];
  if (typeof system?.totalPrecipMm === 'number') evidence.push(`${system.totalPrecipMm} mm rain recorded`);
  if (typeof system?.maxWindKph === 'number') evidence.push(`wind up to ${Math.round(system.maxWindKph)} km/h`);
  if (readings?.length) {
    const wet = readings.filter((r) => r.precip_mm > 0).length;
    evidence.push(`rain in ${wet} of ${readings.length} half-hourly readings`);
  }
  return `${base}${evidence.length ? ` Recorded: ${evidence.join(', ')}.` : ''} For review, not a finding.`;
}

@Injectable()
export class SitesService {
  constructor(private readonly events: EventsService) {}

  async list(ctx: RequestContext, query: SiteListQuery): Promise<SiteListResponse> {
    return withTenantTx(ctx, async (tx) => {
      // On site = delivered (active), or a legacy deployment unit left 'scheduled' but deployed and active nowhere else.
      // Upcoming = a confirmed booking's unit still in the yard, due within 14 days.
      const onSite = sql`(${equipmentAssignments.status} = 'active' or (${equipmentAssignments.status} = 'scheduled' and ${equipment.availabilityStatus} = 'deployed' and not exists (select 1 from equipment_assignments other where other.equipment_id = ${equipmentAssignments.equipmentId} and other.status = 'active')))`;
      const arriving = sql`(${equipmentAssignments.status} = 'scheduled' and ${rentals.status} = 'confirmed' and ${equipment.availabilityStatus} <> 'deployed' and ${equipmentAssignments.start} >= now() - interval '1 day' and ${equipmentAssignments.start} < now() + interval '14 days')`;
      const units = tx
        .select({
          siteId: sql<string>`${rentals.projectSiteId}`.as('site_id'),
          active: sql<number>`(count(distinct ${equipmentAssignments.equipmentId}) filter (where ${onSite}))::int`.as('active_units'),
          upcoming: sql<number>`(count(distinct ${equipmentAssignments.equipmentId}) filter (where ${arriving}))::int`.as('upcoming_units'),
          nextArrival: sql<string | null>`min(${equipmentAssignments.start}) filter (where ${arriving})`.as('next_arrival'),
        })
        .from(equipmentAssignments)
        .innerJoin(rentals, eq(rentals.id, equipmentAssignments.rentalId))
        .innerJoin(equipment, eq(equipment.id, equipmentAssignments.equipmentId))
        .groupBy(rentals.projectSiteId)
        .as('site_units');
      const activeUnits = sql<number>`coalesce(${units.active}, 0)`;
      const upcomingUnits = sql<number>`coalesce(${units.upcoming}, 0)`;
      const where =
        query.deployment === 'active'
          ? sql`${activeUnits} > 0`
          : query.deployment === 'upcoming'
            ? sql`${upcomingUnits} > 0`
            : query.deployment === 'idle'
              ? sql`${activeUnits} = 0 and ${upcomingUnits} = 0`
              : undefined;

      // Count first: an empty page past the end still has to report the real total.
      const [counted] = await tx
        .select({ value: count() })
        .from(projectSites)
        .leftJoin(units, eq(units.siteId, projectSites.id))
        .where(where);
      const total = counted?.value ?? 0;
      const found = await tx
        .select({
          site: projectSites,
          activeUnits,
          upcomingUnits,
          nextArrival: units.nextArrival,
          customerName: customers.companyName,
        })
        .from(projectSites)
        .leftJoin(units, eq(units.siteId, projectSites.id))
        .leftJoin(customers, eq(customers.id, projectSites.customerId))
        .where(where)
        .orderBy(sql`(${activeUnits} > 0) desc`, sql`(${upcomingUnits} > 0) desc`, desc(projectSites.createdAt))
        .limit(query.limit)
        .offset(query.offset);
      const rows = found.map((row) => row.site);
      if (rows.length === 0) return { items: [], total };

      const alertRows = await tx
        .select()
        .from(weatherAlerts)
        .where(
          inArray(
            weatherAlerts.projectSiteId,
            rows.map((row) => row.id),
          ),
        )
        .orderBy(desc(weatherAlerts.effectiveAt));
      const latestBySite = new Map<string, (typeof alertRows)[number]>();
      for (const alert of alertRows) {
        if (!latestBySite.has(alert.projectSiteId)) latestBySite.set(alert.projectSiteId, alert);
      }

      const addressRows = await tx
        .select()
        .from(addresses)
        .where(
          inArray(
            addresses.id,
            rows.map((row) => row.addressId),
          ),
        );
      const addressById = new Map(addressRows.map((address) => [address.id, address]));

      const items: SiteResponse[] = found.map(({ site: row, ...deployment }) => {
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
          activeUnits: deployment.activeUnits,
          upcomingUnits: deployment.upcomingUnits,
          nextArrival: deployment.nextArrival ? new Date(deployment.nextArrival).toISOString() : null,
          customerName: deployment.customerName,
        };
      });
      return { items, total };
    });
  }

  async get(ctx: RequestContext, id: string): Promise<SiteDetailResponse> {
    return withTenantTx(ctx, async (tx) => {
      const [site] = await tx.select().from(projectSites).where(eq(projectSites.id, id)).limit(1);
      if (!site) throw new NotFoundException({ error: 'project_site_not_found' });

      const [address] = await tx
        .select()
        .from(addresses)
        .where(eq(addresses.id, site.addressId))
        .limit(1);
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

  // project_sites.address_id is NOT NULL, so the address row goes in the same transaction.
  async create(ctx: RequestContext, body: SiteCreateRequest) {
    if (!onLuzonMainland(body.latitude, body.longitude)) throw new UnprocessableEntityException({ error: 'outside_luzon_mainland' });
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

  async update(ctx: RequestContext, id: string, body: SiteUpdateRequest) {
    return withTenantTx(ctx, async (tx) => {
      const [existing] = await tx
        .select()
        .from(projectSites)
        .where(eq(projectSites.id, id))
        .limit(1);
      if (!existing) throw new NotFoundException({ error: 'project_site_not_found' });

      if (!onLuzonMainland(body.latitude ?? Number(existing.latitude), body.longitude ?? Number(existing.longitude)))
        throw new UnprocessableEntityException({ error: 'outside_luzon_mainland' });

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

      return {
        id: updated.id,
        latitude: Number(updated.latitude),
        longitude: Number(updated.longitude),
      };
    });
  }

  // Same overlap check + FOR UPDATE lock as bookings, so never-double-book holds here too; the unit flips to deployed now.
  async createDeployment(ctx: RequestContext, siteId: string, body: DeploymentCreateRequest) {
    return withTenantTx(ctx, async (tx) => {
      const [site] = await tx
        .select()
        .from(projectSites)
        .where(eq(projectSites.id, siteId))
        .limit(1);
      if (!site) throw new NotFoundException({ error: 'project_site_not_found' });

      const [rental] = await tx
        .select()
        .from(rentals)
        .where(eq(rentals.id, body.rentalId))
        .limit(1);
      // equipment_assignments has no site of its own, so the rental's site is the only boundary.
      if (!rental || rental.projectSiteId !== siteId) {
        throw new NotFoundException({ error: 'rental_not_found' });
      }

      const [equipmentRow] = await tx
        .select()
        .from(equipment)
        .where(eq(equipment.id, body.equipmentId))
        .for('update');
      if (!equipmentRow) throw new NotFoundException({ error: 'equipment_not_found' });

      if (equipmentRow.availabilityStatus !== 'available' || equipmentRow.retiredAt) {
        const alternatives = await findAvailableAlternatives(
          tx,
          equipmentRow.equipmentTypeId,
          body,
          [body.equipmentId],
        );
        throw new ConflictException({
          error: 'equipment_unavailable',
          equipmentId: body.equipmentId,
          alternatives,
        });
      }
      // The FK alone would accept another tenant's user id; the operator must be a member of this tenant.
      if (body.operatorUserId) {
        const [operator] = await tx
          .select({ id: users.id })
          .from(users)
          .where(and(eq(users.id, body.operatorUserId), eq(users.tenantId, ctx.tenantId)))
          .limit(1);
        if (!operator) throw new NotFoundException({ error: 'operator_not_found' });
      }
      const blockers = await availabilityBlockers(tx, body.equipmentId, body, {
        operatorUserId: body.operatorUserId,
      });
      if (blockers.includes('operator')) {
        throw new ConflictException({ error: 'operator_unavailable', operatorUserId: body.operatorUserId });
      }
      if (blockers.length > 0) {
        const alternatives = await findAvailableAlternatives(
          tx,
          equipmentRow.equipmentTypeId,
          body,
          [body.equipmentId],
        );
        throw new ConflictException({
          error: 'equipment_unavailable',
          equipmentId: body.equipmentId,
          alternatives,
        });
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
          operatorUserId: body.operatorUserId ?? null,
        })
        .returning();
      if (!assignment) throw new Error('equipment_assignments insert returned no row');

      await tx
        .update(equipment)
        .set({ availabilityStatus: 'deployed' })
        .where(eq(equipment.id, body.equipmentId));

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

  async returnDeployment(
    ctx: RequestContext,
    siteId: string,
    assignmentId: string,
    body: DeploymentReturnRequest = {},
  ) {
    return withTenantTx(ctx, async (tx) => {
      const [assignment] = await tx
        .select()
        .from(equipmentAssignments)
        .where(eq(equipmentAssignments.id, assignmentId))
        .limit(1);
      if (!assignment) throw new NotFoundException({ error: 'deployment_not_found' });

      const [rental] = await tx
        .select()
        .from(rentals)
        .where(eq(rentals.id, assignment.rentalId))
        .limit(1);
      if (!rental || rental.projectSiteId !== siteId) {
        throw new NotFoundException({ error: 'deployment_not_found' });
      }
      if (assignment.status === 'completed' || assignment.status === 'cancelled') {
        throw new ConflictException({ error: 'already_returned' });
      }

      // Unapproved days before today would close billing on an incomplete record; today's sheet may not be in yet.
      const today = manilaDate(new Date());
      const logs = await loadFieldLogs(tx, [rental.id], today);
      const open = logs.days.filter(
        (d) =>
          d.equipmentId === assignment.equipmentId &&
          d.date < today &&
          ['missing', 'pending', 'needs_correction'].includes(d.status),
      );
      if (open.length > 0 && !body.confirmIncompleteLogs) {
        throw new ConflictException({
          error: 'field_logs_incomplete',
          missing: open.filter((d) => d.status === 'missing').map((d) => d.date),
          pending: open.filter((d) => d.status !== 'missing').map((d) => d.date),
        });
      }
      if (open.length > 0) {
        await tx.insert(auditLogs).values({
          tenantId: ctx.tenantId,
          actorId: ctx.userId,
          action: 'UPDATE',
          entity: 'return_with_incomplete_field_logs',
          entityId: assignmentId,
          reason: `${body.reason ?? ''} (open days: ${open.map((d) => d.date).join(', ')})`.slice(0, 2000),
        });
      }

      await tx
        .update(equipmentAssignments)
        .set({ end: new Date(), status: 'completed' })
        .where(eq(equipmentAssignments.id, assignmentId));
      await tx
        .update(equipment)
        .set({ availabilityStatus: 'available' })
        .where(eq(equipment.id, assignment.equipmentId));

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

  // The poller writes a row every cycle, calm or not, so `is_stale` works for a site that never crossed a threshold.
  async weather(ctx: RequestContext, siteId: string): Promise<WeatherAdvisoryResponse> {
    return withTenantTx(ctx, async (tx) => {
      const [site] = await tx
        .select()
        .from(projectSites)
        .where(eq(projectSites.id, siteId))
        .limit(1);
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

  async advisories(ctx: RequestContext): Promise<WeatherAdvisoryListResponse> {
    return withTenantTx(ctx, async (tx) => {
      // Bounded like incidents(); the cap is on alerts, not sites.
      const rows = await tx
        .select()
        .from(weatherAlerts)
        .where(eq(weatherAlerts.status, 'active'))
        .orderBy(desc(weatherAlerts.effectiveAt))
        .limit(ACTIVE_ADVISORY_SCAN_LIMIT);

      const latestBySite = new Map<string, (typeof rows)[number]>();
      for (const row of rows) {
        if (!latestBySite.has(row.projectSiteId)) latestBySite.set(row.projectSiteId, row);
      }

      const items = Array.from(latestBySite.entries()).map(([siteId, row]) =>
        toWeatherAdvisoryResponse(siteId, row),
      );
      return { items, total: items.length };
    });
  }

  // No reading yet reads as no data, never as an all-clear.
  async equipmentWeather(ctx: RequestContext, siteId: string): Promise<SiteEquipmentWeatherResponse> {
    return withTenantTx(ctx, async (tx) => {
      const [site] = await tx.select({ id: projectSites.id }).from(projectSites).where(eq(projectSites.id, siteId)).limit(1);
      if (!site) throw new NotFoundException({ error: 'project_site_not_found' });
      return latestEquipmentWeather(tx, siteId);
    });
  }

  // No incidents table: reads the `events` rows the weather poller writes on a severity crossing.
  async incidents(ctx: RequestContext, query: IncidentListQuery): Promise<IncidentListResponse> {
    return withTenantTx(ctx, async (tx) => {
      const names =
        query.kind === 'weather'
          ? ['weather_liability_incident']
          : query.kind === 'discrepancy'
            ? ['edtr_weather_discrepancy']
            : query.kind === 'used_despite_warning'
              ? ['equipment_used_despite_warning']
              : ['weather_liability_incident', 'edtr_weather_discrepancy', 'equipment_used_despite_warning'];
      const conditions: SQL[] = [inArray(events.name, names)];
      if (query.projectSiteId) {
        conditions.push(sql`${events.properties} ->> 'project_site_id' = ${query.projectSiteId}`);
      }

      const total = await countRows(tx, events, and(...conditions));
      const rows = await tx
        .select()
        .from(events)
        .where(and(...conditions))
        .orderBy(desc(events.occurredAt))
        .limit(query.limit)
        .offset(query.offset);

      const siteIds = [
        ...new Set(
          rows
            .map((row) => (row.properties as { project_site_id?: string }).project_site_id)
            .filter((id): id is string => Boolean(id)),
        ),
      ];
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
        const properties = row.properties as {
          project_site_id?: string;
          severity?: string;
          observed?: unknown;
          rule?: string;
          date?: string;
          half?: string;
          system?: unknown;
          level?: string;
          reasons?: string[];
          hours_active?: number;
          warned_at?: string;
          equipment_id?: string;
          readings?: { minute: number; precip_mm: number }[];
        };
        const discrepancy = row.name === 'edtr_weather_discrepancy';
        const ignored = row.name === 'equipment_used_despite_warning';
        const site = properties.project_site_id
          ? siteById.get(properties.project_site_id)
          : undefined;
        return {
          id: row.id,
          projectSiteId: properties.project_site_id ?? null,
          siteCity: site?.city ?? null,
          siteProvince: site?.province ?? null,
          severity: discrepancy || ignored ? 'high' : (properties.severity ?? null),
          // Everything the event recorded, for the detail drawer; minute readings stay summarised in `detail`.
          observed: discrepancy
            ? { ...(properties.system as object | undefined), rule: properties.rule, date: properties.date, half: properties.half }
            : ignored
              ? {
                  equipment_id: properties.equipment_id,
                  level: properties.level,
                  hours_active: properties.hours_active,
                  date: properties.date,
                  warned_at: properties.warned_at,
                  reasons: properties.reasons ?? [],
                }
              : (properties.observed ?? null),
          occurredAt: row.occurredAt,
          kind: ignored ? ('used_despite_warning' as const) : discrepancy ? ('discrepancy' as const) : ('weather' as const),
          detail: ignored
            ? `${properties.hours_active ?? '?'} h logged on ${properties.date ?? 'that day'} on a machine warned to STOP WORK${
                properties.warned_at ? ` at ${new Date(properties.warned_at).toLocaleTimeString('en-PH', { timeZone: 'Asia/Manila', hour: '2-digit', minute: '2-digit' })}` : ''
              }${properties.reasons?.length ? `: ${properties.reasons.join('; ')}` : ''}.`
            : discrepancy
              ? discrepancyDetail(
                  properties.rule,
                  properties.date,
                  properties.half,
                  properties.system as { totalPrecipMm?: number; maxWindKph?: number } | undefined,
                  properties.readings,
                )
              : null,
        };
      });
      return { items, total };
    });
  }
}
