import { and, eq, gt, inArray, isNull, lt, ne, or, sql } from 'drizzle-orm';
import { db, equipment, equipmentAssignments, maintenanceWindows, tenantCalendar } from '@arkilaunch/db';
import type { AvailabilityBlocker, AvailabilityResponse, TenantCalendar } from '@arkilaunch/shared';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface AvailabilityWindow {
  start: string;
  end: string;
}

const MAX_ALTERNATIVES = 5;

// Shared by bookings.service.ts (PRD-F8) and sites.service.ts's deployment
// endpoint (PRD-F4): never overbooks a unit, whichever surface is
// scheduling it (QAD-T16, QAD-T21). The caller must lock the candidate
// equipment row with FOR UPDATE before calling this, so a concurrent
// deploy/book on the same unit/window is serialized rather than racing
// past the check.
export async function overlappingAssignments(tx: Tx, equipmentId: string, window: AvailabilityWindow) {
  return tx
    .select()
    .from(equipmentAssignments)
    .where(
      and(
        eq(equipmentAssignments.equipmentId, equipmentId),
        inArray(equipmentAssignments.status, ['scheduled', 'active']),
        lt(equipmentAssignments.start, new Date(window.end)),
        or(isNull(equipmentAssignments.end), gt(equipmentAssignments.end, new Date(window.start))),
      ),
    );
}

// Business hours and blackout dates are Asia/Manila wall clock. The
// Philippines has no DST, so a fixed +08:00 is exact.
const MANILA_OFFSET_MS = 8 * 3_600_000;
const DAY_MS = 86_400_000;
const MAX_DAYS = 92;
const manila = (d: Date) => new Date(d.getTime() + MANILA_OFFSET_MS);
const manilaMidnight = (date: string) => new Date(`${date}T00:00:00+08:00`);

// Pure: why the tenant calendar refuses this window, or null. Pickup (start)
// and return (end) must each fall on an open, non-blackout day inside
// business hours; the days in between are the customer's.
export function calendarBlocker(cal: TenantCalendar | null, window: AvailabilityWindow): AvailabilityBlocker | null {
  if (!cal) return null;
  for (const iso of [window.start, window.end]) {
    const local = manila(new Date(iso)).toISOString();
    const date = local.slice(0, 10);
    if (cal.blackouts.some((b) => b.date === date)) return 'holiday';
    const hm = local.slice(11, 16);
    const dow = manila(new Date(iso)).getUTCDay();
    if (!cal.openDays.includes(dow) || hm < cal.openTime || hm > cal.closeTime) return 'closed';
  }
  return null;
}

export async function readCalendar(tx: Tx): Promise<TenantCalendar | null> {
  const [row] = await tx
    .select()
    .from(tenantCalendar)
    .where(eq(tenantCalendar.tenantId, sql`current_setting('app.current_tenant_id', true)::uuid`))
    .limit(1);
  return row
    ? { openTime: row.openTime, closeTime: row.closeTime, openDays: row.openDays, blackouts: row.blackouts }
    : null;
}

function overlappingMaintenance(tx: Tx, equipmentId: string, window: AvailabilityWindow) {
  return tx
    .select()
    .from(maintenanceWindows)
    .where(
      and(
        eq(maintenanceWindows.equipmentId, equipmentId),
        lt(maintenanceWindows.startsAt, new Date(window.end)),
        gt(maintenanceWindows.endsAt, new Date(window.start)),
      ),
    );
}

// THE availability check: every reason this unit (and operator, when one is
// sent) cannot take this window. Empty = bookable. Same FOR UPDATE caveat as
// overlappingAssignments(). excludeRentalId skips a booking's own holds.
export async function availabilityBlockers(
  tx: Tx,
  equipmentId: string,
  window: AvailabilityWindow,
  opts: {
    operatorUserId?: string | undefined;
    excludeRentalId?: string | undefined;
    calendar?: TenantCalendar | null;
  } = {},
): Promise<AvailabilityBlocker[]> {
  const blockers: AvailabilityBlocker[] = [];
  const holds = (await overlappingAssignments(tx, equipmentId, window)).filter(
    (a) => a.rentalId !== opts.excludeRentalId,
  );
  if (holds.length > 0) blockers.push('assignment');
  if ((await overlappingMaintenance(tx, equipmentId, window)).length > 0) blockers.push('maintenance');
  const calendar = calendarBlocker(opts.calendar !== undefined ? opts.calendar : await readCalendar(tx), window);
  if (calendar) blockers.push(calendar);
  if (opts.operatorUserId) {
    const busy = await tx
      .select({ id: equipmentAssignments.id })
      .from(equipmentAssignments)
      .where(
        and(
          eq(equipmentAssignments.operatorUserId, opts.operatorUserId),
          inArray(equipmentAssignments.status, ['scheduled', 'active']),
          lt(equipmentAssignments.start, new Date(window.end)),
          or(isNull(equipmentAssignments.end), gt(equipmentAssignments.end, new Date(window.start))),
          ...(opts.excludeRentalId ? [ne(equipmentAssignments.rentalId, opts.excludeRentalId)] : []),
        ),
      )
      .limit(1);
    if (busy.length > 0) blockers.push('operator');
  }
  return blockers;
}

// Per-day view for the booking pickers, dates inclusive (Manila). A day is
// taken if any hold or maintenance window touches it.
// ponytail: whole-day granularity; a hold ending 10:00 greys the whole day.
// The server check (availabilityBlockers) still allows the free hours.
export async function dayAvailability(
  tx: Tx,
  equipmentId: string,
  from: string,
  to: string,
): Promise<AvailabilityResponse> {
  const cal = await readCalendar(tx);
  const rangeStart = manilaMidnight(from);
  const days = Math.min(MAX_DAYS, Math.round((manilaMidnight(to).getTime() - rangeStart.getTime()) / DAY_MS) + 1);
  const range = {
    start: rangeStart.toISOString(),
    end: new Date(rangeStart.getTime() + days * DAY_MS).toISOString(),
  };
  const holds = await overlappingAssignments(tx, equipmentId, range);
  const windows = await overlappingMaintenance(tx, equipmentId, range);
  const touches = (s: Date, e: Date | null, dayStart: number) =>
    s.getTime() < dayStart + DAY_MS && (e === null || e.getTime() > dayStart);

  const out: AvailabilityResponse['days'] = [];
  for (let i = 0; i < days; i++) {
    const dayStart = rangeStart.getTime() + i * DAY_MS;
    const local = manila(new Date(dayStart));
    const date = local.toISOString().slice(0, 10);
    let reason: AvailabilityBlocker | null = null;
    if (cal?.blackouts.some((b) => b.date === date)) reason = 'holiday';
    else if (cal && !cal.openDays.includes(local.getUTCDay())) reason = 'closed';
    else if (holds.some((h) => touches(h.start, h.end, dayStart))) reason = 'assignment';
    else if (windows.some((w) => touches(w.startsAt, w.endsAt, dayStart))) reason = 'maintenance';
    out.push({ date, available: reason === null, reason });
  }
  return {
    hours: cal && { openTime: cal.openTime, closeTime: cal.closeTime, openDays: cal.openDays },
    days: out,
  };
}

// Nearest free window of the same length on the same unit, searching a day
// at a time either side of the original start (never into the past).
// ponytail: up to 2x60 sequential checks; fine for a staff click, add a
// free-slot index if this ever runs per customer keystroke.
export async function nearestFreeWindow(
  tx: Tx,
  equipmentId: string,
  window: AvailabilityWindow,
  excludeRentalId: string,
): Promise<AvailabilityWindow | null> {
  const start = new Date(window.start).getTime();
  const length = new Date(window.end).getTime() - start;
  const calendar = await readCalendar(tx);
  for (let d = 1; d <= 60; d++) {
    for (const shift of [d, -d]) {
      const s = start + shift * DAY_MS;
      if (s < Date.now()) continue;
      const candidate = { start: new Date(s).toISOString(), end: new Date(s + length).toISOString() };
      if ((await availabilityBlockers(tx, equipmentId, candidate, { excludeRentalId, calendar })).length === 0) {
        return candidate;
      }
    }
  }
  return null;
}

// Deployed units count: a unit out on a job today can still take a later,
// non-overlapping window. Only 'maintenance' status (or retiring) takes it
// off the road.
export async function findAvailableAlternatives(
  tx: Tx,
  equipmentTypeId: string,
  window: AvailabilityWindow,
  excludeIds: string[],
): Promise<string[]> {
  const candidates = await tx
    .select()
    .from(equipment)
    .where(
      and(
        eq(equipment.equipmentTypeId, equipmentTypeId),
        inArray(equipment.availabilityStatus, ['available', 'deployed']),
        isNull(equipment.retiredAt),
      ),
    );

  const calendar = await readCalendar(tx);
  const alternatives: string[] = [];
  for (const candidate of candidates) {
    if (excludeIds.includes(candidate.id)) continue;
    if ((await availabilityBlockers(tx, candidate.id, window, { calendar })).length === 0) {
      alternatives.push(candidate.id);
    }
    if (alternatives.length >= MAX_ALTERNATIVES) break;
  }
  return alternatives;
}
