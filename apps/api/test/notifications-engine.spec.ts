import { describe, expect, it, beforeAll } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import postgres from 'postgres';
import { notifications, withTenantTx } from '@arkilaunch/db';
import type { RequestContext } from '@arkilaunch/shared';
import { NotificationsService } from '../src/notifications/notifications.service.js';

// PRD §5.2 global nav notifications feed (cr-arkilaunch-f9-read-surface.md).
// jobs/src/maintenance-notify.ts is the writer; this is the first reader.
describe('NotificationsService', () => {
  const service = new NotificationsService();
  let adminCtx: RequestContext;
  let timekeeperCtx: RequestContext;

  beforeAll(async () => {
    const url = process.env.DATABASE_URL_DIRECT;
    if (!url) throw new Error('DATABASE_URL_DIRECT is required');
    const sql = postgres(url, { max: 1 });
    const [tenant] = await sql`select id from tenants where slug = 'test-tenant-a'`;
    const tenantId = (tenant as { id: string }).id;
    const [admin] = await sql`select id from users where tenant_id = ${tenantId} and email = 'admin@test-tenant-a.test'`;
    const [timekeeper] = await sql`select id from users where tenant_id = ${tenantId} and email = 'timekeeper@test-tenant-a.test'`;
    adminCtx = { tenantId, userId: (admin as { id: string }).id, role: 'admin' };
    timekeeperCtx = { tenantId, userId: (timekeeper as { id: string }).id, role: 'timekeeper' };
    await sql.end();

    await withTenantTx(adminCtx, (tx) =>
      tx.insert(notifications).values({
        tenantId: adminCtx.tenantId,
        userId: adminCtx.userId,
        notificationType: 'test_notification',
        payload: { note: 'for admin only' },
      }),
    );
  });

  it('a user sees only their own notifications, even within the same tenant', async () => {
    const adminView = await service.list(adminCtx, { limit: 50, offset: 0 });
    expect(adminView.total).toBeGreaterThan(0);
    expect(
      adminView.items.some((item) => (item.payload as { note?: string } | null)?.note === 'for admin only'),
    ).toBe(true);

    const timekeeperView = await service.list(timekeeperCtx, { limit: 50, offset: 0 });
    expect(
      timekeeperView.items.some((item) => (item.payload as { note?: string } | null)?.note === 'for admin only'),
    ).toBe(false);
  });

  it("PATCH /notifications/:id/read marks the caller's own notification read, and denies marking another user's", async () => {
    const { items } = await service.list(adminCtx, { status: 'unread', limit: 50, offset: 0 });
    const target = items.find((item) => (item.payload as { note?: string } | null)?.note === 'for admin only');
    expect(target).toBeDefined();

    const result = await service.markRead(adminCtx, target!.id);
    expect(result.status).toBe('read');

    // A different user in the same tenant cannot mark someone else's
    // notification read -- ownership is the boundary, RLS is the backstop.
    await withTenantTx(adminCtx, (tx) =>
      tx.insert(notifications).values({
        tenantId: adminCtx.tenantId,
        userId: adminCtx.userId,
        notificationType: 'test_notification',
        payload: { note: 'second admin-only notification' },
      }),
    );
    const { items: adminUnread } = await service.list(adminCtx, { status: 'unread', limit: 50, offset: 0 });
    const otherUsersNotification = adminUnread.find(
      (item) => (item.payload as { note?: string } | null)?.note === 'second admin-only notification',
    );
    expect(otherUsersNotification).toBeDefined();
    await expect(service.markRead(timekeeperCtx, otherUsersNotification!.id)).rejects.toThrow(NotFoundException);
  });
});
