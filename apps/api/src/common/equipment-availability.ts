import { and, eq, gt, inArray, isNull, lt, or } from 'drizzle-orm';
import { db, equipment, equipmentAssignments } from '@arkilaunch/db';

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

export async function findAvailableAlternatives(
  tx: Tx,
  equipmentTypeId: string,
  window: AvailabilityWindow,
  excludeIds: string[],
): Promise<string[]> {
  const candidates = await tx
    .select()
    .from(equipment)
    .where(and(eq(equipment.equipmentTypeId, equipmentTypeId), eq(equipment.availabilityStatus, 'available')));

  const alternatives: string[] = [];
  for (const candidate of candidates) {
    if (excludeIds.includes(candidate.id)) continue;
    const overlapping = await overlappingAssignments(tx, candidate.id, window);
    if (overlapping.length === 0) alternatives.push(candidate.id);
    if (alternatives.length >= MAX_ALTERNATIVES) break;
  }
  return alternatives;
}
