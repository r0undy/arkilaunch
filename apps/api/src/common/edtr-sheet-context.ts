import { and, desc, eq, inArray, isNotNull, ne } from 'drizzle-orm';
import {
  type Tx,
  addresses,
  customers,
  edtr,
  edtrLineItems,
  edtrReconciliations,
  edtrSettings,
  equipment,
  equipmentAssignments,
  equipmentTypes,
  projectSites,
  rentals,
  tenants,
  timekeeperSiteAssignments,
  users,
  publicPhotoUrl,
} from '@arkilaunch/db';
import type { EdtrPaperSize, EdtrSheetContext, RequestContext } from '@arkilaunch/shared';
import { personName } from './field-logs.js';

type Rental = typeof rentals.$inferSelect;

// Everything the printed EDTR sheet needs for one booking; the browser draws it.
export async function buildEdtrSheetContext(tx: Tx, tenantId: string, rental: Rental): Promise<EdtrSheetContext> {
  const [customer] = await tx
    .select({ companyName: customers.companyName })
    .from(customers)
    .where(eq(customers.id, rental.customerId))
    .limit(1);
  const [site] = await tx
    .select({ line: addresses.line1, city: addresses.city, province: addresses.province })
    .from(projectSites)
    .leftJoin(addresses, eq(addresses.id, projectSites.addressId))
    .where(eq(projectSites.id, rental.projectSiteId))
    .limit(1);
  const machineRows = await tx
    .select({
      id: equipment.id,
      type: equipmentTypes.name,
      model: equipment.model,
      serialNo: equipment.serialNo,
      start: equipmentAssignments.start,
      end: equipmentAssignments.end,
      operatorUserId: equipmentAssignments.operatorUserId,
    })
    .from(equipmentAssignments)
    .innerJoin(equipment, eq(equipment.id, equipmentAssignments.equipmentId))
    .innerJoin(equipmentTypes, eq(equipmentTypes.id, equipment.equipmentTypeId))
    .where(and(eq(equipmentAssignments.rentalId, rental.id), ne(equipmentAssignments.status, 'cancelled')));
  const operatorIds = machineRows.map((m) => m.operatorUserId).filter((u): u is string => !!u);
  const operators = operatorIds.length
    ? await tx
        .select({ id: users.id, firstName: users.firstName, lastName: users.lastName, email: users.email })
        .from(users)
        .where(inArray(users.id, operatorIds))
    : [];
  const operatorById = new Map(operators.map((o) => [o.id, personName(o)]));
  // The unit's last approved end reading (RLS-scoped).
  const meters = machineRows.length
    ? await tx
        .select({ equipmentId: edtr.equipmentId, end: edtrLineItems.hourMeterEnd, reportDate: edtr.reportDate })
        .from(edtrLineItems)
        .innerJoin(edtr, eq(edtr.id, edtrLineItems.edtrId))
        .innerJoin(edtrReconciliations, eq(edtrReconciliations.edtrId, edtr.id))
        .where(
          and(
            inArray(edtr.equipmentId, machineRows.map((m) => m.id)),
            eq(edtrReconciliations.status, 'approved'),
            isNotNull(edtrLineItems.hourMeterEnd),
          ),
        )
        .orderBy(desc(edtr.reportDate))
    : [];
  const lastMeter = new Map<string, number>();
  for (const m of meters) if (!lastMeter.has(m.equipmentId)) lastMeter.set(m.equipmentId, Number(m.end));
  const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  return {
    rentalId: rental.id,
    chargeTo: customer?.companyName ?? '',
    projectLocation: [site?.line, site?.city, site?.province].filter(Boolean).join(', '),
    equipment: machineRows.map((m) => ({
      id: m.id,
      type: m.type,
      model: m.model,
      serialNo: m.serialNo,
      start: m.start.toISOString(),
      end: m.end?.toISOString() ?? null,
      operatorName: m.operatorUserId ? (operatorById.get(m.operatorUserId) ?? null) : null,
      lastHourMeter: lastMeter.get(m.id) ?? null,
    })),
    bookingCode: rental.code,
    customerName: customer?.companyName ?? '',
    siteRep: rental.siteContact,
    rentalStart: rental.startDate.toISOString(),
    rentalEnd: rental.endDate?.toISOString() ?? null,
    ...(tenant
      ? {
          tenant: {
            name: tenant.legalName,
            address: [tenant.address, tenant.city, tenant.province].filter(Boolean).join(', '),
            contact: [tenant.phone, tenant.contactEmail].filter(Boolean).join(' · '),
            logoUrl: publicPhotoUrl(tenant.logoKey),
          },
        }
      : {}),
  };
}

export async function isAssignedToSite(tx: Tx, ctx: RequestContext, projectSiteId: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: timekeeperSiteAssignments.id })
    .from(timekeeperSiteAssignments)
    .where(
      and(
        eq(timekeeperSiteAssignments.tenantId, ctx.tenantId),
        eq(timekeeperSiteAssignments.userId, ctx.userId),
        eq(timekeeperSiteAssignments.projectSiteId, projectSiteId),
      ),
    )
    .limit(1);
  return !!row;
}

export async function edtrPaperSize(tx: Tx): Promise<EdtrPaperSize> {
  const [row] = await tx.select({ paperSize: edtrSettings.paperSize }).from(edtrSettings).limit(1);
  return row?.paperSize === 'letter' ? 'letter' : 'legal';
}
