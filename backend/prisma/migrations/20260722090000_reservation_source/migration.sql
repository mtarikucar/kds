-- Reservation.source: booking origin channel — ONLINE (public wizard), PHONE
-- (staff phone booking), WALKIN (staff walk-in). The NOT NULL DEFAULT 'ONLINE'
-- backfills every pre-existing row in one statement, so no separate data step
-- is needed. Idempotent (IF NOT EXISTS); reversible (see down.sql).
ALTER TABLE "reservations" ADD COLUMN IF NOT EXISTS "source" TEXT NOT NULL DEFAULT 'ONLINE';
