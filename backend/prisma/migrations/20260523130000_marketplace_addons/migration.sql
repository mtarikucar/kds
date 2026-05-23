-- HummyTummy Phase 2: marketplace add-ons.
--
-- The catalog (`marketplace_addons`) holds re-usable add-on definitions —
-- `grants` is the entitlement delta it confers, `deps` is the prerequisite
-- list. The pivot (`tenant_addons`) records which tenants currently hold
-- which add-ons, at what quantity, in what billing window. The projector
-- joins the two to emit `addon:<code>:<tenantAddOnId>` grants into
-- feature_entitlements; numeric grants are multiplied by `quantity`.
--
-- No FK on tenant_addons.tenantId (project-wide convention — keeps tenant
-- delete from cascading audit-relevant data away). FK on addOnId is
-- Restrict so an active add-on can't be deleted from the catalog; archive
-- it instead via marketplace_addons.status='archived'.

CREATE TABLE "marketplace_addons" (
  "id"          TEXT NOT NULL,
  "code"        TEXT NOT NULL,
  "name"        TEXT NOT NULL,
  "description" TEXT,
  "kind"        TEXT NOT NULL,
  "billing"     TEXT NOT NULL DEFAULT 'recurring',
  "priceCents"  INTEGER NOT NULL,
  "currency"    TEXT NOT NULL DEFAULT 'TRY',
  "grants"      JSONB NOT NULL,
  "deps"        TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "status"      TEXT NOT NULL DEFAULT 'draft',
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  CONSTRAINT "marketplace_addons_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "marketplace_addons_code_key" ON "marketplace_addons" ("code");
CREATE INDEX "marketplace_addons_status_kind_idx" ON "marketplace_addons" ("status", "kind");

CREATE TABLE "tenant_addons" (
  "id"                  TEXT NOT NULL,
  "tenantId"            TEXT NOT NULL,
  "addOnId"             TEXT NOT NULL,
  "branchId"            TEXT,
  "quantity"            INTEGER NOT NULL DEFAULT 1,
  "status"              TEXT NOT NULL DEFAULT 'active',
  "activatedAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "currentPeriodStart"  TIMESTAMP(3),
  "currentPeriodEnd"    TIMESTAMP(3),
  "cancelAtPeriodEnd"   BOOLEAN NOT NULL DEFAULT FALSE,
  "cancelledAt"         TIMESTAMP(3),
  "endedAt"             TIMESTAMP(3),
  "paymentRef"          TEXT,
  CONSTRAINT "tenant_addons_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "tenant_addons_tenantId_status_idx" ON "tenant_addons" ("tenantId", "status");
CREATE INDEX "tenant_addons_addOnId_idx" ON "tenant_addons" ("addOnId");
CREATE INDEX "tenant_addons_tenantId_branchId_idx" ON "tenant_addons" ("tenantId", "branchId");

ALTER TABLE "tenant_addons" ADD CONSTRAINT "tenant_addons_addOnId_fkey"
  FOREIGN KEY ("addOnId") REFERENCES "marketplace_addons"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
