-- HummyTummy Phase 5: hardware catalog + checkout + fulfillment.

CREATE TABLE "hardware_products" (
  "id"                 TEXT NOT NULL,
  "sku"                TEXT NOT NULL,
  "category"           TEXT NOT NULL,
  "name"               TEXT NOT NULL,
  "brand"              TEXT,
  "model"              TEXT,
  "description"        TEXT,
  "specs"              JSONB,
  "compat"             JSONB,
  "priceCents"         INTEGER NOT NULL,
  "rentalMonthlyCents" INTEGER,
  "currency"           TEXT NOT NULL DEFAULT 'TRY',
  "warrantyMonths"     INTEGER NOT NULL DEFAULT 12,
  "images"             TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "stockStatus"        TEXT NOT NULL DEFAULT 'in_stock',
  "shippingProfile"    JSONB,
  "status"             TEXT NOT NULL DEFAULT 'draft',
  "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"          TIMESTAMP(3) NOT NULL,
  CONSTRAINT "hardware_products_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "hardware_products_sku_key" ON "hardware_products" ("sku");
CREATE INDEX "hardware_products_category_status_idx" ON "hardware_products" ("category", "status");

CREATE TABLE "hardware_inventory" (
  "id"               TEXT NOT NULL,
  "productId"        TEXT NOT NULL,
  "available"        INTEGER NOT NULL DEFAULT 0,
  "allocated"        INTEGER NOT NULL DEFAULT 0,
  "shipped"          INTEGER NOT NULL DEFAULT 0,
  "serialsAvailable" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "updatedAt"        TIMESTAMP(3) NOT NULL,
  CONSTRAINT "hardware_inventory_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "hardware_inventory_productId_key" ON "hardware_inventory" ("productId");

ALTER TABLE "hardware_inventory" ADD CONSTRAINT "hardware_inventory_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "hardware_products"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "hardware_orders" (
  "id"              TEXT NOT NULL,
  "tenantId"        TEXT NOT NULL,
  "branchId"        TEXT,
  "status"          TEXT NOT NULL DEFAULT 'draft',
  "subtotalCents"   INTEGER NOT NULL DEFAULT 0,
  "taxCents"        INTEGER NOT NULL DEFAULT 0,
  "shippingCents"   INTEGER NOT NULL DEFAULT 0,
  "totalCents"      INTEGER NOT NULL DEFAULT 0,
  "currency"        TEXT NOT NULL DEFAULT 'TRY',
  "shippingAddress" JSONB,
  "billingAddress"  JSONB,
  "installation"    TEXT,
  "paymentRef"      TEXT,
  "notes"           TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL,
  CONSTRAINT "hardware_orders_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "hardware_orders_tenantId_status_idx" ON "hardware_orders" ("tenantId", "status");
CREATE INDEX "hardware_orders_createdAt_idx" ON "hardware_orders" ("createdAt");

CREATE TABLE "hardware_order_items" (
  "id"          TEXT NOT NULL,
  "orderId"     TEXT NOT NULL,
  "productId"   TEXT NOT NULL,
  "sku"         TEXT NOT NULL,
  "name"        TEXT NOT NULL,
  "qty"         INTEGER NOT NULL,
  "unitCents"   INTEGER NOT NULL,
  "serials"     TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "acquisition" TEXT NOT NULL DEFAULT 'sell',
  CONSTRAINT "hardware_order_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "hardware_order_items_orderId_idx" ON "hardware_order_items" ("orderId");

ALTER TABLE "hardware_order_items" ADD CONSTRAINT "hardware_order_items_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "hardware_orders"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "hardware_order_items" ADD CONSTRAINT "hardware_order_items_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "hardware_products"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "shipments" (
  "id"          TEXT NOT NULL,
  "orderId"     TEXT NOT NULL,
  "carrier"     TEXT NOT NULL,
  "trackingNo"  TEXT,
  "status"      TEXT NOT NULL DEFAULT 'pending',
  "shippedAt"   TIMESTAMP(3),
  "deliveredAt" TIMESTAMP(3),
  "meta"        JSONB,
  CONSTRAINT "shipments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "shipments_orderId_idx" ON "shipments" ("orderId");
CREATE INDEX "shipments_carrier_status_idx" ON "shipments" ("carrier", "status");

ALTER TABLE "shipments" ADD CONSTRAINT "shipments_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "hardware_orders"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "installation_requests" (
  "id"             TEXT NOT NULL,
  "tenantId"       TEXT NOT NULL,
  "branchId"       TEXT,
  "hwOrderId"      TEXT,
  "status"         TEXT NOT NULL DEFAULT 'requested',
  "scheduledFor"   TIMESTAMP(3),
  "assignedTo"     TEXT,
  "preferredDates" TIMESTAMP(3)[] NOT NULL DEFAULT ARRAY[]::TIMESTAMP(3)[],
  "notes"          TEXT,
  "completedAt"    TIMESTAMP(3),
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "installation_requests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "installation_requests_tenantId_status_idx" ON "installation_requests" ("tenantId", "status");
CREATE INDEX "installation_requests_scheduledFor_idx" ON "installation_requests" ("scheduledFor");

ALTER TABLE "installation_requests" ADD CONSTRAINT "installation_requests_hwOrderId_fkey"
  FOREIGN KEY ("hwOrderId") REFERENCES "hardware_orders"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "warranties" (
  "id"        TEXT NOT NULL,
  "tenantId"  TEXT NOT NULL,
  "deviceId"  TEXT,
  "productId" TEXT NOT NULL,
  "serial"    TEXT NOT NULL,
  "startAt"   TIMESTAMP(3) NOT NULL,
  "endAt"     TIMESTAMP(3) NOT NULL,
  "claims"    JSONB[] NOT NULL DEFAULT ARRAY[]::JSONB[],
  "status"    TEXT NOT NULL DEFAULT 'active',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "warranties_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "warranties_productId_serial_key" ON "warranties" ("productId", "serial");
CREATE INDEX "warranties_tenantId_status_idx" ON "warranties" ("tenantId", "status");
CREATE INDEX "warranties_endAt_idx" ON "warranties" ("endAt");
