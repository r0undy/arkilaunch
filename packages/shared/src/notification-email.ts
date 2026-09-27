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

// The tenant's storefront branding (tenants.logo_key / primary_color,
// migration 0051), rendered into the HTML part of the email.
export interface EmailBrand {
  name: string;
  logoUrl: string | null;
  color: string | null; // #rrggbb
}

const FALLBACK_COLOR = '#1f2933';

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Black or white text, whichever reads better on the brand color (WCAG
// relative luminance), so a pale brand yellow still gets legible text.
export function textOn(hex: string): '#000000' | '#ffffff' {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.179 ? '#000000' : '#ffffff';
}

// The HTML part, derived from the plain-text body so the two never drift:
// paragraphs stay paragraphs, a line ending in a URL becomes a button in the
// brand color. Table layout and inline styles because mail clients strip
// <style> and flexbox.
export function renderEmailHtml(brand: EmailBrand, text: string): string {
  const color = brand.color && /^#[0-9a-f]{6}$/i.test(brand.color) ? brand.color : FALLBACK_COLOR;
  const ink = textOn(color);
  const name = escapeHtml(brand.name);
  const header = brand.logoUrl
    ? `<img src="${escapeHtml(brand.logoUrl)}" alt="${name}" height="40" style="display:block;max-height:40px;border:0">`
    : `<span style="font-size:20px;font-weight:700;color:${ink}">${name}</span>`;
  const body = text
    .replace(/\n\n-- ArkiLaunch$/, '')
    .split('\n\n')
    .map((para) => {
      const url = para.match(/^(.*?)(https?:\/\/\S+)$/s);
      if (url) {
        const label = url[1]!.trim().replace(/:$/, '') || 'Open';
        return `<p style="margin:24px 0"><a href="${escapeHtml(url[2]!)}" style="background:${color};color:${ink};padding:12px 20px;border-radius:6px;text-decoration:none;font-weight:600;display:inline-block">${escapeHtml(label)}</a></p>`;
      }
      return `<p style="margin:0 0 16px">${escapeHtml(para).replace(/\n/g, '<br>')}</p>`;
    })
    .join('');
  return (
    `<!doctype html><html><body style="margin:0;background:#f4f5f7;font-family:Arial,Helvetica,sans-serif;color:#1f2933">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:24px 0"><tr><td align="center">` +
    `<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:8px;overflow:hidden">` +
    `<tr><td style="background:${color};padding:20px 24px">${header}</td></tr>` +
    `<tr><td style="padding:24px;font-size:15px;line-height:1.5">${body}</td></tr>` +
    `<tr><td style="padding:16px 24px;border-top:1px solid #e4e7eb;font-size:12px;color:#616e7c">${name} &middot; sent via ArkiLaunch</td></tr>` +
    `</table></td></tr></table></body></html>`
  );
}
