-- Two correctness fixes from code review.
--
-- 1. tenant_webhook_subscriptions.secretEnc
--    The outbound webhook worker has to sign each delivery with the raw
--    shared secret so the tenant's receiver can verify the HMAC. We had
--    only the sha256 fingerprint stored, which made the signature
--    impossible for receivers to verify. The new column holds the raw
--    secret encrypted via the KMS abstraction (tenant-scoped AAD).
--    Existing rows stay NULL — their deliveries will be marked failed
--    with a clear error message until the tenant re-subscribes.
--
-- 2. device_commands.updatedAt
--    The sweep-stuck job used `createdAt < now()-5min` as the "stuck"
--    signal. A command created an hour ago that JUST went inflight was
--    being swept as stuck on the next tick. Adding updatedAt (Prisma's
--    @updatedAt) bumps on every status transition so the sweeper can
--    use a proper "claimed-for-too-long" signal.

ALTER TABLE "tenant_webhook_subscriptions" ADD COLUMN "secretEnc" BYTEA;

ALTER TABLE "device_commands"
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Backfill existing rows so the column is populated for the sweeper.
UPDATE "device_commands" SET "updatedAt" = "createdAt";

CREATE INDEX "device_commands_status_updatedAt_idx"
  ON "device_commands" ("status", "updatedAt");
