-- Append-only Postgres role for audit tables.
--
-- Rationale: the application connects as a single user that holds the full
-- INSERT/UPDATE/DELETE matrix on every business table. That blast radius is
-- fine for orders + menu + customers, but it's an unnecessary risk for the
-- audit log + outbox: a bug or compromised admin shouldn't be able to
-- delete forensic evidence. We provision a `hummytummy_audit_writer` role
-- with INSERT-only privileges on the audit-relevant tables and grant it to
-- the application user, then revoke UPDATE/DELETE on the same tables from
-- the application user.
--
-- This is the **schema** half of the change. The **runtime** half is to
-- switch the application's DATABASE_URL to use a SECURITY-DEFINER function
-- when writing to these tables, OR to make the application user a member
-- of the writer role and revoke the broader rights — see docs below for
-- the recommended deployment recipe.
--
-- Idempotent: re-running the migration is safe.

-- Create the role only if it doesn't exist.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hummytummy_audit_writer') THEN
    CREATE ROLE "hummytummy_audit_writer" NOLOGIN;
  END IF;
END $$;

-- Grant USAGE on the schema and INSERT on the audit-relevant tables.
GRANT USAGE ON SCHEMA public TO "hummytummy_audit_writer";

-- Tables we treat as audit-relevant:
--   audit_logs         (existing)
--   outbox_events      (HummyTummy outbox)
--   device_logs        (mesh telemetry)
--   integration_webhook_events
--   webhook_deliveries
--   caller_events
--
-- INSERT-only, plus SELECT for the worker that drains the outbox.
GRANT INSERT, SELECT ON "audit_logs"               TO "hummytummy_audit_writer";
GRANT INSERT, SELECT, UPDATE ON "outbox_events"    TO "hummytummy_audit_writer";  -- worker flips status
GRANT INSERT, SELECT ON "device_logs"              TO "hummytummy_audit_writer";
GRANT INSERT, SELECT, UPDATE ON "integration_webhook_events" TO "hummytummy_audit_writer";
GRANT INSERT, SELECT, UPDATE ON "webhook_deliveries" TO "hummytummy_audit_writer";
GRANT INSERT, SELECT ON "caller_events"            TO "hummytummy_audit_writer";

-- (UPDATE/DELETE deliberately NOT granted on append-only rows.)

-- Note for ops:
--   To activate the harder posture, after this migration runs:
--     1. GRANT "hummytummy_audit_writer" TO <app_user>;
--     2. REVOKE UPDATE, DELETE ON "audit_logs"            FROM <app_user>;
--     3. REVOKE UPDATE, DELETE ON "device_logs"           FROM <app_user>;
--     4. REVOKE UPDATE, DELETE ON "caller_events"         FROM <app_user>;
--   The application keeps full UPDATE/DELETE on outbox_events because the
--   worker drains them. integration_webhook_events + webhook_deliveries
--   keep UPDATE because the worker bumps status/attempts.
--
--   Steps 2–4 are intentionally NOT in this migration because they are
--   environment-specific (the app user name varies). Run them manually as
--   part of the production hardening checklist.
