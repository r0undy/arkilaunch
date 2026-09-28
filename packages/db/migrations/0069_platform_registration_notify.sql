-- Hand-authored (CR: cr-arkilaunch-qa-batch-23-28.md, QA 26). The platform
-- admin's feed was always empty: nothing ever wrote to it. A new rental
-- company registering now tells every active platform admin, linking to the
-- application. POST /tenants/register is public (no tenant context), so the
-- row is written by this trigger inside tenants_register(), not the API:
-- SECURITY DEFINER with no callable surface of its own, and a fixed type and
-- payload built from the new row only.
CREATE OR REPLACE FUNCTION notify_platform_admins_of_registration() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO notifications (tenant_id, user_id, notification_type, payload)
  SELECT u.tenant_id, u.id, 'tenant_registered',
         jsonb_build_object('application_id', NEW.id, 'company_name', NEW.company_name)
    FROM users u JOIN roles r ON r.id = u.role_id
   WHERE r.name = 'platform_admin' AND u.status = 'active';
  RETURN NEW;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION notify_platform_admins_of_registration() FROM PUBLIC;--> statement-breakpoint
DROP TRIGGER IF EXISTS tenant_applications_notify_platform ON tenant_applications;--> statement-breakpoint
CREATE TRIGGER tenant_applications_notify_platform
  AFTER INSERT ON tenant_applications
  FOR EACH ROW EXECUTE FUNCTION notify_platform_admins_of_registration();
