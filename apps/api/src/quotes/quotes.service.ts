import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { and, asc, desc, eq, gt, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import {
  auditLogs,
  depositForQuote,
  equipment,
  equipmentAssignments,
  equipmentTypes,
  rateCards,
  getBillingSettings,
  quotationItems,
  quotations,
  rentalContracts,
  rentals,
  withTenantTx,
} from '@arkilaunch/db';
import { quoteExpiresAt, type QuoteRequest, type RequestContext } from '@arkilaunch/shared';
import { ownsCustomer, requireVerifiedCompany } from '../common/customer-scope.js';
import { notifyBookingCustomer, notifyStaff } from '../common/notify-customer.js';
import { EventsService } from '../events/events.service.js';
import { PricingEngineService, type PricedQuote } from './pricing-engine.service.js';

// RFC-3 §3: the API returns camelCase (matching this codebase's existing
// AuthTokens/JwtClaims convention in packages/shared), not the RFC's
// illustrative snake_case JSON -- the wire shape below is a deliberate
// naming-convention choice, not a divergence from the RFC's math or fields.
export interface QuoteResponse {
  id: string;
  revision: number;
  status: string;
  dieselPrice: number;
  dieselPriceDate: string;
  dieselPriceSource: string;
  priceStale: boolean;
  currency: 'PHP';
  lineItems: Array<{
    equipmentTypeId: string;
    equipmentTypeName?: string;
    quantity: number;
    estimatedHours: number;
    hourlyRate: number;
    operatingCost: number;
    mobilizationCost: number;
    demobilizationCost: number;
    buffer: number;
    subtotal: number;
  }>;
  subtotal: number;
  discount: number;
  total: number;
  printableUrl: string | null;
}

function toLineItems(priced: PricedQuote): QuoteResponse['lineItems'] {
  return priced.items.map((item) => ({
    equipmentTypeId: item.equipmentTypeId,
    quantity: item.quantity,
    estimatedHours: item.estimatedHours,
    hourlyRate: item.hourlyRatePhp,
    operatingCost: item.operatingCostPhp,
    mobilizationCost: item.mobilizationCostPhp,
    demobilizationCost: item.demobilizationCostPhp,
    buffer: item.bufferPhp,
    subtotal: item.subtotalPhp,
  }));
}

@Injectable()
export class QuotesService {
  constructor(
    private readonly pricingEngine: PricingEngineService,
    private readonly events: EventsService,
  ) {}

  // POST /quotes/preview: compute only, nothing persisted (RFC-3 §3).
  async preview(ctx: RequestContext, body: QuoteRequest): Promise<QuoteResponse> {
    const priced = await withTenantTx(ctx, (tx) =>
      this.pricingEngine.priceQuote(tx, ctx.tenantId, body.items, body.discount),
    );
    return {
      id: '',
      revision: 0,
      status: 'preview',
      dieselPrice: priced.diesel.pricePhp,
      dieselPriceDate: priced.diesel.observedDate,
      dieselPriceSource: priced.diesel.source,
      priceStale: priced.diesel.stale,
      currency: 'PHP',
      lineItems: toLineItems(priced),
      subtotal: priced.subtotalPhp,
      discount: priced.discountPhp,
      total: priced.totalPhp,
      printableUrl: null,
    };
  }

  // POST /quotes: persist a draft, freeze the snapshot (RFC-3 §3).
  async create(ctx: RequestContext, body: QuoteRequest): Promise<QuoteResponse> {
    const startedAt = Date.now();
    const result = await withTenantTx(ctx, async (tx) => {
      // A booking has one live quote. Quoting it again is a new revision
      // that supersedes every open one, so an older, cheaper approved quote
      // can never still be accepted after the price moved.
      await requireVerifiedCompany(tx, body.customerId);
      let revision = 1;
      let parentQuotationId: string | null = null;
      if (body.rentalId) {
        const [rental] = await tx.select().from(rentals).where(eq(rentals.id, body.rentalId)).limit(1);
        if (!rental) throw new NotFoundException({ error: 'booking_not_found' });
        if (rental.customerId !== body.customerId) {
          throw new ConflictException({ error: 'quote_customer_mismatch' });
        }
        const [latest] = await tx
          .select()
          .from(quotations)
          .where(eq(quotations.rentalId, body.rentalId))
          .orderBy(desc(quotations.createdAt))
          .limit(1);
        if (latest?.status === 'accepted') throw new ConflictException({ error: 'quote_already_accepted' });
        if (latest) {
          revision = latest.revision + 1;
          parentQuotationId = latest.id;
          await tx
            .update(quotations)
            .set({ status: 'superseded' })
            .where(and(eq(quotations.rentalId, body.rentalId), inArray(quotations.status, ['draft', 'approved', 'rejected'])));
        }
      }

      const priced = await this.pricingEngine.priceQuote(tx, ctx.tenantId, body.items, body.discount);

      const [quotation] = await tx
        .insert(quotations)
        .values({
          tenantId: ctx.tenantId,
          customerId: body.customerId,
          rentalId: body.rentalId ?? null,
          revision,
          parentQuotationId,
          status: 'draft',
          dieselPriceSnapshot: String(priced.diesel.pricePhp),
          priceStale: String(priced.diesel.stale),
          dieselPriceReadingId: priced.diesel.readingId,
          dieselPriceDate: priced.diesel.observedDate,
          dieselPriceSource: priced.diesel.source,
          pricingParamsId: priced.diesel.pricingParamsId,
          discountType: body.discount.type,
          discountValue: String(body.discount.value),
          subtotalPhp: String(priced.subtotalPhp),
          totalPhp: String(priced.totalPhp),
        })
        .returning();
      if (!quotation) throw new Error('quotation insert returned no row');

      await tx.insert(quotationItems).values(
        priced.items.map((item) => ({
          tenantId: ctx.tenantId,
          quotationId: quotation.id,
          equipmentTypeId: item.equipmentTypeId,
          rateCardId: item.rateCardId,
          quantity: item.quantity,
          mobilizationKm: String(item.mobilizationKm),
          demobilizationKm: String(item.demobilizationKm),
          estimatedHours: String(item.estimatedHours),
          pricingInputs: item.pricingInputs,
          hourlyRatePhp: String(item.hourlyRatePhp),
          operatingCostPhp: String(item.operatingCostPhp),
          mobilizationCostPhp: String(item.mobilizationCostPhp),
          demobilizationCostPhp: String(item.demobilizationCostPhp),
          bufferPhp: String(item.bufferPhp),
          subtotalPhp: String(item.subtotalPhp),
        })),
      );

      await this.auditAgreedPrices(tx, ctx, quotation.id, body);
      const printableUrl = `/app/quotes/${quotation.id}/print`;
      await tx.update(quotations).set({ printableUrl }).where(eq(quotations.id, quotation.id));

      return { quotation: { ...quotation, printableUrl }, priced };
    });

    await this.events.emit(ctx, 'quote_generated', {
      quotation_id: result.quotation.id,
      latency_ms: Date.now() - startedAt,
      diesel_price_date: result.priced.diesel.observedDate,
      price_stale: result.priced.diesel.stale,
    });

    return this.toResponse(result.quotation.id, result.quotation.revision, result.quotation.status, result.priced, result.quotation.printableUrl);
  }

  // Automatic quote on a new booking: every machine priced off its own rate
  // card (the unit's, else its type's; hourly before daily, the same pick
  // as the catalog price), for its booked days x the tenant's hours per
  // day, then sent to the customer at once. Staff can still revise it
  // before it is accepted. Returns null, leaving the booking for a manual
  // quote, when a machine has no rate card or pricing is not set up.
  // ponytail: transport km start at 0 (no route distance yet); staff add
  // mobilization in a revision.
  async autoQuoteBooking(ctx: RequestContext, rentalId: string): Promise<QuoteResponse | null> {
    const body = await withTenantTx(ctx, async (tx): Promise<QuoteRequest | null> => {
      const [rental] = await tx.select().from(rentals).where(eq(rentals.id, rentalId)).limit(1);
      if (!rental) return null;
      const lines = await tx
        .select({ equipmentId: equipment.id, equipmentTypeId: equipment.equipmentTypeId, start: equipmentAssignments.start, end: equipmentAssignments.end })
        .from(equipmentAssignments)
        .innerJoin(equipment, eq(equipment.id, equipmentAssignments.equipmentId))
        .where(eq(equipmentAssignments.rentalId, rentalId));
      if (lines.length === 0) return null;
      const { dailyHours } = await getBillingSettings(tx, ctx.tenantId);
      const now = new Date();
      const items: QuoteRequest['items'] = [];
      for (const line of lines) {
        const [card] = await tx
          .select({ id: rateCards.id })
          .from(rateCards)
          .where(
            and(
              eq(rateCards.tenantId, ctx.tenantId),
              or(eq(rateCards.equipmentId, line.equipmentId), and(eq(rateCards.equipmentTypeId, line.equipmentTypeId), isNull(rateCards.equipmentId))),
              lte(rateCards.effectiveFrom, now),
              or(isNull(rateCards.effectiveTo), gt(rateCards.effectiveTo, now)),
            ),
          )
          .orderBy(sql`${rateCards.equipmentId} is null`, asc(sql`${rateCards.rateType} <> 'hourly'`), desc(rateCards.effectiveFrom))
          .limit(1);
        // No card, or an open-ended hire with no days to price: manual quote.
        if (!card || !line.end) return null;
        const days = Math.max(1, Math.ceil((line.end.getTime() - line.start.getTime()) / 86_400_000));
        items.push({
          equipmentTypeId: line.equipmentTypeId,
          rateCardId: card.id,
          quantity: 1,
          estimatedHours: days * dailyHours,
          mobilizationKm: 0,
          demobilizationKm: 0,
        });
      }
      return { customerId: rental.customerId, projectSiteId: rental.projectSiteId, rentalId, discount: { type: 'none', value: 0 }, items };
    });
    if (!body) return null;
    try {
      const quote = await this.create(ctx, body);
      await this.approve(ctx, quote.id);
      return { ...quote, status: 'approved' };
    } catch (err) {
      // No pricing parameters or diesel price yet (422): staff quote by hand.
      if (err instanceof UnprocessableEntityException) return null;
      throw err;
    }
  }

  // POST /quotes/:id/revise: fresh snapshot, supersede the parent (RFC-3 §3).
  async revise(ctx: RequestContext, quotationId: string, body: QuoteRequest): Promise<QuoteResponse> {
    return withTenantTx(ctx, async (tx) => {
      const [parent] = await tx.select().from(quotations).where(eq(quotations.id, quotationId)).limit(1);
      if (!parent) throw new NotFoundException({ error: 'quote_not_found' });
      await requireVerifiedCompany(tx, body.customerId);

      const priced = await this.pricingEngine.priceQuote(tx, ctx.tenantId, body.items, body.discount);

      const [revised] = await tx
        .insert(quotations)
        .values({
          tenantId: ctx.tenantId,
          customerId: body.customerId,
          rentalId: parent.rentalId,
          revision: parent.revision + 1,
          status: 'draft',
          dieselPriceSnapshot: String(priced.diesel.pricePhp),
          priceStale: String(priced.diesel.stale),
          dieselPriceReadingId: priced.diesel.readingId,
          dieselPriceDate: priced.diesel.observedDate,
          dieselPriceSource: priced.diesel.source,
          pricingParamsId: priced.diesel.pricingParamsId,
          parentQuotationId: parent.id,
          discountType: body.discount.type,
          discountValue: String(body.discount.value),
          subtotalPhp: String(priced.subtotalPhp),
          totalPhp: String(priced.totalPhp),
        })
        .returning();
      if (!revised) throw new Error('revised quotation insert returned no row');

      await tx.insert(quotationItems).values(
        priced.items.map((item) => ({
          tenantId: ctx.tenantId,
          quotationId: revised.id,
          equipmentTypeId: item.equipmentTypeId,
          rateCardId: item.rateCardId,
          quantity: item.quantity,
          mobilizationKm: String(item.mobilizationKm),
          demobilizationKm: String(item.demobilizationKm),
          estimatedHours: String(item.estimatedHours),
          pricingInputs: item.pricingInputs,
          hourlyRatePhp: String(item.hourlyRatePhp),
          operatingCostPhp: String(item.operatingCostPhp),
          mobilizationCostPhp: String(item.mobilizationCostPhp),
          demobilizationCostPhp: String(item.demobilizationCostPhp),
          bufferPhp: String(item.bufferPhp),
          subtotalPhp: String(item.subtotalPhp),
        })),
      );

      await this.auditAgreedPrices(tx, ctx, revised.id, body);
      const printableUrl = `/app/quotes/${revised.id}/print`;
      await tx.update(quotations).set({ printableUrl }).where(eq(quotations.id, revised.id));

      // The parent's numbers are unchanged (QAD-T47); only its status flips.
      await tx.update(quotations).set({ status: 'superseded' }).where(eq(quotations.id, parent.id));

      return this.toResponse(revised.id, revised.revision, 'draft', priced, printableUrl);
    });
  }

  // POST /quotes/:id/approve: draft -> approved, locks the snapshot (RFC-3 §3).
  async approve(ctx: RequestContext, quotationId: string): Promise<{ id: string; status: string }> {
    return withTenantTx(ctx, async (tx) => {
      const [quotation] = await tx.select().from(quotations).where(eq(quotations.id, quotationId)).limit(1);
      if (!quotation) throw new NotFoundException({ error: 'quote_not_found' });
      if (quotation.status !== 'draft') {
        throw new ConflictException({ error: 'quote_not_draft', status: quotation.status });
      }

      await tx.update(quotations).set({ status: 'approved' }).where(eq(quotations.id, quotationId));
      await tx.insert(auditLogs).values({
        tenantId: ctx.tenantId,
        actorId: ctx.userId,
        action: 'APPROVE',
        entity: 'quotations',
        entityId: quotationId,
      });
      if (quotation.rentalId) {
        await notifyBookingCustomer(tx, ctx.tenantId, quotation.rentalId, 'quote_ready', {
          quotation_id: quotationId,
          revision: quotation.revision,
          total_php: Number(quotation.totalPhp ?? 0),
        });
      }

      return { id: quotationId, status: 'approved' };
    });
  }

  // POST /quotes/:id/accept: the customer takes an approved quote. This is
  // the only thing that makes rent chargeable at checkout, and it opens the
  // rental contract whose deposit_required caps every later deduction.
  async accept(ctx: RequestContext, quotationId: string): Promise<{ id: string; status: string }> {
    return withTenantTx(ctx, async (tx) => {
      const quotation = await this.customerQuote(tx, ctx, quotationId);
      if (quotation.status !== 'approved') {
        throw new ConflictException({ error: 'quote_not_open', status: quotation.status });
      }
      if (!quotation.rentalId) throw new ConflictException({ error: 'quote_not_linked_to_booking' });
      if (quoteExpiresAt(quotation.createdAt) < new Date()) throw new ConflictException({ error: 'quote_expired' });

      await tx.update(quotations).set({ status: 'accepted' }).where(eq(quotations.id, quotationId));
      const [rentedHoursValue] = await tx
        .select({ value: sql<string | null>`sum(${quotationItems.estimatedHours} * ${quotationItems.quantity} * ${quotationItems.hourlyRatePhp})` })
        .from(quotationItems)
        .where(eq(quotationItems.quotationId, quotationId));
      await tx.insert(rentalContracts).values({
        tenantId: ctx.tenantId,
        quotationId,
        depositRequired: String(
          depositForQuote(await getBillingSettings(tx, ctx.tenantId), rentedHoursValue?.value != null ? Number(rentedHoursValue.value) : null),
        ),
        status: 'active',
      });
      await tx.insert(auditLogs).values({
        tenantId: ctx.tenantId,
        actorId: ctx.userId,
        action: 'APPROVE',
        entity: 'quotations',
        entityId: quotationId,
      });
      await this.events.emit(ctx, 'quote_accepted', { quotation_id: quotationId });
      await notifyStaff(tx, ctx.tenantId, 'quote_accepted', { rental_id: quotation.rentalId, total_php: Number(quotation.totalPhp ?? 0) });
      return { id: quotationId, status: 'accepted' };
    });
  }

  // POST /quotes/:id/decline: the customer walks away from this revision.
  // The booking stays open so staff can revise, or the customer can cancel.
  async decline(ctx: RequestContext, quotationId: string): Promise<{ id: string; status: string }> {
    return withTenantTx(ctx, async (tx) => {
      const quotation = await this.customerQuote(tx, ctx, quotationId);
      if (quotation.status !== 'approved') {
        throw new ConflictException({ error: 'quote_not_open', status: quotation.status });
      }
      await tx.update(quotations).set({ status: 'rejected' }).where(eq(quotations.id, quotationId));
      await this.events.emit(ctx, 'quote_declined', { quotation_id: quotationId });
      if (quotation.rentalId) await notifyStaff(tx, ctx.tenantId, 'quote_declined', { rental_id: quotation.rentalId });
      return { id: quotationId, status: 'rejected' };
    });
  }

  // A staff-agreed line price is a manual override of the engine, so it is
  // audit-logged against the quote it lives on.
  private async auditAgreedPrices(
    tx: Parameters<Parameters<typeof withTenantTx>[1]>[0],
    ctx: RequestContext,
    quotationId: string,
    body: QuoteRequest,
  ) {
    const agreed = body.items.filter((item) => item.agreedSubtotalPhp !== undefined);
    if (agreed.length === 0) return;
    await tx.insert(auditLogs).values({
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      action: 'UPDATE',
      entity: 'quotations',
      entityId: quotationId,
      reason: `agreed price on ${agreed.length} line(s): ${agreed.map((item) => `${item.equipmentTypeId}=${item.agreedSubtotalPhp}`).join(', ')}`,
    });
  }

  // Accept/decline are the customer's call on their own quote: 404 for
  // anyone else's (never confirm the id exists) and for staff, who approve
  // rather than accept.
  private async customerQuote(tx: Parameters<Parameters<typeof withTenantTx>[1]>[0], ctx: RequestContext, quotationId: string) {
    const [quotation] = await tx.select().from(quotations).where(eq(quotations.id, quotationId)).limit(1);
    const mine = ctx.role === 'customer' && quotation ? await ownsCustomer(tx, ctx, quotation.customerId) : false;
    if (!quotation || !mine) {
      throw new NotFoundException({ error: 'quote_not_found' });
    }
    return quotation;
  }

  // GET /quotes/:id: renders entirely from stored columns (RFC-3 §3), so a
  // print months later shows the exact quoted numbers.
  async get(ctx: RequestContext, quotationId: string): Promise<QuoteResponse> {
    return withTenantTx(ctx, async (tx) => {
      const [quotation] = await tx.select().from(quotations).where(eq(quotations.id, quotationId)).limit(1);
      if (!quotation) throw new NotFoundException({ error: 'quote_not_found' });

      // RLS scopes to the tenant, never to the customer, and `customer`
      // holds quote:read -- so without this a customer JWT plus any
      // quotation id returns another customer's rates, discounts and
      // totals (audit-api-surface.md #1). 404 rather than 403: a 403 would
      // confirm the id exists.
      if (ctx.role === 'customer') {
        if (!(await ownsCustomer(tx, ctx, quotation.customerId))) throw new NotFoundException({ error: 'quote_not_found' });
      }

      const items = await tx
        .select({ item: quotationItems, typeName: equipmentTypes.name })
        .from(quotationItems)
        .leftJoin(equipmentTypes, eq(equipmentTypes.id, quotationItems.equipmentTypeId))
        .where(eq(quotationItems.quotationId, quotationId));

      return {
        id: quotation.id,
        revision: quotation.revision,
        status: quotation.status,
        dieselPrice: Number(quotation.dieselPriceSnapshot ?? 0),
        dieselPriceDate: quotation.dieselPriceDate ?? '',
        dieselPriceSource: quotation.dieselPriceSource ?? '',
        priceStale: quotation.priceStale === 'true',
        currency: 'PHP',
        lineItems: items.map(({ item, typeName }) => ({
          equipmentTypeId: item.equipmentTypeId,
          ...(typeName ? { equipmentTypeName: typeName } : {}),
          quantity: item.quantity,
          estimatedHours: Number(item.estimatedHours),
          hourlyRate: Number(item.hourlyRatePhp),
          operatingCost: Number(item.operatingCostPhp),
          mobilizationCost: Number(item.mobilizationCostPhp),
          demobilizationCost: Number(item.demobilizationCostPhp),
          buffer: Number(item.bufferPhp),
          subtotal: Number(item.subtotalPhp),
        })),
        subtotal: Number(quotation.subtotalPhp ?? 0),
        discount: Number(quotation.discountValue ?? 0),
        total: Number(quotation.totalPhp ?? 0),
        printableUrl: quotation.printableUrl,
      };
    });
  }

  private toResponse(
    id: string,
    revision: number,
    status: string,
    priced: PricedQuote,
    printableUrl: string | null,
  ): QuoteResponse {
    return {
      id,
      revision,
      status,
      dieselPrice: priced.diesel.pricePhp,
      dieselPriceDate: priced.diesel.observedDate,
      dieselPriceSource: priced.diesel.source,
      priceStale: priced.diesel.stale,
      currency: 'PHP',
      lineItems: toLineItems(priced),
      subtotal: priced.subtotalPhp,
      discount: priced.discountPhp,
      total: priced.totalPhp,
      printableUrl,
    };
  }
}
