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
  rentalId: string;
  invoiceStatus: string;
}

export async function findTenantByInvoiceIdForWebhook(
  invoiceId: string,
): Promise<PaymentInvoiceLookupRow | undefined> {
  const rows = await db.execute<{
    tenant_id: string;
    invoice_id: string;
    rental_id: string;
    invoice_status: string;
  }>(sql`select * from payments_find_tenant_by_invoice(${invoiceId})`);
  const row = rows[0];
  if (!row) return undefined;
  return {
    tenantId: row.tenant_id,
    invoiceId: row.invoice_id,
    rentalId: row.rental_id,
    invoiceStatus: row.invoice_status,
  };
}
