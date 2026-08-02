import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { auditLogs, quotationItems, quotations, withTenantTx } from '@arkilaunch/db';
import type { QuoteRequest, RequestContext } from '@arkilaunch/shared';
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
      const priced = await this.pricingEngine.priceQuote(tx, ctx.tenantId, body.items, body.discount);

      const [quotation] = await tx
        .insert(quotations)
        .values({
          tenantId: ctx.tenantId,
          customerId: body.customerId,
          revision: 1,
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

  // POST /quotes/:id/revise: fresh snapshot, supersede the parent (RFC-3 §3).
  async revise(ctx: RequestContext, quotationId: string, body: QuoteRequest): Promise<QuoteResponse> {
    return withTenantTx(ctx, async (tx) => {
      const [parent] = await tx.select().from(quotations).where(eq(quotations.id, quotationId)).limit(1);
      if (!parent) throw new NotFoundException({ error: 'quote_not_found' });

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

      return { id: quotationId, status: 'approved' };
    });
  }

  // GET /quotes/:id: renders entirely from stored columns (RFC-3 §3), so a
  // print months later shows the exact quoted numbers.
  async get(ctx: RequestContext, quotationId: string): Promise<QuoteResponse> {
    return withTenantTx(ctx, async (tx) => {
      const [quotation] = await tx.select().from(quotations).where(eq(quotations.id, quotationId)).limit(1);
      if (!quotation) throw new NotFoundException({ error: 'quote_not_found' });

      const items = await tx
        .select()
        .from(quotationItems)
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
        lineItems: items.map((item) => ({
          equipmentTypeId: item.equipmentTypeId,
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
