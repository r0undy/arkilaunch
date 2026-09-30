import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, count, desc, eq, gt, gte, ilike, inArray, isNull, lt, lte, ne, or, sql, type SQL } from 'drizzle-orm';
import {
  type Tx,
  auditLogs,
  customers,
  edtr,
  edtrLineItems,
  edtrReconciliations,
  equipment,
  equipmentAssignments,
  equipmentTypes,
  events,
  getBillingSettings,
  invoices,
  maintenanceLogs,
  maintenanceSchedules,
  maintenanceWindows,
  payments,
  pricingParameters,
  quotationItems,
  quotations,
  rentals,
  tenantCalendar,
  withTenantTx,
  publicPhotoUrl,
} from '@arkilaunch/db';
import type {
  EquipmentCreateRequest,
  EquipmentOptionGroup,
  EquipmentListQuery,
  EquipmentListResponse,
  EquipmentResponse,
  EquipmentRetireResponse,
  EquipmentUpdateRequest,
  FinancialReportResponse,
  MaintenanceDetailResponse,
  MaintenanceLogCreateRequest,
  MaintenanceScheduleCreateRequest,
  MaintenanceWindowCreateRequest,
  MaintenanceWindowEndingSoon,
  MaintenanceWindowExtendRequest,
  EquipmentReportResponse,
  AvailabilityQuery,
  AvailabilityResponse,
  TenantCalendar,
  RequestContext,
  RuntimeCorrectionRequest,
  UtilizationQuery,
  UtilizationReportResponse,
  LeakageReport,
  LeakageReportQuery,
  StatementPdfResponse,
} from '@arkilaunch/shared';
import { buildLeakageReport } from './leakage-report.js';
import { renderLeakageReportPdf } from './leakage-report-pdf.js';
import { tenantBrand } from '../common/tenant-brand.js';
import { manilaDate, round2HalfUp, type ApprovedDayHours } from '@arkilaunch/shared';
import { EventsService } from '../events/events.service.js';
import { countRows } from '../common/count-rows.js';
import { approvedHours } from '../common/field-logs.js';
import { dayAvailability, readCalendar } from '../common/equipment-availability.js';

// ponytail: utilization assumes an 8-hour workday per calendar day, not the unit's scheduled availability.
const BUSINESS_HOURS_PER_DAY = 8;
const DEFAULT_REPORT_WINDOW_DAYS = 30;

function toEquipmentResponse(row: typeof equipment.$inferSelect): EquipmentResponse {
  return {
    id: row.id,
    equipmentTypeId: row.equipmentTypeId,
    model: row.model,
    serialNo: row.serialNo,
    availabilityStatus: row.availabilityStatus,
    runtimeHours: Number(row.runtimeHours),
    modelNumber: row.modelNumber,
    yearOfManufacture: row.yearOfManufacture,
    // null stays null: Number(null) is 0, which would report an unspecified machine as weightless.
    weightCapacityTons: row.weightCapacityTons === null ? null : Number(row.weightCapacityTons),
    engineType: row.engineType,
    fuelType: row.fuelType,
    notes: row.notes,
    categoryNote: row.categoryNote,
    photoUrl: publicPhotoUrl(row.photoUri),
    optionGroups: row.optionGroups,
    photoCredit: row.photoCredit,
    photoSourceUrl: row.photoSourceUrl,
  };
}

// Spread conditionally so a PATCH that omits a field leaves it alone.
type EquipmentSpecFields = {
  modelNumber?: string | undefined;
  yearOfManufacture?: number | undefined;
  weightCapacityTons?: number | undefined;
  engineType?: string | undefined;
  fuelType?: string | undefined;
  notes?: string | undefined;
  categoryNote?: string | undefined;
  optionGroups?: EquipmentOptionGroup[] | undefined;
  photoCredit?: string | undefined;
  photoSourceUrl?: string | undefined;
};

function specFieldPatch(body: EquipmentSpecFields) {
  return {
    ...(body.modelNumber !== undefined ? { modelNumber: body.modelNumber } : {}),
    ...(body.yearOfManufacture !== undefined
      ? { yearOfManufacture: body.yearOfManufacture }
      : {}),
    ...(body.weightCapacityTons !== undefined
      ? { weightCapacityTons: String(body.weightCapacityTons) }
      : {}),
    ...(body.engineType !== undefined ? { engineType: body.engineType } : {}),
    ...(body.fuelType !== undefined ? { fuelType: body.fuelType } : {}),
    ...(body.notes !== undefined ? { notes: body.notes } : {}),
    ...(body.categoryNote !== undefined ? { categoryNote: body.categoryNote } : {}),
    ...(body.optionGroups !== undefined ? { optionGroups: body.optionGroups } : {}),
    // '' is the form clearing the field; store null, not an empty string.
    ...(body.photoCredit !== undefined ? { photoCredit: body.photoCredit || null } : {}),
    ...(body.photoSourceUrl !== undefined ? { photoSourceUrl: body.photoSourceUrl || null } : {}),
  };
}

function daysBetweenInclusive(from: string, to: string): number {
  const fromMs = Date.parse(`${from}T00:00:00Z`);
  const toMs = Date.parse(`${to}T00:00:00Z`);
  return Math.max(1, Math.round((toMs - fromMs) / 86_400_000) + 1);
}

function defaultFromDate(to: string, days: number): string {
  const date = new Date(`${to}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

// One approved day per equipment-day: a matched pair approves two reconciliations, and only one carries the billed figures.
async function approvedDays(tx: Tx, where: SQL | undefined) {
  const rows = await tx
    .select({ equipmentId: edtr.equipmentId, reportDate: edtr.reportDate, adjustments: edtrReconciliations.adjustments, item: edtrLineItems })
    .from(edtr)
    .innerJoin(edtrReconciliations, eq(edtrReconciliations.edtrId, edtr.id))
    .leftJoin(edtrLineItems, eq(edtrLineItems.edtrId, edtr.id))
    .where(and(eq(edtrReconciliations.status, 'approved'), where));
  const billed = (row: (typeof rows)[number]) => !!(row.adjustments as { billed?: unknown } | null)?.billed;
  const byDay = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    const key = `${row.equipmentId}|${row.reportDate}`;
    const kept = byDay.get(key);
    if (!kept || (!billed(kept) && billed(row))) byDay.set(key, row);
  }
  return [...byDay.values()].flatMap((row) => {
    const hours: ApprovedDayHours | null = approvedHours(row, row.item ?? undefined);
    return hours ? [{ equipmentId: row.equipmentId, reportDate: row.reportDate, hours }] : [];
  });
}

@Injectable()
export class FleetService {
  constructor(private readonly events: EventsService) {}

  async list(ctx: RequestContext, query: EquipmentListQuery): Promise<EquipmentListResponse> {
    return withTenantTx(ctx, async (tx) => {
      // Retired units leave the list but are never deleted, so history stays readable by id.
      // Priced: a rate card in force for the unit or, failing that, its category.
      const priced = sql`exists (
        select 1 from rate_cards r
        where r.tenant_id = ${equipment.tenantId}
          and (r.equipment_id = ${equipment.id} or (r.equipment_id is null and r.equipment_type_id = ${equipment.equipmentTypeId}))
          and r.effective_from <= now() and (r.effective_to is null or r.effective_to > now())
      )`;
      const search = query.q ? `%${query.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
      // Every filter but the category, so each category count answers "how many if I picked this".
      const base = and(
        isNull(equipment.retiredAt),
        query.status ? eq(equipment.availabilityStatus, query.status) : undefined,
        search
          ? or(ilike(equipment.model, search), ilike(equipment.modelNumber, search), ilike(equipment.serialNo, search))
          : undefined,
        query.missing === 'photo' ? and(isNull(equipment.photoUri), isNull(equipment.photoCredit)) : undefined,
        query.missing === 'price' ? sql`not ${priced}` : undefined,
      );
      const where = and(base, query.typeId ? eq(equipment.equipmentTypeId, query.typeId) : undefined);
      const rows = await tx
        .select({ unit: equipment, typeName: equipmentTypes.name })
        .from(equipment)
        .innerJoin(equipmentTypes, eq(equipmentTypes.id, equipment.equipmentTypeId))
        .where(where)
        .orderBy(asc(equipmentTypes.name), desc(equipment.createdAt))
        .limit(query.limit)
        .offset(query.offset);
      const total = await countRows(tx, equipment, where);
      const categories = await tx
        .select({ equipmentTypeId: equipmentTypes.id, name: equipmentTypes.name, count: count() })
        .from(equipment)
        .innerJoin(equipmentTypes, eq(equipmentTypes.id, equipment.equipmentTypeId))
        .where(base)
        .groupBy(equipmentTypes.id, equipmentTypes.name)
        .orderBy(asc(equipmentTypes.name));
      return {
        items: rows.map(({ unit, typeName }) => ({ ...toEquipmentResponse(unit), equipmentTypeName: typeName })),
        total,
        categories,
      };
    });
  }

  async create(ctx: RequestContext, body: EquipmentCreateRequest): Promise<EquipmentResponse> {
    return withTenantTx(ctx, async (tx) => {
      const existing = await tx
        .select()
        .from(equipment)
        .where(and(eq(equipment.tenantId, ctx.tenantId), eq(equipment.serialNo, body.serialNo)));
      if (existing.length > 0) {
        throw new ConflictException({ error: 'serial_no_taken', serialNo: body.serialNo });
      }

      const [created] = await tx
        .insert(equipment)
        .values({
          tenantId: ctx.tenantId,
          equipmentTypeId: body.equipmentTypeId,
          model: body.model,
          serialNo: body.serialNo,
          availabilityStatus: body.availabilityStatus,
          ...specFieldPatch(body),
        })
        .returning();
      if (!created) throw new Error('equipment insert returned no row');

      await tx.insert(auditLogs).values({
        tenantId: ctx.tenantId,
        actorId: ctx.userId,
        action: 'CREATE',
        entity: 'equipment',
        entityId: created.id,
      });
      await this.events.emit(ctx, 'equipment_registered', { equipment_id: created.id });

      return toEquipmentResponse(created);
    });
  }

  // Refuses `deployed` when the unit is already deployed or maintenance-flagged.
  async update(
    ctx: RequestContext,
    equipmentId: string,
    body: EquipmentUpdateRequest,
  ): Promise<EquipmentResponse> {
    return withTenantTx(ctx, async (tx) => {
      const [existing] = await tx
        .select()
        .from(equipment)
        .where(eq(equipment.id, equipmentId))
        .limit(1);
      if (!existing) throw new NotFoundException({ error: 'equipment_not_found' });
      // A retired unit is history: editing it would silently change the DTRs that cite it.
      if (existing.retiredAt) {
        throw new ConflictException({ error: 'equipment_retired', equipmentId });
      }

      if (body.availabilityStatus === 'deployed') {
        if (existing.availabilityStatus === 'deployed') {
          throw new ConflictException({ error: 'equipment_already_deployed', equipmentId });
        }
        const due = await this.isMaintenanceDue(tx, equipmentId, existing.runtimeHours);
        if (due) {
          throw new ConflictException({ error: 'equipment_maintenance_due', equipmentId });
        }
      }

      const [updated] = await tx
        .update(equipment)
        .set({
          ...(body.model !== undefined ? { model: body.model } : {}),
          ...(body.availabilityStatus !== undefined
            ? { availabilityStatus: body.availabilityStatus }
            : {}),
          ...specFieldPatch(body),
        })
        .where(eq(equipment.id, equipmentId))
        .returning();
      if (!updated) throw new Error('equipment update returned no row');

      await tx.insert(auditLogs).values({
        tenantId: ctx.tenantId,
        actorId: ctx.userId,
        action: 'UPDATE',
        entity: 'equipment',
        entityId: equipmentId,
      });

      return toEquipmentResponse(updated);
    });
  }

  // A retire, not a delete: edtr rows cite equipment_id as invoice evidence, and 0026 REVOKEs DELETE.
  async retire(ctx: RequestContext, equipmentId: string): Promise<EquipmentRetireResponse> {
    return withTenantTx(ctx, async (tx) => {
      const [existing] = await tx
        .select()
        .from(equipment)
        .where(eq(equipment.id, equipmentId))
        .limit(1);
      if (!existing) throw new NotFoundException({ error: 'equipment_not_found' });
      if (existing.retiredAt) {
        throw new ConflictException({ error: 'equipment_already_retired', equipmentId });
      }
      // A deployed machine is still out there accruing hours; retiring it would drop it from the fleet list.
      if (existing.availabilityStatus === 'deployed') {
        throw new ConflictException({ error: 'equipment_deployed', equipmentId });
      }

      await tx
        .update(equipment)
        .set({ retiredAt: new Date() })
        .where(eq(equipment.id, equipmentId));

      await tx.insert(auditLogs).values({
        tenantId: ctx.tenantId,
        actorId: ctx.userId,
        // 'DELETE' so the audit trail reads with every other row; the retire implements the delete verb.
        action: 'DELETE',
        entity: 'equipment',
        entityId: equipmentId,
      });

      return { id: equipmentId, retired: true as const };
    });
  }

  async setPhoto(ctx: RequestContext, equipmentId: string, key: string): Promise<EquipmentResponse> {
    return withTenantTx(ctx, async (tx) => {
      const [updated] = await tx
        .update(equipment)
        .set({ photoUri: key })
        .where(and(eq(equipment.id, equipmentId), isNull(equipment.retiredAt)))
        .returning();
      if (!updated) throw new NotFoundException({ error: 'equipment_not_found' });
      return toEquipmentResponse(updated);
    });
  }

  async maintenanceDetail(
    ctx: RequestContext,
    equipmentId: string,
  ): Promise<MaintenanceDetailResponse> {
    return withTenantTx(ctx, async (tx) => {
      const [row] = await tx.select().from(equipment).where(eq(equipment.id, equipmentId)).limit(1);
      if (!row) throw new NotFoundException({ error: 'equipment_not_found' });

      const schedule = await this.currentSchedule(tx, equipmentId);
      const schedules = await tx
        .select()
        .from(maintenanceSchedules)
        .where(eq(maintenanceSchedules.equipmentId, equipmentId))
        .orderBy(maintenanceSchedules.createdAt);
      const runtime = Number(row.runtimeHours);
      const logs = await tx
        .select()
        .from(maintenanceLogs)
        .where(eq(maintenanceLogs.equipmentId, equipmentId))
        .orderBy(desc(maintenanceLogs.performedAt));
      const windows = await tx
        .select()
        .from(maintenanceWindows)
        .where(eq(maintenanceWindows.equipmentId, equipmentId))
        .orderBy(maintenanceWindows.startsAt);

      return {
        schedule: schedule
          ? {
              hoursInterval: Number(schedule.hoursInterval),
              nextDue: schedule.nextDue !== null ? Number(schedule.nextDue) : null,
            }
          : null,
        runtimeHours: runtime,
        schedules: schedules.map((s) => ({
          id: s.id,
          task: s.task,
          hoursInterval: Number(s.hoursInterval),
          nextDue: s.nextDue !== null ? Number(s.nextDue) : null,
          hoursSinceService:
            s.nextDue !== null
              ? round2HalfUp(runtime - (Number(s.nextDue) - Number(s.hoursInterval)))
              : null,
        })),
        logs: logs.map((log) => ({
          id: log.id,
          performedAt: log.performedAt,
          notes: log.notes,
          scheduleId: log.scheduleId,
        })),
        windows: windows.map((w) => ({ id: w.id, startsAt: w.startsAt, endsAt: w.endsAt, notes: w.notes })),
      };
    });
  }

  // Advances an EXISTING schedule's countdown so the PM cron stops re-firing; the cron never mutates state itself.
  async recordMaintenanceLog(
    ctx: RequestContext,
    equipmentId: string,
    body: MaintenanceLogCreateRequest,
  ) {
    return withTenantTx(ctx, async (tx) => {
      const [row] = await tx.select().from(equipment).where(eq(equipment.id, equipmentId)).limit(1);
      if (!row) throw new NotFoundException({ error: 'equipment_not_found' });

      // A named schedule must belong to this unit; RLS already scopes tenant.
      const schedule = body.scheduleId
        ? ((
            await tx
              .select()
              .from(maintenanceSchedules)
              .where(
                and(
                  eq(maintenanceSchedules.id, body.scheduleId),
                  eq(maintenanceSchedules.equipmentId, equipmentId),
                ),
              )
              .limit(1)
          )[0] ?? null)
        : await this.currentSchedule(tx, equipmentId);
      if (body.scheduleId && !schedule) {
        throw new NotFoundException({ error: 'maintenance_schedule_not_found' });
      }

      const [created] = await tx
        .insert(maintenanceLogs)
        .values({
          tenantId: ctx.tenantId,
          equipmentId,
          scheduleId: schedule?.id ?? null,
          performedAt: new Date(body.performedAt),
          notes: body.notes ?? null,
        })
        .returning();
      if (!created) throw new Error('maintenance_logs insert returned no row');

      if (schedule) {
        const nextDue = round2HalfUp(Number(row.runtimeHours) + Number(schedule.hoursInterval));
        await tx
          .update(maintenanceSchedules)
          .set({ nextDue: String(nextDue) })
          .where(eq(maintenanceSchedules.id, schedule.id));
      }

      await tx.insert(auditLogs).values({
        tenantId: ctx.tenantId,
        actorId: ctx.userId,
        action: 'CREATE',
        entity: 'maintenance_logs',
        entityId: created.id,
      });
      await this.events.emit(ctx, 'maintenance_log_recorded', {
        equipment_id: equipmentId,
        maintenance_log_id: created.id,
      });

      return { id: created.id, equipmentId, performedAt: created.performedAt };
    });
  }

  async createSchedule(
    ctx: RequestContext,
    equipmentId: string,
    body: MaintenanceScheduleCreateRequest,
  ) {
    return withTenantTx(ctx, async (tx) => {
      const [row] = await tx.select().from(equipment).where(eq(equipment.id, equipmentId)).limit(1);
      if (!row) throw new NotFoundException({ error: 'equipment_not_found' });

      const [created] = await tx
        .insert(maintenanceSchedules)
        .values({
          tenantId: ctx.tenantId,
          equipmentId,
          task: body.task,
          hoursInterval: String(body.hoursInterval),
          nextDue: String(round2HalfUp(Number(row.runtimeHours) + body.hoursInterval)),
        })
        .returning();
      if (!created) throw new Error('maintenance_schedules insert returned no row');

      await tx.insert(auditLogs).values({
        tenantId: ctx.tenantId,
        actorId: ctx.userId,
        action: 'CREATE',
        entity: 'maintenance_schedules',
        entityId: created.id,
      });
      return { id: created.id, task: created.task, hoursInterval: body.hoursInterval };
    });
  }

  async createMaintenanceWindow(ctx: RequestContext, equipmentId: string, body: MaintenanceWindowCreateRequest) {
    return withTenantTx(ctx, async (tx) => {
      const [row] = await tx.select().from(equipment).where(eq(equipment.id, equipmentId)).limit(1);
      if (!row) throw new NotFoundException({ error: 'equipment_not_found' });
      const [created] = await tx
        .insert(maintenanceWindows)
        .values({
          tenantId: ctx.tenantId,
          equipmentId,
          startsAt: new Date(body.startsAt),
          endsAt: new Date(body.endsAt),
          notes: body.notes || null,
        })
        .returning();
      if (!created) throw new Error('maintenance_windows insert returned no row');
      await tx.insert(auditLogs).values({
        tenantId: ctx.tenantId,
        actorId: ctx.userId,
        action: 'CREATE',
        entity: 'maintenance_windows',
        entityId: created.id,
      });
      return { id: created.id };
    });
  }

  // Past service logs stay (history) and just lose their link to the schedule.
  async deleteSchedule(ctx: RequestContext, equipmentId: string, scheduleId: string) {
    return withTenantTx(ctx, async (tx) => {
      const [existing] = await tx
        .select()
        .from(maintenanceSchedules)
        .where(and(eq(maintenanceSchedules.id, scheduleId), eq(maintenanceSchedules.equipmentId, equipmentId)))
        .limit(1);
      if (!existing) throw new NotFoundException({ error: 'maintenance_schedule_not_found' });
      await tx.update(maintenanceLogs).set({ scheduleId: null }).where(eq(maintenanceLogs.scheduleId, scheduleId));
      await tx.delete(maintenanceSchedules).where(eq(maintenanceSchedules.id, scheduleId));
      await tx.insert(auditLogs).values({
        tenantId: ctx.tenantId,
        actorId: ctx.userId,
        action: 'DELETE',
        entity: 'maintenance_schedules',
        entityId: scheduleId,
        reason: existing.task ?? 'general service',
      });
      return { id: scheduleId };
    });
  }

  async extendMaintenanceWindow(ctx: RequestContext, equipmentId: string, windowId: string, body: MaintenanceWindowExtendRequest) {
    return withTenantTx(ctx, async (tx) => {
      const [existing] = await tx
        .select()
        .from(maintenanceWindows)
        .where(and(eq(maintenanceWindows.id, windowId), eq(maintenanceWindows.equipmentId, equipmentId)))
        .limit(1);
      if (!existing) throw new NotFoundException({ error: 'maintenance_window_not_found' });
      const endsAt = new Date(body.endsAt);
      if (endsAt <= existing.startsAt) throw new ConflictException({ error: 'ends_before_start' });
      await tx.update(maintenanceWindows).set({ endsAt }).where(eq(maintenanceWindows.id, windowId));
      await tx.insert(auditLogs).values({
        tenantId: ctx.tenantId,
        actorId: ctx.userId,
        action: 'UPDATE',
        entity: 'maintenance_windows',
        entityId: windowId,
        reason: `ends ${existing.endsAt.toISOString()} -> ${endsAt.toISOString()}`,
      });
      return { id: windowId, endsAt: endsAt.toISOString() };
    });
  }

  async windowsEndingSoon(ctx: RequestContext): Promise<MaintenanceWindowEndingSoon[]> {
    return withTenantTx(ctx, async (tx) => {
      const now = new Date();
      const soon = new Date(now.getTime() + 2 * 86_400_000);
      const rows = await tx
        .select({ windowId: maintenanceWindows.id, equipmentId: equipment.id, model: equipment.model, serialNo: equipment.serialNo, endsAt: maintenanceWindows.endsAt })
        .from(maintenanceWindows)
        .innerJoin(equipment, eq(equipment.id, maintenanceWindows.equipmentId))
        .where(and(gt(maintenanceWindows.endsAt, now), lte(maintenanceWindows.endsAt, soon), lte(maintenanceWindows.startsAt, soon)))
        .orderBy(maintenanceWindows.endsAt);
      return rows.map((row) => ({ ...row, endsAt: row.endsAt.toISOString() }));
    });
  }

  async report(ctx: RequestContext, equipmentId: string): Promise<EquipmentReportResponse> {
    return withTenantTx(ctx, async (tx) => {
      const [unit] = await tx.select().from(equipment).where(eq(equipment.id, equipmentId)).limit(1);
      if (!unit) throw new NotFoundException({ error: 'equipment_not_found' });

      const days = await approvedDays(tx, eq(edtr.equipmentId, equipmentId));
      const [params] = await tx.select({ fuel: pricingParameters.fuelLPerHour }).from(pricingParameters).orderBy(desc(pricingParameters.effectiveFrom)).limit(1);
      const fuel = params ? Number(params.fuel) : null;
      const litres = (hours: number) => (fuel === null ? null : round2HalfUp(hours * fuel));

      const byMonth = new Map<string, number>();
      for (const day of days) {
        const key = day.reportDate.slice(0, 7);
        byMonth.set(key, (byMonth.get(key) ?? 0) + day.hours.running);
      }
      const months: EquipmentReportResponse['months'] = [];
      // Manila's current month, not the server's: report dates are Manila days.
      const [year, month] = manilaDate(new Date()).split('-').map(Number) as [number, number];
      for (let i = 5; i >= 0; i--) {
        const d = new Date(Date.UTC(year, month - 1 - i, 1));
        const key = d.toISOString().slice(0, 7);
        const hours = round2HalfUp(byMonth.get(key) ?? 0);
        months.push({ month: key, hours, fuelLitres: litres(hours) });
      }

      const assignments = await tx
        .select({ rentalId: rentals.id, companyName: customers.companyName, start: equipmentAssignments.start, end: equipmentAssignments.end, status: rentals.status })
        .from(equipmentAssignments)
        .innerJoin(rentals, eq(rentals.id, equipmentAssignments.rentalId))
        .leftJoin(customers, eq(customers.id, rentals.customerId))
        .where(and(eq(equipmentAssignments.equipmentId, equipmentId), ne(equipmentAssignments.status, 'cancelled')))
        .orderBy(desc(equipmentAssignments.start));
      const rentalIds = assignments.map((a) => a.rentalId);
      const quoteLines = rentalIds.length
        ? await tx
            .select({ rentalId: quotations.rentalId, subtotal: quotationItems.subtotalPhp, quantity: quotationItems.quantity })
            .from(quotationItems)
            .innerJoin(quotations, eq(quotations.id, quotationItems.quotationId))
            .where(and(inArray(quotations.rentalId, rentalIds), eq(quotations.status, 'accepted'), eq(quotationItems.equipmentTypeId, unit.equipmentTypeId)))
        : [];
      const revenueFor = (rentalId: string) => {
        const line = quoteLines.find((q) => q.rentalId === rentalId);
        return line ? round2HalfUp(Number(line.subtotal) / Math.max(1, line.quantity)) : null;
      };
      const rentalRows = assignments.map((a) => ({
        rentalId: a.rentalId,
        companyName: a.companyName,
        start: a.start.toISOString(),
        end: a.end?.toISOString() ?? null,
        status: a.status,
        revenuePhp: revenueFor(a.rentalId),
      }));

      const logs = await tx
        .select({ performedAt: maintenanceLogs.performedAt, notes: maintenanceLogs.notes, task: maintenanceSchedules.task })
        .from(maintenanceLogs)
        .leftJoin(maintenanceSchedules, eq(maintenanceSchedules.id, maintenanceLogs.scheduleId))
        .where(eq(maintenanceLogs.equipmentId, equipmentId))
        .orderBy(desc(maintenanceLogs.performedAt));
      const windows = await tx.select().from(maintenanceWindows).where(eq(maintenanceWindows.equipmentId, equipmentId)).orderBy(desc(maintenanceWindows.startsAt)).limit(10);
      const now = new Date();

      const count = async (name: string) => {
        const [row] = await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(events)
          .where(and(eq(events.name, name), sql`${events.properties} ->> 'equipment_id' = ${equipmentId}`));
        return row?.n ?? 0;
      };

      const totalHours = round2HalfUp(days.reduce((sum, day) => sum + day.hours.running, 0));
      return {
        equipmentId,
        model: unit.model,
        serialNo: unit.serialNo,
        runtimeHours: Number(unit.runtimeHours),
        fuelLPerHour: fuel,
        months,
        totals: {
          hours: totalHours,
          fuelLitres: litres(totalHours),
          rentals: rentalRows.length,
          revenuePhp: round2HalfUp(rentalRows.reduce((sum, row) => sum + (row.revenuePhp ?? 0), 0)),
        },
        rentals: rentalRows.slice(0, 10),
        maintenance: {
          services: logs.length,
          lastServiceAt: logs[0]?.performedAt.toISOString() ?? null,
          recent: logs.slice(0, 5).map((log) => ({ performedAt: log.performedAt.toISOString(), task: log.task, notes: log.notes })),
          blocks: windows.map((w) => ({ startsAt: w.startsAt.toISOString(), endsAt: w.endsAt.toISOString(), notes: w.notes, current: w.startsAt <= now && w.endsAt > now })),
        },
        weather: { warnings: await count('equipment_weather_warning'), usedDespiteWarning: await count('equipment_used_despite_warning') },
      };
    });
  }

  async deleteMaintenanceWindow(ctx: RequestContext, equipmentId: string, windowId: string) {
    return withTenantTx(ctx, async (tx) => {
      const [deleted] = await tx
        .delete(maintenanceWindows)
        .where(and(eq(maintenanceWindows.id, windowId), eq(maintenanceWindows.equipmentId, equipmentId)))
        .returning();
      if (!deleted) throw new NotFoundException({ error: 'maintenance_window_not_found' });
      await tx.insert(auditLogs).values({
        tenantId: ctx.tenantId,
        actorId: ctx.userId,
        action: 'DELETE',
        entity: 'maintenance_windows',
        entityId: windowId,
      });
      return { id: windowId };
    });
  }

  // POST /bookings re-checks at write time.
  async availability(ctx: RequestContext, equipmentId: string, query: AvailabilityQuery): Promise<AvailabilityResponse> {
    return withTenantTx(ctx, async (tx) => {
      const [row] = await tx.select({ id: equipment.id }).from(equipment).where(eq(equipment.id, equipmentId)).limit(1);
      if (!row) throw new NotFoundException({ error: 'equipment_not_found' });
      const { dailyHours, minHours } = await getBillingSettings(tx, ctx.tenantId);
      return { ...(await dayAvailability(tx, equipmentId, query.from, query.to)), dailyHours, minHours };
    });
  }

  getCalendar(ctx: RequestContext): Promise<TenantCalendar | null> {
    return withTenantTx(ctx, (tx) => readCalendar(tx));
  }

  async saveCalendar(ctx: RequestContext, body: TenantCalendar): Promise<TenantCalendar> {
    const values = { ...body, updatedAt: new Date() };
    await withTenantTx(ctx, async (tx) => {
      await tx
        .insert(tenantCalendar)
        .values({ tenantId: ctx.tenantId, ...values })
        .onConflictDoUpdate({ target: tenantCalendar.tenantId, set: values });
      await tx.insert(auditLogs).values({
        tenantId: ctx.tenantId,
        actorId: ctx.userId,
        action: 'UPDATE',
        entity: 'tenant_calendar',
        entityId: ctx.tenantId,
      });
    });
    return body;
  }

  async correctRuntime(ctx: RequestContext, equipmentId: string, body: RuntimeCorrectionRequest) {
    return withTenantTx(ctx, async (tx) => {
      const [existing] = await tx
        .select()
        .from(equipment)
        .where(eq(equipment.id, equipmentId))
        .limit(1);
      if (!existing) throw new NotFoundException({ error: 'equipment_not_found' });
      if (existing.retiredAt) {
        throw new ConflictException({ error: 'equipment_retired', equipmentId });
      }

      const [updated] = await tx
        .update(equipment)
        .set({ runtimeHours: String(round2HalfUp(body.runtimeHours)) })
        .where(eq(equipment.id, equipmentId))
        .returning();
      if (!updated) throw new Error('equipment update returned no row');

      await tx.insert(auditLogs).values({
        tenantId: ctx.tenantId,
        actorId: ctx.userId,
        action: 'UPDATE',
        entity: 'equipment_runtime',
        entityId: equipmentId,
        reason: `${Number(existing.runtimeHours)} -> ${body.runtimeHours}: ${body.reason}`,
      });
      return toEquipmentResponse(updated);
    });
  }

  // runtime_hours is the lifetime total; utilization_pct is scoped to the period via edtr line items.
  async utilizationReport(
    ctx: RequestContext,
    query: UtilizationQuery,
  ): Promise<UtilizationReportResponse> {
    const to = query.to ?? manilaDate(new Date());
    const from = query.from ?? defaultFromDate(to, DEFAULT_REPORT_WINDOW_DAYS);

    return withTenantTx(ctx, async (tx) => {
      const equipmentRows = await tx.select().from(equipment);
      const scheduleRows = await tx.select().from(maintenanceSchedules);
      const days = await approvedDays(tx, and(gte(edtr.reportDate, from), lte(edtr.reportDate, to)));

      const runtimeById = new Map(equipmentRows.map((row) => [row.id, Number(row.runtimeHours)]));
      // Due when ANY task schedule is crossed, not just the newest one.
      const dueEquipment = new Set(
        scheduleRows
          .filter(
            (s) => s.nextDue !== null && (runtimeById.get(s.equipmentId) ?? 0) >= Number(s.nextDue),
          )
          .map((s) => s.equipmentId),
      );

      const activeHoursByEquipment = new Map<string, number>();
      for (const day of days) {
        activeHoursByEquipment.set(day.equipmentId, (activeHoursByEquipment.get(day.equipmentId) ?? 0) + day.hours.running);
      }

      const totalPossibleHours = daysBetweenInclusive(from, to) * BUSINESS_HOURS_PER_DAY;

      const fleet = equipmentRows.map((row) => {
        const periodActiveHours = activeHoursByEquipment.get(row.id) ?? 0;
        const maintenanceDue = dueEquipment.has(row.id);
        return {
          equipmentId: row.id,
          runtimeHours: round2HalfUp(Number(row.runtimeHours)),
          utilizationPct:
            totalPossibleHours > 0
              ? round2HalfUp((periodActiveHours / totalPossibleHours) * 100)
              : 0,
          maintenanceDue,
        };
      });

      return { period: { from, to }, fleet };
    });
  }

  async financialReport(
    ctx: RequestContext,
    query: UtilizationQuery,
  ): Promise<FinancialReportResponse> {
    const to = query.to ?? manilaDate(new Date());
    const from = query.from ?? defaultFromDate(to, DEFAULT_REPORT_WINDOW_DAYS);

    return withTenantTx(ctx, async (tx) => {
      const invoiceRows = await tx
        .select()
        .from(invoices)
        .where(
          and(
            gte(invoices.createdAt, new Date(`${from}T00:00:00+08:00`)),
            lt(invoices.createdAt, new Date(new Date(`${to}T00:00:00+08:00`).getTime() + 86_400_000)),
          ),
        );

      const invoiceIds = invoiceRows.map((row) => row.id);
      const paymentRows = invoiceIds.length
        ? await tx.select().from(payments).where(inArray(payments.invoiceId, invoiceIds))
        : [];

      const byType: Record<string, number> = {};
      let invoicedTotal = 0;
      for (const invoice of invoiceRows) {
        const amount = Number(invoice.amount);
        byType[invoice.invoiceType] = round2HalfUp((byType[invoice.invoiceType] ?? 0) + amount);
        invoicedTotal = round2HalfUp(invoicedTotal + amount);
      }
      const paidTotal = round2HalfUp(
        paymentRows
          .filter((payment) => payment.status === 'paid')
          .reduce((sum, payment) => sum + Number(payment.amount), 0),
      );

      return {
        period: { from, to },
        invoiced: { byType, total: invoicedTotal },
        paid: paidTotal,
        depositDeducted: byType['deposit_deduction'] ?? 0,
      };
    });
  }

  async leakageReport(ctx: RequestContext, query: LeakageReportQuery): Promise<LeakageReport> {
    const to = query.to ?? manilaDate(new Date());
    const from = query.from ?? defaultFromDate(to, DEFAULT_REPORT_WINDOW_DAYS);
    const utilization = await this.utilizationReport(ctx, { from, to });
    return buildLeakageReport(ctx, { ...query, from, to }, utilization);
  }

  async leakageReportPdf(ctx: RequestContext, query: LeakageReportQuery): Promise<StatementPdfResponse> {
    const report = await this.leakageReport(ctx, query);
    const bytes = await renderLeakageReportPdf(report, await tenantBrand(ctx));
    return {
      filename: `revenue-leakage-${report.period.from}-to-${report.period.to}.pdf`,
      contentBase64: Buffer.from(bytes).toString('base64'),
    };
  }

  private async currentSchedule(tx: Tx, equipmentId: string) {
    const [schedule] = await tx
      .select()
      .from(maintenanceSchedules)
      .where(eq(maintenanceSchedules.equipmentId, equipmentId))
      .orderBy(desc(maintenanceSchedules.createdAt))
      .limit(1);
    return schedule ?? null;
  }

  private async isMaintenanceDue(
    tx: Tx,
    equipmentId: string,
    runtimeHours: string,
  ): Promise<boolean> {
    // Any task past due blocks deployment, not just the newest schedule.
    const schedules = await tx
      .select({ nextDue: maintenanceSchedules.nextDue })
      .from(maintenanceSchedules)
      .where(eq(maintenanceSchedules.equipmentId, equipmentId));
    return schedules.some((s) => s.nextDue !== null && Number(runtimeHours) >= Number(s.nextDue));
  }
}
