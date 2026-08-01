-- Must run before 0001 (which creates policies "TO app_authenticated" --
-- the role must already exist). Hand-authored: drizzle-kit's pgRole
-- .existing() marker deliberately does not generate CREATE ROLE (RFC-1 §3:
-- the role is provisioned once per database, not per schema-diff).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_authenticated') THEN
    CREATE ROLE app_authenticated LOGIN NOBYPASSRLS;
  END IF;
END
$$;
