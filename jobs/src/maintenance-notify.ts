import { and, eq, gte, isNotNull, sql } from 'drizzle-orm';
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
      })
      .from(equipment)
      .innerJoin(maintenanceSchedules, eq(maintenanceSchedules.equipmentId, equipment.id))
      .where(and(isNotNull(maintenanceSchedules.nextDue), gte(equipment.runtimeHours, maintenanceSchedules.nextDue)));

    console.log(`maintenance-notify: ${due.length} unit(s) at or past their maintenance threshold.`);

    for (const item of due) {
      // Dedup on (equipment, threshold value): once a maintenance log
      // resets next_due, the threshold value changes and a fresh
      // notification can fire again for the next interval, but the SAME
      // threshold never re-notifies every 30-minute cycle it stays crossed.
      const existing = await db
        .select({ id: notifications.id })
        .from(notifications)
        .where(
          and(
            eq(notifications.tenantId, item.tenantId),
            eq(notifications.notificationType, NOTIFICATION_TYPE),
            sql`${notifications.payload} ->> 'equipment_id' = ${item.equipmentId}`,
            sql`${notifications.payload} ->> 'threshold' = ${item.nextDue}`,
          ),
        )
        .limit(1);
      if (existing.length > 0) continue;

      // A1: notifications.user_id is NOT NULL, so the recipient set is
      // every active user holding fleet:manage in this tenant, not an
      // invented default.
      const recipients = await db
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
        );

      if (recipients.length === 0) {
        await db.insert(events).values({
          tenantId: item.tenantId,
          name: 'external_dependency_degraded',
          properties: { dependency: 'maintenance_notify', mode: 'no_recipient', equipment_id: item.equipmentId },
        });
        console.warn(
          `maintenance-notify: tenant ${item.tenantId} has no active fleet:manage user; skipping equipment ${item.equipmentId}.`,
        );
        continue;
      }

      for (const recipient of recipients) {
        await db.insert(notifications).values({
          tenantId: item.tenantId,
          userId: recipient.id,
          notificationType: NOTIFICATION_TYPE,
          payload: { equipment_id: item.equipmentId, threshold: item.nextDue, runtime_hours: item.runtimeHours },
        });
      }
    }
  } finally {
    await client.end();
  }
}

const isMainModule = process.argv[1] && import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}`;
if (isMainModule) {
  runInstrumentedJob('pm-notify', () => runMaintenanceNotify()).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
