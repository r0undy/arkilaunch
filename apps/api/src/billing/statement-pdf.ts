import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import type { StatementOfAccount } from '@arkilaunch/shared';

export interface StatementBrand {
  name: string;
  address: string;
  contact: string;
  tin: string | null;
}

const INVOICE_TYPES: Record<string, string> = {
  deposit: 'Deposit',
  deposit_deduction: 'Deposit deduction',
  rental: 'Rental',
  penalty: 'Penalty',
  adjustment: 'Adjustment',
  booking: 'Rental and deposit',
};

const W = 612;
const H = 792;
const M = 48;
const INK = rgb(0.07, 0.07, 0.07);
const MUTED = rgb(0.4, 0.4, 0.4);

// Standard fonts are WinAnsi: no peso sign, so amounts print as "PHP".
const php = (n: number) => `PHP ${n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const day = (iso: string) =>
  new Date(iso).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'Asia/Manila' });
const ascii = (s: string) => s.replace(/[–—]/g, '-').replace(/[·•]/g, '|').replace(/[^\x20-\x7E]/g, '');

// The whole-span Statement of Account, one PDF for both the customer download and the office email.
export async function renderStatementPdf(soa: StatementOfAccount, brand: StatementBrand): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Statement of Account ${soa.bookingCode ?? ''}`.trim());
  pdf.setCreator('ArkiLaunch');
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  let page: PDFPage = pdf.addPage([W, H]);
  let y = H - M;
  const write = (x: number, s: string, size = 9, f: PDFFont = font, color = INK) =>
    page.drawText(ascii(s), { x, y, size, font: f, color });
  const right = (x: number, s: string, size = 9, f: PDFFont = font) =>
    page.drawText(ascii(s), { x: x - f.widthOfTextAtSize(ascii(s), size), y, size, font: f, color: INK });
  const rule = (weight = 0.5) => page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: weight, color: MUTED });
  const need = (h: number) => {
    if (y - h > M + 20) return;
    page = pdf.addPage([W, H]);
    y = H - M;
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
  write(M, 'STATEMENT OF ACCOUNT', 13, bold);
  right(W - M, soa.bookingCode ?? '', 11, bold);
  y -= 18;

  const facts: [string, string][] = [
    ['Bill to', soa.company?.name ?? '-'],
    ['Customer TIN', soa.company?.tin ?? '-'],
    ['Billing address', soa.company?.billingAddress ?? '-'],
    ['Rental period', `${day(soa.rentalStart)} - ${soa.rentalEnd ? day(soa.rentalEnd) : 'open'}`],
    ['Status', soa.status],
    ['Generated', day(soa.generatedAt)],
  ];
  for (const [label, value] of facts) {
    write(M, label, 8, bold, MUTED);
    write(M + 100, value, 9);
    y -= 13;
  }
  y -= 10;

  const table = (title: string, heads: string[], cols: number[], rows: string[][]) => {
    need(40);
    write(M, title, 10, bold);
    y -= 14;
    heads.forEach((h, i) => (i === 0 ? write(cols[i]!, h, 8, bold, MUTED) : right(cols[i]!, h, 8, bold)));
    y -= 5;
    rule();
    y -= 12;
    if (rows.length === 0) {
      write(M, 'None', 9, font, MUTED);
      y -= 13;
    }
    for (const row of rows) {
      need(14);
      row.forEach((cell, i) => (i === 0 ? write(cols[i]!, cell) : right(cols[i]!, cell)));
      y -= 13;
    }
    y -= 10;
  };

  const weekSum = (k: 'amount' | 'fromDeposit' | 'customerPays' | 'paid' | 'outstanding') =>
    soa.weeks.reduce((t, w) => t + w[k], 0);
  need(40);
  write(M, 'Hours beyond the deposit are billed weekly and payable by the customer.', 8, font, MUTED);
  y -= 14;
  table(
    'Hours by week',
    ['Week', 'Hours', 'Amount', 'From deposit', 'Customer pays', 'Paid', 'Outstanding'],
    [M, 200, 262, 330, 400, 466, W - M],
    [
      ...soa.weeks.map((w) => [
        `${day(w.weekStart)} - ${day(w.weekEnd)}`,
        w.hours.toFixed(2),
        php(w.amount),
        php(w.fromDeposit),
        php(w.customerPays),
        php(w.paid),
        php(w.outstanding),
      ]),
      ...(soa.weeks.length
        ? [['TOTAL', '', php(weekSum('amount')), php(weekSum('fromDeposit')), php(weekSum('customerPays')), php(weekSum('paid')), php(weekSum('outstanding'))]]
        : []),
    ],
  );
  table(
    'Invoices',
    ['Type', 'Issued', 'Due', 'Status', 'Amount'],
    [M, 280, 360, 440, W - M],
    soa.invoices.map((i) => [INVOICE_TYPES[i.invoiceType] ?? i.invoiceType, day(i.createdAt), day(i.dueDate), i.status, php(i.amount)]),
  );
  table(
    'Payments',
    ['Method', 'Date', 'Status', 'Amount'],
    [M, 330, 440, W - M],
    soa.payments.map((p) => [p.method, day(p.createdAt), p.status, php(p.amount)]),
  );

  need(110);
  write(M, 'Summary', 10, bold);
  y -= 16;
  const summary: [string, number, boolean?][] = [
    ['Deposit required', soa.deposit.required],
    ['Deducted from deposit', soa.deposit.deducted],
    ['Deposit remaining', soa.deposit.remaining],
    ['Total charged', soa.totals.charged],
    ['Total paid', soa.totals.paid],
    ['Weekly billings outstanding', weekSum('outstanding')],
    ['Unbilled hours to date', soa.totals.unbilled],
    ['BALANCE DUE', soa.totals.balanceDue, true],
  ];
  for (const [label, amount, strong] of summary) {
    if (strong) {
      y -= 2;
      rule();
      y -= 12;
    }
    write(W - M - 230, label, strong ? 10 : 9, strong ? bold : font);
    right(W - M, php(amount), strong ? 10 : 9, strong ? bold : font);
    y -= 13;
  }

  const pages = pdf.getPages();
  pages.forEach((p, i) => {
    const footer = ascii(`${soa.bookingCode ?? ''}  |  Statement of Account  |  Page ${i + 1} of ${pages.length}`);
    p.drawText(footer, { x: M, y: M - 18, size: 7, font, color: MUTED });
  });
  return pdf.save();
}
