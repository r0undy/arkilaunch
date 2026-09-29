import { ConflictException } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import { type Tx, equipment, equipmentAssignments, getBillingSettings, rentals } from '@arkilaunch/db';
import { availabilityBlockers } from './equipment-availability.js';


// QA 25: an unpaid request holds its dates for billing_settings.hold_hours,
// restarting when staff send the quote; payment is the hard lock.
export async function holdDeadline(tx: Tx, tenantId: string, from = new Date()): Promise<Date> {
  const { holdHours } = await getBillingSettings(tx, tenantId);
  return new Date(from.getTime() + holdHours * 3_600_000);
}

// Before money moves on a request. A lapsed hold is no error while its
// dates are still free: it re-holds and carries on, so a customer is not
// punished when nobody else wanted the machine. Only a lapsed hold whose
// dates another booking took refuses (409 hold_expired).
export async function renewLapsedHold(tx: Tx, tenantId: string, rentalId: string): Promise<void> {
  const [rental] = await tx
    .select({ status: rentals.status, holdExpiresAt: rentals.holdExpiresAt })
    .from(rentals)
    .where(eq(rentals.id, rentalId))
    .limit(1);
  if (rental?.status !== 'pending' || !rental.holdExpiresAt || rental.holdExpiresAt > new Date()) return;

  const units = await tx
    .select()
    .from(equipmentAssignments)
    .where(and(eq(equipmentAssignments.rentalId, rentalId), eq(equipmentAssignments.status, 'scheduled')));
  // Same lock order as BookingsService.create, so a booking racing for
  // these dates serializes behind this check.
  if (units.length > 0) {
    await tx.select({ id: equipment.id }).from(equipment).where(inArray(equipment.id, units.map((u) => u.equipmentId))).for('update');
  }
  for (const unit of units) {
    const window = { start: unit.start.toISOString(), end: (unit.end ?? unit.start).toISOString() };
    const blockers = await availabilityBlockers(tx, unit.equipmentId, window, { excludeRentalId: rentalId, calendar: null });
    if (blockers.includes('assignment') || blockers.includes('hold')) {
      throw new ConflictException({ error: 'hold_expired', equipmentId: unit.equipmentId });
    }
  }
  await tx.update(rentals).set({ holdExpiresAt: await holdDeadline(tx, tenantId) }).where(eq(rentals.id, rentalId));
}
