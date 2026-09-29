import { eq, inArray } from 'drizzle-orm';
import { type Tx, invoices, rentals, truckRequests } from '@arkilaunch/db';
import type { BookingService } from '@arkilaunch/shared';


// The one place that turns a rental / truck request / invoice id into the
// booking reference people read (EQR-… / TRK-…, cr-arkilaunch-uniform-
// booking-codes.md). Everything that shows or writes a booking reference --
// invoice responses, notification payloads, payment descriptions, EDTR
// invoice lines -- goes through here, so no surface can drift back to a
// UUID fragment. Runs inside the caller's tenant transaction (RLS scopes it).

export interface BookingRef {
  service: BookingService;
  id: string;
  code: string;
}

// Codes for many rentals and truck requests in two queries.
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

// The booking an invoice bills. A rental wins if (defensively) both are set.
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

// Resolves whichever booking a notification / event payload points at:
// rental_id, truck_request_id, or (payments) an invoice_id standing in for
// the booking it bills. Null when the payload names no booking.
export async function resolveBookingRef(
  tx: Tx,
  payload: { rental_id?: unknown; truck_request_id?: unknown; invoice_id?: unknown },
): Promise<BookingRef | null> {
  const str = (v: unknown) => (typeof v === 'string' && v.length > 0 ? v : null);
  let rentalId = str(payload.rental_id);
  let truckId = str(payload.truck_request_id);
  const invoiceId = str(payload.invoice_id);
  if (!rentalId && !truckId && invoiceId) {
    const [invoice] = await tx
      .select({ rentalId: invoices.rentalId, truckRequestId: invoices.truckRequestId })
      .from(invoices)
      .where(eq(invoices.id, invoiceId))
      .limit(1);
    rentalId = invoice?.rentalId ?? null;
    truckId = invoice?.truckRequestId ?? null;
  }
  if (rentalId) {
    const [row] = await tx.select({ code: rentals.code }).from(rentals).where(eq(rentals.id, rentalId)).limit(1);
    return row ? { service: 'rental', id: rentalId, code: row.code } : null;
  }
  if (truckId) {
    const [row] = await tx
      .select({ code: truckRequests.code })
      .from(truckRequests)
      .where(eq(truckRequests.id, truckId))
      .limit(1);
    return row ? { service: 'truck', id: truckId, code: row.code } : null;
  }
  return null;
}
