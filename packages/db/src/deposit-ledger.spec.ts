import { describe, expect, it } from 'vitest';
import { crossesLowBalance, depositForQuote, resolveDepositLedger, splitDeduction } from './deposit-ledger.js';
import { customers, invoices, projectSites, rentals } from './schema/index.js';
import { withTenantTx } from './with-tenant-tx.js';
import postgres from 'postgres';

describe('deposit rollover math', () => {
  it('takes the whole charge from a deposit that covers it', () => {
    expect(splitDeduction(5000, 3400)).toEqual({ deducted: 3400, accrued: 0, balanceAfter: 1600 });
  });

  it('splits a charge past the balance into deduction + unbilled accrual', () => {
    expect(splitDeduction(1600, 3400)).toEqual({ deducted: 1600, accrued: 1800, balanceAfter: 0 });
  });

  it('accrues everything once the deposit is at zero (or somehow below)', () => {
    expect(splitDeduction(0, 850)).toEqual({ deducted: 0, accrued: 850, balanceAfter: 0 });
    expect(splitDeduction(-10, 850)).toEqual({ deducted: 0, accrued: 850, balanceAfter: 0 });
  });

  it('keeps cents exact', () => {
    expect(splitDeduction(100.1, 100.2)).toEqual({ deducted: 100.1, accrued: 0.1, balanceAfter: 0 });
  });

  it('warns once, on the charge that crosses the threshold', () => {
    expect(crossesLowBalance(5000, 1600, 900, 20)).toBe(true); // 1000 threshold crossed
    expect(crossesLowBalance(5000, 900, 500, 20)).toBe(false); // already under
    expect(crossesLowBalance(5000, 5000, 1000, 20)).toBe(true); // lands exactly on it
    expect(crossesLowBalance(0, 0, 0, 20)).toBe(false); // no deposit, nothing to warn about
  });
});

describe('depositForQuote', () => {
  const settings = { minDepositPhp: 5000, depositPct: 30 };
  it('takes the percent of the quote total', () => {
    expect(depositForQuote(settings, 123456.78)).toBe(37037.03);
  });
  it('falls back to the flat minimum without a quote total or a percent', () => {
    expect(depositForQuote(settings, null)).toBe(5000);
    expect(depositForQuote(settings, 0)).toBe(5000);
    expect(depositForQuote({ minDepositPhp: 5000, depositPct: 0 }, 100000)).toBe(5000);
  });
});

describe('resolveDepositLedger', () => {
  it('reports totalDeducted to the cent, with no float drift', async () => {
    const direct = postgres(process.env.DATABASE_URL_DIRECT ?? '', { max: 1 });
    const [tenant] = await direct`select id from tenants where slug = 'test-tenant-a'`;
    await direct.end();
    const tenantId = (tenant as { id: string }).id;
    const rollback = new Error('rollback');
    await expect(
      withTenantTx({ tenantId, userId: tenantId, role: 'admin' }, async (tx) => {
        const [customer] = await tx.select({ id: customers.id }).from(customers).limit(1);
        const [site] = await tx.select({ id: projectSites.id }).from(projectSites).limit(1);
        const [rental] = await tx
          .insert(rentals)
          .values({
            tenantId,
            customerId: customer!.id,
            projectSiteId: site!.id,
            status: 'active',
            startDate: new Date('2037-01-01T00:00:00Z'),
          })
          .returning();
        await tx.insert(invoices).values(
          ['100.10', '200.20'].map((amount) => ({
            tenantId,
            rentalId: rental!.id,
            invoiceType: 'deposit_deduction',
            amount,
            status: 'issued',
            dueDate: new Date(),
          })),
        );
        expect((await resolveDepositLedger(tx, rental!.id, tenantId)).totalDeducted).toBe(300.3);
        throw rollback;
      }),
    ).rejects.toBe(rollback);
  });
});
