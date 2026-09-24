import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { truckRequests, truckSettings, withTenantTx } from '@arkilaunch/db';
import {
  priceTruckTrip,
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
        .set({ confirmedKm: String(km), status: 'km_confirmed', price: await this.price(tx, ctx.tenantId, km) })
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

