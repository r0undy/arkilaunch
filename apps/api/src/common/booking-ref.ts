import { eq, inArray } from 'drizzle-orm';
import { type Tx, invoices, rentals, truckRequests } from '@arkilaunch/db';
import type { BookingService } from '@arkilaunch/shared';


// Every surface that shows a booking reference goes through here. Runs in the caller's tenant tx (RLS).

export interface BookingRef {
  service: BookingService;
  id: string;
  code: string;
}

export async function bookingCodes(
  tx: Tx,
  ids: { rentalIds?: (string | null | undefined)[]; truckRequestIds?: (string | null | undefined)[] },
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const rentalIds = [...new Set((ids.rentalIds ?? []).filter((id): id is string => Boolean(id)))];
  const truckIds = [...new Set((ids.truckRequestIds ?? []).filter((id): id is string => Boolean(id)))];
  if (rentalIds.length) {
    const rows = await tx.select({ id: rentals.id, code: rentals.code }).from(rentals).where(inArray(rentals.id, rentalIds));
    for (const row of rows) out.set(row.id, row.code);
  }
  if (truckIds.length) {
    const rows = await tx
      .select({ id: truckRequests.id, code: truckRequests.code })
      .from(truckRequests)
      .where(inArray(truckRequests.id, truckIds));
    for (const row of rows) out.set(row.id, row.code);
  }
  return out;
}

// A rental wins if (defensively) both are set.
export function invoiceBookingRef(
  invoice: { rentalId: string | null; truckRequestId: string | null },
  codes: Map<string, string>,
): BookingRef | null {
  if (invoice.rentalId) {
    const code = codes.get(invoice.rentalId);
    return code ? { service: 'rental', id: invoice.rentalId, code } : null;
  }
  if (invoice.truckRequestId) {
    const code = codes.get(invoice.truckRequestId);
    return code ? { service: 'truck', id: invoice.truckRequestId, code } : null;
  }
  return null;
}

export async function resolveBookingRef(
  tx: Tx,
  payload: { rental_id?: unknown; truck_request_id?: unknown; invoice_id?: unknown },
): Promise<BookingRef | null> {
  const str = (v: unknown) => (typeof v === 'string' && v.length > 0 ? v : null);
  let ref = { rentalId: str(payload.rental_id), truckRequestId: str(payload.truck_request_id) };
  const invoiceId = str(payload.invoice_id);
  if (!ref.rentalId && !ref.truckRequestId && invoiceId) {
    const [invoice] = await tx
      .select({ rentalId: invoices.rentalId, truckRequestId: invoices.truckRequestId })
      .from(invoices)
      .where(eq(invoices.id, invoiceId))
      .limit(1);
    if (invoice) ref = invoice;
  }
  return invoiceBookingRef(ref, await bookingCodes(tx, { rentalIds: [ref.rentalId], truckRequestIds: [ref.truckRequestId] }));
}
