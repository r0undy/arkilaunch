import { createHmac } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import { invoices, payments, withTenantTx } from '@arkilaunch/db';
import type { RequestContext } from '@arkilaunch/shared';

// Shaped like a live test-mode delivery; signs both te and li since the handler's choice follows the key prefix.
export async function checkoutPaidWebhook(ctx: RequestContext, invoiceId: string, secret: string) {
  const { sessionId, amountCentavos } = await withTenantTx(ctx, async (tx) => {
    const [invoice] = await tx.select().from(invoices).where(eq(invoices.id, invoiceId));
    const [payment] = await tx
      .select()
      .from(payments)
      .where(and(eq(payments.invoiceId, invoiceId), eq(payments.status, 'pending')))
      .orderBy(desc(payments.createdAt))
      .limit(1);
    return { sessionId: payment?.providerRef ?? '', amountCentavos: Math.round(Number(invoice?.amount) * 100) };
  });
  const rawBody = JSON.stringify({
    data: {
      id: `evt_${sessionId}`,
      type: 'event',
      attributes: {
        type: 'checkout_session.payment.paid',
        livemode: false,
        data: {
          id: sessionId,
          type: 'checkout_session',
          attributes: {
            metadata: { invoice_id: invoiceId },
            payments: [{ id: `pay_${sessionId}`, attributes: { status: 'paid', amount: amountCentavos } }],
          },
        },
      },
    },
  });
  const t = Math.floor(Date.now() / 1000);
  const sig = createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
  return { rawBody, header: `t=${t},te=${sig},li=${sig}` };
}
