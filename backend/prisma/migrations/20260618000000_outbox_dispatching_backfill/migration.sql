-- Reclaim outbox events orphaned in status='dispatching' BEFORE the H16 reaper
-- shipped.
--
-- The runtime reaper (OutboxWorkerService.reclaimStuck) re-queues stuck rows
-- only WHERE "status" = 'dispatching' AND "nextAttemptAt" IS NOT NULL — it keys
-- off the claim timestamp that the claim UPDATE now stamps into nextAttemptAt.
-- Rows that were already orphaned in 'dispatching' (a worker crash before the
-- claim started stamping nextAttemptAt) carry nextAttemptAt=NULL, so the reaper
-- skips them forever and their events are never delivered.
--
-- Flip those pre-existing orphans back to 'queued' with nextAttemptAt=NULL so
-- the drain loop (which selects status='queued' AND (nextAttemptAt IS NULL OR
-- nextAttemptAt <= now())) picks them up on the next tick. Re-dispatch is safe
-- under the at-least-once contract — consumers dedupe on idempotencyKey.
--
-- Idempotent: gated on the exact orphan shape (status='dispatching' AND
-- nextAttemptAt IS NULL). Once these rows are re-queued (or live workers stamp
-- nextAttemptAt on every claim), the predicate matches nothing, so re-running
-- is a no-op.
UPDATE "outbox_events"
   SET "status" = 'queued',
       "nextAttemptAt" = NULL,
       "lastError" = 'reclaimed: orphaned in dispatching before H16 reaper (pre-deploy backfill)'
 WHERE "status" = 'dispatching'
   AND "nextAttemptAt" IS NULL;
