import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { desc, eq, inArray } from 'drizzle-orm';
import {
  auditLogs,
  customers,
  db,
  equipment,
  equipmentAssignments,
  invoices,
  payments,
  projectSites,
  quotations,
  rentals,
  withTenantTx,
} from '@arkilaunch/db';
import type { BookingCreateRequest, RequestContext } from '@arkilaunch/shared';
import { EventsService } from '../events/events.service.js';
import { findAvailableAlternatives, overlappingAssignments } from '../common/equipment-availability.js';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// A booking IS a `rentals` row plus one `equipment_assignments` row per
// item -- no new table (SDD §3's 35-table catalog already models an order
// as a rental; cr-arkilaunch-f2-f8-bookings-payments.md).
@Injectable()
export class BookingsService {
  constructor(private readonly events: EventsService) {}

  // Resolves the caller's OWN customers row for a `customer`-role caller.
  // Never trusts a client-supplied customerId for that role (mirrors the
  // timekeeper site-scope check in edtr.service.ts).
  private async ownCustomer(tx: Tx, ctx: RequestContext) {
    const [row] = await tx.select().from(customers).where(eq(customers.userId, ctx.userId)).limit(1);
    return row ?? null;
  }

  // POST /api/v1/bookings (SDD §4, PRD-F8 US-09). Never overbooks: the
  // candidate equipment rows are locked with FOR UPDATE before the overlap
  // check, so a concurrent booking attempt on the same unit/window is
  // serialized rather than racing past this check (QAD-T21).
  async create(ctx: RequestContext, body: BookingCreateRequest) {
    return withTenantTx(ctx, async (tx) => {
      let customerId = body.customerId;
      if (ctx.role === 'customer') {
        const own = await this.ownCustomer(tx, ctx);
        if (!own) throw new ForbiddenException({ error: 'customer_profile_not_found' });
        if (body.customerId && body.customerId !== own.id) {
          await tx.insert(auditLogs).values({
            tenantId: ctx.tenantId,
            actorId: ctx.userId,
            action: 'CREATE',
            entity: 'booking_customer_scope_denied',
            entityId: own.id,
          });
          await this.events.emit(ctx, 'booking_customer_scope_denied', { customer_id: body.customerId });
          throw new ForbiddenException({ error: 'customer_scope_denied' });
        }
        customerId = own.id;
      }
      if (!customerId) throw new NotFoundException({ error: 'customer_id_required' });

      const [site] = await tx.select().from(projectSites).where(eq(projectSites.id, body.projectSiteId)).limit(1);
      if (!site) throw new NotFoundException({ error: 'project_site_not_found' });

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

        if (equipmentRow.availabilityStatus !== 'available') {
          const alternatives = await findAvailableAlternatives(tx, equipmentRow.equipmentTypeId, item, equipmentIds);
          throw new ConflictException({ error: 'equipment_unavailable', equipmentId: item.equipmentId, alternatives });
        }

        const overlapping = await overlappingAssignments(tx, item.equipmentId, item);
        if (overlapping.length > 0) {
          const alternatives = await findAvailableAlternatives(tx, equipmentRow.equipmentTypeId, item, equipmentIds);
          throw new ConflictException({ error: 'equipment_unavailable', equipmentId: item.equipmentId, alternatives });
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

      return { id: rental.id, status: rental.status, trackerUrl: `/orders/${rental.id}` };
    });
  }

  // GET /api/v1/bookings (PRD-F8 US-09). A `customer` sees only their own
  // bookings; staff see the whole tenant (RLS is the tenant boundary,
  // matching reference/* and fleet's read posture).
  async list(ctx: RequestContext) {
    return withTenantTx(ctx, async (tx) => {
      let rows;
      if (ctx.role === 'customer') {
        const own = await this.ownCustomer(tx, ctx);
        rows = own ? await tx.select().from(rentals).where(eq(rentals.customerId, own.id)) : [];
      } else {
        rows = await tx.select().from(rentals);
      }
      return {
        items: rows.map((row) => ({ id: row.id, status: row.status, projectSiteId: row.projectSiteId })),
        total: rows.length,
      };
    });
  }

  // GET /api/v1/bookings/:id (SDD §4 transaction tracker, US-09 AC1). Never
  // stores or returns card/account data (US-08 AC1) -- only provider_ref +
  // status from `payments`.
  async get(ctx: RequestContext, id: string) {
    return withTenantTx(ctx, async (tx) => {
      const [rental] = await tx.select().from(rentals).where(eq(rentals.id, id)).limit(1);
      if (!rental) throw new NotFoundException({ error: 'booking_not_found' });

      if (ctx.role === 'customer') {
        const own = await this.ownCustomer(tx, ctx);
        if (!own || rental.customerId !== own.id) throw new NotFoundException({ error: 'booking_not_found' });
      }

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

      return {
        id: rental.id,
        status: rental.status,
        projectSiteId: rental.projectSiteId,
        trackerUrl: `/orders/${rental.id}`,
        items: assignments.map((assignment) => ({
          equipmentId: assignment.equipmentId,
          start: assignment.start,
          end: assignment.end,
          status: assignment.status,
        })),
        quotation: quotation
          ? { id: quotation.id, status: quotation.status, totalPhp: quotation.totalPhp !== null ? Number(quotation.totalPhp) : null }
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
  // unit's assignments so a later booking can use the same window.
  async cancel(ctx: RequestContext, id: string) {
    return withTenantTx(ctx, async (tx) => {
      const [rental] = await tx.select().from(rentals).where(eq(rentals.id, id)).limit(1);
      if (!rental) throw new NotFoundException({ error: 'booking_not_found' });

      if (ctx.role === 'customer') {
        const own = await this.ownCustomer(tx, ctx);
        if (!own || rental.customerId !== own.id) throw new NotFoundException({ error: 'booking_not_found' });
      }
      if (rental.status === 'cancelled') {
        throw new ConflictException({ error: 'already_cancelled' });
      }

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

      return { id, status: 'cancelled' };
    });
  }
}
