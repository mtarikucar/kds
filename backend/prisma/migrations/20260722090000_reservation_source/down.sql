-- Rollback: drops exactly the column the up added. Idempotent no-op via
-- IF EXISTS when already reverted. Touches only the column this migration
-- created; leaves all reservation data untouched.
ALTER TABLE "reservations" DROP COLUMN IF EXISTS "source";
