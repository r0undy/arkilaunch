import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { and, asc, eq, inArray, ne } from 'drizzle-orm';
import {
  addresses,
  auditLogs,
  bookingChangeRequests,
  customers,
  projectSites,
  rentals,
  roles,
  siteDocuments,
  timekeeperSiteAssignments,
  truckRequests,
  users,
  withTenantTx,
} from '@arkilaunch/db';
import type { RequestContext, SiteHubResponse } from '@arkilaunch/shared';
import { EventsService } from '../events/events.service.js';
import { loadFieldLogs, personName } from '../common/field-logs.js';

// Every query runs under the tenant's RLS transaction.
@Injectable()
export class SiteHubService {
  constructor(private readonly events: EventsService) {}

  async hub(ctx: RequestContext, siteId: string): Promise<SiteHubResponse> {
    return withTenantTx(ctx, async (tx) => {
      const [site] = await tx.select().from(projectSites).where(eq(projectSites.id, siteId)).limit(1);
      if (!site) throw new NotFoundException({ error: 'project_site_not_found' });
      const [address] = await tx.select().from(addresses).where(eq(addresses.id, site.addressId)).limit(1);

      // Drafts are carts, not bookings on the ground.
      const rentalRows = await tx
        .select({ rental: rentals, companyName: customers.companyName })
        .from(rentals)
        .leftJoin(customers, eq(customers.id, rentals.customerId))
        .where(and(eq(rentals.projectSiteId, siteId), ne(rentals.status, 'draft')))
        .orderBy(asc(rentals.startDate));
      const rentalIds = rentalRows.map((r) => r.rental.id);
      const extendedIds = rentalIds.length
        ? new Set(
            (
              await tx
                .select({ rentalId: bookingChangeRequests.rentalId })
                .from(bookingChangeRequests)
                .where(
                  and(
                    inArray(bookingChangeRequests.rentalId, rentalIds),
                    eq(bookingChangeRequests.kind, 'extend'),
                    eq(bookingChangeRequests.status, 'approved'),
                  ),
                )
            ).map((r) => r.rentalId),
          )
        : new Set<string>();
      // Field logs only for bookings that reached the ground.
      const live = rentalRows.filter((r) => r.rental.status !== 'cancelled').map((r) => r.rental.id);
      const logs = await loadFieldLogs(tx, live);

      const [siteCustomer] = site.customerId
        ? await tx.select({ companyName: customers.companyName }).from(customers).where(eq(customers.id, site.customerId)).limit(1)
        : [];

      const timekeeperRows = await tx
        .select({ id: users.id, firstName: users.firstName, lastName: users.lastName, email: users.email })
        .from(timekeeperSiteAssignments)
        .innerJoin(users, eq(users.id, timekeeperSiteAssignments.userId))
        .where(eq(timekeeperSiteAssignments.projectSiteId, siteId));
      const allTimekeepers = await tx
        .select({ id: users.id, firstName: users.firstName, lastName: users.lastName, email: users.email })
        .from(users)
        .innerJoin(roles, eq(roles.id, users.roleId))
        .where(and(eq(roles.name, 'timekeeper'), eq(users.status, 'active')));
      const assigned = new Set(timekeeperRows.map((t) => t.id));

      const trips = await tx
        .select()
        .from(truckRequests)
        .where(and(eq(truckRequests.projectSiteId, siteId), ne(truckRequests.status, 'cancelled')));
      const documents = await tx.select().from(siteDocuments).where(eq(siteDocuments.projectSiteId, siteId));

      return {
        site: {
          id: site.id,
          address: address ? [address.line1, address.line2, address.city, address.province].filter(Boolean).join(', ') : '',
          city: address?.city ?? null,
          province: address?.province ?? null,
          latitude: Number(site.latitude),
          longitude: Number(site.longitude),
          customerName: siteCustomer?.companyName ?? rentalRows[0]?.companyName ?? null,
        },
        rentals: rentalRows.map(({ rental, companyName }) => ({
          id: rental.id,
          code: rental.code,
          status: rental.status,
          customerName: companyName,
          siteRep: rental.siteContact,
          start: rental.startDate.toISOString(),
          end: rental.endDate?.toISOString() ?? null,
          extended: extendedIds.has(rental.id),
        })),
        units: logs.units,
        days: logs.days,
        totals: { ...logs.totals, billedPhp: logs.billedPhp },
        personnel: {
          operators: logs.units
            .filter((u) => u.operatorName)
            .map((u) => ({ name: u.operatorName!, equipmentName: `${u.name} (SN ${u.serialNo})` })),
          timekeepers: timekeeperRows.map((t) => ({ userId: t.id, name: personName(t)! })),
          availableTimekeepers: allTimekeepers
            .filter((t) => !assigned.has(t.id))
            .map((t) => ({ userId: t.id, name: personName(t)! })),
          siteReps: rentalRows
            .filter((r) => r.rental.siteContact)
            .map((r) => ({ name: r.rental.siteContact!, bookingCode: r.rental.code })),
          truckCrew: trips.map((t) => ({
            code: t.code,
            scheduledFor: t.scheduledFor.toISOString(),
            driverName: t.driverName,
            helperName: t.helperName,
          })),
        },
        documents: documents.map((d) => ({
          id: d.id,
          documentType: d.documentType,
          status: d.status,
          createdAt: d.createdAt.toISOString(),
        })),
      };
    });
  }

  async setTimekeeper(ctx: RequestContext, siteId: string, userId: string, assigned: boolean) {
    return withTenantTx(ctx, async (tx) => {
      const [site] = await tx.select({ id: projectSites.id }).from(projectSites).where(eq(projectSites.id, siteId)).limit(1);
      if (!site) throw new NotFoundException({ error: 'project_site_not_found' });
      const [user] = await tx
        .select({ id: users.id, role: roles.name })
        .from(users)
        .innerJoin(roles, eq(roles.id, users.roleId))
        .where(eq(users.id, userId))
        .limit(1);
      if (!user) throw new NotFoundException({ error: 'user_not_found' });
      if (user.role !== 'timekeeper') throw new UnprocessableEntityException({ error: 'role_has_no_site_assignments' });

      if (assigned) {
        await tx
          .insert(timekeeperSiteAssignments)
          .values({ tenantId: ctx.tenantId, userId, projectSiteId: siteId })
          .onConflictDoNothing();
      } else {
        await tx
          .delete(timekeeperSiteAssignments)
          .where(and(eq(timekeeperSiteAssignments.userId, userId), eq(timekeeperSiteAssignments.projectSiteId, siteId)));
      }
      await tx.insert(auditLogs).values({
        tenantId: ctx.tenantId,
        actorId: ctx.userId,
        action: 'UPDATE',
        entity: 'timekeeper_site_assignments',
        entityId: userId,
      });
      await this.events.emit(ctx, assigned ? 'timekeeper_site_assigned' : 'timekeeper_site_unassigned', {
        user_id: userId,
        project_site_id: siteId,
      });
      return { userId, projectSiteId: siteId, assigned };
    });
  }
}
