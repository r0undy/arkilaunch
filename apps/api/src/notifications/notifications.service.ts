import { Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, type SQL } from 'drizzle-orm';
import { notifications, withTenantTx } from '@arkilaunch/db';
import type { NotificationListQuery, RequestContext } from '@arkilaunch/shared';

// Global nav notifications feed (PRD §5.2: "notifications (PM alerts,
// weather advisories, review-queue count)... on every authed screen").
// jobs/src/maintenance-notify.ts already writes rows here; nothing could
// read them before this pass. Scoped to the caller's OWN rows
// (notifications.user_id = ctx.userId) -- reading your own notifications
// is not a privileged action, so there is no @RequirePermission gate; the
// user_id predicate is the boundary, RLS is the backstop behind it.
@Injectable()
export class NotificationsService {
  async list(ctx: RequestContext, query: NotificationListQuery) {
    return withTenantTx(ctx, async (tx) => {
      const conditions: SQL[] = [eq(notifications.userId, ctx.userId)];
      if (query.status) conditions.push(eq(notifications.status, query.status));

      const rows = await tx
        .select()
        .from(notifications)
        .where(and(...conditions))
        .orderBy(desc(notifications.createdAt))
        .limit(query.limit)
        .offset(query.offset);
      const total = (await tx.select().from(notifications).where(and(...conditions))).length;

      return {
        items: rows.map((row) => ({
          id: row.id,
          notificationType: row.notificationType,
          payload: row.payload,
          status: row.status,
          createdAt: row.createdAt,
        })),
        total,
      };
    });
  }

  async markRead(ctx: RequestContext, id: string) {
    return withTenantTx(ctx, async (tx) => {
      const [row] = await tx
        .select()
        .from(notifications)
        .where(and(eq(notifications.id, id), eq(notifications.userId, ctx.userId)))
        .limit(1);
      if (!row) throw new NotFoundException({ error: 'notification_not_found' });

      await tx.update(notifications).set({ status: 'read' }).where(eq(notifications.id, id));
      return { id, status: 'read' };
    });
  }
}
