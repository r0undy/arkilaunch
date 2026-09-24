import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq } from 'drizzle-orm';
import { negotiationMessages, truckRequests, truckSettings, withTenantTx } from '@arkilaunch/db';
import {
  priceTruckTrip,
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
import { roadDistanceKm } from './route-distance.js';

type Tx = Parameters<Parameters<typeof withTenantTx>[1]>[0];
const DEFAULT_SETTINGS: TruckSettings = { baseFeePhp: 0, driverFeePhp: 0, extras: [] };

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
    createdAt: row.createdAt.toISOString(),
  };
}

@Injectable()
export class TrucksService {
  constructor(private readonly engine: PricingEngineService) {}

  private async readSettings(tx: Tx, tenantId: string): Promise<TruckSettings> {
    const [row] = await tx.select().from(truckSettings).where(eq(truckSettings.tenantId, tenantId)).limit(1);
    return row
      ? { baseFeePhp: Number(row.baseFeePhp), driverFeePhp: Number(row.driverFeePhp), extras: row.extras }
      : DEFAULT_SETTINGS;
  }

  // Per-km and fuel are the tenant's pricing parameters and today's resolved
  // diesel price -- the same inputs as every equipment quote.
  private async price(tx: Tx, tenantId: string, km: number): Promise<TruckPrice> {
    const diesel = await this.engine.resolveDieselAndParams(tx, tenantId);
    return priceTruckTrip({
      km,
      settings: await this.readSettings(tx, tenantId),
      perKmPhp: diesel.transportPhpPerKm,
      fuelLPerKm: diesel.fuelLPerKm,
      dieselPhp: diesel.pricePhp,
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
    const km = await roadDistanceKm(body.pickup, body.dropoff);
    return withTenantTx(ctx, (tx) => this.price(tx, ctx.tenantId, km));
  }

  async create(ctx: RequestContext, body: TruckRequestCreate): Promise<TruckRequestResponse> {
    const km = await roadDistanceKm(body.pickup, body.dropoff);
    return withTenantTx(ctx, async (tx) => {
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
          price: await this.price(tx, ctx.tenantId, km),
        })
        .returning();
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
  async confirmKm(ctx: RequestContext, id: string, km: number): Promise<TruckRequestResponse> {
    return withTenantTx(ctx, async (tx) => {
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
          price: await this.price(tx, ctx.tenantId, km),
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

  // ponytail: no notification on a truck message; both sides see the thread
  // on refresh. Add notifyStaff/customer pings if replies get missed.
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
      return { id: row.id };
    });
  }

  // Staff accept a price, which the truck invoice then charges. Re-agreeing
  // is allowed until the request is paid.
  async agree(ctx: RequestContext, id: string, pricePhp: number): Promise<TruckRequestResponse> {
    return withTenantTx(ctx, async (tx) => {
      const request = await this.visibleRequest(tx, ctx, id);
      if (request.status === 'cancelled' || request.status === 'paid') {
        throw new ConflictException({ error: 'truck_request_closed', status: request.status });
      }
      const [updated] = await tx
        .update(truckRequests)
        .set({ agreedPricePhp: String(pricePhp), status: 'agreed' })
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

