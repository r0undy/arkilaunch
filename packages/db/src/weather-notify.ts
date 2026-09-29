import { and, eq, inArray } from 'drizzle-orm';
import type { Executor } from './with-tenant-tx.js';
import webpush from 'web-push';
import {
  renderEmailHtml,
  tenantWebOrigin,
  weatherEmail,
  weatherNoticePath,
  weatherNoticeText,
  type WeatherAudience,
  type WeatherNoticeMachine,
  type WeatherNoticeType,
} from '@arkilaunch/shared';
import { customers } from './schema/customers.js';
import { roles, tenants, users } from './schema/tenancy.js';
import { rentals, timekeeperSiteAssignments } from './schema/rentals.js';
import { notifications, pushSubscriptions } from './schema/weather.js';
import { sendEmail } from './send-email.js';
import { publicPhotoUrl } from './public-url.js';

// Called by the weather jobs as service_role, so every query names the tenant explicitly.

interface Recipient {
  userId: string;
  email: string;
  prefs: { email: boolean; inApp: boolean };
  audience: WeatherAudience;
  rentalIds: Set<string>;
}

// A user in more than one audience is told once, as the most specific: timekeeper first.
async function siteRecipients(ex: Executor, tenantId: string, siteId: string, rentalIds: string[]): Promise<Recipient[]> {
  const byUser = new Map<string, Recipient>();
  const add = (row: { id: string; email: string; prefs: Recipient['prefs'] }, audience: WeatherAudience, rentalId?: string) => {
    const existing = byUser.get(row.id);
    if (existing) {
      if (rentalId) existing.rentalIds.add(rentalId);
      return;
    }
    byUser.set(row.id, { userId: row.id, email: row.email, prefs: row.prefs, audience, rentalIds: new Set(rentalId ? [rentalId] : []) });
  };
  const cols = { id: users.id, email: users.email, prefs: users.notificationPrefs };

  const timekeepers = await ex
    .select(cols)
    .from(timekeeperSiteAssignments)
    .innerJoin(users, eq(users.id, timekeeperSiteAssignments.userId))
    .where(
      and(
        eq(timekeeperSiteAssignments.tenantId, tenantId),
        eq(timekeeperSiteAssignments.projectSiteId, siteId),
        eq(users.status, 'active'),
      ),
    );
  for (const row of timekeepers) add(row, 'timekeeper');

  if (rentalIds.length > 0) {
    const renters = await ex
      .select({ ...cols, rentalId: rentals.id })
      .from(rentals)
      .innerJoin(customers, eq(customers.id, rentals.customerId))
      .innerJoin(users, eq(users.id, customers.userId))
      .where(and(eq(rentals.tenantId, tenantId), inArray(rentals.id, rentalIds), eq(users.status, 'active')));
    for (const row of renters) add(row, 'customer', row.rentalId);
  }

  const admins = await ex
    .select(cols)
    .from(users)
    .innerJoin(roles, eq(roles.id, users.roleId))
    .where(and(eq(users.tenantId, tenantId), inArray(roles.name, ['admin', 'owner']), eq(users.status, 'active')));
  for (const row of admins) add(row, 'staff');

  return [...byUser.values()];
}

let vapidReady: boolean | null = null;
function vapidConfigured(): boolean {
  if (vapidReady !== null) return vapidReady;
  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = process.env;
  vapidReady = Boolean(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);
  if (vapidReady) webpush.setVapidDetails(VAPID_SUBJECT ?? 'mailto:support@arkilaunch.com', VAPID_PUBLIC_KEY!, VAPID_PRIVATE_KEY!);
  return vapidReady;
}

// A gone subscription (404/410) is deleted; other failures are logged, never thrown.
async function pushTo(ex: Executor, tenantId: string, userId: string, message: { title: string; body: string; url: string }) {
  if (!vapidConfigured()) {
    console.warn(`[Push] VAPID keys not set; push to user ${userId} not sent.`);
    return;
  }
  const subs = await ex
    .select()
    .from(pushSubscriptions)
    .where(and(eq(pushSubscriptions.tenantId, tenantId), eq(pushSubscriptions.userId, userId)));
  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify(message),
        { TTL: 3600, urgency: 'high' },
      );
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        await ex.delete(pushSubscriptions).where(eq(pushSubscriptions.id, sub.id));
      } else {
        console.error(`[Push] send to user ${userId} failed`, err);
      }
    }
  }
}

// The in-app row is always written: it is the proof the warning went out.
export async function notifySiteWeather(
  ex: Executor,
  tenantId: string,
  siteId: string,
  type: WeatherNoticeType,
  payload: Record<string, unknown> & { machines?: WeatherNoticeMachine[] },
  rentalIds: string[],
): Promise<string[]> {
  const recipients = await siteRecipients(ex, tenantId, siteId, rentalIds);
  if (recipients.length === 0) return [];

  const [tenant] = await ex
    .select({ name: tenants.legalName, slug: tenants.slug, logoKey: tenants.logoKey, color: tenants.primaryColor })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);
  const webOrigin = process.env.WEB_ORIGIN ?? 'http://localhost:5173';
  const origin = tenant ? tenantWebOrigin(tenant.slug, webOrigin, process.env.PLATFORM_DOMAIN) : webOrigin;
  const brand = { name: tenant?.name ?? 'ArkiLaunch', logoUrl: publicPhotoUrl(tenant?.logoKey ?? null), color: tenant?.color ?? null };

  const deliveries: { r: Recipient; body: Record<string, unknown>; noticeType: WeatherNoticeType }[] = [];
  for (const r of recipients) {
    let body: Record<string, unknown> = { ...payload, audience: r.audience };
    if (r.audience === 'customer') {
      if (payload.machines) {
        const own = payload.machines.filter((m) => r.rentalIds.has(m.rentalId));
        if (own.length === 0) continue;
        body = { ...body, machines: own, rental_id: own[0]!.rentalId };
      } else if (typeof payload.rental_id === 'string' && !r.rentalIds.has(payload.rental_id)) {
        continue;
      }
    }
    // The live warning keeps its two historical types: the customer's links to their booking, everyone else's to the site.
    const noticeType = type === 'equipment_weather_warning' && r.audience !== 'customer' ? 'equipment_weather_alert' : type;
    deliveries.push({ r, body, noticeType });
  }
  if (deliveries.length === 0) return [];

  await ex.insert(notifications).values(
    deliveries.map(({ r, body, noticeType }) => ({ tenantId, userId: r.userId, notificationType: noticeType, payload: body })),
  );

  for (const { r, body, noticeType } of deliveries) {
    if (r.prefs.email) {
      const mail = weatherEmail(noticeType, body, r.audience, origin);
      await sendEmail(r.email, mail.subject, mail.text, renderEmailHtml(brand, mail.text)).catch((err) =>
        console.error(`[Email] weather notice to user ${r.userId} failed`, err),
      );
    }
    const text = weatherNoticeText(noticeType, body, r.audience);
    await pushTo(ex, tenantId, r.userId, { ...text, url: weatherNoticePath(r.audience, body) });
  }
  return deliveries.map((d) => d.r.userId);
}
