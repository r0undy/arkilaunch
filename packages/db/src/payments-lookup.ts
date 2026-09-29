import { sql } from 'drizzle-orm';
import { db } from './client.js';

// Pre-tenant-context lookup for the PayMongo webhook only (see
// migrations/0006_paymongo_webhook_lookup.sql). Calls a narrow SECURITY
// DEFINER function, not an RLS-protected table directly -- there is no
// tenant context yet when a webhook arrives, same rationale as
// auth-lookup.ts's login/refresh functions.

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

// The refund webhook's pre-tenant lookup (migration 0053): a refund event
// carries PayMongo's pay_... id, not our invoice metadata.
export async function findTenantByProviderPaymentIdForWebhook(
  providerPaymentId: string,
): Promise<PaymentInvoiceLookupRow | undefined> {
  const rows = await db.execute<PaymentInvoiceDbRow>(
    sql`select * from payments_find_tenant_by_provider_payment(${providerPaymentId})`,
  );
  return toLookupRow(rows[0]);
}
