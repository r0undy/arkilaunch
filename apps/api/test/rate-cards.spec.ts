import { describe, expect, it, beforeAll } from 'vitest';
import { ConflictException, NotFoundException } from '@nestjs/common';
import postgres from 'postgres';
import { eq } from 'drizzle-orm';
import { rateCards, tenants, withTenantTx } from '@arkilaunch/db';
import type { RequestContext } from '@arkilaunch/shared';
import { PricingService } from '../src/pricing/pricing.service.js';

// S18 Rate Cards & Tenant Settings (PRD-F1/F7, QAD-T44/T19/T24). Uses a
// dedicated equipment_types row so this file's writes never touch the
// shared seeded rate card quotes-engine.spec.ts prices against.
describe('PricingService: rate cards + tenant settings (S18)', () => {
  const pricing = new PricingService();
  let adminCtxA: RequestContext;
  let adminCtxB: RequestContext;
  let dedicatedEquipmentTypeId: string;

  beforeAll(async () => {
    const url = process.env.DATABASE_URL_DIRECT;
    if (!url) throw new Error('DATABASE_URL_DIRECT is required');
    const sql = postgres(url, { max: 1 });

    const [tenantA] = await sql`select id from tenants where slug = 'test-tenant-a'`;
    const [tenantB] = await sql`select id from tenants where slug = 'test-tenant-b'`;
    const tenantIdA = (tenantA as { id: string }).id;
    const tenantIdB = (tenantB as { id: string }).id;
    const [adminA] = await sql`select id from users where tenant_id = ${tenantIdA} and email = 'admin@test-tenant-a.test'`;
    const [adminB] = await sql`select id from users where tenant_id = ${tenantIdB} and email = 'admin@test-tenant-b.test'`;

    const [equipmentType] = await sql`
      insert into equipment_types (name) values (${`Rate Card Test Type ${Date.now()}`}) returning id
    `;

    adminCtxA = { tenantId: tenantIdA, userId: (adminA as { id: string }).id, role: 'admin' };
    adminCtxB = { tenantId: tenantIdB, userId: (adminB as { id: string }).id, role: 'admin' };
    dedicatedEquipmentTypeId = (equipmentType as { id: string }).id;

    await sql.end();
  });

  it('creates an open-ended rate card and lists it', async () => {
    const created = await pricing.createRateCard(adminCtxA, {
      equipmentTypeId: dedicatedEquipmentTypeId,
      rateType: 'hourly',
      rateValue: 500,
      currency: 'PHP',
    });
    expect(created!.rateValue).toBe('500.00');

    const { items } = await pricing.listRateCards(adminCtxA, {
      equipmentTypeId: dedicatedEquipmentTypeId,
      includeSuperseded: false,
    });
    expect(items.some((row) => row.id === created!.id)).toBe(true);
  });

  it('rejects a second open-ended card for the same equipment type + rate type (window overlap)', async () => {
    await expect(
      pricing.createRateCard(adminCtxA, {
        equipmentTypeId: dedicatedEquipmentTypeId,
        rateType: 'hourly',
        rateValue: 600,
        currency: 'PHP',
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('supersede closes the old row (rate_value unchanged) and inserts a successor with the new value', async () => {
    const { items } = await pricing.listRateCards(adminCtxA, {
      equipmentTypeId: dedicatedEquipmentTypeId,
      includeSuperseded: false,
    });
    const current = items[0]!;
    const originalRateValue = current.rateValue;

    const superseded = await pricing.supersedeRateCard(adminCtxA, current.id, { rateValue: 750 });
    expect(superseded.supersededId).toBe(current.id);

    const [oldRow] = await withTenantTx(adminCtxA, (tx) =>
      tx.select().from(rateCards).where(eq(rateCards.id, current.id)),
    );
    // T44: the superseded row's rate_value is UNCHANGED -- only effective_to moved.
    expect(oldRow!.rateValue).toBe(originalRateValue);
    expect(oldRow!.effectiveTo).not.toBeNull();

    const [newRow] = await withTenantTx(adminCtxA, (tx) =>
      tx.select().from(rateCards).where(eq(rateCards.id, superseded.id)),
    );
    expect(newRow!.rateValue).toBe('750.00');
  });

  it('the pick-list (includeSuperseded=false) excludes the superseded card and includes the successor', async () => {
    const { items } = await pricing.listRateCards(adminCtxA, {
      equipmentTypeId: dedicatedEquipmentTypeId,
      includeSuperseded: false,
    });
    expect(items.length).toBe(1);
    expect(items[0]!.rateValue).toBe('750.00');

    const all = await pricing.listRateCards(adminCtxA, {
      equipmentTypeId: dedicatedEquipmentTypeId,
      includeSuperseded: true,
    });
    expect(all.items.length).toBe(2);
  });

  it('retire closes the window without deleting the row', async () => {
    const { items } = await pricing.listRateCards(adminCtxA, {
      equipmentTypeId: dedicatedEquipmentTypeId,
      includeSuperseded: false,
    });
    const current = items[0]!;

    await pricing.retireRateCard(adminCtxA, current.id);

    const [row] = await withTenantTx(adminCtxA, (tx) => tx.select().from(rateCards).where(eq(rateCards.id, current.id)));
    expect(row).toBeDefined();
    expect(row!.effectiveTo).not.toBeNull();

    const { items: currentAfter } = await pricing.listRateCards(adminCtxA, {
      equipmentTypeId: dedicatedEquipmentTypeId,
      includeSuperseded: false,
    });
    expect(currentAfter.length).toBe(0);
  });

  it('a tenant-B ctx cannot read or supersede a tenant-A rate card (T24)', async () => {
    const { items } = await pricing.listRateCards(adminCtxA, {
      equipmentTypeId: dedicatedEquipmentTypeId,
      includeSuperseded: true,
    });
    const tenantACardId = items[0]!.id;

    const fromB = await pricing.listRateCards(adminCtxB, { equipmentTypeId: dedicatedEquipmentTypeId, includeSuperseded: true });
    expect(fromB.items.length).toBe(0);

    await expect(pricing.supersedeRateCard(adminCtxB, tenantACardId, { rateValue: 1 })).rejects.toThrow(NotFoundException);
  });

  describe('tenant settings (PATCH /tenants/me)', () => {
    it('legalName is updatable; status/kycState are never touched by this write', async () => {
      const { TenantsService } = await import('../src/tenants/tenants.service.js');
      const tenantsService = new TenantsService();

      const before = await tenantsService.me(adminCtxA);
      const updated = await tenantsService.updateSettings(adminCtxA, { legalName: 'Updated Legal Name Co.' });
      expect(updated!.legalName).toBe('Updated Legal Name Co.');
      expect(updated!.status).toBe(before!.status);
      expect(updated!.kycState).toBe(before!.kycState);

      const [row] = await withTenantTx(adminCtxA, (tx) => tx.select().from(tenants).where(eq(tenants.id, adminCtxA.tenantId)));
      expect(row!.legalName).toBe('Updated Legal Name Co.');
    });
  });
});
