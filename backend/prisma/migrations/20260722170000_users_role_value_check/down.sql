-- Rollback for users_role_value_check. Drops the whitelist CHECK constraint
-- added by the up migration. Idempotent (IF EXISTS) and touches no data rows.
ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_role_valid";
