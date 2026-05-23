-- HummyTummy Phase 11: integration gateway.

CREATE TABLE "integration_providers" (
  "id"           TEXT NOT NULL,
  "kind"         TEXT NOT NULL,
  "name"         TEXT NOT NULL,
  "description"  TEXT,
  "configSchema" JSONB NOT NULL,
  "isOfficial"   BOOLEAN NOT NULL DEFAULT TRUE,
  "status"       TEXT NOT NULL DEFAULT 'published',
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL,
  CONSTRAINT "integration_providers_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "integration_providers_kind_status_idx" ON "integration_providers" ("kind", "status");

CREATE TABLE "integration_connections" (
  "id"             TEXT NOT NULL,
  "tenantId"       TEXT NOT NULL,
  "branchId"       TEXT,
  "providerId"     TEXT NOT NULL,
  "status"         TEXT NOT NULL DEFAULT 'pending',
  "credentialsEnc" BYTEA,
  "config"         JSONB,
  "lastEventAt"    TIMESTAMP(3),
  "lastError"      TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "integration_connections_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "integration_connections_tenantId_providerId_idx" ON "integration_connections" ("tenantId", "providerId");
CREATE INDEX "integration_connections_status_idx" ON "integration_connections" ("status");

ALTER TABLE "integration_connections" ADD CONSTRAINT "integration_connections_providerId_fkey"
  FOREIGN KEY ("providerId") REFERENCES "integration_providers"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "integration_webhook_events" (
  "id"           TEXT NOT NULL,
  "tenantId"     TEXT,
  "connectionId" TEXT,
  "providerId"   TEXT NOT NULL,
  "type"         TEXT NOT NULL,
  "signature"    TEXT,
  "payload"      JSONB NOT NULL,
  "receivedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processedAt"  TIMESTAMP(3),
  "result"       TEXT,
  "attempts"     INTEGER NOT NULL DEFAULT 0,
  "lastError"    TEXT,
  CONSTRAINT "integration_webhook_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "integration_webhook_events_connectionId_receivedAt_idx"
  ON "integration_webhook_events" ("connectionId", "receivedAt");
CREATE INDEX "integration_webhook_events_providerId_receivedAt_idx"
  ON "integration_webhook_events" ("providerId", "receivedAt");

ALTER TABLE "integration_webhook_events" ADD CONSTRAINT "integration_webhook_events_connectionId_fkey"
  FOREIGN KEY ("connectionId") REFERENCES "integration_connections"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
