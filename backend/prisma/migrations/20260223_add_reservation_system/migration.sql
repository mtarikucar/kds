-- CreateTable: reservation_settings
CREATE TABLE IF NOT EXISTS "reservation_settings" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "requireApproval" BOOLEAN NOT NULL DEFAULT true,
    "timeSlotInterval" INTEGER NOT NULL DEFAULT 30,
    "minAdvanceBooking" INTEGER NOT NULL DEFAULT 60,
    "maxAdvanceDays" INTEGER NOT NULL DEFAULT 30,
    "defaultDuration" INTEGER NOT NULL DEFAULT 90,
    "operatingHours" JSONB,
    "maxGuestsPerReservation" INTEGER NOT NULL DEFAULT 20,
    "maxReservationsPerSlot" INTEGER,
    "bannerImageUrl" TEXT,
    "bannerTitle" TEXT,
    "bannerDescription" TEXT,
    "customMessage" TEXT,
    "allowCancellation" BOOLEAN NOT NULL DEFAULT true,
    "cancellationDeadline" INTEGER NOT NULL DEFAULT 120,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reservation_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable: reservations
CREATE TABLE IF NOT EXISTS "reservations" (
    "id" TEXT NOT NULL,
    "reservationNumber" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "guestCount" INTEGER NOT NULL,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "customerName" TEXT NOT NULL,
    "customerPhone" TEXT NOT NULL,
    "customerEmail" TEXT,
    "adminNotes" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "confirmedById" TEXT,
    "rejectionReason" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelledBy" TEXT,
    "seatedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "tableId" TEXT,
    "tenantId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reservations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "reservation_settings_tenantId_key" ON "reservation_settings"("tenantId");
CREATE INDEX IF NOT EXISTS "reservation_settings_tenantId_idx" ON "reservation_settings"("tenantId");

CREATE UNIQUE INDEX IF NOT EXISTS "reservations_tenantId_reservationNumber_key" ON "reservations"("tenantId", "reservationNumber");
CREATE INDEX IF NOT EXISTS "reservations_tenantId_idx" ON "reservations"("tenantId");
CREATE INDEX IF NOT EXISTS "reservations_tenantId_date_idx" ON "reservations"("tenantId", "date");
CREATE INDEX IF NOT EXISTS "reservations_tenantId_status_idx" ON "reservations"("tenantId", "status");
CREATE INDEX IF NOT EXISTS "reservations_tableId_idx" ON "reservations"("tableId");

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reservation_settings_tenantId_fkey') THEN
        ALTER TABLE "reservation_settings" ADD CONSTRAINT "reservation_settings_tenantId_fkey"
        FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reservations_tableId_fkey') THEN
        ALTER TABLE "reservations" ADD CONSTRAINT "reservations_tableId_fkey"
        FOREIGN KEY ("tableId") REFERENCES "tables"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reservations_tenantId_fkey') THEN
        ALTER TABLE "reservations" ADD CONSTRAINT "reservations_tenantId_fkey"
        FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
