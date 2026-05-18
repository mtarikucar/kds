-- Make Reservation.customerPhone nullable so email-only walk-in
-- bookings are possible. Application-level @AtLeastOneOf constraint
-- ensures at least one of phone/email is always supplied; the column
-- relaxation just removes the DB-level requirement.
ALTER TABLE "reservations" ALTER COLUMN "customerPhone" DROP NOT NULL;

-- Add per-event email channel toggles to SmsSettings. The reservation
-- notification abstraction prefers email when the customer left an
-- email AND the matching toggle is on; falls back to SMS otherwise.
-- Defaults to true so the new abstraction works out of the box.
ALTER TABLE "sms_settings" ADD COLUMN "emailOnReservationCreated"   BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "sms_settings" ADD COLUMN "emailOnReservationConfirmed" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "sms_settings" ADD COLUMN "emailOnReservationRejected"  BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "sms_settings" ADD COLUMN "emailOnReservationCancelled" BOOLEAN NOT NULL DEFAULT true;
