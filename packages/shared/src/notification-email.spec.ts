import { describe, expect, it } from 'vitest';
import { notificationEmail, type InvoiceInfo } from './notification-email.js';

const inv: InvoiceInfo = {
  invoiceId: 'inv-1',
  code: 'EQR-2026-0001',
  amountPhp: 12500,
  dueDate: new Date('2026-10-04T00:00:00Z'),
  rentalId: 'r-1',
  truckRequestId: null,
};
const origin = 'https://arkilaunch.app/';

describe('notificationEmail', () => {
  it('writes a receipt for a paid booking', () => {
    const mail = notificationEmail('payment_received', inv, 'customer', origin, {}, new Date('2026-09-27T04:00:00Z'));
    expect(mail?.subject).toBe('Receipt: PHP 12,500.00 paid for EQR-2026-0001');
    expect(mail?.text).toContain('Invoice: inv-1');
    expect(mail?.text).toContain('https://arkilaunch.app/account/bookings/r-1');
  });

  it('covers the invoice, failure, refund and staff events', () => {
    expect(notificationEmail('weekly_invoice', inv, 'customer', origin)?.text).toContain('/account/invoices/inv-1');
    expect(notificationEmail('payment_failed', inv, 'customer', origin)?.text).toContain('Nothing was charged');
    expect(notificationEmail('payment_refunded', inv, 'customer', origin)).not.toBeNull();
    expect(notificationEmail('payment_paid', inv, 'staff', origin)?.text).toContain('/app/payments');
    expect(notificationEmail('payment_amount_mismatch', inv, 'staff', origin, { paid_centavos: 100000 })?.text).toContain(
      'PHP 1,000.00',
    );
  });

  it('links a truck payment to the truck requests page', () => {
    const truck = { ...inv, rentalId: null, truckRequestId: 't-1', code: 'TRK-2026-0001' };
    expect(notificationEmail('payment_received', truck, 'customer', origin)?.text).toContain('/account/trucks');
  });

  it('sends nothing for non-money events or the wrong audience', () => {
    expect(notificationEmail('quote_ready', inv, 'customer', origin)).toBeNull();
    expect(notificationEmail('payment_paid', inv, 'customer', origin)).toBeNull();
    expect(notificationEmail('weekly_invoice', inv, 'staff', origin)).toBeNull();
  });
});
