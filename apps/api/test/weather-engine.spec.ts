import { describe, expect, it, beforeAll } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import postgres from 'postgres';
import { addresses, projectSites, weatherAlerts, withTenantTx } from '@arkilaunch/db';
import { WEATHER_STALE_AFTER_MINUTES, type RequestContext } from '@arkilaunch/shared';
import { SitesService } from '../src/sites/sites.service.js';
import { EventsService } from '../src/events/events.service.js';

// PRD-F5: GET /api/v1/sites/:id/weather. QAD-T5 (advisory) is exercised at
// the poller level (jobs/src/weather-poll.spec.ts); this covers the read
// endpoint's own contract -- no-reading fallback, staleness, and isolation.
// Each scenario gets its OWN project site so a later test's "latest row"
// query is never affected by an earlier test's rows for a shared site.
// (Read+write endpoints beyond weather() -- sites CRUD, deployments,
// advisories, incidents -- are covered in sites-engine.spec.ts.)
describe('SitesService (PRD-F5)', () => {
  const sites = new SitesService(new EventsService());
  let ctxA: RequestContext;
  let ctxB: RequestContext;

  beforeAll(async () => {
    const url = process.env.DATABASE_URL_DIRECT;
    if (!url) throw new Error('DATABASE_URL_DIRECT is required');
    const sql = postgres(url, { max: 1 });

    const [tenantA] = await sql`select id from tenants where slug = 'test-tenant-a'`;
    const [tenantB] = await sql`select id from tenants where slug = 'test-tenant-b'`;
    const [userA] = await sql`select id from users where tenant_id = ${(tenantA as { id: string }).id} limit 1`;
    const [userB] = await sql`select id from users where tenant_id = ${(tenantB as { id: string }).id} limit 1`;

    ctxA = { tenantId: (tenantA as { id: string }).id, userId: (userA as { id: string }).id, role: 'admin' };
    ctxB = { tenantId: (tenantB as { id: string }).id, userId: (userB as { id: string }).id, role: 'admin' };

    await sql.end();
  });

  async function createSite(ctx: RequestContext): Promise<string> {
    return withTenantTx(ctx, async (tx) => {
      const [address] = await tx
        .insert(addresses)
        .values({ tenantId: ctx.tenantId, line1: 'Sites Test Rd', city: 'Quezon City', province: 'Metro Manila', country: 'PH' })
        .returning();
      const [site] = await tx
        .insert(projectSites)
        .values({ tenantId: ctx.tenantId, addressId: address!.id, latitude: '14.676000', longitude: '121.043700' })
        .returning();
      return site!.id;
    });
  }

  it('returns a "none" advisory with isStale=true when no poll has ever run for the site', async () => {
    const siteId = await createSite(ctxA);
    const result = await sites.weather(ctxA, siteId);
    expect(result.advisory.severity).toBe('none');
    expect(result.isStale).toBe(true);
    expect(result.polledAt).toBeNull();
  });

  it('serves the latest reading with isStale=false when it is fresh', async () => {
    const siteId = await createSite(ctxA);
    await withTenantTx(ctxA, (tx) =>
      tx.insert(weatherAlerts).values({
        tenantId: ctxA.tenantId,
        projectSiteId: siteId,
        severity: 'watch',
        observed: { tempC: 31, windKph: 45, precipMm: 2, code: 3 },
        isStale: false,
        effectiveAt: new Date(),
        status: 'active',
      }),
    );

    const result = await sites.weather(ctxA, siteId);
    expect(result.advisory.severity).toBe('watch');
    expect(result.isStale).toBe(false);
    expect(result.observed.windKph).toBe(45);
  });

  it('marks a reading stale once it outlives the poll cadence grace window, even if stored isStale=false', async () => {
    const siteId = await createSite(ctxA);
    const oldEffectiveAt = new Date(Date.now() - (WEATHER_STALE_AFTER_MINUTES + 5) * 60_000);
    await withTenantTx(ctxA, (tx) =>
      tx.insert(weatherAlerts).values({
        tenantId: ctxA.tenantId,
        projectSiteId: siteId,
        severity: 'none',
        observed: { tempC: 28, windKph: 5, precipMm: 0, code: 1 },
        isStale: false,
        effectiveAt: oldEffectiveAt,
        status: 'cleared',
      }),
    );

    const result = await sites.weather(ctxA, siteId);
    expect(result.isStale).toBe(true);
  });

  it('a site under tenant A is invisible to tenant B (RLS)', async () => {
    const siteId = await createSite(ctxA);
    await expect(sites.weather(ctxB, siteId)).rejects.toThrow(NotFoundException);
  });
});
