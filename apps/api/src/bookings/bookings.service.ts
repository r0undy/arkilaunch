import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, inArray, ne } from 'drizzle-orm';
import {
  addresses,
  auditLogs,
  bookingChangeRequests,
  equipment,
  equipmentAssignments,
  invoices,
  negotiationMessages,
  payments,
  projectSites,
  quotations,
  rentals,
  resolveDepositLedger,
  withTenantTx,
  type db,
} from '@arkilaunch/db';
import type {
  ChangeRequestCreate,
  ChangeRequestResolve,
  NegotiationMessageCreate,
  NegotiationMessageResponse,
  BookingCreateRequest,
  BookingListQuery,
  BookingCreateResponse,
  BookingDetailResponse,
  BookingListResponse,
  RequestContext,
} from '@arkilaunch/shared';
import { EventsService } from '../events/events.service.js';
import { findAvailableAlternatives, overlappingAssignments } from '../common/equipment-availability.js';
import { ownCustomers, ownsCustomer } from '../common/customer-scope.js';
import { countRows } from '../common/count-rows.js';
import { notifyBookingCustomer, notifyStaff } from '../common/notify-customer.js';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// Once money has moved the customer asks rather than acts: a paid booking
// is cancelled or moved only by staff, who also handle the manual refund.
const CUSTOMER_SELF_CANCEL_STATUSES = ['pending'];

// A booking IS a `rentals` row plus one `equipment_assignments` row per
// item -- no new table (SDD §3's 35-table catalog already models an order
// as a rental; cr-arkilaunch-f2-f8-bookings-payments.md).
@Injectable()
export class BookingsService {
  constructor(private readonly events: EventsService) {}

  // POST /api/v1/bookings (SDD §4, PRD-F8 US-09). Never overbooks: the
  // candidate equipment rows are locked with FOR UPDATE before the overlap
  // check, so a concurrent booking attempt on the same unit/window is
  // serialized rather than racing past this check (QAD-T21).
  async create(ctx: RequestContext, body: BookingCreateRequest): Promise<BookingCreateResponse> {
    return withTenantTx(ctx, async (tx) => {
      let customerId = body.customerId;
      if (ctx.role === 'customer') {
        const own = await ownCustomers(tx, ctx);
        if (own.length === 0) throw new ForbiddenException({ error: 'customer_profile_not_found' });
        if (body.customerId && !own.some((row) => row.id === body.customerId)) {
          await tx.insert(auditLogs).values({
            tenantId: ctx.tenantId,
            actorId: ctx.userId,
            action: 'CREATE',
            entity: 'booking_customer_scope_denied',
            entityId: own[0]!.id,
          });
          await this.events.emit(ctx, 'booking_customer_scope_denied', { customer_id: body.customerId });
          throw new ForbiddenException({ error: 'customer_scope_denied' });
        }
        if (!body.customerId && own.length > 1) throw new ConflictException({ error: 'company_required' });
        customerId = body.customerId ?? own[0]!.id;
      }
      if (!customerId) throw new NotFoundException({ error: 'customer_id_required' });

      const [site] = await tx.select().from(projectSites).where(eq(projectSites.id, body.projectSiteId)).limit(1);
      if (!site) throw new NotFoundException({ error: 'project_site_not_found' });
      // A site a customer added belongs to that company; nobody else books
      // onto it. The yard's own sites (customer_id null) stay open.
      if (site.customerId && site.customerId !== customerId) {
        throw new NotFoundException({ error: 'project_site_not_found' });
      }

      const equipmentIds = body.items.map((item) => item.equipmentId);
      const equipmentRows = await tx
        .select()
        .from(equipment)
        .where(inArray(equipment.id, equipmentIds))
        .for('update');
      const equipmentById = new Map(equipmentRows.map((row) => [row.id, row]));

      for (const item of body.items) {
        const equipmentRow = equipmentById.get(item.equipmentId);
        if (!equipmentRow) throw new NotFoundException({ error: 'equipment_not_found', equipmentId: item.equipmentId });

        // Both refusals below are 'equipment_unavailable', which left the
        // customer unable to tell "this machine is off the road" from "those
        // particular dates are taken" -- the second is fixed by picking other
        // dates, the first is not. `reason` separates them.
        if (equipmentRow.availabilityStatus !== 'available') {
          const alternatives = await findAvailableAlternatives(tx, equipmentRow.equipmentTypeId, item, equipmentIds);
          throw new ConflictException({
            error: 'equipment_unavailable',
            reason: 'not_in_service',
            status: equipmentRow.availabilityStatus,
            equipmentId: item.equipmentId,
            alternatives,
          });
        }

        const overlapping = await overlappingAssignments(tx, item.equipmentId, item);
        if (overlapping.length > 0) {
          const alternatives = await findAvailableAlternatives(tx, equipmentRow.equipmentTypeId, item, equipmentIds);
          throw new ConflictException({
            error: 'equipment_unavailable',
            reason: 'dates_taken',
            equipmentId: item.equipmentId,
            alternatives,
          });
        }
      }

      const startDate = new Date(Math.min(...body.items.map((item) => new Date(item.start).getTime())));
      const endDate = new Date(Math.max(...body.items.map((item) => new Date(item.end).getTime())));

      const [rental] = await tx
        .insert(rentals)
        .values({
          tenantId: ctx.tenantId,
          customerId,
          projectSiteId: body.projectSiteId,
          siteContact: body.siteContact || null,
          siteNotes: body.siteNotes || null,
          status: 'pending',
          startDate,
          endDate,
        })
        .returning();
      if (!rental) throw new Error('rentals insert returned no row');

      for (const item of body.items) {
        await tx.insert(equipmentAssignments).values({
          tenantId: ctx.tenantId,
          equipmentId: item.equipmentId,
          rentalId: rental.id,
          start: new Date(item.start),
          end: new Date(item.end),
          status: 'scheduled',
        });
      }

      await tx.insert(auditLogs).values({
        tenantId: ctx.tenantId,
        actorId: ctx.userId,
        action: 'CREATE',
        entity: 'rentals',
        entityId: rental.id,
      });
      await this.events.emit(ctx, 'booking_created', { rental_id: rental.id, item_count: body.items.length });
      if (ctx.role === 'customer') {
        await notifyStaff(tx, ctx.tenantId, 'booking_requested', { rental_id: rental.id, item_count: body.items.length });
      }

      return { id: rental.id, status: rental.status, trackerUrl: `/orders/${rental.id}` };
    });
  }

  // GET /api/v1/bookings (PRD-F8 US-09). A `customer` sees only their own
  // bookings; staff see the whole tenant (RLS is the tenant boundary,
  // matching reference/* and fleet's read posture).
  async list(ctx: RequestContext, query: BookingListQuery): Promise<BookingListResponse> {
    return withTenantTx(ctx, async (tx) => {
      // The role branch was always correct; it was the BOUND that was
      // missing, on both branches (audit-api-surface.md #5).
      let where;
      if (ctx.role === 'customer') {
        const own = await ownCustomers(tx, ctx);
        if (own.length === 0) return { items: [], total: 0 };
        where = inArray(rentals.customerId, own.map((row) => row.id));
      }
      const rows = await tx
        .select()
        .from(rentals)
        .where(where)
        .orderBy(desc(rentals.createdAt))
        .limit(query.limit)
        .offset(query.offset);
      const total = await countRows(tx, rentals, where);
      if (rows.length === 0) return { items: [], total };

      // Human-readable location (a booking is never shown as a bare
      // project_site_id UUID) -- same address-via-site join sites.service.ts
      // uses for GET /sites.
      const siteRows = await tx
        .select({ id: projectSites.id, city: addresses.city, province: addresses.province })
        .from(projectSites)
        .leftJoin(addresses, eq(addresses.id, projectSites.addressId))
        .where(inArray(projectSites.id, rows.map((row) => row.projectSiteId)));
      const siteById = new Map(siteRows.map((site) => [site.id, site]));

      return {
        items: rows.map((row) => {
          const site = siteById.get(row.projectSiteId);
          return {
            id: row.id,
            status: row.status,
            projectSiteId: row.projectSiteId,
            siteCity: site?.city ?? null,
            siteProvince: site?.province ?? null,
          };
        }),
        total,
      };
    });
  }

  // GET /api/v1/bookings/:id (SDD §4 transaction tracker, US-09 AC1). Never
  // stores or returns card/account data (US-08 AC1) -- only provider_ref +
  // status from `payments`.
  async get(ctx: RequestContext, id: string): Promise<BookingDetailResponse> {
    return withTenantTx(ctx, async (tx) => {
      const rental = await this.visibleRental(tx, ctx, id);

      const assignments = await tx
        .select()
        .from(equipmentAssignments)
        .where(eq(equipmentAssignments.rentalId, id));
      const [quotation] = await tx
        .select()
        .from(quotations)
        .where(eq(quotations.rentalId, id))
        .orderBy(desc(quotations.createdAt))
        .limit(1);
      const invoiceRows = await tx.select().from(invoices).where(eq(invoices.rentalId, id));
      const paymentRows = invoiceRows.length
        ? await tx
            .select()
            .from(payments)
            .where(
              inArray(
                payments.invoiceId,
                invoiceRows.map((invoice) => invoice.id),
              ),
            )
        : [];
      const [site] = await tx
        .select({ city: addresses.city, province: addresses.province })
        .from(projectSites)
        .leftJoin(addresses, eq(addresses.id, projectSites.addressId))
        .where(eq(projectSites.id, rental.projectSiteId))
        .limit(1);
      const ledger = await resolveDepositLedger(tx, id);
      const changeRows = await tx
        .select()
        .from(bookingChangeRequests)
        .where(eq(bookingChangeRequests.rentalId, id))
        .orderBy(desc(bookingChangeRequests.createdAt));

      return {
        id: rental.id,
        status: rental.status,
        projectSiteId: rental.projectSiteId,
        siteCity: site?.city ?? null,
        siteProvince: site?.province ?? null,
        trackerUrl: `/orders/${rental.id}`,
        customerId: rental.customerId,
        siteContact: rental.siteContact,
        siteNotes: rental.siteNotes,
        createdAt: rental.createdAt,
        deposit: {
          required: ledger.depositRequired,
          totalDeducted: ledger.totalDeducted,
          deductions: ledger.deductions,
        },
        changeRequests: changeRows.map((row) => ({
          id: row.id,
          kind: row.kind,
          requestedEnd: row.requestedEnd,
          reason: row.reason,
          status: row.status,
          createdAt: row.createdAt,
        })),
        items: assignments.map((assignment) => ({
          equipmentId: assignment.equipmentId,
          start: assignment.start,
          end: assignment.end,
          status: assignment.status,
        })),
        quotation: quotation
          ? {
              id: quotation.id,
              revision: quotation.revision,
              status: quotation.status,
              totalPhp: quotation.totalPhp !== null ? Number(quotation.totalPhp) : null,
              createdAt: quotation.createdAt,
            }
          : null,
        invoices: invoiceRows.map((invoice) => ({
          id: invoice.id,
          invoiceType: invoice.invoiceType,
          amount: Number(invoice.amount),
          status: invoice.status,
        })),
        payments: paymentRows.map((payment) => ({
          id: payment.id,
          method: payment.method,
          amount: Number(payment.amount),
          status: payment.status,
          providerRef: payment.providerRef,
        })),
      };
    });
  }

  // PATCH /api/v1/bookings/:id/cancel ("modify orders", US-09). Frees the
  // unit's assignments so a later booking can use the same window. A
  // customer can only do this before paying; after that it is a change
  // request (requestChange) that staff resolve.
  async cancel(ctx: RequestContext, id: string) {
    return withTenantTx(ctx, async (tx) => {
      const rental = await this.visibleRental(tx, ctx, id);
      if (rental.status === 'cancelled') {
        throw new ConflictException({ error: 'already_cancelled' });
      }
      if (ctx.role === 'customer' && !CUSTOMER_SELF_CANCEL_STATUSES.includes(rental.status)) {
        throw new ConflictException({ error: 'cancel_needs_request', status: rental.status });
      }
      await this.cancelRental(tx, ctx, id);
      return { id, status: 'cancelled' };
    });
  }

  // GET /bookings/:id/messages: the negotiation thread, oldest first.
  async listMessages(ctx: RequestContext, id: string): Promise<NegotiationMessageResponse[]> {
    return withTenantTx(ctx, async (tx) => {
      await this.visibleRental(tx, ctx, id);
      const rows = await tx
        .select()
        .from(negotiationMessages)
        .where(eq(negotiationMessages.rentalId, id))
        .orderBy(asc(negotiationMessages.createdAt))
        .limit(500);
      return rows.map((row) => ({
        id: row.id,
        authorRole: row.authorRole === 'customer' ? 'customer' : 'staff',
        mine: row.authorUserId === ctx.userId,
        body: row.body,
        offerPhp: row.offerPhp !== null ? Number(row.offerPhp) : null,
        createdAt: row.createdAt,
      }));
    });
  }

  // POST /bookings/:id/messages. authorRole comes from the JWT role, never
  // from the body.
  async postMessage(ctx: RequestContext, id: string, body: NegotiationMessageCreate) {
    return withTenantTx(ctx, async (tx) => {
      const rental = await this.visibleRental(tx, ctx, id);
      if (rental.status === 'cancelled') throw new ConflictException({ error: 'booking_cancelled' });
      const authorRole = ctx.role === 'customer' ? 'customer' : 'staff';
      const [row] = await tx
        .insert(negotiationMessages)
        .values({
          tenantId: ctx.tenantId,
          rentalId: id,
          authorUserId: ctx.userId,
          authorRole,
          body: body.body,
          offerPhp: body.offerPhp !== undefined ? String(body.offerPhp) : null,
        })
        .returning();
      if (!row) throw new Error('negotiation_messages insert returned no row');
      if (authorRole === 'staff') {
        await notifyBookingCustomer(tx, ctx.tenantId, id, 'negotiation_reply', {
          offer_php: body.offerPhp ?? null,
        });
      } else {
        await notifyStaff(tx, ctx.tenantId, 'customer_message', { rental_id: id, offer_php: body.offerPhp ?? null });
      }
      await this.events.emit(ctx, 'negotiation_message_posted', {
        rental_id: id,
        has_offer: body.offerPhp !== undefined,
      });
      return { id: row.id };
    });
  }

  // POST /bookings/:id/deliver (staff, site:manage). The machines on a paid
  // booking reach the site: its own scheduled assignments go active and
  // the units flip to deployed. It reuses the booking's reservation rather
  // than creating a second assignment, which is why the generic deployment
  // endpoint could never deliver a booked unit (its overlap check collided
  // with the booking's own hold).
  async deliver(ctx: RequestContext, id: string) {
    return withTenantTx(ctx, async (tx) => {
      const rental = await this.visibleRental(tx, ctx, id);
      if (rental.status !== 'confirmed') throw new ConflictException({ error: 'booking_not_ready', status: rental.status });
      const assignments = await tx
        .select()
        .from(equipmentAssignments)
        .where(and(eq(equipmentAssignments.rentalId, id), eq(equipmentAssignments.status, 'scheduled')));
      if (assignments.length === 0) throw new ConflictException({ error: 'nothing_to_deliver' });

      const units = await tx
        .select()
        .from(equipment)
        .where(inArray(equipment.id, assignments.map((a) => a.equipmentId)))
        .for('update');
      const blocked = units.find((unit) => unit.availabilityStatus !== 'available');
      if (blocked) {
        throw new ConflictException({ error: 'equipment_unavailable', equipmentId: blocked.id, status: blocked.availabilityStatus });
      }

      await tx
        .update(equipmentAssignments)
        .set({ status: 'active' })
        .where(inArray(equipmentAssignments.id, assignments.map((a) => a.id)));
      await tx
        .update(equipment)
        .set({ availabilityStatus: 'deployed' })
        .where(inArray(equipment.id, units.map((u) => u.id)));
      await tx.update(rentals).set({ status: 'active' }).where(eq(rentals.id, id));
      await tx.insert(auditLogs).values({ tenantId: ctx.tenantId, actorId: ctx.userId, action: 'UPDATE', entity: 'rentals', entityId: id });
      await notifyBookingCustomer(tx, ctx.tenantId, id, 'equipment_delivered', { item_count: assignments.length });
      await this.events.emit(ctx, 'booking_delivered', { rental_id: id, item_count: assignments.length });
      return { id, status: 'active' };
    });
  }

  // POST /bookings/:id/return (staff, site:manage). Every unit is back:
  // the hire ends now (freeing any unused days), units go available, the
  // booking completes. The deposit refund stays a manual PayMongo step,
  // after any field-log deductions are settled.
  async markReturned(ctx: RequestContext, id: string) {
    return withTenantTx(ctx, async (tx) => {
      const rental = await this.visibleRental(tx, ctx, id);
      if (rental.status !== 'active') throw new ConflictException({ error: 'booking_not_on_site', status: rental.status });
      const assignments = await tx
        .select()
        .from(equipmentAssignments)
        .where(and(eq(equipmentAssignments.rentalId, id), eq(equipmentAssignments.status, 'active')));
      const now = new Date();
      if (assignments.length > 0) {
        await tx
          .update(equipmentAssignments)
          .set({ status: 'completed', end: now })
          .where(inArray(equipmentAssignments.id, assignments.map((a) => a.id)));
        await tx
          .update(equipment)
          .set({ availabilityStatus: 'available' })
          .where(inArray(equipment.id, assignments.map((a) => a.equipmentId)));
      }
      await tx.update(rentals).set({ status: 'completed', endDate: now }).where(eq(rentals.id, id));
      await tx.insert(auditLogs).values({ tenantId: ctx.tenantId, actorId: ctx.userId, action: 'UPDATE', entity: 'rentals', entityId: id });
      await notifyBookingCustomer(tx, ctx.tenantId, id, 'equipment_returned', { item_count: assignments.length });
      await this.events.emit(ctx, 'booking_returned', { rental_id: id, item_count: assignments.length });
      return { id, status: 'completed' };
    });
  }

  // POST /bookings/:id/change-requests (customer). One open request at a
  // time, so staff never resolve two contradicting asks.
  async requestChange(ctx: RequestContext, id: string, body: ChangeRequestCreate) {
    return withTenantTx(ctx, async (tx) => {
      const rental = await this.visibleRental(tx, ctx, id);
      if (rental.status === 'cancelled' || rental.status === 'completed') {
        throw new ConflictException({ error: 'booking_closed', status: rental.status });
      }
      if (body.kind === 'cancel' && rental.status === 'active') {
        throw new ConflictException({ error: 'already_on_site' });
      }
      const requestedEnd = body.requestedEnd ? new Date(body.requestedEnd) : null;
      if (body.kind === 'extend' && requestedEnd && rental.endDate && requestedEnd <= rental.endDate) {
        throw new ConflictException({ error: 'extend_must_be_later' });
      }
      const [open] = await tx
        .select()
        .from(bookingChangeRequests)
        .where(and(eq(bookingChangeRequests.rentalId, id), eq(bookingChangeRequests.status, 'pending')))
        .limit(1);
      if (open) throw new ConflictException({ error: 'change_request_open', id: open.id });

      const [row] = await tx
        .insert(bookingChangeRequests)
        .values({
          tenantId: ctx.tenantId,
          rentalId: id,
          kind: body.kind,
          requestedEnd,
          reason: body.reason || null,
          requestedBy: ctx.userId,
        })
        .returning();
      if (!row) throw new Error('booking_change_requests insert returned no row');
      await this.events.emit(ctx, 'booking_change_requested', { rental_id: id, kind: body.kind });
      await notifyStaff(tx, ctx.tenantId, 'change_request_submitted', { rental_id: id, kind: body.kind });
      return { id: row.id, status: row.status };
    });
  }

  // PATCH /bookings/:id/change-requests/:requestId (staff). Approving an
  // extension re-runs the double-booking check on the added days;
  // approving a cancel frees the units. Refunds stay manual in PayMongo.
  async resolveChange(ctx: RequestContext, id: string, requestId: string, body: ChangeRequestResolve) {
    return withTenantTx(ctx, async (tx) => {
      const [request] = await tx
        .select()
        .from(bookingChangeRequests)
        .where(and(eq(bookingChangeRequests.id, requestId), eq(bookingChangeRequests.rentalId, id)))
        .limit(1);
      if (!request) throw new NotFoundException({ error: 'change_request_not_found' });
      if (request.status !== 'pending') throw new ConflictException({ error: 'change_request_resolved' });

      if (body.decision === 'approved') {
        if (request.kind === 'cancel') {
          await this.cancelRental(tx, ctx, id);
        } else if (request.requestedEnd) {
          await this.extendRental(tx, id, request.requestedEnd);
        }
      }

      await tx
        .update(bookingChangeRequests)
        .set({ status: body.decision, resolvedBy: ctx.userId, resolvedAt: new Date() })
        .where(eq(bookingChangeRequests.id, requestId));
      await tx.insert(auditLogs).values({
        tenantId: ctx.tenantId,
        actorId: ctx.userId,
        action: body.decision === 'approved' ? 'APPROVE' : 'REJECT',
        entity: 'booking_change_requests',
        entityId: requestId,
      });
      await notifyBookingCustomer(tx, ctx.tenantId, id, 'change_request_resolved', {
        kind: request.kind,
        decision: body.decision,
      });
      return { id: requestId, status: body.decision };
    });
  }

  private async extendRental(tx: Tx, id: string, newEnd: Date) {
    const assignments = await tx
      .select()
      .from(equipmentAssignments)
      .where(and(eq(equipmentAssignments.rentalId, id), ne(equipmentAssignments.status, 'cancelled')));
    // Lock the units first, same as create(), so a concurrent booking of
    // the added days serializes behind this check.
    if (assignments.length > 0) {
      await tx
        .select()
        .from(equipment)
        .where(inArray(equipment.id, assignments.map((assignment) => assignment.equipmentId)))
        .for('update');
    }
    for (const assignment of assignments) {
      const from = assignment.end ?? assignment.start;
      if (newEnd <= from) continue;
      const clash = (
        await overlappingAssignments(tx, assignment.equipmentId, {
          start: from.toISOString(),
          end: newEnd.toISOString(),
        })
      ).filter((other) => other.rentalId !== id);
      if (clash.length > 0) {
        throw new ConflictException({
          error: 'equipment_unavailable',
          reason: 'dates_taken',
          equipmentId: assignment.equipmentId,
        });
      }
      await tx.update(equipmentAssignments).set({ end: newEnd }).where(eq(equipmentAssignments.id, assignment.id));
    }
    await tx.update(rentals).set({ endDate: newEnd }).where(eq(rentals.id, id));
  }

  private async cancelRental(tx: Tx, ctx: RequestContext, id: string) {
    await tx.update(rentals).set({ status: 'cancelled' }).where(eq(rentals.id, id));
    await tx.update(equipmentAssignments).set({ status: 'cancelled' }).where(eq(equipmentAssignments.rentalId, id));
    await tx.insert(auditLogs).values({
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      action: 'UPDATE',
      entity: 'rentals',
      entityId: id,
    });
    await this.events.emit(ctx, 'booking_cancelled', { rental_id: id });
  }

  // Every per-booking endpoint starts here: RLS bounds the tenant, this
  // bounds a customer to their own bookings (404, never 403, so an id is
  // not confirmed to exist).
  private async visibleRental(tx: Tx, ctx: RequestContext, id: string) {
    const [rental] = await tx.select().from(rentals).where(eq(rentals.id, id)).limit(1);
    if (!rental) throw new NotFoundException({ error: 'booking_not_found' });
    if (ctx.role === 'customer') {
      if (!(await ownsCustomer(tx, ctx, rental.customerId))) throw new NotFoundException({ error: 'booking_not_found' });
    }
    return rental;
  }
}
