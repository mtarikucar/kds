-- ReservationSettings.holdOffsetMinutes — minutes before a confirmed
-- reservation's start time that the auto-hold scheduler should flip
-- AVAILABLE tables to RESERVED. Drives the upcomingReservation annotation
-- window on /tables and the POS dialog visibility. Default 30 matches the
-- previously hard-coded HOLD_WINDOW_MINUTES constant.

ALTER TABLE "reservation_settings"
ADD COLUMN "holdOffsetMinutes" INTEGER NOT NULL DEFAULT 30;
