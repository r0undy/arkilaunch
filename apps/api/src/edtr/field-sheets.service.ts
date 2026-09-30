import { ConflictException, ForbiddenException, HttpException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { and, count, eq, gte, inArray, isNull, lt, ne, or, sql } from 'drizzle-orm';
import {
  addresses,
  edtrSettings,
  edtrSheetDownloads,
  equipment,
  equipmentAssignments,
  equipmentTypes,
  projectSites,
  rentals,
  timekeeperSiteAssignments,
  withTenantTx,
} from '@arkilaunch/db';
import {
  FIELD_SHEET_DAILY_LIMIT,
  addDaysIso,
  manilaDate,
  manilaWeekStart,
  type EdtrSettings,
  type FieldSheetDownloadRequest,
  type FieldSheetDownloadResponse,
  type FieldSheetListResponse,
  type RequestContext,
} from '@arkilaunch/shared';
import { buildEdtrSheetContext, edtrPaperSize, isAssignedToSite } from '../common/edtr-sheet-context.js';
import { EventsService } from '../events/events.service.js';

// Timekeepers print their own sheets: current Manila week only, FIELD_SHEET_DAILY_LIMIT per unit per day.
@Injectable()
export class FieldSheetsService {
  constructor(private readonly events: EventsService) {}

  async list(ctx: RequestContext): Promise<FieldSheetListResponse> {
    requireTimekeeper(ctx);
    const now = new Date();
    const weekStart = manilaWeekStart(now);
    const today = manilaDate(now);
    return withTenantTx(ctx, async (tx) => {
      const sites = await tx
        .select({ id: timekeeperSiteAssignments.projectSiteId })
        .from(timekeeperSiteAssignments)
        .where(and(eq(timekeeperSiteAssignments.tenantId, ctx.tenantId), eq(timekeeperSiteAssignments.userId, ctx.userId)));
      if (sites.length === 0) return { weekStart, items: [] };
      // Manila week bounds as instants: Monday 00:00 to the next Monday 00:00 (+08:00).
      const from = new Date(`${weekStart}T00:00:00+08:00`);
      const to = new Date(`${addDaysIso(weekStart, 7)}T00:00:00+08:00`);
      const rows = await tx
        .select({
          rentalId: rentals.id,
          bookingCode: rentals.code,
          equipmentId: equipment.id,
          type: equipmentTypes.name,
          model: equipment.model,
          serialNo: equipment.serialNo,
          line: addresses.line1,
          city: addresses.city,
        })
        .from(equipmentAssignments)
        .innerJoin(rentals, eq(rentals.id, equipmentAssignments.rentalId))
        .innerJoin(equipment, eq(equipment.id, equipmentAssignments.equipmentId))
        .innerJoin(equipmentTypes, eq(equipmentTypes.id, equipment.equipmentTypeId))
        .innerJoin(projectSites, eq(projectSites.id, rentals.projectSiteId))
        .leftJoin(addresses, eq(addresses.id, projectSites.addressId))
        .where(
          and(
            inArray(rentals.projectSiteId, sites.map((s) => s.id)),
            inArray(rentals.status, ['confirmed', 'active']),
            ne(equipmentAssignments.status, 'cancelled'),
            lt(equipmentAssignments.start, to),
            or(isNull(equipmentAssignments.end), gte(equipmentAssignments.end, from)),
          ),
        );
      const used = rows.length
        ? await tx
            .select({ equipmentId: edtrSheetDownloads.equipmentId, n: count() })
            .from(edtrSheetDownloads)
            .where(
              and(
                inArray(edtrSheetDownloads.equipmentId, rows.map((r) => r.equipmentId)),
                eq(edtrSheetDownloads.downloadDate, today),
              ),
            )
            .groupBy(edtrSheetDownloads.equipmentId)
        : [];
      const usedBy = new Map(used.map((u) => [u.equipmentId, Number(u.n)]));
      return {
        weekStart,
        items: rows.map((r) => {
          const downloadsToday = usedBy.get(r.equipmentId) ?? 0;
          return {
            rentalId: r.rentalId,
            equipmentId: r.equipmentId,
            bookingCode: r.bookingCode,
            unitName: `${r.type} · ${r.model}`,
            serialNo: r.serialNo,
            siteName: [r.line, r.city].filter(Boolean).join(', '),
            downloadsToday,
            remainingToday: Math.max(0, FIELD_SHEET_DAILY_LIMIT - downloadsToday),
          };
        }),
      };
    });
  }

  async download(ctx: RequestContext, body: FieldSheetDownloadRequest): Promise<FieldSheetDownloadResponse> {
    requireTimekeeper(ctx);
    const now = new Date();
    const weekStart = manilaWeekStart(now);
    const today = manilaDate(now);
    const result = await withTenantTx(ctx, async (tx) => {
      const [rental] = await tx.select().from(rentals).where(eq(rentals.id, body.rentalId)).limit(1);
      // 404, not 403: an unassigned site must not confirm the booking exists.
      if (!rental || !(await isAssignedToSite(tx, ctx, rental.projectSiteId))) {
        throw new NotFoundException({ error: 'booking_not_found' });
      }
      // Same rule as the list: only a booking that is on (or about to be on) the ground.
      if (!['confirmed', 'active'].includes(rental.status)) {
        throw new ConflictException({ error: 'booking_not_on_site', status: rental.status });
      }
      const [onRental] = await tx
        .select({ id: equipmentAssignments.id })
        .from(equipmentAssignments)
        .where(
          and(
            eq(equipmentAssignments.rentalId, rental.id),
            eq(equipmentAssignments.equipmentId, body.equipmentId),
            ne(equipmentAssignments.status, 'cancelled'),
          ),
        )
        .limit(1);
      if (!onRental) throw new NotFoundException({ error: 'equipment_not_on_rental' });

      // Serialise concurrent downloads of one unit so two taps cannot both pass the count.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`edtr-sheet:${body.equipmentId}`}))`);
      const [used] = await tx
        .select({ n: count() })
        .from(edtrSheetDownloads)
        .where(and(eq(edtrSheetDownloads.equipmentId, body.equipmentId), eq(edtrSheetDownloads.downloadDate, today)));
      const downloadsToday = Number(used?.n ?? 0);
      if (downloadsToday >= FIELD_SHEET_DAILY_LIMIT) {
        throw new HttpException(
          { error: 'edtr_sheet_daily_limit', limit: FIELD_SHEET_DAILY_LIMIT, resetsOn: addDaysIso(today, 1) },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      await tx.insert(edtrSheetDownloads).values({
        tenantId: ctx.tenantId,
        rentalId: rental.id,
        equipmentId: body.equipmentId,
        weekStart,
        downloadedBy: ctx.userId,
        downloadDate: today,
      });
      return {
        context: await buildEdtrSheetContext(tx, ctx.tenantId, rental),
        weekStart,
        page: await edtrPaperSize(tx),
        remainingToday: FIELD_SHEET_DAILY_LIMIT - downloadsToday - 1,
      };
    });
    await this.events.emit(ctx, 'edtr_sheet_downloaded', { rental_id: body.rentalId, equipment_id: body.equipmentId });
    return result;
  }

  getSettings(ctx: RequestContext): Promise<EdtrSettings> {
    return withTenantTx(ctx, async (tx) => ({ paperSize: await edtrPaperSize(tx) }));
  }

  saveSettings(ctx: RequestContext, body: EdtrSettings): Promise<EdtrSettings> {
    return withTenantTx(ctx, async (tx) => {
      await tx
        .insert(edtrSettings)
        .values({ tenantId: ctx.tenantId, paperSize: body.paperSize })
        .onConflictDoUpdate({ target: edtrSettings.tenantId, set: { paperSize: body.paperSize, updatedAt: new Date() } });
      return { paperSize: body.paperSize };
    });
  }
}

function requireTimekeeper(ctx: RequestContext) {
  if (ctx.role !== 'timekeeper') throw new ForbiddenException({ error: 'timekeeper_only' });
}
