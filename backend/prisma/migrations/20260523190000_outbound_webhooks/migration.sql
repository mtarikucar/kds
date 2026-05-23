-- Outbound webhook subscriptions (tenant-side) + per-event delivery
-- attempts. Each outbox event fans out to N subscriptions; the worker
-- POSTs with an HMAC signature so the receiver can verify authenticity.

CREATE TABLE "tenant_webhook_subscriptions" (
  "id"                  TEXT NOT NULL,
  "tenantId"            TEXT NOT NULL,
  "url"                 TEXT NOT NULL,
  "events"              TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "secretHash"          TEXT NOT NULL,
  "status"              TEXT NOT NULL DEFAULT 'active',
  "lastDeliveryAt"      TIMESTAMP(3),
  "lastDeliveryCode"    INTEGER,
  "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
  "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"           TIMESTAMP(3) NOT NULL,
  CONSTRAINT "tenant_webhook_subscriptions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "tenant_webhook_subscriptions_tenantId_status_idx"
  ON "tenant_webhook_subscriptions" ("tenantId", "status");

CREATE TABLE "webhook_deliveries" (
  "id"                  TEXT NOT NULL,
  "subscriptionId"      TEXT NOT NULL,
  "eventType"           TEXT NOT NULL,
  "eventId"             TEXT NOT NULL,
  "url"                 TEXT NOT NULL,
  "status"              TEXT NOT NULL DEFAULT 'pending',
  "attempts"            INTEGER NOT NULL DEFAULT 0,
  "lastStatusCode"      INTEGER,
  "lastResponseSnippet" TEXT,
  "nextAttemptAt"       TIMESTAMP(3),
  "deliveredAt"         TIMESTAMP(3),
  "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "webhook_deliveries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "webhook_deliveries_subscriptionId_eventId_key"
  ON "webhook_deliveries" ("subscriptionId", "eventId");
CREATE INDEX "webhook_deliveries_status_nextAttemptAt_idx"
  ON "webhook_deliveries" ("status", "nextAttemptAt");
CREATE INDEX "webhook_deliveries_subscriptionId_createdAt_idx"
  ON "webhook_deliveries" ("subscriptionId", "createdAt");

ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_subscriptionId_fkey"
  FOREIGN KEY ("subscriptionId") REFERENCES "tenant_webhook_subscriptions"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
