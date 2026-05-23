-- HummyTummy Phase 9: caller / phone-order ingest.

CREATE TABLE "caller_events" (
  "id"          TEXT NOT NULL,
  "tenantId"    TEXT NOT NULL,
  "branchId"    TEXT,
  "providerId"  TEXT NOT NULL,
  "callId"      TEXT NOT NULL,
  "kind"        TEXT NOT NULL,
  "e164"        TEXT,
  "customerId"  TEXT,
  "agentUserId" TEXT,
  "durationMs"  INTEGER,
  "meta"        JSONB,
  "orderId"     TEXT,
  "occurredAt"  TIMESTAMP(3) NOT NULL,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "caller_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "caller_events_tenantId_occurredAt_idx" ON "caller_events" ("tenantId", "occurredAt" DESC);
CREATE INDEX "caller_events_tenantId_e164_idx"     ON "caller_events" ("tenantId", "e164");
CREATE INDEX "caller_events_callId_idx"            ON "caller_events" ("callId");
