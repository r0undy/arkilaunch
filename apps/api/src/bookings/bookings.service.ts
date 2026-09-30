import { ConflictException, ForbiddenException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { and, asc, count, desc, eq, gte, ilike, inArray, isNull, like, lt, ne, or, type SQL } from 'drizzle-orm';
import {
  type Tx,
  addresses,
  auditLogs,
  bookingChangeRequests,
  customers,
  equipment,
  equipmentTypes,
  equipmentAssignments,
  getBillingSettings,
  invoices,
  negotiationMessages,
  payments,
  projectSites,
  quotations,
  rentals,
  resolveDepositLedger,
  withTenantTx,
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
  EdtrSheetContext,
  AvailabilityBlocker,
  RequestContext,
  RescheduleSuggestion,
} from '@arkilaunch/shared';
import {
  bookingCodeSearchPrefix,
  bookingDays,
  maxBookingHours,
  minBookingHours,
  minRentalDays,
  selectedOptionsError,
} from '@arkilaunch/shared';
import { EventsService } from '../events/events.service.js';
import { PaymentsService } from '../payments/payments.service.js';
import { QuotesService, inNegotiation } from '../quotes/quotes.service.js';
import { requireSiteProof } from '../common/site-proof.js';
import { holdDeadline, renewLapsedHold } from '../common/booking-hold.js';
import {
  availabilityBlockers,
  findAvailableAlternatives,
  nearestFreeWindow,
  overlappingAssignments,
} from '../common/equipment-availability.js';
import { ownCustomers, ownsCustomer, requireVerifiedCompany } from '../common/customer-scope.js';
import { loadFieldLogs } from '../common/field-logs.js';
import { countRows } from '../common/count-rows.js';
import { buildEdtrSheetContext, isAssignedToSite } from '../common/edtr-sheet-context.js';
import { notifyBookingCustomer, notifyStaff } from '../common/notify-customer.js';


// Once money has moved, only staff cancel or move a booking (they also handle the refund).
const CUSTOMER_SELF_CANCEL_STATUSES = ['pending'];

// 'dates_taken' predates the others and stays the name for another booking's hold.
const BLOCKER_REASON: Record<AvailabilityBlocker, string> = {
  assignment: 'dates_taken',
  hold: 'on_hold',
  maintenance: 'maintenance_window',
  closed: 'outside_business_hours',
  holiday: 'holiday',
  operator: 'operator_busy',
};

@Injectable()
export class BookingsService {
  constructor(
    private readonly events: EventsService,
    private readonly quotes: QuotesService,
    private readonly payments: PaymentsService,
  ) {}

  // Never overbooks: candidate equipment rows are locked FOR UPDATE before the overlap check.
  async create(ctx: RequestContext, body: BookingCreateRequest): Promise<BookingCreateResponse> {
    const booked = await withTenantTx(ctx, async (tx) => {
      let customerId = body.customerId;
      if (ctx.role === 'customer') {
        const own = await ownCustomers(tx, ctx);
        if (own.length === 0) throw new ForbiddenException({ error: 'customer_profile_not_found' });
        if (body.customerId && !own.some((row) => row.id === body.customerId)) {
          // Own transaction: the throw below rolls back tx, and the denial must stay on the audit trail.
          await withTenantTx(ctx, (t) =>
            t.insert(auditLogs).values({
              tenantId: ctx.tenantId,
              actorId: ctx.userId,
              action: 'CREATE',
              entity: 'booking_customer_scope_denied',
              entityId: own[0]!.id,
            }),
          );
          await this.events.emit(ctx, 'booking_customer_scope_denied', { customer_id: body.customerId });
          throw new ForbiddenException({ error: 'customer_scope_denied' });
        }
        if (!body.customerId && own.length > 1) throw new ConflictException({ error: 'company_required' });
        customerId = body.customerId ?? own[0]!.id;
      }
      if (!customerId) throw new NotFoundException({ error: 'customer_id_required' });

      const [site] = await tx.select().from(projectSites).where(eq(projectSites.id, body.projectSiteId)).limit(1);
      if (!site) throw new NotFoundException({ error: 'project_site_not_found' });
      // A customer's site is booked only by that company; yard sites (customer_id null) stay open.
      if (site.customerId && site.customerId !== customerId) {
        throw new NotFoundException({ error: 'project_site_not_found' });
      }
      await requireVerifiedCompany(tx, customerId);
      await requireSiteProof(tx, site.id);

      const { dailyHours, minHours, holdHours } = await getBillingSettings(tx, ctx.tenantId);
      const minDays = minRentalDays(dailyHours, minHours);
      const bookedHours = body.items.map((item) => {
        const days = bookingDays(item.start, item.end);
        if (days < minDays) {
          throw new UnprocessableEntityException({ error: 'rental_too_short', equipmentId: item.equipmentId, minDays, minHours, dailyHours });
        }
        const min = minBookingHours(days, dailyHours);
        const max = maxBookingHours(days);
        if (item.hours !== undefined && item.hours < min) {
          throw new UnprocessableEntityException({ error: 'hours_below_minimum', equipmentId: item.equipmentId, minHours: min });
        }
        if (item.hours !== undefined && item.hours > max) {
          throw new UnprocessableEntityException({ error: 'hours_above_maximum', equipmentId: item.equipmentId, maxHours: max });
        }
        return item.hours ?? min;
      });

      // The overlap check below sees only other bookings, so two lines of one unit here must not overlap.
      body.items.forEach((item, i) => {
        const clash = body.items.some(
          (other, j) =>
            j < i &&
            other.equipmentId === item.equipmentId &&
            new Date(other.start) < new Date(item.end) &&
            new Date(item.start) < new Date(other.end),
        );
        if (clash) {
          throw new ConflictException({ error: 'equipment_unavailable', reason: 'overlaps_in_cart', equipmentId: item.equipmentId, alternatives: [] });
        }
      });

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

        // The unit is the authority on its option groups, never the client's copy.
        const optionsError = selectedOptionsError(equipmentRow.optionGroups, item.selectedOptions ?? {});
        if (optionsError) {
          throw new UnprocessableEntityException({ error: 'invalid_options', equipmentId: item.equipmentId, detail: optionsError });
        }

        // `reason` separates "off the road" from "dates taken". A unit deployed today is still bookable for a later window.
        if (equipmentRow.availabilityStatus === 'maintenance' || equipmentRow.retiredAt) {
          const alternatives = await findAvailableAlternatives(tx, equipmentRow.equipmentTypeId, item, equipmentIds);
          throw new ConflictException({
            error: 'equipment_unavailable',
            reason: 'not_in_service',
            status: equipmentRow.availabilityStatus,
            equipmentId: item.equipmentId,
            alternatives,
          });
        }

        const blockers = await availabilityBlockers(tx, item.equipmentId, item);
        if (blockers.length > 0) {
          const alternatives = await findAvailableAlternatives(tx, equipmentRow.equipmentTypeId, item, equipmentIds);
          throw new ConflictException({
            error: 'equipment_unavailable',
            reason: BLOCKER_REASON[blockers[0]!],
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
          siteContactMobile: body.siteContactMobile || null,
          siteNotes: body.siteNotes || null,
          status: 'pending',
          startDate,
          endDate,
          // The dates are held this long unpaid.
          holdExpiresAt: new Date(Date.now() + holdHours * 3_600_000),
        })
        .returning();
      if (!rental) throw new Error('rentals insert returned no row');

      for (const [index, item] of body.items.entries()) {
        await tx.insert(equipmentAssignments).values({
          tenantId: ctx.tenantId,
          equipmentId: item.equipmentId,
          rentalId: rental.id,
          start: new Date(item.start),
          end: new Date(item.end),
          bookedHours: String(bookedHours[index]),
          selectedOptions: item.selectedOptions ?? {},
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

      return { id: rental.id, code: rental.code, status: rental.status, trackerUrl: `/orders/${rental.id}` };
    });

    // Never fails the booking: without a rate card, staff quote it by hand.
    try {
      await this.quotes.autoQuoteBooking(ctx, booked.id);
    } catch (err) {
      console.error(`auto-quote failed for booking ${booked.id}; left for a manual quote.`, err);
    }
    return booked;
  }

  // A `customer` sees only their own bookings; staff see the whole tenant.
  async list(ctx: RequestContext, query: BookingListQuery): Promise<BookingListResponse> {
    return withTenantTx(ctx, async (tx) => {
      const conditions: SQL[] = [];
      if (ctx.role === 'customer') {
        const own = await ownCustomers(tx, ctx);
        if (own.length === 0) return { items: [], total: 0 };
        conditions.push(inArray(rentals.customerId, own.map((row) => row.id)));
      }
      // bookingCodeSearchPrefix keeps only letters, digits and hyphens, so no caller-chosen LIKE wildcard; company names are escaped.
      const codePrefix = query.q ? bookingCodeSearchPrefix(query.q) : null;
      const byCustomer = query.q
        ? inArray(
            rentals.customerId,
            tx
              .select({ id: customers.id })
              .from(customers)
              .where(ilike(customers.companyName, `%${query.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`)),
          )
        : null;
      if (codePrefix && byCustomer) conditions.push(or(like(rentals.code, `${codePrefix}%`), byCustomer)!);
      else if (byCustomer) conditions.push(byCustomer);
      // A booking whose dates touch [from, to], Manila days.
      if (query.from) conditions.push(or(isNull(rentals.endDate), gte(rentals.endDate, new Date(`${query.from}T00:00:00+08:00`)))!);
      if (query.to) conditions.push(lt(rentals.startDate, new Date(new Date(`${query.to}T00:00:00+08:00`).getTime() + 86_400_000)));
      const unfiltered = conditions.length ? and(...conditions) : undefined;
      if (query.status?.length) conditions.push(inArray(rentals.status, query.status));
      const where = conditions.length ? and(...conditions) : undefined;
      const rows = await tx
        .select()
        .from(rentals)
        .where(where)
        .orderBy(...(query.sort === 'start' ? [asc(rentals.startDate), desc(rentals.createdAt)] : [desc(rentals.createdAt)]))
        .limit(query.limit)
        .offset(query.offset);
      const total = await countRows(tx, rentals, where);
      const statusCounts = Object.fromEntries(
        (
          await tx
            .select({ status: rentals.status, n: count() })
            .from(rentals)
            .where(unfiltered)
            .groupBy(rentals.status)
        ).map((row) => [row.status, row.n]),
      );
      if (rows.length === 0) return { items: [], total, statusCounts };

      const siteRows = await tx
        .select({ id: projectSites.id, city: addresses.city, province: addresses.province })
        .from(projectSites)
        .leftJoin(addresses, eq(addresses.id, projectSites.addressId))
        .where(inArray(projectSites.id, rows.map((row) => row.projectSiteId)));
      const siteById = new Map(siteRows.map((site) => [site.id, site]));
      const customerRows = await tx
        .select({ id: customers.id, name: customers.companyName })
        .from(customers)
        .where(inArray(customers.id, [...new Set(rows.map((row) => row.customerId))]));
      const customerById = new Map(customerRows.map((c) => [c.id, c.name]));
      const unitRows = await tx
        .select({
          rentalId: equipmentAssignments.rentalId,
          typeName: equipmentTypes.name,
          model: equipment.model,
          start: equipmentAssignments.start,
          end: equipmentAssignments.end,
        })
        .from(equipmentAssignments)
        .innerJoin(equipment, eq(equipment.id, equipmentAssignments.equipmentId))
        .innerJoin(equipmentTypes, eq(equipmentTypes.id, equipment.equipmentTypeId))
        .where(
          and(
            inArray(equipmentAssignments.rentalId, rows.map((row) => row.id)),
            ne(equipmentAssignments.status, 'cancelled'),
          ),
        )
        .orderBy(asc(equipmentAssignments.start));
      const unitsByRental = new Map<string, { equipmentName: string; start: Date; end: Date | null }[]>();
      for (const unit of unitRows) {
        const list = unitsByRental.get(unit.rentalId) ?? [];
        list.push({ equipmentName: `${unit.typeName} · ${unit.model}`, start: unit.start, end: unit.end });
        unitsByRental.set(unit.rentalId, list);
      }

      return {
        items: rows.map((row) => {
          const site = siteById.get(row.projectSiteId);
          return {
            id: row.id,
            code: row.code,
            status: row.status,
            projectSiteId: row.projectSiteId,
            siteCity: site?.city ?? null,
            siteProvince: site?.province ?? null,
            customerName: customerById.get(row.customerId) ?? null,
            startDate: row.startDate,
            endDate: row.endDate,
            holdExpiresAt: row.status === 'pending' ? row.holdExpiresAt : null,
            items: unitsByRental.get(row.id) ?? [],
          };
        }),
        total,
        statusCounts,
      };
    });
  }

  async edtrSheet(ctx: RequestContext, id: string): Promise<EdtrSheetContext> {
    return withTenantTx(ctx, async (tx) => {
      const rental = await this.visibleRental(tx, ctx, id);
      // A timekeeper sees only the sheets of sites they are assigned to.
      if (ctx.role === 'timekeeper' && !(await isAssignedToSite(tx, ctx, rental.projectSiteId))) {
        throw new NotFoundException({ error: 'booking_not_found' });
      }
      return buildEdtrSheetContext(tx, ctx.tenantId, rental);
    });
  }

  // Never returns card/account data, only provider_ref + status.
  async get(ctx: RequestContext, id: string): Promise<BookingDetailResponse> {
    return withTenantTx(ctx, async (tx) => {
      const rental = await this.visibleRental(tx, ctx, id);

      const assignmentRows = await tx
        .select({
          assignment: equipmentAssignments,
          typeName: equipmentTypes.name,
          model: equipment.model,
          serialNo: equipment.serialNo,
        })
        .from(equipmentAssignments)
        .innerJoin(equipment, eq(equipment.id, equipmentAssignments.equipmentId))
        .innerJoin(equipmentTypes, eq(equipmentTypes.id, equipment.equipmentTypeId))
        .where(eq(equipmentAssignments.rentalId, id))
        .orderBy(asc(equipmentAssignments.start));
      const [customer] = await tx
        .select({ companyName: customers.companyName })
        .from(customers)
        .where(eq(customers.id, rental.customerId))
        .limit(1);
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
      const ledger = await resolveDepositLedger(tx, id, ctx.tenantId);
      const logs = await loadFieldLogs(tx, [id]);
      const unitName = new Map(logs.units.map((u) => [u.equipmentId, `${u.name} (SN ${u.serialNo})`]));
      const fieldLogs = {
        ...logs.totals,
        pending: ctx.role === 'customer' ? 0 : logs.totals.pending,
        days: logs.days
          .filter((d) => d.status === 'approved' && d.hours)
          .map((d) => ({ date: d.date, equipmentName: unitName.get(d.equipmentId) ?? 'Machine', hours: d.hours! })),
      };
      const changeRows = await tx
        .select()
        .from(bookingChangeRequests)
        .where(eq(bookingChangeRequests.rentalId, id))
        .orderBy(desc(bookingChangeRequests.createdAt));

      return {
        id: rental.id,
        code: rental.code,
        status: rental.status,
        projectSiteId: rental.projectSiteId,
        siteCity: site?.city ?? null,
        siteProvince: site?.province ?? null,
        trackerUrl: `/orders/${rental.id}`,
        customerId: rental.customerId,
        customerName: customer?.companyName ?? null,
        siteContact: rental.siteContact,
        siteContactMobile: rental.siteContactMobile,
        siteNotes: rental.siteNotes,
        callRequestedAt: rental.callRequestedAt,
        callConfirmedAt: rental.callConfirmedAt,
        createdAt: rental.createdAt,
        holdExpiresAt: rental.status === 'pending' ? rental.holdExpiresAt : null,
        deposit: {
          required: ledger.depositRequired,
          totalDeducted: ledger.totalDeducted,
          deductions: ledger.deductions,
        },
        changeRequests: changeRows.map((row) => ({
          id: row.id,
          kind: row.kind,
          assignmentId: row.assignmentId,
          requestedEnd: row.requestedEnd,
          reason: row.reason,
          status: row.status,
          createdAt: row.createdAt,
        })),
        items: assignmentRows.map(({ assignment, typeName, model, serialNo }) => ({
          id: assignment.id,
          equipmentId: assignment.equipmentId,
          equipmentName: `${typeName} · ${model} · SN ${serialNo}`,
          start: assignment.start,
          end: assignment.end,
          status: assignment.status,
          selectedOptions: assignment.selectedOptions,
        })),
        quotation: quotation
          ? {
              id: quotation.id,
              revision: quotation.revision,
              status: quotation.status,
              totalPhp: quotation.totalPhp !== null ? Number(quotation.totalPhp) : null,
              mobilizationPhp: Number(quotation.mobilizationPhp),
              demobilizationPhp: Number(quotation.demobilizationPhp),
              createdAt: quotation.createdAt,
              inNegotiation: await inNegotiation(tx, quotation),
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
        fieldLogs,
      };
    });
  }

  // A customer can cancel only before paying; after that it is a change request staff resolve.
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
      // The customer knows when they cancelled; tell them when staff did.
      if (ctx.role !== 'customer') await notifyBookingCustomer(tx, ctx.tenantId, id, 'booking_cancelled');
      return { id, status: 'cancelled' };
    });
  }

  // A hold that already lapsed renews only while its dates are still free.
  async extendHold(ctx: RequestContext, id: string) {
    return withTenantTx(ctx, async (tx) => {
      const rental = await this.visibleRental(tx, ctx, id);
      if (rental.status !== 'pending') throw new ConflictException({ error: 'not_on_hold', status: rental.status });
      await renewLapsedHold(tx, ctx.tenantId, id);
      const holdExpiresAt = await holdDeadline(tx, ctx.tenantId);
      await tx.update(rentals).set({ holdExpiresAt }).where(eq(rentals.id, id));
      await tx.insert(auditLogs).values({
        tenantId: ctx.tenantId,
        actorId: ctx.userId,
        action: 'UPDATE',
        entity: 'rental_hold',
        entityId: id,
      });
      return { id, holdExpiresAt };
    });
  }

  // Checkout refuses until staff have called and confirmed.
  async requestCall(ctx: RequestContext, id: string) {
    return withTenantTx(ctx, async (tx) => {
      await this.visibleRental(tx, ctx, id);
      const callRequestedAt = new Date();
      await tx.update(rentals).set({ callRequestedAt }).where(eq(rentals.id, id));
      await notifyStaff(tx, ctx.tenantId, 'call_requested', { rental_id: id });
      return { id, callRequestedAt };
    });
  }

  async confirmCall(ctx: RequestContext, id: string) {
    return withTenantTx(ctx, async (tx) => {
      await this.visibleRental(tx, ctx, id);
      const callConfirmedAt = new Date();
      await tx.update(rentals).set({ callConfirmedAt, callConfirmedBy: ctx.userId }).where(eq(rentals.id, id));
      await notifyBookingCustomer(tx, ctx.tenantId, id, 'call_confirmed');
      return { id, callConfirmedAt };
    });
  }

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

  // authorRole comes from the JWT role, never from the body.
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

  // Reuses the booking's own reservation rather than creating a second assignment (which would collide with its hold).
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

  // The deposit refund stays a manual PayMongo step, after field-log deductions settle.
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
      // The whole-span Statement of Account is ready to view (in-app only; the office emails the PDF).
      await notifyBookingCustomer(tx, ctx.tenantId, id, 'statement_ready', { booking_code: rental.code });
      await notifyStaff(tx, ctx.tenantId, 'statement_ready', { rental_id: id, booking_code: rental.code });
      await this.events.emit(ctx, 'booking_returned', { rental_id: id, item_count: assignments.length });
      return { id, status: 'completed' };
    });
  }

  // One open request at a time, so staff never resolve two contradicting asks.
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
      let assignmentId: string | null = null;
      if (body.kind === 'extend' && body.assignmentId) {
        // One unit at a time: each keeps its own return date.
        const [unit] = await tx
          .select()
          .from(equipmentAssignments)
          .where(and(eq(equipmentAssignments.id, body.assignmentId), eq(equipmentAssignments.rentalId, id)))
          .limit(1);
        if (!unit || unit.status === 'cancelled' || unit.status === 'completed') {
          throw new NotFoundException({ error: 'booking_unit_not_found' });
        }
        if (requestedEnd && unit.end && requestedEnd <= unit.end) {
          throw new ConflictException({ error: 'extend_must_be_later' });
        }
        assignmentId = unit.id;
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
          assignmentId,
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

  // Approving an extension re-runs the double-booking check on the added days; refunds stay manual.
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
          await this.extendRental(tx, id, request.requestedEnd, request.assignmentId);
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

  async rescheduleSuggestion(ctx: RequestContext, id: string): Promise<RescheduleSuggestion> {
    return withTenantTx(ctx, async (tx) => {
      await this.visibleRental(tx, ctx, id);
      const assignments = await tx
        .select()
        .from(equipmentAssignments)
        .where(and(eq(equipmentAssignments.rentalId, id), inArray(equipmentAssignments.status, ['scheduled', 'active'])));
      const items: RescheduleSuggestion['items'] = [];
      for (const a of assignments) {
        const [unit] = await tx.select().from(equipment).where(eq(equipment.id, a.equipmentId)).limit(1);
        const window = { start: a.start.toISOString(), end: (a.end ?? a.start).toISOString() };
        items.push({
          equipmentId: a.equipmentId,
          sameUnit: await nearestFreeWindow(tx, a.equipmentId, window, id),
          alternatives: unit ? await findAvailableAlternatives(tx, unit.equipmentTypeId, window, [a.equipmentId]) : [],
        });
      }
      return { items };
    });
  }

  // Pre-pick requests have no assignmentId and extend every unit; end_date follows the latest unit.
  private async extendRental(tx: Tx, id: string, newEnd: Date, assignmentId: string | null) {
    // Rental before units, the order checkout takes, so an extension racing a checkout can't deadlock.
    await tx.select({ id: rentals.id }).from(rentals).where(eq(rentals.id, id)).for('update');
    const live = await tx
      .select()
      .from(equipmentAssignments)
      .where(and(eq(equipmentAssignments.rentalId, id), ne(equipmentAssignments.status, 'cancelled')));
    const assignments = assignmentId ? live.filter((a) => a.id === assignmentId) : live;
    // Lock the units first, same as create(), so a concurrent booking of the added days serializes.
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
      assignment.end = newEnd;
    }
    const ends = live.map((a) => a.end).filter((e): e is Date => e !== null);
    if (ends.length > 0) {
      await tx.update(rentals).set({ endDate: new Date(Math.max(...ends.map((e) => e.getTime()))) }).where(eq(rentals.id, id));
    }
  }

  // Also voids unpaid invoices and open PayMongo sessions, so nothing stays payable.
  private async cancelRental(tx: Tx, ctx: RequestContext, id: string) {
    const [rental] = await tx.select({ status: rentals.status }).from(rentals).where(eq(rentals.id, id)).for('update');
    if (rental?.status === 'active') throw new ConflictException({ error: 'already_on_site' });
    if (rental?.status === 'completed') throw new ConflictException({ error: 'booking_closed', status: rental.status });
    await this.payments.voidUnpaid(tx, { rentalId: id });
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
    if (ctx.role === 'customer') await notifyStaff(tx, ctx.tenantId, 'booking_cancelled', { rental_id: id });
  }

  // RLS bounds the tenant; this bounds a customer to their own bookings (404, never 403).
  private async visibleRental(tx: Tx, ctx: RequestContext, id: string) {
    const [rental] = await tx.select().from(rentals).where(eq(rentals.id, id)).limit(1);
    if (!rental) throw new NotFoundException({ error: 'booking_not_found' });
    if (ctx.role === 'customer') {
      if (!(await ownsCustomer(tx, ctx, rental.customerId))) throw new NotFoundException({ error: 'booking_not_found' });
    }
    return rental;
  }
}
