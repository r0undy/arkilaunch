import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import type { StatementOfAccount } from '@arkilaunch/shared';
import { renderStatementPdf } from './statement-pdf.js';

const soa = (weeks: number): StatementOfAccount => ({
  rentalId: 'r',
  bookingCode: 'EQR-2026-0042',
  status: 'completed',
  rentalStart: '2026-09-01T00:00:00.000Z',
  rentalEnd: '2026-09-28T00:00:00.000Z',
  company: { name: 'Acme Builders Inc.', tin: '123-456-789-000', billingAddress: 'Quezon City' },
  weeks: Array.from({ length: weeks }, (_, i) => ({
    weekStart: `2026-09-${String(1 + i * 7).padStart(2, '0')}`,
    weekEnd: `2026-09-${String(7 + i * 7).padStart(2, '0')}`,
    hours: 40,
    amount: 60_000,
    fromDeposit: 10_000,
    invoiced: 50_000,
    unbilled: 0,
  })),
  invoices: [{ id: 'i', invoiceType: 'booking', amount: 150_000, status: 'paid', createdAt: '2026-09-01T00:00:00.000Z', dueDate: '2026-09-02T00:00:00.000Z' }],
  payments: [{ id: 'p', invoiceId: 'i', method: 'gcash', amount: 150_000, status: 'paid', createdAt: '2026-09-01T00:00:00.000Z' }],
  deposit: { required: 50_000, deducted: 40_000, remaining: 10_000 },
  totals: { charged: 150_000, paid: 150_000, unbilled: 0, balanceDue: 0 },
  generatedAt: '2026-09-30T00:00:00.000Z',
});

const brand = { name: 'Almara Construction', address: 'Quezon City', contact: '0917 000 0000', tin: '000-111-222-000' };

describe('renderStatementPdf', () => {
  it('renders a valid PDF with the booking in its title', async () => {
    const doc = await PDFDocument.load(await renderStatementPdf(soa(4), brand));
    expect(doc.getTitle()).toBe('Statement of Account EQR-2026-0042');
    expect(doc.getPageCount()).toBe(1);
  });

  it('flows a long rental onto more pages instead of running off the bottom', async () => {
    const doc = await PDFDocument.load(await renderStatementPdf(soa(60), brand));
    expect(doc.getPageCount()).toBeGreaterThan(1);
  });

  it('prints names with characters the standard font cannot encode', async () => {
    await expect(renderStatementPdf(soa(1), { ...brand, name: 'Almara – Peñafrancia · Builders ₱' })).resolves.toBeInstanceOf(Uint8Array);
  });
});
