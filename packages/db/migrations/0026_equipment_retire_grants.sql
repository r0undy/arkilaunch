-- Equipment retire posture. Hand-authored (precedent: 0005, 0007, 0018).
--
-- A machine is never deleted. `edtr.equipment_id` (billing.ts) is the evidence
-- an invoice was computed from, and `equipment_assignments` carries the rental
-- history; both are NO ACTION, so a DELETE would either error at the FK or, if
-- someone later added a cascade, silently destroy billing evidence. Migration
-- 0025 added `retired_at`; this makes setting it the ONLY way a unit can leave
-- the fleet, enforced by the database rather than by application code.
--
-- The column list below is exhaustive over every request-path writer of
-- `equipment`. Omitting one makes that path fail with a bare permission error
-- at the DB, far from its cause:
--   model                 fleet.service.ts       (PATCH /equipment/:id)
--   availability_status   fleet.service.ts, sites.service.ts (deploy/release),
--                         bookings.service.ts    (delivery and return)
--   runtime_hours         edtr.service.ts        (hours accrual on billing)
--   retired_at            fleet.service.ts       (DELETE /equipment/:id)
--   the 0025 spec columns fleet.service.ts       (create/update)
--
-- What this buys beyond blocking DELETE: `serial_no` becomes immutable (a
-- machine's identity cannot be rewritten after DTRs cite it) and `tenant_id`
-- cannot be reassigned, which would move an asset between tenants under RLS.
REVOKE UPDATE, DELETE ON equipment FROM app_authenticated;--> statement-breakpoint
GRANT UPDATE (
  model,
  availability_status,
  runtime_hours,
  retired_at,
  model_number,
  year_of_manufacture,
  weight_capacity_tons,
  engine_type,
  fuel_type,
  notes,
  photo_uri
) ON equipment TO app_authenticated;
