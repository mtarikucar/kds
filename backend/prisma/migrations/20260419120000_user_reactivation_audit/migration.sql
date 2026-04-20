-- Audit columns for reactivations so the second decision (after the
-- initial approval) leaves a trail.
ALTER TABLE "users" ADD COLUMN "reactivatedAt" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN "reactivatedById" TEXT;

ALTER TABLE "users" ADD CONSTRAINT "users_reactivatedById_fkey"
    FOREIGN KEY ("reactivatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
