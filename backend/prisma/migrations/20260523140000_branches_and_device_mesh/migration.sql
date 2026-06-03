-- HummyTummy Phase 3: branches + device mesh.
--
-- Branches are introduced as a first-class location entity. Every existing
-- tenant gets a default "Main" branch so the feature can roll out without
-- breaking single-location tenants — application code can keep ignoring
-- branchId until each module opts in.
--
-- The Device Mesh tables (devices, device_commands, device_logs,
-- local_bridge_agents) implement the brand-agnostic registry described in
-- the architecture plan. Devices carry a `capabilities` string[] and the
-- routing layer dispatches on that rather than on vendor brand strings.

-- Branches ---------------------------------------------------------------

CREATE TABLE "branches" (
  "id"        TEXT NOT NULL,
  "tenantId"  TEXT NOT NULL,
  "name"      TEXT NOT NULL DEFAULT 'Main',
  "code"      TEXT,
  "timezone"  TEXT NOT NULL DEFAULT 'UTC',
  "address"   JSONB,
  "status"    TEXT NOT NULL DEFAULT 'active',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "branches_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "branches_tenantId_code_key" ON "branches" ("tenantId", "code")
  WHERE "code" IS NOT NULL;
CREATE INDEX "branches_tenantId_status_idx" ON "branches" ("tenantId", "status");

-- Backfill: one "Main" branch per existing tenant. Existing single-location
-- tenants continue to work; multi-branch operators can rename/split later.
-- gen_random_uuid() is available since Postgres 13 via pgcrypto, which the
-- core install enables by default; if missing the migration will fail
-- loudly with a clear error.
INSERT INTO "branches" ("id", "tenantId", "name", "timezone", "status", "updatedAt")
SELECT
  gen_random_uuid()::TEXT,
  t.id,
  'Main',
  COALESCE(t.timezone, 'UTC'),
  'active',
  CURRENT_TIMESTAMP
FROM "tenants" t;

-- Devices ----------------------------------------------------------------

CREATE TABLE "devices" (
  "id"                TEXT NOT NULL,
  "tenantId"          TEXT NOT NULL,
  "branchId"          TEXT,
  "kind"              TEXT NOT NULL,
  "capabilities"      TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "status"            TEXT NOT NULL DEFAULT 'unprovisioned',
  "lastSeenAt"        TIMESTAMP(3),
  "serial"            TEXT,
  "model"             TEXT,
  "ownership"         TEXT NOT NULL DEFAULT 'byo',
  "warrantyUntil"     TIMESTAMP(3),
  "bridgeId"          TEXT,
  "pairCode"          TEXT,
  "pairCodeExpiresAt" TIMESTAMP(3),
  "tokenHash"         TEXT,
  "tokenExpiresAt"    TIMESTAMP(3),
  "config"            JSONB,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL,
  CONSTRAINT "devices_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "devices_pairCode_key" ON "devices" ("pairCode") WHERE "pairCode" IS NOT NULL;
CREATE UNIQUE INDEX "devices_tenantId_serial_key" ON "devices" ("tenantId", "serial") WHERE "serial" IS NOT NULL;
CREATE INDEX "devices_tenantId_branchId_kind_idx" ON "devices" ("tenantId", "branchId", "kind");
CREATE INDEX "devices_tenantId_status_idx" ON "devices" ("tenantId", "status");
CREATE INDEX "devices_bridgeId_idx" ON "devices" ("bridgeId");

-- Local bridge agents ----------------------------------------------------

CREATE TABLE "local_bridge_agents" (
  "id"                    TEXT NOT NULL,
  "tenantId"              TEXT NOT NULL,
  "branchId"              TEXT NOT NULL,
  "provisioningTokenHash" TEXT,
  "tokenHash"             TEXT,
  "tokenExpiresAt"        TIMESTAMP(3),
  "hostname"              TEXT,
  "os"                    TEXT,
  "agentVersion"          TEXT,
  "status"                TEXT NOT NULL DEFAULT 'claiming',
  "lastSeenAt"            TIMESTAMP(3),
  "provisionedAt"         TIMESTAMP(3),
  "productSku"            TEXT,
  "createdAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"             TIMESTAMP(3) NOT NULL,
  CONSTRAINT "local_bridge_agents_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "local_bridge_agents_tenantId_branchId_status_idx"
  ON "local_bridge_agents" ("tenantId", "branchId", "status");

ALTER TABLE "devices" ADD CONSTRAINT "devices_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "branches"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "devices" ADD CONSTRAINT "devices_bridgeId_fkey"
  FOREIGN KEY ("bridgeId") REFERENCES "local_bridge_agents"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "local_bridge_agents" ADD CONSTRAINT "local_bridge_agents_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "branches"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Device commands --------------------------------------------------------

CREATE TABLE "device_commands" (
  "id"             TEXT NOT NULL,
  "tenantId"       TEXT NOT NULL,
  "deviceId"       TEXT NOT NULL,
  "kind"           TEXT NOT NULL,
  "payload"        JSONB NOT NULL,
  "priority"       INTEGER NOT NULL DEFAULT 0,
  "status"         TEXT NOT NULL DEFAULT 'queued',
  "attempts"       INTEGER NOT NULL DEFAULT 0,
  "expiresAt"      TIMESTAMP(3),
  "idempotencyKey" TEXT NOT NULL,
  "result"         JSONB,
  "error"          TEXT,
  "ackedAt"        TIMESTAMP(3),
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "device_commands_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "device_commands_deviceId_idempotencyKey_key"
  ON "device_commands" ("deviceId", "idempotencyKey");
CREATE INDEX "device_commands_deviceId_status_priority_createdAt_idx"
  ON "device_commands" ("deviceId", "status", "priority" DESC, "createdAt");
CREATE INDEX "device_commands_tenantId_status_idx" ON "device_commands" ("tenantId", "status");

ALTER TABLE "device_commands" ADD CONSTRAINT "device_commands_deviceId_fkey"
  FOREIGN KEY ("deviceId") REFERENCES "devices"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Device logs ------------------------------------------------------------

CREATE TABLE "device_logs" (
  "id"        TEXT NOT NULL,
  "tenantId"  TEXT NOT NULL,
  "deviceId"  TEXT NOT NULL,
  "level"     TEXT NOT NULL,
  "category"  TEXT NOT NULL,
  "message"   TEXT NOT NULL,
  "payload"   JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "device_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "device_logs_deviceId_createdAt_idx"
  ON "device_logs" ("deviceId", "createdAt" DESC);
CREATE INDEX "device_logs_tenantId_level_createdAt_idx"
  ON "device_logs" ("tenantId", "level", "createdAt");

ALTER TABLE "device_logs" ADD CONSTRAINT "device_logs_deviceId_fkey"
  FOREIGN KEY ("deviceId") REFERENCES "devices"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
