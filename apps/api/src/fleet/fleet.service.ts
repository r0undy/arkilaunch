import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, gte, inArray, lte } from 'drizzle-orm';
import {
  auditLogs,
  db,
  edtr,
  edtrLineItems,
  equipment,
  invoices,
  maintenanceLogs,
  maintenanceSchedules,
  payments,
  withTenantTx,
} from '@arkilaunch/db';
import type {
  EquipmentCreateRequest,
  EquipmentListQuery,
  EquipmentListResponse,
  EquipmentResponse,
  EquipmentUpdateRequest,
  FinancialReportResponse,
  MaintenanceDetailResponse,
  MaintenanceLogCreateRequest,
  RequestContext,
  UtilizationQuery,
  UtilizationReportResponse,
} from '@arkilaunch/shared';
import { EventsService } from '../events/events.service.js';
import { round2HalfUp } from '../quotes/pricing-engine.service.js';

// Documented simplification (same category as the deposit-ledger balance
// tracking in edtr.service.ts): the utilization denominator is a standard
// 8-hour construction workday per calendar day in the report period, not
// the unit's actual scheduled availability -- equipment_assignments-based
// scheduling is PRD-F8, not built yet.
const BUSINESS_HOURS_PER_DAY = 8;
const DEFAULT_REPORT_WINDOW_DAYS = 30;

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

function toEquipmentResponse(row: typeof equipment.$inferSelect): EquipmentResponse {
  return {
    id: row.id,
    equipmentTypeId: row.equipmentTypeId,
    model: row.model,
    serialNo: row.serialNo,
    availabilityStatus: row.availabilityStatus,
    runtimeHours: Number(row.runtimeHours),
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

@Injectable()
export class FleetService {
  constructor(private readonly events: EventsService) {}

  // GET /api/v1/equipment?status=... (PRD-F4). Any authenticated tenant
  // member may read the fleet list; RLS is the isolation boundary, same
  // posture as reference/* (no permission gate on a read).
  async list(ctx: RequestContext, query: EquipmentListQuery): Promise<EquipmentListResponse> {
    return withTenantTx(ctx, async (tx) => {
      const rows = query.status
        ? await tx.select().from(equipment).where(eq(equipment.availabilityStatus, query.status))
        : await tx.select().from(equipment);
      return { items: rows.map(toEquipmentResponse), total: rows.length };
    });
  }

  // POST /api/v1/equipment (addition beyond SDD §4; see AGENTS.md §5.1
  // Change Record). fleet:manage-gated at the controller.
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

  // PATCH /api/v1/equipment/:id (addition beyond SDD §4). Refuses a
  // transition to `deployed` when the unit is already deployed or is
  // maintenance-flagged -- the fleet half of QAD-T16. The double-book half
  // (equipment_assignments overlap) belongs to F8 and is not covered here.
  async update(ctx: RequestContext, equipmentId: string, body: EquipmentUpdateRequest): Promise<EquipmentResponse> {
    return withTenantTx(ctx, async (tx) => {
      const [existing] = await tx.select().from(equipment).where(eq(equipment.id, equipmentId)).limit(1);
      if (!existing) throw new NotFoundException({ error: 'equipment_not_found' });

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
          ...(body.availabilityStatus !== undefined ? { availabilityStatus: body.availabilityStatus } : {}),
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

  // GET /api/v1/equipment/:id/maintenance (SDD §4).
  async maintenanceDetail(ctx: RequestContext, equipmentId: string): Promise<MaintenanceDetailResponse> {
    return withTenantTx(ctx, async (tx) => {
      const [row] = await tx.select().from(equipment).where(eq(equipment.id, equipmentId)).limit(1);
      if (!row) throw new NotFoundException({ error: 'equipment_not_found' });

      const schedule = await this.currentSchedule(tx, equipmentId);
      const logs = await tx
        .select()
        .from(maintenanceLogs)
        .where(eq(maintenanceLogs.equipmentId, equipmentId))
        .orderBy(desc(maintenanceLogs.performedAt));

      return {
        schedule: schedule
          ? { hoursInterval: Number(schedule.hoursInterval), nextDue: schedule.nextDue !== null ? Number(schedule.nextDue) : null }
          : null,
        runtimeHours: Number(row.runtimeHours),
        logs: logs.map((log) => ({ id: log.id, performedAt: log.performedAt, notes: log.notes })),
      };
    });
  }

  // POST /api/v1/equipment/:id/maintenance-logs (SDD §4). Recording a log
  // advances the threshold countdown so the PM cron stops re-firing for
  // this unit until it accrues another full interval; this is the human
  // action that closes the notification loop (SDD §4, jobs/src/maintenance-notify.ts
  // never mutates state itself). Only advances an EXISTING schedule row --
  // creating one is out of scope for this pass (a schedule is seeded per
  // unit; see packages/db/src/seed/anchor.ts).
  async recordMaintenanceLog(ctx: RequestContext, equipmentId: string, body: MaintenanceLogCreateRequest) {
    return withTenantTx(ctx, async (tx) => {
      const [row] = await tx.select().from(equipment).where(eq(equipment.id, equipmentId)).limit(1);
      if (!row) throw new NotFoundException({ error: 'equipment_not_found' });

      const [created] = await tx
        .insert(maintenanceLogs)
        .values({
          tenantId: ctx.tenantId,
          equipmentId,
          performedAt: new Date(body.performedAt),
          notes: body.notes ?? null,
        })
        .returning();
      if (!created) throw new Error('maintenance_logs insert returned no row');

      const schedule = await this.currentSchedule(tx, equipmentId);
      if (schedule) {
        const nextDue = round2HalfUp(Number(row.runtimeHours) + Number(schedule.hoursInterval));
        await tx.update(maintenanceSchedules).set({ nextDue: String(nextDue) }).where(eq(maintenanceSchedules.id, schedule.id));
      }

      await tx.insert(auditLogs).values({
        tenantId: ctx.tenantId,
        actorId: ctx.userId,
        action: 'CREATE',
        entity: 'maintenance_logs',
        entityId: created.id,
      });
      await this.events.emit(ctx, 'maintenance_log_recorded', { equipment_id: equipmentId, maintenance_log_id: created.id });

      return { id: created.id, equipmentId, performedAt: created.performedAt };
    });
  }

  // GET /api/v1/reports/utilization?from=&to= (SDD §4). `runtime_hours` per
  // unit is the cumulative equipment.runtime_hours column (fed by the
  // approved-EDTR accrual in edtr.service.ts); `utilization_pct` is scoped
  // to the report period via edtr/edtr_line_items, matching the SDD's
  // "aggregates equipment.runtime_hours AND edtr/edtr_line_items over the
  // period" wording -- the two sources answer different questions
  // (lifetime total vs period activity), not the same one twice.
  async utilizationReport(ctx: RequestContext, query: UtilizationQuery): Promise<UtilizationReportResponse> {
    const to = query.to ?? new Date().toISOString().slice(0, 10);
    const from = query.from ?? defaultFromDate(to, DEFAULT_REPORT_WINDOW_DAYS);

    return withTenantTx(ctx, async (tx) => {
      const equipmentRows = await tx.select().from(equipment);
      const scheduleRows = await tx.select().from(maintenanceSchedules);
      const hoursRows = await tx
        .select({ equipmentId: edtr.equipmentId, hoursActive: edtrLineItems.hoursActive })
        .from(edtr)
        .innerJoin(edtrLineItems, eq(edtrLineItems.edtrId, edtr.id))
        .where(and(eq(edtr.status, 'reconciled'), gte(edtr.reportDate, from), lte(edtr.reportDate, to)));

      const scheduleByEquipment = new Map<string, (typeof scheduleRows)[number]>();
      for (const schedule of scheduleRows) {
        const current = scheduleByEquipment.get(schedule.equipmentId);
        if (!current || schedule.createdAt > current.createdAt) scheduleByEquipment.set(schedule.equipmentId, schedule);
      }

      const activeHoursByEquipment = new Map<string, number>();
      for (const row of hoursRows) {
        activeHoursByEquipment.set(row.equipmentId, (activeHoursByEquipment.get(row.equipmentId) ?? 0) + Number(row.hoursActive));
      }

      const totalPossibleHours = daysBetweenInclusive(from, to) * BUSINESS_HOURS_PER_DAY;

      const fleet = equipmentRows.map((row) => {
        const periodActiveHours = activeHoursByEquipment.get(row.id) ?? 0;
        const schedule = scheduleByEquipment.get(row.id);
        const maintenanceDue =
          schedule?.nextDue != null ? Number(row.runtimeHours) >= Number(schedule.nextDue) : false;
        return {
          equipmentId: row.id,
          runtimeHours: round2HalfUp(Number(row.runtimeHours)),
          utilizationPct: totalPossibleHours > 0 ? round2HalfUp((periodActiveHours / totalPossibleHours) * 100) : 0,
          maintenanceDue,
        };
      });

      return { period: { from, to }, fleet };
    });
  }

  // GET /api/v1/reports/financial?from=&to= (QAD-T8: "utilization AND
  // financial summaries"; only the utilization half existed before this
  // pass). Aggregates invoices/payments over the period -- read-only, same
  // report:read gate and default 30-day window as utilizationReport.
  async financialReport(ctx: RequestContext, query: UtilizationQuery): Promise<FinancialReportResponse> {
    const to = query.to ?? new Date().toISOString().slice(0, 10);
    const from = query.from ?? defaultFromDate(to, DEFAULT_REPORT_WINDOW_DAYS);

    return withTenantTx(ctx, async (tx) => {
      const invoiceRows = await tx
        .select()
        .from(invoices)
        .where(and(gte(invoices.createdAt, new Date(`${from}T00:00:00Z`)), lte(invoices.createdAt, new Date(`${to}T23:59:59.999Z`))));

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
        paymentRows.filter((payment) => payment.status === 'paid').reduce((sum, payment) => sum + Number(payment.amount), 0),
      );

      return {
        period: { from, to },
        invoiced: { byType, total: invoicedTotal },
        paid: paidTotal,
        depositDeducted: byType['deposit_deduction'] ?? 0,
      };
    });
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

  private async isMaintenanceDue(tx: Tx, equipmentId: string, runtimeHours: string): Promise<boolean> {
    const schedule = await this.currentSchedule(tx, equipmentId);
    if (!schedule || schedule.nextDue === null) return false;
    return Number(runtimeHours) >= Number(schedule.nextDue);
  }
}
