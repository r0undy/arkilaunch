import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNotNull, like, notInArray } from 'drizzle-orm';
import { auditLogs, customers, negotiationMessages, notifications, projectSites, tollRates, truckBanRules, truckRequests, truckSettings, users, withTenantTx } from '@arkilaunch/db';
import {
  bookingCodeSearchPrefix,
  CLOSED_TRUCK_STATUSES,
  DEFAULT_TRUCK_COST_POLICY,
  estimateTruckCost,
  negotiationFloor,
  TruckCostPolicySchema,
  truckProfit,
  PH_CLASS3_TOLLS,
  PH_TOLLS_AS_OF,
  priceTruckTrip,
  truckEta,
  type TruckBanRuleInput,
  type TruckBanRule,
  type TollRateCreate,
  type TollRateUpdate,
  type TollRateResponse,
  type TruckPriceLine,
  type NegotiationMessageCreate,
  type NegotiationMessageResponse,
  type RequestContext,
  type TruckEstimateRequest,
  type TruckEstimateResponse,
  type TruckRequestListQuery,
  type TruckRequestListResponse,
  type TruckRoute,
  type TruckInternal,
  type TruckPrice,
  type TruckCrew,
  type TruckKmConfirm,
  type TruckRequestCreate,
  type TruckRequestResponse,
  type TruckRequestStatus,
  type TruckSettings,
} from '@arkilaunch/shared';
import { PricingEngineService } from '../quotes/pricing-engine.service.js';
import { notifyStaff, notifyUser } from '../common/notify-customer.js';
import { ownCustomers } from '../common/customer-scope.js';
import { PaymentsService } from '../payments/payments.service.js';
import { roadRoute } from './route-distance.js';
import { routeCities } from './route-cities.js';
import { countRows } from '../common/count-rows.js';

type Tx = Parameters<Parameters<typeof withTenantTx>[1]>[0];
const DEFAULT_SETTINGS: TruckSettings = {
  baseFeePhp: 0, driverFeePhp: 0, extras: [], formula: null, rangePct: 10, region: 'NCR',
  roundTripMultiplier: 1, quoteMultiplier: 1, maxDiscountPct: null, costPolicy: DEFAULT_TRUCK_COST_POLICY,
};

const peso = (n: number) => Math.round(n * 100) / 100;
const php = (n: number) => `PHP ${n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const num = (v: string | null) => (v === null ? null : Number(v));

function pins(body: TruckEstimateRequest) {
  return {
    ...(body.pickupLat !== undefined && body.pickupLng !== undefined ? { a: { lat: body.pickupLat, lon: body.pickupLng } } : {}),
    ...(body.dropoffLat !== undefined && body.dropoffLng !== undefined ? { b: { lat: body.dropoffLat, lon: body.dropoffLng } } : {}),
  };
}

type Contact = { companyName: string | null; requesterName: string | null; requesterPhone: string | null };
const NO_CONTACT: Contact = { companyName: null, requesterName: null, requesterPhone: null };

// Cost, floor and profit are internal: only a staff caller gets them.
function internalView(row: typeof truckRequests.$inferSelect, ctx: RequestContext): TruckRequestResponse['internal'] {
  if (ctx.role === 'customer' || !row.internal) return undefined;
  const price = row.agreedPricePhp !== null ? Number(row.agreedPricePhp) : row.price.totalPhp;
  return { ...row.internal, ...truckProfit(price, row.internal.cost.totalPhp) };
}

function toResponse(row: typeof truckRequests.$inferSelect, contact: Contact, ctx: RequestContext): TruckRequestResponse {
  const internal = internalView(row, ctx);
  return {
    ...(internal ? { internal } : {}),
    id: row.id,
    code: row.code,
    pickup: row.pickup,
    dropoff: row.dropoff,
    scheduledFor: row.scheduledFor.toISOString(),
    notes: row.notes,
    estimatedKm: Number(row.estimatedKm),
    routeCities: row.routeCities,
    routeMinutes: row.routeMinutes,
    dispatchedAt: row.dispatchedAt?.toISOString() ?? null,
    etaAt: row.etaAt?.toISOString() ?? null,
    confirmedKm: row.confirmedKm === null ? null : Number(row.confirmedKm),
    status: row.status as TruckRequestStatus,
    price: row.price,
    agreedPricePhp: row.agreedPricePhp === null ? null : Number(row.agreedPricePhp),
    capPhp: num(row.capPhp),
    acceptedPricePhp: num(row.acceptedPricePhp),
    callRequestedAt: row.callRequestedAt?.toISOString() ?? null,
    callConfirmedAt: row.callConfirmedAt?.toISOString() ?? null,
    projectSiteId: row.projectSiteId,
    customerId: row.customerId,
    loadDescription: row.loadDescription,
    ...contact,
    driverName: row.driverName,
    helperName: row.helperName,
    pickupLat: num(row.pickupLat),
    pickupLng: num(row.pickupLng),
    dropoffLat: num(row.dropoffLat),
    dropoffLng: num(row.dropoffLng),
    createdAt: row.createdAt.toISOString(),
  };
}

@Injectable()
export class TrucksService {
  constructor(
    private readonly engine: PricingEngineService,
    private readonly payments: PaymentsService,
  ) {}

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
          roundTripMultiplier: Number(row.roundTripMultiplier),
          quoteMultiplier: Number(row.quoteMultiplier),
          maxDiscountPct: num(row.maxDiscountPct),
          costPolicy: TruckCostPolicySchema.parse(row.costPolicy),
        }
      : DEFAULT_SETTINGS;
  }

  // Per-km and fuel are the tenant's pricing parameters and today's resolved
  // diesel price (tenant override, else the national GasWatch average) --
  // the same inputs as every equipment quote. truck_settings.region is no
  // longer read. low/high are the total +/- the tenant's band. `internal`
  // (cost and floor, from the same inputs) is saved on the request and
  // never returned to a customer.
  private async price(tx: Tx, tenantId: string, km: number, tolls: TruckPriceLine[] = []): Promise<{ price: TruckPrice; internal: TruckInternal }> {
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
    const cost = estimateTruckCost({ km, settings, fuelLPerKm: diesel.fuelLPerKm, dieselPhp: diesel.pricePhp, tolls });
    return {
      price: { ...price, lowPhp: peso(price.totalPhp * (1 - band)), highPhp: peso(price.totalPhp * (1 + band)) },
      internal: { cost, floorPhp: negotiationFloor(price.totalPhp, settings.maxDiscountPct), maxDiscountPct: settings.maxDiscountPct },
    };
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

  listBanRules(ctx: RequestContext): Promise<TruckBanRule[]> {
    return withTenantTx(ctx, async (tx) => (await tx.select().from(truckBanRules)
      .where(eq(truckBanRules.tenantId, ctx.tenantId)).orderBy(asc(truckBanRules.city)))
      .map(toBanRule));
  }

  addBanRule(ctx: RequestContext, body: TruckBanRuleInput): Promise<TruckBanRule> {
    return withTenantTx(ctx, async (tx) => {
      const [row] = await tx.insert(truckBanRules).values({ tenantId: ctx.tenantId, ...body }).returning();
      return toBanRule(row!);
    });
  }

  updateBanRule(ctx: RequestContext, id: string, body: TruckBanRuleInput): Promise<TruckBanRule> {
    return withTenantTx(ctx, async (tx) => {
      const [row] = await tx.update(truckBanRules).set(body)
        .where(and(eq(truckBanRules.id, id), eq(truckBanRules.tenantId, ctx.tenantId))).returning();
      if (!row) throw new NotFoundException({ error: 'truck_ban_rule_not_found' });
      return toBanRule(row);
    });
  }

  removeBanRule(ctx: RequestContext, id: string) {
    return withTenantTx(ctx, async (tx) => {
      const [row] = await tx.delete(truckBanRules)
        .where(and(eq(truckBanRules.id, id), eq(truckBanRules.tenantId, ctx.tenantId))).returning({ id: truckBanRules.id });
      if (!row) throw new NotFoundException({ error: 'truck_ban_rule_not_found' });
      return row;
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
      roundTripMultiplier: String(body.roundTripMultiplier),
      quoteMultiplier: String(body.quoteMultiplier),
      maxDiscountPct: body.maxDiscountPct === null ? null : String(body.maxDiscountPct),
      costPolicy: body.costPolicy,
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
  async estimate(ctx: RequestContext, body: TruckEstimateRequest): Promise<TruckEstimateResponse> {
    const route = await roadRoute(body.pickup, body.dropoff, pins(body));
    const { price } = await withTenantTx(ctx, (tx) => this.price(tx, ctx.tenantId, route.km));
    return { ...price, route: route.line.length > 1 ? route : null };
  }

  async create(ctx: RequestContext, body: TruckRequestCreate): Promise<TruckRequestResponse> {
    const route = await roadRoute(body.pickup, body.dropoff, pins(body));
    const { km } = route;
    const created = await withTenantTx(ctx, async (tx) => {
      // Booked for one of the caller's own companies (never a client-trusted
      // id); a site, when named, must be that company's. A truck trip serves
      // the company, so the site needs no proof.
      const company = (await ownCustomers(tx, ctx)).find((row) => row.id === body.customerId);
      if (!company) throw new NotFoundException({ error: 'customer_not_found' });
      if (body.projectSiteId) {
        const [site] = await tx
          .select({ id: projectSites.id })
          .from(projectSites)
          .where(and(eq(projectSites.id, body.projectSiteId), eq(projectSites.customerId, company.id)))
          .limit(1);
        if (!site) throw new NotFoundException({ error: 'project_site_not_found' });
      }
      const { price, internal } = await this.price(tx, ctx.tenantId, km);
      const [row] = await tx
        .insert(truckRequests)
        .values({
          tenantId: ctx.tenantId,
          requestedBy: ctx.userId,
          pickup: body.pickup,
          dropoff: body.dropoff,
          scheduledFor: body.scheduledFor,
          notes: body.notes ?? null,
          customerId: company.id,
          loadDescription: body.loadDescription,
          estimatedKm: String(km),
          routeMinutes: route.minutes,
          price,
          internal,
          // The high end of the estimate: staff are warned before agreeing
          // above it (a typo guard; the customer accepts every price anyway).
          capPhp: String(price.highPhp ?? price.totalPhp),
          pickupLat: body.pickupLat !== undefined ? String(body.pickupLat) : null,
          pickupLng: body.pickupLng !== undefined ? String(body.pickupLng) : null,
          dropoffLat: body.dropoffLat !== undefined ? String(body.dropoffLat) : null,
          dropoffLng: body.dropoffLng !== undefined ? String(body.dropoffLng) : null,
          projectSiteId: body.projectSiteId ?? null,
        })
        .returning();
      await notifyStaff(tx, ctx.tenantId, 'truck_requested', { truck_request_id: row!.id });
      return toResponse(row!, { companyName: company.companyName, requesterName: null, requesterPhone: null }, ctx);
    });
    if (route.line.length > 1) {
      void routeCities(route.line).then((cities) => withTenantTx(ctx, (tx) => tx.update(truckRequests)
        .set({ routeCities: cities }).where(and(eq(truckRequests.id, created.id), eq(truckRequests.tenantId, ctx.tenantId)))))
        .catch((error: unknown) => console.error('Truck route city lookup failed', created.id, error));
    }
    return created;
  }

  // A customer sees only their own requests; staff see the tenant's queue.
  // `q` narrows to a TRK- code, exactly or by prefix, as GET /bookings does.
  // `status` splits the queue into open (still to act on) and closed.
  list(ctx: RequestContext, scope: 'mine' | 'all', query: TruckRequestListQuery): Promise<TruckRequestListResponse> {
    return withTenantTx(ctx, async (tx) => {
      const codePrefix = query.q ? bookingCodeSearchPrefix(query.q) : null;
      const closed = [...CLOSED_TRUCK_STATUSES];
      const where = and(
        scope === 'mine' ? eq(truckRequests.requestedBy, ctx.userId) : undefined,
        codePrefix ? like(truckRequests.code, `${codePrefix}%`) : undefined,
        query.status === 'open' ? notInArray(truckRequests.status, closed) : undefined,
        query.status === 'closed' ? inArray(truckRequests.status, closed) : undefined,
      );
      // Company and requester ride along, so staff can call the customer.
      const rows = await tx
        .select({ row: truckRequests, companyName: customers.companyName, first: users.firstName, last: users.lastName, phone: users.phone })
        .from(truckRequests)
        .leftJoin(customers, eq(customers.id, truckRequests.customerId))
        .leftJoin(users, eq(users.id, truckRequests.requestedBy))
        .where(where)
        .orderBy(desc(truckRequests.createdAt), desc(truckRequests.id))
        .limit(query.limit)
        .offset(query.offset);
      return {
        items: rows.map((r) =>
          toResponse(r.row, {
            companyName: r.companyName,
            requesterName: [r.first, r.last].filter(Boolean).join(' ') || null,
            requesterPhone: r.phone,
          }, ctx),
        ),
        total: await countRows(tx, truckRequests, where),
      };
    });
  }

  // GET /truck-requests/:id/route: the road line between a request's saved
  // pins, for the staff map. The pins are read under RLS (tenant from the
  // JWT); routing runs after the transaction closes.
  async route(ctx: RequestContext, id: string): Promise<TruckRoute> {
    const row = await withTenantTx(ctx, (tx) => this.visibleRequest(tx, ctx, id));
    if (row.pickupLat === null || row.pickupLng === null || row.dropoffLat === null || row.dropoffLng === null) {
      throw new NotFoundException({ error: 'truck_pins_missing' });
    }
    const route = await roadRoute(
      row.pickup,
      row.dropoff,
      { a: { lat: Number(row.pickupLat), lon: Number(row.pickupLng) }, b: { lat: Number(row.dropoffLat), lon: Number(row.dropoffLng) } },
      // Staff get the turn list's toll hints for the toll picker.
      ctx.role !== 'customer',
    );
    if (ctx.role !== 'customer' && row.routeCities === null && route.line.length > 1) {
      try {
        const cities = await routeCities(route.line);
        await withTenantTx(ctx, (tx) => tx.update(truckRequests).set({ routeCities: cities })
          .where(and(eq(truckRequests.id, id), eq(truckRequests.tenantId, ctx.tenantId))));
        route.cities = cities;
      } catch (error) {
        console.error('Truck route city backfill failed', id, error);
      }
    } else {
      if (row.routeCities) route.cities = row.routeCities;
    }
    return route;
  }

  async dispatch(ctx: RequestContext, id: string): Promise<TruckRequestResponse> {
    const current = await withTenantTx(ctx, (tx) => this.visibleRequest(tx, ctx, id));
    if (current.status !== 'paid') throw new ConflictException({ error: 'truck_not_paid', status: current.status });
    let minutes = current.routeMinutes;
    let cities = current.routeCities;
    if (minutes === null || cities === null) {
      const route = await roadRoute(current.pickup, current.dropoff, {
        ...(current.pickupLat !== null && current.pickupLng !== null ? { a: { lat: Number(current.pickupLat), lon: Number(current.pickupLng) } } : {}),
        ...(current.dropoffLat !== null && current.dropoffLng !== null ? { b: { lat: Number(current.dropoffLat), lon: Number(current.dropoffLng) } } : {}),
      });
      minutes ??= route.minutes;
      if (cities === null) cities = await routeCities(route.line);
    }
    return withTenantTx(ctx, async (tx) => {
      const row = await this.visibleRequest(tx, ctx, id, true);
      if (row.status !== 'paid') throw new ConflictException({ error: 'truck_not_paid', status: row.status });
      const rules = await tx.select().from(truckBanRules).where(eq(truckBanRules.tenantId, ctx.tenantId));
      const now = new Date();
      const eta = truckEta(now, minutes!, cities ?? [], rules.map(toBanRule));
      const [updated] = await tx.update(truckRequests).set({ status: 'dispatched', dispatchedAt: now,
        etaAt: eta, routeMinutes: minutes, routeCities: cities })
        .where(and(eq(truckRequests.id, id), eq(truckRequests.tenantId, ctx.tenantId))).returning();
      await notifyUser(tx, ctx.tenantId, row.requestedBy, 'truck_dispatched',
        { truck_request_id: id, booking_code: row.code, eta_at: eta.toISOString() });
      await tx.insert(auditLogs).values({ tenantId: ctx.tenantId, actorId: ctx.userId,
        action: 'UPDATE', entity: 'truck_requests', entityId: id, reason: `dispatched; ETA ${eta.toISOString()}` });
      return toResponse(updated!, NO_CONTACT, ctx);
    });
  }

  // The admin's km is final: the price is recomputed on it, with today's
  // inputs, and that is the figure the customer is charged.
  // A manual toll amount replaces the picked tolls with one line.
  async confirmKm(ctx: RequestContext, id: string, body: TruckKmConfirm): Promise<TruckRequestResponse> {
    const { km, tollRateIds = [], manualTollPhp } = body;
    return withTenantTx(ctx, async (tx) => {
      const tolls =
        manualTollPhp !== undefined
          ? manualTollPhp > 0
            ? [{ label: 'Toll (manual)', amountPhp: peso(manualTollPhp) }]
            : []
          : tollRateIds.length
            ? (await tx.select().from(tollRates).where(inArray(tollRates.id, tollRateIds))).map((t) => ({
                label: t.name,
                amountPhp: Number(t.feePhp),
              }))
            : [];
      const [row] = await tx.select().from(truckRequests).where(eq(truckRequests.id, id)).limit(1);
      if (!row) throw new NotFoundException({ error: 'truck_request_not_found' });
      if (row.status === 'cancelled') throw new ConflictException({ error: 'truck_request_cancelled' });
      const { price, internal } = await this.price(tx, ctx.tenantId, km, tolls);
      const [updated] = await tx
        .update(truckRequests)
        // An agreed or paid request keeps its status: the km refines the
        // cost breakdown, the agreed price is what was charged.
        .set({
          confirmedKm: String(km),
          status: row.status === 'estimated' ? 'km_confirmed' : row.status,
          price,
          internal,
        })
        .where(eq(truckRequests.id, id))
        .returning();
      return toResponse(updated!, NO_CONTACT, ctx);
    });
  }

  // A customer reaches only their own request; staff reach any in the
  // tenant (RLS scopes both to the JWT's tenant).
  // `lock` holds the row for a price or status change, so a staff price
  // change and a customer accept or cancel never interleave.
  private async visibleRequest(tx: Tx, ctx: RequestContext, id: string, lock = false) {
    const query = tx
      .select()
      .from(truckRequests)
      .where(
        ctx.role === 'customer'
          ? and(eq(truckRequests.id, id), eq(truckRequests.requestedBy, ctx.userId))
          : eq(truckRequests.id, id),
      )
      .limit(1);
    const [row] = lock ? await query.for('update') : await query;
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
      if (request.status === 'cancelled' || request.status === 'paid' || request.status === 'dispatched') {
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

  // Names the driver and helper on a trip; shown in the site hub.
  async setCrew(ctx: RequestContext, id: string, crew: TruckCrew): Promise<TruckRequestResponse> {
    return withTenantTx(ctx, async (tx) => {
      const [row] = await tx
        .update(truckRequests)
        .set({ driverName: crew.driverName || null, helperName: crew.helperName || null })
        .where(eq(truckRequests.id, id))
        .returning();
      if (!row) throw new NotFoundException({ error: 'truck_request_not_found' });
      return toResponse(row, NO_CONTACT, ctx);
    });
  }

  // Staff set the price the truck invoice charges; re-agreeing is allowed
  // until the request is paid. Every change voids the unpaid invoice (and
  // its PayMongo session/QR), needs the customer's accept again, and lands
  // in the thread both sides read, as the price history.
  async agree(ctx: RequestContext, id: string, pricePhp: number): Promise<TruckRequestResponse> {
    return withTenantTx(ctx, async (tx) => {
      const request = await this.visibleRequest(tx, ctx, id, true);
      if (request.status === 'cancelled' || request.status === 'paid' || request.status === 'dispatched') {
        throw new ConflictException({ error: 'truck_request_closed', status: request.status });
      }
      const was = num(request.agreedPricePhp);
      if (request.status === 'agreed' && was === pricePhp) return toResponse(request, NO_CONTACT, ctx);
      await this.payments.voidUnpaid(tx, { truckRequestId: id });
      const [updated] = await tx
        .update(truckRequests)
        .set({ agreedPricePhp: String(pricePhp), status: 'agreed', acceptedPricePhp: null })
        .where(eq(truckRequests.id, id))
        .returning();
      const body =
        was === null
          ? `Agreed price set to ${php(pricePhp)}. Please accept it before paying.`
          : `Agreed price changed from ${php(was)} to ${php(pricePhp)}. Please accept the new price before paying.`;
      await tx.insert(negotiationMessages).values({
        tenantId: ctx.tenantId,
        truckRequestId: id,
        authorUserId: ctx.userId,
        authorRole: 'staff',
        body,
        offerPhp: String(pricePhp),
      });
      await tx.insert(auditLogs).values({
        tenantId: ctx.tenantId,
        actorId: ctx.userId,
        action: 'UPDATE',
        entity: 'truck_requests',
        entityId: id,
        // The floor warns, never blocks: going below it is the admin's call,
        // and the audit trail says so.
        reason: `agreed price ${was === null ? 'none' : php(was)} -> ${php(pricePhp)}${
          request.internal?.floorPhp != null && pricePhp < request.internal.floorPhp ? `; below the negotiation floor of ${php(request.internal.floorPhp)}` : ''
        }`,
      });
      await notifyUser(tx, ctx.tenantId, request.requestedBy, 'truck_price_updated', {
        truck_request_id: id,
        price_php: pricePhp,
        previous_php: was,
      });
      return toResponse(updated!, NO_CONTACT, ctx);
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
      return toResponse(updated, NO_CONTACT, ctx);
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
      await notifyUser(tx, ctx.tenantId, updated.requestedBy, 'call_confirmed', { truck_request_id: id });
      return toResponse(updated, NO_CONTACT, ctx);
    });
  }

  // The customer accepts the agreed price they were shown. A staff change
  // in between (pricePhp no longer the agreed one) is a 409: they re-read
  // the new figure and accept that instead.
  async acceptPrice(ctx: RequestContext, id: string, pricePhp: number): Promise<TruckRequestResponse> {
    return withTenantTx(ctx, async (tx) => {
      const row = await this.visibleRequest(tx, ctx, id, true);
      if (row.status !== 'agreed' || row.agreedPricePhp === null) {
        throw new ConflictException({ error: 'price_not_agreed', status: row.status });
      }
      if (Number(row.agreedPricePhp) !== pricePhp) {
        throw new ConflictException({ error: 'price_changed', agreedPricePhp: Number(row.agreedPricePhp) });
      }
      if (num(row.acceptedPricePhp) === pricePhp) return toResponse(row, NO_CONTACT, ctx);
      const [updated] = await tx
        .update(truckRequests)
        .set({ acceptedPricePhp: row.agreedPricePhp })
        .where(eq(truckRequests.id, id))
        .returning();
      await tx.insert(negotiationMessages).values({
        tenantId: ctx.tenantId,
        truckRequestId: id,
        authorUserId: ctx.userId,
        authorRole: 'customer',
        body: `Accepted the agreed price of ${php(pricePhp)}.`,
        offerPhp: row.agreedPricePhp,
      });
      await notifyStaff(tx, ctx.tenantId, 'truck_price_accepted', { truck_request_id: id, price_php: pricePhp });
      return toResponse(updated!, NO_CONTACT, ctx);
    });
  }

  // The customer calls a trip off while it is still unpaid. Its unpaid
  // invoice and any open PayMongo session go with it (a session already
  // paid refuses: payment_in_progress); a paid trip is the rental team's
  // to cancel and refund.
  async cancelOwn(ctx: RequestContext, id: string): Promise<TruckRequestResponse> {
    return withTenantTx(ctx, async (tx) => {
      const row = await this.visibleRequest(tx, ctx, id, true);
      if (row.status === 'cancelled') throw new ConflictException({ error: 'already_cancelled' });
      if (row.status === 'paid' || row.status === 'dispatched') throw new ConflictException({ error: 'cancel_after_payment' });
      await this.payments.voidUnpaid(tx, { truckRequestId: id });
      const [updated] = await tx
        .update(truckRequests)
        .set({ status: 'cancelled' })
        .where(eq(truckRequests.id, id))
        .returning();
      await tx.insert(auditLogs).values({
        tenantId: ctx.tenantId,
        actorId: ctx.userId,
        action: 'UPDATE',
        entity: 'truck_requests',
        entityId: id,
        reason: 'cancelled by the customer',
      });
      await notifyStaff(tx, ctx.tenantId, 'truck_cancelled', { truck_request_id: id });
      return toResponse(updated!, NO_CONTACT, ctx);
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

function toBanRule(row: typeof truckBanRules.$inferSelect): TruckBanRule {
  return { id: row.id, city: row.city, province: row.province, days: row.days,
    windows: row.windows, minGvwKg: row.minGvwKg, permitNote: row.permitNote, verified: row.verified };
}
