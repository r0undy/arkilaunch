import { sql } from 'drizzle-orm';
import { db } from './client.js';

// No tenant context when a webhook arrives: narrow SECURITY DEFINER functions, not RLS tables.

export interface PaymentInvoiceLookupRow {
  tenantId: string;
  invoiceId: string;
  rentalId: string | null;
  invoiceStatus: string;
}

interface PaymentInvoiceDbRow extends Record<string, unknown> {
  tenant_id: string;
  invoice_id: string;
  rental_id: string | null;
  invoice_status: string;
}

function toLookupRow(row: PaymentInvoiceDbRow | undefined): PaymentInvoiceLookupRow | undefined {
  if (!row) return undefined;
  return { tenantId: row.tenant_id, invoiceId: row.invoice_id, rentalId: row.rental_id, invoiceStatus: row.invoice_status };
}

export async function findTenantByInvoiceIdForWebhook(invoiceId: string): Promise<PaymentInvoiceLookupRow | undefined> {
  const rows = await db.execute<PaymentInvoiceDbRow>(sql`select * from payments_find_tenant_by_invoice(${invoiceId})`);
  return toLookupRow(rows[0]);
}

// A refund event carries PayMongo's pay_... id, not our invoice metadata.
export async function findTenantByProviderPaymentIdForWebhook(
  providerPaymentId: string,
): Promise<PaymentInvoiceLookupRow | undefined> {
  const rows = await db.execute<PaymentInvoiceDbRow>(
    sql`select * from payments_find_tenant_by_provider_payment(${providerPaymentId})`,
  );
  return toLookupRow(rows[0]);
}
