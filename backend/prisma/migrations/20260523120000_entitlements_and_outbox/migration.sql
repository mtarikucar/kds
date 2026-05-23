-- HummyTummy Phase 1: entitlement engine + outbox seam.
--
-- feature_entitlements is the single source of truth for "what can this
-- tenant do right now". Each row is a grant from one source — a plan, an
-- add-on, an admin override, or a grace window. The engine folds rows by
-- key with type-specific rules (feature OR, limit SUM, integration UNION).
-- The (tenantId, branchId, key, source) unique key lets the projector
-- upsert idempotently: re-running it just refreshes existing rows.
--
-- outbox_events buffers domain events for durable, at-least-once delivery.
-- Producers write rows inside the same transaction as the business change;
-- the worker drains them onto the in-process bus. Consumers MUST be
-- idempotent on idempotencyKey. UUIDv7 ids sort chronologically so the
-- worker can scan oldest-first with a plain ORDER BY id.
--
-- Both tables are intentionally schema-agnostic (no FK to tenants) so a
-- tenant deletion doesn't cascade-wipe audit-relevant events; the
-- application layer treats orphaned rows defensively.

CREATE TABLE "feature_entitlements" (
  "id"          TEXT NOT NULL,
  "tenantId"    TEXT NOT NULL,
  "scope"       TEXT NOT NULL DEFAULT 'tenant',
  "branchId"    TEXT,
  "key"         TEXT NOT NULL,
  "value"       JSONB NOT NULL,
  "source"      TEXT NOT NULL,
  "validUntil"  TIMESTAMP(3),
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  CONSTRAINT "feature_entitlements_pkey" PRIMARY KEY ("id")
);

-- Postgres treats NULL values in unique constraints as distinct, so
-- (tenant, NULL branch, key, source) and (tenant, NULL branch, key, source)
-- would NOT conflict. Use NULLS NOT DISTINCT (PG 15+) so the upsert key
-- works for tenant-scoped rows too.
CREATE UNIQUE INDEX "feature_entitlements_tenantId_branchId_key_source_key"
  ON "feature_entitlements" ("tenantId", "branchId", "key", "source")
  NULLS NOT DISTINCT;

CREATE INDEX "feature_entitlements_tenantId_key_idx"
  ON "feature_entitlements" ("tenantId", "key");

CREATE INDEX "feature_entitlements_tenantId_scope_idx"
  ON "feature_entitlements" ("tenantId", "scope");

-- Partial index speeds up the sweeper that revokes expired grace grants.
CREATE INDEX "feature_entitlements_validUntil_idx"
  ON "feature_entitlements" ("validUntil")
  WHERE "validUntil" IS NOT NULL;

CREATE TABLE "outbox_events" (
  "id"             TEXT NOT NULL,
  "type"           TEXT NOT NULL,
  "tenantId"      TEXT,
  "payload"        JSONB NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "status"         TEXT NOT NULL DEFAULT 'queued',
  "attempts"       INTEGER NOT NULL DEFAULT 0,
  "lastError"      TEXT,
  "dispatchedAt"   TIMESTAMP(3),
  "nextAttemptAt"  TIMESTAMP(3),
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- Worker scan: oldest pending first.
CREATE INDEX "outbox_events_status_nextAttemptAt_idx"
  ON "outbox_events" ("status", "nextAttemptAt");

CREATE INDEX "outbox_events_type_createdAt_idx"
  ON "outbox_events" ("type", "createdAt");

CREATE INDEX "outbox_events_tenantId_createdAt_idx"
  ON "outbox_events" ("tenantId", "createdAt");
