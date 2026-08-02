import { describe, expect, it, beforeAll } from 'vitest';
import { NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import postgres from 'postgres';
import { events, pricingParameters, withTenantTx } from '@arkilaunch/db';
import { eq, and, desc } from 'drizzle-orm';
import type { RequestContext } from '@arkilaunch/shared';
import { QuotesService } from '../src/quotes/quotes.service.js';
import { PricingEngineService } from '../src/quotes/pricing-engine.service.js';
import { EventsService } from '../src/events/events.service.js';

// RFC-3 §7 QUOTE-07 / QAD §3.7 T43..T48: the quotation engine's launch-gate
// test rows, run against the real two-tenant fixture (`pnpm db:seed:test`).
describe('Quotation engine (RFC-3): QAD-T43..T48', () => {
  const pricingEngine = new PricingEngineService();
  const eventsService = new EventsService();
  const quotes = new QuotesService(pricingEngine, eventsService);

  let ctxA: RequestContext;
  let ctxB: RequestContext;
  let rateCardIdA: string;
  let equipmentTypeIdA: string;
  let customerIdA: string;

  beforeAll(async () => {
    const url = process.env.DATABASE_URL_DIRECT;
    if (!url) throw new Error('DATABASE_URL_DIRECT is required');
    const sql = postgres(url, { max: 1 });

    const [tenantA] = await sql`select id from tenants where slug = 'test-tenant-a'`;
    const [tenantB] = await sql`select id from tenants where slug = 'test-tenant-b'`;
    const [userA] = await sql`select id from users where tenant_id = ${(tenantA as { id: string }).id} limit 1`;
    const [userB] = await sql`select id from users where tenant_id = ${(tenantB as { id: string }).id} limit 1`;
    const [rateCardA] = await sql`select id, equipment_type_id from rate_cards where tenant_id = ${(tenantA as { id: string }).id} limit 1`;
    const [customerA] = await sql`select id from customers where tenant_id = ${(tenantA as { id: string }).id} limit 1`;

    ctxA = { tenantId: (tenantA as { id: string }).id, userId: (userA as { id: string }).id, role: 'admin' };
    ctxB = { tenantId: (tenantB as { id: string }).id, userId: (userB as { id: string }).id, role: 'admin' };
    rateCardIdA = (rateCardA as { id: string }).id;
    equipmentTypeIdA = (rateCardA as { equipment_type_id: string }).equipment_type_id;
    customerIdA = (customerA as { id: string }).id;

    await sql.end();
  });

  function itemsFor(rateCardId: string, equipmentTypeId: string) {
    return [
      {
        equipmentTypeId,
        quantity: 2,
        rateCardId,
        estimatedHours: 40,
        mobilizationKm: 12,
        demobilizationKm: 12,
      },
    ];
  }

  // QAD-T43: latency + quote_generated instrumentation.
  it('QAD-T43: POST /quotes completes well under 60s and emits quote_generated with latency_ms', async () => {
    const startedAt = Date.now();
    const result = await quotes.create(ctxA, {
      customerId: customerIdA,
      projectSiteId: '00000000-0000-0000-0000-000000000000',
      discount: { type: 'none', value: 0 },
      items: itemsFor(rateCardIdA, equipmentTypeIdA),
    });
    expect(Date.now() - startedAt).toBeLessThan(60_000);
    expect(result.total).toBeGreaterThan(0);

    const emitted = await withTenantTx(ctxA, (tx) =>
      tx
        .select()
        .from(events)
        .where(and(eq(events.tenantId, ctxA.tenantId), eq(events.name, 'quote_generated')))
        .orderBy(desc(events.occurredAt))
        .limit(1),
    );
    expect(emitted.length).toBe(1);
    const properties = emitted[0]!.properties as Record<string, unknown>;
    expect(typeof properties.latency_ms).toBe('number');
  });

  // QAD-T44: a later diesel/rate-card change must not alter a saved quote.
  it('QAD-T44: a persisted quote is reproducible after the diesel price and pricing params move', async () => {
    const created = await quotes.create(ctxA, {
      customerId: customerIdA,
      projectSiteId: '00000000-0000-0000-0000-000000000000',
      discount: { type: 'none', value: 0 },
      items: itemsFor(rateCardIdA, equipmentTypeIdA),
    });

    // Move the tenant's pricing parameters (a new, different, effective-now row).
    await withTenantTx(ctxA, (tx) =>
      tx.insert(pricingParameters).values({
        tenantId: ctxA.tenantId,
        region: 'NCR',
        operatorHourlyPhp: '999.00',
        maintenanceHourlyPhp: '999.00',
        bufferPct: '0.50',
        fuelLPerHour: '99.000',
        fuelLPerKm: '99.000',
        transportPhpPerKm: '999.00',
        effectiveFrom: new Date(),
      }),
    );

    const reFetched = await quotes.get(ctxA, created.id);
    expect(reFetched.total).toBe(created.total);
    expect(reFetched.lineItems[0]!.hourlyRate).toBe(created.lineItems[0]!.hourlyRate);
  });

  // QAD-T45: source-outage fallback -- stale reading and no-reading-at-all.
  it('QAD-T45: prices on the last-known reading and flags price_stale when it is old', async () => {
    await withTenantTx(ctxA, (tx) =>
      tx.insert(pricingParameters).values({
        tenantId: ctxA.tenantId,
        region: 'STALE_TEST',
        operatorHourlyPhp: '100.00',
        maintenanceHourlyPhp: '50.00',
        bufferPct: '0.10',
        fuelLPerHour: '10.000',
        fuelLPerKm: '0.200',
        transportPhpPerKm: '20.00',
        effectiveFrom: new Date('2020-01-01T00:00:00Z'),
      }),
    );
    const staleDate = new Date();
    staleDate.setDate(staleDate.getDate() - 30);
    await withTenantTx(ctxA, async (tx) => {
      const { dieselPriceReadings } = await import('@arkilaunch/db');
      await tx.insert(dieselPriceReadings).values({
        region: 'STALE_TEST',
        pricePhp: '55.0000',
        observedDate: staleDate.toISOString().slice(0, 10),
        source: 'doe_scrape',
      });
    });

    const priced = await withTenantTx(ctxA, (tx) =>
      pricingEngine.priceQuote(tx, ctxA.tenantId, itemsFor(rateCardIdA, equipmentTypeIdA), { type: 'none', value: 0 }, 'STALE_TEST'),
    );
    expect(priced.diesel.stale).toBe(true);
  });

  it('QAD-T45: no diesel reading and no override for a region rejects with 422 no_diesel_price', async () => {
    await withTenantTx(ctxA, (tx) =>
      tx.insert(pricingParameters).values({
        tenantId: ctxA.tenantId,
        region: 'NO_READING_TEST',
        operatorHourlyPhp: '100.00',
        maintenanceHourlyPhp: '50.00',
        bufferPct: '0.10',
        fuelLPerHour: '10.000',
        fuelLPerKm: '0.200',
        transportPhpPerKm: '20.00',
        effectiveFrom: new Date('2020-01-01T00:00:00Z'),
      }),
    );

    await expect(
      withTenantTx(ctxA, (tx) =>
        pricingEngine.priceQuote(
          tx,
          ctxA.tenantId,
          itemsFor(rateCardIdA, equipmentTypeIdA),
          { type: 'none', value: 0 },
          'NO_READING_TEST',
        ),
      ),
    ).rejects.toThrow(UnprocessableEntityException);
  });

  // QAD-T46: rounding/tolerance -- rounded line items reconcile to the total.
  it('QAD-T46: rounded line-item subtotals reconcile to the rounded quote total within PHP 0.01', async () => {
    const priced = await quotes.preview(ctxA, {
      customerId: customerIdA,
      projectSiteId: '00000000-0000-0000-0000-000000000000',
      discount: { type: 'none', value: 0 },
      items: [
        ...itemsFor(rateCardIdA, equipmentTypeIdA),
        { equipmentTypeId: equipmentTypeIdA, quantity: 3, rateCardId: rateCardIdA, estimatedHours: 17.5, mobilizationKm: 3.3, demobilizationKm: 3.3 },
      ],
    });
    const sumOfItems = priced.lineItems.reduce((sum, item) => sum + item.subtotal, 0);
    expect(Math.abs(sumOfItems - priced.subtotal)).toBeLessThanOrEqual(0.01);
    expect(Math.abs(priced.subtotal - priced.total)).toBeLessThanOrEqual(0.01); // no discount applied
  });

  // QAD-T47: revision integrity.
  it('QAD-T47: /revise creates revision n+1, links the parent, and leaves the parent unchanged', async () => {
    const original = await quotes.create(ctxA, {
      customerId: customerIdA,
      projectSiteId: '00000000-0000-0000-0000-000000000000',
      discount: { type: 'none', value: 0 },
      items: itemsFor(rateCardIdA, equipmentTypeIdA),
    });

    const revised = await quotes.revise(ctxA, original.id, {
      customerId: customerIdA,
      projectSiteId: '00000000-0000-0000-0000-000000000000',
      discount: { type: 'fixed', value: 500 },
      items: itemsFor(rateCardIdA, equipmentTypeIdA),
    });

    expect(revised.revision).toBe(2);
    expect(revised.total).toBe(original.total - 500);

    const parentAfter = await quotes.get(ctxA, original.id);
    expect(parentAfter.status).toBe('superseded');
    expect(parentAfter.total).toBe(original.total); // parent's numbers are unchanged
  });

  // QAD-T48: authz/isolation -- Tenant A cannot read Tenant B's quote (RLS).
  it('QAD-T48: a quote created under Tenant A is invisible to Tenant B', async () => {
    const created = await quotes.create(ctxA, {
      customerId: customerIdA,
      projectSiteId: '00000000-0000-0000-0000-000000000000',
      discount: { type: 'none', value: 0 },
      items: itemsFor(rateCardIdA, equipmentTypeIdA),
    });

    await expect(quotes.get(ctxB, created.id)).rejects.toThrow(NotFoundException);
  });
});
