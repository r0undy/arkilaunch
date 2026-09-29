import { Injectable } from '@nestjs/common';
import { and, eq, gt, isNull, lte, or } from 'drizzle-orm';
import {
  addresses,
  customers,
  db,
  equipment,
  equipmentTypes,
  projectSites,
  rateCards,
  rentals,
  withTenantTx,
} from '@arkilaunch/db';
import type { RequestContext } from '@arkilaunch/shared';

// RLS is not the whole boundary: `customer` is intra-tenant, so every tenant-scoped route needs @RequirePermission.
@Injectable()
export class ReferenceService {
  // Global catalog (no tenant_id, no RLS).
  async equipmentTypes() {
    return db.select({ id: equipmentTypes.id, name: equipmentTypes.name }).from(equipmentTypes);
  }

  async equipment(ctx: RequestContext) {
    return withTenantTx(ctx, (tx) =>
      tx
        .select({
          id: equipment.id,
          model: equipment.model,
          serialNo: equipment.serialNo,
          equipmentTypeId: equipment.equipmentTypeId,
          availabilityStatus: equipment.availabilityStatus,
        })
        .from(equipment),
    );
  }

  async rateCards(ctx: RequestContext, equipmentTypeId?: string) {
    return withTenantTx(ctx, (tx) => {
      const now = new Date();
      // Only currently-effective cards, or a new quote could be priced at a stale value.
      const effectivenessFilter = and(
        lte(rateCards.effectiveFrom, now),
        or(isNull(rateCards.effectiveTo), gt(rateCards.effectiveTo, now)),
      );
      const query = tx
        .select({
          id: rateCards.id,
          equipmentTypeId: rateCards.equipmentTypeId,
          equipmentId: rateCards.equipmentId,
          rateType: rateCards.rateType,
          rateValue: rateCards.rateValue,
          currency: rateCards.currency,
        })
        .from(rateCards);
      return equipmentTypeId
        ? query.where(and(eq(rateCards.equipmentTypeId, equipmentTypeId), effectivenessFilter))
        : query.where(effectivenessFilter);
    });
  }

  async rentals(ctx: RequestContext) {
    return withTenantTx(ctx, (tx) =>
      tx
        .select({
          id: rentals.id,
          code: rentals.code,
          customerId: rentals.customerId,
          projectSiteId: rentals.projectSiteId,
          status: rentals.status,
          // The capture form's date picker mirrors the server's span rule.
          startDate: rentals.startDate,
          endDate: rentals.endDate,
        })
        .from(rentals),
    );
  }

  async customers(ctx: RequestContext) {
    return withTenantTx(ctx, (tx) =>
      tx.select({ id: customers.id, companyName: customers.companyName }).from(customers),
    );
  }

  async projectSites(ctx: RequestContext) {
    return withTenantTx(ctx, (tx) =>
      tx
        .select({
          id: projectSites.id,
          latitude: projectSites.latitude,
          longitude: projectSites.longitude,
          city: addresses.city,
          province: addresses.province,
        })
        .from(projectSites)
        .leftJoin(addresses, eq(addresses.id, projectSites.addressId)),
    );
  }
}
