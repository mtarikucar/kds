-- Hourly pay rate for labor-cost / prime-cost reporting. Null = not set.
ALTER TABLE "users" ADD COLUMN "hourlyRate" DECIMAL(10,2);
