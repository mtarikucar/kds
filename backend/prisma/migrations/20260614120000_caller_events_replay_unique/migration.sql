-- Wave-C caller replay/dedup. Provider webhooks are at-least-once, so the
-- same (tenantId, providerId, callId, kind) can be delivered more than once.
-- Make idempotency authoritative at the DB level with a UNIQUE index; the
-- ingest path (CallerService.ingest) catches the resulting P2002 and treats
-- the replay as a no-op so downstream consumers don't double-fire.
--
-- Hand-written per the repo's migrate-broken-locally workflow: apply via
-- `prisma migrate deploy` in the deploy baseline pipeline (not `db push`).

-- 1) Dedup any pre-existing rows so the unique index can be created. Keep the
--    earliest row per (tenantId, providerId, callId, kind) — that is the
--    original "first delivery" — and drop later duplicate replays.
DELETE FROM "caller_events" a
USING "caller_events" b
WHERE a."tenantId"   = b."tenantId"
  AND a."providerId" = b."providerId"
  AND a."callId"     = b."callId"
  AND a."kind"       = b."kind"
  AND (
    a."createdAt" > b."createdAt"
    OR (a."createdAt" = b."createdAt" AND a."id" > b."id")
  );

-- 2) Per-tenant uniqueness on the natural replay key. Name matches the
--    Prisma `@@unique(..., name: "caller_events_replay_key")` mapping.
CREATE UNIQUE INDEX IF NOT EXISTS "caller_events_replay_key"
  ON "caller_events" ("tenantId", "providerId", "callId", "kind");
