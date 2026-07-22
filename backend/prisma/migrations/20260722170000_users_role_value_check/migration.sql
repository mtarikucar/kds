-- Whitelist the User.role value set at the DB layer. The application already
-- validates every role write with @IsEnum(UserRole); this guards the raw-DB
-- write path (support tooling / Prisma Studio) that bypassed validation and
-- planted an invalid "OWNER" role (v3.2.x incident).
--
-- Added NOT VALID on purpose: it enforces the constraint on every future
-- INSERT/UPDATE but does NOT scan existing rows at deploy time, so a legacy
-- invalid row cannot fail `migrate deploy` / trigger a rollback. Legacy bad
-- rows are surfaced loudly at auth time (ACCOUNT_ROLE_INVALID) and corrected
-- via PATCH /superadmin/users/:id/role. Idempotent: skips if already present.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_role_valid'
  ) THEN
    ALTER TABLE "users"
      ADD CONSTRAINT "users_role_valid"
      CHECK ("role" IN ('ADMIN', 'MANAGER', 'WAITER', 'KITCHEN', 'COURIER'))
      NOT VALID;
  END IF;
END $$;
