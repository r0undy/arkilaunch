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
import { runJobIfMain } from './telemetry.js';

// Notifies only: no money movement and no state change.
const NOTIFICATION_TYPE = 'maintenance_due';
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
        serialNo: equipment.serialNo,
        model: equipment.model,
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

    // Batched reads: a round trip per schedule times the job out.
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
      // Dedup on (equipment, threshold value): re-arms only when a log resets next_due.
      const key = `${type}|${item.equipmentId}|${item.scheduleId}|${String(item.nextDue)}`;
      if (seen.has(key)) continue;
      seen.add(key);

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
            serial_no: item.serialNo,
            model: item.model,
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

runJobIfMain(import.meta.url, 'pm-notify', runMaintenanceNotify);
