import { and, eq, inArray, ne } from 'drizzle-orm';
import {
  type Tx,
  depositAccruals,
  edtr,
  edtrLineItems,
  edtrReconciliations,
  equipment,
  equipmentAssignments,
  equipmentTypes,
  invoices,
  rentals,
  users,
} from '@arkilaunch/db';
import {
  round2HalfUp,
  OFFICE_LOG_NOTE,
  classifyHours,
  downtimeDays,
  fieldLogDayStatus,
  manilaDate,
  reportSpan,
  spanDates,
  sumApproved,
  type ApprovedDayHours,
  type FieldLogDay,
  type FieldLogTotals,
  type FieldLogUnit,
  type ReportSpan,
} from '@arkilaunch/shared';


// One read of every field log behind a set of rentals, turned into the
// site hub's day x unit grid and the booking rollup
// (cr-arkilaunch-edtr-site-hub-approval.md). Runs in the caller's tenant
// transaction, so RLS scopes every query. Totals count APPROVED days only.

const num = (v: string | null) => (v === null ? null : Number(v));

export function personName(u: { firstName: string | null; lastName: string | null; email: string } | undefined) {
  if (!u) return null;
  const name = [u.firstName, u.lastName].filter(Boolean).join(' ').trim();
  return name || u.email;
}

// A unit's live span on one rental: its assignment window(s), else the
// rental's own dates. Read at request time, so an approved extension (which
// moves the end date) widens it with no stored copy.
export async function unitReportSpan(
  tx: Tx,
  rental: { id: string; startDate: Date; endDate: Date | null },
  equipmentId: string,
): Promise<ReportSpan> {
  const rows = await tx
    .select({ start: equipmentAssignments.start, end: equipmentAssignments.end })
    .from(equipmentAssignments)
    .where(
      and(
        eq(equipmentAssignments.rentalId, rental.id),
        eq(equipmentAssignments.equipmentId, equipmentId),
        ne(equipmentAssignments.status, 'cancelled'),
      ),
    );
  if (rows.length === 0) return reportSpan(rental.startDate, rental.endDate);
  return mergeSpans(rows);
}

function mergeSpans(rows: { start: Date; end: Date | null }[]): ReportSpan {
  const start = new Date(Math.min(...rows.map((r) => r.start.getTime())));
  const end = rows.some((r) => r.end === null) ? null : new Date(Math.max(...rows.map((r) => r.end!.getTime())));
  return reportSpan(start, end);
}

// The figures an approved day was billed on. approve() stores them on the
// reconciliation it approves (adjustments.billed); a day approved before
// that falls back to its line item through classifyHours, the same rule.
function approvedHours(
  recon: { adjustments: unknown },
  item: typeof edtrLineItems.$inferSelect | undefined,
): ApprovedDayHours | null {
  const billed = (recon.adjustments as { billed?: ApprovedDayHours } | null)?.billed;
  if (billed) return billed;
  if (!item) return null;
  const c = classifyHours({
    running: Number(item.hoursActive),
    idle: num(item.hoursIdle),
    breakdown: num(item.hoursBreakdown),
    weather: num(item.hoursWeather),
    otherDowntime: num(item.hoursOtherDowntime),
  });
  return {
    running: c.running,
    billable: c.billable,
    idle: c.idle,
    breakdown: c.breakdown,
    weather: c.weather,
    otherDowntime: c.otherDowntime,
  };
}

export interface LoadedFieldLogs {
  units: FieldLogUnit[];
  days: FieldLogDay[];
  totals: FieldLogTotals;
  billedPhp: number;
}

export async function loadFieldLogs(tx: Tx, rentalIds: string[], today = manilaDate(new Date())): Promise<LoadedFieldLogs> {
  const empty: LoadedFieldLogs = {
    units: [],
    days: [],
    totals: { ...sumApproved([]), daysApproved: 0, daysInSpan: 0, pending: 0, downtimeDays: 0 },
    billedPhp: 0,
  };
  if (rentalIds.length === 0) return empty;

  const assignmentRows = await tx
    .select({
      rentalId: equipmentAssignments.rentalId,
      equipmentId: equipmentAssignments.equipmentId,
      start: equipmentAssignments.start,
      end: equipmentAssignments.end,
      operatorUserId: equipmentAssignments.operatorUserId,
      status: equipmentAssignments.status,
      availabilityStatus: equipment.availabilityStatus,
      code: rentals.code,
      model: equipment.model,
      serialNo: equipment.serialNo,
      runtimeHours: equipment.runtimeHours,
      typeName: equipmentTypes.name,
    })
    .from(equipmentAssignments)
    .innerJoin(rentals, eq(rentals.id, equipmentAssignments.rentalId))
    .innerJoin(equipment, eq(equipment.id, equipmentAssignments.equipmentId))
    .innerJoin(equipmentTypes, eq(equipmentTypes.id, equipment.equipmentTypeId))
    .where(and(inArray(equipmentAssignments.rentalId, rentalIds), ne(equipmentAssignments.status, 'cancelled')));

  const logRows = await tx.select().from(edtr).where(inArray(edtr.rentalId, rentalIds));
  const logIds = logRows.map((r) => r.id);
  const [recons, items] = logIds.length
    ? await Promise.all([
        tx.select().from(edtrReconciliations).where(inArray(edtrReconciliations.edtrId, logIds)),
        tx.select().from(edtrLineItems).where(inArray(edtrLineItems.edtrId, logIds)),
      ])
    : [[], []];
  const reconByEdtr = new Map(recons.map((r) => [r.edtrId, r]));
  const itemByEdtr = new Map(items.map((i) => [i.edtrId, i]));

  const userIds = [
    ...new Set(
      [...logRows.map((r) => r.submittedBy), ...assignmentRows.map((a) => a.operatorUserId)].filter(
        (id): id is string => !!id,
      ),
    ),
  ];
  const people = userIds.length
    ? await tx
        .select({ id: users.id, firstName: users.firstName, lastName: users.lastName, email: users.email })
        .from(users)
        .where(inArray(users.id, userIds))
    : [];
  const personById = new Map(people.map((p) => [p.id, p]));

  // One unit per (rental, equipment); several assignments merge into one span.
  const unitMap = new Map<string, { rows: typeof assignmentRows }>();
  for (const a of assignmentRows) {
    const key = `${a.rentalId}|${a.equipmentId}`;
    const entry = unitMap.get(key) ?? { rows: [] };
    entry.rows.push(a);
    unitMap.set(key, entry);
  }

  const logsByKey = new Map<string, typeof logRows>();
  for (const r of logRows) {
    const key = `${r.rentalId}|${r.equipmentId}|${r.reportDate}`;
    logsByKey.set(key, [...(logsByKey.get(key) ?? []), r]);
  }

  const units: FieldLogUnit[] = [];
  const days: FieldLogDay[] = [];
  const approved: ApprovedDayHours[] = [];
  let daysInSpan = 0;

  for (const { rows } of unitMap.values()) {
    const first = rows[0]!;
    const span = mergeSpans(rows);
    const operator = rows.find((r) => r.operatorUserId)?.operatorUserId;
    let lastMeter: number | null = null;

    const dates = spanDates(span, today);
    daysInSpan += dates.length;
    for (const date of dates) {
      const dayLogs = logsByKey.get(`${first.rentalId}|${first.equipmentId}|${date}`) ?? [];
      const described = dayLogs.map((log) => {
        const recon = reconByEdtr.get(log.id);
        const item = itemByEdtr.get(log.id);
        return { log, recon, item, isOfficeLog: item?.notes === OFFICE_LOG_NOTE };
      });
      const status = fieldLogDayStatus(
        described.map((d) => ({
          createdAt: d.log.createdAt.toISOString(),
          reconStatus: d.recon?.status ?? null,
          correctionRequested: !!(d.recon?.adjustments as { correction_requested?: boolean } | null)?.correction_requested,
          isOfficeLog: d.isOfficeLog,
        })),
      );

      let hours: ApprovedDayHours | null = null;
      if (status === 'approved') {
        // Prefer the reconciliation approve() wrote its billed figures to.
        const approvedRows = described.filter((d) => d.recon?.status === 'approved');
        const withBilled = approvedRows.find((d) => (d.recon!.adjustments as { billed?: unknown } | null)?.billed);
        const pick = withBilled ?? approvedRows.find((d) => !d.isOfficeLog) ?? approvedRows[0];
        hours = pick ? approvedHours(pick.recon!, pick.item) : null;
        if (hours) approved.push(hours);
        const meter = approvedRows.map((d) => num(d.item?.hourMeterEnd ?? null)).find((m) => m !== null);
        if (meter != null) lastMeter = meter;
      }

      const latest = described
        .filter((d) => !d.isOfficeLog)
        .sort((a, b) => b.log.createdAt.getTime() - a.log.createdAt.getTime())[0];
      days.push({
        date,
        equipmentId: first.equipmentId,
        status,
        hours,
        edtrId: latest?.log.id ?? null,
        flags: latest?.item?.reviewFlags ?? [],
        submittedBy: personName(latest?.log.submittedBy ? personById.get(latest.log.submittedBy) : undefined),
        reason:
          (latest?.recon?.adjustments as { rejectionReason?: string | null } | null)?.rejectionReason ?? null,
      });
    }

    units.push({
      equipmentId: first.equipmentId,
      name: `${first.typeName} · ${first.model}`,
      serialNo: first.serialNo,
      rentalId: first.rentalId,
      bookingCode: first.code,
      span,
      operatorName: personName(operator ? personById.get(operator) : undefined),
      runtimeHours: Number(first.runtimeHours),
      lastMeterReading: lastMeter,
      // Delivered; the legacy site-deployment path leaves the assignment
      // 'scheduled' but marks the unit deployed.
      onSite: rows.some((r) => r.status === 'active' || (r.status === 'scheduled' && r.availabilityStatus === 'deployed' && r.start <= new Date())),
      returned: rows.every((r) => r.status === 'completed'),
    });
  }

  const [deducted, accrued] = await Promise.all([
    tx
      .select({ amount: invoices.amount })
      .from(invoices)
      .where(and(inArray(invoices.rentalId, rentalIds), eq(invoices.invoiceType, 'deposit_deduction'))),
    tx.select({ amount: depositAccruals.amount }).from(depositAccruals).where(inArray(depositAccruals.rentalId, rentalIds)),
  ]);
  const billedPhp =
    round2HalfUp([...deducted, ...accrued].reduce((sum, row) => sum + Number(row.amount), 0));

  return {
    units,
    days,
    totals: {
      ...sumApproved(approved),
      daysApproved: approved.length,
      daysInSpan,
      pending: days.filter((d) => d.status === 'pending').length,
      downtimeDays: downtimeDays(approved),
    },
    billedPhp,
  };
}
