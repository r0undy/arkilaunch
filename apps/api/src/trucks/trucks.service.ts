import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNotNull } from 'drizzle-orm';
import { negotiationMessages, notifications, tollRates, truckRequests, truckSettings, withTenantTx } from '@arkilaunch/db';
import {
  PH_CLASS3_TOLLS,
  PH_TOLLS_AS_OF,
  priceTruckTrip,
  type TollRateCreate,
  type TollRateUpdate,
  type TollRateResponse,
  type TruckPriceLine,
  type NegotiationMessageCreate,
  type NegotiationMessageResponse,
  type RequestContext,
  type TruckEstimateRequest,
  type TruckPrice,
  type TruckRequestCreate,
  type TruckRequestResponse,
  type TruckRequestStatus,
  type TruckSettings,
} from '@arkilaunch/shared';
import { PricingEngineService } from '../quotes/pricing-engine.service.js';
import { notifyStaff } from '../common/notify-customer.js';
import { roadDistanceKm } from './route-distance.js';

type Tx = Parameters<Parameters<typeof withTenantTx>[1]>[0];
const DEFAULT_SETTINGS: TruckSettings = { baseFeePhp: 0, driverFeePhp: 0, extras: [], formula: null, rangePct: 10, region: 'NCR' };

const peso = (n: number) => Math.round(n * 100) / 100;
const num = (v: string | null) => (v === null ? null : Number(v));

function pins(body: TruckEstimateRequest) {
  return {
    ...(body.pickupLat !== undefined && body.pickupLng !== undefined ? { a: { lat: body.pickupLat, lon: body.pickupLng } } : {}),
    ...(body.dropoffLat !== undefined && body.dropoffLng !== undefined ? { b: { lat: body.dropoffLat, lon: body.dropoffLng } } : {}),
  };
}

function toResponse(row: typeof truckRequests.$inferSelect): TruckRequestResponse {
  return {
    id: row.id,
    pickup: row.pickup,
    dropoff: row.dropoff,
    scheduledFor: row.scheduledFor.toISOString(),
    notes: row.notes,
    estimatedKm: Number(row.estimatedKm),
    confirmedKm: row.confirmedKm === null ? null : Number(row.confirmedKm),
    status: row.status as TruckRequestStatus,
    price: row.price,
    agreedPricePhp: row.agreedPricePhp === null ? null : Number(row.agreedPricePhp),
    capPhp: num(row.capPhp),
    callRequestedAt: row.callRequestedAt?.toISOString() ?? null,
    callConfirmedAt: row.callConfirmedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

@Injectable()
export class TrucksService {
  constructor(private readonly engine: PricingEngineService) {}

  private async readSettings(tx: Tx, tenantId: string): Promise<TruckSettings> {
    const [row] = await tx.select().from(truckSettings).where(eq(truckSettings.tenantId, tenantId)).limit(1);
    return row
      ? {
          baseFeePhp: Number(row.baseFeePhp),
          driverFeePhp: Number(row.driverFeePhp),
          extras: row.extras,
          formula: row.formula,
          rangePct: Number(row.rangePct),
          region: row.region,
        }
      : DEFAULT_SETTINGS;
  }

  // Per-km and fuel are the tenant's pricing parameters and today's resolved
  // diesel price (tenant override, else the national GasWatch average) --
  // the same inputs as every equipment quote. truck_settings.region is no
  // longer read. low/high are the total +/- the tenant's band.
  private async price(tx: Tx, tenantId: string, km: number, tolls: TruckPriceLine[] = []): Promise<TruckPrice> {
    const settings = await this.readSettings(tx, tenantId);
    const diesel = await this.engine.resolveDieselAndParams(tx, tenantId);
    const price = priceTruckTrip({
      km,
      settings,
      perKmPhp: diesel.transportPhpPerKm,
      fuelLPerKm: diesel.fuelLPerKm,
      dieselPhp: diesel.pricePhp,
      tolls,
    });
    const band = settings.rangePct / 100;
    return { ...price, lowPhp: peso(price.totalPhp * (1 - band)), highPhp: peso(price.totalPhp * (1 + band)) };
  }

  listTolls(ctx: RequestContext): Promise<TollRateResponse[]> {
    return withTenantTx(ctx, async (tx) => {
      const rows = await tx.select().from(tollRates).where(eq(tollRates.tenantId, ctx.tenantId)).orderBy(asc(tollRates.expressway), asc(tollRates.name)).limit(1000);
      return rows.map(toToll);
    });
  }

  // Loads the PH Class 3 expressway matrix as this tenant's own editable
  // toll rates. Idempotent: a pair already loaded (edited or not) is kept.
  loadPhTolls(ctx: RequestContext): Promise<{ added: number }> {
    return withTenantTx(ctx, async (tx) => {
      const have = new Set(
        (await tx.select().from(tollRates).where(and(eq(tollRates.tenantId, ctx.tenantId), isNotNull(tollRates.expressway)))).map((t) => `${t.expressway}|${t.entryPoint}|${t.exitPoint}`),
      );
      const missing = PH_CLASS3_TOLLS.filter((t) => !have.has(`${t.expressway}|${t.entry}|${t.exit}`));
      if (missing.length > 0) {
        await tx.insert(tollRates).values(
          missing.map((t) => ({
            tenantId: ctx.tenantId,
            name: `${t.expressway}: ${t.entry} to ${t.exit}`,
            feePhp: String(t.feePhp),
            expressway: t.expressway,
            entryPoint: t.entry,
            exitPoint: t.exit,
            vehicleClass: 3,
            asOf: PH_TOLLS_AS_OF,
          })),
        );
      }
      return { added: missing.length };
    });
  }

  // A TRB change: the admin corrects the fee in place.
  updateToll(ctx: RequestContext, id: string, body: TollRateUpdate): Promise<TollRateResponse> {
    return withTenantTx(ctx, async (tx) => {
      const [t] = await tx.update(tollRates).set({ feePhp: String(body.feePhp) }).where(and(eq(tollRates.id, id), eq(tollRates.tenantId, ctx.tenantId))).returning();
      if (!t) throw new NotFoundException({ error: 'toll_not_found' });
      return toToll(t);
    });
  }

  addToll(ctx: RequestContext, body: TollRateCreate): Promise<TollRateResponse> {
    return withTenantTx(ctx, async (tx) => {
      const [t] = await tx
        .insert(tollRates)
        .values({ tenantId: ctx.tenantId, name: body.name, feePhp: String(body.feePhp) })
        .returning();
      return toToll(t!);
    });
  }

  removeToll(ctx: RequestContext, id: string) {
    return withTenantTx(ctx, async (tx) => {
      await tx.delete(tollRates).where(and(eq(tollRates.id, id), eq(tollRates.tenantId, ctx.tenantId)));
      return { id };
    });
  }

  getSettings(ctx: RequestContext) {
    return withTenantTx(ctx, (tx) => this.readSettings(tx, ctx.tenantId));
  }

  async saveSettings(ctx: RequestContext, body: TruckSettings): Promise<TruckSettings> {
    const values = {
      baseFeePhp: String(body.baseFeePhp),
      driverFeePhp: String(body.driverFeePhp),
      extras: body.extras,
      formula: body.formula || null,
      rangePct: String(body.rangePct),
      region: body.region,
      updatedAt: new Date(),
    };
    await withTenantTx(ctx, (tx) =>
      tx
        .insert(truckSettings)
        .values({ tenantId: ctx.tenantId, ...values })
        .onConflictDoUpdate({ target: truckSettings.tenantId, set: values }),
    );
    return body;
  }

  // Routing runs outside any transaction: two slow network calls should not
  // hold a DB connection.
  async estimate(ctx: RequestContext, body: TruckEstimateRequest): Promise<TruckPrice> {
    const km = await roadDistanceKm(body.pickup, body.dropoff, pins(body));
    return withTenantTx(ctx, (tx) => this.price(tx, ctx.tenantId, km));
  }

  async create(ctx: RequestContext, body: TruckRequestCreate): Promise<TruckRequestResponse> {
    const km = await roadDistanceKm(body.pickup, body.dropoff, pins(body));
    return withTenantTx(ctx, async (tx) => {
      const price = await this.price(tx, ctx.tenantId, km);
      const [row] = await tx
        .insert(truckRequests)
        .values({
          tenantId: ctx.tenantId,
          requestedBy: ctx.userId,
          pickup: body.pickup,
          dropoff: body.dropoff,
          scheduledFor: body.scheduledFor,
          notes: body.notes ?? null,
          estimatedKm: String(km),
          price,
          // The high end of the estimate is locked as the most the customer
          // can be charged without re-approving.
          capPhp: String(price.highPhp ?? price.totalPhp),
          pickupLat: body.pickupLat !== undefined ? String(body.pickupLat) : null,
          pickupLng: body.pickupLng !== undefined ? String(body.pickupLng) : null,
          dropoffLat: body.dropoffLat !== undefined ? String(body.dropoffLat) : null,
          dropoffLng: body.dropoffLng !== undefined ? String(body.dropoffLng) : null,
        })
        .returning();
      await notifyStaff(tx, ctx.tenantId, 'truck_requested', { truck_request_id: row!.id });
      return toResponse(row!);
    });
  }

  // A customer sees only their own requests; staff see the tenant's queue.
  list(ctx: RequestContext, scope: 'mine' | 'all'): Promise<TruckRequestResponse[]> {
    return withTenantTx(ctx, async (tx) => {
      const rows = await tx
        .select()
        .from(truckRequests)
        .where(scope === 'mine' ? eq(truckRequests.requestedBy, ctx.userId) : undefined)
        .orderBy(desc(truckRequests.createdAt))
        .limit(100);
      return rows.map(toResponse);
    });
  }

  // The admin's km is final: the price is recomputed on it, with today's
  // inputs, and that is the figure the customer is charged.
  async confirmKm(ctx: RequestContext, id: string, km: number, tollRateIds: string[] = []): Promise<TruckRequestResponse> {
    return withTenantTx(ctx, async (tx) => {
      const tolls = tollRateIds.length
        ? (await tx.select().from(tollRates).where(inArray(tollRates.id, tollRateIds))).map((t) => ({
            label: t.name,
            amountPhp: Number(t.feePhp),
          }))
        : [];
      const [row] = await tx.select().from(truckRequests).where(eq(truckRequests.id, id)).limit(1);
      if (!row) throw new NotFoundException({ error: 'truck_request_not_found' });
      if (row.status === 'cancelled') throw new ConflictException({ error: 'truck_request_cancelled' });
      const [updated] = await tx
        .update(truckRequests)
        // An agreed or paid request keeps its status: the km refines the
        // cost breakdown, the agreed price is what was charged.
        .set({
          confirmedKm: String(km),
          status: row.status === 'estimated' ? 'km_confirmed' : row.status,
          price: await this.price(tx, ctx.tenantId, km, tolls),
        })
        .where(eq(truckRequests.id, id))
        .returning();
      return toResponse(updated!);
    });
  }

  // A customer reaches only their own request; staff reach any in the
  // tenant (RLS scopes both to the JWT's tenant).
  private async visibleRequest(tx: Tx, ctx: RequestContext, id: string) {
    const [row] = await tx
      .select()
      .from(truckRequests)
      .where(
        ctx.role === 'customer'
          ? and(eq(truckRequests.id, id), eq(truckRequests.requestedBy, ctx.userId))
          : eq(truckRequests.id, id),
      )
      .limit(1);
    if (!row) throw new NotFoundException({ error: 'truck_request_not_found' });
    return row;
  }

  // The same negotiation thread rentals use (negotiation_messages), keyed
  // on the truck request. An offer is a message, never a charge.
  listMessages(ctx: RequestContext, id: string): Promise<NegotiationMessageResponse[]> {
    return withTenantTx(ctx, async (tx) => {
      await this.visibleRequest(tx, ctx, id);
      const rows = await tx
        .select()
        .from(negotiationMessages)
        .where(eq(negotiationMessages.truckRequestId, id))
        .orderBy(asc(negotiationMessages.createdAt))
        .limit(500);
      return rows.map((row) => ({
        id: row.id,
        authorRole: row.authorRole === 'customer' ? ('customer' as const) : ('staff' as const),
        mine: row.authorUserId === ctx.userId,
        body: row.body,
        offerPhp: row.offerPhp !== null ? Number(row.offerPhp) : null,
        createdAt: row.createdAt,
      }));
    });
  }

  // A staff reply pings the requesting customer; a customer message pings staff.
  postMessage(ctx: RequestContext, id: string, body: NegotiationMessageCreate) {
    return withTenantTx(ctx, async (tx) => {
      const request = await this.visibleRequest(tx, ctx, id);
      if (request.status === 'cancelled' || request.status === 'paid') {
        throw new ConflictException({ error: 'truck_request_closed', status: request.status });
      }
      const [row] = await tx
        .insert(negotiationMessages)
        .values({
          tenantId: ctx.tenantId,
          truckRequestId: id,
          authorUserId: ctx.userId,
          authorRole: ctx.role === 'customer' ? 'customer' : 'staff',
          body: body.body,
          offerPhp: body.offerPhp !== undefined ? String(body.offerPhp) : null,
        })
        .returning();
      if (!row) throw new Error('negotiation_messages insert returned no row');
      const payload = { truck_request_id: id, offer_php: body.offerPhp ?? null };
      if (ctx.role === 'customer') {
        await notifyStaff(tx, ctx.tenantId, 'customer_message', payload);
      } else {
        await tx.insert(notifications).values({
          tenantId: ctx.tenantId,
          userId: request.requestedBy,
          notificationType: 'negotiation_reply',
          payload,
        });
      }
      return { id: row.id };
    });
  }

  // Staff accept a price, which the truck invoice then charges. Re-agreeing
  // is allowed until the request is paid. The standard price (the request's
  // own computed total) can always be accepted; any other number only once
  // the customer has opened a negotiation in the thread (standard-pricing CR).
  async agree(ctx: RequestContext, id: string, pricePhp: number): Promise<TruckRequestResponse> {
    return withTenantTx(ctx, async (tx) => {
      const request = await this.visibleRequest(tx, ctx, id);
      if (request.status === 'cancelled' || request.status === 'paid') {
        throw new ConflictException({ error: 'truck_request_closed', status: request.status });
      }
      if (pricePhp !== (request.price as { totalPhp: number }).totalPhp) {
        const [opened] = await tx
          .select({ id: negotiationMessages.id })
          .from(negotiationMessages)
          .where(and(eq(negotiationMessages.truckRequestId, id), eq(negotiationMessages.authorRole, 'customer')))
          .limit(1);
        if (!opened) throw new ConflictException({ error: 'negotiation_required' });
      }
      const [updated] = await tx
        .update(truckRequests)
        .set({ agreedPricePhp: String(pricePhp), status: 'agreed' })
        .where(eq(truckRequests.id, id))
        .returning();
      return toResponse(updated!);
    });
  }

  // Callback before payment: the customer asks, staff call and confirm.
  // Checkout refuses until call_confirmed_at is set.
  async requestCall(ctx: RequestContext, id: string): Promise<TruckRequestResponse> {
    return withTenantTx(ctx, async (tx) => {
      const [updated] = await tx
        .update(truckRequests)
        .set({ callRequestedAt: new Date() })
        .where(and(eq(truckRequests.id, id), eq(truckRequests.requestedBy, ctx.userId)))
        .returning();
      if (!updated) throw new NotFoundException({ error: 'truck_request_not_found' });
      await notifyStaff(tx, ctx.tenantId, 'call_requested', { truck_request_id: id });
      return toResponse(updated);
    });
  }

  async confirmCall(ctx: RequestContext, id: string): Promise<TruckRequestResponse> {
    return withTenantTx(ctx, async (tx) => {
      const [updated] = await tx
        .update(truckRequests)
        .set({ callConfirmedAt: new Date(), callConfirmedBy: ctx.userId })
        .where(eq(truckRequests.id, id))
        .returning();
      if (!updated) throw new NotFoundException({ error: 'truck_request_not_found' });
      return toResponse(updated);
    });
  }

  // Staff agreed a price above the locked cap: only the customer's OK
  // lifts the cap to that price.
  async approveOverCap(ctx: RequestContext, id: string): Promise<TruckRequestResponse> {
    return withTenantTx(ctx, async (tx) => {
      const [row] = await tx
        .select()
        .from(truckRequests)
        .where(and(eq(truckRequests.id, id), eq(truckRequests.requestedBy, ctx.userId)))
        .limit(1);
      if (!row) throw new NotFoundException({ error: 'truck_request_not_found' });
      if (row.status !== 'agreed' || row.agreedPricePhp === null) {
        throw new ConflictException({ error: 'price_not_agreed', status: row.status });
      }
      const [updated] = await tx
        .update(truckRequests)
        .set({ capPhp: row.agreedPricePhp })
        .where(eq(truckRequests.id, id))
        .returning();
      return toResponse(updated!);
    });
  }

  async cancelOwn(ctx: RequestContext, id: string): Promise<TruckRequestResponse> {
    return withTenantTx(ctx, async (tx) => {
      const [updated] = await tx
        .update(truckRequests)
        .set({ status: 'cancelled' })
        .where(and(eq(truckRequests.id, id), eq(truckRequests.requestedBy, ctx.userId)))
        .returning();
      if (!updated) throw new NotFoundException({ error: 'truck_request_not_found' });
      return toResponse(updated);
    });
  }
}

function toToll(t: typeof tollRates.$inferSelect): TollRateResponse {
  return {
    id: t.id,
    name: t.name,
    feePhp: Number(t.feePhp),
    expressway: t.expressway,
    entryPoint: t.entryPoint,
    exitPoint: t.exitPoint,
    vehicleClass: t.vehicleClass,
    asOf: t.asOf,
  };
}
