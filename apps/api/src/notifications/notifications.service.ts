import { Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, type SQL } from 'drizzle-orm';
import { notifications, pushSubscriptions, sendEmail, withTenantTx } from '@arkilaunch/db';
import { tenantEmailContext } from '../common/notify-customer.js';
import { countRows } from '../common/count-rows.js';
import { notificationEmail, renderEmailHtml } from '@arkilaunch/shared';
import type {
  NotificationListQuery,
  NotificationListResponse,
  PushSubscriptionCreate,
  RequestContext,
  TestEmailRequest,
} from '@arkilaunch/shared';

// Scoped to the caller's OWN rows: the user_id predicate is the boundary, RLS the backstop.
@Injectable()
export class NotificationsService {
  async list(ctx: RequestContext, query: NotificationListQuery): Promise<NotificationListResponse> {
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
      const total = await countRows(tx, notifications, and(...conditions));

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
        .update(notifications)
        .set({ status: 'read' })
        .where(and(eq(notifications.id, id), eq(notifications.userId, ctx.userId)))
        .returning({ id: notifications.id });
      if (!row) throw new NotFoundException({ error: 'notification_not_found' });
      return { id, status: 'read' };
    });
  }

  async markAllRead(ctx: RequestContext) {
    return withTenantTx(ctx, async (tx) => {
      const rows = await tx
        .update(notifications)
        .set({ status: 'read' })
        .where(and(eq(notifications.userId, ctx.userId), eq(notifications.status, 'unread')))
        .returning({ id: notifications.id });
      return { updated: rows.length };
    });
  }

  // A sample money email with made-up data, sent right away (no notification row).
  async sendTestEmail(ctx: RequestContext, body: TestEmailRequest) {
    const { brand, origin } = await withTenantTx(ctx, (tx) => tenantEmailContext(tx));
    const staff = body.type === 'payment_paid' || body.type === 'payment_amount_mismatch';
    const mail = notificationEmail(
      body.type,
      {
        invoiceId: '00000000-0000-4000-8000-000000000000',
        invoiceType: body.type === 'weekly_invoice' ? 'weekly' : 'booking',
        code: 'EQR-2026-0000',
        amountPhp: 12500,
        dueDate: new Date(Date.now() + 7 * 86_400_000),
        rentalId: '00000000-0000-4000-8000-000000000000',
        truckRequestId: null,
      },
      staff ? 'staff' : 'customer',
      origin,
      { paid_centavos: 1_000_000 },
    )!;
    await sendEmail(body.to, `[Test] ${mail.subject}`, mail.text, renderEmailHtml(brand, mail.text));
    // Without RESEND_API_KEY the email is only logged; say so on screen.
    return { sent: true, delivered: Boolean(process.env.RESEND_API_KEY) };
  }

  // The endpoint is unique per tenant: re-subscribing moves it to the caller rather than duplicating.
  async subscribePush(ctx: RequestContext, body: PushSubscriptionCreate) {
    return withTenantTx(ctx, async (tx) => {
      await tx
        .insert(pushSubscriptions)
        .values({ tenantId: ctx.tenantId, userId: ctx.userId, endpoint: body.endpoint, p256dh: body.keys.p256dh, auth: body.keys.auth })
        .onConflictDoUpdate({
          target: [pushSubscriptions.tenantId, pushSubscriptions.endpoint],
          set: { userId: ctx.userId, p256dh: body.keys.p256dh, auth: body.keys.auth },
        });
      return { subscribed: true };
    });
  }

  async unsubscribePush(ctx: RequestContext, endpoint: string): Promise<void> {
    await withTenantTx(ctx, async (tx) => {
      await tx
        .delete(pushSubscriptions)
        .where(and(eq(pushSubscriptions.endpoint, endpoint), eq(pushSubscriptions.userId, ctx.userId)));
    });
  }
}
