import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { LEAKAGE_BONES, type LeakageReport } from '@arkilaunch/shared';
import { formatMetric, renderLeakageReportPdf } from './leakage-report-pdf.js';

const report = (metricsPerCause: number): LeakageReport => ({
  period: { from: '2026-09-01', to: '2026-09-30' },
  filters: { customer: null, equipmentType: null },
  generatedAt: '2026-09-30T05:00:00.000Z',
  summary: { invoiced: 500_000, collected: 400_000, outstanding: 100_000, collectionRatePct: 80, verifiedRevenue: 120_000 },
  master: { fleetTotal: 6, fleetByStatus: { available: 4, maintenance: 2 }, maintenanceDue: 2, customersTotal: 9, customersKycApproved: 7, projectSites: 5 },
  causes: LEAKAGE_BONES.map((bone) => ({
    bone,
    cause: `${bone} cause`,
    answer: 'What the system does about it, long enough to wrap across more than a single printed line of the report body.',
    metrics: Array.from({ length: metricsPerCause }, (_, i) => ({ label: `Metric ${i}`, value: i === 0 ? null : i, unit: 'count' as const })),
  })),
  ledger: {
    bookings: { count: 3, byStatus: { active: 2, completed: 1 } },
    quotations: 4,
    truckTrips: 1,
    invoicesByType: { booking: 300_000, weekly: 200_000 },
    payments: { count: 3, paid: 400_000 },
    depositDeductions: { count: 2, amount: 120_000 },
  },
});

const brand = { name: 'Almara Construction', address: 'Quezon City', contact: '0917 000 0000', tin: null };

describe('renderLeakageReportPdf', () => {
  it('renders a valid PDF titled with its period', async () => {
    const doc = await PDFDocument.load(await renderLeakageReportPdf(report(2), brand));
    expect(doc.getTitle()).toBe('Revenue Leakage Report 2026-09-01 to 2026-09-30');
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
  });

  it('prints the tenant icon on the letterhead, and survives a corrupt one', async () => {
    // 1x1 transparent PNG.
    const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64'));
    const withLogo = await renderLeakageReportPdf(report(2), { ...brand, logo: png });
    expect(Buffer.from(withLogo).toString('latin1')).toContain('/Subtype /Image');
    await expect(renderLeakageReportPdf(report(2), { ...brand, logo: png.slice(0, 12) })).resolves.toBeInstanceOf(Uint8Array);
  });

  it('flows onto more pages instead of running off the bottom', async () => {
    const doc = await PDFDocument.load(await renderLeakageReportPdf(report(20), brand));
    expect(doc.getPageCount()).toBeGreaterThan(2);
  });

  it('renders an empty period without throwing', async () => {
    const empty = { ...report(0), causes: [], ledger: { ...report(0).ledger, invoicesByType: {}, bookings: { count: 0, byStatus: {} } } };
    await expect(renderLeakageReportPdf(empty, brand)).resolves.toBeInstanceOf(Uint8Array);
  });
});

describe('formatMetric', () => {
  it('says so instead of printing a zero it cannot vouch for', () => {
    expect(formatMetric({ label: 'x', value: null, unit: 'php' })).toBe('No data in period');
  });
  it('marks proxy metrics', () => {
    expect(formatMetric({ label: 'x', value: 12, unit: 'count', proxy: true })).toBe('12 (*)');
    expect(formatMetric({ label: 'x', value: 80, unit: 'pct' })).toBe('80.0%');
  });
});
