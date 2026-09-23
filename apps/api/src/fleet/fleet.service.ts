import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, gte, inArray, isNull, lte } from 'drizzle-orm';
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
  EquipmentRetireResponse,
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
import { countRows } from '../common/count-rows.js';

// Documented simplification (same category as the deposit-ledger balance
// tracking in edtr.service.ts): the utilization denominator is a standard
// 8-hour construction workday per calendar day in the report period, not
// the unit's actual scheduled availability -- equipment_assignments-based
// scheduling is PRD-F8, not built yet.
const BUSINESS_HOURS_PER_DAY = 8;
const DEFAULT_REPORT_WINDOW_DAYS = 30;

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// Equipment photos live in their own bucket, deliberately not the KYC one:
// that holds RA 10173 personal data under its own retention posture, and a
// machine photo has no business sharing it.
//
// This bucket is public-read, which is a narrower exception than it looks.
// RFC-2 §6 / SDD §7's "never a public URL" is scoped to EDTR and KYC image
// blobs -- evidence and personal data. A photo of a backhoe is neither, and
// the same fleet is already served anonymously by GET /catalog/equipment.
// Keys stay tenant-prefixed and UUID-suffixed so they are not enumerable.
// Recorded in docs/cr-arkilaunch-equipment-crud.md.
function publicPhotoUrl(key: string | null): string | null {
  if (!key) return null;
  const base = process.env.SUPABASE_URL?.replace(/\/$/, '');
  const bucket = process.env.SUPABASE_STORAGE_BUCKET_EQUIPMENT ?? 'equipment-photos';
  // No SUPABASE_URL configured (unit tests, local runs without storage) is
  // not an error: the row simply has no renderable photo.
  if (!base) return null;
  return `${base}/storage/v1/object/public/${bucket}/${key}`;
}

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
    // numeric comes back from postgres as a string; null must stay null
    // rather than becoming Number(null) === 0, which would report an
    // unspecified machine as weighing nothing.
    weightCapacityTons: row.weightCapacityTons === null ? null : Number(row.weightCapacityTons),
    engineType: row.engineType,
    fuelType: row.fuelType,
    notes: row.notes,
    photoUrl: publicPhotoUrl(row.photoUri),
  };
}

// The spec fields shared by create and update. Spread conditionally so a
// PATCH that omits a field leaves it alone rather than nulling it.
type EquipmentSpecFields = {
  modelNumber?: string | undefined;
  yearOfManufacture?: number | undefined;
  weightCapacityTons?: number | undefined;
  engineType?: string | undefined;
  fuelType?: string | undefined;
  notes?: string | undefined;
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
      // Retired units leave the fleet list. They are never deleted (migration
      // 0026), so history -- maintenanceDetail, the utilization and financial
      // reports, every edtr row citing the machine -- stays readable by id.
      const where = and(
        isNull(equipment.retiredAt),
        query.status ? eq(equipment.availabilityStatus, query.status) : undefined,
      );
      const rows = await tx
        .select()
        .from(equipment)
        .where(where)
        .orderBy(desc(equipment.createdAt))
        .limit(query.limit)
        .offset(query.offset);
      // The unpaged count, so the caller can page: rows.length only ever
      // described the page it was handed. Counted in Postgres rather than
      // by pulling every matching row into Node (audit-api-surface.md #9).
      const total = await countRows(tx, equipment, where);
      return { items: rows.map(toEquipmentResponse), total };
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

  // PATCH /api/v1/equipment/:id (addition beyond SDD §4). Refuses a
  // transition to `deployed` when the unit is already deployed or is
  // maintenance-flagged -- the fleet half of QAD-T16. The double-book half
  // (equipment_assignments overlap) belongs to F8 and is not covered here.
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
      // A retired unit is history. Editing one would let a machine that has
      // left the fleet be silently changed under the DTRs that cite it.
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

  // DELETE /api/v1/equipment/:id -- a retire, not a delete.
  //
  // The Figma confirm (293:3256) promises to "remove all associated
  // maintenance and deployment logs". That is exactly what must not happen:
  // edtr rows cite equipment_id as the evidence an invoice was computed from.
  // Migration 0026 REVOKEs DELETE on the table, so this is the only exit.
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
      // The refusal that matters. A machine on a site has a crew and a
      // customer depending on it; retiring it would drop it out of the fleet
      // list while it is still out there accruing hours.
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
        // 'DELETE' rather than 'RETIRE' so the audit trail reads with every
        // other row; the retire is the implementation of the delete verb.
        action: 'DELETE',
        entity: 'equipment',
        entityId: equipmentId,
      });

      return { id: equipmentId, retired: true as const };
    });
  }

  // Records the Storage object key for an equipment photo. The caller has
  // already validated and uploaded the bytes; the key is built from the
  // verified ctx.tenantId, never from request input.
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

  // GET /api/v1/equipment/:id/maintenance (SDD §4).
  async maintenanceDetail(
    ctx: RequestContext,
    equipmentId: string,
  ): Promise<MaintenanceDetailResponse> {
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
          ? {
              hoursInterval: Number(schedule.hoursInterval),
              nextDue: schedule.nextDue !== null ? Number(schedule.nextDue) : null,
            }
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
  async recordMaintenanceLog(
    ctx: RequestContext,
    equipmentId: string,
    body: MaintenanceLogCreateRequest,
  ) {
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

  // GET /api/v1/reports/utilization?from=&to= (SDD §4). `runtime_hours` per
  // unit is the cumulative equipment.runtime_hours column (fed by the
  // approved-EDTR accrual in edtr.service.ts); `utilization_pct` is scoped
  // to the report period via edtr/edtr_line_items, matching the SDD's
  // "aggregates equipment.runtime_hours AND edtr/edtr_line_items over the
  // period" wording -- the two sources answer different questions
  // (lifetime total vs period activity), not the same one twice.
  async utilizationReport(
    ctx: RequestContext,
    query: UtilizationQuery,
  ): Promise<UtilizationReportResponse> {
    const to = query.to ?? new Date().toISOString().slice(0, 10);
    const from = query.from ?? defaultFromDate(to, DEFAULT_REPORT_WINDOW_DAYS);

    return withTenantTx(ctx, async (tx) => {
      const equipmentRows = await tx.select().from(equipment);
      const scheduleRows = await tx.select().from(maintenanceSchedules);
      const hoursRows = await tx
        .select({ equipmentId: edtr.equipmentId, hoursActive: edtrLineItems.hoursActive })
        .from(edtr)
        .innerJoin(edtrLineItems, eq(edtrLineItems.edtrId, edtr.id))
        .where(
          and(eq(edtr.status, 'reconciled'), gte(edtr.reportDate, from), lte(edtr.reportDate, to)),
        );

      const scheduleByEquipment = new Map<string, (typeof scheduleRows)[number]>();
      for (const schedule of scheduleRows) {
        const current = scheduleByEquipment.get(schedule.equipmentId);
        if (!current || schedule.createdAt > current.createdAt)
          scheduleByEquipment.set(schedule.equipmentId, schedule);
      }

      const activeHoursByEquipment = new Map<string, number>();
      for (const row of hoursRows) {
        activeHoursByEquipment.set(
          row.equipmentId,
          (activeHoursByEquipment.get(row.equipmentId) ?? 0) + Number(row.hoursActive),
        );
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

  // GET /api/v1/reports/financial?from=&to= (QAD-T8: "utilization AND
  // financial summaries"; only the utilization half existed before this
  // pass). Aggregates invoices/payments over the period -- read-only, same
  // report:read gate and default 30-day window as utilizationReport.
  async financialReport(
    ctx: RequestContext,
    query: UtilizationQuery,
  ): Promise<FinancialReportResponse> {
    const to = query.to ?? new Date().toISOString().slice(0, 10);
    const from = query.from ?? defaultFromDate(to, DEFAULT_REPORT_WINDOW_DAYS);

    return withTenantTx(ctx, async (tx) => {
      const invoiceRows = await tx
        .select()
        .from(invoices)
        .where(
          and(
            gte(invoices.createdAt, new Date(`${from}T00:00:00Z`)),
            lte(invoices.createdAt, new Date(`${to}T23:59:59.999Z`)),
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
    const schedule = await this.currentSchedule(tx, equipmentId);
    if (!schedule || schedule.nextDue === null) return false;
    return Number(runtimeHours) >= Number(schedule.nextDue);
  }
}
