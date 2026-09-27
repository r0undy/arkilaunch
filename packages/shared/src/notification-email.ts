// Plain-text email for the money events (transactions and invoices). Every
// other notification type stays in-app only, so this returns null for it.

export interface InvoiceInfo {
  invoiceId: string;
  code: string | null;
  amountPhp: number;
  dueDate: Date | null;
  rentalId: string | null;
  truckRequestId: string | null;
}

const peso = (n: number) =>
  `PHP ${n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const day = (d: Date) =>
  d.toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Manila' });

const SIGN = '\n\n-- ArkiLaunch';

export function notificationEmail(
  type: string,
  inv: InvoiceInfo,
  audience: 'customer' | 'staff',
  webOrigin: string,
  payload: Record<string, unknown> = {},
  now = new Date(),
): { subject: string; text: string } | null {
  const origin = () => webOrigin.replace(/\/$/, '');
  const ref = inv.code ?? 'your booking';

  if (audience === 'customer') {
    const link = inv.truckRequestId
      ? `${origin()}/account/trucks`
      : inv.rentalId
        ? `${origin()}/account/bookings/${inv.rentalId}`
        : `${origin()}/account/invoices/${inv.invoiceId}`;
    switch (type) {
      case 'payment_received':
        return {
          subject: `Receipt: ${peso(inv.amountPhp)} paid for ${ref}`,
          text:
            `Thank you, your payment was received.\n\n` +
            `Booking: ${ref}\nAmount paid: ${peso(inv.amountPhp)}\nInvoice: ${inv.invoiceId}\nDate paid: ${day(now)}\n\n` +
            `View it: ${link}${SIGN}`,
        };
      case 'payment_failed':
        return {
          subject: `Payment for ${ref} did not go through`,
          text: `Your payment of ${peso(inv.amountPhp)} for ${ref} did not go through. Nothing was charged.\n\nTry again: ${link}${SIGN}`,
        };
      case 'payment_refunded':
        return {
          subject: `Refund issued on ${ref}`,
          text: `A refund was issued on ${ref} (invoice ${inv.invoiceId}). It can take a few banking days to reach you.\n\nView it: ${link}${SIGN}`,
        };
      case 'weekly_invoice':
        return {
          subject: `Invoice: ${peso(inv.amountPhp)} due for ${ref}`,
          text:
            `Booking ${ref} used hours past its deposit.\n\n` +
            `Amount due: ${peso(inv.amountPhp)}\n${inv.dueDate ? `Due by: ${day(inv.dueDate)}\n` : ''}Invoice: ${inv.invoiceId}\n\n` +
            `Pay it: ${origin()}/account/invoices/${inv.invoiceId}${SIGN}`,
        };
      default:
        return null;
    }
  }

  const link = `${origin()}/app/payments`;
  switch (type) {
    case 'payment_paid':
      return {
        subject: `Paid: ${peso(inv.amountPhp)} on ${ref}`,
        text: `An online payment of ${peso(inv.amountPhp)} on ${ref} was paid.\n\n${link}${SIGN}`,
      };
    case 'payment_failed':
      return {
        subject: `Payment failed on ${ref}`,
        text: `An online payment of ${peso(inv.amountPhp)} on ${ref} failed.\n\n${link}${SIGN}`,
      };
    case 'payment_amount_mismatch': {
      const paid = typeof payload.paid_centavos === 'number' ? peso(payload.paid_centavos / 100) : 'a different amount';
      return {
        subject: `Check payment on ${ref}: amount mismatch`,
        text: `A payment on ${ref} came in at ${paid}, but the invoice is ${peso(inv.amountPhp)}. It was NOT applied; review it.\n\n${link}${SIGN}`,
      };
    }
    default:
      return null;
  }
}
