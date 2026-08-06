import { Injectable } from '@nestjs/common';
import { and, eq, gt, isNull, lte, or } from 'drizzle-orm';
import {
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

// Read-only reference lookups for the POC frontend's pick-list dropdowns
// (avoids requiring a hand-typed UUID for every foreign key). No
// @RequirePermission on the controller side: any authenticated member of
// the tenant can see their own tenant's equipment/rentals/customers, and
// RLS (via withTenantTx) is still the actual isolation boundary -- this is
// a read-only convenience, not a privileged action.
@Injectable()
export class ReferenceService {
  // Global reference catalog (no tenant_id, no RLS), same category as
  // diesel_price_readings -- queried directly, no tenant context needed.
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
      // Only currently-effective rows: a superseded or not-yet-effective
      // rate card must never reach the quote-builder's pick-list (it would
      // let a new quote be priced at a stale value -- QAD-T44/T48; see the
      // matching guard in PricingEngineService.priceItem).
      const effectivenessFilter = and(
        lte(rateCards.effectiveFrom, now),
        or(isNull(rateCards.effectiveTo), gt(rateCards.effectiveTo, now)),
      );
      const query = tx
        .select({
          id: rateCards.id,
          equipmentTypeId: rateCards.equipmentTypeId,
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
          customerId: rentals.customerId,
          projectSiteId: rentals.projectSiteId,
          status: rentals.status,
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
        .select({ id: projectSites.id, latitude: projectSites.latitude, longitude: projectSites.longitude })
        .from(projectSites),
    );
  }
}
