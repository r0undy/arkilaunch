import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { LEAKAGE_BONES, type LeakageMetric, type LeakageReport } from '@arkilaunch/shared';
import type { StatementBrand } from '../billing/statement-pdf.js';

const W = 612;
const H = 792;
const M = 48;
const INK = rgb(0.07, 0.07, 0.07);
const MUTED = rgb(0.4, 0.4, 0.4);

// Same WinAnsi rules as statement-pdf: no peso sign, ASCII only.
const php = (n: number) => `PHP ${n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const day = (iso: string) =>
  new Date(iso.length === 10 ? `${iso}T00:00:00+08:00` : iso).toLocaleDateString('en-PH', {
    month: 'short', day: 'numeric', year: 'numeric', timeZone: 'Asia/Manila',
  });
const ascii = (s: string) => s.replace(/[–—]/g, '-').replace(/[·•]/g, '|').replace(/[^\x20-\x7E]/g, '');
const label = (s: string) => s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

const NO_DATA = 'No data in period';
export function formatMetric(x: LeakageMetric): string {
  if (x.value === null) return NO_DATA;
  const v = x.value;
  const body =
    x.unit === 'php' ? php(v)
    : x.unit === 'pct' ? `${v.toFixed(1)}%`
    : x.unit === 'hours' ? `${v.toFixed(2)} h`
    : x.unit === 'days' ? `${v.toFixed(1)} days`
    : x.unit === 'km' ? `${v.toLocaleString('en-PH')} km`
    : v.toLocaleString('en-PH');
  return x.proxy ? `${body} (*)` : body;
}

// Revenue Leakage Report: maintenance data, then the fishbone causes with the tenant's own numbers, then transactions.
export async function renderLeakageReportPdf(r: LeakageReport, brand: StatementBrand): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Revenue Leakage Report ${r.period.from} to ${r.period.to}`);
  pdf.setCreator('ArkiLaunch');
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  let page: PDFPage = pdf.addPage([W, H]);
  let y = H - M;
  const write = (x: number, s: string, size = 9, f: PDFFont = font, color = INK) =>
    page.drawText(ascii(s), { x, y, size, font: f, color });
  const right = (x: number, s: string, size = 9, f: PDFFont = font, color = INK) =>
    page.drawText(ascii(s), { x: x - f.widthOfTextAtSize(ascii(s), size), y, size, font: f, color });
  const rule = (weight = 0.5) => page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: weight, color: MUTED });
  const need = (h: number) => {
    if (y - h > M + 20) return;
    page = pdf.addPage([W, H]);
    y = H - M;
  };
  // Greedy word wrap at a fixed width.
  const wrap = (s: string, width: number, size: number, f: PDFFont = font) => {
    const lines: string[] = [];
    let line = '';
    for (const word of ascii(s).split(' ')) {
      const next = line ? `${line} ${word}` : word;
      if (f.widthOfTextAtSize(next, size) > width && line) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    if (line) lines.push(line);
    return lines;
  };
  const heading = (s: string) => {
    need(40);
    y -= 6;
    write(M, s, 11, bold);
    y -= 6;
    rule(1);
    y -= 14;
  };
  const rows = (pairs: [string, string][], strongLast = false) => {
    pairs.forEach(([k, v], i) => {
      need(14);
      const strong = strongLast && i === pairs.length - 1;
      write(M, k, 9, strong ? bold : font);
      right(W - M, v, 9, strong ? bold : font);
      y -= 13;
    });
    y -= 6;
  };

  // Letterhead.
  write(M, brand.name.toUpperCase(), 14, bold);
  y -= 14;
  for (const line of [brand.address, brand.contact, brand.tin ? `TIN ${brand.tin}` : '']) {
    if (!line) continue;
    write(M, line, 8, font, MUTED);
    y -= 11;
  }
  y -= 6;
  rule(1);
  y -= 22;
  write(M, 'REVENUE LEAKAGE REPORT', 13, bold);
  y -= 14;
  write(M, 'Operations summary: from maintenance to transactions', 9, font, MUTED);
  y -= 18;
  for (const [k, v] of [
    ['Period', `${day(r.period.from)} - ${day(r.period.to)}`],
    ['Customer', r.filters.customer ?? 'All customers'],
    ['Equipment type', r.filters.equipmentType ?? 'All types'],
    ['Generated', `${new Date(r.generatedAt).toLocaleString('en-PH', { timeZone: 'Asia/Manila' })} (Manila)`],
  ] as const) {
    write(M, k, 8, bold, MUTED);
    write(M + 100, v, 9);
    y -= 13;
  }
  y -= 8;

  heading('1. Executive summary');
  rows([
    ['Invoiced', php(r.summary.invoiced)],
    ['Collected', php(r.summary.collected)],
    ['Collection rate', r.summary.collectionRatePct === null ? NO_DATA : `${r.summary.collectionRatePct.toFixed(1)}%`],
    ['Revenue captured through reconciled time records', php(r.summary.verifiedRevenue)],
    ['Outstanding (potential leakage)', php(r.summary.outstanding)],
  ], true);

  heading('2. Maintenance: master data');
  rows([
    ['Fleet units', String(r.master.fleetTotal)],
    ...Object.entries(r.master.fleetByStatus).map(([s, c]) => [`   ${label(s)}`, String(c)] as [string, string]),
    ['Units due for maintenance', String(r.master.maintenanceDue)],
    ['Customers on file', String(r.master.customersTotal)],
    ['Customers KYC-approved', String(r.master.customersKycApproved)],
    ['Project sites', String(r.master.projectSites)],
  ]);

  heading('3. Revenue leakage by root cause');
  write(M, 'Each cause from the study\'s fishbone, what the system does about it, and what it measured this period.', 8, font, MUTED);
  y -= 16;
  for (const bone of LEAKAGE_BONES) {
    const causes = r.causes.filter((c) => c.bone === bone);
    if (!causes.length) continue;
    need(60);
    write(M, bone.toUpperCase(), 10, bold);
    y -= 15;
    for (const c of causes) {
      const answer = wrap(c.answer, W - 2 * M - 12, 8);
      need(16 + answer.length * 10 + c.metrics.length * 12);
      write(M + 6, c.cause, 9, bold);
      y -= 11;
      for (const line of answer) {
        write(M + 12, line, 8, font, MUTED);
        y -= 10;
      }
      y -= 2;
      for (const x of c.metrics) {
        write(M + 12, x.label, 9);
        right(W - M, formatMetric(x), 9, x.value === null ? font : bold, x.value === null ? MUTED : INK);
        y -= 12;
      }
      y -= 6;
    }
    y -= 4;
  }

  heading('4. Transactions');
  rows([
    ['Bookings created', String(r.ledger.bookings.count)],
    ...Object.entries(r.ledger.bookings.byStatus).map(([s, c]) => [`   ${label(s)}`, String(c)] as [string, string]),
    ['Quotations issued', String(r.ledger.quotations)],
    ['Truck trips', String(r.ledger.truckTrips)],
  ]);
  const types = Object.entries(r.ledger.invoicesByType);
  rows([
    ...(types.length ? types.map(([t, a]) => [`Invoiced: ${label(t)}`, php(a)] as [string, string]) : [['Invoices', NO_DATA] as [string, string]]),
    [`Payments received (${r.ledger.payments.count} records)`, php(r.ledger.payments.paid)],
    [`Deposit deductions (${r.ledger.depositDeductions.count})`, php(r.ledger.depositDeductions.amount)],
  ]);

  need(40);
  for (const line of wrap(
    'Figures cover only this tenant and period. (*) marks a proxy metric: the cause cannot be measured directly, so the report counts the manual steps the system performed instead. Truck trips are left out when a customer or equipment filter is set.',
    W - 2 * M,
    7,
  )) {
    write(M, line, 7, font, MUTED);
    y -= 9;
  }

  const pages = pdf.getPages();
  pages.forEach((p, i) => {
    const footer = ascii(`Revenue Leakage Report  |  ${r.period.from} to ${r.period.to}  |  Page ${i + 1} of ${pages.length}`);
    p.drawText(footer, { x: M, y: M - 18, size: 7, font, color: MUTED });
  });
  return pdf.save();
}
