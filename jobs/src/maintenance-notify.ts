import { and, eq, gte, inArray, isNotNull, sql } from 'drizzle-orm';
import {
  equipment,
  events,
  maintenanceSchedules,
  notifications,
  permissions,
  rolePermissions,
  roles,
  users,
} from '@arkilaunch/db';
import { makeJobDb } from './db-client.js';
import { runInstrumentedJob } from './telemetry.js';

// PRD-F4 (PM-threshold notification), SDD §4: "No money movement and no
// autonomous state change: it notifies, a human schedules the
// maintenance." Recording a maintenance log (apps/api/src/fleet's
// recordMaintenanceLog) is the only path that advances the countdown --
// this job only ever writes a `notifications` row.
const NOTIFICATION_TYPE = 'maintenance_due';
// An early heads-up once a unit has run 90% of a task's interval.
const WARNING_TYPE = 'maintenance_warning';
const WARNING_REMAINDER = 0.1; // warn with 10% of the interval left
const RECIPIENT_PERMISSION = 'fleet:manage';

export async function runMaintenanceNotify(): Promise<void> {
  const { db, client } = makeJobDb();

  try {
    const due = await db
      .select({
        equipmentId: equipment.id,
        tenantId: equipment.tenantId,
        runtimeHours: equipment.runtimeHours,
        nextDue: maintenanceSchedules.nextDue,
        scheduleId: maintenanceSchedules.id,
        task: maintenanceSchedules.task,
        hoursInterval: maintenanceSchedules.hoursInterval,
      })
      .from(equipment)
      .innerJoin(maintenanceSchedules, eq(maintenanceSchedules.equipmentId, equipment.id))
      .where(
        and(
          isNotNull(maintenanceSchedules.nextDue),
          // The interval started at next_due - interval; 90% of the way there.
          gte(
            equipment.runtimeHours,
            sql`${maintenanceSchedules.nextDue} - ${maintenanceSchedules.hoursInterval} * ${WARNING_REMAINDER}`,
          ),
        ),
      );

    console.log(`maintenance-notify: ${due.length} schedule(s) at or past 90% of their interval.`);

    // One read for every dedup key and one per tenant for recipients: a
    // round trip per schedule timed the job out once a few hundred schedules
    // sat past 90%.
    const seen = new Set(
      (
        await db
          .select({ type: notifications.notificationType, payload: notifications.payload })
          .from(notifications)
          .where(inArray(notifications.notificationType, [NOTIFICATION_TYPE, WARNING_TYPE]))
      ).map((row) => {
        const p = row.payload as Record<string, unknown>;
        return `${row.type}|${String(p.equipment_id)}|${String(p.schedule_id)}|${String(p.threshold)}`;
      }),
    );
    const recipientsByTenant = new Map<string, { id: string }[]>();

    for (const item of due) {
      const type =
        Number(item.runtimeHours) >= Number(item.nextDue) ? NOTIFICATION_TYPE : WARNING_TYPE;
      // Dedup on (equipment, threshold value): once a maintenance log
      // resets next_due, the threshold value changes and a fresh
      // notification can fire again for the next interval, but the SAME
      // threshold never re-notifies every 30-minute cycle it stays crossed.
      const key = `${type}|${item.equipmentId}|${item.scheduleId}|${String(item.nextDue)}`;
      if (seen.has(key)) continue;
      seen.add(key);

      // A1: notifications.user_id is NOT NULL, so the recipient set is
      // every active user holding fleet:manage in this tenant, not an
      // invented default.
      const recipients =
        recipientsByTenant.get(item.tenantId) ??
        (await db
          .select({ id: users.id })
          .from(users)
          .innerJoin(roles, eq(roles.id, users.roleId))
          .innerJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
          .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
          .where(
            and(
              eq(users.tenantId, item.tenantId),
              eq(users.status, 'active'),
              eq(permissions.code, RECIPIENT_PERMISSION),
            ),
          ));
      recipientsByTenant.set(item.tenantId, recipients);

      if (recipients.length === 0) {
        await db.insert(events).values({
          tenantId: item.tenantId,
          name: 'external_dependency_degraded',
          properties: {
            dependency: 'maintenance_notify',
            mode: 'no_recipient',
            equipment_id: item.equipmentId,
          },
        });
        console.warn(
          `maintenance-notify: tenant ${item.tenantId} has no active fleet:manage user; skipping equipment ${item.equipmentId}.`,
        );
        continue;
      }

      await db.insert(notifications).values(
        recipients.map((recipient) => ({
          tenantId: item.tenantId,
          userId: recipient.id,
          notificationType: type,
          payload: {
            equipment_id: item.equipmentId,
            schedule_id: item.scheduleId,
            task: item.task,
            threshold: item.nextDue,
            runtime_hours: item.runtimeHours,
          },
        })),
      );
    }
  } finally {
    await client.end();
  }
}

const isMainModule =
  process.argv[1] && import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}`;
if (isMainModule) {
  runInstrumentedJob('pm-notify', () => runMaintenanceNotify()).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
