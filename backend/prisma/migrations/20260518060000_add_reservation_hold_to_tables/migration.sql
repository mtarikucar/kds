-- Auto-RESERVED hold: when the reservation-scheduler marks a table
-- RESERVED 30 min before a CONFIRMED reservation starts, it stamps the
-- reservation id here. The release tick uses this column to distinguish
-- scheduler-managed holds from manually-RESERVED tables (which keep
-- reservationHoldId NULL and must never be auto-cleared).

ALTER TABLE "tables"
  ADD COLUMN "reservationHoldId" TEXT;

CREATE INDEX "tables_reservationHoldId_idx" ON "tables"("reservationHoldId");

ALTER TABLE "tables"
  ADD CONSTRAINT "tables_reservationHoldId_fkey"
  FOREIGN KEY ("reservationHoldId")
  REFERENCES "reservations"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;
